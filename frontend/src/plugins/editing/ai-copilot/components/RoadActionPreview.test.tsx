import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ActionResult } from '../core/action-executor';
import { RoadActionPreview } from './RoadActionPreview';

describe('RoadActionPreview', () => {
  it('renders action details for a successful result', () => {
    const result: ActionResult = {
      success: true,
      description: '已删除道路 road-1',
    };

    const { container } = render(<RoadActionPreview result={result} />);

    expect(screen.getByText('已删除道路 road-1')).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('copilot-action-success');
    expect(screen.getByText('✓')).toBeInTheDocument();
  });

  it('shows road information from the action description', () => {
    const result: ActionResult = {
      success: true,
      description: '已为道路 road-main 添加右侧车道',
    };

    render(<RoadActionPreview result={result} />);

    expect(screen.getByText(/road-main/)).toBeInTheDocument();
  });

  it('renders error details for a failed action', () => {
    const result: ActionResult = {
      success: false,
      description: '操作失败',
      error: '未找到道路 road-404',
    };

    const { container } = render(<RoadActionPreview result={result} />);

    expect(screen.getByText('操作失败')).toBeInTheDocument();
    expect(screen.getByText('未找到道路 road-404')).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('copilot-action-error');
    expect(screen.getByText('✗')).toBeInTheDocument();
  });
});
