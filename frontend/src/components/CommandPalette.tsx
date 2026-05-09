import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../stores/editorStore';
import { useEditorViewStore } from '../stores/editorViewStore';
import { useThemeStore } from '../stores/themeStore';
import './CommandPalette.css';

interface Command {
  id: string;
  label: string;
  shortcut?: string;
  category: string;
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
    const { toggleGrid, toggleAxis, setEditMode, setViewMode, toggleLeftPanel, toggleRightPanel, toggleOutputPanel } =
      useEditorViewStore.getState();
    const { toggleTheme } = useThemeStore.getState();

    return [
      // View
      { id: 'toggle-grid', label: t('toolbar.grid'), shortcut: 'G', category: 'View', action: toggleGrid },
      { id: 'toggle-axis', label: t('toolbar.axis'), shortcut: 'A', category: 'View', action: toggleAxis },
      { id: 'toggle-left', label: t('commandPalette.toggleLeft', 'Toggle Left Panel'), shortcut: 'Ctrl+B', category: 'View', action: toggleLeftPanel },
      { id: 'toggle-right', label: t('commandPalette.toggleRight', 'Toggle Right Panel'), category: 'View', action: toggleRightPanel },
      { id: 'toggle-output', label: t('commandPalette.toggleOutput', 'Toggle Output Panel'), shortcut: 'Ctrl+J', category: 'View', action: toggleOutputPanel },
      { id: 'toggle-theme', label: t('commandPalette.toggleTheme', 'Toggle Theme'), category: 'View', action: toggleTheme },

      // Edit mode
      { id: 'mode-select', label: t('toolbar.select'), shortcut: 'V', category: 'Edit', action: () => setEditMode('select') },
      { id: 'mode-road', label: t('toolbar.road'), shortcut: 'R', category: 'Edit', action: () => setEditMode('road') },
      { id: 'mode-lane', label: t('toolbar.lane'), shortcut: 'L', category: 'Edit', action: () => setEditMode('lane') },
      { id: 'mode-junction', label: t('toolbar.junction'), shortcut: 'J', category: 'Edit', action: () => setEditMode('junction') },

      // View mode
      { id: 'view-sketch', label: t('toolbar.sketch'), category: 'Display', action: () => setViewMode('sketch') },
      { id: 'view-wire', label: t('toolbar.wireframe'), category: 'Display', action: () => setViewMode('wire') },
      { id: 'view-solid', label: t('toolbar.solid'), category: 'Display', action: () => setViewMode('solid') },

      // Actions
      { id: 'undo', label: t('menuBar.undo'), shortcut: 'Ctrl+Z', category: 'Edit', action: () => { if (useEditorStore.getState().canUndo()) useEditorStore.getState().undo(); } },
      { id: 'redo', label: t('menuBar.redo'), shortcut: 'Ctrl+Shift+Z', category: 'Edit', action: () => { if (useEditorStore.getState().canRedo()) useEditorStore.getState().redo(); } },
    ];
  }, [t]);

  const filtered = useMemo(() => {
    if (!query) return commands;
    const q = query.toLowerCase();
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q) || c.category.toLowerCase().includes(q),
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
        <div className="cp-list" ref={listRef}>
          {Object.entries(grouped).map(([category, cmds]) => (
            <div key={category}>
              <div className="cp-category">{category}</div>
              {cmds.map((cmd) => {
                const idx = flatIndex++;
                return (
                  <div
                    key={cmd.id}
                    className={`cp-item ${idx === selectedIndex ? 'selected' : ''}`}
                    onClick={() => execute(cmd)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <span className="cp-item-label">{cmd.label}</span>
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
