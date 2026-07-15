import React, { useEffect, useRef } from 'react';
import { X, Trash } from 'lucide-react';

export default function DeleteConfirmDialog({ message, onConfirm, onCancel }: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.querySelector('button')?.focus();
    const handleEscape = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onCancel]);

  return (
    <div className="dialog-overlay" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
        <button className="dialog-close btn-icon" onClick={onCancel} aria-label="Close dialog"><X size={20} /></button>
        <h2 className="dialog-title" id="confirm-dialog-title">Confirm</h2>
        <p>{message}</p>
        <div className="dialog-actions">
          <button className="btn btn-danger" onClick={onConfirm}>Delete</button>
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
