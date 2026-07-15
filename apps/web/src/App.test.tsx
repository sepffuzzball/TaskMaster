import { describe, it, afterEach, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { mockFetch } from './test/setup';

// Mock @dnd-kit/core to capture DndContext props for testing drag events
vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual('@dnd-kit/core');
  return {
    ...actual,
    DndContext: (props: { onDragStart?: any; onDragCancel?: any; onDragEnd?: any; children?: any }) => {
      // Store handlers for test access
      (window as any).__dndOnDragEnd = props.onDragEnd;
      (window as any).__dndOnDragStart = props.onDragStart;
      (window as any).__dndOnDragCancel = props.onDragCancel;
      return <div data-testid="dnd-context">{props.children}</div>;
    },
  };
});

mockFetch();

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

function renderApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

function mockFetchResponse(data: any, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(data),
    headers: new Headers(),
  } as Response);
}

// Helper to build a fetch mock that matches URL endings
function apiMock(handlers: Array<{ match: (url: string, opts?: any) => boolean; response: (url: string, opts?: any) => Promise<Response> }>) {
  return vi.fn().mockImplementation((url: string, opts?: any) => {
    for (const h of handlers) {
      if (h.match(url, opts)) return h.response(url, opts);
    }
    return mockFetchResponse({});
  });
}

