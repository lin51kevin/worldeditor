/**
 * SoftSelectionPanel — controls for soft selection falloff radius and strength.
 *
 * Soft selection affects how much adjacent roads/vertices are influenced
 * when editing a primary selection.
 */
import { useTranslation } from 'react-i18next';

export interface SoftSelectionSettings {
  enabled: boolean;
  radius: number;   // metres
  strength: number; // 0–1
  falloff: 'linear' | 'smooth' | 'sharp';
}

interface SoftSelectionPanelProps {
  settings: SoftSelectionSettings;
  onChange: (settings: SoftSelectionSettings) => void;
}

export function SoftSelectionPanel({ settings, onChange }: SoftSelectionPanelProps) {
  const { t } = useTranslation();
  const update = (patch: Partial<SoftSelectionSettings>) =>
    onChange({ ...settings, ...patch });

  return (
    <div className="soft-selection-panel" data-testid="soft-selection-panel">
      <div className="soft-selection-row">
        <label>
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
            data-testid="soft-sel-enabled"
          />
          {t('softSelection.enabled', 'Soft Selection')}
        </label>
      </div>
      {settings.enabled && (
        <>
          <div className="soft-selection-row">
            <label>{t('softSelection.radius', 'Radius (m)')}</label>
            <input
              type="range"
              min={1}
              max={200}
              value={settings.radius}
              onChange={(e) => update({ radius: Number(e.target.value) })}
              data-testid="soft-sel-radius"
            />
            <span>{settings.radius}m</span>
          </div>
          <div className="soft-selection-row">
            <label>{t('softSelection.strength', 'Strength')}</label>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(settings.strength * 100)}
              onChange={(e) => update({ strength: Number(e.target.value) / 100 })}
              data-testid="soft-sel-strength"
            />
            <span>{Math.round(settings.strength * 100)}%</span>
          </div>
          <div className="soft-selection-row">
            <label>{t('softSelection.falloff', 'Falloff')}</label>
            <select
              value={settings.falloff}
              onChange={(e) => update({ falloff: e.target.value as SoftSelectionSettings['falloff'] })}
              data-testid="soft-sel-falloff"
            >
              <option value="linear">{t('softSelection.linear', 'Linear')}</option>
              <option value="smooth">{t('softSelection.smooth', 'Smooth')}</option>
              <option value="sharp">{t('softSelection.sharp', 'Sharp')}</option>
            </select>
          </div>
        </>
      )}
    </div>
  );
}

/** Default soft selection settings. */
export function defaultSoftSelectionSettings(): SoftSelectionSettings {
  return { enabled: false, radius: 20, strength: 0.5, falloff: 'smooth' };
}
