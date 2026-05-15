/**
 * Plugin API — installs `window.__WE_PLUGIN_API__` for external plugin scripts.
 *
 * External plugins (IIFE format) call `window.__WE_PLUGIN_API__.registerPlugin(id, setup)`
 * where setup receives a PluginContext and can register toolbar buttons, menu items,
 * template sections, importers, exporters, panels, context menu items, viewport overlays,
 * and settings tabs. The setup function may return a cleanup function; if it doesn't,
 * all contributions registered under that pluginId are removed automatically on unload.
 *
 * Usage in a plugin IIFE:
 * ```js
 * (function() {
 *   window.__WE_PLUGIN_API__.registerPlugin('my-plugin', function(ctx) {
 *     ctx.registerMenuItem({ id: 'my-plugin:action', pluginId: 'my-plugin', ... });
 *     ctx.registerImporter({ id: 'my-plugin:import', pluginId: 'my-plugin', ... });
 *     return function cleanup() { /* optional manual cleanup *\/ };
 *   });
 * })();
 * ```
 */

import { usePluginContribStore } from '../stores/pluginContribStore';
import { useEditorStore } from '../stores/editorStore';
import type {
  ToolbarButtonContrib,
  MenuItemContrib,
  TemplateSectionContrib,
  ImporterContrib,
  ExporterContrib,
  PanelContrib,
  ContextMenuContrib,
  ViewportOverlayContrib,
  SettingsContrib,
} from '../stores/pluginContribStore';
import type { Project } from '../services/platform';

// ── Permission system ─────────────────────────────────────────────────────────

/** Permissions that plugins can request in their manifest. */
export type PluginPermission =
  | 'project:read'
  | 'project:write'
  | 'ui:menu'
  | 'ui:panel'
  | 'ui:toolbar'
  | 'ui:overlay'
  | 'ui:settings'
  | 'ui:context-menu'
  | 'ui:templates'
  | 'io:import'
  | 'io:export';

/** All permissions — used for built-in plugins that bypass the permission check. */
export const ALL_PERMISSIONS: readonly PluginPermission[] = [
  'project:read', 'project:write',
  'ui:menu', 'ui:panel', 'ui:toolbar', 'ui:overlay', 'ui:settings', 'ui:context-menu', 'ui:templates',
  'io:import', 'io:export',
] as const;

class PluginPermissionError extends Error {
  constructor(pluginId: string, permission: PluginPermission) {
    super(`Plugin '${pluginId}' does not have '${permission}' permission`);
    this.name = 'PluginPermissionError';
  }
}

/** Guard that throws if a plugin lacks a required permission. */
function requirePermission(pluginId: string, granted: readonly PluginPermission[], required: PluginPermission): void {
  if (!granted.includes(required)) {
    throw new PluginPermissionError(pluginId, required);
  }
}

export interface PluginContext {
  // Existing contributions
  registerToolbarButton(contrib: ToolbarButtonContrib): void;
  registerMenuItem(contrib: MenuItemContrib): void;
  registerTemplateSection(section: TemplateSectionContrib): void;

  // New Phase 0 contributions
  registerImporter(contrib: ImporterContrib): void;
  registerExporter(contrib: ExporterContrib): void;
  registerPanel(contrib: PanelContrib): void;
  registerContextMenuItem(contrib: ContextMenuContrib): void;
  registerViewportOverlay(contrib: ViewportOverlayContrib): void;
  registerSettings(contrib: SettingsContrib): void;

  // Project access
  /** Read the current project snapshot */
  getProject(): Project;
  /** Apply an immutable update to the project (marks dirty, no undo entry) */
  updateProject(updater: (project: Project) => Project): void;
  /**
   * Execute a mutation with undo/redo support.
   * The executeFn receives the current project and must return the updated project.
   */
  executeWithUndo(description: string, executeFn: (project: Project) => Project): void;

  /** Subscribe to selection changes; returns an unsubscribe function */
  onSelectionChanged(callback: (selection: {
    roadId: string | null;
    junctionId: string | null;
    roadIds: string[];
    junctionIds: string[];
  }) => void): () => void;

  /** Subscribe to project changes; returns an unsubscribe function */
  onProjectChanged(callback: (project: Project) => void): () => void;
}

