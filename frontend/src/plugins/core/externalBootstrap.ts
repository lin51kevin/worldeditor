/**
 * External plugin bootstrap — discovers and auto-loads filesystem plugins on startup.
 *
 * This runs ONLY inside the Tauri desktop shell. External plugins live on disk as
 * `plugins/<id>/dist/<main>` + `plugins/<id>/manifest.json`, discovered by the Rust
 * `PluginRegistry` from two sources:
 *   1. bundled plugins shipped inside the app resource directory (read-only), and
 *   2. user-installed plugins in the writable app-data `plugins/` directory.
 *
 * The web (WASM) build has no filesystem access, so this is a no-op there and those
 * plugins remain statically compiled into the bundle via `builtinRegistry`.
 */

import { loadPluginBundle, unloadPluginBundle, type PluginManifest } from './pluginLoader';
import type { PluginPermission } from './pluginApi';
import { installSharedRuntime } from './sharedRuntime';

/** Subset of the backend `plugin_list` DTO consumed here. */
interface ServerPluginInfo {
  id: string;
  name: string;
  version: string;
  permissions: string[];
  status: 'available' | 'loaded' | 'disabled';
}

/** True when running inside the Tauri desktop shell. */
function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Discover external plugins via the backend and execute each available bundle.
 *
 * Failures are isolated per-plugin: one broken plugin never blocks the others or
 * app startup. Returns a cleanup function that unloads every plugin loaded here.
 */
export async function bootstrapExternalPlugins(): Promise<() => void> {
  if (!isTauriRuntime()) {
    return () => {};
  }

  const loaded: string[] = [];

  // Expose host singletons (React) so UI plugins can render with the app's
  // React instance before any bundle executes.
  installSharedRuntime();

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const plugins = await invoke<ServerPluginInfo[]>('plugin_list');

    await Promise.all(
      plugins
        .filter((p) => p.status === 'available')
        .map(async (info) => {
          try {
            const js = await invoke<string>('plugin_get_script', { id: info.id });
            const manifest: PluginManifest = {
              id: info.id,
              name: info.name,
              version: info.version,
              main: 'dist/index.js',
              permissions: info.permissions as PluginPermission[],
            };
            await loadPluginBundle(info.id, js, manifest);
            loaded.push(info.id);
          } catch (err) {
            console.error(`[ExternalPlugin] Failed to load "${info.id}":`, err);
          }
        }),
    );
  } catch (err) {
    console.error('[ExternalPlugin] Discovery failed:', err);
  }

  return () => {
    for (const id of loaded) {
      try {
        unloadPluginBundle(id);
      } catch (err) {
        console.error(`[ExternalPlugin] Failed to unload "${id}":`, err);
      }
    }
  };
}
