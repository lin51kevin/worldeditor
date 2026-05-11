import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorViewStore } from '../stores/editorViewStore';
import { useThemeStore } from '../stores/themeStore';
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
        editMode: 'select',
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

    ['默认', '道路', '样条', '车道', '路口'].forEach((label) => {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    });
  });

  it('renders view mode buttons', () => {
    render(<Toolbar />);

    // The Toolbar no longer has dedicated view mode buttons (草图/线图/实装 removed).
    // Verify the toolbar renders without crashing.
    expect(document.querySelector('.toolbar')).toBeInTheDocument();
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

  it('updates edit, view, dimension, and visibility controls', () => {
    render(<Toolbar />);

    fireEvent.click(screen.getByRole('button', { name: '道路' }));
    fireEvent.click(screen.getByRole('button', { name: '车道' }));
    fireEvent.click(screen.getByRole('button', { name: '路口' }));
    fireEvent.click(screen.getByTitle('2D视图'));
    fireEvent.click(screen.getByRole('button', { name: '网格' }));
    fireEvent.click(screen.getByRole('button', { name: '坐标轴' }));

    expect(useEditorViewStore.getState().editMode).toBe('junction');
    expect(useEditorViewStore.getState().dimension).toBe('2d');
    expect(useEditorViewStore.getState().showGrid).toBe(false);
    expect(useEditorViewStore.getState().showAxis).toBe(false);
  });
});
