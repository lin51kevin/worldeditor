/**
 * useKeyboardShortcuts — centralised keyboard shortcut handler.
 *
 * All global keyboard shortcuts live here instead of polluting App.tsx.
 * Shortcuts are only active when not inside an input/textarea/select/dialog.
 */
import { useEffect } from 'react';
import { useEditorStore } from '../stores/editorStore';

function isEditableTarget(e: KeyboardEvent): boolean {
  const t = e.target;
  if (!(t instanceof Element)) return false;
  const el = t as HTMLElement;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    !!el.closest('.cp-overlay, .menubar-dropdown, [role="dialog"], dialog')
  );
}

interface ShortcutsConfig {
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  toggleOutputPanel: () => void;
  onShowShortcutHelp: (show: boolean) => void;
}

export function useKeyboardShortcuts({
  toggleLeftPanel,
  toggleRightPanel,
  toggleOutputPanel,
  onShowShortcutHelp,
}: ShortcutsConfig): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;

      // Ctrl+Z: undo
      if (mod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const { canUndo, undo } = useEditorStore.getState();
        if (canUndo()) undo();
        return;
      }
      // Ctrl+Y or Ctrl+Shift+Z: redo
      if (mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        const { canRedo, redo } = useEditorStore.getState();
        if (canRedo()) redo();
        return;
      }
      // Ctrl+B: toggle left panel
      if (mod && e.key === 'b') {
        e.preventDefault();
        toggleLeftPanel();
        return;
      }
      // Ctrl+J: toggle output panel
      if (mod && e.key === 'j') {
        e.preventDefault();
        toggleOutputPanel();
        return;
      }
      // Ctrl+A: select all
      if (mod && e.key === 'a') {
        e.preventDefault();
        useEditorStore.getState().selectAll();
        return;
      }
      // Ctrl+C: copy selected
      if (mod && e.key === 'c') {
        e.preventDefault();
        useEditorStore.getState().copySelected();
        return;
      }
      // Ctrl+V: paste
      if (mod && e.key === 'v') {
        e.preventDefault();
        useEditorStore.getState().pasteFromClipboard();
        return;
      }

      // Non-modifier shortcuts (only when not in editable target)
      if (isEditableTarget(e)) return;
      if (mod || e.altKey) return;

      // L: toggle layer panel
      if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        toggleLeftPanel();
        return;
      }
      // I: toggle inspector
      if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        toggleRightPanel();
        return;
      }
      // ?: toggle shortcut help
      if (e.key === '?') {
        onShowShortcutHelp(true);
        return;
      }
      // Escape: close shortcut help
      if (e.key === 'Escape') {
        onShowShortcutHelp(false);
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleLeftPanel, toggleRightPanel, toggleOutputPanel, onShowShortcutHelp]);
}
