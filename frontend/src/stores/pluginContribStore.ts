/**
 * Plugin UI Contribution Registry
 *
 * Plugins call registerToolbarButton / registerMenuItem to inject their
 * buttons/items into the Toolbar and MenuBar. On unload, call
 * unregisterPlugin(pluginId) to remove all contributions at once.
 */
import { create } from 'zustand';

export interface ToolbarButtonContrib {
  id: string;
  pluginId: string;
  /** Unicode glyph or emoji icon */
  icon: string;
  /** i18n key for the label (translated by Toolbar) */
  labelKey: string;
  /** i18n key for the tooltip; falls back to labelKey */
  tooltipKey?: string;
  group: 'mode' | 'action';
  /** Returns true when the button should appear pressed/active */
  isActive?: () => boolean;
  /** Returns true when the button should be disabled */
  isDisabled?: () => boolean;
  onClick: () => void;
}

export interface MenuItemContrib {
  id: string;
  pluginId: string;
  /** Which top-level menu this item belongs to */
  menu: 'file' | 'edit' | 'view' | 'road' | 'tools';
  /** i18n key for the label */
  labelKey: string;
  shortcut?: string;
  separator?: boolean;
  isDisabled?: () => boolean;
  onClick: () => void;
}

interface PluginContribState {
  toolbarButtons: ToolbarButtonContrib[];
  menuItems: MenuItemContrib[];

  registerToolbarButton: (contrib: ToolbarButtonContrib) => void;
  unregisterToolbarButton: (id: string) => void;
  registerMenuItem: (contrib: MenuItemContrib) => void;
  unregisterMenuItem: (id: string) => void;
  /** Remove all contributions from a given plugin at once */
  unregisterPlugin: (pluginId: string) => void;
}

export const usePluginContribStore = create<PluginContribState>((set) => ({
  toolbarButtons: [],
  menuItems: [],

  registerToolbarButton: (contrib) =>
    set((state) => ({
      toolbarButtons: [
        ...state.toolbarButtons.filter((b) => b.id !== contrib.id),
        contrib,
      ],
    })),

  unregisterToolbarButton: (id) =>
    set((state) => ({
      toolbarButtons: state.toolbarButtons.filter((b) => b.id !== id),
    })),

  registerMenuItem: (contrib) =>
    set((state) => ({
      menuItems: [
        ...state.menuItems.filter((m) => m.id !== contrib.id),
        contrib,
      ],
    })),

  unregisterMenuItem: (id) =>
    set((state) => ({
      menuItems: state.menuItems.filter((m) => m.id !== id),
    })),

  unregisterPlugin: (pluginId) =>
    set((state) => ({
      toolbarButtons: state.toolbarButtons.filter((b) => b.pluginId !== pluginId),
      menuItems: state.menuItems.filter((m) => m.pluginId !== pluginId),
    })),
}));
