import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Project, Road } from '../services/platform';
import { useEditorStore } from '../stores/editorStore';
import { StatusBar } from './StatusBar';

function makeProject(roads: Road[] = []): Project {
  return {
    name: 'Untitled',
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

function makeRoad(id: string, name = `Road ${id}`): Road {
  return {
    id,
    name,
    length: 100,
    junction_id: null,
    link: { predecessor: null, successor: null },
    plan_view: [],
    elevation_profile: [],
    lane_sections: [],
  };
}

describe('StatusBar', () => {
  beforeEach(() => {
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

  it('renders road and junction counts', () => {
    render(<StatusBar />);

    expect(screen.getByText(/道路:\s*0\s*\|\s*路口:\s*0/)).toBeInTheDocument();
  });

  it('shows saved state when project is clean', () => {
    render(<StatusBar />);

    expect(screen.getByText('已保存')).toBeInTheDocument();
  });

  it('shows modified state when project is dirty', () => {
    act(() => {
      useEditorStore.setState({ isDirty: true });
    });

    render(<StatusBar />);

    expect(screen.getByText('已修改')).toBeInTheDocument();
  });

  it('updates road count when roads are added', () => {
    render(<StatusBar />);

    act(() => {
      useEditorStore.setState({ project: makeProject([makeRoad('r-1')]) });
    });

    expect(screen.getByText(/道路:\s*1\s*\|\s*路口:\s*0/)).toBeInTheDocument();
  });

  it('contains coordinate display', () => {
    render(<StatusBar />);

    expect(screen.getByText(/世界坐标系:\s*0\.000,\s*0\.000/)).toBeInTheDocument();
  });
});
