/**
 * Context menu registry service.
 * Provides register/getMenu for right-click context menus.
 * getMenuWithPlugins merges plugin-contributed items on top of static items.
 */

import { usePluginContribStore } from '../stores/pluginContribStore';

export interface MenuItem {
  label: string;
  action?: () => void;
  shortcut?: string;
  icon?: string;
  separator?: boolean;
  submenu?: MenuItem[];
  disabled?: boolean;
}

type MenuProvider = (context: string, x: number, y: number) => MenuItem[];

const registry = new Map<string, MenuProvider>();

/** Register a menu provider for a given context key. */
export function registerContextMenu(context: string, provider: MenuProvider): void {
  registry.set(context, provider);
}

/** Get menu items for a context at given screen position (static items only). */
export function getMenu(context: string, x: number, y: number): MenuItem[] {
  const provider = registry.get(context);
  if (!provider) return [];
  return provider(context, x, y);
}

/**
 * Get merged menu items: static items + plugin-contributed items for the context.
 * Plugin items that pass isVisible() are appended after a separator.
 */
export function getMenuWithPlugins(context: string, x: number, y: number): MenuItem[] {
  const base = getMenu(context, x, y);

  const pluginItems = usePluginContribStore
    .getState()
    .contextMenuItems
    .filter((c) => c.menu === context && (c.isVisible?.({ type: context }) ?? true))
    .map((c): MenuItem => ({
      label: c.label,
      shortcut: c.shortcut,
      disabled: c.isDisabled?.() ?? false,
      action: c.onClick,
    }));

  if (pluginItems.length === 0) return base;

  return [
    ...base,
    ...(base.length > 0 ? [{ separator: true, label: '' }] : []),
    ...pluginItems,
  ];
}

// --- Core menu registrations ---

registerContextMenu('viewport', (_ctx, _x, _y) => [
  { label: 'Fit to View', action: () => document.dispatchEvent(new CustomEvent('viewport:fitView')) },
  { label: 'Reset Camera', action: () => document.dispatchEvent(new CustomEvent('viewport:resetCamera')) },
  { separator: true, label: '' },
  { label: 'Toggle Grid', action: () => document.dispatchEvent(new CustomEvent('viewport:toggleGrid')) },
  { label: 'Toggle Signals', action: () => document.dispatchEvent(new CustomEvent('viewport:toggleSignals')) },
  { label: 'Toggle Objects', action: () => document.dispatchEvent(new CustomEvent('viewport:toggleObjects')) },
]);

registerContextMenu('road', (_ctx, _x, _y) => [
  { label: 'Edit Properties', action: () => document.dispatchEvent(new CustomEvent('road:editProperties')) },
  { separator: true, label: '' },
  { label: 'Delete Road', action: () => document.dispatchEvent(new CustomEvent('road:delete')) },
]);

registerContextMenu('junction', (_ctx, _x, _y) => [
  { label: 'Edit Properties', action: () => document.dispatchEvent(new CustomEvent('junction:editProperties')) },
  { separator: true, label: '' },
  { label: 'Delete Junction', action: () => document.dispatchEvent(new CustomEvent('junction:delete')) },
]);

/**
 * Show context menu at screen position for given context (with plugin items).
 */
export function showContextMenu(x: number, y: number, context: string): void {
  document.dispatchEvent(new CustomEvent('contextmenu:show', { detail: { x, y, context } }));
}
