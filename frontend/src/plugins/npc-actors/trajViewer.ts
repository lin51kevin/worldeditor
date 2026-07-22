/**
 * NPC-actor trajectory viewer (manual verification helper).
 *
 * Replaces the fixed "sample boxes" self-test with a real `.traj` file loader:
 * pick a trajectory CSV and it renders every entity as a moving bounding box +
 * full polyline ribbon, loop-playing over the file's time span. This lets the
 * box/ribbon rendering (and its coexistence with the WASM road surface) be
 * verified against real data in the standalone worldeditor-next app.
 *
 * The parser is a self-contained subset of the embed host's `.traj` reader
 * (SimOne WebPages `logsimTraj`): rows are per-timestamp world poses grouped by
 * entity id, tolerant of common column-name aliases.
 */

import { buildBoxVertices, buildPathVertices } from './actorGeometry';
import { CaseActorBox, Rgba } from './actorTypes';

/** Trajectory ribbon half-width, meters. */
export const PATH_HALF_WIDTH = 0.25;
/** Ground-parallel lift for path ribbons, meters. */
export const PATH_Z = 0.15;
/** Degrees→radians (trajectory yaw is stored in degrees). */
const DEG_TO_RAD = Math.PI / 180;

const EGO_BODY_COLOR: Rgba = [0.2, 0.5, 0.95, 1];
const OPPONENT_BODY_COLOR: Rgba = [0.2, 0.78, 0.32, 1];
const EGO_LINE_COLOR: Rgba = [0.2, 0.6, 0.95, 1];
const OPPONENT_LINE_COLOR: Rgba = [0.2, 0.85, 0.9, 1];

/** Minimal renderer surface the trajectory viewer needs. */
export interface TrajViewerTarget {
  setDimension(dimension: '2d' | '3d'): void;
  uploadActorVertices(vertexData: Float32Array): void;
  uploadPathVertices(vertexData: Float32Array): void;
  /** Frame the 3D camera to a planar bounds (world meters). */
  frameScene3D(minX: number, minY: number, maxX: number, maxY: number): void;
  render(): void;
}

/** One parsed `.traj` row (a single entity pose at a single timestamp). */
interface TrajRow {
  time: number;
  x: number;
  y: number;
  z: number;
  yaw: number; // degrees
}

/** All rows for one entity, sorted by time. */
interface TrajEntity {
  id: string;
  ego: boolean;
  length: number;
  width: number;
  height: number;
  rows: TrajRow[];
}

/** Parsed trajectory file grouped into entities. */
export interface TrajData {
  entities: TrajEntity[];
}

/** Column aliases tolerated in the `.traj` header (case-insensitive). */
const COLUMN_ALIASES: { [canonical: string]: string[] } = {
  id: ['id'],
  time: ['time'],
  x: ['positionx', 'posx', 'x'],
  y: ['positiony', 'posy', 'y'],
  z: ['positionz', 'posz', 'z'],
  length: ['length'],
  width: ['width'],
  height: ['height'],
  yaw: ['yaw'],
  ego: ['ego'],
};

function buildColumnIndex(header: string[]): { [canonical: string]: number } {
  const normalized = header.map((h) => h.trim().toLowerCase());
  const index: { [canonical: string]: number } = {};
  for (const canonical of Object.keys(COLUMN_ALIASES)) {
    const aliases = COLUMN_ALIASES[canonical] ?? [];
    for (const alias of aliases) {
      const at = normalized.indexOf(alias);
      if (at !== -1) {
        index[canonical] = at;
        break;
      }
    }
  }
  return index;
}

function toNumber(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Read a cell by (possibly undefined) column index. */
function cell(cells: string[], idx: number | undefined): string | undefined {
  return idx === undefined ? undefined : cells[idx];
}

/** Parse a `.traj` CSV into entities grouped by id, each time-sorted. */
export function parseTraj(text: string): TrajData {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { entities: [] };

  const header = lines[0]!.split(',');
  const col = buildColumnIndex(header);
  if (col.id === undefined || col.time === undefined) {
    throw new Error("Invalid .traj file: missing required 'ID'/'Time' columns");
  }

  const groups = new Map<string, TrajEntity>();
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i]!.split(',');
    const id = (cell(cells, col.id) || '').trim();
    if (!id) continue;

    const ego = (cell(cells, col.ego) || '').trim().toUpperCase() === 'Y';
    const row: TrajRow = {
      time: toNumber(cell(cells, col.time)),
      x: toNumber(cell(cells, col.x)),
      y: toNumber(cell(cells, col.y)),
      z: toNumber(cell(cells, col.z)),
      yaw: toNumber(cell(cells, col.yaw)),
    };

    let entity = groups.get(id);
    if (!entity) {
      entity = {
        id,
        ego,
        length: toNumber(cell(cells, col.length)),
        width: toNumber(cell(cells, col.width)),
        height: toNumber(cell(cells, col.height)),
        rows: [],
      };
      groups.set(id, entity);
    }
    entity.ego = entity.ego || ego;
    entity.rows.push(row);
  }

  const entities = Array.from(groups.values());
  entities.forEach((entity) => entity.rows.sort((a, b) => a.time - b.time));
  return { entities };
}

