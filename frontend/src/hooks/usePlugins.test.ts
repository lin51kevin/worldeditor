import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { usePlugins, type PluginInfo } from './usePlugins';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Suppress built-in plugins so tests see only server-provided plugins
vi.mock('../plugins/builtinRegistry', () => ({
  BUILTIN_PLUGINS: [],
}));

// Mock plugin loader to avoid URL.createObjectURL in jsdom
vi.mock('../plugins/pluginLoader', () => ({
  loadPluginBundle: vi.fn().mockResolvedValue(undefined),
  unloadPluginBundle: vi.fn(),
}));

function setTauriEnabled(enabled: boolean) {
  if (enabled) {
    Object.defineProperty(window, '__TAURI__', {
      value: {},
      configurable: true,
    });
  } else {
    Reflect.deleteProperty(window, '__TAURI__');
  }
}

function makePlugin(overrides: Partial<PluginInfo> = {}): PluginInfo {
  return {
    id: 'plugin.test',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'plugin description',
    dependencies: [],
    permissions: [],
    status: 'available',
    ...overrides,
  };
}

describe('usePlugins', () => {
  const invokeMock = vi.mocked(invoke);

  beforeEach(() => {
    vi.clearAllMocks();
    setTauriEnabled(false);
    invokeMock.mockResolvedValue([]);
  });

  it('starts with empty state and refreshes on mount outside Tauri', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() => usePlugins());

    expect(result.current.plugins).toEqual([]);
    expect(result.current.error).toBeNull();

    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('plugin_list called outside Tauri context')
      );
    });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.plugins).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('returns a mock empty array when refreshed outside Tauri', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => usePlugins());

    await act(async () => {
      await result.current.refresh();
    });

    expect(warnSpy).toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(result.current.plugins).toEqual([]);
  });

  it('loads plugins from Tauri on mount', async () => {
    const plugins = [makePlugin({ status: 'loaded' })];
    setTauriEnabled(true);
    invokeMock.mockResolvedValueOnce(plugins);

    const { result } = renderHook(() => usePlugins());

    await waitFor(() => {
      expect(result.current.plugins).toEqual(plugins);
    });

    expect(invokeMock).toHaveBeenCalledWith('plugin_list', undefined);
    expect(result.current.error).toBeNull();
  });

  it.each([
    ['enablePlugin', 'plugin_enable', ['plugin.test'] as const],
    ['disablePlugin', 'plugin_disable', ['plugin.test', 'manual disable'] as const],
  ])('runs %s and refreshes afterward', async (method, command, args) => {
    setTauriEnabled(true);
    invokeMock.mockResolvedValue([]);

    const { result } = renderHook(() => usePlugins());

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('plugin_list', undefined);
    });
    invokeMock.mockClear();

    await act(async () => {
      if (method === 'disablePlugin') {
        await result.current.disablePlugin(args[0], args[1]!);
      } else {
        await result.current.enablePlugin(args[0]);
      }
    });

    if (method === 'enablePlugin') {
      // enablePlugin reloads the bundle (plugin_get_script) before enabling, then refreshes
      expect(invokeMock).toHaveBeenCalledWith('plugin_get_script', { id: args[0] });
      expect(invokeMock).toHaveBeenCalledWith(command, { id: args[0] });
      expect(invokeMock).toHaveBeenCalledWith('plugin_list', undefined);
    } else {
      expect(invokeMock).toHaveBeenNthCalledWith(1, command, { id: args[0], reason: args[1] });
      expect(invokeMock).toHaveBeenNthCalledWith(2, 'plugin_list', undefined);
    }
  });

  it('runs loadPlugin by fetching script and executing bundle', async () => {
    setTauriEnabled(true);
    const fakeScript = 'console.log("plugin loaded")';
    invokeMock.mockResolvedValueOnce([]); // initial plugin_list
    invokeMock.mockResolvedValueOnce(fakeScript); // plugin_get_script

    const { result } = renderHook(() => usePlugins());

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('plugin_list', undefined);
    });
    invokeMock.mockClear();

    await act(async () => {
      await result.current.loadPlugin('plugin.test');
    });

    expect(invokeMock).toHaveBeenCalledWith('plugin_get_script', { id: 'plugin.test' });
    expect(result.current.error).toBeNull();
  });

  it('runs unloadPlugin and notifies backend', async () => {
    setTauriEnabled(true);
    invokeMock.mockResolvedValue([]);

    const { result } = renderHook(() => usePlugins());

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('plugin_list', undefined);
    });
    invokeMock.mockClear();

    await act(async () => {
      await result.current.unloadPlugin('plugin.test');
    });

    expect(invokeMock).toHaveBeenCalledWith('plugin_unload', { id: 'plugin.test' });
    expect(result.current.error).toBeNull();
  });

  it('sets error state when refresh fails', async () => {
    setTauriEnabled(true);
    invokeMock.mockRejectedValueOnce(new Error('refresh failed'));

    const { result } = renderHook(() => usePlugins());

    await waitFor(() => {
      expect(result.current.error).toBe('refresh failed');
    });

    expect(result.current.loading).toBe(false);
  });

  it('sets error state and rethrows when plugin actions fail', async () => {
    setTauriEnabled(true);
    invokeMock.mockResolvedValueOnce([]);

    const { result } = renderHook(() => usePlugins());
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('plugin_list', undefined);
    });

    invokeMock.mockReset();
    invokeMock.mockRejectedValueOnce(new Error('load failed'));

    await act(async () => {
      await expect(result.current.loadPlugin('plugin.test')).rejects.toThrow('load failed');
    });

    expect(result.current.error).toBe('load failed');
  });
});
