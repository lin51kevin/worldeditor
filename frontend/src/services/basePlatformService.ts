/**
 * Base platform service — shared WASM-backed implementation.
 *
 * Both Tauri and Web adapters share the same WASM call patterns for
 * geometry, measurement, and spline operations. Only file I/O and
 * platform info differ between the two.
 *
 * Subclasses override: parseOpenDrive, writeOpenDrive, openFile, saveFile, getPlatformInfo.
 */

import type {
  GisCoord, UtmCoord,
  PlatformService, Project, Road, RoadTemplate,
  ElevationQueryResult, SnapConfig, SnapResult,
  DistanceMeasurement, AngleMeasurement, AreaMeasurement, EditableSpline,
  Geometry,
} from './platform';

type WasmModule = typeof import('../../wasm/pkg/we_wasm');

/** Base class providing all WASM-delegated PlatformService methods. */
export abstract class BasePlatformService implements PlatformService {
  private wasmModule: WasmModule | null = null;
  private wasmInitPromise: Promise<WasmModule> | null = null;

  /** Lazy-initialise the WASM module exactly once.
   * Concurrent callers share the same in-flight promise to avoid double-init.
   * On failure the promise is cleared so subsequent calls can retry. */
  protected async getWasm(): Promise<WasmModule> {
    if (this.wasmModule) return this.wasmModule;
    if (!this.wasmInitPromise) {
      this.wasmInitPromise = (async () => {
        const wasm = await import('../../wasm/pkg/we_wasm') as WasmModule;
        await (wasm.default as unknown as () => Promise<void>)();
        this.wasmModule = wasm;
        return wasm;
      })().catch((err) => {
        // Clear the cached promise so callers can retry after a transient failure.
        this.wasmInitPromise = null;
        throw err;
      });
    }
    return this.wasmInitPromise;
  }

  // --- Platform-specific methods (implemented by subclasses) ---
  abstract parseOpenDrive(xml: string): Promise<Project>;
  abstract writeOpenDrive(project: Project): Promise<string>;
  abstract openFile(): Promise<{ name: string; content: string; path?: string } | null>;
  abstract openFileByPath(path: string): Promise<{ name: string; content: string } | null>;
  abstract saveFile(filename: string, content: string): Promise<void>;
  abstract getPlatformInfo(): { type: 'tauri' | 'web'; version: string };

  // --- GIS conversions ---

  async wgs84ToGcj02(lat: number, lon: number, alt: number): Promise<GisCoord> {
    const wasm = await this.getWasm();
    return wasm.wgs84_to_gcj02(lat, lon, alt);
  }

  async gcj02ToWgs84(lat: number, lon: number, alt: number): Promise<GisCoord> {
    const wasm = await this.getWasm();
    return wasm.gcj02_to_wgs84(lat, lon, alt);
  }

  async geoToUtm(lat: number, lon: number, alt: number): Promise<UtmCoord> {
    const wasm = await this.getWasm();
    return wasm.geo_to_utm(lat, lon, alt);
  }

  async utmToGeo(easting: number, northing: number, zone: number, isNorthern: boolean, alt: number): Promise<GisCoord> {
    const wasm = await this.getWasm();
    return wasm.utm_to_geo(easting, northing, zone, isNorthern, alt);
  }

  // --- Vertex generation ---

  async generateRoadVertices(project: Project, sampleStep: number, colorMode?: string): Promise<Float32Array> {
    const wasm = await this.getWasm();
    return wasm.generate_road_vertices(JSON.stringify(project), sampleStep, colorMode ?? 'byLaneType');
  }

  async generateSingleRoadVertices(road: Road, sampleStep: number, color: [number, number, number, number]): Promise<Float32Array> {
    const wasm = await this.getWasm();
    return wasm.generate_single_road_vertices(
      JSON.stringify(road), sampleStep, color[0], color[1], color[2], color[3],
    );
  }

