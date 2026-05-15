import { describe, it, expect } from 'vitest';
import {
  computeTangentAt,
  computeHandleScale,
  computeControlPointPositions,
  pickControlPoint,
  applyHandleDrag,
} from './tangentHandleController';

const KNOTS: Array<[number, number, number]> = [
  [0, 0, 0],
  [10, 0, 0],
  [20, 10, 0],
];
const NO_OVERRIDES = {} as const;

describe('computeTangentAt', () => {
  it('returns tangent override when present', () => {
    const t = computeTangentAt(1, KNOTS, { 1: [3, 4, 0] });
    expect(t).toEqual([3, 4, 0]);
  });

  it('computes Catmull-Rom tangent for interior knot', () => {
    const t = computeTangentAt(1, KNOTS, NO_OVERRIDES);
    // Catmull-Rom: 0.5 * (knots[2] - knots[0])
    expect(t[0]).toBeCloseTo(10);
    expect(t[1]).toBeCloseTo(5);
    expect(t[2]).toBeCloseTo(0);
  });

  it('computes forward tangent at first knot', () => {
    const t = computeTangentAt(0, KNOTS, NO_OVERRIDES);
    expect(t).toEqual([10, 0, 0]);
  });

  it('computes backward tangent at last knot', () => {
    const t = computeTangentAt(2, KNOTS, NO_OVERRIDES);
    expect(t).toEqual([10, 10, 0]);
  });

  it('returns zero tangent for single-knot list', () => {
    const t = computeTangentAt(0, [[0, 0, 0]], NO_OVERRIDES);
    expect(t).toEqual([0, 0, 0]);
  });
});

describe('computeHandleScale', () => {
  it('returns displayDist/tLen capped by HANDLE_DISPLAY_MAX', () => {
    // mpp=1 (default): targetDist = max(80*1, 0.5) = 80, clamped = min(80, 60) = 60
    expect(computeHandleScale(100)).toBeCloseTo(0.6); // 60/100
  });

  it('scales with mpp for smaller viewports', () => {
    // mpp=0.01: targetDist = max(80*0.01, 0.5) = 0.8, clamped = min(0.8, 60) = 0.8
    expect(computeHandleScale(10, 0.01)).toBeCloseTo(0.08); // 0.8/10
  });

  it('returns 0 for zero tangent length', () => {
    expect(computeHandleScale(0)).toBe(0);
  });
});

describe('computeControlPointPositions', () => {
  it('returns one knot per knot with no handles for single knot', () => {
    const positions = computeControlPointPositions([[5, 5, 0]], NO_OVERRIDES);
    expect(positions).toHaveLength(1);
    expect(positions[0]!.ref.type).toBe('knot');
  });

  it('returns knots + in/out handles for multiple knots', () => {
    const positions = computeControlPointPositions(KNOTS, NO_OVERRIDES);
    const knots = positions.filter(p => p.ref.type === 'knot');
    const handles = positions.filter(p => p.ref.type !== 'knot');
    expect(knots).toHaveLength(3);
    expect(handles.length).toBeGreaterThan(0);
  });

  it('places out handle in tangent direction from knot', () => {
    const knots: Array<[number, number, number]> = [[0, 0, 0], [10, 0, 0]];
    const positions = computeControlPointPositions(knots, NO_OVERRIDES);
    const outHandle = positions.find(p => p.ref.index === 0 && p.ref.type === 'out');
    // Tangent at 0 is [10, 0, 0], mpp=1 default → scale = 60/10 = 6 → handle at (60, 0)
    expect(outHandle).toBeDefined();
    expect(outHandle!.wx).toBeCloseTo(60);
    expect(outHandle!.wy).toBeCloseTo(0);
  });
});

describe('pickControlPoint', () => {
  it('returns null when no points are within threshold', () => {
    const positions = computeControlPointPositions(KNOTS, NO_OVERRIDES);
    const hit = pickControlPoint(100, 100, positions, 1.0);
    expect(hit).toBeNull();
  });

  it('picks the knot at origin', () => {
    const positions = computeControlPointPositions(KNOTS, NO_OVERRIDES);
    const hit = pickControlPoint(0.1, 0.1, positions, 2.0);
    expect(hit).not.toBeNull();
    expect(hit!.type).toBe('knot');
    expect(hit!.index).toBe(0);
  });

  it('prefers knot over nearby handle', () => {
    const knots: Array<[number, number, number]> = [[0, 0, 0], [1, 0, 0]];
    const positions = computeControlPointPositions(knots, NO_OVERRIDES);
    // Pick very close to origin — should return knot, not handle
    const hit = pickControlPoint(0.01, 0, positions, 2.0);
    expect(hit!.type).toBe('knot');
  });
});

describe('applyHandleDrag', () => {
  it('returns unchanged overrides when type is knot', () => {
    const result = applyHandleDrag({ index: 0, type: 'knot' }, 5, 5, KNOTS, NO_OVERRIDES, {});
    expect(result.out).toEqual(NO_OVERRIDES);
  });

  it('sets tangent override for out handle drag', () => {
    // Drag out handle of knot 0 to world (3, 0, 0)
    // Expected tangent: (3-0, 0-0) = [3, 0, 0] (magnitude = distance from knot)
    const result = applyHandleDrag({ index: 0, type: 'out' }, 3, 0, KNOTS, NO_OVERRIDES, {});
    expect(result.out[0]).toBeDefined();
    expect(result.out[0]![0]).toBeCloseTo(3);
    expect(result.out[0]![1]).toBeCloseTo(0);
  });

  it('flips sign for in handle drag (mirror mode)', () => {
    // Drag in handle of knot 0 to (-3, 0) → delta = (-3, 0)
    // Mirror mode: out tangent = -delta = (3, 0)
    const result = applyHandleDrag({ index: 0, type: 'in' }, -3, 0, KNOTS, NO_OVERRIDES, {});
    expect(result.out[0]).toBeDefined();
    expect(result.out[0]![0]).toBeCloseTo(3);
  });

  it('preserves existing overrides for other knots', () => {
    const overrides = { 2: [5, 5, 0] as [number, number, number] };
    const result = applyHandleDrag({ index: 0, type: 'out' }, 3, 0, KNOTS, overrides, {});
    expect(result.out[2]).toEqual([5, 5, 0]);
    expect(result.out[0]).toBeDefined();
  });

  it('supports broken tangent mode for in handle', () => {
    const result = applyHandleDrag({ index: 0, type: 'in' }, -3, 0, KNOTS, NO_OVERRIDES, {}, 'broken');
    // In broken mode, in handle drag sets in_ override independently
    expect(result.in_[0]).toBeDefined();
    expect(result.in_[0]![0]).toBeCloseTo(3); // -(-3) = 3
  });
});
