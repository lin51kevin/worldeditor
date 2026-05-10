/**
 * 返回所有样条切线控制点（白点）的世界坐标及其 knot 索引和端点类型。
 * 用于前端命中检测和拖拽。
 *
 * @param knots 样条节点数组 [x, y, z][]
 * @param tangentOverrides 手动切线覆盖 { [knotIndex]: [tx, ty, tz] }
 * @returns Array<{ knotIndex: number, type: 'in' | 'out', x: number, y: number, z: number }>
 */
export function getSplineHandlePoints(
  knots: Array<[number, number, number]>,
  tangentOverrides?: Record<number, [number, number, number]>,
): Array<{ knotIndex: number, type: 'in' | 'out', x: number, y: number, z: number }> {
  const result: Array<{ knotIndex: number, type: 'in' | 'out', x: number, y: number, z: number }> = [];
  if (knots.length < 2) return result;
  // Catmull-Rom/Hermite 切线 (可被 tangentOverrides 覆盖)
  const tangentAt = (i: number): [number, number, number] => {
    if (tangentOverrides && i in tangentOverrides) return tangentOverrides[i]!;
    const n = knots.length;
    if (n === 1) return [0, 0, 0];
    if (i === 0) return [knots[1]![0] - knots[0]![0], knots[1]![1] - knots[0]![1], knots[1]![2] - knots[0]![2]];
    if (i === n - 1) return [knots[n - 1]![0] - knots[n - 2]![0], knots[n - 1]![1] - knots[n - 2]![1], knots[n - 1]![2] - knots[n - 2]![2]];
    return [0.5 * (knots[i + 1]![0] - knots[i - 1]![0]), 0.5 * (knots[i + 1]![1] - knots[i - 1]![1]), 0.5 * (knots[i + 1]![2] - knots[i - 1]![2])];
  };
  for (let i = 0; i < knots.length; i++) {
    const [kx, ky, kz] = knots[i]!;
    const [tvx, tvy] = tangentAt(i);
    const tLen = Math.hypot(tvx, tvy);
    if (tLen < 1e-6) continue;
    // Clamp visual handle length与渲染一致
    const scale = Math.min(4.0 / tLen, 0.3);
    // out 端点
    result.push({ knotIndex: i, type: 'out', x: kx + tvx * scale, y: ky + tvy * scale, z: kz });
    // in 端点
    result.push({ knotIndex: i, type: 'in', x: kx - tvx * scale, y: ky - tvy * scale, z: kz });
  }
  return result;
}
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

// WGSL shaders (same logic as crates/we-render/src/shaders/)
const GRID_SHADER = `
struct Uniforms {
  view_proj: mat4x4<f32>,
  camera_pos: vec3<f32>,
  grid_scale: f32,
  grid_color: vec3<f32>,
  cam_dist: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexOutput {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) world_pos: vec3<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> VertexOutput {
  let size = 10000.0;
  var positions = array<vec2<f32>, 6>(
    vec2<f32>(-size, -size),
    vec2<f32>( size, -size),
    vec2<f32>( size,  size),
    vec2<f32>(-size, -size),
    vec2<f32>( size,  size),
    vec2<f32>(-size,  size),
  );
  let pos2d = positions[idx];
  let world_pos = vec3<f32>(pos2d.x, pos2d.y, 0.0);
  var out: VertexOutput;
  out.clip_position = uniforms.view_proj * vec4<f32>(world_pos, 1.0);
  out.world_pos = world_pos;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  let scale = uniforms.grid_scale;
  let coord = in.world_pos.xy / scale;
  let grid = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
  let line = min(grid.x, grid.y);
  let alpha = 1.0 - min(line, 1.0);
  let dist = length(in.world_pos.xy - uniforms.camera_pos.xy);
  let fade_radius = uniforms.cam_dist * 2.0;
  let fade_start = fade_radius * 0.4;
  let fade_end = fade_radius;
  let fade = 1.0 - smoothstep(fade_start, fade_end, dist);
  let axis_width = 0.02 * scale;
  var color = uniforms.grid_color;
  if (abs(in.world_pos.x) < axis_width) { color = vec3<f32>(0.2, 0.7, 0.2); }
  if (abs(in.world_pos.y) < axis_width) { color = vec3<f32>(0.7, 0.2, 0.2); }
  return vec4<f32>(color, alpha * fade * 0.85);
}
`;

