import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuickCommands } from './QuickCommands';

const commands = [
  { command: '/road add', label: 'Add Road', description: 'Add a new road' },
  { command: '/road delete', label: 'Delete Road', description: 'Delete selected road' },
  { command: '/help', label: 'Help', description: 'Show help' },
];

describe('QuickCommands', () => {
  it('renders the command list when visible', () => {
    render(<QuickCommands visible commands={commands} onSelect={vi.fn()} />);

    expect(screen.getByText('/road add')).toBeInTheDocument();
    expect(screen.getByText('Delete selected road')).toBeInTheDocument();
    expect(screen.getAllByTestId(/quick-command-/)).toHaveLength(3);
  });

  it('triggers selection when a command is clicked', () => {
    const onSelect = vi.fn();

    render(<QuickCommands visible commands={commands} onSelect={onSelect} />);

    fireEvent.click(screen.getByText('/road delete'));

    expect(onSelect).toHaveBeenCalledWith('/road delete ');
  });

  it('supports keyboard navigation and selection', () => {
    const onSelect = vi.fn();

    render(<QuickCommands visible commands={commands} onSelect={onSelect} />);

    expect(screen.getByTestId('quick-command-0')).toHaveClass('copilot-quick-cmd-item--selected');

    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(screen.getByTestId('quick-command-1')).toHaveClass('copilot-quick-cmd-item--selected');

    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('/road delete ');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onSelect).toHaveBeenLastCalledWith('');
  });
});
