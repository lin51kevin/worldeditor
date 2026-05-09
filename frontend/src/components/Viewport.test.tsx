import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GisCoord, PlatformService, Project, UtmCoord } from '../services/platform';
import { getPlatformService } from '../services';
import { useEditorStore } from '../stores/editorStore';
import { Viewport } from './Viewport';

const rendererMocks = vi.hoisted(() => ({
  isSupported: vi.fn(),
  init: vi.fn(),
  start: vi.fn(),
  uploadRoadVertices: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
  setShowGrid: vi.fn(),
  setShowAxis: vi.fn(),
  setDimension: vi.fn(),
  fitToVertices: vi.fn(),
  uploadHighlightVertices: vi.fn(),
  clearHighlight: vi.fn(),
  unprojectToGround: vi.fn(),
}));

vi.mock('../services', () => ({
  getPlatformService: vi.fn(),
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
      resize: rendererMocks.resize,
      dispose: rendererMocks.dispose,
      setShowGrid: rendererMocks.setShowGrid,
      setShowAxis: rendererMocks.setShowAxis,
      setDimension: rendererMocks.setDimension,
      fitToVertices: rendererMocks.fitToVertices,
      uploadHighlightVertices: rendererMocks.uploadHighlightVertices,
      clearHighlight: rendererMocks.clearHighlight,
      unprojectToGround: rendererMocks.unprojectToGround,
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
    pickRoadAtPoint: vi.fn().mockResolvedValue(null),
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
        selectedObjectType: null,
        undoStack: [],
        redoStack: [],
      });
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
});
