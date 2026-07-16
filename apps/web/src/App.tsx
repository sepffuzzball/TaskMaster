import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Routes, Route, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  DragOverlay,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
  useDroppable,
  useDndMonitor,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragCancelEvent,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
  type Announcements,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { api } from './api';
import type { User, Project, Lane, Task, ThemeName } from './types';
import {
  Check,
  X,
  Plus,
  Edit,
  Trash,
  Archive,
  LogOut,
  Settings,
  AlertTriangle,
  Menu,
  FolderPlus,
  PanelRightClose,
} from 'lucide-react';
import SettingsDialog from './components/SettingsDialog';
import MoveToNewProjectDialog from './components/MoveToNewProjectDialog';
import TaskCard from './components/TaskCard';
import LaneCard, { type LaneDropEdge } from './components/LaneCard';

// ===== Theme persistence =====
const THEME_STORAGE_KEY = 'taskmaster-theme';

export function getStoredTheme(): ThemeName {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored && ['tokyo-night', 'latte', 'frappe', 'macchiato', 'mocha'].includes(stored)) {
    return stored as ThemeName;
  }
  return 'tokyo-night';
}

function setStoredTheme(theme: ThemeName) {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  document.documentElement.setAttribute('data-theme', theme);
}

// Reserved droppable id for the sidebar "New Project" drop target.
const NEW_PROJECT_DROP_ID = 'new-project-drop-target';
const MOBILE_NEW_PROJECT_DROP_ID = 'mobile-new-project-drop-target';

export function useMobileMediaQuery() {
  const query = '(max-width: 899px)';
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);

  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  return matches;
}

type KeyboardBoardModel = { lanes: Lane[]; tasks: Task[] };

/** Board-aware keyboard navigation. Coordinates are target centers, not pixel nudges. */
export function createKeyboardCoordinateGetter({ lanes, tasks }: KeyboardBoardModel): KeyboardCoordinateGetter {
  const sortedLanes = [...lanes].sort((a, b) => a.rank - b.rank);
  const sortedTasks = (laneId: string) => tasks.filter(task => task.laneId === laneId).sort((a, b) => a.rank - b.rank);

  return (event, { active, currentCoordinates, context }) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.code)) return;
    const activeType = context.active?.data.current?.type;
    const overId = context.over?.id;
    const currentId = overId ?? active;
    let targetId: UniqueIdentifier | undefined;

    if (activeType === 'lane') {
      const overTask = tasks.find(task => task.id === currentId);
      const currentLaneId = overTask?.laneId ?? currentId;
      const currentIndex = sortedLanes.findIndex(lane => lane.id === currentLaneId);
      const index = currentIndex >= 0 ? currentIndex : sortedLanes.findIndex(lane => lane.id === active);
      const delta = event.code === 'ArrowLeft' || event.code === 'ArrowUp' ? -1 : 1;
      targetId = sortedLanes[index + delta]?.id;
    } else if (activeType === 'task') {
      const original = tasks.find(task => task.id === active);
      if (!original) return;
      const destinations: Array<{ id: UniqueIdentifier; type: string; projectId?: string; rank: number }> = [];
      const seenProjects = new Set<string>();
      context.droppableContainers.forEach((container: any, id: UniqueIdentifier) => {
        const rect = context.droppableRects.get(id);
        if (container.disabled || !rect || rect.width <= 0 || rect.height <= 0) return;
        const data = container.data?.current;
        const fallbackNewProject = id === NEW_PROJECT_DROP_ID || id === MOBILE_NEW_PROJECT_DROP_ID;
        const type = data?.type ?? (fallbackNewProject ? 'new-project' : undefined);
        if (type !== 'project' && type !== 'new-project') return;
        if (type === 'project') {
          const logicalId = String(data?.projectId ?? '');
          if (!logicalId || seenProjects.has(logicalId)) return;
          seenProjects.add(logicalId);
          destinations.push({ id, type, projectId: logicalId, rank: Number(data?.rank ?? 0) });
        } else if (!destinations.some(item => item.type === 'new-project')) {
          destinations.push({ id, type, rank: Number.POSITIVE_INFINITY });
        }
      });
      destinations.sort((a, b) => a.rank - b.rank || String(a.projectId ?? '').localeCompare(String(b.projectId ?? '')));
      const currentDestinationIndex = destinations.findIndex(item => item.id === currentId);
      const onDestination = currentDestinationIndex >= 0 || context.over?.data.current?.type === 'project' || context.over?.data.current?.type === 'new-project';
      if (onDestination) {
        if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
          const index = currentDestinationIndex >= 0 ? currentDestinationIndex : 0;
          const delta = event.code === 'ArrowUp' ? -1 : 1;
          targetId = destinations[index + delta]?.id;
        } else if (event.code === 'ArrowRight') {
          const originalLaneTasks = sortedTasks(original.laneId);
          targetId = originalLaneTasks.find(task => task.id === original.id)?.id ?? original.laneId;
        } else {
          return currentCoordinates;
        }
      } else {
        const currentTask = tasks.find(task => task.id === currentId) ?? original;
        const laneId = context.over?.data.current?.type === 'lane' ? String(currentId) : currentTask.laneId;
        const laneIndex = sortedLanes.findIndex(lane => lane.id === laneId);
        const laneTasks = sortedTasks(laneId);
        const taskIndex = laneTasks.findIndex(task => task.id === currentTask.id);

        if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
          const delta = event.code === 'ArrowUp' ? -1 : 1;
          targetId = laneTasks[taskIndex + delta]?.id;
        } else {
          const delta = event.code === 'ArrowLeft' ? -1 : 1;
          const destinationLane = sortedLanes[laneIndex + delta];
          if (!destinationLane && event.code === 'ArrowLeft' && laneIndex === 0) {
            targetId = destinations[0]?.id;
          } else if (destinationLane) {
            const destinationTasks = sortedTasks(destinationLane.id);
            const ordinal = Math.max(0, taskIndex);
            targetId = destinationTasks[Math.min(ordinal, destinationTasks.length - 1)]?.id ?? destinationLane.id;
          }
        }
      }
    }

    if (targetId == null) return currentCoordinates;
    const container = context.droppableContainers.get(targetId);
    const rect = context.droppableRects.get(targetId);
    const collisionRect = context.collisionRect;
    if (!container || container.disabled || !rect || rect.width <= 0 || rect.height <= 0 || !collisionRect) return currentCoordinates;
    event.preventDefault();
    return {
      x: rect.left + (rect.width - collisionRect.width) / 2,
      y: rect.top + (rect.height - collisionRect.height) / 2,
    };
  };
}

// ===== Toast =====
interface ToastItem {
  id: string;
  message: string;
  type?: 'success' | 'danger';
}

let toastCounter = 0;

function ToastRegion() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = (message: string, type?: 'success' | 'danger') => {
    const id = String(++toastCounter);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  };

  useEffect(() => {
    const handler = (e: CustomEvent) => addToast(e.detail.message, e.detail.type);
    window.addEventListener('toast', handler as EventListener);
    return () => window.removeEventListener('toast', handler as EventListener);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" role="region" aria-live="polite" aria-label="Notifications">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type || ''}`} role={t.type === 'danger' ? 'alert' : 'status'}>
          <span className="toast-icon" aria-hidden="true">
            {t.type === 'danger' && <AlertTriangle size={16} />}
            {t.type === 'success' && <Check size={16} />}
          </span>
          <span className="toast-message">{t.message}</span>
        </div>
      ))}
    </div>
  );
}

