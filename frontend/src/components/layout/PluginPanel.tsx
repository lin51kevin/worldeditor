/**
 * PluginPanels — renders plugin-contributed panels as independent floating panels.
 */

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { usePluginContribStore } from '../../stores/pluginContribStore';
import { FloatingPanel } from './FloatingPanel';
import './PluginPanel.css';

function hasRenderableComponent(component: unknown): component is React.ComponentType {
  return component !== null && (typeof component === 'function' || typeof component === 'object');
}

function getPanelClass(position: 'left' | 'right' | 'bottom' | 'float'): string {
  switch (position) {
    case 'left':
      return 'floating-left';
    case 'right':
      return 'floating-right';
    case 'bottom':
      return 'floating-output';
    case 'float':
    default:
      return 'floating-plugin';
  }
}

function getPanelDefaultWidth(position: 'left' | 'right' | 'bottom' | 'float'): number {
  switch (position) {
    case 'left':
      return 320;
    case 'right':
      return 340;
    case 'bottom':
      return 480;
    case 'float':
    default:
      return 340;
  }
}

export function PluginPanels() {
  const { t } = useTranslation();
  const panels = usePluginContribStore((s) => s.panels);
  const panelVisibility = usePluginContribStore((s) => s.panelTabVisibility);
  const hidePanel = usePluginContribStore((s) => s.hidePanel);

  const [activeId, setActiveId] = useState<string | null>(null);
  const prevCountRef = useRef(0);

  const visiblePanels = panels
    .filter((p) => hasRenderableComponent(p.component))
    .filter((p) => panelVisibility[p.id] !== false);

  // Auto-activate newly opened panel so it appears on top
  useEffect(() => {
    if (visiblePanels.length > prevCountRef.current) {
      const newest = visiblePanels[visiblePanels.length - 1];
      if (newest) setActiveId(newest.id);
    }
    prevCountRef.current = visiblePanels.length;
  }, [visiblePanels]);

  if (visiblePanels.length === 0) return null;

  return (
    <>
      {visiblePanels.map((contrib, index) => {
        const Component = contrib.component;
        const title = contrib.titleKey ? t(contrib.titleKey) : contrib.title;

        return (
          <FloatingPanel
            key={contrib.id}
            className={getPanelClass(contrib.position)}
            dragHandleSelector=".plugin-panel-header"
            defaultWidth={getPanelDefaultWidth(contrib.position)}
            minWidth={220}
            maxWidth={680}
            minHeight={140}
            resizeEdges={['top', 'right', 'bottom', 'left']}
            anchorHorizontal={contrib.position === 'right' ? 'right' : 'left'}
            storageKey={`we-plugin-panel-${contrib.id}`}
            onMouseDown={() => setActiveId(contrib.id)}
            style={{
              ...(contrib.position !== 'bottom' && contrib.position !== 'float'
                ? { top: `calc(var(--menubar-height) + ${12 + index * 24}px)` }
                : {}),
              zIndex: activeId === contrib.id ? 25 : undefined,
            }}
          >
            <div className="plugin-panel-shell" data-panel-id={contrib.id}>
              <div className="plugin-panel-header">
                <span className="plugin-panel-title">{title}</span>
                <button
                  className="plugin-panel-close"
                  aria-label={`关闭 ${title}`}
                  onClick={() => hidePanel(contrib.id)}
                  type="button"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="plugin-panel-body">
                <Component />
              </div>
            </div>
          </FloatingPanel>
        );
      })}
    </>
  );
}
