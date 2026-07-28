import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, existsSync } from 'fs';
import path from 'path';

/**
 * Dedicated library build for the rnk-next integration SDK.
 *
 * Produces a single self-contained ESM bundle from `src/integration/rnkNextSdk.ts`
 * that can be vendored into an external host application (e.g. the WebPages
 * project) whose bundler (rspack/webpack) cannot process Vite-specific imports
 * such as `?raw` proto strings or the inline WGSL/WASM glue.
 *
 * The WASM binary is intentionally NOT inlined: the host passes its location to
 * `createWorldEditorSdk({ wasmInput })`, so it is served as a separate asset.
 *
 * Output naming is unified as the `we-next-sdk.*` triplet so the host can vendor
 * the artifacts by a plain copy (no post-copy rename):
 *   - `dist-rnk/we-next-sdk.js`   — the ESM SDK bundle (this lib build),
 *   - `dist-rnk/we-next-sdk.wasm` — the slim wasm-bindgen binary (emitted by the
 *     plugin below; wasm-pack itself still names it `we_wasm_bg.wasm`).
 */
const SLIM_WASM_SRC = path.resolve(__dirname, 'wasm/pkg-slim/we_wasm_bg.wasm');
const VENDOR_WASM_NAME = 'we-next-sdk.wasm';

/**
 * Copies the slim wasm binary into the lib output under the unified vendor name.
 * Runs on every `yarn build:rnk` (survives Vite's `emptyOutDir` which wipes
 * `dist-rnk` before each build). Fails fast if the slim wasm is missing so a
 * stale/incomplete vendor bundle is never produced silently.
 */
function emitVendorWasm(): Plugin {
  return {
    name: 'rnk-next-emit-vendor-wasm',
    apply: 'build',
    writeBundle(options) {
      if (!existsSync(SLIM_WASM_SRC)) {
        throw new Error(
          `[rnk-next] slim wasm not found at ${SLIM_WASM_SRC}. Run \`just build-wasm-rnk\` (or \`just build-rnk\`) first.`,
        );
      }
      const outDir = options.dir ?? path.resolve(__dirname, 'dist-rnk');
      copyFileSync(SLIM_WASM_SRC, path.join(outDir, VENDOR_WASM_NAME));
    },
  };
}

export default defineConfig({
  plugins: [react(), emitVendorWasm()],
  define: {
    // App-level compile-time constants referenced by some transitive modules.
    __APP_VERSION__: JSON.stringify('rnk-next'),
    __BUILD_TIME__: JSON.stringify(''),
    __GIT_COMMIT__: JSON.stringify(''),
    __GIT_BRANCH__: JSON.stringify(''),
  },
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, './src') },
      // rnk-next embeds the SLIM wasm build (opendrive + render + pointcloud +
      // picking only). Redirect the shared `wasm/pkg/we_wasm` imports to the
      // slim pkg so the vendored SDK bundle stays minimal; frontend/wasm/pkg
      // remains the FULL desktop-editor build.
      {
        find: /(^|\/)wasm\/pkg\/we_wasm$/,
        replacement: '$1wasm/pkg-slim/we_wasm',
      },
    ],
  },
  build: {
    outDir: 'dist-rnk',
    emptyOutDir: true,
    target: ['es2019'],
    minify: 'esbuild',
    sourcemap: false,
    lib: {
      entry: path.resolve(__dirname, 'src/integration/rnkNextSdk.ts'),
      formats: ['es'],
      fileName: () => 'we-next-sdk.js',
    },
    rollupOptions: {
      // Fully self-contained: bundle every reachable dependency so the host
      // bundler only sees a single ESM file.
      external: [],
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
