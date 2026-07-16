import React, { useEffect, useState, useCallback, useRef, createContext, useContext } from 'react';
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DndContext, DragOverlay, useSensor, useSensors, PointerSensor, KeyboardSensor } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { api } from './api';
import type { User, Project, Lane, Task, ThemeName } from './types';
import { Check, X, Plus, Edit, Trash, Archive, LogOut, Settings, AlertTriangle, ChevronUp, ChevronDown, Move } from 'lucide-react';
import SettingsDialog from './components/SettingsDialog';
import MoveTaskDialog from './components/MoveTaskDialog';
import MoveToNewProjectDialog from './components/MoveToNewProjectDialog';
import TaskCard from './components/TaskCard';
import LaneCard from './components/LaneCard';

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
    <div className="toast-container" role="region" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type || ''}`}>
          {t.type === 'danger' && <AlertTriangle size={16} />}
          {t.type === 'success' && <Check size={16} />}
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}

export function triggerToast(message: string, type?: 'success' | 'danger') {
  window.dispatchEvent(new CustomEvent('toast', { detail: { message, type } }));
}

// ===== Header =====
function Header({ user, onLogout, onOpenSettings, onToggleSidebar }: { user: User; onLogout: () => void; onOpenSettings: () => void; onToggleSidebar: () => void }) {
  return (
    <header className="header" role="banner">
      <button className="btn btn-icon mobile-toggle" onClick={onToggleSidebar} aria-label="Toggle sidebar">
        <ChevronUp size={20} />
      </button>
      <span className="header-title">TaskMaster</span>
      <div className="header-actions">
        <button onClick={onOpenSettings} aria-label="Settings">
          <Settings size={20} />
        </button>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          {user.subject.slice(0, 8)}...
        </span>
        <button onClick={onLogout} aria-label="Log out">
          <LogOut size={20} />
        </button>
      </div>
    </header>
  );
}

// ===== Project Sidebar =====
function ProjectSidebar({ projects, archivedProjects, selectedProjectId, sidebarOpen, onSelect, onCreateProject, onArchive, onUnarchive, onOpenSettings }: {
  projects: Project[];
  archivedProjects: Project[];
  selectedProjectId: string | null;
  sidebarOpen: boolean;
  onSelect: (id: string) => void;
  onCreateProject: () => void;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  onOpenSettings: () => void;
}) {
  return (
    <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`} role="navigation" aria-label="Project sidebar">
      <div className="sidebar-section">
        <button className="btn btn-primary" onClick={onCreateProject}>
          <Plus size={16} /> New Project
        </button>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-heading">Active Projects</div>
        {projects.length === 0 && <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>No projects</div>}
        <ul style={{ listStyle: 'none' }}>
          {projects.map((p: Project) => (
            <li key={p.id}>
              <div
                className={`sidebar-item ${selectedProjectId === p.id ? 'active' : ''}`}
                onClick={() => onSelect(p.id)}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && onSelect(p.id)}
              >
                {p.name}
                <button className="btn-icon btn-small" onClick={e => { e.stopPropagation(); onArchive(p.id); }} aria-label={`Archive ${p.name}`}>
                  <Archive size={16} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {archivedProjects.length > 0 && (
        <div className="sidebar-section">
          <div className="sidebar-heading">Archived Projects</div>
          <ul style={{ listStyle: 'none' }}>
            {archivedProjects.map((p: Project) => (
              <li key={p.id}>
                <div className="sidebar-item" onClick={() => onSelect(p.id)} role="button" tabIndex={0}>
                  {p.name}
                  <button className="btn-icon btn-small" onClick={e => { e.stopPropagation(); onUnarchive(p.id); }} aria-label={`Unarchive ${p.name}`}>
                    <Archive size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="sidebar-section">
        <button className="btn btn-secondary" onClick={onOpenSettings}>
          <Settings size={16} /> Settings
        </button>
      </div>
    </aside>
  );
}

// ===== Board =====
function BoardContent({ projectId, sidebarOpen, onToggleSidebar }: { projectId: string; sidebarOpen: boolean; onToggleSidebar: () => void }) {
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
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['project', projectId] }); queryClient.invalidateQueries({ queryKey: ['projects'] }); navigate('/'); },
    onError: (e: any) => triggerToast(e.errors?.[0]?.message || 'Failed to archive', 'danger'),
  });

  const createLaneMut = useMutation({
    mutationFn: (data: { name: string }) => api.lanes.create(projectId, { ...data, expectedProjectVersion: project.version }),
    onSuccess: (lane) => {
      queryClient.invalidateQueries({ queryKey: ['lanes', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      triggerToast('Lane created', 'success');
    },
    onError: (e: any) => triggerToast(e.errors?.[0]?.message || 'Failed to create lane', 'danger'),
  });

  const renameLaneMut = useMutation({
    mutationFn: ({ laneId, name, expectedVersion }: { laneId: string; name: string; expectedVersion: number }) =>
      api.lanes.rename(projectId, laneId, { name, expectedVersion, expectedProjectVersion: project.version }),
    onSuccess: (lane) => {
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
  const [showMoveDialog, setShowMoveDialog] = useState<Task | null>(null);
  const [showMoveToNewProject, setShowMoveToNewProject] = useState<Task | null>(null);
  const [showAiBreakdown, setShowAiBreakdown] = useState<{ laneId: string } | null>(null);

  const [activeDraggedTask, setActiveDraggedTask] = useState<Task | null>(null);
  const [activeDraggedLane, setActiveDraggedLane] = useState<Lane | null>(null);

  // Optimistic snapshots for drag
  const [optimisticTaskOrder, setOptimisticTaskOrder] = useState<Record<string, { beforeId?: string; afterId?: string; laneId: string }>>({});
  const [optimisticLaneOrder, setOptimisticLaneOrder] = useState<string[] | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );

  // Active projects
  const activeProjects = projectsQuery.data?.filter((p: Project) => !p.archivedAt) || [];
  const archivedProjects = projectsQuery.data?.filter((p: Project) => !!p.archivedAt) || [];

  const tasksByLane = (laneId: string) => tasksQuery.data?.filter((t: Task) => t.laneId === laneId).sort((a: Task, b: Task) => a.rank - b.rank) || [];

  const isArchived = !!projectQuery.data?.archivedAt;

  const handleTaskMove = async (taskId: string, destinationLaneId: string, beforeId?: string, afterId?: string, optimisticUpdate?: () => void) => {
    const task = tasksQuery.data?.find((t: Task) => t.id === taskId);
    if (!task) return;
    if (optimisticUpdate) optimisticUpdate();
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
        if (optimisticUpdate) optimisticUpdate(); // roll back
      } else {
        triggerToast(e.errors?.[0]?.message || 'Move failed', 'danger');
        if (optimisticUpdate) optimisticUpdate(); // roll back
      }
    }
  };

  const handleTaskDragEnd = (event: any) => {
    if (!event.over || !event.active) {
      setActiveDraggedTask(null);
      return;
    }

    const taskId = event.active.id as string;
    const overId = event.over.id as string;
    const overData = event.over.data;
    const overType = overData?.current?.type as string | undefined;
    const overLaneId = overType === 'lane' ? overId : tasksQuery.data?.find((t: Task) => t.id === overId)?.laneId;
    if (!overLaneId) {
      setActiveDraggedTask(null);
      return;
    }

    // Get all tasks in the destination lane sorted by rank
    const sorted = tasksQuery.data?.filter((t: Task) => t.laneId === overLaneId).sort((a, b) => a.rank - b.rank) || [];
    const draggedTask = tasksQuery.data?.find((t: Task) => t.id === taskId);
    if (!draggedTask) { setActiveDraggedTask(null); return; }

    // Remove the dragged task from its current position
    const remaining = sorted.filter((t: Task) => t.id !== taskId);

    // If dropping on a task, insert before the target (before=previous item, after=target)
    let beforeId: string | undefined;
    let afterId: string | undefined;
    if (overType === 'task') {
      const targetIdx = remaining.findIndex((t: Task) => t.id === overId);
      if (targetIdx === -1) { setActiveDraggedTask(null); return; }
      beforeId = targetIdx > 0 ? remaining[targetIdx - 1].id : undefined;
      afterId = overId;
    } else {
      // Dropping on lane, append at end (before=last item in remaining, after=undefined)
      if (remaining.length > 0) {
        beforeId = remaining[remaining.length - 1].id;
        afterId = undefined;
      } else {
        beforeId = undefined;
        afterId = undefined;
      }
    }

    // No-op if same position
    if (taskId === overId || (overLaneId === draggedTask.laneId && remaining.length === sorted.length && beforeId === undefined && afterId === undefined) || (overType === 'task' && taskId === overId)) {
      setActiveDraggedTask(null);
      return;
    }

    // Optimistic cache: mirror result locally
    const optimisticSnapshot = { ...optimisticTaskOrder };
    setOptimisticTaskOrder(prev => ({
      ...prev,
      [taskId]: { beforeId, afterId, laneId: overLaneId },
    }));

    handleTaskMove(taskId, overLaneId, beforeId, afterId, () => {
      // roll back optimistic cache
      setOptimisticTaskOrder(optimisticSnapshot);
    });
    setActiveDraggedTask(null);
  };

  const handleLaneDragEnd = (event: any) => {
    if (!event.over || !event.active) {
      setActiveDraggedLane(null);
      return;
    }
    const laneId = event.active.id as string;
    const overId = event.over.id as string;
    const lanes = lanesQuery.data || [];
    const oldIndex = lanes.findIndex((l: Lane) => l.id === laneId);
    const newIndex = lanes.findIndex((l: Lane) => l.id === overId);
    if (oldIndex === -1 || newIndex === -1) {
      setActiveDraggedLane(null);
      return;
    }
    const reordered = arrayMove(lanes, oldIndex, newIndex);
    const laneIds = reordered.map((l: Lane) => l.id);
    api.lanes.reorder(projectId, { laneIds, expectedProjectVersion: project.version }).then(() => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['lanes', projectId] });
      triggerToast('Lanes reordered', 'success');
    }).catch((e: any) => triggerToast(e.errors?.[0]?.message || 'Reorder failed', 'danger'));
    setActiveDraggedLane(null);
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

  // Compute before/after drag anchors
  const computeDropAnchors = (sortedIds: string[], droppedId: string, overId: string) => {
    const idx = sortedIds.indexOf(droppedId);
    const overIdx = sortedIds.indexOf(overId);
    if (idx === -1 || overIdx === -1) return { beforeId: undefined, afterId: undefined };
    if (idx > overIdx) {
      return { beforeId: overId, afterId: undefined };
    } else {
      return { beforeId: undefined, afterId: overId };
    }
  };

  // Error states
  if (projectQuery.error) {
    return (
      <div className="app-layout">
        <ProjectSidebar
          projects={activeProjects}
          archivedProjects={archivedProjects}
          selectedProjectId={projectId}
          sidebarOpen={sidebarOpen}
          onSelect={(id) => { navigate(`/project/${id}`); if (sidebarOpen) onToggleSidebar(); }}
          onCreateProject={() => { navigate('/projects/new'); if (sidebarOpen) onToggleSidebar(); }}
          onArchive={(id) => {
            const project = projectsQuery.data?.find((p: Project) => p.id === id);
            api.projects.archive(id, { expectedVersion: project?.version ?? 0 }).then(() => {
              queryClient.invalidateQueries({ queryKey: ['projects'] });
              if (id === projectId) navigate('/');
            }).catch((e: any) => triggerToast(e.errors?.[0]?.message || 'Failed to archive', 'danger'));
            if (sidebarOpen) onToggleSidebar();
          }}
          onUnarchive={(id) => {
            const project = projectsQuery.data?.find((p: Project) => p.id === id);
            api.projects.unarchive(id, { expectedVersion: project?.version ?? 0 }).then(() => {
              queryClient.invalidateQueries({ queryKey: ['projects'] });
              navigate(`/project/${id}`);
            }).catch((e: any) => triggerToast(e.errors?.[0]?.message || 'Failed to unarchive', 'danger'));
            if (sidebarOpen) onToggleSidebar();
          }}
          onOpenSettings={() => { setShowSettings(true); if (sidebarOpen) onToggleSidebar(); }}
        />
        <div className="board">
          <div style={{ padding: '32px', flex: 1 }}>
            <p style={{ color: 'var(--danger)' }}>Failed to load project</p>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{(projectQuery.error as any)?.message || (projectQuery.error as any)?.errors?.[0]?.message}</p>
            <button className="btn btn-secondary" onClick={() => projectQuery.refetch()}>Retry</button>
          </div>
          <ToastRegion />
        </div>
      </div>
    );
  }

  if (!projectQuery.data) {
    if (projectQuery.isLoading) return <div className="loading">Loading project...</div>;
    return <div style={{ padding: '32px' }}><p>Project not found</p></div>;
  }

  const project = projectQuery.data;

  return (
    <div className="app-layout">
      <ProjectSidebar
        projects={activeProjects}
        archivedProjects={archivedProjects}
        selectedProjectId={projectId}
        sidebarOpen={sidebarOpen}
        onSelect={(id) => { navigate(`/project/${id}`); if (sidebarOpen) onToggleSidebar(); }}
        onCreateProject={() => { navigate('/projects/new'); if (sidebarOpen) onToggleSidebar(); }}
        onArchive={(id) => {
          const project = projectsQuery.data?.find((p: Project) => p.id === id);
          api.projects.archive(id, { expectedVersion: project?.version ?? 0 }).then(() => {
            queryClient.invalidateQueries({ queryKey: ['projects'] });
            if (id === projectId) navigate('/');
          }).catch((e: any) => triggerToast(e.errors?.[0]?.message || 'Failed to archive', 'danger'));
          if (sidebarOpen) onToggleSidebar();
        }}
        onUnarchive={(id) => {
          const project = projectsQuery.data?.find((p: Project) => p.id === id);
          api.projects.unarchive(id, { expectedVersion: project?.version ?? 0 }).then(() => {
            queryClient.invalidateQueries({ queryKey: ['projects'] });
            navigate(`/project/${id}`);
          }).catch((e: any) => triggerToast(e.errors?.[0]?.message || 'Failed to unarchive', 'danger'));
          if (sidebarOpen) onToggleSidebar();
        }}
        onOpenSettings={() => { setShowSettings(true); if (sidebarOpen) onToggleSidebar(); }}
      />
      <div className="board">
        {isArchived ? (
          <div className="board-header" style={{ opacity: 0.6 }}>
            <h2>{project.name} (archived)</h2>
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
            <h2>{project.name}</h2>
            <button className="btn btn-secondary btn-small" onClick={() => {
              const newName = prompt('New name');
              if (newName) updateProjectMut.mutate({ name: newName, expectedVersion: project.version });
            }}>
              <Edit size={14} /> Edit
            </button>
            <button className="btn btn-danger btn-small" onClick={() => archiveProjectMut.mutate({ expectedVersion: project.version })}>
              <Archive size={14} /> Archive project
            </button>
            <div className="board-actions">
              <button className="btn btn-primary" onClick={() => {
                const name = prompt('Lane name');
                if (name) createLaneMut.mutate({ name });
              }}>
                <Plus size={14} /> Add Lane
              </button>
            </div>
          </div>
        )}

        <DndContext
          sensors={sensors}
          onDragStart={(e) => {
            if (e.active.data?.current?.type === 'task') setActiveDraggedTask(tasksQuery.data?.find((t: Task) => t.id === e.active.id) || null);
            if (e.active.data?.current?.type === 'lane') setActiveDraggedLane(lanesQuery.data?.find((l: Lane) => l.id === e.active.id) || null);
          }}
          onDragCancel={() => {
            setActiveDraggedTask(null);
            setActiveDraggedLane(null);
          }}
          onDragEnd={(e) => {
            handleTaskDragEnd(e);
            handleLaneDragEnd(e);
          }}
        >
          <DragOverlay>
            {activeDraggedTask && (
              <div className="task-card dragging" style={{ width: '280px' }}>
                <div className="task-title">{activeDraggedTask.title}</div>
              </div>
            )}
            {activeDraggedLane && (
              <div className="lane dragging" style={{ minWidth: '280px', opacity: 0.5 }}>
                <div className="lane-header"><span>{activeDraggedLane.name}</span></div>
              </div>
            )}
          </DragOverlay>

          {tasksQuery.error && !isArchived && (
            <div style={{ padding: '32px', flex: 1 }}>
              <p style={{ color: 'var(--danger)' }}>Failed to load tasks</p>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{(tasksQuery.error as any)?.message || (tasksQuery.error as any)?.errors?.[0]?.message}</p>
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
            <div style={{ padding: '32px', flex: 1 }}>
              <p style={{ color: 'var(--danger)' }}>Failed to load lanes</p>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{(lanesQuery.error as any)?.message || (lanesQuery.error as any)?.errors?.[0]?.message}</p>
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
                  projectId={projectId}
                  onRename={(name: string) => renameLaneMut.mutate({ laneId: lane.id, name, expectedVersion: lane.version })}
                  onDelete={() => setShowingDeleteLane(lane.id)}
                  onAddTask={() => setAddTaskLaneId(lane.id)}
                  onAiBreakdown={() => setShowAiBreakdown({ laneId: lane.id })}
                  onEditTask={(taskId: string) => setEditingTaskId(taskId)}
                  onDeleteTask={(taskId: string) => setShowingDeleteTask(taskId)}
                   onMoveTask={(taskId: string) => {
                     const task = tasksQuery.data?.find((t: Task) => t.id === taskId);
                     if (task) setShowMoveDialog(task);
                   }}
                   onMoveToNewProject={(taskId: string) => {
                     const task = tasksQuery.data?.find((t: Task) => t.id === taskId);
                     if (task) setShowMoveToNewProject(task);
                   }}
                />
              ))}
              {(!lanesQuery.data || lanesQuery.data.length === 0) && <div className="empty-state">No lanes yet</div>}
            </div>
          )}
          {!isArchived && !lanesQuery.error && !lanesQuery.isLoading && !lanesQuery.data && (
            <div className="empty-state">No lanes yet</div>
          )}
        </DndContext>

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
        {showMoveDialog && (
          <MoveTaskDialog
            task={showMoveDialog}
            lanes={lanesQuery.data || []}
            onClose={() => setShowMoveDialog(null)}
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

  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (taskQuery.data) {
      setTitle(taskQuery.data.title);
      setDescription(taskQuery.data.description || '');
    }
  }, [taskQuery.data]);

  useEffect(() => {
    dialogRef.current?.querySelector('input')?.focus();
    const handleEscape = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

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
        <select value={targetId} onChange={e => setTargetId(e.target.value)} style={{ marginTop: '8px', width: '100%' }}>
          {lanes.filter((l: Lane) => l.id !== laneId).map((l: Lane) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
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
    } catch (e: any) {
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
      <div className="dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="ai-breakdown-title" style={{ maxWidth: 'min(600px, 92vw)', width: 'auto' }}>
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
            <div style={{ marginTop: '16px' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '8px' }}>Suggested cards (click to create):</h3>
              <ul style={{ listStyle: 'none' }}>
                {cards.map((c, i) => (
                  <li key={i} style={{ marginBottom: '4px' }}>
                    <button
                      className={`btn btn-secondary btn-small ${creatingIds.has(i) || createdIds.has(i) ? 'disabled' : ''}`}
                      onClick={() => handleCreateCard(c, i)}
                      disabled={creatingIds.has(i) || createdIds.has(i)}
                    >
                      {c.title} - {createdIds.has(i) ? 'Done' : creatingIds.has(i) ? 'Creating...' : 'Create'}
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
    <div style={{ padding: '32px' }}>
      <p>Failed to load projects</p>
      <button className="btn btn-secondary" onClick={() => projectsQuery.refetch()}>Retry</button>
    </div>
  );

  return (
    <div className="app-layout">
      <div className="board" style={{ padding: '32px' }}>
        <h2 style={{ marginBottom: '16px' }}>Projects</h2>
        {projectsQuery.data?.length === 0 && <div className="empty-state">No projects yet</div>}
        <ul style={{ listStyle: 'none' }}>
          {projectsQuery.data?.map((p: Project) => (
            <li key={p.id} style={{ marginBottom: '4px' }}>
              <button className="btn btn-secondary" onClick={() => onSelectProject(p.id)}>
                {p.name}
              </button>
            </li>
          ))}
        </ul>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>New Project</button>
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
function BoardWrapper() {
  const { id } = useParams<{ id: string }>();
  // Sidebar state is shared via App context; but simpler: use a local hook approach
  const [sidebarOpen, setSidebarOpen] = useState(false);
  return <BoardContent projectId={id!} sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen(prev => !prev)} />;
}

// ===== App =====
function App() {
  const [theme, setTheme] = useState(getStoredTheme());
  const [user, setUser] = useState<User | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();

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
      <div style={{ padding: '32px', textAlign: 'center' }}>
        <h2>Not authenticated</h2>
        <p><a href={api.auth.login()}>Log in</a></p>
        <ToastRegion />
      </div>
    );
  }

  return (
    <div>
      <Header
        user={user}
        onLogout={() => { document.cookie = 'session=; expires=Thu, 01 Jan 1970; path=/'; window.location.href = api.auth.logout(); }}
        onOpenSettings={() => setShowSettings(true)}
        onToggleSidebar={() => setSidebarOpen(prev => !prev)}
      />
      <Routes>
        <Route path="/" element={<ProjectListPage onSelectProject={(id) => navigate(`/project/${id}`)} />} />
        <Route path="/project/:id" element={<BoardWrapper />} />
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
      <div className="board" style={{ padding: '32px' }}>
        <h2 style={{ marginBottom: '16px' }}>New Project</h2>
        <form onSubmit={e => { e.preventDefault(); createMut.mutate({ name, description }); }}>
          <div className="form-field" style={{ marginBottom: '12px' }}>
            <label htmlFor="new-project-name">Project name</label>
            <input id="new-project-name" value={name} onChange={e => setName(e.target.value)} required maxLength={100} />
          </div>
          <div className="form-field" style={{ marginBottom: '12px' }}>
            <label htmlFor="new-project-desc">Description (optional)</label>
            <textarea id="new-project-desc" value={description} onChange={e => setDescription(e.target.value)} maxLength={500} rows={3} />
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="submit" className="btn btn-primary">Create</button>
            <button type="button" className="btn btn-secondary" onClick={() => navigate('/')}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default App;
