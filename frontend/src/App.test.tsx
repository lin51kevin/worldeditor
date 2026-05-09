import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import type { Project } from './services/platform';
import { useEditorStore } from './stores/editorStore';

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
  };
}

describe('App', () => {
  beforeEach(() => {
    act(() => {
      useEditorStore.setState({
        project: makeProject('Current'),
        isDirty: false,
        selectedRoadId: null,
        selectedObjectType: null,
        undoStack: [],
        redoStack: [],
      });
    });
  });

  it('should render the application shell', () => {
    render(<App />);
    expect(screen.getByText('文件')).toBeDefined();
    expect(screen.getByText('新建')).toBeDefined();
    expect(screen.getByText('打开...')).toBeDefined();
    expect(screen.getByText('保存...')).toBeDefined();
    expect(screen.getByText('导航器')).toBeDefined();
    // PropertyPanel (属性) only visible when a road is selected (Quick Inspector)
    expect(screen.getByText('模板')).toBeDefined();
    expect(screen.getByText(/3D 视口/)).toBeDefined();
  });

  it('handles undo and redo keyboard shortcuts', () => {
    act(() => {
      useEditorStore.setState({
        project: makeProject('Current'),
        undoStack: [makeProject('Previous')],
        redoStack: [],
      });
    });

    render(<App />);

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(useEditorStore.getState().project.name).toBe('Previous');

    fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
    expect(useEditorStore.getState().project.name).toBe('Current');
  });
});
