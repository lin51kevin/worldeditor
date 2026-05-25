import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GisCoord, PlatformService, Project, Road, UtmCoord } from '../../services/platform';
import { useProjectStore } from '../../stores/projectStore';
import { useRecentFilesStore } from '../../stores/recentFilesStore';
import { usePluginContribStore } from '../../stores/pluginContribStore';
import { getPlatformService } from '../../services';
import { emitViewportEvent } from '../../viewport/viewportEvents';
import { showAlert, showConfirm, showPrompt } from '../../utils/dialog';
import { MenuBar } from './MenuBar';

vi.mock('../../services', () => ({
  getPlatformService: vi.fn(),
}));

vi.mock('../../viewport/viewportEvents', () => ({
  emitViewportEvent: vi.fn(),
}));

vi.mock('../../utils/dialog', () => ({
  showAlert: vi.fn().mockResolvedValue(undefined),
  showConfirm: vi.fn().mockResolvedValue(true),
  showPrompt: vi.fn().mockResolvedValue('renamed.xodr'),
}));

function makeProject(roads: Road[] = [], name = 'Untitled'): Project {
  return {
    name,
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
    roads,
    junctions: [],
    signals: [],
    objects: [],
  };
}

function makeRoad(id: string, length: number): Road {
  return {
    id,
    name: `Road ${id}`,
    length,
    junction_id: null,
    link: { predecessor: null, successor: null },
    plan_view: [{ s: 0, x: 0, y: 0, hdg: 0, length, geo_type: 'Line' }],
    elevation_profile: [],
    lane_sections: [],
  };
}

function makeCoord(): GisCoord {
  return { lat: 0, lon: 0, alt: 0 };
}

function makeUtm(): UtmCoord {
  return { easting: 0, northing: 0, zone: 50, is_northern: true, alt: 0 };
}

