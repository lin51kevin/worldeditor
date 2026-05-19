import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAdjustEdgeMode } from './useAdjustEdgeMode';
import type { Lane, LaneSection, LaneWidth, Road } from '../services/platform';

// Mock stores
const mockViewportState = { editMode: null as string | null };
const mockProjectState = {
  selectedRoadId: null as string | null,
  project: { roads: [] as Road[] },
  updateLaneWidth: vi.fn(),
};

vi.mock('../stores/viewportStore', () => ({
  useViewportStore: { getState: () => mockViewportState },
}));
vi.mock('../stores/projectStore', () => ({
  useProjectStore: { getState: () => mockProjectState },
}));
vi.mock('../services', () => ({
  getPlatformService: vi.fn().mockResolvedValue({
    snapPointOnRoad: vi.fn(),
    generateSingleRoadVertices: vi.fn().mockResolvedValue(new Float32Array()),
  }),
}));
vi.mock('../viewport/cursorEvents', () => ({
  emitCursorMove: vi.fn(),
}));

// Helpers
function makeLaneWidth(a: number): LaneWidth {
  return { s_offset: 0, a, b: 0, c: 0, d: 0 };
}
function makeLane(id: number, widthA: number): Lane {
  return {
    id, lane_type: 'driving', level: 0,
    width: [makeLaneWidth(widthA)],
    road_marks: [], borders: [],
    link: { predecessor: null, successor: null },
  };
}
function makeLaneSection(leftLanes: Lane[], rightLanes: Lane[]): LaneSection {
  return {
    s: 0, single_side: false,
    left: leftLanes,
    center: [{ id: 0, lane_type: 'none', level: 0, width: [], road_marks: [], borders: [], link: { predecessor: null, successor: null } }],
    right: rightLanes,
  };
}
function makeRoad(id: string, sections: LaneSection[]): Road {
  return {
    id, name: '', length: 100, junction_id: null,
    link: { predecessor: null, successor: null },
    plan_view: [{ x: 0, y: 0, hdg: 0, s: 0, length: 0, geo_type: 'Line' }],
    elevation_profile: [], lane_sections: sections,
  };
}

function createHarness() {
  const rendererRef = { current: null as any };
  const canvasRef = { current: null as any };
  const isPreviewingRef = { current: false };
  const pendingCursorRef = { current: null as any };
  rendererRef.current = {
    lockCamera: vi.fn(), unlockCamera: vi.fn(),
    clearHighlight: vi.fn(), uploadHighlightVertices: vi.fn(),
    unprojectToGround: vi.fn().mockReturnValue({ x: 0, y: 0 }),
  };
  canvasRef.current = { getBoundingClientRect: () => ({ left: 0, top: 0 }), style: { cursor: '' } };

  const { result } = renderHook(() =>
    useAdjustEdgeMode(rendererRef, canvasRef, isPreviewingRef, pendingCursorRef),
  );
  return { ...result.current, rendererRef, canvasRef, isPreviewingRef, pendingCursorRef };
}

