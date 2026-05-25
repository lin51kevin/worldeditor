import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useProjectStore } from '../../../stores/projectStore';
import type { RoadSignal, Road } from '../../../services/platform';
import { COMMON_SIGNAL_TYPES } from '../../../hooks/useSignalPlacement';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getRoadLateralRange(road: Road): number {
  let maxWidth = 8;
  for (const section of road.lane_sections) {
    const leftWidth = section.left.reduce((sum, lane) => sum + (lane.width[0]?.a ?? 3.5), 0);
    const rightWidth = section.right.reduce((sum, lane) => sum + (lane.width[0]?.a ?? 3.5), 0);
    maxWidth = Math.max(maxWidth, leftWidth, rightWidth);
  }
  return Math.max(8, Math.ceil(maxWidth + 4));
}

interface SignalPropertiesCardProps {
  signal: RoadSignal;
  road: Road;
}

export const SignalPropertiesCard = memo(function SignalPropertiesCard({ signal, road }: SignalPropertiesCardProps) {
  const { t } = useTranslation();
  const roadLength = road.length;
  const tRange = getRoadLateralRange(road);

  const signalTypeOptions = (() => {
    const currentType = signal.signal_type;
    const options = COMMON_SIGNAL_TYPES.map((option) => ({
      value: option.type,
      label: t(option.labelKey, option.type),
    }));
    if (currentType && !options.some((option) => option.value === currentType)) {
      options.unshift({ value: currentType, label: currentType });
    }
    return options;
  })();

  return (
    <>
      <div className="property-row">
        <span className="property-label">{t('propertyPanel.id')}</span>
        <span className="property-value">{signal.id}</span>
      </div>
      <div className="property-row">
        <span className="property-label">RoadId</span>
        <span className="property-value">{road.id}</span>
      </div>
      <div className="property-row property-row--stacked">
        <span className="property-label">{t('propertyPanel.station')}</span>
        <div className="property-control-stack">
          <input
            type="range"
            className="property-range"
            min={0}
            max={Math.max(roadLength, 0.1)}
            step={0.1}
            value={clamp(signal.s, 0, Math.max(roadLength, 0.1))}
            onChange={(event) => useProjectStore.getState().updateSignal(signal.id, {
              s: clamp(Number(event.target.value), 0, road.length),
            })}
          />
          <span className="property-range-value">{signal.s.toFixed(2)} m</span>
        </div>
      </div>
      <div className="property-row property-row--stacked">
        <span className="property-label">{t('propertyPanel.lateralOffset')}</span>
        <div className="property-control-stack">
          <input
            type="range"
            className="property-range"
            min={-tRange}
            max={tRange}
            step={0.1}
            value={clamp(signal.t, -tRange, tRange)}
            onChange={(event) => useProjectStore.getState().updateSignal(signal.id, {
              t: Number(event.target.value),
            })}
          />
          <span className="property-range-value">{signal.t.toFixed(2)} m</span>
        </div>
      </div>
      <div className="property-row">
        <span className="property-label">{t('propertyPanel.signalType')}</span>
        <select
          className="property-select"
          value={signal.signal_type}
          onChange={(event) => useProjectStore.getState().updateSignal(signal.id, {
            signal_type: event.target.value,
            is_dynamic: event.target.value === 'traffic_light',
          })}
        >
          {signalTypeOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
      <div className="property-row">
        <span className="property-label">{t('propertyPanel.signalValue')}</span>
        <input
          className="property-input"
          value={signal.value ?? ''}
          onChange={(event) => useProjectStore.getState().updateSignal(signal.id, {
            value: event.target.value.trim() === '' ? null : event.target.value,
          })}
        />
      </div>
      <div className="property-row">
        <span className="property-label">{t('propertyPanel.signalOrientation')}</span>
        <select
          className="property-select"
          value={signal.orientation}
          onChange={(event) => useProjectStore.getState().updateSignal(signal.id, {
            orientation: event.target.value,
          })}
        >
          <option value="+">+</option>
          <option value="-">-</option>
          <option value="none">none</option>
        </select>
      </div>
      <div className="property-row">
        <span className="property-label">{t('propertyPanel.headingOffset', 'HeadingLocal')}</span>
        <span className="property-value">{signal.h_offset.toFixed(5)}</span>
      </div>
      <div className="property-row">
        <span className="property-label">{t('propertyPanel.positionLocal', 'PositionLocal')}</span>
        <span className="property-value">
          {signal.s.toFixed(5)}&nbsp;&nbsp;{signal.t.toFixed(5)}&nbsp;&nbsp;{signal.z_offset.toFixed(5)}
        </span>
      </div>
    </>
  );
});
