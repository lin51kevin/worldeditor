import { useTranslation } from 'react-i18next';

interface ShortcutEntry {
  keys: string;
  description: string;
}

interface ShortcutGroup {
  group: string;
  entries: ShortcutEntry[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    group: 'Drawing Modes',
    entries: [
      { keys: 'L', description: 'Draw Line road' },
      { keys: 'A', description: 'Draw Arc road' },
      { keys: 'P', description: 'Draw Spiral road' },
      { keys: 'S', description: 'Spline draw mode' },
      { keys: 'Enter', description: 'Finish current drawing' },
      { keys: 'Backspace', description: 'Undo last draw point' },
    ],
  },
  {
    group: 'Transform',
    entries: [
      { keys: 'M', description: 'Move road (toggle)' },
      { keys: 'R', description: 'Rotate road (toggle)' },
    ],
  },
  {
    group: 'Universal',
    entries: [
      { keys: 'Escape', description: 'Cancel / return to Select mode' },
      { keys: 'Delete / Backspace', description: 'Delete selected' },
      { keys: 'F', description: 'Zoom to fit / frame selected' },
      { keys: '?', description: 'Show keyboard shortcuts' },
    ],
  },
  {
    group: 'Panels',
    entries: [
      { keys: 'I', description: 'Toggle Inspector panel' },
      { keys: 'Ctrl+B', description: 'Toggle Layer panel' },
      { keys: 'Ctrl+J', description: 'Toggle Output panel' },
    ],
  },
  {
    group: 'Edit',
    entries: [
      { keys: 'Ctrl+Z', description: 'Undo' },
      { keys: 'Ctrl+Y / Ctrl+Shift+Z', description: 'Redo' },
      { keys: 'Ctrl+A', description: 'Select all' },
      { keys: 'Ctrl+C', description: 'Copy selected' },
      { keys: 'Ctrl+V', description: 'Paste' },
    ],
  },
  {
    group: 'Viewport',
    entries: [
      { keys: 'Mouse wheel', description: 'Zoom' },
      { keys: 'Middle mouse / Space+drag', description: 'Pan' },
      { keys: 'Shift+drag', description: 'Box select multiple' },
      { keys: 'Shift+click', description: 'Toggle multi-select' },
      { keys: 'Left click', description: 'Select element' },
    ],
  },
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
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.group} className="help-shortcut-group">
              <div className="help-shortcut-group-title">
                {t(`help.groups.${group.group}`, group.group)}
              </div>
              <table className="help-shortcuts-table">
                <tbody>
                  {group.entries.map((entry) => (
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
