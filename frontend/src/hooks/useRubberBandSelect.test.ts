import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { useRubberBandSelect } from './useRubberBandSelect';
import { useProjectStore } from '../stores/projectStore';
import type { Road } from '../services/platform';
import type { ViewportRenderer } from '../viewport/renderer';

interface MockRenderer {
  lockCamera: Mock;
  unlockCamera: Mock;
  unprojectToGround: Mock;
}

function makeRenderer(): MockRenderer {
  return {
    lockCamera: vi.fn(),
    unlockCamera: vi.fn(),
    // Map the drag's min corner (10,10) → (-1000,-1000) and max corner
    // (60,60) → (1000,1000) so the resulting AABB captures a road at origin.
    unprojectToGround: vi.fn((sx: number, sy: number) => ({
      x: sx < 35 ? -1000 : 1000,
      y: sy < 35 ? -1000 : 1000,
    })),
  };
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

function mouseEvent(clientX: number, clientY: number): React.MouseEvent {
  return { clientX, clientY } as unknown as React.MouseEvent;
}

function setup(renderer: MockRenderer) {
  const rendererRef = createRef<ViewportRenderer | null>();
  rendererRef.current = renderer as unknown as ViewportRenderer;
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
  const canvasRef = createRef<HTMLCanvasElement | null>();
  canvasRef.current = canvas;
  const { result } = renderHook(() => useRubberBandSelect(rendererRef, canvasRef));
  return { result, canvas };
}

describe('useRubberBandSelect', () => {
  beforeEach(() => {
    useProjectStore.getState().reset();
  });

  it('starts a drag and locks the camera', () => {
    const renderer = makeRenderer();
    const { result } = setup(renderer);
    const started = result.current.startRubberBand(
      mouseEvent(10, 10),
      renderer as unknown as ViewportRenderer,
    );
    expect(started).toBe(true);
    expect(renderer.lockCamera).toHaveBeenCalledOnce();
    expect(result.current.rubberBandRef.current).toMatchObject({
      startClientX: 10,
      startClientY: 10,
      active: false,
    });
  });

  it('does not activate below the drag threshold', () => {
    const renderer = makeRenderer();
    const { result, canvas } = setup(renderer);
    result.current.startRubberBand(mouseEvent(10, 10), renderer as unknown as ViewportRenderer);
    result.current.updateRubberBand(mouseEvent(11, 11), canvas);
    expect(result.current.rubberBandRef.current?.active).toBe(false);
  });

  it('activates once dragged past the threshold', () => {
    const renderer = makeRenderer();
    const { result, canvas } = setup(renderer);
    result.current.startRubberBand(mouseEvent(10, 10), renderer as unknown as ViewportRenderer);
    result.current.updateRubberBand(mouseEvent(60, 60), canvas);
    expect(result.current.rubberBandRef.current?.active).toBe(true);
  });

  it('selects roads within the box on commit and unlocks the camera', () => {
    const renderer = makeRenderer();
    const { result, canvas } = setup(renderer);
    useProjectStore.getState().addRoad(makeRoad());

    result.current.startRubberBand(mouseEvent(10, 10), renderer as unknown as ViewportRenderer);
    result.current.updateRubberBand(mouseEvent(60, 60), canvas);
    const handled = result.current.commitRubberBand(mouseEvent(60, 60));

    expect(handled).toBe(true);
    expect(renderer.unlockCamera).toHaveBeenCalledOnce();
    expect(useProjectStore.getState().selectedRoadIds).toEqual(['r1']);
    expect(result.current.rubberBandRef.current).toBeNull();
  });

  it('returns false from update/commit when no drag is in progress', () => {
    const renderer = makeRenderer();
    const { result, canvas } = setup(renderer);
    expect(result.current.updateRubberBand(mouseEvent(5, 5), canvas)).toBe(false);
    expect(result.current.commitRubberBand(mouseEvent(5, 5))).toBe(false);
  });
});
