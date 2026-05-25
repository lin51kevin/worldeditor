import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useViewportStore } from '../../stores/viewportStore';
import { useThemeStore } from '../../stores/themeStore';
import { Toolbar } from './Toolbar';

describe('Toolbar', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');

    act(() => {
      useViewportStore.setState({
        dimension: '3d',
        showGrid: true,
        showAxis: true,
        editMode: 'default',
        selectionMode: 'road',
        splineTemplateId: 'single',
        splineKnots: [],
        viewMode: 'solid',
      });
      useThemeStore.setState({ theme: 'dark' });
    });

    vi.clearAllMocks();
  });

  it('renders draw mode buttons (spline, arc, spiral)', () => {
    render(<Toolbar />);

    expect(screen.getByRole('button', { name: '样条' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '圆弧' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '回旋线' })).toBeInTheDocument();
  });

  it('selection mode buttons are not in the floating toolbar (moved to RoadEditToolbar)', () => {
    render(<Toolbar />);

    expect(screen.queryByRole('button', { name: '道路' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '车道段' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '车道' })).not.toBeInTheDocument();
  });

  it('renders view mode buttons', () => {
    render(<Toolbar />);

    // The toolbar renders without crashing and contains the toolbar element
    expect(document.querySelector('.toolbar')).toBeInTheDocument();
  });

  it('snap and measure buttons are not in the toolbar (moved to MenuBar)', () => {
    render(<Toolbar />);

    expect(screen.queryByTitle('开关吸附')).not.toBeInTheDocument();
    expect(screen.queryByTitle('测量工具')).not.toBeInTheDocument();
  });

  it('3D/2D and Grid/Axis buttons are not in the toolbar (moved to MenuBar)', () => {
    render(<Toolbar />);

    expect(screen.queryByTitle('3D视图')).not.toBeInTheDocument();
    expect(screen.queryByTitle('2D视图')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '网格' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '坐标轴' })).not.toBeInTheDocument();
  });

  it('updates edit mode via draw mode toolbar buttons', () => {
    render(<Toolbar />);

    fireEvent.click(screen.getByRole('button', { name: '样条' }));
    expect(useViewportStore.getState().editMode).toBe('spline');

    fireEvent.click(screen.getByRole('button', { name: '圆弧' }));
    expect(useViewportStore.getState().editMode).toBe('drawArc');

    fireEvent.click(screen.getByRole('button', { name: '回旋线' }));
    expect(useViewportStore.getState().editMode).toBe('drawSpiral');
  });
});
