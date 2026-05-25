import { useTranslation } from 'react-i18next';
import { useViewportStore } from '../../stores/viewportStore';

type ViewMode = 'sketch' | 'wire' | 'solid';

const MODES: { value: ViewMode; labelKey: string }[] = [
  { value: 'sketch', labelKey: 'toolbar.sketch' },
  { value: 'wire', labelKey: 'toolbar.wireframe' },
  { value: 'solid', labelKey: 'toolbar.solid' },
];

export function ViewModePanel() {
  const { t } = useTranslation();
  const viewMode = useViewportStore((s) => s.viewMode);
  const setViewMode = useViewportStore((s) => s.setViewMode);

  return (
    <div
      className="menubar-snap-settings-panel"
      role="dialog"
      aria-label={t('toolbar.viewModeTitle', 'View Mode')}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="menubar-snap-settings-header">
        {t('toolbar.viewModeTitle', 'View Mode')}
      </div>
      <div className="menubar-snap-settings-section">
        {MODES.map((mode) => (
          <label key={mode.value} className="menubar-snap-settings-checkbox">
            <input
              type="radio"
              name="view-mode"
              checked={viewMode === mode.value}
              onChange={() => setViewMode(mode.value)}
            />
            <span>{t(mode.labelKey)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
