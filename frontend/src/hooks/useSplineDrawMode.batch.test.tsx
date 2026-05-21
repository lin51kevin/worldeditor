/**
 * Test: useSplineDrawMode exposes the expected handler API.
 */
import { renderHook } from '@testing-library/react';
import { useSplineDrawMode } from './useSplineDrawMode';

describe('useSplineDrawMode', () => {
  it('should expose all required handler functions', () => {
    const { result } = renderHook(() =>
      useSplineDrawMode({
        canvasRef: { current: null },
        rendererRef: { current: null },
        pendingCursorRef: { current: null },
        hoveredControlPointRef: { current: null },
        status: 'loading',
      })
    );

    expect(typeof result.current.handleSplineDrawMouseMove).toBe('function');
    expect(typeof result.current.handleSplineDrawMouseDown).toBe('function');
    expect(typeof result.current.handleSplineDrawClick).toBe('function');
    expect(typeof result.current.handleSplineDrawMouseUp).toBe('function');
    expect(typeof result.current.handleSplineDrawRightClick).toBe('function');
    expect(typeof result.current.clearSplineDrawHover).toBe('function');
  });

  it('should not throw when mousemove is called with null refs', () => {
    const { result } = renderHook(() =>
      useSplineDrawMode({
        canvasRef: { current: null },
        rendererRef: { current: null },
        pendingCursorRef: { current: null },
        hoveredControlPointRef: { current: null },
        status: 'loading',
      })
    );

    // With null canvas/renderer the handler should return false without throwing
    expect(() => {
      result.current.handleSplineDrawMouseMove(
        { x: 0, y: 0 },
        null as unknown as HTMLCanvasElement,
        null as unknown as import('../../viewport/renderer').ViewportRenderer,
      );
    }).not.toThrow();
  });
});
