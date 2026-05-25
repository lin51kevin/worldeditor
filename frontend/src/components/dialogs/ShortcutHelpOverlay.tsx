import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { SHORTCUT_HELP_SECTIONS, type ShortcutHelpRow } from '../../constants/shortcutHelp';
import './ShortcutHelpOverlay.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

function renderKeyCombo(combo: string) {
  return (
    <span key={combo}>
      {combo.split('+').map((part, index) => (
        <span key={`${combo}-${part}-${index}`}>
          {index > 0 && <span className="shortcut-help-plus">+</span>}
          <kbd>{part}</kbd>
        </span>
      ))}
    </span>
  );
}

function renderShortcutKeys(row: ShortcutHelpRow) {
  return (
    <>
      {row.keys.map((combo, index) => (
        <span key={combo}>
          {index > 0 && <span className="shortcut-help-plus"> / </span>}
          {renderKeyCombo(combo)}
        </span>
      ))}
    </>
  );
}

export function ShortcutHelpOverlay({ open, onClose }: Props) {
  const { t } = useTranslation();

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="shortcut-help-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t('shortcutHelp.title')}
      onClick={onClose}
    >
      <div
        className="shortcut-help-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shortcut-help-header">
          <h3>{t('shortcutHelp.title')}</h3>
          <button
            className="shortcut-help-close"
            aria-label={t('dialog.close', 'Close')}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="shortcut-help-body">
          {SHORTCUT_HELP_SECTIONS.map((section) => (
            <section key={section.titleKey}>
              <h4 className="shortcut-help-section-title">
                {t(section.titleKey)}
              </h4>
              <table>
                <tbody>
                  {section.rows.map((row) => (
                    <tr key={`${section.titleKey}-${row.descKey}`}>
                      <td className="shortcut-help-key">
                        {renderShortcutKeys(row)}
                      </td>
                      <td className="shortcut-help-desc">{t(row.descKey)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>

        <div className="shortcut-help-footer">
          <button onClick={onClose}>{t('dialog.ok', 'OK')}</button>
        </div>
      </div>
    </div>
  );
}
