/**
 * Web platform adapter.
 * Uses WASM for core logic, browser APIs for file I/O.
 */
import type { GisCoord, PlatformService, Project, UtmCoord } from './platform';

export class WebPlatformService implements PlatformService {
  private wasmModule: typeof import('../../wasm/pkg') | null = null;

  private async getWasm() {
    if (!this.wasmModule) {
      // Lazy-load and initialize the WASM module
      const wasm = await import('../../wasm/pkg');
      const initWasm = wasm.default;
      await initWasm();
      this.wasmModule = wasm;
    }
    return this.wasmModule;
  }

  async parseOpenDrive(xml: string): Promise<Project> {
    const wasm = await this.getWasm();
    return wasm.parse_opendrive(xml) as unknown as Project;
  }

  async writeOpenDrive(project: Project): Promise<string> {
    const wasm = await this.getWasm();
    return wasm.write_opendrive(JSON.stringify(project));
  }

  async openFile(): Promise<{ name: string; content: string } | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.xodr,.xml';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        const content = await file.text();
        resolve({ name: file.name, content });
      };
      input.click();
    });
  }

  async saveFile(filename: string, content: string): Promise<void> {
    const blob = new Blob([content], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  getPlatformInfo() {
    return { type: 'web' as const, version: '0.1.0' };
  }

  async wgs84ToGcj02(lat: number, lon: number, alt: number): Promise<GisCoord> {
    const wasm = await this.getWasm();
    return wasm.wgs84_to_gcj02(lat, lon, alt) as unknown as GisCoord;
  }

  async gcj02ToWgs84(lat: number, lon: number, alt: number): Promise<GisCoord> {
    const wasm = await this.getWasm();
    return wasm.gcj02_to_wgs84(lat, lon, alt) as unknown as GisCoord;
  }

  async geoToUtm(lat: number, lon: number, alt: number): Promise<UtmCoord> {
    const wasm = await this.getWasm();
    return wasm.geo_to_utm(lat, lon, alt) as unknown as UtmCoord;
  }

  async utmToGeo(easting: number, northing: number, zone: number, isNorthern: boolean, alt: number): Promise<GisCoord> {
    const wasm = await this.getWasm();
    return wasm.utm_to_geo(easting, northing, zone, isNorthern, alt) as unknown as GisCoord;
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

  async generateSingleJunctionVertices(
    project: Project,
    junctionId: string,
    color: [number, number, number, number],
  ): Promise<Float32Array> {
    const wasm = await this.getWasm();
    return wasm.generate_single_junction_vertices(
      JSON.stringify(project), junctionId, color[0], color[1], color[2], color[3],
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

  async generateSignalPaintVertices(project: Project, sampleStep: number): Promise<Float32Array> {
    const wasm = await this.getWasm();
    return wasm.generate_signal_paint_vertices(JSON.stringify(project), sampleStep);
  }

  async pickRoadAtPoint(project: Project, x: number, y: number, threshold: number): Promise<string | null> {
    const wasm = await this.getWasm();
    const result = wasm.pick_road_at_point(JSON.stringify(project), x, y, threshold);
    return result as string | null;
  }

  async pickJunctionAtPoint(project: Project, x: number, y: number, threshold: number): Promise<string | null> {
    const wasm = await this.getWasm();
    const result = wasm.pick_junction_at_point(JSON.stringify(project), x, y, threshold);
    return result as string | null;
  }
}
