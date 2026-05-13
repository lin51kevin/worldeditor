import { describe, it, expect } from 'vitest';
import {
  buildSplineCurveVertices,
  buildSplineMarkerVertices,
} from './splineVertexBuilder';

// Floats per vertex: x, y, z, r, g, b, a
const FLOATS_PER_VERTEX = 7;
// Floats per quad (2 triangles = 6 vertices)
// const FLOATS_PER_QUAD = 6 * FLOATS_PER_VERTEX;

// ── buildSplineCurveVertices ────────────────────────────────────────────────

describe('buildSplineCurveVertices', () => {
  it('returns empty array for 0 knots', () => {
    expect(buildSplineCurveVertices([], undefined, 1.0)).toEqual([]);
  });

  it('returns empty array for 1 knot', () => {
    expect(buildSplineCurveVertices([[0, 0, 0]], undefined, 1.0)).toEqual([]);
  });

  it('produces non-empty output for 2 knots', () => {
    const verts = buildSplineCurveVertices([[0, 0, 0], [10, 0, 0]], undefined, 1.0);
    expect(verts.length).toBeGreaterThan(0);
    expect(verts.length % FLOATS_PER_VERTEX).toBe(0);
  });

  it('all vertex components are finite numbers', () => {
    const knots = [[0, 0, 0], [5, 5, 0], [10, 0, 0]] as Array<[number, number, number]>;
    const verts = buildSplineCurveVertices(knots, undefined, 1.0);
    for (const v of verts) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('RGBA color values are in [0, 1]', () => {
    const knots = [[0, 0, 0], [10, 0, 0]] as Array<[number, number, number]>;
    const verts = buildSplineCurveVertices(knots, undefined, 1.0);
    // Color starts at index 3 of each vertex: r, g, b, a
    for (let i = 0; i < verts.length; i += FLOATS_PER_VERTEX) {
      const r = verts[i + 3]!;
      const g = verts[i + 4]!;
      const b = verts[i + 5]!;
      const a = verts[i + 6]!;
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
  });

  it('tangent overrides affect curve shape', () => {
    const knots = [[0, 0, 0], [10, 0, 0]] as Array<[number, number, number]>;
    const defaultVerts = buildSplineCurveVertices(knots, undefined, 1.0);
    // Override: tangent at knot 0 points upward instead of along X
    const overrideVerts = buildSplineCurveVertices(knots, { 0: [0, 10, 0] }, 1.0);
    // Curve shape should differ — at least one coordinate differs
    const hasAnyDiff = defaultVerts.some((v, i) => Math.abs(v - overrideVerts[i]!) > 1e-6);
    expect(hasAnyDiff).toBe(true);
  });

  it('curve start point is near first knot', () => {
    const knots = [[3, 7, 0], [20, 15, 0]] as Array<[number, number, number]>;
    const verts = buildSplineCurveVertices(knots, undefined, 0.5);
    // First quad is near the first knot — check position is in ballpark
    // vertex layout: x, y, z, r, g, b, a — take first vertex X and Y
    const x0 = verts[0]!;
    const y0 = verts[1]!;
    expect(Math.abs(x0 - 3)).toBeLessThan(2.0); // within 2 world units
    expect(Math.abs(y0 - 7)).toBeLessThan(2.0);
  });

  it('mpp scales line half-width (larger mpp → wider line quads)', () => {
    const knots = [[0, 0, 0], [10, 0, 0]] as Array<[number, number, number]>;
    const thin = buildSplineCurveVertices(knots, undefined, 0.1);
    const wide = buildSplineCurveVertices(knots, undefined, 10.0);
    // Y-extent of wide curve should be larger than thin curve
    const maxAbsY = (arr: number[]) =>
      Math.max(...arr.filter((_, i) => i % FLOATS_PER_VERTEX === 1).map(Math.abs));
    expect(maxAbsY(wide)).toBeGreaterThan(maxAbsY(thin));
  });
});

// ── buildSplineMarkerVertices ────────────────────────────────────────────────

const CLEAR_DARK = { r: 0.1, g: 0.1, b: 0.1 };
const CLEAR_LIGHT = { r: 0.9, g: 0.9, b: 0.9 };

describe('buildSplineMarkerVertices', () => {
  it('returns empty array for 0 knots', () => {
    expect(buildSplineMarkerVertices([], undefined, 1.0, CLEAR_DARK, null, null)).toEqual([]);
  });

  it('returns non-empty output for 1 knot (single X-square)', () => {
    const verts = buildSplineMarkerVertices([[5, 5, 0]], undefined, 1.0, CLEAR_DARK, null, null);
    expect(verts.length).toBeGreaterThan(0);
    expect(verts.length % FLOATS_PER_VERTEX).toBe(0);
  });

  it('two knots produce more vertices than one (tangent handles added)', () => {
    const single = buildSplineMarkerVertices([[0, 0, 0]], undefined, 1.0, CLEAR_DARK, null, null);
    const double = buildSplineMarkerVertices([[0, 0, 0], [10, 0, 0]], undefined, 1.0, CLEAR_DARK, null, null);
    expect(double.length).toBeGreaterThan(single.length);
  });

  it('all marker vertex components are finite', () => {
    const knots = [[0, 0, 0], [5, 5, 1], [10, 0, 0]] as Array<[number, number, number]>;
    const verts = buildSplineMarkerVertices(knots, undefined, 1.0, CLEAR_DARK, null, null);
    for (const v of verts) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('RGBA color values are in [0, 1]', () => {
    const knots = [[0, 0, 0], [10, 0, 0]] as Array<[number, number, number]>;
    const verts = buildSplineMarkerVertices(knots, undefined, 1.0, CLEAR_DARK, null, null);
    for (let i = 0; i < verts.length; i += FLOATS_PER_VERTEX) {
      const [r, g, b, a] = [verts[i + 3]!, verts[i + 4]!, verts[i + 5]!, verts[i + 6]!];
      expect(r).toBeGreaterThanOrEqual(0); expect(r).toBeLessThanOrEqual(1);
      expect(g).toBeGreaterThanOrEqual(0); expect(g).toBeLessThanOrEqual(1);
      expect(b).toBeGreaterThanOrEqual(0); expect(b).toBeLessThanOrEqual(1);
      expect(a).toBeGreaterThanOrEqual(0); expect(a).toBeLessThanOrEqual(1);
    }
  });

  it('hovered knot produces different colors than default', () => {
    const knots = [[0, 0, 0], [10, 0, 0]] as Array<[number, number, number]>;
    const normal = buildSplineMarkerVertices(knots, undefined, 1.0, CLEAR_DARK, null, null);
    const hovered = buildSplineMarkerVertices(
      knots, undefined, 1.0, CLEAR_DARK,
      { index: 0, type: 'knot' }, null,
    );
    const diff = normal.some((v, i) => Math.abs(v - hovered[i]!) > 1e-6);
    expect(diff).toBe(true);
  });

  it('selected knot produces different colors than hovered', () => {
    const knots = [[0, 0, 0], [10, 0, 0]] as Array<[number, number, number]>;
    const hov = buildSplineMarkerVertices(knots, undefined, 1.0, CLEAR_DARK, { index: 0, type: 'knot' }, null);
    const sel = buildSplineMarkerVertices(knots, undefined, 1.0, CLEAR_DARK, null, { index: 0, type: 'knot' });
    const diff = hov.some((v, i) => Math.abs(v - sel[i]!) > 1e-6);
    expect(diff).toBe(true);
  });

  it('dark vs light theme produces different default knot colors', () => {
    const knots = [[5, 5, 0]] as Array<[number, number, number]>;
    const dark = buildSplineMarkerVertices(knots, undefined, 1.0, CLEAR_DARK, null, null);
    const light = buildSplineMarkerVertices(knots, undefined, 1.0, CLEAR_LIGHT, null, null);
    const diff = dark.some((v, i) => Math.abs(v - light[i]!) > 1e-6);
    expect(diff).toBe(true);
  });

  it('mpp scales marker size (larger mpp → wider squares)', () => {
    const knots = [[5, 5, 0]] as Array<[number, number, number]>;
    const small = buildSplineMarkerVertices(knots, undefined, 0.1, CLEAR_DARK, null, null);
    const large = buildSplineMarkerVertices(knots, undefined, 10.0, CLEAR_DARK, null, null);
    // X positions in large markers should span wider from knot center (5)
    const xExtent = (arr: number[]) => {
      const xs = arr.filter((_, i) => i % FLOATS_PER_VERTEX === 0);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(xExtent(large)).toBeGreaterThan(xExtent(small));
  });
});
