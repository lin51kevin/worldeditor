export { getSplineHandlePoints } from './splineUtils';
export type { SignalData, ObjectData, MarkingData, MouseDragAction } from './viewportTypes';
export { resolveMouseDragAction, computeGroundPanOffset } from './viewportTypes';
import { takePrewarmedGPU, returnPrewarmedGPU } from './gpuDeviceCache';
import type { PrewarmedGPU } from './gpuDeviceCache';
import { createRenderLoop } from './renderLoop';
import type { RenderLoop } from './renderLoop';

/**
 * WebGPU viewport renderer.
 *
 * Renders OpenDRIVE road geometry on a <canvas> element using the WebGPU API.
 * This is the browser-native renderer that mirrors the Rust we-render crate.
 *
 * TODO(#6): Migrate data generation to we-wasm pipeline.
 *   - Vertex generation (road mesh, lane lines, junctions) should move to
 *     we-wasm's generate_road_mesh_from_json() and related WASM functions.
 *   - This file should focus on GPU rendering only, receiving pre-built vertex buffers.
 *   - See crates/we-wasm/src/lib.rs for the progressive WASM data pipeline.
 */

import type { ControlPointRef } from './tangentHandleController';
import {
  createGridPipeline as createGridPipelineFn,
  createBasicPipelines,
  createLaneLinePipeline as createLaneLinePipelineFn,
  createBillboardPipeline as createBillboardPipelineFn,
  createPointCloudPipeline as createPointCloudPipelineFn,
} from './pipelineFactory';
import { CameraController } from './cameraController';
import { MarkerRenderer } from './markerRenderer';
import { FlyKeyboardController } from './flyControls';
import type { RenderableMesh } from './markerRenderer';
import { setupRendererInput } from './rendererInputHandler';
import { renderFrame as renderFrameImpl, captureFrame as captureFrameImpl } from './rendererFrame';
import type { RendererFrameInternals } from './rendererFrame';
import { uploadMeshData, disposeMeshes, createDepthTexture, createMsaaTexture } from './rendererResources';
import { SpriteRenderer } from './spriteRenderer';
import type { SpriteInstance, PaintInstance } from './spriteRenderer';
import { TextureManager } from './textureManager';
import { initAssetResolver } from '../utils/assetUrl';

export class ViewportRenderer {
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private format!: GPUTextureFormat;
  private depthTexture!: GPUTexture;
  // MSAA 4x resolve texture — render to this, then blit to the swap chain
  private msaaTexture: GPUTexture | null = null;

  // Pipelines
  gridPipeline!: GPURenderPipeline;
  gridBindGroup!: GPUBindGroup;
  private gridUniformBuffer!: GPUBuffer;
  basicPipeline!: GPURenderPipeline;
  highlightPipeline!: GPURenderPipeline;
  private basicShaderModule!: GPUShaderModule;
  basicBindGroup!: GPUBindGroup;
  private basicBindGroupLayout!: GPUBindGroupLayout;
  private basicUniformBuffer!: GPUBuffer;

  private cameraController = new CameraController();
  private markerRenderer = new MarkerRenderer();
  private flyKeyboard = new FlyKeyboardController();
  private textureManager: TextureManager | null = null;
  private spriteRenderer: SpriteRenderer | null = null;

  // Road meshes
  private meshes: RenderableMesh[] = [];
  // Lane line meshes
  private laneLineMeshes: RenderableMesh[] = [];
  // Bridge/tunnel overlay meshes (rendered above road surface)
  private overlayMeshes: RenderableMesh[] = [];

  // Callback for hover detection on spline control points
  private onControlPointHovered: ((ref: ControlPointRef | null) => void) | null = null;
  private width = 0;
  private height = 0;
  private renderLoop: RenderLoop | null = null;
  private deviceLost = false;
  // Set to true by dispose(); guards against async init() completing after cleanup
  private disposed = false;
  private mouseControlsCleanup: (() => void) | null = null;

