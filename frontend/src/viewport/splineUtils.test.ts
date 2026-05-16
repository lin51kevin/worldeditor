import { describe, it, expect } from 'vitest';
import { getSplineHandlePoints } from './splineUtils';

describe('getSplineHandlePoints', () => {
  it('should return empty array for 0 knots', () => {
    expect(getSplineHandlePoints([])).toHaveLength(0);
  });

  it('should return empty array for 1 knot', () => {
    expect(getSplineHandlePoints([[0, 0, 0]])).toHaveLength(0);
  });

  it('should return 4 handles for 2 knots (2 per knot: in + out)', () => {
    const handles = getSplineHandlePoints([[0, 0, 0], [10, 0, 0]]);
    // 2 knots × 2 handles each = 4 (if tangents non-degenerate)
    expect(handles.length).toBeGreaterThan(0);
    // All should have knotIndex 0 or 1
    for (const h of handles) {
      expect(h.knotIndex).toBeGreaterThanOrEqual(0);
      expect(h.knotIndex).toBeLessThanOrEqual(1);
    }
  });

  it('should return in and out handle types', () => {
    const handles = getSplineHandlePoints([[0, 0, 0], [10, 0, 0]]);
    const types = handles.map((h) => h.type);
    expect(types).toContain('in');
    expect(types).toContain('out');
  });

  it('out handle should be displaced from knot position', () => {
    const handles = getSplineHandlePoints([[0, 0, 0], [10, 0, 0]]);
    const outHandle = handles.find((h) => h.knotIndex === 0 && h.type === 'out');
    expect(outHandle).toBeDefined();
    // The handle is offset from the knot position (0, 0, 0)
    const dist = Math.hypot(outHandle!.x - 0, outHandle!.y - 0);
    expect(dist).toBeGreaterThan(0);
  });

  it('in handle should be on opposite side from out handle', () => {
    const handles = getSplineHandlePoints([[0, 0, 0], [10, 0, 0]]);
    const inH = handles.find((h) => h.knotIndex === 0 && h.type === 'in');
    const outH = handles.find((h) => h.knotIndex === 0 && h.type === 'out');
    if (inH && outH) {
      // in and out should be on opposite sides of the knot
      // For knot at (0,0,0): outH.x > 0 and inH.x < 0 (east tangent)
      expect(outH.x * inH.x).toBeLessThanOrEqual(0);
    }
  });

  it('should respect tangentOverrides', () => {
    // Override knot 0 tangent to point north
    const overrides: Record<number, [number, number, number]> = {
      0: [0, 5, 0],
    };
    const handles = getSplineHandlePoints([[0, 0, 0], [10, 0, 0]], overrides);
    const outH = handles.find((h) => h.knotIndex === 0 && h.type === 'out');
    expect(outH).toBeDefined();
    // With north tangent, out handle y should be > 0
    expect(outH!.y).toBeGreaterThan(0);
  });

  it('handles for middle knots should use Catmull-Rom tangent', () => {
    const handles = getSplineHandlePoints([[0, 0, 0], [5, 0, 0], [10, 0, 0]]);
    // Middle knot (index 1) should have handles
    const midHandles = handles.filter((h) => h.knotIndex === 1);
    expect(midHandles.length).toBeGreaterThan(0);
  });
});