const BASIC_SHADER = `
struct Uniforms {
  view_proj: mat4x4<f32>,
  model: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) color: vec4<f32>,
};

struct VertexOutput {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) color: vec4<f32>,
};

@vertex
fn vs_main(vertex: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  out.clip_position = uniforms.view_proj * uniforms.model * vec4<f32>(vertex.position, 1.0);
  out.color = vertex.color;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  return in.color;
}
`;

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

/** Traffic signal data (billboard icon). */
export interface SignalData {
  x: number;
  y: number;
  z: number;
  iconType: string;
  rotation: number;
  scale: number;
}

/** Road object data (3D geometry). */
export interface ObjectData {
  x: number;
  y: number;
  z: number;
  objectType: string;
  rotation: number;
  width: number;
  height: number;
  depth: number;
}

/** Marking edge data. */
export interface MarkingData {
  vertices: Float32Array;
  markType: string;
  color: [number, number, number, number];
}

export type MouseDragAction = 'pan' | 'orbit';

export function resolveMouseDragAction(
  button: number,
  modifiers: Pick<MouseEvent, 'ctrlKey' | 'shiftKey'>,
): MouseDragAction | null {
  if (button === 2) return 'orbit';
  if (button === 1) return 'pan';
  if (button !== 0) return null;
  return modifiers.ctrlKey || modifiers.shiftKey ? 'orbit' : 'pan';
}

function mouseButtonMask(button: number): number {
  switch (button) {
    case 0:
      return 1;
    case 1:
      return 4;
    case 2:
      return 2;
    default:
      return 0;
  }
}

export function computeGroundPanOffset(
  previous: { x: number; y: number } | null,
  current: { x: number; y: number } | null,
): { x: number; y: number } | null {
  if (!previous || !current) return null;
  return {
    x: previous.x - current.x,
    y: previous.y - current.y,
  };
}

export class ViewportRenderer {
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private format!: GPUTextureFormat;
  private depthTexture!: GPUTexture;

  // Pipelines
  private gridPipeline!: GPURenderPipeline;
  private gridBindGroup!: GPUBindGroup;
  private gridUniformBuffer!: GPUBuffer;
  private basicPipeline!: GPURenderPipeline;
  private highlightPipeline!: GPURenderPipeline;
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
  private splinePreviewMeshes: RenderableMesh[] = [];
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

  // Visibility flags for grid/axis
  private showGrid = true;
  private showAxis = true;

  // Theme colors
  private clearColor: { r: number; g: number; b: number; a: number } = { r: 0.10, g: 0.10, b: 0.12, a: 1.0 };
  private gridColor: [number, number, number] = [0.50, 0.50, 0.50];

  // Selection highlight mesh
  private highlightMeshes: RenderableMesh[] = [];

  // Last uploaded vertex data (needed for zoomToFit re-trigger)
  private lastVertexData: Float32Array | null = null;

  // Grid spacing in world units (1 cell = gridSpacing meters), auto-set from data extent
  private gridSpacing = 10.0;

  // Pre-allocated uniform buffers (avoid per-frame GC)
  private gridUniformData = new Float32Array(24);
  private basicUniformData = new Float32Array(32);

  // Matrix inverse cache (avoid redundant inversion on static camera)
  private cachedViewProj: Float32Array | null = null;
  private cachedInverseViewProj: Float32Array | null = null;

  // Callback invoked after data load or camera changes
  private onScaleChange: ((info: { gridSpacing: number; mpp: number }) => void) | null = null;

