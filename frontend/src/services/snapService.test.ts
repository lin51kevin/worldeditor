import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Project } from './platform';

function makeProject(): Project {
  return {
    name: 'Test Project',
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
    objects: [],
  };
}

function makeViewportState() {
  return {
    snapEnabled: true,
    snapMode: 'Grid',
    snapThreshold: 15.0,
    gridSnapSize: 1.0,
    snapToEndpoints: true,
    snapToMidpoints: false,
    snapToPerpendicular: true,
    snapToGrid: true,
    snapToLaneEndpoints: false,
    display: {
      hiddenRoadIds: [],
      hiddenJunctionIds: [],
      hiddenLaneSectionKeys: [],
      hiddenLaneKeys: [],
      hiddenSignalKeys: [],
      hiddenObjectKeys: [],
      showSignals: true,
      showObjects: true,
    },
  };
}

async function loadSnapService() {
  vi.resetModules();

  const viewportState = makeViewportState();
  const projectState = {
    project: makeProject(),
    selectedRoadId: null,
  };
  const service = {
    setProjectCache: vi.fn().mockResolvedValue(undefined),
    updateCachedRoad: vi.fn().mockResolvedValue(undefined),
    snapPointCached: vi.fn().mockResolvedValue({
      x: 10,
      y: 20,
      snapped: true,
      snap_type: 'Endpoint',
      target_id: 'r1',
      contact_point: 'Start',
    }),
    snapPointOnRoad: vi.fn(),
    pickRoadAtPointCached: vi.fn(),
    pickJunctionAtPointCached: vi.fn(),
    pickSignalAtPointCached: vi.fn(),
    pickObjectAtPointCached: vi.fn(),
    pickLaneAtPointCached: vi.fn(),
  };

  vi.doMock('../stores/viewportStore', () => ({
    useViewportStore: {
      getState: vi.fn(() => viewportState),
    },
  }));

  vi.doMock('../stores/projectStore', () => ({
    useProjectStore: {
      getState: vi.fn(() => projectState),
    },
  }));

  vi.doMock('./index', () => ({
    getPlatformService: vi.fn().mockResolvedValue(service),
  }));

  const snapService = await import('./snapService');
  return { ...snapService, viewportState, projectState, service };
}

describe('snapService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildSnapConfig', () => {
    it('should build config from viewport store state', async () => {
      const { buildSnapConfig } = await loadSnapService();
      const config = buildSnapConfig();
      expect(config.grid_enabled).toBe(true);
      expect(config.grid_size).toBe(1.0);
      expect(config.endpoint_enabled).toBe(true);
      expect(config.endpoint_threshold).toBe(15.0);
      expect(config.snap_to_lane_endpoints).toBe(false);
      expect(config.midpoint_enabled).toBe(false);
      expect(config.perpendicular_enabled).toBe(true);
    });
  });

  describe('buildDrawSnapConfig', () => {
    it('should return endpoint-only config for draw mode', async () => {
      const { buildDrawSnapConfig } = await loadSnapService();
      const config = buildDrawSnapConfig();
      expect(config.grid_enabled).toBe(false);
      expect(config.endpoint_enabled).toBe(true);
      expect(config.endpoint_threshold).toBe(5.0);
      expect(config.snap_to_lane_endpoints).toBe(false);
      expect(config.midpoint_enabled).toBe(false);
      expect(config.perpendicular_enabled).toBe(false);
    });
  });

  describe('querySnap', () => {
    it('should sync the project cache once and reuse cached snapping', async () => {
      const { querySnap, service } = await loadSnapService();

      await querySnap(1, 2);
      await querySnap(3, 4, 'r2');

      expect(service.setProjectCache).toHaveBeenCalledTimes(1);
      expect(service.snapPointCached).toHaveBeenCalledTimes(2);
      expect(service.snapPointCached).toHaveBeenLastCalledWith(
        3,
        4,
        expect.objectContaining({ endpoint_enabled: true }),
        'r2',
      );
    });

    it('should rebuild the cache after the project reference changes', async () => {
      const { querySnap, projectState, service } = await loadSnapService();

      await querySnap(1, 2);
      projectState.project = {
        ...projectState.project,
        roads: [{
          id: 'r1',
          name: 'Road 1',
          length: 10,
          junction_id: null,
          link: null,
          plan_view: [],
          elevation_profile: [],
          lane_sections: [],
        }],
      };
      await querySnap(5, 6);

      expect(service.setProjectCache).toHaveBeenCalledTimes(2);
    });
  });

  describe('queryDrawSnap', () => {
    it('should use cached snapping for draw mode', async () => {
      const { queryDrawSnap, service } = await loadSnapService();

      await queryDrawSnap(7, 8);

      expect(service.setProjectCache).toHaveBeenCalledTimes(1);
      expect(service.snapPointCached).toHaveBeenCalledWith(
        7,
        8,
        {
          grid_enabled: false,
          grid_size: 1.0,
          endpoint_enabled: true,
          endpoint_threshold: 5.0,
          snap_to_lane_endpoints: false,
          midpoint_enabled: false,
          perpendicular_enabled: false,
        },
      );
    });
  });
});
