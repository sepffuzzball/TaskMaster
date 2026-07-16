import { useState } from 'react';
import { Trash, Plus, Sparkles, GripVertical } from 'lucide-react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import type { Lane, Task } from '../types';
import TaskCard from './TaskCard';

export type LaneDropEdge = 'none' | 'left' | 'right';

export default function LaneCard({
  lane,
  tasks,
  onRename,
  onDelete,
  onAddTask,
  onAiBreakdown,
  onEditTask,
  onDeleteTask,
  taskOverTaskId = null,
  wholeLaneTarget = false,
  laneDropEdge = 'none',
  hasTaskActive = false,
}: {
  lane: Lane;
  tasks: Task[];
  onRename: (name: string) => void;
  onDelete: () => void;
  onAddTask: () => void;
  onAiBreakdown: () => void;
  onEditTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
  /** Task id over which the active task is hovering — insertion line is drawn before it. */
  taskOverTaskId?: string | null;
  /** Lane is the active whole-lane task-drop target (empty/whole-lane highlight). */
  wholeLaneTarget?: boolean;
  /** Edge indicator for lane reorder — must match arrayMove result. */
  laneDropEdge?: LaneDropEdge;
  /** A task drag is in progress (suppress per-task indicators if needed). */
  hasTaskActive?: boolean;
}) {
  const dragData = { type: 'lane', laneId: lane.id, name: lane.name, version: lane.version };
  const draggable = useDraggable({ id: lane.id, data: dragData });
  const droppable = useDroppable({ id: lane.id, data: dragData });
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState(lane.name);

  const comboRef = (el: HTMLDivElement | null) => {
    draggable.setNodeRef(el);
    droppable.setNodeRef(el);
  };

  const commitName = () => {
    setEditingName(false);
    if (newName.trim() && newName !== lane.name) onRename(newName.trim());
    else setNewName(lane.name);
  };

  const laneClassName = [
    'lane',
    draggable.isDragging ? 'dragging' : '',
    wholeLaneTarget ? 'whole-drop-target' : '',
    laneDropEdge === 'left' ? 'lane-edge-left' : '',
    laneDropEdge === 'right' ? 'lane-edge-right' : '',
  ].filter(Boolean).join(' ');

  return (
    <section className={laneClassName} ref={comboRef} aria-label={`Lane ${lane.name}`}>
      <div className="lane-header">
        <button
          type="button"
          className="lane-grip"
          {...draggable.attributes}
          {...draggable.listeners}
          aria-label={`Reorder lane ${lane.name}`}
          title={`Drag to reorder lane ${lane.name}`}
        >
          <GripVertical size={16} />
        </button>
        {editingName ? (
          <input
            className="lane-name-input"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onBlur={commitName}
            onKeyDown={e => {
              if (e.key === 'Enter') commitName();
              if (e.key === 'Escape') { setNewName(lane.name); setEditingName(false); }
            }}
            aria-label="Lane name"
            autoFocus
          />
        ) : (
          <button
            type="button"
            className="lane-name-button"
            onClick={() => setEditingName(true)}
            title="Rename lane"
            aria-label={`Rename lane ${lane.name}`}
          >
            <span className="lane-name-text">{lane.name}</span>
            <span className="lane-count" aria-hidden="true">{tasks.length}</span>
          </button>
        )}
        <div className="lane-actions">
          <button
            type="button"
            className="btn-icon btn-small danger"
            onClick={onDelete}
            aria-label={`Delete lane ${lane.name}`}
            title={`Delete lane ${lane.name}`}
          >
            <Trash size={16} />
          </button>
        </div>
      </div>
      <div className="lane-tasks">
        {tasks.length === 0 ? (
          <div className="lane-empty" aria-label="No tasks in lane">
            <span className="lane-empty-text">{wholeLaneTarget ? 'Drop to add task' : 'No tasks yet'}</span>
          </div>
        ) : (
          tasks.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              onEdit={() => onEditTask(task.id)}
              onDelete={() => onDeleteTask(task.id)}
              insertIndicator={hasTaskActive && taskOverTaskId === task.id ? 'before' : 'none'}
              wholeLaneTarget={wholeLaneTarget}
            />
          ))
        )}
      </div>
      <div className="lane-footer">
        <button type="button" className="btn btn-secondary lane-footer-btn" onClick={onAddTask}>
          <Plus size={14} /> <span>Add Task</span>
        </button>
        <button type="button" className="btn btn-secondary lane-footer-btn" onClick={onAiBreakdown}>
          <Sparkles size={14} /> <span>AI Breakdown</span>
        </button>
      </div>
    </section>
  );
}
