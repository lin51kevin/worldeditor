export { getSplineHandlePoints } from './splineUtils';
export type { SignalData, ObjectData, MarkingData, MouseDragAction } from './viewportTypes';
export { resolveMouseDragAction, computeGroundPanOffset } from './viewportTypes';
import { takePrewarmedGPU, returnPrewarmedGPU } from './gpuDeviceCache';
import type { PrewarmedGPU } from './gpuDeviceCache';
import { createRenderLoop } from './renderLoop';
import type { RenderLoop } from './renderLoop';
import { batchMeshes } from './meshBatcher';

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

/** Multiplier for GPU buffer allocation headroom. When a buffer needs to grow,
 *  it is allocated as `requiredBytes × GPU_BUFFER_HEADROOM`. */
const GPU_BUFFER_HEADROOM = 2.0;

/** Threshold below which an oversized GPU buffer is shrunk.
 *  If `requiredBytes < bufferSize × GPU_BUFFER_SHRINK_THRESHOLD`, the buffer
 *  is reallocated to `requiredBytes × GPU_BUFFER_HEADROOM`. */
const GPU_BUFFER_SHRINK_THRESHOLD = 0.25;

import type { ControlPointRef } from './tangentHandleController';
import {
  createGridPipeline as createGridPipelineFn,
  createBasicPipelines,
  createLaneLinePipeline as createLaneLinePipelineFn,
  createBillboardPipeline as createBillboardPipelineFn,
} from './pipelineFactory';
import { CameraController } from './cameraController';
import { MarkerRenderer } from './markerRenderer';
import { FlyKeyboardController } from './flyControls';
import type { RenderableMesh } from './markerRenderer';

export class ViewportRenderer {
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private format!: GPUTextureFormat;
  private depthTexture!: GPUTexture;
  // MSAA 4x resolve texture — render to this, then blit to the swap chain
  private msaaTexture: GPUTexture | null = null;

  // Pipelines
  private gridPipeline!: GPURenderPipeline;
  private gridBindGroup!: GPUBindGroup;
  private gridUniformBuffer!: GPUBuffer;
  private basicPipeline!: GPURenderPipeline;
  private highlightPipeline!: GPURenderPipeline;
  private basicShaderModule!: GPUShaderModule;
  private basicBindGroup!: GPUBindGroup;
  private basicUniformBuffer!: GPUBuffer;

  private cameraController = new CameraController();
  private markerRenderer = new MarkerRenderer();
  private flyKeyboard = new FlyKeyboardController();

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

  // ── Render-on-demand ────────────────────────────────────────────────────────
  // The render loop only submits GPU work when the scene is dirty (camera moved,
  // mesh data uploaded, visibility toggled, or resize).  On a completely static
  // scene the GPU is idle, saving ~85 % of idle power consumption.
  private sceneDirty = true;
  /** Timestamp of last rendered frame (for fly mode delta-time calculation). */
  private lastFrameTime = 0;

  // Visibility flags for grid/axis
  private showGrid = true;
  private showAxis = true;

  // Theme colors
  private clearColor: { r: number; g: number; b: number; a: number } = { r: 0.10, g: 0.10, b: 0.12, a: 1.0 };
  private gridColor: [number, number, number] = [0.50, 0.50, 0.50];

  // Selection highlight mesh
  private highlightMeshes: RenderableMesh[] = [];

  // Road link (predecessor/successor) highlight mesh
  private linkHighlightMeshes: RenderableMesh[] = [];

  // Hover highlight mesh (shown when mouse hovers over a road/junction)
  private hoverMeshes: RenderableMesh[] = [];

  // Last uploaded vertex data (needed for zoomToFit re-trigger)
  private lastVertexData: Float32Array | null = null;

  // When true, the next uploadVertices call with non-empty data will fitToVertices.
  private pendingFitToVertices = false;

  // Pre-allocated uniform buffers (avoid per-frame GC)
  // 28 floats = 112 bytes: mat4x4(16) + vec3(3)+f32(1) + vec3(3)+f32(1) + f32 show_grid + f32 show_axis + 2 pad
  private gridUniformData = new Float32Array(28);
  private basicUniformData = new Float32Array(32);

  // Plugin viewport overlay renderers — called after main render pass
  private overlayRenderers: Array<(ctx: { device?: GPUDevice; canvas?: HTMLCanvasElement }) => void> = [];
  private overlayCanvas: HTMLCanvasElement | null = null;

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

