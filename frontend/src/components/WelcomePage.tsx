import type { CSSProperties } from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, FileText, FolderOpen, Keyboard, X } from 'lucide-react';
import { APP_VERSION } from '../services';

const WELCOME_SHOW_KEY = 'we_welcome_show';
const USER_MANUAL_URL = 'https://github.com/worldeditor-next/worldeditor-next/blob/main/docs/user-manual.md';

export interface RecentFileEntry {
  displayName: string;
  path: string;
}

export interface WelcomePageProps {
  onClose: () => void;
  onNewProject: () => void;
  onOpenFile: () => void;
  recentFiles: RecentFileEntry[];
  onOpenRecentFile: (file: RecentFileEntry) => void;
}

export function shouldShowWelcome(): boolean {
  return localStorage.getItem(WELCOME_SHOW_KEY) !== 'false';
}

const shortcuts = [
  ['Ctrl+Z', 'Undo'],
  ['Ctrl+Y', 'Redo'],
  ['Ctrl+S', 'Save'],
  ['Delete', 'Delete selected'],
  ['Home', 'Zoom to fit'],
  ['E', 'Edit geometry'],
  ['?', 'Shortcut help'],
  ['S', 'Select'],
  ['R', 'Road edit'],
  ['L', 'Lane edit'],
  ['J', 'Junction/LanesSection edit'],
] as const;

function actionButtonStyle(accent = false): CSSProperties {
  return {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '14px 16px',
    borderRadius: '10px',
    border: `1px solid ${accent ? 'var(--color-accent)' : 'var(--color-border)'}`,
    background: accent ? 'var(--color-accent-subtle)' : 'var(--color-bg-secondary)',
    color: 'var(--color-text-primary)',
    cursor: 'pointer',
    textAlign: 'left',
    fontSize: '14px',
  };
}

function recentFileButtonStyle(compact = false): CSSProperties {
  return {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '4px',
    padding: compact ? '10px 12px' : '12px 14px',
    borderRadius: '10px',
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg-secondary)',
    color: 'var(--color-text-primary)',
    cursor: 'pointer',
    textAlign: 'left',
  };
}

