import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GisCoord, PlatformService, Project, UtmCoord } from '../services/platform';
import { getPlatformService } from '../services';
import { showContextMenu } from '../services/contextMenu';
import { useProjectStore } from '../stores/projectStore';
import { DEFAULT_DISPLAY, useViewportStore } from '../stores/viewportStore';
import { usePluginContribStore } from '../stores/pluginContribStore';
import { Viewport } from './Viewport';

const rendererMocks = vi.hoisted(() => ({
  isSupported: vi.fn(),
  init: vi.fn(),
  start: vi.fn(),
  uploadRoadVertices: vi.fn(),
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
  projectWorldToScreen: vi.fn().mockReturnValue({ x: 50, y: 50 }),
  setSplinePreviewKnots: vi.fn(),
  setScaleChangeCallback: vi.fn(),
  setOverlayRenderers: vi.fn(),
  setClearColor: vi.fn(),
  setGridColor: vi.fn(),
  getMetersPerPixel: vi.fn().mockReturnValue(0.1),
  applyPan: vi.fn(),
  applyZoomFactor: vi.fn(),
  clearLinkHighlight: vi.fn(),
  uploadLinkHighlightVertices: vi.fn(),
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
    })),
    { isSupported: rendererMocks.isSupported },
  ),
}));

function makeProject(): Project {
  return {
    name: 'Viewport Project',
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

function makeProjectWithRoad(): Project {
  return {
    ...makeProject(),
    roads: [{
      id: 'road-1',
      name: 'Road 1',
      length: 20,
      junction_id: null,
      link: { predecessor: null, successor: null },
      plan_view: [],
      elevation_profile: [],
      lane_sections: [],
    }],
  };
}

function makeProjectWithRoadPlanView(): Project {
  return {
    ...makeProject(),
    roads: [{
      id: 'road-1',
      name: 'Road 1',
      length: 20,
      junction_id: null,
      link: { predecessor: null, successor: null },
      plan_view: [
        { s: 0, x: 0, y: 0, hdg: 0, length: 10, geo_type: 'Line' },
        { s: 10, x: 10, y: 0, hdg: 0, length: 10, geo_type: 'Line' },
      ],
      elevation_profile: [],
      lane_sections: [],
    }],
  };
}

function makeCoord(): GisCoord {
  return { lat: 0, lon: 0, alt: 0 };
}

function makeUtm(): UtmCoord {
  return { easting: 0, northing: 0, zone: 50, is_northern: true, alt: 0 };
}

function createPlatformMock(vertices = new Float32Array([1, 2, 3])): PlatformService {
  return {
    parseOpenDrive: vi.fn().mockResolvedValue(makeProject()),
    writeOpenDrive: vi.fn().mockResolvedValue('<OpenDRIVE />'),
    openFile: vi.fn().mockResolvedValue(null),
    openFileByPath: vi.fn().mockResolvedValue(null),
    saveFile: vi.fn().mockResolvedValue(undefined),
    getPlatformInfo: () => ({ type: 'web', version: '0.1.0' }),
    wgs84ToGcj02: vi.fn().mockResolvedValue(makeCoord()),
    gcj02ToWgs84: vi.fn().mockResolvedValue(makeCoord()),
    geoToUtm: vi.fn().mockResolvedValue(makeUtm()),
    utmToGeo: vi.fn().mockResolvedValue(makeCoord()),
    generateRoadVertices: vi.fn().mockResolvedValue(vertices),
    generateSingleRoadVertices: vi.fn().mockResolvedValue(new Float32Array()),
    generateJunctionVertices: vi.fn().mockResolvedValue(new Float32Array()),
    generateLaneBoundaryVertices: vi.fn().mockResolvedValue(new Float32Array()),
    generateLaneLineVertices: vi.fn().mockResolvedValue(new Float32Array()),
    generateCenterLineVertices: vi.fn().mockResolvedValue(new Float32Array()),
    generateSignalPaintVertices: vi.fn().mockResolvedValue(new Float32Array()),
    generateSingleJunctionVertices: vi.fn().mockResolvedValue(new Float32Array()),
    pickRoadAtPoint: vi.fn().mockResolvedValue(null),
    pickJunctionAtPoint: vi.fn().mockResolvedValue(null),
    queryElevation: vi.fn().mockResolvedValue({ elevation: 0, grade: 0, grade_pct: 0 }),
    addElevationPoint: vi.fn().mockResolvedValue(makeProject()),
    deleteElevationPoint: vi.fn().mockResolvedValue(makeProject()),
    smoothElevation: vi.fn().mockResolvedValue(makeProject()),
    snapPoint: vi.fn().mockResolvedValue({ x: 0, y: 0, snapped: false, snap_type: 'None', target_id: null }),
    measureDistance: vi.fn().mockResolvedValue({ straight: 0, horizontal: 0, vertical: 0 }),
    measureAngle: vi.fn().mockResolvedValue({ radians: 0, degrees: 0 }),
    measureArea: vi.fn().mockResolvedValue({ area: 0, perimeter: 0 }),
    measureRoadLength: vi.fn().mockResolvedValue(0),
    sampleLaneBoundary: vi.fn().mockResolvedValue([]),
    getRoadTemplates: vi.fn().mockResolvedValue([
      { id: 'single', name: 'Single Lane', left_lanes: 1, right_lanes: 1, lane_width: 3.5 },
    ]),
    createRoadFromSpline: vi.fn().mockResolvedValue(makeProject()),
    roadToSpline: vi.fn().mockResolvedValue({ knots: [] }),
    moveSplineKnot: vi.fn().mockResolvedValue({ knots: [] }),
    splineToGeometries: vi.fn().mockResolvedValue([]),
    generateObjectVertices: vi.fn().mockResolvedValue(new Float32Array()),
    pickSignalAtPoint: vi.fn().mockResolvedValue(null),
    pickObjectAtPoint: vi.fn().mockResolvedValue(null),
    pickSignalAtPointCached: vi.fn().mockResolvedValue(null),
    pickObjectAtPointCached: vi.fn().mockResolvedValue(null),
    generateSingleSignalVertices: vi.fn().mockResolvedValue(new Float32Array()),
    generateSingleObjectVertices: vi.fn().mockResolvedValue(new Float32Array()),
    getSignalWorldPos: vi.fn().mockResolvedValue(null),
    getObjectWorldPos: vi.fn().mockResolvedValue(null),
    getSignalWorldPosCached: vi.fn().mockResolvedValue(null),
    getObjectWorldPosCached: vi.fn().mockResolvedValue(null),
    getLaneWorldPosCached: vi.fn().mockResolvedValue(null),
    getRoadEndpointTangent: vi.fn().mockResolvedValue(null),
    setProjectCache: vi.fn().mockResolvedValue(undefined),
    invalidateProjectCache: vi.fn().mockResolvedValue(undefined),
    hasProjectCache: vi.fn().mockResolvedValue(true),
    pickRoadAtPointCached: vi.fn().mockResolvedValue(null),
    pickJunctionAtPointCached: vi.fn().mockResolvedValue(null),
    snapPointCached: vi.fn().mockResolvedValue({ x: 0, y: 0, snapped: false, snap_type: 'None', target_id: null }),
    snapPointOnRoad: vi.fn().mockResolvedValue({ s: 0, t: 0, hdg: 0 }),
    pickLaneAtPointCached: vi.fn().mockResolvedValue(null),
  };
}

describe('Viewport', () => {
  let resizeObservers: Array<{ callback: ResizeObserverCallback; disconnect: ReturnType<typeof vi.fn> }>;

  beforeEach(() => {
    vi.clearAllMocks();
    resizeObservers = [];

    vi.stubGlobal(
      'ResizeObserver',
      class {
        private readonly disconnectMock = vi.fn();

        constructor(callback: ResizeObserverCallback) {
          resizeObservers.push({ callback, disconnect: this.disconnectMock });
        }

        observe() {}
        disconnect() {
          this.disconnectMock();
        }
      }
    );

    act(() => {
      useProjectStore.setState({
        project: makeProject(),
        isDirty: false,
        selectedRoadId: null,
        selectedJunctionId: null,
        selectedObjectType: null,
        selectedSceneNode: null,
        undoStack: [],
        redoStack: [],
      });
      useViewportStore.setState({ display: { ...DEFAULT_DISPLAY }, geometryEditSpline: null, geometryEditRoadId: null, editMode: 'default', splineKnots: [] });
    });
  });

  it('renders a canvas and loading overlay while WebGPU initialization is pending', () => {
    const platform = createPlatformMock();
    rendererMocks.isSupported.mockReturnValue(true);
    rendererMocks.init.mockImplementation(() => new Promise<boolean>(() => {}));
    vi.mocked(getPlatformService).mockResolvedValue(platform);

    render(<Viewport />);

    expect(document.querySelector('.viewport-canvas')).toBeInTheDocument();
    expect(screen.getByText('3D 视口 — 正在初始化 WebGPU...')).toBeInTheDocument();
    expect(rendererMocks.start).not.toHaveBeenCalled();
  });

  it('shows the unsupported overlay when WebGPU is unavailable', () => {
    rendererMocks.isSupported.mockReturnValue(false);

    render(<Viewport />);

    expect(screen.getByText('3D 视口 — 不支持 WebGPU')).toBeInTheDocument();
  });

  it('initializes the renderer, uploads vertices, resizes, and disposes cleanly', async () => {
    const vertices = new Float32Array([1, 2, 3]);
    const platform = createPlatformMock(vertices);
    rendererMocks.isSupported.mockReturnValue(true);
    rendererMocks.init.mockResolvedValue(true);
    vi.mocked(getPlatformService).mockResolvedValue(platform);

    const { unmount } = render(<Viewport />);

    await waitFor(() => expect(rendererMocks.init).toHaveBeenCalled());
    await waitFor(() => expect(rendererMocks.start).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(platform.generateRoadVertices).toHaveBeenCalledWith(makeProject(), 2, 'byLaneType'));
    await waitFor(() => expect(rendererMocks.uploadRoadVertices).toHaveBeenCalledWith(vertices));

    const resizeObserver = resizeObservers[0]!;

    act(() => {
      resizeObserver.callback(
        [{ contentRect: { width: 100, height: 50 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });

    await waitFor(() => expect(rendererMocks.resize).toHaveBeenCalledWith(100, 50));

    unmount();

    expect(resizeObserver.disconnect).toHaveBeenCalledTimes(1);
    expect(rendererMocks.dispose).toHaveBeenCalledTimes(1);
  });

  it('logs an error but does not crash when generateRoadVertices rejects', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const platform = createPlatformMock();
    (platform.generateRoadVertices as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('WASM not ready'));
    rendererMocks.isSupported.mockReturnValue(true);
    rendererMocks.init.mockResolvedValue(true);
    vi.mocked(getPlatformService).mockResolvedValue(platform);

    render(<Viewport />);

    await waitFor(() => expect(rendererMocks.init).toHaveBeenCalled());
    await waitFor(() => expect(platform.generateRoadVertices).toHaveBeenCalled());
    await waitFor(() => {
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[Viewport] generateRoadVertices failed:',
        expect.any(Error),
      );
    });
    // uploadRoadVertices is still called with empty fallback data
    await waitFor(() => expect(rendererMocks.uploadRoadVertices).toHaveBeenCalled());

    consoleWarnSpy.mockRestore();
  });

  it('does not upload vertices when project has no roads', async () => {
    const platform = createPlatformMock(new Float32Array([]));
    rendererMocks.isSupported.mockReturnValue(true);
    rendererMocks.init.mockResolvedValue(true);
    vi.mocked(getPlatformService).mockResolvedValue(platform);

    render(<Viewport />);

    await waitFor(() => expect(platform.generateRoadVertices).toHaveBeenCalled());
    // uploadRoadVertices is still called — but with an empty array; renderer is responsible for no-op
    await waitFor(() => expect(rendererMocks.uploadRoadVertices).toHaveBeenCalledWith(new Float32Array([])));
  });

  it('selects a road on plain left click', async () => {
    const platform = createPlatformMock();
    (platform.pickRoadAtPointCached as ReturnType<typeof vi.fn>).mockResolvedValue('road-1');
    rendererMocks.isSupported.mockReturnValue(true);
    rendererMocks.init.mockResolvedValue(true);
    rendererMocks.unprojectToGround.mockReturnValue({ x: 10, y: 20 });
    vi.mocked(getPlatformService).mockResolvedValue(platform);

    render(<Viewport />);

    await waitFor(() => expect(rendererMocks.init).toHaveBeenCalled());
    const canvas = document.querySelector('.viewport-canvas') as HTMLCanvasElement;

    fireEvent.mouseDown(canvas, { button: 0, clientX: 24, clientY: 32 });
    fireEvent.click(canvas, { button: 0, clientX: 24, clientY: 32 });

    await waitFor(() => expect(platform.pickRoadAtPointCached).toHaveBeenCalledWith(10, 20, 5.0));
    expect(useProjectStore.getState().selectedRoadId).toBe('road-1');
  });

  it('does not select a road after a modified left-button drag', async () => {
    const platform = createPlatformMock();
    rendererMocks.isSupported.mockReturnValue(true);
    rendererMocks.init.mockResolvedValue(true);
    rendererMocks.unprojectToGround.mockReturnValue({ x: 10, y: 20 });
    vi.mocked(getPlatformService).mockResolvedValue(platform);

    render(<Viewport />);

    await waitFor(() => expect(rendererMocks.init).toHaveBeenCalled());
    const canvas = document.querySelector('.viewport-canvas') as HTMLCanvasElement;

    fireEvent.mouseDown(canvas, { button: 0, clientX: 24, clientY: 32, ctrlKey: true });
    fireEvent.mouseMove(canvas, { buttons: 1, clientX: 40, clientY: 52, ctrlKey: true });
    fireEvent.click(canvas, { button: 0, clientX: 40, clientY: 52, ctrlKey: true });

    expect(platform.pickRoadAtPointCached).not.toHaveBeenCalled();
    expect(useProjectStore.getState().selectedRoadId).toBeNull();
  });

  it('uploads red highlight vertices when a road is selected', async () => {
    const platform = createPlatformMock(new Float32Array([0, 0, 0, 0.1, 0.2, 0.3, 0.4]));
    rendererMocks.isSupported.mockReturnValue(true);
    rendererMocks.init.mockResolvedValue(true);
    vi.mocked(getPlatformService).mockResolvedValue(platform);

    act(() => {
      useProjectStore.setState({
        project: makeProjectWithRoad(),
        selectedRoadId: 'road-1',
        selectedJunctionId: null,
        selectedObjectType: 'road',
        selectedSceneNode: { type: 'road', roadId: 'road-1' },
      });
    });

    render(<Viewport />);

    await waitFor(() => expect(rendererMocks.uploadHighlightVertices).toHaveBeenCalled());
    const highlightCalls = (rendererMocks.uploadHighlightVertices as ReturnType<typeof vi.fn>).mock.calls;
    const highlightVerts = highlightCalls[highlightCalls.length - 1]?.[0] as Float32Array;
    expect(highlightVerts[0]).toBe(0);
    expect(highlightVerts[1]).toBe(0);
    expect(highlightVerts[2]).toBe(0);
    expect(highlightVerts[3]).toBeCloseTo(0.95);
    expect(highlightVerts[4]).toBeCloseTo(0.18);
    expect(highlightVerts[5]).toBeCloseTo(0.18);
    expect(highlightVerts[6]).toBeCloseTo(0.82);
  });

  it('shows the viewport context menu on a plain right click', async () => {
    const platform = createPlatformMock();
    rendererMocks.isSupported.mockReturnValue(true);
    rendererMocks.init.mockResolvedValue(true);
    vi.mocked(getPlatformService).mockResolvedValue(platform);

    render(<Viewport />);

    await waitFor(() => expect(rendererMocks.init).toHaveBeenCalled());
    const canvas = document.querySelector('.viewport-canvas') as HTMLCanvasElement;

    fireEvent.mouseDown(canvas, { button: 2, clientX: 60, clientY: 80 });
    fireEvent.contextMenu(canvas, { button: 2, clientX: 60, clientY: 80 });

    expect(showContextMenu).toHaveBeenCalledWith(60, 80, 'viewport');
  });

  it('suppresses the viewport context menu after a right-button drag', async () => {
    const platform = createPlatformMock();
    rendererMocks.isSupported.mockReturnValue(true);
    rendererMocks.init.mockResolvedValue(true);
    vi.mocked(getPlatformService).mockResolvedValue(platform);

    render(<Viewport />);

    await waitFor(() => expect(rendererMocks.init).toHaveBeenCalled());
    const canvas = document.querySelector('.viewport-canvas') as HTMLCanvasElement;

    fireEvent.mouseDown(canvas, { button: 2, clientX: 60, clientY: 80 });
    fireEvent.mouseMove(canvas, { buttons: 2, clientX: 84, clientY: 108 });
    fireEvent.contextMenu(canvas, { button: 2, clientX: 84, clientY: 108 });

    expect(showContextMenu).not.toHaveBeenCalled();
  });

  it('deletes the selected road when the Delete key is pressed', async () => {
    const platform = createPlatformMock();
    rendererMocks.isSupported.mockReturnValue(true);
    rendererMocks.init.mockResolvedValue(true);
    vi.mocked(getPlatformService).mockResolvedValue(platform);

    act(() => {
      useProjectStore.setState({
        project: makeProjectWithRoad(),
        selectedRoadId: 'road-1',
        selectedObjectType: 'road',
        selectedSceneNode: { type: 'road', roadId: 'road-1' },
      });
    });

    render(<Viewport />);
    await waitFor(() => expect(rendererMocks.init).toHaveBeenCalled());

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
    });

    await waitFor(() => expect(useProjectStore.getState().project.roads).toHaveLength(0));
    expect(useProjectStore.getState().selectedRoadId).toBeNull();
  });

  it('clears road selection when Escape is pressed in select mode', async () => {
    const platform = createPlatformMock();
    rendererMocks.isSupported.mockReturnValue(true);
    rendererMocks.init.mockResolvedValue(true);
    vi.mocked(getPlatformService).mockResolvedValue(platform);

    act(() => {
      useProjectStore.setState({
        project: makeProjectWithRoad(),
        selectedRoadId: 'road-1',
        selectedObjectType: 'road',
        selectedSceneNode: { type: 'road', roadId: 'road-1' },
      });
    });

    render(<Viewport />);
    await waitFor(() => expect(rendererMocks.init).toHaveBeenCalled());

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(useProjectStore.getState().selectedRoadId).toBeNull();
  });

  it('uploads golden hover vertices when hovering over a road in select mode', async () => {
    const platform = createPlatformMock();
    (platform.pickRoadAtPointCached as ReturnType<typeof vi.fn>).mockResolvedValue('road-1');
    (platform.generateSingleRoadVertices as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Float32Array([1, 2, 3, 1.0, 0.85, 0.1, 0.5]),
    );
    rendererMocks.isSupported.mockReturnValue(true);
    rendererMocks.init.mockResolvedValue(true);
    rendererMocks.unprojectToGround.mockReturnValue({ x: 10, y: 20 });
    vi.mocked(getPlatformService).mockResolvedValue(platform);

    act(() => {
      useProjectStore.setState({ project: makeProjectWithRoad() });
      useViewportStore.setState({ showHoverHighlight: true });
    });

    render(<Viewport />);
    await waitFor(() => expect(rendererMocks.init).toHaveBeenCalled());

    const canvas = document.querySelector('.viewport-canvas') as HTMLCanvasElement;
    fireEvent.mouseMove(canvas, { clientX: 50, clientY: 50 });

    await waitFor(() => expect(rendererMocks.uploadHoverVertices).toHaveBeenCalled());
  });

  it('clears hover vertices when mouse moves off a road', async () => {
    const platform = createPlatformMock();
    (platform.pickRoadAtPointCached as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('road-1')
      .mockResolvedValue(null);
    (platform.pickJunctionAtPointCached as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (platform.generateSingleRoadVertices as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Float32Array([1, 2, 3, 1, 0, 0, 1]),
    );
    rendererMocks.isSupported.mockReturnValue(true);
    rendererMocks.init.mockResolvedValue(true);
    rendererMocks.unprojectToGround.mockReturnValue({ x: 10, y: 20 });
    vi.mocked(getPlatformService).mockResolvedValue(platform);

    act(() => {
      useProjectStore.setState({ project: makeProjectWithRoad() });
      useViewportStore.setState({ showHoverHighlight: true });
    });

    render(<Viewport />);
    await waitFor(() => expect(rendererMocks.init).toHaveBeenCalled());

    const canvas = document.querySelector('.viewport-canvas') as HTMLCanvasElement;
    fireEvent.mouseMove(canvas, { clientX: 50, clientY: 50 });
    await waitFor(() => expect(rendererMocks.uploadHoverVertices).toHaveBeenCalled());

    fireEvent.mouseMove(canvas, { clientX: 200, clientY: 200 });
    await waitFor(() => expect(rendererMocks.clearHover).toHaveBeenCalled());
  });

  it('enters geometry edit mode when E is pressed with a road selected', async () => {
    const platform = createPlatformMock();
    (platform.roadToSpline as ReturnType<typeof vi.fn>).mockResolvedValue({ knots: [[0, 0, 0], [10, 0, 0]] });
    rendererMocks.isSupported.mockReturnValue(true);
    rendererMocks.init.mockResolvedValue(true);
    vi.mocked(getPlatformService).mockResolvedValue(platform);

    act(() => {
      useProjectStore.setState({
        project: makeProjectWithRoadPlanView(),
        selectedRoadId: 'road-1',
        selectedObjectType: 'road',
        selectedSceneNode: { type: 'road', roadId: 'road-1' },
      });
    });

    render(<Viewport />);
    await waitFor(() => expect(rendererMocks.init).toHaveBeenCalled());

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }));
    });

    await waitFor(() =>
      expect(useViewportStore.getState().geometryEditSpline).not.toBeNull()
    );
  });

  it('shift+click adds a road to multi-selection', async () => {
    const platform = createPlatformMock();
    (platform.pickRoadAtPointCached as ReturnType<typeof vi.fn>).mockResolvedValue('road-1');
    rendererMocks.isSupported.mockReturnValue(true);
    rendererMocks.init.mockResolvedValue(true);
    rendererMocks.unprojectToGround.mockReturnValue({ x: 10, y: 20 });
    vi.mocked(getPlatformService).mockResolvedValue(platform);

    act(() => {
      useProjectStore.setState({ project: makeProjectWithRoad(), selectedRoadIds: [] });
    });

    render(<Viewport />);
    await waitFor(() => expect(rendererMocks.init).toHaveBeenCalled());

    const canvas = document.querySelector('.viewport-canvas') as HTMLCanvasElement;
    // Simulate Shift+click (mousedown + click with shiftKey)
    fireEvent.mouseDown(canvas, { button: 0, clientX: 50, clientY: 50, shiftKey: true });
    fireEvent.click(canvas, { button: 0, clientX: 50, clientY: 50, shiftKey: true });

    await waitFor(() =>
      expect(useProjectStore.getState().selectedRoadIds).toContain('road-1')
    );
  });

  it('shift+click on already-selected road removes it from multi-selection', async () => {
    const platform = createPlatformMock();
    (platform.pickRoadAtPointCached as ReturnType<typeof vi.fn>).mockResolvedValue('road-1');
    rendererMocks.isSupported.mockReturnValue(true);
    rendererMocks.init.mockResolvedValue(true);
    rendererMocks.unprojectToGround.mockReturnValue({ x: 10, y: 20 });
    vi.mocked(getPlatformService).mockResolvedValue(platform);

    act(() => {
      useProjectStore.setState({
        project: makeProjectWithRoad(),
        selectedRoadIds: ['road-1'],
        selectedRoadId: null,
      });
    });

    render(<Viewport />);
    await waitFor(() => expect(rendererMocks.init).toHaveBeenCalled());

    const canvas = document.querySelector('.viewport-canvas') as HTMLCanvasElement;
    fireEvent.mouseDown(canvas, { button: 0, clientX: 50, clientY: 50, shiftKey: true });
    fireEvent.click(canvas, { button: 0, clientX: 50, clientY: 50, shiftKey: true });

    await waitFor(() =>
      expect(useProjectStore.getState().selectedRoadIds).not.toContain('road-1')
    );
  });

  it('single-touch drag pans the camera', async () => {
    rendererMocks.isSupported.mockReturnValue(true);
    rendererMocks.init.mockResolvedValue(true);
    const platform = createPlatformMock();
    vi.mocked(getPlatformService).mockResolvedValue(platform);

    render(<Viewport />);
    await waitFor(() => expect(rendererMocks.init).toHaveBeenCalled());

    const canvas = document.querySelector('.viewport-canvas') as HTMLCanvasElement;

    // Create a minimal Touch-like object
    const makeTouch = (id: number, x: number, y: number) =>
      ({ identifier: id, clientX: x, clientY: y, target: canvas } as unknown as Touch);

    fireEvent.touchStart(canvas, { changedTouches: [makeTouch(0, 100, 100)], touches: [makeTouch(0, 100, 100)] });
    fireEvent.touchMove(canvas, { changedTouches: [makeTouch(0, 120, 110)], touches: [makeTouch(0, 120, 110)] });

    expect(rendererMocks.applyPan).toHaveBeenCalled();
  });

  it('two-finger pinch zooms the camera', async () => {
    rendererMocks.isSupported.mockReturnValue(true);
    rendererMocks.init.mockResolvedValue(true);
    const platform = createPlatformMock();
    vi.mocked(getPlatformService).mockResolvedValue(platform);

    render(<Viewport />);
    await waitFor(() => expect(rendererMocks.init).toHaveBeenCalled());

    const canvas = document.querySelector('.viewport-canvas') as HTMLCanvasElement;
    const makeTouch = (id: number, x: number, y: number) =>
      ({ identifier: id, clientX: x, clientY: y, target: canvas } as unknown as Touch);

    // Start with two fingers 100px apart
    fireEvent.touchStart(canvas, {
      changedTouches: [makeTouch(0, 100, 100), makeTouch(1, 200, 100)],
      touches: [makeTouch(0, 100, 100), makeTouch(1, 200, 100)],
    });
    // Move fingers 50px apart (pinch in)
    fireEvent.touchMove(canvas, {
      changedTouches: [makeTouch(0, 125, 100), makeTouch(1, 175, 100)],
      touches: [makeTouch(0, 125, 100), makeTouch(1, 175, 100)],
    });

    expect(rendererMocks.applyZoomFactor).toHaveBeenCalled();
  });

  describe('template drag-and-drop', () => {
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

    beforeEach(() => {
      act(() => {
        usePluginContribStore.setState({ templateSections: [] });
      });
    });

    it('adds viewport-drag-over class on dragenter with a template payload', async () => {
      setupDragDropTest();
      render(<Viewport />);
      await waitFor(() => expect(rendererMocks.init).toHaveBeenCalled());

      const viewport = document.querySelector('.viewport')!;
      fireEvent.dragEnter(viewport, { dataTransfer: templateDt });

      expect(viewport.classList.contains('viewport-drag-over')).toBe(true);
    });

    it('preserves viewport-drag-over class during dragover (set by dragenter)', async () => {
      setupDragDropTest();
      render(<Viewport />);
      await waitFor(() => expect(rendererMocks.init).toHaveBeenCalled());

      const viewport = document.querySelector('.viewport')!;
      fireEvent.dragEnter(viewport, { dataTransfer: templateDt });
      expect(viewport.classList.contains('viewport-drag-over')).toBe(true);

      // dragover should not clear the class
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

      // relatedTarget=null means leaving to outside (not a child element)
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

    function makeProjectWithRoadSections(): Project {
      return {
        ...makeProject(),
        roads: [{
          id: 'road-1',
          name: 'Road 1',
          length: 30,
          junction_id: null,
          link: { predecessor: null, successor: null },
          plan_view: [],
          elevation_profile: [],
          lane_sections: [
            { s: 0, single_side: false, left: [], center: [], right: [] },
            { s: 10, single_side: false, left: [], center: [], right: [] },
            { s: 20, single_side: false, left: [], center: [], right: [] },
          ],
        }],
      };
    }

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

        // adjust-edge mode skips click selection
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
        // Should complete without error
      });
    });
  });
});
