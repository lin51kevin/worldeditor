import { describe, expect, it, vi } from 'vitest';
import {
  applyRoadMeshUpdate,
  collectRoadMeshes,
  combineRegistryVertices,
  createRoadMeshRegistry,
  disposeRoadMeshRegistry,
  getRoadMeshRegistryStats,
} from './roadMeshRegistry';

interface MockBuffer {
  id: number;
  size: number;
  destroyed: boolean;
  destroy: () => void;
}

function makeMockDevice() {
  const created: MockBuffer[] = [];
  const writes: Array<{ buffer: MockBuffer; verts: Float32Array }> = [];
  let nextId = 0;
  const device = {
    createBuffer: vi.fn((desc: { size: number }) => {
      const buf: MockBuffer = {
        id: nextId++,
        size: desc.size,
        destroyed: false,
        destroy: vi.fn(function (this: MockBuffer) {
          this.destroyed = true;
        }),
      };
      created.push(buf);
      return buf;
    }),
    queue: {
      writeBuffer: vi.fn(
        (buffer: MockBuffer, _off: number, data: ArrayBuffer, byteOffset = 0, byteLength?: number) => {
          const len = byteLength === undefined ? data.byteLength - byteOffset : byteLength;
          writes.push({ buffer, verts: new Float32Array(data.slice(byteOffset, byteOffset + len)) });
        },
      ),
    },
  };
  return { device: device as unknown as GPUDevice, created, writes };
}

/** 7 floats per vertex. Builds `count` vertices all set to `fill`. */
function verts(count: number, fill: number): Float32Array {
  return new Float32Array(count * 7).fill(fill);
}

