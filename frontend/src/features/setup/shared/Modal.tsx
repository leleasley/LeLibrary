import { useEffect } from 'react';

// Inline confirm modal (the old showConfirmModal pattern): never a browser
// confirm(). Escape cancels.
export function ConfirmModal({ open, title, body, confirmLabel, cancelLabel, danger, onConfirm, onCancel }: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className="app-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="app-modal-box">
        <h3>{title}</h3>
        <p>{body}</p>
        <div className="app-modal-actions">
          <button type="button" className="setup-secondary" onClick={onCancel}>
            {cancelLabel ?? 'Cancel'}
          </button>
          <button type="button" className={danger ? 'btn-danger' : 'setup-primary'} onClick={onConfirm}>
            {confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
