import { beforeEach, describe, expect, it } from 'vitest';
import { useTrajectoryStore } from './trajectoryStore';
import { parseTraj } from '../plugins/npc-actors';

const CSV = [
  'ID,Time,PositionX,PositionY,PositionZ,Length,Width,Height,Yaw,Ego',
  'ego,0,0,0,0,4.5,2,1.6,0,Y',
  'ego,1,10,0,0,4.5,2,1.6,0,Y',
  'npc,2,5,5,0,4,2,1.6,0,N',
].join('\n');

function reset(): void {
  useTrajectoryStore.getState().clear();
  useTrajectoryStore.setState({ loop: true, speed: 1 });
}

describe('trajectoryStore', () => {
  beforeEach(reset);

  it('starts empty', () => {
    const s = useTrajectoryStore.getState();
    expect(s.data).toBeNull();
    expect(s.frames).toEqual([]);
    expect(s.isPlaying).toBe(false);
  });

  it('loadData populates frames/span and parks the clock at tMin, paused', () => {
    useTrajectoryStore.getState().loadData(parseTraj(CSV));
    const s = useTrajectoryStore.getState();
    expect(s.data).not.toBeNull();
    expect(s.frames).toEqual([0, 1, 2]);
    expect(s.tMin).toBe(0);
    expect(s.tMax).toBe(2);
    expect(s.currentTime).toBe(0);
    expect(s.isPlaying).toBe(false);
  });

  it('seek clamps to [tMin, tMax]', () => {
    useTrajectoryStore.getState().loadData(parseTraj(CSV));
    useTrajectoryStore.getState().seek(1.5);
    expect(useTrajectoryStore.getState().currentTime).toBe(1.5);
    useTrajectoryStore.getState().seek(99);
    expect(useTrajectoryStore.getState().currentTime).toBe(2);
    useTrajectoryStore.getState().seek(-5);
    expect(useTrajectoryStore.getState().currentTime).toBe(0);
  });

  it('seek is a no-op with no data loaded', () => {
    useTrajectoryStore.getState().seek(5);
    expect(useTrajectoryStore.getState().currentTime).toBe(0);
  });

  it('stepFrame advances/rewinds to neighboring frame boundaries and pauses', () => {
    useTrajectoryStore.getState().loadData(parseTraj(CSV));
    useTrajectoryStore.getState().play();
    useTrajectoryStore.getState().stepFrame(1);
    expect(useTrajectoryStore.getState().currentTime).toBe(1);
    expect(useTrajectoryStore.getState().isPlaying).toBe(false);
    useTrajectoryStore.getState().stepFrame(1);
    expect(useTrajectoryStore.getState().currentTime).toBe(2);
    // Past the last frame: clamps to tMax.
    useTrajectoryStore.getState().stepFrame(1);
    expect(useTrajectoryStore.getState().currentTime).toBe(2);
    useTrajectoryStore.getState().stepFrame(-1);
    expect(useTrajectoryStore.getState().currentTime).toBe(1);
  });

  it('play restarts from tMin when parked at the end', () => {
    useTrajectoryStore.getState().loadData(parseTraj(CSV));
    useTrajectoryStore.getState().seek(2);
    useTrajectoryStore.getState().play();
    const s = useTrajectoryStore.getState();
    expect(s.isPlaying).toBe(true);
    expect(s.currentTime).toBe(0);
  });

  it('toggle flips play/pause', () => {
    useTrajectoryStore.getState().loadData(parseTraj(CSV));
    useTrajectoryStore.getState().toggle();
    expect(useTrajectoryStore.getState().isPlaying).toBe(true);
    useTrajectoryStore.getState().toggle();
    expect(useTrajectoryStore.getState().isPlaying).toBe(false);
  });

  it('setSpeed and toggleLoop update playback options', () => {
    useTrajectoryStore.getState().setSpeed(2);
    expect(useTrajectoryStore.getState().speed).toBe(2);
    const before = useTrajectoryStore.getState().loop;
    useTrajectoryStore.getState().toggleLoop();
    expect(useTrajectoryStore.getState().loop).toBe(!before);
  });

  it('clear returns to the empty state', () => {
    useTrajectoryStore.getState().loadData(parseTraj(CSV));
    useTrajectoryStore.getState().play();
    useTrajectoryStore.getState().clear();
    const s = useTrajectoryStore.getState();
    expect(s.data).toBeNull();
    expect(s.frames).toEqual([]);
    expect(s.isPlaying).toBe(false);
    expect(s.currentTime).toBe(0);
  });
});
