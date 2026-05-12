/**
 * PluginPanels — renders all panels registered by plugins via PanelContrib.
 *
 * Each registered panel is shown as a floating/dockable panel.
 * Panels can be dismissed by the user (removes from visible set but not
 * from the store, so the plugin remains loaded).
 */
import { useState, useEffect } from 'react';
import { usePluginContribStore } from '../stores/pluginContribStore';
import type { PanelContrib } from '../stores/pluginContribStore';

interface PluginPanelInstance {
  contrib: PanelContrib;
  visible: boolean;
}

export function PluginPanels() {
  const panels = usePluginContribStore((s) => s.panels);
  const [instances, setInstances] = useState<PluginPanelInstance[]>([]);

  // Sync instances when panels change
  useEffect(() => {
    setInstances((prev) => {
      const prevMap = new Map(prev.map((i) => [i.contrib.id, i]));
      const next = panels.map((contrib) => {
        const existing = prevMap.get(contrib.id);
        return existing ? { ...existing, contrib } : { contrib, visible: true };
      });
      return next;
    });
  }, [panels]);

  const close = (id: string) => {
    setInstances((prev) =>
      prev.map((i) => (i.contrib.id === id ? { ...i, visible: false } : i)),
    );
  };

  const visible = instances.filter((i) => i.visible);
  if (visible.length === 0) return null;

  return (
    <>
      {visible.map(({ contrib }) => {
        const Component = contrib.component;
        return (
          <div
            key={contrib.id}
            className={`plugin-panel plugin-panel--${contrib.position}`}
            data-panel-id={contrib.id}
          >
            <div className="plugin-panel-header">
              <span className="plugin-panel-title">{contrib.title}</span>
              <button
                className="plugin-panel-close"
                aria-label={`关闭 ${contrib.title}`}
                onClick={() => close(contrib.id)}
              >
                ×
              </button>
            </div>
            <div className="plugin-panel-body">
              <Component />
            </div>
          </div>
        );
      })}
    </>
  );
}
