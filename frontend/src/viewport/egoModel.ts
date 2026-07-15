/**
 * Ego vehicle model (`ego.glb`) loader + per-frame transform.
 *
 * During trajectory playback the ego actor is rendered as an opaque, solid car
 * model instead of a translucent bounding box, so it is clearly distinct from
 * the opponent boxes. The model is loaded once (into the renderer's interleaved
 * 7-float vertex layout via {@link parseGlbMesh}) and transformed per playback
 * frame to match the ego's pose and size from the `.traj`.
 *
 * On desktop (Tauri) the model is shipped as an external, user-replaceable
 * `ego.glb` file next to the app (Tauri resource) so it can be swapped without
 * rebuilding; on web (and as a desktop fallback) the bundled
 * `public/assets/ego.glb` served by the webview is used.
 */

import type { CaseActorBox } from '../plugins/npc-actors';
import { getAssetUrl } from '../utils/assetUrl';
import { parseGlbMesh, isGlb } from './glbMesh';

/** Floats per vertex in the renderer's basic pipeline (pos3 + rgba). */
const VERTEX_STRIDE = 7;

// ── Model → engine axis convention ─────────────────────────────────────────
//
// `parseGlbMesh` bakes each mesh's node world matrix, so the template is in the
// asset's displayed frame. For `ego.glb` (Lincoln MKZ) the baked geometry is
// +Y up, with the vehicle length along X (~5 m) and width along Z (~2.1 m).
// The engine frame is Z-up with the actor's forward (length) along local +X and
// width along +Y (matching the opponent box convention in actorGeometry.ts).
//
// If the loaded car faces the wrong way on screen, flip MODEL_FORWARD_SIGN (or
// adjust the axis indices) — these constants are the single orientation knob.

/** Model axis (0=x,1=y,2=z) that points up. */
const MODEL_UP_AXIS = 1;
/** Model axis that points along the vehicle's forward (length) direction. */
const MODEL_FORWARD_AXIS = 0;
/** Sign applied to the forward axis so +X ends up pointing "forward". */
const MODEL_FORWARD_SIGN = -1;

/** A parsed, cached ego model in local space, ready to transform per frame. */
export interface EgoModelTemplate {
  /** Interleaved local-space vertices: `x, y, z, r, g, b, a` per vertex. */
  readonly localVertices: Float32Array;
  /** Triangle index buffer (32-bit), constant across frames. */
  readonly indices: Uint32Array;
  /** Local-space bounds center `[x, y, z]`. */
  readonly center: readonly [number, number, number];
  /** Local-space per-axis extents `[dx, dy, dz]` (guaranteed > 0). */
  readonly nativeDim: readonly [number, number, number];
}

let cached: EgoModelTemplate | null = null;
let loading: Promise<EgoModelTemplate | null> | null = null;

/** True when running inside the Tauri desktop webview. */
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Read the raw `ego.glb` bytes.
 *
 * On desktop (Tauri) the model is shipped as an external, user-replaceable
 * resource file (`ego.glb` next to the app) — read it via the filesystem so
 * swapping the file changes the rendered car without rebuilding. Falls back to
 * the bundled copy served by the webview (also the only path on web).
 */
