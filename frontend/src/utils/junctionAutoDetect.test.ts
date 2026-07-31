import { describe, expect, it } from 'vitest';
import type { Geometry, Project, Road } from '../services/platform';
import { clusterRoadContacts, detectJunctionClusters, roadEndpoints } from './junctionAutoDetect';

function line(x: number, y: number, hdg: number, length: number): Geometry {
  return { s: 0, x, y, hdg, length, geo_type: 'Line' };
}

function road(id: string, segs: Geometry[], junctionId: string | null = null): Road {
  return {
    id, name: id, length: segs.reduce((s, g) => s + g.length, 0), junction_id: junctionId,
    link: { predecessor: null, successor: null }, plan_view: segs, elevation_profile: [], lane_sections: [],
  };
}

function project(roads: Road[]): Project {
  return {
    name: 'Untitled',
    header: { rev_major: 1, rev_minor: 6, name: '', date: '', north: 0, south: 0, east: 0, west: 0, geo_reference: null },
    roads, junctions: [], signals: [], objects: [],
  };
}

describe('roadEndpoints', () => {
  it('returns start and extrapolated end of a straight road', () => {
    const eps = roadEndpoints(road('r', [line(0, 0, 0, 10)]));
    expect(eps[0]).toMatchObject({ contactPoint: 'start', x: 0, y: 0 });
    expect(eps[1]!.contactPoint).toBe('end');
    expect(eps[1]!.x).toBeCloseTo(10);
    expect(eps[1]!.y).toBeCloseTo(0);
  });
});

describe('detectJunctionClusters', () => {
  it('clusters two roads meeting end-to-end into one candidate', () => {
    // r1 ends at (10,0); r2 starts at (10.1, 0) — within threshold.
    const p = project([
      road('r1', [line(0, 0, 0, 10)]),
      road('r2', [line(10.1, 0, Math.PI / 2, 10)]),
    ]);
    const clusters = detectJunctionClusters(p, 5);
    expect(clusters.length).toBe(1);
    expect(new Set(clusters[0]!.map((e) => e.roadId))).toEqual(new Set(['r1', 'r2']));
  });

  it('ignores endpoints that are far apart', () => {
    const p = project([
      road('r1', [line(0, 0, 0, 10)]),
      road('r2', [line(100, 100, 0, 10)]),
    ]);
    expect(detectJunctionClusters(p, 5)).toEqual([]);
  });

  it('skips roads already assigned to a junction', () => {
    const p = project([
      road('r1', [line(0, 0, 0, 10)], 'j1'),
      road('r2', [line(10.1, 0, 0, 10)], 'j1'),
    ]);
    expect(detectJunctionClusters(p, 5)).toEqual([]);
  });

  it('groups a 4-way crossing of stubs into a single cluster', () => {
    // Four roads whose inner ends all meet near (0,0).
    const p = project([
      road('n', [line(0, 1, Math.PI / 2, 10)]),   // start at (0,1)
      road('s', [line(0, -1, -Math.PI / 2, 10)]), // start at (0,-1)
      road('e', [line(1, 0, 0, 10)]),             // start at (1,0)
      road('w', [line(-1, 0, Math.PI, 10)]),      // start at (-1,0)
    ]);
    const clusters = detectJunctionClusters(p, 5);
    expect(clusters.length).toBe(1);
    expect(new Set(clusters[0]!.map((e) => e.roadId))).toEqual(new Set(['n', 's', 'e', 'w']));
  });
});

describe('clusterRoadContacts', () => {
  it('keeps one contact point per road', () => {
    const contacts = clusterRoadContacts([
      { roadId: 'r1', contactPoint: 'end', x: 0, y: 0 },
      { roadId: 'r1', contactPoint: 'start', x: 0, y: 0 },
      { roadId: 'r2', contactPoint: 'start', x: 0, y: 0 },
    ]);
    expect(contacts).toEqual([
      { roadId: 'r1', contactPoint: 'end' },
      { roadId: 'r2', contactPoint: 'start' },
    ]);
  });
});
