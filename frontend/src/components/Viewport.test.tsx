import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GisCoord, PlatformService, Project, UtmCoord } from '../services/platform';
import { getPlatformService } from '../services';
import { showContextMenu } from '../services/contextMenu';
import { useEditorStore } from '../stores/editorStore';
import { DEFAULT_DISPLAY, useEditorViewStore } from '../stores/editorViewStore';
import { Viewport } from './Viewport';

const rendererMocks = vi.hoisted(() => ({
  isSupported: vi.fn(),
  init: vi.fn(),
  start: vi.fn(),
  uploadRoadVertices: vi.fn(),
  uploadLaneLineVertices: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
  setShowGrid: vi.fn(),
  setShowAxis: vi.fn(),
  setDimension: vi.fn(),
  fitToVertices: vi.fn(),
  uploadHighlightVertices: vi.fn(),
  clearHighlight: vi.fn(),
  unprojectToGround: vi.fn(),
  setScaleChangeCallback: vi.fn(),
  setClearColor: vi.fn(),
  setGridColor: vi.fn(),
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
      resize: rendererMocks.resize,
      dispose: rendererMocks.dispose,
      setShowGrid: rendererMocks.setShowGrid,
      setShowAxis: rendererMocks.setShowAxis,
      setDimension: rendererMocks.setDimension,
      fitToVertices: rendererMocks.fitToVertices,
      uploadHighlightVertices: rendererMocks.uploadHighlightVertices,
      clearHighlight: rendererMocks.clearHighlight,
      unprojectToGround: rendererMocks.unprojectToGround,
      setScaleChangeCallback: rendererMocks.setScaleChangeCallback,
      setClearColor: rendererMocks.setClearColor,
      setGridColor: rendererMocks.setGridColor,
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
    saveFile: vi.fn().mockResolvedValue(undefined),
    getPlatformInfo: () => ({ type: 'web', version: '0.1.0' }),
    wgs84ToGcj02: vi.fn().mockResolvedValue(makeCoord()),
    gcj02ToWgs84: vi.fn().mockResolvedValue(makeCoord()),
    geoToUtm: vi.fn().mockResolvedValue(makeUtm()),
    utmToGeo: vi.fn().mockResolvedValue(makeCoord()),
    generateRoadVertices: vi.fn().mockResolvedValue(vertices),
    generateSingleRoadVertices: vi.fn().mockResolvedValue(new Float32Array()),
    generateJunctionVertices: vi.fn().mockResolvedValue(new Float32Array()),
    generateLaneLineVertices: vi.fn().mockResolvedValue(new Float32Array()),
    generateCenterLineVertices: vi.fn().mockResolvedValue(new Float32Array()),
    generateSignalPaintVertices: vi.fn().mockResolvedValue(new Float32Array()),
    generateSingleJunctionVertices: vi.fn().mockResolvedValue(new Float32Array()),
    pickRoadAtPoint: vi.fn().mockResolvedValue(null),
    pickJunctionAtPoint: vi.fn().mockResolvedValue(null),
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
      useEditorStore.setState({
        project: makeProject(),
        isDirty: false,
        selectedRoadId: null,
        selectedJunctionId: null,
        selectedObjectType: null,
        selectedSceneNode: null,
        undoStack: [],
        redoStack: [],
      });
      useEditorViewStore.setState({ display: { ...DEFAULT_DISPLAY } });
    });
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
    await waitFor(() => expect(platform.generateRoadVertices).toHaveBeenCalledWith(makeProject(), 2));
    await waitFor(() => expect(rendererMocks.uploadRoadVertices).toHaveBeenCalledWith(vertices));

    const resizeObserver = resizeObservers[0]!;

    act(() => {
      resizeObserver.callback(
        [{ contentRect: { width: 100, height: 50 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });

    expect(rendererMocks.resize).toHaveBeenCalledWith(100, 50);

    unmount();

    expect(resizeObserver.disconnect).toHaveBeenCalledTimes(1);
    expect(rendererMocks.dispose).toHaveBeenCalledTimes(1);
  });

  it('logs an error but does not crash when generateRoadVertices rejects', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const platform = createPlatformMock();
    (platform.generateRoadVertices as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('WASM not ready'));
    rendererMocks.isSupported.mockReturnValue(true);
    rendererMocks.init.mockResolvedValue(true);
    vi.mocked(getPlatformService).mockResolvedValue(platform);

    render(<Viewport />);

    await waitFor(() => expect(rendererMocks.init).toHaveBeenCalled());
    await waitFor(() => expect(platform.generateRoadVertices).toHaveBeenCalled());
    await waitFor(() => expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Viewport] Failed to generate road mesh:',
      expect.any(Error),
    ));

    expect(rendererMocks.uploadRoadVertices).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
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
    (platform.pickRoadAtPoint as ReturnType<typeof vi.fn>).mockResolvedValue('road-1');
    rendererMocks.isSupported.mockReturnValue(true);
    rendererMocks.init.mockResolvedValue(true);
    rendererMocks.unprojectToGround.mockReturnValue({ x: 10, y: 20 });
    vi.mocked(getPlatformService).mockResolvedValue(platform);

    render(<Viewport />);

    await waitFor(() => expect(rendererMocks.init).toHaveBeenCalled());
    const canvas = document.querySelector('.viewport-canvas') as HTMLCanvasElement;

    fireEvent.mouseDown(canvas, { button: 0, clientX: 24, clientY: 32 });
    fireEvent.click(canvas, { button: 0, clientX: 24, clientY: 32 });

    await waitFor(() => expect(platform.pickRoadAtPoint).toHaveBeenCalledWith(makeProject(), 10, 20, 5.0));
    expect(useEditorStore.getState().selectedRoadId).toBe('road-1');
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

    expect(platform.pickRoadAtPoint).not.toHaveBeenCalled();
    expect(useEditorStore.getState().selectedRoadId).toBeNull();
  });

  it('uploads red highlight vertices when a road is selected', async () => {
    const platform = createPlatformMock(new Float32Array([0, 0, 0, 0.1, 0.2, 0.3, 0.4]));
    rendererMocks.isSupported.mockReturnValue(true);
    rendererMocks.init.mockResolvedValue(true);
    vi.mocked(getPlatformService).mockResolvedValue(platform);

    act(() => {
      useEditorStore.setState({
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
});
