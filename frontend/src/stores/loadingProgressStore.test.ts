import { describe, it, expect, beforeEach } from 'vitest';
import { useLoadingProgressStore } from './loadingProgressStore';

describe('loadingProgressStore', () => {
  beforeEach(() => {
    useLoadingProgressStore.getState().reset();
  });

  it('should start in idle state', () => {
    const state = useLoadingProgressStore.getState();
    expect(state.phase).toBe('idle');
    expect(state.progress).toBe(0);
    expect(state.fileName).toBe('');
  });

  it('should transition to reading phase on startLoading', () => {
    useLoadingProgressStore.getState().startLoading('test.xodr');
    const state = useLoadingProgressStore.getState();
    expect(state.phase).toBe('reading');
    expect(state.progress).toBe(0);
    expect(state.fileName).toBe('test.xodr');
  });

  it('should update progress and phase', () => {
    useLoadingProgressStore.getState().startLoading('map.xodr');
    useLoadingProgressStore.getState().updateProgress('parsing', 50);
    const state = useLoadingProgressStore.getState();
    expect(state.phase).toBe('parsing');
    expect(state.progress).toBe(50);
  });

  it('should clamp progress to 0-100 range', () => {
    useLoadingProgressStore.getState().startLoading('map.xodr');
    useLoadingProgressStore.getState().updateProgress('parsing', 150);
    expect(useLoadingProgressStore.getState().progress).toBe(100);

    useLoadingProgressStore.getState().updateProgress('parsing', -10);
    expect(useLoadingProgressStore.getState().progress).toBe(0);
  });

  it('should set done phase on finishLoading', () => {
    useLoadingProgressStore.getState().startLoading('map.xodr');
    useLoadingProgressStore.getState().finishLoading();
    const state = useLoadingProgressStore.getState();
    expect(state.phase).toBe('done');
    expect(state.progress).toBe(100);
  });

  it('should reset to idle state', () => {
    useLoadingProgressStore.getState().startLoading('map.xodr');
    useLoadingProgressStore.getState().updateProgress('generating-mesh', 80);
    useLoadingProgressStore.getState().reset();
    const state = useLoadingProgressStore.getState();
    expect(state.phase).toBe('idle');
    expect(state.progress).toBe(0);
    expect(state.fileName).toBe('');
  });
});
