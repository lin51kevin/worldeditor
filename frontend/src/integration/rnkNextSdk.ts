/**
 * rnk-next integration adapter.
 *
 * The Cybertron WebPages app embeds worldeditor-next as its road-network
 * rendering engine through a small abstraction layer it calls `rnk-next`. That
 * layer expects a runtime-injected SDK object of a fixed shape (a renderer
 * factory, a WASM compute surface, and a GeoZ importer) and registers it via
 * its own `registerWorldEditorSdk(sdk)`.
 *
 * This module builds exactly that SDK object out of worldeditor-next's existing
 * pieces:
 *   - {@link ViewportRenderer} (WebGPU) — wrapped to the renderer contract,
 *   - the `we_wasm` bindings — wrapped to the compute contract,
 *   - the GeoZ {@link importGeoZ} parser.
 *
 * Usage from the host app (WebPages), once this bundle is vendored:
 *   import { createWorldEditorSdk } from 'worldeditor-next/rnkNextSdk';
 *   import { registerWorldEditorSdk } from 'utils/rnk-next';
 *   registerWorldEditorSdk(await createWorldEditorSdk());
 *
 * The SDK is fully initialized before it is returned (WASM module instantiated),
 * so the host may call the synchronous WASM wrappers immediately.
 */
import { importGeoZ } from '../plugins/io/geoz/parser';
import { ViewportRenderer } from '../viewport/renderer';
import type { SpriteInstance, PaintInstance } from '../viewport/spriteRenderer';
import { CaseActorLayer, type CaseActorBox } from '../plugins/npc-actors';

type WasmModule = typeof import('../../wasm/pkg/we_wasm');

/** Opaque project model produced by parsing OpenDRIVE / GeoZ. */
export type WorldEditorProject = unknown;

/** Lane pick identity returned by the cached picker. */
export interface LanePick {
  roadId: string;
  sectionIndex: number;
  laneId: number;
}

/** Planar bounding box. */
export interface ProjectBounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** Texture resolver surface exposed to the host for sprite billboards. */
export interface WorldEditorTextureManager {
  resolveSignalTexture(signalType: string, signalSubtype: string, value?: string): string | null;
}

/** Sprite metadata emitted by `generate_sprite_data` (traffic lights / signs). */
export interface SpriteMeta {
  pos: [number, number, number];
  signal_type: string;
  subtype: string;
  w: number;
  h: number;
  value: string;
}

/** Paint metadata emitted by `generate_sprite_data` (road-surface painted quads). */
export interface PaintMeta {
  pos: [number, number, number];
  subtype: string;
  w: number;
  h: number;
  rot: number;
}

/** Sprite/paint bundle from `generate_sprite_data`. */
export interface SpriteDataResult {
  sprites: SpriteMeta[];
  paints: PaintMeta[];
}

/** Renderer contract consumed by rnk-next. */
export interface WorldEditorRenderer {
  init(canvas: HTMLCanvasElement): Promise<boolean>;
  dispose(): void;
  render(): void;
  markSceneDirty(): void;
  resize(width: number, height: number): Promise<void>;
  setDimension(dimension: '2d' | '3d'): void;
  set2DView(centerX: number, centerY: number, metersPerPixel: number): void;
  uploadRoadVertices(data: Float32Array): void;
  uploadLaneLineVertices(data: Float32Array): void;
  uploadHighlightVertices(data: Float32Array): void;
  clearHighlight(): void;
  unprojectToGround(screenX: number, screenY: number): { x: number; y: number } | null;
  /** Unproject a screen pixel to world-space XY on the horizontal plane at z = worldZ. */
  unprojectToPlane(screenX: number, screenY: number, worldZ: number): { x: number; y: number } | null;
  fitToVertices(data: Float32Array): void;
  toDataURL(): string;

