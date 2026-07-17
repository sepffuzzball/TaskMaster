import { ApiErrors } from './types';

const API_BASE = '/api/v1';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const errors: ApiErrors = await response.json().catch(() => ({
      errors: [{ code: 'NETWORK_ERROR', message: 'Failed to fetch' }],
    }));
    throw errors;
  }

  return response.json() as Promise<T>;
}

// Inline type references
type User = import('./types').User;
type Project = import('./types').Project;
type Lane = import('./types').Lane;
type Task = import('./types').Task;
type ApiToken = import('./types').ApiToken;
type Tag = import('./types').Tag;

export const api = {
  auth: {
    me: () => request<User>('/auth/me'),
    login: () => `${API_BASE}/auth/login`,
    logout: () => `${API_BASE}/auth/logout`,
  },
  projects: {
    list: () => request<Project[]>('/projects'),
    get: (id: string) => request<Project>(`/projects/${id}`),
    create: (data: { name: string; description?: string }) =>
      request<Project>('/projects', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: { name: string; description?: string; expectedVersion: number }) =>
      request<Project>(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    archive: (id: string, data?: { expectedVersion: number }) =>
      request<Project>(`/projects/${id}/archive`, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
    unarchive: (id: string, data?: { expectedVersion: number }) =>
      request<Project>(`/projects/${id}/unarchive`, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
  },
  lanes: {
    list: (projectId: string) =>
      request<Lane[]>(`/projects/${projectId}/lanes`),
    get: (projectId: string, laneId: string) =>
      request<Lane>(`/projects/${projectId}/lanes/${laneId}`),
    create: (projectId: string, data: { name: string; rank?: number; expectedProjectVersion: number }) =>
      request<Lane>(`/projects/${projectId}/lanes`, { method: 'POST', body: JSON.stringify(data) }),
    rename: (projectId: string, laneId: string, data: { name?: string; expectedVersion: number; expectedProjectVersion: number }) =>
      request<Lane>(`/projects/${projectId}/lanes/${laneId}`, { method: 'PUT', body: JSON.stringify(data) }),
    reorder: (projectId: string, data: { laneIds: string[]; expectedProjectVersion: number }) =>
      request<{ success: boolean }>(`/projects/${projectId}/lanes/reorder`, { method: 'POST', body: JSON.stringify(data) }),
    delete: (projectId: string, laneId: string, data: { targetLaneId: string; expectedProjectVersion: number }) =>
      request<{ success: boolean }>(`/projects/${projectId}/lanes/${laneId}`, {
        method: 'DELETE',
        body: JSON.stringify(data),
      }),
  },
  tasks: {
    list: (projectId: string, laneId?: string) => {
      const query = laneId ? `?laneId=${laneId}` : '';
      return request<Task[]>(`/projects/${projectId}/tasks${query}`);
    },
    get: (projectId: string, taskId: string) =>
      request<Task>(`/projects/${projectId}/tasks/${taskId}`),
    create: (projectId: string, laneId: string, data: { title: string; description?: string; tagNames?: string[] }) =>
      request<Task>(`/projects/${projectId}/lanes/${laneId}/tasks`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (projectId: string, taskId: string, data: { title?: string; description?: string; tagNames?: string[]; expectedVersion: number }) =>
      request<Task>(`/projects/${projectId}/tasks/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    move: (taskId: string, data: {
      destinationProjectId: string;
      destinationLaneId?: string;
      beforeTaskId?: string;
      afterTaskId?: string;
      expectedVersion: number;
    }) =>
      request<Task>(`/tasks/${taskId}/move`, { method: 'POST', body: JSON.stringify(data) }),
    moveToNewProject: (taskId: string, data: { projectName: string; expectedVersion: number }) =>
      request<Task>(`/tasks/${taskId}/move-to-new-project`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    delete: (taskId: string, expectedVersion: number) =>
      request<{ success: true }>(`/tasks/${taskId}`, {
        method: 'DELETE',
        body: JSON.stringify({ expectedVersion }),
      }),
  },
  ai: {
    breakdown: (data: { title: string; context?: string }) =>
      request<{ cards: { title: string; description?: string }[] }>('/ai/breakdown', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
  tokens: {
    list: () => request<ApiToken[]>('/auth/tokens'),
    create: (data: { name: string; scopes: ('read' | 'write')[]; expiresInDays?: number }) =>
      request<{ token: string; apiToken: ApiToken }>('/auth/tokens', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    revoke: (tokenId: string) =>
      request<{ success: boolean }>(`/auth/tokens/${tokenId}/revoke`, { method: 'POST' }),
  },
  tags: {
    list: () => request<Tag[]>('/tags'),
    update: (tagId: string, data: { name?: string; color?: string; expectedVersion: number }) =>
      request<Tag>(`/tags/${tagId}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (tagId: string, expectedVersion: number) =>
      request<{ success: boolean }>(`/tags/${tagId}?expectedVersion=${expectedVersion}`, { method: 'DELETE' }),
  },
};
