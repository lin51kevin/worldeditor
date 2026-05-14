import { describe, it, expect } from 'vitest';
import { validateProject } from './validation';
import type { Project, Road, Junction } from '../services/platform';

function makeRoad(overrides: Partial<Road> & { id: string }): Road {
  return {
    name: overrides.id,
    length: overrides.length ?? 100,
    junction_id: null,
    link: null,
    plan_view: overrides.plan_view ?? [{ s: 0, x: 0, y: 0, hdg: 0, length: 100, geo_type: 'line' }] as any,
    elevation_profile: [],
    lane_sections: [],
    ...overrides,
  };
}

function makeJunction(id: string, connectionCount: number): Junction {
  const connections = Array.from({ length: connectionCount }, (_, i) => ({
    id: `${id}_conn${i}`,
    incoming_road: `road_${i}`,
    connecting_road: `road_${i + 10}`,
    linked_roads: [],
    from_lane: -1,
    to_lane: -1,
  } as any));
  return { id, name: id, connections };
}

function makeProject(roads: Road[] = [], junctions: Junction[] = []): Project {
  return {
    name: 'test',
    header: { name: 'test', rev_major: 1, rev_minor: 0, date: '', north: 0, south: 0, east: 0, west: 0, geo_reference: null },
    roads,
    junctions,
    signals: [],
    objects: [],
  };
}

describe('validateProject', () => {
  it('returns info for empty project', () => {
    const issues = validateProject(makeProject());
    expect(issues).toEqual([{ severity: 'info', message: 'Project has no roads' }]);
  });

  it('passes valid single road', () => {
    const issues = validateProject(makeProject([makeRoad({ id: 'r1' })]));
    expect(issues).toEqual([]);
  });

  it('detects road with no geometry', () => {
    const road = makeRoad({ id: 'r1', plan_view: [] });
    const issues = validateProject(makeProject([road]));
    expect(issues.some((i) => i.severity === 'error' && i.roadId === 'r1')).toBe(true);
  });

  it('detects invalid geometry length', () => {
    const road = makeRoad({ id: 'r1', plan_view: [{ s: 0, x: 0, y: 0, hdg: 0, length: -5, geo_type: 'line' }] as any });
    const issues = validateProject(makeProject([road]));
    expect(issues.some((i) => i.message.includes('invalid geometry length'))).toBe(true);
  });

  it('detects duplicate road IDs', () => {
    const issues = validateProject(makeProject([makeRoad({ id: 'dup' }), makeRoad({ id: 'dup' })]));
    expect(issues.some((i) => i.message.includes('Duplicate road IDs'))).toBe(true);
  });

  it('warns about junction with fewer than 2 connections', () => {
    const j = makeJunction('j1', 1);
    const issues = validateProject(makeProject([], [j]));
    expect(issues.some((i) => i.severity === 'warning' && i.junctionId === 'j1')).toBe(true);
  });

  it('passes junction with 2+ connections', () => {
    const j = makeJunction('j1', 2);
    const issues = validateProject(makeProject([makeRoad({ id: 'r1' })], [j]));
    expect(issues.some((i) => i.junctionId === 'j1')).toBe(false);
  });

  it('warns about invalid predecessor link', () => {
    const road = makeRoad({ id: 'r1', link: { predecessor: { element_id: 'nonexistent', element_type: 'Road', contact_point: 'Start' }, successor: null } });
    const issues = validateProject(makeProject([road]));
    expect(issues.some((i) => i.message.includes('predecessor'))).toBe(true);
  });

  it('warns about invalid successor link', () => {
    const road = makeRoad({ id: 'r1', link: { predecessor: null, successor: { element_id: 'nonexistent', element_type: 'Road', contact_point: 'End' } } });
    const issues = validateProject(makeProject([road]));
    expect(issues.some((i) => i.message.includes('successor'))).toBe(true);
  });

  it('passes valid predecessor link', () => {
    const r1 = makeRoad({ id: 'r1', link: { predecessor: { element_id: 'r2', element_type: 'Road', contact_point: 'Start' }, successor: null } });
    const r2 = makeRoad({ id: 'r2' });
    const issues = validateProject(makeProject([r1, r2]));
    expect(issues.some((i) => i.message.includes('predecessor'))).toBe(false);
  });
});
