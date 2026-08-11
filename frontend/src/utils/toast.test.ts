import { describe, expect, it, beforeEach } from 'vitest';
import { useToastStore } from '../stores/toastStore';
import { toastSuccess, toastError, toastInfo } from './toast';

describe('toast helpers', () => {
  beforeEach(() => {
    useToastStore.getState().clearToasts();
  });

  it('toastSuccess pushes a success-variant toast with default duration', () => {
    toastSuccess('Saved successfully');
    const [toast] = useToastStore.getState().toasts;
    expect(toast).toMatchObject({ message: 'Saved successfully', variant: 'success', duration: 4000 });
  });

  it('toastError pushes an error-variant toast', () => {
    toastError('Save failed');
    const [toast] = useToastStore.getState().toasts;
    expect(toast).toMatchObject({ message: 'Save failed', variant: 'error', duration: 4000 });
  });

  it('toastInfo pushes an info-variant toast', () => {
    toastInfo('No road found here');
    const [toast] = useToastStore.getState().toasts;
    expect(toast).toMatchObject({ message: 'No road found here', variant: 'info', duration: 4000 });
  });

  it('accepts a custom duration', () => {
    toastError('Persistent error', 8000);
    const [toast] = useToastStore.getState().toasts;
    expect(toast?.duration).toBe(8000);
  });
});
