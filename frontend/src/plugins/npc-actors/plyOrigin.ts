/**
 * PLY first-vertex parser (scene-origin detection).
 *
 * The we-wasm point-cloud parser subtracts the file's first vertex (its
 * `origin`) from every point so the render buffer stays near zero — preserving
 * f32 precision for clouds authored in far-from-origin frames (UTM / geo). That
 * makes the rendered road mesh **origin-relative**, while authored trajectories
 * are **absolute**, so the two are offset by the origin unless the trajectory is
 * shifted into the same frame.
 *
 * Parsing the first vertex here (independent of the WASM summary, which may
 * report a zeroed origin) lets the caller recover that shift and render both the
 * road mesh and the trajectory in one aligned frame. Supports ascii and binary
 * PLY. Pure math — no renderer or GPU dependency.
 */

/** Byte size of each PLY scalar property type. */
const PLY_TYPE_SIZE: { [type: string]: number } = {
  char: 1,
  int8: 1,
  uchar: 1,
  uint8: 1,
  short: 2,
  int16: 2,
  ushort: 2,
  uint16: 2,
  int: 4,
  int32: 4,
  uint: 4,
  uint32: 4,
  float: 4,
  float32: 4,
  double: 8,
  float64: 8,
};

/**
 * Parse a PLY file's first vertex `[x, y, z]` (absolute coordinates), or
 * `undefined` when the header is missing / lacks x/y/z properties.
 */
export function parsePlyFirstVertex(bytes: Uint8Array): [number, number, number] | undefined {
  const scan = new TextDecoder('ascii').decode(bytes.subarray(0, Math.min(bytes.length, 8192)));
  const marker = scan.indexOf('end_header');
  if (marker < 0) return undefined;
  let dataStart = marker + 'end_header'.length;
  while (dataStart < scan.length && scan[dataStart] !== '\n') dataStart++;
  dataStart += 1; // skip the newline

  let format = 'ascii';
  const props: { name: string; type: string }[] = [];
  let inVertex = false;
  for (const raw of scan.slice(0, marker).split(/\r?\n/)) {
    const t = raw.trim();
    if (t.startsWith('format')) {
      format = t.split(/\s+/)[1] ?? 'ascii';
    } else if (t.startsWith('element')) {
      inVertex = t.split(/\s+/)[1] === 'vertex';
    } else if (t.startsWith('property') && inVertex) {
      const parts = t.split(/\s+/);
      if (parts[1] !== 'list') props.push({ type: parts[1]!, name: parts[2]! });
    }
  }

  const xi = props.findIndex((p) => p.name === 'x');
  const yi = props.findIndex((p) => p.name === 'y');
  const zi = props.findIndex((p) => p.name === 'z');
  if (xi < 0 || yi < 0 || zi < 0) return undefined;

  if (format === 'ascii') {
    const rest = new TextDecoder('ascii').decode(bytes.subarray(dataStart, dataStart + 4096));
    const line = rest.split(/\r?\n/).find((l) => l.trim().length > 0);
    if (!line) return undefined;
    const nums = line.trim().split(/\s+/).map(Number);
    return [nums[xi]!, nums[yi]!, nums[zi]!];
  }

  const le = format !== 'binary_big_endian';
  const offsets: number[] = [];
  let acc = 0;
  for (const p of props) {
    offsets.push(acc);
    acc += PLY_TYPE_SIZE[p.type] ?? 0;
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset + dataStart);
  const read = (idx: number): number => {
    const { type } = props[idx]!;
    const o = offsets[idx]!;
    switch (type) {
      case 'double':
      case 'float64':
        return dv.getFloat64(o, le);
      case 'float':
      case 'float32':
        return dv.getFloat32(o, le);
      case 'int':
      case 'int32':
        return dv.getInt32(o, le);
      case 'uint':
      case 'uint32':
        return dv.getUint32(o, le);
      case 'short':
      case 'int16':
        return dv.getInt16(o, le);
      case 'ushort':
      case 'uint16':
        return dv.getUint16(o, le);
      default:
        return dv.getFloat32(o, le);
    }
  };
  return [read(xi), read(yi), read(zi)];
}
