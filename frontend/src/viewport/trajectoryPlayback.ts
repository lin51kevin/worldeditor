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

// Loaded ego car model (`ego.glb`). Null until the async load resolves (or if
// it fails, in which case the ego falls back to a bounding box).
let egoTemplate: EgoModelTemplate | null = null;

/** Rebuild and upload actor geometry for time `t`; uploads wake the render loop. */
function renderActorsAt(t: number): void {
  const { data, followEgo } = useTrajectoryStore.getState();
  const renderer = getViewportRenderer();
  if (!renderer || !data) return;

  const rawEgoBox = buildEgoBox(data, t);
  const filteredEgoBox: CaseActorBox | null =
    followEgo && followPose && rawEgoBox
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

  // When the ego model is loaded, draw the ego as a solid model and exclude it
  // from the (translucent) box set so it is not drawn twice.
  const boxes = buildTrajBoxes(data, t, {
    includeEgo: egoTemplate === null && filteredEgoBox === null,
  });
  if (egoTemplate === null && filteredEgoBox) boxes.push(filteredEgoBox);
  renderer.uploadActorVertices(
    buildBoxVertices(boxes, sceneOrigin),
  );

  if (egoTemplate) {
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
}

/** Clear both actor and ribbon buffers from the renderer. */
function clearRenderer(): void {
  const renderer = getViewportRenderer();
  if (!renderer) return;
  renderer.uploadActorVertices(new Float32Array(0));
  renderer.uploadPathVertices(new Float32Array(0));
  renderer.clearEgoMesh();
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
  if (now - lastPerf < PLAYBACK_FRAME_INTERVAL_MS) {
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
    const followJustEnabled = state.followEgo && !prev.followEgo;
    const dataChanged = state.data !== prev.data;
    const ego = state.data?.entities.find((entity) => entity.ego);

    if (state.followEgo !== prev.followEgo || dataChanged) {
      getViewportRenderer()?.setChaseCameraActive(
        Boolean(state.followEgo && ego && ego.rows.length > 0),
      );
    }

    // Update the camera before actor buffers are submitted so both use the same
    // playhead in the one frame rendered below.
    if (
      state.followEgo &&
      state.data &&
      (timeChanged || followJustEnabled || dataChanged)
    ) {
      if (ego && ego.rows.length > 0) {
        const pose = interpPose(ego.rows, state.currentTime);
        const now = performance.now();
        const shouldSnap =
          followJustEnabled ||
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
        getViewportRenderer()?.setChaseCam3D(
          followPose.x,
          followPose.y,
          followPose.z,
          followPose.yaw,
        );
      }
    } else if (!state.followEgo) {
      followPose = null;
      followPerf = 0;
      followPrevGround = null;
    }

    const followChanged = state.followEgo !== prev.followEgo;
    if (dataChanged) {
      if (!state.data) {
        clearRenderer();
        return;
      }
      // Trajectory ribbons are intentionally not drawn (ego/opponent paths are
      // hidden); clear any stale ribbons from a previous dataset.
      getViewportRenderer()?.uploadPathVertices(new Float32Array(0));
      renderActorsAt(state.currentTime);
    } else if (timeChanged || followChanged) {
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
  // clear() sets data → null, which the subscription turns into a buffer clear.
  useTrajectoryStore.getState().clear();
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
