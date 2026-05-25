import {
  cleanupJunctionsForRemovedRoads,
  isRoadLinkedToJunction,
  getRoadJunctionContactPoint,
  getJunctionIncomingRoads,
  getJunctionOutgoingRoads,
  getJunctionConnectingRoads,
  getConnectionOutgoingRoadId,
  computeJunctionCenter,
  chooseRoadConnectionContactPoint,
  createConnectorRoadId,
  createJunctionConnectionId,
  buildConnectorRoad,
  attachRoadToJunction,
  addJunctionConnectionToProject,
  removeJunctionConnectionFromProject,
  addConnectionBetweenRoads,
  detachRoadFromJunction,
  fillJunctionConnectionGaps,
} from './junctionEditing';
import type { Junction, JunctionConnection, Project, Road } from '../services/platform';

function makeRoad(id: string, overrides?: Partial<Road>): Road {
  return {
    id,
    name: id,
    length: 10,
    junction_id: null,
    link: { predecessor: null, successor: null },
    plan_view: [{ s: 0, x: 0, y: 0, hdg: 0, length: 10, geo_type: 'Line' }],
    elevation_profile: [],
    lane_sections: [{
      s: 0,
      single_side: false,
      left: [],
      center: [{ id: 0, lane_type: 'none', level: 0, link: null, width: [], road_marks: [] }],
      right: [{ id: -1, lane_type: 'Driving', level: 0, link: null, width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }], road_marks: [] }],
    }],
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

  it('returns project unchanged if no roads removed', () => {
    const project = makeProject([makeRoad('r1')], [makeJunction('j1', [{ id: 'c1', incoming_road: 'r1', connecting_road: 'r1', contact_point: 'Start', lane_links: [] }])]);
    const result = cleanupJunctionsForRemovedRoads(project, []);
    expect(result).toBe(project);
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeProject(roads: Road[], junctions: Junction[] = []): Project {
  return {
    name: 'test',
    header: { rev_major: 1, rev_minor: 0, name: 'test', date: '', north: 0, south: 0, east: 0, west: 0, geo_reference: null },
    roads,
    junctions,
    signals: [],
    objects: [],
  };
}

// ─── isRoadLinkedToJunction ───────────────────────────────────────────────────

describe('isRoadLinkedToJunction', () => {
  it('returns true if predecessor links to junction', () => {
    const road = makeRoad('r1', {
      link: { predecessor: { element_id: 'j1', element_type: 'Junction', contact_point: 'Start' }, successor: null },
    });
    expect(isRoadLinkedToJunction(road, 'j1')).toBe(true);
  });

  it('returns true if successor links to junction', () => {
    const road = makeRoad('r1', {
      link: { predecessor: null, successor: { element_id: 'j1', element_type: 'Junction', contact_point: 'End' } },
    });
    expect(isRoadLinkedToJunction(road, 'j1')).toBe(true);
  });

  it('returns false if no link to junction', () => {
    const road = makeRoad('r1');
    expect(isRoadLinkedToJunction(road, 'j1')).toBe(false);
  });

  it('returns false if linked to a different junction', () => {
    const road = makeRoad('r1', {
      link: { predecessor: { element_id: 'j2', element_type: 'Junction', contact_point: 'Start' }, successor: null },
    });
    expect(isRoadLinkedToJunction(road, 'j1')).toBe(false);
  });
});

// ─── getRoadJunctionContactPoint ──────────────────────────────────────────────

describe('getRoadJunctionContactPoint', () => {
  it('returns Start when predecessor links to junction', () => {
    const road = makeRoad('r1', {
      link: { predecessor: { element_id: 'j1', element_type: 'Junction', contact_point: 'Start' }, successor: null },
    });
    expect(getRoadJunctionContactPoint(road, 'j1')).toBe('Start');
  });

  it('returns End when successor links to junction', () => {
    const road = makeRoad('r1', {
      link: { predecessor: null, successor: { element_id: 'j1', element_type: 'Junction', contact_point: 'End' } },
    });
    expect(getRoadJunctionContactPoint(road, 'j1')).toBe('End');
  });

  it('returns null when not linked', () => {
    const road = makeRoad('r1');
    expect(getRoadJunctionContactPoint(road, 'j1')).toBeNull();
  });
});

// ─── getJunctionIncomingRoads ─────────────────────────────────────────────────

describe('getJunctionIncomingRoads', () => {
  it('returns roads referenced as incoming in connections', () => {
    const project = makeProject(
      [makeRoad('r1'), makeRoad('r2'), makeRoad('connector', { junction_id: 'j1' })],
      [makeJunction('j1', [{ id: 'c1', incoming_road: 'r1', connecting_road: 'connector', contact_point: 'Start', lane_links: [] }])],
    );
    const incoming = getJunctionIncomingRoads(project, 'j1');
    expect(incoming.map((r) => r.id)).toContain('r1');
    expect(incoming.map((r) => r.id)).not.toContain('connector');
  });

  it('includes roads whose successor points to the junction', () => {
    const road = makeRoad('r3', {
      link: { predecessor: null, successor: { element_id: 'j1', element_type: 'Junction', contact_point: 'End' } },
    });
    const project = makeProject([road], [makeJunction('j1', [])]);
    const incoming = getJunctionIncomingRoads(project, 'j1');
    expect(incoming.map((r) => r.id)).toContain('r3');
  });
});

// ─── getJunctionOutgoingRoads ─────────────────────────────────────────────────

describe('getJunctionOutgoingRoads', () => {
  it('returns roads whose predecessor points to the junction', () => {
    const road = makeRoad('r2', {
      link: { predecessor: { element_id: 'j1', element_type: 'Junction', contact_point: 'Start' }, successor: null },
    });
    const project = makeProject([road], [makeJunction('j1', [])]);
    const outgoing = getJunctionOutgoingRoads(project, 'j1');
    expect(outgoing.map((r) => r.id)).toContain('r2');
  });
});

// ─── getJunctionConnectingRoads ───────────────────────────────────────────────

describe('getJunctionConnectingRoads', () => {
  it('returns roads with junction_id matching', () => {
    const connector = makeRoad('conn', { junction_id: 'j1' });
    const project = makeProject(
      [makeRoad('r1'), connector],
      [makeJunction('j1', [{ id: 'c1', incoming_road: 'r1', connecting_road: 'conn', contact_point: 'Start', lane_links: [] }])],
    );
    const connecting = getJunctionConnectingRoads(project, 'j1');
    expect(connecting.map((r) => r.id)).toContain('conn');
    expect(connecting.map((r) => r.id)).not.toContain('r1');
  });
});

// ─── getConnectionOutgoingRoadId ──────────────────────────────────────────────

describe('getConnectionOutgoingRoadId', () => {
  it('returns the road linked to the connector that is not the incoming road', () => {
    const connector = makeRoad('conn', {
      link: {
        predecessor: { element_id: 'r1', element_type: 'Road', contact_point: 'End' },
        successor: { element_id: 'r2', element_type: 'Road', contact_point: 'Start' },
      },
    });
    const conn: JunctionConnection = { id: 'c1', incoming_road: 'r1', connecting_road: 'conn', contact_point: 'Start', lane_links: [] };
    const project = makeProject([makeRoad('r1'), makeRoad('r2'), connector]);
    expect(getConnectionOutgoingRoadId(project, conn)).toBe('r2');
  });

  it('returns null when connecting road has no links', () => {
    const connector = makeRoad('conn', { link: null });
    const conn: JunctionConnection = { id: 'c1', incoming_road: 'r1', connecting_road: 'conn', contact_point: 'Start', lane_links: [] };
    const project = makeProject([makeRoad('r1'), connector]);
    expect(getConnectionOutgoingRoadId(project, conn)).toBeNull();
  });
});

// ─── computeJunctionCenter ────────────────────────────────────────────────────

describe('computeJunctionCenter', () => {
  it('returns centroid of road contact points', () => {
    const r1 = makeRoad('r1', {
      plan_view: [{ s: 0, x: 0, y: 0, hdg: 0, length: 10, geo_type: 'Line' }],
      link: { predecessor: null, successor: { element_id: 'j1', element_type: 'Junction', contact_point: 'End' } },
    });
    const r2 = makeRoad('r2', {
      plan_view: [{ s: 0, x: 20, y: 0, hdg: Math.PI, length: 10, geo_type: 'Line' }],
      link: { predecessor: { element_id: 'j1', element_type: 'Junction', contact_point: 'Start' }, successor: null },
    });
    const project = makeProject([r1, r2], [makeJunction('j1', [])]);
    const center = computeJunctionCenter(project, 'j1');
    expect(center).not.toBeNull();
    // r1 end at x=10, y=0; r2 start at x=20, y=0 → centroid = (15, 0)
    expect(center!.x).toBeCloseTo(15, 0);
    expect(center!.y).toBeCloseTo(0, 0);
  });

  it('returns null for junction with no linked roads', () => {
    const project = makeProject([makeRoad('r1')], [makeJunction('j1', [])]);
    expect(computeJunctionCenter(project, 'j1')).toBeNull();
  });
});

// ─── chooseRoadConnectionContactPoint ─────────────────────────────────────────

describe('chooseRoadConnectionContactPoint', () => {
  it('chooses Start when start is closer to junction center', () => {
    const r1 = makeRoad('r1', {
      plan_view: [{ s: 0, x: 100, y: 0, hdg: 0, length: 10, geo_type: 'Line' }],
      link: { predecessor: null, successor: { element_id: 'j1', element_type: 'Junction', contact_point: 'End' } },
    });
    // Target road starts at (105, 0) — close to junction, ends at (205,0) — far
    const target = makeRoad('target', {
      plan_view: [{ s: 0, x: 105, y: 0, hdg: 0, length: 100, geo_type: 'Line' }],
    });
    const project = makeProject([r1, target], [makeJunction('j1', [])]);
    expect(chooseRoadConnectionContactPoint(project, 'j1', target)).toBe('Start');
  });

  it('chooses End when end is closer to junction center', () => {
    const r1 = makeRoad('r1', {
      plan_view: [{ s: 0, x: 100, y: 0, hdg: 0, length: 10, geo_type: 'Line' }],
      link: { predecessor: null, successor: { element_id: 'j1', element_type: 'Junction', contact_point: 'End' } },
    });
    // Target road starts far (0,0) and ends at (110, 0) — close to junction center
    const target = makeRoad('target', {
      plan_view: [{ s: 0, x: 0, y: 0, hdg: 0, length: 110, geo_type: 'Line' }],
    });
    const project = makeProject([r1, target], [makeJunction('j1', [])]);
    expect(chooseRoadConnectionContactPoint(project, 'j1', target)).toBe('End');
  });
});

// ─── createConnectorRoadId / createJunctionConnectionId ───────────────────────

describe('createConnectorRoadId', () => {
  it('combines junction and road ids', () => {
    expect(createConnectorRoadId('j1', 'roadA', 'roadB')).toBe('j1_roadA_roadB');
  });

  it('sanitizes special characters', () => {
    expect(createConnectorRoadId('j1', 'a/b', 'c d')).toBe('j1_a_b_c_d');
  });
});

describe('createJunctionConnectionId', () => {
  it('generates unique id not in existing connections', () => {
    const junction = makeJunction('j1', [
      { id: 'conn_0', incoming_road: 'r1', connecting_road: 'c1', contact_point: 'Start', lane_links: [] },
    ]);
    const id = createJunctionConnectionId(junction);
    expect(id).not.toBe('conn_0');
    expect(id).toBe('conn_1');
  });
});

// ─── buildConnectorRoad ───────────────────────────────────────────────────────

describe('buildConnectorRoad', () => {
  it('builds a ParamPoly3 road connecting two roads', () => {
    const r1 = makeRoad('r1', {
      plan_view: [{ s: 0, x: 0, y: 0, hdg: 0, length: 10, geo_type: 'Line' }],
    });
    const r2 = makeRoad('r2', {
      plan_view: [{ s: 0, x: 15, y: 5, hdg: Math.PI / 4, length: 10, geo_type: 'Line' }],
    });
    const project = makeProject([r1, r2], [makeJunction('j1', [])]);
    const connector = buildConnectorRoad(project, 'j1', 'r1', 'r2');

    expect(connector).not.toBeNull();
    expect(connector!.junction_id).toBe('j1');
    expect(connector!.link?.predecessor?.element_id).toBe('r1');
    expect(connector!.link?.successor?.element_id).toBe('r2');
    expect(connector!.plan_view[0]?.geo_type).toHaveProperty('ParamPoly3');
    expect(connector!.length).toBeGreaterThan(0);
    expect(connector!.lane_sections).toHaveLength(1);
  });

  it('returns null when incoming and outgoing are same road', () => {
    const r1 = makeRoad('r1');
    const project = makeProject([r1], [makeJunction('j1', [])]);
    expect(buildConnectorRoad(project, 'j1', 'r1', 'r1')).toBeNull();
  });

  it('returns null when road is not found', () => {
    const project = makeProject([makeRoad('r1')], [makeJunction('j1', [])]);
    expect(buildConnectorRoad(project, 'j1', 'r1', 'nonexistent')).toBeNull();
  });
});

// ─── attachRoadToJunction ─────────────────────────────────────────────────────

describe('attachRoadToJunction', () => {
  it('sets successor link to junction at End', () => {
    const project = makeProject([makeRoad('r1')], [makeJunction('j1', [])]);
    const result = attachRoadToJunction(project, 'j1', 'r1', 'End');
    const road = result.roads.find((r) => r.id === 'r1')!;
    expect(road.link?.successor?.element_id).toBe('j1');
    expect(road.link?.successor?.element_type).toBe('Junction');
  });

  it('sets predecessor link to junction at Start', () => {
    const project = makeProject([makeRoad('r1')], [makeJunction('j1', [])]);
    const result = attachRoadToJunction(project, 'j1', 'r1', 'Start');
    const road = result.roads.find((r) => r.id === 'r1')!;
    expect(road.link?.predecessor?.element_id).toBe('j1');
    expect(road.link?.predecessor?.element_type).toBe('Junction');
  });

  it('does not mutate original project', () => {
    const project = makeProject([makeRoad('r1')], [makeJunction('j1', [])]);
    attachRoadToJunction(project, 'j1', 'r1', 'End');
    expect(project.roads[0]?.link?.successor).toBeNull();
  });
});

// ─── addJunctionConnectionToProject ──────────────────────────────────────────

describe('addJunctionConnectionToProject', () => {
  it('adds a new connection to the junction', () => {
    const project = makeProject(
      [makeRoad('r1'), makeRoad('conn')],
      [makeJunction('j1', [])],
    );
    const result = addJunctionConnectionToProject(project, 'j1', {
      incomingRoad: 'r1',
      connectingRoad: 'conn',
      contactPoint: 'Start',
      laneLinks: [{ from: -1, to: -1 }],
    });
    expect(result.junctions[0]?.connections).toHaveLength(1);
    expect(result.junctions[0]?.connections[0]?.incoming_road).toBe('r1');
  });

  it('does not add duplicate connection', () => {
    const project = makeProject(
      [makeRoad('r1'), makeRoad('conn')],
      [makeJunction('j1', [{ id: 'c0', incoming_road: 'r1', connecting_road: 'conn', contact_point: 'Start', lane_links: [] }])],
    );
    const result = addJunctionConnectionToProject(project, 'j1', {
      incomingRoad: 'r1',
      connectingRoad: 'conn',
      contactPoint: 'Start',
    });
    expect(result.junctions[0]?.connections).toHaveLength(1);
  });
});

// ─── removeJunctionConnectionFromProject ──────────────────────────────────────

describe('removeJunctionConnectionFromProject', () => {
  it('removes connection and its connecting road', () => {
    const project = makeProject(
      [makeRoad('r1'), makeRoad('conn', { junction_id: 'j1' })],
      [makeJunction('j1', [{ id: 'c1', incoming_road: 'r1', connecting_road: 'conn', contact_point: 'Start', lane_links: [] }])],
    );
    const result = removeJunctionConnectionFromProject(project, 'j1', 0);
    expect(result.junctions[0]?.connections).toHaveLength(0);
    expect(result.roads.find((r) => r.id === 'conn')).toBeUndefined();
  });

  it('keeps connecting road if still referenced by another connection', () => {
    const project = makeProject(
      [makeRoad('r1'), makeRoad('r2'), makeRoad('conn', { junction_id: 'j1' })],
      [makeJunction('j1', [
        { id: 'c1', incoming_road: 'r1', connecting_road: 'conn', contact_point: 'Start', lane_links: [] },
        { id: 'c2', incoming_road: 'r2', connecting_road: 'conn', contact_point: 'Start', lane_links: [] },
      ])],
    );
    const result = removeJunctionConnectionFromProject(project, 'j1', 0);
    expect(result.junctions[0]?.connections).toHaveLength(1);
    expect(result.roads.find((r) => r.id === 'conn')).toBeDefined();
  });

  it('returns project unchanged if index out of range', () => {
    const project = makeProject([makeRoad('r1')], [makeJunction('j1', [])]);
    const result = removeJunctionConnectionFromProject(project, 'j1', 5);
    expect(result).toBe(project);
  });
});

// ─── addConnectionBetweenRoads ────────────────────────────────────────────────

describe('addConnectionBetweenRoads', () => {
  it('creates connector road and connection', () => {
    const r1 = makeRoad('r1', {
      plan_view: [{ s: 0, x: 0, y: 0, hdg: 0, length: 10, geo_type: 'Line' }],
    });
    const r2 = makeRoad('r2', {
      plan_view: [{ s: 0, x: 15, y: 0, hdg: 0, length: 10, geo_type: 'Line' }],
    });
    const project = makeProject([r1, r2], [makeJunction('j1', [])]);
    const result = addConnectionBetweenRoads(project, 'j1', 'r1', 'r2');

    expect(result.junctions[0]?.connections).toHaveLength(1);
    expect(result.roads.length).toBeGreaterThan(2);
    // Verify the connector road exists
    const connId = result.junctions[0]?.connections[0]?.connecting_road;
    expect(result.roads.find((r) => r.id === connId)).toBeDefined();
  });

  it('returns project unchanged if junction not found', () => {
    const project = makeProject([makeRoad('r1')], []);
    const result = addConnectionBetweenRoads(project, 'j-nonexist', 'r1', 'r2');
    expect(result).toBe(project);
  });

  it('does not add duplicate connections', () => {
    const r1 = makeRoad('r1', {
      plan_view: [{ s: 0, x: 0, y: 0, hdg: 0, length: 10, geo_type: 'Line' }],
    });
    const r2 = makeRoad('r2', {
      plan_view: [{ s: 0, x: 15, y: 0, hdg: 0, length: 10, geo_type: 'Line' }],
    });
    const project = makeProject([r1, r2], [makeJunction('j1', [])]);
    const result1 = addConnectionBetweenRoads(project, 'j1', 'r1', 'r2');
    const result2 = addConnectionBetweenRoads(result1, 'j1', 'r1', 'r2');
    expect(result2.junctions[0]?.connections).toHaveLength(1);
  });
});

// ─── detachRoadFromJunction ───────────────────────────────────────────────────

describe('detachRoadFromJunction', () => {
  it('removes connections involving the road and clears its link', () => {
    const r1 = makeRoad('r1', {
      link: { predecessor: null, successor: { element_id: 'j1', element_type: 'Junction', contact_point: 'End' } },
    });
    const conn = makeRoad('conn', {
      junction_id: 'j1',
      link: {
        predecessor: { element_id: 'r1', element_type: 'Road', contact_point: 'End' },
        successor: { element_id: 'r2', element_type: 'Road', contact_point: 'Start' },
      },
    });
    const project = makeProject(
      [r1, makeRoad('r2'), conn],
      [makeJunction('j1', [{ id: 'c1', incoming_road: 'r1', connecting_road: 'conn', contact_point: 'Start', lane_links: [] }])],
    );
    const result = detachRoadFromJunction(project, 'j1', 'r1');
    const detachedRoad = result.roads.find((r) => r.id === 'r1')!;
    expect(detachedRoad.link?.successor).toBeNull();
    expect(result.junctions[0]?.connections).toHaveLength(0);
  });

  it('returns project unchanged if junction not found', () => {
    const project = makeProject([makeRoad('r1')], []);
    const result = detachRoadFromJunction(project, 'j-nonexist', 'r1');
    expect(result).toBe(project);
  });
});

// ─── fillJunctionConnectionGaps ───────────────────────────────────────────────

describe('fillJunctionConnectionGaps', () => {
  it('returns project unchanged if junction not found', () => {
    const project = makeProject([makeRoad('r1')], []);
    const result = fillJunctionConnectionGaps(project, 'j-nonexist');
    expect(result).toBe(project);
  });

  it('returns project unchanged if no connections', () => {
    const project = makeProject([makeRoad('r1')], [makeJunction('j1', [])]);
    const result = fillJunctionConnectionGaps(project, 'j1');
    expect(result).toBe(project);
  });
});

// ─── additional branch coverage tests ────────────────────────────────────────

describe('chooseRoadConnectionContactPoint (edge cases)', () => {
  it('returns End when junction center cannot be computed (no connecting roads)', () => {
    const road = makeRoad('r1');
    // Junction with no connections → computeJunctionCenter returns null
    const project = makeProject([road], [makeJunction('j1', [])]);
    const result = chooseRoadConnectionContactPoint(project, 'j1', road);
    expect(result).toBe('End');
  });
});

describe('createJunctionConnectionId (collision handling)', () => {
  it('skips colliding IDs until finding a unique one', () => {
    // Create junction with connections whose IDs collide with the pattern
    const junction = {
      ...makeJunction('j1', []),
      connections: [
        { id: 'conn_0', incoming_road: 'r1', connecting_road: 'c1', contact_point: 'Start' as const, lane_links: [] },
        { id: 'conn_1', incoming_road: 'r2', connecting_road: 'c2', contact_point: 'Start' as const, lane_links: [] },
      ],
    };
    const id = createJunctionConnectionId(junction);
    expect(id).toBe('conn_2');
  });
});