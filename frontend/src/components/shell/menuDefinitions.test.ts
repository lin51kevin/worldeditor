import { beforeEach, describe, expect, it, vi } from 'vitest';
import { showAlert } from '../../utils/dialog';
import {
  appendPluginItems,
  appendRoadItemsToEdit,
  checkForUpdates,
  showAbout,
  showUserManual,
  showVersion,
  type Menu,
} from './menuDefinitions';

vi.mock('../../utils/dialog', () => ({
  showAlert: vi.fn().mockResolvedValue(undefined),
}));

const t = (key: string) => ({
  'app.title': 'WorldEditor',
  'dialog.version': 'Version',
  'dialog.aboutTitle': 'About',
  'dialog.buildDate': 'Build Date',
  'dialog.versionTitle': 'Version Info',
  'dialog.userManualContent': 'Manual content',
  'dialog.userManualTitle': 'User Manual',
  'menu.checkForUpdates': 'Check for Updates',
  'plugin.cut': 'Cut',
  'plugin.copy': 'Copy',
  'plugin.paste': 'Paste',
  'plugin.transform': 'Transform',
  'plugin.edit': 'Edit',
  'plugin.advanced': 'Advanced',
  'plugin.custom': 'Custom',
}[key] ?? key);

function makeMenu(): Menu {
  return {
    label: 'Edit',
    items: [{ label: 'Undo' }],
  };
}

describe('menuDefinitions helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows about, version, user manual, and update dialogs with expected content', async () => {
    await showAbout(t);
    await showVersion(t);
    await showUserManual(t);
    await checkForUpdates(t);

    expect(vi.mocked(showAlert)).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('WorldEditor'),
      'About',
    );
    expect(vi.mocked(showAlert)).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('Build Date'),
      'Version Info',
    );
    expect(vi.mocked(showAlert)).toHaveBeenNthCalledWith(3, 'Manual content', 'User Manual');
    expect(vi.mocked(showAlert)).toHaveBeenNthCalledWith(
      4,
      'Update check: coming in a future version.',
      'Check for Updates',
    );
  });

  it('appends translated plugin items with separators and disabled state', () => {
    const onClick = vi.fn();
    const menu = appendPluginItems(
      makeMenu(),
      [{ id: 'cut', pluginId: 'plugin', menu: 'edit', labelKey: 'plugin.cut', shortcut: 'Ctrl+X', onClick, isDisabled: () => true }],
      t,
    );

    expect(menu.items).toEqual([
      { label: 'Undo' },
      { separator: true, label: '' },
      { label: 'Cut', shortcut: 'Ctrl+X', action: onClick, disabled: true },
    ]);
    expect(appendPluginItems(makeMenu(), [], t)).toEqual(makeMenu());
  });

  it('groups road edit items by priority order and ignores separator contribs', () => {
    const menu = appendRoadItemsToEdit(
      makeMenu(),
      [
        { id: 'advanced', pluginId: 'plugin', menu: 'edit', labelKey: 'plugin.advanced', group: 'advanced', onClick: vi.fn() },
        { id: 'separator', pluginId: 'plugin', menu: 'edit', labelKey: 'plugin.copy', separator: true, onClick: vi.fn() },
        { id: 'custom', pluginId: 'plugin', menu: 'edit', labelKey: 'plugin.custom', group: 'custom', onClick: vi.fn() },
        { id: 'transform', pluginId: 'plugin', menu: 'edit', labelKey: 'plugin.transform', group: 'transform', onClick: vi.fn() },
        { id: 'edit', pluginId: 'plugin', menu: 'edit', labelKey: 'plugin.edit', group: 'edit', onClick: vi.fn(), isDisabled: () => true },
      ],
      t,
    );

    expect(menu.items.filter((item) => !item.separator).map((item) => item.label)).toEqual([
      'Undo',
      'Transform',
      'Edit',
      'Advanced',
      'Custom',
    ]);
    expect(menu.items.filter((item) => item.separator)).toHaveLength(4);
    expect(menu.items.find((item) => item.label === 'Edit')?.disabled).toBe(true);
  });
});
