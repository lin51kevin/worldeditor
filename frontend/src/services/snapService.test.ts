import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildSnapConfig,
  buildDrawSnapConfig,
} from './snapService';

// Mock stores
vi.mock('../stores/viewportStore', () => ({
  useViewportStore: {
    getState: vi.fn(() => ({
      snapEnabled: true,
      snapMode: 'Grid',
      snapThreshold: 3.0,
      gridSnapSize: 1.0,
    })),
  },
}));

vi.mock('../stores/projectStore', () => ({
  useProjectStore: {
    getState: vi.fn(() => ({
      project: { roads: [], junctions: [], signals: [] },
      selectedRoadId: null,
    })),
  },
}));

vi.mock('./index', () => ({
  getPlatformService: vi.fn(),
}));

describe('snapService', () => {
  describe('buildSnapConfig', () => {
    it('should build config from viewport store state', () => {
      const config = buildSnapConfig();
      expect(config.grid_enabled).toBe(true);
      expect(config.grid_size).toBe(1.0);
      expect(config.endpoint_enabled).toBe(false);
      expect(config.endpoint_threshold).toBe(3.0);
      expect(config.midpoint_enabled).toBe(false);
      expect(config.perpendicular_enabled).toBe(false);
    });
  });

  describe('buildDrawSnapConfig', () => {
    it('should return endpoint-only config for draw mode', () => {
      const config = buildDrawSnapConfig();
      expect(config.grid_enabled).toBe(false);
      expect(config.endpoint_enabled).toBe(true);
      expect(config.endpoint_threshold).toBe(5.0);
      expect(config.midpoint_enabled).toBe(false);
      expect(config.perpendicular_enabled).toBe(false);
    });
  });
});
