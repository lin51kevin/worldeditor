import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { Project, Road } from './services/platform';
import { useProjectStore } from './stores/projectStore';
import { usePluginContribStore } from './stores/pluginContribStore';
import { onViewportEvent } from './viewport/viewportEvents';
import { showConfirm } from './utils/dialog';

vi.mock('./components/dialogs/PluginManager', () => ({
  PluginManager: () => null,
}));

const mockAutosave = vi.hoisted(() => ({
  loadDraft: vi.fn(() => null as { project: Project; savedAt: string } | null),
  clearDraft: vi.fn(),
}));

vi.mock('./utils/autosave', () => mockAutosave);

vi.mock('./utils/dialog', () => ({
  showAlert: vi.fn().mockResolvedValue(undefined),
  showConfirm: vi.fn().mockResolvedValue(false),
  showPrompt: vi.fn().mockResolvedValue(null),
}));

function makeProject(name: string): Project {
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
    roads: [],
    junctions: [],
    signals: [],
    objects: []
  };
}

function makeRoad(id: string): Road {
  return {
    id,
    name: id,
    length: 100,
    junction_id: null,
    link: { predecessor: null, successor: null },
    plan_view: [],
    lane_sections: [],
    elevation_profile: [],
  };
}

describe('App', () => {
  beforeEach(() => {
    // jsdom doesn't implement scrollIntoView; mock it
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(mockAutosave.loadDraft).mockReturnValue(null);
    vi.mocked(mockAutosave.clearDraft).mockClear();
    vi.mocked(showConfirm).mockReset().mockResolvedValue(false);
    act(() => {
      useProjectStore.setState({
        project: makeProject('Current'),
        isDirty: false,
        selectedRoadId: null,
        selectedRoadIds: [],
        selectedJunctionIds: [],
        selectedObjectType: null,
        undoStack: [],
        redoStack: [],
      });
      // Clear plugin contrib store so road-tools Ctrl+D handler doesn't fire
      usePluginContribStore.setState({
        toolbarButtons: [],
        menuItems: [],
        templateSections: [],
        importers: [],
        exporters: [],
        panels: [],
        contextMenuItems: [],
        viewportOverlays: [],
        settingsContribs: [],
        panelTabVisibility: {},
        activeTabId: null,
      });
    });
  });

  it('should render the application shell', () => {
    render(<App />);
    expect(screen.getByText('导航器')).toBeDefined();
    // PropertyPanel (属性) only visible when a road is selected (Quick Inspector)
    expect(screen.getByText('模板')).toBeDefined();
    expect(screen.getByText(/3D 视口/)).toBeDefined();
  });

  it('handles undo and redo keyboard shortcuts', () => {
    act(() => {
      useProjectStore.setState({
        project: makeProject('Current'),
        undoStack: [makeProject('Previous')],
        redoStack: [],
      });
    });

    render(<App />);

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(useProjectStore.getState().project.name).toBe('Previous');

    fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
    expect(useProjectStore.getState().project.name).toBe('Current');
  });

  it('should select all roads and junctions on Ctrl+A', () => {
    act(() => {
      useProjectStore.setState({
        project: {
          ...makeProject('Test'),
          roads: [makeRoad('r1'), makeRoad('r2')],
          junctions: [],
    signals: [],
    objects: []
        },
      });
    });
    render(<App />);
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    expect(useProjectStore.getState().selectedRoadIds).toEqual(['r1', 'r2']);
  });

  it('should duplicate selected road on Ctrl+D', () => {
    act(() => {
      useProjectStore.setState({
        project: { ...makeProject('Test'), roads: [makeRoad('r1')], junctions: [] },
        selectedRoadId: 'r1',
      });
    });
    render(<App />);
    fireEvent.keyDown(window, { key: 'd', ctrlKey: true });
    expect(useProjectStore.getState().project.roads).toHaveLength(2);
  });

  it('should emit zoom-to-fit event on Home key', () => {
    const spy = vi.fn();
    const unsub = onViewportEvent(spy);
    render(<App />);
    fireEvent.keyDown(window, { key: 'Home' });
    unsub();
    expect(spy).toHaveBeenCalledWith({ type: 'zoom-to-fit' });
  });

  it('should show shortcut help overlay when ? is pressed', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: '?' });
    expect(document.querySelector('.shortcut-help-overlay')).not.toBeNull();
  });

  it('should show shortcut help overlay when / is pressed', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: '/' });
    expect(document.querySelector('.shortcut-help-overlay')).not.toBeNull();
  });

  it('should hide shortcut help overlay when Escape is pressed', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: '?' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.querySelector('.shortcut-help-overlay')).toBeNull();
  });

  it('does nothing on startup when there is no autosave draft', () => {
    render(<App />);
    expect(showConfirm).not.toHaveBeenCalled();
  });

  it('prompts to restore an autosave draft and applies it when confirmed', async () => {
    const draftProject = makeProject('RecoveredProject');
    mockAutosave.loadDraft.mockReturnValue({ project: draftProject, savedAt: '2026-01-01T00:00:00.000Z' });
    vi.mocked(showConfirm).mockResolvedValue(true);

    render(<App />);

    await waitFor(() => expect(showConfirm).toHaveBeenCalled());
    await waitFor(() => expect(useProjectStore.getState().project.name).toBe('RecoveredProject'));
    expect(useProjectStore.getState().isDirty).toBe(true);
    expect(mockAutosave.clearDraft).toHaveBeenCalled();
  });

  it('discards the autosave draft when the user declines to restore it', async () => {
    const draftProject = makeProject('RecoveredProject');
    mockAutosave.loadDraft.mockReturnValue({ project: draftProject, savedAt: '2026-01-01T00:00:00.000Z' });
    vi.mocked(showConfirm).mockResolvedValue(false);

    render(<App />);

    await waitFor(() => expect(showConfirm).toHaveBeenCalled());
    await waitFor(() => expect(mockAutosave.clearDraft).toHaveBeenCalled());
    expect(useProjectStore.getState().project.name).toBe('Current');
  });
});
