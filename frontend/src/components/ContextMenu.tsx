import { useEffect, useState, useRef, useCallback } from 'react';
import { getMenuWithPlugins } from '../services/contextMenu';
import type { MenuItem } from '../services/contextMenu';

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  items: MenuItem[];
  activeSubmenu: number | null;
}

export function ContextMenu() {
  const [state, setState] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    items: [],
    activeSubmenu: null,
  });
  const show = useCallback((x: number, y: number, context: string) => {
    const items = getMenuWithPlugins(context, x, y);
    if (items.length === 0) return;
    setState({ visible: true, x, y, items, activeSubmenu: null });
  }, []);

  const hide = useCallback(() => {
    setState((s) => ({ ...s, visible: false, activeSubmenu: null }));
  }, []);

  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) {
        show(detail.x, detail.y, detail.context);
      }
    };
    document.addEventListener('contextmenu:show', handler);

    const closeHandler = () => hide();
    document.addEventListener('click', closeHandler);
    document.addEventListener('contextmenu', closeHandler);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hide();
    });

    return () => {
      document.removeEventListener('contextmenu:show', handler);
      document.removeEventListener('click', closeHandler);
      document.removeEventListener('contextmenu', closeHandler);
    };
  }, [show, hide]);

  if (!state.visible || state.items.length === 0) return null;

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: state.x, top: state.y }}
      onClick={(e) => e.stopPropagation()}
    >
      {state.items.map((item, i) =>
        item.separator ? (
          <div key={i} className="context-menu-separator" />
        ) : (
          <div
            key={i}
            className={`context-menu-item${item.disabled ? ' disabled' : ''}`}
            onClick={() => {
              if (item.disabled) return;
              item.action?.();
              hide();
            }}
            onMouseEnter={() =>
              setState((s) => ({
                ...s,
                activeSubmenu: item.submenu ? i : null,
              }))
            }
          >
            <span className="context-menu-label">{item.label}</span>
            {item.shortcut && <span className="context-menu-shortcut">{item.shortcut}</span>}
            {item.submenu && <span className="context-menu-arrow">▸</span>}
            {item.submenu && state.activeSubmenu === i && (
              <div className="context-menu-submenu">
                {item.submenu.map((sub, j) =>
                  sub.separator ? (
                    <div key={j} className="context-menu-separator" />
                  ) : (
                    <div
                      key={j}
                      className={`context-menu-item${sub.disabled ? ' disabled' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (sub.disabled) return;
                        sub.action?.();
                        hide();
                      }}
                    >
                      <span className="context-menu-label">{sub.label}</span>
                      {sub.shortcut && <span className="context-menu-shortcut">{sub.shortcut}</span>}
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
        ),
      )}
    </div>
  );
}
