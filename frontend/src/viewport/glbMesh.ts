/**
 * Minimal GLB (binary glTF 2.0) triangle-mesh loader.
 *
 * Parses a `.glb` produced by tools such as trimesh into the renderer's
 * interleaved 7-float vertex layout (`x, y, z, r, g, b, a`) plus a 32-bit index
 * buffer, so a logsim ground surface (e.g. `road_mesh.glb`) can be drawn as a
 * vertex-colored triangle surface rather than a bare point cloud.
 *
 * Scope (deliberately small — only what our exporter emits):
 *   - Reads mesh 0, primitive 0 only.
 *   - Attributes: `POSITION` (VEC3 f32, required), `COLOR_0` (VEC3/VEC4,
 *     u8-normalized or f32, optional — defaults to light grey).
 *   - `indices` accessor (u8 / u16 / u32), widened to u32. Non-indexed
 *     primitives are given a trivial 0..N index range.
 *   - Node transforms: applies the world matrix of the node referencing the
 *     mesh (composed through the scene hierarchy) when present.
 *
 * Coordinates are passed through unchanged: our exporter keeps the source
 * Z-up frame (elevation on Z), so no glTF Y-up→Z-up swap is applied.
 */

/** glTF accessor component types. */
const COMPONENT_TYPE = {
  BYTE: 5120,
  UNSIGNED_BYTE: 5121,
  SHORT: 5122,
  UNSIGNED_SHORT: 5123,
  UNSIGNED_INT: 5125,
  FLOAT: 5126,
} as const;

/** Number of components per accessor `type`. */
const TYPE_COMPONENTS: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

/** Byte size of each glTF component type. */
const COMPONENT_BYTES: Record<number, number> = {
  [COMPONENT_TYPE.BYTE]: 1,
  [COMPONENT_TYPE.UNSIGNED_BYTE]: 1,
  [COMPONENT_TYPE.SHORT]: 2,
  [COMPONENT_TYPE.UNSIGNED_SHORT]: 2,
  [COMPONENT_TYPE.UNSIGNED_INT]: 4,
  [COMPONENT_TYPE.FLOAT]: 4,
};

const GLB_MAGIC = 0x46546c67; // 'glTF' little-endian
const CHUNK_TYPE_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_TYPE_BIN = 0x004e4942; // 'BIN\0'

/** Result of parsing a GLB triangle mesh. */
export interface GlbMeshResult {
  /** Interleaved vertex data: `x, y, z, r, g, b, a` per vertex (a in 0..1). */
  vertices: Float32Array;
  /** Triangle index buffer (32-bit). */
  indices: Uint32Array;
  /** Vertex count. */
  vertexCount: number;
  /** Planar bounds min `[x, y, z]`. */
  min: [number, number, number];
  /** Planar bounds max `[x, y, z]`. */
  max: [number, number, number];
}

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  normalized?: boolean;
  min?: number[];
  max?: number[];
}

interface GltfBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}

interface GltfNode {
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
}

interface GltfJson {
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  meshes?: Array<{ primitives: Array<{ attributes: Record<string, number>; indices?: number; mode?: number; material?: number }> }>;
  materials?: Array<{ pbrMetallicRoughness?: { baseColorFactor?: number[] } }>;
  nodes?: GltfNode[];
  scenes?: Array<{ nodes?: number[] }>;
  scene?: number;
}

/** Split a GLB blob into its glTF JSON and the binary buffer chunk. */
function splitGlb(bytes: Uint8Array): { json: GltfJson; bin: Uint8Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12 || view.getUint32(0, true) !== GLB_MAGIC) {
    throw new Error('Not a GLB file (bad magic)');
  }
  const version = view.getUint32(4, true);
  if (version !== 2) throw new Error(`Unsupported GLB version: ${version}`);

  let offset = 12;
  let json: GltfJson | null = null;
  let bin: Uint8Array | null = null;
  while (offset + 8 <= bytes.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;
    if (dataEnd > bytes.byteLength) break;
    if (chunkType === CHUNK_TYPE_JSON) {
      const text = new TextDecoder('utf-8').decode(bytes.subarray(dataStart, dataEnd));
      json = JSON.parse(text) as GltfJson;
    } else if (chunkType === CHUNK_TYPE_BIN) {
      bin = bytes.subarray(dataStart, dataEnd);
    }
    // Chunks are 4-byte aligned.
    offset = dataStart + Math.ceil(chunkLength / 4) * 4;
  }
  if (!json) throw new Error('GLB missing JSON chunk');
  return { json, bin: bin ?? new Uint8Array(0) };
}

