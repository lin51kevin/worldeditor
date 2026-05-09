/**
 * Tauri desktop platform adapter.
 * Calls Rust backend via Tauri's invoke IPC.
 */
import type { GisCoord, PlatformService, Project, UtmCoord } from './platform';

export class TauriPlatformService implements PlatformService {
  async parseOpenDrive(xml: string): Promise<Project> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('parse_opendrive', { xml });
  }

  async writeOpenDrive(project: Project): Promise<string> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('write_opendrive', { project });
  }

  async openFile(): Promise<{ name: string; content: string } | null> {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readTextFile } = await import('@tauri-apps/plugin-fs');

    const path = await open({
      filters: [{ name: 'OpenDRIVE', extensions: ['xodr', 'xml'] }],
    });

    if (!path) return null;

    const content = await readTextFile(path);
    const name = path.split(/[/\\]/).pop() ?? 'untitled';
    return { name, content };
  }

  async saveFile(filename: string, content: string): Promise<void> {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');

    const path = await save({
      defaultPath: filename,
      filters: [{ name: 'OpenDRIVE', extensions: ['xodr'] }],
    });

    if (path) {
      await writeTextFile(path, content);
    }
  }

  getPlatformInfo() {
    return { type: 'tauri' as const, version: '0.1.0' };
  }

  async wgs84ToGcj02(lat: number, lon: number, alt: number): Promise<GisCoord> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('wgs84_to_gcj02', { lat, lon, alt });
  }

  async gcj02ToWgs84(lat: number, lon: number, alt: number): Promise<GisCoord> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('gcj02_to_wgs84', { lat, lon, alt });
  }

  async geoToUtm(lat: number, lon: number, alt: number): Promise<UtmCoord> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('geo_to_utm', { lat, lon, alt });
  }

  async utmToGeo(easting: number, northing: number, zone: number, isNorthern: boolean, alt: number): Promise<GisCoord> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('utm_to_geo', { easting, northing, zone, is_northern: isNorthern, alt });
  }

  async generateRoadVertices(project: Project, sampleStep: number): Promise<Float32Array> {
    // In Tauri mode, we use wgpu for rendering natively.
    // For the WebGPU viewport fallback, generate via WASM.
    const wasm = await import('../../wasm/pkg');
    return wasm.generate_road_vertices(JSON.stringify(project), sampleStep);
  }

  async generateSingleRoadVertices(
    road: import('./platform').Road,
    sampleStep: number,
    color: [number, number, number, number],
  ): Promise<Float32Array> {
    const wasm = await import('../../wasm/pkg');
    return wasm.generate_single_road_vertices(
      JSON.stringify(road), sampleStep, color[0], color[1], color[2], color[3],
    );
  }

  async pickRoadAtPoint(project: Project, x: number, y: number, threshold: number): Promise<string | null> {
    const wasm = await import('../../wasm/pkg');
    const result = wasm.pick_road_at_point(JSON.stringify(project), x, y, threshold);
    return result as string | null;
  }
}
