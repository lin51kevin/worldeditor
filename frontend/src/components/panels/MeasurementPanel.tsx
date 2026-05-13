import { useTranslation } from 'react-i18next';
import { useEditorViewStore, type MeasureMode, type MeasurementResult } from '../../stores/editorViewStore';
import './MeasurementPanel.css';

function requiredPoints(mode: MeasureMode): number {
  switch (mode) {
    case 'distance': return 2;
    case 'angle': return 3;
    case 'area': return 3;
    default: return 0;
  }
}

function formatResult(result: MeasurementResult, t: (key: string) => string): React.ReactNode {
  switch (result.type) {
    case 'distance':
      return (
        <div className="measure-result">
          <div className="measure-row">
            <span className="measure-label">{t('measurement.straight')}</span>
            <span className="measure-value">{result.value.straight.toFixed(3)} m</span>
          </div>
          <div className="measure-row">
            <span className="measure-label">{t('measurement.horizontal')}</span>
            <span className="measure-value">{result.value.horizontal.toFixed(3)} m</span>
          </div>
          <div className="measure-row">
            <span className="measure-label">{t('measurement.vertical')}</span>
            <span className="measure-value">{result.value.vertical.toFixed(3)} m</span>
          </div>
        </div>
      );
    case 'angle':
      return (
        <div className="measure-result">
          <div className="measure-row">
            <span className="measure-label">{t('measurement.degrees')}</span>
            <span className="measure-value">{result.value.degrees.toFixed(2)}&deg;</span>
          </div>
          <div className="measure-row">
            <span className="measure-label">{t('measurement.radians')}</span>
            <span className="measure-value">{result.value.radians.toFixed(4)} rad</span>
          </div>
        </div>
      );
    case 'area':
      return (
        <div className="measure-result">
          <div className="measure-row">
            <span className="measure-label">{t('measurement.area')}</span>
            <span className="measure-value">{result.value.area.toFixed(3)} m&sup2;</span>
          </div>
          <div className="measure-row">
            <span className="measure-label">{t('measurement.perimeter')}</span>
            <span className="measure-value">{result.value.perimeter.toFixed(3)} m</span>
          </div>
        </div>
      );
  }
}

export function MeasurementPanel() {
  const { t } = useTranslation();
  const measureMode = useEditorViewStore((s) => s.measureMode);
  const measurePoints = useEditorViewStore((s) => s.measurePoints);
  const lastMeasurement = useEditorViewStore((s) => s.lastMeasurement);
  const setMeasureMode = useEditorViewStore((s) => s.setMeasureMode);
  const clearMeasurePoints = useEditorViewStore((s) => s.clearMeasurePoints);

  if (measureMode === 'none') return null;

  const needed = requiredPoints(measureMode);
  const remaining = Math.max(0, needed - measurePoints.length);

  return (
    <div className="measurement-panel" data-testid="measurement-panel">
      <div className="measurement-header">
        <span className="measurement-title">{t('measurement.title')}</span>
        <button
          className="measurement-close"
          onClick={() => setMeasureMode('none')}
          title={t('measurement.clear')}
        >
          &times;
        </button>
      </div>

      <div className="measurement-modes">
        {(['distance', 'angle', 'area'] as const).map((mode) => (
          <button
            key={mode}
            className={`measurement-mode-btn ${measureMode === mode ? 'active' : ''}`}
            onClick={() => setMeasureMode(mode)}
            data-testid={`measure-mode-${mode}`}
          >
            {t(`measurement.${mode}`)}
          </button>
        ))}
      </div>

      <div className="measurement-status">
        {measurePoints.length > 0 && (
          <span>{t('measurement.pointCount', { count: measurePoints.length })}</span>
        )}
        {remaining > 0 && (
          <span className="measurement-hint">
            {t('measurement.needMorePoints', { count: remaining })}
          </span>
        )}
      </div>

      {lastMeasurement && formatResult(lastMeasurement, t)}

      {measurePoints.length > 0 && (
        <button className="measurement-clear-btn" onClick={clearMeasurePoints}>
          {t('measurement.clear')}
        </button>
      )}
    </div>
  );
}
