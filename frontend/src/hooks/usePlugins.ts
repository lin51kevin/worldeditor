/**
 * Plugin management hook — interfaces with backend PluginRegistry via Tauri commands.
 * Built-in plugins (compiled into the app) are merged with dynamically discovered ones.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { BUILTIN_PLUGINS } from '../plugins/builtinRegistry';
import { loadPluginBundle, unloadPluginBundle } from '../plugins/pluginLoader';

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description?: string;
  dependencies: string[];
  permissions: string[];
  status: 'available' | 'loaded' | 'disabled';
  disabledReason?: string;
  /** True for plugins compiled directly into the app (always loaded, cannot be uninstalled) */
  isBuiltin?: boolean;
  /** i18n key for the plugin name (optional; falls back to name) */
  nameKey?: string;
  /** i18n key for the plugin description (optional; falls back to description) */
  descriptionKey?: string;
}

export interface UsePluginsReturn {
  plugins: PluginInfo[];
  loading: boolean;
  error: string | null;
  loadPlugin: (id: string) => Promise<void>;
  unloadPlugin: (id: string) => Promise<void>;
  enablePlugin: (id: string) => Promise<void>;
  disablePlugin: (id: string, reason: string) => Promise<void>;
  installPlugin: (srcPath: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const TAURI_COMMANDS = {
  listPlugins: 'plugin_list',
  getScript: 'plugin_get_script',
  unloadPlugin: 'plugin_unload',
  enablePlugin: 'plugin_enable',
  disablePlugin: 'plugin_disable',
  installPlugin: 'plugin_install',
} as const;

/**
 * Hook for managing plugins from the frontend.
 */
export function usePlugins(): UsePluginsReturn {
  /** Plugins discovered by the backend (external, from plugins/ directory) */
  const [serverPlugins, setServerPlugins] = useState<PluginInfo[]>([]);
  /** IDs of external plugins whose JS has been executed in the browser */
  const [loadedIds, setLoadedIds] = useState<Set<string>>(new Set());
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
      setServerPlugins(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [invokeCommand]);

  /**
   * Merged plugin list: built-ins (always loaded) + external (discovered by backend).
   * For external plugins that have been JS-loaded in this session, status is overridden to 'loaded'.
   */
  const plugins = useMemo<PluginInfo[]>(() => {
    const external = serverPlugins.map((p) => ({
      ...p,
      status: loadedIds.has(p.id) ? ('loaded' as const) : p.status,
    }));
    return [...BUILTIN_PLUGINS, ...external];
  }, [serverPlugins, loadedIds]);

  const loadPlugin = useCallback(async (id: string) => {
    setError(null);
    try {
      const js = await invokeCommand<string>(TAURI_COMMANDS.getScript, { id });
      await loadPluginBundle(id, js);
      setLoadedIds((prev) => new Set(prev).add(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, [invokeCommand]);

  const unloadPlugin = useCallback(async (id: string) => {
    setError(null);
    try {
      unloadPluginBundle(id);
      setLoadedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      // Best-effort notification to backend
      await invokeCommand<void>(TAURI_COMMANDS.unloadPlugin, { id }).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, [invokeCommand]);

  const enablePlugin = useCallback(async (id: string) => {
    setError(null);
    try {
      await invokeCommand<void>(TAURI_COMMANDS.enablePlugin, { id });
      // Reload the JS bundle so the plugin re-registers its contributions
      await loadPlugin(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, [invokeCommand, loadPlugin, refresh]);

  const disablePlugin = useCallback(async (id: string, reason: string) => {
    setError(null);
    try {
      // Unload the JS bundle first so plugin contributions are removed from the UI
      unloadPluginBundle(id);
      setLoadedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      await invokeCommand<void>(TAURI_COMMANDS.disablePlugin, { id, reason });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, [invokeCommand, refresh]);

  const installPlugin = useCallback(async (srcPath: string) => {
    setError(null);
    try {
      await invokeCommand<void>(TAURI_COMMANDS.installPlugin, { srcPath });
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
    installPlugin,
    refresh,
  };
}

export default usePlugins;