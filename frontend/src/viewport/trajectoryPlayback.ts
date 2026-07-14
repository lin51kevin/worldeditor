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
  buildPathVertices,
  buildTrajBoxes,
  buildTrajSegments,
  parseTraj,
  trajBounds,
  PATH_HALF_WIDTH,
} from '../plugins/npc-actors';
import type { TrajData } from '../plugins/npc-actors';
import { getViewportRenderer } from './viewportRef';
import { useTrajectoryStore } from '../stores/trajectoryStore';
import { showAlert } from '../utils/dialog';
import i18n from '../i18n';

/** Max size (bytes) accepted for a trajectory import (guards runaway files). */
const MAX_TRAJECTORY_SIZE_BYTES = 100 * 1024 * 1024;

// Origin the trajectory geometry is shifted into (aligns with an origin-relative
// point cloud). Module-level: a single viewport at a time.
let sceneOrigin: [number, number, number] = [0, 0, 0];
let rafId = 0;
let lastPerf = 0;
let unsub: (() => void) | null = null;

/** Rebuild + upload the actor boxes for time `t` and render one frame. */
function renderActorsAt(t: number): void {
  const { data } = useTrajectoryStore.getState();
  const renderer = getViewportRenderer();
  if (!renderer || !data) return;
  renderer.uploadActorVertices(buildBoxVertices(buildTrajBoxes(data, t), sceneOrigin));
  renderer.render();
}

/** Upload the (static) trajectory ribbon geometry for the loaded dataset. */
function uploadPath(): void {
  const { data } = useTrajectoryStore.getState();
  const renderer = getViewportRenderer();
  if (!renderer || !data) return;
  renderer.uploadPathVertices(
    buildPathVertices(buildTrajSegments(data), PATH_HALF_WIDTH, sceneOrigin),
  );
}

/** Clear both actor and ribbon buffers from the renderer. */
function clearRenderer(): void {
  const renderer = getViewportRenderer();
  if (!renderer) return;
  renderer.uploadActorVertices(new Float32Array(0));
  renderer.uploadPathVertices(new Float32Array(0));
  renderer.render();
}

/** The RAF clock: advance the playhead by real elapsed time × speed. */
function tick(): void {
  const s = useTrajectoryStore.getState();
  if (!s.isPlaying || !s.data) {
    rafId = 0;
    return;
  }
  const now = performance.now();
  const dt = (now - lastPerf) / 1000;
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
    if (state.data !== prev.data) {
      if (!state.data) {
        clearRenderer();
        return;
      }
      uploadPath();
      renderActorsAt(state.currentTime);
    } else if (state.currentTime !== prev.currentTime) {
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
