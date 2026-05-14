import { describe, expect, it } from 'vitest';
import type { Project, Road } from '../services/platform';
import {
  buildHighlightProject,
  buildRenderableProject,
  isSceneSelectionVisible,
  makeLaneKey,
  makeLaneSectionKey,
  tintVertices,
} from './sceneGraph';

function makeRoad(): Road {
  return {
    id: 'r1',
    name: 'Road 1',
    length: 100,
    junction_id: null,
    link: { predecessor: null, successor: null },
    plan_view: [],
    elevation_profile: [],
    lane_sections: [{
      s: 0,
      single_side: false,
      left: [
        { id: 1, lane_type: 'Driving', level: 0, link: { predecessor: null, successor: null }, width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }], road_marks: [] },
        { id: 2, lane_type: 'Driving', level: 0, link: { predecessor: null, successor: null }, width: [{ s_offset: 0, a: 3.2, b: 0, c: 0, d: 0 }], road_marks: [] },
      ],
      center: [{ id: 0, lane_type: 'None', level: 0, link: { predecessor: null, successor: null }, width: [], road_marks: [] }],
      right: [{ id: -1, lane_type: 'Driving', level: 0, link: { predecessor: null, successor: null }, width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }], road_marks: [] }],
    }],
  };
}

function makeProject(): Project {
  return {
    name: 'Project',
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
    roads: [makeRoad()],
    junctions: [],
    signals: [],
    objects: []
  };
}

describe('sceneGraph', () => {
  it('marks hidden lane sections and lanes without removing geometry context', () => {
    const project = buildRenderableProject(makeProject(), {
      hiddenRoadIds: [],
      hiddenJunctionIds: [],
      hiddenLaneSectionKeys: [makeLaneSectionKey('r1', 0)],
      hiddenLaneKeys: [makeLaneKey('r1', 0, 'left', 2)],
      hiddenSignalKeys: [],
      hiddenObjectKeys: [],
    });

    expect(project.roads[0]?.lane_sections[0]?.render_hidden).toBe(true);
    expect(project.roads[0]?.lane_sections[0]?.left[1]?.render_hidden).toBe(true);
    expect(project.roads[0]?.lane_sections[0]?.left).toHaveLength(2);
  });

  it('builds lane highlight projects by hiding sibling lanes instead of removing them', () => {
    const project = buildHighlightProject(makeProject(), {
      type: 'lane',
      roadId: 'r1',
      sectionIndex: 0,
      side: 'left',
      laneId: 2,
    });

    expect(project?.roads).toHaveLength(1);
    expect(project?.roads[0]?.lane_sections[0]?.left[0]?.render_hidden).toBe(true);
    expect(project?.roads[0]?.lane_sections[0]?.left[1]?.render_hidden).toBe(false);
  });

  it('reports child selections as invisible when a parent or the node itself is hidden', () => {
    expect(isSceneSelectionVisible(
      { type: 'lane', roadId: 'r1', sectionIndex: 0, side: 'left', laneId: 2 },
      {
        hiddenRoadIds: [],
        hiddenJunctionIds: [],
        hiddenLaneSectionKeys: [],
        hiddenLaneKeys: [makeLaneKey('r1', 0, 'left', 2)],
        hiddenSignalKeys: [],
        hiddenObjectKeys: [],
      },
    )).toBe(false);

    expect(isSceneSelectionVisible(
      { type: 'laneSection', roadId: 'r1', sectionIndex: 0 },
      {
        hiddenRoadIds: ['r1'],
        hiddenJunctionIds: [],
        hiddenLaneSectionKeys: [],
        hiddenLaneKeys: [],
        hiddenSignalKeys: [],
        hiddenObjectKeys: [],
      },
    )).toBe(false);
  });

  it('tints mesh vertices with a uniform highlight color', () => {
    const tinted = tintVertices(new Float32Array([0, 1, 2, 0.1, 0.2, 0.3, 0.4]), [1, 0, 0, 0.8]);
    expect(Array.from(tinted.slice(0, 6))).toEqual([0, 1, 2, 1, 0, 0]);
    expect(tinted[6]).toBeCloseTo(0.8);
  });
});
