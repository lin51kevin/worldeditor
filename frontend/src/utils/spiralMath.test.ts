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

  it('signedPerpendicularOffset returns 0 for zero-length baseline', () => {
    const offset = signedPerpendicularOffset({ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 10, y: 10 });
    expect(offset).toBe(0);
  });

  it('curvatureFromOffset returns curvStart when length is near zero', () => {
    const curv = curvatureFromOffset(0, 5, 0.1);
    expect(curv).toBe(0.1);
  });

  it('computeSpiralGeometry handles zero-length chord (same start/end)', () => {
    const geometry = computeSpiralGeometry({ x: 0, y: 0 }, { x: 0, y: 0 }, 0, 0.01);
    expect(geometry.length).toBeGreaterThan(0);
  });

  it('computeSpiralGeometry handles very short chord', () => {
    const geometry = computeSpiralGeometry({ x: 0, y: 0 }, { x: 0.0001, y: 0 }, 0, 0);
    expect(geometry.length).toBeGreaterThan(0);
  });
});
