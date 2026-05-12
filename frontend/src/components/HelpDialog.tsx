import { useTranslation } from 'react-i18next';

interface ShortcutEntry {
  keys: string;
  description: string;
}

const SHORTCUTS: ShortcutEntry[] = [
  { keys: 'Ctrl+O', description: 'Open file' },
  { keys: 'Ctrl+S', description: 'Save file' },
  { keys: 'Ctrl+Z', description: 'Undo' },
  { keys: 'Ctrl+Y / Ctrl+Shift+Z', description: 'Redo' },
  { keys: 'Ctrl+A', description: 'Select all' },
  { keys: 'Delete / Backspace', description: 'Delete selected' },
  { keys: 'Ctrl+D', description: 'Duplicate selected' },
  { keys: 'Escape', description: 'Deselect / cancel' },
  { keys: 'F', description: 'Frame selected in viewport' },
  { keys: 'R', description: 'Toggle road edit mode' },
  { keys: 'G', description: 'Toggle geometry edit mode' },
  { keys: 'Ctrl+Shift+P', description: 'Open command palette' },
  { keys: 'Mouse wheel', description: 'Zoom viewport' },
  { keys: 'Middle mouse / Space+drag', description: 'Pan viewport' },
  { keys: 'Left click', description: 'Select element' },
];

export interface HelpDialogProps {
  onClose: () => void;
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
            aria-label="close"
          >
            ×
          </button>
        </div>

        <div className="help-dialog-body">
          <table className="help-shortcuts-table">
            <thead>
              <tr>
                <th>{t('help.shortcut', 'Shortcut')}</th>
                <th>{t('help.description', 'Description')}</th>
              </tr>
            </thead>
            <tbody>
              {SHORTCUTS.map((entry) => (
                <tr key={entry.keys}>
                  <td className="help-shortcut-keys">
                    <kbd>{entry.keys}</kbd>
                  </td>
                  <td className="help-shortcut-desc">
                    {t(`help.shortcuts.${entry.keys}`, entry.description)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
