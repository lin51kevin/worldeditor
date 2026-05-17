import type { Project } from '../../../services/platform';
import { usePluginContribStore } from '../../../stores/pluginContribStore';
import type { MenuItemContrib } from '../../../stores/pluginContribStore';
import { appendPluginItems, type TranslateFn } from '../menuDefinitions';
import { MenuSection, type MenuSectionInteractionProps } from './MenuSection';

type MenuAction = () => void | Promise<void>;

interface ToolsMenuProps extends MenuSectionInteractionProps {
  t: TranslateFn;
  project: Project;
  toolsPluginItems: MenuItemContrib[];
  snapEnabled: boolean;
  onCalculateRoadLength: MenuAction;
  onToggleSnap: MenuAction;
  onMeasureDistance: MenuAction;
  onMeasureAngle: MenuAction;
  onMeasureArea: MenuAction;
}

export function ToolsMenu({
  t,
  project,
  toolsPluginItems,
  snapEnabled,
  onCalculateRoadLength,
  onToggleSnap,
  onMeasureDistance,
  onMeasureAngle,
  onMeasureArea,
  ...menuProps
}: ToolsMenuProps) {
  const panelTabVisibility = usePluginContribStore((s) => s.panelTabVisibility);
  const togglePanel = usePluginContribStore((s) => s.togglePanel);
  const panels = usePluginContribStore((s) => s.panels);

  const pluginPanelItems = panels.length > 0
    ? [
        { separator: true, label: '' } as const,
        ...panels.map((panel) => ({
          label: panel.titleKey ? t(panel.titleKey) : panel.title,
          action: () => {
            togglePanel(panel.id);
          },
          checked: panelTabVisibility[panel.id] !== false,
        })),
      ]
    : [];

  const menu = appendPluginItems(
    {
      label: t('menu.tools'),
      items: [
        {
          label: t('menu.calculateRoadLength'),
          action: () => {
            void onCalculateRoadLength();
          },
          disabled: project.roads.length === 0,
        },
        { separator: true, label: '' },
        {
          label: t('toolbar.snap'),
          action: () => {
            void onToggleSnap();
          },
          checked: snapEnabled,
        },
        { separator: true, label: '' },
        {
          label: t('measurement.distance'),
          action: () => {
            void onMeasureDistance();
          },
        },
        {
          label: t('measurement.angle'),
          action: () => {
            void onMeasureAngle();
          },
        },
        {
          label: t('measurement.area'),
          action: () => {
            void onMeasureArea();
          },
        },
        ...pluginPanelItems,
      ],
    },
    toolsPluginItems,
    t,
  );

  return <MenuSection menu={menu} {...menuProps} />;
}
