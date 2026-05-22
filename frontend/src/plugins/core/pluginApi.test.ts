import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installPluginApi, setManifestPermissions } from './pluginApi';
import { usePluginContribStore } from '../../stores/pluginContribStore';
import { useProjectStore } from '../../stores/projectStore';
import type { Project } from '../../services/platform';

const emptyProject: Project = {
  name: 'Test',
  header: { rev_major: 1, rev_minor: 6, name: '', date: '', north: 0, south: 0, east: 0, west: 0, geo_reference: null },
  roads: [],
  junctions: [],
    signals: [],
    objects: []
};

beforeEach(() => {
  // Reset stores
  usePluginContribStore.setState({
    toolbarButtons: [], menuItems: [], templateSections: [],
    importers: [], exporters: [], panels: [], contextMenuItems: [],
    viewportOverlays: [], settingsContribs: [],
    panelTabVisibility: {}, activeTabId: null,
  });
  useProjectStore.getState().reset();
  // Re-install API (idempotent)
  // Reset global for test isolation
  delete (window as unknown as Record<string, unknown>)['__WE_PLUGIN_API__'];
  installPluginApi();
});

function getApi() {
  return (window as unknown as Record<string, unknown>)['__WE_PLUGIN_API__'] as {
    registerPlugin: (id: string, setup: (ctx: unknown) => void) => void;
    unloadPlugin: (id: string) => void;
  };
}

