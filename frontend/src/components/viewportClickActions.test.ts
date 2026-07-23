import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockService = vi.hoisted(() => ({
  measureDistance: vi.fn().mockResolvedValue({ straight: 10, horizontal: 10, vertical: 0 }),
  measureAngle: vi.fn().mockResolvedValue({ degrees: 90, radians: Math.PI / 2 }),
  measureArea: vi.fn().mockResolvedValue({ area: 100, perimeter: 40 }),
  pickRoadAtPointCached: vi.fn().mockResolvedValue(null),
  snapPointOnRoad: vi.fn().mockResolvedValue({ s: 5, t: 1, hdg: 0 }),
}));

vi.mock('../services', () => ({
  getPlatformService: vi.fn().mockResolvedValue(mockService),
}));

const mockViewportStore = vi.hoisted(() => ({
  measureMode: 'none' as string,
  measurePoints: [] as any[],
  addMeasurePoint: vi.fn(),
  setMeasurementResult: vi.fn(),
  editMode: null as string | null,
  pendingTemplateId: null as string | null,
  pendingObjectTemplateId: null as string | null,
  clearPendingTemplate: vi.fn(),
  objectDrawTemplateId: null as string | null,
  objectDrawRoadId: null as string | null,
  objectDrawVertices: [] as any[],
  setObjectDrawRoadId: vi.fn(),
  setObjectDrawTemplateId: vi.fn(),
  appendObjectDrawVertex: vi.fn(),
  clearObjectDraw: vi.fn(),
}));

vi.mock('../stores/viewportStore', () => ({
  useViewportStore: { getState: () => mockViewportStore },
}));

const mockProjectStore = vi.hoisted(() => ({
  selectedJunctionId: null as string | null,
  selectedRoadId: null as string | null,
  project: { roads: [] as any[], junctions: [] as any[] },
  executePluginCommand: vi.fn(),
}));

vi.mock('../stores/projectStore', () => ({
  useProjectStore: { getState: () => mockProjectStore },
}));

const mockPluginContribStore = vi.hoisted(() => ({
  templateSections: [] as any[],
}));

vi.mock('../stores/pluginContribStore', () => ({
  usePluginContribStore: { getState: () => mockPluginContribStore },
}));

import {
  handleMeasureClick,
  handleEditJunctionClick,
  handlePlaceTemplateClick,
  handlePlaceObjectClick,
  handleObjectDrawClick,
  finalizeObjectDraw,
  cancelObjectDraw,
} from './viewportClickActions';

describe('handleMeasureClick', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockViewportStore.measureMode = 'none';
    mockViewportStore.measurePoints = [];
  });

  it('returns false when measureMode is none', async () => {
    expect(await handleMeasureClick({ x: 0, y: 0 })).toBe(false);
  });

  it('returns true and adds point when in distance mode', async () => {
    mockViewportStore.measureMode = 'distance';
    mockViewportStore.measurePoints = [{ x: 0, y: 0, z: 0 }];
    const result = await handleMeasureClick({ x: 10, y: 0 });
    expect(result).toBe(true);
    expect(mockViewportStore.addMeasurePoint).toHaveBeenCalled();
    expect(mockService.measureDistance).toHaveBeenCalled();
    expect(mockViewportStore.setMeasurementResult).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'distance' }),
    );
  });

  it('measures angle with 3+ points', async () => {
    mockViewportStore.measureMode = 'angle';
    mockViewportStore.measurePoints = [{ x: 0, y: 0, z: 0 }, { x: 5, y: 5, z: 0 }];
    await handleMeasureClick({ x: 10, y: 0 });
    expect(mockService.measureAngle).toHaveBeenCalled();
    expect(mockViewportStore.setMeasurementResult).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'angle' }),
    );
  });

  it('measures area with 3+ points', async () => {
    mockViewportStore.measureMode = 'area';
    mockViewportStore.measurePoints = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }];
    await handleMeasureClick({ x: 10, y: 10 });
    expect(mockService.measureArea).toHaveBeenCalled();
    expect(mockViewportStore.setMeasurementResult).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'area' }),
    );
  });
});

