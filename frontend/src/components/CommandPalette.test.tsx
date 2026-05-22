import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useThemeStore } from '../stores/themeStore';
import { useViewportStore } from '../stores/viewportStore';
import { CommandPalette } from './CommandPalette';

function openPalette() {
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
}

describe('CommandPalette', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();

    act(() => {
      useViewportStore.setState({
        editMode: 'default',
        showGrid: true,
        showAxis: true,
        viewMode: 'solid',
      });
      useThemeStore.setState({ theme: 'dark' });
    });

    vi.clearAllMocks();
  });

  it('is hidden by default', () => {
    render(<CommandPalette />);

    expect(document.querySelector('.cp-overlay')).toBeNull();
  });

  it('opens on Ctrl+K with accessible search UI', async () => {
    render(<CommandPalette />);

    openPalette();

    expect(screen.getByRole('listbox', { name: '输入命令...' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByPlaceholderText('输入命令...')).toHaveFocus());
  });

  it('closes on Escape', () => {
    render(<CommandPalette />);

    openPalette();
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(document.querySelector('.cp-overlay')).toBeNull();
  });

  it('closes on overlay click', () => {
    render(<CommandPalette />);

    openPalette();
    fireEvent.click(document.querySelector('.cp-overlay') as HTMLElement);

    expect(document.querySelector('.cp-overlay')).toBeNull();
  });

  it('shows grouped commands when opened with no filter', () => {
    render(<CommandPalette />);

    openPalette();

    expect(screen.getAllByRole('group').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('option').length).toBeGreaterThan(5);
  });

  it('filters commands by typing', () => {
    render(<CommandPalette />);

    openPalette();
    fireEvent.change(screen.getByPlaceholderText('输入命令...'), { target: { value: '网格' } });

    expect(screen.getByText('网格')).toBeInTheDocument();
    expect(screen.queryByText('坐标轴')).not.toBeInTheDocument();
  });

  it('shows no results for an unknown query', () => {
    render(<CommandPalette />);

    openPalette();
    fireEvent.change(screen.getByPlaceholderText('输入命令...'), { target: { value: 'zzzzzzzzzzz' } });

    expect(screen.getByText('无结果')).toBeInTheDocument();
  });

  it('executes a clicked command and reflects the store change', () => {
    render(<CommandPalette />);

    openPalette();
    fireEvent.click(screen.getByText('网格'));

    expect(useViewportStore.getState().showGrid).toBe(false);
    expect(document.querySelector('.cp-overlay')).toBeNull();
  });

  it('executes the selected command on Enter', () => {
    render(<CommandPalette />);

    openPalette();
    fireEvent.keyDown(document.querySelector('.cp-container') as HTMLElement, { key: 'Enter' });

    expect(useViewportStore.getState().showGrid).toBe(false);
    expect(document.querySelector('.cp-overlay')).toBeNull();
  });

  it('navigates with ArrowDown and ArrowUp', () => {
    render(<CommandPalette />);

    openPalette();
    const container = document.querySelector('.cp-container') as HTMLElement;

    fireEvent.keyDown(container, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(container, { key: 'ArrowUp' });
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('toggles Ctrl+K to close when already open', () => {
    render(<CommandPalette />);

    openPalette();
    openPalette();

    expect(document.querySelector('.cp-overlay')).toBeNull();
  });
});
