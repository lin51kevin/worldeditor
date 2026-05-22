import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PlatformService } from './platform';

vi.mock('../../wasm/pkg/we_wasm', () => ({
  default: vi.fn().mockResolvedValue(undefined),
  parse_opendrive: vi.fn(),
  write_opendrive: vi.fn(),
}));

describe('platform services', () => {
  beforeEach(() => {
    vi.resetModules();
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  });

  it('getPlatformService returns WebPlatformService when not in Tauri', async () => {
    const { getPlatformService } = await import('./index');
    const { WebPlatformService } = await import('./web');

    const service = await getPlatformService();

    expect(service).toBeInstanceOf(WebPlatformService);
  });

  it('WebPlatformService implements the PlatformService contract', async () => {
    const { WebPlatformService } = await import('./web');
    const service: PlatformService = new WebPlatformService();

    expect(service).toEqual(
      expect.objectContaining({
        parseOpenDrive: expect.any(Function),
        writeOpenDrive: expect.any(Function),
        openFile: expect.any(Function),
        saveFile: expect.any(Function),
        getPlatformInfo: expect.any(Function),
        wgs84ToGcj02: expect.any(Function),
        gcj02ToWgs84: expect.any(Function),
        geoToUtm: expect.any(Function),
        utmToGeo: expect.any(Function),
        generateRoadVertices: expect.any(Function),
        generateSingleRoadVertices: expect.any(Function),
        pickRoadAtPoint: expect.any(Function),
        pickLaneAtPointCached: expect.any(Function),
      })
    );
  });

  describe('pickLaneAtPointCached', () => {
    it('returns lane info when WASM finds a lane', async () => {
      const { WebPlatformService } = await import('./web');
      const service = new WebPlatformService();
      const laneResult = { roadId: 'road1', sectionIndex: 0, laneId: -1 };
      (service as any).getWasm = () => Promise.resolve({ pick_lane_at_point_cached: () => laneResult });

      const result = await service.pickLaneAtPointCached(100, 200, 5);
      expect(result).toEqual(laneResult);
    });

    it('returns null when no lane found', async () => {
      const { WebPlatformService } = await import('./web');
      const service = new WebPlatformService();
      (service as any).getWasm = () => Promise.resolve({ pick_lane_at_point_cached: () => null });

      const result = await service.pickLaneAtPointCached(100, 200, 5);
      expect(result).toBeNull();
    });
  });

  it('WebPlatformService.getPlatformInfo returns the correct type', async () => {
    const { WebPlatformService } = await import('./web');
    const service = new WebPlatformService();

    expect(service.getPlatformInfo()).toEqual({ type: 'web', version: '0.1.1' });
  });
});
