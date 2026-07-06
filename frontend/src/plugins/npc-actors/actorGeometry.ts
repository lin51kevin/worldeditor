/**
 * NPC-actor geometry builders.
 *
 * Convert oriented bounding boxes and trajectory segments into the renderer's
 * standard colored-triangle vertex layout (7 floats per vertex: x, y, z, r, g,
 * b, a). Pure functions — no GPU or renderer state.
 */

import { ACTOR_VERTEX_STRIDE, CaseActorBox, Rgba } from './actorTypes';

/** Local unit-cube corners scaled per-box at build time. */
const CUBE_CORNERS: ReadonlyArray<readonly [number, number, number]> = [
  [-1, -1, -1], // 0
  [1, -1, -1], // 1
  [1, 1, -1], // 2
  [-1, 1, -1], // 3
  [-1, -1, 1], // 4
  [1, -1, 1], // 5
  [1, 1, 1], // 6
  [-1, 1, 1], // 7
];

/** 12 triangles (36 indices) covering the 6 cube faces. Winding is irrelevant
 *  (the basic pipeline uses cullMode 'none'). */
const CUBE_TRIS: ReadonlyArray<number> = [
  0, 1, 2, 0, 2, 3, // bottom (-z)
  4, 6, 5, 4, 7, 6, // top (+z)
  0, 4, 5, 0, 5, 1, // -y
  1, 5, 6, 1, 6, 2, // +x
  2, 6, 7, 2, 7, 3, // +y
  3, 7, 4, 3, 4, 0, // -x
];

/** Selection highlight fill — wine red, so selected actors stand out. */
const SELECTED_FILL: Rgba = [0.62, 0.12, 0.2, 1];
/** More opaque fill for selected actors than the default translucency. */
const SELECTED_FILL_ALPHA = 0.75;

/** White edge color for the bounding-box wireframe. */
const EDGE_COLOR: Rgba = [1, 1, 1, 1];
/** Half-thickness of an edge bar, meters. Edges protrude slightly past faces to
 *  avoid z-fighting with the translucent fill. */
const EDGE_HALF = 0.04;
/** Translucency applied to the fill of boxed actors (bodies / triggers). */
const FILL_ALPHA = 0.5;

/**
 * Emit the 12 triangles of a local axis-aligned box [minL, maxL], rotated by
 * (cos, sin) about Z and translated to (cx, cy, cz), into `out` (7 floats/vertex).
 */
function emitBox(
  out: number[],
  minL: readonly [number, number, number],
  maxL: readonly [number, number, number],
  cos: number,
  sin: number,
  cx: number,
  cy: number,
  cz: number,
  color: Rgba,
): void {
  const wx: number[] = new Array(8);
  const wy: number[] = new Array(8);
  const wz: number[] = new Array(8);
  for (let i = 0; i < 8; i++) {
    const lx = CUBE_CORNERS[i]![0] < 0 ? minL[0] : maxL[0];
    const ly = CUBE_CORNERS[i]![1] < 0 ? minL[1] : maxL[1];
    const lz = CUBE_CORNERS[i]![2] < 0 ? minL[2] : maxL[2];
    wx[i] = cx + (lx * cos - ly * sin);
    wy[i] = cy + (lx * sin + ly * cos);
    wz[i] = cz + lz;
  }
  for (const idx of CUBE_TRIS) {
    out.push(wx[idx]!, wy[idx]!, wz[idx]!, color[0], color[1], color[2], color[3]);
  }
}

/**
 * Build triangle vertices for a set of oriented bounding boxes.
 *
 * "Boxed" actors (bodies / triggers) render as a translucent colored fill with
 * white wireframe edges — the classic bounding-box look. Waypoint handles stay
 * as small solid opaque cubes (no edges) so they remain crisp grab targets.
 */
