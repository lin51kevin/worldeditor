import { create } from 'zustand';
import type { TrajData } from '../plugins/npc-actors';
import { trajFrames, trajTimeSpan } from '../plugins/npc-actors';

/** Selectable playback rates (× real-time). */
export const TRAJECTORY_SPEEDS = [0.25, 0.5, 1, 2, 4] as const;
export type TrajectorySpeed = (typeof TRAJECTORY_SPEEDS)[number];

interface TrajectoryState {
  /** Loaded trajectory data, or null when nothing is loaded. */
  data: TrajData | null;
  /** Sorted, de-duplicated distinct timestamps (frame boundaries). */
  frames: number[];
  /** First timestamp in the trajectory. */
  tMin: number;
  /** Last timestamp in the trajectory. */
  tMax: number;
  /** Current playback time (seconds, absolute — same scale as the file). */
  currentTime: number;
  /** Whether the RAF playback loop is advancing time. */
  isPlaying: boolean;
  /** Whether playback restarts from tMin after reaching tMax. */
  loop: boolean;
  /** Playback rate multiplier. */
  speed: TrajectorySpeed;
  /** Whether the camera tracks the ego vehicle during playback. */
  followEgo: boolean;

  /** Replace the loaded trajectory, reset the clock to its start, and pause. */
  loadData: (data: TrajData) => void;
  /** Unload everything and return to the empty state. */
  clear: () => void;
  /** Start advancing time. Restarts from tMin if currently at the end. */
  play: () => void;
  /** Stop advancing time. */
  pause: () => void;
  /** Toggle play/pause. */
  toggle: () => void;
  /** Seek to an absolute time, clamped to [tMin, tMax]. */
  seek: (time: number) => void;
  /** Jump to the previous/next distinct frame boundary. */
  stepFrame: (direction: 1 | -1) => void;
  /** Set the playback rate multiplier. */
  setSpeed: (speed: TrajectorySpeed) => void;
  /** Toggle loop-at-end behavior. */
  toggleLoop: () => void;
  /** Toggle follow-ego camera mode. */
  toggleFollowEgo: () => void;
}

const EMPTY = {
  data: null,
  frames: [] as number[],
  tMin: 0,
  tMax: 0,
  currentTime: 0,
  isPlaying: false,
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const useTrajectoryStore = create<TrajectoryState>((set, get) => ({
  ...EMPTY,
  loop: true,
  speed: 1,
  followEgo: false,

  loadData: (data) => {
    const frames = trajFrames(data);
    const [spanMin, spanMax] = trajTimeSpan(data);
    const tMin = Number.isFinite(spanMin) ? spanMin : 0;
    const tMax = Number.isFinite(spanMax) ? spanMax : tMin;
    set({ data, frames, tMin, tMax, currentTime: tMin, isPlaying: false });
  },

  clear: () => set({ ...EMPTY, followEgo: false }),

  play: () => {
    const { data, currentTime, tMin, tMax } = get();
    if (!data) return;
    // Restart from the beginning if the playhead is parked at the end.
    const at = currentTime >= tMax ? tMin : currentTime;
    set({ isPlaying: true, currentTime: at });
  },

  pause: () => set({ isPlaying: false }),

  toggle: () => (get().isPlaying ? get().pause() : get().play()),

  seek: (time) => {
    const { data, tMin, tMax } = get();
    if (!data) return;
    set({ currentTime: clamp(time, tMin, tMax) });
  },

  stepFrame: (direction) => {
    const { data, frames, currentTime, tMin, tMax } = get();
    if (!data || frames.length === 0) return;
    // Small epsilon so a playhead sitting exactly on a frame still advances.
    const eps = 1e-6;
    let target: number;
    if (direction > 0) {
      target = frames.find((f) => f > currentTime + eps) ?? tMax;
    } else {
      const prev = [...frames].reverse().find((f) => f < currentTime - eps);
      target = prev ?? tMin;
    }
    set({ isPlaying: false, currentTime: clamp(target, tMin, tMax) });
  },

  setSpeed: (speed) => set({ speed }),

  toggleLoop: () => set((s) => ({ loop: !s.loop })),

  toggleFollowEgo: () => set((s) => ({ followEgo: !s.followEgo })),
}));
