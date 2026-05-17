import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ScriptingPanel from './ScriptingPanel';

const mockSetProject = vi.fn();
let mockProject: Record<string, unknown> = {};

vi.mock('../../../stores/projectStore', () => ({
  useProjectStore: (selector: (s: unknown) => unknown) =>
    selector({ project: mockProject, setProject: mockSetProject }),
}));

beforeEach(() => {
  mockSetProject.mockClear();
  mockProject = {
    name: 'TestProject',
    header: { name: 'TestProject', revMajor: 1, revMinor: 0, date: '', north: 0, south: 0, east: 0, west: 0, vendor: '' },
    roads: [],
    junctions: [],
    signals: [],
    objects: [],
  };
});

describe('ScriptingPanel', () => {
  it('renders title "Command Console"', () => {
    render(<ScriptingPanel />);
    expect(screen.getByText('Command Console')).toBeInTheDocument();
  });

  it('renders hint text about safe commands', () => {
    render(<ScriptingPanel />);
    expect(screen.getByText(/Safe commands only/)).toBeInTheDocument();
  });

  it('input defaults to "project.summary"', () => {
    render(<ScriptingPanel />);
    const input = screen.getByPlaceholderText('Enter command') as HTMLInputElement;
    expect(input.value).toBe('project.summary');
  });

  it('renders Run button', () => {
    render(<ScriptingPanel />);
    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument();
  });

  it('shows empty-state message before any command is run', () => {
    render(<ScriptingPanel />);
    expect(screen.getByText('No commands executed yet.')).toBeInTheDocument();
  });

  it('running project.summary shows project name in the log', () => {
    render(<ScriptingPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(screen.getByText(/TestProject/)).toBeInTheDocument();
    expect(screen.queryByText('No commands executed yet.')).not.toBeInTheDocument();
  });

  it('log entry shows the executed command with > prefix', () => {
    render(<ScriptingPanel />);
    fireEvent.change(screen.getByPlaceholderText('Enter command'), { target: { value: 'help' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(screen.getByText('> help')).toBeInTheDocument();
  });

  it('running "help" shows available commands list', () => {
    render(<ScriptingPanel />);
    fireEvent.change(screen.getByPlaceholderText('Enter command'), { target: { value: 'help' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(screen.getByText(/Commands:/)).toBeInTheDocument();
  });

  it('running "roads.list" on empty project shows no-roads message', () => {
    render(<ScriptingPanel />);
    fireEvent.change(screen.getByPlaceholderText('Enter command'), { target: { value: 'roads.list' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(screen.getByText('No roads in project.')).toBeInTheDocument();
  });

  it('running unknown command shows "Unknown command" in log', () => {
    render(<ScriptingPanel />);
    fireEvent.change(screen.getByPlaceholderText('Enter command'), { target: { value: 'bogus.cmd' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(screen.getByText(/Unknown command/)).toBeInTheDocument();
  });

  it('running "project.rename Demo" shows rename confirmation in log', () => {
    render(<ScriptingPanel />);
    fireEvent.change(screen.getByPlaceholderText('Enter command'), { target: { value: 'project.rename Demo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(screen.getByText(/renamed to Demo/)).toBeInTheDocument();
  });

  it('calls setProject once per Run click', () => {
    render(<ScriptingPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(mockSetProject).toHaveBeenCalledOnce();
  });

  it('multiple runs add entries to the log (most-recent first)', () => {
    render(<ScriptingPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    fireEvent.change(screen.getByPlaceholderText('Enter command'), { target: { value: 'help' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    // Both commands should appear in log
    expect(screen.getByText('> project.summary')).toBeInTheDocument();
    expect(screen.getByText('> help')).toBeInTheDocument();
  });
});
