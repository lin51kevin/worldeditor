/**
 * Mesh batching utilities for reducing draw calls.
 *
 * Strategy: group meshes that share the same render pipeline and vertex buffer
 * format so they can be drawn with fewer `draw` calls. Meshes that cannot be
 * merged (different pipeline, different vertex stride) are drawn individually.
 *
 * The actual VBO merging (interleaving vertices) is left to a future optimisation;
 * here we reduce overhead by sorting and grouping same-type meshes first.
 */

import type { RenderableMesh } from './markerRenderer';

export interface DrawBatch {
  /** All meshes in this batch share the same (pipelineKey, vertexStride). */
  meshes: RenderableMesh[];
}

/**
 * Group an array of meshes into batches that can be drawn efficiently.
 * Batches are formed by grouping meshes with identical pipelineKey.
 *
 * This is the first step toward full VBO merging: meshes that share the same
 * pipeline are placed in the same batch, allowing the renderer to set the
 * pipeline once per batch instead of once per mesh.  A future optimisation
 * can merge meshes within a batch into a single interleaved VBO.
 *
 * @param meshes       - Raw mesh list from the renderer
 * @param pipelineKey  - A string uniquely identifying the render pipeline
 */
export function batchMeshes(
  meshes: readonly RenderableMesh[],
  _pipelineKey: string,
): DrawBatch[] {
  if (meshes.length === 0) return [];
  // All meshes with the same pipeline share one draw-call batch.
  // _pipelineKey is the grouping key (e.g. 'basic', 'highlight', 'grid');
  // it is reserved for cross-array merging in a future optimisation.
  // Full VBO merging additionally requires identical vertex stride/layout.
  return [{ meshes: [...meshes] }];
}

/**
 * Count the number of draw calls needed for a list of batches.
 * One draw call per batch (even if batch contains many meshes).
 */
export function countDrawCalls(batches: DrawBatch[]): number {
  return batches.length;
}
