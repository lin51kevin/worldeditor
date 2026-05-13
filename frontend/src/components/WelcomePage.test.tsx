import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WelcomePage } from './WelcomePage';

describe('WelcomePage', () => {
  const baseProps = {
    onClose: vi.fn(),
    onNewProject: vi.fn(),
    onOpenFile: vi.fn(),
    recentFiles: [] as Array<{ displayName: string; path: string }>,
    onOpenRecentFile: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders without crashing', () => {
    render(<WelcomePage {...baseProps} />);

    expect(screen.getByText('WorldEditor Next')).toBeInTheDocument();
  });

  it("has don't show again checkbox", () => {
    render(<WelcomePage {...baseProps} />);

    expect(screen.getByRole('checkbox', { name: '启动时不再显示此页面' })).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<WelcomePage {...baseProps} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows recent files or the empty state message', () => {
    const { rerender } = render(<WelcomePage {...baseProps} recentFiles={[]} />);
    expect(screen.getByText('暂无最近文件')).toBeInTheDocument();

    rerender(
      <WelcomePage
        {...baseProps}
        recentFiles={[{ displayName: 'demo.xodr', path: 'C:\\maps\\demo.xodr' }]}
      />,
    );

    expect(screen.getAllByText('demo.xodr').length).toBeGreaterThan(0);
  });
});
