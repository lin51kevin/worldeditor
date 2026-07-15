import { describe, it, expect } from 'vitest';

import { parseGlbMesh, isGlb } from './glbMesh';

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** Assemble a GLB blob from a glTF JSON object and its binary buffer. */
function buildGlb(json: unknown, bin: Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  let jsonBytes = enc.encode(JSON.stringify(json));
  // Pad JSON chunk to a 4-byte boundary with spaces.
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  if (jsonPad) {
    const padded = new Uint8Array(jsonBytes.length + jsonPad);
    padded.set(jsonBytes);
    padded.fill(0x20, jsonBytes.length);
    jsonBytes = padded;
  }
  const binPad = (4 - (bin.length % 4)) % 4;
  const binLen = bin.length + binPad;

  const total = 12 + 8 + jsonBytes.length + 8 + binLen;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let o = 0;
  dv.setUint32(o, GLB_MAGIC, true); o += 4;
  dv.setUint32(o, 2, true); o += 4;
  dv.setUint32(o, total, true); o += 4;
  dv.setUint32(o, jsonBytes.length, true); o += 4;
  dv.setUint32(o, CHUNK_JSON, true); o += 4;
  out.set(jsonBytes, o); o += jsonBytes.length;
  dv.setUint32(o, binLen, true); o += 4;
  dv.setUint32(o, CHUNK_BIN, true); o += 4;
  out.set(bin, o);
  return out;
}

/**
 * A minimal two-primitive GLB: two triangles, each with a distinct material
 * baseColorFactor (red / green) and no COLOR_0 attribute.
 */
function twoPrimitiveGlb(): Uint8Array {
  const bin = new ArrayBuffer(96);
  const f = new Float32Array(bin, 0, 18);
  // prim0 triangle (in the XY plane).
  f.set([0, 0, 0, 1, 0, 0, 0, 1, 0], 0);
  // prim1 triangle (along Z).
  f.set([0, 0, 0, 0, 0, 1, 0, 0, 2], 9);
  const idx = new Uint32Array(bin, 72, 6);
  idx.set([0, 1, 2, 0, 1, 2]);

  const json = {
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5125, count: 3, type: 'SCALAR' },
      { bufferView: 3, componentType: 5125, count: 3, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 36 },
      { buffer: 0, byteOffset: 72, byteLength: 12 },
      { buffer: 0, byteOffset: 84, byteLength: 12 },
    ],
    materials: [
      { pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } },
      { pbrMetallicRoughness: { baseColorFactor: [0, 1, 0, 1] } },
    ],
    meshes: [
      {
        primitives: [
          { attributes: { POSITION: 0 }, indices: 2, material: 0 },
          { attributes: { POSITION: 1 }, indices: 3, material: 1 },
        ],
      },
    ],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  return buildGlb(json, new Uint8Array(bin));
}

describe('viewport/glbMesh.parseGlbMesh', () => {
  it('sniffs the GLB magic', () => {
    expect(isGlb(twoPrimitiveGlb())).toBe(true);
    expect(isGlb(new Uint8Array([1, 2, 3, 4]))).toBe(false);
  });

  it('merges all primitives across a multi-material mesh', () => {
    const mesh = parseGlbMesh(twoPrimitiveGlb());
    // 3 + 3 vertices from the two primitives.
    expect(mesh.vertexCount).toBe(6);
    expect(mesh.vertices.length).toBe(6 * 7);
    // Second primitive's indices are offset into the merged buffer.
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('applies each primitive material baseColorFactor as the vertex color', () => {
    const mesh = parseGlbMesh(twoPrimitiveGlb());
    // First 3 vertices → red material.
    expect([mesh.vertices[3], mesh.vertices[4], mesh.vertices[5], mesh.vertices[6]]).toEqual([1, 0, 0, 1]);
    // Next 3 vertices → green material.
    expect([mesh.vertices[24], mesh.vertices[25], mesh.vertices[26], mesh.vertices[27]]).toEqual([0, 1, 0, 1]);
  });

  it('computes bounds spanning every merged primitive', () => {
    const mesh = parseGlbMesh(twoPrimitiveGlb());
    expect(mesh.min).toEqual([0, 0, 0]);
    expect(mesh.max).toEqual([1, 1, 2]);
  });
});
