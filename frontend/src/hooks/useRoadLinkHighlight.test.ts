import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { useRoadLinkHighlight } from './useRoadLinkHighlight';
import { useProjectStore } from '../stores/projectStore';
import { useViewportStore } from '../stores/viewportStore';
import type { Road } from '../services/platform';
import type { ViewportRenderer } from '../viewport/renderer';

interface MockRenderer {
  clearLinkHighlight: Mock;
  uploadLinkHighlightVertices: Mock;
}

function makeRoad(overrides: Partial<Road> = {}): Road {
  return {
    id: 'r1',
    name: 'Road 1',
    length: 100,
    junction_id: null,
    link: { predecessor: null, successor: null },
    plan_view: [{ s: 0, x: 0, y: 0, hdg: 0, length: 100, geo_type: 'Line' }],
    lane_sections: [],
    elevation_profile: [],
    ...overrides,
  };
}

function setup(renderer: MockRenderer, status: 'loading' | 'ready' | 'unsupported' = 'ready') {
  const rendererRef = createRef<ViewportRenderer | null>();
  rendererRef.current = renderer as unknown as ViewportRenderer;
  return renderHook(() => useRoadLinkHighlight({ rendererRef, status }));
}

describe('useRoadLinkHighlight', () => {
  let renderer: MockRenderer;

  beforeEach(() => {
    useProjectStore.getState().reset();
    useViewportStore.setState({ showRoadLinks: false });
    renderer = { clearLinkHighlight: vi.fn(), uploadLinkHighlightVertices: vi.fn() };
  });

  it('clears the link highlight when the toggle is off', () => {
    useProjectStore.getState().addRoad(makeRoad());
    useProjectStore.getState().selectRoad('r1');
    setup(renderer);
    expect(renderer.clearLinkHighlight).toHaveBeenCalled();
    expect(renderer.uploadLinkHighlightVertices).not.toHaveBeenCalled();
  });

  it('clears the link highlight when nothing is selected even if the toggle is on', () => {
    useViewportStore.setState({ showRoadLinks: true });
    setup(renderer);
    expect(renderer.clearLinkHighlight).toHaveBeenCalled();
    expect(renderer.uploadLinkHighlightVertices).not.toHaveBeenCalled();
  });

  it('does nothing while the renderer is not ready', () => {
    useProjectStore.getState().addRoad(makeRoad());
    useProjectStore.getState().selectRoad('r1');
    useViewportStore.setState({ showRoadLinks: true });
    setup(renderer, 'loading');
    expect(renderer.clearLinkHighlight).not.toHaveBeenCalled();
  });
});
