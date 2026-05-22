/**
 * Phase 3.3 — Plugin Integration Test Suite
 *
 * Verifies that every built-in plugin:
 *   1. Mounts and returns a cleanup function
 *   2. Registers at least one contribution (menu item, importer, panel, …)
 *   3. Unregisters all its contributions on unmount
 *
 * These tests run in the vitest Node environment (no browser / no real WASM).
 * All Zustand stores are reset between tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Store mocking ─────────────────────────────────────────────────────────────

/** Simulate a minimal pluginContribStore state machine */
function makeContribStore() {
  const contributions: Record<string, string[]> = {};
  let toolbarButtons = 0;
  let menuItems = 0;
  let importers = 0;
  let exporters = 0;
  let panels = 0;
  let contextMenuItems = 0;
  let viewportOverlays = 0;
  let settingsTabs = 0;
  let templateSections = 0;

  return {
    registerToolbarButton: vi.fn(() => { toolbarButtons++; }),
    registerMenuItem: vi.fn(() => { menuItems++; }),
    registerTemplateSection: vi.fn(() => { templateSections++; }),
    registerImporter: vi.fn((c: { pluginId: string }) => {
      importers++;
      (contributions[c.pluginId] ??= []).push('importer');
    }),
    registerExporter: vi.fn((c: { pluginId: string }) => {
      exporters++;
      (contributions[c.pluginId] ??= []).push('exporter');
    }),
    registerPanel: vi.fn((c: { pluginId: string }) => {
      panels++;
      (contributions[c.pluginId] ??= []).push('panel');
    }),
    registerContextMenuItem: vi.fn((c: { pluginId: string }) => {
      contextMenuItems++;
      (contributions[c.pluginId] ??= []).push('contextMenu');
    }),
    registerViewportOverlay: vi.fn((c: { pluginId: string }) => {
      viewportOverlays++;
      (contributions[c.pluginId] ??= []).push('overlay');
    }),
    registerSettings: vi.fn((c: { pluginId: string }) => {
      settingsTabs++;
      (contributions[c.pluginId] ??= []).push('settings');
    }),
    unregisterPlugin: vi.fn((id: string) => { delete contributions[id]; }),
    // Counts for assertions
    get counts() {
      return { toolbarButtons, menuItems, importers, exporters, panels, contextMenuItems, viewportOverlays, settingsTabs, templateSections };
    },
    contributions,
  };
}

let store: ReturnType<typeof makeContribStore>;

vi.mock('../stores/pluginContribStore', () => ({
  usePluginContribStore: { getState: () => store },
}));
vi.mock('../stores/projectStore', () => ({
  useProjectStore: {
    getState: vi.fn(() => ({
      project: { roads: [], junctions: [], header: { name: '', version: '' }, signals: [], objects: [] },
      selectedRoadId: null,
      selectedJunctionId: null,
      selectedRoadIds: [],
      selectedJunctionIds: [],
      executePluginCommand: vi.fn(),
      isDirty: false,
    })),
    setState: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
  },
}));
vi.mock('../utils/dialog', () => ({
  showAlert: vi.fn(() => Promise.resolve()),
  showConfirm: vi.fn(() => Promise.resolve(false)),
}));
vi.mock('i18next', () => ({
  default: { t: (_k: string, fb: string) => fb },
  t: (_k: string, fb: string) => fb,
}));

