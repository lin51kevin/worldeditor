import { describe, it, expect, beforeEach } from 'vitest';
import { usePluginContribStore } from './pluginContribStore';
import type { ToolbarButtonContrib, MenuItemContrib } from './pluginContribStore';

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
});