  // ── Visual configuration (grid / axis / background) ──────────────────────
  /** Toggle the world grid overlay. */
  setShowGrid(show: boolean): void;
  /** Toggle the X/Y axis indicator overlay. */
  setShowAxis(show: boolean): void;
  /** Set the background clear color. Pass `a = 0` for a transparent canvas. */
  setClearColor(r: number, g: number, b: number, a?: number): void;

  // ── Map feature layers (markings / signs / objects / parking) ────────────
  /** Upload textured billboard sprites (traffic lights / road signs). */
  uploadSpriteData(sprites: SpriteInstance[]): void;
  /** Upload textured road-surface paint quads. */
  uploadPaintData(paints: PaintInstance[]): void;
  /** Upload bridge/tunnel overlay vertices (7 floats per vertex). */
  uploadOverlayVertices(data: Float32Array): void;
  /** Texture resolver (null until the renderer is initialized). */
  getTextureManager(): WorldEditorTextureManager | null;
  /** Resolves once the texture manifest has loaded (or failed gracefully). */
  waitForManifest(): Promise<void>;

  // ── Case-actor plugin (dynamic scenario boxes + trajectories + 3D camera) ──
  /** Replace the dynamic actor bounding boxes (opponents / ego / waypoints / triggers). */
  uploadActorBoxes(boxes: CaseActorBox[]): void;
  /** Remove all actor boxes and trajectory ribbons. */
  clearActorBoxes(): void;
  /** Upload trajectory segments (flat pairs: 14 floats per segment: 2 × xyz+rgba). */
  uploadPathLines(segments: Float32Array): void;
  /** Pick the top-most actor box under a page-space point, or null. */
  pickActor(clientX: number, clientY: number): { id: string } | null;
  /** Begin a 3D camera drag (orbit/pan/fly per button+modifiers). */
  cameraBeginDrag(
    button: number,
    event: { clientX: number; clientY: number; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean },
  ): boolean;
  /** Update the active 3D camera drag with the current pointer position. */
  cameraUpdateDrag(event: { clientX: number; clientY: number; buttons: number }): void;
  /** End the active 3D camera drag. */
  cameraEndDrag(): void;
  /** Zoom the 3D camera by a wheel delta. */
  cameraWheel(deltaY: number): void;
  /** Frame the 3D camera to fit a planar bounds (world meters). */
  frameScene3D(minX: number, minY: number, maxX: number, maxY: number): void;
  /** Recenter the 3D camera on a ground point, preserving zoom/orientation. */
  centerCamera3D(x: number, y: number): void;

  // ── Point cloud (logsim scene mesh) ──────────────────────────────────
  /**
   * Upload an interleaved point-cloud buffer (6 floats/point: x,y,z,r,g,b, as
   * produced by `point_cloud_render_buffer`). The adapter expands it to the
   * renderer's 7-float (rgba) point layout.
   */
  uploadPointCloud(data: Float32Array): void;
  /** Remove the uploaded point cloud. */
  clearPointCloud(): void;
}

/** WASM compute contract consumed by rnk-next. */
export interface WorldEditorWasm {
  parse_opendrive(xml: string): WorldEditorProject;
  generate_road_vertices(projectJson: string, sampleStep: number, colorMode: string): Float32Array;
  generate_lane_line_vertices(projectJson: string, sampleStep: number): Float32Array;
  generate_single_road_vertices(
    roadJson: string,
    sampleStep: number,
    r: number,
    g: number,
    b: number,
    a: number,
  ): Float32Array;
  set_project_cache(projectJson: string): void;
  update_cached_road(roadJson: string): void;
  pick_lane_at_point_cached(x: number, y: number, threshold: number): LanePick | null;
  generate_lane_highlight_vertices(
    roadId: string,
    sectionIndex: number,
    laneId: number,
    sampleStep: number,
  ): Float32Array;
  get_project_bounds(projectJson: string): ProjectBounds;

