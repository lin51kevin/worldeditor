/**
 * Plugin UI Contribution Registry
 *
 * Plugins call registerToolbarButton / registerMenuItem to inject their
 * buttons/items into the Toolbar and MenuBar. On unload, call
 * unregisterPlugin(pluginId) to remove all contributions at once.
 *
 * Template sections: plugins register TemplateSectionContrib to add
 * categorized template items to the TemplatePanel.
 *
 * Extended contributions: importers, exporters, panels, context menu items,
 * viewport overlays, and settings tabs for the Phase 0 plugin API.
 */
import { create } from 'zustand';
import type { ComponentType, ReactNode } from 'react';
import type { Project } from '../services/platform';

function isRenderableComponent(component: unknown): component is ComponentType<unknown> {
  return component !== null && (typeof component === 'function' || typeof component === 'object');
}

export interface ToolbarButtonContrib {
  id: string;
  pluginId: string;
  /** Icon — Lucide React element or emoji/Unicode string */
  icon: ReactNode;
  /** i18n key for the label (translated by Toolbar) */
  labelKey: string;
  /** i18n key for the tooltip; falls back to labelKey */
  tooltipKey?: string;
  group: 'mode' | 'action' | 'junction';
  /** Returns true when the button should appear pressed/active */
  isActive?: () => boolean;
  /** Returns false to hide the button entirely */
  isVisible?: () => boolean;
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
  /** Fallback label if i18n key is not found */
  label?: string;
  /** Group/submenu hint for rendering; items with the same group are separated by dividers */
  group?: string;
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
  /** Unicode glyph / emoji used as thumbnail fallback */
  icon: string;
  /** Optional PNG thumbnail URL (overrides icon when provided) */
  thumbnailUrl?: string;
  /**
   * Drawing interaction mode for road objects:
   * - undefined or 'point': single click placement
   * - 'line': multi-click polyline; right-click finalizes
   * - 'polygon': multi-click closed polygon; right-click closes
   */
  drawMode?: 'point' | 'line' | 'polygon';
  /**
   * Called when the user clicks or activates the item.
   * @param opts optional drop position in world coordinates, or roadId for road-object placement
   */
  onApply: (opts?: { x?: number; y?: number; hdg?: number; roadId?: string; corners?: Array<{ x: number; y: number; z: number }> }) => void;
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

/** File importer contributed by a plugin — auto-populates File → Import submenu */
export interface ImporterContrib {
  id: string;
  pluginId: string;
  formatName: string;
  extensions: string[];
  /** When true, the menu item is shown but greyed out (coming soon). */
  disabled?: boolean;
  /** Called with raw file content (text or ArrayBuffer); returns parsed Project */
  onImport: (content: string | ArrayBuffer, fileName: string) => Promise<Project>;
}

/** File exporter contributed by a plugin — auto-populates File → Export submenu */
export interface ExporterContrib {
  id: string;
  pluginId: string;
  formatName: string;
  /** When true, the menu item is shown but greyed out (coming soon). */
  disabled?: boolean;
  /** Called with the current project; plugin handles file download/save */
  onExport: (project: Project) => Promise<void>;
}

/** Dockable/floating panel contributed by a plugin */
export interface PanelContrib {
  id: string;
  pluginId: string;
  title: string;
  /** i18n key for the panel title; resolved at render time with fallback to `title` */
  titleKey?: string;
  /** React component rendered inside the panel */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: ComponentType<any>;
  position: 'left' | 'right' | 'bottom' | 'float';
  icon?: ReactNode;
  /** When true, the generic plugin-panel-header is not rendered; the component manages its own header */
  headerless?: boolean;
}

/** Context passed to `ContextMenuContrib.isVisible` for conditional visibility */
export interface ContextMenuCtx {
  /** The kind of element the context menu was invoked on */
  type: 'road' | 'junction' | 'viewport' | string;
  /** ID of the target element, if any */
  targetId?: string;
}

/** Context menu item contributed by a plugin */
export interface ContextMenuContrib {
  id: string;
  pluginId: string;
  /** Which context menu this item appears in ('road', 'junction', 'viewport', etc.) */
  menu: string;
  label: string;
  /** i18n key for the label */
  labelKey?: string;
  shortcut?: string;
  onClick: () => void;
  /** Return false to hide the item in the current context */
  isVisible?: (ctx?: ContextMenuCtx) => boolean;
  isDisabled?: () => boolean;
}

/** Viewport overlay renderer contributed by a plugin */
export interface ViewportOverlayContrib {
  id: string;
  pluginId: string;
  /** Called after the main render pass; receives the GPUDevice and canvas if available */
  render: (ctx?: { device?: GPUDevice; canvas?: HTMLCanvasElement }) => void;
  /** Lower numbers render first */
  order: number;
}

/** Settings tab contributed by a plugin — shown in the Settings dialog */
export interface SettingsContrib {
  id: string;
  pluginId: string;
  title: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: ComponentType<any>;
}

interface PluginContribState {
  toolbarButtons: ToolbarButtonContrib[];
  menuItems: MenuItemContrib[];
  templateSections: TemplateSectionContrib[];
  importers: ImporterContrib[];
  exporters: ExporterContrib[];
  panels: PanelContrib[];
  contextMenuItems: ContextMenuContrib[];
  viewportOverlays: ViewportOverlayContrib[];
  settingsContribs: SettingsContrib[];

