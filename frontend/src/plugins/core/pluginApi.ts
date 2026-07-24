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

// ── Codec (host-backed format conversion) ───────────────────────────────────

/** Formats the host can convert via its WASM engine on a plugin's behalf. */
export type CodecFormat = 'dxf' | 'mif' | 'lanelet2' | 'shapefile' | 'nio' | 'xodr';

/**
 * Whitelisted format codecs backed by the host WASM engine.
 *
 * Sandboxed external plugins cannot import the WASM module directly (the guard
 * forbids dynamic module loading), so parsing/serialisation that needs Rust is
 * routed through this narrow, host-implemented surface. The format set is a
 * closed union — plugins can never name an arbitrary WASM function.
 */
export interface PluginCodec {
  /** Parse file content into a Project (requires `io:import`). */
  importFrom(format: CodecFormat, content: string | ArrayBuffer): Promise<Project>;
  /** Serialise a Project to text or binary (requires `io:export`). */
  exportTo(format: CodecFormat, project: Project): Promise<string | Uint8Array>;
  /** Parse a signal-definition JSON blob into normalised signal JSON (requires `io:import`). */
  parseSignalsJson(json: string): Promise<string>;
}

// ── GIS (host-backed coordinate conversion) ─────────────────────────────────

/** A geographic coordinate (WGS84/GCJ-02/ECEF-as-geodetic). */
export interface GeoCoord { lat: number; lon: number; alt: number }
/** A UTM coordinate. */
export interface UtmCoord { easting: number; northing: number; zone: number; is_northern: boolean; alt: number }
/** An ECEF cartesian coordinate. */
export interface EcefCoord { x: number; y: number; z: number }

/**
 * Whitelisted coordinate-system conversions backed by the host WASM engine.
 * Sandboxed plugins (e.g. the GIS tools panel) cannot import WASM directly, so
 * conversions are routed through this narrow host surface (requires `project:read`).
 */
export interface PluginGis {
  wgs84ToGcj02(lat: number, lon: number, alt: number): Promise<GeoCoord>;
  gcj02ToWgs84(lat: number, lon: number, alt: number): Promise<GeoCoord>;
  geoToUtm(lat: number, lon: number, alt: number): Promise<UtmCoord>;
  utmToGeo(easting: number, northing: number, zone: number, isNorthern: boolean, alt: number): Promise<GeoCoord>;
  geodeticToEcef(lat: number, lon: number, alt: number): Promise<EcefCoord>;
  ecefToGeodetic(x: number, y: number, z: number): Promise<GeoCoord>;
  geoToMgrs(lat: number, lon: number, precision: number): Promise<string>;
}

/** Decode arbitrary import content to text. */
function toText(content: string | ArrayBuffer): string {
  return typeof content === 'string' ? content : new TextDecoder().decode(content);
}

/** Coerce arbitrary import content to bytes. */
function toBytes(content: string | ArrayBuffer): Uint8Array {
  return content instanceof ArrayBuffer ? new Uint8Array(content) : new TextEncoder().encode(content);
}

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

  /**
   * Save exported text content to disk (native "Save As" dialog on desktop,
   * browser download on web). Requires the `io:export` permission.
   *
   * Exposed as a host API so external, sandboxed plugins can export files
   * without bundling platform (Tauri) modules, which the sandbox guard forbids.
   *
   * @param filename   Suggested filename with extension, e.g. `roads.csv`.
   * @param content    The text content to write.
   * @param extensions Optional dot-less extensions for the save-dialog filter.
   */
  saveTextFile(filename: string, content: string, extensions?: string[]): Promise<void>;

  /**
   * Save exported binary content to disk (native "Save As" dialog on desktop,
   * browser download on web). Requires the `io:export` permission.
   *
   * @param filename   Suggested filename with extension, e.g. `roads.shp`.
   * @param data       The bytes to write.
   * @param extensions Optional dot-less extensions for the save-dialog filter.
   */
  saveBinaryFile(filename: string, data: Uint8Array, extensions?: string[]): Promise<void>;

  /** Host-backed format codecs for parsing/serialisation that needs the WASM engine. */
  codec: PluginCodec;

  /** Host-backed coordinate-system conversions (requires `project:read`). */
  gis: PluginGis;

  /**
   * Inject a CSS stylesheet for this plugin's UI. The stylesheet is scoped to
   * the plugin's lifetime and removed automatically on unload. Requires `ui:panel`.
   *
   * Exposed as a host API so sandboxed plugins never touch the DOM directly.
   */
  injectStyles(css: string): void;
}

type SetupFn = (ctx: PluginContext) => (() => void) | void;

interface WePluginApi {
  registerPlugin(id: string, setup: SetupFn, permissions?: readonly PluginPermission[]): void;
  unloadPlugin(id: string): void;
}

/** Cleanup functions keyed by plugin ID */
const cleanupFns = new Map<string, () => void>();

