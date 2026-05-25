import { describe, expect, it } from 'vitest';
import {
  buildArcGeometryFromThreePoints,
  buildLineGeometryFromPoints,
  computeArcFromThreePoints,
  sampleArcPoints,
} from './arcMath';

describe('arcMath', () => {
  it('computes a counter-clockwise quarter arc from three points', () => {
    const arc = computeArcFromThreePoints(
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: Math.SQRT1_2, y: Math.SQRT1_2 },
    );

    expect(arc).not.toBeNull();
    expect(arc?.center.x).toBeCloseTo(0, 6);
    expect(arc?.center.y).toBeCloseTo(0, 6);
    expect(arc?.radius).toBeCloseTo(1, 6);
    expect(arc?.sweepAngle).toBeCloseTo(Math.PI / 2, 6);
    expect(arc?.curvature).toBeCloseTo(1, 6);
    expect(arc?.hdg).toBeCloseTo(Math.PI / 2, 6);
    expect(arc?.length).toBeCloseTo(Math.PI / 2, 6);
  });

  it('computes a clockwise quarter arc from three points', () => {
    const arc = computeArcFromThreePoints(
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      { x: Math.SQRT1_2, y: Math.SQRT1_2 },
    );

    expect(arc).not.toBeNull();
    expect(arc?.radius).toBeCloseTo(1, 6);
    expect(arc?.sweepAngle).toBeCloseTo(-Math.PI / 2, 6);
    expect(arc?.curvature).toBeCloseTo(-1, 6);
    expect(arc?.hdg).toBeCloseTo(0, 6);
  });

  it('returns null for collinear points', () => {
    expect(
      computeArcFromThreePoints(
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 0 },
      ),
    ).toBeNull();
  });

  it('samples arc points including the endpoints', () => {
    const points = sampleArcPoints({ x: 0, y: 0 }, 2, 0, Math.PI / 2, 4);

    expect(points).toHaveLength(5);
    expect(points[0]).toEqual({ x: 2, y: 0 });
    expect(points[4]?.x).toBeCloseTo(0, 6);
    expect(points[4]?.y).toBeCloseTo(2, 6);
  });

  it('builds an OpenDRIVE arc geometry payload', () => {
    const geometry = buildArcGeometryFromThreePoints(
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: Math.SQRT1_2, y: Math.SQRT1_2 },
    );

    expect(geometry?.s).toBe(0);
    expect(geometry?.x).toBe(1);
    expect(geometry?.y).toBe(0);
    expect(geometry?.length).toBeCloseTo(Math.PI / 2, 6);
    expect(typeof geometry?.geo_type).toBe('object');
    if (geometry && typeof geometry.geo_type === 'object' && 'Arc' in geometry.geo_type) {
      expect(geometry.geo_type.Arc.curvature).toBeCloseTo(1, 6);
    }
  });

  it('builds a straight line geometry fallback', () => {
    const geometry = buildLineGeometryFromPoints({ x: 0, y: 0 }, { x: 3, y: 4 });

    expect(geometry).toMatchObject({
      s: 0,
      x: 0,
      y: 0,
      hdg: Math.atan2(4, 3),
      length: 5,
      geo_type: 'Line',
    });
  });
});
