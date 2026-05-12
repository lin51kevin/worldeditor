import { create } from 'zustand';

export type DialogType = 'alert' | 'confirm' | 'prompt';

export interface DialogRequest {
  id: string;
  type: DialogType;
  title?: string;
  message: string;
  defaultValue?: string;
  resolve: (value: string | boolean | null) => void;
}

interface DialogState {
  dialogs: DialogRequest[];
  pushDialog: (req: DialogRequest) => void;
  resolveDialog: (id: string, value: string | boolean | null) => void;
  dismissDialog: (id: string) => void;
}

export const useDialogStore = create<DialogState>((set, get) => ({
  dialogs: [],

  pushDialog: (req) => {
    set((state) => ({ dialogs: [...state.dialogs, req] }));
  },

  resolveDialog: (id, value) => {
    const req = get().dialogs.find((d) => d.id === id);
    if (req) {
      req.resolve(value);
      set((state) => ({ dialogs: state.dialogs.filter((d) => d.id !== id) }));
    }
  },

  dismissDialog: (id) => {
    const req = get().dialogs.find((d) => d.id === id);
    if (req) {
      req.resolve(null);
      set((state) => ({ dialogs: state.dialogs.filter((d) => d.id !== id) }));
    }
  },
}));
