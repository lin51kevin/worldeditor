import { describe, expect, it, beforeEach } from 'vitest';
import { useToastStore } from './toastStore';

describe('toastStore', () => {
  beforeEach(() => {
    useToastStore.getState().clearToasts();
  });

  it('starts with no toasts', () => {
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it('pushToast adds a toast and returns its id', () => {
    const id = useToastStore.getState().pushToast({ message: 'Saved', variant: 'success', duration: 4000 });
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toEqual({ id, message: 'Saved', variant: 'success', duration: 4000 });
  });

  it('pushToast appends multiple toasts in order', () => {
    useToastStore.getState().pushToast({ message: 'first', variant: 'info', duration: 1000 });
    useToastStore.getState().pushToast({ message: 'second', variant: 'error', duration: 1000 });
    const toasts = useToastStore.getState().toasts;
    expect(toasts.map((t) => t.message)).toEqual(['first', 'second']);
  });

  it('pushToast assigns unique ids to each toast', () => {
    const id1 = useToastStore.getState().pushToast({ message: 'a', variant: 'info', duration: 1000 });
    const id2 = useToastStore.getState().pushToast({ message: 'b', variant: 'info', duration: 1000 });
    expect(id1).not.toBe(id2);
  });

  it('dismissToast removes only the matching toast', () => {
    const id1 = useToastStore.getState().pushToast({ message: 'a', variant: 'info', duration: 1000 });
    const id2 = useToastStore.getState().pushToast({ message: 'b', variant: 'info', duration: 1000 });
    useToastStore.getState().dismissToast(id1);
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.id).toBe(id2);
  });

  it('dismissToast is a no-op for an unknown id', () => {
    useToastStore.getState().pushToast({ message: 'a', variant: 'info', duration: 1000 });
    useToastStore.getState().dismissToast('nonexistent');
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it('clearToasts removes all toasts', () => {
    useToastStore.getState().pushToast({ message: 'a', variant: 'info', duration: 1000 });
    useToastStore.getState().pushToast({ message: 'b', variant: 'info', duration: 1000 });
    useToastStore.getState().clearToasts();
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});
