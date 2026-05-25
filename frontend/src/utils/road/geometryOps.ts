/**
 * Geometry evaluation and manipulation utilities.
 *
 * Pure mathematical functions for evaluating OpenDRIVE geometry types
 * (Line, Arc, Spiral, Poly3, ParamPoly3) at arbitrary stations.
 */

import type { Geometry, GeometryType, LaneWidth } from '../../services/platform';

const DEFAULT_LANE_WIDTH = 3.5;

// ─── evalGeometryAtS ─────────────────────────────────────────────────────────

/**
 * Evaluate geometry at a local arclength offset `ds` from the geometry start.
 * Returns { x, y, hdg } in world coordinates.
 */
export function evalGeometryAtS(geo: Geometry, ds: number): { x: number; y: number; hdg: number } {
  const { x: x0, y: y0, hdg: hdg0, geo_type } = geo;

  if (geo_type === 'Line') {
    return { x: x0 + ds * Math.cos(hdg0), y: y0 + ds * Math.sin(hdg0), hdg: hdg0 };
  }

  if ('Arc' in geo_type) {
    const kappa = geo_type.Arc.curvature;
    if (Math.abs(kappa) < 1e-12) {
      return { x: x0 + ds * Math.cos(hdg0), y: y0 + ds * Math.sin(hdg0), hdg: hdg0 };
    }
    const theta = kappa * ds;
    const lx = Math.sin(theta) / kappa;
    const ly = (1 - Math.cos(theta)) / kappa;
    return {
      x: x0 + lx * Math.cos(hdg0) - ly * Math.sin(hdg0),
      y: y0 + lx * Math.sin(hdg0) + ly * Math.cos(hdg0),
      hdg: hdg0 + theta,
    };
  }

  if ('Spiral' in geo_type) {
    const { curv_start: c0, curv_end: c1 } = geo_type.Spiral;
    const L = geo.length;
    // heading at ds: theta = c0*ds + (c1-c0)*ds^2/(2L)
    const thetaAt = (t: number) => c0 * t + ((c1 - c0) * t * t) / (2 * L);
    // Numerical integration (Gauss-Legendre 5-point)
    const gaussX = [0, 0.5384693101056831, -0.5384693101056831, 0.9061798459386640, -0.9061798459386640];
    const gaussW = [0.5688888888888889, 0.4786286704993665, 0.4786286704993665, 0.2369268850561891, 0.2369268850561891];
    const lx = (gaussW.reduce((sum, w, i) => sum + w * Math.cos(thetaAt(ds / 2 * (1 + (gaussX[i] ?? 0)))), 0)) * ds / 2;
    const ly = (gaussW.reduce((sum, w, i) => sum + w * Math.sin(thetaAt(ds / 2 * (1 + (gaussX[i] ?? 0)))), 0)) * ds / 2;
    return {
      x: x0 + lx * Math.cos(hdg0) - ly * Math.sin(hdg0),
      y: y0 + lx * Math.sin(hdg0) + ly * Math.cos(hdg0),
      hdg: hdg0 + thetaAt(ds),
    };
  }

  if ('Poly3' in geo_type) {
    const { a, b, c, d } = geo_type.Poly3;
    // local coords: x_local = ds, y_local = a + b*ds + c*ds^2 + d*ds^3
    const yl = a + b * ds + c * ds * ds + d * ds * ds * ds;
    const dyl = b + 2 * c * ds + 3 * d * ds * ds;
    const localHdg = Math.atan2(dyl, 1);
    return {
      x: x0 + ds * Math.cos(hdg0) - yl * Math.sin(hdg0),
      y: y0 + ds * Math.sin(hdg0) + yl * Math.cos(hdg0),
      hdg: hdg0 + localHdg,
    };
  }

  if ('ParamPoly3' in geo_type) {
    const { a_u, b_u, c_u, d_u, a_v, b_v, c_v, d_v, p_range } = geo_type.ParamPoly3;
    const p = p_range === 'Normalized' ? (geo.length > 0 ? ds / geo.length : 0) : ds;
    const u = a_u + b_u * p + c_u * p * p + d_u * p * p * p;
    const v = a_v + b_v * p + c_v * p * p + d_v * p * p * p;
    const du = b_u + 2 * c_u * p + 3 * d_u * p * p;
    const dv = b_v + 2 * c_v * p + 3 * d_v * p * p;
    return {
      x: x0 + u * Math.cos(hdg0) - v * Math.sin(hdg0),
      y: y0 + u * Math.sin(hdg0) + v * Math.cos(hdg0),
      hdg: hdg0 + Math.atan2(dv, du),
    };
  }

  // Unknown: fall back to line approximation
  return { x: x0 + ds * Math.cos(hdg0), y: y0 + ds * Math.sin(hdg0), hdg: hdg0 };
}

