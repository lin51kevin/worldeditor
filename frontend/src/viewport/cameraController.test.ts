import { describe, expect, it, beforeEach } from 'vitest';
import { CameraController } from './cameraController';

/** Build a minimal 7-float-per-vertex buffer with a single point. */
function makeVertexBuffer(points: Array<[number, number, number]>): Float32Array {
  const buf = new Float32Array(points.length * 7);
  points.forEach(([x, y, z], i) => {
    buf[i * 7 + 0] = x;
    buf[i * 7 + 1] = y;
    buf[i * 7 + 2] = z;
    // rgba padding
  });
  return buf;
}

describe('CameraController', () => {
  let cam: CameraController;

  beforeEach(() => {
    cam = new CameraController();
    cam.setViewportSize(800, 600);
  });

  describe('setDimension', () => {
    it('immediately sets dimensionMode (before animation completes)', () => {
      expect(cam.dimension).toBe('3d');  // initial state
      cam.setDimension('2d');
      expect(cam.dimension).toBe('2d');
    });

    it('is a no-op when already in the requested dimension', () => {
      cam.setDimension('2d');
      const posBefore = [...cam.state.position];
      cam.setDimension('2d');  // second call — should be a no-op
      expect(cam.state.position).toEqual(posBefore);
    });
  });

  describe('fitToVertices', () => {
    it('positions camera directly above data center in 2D mode', () => {
      cam.setDimension('2d');
      // Road data centred at (100, 200, 0) with 10m extent
      const verts = makeVertexBuffer([
        [95, 195, 0], [105, 205, 0],
      ]);
      cam.fitToVertices(verts);

      const { position, target, up } = cam.state;
      // Target should be at data centre
      expect(target[0]).toBeCloseTo(100, 3);
      expect(target[1]).toBeCloseTo(200, 3);
      // Camera must be directly above target (same XY)
      expect(position[0]).toBeCloseTo(100, 3);
      expect(position[1]).toBeCloseTo(200, 3);
      expect(position[2]).toBeGreaterThan(target[2]);  // above
      // Y-up in 2D mode
      expect(up).toEqual([0, 1, 0]);
    });

    it('cancels a running dimension animation (regression: open-file during startup animation)', () => {
      // Simulate startup: camera in 3D, then setDimension('2d') starts an
      // animation toward the EMPTY-PROJECT origin [0,0,111].  While the
      // animation is running, a file is opened and fitToVertices fires.
      cam.setDimension('2d');  // animation started — _animEndPos near [0,0,111]

      const verts = makeVertexBuffer([
        [95, 195, 0], [105, 205, 0],
      ]);
      cam.fitToVertices(verts);  // should cancel animation and own the position

      const { position, target } = cam.state;
      // Camera must be directly above data centre, NOT near origin
      expect(position[0]).toBeCloseTo(100, 3);
      expect(position[1]).toBeCloseTo(200, 3);
      expect(target[0]).toBeCloseTo(100, 3);
      expect(target[1]).toBeCloseTo(200, 3);
      // After fitToVertices the animation should be cancelled; if rAF fires it
      // must NOT override our position.  We can't step rAF here, but we verify
      // the camera state is correct immediately after the call.
    });

    it('positions camera in 3D mode when dimensionMode is 3d', () => {
      // dimensionMode starts as '3d'
      const verts = makeVertexBuffer([
        [50, 60, 0], [60, 70, 0],
      ]);
      cam.fitToVertices(verts);

      const { position, target, up } = cam.state;
      expect(target[0]).toBeCloseTo(55, 2);
      expect(target[1]).toBeCloseTo(65, 2);
      // 3D: camera should be behind and above (not the same XY as target)
      expect(position[1]).toBeLessThan(target[1]);
      expect(up).toEqual([0, 0, 1]);
    });
  });
});
