import { describe, expect, it } from 'vitest';
import { computeSpiralGeometry, curvatureFromOffset, sampleSpiralPoints, signedPerpendicularOffset } from './spiralMath';

describe('spiralMath', () => {
  it('computes a spiral geometry whose sampled endpoint stays close to the requested end point', () => {
    const geometry = computeSpiralGeometry({ x: 0, y: 0 }, { x: 30, y: 10 }, 0, 0.02);
    const samples = sampleSpiralPoints(
      geometry.x,
      geometry.y,
      geometry.hdg,
      geometry.length,
      0,
      0.02,
      96,
    );
    const endPoint = samples[samples.length - 1]!;

    expect(endPoint[0]).toBeCloseTo(30, 1);
    expect(endPoint[1]).toBeCloseTo(10, 1);
  });

  it('derives curvature sign from cursor offset across the baseline', () => {
    const offsetAbove = signedPerpendicularOffset({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 2 });
    const offsetBelow = signedPerpendicularOffset({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -2 });

    expect(curvatureFromOffset(10, offsetAbove)).toBeGreaterThan(0);
    expect(curvatureFromOffset(10, offsetBelow)).toBeLessThan(0);
  });
});
