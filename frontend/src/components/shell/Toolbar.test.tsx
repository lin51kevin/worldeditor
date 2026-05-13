import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorViewStore } from '../../stores/editorViewStore';
import { useThemeStore } from '../../stores/themeStore';
import { Toolbar } from './Toolbar';

describe('Toolbar', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');

    act(() => {
      useEditorViewStore.setState({
        dimension: '3d',
        showGrid: true,
        showAxis: true,
        editMode: 'default',
        splineTemplateId: 'single',
        splineKnots: [],
        viewMode: 'solid',
      });
      useThemeStore.setState({ theme: 'dark' });
    });

    vi.clearAllMocks();
  });

  it('renders edit mode buttons', () => {
    render(<Toolbar />);

    // Only default/select and draw mode buttons are shown.
    // Road/Lane/LaneSection select modes are hidden.
    expect(screen.getByRole('button', { name: '默认' })).toBeInTheDocument();
    ['样条', '直线', '圆弧', '回旋线'].forEach((label) => {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    });
    // Hidden buttons must NOT be present
    expect(screen.queryByRole('button', { name: '道路' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '车道' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '车道簇' })).not.toBeInTheDocument();
  });

  it('renders view mode buttons', () => {
    render(<Toolbar />);

    // The Toolbar no longer has dedicated view mode buttons (草图/线图/实装 removed).
    // Verify the toolbar renders without crashing.
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

    fireEvent.click(screen.getByRole('button', { name: '直线' }));
    expect(useEditorViewStore.getState().editMode).toBe('line');

    fireEvent.click(screen.getByRole('button', { name: '圆弧' }));
    expect(useEditorViewStore.getState().editMode).toBe('arc');

    fireEvent.click(screen.getByRole('button', { name: '回旋线' }));
    expect(useEditorViewStore.getState().editMode).toBe('spiral');
  });
});
