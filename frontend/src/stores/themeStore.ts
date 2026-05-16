import { create } from 'zustand';
import { STORAGE_KEYS } from '../constants/storage';

export type Theme = 'dark' | 'light';

interface ThemeState {
  theme: Theme;
  toggleTheme: () => void;
  initTheme: () => void;
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function syncNativeTheme(theme: Theme): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_window_theme', { theme });
  } catch {
    // Non-critical: native title bar theme sync failure should not break the app
  }
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: 'dark',

  initTheme: () => {
    const saved = localStorage.getItem(STORAGE_KEYS.THEME) as Theme | null;
    const theme = saved ?? 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    set({ theme });
    void syncNativeTheme(theme);
  },

  toggleTheme: () =>
    set((state) => {
      const next: Theme = state.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem(STORAGE_KEYS.THEME, next);
      document.documentElement.setAttribute('data-theme', next);
      void syncNativeTheme(next);
      return { theme: next };
    }),
}));
