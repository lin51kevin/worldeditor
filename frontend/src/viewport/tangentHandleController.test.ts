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
  it('caps at HANDLE_SCALE_MAX (0.3) for large tangent lengths', () => {
    expect(computeHandleScale(100)).toBeCloseTo(0.04); // 4/100
  });

  it('returns 0.3 when tangent length equals exactly 4/0.3 boundary', () => {
    // At 4/0.3 ≈ 13.33, scale = min(4/13.33, 0.3) = 0.3
    expect(computeHandleScale(4 / 0.3)).toBeCloseTo(0.3);
  });

  it('returns 0.3 for very small tangent lengths (fallback)', () => {
    expect(computeHandleScale(0)).toBeCloseTo(0.3);
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
    // Tangent at 0 is [10, 0, 0], scale = min(4/10, 0.3) = 0.3 → handle at 0 + 10*0.3 = 3m
    expect(outHandle).toBeDefined();
    expect(outHandle!.wx).toBeCloseTo(3);
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
    const result = applyHandleDrag({ index: 0, type: 'knot' }, 5, 5, KNOTS, NO_OVERRIDES);
    expect(result).toEqual(NO_OVERRIDES);
  });

  it('sets tangent override for out handle drag', () => {
    // Drag out handle of knot 0 to world (3, 0, 0)
    // Expected tangent: (3-0, 0-0) / 0.3 = [10, 0, 0]
    const result = applyHandleDrag({ index: 0, type: 'out' }, 3, 0, KNOTS, NO_OVERRIDES);
    expect(result[0]).toBeDefined();
    expect(result[0]![0]).toBeCloseTo(10);
    expect(result[0]![1]).toBeCloseTo(0);
  });

  it('flips sign for in handle drag', () => {
    // Drag in handle of knot 0 to (-3, 0) → delta = (-3, 0)
    // sign = -1 for 'in': tangent = (-3 * -1) / 0.3 = [10, 0]
    const result = applyHandleDrag({ index: 0, type: 'in' }, -3, 0, KNOTS, NO_OVERRIDES);
    expect(result[0]).toBeDefined();
    expect(result[0]![0]).toBeCloseTo(10);
  });

  it('preserves existing overrides for other knots', () => {
    const overrides = { 2: [5, 5, 0] as [number, number, number] };
    const result = applyHandleDrag({ index: 0, type: 'out' }, 3, 0, KNOTS, overrides);
    expect(result[2]).toEqual([5, 5, 0]);
    expect(result[0]).toBeDefined();
  });
});
