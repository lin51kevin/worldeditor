/**
 * Trajectory playback controller.
 *
 * Bridges the {@link useTrajectoryStore} playback state to the active
 * {@link ViewportRenderer}: it owns the single `requestAnimationFrame` clock
 * that advances `currentTime` while playing, and re-renders the moving actor
 * boxes whenever the playhead moves (from the clock, a scrub, or a frame step).
 *
 * The trajectory ribbons are static for a given dataset, so they are uploaded
 * once per load; only the actor boxes are rebuilt per frame.
 */

import {
  buildBoxVertices,
  buildEgoBox,
  buildTrajBoxes,
  interpPose,
  parseTraj,
  pickActorAtScreen,
  trajBounds,
} from '../plugins/npc-actors';
import type { TrajData } from '../plugins/npc-actors';
import type { CaseActorBox } from '../plugins/npc-actors';
import { getViewportRenderer } from './viewportRef';
import { loadEgoModelTemplate, buildEgoMeshVertices } from './egoModel';
import type { EgoModelTemplate } from './egoModel';
import { useTrajectoryStore } from '../stores/trajectoryStore';
import { showAlert } from '../utils/dialog';
import i18n from '../i18n';
import { smoothFollowPose, type FollowPose } from './trajectoryFollow';
import {
  loadActorModels,
  actorModelIds,
  buildSceneSplat,
  uploadActorModelsToGpu,
  buildActorInstances,
} from './trajectoryActorModels';
import { GAUSSIAN_SPLAT_LAYOUT_VERSION } from './gaussian/splatLayout';
import { useTrajectoryConfigStore } from '../stores/trajectoryConfigStore';
import { usePointCloudStore } from '../plugins/gis-viz/pointcloud/pointcloudState';

/** Max size (bytes) accepted for a trajectory import (guards runaway files). */
const MAX_TRAJECTORY_SIZE_BYTES = 100 * 1024 * 1024;

/**
 * Target on-screen update rate during playback (Hz).
 *
 * Playback advances the playhead on every `requestAnimationFrame`, and each
 * playhead change forces a full-scene redraw — which re-draws the entire
 * Gaussian splat cloud and (under a chase camera) a camera-driven depth
 * re-sort. At the display refresh rate (60/120 Hz) that dominates GPU usage.
 *
 * Capping the *visual* refresh to this rate roughly halves (60 Hz) or quarters
 * (120 Hz) the splat draw + re-sort load during playback. Time still advances
 * by real elapsed seconds across skipped frames, so playback speed and physics
 * are unaffected — only the redraw cadence is throttled. Because the chase
 * camera is also updated on the (now throttled) playhead change, the splat
 * re-sort rate is throttled to match for free.
 */
const PLAYBACK_RENDER_FPS = 30;
const PLAYBACK_FRAME_INTERVAL_MS = 1000 / PLAYBACK_RENDER_FPS;


// Origin the trajectory geometry is shifted into (aligns with an origin-relative
// point cloud). Module-level: a single viewport at a time.
let sceneOrigin: [number, number, number] = [0, 0, 0];
let rafId = 0;
let lastPerf = 0;
let unsub: (() => void) | null = null;
let followPose: FollowPose | null = null;
let followPerf = 0;
/**
 * Previous raw ego ground position (world metres), used to derive a stable
 * chase-camera heading from the direction of travel. Reset to null on any
 * snap (enable / seek / loop) so a teleport cannot fabricate a bogus heading.
 */
let followPrevGround: [number, number] | null = null;
/** Minimum travel between frames (m) before the heading tracks motion. */
const FOLLOW_HEADING_MIN_MOVE = 0.01;

/**
 * Apply or restore Gaussian splat sort settings to eliminate flickering during
 * follow/front camera playback.
 *
 * When the chase camera is active the static scene splat cloud must be depth-
 * sorted on *every rendered frame* — the camera moves continuously and the
 * 30 fps CPU-sort rate cap (the user's performance trade-off for a static
 * camera) causes visibly wrong alpha blending on the road surface.
 *
 * Strategy:
 * - `enable = true`  → zero the CPU-sort rate cap and enable the per-frame GPU
 *   stable radix sort (no-op fallback when the texture-array path is
 *   unavailable), so the order stays fresh every frame without flicker.
 * - `enable = false` → restore whatever the user has configured in the
 *   point-cloud panel (cap + GPU-sort toggle).
 */
