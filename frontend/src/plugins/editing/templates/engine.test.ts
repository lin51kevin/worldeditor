import { describe, it, expect } from 'vitest';
import {
  buildLaneSection,
  buildRoadFromConfig,
  buildJunctionFromConfig,
  buildSignalFromConfig,
  buildMarkFromConfig,
} from './engine';
import type {
  RoadTemplateConfig,
  JunctionTemplateConfig,
  SignalTemplateConfig,
  MarkingTemplateConfig,
} from './schema';

// ── buildLaneSection ─────────────────────────────────────────────────────────

describe('buildLaneSection', () => {
  it('should create a section with left and right lanes', () => {
    const section = buildLaneSection(
      [{ laneType: 'Driving', width: 3.5, mark: { type: 'Solid', color: 'Yellow' } }],
      [{ laneType: 'Driving', width: 3.5, mark: { type: 'Solid', color: 'Yellow' } }],
    );
    expect(section.s).toBe(0);
    expect(section.single_side).toBe(false);
    expect(section.left).toHaveLength(1);
    expect(section.center).toHaveLength(1);
    expect(section.right).toHaveLength(1);
  });

  it('should assign positive IDs to left lanes', () => {
    const section = buildLaneSection(
      [
        { laneType: 'Driving', width: 3.5 },
        { laneType: 'Shoulder', width: 2.5 },
      ],
      [],
    );
    expect(section.left[0]!.id).toBe(1);
    expect(section.left[1]!.id).toBe(2);
  });

  it('should assign negative IDs to right lanes', () => {
    const section = buildLaneSection(
      [],
      [
        { laneType: 'Driving', width: 3.5 },
        { laneType: 'Shoulder', width: 2.5 },
      ],
    );
    expect(section.right[0]!.id).toBe(-1);
    expect(section.right[1]!.id).toBe(-2);
  });

  it('should set center lane id=0 with type None', () => {
    const section = buildLaneSection([], []);
    expect(section.center[0]!.id).toBe(0);
    expect(section.center[0]!.lane_type).toBe('None');
  });

  it('should apply road marks from config', () => {
    const section = buildLaneSection(
      [{ laneType: 'Driving', width: 3.5, mark: { type: 'Solid', color: 'Yellow', width: 0.15 } }],
      [],
    );
    const lane = section.left[0]!;
    expect(lane.road_marks).toHaveLength(1);
    expect(lane.road_marks[0]!.mark_type).toBe('Solid');
    expect(lane.road_marks[0]!.color).toBe('Yellow');
  });

  it('should produce empty road_marks when mark is omitted', () => {
    const section = buildLaneSection(
      [{ laneType: 'Driving', width: 3.5 }],
      [],
    );
    expect(section.left[0]!.road_marks).toHaveLength(0);
  });

  it('should set lane width polynomial with constant a value', () => {
    const section = buildLaneSection(
      [{ laneType: 'Driving', width: 4.0 }],
      [],
    );
    const w = section.left[0]!.width[0]!;
    expect(w.a).toBe(4.0);
    expect(w.b).toBe(0);
    expect(w.c).toBe(0);
    expect(w.d).toBe(0);
  });
});

// ── buildRoadFromConfig ──────────────────────────────────────────────────────

