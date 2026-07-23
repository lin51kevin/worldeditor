import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { useObjectDrawOverlay } from './useObjectDrawOverlay';
import { useViewportStore } from '../stores/viewportStore';
import type { ViewportRenderer } from '../viewport/renderer';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function mountCanvas() {
  const parent = document.createElement('div');
  const canvas = document.createElement('canvas');
  parent.appendChild(canvas);
  document.body.appendChild(parent);
  return { parent, canvas };
}

describe('useObjectDrawOverlay', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    // jsdom has no 2D canvas context; returning null makes the draw path bail cleanly.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    useViewportStore.setState({
      objectDrawVertices: [],
      objectDrawRoadId: null,
      objectDrawTemplateId: null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('attaches an overlay canvas to the parent when ready', () => {
    const { parent, canvas } = mountCanvas();
    const rendererRef = createRef<ViewportRenderer | null>();
    rendererRef.current = {} as ViewportRenderer;
    const canvasRef = createRef<HTMLCanvasElement | null>();
    canvasRef.current = canvas;

    renderHook(() => useObjectDrawOverlay({ rendererRef, canvasRef, status: 'ready' }));

    expect(parent.querySelectorAll('canvas')).toHaveLength(2);
  });

  it('does not attach an overlay while status is not ready', () => {
    const { parent, canvas } = mountCanvas();
    const rendererRef = createRef<ViewportRenderer | null>();
    const canvasRef = createRef<HTMLCanvasElement | null>();
    canvasRef.current = canvas;

    renderHook(() => useObjectDrawOverlay({ rendererRef, canvasRef, status: 'loading' }));

    expect(parent.querySelectorAll('canvas')).toHaveLength(1);
  });
});
