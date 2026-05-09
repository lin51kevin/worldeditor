import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GisCoord, PlatformService, Project, Road, UtmCoord } from '../services/platform';
import { getPlatformService } from '../services';
import { useEditorStore } from '../stores/editorStore';
import { useEditorViewStore } from '../stores/editorViewStore';
import { useThemeStore } from '../stores/themeStore';
import { Toolbar } from './Toolbar';

vi.mock('../services', () => ({
  getPlatformService: vi.fn(),
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

function makeRoad(id: string, length = 20): Road {
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
    generateJunctionVertices: vi.fn<PlatformService['generateJunctionVertices']>().mockResolvedValue(new Float32Array()),
    generateLaneLineVertices: vi.fn<PlatformService['generateLaneLineVertices']>().mockResolvedValue(new Float32Array()),
    generateCenterLineVertices: vi.fn<PlatformService['generateCenterLineVertices']>().mockResolvedValue(new Float32Array()),
    generateSignalPaintVertices: vi.fn<PlatformService['generateSignalPaintVertices']>().mockResolvedValue(new Float32Array()),
    pickRoadAtPoint: vi.fn<PlatformService['pickRoadAtPoint']>().mockResolvedValue(null),
  };

  return { platform, parseOpenDrive, writeOpenDrive, openFile, saveFile };
}

describe('Toolbar', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');

    act(() => {
      useEditorStore.setState({
        project: makeProject(),
        isDirty: false,
        selectedRoadId: null,
        selectedObjectType: null,
        undoStack: [],
        redoStack: [],
      });
      useEditorViewStore.setState({
        dimension: '3d',
        showGrid: true,
        showAxis: true,
        editMode: 'select',
        viewMode: 'solid',
      });
      useThemeStore.setState({ theme: 'dark' });
    });

    vi.clearAllMocks();
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.mocked(getPlatformService).mockResolvedValue(createPlatformMock().platform);
  });

  it('renders toolbar with buttons', () => {
    render(<Toolbar />);

    expect(screen.getByRole('button', { name: '新建' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开...' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存...' })).toBeInTheDocument();
  });

  it('disables undo button when there is nothing to undo', () => {
    render(<Toolbar />);

    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled();
  });

  it('disables redo button when there is nothing to redo', () => {
    render(<Toolbar />);

    expect(screen.getByRole('button', { name: '重做' })).toBeDisabled();
  });

  it('renders edit mode buttons', () => {
    render(<Toolbar />);

    ['默认', '道路', '车道', '路口'].forEach((label) => {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    });
  });

  it('renders view mode buttons', () => {
    render(<Toolbar />);

    ['草图', '线图', '实装'].forEach((label) => {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    });
  });

  it('renders dimension toggle buttons', () => {
    render(<Toolbar />);

    expect(screen.getByTitle('3D视图')).toBeInTheDocument();
    expect(screen.getByTitle('2D视图')).toBeInTheDocument();
  });

  it('renders grid and axis toggles', () => {
    render(<Toolbar />);

    expect(screen.getByRole('button', { name: '网格' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '坐标轴' })).toBeInTheDocument();
  });

  it('handles file actions from the toolbar', async () => {
    const platform = createPlatformMock();
    platform.openFile.mockResolvedValue({ name: 'loaded.xodr', content: '<OpenDRIVE />' });
    platform.parseOpenDrive.mockResolvedValue(makeProject([makeRoad('imported')], 'Imported'));
    vi.mocked(getPlatformService).mockResolvedValue(platform.platform);
    vi.mocked(window.confirm).mockReturnValue(false);

    act(() => {
      useEditorStore.setState({
        project: makeProject([makeRoad('r-1')], 'Dirty'),
        isDirty: true,
        selectedRoadId: 'r-1',
      });
    });

    render(<Toolbar />);

    fireEvent.click(screen.getByRole('button', { name: '新建' }));
    expect(useEditorStore.getState().project.name).toBe('Dirty');

    vi.mocked(window.confirm).mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: '新建' }));
    expect(useEditorStore.getState().project.name).toBe('Untitled');

    act(() => {
      useEditorStore.setState({
        project: makeProject([makeRoad('r-1')], 'SaveTarget'),
        isDirty: true,
        selectedRoadId: 'r-1',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: '打开...' }));
    await waitFor(() => expect(platform.openFile).toHaveBeenCalled());
    await waitFor(() => expect(platform.parseOpenDrive).toHaveBeenCalledWith('<OpenDRIVE />'));
    await waitFor(() => expect(useEditorStore.getState().project.name).toBe('loaded.xodr'));

    act(() => {
      useEditorStore.setState({
        project: makeProject([makeRoad('r-1')], 'SaveTarget'),
        isDirty: true,
        selectedRoadId: 'r-1',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: '保存...' }));
    await waitFor(() => expect(platform.writeOpenDrive).toHaveBeenCalled());
    await waitFor(() => expect(platform.saveFile).toHaveBeenCalledWith('SaveTarget', '<OpenDRIVE />'));
    await waitFor(() => expect(useEditorStore.getState().isDirty).toBe(false));

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(useEditorStore.getState().project.roads).toHaveLength(0);
  });

  it('handles undo and redo actions', () => {
    act(() => {
      useEditorStore.setState({
        project: makeProject([], 'Current'),
        undoStack: [makeProject([], 'Previous')],
        redoStack: [],
      });
    });

    render(<Toolbar />);

    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(useEditorStore.getState().project.name).toBe('Previous');

    fireEvent.click(screen.getByRole('button', { name: '重做' }));
    expect(useEditorStore.getState().project.name).toBe('Current');
  });

  it('updates edit, view, dimension, and visibility controls', () => {
    render(<Toolbar />);

    fireEvent.click(screen.getByRole('button', { name: '道路' }));
    fireEvent.click(screen.getByRole('button', { name: '车道' }));
    fireEvent.click(screen.getByRole('button', { name: '路口' }));
    fireEvent.click(screen.getByRole('button', { name: '草图' }));
    fireEvent.click(screen.getByRole('button', { name: '线图' }));
    fireEvent.click(screen.getByTitle('2D视图'));
    fireEvent.click(screen.getByRole('button', { name: '网格' }));
    fireEvent.click(screen.getByRole('button', { name: '坐标轴' }));

    expect(useEditorViewStore.getState().editMode).toBe('junction');
    expect(useEditorViewStore.getState().viewMode).toBe('wire');
    expect(useEditorViewStore.getState().dimension).toBe('2d');
    expect(useEditorViewStore.getState().showGrid).toBe(false);
    expect(useEditorViewStore.getState().showAxis).toBe(false);
  });

  // Theme toggle has been moved to MenuBar — tested in MenuBar.test.tsx

  it('shows an error alert and does not update the project when parseOpenDrive rejects', async () => {
    vi.stubGlobal('alert', vi.fn());
    const alertSpy = vi.mocked(window.alert);
    const platform = createPlatformMock();
    platform.openFile.mockResolvedValue({ name: 'bad.xodr', content: '<bad />' });
    platform.parseOpenDrive.mockRejectedValue(new Error('parse failed'));
    vi.mocked(getPlatformService).mockResolvedValue(platform.platform);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const originalProject = makeProject([makeRoad('original')], 'Original');
    act(() => { useEditorStore.setState({ project: originalProject }); });

    render(<Toolbar />);
    fireEvent.click(screen.getByRole('button', { name: '打开...' }));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(useEditorStore.getState().project.name).toBe('Original');
  });

  it('shows a parse error alert when parseOpenDrive returns a non-Project value', async () => {
    vi.stubGlobal('alert', vi.fn());
    const alertSpy = vi.mocked(window.alert);
    const platform = createPlatformMock();
    platform.openFile.mockResolvedValue({ name: 'invalid.xodr', content: '<x/>' });
    platform.parseOpenDrive.mockResolvedValue(null as unknown as Project);
    vi.mocked(getPlatformService).mockResolvedValue(platform.platform);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const originalProject = makeProject([], 'OriginalProject');
    act(() => { useEditorStore.setState({ project: originalProject }); });

    render(<Toolbar />);
    fireEvent.click(screen.getByRole('button', { name: '打开...' }));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(useEditorStore.getState().project.name).toBe('OriginalProject');
  });
});
