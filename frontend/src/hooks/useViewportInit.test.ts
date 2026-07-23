import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { useViewportInit } from './useViewportInit';
import { ViewportRenderer } from '../viewport/renderer';

describe('useViewportInit', () => {
  it('does nothing when the canvas ref is null', () => {
    const canvasRef = createRef<HTMLCanvasElement | null>();
    const rendererRef = createRef<ViewportRenderer | null>();
    const setStatus = vi.fn();
    renderHook(() => useViewportInit(canvasRef, rendererRef, setStatus));
    expect(setStatus).not.toHaveBeenCalled();
    expect(rendererRef.current).toBeNull();
  });

  it('reports "unsupported" when WebGPU is unavailable (jsdom has no navigator.gpu)', () => {
    // Guard: the test environment must not expose WebGPU for this assertion.
    expect(ViewportRenderer.isSupported()).toBe(false);

    const canvas = document.createElement('canvas');
    const parent = document.createElement('div');
    parent.appendChild(canvas);
    document.body.appendChild(parent);

    const canvasRef = createRef<HTMLCanvasElement | null>();
    canvasRef.current = canvas;
    const rendererRef = createRef<ViewportRenderer | null>();
    const setStatus = vi.fn();

    renderHook(() => useViewportInit(canvasRef, rendererRef, setStatus));

    expect(setStatus).toHaveBeenCalledWith('unsupported');
    expect(rendererRef.current).toBeNull();
    document.body.removeChild(parent);
  });
});