describe('roadMeshRegistry', () => {
  it('creates a buffer and uploads data for each rebuilt road', () => {
    const { device, created, writes } = makeMockDevice();
    const registry = createRoadMeshRegistry();

    const meshes = applyRoadMeshUpdate(device, registry, {
      rebuilt: new Map([
        ['road-0', verts(2, 1)],
        ['road-1', verts(3, 2)],
      ]),
      removed: [],
    });

    expect(created).toHaveLength(2);
    expect(writes).toHaveLength(2);
    expect(meshes).toHaveLength(2);
    expect(meshes.map((m) => m.vertexCount)).toEqual([2, 3]);
    expect(registry.segments.size).toBe(2);
  });

  it('keeps unchanged road buffers without re-uploading', () => {
    const { device, writes } = makeMockDevice();
    const registry = createRoadMeshRegistry();

    applyRoadMeshUpdate(device, registry, {
      rebuilt: new Map([
        ['road-0', verts(2, 1)],
        ['road-1', verts(2, 2)],
      ]),
      removed: [],
    });
    const writesAfterFirst = writes.length;
    const road1BufferId = (registry.segments.get('road-1')!.vertexBuffer as unknown as MockBuffer).id;

    // Second update only rebuilds road-0 → road-1 must be untouched.
    applyRoadMeshUpdate(device, registry, {
      rebuilt: new Map([['road-0', verts(4, 9)]]),
      removed: [],
    });

    // Only one additional writeBuffer (for road-0).
    expect(writes.length).toBe(writesAfterFirst + 1);
    expect((registry.segments.get('road-1')!.vertexBuffer as unknown as MockBuffer).id).toBe(road1BufferId);
    expect(registry.segments.get('road-0')!.vertexCount).toBe(4);
  });

  it('destroys and drops removed road buffers', () => {
    const { device } = makeMockDevice();
    const registry = createRoadMeshRegistry();

    applyRoadMeshUpdate(device, registry, {
      rebuilt: new Map([
        ['road-0', verts(2, 1)],
        ['road-1', verts(2, 2)],
      ]),
      removed: [],
    });
    const removedBuffer = registry.segments.get('road-1')!.vertexBuffer as unknown as MockBuffer;

    const meshes = applyRoadMeshUpdate(device, registry, {
      rebuilt: new Map(),
      removed: ['road-1'],
    });

    expect(removedBuffer.destroyed).toBe(true);
    expect(registry.segments.has('road-1')).toBe(false);
    expect(meshes).toHaveLength(1);
  });

  it('treats an empty rebuilt array as a removal', () => {
    const { device } = makeMockDevice();
    const registry = createRoadMeshRegistry();

    applyRoadMeshUpdate(device, registry, {
      rebuilt: new Map([['road-0', verts(2, 1)]]),
      removed: [],
    });
    expect(registry.segments.has('road-0')).toBe(true);

    applyRoadMeshUpdate(device, registry, {
      rebuilt: new Map([['road-0', new Float32Array(0)]]),
      removed: [],
    });
    expect(registry.segments.has('road-0')).toBe(false);
  });

  it('appends the extras mesh last and replaces it on update', () => {
    const { device } = makeMockDevice();
    const registry = createRoadMeshRegistry();

    const meshes = applyRoadMeshUpdate(device, registry, {
      rebuilt: new Map([['road-0', verts(2, 1)]]),
      removed: [],
      extras: verts(5, 7),
    });

    expect(meshes).toHaveLength(2);
    expect(meshes[meshes.length - 1]!.vertexCount).toBe(5);

    // Updating extras to empty drops it.
    const meshes2 = applyRoadMeshUpdate(device, registry, {
      rebuilt: new Map(),
      removed: [],
      extras: new Float32Array(0),
    });
    expect(meshes2).toHaveLength(1);
    expect(registry.extras).toBeNull();
  });

  it('leaves extras untouched when the field is omitted', () => {
    const { device } = makeMockDevice();
    const registry = createRoadMeshRegistry();

    applyRoadMeshUpdate(device, registry, {
      rebuilt: new Map([['road-0', verts(2, 1)]]),
      removed: [],
      extras: verts(3, 4),
    });
    expect(registry.extras).not.toBeNull();

    applyRoadMeshUpdate(device, registry, {
      rebuilt: new Map([['road-0', verts(2, 5)]]),
      removed: [],
    });
    expect(registry.extras).not.toBeNull();
    expect(registry.extras!.vertexCount).toBe(3);
  });

  it('combines segment and extras vertices in order', () => {
    const { device } = makeMockDevice();
    const registry = createRoadMeshRegistry();

    applyRoadMeshUpdate(device, registry, {
      rebuilt: new Map([
        ['road-0', verts(1, 1)],
        ['road-1', verts(1, 2)],
      ]),
      removed: [],
      extras: verts(1, 3),
    });

    const combined = combineRegistryVertices(registry);
    expect(combined.length).toBe(3 * 7);
    expect(combined[0]).toBe(1);
    expect(combined[7]).toBe(2);
    expect(combined[14]).toBe(3);
  });

  it('reports road and extras counts separately for diagnostics', () => {
    const { device } = makeMockDevice();
    const registry = createRoadMeshRegistry();

    const meshes = applyRoadMeshUpdate(device, registry, {
      rebuilt: new Map([
        ['road-0', verts(2, 1)],
        ['road-1', verts(4, 2)],
      ]),
      removed: [],
      extras: verts(3, 3),
    });

    expect(meshes).toHaveLength(3);
    expect(getRoadMeshRegistryStats(registry)).toEqual({
      roadCount: 2,
      roadVertexCount: 6,
      extrasVertexCount: 3,
      totalVertexCount: 9,
    });
  });

  it('disposes all buffers and clears the registry', () => {
    const { device } = makeMockDevice();
    const registry = createRoadMeshRegistry();

    applyRoadMeshUpdate(device, registry, {
      rebuilt: new Map([['road-0', verts(2, 1)]]),
      removed: [],
      extras: verts(2, 2),
    });
    const segBuf = registry.segments.get('road-0')!.vertexBuffer as unknown as MockBuffer;
    const extraBuf = registry.extras!.vertexBuffer as unknown as MockBuffer;

    disposeRoadMeshRegistry(registry);

    expect(segBuf.destroyed).toBe(true);
    expect(extraBuf.destroyed).toBe(true);
    expect(registry.segments.size).toBe(0);
    expect(registry.extras).toBeNull();
    expect(collectRoadMeshes(registry)).toHaveLength(0);
  });
});