describe('useAdjustEdgeMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockViewportState.editMode = 'adjust-edge';
    mockProjectState.selectedRoadId = null;
    mockProjectState.project.roads = [];
  });

  // 1. editMode not adjust-edge → false
  it('startAdjustEdgeDrag returns false when editMode is not adjust-edge', async () => {
    mockViewportState.editMode = 'move-road';
    const h = createHarness();
    const result = await h.startAdjustEdgeDrag({ clientX: 0, clientY: 0 } as any);
    expect(result).toBe(false);
  });

  // 2. no selected road → false
  it('startAdjustEdgeDrag returns false when no road is selected', async () => {
    mockProjectState.selectedRoadId = null;
    const h = createHarness();
    const result = await h.startAdjustEdgeDrag({ clientX: 0, clientY: 0 } as any);
    expect(result).toBe(false);
  });

  // 3. correctly identifies left/right edge based on t sign
  it('identifies left edge when t > 0 and right edge when t < 0', async () => {
    const road = makeRoad('r1', [
      makeLaneSection([makeLane(-1, 3.5)], [makeLane(1, 3.5)]),
    ]);
    mockProjectState.selectedRoadId = 'r1';
    mockProjectState.project.roads = [road];

    const { getPlatformService } = await import('../services');
    const service = await (getPlatformService as any)();
    // Test left (t > 0)
    service.snapPointOnRoad.mockResolvedValueOnce({ s: 10, t: 2.0, hdg: 0 });
    const h1 = createHarness();
    const res1 = await h1.startAdjustEdgeDrag({ clientX: 10, clientY: 10 } as any);
    expect(res1).toBe(true);
    expect(h1.adjustEdgeDragRef.current?.side).toBe('left');

    // Test right (t < 0)
    service.snapPointOnRoad.mockResolvedValueOnce({ s: 10, t: -2.0, hdg: 0 });
    const h2 = createHarness();
    const res2 = await h2.startAdjustEdgeDrag({ clientX: 10, clientY: 10 } as any);
    expect(res2).toBe(true);
    expect(h2.adjustEdgeDragRef.current?.side).toBe('right');
  });

  // 4. updateAdjustEdgeDrag calculates width scaling correctly
  it('calculates scaled widths during update', async () => {
    const road = makeRoad('r1', [
      makeLaneSection([makeLane(1, 3.5)], [makeLane(-1, 3.5), makeLane(-2, 3.0)]),
    ]);
    mockProjectState.selectedRoadId = 'r1';
    mockProjectState.project.roads = [road];

    const { getPlatformService } = await import('../services');
    const service = await (getPlatformService as any)();
    service.snapPointOnRoad.mockResolvedValueOnce({ s: 10, t: -1.5, hdg: 0 });
    const h = createHarness();
    await h.startAdjustEdgeDrag({ clientX: 10, clientY: 10 } as any);

    // deltaT = -1.0: cursor moves from t=-1.5 to t=-2.5 (outward for right edge, expanding)
    // right side total = 3.5 + 3.0 = 6.5, outwardDelta = -(-1.0) = 1.0, newTotal = 7.5
    const widths = h.computeNewWidths(h.adjustEdgeDragRef.current!, -1.0);
    expect(widths.get(-1)).toBeCloseTo(3.5 * 7.5 / 6.5, 4);
    expect(widths.get(-2)).toBeCloseTo(3.0 * 7.5 / 6.5, 4);
  });

  // 5. commitAdjustEdgeDrag calls updateLaneWidth when changed
  it('commitAdjustEdgeDrag calls updateLaneWidth when widths changed', async () => {
    const road = makeRoad('r1', [
      makeLaneSection([makeLane(-1, 3.5)], [makeLane(1, 3.5)]),
    ]);
    mockProjectState.selectedRoadId = 'r1';
    mockProjectState.project.roads = [road];

    const { getPlatformService } = await import('../services');
    const service = await (getPlatformService as any)();
    service.snapPointOnRoad.mockResolvedValueOnce({ s: 10, t: 1.5, hdg: 0 });
    const h = createHarness();
    await h.startAdjustEdgeDrag({ clientX: 10, clientY: 10 } as any);

    // Set computed widths different from original
    h.adjustEdgeDragRef.current!.computedWidths = new Map([[-1, 4.0]]);

    const result = h.commitAdjustEdgeDrag();
    expect(result).toBe(true);
    expect(mockProjectState.updateLaneWidth).toHaveBeenCalled();
  });

  // 6. commitAdjustEdgeDrag does not call store when no change
  it('commitAdjustEdgeDrag does not call updateLaneWidth when no widths changed', async () => {
    const road = makeRoad('r1', [
      makeLaneSection([makeLane(-1, 3.5)], [makeLane(1, 3.5)]),
    ]);
    mockProjectState.selectedRoadId = 'r1';
    mockProjectState.project.roads = [road];

    const { getPlatformService } = await import('../services');
    const service = await (getPlatformService as any)();
    service.snapPointOnRoad.mockResolvedValueOnce({ s: 10, t: 1.5, hdg: 0 });
    const h = createHarness();
    await h.startAdjustEdgeDrag({ clientX: 10, clientY: 10 } as any);

    const result = h.commitAdjustEdgeDrag();
    expect(result).toBe(true);
    expect(mockProjectState.updateLaneWidth).not.toHaveBeenCalled();
  });
});