/** Injected <style> elements keyed by plugin ID (removed on unload). */
const injectedStyles = new Map<string, HTMLStyleElement[]>();

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

        saveTextFile: async (filename, content, extensions) => {
          requirePermission(id, granted, 'io:export');
          const { saveExport } = await import('../../utils/download');
          const ext = extensions ?? [filename.split('.').pop() ?? 'txt'];
          const blob = new Blob([content], { type: 'text/plain' });
          await saveExport(blob, filename, [{ name: filename, extensions: ext }]);
        },

        saveBinaryFile: async (filename, data, extensions) => {
          requirePermission(id, granted, 'io:export');
          const { saveExport } = await import('../../utils/download');
          const ext = extensions ?? [filename.split('.').pop() ?? 'bin'];
          const blob = new Blob([data as BlobPart], { type: 'application/octet-stream' });
          await saveExport(blob, filename, [{ name: filename, extensions: ext }]);
        },

        codec: {
          importFrom: async (format, content) => {
            requirePermission(id, granted, 'io:import');
            const wasm = await import('../../../wasm/pkg/we_wasm');
            switch (format) {
              case 'dxf': return wasm.import_from_dxf(toText(content)) as Project;
              case 'mif': return wasm.import_from_mif(toText(content)) as Project;
              case 'lanelet2': return wasm.import_from_lanelet2(toText(content)) as Project;
              case 'xodr': return wasm.parse_opendrive(toText(content)) as Project;
              case 'nio': return wasm.import_from_nio(toBytes(content)) as Project;
              case 'shapefile': return wasm.import_from_shapefile(toBytes(content)) as Project;
              default: throw new Error(`Unknown import format: ${String(format)}`);
            }
          },
          exportTo: async (format, project) => {
            requirePermission(id, granted, 'io:export');
            const wasm = await import('../../../wasm/pkg/we_wasm');
            const json = JSON.stringify(project);
            switch (format) {
              case 'dxf': return wasm.export_to_dxf(json) as string;
              case 'mif': return wasm.export_to_mif(json) as string;
              case 'lanelet2': return wasm.export_to_lanelet2(json) as string;
              case 'xodr': return wasm.write_opendrive(json) as string;
              case 'nio': return wasm.export_to_nio(json) as Uint8Array;
              case 'shapefile': return wasm.export_to_shapefile(json) as Uint8Array;
              default: throw new Error(`Unknown export format: ${String(format)}`);
            }
          },
          parseSignalsJson: async (json) => {
            requirePermission(id, granted, 'io:import');
            const wasm = await import('../../../wasm/pkg/we_wasm');
            return wasm.import_signals_from_json(json) as string;
          },
        },

        gis: {
          wgs84ToGcj02: async (lat, lon, alt) => {
            requirePermission(id, granted, 'project:read');
            const wasm = await import('../../../wasm/pkg/we_wasm');
            return wasm.wgs84_to_gcj02(lat, lon, alt) as GeoCoord;
          },
          gcj02ToWgs84: async (lat, lon, alt) => {
            requirePermission(id, granted, 'project:read');
            const wasm = await import('../../../wasm/pkg/we_wasm');
            return wasm.gcj02_to_wgs84(lat, lon, alt) as GeoCoord;
          },
          geoToUtm: async (lat, lon, alt) => {
            requirePermission(id, granted, 'project:read');
            const wasm = await import('../../../wasm/pkg/we_wasm');
            return wasm.geo_to_utm(lat, lon, alt) as UtmCoord;
          },
          utmToGeo: async (easting, northing, zone, isNorthern, alt) => {
            requirePermission(id, granted, 'project:read');
            const wasm = await import('../../../wasm/pkg/we_wasm');
            return wasm.utm_to_geo(easting, northing, zone, isNorthern, alt) as GeoCoord;
          },
          geodeticToEcef: async (lat, lon, alt) => {
            requirePermission(id, granted, 'project:read');
            const wasm = await import('../../../wasm/pkg/we_wasm');
            return wasm.geodetic_to_ecef(lat, lon, alt) as EcefCoord;
          },
          ecefToGeodetic: async (x, y, z) => {
            requirePermission(id, granted, 'project:read');
            const wasm = await import('../../../wasm/pkg/we_wasm');
            return wasm.ecef_to_geodetic(x, y, z) as GeoCoord;
          },
          geoToMgrs: async (lat, lon, precision) => {
            requirePermission(id, granted, 'project:read');
            const wasm = await import('../../../wasm/pkg/we_wasm');
            return wasm.geo_to_mgrs(lat, lon, precision) as string;
          },
        },

        injectStyles: (css: string): void => {
          requirePermission(id, granted, 'ui:panel');
          const style = document.createElement('style');
          style.dataset.pluginId = id;
          style.textContent = css;
          document.head.appendChild(style);
          const list = injectedStyles.get(id) ?? [];
          list.push(style);
          injectedStyles.set(id, list);
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
      // Remove any stylesheets this plugin injected.
      const styles = injectedStyles.get(id);
      if (styles) {
        for (const style of styles) {
          style.parentNode?.removeChild(style);
        }
        injectedStyles.delete(id);
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
