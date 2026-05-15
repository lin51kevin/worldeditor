export { getSplineHandlePoints } from './splineUtils';
export type { SignalData, ObjectData, MarkingData, MouseDragAction } from './viewportTypes';
export { resolveMouseDragAction, computeGroundPanOffset } from './viewportTypes';

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

import { applyHandleDrag } from './tangentHandleController';
import type { ControlPointRef } from './tangentHandleController';
import {
  createGridPipeline as createGridPipelineFn,
  createBasicPipelines,
  createLaneLinePipeline as createLaneLinePipelineFn,
  createBillboardPipeline as createBillboardPipelineFn,
} from './pipelineFactory';
import { CameraController } from './cameraController';
import { MarkerRenderer } from './markerRenderer';
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

  // Road meshes
  private meshes: RenderableMesh[] = [];
  // Lane line meshes
  private laneLineMeshes: RenderableMesh[] = [];

  // Callbacks for tangent handle drag interaction (Phase 1.8)
  private onTangentChanged: ((index: number, tangent: [number, number, number]) => void) | null = null;
  private onControlPointHovered: ((ref: ControlPointRef | null) => void) | null = null;
  private onControlPointSelected: ((ref: ControlPointRef | null) => void) | null = null;
  // Active handle drag state
  private activeDragHandle: ControlPointRef | null = null;
  private width = 0;
  private height = 0;
  private animFrameId = 0;
  private deviceLost = false;
  // Set to true by dispose(); guards against async init() completing after cleanup
  private disposed = false;

  // Visibility flags for grid/axis
  private showGrid = true;
  private showAxis = true;

  // Theme colors
  private clearColor: { r: number; g: number; b: number; a: number } = { r: 0.10, g: 0.10, b: 0.12, a: 1.0 };
  private gridColor: [number, number, number] = [0.50, 0.50, 0.50];

  // Selection highlight mesh
  private highlightMeshes: RenderableMesh[] = [];

  // Hover highlight mesh (shown when mouse hovers over a road/junction)
  private hoverMeshes: RenderableMesh[] = [];

  // Last uploaded vertex data (needed for zoomToFit re-trigger)
  private lastVertexData: Float32Array | null = null;

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
    });
  }

  /** Update the list of plugin overlay render functions (sorted by order). */
  setOverlayRenderers(
    renderers: Array<(ctx: { device?: GPUDevice; canvas?: HTMLCanvasElement }) => void>,
    canvas?: HTMLCanvasElement,
  ): void {
    this.overlayRenderers = renderers;
    if (canvas) this.overlayCanvas = canvas;
  }

  /**
   * Register callbacks for tangent handle / knot drag interaction (Phase 1.8).
   * Pass null to remove a callback.
   */
  setControlPointCallbacks(callbacks: {
    onTangentChanged?: ((index: number, tangent: [number, number, number]) => void) | null;
    onControlPointHovered?: ((ref: ControlPointRef | null) => void) | null;
    onControlPointSelected?: ((ref: ControlPointRef | null) => void) | null;
  }): void {
    if ('onTangentChanged' in callbacks) this.onTangentChanged = callbacks.onTangentChanged ?? null;
    if ('onControlPointHovered' in callbacks) this.onControlPointHovered = callbacks.onControlPointHovered ?? null;
    if ('onControlPointSelected' in callbacks) this.onControlPointSelected = callbacks.onControlPointSelected ?? null;
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
    if (!ViewportRenderer.isSupported()) return false;

    const adapter = await navigator.gpu.requestAdapter();
    if (this.disposed || !adapter) return false;

    this.device = await adapter.requestDevice();
    // React StrictMode may call dispose() while awaiting the device.
    // If that happened, release the device and bail out to avoid a
    // stale renderer starting a render loop against a reconfigured canvas.
    if (this.disposed) {
      this.device.destroy();
      return false;
    }

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

    this.createDepthTexture();
    this.createMsaaTexture();
    this.createGridPipeline();
    this.createBasicPipeline();
    this.setupMouseControls(canvas);

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

  uploadRoadVertices(vertexData: Float32Array): void {
    // Track whether this is a fresh load (previously empty) to decide on auto-fit
    const wasEmpty = this.lastVertexData === null || this.lastVertexData.length === 0;

    if (vertexData.length === 0) {
      for (const m of this.meshes) { m.vertexBuffer.destroy(); }
      this.meshes = [];
      this.lastVertexData = vertexData;
      return;
    }

    this.uploadMeshData(this.meshes, vertexData);

    // Store for later zoomToFit calls
    this.lastVertexData = vertexData;

    // Auto-fit camera only on first load (when there was no geometry before)
    if (wasEmpty) {
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
  }

  /** Clear the selection highlight mesh. */
  clearHighlight(): void {
    for (const m of this.highlightMeshes) {
      m.vertexBuffer.destroy();
    }
    this.highlightMeshes = [];
  }

  /** Upload hover highlight vertex data (7 floats per vertex: x,y,z,r,g,b,a). */
  uploadHoverVertices(vertexData: Float32Array): void {
    if (vertexData.length === 0) {
      this.clearHover();
      return;
    }
    this.uploadMeshData(this.hoverMeshes, vertexData);
  }

  /** Clear the hover highlight mesh. */
  clearHover(): void {
    for (const m of this.hoverMeshes) {
      m.vertexBuffer.destroy();
    }
    this.hoverMeshes = [];
  }

  /** Set visibility of the grid. */
  setShowGrid(show: boolean): void {
    this.showGrid = show;
    this.cameraController.markDirty();
  }

  /** Set visibility of the axis indicator. */
  setShowAxis(show: boolean): void {
    this.showAxis = show;
    this.cameraController.markDirty();
  }

  /** Set the WebGPU clear (background) color. */
  setClearColor(r: number, g: number, b: number): void {
    this.clearColor = { r, g, b, a: 1.0 };
    if (this.markerRenderer.knotCount > 0) {
      this.markerRenderer.refreshSplineMarkers(this.getMetersPerPixel(), this.clearColor);
    }
  }

  /** Set the grid line color. */
  setGridColor(r: number, g: number, b: number): void {
    this.gridColor = [r, g, b];
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


  /** Upload lane line vertex data (7 floats per vertex: x,y,z,r,g,b,a). */
  uploadLaneLineVertices(vertexData: Float32Array): void {
    if (vertexData.length === 0) {
      for (const m of this.laneLineMeshes) { m.vertexBuffer.destroy(); }
      this.laneLineMeshes = [];
      return;
    }
    this.uploadMeshData(this.laneLineMeshes, vertexData);
  }

  /**
   * Upload spline knot preview geometry: Catmull-Rom smooth curve + tangent handles + knot markers.
   * Pass an empty array to clear the preview.
   * Vertex format: 7 floats per vertex (x, y, z, r, g, b, a), triangle-list.
   */
  setSplinePreviewKnots(
    knots: Array<[number, number, number]>,
    tangentOverrides?: Record<number, [number, number, number]>,
  ): void {
    this.markerRenderer.setSplinePreviewKnots(knots, tangentOverrides, this.getMetersPerPixel(), this.clearColor);
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
    this.cameraController.setViewportSize(width, height);
    this.depthTexture?.destroy();
    this.msaaTexture?.destroy();
    this.msaaTexture = null;
    this.createDepthTexture();
    this.createMsaaTexture();
  }

  /** Start the render loop. */
  start(): void {
    this.cameraController.reportScale();
    const loop = () => {
      this.renderFrame();
      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  /** Stop the render loop. */
  stop(): void {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = 0;
    }
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
    this.disposeMeshes(this.meshes);
    this.disposeMeshes(this.laneLineMeshes);
    this.markerRenderer.dispose();
    this.disposeMeshes(this.highlightMeshes);
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
      const camDist = this.cameraController.getCameraDistance();
      gridData[19] = this.cameraController.currentGridSpacing;
      gridData.set(this.gridColor, 20);
      gridData[23] = camDist; // cam_dist for fade radius calculation
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
      for (const mesh of this.meshes) {
        pass.setVertexBuffer(0, mesh.vertexBuffer);
        pass.draw(mesh.vertexCount);
      }
    }

    // Draw hover highlight (above road surface, below selection so selection overrides)
    if (this.hoverMeshes.length > 0) {
      pass.setPipeline(this.highlightPipeline);
      pass.setBindGroup(0, this.basicBindGroup);
      for (const mesh of this.hoverMeshes) {
        pass.setVertexBuffer(0, mesh.vertexBuffer);
        pass.draw(mesh.vertexCount);
      }
    }

    // Draw selection highlight (on top of road surface, below markings)
    if (this.highlightMeshes.length > 0) {
      pass.setPipeline(this.highlightPipeline);
      pass.setBindGroup(0, this.basicBindGroup);
      for (const mesh of this.highlightMeshes) {
        pass.setVertexBuffer(0, mesh.vertexBuffer);
        pass.draw(mesh.vertexCount);
      }
    }

    // Draw lane lines (between road surface and markings)
    if (this.laneLineMeshes.length > 0) {
      pass.setPipeline(this.highlightPipeline);
      pass.setBindGroup(0, this.basicBindGroup);
      for (const mesh of this.laneLineMeshes) {
        pass.setVertexBuffer(0, mesh.vertexBuffer);
        pass.draw(mesh.vertexCount);
      }
    }

    // Draw spline preview curve on top of road surface
    if (this.markerRenderer.curveMeshes.length > 0) {
      pass.setPipeline(this.basicPipeline);
      pass.setBindGroup(0, this.basicBindGroup);
      for (const mesh of this.markerRenderer.curveMeshes) {
        pass.setVertexBuffer(0, mesh.vertexBuffer);
        pass.draw(mesh.vertexCount);
      }
    }

    // Draw spline control point markers (screen-size constant squares)
    if (this.markerRenderer.markerMeshes.length > 0) {
      pass.setPipeline(this.basicPipeline);
      pass.setBindGroup(0, this.basicBindGroup);
      for (const mesh of this.markerRenderer.markerMeshes) {
        pass.setVertexBuffer(0, mesh.vertexBuffer);
        pass.draw(mesh.vertexCount);
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

    canvas.addEventListener('mousemove', (e) => {
      if (this.cameraController.pointerDragging || this.activeDragHandle) return;
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
      if (e.button === 0 && this.markerRenderer.knotCount >= 2) {
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const hit = this.pickControlPointAtScreen(sx, sy);
        if (hit && (hit.type === 'in' || hit.type === 'out')) {
          this.activeDragHandle = hit;
          this.onControlPointSelected?.(hit);
          this.refreshSplineMarkers(undefined, hit);
          canvas.style.cursor = 'crosshair';
          e.stopPropagation();

          detachDocListeners();
          onDocMove = (me: MouseEvent) => {
            if (!this.activeDragHandle) return;
            const rect2 = canvas.getBoundingClientRect();
            const sx2 = me.clientX - rect2.left;
            const sy2 = me.clientY - rect2.top;
            const world = this.unprojectToGround(sx2, sy2);
            if (!world) return;
            const newOverrides = applyHandleDrag(
              this.activeDragHandle,
              world.x,
              world.y,
              this.markerRenderer.knots,
              this.markerRenderer.tangentOverrides,
              {},
            );
            this.markerRenderer.setTangentOverrides(newOverrides.out);
            const idx = this.activeDragHandle.index;
            const tangent = newOverrides.out[idx];
            if (tangent) this.onTangentChanged?.(idx, tangent);
            const mpp = this.getMetersPerPixel();
            this.markerRenderer.refreshSplineCurve(mpp);
            this.markerRenderer.refreshSplineMarkers(mpp, this.clearColor);
          };

          onDocUp = () => {
            canvas.style.cursor = '';
            this.activeDragHandle = null;
            detachDocListeners();
          };

          document.addEventListener('mousemove', onDocMove);
          document.addEventListener('mouseup', onDocUp);
          return;
        }
      }

      if (!this.cameraController.beginPointerDrag(e.button, e)) return;
      canvas.style.cursor = 'grabbing';
      detachDocListeners();

      onDocMove = (me: MouseEvent) => {
        if (!this.cameraController.updatePointerDrag(canvas, me)) {
          canvas.style.cursor = '';
          detachDocListeners();
        }
      };

      onDocUp = () => {
        canvas.style.cursor = '';
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