  // ── Render-on-demand ────────────────────────────────────────────────────────
  // The render loop only submits GPU work when the scene is dirty (camera moved,
  // mesh data uploaded, visibility toggled, or resize).  On a completely static
  // scene the GPU is idle, saving ~85 % of idle power consumption.
  private sceneDirty = true;
  /** Timestamp of last rendered frame (for fly mode delta-time calculation). */
  private lastFrameTime = 0;

  // Visibility flags for grid/axis
  showGrid = true;
  showAxis = true;

  // Theme colors
  private clearColor: { r: number; g: number; b: number; a: number } = { r: 0.10, g: 0.10, b: 0.12, a: 1.0 };
  gridColor: [number, number, number] = [0.50, 0.50, 0.50];

  // Selection highlight mesh
  private highlightMeshes: RenderableMesh[] = [];

  // Road link (predecessor/successor) highlight mesh
  private linkHighlightMeshes: RenderableMesh[] = [];

  // Hover highlight mesh (shown when mouse hovers over a road/junction)
  private hoverMeshes: RenderableMesh[] = [];

  // Point cloud background mesh (rendered behind roads)
  private pointCloudMeshes: RenderableMesh[] = [];
  private pointCloudPipeline: GPURenderPipeline | null = null;

  // Last uploaded vertex data (needed for zoomToFit re-trigger)
  private lastVertexData: Float32Array | null = null;

  // When true, the next uploadVertices call with non-empty data will fitToVertices.
  private pendingFitToVertices = false;

  // Pre-allocated uniform buffers (avoid per-frame GC)
  // 28 floats = 112 bytes: mat4x4(16) + vec3(3)+f32(1) + vec3(3)+f32(1) + f32 show_grid + f32 show_axis + 2 pad
  gridUniformData = new Float32Array(28);
  basicUniformData = new Float32Array(32);

  // Plugin viewport overlay renderers — called after main render pass
  overlayRenderers: Array<(ctx: { device?: GPUDevice; canvas?: HTMLCanvasElement }) => void> = [];
  overlayCanvas: HTMLCanvasElement | null = null;

  constructor() {
    this.cameraController.setScaleMetricsChangedCallback(({ mpp }) => {
      if (this.markerRenderer.knotCount === 0) return;
      this.markerRenderer.refreshSplineCurve(mpp);
      this.markerRenderer.refreshSplineMarkers(mpp, this.clearColor);
      this.markSceneDirty();
    });
  }

  /** Update the list of plugin overlay render functions (sorted by order). */
  setOverlayRenderers(
    renderers: Array<(ctx: { device?: GPUDevice; canvas?: HTMLCanvasElement }) => void>,
    canvas?: HTMLCanvasElement,
  ): void {
    this.overlayRenderers = renderers;
    if (canvas) this.overlayCanvas = canvas;
    this.markSceneDirty();
  }

  /**
   * Register hover callback for spline control points.
   */
  setControlPointCallbacks(callbacks: {
    onControlPointHovered?: ((ref: ControlPointRef | null) => void) | null;
  }): void {
    if ('onControlPointHovered' in callbacks) this.onControlPointHovered = callbacks.onControlPointHovered ?? null;
  }

  /**
   * Hit-test control points at the given screen pixel coordinates.
   * Returns the nearest control point within ~10px, or null.
   */
  pickControlPointAtScreen(screenX: number, screenY: number): ControlPointRef | null {
    if (this.markerRenderer.knotCount === 0) return null;
    const world = this.unprojectToGround(screenX, screenY);
    if (!world) return null;
    return this.markerRenderer.pickControlPoint(world.x, world.y, this.getMetersPerPixel());
  }

  /** Register a callback invoked on data load or camera change with grid info. */
  setScaleChangeCallback(cb: (info: { gridSpacing: number; mpp: number }) => void): void {
    this.cameraController.setScaleChangeCallback(cb);
  }

