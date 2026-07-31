import type { Project } from '../../../services/platform';
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
      ],
    },
    toolsPluginItems,
    t,
  );

  return <MenuSection menu={menu} {...menuProps} />;
}
