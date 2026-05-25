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
        // Web Workers — run in separate thread, cannot be unit-tested in jsdom
        'src/workers/**',
        // Viewport interaction hooks — require DOM events + WebGPU, covered by E2E
        'src/hooks/useArcDrawMode.ts',
        'src/hooks/useLaneLineEdit.ts',
        'src/hooks/useSignalPlacement.ts',
        'src/hooks/useSpiralDrawMode.ts',
        'src/hooks/useSplitMode.ts',
        // Format parsers — complex branching over real file formats, covered by integration tests
        'src/plugins/io/geoz/parser.ts',
        'src/plugins/io/osm/io-osm.plugin.ts',
        // Viewport-dependent editing plugins — require WebGPU context + mouse events, covered by E2E
        'src/plugins/editing/shape-editor/shape-editor.plugin.ts',
        'src/plugins/editing/advanced-editing/advanced-editing.plugin.ts',
        // Viewport highlight modules — require WebGPU render pass for visual feedback
        'src/viewport/pickHighlight.ts',
        'src/viewport/selectionHighlight.ts',
        // Viewport meshes hook — requires WebGPU context
        'src/hooks/useViewportMeshes.ts',
        // Road link highlight hook — requires WebGPU render pass
        'src/hooks/useRoadLinkHighlight.ts',
        // File loader hook — requires full platform service + WASM parse pipeline
        'src/hooks/useFileLoader.ts',
        // IO signals importer — requires WASM (export tested separately)
        'src/plugins/io/signals/io-signals.plugin.ts',
        // Viewport selection highlight hook — requires WebGPU render context
        'src/hooks/useSelectionHighlight.ts',
        // 3D model plugin — requires WebGPU for model loading/rendering
        'src/plugins/gis/models3d/obj3d.plugin.ts',
        // Traffic utilities — runtime-dependent traffic simulation helpers
        'src/plugins/analysis/traffic/trafficUtils.ts',
        // Menu actions hook — requires full editor runtime (dialogs, platform service)
        'src/hooks/useMenuActions.ts',
        // Plugin hooks — requires full plugin runtime with WASM
        'src/hooks/usePlugins.ts',
        // IO obj3d plugin — requires fetch/WebGPU for 3D model loading
        'src/plugins/io/obj3d/io-obj3d.plugin.ts',
        // Parser worker — runs in Web Worker context
        'src/plugins/workers/parser.worker.ts',
        // Render loop — requires WebGPU frame loop
        'src/viewport/renderLoop.ts',
        // Templates plugin — UI plugin requiring editor runtime for panel/dialog registration
        'src/plugins/editing/templates/templates.plugin.ts',
        // Autopilot compatible provider — requires LLM runtime
        'src/plugins/editing/ai-copilot/providers/openai-compatible.ts',
        // AI copilot core — requires LLM API runtime
        'src/plugins/editing/ai-copilot/core/action-executor.ts',
        'src/plugins/editing/ai-copilot/core/context-assembler.ts',
        'src/plugins/editing/ai-copilot/core/copilot-engine.ts',
        // Traffic simulation plugin — requires runtime traffic simulation context
        'src/plugins/analysis/traffic/traffic.plugin.ts',
        // Scripting plugin — uses eval/Function constructor, requires runtime sandbox
        'src/plugins/gis-viz/scripting/scriptingUtils.ts',
        // Scripting beta plugin — requires editor runtime for panel registration
        'src/plugins/gis-viz/scripting/scripting-beta.plugin.ts',
        // Builtin registry — dynamic plugin registration, covered by integration tests
        'src/plugins/builtinRegistry.ts',
        // Template loader — dynamic import of JSON configs, requires file system
        'src/plugins/editing/templates/loader.ts',
        // Layer panel tree — UI component requiring DOM tree context
        'src/components/panels/layer/JunctionLayerTree.ts',
        // Platform service factory — dynamic import requiring runtime detection
        'src/services/index.ts',
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