  /** Register a callback invoked on data load or camera change with grid info. */
  setScaleChangeCallback(cb: (info: { gridSpacing: number; mpp: number }) => void): void {
    this.onScaleChange = cb;
    this.reportScale();
  }

  /** Compute current meters-per-pixel (perspective approximation at target distance). */
  private getMetersPerPixel(): number {
    const [px, py, pz] = this.camera.position;
    const [tx, ty, tz] = this.camera.target;
    const camDist = Math.sqrt((px - tx) ** 2 + (py - ty) ** 2 + (pz - tz) ** 2);
    const halfWorldWidth = camDist * Math.tan(this.camera.fovY / 2);
    return (halfWorldWidth * 2) / Math.max(1, this.width);
  }

  private reportScale(): void {
    this.onScaleChange?.({ gridSpacing: this.gridSpacing, mpp: this.getMetersPerPixel() });
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
    this.createGridPipeline();
    this.createBasicPipeline();
    this.setupMouseControls(canvas);

    return true;
  }

  /** Upload road vertex data (7 floats per vertex: x,y,z,r,g,b,a). */
  uploadRoadVertices(vertexData: Float32Array): void {
    // Clear old meshes
    for (const m of this.meshes) {
      m.vertexBuffer.destroy();
    }
    this.meshes = [];

    if (vertexData.length === 0) return;

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

    // Auto-fit camera to the uploaded geometry
    this.fitToVertices(vertexData);
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

  /** Set visibility of the grid. */
  setShowGrid(show: boolean): void {
    this.showGrid = show;
  }

  /** Set visibility of the axis indicator. */
  setShowAxis(show: boolean): void {
    this.showAxis = show;
  }

  /** Set the WebGPU clear (background) color. */
  setClearColor(r: number, g: number, b: number): void {
    this.clearColor = { r, g, b, a: 1.0 };
  }

  /** Set the grid line color. */
  setGridColor(r: number, g: number, b: number): void {
    this.gridColor = [r, g, b];
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
    this.disposeMeshes(this.splinePreviewMeshes);
    if (knots.length === 0) return;

    const vertices: number[] = [];
    const zOffset = 0.15;
    const STEPS = 24;

    // Colors
    const cR = 1.0, cG = 0.55, cB = 0.0, cA = 1.0;  // orange curve
    const mR = 1.0, mG = 1.0, mB = 0.0, mA = 1.0;   // yellow knot marker
    const tR = 0.7, tG = 0.7, tB = 0.7, tA = 0.85;  // gray tangent handle line
    const hR = 1.0, hG = 1.0, hB = 1.0, hA = 0.9;   // white handle endpoint dot

    // Compute Catmull-Rom tangent at knot index i (with manual override support)
    const tangentAt = (i: number): [number, number, number] => {
      if (tangentOverrides && i in tangentOverrides) return tangentOverrides[i]!;
      const n = knots.length;
      if (n === 1) return [0, 0, 0];
      if (i === 0) return [knots[1]![0] - knots[0]![0], knots[1]![1] - knots[0]![1], knots[1]![2] - knots[0]![2]];
      if (i === n - 1) return [knots[n - 1]![0] - knots[n - 2]![0], knots[n - 1]![1] - knots[n - 2]![1], knots[n - 1]![2] - knots[n - 2]![2]];
      return [0.5 * (knots[i + 1]![0] - knots[i - 1]![0]), 0.5 * (knots[i + 1]![1] - knots[i - 1]![1]), 0.5 * (knots[i + 1]![2] - knots[i - 1]![2])];
    };

    // Hermite interpolation between p1 and p2 using explicit tangents m1, m2
    const hermiteInterp = (
      p1: [number, number, number], m1: [number, number, number],
      p2: [number, number, number], m2: [number, number, number],
      t: number,
    ): [number, number, number] => {
      const t2 = t * t, t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      return [
        h00 * p1[0] + h10 * m1[0] + h01 * p2[0] + h11 * m2[0],
        h00 * p1[1] + h10 * m1[1] + h01 * p2[1] + h11 * m2[1],
        h00 * p1[2] + h10 * m1[2] + h01 * p2[2] + h11 * m2[2],
      ];
    };

    // Emit a thick quad (two triangles) between two 2D points at fixed z
    const addQuad = (
      ax: number, ay: number, bx: number, by: number, z: number,
      hw: number, r: number, g: number, b: number, a: number,
    ) => {
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) return;
      const px = (-dy / len) * hw, py = (dx / len) * hw;
      vertices.push(ax - px, ay - py, z, r, g, b, a);
      vertices.push(ax + px, ay + py, z, r, g, b, a);
      vertices.push(bx + px, by + py, z, r, g, b, a);
      vertices.push(ax - px, ay - py, z, r, g, b, a);
      vertices.push(bx + px, by + py, z, r, g, b, a);
      vertices.push(bx - px, by - py, z, r, g, b, a);
    };

    // Emit an axis-aligned square centred at (cx, cy, z)
    const addSquare = (
      cx: number, cy: number, z: number, half: number,
      r: number, g: number, b: number, a: number,
    ) => {
      vertices.push(cx - half, cy - half, z, r, g, b, a);
      vertices.push(cx + half, cy - half, z, r, g, b, a);
      vertices.push(cx + half, cy + half, z, r, g, b, a);
      vertices.push(cx - half, cy - half, z, r, g, b, a);
      vertices.push(cx + half, cy + half, z, r, g, b, a);
      vertices.push(cx - half, cy + half, z, r, g, b, a);
    };

    // --- 1. Smooth Hermite curve (Catmull-Rom with manual tangent overrides) ---
    if (knots.length >= 2) {
      let prev: [number, number, number] | null = null;
      for (let i = 0; i < knots.length - 1; i++) {
        const p1 = knots[i]!;
        const p2 = knots[i + 1]!;
        const m1 = tangentAt(i);
        const m2 = tangentAt(i + 1);
        for (let s = 0; s <= STEPS; s++) {
          const pt = hermiteInterp(p1, m1, p2, m2, s / STEPS);
          if (prev) addQuad(prev[0], prev[1], pt[0], pt[1], zOffset, 0.2, cR, cG, cB, cA);
          prev = pt;
        }
      }
    }

    // --- 2. Tangent handles (displayed when >= 2 knots) ---
    if (knots.length >= 2) {
      const handleZ = zOffset + 0.02;
      for (let i = 0; i < knots.length; i++) {
        const [kx, ky] = knots[i]!;
        const [tvx, tvy] = tangentAt(i);
        const tLen = Math.hypot(tvx, tvy);
        if (tLen < 1e-6) continue;
        // Clamp visual handle length to ~4 m world units
        const scale = Math.min(4.0 / tLen, 0.3);
        const hx1 = kx + tvx * scale, hy1 = ky + tvy * scale;
        const hx2 = kx - tvx * scale, hy2 = ky - tvy * scale;
        addQuad(hx2, hy2, hx1, hy1, handleZ, 0.08, tR, tG, tB, tA);
        addSquare(hx1, hy1, handleZ + 0.01, 0.25, hR, hG, hB, hA);
        addSquare(hx2, hy2, handleZ + 0.01, 0.25, hR, hG, hB, hA);
      }
    }

    // --- 3. Knot markers on top ---
    for (const [kx, ky, kz] of knots) {
      addSquare(kx, ky, kz + zOffset + 0.04, 0.5, mR, mG, mB, mA);
    }

    if (vertices.length === 0) return;
    const vertexData = new Float32Array(vertices);
    const buffer = this.device.createBuffer({
      size: vertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(buffer.getMappedRange()).set(vertexData);
    buffer.unmap();
    this.splinePreviewMeshes.push({ vertexBuffer: buffer, vertexCount: vertices.length / 7 });
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

    // Place camera above the center, looking down at 45° angle
    const dist = maxExtent * 0.8;
    this.camera.target = [cx, cy, cz];
    this.camera.position = [cx, cy - dist * 0.5, cz + dist];
    this.camera.near = Math.max(0.1, maxExtent * 0.001);
    this.camera.far = Math.max(100000, maxExtent * 10);
    this.reportScale();
  }

  /** Resize the viewport. */
  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.width = width;
    this.height = height;
    this.depthTexture?.destroy();
    this.createDepthTexture();
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

  /** Dispose all GPU resources. */
  dispose(): void {
    // Mark as disposed first so any in-flight async init() bails out.
    this.disposed = true;
    this.stop();
    this.disposeMeshes(this.meshes);
    this.disposeMeshes(this.laneLineMeshes);
    this.disposeMeshes(this.splinePreviewMeshes);
    this.disposeMeshes(this.highlightMeshes);
    this.depthTexture?.destroy();
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

    const viewProj = this.computeViewProj();

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
    this.device.queue.writeBuffer(this.gridUniformBuffer, 0, gridData);

    // Update basic uniforms (128 bytes: mat4x4 view_proj + mat4x4 model)
    const basicData = this.basicUniformData;
    basicData.set(viewProj, 0);
    // Identity model matrix
    basicData[16] = 1; basicData[21] = 1; basicData[26] = 1; basicData[31] = 1;
    this.device.queue.writeBuffer(this.basicUniformBuffer, 0, basicData);

    const encoder = this.device.createCommandEncoder();

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: texture.createView(),
        clearValue: this.clearColor,
        loadOp: 'clear',
        storeOp: 'store',
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
      pass.setPipeline(this.basicPipeline);
      pass.setBindGroup(0, this.basicBindGroup);
      for (const mesh of this.laneLineMeshes) {
        pass.setVertexBuffer(0, mesh.vertexBuffer);
        pass.draw(mesh.vertexCount);
      }
    }

    // Draw spline preview on top (knot markers + connecting lines)
    if (this.splinePreviewMeshes.length > 0) {
      pass.setPipeline(this.basicPipeline);
      pass.setBindGroup(0, this.basicBindGroup);
      for (const mesh of this.splinePreviewMeshes) {
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
  }

  private computeViewProj(): Float32Array {
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
    return multiplyMatrices(correction, multiplyMatrices(proj, view));
  }

  private createDepthTexture(): void {
    this.depthTexture = this.device.createTexture({
      size: [this.width, this.height],
      format: 'depth32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  private createGridPipeline(): void {
    const shader = this.device.createShaderModule({ code: GRID_SHADER });

    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      }],
    });

    this.gridUniformBuffer = this.device.createBuffer({
      size: 96, // mat4x4 + vec3 + f32 + vec3 + f32(pad)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.gridBindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{
        binding: 0,
        resource: { buffer: this.gridUniformBuffer },
      }],
    });

