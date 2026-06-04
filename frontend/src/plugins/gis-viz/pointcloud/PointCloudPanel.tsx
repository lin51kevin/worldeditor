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
  const setColorMode = usePointCloudStore((s) => s.setColorMode);
  const setVoxelSize = usePointCloudStore((s) => s.setVoxelSize);

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
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, color: '#c9d1d9' }}>
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{t('pointcloud.title')}</h3>

      {isWeb && (
        <input ref={fileInputRef} type="file" accept={WEB_ACCEPT} style={{ display: 'none' }} onChange={onWebFile} />
      )}

      <button type="button" disabled={busy} onClick={onLoadClick} style={btnStyle}>
        {loaded ? t('pointcloud.loadAnother') : t('pointcloud.loadPointCloud')}
      </button>

      {isWeb && (
        <div style={{ fontSize: 11, color: '#8b949e' }}>
          {t('pointcloud.webHint')}
        </div>
      )}

      {summary && (
        <div style={cardStyle}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{fileName}</div>
          <Row label={t('pointcloud.points')} value={fmt(summary.count)} />
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

      <label style={fieldStyle}>
        <span>{t('pointcloud.colorMode')}</span>
        <select
          value={colorMode}
          disabled={!loaded}
          onChange={(e) => setColorMode(e.target.value as PointCloudColorMode)}
        >
          {COLOR_MODE_KEYS.map((m) => (
            <option key={m.value} value={m.value}>{t(m.key)}</option>
          ))}
        </select>
      </label>

      <label style={fieldStyle}>
        <span>{t('pointcloud.voxelSize')}</span>
        <input
          type="number"
          min={0}
          step={0.05}
          value={voxelSize}
          disabled={busy}
          onChange={(e) => setVoxelSize(Number(e.target.value))}
          style={{ width: 72 }}
        />
      </label>

      <hr style={{ width: '100%', borderColor: '#30363d', opacity: 0.5 }} />

      <div style={{ fontSize: 12, fontWeight: 600 }}>{t('pointcloud.workflow')}</div>

      {busy && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
          <Spinner />
          <span style={{ fontSize: 12, color: '#58a6ff' }}>{t('pointcloud.working')}</span>
        </div>
      )}

      <button type="button" disabled={!loaded || busy} onClick={() => void extractGround()} style={btnStyle}>
        {hasGround ? t('pointcloud.extractGroundDone') : t('pointcloud.extractGround')}
      </button>
      <button type="button" disabled={!loaded || busy} onClick={() => void extractMarkings()} style={btnStyle}>
        {t('pointcloud.extractMarkings')}{markings.length > 0 ? ` (${markings.length})` : ''}
      </button>
      <button
        type="button"
        disabled={!loaded || busy || markings.length === 0}
        onClick={() => void vectorizeToRoads()}
        style={btnPrimaryStyle}
      >
        {t('pointcloud.vectorize')}
      </button>

      <div style={{ fontSize: 11, color: '#8b949e' }}>
        {t('pointcloud.stage')}: {stage}
      </div>

      {error && (
        <div style={{ fontSize: 11, color: '#f85149', whiteSpace: 'pre-wrap' }}>{error}</div>
      )}

      {loaded && (
        <button type="button" disabled={busy} onClick={() => void freeCurrentCloud()} style={btnStyle}>
          {t('pointcloud.unload')}
        </button>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
      <span style={{ color: '#8b949e' }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: '6px 10px',
  background: '#21262d',
  color: '#c9d1d9',
  border: '1px solid #30363d',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 12,
};

const btnPrimaryStyle: React.CSSProperties = {
  ...btnStyle,
  background: '#1f6feb',
  borderColor: '#1f6feb',
  color: '#ffffff',
  fontWeight: 600,
};

const cardStyle: React.CSSProperties = {
  background: '#0d1117',
  border: '1px solid #30363d',
  borderRadius: 6,
  padding: 8,
};

const fieldStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontSize: 12,
};

function Spinner() {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 14,
        height: 14,
        border: '2px solid #30363d',
        borderTopColor: '#58a6ff',
        borderRadius: '50%',
        animation: 'pc-spin 0.8s linear infinite',
      }}
    >
      <style>{`@keyframes pc-spin { to { transform: rotate(360deg); } }`}</style>
    </span>
  );
}