export function triggerToast(message: string, type?: 'success' | 'danger') {
  window.dispatchEvent(new CustomEvent('toast', { detail: { message, type } }));
}

// ===== Header =====
function Header({ user, onLogout, onOpenSettings, onToggleSidebar, showProjectMenu, sidebarOpen, menuButtonRef }: { user: User; onLogout: () => void; onOpenSettings: () => void; onToggleSidebar: () => void; showProjectMenu: boolean; sidebarOpen: boolean; menuButtonRef: React.RefObject<HTMLButtonElement | null> }) {
  return (
    <header className="header" role="banner">
      {showProjectMenu && <button ref={menuButtonRef} className="btn btn-icon mobile-toggle" onClick={onToggleSidebar} aria-label="Toggle sidebar" aria-expanded={sidebarOpen} aria-controls="project-sidebar">
        <Menu size={20} />
      </button>}
      <span className="header-brand">
        <span className="header-brand-mark" aria-hidden="true">TM</span>
        <span className="header-title">TaskMaster</span>
      </span>
      <div className="header-actions">
        <button className="btn btn-icon header-action" onClick={onOpenSettings} aria-label="Settings" title="Settings">
          <Settings size={18} />
        </button>
        <span className="header-user" title={user.subject}>
          <span className="header-user-chip">{user.subject.slice(0, 8)}</span>
        </span>
        <button className="btn btn-icon header-action" onClick={onLogout} aria-label="Log out" title="Log out">
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}

// ===== Project Sidebar =====
function DesktopProjectDroppableRow({ project, selected, taskDragActive, isMobile, onSelect, onArchive }: {
  project: Project;
  selected: boolean;
  taskDragActive: boolean;
  isMobile: boolean;
  onSelect: () => void;
  onArchive: () => void;
}) {
  const eligible = taskDragActive && !isMobile && !selected;
  const drop = useDroppable({
    id: `desktop-project:${project.id}`,
    data: { type: 'project', projectId: project.id, name: project.name, rank: project.rank },
    disabled: !eligible,
  });
  return (
    <li>
      <div
        ref={drop.setNodeRef}
        className={`sidebar-item ${selected ? 'active current-project' : ''} ${eligible ? 'project-drop-eligible' : ''} ${drop.isOver ? 'project-drop-over' : ''}`}
        data-project-drop-target={eligible ? project.id : undefined}
      >
        <button type="button" className="sidebar-item-select" onClick={onSelect} aria-current={selected ? 'page' : undefined}>
          <span className="sidebar-item-name">{project.name}</span>
          {eligible && <span className="project-drop-badge" aria-hidden="true">Drop task</span>}
        </button>
        <button
          type="button"
          className="btn-icon btn-small sidebar-item-action"
          onClick={event => { event.stopPropagation(); onArchive(); }}
          aria-label={`Archive ${project.name}`}
          title={`Archive ${project.name}`}
        >
          <Archive size={14} />
        </button>
      </div>
    </li>
  );
}

function ProjectSidebar({
  projects,
  archivedProjects,
  selectedProjectId,
  sidebarOpen,
  onSelect,
  onCreateProject,
  onArchive,
  onUnarchive,
  onOpenSettings,
  onClose,
  taskDragActive,
}: {
  projects: Project[];
  archivedProjects: Project[];
  selectedProjectId: string | null;
  sidebarOpen: boolean;
  onSelect: (id: string) => void;
  onCreateProject: () => void;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  onOpenSettings: () => void;
  onClose: () => void;
  taskDragActive: boolean;
}) {
  const isMobile = useMobileMediaQuery();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  // Drop target reserved for moving a task to a new project. Only enabled while a task is dragged.
  const newProjectDrop = useDroppable({
    id: NEW_PROJECT_DROP_ID,
    data: { type: 'new-project' },
    disabled: !taskDragActive || isMobile,
  });

  const setCombo = (el: HTMLDivElement | null) => {
    newProjectDrop.setNodeRef(el);
  };

  const dropActive = taskDragActive && newProjectDrop.isOver;

  useEffect(() => {
    if (isMobile && sidebarOpen) closeButtonRef.current?.focus();
  }, [isMobile, sidebarOpen]);

  useEffect(() => {
    if (!isMobile || !sidebarOpen) return;
    const containKeyboardFocus = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const sidebar = sidebarRef.current;
      if (!sidebar) return;
      const controls = Array.from(sidebar.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter(control => !control.hidden && control.getAttribute('aria-hidden') !== 'true');
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      const focusIsInside = sidebar.contains(document.activeElement);
      if (event.shiftKey && (!focusIsInside || document.activeElement === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!focusIsInside || document.activeElement === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', containKeyboardFocus);
    return () => window.removeEventListener('keydown', containKeyboardFocus);
  }, [isMobile, onClose, sidebarOpen]);

  return (
    <>
    <aside
      ref={sidebarRef}
      id="project-sidebar"
      className={`sidebar ${sidebarOpen ? 'open' : ''} ${taskDragActive ? 'drag-task-active' : ''}`}
      role="navigation"
      aria-label="Project sidebar"
      aria-hidden={isMobile && !sidebarOpen ? true : undefined}
      inert={isMobile && !sidebarOpen ? true : undefined}
    >
      <div className="sidebar-mobile-header">
        <span>Projects</span>
        <button ref={closeButtonRef} type="button" className="btn btn-icon sidebar-close" onClick={onClose} aria-label="Close project menu"><X size={20} /></button>
      </div>
      <div className="sidebar-section">
        <div
          ref={setCombo}
          className={`new-project-zone ${taskDragActive ? 'active' : ''} ${dropActive ? 'hovered' : ''}`}
          data-drop-active={dropActive ? 'true' : 'false'}
        >
          <button
            type="button"
            className={`btn btn-primary new-project-btn ${dropActive ? 'drop-hover' : ''}`}
            onClick={onCreateProject}
            aria-label="New project"
          >
            <Plus size={16} /> <span>New Project</span>
          </button>
          <div className="new-project-hint" aria-hidden={!taskDragActive}>
            <FolderPlus size={14} />
            <span>Drop a task here to move it to a new project</span>
          </div>
        </div>
      </div>

      <div className="sidebar-section sidebar-scroll">
        <div className="sidebar-heading">Active Projects</div>
        {projects.length === 0 && <div className="sidebar-empty">No projects</div>}
        <ul className="sidebar-list">
          {projects.map((p: Project) => <DesktopProjectDroppableRow
            key={p.id}
            project={p}
            selected={selectedProjectId === p.id}
            taskDragActive={taskDragActive}
            isMobile={isMobile}
            onSelect={() => onSelect(p.id)}
            onArchive={() => onArchive(p.id)}
          />)}
        </ul>
      </div>

      {archivedProjects.length > 0 && (
        <div className="sidebar-section">
          <div className="sidebar-heading">Archived Projects</div>
          <ul className="sidebar-list">
            {archivedProjects.map((p: Project) => (
              <li key={p.id}>
                <div className={`sidebar-item ${selectedProjectId === p.id ? 'active' : ''}`}>
                  <button type="button" className="sidebar-item-select" onClick={() => onSelect(p.id)} aria-current={selectedProjectId === p.id ? 'page' : undefined}>
                    <span className="sidebar-item-name">{p.name}</span>
                  </button>
                  <button
                    type="button"
                    className="btn-icon btn-small sidebar-item-action"
                    onClick={e => { e.stopPropagation(); onUnarchive(p.id); }}
                    aria-label={`Unarchive ${p.name}`}
                    title={`Unarchive ${p.name}`}
                  >
                    <Archive size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="sidebar-section sidebar-footer">
        <button type="button" className="btn btn-secondary" onClick={onOpenSettings}>
          <Settings size={16} /> <span>Settings</span>
        </button>
      </div>
    </aside>
    {isMobile && sidebarOpen && <button type="button" className="sidebar-backdrop" onClick={onClose} aria-label="Close project menu" tabIndex={-1} />}
    </>
  );
}

// ===== Board =====
function MobileProjectDestination({ project, active, isMobile }: { project: Project; active: boolean; isMobile: boolean }) {
  const drop = useDroppable({
    id: `mobile-project:${project.id}`,
    data: { type: 'project', projectId: project.id, name: project.name, rank: project.rank },
    disabled: !active || !isMobile,
  });
  return (
    <div ref={drop.setNodeRef} className={`mobile-project-destination ${drop.isOver ? 'hovered' : ''}`} data-project-drop-target={project.id} aria-label={`Move task to ${project.name}`}>
      <span>{project.name}</span>
      <span className="project-drop-badge" aria-hidden="true">Drop task</span>
    </div>
  );
}

function MobileDestinationTray({ active, projects }: { active: boolean; projects: Project[] }) {
  const isMobile = useMobileMediaQuery();
  const listRef = useRef<HTMLDivElement>(null);
  const drop = useDroppable({
    id: MOBILE_NEW_PROJECT_DROP_ID,
    data: { type: 'new-project' },
    disabled: !active || !isMobile,
  });
  useDndMonitor({
    onDragMove(event) {
      if (!active || !isMobile || event.active.data.current?.type !== 'task') return;
      const list = listRef.current;
      const activeRect = event.active.rect.current.translated;
      if (!list || !activeRect) return;
      const listRect = list.getBoundingClientRect();
      const centerY = activeRect.top + activeRect.height / 2;
      const edgeSize = 48;
      const step = 32;
      if (centerY >= listRect.top && centerY <= listRect.top + edgeSize && list.scrollTop > 0) {
        list.scrollBy({ top: -step, behavior: 'auto' });
      } else if (
        centerY <= listRect.bottom &&
        centerY >= listRect.bottom - edgeSize &&
        list.scrollTop + list.clientHeight < list.scrollHeight
      ) {
        list.scrollBy({ top: step, behavior: 'auto' });
      }
    },
  });
  if (!active) return null;
  return (
    <div className="mobile-destination-tray" aria-label="Move task to">
      <div className="mobile-destination-heading">Move task to</div>
      <div ref={listRef} className="mobile-destination-list">
        {projects.map(project => <MobileProjectDestination key={project.id} project={project} active={active} isMobile={isMobile} />)}
        <div
          ref={drop.setNodeRef}
          className={`mobile-project-destination mobile-new-project-shelf ${drop.isOver ? 'hovered' : ''}`}
          data-drop-type="new-project"
          aria-label="Drop task to create a new project"
        >
          <FolderPlus size={18} aria-hidden="true" />
          <span>New Project</span>
        </div>
      </div>
    </div>
  );
}

function BoardContent({ projectId, sidebarOpen, onCloseSidebar }: {
  projectId: string;
  sidebarOpen: boolean;
  onCloseSidebar: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showSettings, setShowSettings] = useState(false);

  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.projects.list(),
  });

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.projects.get(projectId),
    enabled: !!projectId,
  });

  const lanesQuery = useQuery({
    queryKey: ['lanes', projectId],
    queryFn: () => api.lanes.list(projectId),
    enabled: !!projectId,
  });

  const tasksQuery = useQuery({
    queryKey: ['tasks', projectId],
    queryFn: () => api.tasks.list(projectId),
    enabled: !!projectId,
  });

  const updateProjectMut = useMutation({
    mutationFn: (data: { name: string; description?: string; expectedVersion: number }) => api.projects.update(projectId, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['project', projectId] }); triggerToast('Project updated', 'success'); },
    onError: (e: any) => triggerToast(e.errors?.[0]?.message || 'Failed to update', 'danger'),
  });

  const archiveProjectMut = useMutation({
    mutationFn: (data?: { expectedVersion: number }) => api.projects.archive(projectId, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['project', projectId] }); queryClient.invalidateQueries({ queryKey: ['projects'] }); },
    onError: (e: any) => triggerToast(e.errors?.[0]?.message || 'Failed to archive', 'danger'),
  });

  const createLaneMut = useMutation({
    mutationFn: (data: { name: string }) => api.lanes.create(projectId, { ...data, expectedProjectVersion: project.version }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lanes', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      triggerToast('Lane created', 'success');
    },
    onError: (e: any) => triggerToast(e.errors?.[0]?.message || 'Failed to create lane', 'danger'),
  });

  const renameLaneMut = useMutation({
    mutationFn: ({ laneId, name, expectedVersion }: { laneId: string; name: string; expectedVersion: number }) =>
      api.lanes.rename(projectId, laneId, { name, expectedVersion, expectedProjectVersion: project.version }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lanes', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      triggerToast('Lane renamed', 'success');
    },
    onError: (e: any) => {
      if (e.errors?.[0]?.code === 'STALE_VERSION') {
        triggerToast('Stale version - refresh to see changes', 'danger');
      } else {
        triggerToast(e.errors?.[0]?.message || 'Failed to rename lane', 'danger');
      }
    },
  });

  const [showingDeleteLane, setShowingDeleteLane] = useState<string | null>(null);
  const [addTaskLaneId, setAddTaskLaneId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [showingDeleteTask, setShowingDeleteTask] = useState<string | null>(null);
  const [showMoveToNewProject, setShowMoveToNewProject] = useState<Task | null>(null);
  const [showAiBreakdown, setShowAiBreakdown] = useState<{ laneId: string } | null>(null);

  // ===== Drag state =====
  const [activeDraggedTask, setActiveDraggedTask] = useState<Task | null>(null);
  const [activeDraggedLane, setActiveDraggedLane] = useState<Lane | null>(null);
  // Drop target visual state; recomputed each onDragOver.
  const [overTaskId, setOverTaskId] = useState<string | null>(null);
  const [wholeLaneTargetId, setWholeLaneTargetId] = useState<string | null>(null);
  const [laneReorderLaneId, setLaneReorderLaneId] = useState<string | null>(null);
  const [laneReorderEdge, setLaneReorderEdge] = useState<LaneDropEdge>('none');

  // Active projects
  const activeProjects = projectsQuery.data?.filter((p: Project) => !p.archivedAt).sort((a: Project, b: Project) => a.rank - b.rank) || [];
  const archivedProjects = projectsQuery.data?.filter((p: Project) => !!p.archivedAt) || [];

  const tasksByLane = useCallback(
    (laneId: string) => tasksQuery.data?.filter((t: Task) => t.laneId === laneId).sort((a: Task, b: Task) => a.rank - b.rank) || [],
    [tasksQuery.data]
  );

  const keyboardCoordinates = React.useMemo(
    () => createKeyboardCoordinateGetter({ lanes: lanesQuery.data || [], tasks: tasksQuery.data || [] }),
    [lanesQuery.data, tasksQuery.data]
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: keyboardCoordinates,
      keyboardCodes: { start: ['Space', 'Enter'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  );

  const isArchived = !!projectQuery.data?.archivedAt;

  const handleTaskMove = async (taskId: string, destinationLaneId: string, beforeId?: string, afterId?: string) => {
    const task = tasksQuery.data?.find((t: Task) => t.id === taskId);
    if (!task) return;
    try {
      await api.tasks.move(taskId, {
        destinationProjectId: projectId,
        destinationLaneId,
        beforeTaskId: beforeId,
        afterTaskId: afterId,
        expectedVersion: task.version,
      });
      queryClient.invalidateQueries({ queryKey: ['tasks', projectId] });
      triggerToast('Task moved', 'success');
    } catch (e: any) {
      if (e.errors?.[0]?.code === 'STALE_VERSION') {
        triggerToast('Stale version - refresh to see changes', 'danger');
      } else {
        triggerToast(e.errors?.[0]?.message || 'Move failed', 'danger');
      }
    }
  };

  const handleExistingProjectMove = async (taskId: string, destinationProjectId: string, targetName: string) => {
    const task = tasksQuery.data?.find((item: Task) => item.id === taskId);
    const target = activeProjects.find((item: Project) => item.id === destinationProjectId);
    if (!task || !target || target.archivedAt || target.id === task.projectId) return;
    const name = target.name || targetName;
    try {
      await api.tasks.move(taskId, { destinationProjectId: target.id, expectedVersion: task.version });
      queryClient.invalidateQueries({ queryKey: ['tasks', task.projectId] });
      queryClient.invalidateQueries({ queryKey: ['tasks', target.id] });
      triggerToast(`Task moved to ${name}`, 'success');
    } catch (error: any) {
      const code = error.errors?.[0]?.code;
      const detail = error.errors?.[0]?.message;
      queryClient.invalidateQueries({ queryKey: ['tasks', task.projectId] });
      queryClient.invalidateQueries({ queryKey: ['tasks', target.id] });
      if (code === 'BAD_REQUEST' || code === 'NOT_FOUND') {
        queryClient.invalidateQueries({ queryKey: ['projects'] });
      }
      if (code === 'STALE_VERSION') {
        triggerToast(`Could not move task to ${name}: stale version${detail ? ` - ${detail}` : ''}`, 'danger');
      } else {
        triggerToast(`Could not move task to ${name}${detail ? `: ${detail}` : ''}`, 'danger');
      }
    }
  };

  const clearDragState = useCallback(() => {
    setActiveDraggedTask(null);
    setActiveDraggedLane(null);
    setOverTaskId(null);
    setWholeLaneTargetId(null);
    setLaneReorderLaneId(null);
    setLaneReorderEdge('none');
  }, []);

  // ===== Drag handlers =====
  const onDragStart = (event: DragStartEvent) => {
    const type = event.active.data.current?.type;
    if (type === 'task') {
      const t = tasksQuery.data?.find((x: Task) => x.id === event.active.id) || null;
      setActiveDraggedTask(t);
      // Dragging never changes navigation state. Mobile gets a compact shelf.
    } else if (type === 'lane') {
      const l = lanesQuery.data?.find((x: Lane) => x.id === event.active.id) || null;
      setActiveDraggedLane(l);
    }
  };

  const onDragOver = (event: DragOverEvent) => {
    const activeType = event.active.data.current?.type;
    const overType = event.over?.data.current?.type;
    const overId = event.over?.id as string | undefined;

    if (activeType === 'task') {
      // Reset lane reorder visuals — never during a task drag.
      setLaneReorderLaneId(null);
      setLaneReorderEdge('none');

      if (overType === 'task' && overId) {
        // Self-drop (task over itself) is a no-op; never show an insertion line.
        if (event.active.id === overId) {
          setOverTaskId(null);
        } else {
          setOverTaskId(overId);
        }
        setWholeLaneTargetId(null);
      } else if (overType === 'lane' && overId) {
        setOverTaskId(null);
        setWholeLaneTargetId(overId);
      } else if (overType === 'new-project' || overType === 'project') {
        // Project destinations clear board insertion indicators.
        setOverTaskId(null);
        setWholeLaneTargetId(null);
      } else {
        setOverTaskId(null);
        setWholeLaneTargetId(null);
      }
      return;
    }

    if (activeType === 'lane') {
      // Never show task indicators during a lane drag.
      setOverTaskId(null);
      setWholeLaneTargetId(null);

      const lanes = lanesQuery.data || [];
      const oldIndex = lanes.findIndex((l: Lane) => l.id === event.active.id);
      let targetLaneId: string | null = null;
      if (overType === 'lane' && overId) {
        targetLaneId = overId;
      } else if (overType === 'task' && overId) {
        const t = tasksQuery.data?.find((x: Task) => x.id === overId);
        targetLaneId = t?.laneId ?? null;
      }

      if (!targetLaneId) {
        setLaneReorderLaneId(null);
        setLaneReorderEdge('none');
        return;
      }
      const newIndex = lanes.findIndex((l: Lane) => l.id === targetLaneId);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
        setLaneReorderLaneId(null);
        setLaneReorderEdge('none');
        return;
      }
      setLaneReorderLaneId(targetLaneId);
      setLaneReorderEdge(oldIndex > newIndex ? 'left' : 'right');
      return;
    }

    // Unknown active type — clear all.
    clearDragState();
  };

  const onDragCancel = (_event: DragCancelEvent) => {
    clearDragState();
  };

  const onDragEnd = (event: DragEndEvent) => {
    const activeType = event.active.data.current?.type;
    const activeId = event.active.id as string;
    const overId = event.over?.id as string | undefined;
    const overType = event.over?.data.current?.type;

    try {
      if (activeType === 'task') {
        handleTaskDragEnd(activeId, overId, event.over?.data.current);
      } else if (activeType === 'lane') {
        handleLaneDragEnd(activeId, overId, overType);
      }
    } finally {
      clearDragState();
    }
  };

  const handleTaskDragEnd = (taskId: string, overId: string | undefined, overData: Record<string, any> | undefined) => {
    const overType = overData?.type as string | undefined;
    if (!overId || !overType) return;

    // New project drop target — open the move-to-new-project dialog only.
    if (overType === 'new-project') {
      const task = tasksQuery.data?.find((t: Task) => t.id === taskId);
      if (task) setShowMoveToNewProject(task);
      return;
    }

    if (overType === 'project') {
      const destinationProjectId = typeof overData?.projectId === 'string' ? overData.projectId : '';
      const name = typeof overData?.name === 'string' ? overData.name : 'project';
      void handleExistingProjectMove(taskId, destinationProjectId, name);
      return;
    }

    const overLaneId = overType === 'lane' ? overId : tasksQuery.data?.find((t: Task) => t.id === overId)?.laneId;
    if (!overLaneId) return;

    const sorted = tasksQuery.data?.filter((t: Task) => t.laneId === overLaneId).sort((a, b) => a.rank - b.rank) || [];
    const draggedTask = tasksQuery.data?.find((t: Task) => t.id === taskId);
    if (!draggedTask) return;

    const remaining = sorted.filter((t: Task) => t.id !== taskId);

    let beforeId: string | undefined;
    let afterId: string | undefined;
    if (overType === 'task') {
      if (taskId === overId) return; // dropped on self
      const targetIdx = remaining.findIndex((t: Task) => t.id === overId);
      if (targetIdx === -1) return;
      // Insert before the target: afterTaskId = over task, beforeTaskId = previous task.
      beforeId = targetIdx > 0 ? remaining[targetIdx - 1].id : undefined;
      afterId = overId;
    } else {
      // Drop on lane → append at end.
      if (remaining.length > 0) {
        beforeId = remaining[remaining.length - 1].id;
        afterId = undefined;
      } else {
        beforeId = undefined;
        afterId = undefined;
      }
    }

    // No-op if nothing changes.
    const sameLane = draggedTask.laneId === overLaneId;
    if (
      sameLane &&
      remaining.length === sorted.length &&
      !beforeId &&
      !afterId
    ) return;

    handleTaskMove(taskId, overLaneId, beforeId, afterId);
  };

  const handleLaneDragEnd = (laneId: string, overId: string | undefined, overType: string | undefined) => {
    if (!overId || !overType) return;
    if (overType === 'task' || overType === 'lane') {
      const lanes = lanesQuery.data || [];
      const oldIndex = lanes.findIndex((l: Lane) => l.id === laneId);
      let targetLaneId: string | null = null;
      if (overType === 'lane') {
        targetLaneId = overId;
      } else {
        const t = tasksQuery.data?.find((x: Task) => x.id === overId);
        targetLaneId = t?.laneId ?? null;
      }
      if (!targetLaneId || targetLaneId === laneId) return;
      const newIndex = lanes.findIndex((l: Lane) => l.id === targetLaneId);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
      const reordered = arrayMove(lanes, oldIndex, newIndex);
      const laneIds = reordered.map((l: Lane) => l.id);
      api.lanes.reorder(projectId, { laneIds, expectedProjectVersion: project.version }).then(() => {
        queryClient.invalidateQueries({ queryKey: ['project', projectId] });
        queryClient.invalidateQueries({ queryKey: ['lanes', projectId] });
        triggerToast('Lanes reordered', 'success');
      }).catch((e: any) => triggerToast(e.errors?.[0]?.message || 'Reorder failed', 'danger'));
    }
  };

  const deleteLane = (laneId: string, targetLaneId: string) => {
    const lane = lanesQuery.data?.find((l: Lane) => l.id === laneId);
    if (!lane) return;
    api.lanes.delete(projectId, laneId, { targetLaneId, expectedProjectVersion: project.version }).then(() => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['lanes', projectId] });
      triggerToast('Lane deleted', 'success');
      setShowingDeleteLane(null);
    }).catch((e: any) => triggerToast(e.errors?.[0]?.message || 'Delete failed', 'danger'));
  };

  // ===== Error states =====
  if (projectQuery.error) {
    return (
      <div className="app-layout">
        <ProjectSidebar
          projects={activeProjects}
          archivedProjects={archivedProjects}
          selectedProjectId={projectId}
          sidebarOpen={sidebarOpen}
          onSelect={(id) => { onCloseSidebar(); navigate(`/project/${id}`); }}
          onCreateProject={() => { onCloseSidebar(); navigate('/projects/new'); }}
          onArchive={(id) => {
            const project = projectsQuery.data?.find((p: Project) => p.id === id);
            api.projects.archive(id, { expectedVersion: project?.version ?? 0 }).then(() => {
              queryClient.invalidateQueries({ queryKey: ['projects'] });
              queryClient.invalidateQueries({ queryKey: ['project', id] });
            }).catch((e: any) => triggerToast(e.errors?.[0]?.message || 'Failed to archive', 'danger'));
            onCloseSidebar();
          }}
          onUnarchive={(id) => {
            const project = projectsQuery.data?.find((p: Project) => p.id === id);
            api.projects.unarchive(id, { expectedVersion: project?.version ?? 0 }).then(() => {
              queryClient.invalidateQueries({ queryKey: ['projects'] });
              navigate(`/project/${id}`);
            }).catch((e: any) => triggerToast(e.errors?.[0]?.message || 'Failed to unarchive', 'danger'));
            onCloseSidebar();
          }}
          onOpenSettings={() => { onCloseSidebar(); setShowSettings(true); }}
          onClose={onCloseSidebar}
          taskDragActive={false}
        />
        <div className="board">
          <div className="board-message board-message-error">
            <p className="board-message-title">Failed to load project</p>
            <p className="board-message-detail">{(projectQuery.error as any)?.message || (projectQuery.error as any)?.errors?.[0]?.message}</p>
            <button className="btn btn-secondary" onClick={() => projectQuery.refetch()}>Retry</button>
          </div>
          <ToastRegion />
        </div>
      </div>
    );
  }

  if (!projectQuery.data) {
    if (projectQuery.isLoading) return <div className="loading">Loading project...</div>;
    return <div className="board-message"><p>Project not found</p></div>;
  }

  const project = projectQuery.data;
  const taskDragActive = !!activeDraggedTask;
  const lanes = lanesQuery.data || [];
  const tasks = tasksQuery.data || [];
  const describeDestination = (over: { id: UniqueIdentifier; data: { current?: Record<string, any> } } | null) => {
    if (!over) return 'no destination';
    if (over.data.current?.type === 'new-project') return 'New Project';
    if (over.data.current?.type === 'project') return over.data.current.name ?? 'project';
    const task = tasks.find(item => item.id === over.id);
    if (task) {
      const lane = lanes.find(item => item.id === task.laneId);
      const ordinal = tasks.filter(item => item.laneId === task.laneId).sort((a, b) => a.rank - b.rank).findIndex(item => item.id === task.id) + 1;
      return `${lane?.name ?? 'lane'}, position ${ordinal}`;
    }
    return lanes.find(item => item.id === over.id)?.name ?? 'board';
  };
  const describeActive = (active: { id: UniqueIdentifier; data: { current?: Record<string, any> } }) => {
    const task = tasks.find(item => item.id === active.id);
    if (task) return `task ${task.title}`;
    const lane = lanes.find(item => item.id === active.id);
    return `lane ${lane?.name ?? String(active.id)}`;
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${describeActive(active)}.`,
    onDragOver: ({ active, over }) => `${describeActive(active)} is over ${describeDestination(over)}.`,
    onDragEnd: ({ active, over }) => over ? `Dropped ${describeActive(active)} in ${describeDestination(over)}.` : `Drop cancelled for ${describeActive(active)}.`,
    onDragCancel: ({ active }) => `Cancelled dragging ${describeActive(active)}.`,
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragCancel={onDragCancel}
      onDragEnd={onDragEnd}
      accessibility={{
        screenReaderInstructions: { draggable: 'Press Space or Enter to pick up. Use arrow keys to choose a task, lane, existing project, or New Project. Press Space or Enter to drop, or Escape to cancel.' },
        announcements,
      }}
    >
      <div className={`app-layout ${taskDragActive ? 'drag-task-active' : ''}`}>
        <ProjectSidebar
          projects={activeProjects}
          archivedProjects={archivedProjects}
          selectedProjectId={projectId}
          sidebarOpen={sidebarOpen}
          onSelect={(id) => { onCloseSidebar(); navigate(`/project/${id}`); }}
          onCreateProject={() => { onCloseSidebar(); navigate('/projects/new'); }}
          onArchive={(id) => {
            const project = projectsQuery.data?.find((p: Project) => p.id === id);
            api.projects.archive(id, { expectedVersion: project?.version ?? 0 }).then(() => {
              queryClient.invalidateQueries({ queryKey: ['projects'] });
              queryClient.invalidateQueries({ queryKey: ['project', id] });
            }).catch((e: any) => triggerToast(e.errors?.[0]?.message || 'Failed to archive', 'danger'));
            onCloseSidebar();
          }}
          onUnarchive={(id) => {
            const project = projectsQuery.data?.find((p: Project) => p.id === id);
            api.projects.unarchive(id, { expectedVersion: project?.version ?? 0 }).then(() => {
              queryClient.invalidateQueries({ queryKey: ['projects'] });
              navigate(`/project/${id}`);
            }).catch((e: any) => triggerToast(e.errors?.[0]?.message || 'Failed to unarchive', 'danger'));
            onCloseSidebar();
          }}
          onOpenSettings={() => { onCloseSidebar(); setShowSettings(true); }}
          onClose={onCloseSidebar}
          taskDragActive={taskDragActive}
        />
        <MobileDestinationTray active={taskDragActive} projects={activeProjects.filter((item: Project) => item.id !== projectId)} />
        <div className="board">
          {isArchived ? (
            <div className="board-header board-header-archived">
              <div className="board-header-titles">
                <h2 className="board-title">{project.name}</h2>
                <span className="board-subtitle">Archived</span>
              </div>
              <div className="board-actions">
                <button className="btn btn-secondary btn-small" onClick={() => {
                  api.projects.unarchive(projectId, { expectedVersion: project.version }).then(() => {
                    queryClient.invalidateQueries({ queryKey: ['projects', 'project', projectId] });
                    triggerToast('Project unarchived', 'success');
                  }).catch((e: any) => triggerToast(e.errors?.[0]?.message || 'Failed to unarchive', 'danger'));
                }}>
                  <Archive size={14} /> Unarchive
                </button>
              </div>
            </div>
          ) : (
            <div className="board-header">
              <div className="board-header-titles">
                <h2 className="board-title">{project.name}</h2>
                {project.description && <span className="board-subtitle">{project.description}</span>}
              </div>
              <div className="board-header-controls">
                <button className="btn btn-secondary btn-small" onClick={() => {
                  const newName = prompt('New name');
                  if (newName) updateProjectMut.mutate({ name: newName, expectedVersion: project.version });
                }}>
                  <Edit size={14} /> <span>Edit</span>
                </button>
                <button className="btn btn-danger btn-small" onClick={() => archiveProjectMut.mutate({ expectedVersion: project.version })}>
                  <Archive size={14} /> <span>Archive</span>
                </button>
                <div className="board-actions">
                  <button className="btn btn-primary" onClick={() => {
                    const name = prompt('Lane name');
                    if (name) createLaneMut.mutate({ name });
                  }}>
                    <Plus size={14} /> <span>Add Lane</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          <DragOverlay dropAnimation={null}>
            {activeDraggedTask && (
              <div className="task-card drag-overlay" style={{ width: '280px' }}>
                <div className="task-body">
                  <div className="task-title">{activeDraggedTask.title}</div>
                </div>
              </div>
            )}
            {activeDraggedLane && (
              <div className="lane drag-overlay" style={{ minWidth: '280px' }}>
                <div className="lane-header">
                  <span className="lane-name-text">{activeDraggedLane.name}</span>
                </div>
              </div>
            )}
          </DragOverlay>

          {tasksQuery.error && !isArchived && (
            <div className="board-message board-message-error">
              <p className="board-message-title">Failed to load tasks</p>
              <p className="board-message-detail">{(tasksQuery.error as any)?.message || (tasksQuery.error as any)?.errors?.[0]?.message}</p>
              <button className="btn btn-secondary" onClick={() => tasksQuery.refetch()}>Retry</button>
            </div>
          )}
          {!tasksQuery.error && tasksQuery.isLoading && !isArchived && (
            <div className="loading">Loading tasks...</div>
          )}
          {!tasksQuery.error && !tasksQuery.isLoading && !tasksQuery.data && !isArchived && (
            <div className="empty-state">No tasks</div>
          )}
          {!isArchived && lanesQuery.error && (
            <div className="board-message board-message-error">
              <p className="board-message-title">Failed to load lanes</p>
              <p className="board-message-detail">{(lanesQuery.error as any)?.message || (lanesQuery.error as any)?.errors?.[0]?.message}</p>
              <button className="btn btn-secondary" onClick={() => lanesQuery.refetch()}>Retry</button>
            </div>
          )}
          {!isArchived && !lanesQuery.error && lanesQuery.isLoading && (
            <div className="loading">Loading lanes...</div>
          )}
          {!isArchived && !lanesQuery.error && !lanesQuery.isLoading && lanesQuery.data && (
            <div className="lanes-container">
              {lanesQuery.data?.map((lane: Lane) => (
                <LaneCard
                  key={lane.id}
                  lane={lane}
                  tasks={tasksByLane(lane.id)}
                  onRename={(name: string) => renameLaneMut.mutate({ laneId: lane.id, name, expectedVersion: lane.version })}
                  onDelete={() => setShowingDeleteLane(lane.id)}
                  onAddTask={() => setAddTaskLaneId(lane.id)}
                  onAiBreakdown={() => setShowAiBreakdown({ laneId: lane.id })}
                  onEditTask={(taskId: string) => setEditingTaskId(taskId)}
                  onDeleteTask={(taskId: string) => setShowingDeleteTask(taskId)}
                  taskOverTaskId={taskDragActive ? overTaskId : null}
                  wholeLaneTarget={taskDragActive && wholeLaneTargetId === lane.id}
                  laneDropEdge={!taskDragActive && activeDraggedLane && laneReorderLaneId === lane.id ? laneReorderEdge : 'none'}
                  hasTaskActive={taskDragActive}
                />
              ))}
              {(!lanesQuery.data || lanesQuery.data.length === 0) && <div className="empty-state">No lanes yet</div>}
            </div>
          )}
          {!isArchived && !lanesQuery.error && !lanesQuery.isLoading && !lanesQuery.data && (
            <div className="empty-state">No lanes yet</div>
          )}

          {addTaskLaneId && (
            <AddTaskDialog
              laneId={addTaskLaneId}
              projectId={projectId}
              onClose={() => setAddTaskLaneId(null)}
              onCreated={() => { queryClient.invalidateQueries({ queryKey: ['tasks', projectId] }); setAddTaskLaneId(null); }}
            />
          )}
          {showingDeleteLane && (
            <DeleteLaneDialog
              laneId={showingDeleteLane}
              projectId={projectId}
              lanes={lanesQuery.data || []}
              onClose={() => setShowingDeleteLane(null)}
              onConfirm={(targetId: string) => deleteLane(showingDeleteLane, targetId)}
            />
          )}
          {showAiBreakdown && (
            <AiBreakdownDialog
              laneId={showAiBreakdown.laneId}
              projectId={projectId}
              onClose={() => setShowAiBreakdown(null)}
            />
          )}
          {editingTaskId && (
            <EditTaskDialog
              taskId={editingTaskId}
              projectId={projectId}
              onClose={() => setEditingTaskId(null)}
              onUpdated={() => { queryClient.invalidateQueries({ queryKey: ['tasks', projectId] }); setEditingTaskId(null); }}
            />
          )}
          {showingDeleteTask && (
            <DeleteConfirmDialog
              message="Delete this task?"
              onConfirm={() => {
                const task = tasksQuery.data?.find((t: Task) => t.id === showingDeleteTask);
                if (task) api.tasks.delete(task.id, task.version).then(() => {
                  queryClient.invalidateQueries({ queryKey: ['tasks', projectId] });
                  triggerToast('Task deleted', 'success');
                  setShowingDeleteTask(null);
                }).catch((e: any) => triggerToast(e.errors?.[0]?.message || 'Delete failed', 'danger'));
              }}
              onCancel={() => setShowingDeleteTask(null)}
            />
          )}
          {showMoveToNewProject && (
            <MoveToNewProjectDialog
              task={showMoveToNewProject}
              onClose={() => setShowMoveToNewProject(null)}
            />
          )}
          {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
        </div>
        <ToastRegion />
      </div>
    </DndContext>
  );
}

// ===== Dialogs =====

function AddTaskDialog({ laneId, projectId, onClose, onCreated }: {
  laneId: string;
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
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

// ===== Edit Task Flyout (right-side panel) =====
function EditTaskDialog({ taskId, projectId, onClose, onUpdated }: {
  taskId: string;
  projectId: string;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const taskQuery = useQuery({ queryKey: ['task', taskId], queryFn: () => api.tasks.get(projectId, taskId) });
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const updateMut = useMutation({
    mutationFn: (data: { title?: string; description?: string; expectedVersion: number }) => api.tasks.update(projectId, taskId, data),
    onSuccess: () => { triggerToast('Task updated', 'success'); onUpdated(); },
    onError: (e: any) => triggerToast(e.errors?.[0]?.message || 'Failed to update', 'danger'),
  });

  const panelRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const handledInitialDataRef = useRef(false);

  // Capture trigger element on mount to restore focus on close.
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    if (active && active.tagName !== 'BODY') {
      restoreFocusRef.current = active;
    } else {
      restoreFocusRef.current = null;
    }
    // Focus the close button immediately so the panel is keyboard-reachable
    // even before the async task data arrives (covers loading/error states).
    closeBtnRef.current?.focus();
    return () => {
      const el = restoreFocusRef.current;
      if (el && typeof el.focus === 'function') {
        try { el.focus(); } catch { /* noop */ }
      }
    };
  }, []);

  useEffect(() => {
    if (taskQuery.data) {
      setTitle(taskQuery.data.title ?? '');
      setDescription(taskQuery.data.description ?? '');
    }
  }, [taskQuery.data]);

  // On first data only, advance from the initial loading target. If the user
  // already chose another control, or data later refetches, never steal focus.
  useEffect(() => {
    if (!taskQuery.data || handledInitialDataRef.current) return;
    handledInitialDataRef.current = true;
    if (document.activeElement === closeBtnRef.current) titleInputRef.current?.focus();
  }, [taskQuery.data]);

  // Escape to close + Tab focus trap inside panel (both directions, and when
  // focus has escaped outside the panel).
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeInPanel = panel.contains(document.activeElement);
      if (e.shiftKey) {
        if (!activeInPanel || document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (!activeInPanel || document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      className="flyout-overlay"
      onClick={e => e.target === e.currentTarget && onClose()}
      role="presentation"
    >
      <div
        className="flyout"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-task-title"
      >
        <header className="flyout-header">
          <div className="flyout-titles">
            <h2 className="flyout-title" id="edit-task-title">Edit Task</h2>
            <p className="flyout-subtitle">Update task details</p>
          </div>
          <button
            type="button"
            className="btn btn-icon flyout-close"
            ref={closeBtnRef}
            onClick={onClose}
            aria-label="Close edit task panel"
            title="Close"
          >
            <PanelRightClose size={20} />
          </button>
        </header>
        <div className="flyout-body">
          {taskQuery.isLoading ? (
            <div className="loading">Loading...</div>
          ) : taskQuery.error ? (
            <div className="board-message board-message-error">
              <p className="board-message-title">Failed to load task</p>
              <button className="btn btn-secondary" onClick={() => taskQuery.refetch()}>Retry</button>
            </div>
          ) : (
            <form
              id="edit-task-form"
              className="dialog-form"
              onSubmit={e => {
                e.preventDefault();
                updateMut.mutate({ title, description, expectedVersion: taskQuery.data?.version ?? 0 });
              }}
            >
              <div className="form-field">
                <label htmlFor="edit-task-title-input">Title</label>
                <input
                  id="edit-task-title-input"
                  ref={titleInputRef}
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  required
                  maxLength={200}
                />
              </div>
              <div className="form-field">
                <label htmlFor="edit-task-desc">Description</label>
                <textarea
                  id="edit-task-desc"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  maxLength={1000}
                  rows={6}
                />
              </div>
            </form>
          )}
        </div>
        <footer className="flyout-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            type="submit"
            form="edit-task-form"
            className="btn btn-primary"
            disabled={taskQuery.isLoading || !taskQuery.data || updateMut.isPending}
          >
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}

function DeleteLaneDialog({ laneId, projectId, lanes, onClose, onConfirm }: {
  laneId: string;
  projectId: string;
  lanes: Lane[];
  onClose: () => void;
  onConfirm: (targetId: string) => void;
}) {
  const [targetId, setTargetId] = useState(lanes.find((l: Lane) => l.id !== laneId)?.id || '');
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
        <div className="form-field">
          <select value={targetId} onChange={e => setTargetId(e.target.value)} aria-label="Destination lane">
            {lanes.filter((l: Lane) => l.id !== laneId).map((l: Lane) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>
        <div className="dialog-actions">
          <button className="btn btn-danger" onClick={() => onConfirm(targetId)}>Delete</button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function AiBreakdownDialog({ laneId, projectId, onClose }: {
  laneId: string;
  projectId: string;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [context, setContext] = useState('');
  const [cards, setCards] = useState<{ title: string; description?: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [creatingIds, setCreatingIds] = useState<Set<number>>(new Set());
  const [createdIds, setCreatedIds] = useState<Set<number>>(new Set());
  const createMut = useMutation({
    mutationFn: (data: { title: string; description?: string }) => api.tasks.create(projectId, laneId, data)
  });
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.querySelector('input')?.focus();
    const handleEscape = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleBreakdown = async () => {
    setLoading(true);
    try {
      const result = await api.ai.breakdown({ title, context });
      setCards(result.cards);
      setLoading(false);
    } catch {
      triggerToast('AI breakdown failed', 'danger');
      setLoading(false);
    }
  };

  const handleCreateCard = async (card: { title: string; description?: string }, idx: number) => {
    if (creatingIds.has(idx) || createdIds.has(idx)) return;
    setCreatingIds(prev => new Set([...prev, idx]));
    try {
      await createMut.mutateAsync({ title: card.title, description: card.description });
      queryClient.invalidateQueries({ queryKey: ['tasks', projectId] });
      setCreatedIds(prev => new Set([...prev, idx]));
      triggerToast('Task created', 'success');
    } catch {
      triggerToast('Failed to create task', 'danger');
    } finally {
      setCreatingIds(prev => {
        const next = new Set(prev);
        next.delete(idx);
        return next;
      });
    }
  };

  return (
    <div className="dialog-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dialog dialog-wide" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="ai-breakdown-title">
        <button className="dialog-close btn-icon" onClick={onClose} aria-label="Close dialog"><X size={20} /></button>
        <h2 className="dialog-title" id="ai-breakdown-title">AI Breakdown</h2>
        <div className="dialog-form">
          <div className="form-field">
            <label htmlFor="ai-title">Task title</label>
            <input id="ai-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={200} />
          </div>
          <div className="form-field">
            <label htmlFor="ai-context">Context (optional)</label>
            <textarea id="ai-context" value={context} onChange={e => setContext(e.target.value)} maxLength={2000} rows={3} />
          </div>
          <button className="btn btn-primary" onClick={handleBreakdown} disabled={loading || !title}>
            {loading ? 'Breaking down...' : 'Generate'}
          </button>

          {cards.length > 0 && (
            <div className="ai-cards-list">
              <h3 className="ai-cards-heading">Suggested cards (click to create):</h3>
              <ul className="ai-cards-items">
                {cards.map((c, i) => (
                  <li key={i} className="ai-card-item">
                    <span className="ai-card-title">{c.title}</span>
                    <button
                      type="button"
                      className={`btn btn-secondary btn-small ${creatingIds.has(i) || createdIds.has(i) ? 'disabled' : ''}`}
                      onClick={() => handleCreateCard(c, i)}
                      disabled={creatingIds.has(i) || createdIds.has(i)}
                    >
                      {createdIds.has(i) ? 'Done' : creatingIds.has(i) ? 'Creating...' : 'Create'}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirmDialog({ message, onConfirm, onCancel }: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.querySelector('button')?.focus();
    const handleEscape = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onCancel]);

  return (
    <div className="dialog-overlay" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
        <h2 className="dialog-title" id="confirm-dialog-title">Confirm</h2>
        <p>{message}</p>
        <div className="dialog-actions">
          <button className="btn btn-danger" onClick={onConfirm}>Delete</button>
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ===== Project List Page =====
function ProjectListPage({ onSelectProject }: { onSelectProject: (id: string) => void }) {
  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: () => api.projects.list() });
  const [showNew, setShowNew] = useState(false);

  if (projectsQuery.isLoading) return <div className="loading">Loading projects...</div>;
  if (projectsQuery.error) return (
    <div className="board-message">
      <p>Failed to load projects</p>
      <button className="btn btn-secondary" onClick={() => projectsQuery.refetch()}>Retry</button>
    </div>
  );

  return (
    <div className="app-layout">
      <div className="board board-padded">
        <h2 className="page-title">Projects</h2>
        {projectsQuery.data?.length === 0 && <div className="empty-state">No projects yet</div>}
        <ul className="project-list">
          {projectsQuery.data?.map((p: Project) => (
            <li key={p.id}>
              <button className="btn btn-secondary project-list-item" onClick={() => onSelectProject(p.id)}>
                {p.name}
              </button>
            </li>
          ))}
        </ul>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}><Plus size={16} /> <span>New Project</span></button>
        {showNew && <NewProjectDialog onClose={() => setShowNew(false)} />}
      </div>
    </div>
  );
}

function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const createMut = useMutation({
    mutationFn: (data: { name: string }) => api.projects.create(data),
    onSuccess: (project: Project) => { navigate(`/project/${project.id}`); onClose(); },
    onError: (e: any) => triggerToast(e.errors?.[0]?.message || 'Failed', 'danger'),
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
      <div className="dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="new-project-title">
        <button className="dialog-close btn-icon" onClick={onClose} aria-label="Close dialog"><X size={20} /></button>
        <h2 className="dialog-title" id="new-project-title">New Project</h2>
        <form className="dialog-form" onSubmit={e => { e.preventDefault(); createMut.mutate({ name }); }}>
          <div className="form-field">
            <label htmlFor="np-name">Name</label>
            <input id="np-name" value={name} onChange={e => setName(e.target.value)} required maxLength={100} />
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

// ===== Board Wrapper =====
function BoardWrapper({ sidebarOpen, onCloseSidebar }: { sidebarOpen: boolean; onCloseSidebar: () => void }) {
  const { id } = useParams<{ id: string }>();
  return (
    <BoardContent
      projectId={id!}
      sidebarOpen={sidebarOpen}
      onCloseSidebar={onCloseSidebar}
    />
  );
}

// ===== App =====
function App() {
  const [theme, setTheme] = useState(getStoredTheme());
  const [user, setUser] = useState<User | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const onBoardRoute = /^\/project\/[^/]+\/?$/.test(location.pathname);

  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
    window.setTimeout(() => menuButtonRef.current?.focus(), 0);
  }, []);

  const toggleSidebar = useCallback(() => {
    if (sidebarOpen) closeSidebar();
    else setSidebarOpen(true);
  }, [closeSidebar, sidebarOpen]);

  useEffect(() => {
    if (!onBoardRoute) setSidebarOpen(false);
  }, [onBoardRoute]);

  useEffect(() => {
    setStoredTheme(theme);
  }, [theme]);

  const fetchMe = useCallback(async () => {
    try {
      const u = await api.auth.me();
      setUser(u);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  if (!user) {
    return (
      <div className="auth-gate">
        <div className="auth-card">
          <div className="auth-brand">
            <span className="header-brand-mark" aria-hidden="true">TM</span>
            <h2>Not authenticated</h2>
          </div>
          <p className="auth-subtitle">Sign in to start doing the heavy lifting.</p>
          <a className="btn btn-primary auth-login" href={api.auth.login()}>Log in</a>
        </div>
        <ToastRegion />
      </div>
    );
  }

  return (
    <div>
      <Header
        user={user}
        onLogout={() => { document.cookie = 'session=; expires=Thu, 01 Jan 1970; path=/'; window.location.href = api.auth.logout(); }}
        onOpenSettings={() => { setSidebarOpen(false); setShowSettings(true); }}
        onToggleSidebar={toggleSidebar}
        showProjectMenu={onBoardRoute}
        sidebarOpen={sidebarOpen}
        menuButtonRef={menuButtonRef}
      />
      <Routes>
        <Route path="/" element={<ProjectListPage onSelectProject={(id) => navigate(`/project/${id}`)} />} />
        <Route
          path="/project/:id"
          element={<BoardWrapper sidebarOpen={sidebarOpen} onCloseSidebar={closeSidebar} />}
        />
        <Route path="/projects/new" element={<NewProjectPage />} />
      </Routes>
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
      <ToastRegion />
    </div>
  );
}

function NewProjectPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const createMut = useMutation({
    mutationFn: (data: { name: string; description?: string }) => api.projects.create(data),
    onSuccess: (project: Project) => { navigate(`/project/${project.id}`); },
    onError: (e: any) => triggerToast(e.errors?.[0]?.message || 'Failed to create project', 'danger'),
  });

  return (
    <div className="app-layout">
      <div className="board board-padded">
        <h2 className="page-title">New Project</h2>
        <form className="project-form" onSubmit={e => { e.preventDefault(); createMut.mutate({ name, description }); }}>
          <div className="form-field">
            <label htmlFor="new-project-name">Project name</label>
            <input id="new-project-name" value={name} onChange={e => setName(e.target.value)} required maxLength={100} />
          </div>
          <div className="form-field">
            <label htmlFor="new-project-desc">Description (optional)</label>
            <textarea id="new-project-desc" value={description} onChange={e => setDescription(e.target.value)} maxLength={500} rows={3} />
          </div>
          <div className="dialog-actions">
            <button type="submit" className="btn btn-primary">Create</button>
            <button type="button" className="btn btn-secondary" onClick={() => navigate('/')}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default App;
