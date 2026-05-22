import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadRecentFilesStore() {
  vi.resetModules();
  const module = await import('./recentFilesStore');
  return module.useRecentFilesStore;
}

describe('recentFilesStore', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('starts empty when storage has no recent files', async () => {
    const store = await loadRecentFilesStore();
    expect(store.getState().recentFiles).toEqual([]);
  });

  it('push adds a file, moves duplicates to the top, and persists the list', async () => {
    const nowSpy = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(150)
      .mockReturnValueOnce(200);
    const store = await loadRecentFilesStore();

    store.getState().push('a.xodr', 'C:/a.xodr');
    store.getState().push('b.xodr', 'C:/b.xodr');
    store.getState().push('a.xodr', 'C:/a.xodr');

    const files = store.getState().recentFiles;
    expect(files).toHaveLength(2);
    expect(files.map((file) => file.path)).toEqual(['C:/a.xodr', 'C:/b.xodr']);
    expect(files[0]?.lastOpened).toBe(200);
    expect(JSON.parse(localStorage.getItem('we_recent_files') ?? '[]')).toEqual(files);
    expect(nowSpy).toHaveBeenCalledTimes(3);
  });

  it('push keeps only the newest eight entries', async () => {
    const store = await loadRecentFilesStore();

    for (let index = 0; index < 10; index += 1) {
      store.getState().push(`file-${index}.xodr`, `C:/file-${index}.xodr`);
    }

    expect(store.getState().recentFiles).toHaveLength(8);
    expect(store.getState().recentFiles[0]?.path).toBe('C:/file-9.xodr');
    expect(store.getState().recentFiles[7]?.path).toBe('C:/file-2.xodr');
  });

  it('remove deletes one path and persists the updated list', async () => {
    const store = await loadRecentFilesStore();
    store.getState().push('a.xodr', 'C:/a.xodr');
    store.getState().push('b.xodr', 'C:/b.xodr');

    store.getState().remove('C:/a.xodr');

    expect(store.getState().recentFiles.map((file) => file.path)).toEqual(['C:/b.xodr']);
    expect(JSON.parse(localStorage.getItem('we_recent_files') ?? '[]')).toEqual(store.getState().recentFiles);
  });

  it('clear empties the list and storage', async () => {
    const store = await loadRecentFilesStore();
    store.getState().push('a.xodr', 'C:/a.xodr');

    store.getState().clear();

    expect(store.getState().recentFiles).toEqual([]);
    expect(localStorage.getItem('we_recent_files')).toBe('[]');
  });

  it('loads both the new format and the legacy displayName format from storage', async () => {
    localStorage.setItem('we_recent_files', JSON.stringify([
      { name: 'new.xodr', path: 'C:/new.xodr', lastOpened: 123 },
      { displayName: 'legacy.xodr', path: 'C:/legacy.xodr' },
      { path: 'C:/invalid.xodr' },
    ]));

    const store = await loadRecentFilesStore();

    expect(store.getState().recentFiles).toEqual([
      { name: 'new.xodr', path: 'C:/new.xodr', lastOpened: 123 },
      { name: 'legacy.xodr', path: 'C:/legacy.xodr', lastOpened: 0 },
    ]);
  });

  it('falls back to an empty list and warns when stored JSON is invalid', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem('we_recent_files', '{broken-json');

    const store = await loadRecentFilesStore();

    expect(store.getState().recentFiles).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      '[RecentFiles] Failed to parse stored recent files, resetting:',
      expect.any(SyntaxError),
    );
  });
});