    let adapter: GPUAdapter | null;
    let device: GPUDevice;
    if (prewarmed) {
      adapter = prewarmed.adapter;
      device = prewarmed.device;
    } else {
      adapter = await navigator.gpu.requestAdapter();
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
    this.createDepthTexture();
    const tDepth = performance.now();
    this.createMsaaTexture();
    const tMsaa = performance.now();
    this.createGridPipeline();
    const tGrid = performance.now();
    this.createBasicPipeline();
    const tBasic = performance.now();
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
  /**
   * Reuse or allocate a GPU vertex buffer with smart grow/shrink strategy.
   *
   * Strategy:
   * - **Grow:** If existing buffer is too small, allocate 2× required bytes for headroom.
   * - **Reuse:** If buffer fits (>= requiredBytes and <= 4× requiredBytes), keep it.
   * - **Shrink:** If buffer usage drops below 25% (requiredBytes < size × 0.25),
   *   reallocate to 2× requiredBytes to release GPU memory.
   *   The 25% threshold avoids thrashing when data oscillates near a power-of-two boundary.
   */
  private getOrCreateBuffer(existingBuffer: GPUBuffer | undefined, requiredBytes: number): GPUBuffer {
    if (existingBuffer) {
      const currentSize = existingBuffer.size;
      if (currentSize >= requiredBytes && requiredBytes >= currentSize * GPU_BUFFER_SHRINK_THRESHOLD) {
        // Buffer fits well — reuse
        return existingBuffer;
      }
      // Too small or too large — destroy and reallocate
      existingBuffer.destroy();
    }
    return this.device.createBuffer({
      size: Math.ceil(requiredBytes * GPU_BUFFER_HEADROOM),
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
  }

  /** Upload vertex data into a mesh array, reusing or reallocating the GPU buffer as needed. */
  private uploadMeshData(meshes: RenderableMesh[], vertexData: Float32Array): void {
    const requiredBytes = vertexData.byteLength;
    const buffer = this.getOrCreateBuffer(meshes[0]?.vertexBuffer, requiredBytes);
    this.device.queue.writeBuffer(buffer, 0, vertexData.buffer, vertexData.byteOffset, vertexData.byteLength);

    // Destroy stale extra mesh entries
    for (let i = (meshes[0]?.vertexBuffer === buffer ? 1 : 0); i < meshes.length; i++) {
      meshes[i]!.vertexBuffer.destroy();
    }
    meshes.length = 0;
    meshes.push({
      vertexBuffer: buffer,
      vertexCount: vertexData.length / 7,
    });
  }

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
      }
      return;
    }

    this.uploadMeshData(this.meshes, vertexData);
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
    this.uploadMeshData(this.highlightMeshes, vertexData);
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
    this.uploadMeshData(this.linkHighlightMeshes, vertexData);
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
    this.uploadMeshData(this.hoverMeshes, vertexData);
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

  /** Set the WebGPU clear (background) color. */
  setClearColor(r: number, g: number, b: number): void {
    this.clearColor = { r, g, b, a: 1.0 };
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
    this.uploadMeshData(this.overlayMeshes, vertexData);
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
    this.uploadMeshData(this.laneLineMeshes, vertexData);
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
    this.createDepthTexture();
    this.createMsaaTexture();
  }

  /**
   * Mark the scene as needing a re-render.  Called automatically by upload/
   * visibility methods; external code (e.g. overlay updates) can call this too.
   */
  markSceneDirty(): void {
    this.sceneDirty = true;
    this.renderLoop?.wakeUp();
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
    this.disposeMeshes(this.meshes);
    this.disposeMeshes(this.laneLineMeshes);
    this.disposeMeshes(this.overlayMeshes);
    this.markerRenderer.dispose();
    this.disposeMeshes(this.highlightMeshes);
    this.disposeMeshes(this.linkHighlightMeshes);
    this.disposeMeshes(this.hoverMeshes);
    this.depthTexture?.destroy();
    this.msaaTexture?.destroy();
    this.gridUniformBuffer?.destroy();
    this.basicUniformBuffer?.destroy();
    // Release the canvas from this device so a subsequent renderer can
    // configure it cleanly without a device-mismatch error.
    this.context?.unconfigure();
    this.device?.destroy();
  }

  /** Helper to destroy mesh buffers. */
  private disposeMeshes(meshes: RenderableMesh[]): void {
    for (const m of meshes) {
      m.vertexBuffer.destroy();
    }
    meshes.length = 0;
  }

  // --- Private ---

  private renderFrame(): void {
    if (this.deviceLost || this.disposed) return;

    let texture: GPUTexture;
    try {
      texture = this.context.getCurrentTexture();
    } catch {
      // Canvas/context may be in an invalid state (tab hidden, resize race)
      return;
    }

    const camera = this.cameraController.state;
    const wasDirty = this.cameraController.isViewDirty;
    const viewProj = this.cameraController.computeViewProj();

    // Only update uniforms when camera has changed (skip redundant GPU writes)
    if (wasDirty) {
      // Update grid uniforms (96 bytes: mat4x4 + vec3 + f32 + vec3 + f32)
      const gridData = this.gridUniformData;
      gridData.set(viewProj, 0);
      gridData.set(camera.position, 16);
      gridData[19] = this.cameraController.currentGridSpacing;
      gridData.set(this.gridColor, 20);
      gridData[23] = this.cameraController.getGridFadeDistance();
      gridData[24] = this.showGrid ? 1.0 : 0.0;
      gridData[25] = this.showAxis ? 1.0 : 0.0;
      this.device.queue.writeBuffer(this.gridUniformBuffer, 0, gridData);

      // Update basic uniforms (128 bytes: mat4x4 view_proj + mat4x4 model)
      const basicData = this.basicUniformData;
      basicData.set(viewProj, 0);
      // Identity model matrix
      basicData[16] = 1; basicData[21] = 1; basicData[26] = 1; basicData[31] = 1;
      this.device.queue.writeBuffer(this.basicUniformBuffer, 0, basicData);
    }

    const encoder = this.device.createCommandEncoder();

    const swapChainView = texture.createView();
    const msaaView = this.msaaTexture?.createView() ?? swapChainView;
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: msaaView,
        resolveTarget: this.msaaTexture ? swapChainView : undefined,
        clearValue: this.clearColor,
        loadOp: 'clear',
        storeOp: this.msaaTexture ? 'discard' : 'store',
      }],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    // Draw grid
    if (this.showGrid || this.showAxis) {
      pass.setPipeline(this.gridPipeline);
      pass.setBindGroup(0, this.gridBindGroup);
      pass.draw(6);
    }

