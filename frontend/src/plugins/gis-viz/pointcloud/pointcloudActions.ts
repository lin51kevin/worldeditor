/**
 * Point cloud → vector workflow actions.
 *
 * Ties the {@link PlatformService} point-cloud pipeline to the plugin store and
 * the editor project store. Loading is platform-aware: desktop (Tauri) uses a
 * native file dialog + path so LAS/LAZ are supported; web reads file bytes and
 * supports PCD/PLY/XYZ.
 *
 * On Web builds, heavy WASM operations run in a dedicated Web Worker to prevent
 * UI freezes. Tauri uses native IPC which is already async.
 */
import { getPlatformService } from '../../../services';
import type { PointCloudPolyline, PointCloudSource, PointCloudSummary } from '../../../services/platform';
import { useProjectStore } from '../../../stores/projectStore';
import { usePointCloudStore } from './pointcloudState';
import {
  workerLoadPointCloud,
  workerFreePointCloud,
  workerLoadGaussianSplats,
  workerFreeGaussianSplats,
  workerExtractGround,
  workerExtractMarkings,
  workerVectorize,
  type GaussianSplatMeta,
} from '../../../workers/pointcloudBridge';

const NATIVE_EXTENSIONS = ['las', 'laz', 'pcd', 'ply', 'xyz', 'txt', 'asc'];
const WEB_EXTENSIONS = ['pcd', 'ply', 'xyz', 'txt', 'asc'];

/**
 * Splat load budget for the **native** desktop path. The 64-bit backend has no
 * wasm32 heap limit and hands the frontend only a compact half-precision buffer,
 * so a large budget keeps most/all splats of multi-million-splat clouds; the
 * GPU renderer decimates further only if the storage-buffer limit is smaller.
 */
const NATIVE_SPLAT_LOAD_BUDGET = 16_000_000;

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * Detect a 3D Gaussian Splatting PLY by scanning its ASCII header for the
 * signature splat properties (`f_dc_0`, `scale_0`, `rot_0`, `opacity`).
 *
 * Mirrors the native `ply_is_gaussian` probe (src-tauri/src/gaussian.rs) exactly
 * so web and desktop agree on which PLYs are splats: scan up to 64 KiB, restrict
 * to the region before `end_header`, and match each property name as a plain
 * substring (not a strict `property <type> <name>` pattern). This keeps the web
 * path from misclassifying a Gaussian cloud as plain points.
 */
export function isGaussianPly(bytes: Uint8Array): boolean {
  const headerLen = Math.min(bytes.length, 64 * 1024);
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, headerLen));
  const end = text.indexOf('end_header');
  const scan = end >= 0 ? text.slice(0, end) : text;
  return ['f_dc_0', 'scale_0', 'rot_0', 'opacity'].every((name) => scan.includes(name));
}

/** Build a point-cloud summary shell from Gaussian splat metadata. */
function gaussianMetaToSummary(meta: GaussianSplatMeta): PointCloudSummary {
  return {
    count: meta.count,
    origin: meta.origin,
    min: meta.min,
    max: meta.max,
    has_intensity: false,
    has_rgb: true,
    has_heightmap: false,
  };
}


function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Pick a point cloud file via the native dialog (Tauri) and return its path. */
async function pickNativePath(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    multiple: false,
    filters: [{ name: 'Point Cloud', extensions: NATIVE_EXTENSIONS }],
  });
  if (!selected) return null;
  return Array.isArray(selected) ? (selected[0] ?? null) : selected;
}

/** Read a browser File into a byte source for the WASM loader. */
async function readWebFile(file: File): Promise<PointCloudSource> {
  const ext = extensionOf(file.name);
  if (!WEB_EXTENSIONS.includes(ext)) {
    throw new Error(`Web build supports ${WEB_EXTENSIONS.join('/')}; '${ext}' needs the desktop app.`);
  }
  const buffer = await file.arrayBuffer();
  return { bytes: new Uint8Array(buffer), format: ext === 'txt' || ext === 'asc' ? 'xyz' : ext };
}

/** Free any currently-loaded cloud and reset the workflow store. */
export async function freeCurrentCloud(): Promise<void> {
  const { handle, isSplat, reset } = usePointCloudStore.getState();
  if (handle !== null) {
    try {
      if (isSplat) {
        // Web splats live in the WASM worker registry; native (desktop) splats use
        // handle 0 and are already freed on the Rust side, so skip the worker.
        if (handle > 0) await workerFreeGaussianSplats(handle);
      } else if (isTauri()) {
        const platform = await getPlatformService();
        await platform.freePointCloud(handle);
      } else {
        await workerFreePointCloud(handle);
      }
    } catch (err) {
      console.warn('[pointcloud] free failed', err);
    }
  }
  reset();
}

/**
 * Load a point cloud. On desktop a path is chosen; on web `webFile` must be the
 * user-selected file (from an `<input type="file">`).
 */