  // Panel tab visibility management
  panelTabVisibility: Record<string, boolean>;
  activeTabId: string | null;

  registerToolbarButton: (contrib: ToolbarButtonContrib) => void;
  unregisterToolbarButton: (id: string) => void;
  registerMenuItem: (contrib: MenuItemContrib) => void;
  unregisterMenuItem: (id: string) => void;
  registerTemplateSection: (section: TemplateSectionContrib) => void;
  unregisterTemplateSection: (sectionId: string) => void;
  registerImporter: (contrib: ImporterContrib) => void;
  unregisterImporter: (id: string) => void;
  registerExporter: (contrib: ExporterContrib) => void;
  unregisterExporter: (id: string) => void;
  registerPanel: (contrib: PanelContrib) => void;
  unregisterPanel: (id: string) => void;
  registerContextMenuItem: (contrib: ContextMenuContrib) => void;
  unregisterContextMenuItem: (id: string) => void;
  registerViewportOverlay: (contrib: ViewportOverlayContrib) => void;
  unregisterViewportOverlay: (id: string) => void;
  registerSettings: (contrib: SettingsContrib) => void;
  unregisterSettings: (id: string) => void;
  /** Remove all contributions from a given plugin at once */
  unregisterPlugin: (pluginId: string) => void;

  /** Batch-register multiple panels in a single state update */
  registerPanelsBatch: (contribs: PanelContrib[]) => void;

  /** Suspend panel store updates (for batch plugin mounting); returns a flush function */
  suspendPanelUpdates: () => () => void;

  /** @internal */ _panelUpdateSuspended?: boolean;
  /** @internal */ _pendingPanelBatch?: PanelContrib[];

