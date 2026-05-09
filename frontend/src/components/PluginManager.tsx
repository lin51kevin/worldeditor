/**
 * Plugin Manager — UI for managing plugins (install, uninstall, enable, disable)
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  Package, Power, PowerOff, RefreshCw, Loader2, 
  AlertCircle, CheckCircle2, XCircle, Info, ChevronDown, ChevronRight 
} from 'lucide-react';
import { usePlugins, type PluginInfo } from '../hooks/usePlugins';
import './PluginManager.css';

export function PluginManager() {
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

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState<Set<string>>(new Set());
  const [disableDialogOpen, setDisableDialogOpen] = useState(false);
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleLoad = async (id: string) => {
    setActionLoading((prev) => new Set(prev).add(id));
    try {
      await loadPlugin(id);
    } finally {
      setActionLoading((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleUnload = async (id: string) => {
    setActionLoading((prev) => new Set(prev).add(id));
    try {
      await unloadPlugin(id);
    } finally {
      setActionLoading((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleEnable = async (id: string) => {
    setActionLoading((prev) => new Set(prev).add(id));
    try {
      await enablePlugin(id);
    } finally {
      setActionLoading((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const openDisableDialog = (id: string) => {
    setSelectedPluginId(id);
    setDisableDialogOpen(true);
  };

  const handleDisable = async (reason: string) => {
    if (!selectedPluginId) return;
    setActionLoading((prev) => new Set(prev).add(selectedPluginId));
    try {
      await disablePlugin(selectedPluginId, reason);
      setDisableDialogOpen(false);
      setSelectedPluginId(null);
    } finally {
      setActionLoading((prev) => {
        const next = new Set(prev);
        next.delete(selectedPluginId);
        return next;
      });
    }
  };

  const StatusBadge = ({ status, disabledReason }: { status: PluginInfo['status']; disabledReason?: string }) => {
    switch (status) {
      case 'loaded':
        return (
          <span className="plugin-status loaded">
            <CheckCircle2 size={12} />
            {t('pluginManager.loaded')}
          </span>
        );
      case 'disabled':
        return (
          <span className="plugin-status disabled" title={disabledReason}>
            <XCircle size={12} />
            {t('pluginManager.disabled')}
          </span>
        );
      default:
        return (
          <span className="plugin-status available">
            <AlertCircle size={12} />
            {t('pluginManager.available')}
          </span>
        );
    }
  };

  return (
    <div className="plugin-manager">
      <div className="plugin-manager-header">
        <div className="plugin-manager-title">
          <Package size={16} />
          <span>{t('pluginManager.title')}</span>
        </div>
        <button 
          className="plugin-refresh-btn" 
          onClick={refresh} 
          disabled={loading}
          title={t('pluginManager.refresh')}
        >
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="plugin-error">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      {loading && plugins.length === 0 ? (
        <div className="plugin-loading">
          <Loader2 size={20} className="spin" />
          <span>{t('pluginManager.loading')}</span>
        </div>
      ) : plugins.length === 0 ? (
        <div className="plugin-empty">
          <Package size={32} />
          <span>{t('pluginManager.noPlugins')}</span>
          <span className="plugin-empty-hint">{t('pluginManager.noPluginsHint')}</span>
        </div>
      ) : (
        <div className="plugin-list">
          {plugins.map((plugin) => (
            <div key={plugin.id} className="plugin-item">
              <div className="plugin-item-header" onClick={() => toggleExpanded(plugin.id)}>
                <div className="plugin-item-left">
                  {expandedIds.has(plugin.id) ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                  <span className="plugin-name">{plugin.name}</span>
                  <span className="plugin-version">v{plugin.version}</span>
                </div>
                <div className="plugin-item-right">
                  <StatusBadge status={plugin.status} disabledReason={plugin.disabledReason} />
                  <div className="plugin-actions" onClick={(e) => e.stopPropagation()}>
                    {plugin.status === 'loaded' && (
                      <button
                        className="plugin-action-btn unload"
                        onClick={() => handleUnload(plugin.id)}
                        disabled={actionLoading.has(plugin.id)}
                        title={t('pluginManager.unload')}
                      >
                        {actionLoading.has(plugin.id) ? (
                          <Loader2 size={12} className="spin" />
                        ) : (
                          <PowerOff size={12} />
                        )}
                      </button>
                    )}
                    {plugin.status === 'available' && (
                      <>
                        <button
                          className="plugin-action-btn load"
                          onClick={() => handleLoad(plugin.id)}
                          disabled={actionLoading.has(plugin.id)}
                          title={t('pluginManager.load')}
                        >
                          {actionLoading.has(plugin.id) ? (
                            <Loader2 size={12} className="spin" />
                          ) : (
                            <Power size={12} />
                          )}
                        </button>
                        <button
                          className="plugin-action-btn disable"
                          onClick={() => openDisableDialog(plugin.id)}
                          disabled={actionLoading.has(plugin.id)}
                          title={t('pluginManager.disable')}
                        >
                          <PowerOff size={12} />
                        </button>
                      </>
                    )}
                    {plugin.status === 'disabled' && (
                      <button
                        className="plugin-action-btn enable"
                        onClick={() => handleEnable(plugin.id)}
                        disabled={actionLoading.has(plugin.id)}
                        title={t('pluginManager.enable')}
                      >
                        {actionLoading.has(plugin.id) ? (
                          <Loader2 size={12} className="spin" />
                        ) : (
                          <Power size={12} />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {expandedIds.has(plugin.id) && (
                <div className="plugin-item-details">
                  {plugin.description && (
                    <div className="plugin-detail">
                      <Info size={12} />
                      <span>{plugin.description}</span>
                    </div>
                  )}
                  <div className="plugin-detail">
                    <span className="plugin-detail-label">ID:</span>
                    <code>{plugin.id}</code>
                  </div>
                  {plugin.dependencies.length > 0 && (
                    <div className="plugin-detail">
                      <span className="plugin-detail-label">{t('pluginManager.dependencies')}</span>
                      <div className="plugin-tags">
                        {plugin.dependencies.map((dep) => (
                          <span key={dep} className="plugin-tag dependency">{dep}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {plugin.permissions.length > 0 && (
                    <div className="plugin-detail">
                      <span className="plugin-detail-label">{t('pluginManager.permissions')}</span>
                      <div className="plugin-tags">
                        {plugin.permissions.map((perm) => (
                          <span key={perm} className="plugin-tag permission">{perm}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {disableDialogOpen && (
        <DisableDialog
          onConfirm={handleDisable}
          onCancel={() => {
            setDisableDialogOpen(false);
            setSelectedPluginId(null);
          }}
        />
      )}
    </div>
  );
}

interface DisableDialogProps {
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

function DisableDialog({ onConfirm, onCancel }: DisableDialogProps) {
  const [reason, setReason] = useState('');
  const { t } = useTranslation();

  return (
    <div className="plugin-dialog-overlay" onClick={onCancel}>
      <div className="plugin-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{t('pluginManager.disablePlugin')}</h3>
        <p>{t('pluginManager.disableReasonPrompt')}</p>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t('pluginManager.disableReasonPlaceholder')}
          autoFocus
        />
        <div className="plugin-dialog-actions">
          <button onClick={onCancel}>{t('pluginManager.cancel')}</button>
          <button className="confirm" onClick={() => onConfirm(reason)}>{t('pluginManager.confirmDisable')}</button>
        </div>
      </div>
    </div>
  );
}

export default PluginManager;