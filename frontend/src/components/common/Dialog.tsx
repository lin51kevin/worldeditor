import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDialogStore, type DialogRequest } from '../../stores/dialogStore';
import './Dialog.css';

/** Trap Tab focus within a panel element. */
function trapFocus(panel: HTMLElement, e: KeyboardEvent): void {
  if (e.key !== 'Tab') return;
  const focusable = Array.from(
    panel.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])'),
  );
  if (!focusable.length) return;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (e.shiftKey) {
    if (document.activeElement === first) {
      e.preventDefault();
      last.focus();
    }
  } else {
    if (document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

// ---------------------------------------------------------------------------
// Alert
// ---------------------------------------------------------------------------

function AlertDialog({ req, onClose }: { req: DialogRequest; onClose: () => void }) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    btnRef.current?.focus();
  }, []);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const handler = (e: KeyboardEvent) => {
      trapFocus(panel, e);
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    panel.addEventListener('keydown', handler);
    return () => panel.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div ref={panelRef} className="dialog-panel" role="alertdialog" aria-modal="true">
      {req.title && <p className="dialog-title">{req.title}</p>}
      <p className="dialog-message">{req.message}</p>
      <div className="dialog-actions">
        <button ref={btnRef} className="dialog-btn dialog-btn-primary" onClick={onClose}>
          {t('dialog.ok')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm
// ---------------------------------------------------------------------------

function ConfirmDialog({
  req,
  onConfirm,
  onCancel,
}: {
  req: DialogRequest;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const handler = (e: KeyboardEvent) => {
      trapFocus(panel, e);
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        onConfirm();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    panel.addEventListener('keydown', handler);
    return () => panel.removeEventListener('keydown', handler);
  }, [onConfirm, onCancel]);

  const isDestructive =
    req.message.includes('丢失') ||
    req.message.includes('重置') ||
    req.message.includes('删除') ||
    req.message.toLowerCase().includes('discard') ||
    req.message.toLowerCase().includes('reset') ||
    req.message.toLowerCase().includes('delete');

  return (
    <div ref={panelRef} className="dialog-panel" role="dialog" aria-modal="true">
      {req.title && <p className="dialog-title">{req.title}</p>}
      <p className="dialog-message">{req.message}</p>
      <div className="dialog-actions">
        <button className="dialog-btn dialog-btn-ghost" onClick={onCancel}>
          {t('dialog.cancel')}
        </button>
        <button
          ref={confirmRef}
          className={`dialog-btn ${isDestructive ? 'dialog-btn-danger' : 'dialog-btn-primary'}`}
          onClick={onConfirm}
        >
          {t('dialog.confirm')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function PromptDialog({
  req,
  onSubmit,
  onCancel,
}: {
  req: DialogRequest;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(req.defaultValue ?? '');
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const handler = (e: KeyboardEvent) => {
      trapFocus(panel, e);
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        onSubmit(value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    panel.addEventListener('keydown', handler);
    return () => panel.removeEventListener('keydown', handler);
  }, [onSubmit, onCancel, value]);

  return (
    <div ref={panelRef} className="dialog-panel" role="dialog" aria-modal="true">
      {req.title && <p className="dialog-title">{req.title}</p>}
      <p className="dialog-message">{req.message}</p>
      <input
        ref={inputRef}
        className="dialog-input"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="dialog-actions">
        <button className="dialog-btn dialog-btn-ghost" onClick={onCancel}>
          {t('dialog.cancel')}
        </button>
        <button className="dialog-btn dialog-btn-primary" onClick={() => onSubmit(value)}>
          {t('dialog.ok')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DialogHost — mount once in App
// ---------------------------------------------------------------------------

/**
 * Renders the current dialog from the dialog queue.
 * Mount exactly once, inside ErrorBoundary, near the top of the React tree.
 */
export function DialogHost() {
  const dialogs = useDialogStore((s) => s.dialogs);
  const resolveDialog = useDialogStore((s) => s.resolveDialog);

  const current = dialogs[0];
  if (!current) return null;

  const handleOverlayClick = () => {
    // Backdrop click semantics:
    // - alert: dismiss (resolve null, no meaningful value)
    // - confirm: cancel (resolve false — user chose not to confirm)
    // - prompt: no-op (prevent accidental loss of typed input)
    if (current.type === 'alert') {
      resolveDialog(current.id, null);
    } else if (current.type === 'confirm') {
      resolveDialog(current.id, false);
    }
  };

  return (
    <div className="dialog-overlay" onClick={handleOverlayClick} data-testid="dialog-overlay">
      <div onClick={(e) => e.stopPropagation()}>
        {current.type === 'alert' && (
          <AlertDialog req={current} onClose={() => resolveDialog(current.id, null)} />
        )}
        {current.type === 'confirm' && (
          <ConfirmDialog
            req={current}
            onConfirm={() => resolveDialog(current.id, true)}
            onCancel={() => resolveDialog(current.id, false)}
          />
        )}
        {current.type === 'prompt' && (
          <PromptDialog
            req={current}
            onSubmit={(v) => resolveDialog(current.id, v)}
            onCancel={() => resolveDialog(current.id, null)}
          />
        )}
      </div>
    </div>
  );
}
