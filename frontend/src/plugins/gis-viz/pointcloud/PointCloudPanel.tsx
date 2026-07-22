import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { PointCloudColorMode } from '../../../services/platform';
import type { SplatSampleMode, SplatRenderMode } from '../../../viewport/gaussian/splatRenderer';
import { usePointCloudStore } from './pointcloudState';
import {
  freeCurrentCloud,
  loadPointCloud,
} from './pointcloudActions';
import './PointCloudPanel.css';

const COLOR_MODE_KEYS: Array<{ value: PointCloudColorMode; key: string }> = [
  { value: 'elevation', key: 'pointcloud.colorElevation' },
  { value: 'intensity', key: 'pointcloud.colorIntensity' },
  { value: 'rgb', key: 'pointcloud.colorRgb' },
];

const WEB_ACCEPT = '.pcd,.ply,.xyz,.txt,.asc';

/**
 * Temporarily hide the splat-coverage controls (render mode / quality / sample
 * mode). Clouds always load at full coverage; flip to `true` to restore the
 * decimated-preview options.
 */
const SHOW_SPLAT_COVERAGE_CONTROLS = false;

/**
 * Splat depth re-sort (refresh) rate options in FPS. `0` = realtime (re-sort
 * every qualifying frame); the others cap the re-sort rate to trade slightly
 * staler ordering during fast camera motion for lower worker load on very
 * large clouds. Rendering itself always runs at the display rate.
 */
const REFRESH_FPS_OPTIONS = [0, 60, 30, 15, 5] as const;

function fmt(n: number | undefined | null): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString() : '—';
}

/** Format a numeric bound to 1 decimal, tolerating missing values. */
function fmtBound(n: number | undefined | null): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(1) : '—';
}

