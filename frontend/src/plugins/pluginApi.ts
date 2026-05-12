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
      const contribStore = usePluginContribStore.getState();
      const ctx: PluginContext = {
        registerToolbarButton: (contrib) => contribStore.registerToolbarButton(contrib),
        registerMenuItem: (contrib) => contribStore.registerMenuItem(contrib),
        registerTemplateSection: (section) => contribStore.registerTemplateSection(section),
        registerImporter: (contrib) => usePluginContribStore.getState().registerImporter(contrib),
        registerExporter: (contrib) => usePluginContribStore.getState().registerExporter(contrib),
        registerPanel: (contrib) => usePluginContribStore.getState().registerPanel(contrib),
        registerContextMenuItem: (contrib) => usePluginContribStore.getState().registerContextMenuItem(contrib),
        registerViewportOverlay: (contrib) => usePluginContribStore.getState().registerViewportOverlay(contrib),
        registerSettings: (contrib) => usePluginContribStore.getState().registerSettings(contrib),

        getProject: () => useEditorStore.getState().project,

        updateProject: (updater) => {
          const state = useEditorStore.getState();
          const newProject = updater(state.project);
          useEditorStore.setState({ project: newProject, isDirty: true });
        },

        executeWithUndo: (description, executeFn) => {
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
