import { create } from 'zustand';

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
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setTheme(theme);
  } catch {
    // Non-critical: native title bar theme sync failure should not break the app
  }
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: 'dark',

  initTheme: () => {
    const saved = localStorage.getItem('we-theme') as Theme | null;
    const theme = saved ?? 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    set({ theme });
    void syncNativeTheme(theme);
  },

  toggleTheme: () =>
    set((state) => {
      const next: Theme = state.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('we-theme', next);
      document.documentElement.setAttribute('data-theme', next);
      void syncNativeTheme(next);
      return { theme: next };
    }),
}));
