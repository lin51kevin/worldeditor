import { useTranslation } from 'react-i18next';
import { SHORTCUT_HELP_SECTIONS } from '../../constants/shortcutHelp';

export interface HelpDialogProps {
  onClose: () => void;
}

function renderKeyCombo(combo: string) {
  return (
    <span key={combo}>
      {combo.split('+').map((part, index) => (
        <span key={`${combo}-${part}-${index}`}>
          {index > 0 && ' + '}
          <kbd>{part}</kbd>
        </span>
      ))}
    </span>
  );
}

/**
 * Keyboard shortcuts reference dialog.
 */
export function HelpDialog({ onClose }: HelpDialogProps) {
  const { t } = useTranslation();

  return (
    <div
      className="help-dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t('help.title', 'Keyboard Shortcuts')}
    >
      <div className="help-dialog-panel">
        <div className="help-dialog-header">
          <h2 className="help-dialog-title">{t('help.title', 'Keyboard Shortcuts')}</h2>
          <button
            className="help-dialog-close"
            onClick={onClose}
            aria-label={t('dialog.close', 'Close')}
          >
            ×
          </button>
        </div>

        <div className="help-dialog-body">
          {SHORTCUT_HELP_SECTIONS.map((group) => (
            <div key={group.titleKey} className="help-shortcut-group">
              <div className="help-shortcut-group-title">
                {t(group.titleKey)}
              </div>
              <table className="help-shortcuts-table">
                <tbody>
                  {group.rows.map((entry) => (
                    <tr key={`${group.titleKey}-${entry.descKey}`}>
                      <td className="help-shortcut-keys">
                        {entry.keys.map((combo, index) => (
                          <span key={combo}>
                            {index > 0 && ' / '}
                            {renderKeyCombo(combo)}
                          </span>
                        ))}
                      </td>
                      <td className="help-shortcut-desc">
                        {t(entry.descKey)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        <div className="help-dialog-footer">
          <button className="help-dialog-btn" onClick={onClose}>
            {t('dialog.ok', 'OK')}
          </button>
        </div>
      </div>
    </div>
  );
}