function createPlatformMock() {
  const parseOpenDrive = vi.fn<PlatformService['parseOpenDrive']>().mockResolvedValue(makeProject());
  const writeOpenDrive = vi.fn<PlatformService['writeOpenDrive']>().mockResolvedValue('<OpenDRIVE />');
  const openFile = vi.fn<PlatformService['openFile']>().mockResolvedValue(null);
  const saveFile = vi.fn<PlatformService['saveFile']>().mockResolvedValue(null);
  const openFileByPath = vi.fn<PlatformService['openFileByPath']>().mockResolvedValue(null);

  const platform: PlatformService = {
    parseOpenDrive,
    writeOpenDrive,
    openFile,
    saveFile,
    openFileByPath,
    getPlatformInfo: () => ({ type: 'web', version: '0.1.0' }),
    wgs84ToGcj02: vi.fn<PlatformService['wgs84ToGcj02']>().mockResolvedValue(makeCoord()),
    gcj02ToWgs84: vi.fn<PlatformService['gcj02ToWgs84']>().mockResolvedValue(makeCoord()),
    geoToUtm: vi.fn<PlatformService['geoToUtm']>().mockResolvedValue(makeUtm()),
    utmToGeo: vi.fn<PlatformService['utmToGeo']>().mockResolvedValue(makeCoord()),
    generateRoadVertices: vi.fn<PlatformService['generateRoadVertices']>().mockResolvedValue(new Float32Array()),
    generateSingleRoadVertices: vi.fn<PlatformService['generateSingleRoadVertices']>().mockResolvedValue(new Float32Array()),
    generateJunctionVertices: vi.fn<PlatformService['generateJunctionVertices']>().mockResolvedValue(new Float32Array()),
    generateLaneBoundaryVertices: vi.fn<PlatformService['generateLaneBoundaryVertices']>().mockResolvedValue(new Float32Array()),
    generateLaneLineVertices: vi.fn<PlatformService['generateLaneLineVertices']>().mockResolvedValue(new Float32Array()),
    generateCenterLineVertices: vi.fn<PlatformService['generateCenterLineVertices']>().mockResolvedValue(new Float32Array()),
    generateSignalPaintVertices: vi.fn<PlatformService['generateSignalPaintVertices']>().mockResolvedValue(new Float32Array()),
    generateSingleJunctionVertices: vi.fn<PlatformService['generateSingleJunctionVertices']>().mockResolvedValue(new Float32Array()),
    pickRoadAtPoint: vi.fn<PlatformService['pickRoadAtPoint']>().mockResolvedValue(null),
    pickJunctionAtPoint: vi.fn<PlatformService['pickJunctionAtPoint']>().mockResolvedValue(null),
    queryElevation: vi.fn<PlatformService['queryElevation']>().mockResolvedValue({ elevation: 0, grade: 0, grade_pct: 0 }),
    addElevationPoint: vi.fn<PlatformService['addElevationPoint']>().mockResolvedValue(makeProject()),
    deleteElevationPoint: vi.fn<PlatformService['deleteElevationPoint']>().mockResolvedValue(makeProject()),
    smoothElevation: vi.fn<PlatformService['smoothElevation']>().mockResolvedValue(makeProject()),
    snapPoint: vi.fn<PlatformService['snapPoint']>().mockResolvedValue({ x: 0, y: 0, snapped: false, snap_type: 'None', target_id: null, contact_point: null }),
    measureDistance: vi.fn<PlatformService['measureDistance']>().mockResolvedValue({ straight: 0, horizontal: 0, vertical: 0 }),
    measureAngle: vi.fn<PlatformService['measureAngle']>().mockResolvedValue({ radians: 0, degrees: 0 }),
    measureArea: vi.fn<PlatformService['measureArea']>().mockResolvedValue({ area: 0, perimeter: 0 }),
    measureRoadLength: vi.fn<PlatformService['measureRoadLength']>().mockResolvedValue(0),
    sampleLaneBoundary: vi.fn<PlatformService['sampleLaneBoundary']>().mockResolvedValue([]),
    getRoadTemplates: vi.fn<PlatformService['getRoadTemplates']>().mockResolvedValue([
      { id: 'single', name: 'Single Lane', left_lanes: 1, right_lanes: 1, lane_width: 3.5 },
    ]),
    createRoadFromSpline: vi.fn<PlatformService['createRoadFromSpline']>().mockResolvedValue(makeProject()),
    roadToSpline: vi.fn<PlatformService['roadToSpline']>().mockResolvedValue({ knots: [] }),
    moveSplineKnot: vi.fn<PlatformService['moveSplineKnot']>().mockResolvedValue({ knots: [] }),
    splineToGeometries: vi.fn<PlatformService['splineToGeometries']>().mockResolvedValue([]),
    generateObjectVertices: vi.fn<PlatformService['generateObjectVertices']>().mockResolvedValue(new Float32Array()),
    pickSignalAtPoint: vi.fn<PlatformService['pickSignalAtPoint']>().mockResolvedValue(null),
    pickObjectAtPoint: vi.fn<PlatformService['pickObjectAtPoint']>().mockResolvedValue(null),
    pickSignalAtPointCached: vi.fn<PlatformService['pickSignalAtPointCached']>().mockResolvedValue(null),
    pickObjectAtPointCached: vi.fn<PlatformService['pickObjectAtPointCached']>().mockResolvedValue(null),
    generateSingleSignalVertices: vi.fn<PlatformService['generateSingleSignalVertices']>().mockResolvedValue(new Float32Array()),
    generateSingleObjectVertices: vi.fn<PlatformService['generateSingleObjectVertices']>().mockResolvedValue(new Float32Array()),
    getSignalWorldPos: vi.fn<PlatformService['getSignalWorldPos']>().mockResolvedValue(null),
    getObjectWorldPos: vi.fn<PlatformService['getObjectWorldPos']>().mockResolvedValue(null),
    getSignalWorldPosCached: vi.fn<PlatformService['getSignalWorldPosCached']>().mockResolvedValue(null),
    getObjectWorldPosCached: vi.fn<PlatformService['getObjectWorldPosCached']>().mockResolvedValue(null),
    getLaneWorldPosCached: vi.fn<PlatformService['getLaneWorldPosCached']>().mockResolvedValue(null),
    getRoadEndpointTangent: vi.fn<PlatformService['getRoadEndpointTangent']>().mockResolvedValue(null),
    setProjectCache: vi.fn<PlatformService['setProjectCache']>().mockResolvedValue(undefined),
    invalidateProjectCache: vi.fn<PlatformService['invalidateProjectCache']>().mockResolvedValue(undefined),
    hasProjectCache: vi.fn<PlatformService['hasProjectCache']>().mockResolvedValue(true),
    pickRoadAtPointCached: vi.fn<PlatformService['pickRoadAtPointCached']>().mockResolvedValue(null),
    pickLaneAtPointCached: vi.fn<PlatformService['pickLaneAtPointCached']>().mockResolvedValue(null),
    pickJunctionAtPointCached: vi.fn<PlatformService['pickJunctionAtPointCached']>().mockResolvedValue(null),
    snapPointCached: vi.fn<PlatformService['snapPointCached']>().mockResolvedValue({ x: 0, y: 0, snapped: false, snap_type: 'None', target_id: null, contact_point: null }),
    snapPointOnRoad: vi.fn<PlatformService['snapPointOnRoad']>().mockResolvedValue({ s: 0, t: 0, hdg: 0 }),
  };

  return {
    platform,
    parseOpenDrive,
    writeOpenDrive,
    openFile,
    saveFile,
    openFileByPath,
  };
}

