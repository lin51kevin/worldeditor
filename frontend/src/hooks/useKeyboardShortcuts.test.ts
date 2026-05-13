import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import type { ShortcutsConfig } from './useKeyboardShortcuts';
import type { ActiveMode } from '../stores/editorViewStore';

// Stub the editorStore so selectAll / copySelected / etc. don't throw
vi.mock('../stores/editorStore', () => ({
  useEditorStore: {
    getState: () => ({
      canUndo: () => false,
      undo: vi.fn(),
      canRedo: () => false,
      redo: vi.fn(),
      selectAll: vi.fn(),
      copySelected: vi.fn(),
      pasteFromClipboard: vi.fn(),
    }),
  },
}));

vi.mock('../stores/editorViewStore', () => ({
  useEditorViewStore: {
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

describe('useKeyboardShortcuts — mode shortcuts', () => {
  let config: ShortcutsConfig;

  beforeEach(() => {
    config = makeConfig();
    renderHook(() => useKeyboardShortcuts(config));
  });

  it('L → line draw mode', () => {
    press('l');
    expect(config.onSetEditMode).toHaveBeenCalledWith('line');
  });

  it('A → arc draw mode', () => {
    press('a');
    expect(config.onSetEditMode).toHaveBeenCalledWith('arc');
  });

  it('P → spiral draw mode', () => {
    press('p');
    expect(config.onSetEditMode).toHaveBeenCalledWith('spiral');
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

  it('uppercase variants work (L, A, P, S, M, R)', () => {
    (['L', 'A', 'P', 'S', 'M', 'R'] as const).forEach((key) => {
      press(key);
    });
    const modes: ActiveMode[] = ['line', 'arc', 'spiral', 'spline', 'move-road', 'rotate-road'];
    modes.forEach((mode) => {
      expect(config.onSetEditMode).toHaveBeenCalledWith(mode);
    });
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

describe('useKeyboardShortcuts — L no longer toggles left panel', () => {
  it('pressing L calls onSetEditMode, not toggleLeftPanel', () => {
    const config = makeConfig();
    renderHook(() => useKeyboardShortcuts(config));

    press('l');

    expect(config.onSetEditMode).toHaveBeenCalledWith('line');
    expect(config.toggleLeftPanel).not.toHaveBeenCalled();
  });
});
