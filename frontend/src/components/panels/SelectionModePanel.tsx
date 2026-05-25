import { useTranslation } from 'react-i18next';
import { useViewportStore } from '../../stores/viewportStore';

type SelectionMode = 'road' | 'laneSection' | 'lane';

const MODES: { value: SelectionMode; labelKey: string }[] = [
  { value: 'road', labelKey: 'toolPanel.selectionModes.road' },
  { value: 'laneSection', labelKey: 'toolPanel.selectionModes.laneSection' },
  { value: 'lane', labelKey: 'toolPanel.selectionModes.lane' },
];

export function SelectionModePanel() {
  const { t } = useTranslation();
  const selectionMode = useViewportStore((s) => s.selectionMode);
  const setSelectionMode = useViewportStore((s) => s.setSelectionMode);

  return (
    <div
      className="menubar-snap-settings-panel"
      role="dialog"
      aria-label={t('toolbar.selectionModeTitle')}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="menubar-snap-settings-header">
        {t('toolbar.selectionModeTitle')}
      </div>
      <div className="menubar-snap-settings-section">
        {MODES.map((mode) => (
          <label key={mode.value} className="menubar-snap-settings-checkbox">
            <input
              type="radio"
              name="selection-mode"
              checked={selectionMode === mode.value}
              onChange={() => setSelectionMode(mode.value)}
            />
            <span>{t(mode.labelKey)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
