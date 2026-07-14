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

  /** Whether the loaded cloud is a 3D Gaussian Splatting cloud (rendered as splats). */
  isSplat: boolean;
  /** Packed half-precision 3DGS SH instance buffer (`splatStrideForDegree` u32 words/splat) when `isSplat`, else null. */
  splatBuffer: Uint32Array | null;
  /** SH degree of the loaded splat cloud. */
  splatShDegree: number;
  /** 2D low-pass dilation (splat fullness); larger = fuller/blurrier. */
  splatDilation: number;

  setColorMode: (mode: PointCloudColorMode) => void;
  setVoxelSize: (size: number) => void;
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
  setSplatDilation: (dilation: number) => void;
  setLoaded: (handle: number, fileName: string, summary: PointCloudSummary) => void;
  setSplatLoaded: (
    handle: number,
    fileName: string,
    buffer: Uint32Array,
    shDegree: number,
    summary: PointCloudSummary,
  ) => void;
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
  isSplat: false,
  splatBuffer: null as Uint32Array | null,
  splatShDegree: 0,
  splatDilation: 0.15,
};

export const usePointCloudStore = create<PointCloudState>((set) => ({
  ...INITIAL,

  setColorMode: (colorMode) => set(() => ({ colorMode })),
  setVoxelSize: (voxelSize) => set(() => ({ voxelSize: Math.max(0, voxelSize) })),
  setBusy: (busy) => set(() => ({ busy })),
  setError: (error) => set(() => ({ error })),
  setSplatDilation: (splatDilation) => set(() => ({ splatDilation: Math.max(0, splatDilation) })),

  setLoaded: (handle, fileName, summary) =>
    set(() => ({
      handle,
      fileName,
      summary,
      stage: 'loaded',
      hasGround: summary.has_heightmap,
      markings: [],
      error: null,
      isSplat: false,
      splatBuffer: null,
      splatShDegree: 0,
    })),

  setSplatLoaded: (handle, fileName, buffer, shDegree, summary) =>
    set(() => ({
      handle,
      fileName,
      summary,
      stage: 'loaded',
      hasGround: false,
      markings: [],
      error: null,
      isSplat: true,
      splatBuffer: buffer,
      splatShDegree: shDegree,
    })),

  setGround: () => set(() => ({ stage: 'ground', hasGround: true, error: null })),
  setMarkings: (markings) => set(() => ({ stage: 'markings', markings, error: null })),
  setVectorized: () => set(() => ({ stage: 'vectorized', error: null })),

  reset: () => set(() => ({ ...INITIAL })),
}));