    this.gridPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: { module: shader, entryPoint: 'vs_main' },
      fragment: {
        module: shader,
        entryPoint: 'fs_main',
        targets: [{
          format: this.format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
          },
        }],
      },
      depthStencil: {
        format: 'depth32float',
        depthWriteEnabled: false,
        depthCompare: 'less-equal',
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  private createBasicPipeline(): void {
    const shader = this.device.createShaderModule({ code: BASIC_SHADER });

    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'uniform' },
      }],
    });

    this.basicUniformBuffer = this.device.createBuffer({
      size: 128, // 2 * mat4x4
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.basicBindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{
        binding: 0,
        resource: { buffer: this.basicUniformBuffer },
      }],
    });

    this.basicPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: {
        module: shader,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 28, // 7 * 4 bytes
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },  // position
            { shaderLocation: 1, offset: 12, format: 'float32x4' }, // color
          ],
        }],
      },
      fragment: {
        module: shader,
        entryPoint: 'fs_main',
        targets: [{
          format: this.format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
          },
        }],
      },
      depthStencil: {
        format: 'depth32float',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
      primitive: { topology: 'triangle-list' },
    });

    // Highlight is drawn after road surface; disable depth writes and allow
    // equal-depth fragments so coplanar highlights remain visible.
    this.highlightPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: {
        module: shader,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 28, // 7 * 4 bytes
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },  // position
            { shaderLocation: 1, offset: 12, format: 'float32x4' }, // color
          ],
        }],
      },
      fragment: {
        module: shader,
        entryPoint: 'fs_main',
        targets: [{
          format: this.format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
          },
        }],
      },
      depthStencil: {
        format: 'depth32float',
        depthWriteEnabled: false,
        depthCompare: 'less-equal',
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  // @internal Pipeline factories available for future use
  // These create pipelines with different vertex layouts (LineVertex, BillboardVertex)

  private _laneLinePipeline: GPURenderPipeline | null = null;
  private _billboardPipeline: GPURenderPipeline | null = null;

  /** Create lane line pipeline (LineVertex layout: 10 floats). Lazy-created. */
  createLaneLinePipeline(): GPURenderPipeline {
    if (this._laneLinePipeline) return this._laneLinePipeline;
    const shader = this.device.createShaderModule({ code: BASIC_SHADER });
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'uniform' },
      }],
    });
    const pipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: {
        module: shader, entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 40, // LineVertex: 3(pos) + 2(uv) + 4(color) + 1(thickness)
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x4' },
          ],
        }],
      },
      fragment: {
        module: shader, entryPoint: 'fs_main',
        targets: [{ format: this.format, blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
        }}],
      },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
      primitive: { topology: 'triangle-list' },
    });
    this._laneLinePipeline = pipeline;
    return pipeline;
  }

  /** Create billboard pipeline (BillboardVertex layout: 11 floats). Lazy-created. */
  createBillboardPipeline(): GPURenderPipeline {
    if (this._billboardPipeline) return this._billboardPipeline;
    const shader = this.device.createShaderModule({ code: BASIC_SHADER });
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'uniform' },
      }],
    });
    const pipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: {
        module: shader, entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 44, // BillboardVertex: 3(pos) + 2(uv) + 4(color) + 1(rotation) + 1(scale)
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x4' },
          ],
        }],
      },
      fragment: {
        module: shader, entryPoint: 'fs_main',
        targets: [{ format: this.format, blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
        }}],
      },
      depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'less' },
      primitive: { topology: 'triangle-list' },
    });
    this._billboardPipeline = pipeline;
    return pipeline;
  }
  private setupMouseControls(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('mousedown', (e) => {
      if (this._cameraLocked) return;
      const action = resolveMouseDragAction(e.button, e);
      if (!action) return;
      this.isDragging = true;
      this.activeMouseButton = e.button;
      this.activeDragAction = action;
      this.lastMouse = [e.clientX, e.clientY];
    });

    canvas.addEventListener('mousemove', (e) => {
      if (!this.isDragging || this.activeMouseButton === null) return;
      const requiredMask = mouseButtonMask(this.activeMouseButton);
      if (requiredMask !== 0 && (e.buttons & requiredMask) === 0) {
        this.stopDragging();
        return;
      }
      const previousMouse = this.lastMouse;
      this.lastMouse = [e.clientX, e.clientY];

      const action = resolveMouseDragAction(this.activeMouseButton, e) ?? this.activeDragAction;
      this.activeDragAction = action;
      if (action === 'orbit') {
        const dx = (e.clientX - previousMouse[0]) * 0.005;
        const dy = (e.clientY - previousMouse[1]) * 0.005;
        this.orbit(dx, dy);
      } else if (action === 'pan') {
        this.pan(canvas, previousMouse, this.lastMouse);
      }
    });

    canvas.addEventListener('mouseup', () => { this.stopDragging(); });
    canvas.addEventListener('mouseleave', () => { this.stopDragging(); });

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

  /** Return the distance from camera to its target point. */
  getCameraDistance(): number {
    const [px, py, pz] = this.camera.position;
    const [tx, ty, tz] = this.camera.target;
    return Math.sqrt(
      (px - tx) ** 2 + (py - ty) ** 2 + (pz - tz) ** 2,
    );
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

// --- Math helpers (column-major 4x4 matrices) ---

function perspectiveMatrix(fovY: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1.0 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  // Column-major
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

function lookAtMatrix(eye: [number, number, number], center: [number, number, number], up: [number, number, number]): Float32Array {
  const zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
  let len = Math.sqrt(zx * zx + zy * zy + zz * zz);
  const z0 = zx / len, z1 = zy / len, z2 = zz / len;

  const x0t = up[1] * z2 - up[2] * z1;
  const x1t = up[2] * z0 - up[0] * z2;
  const x2t = up[0] * z1 - up[1] * z0;
  len = Math.sqrt(x0t * x0t + x1t * x1t + x2t * x2t);
  const x0 = x0t / len, x1 = x1t / len, x2 = x2t / len;

  const y0 = z1 * x2 - z2 * x1;
  const y1 = z2 * x0 - z0 * x2;
  const y2 = z0 * x1 - z1 * x0;

  // Column-major
  return new Float32Array([
    x0, y0, z0, 0,
    x1, y1, z1, 0,
    x2, y2, z2, 0,
    -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]),
    -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]),
    -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]),
    1,
  ]);
}