async function fetchEgoBytes(): Promise<Uint8Array> {
  if (isTauri()) {
    try {
      const { resolveResource } = await import('@tauri-apps/api/path');
      const { readFile } = await import('@tauri-apps/plugin-fs');
      const path = await resolveResource('ego.glb');
      return await readFile(path);
    } catch (err) {
      // External resource missing/unreadable — fall back to the bundled asset.
      console.warn('[egoModel] external ego.glb not found, using bundled copy:', err);
    }
  }
  const res = await fetch(getAssetUrl('assets/ego.glb'));
  if (!res.ok) throw new Error(`ego.glb HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Fetch and parse `ego.glb` once, caching the result.
 *
 * Returns `null` (and logs) on any failure — a missing/unsupported asset must
 * not break playback; the caller falls back to the ego bounding box.
 */
export function loadEgoModelTemplate(): Promise<EgoModelTemplate | null> {
  if (cached) return Promise.resolve(cached);
  if (loading) return loading;

  loading = (async () => {
    try {
      const bytes = await fetchEgoBytes();
      if (!isGlb(bytes)) throw new Error('ego.glb is not a valid GLB');

      const mesh = parseGlbMesh(bytes);
      const center: [number, number, number] = [
        (mesh.min[0] + mesh.max[0]) / 2,
        (mesh.min[1] + mesh.max[1]) / 2,
        (mesh.min[2] + mesh.max[2]) / 2,
      ];
      const nativeDim: [number, number, number] = [
        Math.max(mesh.max[0] - mesh.min[0], 1e-6),
        Math.max(mesh.max[1] - mesh.min[1], 1e-6),
        Math.max(mesh.max[2] - mesh.min[2], 1e-6),
      ];
      cached = { localVertices: mesh.vertices, indices: mesh.indices, center, nativeDim };
      return cached;
    } catch (err) {
      console.error('[egoModel] failed to load ego.glb:', err);
      return null;
    } finally {
      loading = null;
    }
  })();

  return loading;
}

/**
 * Transform the cached local-space ego template into world-space vertices for a
 * single playback frame.
 *
 * The model is recentered, remapped to the engine's Z-up / +X-forward frame,
 * scaled so its extents match the ego box size `[length, width, height]`,
 * rotated about Z by the heading, and translated to the (origin-relative) box
 * center. Colors are preserved from the template. The index buffer is unchanged
 * (use {@link EgoModelTemplate.indices} for the draw).
 *
 * @param template - The loaded ego model template.
 * @param box - The ego actor box (shares pose/heading/size with opponent boxes).
 * @param origin - Scene render origin subtracted from the box center.
 * @returns Interleaved 7-float world-space vertices (positions transformed).
 */
export function buildEgoMeshVertices(
  template: EgoModelTemplate,
  box: CaseActorBox,
  origin: readonly [number, number, number] = [0, 0, 0],
): Float32Array {
  const { localVertices, center, nativeDim } = template;

  // Width axis is the one not used by up/forward.
  const widthAxis = 3 - MODEL_UP_AXIS - MODEL_FORWARD_AXIS;

  // Scale each engine axis so the model spans the box size.
  const scaleForward = box.size[0] / nativeDim[MODEL_FORWARD_AXIS]!;
  const scaleWidth = box.size[1] / nativeDim[widthAxis]!;
  const scaleUp = box.size[2] / nativeDim[MODEL_UP_AXIS]!;

  const cos = Math.cos(box.heading);
  const sin = Math.sin(box.heading);
  const cx = box.position[0] - origin[0];
  const cy = box.position[1] - origin[1];
  const cz = box.position[2] - origin[2];

  const count = Math.floor(localVertices.length / VERTEX_STRIDE);
  const out = new Float32Array(count * VERTEX_STRIDE);

  for (let i = 0; i < count; i++) {
    const o = i * VERTEX_STRIDE;

    // Centered model coordinates (per model axis).
    const m = [
      localVertices[o]! - center[0],
      localVertices[o + 1]! - center[1],
      localVertices[o + 2]! - center[2],
    ];

    // Remap to engine local axes: +X forward (length), +Y width, +Z up.
    const localX = m[MODEL_FORWARD_AXIS]! * MODEL_FORWARD_SIGN * scaleForward;
    const localY = m[widthAxis]! * scaleWidth;
    const localZ = m[MODEL_UP_AXIS]! * scaleUp;

    // Rotate about Z by heading, then translate to the box center.
    out[o] = cx + (localX * cos - localY * sin);
    out[o + 1] = cy + (localX * sin + localY * cos);
    out[o + 2] = cz + localZ;

    // Preserve color channels.
    out[o + 3] = localVertices[o + 3]!;
    out[o + 4] = localVertices[o + 4]!;
    out[o + 5] = localVertices[o + 5]!;
    out[o + 6] = localVertices[o + 6]!;
  }

  return out;
}

/** Reset the module-level cache (test-only). */
export function resetEgoModelForTest(): void {
  cached = null;
  loading = null;
}
