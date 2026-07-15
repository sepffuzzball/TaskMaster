import React from 'react';
import { Plus, Archive, ArchiveRestore, Settings } from 'lucide-react';
import type { Project } from '../types';

export default function ProjectSidebar({ projects, archivedProjects, selectedProjectId, onSelect, onCreateProject, onArchive, onUnarchive, onOpenSettings, sidebarOpen }: {
  projects: Project[];
  archivedProjects: Project[];
  selectedProjectId: string | null;
  onSelect: (id: string) => void;
  onCreateProject: () => void;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  onOpenSettings: () => void;
  sidebarOpen: boolean;
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
          {projects.map(p => (
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
            {archivedProjects.map(p => (
              <li key={p.id}>
                <div className="sidebar-item" onClick={() => onSelect(p.id)} role="button" tabIndex={0}>
                  {p.name}
                  <button className="btn-icon btn-small" onClick={e => { e.stopPropagation(); onUnarchive(p.id); }} aria-label={`Unarchive ${p.name}`}>
                    <ArchiveRestore size={16} />
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
