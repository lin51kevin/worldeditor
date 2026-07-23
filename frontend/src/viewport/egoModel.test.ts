import { describe, it, expect, afterEach, vi } from 'vitest';

import { buildEgoMeshVertices, loadEgoModelTemplate, resetEgoModelForTest } from './egoModel';
import type { EgoModelTemplate } from './egoModel';
import type { CaseActorBox } from '../plugins/npc-actors';

const STRIDE = 7;

/** A unit cube template centered at the origin (model corners ±1 on every axis). */
function unitCubeTemplate(): EgoModelTemplate {
  const corners: Array<[number, number, number]> = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ];
  const verts = new Float32Array(corners.length * STRIDE);
  corners.forEach((c, i) => {
    const o = i * STRIDE;
    verts[o] = c[0]; verts[o + 1] = c[1]; verts[o + 2] = c[2];
    verts[o + 3] = 0.4; verts[o + 4] = 0.5; verts[o + 5] = 0.6; verts[o + 6] = 1;
  });
  return {
    localVertices: verts,
    indices: new Uint32Array([0, 1, 2]),
    center: [0, 0, 0],
    nativeDim: [2, 2, 2],
  };
}

/** Planar/height bounds of an interleaved 7-float vertex buffer. */
function bounds(v: Float32Array) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < v.length; i += STRIDE) {
    minX = Math.min(minX, v[i]!); maxX = Math.max(maxX, v[i]!);
    minY = Math.min(minY, v[i + 1]!); maxY = Math.max(maxY, v[i + 1]!);
    minZ = Math.min(minZ, v[i + 2]!); maxZ = Math.max(maxZ, v[i + 2]!);
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

function egoBox(overrides: Partial<CaseActorBox> = {}): CaseActorBox {
  return {
    id: 'traj:ego',
    kind: 'element',
    position: [10, 20, 0.8],
    heading: 0,
    size: [4.5, 2, 1.6],
    color: [0.2, 0.5, 0.95, 1],
    ...overrides,
  };
}

describe('viewport/egoModel.buildEgoMeshVertices', () => {
  it('scales the model to the box size and centers it on the box position', () => {
    const v = buildEgoMeshVertices(unitCubeTemplate(), egoBox());
    const b = bounds(v);
    // Length (+X), width (+Y), height (+Z) spans match the box size.
    expect(b.maxX - b.minX).toBeCloseTo(4.5, 5);
    expect(b.maxY - b.minY).toBeCloseTo(2, 5);
    expect(b.maxZ - b.minZ).toBeCloseTo(1.6, 5);
    // Centered on the box position.
    expect((b.minX + b.maxX) / 2).toBeCloseTo(10, 5);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(20, 5);
    expect((b.minZ + b.maxZ) / 2).toBeCloseTo(0.8, 5);
  });

  it('subtracts the scene origin from the box center', () => {
    const v = buildEgoMeshVertices(unitCubeTemplate(), egoBox(), [1, 2, 0]);
    const b = bounds(v);
    expect((b.minX + b.maxX) / 2).toBeCloseTo(9, 5);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(18, 5);
    expect((b.minZ + b.maxZ) / 2).toBeCloseTo(0.8, 5);
  });

  it('rotates the length axis into Y at 90° heading', () => {
    const v = buildEgoMeshVertices(unitCubeTemplate(), egoBox({ heading: Math.PI / 2 }));
    const b = bounds(v);
    // After a 90° yaw the length (4.5) spans Y and the width (2) spans X.
    expect(b.maxY - b.minY).toBeCloseTo(4.5, 5);
    expect(b.maxX - b.minX).toBeCloseTo(2, 5);
  });

  it('preserves the template vertex colors', () => {
    const v = buildEgoMeshVertices(unitCubeTemplate(), egoBox());
    expect(v[3]).toBeCloseTo(0.4, 6);
    expect(v[4]).toBeCloseTo(0.5, 6);
    expect(v[5]).toBeCloseTo(0.6, 6);
    expect(v[6]).toBeCloseTo(1, 6);
  });
});

describe('viewport/egoModel.loadEgoModelTemplate', () => {
  afterEach(() => {
    resetEgoModelForTest();
    vi.unstubAllGlobals();
  });

  it('resolves to null when the asset fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    expect(await loadEgoModelTemplate()).toBeNull();
  });

  it('resolves to null when the response is not a valid GLB', async () => {
    const fakeBytes = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(fakeBytes.buffer),
    }));
    expect(await loadEgoModelTemplate()).toBeNull();
  });

  it('caches the result on subsequent calls', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const first = await loadEgoModelTemplate();
    expect(first).toBeNull();
    // After reset, a new call can proceed
    resetEgoModelForTest();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const second = await loadEgoModelTemplate();
    expect(second).toBeNull();
  });

  it('deduplicates concurrent loads', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal('fetch', fetchFn);
    const p1 = loadEgoModelTemplate();
    const p2 = loadEgoModelTemplate();
    expect(p1).toBe(p2); // same promise
    await p1;
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
