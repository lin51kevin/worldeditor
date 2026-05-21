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
      // Camera must be directly above target (same XY) at fixed height
      expect(position[0]).toBeCloseTo(100, 3);
      expect(position[1]).toBeCloseTo(200, 3);
      expect(position[2]).toBe(10000);  // ORTHO_CAM_HEIGHT
      // Y-up in 2D mode
      expect(up).toEqual([0, 1, 0]);
    });

    it('cancels a running dimension animation (regression: open-file during startup animation)', () => {
      cam.setDimension('2d');  // animation started

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

  describe('2D orthographic mode', () => {
    beforeEach(() => {
      cam.setDimension('2d');
      const verts = makeVertexBuffer([
        [0, 0, 0], [1000, 1000, 0],
      ]);
      cam.fitToVertices(verts);
    });

    it('getMetersPerPixel returns 1/numPixelsPerMeter in 2D mode', () => {
      const mpp = cam.getMetersPerPixel();
      expect(mpp).toBeGreaterThan(0);
      // After fitting 1000m extent to 800x600 viewport at 80% fill:
      // viewMeters = 1000/0.8 = 1250, fitScaleH = 800/1250 = 0.64, fitScaleV = 600/1250 = 0.48
      // scale = min(0.64, 0.48) = 0.48 → mpp = 1/0.48 ≈ 2.08
      expect(mpp).toBeCloseTo(1 / 0.48, 1);
    });

    it('handleWheel zooms by adjusting numPixelsPerMeter', () => {
      const mppBefore = cam.getMetersPerPixel();
      // Scroll to zoom in (negative deltaY)
      cam.handleWheel(-120);
      const mppAfter = cam.getMetersPerPixel();
      // Zooming in → mpp should decrease (more px per meter)
      expect(mppAfter).toBeLessThan(mppBefore);
    });

    it('handleWheel zooms out with positive deltaY', () => {
      const mppBefore = cam.getMetersPerPixel();
      cam.handleWheel(120);
      const mppAfter = cam.getMetersPerPixel();
      // Zooming out → mpp should increase (fewer px per meter)
      expect(mppAfter).toBeGreaterThan(mppBefore);
    });

    it('zoom has a very large range (matching C# behavior)', () => {
      // Zoom in many times
      for (let i = 0; i < 200; i++) cam.handleWheel(-120);
      const mppZoomedIn = cam.getMetersPerPixel();
      // Zoom out many times
      for (let i = 0; i < 400; i++) cam.handleWheel(120);
      const mppZoomedOut = cam.getMetersPerPixel();
      // Range should be enormous (at least 100000x)
      expect(mppZoomedOut / mppZoomedIn).toBeGreaterThan(100000);
    });

    it('camera height stays fixed during zoom', () => {
      const heightBefore = cam.state.position[2];
      cam.handleWheel(-120);
      cam.handleWheel(240);
      expect(cam.state.position[2]).toBe(heightBefore);
    });

    it('handleWheel does nothing when camera is locked', () => {
      const mppBefore = cam.getMetersPerPixel();
      cam.lock();
      cam.handleWheel(-120);
      expect(cam.getMetersPerPixel()).toBeCloseTo(mppBefore, 10);
    });

    it('unprojectToGround returns correct coordinates in 2D ortho', () => {
      // Force view matrix computation
      cam.computeViewProj();
      // Center of screen should map to target
      const center = cam.unprojectToGround(400, 300);
      expect(center).not.toBeNull();
      expect(center!.x).toBeCloseTo(cam.state.target[0], 0);
      expect(center!.y).toBeCloseTo(cam.state.target[1], 0);
    });
  });

  describe('3D perspective mode', () => {
    it('handleWheel with negative deltaY moves camera closer', () => {
      const distBefore = cam.getCameraDistance();
      cam.handleWheel(-120);
      expect(cam.getCameraDistance()).toBeLessThan(distBefore);
    });

    it('handleWheel with positive deltaY moves camera farther', () => {
      const distBefore = cam.getCameraDistance();
      cam.handleWheel(120);
      expect(cam.getCameraDistance()).toBeGreaterThan(distBefore);
    });

    it('MAX_CAM_DIST allows zooming out far enough for large maps', () => {
      // Fit a 10km map
      const verts = makeVertexBuffer([
        [0, 0, 0], [10000, 10000, 0],
      ]);
      cam.fitToVertices(verts);
      const initialDist = cam.getCameraDistance();

      // Zoom out extensively
      for (let i = 0; i < 100; i++) cam.handleWheel(120);
      const zoomedOutDist = cam.getCameraDistance();
      // Should be able to zoom out significantly beyond 2000 (old limit)
      expect(zoomedOutDist).toBeGreaterThan(2000);
    });
  });
});
