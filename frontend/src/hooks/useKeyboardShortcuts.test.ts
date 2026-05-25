import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import type { ShortcutsConfig } from './useKeyboardShortcuts';
import type { ActiveMode } from '../stores/viewportStore';

const mockedProjectState = vi.hoisted(() => ({
  state: {
    canUndo: () => false,
    undo: vi.fn(),
    canRedo: () => false,
    redo: vi.fn(),
    selectAll: vi.fn(),
    copySelected: vi.fn(),
    pasteFromClipboard: vi.fn(),
    selectedRoadId: null as string | null,
  },
}));

// Stub the projectStore so selectAll / copySelected / etc. don't throw
vi.mock('../stores/projectStore', () => ({
  useProjectStore: {
    getState: () => mockedProjectState.state,
  },
}));

vi.mock('../stores/viewportStore', () => ({
  useViewportStore: {
    getState: () => ({
      editMode: null,
      setEditMode: vi.fn(),
    }),
  },
}));

function makeConfig(overrides?: Partial<ShortcutsConfig>): ShortcutsConfig {
  return {
    toggleLeftPanel: vi.fn(),
    toggleRightPanel: vi.fn(),
    toggleOutputPanel: vi.fn(),
    onShowShortcutHelp: vi.fn(),
    onSetEditMode: vi.fn(),
    onEscape: vi.fn(),
    onDeleteSelected: vi.fn(),
    onZoomToFit: vi.fn(),
    ...overrides,
  };
}

function press(key: string, extra?: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key,
    ...extra,
  });
  act(() => { window.dispatchEvent(event); });
  return event;
}

beforeEach(() => {
  mockedProjectState.state.selectedRoadId = null;
});

describe('useKeyboardShortcuts — mode shortcuts', () => {
  let config: ShortcutsConfig;

  beforeEach(() => {
    config = makeConfig();
    renderHook(() => useKeyboardShortcuts(config));
  });

  it('P → spiral draw mode', () => {
    press('p');
    expect(config.onSetEditMode).toHaveBeenCalledWith('drawSpiral');
  });

  it('S → spline draw mode', () => {
    press('s');
    expect(config.onSetEditMode).toHaveBeenCalledWith('spline');
  });

  it('M → move-road mode', () => {
    press('m');
    expect(config.onSetEditMode).toHaveBeenCalledWith('move-road');
  });

  it('R → rotate-road mode', () => {
    press('r');
    expect(config.onSetEditMode).toHaveBeenCalledWith('rotate-road');
  });

  it('uppercase variants work (A, P, S, M, R)', () => {
    (['A', 'P', 'S', 'M', 'R'] as const).forEach((key) => {
      press(key);
    });
    const modes: ActiveMode[] = ['drawArc', 'drawSpiral', 'spline', 'move-road', 'rotate-road'];
    modes.forEach((mode) => {
      expect(config.onSetEditMode).toHaveBeenCalledWith(mode);
    });
  });

  it('X → split mode when a road is selected', () => {
    mockedProjectState.state.selectedRoadId = 'road-1';
    press('x');
    expect(config.onSetEditMode).toHaveBeenCalledWith('split');
  });

  it('X does nothing when no road is selected', () => {
    press('x');
    expect(config.onSetEditMode).not.toHaveBeenCalledWith('split');
  });
});

describe('useKeyboardShortcuts — universal shortcuts', () => {
  let config: ShortcutsConfig;

  beforeEach(() => {
    config = makeConfig();
    renderHook(() => useKeyboardShortcuts(config));
  });

  it('Escape → calls onEscape + closes help', () => {
    press('Escape');
    expect(config.onEscape).toHaveBeenCalledTimes(1);
    expect(config.onShowShortcutHelp).toHaveBeenCalledWith(false);
    // onSetEditMode should NOT be called directly by Escape (logic is in onEscape callback)
    expect(config.onSetEditMode).not.toHaveBeenCalled();
  });

  it('Delete → onDeleteSelected', () => {
    press('Delete');
    expect(config.onDeleteSelected).toHaveBeenCalledTimes(1);
  });

  it('Backspace → onDeleteSelected', () => {
    press('Backspace');
    expect(config.onDeleteSelected).toHaveBeenCalledTimes(1);
  });

  it('F → onZoomToFit', () => {
    press('f');
    expect(config.onZoomToFit).toHaveBeenCalledTimes(1);
  });

  it('I → toggleRightPanel', () => {
    press('i');
    expect(config.toggleRightPanel).toHaveBeenCalledTimes(1);
  });

  it('? → opens shortcut help', () => {
    press('?');
    expect(config.onShowShortcutHelp).toHaveBeenCalledWith(true);
  });
});