function applyFollowSortMode(enable: boolean): void {
  const renderer = getViewportRenderer();
  if (!renderer) return;
  if (enable) {
    renderer.setSplatRefreshFps(0);  // realtime sort (no artificial cap)
    renderer.setSplatGpuSort(true);  // per-frame GPU stable sort if available
  } else {
    const pc = usePointCloudStore.getState();
    renderer.setSplatRefreshFps(pc.splatRefreshFps);
    renderer.setSplatGpuSort(pc.splatGpuSort);
  }
}

// Loaded ego car model (`ego.glb`). Null until the async load resolves (or if
// it fails, in which case the ego falls back to a bounding box).
let egoTemplate: EgoModelTemplate | null = null;

/** Rebuild and upload actor geometry for time `t`; uploads wake the render loop. */
function renderActorsAt(t: number): void {
  const { data, cameraMode, selectedEntityId } = useTrajectoryStore.getState();
  const renderer = getViewportRenderer();
  if (!renderer || !data) return;

  // Actors with a loaded Gaussian model render as splats instead of a box/mesh.
  const modelIds = actorModelIds();
  const egoHasModel = data.entities.some((e) => e.ego && modelIds.has(e.id));

  const rawEgoBox = buildEgoBox(data, t);
  const filteredEgoBox: CaseActorBox | null =
    cameraMode !== 'off' && followPose && rawEgoBox
      ? {
          ...rawEgoBox,
          position: [
            followPose.x + sceneOrigin[0],
            followPose.y + sceneOrigin[1],
            followPose.z + sceneOrigin[2] + rawEgoBox.size[2] / 2,
          ],
          // Match the (smoothed, travel-derived) chase heading so the body and
          // camera stay aligned and the car does not counter-rotate on noisy
          // recorded yaw.
          heading: followPose.yaw,
        }
      : null;

  // The ego is drawn as a solid model (`ego.glb`) or a Gaussian splat when
  // available, so exclude it from the (translucent) box set in those cases.
  const egoAsBox = !egoHasModel && egoTemplate === null && filteredEgoBox === null;
  const boxes = buildTrajBoxes(data, t, { includeEgo: egoAsBox }).filter(
    // Drop any actor rendered as a splat (box ids are `traj:<entityId>`).
    (b) => !modelIds.has(b.id.startsWith('traj:') ? b.id.slice(5) : b.id),
  );
  if (!egoHasModel && egoTemplate === null && filteredEgoBox) boxes.push(filteredEgoBox);
  // Highlight the actor whose info tooltip is open (wine-red selected fill).
  if (selectedEntityId) {
    for (const box of boxes) {
      const eid = box.id.startsWith('traj:') ? box.id.slice(5) : box.id;
      if (eid === selectedEntityId) box.selected = true;
    }
  }
  renderer.uploadActorVertices(buildBoxVertices(boxes, sceneOrigin));

  if (!egoHasModel && egoTemplate) {
    const egoBox = filteredEgoBox ?? rawEgoBox;
    if (egoBox) {
      renderer.uploadEgoMeshIndexed(
        buildEgoMeshVertices(egoTemplate, egoBox, sceneOrigin),
        egoTemplate.indices,
      );
    } else {
      renderer.clearEgoMesh();
    }
  } else {
    renderer.clearEgoMesh();
  }

  // Per-actor Gaussian splats: update per-instance transforms on the GPU-
  // persistent instancer (models were uploaded once via uploadActorModelsToGpu).
  const instances = buildActorInstances(data, t, sceneOrigin);
  if (instances.length > 0) {
    renderer.updateActorSplatInstances(instances);
  } else {
    renderer.clearActorSplatInstances();
  }
}

/** Clear both actor and ribbon buffers from the renderer. */
function clearRenderer(): void {
  const renderer = getViewportRenderer();
  if (!renderer) return;
  renderer.uploadActorVertices(new Float32Array(0));
  renderer.uploadPathVertices(new Float32Array(0));
  renderer.clearEgoMesh();
  renderer.clearActorSplatInstances();
}

