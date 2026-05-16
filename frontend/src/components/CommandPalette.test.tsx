import { act, fireEvent, render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useViewportStore } from '../stores/viewportStore';
import { useThemeStore } from '../stores/themeStore';
import { CommandPalette } from './CommandPalette';

function openPalette() {
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
}

describe('CommandPalette', () => {
  beforeEach(() => {
    // jsdom doesn't implement scrollIntoView
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

  it('opens on Ctrl+K', () => {
    render(<CommandPalette />);
    openPalette();
    expect(document.querySelector('.cp-overlay')).not.toBeNull();
  });

  it('closes on Escape', () => {
    render(<CommandPalette />);
    openPalette();
    expect(document.querySelector('.cp-overlay')).not.toBeNull();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.querySelector('.cp-overlay')).toBeNull();
  });

  it('closes on overlay click', () => {
    render(<CommandPalette />);
    openPalette();

    const overlay = document.querySelector('.cp-overlay') as HTMLElement;
    fireEvent.click(overlay);
    expect(document.querySelector('.cp-overlay')).toBeNull();
  });

  it('shows all commands when opened with no filter', () => {
    render(<CommandPalette />);
    openPalette();

    // Should have categories
    expect(document.querySelectorAll('.cp-category').length).toBeGreaterThan(0);
    // Should have command items
    expect(document.querySelectorAll('.cp-item').length).toBeGreaterThan(5);
  });

  it('filters commands by query', () => {
    render(<CommandPalette />);
    openPalette();

    const input = document.querySelector('.cp-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '网格' } });
    // Should have fewer items
    const items = document.querySelectorAll('.cp-item');
    expect(items.length).toBeGreaterThanOrEqual(1);
  });

  it('shows no results for garbage query', () => {
    render(<CommandPalette />);
    openPalette();

    const input = document.querySelector('.cp-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'zzzzzzzzzzz' } });
    expect(document.querySelector('.cp-empty')).not.toBeNull();
  });

  it('executes command on Enter and closes palette', () => {
    render(<CommandPalette />);
    openPalette();
    const container = document.querySelector('.cp-container') as HTMLElement;

    // Press Enter to execute the first command
    fireEvent.keyDown(container, { key: 'Enter' });
    // Palette should close
    expect(document.querySelector('.cp-overlay')).toBeNull();
  });

  it('navigates with ArrowDown/ArrowUp', () => {
    render(<CommandPalette />);
    openPalette();
    const container = document.querySelector('.cp-container') as HTMLElement;

    fireEvent.keyDown(container, { key: 'ArrowDown' });
    const items = document.querySelectorAll('.cp-item');
    expect(items[1]?.classList.contains('selected')).toBe(true);

    fireEvent.keyDown(container, { key: 'ArrowUp' });
    expect(items[0]?.classList.contains('selected')).toBe(true);
  });

  it('toggles Ctrl+K to close when already open', () => {
    render(<CommandPalette />);
    openPalette();
    expect(document.querySelector('.cp-overlay')).not.toBeNull();
    openPalette();
    expect(document.querySelector('.cp-overlay')).toBeNull();
  });
});
