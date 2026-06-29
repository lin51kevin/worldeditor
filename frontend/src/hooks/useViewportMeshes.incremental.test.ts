import { describe, expect, it } from 'vitest';
import { shouldUseIncrementalRoads } from './useViewportMeshes';

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

  // Regression (first load / geoz): the per-road buffers can be empty on the
  // first solid frame (cache/tessellation race) leaving roads blank until a
  // wire→solid toggle. Until a merged frame has seeded the geometry, render
  // every road through the proven merged path.
  it('falls back to merged when the registry is not yet live', () => {
    expect(shouldUseIncrementalRoads({ ...base, registryActive: false, changedRoadCount: 5 })).toBe(false);
    expect(shouldUseIncrementalRoads({ ...base, registryActive: false, changedRoadCount: 0 })).toBe(false);
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