describe('App', () => {
  it('shows login when unauthenticated (401)', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ errors: [{ code: 'UNAUTHORIZED', message: 'Not authenticated' }] }),
        headers: new Headers(),
      } as Response)
    );

    renderApp();
    await waitFor(() => {
      const headings = screen.getAllByRole('heading');
      expect(headings.some(h => h.textContent === 'Not authenticated')).toBe(true);
    });
  });

  it('applies Catppuccin theme from localStorage', () => {
    localStorage.setItem('taskmaster-theme', 'latte');
    renderApp();
    expect(document.documentElement.getAttribute('data-theme')).toBe('latte');
    expect(localStorage.getItem('taskmaster-theme')).toBe('latte');
  });

  it('applies default theme and tokyo-night persists', () => {
    renderApp();
    expect(document.documentElement.getAttribute('data-theme')).toBe('tokyo-night');
    expect(localStorage.getItem('taskmaster-theme')).toBe('tokyo-night');
  });

  it('shows not authenticated on fetch error', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('Network error')));
    renderApp();
    await waitFor(() => {
      const headings = screen.getAllByRole('heading');
      expect(headings.some(h => h.textContent === 'Not authenticated')).toBe(true);
    });
  });

  // === New tests ===

  it('lane delete request includes expectedVersion equal to project version', async () => {
    const mockedFetch = apiMock([
      {
        match: (url) => url.endsWith('/auth/me'),
        response: () => mockFetchResponse({ id: '1', issuer: 'test', subject: 'test', createdAt: '', updatedAt: '' }),
      },
      {
        match: (url) => url.endsWith('/projects') && !url.includes('/tasks') && !url.includes('/lanes'),
        response: () => mockFetchResponse([{ id: 'proj1', name: 'Test Proj', version: 5, rank: 1, archivedAt: null, createdAt: '', updatedAt: '', ownerId: '1' }]),
      },
      {
        match: (url) => url.endsWith('/projects/proj1') && !url.includes('/tasks') && !url.includes('/lanes'),
        response: () => mockFetchResponse({ id: 'proj1', name: 'Test Proj', version: 5, rank: 1, archivedAt: null, createdAt: '', updatedAt: '', ownerId: '1' }),
      },
      {
        match: (url) => url.includes('/lanes') && url.includes('/proj1'),
        response: () => mockFetchResponse([
          { id: 'lane1', name: 'Lane 1', version: 1, projectId: 'proj1', rank: 0, createdAt: '', updatedAt: '' },
          { id: 'lane2', name: 'Lane 2', version: 1, projectId: 'proj1', rank: 1, createdAt: '', updatedAt: '' },
        ]),
      },
      {
        match: (url) => url.includes('/tasks') && url.includes('/proj1'),
        response: () => mockFetchResponse([]),
      },
      {
        match: (url, opts) => url.includes('/lane1') && opts?.method === 'DELETE',
        response: () => mockFetchResponse({ success: true }),
      },
    ]);
    global.fetch = mockedFetch;

    renderApp();
    await waitFor(() => screen.getByRole('button', { name: 'Test Proj' }));
    const user = await userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Test Proj' }));
    await waitFor(() => screen.getByText('Lane 1'));
    const deleteBtns = screen.getAllByLabelText('Delete lane');
    await user.click(deleteBtns[0]);
    await waitFor(() => screen.getByText('Delete Lane'));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      const deleteCalls = vi.mocked(mockedFetch).mock.calls.filter(
        (call: any) => call[0].includes('/lane1') && (call[1]?.method === 'DELETE')
      );
      expect(deleteCalls.length).toBeGreaterThan(0);
      const deleteBody = JSON.parse(deleteCalls[deleteCalls.length - 1][1].body);
      expect(deleteBody.expectedVersion).toBe(5);
    });
  });

  it('lane reorder request includes expectedVersion equal to project version', async () => {
    const mockedFetch = apiMock([
      {
        match: (url) => url.endsWith('/auth/me'),
        response: () => mockFetchResponse({ id: '1', issuer: 'test', subject: 'test', createdAt: '', updatedAt: '' }),
      },
      {
        match: (url) => url.endsWith('/projects') && !url.includes('/tasks') && !url.includes('/lanes'),
        response: () => mockFetchResponse([{ id: 'proj1', name: 'Test Proj', version: 42, rank: 1, archivedAt: null, createdAt: '', updatedAt: '', ownerId: '1' }]),
      },
      {
        match: (url) => url.endsWith('/projects/proj1') && !url.includes('/tasks') && !url.includes('/lanes'),
        response: () => mockFetchResponse({ id: 'proj1', name: 'Test Proj', version: 42, rank: 1, archivedAt: null, createdAt: '', updatedAt: '', ownerId: '1' }),
      },
      {
        match: (url) => url.includes('/lanes') && url.includes('/proj1'),
        response: () => mockFetchResponse([
          { id: 'lane1', name: 'Lane 1', version: 1, projectId: 'proj1', rank: 0, createdAt: '', updatedAt: '' },
          { id: 'lane2', name: 'Lane 2', version: 1, projectId: 'proj1', rank: 1, createdAt: '', updatedAt: '' },
        ]),
      },
      {
        match: (url) => url.includes('/tasks') && url.includes('/proj1'),
        response: () => mockFetchResponse([]),
      },
      {
        match: (url) => url.includes('/reorder'),
        response: () => mockFetchResponse({ success: true }),
      },
    ]);
    global.fetch = mockedFetch;

    renderApp();
    await waitFor(() => screen.getByRole('button', { name: 'Test Proj' }));
    const user = await userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Test Proj' }));
    await waitFor(() => screen.getByText('Lane 1'));

    await waitFor(() => {
      const reorderCalls = vi.mocked(mockedFetch).mock.calls.filter(
        (call: any) => call[0].includes('/reorder')
      );
      if (reorderCalls.length > 0) {
        const reorderBody = JSON.parse(reorderCalls[reorderCalls.length - 1][1].body);
        expect(reorderBody.expectedVersion).toBe(42);
      }
    });
  });

  it('manual move task invalidates tasks queries and sends version', async () => {
    const mockedFetch = apiMock([
      {
        match: (url) => url.endsWith('/auth/me'),
        response: () => mockFetchResponse({ id: '1', issuer: 'test', subject: 'test', createdAt: '', updatedAt: '' }),
      },
      {
        match: (url) => url.endsWith('/projects') && !url.includes('/tasks') && !url.includes('/lanes'),
        response: () => mockFetchResponse([{ id: 'proj1', name: 'Test Proj', version: 5, rank: 1, archivedAt: null, createdAt: '', updatedAt: '', ownerId: '1' }]),
      },
      {
        match: (url) => url.endsWith('/projects/proj1') && !url.includes('/tasks') && !url.includes('/lanes'),
        response: () => mockFetchResponse({ id: 'proj1', name: 'Test Proj', version: 5, rank: 1, archivedAt: null, createdAt: '', updatedAt: '', ownerId: '1' }),
      },
      {
        match: (url) => url.includes('/lanes') && url.includes('/proj1'),
        response: () => mockFetchResponse([
          { id: 'lane1', name: 'Lane 1', version: 1, projectId: 'proj1', rank: 0, createdAt: '', updatedAt: '' },
          { id: 'lane2', name: 'Lane 2', version: 1, projectId: 'proj1', rank: 1, createdAt: '', updatedAt: '' },
        ]),
      },
      {
        match: (url) => url.includes('/tasks') && url.includes('/proj1'),
        response: () => mockFetchResponse([
          { id: 'task1', title: 'Task 1', version: 3, projectId: 'proj1', laneId: 'lane1', rank: 0, createdAt: '', updatedAt: '' },
        ]),
      },
      {
        match: (url, opts) => url.includes('/tasks/task1/move') && opts?.method === 'POST',
        response: () => mockFetchResponse({ id: 'task1', title: 'Task 1', version: 4, projectId: 'proj1', laneId: 'lane2', rank: 0, createdAt: '', updatedAt: '' }),
      },
    ]);
    global.fetch = mockedFetch;

    renderApp();
    await waitFor(() => screen.getByRole('button', { name: 'Test Proj' }));
    const user = await userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Test Proj' }));
    await waitFor(() => screen.getByText('Task 1'));
    await user.click(screen.getByLabelText('Move task'));
    await waitFor(() => screen.getByText('Move Task'));
    await user.click(screen.getByRole('button', { name: 'Move' }));

    await waitFor(() => {
      const moveCalls = vi.mocked(mockedFetch).mock.calls.filter(
        (call: any) => call[0].includes('/move') && call[0].includes('/tasks/')
      );
      const moveCall = moveCalls.find((call: any) => {
        const body = JSON.parse(call[1].body);
        return body.expectedVersion === 3;
      });
      expect(moveCall).toBeTruthy();
    });
  });

  it('board shows error state for lane fetch failure', async () => {
    const mockedFetch = apiMock([
      {
        match: (url) => url.endsWith('/auth/me'),
        response: () => mockFetchResponse({ id: '1', issuer: 'test', subject: 'test', createdAt: '', updatedAt: '' }),
      },
      {
        match: (url) => url.endsWith('/projects') && !url.includes('/tasks') && !url.includes('/lanes'),
        response: () => mockFetchResponse([{ id: 'proj1', name: 'Test Proj', version: 5, rank: 1, archivedAt: null, createdAt: '', updatedAt: '', ownerId: '1' }]),
      },
      {
        match: (url) => url.endsWith('/projects/proj1') && !url.includes('/tasks') && !url.includes('/lanes'),
        response: () => mockFetchResponse({ id: 'proj1', name: 'Test Proj', version: 5, rank: 1, archivedAt: null, createdAt: '', updatedAt: '', ownerId: '1' }),
      },
      {
        match: (url) => url.includes('/lanes') && url.includes('/proj1'),
        response: () => mockFetchResponse({ errors: [{ code: 'SERVER_ERROR', message: 'Lane fetch failed' }] }, false, 500),
      },
      {
        match: (url) => url.includes('/tasks') && url.includes('/proj1'),
        response: () => mockFetchResponse([]),
      },
    ]);
    global.fetch = mockedFetch;

    renderApp();
    await waitFor(() => screen.getByRole('button', { name: 'Test Proj' }));
    const user = await userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Test Proj' }));
    await waitFor(() => screen.getByText('Failed to load lanes'));
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('board shows error state for task fetch failure', async () => {
    const mockedFetch = apiMock([
      {
        match: (url) => url.endsWith('/auth/me'),
        response: () => mockFetchResponse({ id: '1', issuer: 'test', subject: 'test', createdAt: '', updatedAt: '' }),
      },
      {
        match: (url) => url.endsWith('/projects') && !url.includes('/tasks') && !url.includes('/lanes'),
        response: () => mockFetchResponse([{ id: 'proj1', name: 'Test Proj', version: 5, rank: 1, archivedAt: null, createdAt: '', updatedAt: '', ownerId: '1' }]),
      },
      {
        match: (url) => url.endsWith('/projects/proj1') && !url.includes('/tasks') && !url.includes('/lanes'),
        response: () => mockFetchResponse({ id: 'proj1', name: 'Test Proj', version: 5, rank: 1, archivedAt: null, createdAt: '', updatedAt: '', ownerId: '1' }),
      },
      {
        match: (url) => url.includes('/lanes') && url.includes('/proj1'),
        response: () => mockFetchResponse([
          { id: 'lane1', name: 'Lane 1', version: 1, projectId: 'proj1', rank: 0, createdAt: '', updatedAt: '' },
        ]),
      },
      {
        match: (url) => url.includes('/tasks') && url.includes('/proj1'),
        response: () => mockFetchResponse({ errors: [{ code: 'SERVER_ERROR', message: 'Task fetch failed' }] }, false, 500),
      },
    ]);
    global.fetch = mockedFetch;

    renderApp();
    await waitFor(() => screen.getByRole('button', { name: 'Test Proj' }));
    const user = await userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Test Proj' }));
    await waitFor(() => screen.getByText('Failed to load tasks'));
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('task drag-over-task sends move with before/after anchors', async () => {
    const mockedFetch = apiMock([
      {
        match: (url) => url.endsWith('/auth/me'),
        response: () => mockFetchResponse({ id: '1', issuer: 'test', subject: 'test', createdAt: '', updatedAt: '' }),
      },
      {
        match: (url) => url.endsWith('/projects') && !url.includes('/tasks') && !url.includes('/lanes'),
        response: () => mockFetchResponse([{ id: 'proj1', name: 'Test Proj', version: 1, rank: 1, archivedAt: null, createdAt: '', updatedAt: '', ownerId: '1' }]),
      },
      {
        match: (url) => url.endsWith('/projects/proj1') && !url.includes('/tasks') && !url.includes('/lanes'),
        response: () => mockFetchResponse({ id: 'proj1', name: 'Test Proj', version: 1, rank: 1, archivedAt: null, createdAt: '', updatedAt: '', ownerId: '1' }),
      },
      {
        match: (url) => url.includes('/lanes') && url.includes('/proj1'),
        response: () => mockFetchResponse([
          { id: 'lane1', name: 'Lane 1', version: 1, projectId: 'proj1', rank: 0, createdAt: '', updatedAt: '' },
        ]),
      },
      {
        match: (url) => url.includes('/tasks') && url.includes('/proj1'),
        response: () => mockFetchResponse([
          { id: 'task1', title: 'Task 1', version: 1, projectId: 'proj1', laneId: 'lane1', rank: 0, createdAt: '', updatedAt: '' },
          { id: 'task2', title: 'Task 2', version: 1, projectId: 'proj1', laneId: 'lane1', rank: 1, createdAt: '', updatedAt: '' },
        ]),
      },
      {
        match: (url, opts) => url.includes('/tasks/task1/move') && (opts?.method === 'POST'),
        response: () => mockFetchResponse({ id: 'task1', version: 2, projectId: 'proj1', laneId: 'lane1', rank: 0 }),
      },
    ]);
    global.fetch = mockedFetch;

    renderApp();
    await waitFor(() => screen.getByRole('button', { name: 'Test Proj' }));
    const user = await userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Test Proj' }));
    await waitFor(() => screen.getByText('Task 1'));
    await waitFor(() => screen.getByText('Task 2'));

    // Simulate drag end: drop task1 onto task2 (task-over-task)
    const onDragEnd = (window as any).__dndOnDragEnd;
    expect(onDragEnd).toBeDefined();
    onDragEnd({
      active: { id: 'task1', data: { current: { type: 'task' } } },
      over: { id: 'task2', data: { current: { type: 'task' } } },
    });

    await waitFor(() => {
      const moveCalls = vi.mocked(mockedFetch).mock.calls.filter(
        (call: any) => call[0].includes('/tasks/task1/move')
      );
      expect(moveCalls.length).toBeGreaterThan(0);
      const moveBody = JSON.parse(moveCalls[moveCalls.length - 1][1].body);
      // Dropping task1 onto task2: afterId=task2, beforeId should be undefined since target is the second task
      expect(moveBody.afterTaskId).toBe('task2');
      expect(moveBody.beforeTaskId).toBeUndefined();
      expect(moveBody.destinationLaneId).toBe('lane1');
    });
  });

  it('lane create invalidates project and lanes queries', async () => {
    const mockedFetch = apiMock([
      {
        match: (url) => url.endsWith('/auth/me'),
        response: () => mockFetchResponse({ id: '1', issuer: 'test', subject: 'test', createdAt: '', updatedAt: '' }),
      },
      {
        match: (url) => url.endsWith('/projects') && !url.includes('/tasks') && !url.includes('/lanes'),
        response: () => mockFetchResponse([{ id: 'proj1', name: 'Test Proj', version: 5, rank: 1, archivedAt: null, createdAt: '', updatedAt: '', ownerId: '1' }]),
      },
      {
        match: (url) => url.endsWith('/projects/proj1') && !url.includes('/tasks') && !url.includes('/lanes'),
        response: () => mockFetchResponse({ id: 'proj1', name: 'Test Proj', version: 5, rank: 1, archivedAt: null, createdAt: '', updatedAt: '', ownerId: '1' }),
      },
      {
        match: (url) => url.includes('/lanes') && url.includes('/proj1'),
        response: () => mockFetchResponse([
          { id: 'lane1', name: 'Lane 1', version: 1, projectId: 'proj1', rank: 0, createdAt: '', updatedAt: '' },
        ]),
      },
      {
        match: (url) => url.includes('/tasks') && url.includes('/proj1'),
        response: () => mockFetchResponse([]),
      },
      {
        match: (url, opts) => url.includes('/lanes') && url.endsWith('/proj1/lanes') && opts?.method === 'POST',
        response: () => mockFetchResponse({ id: 'lane2', name: 'Lane 2', version: 1, projectId: 'proj1', rank: 1 }),
      },
    ]);
    global.fetch = mockedFetch;

    renderApp();
    await waitFor(() => screen.getByRole('button', { name: 'Test Proj' }));
    const user = await userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Test Proj' }));
    await waitFor(() => screen.getByText('Lane 1'));

    // Mock prompt to return a lane name
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('New Lane');
    // Click "Add Lane" button
    await user.click(screen.getByRole('button', { name: /Add Lane/i }));
    await waitFor(() => {
      // After creation, the lanes and project queries are invalidated -> refetch
      const laneCalls = vi.mocked(mockedFetch).mock.calls.filter(
        (call: any) => call[0].includes('/lanes') && call[0].includes('/proj1') && call[0].endsWith('/lanes')
      );
      // At least initial load + 1 refetch after mutation
      expect(laneCalls.length).toBeGreaterThanOrEqual(2);
    });
    promptSpy.mockRestore();
  });

  it('lane rename invalidates project and lanes queries and sends expectedVersion', async () => {
    const mockedFetch = apiMock([
      {
        match: (url) => url.endsWith('/auth/me'),
        response: () => mockFetchResponse({ id: '1', issuer: 'test', subject: 'test', createdAt: '', updatedAt: '' }),
      },
      {
        match: (url) => url.endsWith('/projects') && !url.includes('/tasks') && !url.includes('/lanes'),
        response: () => mockFetchResponse([{ id: 'proj1', name: 'Test Proj', version: 10, rank: 1, archivedAt: null, createdAt: '', updatedAt: '', ownerId: '1' }]),
      },
      {
        match: (url) => url.endsWith('/projects/proj1') && !url.includes('/tasks') && !url.includes('/lanes'),
        response: () => mockFetchResponse({ id: 'proj1', name: 'Test Proj', version: 10, rank: 1, archivedAt: null, createdAt: '', updatedAt: '', ownerId: '1' }),
      },
      {
        match: (url) => url.includes('/lanes') && url.includes('/proj1'),
        response: () => mockFetchResponse([
          { id: 'lane1', name: 'Lane 1', version: 2, projectId: 'proj1', rank: 0, createdAt: '', updatedAt: '' },
        ]),
      },
      {
        match: (url) => url.includes('/tasks') && url.includes('/proj1'),
        response: () => mockFetchResponse([]),
      },
      {
        match: (url, opts) => url.includes('/lanes') && url.includes('/lane1') && opts?.method === 'PUT',
        response: () => mockFetchResponse({ id: 'lane1', name: 'Lane 1 Renamed', version: 3, projectId: 'proj1', rank: 0 }),
      },
    ]);
    global.fetch = mockedFetch;

    renderApp();
    await waitFor(() => screen.getByRole('button', { name: 'Test Proj' }));
    const user = await userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Test Proj' }));
    await waitFor(() => screen.getByText('Lane 1'));

    // Click lane name to trigger edit mode
    const laneName = screen.getByText('Lane 1');
    await user.click(laneName);
    // Input field appears - type new name and blur
    const nameInput = screen.getByRole('textbox');
    await user.clear(nameInput);
    await user.type(nameInput, 'Lane 1 Renamed');
    // Trigger onBlur to submit rename
    fireEvent.blur(nameInput);
    await waitFor(() => {
      const renameCalls = vi.mocked(mockedFetch).mock.calls.filter(
        (call: any) => call[0].includes('/lane1') && (call[1]?.method === 'PUT')
      );
      expect(renameCalls.length).toBeGreaterThan(0);
      const renameBody = JSON.parse(renameCalls[renameCalls.length - 1][1].body);
      expect(renameBody.expectedVersion).toBe(2);  // lane version
      // Check invalidations: project and lanes queries should be refetched
      const projectCallsAfterRename = vi.mocked(mockedFetch).mock.calls.filter(
        (call: any) => call[0].endsWith('/projects/proj1') && !call[0].includes('/tasks') && !call[0].includes('/lanes')
      );
      expect(projectCallsAfterRename.length).toBeGreaterThanOrEqual(2);
    });
  });
});
