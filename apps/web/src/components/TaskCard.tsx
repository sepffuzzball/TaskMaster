import { Edit, Trash, GripVertical } from 'lucide-react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import type { Task } from '../types';

type InsertIndicator = 'none' | 'before';

export default function TaskCard({
  task,
  onEdit,
  onDelete,
  insertIndicator = 'none',
  wholeLaneTarget = false,
  dimmed = false,
}: {
  task: Task;
  onEdit: () => void;
  onDelete: () => void;
  /** Show a crisp horizontal insertion line above this card. */
  insertIndicator?: InsertIndicator;
  /** Card is inside a lane currently acting as a whole-lane drop target. */
  wholeLaneTarget?: boolean;
  /** Visually de-emphasise non-active cards during drag (e.g. other lanes). */
  dimmed?: boolean;
}) {
  const dragData = { type: 'task', taskId: task.id, title: task.title, laneId: task.laneId, version: task.version };
  const draggable = useDraggable({ id: task.id, data: dragData });
  const droppable = useDroppable({ id: task.id, data: dragData });

  // The article root is registered as both the draggable measurement node and
  // the droppable target. It is intentionally NON-interactive (no role=button,
  // no tabIndex, no keydown) so dnd-kit's keyboard sensor listeners live only
  // on the dedicated drag handle button below, and so the article is not a
  // button ancestor containing buttons.
  const setArticleRef = (el: HTMLElement | null) => {
    draggable.setNodeRef(el);
    droppable.setNodeRef(el);
  };

  const className = [
    'task-card',
    draggable.isDragging ? 'dragging' : '',
    droppable.isOver ? 'drop-target' : '',
    wholeLaneTarget ? 'lane-drop-member' : '',
    dimmed ? 'dimmed' : '',
  ].filter(Boolean).join(' ');

  return (
    <article ref={setArticleRef} className={className} aria-label={`Task ${task.title}`}>
      {insertIndicator === 'before' && <span className="task-insert-line" aria-hidden="true" />}
      <div className="task-body">
        <div className="task-title">{task.title}</div>
        {task.description && <div className="task-description">{task.description}</div>}
      </div>
      <div className="task-actions">
        <button
          type="button"
          className="task-action-btn task-drag-handle"
          {...draggable.attributes}
          {...draggable.listeners}
          aria-label={`Drag task ${task.title}`}
          title={`Drag task ${task.title}`}
        >
          <GripVertical size={14} />
        </button>
        <button
          type="button"
          className="task-action-btn"
          onClick={e => { e.stopPropagation(); onEdit(); }}
          aria-label={`Edit task ${task.title}`}
          title={`Edit task ${task.title}`}
        >
          <Edit size={14} />
        </button>
        <button
          type="button"
          className="task-action-btn danger"
          onClick={e => { e.stopPropagation(); onDelete(); }}
          aria-label={`Delete task ${task.title}`}
          title={`Delete task ${task.title}`}
        >
          <Trash size={14} />
        </button>
      </div>
    </article>
  );
}
