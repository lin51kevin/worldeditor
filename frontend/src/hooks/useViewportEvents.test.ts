import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createRef } from 'react';
import { useViewportEvents } from './useViewportEvents';
import { emitViewportEvent } from '../viewport/viewportEvents';
import type { ViewportRenderer } from '../viewport/renderer';

interface MockRenderer {
  fitToVertices: Mock;
  setDimension: Mock;
  setShowGrid: Mock;
  setShowAxis: Mock;
  panToCenter: Mock;
}

function makeRenderer(): MockRenderer {
  return {
    fitToVertices: vi.fn(),
    setDimension: vi.fn(),
    setShowGrid: vi.fn(),
    setShowAxis: vi.fn(),
    panToCenter: vi.fn(),
  };
}

function setup(renderer: MockRenderer | null) {
  const rendererRef = createRef<ViewportRenderer | null>();
  rendererRef.current = renderer as unknown as ViewportRenderer;
  const canvasRef = createRef<HTMLCanvasElement | null>();
  canvasRef.current = document.createElement('canvas');
  renderHook(() => useViewportEvents(rendererRef, canvasRef));
}

describe('useViewportEvents', () => {
  let renderer: MockRenderer;

  beforeEach(() => {
    renderer = makeRenderer();
    setup(renderer);
  });

  it('fits the view on zoom-to-fit', () => {
    act(() => emitViewportEvent({ type: 'zoom-to-fit' }));
    expect(renderer.fitToVertices).toHaveBeenCalledOnce();
  });

  it('sets the dimension on set-dimension', () => {
    act(() => emitViewportEvent({ type: 'set-dimension', dimension: '2d' }));
    expect(renderer.setDimension).toHaveBeenCalledWith('2d');
  });

  it('toggles grid visibility on set-show-grid', () => {
    act(() => emitViewportEvent({ type: 'set-show-grid', show: true }));
    expect(renderer.setShowGrid).toHaveBeenCalledWith(true);
  });

  it('toggles axis visibility on set-show-axis', () => {
    act(() => emitViewportEvent({ type: 'set-show-axis', show: false }));
    expect(renderer.setShowAxis).toHaveBeenCalledWith(false);
  });

  it('does not throw when the renderer is unavailable', () => {
    renderHook(() => {
      const rendererRef = createRef<ViewportRenderer | null>();
      const canvasRef = createRef<HTMLCanvasElement | null>();
      return useViewportEvents(rendererRef, canvasRef);
    });
    expect(() => act(() => emitViewportEvent({ type: 'zoom-to-fit' }))).not.toThrow();
  });
});
