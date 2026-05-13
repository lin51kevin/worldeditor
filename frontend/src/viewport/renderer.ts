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

import { mouseButtonMask, resolveMouseDragAction, computeGroundPanOffset } from './viewportTypes';
import type { MouseDragAction } from './viewportTypes';
import {
  computeControlPointPositions,
  pickControlPoint as pickControlPointFn,
  applyHandleDrag,
} from './tangentHandleController';
import type { ControlPointRef } from './tangentHandleController';
import {
  perspectiveMatrix, lookAtMatrix, multiplyMatrices,
  arraysEqual, invertMatrix4, transformPoint, niceNumber,
} from './viewportMath';
import { buildSplineCurveVertices, buildSplineMarkerVertices } from './splineVertexBuilder';
import {
  createGridPipeline as createGridPipelineFn,
  createBasicPipelines,
  createLaneLinePipeline as createLaneLinePipelineFn,
  createBillboardPipeline as createBillboardPipelineFn,
} from './pipelineFactory';

/** Camera state for orbit controls. */
interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  fovY: number;
  near: number;
  far: number;
}

/** A mesh to render. */
interface RenderableMesh {
  vertexBuffer: GPUBuffer;
  vertexCount: number;
}

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

  // Camera
  private camera: CameraState = {
    position: [0, -100, 50],
    target: [0, 0, 0],
    up: [0, 0, 1],
    fovY: Math.PI / 4,
    near: 0.1,
    far: 100000,
  };

  // Road meshes
  private meshes: RenderableMesh[] = [];
  // Lane line meshes
  private laneLineMeshes: RenderableMesh[] = [];
  // Spline curve geometry (screen-size independent — rebuilt on knot change only)
  private splineCurveMeshes: RenderableMesh[] = [];
  // Spline marker geometry (screen-size dependent — rebuilt on zoom AND knot change)
  private splineMarkerMeshes: RenderableMesh[] = [];
  // Cached knot data so markers can be rebuilt on zoom without re-calling setSplinePreviewKnots
  private splineKnotsCache: Array<[number, number, number]> = [];
  private splineTangentCache: Record<number, [number, number, number]> | undefined = undefined;
  // Hover / selection state for control points
  private hoveredControlPoint: { index: number; type: 'knot' | 'in' | 'out' } | null = null;
  private selectedControlPoint: { index: number; type: 'knot' | 'in' | 'out' } | null = null;

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

  // Mouse interaction
  private isDragging = false;
  private activeMouseButton: number | null = null;
  private activeDragAction: MouseDragAction | null = null;
  private lastMouse: [number, number] = [0, 0];
  private _cameraLocked = false;
  private _dimension: '3d' | '2d' = '3d';

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

  // Grid spacing in world units (1 cell = gridSpacing meters), auto-set from data extent
  private gridSpacing = 10.0;

  // Pre-allocated uniform buffers (avoid per-frame GC)
  // 28 floats = 112 bytes: mat4x4(16) + vec3(3)+f32(1) + vec3(3)+f32(1) + f32 show_grid + f32 show_axis + 2 pad
  private gridUniformData = new Float32Array(28);
  private basicUniformData = new Float32Array(32);

  // Matrix inverse cache (avoid redundant inversion on static camera)
  private cachedViewProj: Float32Array | null = null;
  private cachedInverseViewProj: Float32Array | null = null;

  // Camera dirty flag — skip viewProj recomputation when camera hasn't moved
  private cameraDirty = true;
  private cachedViewProjForRender: Float32Array | null = null;

  // Callback invoked after data load or camera changes
  private onScaleChange: ((info: { gridSpacing: number; mpp: number }) => void) | null = null;

  // Guard: avoid redundant onScaleChange callbacks when values haven't changed
  private lastReportedMpp = -1;
  private lastReportedGridSpacing = -1;

  // Plugin viewport overlay renderers — called after main render pass
  private overlayRenderers: Array<(ctx: { device?: GPUDevice; canvas?: HTMLCanvasElement }) => void> = [];
  private overlayCanvas: HTMLCanvasElement | null = null;

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
    if (this.splineKnotsCache.length === 0) return null;
    const world = this.unprojectToGround(screenX, screenY);
    if (!world) return null;
    const mpp = this.getMetersPerPixel();
    const thresholdMeters = 10.0 * mpp; // 10 pixel threshold
    const positions = computeControlPointPositions(
      this.splineKnotsCache as ReadonlyArray<readonly [number, number, number]>,
      (this.splineTangentCache ?? {}) as Readonly<Record<number, readonly [number, number, number]>>,
    );
    return pickControlPointFn(world.x, world.y, positions, thresholdMeters);
  }

  /** Register a callback invoked on data load or camera change with grid info. */
  setScaleChangeCallback(cb: (info: { gridSpacing: number; mpp: number }) => void): void {
    this.onScaleChange = cb;
    this.reportScale();
  }

  /** Compute current meters-per-pixel (perspective approximation at target distance). */
  getMetersPerPixel(): number {
    const [px, py, pz] = this.camera.position;
    const [tx, ty, tz] = this.camera.target;
    const camDist = Math.sqrt((px - tx) ** 2 + (py - ty) ** 2 + (pz - tz) ** 2);
    const halfWorldWidth = camDist * Math.tan(this.camera.fovY / 2);
    return (halfWorldWidth * 2) / Math.max(1, this.width);
  }

  private reportScale(): void {
    const mpp = this.getMetersPerPixel();
    const gs = this.gridSpacing;
    // Skip callback + spline rebuild when nothing changed (e.g. pure pan)
    if (mpp === this.lastReportedMpp && gs === this.lastReportedGridSpacing) return;
    this.lastReportedMpp = mpp;
    this.lastReportedGridSpacing = gs;
    this.onScaleChange?.({ gridSpacing: gs, mpp });
    // Rebuild both curve (thinner at new zoom) and markers (screen-constant size)
    if (this.splineKnotsCache.length > 0) {
      this.refreshSplineCurve();
      this.refreshSplineMarkers();
    }
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

    this.createDepthTexture();
    this.createMsaaTexture();
    this.createGridPipeline();
    this.createBasicPipeline();
    this.setupMouseControls(canvas);

    return true;
  }

  /** Upload road vertex data (7 floats per vertex: x,y,z,r,g,b,a). */
  uploadRoadVertices(vertexData: Float32Array): void {
    // Track whether this is a fresh load (previously empty) to decide on auto-fit
    const wasEmpty = this.lastVertexData === null || this.lastVertexData.length === 0;

    // Clear old meshes
    for (const m of this.meshes) {
      m.vertexBuffer.destroy();
    }
    this.meshes = [];

    if (vertexData.length === 0) {
      this.lastVertexData = vertexData;
      return;
    }

    const buffer = this.device.createBuffer({
      size: vertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(buffer.getMappedRange()).set(vertexData);
    buffer.unmap();

    this.meshes.push({
      vertexBuffer: buffer,
      vertexCount: vertexData.length / 7, // 7 floats per vertex
    });

    // Store for later zoomToFit calls
    this.lastVertexData = vertexData;

    // Auto-fit camera only on first load (when there was no geometry before)
    if (wasEmpty) {
      this.fitToVertices(vertexData);
    }
  }

  /** Upload selection highlight vertex data (7 floats per vertex: x,y,z,r,g,b,a). */
  uploadHighlightVertices(vertexData: Float32Array): void {
    this.clearHighlight();

    if (vertexData.length === 0) return;

    const buffer = this.device.createBuffer({
      size: vertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(buffer.getMappedRange()).set(vertexData);
    buffer.unmap();

    this.highlightMeshes.push({
      vertexBuffer: buffer,
      vertexCount: vertexData.length / 7,
    });
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
    this.clearHover();

    if (vertexData.length === 0) return;

    const buffer = this.device.createBuffer({
      size: vertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(buffer.getMappedRange()).set(vertexData);
    buffer.unmap();

    this.hoverMeshes.push({
      vertexBuffer: buffer,
      vertexCount: vertexData.length / 7,
    });
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
    this.cameraDirty = true;
  }

  /** Set visibility of the axis indicator. */
  setShowAxis(show: boolean): void {
    this.showAxis = show;
    this.cameraDirty = true;
  }

  /** Set the WebGPU clear (background) color. */
  setClearColor(r: number, g: number, b: number): void {
    this.clearColor = { r, g, b, a: 1.0 };
    if (this.splineKnotsCache.length > 0) {
      this.refreshSplineMarkers();
    }
  }

  /** Set the grid line color. */
  setGridColor(r: number, g: number, b: number): void {
    this.gridColor = [r, g, b];
    this.cameraDirty = true;
  }

  /** Switch between 3D perspective and 2D top-down orthographic view. */
  setDimension(dimension: '3d' | '2d'): void {
    if (dimension === '2d') {
      // Top-down view: camera straight above target, looking down
      const [tx, ty, tz] = this.camera.target;
      const dist = Math.sqrt(
        (this.camera.position[0] - tx) ** 2 +
        (this.camera.position[1] - ty) ** 2 +
        (this.camera.position[2] - tz) ** 2,
      );
      this.camera.position = [tx, ty, tz + dist];
      this.camera.up = [0, 1, 0];
    } else {
      // 3D: restore angled view
      const [tx, ty, tz] = this.camera.target;
      const dist = Math.sqrt(
        (this.camera.position[0] - tx) ** 2 +
        (this.camera.position[1] - ty) ** 2 +
        (this.camera.position[2] - tz) ** 2,
      );
      this.camera.position = [tx, ty - dist * 0.5, tz + dist * 0.7];
      this.camera.up = [0, 0, 1];
    }
    this._dimension = dimension;
    this.cameraDirty = true;
  }

  /** Unproject a screen pixel to world-space coordinates on the Z=0 ground plane. */
  unprojectToGround(screenX: number, screenY: number): { x: number; y: number } | null {
    if (this.width === 0 || this.height === 0) return null;

    // Normalized device coordinates [-1, 1]
    const ndcX = (screenX / this.width) * 2 - 1;
    const ndcY = 1 - (screenY / this.height) * 2;

    const viewProj = this.computeViewProj();
    // Use cached inverse if viewProj hasn't changed
    if (!this.cachedViewProj || !arraysEqual(this.cachedViewProj, viewProj)) {
      this.cachedViewProj = new Float32Array(viewProj);
      const inv = invertMatrix4(viewProj);
      if (!inv) return null;
      this.cachedInverseViewProj = inv;
    }
    const inv = this.cachedInverseViewProj;
    if (!inv) return null;

    // Near and far points in world space
    const nearPt = transformPoint(inv, [ndcX, ndcY, 0]);
    const farPt = transformPoint(inv, [ndcX, ndcY, 1]);

    // Ray direction
    const dx = farPt[0] - nearPt[0];
    const dy = farPt[1] - nearPt[1];
    const dz = farPt[2] - nearPt[2];

    // Intersect with Z=0 plane
    if (Math.abs(dz) < 1e-10) return null;
    const t = -nearPt[2] / dz;
    if (t < 0) return null;

    return {
      x: nearPt[0] + dx * t,
      y: nearPt[1] + dy * t,
    };
  }

  /** Project a world-space XY point (Z=0) to canvas pixel coordinates. Returns null if off-screen. */
  projectWorldToScreen(wx: number, wy: number): { x: number; y: number } | null {
    if (this.width === 0 || this.height === 0) return null;
    const viewProj = this.computeViewProj();
    // Multiply [wx, wy, 0, 1] by viewProj (column-major)
    const x = wx, y = wy, z = 0, w = 1;
    const px = viewProj[0]! * x + viewProj[4]! * y + viewProj[8]! * z + viewProj[12]! * w;
    const py = viewProj[1]! * x + viewProj[5]! * y + viewProj[9]! * z + viewProj[13]! * w;
    const pw = viewProj[3]! * x + viewProj[7]! * y + viewProj[11]! * z + viewProj[15]! * w;
    if (Math.abs(pw) < 1e-10) return null;
    const ndcX = px / pw;
    const ndcY = py / pw;
    return {
      x: (ndcX + 1) * 0.5 * this.width,
      y: (1 - ndcY) * 0.5 * this.height,
    };
  }


  /** Upload lane line vertex data (7 floats per vertex: x,y,z,r,g,b,a). */
  uploadLaneLineVertices(vertexData: Float32Array): void {
    for (const m of this.laneLineMeshes) {
      m.vertexBuffer.destroy();
    }
    this.laneLineMeshes = [];

    if (vertexData.length === 0) return;

    const buffer = this.device.createBuffer({
      size: vertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(buffer.getMappedRange()).set(vertexData);
    buffer.unmap();

    this.laneLineMeshes.push({
      vertexBuffer: buffer,
      vertexCount: vertexData.length / 7,
    });
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
    this.disposeMeshes(this.splineCurveMeshes);
    this.disposeMeshes(this.splineMarkerMeshes);

    // Cache for zoom-driven refresh
    this.splineKnotsCache = knots;
    this.splineTangentCache = tangentOverrides;
    // Reset interaction states when knots change
    this.hoveredControlPoint = null;
    this.selectedControlPoint = null;

    if (knots.length === 0) return;

    this.refreshSplineCurve();
    this.refreshSplineMarkers();
  }

  /**
   * Rebuild the Hermite curve geometry using current mpp (called on zoom too).
   */
  private refreshSplineCurve(): void {
    this.disposeMeshes(this.splineCurveMeshes);
    const knots = this.splineKnotsCache;
    if (knots.length < 2) return;

    const curveVerts = buildSplineCurveVertices(knots, this.splineTangentCache, this.getMetersPerPixel());
    this.uploadToMeshArray(this.splineCurveMeshes, curveVerts);
  }

  /**
   * Rebuild spline control-point marker geometry with screen-space constant sizes.
   * Optionally updates hover/selection state before rebuilding.
   */
  refreshSplineMarkers(
    hovered?: { index: number; type: 'knot' | 'in' | 'out' } | null,
    selected?: { index: number; type: 'knot' | 'in' | 'out' } | null,
  ): void {
    if (hovered !== undefined) this.hoveredControlPoint = hovered;
    if (selected !== undefined) this.selectedControlPoint = selected;

    this.disposeMeshes(this.splineMarkerMeshes);
    const knots = this.splineKnotsCache;
    if (knots.length === 0) return;

    const markerVerts = buildSplineMarkerVertices(
      knots,
      this.splineTangentCache,
      this.getMetersPerPixel(),
      this.clearColor,
      this.hoveredControlPoint,
      this.selectedControlPoint,
    );
    this.uploadToMeshArray(this.splineMarkerMeshes, markerVerts);
  }

  /** Upload a vertex array into a mesh array, clearing existing meshes first. */
  private uploadToMeshArray(meshArray: RenderableMesh[], vertices: number[]): void {
    if (vertices.length === 0) return;
    const vertexData = new Float32Array(vertices);
    const buffer = this.device.createBuffer({
      size: vertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(buffer.getMappedRange()).set(vertexData);
    buffer.unmap();
    meshArray.push({ vertexBuffer: buffer, vertexCount: vertices.length / 7 });
  }

  /** Compute bounding box of vertex data and move camera to see all geometry. */
  fitToVertices(vertexData?: Float32Array): void {
    const data = vertexData ?? this.lastVertexData;
    if (!data) return;
    const stride = 7;
    const count = data.length / stride;
    if (count === 0) return;

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (let i = 0; i < count; i++) {
      const x = data[i * stride]!;
      const y = data[i * stride + 1]!;
      const z = data[i * stride + 2]!;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;

    const extentX = maxX - minX;
    const extentY = maxY - minY;
    const extentZ = maxZ - minZ;
    const maxExtent = Math.max(extentX, extentY, extentZ, 1);

    // Derive a nice grid spacing from the data extent (~10 divisions)
    this.gridSpacing = niceNumber(Math.max(maxExtent / 10, 0.5));

    // Place camera above the center, respecting the current dimension mode
    const dist = maxExtent * 0.8;
    this.camera.target = [cx, cy, cz];
    if (this._dimension === '2d') {
      this.camera.position = [cx, cy, cz + dist];
      this.camera.up = [0, 1, 0];
    } else {
      this.camera.position = [cx, cy - dist * 0.5, cz + dist];
      this.camera.up = [0, 0, 1];
    }
    this.camera.near = Math.max(0.1, maxExtent * 0.001);
    this.camera.far = Math.max(100000, maxExtent * 10);
    this.cameraDirty = true;
    this.reportScale();
  }

  /**
   * Pan the camera to center on the AABB of the given vertex data.
   * Unlike fitToVertices, the camera distance (zoom level) is preserved.
   */
  panToCenter(vertexData: Float32Array): void {
    const stride = 7;
    const count = vertexData.length / stride;
    if (count === 0) return;

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (let i = 0; i < count; i++) {
      const x = vertexData[i * stride]!;
      const y = vertexData[i * stride + 1]!;
      const z = vertexData[i * stride + 2]!;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;

    // Preserve the camera → target offset vector (keeps zoom level)
    const [px, py, pz] = this.camera.position;
    const [tx, ty, tz] = this.camera.target;
    const offsetX = px - tx;
    const offsetY = py - ty;
    const offsetZ = pz - tz;

    this.camera.target = [cx, cy, cz];
    this.camera.position = [cx + offsetX, cy + offsetY, cz + offsetZ];
    // Recalculate near/far based on the new camera distance so that objects
    // aren't clipped when the user has zoomed in before navigating.
    const camDist = Math.sqrt(offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ);
    this.camera.near = Math.max(0.1, camDist * 0.001);
    this.camera.far = Math.max(100000, camDist * 100);
    this.cameraDirty = true;
    this.reportScale();
  }

  /** Resize the viewport. */
  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.width = width;
    this.height = height;
    this.depthTexture?.destroy();
    this.msaaTexture?.destroy();
    this.msaaTexture = null;
    this.createDepthTexture();
    this.createMsaaTexture();
    this.cameraDirty = true;
  }

  /** Start the render loop. */
  start(): void {
    this.reportScale();
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
    this.disposeMeshes(this.splineCurveMeshes);
    this.disposeMeshes(this.splineMarkerMeshes);
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

    const wasDirty = this.cameraDirty;
    const viewProj = this.computeViewProj();

    // Only update uniforms when camera has changed (skip redundant GPU writes)
    if (wasDirty) {
      // Update grid uniforms (96 bytes: mat4x4 + vec3 + f32 + vec3 + f32)
      const gridData = this.gridUniformData;
      gridData.set(viewProj, 0);
      gridData.set(this.camera.position, 16);
      // Auto-scale grid based on camera distance
      const camDist = Math.sqrt(
        (this.camera.position[0] - this.camera.target[0]) ** 2 +
        (this.camera.position[1] - this.camera.target[1]) ** 2 +
        (this.camera.position[2] - this.camera.target[2]) ** 2,
      );
      // Grid scale from data extent (nice number, auto-computed in fitToVertices)
      const gridScale = this.gridSpacing;
      gridData[19] = gridScale;
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
    if (this.splineCurveMeshes.length > 0) {
      pass.setPipeline(this.basicPipeline);
      pass.setBindGroup(0, this.basicBindGroup);
      for (const mesh of this.splineCurveMeshes) {
        pass.setVertexBuffer(0, mesh.vertexBuffer);
        pass.draw(mesh.vertexCount);
      }
    }

    // Draw spline control point markers (screen-size constant squares)
    if (this.splineMarkerMeshes.length > 0) {
      pass.setPipeline(this.basicPipeline);
      pass.setBindGroup(0, this.basicBindGroup);
      for (const mesh of this.splineMarkerMeshes) {
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

  private computeViewProj(): Float32Array {
    if (!this.cameraDirty && this.cachedViewProjForRender) {
      return this.cachedViewProjForRender;
    }
    const aspect = this.width / this.height;
    const proj = perspectiveMatrix(this.camera.fovY, aspect, this.camera.near, this.camera.far);
    const view = lookAtMatrix(this.camera.position, this.camera.target, this.camera.up);
    // depth correction: wgpu uses [0,1] depth
    const correction = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 0.5, 0,
      0, 0, 0.5, 1,
    ]);
    const result = multiplyMatrices(correction, multiplyMatrices(proj, view));
    this.cachedViewProjForRender = result;
    this.cameraDirty = false;
    return result;
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
      if (onDocUp)   { document.removeEventListener('mouseup',   onDocUp);   onDocUp   = null; }
    };

    // Hover hit-test on mouse move (when not dragging camera or a handle)
    canvas.addEventListener('mousemove', (e) => {
      if (this.isDragging || this.activeDragHandle) return;
      if (this.splineKnotsCache.length === 0) return;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const hit = this.pickControlPointAtScreen(sx, sy);
      if (hit?.index !== this.hoveredControlPoint?.index || hit?.type !== this.hoveredControlPoint?.type) {
        this.hoveredControlPoint = hit;
        this.onControlPointHovered?.(hit);
        this.refreshSplineMarkers();
      }
    });

    canvas.addEventListener('mousedown', (e) => {
      // Phase 1.8: handle tangent drag on left-click when knots are displayed
      if (e.button === 0 && this.splineKnotsCache.length >= 2) {
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const hit = this.pickControlPointAtScreen(sx, sy);
        if (hit && (hit.type === 'in' || hit.type === 'out')) {
          // Start tangent handle drag
          this.activeDragHandle = hit;
          this.selectedControlPoint = hit;
          this.onControlPointSelected?.(hit);
          this.refreshSplineMarkers();
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
              this.splineKnotsCache as ReadonlyArray<readonly [number, number, number]>,
              (this.splineTangentCache ?? {}) as Readonly<Record<number, readonly [number, number, number]>>,
            );
            this.splineTangentCache = newOverrides as Record<number, [number, number, number]>;
            const idx = this.activeDragHandle.index;
            const t = newOverrides[idx];
            if (t) this.onTangentChanged?.(idx, t);
            this.refreshSplineCurve();
            this.refreshSplineMarkers();
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

      if (this._cameraLocked) return;
      const action = resolveMouseDragAction(e.button, e);
      if (!action) return;
      this.isDragging = true;
      this.activeMouseButton = e.button;
      this.activeDragAction = action;
      this.lastMouse = [e.clientX, e.clientY];
      canvas.style.cursor = 'grabbing';

      detachDocListeners(); // guard against leaked listeners

      onDocMove = (me: MouseEvent) => {
        if (!this.isDragging || this.activeMouseButton === null) return;
        const requiredMask = mouseButtonMask(this.activeMouseButton);
        if (requiredMask !== 0 && (me.buttons & requiredMask) === 0) {
          this.stopDragging();
          detachDocListeners();
          return;
        }
        const previousMouse = this.lastMouse;
        this.lastMouse = [me.clientX, me.clientY];

        const dragAction = resolveMouseDragAction(this.activeMouseButton, me) ?? this.activeDragAction;
        this.activeDragAction = dragAction;
        if (dragAction === 'orbit' && this._dimension !== '2d') {
          const dx = (me.clientX - previousMouse[0]) * 0.005;
          const dy = (me.clientY - previousMouse[1]) * 0.005;
          this.orbit(dx, dy);
        } else if (dragAction === 'pan' || (dragAction === 'orbit' && this._dimension === '2d')) {
          this.pan(canvas, previousMouse, this.lastMouse);
        }
      };

      onDocUp = () => {
        canvas.style.cursor = '';
        this.stopDragging();
        detachDocListeners();
      };

      document.addEventListener('mousemove', onDocMove);
      document.addEventListener('mouseup', onDocUp);
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.1 : 0.9;
      this.zoom(factor);
    }, { passive: false });

    // Prevent context menu on right-click
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private stopDragging(): void {
    this.isDragging = false;
    this.activeMouseButton = null;
    this.activeDragAction = null;
  }

  /** Lock camera controls (pan/orbit/zoom) — used during spline knot dragging. */
  lockCamera(): void {
    this._cameraLocked = true;
    this.stopDragging();
  }

  /** Unlock camera controls. */
  unlockCamera(): void {
    this._cameraLocked = false;
  }

  /** True while the user is panning/orbiting with a mouse button held down. */
  get pointerDragging(): boolean {
    return this.isDragging;
  }

  /** Return the distance from camera to its target point. */
  getCameraDistance(): number {
    const [px, py, pz] = this.camera.position;
    const [tx, ty, tz] = this.camera.target;
    return Math.sqrt(
      (px - tx) ** 2 + (py - ty) ** 2 + (pz - tz) ** 2,
    );
  }

  /** Apply a screen-space pan delta (client pixel coordinates). Used by touch gesture handler. */
  applyPan(canvas: HTMLCanvasElement, prevClientXY: [number, number], currClientXY: [number, number]): void {
    if (this._cameraLocked) return;
    this.pan(canvas, prevClientXY, currClientXY);
  }

  /** Apply a zoom scale factor (>1 zooms out, <1 zooms in). Used by touch pinch gesture handler. */
  applyZoomFactor(factor: number): void {
    if (this._cameraLocked) return;
    this.zoom(factor);
  }

  private orbit(dx: number, dy: number): void {
    const [px, py, pz] = this.camera.position;
    const [tx, ty, tz] = this.camera.target;
    const ox = px - tx, oy = py - ty, oz = pz - tz;
    const r = Math.sqrt(ox * ox + oy * oy + oz * oz);
    let theta = Math.atan2(oy, ox) + dx;
    let phi = Math.acos(Math.min(1, Math.max(-1, oz / r))) - dy;
    phi = Math.max(0.01, Math.min(Math.PI - 0.01, phi));

    this.camera.position = [
      tx + r * Math.sin(phi) * Math.cos(theta),
      ty + r * Math.sin(phi) * Math.sin(theta),
      tz + r * Math.cos(phi),
    ];
    this.cameraDirty = true;
    this.reportScale();
  }

  private zoom(factor: number): void {
    const MIN_CAM_DIST = 2.0;    // zoom limit: ~1m visible scale
    const MAX_CAM_DIST = 2000.0; // zoom limit: ~1000m visible scale
    const [px, py, pz] = this.camera.position;
    const [tx, ty, tz] = this.camera.target;
    const dx = tx - px, dy = ty - py, dz = tz - pz;
    const currentDist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const dist = Math.min(MAX_CAM_DIST, Math.max(MIN_CAM_DIST, currentDist * factor));
    const norm = currentDist;
    this.camera.position = [
      tx - (dx / norm) * dist,
      ty - (dy / norm) * dist,
      tz - (dz / norm) * dist,
    ];
    this.camera.near = Math.max(0.1, dist * 0.001);
    this.camera.far = Math.max(100000, dist * 100);
    this.cameraDirty = true;
    this.reportScale();
  }

  private pan(
    canvas: HTMLCanvasElement,
    previousMouse: [number, number],
    currentMouse: [number, number],
  ): void {
    const [px, py, pz] = this.camera.position;
    const [tx, ty, tz] = this.camera.target;
    const previousWorld = this.unprojectClientToGround(canvas, previousMouse);
    const currentWorld = this.unprojectClientToGround(canvas, currentMouse);
    const offset = computeGroundPanOffset(previousWorld, currentWorld);
    if (!offset) return;

    this.camera.position = [px + offset.x, py + offset.y, pz];
    this.camera.target = [tx + offset.x, ty + offset.y, tz];
    this.cameraDirty = true;
    this.reportScale();
  }

  private unprojectClientToGround(
    canvas: HTMLCanvasElement,
    clientPoint: [number, number],
  ): { x: number; y: number } | null {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const screenX = (clientPoint[0] - rect.left) * (canvas.width / rect.width);
    const screenY = (clientPoint[1] - rect.top) * (canvas.height / rect.height);
    return this.unprojectToGround(screenX, screenY);
  }
}

