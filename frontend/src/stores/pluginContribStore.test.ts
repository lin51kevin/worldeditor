import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePluginContribStore } from './pluginContribStore';
import type {
  ContextMenuContrib,
  ExporterContrib,
  ImporterContrib,
  MenuItemContrib,
  PanelContrib,
  SettingsContrib,
  TemplateSectionContrib,
  ToolbarButtonContrib,
  ViewportOverlayContrib,
} from './pluginContribStore';

const noop = () => {};

function resetStore() {
  usePluginContribStore.setState({
    toolbarButtons: [],
    menuItems: [],
    templateSections: [],
    importers: [],
    exporters: [],
    panels: [],
    contextMenuItems: [],
    viewportOverlays: [],
    settingsContribs: [],
    panelTabVisibility: {},
    activeTabId: null,
    _panelUpdateSuspended: false,
    _pendingPanelBatch: [],
  });
}

function makeButton(id: string, pluginId = 'plugin-a'): ToolbarButtonContrib {
  return { id, pluginId, icon: '⌘', labelKey: `${id}.label`, group: 'mode', onClick: noop };
}

function makeMenuItem(id: string, pluginId = 'plugin-a'): MenuItemContrib {
  return { id, pluginId, menu: 'tools', labelKey: `${id}.label`, onClick: noop };
}

function makeTemplateSection(id: string, pluginId = 'plugin-a'): TemplateSectionContrib {
  return {
    id,
    pluginId,
    categoryKey: `${id}.category`,
    order: 1,
    items: [{ id: `${id}-item`, labelKey: `${id}.item`, icon: '🚗', onApply: noop }],
  };
}

function makeImporter(id: string, pluginId = 'plugin-a'): ImporterContrib {
  return {
    id,
    pluginId,
    formatName: `${id}.fmt`,
    extensions: ['.fmt'],
    onImport: async () => ({
      name: 'Imported',
      header: { rev_major: 1, rev_minor: 6, name: '', date: '', north: 0, south: 0, east: 0, west: 0, geo_reference: null },
      roads: [],
      junctions: [],
      signals: [],
      objects: [],
    }),
  };
}

function makeExporter(id: string, pluginId = 'plugin-a'): ExporterContrib {
  return {
    id,
    pluginId,
    formatName: `${id}.fmt`,
    onExport: async () => {},
  };
}

function makePanel(id: string, pluginId = 'plugin-a'): PanelContrib {
  return {
    id,
    pluginId,
    title: `${id} panel`,
    component: () => null,
    position: 'right',
  };
}

function makeContextMenuItem(id: string, pluginId = 'plugin-a'): ContextMenuContrib {
  return {
    id,
    pluginId,
    menu: 'road',
    label: `${id} label`,
    onClick: noop,
  };
}

function makeViewportOverlay(id: string, order: number, pluginId = 'plugin-a'): ViewportOverlayContrib {
  return {
    id,
    pluginId,
    render: noop,
    order,
  };
}

function makeSettings(id: string, pluginId = 'plugin-a'): SettingsContrib {
  return {
    id,
    pluginId,
    title: `${id} settings`,
    component: () => null,
  };
}

