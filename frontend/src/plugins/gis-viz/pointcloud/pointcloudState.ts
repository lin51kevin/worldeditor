import { create } from 'zustand';
import type { PointCloudColorMode, PointCloudPolyline, PointCloudSummary } from '../../../services/platform';
import type {
  SplatSampleMode,
  SplatRenderMode,
  SplatUploadStatus,
} from '../../../viewport/gaussian/splatRenderer';
import { DEFAULT_SPLAT_DILATION } from '../../../viewport/gaussian/splatUniform';

/** Phase of the point-cloud → vector workflow. */
export type PointCloudStage = 'idle' | 'loaded' | 'ground' | 'markings' | 'vectorized';

interface PointCloudState {
  /** Opaque handle to the loaded cloud (native or WASM registry), or null. */
  handle: number | null;
  /**
   * Which registry the current `handle` belongs to. Plain point clouds can be
   * loaded either through the native IPC registry (desktop path/LAS/LAZ) or the
   * WASM Web Worker registry (file-input path — used even inside the Tauri
   * webview by the File→Import menu / Ctrl+Alt+P). The render buffer MUST be
   * fetched from the same backend that produced the handle, so this flag is the
   * source of truth instead of a runtime `isTauri()` check.
   */
  nativeBackend: boolean;
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
  /** Whether ground extraction has produced a heightmap. */
  hasGround: boolean;
  /** Extracted candidate marking polylines (local coords). */
  markings: PointCloudPolyline[];

  /** Whether the loaded cloud is a 3D Gaussian Splatting cloud (rendered as splats). */
  isSplat: boolean;
  /** Versioned f32-transform/f16-opacity-SH instance buffer when `isSplat`. */
  splatBuffer: Uint32Array | null;
  /** Whether {@link splatBuffer} is already shifted into the absolute world frame (web worker did it). */
  splatOriginShifted: boolean;
  /** SH degree of the loaded splat cloud. */
  splatShDegree: number;
  /** Version of the packed transform/SH buffer layout. */
  splatLayoutVersion: number;
  /** 2D low-pass dilation (splat fullness); larger = fuller/blurrier. */
  splatDilation: number;
  /** Diagnostic encoding for inputs whose decoded SH colour is linear. */
  splatEncodeLinearToSrgb: boolean;
  /** How oversized splat clouds are reduced to fit the GPU budget. */
  splatSampleMode: SplatSampleMode;
  /** Whether to render every splat (`full`) or reduce to a budget (`decimated`). */
  splatRenderMode: SplatRenderMode;
  /** Fraction (0..1] of the cloud's splats to keep (fidelity vs memory). */
  splatQuality: number;
  /** Splat depth re-sort (refresh) rate cap in FPS; 0 = realtime (no cap). */
  splatRefreshFps: number;
  /** Fidelity/resource result from the most recent GPU upload attempt. */
  splatUploadStatus: SplatUploadStatus | null;

  setColorMode: (mode: PointCloudColorMode) => void;
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
  setSplatDilation: (dilation: number) => void;
  setSplatEncodeLinearToSrgb: (enabled: boolean) => void;
  setSplatSampleMode: (mode: SplatSampleMode) => void;
  setSplatRenderMode: (mode: SplatRenderMode) => void;
  setSplatQuality: (quality: number) => void;
  setSplatRefreshFps: (fps: number) => void;
  setSplatUploadStatus: (status: SplatUploadStatus | null) => void;
  setLoaded: (handle: number, fileName: string, summary: PointCloudSummary, nativeBackend: boolean) => void;
  setSplatLoaded: (
    handle: number,
    fileName: string,
    buffer: Uint32Array | null,
    shDegree: number,
    layoutVersion: number,
    summary: PointCloudSummary,
    originShifted?: boolean,
  ) => void;
  setGround: () => void;
  setMarkings: (markings: PointCloudPolyline[]) => void;
  setVectorized: () => void;
  reset: () => void;
}

const INITIAL = {
  handle: null,
  nativeBackend: false,
  fileName: null,
  summary: null,
  stage: 'idle' as PointCloudStage,
  busy: false,
  error: null,
  colorMode: 'elevation' as PointCloudColorMode,
  hasGround: false,
  markings: [] as PointCloudPolyline[],
  isSplat: false,
  splatBuffer: null as Uint32Array | null,
  splatOriginShifted: false,
  splatShDegree: 0,
  splatLayoutVersion: 0,
  splatDilation: DEFAULT_SPLAT_DILATION,
  splatEncodeLinearToSrgb: false,
  splatSampleMode: 'importance' as SplatSampleMode,
  splatRenderMode: 'full' as SplatRenderMode,
  splatQuality: 1,
  splatRefreshFps: 30,
  splatUploadStatus: null as SplatUploadStatus | null,
};

export const usePointCloudStore = create<PointCloudState>((set) => ({
  ...INITIAL,

  setColorMode: (colorMode) => set(() => ({ colorMode })),
  setBusy: (busy) => set(() => ({ busy })),
  setError: (error) => set(() => ({ error })),
  setSplatDilation: (splatDilation) => set(() => ({ splatDilation: Math.max(0, splatDilation) })),
  setSplatEncodeLinearToSrgb: (splatEncodeLinearToSrgb) => set(() => ({ splatEncodeLinearToSrgb })),
  setSplatSampleMode: (splatSampleMode) => set(() => ({ splatSampleMode })),
  setSplatRenderMode: (splatRenderMode) => set(() => ({ splatRenderMode })),
  setSplatQuality: (splatQuality) => set(() => ({ splatQuality: Math.min(1, Math.max(0.05, splatQuality)) })),
  setSplatRefreshFps: (splatRefreshFps) => set(() => ({ splatRefreshFps: Math.max(0, splatRefreshFps) })),
  setSplatUploadStatus: (splatUploadStatus) => set(() => ({ splatUploadStatus })),

  setLoaded: (handle, fileName, summary, nativeBackend) =>
    set(() => ({
      handle,
      nativeBackend,
      fileName,
      summary,
      stage: 'loaded',
      hasGround: summary.has_heightmap,
      markings: [],
      error: null,
      isSplat: false,
      splatBuffer: null,
      splatOriginShifted: false,
      splatShDegree: 0,
      splatLayoutVersion: 0,
      splatUploadStatus: null,
    })),

  setSplatLoaded: (handle, fileName, buffer, shDegree, layoutVersion, summary, originShifted = false) =>
    set(() => ({
      handle,
      // Splats render straight from `splatBuffer`; the render-buffer backend
      // flag is irrelevant here but reset so a later plain-cloud read is clean.
      nativeBackend: false,
      fileName,
      summary,
      stage: 'loaded',
      hasGround: false,
      markings: [],
      error: null,
      isSplat: true,
      splatBuffer: buffer,
      splatOriginShifted: originShifted,
      splatShDegree: shDegree,
      splatLayoutVersion: layoutVersion,
      splatUploadStatus: null,
    })),

  setGround: () => set(() => ({ stage: 'ground', hasGround: true, error: null })),
  setMarkings: (markings) => set(() => ({ stage: 'markings', markings, error: null })),
  setVectorized: () => set(() => ({ stage: 'vectorized', error: null })),

  reset: () => set(() => ({ ...INITIAL })),
}));
