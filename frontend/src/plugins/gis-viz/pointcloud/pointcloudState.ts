import { create } from 'zustand';
import type { PointCloudColorMode, PointCloudPolyline, PointCloudSummary } from '../../../services/platform';

/** Phase of the point-cloud → vector workflow. */
export type PointCloudStage = 'idle' | 'loaded' | 'ground' | 'markings' | 'vectorized';

interface PointCloudState {
  /** Opaque handle to the loaded cloud (native or WASM registry), or null. */
  handle: number | null;
  /** Source file name for display. */
  fileName: string | null;
  /** Summary of the loaded cloud. */
  summary: PointCloudSummary | null;
  /** Current workflow stage. */
  stage: PointCloudStage;
  /** Whether a long-running operation is in progress. */
  busy: boolean;
  /** Last error message, or null. */
  error: string | null;
  /** Render coloring mode. */
  colorMode: PointCloudColorMode;
  /** Voxel down-sample size in metres (0 = none). */
  voxelSize: number;
  /** Whether ground extraction has produced a heightmap. */
  hasGround: boolean;
  /** Extracted candidate marking polylines (local coords). */
  markings: PointCloudPolyline[];

  setColorMode: (mode: PointCloudColorMode) => void;
  setVoxelSize: (size: number) => void;
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
  setLoaded: (handle: number, fileName: string, summary: PointCloudSummary) => void;
  setGround: () => void;
  setMarkings: (markings: PointCloudPolyline[]) => void;
  setVectorized: () => void;
  reset: () => void;
}

const INITIAL = {
  handle: null,
  fileName: null,
  summary: null,
  stage: 'idle' as PointCloudStage,
  busy: false,
  error: null,
  colorMode: 'elevation' as PointCloudColorMode,
  voxelSize: 0,
  hasGround: false,
  markings: [] as PointCloudPolyline[],
};

export const usePointCloudStore = create<PointCloudState>((set) => ({
  ...INITIAL,

  setColorMode: (colorMode) => set(() => ({ colorMode })),
  setVoxelSize: (voxelSize) => set(() => ({ voxelSize: Math.max(0, voxelSize) })),
  setBusy: (busy) => set(() => ({ busy })),
  setError: (error) => set(() => ({ error })),

  setLoaded: (handle, fileName, summary) =>
    set(() => ({
      handle,
      fileName,
      summary,
      stage: 'loaded',
      hasGround: summary.has_heightmap,
      markings: [],
      error: null,
    })),

  setGround: () => set(() => ({ stage: 'ground', hasGround: true, error: null })),
  setMarkings: (markings) => set(() => ({ stage: 'markings', markings, error: null })),
  setVectorized: () => set(() => ({ stage: 'vectorized', error: null })),

  reset: () => set(() => ({ ...INITIAL })),
}));
