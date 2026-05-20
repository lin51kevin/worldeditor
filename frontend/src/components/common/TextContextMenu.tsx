/**
 * TextContextMenu — custom right-click context menu for text operations.
 * Shows only: Cut, Copy, Paste, Select All (no emoji, writing direction, spell check, etc.)
 *
 * Behavior:
 * - On INPUT/TEXTAREA: shows Cut, Copy, Paste, Select All
 * - On text with selection (non-editable): shows Copy, Select All only
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import './TextContextMenu.css';

interface MenuState {
  visible: boolean;
  x: number;
  y: number;
  isEditable: boolean;
  target: HTMLElement | null;
}

export function TextContextMenu() {
  const { t } = useTranslation();
  const [state, setState] = useState<MenuState>({
    visible: false, x: 0, y: 0, isEditable: false, target: null,
  });
  const menuRef = useRef<HTMLDivElement>(null);

  const hide = useCallback(() => {
    setState((s) => ({ ...s, visible: false, target: null }));
  }, []);

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // Check if right-click is on a text-relevant element
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      const isContentEditable = target.isContentEditable;
      const hasSelection = (window.getSelection()?.toString().length ?? 0) > 0;

      // Only show custom menu on editable elements or when text is selected
      if (!isInput && !isContentEditable && !hasSelection) return;

      e.preventDefault();
      e.stopPropagation();

      setState({
        visible: true,
        x: e.clientX,
        y: e.clientY,
        isEditable: isInput || isContentEditable,
        target,
      });
    };

    const handleClick = () => hide();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };

    document.addEventListener('contextmenu', handleContextMenu, true);
    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu, true);
      document.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [hide]);

  const execCommand = useCallback((command: 'cut' | 'copy' | 'paste' | 'selectAll') => {
    const { target } = state;

    if (command === 'selectAll') {
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        (target as HTMLInputElement | HTMLTextAreaElement).select();
      } else {
        // Select all text in the document
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(document.body);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    } else if (command === 'copy') {
      const selection = window.getSelection();
      if (selection && selection.toString()) {
        void navigator.clipboard.writeText(selection.toString());
      }
    } else if (command === 'cut') {
      const selection = window.getSelection();
      if (selection && selection.toString()) {
        void navigator.clipboard.writeText(selection.toString());
        // Delete selected text in editable fields
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
          const input = target as HTMLInputElement | HTMLTextAreaElement;
          const start = input.selectionStart ?? 0;
          const end = input.selectionEnd ?? 0;
          const value = input.value;
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value')?.set ??
            Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
          nativeInputValueSetter?.call(input, value.slice(0, start) + value.slice(end));
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.setSelectionRange(start, start);
        }
      }
    } else if (command === 'paste') {
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        const input = target as HTMLInputElement | HTMLTextAreaElement;
        input.focus();
        void navigator.clipboard.readText().then((text) => {
          const start = input.selectionStart ?? 0;
          const end = input.selectionEnd ?? 0;
          const value = input.value;
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value')?.set ??
            Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
          nativeInputValueSetter?.call(input, value.slice(0, start) + text + value.slice(end));
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.setSelectionRange(start + text.length, start + text.length);
        });
      }
    }

    hide();
  }, [state, hide]);

  if (!state.visible) return null;

  const cutLabel = t('contextMenu.cut', '剪切');
  const copyLabel = t('contextMenu.copy', '复制');
  const pasteLabel = t('contextMenu.paste', '粘贴');
  const selectAllLabel = t('contextMenu.selectAll', '全选');

  return (
    <div
      ref={menuRef}
      className="text-context-menu"
      style={{ left: state.x, top: state.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {state.isEditable && (
        <div className="text-context-menu-item" onClick={() => execCommand('cut')}>
          <span className="text-context-menu-label">{cutLabel}</span>
          <span className="text-context-menu-shortcut">Ctrl+X</span>
        </div>
      )}
      <div className="text-context-menu-item" onClick={() => execCommand('copy')}>
        <span className="text-context-menu-label">{copyLabel}</span>
        <span className="text-context-menu-shortcut">Ctrl+C</span>
      </div>
      {state.isEditable && (
        <div className="text-context-menu-item" onClick={() => execCommand('paste')}>
          <span className="text-context-menu-label">{pasteLabel}</span>
          <span className="text-context-menu-shortcut">Ctrl+V</span>
        </div>
      )}
      <div className="text-context-menu-separator" />
      <div className="text-context-menu-item" onClick={() => execCommand('selectAll')}>
        <span className="text-context-menu-label">{selectAllLabel}</span>
        <span className="text-context-menu-shortcut">Ctrl+A</span>
      </div>
    </div>
  );
}
