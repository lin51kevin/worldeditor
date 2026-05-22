import { create } from 'zustand';

export type LoadingPhase = 'idle' | 'reading' | 'parsing' | 'generating-mesh' | 'done';

interface LoadingProgressState {
  phase: LoadingPhase;
  progress: number; // 0-100
  fileName: string;

  startLoading: (fileName: string) => void;
  updateProgress: (phase: LoadingPhase, progress: number) => void;
  finishLoading: () => void;
  reset: () => void;
}

export const useLoadingProgressStore = create<LoadingProgressState>((set) => ({
  phase: 'idle',
  progress: 0,
  fileName: '',

  startLoading: (fileName: string) =>
    set({ phase: 'reading', progress: 0, fileName }),

  updateProgress: (phase: LoadingPhase, progress: number) =>
    set({ phase, progress: Math.min(100, Math.max(0, progress)) }),

  finishLoading: () =>
    set({ phase: 'done', progress: 100 }),

  reset: () =>
    set({ phase: 'idle', progress: 0, fileName: '' }),
}));
