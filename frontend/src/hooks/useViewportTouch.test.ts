import { describe, it, expect, vi, type Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createRef } from 'react';
import { useViewportTouch } from './useViewportTouch';
import type { ViewportRenderer } from '../viewport/renderer';

interface MockRenderer {
  applyPan: Mock;
  applyZoomFactor: Mock;
}

function touchEvent(points: Array<{ id: number; x: number; y: number }>) {
  return {
    preventDefault: vi.fn(),
    touches: points.map((p) => ({ identifier: p.id, clientX: p.x, clientY: p.y })),
  } as unknown as React.TouchEvent<HTMLCanvasElement>;
}

function setup(renderer: MockRenderer | null = { applyPan: vi.fn(), applyZoomFactor: vi.fn() }) {
  const rendererRef = createRef<ViewportRenderer | null>();
  rendererRef.current = renderer as unknown as ViewportRenderer;
  const canvasRef = createRef<HTMLCanvasElement | null>();
  canvasRef.current = document.createElement('canvas');
  const { result } = renderHook(() => useViewportTouch({ rendererRef, canvasRef }));
  return { result, renderer };
}

describe('useViewportTouch', () => {
  it('records a pinch distance on a two-finger touch start', () => {
    const { result } = setup();
    act(() => {
      result.current.handleTouchStart(touchEvent([
        { id: 0, x: 0, y: 0 },
        { id: 1, x: 3, y: 4 },
      ]));
    });
    expect(result.current.touchStateRef.current.lastPinchDist).toBe(5);
  });

  it('pans on single-finger drag', () => {
    const { result, renderer } = setup();
    act(() => {
      result.current.handleTouchStart(touchEvent([{ id: 0, x: 10, y: 10 }]));
      result.current.handleTouchMove(touchEvent([{ id: 0, x: 20, y: 25 }]));
    });
    expect(renderer!.applyPan).toHaveBeenCalledOnce();
    const call = renderer!.applyPan.mock.calls[0]!;
    expect(call[1]).toEqual([10, 10]);
    expect(call[2]).toEqual([20, 25]);
  });

  it('zooms on a two-finger pinch as the distance changes', () => {
    const { result, renderer } = setup();
    act(() => {
      result.current.handleTouchStart(touchEvent([
        { id: 0, x: 0, y: 0 },
        { id: 1, x: 0, y: 10 },
      ]));
      result.current.handleTouchMove(touchEvent([
        { id: 0, x: 0, y: 0 },
        { id: 1, x: 0, y: 20 },
      ]));
    });
    // old distance 10, new distance 20 → factor 10/20 = 0.5
    expect(renderer!.applyZoomFactor).toHaveBeenCalledWith(0.5);
  });

  it('clears the pinch distance when fingers lift below two', () => {
    const { result } = setup();
    act(() => {
      result.current.handleTouchStart(touchEvent([
        { id: 0, x: 0, y: 0 },
        { id: 1, x: 0, y: 10 },
      ]));
      result.current.handleTouchEnd(touchEvent([{ id: 0, x: 0, y: 0 }]));
    });
    expect(result.current.touchStateRef.current.lastPinchDist).toBeNull();
  });

  it('does not throw on move when the renderer is unavailable', () => {
    const { result } = setup(null);
    expect(() =>
      act(() => {
        result.current.handleTouchMove(touchEvent([{ id: 0, x: 5, y: 5 }]));
      }),
    ).not.toThrow();
  });
});
