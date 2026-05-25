import { cleanupJunctionsForRemovedRoads } from './junctionEditing';
import type { Junction, Project, Road } from '../services/platform';

function makeRoad(id: string, overrides?: Partial<Road>): Road {
  return {
    id,
    name: id,
    length: 10,
    junction_id: null,
    link: { predecessor: null, successor: null },
    plan_view: [{ s: 0, x: 0, y: 0, hdg: 0, length: 10, geo_type: 'Line' }],
    elevation_profile: [],
    lane_sections: [],
    ...overrides,
  };
}

function makeJunction(id: string, connections: Junction['connections']): Junction {
  return {
    id,
    name: id,
    connections,
  };
}

describe('cleanupJunctionsForRemovedRoads', () => {
  it('removes junctions that only referenced removed welded roads', () => {
    const project: Project = {
      name: 'test',
      header: {
        rev_major: 1,
        rev_minor: 0,
        name: 'test',
        date: '2026-05-25',
        north: 0,
        south: 0,
        east: 0,
        west: 0,
        geo_reference: null,
      },
      roads: [
        makeRoad('r1'),
      ],
      junctions: [makeJunction('j1', [{ id: 'c1', incoming_road: 'r1', connecting_road: 'r2', contact_point: 'Start', lane_links: [] }])],
      signals: [],
      objects: [],
    };

    const cleaned = cleanupJunctionsForRemovedRoads(project, ['r1', 'r2']);

    expect(cleaned.junctions).toEqual([]);
    expect(cleaned.roads.find((road) => road.id === 'r1')?.junction_id).toBeNull();
  });

  it('keeps junctions that still have valid surviving connections', () => {
    const project: Project = {
      name: 'test',
      header: {
        rev_major: 1,
        rev_minor: 0,
        name: 'test',
        date: '2026-05-25',
        north: 0,
        south: 0,
        east: 0,
        west: 0,
        geo_reference: null,
      },
      roads: [makeRoad('r1'), makeRoad('r3'), makeRoad('r4')],
      junctions: [makeJunction('j1', [
        { id: 'c1', incoming_road: 'r1', connecting_road: 'r2', contact_point: 'Start', lane_links: [] },
        { id: 'c2', incoming_road: 'r3', connecting_road: 'r4', contact_point: 'Start', lane_links: [] },
      ])],
      signals: [],
      objects: [],
    };

    const cleaned = cleanupJunctionsForRemovedRoads(project, ['r1', 'r2']);

    expect(cleaned.junctions).toHaveLength(1);
    expect(cleaned.junctions[0]?.connections).toEqual([
      { id: 'c2', incoming_road: 'r3', connecting_road: 'r4', contact_point: 'Start', lane_links: [] },
    ]);
  });

  it('preserves connections that now point at the welded surviving road id', () => {
    const project: Project = {
      name: 'test',
      header: {
        rev_major: 1,
        rev_minor: 0,
        name: 'test',
        date: '2026-05-25',
        north: 0,
        south: 0,
        east: 0,
        west: 0,
        geo_reference: null,
      },
      roads: [makeRoad('r1'), makeRoad('r3')],
      junctions: [makeJunction('j1', [
        { id: 'c1', incoming_road: 'r1', connecting_road: 'r3', contact_point: 'Start', lane_links: [] },
      ])],
      signals: [],
      objects: [],
    };

    const cleaned = cleanupJunctionsForRemovedRoads(project, ['r1', 'r2']);

    expect(cleaned.junctions).toHaveLength(1);
    expect(cleaned.junctions[0]?.connections).toEqual([
      { id: 'c1', incoming_road: 'r1', connecting_road: 'r3', contact_point: 'Start', lane_links: [] },
    ]);
  });
});