type SetupFn = (ctx: PluginContext) => (() => void) | void;

interface WePluginApi {
  registerPlugin(id: string, setup: SetupFn, permissions?: readonly PluginPermission[]): void;
  unloadPlugin(id: string): void;
}

/** Cleanup functions keyed by plugin ID */
const cleanupFns = new Map<string, () => void>();

/** Install the global plugin API (idempotent) */
export function installPluginApi(): void {
  if (typeof window === 'undefined') return;
  if ((window as unknown as Record<string, unknown>)['__WE_PLUGIN_API__']) return;

  const api: WePluginApi = {
    registerPlugin(id: string, setup: SetupFn, permissions?: readonly PluginPermission[]): void {
      const granted = permissions ?? ALL_PERMISSIONS;
      const contribStore = usePluginContribStore.getState();
      const ctx: PluginContext = {
        registerToolbarButton: (contrib) => {
          requirePermission(id, granted, 'ui:toolbar');
          contribStore.registerToolbarButton(contrib);
        },
        registerMenuItem: (contrib) => {
          requirePermission(id, granted, 'ui:menu');
          contribStore.registerMenuItem(contrib);
        },
        registerTemplateSection: (section) => {
          requirePermission(id, granted, 'ui:templates');
          contribStore.registerTemplateSection(section);
        },
        registerImporter: (contrib) => {
          requirePermission(id, granted, 'io:import');
          usePluginContribStore.getState().registerImporter(contrib);
        },
        registerExporter: (contrib) => {
          requirePermission(id, granted, 'io:export');
          usePluginContribStore.getState().registerExporter(contrib);
        },
        registerPanel: (contrib) => {
          requirePermission(id, granted, 'ui:panel');
          usePluginContribStore.getState().registerPanel(contrib);
        },
        registerContextMenuItem: (contrib) => {
          requirePermission(id, granted, 'ui:context-menu');
          usePluginContribStore.getState().registerContextMenuItem(contrib);
        },
        registerViewportOverlay: (contrib) => {
          requirePermission(id, granted, 'ui:overlay');
          usePluginContribStore.getState().registerViewportOverlay(contrib);
        },
        registerSettings: (contrib) => {
          requirePermission(id, granted, 'ui:settings');
          usePluginContribStore.getState().registerSettings(contrib);
        },

        getProject: () => {
          requirePermission(id, granted, 'project:read');
          return useEditorStore.getState().project;
        },

        updateProject: (updater) => {
          requirePermission(id, granted, 'project:write');
          const state = useEditorStore.getState();
          const newProject = updater(state.project);
          useEditorStore.setState({ project: newProject, isDirty: true });
        },

        executeWithUndo: (description, executeFn) => {
          requirePermission(id, granted, 'project:write');
          useEditorStore.getState().executePluginCommand(description, executeFn);
        },

        onSelectionChanged: (callback) => {
          return useEditorStore.subscribe((state) => {
            callback({
              roadId: state.selectedRoadId,
              junctionId: state.selectedJunctionId,
              roadIds: state.selectedRoadIds,
              junctionIds: state.selectedJunctionIds,
            });
          });
        },

        onProjectChanged: (callback) => {
          return useEditorStore.subscribe((state) => {
            callback(state.project);
          });
        },
      };

      const cleanup = setup(ctx);
      cleanupFns.set(
        id,
        cleanup ?? (() => usePluginContribStore.getState().unregisterPlugin(id)),
      );
    },

    unloadPlugin(id: string): void {
      const cleanup = cleanupFns.get(id);
      if (cleanup) {
        cleanup();
        cleanupFns.delete(id);
      }
      // Always ensure contributions are cleaned up even if plugin provided custom cleanup
      usePluginContribStore.getState().unregisterPlugin(id);
    },
  };

  (window as unknown as Record<string, unknown>)['__WE_PLUGIN_API__'] = api;
}

/** Unload an external plugin via the global API */
export function unloadExternalPlugin(id: string): void {
  const api = (window as unknown as Record<string, unknown>)['__WE_PLUGIN_API__'] as WePluginApi | undefined;
  api?.unloadPlugin(id);
}
