import { beforeEach, describe, expect, it, vi } from 'vitest';
import { showAlert, showConfirm } from '../../utils/dialog';
import {
  checkDesktopUpdate,
  checkForUpdate,
  installDesktopUpdate,
  isDesktopRuntime,
  type DesktopUpdate,
} from '../../services/updateService';
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
  showConfirm: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../services/updateService', () => ({
  isDesktopRuntime: vi.fn(() => false),
  checkForUpdate: vi.fn().mockResolvedValue(null),
  checkDesktopUpdate: vi.fn().mockResolvedValue(null),
  installDesktopUpdate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../buildInfo', () => ({
  buildInfo: {
    version: '0.3.0',
    buildTime: '2026-05-26T07:00:00.000Z',
    gitCommit: 'abc1234',
    gitBranch: 'main',
  },
}));

const t = (key: string) => ({
  'app.title': 'WorldEditor',
  'dialog.version': 'Version',
  'dialog.aboutTitle': 'About',
  'dialog.buildDate': 'Build Date',
  'dialog.commitId': 'Commit',
  'dialog.branch': 'Branch',
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
      expect.stringContaining('0.3.0'),
      'About',
    );
    expect(vi.mocked(showAlert)).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('abc1234'),
      'About',
    );
    expect(vi.mocked(showAlert)).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('0.3.0'),
      'Version Info',
    );
    expect(vi.mocked(showAlert)).toHaveBeenNthCalledWith(3, 'Manual content', 'User Manual');
    expect(vi.mocked(showAlert)).toHaveBeenNthCalledWith(
      4,
      'update.upToDate',
      'Check for Updates',
    );
  });

  it('installs a desktop update after the user confirms', async () => {
    const update = {
      version: '0.4.0',
      currentVersion: '0.3.0',
      body: 'New stuff',
      downloadAndInstall: vi.fn(),
    } as unknown as DesktopUpdate;
    vi.mocked(isDesktopRuntime).mockReturnValue(true);
    vi.mocked(checkDesktopUpdate).mockResolvedValue(update);
    vi.mocked(showConfirm).mockResolvedValue(true);

    await checkForUpdates(t);

    expect(checkDesktopUpdate).toHaveBeenCalledTimes(1);
    expect(installDesktopUpdate).toHaveBeenCalledWith(update);
  });

  it('skips installation when the user declines a desktop update', async () => {
    const update = { version: '0.4.0', currentVersion: '0.3.0', downloadAndInstall: vi.fn() } as unknown as DesktopUpdate;
    vi.mocked(isDesktopRuntime).mockReturnValue(true);
    vi.mocked(checkDesktopUpdate).mockResolvedValue(update);
    vi.mocked(showConfirm).mockResolvedValue(false);

    await checkForUpdates(t);

    expect(installDesktopUpdate).not.toHaveBeenCalled();
  });

  it('reports the error when a desktop update check throws', async () => {
    vi.mocked(isDesktopRuntime).mockReturnValue(true);
    vi.mocked(checkDesktopUpdate).mockRejectedValue(new Error('network down'));

    await checkForUpdates(t);

    expect(vi.mocked(showAlert)).toHaveBeenCalledWith('update.error', 'Check for Updates');
    expect(installDesktopUpdate).not.toHaveBeenCalled();
  });

  it('opens the download page on web when an update is available and confirmed', async () => {
    vi.mocked(isDesktopRuntime).mockReturnValue(false);
    vi.mocked(checkForUpdate).mockResolvedValue({
      latestVersion: '0.4.0',
      releaseUrl: 'https://github.com/lin51kevin/worldeditor/releases/tag/v0.4.0',
      releaseNotes: 'notes',
    });
    vi.mocked(showConfirm).mockResolvedValue(true);
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    await checkForUpdates(t);

    expect(openSpy).toHaveBeenCalledWith(
      'https://github.com/lin51kevin/worldeditor/releases/tag/v0.4.0',
      '_blank',
      'noopener,noreferrer',
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
