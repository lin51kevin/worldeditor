import { create } from 'zustand';

export type Theme = 'dark' | 'light';

interface ThemeState {
  theme: Theme;
  toggleTheme: () => void;
  initTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: 'dark',

  initTheme: () => {
    const saved = localStorage.getItem('we-theme') as Theme | null;
    const theme = saved ?? 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    set({ theme });
  },

  toggleTheme: () =>
    set((state) => {
      const next: Theme = state.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('we-theme', next);
      document.documentElement.setAttribute('data-theme', next);
      return { theme: next };
    }),
}));
