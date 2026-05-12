import { beforeEach, describe, expect, it } from 'vitest';
import { showAlert, showConfirm, showPrompt } from './dialog';
import { useDialogStore } from '../stores/dialogStore';

/** Get first queued dialog — tests always push before accessing */
function firstDialog() {
  return useDialogStore.getState().dialogs[0]!;
}

describe('dialog utilities', () => {
  beforeEach(() => {
    useDialogStore.setState({ dialogs: [] });
  });

  // ── showAlert ──────────────────────────────────────────────────────────────

  it('showAlert enqueues an alert dialog', () => {
    void showAlert('Test message');
    const { dialogs } = useDialogStore.getState();
    expect(dialogs).toHaveLength(1);
    expect(firstDialog().type).toBe('alert');
    expect(firstDialog().message).toBe('Test message');
  });

  it('showAlert passes optional title to the dialog', () => {
    void showAlert('Message', 'My Title');
    expect(firstDialog().title).toBe('My Title');
  });

  it('showAlert resolves void after the dialog is resolved', async () => {
    const promise = showAlert('Done');
    useDialogStore.getState().resolveDialog(firstDialog().id, null);
    await expect(promise).resolves.toBeUndefined();
  });

  // ── showConfirm ────────────────────────────────────────────────────────────

  it('showConfirm enqueues a confirm dialog', () => {
    void showConfirm('Are you sure?');
    expect(firstDialog().type).toBe('confirm');
    expect(firstDialog().message).toBe('Are you sure?');
  });

  it('showConfirm resolves true when resolved with true', async () => {
    const promise = showConfirm('Are you sure?');
    useDialogStore.getState().resolveDialog(firstDialog().id, true);
    await expect(promise).resolves.toBe(true);
  });

  it('showConfirm resolves false when resolved with false', async () => {
    const promise = showConfirm('Are you sure?');
    useDialogStore.getState().resolveDialog(firstDialog().id, false);
    await expect(promise).resolves.toBe(false);
  });

  it('showConfirm resolves false when dismissed (null)', async () => {
    const promise = showConfirm('Are you sure?');
    useDialogStore.getState().dismissDialog(firstDialog().id);
    await expect(promise).resolves.toBe(false);
  });

  // ── showPrompt ─────────────────────────────────────────────────────────────

  it('showPrompt enqueues a prompt dialog with defaultValue', () => {
    void showPrompt('Enter name:', 'default');
    expect(firstDialog().type).toBe('prompt');
    expect(firstDialog().defaultValue).toBe('default');
  });

  it('showPrompt resolves with the entered string', async () => {
    const promise = showPrompt('Enter name:', 'default');
    useDialogStore.getState().resolveDialog(firstDialog().id, 'my-value');
    await expect(promise).resolves.toBe('my-value');
  });

  it('showPrompt resolves null when cancelled (null)', async () => {
    const promise = showPrompt('Enter name:');
    useDialogStore.getState().resolveDialog(firstDialog().id, null);
    await expect(promise).resolves.toBeNull();
  });

  it('showPrompt resolves null when dismissed', async () => {
    const promise = showPrompt('Enter name:');
    useDialogStore.getState().dismissDialog(firstDialog().id);
    await expect(promise).resolves.toBeNull();
  });

  it('showPrompt resolves null when resolved with boolean (non-string)', async () => {
    const promise = showPrompt('Enter name:');
    useDialogStore.getState().resolveDialog(firstDialog().id, false);
    await expect(promise).resolves.toBeNull();
  });

  // ── Queue ordering ─────────────────────────────────────────────────────────

  it('multiple dialogs queue up in insertion order', () => {
    void showAlert('First');
    void showConfirm('Second');
    void showPrompt('Third');
    const types = useDialogStore.getState().dialogs.map((d) => d.type);
    expect(types).toEqual(['alert', 'confirm', 'prompt']);
  });

  it('resolving first dialog exposes the second', async () => {
    const p1 = showAlert('First');
    const p2 = showConfirm('Second');
    useDialogStore.getState().resolveDialog(firstDialog().id, null);
    await p1;
    expect(useDialogStore.getState().dialogs).toHaveLength(1);
    expect(firstDialog().message).toBe('Second');
    useDialogStore.getState().resolveDialog(firstDialog().id, true);
    await expect(p2).resolves.toBe(true);
  });
});
