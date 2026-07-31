import type { MenuItemContrib } from '../../../stores/pluginContribStore';
import { buildRoadMenu, type TranslateFn } from '../menuDefinitions';
import { MenuSection, type MenuSectionInteractionProps } from './MenuSection';

interface RoadMenuProps extends MenuSectionInteractionProps {
  t: TranslateFn;
  roadMenuItems: MenuItemContrib[];
}

export function RoadMenu({ t, roadMenuItems, ...menuProps }: RoadMenuProps) {
  const menu = buildRoadMenu(roadMenuItems, t, t('menu.road'));
  return <MenuSection menu={menu} {...menuProps} />;
}