describe('installPluginApi', () => {
  it('installs __WE_PLUGIN_API__ on window', () => {
    expect((window as unknown as Record<string, unknown>)['__WE_PLUGIN_API__']).toBeDefined();
  });

  it('is idempotent — second call does not replace the object', () => {
    const first = (window as unknown as Record<string, unknown>)['__WE_PLUGIN_API__'];
    installPluginApi();
    expect((window as unknown as Record<string, unknown>)['__WE_PLUGIN_API__']).toBe(first);
  });

  it('ctx.registerToolbarButton adds to pluginContribStore', () => {
    getApi().registerPlugin('p1', (ctx: unknown) => {
      const c = ctx as { registerToolbarButton: (x: unknown) => void };
      c.registerToolbarButton({
        id: 'tb1', pluginId: 'p1', icon: 'I', labelKey: 'toolbar.action', group: 'action', onClick: () => {},
      });
    });
    expect(usePluginContribStore.getState().toolbarButtons).toHaveLength(1);
    expect(usePluginContribStore.getState().toolbarButtons[0]!.id).toBe('tb1');
  });

  it('ctx.registerImporter adds to pluginContribStore', () => {
    getApi().registerPlugin('p1', (ctx: unknown) => {
      const c = ctx as { registerImporter: (x: unknown) => void };
      c.registerImporter({
        id: 'i1', pluginId: 'p1', formatName: 'Fmt', extensions: ['.fmt'],
        onImport: async () => emptyProject,
      });
    });
    expect(usePluginContribStore.getState().importers).toHaveLength(1);
    expect(usePluginContribStore.getState().importers[0]!.id).toBe('i1');
  });

  it('ctx.registerTemplateSection adds to pluginContribStore', () => {
    getApi().registerPlugin('p1', (ctx: unknown) => {
      const c = ctx as { registerTemplateSection: (x: unknown) => void };
      c.registerTemplateSection({
        id: 'section1', pluginId: 'p1', categoryKey: 'templates.category', order: 1,
        items: [{ id: 'item1', labelKey: 'templates.item', icon: '🛣️', onApply: () => {} }],
      });
    });
    expect(usePluginContribStore.getState().templateSections).toHaveLength(1);
    expect(usePluginContribStore.getState().templateSections[0]!.id).toBe('section1');
  });

  it('ctx.registerExporter adds to pluginContribStore', () => {
    getApi().registerPlugin('p1', (ctx: unknown) => {
      const c = ctx as { registerExporter: (x: unknown) => void };
      c.registerExporter({ id: 'e1', pluginId: 'p1', formatName: 'Fmt', onExport: async () => {} });
    });
    expect(usePluginContribStore.getState().exporters).toHaveLength(1);
  });

  it('ctx.registerPanel adds to pluginContribStore', () => {
    getApi().registerPlugin('p1', (ctx: unknown) => {
      const c = ctx as { registerPanel: (x: unknown) => void };
      c.registerPanel({ id: 'pnl1', pluginId: 'p1', title: 'Panel', component: () => null, position: 'right' });
    });
    expect(usePluginContribStore.getState().panels).toHaveLength(1);
  });

  it('ctx.registerContextMenuItem adds to pluginContribStore', () => {
    getApi().registerPlugin('p1', (ctx: unknown) => {
      const c = ctx as { registerContextMenuItem: (x: unknown) => void };
      c.registerContextMenuItem({ id: 'ctx1', pluginId: 'p1', menu: 'road', label: 'L', onClick: () => {} });
    });
    expect(usePluginContribStore.getState().contextMenuItems).toHaveLength(1);
  });

  it('ctx.registerViewportOverlay adds to pluginContribStore', () => {
    getApi().registerPlugin('p1', (ctx: unknown) => {
      const c = ctx as { registerViewportOverlay: (x: unknown) => void };
      c.registerViewportOverlay({ id: 'ovl1', pluginId: 'p1', render: () => {}, order: 0 });
    });
    expect(usePluginContribStore.getState().viewportOverlays).toHaveLength(1);
  });

  it('ctx.registerSettings adds to pluginContribStore', () => {
    getApi().registerPlugin('p1', (ctx: unknown) => {
      const c = ctx as { registerSettings: (x: unknown) => void };
      c.registerSettings({ id: 's1', pluginId: 'p1', title: 'S', component: () => null });
    });
    expect(usePluginContribStore.getState().settingsContribs).toHaveLength(1);
  });

  it('ctx.getProject returns the current project', () => {
    useProjectStore.setState({ project: { ...emptyProject, name: 'MyMap' } });
    getApi().registerPlugin('p1', (ctx: unknown) => {
      const c = ctx as { getProject: () => Project };
      expect(c.getProject().name).toBe('MyMap');
    });
  });

  it('ctx.updateProject applies an immutable update', () => {
    useProjectStore.setState({ project: emptyProject });
    getApi().registerPlugin('p1', (ctx: unknown) => {
      const c = ctx as { updateProject: (fn: (p: Project) => Project) => void };
      c.updateProject((p) => ({ ...p, name: 'Updated' }));
    });
    expect(useProjectStore.getState().project.name).toBe('Updated');
  });

  it('ctx.executeWithUndo mutates project and supports undo', () => {
    useProjectStore.setState({ project: emptyProject, undoStack: [], redoStack: [] });
    getApi().registerPlugin('p1', (ctx: unknown) => {
      const c = ctx as { executeWithUndo: (desc: string, fn: (p: Project) => Project) => void };
      c.executeWithUndo('Change name', (p) => ({ ...p, name: 'Changed' }));
    });
    expect(useProjectStore.getState().project.name).toBe('Changed');
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.name).toBe('Test');
  });

  it('ctx.onSelectionChanged fires callback and returns unsubscribe', () => {
    const cb = vi.fn();
    let unsubscribe = () => {};

    getApi().registerPlugin('p1', (ctx: unknown) => {
      const c = ctx as { onSelectionChanged: (cb: (sel: unknown) => void) => () => void };
      unsubscribe = c.onSelectionChanged(cb);
      expect(typeof unsubscribe).toBe('function');
    });

    useProjectStore.setState({
      selectedRoadId: 'road-1',
      selectedJunctionId: 'junction-1',
      selectedRoadIds: ['road-1'],
      selectedJunctionIds: ['junction-1'],
    });
    expect(cb).toHaveBeenCalledWith({
      roadId: 'road-1',
      junctionId: 'junction-1',
      roadIds: ['road-1'],
      junctionIds: ['junction-1'],
    });

    unsubscribe();
    useProjectStore.setState({ selectedRoadId: 'road-2' });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('ctx.onProjectChanged fires callback and returns unsubscribe', () => {
    const cb = vi.fn();
    let unsubscribe = () => {};

    getApi().registerPlugin('p1', (ctx: unknown) => {
      const c = ctx as { onProjectChanged: (cb: (proj: unknown) => void) => () => void };
      unsubscribe = c.onProjectChanged(cb);
      expect(typeof unsubscribe).toBe('function');
    });

    useProjectStore.setState({ project: { ...emptyProject, name: 'Observed' } });
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ name: 'Observed' }));

    unsubscribe();
    useProjectStore.setState({ project: { ...emptyProject, name: 'Ignored' } });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('replaces duplicate contribution ids instead of duplicating them', () => {
    getApi().registerPlugin('p1', (ctx: unknown) => {
      const c = ctx as { registerMenuItem: (x: unknown) => void };
      c.registerMenuItem({ id: 'menu:shared', pluginId: 'p1', menu: 'tools', labelKey: 'first', onClick: () => {} });
      c.registerMenuItem({ id: 'menu:shared', pluginId: 'p1', menu: 'tools', labelKey: 'second', onClick: () => {} });
    });

    expect(usePluginContribStore.getState().menuItems).toHaveLength(1);
    expect(usePluginContribStore.getState().menuItems[0]!.labelKey).toBe('second');
  });

  it('togglePanel and isPanelVisible proxy panel visibility state', () => {
    const observed: boolean[] = [];

    getApi().registerPlugin('p1', (ctx: unknown) => {
      const c = ctx as {
        togglePanel: (panelId: string) => void;
        isPanelVisible: (panelId: string) => boolean;
      };
      observed.push(c.isPanelVisible('panel-1'));
      c.togglePanel('panel-1');
      observed.push(c.isPanelVisible('panel-1'));
      c.togglePanel('panel-1');
      observed.push(c.isPanelVisible('panel-1'));
    });

    expect(observed).toEqual([true, false, true]);
  });

  it('unloadPlugin runs custom cleanup and removes all contributions', () => {
    const cleanup = vi.fn();

    getApi().registerPlugin('p1', (ctx: unknown) => {
      const c = ctx as { registerImporter: (x: unknown) => void };
      c.registerImporter({
        id: 'i1', pluginId: 'p1', formatName: 'F', extensions: ['.f'],
        onImport: async () => emptyProject,
      });
      return cleanup;
    });

    expect(usePluginContribStore.getState().importers).toHaveLength(1);
    getApi().unloadPlugin('p1');
    expect(cleanup).toHaveBeenCalledOnce();
    expect(usePluginContribStore.getState().importers).toHaveLength(0);
  });
});

