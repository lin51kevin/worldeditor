import { describe, expect, it } from 'vitest';
import { evaluateCubicPolynomial, refitLaneWidth } from './polyFit';

describe('polyFit', () => {
  it('refits a cubic lane-width polynomial from sampled widths', () => {
    const expected = { a: 3.2, b: 0.08, c: -0.004, d: 0.0001 };
    const sPositions = [0, 5, 10, 15, 20].map((value) => 100 + value);
    const widths = sPositions.map((s) => evaluateCubicPolynomial(expected, s - 100));

    const actual = refitLaneWidth(sPositions, widths, 100, 20);

    expect(actual.a).toBeCloseTo(expected.a, 6);
    expect(actual.b).toBeCloseTo(expected.b, 6);
    expect(actual.c).toBeCloseTo(expected.c, 6);
    expect(actual.d).toBeCloseTo(expected.d, 6);
  });

  it('returns zero polynomial for empty input', () => {
    const result = refitLaneWidth([], [], 0, 10);
    expect(result.a).toBe(0);
    expect(result.b).toBe(0);
    expect(result.c).toBe(0);
    expect(result.d).toBe(0);
  });

  it('handles single-point input gracefully', () => {
    const result = refitLaneWidth([5], [3.5], 0, 10);
    // Single point: polynomial degenerates but should not throw
    expect(Number.isFinite(result.a)).toBe(true);
  });

  it('evaluateCubicPolynomial computes correctly', () => {
    expect(evaluateCubicPolynomial({ a: 1, b: 2, c: 3, d: 4 }, 2)).toBe(1 + 4 + 12 + 32);
  });
});
