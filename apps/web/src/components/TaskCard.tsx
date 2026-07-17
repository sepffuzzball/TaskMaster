import { Edit, Trash } from 'lucide-react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import type { Task } from '../types';
import TagChip from './TagChip';
import TaskDescription from './TaskDescription';

type InsertIndicator = 'none' | 'before';

export default function TaskCard({
  task,
  onEdit,
  onDelete,
  insertIndicator = 'none',
  wholeLaneTarget = false,
  dimmed = false,
  dragDisabled = false,
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
  dragDisabled?: boolean;
}) {
  const dragData = { type: 'task', taskId: task.id, title: task.title, laneId: task.laneId, version: task.version };
  const draggable = useDraggable({ id: task.id, data: dragData, disabled: dragDisabled });
  const droppable = useDroppable({ id: task.id, data: dragData, disabled: dragDisabled });

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
      <div
        className="task-card-header"
        onPointerDown={event => {
          if (dragDisabled || (event.target as Element).closest('button')) return;
          draggable.listeners?.onPointerDown?.(event);
        }}
      >
        <button
          type="button"
          className="task-action-btn"
          onPointerDown={event => event.stopPropagation()}
          onClick={event => { event.stopPropagation(); onEdit(); }}
          aria-label={`Edit task ${task.title}`}
          title={`Edit task ${task.title}`}
        >
          <Edit size={14} />
        </button>
        <button
          ref={draggable.setActivatorNodeRef}
          type="button"
          className="task-drag-rail"
          {...draggable.attributes}
          {...draggable.listeners}
          aria-label={`Drag task ${task.title}`}
          title={`Drag task ${task.title}`}
          disabled={dragDisabled}
        >
          <span className="task-drag-track" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="task-action-btn danger"
          onPointerDown={event => event.stopPropagation()}
          onClick={event => { event.stopPropagation(); onDelete(); }}
          aria-label={`Delete task ${task.title}`}
          title={`Delete task ${task.title}`}
        >
          <Trash size={14} />
        </button>
      </div>
      <div className="task-body">
        <div className="task-title">{task.title}</div>
        {task.description && <TaskDescription description={task.description} />}
      </div>
      {!!task.tags?.length && <div className="task-tags" aria-label={`Tags for ${task.title}`}>
        {task.tags.map(tag => <TagChip key={tag.id} name={tag.name} color={tag.color} compact />)}
      </div>}
    </article>
  );
}
