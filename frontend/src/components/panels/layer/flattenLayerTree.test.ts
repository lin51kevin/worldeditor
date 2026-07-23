import { describe, it, expect } from 'vitest';
import { flattenLayerTree } from './flattenLayerTree';
import type { Road, Junction } from '../../../services/platform';

function makeRoad(id: string, overrides?: Partial<Road>): Road {
  return {
    id,
    name: '',
    length: 100,
    junction_id: null,
    lane_sections: [
      {
        s: 0,
        left: [{ id: 1, lane_type: 'driving', width_records: [], speed_records: [], road_marks: [] }],
        right: [{ id: -1, lane_type: 'driving', width_records: [], speed_records: [], road_marks: [] }],
        center: [],
      },
    ],
    plan_view: [],
    elevation_profile: [],
    lateral_profile: undefined,
    signals: [],
    objects: [],
    ...overrides,
  } as unknown as Road;
}

function makeJunction(id: string): Junction {
  return { id, name: '', connections: [] } as unknown as Junction;
}

describe('flattenLayerTree', () => {
  it('lists top-level roads and junctions when nothing is expanded', () => {
    const roads = [makeRoad('R1'), makeRoad('R2')];
    const junctions = [makeJunction('J1')];
    const items = flattenLayerTree(roads, junctions, new Set(), new Set(), new Set(), new Set());
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ type: 'road', roadId: 'R1' });
    expect(items[1]).toMatchObject({ type: 'road', roadId: 'R2' });
    expect(items[2]).toMatchObject({ type: 'junction', junctionId: 'J1' });
  });

  it('expands lane sections when road is expanded', () => {
    const roads = [makeRoad('R1')];
    const items = flattenLayerTree(roads, [], new Set(['R1']), new Set(), new Set(), new Set());
    const sections = items.filter((i) => i.type === 'laneSection');
    expect(sections.length).toBe(1);
  });

  it('expands lanes when lane section is expanded', () => {
    const roads = [makeRoad('R1')];
    const items = flattenLayerTree(roads, [], new Set(['R1']), new Set(['R1::section::0']), new Set(), new Set());
    const lanes = items.filter((i) => i.type === 'lane');
    expect(lanes.length).toBe(2); // one left + one right
  });

  it('shows signal group and signals when expanded', () => {
    const road = makeRoad('R1', {
      signals: [
        { id: 'S1', name: 'Signal 1', signal_type: '1000001', signal_subtype: '-1', s: 0, t: 0, value: '', dynamic: false, orientation: '+' },
      ],
    } as any);
    const items = flattenLayerTree([road], [], new Set(['R1']), new Set(), new Set(['R1']), new Set());
    const sigGroup = items.filter((i) => i.type === 'signalGroup');
    const signals = items.filter((i) => i.type === 'signal');
    expect(sigGroup.length).toBe(1);
    expect(signals.length).toBe(1);
  });

  it('shows object group and objects when expanded', () => {
    const road = makeRoad('R1', {
      objects: [
        { id: 'O1', name: 'Guardrail', object_type: 'Guardrail', position: { x: 0, y: 0, z: 0 }, corners: [], hdg: 0, orientation: 0, validity: null },
      ],
    } as any);
    const items = flattenLayerTree([road], [], new Set(['R1']), new Set(), new Set(), new Set(['R1']));
    const objGroup = items.filter((i) => i.type === 'objectGroup');
    const objects = items.filter((i) => i.type === 'object');
    expect(objGroup.length).toBe(1);
    expect(objects.length).toBe(1);
  });

  it('filters signals by search query', () => {
    const road = makeRoad('R1', {
      signals: [
        { id: 'S1', name: 'Stop Sign', signal_type: '206', signal_subtype: '-1', s: 0, t: 0, value: '', dynamic: false, orientation: '+' },
        { id: 'S2', name: 'Speed Limit', signal_type: '274', signal_subtype: '50', s: 0, t: 0, value: '50', dynamic: false, orientation: '+' },
      ],
    } as any);
    const items = flattenLayerTree([road], [], new Set(['R1']), new Set(), new Set(['R1']), new Set(), 'stop');
    const signals = items.filter((i) => i.type === 'signal');
    expect(signals.length).toBe(1);
  });

  it('filters objects by search query', () => {
    const road = makeRoad('R1', {
      objects: [
        { id: 'O1', name: 'Guardrail', object_type: 'Guardrail', position: { x: 0, y: 0, z: 0 }, corners: [], hdg: 0, orientation: 0, validity: null },
        { id: 'O2', name: 'Tree', object_type: { Custom: 'Tree' }, position: { x: 10, y: 0, z: 0 }, corners: [], hdg: 0, orientation: 0, validity: null },
      ],
    } as any);
    const items = flattenLayerTree([road], [], new Set(['R1']), new Set(), new Set(), new Set(['R1']), 'tree');
    const objects = items.filter((i) => i.type === 'object');
    expect(objects.length).toBe(1);
  });
});