export async function loadPointCloud(webFile?: File): Promise<void> {
  const store = usePointCloudStore.getState();
  store.setBusy(true);
  store.setError(null);
  try {
    // Release a previously-loaded cloud first.
    if (store.handle !== null) {
      if (store.isSplat) {
        if (store.handle > 0) await workerFreeGaussianSplats(store.handle).catch(() => undefined);
      } else if (isTauri()) {
        const platform = await getPlatformService();
        await platform.freePointCloud(store.handle).catch(() => undefined);
      } else {
        await workerFreePointCloud(store.handle).catch(() => undefined);
      }
    }

    let fileName: string;
    if (isTauri()) {
      // Desktop: use native file dialog + IPC
      const path = await pickNativePath();
      if (!path) { usePointCloudStore.getState().setBusy(false); return; }
      fileName = path.split(/[/\\]/).pop() ?? path;
      // 3D Gaussian Splatting PLYs are parsed natively (never loaded whole into
      // JS/WASM — a multi-GB splat cloud would crash). Detect via a header-only
      // native probe, then hand the path to the native splat loader.
      if (extensionOf(path) === 'ply') {
        const { invoke } = await import('@tauri-apps/api/core');
        const isSplat = await invoke<boolean>('ply_is_gaussian', { path });
        if (isSplat) {
          const platform = await getPlatformService();
          const { meta, buffer } = await platform.loadGaussianSplatsNative(
            path,
            NATIVE_SPLAT_LOAD_BUDGET,
          );
          usePointCloudStore
            .getState()
            .setSplatLoaded(0, fileName, buffer, meta.shDegree, gaussianMetaToSummary(meta));
          return;
        }
      }
      const platform = await getPlatformService();
      const source: PointCloudSource = { path };
      const result = await platform.loadPointCloud(source, store.voxelSize);
      usePointCloudStore.getState().setLoaded(result.handle, fileName, result.summary);
    } else {
      // Web: offload to worker to avoid UI freeze
      if (!webFile) throw new Error('No file selected.');
      const source = await readWebFile(webFile);
      fileName = webFile.name;
      // Route 3DGS PLYs through the Gaussian splat pipeline.
      if (source.format === 'ply' && source.bytes && isGaussianPly(source.bytes)) {
        const { handle, meta, buffer } = await workerLoadGaussianSplats(source.bytes);
        usePointCloudStore
          .getState()
          .setSplatLoaded(handle, fileName, buffer, meta.shDegree, gaussianMetaToSummary(meta));
      } else {
        const result = await workerLoadPointCloud(source.bytes!, source.format!);
        usePointCloudStore.getState().setLoaded(result.handle, fileName, result.summary);
      }
    }
  } catch (err) {
    usePointCloudStore.getState().setError(err instanceof Error ? err.message : String(err));
  } finally {
    usePointCloudStore.getState().setBusy(false);
  }
}

/** Run ground extraction, caching a heightmap on the active handle. */
export async function extractGround(): Promise<void> {
  const store = usePointCloudStore.getState();
  if (store.handle === null) return;
  if (store.isSplat) {
    store.setError('Ground extraction is not available for 3DGS splat clouds.');
    return;
  }
  store.setBusy(true);
  store.setError(null);
  try {
    if (isTauri()) {
      const platform = await getPlatformService();
      await platform.extractPointCloudGround(store.handle);
    } else {
      await workerExtractGround(store.handle);
    }
    usePointCloudStore.getState().setGround();
  } catch (err) {
    usePointCloudStore.getState().setError(err instanceof Error ? err.message : String(err));
  } finally {
    usePointCloudStore.getState().setBusy(false);
  }
}

/** Extract candidate lane-marking polylines. */
export async function extractMarkings(): Promise<void> {
  const store = usePointCloudStore.getState();
  if (store.handle === null) return;
  if (store.isSplat) {
    store.setError('Marking extraction is not available for 3DGS splat clouds.');
    return;
  }
  store.setBusy(true);
  store.setError(null);
  try {
    let markings: PointCloudPolyline[];
    if (isTauri()) {
      const platform = await getPlatformService();
      markings = await platform.extractPointCloudMarkings(store.handle);
    } else {
      markings = await workerExtractMarkings(store.handle);
    }
    usePointCloudStore.getState().setMarkings(markings);
  } catch (err) {
    usePointCloudStore.getState().setError(err instanceof Error ? err.message : String(err));
  } finally {
    usePointCloudStore.getState().setBusy(false);
  }
}

/**
 * Vectorize the extracted markings into roads and insert them into the project
 * as a single undo step. Returns the number of roads created.
 */
export async function vectorizeToRoads(polylines?: PointCloudPolyline[]): Promise<number> {
  const store = usePointCloudStore.getState();
  if (store.handle === null) return 0;
  if (store.isSplat) {
    store.setError('Vectorization is not available for 3DGS splat clouds.');
    return 0;
  }
  const lines = polylines ?? store.markings;
  if (lines.length === 0) {
    store.setError('No marking polylines to vectorize. Run "Extract Markings" first.');
    return 0;
  }
  store.setBusy(true);
  store.setError(null);
  try {
    let roads: import('../../../services/platform').Road[];
    if (isTauri()) {
      const platform = await getPlatformService();
      roads = await platform.vectorizePointCloud(
        store.handle,
        lines,
        {},
        store.hasGround,
      );
    } else {
      roads = (await workerVectorize(
        store.handle,
        lines,
        {},
        store.hasGround,
      )) as import('../../../services/platform').Road[];
    }
    if (roads.length > 0) {
      useProjectStore.getState().addRoads(roads);
    }
    usePointCloudStore.getState().setVectorized();
    return roads.length;
  } catch (err) {
    usePointCloudStore.getState().setError(err instanceof Error ? err.message : String(err));
    return 0;
  } finally {
    usePointCloudStore.getState().setBusy(false);
  }
}
