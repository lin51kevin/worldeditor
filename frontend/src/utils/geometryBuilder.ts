/**
 * Utility functions for building OpenDRIVE geometry segments from user-drawn points.
 */
import type { Geometry, GeometryType, Road, Elevation } from '../services/platform';

/** Build a Line geometry from two points. */
export function buildLineGeometry(
  p0: [number, number, number],
  p1: [number, number, number],
): Geometry {
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const hdg = Math.atan2(dy, dx);
  const length = Math.sqrt(dx * dx + dy * dy);
  return {
    s: 0,
    x: p0[0],
    y: p0[1],
    hdg,
    length,
    geo_type: 'Line',
  };
}

/** Build an Arc geometry from three points (start, through, end). */
export function buildArcGeometry(
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
): Geometry {
  // Find circumscribed circle center from 3 points
  const ax = p0[0], ay = p0[1];
  const bx = p1[0], by = p1[1];
  const cx = p2[0], cy = p2[1];

  const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));

  if (Math.abs(D) < 1e-10) {
    // Points are collinear — fall back to a line
    return buildLineGeometry(p0, p2);
  }

  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / D;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / D;

  const radius = Math.sqrt((ax - ux) * (ax - ux) + (ay - uy) * (ay - uy));

  // Determine arc direction (CW or CCW) using cross product
  const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  // Positive cross → CCW (left turn) → positive curvature in OpenDRIVE
  const curvature = cross > 0 ? 1 / radius : -1 / radius;

  // Heading at start point: tangent to circle at p0
  // Tangent is perpendicular to radius vector (center→p0)
  const rx = ax - ux;
  const ry = ay - uy;
  // For CCW: tangent = (-ry, rx), for CW: tangent = (ry, -rx)
  const hdg = cross > 0
    ? Math.atan2(rx, -ry)
    : Math.atan2(-rx, ry);

  // Arc length: angle subtended × radius
  const angle0 = Math.atan2(ay - uy, ax - ux);
  const angle2 = Math.atan2(cy - uy, cx - ux);
  let sweepAngle = angle2 - angle0;

  if (cross > 0) {
    // CCW: sweep should be positive
    if (sweepAngle <= 0) sweepAngle += 2 * Math.PI;
  } else {
    // CW: sweep should be negative
    if (sweepAngle >= 0) sweepAngle -= 2 * Math.PI;
  }

  const arcLength = Math.abs(sweepAngle) * radius;

  const geoType: GeometryType = { Arc: { curvature } };

  return {
    s: 0,
    x: p0[0],
    y: p0[1],
    hdg,
    length: arcLength,
    geo_type: geoType,
  };
}

/** Build a Spiral (clothoid) geometry from two points with curvature endpoints. */
export function buildSpiralGeometry(
  p0: [number, number, number],
  p1: [number, number, number],
): Geometry {
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const hdg = Math.atan2(dy, dx);
  const length = Math.sqrt(dx * dx + dy * dy);

  // Default spiral: curvature transitions from 0 to a moderate value
  // curvEnd chosen so the spiral deviates noticeably from a straight line
  const curvEnd = 2 / length; // reasonable default curvature at end

  const geoType: GeometryType = { Spiral: { curv_start: 0, curv_end: curvEnd } };

  return {
    s: 0,
    x: p0[0],
    y: p0[1],
    hdg,
    length,
    geo_type: geoType,
  };
}

/** Create a default single-lane road from a geometry segment. */
export function buildRoadFromGeometry(roadId: string, geometry: Geometry): Road {
  const defaultLane = {
    id: 0,
    lane_type: 'Driving',
    level: 0,
    link: null,
    width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }],
    borders: [],
    road_marks: [],
  };

  const defaultElevation: Elevation = {
    s: 0,
    a: 0,
    b: 0,
    c: 0,
    d: 0,
  };

  return {
    id: roadId,
    name: '',
    length: geometry.length,
    junction_id: null,
    link: null,
    plan_view: [geometry],
    elevation_profile: [defaultElevation],
    lane_offsets: [],
    lateral_profile: { superelevations: [], crossfalls: [] },
    bridges: [],
    tunnels: [],
    signals: [],
    objects: [],
    lane_sections: [{
      s: 0,
      single_side: false,
      left: [{ ...defaultLane, id: 1 }],
      center: [{ ...defaultLane, id: 0, lane_type: 'None', width: [{ s_offset: 0, a: 0, b: 0, c: 0, d: 0 }] }],
      right: [{ ...defaultLane, id: -1 }],
    }],
  };
}

/** Sample points along a geometry for preview rendering. */
export function sampleGeometryPoints(
  geometry: Geometry,
  numSamples: number,
): Array<[number, number]> {
  const points: Array<[number, number]> = [];

  for (let i = 0; i <= numSamples; i++) {
    const t = i / numSamples;
    const s = t * geometry.length;
    const point = evaluateGeometry(geometry, s);
    points.push(point);
  }
  return points;
}

/** Evaluate position on a geometry at station s (local to the segment). */
function evaluateGeometry(
  geometry: Geometry,
  s: number,
): [number, number] {
  const { x, y, hdg, geo_type } = geometry;

  if (geo_type === 'Line') {
    return [
      x + s * Math.cos(hdg),
      y + s * Math.sin(hdg),
    ];
  }

  if (typeof geo_type === 'object' && 'Arc' in geo_type) {
    const { curvature } = geo_type.Arc;
    if (Math.abs(curvature) < 1e-12) {
      return [x + s * Math.cos(hdg), y + s * Math.sin(hdg)];
    }
    const radius = 1 / curvature;
    const theta = s * curvature;
    return [
      x + radius * (Math.sin(hdg + theta) - Math.sin(hdg)),
      y + radius * (Math.cos(hdg) - Math.cos(hdg + theta)),
    ];
  }

  if (typeof geo_type === 'object' && 'Spiral' in geo_type) {
    const { curv_start, curv_end } = geo_type.Spiral;
    const L = geometry.length;
    // Approximate spiral using Fresnel-like numerical integration
    return evaluateSpiral(x, y, hdg, curv_start, curv_end, L, s);
  }

  // Fallback for Poly3 / ParamPoly3: linear approximation
  return [x + s * Math.cos(hdg), y + s * Math.sin(hdg)];
}

/** Numerical integration for clothoid / Euler spiral. */
function evaluateSpiral(
  x0: number,
  y0: number,
  hdg0: number,
  curvStart: number,
  curvEnd: number,
  totalLength: number,
  s: number,
): [number, number] {
  const steps = Math.max(20, Math.ceil(s * 2));
  const ds = s / steps;
  let px = x0;
  let py = y0;
  let theta = hdg0;

  for (let i = 0; i < steps; i++) {
    const si = (i + 0.5) * ds;
    const t = totalLength > 0 ? si / totalLength : 0;
    const curv = curvStart + (curvEnd - curvStart) * t;
    px += ds * Math.cos(theta);
    py += ds * Math.sin(theta);
    theta += ds * curv;
  }

  return [px, py];
}
