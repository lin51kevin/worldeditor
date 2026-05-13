import { create } from 'zustand';

interface LoadingState {
  isLoading: boolean;
  message: string;
  _count: number;
  showLoading: (message?: string) => void;
  hideLoading: () => void;
}

export const useLoadingStore = create<LoadingState>((set) => ({
  isLoading: false,
  message: '',
  _count: 0,
  showLoading: (message = 'Loading...') =>
    set((state) => {
      const newCount = state._count + 1;
      return {
        _count: newCount,
        isLoading: true,
        // Only update message on the first show (outermost layer)
        message: newCount === 1 ? message : state.message,
      };
    }),
  hideLoading: () =>
    set((state) => {
      const newCount = Math.max(0, state._count - 1);
      return {
        _count: newCount,
        isLoading: newCount > 0,
        message: newCount > 0 ? state.message : '',
      };
    }),
}));
