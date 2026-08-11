import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Project } from '../services/platform';
import { useProjectStore } from '../stores/projectStore';
import { useAutosave } from './useAutosave';

const mockAutosave = vi.hoisted(() => ({
  saveDraft: vi.fn(),
  clearDraft: vi.fn(),
}));

vi.mock('../utils/autosave', () => mockAutosave);

function makeProject(name = 'Untitled'): Project {
  return {
    name,
    header: {
      rev_major: 1, rev_minor: 6, name: '', date: '',
      north: 0, south: 0, east: 0, west: 0, geo_reference: null,
    },
    roads: [],
    junctions: [],
    signals: [],
    objects: [],
  };
}

describe('useAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    act(() => {
      useProjectStore.setState({ project: makeProject(), isDirty: false });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not save while the project is clean', () => {
    renderHook(() => useAutosave());
    vi.advanceTimersByTime(5000);
    expect(mockAutosave.saveDraft).not.toHaveBeenCalled();
  });

  it('clears any existing draft while the project is clean', () => {
    renderHook(() => useAutosave());
    expect(mockAutosave.clearDraft).toHaveBeenCalled();
  });

  it('debounces the save while the project is dirty', () => {
    act(() => {
      useProjectStore.setState({ isDirty: true });
    });
    renderHook(() => useAutosave());
    vi.advanceTimersByTime(1000);
    expect(mockAutosave.saveDraft).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(mockAutosave.saveDraft).toHaveBeenCalledTimes(1);
  });

  it('resets the debounce timer on rapid successive changes', () => {
    act(() => {
      useProjectStore.setState({ isDirty: true, project: makeProject('A') });
    });
    const { rerender } = renderHook(() => useAutosave());
    vi.advanceTimersByTime(1500);
    act(() => {
      useProjectStore.setState({ project: makeProject('B') });
    });
    rerender();
    vi.advanceTimersByTime(1500);
    expect(mockAutosave.saveDraft).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(mockAutosave.saveDraft).toHaveBeenCalledTimes(1);
    expect(mockAutosave.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ name: 'B' }));
  });

  it('warns before unload when the project is dirty', () => {
    act(() => {
      useProjectStore.setState({ isDirty: true });
    });
    renderHook(() => useAutosave());
    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    const preventDefault = vi.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);
    expect(preventDefault).toHaveBeenCalled();
  });

  it('does not warn before unload when the project is clean', () => {
    renderHook(() => useAutosave());
    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    const preventDefault = vi.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
