import { useTranslation } from 'react-i18next';
import { Play, Pause, SkipBack, SkipForward, Repeat, FolderOpen, X } from 'lucide-react';
import {
  useTrajectoryStore,
  TRAJECTORY_SPEEDS,
  type TrajectorySpeed,
} from '../../stores/trajectoryStore';
import { promptImportTrajectory, stopTrajectory } from '../../viewport/trajectoryPlayback';
import './TrajectoryPlaybackBar.css';

/** Format seconds as `mm:ss.s` for the time readout. */
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '00:00.0';
  const clamped = Math.max(0, seconds);
  const mins = Math.floor(clamped / 60);
  const secs = clamped - mins * 60;
  return `${String(mins).padStart(2, '0')}:${secs.toFixed(1).padStart(4, '0')}`;
}

export function TrajectoryPlaybackBar() {
  const { t } = useTranslation();
  const data = useTrajectoryStore((s) => s.data);
  const tMin = useTrajectoryStore((s) => s.tMin);
  const tMax = useTrajectoryStore((s) => s.tMax);
  const currentTime = useTrajectoryStore((s) => s.currentTime);
  const isPlaying = useTrajectoryStore((s) => s.isPlaying);
  const loop = useTrajectoryStore((s) => s.loop);
  const speed = useTrajectoryStore((s) => s.speed);
  const toggle = useTrajectoryStore((s) => s.toggle);
  const seek = useTrajectoryStore((s) => s.seek);
  const stepFrame = useTrajectoryStore((s) => s.stepFrame);
  const setSpeed = useTrajectoryStore((s) => s.setSpeed);
  const toggleLoop = useTrajectoryStore((s) => s.toggleLoop);

  if (!data) return null;

  const span = tMax - tMin;
  const elapsed = currentTime - tMin;
  const total = span > 0 ? span : 0;

  return (
    <div className="traj-playback-bar" role="group" aria-label={t('trajectory.title')}>
      <button
        type="button"
        className="traj-btn"
        onClick={() => stepFrame(-1)}
        title={t('trajectory.prevFrame')}
        aria-label={t('trajectory.prevFrame')}
      >
        <SkipBack size={16} />
      </button>

      <button
        type="button"
        className="traj-btn traj-btn-primary"
        onClick={toggle}
        title={isPlaying ? t('trajectory.pause') : t('trajectory.play')}
        aria-label={isPlaying ? t('trajectory.pause') : t('trajectory.play')}
      >
        {isPlaying ? <Pause size={18} /> : <Play size={18} />}
      </button>

      <button
        type="button"
        className="traj-btn"
        onClick={() => stepFrame(1)}
        title={t('trajectory.nextFrame')}
        aria-label={t('trajectory.nextFrame')}
      >
        <SkipForward size={16} />
      </button>

      <button
        type="button"
        className={`traj-btn ${loop ? 'active' : ''}`}
        onClick={toggleLoop}
        title={t('trajectory.loop')}
        aria-label={t('trajectory.loop')}
        aria-pressed={loop}
      >
        <Repeat size={15} />
      </button>

      <select
        className="traj-speed"
        value={speed}
        onChange={(e) => setSpeed(Number(e.target.value) as TrajectorySpeed)}
        title={t('trajectory.speed')}
        aria-label={t('trajectory.speed')}
      >
        {TRAJECTORY_SPEEDS.map((s) => (
          <option key={s} value={s}>{s}×</option>
        ))}
      </select>

      <input
        type="range"
        className="traj-scrubber"
        min={tMin}
        max={tMax}
        step={span > 0 ? span / 1000 : 0.001}
        value={currentTime}
        onChange={(e) => seek(Number(e.target.value))}
        aria-label={t('trajectory.timeline')}
      />

      <span className="traj-time" aria-live="off">
        {formatTime(elapsed)} / {formatTime(total)}
      </span>

      <button
        type="button"
        className="traj-btn"
        onClick={() => promptImportTrajectory()}
        title={t('trajectory.import')}
        aria-label={t('trajectory.import')}
      >
        <FolderOpen size={16} />
      </button>

      <button
        type="button"
        className="traj-btn traj-btn-close"
        onClick={() => stopTrajectory()}
        title={t('trajectory.clear')}
        aria-label={t('trajectory.clear')}
      >
        <X size={16} />
      </button>
    </div>
  );
}
