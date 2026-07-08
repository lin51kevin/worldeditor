import { describe, it, expect } from 'vitest';

import { parsePlyFirstVertex } from '../plyOrigin';

/** Encode an ascii string to a Uint8Array. */
function ascii(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('npc-actors/plyOrigin.parsePlyFirstVertex', () => {
  it('reads the first vertex of an ascii PLY', () => {
    const bytes = ascii(
      [
        'ply',
        'format ascii 1.0',
        'element vertex 2',
        'property float x',
        'property float y',
        'property float z',
        'end_header',
        '100.5 200.25 3',
        '101 201 4',
        '',
      ].join('\n'),
    );
    const origin = parsePlyFirstVertex(bytes);
    expect(origin).toEqual([100.5, 200.25, 3]);
  });

  it('honors property order when x/y/z are not first', () => {
    const bytes = ascii(
      [
        'ply',
        'format ascii 1.0',
        'element vertex 1',
        'property uchar red',
        'property float x',
        'property float y',
        'property float z',
        'end_header',
        '255 7 8 9',
        '',
      ].join('\n'),
    );
    expect(parsePlyFirstVertex(bytes)).toEqual([7, 8, 9]);
  });

  it('reads the first vertex of a binary_little_endian PLY', () => {
    const header = ascii(
      [
        'ply',
        'format binary_little_endian 1.0',
        'element vertex 2',
        'property float x',
        'property float y',
        'property float z',
        'end_header',
        '',
      ].join('\n'),
    );
    // Two vertices, 3 float32 each.
    const body = new ArrayBuffer(2 * 3 * 4);
    const dv = new DataView(body);
    dv.setFloat32(0, 500000.5, true);
    dv.setFloat32(4, -12345.25, true);
    dv.setFloat32(8, 42, true);
    dv.setFloat32(12, 1, true);
    dv.setFloat32(16, 2, true);
    dv.setFloat32(20, 3, true);

    const bytes = new Uint8Array(header.length + body.byteLength);
    bytes.set(header, 0);
    bytes.set(new Uint8Array(body), header.length);

    const origin = parsePlyFirstVertex(bytes);
    expect(origin).toBeDefined();
    expect(origin![0]).toBeCloseTo(500000.5, 2);
    expect(origin![1]).toBeCloseTo(-12345.25, 2);
    expect(origin![2]).toBeCloseTo(42, 5);
  });

  it('returns undefined when the header is missing', () => {
    expect(parsePlyFirstVertex(ascii('not a ply file'))).toBeUndefined();
  });

  it('returns undefined when x/y/z properties are absent', () => {
    const bytes = ascii(
      ['ply', 'format ascii 1.0', 'element vertex 1', 'property float nx', 'end_header', '1', ''].join('\n'),
    );
    expect(parsePlyFirstVertex(bytes)).toBeUndefined();
  });
});
