import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Road, LaneSection } from '../../../../services/platform';
import type { EditorState } from '../../../../stores/slices/types';
function makeLane(id: number, lane_type = 'driving', width = 3.5) {
  return { id, lane_type, width: [{ s_offset: 0, a: width, b: 0, c: 0, d: 0 }] } as any;
}

function makeLaneSection(leftLanes: any[] = [], rightLanes: any[] = []): LaneSection {
  return { s: 0, single_side: false, left: leftLanes, center: [], right: rightLanes };
}

function makeRoad(id: string, name: string, length: number, laneSections: LaneSection[] = []): Road {
  return { id, name, length, junction_id: null, link: { predecessor: null, successor: null }, plan_view: [], elevation_profile: [], lane_sections: laneSections };
}

const defaultProject = { name: 'test', header: {} as any, roads: [] as Road[], junctions: [] as any[], signals: [], objects: [] };

let mockState: Partial<EditorState>;

vi.mock('../../../../stores/projectStore', () => ({
  useProjectStore: { getState: () => mockState },
}));

describe('context-assembler', () => {
  beforeEach(() => {
    mockState = {
      project: defaultProject,
      selectedRoadId: null, selectedJunctionId: null, selectedRoadIds: [], selectedJunctionIds: [],
    };
  });

  it('empty project returns zero counts', async () => {
    const { assembleContext } = await import('./context-assembler');
    const ctx = assembleContext();
    expect(ctx.roadCount).toBe(0);
    expect(ctx.junctionCount).toBe(0);
    expect(ctx.selectedElements).toEqual([]);
    expect(ctx.roadsSummary).toEqual([]);
  });

  it('prompt for empty project contains 道路数量：0', async () => {
    const { assembleContext, contextToPrompt } = await import('./context-assembler');
    const prompt = contextToPrompt(assembleContext());
    expect(prompt).toContain('道路数量：0');
    expect(prompt).toContain('路口数量：0');
    expect(prompt).toContain('选中元素：无');
  });

  it('roads without selection', async () => {
    const roads = [makeRoad('R1', 'Road 1', 100), makeRoad('R2', 'Road 2', 200)];
    mockState.project = { ...defaultProject, roads, junctions: [] };
    const { assembleContext } = await import('./context-assembler');
    const ctx = assembleContext();
    expect(ctx.roadCount).toBe(2);
    expect(ctx.selectedElements).toEqual([]);
    expect(ctx.roadsSummary).toEqual([
      { id: 'R1', name: 'Road 1', length: 100, laneCount: 0 },
      { id: 'R2', name: 'Road 2', length: 200, laneCount: 0 },
    ]);
  });

  it('selected road includes lane detail', async () => {
    const lanes = makeLaneSection([makeLane(1), makeLane(2, 'biking', 2.0)], [makeLane(-1), makeLane(-2)]);
    const roads = [makeRoad('R1', 'Main Rd', 200, [lanes])];
    mockState.project = { ...defaultProject, roads, junctions: [] };
    mockState.selectedRoadId = 'R1';
    const { assembleContext } = await import('./context-assembler');
    const ctx = assembleContext();
    expect(ctx.selectedElements).toEqual(['R1']);
    expect(ctx.selectedRoadDetail).toBeDefined();
    expect(ctx.selectedRoadDetail!.leftLanes).toEqual([
      { id: 1, type: 'driving', width: 3.5 },
      { id: 2, type: 'biking', width: 2.0 },
    ]);
    expect(ctx.selectedRoadDetail!.rightLanes).toEqual([
      { id: -1, type: 'driving', width: 3.5 },
      { id: -2, type: 'driving', width: 3.5 },
    ]);
  });

  it('selected junction appears in selectedElements', async () => {
    mockState.project = { ...defaultProject, roads: [], junctions: [{ id: 'J1', name: 'J1', connections: [] }] };
    mockState.selectedJunctionId = 'J1';
    const { assembleContext } = await import('./context-assembler');
    const ctx = assembleContext();
    expect(ctx.selectedElements).toEqual(['J1']);
  });

  it('large project returns all roads', async () => {
    const roads = Array.from({ length: 15 }, (_, i) => makeRoad(`R${i}`, `Road ${i}`, (i + 1) * 100));
    mockState.project = { ...defaultProject, roads, junctions: [] };
    const { assembleContext, contextToPrompt } = await import('./context-assembler');
    const ctx = assembleContext();
    expect(ctx.roadCount).toBe(15);
    const prompt = contextToPrompt(ctx);
    expect(prompt).toContain('道路数量：15');
  });

  it('prompt format contains available operations', async () => {
    const { assembleContext, contextToPrompt } = await import('./context-assembler');
    const prompt = contextToPrompt(assembleContext());
    expect(prompt).toContain('可用操作：addRoad, removeRoad, splitRoad');
  });
});