    // Draw road meshes (render first - on bottom)
    if (this.meshes.length > 0) {
      pass.setPipeline(this.basicPipeline);
      pass.setBindGroup(0, this.basicBindGroup);
      const batches = batchMeshes(this.meshes, 'basic');
      for (const batch of batches) {
        for (const mesh of batch.meshes) {
          pass.setVertexBuffer(0, mesh.vertexBuffer);
          pass.draw(mesh.vertexCount);
        }
      }
    }

    // Draw hover highlight (above road surface, below selection so selection overrides)
    if (this.hoverMeshes.length > 0) {
      pass.setPipeline(this.highlightPipeline);
      pass.setBindGroup(0, this.basicBindGroup);
      const batches = batchMeshes(this.hoverMeshes, 'highlight');
      for (const batch of batches) {
        for (const mesh of batch.meshes) {
          pass.setVertexBuffer(0, mesh.vertexBuffer);
          pass.draw(mesh.vertexCount);
        }
      }
    }

    // Draw road link (predecessor/successor) highlight
    if (this.linkHighlightMeshes.length > 0) {
      pass.setPipeline(this.highlightPipeline);
      pass.setBindGroup(0, this.basicBindGroup);
      const batches = batchMeshes(this.linkHighlightMeshes, 'highlight');
      for (const batch of batches) {
        for (const mesh of batch.meshes) {
          pass.setVertexBuffer(0, mesh.vertexBuffer);
          pass.draw(mesh.vertexCount);
        }
      }
    }

    // Draw selection highlight (on top of road surface, below markings)
    if (this.highlightMeshes.length > 0) {
      pass.setPipeline(this.highlightPipeline);
      pass.setBindGroup(0, this.basicBindGroup);
      const batches = batchMeshes(this.highlightMeshes, 'highlight');
      for (const batch of batches) {
        for (const mesh of batch.meshes) {
          pass.setVertexBuffer(0, mesh.vertexBuffer);
          pass.draw(mesh.vertexCount);
        }
      }
    }

    // Draw bridge/tunnel overlays (above road surface, below lane lines)
    if (this.overlayMeshes.length > 0) {
      pass.setPipeline(this.basicPipeline);
      pass.setBindGroup(0, this.basicBindGroup);
      const batches = batchMeshes(this.overlayMeshes, 'basic');
      for (const batch of batches) {
        for (const mesh of batch.meshes) {
          pass.setVertexBuffer(0, mesh.vertexBuffer);
          pass.draw(mesh.vertexCount);
        }
      }
    }

    // Draw lane lines (between road surface and markings)
    if (this.laneLineMeshes.length > 0) {
      pass.setPipeline(this.highlightPipeline);
      pass.setBindGroup(0, this.basicBindGroup);
      const batches = batchMeshes(this.laneLineMeshes, 'highlight');
      for (const batch of batches) {
        for (const mesh of batch.meshes) {
          pass.setVertexBuffer(0, mesh.vertexBuffer);
          pass.draw(mesh.vertexCount);
        }
      }
    }

