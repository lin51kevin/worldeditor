import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installPluginApi } from './pluginApi';
import { usePluginContribStore } from '../stores/pluginContribStore';
import { useEditorStore } from '../stores/editorStore';
import type { Project } from '../services/platform';

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
  });
  useEditorStore.getState().reset();
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
    useEditorStore.setState({ project: { ...emptyProject, name: 'MyMap' } });
    getApi().registerPlugin('p1', (ctx: unknown) => {
      const c = ctx as { getProject: () => Project };
      expect(c.getProject().name).toBe('MyMap');
    });
  });

  it('ctx.updateProject applies an immutable update', () => {
    useEditorStore.setState({ project: emptyProject });
    getApi().registerPlugin('p1', (ctx: unknown) => {
      const c = ctx as { updateProject: (fn: (p: Project) => Project) => void };
      c.updateProject((p) => ({ ...p, name: 'Updated' }));
    });
    expect(useEditorStore.getState().project.name).toBe('Updated');
  });

  it('ctx.executeWithUndo mutates project and supports undo', () => {
    useEditorStore.setState({ project: emptyProject, undoStack: [], redoStack: [] });
    getApi().registerPlugin('p1', (ctx: unknown) => {
      const c = ctx as { executeWithUndo: (desc: string, fn: (p: Project) => Project) => void };
      c.executeWithUndo('Change name', (p) => ({ ...p, name: 'Changed' }));
    });
    expect(useEditorStore.getState().project.name).toBe('Changed');
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().project.name).toBe('Test');
  });

  it('ctx.onSelectionChanged fires callback and returns unsubscribe', () => {
    const cb = vi.fn();
    getApi().registerPlugin('p1', (ctx: unknown) => {
      const c = ctx as { onSelectionChanged: (cb: (sel: unknown) => void) => () => void };
      const unsub = c.onSelectionChanged(cb);
      expect(typeof unsub).toBe('function');
    });
  });

  it('ctx.onProjectChanged fires callback and returns unsubscribe', () => {
    const cb = vi.fn();
    getApi().registerPlugin('p1', (ctx: unknown) => {
      const c = ctx as { onProjectChanged: (cb: (proj: unknown) => void) => () => void };
      const unsub = c.onProjectChanged(cb);
      expect(typeof unsub).toBe('function');
    });
  });

  it('unloadPlugin removes all contributions', () => {
    getApi().registerPlugin('p1', (ctx: unknown) => {
      const c = ctx as { registerImporter: (x: unknown) => void };
      c.registerImporter({
        id: 'i1', pluginId: 'p1', formatName: 'F', extensions: ['.f'],
        onImport: async () => emptyProject,
      });
    });
    expect(usePluginContribStore.getState().importers).toHaveLength(1);
    getApi().unloadPlugin('p1');
    expect(usePluginContribStore.getState().importers).toHaveLength(0);
  });
});
