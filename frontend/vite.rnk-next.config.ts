import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
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
 */
export default defineConfig({
  plugins: [react()],
  define: {
    // App-level compile-time constants referenced by some transitive modules.
    __APP_VERSION__: JSON.stringify('rnk-next'),
    __BUILD_TIME__: JSON.stringify(''),
    __GIT_COMMIT__: JSON.stringify(''),
    __GIT_BRANCH__: JSON.stringify(''),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
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
      fileName: () => 'worldeditor-next-sdk.js',
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