/** Read one accessor into a flat `Float32Array` of `count × components`, applying normalization. */
function readAccessorFloats(json: GltfJson, bin: Uint8Array, accessorIndex: number): { data: Float32Array; components: number } {
  const accessor = json.accessors?.[accessorIndex];
  if (!accessor) throw new Error(`Missing accessor ${accessorIndex}`);
  const components = TYPE_COMPONENTS[accessor.type];
  if (!components) throw new Error(`Unsupported accessor type: ${accessor.type}`);
  const view = json.bufferViews?.[accessor.bufferView ?? -1];
  if (!view) throw new Error('Accessor without bufferView is not supported');

  const compBytes = COMPONENT_BYTES[accessor.componentType];
  if (!compBytes) throw new Error(`Unsupported componentType: ${accessor.componentType}`);
  const elementBytes = compBytes * components;
  const stride = view.byteStride && view.byteStride > 0 ? view.byteStride : elementBytes;
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);

  const out = new Float32Array(accessor.count * components);
  for (let i = 0; i < accessor.count; i++) {
    const elementOffset = base + i * stride;
    for (let c = 0; c < components; c++) {
      const o = elementOffset + c * compBytes;
      out[i * components + c] = readComponent(dv, o, accessor.componentType, accessor.normalized === true);
    }
  }
  return { data: out, components };
}

/** Read one accessor of integer indices into a `Uint32Array`. */
function readIndices(json: GltfJson, bin: Uint8Array, accessorIndex: number): Uint32Array {
  const accessor = json.accessors?.[accessorIndex];
  if (!accessor) throw new Error(`Missing index accessor ${accessorIndex}`);
  const view = json.bufferViews?.[accessor.bufferView ?? -1];
  if (!view) throw new Error('Index accessor without bufferView is not supported');
  const compBytes = COMPONENT_BYTES[accessor.componentType];
  if (!compBytes) throw new Error(`Unsupported index componentType: ${accessor.componentType}`);
  const stride = view.byteStride && view.byteStride > 0 ? view.byteStride : compBytes;
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);

  const out = new Uint32Array(accessor.count);
  for (let i = 0; i < accessor.count; i++) {
    out[i] = readComponent(dv, base + i * stride, accessor.componentType, false);
  }
  return out;
}

/** Read a single scalar component, normalizing integer types to 0..1 when requested. */
function readComponent(dv: DataView, offset: number, componentType: number, normalized: boolean): number {
  switch (componentType) {
    case COMPONENT_TYPE.FLOAT:
      return dv.getFloat32(offset, true);
    case COMPONENT_TYPE.UNSIGNED_BYTE: {
      const v = dv.getUint8(offset);
      return normalized ? v / 255 : v;
    }
    case COMPONENT_TYPE.BYTE: {
      const v = dv.getInt8(offset);
      return normalized ? Math.max(v / 127, -1) : v;
    }
    case COMPONENT_TYPE.UNSIGNED_SHORT: {
      const v = dv.getUint16(offset, true);
      return normalized ? v / 65535 : v;
    }
    case COMPONENT_TYPE.SHORT: {
      const v = dv.getInt16(offset, true);
      return normalized ? Math.max(v / 32767, -1) : v;
    }
    case COMPONENT_TYPE.UNSIGNED_INT:
      return dv.getUint32(offset, true);
    default:
      throw new Error(`Unsupported componentType: ${componentType}`);
  }
}

/** Multiply two column-major 4×4 matrices (`a × b`). */
function mat4Multiply(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += (a[row + k * 4] ?? 0) * (b[k + col * 4] ?? 0);
      out[row + col * 4] = sum;
    }
  }
  return out;
}