  // ── Map feature geometry generators ──────────────────────────────────────
  /** Junction surface polygons. */
  generate_junction_vertices(projectJson: string): Float32Array;
  /** Lane boundary lines. */
  generate_lane_boundary_vertices(projectJson: string, sampleStep: number): Float32Array;
  /** Road center / reference lines. */
  generate_center_line_vertices(projectJson: string, sampleStep: number): Float32Array;
  /** Painted road markings (arrows, stop lines, diamond markers). */
  generate_signal_paint_vertices(projectJson: string, sampleStep: number): Float32Array;
  /** Road object polygons (crosswalks, parking spaces, guardrails, etc.). */
  generate_object_vertices(projectJson: string): Float32Array;
  /** Sprite/paint metadata for textured billboard rendering (signs / lights). */
  generate_sprite_data(projectJson: string): SpriteDataResult;

  // ── Point cloud parsing (logsim scene mesh) ─────────────────────────
  /** Parse a point-cloud file (`pcd`/`ply`/`xyz`) and return an opaque handle. */
  load_point_cloud(bytes: Uint8Array, format: string): number;
  /** Free a registered cloud and its derived data. */
  free_point_cloud(handle: number): void;
  /** Summary `{ count, origin, min, max, has_intensity, has_rgb }` of a cloud. */
  point_cloud_summary(handle: number): {
    count: number;
    origin: [number, number, number];
    min: [number, number, number];
    max: [number, number, number];
    has_intensity: boolean;
    has_rgb: boolean;
  };
  /** Interleaved render buffer `[x,y,z,r,g,b, ...]`, decimated to `maxPoints`. */
  point_cloud_render_buffer(handle: number, colorMode: string, maxPoints: number): Float32Array;
}

/** GeoZ importer contract consumed by rnk-next. */
export interface WorldEditorGeoZ {
  importGeoZ(buffer: ArrayBuffer | Uint8Array, fileName?: string): Promise<WorldEditorProject>;
}

/** Full SDK injected into rnk-next at runtime. */
export interface WorldEditorSdk {
  createRenderer(): WorldEditorRenderer;
  wasm: WorldEditorWasm;
  geoz: WorldEditorGeoZ;
}

/** Options for {@link createWorldEditorSdk}. */
export interface CreateWorldEditorSdkOptions {
  /**
   * Location of the WASM binary. When the SDK is bundled and vendored into
   * another app, the package-relative default path is no longer valid, so the
   * host should pass an explicit URL (fetched) or pre-fetched bytes/module.
   * Defaults to the package-relative `we_wasm_bg.wasm`.
   */
  wasmInput?: string | URL | Request | ArrayBuffer | Uint8Array | WebAssembly.Module;
}

/** Highlight color used by the host (teal 0x52d8ba), normalized to 0..1. */
const HIGHLIGHT_RGBA: [number, number, number, number] = [0x52 / 255, 0xd8 / 255, 0xba / 255, 1];

/** Road vertex layout: x, y, z, r, g, b, a. */
const ROAD_VERTEX_STRIDE = 7;

/**
 * Expand an interleaved 6-float point buffer `[x,y,z,r,g,b, ...]` (as produced
 * by we-wasm `point_cloud_render_buffer`) into the renderer's 7-float point
 * layout `[x,y,z,r,g,b,a, ...]`, setting alpha to 1.
 */
function expandPointCloudTo7(src: Float32Array): Float32Array {
  const pointCount = Math.floor(src.length / 6);
  const dst = new Float32Array(pointCount * 7);
  for (let i = 0; i < pointCount; i++) {
    const s = i * 6;
    const d = i * 7;
    dst[d] = src[s]!;
    dst[d + 1] = src[s + 1]!;
    dst[d + 2] = src[s + 2]!;
    dst[d + 3] = src[s + 3]!;
    dst[d + 4] = src[s + 4]!;
    dst[d + 5] = src[s + 5]!;
    dst[d + 6] = 1;
  }
  return dst;
}

