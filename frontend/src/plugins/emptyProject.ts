import type { Project } from '../services/platform';

/** Create an empty project stub — used by placeholder Phase 3 plugins. */
export function createEmptyProject(name = 'Import'): Project {
  return {
    name,
    header: {
      rev_major: 1, rev_minor: 6,
      name: '', date: '',
      north: 0, south: 0, east: 0, west: 0,
      geo_reference: null,
    },
    roads: [],
    junctions: [],
    signals: [],
    objects: [],
  };
}
