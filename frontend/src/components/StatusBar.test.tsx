import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../stores/editorStore';
import { StatusBar } from './StatusBar';

describe('StatusBar', () => {
  beforeEach(() => {
    act(() => {
      useEditorStore.setState({
        cursorWorldPos: { x: 0, y: 0 },
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
      useEditorStore.setState({ cursorWorldPos: { x: 123.45678, y: -9.1 } });
    });

    expect(screen.getByText(/世界坐标系:\s*123\.457,\s*-9\.100/)).toBeInTheDocument();
  });

  it('renders a single floating status chip', () => {
    const { container } = render(<StatusBar />);
    expect(container.querySelectorAll('.statusbar-item')).toHaveLength(1);
  });
});
