/**
 * Tauri desktop platform adapter.
 * Calls Rust backend via Tauri's invoke IPC.
 * WASM is used for geometry operations (vertex generation, picking) on the
 * frontend side — the module must be explicitly initialised before first use,
 * just like in WebPlatformService.
 */
import type { GisCoord, PlatformService, Project, UtmCoord } from './platform';

export class TauriPlatformService implements PlatformService {
  private wasmModule: typeof import('../../wasm/pkg') | null = null;

  /** Lazy-initialise the WASM module exactly once. */
  private async getWasm(): Promise<typeof import('../../wasm/pkg')> {
    if (!this.wasmModule) {
      const wasm = await import('../../wasm/pkg');
      await wasm.default();
      this.wasmModule = wasm;
    }
    return this.wasmModule;
  }

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
    const wasm = await this.getWasm();
    return wasm.generate_road_vertices(JSON.stringify(project), sampleStep);
  }

  async generateSingleRoadVertices(
    road: import('./platform').Road,
    sampleStep: number,
    color: [number, number, number, number],
  ): Promise<Float32Array> {
    const wasm = await this.getWasm();
    return wasm.generate_single_road_vertices(
      JSON.stringify(road), sampleStep, color[0], color[1], color[2], color[3],
    );
  }

  async generateJunctionVertices(project: Project): Promise<Float32Array> {
    const wasm = await this.getWasm();
    return wasm.generate_junction_vertices(JSON.stringify(project));
  }

  async generateLaneLineVertices(project: Project, sampleStep: number): Promise<Float32Array> {
    const wasm = await this.getWasm();
    return wasm.generate_lane_line_vertices(JSON.stringify(project), sampleStep);
  }

  async generateCenterLineVertices(project: Project, sampleStep: number): Promise<Float32Array> {
    const wasm = await this.getWasm();
    return wasm.generate_center_line_vertices(JSON.stringify(project), sampleStep);
  }

  async pickRoadAtPoint(project: Project, x: number, y: number, threshold: number): Promise<string | null> {
    const wasm = await this.getWasm();
    const result = wasm.pick_road_at_point(JSON.stringify(project), x, y, threshold);
    return result as string | null;
  }
}
