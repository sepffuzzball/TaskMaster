import React, { useEffect, useRef } from 'react';
import { Plus, X } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../api';
import { triggerToast } from '../App';

export default function AddTaskDialog({ laneId, projectId, onClose, onCreated }: {
  laneId: string;
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const createMut = useMutation({
    mutationFn: (data: { title: string; description?: string }) => api.tasks.create(projectId, laneId, data),
    onSuccess: () => { triggerToast('Task created', 'success'); onCreated(); },
    onError: (e: any) => triggerToast(e.errors?.[0]?.message || 'Failed to create task', 'danger'),
  });

  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.querySelector('input')?.focus();
    const handleEscape = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <div className="dialog-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="add-task-title">
        <button className="dialog-close btn-icon" onClick={onClose} aria-label="Close dialog"><X size={20} /></button>
        <h2 className="dialog-title" id="add-task-title">Add Task</h2>
        <form className="dialog-form" onSubmit={e => { e.preventDefault(); createMut.mutate({ title, description }); }}>
          <div className="form-field">
            <label htmlFor="task-title">Title</label>
            <input id="task-title" value={title} onChange={e => setTitle(e.target.value)} required maxLength={200} />
          </div>
          <div className="form-field">
            <label htmlFor="task-description">Description (optional)</label>
            <textarea id="task-description" value={description} onChange={e => setDescription(e.target.value)} maxLength={1000} rows={3} />
          </div>
          <div className="dialog-actions">
            <button type="submit" className="btn btn-primary">Create</button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
