/**
 * Tauri desktop platform adapter.
 * Calls Rust backend via Tauri's invoke IPC for file I/O.
 * Geometry/rendering operations delegate to WASM via BasePlatformService.
 */

import type {
  PlatformService, Project, Road,
  PointCloudColorMode, PointCloudLoadResult, PointCloudPolyline, PointCloudSource,
  GaussianSplatNativeResult,
} from './platform';
import { APP_VERSION } from './index';
import { BasePlatformService } from './basePlatformService';

function normalizeDialogPath(value: string | string[] | null): string | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    return value.length > 0 ? value[0]! : null;
  }
  return value;
}

export class TauriPlatformService extends BasePlatformService implements PlatformService {
  async parseOpenDrive(xml: string): Promise<Project> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('parse_opendrive', { xml });
  }

  async writeOpenDrive(project: Project): Promise<string> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('write_opendrive', { project });
  }

  /**
   * Show OS file-picker dialog, return normalised absolute path without
   * reading the file. Callers can show a progress overlay before the read.
   */
  async openFilePath(): Promise<string | null> {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const rawPath = await open({
      filters: [
        { name: 'OpenDRIVE / GeoZ', extensions: ['xodr', 'xml', 'geoz'] },
      ],
    });
    const filePath = normalizeDialogPath(rawPath);
    if (!filePath) return null;

    // Normalize to an absolute path (handles UNC / mapped drives on Windows).
    if (!filePath.match(/^(?:[A-Za-z]:\\|\\\\|\/)/)) {
      try {
        const { resolve } = await import('@tauri-apps/api/path');
        return await resolve(filePath);
      } catch {
        console.warn('[openFilePath] Could not resolve absolute path for:', filePath);
      }
    }
    return filePath;
  }

  async openFile(): Promise<{ name: string; content: string; buffer?: ArrayBuffer; path?: string } | null> {
    const filePath = await this.openFilePath();
    if (!filePath) return null;
    const name = filePath.split(/[/\\]/).pop() ?? 'untitled';
    try {
      // Binary formats (e.g. .geoz) need ArrayBuffer, not text
      if (/\.geoz$/i.test(filePath)) {
        const { readFile } = await import('@tauri-apps/plugin-fs');
        const bytes = await readFile(filePath);
        return { name, content: '', buffer: bytes.buffer as ArrayBuffer, path: filePath };
      }
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const content = await readTextFile(filePath);
      return { name, content, path: filePath };
    } catch (error) {
      throw new Error(`Failed to read selected file: ${String(error)}`, { cause: error });
    }
  }

  async openFileByPath(filePath: string): Promise<{ name: string; content: string; buffer?: ArrayBuffer } | null> {
    try {
      const name = filePath.split(/[/\\]/).pop() ?? filePath;
      // Binary formats (e.g. .geoz) need ArrayBuffer, not text.
      if (/\.geoz$/i.test(filePath)) {
        const { readFile } = await import('@tauri-apps/plugin-fs');
        const bytes = await readFile(filePath);
        return { name, content: '', buffer: bytes.buffer as ArrayBuffer };
      }
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const content = await readTextFile(filePath);
      return { name, content };
    } catch {
      return null;
    }
  }

  async saveFile(filename: string, content: string): Promise<string | null> {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');

    const rawPath = await save({
      defaultPath: filename,
      filters: [{ name: 'OpenDRIVE', extensions: ['xodr'] }],
    });
    const path = normalizeDialogPath(rawPath);

    if (path) {
      try {
        await writeTextFile(path, content);
      } catch (error) {
        throw new Error(`Failed to write file: ${String(error)}`, { cause: error });
      }
      return path;
    }
    return null;
  }

  getPlatformInfo() {
    return { type: 'tauri' as const, version: APP_VERSION };
  }

  // --- Point cloud → vector pipeline (native: path-based, supports LAS/LAZ) ---

  override async loadPointCloud(source: PointCloudSource, voxelSize = 0): Promise<PointCloudLoadResult> {
    if (!source.path) {
      // Fall back to the WASM byte loader if no path is available.
      return super.loadPointCloud(source, voxelSize);
    }
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<PointCloudLoadResult>('point_cloud_load', {
      path: source.path,
      voxelSize: voxelSize > 0 ? voxelSize : null,
    });
  }

  override async freePointCloud(handle: number): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('point_cloud_free', { handle });
  }

  override async pointCloudRenderBuffer(handle: number, colorMode: PointCloudColorMode, maxPoints: number): Promise<Float32Array> {
    const { invoke } = await import('@tauri-apps/api/core');
    const data = await invoke<number[]>('point_cloud_render_buffer', { handle, colorMode, maxPoints });
    // Backend returns raw bytes (Vec<u8> transmuted from Vec<f32>) for performance.
    const bytes = new Uint8Array(data);
    return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  }

  override async extractPointCloudGround(handle: number, config: Record<string, unknown> = {}): Promise<unknown> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('point_cloud_extract_ground', { handle, configJson: JSON.stringify(config) });
  }

  override async extractPointCloudMarkings(handle: number, config: Record<string, unknown> = {}): Promise<PointCloudPolyline[]> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<PointCloudPolyline[]>('point_cloud_extract_markings', { handle, configJson: JSON.stringify(config) });
  }

  override async vectorizePointCloud(
    handle: number,
    polylines: PointCloudPolyline[],
    config: Record<string, unknown> = {},
    useGround = false,
  ): Promise<Road[]> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<Road[]>('point_cloud_vectorize', {
      handle,
      polylinesJson: JSON.stringify(polylines),
      configJson: JSON.stringify(config),
      useGround,
    });
  }

  override async samplePointCloudGround(handle: number, x: number, y: number): Promise<number | null> {
    const { invoke } = await import('@tauri-apps/api/core');
    const value = await invoke<number | null>('point_cloud_sample_ground', { handle, x, y });
    return value ?? null;
  }

  override async loadGaussianSplatsNative(path: string, maxSplats?: number): Promise<GaussianSplatNativeResult> {
    const { invoke } = await import('@tauri-apps/api/core');
    // Parse natively (bounded only for explicit decimation), then fetch raw bytes.
    const { handle, meta } = await invoke<{ handle: number; meta: GaussianSplatNativeResult['meta'] }>(
      'gaussian_splat_load',
      { path, maxSplats: maxSplats ?? null },
    );
    try {
      const raw = await invoke<ArrayBuffer>('gaussian_splat_buffer', { handle });
      const buffer = new Uint32Array(raw);
      return { meta, buffer };
    } finally {
      await invoke('gaussian_splat_free', { handle }).catch(() => undefined);
    }
  }
}