  // Panel tab visibility actions
  showPanel: (tabId: string) => void;
  hidePanel: (tabId: string) => void;
  togglePanel: (tabId: string) => void;
  isPanelVisible: (tabId: string) => boolean;
  setActiveTab: (tabId: string | null) => void;
}

export const usePluginContribStore = create<PluginContribState>((set, get) => ({
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

  registerImporter: (contrib) =>
    set((state) => ({
      importers: [...state.importers.filter((i) => i.id !== contrib.id), contrib],
    })),

  unregisterImporter: (id) =>
    set((state) => ({ importers: state.importers.filter((i) => i.id !== id) })),

  registerExporter: (contrib) =>
    set((state) => ({
      exporters: [...state.exporters.filter((e) => e.id !== contrib.id), contrib],
    })),

  unregisterExporter: (id) =>
    set((state) => ({ exporters: state.exporters.filter((e) => e.id !== id) })),

  _panelUpdateSuspended: false,
  _pendingPanelBatch: [] as PanelContrib[],

  registerPanel: (contrib) => {
    if (!isRenderableComponent(contrib.component)) {
      throw new Error(`Panel component is required for panel '${contrib.id}'`);
    }

    const state = get();
    if (state._panelUpdateSuspended) {
      // Collect into pending batch instead of triggering re-render
      (state._pendingPanelBatch ??= []).push(contrib);
      return;
    }

    // All plugin-contributed panels default to hidden on startup.
    const defaultVisible = false;

    set((s) => ({
      panels: [...s.panels.filter((p) => p.id !== contrib.id), contrib],
      panelTabVisibility: {
        ...s.panelTabVisibility,
        ...(s.panelTabVisibility[contrib.id] === undefined
          ? { [contrib.id]: defaultVisible }
          : {}),
      },
    }));
  },

  unregisterPanel: (id) =>
    set((state) => ({ panels: state.panels.filter((p) => p.id !== id) })),

  registerContextMenuItem: (contrib) =>
    set((state) => ({
      contextMenuItems: [...state.contextMenuItems.filter((c) => c.id !== contrib.id), contrib],
    })),

  unregisterContextMenuItem: (id) =>
    set((state) => ({ contextMenuItems: state.contextMenuItems.filter((c) => c.id !== id) })),

  registerViewportOverlay: (contrib) =>
    set((state) => ({
      viewportOverlays: [
        ...state.viewportOverlays.filter((o) => o.id !== contrib.id),
        contrib,
      ].sort((a, b) => a.order - b.order),
    })),

  unregisterViewportOverlay: (id) =>
    set((state) => ({ viewportOverlays: state.viewportOverlays.filter((o) => o.id !== id) })),

  registerSettings: (contrib) =>
    set((state) => ({
      settingsContribs: [...state.settingsContribs.filter((s) => s.id !== contrib.id), contrib],
    })),

  unregisterSettings: (id) =>
    set((state) => ({ settingsContribs: state.settingsContribs.filter((s) => s.id !== id) })),

  registerPanelsBatch: (contribs) => {
    const { _pendingPanelBatch, ...state } = get();
    const allContribs = [...(_pendingPanelBatch ?? []), ...contribs];
    const existingIds = new Set(state.panels.map((p) => p.id));
    const newPanels = allContribs.filter((c) => !existingIds.has(c.id));
    if (newPanels.length === 0) {
      // Flush pending even if empty to clear
      set({ _pendingPanelBatch: [], _panelUpdateSuspended: false });
      return;
    }

    const mergedPanels = [...state.panels];
    const nextVisibility = { ...state.panelTabVisibility };

    for (const contrib of newPanels) {
      if (!isRenderableComponent(contrib.component)) {
        console.warn(`[PluginBatch] Skipping panel '${contrib.id}' — component is not renderable`);
        continue;
      }
      mergedPanels.push(contrib);
      if (nextVisibility[contrib.id] === undefined) {
        nextVisibility[contrib.id] = false;
      }
    }

    set({
      panels: mergedPanels,
      panelTabVisibility: nextVisibility,
      _pendingPanelBatch: [],
      _panelUpdateSuspended: false,
    });
  },

  suspendPanelUpdates: () => {
    set({ _panelUpdateSuspended: true, _pendingPanelBatch: [] });
    return () => {
      const { registerPanelsBatch } = get();
      registerPanelsBatch([]); // flush whatever was collected
    };
  },

  unregisterPlugin: (pluginId) =>
    set((state) => {
      const pluginTabIds = state.panels
        .filter((p) => p.pluginId === pluginId)
        .map((p) => p.id);
      const nextVisibility = { ...state.panelTabVisibility };
      for (const tabId of pluginTabIds) {
        delete nextVisibility[tabId];
      }
      return {
        toolbarButtons: state.toolbarButtons.filter((b) => b.pluginId !== pluginId),
        menuItems: state.menuItems.filter((m) => m.pluginId !== pluginId),
        templateSections: state.templateSections.filter((s) => s.pluginId !== pluginId),
        importers: state.importers.filter((i) => i.pluginId !== pluginId),
        exporters: state.exporters.filter((e) => e.pluginId !== pluginId),
        panels: state.panels.filter((p) => p.pluginId !== pluginId),
        contextMenuItems: state.contextMenuItems.filter((c) => c.pluginId !== pluginId),
        viewportOverlays: state.viewportOverlays.filter((o) => o.pluginId !== pluginId),
        settingsContribs: state.settingsContribs.filter((s) => s.pluginId !== pluginId),
        panelTabVisibility: nextVisibility,
        activeTabId: pluginTabIds.includes(state.activeTabId ?? '')
          ? null
          : state.activeTabId,
      };
    }),
  showPanel: (tabId) =>
    set((state) => ({
      panelTabVisibility: { ...state.panelTabVisibility, [tabId]: true },
    })),

  hidePanel: (tabId) =>
    set((state) => ({
      panelTabVisibility: { ...state.panelTabVisibility, [tabId]: false },
    })),

  togglePanel: (tabId) =>
    set((state) => ({
      panelTabVisibility: {
        ...state.panelTabVisibility,
        [tabId]: !(state.panelTabVisibility[tabId] !== false),
      },
    })),

  isPanelVisible: (tabId) => {
    return get().panelTabVisibility[tabId] !== false;
  },

  setActiveTab: (tabId) =>
    set({ activeTabId: tabId }),
}));

/** Selector: returns whether a panel tab is visible */
export function usePanelTabVisibility(id: string): boolean {
  return usePluginContribStore((s) => s.panelTabVisibility[id] !== false);
}
