import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  updateSnapIndicator,
  handleMeasurementClick,
} from './viewportEventDispatch';

// Mock stores
vi.mock('../stores/viewportStore', () => ({
  useViewportStore: {
    getState: vi.fn(() => ({
      snapEnabled: true,
      snapMode: 'Grid',
      gridSnapSize: 1.0,
      snapThreshold: 3.0,
      measureMode: 'none',
      measurePoints: [],
      addMeasurePoint: vi.fn(),
      setMeasurementResult: vi.fn(),
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

vi.mock('../stores/pluginContribStore', () => ({
  usePluginContribStore: {
    getState: vi.fn(() => ({
      templateSections: [],
    })),
  },
}));

vi.mock('../services', () => ({
  getPlatformService: vi.fn(),
}));

vi.mock('../services/snapService', () => ({
  querySnap: vi.fn().mockResolvedValue(null),
  queryClickPick: vi.fn().mockResolvedValue({ type: 'none' }),
  pickLane: vi.fn().mockResolvedValue(null),
  pickRoad: vi.fn().mockResolvedValue(null),
  pickRoadWide: vi.fn().mockResolvedValue(null),
  snapToRoad: vi.fn().mockResolvedValue(null),
}));

vi.mock('../viewport/cursorEvents', () => ({
  emitCursorMove: vi.fn(),
}));

describe('viewportEventDispatch', () => {
  describe('updateSnapIndicator', () => {
    it('should show indicator when snapped with valid screen position', () => {
      const snapEl = document.createElement('div');
      snapEl.style.display = 'none';

      const ctx = {
        canvas: document.createElement('canvas'),
        renderer: {
          projectWorldToScreen: vi.fn(() => ({ x: 100, y: 200 })),
        } as never,
        pendingCursorRef: { current: null },
        snapIndicatorDomRef: { current: snapEl },
      };

      updateSnapIndicator(ctx, true, 5.0, 10.0);

      expect(snapEl.style.display).toBe('block');
      expect(snapEl.style.left).toBe('100px');
      expect(snapEl.style.top).toBe('200px');
    });

    it('should hide indicator when not snapped', () => {
      const snapEl = document.createElement('div');
      snapEl.style.display = 'block';

      const ctx = {
        canvas: document.createElement('canvas'),
        renderer: {} as never,
        pendingCursorRef: { current: null },
        snapIndicatorDomRef: { current: snapEl },
      };

      updateSnapIndicator(ctx, false);

      expect(snapEl.style.display).toBe('none');
    });

    it('should do nothing when snapIndicatorDomRef is null', () => {
      const ctx = {
        canvas: document.createElement('canvas'),
        renderer: {} as never,
        pendingCursorRef: { current: null },
        snapIndicatorDomRef: { current: null },
      };

      // Should not throw
      updateSnapIndicator(ctx, true, 5, 10);
    });
  });

  describe('handleMeasurementClick', () => {
    it('should return false when measureMode is none', async () => {
      const result = await handleMeasurementClick(10, 20);
      expect(result).toBe(false);
    });
  });
});
