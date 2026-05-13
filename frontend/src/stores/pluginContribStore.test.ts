import { describe, it, expect, beforeEach } from 'vitest';
import { usePluginContribStore } from './pluginContribStore';
import type {
  ToolbarButtonContrib,
  MenuItemContrib,
  ImporterContrib,
  ExporterContrib,
  PanelContrib,
  ContextMenuContrib,
  ViewportOverlayContrib,
  SettingsContrib,
} from './pluginContribStore';

const noop = () => {};

function makeBtn(id: string, pluginId = 'test-plugin'): ToolbarButtonContrib {
  return { id, pluginId, icon: '⌘', labelKey: 'k', group: 'mode', onClick: noop };
}

function makeItem(id: string, pluginId = 'test-plugin'): MenuItemContrib {
  return { id, pluginId, menu: 'road', labelKey: 'k', onClick: noop };
}

describe('usePluginContribStore', () => {
  beforeEach(() => {
    usePluginContribStore.setState({ toolbarButtons: [], menuItems: [] });
  });

  it('registers a toolbar button', () => {
    usePluginContribStore.getState().registerToolbarButton(makeBtn('b1'));
    expect(usePluginContribStore.getState().toolbarButtons).toHaveLength(1);
    expect(usePluginContribStore.getState().toolbarButtons[0]!.id).toBe('b1');
  });

  it('replaces existing button with same id on re-register', () => {
    const original = makeBtn('b1');
    const updated = { ...makeBtn('b1'), icon: '✓' };
    usePluginContribStore.getState().registerToolbarButton(original);
    usePluginContribStore.getState().registerToolbarButton(updated);
    const buttons = usePluginContribStore.getState().toolbarButtons;
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.icon).toBe('✓');
  });

  it('unregisters a toolbar button by id', () => {
    usePluginContribStore.getState().registerToolbarButton(makeBtn('b1'));
    usePluginContribStore.getState().registerToolbarButton(makeBtn('b2'));
    usePluginContribStore.getState().unregisterToolbarButton('b1');
    const buttons = usePluginContribStore.getState().toolbarButtons;
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.id).toBe('b2');
  });

  it('registers a menu item', () => {
    usePluginContribStore.getState().registerMenuItem(makeItem('m1'));
    expect(usePluginContribStore.getState().menuItems).toHaveLength(1);
  });

  it('unregisters a menu item by id', () => {
    usePluginContribStore.getState().registerMenuItem(makeItem('m1'));
    usePluginContribStore.getState().registerMenuItem(makeItem('m2'));
    usePluginContribStore.getState().unregisterMenuItem('m1');
    expect(usePluginContribStore.getState().menuItems).toHaveLength(1);
    expect(usePluginContribStore.getState().menuItems[0]!.id).toBe('m2');
  });

  it('unregisterPlugin removes all contributions from that plugin', () => {
    usePluginContribStore.getState().registerToolbarButton(makeBtn('b1', 'plugin-a'));
    usePluginContribStore.getState().registerToolbarButton(makeBtn('b2', 'plugin-b'));
    usePluginContribStore.getState().registerMenuItem(makeItem('m1', 'plugin-a'));
    usePluginContribStore.getState().registerMenuItem(makeItem('m2', 'plugin-b'));

    usePluginContribStore.getState().unregisterPlugin('plugin-a');

    const { toolbarButtons, menuItems } = usePluginContribStore.getState();
    expect(toolbarButtons).toHaveLength(1);
    expect(toolbarButtons[0]!.pluginId).toBe('plugin-b');
    expect(menuItems).toHaveLength(1);
    expect(menuItems[0]!.pluginId).toBe('plugin-b');
  });

  it('does not throw when unregistering non-existent id', () => {
    expect(() => {
      usePluginContribStore.getState().unregisterToolbarButton('ghost');
      usePluginContribStore.getState().unregisterMenuItem('ghost');
      usePluginContribStore.getState().unregisterPlugin('ghost-plugin');
    }).not.toThrow();
  });

  // --- Importer / Exporter ---

  it('registers and unregisters an importer', () => {
    const importer: ImporterContrib = {
      id: 'imp-1', pluginId: 'plugin-io', formatName: 'Lanelet2',
      extensions: ['.osm'], onImport: async () => ({ name: 'P', header: { rev_major: 1, rev_minor: 6, name: '', date: '', north: 0, south: 0, east: 0, west: 0, geo_reference: null }, roads: [], junctions: [], signals: [], objects: [] }),
    };
    usePluginContribStore.getState().registerImporter(importer);
    expect(usePluginContribStore.getState().importers).toHaveLength(1);
    expect(usePluginContribStore.getState().importers[0]!.id).toBe('imp-1');

    usePluginContribStore.getState().unregisterImporter('imp-1');
    expect(usePluginContribStore.getState().importers).toHaveLength(0);
  });

  it('registers and unregisters an exporter', () => {
    const exporter: ExporterContrib = {
      id: 'exp-1', pluginId: 'plugin-io', formatName: 'Lanelet2',
      onExport: async () => {},
    };
    usePluginContribStore.getState().registerExporter(exporter);
    expect(usePluginContribStore.getState().exporters).toHaveLength(1);
    usePluginContribStore.getState().unregisterExporter('exp-1');
    expect(usePluginContribStore.getState().exporters).toHaveLength(0);
  });

  // --- Panel ---

  it('registers and unregisters a panel', () => {
    const panel: PanelContrib = {
      id: 'panel-1', pluginId: 'plugin-gis', title: 'GIS Tools',
      component: () => null, position: 'right',
    };
    usePluginContribStore.getState().registerPanel(panel);
    expect(usePluginContribStore.getState().panels).toHaveLength(1);
    usePluginContribStore.getState().unregisterPanel('panel-1');
    expect(usePluginContribStore.getState().panels).toHaveLength(0);
  });

  // --- ContextMenuItem ---

  it('registers and unregisters a context menu item', () => {
    const item: ContextMenuContrib = {
      id: 'ctx-1', pluginId: 'plugin-adv', menu: 'road',
      label: 'Split Road', onClick: noop,
    };
    usePluginContribStore.getState().registerContextMenuItem(item);
    expect(usePluginContribStore.getState().contextMenuItems).toHaveLength(1);
    usePluginContribStore.getState().unregisterContextMenuItem('ctx-1');
    expect(usePluginContribStore.getState().contextMenuItems).toHaveLength(0);
  });

  // --- ViewportOverlay ---

  it('registers and unregisters a viewport overlay', () => {
    const overlay: ViewportOverlayContrib = {
      id: 'ovl-1', pluginId: 'plugin-pc', render: () => {}, order: 10,
    };
    usePluginContribStore.getState().registerViewportOverlay(overlay);
    expect(usePluginContribStore.getState().viewportOverlays).toHaveLength(1);
    usePluginContribStore.getState().unregisterViewportOverlay('ovl-1');
    expect(usePluginContribStore.getState().viewportOverlays).toHaveLength(0);
  });

  // --- Settings ---

  it('registers and unregisters a settings contrib', () => {
    const settings: SettingsContrib = {
      id: 'set-1', pluginId: 'plugin-adv', title: 'Advanced Editing',
      component: () => null,
    };
    usePluginContribStore.getState().registerSettings(settings);
    expect(usePluginContribStore.getState().settingsContribs).toHaveLength(1);
    usePluginContribStore.getState().unregisterSettings('set-1');
    expect(usePluginContribStore.getState().settingsContribs).toHaveLength(0);
  });

  // --- unregisterPlugin removes ALL contribution types ---

  it('unregisterPlugin removes importers, exporters, panels, context menu items, overlays, settings', () => {
    usePluginContribStore.getState().registerImporter({
      id: 'imp-a', pluginId: 'plugin-a', formatName: 'Fmt', extensions: ['.fmt'],
      onImport: async () => ({ name: 'P', header: { rev_major: 1, rev_minor: 6, name: '', date: '', north: 0, south: 0, east: 0, west: 0, geo_reference: null }, roads: [], junctions: [], signals: [], objects: [] }),
    });
    usePluginContribStore.getState().registerExporter({
      id: 'exp-a', pluginId: 'plugin-a', formatName: 'Fmt', onExport: async () => {},
    });
    usePluginContribStore.getState().registerPanel({
      id: 'pnl-a', pluginId: 'plugin-a', title: 'P', component: () => null, position: 'right',
    });
    usePluginContribStore.getState().registerContextMenuItem({
      id: 'ctx-a', pluginId: 'plugin-a', menu: 'road', label: 'L', onClick: noop,
    });
    usePluginContribStore.getState().registerViewportOverlay({
      id: 'ovl-a', pluginId: 'plugin-a', render: () => {}, order: 0,
    });
    usePluginContribStore.getState().registerSettings({
      id: 'set-a', pluginId: 'plugin-a', title: 'S', component: () => null,
    });

    usePluginContribStore.getState().unregisterPlugin('plugin-a');

    const s = usePluginContribStore.getState();
    expect(s.importers).toHaveLength(0);
    expect(s.exporters).toHaveLength(0);
    expect(s.panels).toHaveLength(0);
    expect(s.contextMenuItems).toHaveLength(0);
    expect(s.viewportOverlays).toHaveLength(0);
    expect(s.settingsContribs).toHaveLength(0);
  });
});
