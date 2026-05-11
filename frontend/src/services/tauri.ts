/**
 * Tauri desktop platform adapter.
 * Calls Rust backend via Tauri's invoke IPC.
 * WASM is used for geometry operations (vertex generation, picking) on the
 * frontend side — the module must be explicitly initialised before first use,
 * just like in WebPlatformService.
 */
import type { GisCoord, PlatformService, Project, RoadTemplate, UtmCoord } from './platform';

export class TauriPlatformService implements PlatformService {
  private wasmModule: typeof import('../../wasm/pkg/we_wasm') | null = null;

  /** Lazy-initialise the WASM module exactly once. */
  private async getWasm(): Promise<typeof import('../../wasm/pkg/we_wasm')> {
    if (!this.wasmModule) {
      const wasm = await import('../../wasm/pkg/we_wasm');
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

  async generateObjectVertices(project: Project): Promise<Float32Array> {
    const wasm = await this.getWasm();
    return wasm.generate_object_vertices(JSON.stringify(project));
  }

  async pickRoadAtPoint(project: Project, x: number, y: number, threshold: number): Promise<string | null> {
    const wasm = await this.getWasm();
    return wasm.pick_road_at_point(JSON.stringify(project), x, y, threshold);
  }

  async pickJunctionAtPoint(project: Project, x: number, y: number, threshold: number): Promise<string | null> {
    const wasm = await this.getWasm();
    return wasm.pick_junction_at_point(JSON.stringify(project), x, y, threshold);
  }

  async queryElevation(road: import('./platform').Road, s: number): Promise<import('./platform').ElevationQueryResult> {
    const wasm = await this.getWasm();
    return wasm.query_elevation(JSON.stringify(road), s);
  }

  async addElevationPoint(project: Project, roadId: string, s: number, height: number): Promise<Project> {
    const wasm = await this.getWasm();
    const json = await wasm.add_elevation_point(JSON.stringify(project), roadId, s, height);
    return JSON.parse(json) as Project;
  }

  async deleteElevationPoint(project: Project, roadId: string, s: number, tolerance: number): Promise<Project> {
    const wasm = await this.getWasm();
    const json = await wasm.delete_elevation_point(JSON.stringify(project), roadId, s, tolerance);
    return JSON.parse(json) as Project;
  }

  async smoothElevation(project: Project, roadId: string, iterations: number): Promise<Project> {
    const wasm = await this.getWasm();
    const json = await wasm.smooth_elevation(JSON.stringify(project), roadId, iterations);
    return JSON.parse(json) as Project;
  }

  async snapPoint(
    project: Project,
    x: number,
    y: number,
    config: import('./platform').SnapConfig,
    excludeRoadId?: string,
  ): Promise<import('./platform').SnapResult> {
    const wasm = await this.getWasm();
    return wasm.snap_point(
      JSON.stringify(project),
      x,
      y,
      JSON.stringify(config),
      excludeRoadId,
    );
  }

  async measureDistance(
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
  ): Promise<import('./platform').DistanceMeasurement> {
    const wasm = await this.getWasm();
    return wasm.measure_distance(x1, y1, z1, x2, y2, z2);
  }

  async measureAngle(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
  ): Promise<import('./platform').AngleMeasurement> {
    const wasm = await this.getWasm();
    return wasm.measure_angle(x1, y1, x2, y2, x3, y3);
  }

  async measureArea(points: Array<[number, number]>): Promise<import('./platform').AreaMeasurement> {
    const wasm = await this.getWasm();
    return wasm.measure_area(JSON.stringify(points));
  }

  async measureRoadLength(road: import('./platform').Road, sStart: number, sEnd: number): Promise<number> {
    const wasm = await this.getWasm();
    return wasm.measure_road_length(JSON.stringify(road), sStart, sEnd);
  }

  async getRoadTemplates(): Promise<RoadTemplate[]> {
    const wasm = await this.getWasm();
    return wasm.get_road_templates();
  }

  async createRoadFromSpline(
    project: Project,
    roadId: string,
    spline: import('./platform').EditableSpline,
    templateId: string,
  ): Promise<Project> {
    const wasm = await this.getWasm();
    const json = await wasm.create_road_from_spline(
      JSON.stringify(project),
      roadId,
      JSON.stringify(spline),
      templateId,
    );
    return JSON.parse(json) as Project;
  }

  async roadToSpline(road: import('./platform').Road, sampleStep: number): Promise<import('./platform').EditableSpline> {
    const wasm = await this.getWasm();
    const json = wasm.road_to_spline(JSON.stringify(road), sampleStep);
    return JSON.parse(json) as import('./platform').EditableSpline;
  }

  async moveSplineKnot(
    spline: import('./platform').EditableSpline,
    knotIndex: number,
    x: number,
    y: number,
    z: number,
  ): Promise<import('./platform').EditableSpline> {
    const wasm = await this.getWasm();
    const json = wasm.move_spline_knot(JSON.stringify(spline), knotIndex, x, y, z);
    return JSON.parse(json) as import('./platform').EditableSpline;
  }

  async splineToGeometries(spline: import('./platform').EditableSpline): Promise<import('./platform').Geometry[]> {
    const wasm = await this.getWasm();
    const json = wasm.spline_to_geometries(JSON.stringify(spline));
    return JSON.parse(json) as import('./platform').Geometry[];
  }
}
