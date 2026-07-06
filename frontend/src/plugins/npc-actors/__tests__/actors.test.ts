import { describe, it, expect } from 'vitest';

import { buildBoxVertices, buildPathVertices } from '../actorGeometry';
import { pickActorAt } from '../actorPicker';
import { CaseActorLayer } from '../actorLayer';
import { ACTOR_VERTEX_STRIDE, CaseActorBox } from '../actorTypes';
import {
  buildSampleActors,
  buildSampleSegments,
  spawnSampleActors,
  clearSampleActors,
  DebugActorTarget,
} from '../actorDebug';

const box = (over: Partial<CaseActorBox> = {}): CaseActorBox => ({
  id: 'el:1',
  kind: 'element',
  position: [10, 20, 0.8],
  heading: 0,
  size: [4, 2, 1.6],
  color: [1, 0, 0, 1],
  ...over,
});

describe('npc-actors geometry', () => {
  it('emits fill + 12 edge bars for boxed actors, fill-only for waypoints', () => {
    // waypoint: single solid cube = 36 verts.
    expect(buildBoxVertices([box({ kind: 'waypoint' })]).length).toBe(36 * ACTOR_VERTEX_STRIDE);
    // element: fill (36) + 12 edge bars (12 × 36) = 13 × 36 verts.
    expect(buildBoxVertices([box({ kind: 'element' })]).length).toBe(13 * 36 * ACTOR_VERTEX_STRIDE);
  });

  it('centers box vertices on the box position', () => {
    const v = buildBoxVertices([box({ kind: 'waypoint', position: [10, 20, 5], heading: 0, size: [4, 2, 2] })]);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < v.length; i += ACTOR_VERTEX_STRIDE) {
      minX = Math.min(minX, v[i]!); maxX = Math.max(maxX, v[i]!);
      minY = Math.min(minY, v[i + 1]!); maxY = Math.max(maxY, v[i + 1]!);
      minZ = Math.min(minZ, v[i + 2]!); maxZ = Math.max(maxZ, v[i + 2]!);
    }
    expect((minX + maxX) / 2).toBeCloseTo(10, 5);
    expect((minY + maxY) / 2).toBeCloseTo(20, 5);
    expect((minZ + maxZ) / 2).toBeCloseTo(5, 5);
    expect(maxX - minX).toBeCloseTo(4, 5);
    expect(maxY - minY).toBeCloseTo(2, 5);
    expect(maxZ - minZ).toBeCloseTo(2, 5);
  });

  it('rotates box extents by heading (90° swaps X/Y footprint)', () => {
    const v = buildBoxVertices([box({ kind: 'waypoint', position: [0, 0, 0], heading: Math.PI / 2, size: [4, 2, 2] })]);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < v.length; i += ACTOR_VERTEX_STRIDE) {
      minX = Math.min(minX, v[i]!); maxX = Math.max(maxX, v[i]!);
      minY = Math.min(minY, v[i + 1]!); maxY = Math.max(maxY, v[i + 1]!);
    }
    expect(maxX - minX).toBeCloseTo(2, 5); // length now along Y
    expect(maxY - minY).toBeCloseTo(4, 5);
  });

  it('builds 6 vertices per path segment and skips degenerate ones', () => {
    // one real segment + one zero-length segment
    const seg = new Float32Array([
      0, 0, 0, 1, 1, 1, 1, 10, 0, 0, 1, 1, 1, 1, // real
      5, 5, 0, 1, 1, 1, 1, 5, 5, 0, 1, 1, 1, 1, // degenerate
    ]);
    const v = buildPathVertices(seg, 0.5);
    expect(v.length).toBe(6 * ACTOR_VERTEX_STRIDE);
  });
});

describe('npc-actors picking', () => {
  it('hits a box when the point is inside its footprint', () => {
    expect(pickActorAt([box({ id: 'el:1' })], 10, 20)).toBe('el:1');
    expect(pickActorAt([box({ id: 'el:1' })], 100, 100)).toBeNull();
  });

  it('respects heading when testing the footprint', () => {
    // 4×2 box rotated 90° at origin: extends ±1 in X, ±2 in Y.
    const b = box({ id: 'el:1', position: [0, 0, 0], heading: Math.PI / 2, size: [4, 2, 2] });
    expect(pickActorAt([b], 0, 1.9)).toBe('el:1'); // inside rotated Y extent
    expect(pickActorAt([b], 1.5, 0)).toBeNull(); // outside rotated X extent
  });

  it('prefers the last (top-most) box on overlap', () => {
    const body = box({ id: 'el:1', position: [0, 0, 0], size: [10, 10, 2] });
    const handle = box({ id: 'wp:1:0', kind: 'waypoint', position: [0, 0, 0], size: [1, 1, 1] });
    expect(pickActorAt([body, handle], 0, 0)).toBe('wp:1:0');
  });
});

describe('CaseActorLayer facade', () => {
  it('produces vertices and resolves picking from stored state', () => {
    const layer = new CaseActorLayer();
    layer.setBoxes([box({ id: 'el:7', position: [3, 4, 0] })]);
    expect(layer.boxCount).toBe(1);
    expect(layer.boxVertices().length).toBe(13 * 36 * ACTOR_VERTEX_STRIDE);
    expect(layer.pickAt(3, 4)).toBe('el:7');
    layer.clear();
    expect(layer.boxCount).toBe(0);
    expect(layer.boxVertices().length).toBe(0);
    expect(layer.pickAt(3, 4)).toBeNull();
  });
});

describe('npc-actors debug helper', () => {
  it('builds sample actors (ego, car, ped, 3 waypoints) around the center', () => {
    const actors = buildSampleActors(100, 200);
    expect(actors.length).toBe(6);
    expect(actors.filter((a) => a.kind === 'waypoint').length).toBe(3);
    // Every actor sits near the requested center.
    for (const a of actors) {
      expect(Math.abs(a.position[0] - 100)).toBeLessThanOrEqual(20);
      expect(Math.abs(a.position[1] - 200)).toBeLessThanOrEqual(5);
    }
  });

  it('builds a non-empty sample trajectory as segment pairs', () => {
    const seg = buildSampleSegments(0, 0);
    // 6 segments × 14 floats.
    expect(seg.length).toBe(6 * 14);
  });

  it('spawn switches to 3D and uploads non-empty geometry; clear empties it', () => {
    const calls: { dim?: string; actor: number[]; path: number[]; renders: number } = {
      actor: [],
      path: [],
      renders: 0,
    };
    const target: DebugActorTarget = {
      setDimension: (d) => (calls.dim = d),
      uploadActorVertices: (v) => calls.actor.push(v.length),
      uploadPathVertices: (v) => calls.path.push(v.length),
      getGroundCenter: () => ({ x: 5, y: 5 }),
      render: () => (calls.renders += 1),
    };

    spawnSampleActors(target);
    expect(calls.dim).toBe('3d');
    expect(calls.actor[0]).toBeGreaterThan(0);
    expect(calls.path[0]).toBeGreaterThan(0);

    clearSampleActors(target);
    expect(calls.actor[calls.actor.length - 1]).toBe(0);
    expect(calls.path[calls.path.length - 1]).toBe(0);
    expect(calls.renders).toBeGreaterThanOrEqual(2);
  });
});
