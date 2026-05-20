import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: mode === 'tauri' ? '../src-tauri/frontend-dist' : 'dist',
    emptyOutDir: true,
    target: 'es2020',
    minify: 'esbuild',
    rollupOptions: {
      external: mode === 'web' ? [/^@tauri-apps\//] : [],
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          'vendor-i18n': ['i18next', 'react-i18next', 'i18next-browser-languagedetector'],
          'vendor-utils': ['jszip', 'protobufjs/minimal'],
        },
      },
    },
  },
}));
