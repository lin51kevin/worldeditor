import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMenuActions } from './useMenuActions';
import { useViewportStore } from '../stores/viewportStore';
import { onViewportEvent, type ViewportEvent } from '../viewport/viewportEvents';

describe('useMenuActions – view/navigation handlers', () => {
  let events: ViewportEvent[];
  let unsubscribe: () => void;

  beforeEach(() => {
    events = [];
    unsubscribe = onViewportEvent((e) => events.push(e));
    useViewportStore.setState({ dimension: '3d', showGrid: true, showAxis: true });
  });

  afterEach(() => {
    unsubscribe();
  });

  it('switches to 2D and emits a set-dimension event', () => {
    const { result } = renderHook(() => useMenuActions());
    act(() => result.current.handleView2D());
    expect(useViewportStore.getState().dimension).toBe('2d');
    expect(events).toContainEqual({ type: 'set-dimension', dimension: '2d' });
  });

  it('switches to 3D and emits a set-dimension event', () => {
    const { result } = renderHook(() => useMenuActions());
    act(() => result.current.handleView3D());
    expect(useViewportStore.getState().dimension).toBe('3d');
    expect(events).toContainEqual({ type: 'set-dimension', dimension: '3d' });
  });

  it('emits a zoom-to-fit event', () => {
    const { result } = renderHook(() => useMenuActions());
    act(() => result.current.handleZoomToFit());
    expect(events).toContainEqual({ type: 'zoom-to-fit' });
  });

  it('toggles the grid and emits a set-show-grid event', () => {
    const { result } = renderHook(() => useMenuActions());
    act(() => result.current.handleToggleGrid());
    expect(useViewportStore.getState().showGrid).toBe(false);
    expect(events).toContainEqual({ type: 'set-show-grid', show: false });
  });
});
