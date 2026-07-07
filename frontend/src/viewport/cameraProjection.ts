/**
 * Camera projection / unprojection math — extracted from cameraController.ts.
 *
 * Pure functions: given explicit camera + viewport dimensions, build the
 * view-projection matrix and convert between world and screen coordinates.
 */
import {
  perspectiveMatrix,
  orthographicMatrix,
  lookAtMatrix,
  multiplyMatrices,
  transformPoint,
} from './viewportMath';
import type { CameraState } from './cameraController';

// Reverse-Z depth remap. perspectiveMatrix/orthographicMatrix emit GL-style
// clip depth in [-1, 1] (near → -1, far → +1). This matrix maps that to a
// reversed WebGPU depth range [1, 0] (near → 1, far → 0). Combined with a
// depth clear of 0 and 'greater' depth comparisons, reverse-Z spreads float32
// depth precision uniformly across the whole view distance, which eliminates
// the zoom-dependent z-fighting on coplanar road/junction surfaces.
const DEPTH_CORRECTION = new Float32Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, -0.5, 0,
  0, 0, 0.5, 1,
]);

/** Build the depth-corrected view-projection matrix for the given camera. */
export function buildViewProjMatrix(
  camera: CameraState,
  dimensionMode: '2d' | '3d',
  numPixelsPerMeter: number,
  width: number,
  height: number,
): Float32Array {
  const aspect = width / height;
  const view = lookAtMatrix(camera.position, camera.target, camera.up);

  let proj: Float32Array;
  if (dimensionMode === '2d') {
    // Orthographic projection: visible area determined by numPixelsPerMeter
    const halfH = (height / 2) / numPixelsPerMeter;
    const halfW = halfH * aspect;
    proj = orthographicMatrix(-halfW, halfW, -halfH, halfH, camera.near, camera.far);
  } else {
    proj = perspectiveMatrix(camera.fovY, aspect, camera.near, camera.far);
  }

  return multiplyMatrices(DEPTH_CORRECTION, multiplyMatrices(proj, view));
}

/**
 * Cast a screen-space ray through the inverse view-projection matrix and
 * intersect it with the ground plane (Z=0). Returns null if the ray is
 * parallel to the plane or points away from it.
 */
export function unprojectGround(
  invViewProj: Float32Array,
  width: number,
  height: number,
  screenX: number,
  screenY: number,
): { x: number; y: number } | null {
  const ndcX = (screenX / width) * 2 - 1;
  const ndcY = 1 - (screenY / height) * 2;

  const nearPt = transformPoint(invViewProj, [ndcX, ndcY, 0]);
  const farPt = transformPoint(invViewProj, [ndcX, ndcY, 1]);
  const dx = farPt[0] - nearPt[0];
  const dy = farPt[1] - nearPt[1];
  const dz = farPt[2] - nearPt[2];
  if (Math.abs(dz) < 1e-10) return null;

  const t = -nearPt[2] / dz;
  if (t < 0) return null;
  return {
    x: nearPt[0] + dx * t,
    y: nearPt[1] + dy * t,
  };
}

/**
 * Cast a ray from the given screen pixel and intersect it with the horizontal
 * plane at the given world Z. Returns null if the ray is parallel to the plane
 * or points away from it.
 */
export function unprojectPlane(
  invViewProj: Float32Array,
  width: number,
  height: number,
  screenX: number,
  screenY: number,
  worldZ: number,
): { x: number; y: number } | null {
  const ndcX = (screenX / width) * 2 - 1;
  const ndcY = 1 - (screenY / height) * 2;

  const nearPt = transformPoint(invViewProj, [ndcX, ndcY, 0]);
  const farPt = transformPoint(invViewProj, [ndcX, ndcY, 1]);
  const dx = farPt[0] - nearPt[0];
  const dy = farPt[1] - nearPt[1];
  const dz = farPt[2] - nearPt[2];
  if (Math.abs(dz) < 1e-10) return null;

  const t = (worldZ - nearPt[2]) / dz;
  if (t < 0) return null;
  return {
    x: nearPt[0] + dx * t,
    y: nearPt[1] + dy * t,
  };
}

/** Project a world-space (wx, wy, 0) point to screen pixel coordinates. */
export function projectToScreen(
  viewProj: Float32Array,
  width: number,
  height: number,
  wx: number,
  wy: number,
): { x: number; y: number } | null {
  const x = wx;
  const y = wy;
  const z = 0;
  const w = 1;
  const px = viewProj[0]! * x + viewProj[4]! * y + viewProj[8]! * z + viewProj[12]! * w;
  const py = viewProj[1]! * x + viewProj[5]! * y + viewProj[9]! * z + viewProj[13]! * w;
  const pw = viewProj[3]! * x + viewProj[7]! * y + viewProj[11]! * z + viewProj[15]! * w;
  if (Math.abs(pw) < 1e-10) return null;

  const ndcX = px / pw;
  const ndcY = py / pw;
  return {
    x: (ndcX + 1) * 0.5 * width,
    y: (1 - ndcY) * 0.5 * height,
  };
}
