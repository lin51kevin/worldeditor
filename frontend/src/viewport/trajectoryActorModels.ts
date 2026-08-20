/**
 * Per-actor Gaussian splat model loading and per-frame frame assembly.
 *
 * Loads each mapped `.ply` once (native on desktop, WASM worker on web), unifies
 * it to band-0 and recentres it at the origin, then — every trajectory frame —
 * transforms each present actor's model to its pose and merges them into a
 * single packed buffer for {@link ViewportRenderer.uploadActorGaussianSplats}.
 *
 * Band-0 unification lets every actor model share one stride so they can live in
 * the single actor-splat buffer; the (small) loss of view-dependent colour is
 * acceptable for car-sized models.
 */

import { getPlatformService } from '../services';
import type { PlyCandidate } from '../stores/trajectoryConfigStore';
import { useTrajectoryConfigStore } from '../stores/trajectoryConfigStore';
import type { ActorSplatModel } from '../stores/trajectoryConfigStore';
import {
  workerLoadGaussianSplats,
  workerFreeGaussianSplats,
} from '../workers/pointcloudBridge';
import { isGaussianPly } from '../plugins/gis-viz/pointcloud/pointcloudActions';
import { repackAsBand0, decimateSplatBuffer } from './gaussian/splatRenderer';
import { splatStrideForDegree, GAUSSIAN_SPLAT_LAYOUT_VERSION } from './gaussian/splatLayout';
import { shiftSplatOrigin } from './gaussian/splatSampling';
import {
  transformPackedSplats,
  recenterSplats,
  splatBoundsCenter,
  mergePackedSplats,
} from './gaussian/splatTransform';
import { interpPose, isEntityActiveAt } from '../plugins/npc-actors';
import type { TrajData } from '../plugins/npc-actors';
import type { ActorInstance } from './gaussian/actorSplatInstancer';
import { getViewportRenderer } from './viewportRef';

const DEG_TO_RAD = Math.PI / 180;

/** Per-actor splat budget (bounds the per-frame transform + merge cost). */
const ACTOR_SPLAT_BUDGET = 200_000;

/** Static-scene splat budget (bounds memory / upload for the reconstruction). */
const SCENE_SPLAT_BUDGET = 4_000_000;

/** Band-0 stride (words per splat) shared by every unified actor model. */
const BAND0_STRIDE = splatStrideForDegree(0);

/** Result of assembling one playback frame of actor splats. */
export interface ActorSplatFrame {
  /** Merged, world-placed packed band-0 buffer (may be empty). */
  buffer: Uint32Array;
  /** Always 0 — every model is unified to band-0. */
  shDegree: number;
}

/** A parsed packed splat buffer plus the metadata needed to place it. */
interface RawSplat {
  buffer: Uint32Array;
  shDegree: number;
  origin: [number, number, number];
}

/** Load a candidate PLY into a raw packed buffer (platform-aware, uncentred). */
async function loadRawSplat(candidate: PlyCandidate, budget: number): Promise<RawSplat> {
  if (candidate.path) {
    // Desktop: native parse from an absolute path.
    const platform = await getPlatformService();
    if (!platform.loadGaussianSplatsNative) {
      throw new Error('Native Gaussian loading is unavailable on this platform');
    }
    const { meta, buffer } = await platform.loadGaussianSplatsNative(candidate.path, budget);
    return { buffer, shDegree: meta.shDegree, origin: meta.origin };
  }
  if (candidate.file) {
    // Web: read bytes and parse in the WASM worker.
    const bytes = new Uint8Array(await candidate.file.arrayBuffer());
    if (!isGaussianPly(bytes)) {
      throw new Error(`${candidate.name} is not a Gaussian Splatting PLY`);
    }
    const { handle, meta, buffer } = await workerLoadGaussianSplats(bytes, budget);
    try {
      return { buffer, shDegree: meta.shDegree, origin: meta.origin };
    } finally {
      await workerFreeGaussianSplats(handle).catch(() => undefined);
    }
  }
  throw new Error(`Candidate ${candidate.name} has neither a path nor file handle`);
}

/** Normalize a raw packed buffer to a band-0, recentred, budget-capped model. */
function normalizeModel(key: string, buffer: Uint32Array, shDegree: number): ActorSplatModel {
  const band0 = repackAsBand0(buffer, shDegree, GAUSSIAN_SPLAT_LAYOUT_VERSION);
  const capped = decimateSplatBuffer(band0, BAND0_STRIDE, ACTOR_SPLAT_BUDGET);
  const center = splatBoundsCenter(capped, BAND0_STRIDE);
  const recentred = recenterSplats(capped, BAND0_STRIDE, center);
  return {
    key,
    buffer: recentred,
    shDegree: 0,
    count: Math.floor(recentred.length / BAND0_STRIDE),
  };
}

/** Load a single candidate PLY into a normalized model (platform-aware). */
async function loadCandidate(candidate: PlyCandidate): Promise<ActorSplatModel> {
  const raw = await loadRawSplat(candidate, ACTOR_SPLAT_BUDGET);
  return normalizeModel(candidate.key, raw.buffer, raw.shDegree);
}

/** Resolve a candidate by key across every scanned bucket. */
function candidateByKey(key: string): PlyCandidate | undefined {
  const { scan } = useTrajectoryConfigStore.getState();
  return [...scan.npcs, ...scan.scenes, ...scan.roads].find((c) => c.key === key);
}

/**
 * Load (or refresh) mapped actor models into the config store. When `filter` is
 * given, only actors it accepts are (re)loaded / dropped — used by the per-row
 * apply buttons so the ego and opponents can be updated independently. Actors
 * whose mapping is unchanged keep their cached buffer; unmapped actors are
 * dropped. Missing candidates and load failures are logged and skipped so one
 * bad PLY does not abort the rest.
 */
