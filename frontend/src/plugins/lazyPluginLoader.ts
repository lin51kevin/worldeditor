/**
 * Lazy plugin loader — dynamically imports plugin modules on demand
 * instead of loading all 27 plugins synchronously at startup.
 *
 * Core plugins (road-tools, templates, advanced-editing) are loaded eagerly
 * since they are needed immediately. All other plugins load when first accessed.
 *
 * Usage:
 *   const cleanup = await lazyMountPlugin('io-csv-import');
 *   // later: cleanup();
 */

/** Plugin IDs that should be loaded eagerly at startup (critical for UX). */
const EAGER_PLUGINS = new Set([
  'road-tools',
  'builtin-templates',
  'advanced-editing',
  'shape-editor',
  'validation',
]);

/** Map of plugin ID → dynamic import factory.
 * Each factory returns a module with a mount function. */
const LAZY_IMPORT_MAP: Record<string, () => Promise<{ mount: () => () => void }>> = {
  'road-tools': () => import('./editing/road-tools/road-tools.plugin').then(m => ({ mount: m.mountRoadToolsPlugin })),
  'builtin-templates': () => import('./editing/templates/templates.plugin').then(m => ({ mount: m.mountTemplatesPlugin })),
  'advanced-editing': () => import('./editing/advanced-editing/advanced-editing.plugin').then(m => ({ mount: m.mountAdvancedEditingPlugin })),
  'shape-editor': () => import('./editing/shape-editor/shape-editor.plugin').then(m => ({ mount: m.mountShapeEditorPlugin })),
  'converter': () => import('./editing/converter/converter.plugin').then(m => ({ mount: m.mountConverterPlugin })),
  'ai-copilot': () => import('./editing/ai-copilot/ai-copilot.plugin').then(m => ({ mount: m.mountAiCopilotPlugin })),
  'io-csv-import': () => import('./io/csv/io-csv.plugin').then(m => ({ mount: m.mountIoCsvPlugin })),
  'io-obj3d-export': () => import('./io/obj3d/io-obj3d.plugin').then(m => ({ mount: m.mountIoObj3dPlugin })),
  'io-lanelet2': () => import('./io/lanelet2/io-lanelet2.plugin').then(m => ({ mount: m.mountIoLanelet2Plugin })),
  'io-shapefile': () => import('./io/shapefile/io-shapefile.plugin').then(m => ({ mount: m.mountIoShapefilePlugin })),
  'io-dxf': () => import('./io/dxf/io-dxf.plugin').then(m => ({ mount: m.mountIoDxfPlugin })),
  'io-nio': () => import('./io/nio/io-nio.plugin').then(m => ({ mount: m.mountIoNioPlugin })),
  'io-geoz-import': () => import('./io/geoz/io-geoz.plugin').then(m => ({ mount: m.mountIoGeoZPlugin })),
  'io-mif': () => import('./io/mif/io-mif.plugin').then(m => ({ mount: m.mountIoMifPlugin })),
  'io-osm-export': () => import('./io/osm/io-osm.plugin').then(m => ({ mount: m.mountIoOsmPlugin })),
  'io-signals': () => import('./io/signals/io-signals.plugin').then(m => ({ mount: m.mountIoSignalsPlugin })),
  'io-xodr-ext': () => import('./io/xodr-ext/io-xodr-ext.plugin').then(m => ({ mount: m.mountIoXodrExtPlugin })),
  'gis-tools': () => import('./gis-viz/gis-tools/gis-tools.plugin').then(m => ({ mount: m.mountGisToolsPlugin })),
  'validation': () => import('./analysis/validation/validation.plugin').then(m => ({ mount: m.mountValidationPlugin })),
  'traffic': () => import('./analysis/traffic/traffic.plugin').then(m => ({ mount: m.mountTrafficPlugin })),
  'lane-detect': () => import('./analysis/lane-detect/lane-detect-beta.plugin').then(m => ({ mount: m.mountLaneDetectPlugin })),
  'pointcloud-beta': () => import('./gis-viz/pointcloud/pointcloud-beta.plugin').then(m => ({ mount: m.mountPointcloudPlugin })),
  'satellite-beta': () => import('./gis-viz/satellite/satellite-beta.plugin').then(m => ({ mount: m.mountSatellitePlugin })),
  '3d-models': () => import('./gis-viz/models-3d/models-3d-beta.plugin').then(m => ({ mount: m.mountModels3dPlugin })),
  'scripting-beta': () => import('./gis-viz/scripting/scripting-beta.plugin').then(m => ({ mount: m.mountScriptingPlugin })),
  'ecosystem-beta': () => import('./gis-viz/ecosystem/ecosystem-beta.plugin').then(m => ({ mount: m.mountEcosystemPlugin })),
};

/** Cache of loaded plugins: id → cleanup function */
const loadedPlugins = new Map<string, () => void>();

/** Cache of in-flight loading promises to prevent duplicate imports. */
const loadingPromises = new Map<string, Promise<() => void>>();

/**
 * Mount a single plugin by ID. Lazily imports the module on first call.
 * Returns the cleanup function. Subsequent calls for the same plugin are no-ops.
 */
export async function lazyMountPlugin(id: string): Promise<() => void> {
  // Already loaded
  if (loadedPlugins.has(id)) {
    return loadedPlugins.get(id)!;
  }

  // Already loading
  if (loadingPromises.has(id)) {
    return loadingPromises.get(id)!;
  }

  const importFn = LAZY_IMPORT_MAP[id];
  if (!importFn) {
    console.warn(`[PluginLoader] Unknown plugin id: ${id}`);
    return () => {};
  }

  const promise = importFn().then(({ mount }) => {
    const cleanup = mount();
    loadedPlugins.set(id, cleanup);
    loadingPromises.delete(id);
    return cleanup;
  }).catch((err) => {
    console.error(`[PluginLoader] Failed to load plugin "${id}":`, err);
    loadingPromises.delete(id);
    return () => {};
  });

  loadingPromises.set(id, promise);
  return promise;
}

/**
 * Unmount a specific plugin by ID.
 */
export function unmountPlugin(id: string): void {
  const cleanup = loadedPlugins.get(id);
  if (cleanup) {
    cleanup();
    loadedPlugins.delete(id);
  }
}

/**
 * Mount all eager plugins immediately, defer non-eager to idle callback.
 * Returns a cleanup function that unmounts all plugins.
 */
export async function mountAllPlugins(): Promise<() => void> {
  // Phase 1: Mount eager plugins immediately
  const eagerPromises = Array.from(EAGER_PLUGINS).map((id) => lazyMountPlugin(id));
  await Promise.all(eagerPromises);

  // Phase 2: Mount remaining plugins during idle time
  const deferredIds = Object.keys(LAZY_IMPORT_MAP).filter((id) => !EAGER_PLUGINS.has(id));

  const mountDeferred = () => {
    for (const id of deferredIds) {
      void lazyMountPlugin(id);
    }
  };

  if ('requestIdleCallback' in globalThis) {
    (globalThis as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(mountDeferred);
  } else {
    setTimeout(mountDeferred, 100);
  }

  // Return master cleanup
  return () => {
    for (const [_id, cleanup] of loadedPlugins) {
      cleanup();
    }
    loadedPlugins.clear();
    loadingPromises.clear();
  };
}

/** Check if a plugin is currently loaded. */
export function isPluginLoaded(id: string): boolean {
  return loadedPlugins.has(id);
}

/** Get all plugin IDs that should be loaded eagerly. */
export function getEagerPluginIds(): ReadonlySet<string> {
  return EAGER_PLUGINS;
}
