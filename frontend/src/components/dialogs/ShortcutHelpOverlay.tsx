import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import './ShortcutHelpOverlay.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface ShortcutRow {
  key: string;
  descKey: string;
}

const SECTIONS: Array<{ titleKey: string; rows: ShortcutRow[] }> = [
  {
    titleKey: 'shortcutHelp.sections.drawing',
    rows: [
      { key: 'L', descKey: 'shortcutHelp.keys.drawLine' },
      { key: 'A', descKey: 'shortcutHelp.keys.drawArc' },
      { key: 'P', descKey: 'shortcutHelp.keys.drawSpiral' },
      { key: 'S', descKey: 'shortcutHelp.keys.drawSpline' },
    ],
  },
  {
    titleKey: 'shortcutHelp.sections.transform',
    rows: [
      { key: 'M', descKey: 'shortcutHelp.keys.moveRoad' },
      { key: 'R', descKey: 'shortcutHelp.keys.rotateRoad' },
      { key: 'X', descKey: 'shortcutHelp.keys.splitRoadAtPoint' },
    ],
  },
  {
    titleKey: 'shortcutHelp.sections.edit',
    rows: [
      { key: 'Ctrl+Z',       descKey: 'shortcutHelp.keys.undo' },
      { key: 'Ctrl+Y',       descKey: 'shortcutHelp.keys.redo' },
      { key: 'Ctrl+A',       descKey: 'shortcutHelp.keys.selectAll' },
      { key: 'Ctrl+C',       descKey: 'shortcutHelp.keys.copy' },
      { key: 'Ctrl+V',       descKey: 'shortcutHelp.keys.paste' },
      { key: 'Delete / ⌫',  descKey: 'shortcutHelp.keys.delete' },
    ],
  },
  {
    titleKey: 'shortcutHelp.sections.view',
    rows: [
      { key: 'F',    descKey: 'shortcutHelp.keys.zoomFit' },
      { key: 'Esc',  descKey: 'shortcutHelp.keys.escape' },
    ],
  },
  {
    titleKey: 'shortcutHelp.sections.panels',
    rows: [
      { key: 'I',      descKey: 'shortcutHelp.keys.inspector' },
      { key: 'Ctrl+B', descKey: 'shortcutHelp.keys.leftPanel' },
      { key: '?',      descKey: 'shortcutHelp.keys.help' },
    ],
  },
];

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
          {SECTIONS.map((section) => (
            <section key={section.titleKey}>
              <h4 className="shortcut-help-section-title">
                {t(section.titleKey)}
              </h4>
              <table>
                <tbody>
                  {section.rows.map((row) => (
                    <tr key={row.key}>
                      <td className="shortcut-help-key">
                        {row.key.split('+').map((part, i) => (
                          <span key={i}>
                            {i > 0 && <span className="shortcut-help-plus">+</span>}
                            <kbd>{part}</kbd>
                          </span>
                        ))}
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