/** Linear-interpolate a time-sorted entity's pose at absolute time `t`. */
export function interpPose(rows: TrajRow[], t: number): TrajRow {
  const first = rows[0]!;
  if (t <= first.time) return first;
  const last = rows[rows.length - 1]!;
  if (t >= last.time) return last;
  // Lower-bound search avoids scanning from the start on every playback frame.
  let low = 1;
  let high = rows.length - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (rows[mid]!.time < t) low = mid + 1;
    else high = mid;
  }
  const b = rows[low]!;
  const a = rows[low - 1]!;
  const span = b.time - a.time;
  if (!(span > 0)) return b;
  const f = (t - a.time) / span;
  // Trajectory headings are degrees. Interpolate the signed shortest arc so
  // 179° → -179° crosses ±180° instead of rotating through 0°.
  const yawDelta = ((b.yaw - a.yaw + 540) % 360) - 180;
  return {
    time: t,
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    z: a.z + (b.z - a.z) * f,
    yaw: a.yaw + yawDelta * f,
  };
}

/** Build the oriented bounding box for a single entity at absolute time `t`. */
function entityBox(entity: TrajEntity, t: number): CaseActorBox | null {
  if (entity.rows.length === 0) return null;
  const pose = interpPose(entity.rows, t);
  const l = entity.length || 4.5;
  const w = entity.width || 2;
  const h = entity.height || 1.6;
  return {
    id: `traj:${entity.id}`,
    kind: 'element',
    position: [pose.x, pose.y, pose.z + h / 2],
    heading: pose.yaw * DEG_TO_RAD,
    size: [l, w, h],
    color: entity.ego ? EGO_BODY_COLOR : OPPONENT_BODY_COLOR,
  };
}

/** Options controlling which actors {@link buildTrajBoxes} emits. */
export interface BuildTrajBoxesOptions {
  /**
   * Whether the ego entity is included in the box set. Defaults to `true`.
   * Set to `false` when the ego is rendered as a solid model (`ego.glb`)
   * instead, so it is not drawn twice.
   */
  includeEgo?: boolean;
}

/** Build the actor boxes for a trajectory sampled at absolute time `t`. */
export function buildTrajBoxes(
  data: TrajData,
  t: number,
  options: BuildTrajBoxesOptions = {},
): CaseActorBox[] {
  const includeEgo = options.includeEgo ?? true;
  const boxes: CaseActorBox[] = [];
  for (const entity of data.entities) {
    if (!includeEgo && entity.ego) continue;
    const box = entityBox(entity, t);
    if (box) boxes.push(box);
  }
  return boxes;
}

/**
 * Build the oriented bounding box for the (first) ego entity at time `t`.
 *
 * Returns `null` when the trajectory has no ego entity (or the ego has no
 * rows). Used to drive the solid ego-model rendering, so it shares the exact
 * pose/heading/size conventions of the opponent boxes.
 */
export function buildEgoBox(data: TrajData, t: number): CaseActorBox | null {
  const ego = data.entities.find((entity) => entity.ego);
  return ego ? entityBox(ego, t) : null;
}

/** Build flat path segment pairs (14 floats/segment) for every entity polyline. */
export function buildTrajSegments(data: TrajData): Float32Array {
  const out: number[] = [];
  for (const entity of data.entities) {
    const color = entity.ego ? EGO_LINE_COLOR : OPPONENT_LINE_COLOR;
    const rows = entity.rows;
    for (let i = 0; i + 1 < rows.length; i++) {
      const a = rows[i]!;
      const b = rows[i + 1]!;
      out.push(
        a.x, a.y, PATH_Z, color[0], color[1], color[2], color[3],
        b.x, b.y, PATH_Z, color[0], color[1], color[2], color[3],
      );
    }
  }
  return new Float32Array(out);
}

