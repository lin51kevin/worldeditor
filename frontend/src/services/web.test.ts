import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditableSpline, Project } from './platform';
import { WebPlatformService } from './web';
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
    signals: [],
    objects: []
  };
}

describe('WebPlatformService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(wasmModule.default).mockImplementation(async () => ({} as never));
    vi.mocked(wasmModule.parse_opendrive).mockReturnValue(makeProject());
    vi.mocked(wasmModule.write_opendrive).mockReturnValue('<OpenDRIVE />');
    vi.mocked(wasmModule.get_road_templates).mockReturnValue([
      { id: 'single', name: 'Single Lane', left_lanes: 1, right_lanes: 1, lane_width: 3.5 },
    ] as never);
    vi.mocked(wasmModule.create_road_from_spline).mockReturnValue(JSON.stringify(makeProject()) as never);
    vi.mocked(wasmModule.wgs84_to_gcj02).mockReturnValue({ lat: 1, lon: 2, alt: 3 });
    vi.mocked(wasmModule.gcj02_to_wgs84).mockReturnValue({ lat: 4, lon: 5, alt: 6 });
    vi.mocked(wasmModule.geo_to_utm).mockReturnValue({ easting: 7, northing: 8, zone: 50, is_northern: true, alt: 9 });
    vi.mocked(wasmModule.utm_to_geo).mockReturnValue({ lat: 10, lon: 11, alt: 12 });
    vi.mocked(wasmModule.generate_road_vertices).mockReturnValue(new Float32Array([0, 1, 2]));
  });

  it('returns web platform info', () => {
    const service = new WebPlatformService();

    expect(service.getPlatformInfo()).toEqual({ type: 'web', version: '0.1.1' });
  });

  it('lazy-loads the wasm module once and reuses it across methods', async () => {
    const service = new WebPlatformService();
    const project = makeProject();

    await expect(service.parseOpenDrive('<OpenDRIVE />')).resolves.toEqual(project);
    await expect(service.writeOpenDrive(project)).resolves.toBe('<OpenDRIVE />');
    await expect(service.wgs84ToGcj02(1, 2, 3)).resolves.toEqual({ lat: 1, lon: 2, alt: 3 });
    await expect(service.gcj02ToWgs84(4, 5, 6)).resolves.toEqual({ lat: 4, lon: 5, alt: 6 });
    await expect(service.geoToUtm(7, 8, 9)).resolves.toEqual({ easting: 7, northing: 8, zone: 50, is_northern: true, alt: 9 });
    await expect(service.utmToGeo(10, 11, 50, true, 12)).resolves.toEqual({ lat: 10, lon: 11, alt: 12 });
    await expect(service.generateRoadVertices(project, 0.5)).resolves.toEqual(new Float32Array([0, 1, 2]));

    expect(wasmModule.default).toHaveBeenCalledTimes(1);
    expect(wasmModule.parse_opendrive).toHaveBeenCalledWith('<OpenDRIVE />');
    expect(wasmModule.write_opendrive).toHaveBeenCalledWith(JSON.stringify(project));
    expect(wasmModule.wgs84_to_gcj02).toHaveBeenCalledWith(1, 2, 3);
    expect(wasmModule.gcj02_to_wgs84).toHaveBeenCalledWith(4, 5, 6);
    expect(wasmModule.geo_to_utm).toHaveBeenCalledWith(7, 8, 9);
    expect(wasmModule.utm_to_geo).toHaveBeenCalledWith(10, 11, 50, true, 12);
    expect(wasmModule.generate_road_vertices).toHaveBeenCalledWith(JSON.stringify(project), 0.5, 'byLaneType');
  });

  it('opens a file picker and resolves the selected file contents', async () => {
    const service = new WebPlatformService();
    const originalCreateElement = document.createElement.bind(document);
    const input = originalCreateElement('input');
    const file = {
      name: 'network.xodr',
      text: vi.fn().mockResolvedValue('<OpenDRIVE />'),
    };

    vi.spyOn(input, 'click').mockImplementation(() => {
      Object.defineProperty(input, 'files', {
        value: [file],
        configurable: true,
      });
      void input.onchange?.(new Event('change'));
    });

    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'input') {
        return input;
      }
      return originalCreateElement(tagName);
    });

    await expect(service.openFile()).resolves.toEqual({
      name: 'network.xodr',
      content: '<OpenDRIVE />',
    });

    expect(input.type).toBe('file');
    expect(input.accept).toBe('.xodr,.xml');
    expect(input.click).toHaveBeenCalledTimes(1);
  });

  it('returns null when no file is selected', async () => {
    const service = new WebPlatformService();
    const originalCreateElement = document.createElement.bind(document);
    const input = originalCreateElement('input');

    vi.spyOn(input, 'click').mockImplementation(() => {
      Object.defineProperty(input, 'files', {
        value: [],
        configurable: true,
      });
      void input.onchange?.(new Event('change'));
    });

    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'input') {
        return input;
      }
      return originalCreateElement(tagName);
    });

    await expect(service.openFile()).resolves.toBeNull();
  });

  it('creates a download link when saving files', async () => {
    const service = new WebPlatformService();
    const originalCreateElement = document.createElement.bind(document);
    const anchor = originalCreateElement('a');
    const clickSpy = vi.spyOn(anchor, 'click').mockImplementation(() => {});
    const createObjectURLSpy = vi.fn(() => 'blob:test');
    const revokeObjectURLSpy = vi.fn();

    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'a') {
        return anchor;
      }
      return originalCreateElement(tagName);
    });

    vi.stubGlobal('URL', {
      createObjectURL: createObjectURLSpy,
      revokeObjectURL: revokeObjectURLSpy,
    } as unknown as typeof URL);

    await service.saveFile('saved.xodr', '<OpenDRIVE />');

    expect(anchor.href).toBe('blob:test');
    expect(anchor.download).toBe('saved.xodr');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:test');
  });

  it('forwards road template queries to wasm', async () => {
    const service = new WebPlatformService();

    await expect(service.getRoadTemplates()).resolves.toEqual([
      { id: 'single', name: 'Single Lane', left_lanes: 1, right_lanes: 1, lane_width: 3.5 },
    ]);

    expect(wasmModule.get_road_templates).toHaveBeenCalledTimes(1);
  });

  it('serializes spline road creation through wasm and parses the result', async () => {
    const service = new WebPlatformService();
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
      'classify',
    );
  });
});
