/**
 * Fly-mode (Unreal-style free-roaming) camera logic — extracted from
 * cameraController.ts. Pure functions that operate on an explicit FlyState +
 * shared CameraState, invoking the provided callbacks for view-dirty / scale
 * reporting side effects so the controller keeps ownership of those.
 */
import type { CameraState } from './cameraController';

/** Fly mode: default movement speed in meters per second. */
const DEFAULT_FLY_SPEED = 20;
/** Fly mode: minimum fly speed. */
const MIN_FLY_SPEED = 0.5;
/** Fly mode: maximum fly speed. */
const MAX_FLY_SPEED = 5000;
/** Fly mode: sprint multiplier when Shift is held. */
const FLY_SPRINT_MULTIPLIER = 3.0;
/** Fly mode: mouse sensitivity for yaw/pitch. */
const FLY_LOOK_SENSITIVITY = 0.003;
/** Fly mode: maximum pitch angle (radians, slightly less than 90°). */
const FLY_MAX_PITCH = Math.PI / 2 - 0.01;

export interface FlyState {
  /** Whether the camera is in free-roaming fly mode. */
  mode: boolean;
  /** Yaw angle in radians (horizontal rotation around Z axis). */
  yaw: number;
  /** Pitch angle in radians (vertical tilt, positive = looking up). */
  pitch: number;
  /** Movement speed in meters per second. */
  speed: number;
}

export function createFlyState(): FlyState {
  return { mode: false, yaw: 0, pitch: 0, speed: DEFAULT_FLY_SPEED };
}

/**
 * Enter fly mode. Computes initial yaw/pitch from the current camera
 * position → target direction. Only works in 3D mode and when not locked.
 */
export function flyEnter(fly: FlyState, camera: CameraState, locked: boolean, is2d: boolean): void {
  if (locked || is2d) return;
  if (fly.mode) return;

  const [px, py, pz] = camera.position;
  const [tx, ty, tz] = camera.target;
  const dx = tx - px;
  const dy = ty - py;
  const dz = tz - pz;

  fly.yaw = Math.atan2(dy, dx);
  const horizDist = Math.sqrt(dx * dx + dy * dy);
  fly.pitch = Math.atan2(dz, horizDist);

  // Auto-scale fly speed based on current camera distance
  const camDist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  fly.speed = Math.max(MIN_FLY_SPEED, Math.min(MAX_FLY_SPEED, camDist * 0.15));

  fly.mode = true;
}

/**
 * Exit fly mode. Rebuilds the target point at a reasonable distance in front
 * of the camera along the current look direction, preserving visual continuity
 * when returning to orbit mode.
 */
export function flyExit(fly: FlyState, camera: CameraState, onChange: () => void, reportScale: () => void): void {
  if (!fly.mode) return;
  fly.mode = false;

  // Rebuild target at a distance proportional to camera height (natural orbit radius)
  const [px, py, pz] = camera.position;
  const cosPitch = Math.cos(fly.pitch);
  const lookX = Math.cos(fly.yaw) * cosPitch;
  const lookY = Math.sin(fly.yaw) * cosPitch;
  const lookZ = Math.sin(fly.pitch);
  const targetDist = Math.max(10, Math.abs(pz) * 0.5);
  camera.target = [
    px + lookX * targetDist,
    py + lookY * targetDist,
    pz + lookZ * targetDist,
  ];
  camera.up = [0, 0, 1];
  camera.near = Math.max(0.1, targetDist * 0.001);
  camera.far = Math.max(100000, targetDist * 100);

  onChange();
  reportScale();
}

/**
 * Rotate the camera view direction by mouse delta (mouselook).
 * dx/dy are raw pixel deltas from mouse movement.
 */
export function flyLook(fly: FlyState, camera: CameraState, dx: number, dy: number, onChange: () => void): void {
  if (!fly.mode) return;

  fly.yaw += dx * FLY_LOOK_SENSITIVITY;
  fly.pitch -= dy * FLY_LOOK_SENSITIVITY;
  fly.pitch = Math.max(-FLY_MAX_PITCH, Math.min(FLY_MAX_PITCH, fly.pitch));

  // Update target from yaw/pitch
  const [px, py, pz] = camera.position;
  const cosPitch = Math.cos(fly.pitch);
  const lookX = Math.cos(fly.yaw) * cosPitch;
  const lookY = Math.sin(fly.yaw) * cosPitch;
  const lookZ = Math.sin(fly.pitch);
  camera.target = [px + lookX, py + lookY, pz + lookZ];
  camera.up = [0, 0, 1];

  onChange();
}

/**
 * Move the camera in fly mode. Direction inputs are unit-scale (-1 to 1).
 *
 * @param forward - Forward/backward (W/S: +1/-1)
 * @param right   - Strafe left/right (A/D: -1/+1)
 * @param up      - Up/down (E/Q: +1/-1)
 * @param deltaTime - Frame time in seconds
 * @param sprint  - Whether sprint (Shift) is held
 */
export function flyMove(
  fly: FlyState,
  camera: CameraState,
  forward: number,
  right: number,
  up: number,
  deltaTime: number,
  sprint: boolean,
  onChange: () => void,
  reportScale: () => void,
): void {
  if (!fly.mode) return;

  const speed = fly.speed * (sprint ? FLY_SPRINT_MULTIPLIER : 1.0);
  const distance = speed * deltaTime;

  // Forward direction (projected on horizontal plane for WASD, full 3D for vertical)
  const cosPitch = Math.cos(fly.pitch);
  const fwdX = Math.cos(fly.yaw) * cosPitch;
  const fwdY = Math.sin(fly.yaw) * cosPitch;
  const fwdZ = Math.sin(fly.pitch);

  // Right direction (perpendicular to forward on XY plane)
  const rightX = Math.cos(fly.yaw - Math.PI / 2);
  const rightY = Math.sin(fly.yaw - Math.PI / 2);

  // Compute total displacement
  const moveX = (fwdX * forward + rightX * right) * distance;
  const moveY = (fwdY * forward + rightY * right) * distance;
  const moveZ = (fwdZ * forward + up) * distance;

  const [px, py, pz] = camera.position;
  camera.position = [px + moveX, py + moveY, pz + moveZ];
  // Keep target at unit distance in look direction
  const lookX = Math.cos(fly.yaw) * cosPitch;
  const lookY = Math.sin(fly.yaw) * cosPitch;
  const lookZ = Math.sin(fly.pitch);
  camera.target = [
    px + moveX + lookX,
    py + moveY + lookY,
    pz + moveZ + lookZ,
  ];

  onChange();
  reportScale();
}

/** Adjust fly speed via scroll wheel delta. */
export function flyAdjustSpeed(fly: FlyState, deltaY: number): void {
  const notches = deltaY / 120;
  fly.speed *= Math.pow(1.15, -notches);
  fly.speed = Math.max(MIN_FLY_SPEED, Math.min(MAX_FLY_SPEED, fly.speed));
}
