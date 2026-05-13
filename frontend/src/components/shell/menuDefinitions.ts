import type { MenuItemContrib } from '../../stores/pluginContribStore';
import { showAlert } from '../../utils/dialog';

export type TranslateFn = (key: string) => string;

export interface MenuItem {
  label: string;
  shortcut?: string;
  action?: () => void;
  separator?: boolean;
  disabled?: boolean;
  checked?: boolean;
  submenu?: MenuItem[];
}

export interface Menu {
  label: string;
  items: MenuItem[];
}

export async function showAbout(t: TranslateFn) {
  const version = '1.8.0430';
  await showAlert(`${t('app.title')}\n\n${t('dialog.version')}: ${version}`, t('dialog.aboutTitle'));
}

export async function showVersion(t: TranslateFn) {
  const version = '1.8.0430';
  const buildDate = '2024-12-12';
  await showAlert(
    `${t('dialog.version')}: ${version}\n${t('dialog.buildDate')}: ${buildDate}`,
    t('dialog.versionTitle'),
  );
}

export async function showUserManual(t: TranslateFn) {
  await showAlert(t('dialog.userManualContent'), t('dialog.userManualTitle'));
}

export async function checkForUpdates(t: TranslateFn) {
  // TODO: [Phase D4] Implement real version check via GitHub Releases API
  await showAlert('Update check: coming in a future version.', t('menu.checkForUpdates'));
}

function toPluginMenuItem(item: MenuItemContrib, t: TranslateFn): MenuItem {
  return {
    label: t(item.labelKey),
    shortcut: item.shortcut,
    action: item.onClick,
    disabled: item.isDisabled?.() ?? false,
  };
}

export function appendPluginItems(menu: Menu, items: MenuItemContrib[], t: TranslateFn): Menu {
  if (items.length === 0) return menu;
  return {
    ...menu,
    items: [...menu.items, { separator: true, label: '' }, ...items.map((item) => toPluginMenuItem(item, t))],
  };
}

export function appendRoadItemsToEdit(menu: Menu, items: MenuItemContrib[], t: TranslateFn): Menu {
  if (items.length === 0) return menu;
  return {
    ...menu,
    items: [...menu.items, { separator: true, label: '' }, ...buildGroupedRoadItems(items, t)],
  };
}

const ROAD_GROUP_ORDER = ['', 'transform', 'edit', 'advanced', 'deploy', 'infrastructure', 'junction'];

function buildGroupedRoadItems(items: MenuItemContrib[], t: TranslateFn): MenuItem[] {
  const realItems = items.filter((item) => !item.separator);

  const groups = new Map<string, MenuItemContrib[]>();
  for (const item of realItems) {
    const group = item.group ?? '';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(item);
  }

  const sortedKeys = [...groups.keys()].sort((a, b) => {
    const ai = ROAD_GROUP_ORDER.indexOf(a);
    const bi = ROAD_GROUP_ORDER.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  const result: MenuItem[] = [];
  let firstGroup = true;
  for (const key of sortedKeys) {
    if (!firstGroup) result.push({ separator: true, label: '' });
    firstGroup = false;
    for (const item of groups.get(key)!) {
      result.push({
        label: t(item.labelKey),
        shortcut: item.shortcut,
        action: item.onClick,
        disabled: item.isDisabled?.() ?? false,
      });
    }
  }

  return result;
}
