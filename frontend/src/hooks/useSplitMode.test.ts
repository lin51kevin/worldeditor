import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { useSplitMode } from './useSplitMode';
import { useProjectStore } from '../stores/projectStore';
import { useViewportStore } from '../stores/viewportStore';
import type { Road } from '../services/platform';
import type { ViewportRenderer } from '../viewport/renderer';

const showAlertMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../utils/dialog', () => ({
  showAlert: (...args: unknown[]) => showAlertMock(...args),
}));

interface MockRenderer {
  projectWorldToScreen: Mock;
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

function setup() {
  const renderer: MockRenderer = { projectWorldToScreen: vi.fn(() => null) };
  const rendererRef = createRef<ViewportRenderer | null>();
  rendererRef.current = renderer as unknown as ViewportRenderer;
  const canvas = document.createElement('canvas');
  const canvasRef = createRef<HTMLCanvasElement | null>();
  canvasRef.current = canvas;
  const pendingCursorRef = { current: null as { x: number; y: number } | null };
  const splitIndicatorDomRef = { current: null as HTMLDivElement | null };
  const { result } = renderHook(() =>
    useSplitMode({ canvasRef, rendererRef, pendingCursorRef, splitIndicatorDomRef }),
  );
  return { result };
}

describe('useSplitMode', () => {
  beforeEach(() => {
    showAlertMock.mockClear();
    useProjectStore.getState().reset();
    useViewportStore.setState({ editMode: 'default' });
  });

  it('ignores mouse move when not in split mode', () => {
    const { result } = setup();
    const handled = result.current.handleSplitModeMouseMove({ x: 50, y: 0 });
    expect(handled).toBe(false);
  });

  it('ignores clicks when no road is selected', async () => {
    const { result } = setup();
    useViewportStore.setState({ editMode: 'split' });
    const handled = await result.current.handleSplitModeClick({ x: 50, y: 0 });
    expect(handled).toBe(false);
  });

  it('warns and does not split when the split point is too close to an end', async () => {
    const { result } = setup();
    useProjectStore.getState().addRoad(makeRoad());
    useProjectStore.getState().selectRoad('r1');
    useViewportStore.setState({ editMode: 'split' });

    const handled = await result.current.handleSplitModeClick({ x: 0, y: 0 });

    expect(handled).toBe(true);
    expect(showAlertMock).toHaveBeenCalledOnce();
    expect(useProjectStore.getState().project.roads).toHaveLength(1);
  });

  it('splits the road into two and adds a junction on a valid click', async () => {
    const { result } = setup();
    useProjectStore.getState().addRoad(makeRoad());
    useProjectStore.getState().selectRoad('r1');
    useViewportStore.setState({ editMode: 'split' });

    const handled = await result.current.handleSplitModeClick({ x: 50, y: 0 });

    expect(handled).toBe(true);
    expect(showAlertMock).not.toHaveBeenCalled();
    const state = useProjectStore.getState();
    expect(state.project.roads).toHaveLength(2);
    expect(state.project.junctions.length).toBeGreaterThanOrEqual(1);
    // Split leaves the editor in default mode with the first segment selected.
    expect(useViewportStore.getState().editMode).toBe('default');
  });
});
