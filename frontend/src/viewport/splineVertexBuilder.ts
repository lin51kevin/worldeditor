/**
 * Pure functions that generate spline curve and control-point marker vertices.
 * Used by ViewportRenderer to render spline overlays.
 */

/** Compute Catmull-Rom tangent at index i, with optional overrides. */
function tangentAt(
  knots: ReadonlyArray<readonly [number, number, number]>,
  i: number,
  tangentOverrides?: Readonly<Record<number, readonly [number, number, number]>>,
): [number, number, number] {
  if (tangentOverrides && i in tangentOverrides) return [...tangentOverrides[i]!];
  const n = knots.length;
  if (n === 1) return [0, 0, 0];
  if (i === 0) return [knots[1]![0] - knots[0]![0], knots[1]![1] - knots[0]![1], knots[1]![2] - knots[0]![2]];
  if (i === n - 1) return [knots[n - 1]![0] - knots[n - 2]![0], knots[n - 1]![1] - knots[n - 2]![1], knots[n - 1]![2] - knots[n - 2]![2]];
  return [0.5 * (knots[i + 1]![0] - knots[i - 1]![0]), 0.5 * (knots[i + 1]![1] - knots[i - 1]![1]), 0.5 * (knots[i + 1]![2] - knots[i - 1]![2])];
}

/** Hermite interpolation between two control points. */
function hermiteInterp(
  p1: readonly [number, number, number], m1: readonly [number, number, number],
  p2: readonly [number, number, number], m2: readonly [number, number, number],
  t: number,
): [number, number, number] {
  const t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return [
    h00 * p1[0] + h10 * m1[0] + h01 * p2[0] + h11 * m2[0],
    h00 * p1[1] + h10 * m1[1] + h01 * p2[1] + h11 * m2[1],
    h00 * p1[2] + h10 * m1[2] + h01 * p2[2] + h11 * m2[2],
  ];
}

/** Emit a thick line segment (quad) as 6 vertices (2 triangles). */
function emitSegment(
  verts: number[],
  ax: number, ay: number, bx: number, by: number, z: number,
  hw: number, r: number, g: number, b: number, a: number,
): void {
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-8) return;
  const px = (-dy / len) * hw, py = (dx / len) * hw;
  verts.push(
    ax - px, ay - py, z, r, g, b, a,
    ax + px, ay + py, z, r, g, b, a,
    bx + px, by + py, z, r, g, b, a,
    ax - px, ay - py, z, r, g, b, a,
    bx + px, by + py, z, r, g, b, a,
    bx - px, by - py, z, r, g, b, a,
  );
}

/** Outlined square with two diagonals (X pattern). */
function addXSquare(
  verts: number[],
  cx: number, cy: number, z: number, halfSize: number,
  strokeHW: number,
  r: number, g: number, b: number, a: number,
): void {
  const x0 = cx - halfSize, x1 = cx + halfSize;
  const y0 = cy - halfSize, y1 = cy + halfSize;
  emitSegment(verts, x0, y0, x1, y0, z, strokeHW, r, g, b, a); // bottom
  emitSegment(verts, x1, y0, x1, y1, z, strokeHW, r, g, b, a); // right
  emitSegment(verts, x1, y1, x0, y1, z, strokeHW, r, g, b, a); // top
  emitSegment(verts, x0, y1, x0, y0, z, strokeHW, r, g, b, a); // left
  emitSegment(verts, x0, y0, x1, y1, z, strokeHW, r, g, b, a); // diagonal
  emitSegment(verts, x1, y0, x0, y1, z, strokeHW, r, g, b, a); // diagonal
}

/** Generate Hermite spline curve vertex data (yellow line). */
export function buildSplineCurveVertices(
  knots: ReadonlyArray<readonly [number, number, number]>,
  tangentOverrides: Readonly<Record<number, readonly [number, number, number]>> | undefined,
  mpp: number,
): number[] {
  if (knots.length < 2) return [];

  const STEPS = 24;
  const zOffset = 0.15;
  const lineHW = 1.0 * mpp;
  const cR = 0.961, cG = 0.651, cB = 0.137, cA = 1.0; // #F5A623

  const curveVerts: number[] = [];
  let prev: [number, number, number] | null = null;
  for (let i = 0; i < knots.length - 1; i++) {
    const p1 = knots[i]!;
    const p2 = knots[i + 1]!;
    const m1 = tangentAt(knots, i, tangentOverrides);
    const m2 = tangentAt(knots, i + 1, tangentOverrides);
    for (let s = 0; s <= STEPS; s++) {
      const pt = hermiteInterp(p1, m1, p2, m2, s / STEPS);
      if (prev) emitSegment(curveVerts, prev[0], prev[1], pt[0], pt[1], zOffset, lineHW, cR, cG, cB, cA);
      prev = pt;
    }
  }
  return curveVerts;
}

