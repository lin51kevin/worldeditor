import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDialogStore } from './dialogStore';

/** Type-safe accessor for the first queued dialog in tests. */
function firstDialog() {
  return useDialogStore.getState().dialogs[0]!;
}

describe('dialogStore', () => {
  beforeEach(() => {
    useDialogStore.setState({ dialogs: [] });
  });

  it('pushDialog adds a dialog to the queue', () => {
    const resolve = vi.fn();
    useDialogStore.getState().pushDialog({ id: '1', type: 'alert', message: 'Hello', resolve });
    expect(useDialogStore.getState().dialogs).toHaveLength(1);
    expect(firstDialog().message).toBe('Hello');
    expect(firstDialog().type).toBe('alert');
  });

  it('pushDialog preserves insertion order (FIFO queue)', () => {
    const resolve = vi.fn();
    useDialogStore.getState().pushDialog({ id: '1', type: 'alert', message: 'First', resolve });
    useDialogStore.getState().pushDialog({ id: '2', type: 'confirm', message: 'Second', resolve });
    const { dialogs } = useDialogStore.getState();
    expect(dialogs).toHaveLength(2);
    expect(dialogs[0]!.id).toBe('1');
    expect(dialogs[1]!.id).toBe('2');
  });

  it('pushDialog stores optional title and defaultValue', () => {
    const resolve = vi.fn();
    useDialogStore.getState().pushDialog({
      id: '1',
      type: 'prompt',
      message: 'Name?',
      title: 'Rename',
      defaultValue: 'old-name',
      resolve,
    });
    expect(firstDialog().title).toBe('Rename');
    expect(firstDialog().defaultValue).toBe('old-name');
  });

  it('resolveDialog calls resolve with given value and removes the dialog', () => {
    const resolve = vi.fn();
    useDialogStore.getState().pushDialog({ id: '1', type: 'confirm', message: 'Sure?', resolve });
    useDialogStore.getState().resolveDialog('1', true);
    expect(resolve).toHaveBeenCalledWith(true);
    expect(useDialogStore.getState().dialogs).toHaveLength(0);
  });

  it('resolveDialog does nothing for an unknown id', () => {
    const resolve = vi.fn();
    useDialogStore.getState().pushDialog({ id: '1', type: 'alert', message: 'Hi', resolve });
    useDialogStore.getState().resolveDialog('nonexistent', null);
    expect(resolve).not.toHaveBeenCalled();
    expect(useDialogStore.getState().dialogs).toHaveLength(1);
  });

  it('resolveDialog only removes the matched dialog, leaving others intact', () => {
    const r1 = vi.fn();
    const r2 = vi.fn();
    useDialogStore.getState().pushDialog({ id: '1', type: 'alert', message: 'First', resolve: r1 });
    useDialogStore.getState().pushDialog({ id: '2', type: 'alert', message: 'Second', resolve: r2 });
    useDialogStore.getState().resolveDialog('1', null);
    expect(r1).toHaveBeenCalledWith(null);
    expect(r2).not.toHaveBeenCalled();
    expect(useDialogStore.getState().dialogs).toHaveLength(1);
    expect(useDialogStore.getState().dialogs[0]!.id).toBe('2');
  });

  it('dismissDialog calls resolve with null and removes the dialog', () => {
    const resolve = vi.fn();
    useDialogStore.getState().pushDialog({ id: '1', type: 'alert', message: 'Hi', resolve });
    useDialogStore.getState().dismissDialog('1');
    expect(resolve).toHaveBeenCalledWith(null);
    expect(useDialogStore.getState().dialogs).toHaveLength(0);
  });

  it('dismissDialog only removes the matched dialog', () => {
    const firstResolve = vi.fn();
    const secondResolve = vi.fn();
    useDialogStore.getState().pushDialog({ id: '1', type: 'alert', message: 'First', resolve: firstResolve });
    useDialogStore.getState().pushDialog({ id: '2', type: 'confirm', message: 'Second', resolve: secondResolve });

    useDialogStore.getState().dismissDialog('1');

    expect(firstResolve).toHaveBeenCalledWith(null);
    expect(secondResolve).not.toHaveBeenCalled();
    expect(useDialogStore.getState().dialogs.map((dialog) => dialog.id)).toEqual(['2']);
  });

  it('dismissDialog does nothing for an unknown id', () => {
    useDialogStore.getState().dismissDialog('nonexistent');
    expect(useDialogStore.getState().dialogs).toHaveLength(0);
  });

  it('supports all three dialog types as variants', () => {
    const resolve = vi.fn();
    useDialogStore.getState().pushDialog({ id: '1', type: 'alert', message: 'a', resolve });
    useDialogStore.getState().pushDialog({ id: '2', type: 'confirm', message: 'b', resolve });
    useDialogStore.getState().pushDialog({ id: '3', type: 'prompt', message: 'c', resolve });
    const types = useDialogStore.getState().dialogs.map((d) => d.type);
    expect(types).toEqual(['alert', 'confirm', 'prompt']);
  });
});
