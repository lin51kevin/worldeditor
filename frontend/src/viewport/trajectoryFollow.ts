/** Pose used by the trajectory chase-camera filter. */
export interface FollowPose {
  x: number;
  y: number;
  z: number;
  /** Heading in radians. */
  yaw: number;
}

/** Camera response time: lower follows more tightly, higher removes more noise. */
const FOLLOW_TIME_CONSTANT_SECONDS = 0.12;
/**
 * Heading response time. The caller supplies a travel-direction heading (stable
 * within each linear trajectory segment), so this only needs to ease turns —
 * it is a touch slower than position because the chase camera hangs ~18 m
 * behind along the heading, amplifying any residual angular change.
 */
const FOLLOW_YAW_TIME_CONSTANT_SECONDS = 0.2;
/** Large discontinuities are loop/seek teleports and must not be eased through. */
const FOLLOW_TELEPORT_DISTANCE = 25;
/** Avoid a single delayed frame advancing the filter by an unbounded interval. */
const MAX_FOLLOW_DELTA_SECONDS = 0.1;

function shortestAngleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/**
 * Apply frame-rate-independent exponential damping to a chase-camera pose.
 *
 * The first sample and discontinuous teleports snap immediately. Position and
 * heading are eased independently; heading follows the shortest wrapped arc so
 * a ±π transition does not spin the camera. The caller is responsible for
 * choosing a stable `target.yaw` (the trajectory playback derives it from the
 * direction of travel, which is constant within a linear segment and therefore
 * far less jittery than a per-sample recorded heading).
 */
export function smoothFollowPose(
  previous: FollowPose | null,
  target: FollowPose,
  deltaSeconds: number,
): FollowPose {
  if (!previous) return { ...target };

  const distance = Math.hypot(
    target.x - previous.x,
    target.y - previous.y,
    target.z - previous.z,
  );
  if (distance >= FOLLOW_TELEPORT_DISTANCE) return { ...target };

  const dt = Math.min(MAX_FOLLOW_DELTA_SECONDS, Math.max(0, deltaSeconds));
  const alpha = 1 - Math.exp(-dt / FOLLOW_TIME_CONSTANT_SECONDS);
  const yawAlpha = 1 - Math.exp(-dt / FOLLOW_YAW_TIME_CONSTANT_SECONDS);
  const yaw = previous.yaw + shortestAngleDelta(previous.yaw, target.yaw) * yawAlpha;
  return {
    x: previous.x + (target.x - previous.x) * alpha,
    y: previous.y + (target.y - previous.y) * alpha,
    z: previous.z + (target.z - previous.z) * alpha,
    yaw: Math.atan2(Math.sin(yaw), Math.cos(yaw)),
  };
}
