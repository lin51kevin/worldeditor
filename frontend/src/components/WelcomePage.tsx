/**
 * WelcomePage — full-screen landing page shown before any project is opened.
 *
 * Displays recent files, quick actions (New / Open), and branding.
 * Theme-aware: uses CSS variables from global.css.
 *
 * This component fills the entire viewport as a background page; the editor UI
 * (MenuBar, Toolbar, panels, Viewport) is only rendered once a project is loaded.
 */

import type { CSSProperties } from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, FileText, FolderOpen, Plus, Clock, X } from 'lucide-react';

export interface RecentFile {
  name: string;
  path: string;
  lastOpened: number;
}

interface WelcomePageProps {
  recentFiles: RecentFile[];
  onNewProject: () => void;
  onOpenFile: () => void;
  onOpenRecent: (file: RecentFile) => void;
  onRemoveRecent: (path: string) => void;
}

/** Determine if the welcome page should be shown (no project loaded yet). */
export function shouldShowWelcome(projectName: string | undefined): boolean {
  return !projectName || projectName === 'Untitled';
}

export function WelcomePage({
  recentFiles,
  onNewProject,
  onOpenFile,
  onOpenRecent,
  onRemoveRecent,
}: WelcomePageProps) {
  const { t } = useTranslation();
  const [hoveredFile, setHoveredFile] = useState<string | null>(null);

  // Sort recent files by last opened (most recent first)
  const sortedFiles = useMemo(() => {
    return [...recentFiles].sort((a, b) => b.lastOpened - a.lastOpened);
  }, [recentFiles]);

  // Format relative time
  const formatTime = (timestamp: number): string => {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return t('welcome.justNow', 'Just now');
    if (minutes < 60) return t('welcome.minutesAgo', '{{count}}m ago', { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('welcome.hoursAgo', '{{count}}h ago', { count: hours });
    const days = Math.floor(hours / 24);
    if (days < 7) return t('welcome.daysAgo', '{{count}}d ago', { count: days });
    return new Date(timestamp).toLocaleDateString();
  };

  const styles = {
    container: {
      position: 'fixed' as const,
      inset: 0,
      zIndex: 0,
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'var(--color-bg-primary)',
      color: 'var(--color-text-primary)',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    },
    content: {
      maxWidth: 720,
      width: '100%',
      padding: '40px 24px',
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      gap: 32,
    },
    branding: {
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      gap: 12,
      marginBottom: 8,
    },
    logo: {
      width: 80,
      height: 80,
      borderRadius: 20,
      background: 'linear-gradient(135deg, var(--color-accent), var(--color-accent-light))',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 36,
      color: '#ffffff',
      marginBottom: 4,
    },
    title: {
      fontSize: 28,
      fontWeight: 600,
      color: 'var(--color-text-primary)',
      letterSpacing: '-0.5px',
      margin: 0,
    },
    subtitle: {
      fontSize: 14,
      color: 'var(--color-text-secondary)',
      margin: 0,
    },
    actions: {
      display: 'flex',
      gap: 12,
      marginTop: 8,
    },
    actionBtn: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '10px 20px',
      borderRadius: 8,
      border: '1px solid var(--color-border)',
      backgroundColor: 'var(--color-bg-secondary)',
      color: 'var(--color-text-primary)',
      cursor: 'pointer',
      fontSize: 14,
      fontWeight: 500,
      transition: 'background-color 0.15s, border-color 0.15s',
    },
    actionBtnPrimary: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '10px 20px',
      borderRadius: 8,
      border: 'none',
      backgroundColor: 'var(--color-accent)',
      color: '#ffffff',
      cursor: 'pointer',
      fontSize: 14,
      fontWeight: 500,
      transition: 'background-color 0.15s',
    },
    section: {
      width: '100%',
    },
    sectionHeader: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    sectionTitle: {
      fontSize: 12,
      fontWeight: 600,
      textTransform: 'uppercase' as const,
      letterSpacing: '0.5px',
      color: 'var(--color-text-secondary)',
      margin: 0,
    },
    fileList: {
      display: 'flex',
      flexDirection: 'column' as const,
      gap: 2,
    },
    fileItem: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '10px 14px',
      borderRadius: 8,
      cursor: 'pointer',
      transition: 'background-color 0.12s',
      backgroundColor: hoveredFile ? 'var(--color-bg-tertiary)' : 'transparent',
    },
    fileIcon: {
      color: 'var(--color-text-secondary)',
      flexShrink: 0,
    },
    fileInfo: {
      flex: 1,
      minWidth: 0,
    },
    fileName: {
      fontSize: 13,
      fontWeight: 500,
      color: 'var(--color-text-primary)',
      whiteSpace: 'nowrap' as const,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    },
    filePath: {
      fontSize: 11,
      color: 'var(--color-text-secondary)',
      whiteSpace: 'nowrap' as const,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      marginTop: 2,
    },
    fileTime: {
      fontSize: 11,
      color: 'var(--color-text-secondary)',
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      flexShrink: 0,
    },
    removeBtn: {
      background: 'none',
      border: 'none',
      color: 'var(--color-text-secondary)',
      cursor: 'pointer',
      padding: 4,
      borderRadius: 4,
      display: 'flex',
      alignItems: 'center',
      opacity: 0,
      transition: 'opacity 0.12s, color 0.12s',
    },
    fileItemHoveredRemove: {
      opacity: 1,
    },
    emptyState: {
      textAlign: 'center' as const,
      padding: '24px 0',
      color: 'var(--color-text-secondary)',
      fontSize: 13,
    },
    version: {
      position: 'fixed' as const,
      bottom: 16,
      right: 16,
      fontSize: 11,
      color: 'var(--color-text-secondary)',
      opacity: 0.6,
    },
  } satisfies Record<string, CSSProperties>;

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        {/* Branding */}
        <div style={styles.branding}>
          <div style={styles.logo}>
            <Globe size={36} />
          </div>
          <h1 style={styles.title}>{t('app.brand', 'WorldEditor')}</h1>
          <p style={styles.subtitle}>
            {t('welcome.subtitle', 'OpenDRIVE Road Network Editor')}
          </p>
        </div>

        {/* Quick actions */}
        <div style={styles.actions}>
          <button
            style={styles.actionBtnPrimary}
            onClick={onNewProject}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-accent-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-accent)')}
          >
            <Plus size={16} />
            {t('welcome.newProject', 'New Project')}
          </button>
          <button
            style={styles.actionBtn}
            onClick={onOpenFile}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-bg-tertiary)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)')}
          >
            <FolderOpen size={16} />
            {t('welcome.openFile', 'Open File…')}
          </button>
        </div>

        {/* Recent files — single list, no duplicates */}
        {sortedFiles.length > 0 && (
          <div style={styles.section}>
            <div style={styles.sectionHeader}>
              <p style={styles.sectionTitle}>
                {t('welcome.recentFiles', 'Recent Files')}
              </p>
            </div>
            <div style={styles.fileList}>
              {sortedFiles.map((file) => (
                <div
                  key={file.path}
                  style={styles.fileItem}
                  onClick={() => onOpenRecent(file)}
                  onMouseEnter={() => setHoveredFile(file.path)}
                  onMouseLeave={() => setHoveredFile(null)}
                >
                  <FileText size={18} style={styles.fileIcon} />
                  <div style={styles.fileInfo}>
                    <div style={styles.fileName}>{file.name}</div>
                    <div style={styles.filePath}>{file.path}</div>
                  </div>
                  <div style={styles.fileTime}>
                    <Clock size={12} />
                    {formatTime(file.lastOpened)}
                  </div>
                  <button
                    style={{
                      ...styles.removeBtn,
                      ...(hoveredFile === file.path ? styles.fileItemHoveredRemove : {}),
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveRecent(file.path);
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-text-primary)')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-secondary)')}
                    title={t('welcome.removeRecent', 'Remove from recent')}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {sortedFiles.length === 0 && (
          <div style={styles.emptyState}>
            {t('welcome.noRecentFiles', 'No recent files. Open a file to get started.')}
          </div>
        )}
      </div>

      <div style={styles.version}>v0.1.1</div>
    </div>
  );
}
