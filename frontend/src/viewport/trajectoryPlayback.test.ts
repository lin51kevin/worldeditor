import { beforeEach, describe, expect, it, vi } from 'vitest';

const renderer = vi.hoisted(() => ({
  setDimension: vi.fn(),
  uploadActorVertices: vi.fn(),
  uploadPathVertices: vi.fn(),
  uploadEgoMeshIndexed: vi.fn(),
  clearEgoMesh: vi.fn(),
  render: vi.fn(),
  setChaseCam3D: vi.fn(),
  setChaseCameraActive: vi.fn(),
  frameScene3D: vi.fn(),
}));

vi.mock('./viewportRef', () => ({
  getViewportRenderer: () => renderer,
}));
vi.mock('./egoModel', () => ({
  loadEgoModelTemplate: vi.fn().mockResolvedValue(null),
  buildEgoMeshVertices: vi.fn(),
}));

import { parseTraj } from '../plugins/npc-actors';
import { useTrajectoryStore } from '../stores/trajectoryStore';
import { startTrajectory, stopTrajectory } from './trajectoryPlayback';

const DATA = parseTraj([
  'ID,Time,PositionX,PositionY,PositionZ,Length,Width,Height,Yaw,Ego',
  'ego,0,0,0,1,4.5,2,1.6,0,Y',
  'ego,1,10,0,3,4.5,2,1.6,20,Y',
].join('\n'));

describe('trajectory follow playback', () => {
  beforeEach(() => {
    stopTrajectory();
    vi.clearAllMocks();
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  it('updates the follow camera before actor upload without a synchronous extra render', () => {
    startTrajectory(DATA);
    useTrajectoryStore.getState().toggleFollowEgo();
    expect(renderer.setChaseCameraActive).toHaveBeenLastCalledWith(true);
    vi.clearAllMocks();

    useTrajectoryStore.getState().seek(0.5);

    expect(renderer.setChaseCam3D).toHaveBeenCalledTimes(1);
    expect(renderer.render).not.toHaveBeenCalled();
    expect(renderer.setChaseCam3D.mock.invocationCallOrder[0]).toBeLessThan(
      renderer.uploadActorVertices.mock.invocationCallOrder[0]!,
    );
    expect(renderer.setChaseCam3D.mock.calls[0]![2]).toBeGreaterThan(1);

    const vertices = renderer.uploadActorVertices.mock.calls[0]![0] as Float32Array;
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < vertices.length; i += 7) {
      minX = Math.min(minX, vertices[i]!);
      maxX = Math.max(maxX, vertices[i]!);
    }
    expect((minX + maxX) / 2).toBeCloseTo(
      renderer.setChaseCam3D.mock.calls[0]![0],
      5,
    );

    useTrajectoryStore.getState().toggleFollowEgo();
    expect(renderer.setChaseCameraActive).toHaveBeenLastCalledWith(false);
  });
});
