import React, { useState, useRef } from 'react';
import { Trash, Plus } from 'lucide-react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import type { Lane, Task } from '../types';
import TaskCard from './TaskCard';

export default function LaneCard({ lane, tasks, projectId, onRename, onDelete, onAddTask, onAiBreakdown, onEditTask, onDeleteTask, onMoveTask, onMoveToNewProject }: {
  lane: Lane;
  tasks: Task[];
  projectId: string;
  onRename: (name: string) => void;
  onDelete: () => void;
  onAddTask: () => void;
  onAiBreakdown: () => void;
  onEditTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onMoveTask: (id: string) => void;
  onMoveToNewProject: (id: string) => void;
}) {
  const draggable = useDraggable({
    id: lane.id,
    data: { type: 'lane' },
  });
  const droppable = useDroppable({ id: lane.id, data: { type: 'lane' } });
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState(lane.name);

  const comboRef = (el: HTMLElement | null) => {
    draggable.setNodeRef(el);
    droppable.setNodeRef(el);
  };

  return (
    <div className={`lane ${draggable.isDragging ? 'dragging' : ''}`} ref={comboRef}>
      <div className="lane-header" {...draggable.attributes} {...draggable.listeners}>
        {editingName ? (
          <input
            className="lane-name-input"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onBlur={() => { setEditingName(false); if (newName !== lane.name) onRename(newName); }}
            onKeyDown={e => e.key === 'Enter' && (setEditingName(false), newName !== lane.name && onRename(newName))}
            autoFocus
          />
        ) : (
          <span className="lane-name-input" onClick={() => setEditingName(true)} role="button" tabIndex={0}>
            {lane.name}
          </span>
        )}
        <div className="lane-actions">
          <button className="btn-icon btn-small" onClick={onDelete} aria-label="Delete lane">
            <Trash size={16} />
          </button>
        </div>
      </div>
      <div className="lane-tasks" ref={droppable.setNodeRef}>
        {tasks.map(task => (
          <TaskCard
            key={task.id}
            task={task}
            projectId={projectId}
            onEdit={() => onEditTask(task.id)}
            onDelete={() => onDeleteTask(task.id)}
            onMove={() => onMoveTask(task.id)}
            onMoveToNewProject={() => onMoveToNewProject(task.id)}
          />
        ))}
        {tasks.length === 0 && <div className="empty-state">No tasks</div>}
      </div>
      <div className="lane-add-task">
        <button className="btn btn-secondary btn-small" onClick={onAddTask}>
          <Plus size={14} /> Add Task
        </button>
        <button className="btn btn-secondary btn-small" onClick={onAiBreakdown}>
          AI Breakdown
        </button>
      </div>
    </div>
  );
}