// ─── Utility helpers ─────────────────────────────────────────────────────────

export function distanceSquared(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return dx * dx + dy * dy;
}

export function normalizeAngle(angle: number): number {
  let value = angle;
  while (value > Math.PI) value -= 2 * Math.PI;
  while (value <= -Math.PI) value += 2 * Math.PI;
  return value;
}

export function angleDelta(a: number, b: number): number {
  return Math.abs(normalizeAngle(a - b));
}

// ─── Geometry type operations ────────────────────────────────────────────────

export function reverseGeometryType(geoType: Geometry['geo_type']): Geometry['geo_type'] {
  if (geoType === 'Line') return 'Line';
  if ('Arc' in geoType) {
    return { Arc: { curvature: -geoType.Arc.curvature } };
  }
  if ('Spiral' in geoType) {
    return {
      Spiral: {
        curv_start: -geoType.Spiral.curv_end,
        curv_end: -geoType.Spiral.curv_start,
      },
    };
  }
  return geoType;
}

export function needsResampledReverse(road: { plan_view: Geometry[] }): boolean {
  return road.plan_view.some((geo) => geo.geo_type !== 'Line' && !('Arc' in geo.geo_type) && !('Spiral' in geo.geo_type));
}

/**
 * Given a geometry type and the split position (local offset `before` within
 * the segment of total `length`), return corrected geometry types for each half.
 */
