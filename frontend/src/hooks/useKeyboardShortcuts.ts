/**
 * useKeyboardShortcuts — centralised keyboard shortcut handler.
 *
 * Tool shortcuts:
 *   Drawing modes  — L (line) · A (arc) · P (spiral) · S (spline)
 *   Transform      — M (move-road, toggle) · R (rotate-road, toggle)
 *   Universal      — Escape (smart cancel) · Delete/Backspace (delete) · F (zoom-to-fit)
 *   Panels         — I (inspector) · Ctrl+B (left panel) · ? (help)
 *
 * Escape behaviour in draw modes (line/arc/spiral/spline):
 *   1st press — clears in-progress knots (cancels current stroke, stays in mode)
 *   2nd press — returns to default select mode
 */
import { useEffect } from 'react';
import { useEditorStore } from '../stores/editorStore';
import type { ActiveMode } from '../stores/editorViewStore';

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

export interface ShortcutsConfig {
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  toggleOutputPanel: () => void;
  onShowShortcutHelp: (show: boolean) => void;
  /** Called when a shortcut should change the active edit/draw mode. */
  onSetEditMode: (mode: ActiveMode) => void;
  /**
   * Called when Escape is pressed. The caller is responsible for smart
   * cancel logic (clear knots vs. return to default).
   */
  onEscape: () => void;
  /** Called when the user presses Delete / Backspace to remove the selection. */
  onDeleteSelected: () => void;
  /** Called when the user presses F to zoom-to-fit. Optional — no-op if absent. */
  onZoomToFit?: () => void;
}

export function useKeyboardShortcuts({
  toggleLeftPanel,
  toggleRightPanel,
  toggleOutputPanel,
  onShowShortcutHelp,
  onSetEditMode,
  onEscape,
  onDeleteSelected,
  onZoomToFit,
}: ShortcutsConfig): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;

      // ── Modifier shortcuts ────────────────────────────────────────────────

      if (mod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const { canUndo, undo } = useEditorStore.getState();
        if (canUndo()) undo();
        return;
      }
      if (mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        const { canRedo, redo } = useEditorStore.getState();
        if (canRedo()) redo();
        return;
      }
      if (mod && e.key === 'b') {
        e.preventDefault();
        toggleLeftPanel();
        return;
      }
      if (mod && e.key === 'j') {
        e.preventDefault();
        toggleOutputPanel();
        return;
      }
      if (mod && e.key === 'a') {
        e.preventDefault();
        useEditorStore.getState().selectAll();
        return;
      }
      if (mod && e.key === 'c') {
        e.preventDefault();
        useEditorStore.getState().copySelected();
        return;
      }
      if (mod && e.key === 'v') {
        e.preventDefault();
        useEditorStore.getState().pasteFromClipboard();
        return;
      }

      // ── Non-modifier shortcuts ─────────────────────────────────────────────

      if (isEditableTarget(e)) return;
      if (mod || e.altKey) return;

      // Escape: smart cancel (draw modes: clear knots first; then → default)
      if (e.key === 'Escape') {
        e.preventDefault();
        onEscape();
        onShowShortcutHelp(false);
        return;
      }

      // Delete / Backspace: remove selected element
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        onDeleteSelected();
        return;
      }

      // F: zoom-to-fit
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        onZoomToFit?.();
        return;
      }

      // I: toggle inspector panel
      if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        toggleRightPanel();
        return;
      }

      // ?: open shortcut help
      if (e.key === '?') {
        onShowShortcutHelp(true);
        return;
      }

      // ── DrawMode shortcuts ────────────────────────────────────────────────

      if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        onSetEditMode('line');
        return;
      }
      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        onSetEditMode('arc');
        return;
      }
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        onSetEditMode('spiral');
        return;
      }
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        onSetEditMode('spline');
        return;
      }

      // ── EditMode (transform) shortcuts — toggle back to default if active ─

      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        onSetEditMode('move-road');
        return;
      }
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        onSetEditMode('rotate-road');
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleLeftPanel, toggleRightPanel, toggleOutputPanel, onShowShortcutHelp,
      onSetEditMode, onEscape, onDeleteSelected, onZoomToFit]);
}
