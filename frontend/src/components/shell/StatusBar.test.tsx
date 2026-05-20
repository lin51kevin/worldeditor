import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useProjectStore } from '../../stores/projectStore';
import { emitCursorMove } from '../../viewport/cursorEvents';
import { StatusBar } from './StatusBar';

describe('StatusBar', () => {
  beforeEach(() => {
    act(() => {
      useProjectStore.setState({
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
    act(() => { useProjectStore.setState({ isDirty: false }); });
    render(<StatusBar />);
    // Save state is no longer shown in StatusBar
    expect(screen.queryByText('已保存')).not.toBeInTheDocument();
  });

  it('shows modified status when dirty', () => {
    act(() => { useProjectStore.setState({ isDirty: true }); });
    render(<StatusBar />);
    // Save state is no longer shown in StatusBar
    expect(screen.queryByText('已修改')).not.toBeInTheDocument();
  });

  it('shows road count from project', () => {
    act(() => {
      const project = useProjectStore.getState().project;
      useProjectStore.setState({
        project: { ...project, roads: [{ id: 'r1', name: 'Test', length: 10, junction_id: null, link: { predecessor: null, successor: null }, plan_view: [], elevation_profile: [], lane_sections: [] }] },
      });
    });
    render(<StatusBar />);
    expect(screen.getByText(/道路:\s*1/)).toBeInTheDocument();
  });

  it('computes scale bar label dynamically from viewportMpp', () => {
    // mpp = 0.1 → rawDist = 100 * 0.1 = 10 → niceNumber(10) = 10 → label "10m"
    render(<StatusBar />);
    expect(screen.getByText('10m')).toBeInTheDocument();
  });

  it('shows km label when zoomed out', () => {
    // mpp = 20 → rawDist = 100 * 20 = 2000 → niceNumber(2000) = 2000 → label "2km"
    act(() => {
      useProjectStore.setState({ viewportMpp: 20.0 });
    });
    render(<StatusBar />);
    expect(screen.getByText('2km')).toBeInTheDocument();
  });

  it('shows smaller label when zoomed in', () => {
    // mpp = 0.01 → rawDist = 100 * 0.01 = 1 → niceNumber(1) = 1 → label "1m"
    act(() => {
      useProjectStore.setState({ viewportMpp: 0.01 });
    });
    render(<StatusBar />);
    expect(screen.getByText('1m')).toBeInTheDocument();
  });

  it('computes bar pixel width as niceDistance / mpp', () => {
    // mpp = 0.1, niceDistance = 10, barPx = 10 / 0.1 = 100
    const { container } = render(<StatusBar />);
    const bar = container.querySelector('.scale-bar-track') as HTMLElement;
    expect(parseInt(bar.style.width)).toBe(100);
  });
});
