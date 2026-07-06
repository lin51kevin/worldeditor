import { useTranslation } from 'react-i18next';
import { useViewportStore } from '../../stores/viewportStore';
import { getViewportRenderer } from '../../viewport/viewportRef';
import { spawnSampleActors, clearSampleActors } from '../../plugins/npc-actors';

type ViewMode = 'sketch' | 'wire' | 'solid';

const MODES: { value: ViewMode; labelKey: string }[] = [
  { value: 'sketch', labelKey: 'toolbar.sketch' },
  { value: 'wire', labelKey: 'toolbar.wire' },
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
      aria-label={t('toolbar.viewModeTitle')}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="menubar-snap-settings-header">
        {t('toolbar.viewModeTitle')}
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
      {import.meta.env.DEV && (
        <div className="menubar-snap-settings-section">
          <div className="menubar-snap-settings-header">Case actors (debug)</div>
          <button
            type="button"
            onClick={() => {
              const r = getViewportRenderer();
              if (r) spawnSampleActors(r);
            }}
          >
            Spawn sample boxes
          </button>
          <button
            type="button"
            onClick={() => {
              const r = getViewportRenderer();
              if (r) clearSampleActors(r);
            }}
          >
            Clear boxes
          </button>
        </div>
      )}
    </div>
  );
}
