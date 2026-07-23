import { describe, it, expect } from 'vitest';
import {
  buildProjectionMatrix,
  buildViewProjMatrix,
  unprojectGround,
  unprojectPlane,
  projectToScreen,
} from './cameraProjection';
import { invertMatrix4 } from './viewportMath';
import type { CameraState } from './cameraController';

function defaultCamera(): CameraState {
  return {
    position: [0, 0, 100] as [number, number, number],
    target: [0, 0, 0] as [number, number, number],
    up: [0, 1, 0] as [number, number, number],
    fovY: Math.PI / 4,
    near: 0.1,
    far: 10000,
  } as CameraState;
}

describe('cameraProjection', () => {
  describe('buildProjectionMatrix', () => {
    it('builds a perspective matrix in 3d mode', () => {
      const mat = buildProjectionMatrix(defaultCamera(), '3d', 100, 800, 600);
      expect(mat).toBeInstanceOf(Float32Array);
      expect(mat.length).toBe(16);
      // Perspective: element [0] relates to fov and aspect
      expect(mat[0]).toBeGreaterThan(0);
    });

    it('builds an orthographic matrix in 2d mode', () => {
      const mat = buildProjectionMatrix(defaultCamera(), '2d', 100, 800, 600);
      expect(mat).toBeInstanceOf(Float32Array);
      expect(mat.length).toBe(16);
    });
  });

  describe('buildViewProjMatrix', () => {
    it('returns a 4x4 matrix', () => {
      const mat = buildViewProjMatrix(defaultCamera(), '3d', 100, 800, 600);
      expect(mat.length).toBe(16);
    });
  });

  describe('unprojectGround', () => {
    it('returns world coords for a center-screen click looking down', () => {
      const vp = buildViewProjMatrix(defaultCamera(), '3d', 100, 800, 600);
      const inv = invertMatrix4(vp)!;
      const result = unprojectGround(inv, 800, 600, 400, 300);
      expect(result).not.toBeNull();
      // Looking straight down from z=100, center click should map near target (0,0)
      expect(Math.abs(result!.x)).toBeLessThan(5);
      expect(Math.abs(result!.y)).toBeLessThan(5);
    });

    it('returns a valid result for center-of-screen in perspective', () => {
      const cam: CameraState = {
        ...defaultCamera(),
        position: [50, 50, 100] as [number, number, number],
        target: [50, 50, 0] as [number, number, number],
      };
      const vp = buildViewProjMatrix(cam, '3d', 100, 800, 600);
      const inv = invertMatrix4(vp)!;
      const result = unprojectGround(inv, 800, 600, 400, 300);
      expect(result).not.toBeNull();
      expect(result!.x).toBeCloseTo(50, 0);
      expect(result!.y).toBeCloseTo(50, 0);
    });
  });

  describe('unprojectPlane', () => {
    it('hits the specified Z plane', () => {
      const vp = buildViewProjMatrix(defaultCamera(), '3d', 100, 800, 600);
      const inv = invertMatrix4(vp)!;
      const result = unprojectPlane(inv, 800, 600, 400, 300, 10);
      expect(result).not.toBeNull();
    });

    it('hits a non-zero worldZ plane', () => {
      const cam: CameraState = {
        ...defaultCamera(),
        position: [0, 0, 200] as [number, number, number],
        target: [0, 0, 0] as [number, number, number],
      };
      const vp = buildViewProjMatrix(cam, '3d', 100, 800, 600);
      const inv = invertMatrix4(vp)!;
      // Hit z=50 plane (halfway)
      const result = unprojectPlane(inv, 800, 600, 400, 300, 50);
      expect(result).not.toBeNull();
      expect(result!.x).toBeCloseTo(0, 0);
      expect(result!.y).toBeCloseTo(0, 0);
    });
  });

  describe('projectToScreen', () => {
    it('projects the origin to near the screen center', () => {
      const vp = buildViewProjMatrix(defaultCamera(), '3d', 100, 800, 600);
      const result = projectToScreen(vp, 800, 600, 0, 0);
      expect(result).not.toBeNull();
      expect(result!.x).toBeCloseTo(400, 0);
      expect(result!.y).toBeCloseTo(300, 0);
    });

    it('returns null when w is near zero', () => {
      // A zero matrix will produce pw=0
      const zero = new Float32Array(16);
      const result = projectToScreen(zero, 800, 600, 1, 1);
      expect(result).toBeNull();
    });
  });
});
