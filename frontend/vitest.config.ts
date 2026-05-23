/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test-setup.ts',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.*',
        'src/**/*.spec.*',
        'src/**/*.bench.*',
        'src/**/*.d.ts',
        'src/test-setup.ts',
        'src/main.tsx',
        // WebGPU rendering — requires GPU device, not unit-testable
        'src/viewport/renderer.ts',
        'src/viewport/markerRenderer.ts',
        'src/viewport/pipelineFactory.ts',
        // WASM-dependent abstract class — integration/E2E tested
        'src/services/basePlatformService.ts',
        // Platform adapters — covered via Tauri/Web integration tests
        'src/services/tauri.ts',
        'src/services/platform.ts',
        // DOM event / camera input handler — covered via E2E tests
        'src/viewport/cameraController.ts',
        // Dynamic plugin loader — requires real file-system
        'src/plugins/pluginLoader.ts',
        // Viewport interaction hooks — require DOM events + WebGPU, covered by E2E
        'src/hooks/useSplineDrawMode.ts',
        'src/hooks/useSplineDrawPreview.ts',
        'src/hooks/useGeometryEditMode.ts',
        'src/hooks/useMoveRotateMode.ts',
        'src/hooks/useRubberBandSelect.ts',
        'src/hooks/useSplineOperations.ts',
        'src/hooks/useMeasureOverlay.ts',
        'src/hooks/useViewportHoverPick.ts',
        'src/hooks/useViewportDrop.ts',
        'src/hooks/useViewportKeyboard.ts',
        'src/hooks/useAdjustEdgeMode.ts',
        // Component helpers dependent on WebGPU context — covered by E2E
        'src/components/viewportUtils.ts',
        'src/components/shell/definitions.ts',
        // Viewport event dispatch — DOM event routing + WebGPU pick/snap, covered by E2E
        'src/components/viewportEventDispatch.ts',
        // GPU device prewarm — requires navigator.gpu, covered by E2E
        'src/viewport/gpuDeviceCache.ts',
        // Mouse controls — DOM events + WebGPU marker renderer, covered by E2E
        'src/viewport/mouseControls.ts',
        // Snap service — WASM-dependent pick/snap queries
        'src/services/snapService.ts',
        // Browser download API — trivial DOM utility, no logic to test
        'src/utils/download.ts',
        // Lazy plugin loader — dynamic imports require real module system
        'src/plugins/lazyPluginLoader.ts',
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
