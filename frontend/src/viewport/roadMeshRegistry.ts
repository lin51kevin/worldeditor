/**
 * Per-road GPU buffer registry for incremental road-surface upload.
 *
 * The merged upload path (`uploadMeshData`) packs every road, signal and object
 * into a single GPU buffer that must be fully rebuilt whenever any road changes.
 * During interactive edits this re-uploads (and re-tessellates) geometry that did
 * not change. This registry keeps one GPU buffer per road so an edit only touches
 * the affected road's buffer, while signals + objects share a single "extras"
 * buffer drawn after the roads.
 *
 * All functions are pure with respect to renderer state and take an explicit
 * `GPUDevice`, mirroring `rendererResources.ts`, so the buffer lifecycle can be
 * unit-tested with a mocked device.
 */
import type { RenderableMesh } from './markerRenderer';
import { getOrCreateBuffer } from './rendererResources';

const FLOATS_PER_VERTEX = 7;

/** A single road's GPU buffer plus a CPU copy kept for fit/zoom recombination. */
interface RoadMeshSegment extends RenderableMesh {
  /** CPU-side vertices (7 floats/vertex), retained so the full scene bounds can be
   *  recomputed for zoom-to-fit without re-querying WASM. */
  verts: Float32Array;
}

/** Owns all road-surface GPU buffers. Single source of truth for the road layer. */
export interface RoadMeshRegistry {
  /** road id → its dedicated mesh. Insertion order is the draw order. */
  segments: Map<string, RoadMeshSegment>;
  /** Combined signals + objects mesh, drawn after all road segments. */
  extras: RoadMeshSegment | null;
}

export interface RoadMeshRegistryStats {
  roadCount: number;
  roadVertexCount: number;
  extrasVertexCount: number;
  totalVertexCount: number;
}

/** An incremental change to apply to a {@link RoadMeshRegistry}. */
export interface RoadMeshIncrementalUpdate {
  /** road id → new vertices. An empty array drops that road. */
  rebuilt: Map<string, Float32Array>;
  /** road ids whose buffers should be destroyed. */
  removed: Iterable<string>;
  /** When provided, replaces the extras buffer; an empty array drops it.
   *  When omitted, the existing extras buffer is left untouched. */
  extras?: Float32Array;
}

/** Create an empty registry. */
export function createRoadMeshRegistry(): RoadMeshRegistry {
  return { segments: new Map(), extras: null };
}

function writeSegment(
  device: GPUDevice,
  existing: RoadMeshSegment | null,
  verts: Float32Array,
): RoadMeshSegment {
  const buffer = getOrCreateBuffer(device, existing?.vertexBuffer, verts.byteLength);
  device.queue.writeBuffer(buffer, 0, verts.buffer, verts.byteOffset, verts.byteLength);
  return { vertexBuffer: buffer, vertexCount: verts.length / FLOATS_PER_VERTEX, verts };
}

/**
 * Apply an incremental update and return the flat draw list (road segments
 * followed by the extras mesh). Unchanged roads keep their existing buffers and
 * are not re-uploaded.
 */
export function applyRoadMeshUpdate(
  device: GPUDevice,
  registry: RoadMeshRegistry,
  update: RoadMeshIncrementalUpdate,
): RenderableMesh[] {
  for (const [id, verts] of update.rebuilt) {
    const existing = registry.segments.get(id) ?? null;
    if (verts.length === 0) {
      if (existing) {
        existing.vertexBuffer.destroy();
        registry.segments.delete(id);
      }
      continue;
    }
    registry.segments.set(id, writeSegment(device, existing, verts));
  }

  for (const id of update.removed) {
    const existing = registry.segments.get(id);
    if (existing) {
      existing.vertexBuffer.destroy();
      registry.segments.delete(id);
    }
  }

  if (update.extras !== undefined) {
    if (update.extras.length === 0) {
      if (registry.extras) {
        registry.extras.vertexBuffer.destroy();
        registry.extras = null;
      }
    } else {
      registry.extras = writeSegment(device, registry.extras, update.extras);
    }
  }

  return collectRoadMeshes(registry);
}

/** Flatten the registry into a draw list: road segments first, extras last. */
export function collectRoadMeshes(registry: RoadMeshRegistry): RenderableMesh[] {
  const meshes: RenderableMesh[] = [];
  for (const segment of registry.segments.values()) {
    meshes.push({ vertexBuffer: segment.vertexBuffer, vertexCount: segment.vertexCount });
  }
  if (registry.extras) {
    meshes.push({ vertexBuffer: registry.extras.vertexBuffer, vertexCount: registry.extras.vertexCount });
  }
  return meshes;
}

/** Return road/extras counts separately so diagnostics don't confuse extras
 *  with road segments. */
export function getRoadMeshRegistryStats(registry: RoadMeshRegistry): RoadMeshRegistryStats {
  let roadVertexCount = 0;
  for (const segment of registry.segments.values()) {
    roadVertexCount += segment.vertexCount;
  }
  const extrasVertexCount = registry.extras?.vertexCount ?? 0;
  return {
    roadCount: registry.segments.size,
    roadVertexCount,
    extrasVertexCount,
    totalVertexCount: roadVertexCount + extrasVertexCount,
  };
}

/** Concatenate all CPU-side vertices (segments then extras) for zoom-to-fit bounds. */
export function combineRegistryVertices(registry: RoadMeshRegistry): Float32Array {
  let total = 0;
  for (const segment of registry.segments.values()) total += segment.verts.length;
  if (registry.extras) total += registry.extras.verts.length;
  if (total === 0) return new Float32Array(0);

  const combined = new Float32Array(total);
  let offset = 0;
  for (const segment of registry.segments.values()) {
    combined.set(segment.verts, offset);
    offset += segment.verts.length;
  }
  if (registry.extras) combined.set(registry.extras.verts, offset);
  return combined;
}

/** Destroy every buffer the registry owns and reset it to empty. */
export function disposeRoadMeshRegistry(registry: RoadMeshRegistry): void {
  for (const segment of registry.segments.values()) {
    segment.vertexBuffer.destroy();
  }
  registry.segments.clear();
  if (registry.extras) {
    registry.extras.vertexBuffer.destroy();
    registry.extras = null;
  }
}
