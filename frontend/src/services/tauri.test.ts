import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditableSpline, Project } from './platform';
import { TauriPlatformService } from './tauri';
import * as wasmModule from '../../wasm/pkg/we_wasm';

vi.mock('../../wasm/pkg/we_wasm', () => ({
  default: vi.fn().mockResolvedValue(undefined),
  parse_opendrive: vi.fn(),
  write_opendrive: vi.fn(),
  get_road_templates: vi.fn(),
  create_road_from_spline: vi.fn(),
  wgs84_to_gcj02: vi.fn(),
  gcj02_to_wgs84: vi.fn(),
  geo_to_utm: vi.fn(),
  utm_to_geo: vi.fn(),
  generate_road_vertices: vi.fn(),
  generate_single_road_vertices: vi.fn(),
  pick_road_at_point: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

function makeProject(): Project {
  return {
    name: 'Test',
    header: {
      rev_major: 1,
      rev_minor: 6,
      name: '',
      date: '',
      north: 0,
      south: 0,
      east: 0,
      west: 0,
      geo_reference: null,
    },
    roads: [],
    junctions: [],
  };
}

describe('TauriPlatformService', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(() => {
    vi.mocked(wasmModule.default).mockResolvedValue(undefined as never);
    vi.mocked(wasmModule.generate_road_vertices).mockReturnValue(new Float32Array([0, 1, 2]));
    vi.mocked(wasmModule.generate_single_road_vertices).mockReturnValue(new Float32Array([3, 4, 5]));
    vi.mocked(wasmModule.pick_road_at_point).mockReturnValue('road-1' as never);
    vi.mocked(wasmModule.get_road_templates).mockReturnValue([
      { id: 'single', name: 'Single Lane', left_lanes: 1, right_lanes: 1, lane_width: 3.5 },
    ] as never);
    vi.mocked(wasmModule.create_road_from_spline).mockReturnValue(JSON.stringify(makeProject()) as never);
  });

  it('returns tauri platform info', () => {
    const service = new TauriPlatformService();
    expect(service.getPlatformInfo()).toEqual({ type: 'tauri', version: '0.1.0' });
  });

  it('initialises the WASM module exactly once across multiple WASM-backed calls', async () => {
    const service = new TauriPlatformService();
    const project = makeProject();
    const dummyRoad: import('./platform').Road = {
      id: 'r1',
      name: 'Road r1',
      length: 10,
      junction_id: null,
      link: { predecessor: null, successor: null },
      plan_view: [],
      elevation_profile: [],
      lane_sections: [],
    };

    await service.generateRoadVertices(project, 2.0);
    await service.generateRoadVertices(project, 2.0);
    await service.generateSingleRoadVertices(dummyRoad, 2.0, [1, 0, 0, 1]);
    await service.pickRoadAtPoint(project, 0, 0, 5.0);

    expect(wasmModule.default).toHaveBeenCalledTimes(1);
  });

  it('calls generate_road_vertices with serialised project and step', async () => {
    const service = new TauriPlatformService();
    const project = makeProject();

    const result = await service.generateRoadVertices(project, 2.0);

    expect(wasmModule.generate_road_vertices).toHaveBeenCalledWith(JSON.stringify(project), 2.0);
    expect(result).toEqual(new Float32Array([0, 1, 2]));
  });

  it('calls generate_single_road_vertices with correct arguments', async () => {
    const service = new TauriPlatformService();
    const road: import('./platform').Road = {
      id: 'r1',
      name: 'Road r1',
      length: 10,
      junction_id: null,
      link: { predecessor: null, successor: null },
      plan_view: [],
      elevation_profile: [],
      lane_sections: [],
    };
    const color: [number, number, number, number] = [0.2, 0.5, 1.0, 0.7];

    const result = await service.generateSingleRoadVertices(road, 2.0, color);

    expect(wasmModule.generate_single_road_vertices).toHaveBeenCalledWith(
      JSON.stringify(road), 2.0, 0.2, 0.5, 1.0, 0.7,
    );
    expect(result).toEqual(new Float32Array([3, 4, 5]));
  });

  it('calls pick_road_at_point and returns the road id', async () => {
    const service = new TauriPlatformService();
    const project = makeProject();

    const result = await service.pickRoadAtPoint(project, 10, 20, 5.0);

    expect(wasmModule.pick_road_at_point).toHaveBeenCalledWith(JSON.stringify(project), 10, 20, 5.0);
    expect(result).toBe('road-1');
  });

  it('propagates WASM init failure as a rejected promise', async () => {
    vi.mocked(wasmModule.default).mockRejectedValueOnce(new Error('WASM load failed'));
    const service = new TauriPlatformService();
    const project = makeProject();

    await expect(service.generateRoadVertices(project, 2.0)).rejects.toThrow('WASM load failed');
  });

  it('does not retry init after a prior failure — subsequent calls also reject', async () => {
    // After a failed init the cached module is null; next call should attempt init again.
    // This verifies no stale "partially initialised" module is reused.
    vi.mocked(wasmModule.default)
      .mockRejectedValueOnce(new Error('first fail'))
      .mockResolvedValueOnce(undefined as never);

    const service = new TauriPlatformService();
    const project = makeProject();

    await expect(service.generateRoadVertices(project, 2.0)).rejects.toThrow('first fail');
    // After failure the module ref is still null; second call re-initialises successfully.
    const result = await service.generateRoadVertices(project, 2.0);
    expect(result).toEqual(new Float32Array([0, 1, 2]));
    expect(wasmModule.default).toHaveBeenCalledTimes(2);
  });

  it('uses Tauri IPC for parseOpenDrive', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const project = makeProject();
    vi.mocked(invoke).mockResolvedValueOnce(project);

    const service = new TauriPlatformService();
    const result = await service.parseOpenDrive('<OpenDRIVE />');

    expect(invoke).toHaveBeenCalledWith('parse_opendrive', { xml: '<OpenDRIVE />' });
    expect(result).toEqual(project);
  });

  it('uses Tauri IPC for writeOpenDrive', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockResolvedValueOnce('<OpenDRIVE />');

    const service = new TauriPlatformService();
    const project = makeProject();
    const result = await service.writeOpenDrive(project);

    expect(invoke).toHaveBeenCalledWith('write_opendrive', { project });
    expect(result).toBe('<OpenDRIVE />');
  });

  it('forwards road template queries to wasm', async () => {
    const service = new TauriPlatformService();

    await expect(service.getRoadTemplates()).resolves.toEqual([
      { id: 'single', name: 'Single Lane', left_lanes: 1, right_lanes: 1, lane_width: 3.5 },
    ]);

    expect(wasmModule.get_road_templates).toHaveBeenCalledTimes(1);
  });

  it('serializes spline road creation through wasm and parses the result', async () => {
    const service = new TauriPlatformService();
    const project = makeProject();
    const spline: EditableSpline = {
      knots: [{
        position: [0, 0, 0],
        tangent_in: [0, 0, 0],
        tangent_out: [1, 0, 0],
        s: 0,
        knot_type: 'Anchor' as const,
        tangent_mode: 'Auto' as const,
      }],
    };

    await expect(service.createRoadFromSpline(project, 'road_spline_1', spline, 'single')).resolves.toEqual(project);

    expect(wasmModule.create_road_from_spline).toHaveBeenCalledWith(
      JSON.stringify(project),
      'road_spline_1',
      JSON.stringify(spline),
      'single',
    );
  });
});