export function splitGeometryType(
  geo_type: GeometryType,
  length: number,
  before: number,
  hdg0: number,
  splitHdg: number,
): { type1: GeometryType; type2: GeometryType } {
  // Line and Arc: nothing to recompute
  if (geo_type === 'Line' || 'Arc' in geo_type) {
    return { type1: geo_type, type2: geo_type };
  }

  if ('Spiral' in geo_type) {
    const { curv_start: c0, curv_end: c1 } = geo_type.Spiral;
    const cMid = c0 + (c1 - c0) * before / length;
    return {
      type1: { Spiral: { curv_start: c0, curv_end: cMid } },
      type2: { Spiral: { curv_start: cMid, curv_end: c1 } },
    };
  }

  if ('Poly3' in geo_type) {
    const { b, c, d } = geo_type.Poly3;
    const ds0 = before;
    const b2 = b + 2 * c * ds0 + 3 * d * ds0 * ds0;
    const c2 = c + 3 * d * ds0;
    const d2 = d;
    return {
      type1: geo_type,
      type2: { Poly3: { a: 0, b: b2, c: c2, d: d2 } },
    };
  }

  if ('ParamPoly3' in geo_type) {
    const { a_u, b_u, c_u, d_u, a_v, b_v, c_v, d_v, p_range } = geo_type.ParamPoly3;
    const p0 = p_range === 'Normalized' ? (length > 0 ? before / length : 0) : before;

    // First half: p ∈ [0, p0] → normalized p' ∈ [0, 1] via p = p0 * p'
    const beta1 = p0;
    const a_u1 = a_u;
    const b_u1 = b_u * beta1;
    const c_u1 = c_u * beta1 * beta1;
    const d_u1 = d_u * beta1 * beta1 * beta1;
    const a_v1 = a_v;
    const b_v1 = b_v * beta1;
    const c_v1 = c_v * beta1 * beta1;
    const d_v1 = d_v * beta1 * beta1 * beta1;

    // Second half: p ∈ [p0, p_end] → normalized p' ∈ [0, 1]
    const pEnd = p_range === 'Normalized' ? 1 : length;
    const beta2 = pEnd - p0;
    const u_p0 = a_u + b_u * p0 + c_u * p0 * p0 + d_u * p0 * p0 * p0;
    const v_p0 = a_v + b_v * p0 + c_v * p0 * p0 + d_v * p0 * p0 * p0;
    void u_p0; void v_p0;

    const B_u = (b_u + 2 * c_u * p0 + 3 * d_u * p0 * p0) * beta2;
    const C_u = (c_u + 3 * d_u * p0) * beta2 * beta2;
    const D_u = d_u * beta2 * beta2 * beta2;
    const B_v = (b_v + 2 * c_v * p0 + 3 * d_v * p0 * p0) * beta2;
    const C_v = (c_v + 3 * d_v * p0) * beta2 * beta2;
    const D_v = d_v * beta2 * beta2 * beta2;

    // Rotate from hdg0 frame into split2Hdg frame
    const beta = hdg0 - splitHdg;
    const cosB = Math.cos(beta);
    const sinB = Math.sin(beta);

    const a_u2 = 0;
    const b_u2 = cosB * B_u - sinB * B_v;
    const c_u2 = cosB * C_u - sinB * C_v;
    const d_u2 = cosB * D_u - sinB * D_v;
    const a_v2 = 0;
    const b_v2 = sinB * B_u + cosB * B_v;
    const c_v2 = sinB * C_u + cosB * C_v;
    const d_v2 = sinB * D_u + cosB * D_v;

    return {
      type1: { ParamPoly3: { a_u: a_u1, b_u: b_u1, c_u: c_u1, d_u: d_u1, a_v: a_v1, b_v: b_v1, c_v: c_v1, d_v: d_v1, p_range: 'Normalized' } },
      type2: { ParamPoly3: { a_u: a_u2, b_u: b_u2, c_u: c_u2, d_u: d_u2, a_v: a_v2, b_v: b_v2, c_v: c_v2, d_v: d_v2, p_range: 'Normalized' } },
    };
  }

  return { type1: geo_type, type2: geo_type };
}

// ─── Spatial search ──────────────────────────────────────────────────────────

export function refineClosestDs(geo: Geometry, worldPos: { x: number; y: number }, bestDs: number, sampleStep: number): number {
  let left = Math.max(0, bestDs - sampleStep);
  let right = Math.min(geo.length, bestDs + sampleStep);

  for (let i = 0; i < 8; i++) {
    const mid1 = left + (right - left) / 3;
    const mid2 = right - (right - left) / 3;
    const pose1 = evalGeometryAtS(geo, mid1);
    const pose2 = evalGeometryAtS(geo, mid2);
    const dist1 = distanceSquared(pose1.x, pose1.y, worldPos.x, worldPos.y);
    const dist2 = distanceSquared(pose2.x, pose2.y, worldPos.x, worldPos.y);

    if (dist1 <= dist2) {
      right = mid2;
    } else {
      left = mid1;
    }
  }

  return (left + right) / 2;
}

// ─── Width evaluation ────────────────────────────────────────────────────────

/** Evaluate a lane-width cubic polynomial at arclength offset `sOff`. */
export function evalWidthPolyAt(widths: LaneWidth[], sOff: number): number {
  let active: LaneWidth | undefined;
  for (const w of widths) {
    if (w.s_offset <= sOff) active = w;
  }
  if (!active) return widths[0]?.a ?? DEFAULT_LANE_WIDTH;
  const ds = sOff - active.s_offset;
  return active.a + active.b * ds + active.c * ds * ds + active.d * ds * ds * ds;
}
