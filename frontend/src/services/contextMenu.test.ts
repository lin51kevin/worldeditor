import { describe, it, expect, beforeEach } from 'vitest';
import { registerContextMenu, getMenu, showContextMenu, getMenuWithPlugins } from './contextMenu';
import type { MenuItem } from './contextMenu';
import { usePluginContribStore } from '../stores/pluginContribStore';

describe('contextMenu service', () => {
  beforeEach(() => {
    // Clear plugin context menu contributions
    usePluginContribStore.setState({ contextMenuItems: [] });
  });

  it('should register and retrieve menu items', () => {
    const items: MenuItem[] = [
      { label: 'Test Item', action: () => {} },
    ];
    registerContextMenu('test', () => items);
    const result = getMenu('test', 0, 0);
    expect(result).toHaveLength(1);
    expect(result[0]!.label).toBe('Test Item');
  });

  it('should return empty array for unregistered context', () => {
    const result = getMenu('unknown', 0, 0);
    expect(result).toEqual([]);
  });

  it('should pass position to provider', () => {
    let capturedX = 0, capturedY = 0;
    registerContextMenu('pos-test', (_ctx, x, y) => {
      capturedX = x;
      capturedY = y;
      return [{ label: 'ok' }];
    });
    getMenu('pos-test', 42, 99);
    expect(capturedX).toBe(42);
    expect(capturedY).toBe(99);
  });

  it('should dispatch showContextMenu event', () => {
    let received = false;
    const handler = () => { received = true; };
    document.addEventListener('contextmenu:show', handler);
    showContextMenu(10, 20, 'viewport');
    document.removeEventListener('contextmenu:show', handler);
    expect(received).toBe(true);
  });

  it('should support separators', () => {
    const items: MenuItem[] = [
      { label: 'Item 1' },
      { separator: true, label: '' },
      { label: 'Item 2' },
    ];
    registerContextMenu('sep-test', () => items);
    const result = getMenu('sep-test', 0, 0);
    expect(result).toHaveLength(3);
    expect(result[1]!.separator).toBe(true);
  });

  it('should support submenu items', () => {
    const items: MenuItem[] = [
      { label: 'Parent', submenu: [{ label: 'Child' }] },
    ];
    registerContextMenu('sub-test', () => items);
    const result = getMenu('sub-test', 0, 0);
    expect(result[0]!.submenu).toHaveLength(1);
  });

  describe('getMenuWithPlugins', () => {
    it('appends plugin context menu items for the matching menu key', () => {
      const onClick = () => {};
      usePluginContribStore.getState().registerContextMenuItem({
        id: 'plugin-road-action', pluginId: 'adv', menu: 'road',
        label: 'Split Road', onClick,
      });
      const base = getMenuWithPlugins('road', 0, 0);
      expect(base.some((item) => item.label === 'Split Road')).toBe(true);
    });

    it('does not append items for a different menu key', () => {
      usePluginContribStore.getState().registerContextMenuItem({
        id: 'plugin-junction-action', pluginId: 'adv', menu: 'junction',
        label: 'Junction Plugin Action', onClick: () => {},
      });
      const items = getMenuWithPlugins('road', 0, 0);
      expect(items.some((i) => i.label === 'Junction Plugin Action')).toBe(false);
    });

    it('respects isVisible() — hides items when it returns false', () => {
      usePluginContribStore.getState().registerContextMenuItem({
        id: 'hidden-item', pluginId: 'adv', menu: 'viewport',
        label: 'Should Not Appear', onClick: () => {},
        isVisible: () => false,
      });
      const items = getMenuWithPlugins('viewport', 0, 0);
      expect(items.some((i) => i.label === 'Should Not Appear')).toBe(false);
    });

    it('respects isDisabled()', () => {
      usePluginContribStore.getState().registerContextMenuItem({
        id: 'disabled-item', pluginId: 'adv', menu: 'road',
        label: 'Disabled Action', onClick: () => {},
        isDisabled: () => true,
      });
      const items = getMenuWithPlugins('road', 0, 0);
      const found = items.find((i) => i.label === 'Disabled Action');
      expect(found?.disabled).toBe(true);
    });

    it('adds a separator before plugin items when there are base items', () => {
      registerContextMenu('road', () => [{ label: 'Base Item' }]);
      usePluginContribStore.getState().registerContextMenuItem({
        id: 'sep-plugin', pluginId: 'x', menu: 'road',
        label: 'Plugin Item', onClick: () => {},
      });
      const items = getMenuWithPlugins('road', 0, 0);
      const sepIdx = items.findIndex((i) => i.separator);
      const pluginIdx = items.findIndex((i) => i.label === 'Plugin Item');
      expect(sepIdx).toBeGreaterThanOrEqual(0);
      expect(pluginIdx).toBeGreaterThan(sepIdx);
    });
  });
});
