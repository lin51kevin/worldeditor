import React, { useEffect, useRef, useCallback, type ComponentType, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { FloatingPanel } from './FloatingPanel';
import './TabbedFloatingPanel.css';

export interface TabConfig {
  id: string;
  title: string;
  icon?: ReactNode;
  component: ComponentType;
  visible: boolean;
  closable?: boolean;
  onActivate?: () => void;
}

export interface TabbedFloatingPanelProps {
  storageKey: string;
  defaultWidth: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  activeTabId: string | null;
  onTabChange: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  tabs: TabConfig[];
  onClose?: () => void;
}

export function TabbedFloatingPanel({
  storageKey,
  defaultWidth,
  minWidth = 180,
  maxWidth = 600,
  minHeight = 150,
  activeTabId,
  onTabChange,
  onTabClose,
  tabs,
  onClose,
}: TabbedFloatingPanelProps) {
  // 固定属性页为首个标签
  const visibleTabs = tabs.filter((t) => t.visible);
  const propertyTab = visibleTabs.find((t) => t.id === 'core:property');
  const otherTabs = visibleTabs.filter((t) => t.id !== 'core:property');
  const orderedTabs = propertyTab ? [propertyTab, ...otherTabs] : otherTabs;

  const effectiveActiveTabId = orderedTabs.some((tab) => tab.id === activeTabId)
    ? activeTabId
    : orderedTabs[0]?.id ?? null;

  useEffect(() => {
    if (effectiveActiveTabId !== null && effectiveActiveTabId !== activeTabId) {
      onTabChange(effectiveActiveTabId);
    }
  }, [activeTabId, effectiveActiveTabId, onTabChange]);

  // refs for tab bar and tab elements
  const tabBarRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // 滚动当前标签到可见
  useEffect(() => {
    if (tabBarRef.current && effectiveActiveTabId && tabRefs.current[effectiveActiveTabId]) {
      tabRefs.current[effectiveActiveTabId]?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [effectiveActiveTabId]);

  // 键盘左右切换标签
  const handleTabBarKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const idx = orderedTabs.findIndex((t) => t.id === effectiveActiveTabId);
    if (idx === -1) return;
    let nextIdx = idx;
    if (e.key === 'ArrowLeft') {
      nextIdx = idx > 0 ? idx - 1 : idx;
    } else if (e.key === 'ArrowRight') {
      nextIdx = idx < orderedTabs.length - 1 ? idx + 1 : idx;
    }
    const nextTab = orderedTabs[nextIdx];
    if (nextIdx !== idx && nextTab && typeof nextTab.id === 'string') {
      onTabChange(nextTab.id);
    }
  }, [orderedTabs, effectiveActiveTabId, onTabChange]);

  if (visibleTabs.length === 0) {
    return null;
  }

  return (
    <FloatingPanel
      storageKey={storageKey}
      defaultWidth={defaultWidth}
      minWidth={minWidth}
      maxWidth={maxWidth}
      minHeight={minHeight}
      dragHandleSelector=".tp-header"
      resizeEdges={['top', 'right', 'bottom', 'left']}
      onClose={onClose}
      className="tp-panel"
    >
      <div className="tp-header">
        <div
          className="tp-tabs"
          ref={tabBarRef}
          tabIndex={0}
          onKeyDown={handleTabBarKeyDown}
        >
          {orderedTabs.map((tab) => {
            const isActive = tab.id === effectiveActiveTabId;
            const isClosable = tab.closable !== false;
            return (
              <div
                key={tab.id}
                ref={el => { tabRefs.current[tab.id] = el; }}
                className={`tp-tab ${isActive ? 'tp-tab--active' : ''} ${isClosable ? 'tp-tab--closable' : ''} ${tab.id === 'core:property' ? 'tp-tab--fixed' : ''}`}
                onClick={() => {
                  if (!isActive) {
                    onTabChange(tab.id);
                    tab.onActivate?.();
                  }
                }}
              >
                {tab.icon && <span className="tp-tab-icon">{tab.icon}</span>}
                <span className="tp-tab-title">{tab.title}</span>
                {isClosable && (
                  <button
                    className="tp-tab-close"
                    aria-label={`关闭 ${tab.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onTabClose(tab.id);
                    }}
                    type="button"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <button
          className="tp-panel-close"
          aria-label="关闭面板"
          onClick={onClose}
          type="button"
        >
          <X size={16} />
        </button>
      </div>
      <div className="tp-content">
        {orderedTabs.map((tab) => {
          const Component = tab.component;
          return (
            <div
              key={tab.id}
              style={{ display: tab.id === effectiveActiveTabId ? undefined : 'none', height: '100%' }}
            >
              <Component />
            </div>
          );
        })}
      </div>
    </FloatingPanel>
  );
}
