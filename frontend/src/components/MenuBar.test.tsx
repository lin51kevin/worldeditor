import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GisCoord, PlatformService, Project, Road, UtmCoord } from '../services/platform';
import { useEditorStore } from '../stores/editorStore';
import { getPlatformService } from '../services';
import { emitViewportEvent } from '../viewport/viewportEvents';
import { MenuBar } from './MenuBar';

vi.mock('../services', () => ({
  getPlatformService: vi.fn(),
}));

vi.mock('../viewport/viewportEvents', () => ({
  emitViewportEvent: vi.fn(),
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
  const saveFile = vi.fn<PlatformService['saveFile']>().mockResolvedValue(undefined);

  const platform: PlatformService = {
    parseOpenDrive,
    writeOpenDrive,
    openFile,
    saveFile,
    getPlatformInfo: () => ({ type: 'web', version: '0.1.0' }),
    wgs84ToGcj02: vi.fn<PlatformService['wgs84ToGcj02']>().mockResolvedValue(makeCoord()),
    gcj02ToWgs84: vi.fn<PlatformService['gcj02ToWgs84']>().mockResolvedValue(makeCoord()),
    geoToUtm: vi.fn<PlatformService['geoToUtm']>().mockResolvedValue(makeUtm()),
    utmToGeo: vi.fn<PlatformService['utmToGeo']>().mockResolvedValue(makeCoord()),
    generateRoadVertices: vi.fn<PlatformService['generateRoadVertices']>().mockResolvedValue(new Float32Array()),
    generateSingleRoadVertices: vi.fn<PlatformService['generateSingleRoadVertices']>().mockResolvedValue(new Float32Array()),
    pickRoadAtPoint: vi.fn<PlatformService['pickRoadAtPoint']>().mockResolvedValue(null),
  };

  return {
    platform,
    parseOpenDrive,
    writeOpenDrive,
    openFile,
    saveFile,
  };
}

function dispatchWindowKey(init: KeyboardEventInit) {
  fireEvent.keyDown(window, { bubbles: true, cancelable: true, ...init });
}

describe('MenuBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('alert', vi.fn());
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('prompt', vi.fn(() => 'renamed.xodr'));

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

    vi.mocked(getPlatformService).mockResolvedValue(createPlatformMock().platform);
  });

  it('renders all top-level menu labels', () => {
    render(<MenuBar />);

    ['文件', '编辑', '视图', '工具', '关于'].forEach((label) => {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    });
  });

  it('opens, closes, and dismisses dropdown menus', () => {
    render(<MenuBar />);

    const fileMenu = screen.getByRole('button', { name: '文件' });
    fireEvent.click(fileMenu);
    expect(screen.getByText('新建项目')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+N')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+Shift+S')).toBeInTheDocument();

    fireEvent.click(fileMenu);
    expect(screen.queryByText('新建项目')).not.toBeInTheDocument();

    fireEvent.click(fileMenu);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('新建项目')).not.toBeInTheDocument();
  });

  it('shows disabled and enabled file actions based on project state', () => {
    const { rerender } = render(<MenuBar />);

    fireEvent.click(screen.getByRole('button', { name: '文件' }));
    expect(screen.getByText('保存').closest('button')).toBeDisabled();
    expect(screen.getByText('导出 OpenDRIVE...').closest('button')).toBeDisabled();

    act(() => {
      useEditorStore.setState({
        isDirty: true,
        project: makeProject([makeRoad('r-1', 12.5)]),
      });
    });

    rerender(<MenuBar />);
    fireEvent.mouseDown(document.body);
    fireEvent.click(screen.getByRole('button', { name: '文件' }));
    expect(screen.getByText('保存').closest('button')).toBeEnabled();
    expect(screen.getByText('导出 OpenDRIVE...').closest('button')).toBeEnabled();
  });

  it('calculates and shows the total road length from the current project', () => {
    const alertSpy = vi.mocked(window.alert);

    act(() => {
      useEditorStore.setState({
        project: makeProject([makeRoad('r-1', 100), makeRoad('r-2', 50.5)]),
      });
    });

    render(<MenuBar />);

    fireEvent.click(screen.getByRole('button', { name: '工具' }));
    fireEvent.click(screen.getByText('计算道路总长度'));

    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('150.500'));
  });

  it('shows about and version dialogs from the about menu', () => {
    const alertSpy = vi.mocked(window.alert);
    render(<MenuBar />);

    fireEvent.click(screen.getByRole('button', { name: '关于' }));
    fireEvent.click(screen.getByText('关于 WorldEditor'));
    fireEvent.click(screen.getByRole('button', { name: '关于' }));
    fireEvent.click(screen.getByText('版本信息'));

    expect(alertSpy).toHaveBeenNthCalledWith(1, expect.stringContaining('1.8.0430'));
    expect(alertSpy).toHaveBeenNthCalledWith(2, expect.stringContaining('2024-12-12'));
  });

  it('handles keyboard shortcuts for new, open, save, save as, and delete', async () => {
    const platform = createPlatformMock();
    platform.openFile.mockResolvedValue({ name: 'loaded.xodr', content: '<OpenDRIVE />' });
    platform.parseOpenDrive.mockResolvedValue(makeProject([makeRoad('imported', 30)], 'Imported'));
    vi.mocked(getPlatformService).mockResolvedValue(platform.platform);
    vi.mocked(window.confirm).mockReturnValue(false);

    act(() => {
      useEditorStore.setState({
        project: makeProject([makeRoad('r-1', 20)], 'Original'),
        isDirty: true,
        selectedRoadId: 'r-1',
      });
    });

    render(<MenuBar />);

    dispatchWindowKey({ key: 'n', ctrlKey: true });
    expect(useEditorStore.getState().project.name).toBe('Original');

    vi.mocked(window.confirm).mockReturnValue(true);
    dispatchWindowKey({ key: 'n', ctrlKey: true });
    expect(useEditorStore.getState().project.name).toBe('Untitled');

    act(() => {
      useEditorStore.setState({
        project: makeProject([makeRoad('r-1', 20)], 'SaveTarget'),
        isDirty: true,
        selectedRoadId: 'r-1',
      });
    });

    dispatchWindowKey({ key: 'o', ctrlKey: true });
    await waitFor(() => expect(platform.openFile).toHaveBeenCalled());
    await waitFor(() => expect(platform.parseOpenDrive).toHaveBeenCalledWith('<OpenDRIVE />'));
    await waitFor(() => expect(useEditorStore.getState().project.name).toBe('loaded.xodr'));

    act(() => {
      useEditorStore.setState({ project: makeProject([makeRoad('r-1', 20)], 'SaveTarget'), isDirty: true });
    });

    dispatchWindowKey({ key: 's', ctrlKey: true });
    await waitFor(() => expect(platform.writeOpenDrive).toHaveBeenCalled());
    await waitFor(() => expect(platform.saveFile).toHaveBeenCalledWith('SaveTarget', '<OpenDRIVE />'));
    await waitFor(() => expect(useEditorStore.getState().isDirty).toBe(false));

    act(() => {
      useEditorStore.setState({ project: makeProject([], 'SaveTarget'), isDirty: true });
    });

    dispatchWindowKey({ key: 's', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(platform.saveFile).toHaveBeenCalledWith('renamed.xodr', '<OpenDRIVE />'));
    await waitFor(() => expect(useEditorStore.getState().project.name).toBe('renamed.xodr'));

    act(() => {
      useEditorStore.setState({
        project: makeProject([makeRoad('delete-me', 15)]),
        selectedRoadId: 'delete-me',
      });
    });

    dispatchWindowKey({ key: 'Delete' });
    expect(useEditorStore.getState().project.roads).toHaveLength(0);
  });

  it('handles keyboard shortcuts for zoom actions by emitting viewport events', () => {
    const emitSpy = vi.mocked(emitViewportEvent);
    emitSpy.mockClear();

    act(() => {
      useEditorStore.setState({ selectedRoadId: 'r-zoom' });
    });

    render(<MenuBar />);

    dispatchWindowKey({ key: 'Home' });
    dispatchWindowKey({ key: 'f' });

    expect(emitSpy).toHaveBeenCalledWith({ type: 'zoom-to-fit' });
    expect(emitSpy).toHaveBeenCalledWith({ type: 'zoom-to-selected', roadId: 'r-zoom' });
  });

  it('shows an error alert and does not update the project when parseOpenDrive rejects', async () => {
    const alertSpy = vi.mocked(window.alert);
    const platform = createPlatformMock();
    platform.openFile.mockResolvedValue({ name: 'bad.xodr', content: '<bad />' });
    platform.parseOpenDrive.mockRejectedValue(new Error('parse failed'));
    vi.mocked(getPlatformService).mockResolvedValue(platform.platform);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const originalProject = makeProject([makeRoad('original', 10)], 'Original');
    act(() => { useEditorStore.setState({ project: originalProject }); });

    render(<MenuBar />);
    fireEvent.click(screen.getByRole('button', { name: '文件' }));
    fireEvent.click(screen.getByText('打开文件...'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(useEditorStore.getState().project.name).toBe('Original');
  });

  it('shows a parse error alert when parseOpenDrive returns a non-Project value', async () => {
    const alertSpy = vi.mocked(window.alert);
    const platform = createPlatformMock();
    platform.openFile.mockResolvedValue({ name: 'invalid.xodr', content: '<x/>' });
    platform.parseOpenDrive.mockResolvedValue(null as unknown as Project);
    vi.mocked(getPlatformService).mockResolvedValue(platform.platform);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const originalProject = makeProject([], 'OriginalProject');
    act(() => { useEditorStore.setState({ project: originalProject }); });

    render(<MenuBar />);
    dispatchWindowKey({ key: 'o', ctrlKey: true });

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(useEditorStore.getState().project.name).toBe('OriginalProject');
  });
});