function dispatchWindowKey(init: KeyboardEventInit) {
  fireEvent.keyDown(window, { bubbles: true, cancelable: true, ...init });
}

describe('MenuBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(showAlert).mockResolvedValue(undefined);
    vi.mocked(showConfirm).mockResolvedValue(true);
    vi.mocked(showPrompt).mockResolvedValue('renamed.xodr');

    act(() => {
      useProjectStore.setState({
        project: makeProject(),
        isDirty: false,
        selectedRoadId: null,
        selectedObjectType: null,
        undoStack: [],
        redoStack: [],
      });
      // Reset recent files store between tests
      useRecentFilesStore.setState({ recentFiles: [] });
    });

    vi.mocked(getPlatformService).mockResolvedValue(createPlatformMock().platform);
  });

  it('renders all top-level menu labels', () => {
    render(<MenuBar />);

    const hamburger = screen.getByTitle('文件');
    fireEvent.click(hamburger);

    ['文件', '编辑', '视图', '工具', '插件', '帮助'].forEach((label) => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });

  it('opens, closes, and dismisses dropdown menus', () => {
    render(<MenuBar />);

    const hamburger = screen.getByTitle('文件');
    fireEvent.click(hamburger);
    fireEvent.click(screen.getByText('文件'));
    expect(screen.getByText('新建')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+N')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+Shift+S')).toBeInTheDocument();

    fireEvent.click(hamburger);
    expect(screen.queryByText('新建')).not.toBeInTheDocument();

    fireEvent.click(hamburger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('新建')).not.toBeInTheDocument();
  });

  it('shows disabled and enabled file actions based on project state', () => {
    const { rerender } = render(<MenuBar />);

    const hamburger = screen.getByTitle('文件');
    fireEvent.click(hamburger);
    fireEvent.click(screen.getByText('文件'));
    expect(screen.getByText('保存').closest('button')).toBeDisabled();

    fireEvent.mouseDown(document.body);
    fireEvent.click(hamburger);
    fireEvent.click(screen.getByText('文件'));
    fireEvent.click(screen.getByText('导出'));
    expect(screen.getByText('导出 OpenDRIVE...').closest('button')).toBeDisabled();

    act(() => {
      useProjectStore.setState({
        isDirty: true,
        project: makeProject([makeRoad('r-1', 12.5)]),
      });
    });

    rerender(<MenuBar />);
    fireEvent.mouseDown(document.body);
    fireEvent.click(hamburger);
    fireEvent.click(screen.getByText('文件'));
    expect(screen.getByText('保存').closest('button')).toBeEnabled();

    fireEvent.mouseDown(document.body);
    fireEvent.click(hamburger);
    fireEvent.click(screen.getByText('文件'));
    fireEvent.click(screen.getByText('导出'));
    expect(screen.getByText('导出 OpenDRIVE...').closest('button')).toBeEnabled();
  });

  it('calculates and shows the total road length from the current project', async () => {
    act(() => {
      useProjectStore.setState({
        project: makeProject([makeRoad('r-1', 100), makeRoad('r-2', 50.5)]),
      });
    });

    render(<MenuBar />);

    const hamburger = screen.getByTitle('文件');
    fireEvent.click(hamburger);
    fireEvent.click(screen.getByText('工具'));
    fireEvent.click(screen.getByText('计算道路总长度'));

    await waitFor(() => expect(vi.mocked(showAlert)).toHaveBeenCalledWith(
      expect.stringContaining('150.500'),
      expect.any(String),
    ));
  });

  it('shows about dialog and check-for-updates item in help menu', async () => {
    render(<MenuBar />);

    const hamburger = screen.getByTitle('文件');
    fireEvent.click(hamburger);
    fireEvent.click(screen.getByText('帮助'));

    expect(screen.queryByText('版本信息')).not.toBeInTheDocument();
    expect(screen.getByText('检查更新')).toBeInTheDocument();

    fireEvent.click(screen.getByText('关于 WorldEditor'));

    await waitFor(() => expect(vi.mocked(showAlert)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(showAlert)).toHaveBeenCalledWith(
      expect.stringContaining('1.8.0430'),
      expect.any(String),
    );
  });

  it('shows confirm dialog when exit is clicked with unsaved changes', async () => {
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {});

    act(() => {
      useProjectStore.setState({ isDirty: true });
    });

    render(<MenuBar />);
    const hamburger = screen.getByTitle('文件');
    fireEvent.click(hamburger);
    fireEvent.click(screen.getByText('文件'));
    fireEvent.click(screen.getByText('退出'));

    await waitFor(() => expect(vi.mocked(showConfirm)).toHaveBeenCalled());
    closeSpy.mockRestore();
  });

  it('renders a save-as quick-action button in the toolbar', () => {
    render(<MenuBar />);
    expect(screen.getByTitle(/另存为/)).toBeInTheDocument();
  });

  it('opens recent files directly by stored path', async () => {
    const platform = createPlatformMock();
    platform.openFileByPath.mockResolvedValue({ name: 'recent.xodr', content: '<OpenDRIVE />' });
    platform.parseOpenDrive.mockResolvedValue(makeProject([makeRoad('r-recent', 10)], 'Recent'));
    vi.mocked(getPlatformService).mockResolvedValue(platform.platform);
    act(() => {
      useRecentFilesStore.setState({
        recentFiles: [{ name: 'recent.xodr', path: 'C:\\maps\\recent.xodr', lastOpened: 0 }],
      });
    });

    render(<MenuBar />);
    fireEvent.click(screen.getByTitle('文件'));
    fireEvent.click(screen.getByText('文件'));
    fireEvent.click(screen.getByText('打开最近文件...'));
    fireEvent.click(screen.getByText('recent.xodr'));

    await waitFor(() => expect(platform.openFileByPath).toHaveBeenCalledWith('C:\\maps\\recent.xodr'));
    expect(useProjectStore.getState().project.name).toBe('recent.xodr');
  });

  it('removes missing recent files from storage', async () => {
    const platform = createPlatformMock();
    platform.openFileByPath.mockResolvedValue(null);
    vi.mocked(getPlatformService).mockResolvedValue(platform.platform);
    act(() => {
      useRecentFilesStore.setState({
        recentFiles: [{ name: 'missing.xodr', path: 'C:\\maps\\missing.xodr', lastOpened: 0 }],
      });
    });

    render(<MenuBar />);
    fireEvent.click(screen.getByTitle('文件'));
    fireEvent.click(screen.getByText('文件'));
    fireEvent.click(screen.getByText('打开最近文件...'));
    fireEvent.click(screen.getByText('missing.xodr'));

    await waitFor(() => expect(vi.mocked(showAlert)).toHaveBeenCalledWith('文件不存在: missing.xodr'));
    expect(useRecentFilesStore.getState().recentFiles).toEqual([]);
  });

  it('handles keyboard shortcuts for new, open, save, save as, and delete', async () => {
    const platform = createPlatformMock();
    platform.openFile.mockResolvedValue({ name: 'loaded.xodr', content: '<OpenDRIVE />' });
    platform.parseOpenDrive.mockResolvedValue(makeProject([makeRoad('imported', 30)], 'Imported'));
    vi.mocked(getPlatformService).mockResolvedValue(platform.platform);
    vi.mocked(showConfirm).mockResolvedValueOnce(false);

    act(() => {
      useProjectStore.setState({
        project: makeProject([makeRoad('r-1', 20)], 'Original'),
        isDirty: true,
        selectedRoadId: 'r-1',
      });
    });

    render(<MenuBar />);

    dispatchWindowKey({ key: 'n', ctrlKey: true });
    await act(async () => {});
    expect(useProjectStore.getState().project.name).toBe('Original');

    dispatchWindowKey({ key: 'n', ctrlKey: true });
    await act(async () => {});
    expect(useProjectStore.getState().project.name).toBe('Untitled');

    act(() => {
      useProjectStore.setState({
        project: makeProject([makeRoad('r-1', 20)], 'SaveTarget'),
        isDirty: true,
        selectedRoadId: 'r-1',
      });
    });

    dispatchWindowKey({ key: 'o', ctrlKey: true });
    await waitFor(() => expect(platform.openFile).toHaveBeenCalled());
    await waitFor(() => expect(platform.parseOpenDrive).toHaveBeenCalledWith('<OpenDRIVE />'));
    await waitFor(() => expect(useProjectStore.getState().project.name).toBe('loaded.xodr'));

    act(() => {
      useProjectStore.setState({ project: makeProject([makeRoad('r-1', 20)], 'SaveTarget'), isDirty: true });
    });

    vi.mocked(platform.saveFile).mockResolvedValueOnce('SaveTarget.xodr');
    dispatchWindowKey({ key: 's', ctrlKey: true });
    await waitFor(() => expect(platform.writeOpenDrive).toHaveBeenCalled());
    await waitFor(() => expect(platform.saveFile).toHaveBeenCalledWith('SaveTarget', '<OpenDRIVE />'));
    await waitFor(() => expect(useProjectStore.getState().isDirty).toBe(false));

    act(() => {
      useProjectStore.setState({ project: makeProject([], 'SaveTarget'), isDirty: true });
    });

    // For Save As, mock saveFile to return the chosen path (simulates native dialog accepting)
    vi.mocked(platform.saveFile).mockResolvedValueOnce('renamed.xodr');
    dispatchWindowKey({ key: 's', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(platform.saveFile).toHaveBeenCalledWith('SaveTarget', '<OpenDRIVE />'));
    await waitFor(() => expect(useProjectStore.getState().project.name).toBe('renamed.xodr'));

    act(() => {
      useProjectStore.setState({
        project: makeProject([makeRoad('delete-me', 15)]),
        selectedRoadId: 'delete-me',
      });
    });

    dispatchWindowKey({ key: 'Delete' });
    expect(useProjectStore.getState().project.roads).toHaveLength(0);
  });

  it('handles keyboard shortcuts for zoom actions by emitting viewport events', () => {
    const emitSpy = vi.mocked(emitViewportEvent);
    emitSpy.mockClear();

    act(() => {
      useProjectStore.setState({ selectedRoadId: 'r-zoom' });
    });

    render(<MenuBar />);

    dispatchWindowKey({ key: 'Home' });
    dispatchWindowKey({ key: 'f' });

    expect(emitSpy).toHaveBeenCalledWith({ type: 'zoom-to-fit' });
    expect(emitSpy).toHaveBeenCalledWith({ type: 'zoom-to-selected', roadId: 'r-zoom' });
  });

  it('shows an error alert and does not update the project when parseOpenDrive rejects', async () => {
    const platform = createPlatformMock();
    platform.openFile.mockResolvedValue({ name: 'bad.xodr', content: '<bad />' });
    platform.parseOpenDrive.mockRejectedValue(new Error('parse failed'));
    vi.mocked(getPlatformService).mockResolvedValue(platform.platform);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const originalProject = makeProject([makeRoad('original', 10)], 'Original');
    act(() => { useProjectStore.setState({ project: originalProject }); });

    render(<MenuBar />);
    fireEvent.click(screen.getByTitle('文件'));
    fireEvent.click(screen.getByText('文件'));
    fireEvent.click(screen.getByText('打开文件...'));

    await waitFor(() => expect(vi.mocked(showAlert)).toHaveBeenCalled());
    expect(useProjectStore.getState().project.name).toBe('Original');
  });

  it('shows a parse error alert when parseOpenDrive returns a non-Project value', async () => {
    const platform = createPlatformMock();
    platform.openFile.mockResolvedValue({ name: 'invalid.xodr', content: '<x/>' });
    platform.parseOpenDrive.mockResolvedValue(null as unknown as Project);
    vi.mocked(getPlatformService).mockResolvedValue(platform.platform);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const originalProject = makeProject([], 'OriginalProject');
    act(() => { useProjectStore.setState({ project: originalProject }); });

    render(<MenuBar />);
    dispatchWindowKey({ key: 'o', ctrlKey: true });

    await waitFor(() => expect(vi.mocked(showAlert)).toHaveBeenCalled());
    expect(useProjectStore.getState().project.name).toBe('OriginalProject');
  });

  describe('plugin importer/exporter menu items', () => {
    it('shows plugin importer item in Import menu when an importer is registered', async () => {
      const { usePluginContribStore } = await import('../../stores/pluginContribStore');
      const { act: reactAct } = await import('@testing-library/react');
      reactAct(() => {
        usePluginContribStore.getState().registerImporter({
          id: 'imp-test', pluginId: 'test-io', formatName: 'Lanelet2',
          extensions: ['.osm'], onImport: async () => makeProject(),
        });
      });

      render(<MenuBar />);
      fireEvent.click(screen.getByTitle('文件'));
      fireEvent.click(screen.getByText('文件'));
      fireEvent.click(screen.getByText('导入'));

      expect(screen.getByText('导入 Lanelet2...')).toBeInTheDocument();

      reactAct(() => {
        usePluginContribStore.getState().unregisterImporter('imp-test');
      });
    });

    it('shows plugin exporter item in Export menu when an exporter is registered', async () => {
      const { usePluginContribStore } = await import('../../stores/pluginContribStore');
      const { act: reactAct } = await import('@testing-library/react');
      const onExport = vi.fn().mockResolvedValue(undefined);
      reactAct(() => {
        usePluginContribStore.getState().registerExporter({
          id: 'exp-test', pluginId: 'test-io', formatName: 'Shapefile',
          onExport,
        });
      });

      render(<MenuBar />);
      fireEvent.click(screen.getByTitle('文件'));
      fireEvent.click(screen.getByText('文件'));
      fireEvent.click(screen.getByText('导出'));

      expect(screen.getByText('导出 Shapefile...')).toBeInTheDocument();

      reactAct(() => {
        usePluginContribStore.getState().unregisterExporter('exp-test');
      });
    });

    it('calls the exporter onExport handler when the export menu item is clicked', async () => {
      const { usePluginContribStore } = await import('../../stores/pluginContribStore');
      const { act: reactAct } = await import('@testing-library/react');
      const onExport = vi.fn().mockResolvedValue(undefined);
      reactAct(() => {
        usePluginContribStore.getState().registerExporter({
          id: 'exp-click', pluginId: 'test-io', formatName: 'DXF',
          onExport,
        });
      });

      render(<MenuBar />);
      fireEvent.click(screen.getByTitle('文件'));
      fireEvent.click(screen.getByText('文件'));
      fireEvent.click(screen.getByText('导出'));
      fireEvent.click(screen.getByText('导出 DXF...'));

      await waitFor(() => expect(onExport).toHaveBeenCalled());

      reactAct(() => {
        usePluginContribStore.getState().unregisterExporter('exp-click');
      });
    });
  });

  describe('AI Copilot button', () => {
    beforeEach(() => {
      act(() => {
        usePluginContribStore.setState({ panels: [], panelTabVisibility: {} });
        // Register the ai-copilot panel so the store has the panel
        usePluginContribStore.getState().registerPanel({
          id: 'ai-copilot:panel',
          pluginId: 'ai-copilot',
          title: 'AI Copilot',
          titleKey: 'copilot.title',
          component: () => null,
          position: 'right',
        });
      });
    });

    it('renders the AI Copilot (Sparkles) button in the quick-action bar', () => {
      render(<MenuBar />);
      expect(screen.getByTitle('AI 助手 (Ctrl+Alt+I)')).toBeInTheDocument();
    });

    it('toggles the AI Copilot panel when the button is clicked', () => {
      render(<MenuBar />);

      const btn = screen.getByTitle('AI 助手 (Ctrl+Alt+I)');
      expect(usePluginContribStore.getState().panelTabVisibility['ai-copilot:panel']).toBeFalsy();

      fireEvent.click(btn);
      expect(usePluginContribStore.getState().panelTabVisibility['ai-copilot:panel']).toBe(true);

      fireEvent.click(btn);
      expect(usePluginContribStore.getState().panelTabVisibility['ai-copilot:panel']).toBe(false);
    });

    it('toggles the AI Copilot panel with Ctrl+Alt+I shortcut', () => {
      render(<MenuBar />);

      expect(usePluginContribStore.getState().panelTabVisibility['ai-copilot:panel']).toBeFalsy();

      dispatchWindowKey({ key: 'i', ctrlKey: true, altKey: true });
      expect(usePluginContribStore.getState().panelTabVisibility['ai-copilot:panel']).toBe(true);

      dispatchWindowKey({ key: 'I', ctrlKey: true, altKey: true });
      expect(usePluginContribStore.getState().panelTabVisibility['ai-copilot:panel']).toBe(false);
    });
  });
});
