import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useViewportStore } from '../../stores/viewportStore';
import { useThemeStore } from '../../stores/themeStore';
import { useProjectStore } from '../../stores/projectStore';
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
      useProjectStore.setState({ selectedRoadId: 'road-1' });
    });

    vi.clearAllMocks();
  });

  it('renders draw mode buttons (spline, arc, spiral)', () => {
    render(<Toolbar />);

    expect(screen.getByRole('button', { name: '样条' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '圆弧' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '回旋线' })).toBeInTheDocument();
  });

  it('renders move and rotate buttons', () => {
    render(<Toolbar />);

    expect(screen.getByTitle('移动道路')).toBeInTheDocument();
    expect(screen.getByTitle('旋转道路')).toBeInTheDocument();
  });

  it('move/rotate buttons are disabled when no road is selected', () => {
    act(() => { useProjectStore.setState({ selectedRoadId: null }); });
    render(<Toolbar />);

    expect(screen.getByTitle('移动道路')).toBeDisabled();
    expect(screen.getByTitle('旋转道路')).toBeDisabled();
  });

  it('clicking move button sets editMode to move-road', () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByTitle('移动道路'));
    expect(useViewportStore.getState().editMode).toBe('move-road');
  });

  it('clicking rotate button sets editMode to rotate-road', () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByTitle('旋转道路'));
    expect(useViewportStore.getState().editMode).toBe('rotate-road');
  });

  it('view mode buttons are not in the floating toolbar (moved to MenuBar)', () => {
    render(<Toolbar />);

    expect(screen.queryByTitle('Sketch (outline only)')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Wireframe (lane lines only)')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Solid (filled mesh)')).not.toBeInTheDocument();
  });

  it('selection mode buttons are not in the floating toolbar (moved to MenuBar)', () => {
    render(<Toolbar />);

    expect(screen.queryByRole('button', { name: '道路' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '车道段' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '车道' })).not.toBeInTheDocument();
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