export function buildBoxVertices(boxes: readonly CaseActorBox[]): Float32Array {
  const out: number[] = [];

  for (const box of boxes) {
    const hl = box.size[0] / 2;
    const hw = box.size[1] / 2;
    const hh = box.size[2] / 2;
    const cos = Math.cos(box.heading);
    const sin = Math.sin(box.heading);
    const [cx, cy, cz] = box.position;
    const withEdges = box.kind !== 'waypoint';
    // Selected actors render as a more opaque wine-red fill to stand out.
    const base = box.selected ? SELECTED_FILL : box.color;
    const fillAlpha = box.selected ? SELECTED_FILL_ALPHA : FILL_ALPHA;

    // Fill (translucent for boxed actors so the road shows through).
    const fill: Rgba = withEdges ? [base[0], base[1], base[2], base[3] * fillAlpha] : base;
    emitBox(out, [-hl, -hw, -hh], [hl, hw, hh], cos, sin, cx, cy, cz, fill);

    if (!withEdges) continue;

    // 12 white edge bars (thin boxes) along the cube's edges.
    const t = EDGE_HALF;
    // 4 edges parallel to local X (vary Y, Z at ±half).
    for (const [Y, Z] of [[hw, hh], [hw, -hh], [-hw, hh], [-hw, -hh]] as const) {
      emitBox(out, [-hl, Y - t, Z - t], [hl, Y + t, Z + t], cos, sin, cx, cy, cz, EDGE_COLOR);
    }
    // 4 edges parallel to local Y (vary X, Z).
    for (const [X, Z] of [[hl, hh], [hl, -hh], [-hl, hh], [-hl, -hh]] as const) {
      emitBox(out, [X - t, -hw, Z - t], [X + t, hw, Z + t], cos, sin, cx, cy, cz, EDGE_COLOR);
    }
    // 4 edges parallel to local Z (vary X, Y).
    for (const [X, Y] of [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw]] as const) {
      emitBox(out, [X - t, Y - t, -hh], [X + t, Y + t, hh], cos, sin, cx, cy, cz, EDGE_COLOR);
    }
  }

  return new Float32Array(out);
}

/**
 * Build triangle vertices for trajectory polylines from a flat SEGMENT list.
 *
 * `segments` holds independent segments, each two consecutive vertices
 * (2 × 7 floats = 14 floats: x, y, z, r, g, b, a). Using explicit segment pairs
 * (rather than a strip) lets the host emit multiple disjoint trajectories in one
 * buffer without spurious joins between them. Each segment becomes a flat,
 * ground-parallel ribbon quad of half-width `halfWidth` meters (2 triangles).
 */
export function buildPathVertices(segments: Float32Array, halfWidth: number): Float32Array {
  const stride = ACTOR_VERTEX_STRIDE * 2; // one segment = two vertices
  const segCount = Math.floor(segments.length / stride);
  const out = new Float32Array(segCount * 6 * ACTOR_VERTEX_STRIDE);
  let o = 0;

  for (let s = 0; s < segCount; s++) {
    const b = s * stride;
    const x0 = segments[b]!;
    const y0 = segments[b + 1]!;
    const z0 = segments[b + 2]!;
    const r = segments[b + 3]!;
    const g = segments[b + 4]!;
    const bl = segments[b + 5]!;
    const a = segments[b + 6]!;
    const x1 = segments[b + 7]!;
    const y1 = segments[b + 8]!;
    const z1 = segments[b + 9]!;

    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const nx = (-dy / len) * halfWidth;
    const ny = (dx / len) * halfWidth;

    // Quad corners: p0±perp, p1±perp.
    const ax = x0 + nx, ay = y0 + ny;
    const bx = x0 - nx, by = y0 - ny;
    const c1x = x1 + nx, c1y = y1 + ny;
    const dxp = x1 - nx, dyp = y1 - ny;

    const push = (px: number, py: number, pz: number) => {
      out[o++] = px;
      out[o++] = py;
      out[o++] = pz;
      out[o++] = r;
      out[o++] = g;
      out[o++] = bl;
      out[o++] = a;
    };

    // Triangles: (a, b, c1) and (c1, b, dp)
    push(ax, ay, z0);
    push(bx, by, z0);
    push(c1x, c1y, z1);
    push(c1x, c1y, z1);
    push(bx, by, z0);
    push(dxp, dyp, z1);
  }

  return o === out.length ? out : out.subarray(0, o);
}
