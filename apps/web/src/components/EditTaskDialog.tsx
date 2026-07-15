import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../api';
import { triggerToast } from '../App';

export default function EditTaskDialog({ taskId, projectId, onClose, onUpdated }: {
  taskId: string;
  projectId: string;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const taskQuery = useQuery({ queryKey: ['task', taskId], queryFn: () => api.tasks.get(projectId, taskId) });
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const updateMut = useMutation({
    mutationFn: (data: { title?: string; description?: string; expectedVersion: number }) => api.tasks.update(projectId, taskId, data),
    onSuccess: () => { triggerToast('Task updated', 'success'); onUpdated(); },
    onError: (e: any) => triggerToast(e.errors?.[0]?.message || 'Failed to update', 'danger'),
  });

  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (taskQuery.data) {
      setTitle(taskQuery.data.title);
      setDescription(taskQuery.data.description || '');
    }
  }, [taskQuery.data]);

  if (taskQuery.isLoading) return <div className="loading">Loading...</div>;

  return (
    <div className="dialog-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="edit-task-title">
        <button className="dialog-close btn-icon" onClick={onClose} aria-label="Close dialog"><X size={20} /></button>
        <h2 className="dialog-title" id="edit-task-title">Edit Task</h2>
        <form className="dialog-form" onSubmit={e => { e.preventDefault(); updateMut.mutate({ title, description, expectedVersion: taskQuery.data?.version ?? 0 }); }}>
          <div className="form-field">
            <label htmlFor="edit-task-title-input">Title</label>
            <input id="edit-task-title-input" value={title} onChange={e => setTitle(e.target.value)} required maxLength={200} />
          </div>
          <div className="form-field">
            <label htmlFor="edit-task-desc">Description</label>
            <textarea id="edit-task-desc" value={description} onChange={e => setDescription(e.target.value)} maxLength={1000} rows={3} />
          </div>
          <div className="dialog-actions">
            <button type="submit" className="btn btn-primary">Save</button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
