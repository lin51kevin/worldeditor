import type { MenuItemContrib } from '../../../stores/pluginContribStore';
import { appendPluginItems, type TranslateFn } from '../menuDefinitions';
import { MenuSection, type MenuSectionInteractionProps } from './MenuSection';

type MenuAction = () => void | Promise<void>;

interface ViewMenuProps extends MenuSectionInteractionProps {
  t: TranslateFn;
  viewPluginItems: MenuItemContrib[];
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

export function ViewMenu({
  t,
  viewPluginItems,
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
  const menu = appendPluginItems(
    {
      label: t('menu.view'),
      items: [
        {
          label: t('menu.view3D'),
          action: () => {
            void onView3D();
          },
          checked: dimension === '3d',
        },
        {
          label: t('menu.view2D'),
          action: () => {
            void onView2D();
          },
          checked: dimension === '2d',
        },
        { separator: true, label: '' },
        {
          label: t('menu.zoomToFit'),
          shortcut: 'Home',
          action: () => {
            void onZoomToFit();
          },
        },
        {
          label: t('menu.zoomToSelected'),
          shortcut: 'F',
          action: () => {
            void onZoomToSelected();
          },
        },
        { separator: true, label: '' },
        {
          label: t('menu.showGrid'),
          action: () => {
            void onToggleGrid();
          },
          checked: showGrid,
        },
        {
          label: t('menu.showAxis'),
          action: () => {
            void onToggleAxis();
          },
          checked: showAxis,
        },
        {
          label: t('menu.showHoverHighlight'),
          action: () => {
            void onToggleHoverHighlight();
          },
          checked: showHoverHighlight,
        },
        { separator: true, label: '' },
        {
          label: t('menu.showLayerPanel'),
          shortcut: 'Ctrl+B',
          action: () => {
            void onToggleLeftPanel();
          },
          checked: !leftCollapsed,
        },
        {
          label: t('menu.showPropertyPanel'),
          shortcut: 'I',
          action: () => {
            void onToggleRightPanel();
          },
          checked: !rightCollapsed,
        },
        {
          label: t('menu.showTemplatePanel'),
          action: () => {
            void onToggleTemplatePanel();
          },
          checked: !templatePanelCollapsed,
          disabled: !templatePluginEnabled,
        },
        { separator: true, label: '' },
        {
          label: t('menu.resetPanels'),
          action: () => {
            void onResetPanels();
          },
        },
      ],
    },
    viewPluginItems,
    t,
  );

  return <MenuSection menu={menu} {...menuProps} />;
}