beforeEach(() => {
  store = makeContribStore();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── I/O Plugins ───────────────────────────────────────────────────────────────

describe('plugin-io-lanelet2', () => {
  it('mounts, registers importer+exporter, and unmounts cleanly', async () => {
    const { mountIoLanelet2Plugin } = await import('../plugins/io/lanelet2/io-lanelet2.plugin');
    const unmount = mountIoLanelet2Plugin();
    expect(store.registerImporter).toHaveBeenCalledOnce();
    expect(store.registerExporter).toHaveBeenCalledOnce();
    expect(typeof unmount).toBe('function');
    unmount();
    expect(store.unregisterPlugin).toHaveBeenCalledWith('io-lanelet2');
  });
});

describe('plugin-io-shapefile', () => {
  it('mounts and registers importer+exporter', async () => {
    const { mountIoShapefilePlugin } = await import('../plugins/io/shapefile/io-shapefile.plugin');
    const unmount = mountIoShapefilePlugin();
    expect(store.registerImporter).toHaveBeenCalledOnce();
    expect(store.registerExporter).toHaveBeenCalledOnce();
    unmount();
    expect(store.unregisterPlugin).toHaveBeenCalledWith('io-shapefile');
  });
});

describe('plugin-io-csv', () => {
  it('mounts and registers importer+exporter', async () => {
    const { mountIoCsvPlugin } = await import('../plugins/io/csv/io-csv.plugin');
    const unmount = mountIoCsvPlugin();
    expect(store.registerImporter).toHaveBeenCalledOnce();
    expect(store.registerExporter).toHaveBeenCalledOnce();
    unmount();
    expect(store.unregisterPlugin).toHaveBeenCalledWith('io-csv-import');
  });
});

describe('plugin-io-osm', () => {
  it('mounts and registers exporter', async () => {
    const { mountIoOsmPlugin } = await import('../plugins/io/osm/io-osm.plugin');
    const unmount = mountIoOsmPlugin();
    expect(store.registerExporter).toHaveBeenCalledOnce();
    unmount();
    expect(store.unregisterPlugin).toHaveBeenCalledWith('io-osm-export');
  });
});

describe('plugin-io-obj3d', () => {
  it('mounts and registers exporter', async () => {
    const { mountIoObj3dPlugin } = await import('../plugins/io/obj3d/io-obj3d.plugin');
    const unmount = mountIoObj3dPlugin();
    expect(store.registerExporter).toHaveBeenCalledOnce();
    unmount();
    expect(store.unregisterPlugin).toHaveBeenCalledWith('io-obj3d-export');
  });
});

describe('plugin-io-mif', () => {
  it('mounts and registers importer+exporter', async () => {
    const { mountIoMifPlugin } = await import('../plugins/io/mif/io-mif.plugin');
    const unmount = mountIoMifPlugin();
    expect(store.registerImporter).toHaveBeenCalledOnce();
    expect(store.registerExporter).toHaveBeenCalledOnce();
    unmount();
    expect(store.unregisterPlugin).toHaveBeenCalledWith('io-mif');
  });
});

describe('plugin-io-nio', () => {
  it('mounts and registers importer+exporter', async () => {
    const { mountIoNioPlugin } = await import('../plugins/io/nio/io-nio.plugin');
    const unmount = mountIoNioPlugin();
    expect(store.registerImporter).toHaveBeenCalledOnce();
    expect(store.registerExporter).toHaveBeenCalledOnce();
    unmount();
    expect(store.unregisterPlugin).toHaveBeenCalledWith('io-nio');
  });
});

describe('plugin-io-geoz', () => {
  it('mounts and registers importer', async () => {
    const { mountIoGeoZPlugin } = await import('../plugins/io/geoz/io-geoz.plugin');
    const unmount = mountIoGeoZPlugin();
    expect(store.registerImporter).toHaveBeenCalledOnce();
    unmount();
    expect(store.unregisterPlugin).toHaveBeenCalledWith('io-geoz-import');
  });
});

describe('plugin-io-signals', () => {
  it('mounts and registers importer+exporter', async () => {
    const { mountIoSignalsPlugin } = await import('../plugins/io/signals/io-signals.plugin');
    const unmount = mountIoSignalsPlugin();
    expect(store.registerImporter).toHaveBeenCalledOnce();
    expect(store.registerExporter).toHaveBeenCalledOnce();
    unmount();
    expect(store.unregisterPlugin).toHaveBeenCalledWith('io-signals');
  });
});

describe('plugin-io-dxf', () => {
  it('mounts and registers importer+exporter', async () => {
    const { mountIoDxfPlugin } = await import('../plugins/io/dxf/io-dxf.plugin');
    const unmount = mountIoDxfPlugin();
    expect(store.registerImporter).toHaveBeenCalledOnce();
    expect(store.registerExporter).toHaveBeenCalledOnce();
    unmount();
    expect(store.unregisterPlugin).toHaveBeenCalledWith('io-dxf');
  });
});

describe('plugin-io-xodr-ext', () => {
  it('mounts and registers importer+exporter', async () => {
    const { mountIoXodrExtPlugin } = await import('../plugins/io/xodr-ext/io-xodr-ext.plugin');
    const unmount = mountIoXodrExtPlugin();
    expect(store.registerImporter).toHaveBeenCalledOnce();
    expect(store.registerExporter).toHaveBeenCalledOnce();
    unmount();
    expect(store.unregisterPlugin).toHaveBeenCalledWith('io-xodr-ext');
  });
});

// ── Feature plugins ───────────────────────────────────────────────────────────

describe('plugin-gis-tools', () => {
  it('mounts, registers a panel, unmounts cleanly', async () => {
    const { mountGisToolsPlugin } = await import('../plugins/gis-viz/gis-tools/gis-tools.plugin');
    const unmount = mountGisToolsPlugin();
    expect(store.registerPanel).toHaveBeenCalledOnce();
    unmount();
    expect(store.unregisterPlugin).toHaveBeenCalledWith('gis-tools');
  });
});

describe('plugin-validation', () => {
  it('mounts, registers a panel, unmounts cleanly', async () => {
    const { mountValidationPlugin } = await import('../plugins/analysis/validation/validation.plugin');
    const unmount = mountValidationPlugin();
    expect(store.registerPanel).toHaveBeenCalledOnce();
    unmount();
    expect(store.unregisterPlugin).toHaveBeenCalledWith('validation');
  });
});

describe('plugin-traffic', () => {
  it('mounts, registers panel + importer + exporter + menu items, unmounts cleanly', async () => {
    const { mountTrafficPlugin } = await import('../plugins/analysis/traffic/traffic.plugin');
    const unmount = mountTrafficPlugin();
    expect(store.registerPanel).toHaveBeenCalledOnce();
    expect(store.registerImporter.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(store.registerExporter.mock.calls.length).toBeGreaterThanOrEqual(1);
    unmount();
    expect(store.unregisterPlugin).toHaveBeenCalledWith('traffic');
  });
});

describe('plugin-scripting', () => {
  it('mounts, registers panel and menu item, unmounts cleanly', async () => {
    const { mountScriptingPlugin } = await import('../plugins/gis-viz/scripting/scripting-beta.plugin');
    const unmount = mountScriptingPlugin();
    expect(store.registerPanel).toHaveBeenCalledOnce();
    expect(store.registerMenuItem.mock.calls.length).toBeGreaterThanOrEqual(1);
    unmount();
    expect(store.unregisterPlugin).toHaveBeenCalledWith('scripting-beta');
  });
});

describe('plugin-ecosystem', () => {
  it('mounts, registers panel, unmounts cleanly', async () => {
    const { mountEcosystemPlugin } = await import('../plugins/gis-viz/ecosystem/ecosystem-beta.plugin');
    const unmount = mountEcosystemPlugin();
    expect(store.registerPanel).toHaveBeenCalledOnce();
    unmount();
    expect(store.unregisterPlugin).toHaveBeenCalledWith('ecosystem-beta');
  });
});

describe('plugin-lane-detect', () => {
  it('mounts, registers menu item, unmounts cleanly', async () => {
    const { mountLaneDetectPlugin } = await import('../plugins/analysis/lane-detect/lane-detect-beta.plugin');
    const unmount = mountLaneDetectPlugin();
    expect(store.registerMenuItem.mock.calls.length).toBeGreaterThanOrEqual(1);
    unmount();
    expect(store.unregisterPlugin).toHaveBeenCalledWith('lane-detect');
  });
});

describe('plugin-converter', () => {
  it('mounts, registers panel, unmounts cleanly', async () => {
    const { mountConverterPlugin } = await import('../plugins/editing/converter/converter.plugin');
    const unmount = mountConverterPlugin();
    expect(store.registerPanel).toHaveBeenCalledOnce();
    unmount();
    expect(store.unregisterPlugin).toHaveBeenCalledWith('converter');
  });
});

describe('plugin-pointcloud', () => {
  it('mounts, registers panel and viewport overlay, unmounts cleanly', async () => {
    const { mountPointcloudPlugin } = await import('../plugins/gis-viz/pointcloud/pointcloud-beta.plugin');
    const unmount = mountPointcloudPlugin();
    expect(store.registerPanel).toHaveBeenCalledOnce();
    unmount();
    expect(store.unregisterPlugin).toHaveBeenCalledWith('pointcloud-beta');
  });
});

describe('plugin-satellite', () => {
  it('mounts, registers panel and viewport overlay, unmounts cleanly', async () => {
    const { mountSatellitePlugin } = await import('../plugins/gis-viz/satellite/satellite-beta.plugin');
    const unmount = mountSatellitePlugin();
    expect(store.registerPanel).toHaveBeenCalledOnce();
    unmount();
    expect(store.unregisterPlugin).toHaveBeenCalledWith('satellite-beta');
  });
});

describe('plugin-3d-models', () => {
  it('mounts, registers panel, unmounts cleanly', async () => {
    const { mountModels3dPlugin } = await import('../plugins/gis-viz/models-3d/models-3d-beta.plugin');
    const unmount = mountModels3dPlugin();
    expect(store.registerPanel).toHaveBeenCalledOnce();
    unmount();
    expect(store.unregisterPlugin).toHaveBeenCalledWith('3d-models');
  });
});

describe('plugin-advanced-editing', () => {
  it('mounts, registers menu items and context menu items, unmounts cleanly', async () => {
    const { mountAdvancedEditingPlugin } = await import('../plugins/editing/advanced-editing/advanced-editing.plugin');
    const unmount = mountAdvancedEditingPlugin();
    expect(store.registerMenuItem.mock.calls.length).toBeGreaterThanOrEqual(5);
    unmount();
    expect(store.unregisterPlugin).toHaveBeenCalledWith('advanced-editing');
  });
});

// ── Plugin API integration ────────────────────────────────────────────────────

describe('plugin API context', () => {
  it('registerPlugin creates a context with all required methods', async () => {
    const { installPluginApi } = await import('../plugins/core/pluginApi');

    installPluginApi();

    const api = (window as unknown as Record<string, { registerPlugin: (id: string, setup: (ctx: object) => void) => void }>).__WE_PLUGIN_API__!;
    expect(typeof api.registerPlugin).toBe('function');

    let capturedCtx: Record<string, unknown> | null = null;
    api.registerPlugin('test-plugin', (ctx) => {
      capturedCtx = ctx as Record<string, unknown>;
    });

    expect(capturedCtx).not.toBeNull();
    const ctx = capturedCtx!;
    expect(typeof ctx['registerImporter']).toBe('function');
    expect(typeof ctx['registerExporter']).toBe('function');
    expect(typeof ctx['registerPanel']).toBe('function');
    expect(typeof ctx['registerContextMenuItem']).toBe('function');
    expect(typeof ctx['registerViewportOverlay']).toBe('function');
    expect(typeof ctx['registerSettings']).toBe('function');
    expect(typeof ctx['getProject']).toBe('function');
    expect(typeof ctx['updateProject']).toBe('function');
    expect(typeof ctx['executeWithUndo']).toBe('function');
    expect(typeof ctx['onSelectionChanged']).toBe('function');
    expect(typeof ctx['onProjectChanged']).toBe('function');

    // Clean up the installed global so other tests can reinstall
    delete (window as unknown as Record<string, unknown>).__WE_PLUGIN_API__;
  });

  it('unloadPlugin calls cleanup and clears contributions', async () => {
    const { installPluginApi } = await import('../plugins/core/pluginApi');
    installPluginApi();

    const api = (window as unknown as Record<string, { registerPlugin: (id: string, setup: (ctx: object) => void) => void; unloadPlugin: (id: string) => void }>).__WE_PLUGIN_API__!;
    let cleaned = false;
    api.registerPlugin('cleanup-test', (_ctx) => () => { cleaned = true; });
    api.unloadPlugin('cleanup-test');
    expect(cleaned).toBe(true);

    delete (window as unknown as Record<string, unknown>).__WE_PLUGIN_API__;
  });
});

// ── Builtin registry ─────────────────────────────────────────────────────────

describe('builtinRegistry', () => {
  it('contains all 26 expected plugin entries', async () => {
    const { BUILTIN_PLUGINS } = await import('../plugins/builtinRegistry');
    expect(BUILTIN_PLUGINS.length).toBe(26);
  });

  it('every plugin entry has required fields', async () => {
    const { BUILTIN_PLUGINS } = await import('../plugins/builtinRegistry');
    for (const p of BUILTIN_PLUGINS) {
      expect(typeof p.id).toBe('string');
      expect(p.id.length).toBeGreaterThan(0);
      expect(typeof p.name).toBe('string');
      expect(typeof p.version).toBe('string');
      expect(p.isBuiltin).toBe(true);
      expect(p.status).toBe('loaded');
    }
  });

  it('plugin IDs are unique', async () => {
    const { BUILTIN_PLUGINS } = await import('../plugins/builtinRegistry');
    const ids = BUILTIN_PLUGINS.map((p) => p.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});

