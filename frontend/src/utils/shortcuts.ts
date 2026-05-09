/**
 * Keyboard shortcut utilities and hooks
 */

import { useEffect, useCallback } from 'react';

export type KeyModifier = 'ctrl' | 'shift' | 'alt' | 'meta';
export type Key = string;

export interface Shortcut {
  key: Key;
  modifiers?: KeyModifier[];
  description?: string;
  action: () => void;
  preventDefault?: boolean;
}

/**
 * Parse a shortcut string like "Ctrl+N" or "Ctrl+Shift+A"
 */
export function parseShortcut(shortcut: string): {
  key: Key;
  modifiers: KeyModifier[];
} {
  const parts = shortcut.toLowerCase().split('+');
  const key = parts.pop()!.toLowerCase();
  const modifiers: KeyModifier[] = [];
  
  for (const part of parts) {
    const mod = part.trim();
    if (mod === 'ctrl' || mod === 'control') {
      modifiers.push('ctrl');
    } else if (mod === 'shift') {
      modifiers.push('shift');
    } else if (mod === 'alt') {
      modifiers.push('alt');
    } else if (mod === 'meta' || mod === 'cmd') {
      modifiers.push('meta');
    }
  }
  
  return { key, modifiers };
}

/**
 * Check if a keyboard event matches a shortcut
 */
export function matchesShortcut(
  event: KeyboardEvent,
  shortcut: ReturnType<typeof parseShortcut>
): boolean {
  const { key, modifiers } = shortcut;
  
  // Normalize key comparison
  const eventKey = event.key.toLowerCase();
  if (eventKey !== key.toLowerCase()) {
    return false;
  }
  
  // Check modifiers
  if (modifiers.includes('ctrl') !== event.ctrlKey) return false;
  if (modifiers.includes('shift') !== event.shiftKey) return false;
  if (modifiers.includes('alt') !== event.altKey) return false;
  if (modifiers.includes('meta') !== event.metaKey) return false;
  
  return true;
}

/**
 * Register global keyboard shortcuts
 */
export function useGlobalShortcuts(shortcuts: Shortcut[]) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      for (const shortcut of shortcuts) {
        const parsed = parseShortcut(shortcut.key);
        if (matchesShortcut(event, parsed)) {
          if (shortcut.preventDefault !== false) {
            event.preventDefault();
          }
          shortcut.action();
          break;
        }
      }
    },
    [shortcuts]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);
}

/**
 * Predefined shortcuts for the application
 */
export const APP_SHORTCUTS: Record<string, Shortcut> = {
  newProject: {
    key: 'Ctrl+N',
    description: 'Create new project',
    action: () => {},
  },
  openFile: {
    key: 'Ctrl+O',
    description: 'Open file',
    action: () => {},
  },
  save: {
    key: 'Ctrl+S',
    description: 'Save',
    action: () => {},
  },
  undo: {
    key: 'Ctrl+Z',
    description: 'Undo',
    action: () => {},
  },
  redo: {
    key: 'Ctrl+Y',
    description: 'Redo',
    action: () => {},
  },
  delete: {
    key: 'Delete',
    description: 'Delete selected',
    action: () => {},
  },
  selectAll: {
    key: 'Ctrl+A',
    description: 'Select all',
    action: () => {},
  },
  zoomToFit: {
    key: 'Home',
    description: 'Zoom to fit',
    action: () => {},
  },
  toggleFullscreen: {
    key: 'F',
    description: 'Toggle fullscreen',
    action: () => {},
  },
};

/**
 * Hook to use application shortcuts with provided action callbacks
 */
export function useAppShortcuts(actions: Partial<Record<keyof typeof APP_SHORTCUTS, () => void>>) {
  const shortcuts: Shortcut[] = Object.entries(APP_SHORTCUTS).map(([name, shortcut]) => ({
    ...shortcut,
    action: actions[name as keyof typeof APP_SHORTCUTS] || shortcut.action,
  }));
  
  useGlobalShortcuts(shortcuts);
}