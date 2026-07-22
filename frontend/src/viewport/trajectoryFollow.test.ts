import { describe, expect, it } from 'vitest';
import { smoothFollowPose, type FollowPose } from './trajectoryFollow';

const pose = (overrides: Partial<FollowPose> = {}): FollowPose => ({
  x: 0,
  y: 0,
  z: 0,
  yaw: 0,
  ...overrides,
});

describe('smoothFollowPose', () => {
  it('snaps the first sample so enabling follow has no startup drift', () => {
    expect(smoothFollowPose(null, pose({ x: 10, z: 2 }), 1 / 60)).toEqual(
      pose({ x: 10, z: 2 }),
    );
  });

  it('attenuates position and elevation noise with frame-rate-independent damping', () => {
    const result = smoothFollowPose(
      pose(),
      pose({ x: 1, y: -1, z: 0.5 }),
      1 / 60,
    );
    expect(result.x).toBeGreaterThan(0);
    expect(result.x).toBeLessThan(1);
    expect(result.y).toBeLessThan(0);
    expect(result.y).toBeGreaterThan(-1);
    expect(result.z).toBeGreaterThan(0);
    expect(result.z).toBeLessThan(0.5);
  });

  it('eases heading toward the target yaw without snapping', () => {
    const result = smoothFollowPose(pose({ yaw: 0 }), pose({ yaw: 1 }), 1 / 60);
    expect(result.yaw).toBeGreaterThan(0);
    expect(result.yaw).toBeLessThan(1);
  });

  it('smooths heading across the ±π wrap along the shortest arc', () => {
    const result = smoothFollowPose(
      pose({ yaw: (179 * Math.PI) / 180 }),
      pose({ yaw: (-179 * Math.PI) / 180 }),
      1 / 60,
    );
    // Positions are unchanged (no teleport): the heading must ease the short way
    // (through ±π), so |yaw| grows past 179° rather than unwinding through 0°.
    expect(Math.abs(result.yaw)).toBeGreaterThan((179 * Math.PI) / 180);
  });

  it('snaps teleports instead of easing across a loop boundary', () => {
    const target = pose({ x: 100, y: 100, z: 10, yaw: 2 });
    expect(smoothFollowPose(pose(), target, 1 / 60)).toEqual(target);
  });
});
