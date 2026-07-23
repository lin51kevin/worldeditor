import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { useSplineDrawPreview } from './useSplineDrawPreview';
import { useViewportStore } from '../stores/viewportStore';
import type { ViewportRenderer } from '../viewport/renderer';

interface MockRenderer {
  uploadLaneLineVertices: Mock;
}

function setup(status: 'loading' | 'ready' | 'unsupported', renderer: MockRenderer | null) {
  const rendererRef = createRef<ViewportRenderer | null>();
  rendererRef.current = renderer as unknown as ViewportRenderer;
  const onPreviewEnd = vi.fn();
  const getCachedLineVertices = vi.fn(() => new Float32Array());
  renderHook(() =>
    useSplineDrawPreview({ rendererRef, status, onPreviewEnd, getCachedLineVertices }),
  );
  return { onPreviewEnd, getCachedLineVertices };
}

describe('useSplineDrawPreview', () => {
  beforeEach(() => {
    useViewportStore.setState({
      editMode: 'default',
      splineKnots: [],
      splineTemplateId: 'tpl:road:single',
      cursorPreviewPos: null,
    });
  });

  it('does not upload a preview when not in a draw mode', () => {
    const renderer = { uploadLaneLineVertices: vi.fn() };
    setup('ready', renderer);
    expect(renderer.uploadLaneLineVertices).not.toHaveBeenCalled();
  });

  it('does not upload a preview while the renderer is not ready', () => {
    const renderer = { uploadLaneLineVertices: vi.fn() };
    useViewportStore.setState({ editMode: 'spline', splineKnots: [[0, 0, 0], [10, 0, 0]] });
    setup('loading', renderer);
    expect(renderer.uploadLaneLineVertices).not.toHaveBeenCalled();
  });

  it('does not throw when the renderer ref is null', () => {
    useViewportStore.setState({ editMode: 'spline', splineKnots: [[0, 0, 0], [10, 0, 0]] });
    expect(() => setup('ready', null)).not.toThrow();
  });
});