export async function loadActorModels(filter?: (actorId: string) => boolean): Promise<void> {
  const store = useTrajectoryConfigStore.getState();
  const { actorModels } = store;

  // Drop loaded models whose actor is no longer mapped (respecting the filter).
  for (const actorId of Object.keys(store.loadedModels)) {
    if (filter && !filter(actorId)) continue;
    if (!(actorId in actorModels)) store.setLoadedModel(actorId, null);
  }

  await Promise.all(
    Object.entries(actorModels)
      .filter(([actorId]) => !filter || filter(actorId))
      .map(async ([actorId, key]) => {
        const existing = useTrajectoryConfigStore.getState().loadedModels[actorId];
        if (existing && existing.key === key) return; // already loaded
        const candidate = candidateByKey(key);
        if (!candidate) {
          console.warn(`[trajModels] No scanned candidate for key "${key}" (actor ${actorId})`);
          return;
        }
        try {
          const model = await loadCandidate(candidate);
          useTrajectoryConfigStore.getState().setLoadedModel(actorId, model);
        } catch (err) {
          console.error(`[trajModels] Failed to load model for actor ${actorId}:`, err);
        }
      }),
  );
}

/**
 * Load the configured static-scene PLY and return it as a world-placed splat
 * buffer (positions shifted back to absolute coordinates so it aligns with the
 * trajectory), or `null` when no scene is configured / resolvable.
 */
export async function buildSceneSplat(): Promise<{ buffer: Uint32Array; shDegree: number } | null> {
  const { scenePly } = useTrajectoryConfigStore.getState();
  if (!scenePly) return null;
  const candidate = candidateByKey(scenePly);
  if (!candidate) {
    console.warn(`[trajModels] No scanned candidate for scene key "${scenePly}"`);
    return null;
  }
  const raw = await loadRawSplat(candidate, SCENE_SPLAT_BUDGET);
  const stride = splatStrideForDegree(raw.shDegree);
  const world = shiftSplatOrigin(raw.buffer, stride, raw.origin);
  return { buffer: world, shDegree: raw.shDegree };
}

/** Whether any actor currently has a loaded splat model. */
export function hasActorModels(): boolean {
  return Object.keys(useTrajectoryConfigStore.getState().loadedModels).length > 0;
}

/** The set of actor ids that render as a splat model at the current mapping. */
export function actorModelIds(): Set<string> {
  return new Set(Object.keys(useTrajectoryConfigStore.getState().loadedModels));
}

/**
 * Assemble the merged actor-splat buffer for time `t`, placing every loaded
 * model at its actor pose (translated by `-sceneOrigin`). Returns `null` when no
 * actor has a model, or the merged frame (possibly empty if no mapped actor is
 * present at `t`).
 */
export function buildActorSplatFrame(
  data: TrajData,
  t: number,
  sceneOrigin: readonly [number, number, number],
): ActorSplatFrame | null {
  const { loadedModels } = useTrajectoryConfigStore.getState();
  if (Object.keys(loadedModels).length === 0) return null;

  const pieces: Uint32Array[] = [];
  for (const entity of data.entities) {
    const model = loadedModels[entity.id];
    if (!model || !isEntityActiveAt(entity.rows, t)) continue;
    const pose = interpPose(entity.rows, t);
    const h = entity.height || 1.6;
    const translate: [number, number, number] = [
      pose.x - sceneOrigin[0],
      pose.y - sceneOrigin[1],
      pose.z + h / 2 - sceneOrigin[2],
    ];
    pieces.push(transformPackedSplats(model.buffer, BAND0_STRIDE, translate, pose.yaw * DEG_TO_RAD));
  }

  return { buffer: mergePackedSplats(pieces), shDegree: 0 };
}

/**
 * Upload all currently loaded actor models to the GPU-persistent instancer.
 * Must be called after `loadActorModels` resolves so that each model's band-0
 * buffer is present in the renderer for instanced draw calls.
 */
export function uploadActorModelsToGpu(): void {
  const renderer = getViewportRenderer();
  if (!renderer) return;
  const { loadedModels } = useTrajectoryConfigStore.getState();
  for (const [, model] of Object.entries(loadedModels)) {
    if (!model) continue;
    renderer.uploadActorModel(model.key, model.buffer);
  }
}

/**
 * Build per-frame instance descriptors for the GPU-persistent instancer.
 * Each entry carries the model URL (key) and the pose (yaw quaternion + position)
 * so the instancer can update only a small per-instance transform buffer.
 */
export function buildActorInstances(
  data: TrajData,
  t: number,
  sceneOrigin: readonly [number, number, number],
): ActorInstance[] {
  const { loadedModels } = useTrajectoryConfigStore.getState();
  if (Object.keys(loadedModels).length === 0) return [];

  const instances: ActorInstance[] = [];
  for (const entity of data.entities) {
    const model = loadedModels[entity.id];
    if (!model || !isEntityActiveAt(entity.rows, t)) continue;
    const pose = interpPose(entity.rows, t);
    const h = entity.height || 1.6;
    const yawRad = pose.yaw * DEG_TO_RAD;
    instances.push({
      url: model.key,
      cos_yaw: Math.cos(yawRad),
      sin_yaw: Math.sin(yawRad),
      hw: Math.cos(yawRad / 2),
      hz: Math.sin(yawRad / 2),
      px: pose.x - sceneOrigin[0],
      py: pose.y - sceneOrigin[1],
      pz: pose.z + h / 2 - sceneOrigin[2],
    });
  }
  return instances;
}
