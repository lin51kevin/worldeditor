import type { Geometry } from '../services/platform';

export interface SpiralPoint {
  x: number;
  y: number;
}

const MIN_LENGTH = 1e-3;
const MAX_ABS_CURVATURE = 0.25;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function integrateLocalSpiral(
  length: number,
  curvStart: number,
  curvEnd: number,
  targetS: number = length,
): { x: number; y: number; hdg: number } {
  const safeLength = Math.max(length, MIN_LENGTH);
  const s = clamp(targetS, 0, safeLength);
  if (s <= 0) {
    return { x: 0, y: 0, hdg: 0 };
  }

  const curvatureRate = (curvEnd - curvStart) / safeLength;
  const thetaAt = (station: number) => curvStart * station + 0.5 * curvatureRate * station * station;
  const steps = Math.max(24, Math.ceil(s * 3));
  const ds = s / steps;
  let x = 0;
  let y = 0;

  for (let index = 0; index < steps; index += 1) {
    const s0 = index * ds;
    const s1 = s0 + ds * 0.5;
    const s2 = (index + 1) * ds;
    x += (ds / 6) * (Math.cos(thetaAt(s0)) + 4 * Math.cos(thetaAt(s1)) + Math.cos(thetaAt(s2)));
    y += (ds / 6) * (Math.sin(thetaAt(s0)) + 4 * Math.sin(thetaAt(s1)) + Math.sin(thetaAt(s2)));
  }

  return { x, y, hdg: thetaAt(s) };
}

function solveSpiralLength(targetChord: number, curvStart: number, curvEnd: number): number {
  let length = Math.max(targetChord, MIN_LENGTH);

  for (let index = 0; index < 10; index += 1) {
    const local = integrateLocalSpiral(length, curvStart, curvEnd);
    const chord = Math.hypot(local.x, local.y);
    if (!Number.isFinite(chord) || chord <= MIN_LENGTH) {
      break;
    }
    const error = Math.abs(chord - targetChord);
    if (error <= Math.max(1e-4, targetChord * 1e-4)) {
      break;
    }
    length *= targetChord / chord;
  }

  return Math.max(length, MIN_LENGTH);
}

export function signedPerpendicularOffset(start: SpiralPoint, end: SpiralPoint, point: SpiralPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length <= MIN_LENGTH) {
    return 0;
  }
  return ((point.x - start.x) * dy - (point.y - start.y) * dx) / length;
}

export function curvatureFromOffset(length: number, signedOffset: number, curvStart = 0): number {
  if (length <= MIN_LENGTH) {
    return curvStart;
  }
  const deltaCurvature = (-6 * signedOffset) / (length * length);
  return clamp(curvStart + deltaCurvature, -MAX_ABS_CURVATURE, MAX_ABS_CURVATURE);
}

/**
 * Builds a single OpenDRIVE spiral segment that starts at `start` and ends close to `end`.
 */
export function computeSpiralGeometry(
  start: SpiralPoint,
  end: SpiralPoint,
  curvStart: number,
  curvEnd: number,
): Geometry {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chordLength = Math.hypot(dx, dy);
  const length = solveSpiralLength(chordLength, curvStart, curvEnd);
  const local = integrateLocalSpiral(length, curvStart, curvEnd);
  const chordHeading = Math.atan2(dy, dx);
  const localHeading = Math.atan2(local.y, local.x);
  const hdg = Number.isFinite(localHeading) ? chordHeading - localHeading : chordHeading;

  return {
    s: 0,
    x: start.x,
    y: start.y,
    hdg,
    length,
    geo_type: {
      Spiral: {
        curv_start: curvStart,
        curv_end: curvEnd,
      },
    },
  };
}

export function sampleSpiralPoints(
  x: number,
  y: number,
  hdg: number,
  length: number,
  curvStart: number,
  curvEnd: number,
  numSamples: number,
): Array<[number, number]> {
  const safeSamples = Math.max(2, Math.floor(numSamples));
  const points: Array<[number, number]> = [];
  const cosH = Math.cos(hdg);
  const sinH = Math.sin(hdg);

  for (let index = 0; index <= safeSamples; index += 1) {
    const s = (length * index) / safeSamples;
    const local = integrateLocalSpiral(length, curvStart, curvEnd, s);
    points.push([
      x + local.x * cosH - local.y * sinH,
      y + local.x * sinH + local.y * cosH,
    ]);
  }

  return points;
}
