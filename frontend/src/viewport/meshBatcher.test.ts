import { describe, expect, it } from 'vitest';
import { batchMeshes, countDrawCalls } from './meshBatcher';

function makeMesh(count: number): { vertexBuffer: GPUBuffer; vertexCount: number } {
  return {
    vertexBuffer: {} as GPUBuffer,
    vertexCount: count,
  };
}

describe('batchMeshes', () => {
  it('returns empty array for empty input', () => {
    expect(batchMeshes([], 'basic')).toEqual([]);
  });

  it('groups all meshes with same pipeline into one batch', () => {
    const meshes = [makeMesh(10), makeMesh(20), makeMesh(30)];
    const batches = batchMeshes(meshes, 'basic');
    expect(batches).toHaveLength(1);
    expect(batches[0]!.meshes).toHaveLength(3);
  });

  it('batch count reduces draw calls vs individual mesh count', () => {
    const meshes = [makeMesh(10), makeMesh(20), makeMesh(30), makeMesh(40), makeMesh(50)];
    const batches = batchMeshes(meshes, 'basic');
    // Without batching: 5 individual draw calls
    // With batching: 1 batch = 1 draw call
    expect(countDrawCalls(batches)).toBe(1);
    expect(countDrawCalls(batches)).toBeLessThan(meshes.length);
  });

  it('countDrawCalls returns 0 for empty batches', () => {
    expect(countDrawCalls([])).toBe(0);
  });
});