/** Wrap a {@link ViewportRenderer} as the rnk-next renderer contract. */
function adaptRenderer(): WorldEditorRenderer {
  const renderer = new ViewportRenderer();
  // Independent npc-actors plugin: owns box/trajectory geometry + ground picking.
  const actorLayer = new CaseActorLayer();
  let canvasRef: HTMLCanvasElement | null = null;

  /** Convert page-space client coordinates to canvas-relative pixels. */
  const toCanvasXY = (clientX: number, clientY: number): [number, number] => {
    if (!canvasRef) return [clientX, clientY];
    const rect = canvasRef.getBoundingClientRect();
    return [clientX - rect.left, clientY - rect.top];
  };

  return {
    async init(canvas: HTMLCanvasElement): Promise<boolean> {
      // Match the backing store to the element's layout size so the first frame
      // is correctly sized (the host drives subsequent resizes).
      if (canvas.clientWidth > 0 && canvas.clientHeight > 0) {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
      }
      canvasRef = canvas;
      const ok = await renderer.init(canvas);
      if (ok) renderer.setDimension('2d');
      return ok;
    },
    dispose: () => renderer.dispose(),
    render: () => renderer.render(),
    markSceneDirty: () => renderer.markSceneDirty(),
    resize: (width, height) => {
      renderer.resize(width, height);
      return Promise.resolve();
    },
    setDimension: (dimension) => renderer.setDimension(dimension),
    set2DView: (centerX, centerY, metersPerPixel) => renderer.set2DView(centerX, centerY, metersPerPixel),
    uploadRoadVertices: (data) => renderer.uploadRoadVertices(data),
    uploadLaneLineVertices: (data) => renderer.uploadLaneLineVertices(data),
    uploadHighlightVertices: (data) => renderer.uploadHighlightVertices(data),
    clearHighlight: () => renderer.clearHighlight(),
    unprojectToGround: (screenX, screenY) => {
      const [sx, sy] = toCanvasXY(screenX, screenY);
      return renderer.unprojectToGround(sx, sy);
    },
    unprojectToPlane: (screenX, screenY, worldZ) => {
      const [sx, sy] = toCanvasXY(screenX, screenY);
      return renderer.unprojectToPlane(sx, sy, worldZ);
    },
    fitToVertices: (data) => renderer.fitToVertices(data),
    toDataURL: () => renderer.toDataURL(),

    setShowGrid: (show) => renderer.setShowGrid(show),
    setShowAxis: (show) => renderer.setShowAxis(show),
    setClearColor: (r, g, b, a) => renderer.setClearColor(r, g, b, a),
    uploadSpriteData: (sprites) => renderer.uploadSpriteData(sprites),
    uploadPaintData: (paints) => renderer.uploadPaintData(paints),
    uploadOverlayVertices: (data) => renderer.uploadOverlayVertices(data),
    getTextureManager: () => renderer.getTextureManager(),
    waitForManifest: () => renderer.waitForManifest(),

    // ── Case-actor plugin wiring ─────────────────────────────────────────────
    uploadActorBoxes: (boxes: CaseActorBox[]) => {
      actorLayer.setBoxes(boxes);
      renderer.uploadActorVertices(actorLayer.boxVertices());
    },
    clearActorBoxes: () => {
      actorLayer.clear();
      renderer.uploadActorVertices(new Float32Array(0));
      renderer.uploadPathVertices(new Float32Array(0));
    },
    uploadPathLines: (segments: Float32Array) => {
      actorLayer.setPathSegments(segments);
      renderer.uploadPathVertices(actorLayer.pathVertices());
    },
    pickActor: (clientX: number, clientY: number) => {
      const [sx, sy] = toCanvasXY(clientX, clientY);
      const world = renderer.unprojectToGround(sx, sy);
      if (!world) return null;
      const id = actorLayer.pickAt(world.x, world.y);
      return id ? { id } : null;
    },
    cameraBeginDrag: (button, event) => renderer.cameraBeginDrag(button, event),
    cameraUpdateDrag: (event) => renderer.cameraUpdateDrag(event),
    cameraEndDrag: () => renderer.cameraEndDrag(),
    cameraWheel: (deltaY) => renderer.cameraWheel(deltaY),
    frameScene3D: (minX, minY, maxX, maxY) => renderer.frameScene3D(minX, minY, maxX, maxY),
    centerCamera3D: (x, y) => renderer.centerCamera3D(x, y),

    // ── Point cloud wiring (6-float wasm buffer → 7-float renderer layout) ────
    uploadPointCloud: (data: Float32Array) => {
      renderer.uploadPointCloudVertices(expandPointCloudTo7(data));
    },
    clearPointCloud: () => {
      renderer.uploadPointCloudVertices(new Float32Array(0));
    },
  };
}

