/**
 * Plugin API — installs `window.__WE_PLUGIN_API__` for external plugin scripts.
 *
 * External plugins (IIFE format) call `window.__WE_PLUGIN_API__.registerPlugin(id, setup)`
 * where setup receives a PluginContext and can register toolbar buttons, menu items,
 * and template sections. The setup function may return a cleanup function; if it doesn't,
 * all contributions registered under that pluginId are removed automatically on unload.
 *
 * Usage in a plugin IIFE:
 * ```js
 * (function() {
 *   window.__WE_PLUGIN_API__.registerPlugin('my-plugin', function(ctx) {
 *     ctx.registerMenuItem({ id: 'my-plugin:action', pluginId: 'my-plugin', ... });
 *     return function cleanup() { /* optional manual cleanup *\/ };
 *   });
 * })();
 * ```
 */

import { usePluginContribStore } from '../stores/pluginContribStore';
import type {
  ToolbarButtonContrib,
  MenuItemContrib,
  TemplateSectionContrib,
} from '../stores/pluginContribStore';

export interface PluginContext {
  registerToolbarButton(contrib: ToolbarButtonContrib): void;
  registerMenuItem(contrib: MenuItemContrib): void;
  registerTemplateSection(section: TemplateSectionContrib): void;
}

type SetupFn = (ctx: PluginContext) => (() => void) | void;

interface WePluginApi {
  registerPlugin(id: string, setup: SetupFn): void;
  unloadPlugin(id: string): void;
}

/** Cleanup functions keyed by plugin ID */
const cleanupFns = new Map<string, () => void>();

/** Install the global plugin API (idempotent) */
export function installPluginApi(): void {
  if (typeof window === 'undefined') return;
  if ((window as unknown as Record<string, unknown>)['__WE_PLUGIN_API__']) return;

  const api: WePluginApi = {
    registerPlugin(id: string, setup: SetupFn): void {
      const store = usePluginContribStore.getState();
      const ctx: PluginContext = {
        registerToolbarButton: (contrib) => store.registerToolbarButton(contrib),
        registerMenuItem: (contrib) => store.registerMenuItem(contrib),
        registerTemplateSection: (section) => store.registerTemplateSection(section),
      };
      const cleanup = setup(ctx);
      cleanupFns.set(
        id,
        cleanup ?? (() => store.unregisterPlugin(id)),
      );
    },

    unloadPlugin(id: string): void {
      const cleanup = cleanupFns.get(id);
      if (cleanup) {
        cleanup();
        cleanupFns.delete(id);
      }
    },
  };

  (window as unknown as Record<string, unknown>)['__WE_PLUGIN_API__'] = api;
}

/** Unload an external plugin via the global API */
export function unloadExternalPlugin(id: string): void {
  const api = (window as unknown as Record<string, unknown>)['__WE_PLUGIN_API__'] as WePluginApi | undefined;
  api?.unloadPlugin(id);
}