describe('usePluginContribStore', () => {
  beforeEach(() => {
    resetStore();
    vi.restoreAllMocks();
  });

  it('registers and unregisters toolbar buttons by id', () => {
    const store = usePluginContribStore.getState();
    store.registerToolbarButton(makeButton('toolbar-1'));
    store.registerToolbarButton({ ...makeButton('toolbar-1'), icon: '✓' });

    expect(usePluginContribStore.getState().toolbarButtons).toEqual([
      expect.objectContaining({ id: 'toolbar-1', icon: '✓' }),
    ]);

    store.unregisterToolbarButton('toolbar-1');
    expect(usePluginContribStore.getState().toolbarButtons).toEqual([]);
  });

  it('registers and unregisters menu items by id', () => {
    const store = usePluginContribStore.getState();
    store.registerMenuItem(makeMenuItem('menu-1'));
    store.registerMenuItem(makeMenuItem('menu-2'));
    store.unregisterMenuItem('menu-1');

    expect(usePluginContribStore.getState().menuItems.map((item) => item.id)).toEqual(['menu-2']);
  });

  it('registers and unregisters template sections', () => {
    const store = usePluginContribStore.getState();
    store.registerTemplateSection(makeTemplateSection('templates-1'));
    expect(usePluginContribStore.getState().templateSections).toHaveLength(1);

    store.unregisterTemplateSection('templates-1');
    expect(usePluginContribStore.getState().templateSections).toEqual([]);
  });

  it('registers and unregisters importers and exporters', () => {
    const store = usePluginContribStore.getState();
    store.registerImporter(makeImporter('import-1'));
    store.registerExporter(makeExporter('export-1'));
    expect(usePluginContribStore.getState().importers).toHaveLength(1);
    expect(usePluginContribStore.getState().exporters).toHaveLength(1);

    store.unregisterImporter('import-1');
    store.unregisterExporter('export-1');
    expect(usePluginContribStore.getState().importers).toEqual([]);
    expect(usePluginContribStore.getState().exporters).toEqual([]);
  });

  it('registers panels hidden by default and supports show/hide/toggle/active tab', () => {
    const store = usePluginContribStore.getState();
    store.registerPanel(makePanel('panel-1'));

    expect(store.isPanelVisible('panel-1')).toBe(false);

    store.showPanel('panel-1');
    expect(store.isPanelVisible('panel-1')).toBe(true);

    store.hidePanel('panel-1');
    expect(store.isPanelVisible('panel-1')).toBe(false);

    store.togglePanel('panel-1');
    expect(store.isPanelVisible('panel-1')).toBe(true);

    store.setActiveTab('panel-1');
    expect(usePluginContribStore.getState().activeTabId).toBe('panel-1');
  });

  it('rejects panels without a renderable component', () => {
    expect(() => {
      usePluginContribStore.getState().registerPanel({
        ...makePanel('panel-invalid'),
        component: null as never,
      });
    }).toThrow(/panel component/i);
  });

  it('buffers panel registration while suspended and flushes on resume', () => {
    const store = usePluginContribStore.getState();
    const flush = store.suspendPanelUpdates();

    store.registerPanel(makePanel('panel-buffered-1'));
    store.registerPanel(makePanel('panel-buffered-2'));

    expect(usePluginContribStore.getState().panels).toEqual([]);
    expect(usePluginContribStore.getState()._pendingPanelBatch).toHaveLength(2);

    flush();

    const state = usePluginContribStore.getState();
    expect(state.panels.map((panel) => panel.id)).toEqual(['panel-buffered-1', 'panel-buffered-2']);
    expect(state.panelTabVisibility).toMatchObject({
      'panel-buffered-1': false,
      'panel-buffered-2': false,
    });
    expect(state._pendingPanelBatch).toEqual([]);
    expect(state._panelUpdateSuspended).toBe(false);
  });

  it('registerPanelsBatch ignores duplicate ids and non-renderable panels', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = usePluginContribStore.getState();
    store.registerPanel(makePanel('panel-existing'));

    store.registerPanelsBatch([
      makePanel('panel-existing'),
      makePanel('panel-batch'),
      { ...makePanel('panel-invalid'), component: null as never },
    ]);

    const state = usePluginContribStore.getState();
    expect(state.panels.map((panel) => panel.id)).toEqual(['panel-existing', 'panel-batch']);
    expect(state.panelTabVisibility).toMatchObject({
      'panel-existing': false,
      'panel-batch': false,
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/panel-invalid/));
  });

  it('registers and unregisters context menu items, overlays, and settings', () => {
    const store = usePluginContribStore.getState();
    store.registerContextMenuItem(makeContextMenuItem('ctx-1'));
    store.registerViewportOverlay(makeViewportOverlay('overlay-late', 20));
    store.registerViewportOverlay(makeViewportOverlay('overlay-early', 5));
    store.registerSettings(makeSettings('settings-1'));

    const state = usePluginContribStore.getState();
    expect(state.contextMenuItems.map((item) => item.id)).toEqual(['ctx-1']);
    expect(state.viewportOverlays.map((item) => item.id)).toEqual(['overlay-early', 'overlay-late']);
    expect(state.settingsContribs.map((item) => item.id)).toEqual(['settings-1']);

    store.unregisterContextMenuItem('ctx-1');
    store.unregisterViewportOverlay('overlay-early');
    store.unregisterViewportOverlay('overlay-late');
    store.unregisterSettings('settings-1');
    expect(usePluginContribStore.getState().contextMenuItems).toEqual([]);
    expect(usePluginContribStore.getState().viewportOverlays).toEqual([]);
    expect(usePluginContribStore.getState().settingsContribs).toEqual([]);
  });

  it('unregisterPlugin removes every contribution type and clears active plugin tabs', () => {
    const store = usePluginContribStore.getState();
    store.registerToolbarButton(makeButton('toolbar-a', 'plugin-a'));
    store.registerToolbarButton(makeButton('toolbar-b', 'plugin-b'));
    store.registerMenuItem(makeMenuItem('menu-a', 'plugin-a'));
    store.registerTemplateSection(makeTemplateSection('templates-a', 'plugin-a'));
    store.registerImporter(makeImporter('import-a', 'plugin-a'));
    store.registerExporter(makeExporter('export-a', 'plugin-a'));
    store.registerPanel(makePanel('panel-a', 'plugin-a'));
    store.registerPanel(makePanel('panel-b', 'plugin-b'));
    store.registerContextMenuItem(makeContextMenuItem('ctx-a', 'plugin-a'));
    store.registerViewportOverlay(makeViewportOverlay('overlay-a', 1, 'plugin-a'));
    store.registerSettings(makeSettings('settings-a', 'plugin-a'));
    store.setActiveTab('panel-a');

    store.unregisterPlugin('plugin-a');

    const state = usePluginContribStore.getState();
    expect(state.toolbarButtons.map((item) => item.id)).toEqual(['toolbar-b']);
    expect(state.menuItems).toEqual([]);
    expect(state.templateSections).toEqual([]);
    expect(state.importers).toEqual([]);
    expect(state.exporters).toEqual([]);
    expect(state.panels.map((item) => item.id)).toEqual(['panel-b']);
    expect(state.contextMenuItems).toEqual([]);
    expect(state.viewportOverlays).toEqual([]);
    expect(state.settingsContribs).toEqual([]);
    expect(state.panelTabVisibility['panel-a']).toBeUndefined();
    expect(state.activeTabId).toBeNull();
  });

  it('handles unregistering missing contributions without throwing', () => {
    expect(() => {
      const store = usePluginContribStore.getState();
      store.unregisterToolbarButton('missing');
      store.unregisterMenuItem('missing');
      store.unregisterTemplateSection('missing');
      store.unregisterImporter('missing');
      store.unregisterExporter('missing');
      store.unregisterPanel('missing');
      store.unregisterContextMenuItem('missing');
      store.unregisterViewportOverlay('missing');
      store.unregisterSettings('missing');
      store.unregisterPlugin('missing');
    }).not.toThrow();
  });
});
