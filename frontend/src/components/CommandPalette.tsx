import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useProjectStore } from '../stores/projectStore';
import { useViewportStore } from '../stores/viewportStore';
import { useThemeStore } from '../stores/themeStore';
import './CommandPalette.css';

interface Command {
  id: string;
  label: string;
  shortcut?: string;
  category: string;
  description?: string;
  action: () => void;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  const commands = useMemo<Command[]>(() => {
    const { toggleGrid, toggleAxis, setEditMode, clearSplineKnots, toggleLeftPanel, toggleRightPanel, toggleOutputPanel, toggleSnap, setMeasureMode } =
      useViewportStore.getState();
    const { toggleTheme } = useThemeStore.getState();

    return [
      // View
      { id: 'toggle-grid', label: t('toolbar.grid'), shortcut: 'G', category: t('commandPalette.categoryView'), description: t('commandPalette.descToggleGrid', 'Toggle grid visibility'), action: toggleGrid },
      { id: 'toggle-axis', label: t('toolbar.axis'), shortcut: 'A', category: t('commandPalette.categoryView'), description: t('commandPalette.descToggleAxis', 'Toggle axis display'), action: toggleAxis },
      { id: 'toggle-left', label: t('commandPalette.toggleLeft'), shortcut: 'Ctrl+B', category: t('commandPalette.categoryView'), description: t('commandPalette.descToggleLeft', 'Show/hide left panel'), action: toggleLeftPanel },
      { id: 'toggle-right', label: t('commandPalette.toggleRight'), category: t('commandPalette.categoryView'), description: t('commandPalette.descToggleRight', 'Show/hide right panel'), action: toggleRightPanel },
      { id: 'toggle-output', label: t('commandPalette.toggleOutput'), shortcut: 'Ctrl+J', category: t('commandPalette.categoryView'), description: t('commandPalette.descToggleOutput', 'Show/hide output panel'), action: toggleOutputPanel },
      { id: 'toggle-theme', label: t('commandPalette.toggleTheme'), category: t('commandPalette.categoryView'), description: t('commandPalette.descToggleTheme', 'Switch between dark/light theme'), action: toggleTheme },

      // Edit mode
      { id: 'mode-select', label: t('toolbar.select'), shortcut: 'V', category: t('commandPalette.categoryEdit'), description: t('commandPalette.descModeSelect', 'Switch to selection mode'), action: () => setEditMode('default') },
      { id: 'mode-arc', label: t('toolbar.arcEdit'), shortcut: 'A', category: t('commandPalette.categoryEdit'), description: t('commandPalette.descModeArc', 'Switch to arc road drawing mode'), action: () => { clearSplineKnots(); setEditMode('drawArc'); } },
      { id: 'mode-spline', label: t('toolbar.splineEdit'), shortcut: 'S', category: t('commandPalette.categoryEdit'), description: t('commandPalette.descModeSpline', 'Switch to spline editing mode'), action: () => { clearSplineKnots(); setEditMode('spline'); } },
      
      // Tools
      { id: 'toggle-snap', label: t('toolbar.snap'), category: t('commandPalette.categoryTools'), description: t('commandPalette.descToggleSnap', 'Toggle snapping'), action: toggleSnap },
      { id: 'measure-distance', label: t('measurement.distance'), category: t('commandPalette.categoryTools'), description: t('commandPalette.descMeasureDist', 'Measure distance between points'), action: () => setMeasureMode('distance') },
      { id: 'measure-angle', label: t('measurement.angle'), category: t('commandPalette.categoryTools'), description: t('commandPalette.descMeasureAngle', 'Measure angle between lines'), action: () => setMeasureMode('angle') },
      { id: 'measure-area', label: t('measurement.area'), category: t('commandPalette.categoryTools'), description: t('commandPalette.descMeasureArea', 'Measure polygon area'), action: () => setMeasureMode('area') },

      // Actions
      { id: 'undo', label: t('commandPalette.undo'), shortcut: 'Ctrl+Z', category: t('commandPalette.categoryEdit'), description: t('commandPalette.descUndo', 'Undo last action'), action: () => { if (useProjectStore.getState().canUndo()) useProjectStore.getState().undo(); } },
      { id: 'redo', label: t('commandPalette.redo'), shortcut: 'Ctrl+Shift+Z', category: t('commandPalette.categoryEdit'), description: t('commandPalette.descRedo', 'Redo last undone action'), action: () => { if (useProjectStore.getState().canRedo()) useProjectStore.getState().redo(); } },
    ];
  }, [t]);

  const filtered = useMemo(() => {
    if (!query) return commands;
    const q = query.toLowerCase();
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q) || c.category.toLowerCase().includes(q) || (c.description && c.description.toLowerCase().includes(q)),
    );
  }, [commands, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered]);

  const execute = useCallback(
    (cmd: Command) => {
      cmd.action();
      setOpen(false);
      setQuery('');
    },
    [],
  );

  // Ctrl+K to toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
        setQuery('');
      }
      if (e.key === 'Escape') {
        setOpen(false);
        setQuery('');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll('.cp-item');
    items[selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && filtered[selectedIndex]) {
        e.preventDefault();
        execute(filtered[selectedIndex]);
      }
    },
    [filtered, selectedIndex, execute],
  );

  if (!open) return null;

  // Group by category
  const grouped = filtered.reduce<Record<string, Command[]>>((acc, cmd) => {
    (acc[cmd.category] ??= []).push(cmd);
    return acc;
  }, {});

  let flatIndex = 0;

  return (
    <div className="cp-overlay" onClick={() => { setOpen(false); setQuery(''); }}>
      <div className="cp-container" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <input
          ref={inputRef}
          className="cp-input"
          placeholder={t('commandPalette.placeholder', 'Type a command...')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="cp-list" ref={listRef} role="listbox" aria-label={t('commandPalette.placeholder', 'Type a command...')}>
          {Object.entries(grouped).map(([category, cmds]) => (
            <div key={category} role="group" aria-label={category}>
              <div className="cp-category">{category}</div>
              {cmds.map((cmd) => {
                const idx = flatIndex++;
                return (
                  <div
                    key={cmd.id}
                    role="option"
                    aria-selected={idx === selectedIndex}
                    className={`cp-item ${idx === selectedIndex ? 'selected' : ''}`}
                    onClick={() => execute(cmd)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <span className="cp-item-label">{cmd.label}</span>
                    {cmd.description && <span className="cp-item-description">{cmd.description}</span>}
                    {cmd.shortcut && <span className="cp-item-shortcut">{cmd.shortcut}</span>}
                  </div>
                );
              })}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="cp-empty">{t('commandPalette.noResults', 'No results')}</div>
          )}
        </div>
      </div>
    </div>
  );
}
