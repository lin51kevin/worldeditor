import { act, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextMenu } from './ContextMenu';

// Utility to dispatch the custom event that opens the context menu
function showContextMenu(x: number, y: number, context: string) {
  const event = new CustomEvent('contextmenu:show', {
    detail: { x, y, context },
  });
  document.dispatchEvent(event);
}

// Mock the contextMenu service
vi.mock('../services/contextMenu', () => ({
  getMenu: vi.fn((_context: string) => [
    { label: 'Cut', shortcut: 'Ctrl+X', action: vi.fn() },
    { label: 'Copy', shortcut: 'Ctrl+C', action: vi.fn() },
    { separator: true },
    { label: 'Paste', action: vi.fn() },
    { label: 'Disabled Item', disabled: true, action: vi.fn() },
  ]),
  getMenuWithPlugins: vi.fn((_context: string, _x: number, _y: number) => [
    { label: 'Cut', shortcut: 'Ctrl+X', action: vi.fn() },
    { label: 'Copy', shortcut: 'Ctrl+C', action: vi.fn() },
    { separator: true },
    { label: 'Paste', action: vi.fn() },
    { label: 'Disabled Item', disabled: true, action: vi.fn() },
  ]),
}));

describe('ContextMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is hidden by default', () => {
    render(<ContextMenu />);
    expect(document.querySelector('.context-menu')).toBeNull();
  });

  it('shows on custom event with items', () => {
    render(<ContextMenu />);
    act(() => showContextMenu(100, 200, 'viewport'));
    expect(document.querySelector('.context-menu')).not.toBeNull();
    expect(screen.getByText('Cut')).toBeInTheDocument();
    expect(screen.getByText('Copy')).toBeInTheDocument();
    expect(screen.getByText('Paste')).toBeInTheDocument();
  });

  it('renders separator elements', () => {
    render(<ContextMenu />);
    act(() => showContextMenu(100, 200, 'viewport'));
    expect(document.querySelectorAll('.context-menu-separator').length).toBeGreaterThan(0);
  });

  it('renders shortcut labels', () => {
    render(<ContextMenu />);
    act(() => showContextMenu(100, 200, 'viewport'));
    expect(screen.getByText('Ctrl+X')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+C')).toBeInTheDocument();
  });

  it('hides on document click', () => {
    render(<ContextMenu />);
    act(() => showContextMenu(100, 200, 'viewport'));
    expect(document.querySelector('.context-menu')).not.toBeNull();

    act(() => {
      document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.querySelector('.context-menu')).toBeNull();
  });

  it('hides on Escape key', () => {
    render(<ContextMenu />);
    act(() => showContextMenu(100, 200, 'viewport'));
    expect(document.querySelector('.context-menu')).not.toBeNull();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('.context-menu')).toBeNull();
  });

  it('renders disabled item with disabled class', () => {
    render(<ContextMenu />);
    act(() => showContextMenu(100, 200, 'viewport'));
    const disabledItem = screen.getByText('Disabled Item').closest('.context-menu-item');
    expect(disabledItem?.classList.contains('disabled')).toBe(true);
  });
});
