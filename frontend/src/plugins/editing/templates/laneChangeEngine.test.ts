import { describe, expect, it } from 'vitest';
import { buildLaneChangeRoads, planLaneChangeSegments } from './laneChangeEngine';
import catalog from './defaultCatalog';
import type { RoadTemplateConfig } from './schema';

function laneChangeTemplate(id: string): RoadTemplateConfig {
  const config = catalog.roads.find((r) => r.id === id);
  if (!config) throw new Error(`missing template ${id}`);
  return config;
}

describe('planLaneChangeSegments', () => {
  it('expands a simple widening sequence into straight/transition/straight', () => {
    const segments = planLaneChangeSegments({ sequence: [1, 2] });
    expect(segments).toHaveLength(3);
    expect(segments.map((s) => s.laneCount)).toEqual([1, 2, 2]);
    expect(segments[1]?.taperDirection).toBe('widen');
  });

  it('expands a narrowing sequence and tapers in the other direction', () => {
    const segments = planLaneChangeSegments({ sequence: [2, 1] });
    expect(segments).toHaveLength(3);
    expect(segments.map((s) => s.laneCount)).toEqual([2, 2, 1]);
    expect(segments[1]?.taperDirection).toBe('narrow');
  });

  it('expands a three-step sequence into five segments', () => {
    const segments = planLaneChangeSegments({ sequence: [1, 2, 1] });
    expect(segments).toHaveLength(5);
    expect(segments.map((s) => s.laneCount)).toEqual([1, 2, 2, 2, 1]);
  });
});

describe('buildLaneChangeRoads', () => {
  it('builds a linked chain for a 1 → 2 template', () => {
    const { roads } = buildLaneChangeRoads(laneChangeTemplate('tpl:road:lc:1to2'), 0, 0, 0);
    expect(roads).toHaveLength(3);
    expect(roads[0]?.lane_sections[0]?.right).toHaveLength(1);
    expect(roads[2]?.lane_sections[0]?.right).toHaveLength(2);
  });

  it('links consecutive roads predecessor/successor', () => {
    const { roads } = buildLaneChangeRoads(laneChangeTemplate('tpl:road:lc:2to1'), 0, 0, 0);
    for (let i = 0; i < roads.length - 1; i++) {
      expect(roads[i]?.link?.successor?.element_id).toBe(roads[i + 1]?.id);
      expect(roads[i + 1]?.link?.predecessor?.element_id).toBe(roads[i]?.id);
    }
    expect(roads[0]?.link?.predecessor).toBeNull();
    expect(roads[roads.length - 1]?.link?.successor).toBeNull();
  });

  it('places the chain end-to-end along the given heading', () => {
    const { roads } = buildLaneChangeRoads(laneChangeTemplate('tpl:road:lc:1to2'), 10, 20, 0);
    expect(roads[0]?.plan_view[0]?.x).toBeCloseTo(10);
    expect(roads[0]?.plan_view[0]?.y).toBeCloseTo(20);
    let x = 10;
    for (const road of roads) {
      expect(road.plan_view[0]?.x).toBeCloseTo(x);
      x += road.length;
    }
  });

  it('uses the shorter segment lengths for three-step sequences', () => {
    const simple = buildLaneChangeRoads(laneChangeTemplate('tpl:road:lc:1to2'), 0, 0, 0);
    const threeStep = buildLaneChangeRoads(laneChangeTemplate('tpl:road:lc:1to2to1'), 0, 0, 0);
    expect(threeStep.roads).toHaveLength(5);
    expect(threeStep.roads[0]!.length).toBeLessThan(simple.roads[0]!.length);
  });

  it('returns no roads when the template has no lane-change config', () => {
    const plain = catalog.roads.find((r) => r.id === 'tpl:road:single')!;
    expect(buildLaneChangeRoads(plain, 0, 0, 0).roads).toHaveLength(0);
  });
});
