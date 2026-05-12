/**
 * Plugin UI Contribution Registry
 *
 * Plugins call registerToolbarButton / registerMenuItem to inject their
 * buttons/items into the Toolbar and MenuBar. On unload, call
 * unregisterPlugin(pluginId) to remove all contributions at once.
 *
 * Template sections: plugins register TemplateSectionContrib to add
 * categorized template items to the TemplatePanel.
 */
import { create } from 'zustand';
import type { ReactNode } from 'react';

export interface ToolbarButtonContrib {
  id: string;
  pluginId: string;
  /** Icon — Lucide React element or emoji/Unicode string */
  icon: ReactNode;
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

/** A single item in a template section (e.g. "Single Lane", "Traffic Light") */
export interface TemplateItemDef {
  id: string;
  /** i18n key for the visible label */
  labelKey: string;
  /** Unicode glyph / emoji used as thumbnail */
  icon: string;
  /**
   * Called when the user clicks or activates the item.
   * @param opts optional drop position in world coordinates
   */
  onApply: (opts?: { x?: number; y?: number; hdg?: number }) => void;
}

/** A category of templates contributed by a plugin */
export interface TemplateSectionContrib {
  id: string;
  pluginId: string;
  /** i18n key for the tab label */
  categoryKey: string;
  /** Controls tab order (ascending) */
  order: number;
  items: TemplateItemDef[];
}

interface PluginContribState {
  toolbarButtons: ToolbarButtonContrib[];
  menuItems: MenuItemContrib[];
  templateSections: TemplateSectionContrib[];

  registerToolbarButton: (contrib: ToolbarButtonContrib) => void;
  unregisterToolbarButton: (id: string) => void;
  registerMenuItem: (contrib: MenuItemContrib) => void;
  unregisterMenuItem: (id: string) => void;
  registerTemplateSection: (section: TemplateSectionContrib) => void;
  unregisterTemplateSection: (sectionId: string) => void;
  /** Remove all contributions from a given plugin at once */
  unregisterPlugin: (pluginId: string) => void;
}

export const usePluginContribStore = create<PluginContribState>((set) => ({
  toolbarButtons: [],
  menuItems: [],
  templateSections: [],

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

  registerTemplateSection: (section) =>
    set((state) => ({
      templateSections: [
        ...state.templateSections.filter((s) => s.id !== section.id),
        section,
      ],
    })),

  unregisterTemplateSection: (sectionId) =>
    set((state) => ({
      templateSections: state.templateSections.filter((s) => s.id !== sectionId),
    })),

  unregisterPlugin: (pluginId) =>
    set((state) => ({
      toolbarButtons: state.toolbarButtons.filter((b) => b.pluginId !== pluginId),
      menuItems: state.menuItems.filter((m) => m.pluginId !== pluginId),
      templateSections: state.templateSections.filter((s) => s.pluginId !== pluginId),
    })),
}));
