import { create } from 'zustand';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastEntry {
  id: string;
  message: string;
  variant: ToastVariant;
  duration: number;
}

interface ToastState {
  toasts: ToastEntry[];
  pushToast: (entry: Omit<ToastEntry, 'id'>) => string;
  dismissToast: (id: string) => void;
  clearToasts: () => void;
}

let _counter = 0;
function nextId(): string {
  return `toast-${++_counter}`;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  pushToast: (entry) => {
    const id = nextId();
    set((state) => ({ toasts: [...state.toasts, { id, ...entry }] }));
    return id;
  },

  dismissToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },

  clearToasts: () => set({ toasts: [] }),
}));
