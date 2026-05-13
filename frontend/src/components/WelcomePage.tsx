/**
 * WelcomePage — full-screen landing page shown on startup when no project is open.
 *
 * Three-column layout:
 *  - Left: Start links (New, Open File, User Manual, Project Homepage)
 *  - Middle: Keyboard shortcuts quick reference
 *  - Right: Recent files list (click to open directly)
 * Footer: checkbox to toggle "show on startup" preference.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, FolderOpen, Plus, BookOpen, Home, Clock, Keyboard, X } from 'lucide-react';
import type { RecentFile } from '../stores/recentFilesStore';
import './WelcomePage.css';

// Re-export so existing imports of `RecentFile` from WelcomePage still work
export type { RecentFile };

export interface WelcomePageProps {
  recentFiles: RecentFile[];
  onNew: () => void;
  onOpenFile: () => void;
  onOpenRecent: (file: RecentFile) => void;
  onRemoveRecent: (path: string) => void;
  showOnStartup: boolean;
  onToggleShowOnStartup: (value: boolean) => void;
}

const SHORTCUTS = [
  { labelKey: 'toolbar.selectMode',    key: 'S' },
  { labelKey: 'toolbar.roadEdit',      key: 'R' },
  { labelKey: 'toolbar.laneEdit',      key: 'L' },
  { labelKey: 'toolbar.laneSectionEdit', key: 'J' },
  { labelKey: 'toolbar.splineEdit',    key: 'P' },
  { labelKey: 'toolbar.drawLine',      key: 'Shift+L' },
  { labelKey: 'toolbar.drawArc',       key: 'Shift+A' },
];

const PROJECT_HOMEPAGE = 'https://github.com/worldeditor/worldeditor-next';
const USER_MANUAL_URL = 'https://github.com/worldeditor/worldeditor-next/blob/main/docs/user-manual.md';

/** Shorten a file path to show only the last 2 or 3 path segments. */
function shortenPath(fullPath: string): string {
  const parts = fullPath.replace(/\\/g, '/').split('/');
  if (parts.length <= 3) return fullPath;
  return '.../' + parts.slice(-2).join('/');
}

export function WelcomePage({
  recentFiles,
  onNew,
  onOpenFile,
  onOpenRecent,
  onRemoveRecent,
  showOnStartup,
  onToggleShowOnStartup,
}: WelcomePageProps) {
  const { t } = useTranslation();

  const sortedFiles = useMemo(
    () => [...recentFiles].sort((a, b) => b.lastOpened - a.lastOpened),
    [recentFiles],
  );

  const openExternal = (url: string) => {
    try { window.open(url, '_blank', 'noopener,noreferrer'); } catch { /* ignore */ }
  };

  return (
    <div className="wp-container">
      {/* ── Header ── */}
      <header className="wp-header">
        <div className="wp-logo">
          <Globe size={120} />
        </div>
        <h1 className="wp-title">{t('welcomePage.title', 'WorldEditor Next')}</h1>
        <p className="wp-subtitle">{t('welcomePage.subtitle', 'Autonomous driving road network editor')}</p>
      </header>

      {/* ── Three-column body ── */}
      <div className="wp-body">
        {/* Left: Start */}
        <div className="wp-col">
          <h2 className="wp-section-title">{t('welcomePage.start', 'Start')}</h2>
          <ul className="wp-start-list">
            <li>
              <button className="wp-start-item" onClick={onNew}>
                <Plus size={15} className="wp-start-item-icon" />
                {t('welcomePage.new', 'New')}
              </button>
            </li>
            <li>
              <button className="wp-start-item" onClick={onOpenFile}>
                <FolderOpen size={15} className="wp-start-item-icon" />
                {t('welcomePage.openFile', 'Open File...')}
              </button>
            </li>
            <li>
              <button className="wp-start-item" onClick={() => openExternal(USER_MANUAL_URL)}>
                <BookOpen size={15} className="wp-start-item-icon" />
                {t('welcomePage.userManual', 'User Manual')}
              </button>
            </li>
            <li>
              <button className="wp-start-item" onClick={() => openExternal(PROJECT_HOMEPAGE)}>
                <Home size={15} className="wp-start-item-icon" />
                {t('welcomePage.projectHomepage', 'Project Homepage')}
              </button>
            </li>
          </ul>
        </div>

        {/* Middle: Shortcuts */}
        <div className="wp-col">
          <h2 className="wp-section-title">
            <Keyboard size={13} />
            {t('welcomePage.shortcutsSection', 'Keyboard Shortcuts')}
          </h2>
          <div className="wp-shortcuts">
            {SHORTCUTS.map(({ labelKey, key }) => (
              <div key={labelKey} className="wp-shortcut-row">
                <span className="wp-shortcut-label">{t(labelKey)}</span>
                <span className="wp-kbd">
                  {key.split('+').map((k, i) => (
                    <kbd key={i}>{k}</kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Recent files */}
        <div className="wp-col">
          <h2 className="wp-section-title">
            <Clock size={13} />
            {t('welcomePage.recentSection', 'Recent Files')}
          </h2>
          {sortedFiles.length > 0 ? (
            <ul className="wp-recent-list">
              {sortedFiles.map((file) => (
                <li
                  key={file.path}
                  className="wp-recent-item"
                  onClick={() => onOpenRecent(file)}
                >
                  <div className="wp-recent-name">{file.name}</div>
                  <div className="wp-recent-path">{shortenPath(file.path)}</div>
                  <button
                    className="wp-recent-remove"
                    title={t('welcomePage.removeFromRecent', 'Remove from recent')}
                    onClick={(e) => { e.stopPropagation(); onRemoveRecent(file.path); }}
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="wp-empty-state">
              {t('welcomePage.noRecentFiles', 'No recent files. Open a file to get started.')}
            </p>
          )}
        </div>
      </div>

      {/* ── Footer ── */}
      <footer className="wp-footer">
        <label className="wp-footer-left">
          <input
            type="checkbox"
            checked={showOnStartup}
            onChange={(e) => onToggleShowOnStartup(e.target.checked)}
          />
          {t('welcomePage.showOnStartup', 'Show this page on startup')}
        </label>
      </footer>
    </div>
  );
}

