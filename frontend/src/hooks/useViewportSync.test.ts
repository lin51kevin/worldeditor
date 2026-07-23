import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createRef } from 'react';
import { useViewportSync } from './useViewportSync';
import { useViewportStore } from '../stores/viewportStore';
import { useThemeStore } from '../stores/themeStore';
import type { ViewportRenderer } from '../viewport/renderer';

interface MockRenderer {
  setShowGrid: Mock;
  setShowAxis: Mock;
  setDimension: Mock;
  setViewMode: Mock;
  resetCamera: Mock;
  setClearColor: Mock;
  setGridColor: Mock;
}

function makeRenderer(): MockRenderer {
  return {
    setShowGrid: vi.fn(),
    setShowAxis: vi.fn(),
    setDimension: vi.fn(),
    setViewMode: vi.fn(),
    resetCamera: vi.fn(),
    setClearColor: vi.fn(),
    setGridColor: vi.fn(),
  };
}

function renderSync(
  renderer: MockRenderer | null,
  status: 'loading' | 'ready' | 'unsupported',
) {
  const ref = createRef<ViewportRenderer | null>();
  ref.current = renderer as unknown as ViewportRenderer;
  return renderHook(() => useViewportSync(ref, status));
}

describe('useViewportSync', () => {
  beforeEach(() => {
    useViewportStore.setState({
      showGrid: true,
      showAxis: true,
      dimension: '3d',
      viewMode: 'solid',
    });
    useThemeStore.setState({ theme: 'dark' });
  });

  it('pushes grid/axis/dimension/viewMode to the renderer when ready', () => {
    const renderer = makeRenderer();
    renderSync(renderer, 'ready');
    expect(renderer.setShowGrid).toHaveBeenCalledWith(true);
    expect(renderer.setShowAxis).toHaveBeenCalledWith(true);
    expect(renderer.setDimension).toHaveBeenCalledWith('3d');
    expect(renderer.setViewMode).toHaveBeenCalledWith('solid');
  });

  it('does nothing while status is not ready', () => {
    const renderer = makeRenderer();
    renderSync(renderer, 'loading');
    expect(renderer.setShowGrid).not.toHaveBeenCalled();
    expect(renderer.setDimension).not.toHaveBeenCalled();
  });

  it('is a no-op when the renderer ref is null', () => {
    expect(() => renderSync(null, 'ready')).not.toThrow();
  });

  it('resets the camera on the viewport:resetCamera event using the current dimension', () => {
    const renderer = makeRenderer();
    renderSync(renderer, 'ready');
    act(() => {
      useViewportStore.setState({ dimension: '2d' });
      window.dispatchEvent(new Event('viewport:resetCamera'));
    });
    expect(renderer.resetCamera).toHaveBeenCalledWith('2d');
  });

  it('re-syncs grid/axis when the store toggles them', () => {
    const renderer = makeRenderer();
    const ref = createRef<ViewportRenderer | null>();
    ref.current = renderer as unknown as ViewportRenderer;
    const { rerender } = renderHook(() => useViewportSync(ref, 'ready'));
    renderer.setShowGrid.mockClear();
    act(() => {
      useViewportStore.setState({ showGrid: false });
    });
    rerender();
    expect(renderer.setShowGrid).toHaveBeenCalledWith(false);
  });
});
