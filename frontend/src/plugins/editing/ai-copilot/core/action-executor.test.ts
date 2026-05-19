import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeIntent } from './action-executor';
import type { ParsedIntent } from './types';
import type { Road, LaneSection } from '../../../../services/platform';

// --- Mock store setup (following useAdjustEdgeMode.test.ts pattern) ---
const mockStore = {
  selectedRoadId: null as string | null,
  project: { roads: [] as Road[] },
  addRoad: vi.fn(),
  removeRoad: vi.fn(),
  reverseRoad: vi.fn(),
  mirrorRoad: vi.fn(),
  addLane: vi.fn(),
  removeLane: vi.fn(),
  updateLaneWidth: vi.fn(),
  executePluginCommand: vi.fn(),
};

vi.mock('../../../../stores/projectStore', () => ({
  useProjectStore: { getState: () => mockStore },
}));

// --- Helpers ---
function makeIntent(action: ParsedIntent['action'], params: Record<string, any> = {}): ParsedIntent {
  return { action, params, confidence: 1, rawInput: 'test' };
}

function makeRoad(id: string): Road {
  const section: LaneSection = {
    s: 0, single_side: false,
    left: [],
    center: [{ id: 0, lane_type: 'none', level: 0, width: [], road_marks: [], borders: [], link: { predecessor: null, successor: null } }],
    right: [{ id: -1, lane_type: 'driving', level: 0, width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }], road_marks: [], borders: [], link: { predecessor: null, successor: null } }],
  };
  return {
    id,
    name: id,
    length: 100,
    plan_view: [{ s: 0, x: 0, y: 0, hdg: 0, length: 100, geo_type: 'Line' }],
    lane_sections: [section],
    elevation_profile: [],
    link: { predecessor: null, successor: null },
    junction_id: null,
    objects: [],
    signals: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStore.selectedRoadId = null;
  mockStore.project.roads = [];
  mockStore.executePluginCommand.mockImplementation((_desc, fn) => {
    const newProject = fn(mockStore.project);
    mockStore.project = newProject;
  });
});

describe('action-executor', () => {
  describe('addRoad', () => {
    it('should add a road and return success', async () => {
      const result = await executeIntent(makeIntent('addRoad'));
      expect(result.success).toBe(true);
      expect(mockStore.addRoad).toHaveBeenCalled();
      expect(result.description).toContain('已添加');
    });
  });

  describe('removeRoad', () => {
    it('should return error when no road selected', async () => {
      mockStore.selectedRoadId = null;
      const result = await executeIntent(makeIntent('removeRoad'));
      expect(result.success).toBe(false);
      expect(result.error).toContain('请先选中');
    });

    it('should remove selected road', async () => {
      mockStore.selectedRoadId = 'road-1';
      const result = await executeIntent(makeIntent('removeRoad'));
      expect(result.success).toBe(true);
      expect(mockStore.removeRoad).toHaveBeenCalledWith('road-1');
    });
  });

  describe('reverseRoad', () => {
    it('should return error when no road selected', async () => {
      const result = await executeIntent(makeIntent('reverseRoad'));
      expect(result.success).toBe(false);
      expect(result.error).toContain('请先选中');
    });

    it('should reverse selected road', async () => {
      mockStore.selectedRoadId = 'road-1';
      const result = await executeIntent(makeIntent('reverseRoad'));
      expect(result.success).toBe(true);
      expect(mockStore.reverseRoad).toHaveBeenCalledWith('road-1');
    });
  });

  describe('mirrorRoad', () => {
    it('should return error when no road selected', async () => {
      const result = await executeIntent(makeIntent('mirrorRoad'));
      expect(result.success).toBe(false);
    });

    it('should mirror selected road', async () => {
      mockStore.selectedRoadId = 'road-1';
      const result = await executeIntent(makeIntent('mirrorRoad'));
      expect(result.success).toBe(true);
      expect(mockStore.mirrorRoad).toHaveBeenCalledWith('road-1');
    });
  });

  describe('splitRoad', () => {
    it('should return error when no road selected', async () => {
      const result = await executeIntent(makeIntent('splitRoad'));
      expect(result.success).toBe(false);
    });

    it('should split selected road via executePluginCommand', async () => {
      mockStore.selectedRoadId = 'road-1';
      mockStore.project.roads = [makeRoad('road-1')];
      const result = await executeIntent(makeIntent('splitRoad'));
      expect(result.success).toBe(true);
      expect(mockStore.executePluginCommand).toHaveBeenCalled();
    });
  });

  describe('addLane', () => {
    it('should return error when no road selected', async () => {
      const result = await executeIntent(makeIntent('addLane'));
      expect(result.success).toBe(false);
      expect(result.error).toContain('请先选中');
    });

    it('should add lane to selected road', async () => {
      mockStore.selectedRoadId = 'road-1';
      const result = await executeIntent(makeIntent('addLane'));
      expect(result.success).toBe(true);
      expect(mockStore.addLane).toHaveBeenCalledWith('road-1', 0, 'right');
    });

    it('should add lane on specified side', async () => {
      mockStore.selectedRoadId = 'road-1';
      const result = await executeIntent(makeIntent('addLane', { side: 'left' }));
      expect(result.success).toBe(true);
      expect(mockStore.addLane).toHaveBeenCalledWith('road-1', 0, 'left');
    });
  });

  describe('removeLane', () => {
    it('should return error when no road selected', async () => {
      const result = await executeIntent(makeIntent('removeLane'));
      expect(result.success).toBe(false);
    });

    it('should remove outermost lane from selected road', async () => {
      mockStore.selectedRoadId = 'road-1';
      mockStore.project.roads = [makeRoad('road-1')];
      const result = await executeIntent(makeIntent('removeLane'));
      expect(result.success).toBe(true);
      expect(mockStore.removeLane).toHaveBeenCalled();
    });
  });

  describe('updateLaneWidth', () => {
    it('should return error when no road selected', async () => {
      const result = await executeIntent(makeIntent('updateLaneWidth'));
      expect(result.success).toBe(false);
    });

    it('should update lane width on selected road', async () => {
      mockStore.selectedRoadId = 'road-1';
      const result = await executeIntent(makeIntent('updateLaneWidth', { width: 4.0, side: 'right', laneId: -1 }));
      expect(result.success).toBe(true);
      expect(mockStore.updateLaneWidth).toHaveBeenCalled();
    });
  });

  describe('help', () => {
    it('should return help text', async () => {
      const result = await executeIntent(makeIntent('help'));
      expect(result.success).toBe(true);
      expect(result.description).toContain('帮助');
      expect(result.description).toContain('添加道路');
    });
  });

  describe('question', () => {
    it('should return guidance message', async () => {
      const result = await executeIntent(makeIntent('question'));
      expect(result.success).toBe(true);
      expect(result.description).toContain('AI');
    });
  });

  describe('unknown action', () => {
    it('should return error for unsupported action', async () => {
      const result = await executeIntent(makeIntent('createJunction' as any));
      expect(result.success).toBe(false);
      expect(result.error).toContain('不支持');
    });
  });
});
