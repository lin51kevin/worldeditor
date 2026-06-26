import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../services/platform';
import { getPlatformService } from '../services';
import { useProjectStore } from '../stores/projectStore';
import { DEFAULT_DISPLAY, useViewportStore } from '../stores/viewportStore';
import { usePluginContribStore } from '../stores/pluginContribStore';
import { Viewport } from './Viewport';
import {
  createPlatformMock,
  makeProject,
  makeProjectWithRoad,
  makeProjectWithRoadSections,
} from './viewportTestUtils';

const rendererMocks = vi.hoisted(() => ({
  isSupported: vi.fn(),
  init: vi.fn(),
  start: vi.fn(),
  uploadRoadVertices: vi.fn(),
  uploadJunctionVertices: vi.fn(),
  uploadLaneLineVertices: vi.fn(),
  uploadOverlayVertices: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
  setShowGrid: vi.fn(),
  setShowAxis: vi.fn(),
  setDimension: vi.fn(),
  setViewMode: vi.fn(),
  fitToVertices: vi.fn(),
  panToCenter: vi.fn(),
  uploadHighlightVertices: vi.fn(),
  uploadHoverVertices: vi.fn(),
  clearHover: vi.fn(),
  clearHighlight: vi.fn(),
  clearVertexCache: vi.fn(),
  lockCamera: vi.fn(),
  unlockCamera: vi.fn(),
  getCameraDistance: vi.fn().mockReturnValue(100),
  refreshSplineMarkers: vi.fn(),
  setCurveFromVertexData: vi.fn(),
  unprojectToGround: vi.fn(),
  projectWorldToScreen: vi.fn(),
  setSplinePreviewKnots: vi.fn(),
  setScaleChangeCallback: vi.fn(),
  setOverlayRenderers: vi.fn(),
  setClearColor: vi.fn(),
  setGridColor: vi.fn(),
  getMetersPerPixel: vi.fn().mockReturnValue(1),
  applyPan: vi.fn(),
  applyZoomFactor: vi.fn(),
  clearLinkHighlight: vi.fn(),
  uploadLinkHighlightVertices: vi.fn(),
  uploadSpriteData: vi.fn(),
  getTextureManager: vi.fn().mockReturnValue(null),
  waitForManifest: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services', () => ({
  getPlatformService: vi.fn(),
}));

vi.mock('../services/contextMenu', () => ({
  showContextMenu: vi.fn(),
}));

vi.mock('../viewport/viewportEvents', () => ({
  onViewportEvent: vi.fn(() => () => {}),
  emitViewportEvent: vi.fn(),
}));

vi.mock('../viewport/renderer', () => ({
  ViewportRenderer: Object.assign(
    vi.fn().mockImplementation(() => ({
      init: rendererMocks.init,
      start: rendererMocks.start,
      uploadRoadVertices: rendererMocks.uploadRoadVertices,
      uploadJunctionVertices: rendererMocks.uploadJunctionVertices,
      uploadLaneLineVertices: rendererMocks.uploadLaneLineVertices,
      uploadOverlayVertices: rendererMocks.uploadOverlayVertices,
      resize: rendererMocks.resize,
      dispose: rendererMocks.dispose,
      setShowGrid: rendererMocks.setShowGrid,
      setShowAxis: rendererMocks.setShowAxis,
      setDimension: rendererMocks.setDimension,
      setViewMode: rendererMocks.setViewMode,
      fitToVertices: rendererMocks.fitToVertices,
      panToCenter: rendererMocks.panToCenter,
      uploadHighlightVertices: rendererMocks.uploadHighlightVertices,
      clearHighlight: rendererMocks.clearHighlight,
      uploadHoverVertices: rendererMocks.uploadHoverVertices,
      clearHover: rendererMocks.clearHover,
      clearVertexCache: rendererMocks.clearVertexCache,
      lockCamera: rendererMocks.lockCamera,
      unlockCamera: rendererMocks.unlockCamera,
      getCameraDistance: rendererMocks.getCameraDistance,
      refreshSplineMarkers: rendererMocks.refreshSplineMarkers,
      setCurveFromVertexData: rendererMocks.setCurveFromVertexData,
      unprojectToGround: rendererMocks.unprojectToGround,
      projectWorldToScreen: rendererMocks.projectWorldToScreen,
      setSplinePreviewKnots: rendererMocks.setSplinePreviewKnots,
      setScaleChangeCallback: rendererMocks.setScaleChangeCallback,
      setOverlayRenderers: rendererMocks.setOverlayRenderers,
      setClearColor: rendererMocks.setClearColor,
      setGridColor: rendererMocks.setGridColor,
      getMetersPerPixel: rendererMocks.getMetersPerPixel,
      applyPan: rendererMocks.applyPan,
      applyZoomFactor: rendererMocks.applyZoomFactor,
      clearLinkHighlight: rendererMocks.clearLinkHighlight,
      uploadLinkHighlightVertices: rendererMocks.uploadLinkHighlightVertices,
      uploadSpriteData: rendererMocks.uploadSpriteData,
      getTextureManager: rendererMocks.getTextureManager,
      waitForManifest: rendererMocks.waitForManifest,
    })),
    { isSupported: rendererMocks.isSupported },
  ),
}));

