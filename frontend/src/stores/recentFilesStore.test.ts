import { describe, it, expect, beforeEach } from 'vitest';
import { useRecentFilesStore } from './recentFilesStore';

describe('recentFilesStore', () => {
  beforeEach(() => {
    useRecentFilesStore.getState().clear();
    localStorage.clear();
  });

  describe('push', () => {
    it('should add a file to the list', () => {
      useRecentFilesStore.getState().push('file.xodr', '/path/file.xodr');
      const files = useRecentFilesStore.getState().recentFiles;
      expect(files).toHaveLength(1);
      expect(files[0]!.name).toBe('file.xodr');
    });

    it('should prepend new file at front', () => {
      useRecentFilesStore.getState().push('a.xodr', '/a');
      useRecentFilesStore.getState().push('b.xodr', '/b');
      expect(useRecentFilesStore.getState().recentFiles[0]!.name).toBe('b.xodr');
    });

    it('should deduplicate by path — move existing to top', () => {
      useRecentFilesStore.getState().push('file.xodr', '/path/file.xodr');
      useRecentFilesStore.getState().push('other.xodr', '/other');
      useRecentFilesStore.getState().push('file.xodr', '/path/file.xodr'); // re-push same path
      const files = useRecentFilesStore.getState().recentFiles;
      expect(files).toHaveLength(2);
      expect(files[0]!.path).toBe('/path/file.xodr');
    });

    it('should trim to MAX 8 entries', () => {
      for (let i = 0; i < 10; i++) {
        useRecentFilesStore.getState().push(`file${i}.xodr`, `/path${i}`);
      }
      expect(useRecentFilesStore.getState().recentFiles).toHaveLength(8);
    });

    it('should set lastOpened to a recent timestamp', () => {
      const before = Date.now();
      useRecentFilesStore.getState().push('f.xodr', '/f');
      const ts = useRecentFilesStore.getState().recentFiles[0]!.lastOpened;
      expect(ts).toBeGreaterThanOrEqual(before);
    });
  });

  describe('remove', () => {
    it('should remove entry by path', () => {
      useRecentFilesStore.getState().push('a.xodr', '/a');
      useRecentFilesStore.getState().push('b.xodr', '/b');
      useRecentFilesStore.getState().remove('/a');
      const files = useRecentFilesStore.getState().recentFiles;
      expect(files.find((f) => f.path === '/a')).toBeUndefined();
      expect(files).toHaveLength(1);
    });

    it('should do nothing if path not found', () => {
      useRecentFilesStore.getState().push('a.xodr', '/a');
      useRecentFilesStore.getState().remove('/nonexistent');
      expect(useRecentFilesStore.getState().recentFiles).toHaveLength(1);
    });
  });

  describe('clear', () => {
    it('should empty the list', () => {
      useRecentFilesStore.getState().push('a.xodr', '/a');
      useRecentFilesStore.getState().clear();
      expect(useRecentFilesStore.getState().recentFiles).toHaveLength(0);
    });
  });
});
