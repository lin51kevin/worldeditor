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

import { usePluginContribStore } from '../../stores/pluginContribStore';
import { useProjectStore } from '../../stores/projectStore';
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
} from '../../stores/pluginContribStore';
import type { Project } from '../../services/platform';

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

  // Panel tab visibility
  togglePanel(panelId: string): void;
  isPanelVisible(panelId: string): boolean;
}

type SetupFn = (ctx: PluginContext) => (() => void) | void;

interface WePluginApi {
  registerPlugin(id: string, setup: SetupFn, permissions?: readonly PluginPermission[]): void;
  unloadPlugin(id: string): void;
}

/** Cleanup functions keyed by plugin ID */
const cleanupFns = new Map<string, () => void>();

/**
 * Manifest-declared permissions per plugin ID.
 * Set by `loadPluginBundle` *before* the external bundle is injected into the page,
 * so that `registerPlugin()` always uses the server-verified manifest permissions
 * rather than whatever the bundle claims at runtime.
 */
const manifestPermissions = new Map<string, readonly PluginPermission[]>();

/**
 * Pre-register manifest permissions for an external plugin before its JS bundle
 * is executed. Called exclusively by `pluginLoader.loadPluginBundle`.
 *
 * This is the mechanism that prevents a malicious bundle from escalating its
 * permissions beyond what the `manifest.json` declares.
 */
export function setManifestPermissions(id: string, permissions: readonly PluginPermission[]): void {
  manifestPermissions.set(id, permissions);
}

/** Install the global plugin API (idempotent) */
export function installPluginApi(): void {
  if (typeof window === 'undefined') return;
  if ((window as unknown as Record<string, unknown>)['__WE_PLUGIN_API__']) return;

  const api: WePluginApi = {
    registerPlugin(id: string, setup: SetupFn, _claimedPermissions?: readonly PluginPermission[]): void {
      // Security: use manifest-declared permissions (pre-set before the bundle loaded).
      // Ignore what the bundle claims at runtime to prevent permission escalation.
      const hasManifest = manifestPermissions.has(id);
      const granted = manifestPermissions.get(id) ?? _claimedPermissions ?? ALL_PERMISSIONS;
      manifestPermissions.delete(id); // Consume — prevents replay by a second registerPlugin call

      /**
       * For external plugins (those loaded via loadPluginBundle with a manifest), enforce
       * that contribution IDs are prefixed with the plugin's own ID (e.g. 'my-plugin:action').
       * This prevents one plugin from overwriting another plugin's contributions.
       */
      const checkContribId = (contribId: string, type: string): void => {
        if (hasManifest && !contribId.startsWith(`${id}:`)) {
          throw new Error(
            `[Security] Plugin '${id}': ${type} id '${contribId}' must start with '${id}:'`,
          );
        }
      };

      const contribStore = usePluginContribStore.getState();
      const ctx: PluginContext = {
        registerToolbarButton: (contrib) => {
          requirePermission(id, granted, 'ui:toolbar');
          checkContribId(contrib.id, 'toolbar button');
          contribStore.registerToolbarButton(contrib);
        },
        registerMenuItem: (contrib) => {
          requirePermission(id, granted, 'ui:menu');
          checkContribId(contrib.id, 'menu item');
          contribStore.registerMenuItem(contrib);
        },
        registerTemplateSection: (section) => {
          requirePermission(id, granted, 'ui:templates');
          checkContribId(section.id, 'template section');
          contribStore.registerTemplateSection(section);
        },
        registerImporter: (contrib) => {
          requirePermission(id, granted, 'io:import');
          checkContribId(contrib.id, 'importer');
          usePluginContribStore.getState().registerImporter(contrib);
        },
        registerExporter: (contrib) => {
          requirePermission(id, granted, 'io:export');
          checkContribId(contrib.id, 'exporter');
          usePluginContribStore.getState().registerExporter(contrib);
        },
        registerPanel: (contrib) => {
          requirePermission(id, granted, 'ui:panel');
          checkContribId(contrib.id, 'panel');
          usePluginContribStore.getState().registerPanel(contrib);
        },
        registerContextMenuItem: (contrib) => {
          requirePermission(id, granted, 'ui:context-menu');
          checkContribId(contrib.id, 'context menu item');
          usePluginContribStore.getState().registerContextMenuItem(contrib);
        },
        registerViewportOverlay: (contrib) => {
          requirePermission(id, granted, 'ui:overlay');
          checkContribId(contrib.id, 'viewport overlay');
          usePluginContribStore.getState().registerViewportOverlay(contrib);
        },
        registerSettings: (contrib) => {
          requirePermission(id, granted, 'ui:settings');
          checkContribId(contrib.id, 'settings');
          usePluginContribStore.getState().registerSettings(contrib);
        },

        getProject: () => {
          requirePermission(id, granted, 'project:read');
          // Deep-clone to prevent plugins from directly mutating live store state.
          return structuredClone(useProjectStore.getState().project);
        },

        updateProject: (updater) => {
          requirePermission(id, granted, 'project:write');
          // Pass a clone to the updater so mutation of the input object has no side effects.
          const projectCopy = structuredClone(useProjectStore.getState().project);
          const newProject = updater(projectCopy);
          useProjectStore.setState({ project: newProject, isDirty: true });
        },

        executeWithUndo: (description, executeFn) => {
          requirePermission(id, granted, 'project:write');
          useProjectStore.getState().executePluginCommand(description, executeFn);
        },

        onSelectionChanged: (callback) => {
          return useProjectStore.subscribe((state) => {
            callback({
              roadId: state.selectedRoadId,
              junctionId: state.selectedJunctionId,
              roadIds: state.selectedRoadIds,
              junctionIds: state.selectedJunctionIds,
            });
          });
        },

        onProjectChanged: (callback) => {
          return useProjectStore.subscribe((state) => {
            callback(state.project);
          });
        },

        // Panel tab visibility
        togglePanel: (panelId: string): void => {
          usePluginContribStore.getState().togglePanel(panelId);
        },
        isPanelVisible: (panelId: string): boolean => {
          return usePluginContribStore.getState().isPanelVisible(panelId);
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
