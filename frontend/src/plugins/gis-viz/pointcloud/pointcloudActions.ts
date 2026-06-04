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
import type { PointCloudPolyline, PointCloudSource } from '../../../services/platform';
import { useProjectStore } from '../../../stores/projectStore';
import { usePointCloudStore } from './pointcloudState';
import {
  workerLoadPointCloud,
  workerFreePointCloud,
  workerExtractGround,
  workerExtractMarkings,
  workerVectorize,
} from '../../../workers/pointcloudBridge';

const NATIVE_EXTENSIONS = ['las', 'laz', 'pcd', 'ply', 'xyz', 'txt', 'asc'];
const WEB_EXTENSIONS = ['pcd', 'ply', 'xyz', 'txt', 'asc'];

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
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
  const { handle, reset } = usePointCloudStore.getState();
  if (handle !== null) {
    try {
      if (isTauri()) {
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
      if (isTauri()) {
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
      const platform = await getPlatformService();
      const source: PointCloudSource = { path };
      const result = await platform.loadPointCloud(source, store.voxelSize);
      usePointCloudStore.getState().setLoaded(result.handle, fileName, result.summary);
    } else {
      // Web: offload to worker to avoid UI freeze
      if (!webFile) throw new Error('No file selected.');
      const source = await readWebFile(webFile);
      fileName = webFile.name;
      const result = await workerLoadPointCloud(source.bytes!, source.format!);
      usePointCloudStore.getState().setLoaded(result.handle, fileName, result.summary);
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
