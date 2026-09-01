import { describe, expect, it } from 'vitest';
import { buildJunctionFromConfig } from './junctionEngine';
import { resolvePlaygroundSlots } from './playground';
import catalog from './defaultCatalog';
import type { JunctionTemplateConfig } from './schema';

function template(id: string): JunctionTemplateConfig {
  const config = catalog.junctions.find((j) => j.id === id);
  if (!config) throw new Error(`missing template ${id}`);
  return config;
}

describe('playground junction templates', () => {
  it('builds six perimeter roads plus one arm per junction', () => {
    const result = buildJunctionFromConfig(template('tpl:jct:playground4'), 0, 0);
    const perimeterAndArms = result.roads.filter((r) => r.junction_id === null || r.junction_id === undefined);
    expect(perimeterAndArms).toHaveLength(6 + 4);
  });

  it('creates one junction per active arm', () => {
    for (const [id, arms] of [
      ['tpl:jct:playground2', 2],
      ['tpl:jct:playground3', 3],
      ['tpl:jct:playground4', 4],
      ['tpl:jct:playground5', 5],
      ['tpl:jct:playground6', 6],
    ] as const) {
      const result = buildJunctionFromConfig(template(id), 0, 0);
      expect(1 + (result.extraJunctions?.length ?? 0)).toBe(arms);
    }
  });

  it('keeps the loop closed: each perimeter road ends where the next begins', () => {
    const result = buildJunctionFromConfig(template('tpl:jct:playground6'), 0, 0);
    const perimeter = result.roads.slice(0, 6);
    expect(perimeter).toHaveLength(6);
    // Bounding box of the loop matches the C# constants (±95 by ±50).
    const xs = perimeter.map((r) => r.plan_view[0]!.x);
    const ys = perimeter.map((r) => r.plan_view[0]!.y);
    expect(Math.max(...xs)).toBeCloseTo(95);
    expect(Math.min(...xs)).toBeCloseTo(-95);
    expect(Math.max(...ys)).toBeCloseTo(50);
    expect(Math.min(...ys)).toBeCloseTo(-50);
  });

  it('translates the whole layout by the click position', () => {
    const atOrigin = buildJunctionFromConfig(template('tpl:jct:playground4'), 0, 0);
    const shifted = buildJunctionFromConfig(template('tpl:jct:playground4'), 100, -40);
    expect(shifted.roads[0]!.plan_view[0]!.x).toBeCloseTo(atOrigin.roads[0]!.plan_view[0]!.x + 100);
    expect(shifted.roads[0]!.plan_view[0]!.y).toBeCloseTo(atOrigin.roads[0]!.plan_view[0]!.y - 40);
  });

  it('builds one-way perimeter roads', () => {
    const result = buildJunctionFromConfig(template('tpl:jct:playground4'), 0, 0);
    for (const road of result.roads.slice(0, 6)) {
      expect(road.lane_sections[0]?.left).toHaveLength(0);
      expect(road.lane_sections[0]!.right.length).toBeGreaterThan(0);
    }
  });

  it('registers connections on every junction', () => {
    const result = buildJunctionFromConfig(template('tpl:jct:playground4'), 0, 0);
    const all = [result.junction, ...(result.extraJunctions ?? [])];
    for (const junction of all) {
      expect(junction.connections.length).toBeGreaterThan(0);
    }
  });

  it('opens the west end (not north-west) on Playground 3, matching C#', () => {
    expect(resolvePlaygroundSlots(2).map((s) => s.key)).toEqual(['east', 'west']);
    expect(resolvePlaygroundSlots(3).map((s) => s.key)).toEqual(['east', 'ne', 'west']);
    expect(resolvePlaygroundSlots(4).map((s) => s.key)).toEqual(['east', 'ne', 'nw', 'west']);
  });

  it('anchors connectors on the loop edge instead of extrapolating curved roads', () => {
    // Regression: `roadEndPoint` used to treat every road as a straight line,
    // which threw connectors ~55 m outside the loop and produced huge fans.
    for (const id of ['tpl:jct:playground2', 'tpl:jct:playground4', 'tpl:jct:playground6']) {
      const result = buildJunctionFromConfig(template(id), 0, 0);
      const connectors = result.roads.filter((r) => r.junction_id);
      expect(connectors.length).toBeGreaterThan(0);
      for (const connector of connectors) {
        expect(connector.length).toBeLessThan(50);
        for (const geo of connector.plan_view) {
          expect(Math.abs(geo.x)).toBeLessThanOrEqual(135);
          expect(Math.abs(geo.y)).toBeLessThanOrEqual(90);
        }
      }
    }
  });

  it('sizes the loop from roundaboutLaneCount, independent of the arm lanes', () => {
    // C# clones the template with NumDrivingLanesRight = RoundaboutDrivingLanesCount.
    for (const [id, loopDriving, armDriving] of [
      ['tpl:jct:playground2', 2, 1],
      ['tpl:jct:playground4', 2, 2],
      ['tpl:jct:playground6', 3, 3],
    ] as const) {
      const result = buildJunctionFromConfig(template(id), 0, 0);
      const loop = result.roads[0]!;
      const arm = result.roads[6]!;
      const count = (road: typeof loop) =>
        road.lane_sections[0]!.right.filter((l) => l.lane_type === 'Driving').length;
      expect(count(loop)).toBe(loopDriving);
      expect(count(arm)).toBe(armDriving);
    }
  });
});
