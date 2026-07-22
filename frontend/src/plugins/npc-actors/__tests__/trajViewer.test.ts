import { describe, it, expect } from 'vitest';

import {
  parseTraj,
  buildTrajBoxes,
  buildEgoBox,
  buildTrajSegments,
  interpPose,
  playTraj,
} from '../trajViewer';
import type { TrajViewerTarget } from '../trajViewer';
import { ACTOR_VERTEX_STRIDE } from '../actorTypes';

const CSV = [
  'ID,Time,PositionX,PositionY,PositionZ,Length,Width,Height,Yaw,Ego',
  'ego,0,0,0,0,4.5,2,1.6,0,Y',
  'ego,1,10,0,0,4.5,2,1.6,90,Y',
  'npc1,0,5,5,0,4,2,1.6,0,N',
  'npc1,2,5,15,0,4,2,1.6,0,N',
].join('\n');

describe('npc-actors/trajViewer.parseTraj', () => {
  it('groups rows by entity id and sorts by time', () => {
    const data = parseTraj(CSV);
    expect(data.entities.length).toBe(2);
    const ego = data.entities.find((e) => e.id === 'ego')!;
    expect(ego.ego).toBe(true);
    expect(ego.rows.length).toBe(2);
    expect(ego.rows[0].time).toBe(0);
    expect(ego.rows[1].x).toBe(10);
    const npc = data.entities.find((e) => e.id === 'npc1')!;
    expect(npc.ego).toBe(false);
    expect(npc.height).toBe(1.6);
  });

  it('tolerates aliased column names', () => {
    const data = parseTraj('id,time,x,y,z,yaw\ncar,0,1,2,3,45');
    expect(data.entities.length).toBe(1);
    expect(data.entities[0].rows[0].x).toBe(1);
    expect(data.entities[0].rows[0].yaw).toBe(45);
  });

  it('throws when required columns are missing', () => {
    expect(() => parseTraj('foo,bar\n1,2')).toThrow(/missing required/);
  });

  it('returns no entities for empty input', () => {
    expect(parseTraj('').entities).toEqual([]);
  });
});

describe('npc-actors/trajViewer.buildTrajBoxes', () => {
  it('interpolates an entity pose at an in-between time', () => {
    const data = parseTraj(CSV);
    const boxes = buildTrajBoxes(data, 0.5);
    const ego = boxes.find((b) => b.id === 'traj:ego')!;
    // Halfway between x=0 and x=10 at t=0.5s.
    expect(ego.position[0]).toBeCloseTo(5, 5);
    // Box center is lifted by half its height.
    expect(ego.position[2]).toBeCloseTo(0.8, 5);
    // Yaw 45° (halfway 0→90) in radians.
    expect(ego.heading).toBeCloseTo((45 * Math.PI) / 180, 5);
  });

  it('interpolates yaw across the ±180° boundary by the shortest arc', () => {
    const data = parseTraj([
      'ID,Time,PositionX,PositionY,PositionZ,Yaw,Ego',
      'ego,0,0,0,0,179,Y',
      'ego,1,1,0,0,-179,Y',
    ].join('\n'));
    const pose = interpPose(data.entities[0]!.rows, 0.5);
    expect(Math.abs(pose.yaw)).toBeCloseTo(180, 5);
  });

  it('clamps to the last pose past the end time', () => {
    const data = parseTraj(CSV);
    const boxes = buildTrajBoxes(data, 100);
    const ego = boxes.find((b) => b.id === 'traj:ego')!;
    expect(ego.position[0]).toBeCloseTo(10, 5);
  });

  it('includes the ego box by default', () => {
    const data = parseTraj(CSV);
    const boxes = buildTrajBoxes(data, 0);
    expect(boxes.some((b) => b.id === 'traj:ego')).toBe(true);
    expect(boxes.length).toBe(2);
  });

  it('excludes the ego box when includeEgo is false', () => {
    const data = parseTraj(CSV);
    const boxes = buildTrajBoxes(data, 0, { includeEgo: false });
    expect(boxes.some((b) => b.id === 'traj:ego')).toBe(false);
    expect(boxes.every((b) => b.id === 'traj:npc1')).toBe(true);
    expect(boxes.length).toBe(1);
  });
});