/** The RAF clock: advance the playhead by real elapsed time × speed. */
function tick(): void {
  const s = useTrajectoryStore.getState();
  if (!s.isPlaying || !s.data) {
    rafId = 0;
    return;
  }
  const now = performance.now();
  // Frame-rate gate: keep the rAF clock alive but only advance/commit the
  // playhead — which triggers the full-scene redraw + splat re-sort — at the
  // capped rate. Skipped frames do not touch `lastPerf`, so `dt` still covers
  // the full elapsed span and playback stays real-time.
  //
  // Exception: while a follow/front camera owns the view, the camera pose is
  // driven off the playhead, so throttling it to 30 Hz makes the camera step
  // visibly on 60/120 Hz displays. Commit every frame in those modes so the
  // camera stays smooth (the free camera is static, so 30 Hz is fine there).
  const throttleMs = s.cameraMode === 'off' ? PLAYBACK_FRAME_INTERVAL_MS : 0;
  if (now - lastPerf < throttleMs) {
    rafId = requestAnimationFrame(tick);
    return;
  }
  const dt = Math.min((now - lastPerf) / 1000, 0.1);
  lastPerf = now;

  const span = s.tMax - s.tMin;
  let next = s.currentTime + dt * s.speed;
  if (next >= s.tMax) {
    if (s.loop && span > 0) {
      next = s.tMin + ((next - s.tMin) % span);
    } else {
      // Park on the final frame and stop.
      useTrajectoryStore.setState({ currentTime: s.tMax, isPlaying: false });
      return;
    }
  }
  // Updating currentTime triggers the subscription, which renders the frame.
  useTrajectoryStore.setState({ currentTime: next });
  rafId = requestAnimationFrame(tick);
}

