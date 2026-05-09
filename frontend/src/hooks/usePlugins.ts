/**
 * Plugin management hook — interfaces with backend PluginRegistry via Tauri commands.
 */

import { useState, useCallback, useEffect } from 'react';

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description?: string;
  dependencies: string[];
  permissions: string[];
  status: 'available' | 'loaded' | 'disabled';
  disabledReason?: string;
}

export interface UsePluginsReturn {
  plugins: PluginInfo[];
  loading: boolean;
  error: string | null;
  loadPlugin: (id: string) => Promise<void>;
  unloadPlugin: (id: string) => Promise<void>;
  enablePlugin: (id: string) => Promise<void>;
  disablePlugin: (id: string, reason: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const TAURI_COMMANDS = {
  listPlugins: 'plugin_list',
  loadPlugin: 'plugin_load',
  unloadPlugin: 'plugin_unload',
  enablePlugin: 'plugin_enable',
  disablePlugin: 'plugin_disable',
} as const;

/**
 * Hook for managing plugins from the frontend.
 */
export function usePlugins(): UsePluginsReturn {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invokeCommand = useCallback(async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    // Check if running in Tauri environment
    if (typeof window !== 'undefined' && '__TAURI__' in window) {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke<T>(command, args);
    }
    // Fallback for web development (mock data)
    console.warn(`[usePlugins] ${command} called outside Tauri context — using mock`);
    return [] as unknown as T;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invokeCommand<PluginInfo[]>(TAURI_COMMANDS.listPlugins);
      setPlugins(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [invokeCommand]);

  const loadPlugin = useCallback(async (id: string) => {
    setError(null);
    try {
      await invokeCommand<void>(TAURI_COMMANDS.loadPlugin, { id });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, [invokeCommand, refresh]);

  const unloadPlugin = useCallback(async (id: string) => {
    setError(null);
    try {
      await invokeCommand<void>(TAURI_COMMANDS.unloadPlugin, { id });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, [invokeCommand, refresh]);

  const enablePlugin = useCallback(async (id: string) => {
    setError(null);
    try {
      await invokeCommand<void>(TAURI_COMMANDS.enablePlugin, { id });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, [invokeCommand, refresh]);

  const disablePlugin = useCallback(async (id: string, reason: string) => {
    setError(null);
    try {
      await invokeCommand<void>(TAURI_COMMANDS.disablePlugin, { id, reason });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, [invokeCommand, refresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    plugins,
    loading,
    error,
    loadPlugin,
    unloadPlugin,
    enablePlugin,
    disablePlugin,
    refresh,
  };
}

export default usePlugins;