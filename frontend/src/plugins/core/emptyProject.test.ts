import { describe, expect, it } from 'vitest';
import { createEmptyProject } from './emptyProject';

describe('createEmptyProject', () => {
  it('returns a valid Project with expected defaults', () => {
    expect(createEmptyProject()).toEqual({
      name: 'Import',
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
      roads: [],
      junctions: [],
      signals: [],
      objects: [],
    });
  });

  it('uses the provided name and returns fresh arrays for each project', () => {
    const first = createEmptyProject('First');
    const second = createEmptyProject('Second');

    first.roads.push({ id: 'road-1' } as never);

    expect(first.name).toBe('First');
    expect(second.name).toBe('Second');
    expect(second.roads).toEqual([]);
    expect(second.junctions).toEqual([]);
  });
});
