import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMenu, getMenuWithPlugins, registerContextMenu, showContextMenu } from './contextMenu';
import type { MenuItem } from './contextMenu';
import { usePluginContribStore } from '../stores/pluginContribStore';

describe('contextMenu service', () => {
  beforeEach(() => {
    usePluginContribStore.setState({ contextMenuItems: [] });
  });

  it('registers providers and passes the invocation context and coordinates', () => {
    const items: MenuItem[] = [{ label: 'Inspect' }];
    const provider = vi.fn(() => items);

    registerContextMenu('unit-register', provider);

    expect(getMenu('unit-register', 12, 34)).toEqual(items);
    expect(provider).toHaveBeenCalledWith('unit-register', 12, 34);
  });

  it('overwrites an existing provider for the same context key', () => {
    registerContextMenu('unit-overwrite', () => [{ label: 'Old Item' }]);
    registerContextMenu('unit-overwrite', () => [{ label: 'New Item' }]);

    expect(getMenu('unit-overwrite', 0, 0)).toEqual([{ label: 'New Item' }]);
  });

  it('returns an empty array for unknown contexts', () => {
    expect(getMenu('unit-missing', 0, 0)).toEqual([]);
  });

  it('returns base items unchanged when no plugin items match the context', () => {
    registerContextMenu('unit-base-only', () => [{ label: 'Base Item' }]);
    usePluginContribStore.getState().registerContextMenuItem({
      id: 'other-plugin-item',
      pluginId: 'plugin-a',
      menu: 'viewport',
      label: 'Other Item',
      onClick: vi.fn(),
    });

    expect(getMenuWithPlugins('unit-base-only', 0, 0)).toEqual([{ label: 'Base Item' }]);
  });

  it('appends visible plugin items after a separator and preserves their callbacks', () => {
    const onClick = vi.fn();
    registerContextMenu('unit-plugin-merge', () => [{ label: 'Base Item' }]);
    usePluginContribStore.getState().registerContextMenuItem({
      id: 'plugin-visible-item',
      pluginId: 'plugin-a',
      menu: 'unit-plugin-merge',
      label: 'Plugin Item',
      shortcut: 'Ctrl+Shift+P',
      isDisabled: () => true,
      onClick,
    });

    const items = getMenuWithPlugins('unit-plugin-merge', 5, 6);
    const separator = items[1];
    const pluginItem = items[2];

    expect(items.map((item) => item.label)).toEqual(['Base Item', '', 'Plugin Item']);
    expect(separator?.separator).toBe(true);
    expect(pluginItem).toEqual({
      label: 'Plugin Item',
      shortcut: 'Ctrl+Shift+P',
      disabled: true,
      action: onClick,
    });

    pluginItem?.action?.();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not inject a separator when only plugin items exist', () => {
    usePluginContribStore.getState().registerContextMenuItem({
      id: 'plugin-only-item',
      pluginId: 'plugin-a',
      menu: 'unit-plugin-only',
      label: 'Plugin Only',
      onClick: vi.fn(),
    });

    expect(getMenuWithPlugins('unit-plugin-only', 0, 0)).toEqual([
      {
        label: 'Plugin Only',
        shortcut: undefined,
        disabled: false,
        action: expect.any(Function),
      },
    ]);
  });

  it('filters out plugin items whose visibility predicate returns false', () => {
    usePluginContribStore.getState().registerContextMenuItem({
      id: 'hidden-plugin-item',
      pluginId: 'plugin-a',
      menu: 'viewport',
      label: 'Hidden Plugin Item',
      isVisible: () => false,
      onClick: vi.fn(),
    });

    expect(getMenuWithPlugins('viewport', 0, 0).some((item) => item.label === 'Hidden Plugin Item')).toBe(false);
  });

  it('dispatches the show event with screen coordinates and context', () => {
    const handler = vi.fn();
    document.addEventListener('contextmenu:show', handler as EventListener);

    showContextMenu(100, 200, 'road');

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0]?.[0] as CustomEvent<{ x: number; y: number; context: string }>;
    expect(event.detail).toEqual({ x: 100, y: 200, context: 'road' });

    document.removeEventListener('contextmenu:show', handler as EventListener);
  });

  it('executes built-in viewport menu actions by dispatching DOM events', () => {
    const fitViewListener = vi.fn();
    document.addEventListener('viewport:fitView', fitViewListener as EventListener);

    const fitToView = getMenu('viewport', 0, 0).find((item) => item.label === 'Fit to View');
    fitToView?.action?.();

    expect(fitViewListener).toHaveBeenCalledTimes(1);
    document.removeEventListener('viewport:fitView', fitViewListener as EventListener);
  });

  it('executes built-in road menu actions by dispatching DOM events', () => {
    const deleteRoadListener = vi.fn();
    document.addEventListener('road:delete', deleteRoadListener as EventListener);

    const deleteRoad = getMenu('road', 0, 0).find((item) => item.label === 'Delete Road');
    deleteRoad?.action?.();

    expect(deleteRoadListener).toHaveBeenCalledTimes(1);
    document.removeEventListener('road:delete', deleteRoadListener as EventListener);
  });
});
