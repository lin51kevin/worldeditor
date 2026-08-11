import { useToastStore } from '../stores/toastStore';
import type { ToastVariant } from '../stores/toastStore';

const DEFAULT_DURATION = 4000;

function show(message: string, variant: ToastVariant, duration: number): string {
  return useToastStore.getState().pushToast({ message, variant, duration });
}

/** Show a transient, non-blocking success notification (auto-dismisses). */
export function toastSuccess(message: string, duration = DEFAULT_DURATION): string {
  return show(message, 'success', duration);
}

/** Show a transient, non-blocking error notification (auto-dismisses). */
export function toastError(message: string, duration = DEFAULT_DURATION): string {
  return show(message, 'error', duration);
}

/** Show a transient, non-blocking informational notification (auto-dismisses). */
export function toastInfo(message: string, duration = DEFAULT_DURATION): string {
  return show(message, 'info', duration);
}
