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

    it('expands the far clip plane beyond camera distance when switching 2D→3D on a large map (regression: only-half rendering)', () => {
      cam.setDimension('2d');
      // Large map (~40km span). fitToVertices clears the animation flag and
      // sets the 2D far plane to the small ortho value (~20100m).
      const verts = makeVertexBuffer([
        [0, 0, 0], [40000, 5000, 0],
      ]);
      cam.fitToVertices(verts);

      cam.setDimension('3d');

      const { position, target, far } = cam.state;
      const dist = Math.hypot(
        position[0] - target[0],
        position[1] - target[1],
        position[2] - target[2],
      );
      // The far plane must lie beyond the camera-to-target distance; otherwise
      // the scene is clipped and only the near half renders.
      expect(far).toBeGreaterThan(dist);
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

    it('zoom-to-cursor keeps the world point under the cursor stationary on screen', () => {
      const verts = makeVertexBuffer([
        [0, 0, 0], [2000, 2000, 0],
      ]);
      cam.fitToVertices(verts);

      // Pick an off-centre cursor and record the world point under it.
      const cx = 200;
      const cy = 180;
      const anchor = cam.unprojectToGround(cx, cy);
      expect(anchor).not.toBeNull();

      cam.handleWheel(-120, cx, cy);  // zoom in toward the cursor

      // The same world point must re-project to (approximately) the cursor.
      const screen = cam.projectWorldToScreen(anchor!.x, anchor!.y);
      expect(screen).not.toBeNull();
      expect(screen!.x).toBeCloseTo(cx, 0);
      expect(screen!.y).toBeCloseTo(cy, 0);
    });

    it('zoom-to-cursor pulls the orbit target toward the cursor anchor', () => {
      const verts = makeVertexBuffer([
        [0, 0, 0], [2000, 2000, 0],
      ]);
      cam.fitToVertices(verts);

      const cx = 200;
      const cy = 180;
      const anchor = cam.unprojectToGround(cx, cy);
      expect(anchor).not.toBeNull();

      const distBefore = Math.hypot(
        cam.state.target[0] - anchor!.x,
        cam.state.target[1] - anchor!.y,
      );
      cam.handleWheel(-120, cx, cy);  // zoom in toward the cursor
      const distAfter = Math.hypot(
        cam.state.target[0] - anchor!.x,
        cam.state.target[1] - anchor!.y,
      );

      // Orbit pivot should move closer to where the user is zooming, so the
      // camera can keep getting closer instead of stalling at MIN_CAM_DIST.
      expect(distAfter).toBeLessThan(distBefore);
    });

    it('handles an out-of-bounds cursor without error and still zooms in', () => {
      const distBefore = cam.getCameraDistance();
      // Cursor far outside the viewport — exercises the null-anchor guard.
      cam.handleWheel(-120, -99999, -99999);
      expect(cam.getCameraDistance()).toBeLessThan(distBefore);
    });
  });

  describe('fly mode', () => {
    it('enterFlyMode sets isFlyMode to true in 3D', () => {
      expect(cam.isFlyMode).toBe(false);
      cam.enterFlyMode();
      expect(cam.isFlyMode).toBe(true);
    });

    it('enterFlyMode is no-op in 2D mode', () => {
      cam.setDimension('2d');
      cam.enterFlyMode();
      expect(cam.isFlyMode).toBe(false);
    });

    it('enterFlyMode is no-op when camera is locked', () => {
      cam.lock();
      cam.enterFlyMode();
      expect(cam.isFlyMode).toBe(false);
    });

    it('exitFlyMode sets isFlyMode to false', () => {
      cam.enterFlyMode();
      expect(cam.isFlyMode).toBe(true);
      cam.exitFlyMode();
      expect(cam.isFlyMode).toBe(false);
    });

    it('exitFlyMode preserves camera position', () => {
      cam.enterFlyMode();
      const posBefore = [...cam.state.position];
      cam.exitFlyMode();
      expect(cam.state.position).toEqual(posBefore);
    });

    it('flyLook changes target but not position', () => {
      cam.enterFlyMode();
      const posBefore = [...cam.state.position];
      const targetBefore = [...cam.state.target];
      cam.flyLook(100, 50);
      expect(cam.state.position).toEqual(posBefore);
      expect(cam.state.target).not.toEqual(targetBefore);
    });

    it('flyLook is no-op when not in fly mode', () => {
      const targetBefore = [...cam.state.target];
      cam.flyLook(100, 50);
      expect(cam.state.target).toEqual(targetBefore);
    });

    it('flyMove moves camera forward', () => {
      cam.enterFlyMode();
      const posBefore = [...cam.state.position];
      cam.flyMove(1, 0, 0, 0.1);
      // Camera should have moved
      const moved = Math.sqrt(
        (cam.state.position[0] - posBefore[0]) ** 2 +
        (cam.state.position[1] - posBefore[1]) ** 2 +
        (cam.state.position[2] - posBefore[2]) ** 2,
      );
      expect(moved).toBeGreaterThan(0);
    });

    it('flyMove with sprint multiplies speed', () => {
      // Use two separate controllers to avoid speed recalculation between runs
      const cam1 = new CameraController();
      cam1.setViewportSize(800, 600);
      cam1.enterFlyMode();
      const pos1Start = [...cam1.state.position];
      cam1.flyMove(1, 0, 0, 0.1, false);
      const distNormal = Math.sqrt(
        (cam1.state.position[0] - pos1Start[0]) ** 2 +
        (cam1.state.position[1] - pos1Start[1]) ** 2 +
        (cam1.state.position[2] - pos1Start[2]) ** 2,
      );

      const cam2 = new CameraController();
      cam2.setViewportSize(800, 600);
      cam2.enterFlyMode();
      const pos2Start = [...cam2.state.position];
      cam2.flyMove(1, 0, 0, 0.1, true);
      const distSprint = Math.sqrt(
        (cam2.state.position[0] - pos2Start[0]) ** 2 +
        (cam2.state.position[1] - pos2Start[1]) ** 2 +
        (cam2.state.position[2] - pos2Start[2]) ** 2,
      );

      expect(distSprint).toBeGreaterThan(distNormal);
    });

    it('flyMove is no-op when not in fly mode', () => {
      const posBefore = [...cam.state.position];
      cam.flyMove(1, 0, 0, 0.1);
      expect(cam.state.position).toEqual(posBefore);
    });

    it('flyMove vertical (Q/E) changes Z', () => {
      cam.enterFlyMode();
      const zBefore = cam.state.position[2];
      cam.flyMove(0, 0, 1, 0.1);
      expect(cam.state.position[2]).toBeGreaterThan(zBefore);
    });

    it('adjustFlySpeed changes speed', () => {
      cam.enterFlyMode();
      const speedBefore = cam.flySpeed;
      cam.handleWheel(-120); // scroll up → increase speed
      expect(cam.flySpeed).toBeGreaterThan(speedBefore);
    });

    it('handleWheel adjusts fly speed when in fly mode', () => {
      cam.enterFlyMode();
      const speedBefore = cam.flySpeed;
      cam.handleWheel(120); // scroll down
      expect(cam.flySpeed).not.toBe(speedBefore);
    });

    it('endPointerDrag exits fly mode', () => {
      cam.beginPointerDrag(2, { clientX: 100, clientY: 100, ctrlKey: false, shiftKey: false, altKey: false });
      expect(cam.isFlyMode).toBe(true);
      cam.endPointerDrag();
      expect(cam.isFlyMode).toBe(false);
    });
  });
});
