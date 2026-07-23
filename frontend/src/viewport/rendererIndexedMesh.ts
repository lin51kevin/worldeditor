/**
 * Indexed ground/ego mesh management — extracted from renderer.ts to keep the
 * ViewportRenderer class under the file-size budget.
 *
 * These functions operate on the renderer instance via the
 * {@link RendererIndexedMeshInternals} structural interface (the renderer passes
 * `this`). All members listed here are owned by ViewportRenderer; this module
 * only orchestrates the indexed vertex + index buffer lifecycle.
 */
import { getOrCreateBuffer } from './rendererResources';

/** An indexed, vertex-colored triangle mesh with its own GPU buffers. */
export interface IndexedMesh {
  vertexBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  indexCount: number;
}

/** Subset of ViewportRenderer state needed for indexed-mesh management. */
export interface RendererIndexedMeshInternals {
  device: GPUDevice;
  groundMesh: IndexedMesh | null;
  egoMesh: IndexedMesh | null;
  markSceneDirty(): void;
}

/**
 * Upload an indexed, vertex-colored ground surface mesh (7 floats per vertex:
 * x,y,z,r,g,b,a + a 32-bit index buffer), e.g. a logsim `road_mesh.glb`.
 * Rendered as an opaque triangle surface with the shared basic pipeline.
 * Passing empty data clears the current ground mesh.
 */
export function uploadGroundMeshIndexed(
  r: RendererIndexedMeshInternals,
  vertexData: Float32Array,
  indices: Uint32Array,
): void {
  // Replace any existing ground mesh buffers.
  r.groundMesh?.vertexBuffer.destroy();
  r.groundMesh?.indexBuffer.destroy();
  r.groundMesh = null;

  if (vertexData.length === 0 || indices.length === 0) {
    r.markSceneDirty();
    return;
  }

  const vertexBuffer = r.device.createBuffer({
    size: vertexData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  r.device.queue.writeBuffer(
    vertexBuffer,
    0,
    vertexData.buffer,
    vertexData.byteOffset,
    vertexData.byteLength,
  );

  // Index buffers must be 4-byte aligned; Uint32 data already satisfies this.
  const indexBuffer = r.device.createBuffer({
    size: indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  r.device.queue.writeBuffer(
    indexBuffer,
    0,
    indices.buffer,
    indices.byteOffset,
    indices.byteLength,
  );

  r.groundMesh = { vertexBuffer, indexBuffer, indexCount: indices.length };
  r.markSceneDirty();
}

/** Remove the uploaded ground surface mesh. */
export function clearGroundMesh(r: RendererIndexedMeshInternals): void {
  if (!r.groundMesh) return;
  r.groundMesh.vertexBuffer.destroy();
  r.groundMesh.indexBuffer.destroy();
  r.groundMesh = null;
  r.markSceneDirty();
}

/**
 * Upload an indexed, vertex-colored ego vehicle mesh (7 floats per vertex:
 * x,y,z,r,g,b,a + a 32-bit index buffer), e.g. a transformed `ego.glb`.
 * Rendered as an opaque triangle model with the shared basic pipeline so the
 * ego actor is visually distinct from the translucent opponent boxes.
 * Passing empty data clears the current ego mesh.
 */
export function uploadEgoMeshIndexed(
  r: RendererIndexedMeshInternals,
  vertexData: Float32Array,
  indices: Uint32Array,
): void {
  if (vertexData.length === 0 || indices.length === 0) {
    r.egoMesh?.vertexBuffer.destroy();
    r.egoMesh?.indexBuffer.destroy();
    r.egoMesh = null;
    r.markSceneDirty();
    return;
  }

  // Playback changes only transformed vertices; keep compatible buffers alive
  // instead of allocating and destroying GPU resources on every frame.
  const vertexBuffer = getOrCreateBuffer(
    r.device,
    r.egoMesh?.vertexBuffer,
    vertexData.byteLength,
  );
  r.device.queue.writeBuffer(
    vertexBuffer,
    0,
    vertexData.buffer,
    vertexData.byteOffset,
    vertexData.byteLength,
  );

  const indexBuffer = getOrCreateBuffer(
    r.device,
    r.egoMesh?.indexBuffer,
    indices.byteLength,
    GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  );
  r.device.queue.writeBuffer(
    indexBuffer,
    0,
    indices.buffer,
    indices.byteOffset,
    indices.byteLength,
  );

  r.egoMesh = { vertexBuffer, indexBuffer, indexCount: indices.length };
  r.markSceneDirty();
}

/** Remove the uploaded ego vehicle mesh. */
export function clearEgoMesh(r: RendererIndexedMeshInternals): void {
  if (!r.egoMesh) return;
  r.egoMesh.vertexBuffer.destroy();
  r.egoMesh.indexBuffer.destroy();
  r.egoMesh = null;
  r.markSceneDirty();
}
