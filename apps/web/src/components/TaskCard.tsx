import React, { useRef } from 'react';
import { Edit, Trash, Move } from 'lucide-react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import type { Task } from '../types';

export default function TaskCard({ task, projectId, onEdit, onDelete, onMove, onMoveToNewProject }: {
  task: Task;
  projectId: string;
  onEdit: () => void;
  onDelete: () => void;
  onMove: () => void;
  onMoveToNewProject: () => void;
}) {
  const draggable = useDraggable({
    id: task.id,
    data: { type: 'task' },
  });
  const droppable = useDroppable({ id: task.id, data: { type: 'task' } });
  const nodeRef = useRef<HTMLElement | null>(null);

  const comboRef = (el: HTMLElement | null) => {
    draggable.setNodeRef(el);
    droppable.setNodeRef(el);
    nodeRef.current = el;
  };

  return (
    <div
      className={`task-card ${draggable.isDragging ? 'dragging' : ''}`}
      ref={comboRef}
      {...draggable.attributes}
      {...draggable.listeners}
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onEdit()}
    >
      <div className="task-title">{task.title}</div>
      {task.description && <div className="task-description">{task.description}</div>}
      <div className="task-actions">
        <button className="btn btn-secondary btn-small" onClick={e => { e.stopPropagation(); onEdit(); }} aria-label="Edit task"><Edit size={12} /> Edit</button>
        <button className="btn btn-danger btn-small" onClick={e => { e.stopPropagation(); onDelete(); }} aria-label="Delete task"><Trash size={12} /> Delete</button>
        <button className="btn btn-secondary btn-small" onClick={e => { e.stopPropagation(); onMove(); }} aria-label="Move task"><Move size={12} /> Move</button>
      </div>
      <div className="task-actions" style={{ opacity: 1, marginTop: '4px' }}>
        <button className="btn btn-secondary btn-small" onClick={e => { e.stopPropagation(); onMoveToNewProject(); }}>Move to new project</button>
      </div>
    </div>
  );
}
