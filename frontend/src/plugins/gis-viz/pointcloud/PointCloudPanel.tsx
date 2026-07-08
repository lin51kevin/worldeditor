import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { PointCloudColorMode } from '../../../services/platform';
import { usePointCloudStore } from './pointcloudState';
import {
  extractGround,
  extractMarkings,
  freeCurrentCloud,
  loadPointCloud,
  vectorizeToRoads,
} from './pointcloudActions';
import './PointCloudPanel.css';

const COLOR_MODE_KEYS: Array<{ value: PointCloudColorMode; key: string }> = [
  { value: 'elevation', key: 'pointcloud.colorElevation' },
  { value: 'intensity', key: 'pointcloud.colorIntensity' },
  { value: 'rgb', key: 'pointcloud.colorRgb' },
];

const WEB_ACCEPT = '.pcd,.ply,.xyz,.txt,.asc';

function fmt(n: number): string {
  return n.toLocaleString();
}

export default function PointCloudPanel() {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handle = usePointCloudStore((s) => s.handle);
  const fileName = usePointCloudStore((s) => s.fileName);
  const summary = usePointCloudStore((s) => s.summary);
  const stage = usePointCloudStore((s) => s.stage);
  const busy = usePointCloudStore((s) => s.busy);
  const error = usePointCloudStore((s) => s.error);
  const colorMode = usePointCloudStore((s) => s.colorMode);
  const voxelSize = usePointCloudStore((s) => s.voxelSize);
  const hasGround = usePointCloudStore((s) => s.hasGround);
  const markings = usePointCloudStore((s) => s.markings);
  const isSplat = usePointCloudStore((s) => s.isSplat);
  const splatShDegree = usePointCloudStore((s) => s.splatShDegree);
  const splatDilation = usePointCloudStore((s) => s.splatDilation);
  const setColorMode = usePointCloudStore((s) => s.setColorMode);
  const setVoxelSize = usePointCloudStore((s) => s.setVoxelSize);
  const setSplatDilation = usePointCloudStore((s) => s.setSplatDilation);

  const isWeb = !(typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window);
  const loaded = handle !== null;

  const onLoadClick = () => {
    if (isWeb) {
      fileInputRef.current?.click();
    } else {
      void loadPointCloud();
    }
  };

  const onWebFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void loadPointCloud(file);
  };

  return (
    <div className="pc-panel">
      <h3>{t('pointcloud.title')}</h3>

      {isWeb && (
        <input ref={fileInputRef} type="file" accept={WEB_ACCEPT} style={{ display: 'none' }} onChange={onWebFile} />
      )}

      <button type="button" disabled={busy} onClick={onLoadClick} className="pc-btn">
        {loaded ? t('pointcloud.loadAnother') : t('pointcloud.loadPointCloud')}
      </button>

      {isWeb && (
        <div className="pc-hint">
          {t('pointcloud.webHint')}
        </div>
      )}

      {summary && (
        <div className="pc-card">
          <div className="pc-card-title">{fileName}</div>
          {isSplat && (
            <Row label={t('pointcloud.renderMode')} value={`3DGS · SH ${splatShDegree}`} />
          )}
          <Row label={isSplat ? t('pointcloud.splats') : t('pointcloud.points')} value={fmt(summary.count)} />
          <Row label={t('pointcloud.hasRgb')} value={summary.has_rgb ? t('pointcloud.yes') : t('pointcloud.no')} />
          <Row label={t('pointcloud.hasIntensity')} value={summary.has_intensity ? t('pointcloud.yes') : t('pointcloud.no')} />
          <Row
            label={t('pointcloud.boundsX')}
            value={`${summary.min[0].toFixed(1)} … ${summary.max[0].toFixed(1)}`}
          />
          <Row
            label={t('pointcloud.boundsY')}
            value={`${summary.min[1].toFixed(1)} … ${summary.max[1].toFixed(1)}`}
          />
        </div>
      )}

      <label className="pc-field">
        <span>{t('pointcloud.colorMode')}</span>
        <select
          value={colorMode}
          disabled={!loaded || isSplat}
          onChange={(e) => setColorMode(e.target.value as PointCloudColorMode)}
        >
          {COLOR_MODE_KEYS.map((m) => (
            <option key={m.value} value={m.value}>{t(m.key)}</option>
          ))}
        </select>
      </label>

      {isSplat && (
        <label className="pc-field">
          <span>{t('pointcloud.splatSize')} ({splatDilation.toFixed(2)})</span>
          <input
            type="range"
            min={0.1}
            max={3}
            step={0.05}
            value={splatDilation}
            onChange={(e) => setSplatDilation(Number(e.target.value))}
          />
        </label>
      )}

      <label className="pc-field">
        <span>{t('pointcloud.voxelSize')}</span>
        <input
          type="number"
          min={0}
          step={0.05}
          value={voxelSize}
          disabled={busy}
          onChange={(e) => setVoxelSize(Number(e.target.value))}
        />
      </label>

      <hr className="pc-divider" />

      <div className="pc-section-title">{t('pointcloud.workflow')}</div>

      {busy && (
        <div className="pc-busy">
          <span className="pc-spinner" />
          <span className="pc-busy-text">{t('pointcloud.working')}</span>
        </div>
      )}

      <button type="button" disabled={!loaded || busy || isSplat} onClick={() => void extractGround()} className="pc-btn">
        {hasGround ? t('pointcloud.extractGroundDone') : t('pointcloud.extractGround')}
      </button>
      <button type="button" disabled={!loaded || busy || isSplat} onClick={() => void extractMarkings()} className="pc-btn">
        {t('pointcloud.extractMarkings')}{markings.length > 0 ? ` (${markings.length})` : ''}
      </button>
      <button
        type="button"
        disabled={!loaded || busy || isSplat || markings.length === 0}
        onClick={() => void vectorizeToRoads()}
        className="pc-btn-primary"
      >
        {t('pointcloud.vectorize')}
      </button>

      <div className="pc-stage">
        {t('pointcloud.stage')}: {stage}
      </div>

      {error && (
        <div className="pc-error">{error}</div>
      )}

      {loaded && (
        <button type="button" disabled={busy} onClick={() => void freeCurrentCloud()} className="pc-btn">
          {t('pointcloud.unload')}
        </button>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="pc-row">
      <span className="pc-row-label">{label}</span>
      <span>{value}</span>
    </div>
  );
}
