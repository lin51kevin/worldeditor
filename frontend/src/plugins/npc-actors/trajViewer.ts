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
const PATH_HALF_WIDTH = 0.25;
/** Ground-parallel lift for path ribbons, meters. */
const PATH_Z = 0.15;
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
function interpPose(rows: TrajRow[], t: number): TrajRow {
  const first = rows[0]!;
  if (t <= first.time) return first;
  const last = rows[rows.length - 1]!;
  if (t >= last.time) return last;
  for (let i = 1; i < rows.length; i++) {
    const b = rows[i]!;
    if (t <= b.time) {
      const a = rows[i - 1]!;
      const span = b.time - a.time || 1;
      const f = (t - a.time) / span;
      return {
        time: t,
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        z: a.z + (b.z - a.z) * f,
        yaw: a.yaw + (b.yaw - a.yaw) * f,
      };
    }
  }
  return last;
}

/** Build the actor boxes for a trajectory sampled at absolute time `t`. */
export function buildTrajBoxes(data: TrajData, t: number): CaseActorBox[] {
  const boxes: CaseActorBox[] = [];
  for (const entity of data.entities) {
    if (entity.rows.length === 0) continue;
    const pose = interpPose(entity.rows, t);
    const l = entity.length || 4.5;
    const w = entity.width || 2;
    const h = entity.height || 1.6;
    boxes.push({
      id: `traj:${entity.id}`,
      kind: 'element',
      position: [pose.x, pose.y, pose.z + h / 2],
      heading: pose.yaw * DEG_TO_RAD,
      size: [l, w, h],
      color: entity.ego ? EGO_BODY_COLOR : OPPONENT_BODY_COLOR,
    });
  }
  return boxes;
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

/** Planar [minX, minY, maxX, maxY] extent of every trajectory vertex. */
function trajBounds(data: TrajData): [number, number, number, number] | null {
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
function trajTimeSpan(data: TrajData): [number, number] {
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
          // eslint-disable-next-line no-console
          console.warn('[npc-actors] .traj file contained no entities');
          return;
        }
        playTraj(target, data, sceneOrigin);
      } catch (err) {
        // eslint-disable-next-line no-console
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