    // Draw spline preview curve on top of road surface
    if (this.markerRenderer.curveMeshes.length > 0) {
      pass.setPipeline(this.basicPipeline);
      pass.setBindGroup(0, this.basicBindGroup);
      const batches = batchMeshes(this.markerRenderer.curveMeshes, 'basic');
      for (const batch of batches) {
        for (const mesh of batch.meshes) {
          pass.setVertexBuffer(0, mesh.vertexBuffer);
          pass.draw(mesh.vertexCount);
        }
      }
    }

    // Draw spline control point markers (screen-size constant squares)
    if (this.markerRenderer.markerMeshes.length > 0) {
      pass.setPipeline(this.basicPipeline);
      pass.setBindGroup(0, this.basicBindGroup);
      const batches = batchMeshes(this.markerRenderer.markerMeshes, 'basic');
      for (const batch of batches) {
        for (const mesh of batch.meshes) {
          pass.setVertexBuffer(0, mesh.vertexBuffer);
          pass.draw(mesh.vertexCount);
        }
      }
    }

    pass.end();
    try {
      this.device.queue.submit([encoder.finish()]);
    } catch {
      // Transient D3D swap-chain / device-context mismatch; skip frame.
      // This can occur during resize or when the window moves between monitors.
    }

    // Invoke plugin overlay renderers after main render pass
    if (this.overlayRenderers.length > 0) {
      const ctx = { device: this.device, canvas: this.overlayCanvas ?? undefined };
      for (const render of this.overlayRenderers) {
        try { render(ctx); } catch { /* plugin errors must not crash the render loop */ }
      }
    }
  }

  private createDepthTexture(): void {
    this.depthTexture = this.device.createTexture({
      size: [this.width, this.height],
      format: 'depth32float',
      sampleCount: 4,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  private createMsaaTexture(): void {
    this.msaaTexture = this.device.createTexture({
      size: [this.width, this.height],
      format: this.format,
      sampleCount: 4,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
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

  private setupMouseControls(canvas: HTMLCanvasElement): void {
    // Document-level move/up handlers are attached on mousedown and removed on mouseup,
    // so pan/orbit continues even when the cursor temporarily leaves the canvas.
    let onDocMove: ((e: MouseEvent) => void) | null = null;
    let onDocUp: (() => void) | null = null;

    const detachDocListeners = () => {
      if (onDocMove) { document.removeEventListener('mousemove', onDocMove); onDocMove = null; }
      if (onDocUp)   { document.removeEventListener('mouseup', onDocUp); onDocUp = null; }
    };

    const exitFlyModeCleanup = () => {
      this.flyKeyboard.detach();
      // Release pointer lock if active
      if (document.pointerLockElement === canvas) {
        document.exitPointerLock();
      }
    };

    canvas.addEventListener('mousemove', (e) => {
      if (this.cameraController.pointerDragging) return;
      if (this.markerRenderer.knotCount === 0) return;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const hit = this.pickControlPointAtScreen(sx, sy);
      if (hit?.index !== this.markerRenderer.hovered?.index || hit?.type !== this.markerRenderer.hovered?.type) {
        this.onControlPointHovered?.(hit);
        this.refreshSplineMarkers(hit, undefined);
      }
    });

    canvas.addEventListener('mousedown', (e) => {
      // If clicking on a spline control point (knot or tangent handle), skip camera
      // drag so the React geometry-edit layer can handle the interaction and
      // regenerate road mesh during drag.
      if (e.button === 0 && this.markerRenderer.knotCount >= 2) {
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const hit = this.pickControlPointAtScreen(sx, sy);
        if (hit) return;
      }

      if (!this.cameraController.beginPointerDrag(e.button, e)) return;

      // Fly mode: request pointer lock and attach keyboard controller
      if (this.cameraController.isFlyMode) {
        canvas.style.cursor = 'crosshair';
        this.flyKeyboard.attach();
        canvas.requestPointerLock?.();
        this.renderLoop?.wakeUp();
      } else {
        canvas.style.cursor = 'grabbing';
      }

      detachDocListeners();

      onDocMove = (me: MouseEvent) => {
        // In pointer-lock mode, use movementX/Y for raw deltas
        if (this.cameraController.isFlyMode) {
          this.cameraController.flyLook(me.movementX, me.movementY);
          return;
        }
        if (!this.cameraController.updatePointerDrag(canvas, me)) {
          canvas.style.cursor = '';
          detachDocListeners();
        }
      };

      onDocUp = () => {
        canvas.style.cursor = '';
        if (this.cameraController.isFlyMode) {
          exitFlyModeCleanup();
        }
        this.cameraController.endPointerDrag();
        detachDocListeners();
      };

      document.addEventListener('mousemove', onDocMove);
      document.addEventListener('mouseup', onDocUp);
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cameraController.handleWheel(e.deltaY);
    }, { passive: false });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
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

