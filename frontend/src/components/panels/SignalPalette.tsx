import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { COMMON_SIGNAL_TYPES, startSignalPlacement } from '../../hooks/useSignalPlacement';
import { useViewportStore } from '../../stores/viewportStore';

export function SignalPalette() {
  const { t } = useTranslation();
  const editMode = useViewportStore((state) => state.editMode);
  const placement = useViewportStore((state) => state.signalPlacementDraft);

  const selectedLabel = useMemo(() => {
    const matched = COMMON_SIGNAL_TYPES.find((option) => option.type === placement.type);
    return matched ? t(matched.labelKey) : placement.type;
  }, [placement.type, t]);

  return (
    <div className="signal-palette">
      <div className="tool-section-header">- {t('signalPalette.title')}</div>
      <div className="signal-palette__hint">
        {editMode === 'placeSignal'
          ? t('signalPalette.activeHint', { type: selectedLabel })
          : t('signalPalette.idleHint')}
      </div>
      <div className="signal-palette__grid">
        {COMMON_SIGNAL_TYPES.map((option) => {
          const active = editMode === 'placeSignal' && placement.type === option.type;
          return (
            <button
              key={option.type}
              className={`signal-palette__item${active ? ' signal-palette__item--active' : ''}`}
              onClick={() => startSignalPlacement({
                type: option.type,
                value: option.defaultValue ?? '',
                orientation: option.defaultOrientation ?? '+',
              })}
              title={t(option.labelKey)}
              type="button"
            >
              <span className="signal-palette__icon" aria-hidden="true">{option.icon}</span>
              <span className="signal-palette__label">{t(option.labelKey)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
