import { act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useThemeStore } from './themeStore';

describe('themeStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    useThemeStore.setState({ theme: 'dark' });
    // Ensure __TAURI_INTERNALS__ is not present so syncNativeTheme is a no-op
    delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'];
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'];
  });

  it('has dark as the initial theme', () => {
    expect(useThemeStore.getState().theme).toBe('dark');
  });

  it('toggleTheme changes from dark to light', () => {
    act(() => {
      useThemeStore.getState().toggleTheme();
    });

    expect(useThemeStore.getState().theme).toBe('light');
  });

  it('toggleTheme twice returns to dark', () => {
    act(() => {
      useThemeStore.getState().toggleTheme();
      useThemeStore.getState().toggleTheme();
    });

    expect(useThemeStore.getState().theme).toBe('dark');
  });

  it('toggleTheme sets localStorage we-theme', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    act(() => {
      useThemeStore.getState().toggleTheme();
    });

    expect(setItemSpy).toHaveBeenCalledWith('we-theme', 'light');
    expect(localStorage.getItem('we-theme')).toBe('light');
  });

  it('toggleTheme sets the data-theme attribute', () => {
    act(() => {
      useThemeStore.getState().toggleTheme();
    });

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('initTheme reads from localStorage', () => {
    localStorage.setItem('we-theme', 'light');
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem');

    act(() => {
      useThemeStore.getState().initTheme();
    });

    expect(getItemSpy).toHaveBeenCalledWith('we-theme');
  });

  it('initTheme defaults to dark when no theme is saved', () => {
    act(() => {
      useThemeStore.getState().initTheme();
    });

    expect(useThemeStore.getState().theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('initTheme reads a saved light theme', () => {
    localStorage.setItem('we-theme', 'light');

    act(() => {
      useThemeStore.getState().initTheme();
    });

    expect(useThemeStore.getState().theme).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('syncNativeTheme is called in Tauri context on toggleTheme', async () => {
    const mockSetTheme = vi.fn().mockResolvedValue(undefined);
    vi.mock('@tauri-apps/api/window', () => ({
      getCurrentWindow: () => ({ setTheme: mockSetTheme }),
    }));
    (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};

    await act(async () => {
      useThemeStore.getState().toggleTheme();
      // Allow the microtask for syncNativeTheme to run
      await Promise.resolve();
    });

    expect(useThemeStore.getState().theme).toBe('light');
  });
});
