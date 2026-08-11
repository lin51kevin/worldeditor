import type { MenuItemContrib } from '../../../stores/pluginContribStore';
import { useProjectStore } from '../../../stores/projectStore';
import { showConfirm } from '../../../utils/dialog';
import { appendEditPluginItems, type TranslateFn } from '../menuDefinitions';
import { MenuSection, type MenuSectionInteractionProps } from './MenuSection';

type MenuAction = () => void | Promise<void>;

interface EditMenuProps extends MenuSectionInteractionProps {
  t: TranslateFn;
  editMenuItems: MenuItemContrib[];
  canUndo: boolean;
  canRedo: boolean;
  onUndo: MenuAction;
  onRedo: MenuAction;
  onDelete: MenuAction;
}

export function EditMenu({
  t,
  editMenuItems,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onDelete,
  ...menuProps
}: EditMenuProps) {
  const menu = appendEditPluginItems(
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
        { separator: true, label: '' },
        {
          label: t('menu.selectAll'),
          shortcut: 'Ctrl+A',
          action: () => {
            useProjectStore.getState().selectAll();
          },
        },
        {
          label: t('menu.copy'),
          shortcut: 'Ctrl+C',
          action: () => {
            useProjectStore.getState().copySelected();
          },
        },
        {
          label: t('menu.paste'),
          shortcut: 'Ctrl+V',
          action: () => {
            useProjectStore.getState().pasteFromClipboard();
          },
        },
      ],
    },
    editMenuItems,
    t,
  );

  return <MenuSection menu={menu} {...menuProps} />;
}
