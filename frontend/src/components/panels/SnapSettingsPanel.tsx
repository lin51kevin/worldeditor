import { useTranslation } from 'react-i18next';
import { useViewportStore } from '../../stores/viewportStore';

const SNAP_THRESHOLD_MIN = 1;
const SNAP_THRESHOLD_MAX = 50;
const GRID_SIZE_MIN = 0.5;
const GRID_SIZE_MAX = 100;

export function SnapSettingsPanel() {
  const { t } = useTranslation();
  const snapToEndpoints = useViewportStore((state) => state.snapToEndpoints);
  const snapToMidpoints = useViewportStore((state) => state.snapToMidpoints);
  const snapToPerpendicular = useViewportStore((state) => state.snapToPerpendicular);
  const snapToGrid = useViewportStore((state) => state.snapToGrid);
  const snapToLaneEndpoints = useViewportStore((state) => state.snapToLaneEndpoints);
  const snapThreshold = useViewportStore((state) => state.snapThreshold);
  const gridSnapSize = useViewportStore((state) => state.gridSnapSize);
  const setSnapToEndpoints = useViewportStore((state) => state.setSnapToEndpoints);
  const setSnapToMidpoints = useViewportStore((state) => state.setSnapToMidpoints);
  const setSnapToPerpendicular = useViewportStore((state) => state.setSnapToPerpendicular);
  const setSnapToGrid = useViewportStore((state) => state.setSnapToGrid);
  const setSnapToLaneEndpoints = useViewportStore((state) => state.setSnapToLaneEndpoints);
  const setSnapThreshold = useViewportStore((state) => state.setSnapThreshold);
  const setGridSnapSize = useViewportStore((state) => state.setGridSnapSize);

  return (
    <div
      className="menubar-snap-settings-panel"
      role="dialog"
      aria-label={t('snapSettings.title')}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="menubar-snap-settings-header">{t('snapSettings.title')}</div>
      <div className="menubar-snap-settings-section">
        <span className="menubar-snap-settings-section-label">{t('snapSettings.types')}</span>
        <label className="menubar-snap-settings-checkbox">
          <input
            type="checkbox"
            checked={snapToEndpoints}
            onChange={(event) => setSnapToEndpoints(event.target.checked)}
          />
          <span>{t('snapSettings.endpoints')}</span>
        </label>
        <label className="menubar-snap-settings-checkbox">
          <input
            type="checkbox"
            checked={snapToMidpoints}
            onChange={(event) => setSnapToMidpoints(event.target.checked)}
          />
          <span>{t('snapSettings.midpoints')}</span>
        </label>
        <label className="menubar-snap-settings-checkbox">
          <input
            type="checkbox"
            checked={snapToPerpendicular}
            onChange={(event) => setSnapToPerpendicular(event.target.checked)}
          />
          <span>{t('snapSettings.perpendicular')}</span>
        </label>
        <label className="menubar-snap-settings-checkbox">
          <input
            type="checkbox"
            checked={snapToGrid}
            onChange={(event) => setSnapToGrid(event.target.checked)}
          />
          <span>{t('snapSettings.grid')}</span>
        </label>
        <label className="menubar-snap-settings-checkbox">
          <input
            type="checkbox"
            checked={snapToLaneEndpoints}
            onChange={(event) => setSnapToLaneEndpoints(event.target.checked)}
          />
          <span>{t('snapSettings.laneEndpoints')}</span>
        </label>
      </div>

      <div className="menubar-snap-settings-field">
        <div className="menubar-snap-settings-field-header">
          <label htmlFor="snap-threshold-slider">{t('snapSettings.threshold')}</label>
          <span>{t('snapSettings.thresholdValue', { value: Math.round(snapThreshold) })}</span>
        </div>
        <input
          id="snap-threshold-slider"
          className="menubar-snap-settings-range"
          type="range"
          min={SNAP_THRESHOLD_MIN}
          max={SNAP_THRESHOLD_MAX}
          value={Math.min(SNAP_THRESHOLD_MAX, Math.max(SNAP_THRESHOLD_MIN, snapThreshold))}
          onChange={(event) => setSnapThreshold(Number(event.target.value))}
        />
      </div>

      <div className="menubar-snap-settings-field">
        <div className="menubar-snap-settings-field-header">
          <label htmlFor="snap-grid-size-input">{t('snapSettings.gridSize')}</label>
          <span>{t('snapSettings.gridSizeValue', { value: gridSnapSize.toFixed(1) })}</span>
        </div>
        <input
          id="snap-grid-size-input"
          className="menubar-snap-settings-number"
          type="number"
          min={GRID_SIZE_MIN}
          max={GRID_SIZE_MAX}
          step={0.5}
          value={Number.isFinite(gridSnapSize) ? gridSnapSize : GRID_SIZE_MIN}
          onChange={(event) => setGridSnapSize(Number(event.target.value))}
        />
      </div>
    </div>
  );
}
