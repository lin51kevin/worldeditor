/**
 * Point-cloud buffer management — extracted from renderer.ts to keep the
 * ViewportRenderer class under the file-size budget.
 *
 * These functions operate on the renderer instance via the
 * {@link RendererPointCloudInternals} structural interface (the renderer passes
 * `this`). All members listed here are owned by ViewportRenderer; this module
 * only orchestrates upload/caching of the road + actor point-cloud buffers.
 */
import { uploadMeshData } from './rendererResources';
import { createPointCloudPipeline as createPointCloudPipelineFn } from './pipelineFactory';
import type { RenderableMesh } from './markerRenderer';

/** Subset of ViewportRenderer state needed for point-cloud management. */
export interface RendererPointCloudInternals {
  device: GPUDevice;
  format: GPUTextureFormat;
  basicShaderModule: GPUShaderModule;
  basicBindGroupLayout: GPUBindGroupLayout;
  pointCloudPipeline: GPURenderPipeline | null;
  pointCloudBuffersByMode: Map<string, RenderableMesh[]>;
  pointCloudMeshes: RenderableMesh[];
  activePointCloudMode: string | null;
  actorPointCloudMeshes: RenderableMesh[];
  markSceneDirty(): void;
}

/** Lazily build the shared point-cloud pipeline on first use. */
function ensurePointCloudPipeline(r: RendererPointCloudInternals): void {
  if (!r.pointCloudPipeline) {
    r.pointCloudPipeline = createPointCloudPipelineFn(
      r.device,
      r.format,
      r.basicShaderModule,
      r.basicBindGroupLayout,
    );
  }
}

/** Upload point cloud vertex data (7 floats per vertex: x,y,z,r,g,b,a). Rendered
 *  as point-list. Passing empty data clears the active cloud AND every cached
 *  per-color-mode buffer. */
export function uploadPointCloudVertices(
  r: RendererPointCloudInternals,
  vertexData: Float32Array,
): void {
  if (vertexData.length === 0) {
    if (r.pointCloudBuffersByMode.size === 0 && r.pointCloudMeshes.length === 0) return;
    clearPointCloudModeBuffers(r);
    r.markSceneDirty();
    return;
  }
  // Legacy single-buffer callers route through the mode cache under a fixed key.
  uploadPointCloudVerticesForMode(r, '__single__', vertexData);
}

/** Dispose every cached per-color-mode point-cloud buffer and clear the active selection. */
export function clearPointCloudModeBuffers(r: RendererPointCloudInternals): void {
  for (const meshes of r.pointCloudBuffersByMode.values()) {
    for (const m of meshes) {
      m.vertexBuffer.destroy();
    }
  }
  r.pointCloudBuffersByMode.clear();
  r.pointCloudMeshes = [];
  r.activePointCloudMode = null;
}

/** Whether a GPU buffer for `mode` is already uploaded for the current cloud. */
export function hasPointCloudColorMode(r: RendererPointCloudInternals, mode: string): boolean {
  const meshes = r.pointCloudBuffersByMode.get(mode);
  return !!meshes && meshes.length > 0;
}

/** Re-bind the cached buffer for `mode` as the drawn cloud (no upload). Returns
 *  false if that mode has not been uploaded yet. */
export function showPointCloudColorMode(r: RendererPointCloudInternals, mode: string): boolean {
  const meshes = r.pointCloudBuffersByMode.get(mode);
  if (!meshes || meshes.length === 0) return false;
  if (r.activePointCloudMode === mode && r.pointCloudMeshes === meshes) return true;
  r.activePointCloudMode = mode;
  r.pointCloudMeshes = meshes;
  r.markSceneDirty();
  return true;
}

/** Upload point-cloud vertices into the cache slot for `mode` and make it the
 *  drawn cloud. Subsequent switches to this mode re-bind it for free. */
export function uploadPointCloudVerticesForMode(
  r: RendererPointCloudInternals,
  mode: string,
  vertexData: Float32Array,
): void {
  if (vertexData.length === 0) return;
  ensurePointCloudPipeline(r);
  let meshes = r.pointCloudBuffersByMode.get(mode);
  if (!meshes) {
    meshes = [];
    r.pointCloudBuffersByMode.set(mode, meshes);
  }
  uploadMeshData(r.device, meshes, vertexData);
  r.activePointCloudMode = mode;
  r.pointCloudMeshes = meshes;
  r.markSceneDirty();
}

/**
 * Upload opponent (NPC) model point-cloud vertex data (7 floats per vertex:
 * x,y,z,r,g,b,a) into a SEPARATE buffer from the road cloud, so per-frame
 * opponent updates never re-upload the (large) static road mesh. Rendered as
 * point-list with the shared point-cloud pipeline.
 */
export function uploadActorPointCloudVertices(
  r: RendererPointCloudInternals,
  vertexData: Float32Array,
): void {
  if (vertexData.length === 0) {
    if (r.actorPointCloudMeshes.length === 0) return;
    for (const m of r.actorPointCloudMeshes) {
      m.vertexBuffer.destroy();
    }
    r.actorPointCloudMeshes = [];
    r.markSceneDirty();
    return;
  }
  ensurePointCloudPipeline(r);
  uploadMeshData(r.device, r.actorPointCloudMeshes, vertexData);
  r.markSceneDirty();
}
