#!/usr/bin/env node
/**
 * build-plugins.mjs — bundle external filesystem plugins into `plugins/<id>/`.
 *
 * Each plugin source lives in `frontend/src/plugins-external/<name>/` with an
 * `index.ts` entry point and a `manifest.json`. This script:
 *   1. Discovers every such directory.
 *   2. Bundles `index.ts` with esbuild as a self-contained IIFE (minified).
 *   3. Writes the bundle to `plugins/<manifest.id>/dist/index.js`.
 *   4. Copies `manifest.json` alongside it.
 *
 * The `plugins/` directory is shipped into the app via Tauri `bundle.resources`
 * (see src-tauri/tauri.conf.json) and discovered at runtime by the Rust
 * PluginRegistry. The web build does NOT use these — it keeps plugins compiled
 * in statically (no filesystem access in the browser).
 *
 * Usage: node scripts/build-plugins.mjs
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readdir, readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SRC_ROOT = join(REPO_ROOT, 'frontend', 'src', 'plugins-external');
const OUT_ROOT = join(REPO_ROOT, 'plugins');

// Resolve esbuild from the frontend workspace regardless of the current cwd.
const frontendRequire = createRequire(join(REPO_ROOT, 'frontend', 'package.json'));
const esbuild = frontendRequire('esbuild');

/**
 * esbuild plugin: rewrite `react` / `react/jsx-runtime` imports to read from
 * `window.__WE_SHARED__` (populated by the host before a bundle runs). This
 * keeps React out of the plugin bundle so UI plugins share the host's single
 * React instance. Dot access is used deliberately so the output stays within
 * the sandbox guard (which forbids bracket access on the global object).
 */
const sharedRuntimeShim = {
  name: 'we-shared-runtime',
  setup(build) {
    build.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'we-shared' }));
    build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({
      path: 'react/jsx-runtime',
      namespace: 'we-shared',
    }));
    build.onLoad({ filter: /.*/, namespace: 'we-shared' }, (args) => {
      const expr =
        args.path === 'react' ? 'window.__WE_SHARED__.react' : 'window.__WE_SHARED__.reactJsxRuntime';
      return { contents: `module.exports = ${expr};`, loader: 'js' };
    });
  },
};

/** Discover plugin source directories that contain both index.ts and manifest.json. */
async function discoverPlugins() {
  if (!existsSync(SRC_ROOT)) {
    return [];
  }
  const entries = await readdir(SRC_ROOT, { withFileTypes: true });
  const plugins = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(SRC_ROOT, entry.name);
    const manifestFile = join(dir, 'manifest.json');
    if (!existsSync(manifestFile)) continue;
    // Entry point is index.tsx (UI plugins) or index.ts (logic-only plugins).
    const entryFile = existsSync(join(dir, 'index.tsx'))
      ? join(dir, 'index.tsx')
      : join(dir, 'index.ts');
    if (existsSync(entryFile)) {
      plugins.push({ name: entry.name, dir, entryFile, manifestFile });
    }
  }
  return plugins;
}

async function buildPlugin(plugin) {
  const manifest = JSON.parse(await readFile(plugin.manifestFile, 'utf8'));
  const id = manifest.id ?? plugin.name;
  const main = manifest.main ?? 'dist/index.js';

  const outFile = join(OUT_ROOT, id, main);
  await mkdir(dirname(outFile), { recursive: true });

  await esbuild.build({
    entryPoints: [plugin.entryFile],
    outfile: outFile,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    legalComments: 'none',
    logLevel: 'warning',
    jsx: 'automatic',
    loader: { '.css': 'text' },
    plugins: [sharedRuntimeShim],
  });

  await copyFile(plugin.manifestFile, join(OUT_ROOT, id, 'manifest.json'));
  return { id, outFile };
}

async function main() {
  const plugins = await discoverPlugins();
  if (plugins.length === 0) {
    console.log('[build-plugins] No external plugins found in', SRC_ROOT);
    return;
  }

  console.log(`[build-plugins] Building ${plugins.length} external plugin(s)…`);
  for (const plugin of plugins) {
    try {
      const { id, outFile } = await buildPlugin(plugin);
      console.log(`  ✓ ${id} → ${outFile.replace(REPO_ROOT, '.')}`);
    } catch (err) {
      // Clean up a partial output directory so a broken build can't ship.
      const partial = join(OUT_ROOT, plugin.name);
      await rm(partial, { recursive: true, force: true }).catch(() => {});
      console.error(`  ✗ ${plugin.name} failed:`, err.message ?? err);
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error('[build-plugins] Fatal error:', err);
  process.exit(1);
});