describe('useKeyboardShortcuts — suppressed inside editable targets', () => {
  it('does not fire mode shortcuts when focused inside an input', () => {
    const config = makeConfig();
    renderHook(() => useKeyboardShortcuts(config));

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent('keydown', {
      bubbles: true, cancelable: true, key: 'l',
    });
    // Manually set target by dispatching on the input
    act(() => { input.dispatchEvent(event); });

    expect(config.onSetEditMode).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });
});

describe('useKeyboardShortcuts — other draw shortcuts', () => {
  it('pressing L does not call onSetEditMode', () => {
    const config = makeConfig();
    renderHook(() => useKeyboardShortcuts(config));
    press('l');
    expect(config.onSetEditMode).not.toHaveBeenCalled();
  });

  it('pressing A activates arc draw mode', () => {
    const config = makeConfig();
    renderHook(() => useKeyboardShortcuts(config));
    press('a');
    expect(config.onSetEditMode).toHaveBeenCalledWith('drawArc');
  });
});

describe('useKeyboardShortcuts — Ctrl+V/C/A pass through in editable targets', () => {
  let config: ShortcutsConfig;

  beforeEach(() => {
    config = makeConfig();
    renderHook(() => useKeyboardShortcuts(config));
  });

  it('Ctrl+V is not intercepted when focused on an input element', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent('keydown', {
      bubbles: true, cancelable: true, key: 'v', ctrlKey: true,
    });
    act(() => { input.dispatchEvent(event); });

    // Native paste should work — event NOT prevented
    expect(event.defaultPrevented).toBe(false);
    document.body.removeChild(input);
  });

  it('Ctrl+C is not intercepted when focused on a textarea element', () => {
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();

    const event = new KeyboardEvent('keydown', {
      bubbles: true, cancelable: true, key: 'c', ctrlKey: true,
    });
    act(() => { textarea.dispatchEvent(event); });

    expect(event.defaultPrevented).toBe(false);
    document.body.removeChild(textarea);
  });

  it('Ctrl+A is not intercepted when focused on an input element', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent('keydown', {
      bubbles: true, cancelable: true, key: 'a', ctrlKey: true,
    });
    act(() => { input.dispatchEvent(event); });

    expect(event.defaultPrevented).toBe(false);
    document.body.removeChild(input);
  });

  it('Ctrl+Z is not intercepted when focused on an input element', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent('keydown', {
      bubbles: true, cancelable: true, key: 'z', ctrlKey: true,
    });
    act(() => { input.dispatchEvent(event); });

    expect(event.defaultPrevented).toBe(false);
    document.body.removeChild(input);
  });

  it('Ctrl+V still triggers editor paste when not on an editable element', () => {
    const event = new KeyboardEvent('keydown', {
      bubbles: true, cancelable: true, key: 'v', ctrlKey: true,
    });
    act(() => { window.dispatchEvent(event); });

    // Editor paste intercepted the event
    expect(event.defaultPrevented).toBe(true);
  });

  it('Ctrl+B still toggles left panel when focused on an input', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent('keydown', {
      bubbles: true, cancelable: true, key: 'b', ctrlKey: true,
    });
    act(() => { input.dispatchEvent(event); });

    expect(config.toggleLeftPanel).toHaveBeenCalledTimes(1);
    document.body.removeChild(input);
  });

  it('Ctrl+J still toggles output panel when focused on an input', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent('keydown', {
      bubbles: true, cancelable: true, key: 'j', ctrlKey: true,
    });
    act(() => { input.dispatchEvent(event); });

    expect(config.toggleOutputPanel).toHaveBeenCalledTimes(1);
    document.body.removeChild(input);
  });
});
