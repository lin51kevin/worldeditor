import type { Geometry } from '../services/platform';

export interface ArcPoint {
  x: number;
  y: number;
}

export interface ArcComputation {
  center: ArcPoint;
  radius: number;
  startAngle: number;
  endAngle: number;
  sweepAngle: number;
  curvature: number;
  hdg: number;
  length: number;
}

const TAU = Math.PI * 2;
const EPSILON = 1e-8;

function normalizePositive(angle: number): number {
  const normalized = angle % TAU;
  return normalized < 0 ? normalized + TAU : normalized;
}

function normalizeSigned(angle: number): number {
  let normalized = normalizePositive(angle);
  if (normalized > Math.PI) {
    normalized -= TAU;
  }
  return normalized;
}

function ccwDelta(from: number, to: number): number {
  return normalizePositive(to - from);
}

export function computeArcFromThreePoints(p1: ArcPoint, p2: ArcPoint, p3: ArcPoint): ArcComputation | null {
  const d = 2 * (
    p1.x * (p2.y - p3.y) +
    p2.x * (p3.y - p1.y) +
    p3.x * (p1.y - p2.y)
  );

  if (Math.abs(d) <= EPSILON) {
    return null;
  }

  const p1Sq = p1.x * p1.x + p1.y * p1.y;
  const p2Sq = p2.x * p2.x + p2.y * p2.y;
  const p3Sq = p3.x * p3.x + p3.y * p3.y;

  const center = {
    x: (
      p1Sq * (p2.y - p3.y) +
      p2Sq * (p3.y - p1.y) +
      p3Sq * (p1.y - p2.y)
    ) / d,
    y: (
      p1Sq * (p3.x - p2.x) +
      p2Sq * (p1.x - p3.x) +
      p3Sq * (p2.x - p1.x)
    ) / d,
  };

  const radius = Math.hypot(p1.x - center.x, p1.y - center.y);
  if (!Number.isFinite(radius) || radius <= EPSILON) {
    return null;
  }

  const startAngle = Math.atan2(p1.y - center.y, p1.x - center.x);
  const endAngleRaw = Math.atan2(p2.y - center.y, p2.x - center.x);
  const throughAngle = Math.atan2(p3.y - center.y, p3.x - center.x);

  const ccwToEnd = ccwDelta(startAngle, endAngleRaw);
  const ccwToThrough = ccwDelta(startAngle, throughAngle);
  const isCounterClockwise = ccwToThrough <= ccwToEnd + EPSILON;
  const sweepAngle = isCounterClockwise ? ccwToEnd : -ccwDelta(endAngleRaw, startAngle);
  const tangentOffset = isCounterClockwise ? Math.PI / 2 : -Math.PI / 2;
  const hdg = normalizeSigned(startAngle + tangentOffset);
  const curvature = (isCounterClockwise ? 1 : -1) / radius;
  const length = radius * Math.abs(sweepAngle);

  return {
    center,
    radius,
    startAngle: normalizeSigned(startAngle),
    endAngle: normalizeSigned(startAngle + sweepAngle),
    sweepAngle,
    curvature,
    hdg,
    length,
  };
}

export function sampleArcPoints(
  center: ArcPoint,
  radius: number,
  startAngle: number,
  sweepAngle: number,
  numSamples: number,
): ArcPoint[] {
  const samples = Math.max(1, Math.floor(numSamples));
  return Array.from({ length: samples + 1 }, (_, index) => {
    const t = index / samples;
    const angle = startAngle + sweepAngle * t;
    return {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    };
  });
}

export function buildArcGeometryFromThreePoints(p1: ArcPoint, p2: ArcPoint, p3: ArcPoint): Geometry | null {
  const arc = computeArcFromThreePoints(p1, p2, p3);
  if (!arc) {
    return null;
  }

  return {
    s: 0,
    x: p1.x,
    y: p1.y,
    hdg: arc.hdg,
    length: arc.length,
    geo_type: { Arc: { curvature: arc.curvature } },
  };
}

export function buildLineGeometryFromPoints(p1: ArcPoint, p2: ArcPoint): Geometry | null {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const length = Math.hypot(dx, dy);
  if (length <= EPSILON) {
    return null;
  }

  return {
    s: 0,
    x: p1.x,
    y: p1.y,
    hdg: Math.atan2(dy, dx),
    length,
    geo_type: 'Line',
  };
}