function multiplyMatrices(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + row]! * b[col * 4 + k]!;
      }
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/** Invert a column-major 4x4 matrix. Returns null if singular. */
function arraysEqual(a: Float32Array, b: Float32Array): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function invertMatrix4(m: Float32Array): Float32Array | null {
  const inv = new Float32Array(16);
  inv[0] = m[5]! * m[10]! * m[15]! - m[5]! * m[11]! * m[14]! - m[9]! * m[6]! * m[15]! + m[9]! * m[7]! * m[14]! + m[13]! * m[6]! * m[11]! - m[13]! * m[7]! * m[10]!;
  inv[4] = -m[4]! * m[10]! * m[15]! + m[4]! * m[11]! * m[14]! + m[8]! * m[6]! * m[15]! - m[8]! * m[7]! * m[14]! - m[12]! * m[6]! * m[11]! + m[12]! * m[7]! * m[10]!;
  inv[8] = m[4]! * m[9]! * m[15]! - m[4]! * m[11]! * m[13]! - m[8]! * m[5]! * m[15]! + m[8]! * m[7]! * m[13]! + m[12]! * m[5]! * m[11]! - m[12]! * m[7]! * m[9]!;
  inv[12] = -m[4]! * m[9]! * m[14]! + m[4]! * m[10]! * m[13]! + m[8]! * m[5]! * m[14]! - m[8]! * m[6]! * m[13]! - m[12]! * m[5]! * m[10]! + m[12]! * m[6]! * m[9]!;
  inv[1] = -m[1]! * m[10]! * m[15]! + m[1]! * m[11]! * m[14]! + m[9]! * m[2]! * m[15]! - m[9]! * m[3]! * m[14]! - m[13]! * m[2]! * m[11]! + m[13]! * m[3]! * m[10]!;
  inv[5] = m[0]! * m[10]! * m[15]! - m[0]! * m[11]! * m[14]! - m[8]! * m[2]! * m[15]! + m[8]! * m[3]! * m[14]! + m[12]! * m[2]! * m[11]! - m[12]! * m[3]! * m[10]!;
  inv[9] = -m[0]! * m[9]! * m[15]! + m[0]! * m[11]! * m[13]! + m[8]! * m[1]! * m[15]! - m[8]! * m[3]! * m[13]! - m[12]! * m[1]! * m[11]! + m[12]! * m[3]! * m[9]!;
  inv[13] = m[0]! * m[9]! * m[14]! - m[0]! * m[10]! * m[13]! - m[8]! * m[1]! * m[14]! + m[8]! * m[2]! * m[13]! + m[12]! * m[1]! * m[10]! - m[12]! * m[2]! * m[9]!;
  inv[2] = m[1]! * m[6]! * m[15]! - m[1]! * m[7]! * m[14]! - m[5]! * m[2]! * m[15]! + m[5]! * m[3]! * m[14]! + m[13]! * m[2]! * m[7]! - m[13]! * m[3]! * m[6]!;
  inv[6] = -m[0]! * m[6]! * m[15]! + m[0]! * m[7]! * m[14]! + m[4]! * m[2]! * m[15]! - m[4]! * m[3]! * m[14]! - m[12]! * m[2]! * m[7]! + m[12]! * m[3]! * m[6]!;
  inv[10] = m[0]! * m[5]! * m[15]! - m[0]! * m[7]! * m[13]! - m[4]! * m[1]! * m[15]! + m[4]! * m[3]! * m[13]! + m[12]! * m[1]! * m[7]! - m[12]! * m[3]! * m[5]!;
  inv[14] = -m[0]! * m[5]! * m[14]! + m[0]! * m[6]! * m[13]! + m[4]! * m[1]! * m[14]! - m[4]! * m[2]! * m[13]! - m[12]! * m[1]! * m[6]! + m[12]! * m[2]! * m[5]!;
  inv[3] = -m[1]! * m[6]! * m[11]! + m[1]! * m[7]! * m[10]! + m[5]! * m[2]! * m[11]! - m[5]! * m[3]! * m[10]! - m[9]! * m[2]! * m[7]! + m[9]! * m[3]! * m[6]!;
  inv[7] = m[0]! * m[6]! * m[11]! - m[0]! * m[7]! * m[10]! - m[4]! * m[2]! * m[11]! + m[4]! * m[3]! * m[10]! + m[8]! * m[2]! * m[7]! - m[8]! * m[3]! * m[6]!;
  inv[11] = -m[0]! * m[5]! * m[11]! + m[0]! * m[7]! * m[9]! + m[4]! * m[1]! * m[11]! - m[4]! * m[3]! * m[9]! - m[8]! * m[1]! * m[7]! + m[8]! * m[3]! * m[5]!;
  inv[15] = m[0]! * m[5]! * m[10]! - m[0]! * m[6]! * m[9]! - m[4]! * m[1]! * m[10]! + m[4]! * m[2]! * m[9]! + m[8]! * m[1]! * m[6]! - m[8]! * m[2]! * m[5]!;

  const det = m[0]! * inv[0]! + m[1]! * inv[4]! + m[2]! * inv[8]! + m[3]! * inv[12]!;
  if (Math.abs(det) < 1e-12) return null;

  const invDet = 1.0 / det;
  for (let i = 0; i < 16; i++) inv[i] = inv[i]! * invDet;
  return inv;
}

/** Transform a 3D point by a column-major 4x4 matrix (with perspective divide). */
function transformPoint(m: Float32Array, p: [number, number, number]): [number, number, number] {
  const w = m[3]! * p[0] + m[7]! * p[1] + m[11]! * p[2] + m[15]!;
  return [
    (m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!) / w,
    (m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!) / w,
    (m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!) / w,
  ];
}

/**
 * Round x up to the nearest "nice" number in the 1-2-5 sequence.
 * e.g. niceNumber(75) → 100, niceNumber(3) → 5, niceNumber(450) → 500
 */
function niceNumber(x: number): number {
  if (x <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(x)));
  const frac = x / exp;
  if (frac <= 1) return exp;
  if (frac <= 2) return 2 * exp;
  if (frac <= 5) return 5 * exp;
  return 10 * exp;
}