describe('npc-actors/trajViewer.buildEgoBox', () => {
  it('returns the ego box with the interpolated pose and size', () => {
    const data = parseTraj(CSV);
    const ego = buildEgoBox(data, 0.5)!;
    expect(ego).not.toBeNull();
    expect(ego.id).toBe('traj:ego');
    // Halfway between x=0 and x=10 at t=0.5s.
    expect(ego.position[0]).toBeCloseTo(5, 5);
    // Yaw 45° (halfway 0→90) in radians.
    expect(ego.heading).toBeCloseTo((45 * Math.PI) / 180, 5);
    expect(ego.size).toEqual([4.5, 2, 1.6]);
  });

  it('returns null when the trajectory has no ego entity', () => {
    const data = parseTraj('ID,Time,PositionX,PositionY,PositionZ,Yaw,Ego\nnpc,0,0,0,0,0,N');
    expect(buildEgoBox(data, 0)).toBeNull();
  });
});

describe('npc-actors/trajViewer.buildTrajSegments', () => {
  it('emits one 14-float segment pair per consecutive row', () => {
    const data = parseTraj(CSV);
    const seg = buildTrajSegments(data);
    // ego: 1 segment, npc1: 1 segment → 2 × 14 floats.
    expect(seg.length).toBe(2 * 14);
  });
});

describe('npc-actors/trajViewer.playTraj scene-origin alignment', () => {
  /** A capturing TrajViewerTarget for a single synchronous frame (span = 0). */
  function makeTarget() {
    const calls = {
      dimension: '' as string,
      frame: null as [number, number, number, number] | null,
      actor: new Float32Array(0),
      renders: 0,
    };
    const target: TrajViewerTarget = {
      setDimension: (d) => (calls.dimension = d),
      uploadActorVertices: (v) => (calls.actor = v),
      uploadPathVertices: () => undefined,
      frameScene3D: (minX, minY, maxX, maxY) => (calls.frame = [minX, minY, maxX, maxY]),
      render: () => (calls.renders += 1),
    };
    return { target, calls };
  }

  const SINGLE = ['ID,Time,PositionX,PositionY,PositionZ,Length,Width,Height,Yaw,Ego', 'ego,0,1000,2000,0,4.5,2,1.6,0,Y'].join(
    '\n',
  );

  it('shifts trajectory geometry and camera framing by the scene origin', () => {
    const { target, calls } = makeTarget();
    const data = parseTraj(SINGLE);
    playTraj(target, data, [1000, 2000, 0]);

    expect(calls.dimension).toBe('3d');
    // Single vertex at (1000, 2000) → framed around the origin-relative (0, 0).
    expect(calls.frame).not.toBeNull();
    expect(calls.frame![0]).toBeCloseTo(0, 5);
    expect(calls.frame![1]).toBeCloseTo(0, 5);

    // The rendered box is centered on the origin-relative (0, 0).
    const v = calls.actor;
    expect(v.length).toBeGreaterThan(0);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < v.length; i += ACTOR_VERTEX_STRIDE) {
      minX = Math.min(minX, v[i]!); maxX = Math.max(maxX, v[i]!);
      minY = Math.min(minY, v[i + 1]!); maxY = Math.max(maxY, v[i + 1]!);
    }
    expect((minX + maxX) / 2).toBeCloseTo(0, 5);
    expect((minY + maxY) / 2).toBeCloseTo(0, 5);
  });

  it('leaves geometry in absolute coords when no origin is given', () => {
    const { target, calls } = makeTarget();
    playTraj(target, parseTraj(SINGLE));
    expect(calls.frame![0]).toBeCloseTo(1000, 5);
    expect(calls.frame![1]).toBeCloseTo(2000, 5);
  });
});
