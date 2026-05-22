import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMenuWithPlugins } from '../services/contextMenu';
import { ContextMenu } from './ContextMenu';

const menuActions = vi.hoisted(() => ({
  open: vi.fn(),
  copy: vi.fn(),
  rename: vi.fn(),
  disabled: vi.fn(),
}));

function showContextMenu(x: number, y: number, context: string) {
  document.dispatchEvent(new CustomEvent('contextmenu:show', { detail: { x, y, context } }));
}

vi.mock('../services/contextMenu', () => ({
  getMenuWithPlugins: vi.fn((_context: string, _x: number, _y: number) => [
    { label: 'Open', shortcut: 'Enter', action: menuActions.open },
    { label: 'Copy', shortcut: 'Ctrl+C', action: menuActions.copy },
    { label: 'More', submenu: [{ label: 'Rename', action: menuActions.rename }] },
    { separator: true, label: '' },
    { label: 'Disabled Item', disabled: true, action: menuActions.disabled },
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

  it('renders menu items at the requested position', () => {
    render(<ContextMenu />);

    act(() => showContextMenu(100, 200, 'viewport'));

    expect(vi.mocked(getMenuWithPlugins)).toHaveBeenCalledWith('viewport', 100, 200);
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Copy')).toBeInTheDocument();
    expect(screen.getByText('More')).toBeInTheDocument();
    expect(document.querySelector('.context-menu')).toHaveStyle({ left: '100px', top: '200px' });
  });

  it('renders separator elements and shortcuts', () => {
    render(<ContextMenu />);

    act(() => showContextMenu(100, 200, 'viewport'));

    expect(document.querySelectorAll('.context-menu-separator')).toHaveLength(1);
    expect(screen.getByText('Enter')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+C')).toBeInTheDocument();
  });

  it('calls the item click handler and closes the menu', () => {
    render(<ContextMenu />);

    act(() => showContextMenu(100, 200, 'viewport'));
    fireEvent.click(screen.getByText('Open'));

    expect(menuActions.open).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.context-menu')).toBeNull();
  });

  it('opens submenu items and handles submenu clicks', () => {
    render(<ContextMenu />);

    act(() => showContextMenu(100, 200, 'viewport'));
    fireEvent.mouseEnter(screen.getByText('More'));
    fireEvent.click(screen.getByText('Rename'));

    expect(menuActions.rename).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.context-menu')).toBeNull();
  });

  it('dismisses on outside click', () => {
    render(<ContextMenu />);

    act(() => showContextMenu(100, 200, 'viewport'));
    act(() => {
      document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(document.querySelector('.context-menu')).toBeNull();
  });

  it('hides on Escape key', () => {
    render(<ContextMenu />);

    act(() => showContextMenu(100, 200, 'viewport'));
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(document.querySelector('.context-menu')).toBeNull();
  });

  it('renders disabled items without calling their handlers', () => {
    render(<ContextMenu />);

    act(() => showContextMenu(100, 200, 'viewport'));
    const disabledItem = screen.getByText('Disabled Item').closest('.context-menu-item');
    fireEvent.click(screen.getByText('Disabled Item'));

    expect(disabledItem).toHaveClass('disabled');
    expect(menuActions.disabled).not.toHaveBeenCalled();
  });
});
