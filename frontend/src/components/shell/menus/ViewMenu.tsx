import type { MenuItemContrib, PanelContrib } from '../../../stores/pluginContribStore';
import { appendPluginItems, type TranslateFn, type MenuItem } from '../menuDefinitions';
import { MenuSection, type MenuSectionInteractionProps } from './MenuSection';

type MenuAction = () => void | Promise<void>;

const PANEL_CATEGORY_ORDER = ['gis', 'analysis', 'tools', 'ai'];

interface ViewMenuProps extends MenuSectionInteractionProps {
  t: TranslateFn;
  viewPluginItems: MenuItemContrib[];
  pluginPanels: PanelContrib[];
  panelTabVisibility: Record<string, boolean>;
  onTogglePanel: (id: string) => void;
  dimension: string;
  showGrid: boolean;
  showAxis: boolean;
  showHoverHighlight: boolean;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  templatePanelCollapsed: boolean;
  templatePluginEnabled: boolean;
  onView3D: MenuAction;
  onView2D: MenuAction;
  onZoomToFit: MenuAction;
  onZoomToSelected: MenuAction;
  onToggleGrid: MenuAction;
  onToggleAxis: MenuAction;
  onToggleHoverHighlight: MenuAction;
  onToggleLeftPanel: MenuAction;
  onToggleRightPanel: MenuAction;
  onToggleTemplatePanel: MenuAction;
  onResetPanels: MenuAction;
}

function toPanelItem(panel: PanelContrib, t: TranslateFn, panelTabVisibility: Record<string, boolean>, onTogglePanel: (id: string) => void): MenuItem {
  return {
    label: panel.titleKey ? t(panel.titleKey) : panel.title,
    action: () => { onTogglePanel(panel.id); },
    checked: panelTabVisibility[panel.id] !== false,
  };
}

export function ViewMenu({
  t,
  viewPluginItems,
  pluginPanels,
  panelTabVisibility,
  onTogglePanel,
  dimension,
  showGrid,
  showAxis,
  showHoverHighlight,
  leftCollapsed,
  rightCollapsed,
  templatePanelCollapsed,
  templatePluginEnabled,
  onView3D,
  onView2D,
  onZoomToFit,
  onZoomToSelected,
  onToggleGrid,
  onToggleAxis,
  onToggleHoverHighlight,
  onToggleLeftPanel,
  onToggleRightPanel,
  onToggleTemplatePanel,
  onResetPanels,
  ...menuProps
}: ViewMenuProps) {
  // Group plugin panels by category
  const byCategory = new Map<string, PanelContrib[]>();
  const uncategorized: PanelContrib[] = [];
  for (const panel of pluginPanels) {
    if (!panel.category) {
      uncategorized.push(panel);
    } else {
      if (!byCategory.has(panel.category)) byCategory.set(panel.category, []);
      byCategory.get(panel.category)!.push(panel);
    }
  }
  const sortedCats = [...byCategory.keys()].sort((a, b) => {
    const ai = PANEL_CATEGORY_ORDER.indexOf(a);
    const bi = PANEL_CATEGORY_ORDER.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  // Build grouped panel toggle items (with inter-group separators)
  const pluginPanelItems: MenuItem[] = [];
  const allGroups: PanelContrib[][] = [
    ...(uncategorized.length > 0 ? [uncategorized] : []),
    ...sortedCats.map((c) => byCategory.get(c) ?? []),
  ];
  let firstPanelGroup = true;
  for (const group of allGroups) {
    if (!firstPanelGroup) pluginPanelItems.push({ separator: true, label: '' });
    firstPanelGroup = false;
    for (const panel of group) {
      pluginPanelItems.push(toPanelItem(panel, t, panelTabVisibility, onTogglePanel));
    }
  }

  const hasPanelItems = pluginPanelItems.length > 0;

  const menu = appendPluginItems(
    {
      label: t('menu.view'),
      items: [
        {
          label: t('menu.view3D'),
          action: () => { void onView3D(); },
          checked: dimension === '3d',
        },
        {
          label: t('menu.view2D'),
          action: () => { void onView2D(); },
          checked: dimension === '2d',
        },
        { separator: true, label: '' },
        {
          label: t('menu.zoomToFit'),
          shortcut: 'Home',
          action: () => { void onZoomToFit(); },
        },
        {
          label: t('menu.zoomToSelected'),
          shortcut: 'F',
          action: () => { void onZoomToSelected(); },
        },
        { separator: true, label: '' },
        {
          label: t('menu.showGrid'),
          action: () => { void onToggleGrid(); },
          checked: showGrid,
        },
        {
          label: t('menu.showAxis'),
          action: () => { void onToggleAxis(); },
          checked: showAxis,
        },
        {
          label: t('menu.showHoverHighlight'),
          action: () => { void onToggleHoverHighlight(); },
          checked: showHoverHighlight,
        },
        { separator: true, label: '' },
        {
          label: t('menu.showLayerPanel'),
          shortcut: 'Ctrl+B',
          action: () => { void onToggleLeftPanel(); },
          checked: !leftCollapsed,
        },
        {
          label: t('menu.showPropertyPanel'),
          shortcut: 'I',
          action: () => { void onToggleRightPanel(); },
          checked: !rightCollapsed,
        },
        {
          label: t('menu.showTemplatePanel'),
          action: () => { void onToggleTemplatePanel(); },
          checked: !templatePanelCollapsed,
          disabled: !templatePluginEnabled,
        },
        // Plugin panel toggles (grouped by category) — separator before first group
        ...(hasPanelItems ? [{ separator: true, label: '' } as const, ...pluginPanelItems] : []),
        // Reset Panels at the very bottom
        { separator: true, label: '' },
        {
          label: t('menu.resetPanels'),
          action: () => { void onResetPanels(); },
        },
      ],
    },
    viewPluginItems,
    t,
  );

  return <MenuSection menu={menu} {...menuProps} />;
}
