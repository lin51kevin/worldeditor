import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from '@testing-library/react';
import { useEditorStore } from '../../stores/editorStore';
import { ToolPanel } from './ToolPanel';

describe('ToolPanel', () => {
  beforeEach(() => {
    act(() => {
      useEditorStore.getState().reset();
    });
    vi.clearAllMocks();
  });

  it('renders the header', () => {
    render(<ToolPanel />);
    expect(screen.getByText('工具')).toBeInTheDocument();
  });

  it('renders all tool buttons', () => {
    render(<ToolPanel />);
    expect(screen.getByTitle('计算道路总长度')).toBeInTheDocument();
    expect(screen.getByTitle('创建人行道')).toBeInTheDocument();
    expect(screen.getByTitle('自动创建路灯')).toBeInTheDocument();
  });

  it('renders the road length input', () => {
    render(<ToolPanel />);
    const input = document.querySelector('.tool-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('0.00000');
    expect(input.readOnly).toBe(true);
  });

  it('disables tools that are marked disabled', () => {
    render(<ToolPanel />);
    const createPedestrian = screen.getByTitle('创建人行道');
    expect(createPedestrian).toBeDisabled();
  });

  it('includes the RoadEditToolbar as a child section', () => {
    render(<ToolPanel />);
    expect(screen.getByText('道路编辑工具')).toBeInTheDocument();
  });
});