describe('handleEditJunctionClick', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockViewportStore.editMode = null;
    mockProjectStore.selectedJunctionId = null;
  });

  it('returns false when not in editJunction mode', async () => {
    expect(await handleEditJunctionClick({ x: 0, y: 0 })).toBe(false);
  });

  it('returns true when in editJunction mode', async () => {
    mockViewportStore.editMode = 'editJunction';
    expect(await handleEditJunctionClick({ x: 0, y: 0 })).toBe(true);
  });
});

describe('handlePlaceTemplateClick', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockViewportStore.pendingTemplateId = null;
  });

  it('returns false when no template is pending', () => {
    expect(handlePlaceTemplateClick({ x: 0, y: 0 })).toBe(false);
  });

  it('applies the template and clears pending state', () => {
    const onApply = vi.fn();
    mockViewportStore.pendingTemplateId = 'tpl-1';
    mockPluginContribStore.templateSections = [
      { items: [{ id: 'tpl-1', onApply }] },
    ];
    const result = handlePlaceTemplateClick({ x: 5, y: 10 });
    expect(result).toBe(true);
    expect(mockViewportStore.clearPendingTemplate).toHaveBeenCalled();
    expect(onApply).toHaveBeenCalledWith({ x: 5, y: 10, hdg: 0 });
  });

  it('returns true even when template id is not found in sections', () => {
    mockViewportStore.pendingTemplateId = 'nonexistent';
    mockPluginContribStore.templateSections = [];
    expect(handlePlaceTemplateClick({ x: 0, y: 0 })).toBe(true);
  });
});

describe('finalizeObjectDraw', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockViewportStore.objectDrawTemplateId = null;
    mockViewportStore.objectDrawRoadId = null;
    mockViewportStore.objectDrawVertices = [];
  });

  it('returns false when no draw template is active', () => {
    expect(finalizeObjectDraw()).toBe(false);
  });

  it('clears draw state and calls onApply with polygon corners', () => {
    const onApply = vi.fn();
    mockViewportStore.objectDrawTemplateId = 'obj-1';
    mockViewportStore.objectDrawRoadId = 'road-1';
    mockViewportStore.objectDrawVertices = [[0, 0, 0], [10, 0, 0], [10, 5, 0]];
    mockPluginContribStore.templateSections = [
      { items: [{ id: 'obj-1', drawMode: 'polygon', onApply }] },
    ];
    const result = finalizeObjectDraw();
    expect(result).toBe(true);
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        roadId: 'road-1',
        corners: expect.arrayContaining([
          expect.objectContaining({ x: 0, y: 0, z: 0 }),
        ]),
      }),
    );
    expect(mockViewportStore.clearObjectDraw).toHaveBeenCalled();
  });

  it('does not call onApply with less than minimum vertices for polygon', () => {
    const onApply = vi.fn();
    mockViewportStore.objectDrawTemplateId = 'obj-1';
    mockViewportStore.objectDrawRoadId = 'road-1';
    mockViewportStore.objectDrawVertices = [[0, 0, 0], [10, 0, 0]]; // only 2, need 3 for polygon
    mockPluginContribStore.templateSections = [
      { items: [{ id: 'obj-1', drawMode: 'polygon', onApply }] },
    ];
    finalizeObjectDraw();
    expect(onApply).not.toHaveBeenCalled();
    expect(mockViewportStore.clearObjectDraw).toHaveBeenCalled();
  });
});

