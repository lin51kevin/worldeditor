import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { useSelectionHighlight } from './useSelectionHighlight';
import { useProjectStore } from '../stores/projectStore';
import type { ViewportRenderer } from '../viewport/renderer';

vi.mock('../services', () => ({
  getPlatformService: vi.fn().mockResolvedValue({
    generateRoadVertices: vi.fn().mockResolvedValue(new Float32Array()),
  }),
}));

interface MockRenderer {
  uploadHighlightVertices: Mock;
  clearHighlight: Mock;
}

function setup(renderer: MockRenderer, status: 'loading' | 'ready' | 'unsupported' = 'ready') {
  const rendererRef = createRef<ViewportRenderer | null>();
  rendererRef.current = renderer as unknown as ViewportRenderer;
  return renderHook(() => useSelectionHighlight({ rendererRef, status }));
}

describe('useSelectionHighlight', () => {
  let renderer: MockRenderer;

  beforeEach(() => {
    useProjectStore.getState().reset();
    renderer = { uploadHighlightVertices: vi.fn(), clearHighlight: vi.fn() };
  });

  it('clears the highlight when nothing is selected', async () => {
    setup(renderer);
    await waitFor(() => expect(renderer.clearHighlight).toHaveBeenCalled());
    expect(renderer.uploadHighlightVertices).not.toHaveBeenCalled();
  });

  it('does nothing while the renderer is not ready', () => {
    setup(renderer, 'loading');
    expect(renderer.clearHighlight).not.toHaveBeenCalled();
    expect(renderer.uploadHighlightVertices).not.toHaveBeenCalled();
  });

  it('does not throw when the renderer ref is null', () => {
    const rendererRef = createRef<ViewportRenderer | null>();
    expect(() =>
      renderHook(() => useSelectionHighlight({ rendererRef, status: 'ready' })),
    ).not.toThrow();
  });
});
