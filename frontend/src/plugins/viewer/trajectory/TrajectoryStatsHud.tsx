/**
 * Trajectory frame-rate stats HUD.
 *
 * A small floating panel pinned to the viewport's top-right corner that shows
 * live rendering telemetry during trajectory preview: smoothed FPS, single-frame
 * time (ms), the number of trajectory actors, and the total Gaussian-splat count
 * (static scene + dynamic actor clouds).
 *
 * It only mounts when a trajectory is loaded and the HUD toggle is on. Values
 * come from `ViewportRenderer.getRenderStats()`, which reflects only frames the
 * idle-aware render loop actually drew — so when playback is paused and the
 * scene is static the loop parks and the HUD reports an idle frame rate rather
 * than a misleading low number.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTrajectoryStore } from '../../../stores/trajectoryStore';
import { useTrajectoryConfigStore } from '../../../stores/trajectoryConfigStore';
import { getViewportRenderer } from '../../../viewport/viewportRef';
import './TrajectoryStatsHud.css';

/** Sample the render stats this many times per second. */
const HUD_SAMPLE_HZ = 4;
/**
 * If the last drawn frame is older than this (ms), the render loop has parked
 * (nothing is animating) — report the frame rate as idle instead of stale.
 */
const IDLE_AFTER_MS = 500;

interface HudSample {
  fps: number;
  frameTimeMs: number;
  splatCount: number;
  actorCount: number;
  idle: boolean;
}

const ZERO_SAMPLE: HudSample = {
  fps: 0,
  frameTimeMs: 0,
  splatCount: 0,
  actorCount: 0,
  idle: true,
};

/** True when two samples render identically (avoids needless re-renders). */
function sameSample(a: HudSample, b: HudSample): boolean {
  return (
    Math.round(a.fps) === Math.round(b.fps) &&
    Math.round(a.frameTimeMs * 10) === Math.round(b.frameTimeMs * 10) &&
    a.splatCount === b.splatCount &&
    a.actorCount === b.actorCount &&
    a.idle === b.idle
  );
}

export function TrajectoryStatsHud() {
  const { t } = useTranslation();
  const data = useTrajectoryStore((s) => s.data);
  const statsHudOpen = useTrajectoryConfigStore((s) => s.statsHudOpen);
  const [sample, setSample] = useState<HudSample>(ZERO_SAMPLE);
  const lastRef = useRef<HudSample>(ZERO_SAMPLE);

  const active = Boolean(data) && statsHudOpen;

  useEffect(() => {
    if (!active) {
      lastRef.current = ZERO_SAMPLE;
      setSample(ZERO_SAMPLE);
      return;
    }
    const poll = () => {
      const renderer = getViewportRenderer();
      const entities = useTrajectoryStore.getState().data?.entities.length ?? 0;
      if (!renderer) {
        const next: HudSample = { ...ZERO_SAMPLE, actorCount: entities };
        if (!sameSample(lastRef.current, next)) {
          lastRef.current = next;
          setSample(next);
        }
        return;
      }
      const stats = renderer.getRenderStats();
      const idle =
        stats.lastRenderTs <= 0 || performance.now() - stats.lastRenderTs > IDLE_AFTER_MS;
      const next: HudSample = {
        fps: idle ? 0 : stats.fps,
        frameTimeMs: idle ? 0 : stats.frameTimeMs,
        splatCount: stats.splatCount,
        actorCount: entities,
        idle,
      };
      if (!sameSample(lastRef.current, next)) {
        lastRef.current = next;
        setSample(next);
      }
    };
    poll();
    const id = window.setInterval(poll, 1000 / HUD_SAMPLE_HZ);
    return () => window.clearInterval(id);
  }, [active]);

  if (!active) return null;

  const fpsText = sample.idle ? t('trajectory.stats.idle') : String(Math.round(sample.fps));
  const msText = sample.idle ? '—' : sample.frameTimeMs.toFixed(1);

  return (
    <div className="traj-stats-hud" role="status" aria-label={t('trajectory.stats.title')}>
      <div className="traj-stats-row">
        <span className="traj-stats-label">{t('trajectory.stats.fps')}</span>
        <span className="traj-stats-value">{fpsText}</span>
      </div>
      <div className="traj-stats-row">
        <span className="traj-stats-label">{t('trajectory.stats.frameTime')}</span>
        <span className="traj-stats-value">{msText} ms</span>
      </div>
      <div className="traj-stats-row">
        <span className="traj-stats-label">{t('trajectory.stats.actors')}</span>
        <span className="traj-stats-value">{sample.actorCount}</span>
      </div>
      <div className="traj-stats-row">
        <span className="traj-stats-label">{t('trajectory.stats.splats')}</span>
        <span className="traj-stats-value">{sample.splatCount.toLocaleString()}</span>
      </div>
    </div>
  );
}