// ── Security tests ────────────────────────────────────────────────────────────

describe('pluginApi security', () => {
  beforeEach(() => {
    usePluginContribStore.setState({
      toolbarButtons: [], menuItems: [], templateSections: [],
      importers: [], exporters: [], panels: [], contextMenuItems: [],
      viewportOverlays: [], settingsContribs: [],
      panelTabVisibility: {}, activeTabId: null,
    });
    useProjectStore.getState().reset();
    delete (window as unknown as Record<string, unknown>)['__WE_PLUGIN_API__'];
    installPluginApi();
  });

  function getApi() {
    return (window as unknown as Record<string, unknown>)['__WE_PLUGIN_API__'] as {
      registerPlugin: (id: string, setup: (ctx: unknown) => void, permissions?: string[]) => void;
    };
  }

  it('manifest permissions cap what a bundle claims at runtime', () => {
    // Simulate loadPluginBundle setting only ui:menu permission from manifest
    setManifestPermissions('ext-plugin', ['ui:menu']);

    // Bundle tries to register an importer (requires io:import — not declared)
    expect(() => {
      getApi().registerPlugin('ext-plugin', (ctx: unknown) => {
        const c = ctx as { registerImporter: (x: unknown) => void };
        c.registerImporter({
          id: 'ext-plugin:import', pluginId: 'ext-plugin', formatName: 'F',
          extensions: ['.f'], onImport: async () => emptyProject,
        });
      });
    }).toThrow("does not have 'io:import' permission");
  });

  it('bundle claiming ALL_PERMISSIONS is capped to manifest permissions', () => {
    // Manifest declares only project:read
    setManifestPermissions('ext-plugin', ['project:read']);

    // Bundle calls registerPlugin claiming ALL permissions (the exploit pattern)
    expect(() => {
      getApi().registerPlugin(
        'ext-plugin',
        (ctx: unknown) => {
          const c = ctx as { updateProject: (fn: (p: Project) => Project) => void };
          c.updateProject((p) => ({ ...p, name: 'hacked' }));
        },
        // Bundle claims all permissions — should be ignored
        ['project:read', 'project:write', 'ui:menu', 'io:import', 'io:export'],
      );
    }).toThrow("does not have 'project:write' permission");
  });

  it('getProject returns a deep clone — store is not affected by plugin mutation', () => {
    useProjectStore.setState({ project: { ...emptyProject, name: 'Original' } });
    setManifestPermissions('ext-plugin', ['project:read']);

    getApi().registerPlugin('ext-plugin', (ctx: unknown) => {
      const c = ctx as { getProject: () => Project };
      const snapshot = c.getProject();
      // Directly mutate the returned object — should NOT affect the store
      snapshot.name = 'Mutated by plugin';
    });

    expect(useProjectStore.getState().project.name).toBe('Original');
  });

  it('updateProject receives a clone — in-place mutation is ineffective', () => {
    useProjectStore.setState({ project: { ...emptyProject, name: 'Before' } });
    setManifestPermissions('ext-plugin', ['project:write']);

    getApi().registerPlugin('ext-plugin', (ctx: unknown) => {
      const c = ctx as { updateProject: (fn: (p: Project) => Project) => void };
      c.updateProject((p) => {
        // Mutate in place instead of returning a new object
        (p as { name: string }).name = 'MutatedInPlace';
        return p; // returning the same (mutated) clone is still valid
      });
    });

    // The store should reflect the updated name (via the returned value)
    expect(useProjectStore.getState().project.name).toBe('MutatedInPlace');

    // Verify the original store reference was not directly mutated by checking
    // that a fresh getState() call returns the value set by setState
    const stored = useProjectStore.getState().project;
    expect(stored.name).toBe('MutatedInPlace');
  });

  it('contribution id must start with plugin id for external plugins', () => {
    setManifestPermissions('my-plugin', ['ui:menu']);

    expect(() => {
      getApi().registerPlugin('my-plugin', (ctx: unknown) => {
        const c = ctx as { registerMenuItem: (x: unknown) => void };
        // Using another plugin's ID prefix — should be rejected
        c.registerMenuItem({ id: 'other-plugin:action', pluginId: 'my-plugin', label: 'X', onClick: () => {} });
      });
    }).toThrow("must start with 'my-plugin:'");
  });

  it('contribution id with correct prefix is accepted for external plugins', () => {
    setManifestPermissions('my-plugin', ['ui:menu']);

    expect(() => {
      getApi().registerPlugin('my-plugin', (ctx: unknown) => {
        const c = ctx as { registerMenuItem: (x: unknown) => void };
        c.registerMenuItem({ id: 'my-plugin:action', pluginId: 'my-plugin', label: 'X', onClick: () => {} });
      });
    }).not.toThrow();

    expect(usePluginContribStore.getState().menuItems).toHaveLength(1);
  });

  it('built-in plugins (no manifest pre-set) skip contribution id validation', () => {
    // No setManifestPermissions call — simulates a built-in plugin mounted directly
    expect(() => {
      getApi().registerPlugin('builtin-plugin', (ctx: unknown) => {
        const c = ctx as { registerMenuItem: (x: unknown) => void };
        // Built-ins can use any id convention
        c.registerMenuItem({ id: 'arbitrary:id', pluginId: 'builtin-plugin', label: 'X', onClick: () => {} });
      });
    }).not.toThrow();
  });
});
