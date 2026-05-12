import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogHost } from './Dialog';
import { useDialogStore } from '../../stores/dialogStore';

// Helper: push a dialog directly into the store
function pushDialog(type: 'alert' | 'confirm' | 'prompt', message: string, opts?: {
  title?: string;
  defaultValue?: string;
}) {
  return new Promise<string | boolean | null>((resolve) => {
    act(() => {
      useDialogStore.getState().pushDialog({
        id: `test-${Date.now()}-${Math.random()}`,
        type,
        message,
        ...opts,
        resolve,
      });
    });
  });
}

describe('DialogHost', () => {
  beforeEach(() => {
    act(() => {
      useDialogStore.setState({ dialogs: [] });
    });
  });

  // ── Renders nothing when queue is empty ──────────────────────────────────

  it('renders nothing when there are no pending dialogs', () => {
    const { container } = render(<DialogHost />);
    expect(container.firstChild).toBeNull();
  });

  // ── AlertDialog ───────────────────────────────────────────────────────────

  it('renders alert message and OK button', async () => {
    const promise = pushDialog('alert', 'Something happened');
    render(<DialogHost />);
    expect(screen.getByText('Something happened')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确定' })).toBeInTheDocument();
    // Resolve so the test doesn't hang
    act(() => useDialogStore.getState().resolveDialog(
      useDialogStore.getState().dialogs[0]!.id, null
    ));
    await promise;
  });

  it('alert: renders title when provided', async () => {
    const promise = pushDialog('alert', 'Body text', { title: 'Alert Title' });
    render(<DialogHost />);
    expect(screen.getByText('Alert Title')).toBeInTheDocument();
    act(() => useDialogStore.getState().dismissDialog(useDialogStore.getState().dialogs[0]!.id));
    await promise;
  });

  it('alert: OK button click resolves and removes dialog', async () => {
    const promise = pushDialog('alert', 'Clicked');
    render(<DialogHost />);
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    await promise;
    expect(screen.queryByText('Clicked')).not.toBeInTheDocument();
  });

  it('alert: Enter key resolves the dialog', async () => {
    const promise = pushDialog('alert', 'Press Enter');
    render(<DialogHost />);
    const panel = screen.getByRole('alertdialog');
    fireEvent.keyDown(panel, { key: 'Enter' });
    await promise;
    expect(screen.queryByText('Press Enter')).not.toBeInTheDocument();
  });

  it('alert: Escape key resolves the dialog', async () => {
    const promise = pushDialog('alert', 'Press Escape');
    render(<DialogHost />);
    const panel = screen.getByRole('alertdialog');
    fireEvent.keyDown(panel, { key: 'Escape' });
    await promise;
    expect(screen.queryByText('Press Escape')).not.toBeInTheDocument();
  });

  it('alert: backdrop click resolves the dialog', async () => {
    const promise = pushDialog('alert', 'Backdrop test');
    render(<DialogHost />);
    fireEvent.click(screen.getByTestId('dialog-overlay'));
    await promise;
    expect(screen.queryByText('Backdrop test')).not.toBeInTheDocument();
  });

  // ── ConfirmDialog ─────────────────────────────────────────────────────────

  it('confirm: renders Cancel and Confirm buttons', async () => {
    const promise = pushDialog('confirm', 'Delete this?');
    render(<DialogHost />);
    expect(screen.getByText('Delete this?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认' })).toBeInTheDocument();
    act(() => useDialogStore.getState().dismissDialog(useDialogStore.getState().dialogs[0]!.id));
    await promise;
  });

  it('confirm: Confirm button resolves true', async () => {
    const promise = pushDialog('confirm', 'Sure?');
    render(<DialogHost />);
    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    await expect(promise).resolves.toBe(true);
  });

  it('confirm: Cancel button resolves false', async () => {
    const promise = pushDialog('confirm', 'Sure?');
    render(<DialogHost />);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await expect(promise).resolves.toBe(false);
  });

  it('confirm: Enter key confirms (resolves true)', async () => {
    const promise = pushDialog('confirm', 'Enter confirm');
    render(<DialogHost />);
    const panel = screen.getByRole('dialog');
    fireEvent.keyDown(panel, { key: 'Enter' });
    await expect(promise).resolves.toBe(true);
  });

  it('confirm: Escape key cancels (resolves false)', async () => {
    const promise = pushDialog('confirm', 'Escape cancel');
    render(<DialogHost />);
    const panel = screen.getByRole('dialog');
    fireEvent.keyDown(panel, { key: 'Escape' });
    await expect(promise).resolves.toBe(false);
  });

  it('confirm: backdrop click resolves false', async () => {
    const promise = pushDialog('confirm', 'Backdrop cancel');
    render(<DialogHost />);
    fireEvent.click(screen.getByTestId('dialog-overlay'));
    await expect(promise).resolves.toBe(false);
  });

  it('confirm: destructive styling applied for reset-related messages', async () => {
    const promise = pushDialog('confirm', '重置会丢失所有未保存的修改，确定要重置吗？');
    render(<DialogHost />);
    const confirmBtn = screen.getByRole('button', { name: '确认' });
    expect(confirmBtn.className).toContain('dialog-btn-danger');
    act(() => useDialogStore.getState().dismissDialog(useDialogStore.getState().dialogs[0]!.id));
    await promise;
  });

  it('confirm: primary styling for non-destructive messages', async () => {
    const promise = pushDialog('confirm', 'Save this project?');
    render(<DialogHost />);
    const confirmBtn = screen.getByRole('button', { name: '确认' });
    expect(confirmBtn.className).toContain('dialog-btn-primary');
    act(() => useDialogStore.getState().dismissDialog(useDialogStore.getState().dialogs[0]!.id));
    await promise;
  });

  // ── PromptDialog ──────────────────────────────────────────────────────────

  it('prompt: renders input with defaultValue', async () => {
    const promise = pushDialog('prompt', 'Enter name:', { defaultValue: 'road-1' });
    render(<DialogHost />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('road-1');
    act(() => useDialogStore.getState().dismissDialog(useDialogStore.getState().dialogs[0]!.id));
    await promise;
  });

  it('prompt: OK button resolves with current input value', async () => {
    const promise = pushDialog('prompt', 'Enter name:', { defaultValue: 'old' });
    render(<DialogHost />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'new-name' } });
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    await expect(promise).resolves.toBe('new-name');
  });

  it('prompt: Cancel button resolves null', async () => {
    const promise = pushDialog('prompt', 'Enter name:');
    render(<DialogHost />);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await expect(promise).resolves.toBeNull();
  });

  it('prompt: Enter key resolves with current value', async () => {
    const promise = pushDialog('prompt', 'Enter:', { defaultValue: 'abc' });
    render(<DialogHost />);
    const panel = screen.getByRole('dialog');
    fireEvent.keyDown(panel, { key: 'Enter' });
    await expect(promise).resolves.toBe('abc');
  });

  it('prompt: Escape key resolves null', async () => {
    const promise = pushDialog('prompt', 'Enter:');
    render(<DialogHost />);
    const panel = screen.getByRole('dialog');
    fireEvent.keyDown(panel, { key: 'Escape' });
    await expect(promise).resolves.toBeNull();
  });

  it('prompt: backdrop click does NOT dismiss the dialog', async () => {
    const onResolve = vi.fn();
    act(() => {
      useDialogStore.getState().pushDialog({
        id: 'p1',
        type: 'prompt',
        message: 'Backdrop test',
        resolve: onResolve,
      });
    });
    render(<DialogHost />);
    fireEvent.click(screen.getByTestId('dialog-overlay'));
    expect(onResolve).not.toHaveBeenCalled();
    expect(screen.getByText('Backdrop test')).toBeInTheDocument();
    // Cleanup
    act(() => useDialogStore.getState().dismissDialog('p1'));
  });

  // ── Queue behavior ────────────────────────────────────────────────────────

  it('shows only the first queued dialog at a time', async () => {
    const p1 = pushDialog('alert', 'First dialog');
    const p2 = pushDialog('confirm', 'Second dialog');
    render(<DialogHost />);
    expect(screen.getByText('First dialog')).toBeInTheDocument();
    expect(screen.queryByText('Second dialog')).not.toBeInTheDocument();
    // Dismiss first
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    await p1;
    // Second should now appear
    expect(screen.getByText('Second dialog')).toBeInTheDocument();
    act(() => useDialogStore.getState().dismissDialog(useDialogStore.getState().dialogs[0]!.id));
    await p2;
  });

  // ── Focus trap ────────────────────────────────────────────────────────────

  it('focus trap: Tab from last focusable element wraps to first', async () => {
    const promise = pushDialog('confirm', 'Focus trap test');
    render(<DialogHost />);
    const panel = screen.getByRole('dialog');
    const buttons = panel.querySelectorAll('button');
    const lastBtn = buttons[buttons.length - 1] as HTMLElement;
    lastBtn.focus();
    expect(document.activeElement).toBe(lastBtn);
    fireEvent.keyDown(panel, { key: 'Tab', shiftKey: false });
    // After wrapping, first button should be focused
    expect(document.activeElement).toBe(buttons[0]);
    act(() => useDialogStore.getState().dismissDialog(useDialogStore.getState().dialogs[0]!.id));
    await promise;
  });

  it('focus trap: Shift+Tab from first focusable element wraps to last', async () => {
    const promise = pushDialog('confirm', 'Focus trap reverse');
    render(<DialogHost />);
    const panel = screen.getByRole('dialog');
    const buttons = panel.querySelectorAll('button');
    const firstBtn = buttons[0] as HTMLElement;
    firstBtn.focus();
    expect(document.activeElement).toBe(firstBtn);
    fireEvent.keyDown(panel, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
    act(() => useDialogStore.getState().dismissDialog(useDialogStore.getState().dialogs[0]!.id));
    await promise;
  });
});