describe('buildRoadFromConfig', () => {
  const config: RoadTemplateConfig = {
    id: 'test:road',
    labelKey: 'test.road',
    icon: 'T',
    left: [{ laneType: 'Driving', width: 3.5, mark: { type: 'Solid', color: 'Yellow' } }],
    right: [{ laneType: 'Driving', width: 3.5, mark: { type: 'Solid', color: 'Yellow' } }],
  };

  it('should create a road at the specified position', () => {
    const road = buildRoadFromConfig(config, 10, 20, Math.PI / 4);
    const pv = road.plan_view[0]!;
    expect(pv.x).toBe(10);
    expect(pv.y).toBe(20);
    expect(pv.hdg).toBe(Math.PI / 4);
  });

  it('should default length to 100', () => {
    const road = buildRoadFromConfig(config, 0, 0);
    expect(road.length).toBe(100);
  });

  it('should use custom length from config', () => {
    const road = buildRoadFromConfig({ ...config, length: 50 }, 0, 0);
    expect(road.length).toBe(50);
  });

  it('should have correct lane sections', () => {
    const road = buildRoadFromConfig(config, 0, 0);
    expect(road.lane_sections).toHaveLength(1);
    const sec = road.lane_sections[0]!;
    expect(sec.left).toHaveLength(1);
    expect(sec.right).toHaveLength(1);
    expect(sec.left[0]!.lane_type).toBe('Driving');
  });

  it('should generate unique road IDs', () => {
    const road1 = buildRoadFromConfig(config, 0, 0);
    const road2 = buildRoadFromConfig(config, 0, 0);
    expect(road1.id).not.toBe(road2.id);
  });

  it('should default junction_id to null', () => {
    const road = buildRoadFromConfig(config, 0, 0);
    expect(road.junction_id).toBeNull();
  });

  it('should create road with single-side (left-only) config', () => {
    const leftOnly: RoadTemplateConfig = { ...config, left: [], right: [{ laneType: 'Driving', width: 3.5 }] };
    const road = buildRoadFromConfig(leftOnly, 0, 0);
    expect(road.lane_sections[0]!.left).toHaveLength(0);
    expect(road.lane_sections[0]!.right).toHaveLength(1);
  });
});

// ── buildJunctionFromConfig ──────────────────────────────────────────────────

describe('buildJunctionFromConfig', () => {
  const tConfig: JunctionTemplateConfig = {
    id: 'test:jct:t',
    labelKey: 'test.jct.t',
    icon: '⊤',
    topology: 'T',
    armLength: 80,
    name: 'T-Intersection',
    armSection: {
      left: [{ laneType: 'Driving', width: 3.5, mark: { type: 'Solid', color: 'Yellow' } }],
      right: [{ laneType: 'Driving', width: 3.5, mark: { type: 'Solid', color: 'Yellow' } }],
    },
    connectionPattern: 'all-pairs',
  };

  it('should create 3 roads for T topology', () => {
    const { roads } = buildJunctionFromConfig(tConfig, 0, 0);
    expect(roads).toHaveLength(3);
  });

  it('should create N*(N-1) connections for all-pairs', () => {
    const { junction } = buildJunctionFromConfig(tConfig, 0, 0);
    // 3 arms → 3*2 = 6 connections
    expect(junction.connections).toHaveLength(6);
  });

  it('should set junction name from config', () => {
    const { junction } = buildJunctionFromConfig(tConfig, 0, 0);
    expect(junction.name).toBe('T-Intersection');
  });

  it('should link each road to the junction', () => {
    const { junction, roads } = buildJunctionFromConfig(tConfig, 0, 0);
    for (const road of roads) {
      expect(road.link?.predecessor?.element_type).toBe('Junction');
      expect(road.link?.predecessor?.element_id).toBe(junction.id);
    }
  });

  it('should create 4 roads for Cross topology', () => {
    const crossConfig: JunctionTemplateConfig = {
      ...tConfig,
      id: 'test:jct:cross',
      topology: 'Cross',
    };
    const { roads } = buildJunctionFromConfig(crossConfig, 0, 0);
    expect(roads).toHaveLength(4);
  });

  it('should create 12 connections for Cross all-pairs', () => {
    const crossConfig: JunctionTemplateConfig = {
      ...tConfig,
      id: 'test:jct:cross',
      topology: 'Cross',
    };
    const { junction } = buildJunctionFromConfig(crossConfig, 0, 0);
    // 4 arms → 4*3 = 12 connections
    expect(junction.connections).toHaveLength(12);
  });

  it('should create N roads for Radial topology', () => {
    const radialConfig: JunctionTemplateConfig = {
      ...tConfig,
      id: 'test:jct:5way',
      topology: 'Radial',
      armCount: 5,
    };
    const { roads } = buildJunctionFromConfig(radialConfig, 0, 0);
    expect(roads).toHaveLength(5);
  });

  it('should default to no connections when pattern is none', () => {
    const noConn: JunctionTemplateConfig = {
      ...tConfig,
      connectionPattern: 'none',
    };
    const { junction } = buildJunctionFromConfig(noConn, 0, 0);
    expect(junction.connections).toHaveLength(0);
  });

  it('should use default arm section when armSection is omitted', () => {
    const minimal: JunctionTemplateConfig = {
      id: 'test:jct:minimal',
      labelKey: 'test.jct.minimal',
      icon: '?',
      topology: 'T',
      armLength: 60,
    };
    const { roads } = buildJunctionFromConfig(minimal, 0, 0);
    expect(roads).toHaveLength(3);
    // Default section has 1 left + 1 right driving lane
    const firstRoad = roads[0]!;
    expect(firstRoad.lane_sections[0]!.left).toHaveLength(1);
    expect(firstRoad.lane_sections[0]!.right).toHaveLength(1);
  });

  it('should position arms with gap from center', () => {
    const { roads } = buildJunctionFromConfig(tConfig, 100, 200);
    // All arm start points should be at gap distance from center
    for (const road of roads) {
      const dx = road.plan_view[0]!.x - 100;
      const dy = road.plan_view[0]!.y - 200;
      const dist = Math.sqrt(dx * dx + dy * dy);
      expect(dist).toBeGreaterThan(0);
    }
  });

  it('should have lane links in each connection', () => {
    const { junction } = buildJunctionFromConfig(tConfig, 0, 0);
    for (const conn of junction.connections) {
      expect(conn.lane_links.length).toBeGreaterThan(0);
      // Each link maps from lane id to same lane id
      for (const link of conn.lane_links) {
        expect(link.from).toBe(link.to);
      }
    }
  });
});

