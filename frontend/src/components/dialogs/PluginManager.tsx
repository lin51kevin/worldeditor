/**
 * Plugin Manager — Notepad++-style modal dialog with tab categories
 * Tabs: Available | Installed | Disabled
 */

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X, Package, RefreshCw, Loader2,
  AlertCircle, Trash2, FolderOpen,
} from 'lucide-react';
import { usePlugins, type PluginInfo } from '../../hooks/usePlugins';
import { loadPluginBundle } from '../../plugins/core/pluginLoader';
import './PluginManager.css';

type TabId = 'available' | 'installed' | 'disabled';

interface PluginManagerProps {
  open?: boolean;
  onClose?: () => void;
}

export function PluginManager({ open = true, onClose = () => {} }: PluginManagerProps) {
  const {
    plugins,
    loading,
    error,
    loadPlugin,
    unloadPlugin,
    enablePlugin,
    disablePlugin,
    installPlugin,
    refresh,
  } = usePlugins();
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = useState<TabId>('available');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Set<string>>(new Set());
  /** Hidden file input for web-mode plugin installation */
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Refresh list when dialog opens
  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  // Reset selection when switching tabs
  useEffect(() => {
    setSelectedId(null);
  }, [activeTab]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const available = plugins.filter((p) => p.status === 'available');
  const installed = plugins.filter((p) => p.status === 'loaded');
  const disabled  = plugins.filter((p) => p.status === 'disabled');

  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: 'available', label: t('pluginManager.tabAvailable'), count: available.length },
    { id: 'installed', label: t('pluginManager.tabInstalled'), count: installed.length },
    { id: 'disabled',  label: t('pluginManager.tabDisabled'),  count: disabled.length  },
  ];

  const currentList =
    activeTab === 'available' ? available :
    activeTab === 'installed' ? installed : disabled;

  const withLoading = async (id: string, fn: () => Promise<void>) => {
    setActionLoading((prev) => new Set(prev).add(id));
    try { await fn(); }
    finally {
      setActionLoading((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  };

  const handleLoad   = (id: string) => withLoading(id, () => loadPlugin(id));
  const handleUnload = (id: string) => withLoading(id, () => unloadPlugin(id));
  const handleEnable = (id: string) => withLoading(id, () => enablePlugin(id));
  const handleDisable = (id: string) => withLoading(id, () => disablePlugin(id));

  const handleInstallFromFile = async () => {
    if (typeof window !== 'undefined' && '__TAURI__' in window) {
      // Tauri desktop: use native directory picker
      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const selected = await open({ directory: true, multiple: false, title: t('pluginManager.installFromFile') });
        if (selected && typeof selected === 'string') {
          await withLoading('__install__', () => installPlugin(selected));
        }
      } catch (err) {
        if (err instanceof Error && !err.message.includes('cancel')) {
          console.error('[PluginManager] install error:', err);
        }
      }
    } else {
      // Web mode: trigger hidden file input to pick a .js plugin bundle
      fileInputRef.current?.click();
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so the same file can be re-selected
    e.target.value = '';
    try {
      const jsContent = await file.text();
      const pluginId = file.name.replace(/\.js$/i, '');
      await withLoading('__install__', async () => {
        await loadPluginBundle(pluginId, jsContent);
      });
      await refresh();
    } catch (err) {
      console.error('[PluginManager] web install error:', err);
    }
  };

  return (
    <>
      {/* Hidden file input for web-mode plugin installation */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".js"
        style={{ display: 'none' }}
        onChange={(e) => void handleFileInputChange(e)}
      />
    <div
      className="pm-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={t('pluginManager.title')}
    >
      <div className="pm-dialog">
        {/* Header */}
        <div className="pm-header">
          <div className="pm-header-title">
            <Package size={16} />
            <span>{t('pluginManager.title')}</span>
          </div>
          <button className="pm-close-btn" onClick={onClose} title={t('pluginManager.close')}>
            <X size={16} />
          </button>
        </div>

        {/* Error banner */}
        {error && (
          <div className="pm-error">
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        {/* Tab bar */}
        <div className="pm-tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`pm-tab${activeTab === tab.id ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              {tab.count > 0 && <span className="pm-tab-badge">{tab.count}</span>}
            </button>
          ))}
        </div>

        {/* Plugin list */}
        <div className="pm-body" role="tabpanel">
          {loading && plugins.length === 0 ? (
            <div className="pm-loading">
              <Loader2 size={20} className="spin" />
              <span>{t('pluginManager.loading')}</span>
            </div>
          ) : currentList.length === 0 ? (
            <div className="pm-empty">
              <Package size={32} />
              <span>
                {activeTab === 'available' ? t('pluginManager.noAvailable')
                  : activeTab === 'installed' ? t('pluginManager.noInstalled')
                  : t('pluginManager.noDisabled')}
              </span>
            </div>
          ) : (
            <table className="pm-table">
              <thead>
                <tr>
                  <th>{t('pluginManager.colName')}</th>
                  <th>{t('pluginManager.colVersion')}</th>
                  <th>{t('pluginManager.colDescription')}</th>
                  <th>{t('pluginManager.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {currentList.map((plugin) => (
                  <PluginRow
                    key={plugin.id}
                    plugin={plugin}
                    selected={selectedId === plugin.id}
                    isLoading={actionLoading.has(plugin.id)}
                    onSelect={() => setSelectedId(selectedId === plugin.id ? null : plugin.id)}
                    onLoad={() => void handleLoad(plugin.id)}
                    onUnload={() => void handleUnload(plugin.id)}
                    onEnable={() => void handleEnable(plugin.id)}
                    onDisable={() => void handleDisable(plugin.id)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="pm-footer">
          <div className="pm-footer-info">
            {selectedId && (() => {
              const sel = plugins.find((p) => p.id === selectedId);
              const name = sel ? (sel.nameKey ? t(sel.nameKey, sel.name) : sel.name) : '';
              return <span className="pm-footer-hint">{name}</span>;
            })()}
          </div>
          <div className="pm-footer-actions">
            <button
              className="pm-btn pm-btn-secondary"
              onClick={() => void handleInstallFromFile()}
              disabled={loading}
              title={t('pluginManager.installFromFile')}
            >
              <FolderOpen size={13} />
              {t('pluginManager.installFromFile')}
            </button>
            <button
              className="pm-btn pm-btn-secondary"
              onClick={() => void refresh()}
              disabled={loading}
              title={t('pluginManager.refresh')}
            >
              <RefreshCw size={13} className={loading ? 'spin' : ''} />
              {t('pluginManager.refresh')}
            </button>
            <button className="pm-btn pm-btn-primary" onClick={onClose}>
              {t('pluginManager.close')}
            </button>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}

// ─── Plugin Row ──────────────────────────────────────────────────────────────

interface PluginRowProps {
  plugin: PluginInfo;
  selected: boolean;
  isLoading: boolean;
  onSelect: () => void;
  onLoad: () => void;
  onUnload: () => void;
  onEnable: () => void;
  onDisable: () => void;
}

function PluginRow({ plugin, selected, isLoading, onSelect, onLoad, onUnload, onEnable, onDisable }: PluginRowProps) {
  const { t } = useTranslation();
  return (
    <tr
      className={`pm-plugin-row${selected ? ' selected' : ''}${plugin.isBuiltin ? ' builtin' : ''}`}
      onClick={onSelect}
    >
      <td className="pm-col-name">
        <span className="pm-plugin-name">
          {plugin.nameKey ? t(plugin.nameKey, plugin.name) : plugin.name}
        </span>
        {plugin.isBuiltin && (
          <span className="pm-builtin-badge">{t('pluginManager.builtin')}</span>
        )}
      </td>
      <td className="pm-col-version">
        <code className="pm-plugin-version">{plugin.version}</code>
      </td>
      <td className="pm-col-desc">
        <span className="pm-plugin-desc">
          {plugin.descriptionKey
            ? t(plugin.descriptionKey, plugin.description ?? '—')
            : (plugin.description ?? '—')}
        </span>
      </td>
      <td className="pm-col-actions" onClick={(e) => e.stopPropagation()}>
        {isLoading ? (
          <Loader2 size={14} className="spin" />
        ) : plugin.status === 'available' && !plugin.isBuiltin ? (
          <button className="pm-row-btn load" title={t('pluginManager.load')} onClick={onLoad}>
            {t('pluginManager.load')}
          </button>
        ) : plugin.status === 'loaded' ? (
          <div className="pm-row-btn-group">
            <button className="pm-row-btn disable" title={t('pluginManager.disable')} onClick={onDisable}>
              {t('pluginManager.disable')}
            </button>
            {!plugin.isBuiltin && (
              <button className="pm-row-btn unload" title={t('pluginManager.unload')} onClick={onUnload}>
                <Trash2 size={12} />
                {t('pluginManager.unload')}
              </button>
            )}
          </div>
        ) : plugin.status === 'disabled' ? (
          <button className="pm-row-btn enable" title={t('pluginManager.enable')} onClick={onEnable}>
            {t('pluginManager.enable')}
          </button>
        ) : null}
      </td>
    </tr>
  );
}

export default PluginManager;