export default function PointCloudPanel() {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handle = usePointCloudStore((s) => s.handle);
  const fileName = usePointCloudStore((s) => s.fileName);
  const summary = usePointCloudStore((s) => s.summary);
  const busy = usePointCloudStore((s) => s.busy);
  const error = usePointCloudStore((s) => s.error);
  const colorMode = usePointCloudStore((s) => s.colorMode);
  const isSplat = usePointCloudStore((s) => s.isSplat);
  const splatShDegree = usePointCloudStore((s) => s.splatShDegree);
  const splatDilation = usePointCloudStore((s) => s.splatDilation);
  const splatEncodeLinearToSrgb = usePointCloudStore((s) => s.splatEncodeLinearToSrgb);
  const splatSampleMode = usePointCloudStore((s) => s.splatSampleMode);
  const splatRenderMode = usePointCloudStore((s) => s.splatRenderMode);
  const splatQuality = usePointCloudStore((s) => s.splatQuality);
  const splatRefreshFps = usePointCloudStore((s) => s.splatRefreshFps);
  const splatUploadStatus = usePointCloudStore((s) => s.splatUploadStatus);
  const setColorMode = usePointCloudStore((s) => s.setColorMode);
  const setSplatRefreshFps = usePointCloudStore((s) => s.setSplatRefreshFps);
  const setSplatDilation = usePointCloudStore((s) => s.setSplatDilation);
  const setSplatEncodeLinearToSrgb = usePointCloudStore((s) => s.setSplatEncodeLinearToSrgb);
  const setSplatSampleMode = usePointCloudStore((s) => s.setSplatSampleMode);
  const setSplatRenderMode = usePointCloudStore((s) => s.setSplatRenderMode);
  const setSplatQuality = usePointCloudStore((s) => s.setSplatQuality);

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

          {isSplat && splatUploadStatus && (
            <div className="pc-card" data-testid="splat-fidelity-status">
              <div className="pc-card-title">{t('pointcloud.fidelityStatus')}</div>
              <Row
                label={t('pointcloud.uploadedSplats')}
                value={`${fmt(splatUploadStatus.uploadedCount)} / ${fmt(splatUploadStatus.sourceCount)}`}
              />
              <Row
                label={t('pointcloud.shFidelity')}
                value={`${splatUploadStatus.requestedShDegree} → ${splatUploadStatus.effectiveShDegree}`}
              />
              <Row
                label={t('pointcloud.resourceMode')}
                value={t(`pointcloud.resource.${splatUploadStatus.resourceMode}`)}
              />
              {splatUploadStatus.fallbackReason && (
                <div
                  className={splatUploadStatus.outcome === 'failed' ? 'pc-error' : 'pc-warning'}
                  role="status"
                >
                  {t(`pointcloud.fallback.${splatUploadStatus.fallbackReason}`)}
                </div>
              )}
            </div>
          )}
          <Row label={isSplat ? t('pointcloud.splats') : t('pointcloud.points')} value={fmt(summary.count)} />
          <Row label={t('pointcloud.hasRgb')} value={summary.has_rgb ? t('pointcloud.yes') : t('pointcloud.no')} />
          <Row label={t('pointcloud.hasIntensity')} value={summary.has_intensity ? t('pointcloud.yes') : t('pointcloud.no')} />
          <Row
            label={t('pointcloud.boundsX')}
            value={`${fmtBound(summary.min?.[0])} … ${fmtBound(summary.max?.[0])}`}
          />
          <Row
            label={t('pointcloud.boundsY')}
            value={`${fmtBound(summary.min?.[1])} … ${fmtBound(summary.max?.[1])}`}
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

      {isSplat && (
        <div className="pc-field-group">
          <label className="pc-field">
            <span>{t('pointcloud.splatLinearColor')}</span>
            <input
              type="checkbox"
              checked={splatEncodeLinearToSrgb}
              onChange={(e) => setSplatEncodeLinearToSrgb(e.target.checked)}
            />
          </label>
          <p className="pc-hint">{t('pointcloud.splatLinearColorHint')}</p>
        </div>
      )}

      {isSplat && SHOW_SPLAT_COVERAGE_CONTROLS && (
        <div className="pc-field-group">
          <label className="pc-field">
            <span>{t('pointcloud.splatRenderMode')}</span>
            <select
              value={splatRenderMode}
              onChange={(e) => setSplatRenderMode(e.target.value as SplatRenderMode)}
            >
              <option value="full">{t('pointcloud.renderModeFull')}</option>
              <option value="decimated">{t('pointcloud.renderModeDecimated')}</option>
            </select>
          </label>
          <p className="pc-hint">{t('pointcloud.splatRenderModeHint')}</p>
        </div>
      )}

      {isSplat && SHOW_SPLAT_COVERAGE_CONTROLS && (
        <div className="pc-field-group">
          <label className="pc-field">
            <span>{t('pointcloud.splatQuality')} ({Math.round(splatQuality * 100)}%)</span>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={splatQuality}
              disabled={splatRenderMode === 'full'}
              onChange={(e) => setSplatQuality(Number(e.target.value))}
            />
          </label>
          <p className="pc-hint">{t('pointcloud.splatQualityHint')}</p>
        </div>
      )}

      {isSplat && SHOW_SPLAT_COVERAGE_CONTROLS && (
        <div className="pc-field-group">
          <label className="pc-field">
            <span>{t('pointcloud.sampleMode')}</span>
            <select
              value={splatSampleMode}
              disabled={splatRenderMode === 'full'}
              onChange={(e) => setSplatSampleMode(e.target.value as SplatSampleMode)}
            >
              <option value="uniform">{t('pointcloud.sampleUniform')}</option>
              <option value="importance">{t('pointcloud.sampleImportance')}</option>
            </select>
          </label>
          <p className="pc-hint">{t('pointcloud.sampleModeHint')}</p>
        </div>
      )}

      {isSplat && (
        <div className="pc-field-group">
          <label className="pc-field">
            <span>{t('pointcloud.splatRefreshRate')}</span>
            <select
              value={splatRefreshFps}
              onChange={(e) => setSplatRefreshFps(Number(e.target.value))}
            >
              {REFRESH_FPS_OPTIONS.map((fps) => (
                <option key={fps} value={fps}>
                  {fps === 0 ? t('pointcloud.refreshRealtime') : t('pointcloud.refreshFps', { fps })}
                </option>
              ))}
            </select>
          </label>
          <p className="pc-hint">{t('pointcloud.splatRefreshRateHint')}</p>
        </div>
      )}

      {busy && (
        <div className="pc-busy">
          <span className="pc-spinner" />
          <span className="pc-busy-text">{t('pointcloud.working')}</span>
        </div>
      )}

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
