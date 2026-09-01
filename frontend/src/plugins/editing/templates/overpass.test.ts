import { describe, expect, it } from 'vitest';
import { buildJunctionFromConfig } from './junctionEngine';
import catalog from './defaultCatalog';
import type { JunctionTemplateConfig } from './schema';

function template(id: string): JunctionTemplateConfig {
  const config = catalog.junctions.find((j) => j.id === id);
  if (!config) throw new Error(`missing template ${id}`);
  return config;
}

/** Roads that are not junction connectors. */
function mainRoads(roads: { junction_id?: string | null }[]) {
  return roads.filter((r) => r.junction_id === null || r.junction_id === undefined);
}

describe('overpass junction templates', () => {
  it('overpass 1 builds 5 straights + 2 ramps and 3 junctions', () => {
    const result = buildJunctionFromConfig(template('tpl:jct:overpass1'), 0, 0);
    expect(mainRoads(result.roads)).toHaveLength(7);
    expect(1 + (result.extraJunctions?.length ?? 0)).toBe(3);
  });

  it('overpass 2 builds 6 straights + 4 ramps and 4 junctions', () => {
    const result = buildJunctionFromConfig(template('tpl:jct:overpass2'), 0, 0);
    expect(mainRoads(result.roads)).toHaveLength(10);
    expect(1 + (result.extraJunctions?.length ?? 0)).toBe(4);
  });

  it('overpass 3 builds 2 straights + 4 directional ramps and 1 junction', () => {
    const result = buildJunctionFromConfig(template('tpl:jct:overpass3'), 0, 0);
    expect(mainRoads(result.roads)).toHaveLength(6);
    expect(result.extraJunctions ?? []).toHaveLength(0);
  });

  it('lowers one axis by the configured height delta', () => {
    const result = buildJunctionFromConfig(template('tpl:jct:overpass1'), 0, 0);
    const lowered = mainRoads(result.roads).filter((r) =>
      (r as { elevation_profile?: { a: number }[] }).elevation_profile?.some((e) => e.a === -6));
    expect(lowered.length).toBeGreaterThan(0);
  });

  it('gives ramps a continuous elevation ramp between the two levels', () => {
    const result = buildJunctionFromConfig(template('tpl:jct:overpass1'), 0, 0);
    const ramps = mainRoads(result.roads).filter((r) =>
      (r as { elevation_profile?: { b: number }[] }).elevation_profile?.some((e) => e.b !== 0));
    expect(ramps).toHaveLength(2);
  });

  it('builds one-way ramps', () => {
    const result = buildJunctionFromConfig(template('tpl:jct:overpass2'), 0, 0);
    const ramps = mainRoads(result.roads).filter((r) =>
      (r as { elevation_profile?: { b: number }[] }).elevation_profile?.some((e) => e.b !== 0));
    for (const ramp of ramps) {
      expect((ramp as { lane_sections: { left: unknown[] }[] }).lane_sections[0]!.left).toHaveLength(0);
    }
  });

  it('translates the whole layout by the click position', () => {
    const atOrigin = buildJunctionFromConfig(template('tpl:jct:overpass1'), 0, 0);
    const shifted = buildJunctionFromConfig(template('tpl:jct:overpass1'), 25, 60);
    expect(shifted.roads[0]!.plan_view[0]!.x).toBeCloseTo(atOrigin.roads[0]!.plan_view[0]!.x + 25);
    expect(shifted.roads[0]!.plan_view[0]!.y).toBeCloseTo(atOrigin.roads[0]!.plan_view[0]!.y + 60);
  });

  it('registers connections on every junction', () => {
    const result = buildJunctionFromConfig(template('tpl:jct:overpass2'), 0, 0);
    for (const junction of [result.junction, ...(result.extraJunctions ?? [])]) {
      expect(junction.connections.length).toBeGreaterThan(0);
    }
  });
});
