import { describe, expect, it } from 'vitest';
import type { Project } from '../../../services/platform';
import { executeScriptCommand } from './scriptingUtils';

function makeProject(): Project {
  return {
    name: 'Scripted Project',
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
        id: 'road_1',
        name: 'Mainline',
        length: 12,
        junction_id: null,
        render_hidden: false,
        link: null,
        plan_view: [{ s: 0, x: 0, y: 0, hdg: 0, length: 12, geo_type: 'Line' }],
        elevation_profile: [],
        lane_sections: [],
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

describe('scriptingUtils', () => {
  it('returns help output', () => {
    expect(executeScriptCommand(makeProject(), 'help').output).toContain('project.summary');
  });

  it('renames the project immutably', () => {
    const project = makeProject();
    const result = executeScriptCommand(project, 'project.rename Updated');
    expect(result.nextProject.name).toBe('Updated');
    expect(project.name).toBe('Scripted Project');
  });

  it('lists roads', () => {
    const result = executeScriptCommand(makeProject(), 'roads.list');
    expect(result.output).toContain('road_1');
  });

  it('deploys signals through the command surface', () => {
    const result = executeScriptCommand(makeProject(), 'traffic.deploySignals');
    expect(result.nextProject.roads[0]?.signals).toHaveLength(1);
  });
});