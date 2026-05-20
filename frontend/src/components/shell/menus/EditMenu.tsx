import type { MenuItemContrib } from '../../../stores/pluginContribStore';
import { showConfirm } from '../../../utils/dialog';
import { appendRoadItemsToEdit, type TranslateFn } from '../menuDefinitions';
import { MenuSection, type MenuSectionInteractionProps } from './MenuSection';

type MenuAction = () => void | Promise<void>;

interface EditMenuProps extends MenuSectionInteractionProps {
  t: TranslateFn;
  roadMenuItems: MenuItemContrib[];
  canUndo: boolean;
  canRedo: boolean;
  onUndo: MenuAction;
  onRedo: MenuAction;
  onDelete: MenuAction;
}

export function EditMenu({
  t,
  roadMenuItems,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onDelete,
  ...menuProps
}: EditMenuProps) {
  const menu = appendRoadItemsToEdit(
    {
      label: t('menu.edit'),
      items: [
        {
          label: t('menu.undo'),
          shortcut: 'Ctrl+Z',
          action: () => {
            void onUndo();
          },
          disabled: !canUndo,
        },
        {
          label: t('menu.redo'),
          shortcut: 'Ctrl+Y',
          action: () => {
            void onRedo();
          },
          disabled: !canRedo,
        },
        { separator: true, label: '' },
        {
          label: t('menu.deleteSelected'),
          shortcut: 'Del',
          action: async () => {
            const confirmed = await showConfirm(t('dialog.confirmDelete'));
            if (confirmed) void onDelete();
          },
        },
      ],
    },
    roadMenuItems,
    t,
  );

  return <MenuSection menu={menu} {...menuProps} />;
}
