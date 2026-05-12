import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { HelpDialog } from './HelpDialog';

describe('HelpDialog', () => {
  it('should render a dialog with title', () => {
    render(<HelpDialog onClose={() => {}} />);
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByRole('heading')).toBeDefined();
  });

  it('should display keyboard shortcuts section', () => {
    render(<HelpDialog onClose={() => {}} />);
    // At least one <kbd> element should exist
    const kbdElements = document.querySelectorAll('kbd');
    expect(kbdElements.length).toBeGreaterThan(0);
  });

  it('should render a close button', () => {
    render(<HelpDialog onClose={() => {}} />);
    const closeBtn = screen.getByRole('button', { name: /close/i });
    expect(closeBtn).toBeDefined();
  });

  it('should call onClose when close button is clicked', () => {
    let closed = false;
    render(<HelpDialog onClose={() => { closed = true; }} />);
    screen.getByRole('button', { name: /close/i }).click();
    expect(closed).toBe(true);
  });

  it('should display at least 5 shortcut entries', () => {
    render(<HelpDialog onClose={() => {}} />);
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBeGreaterThanOrEqual(5);
  });
});
