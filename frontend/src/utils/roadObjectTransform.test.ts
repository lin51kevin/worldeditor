import { describe, it, expect } from 'vitest';
import type { RoadObjectItem } from '../services/platform';
import {
  hasCornerFootprint,
  hasRoadFrameCorners,
  moveRoadObjectTo,
  replaceRoadObject,
  rotateRoadObjectTo,
  transformRoadObject,
} from './roadObjectTransform';

function makeObject(overrides: Partial<RoadObjectItem> = {}): RoadObjectItem {
  return {
    id: 'obj-1',
    object_type: 'Crosswalk',
    name: 'crosswalk',
    position: { x: 10, y: 2, z: 0.1, id: null },
    orientation: 0,
    hdg: 0,
    width: 4,
    height: 0,
    length: 3,
    corners: [],
    validity: null,
    ...overrides,
  };
}

/** Square outline centred on (10, 2) in absolute road-frame (s, t) coordinates. */
function roadFrameSquare(): RoadObjectItem {
  return makeObject({
    corner_type: 'Road',
    corners: [
      { x: 9, y: 1, z: 0, id: null },
      { x: 11, y: 1, z: 0, id: null },
      { x: 11, y: 3, z: 0, id: null },
      { x: 9, y: 3, z: 0, id: null },
    ],
  });
}

describe('hasRoadFrameCorners', () => {
  it('is true only for Road-frame corner lists', () => {
    expect(hasRoadFrameCorners(roadFrameSquare())).toBe(true);
    expect(hasRoadFrameCorners(makeObject({ corner_type: 'Local', corners: [{ x: 1, y: 1, z: 0, id: null }] }))).toBe(false);
    expect(hasRoadFrameCorners(makeObject({ corner_type: 'Road', corners: [] }))).toBe(false);
    expect(hasRoadFrameCorners(makeObject())).toBe(false);
  });
});

describe('hasCornerFootprint', () => {
  it('is true once at least two corners define the outline', () => {
    expect(hasCornerFootprint(makeObject())).toBe(false);
    expect(hasCornerFootprint(makeObject({ corners: [{ x: 0, y: 0, z: 0, id: null }] }))).toBe(false);
    expect(hasCornerFootprint(roadFrameSquare())).toBe(true);
  });
});

describe('moveRoadObjectTo', () => {
  it('translates road-frame corners along with the position', () => {
    const moved = moveRoadObjectTo(roadFrameSquare(), 20, -1);

    expect(moved.position.x).toBe(20);
    expect(moved.position.y).toBe(-1);
    expect(moved.corners.map((c) => [c.x, c.y])).toEqual([
      [19, -2],
      [21, -2],
      [21, 0],
      [19, 0],
    ]);
  });

  it('leaves local corners untouched so they are not translated twice', () => {
    const local = makeObject({
      corner_type: 'Local',
      corners: [{ x: -1, y: -1, z: 0, id: null }, { x: 1, y: 1, z: 0, id: null }],
    });

    const moved = moveRoadObjectTo(local, 30, 5);

    expect(moved.position.x).toBe(30);
    expect(moved.corners).toBe(local.corners);
  });

  it('preserves z and keeps unrelated fields intact', () => {
    const moved = moveRoadObjectTo(roadFrameSquare(), 12, 2);

    expect(moved.position.z).toBe(0.1);
    expect(moved.corners.every((c) => c.z === 0)).toBe(true);
    expect(moved.name).toBe('crosswalk');
  });

  it('returns the same reference for a no-op move', () => {
    const obj = roadFrameSquare();
    expect(moveRoadObjectTo(obj, obj.position.x, obj.position.y)).toBe(obj);
  });
});

describe('rotateRoadObjectTo', () => {
  it('rotates road-frame corners about the object position', () => {
    const rotated = rotateRoadObjectTo(roadFrameSquare(), Math.PI / 2);

    expect(rotated.hdg).toBeCloseTo(Math.PI / 2, 10);
    expect(rotated.position).toEqual({ x: 10, y: 2, z: 0.1, id: null });
    // (9,1) is at offset (-1,-1); rotating +90° gives (1,-1) → (11, 1).
    expect(rotated.corners[0].x).toBeCloseTo(11, 10);
    expect(rotated.corners[0].y).toBeCloseTo(1, 10);
    expect(rotated.corners[2].x).toBeCloseTo(9, 10);
    expect(rotated.corners[2].y).toBeCloseTo(3, 10);
  });

  it('only updates hdg when corners are local or absent', () => {
    const local = makeObject({
      corner_type: 'Local',
      corners: [{ x: -1, y: -1, z: 0, id: null }],
    });

    const rotated = rotateRoadObjectTo(local, 1.2);

    expect(rotated.hdg).toBe(1.2);
    expect(rotated.corners).toBe(local.corners);
  });

  it('rotates relative to the current heading, not from zero', () => {
    const start = rotateRoadObjectTo(roadFrameSquare(), Math.PI / 4);
    const full = rotateRoadObjectTo(start, Math.PI / 2);
    const direct = rotateRoadObjectTo(roadFrameSquare(), Math.PI / 2);

    expect(full.corners[0].x).toBeCloseTo(direct.corners[0].x, 10);
    expect(full.corners[0].y).toBeCloseTo(direct.corners[0].y, 10);
  });

  it('returns the same reference for a no-op rotation', () => {
    const obj = roadFrameSquare();
    expect(rotateRoadObjectTo(obj, obj.hdg)).toBe(obj);
  });
});

describe('transformRoadObject', () => {
  it('applies the move before the rotation so corners orbit the new position', () => {
    const result = transformRoadObject(roadFrameSquare(), 20, 2, Math.PI / 2);

    expect(result.position.x).toBe(20);
    expect(result.hdg).toBeCloseTo(Math.PI / 2, 10);
    expect(result.corners[0].x).toBeCloseTo(21, 10);
    expect(result.corners[0].y).toBeCloseTo(1, 10);
  });
});

describe('replaceRoadObject', () => {
  it('replaces only the matching object', () => {
    const road = {
      id: 'road-1',
      objects: [makeObject({ id: 'a' }), makeObject({ id: 'b' })],
    };

    const next = replaceRoadObject(road, 'b', (obj) => moveRoadObjectTo(obj, 50, 0));

    expect(next).not.toBe(road);
    expect(next.objects[0]).toBe(road.objects[0]);
    expect(next.objects[1].position.x).toBe(50);
    expect(road.objects[1].position.x).toBe(10);
  });

  it('returns the same road when the object is absent or the list is missing', () => {
    const road = { id: 'road-1', objects: [makeObject({ id: 'a' })] };
    expect(replaceRoadObject(road, 'missing', (obj) => obj)).toBe(road);

    const empty = { id: 'road-2' } as { id: string; objects?: RoadObjectItem[] };
    expect(replaceRoadObject(empty, 'a', (obj) => obj)).toBe(empty);
  });
});