export interface ControlPointState {
  index: number;
  type: 'knot' | 'in' | 'out';
}

/** Generate spline control-point marker vertex data (knots + tangent handles). */
export function buildSplineMarkerVertices(
  knots: ReadonlyArray<readonly [number, number, number]>,
  tangentOverrides: Readonly<Record<number, readonly [number, number, number]>> | undefined,
  mpp: number,
  clearColor: { r: number; g: number; b: number },
  hovered: ControlPointState | null,
  selected: ControlPointState | null,
): number[] {
  if (knots.length === 0) return [];

  const zOffset = 0.15;
  const knotHalfSize = 6.0 * mpp;
  const handleHalfSize = 4.0 * mpp;
  const lineHW = 1.5 * mpp;
  const strokeHW = mpp * 1.0;

  const clearLuma = 0.2126 * clearColor.r + 0.7152 * clearColor.g + 0.0722 * clearColor.b;
  const darkTheme = clearLuma < 0.5;

  const colYellow: [number, number, number, number] = darkTheme
    ? [1.0, 0.82, 0.25, 0.92]
    : [0.88, 0.56, 0.06, 0.9];
  const colDefaultKnot: [number, number, number, number] = darkTheme
    ? [0.96, 0.96, 0.96, 1.0]
    : [0.08, 0.08, 0.08, 1.0];
  const colGreen: [number, number, number, number] = [0.13, 0.78, 0.37, 1.0];
  const colRed: [number, number, number, number] = [0.91, 0.30, 0.24, 1.0];
  const colBlue: [number, number, number, number] = darkTheme
    ? [0.42, 0.72, 1.0, 1.0]
    : [0.10, 0.46, 0.82, 1.0];

  const markerVerts: number[] = [];
  const knotZ = zOffset + 0.04;
  const handleZ = zOffset + 0.06;

  // Tangent handle lines and endpoint X-squares
  if (knots.length >= 2) {
    for (let i = 0; i < knots.length; i++) {
      const [kx, ky] = knots[i]!;
      const [tvx, tvy] = tangentAt(knots, i, tangentOverrides);
      const tLen = Math.hypot(tvx, tvy);
      if (tLen < 1e-6) continue;
      const scale = Math.min(4.0 / tLen, 0.3);
      const hx1 = kx + tvx * scale, hy1 = ky + tvy * scale; // 'out' handle
      const hx2 = kx - tvx * scale, hy2 = ky - tvy * scale; // 'in'  handle

      // Yellow tangent line
      emitSegment(markerVerts, hx2, hy2, hx1, hy1, handleZ - 0.01, lineHW, ...colYellow);

      // 'out' handle X-square
      const outColor = (hovered?.index === i && hovered?.type === 'out') ? colGreen
        : (selected?.index === i && selected?.type === 'out') ? colRed
        : colBlue;
      addXSquare(markerVerts, hx1, hy1, handleZ, handleHalfSize, strokeHW, ...outColor);

      // 'in' handle X-square
      const inColor = (hovered?.index === i && hovered?.type === 'in') ? colGreen
        : (selected?.index === i && selected?.type === 'in') ? colRed
        : colBlue;
      addXSquare(markerVerts, hx2, hy2, handleZ, handleHalfSize, strokeHW, ...inColor);
    }
  }

  // Knot X-squares (drawn above handles)
  for (let i = 0; i < knots.length; i++) {
    const [kx, ky, kz] = knots[i]!;
    const knotColor = (hovered?.index === i && hovered?.type === 'knot') ? colGreen
      : (selected?.index === i && selected?.type === 'knot') ? colRed
      : colDefaultKnot;
    addXSquare(markerVerts, kx, ky, (kz ?? 0) + knotZ, knotHalfSize, strokeHW, ...knotColor);
  }

  return markerVerts;
}
