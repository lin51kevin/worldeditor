import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WelcomePage } from './WelcomePage';
import type { RecentFile } from './WelcomePage';

describe('WelcomePage', () => {
  const baseProps = {
    recentFiles: [] as RecentFile[],
    onNew: vi.fn(),
    onOpenFile: vi.fn(),
    onOpenRecent: vi.fn(),
    onRemoveRecent: vi.fn(),
    showOnStartup: true,
    onToggleShowOnStartup: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders without crashing', () => {
    render(<WelcomePage {...baseProps} />);
    expect(screen.getByText('WorldEditor')).toBeInTheDocument();
  });

  it('shows New and Open File buttons', () => {
    render(<WelcomePage {...baseProps} />);
    expect(screen.getByRole('button', { name: /新建/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /打开文件/ })).toBeInTheDocument();
  });

  it('shows User Manual and Project Homepage links', () => {
    render(<WelcomePage {...baseProps} />);
    expect(screen.getByRole('button', { name: /帮助手册/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /项目主页/ })).toBeInTheDocument();
  });

  it('shows the empty state message when no recent files', () => {
    render(<WelcomePage {...baseProps} recentFiles={[]} />);
    expect(screen.getByText('暂无最近文件，打开文件开始使用')).toBeInTheDocument();
  });

  it('shows recent files when provided', () => {
    const recentFile: RecentFile = { name: 'demo.xodr', path: '/maps/demo.xodr', lastOpened: Date.now() };
    render(<WelcomePage {...baseProps} recentFiles={[recentFile]} />);
    expect(screen.getAllByText('demo.xodr').length).toBeGreaterThan(0);
  });

  it('calls onNew when New button is clicked', () => {
    render(<WelcomePage {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /新建/ }));
    expect(baseProps.onNew).toHaveBeenCalledTimes(1);
  });

  it('calls onOpenFile when Open File button is clicked', () => {
    render(<WelcomePage {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /打开文件/ }));
    expect(baseProps.onOpenFile).toHaveBeenCalledTimes(1);
  });

  it('calls onOpenRecent when a recent file is clicked', () => {
    const recentFile: RecentFile = { name: 'demo.xodr', path: '/maps/demo.xodr', lastOpened: Date.now() };
    render(<WelcomePage {...baseProps} recentFiles={[recentFile]} />);
    fireEvent.click(screen.getByText('demo.xodr'));
    expect(baseProps.onOpenRecent).toHaveBeenCalledWith(recentFile);
  });

  it('renders the shortcuts section', () => {
    render(<WelcomePage {...baseProps} />);
    // Section h2 has an icon sibling, query by role with name
    const heading = screen.getByRole('heading', { name: /快捷键速览/ });
    expect(heading).toBeInTheDocument();
  });

  it('renders the startup checkbox checked when showOnStartup=true', () => {
    render(<WelcomePage {...baseProps} showOnStartup={true} />);
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('renders the startup checkbox unchecked when showOnStartup=false', () => {
    render(<WelcomePage {...baseProps} showOnStartup={false} />);
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });

  it('calls onToggleShowOnStartup when checkbox is toggled', () => {
    render(<WelcomePage {...baseProps} showOnStartup={true} />);
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(baseProps.onToggleShowOnStartup).toHaveBeenCalledWith(false);
  });
})
