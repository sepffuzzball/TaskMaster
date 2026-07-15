import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { Lane, Task } from '../types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { triggerToast } from '../App';

export default function MoveTaskDialog({ task, lanes, onClose }: {
  task: Task;
  lanes: Lane[];
  onClose: () => void;
}) {
  const [selectedLaneId, setSelectedLaneId] = React.useState(lanes[0]?.id || '');
  const [error, setError] = React.useState<string | null>(null);
  const queryClient = useQueryClient();
  const moveMut = useMutation({
    mutationFn: (data: { destinationProjectId: string; destinationLaneId: string; expectedVersion: number }) =>
      api.tasks.move(task.id, data)
  });
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.querySelector('select')?.focus();
    const handleEscape = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <div className="dialog-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="move-task-title">
        <button className="dialog-close btn-icon" onClick={onClose} aria-label="Close dialog"><X size={20} /></button>
        <h2 className="dialog-title" id="move-task-title">Move Task</h2>
        {error && <div style={{ color: 'var(--danger)', marginBottom: '8px' }}>{error}</div>}
        <div className="dialog-form">
          <div className="form-field">
            <label htmlFor="move-lane">Destination lane</label>
            <select id="move-lane" value={selectedLaneId} onChange={e => setSelectedLaneId(e.target.value)}>
              {lanes.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div className="dialog-actions">
            <button className="btn btn-primary" onClick={() => {
              setError(null);
              moveMut.mutateAsync({ destinationProjectId: task.projectId, destinationLaneId: selectedLaneId, expectedVersion: task.version })
                .then(() => {
                  queryClient.invalidateQueries({ queryKey: ['tasks', task.projectId] });
                  queryClient.invalidateQueries({ queryKey: ['tasks', task.projectId] });
                  triggerToast('Task moved', 'success');
                  onClose();
                })
                .catch((e: any) => {
                  setError(e.errors?.[0]?.message || 'Move failed');
                  triggerToast(e.errors?.[0]?.message || 'Move failed', 'danger');
                });
            }}>Move</button>
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