/** Build a column-major TRS matrix from a node's translation/rotation/scale. */
function nodeLocalMatrix(node: GltfNode): number[] {
  if (node.matrix && node.matrix.length === 16) return node.matrix.slice();
  const t = node.translation ?? [0, 0, 0];
  const r = node.rotation ?? [0, 0, 0, 1];
  const s = node.scale ?? [1, 1, 1];
  const qx = r[0] ?? 0, qy = r[1] ?? 0, qz = r[2] ?? 0, qw = r[3] ?? 1;
  const sx = s[0] ?? 1, sy = s[1] ?? 1, sz = s[2] ?? 1;
  const tx = t[0] ?? 0, ty = t[1] ?? 0, tz = t[2] ?? 0;
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

/** Find the world matrix of the (first) node referencing the given mesh index. */
/** A mesh referenced by a scene node, paired with its composed world matrix. */
interface MeshInstance {
  meshIndex: number;
  world: number[] | null;
}

/**
 * Collect every (mesh, world-matrix) pair reachable from the scene graph.
 *
 * A single glTF mesh may be instanced by several nodes; each instance is
 * emitted with its composed world transform so all geometry ends up in the
 * correct place. Falls back to mesh 0 (identity) when no node references a mesh.
 */
function collectMeshInstances(json: GltfJson): MeshInstance[] {
  const nodes = json.nodes;
  const result: MeshInstance[] = [];
  if (!nodes) {
    return json.meshes && json.meshes.length > 0 ? [{ meshIndex: 0, world: null }] : result;
  }
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const walk = (nodeIndex: number, parent: number[]): void => {
    const node = nodes[nodeIndex];
    if (!node) return;
    const world = mat4Multiply(parent, nodeLocalMatrix(node));
    if (node.mesh !== undefined) result.push({ meshIndex: node.mesh, world });
    for (const child of node.children ?? []) walk(child, world);
  };
  const sceneNodes = json.scenes?.[json.scene ?? 0]?.nodes ?? nodes.map((_, i) => i);
  for (const root of sceneNodes) walk(root, identity);
  if (result.length === 0 && json.meshes && json.meshes.length > 0) {
    result.push({ meshIndex: 0, world: null });
  }
  return result;
}

/** Material base color (`baseColorFactor`) as RGBA in 0..1, or null when absent. */
function materialBaseColor(json: GltfJson, materialIndex: number | undefined): [number, number, number, number] | null {
  if (materialIndex === undefined) return null;
  const factor = json.materials?.[materialIndex]?.pbrMetallicRoughness?.baseColorFactor;
  if (!factor || factor.length < 3) return null;
  return [factor[0] ?? 0.75, factor[1] ?? 0.75, factor[2] ?? 0.75, factor[3] ?? 1];
}

/** Transform a point by a column-major 4×4 matrix (w assumed 1, no perspective divide). */
function transformPoint(m: number[], x: number, y: number, z: number): [number, number, number] {
  return [
    (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0),
    (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z + (m[13] ?? 0),
    (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 0) * z + (m[14] ?? 0),
  ];
}

/** Return true when a matrix differs from identity enough to require transforming vertices. */
function isNonIdentity(m: number[]): boolean {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (let i = 0; i < 16; i++) {
    if (Math.abs((m[i] ?? 0) - (identity[i] ?? 0)) > 1e-6) return true;
  }
  return false;
}

/**
 * Parse a GLB blob into an interleaved 7-float vertex buffer + 32-bit index
 * buffer suitable for the renderer's basic triangle pipeline.
 *
 * All triangle primitives of every mesh reachable from the scene graph are
 * merged into a single buffer (a multi-material model such as a car GLB has one
 * primitive per material). Per-vertex color comes from `COLOR_0` when present,
 * otherwise from the primitive material's `baseColorFactor`, otherwise a light
 * grey default. Each mesh instance is baked by its composed node world matrix.
 *
 * @throws if the blob is not a valid GLB or contains no usable triangle geometry.
 */
export function parseGlbMesh(bytes: Uint8Array): GlbMeshResult {
  const { json, bin } = splitGlb(bytes);
  const meshes = json.meshes;
  if (!meshes || meshes.length === 0) throw new Error('GLB has no meshes');

  const instances = collectMeshInstances(json);

  const outVertices: number[] = [];
  const outIndices: number[] = [];
  let vertexBase = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const instance of instances) {
    const mesh = meshes[instance.meshIndex];
    if (!mesh) continue;
    const world = instance.world;
    const applyTransform = world !== null && isNonIdentity(world);

    for (const primitive of mesh.primitives) {
      // Only triangle lists are supported (mode 4, or unspecified = triangles).
      if (primitive.mode !== undefined && primitive.mode !== 4) continue;
      const positionAccessor = primitive.attributes['POSITION'];
      if (positionAccessor === undefined) continue;

      const { data: positions } = readAccessorFloats(json, bin, positionAccessor);
      const vertexCount = positions.length / 3;
      if (vertexCount === 0) continue;

      // Color source priority: COLOR_0 → material baseColorFactor → grey.
      let colors: Float32Array | null = null;
      let colorComponents = 0;
      const colorAccessor = primitive.attributes['COLOR_0'];
      if (colorAccessor !== undefined) {
        const read = readAccessorFloats(json, bin, colorAccessor);
        colors = read.data;
        colorComponents = read.components;
      }
      const matColor = colors ? null : materialBaseColor(json, primitive.material);
      const [dr, dg, db, da] = matColor ?? [0.75, 0.75, 0.75, 1];

      for (let i = 0; i < vertexCount; i++) {
        let px = positions[i * 3] ?? 0;
        let py = positions[i * 3 + 1] ?? 0;
        let pz = positions[i * 3 + 2] ?? 0;
        if (applyTransform && world) [px, py, pz] = transformPoint(world, px, py, pz);

        if (colors) {
          const c = i * colorComponents;
          outVertices.push(
            px, py, pz,
            colors[c] ?? 0.75,
            colors[c + 1] ?? 0.75,
            colors[c + 2] ?? 0.75,
            colorComponents >= 4 ? (colors[c + 3] ?? 1) : 1,
          );
        } else {
          outVertices.push(px, py, pz, dr, dg, db, da);
        }

        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
        if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz;
      }

      // Indices (widened to u32, offset into the merged buffer). Non-indexed
      // primitives get a trivial 0..N range.
      if (primitive.indices !== undefined) {
        const primIndices = readIndices(json, bin, primitive.indices);
        for (let i = 0; i < primIndices.length; i++) outIndices.push(primIndices[i]! + vertexBase);
      } else {
        for (let i = 0; i < vertexCount; i++) outIndices.push(i + vertexBase);
      }
      vertexBase += vertexCount;
    }
  }

  if (vertexBase === 0) throw new Error('GLB has no usable triangle geometry');

  return {
    vertices: new Float32Array(outVertices),
    indices: new Uint32Array(outIndices),
    vertexCount: vertexBase,
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  };
}

/** Quick sniff: does this blob start with the GLB magic (`glTF`)? */
export function isGlb(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4 &&
    bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46;
}
