/**
 * useKeyboardShortcuts — centralised keyboard shortcut handler.
 *
 * Tool shortcuts:
 *   Drawing modes  — A (arc) · P (spiral) · S (spline)
 *   Transform      — M (move-road, toggle) · R (rotate-road, toggle) · X (split, toggle)
 *   Universal      — Escape (smart cancel) · Delete/Backspace (delete) · F (zoom-to-fit)
 *   Panels         — I (inspector) · Ctrl+B/Ctrl+J (panels) · / or ? (help)
 *
 * Escape behaviour in draw modes (spline):
 *   1st press — clears in-progress knots (cancels current stroke, stays in mode)
 *   2nd press — returns to default select mode
 */
import { useEffect } from 'react';
import { isShortcutHelpTrigger } from '../constants/shortcutHelp';
import { useProjectStore } from '../stores/projectStore';
import { isDrawMode, useViewportStore } from '../stores/viewportStore';
import type { ActiveMode } from '../stores/viewportStore';

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
  toggleValidationPanel?: () => void;
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
  toggleValidationPanel,
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

      // When focus is on an editable element (input/textarea/select/dialog),
      // allow native browser behavior for text-editing shortcuts (Ctrl+Z/Y/A/C/V/X).
      if (mod && isEditableTarget(e)) {
        // Ctrl+Shift+V (validation panel toggle) is not a text shortcut — still handle it.
        if (e.shiftKey && (e.key === 'v' || e.key === 'V')) {
          e.preventDefault();
          toggleValidationPanel?.();
          return;
        }
        // Ctrl+B (toggle left panel) is not a text shortcut — still handle it.
        if (e.key === 'b') {
          e.preventDefault();
          toggleLeftPanel();
          return;
        }
        // Ctrl+J (toggle output panel) is not a text shortcut — still handle it.
        if (e.key === 'j') {
          e.preventDefault();
          toggleOutputPanel();
          return;
        }
        // All other Ctrl+key combos in editable elements: let the browser handle natively
        return;
      }

      // When text is selected anywhere in the document, allow native Ctrl+C/X for copy/cut
      if (mod && (e.key === 'c' || e.key === 'x')) {
        const selection = window.getSelection();
        if (selection && selection.toString().length > 0) {
          return; // Let native copy/cut work
        }
      }

      if (mod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const { canUndo, undo } = useProjectStore.getState();
        if (canUndo()) undo();
        return;
      }
      if (mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        const { canRedo, redo } = useProjectStore.getState();
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
      if (mod && e.shiftKey && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        toggleValidationPanel?.();
        return;
      }
      if (mod && e.key === 'a') {
        e.preventDefault();
        useProjectStore.getState().selectAll();
        return;
      }
      if (mod && e.key === 'c') {
        e.preventDefault();
        useProjectStore.getState().copySelected();
        return;
      }
      if (mod && e.key === 'v') {
        e.preventDefault();
        useProjectStore.getState().pasteFromClipboard();
        return;
      }

      // ── Non-modifier shortcuts ─────────────────────────────────────────────

      if (isEditableTarget(e)) return;
      if (mod || e.altKey) return;

      // While in fly mode (RMB held in 3D), reserve keyboard for camera
      // navigation (WASD/QE). Only Escape is allowed through.
      if (useViewportStore.getState().isFlyMode && e.key !== 'Escape') return;

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

      // V: exit to select mode (force return to default tool, clearing any in-progress draw state)
      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        const { editMode, setEditMode, clearSplineKnots } = useViewportStore.getState();
        if (editMode !== null && editMode !== 'default') {
          if (isDrawMode(editMode)) clearSplineKnots();
          setEditMode('default');
        }
        return;
      }

      // T: toggle road link (predecessor/successor) highlight
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        useViewportStore.getState().toggleRoadLinks();
        return;
      }

      // / or ?: open shortcut help. Match both printable values and the
      // physical Slash key so layouts/IME variants stay consistent.
      if (isShortcutHelpTrigger(e)) {
        e.preventDefault();
        onShowShortcutHelp(true);
        return;
      }

      // ── DrawMode shortcuts ────────────────────────────────────────────────

      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        onSetEditMode('drawArc');
        return;
      }

      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        onSetEditMode('drawSpiral');
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
      if (e.key === 'x' || e.key === 'X') {
        const { selectedRoadId } = useProjectStore.getState();
        if (selectedRoadId) {
          e.preventDefault();
          onSetEditMode('split');
        }
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleLeftPanel, toggleRightPanel, toggleOutputPanel, onShowShortcutHelp,
      onSetEditMode, onEscape, onDeleteSelected, onZoomToFit]);
}
