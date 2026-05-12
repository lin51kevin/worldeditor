/**
 * Plugin Manager — Notepad++-style modal dialog with tab categories
 * Tabs: Available | Installed | Disabled
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X, Package, Power, PowerOff, RefreshCw, Loader2,
  AlertCircle, Download, Trash2,
} from 'lucide-react';
import { usePlugins, type PluginInfo } from '../hooks/usePlugins';
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
    refresh,
  } = usePlugins();
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = useState<TabId>('available');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Set<string>>(new Set());
  const [disableDialogOpen, setDisableDialogOpen] = useState(false);
  const [disableTargetId, setDisableTargetId] = useState<string | null>(null);

  // Refresh list when dialog opens
  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  // Reset selection when switching tabs
  useEffect(() => {
    setSelectedId(null);
  }, [activeTab]);

  // ESC to close (when sub-dialog is not open)
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !disableDialogOpen) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose, disableDialogOpen]);

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

  const openDisableConfirm = (id: string) => {
    setDisableTargetId(id);
    setDisableDialogOpen(true);
  };

  const handleDisableConfirm = async (reason: string) => {
    if (!disableTargetId) return;
    await withLoading(disableTargetId, () => disablePlugin(disableTargetId, reason));
    setDisableDialogOpen(false);
    setDisableTargetId(null);
  };

  return (
    <div
      className="pm-overlay"
      onClick={(e) => { if (e.target === e.currentTarget && !disableDialogOpen) onClose(); }}
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
                  <th></th>
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
                    onDisable={() => openDisableConfirm(plugin.id)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="pm-footer">
          <div className="pm-footer-info">
            {selectedId && (
              <span className="pm-footer-hint">
                {plugins.find((p) => p.id === selectedId)?.name ?? ''}
              </span>
            )}
          </div>
          <div className="pm-footer-actions">
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

      {disableDialogOpen && (
        <DisableDialog
          onConfirm={(r) => void handleDisableConfirm(r)}
          onCancel={() => { setDisableDialogOpen(false); setDisableTargetId(null); }}
        />
      )}
    </div>
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
      className={`pm-plugin-row${selected ? ' selected' : ''}`}
      onClick={onSelect}
    >
      <td className="pm-col-name">
        <span className="pm-plugin-name">{plugin.name}</span>
      </td>
      <td className="pm-col-version">
        <code className="pm-plugin-version">{plugin.version}</code>
      </td>
      <td className="pm-col-desc">
        <span className="pm-plugin-desc">{plugin.description ?? '—'}</span>
      </td>
      <td className="pm-col-actions" onClick={(e) => e.stopPropagation()}>
        {isLoading ? (
          <Loader2 size={14} className="spin" />
        ) : plugin.status === 'available' ? (
          <button className="pm-row-btn load" onClick={onLoad} title={t('pluginManager.load')}>
            <Download size={12} />
            {t('pluginManager.install')}
          </button>
        ) : plugin.status === 'loaded' ? (
          <div className="pm-row-btn-group">
            <button className="pm-row-btn disable-icon" onClick={onDisable} title={t('pluginManager.disable')}>
              <PowerOff size={12} />
            </button>
            <button className="pm-row-btn unload" onClick={onUnload} title={t('pluginManager.unload')}>
              <Trash2 size={12} />
              {t('pluginManager.uninstall')}
            </button>
          </div>
        ) : (
          <button className="pm-row-btn enable" onClick={onEnable} title={t('pluginManager.enable')}>
            <Power size={12} />
            {t('pluginManager.enable')}
          </button>
        )}
      </td>
    </tr>
  );
}

// ─── Disable Confirm Dialog ──────────────────────────────────────────────────

interface DisableDialogProps {
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

function DisableDialog({ onConfirm, onCancel }: DisableDialogProps) {
  const [reason, setReason] = useState('');
  const { t } = useTranslation();

  return (
    <div className="pm-sub-overlay" onClick={onCancel}>
      <div className="pm-sub-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{t('pluginManager.disablePlugin')}</h3>
        <p>{t('pluginManager.disableReasonPrompt')}</p>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t('pluginManager.disableReasonPlaceholder')}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') onConfirm(reason);
            else if (e.key === 'Escape') onCancel();
          }}
        />
        <div className="pm-sub-actions">
          <button onClick={onCancel}>{t('pluginManager.cancel')}</button>
          <button className="confirm" onClick={() => onConfirm(reason)}>
            {t('pluginManager.confirmDisable')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PluginManager;