describe('Viewport — template drag-and-drop & selection modes', () => {
  let resizeObservers: Array<{ callback: ResizeObserverCallback; disconnect: ReturnType<typeof vi.fn> }>;

  beforeEach(() => {
    vi.clearAllMocks();
    resizeObservers = [];

    vi.stubGlobal(
      'ResizeObserver',
      vi.fn().mockImplementation((cb: ResizeObserverCallback) => {
        const entry = { callback: cb, disconnect: vi.fn() };
        resizeObservers.push(entry);
        return { observe: vi.fn(), unobserve: vi.fn(), disconnect: entry.disconnect };
      }),
    );

    useProjectStore.setState({
      project: makeProject(),
      selectedRoadId: null,
      selectedJunctionId: null,
    } as any);
    useViewportStore.setState({
      display: { ...DEFAULT_DISPLAY },
      geometryEditSpline: null,
      geometryEditRoadId: null,
      editMode: 'default',
      splineKnots: [],
    });
  });

  function setupDragDropTest() {
    rendererMocks.isSupported.mockReturnValue(true);
    rendererMocks.init.mockResolvedValue(true);
    rendererMocks.unprojectToGround.mockReturnValue({ x: 42, y: -7 });
    const platform = createPlatformMock();
    vi.mocked(getPlatformService).mockResolvedValue(platform);
    return platform;
  }

  const templateDt = {
    types: ['application/we-template-id'],
    getData: () => '',
    dropEffect: '',
  };

  it('adds viewport-drag-over class on dragenter with a template payload', async () => {
    setupDragDropTest();
    render(<Viewport />);
    await waitFor(() => expect(rendererMocks.init).toHaveBeenCalled());

    const viewport = document.querySelector('.viewport')!;
    fireEvent.dragEnter(viewport, { dataTransfer: templateDt });

    expect(viewport.classList.contains('viewport-drag-over')).toBe(true);
  });

  it('preserves viewport-drag-over class during dragover', async () => {
    setupDragDropTest();
    render(<Viewport />);
    await waitFor(() => expect(rendererMocks.init).toHaveBeenCalled());

    const viewport = document.querySelector('.viewport')!;
    fireEvent.dragEnter(viewport, { dataTransfer: templateDt });
    expect(viewport.classList.contains('viewport-drag-over')).toBe(true);

    fireEvent.dragOver(viewport, { dataTransfer: templateDt });
    expect(viewport.classList.contains('viewport-drag-over')).toBe(true);
  });

  it('removes viewport-drag-over class when drag leaves the viewport', async () => {
    setupDragDropTest();
    render(<Viewport />);
    await waitFor(() => expect(rendererMocks.init).toHaveBeenCalled());

    const viewport = document.querySelector('.viewport')!;
    fireEvent.dragEnter(viewport, { dataTransfer: templateDt });
    expect(viewport.classList.contains('viewport-drag-over')).toBe(true);

    fireEvent.dragLeave(viewport, { relatedTarget: null });
    expect(viewport.classList.contains('viewport-drag-over')).toBe(false);
  });

  it('calls onApply with world coordinates when a template is dropped', async () => {
    setupDragDropTest();
    const onApply = vi.fn();
    act(() => {
      usePluginContribStore.getState().registerTemplateSection({
        id: 'test-section',
        pluginId: 'test-plugin',
        categoryKey: 'Test',
        order: 0,
        items: [{ id: 'tpl:test:road', labelKey: 'Test Road', icon: '╺', onApply }],
      });
    });

    render(<Viewport />);
    await waitFor(() => expect(rendererMocks.init).toHaveBeenCalled());

    const viewport = document.querySelector('.viewport')!;
    fireEvent.drop(viewport, {
      clientX: 100,
      clientY: 80,
      dataTransfer: {
        types: ['application/we-template-id'],
        getData: (key: string) => key === 'application/we-template-id' ? 'tpl:test:road' : '',
        dropEffect: '',
      },
    });

    expect(rendererMocks.unprojectToGround).toHaveBeenCalled();
    expect(onApply).toHaveBeenCalledWith({ x: 42, y: -7, hdg: 0 });
  });

  it('does not call onApply when an unknown template id is dropped', async () => {
    setupDragDropTest();
    const onApply = vi.fn();
    act(() => {
      usePluginContribStore.getState().registerTemplateSection({
        id: 'test-section',
        pluginId: 'test-plugin',
        categoryKey: 'Test',
        order: 0,
        items: [{ id: 'tpl:test:road', labelKey: 'Test Road', icon: '╺', onApply }],
      });
    });

    render(<Viewport />);
    await waitFor(() => expect(rendererMocks.init).toHaveBeenCalled());

    const viewport = document.querySelector('.viewport')!;
    fireEvent.drop(viewport, {
      dataTransfer: {
        types: ['application/we-template-id'],
        getData: (key: string) => key === 'application/we-template-id' ? 'tpl:unknown:item' : '',
      },
    });

    expect(onApply).not.toHaveBeenCalled();
  });

  it('does not apply template when unprojectToGround returns null', async () => {
    setupDragDropTest();
    rendererMocks.unprojectToGround.mockReturnValue(null);
    const onApply = vi.fn();
    act(() => {
      usePluginContribStore.getState().registerTemplateSection({
        id: 'test-section',
        pluginId: 'test-plugin',
        categoryKey: 'Test',
        order: 0,
        items: [{ id: 'tpl:test:road', labelKey: 'Test Road', icon: '╺', onApply }],
      });
    });

    render(<Viewport />);
    await waitFor(() => expect(rendererMocks.init).toHaveBeenCalled());

    const viewport = document.querySelector('.viewport')!;
    fireEvent.drop(viewport, {
      dataTransfer: {
        types: ['application/we-template-id'],
        getData: (key: string) => key === 'application/we-template-id' ? 'tpl:test:road' : '',
      },
    });

    expect(onApply).not.toHaveBeenCalled();
  });

  // --- Lane/LaneSection selection mode tests ---

  async function setupLaneTest(selectionMode: 'laneSection' | 'lane', mockFn?: (platform: ReturnType<typeof createPlatformMock>) => void) {
    const platform = createPlatformMock();
    rendererMocks.isSupported.mockReturnValue(true);
    rendererMocks.init.mockResolvedValue(true);
    rendererMocks.unprojectToGround.mockReturnValue({ x: 10, y: 20 });
    vi.mocked(getPlatformService).mockResolvedValue(platform);

    if (mockFn) mockFn(platform);

    act(() => {
      useProjectStore.setState({ project: makeProjectWithRoadSections() });
      useViewportStore.setState({ editMode: 'default', selectionMode });
    });

    render(<Viewport />);
    await waitFor(() => expect(rendererMocks.init).toHaveBeenCalled());
    const canvas = document.querySelector('.viewport-canvas') as HTMLCanvasElement;
    fireEvent.mouseDown(canvas, { button: 0, clientX: 24, clientY: 32 });
    fireEvent.click(canvas, { button: 0, clientX: 24, clientY: 32 });
    return platform;
  }

  it('laneSection mode selects lane section at clicked position', async () => {
    await setupLaneTest('laneSection', (platform) => {
      (platform.pickRoadAtPointCached as ReturnType<typeof vi.fn>).mockResolvedValue('road-1');
      (platform.snapPointOnRoad as ReturnType<typeof vi.fn>).mockResolvedValue({ s: 15, t: 0, hdg: 0 });
    });

    await waitFor(() => {
      const state = useProjectStore.getState();
      expect((state as any).selectedSceneNode).toEqual({ type: 'laneSection', roadId: 'road-1', sectionIndex: 1 });
    });
  });

  it('lane mode selects lane with positive laneId as left', async () => {
    await setupLaneTest('lane', (platform) => {
      (platform.pickLaneAtPointCached as ReturnType<typeof vi.fn>).mockResolvedValue({ roadId: 'road-1', sectionIndex: 0, laneId: 1 });
    });

    await waitFor(() => {
      const state = useProjectStore.getState();
      expect((state as any).selectedSceneNode).toEqual({ type: 'lane', roadId: 'road-1', sectionIndex: 0, side: 'left', laneId: 1 });
    });
  });

  it('lane mode selects lane with negative laneId as right', async () => {
    await setupLaneTest('lane', (platform) => {
      (platform.pickLaneAtPointCached as ReturnType<typeof vi.fn>).mockResolvedValue({ roadId: 'road-1', sectionIndex: 0, laneId: -2 });
    });

    await waitFor(() => {
      const state = useProjectStore.getState();
      expect((state as any).selectedSceneNode).toEqual({ type: 'lane', roadId: 'road-1', sectionIndex: 0, side: 'right', laneId: -2 });
    });
  });

  it('lane mode falls back to selectRoad when pickLane returns null', async () => {
    await setupLaneTest('lane', (platform) => {
      (platform.pickLaneAtPointCached as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (platform.pickRoadAtPointCached as ReturnType<typeof vi.fn>).mockResolvedValue('road-1');
    });

    await waitFor(() => {
      expect(useProjectStore.getState().selectedRoadId).toBe('road-1');
    });
  });

  describe('adjust-edge mode', () => {
    it('handleClick does not trigger road selection in adjust-edge mode', async () => {
      rendererMocks.isSupported.mockReturnValue(true);
      rendererMocks.init.mockResolvedValue(true);
      const vertices = new Float32Array([0, 0, 0]);
      const platform = createPlatformMock(vertices);
      vi.mocked(getPlatformService).mockResolvedValue(platform);

      useProjectStore.setState({
        project: makeProjectWithRoad(),
      } as any);
      useViewportStore.setState({
        display: { ...DEFAULT_DISPLAY },
        geometryEditSpline: null,
        geometryEditRoadId: null,
        editMode: 'adjust-edge',
        splineKnots: [],
      });

      const { container } = render(<Viewport />);
      await waitFor(() => expect(rendererMocks.init).toHaveBeenCalled());

      const canvas = container.querySelector('canvas')!;
      await act(async () => {
        fireEvent.click(canvas);
      });

      expect(useProjectStore.getState().selectedRoadId).toBeFalsy();
    });

    it('handleMouseDown does not throw in adjust-edge mode', async () => {
      rendererMocks.isSupported.mockReturnValue(true);
      rendererMocks.init.mockResolvedValue(true);
      const vertices = new Float32Array([0, 0, 0]);
      const platform = createPlatformMock(vertices);
      vi.mocked(getPlatformService).mockResolvedValue(platform);

      useProjectStore.setState({
        project: makeProjectWithRoad(),
      } as any);
      useViewportStore.setState({
        display: { ...DEFAULT_DISPLAY },
        geometryEditSpline: null,
        geometryEditRoadId: null,
        editMode: 'adjust-edge',
        splineKnots: [],
      });

      const { container } = render(<Viewport />);
      await waitFor(() => expect(rendererMocks.init).toHaveBeenCalled());

      const canvas = container.querySelector('canvas')!;
      await act(async () => {
        fireEvent.mouseDown(canvas, { button: 0 });
      });
    });
  });
});
