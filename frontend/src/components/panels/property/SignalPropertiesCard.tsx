import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useProjectStore } from '../../../stores/projectStore';
import type { RoadSignal, Road } from '../../../services/platform';
import { COMMON_SIGNAL_TYPES } from '../../../hooks/useSignalPlacement';
import { NumberField, ReadOnlyField, SliderField, TextField, roadLateralRange } from './PropertyFields';
import { showConfirm } from '../../../utils/dialog';

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

interface SignalPropertiesCardProps {
  signal: RoadSignal;
  road: Road;
}

export const SignalPropertiesCard = memo(function SignalPropertiesCard({ signal, road }: SignalPropertiesCardProps) {
  const { t } = useTranslation();
  const roadLength = Math.max(road.length, 0.1);
  const tRange = roadLateralRange(road.lane_sections);

  const update = (updates: Partial<RoadSignal>) =>
    useProjectStore.getState().updateSignal(signal.id, updates);

  const handleDelete = async () => {
    const confirmed = await showConfirm(t('dialog.confirmDeleteSignal'));
    if (confirmed) {
      useProjectStore.getState().removeSignal(signal.id);
    }
  };

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
      <ReadOnlyField label={t('propertyPanel.id')}>{signal.id}</ReadOnlyField>
      <ReadOnlyField label="RoadId">{road.id}</ReadOnlyField>

      <TextField
        label={t('propertyPanel.name')}
        value={signal.name}
        onCommit={(name) => update({ name })}
      />

      <SliderField
        label={t('propertyPanel.station')}
        value={signal.s}
        min={0}
        max={roadLength}
        onChange={(s) => update({ s })}
      />
      <SliderField
        label={t('propertyPanel.lateralOffset')}
        value={signal.t}
        min={-tRange}
        max={tRange}
        onChange={(lateral) => update({ t: lateral })}
      />
      <NumberField
        label={t('propertyPanel.zOffset')}
        value={signal.z_offset}
        onChange={(z_offset) => update({ z_offset })}
      />
      <SliderField
        label={t('propertyPanel.heading')}
        value={signal.h_offset * RAD_TO_DEG}
        min={-180}
        max={180}
        step={1}
        unit="°"
        onChange={(deg) => update({ h_offset: deg * DEG_TO_RAD })}
      />

      <div className="property-row">
        <span className="property-label">{t('propertyPanel.signalType')}</span>
        <select
          className="property-select"
          value={signal.signal_type}
          onChange={(event) => update({
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
          onChange={(event) => update({
            value: event.target.value.trim() === '' ? null : event.target.value,
          })}
        />
      </div>
      <div className="property-row">
        <span className="property-label">{t('propertyPanel.signalOrientation')}</span>
        <select
          className="property-select"
          value={signal.orientation}
          onChange={(event) => update({ orientation: event.target.value })}
        >
          <option value="+">+</option>
          <option value="-">-</option>
          <option value="none">none</option>
        </select>
      </div>

      <NumberField
        label={t('propertyPanel.width')}
        value={signal.width}
        min={0}
        onChange={(width) => update({ width })}
      />
      <NumberField
        label={t('propertyPanel.height')}
        value={signal.height}
        min={0}
        onChange={(height) => update({ height })}
      />

      <div className="property-row">
        <span className="property-hint">{t('propertyPanel.transformHint')}</span>
      </div>
      <div className="property-row">
        <button
          className="property-btn property-btn-danger"
          onClick={() => { void handleDelete(); }}
        >
          {t('propertyPanel.deleteSignal')}
        </button>
      </div>
    </>
  );
});
