import { describe, expect, it } from 'vitest';
import type { Project } from '../../../services/platform';
import { autoDeploySignals, computeTrafficPhases, exportSumoNetwork, importSumoNetwork } from './trafficUtils';

function makeProject(): Project {
  return {
    name: 'Traffic Test',
    header: {
      rev_major: 1,
      rev_minor: 6,
      name: '',
      date: '',
      north: 0,
      south: 0,
      east: 0,
      west: 0,
      geo_reference: null,
    },
    roads: [
      {
        id: 'r1',
        name: 'r1',
        length: 40,
        junction_id: null,
        link: null,
        plan_view: [{ s: 0, x: 0, y: 0, hdg: 0, length: 40, geo_type: 'Line' }],
        lane_sections: [],
        elevation_profile: [],
        lane_offsets: [],
        lateral_profile: { superelevations: [], crossfalls: [] },
        bridges: [],
        tunnels: [],
        signals: [],
        objects: [],
      },
    ],
    junctions: [],
    signals: [],
    objects: [],
  };
}

describe('trafficUtils', () => {
  it('autoDeploySignals adds one signal to roads without signals', () => {
    const project = autoDeploySignals(makeProject());
    expect(project.roads[0]?.signals).toHaveLength(1);
    expect(project.roads[0]?.signals?.[0]?.signal_type).toBe('traffic_light');
  });

  it('computeTrafficPhases returns one suggestion per signalled road when no junctions exist', () => {
    const project = autoDeploySignals(makeProject());
    const phases = computeTrafficPhases(project);
    expect(phases).toHaveLength(1);
    expect(phases[0]?.roadIds).toEqual(['r1']);
  });

  it('importSumoNetwork creates roads from edge lane shapes', () => {
    const xml = '<?xml version="1.0"?><net><edge id="e1"><lane id="e1_0" shape="0,0 10,0 10,5"/></edge></net>';
    const project = importSumoNetwork(xml, 'net.xml');
    expect(project.roads).toHaveLength(1);
    expect(project.roads[0]?.plan_view).toHaveLength(2);
  });

  it('importSumoNetwork rejects malformed XML', () => {
    expect(() => importSumoNetwork('<net><edge>', 'broken.net.xml')).toThrow(/Invalid SUMO network XML/);
  });

  it('exportSumoNetwork writes edges and lane shapes', () => {
    const xml = exportSumoNetwork(makeProject());
    expect(xml).toContain('<net>');
    expect(xml).toContain('<edge id="r1"');
    expect(xml).toContain('shape="0.000,0.000 40.000,0.000"');
  });
});