/** Sorted, de-duplicated list of every distinct timestamp across all entities. */
export function trajFrames(data: TrajData): number[] {
  const set = new Set<number>();
  for (const entity of data.entities) {
    for (const r of entity.rows) set.add(r.time);
  }
  return Array.from(set).sort((a, b) => a - b);
}

/** Planar [minX, minY, maxX, maxY] extent of every trajectory vertex. */
export function trajBounds(data: TrajData): [number, number, number, number] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const entity of data.entities) {
    for (const r of entity.rows) {
      if (r.x < minX) minX = r.x;
      if (r.x > maxX) maxX = r.x;
      if (r.y < minY) minY = r.y;
      if (r.y > maxY) maxY = r.y;
    }
  }
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
}

/** Absolute [tMin, tMax] time span across every entity row. */
export function trajTimeSpan(data: TrajData): [number, number] {
  let tMin = Infinity;
  let tMax = -Infinity;
  for (const entity of data.entities) {
    for (const r of entity.rows) {
      if (r.time < tMin) tMin = r.time;
      if (r.time > tMax) tMax = r.time;
    }
  }
  return [tMin, tMax];
}

// Active playback clock (single viewport → module-level is sufficient).
let playbackRaf = 0;

/** Stop the trajectory playback loop, if running. */
function stopPlayback(): void {
  if (playbackRaf) {
    cancelAnimationFrame(playbackRaf);
    playbackRaf = 0;
  }
}

/** Render one trajectory frame at time `t`, shifted into the render frame. */
function renderFrameAt(
  target: TrajViewerTarget,
  data: TrajData,
  t: number,
  origin: readonly [number, number, number],
): void {
  target.uploadActorVertices(buildBoxVertices(buildTrajBoxes(data, t), origin));
  target.uploadPathVertices(buildPathVertices(buildTrajSegments(data), PATH_HALF_WIDTH, origin));
  target.render();
}

/**
 * Load parsed trajectory data: frame the camera and loop-play it.
 *
 * `sceneOrigin` is the render origin of a loaded road-mesh point cloud (the
 * shift the WASM parser applied to keep the cloud near zero). Trajectory
 * geometry and the camera framing are shifted by it so the ribbons/boxes sit on
 * the road surface instead of being offset by the (far-from-zero) authoring
 * origin. Defaults to no shift when no point cloud is loaded.
 */
export function playTraj(
  target: TrajViewerTarget,
  data: TrajData,
  sceneOrigin: readonly [number, number, number] = [0, 0, 0],
): void {
  stopPlayback();
  if (data.entities.length === 0) return;

  target.setDimension('3d');
  const bounds = trajBounds(data);
  if (bounds) {
    target.frameScene3D(
      bounds[0] - sceneOrigin[0],
      bounds[1] - sceneOrigin[1],
      bounds[2] - sceneOrigin[0],
      bounds[3] - sceneOrigin[1],
    );
  }

  const [tMin, tMax] = trajTimeSpan(data);
  const span = tMax - tMin;
  if (!Number.isFinite(span) || span <= 0) {
    renderFrameAt(target, data, Number.isFinite(tMin) ? tMin : 0, sceneOrigin);
    return;
  }

  const startPerf = performance.now();
  const tick = () => {
    const elapsed = (performance.now() - startPerf) / 1000;
    renderFrameAt(target, data, tMin + (elapsed % span), sceneOrigin);
    playbackRaf = requestAnimationFrame(tick);
  };
  playbackRaf = requestAnimationFrame(tick);
}

/**
 * Open a file picker, parse the chosen `.traj` file, then view + loop-play it.
 * Replaces the old fixed "spawn sample boxes" self-test.
 *
 * `sceneOrigin` aligns the trajectory with a loaded road-mesh point cloud (see
 * {@link playTraj}); defaults to no shift.
 */
export function openTrajFile(
  target: TrajViewerTarget,
  sceneOrigin: readonly [number, number, number] = [0, 0, 0],
): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.traj,.csv,text/plain';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = parseTraj(String(reader.result ?? ''));
        if (data.entities.length === 0) {
           
          console.warn('[npc-actors] .traj file contained no entities');
          return;
        }
        playTraj(target, data, sceneOrigin);
      } catch (err) {
         
        console.error('[npc-actors] failed to parse .traj file', err);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

/** Stop playback and remove the trajectory actors + ribbons. */
export function clearTraj(target: TrajViewerTarget): void {
  stopPlayback();
  target.uploadActorVertices(new Float32Array(0));
  target.uploadPathVertices(new Float32Array(0));
  target.render();
}
