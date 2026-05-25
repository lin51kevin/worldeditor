import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

function getGitInfo() {
  try {
    const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    return { commit, branch };
  } catch {
    return { commit: 'unknown', branch: 'unknown' };
  }
}

function getPackageVersion() {
  const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')) as { version: string };
  return pkg.version;
}

export default defineConfig(({ mode }) => {
  const git = getGitInfo();
  const version = getPackageVersion();
  const buildTime = new Date().toISOString();

  return {
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(version),
      __BUILD_TIME__: JSON.stringify(buildTime),
      __GIT_COMMIT__: JSON.stringify(git.commit),
      __GIT_BRANCH__: JSON.stringify(git.branch),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    worker: {
      format: 'es',
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
  };
});
