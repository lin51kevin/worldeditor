#!/usr/bin/env node
/**
 * build-web.mjs — one-click build of the complete Web artifact.
 *
 * Produces the self-contained static SPA in `frontend/dist/`, ready to be
 * served by any static host or packaged into the Nginx Docker image
 * (`Dockerfile.web`). This is the single entry point consumed by CI/CD.
 *
 * Pipeline:
 *   1. Build the FULL WASM package (release) → `frontend/wasm/pkg/`
 *      (all editor modules via the `extra-modules` feature).
 *   2. Optimise the `.wasm` with `wasm-opt -Oz` when available.
 *   3. Install frontend deps (unless --skip-install) and run `yarn build:web`
 *      → `frontend/dist/` (Tauri deps excluded).
 *
 * Usage:
 *   node scripts/build-web.mjs [--skip-wasm] [--skip-install]
 *
 * Requirements: Rust toolchain + wasm-pack, Node 18+, Yarn 1.x.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const FRONTEND = join(REPO_ROOT, 'frontend');
const WASM_OUT = join(FRONTEND, 'wasm', 'pkg');
const WASM_FILE = join(WASM_OUT, 'we_wasm_bg.wasm');
const DIST = join(FRONTEND, 'dist');

const args = new Set(process.argv.slice(2));
const skipWasm = args.has('--skip-wasm');
const skipInstall = args.has('--skip-install');
const isWindows = process.platform === 'win32';

/** Run a command, inheriting stdio, and abort the build on failure. */
function run(command, cmdArgs, cwd = REPO_ROOT) {
  const shown = [command, ...cmdArgs].join(' ');
  console.log(`\n\u001b[36m$ ${shown}\u001b[0m  (cwd: ${cwd})`);
  execFileSync(command, cmdArgs, {
    cwd,
    stdio: 'inherit',
    // Yarn / wasm-pack are resolved via PATH; on Windows they are .cmd shims.
    shell: isWindows,
  });
}

/** Resolve an executable that may be a `.cmd` shim on Windows. */
function bin(name) {
  return isWindows ? `${name}.cmd` : name;
}

function ensureWasmPack() {
  try {
    execFileSync('wasm-pack', ['--version'], { stdio: 'ignore', shell: isWindows });
  } catch {
    console.error(
      '\u001b[31merror:\u001b[0m wasm-pack not found. Install it with:\n' +
        '  cargo install wasm-pack',
    );
    process.exit(1);
  }
}

function buildWasm() {
  ensureWasmPack();
  run('wasm-pack', [
    'build',
    'crates/we-wasm',
    '--target',
    'web',
    '--out-dir',
    '../../frontend/wasm/pkg',
    '--release',
    '--',
    '--features',
    'extra-modules',
  ]);

  // Optional wasm-opt pass (-Oz). Prefer the frontend's binaryen devDep so the
  // reference-types / bulk-memory features wasm-bindgen emits are accepted.
  const localWasmOpt = join(
    FRONTEND,
    'node_modules',
    '.bin',
    isWindows ? 'wasm-opt.cmd' : 'wasm-opt',
  );
  const optimized = `${WASM_FILE}.opt`;
  const optArgs = ['-Oz', '--all-features', WASM_FILE, '-o', optimized];

  let ran = false;
  if (existsSync(localWasmOpt)) {
    run(localWasmOpt, optArgs);
    ran = true;
  } else {
    try {
      execFileSync('wasm-opt', ['--version'], { stdio: 'ignore', shell: isWindows });
      run('wasm-opt', optArgs);
      ran = true;
    } catch {
      console.log('wasm-opt not installed, skipping further optimization');
    }
  }

  if (ran) {
    // Replace the original with the optimized artifact (cross-platform).
    renameSync(optimized, WASM_FILE);
  }
}

function buildFrontend() {
  if (!skipInstall) {
    run(bin('yarn'), ['install', '--frozen-lockfile'], FRONTEND);
  }
  run(bin('yarn'), ['build:web'], FRONTEND);
}

console.log('\u001b[1m▶ Building WorldEditor Next — Web artifact\u001b[0m');

if (skipWasm) {
  console.log('Skipping WASM build (--skip-wasm).');
  if (!existsSync(WASM_FILE)) {
    console.error(
      `\u001b[31merror:\u001b[0m --skip-wasm set but ${WASM_FILE} is missing. ` +
        'Run without --skip-wasm first.',
    );
    process.exit(1);
  }
} else {
  buildWasm();
}

buildFrontend();

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('\u001b[31merror:\u001b[0m build finished but frontend/dist/index.html is missing.');
  process.exit(1);
}

console.log(`\n\u001b[32m✔ Web artifact ready:\u001b[0m ${DIST}`);
console.log('  Serve it with any static host, or build the Docker image:');
console.log('    docker build -f Dockerfile.web -t worldeditor-web .');