describe('handlePlaceObjectClick', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockViewportStore.pendingObjectTemplateId = null;
    mockProjectStore.selectedRoadId = null;
    mockProjectStore.project = { roads: [], junctions: [] };
  });

  it('returns false when no object template is pending', async () => {
    expect(await handlePlaceObjectClick({ x: 0, y: 0 }, () => null)).toBe(false);
  });

  it('returns true when object template is pending but project is null', async () => {
    mockViewportStore.pendingObjectTemplateId = 'obj-tpl';
    expect(await handlePlaceObjectClick({ x: 0, y: 0 }, () => null)).toBe(true);
  });

  it('places object on picked road', async () => {
    const onApply = vi.fn();
    mockViewportStore.pendingObjectTemplateId = 'obj-tpl';
    mockPluginContribStore.templateSections = [{ items: [{ id: 'obj-tpl', onApply }] }];
    const road = { id: 'R1', length: 100, junction_id: null };
    const project = { roads: [road], junctions: [] };
    mockService.pickRoadAtPointCached.mockResolvedValue('R1');
    mockService.snapPointOnRoad.mockResolvedValue({ s: 50, t: 2, hdg: 0.1 });
    await handlePlaceObjectClick({ x: 5, y: 3 }, () => project as any);
    expect(onApply).toHaveBeenCalledWith({ roadId: 'R1', x: 50, y: 2, hdg: 0.1 });
  });

  it('falls back to selected road when pick returns null', async () => {
    const onApply = vi.fn();
    mockViewportStore.pendingObjectTemplateId = 'obj-tpl';
    mockProjectStore.selectedRoadId = 'R2';
    mockPluginContribStore.templateSections = [{ items: [{ id: 'obj-tpl', onApply }] }];
    const road = { id: 'R2', length: 200, junction_id: null };
    const project = { roads: [road], junctions: [] };
    mockService.pickRoadAtPointCached.mockResolvedValue(null);
    mockService.snapPointOnRoad.mockResolvedValue({ s: 10, t: 3, hdg: 0 });
    await handlePlaceObjectClick({ x: 1, y: 1 }, () => project as any);
    expect(onApply).toHaveBeenCalledWith({ roadId: 'R2', x: 10, y: 3, hdg: 0 });
  });
});

describe('handleObjectDrawClick', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockViewportStore.pendingObjectTemplateId = null;
    mockViewportStore.objectDrawTemplateId = null;
    mockViewportStore.objectDrawRoadId = null;
  });

  it('returns false when no template pending and no draw active', async () => {
    expect(await handleObjectDrawClick({ x: 0, y: 0 }, () => null)).toBe(false);
  });

  it('starts drawing on first click (picks road, sets template)', async () => {
    mockViewportStore.pendingObjectTemplateId = 'draw-tpl';
    mockPluginContribStore.templateSections = [
      { items: [{ id: 'draw-tpl', drawMode: 'polygon', onApply: vi.fn() }] },
    ];
    const road = { id: 'R1', length: 100, junction_id: null };
    const project = { roads: [road], junctions: [] };
    mockService.pickRoadAtPointCached.mockResolvedValue('R1');
    mockService.snapPointOnRoad.mockResolvedValue({ s: 20, t: 5, hdg: 0.5 });
    const result = await handleObjectDrawClick({ x: 3, y: 4 }, () => project as any);
    expect(result).toBe(true);
    expect(mockViewportStore.setObjectDrawRoadId).toHaveBeenCalledWith('R1');
    expect(mockViewportStore.setObjectDrawTemplateId).toHaveBeenCalledWith('draw-tpl');
    expect(mockViewportStore.appendObjectDrawVertex).toHaveBeenCalled();
  });

  it('appends vertex when draw is already active', async () => {
    mockViewportStore.pendingObjectTemplateId = 'draw-tpl';
    mockViewportStore.objectDrawTemplateId = 'draw-tpl';
    mockViewportStore.objectDrawRoadId = 'R1';
    mockPluginContribStore.templateSections = [
      { items: [{ id: 'draw-tpl', drawMode: 'polygon', onApply: vi.fn() }] },
    ];
    const road = { id: 'R1', length: 100, junction_id: null };
    const project = { roads: [road], junctions: [] };
    mockService.snapPointOnRoad.mockResolvedValue({ s: 30, t: 2, hdg: 0 });
    const result = await handleObjectDrawClick({ x: 5, y: 6 }, () => project as any);
    expect(result).toBe(true);
    expect(mockViewportStore.appendObjectDrawVertex).toHaveBeenCalled();
  });
});

describe('cancelObjectDraw', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockViewportStore.objectDrawTemplateId = null;
  });

  it('returns false when no drawing is in progress', () => {
    expect(cancelObjectDraw()).toBe(false);
  });

  it('returns true and clears draw state when drawing is active', () => {
    mockViewportStore.objectDrawTemplateId = 'obj-1';
    expect(cancelObjectDraw()).toBe(true);
    expect(mockViewportStore.clearObjectDraw).toHaveBeenCalled();
  });
});