  async generateSingleJunctionVertices(project: Project, junctionId: string, color: [number, number, number, number]): Promise<Float32Array> {
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

  // --- Picking ---

  async pickRoadAtPoint(project: Project, x: number, y: number, threshold: number): Promise<string | null> {
    const wasm = await this.getWasm();
    return wasm.pick_road_at_point(JSON.stringify(project), x, y, threshold);
  }

  async pickJunctionAtPoint(project: Project, x: number, y: number, threshold: number): Promise<string | null> {
    const wasm = await this.getWasm();
    return wasm.pick_junction_at_point(JSON.stringify(project), x, y, threshold);
  }

  async pickSignalAtPoint(project: Project, x: number, y: number, threshold: number): Promise<{ roadId: string; signalId: string } | null> {
    const wasm = await this.getWasm();
    return wasm.pick_signal_at_point(JSON.stringify(project), x, y, threshold) as { roadId: string; signalId: string } | null;
  }

  async pickObjectAtPoint(project: Project, x: number, y: number, threshold: number): Promise<{ roadId: string; objectId: string } | null> {
    const wasm = await this.getWasm();
    return wasm.pick_object_at_point(JSON.stringify(project), x, y, threshold) as { roadId: string; objectId: string } | null;
  }

  async generateSingleSignalVertices(project: Project, roadId: string, signalId: string, color: [number, number, number, number]): Promise<Float32Array> {
    const wasm = await this.getWasm();
    return wasm.generate_single_signal_vertices(
      JSON.stringify(project), roadId, signalId, color[0], color[1], color[2], color[3],
    );
  }

  async generateSingleObjectVertices(project: Project, roadId: string, objectId: string, color: [number, number, number, number]): Promise<Float32Array> {
    const wasm = await this.getWasm();
    return wasm.generate_single_object_vertices(
      JSON.stringify(project), roadId, objectId, color[0], color[1], color[2], color[3],
    );
  }

  async getSignalWorldPos(project: Project, roadId: string, signalId: string): Promise<{ x: number; y: number } | null> {
    const wasm = await this.getWasm();
    return wasm.get_signal_world_pos(JSON.stringify(project), roadId, signalId) as { x: number; y: number } | null;
  }

  async getObjectWorldPos(project: Project, roadId: string, objectId: string): Promise<{ x: number; y: number } | null> {
    const wasm = await this.getWasm();
    return wasm.get_object_world_pos(JSON.stringify(project), roadId, objectId) as { x: number; y: number } | null;
  }

  async queryElevation(road: Road, s: number): Promise<ElevationQueryResult> {
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

  // --- Snapping ---

  async snapPoint(project: Project, x: number, y: number, config: SnapConfig, excludeRoadId?: string): Promise<SnapResult> {
    const wasm = await this.getWasm();
    return wasm.snap_point(
      JSON.stringify(project), x, y, JSON.stringify(config), excludeRoadId,
    );
  }

  // --- Measurement ---

  async measureDistance(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): Promise<DistanceMeasurement> {
    const wasm = await this.getWasm();
    return wasm.measure_distance(x1, y1, z1, x2, y2, z2);
  }

  async measureAngle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): Promise<AngleMeasurement> {
    const wasm = await this.getWasm();
    return wasm.measure_angle(x1, y1, x2, y2, x3, y3);
  }

  async measureArea(points: Array<[number, number]>): Promise<AreaMeasurement> {
    const wasm = await this.getWasm();
    return wasm.measure_area(JSON.stringify(points));
  }

  async measureRoadLength(road: Road, sStart: number, sEnd: number): Promise<number> {
    const wasm = await this.getWasm();
    return wasm.measure_road_length(JSON.stringify(road), sStart, sEnd);
  }

  // --- Road templates ---

  async getRoadTemplates(): Promise<RoadTemplate[]> {
    const wasm = await this.getWasm();
    return wasm.get_road_templates();
  }

  // --- Spline operations ---

  async createRoadFromSpline(project: Project, roadId: string, spline: EditableSpline, templateId: string): Promise<Project> {
    const wasm = await this.getWasm();
    const json = await wasm.create_road_from_spline(
      JSON.stringify(project), roadId, JSON.stringify(spline), templateId,
    );
    return JSON.parse(json) as Project;
  }

  async roadToSpline(road: Road, sampleStep: number): Promise<EditableSpline> {
    const wasm = await this.getWasm();
    const json = wasm.road_to_spline(JSON.stringify(road), sampleStep);
    return JSON.parse(json) as EditableSpline;
  }

  async moveSplineKnot(spline: EditableSpline, knotIndex: number, x: number, y: number, z: number): Promise<EditableSpline> {
    const wasm = await this.getWasm();
    const json = wasm.move_spline_knot(JSON.stringify(spline), knotIndex, x, y, z);
    return JSON.parse(json) as EditableSpline;
  }

  async splineToGeometries(spline: EditableSpline): Promise<Geometry[]> {
    const wasm = await this.getWasm();
    const json = wasm.spline_to_geometries(JSON.stringify(spline));
    return JSON.parse(json) as Geometry[];
  }
}