// ── buildSignalFromConfig ────────────────────────────────────────────────────

describe('buildSignalFromConfig', () => {
  const config: SignalTemplateConfig = {
    id: 'test:sig',
    labelKey: 'test.sig',
    icon: '🚦',
    signalType: '1000001',
  };

  it('should create a signal with the specified type', () => {
    const signal = buildSignalFromConfig(config);
    expect(signal.signal_type).toBe('1000001');
  });

  it('should default subtype to -1', () => {
    const signal = buildSignalFromConfig(config);
    expect(signal.signal_subtype).toBe('-1');
  });

  it('should use custom width/height', () => {
    const signal = buildSignalFromConfig({ ...config, width: 2.0, height: 3.0 });
    expect(signal.width).toBe(2.0);
    expect(signal.height).toBe(3.0);
  });

  it('should generate unique signal IDs', () => {
    const s1 = buildSignalFromConfig(config);
    const s2 = buildSignalFromConfig(config);
    expect(s1.id).not.toBe(s2.id);
  });
});

// ── buildMarkFromConfig ──────────────────────────────────────────────────────

describe('buildMarkFromConfig', () => {
  it('should create a solid white mark', () => {
    const config: MarkingTemplateConfig = {
      id: 'test:mark',
      labelKey: 'test.mark',
      icon: '━',
      mark: { type: 'Solid' },
    };
    const mark = buildMarkFromConfig(config);
    expect(mark.mark_type).toBe('Solid');
    expect(mark.color).toBe('Standard');
    expect(mark.width).toBe(0.15);
    expect(mark.lane_change).toBe('None');
  });

  it('should create a broken line with custom width', () => {
    const config: MarkingTemplateConfig = {
      id: 'test:mark:broken',
      labelKey: 'test.mark',
      icon: '╌',
      mark: { type: 'Broken', width: 0.12, laneChange: 'Both' },
    };
    const mark = buildMarkFromConfig(config);
    expect(mark.mark_type).toBe('Broken');
    expect(mark.width).toBe(0.12);
    expect(mark.lane_change).toBe('Both');
  });

  it('should create a yellow mark', () => {
    const config: MarkingTemplateConfig = {
      id: 'test:mark:yellow',
      labelKey: 'test.mark',
      icon: '🟡',
      mark: { type: 'Solid', color: 'Yellow' },
    };
    const mark = buildMarkFromConfig(config);
    expect(mark.color).toBe('Yellow');
  });
});
