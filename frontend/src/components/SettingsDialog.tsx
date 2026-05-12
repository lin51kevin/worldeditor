/**
 * SettingsDialog — application settings dialog with core settings + plugin tabs.
 *
 * Plugin settings tabs are populated from SettingsContrib registrations in
 * pluginContribStore. Each plugin provides a React component rendered as the
 * tab body.
 */
import { useState } from 'react';
import { usePluginContribStore } from '../stores/pluginContribStore';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

const CORE_TAB = '__core__';

/** Core settings body — general editor preferences. */
function CoreSettingsPanel() {
  return (
    <div className="settings-body">
      <p style={{ color: 'var(--color-text-muted, #888)', fontSize: '0.85rem' }}>
        核心编辑器设置 (主题、语言等功能即将推出)
      </p>
    </div>
  );
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const settingsContribs = usePluginContribStore((s) => s.settingsContribs);
  const [activeTab, setActiveTab] = useState<string>(CORE_TAB);

  if (!open) return null;

  const tabs = [
    { id: CORE_TAB, title: '核心设置', component: CoreSettingsPanel },
    ...settingsContribs.map((s) => ({ id: s.id, title: s.title, component: s.component })),
  ];

  const active = tabs.find((t) => t.id === activeTab) ?? tabs[0];
  const ActiveComponent = active?.component ?? (() => null);

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="settings-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="设置"
      >
        <div className="settings-header">
          <h2 className="settings-title">设置</h2>
          <button
            className="settings-close-btn"
            aria-label="关闭设置"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="settings-layout">
          {/* Tab list */}
          <nav className="settings-tabs" aria-label="设置分类">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={`settings-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.title}
              </button>
            ))}
          </nav>

          {/* Tab content */}
          <div className="settings-content">
            <ActiveComponent />
          </div>
        </div>
      </div>
    </div>
  );
}
