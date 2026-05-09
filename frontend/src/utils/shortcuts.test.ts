import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { parseShortcut, matchesShortcut, APP_SHORTCUTS, useAppShortcuts, useGlobalShortcuts } from './shortcuts';

describe('parseShortcut', () => {
  it.each([
    ['Ctrl+N', 'n', ['ctrl']],
    ['Ctrl+Shift+A', 'a', ['ctrl', 'shift']],
    ['Alt+F4', 'f4', ['alt']],
    ['Meta+S', 's', ['meta']],
    ['Cmd+Z', 'z', ['meta']],
    ['Control+C', 'c', ['ctrl']],
    ['Delete', 'delete', []],
    ['Home', 'home', []],
    ['F', 'f', []],
  ] as const)('parses %s', (shortcut, key, modifiers) => {
    expect(parseShortcut(shortcut)).toEqual({ key, modifiers });
  });
});

describe('matchesShortcut', () => {
  it('matches a Ctrl+N event', () => {
    const event = new KeyboardEvent('keydown', { key: 'n', ctrlKey: true });

    expect(matchesShortcut(event, parseShortcut('Ctrl+N'))).toBe(true);
  });

  it('does not match when the key is wrong', () => {
    const event = new KeyboardEvent('keydown', { key: 'o', ctrlKey: true });

    expect(matchesShortcut(event, parseShortcut('Ctrl+N'))).toBe(false);
  });

  it('does not match when a required modifier is missing', () => {
    const event = new KeyboardEvent('keydown', { key: 'n' });

    expect(matchesShortcut(event, parseShortcut('Ctrl+N'))).toBe(false);
  });

  it('does not match when an extra modifier is present', () => {
    const event = new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, shiftKey: true });

    expect(matchesShortcut(event, parseShortcut('Ctrl+N'))).toBe(false);
  });

  it('matches case-insensitive keys', () => {
    const event = new KeyboardEvent('keydown', { key: 'N', ctrlKey: true });

    expect(matchesShortcut(event, parseShortcut('ctrl+n'))).toBe(true);
  });

  it('matches an event with no modifiers', () => {
    const event = new KeyboardEvent('keydown', { key: 'Delete' });

    expect(matchesShortcut(event, parseShortcut('Delete'))).toBe(true);
  });
});

function dispatchKey(init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  });

  act(() => {
    document.dispatchEvent(event);
  });

  return event;
}

describe('APP_SHORTCUTS', () => {
  it('has the expected shortcut keys', () => {
    expect(Object.keys(APP_SHORTCUTS)).toEqual(
      expect.arrayContaining([
        'newProject',
        'openFile',
        'save',
        'undo',
        'redo',
        'delete',
        'selectAll',
        'zoomToFit',
        'toggleFullscreen',
      ])
    );
  });

  it('gives each shortcut a key and action', () => {
    for (const shortcut of Object.values(APP_SHORTCUTS)) {
      expect(shortcut).toEqual(
        expect.objectContaining({
          key: expect.any(String),
          action: expect.any(Function),
        })
      );
    }
  });
});

describe('shortcut hooks', () => {
  it('useGlobalShortcuts fires an action for matching keydown events', () => {
    const action = vi.fn();

    renderHook(() => useGlobalShortcuts([{ key: 'Ctrl+N', action }]));
    const event = dispatchKey({ key: 'n', ctrlKey: true });

    expect(action).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('useAppShortcuts registers all application shortcuts', () => {
    const actions = {
      newProject: vi.fn(),
      openFile: vi.fn(),
      save: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      delete: vi.fn(),
      selectAll: vi.fn(),
      zoomToFit: vi.fn(),
      toggleFullscreen: vi.fn(),
    };

    renderHook(() => useAppShortcuts(actions));

    dispatchKey({ key: 'n', ctrlKey: true });
    dispatchKey({ key: 'o', ctrlKey: true });
    dispatchKey({ key: 's', ctrlKey: true });
    dispatchKey({ key: 'z', ctrlKey: true });
    dispatchKey({ key: 'y', ctrlKey: true });
    dispatchKey({ key: 'Delete' });
    dispatchKey({ key: 'a', ctrlKey: true });
    dispatchKey({ key: 'Home' });
    dispatchKey({ key: 'f' });

    Object.values(actions).forEach((action) => {
      expect(action).toHaveBeenCalledTimes(1);
    });
  });

  it('useAppShortcuts falls back to built-in no-op actions', () => {
    renderHook(() => useAppShortcuts({}));

    expect(() => {
      dispatchKey({ key: 'n', ctrlKey: true });
      dispatchKey({ key: 'o', ctrlKey: true });
      dispatchKey({ key: 's', ctrlKey: true });
      dispatchKey({ key: 'z', ctrlKey: true });
      dispatchKey({ key: 'y', ctrlKey: true });
      dispatchKey({ key: 'Delete' });
      dispatchKey({ key: 'a', ctrlKey: true });
      dispatchKey({ key: 'Home' });
      dispatchKey({ key: 'f' });
    }).not.toThrow();
  });
});
