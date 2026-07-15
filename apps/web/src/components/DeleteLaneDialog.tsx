import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { Lane } from '../types';

export default function DeleteLaneDialog({ laneId, projectId, lanes, onClose, onConfirm }: {
  laneId: string;
  projectId: string;
  lanes: Lane[];
  onClose: () => void;
  onConfirm: (targetId: string) => void;
}) {
  const [targetId, setTargetId] = React.useState(lanes.find(l => l.id !== laneId)?.id || '');
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.querySelector('select')?.focus();
    const handleEscape = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <div className="dialog-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="delete-lane-title">
        <button className="dialog-close btn-icon" onClick={onClose} aria-label="Close dialog"><X size={20} /></button>
        <h2 className="dialog-title" id="delete-lane-title">Delete Lane</h2>
        <p>This lane will be deleted. Tasks will be moved to:</p>
        <select value={targetId} onChange={e => setTargetId(e.target.value)} style={{ marginTop: '8px', width: '100%' }}>
          {lanes.filter(l => l.id !== laneId).map(l => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <div className="dialog-actions">
          <button className="btn btn-danger" onClick={() => onConfirm(targetId)}>Delete</button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