export function WelcomePage({
  onClose,
  onNewProject,
  onOpenFile,
  recentFiles,
  onOpenRecentFile,
}: WelcomePageProps) {
  const { t } = useTranslation();
  const [dontShowAgain, setDontShowAgain] = useState(() => !shouldShowWelcome());

  const styles = useMemo<Record<string, CSSProperties>>(() => ({
    overlay: {
      position: 'fixed',
      inset: 0,
      zIndex: 1000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      background: 'rgba(0, 0, 0, 0.62)',
      backdropFilter: 'blur(8px)',
    },
    card: {
      position: 'relative',
      width: 'min(100%, 860px)',
      maxHeight: 'calc(100vh - 48px)',
      overflowY: 'auto',
      borderRadius: '18px',
      border: '1px solid var(--color-border)',
      background: 'linear-gradient(180deg, var(--color-bg-primary) 0%, #161616 100%)',
      color: 'var(--color-text-primary)',
      boxShadow: '0 24px 80px rgba(0, 0, 0, 0.45)',
    },
    closeButton: {
      position: 'absolute',
      top: '18px',
      right: '18px',
      width: '36px',
      height: '36px',
      borderRadius: '10px',
      border: '1px solid var(--color-border)',
      background: 'var(--color-bg-secondary)',
      color: 'var(--color-text-primary)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
    },
    header: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: '18px',
      padding: '32px 32px 20px',
      borderBottom: '1px solid var(--color-border-subtle)',
    },
    logo: {
      width: '56px',
      height: '56px',
      borderRadius: '16px',
      background: 'linear-gradient(135deg, var(--color-accent) 0%, #3ea6ff 100%)',
      color: 'var(--color-text-inverse)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '20px',
      fontWeight: 700,
      letterSpacing: '0.08em',
      flexShrink: 0,
    },
    title: {
      margin: 0,
      fontSize: '34px',
      fontWeight: 700,
      color: 'var(--color-text-inverse)',
    },
    subtitle: {
      margin: '8px 0 0',
      fontSize: '15px',
      color: 'var(--color-text-secondary)',
    },
    content: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      gap: '24px',
      padding: '24px 32px 20px',
    },
    section: {
      display: 'flex',
      flexDirection: 'column',
      gap: '14px',
      minWidth: 0,
    },
    sectionCard: {
      borderRadius: '14px',
      border: '1px solid var(--color-border)',
      background: 'rgba(255, 255, 255, 0.02)',
      padding: '18px',
    },
    sectionTitle: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      margin: '0 0 14px',
      fontSize: '18px',
      fontWeight: 600,
      color: 'var(--color-text-inverse)',
    },
    subtleText: {
      margin: 0,
      color: 'var(--color-text-secondary)',
      fontSize: '13px',
      lineHeight: 1.5,
    },
    shortcutTable: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: '13px',
    },
    shortcutCell: {
      padding: '8px 0',
      borderBottom: '1px solid var(--color-border-subtle)',
      color: 'var(--color-text-primary)',
      verticalAlign: 'top',
    },
    kbd: {
      display: 'inline-block',
      padding: '4px 8px',
      borderRadius: '6px',
      border: '1px solid var(--color-border)',
      background: 'var(--color-bg-secondary)',
      color: 'var(--color-text-inverse)',
      fontFamily: 'inherit',
      fontSize: '12px',
      minWidth: '68px',
      textAlign: 'center',
    },
    footer: {
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '16px',
      padding: '20px 32px 28px',
      borderTop: '1px solid var(--color-border-subtle)',
    },
    checkboxLabel: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '10px',
      color: 'var(--color-text-secondary)',
      fontSize: '13px',
      cursor: 'pointer',
    },
    footerActions: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      flexWrap: 'wrap',
    },
    linkButton: {
      border: '1px solid var(--color-border)',
      borderRadius: '999px',
      padding: '8px 14px',
      background: 'transparent',
      color: 'var(--color-text-primary)',
      cursor: 'pointer',
      fontSize: '13px',
    },
    versionText: {
      color: 'var(--color-text-secondary)',
      fontSize: '13px',
    },
    bottomSection: {
      padding: '0 32px 24px',
    },
    bottomGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      gap: '12px',
    },
    filePath: {
      color: 'var(--color-text-secondary)',
      fontSize: '12px',
      wordBreak: 'break-all',
    },
  }), []);

  const handleToggleDontShowAgain = (checked: boolean) => {
    setDontShowAgain(checked);
    localStorage.setItem(WELCOME_SHOW_KEY, checked ? 'false' : 'true');
  };

  return (
    <div style={styles.overlay} role="dialog" aria-modal="true" aria-label={t('welcomePage.title')}>
      <div style={styles.card}>
        <button type="button" style={styles.closeButton} onClick={onClose} aria-label={t('welcomePage.close')}>
          <X size={18} />
        </button>

        <div style={styles.header}>
          <div style={styles.logo}>WE</div>
          <div>
            <h1 style={styles.title}>{t('welcomePage.title')}</h1>
            <p style={styles.subtitle}>{t('welcomePage.subtitle')}</p>
          </div>
        </div>

        <div style={styles.content}>
          <section style={styles.section}>
            <div style={styles.sectionCard}>
              <h2 style={styles.sectionTitle}>
                <FileText size={18} />
                <span>{t('welcomePage.start')}</span>
              </h2>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <button type="button" style={actionButtonStyle(true)} onClick={onNewProject}>
                  <FileText size={18} />
                  <span>{t('welcomePage.newProject')}</span>
                </button>
                <button type="button" style={actionButtonStyle()} onClick={onOpenFile}>
                  <FolderOpen size={18} />
                  <span>{t('welcomePage.openFile')}</span>
                </button>
              </div>
            </div>

            <div style={styles.sectionCard}>
              <h3 style={{ ...styles.sectionTitle, fontSize: '16px', marginBottom: '12px' }}>
                <Clock size={16} />
                <span>{t('welcomePage.recentFiles')}</span>
              </h3>

              {recentFiles.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {recentFiles.map((file) => (
                    <button
                      key={file.path}
                      type="button"
                      style={recentFileButtonStyle(true)}
                      onClick={() => onOpenRecentFile(file)}
                    >
                      <span>{file.displayName}</span>
                      <span style={styles.filePath}>{file.path}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p style={styles.subtleText}>{t('welcomePage.noRecentFiles')}</p>
              )}
            </div>
          </section>

          <section style={styles.section}>
            <div style={styles.sectionCard}>
              <h2 style={styles.sectionTitle}>
                <Keyboard size={18} />
                <span>{t('welcomePage.help')}</span>
              </h2>
              <p style={{ ...styles.subtleText, marginBottom: '14px' }}>{t('welcomePage.shortcuts')}</p>
              <table style={styles.shortcutTable}>
                <tbody>
                  {shortcuts.map(([shortcut, description]) => (
                    <tr key={shortcut}>
                      <td style={{ ...styles.shortcutCell, width: '88px' }}>
                        <kbd style={styles.kbd}>{shortcut}</kbd>
                      </td>
                      <td style={styles.shortcutCell}>{description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {recentFiles.length > 0 && (
          <div style={styles.bottomSection}>
            <div style={styles.sectionCard}>
              <h3 style={{ ...styles.sectionTitle, fontSize: '16px', marginBottom: '12px' }}>
                <Clock size={16} />
                <span>{t('welcomePage.recentFiles')}</span>
              </h3>
              <div style={styles.bottomGrid}>
                {recentFiles.map((file) => (
                  <button
                    key={`bottom-${file.path}`}
                    type="button"
                    style={recentFileButtonStyle()}
                    onClick={() => onOpenRecentFile(file)}
                  >
                    <span>{file.displayName}</span>
                    <span style={styles.filePath}>{file.path}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div style={styles.footer}>
          <label style={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(event) => handleToggleDontShowAgain(event.target.checked)}
              style={{ accentColor: 'var(--color-accent)' }}
            />
            <span>{t('welcomePage.dontShowAgain')}</span>
          </label>

          <div style={styles.footerActions}>
            <button
              type="button"
              style={styles.linkButton}
              onClick={() => window.open(USER_MANUAL_URL, '_blank', 'noopener,noreferrer')}
            >
              {t('welcomePage.learnMore')}
            </button>
            <span style={styles.versionText}>{t('welcomePage.version')} {APP_VERSION}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
