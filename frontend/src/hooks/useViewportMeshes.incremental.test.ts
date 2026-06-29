import { describe, expect, it } from 'vitest';
import { shouldUseIncrementalRoads, shouldRebuildAllRoads } from './useViewportMeshes';

describe('shouldUseIncrementalRoads', () => {
  const base = { isSolid: true, supported: true, roadsUnique: true, registryActive: true, changedRoadCount: 1, cacheReady: true };

  it('returns false outside solid mode', () => {
    expect(shouldUseIncrementalRoads({ ...base, isSolid: false })).toBe(false);
  });

  it('returns false when renderer/service support is missing', () => {
    expect(shouldUseIncrementalRoads({ ...base, supported: false })).toBe(false);
  });

  // Regression (GeoZ): imported roads may carry duplicate or empty ids, which
  // collapse in the id-keyed per-road registry and render only a subset. Fall
  // back to the merged path (positional iteration) so every road shows.
  it('falls back to merged when road ids are not unique', () => {
    expect(shouldUseIncrementalRoads({ ...base, roadsUnique: false })).toBe(false);
    expect(shouldUseIncrementalRoads({ ...base, roadsUnique: false, changedRoadCount: 0 })).toBe(false);
  });

  // The first solid frame seeds the registry incrementally (registry not yet
  // live) as long as the WASM cache is ready, so per-road buffers carry real
  // verts and render immediately — no wire→solid toggle needed. A cold cache
  // still falls back to merged to avoid blank buffers. Completeness (registry
  // covers every road) is enforced by the caller's self-heal rebuild, not here.
  it('seeds incrementally on a cold registry once the cache is ready', () => {
    expect(shouldUseIncrementalRoads({ ...base, registryActive: false, changedRoadCount: 5, cacheReady: true })).toBe(true);
    expect(shouldUseIncrementalRoads({ ...base, registryActive: false, changedRoadCount: 5, cacheReady: false })).toBe(false);
    expect(shouldUseIncrementalRoads({ ...base, registryActive: false, changedRoadCount: 0 })).toBe(true);
  });

  it('uses incremental when roads changed and the cache is ready', () => {
    expect(shouldUseIncrementalRoads({ ...base, changedRoadCount: 2, cacheReady: true })).toBe(true);
  });

  it('falls back to merged when roads changed but the cache is not ready', () => {
    expect(shouldUseIncrementalRoads({ ...base, changedRoadCount: 2, cacheReady: false })).toBe(false);
  });

  // Regression: a solid-mode re-render with no road changes (e.g. toggling a
  // render-only flag) does NOT push the WASM cache, so cacheReady is false. The
  // road layer must STAY incremental — falling back to the merged path here
  // uploaded an empty merged buffer and destroyed every per-road surface buffer.
  it('stays incremental when no road changed even if the cache is not ready', () => {
    expect(shouldUseIncrementalRoads({ ...base, changedRoadCount: 0, cacheReady: false })).toBe(true);
  });

  it('stays incremental when no road changed and the cache is ready', () => {
    expect(shouldUseIncrementalRoads({ ...base, changedRoadCount: 0, cacheReady: true })).toBe(true);
  });
});

describe('shouldRebuildAllRoads', () => {
  const base = { colorModeChanged: false, registryActive: true, registryMeshCount: 598, roadsTotal: 598 };

  it('rebuilds all roads when the colour mode changed', () => {
    expect(shouldRebuildAllRoads({ ...base, colorModeChanged: true })).toBe(true);
  });

  // First seed: registry not live yet, build every road in one pass.
  it('rebuilds all roads when the registry is not yet live', () => {
    expect(shouldRebuildAllRoads({ ...base, registryActive: false })).toBe(true);
  });

  // Self-heal: a seed that landed mid-load (roads still streaming) leaves the
  // registry covering fewer roads than exist. Force a full rebuild so it
  // converges instead of leaving most roads permanently unbuilt.
  it('rebuilds all roads when the registry only partially covers the roads', () => {
    expect(shouldRebuildAllRoads({ ...base, registryMeshCount: 1, roadsTotal: 598 })).toBe(true);
  });

  it('rebuilds only changed roads when the registry is complete', () => {
    expect(shouldRebuildAllRoads(base)).toBe(false);
  });
});