/** Subscribe (once) to the store so playhead/data/play changes drive the view. */
function ensureSubscribed(): void {
  if (unsub) return;
  unsub = useTrajectoryStore.subscribe((state, prev) => {
    const timeChanged = state.currentTime !== prev.currentTime;
    const followActive = state.cameraMode !== 'off';
    const followWasActive = prev.cameraMode !== 'off';
    const modeChanged = state.cameraMode !== prev.cameraMode;
    const followJustEnabled = followActive && !followWasActive;
    const dataChanged = state.data !== prev.data;
    const ego = state.data?.entities.find((entity) => entity.ego);

    if (modeChanged || dataChanged) {
      getViewportRenderer()?.setChaseCameraActive(
        Boolean(followActive && ego && ego.rows.length > 0),
      );
      // In follow/front mode the camera moves every frame — disable the sort
      // rate cap and switch to per-frame GPU sort so the static scene splat
      // cloud (road surface) is always depth-sorted for the current camera
      // position, preventing the flickering caused by a stale CPU sort order.
      if (modeChanged) applyFollowSortMode(followActive);
    }

    // Update the camera before actor buffers are submitted so both use the same
    // playhead in the one frame rendered below.
    if (
      followActive &&
      state.data &&
      (timeChanged || followJustEnabled || modeChanged || dataChanged)
    ) {
      if (ego && ego.rows.length > 0) {
        const pose = interpPose(ego.rows, state.currentTime);
        const now = performance.now();
        // Switching between camera modes changes the camera offset, so snap
        // instantly instead of gliding through the intermediate framing.
        const shouldSnap =
          followJustEnabled ||
          modeChanged ||
          dataChanged ||
          !state.isPlaying ||
          state.currentTime < prev.currentTime ||
          Math.abs(state.currentTime - prev.currentTime) > 0.25;
        if (shouldSnap) followPrevGround = null;
        // Derive the chase heading from the direction of travel between the
        // previous and current raw sample. interpPose is piecewise-linear, so
        // this is constant within a segment (only real turns move it) — far
        // steadier than the per-sample recorded yaw, which jitters and, through
        // the ~18 m chase offset, makes the camera stutter/reverse. Fall back to
        // the recorded yaw while parked (no measurable travel) or on a snap.
        let headingRad = pose.yaw * (Math.PI / 180);
        if (followPrevGround) {
          const dx = pose.x - followPrevGround[0];
          const dy = pose.y - followPrevGround[1];
          if (Math.hypot(dx, dy) > FOLLOW_HEADING_MIN_MOVE) {
            headingRad = Math.atan2(dy, dx);
          } else if (followPose) {
            headingRad = followPose.yaw;
          }
        }
        followPrevGround = [pose.x, pose.y];
        const rawPose: FollowPose = {
          x: pose.x - sceneOrigin[0],
          y: pose.y - sceneOrigin[1],
          z: pose.z - sceneOrigin[2],
          yaw: headingRad,
        };
        followPose = smoothFollowPose(
          shouldSnap ? null : followPose,
          rawPose,
          followPerf > 0 ? (now - followPerf) / 1000 : 0,
        );
        followPerf = now;
        const renderer = getViewportRenderer();
        if (state.cameraMode === 'front') {
          renderer?.setFrontCam3D(
            followPose.x,
            followPose.y,
            followPose.z,
            followPose.yaw,
          );
        } else {
          renderer?.setChaseCam3D(
            followPose.x,
            followPose.y,
            followPose.z,
            followPose.yaw,
          );
        }
      }
    } else if (!followActive) {
      followPose = null;
      followPerf = 0;
      followPrevGround = null;
    }

    const followChanged = modeChanged;
    const selectionChanged = state.selectedEntityId !== prev.selectedEntityId;
    if (dataChanged) {
      if (!state.data) {
        clearRenderer();
        return;
      }
      // Trajectory ribbons are intentionally not drawn (ego/opponent paths are
      // hidden); clear any stale ribbons from a previous dataset.
      getViewportRenderer()?.uploadPathVertices(new Float32Array(0));
      renderActorsAt(state.currentTime);
    } else if (timeChanged || followChanged || selectionChanged) {
      renderActorsAt(state.currentTime);
    }

    if (state.isPlaying && !prev.isPlaying) {
      lastPerf = performance.now();
      if (!rafId) rafId = requestAnimationFrame(tick);
    } else if (!state.isPlaying && rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  });
}

/**
 * Scene origin the trajectory is rendered against (origin-relative, to align
 * with a loaded point cloud). Consumers projecting an actor's absolute world
 * position to screen must subtract this first.
 */
export function getTrajectorySceneOrigin(): readonly [number, number, number] {
  return sceneOrigin;
}

/**
 * Hit-test trajectory actors at a screen pixel and update the selection.
 * Returns the selected entity id, or null when the click missed (which also
 * clears any existing selection).
 *
 * `screenX`/`screenY` are canvas device pixels (the same space
 * {@link ViewportRenderer.projectWorldToScreen} returns). Picking is done in
 * screen space so it is robust to camera tilt and to actors above the ground
 * plane, and gives a forgiving target for small, moving vehicles.
 */
export function selectTrajectoryActorAt(screenX: number, screenY: number): string | null {
  const state = useTrajectoryStore.getState();
  if (!state.data) return null;
  const renderer = getViewportRenderer();
  if (!renderer) return null;
  const boxes = buildTrajBoxes(state.data, state.currentTime);
  // Boxes carry absolute world positions; the renderer draws them origin-
  // relative, so shift by the scene origin before projecting. Project the box
  // *center height* (not the ground) so the screen target matches the visible
  // box at any zoom/tilt.
  const project = (box: CaseActorBox) =>
    renderer.projectWorldToScreen(
      box.position[0] - sceneOrigin[0],
      box.position[1] - sceneOrigin[1],
      box.position[2] - sceneOrigin[2],
    );
  const thresholdPx = 44 * (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  const hitId = pickActorAtScreen(boxes, project, screenX, screenY, thresholdPx);
  const entityId = hitId ? (hitId.startsWith('traj:') ? hitId.slice(5) : hitId) : null;
  if (entityId) {
    state.setSelectedEntity(entityId);
  } else if (state.selectedEntityId) {
    state.setSelectedEntity(null);
  }
  return entityId;
}

/**
 * Load a parsed trajectory, frame the camera to it, and begin loop playback.
 *
 * `origin` aligns the trajectory with a loaded, origin-relative point cloud
 * (defaults to no shift).
 */
export function startTrajectory(
  data: TrajData,
  origin: readonly [number, number, number] = [0, 0, 0],
): void {
  if (data.entities.length === 0) return;
  ensureSubscribed();
  sceneOrigin = [origin[0], origin[1], origin[2]];

  const renderer = getViewportRenderer();
  renderer?.setDimension('3d');

  // Kick off the (cached) ego model load. When it resolves, redraw the current
  // frame so the ego switches from its fallback box to the solid model. A load
  // failure leaves `egoTemplate` null and the ego stays a bounding box.
  void loadEgoModelTemplate().then((template) => {
    if (!template) return;
    egoTemplate = template;
    if (useTrajectoryStore.getState().data) {
      renderActorsAt(useTrajectoryStore.getState().currentTime);
    }
  });

  // loadData triggers the subscription → uploads ribbons + renders first frame.
  useTrajectoryStore.getState().loadData(data);

  // Load any pre-configured actor Gaussian models, then re-render the current
  // frame so mapped actors appear as splats without waiting for a scrub.
  if (Object.keys(useTrajectoryConfigStore.getState().actorModels).length > 0) {
    void loadActorModels().then(() => {
      if (useTrajectoryStore.getState().data) {
        renderActorsAt(useTrajectoryStore.getState().currentTime);
      }
    });
  }

  const bounds = trajBounds(data);
  if (bounds && renderer) {
    renderer.frameScene3D(
      bounds[0] - sceneOrigin[0],
      bounds[1] - sceneOrigin[1],
      bounds[2] - sceneOrigin[0],
      bounds[3] - sceneOrigin[1],
    );
  }

  useTrajectoryStore.getState().play();
}

/** Stop playback, unload the trajectory, and clear its geometry from the view. */
export function stopTrajectory(): void {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  followPose = null;
  followPerf = 0;
  // If we left while a follow camera was active, restore the splat sort
  // settings that were in effect before follow mode was engaged.
  const wasFollowing = useTrajectoryStore.getState().cameraMode !== 'off';
  if (wasFollowing) applyFollowSortMode(false);
  // Clear the static-scene point cloud / Gaussian splats and the cached actor
  // models, and close the config panel — closing must wipe everything, not just
  // the trajectory ribbons/boxes.
  getViewportRenderer()?.clearGaussianSplats();
  getViewportRenderer()?.clearActorSplatInstances();
  const config = useTrajectoryConfigStore.getState();
  config.clearLoadedModels();
  config.toggleConfigOpen(false);
  // clear() sets data → null, which the subscription turns into a buffer clear.
  useTrajectoryStore.getState().clear();
}

/**
 * Reload the configured actor Gaussian models and re-render the current frame.
 * When `filter` is given, only matching actor ids are (re)loaded — used by the
 * ego / opponent apply buttons to update each independently. Safe to call with
 * no trajectory loaded (it simply refreshes the model cache).
 */
export async function refreshActorModels(filter?: (actorId: string) => boolean): Promise<void> {
  await loadActorModels(filter);
  uploadActorModelsToGpu();
  if (useTrajectoryStore.getState().data) {
    renderActorsAt(useTrajectoryStore.getState().currentTime);
  }
}

/**
 * Load the configured static-scene PLY into the scene Gaussian renderer (or
 * clear it when none is configured). Independent of the actor models.
 */
export async function applySceneModel(): Promise<void> {
  const renderer = getViewportRenderer();
  if (!renderer) return;
  const scene = await buildSceneSplat();
  if (scene && scene.buffer.length > 0) {
    renderer.uploadGaussianSplats(scene.buffer, scene.shDegree, GAUSSIAN_SPLAT_LAYOUT_VERSION);
  } else {
    renderer.clearGaussianSplats();
  }
}

/**
 * Open a native file picker for a `.traj`/`.csv` trajectory, parse it, and
 * begin playback. Surfaces size/parse/empty errors via the shared dialog.
 *
 * Shared by the File → Import menu action and the playback bar's import button.
 */
export function promptImportTrajectory(): void {
  const t = (key: string, fallback?: string): string => i18n.t(key, fallback ?? key);
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.traj,.csv,text/plain';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > MAX_TRAJECTORY_SIZE_BYTES) {
      void showAlert(t('dialog.importError'), t('dialog.errorTitle', 'Error'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = parseTraj(String(reader.result ?? ''));
        if (data.entities.length === 0) {
          void showAlert(t('dialog.importEmptyProject'), t('dialog.warningTitle'));
          return;
        }
        startTrajectory(data);
      } catch (err) {
        console.error('[trajectory] Failed to import trajectory:', err);
        const detail = err instanceof Error ? err.message : String(err);
        void showAlert(`${t('dialog.importError')}\n\n${detail}`, t('dialog.errorTitle', 'Error'));
      }
    };
    reader.readAsText(file);
  };
  input.click();
}
