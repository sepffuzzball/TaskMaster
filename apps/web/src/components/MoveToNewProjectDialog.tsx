import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { Task } from '../types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { triggerToast } from '../App';

export default function MoveToNewProjectDialog({ task, onClose }: {
  task: Task;
  onClose: () => void;
}) {
  const [projectName, setProjectName] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const moveMut = useMutation({
    mutationFn: (data: { projectName: string; expectedVersion: number }) => api.tasks.moveToNewProject(task.id, data)
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
      <div className="dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="move-to-new-title">
        <button className="dialog-close btn-icon" onClick={onClose} aria-label="Close dialog"><X size={20} /></button>
        <h2 className="dialog-title" id="move-to-new-title">Move to New Project</h2>
        {error && <div style={{ color: 'var(--danger)', marginBottom: '8px' }}>{error}</div>}
        <div className="dialog-form">
          <div className="form-field">
            <label htmlFor="new-project-name">New project name</label>
            <input id="new-project-name" value={projectName} onChange={e => setProjectName(e.target.value)} maxLength={100} />
          </div>
          <div className="dialog-actions">
            <button className="btn btn-primary" onClick={() => {
              setError(null);
              moveMut.mutateAsync({ projectName, expectedVersion: task.version })
                .then((response: any) => {
                  queryClient.invalidateQueries({ queryKey: ['tasks', task.projectId] });
                  queryClient.invalidateQueries({ queryKey: ['projects'] });
                  if (response?.id) {
                    navigate(`/project/${response.id}`);
                  }
                  triggerToast('Task moved to new project', 'success');
                  onClose();
                })
                .catch((e: any) => {
                  setError(e.errors?.[0]?.message || 'Move failed');
                  triggerToast(e.errors?.[0]?.message || 'Move failed', 'danger');
                });
            }}>Create & Move</button>
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