/** Compute planar bounds from a road vertex buffer (stride 7: xyz + rgba). */
function boundsFromRoadVertices(verts: Float32Array): ProjectBounds | null {
  if (!verts || verts.length < ROAD_VERTEX_STRIDE) return null;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i + 2 < verts.length; i += ROAD_VERTEX_STRIDE) {
    const x = verts[i]!;
    const y = verts[i + 1]!;
    const z = verts[i + 2]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  if (!isFinite(minX)) return null;
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

/** Locate a road object inside a parsed project by id. */
function findRoad(projectJson: string, roadId: string): unknown | null {
  try {
    const project = JSON.parse(projectJson) as { roads?: Array<{ id?: string }> };
    const road = project.roads?.find((r) => r.id === roadId);
    return road ?? null;
  } catch {
    return null;
  }
}

/** Wrap the `we_wasm` bindings as the rnk-next compute contract. */
function adaptWasm(wasm: WasmModule): WorldEditorWasm {
  // The host caches the project JSON via set_project_cache; we keep a copy so
  // the lane-highlight and bounds helpers can resolve road geometry locally.
  let cachedProjectJson = '';

  return {
    parse_opendrive: (xml) => wasm.parse_opendrive(xml) as WorldEditorProject,

    generate_road_vertices: (projectJson, sampleStep, colorMode) =>
      wasm.generate_road_vertices(projectJson, sampleStep, colorMode),

    generate_lane_line_vertices: (projectJson, sampleStep) =>
      wasm.generate_lane_line_vertices(projectJson, sampleStep),

    generate_single_road_vertices: (roadJson, sampleStep, r, g, b, a) =>
      wasm.generate_single_road_vertices(roadJson, sampleStep, r, g, b, a),

    set_project_cache: (projectJson) => {
      cachedProjectJson = projectJson;
      wasm.set_project_cache(projectJson);
    },

    update_cached_road: (roadJson) => {
      wasm.update_cached_road(roadJson);
      // Keep the host-side project copy consistent so highlight lookups stay
      // accurate after a single-road edit.
      if (cachedProjectJson) {
        try {
          const project = JSON.parse(cachedProjectJson) as { roads?: Array<{ id: string }> };
          const road = JSON.parse(roadJson) as { id: string };
          if (Array.isArray(project.roads)) {
            const idx = project.roads.findIndex((r) => r.id === road.id);
            if (idx >= 0) project.roads[idx] = road;
            else project.roads.push(road);
            cachedProjectJson = JSON.stringify(project);
          }
        } catch {
          // Leave the cached copy untouched on malformed input.
        }
      }
    },

    pick_lane_at_point_cached: (x, y, threshold) =>
      wasm.pick_lane_at_point_cached(x, y, threshold) as LanePick | null,

    /**
     * Per-lane highlight geometry. worldeditor-next currently exposes a
     * single-road mesh generator (not a single-lane one), so the lane's parent
     * road is highlighted — a faithful, low-cost approximation of the legacy
     * hover behavior. (A dedicated `generate_single_lane_vertices` could be
     * added to we-wasm later for exact lane fills.)
     */
    generate_lane_highlight_vertices: (roadId, _sectionIndex, _laneId, sampleStep) => {
      const road = findRoad(cachedProjectJson, roadId);
      if (!road) return new Float32Array(0);
      return wasm.generate_single_road_vertices(
        JSON.stringify(road),
        sampleStep,
        HIGHLIGHT_RGBA[0],
        HIGHLIGHT_RGBA[1],
        HIGHLIGHT_RGBA[2],
        HIGHLIGHT_RGBA[3],
      );
    },

    /**
     * Planar project bounds. Prefer the OpenDRIVE header extents (east/west =
     * X, north/south = Y); fall back to scanning generated road geometry when
     * the header bounds are degenerate (all zero).
     */
    get_project_bounds: (projectJson): ProjectBounds => {
      try {
        const project = JSON.parse(projectJson) as {
          header?: { north: number; south: number; east: number; west: number };
        };
        const h = project.header;
        if (h && (h.east !== h.west || h.north !== h.south)) {
          return {
            minX: Math.min(h.west, h.east),
            minY: Math.min(h.south, h.north),
            minZ: 0,
            maxX: Math.max(h.west, h.east),
            maxY: Math.max(h.south, h.north),
            maxZ: 0,
          };
        }
      } catch {
        // fall through to vertex-based bounds
      }
      const verts = wasm.generate_road_vertices(projectJson, 1, 'single');
      return boundsFromRoadVertices(verts) ?? { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
    },

    generate_junction_vertices: (projectJson) => wasm.generate_junction_vertices(projectJson),

    generate_lane_boundary_vertices: (projectJson, sampleStep) =>
      wasm.generate_lane_boundary_vertices(projectJson, sampleStep),

    generate_center_line_vertices: (projectJson, sampleStep) =>
      wasm.generate_center_line_vertices(projectJson, sampleStep),

    generate_signal_paint_vertices: (projectJson, sampleStep) =>
      wasm.generate_signal_paint_vertices(projectJson, sampleStep),

    generate_object_vertices: (projectJson) => wasm.generate_object_vertices(projectJson),

    generate_sprite_data: (projectJson) =>
      wasm.generate_sprite_data(projectJson) as SpriteDataResult,

    // ── Point cloud parsing (WASM registry; JS loads once, reads buffer, frees) ──
    load_point_cloud: (bytes, format) => wasm.load_point_cloud(bytes, format),
    free_point_cloud: (handle) => wasm.free_point_cloud(handle),
    point_cloud_summary: (handle) => wasm.point_cloud_summary(handle),
    point_cloud_render_buffer: (handle, colorMode, maxPoints) =>
      wasm.point_cloud_render_buffer(handle, colorMode, maxPoints),
  };
}

/** Wrap the GeoZ parser as the rnk-next importer contract. */
function adaptGeoZ(): WorldEditorGeoZ {
  return {
    importGeoZ: async (buffer, fileName) => {
      const content: ArrayBuffer =
        buffer instanceof Uint8Array
          ? (buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer)
          : buffer;
      return importGeoZ(content, fileName) as Promise<WorldEditorProject>;
    },
  };
}

/**
 * Build a fully-initialized worldeditor-next SDK for rnk-next. Instantiates the
 * WASM module up front so the returned synchronous WASM wrappers are safe to
 * call immediately.
 */
export async function createWorldEditorSdk(
  options?: CreateWorldEditorSdkOptions,
): Promise<WorldEditorSdk> {
  const wasm = (await import('../../wasm/pkg/we_wasm')) as WasmModule;
  await (wasm.default as unknown as (input?: unknown) => Promise<void>)(options?.wasmInput);

  return {
    createRenderer: adaptRenderer,
    wasm: adaptWasm(wasm),
    geoz: adaptGeoZ(),
  };
}
