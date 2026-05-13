/**
 * Shared store for recently opened files.
 * Single source of truth used by App.tsx (WelcomePage) and MenuBar.tsx.
 */

import { create } from 'zustand';

export interface RecentFile {
  name: string;
  path: string;
  lastOpened: number;
}

const KEY = 'we_recent_files';
const MAX = 10;

function loadFromStorage(): RecentFile[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown[];
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item): RecentFile | null => {
        if (typeof item !== 'object' || item === null) return null;
        const r = item as Record<string, unknown>;
        // Support both old format { displayName, path } and new { name, path, lastOpened }
        const name = (typeof r.name === 'string' ? r.name : null) ??
                     (typeof r.displayName === 'string' ? r.displayName : null);
        const path = typeof r.path === 'string' ? r.path : null;
        if (!name || !path) return null;
        return { name, path, lastOpened: typeof r.lastOpened === 'number' ? r.lastOpened : 0 };
      })
      .filter((x): x is RecentFile => x !== null);
  } catch {
    return [];
  }
}

function persist(files: RecentFile[]): void {
  localStorage.setItem(KEY, JSON.stringify(files));
}

interface RecentFilesState {
  recentFiles: RecentFile[];
  /** Add or refresh a file at the top of the list. */
  push: (name: string, path: string) => void;
  /** Remove one entry by path. */
  remove: (path: string) => void;
  /** Clear all entries. */
  clear: () => void;
}

export const useRecentFilesStore = create<RecentFilesState>((set, get) => ({
  recentFiles: loadFromStorage(),
  push(name, path) {
    const updated = [
      { name, path, lastOpened: Date.now() },
      ...get().recentFiles.filter((f) => f.path !== path),
    ].slice(0, MAX);
    persist(updated);
    set({ recentFiles: updated });
  },
  remove(path) {
    const updated = get().recentFiles.filter((f) => f.path !== path);
    persist(updated);
    set({ recentFiles: updated });
  },
  clear() {
    persist([]);
    set({ recentFiles: [] });
  },
}));
