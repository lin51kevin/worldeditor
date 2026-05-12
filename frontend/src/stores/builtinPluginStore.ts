/**
 * Builtin Plugin State Store
 *
 * Tracks which built-in plugins are currently disabled.
 * App.tsx subscribes to this store and conditionally mounts/unmounts
 * built-in plugin contributions (toolbar buttons, menu items, template sections).
 */
import { create } from 'zustand';

interface BuiltinPluginState {
  disabledBuiltins: string[];
  disableBuiltin: (id: string) => void;
  enableBuiltin: (id: string) => void;
  isDisabled: (id: string) => boolean;
}

export const useBuiltinPluginStore = create<BuiltinPluginState>((set, get) => ({
  disabledBuiltins: [],

  disableBuiltin: (id) =>
    set((state) => ({
      disabledBuiltins: state.disabledBuiltins.includes(id)
        ? state.disabledBuiltins
        : [...state.disabledBuiltins, id],
    })),

  enableBuiltin: (id) =>
    set((state) => ({
      disabledBuiltins: state.disabledBuiltins.filter((i) => i !== id),
    })),

  isDisabled: (id) => get().disabledBuiltins.includes(id),
}));