  /** Compute current meters-per-pixel (perspective approximation at target distance). */
  getMetersPerPixel(): number {
    return this.cameraController.getMetersPerPixel();
  }

  /** Check if WebGPU is available. */
  static isSupported(): boolean {
    return 'gpu' in navigator;
  }

  /** Initialize the renderer on a canvas element. */
  async init(canvas: HTMLCanvasElement): Promise<boolean> {
    const t0 = performance.now();
    if (!ViewportRenderer.isSupported()) return false;

    // Try pre-warmed GPU first; fall back to fresh request
    const prewarmed = await takePrewarmedGPU();
    if (this.disposed) {
      // React StrictMode unmounted us — return the device to cache for next mount
      if (prewarmed) returnPrewarmedGPU(prewarmed);
      return false;
    }

    let device: GPUDevice;
    if (prewarmed) {
      device = prewarmed.device;
    } else {
      const adapter = await navigator.gpu.requestAdapter();
      if (this.disposed || !adapter) return false;
      device = await adapter.requestDevice({
        requiredLimits: { maxBufferSize: adapter.limits.maxBufferSize },
      });
      if (this.disposed) {
        // Return fresh device to cache for next mount
        returnPrewarmedGPU({ adapter, device } as PrewarmedGPU);
        return false;
      }
    }
    const tDevice = performance.now();

    this.device = device;
    this.device.lost.then((info) => {
      console.warn('[Renderer] WebGPU device lost:', info.message);
      this.deviceLost = true;
    });
    this.context = canvas.getContext('webgpu') as GPUCanvasContext;
    this.format = navigator.gpu.getPreferredCanvasFormat();

    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'premultiplied',
    });

    this.width = canvas.width;
    this.height = canvas.height;
    this.cameraController.setViewportSize(this.width, this.height);
    this.markerRenderer.setDevice(this.device);

    const tConfigure = performance.now();
    this.depthTexture = createDepthTexture(this.device, this.width, this.height);
    const tDepth = performance.now();
    this.msaaTexture = createMsaaTexture(this.device, this.format, this.width, this.height);
    const tMsaa = performance.now();
    this.createGridPipeline();
    const tGrid = performance.now();
    this.createBasicPipeline();
    const tBasic = performance.now();
    this.initSpriteRenderer();
    this.setupMouseControls(canvas);
    const tDone = performance.now();

    console.info(
      `[Renderer:perf] init total=${(tDone - t0).toFixed(1)}ms (${prewarmed ? 'prewarmed' : 'cold'}) | ` +
      `device=${(tDevice - t0).toFixed(1)} configure=${(tConfigure - tDevice).toFixed(1)} ` +
      `depth=${(tDepth - tConfigure).toFixed(1)} msaa=${(tMsaa - tDepth).toFixed(1)} ` +
      `gridPipeline=${(tGrid - tMsaa).toFixed(1)} basicPipeline=${(tBasic - tGrid).toFixed(1)} ` +
      `mouseControls=${(tDone - tBasic).toFixed(1)}`,
    );

    return true;
  }

  /** Upload road vertex data (7 floats per vertex: x,y,z,r,g,b,a). */

  uploadRoadVertices(
    vertexData: Float32Array,
    options?: { preserveLastVertexDataOnEmpty?: boolean },
  ): void {
    const preserveLastVertexDataOnEmpty = options?.preserveLastVertexDataOnEmpty === true;

    if (vertexData.length === 0) {
      if (this.meshes.length > 0) this.markSceneDirty();
      for (const m of this.meshes) { m.vertexBuffer.destroy(); }
      this.meshes = [];
      if (preserveLastVertexDataOnEmpty) {
        // Keep last non-empty geometry so switching wire/sketch -> solid does not
        // trigger an unintended auto-fit reset.
        if (!this.lastVertexData || this.lastVertexData.length === 0) {
          this.lastVertexData = vertexData;
        }
      } else {
        this.lastVertexData = vertexData;
        // Cancel any pending auto-fit: loading an empty project arms
        // pendingFitToVertices via resetCamera(), but with no content there is
        // nothing to fit. Clearing it here prevents the stale fit intent from
        // leaking onto the first road the user later draws (which would snap the
        // camera back to a default/fit position). Opening a file that already
        // contains roads still fits, because its non-empty upload consumes the
        // flag before any empty upload occurs.
        this.pendingFitToVertices = false;
      }
      return;
    }

    uploadMeshData(this.device, this.meshes, vertexData);
    this.markSceneDirty();

    // Store for later zoomToFit calls
    this.lastVertexData = vertexData;

    // Auto-fit camera only when explicitly requested (e.g. file open, reset camera)
    if (this.pendingFitToVertices) {
      this.pendingFitToVertices = false;
      this.fitToVertices(vertexData);
    }
  }

  /** Upload selection highlight vertex data (7 floats per vertex: x,y,z,r,g,b,a). */
  uploadHighlightVertices(vertexData: Float32Array): void {
    if (vertexData.length === 0) {
      this.clearHighlight();
      return;
    }
    uploadMeshData(this.device, this.highlightMeshes, vertexData);
    this.markSceneDirty();
  }

  /** Clear the selection highlight mesh. */
  clearHighlight(): void {
    if (this.highlightMeshes.length === 0) return;
    for (const m of this.highlightMeshes) {
      m.vertexBuffer.destroy();
    }
    this.highlightMeshes = [];
    this.markSceneDirty();
  }

  /** Upload road link (predecessor/successor) highlight vertex data. */
  uploadLinkHighlightVertices(vertexData: Float32Array): void {
    if (vertexData.length === 0) {
      this.clearLinkHighlight();
      return;
    }
    uploadMeshData(this.device, this.linkHighlightMeshes, vertexData);
    this.markSceneDirty();
  }

  /** Clear the road link highlight mesh. */
  clearLinkHighlight(): void {
    if (this.linkHighlightMeshes.length === 0) return;
    for (const m of this.linkHighlightMeshes) {
      m.vertexBuffer.destroy();
    }
    this.linkHighlightMeshes = [];
    this.markSceneDirty();
  }

  /** Upload hover highlight vertex data (7 floats per vertex: x,y,z,r,g,b,a). */
  uploadHoverVertices(vertexData: Float32Array): void {
    if (vertexData.length === 0) {
      this.clearHover();
      return;
    }
    uploadMeshData(this.device, this.hoverMeshes, vertexData);
    this.markSceneDirty();
  }

  /** Clear the hover highlight mesh. */
  clearHover(): void {
    if (this.hoverMeshes.length === 0) return;
    for (const m of this.hoverMeshes) {
      m.vertexBuffer.destroy();
    }
    this.hoverMeshes = [];
    this.markSceneDirty();
  }

  /** Set visibility of the grid. */
  setShowGrid(show: boolean): void {
    this.showGrid = show;
    this.markSceneDirty();
    this.cameraController.markDirty();
  }

  /** Set visibility of the axis indicator. */
  setShowAxis(show: boolean): void {
    this.showAxis = show;
    this.markSceneDirty();
    this.cameraController.markDirty();
  }

  /** Trigger redraw when the viewport view mode changes. */
  /** Reset camera to default position/zoom. */
  resetCamera(dimension?: '3d' | '2d'): void {
    this.cameraController.resetCamera(dimension);
    this.pendingFitToVertices = true;
  }

  setViewMode(_mode: 'solid' | 'wire' | 'sketch'): void {
    this.markSceneDirty();
    this.cameraController.markDirty();
  }

  /** Set the WebGPU clear (background) color. Pass `a = 0` for a transparent
   *  background (the canvas is configured with premultiplied alpha). */
  setClearColor(r: number, g: number, b: number, a = 1.0): void {
    this.clearColor = { r, g, b, a };
    this.markSceneDirty();
    if (this.markerRenderer.knotCount > 0) {
      this.markerRenderer.refreshSplineMarkers(this.getMetersPerPixel(), this.clearColor);
    }
  }

  /** Set the grid line color. */
  setGridColor(r: number, g: number, b: number): void {
    this.gridColor = [r, g, b];
    this.markSceneDirty();
    this.cameraController.markDirty();
  }

  /** Switch between 3D perspective and 2D top-down view. */
  setDimension(dimension: '3d' | '2d'): void {
    this.cameraController.setDimension(dimension);
  }

  /** Unproject a screen pixel to world-space coordinates on the Z=0 ground plane. */
  unprojectToGround(screenX: number, screenY: number): { x: number; y: number } | null {
    return this.cameraController.unprojectToGround(screenX, screenY);
  }

  /** Project a world-space XY point (Z=0) to canvas pixel coordinates. Returns null if off-screen. */
  projectWorldToScreen(wx: number, wy: number): { x: number; y: number } | null {
    return this.cameraController.projectWorldToScreen(wx, wy);
  }


  /** Upload bridge/tunnel overlay vertex data (7 floats per vertex: x,y,z,r,g,b,a). */
  uploadOverlayVertices(vertexData: Float32Array): void {
    if (vertexData.length === 0) {
      if (this.overlayMeshes.length === 0) return;
      for (const m of this.overlayMeshes) { m.vertexBuffer.destroy(); }
      this.overlayMeshes = [];
      this.markSceneDirty();
      return;
    }
    uploadMeshData(this.device, this.overlayMeshes, vertexData);
    this.markSceneDirty();
  }

  /** Upload point cloud vertex data (7 floats per vertex: x,y,z,r,g,b,a). Rendered as point-list. */
  uploadPointCloudVertices(vertexData: Float32Array): void {
    if (vertexData.length === 0) {
      if (this.pointCloudMeshes.length === 0) return;
      for (const m of this.pointCloudMeshes) { m.vertexBuffer.destroy(); }
      this.pointCloudMeshes = [];
      this.markSceneDirty();
      return;
    }
    // Lazy-create point cloud pipeline on first use
    if (!this.pointCloudPipeline) {
      this.pointCloudPipeline = createPointCloudPipelineFn(
        this.device, this.format, this.basicShaderModule, this.basicBindGroupLayout,
      );
    }
    uploadMeshData(this.device, this.pointCloudMeshes, vertexData);
    this.markSceneDirty();
  }

  /** Upload lane line vertex data (7 floats per vertex: x,y,z,r,g,b,a). */
  uploadLaneLineVertices(vertexData: Float32Array): void {
    if (vertexData.length === 0) {
      if (this.laneLineMeshes.length === 0) return;
      for (const m of this.laneLineMeshes) { m.vertexBuffer.destroy(); }
      this.laneLineMeshes = [];
      this.markSceneDirty();
      return;
    }
    uploadMeshData(this.device, this.laneLineMeshes, vertexData);
    this.markSceneDirty();
  }

  /**
   * Upload spline knot preview geometry: Catmull-Rom smooth curve + tangent handles + knot markers.
   * Pass an empty array to clear the preview.
   * Vertex format: 7 floats per vertex (x, y, z, r, g, b, a), triangle-list.
   *
   * @param isDrawMode When true, tangent handle endpoint X-squares are hidden so
   *   only the tangent reference lines and knot markers are shown (draw-mode style).
   */
  setSplinePreviewKnots(
    knots: Array<[number, number, number]>,
    tangentOverrides?: Record<number, [number, number, number]>,
    isDrawMode = false,
    skipCurve = false,
  ): void {
    this.markerRenderer.setSplinePreviewKnots(knots, tangentOverrides, this.getMetersPerPixel(), this.clearColor, isDrawMode, skipCurve);
    this.markSceneDirty();
  }

  /**
   * Upload pre-computed curve vertex data (e.g. road center line from WASM)
   * as the spline curve mesh. Used in geometry-edit mode where the connecting
   * line should be the actual road reference line, not a Hermite approximation.
   */
  setCurveFromVertexData(data: Float32Array): void {
    this.markerRenderer.setCurveFromVertexData(data);
    this.markSceneDirty();
  }

  /**
   * Rebuild spline control-point marker geometry with screen-space constant sizes.
   * Optionally updates hover/selection state before rebuilding.
   */
  refreshSplineMarkers(
    hovered?: { index: number; type: 'knot' | 'in' | 'out' } | null,
    selected?: { index: number; type: 'knot' | 'in' | 'out' } | null,
  ): void {
    this.markerRenderer.refreshSplineMarkers(this.getMetersPerPixel(), this.clearColor, hovered, selected);
    this.markSceneDirty();
  }

  /** Compute bounding box of vertex data and move camera to see all geometry. */
  fitToVertices(vertexData?: Float32Array): void {
    const data = vertexData ?? this.lastVertexData;
    if (!data) return;
    this.cameraController.fitToVertices(data);
  }

  /**
   * Pan the camera to center on the AABB of the given vertex data.
   * Unlike fitToVertices, the camera distance (zoom level) is preserved.
   */
  panToCenter(vertexData: Float32Array): void {
    this.cameraController.panToCenter(vertexData);
  }

  /** Resize the viewport. */
  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.width = width;
    this.height = height;
    this.markSceneDirty();
    this.cameraController.setViewportSize(width, height);
    this.depthTexture?.destroy();
    this.msaaTexture?.destroy();
    this.msaaTexture = null;
    this.depthTexture = createDepthTexture(this.device, this.width, this.height);
    this.msaaTexture = createMsaaTexture(this.device, this.format, this.width, this.height);
  }

  /**
   * Mark the scene as needing a re-render.  Called automatically by upload/
   * visibility methods; external code (e.g. overlay updates) can call this too.
   */
  markSceneDirty(): void {
    this.sceneDirty = true;
    this.renderLoop?.wakeUp();
  }

  /**
   * Place the 2D orthographic camera at an absolute world center with an
   * explicit zoom (meters per screen pixel). For external map hosts (e.g. the
   * rnk-next Leaflet adapter) that drive the camera directly. No-op outside 2D.
   */
  set2DView(centerX: number, centerY: number, metersPerPixel: number): void {
    this.cameraController.set2DView(centerX, centerY, metersPerPixel);
    this.markSceneDirty();
  }

  /**
   * Force a single synchronous frame. Useful when the host drives rendering
   * explicitly (no internal render loop) — e.g. after a camera/data change from
   * an embedding map control. Safe to call before/after init lifecycle bounds.
   */
  render(): void {
    if (this.deviceLost || this.disposed || !this.device) return;
    this.sceneDirty = true;
    this.cameraController.isViewDirty = true;
    this.renderFrame();
  }

  /**
   * Render the current frame and return it as a PNG data URL (empty string on
   * failure). Convenience wrapper over {@link captureFrame} for hosts that want
   * a non-null string (e.g. thumbnail generation in rnk-next).
   */
  toDataURL(): string {
    return this.captureFrame() ?? '';
  }

  /**
   * Force a synchronous render and immediately capture the canvas content.
   * This ensures the WebGPU canvas has valid pixels when toDataURL() is called
   * (before the compositor can expire the frame).
   *
   * @param options.transparent - If true, renders with transparent clear color
   *   and excludes grid/axis so the export has a clean transparent background.
   * @param options.fitToContent - If true, temporarily fits the camera to show
   *   all road content before rendering, then restores the original camera.
   */
  captureFrame(options?: { transparent?: boolean; fitToContent?: boolean }): string | null {
    return captureFrameImpl(this as unknown as RendererFrameInternals, options);
  }

  /** Start the render loop (render-on-demand: stops when idle, wakes on events). */
  start(): void {
    this.cameraController.reportScale();
    // Wake the loop whenever the camera controller marks the view as dirty.
    this.cameraController.setViewDirtyCallback(() => this.renderLoop?.wakeUp());
    this.renderLoop = createRenderLoop({
      isDirty: () => {
        // Keep rendering while fly mode keys are pressed
        if (this.cameraController.isFlyMode && this.flyKeyboard.isAnyKeyPressed()) {
          return true;
        }
        return this.sceneDirty || this.cameraController.isViewDirty;
      },
      onRender: () => {
        const now = performance.now();
        // Process fly movement each frame
        if (this.cameraController.isFlyMode && this.flyKeyboard.isAnyKeyPressed()) {
          const dt = this.lastFrameTime > 0 ? Math.min((now - this.lastFrameTime) / 1000, 0.1) : 0.016;
          const mv = this.flyKeyboard.getMovementVector();
          this.cameraController.flyMove(mv.forward, mv.right, mv.up, dt, mv.sprint);
        }
        this.lastFrameTime = now;
        this.renderFrame();
      },
      onDirtyCleared: () => {
        this.sceneDirty = false;
        this.cameraController.isViewDirty = false;
      },
    });
    this.renderLoop.start();
  }

  /** Stop the render loop. */
  stop(): void {
    this.renderLoop?.stop();
    this.renderLoop = null;
  }

  /** Clear the vertex data cache so the next uploadRoadVertices triggers auto-fit.
   * Call this when switching to a completely new project. */
  clearVertexCache(): void {
    this.lastVertexData = null;
  }

  /** Dispose all GPU resources. */
  dispose(): void {
    // Mark as disposed first so any in-flight async init() bails out.
    this.disposed = true;
    this.stop();
    this.flyKeyboard.detach();
    this.mouseControlsCleanup?.();
    this.mouseControlsCleanup = null;
    disposeMeshes(this.meshes);
    disposeMeshes(this.laneLineMeshes);
    disposeMeshes(this.overlayMeshes);
    disposeMeshes(this.pointCloudMeshes);
    this.markerRenderer.dispose();
    disposeMeshes(this.highlightMeshes);
    disposeMeshes(this.linkHighlightMeshes);
    disposeMeshes(this.hoverMeshes);
    this.depthTexture?.destroy();
    this.msaaTexture?.destroy();
    this.gridUniformBuffer?.destroy();
    this.basicUniformBuffer?.destroy();
    this.spriteRenderer?.destroy();
    this.textureManager?.destroy();
    // Release the canvas from this device so a subsequent renderer can
    // configure it cleanly without a device-mismatch error.
    this.context?.unconfigure();
    this.device?.destroy();
  }

  // --- Private ---

  private renderFrame(): void {
    renderFrameImpl(this as unknown as RendererFrameInternals);
  }

  private createGridPipeline(): void {
    const result = createGridPipelineFn(this.device, this.format);
    this.gridPipeline = result.pipeline;
    this.gridBindGroup = result.bindGroup;
    this.gridUniformBuffer = result.uniformBuffer;
  }

  private createBasicPipeline(): void {
    const result = createBasicPipelines(this.device, this.format);
    this.basicShaderModule = result.shaderModule;
    this.basicPipeline = result.pipeline;
    this.highlightPipeline = result.highlightPipeline;
    this.basicBindGroup = result.bindGroup;
    this.basicBindGroupLayout = result.bindGroupLayout;
    this.basicUniformBuffer = result.uniformBuffer;
  }

  // @internal Pipeline factories available for future use
  // These create pipelines with different vertex layouts (LineVertex, BillboardVertex)

  private _laneLinePipeline: GPURenderPipeline | null = null;
  private _billboardPipeline: GPURenderPipeline | null = null;

  /** Create lane line pipeline (LineVertex layout: 10 floats). Lazy-created. */
  createLaneLinePipeline(): GPURenderPipeline {
    if (this._laneLinePipeline) return this._laneLinePipeline;
    this._laneLinePipeline = createLaneLinePipelineFn(this.device, this.format, this.basicShaderModule);
    return this._laneLinePipeline;
  }

  /** Create billboard pipeline (BillboardVertex layout: 11 floats). Lazy-created. */
  createBillboardPipeline(): GPURenderPipeline {
    if (this._billboardPipeline) return this._billboardPipeline;
    this._billboardPipeline = createBillboardPipelineFn(this.device, this.format, this.basicShaderModule);
    return this._billboardPipeline;
  }

  /** Initialize the texture manager and sprite renderer. */
  private manifestReady: Promise<void> = Promise.resolve();

  private initSpriteRenderer(): void {
    this.textureManager = new TextureManager(this.device);
    this.spriteRenderer = new SpriteRenderer(this.device, this.textureManager);
    this.spriteRenderer.init(this.format);
    // Ensure asset URL resolver is ready before loading manifest
    this.manifestReady = initAssetResolver().then(() =>
      this.textureManager!.loadManifest()
    ).then(() => {
      console.info('[Renderer] Texture manifest loaded');
    });
  }

  /** Wait until texture manifest is loaded. */
  async waitForManifest(): Promise<void> {
    return this.manifestReady;
  }

  /** Upload billboard sprite data (traffic lights, road signs). */
  uploadSpriteData(sprites: SpriteInstance[]): void {
    if (!this.spriteRenderer) return;
    this.spriteRenderer.uploadSprites(sprites);
    this.markSceneDirty();
  }

  /** Upload road paint textured quad data. */
  uploadPaintData(paints: PaintInstance[]): void {
    if (!this.spriteRenderer) return;
    this.spriteRenderer.uploadPaints(paints);
    this.markSceneDirty();
  }

  /** Get the texture manager (for resolving signal type → texture URL). */
  getTextureManager(): TextureManager | null {
    return this.textureManager;
  }

  private setupMouseControls(canvas: HTMLCanvasElement): void {
    this.mouseControlsCleanup = setupRendererInput(canvas, {
      cameraController: this.cameraController,
      markerRenderer: this.markerRenderer,
      flyKeyboard: this.flyKeyboard,
      getRenderLoop: () => this.renderLoop,
      pickControlPointAtScreen: (sx, sy) => this.pickControlPointAtScreen(sx, sy),
      refreshSplineMarkers: (hovered, selected) => this.refreshSplineMarkers(hovered, selected),
      onControlPointHovered: () => this.onControlPointHovered,
      markSceneDirty: () => this.markSceneDirty(),
    });
  }

  /** Lock camera controls (pan/orbit/zoom) — used during spline knot dragging. */
  lockCamera(): void {
    this.cameraController.lock();
  }

  /** Unlock camera controls. */
  unlockCamera(): void {
    this.cameraController.unlock();
  }

  /** True while the user is panning/orbiting with a mouse button held down. */
  get pointerDragging(): boolean {
    return this.cameraController.pointerDragging;
  }

  /** True while the camera is in free-roaming fly/pilot mode. */
  get isFlyMode(): boolean {
    return this.cameraController.isFlyMode;
  }

  /** Current fly speed in meters per second (for status bar display). */
  get flySpeed(): number {
    return this.cameraController.flySpeed;
  }

  /** Return the distance from camera to its target point. */
  getCameraDistance(): number {
    return this.cameraController.getCameraDistance();
  }

  /** Apply a screen-space pan delta (client pixel coordinates). Used by touch gesture handler. */
  applyPan(canvas: HTMLCanvasElement, prevClientXY: [number, number], currClientXY: [number, number]): void {
    this.cameraController.applyPan(canvas, prevClientXY, currClientXY);
  }

  /** Apply a zoom scale factor (>1 zooms out, <1 zooms in). Used by touch pinch gesture handler. */
  applyZoomFactor(factor: number): void {
    this.cameraController.applyZoomFactor(factor);
  }
}

