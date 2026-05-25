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
});
