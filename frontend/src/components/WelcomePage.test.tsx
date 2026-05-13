import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WelcomePage } from './WelcomePage';
import type { RecentFile } from './WelcomePage';

describe('WelcomePage', () => {
  const baseProps = {
    recentFiles: [] as RecentFile[],
    onNewProject: vi.fn(),
    onOpenFile: vi.fn(),
    onOpenRecent: vi.fn(),
    onRemoveRecent: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders without crashing', () => {
    render(<WelcomePage {...baseProps} />);

    expect(screen.getByText('WorldEditor')).toBeInTheDocument();
  });

  it('shows the New Project and Open File buttons', () => {
    render(<WelcomePage {...baseProps} />);

    expect(screen.getByText('New Project')).toBeInTheDocument();
    expect(screen.getByText('Open File…')).toBeInTheDocument();
  });

  it('shows the empty state message when no recent files', () => {
    render(<WelcomePage {...baseProps} recentFiles={[]} />);
    expect(screen.getByText('No recent files. Open a file to get started.')).toBeInTheDocument();
  });

  it('shows recent files when provided', () => {
    const recentFile: RecentFile = { name: 'demo.xodr', path: '/maps/demo.xodr', lastOpened: Date.now() };
    render(<WelcomePage {...baseProps} recentFiles={[recentFile]} />);

    expect(screen.getAllByText('demo.xodr').length).toBeGreaterThan(0);
  });

  it('calls onNewProject when New Project button is clicked', () => {
    render(<WelcomePage {...baseProps} />);

    fireEvent.click(screen.getByText('New Project'));
    expect(baseProps.onNewProject).toHaveBeenCalledTimes(1);
  });

  it('calls onOpenFile when Open File button is clicked', () => {
    render(<WelcomePage {...baseProps} />);

    fireEvent.click(screen.getByText('Open File…'));
    expect(baseProps.onOpenFile).toHaveBeenCalledTimes(1);
  });

  it('calls onOpenRecent when a recent file is clicked', () => {
    const recentFile: RecentFile = { name: 'demo.xodr', path: '/maps/demo.xodr', lastOpened: Date.now() };
    render(<WelcomePage {...baseProps} recentFiles={[recentFile]} />);

    fireEvent.click(screen.getByText('demo.xodr'));
    expect(baseProps.onOpenRecent).toHaveBeenCalledWith(recentFile);
  });
});
