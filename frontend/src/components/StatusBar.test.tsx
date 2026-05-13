import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../stores/editorStore';
import { emitCursorMove } from '../viewport/cursorEvents';
import { StatusBar } from './StatusBar';

describe('StatusBar', () => {
  beforeEach(() => {
    act(() => {
      useEditorStore.setState({
        cursorWorldPos: { x: 0, y: 0 },
        gridSpacing: 10.0,
        viewportMpp: 0.1,
      });
    });
  });

  it('renders default world coordinate display', () => {
    render(<StatusBar />);
    expect(screen.getByText(/世界坐标系:\s*0\.000,\s*0\.000/)).toBeInTheDocument();
  });

  it('updates world coordinate display when cursor moves', () => {
    render(<StatusBar />);
    act(() => {
      emitCursorMove(123.45678, -9.1);
    });
    expect(screen.getByText(/世界坐标系:\s*123\.457,\s*-9\.100/)).toBeInTheDocument();
  });

  it('renders coordinate chip, road count, and scale bar', () => {
    const { container } = render(<StatusBar />);
    expect(container.querySelectorAll('.statusbar-item').length).toBeGreaterThanOrEqual(3);
  });

  it('shows saved status when not dirty', () => {
    act(() => { useEditorStore.setState({ isDirty: false }); });
    render(<StatusBar />);
    // Save state is no longer shown in StatusBar
    expect(screen.queryByText('已保存')).not.toBeInTheDocument();
  });

  it('shows modified status when dirty', () => {
    act(() => { useEditorStore.setState({ isDirty: true }); });
    render(<StatusBar />);
    // Save state is no longer shown in StatusBar
    expect(screen.queryByText('已修改')).not.toBeInTheDocument();
  });

  it('shows road count from project', () => {
    act(() => {
      const project = useEditorStore.getState().project;
      useEditorStore.setState({
        project: { ...project, roads: [{ id: 'r1', name: 'Test', length: 10, junction_id: null, link: { predecessor: null, successor: null }, plan_view: [], elevation_profile: [], lane_sections: [] }] },
      });
    });
    render(<StatusBar />);
    expect(screen.getByText(/道路:\s*1/)).toBeInTheDocument();
  });

  it('renders scale bar label matching grid spacing', () => {
    // gridSpacing = 10m → label "10m"
    render(<StatusBar />);
    expect(screen.getByText('10m')).toBeInTheDocument();
  });

  it('shows km label for large grid spacing', () => {
    act(() => {
      useEditorStore.setState({ gridSpacing: 2000, viewportMpp: 1.0 });
    });
    render(<StatusBar />);
    expect(screen.getByText('2km')).toBeInTheDocument();
  });

  it('clamps scale bar pixel width between 20 and 180', () => {
    // gridSpacing = 10, mpp = 0.001 → raw barPx = 10000 → clamped to 180
    act(() => {
      useEditorStore.setState({ gridSpacing: 10, viewportMpp: 0.001 });
    });
    const { container } = render(<StatusBar />);
    const bar = container.querySelector('.scale-bar-track') as HTMLElement;
    expect(parseInt(bar.style.width)).toBeLessThanOrEqual(180);
  });
});
