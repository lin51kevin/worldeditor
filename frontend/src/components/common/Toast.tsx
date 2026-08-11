import { useEffect } from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';
import { useToastStore } from '../../stores/toastStore';
import type { ToastEntry, ToastVariant } from '../../stores/toastStore';
import './Toast.css';

const VARIANT_ICON: Record<ToastVariant, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
};

function ToastItem({ toast }: { toast: ToastEntry }) {
  const dismissToast = useToastStore((s) => s.dismissToast);
  const Icon = VARIANT_ICON[toast.variant];

  useEffect(() => {
    if (toast.duration <= 0) return;
    const timer = setTimeout(() => dismissToast(toast.id), toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, dismissToast]);

  return (
    <div className={`toast-item toast-item-${toast.variant}`} role="status">
      <Icon size={16} className="toast-icon" />
      <span className="toast-message">{toast.message}</span>
      <button
        type="button"
        className="toast-dismiss"
        aria-label="Dismiss notification"
        onClick={() => dismissToast(toast.id)}
      >
        <X size={14} />
      </button>
    </div>
  );
}

/** Mount once near the app root; renders all active toast notifications. */
export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);

  return (
    <div className="toast-host" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
