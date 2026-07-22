/**
 * GPU buffer + texture resource helpers — extracted from renderer.ts.
 *
 * Pure functions taking an explicit GPUDevice so the ViewportRenderer class
 * stays within the file-size budget. No renderer state is captured here.
 */
import type { RenderableMesh } from './markerRenderer';

/** When a vertex buffer must grow, it is allocated as `requiredBytes × GPU_BUFFER_HEADROOM`. */
const GPU_BUFFER_HEADROOM = 2.0;
/** If `requiredBytes < bufferSize × GPU_BUFFER_SHRINK_THRESHOLD`, the buffer is reallocated. */
const GPU_BUFFER_SHRINK_THRESHOLD = 0.25;

/**
 * Reuse or allocate a GPU vertex buffer with a smart grow/shrink strategy.
 *
 * - **Grow:** If existing buffer is too small, allocate 2× required bytes for headroom.
 * - **Reuse:** If buffer fits (>= requiredBytes and >= 25% utilized), keep it.
 * - **Shrink:** If utilization drops below 25%, reallocate to 2× requiredBytes to
 *   release GPU memory. The 25% threshold avoids thrashing near power-of-two boundaries.
 */
export function getOrCreateBuffer(
  device: GPUDevice,
  existingBuffer: GPUBuffer | undefined,
  requiredBytes: number,
  usage: GPUBufferUsageFlags = GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
): GPUBuffer {
  if (existingBuffer) {
    const currentSize = existingBuffer.size;
    if (currentSize >= requiredBytes && requiredBytes >= currentSize * GPU_BUFFER_SHRINK_THRESHOLD) {
      // Buffer fits well — reuse
      return existingBuffer;
    }
    // Too small or too large — destroy and reallocate
    existingBuffer.destroy();
  }
  return device.createBuffer({
    size: Math.ceil(requiredBytes * GPU_BUFFER_HEADROOM),
    usage,
  });
}

/** Upload vertex data into a mesh array, reusing or reallocating the GPU buffer as needed. */
export function uploadMeshData(
  device: GPUDevice,
  meshes: RenderableMesh[],
  vertexData: Float32Array,
): void {
  const requiredBytes = vertexData.byteLength;
  const buffer = getOrCreateBuffer(device, meshes[0]?.vertexBuffer, requiredBytes);
  device.queue.writeBuffer(buffer, 0, vertexData.buffer, vertexData.byteOffset, vertexData.byteLength);

  // Destroy stale extra mesh entries
  for (let i = (meshes[0]?.vertexBuffer === buffer ? 1 : 0); i < meshes.length; i++) {
    meshes[i]!.vertexBuffer.destroy();
  }
  meshes.length = 0;
  meshes.push({
    vertexBuffer: buffer,
    vertexCount: vertexData.length / 7,
  });
}

/** Destroy all mesh buffers and clear the array. */
export function disposeMeshes(meshes: RenderableMesh[]): void {
  for (const m of meshes) {
    m.vertexBuffer.destroy();
  }
  meshes.length = 0;
}

/** Create the 4× MSAA depth texture sized to the viewport. */
export function createDepthTexture(device: GPUDevice, width: number, height: number): GPUTexture {
  return device.createTexture({
    size: [width, height],
    format: 'depth32float',
    sampleCount: 4,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
}

/** Create the 4× MSAA color resolve texture sized to the viewport. */
export function createMsaaTexture(
  device: GPUDevice,
  format: GPUTextureFormat,
  width: number,
  height: number,
): GPUTexture {
  return device.createTexture({
    size: [width, height],
    format,
    sampleCount: 4,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
}
