import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Pause, SkipBack, SkipForward, Repeat, Video, Gauge, FolderOpen, Settings, Info, X } from 'lucide-react';
import {
  useTrajectoryStore,
  TRAJECTORY_SPEEDS,
  type TrajectorySpeed,
  type TrajectoryCameraMode,
} from '../../../stores/trajectoryStore';
import { useTrajectoryConfigStore } from '../../../stores/trajectoryConfigStore';
import { promptImportTrajectory, stopTrajectory } from '../../../viewport/trajectoryPlayback';
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
  const [infoOpen, setInfoOpen] = useState(false);
  const data = useTrajectoryStore((s) => s.data);
  const fileName = useTrajectoryStore((s) => s.fileName);
  const filePath = useTrajectoryStore((s) => s.filePath);
  const frames = useTrajectoryStore((s) => s.frames);
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
  const cameraMode = useTrajectoryStore((s) => s.cameraMode);
  const setCameraMode = useTrajectoryStore((s) => s.setCameraMode);
  const configOpen = useTrajectoryConfigStore((s) => s.configOpen);
  const toggleConfigOpen = useTrajectoryConfigStore((s) => s.toggleConfigOpen);
  const statsHudOpen = useTrajectoryConfigStore((s) => s.statsHudOpen);
  const toggleStatsHud = useTrajectoryConfigStore((s) => s.toggleStatsHud);

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

      <div
        className={`traj-camera ${cameraMode !== 'off' ? 'active' : ''}`}
        title={t('trajectory.cameraMode')}
      >
        <Video size={15} aria-hidden="true" />
        <select
          className="traj-camera-select"
          value={cameraMode}
          onChange={(e) => setCameraMode(e.target.value as TrajectoryCameraMode)}
          aria-label={t('trajectory.cameraMode')}
        >
          <option value="off">{t('trajectory.cameraOff')}</option>
          <option value="follow">{t('trajectory.cameraFollow')}</option>
          <option value="front">{t('trajectory.cameraFront')}</option>
        </select>
      </div>

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
        className={`traj-btn ${statsHudOpen ? 'active' : ''}`}
        onClick={() => toggleStatsHud()}
        title={t('trajectory.stats.toggle')}
        aria-label={t('trajectory.stats.toggle')}
        aria-pressed={statsHudOpen}
      >
        <Gauge size={16} />
      </button>

      <button
        type="button"
        className={`traj-btn ${configOpen ? 'active' : ''}`}
        onClick={() => toggleConfigOpen()}
        title={t('trajectory.settings')}
        aria-label={t('trajectory.settings')}
        aria-pressed={configOpen}
      >
        <Settings size={16} />
      </button>

      <div className="traj-info-anchor">
        <button
          type="button"
          className={`traj-btn ${infoOpen ? 'active' : ''}`}
          onClick={() => setInfoOpen((v) => !v)}
          title={t('trajectory.info')}
          aria-label={t('trajectory.info')}
          aria-pressed={infoOpen}
        >
          <Info size={16} />
        </button>
        {infoOpen && (
          <div className="traj-info-popup" role="tooltip">
            <div className="traj-info-row"><span className="traj-info-label">{t('trajectory.infoFile')}</span><span className="traj-info-value" title={fileName ?? '—'}>{fileName ?? '—'}</span></div>
            {filePath && (
              <div className="traj-info-row"><span className="traj-info-label">{t('trajectory.infoDir')}</span><span className="traj-info-value" title={filePath.replace(/[/\\][^/\\]*$/, '')}>{filePath.replace(/[/\\][^/\\]*$/, '')}</span></div>
            )}
            <div className="traj-info-row"><span className="traj-info-label">{t('trajectory.infoEntities')}</span><span className="traj-info-value">{data.entities.length}</span></div>
            <div className="traj-info-row"><span className="traj-info-label">{t('trajectory.infoFrames')}</span><span className="traj-info-value">{frames.length}</span></div>
            <div className="traj-info-row"><span className="traj-info-label">{t('trajectory.infoDuration')}</span><span className="traj-info-value">{formatTime(span)}</span></div>
            <div className="traj-info-row"><span className="traj-info-label">{t('trajectory.infoSampleRate')}</span><span className="traj-info-value">{span > 0 ? (frames.length / span).toFixed(1) : '—'} Hz</span></div>
          </div>
        )}
      </div>

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
