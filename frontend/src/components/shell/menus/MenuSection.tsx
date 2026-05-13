import { ChevronRight } from 'lucide-react';
import type { Menu } from '../menuDefinitions';

export interface MenuSectionInteractionProps {
  isActive: boolean;
  hoveredSubItem: number | null;
  onHover: () => void;
  onToggle: () => void;
  onSubItemHover: (index: number | null) => void;
  onClose: () => void;
}

interface MenuSectionProps extends MenuSectionInteractionProps {
  menu: Menu;
}

export function MenuSection({
  menu,
  isActive,
  hoveredSubItem,
  onHover,
  onToggle,
  onSubItemHover,
  onClose,
}: MenuSectionProps) {
  return (
    <div
      className={`menubar-mega-item ${isActive ? 'active' : ''}`}
      onMouseEnter={onHover}
      onClick={onToggle}
    >
      <span>{menu.label}</span>
      <ChevronRight size={14} className="menubar-mega-arrow" />
      {isActive && (
        <div className="menubar-submenu">
          {menu.items.map((item, i) =>
            item.separator ? (
              <div key={i} className="menubar-separator" />
            ) : item.submenu ? (
              <div
                key={i}
                className={`menubar-dropdown-item menubar-has-sub ${hoveredSubItem === i ? 'sub-active' : ''}`}
                onMouseEnter={() => onSubItemHover(i)}
                onClick={(e) => {
                  e.stopPropagation();
                  onSubItemHover(hoveredSubItem === i ? null : i);
                }}
              >
                <span>{item.label}</span>
                <ChevronRight size={10} className="menubar-sub-arrow" />
                {hoveredSubItem === i && (
                  <div className="menubar-flyout">
                    {item.submenu.map((sub, j) =>
                      sub.separator ? (
                        <div key={j} className="menubar-separator" />
                      ) : (
                        <button
                          key={j}
                          className={`menubar-dropdown-item ${sub.disabled ? 'disabled' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!sub.disabled && sub.action) {
                              sub.action();
                              onClose();
                            }
                          }}
                          disabled={sub.disabled}
                        >
                          <span>{sub.label}</span>
                          {sub.shortcut && <span className="menubar-shortcut">{sub.shortcut}</span>}
                        </button>
                      ),
                    )}
                  </div>
                )}
              </div>
            ) : (
              <button
                key={i}
                className={`menubar-dropdown-item ${item.disabled ? 'disabled' : ''} ${item.checked ? 'checked' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!item.disabled) {
                    item.action?.();
                    onClose();
                  }
                }}
                disabled={item.disabled}
              >
                <span>{item.label}</span>
                {item.shortcut && <span className="menubar-shortcut">{item.shortcut}</span>}
                {item.checked !== undefined && (
                  <span className="menubar-check">{item.checked ? '✓' : ''}</span>
                )}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
