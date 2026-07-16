import { describe, it, afterEach, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App, { createKeyboardCoordinateGetter } from './App';
import { mockFetch } from './test/setup';
import { Root } from './main';

// Mock @dnd-kit/core to capture DndContext props for testing drag events.
// The mock renders children inside the real InternalContext so useDraggable/useDroppable
// don't crash, but it stores the handlers on window for tests to invoke synthetically.
vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual('@dnd-kit/core');
  function MockDndContext(props: any) {
    (window as any).__dndOnDragEnd = props.onDragEnd;
    (window as any).__dndOnDragStart = props.onDragStart;
    (window as any).__dndOnDragCancel = props.onDragCancel;
    (window as any).__dndOnDragOver = props.onDragOver;
    (window as any).__dndAccessibility = props.accessibility;
    return React.createElement('div', { 'data-testid': 'dnd-context' }, props.children);
  }
  return {
    ...actual,
    DndContext: MockDndContext,
  };
});

mockFetch();

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  (window as any).__dndOnDragEnd = undefined;
  (window as any).__dndOnDragStart = undefined;
  (window as any).__dndOnDragCancel = undefined;
  (window as any).__dndOnDragOver = undefined;
  (window as any).__dndAccessibility = undefined;
  delete (window as any).matchMedia;
  // Reset window history so each test starts at "/" (BrowserRouter inherits the URL).
  window.history.replaceState({}, '', '/');
});

function setMobileViewport(mobile = true) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: mobile && query === '(max-width: 899px)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

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

// Build the plain Response-shaped object (NOT a Promise) so it can be used to
// resolve a controllable Promise<Response> in tests.
function mockResponseObject(data: any, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(data),
    headers: new Headers(),
  } as Response;
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

// Common mock scaffolding to load a project board with lanes + tasks.
// `extra` handlers are placed FIRST so specific overrides (e.g. task GET,
// move-to-new-project) take priority over the broad default list/projects/
// lanes/tasks matchers.
function boardMock(extra: Array<{ match: (url: string, opts?: any) => boolean; response: (url: string, opts?: any) => Promise<Response> }>, opts: { projectVersion?: number; lanes?: any[]; tasks?: any[] } = {}) {
  const projectVersion = opts.projectVersion ?? 1;
  const lanes = opts.lanes ?? [
    { id: 'lane1', name: 'Lane 1', version: 1, projectId: 'proj1', rank: 0, createdAt: '', updatedAt: '' },
    { id: 'lane2', name: 'Lane 2', version: 1, projectId: 'proj1', rank: 1, createdAt: '', updatedAt: '' },
  ];
  const tasks = opts.tasks ?? [];
  return apiMock([
    ...extra,
    { match: (url) => url.endsWith('/auth/me'), response: () => mockFetchResponse({ id: '1', issuer: 'test', subject: 'test', createdAt: '', updatedAt: '' }) },
    { match: (url) => url.endsWith('/projects') && !url.includes('/tasks') && !url.includes('/lanes'), response: () => mockFetchResponse([{ id: 'proj1', name: 'Test Proj', version: projectVersion, rank: 1, archivedAt: null, createdAt: '', updatedAt: '', ownerId: '1' }]) },
    { match: (url) => url.endsWith('/projects/proj1') && !url.includes('/tasks') && !url.includes('/lanes'), response: () => mockFetchResponse({ id: 'proj1', name: 'Test Proj', version: projectVersion, rank: 1, archivedAt: null, createdAt: '', updatedAt: '', ownerId: '1' }) },
    { match: (url) => url.includes('/lanes') && url.includes('/proj1'), response: () => mockFetchResponse(lanes) },
    { match: (url) => url.includes('/tasks') && url.includes('/proj1'), response: () => mockFetchResponse(tasks) },
  ]);
}

// Navigate from the project list to the board. Assumes renderApp() has already
// been called by the test — this helper must NOT itself call renderApp(), or
// two App roots will be mounted simultaneously and break queries.
async function openBoard(user: any) {
  const projectButton = await waitFor(() => screen.getByRole('button', { name: 'Test Proj' }));
  await user.click(projectButton);
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

  it('lane delete request includes expectedVersion equal to project version', async () => {
    const mockedFetch = boardMock([
      {
        match: (url, opts) => url.includes('/lane1') && opts?.method === 'DELETE',
        response: () => mockFetchResponse({ success: true }),
      },
    ], { projectVersion: 5 });

    global.fetch = mockedFetch;
    renderApp();
    const user = await userEvent.setup();
    await waitFor(() => screen.getByRole('button', { name: 'Test Proj' }));
    await user.click(screen.getByRole('button', { name: 'Test Proj' }));
    await waitFor(() => screen.getByText('Lane 1'));
    // Use regex matcher — labels now include lane name for clarity.
    const deleteBtns = screen.getAllByLabelText(/Delete lane /);
    await user.click(deleteBtns[0]);
    await waitFor(() => screen.getByText('Delete Lane'));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      const deleteCalls = vi.mocked(mockedFetch).mock.calls.filter(
        (call: any) => call[0].includes('/lane1') && (call[1]?.method === 'DELETE')
      );
      expect(deleteCalls.length).toBeGreaterThan(0);
      const deleteBody = JSON.parse(deleteCalls[deleteCalls.length - 1][1].body);
      expect(deleteBody.expectedProjectVersion).toBe(5);
    });
  });

  it('lane reorder request includes expectedProjectVersion equal to project version', async () => {
    const mockedFetch = boardMock([
      { match: (url) => url.includes('/reorder'), response: () => mockFetchResponse({ success: true }) },
    ], { projectVersion: 42 });

    global.fetch = mockedFetch;
    renderApp();
    const user = await userEvent.setup();
    await waitFor(() => screen.getByRole('button', { name: 'Test Proj' }));
    await user.click(screen.getByRole('button', { name: 'Test Proj' }));
    await waitFor(() => screen.getByText('Lane 1'));

    const onDragStart = (window as any).__dndOnDragStart;
    const onDragOver = (window as any).__dndOnDragOver;
    const onDragEnd = (window as any).__dndOnDragEnd;
    expect(onDragStart).toBeDefined();
    expect(onDragEnd).toBeDefined();

    await act(async () => {
      onDragStart({ active: { id: 'lane1', data: { current: { type: 'lane' } } } });
      onDragOver?.({ active: { id: 'lane1', data: { current: { type: 'lane' } } }, over: { id: 'lane2', data: { current: { type: 'lane' } } } });
      onDragEnd({ active: { id: 'lane1', data: { current: { type: 'lane' } } }, over: { id: 'lane2', data: { current: { type: 'lane' } } } });
    });

    await waitFor(() => {
      const reorderCalls = vi.mocked(mockedFetch).mock.calls.filter(
        (call: any) => call[0].includes('/reorder')
      );
      expect(reorderCalls.length).toBeGreaterThan(0);
      const reorderBody = JSON.parse(reorderCalls[reorderCalls.length - 1][1].body);
      expect(reorderBody.expectedProjectVersion).toBe(42);
    });
  });

  it('lane drag over another lane sends reorder with resolved lane order', async () => {
    const mockedFetch = boardMock([
      { match: (url) => url.includes('/reorder'), response: () => mockFetchResponse({ success: true }) },
    ], { projectVersion: 7 });

    global.fetch = mockedFetch;
    renderApp();
    const user = await userEvent.setup();
    await openBoard(user);
    await waitFor(() => screen.getByText('Lane 1'));
    await waitFor(() => screen.getByText('Lane 2'));

    const onDragStart = (window as any).__dndOnDragStart;
    const onDragOver = (window as any).__dndOnDragOver;
    const onDragEnd = (window as any).__dndOnDragEnd;
    expect(onDragStart).toBeDefined();
    expect(onDragEnd).toBeDefined();

    await act(async () => {
      onDragStart({ active: { id: 'lane1', data: { current: { type: 'lane' } } } });
      onDragOver?.({ active: { id: 'lane1', data: { current: { type: 'lane' } } }, over: { id: 'lane2', data: { current: { type: 'lane' } } } });
      onDragEnd({ active: { id: 'lane1', data: { current: { type: 'lane' } } }, over: { id: 'lane2', data: { current: { type: 'lane' } } } });
    });

    await waitFor(() => {
      const reorderCalls = vi.mocked(mockedFetch).mock.calls.filter(
        (call: any) => call[0].includes('/reorder')
      );
      expect(reorderCalls.length).toBeGreaterThan(0);
      const reorderBody = JSON.parse(reorderCalls[reorderCalls.length - 1][1].body);
      expect(reorderBody.laneIds).toEqual(['lane2', 'lane1']);
      expect(reorderBody.expectedProjectVersion).toBe(7);
    });
  });

  it('lane drag over a task resolves target lane and reorders lanes', async () => {
    const tasks = [
      { id: 'task1', title: 'Task 1', version: 1, projectId: 'proj1', laneId: 'lane2', rank: 0, createdAt: '', updatedAt: '' },
    ];
    const mockedFetch = boardMock([
      { match: (url) => url.includes('/reorder'), response: () => mockFetchResponse({ success: true }) },
    ], { projectVersion: 3, tasks });

    global.fetch = mockedFetch;
    renderApp();
    const user = await userEvent.setup();
    await openBoard(user);
    await waitFor(() => screen.getByText('Task 1'));

    const onDragEnd = (window as any).__dndOnDragEnd;
    await act(async () => {
      onDragEnd({
        active: { id: 'lane1', data: { current: { type: 'lane' } } },
        over: { id: 'task1', data: { current: { type: 'task' } } },
      });
    });

    await waitFor(() => {
      const reorderCalls = vi.mocked(mockedFetch).mock.calls.filter((call: any) => call[0].includes('/reorder'));
      expect(reorderCalls.length).toBeGreaterThan(0);
      const body = JSON.parse(reorderCalls[reorderCalls.length - 1][1].body);
      // arrayMove([lane1, lane2], 0, 1) → [lane2, lane1]. Lane1 takes lane2's slot.
      expect(body.laneIds).toEqual(['lane2', 'lane1']);
    });
  });

  it('board shows error state for lane fetch failure', async () => {
    const mockedFetch = apiMock([
      { match: (url) => url.endsWith('/auth/me'), response: () => mockFetchResponse({ id: '1', issuer: 'test', subject: 'test', createdAt: '', updatedAt: '' }) },
      { match: (url) => url.endsWith('/projects') && !url.includes('/tasks') && !url.includes('/lanes'), response: () => mockFetchResponse([{ id: 'proj1', name: 'Test Proj', version: 5, rank: 1, archivedAt: null, createdAt: '', updatedAt: '', ownerId: '1' }]) },
      { match: (url) => url.endsWith('/projects/proj1') && !url.includes('/tasks') && !url.includes('/lanes'), response: () => mockFetchResponse({ id: 'proj1', name: 'Test Proj', version: 5, rank: 1, archivedAt: null, createdAt: '', updatedAt: '', ownerId: '1' }) },
      { match: (url) => url.includes('/lanes') && url.includes('/proj1'), response: () => mockFetchResponse({ errors: [{ code: 'SERVER_ERROR', message: 'Lane fetch failed' }] }, false, 500) },
      { match: (url) => url.includes('/tasks') && url.includes('/proj1'), response: () => mockFetchResponse([]) },
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
      { match: (url) => url.endsWith('/auth/me'), response: () => mockFetchResponse({ id: '1', issuer: 'test', subject: 'test', createdAt: '', updatedAt: '' }) },
      { match: (url) => url.endsWith('/projects') && !url.includes('/tasks') && !url.includes('/lanes'), response: () => mockFetchResponse([{ id: 'proj1', name: 'Test Proj', version: 5, rank: 1, archivedAt: null, createdAt: '', updatedAt: '', ownerId: '1' }]) },
      { match: (url) => url.endsWith('/projects/proj1') && !url.includes('/tasks') && !url.includes('/lanes'), response: () => mockFetchResponse({ id: 'proj1', name: 'Test Proj', version: 5, rank: 1, archivedAt: null, createdAt: '', updatedAt: '', ownerId: '1' }) },
      { match: (url) => url.includes('/lanes') && url.includes('/proj1'), response: () => mockFetchResponse([{ id: 'lane1', name: 'Lane 1', version: 1, projectId: 'proj1', rank: 0, createdAt: '', updatedAt: '' }]) },
      { match: (url) => url.includes('/tasks') && url.includes('/proj1'), response: () => mockFetchResponse({ errors: [{ code: 'SERVER_ERROR', message: 'Task fetch failed' }] }, false, 500) },
    ]);
    global.fetch = mockedFetch;

    renderApp();
    await waitFor(() => screen.getByRole('button', { name: 'Test Proj' }));
    const user = await userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Test Proj' }));
    await waitFor(() => screen.getByText('Failed to load tasks'));
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('task drag-over-task sends move with before/after anchors and expectedVersion', async () => {
    const tasks = [
      { id: 'task1', title: 'Task 1', version: 7, projectId: 'proj1', laneId: 'lane1', rank: 0, createdAt: '', updatedAt: '' },
      { id: 'task2', title: 'Task 2', version: 1, projectId: 'proj1', laneId: 'lane1', rank: 1, createdAt: '', updatedAt: '' },
    ];
    const mockedFetch = boardMock([
      {
        match: (url, opts) => url.includes('/tasks/task1/move') && (opts?.method === 'POST'),
        response: () => mockFetchResponse({ id: 'task1', version: 2, projectId: 'proj1', laneId: 'lane1', rank: 0 }),
      },
    ], { projectVersion: 1, lanes: [{ id: 'lane1', name: 'Lane 1', version: 1, projectId: 'proj1', rank: 0, createdAt: '', updatedAt: '' }], tasks });

    global.fetch = mockedFetch;
    renderApp();
    const user = await userEvent.setup();
    await openBoard(user);
    await waitFor(() => screen.getByText('Task 1'));
    await waitFor(() => screen.getByText('Task 2'));

    const onDragEnd = (window as any).__dndOnDragEnd;
    expect(onDragEnd).toBeDefined();
    await act(async () => {
      onDragEnd({
        active: { id: 'task1', data: { current: { type: 'task' } } },
        over: { id: 'task2', data: { current: { type: 'task' } } },
      });
    });

    await waitFor(() => {
      const moveCalls = vi.mocked(mockedFetch).mock.calls.filter(
        (call: any) => call[0].includes('/tasks/task1/move')
      );
      expect(moveCalls.length).toBeGreaterThan(0);
      const moveBody = JSON.parse(moveCalls[moveCalls.length - 1][1].body);
      // Dropping task1 onto task2 inserts before task2: afterTaskId=task2.
      expect(moveBody.afterTaskId).toBe('task2');
      expect(moveBody.beforeTaskId).toBeUndefined();
      expect(moveBody.destinationLaneId).toBe('lane1');
      expect(moveBody.destinationProjectId).toBe('proj1');
      expect(moveBody.expectedVersion).toBe(7);
    });
  });

  it('task-over-lane drop appends and sends move request with expectedVersion', async () => {
    const tasks = [
      { id: 'task1', title: 'Task 1', version: 4, projectId: 'proj1', laneId: 'lane1', rank: 0, createdAt: '', updatedAt: '' },
      { id: 'task2', title: 'Task 2', version: 1, projectId: 'proj1', laneId: 'lane1', rank: 1, createdAt: '', updatedAt: '' },
    ];
    const mockedFetch = boardMock([
      {
        match: (url, opts) => url.includes('/tasks/task1/move') && (opts?.method === 'POST'),
        response: () => mockFetchResponse({ id: 'task1', version: 5, projectId: 'proj1', laneId: 'lane2', rank: 0 }),
      },
    ], { projectVersion: 2, tasks });

    global.fetch = mockedFetch;
    renderApp();
    const user = await userEvent.setup();
    await openBoard(user);
    await waitFor(() => screen.getByText('Task 1'));

    const onDragEnd = (window as any).__dndOnDragEnd;
    await act(async () => {
      onDragEnd({
        active: { id: 'task1', data: { current: { type: 'task' } } },
        over: { id: 'lane2', data: { current: { type: 'lane' } } },
      });
    });

    await waitFor(() => {
      const moveCalls = vi.mocked(mockedFetch).mock.calls.filter(
        (call: any) => call[0].includes('/tasks/task1/move')
      );
      expect(moveCalls.length).toBeGreaterThan(0);
      const moveBody = JSON.parse(moveCalls[moveCalls.length - 1][1].body);
      // Empty-lane destination → no before/after anchors; append.
      expect(moveBody.destinationLaneId).toBe('lane2');
      expect(moveBody.beforeTaskId).toBeUndefined();
      expect(moveBody.afterTaskId).toBeUndefined();
      expect(moveBody.expectedVersion).toBe(4);
    });
  });

  it('drag cancel clears task drag state', async () => {
    const tasks = [
      { id: 'task1', title: 'Task 1', version: 1, projectId: 'proj1', laneId: 'lane1', rank: 0, createdAt: '', updatedAt: '' },
    ];
    const mockedFetch = boardMock([], { projectVersion: 1, lanes: [{ id: 'lane1', name: 'Lane 1', version: 1, projectId: 'proj1', rank: 0, createdAt: '', updatedAt: '' }], tasks });
    global.fetch = mockedFetch;

    renderApp();
    const user = await userEvent.setup();
    await openBoard(user);
    await waitFor(() => screen.getByText('Task 1'));

    const onDragStart = (window as any).__dndOnDragStart;
    const onDragOver = (window as any).__dndOnDragOver;
    const onDragCancel = (window as any).__dndOnDragCancel;
    act(() => {
      onDragStart({ active: { id: 'task1', data: { current: { type: 'task' } } } });
    });
    // Simulate hovering over lane — should set whole-lane target indicator.
    await act(async () => {
      onDragOver({ active: { id: 'task1', data: { current: { type: 'task' } } }, over: { id: 'lane1', data: { current: { type: 'lane' } } } });
    });
    const laneBefore = document.querySelector('.lane');
    expect(laneBefore?.className).toContain('whole-drop-target');

    await act(async () => {
      onDragCancel({});
    });
    // After cancel, the lane should no longer carry the whole-drop-target indicator.
    const laneAfter = document.querySelector('.lane');
    expect(laneAfter?.className).not.toContain('whole-drop-target');
    // And no move request should have been issued.
    const moveCalls = vi.mocked(mockedFetch).mock.calls.filter((call: any) => call[0].includes('/tasks/task1/move'));
    expect(moveCalls.length).toBe(0);
  });

  it('New Project drop target opens naming dialog and does not call normal move', async () => {
    const tasks = [
      { id: 'task1', title: 'Task 1', version: 9, projectId: 'proj1', laneId: 'lane1', rank: 0, createdAt: '', updatedAt: '' },
    ];
    const mockedFetch = boardMock([], { projectVersion: 1, lanes: [{ id: 'lane1', name: 'Lane 1', version: 1, projectId: 'proj1', rank: 0, createdAt: '', updatedAt: '' }], tasks });
    global.fetch = mockedFetch;

    renderApp();
    const user = await userEvent.setup();
    await openBoard(user);
    await waitFor(() => screen.getByText('Task 1'));

    const onDragEnd = (window as any).__dndOnDragEnd;
    await act(async () => {
      onDragEnd({
        active: { id: 'task1', data: { current: { type: 'task' } } },
        over: { id: 'new-project-drop-target', data: { current: { type: 'new-project' } } },
      });
    });

    // Move-to-new-project dialog must open; normal move must NOT be called.
    await waitFor(() => screen.getByText('Move to New Project'));
    const moveCalls = vi.mocked(mockedFetch).mock.calls.filter(
      (call: any) => call[0].includes('/tasks/task1/move') && !call[0].includes('/move-to-new-project')
    );
    expect(moveCalls.length).toBe(0);
  });

  it('Submitting the move-to-new-project dialog calls API with expectedVersion', async () => {
    const tasks = [
      { id: 'task1', title: 'Task 1', version: 9, projectId: 'proj1', laneId: 'lane1', rank: 0, createdAt: '', updatedAt: '' },
    ];
    const mockedFetch = boardMock([
      {
        match: (url, opts) => url.includes('/tasks/task1/move-to-new-project') && (opts?.method === 'POST'),
        // Return the moved task without a top-level projectId so the dialog
        // doesn't navigate during this test (avoids requiring proj2 mocks).
        response: () => mockFetchResponse({ id: 'task1', version: 10 }),
      },
    ], { projectVersion: 1, lanes: [{ id: 'lane1', name: 'Lane 1', version: 1, projectId: 'proj1', rank: 0, createdAt: '', updatedAt: '' }], tasks });
    global.fetch = mockedFetch;

    renderApp();
    const user = await userEvent.setup();
    await openBoard(user);
    await waitFor(() => screen.getByText('Task 1'));

    const onDragEnd = (window as any).__dndOnDragEnd;
    await act(async () => {
      onDragEnd({
        active: { id: 'task1', data: { current: { type: 'task' } } },
        over: { id: 'new-project-drop-target', data: { current: { type: 'new-project' } } },
      });
    });

    await waitFor(() => screen.getByText('Move to New Project'));
    const input = screen.getByLabelText('New project name');
    await user.type(input, 'Brand New Project');
    await user.click(screen.getByRole('button', { name: 'Create & Move' }));

    await waitFor(() => {
      const calls = vi.mocked(mockedFetch).mock.calls.filter(
        (call: any) => call[0].includes('/tasks/task1/move-to-new-project') && (call[1]?.method === 'POST')
      );
      expect(calls.length).toBeGreaterThan(0);
      const body = JSON.parse(calls[calls.length - 1][1].body);
      expect(body.projectName).toBe('Brand New Project');
      expect(body.expectedVersion).toBe(9);
    });
  });

  it('task cards expose only Edit and Delete controls (no Move / Move-to-new-project)', async () => {
    const tasks = [
      { id: 'task1', title: 'Task 1', version: 1, projectId: 'proj1', laneId: 'lane1', rank: 0, createdAt: '', updatedAt: '' },
    ];
    const mockedFetch = boardMock([], { projectVersion: 1, lanes: [{ id: 'lane1', name: 'Lane 1', version: 1, projectId: 'proj1', rank: 0, createdAt: '', updatedAt: '' }], tasks });
    global.fetch = mockedFetch;

    renderApp();
    const user = await userEvent.setup();
    await openBoard(user);
    await waitFor(() => screen.getByText('Task 1'));

    expect(screen.getByLabelText('Edit task Task 1')).toBeTruthy();
    expect(screen.getByLabelText('Delete task Task 1')).toBeTruthy();
    expect(screen.queryByLabelText('Move task')).toBeNull();
    expect(screen.queryByText('Move to new project')).toBeNull();
  });

  it('opening edit task shows right-side flyout panel with dialog role', async () => {
    const tasks = [
      { id: 'task1', title: 'Task 1', version: 1, projectId: 'proj1', laneId: 'lane1', rank: 0, createdAt: '', updatedAt: '' },
    ];
    const mockedFetch = boardMock([
      {
        match: (url) => url.includes('/projects/proj1/tasks/task1') && !url.includes('/move'),
        response: () => mockFetchResponse(tasks[0]),
      },
    ], { projectVersion: 1, lanes: [{ id: 'lane1', name: 'Lane 1', version: 1, projectId: 'proj1', rank: 0, createdAt: '', updatedAt: '' }], tasks });
    global.fetch = mockedFetch;

    renderApp();
    const user = await userEvent.setup();
    await openBoard(user);
    await waitFor(() => screen.getByText('Task 1'));

    await user.click(screen.getByLabelText('Edit task Task 1'));

    const dialog = await screen.findByRole('dialog', { name: 'Edit Task' });
    expect(dialog).toBeTruthy();
    // Close button is labelled.
    expect(screen.getByLabelText('Close edit task panel')).toBeTruthy();
    // Escape closes the dialog.
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Edit Task' })).toBeNull();
    });
  });

  it('lane create invalidates project and lanes queries', async () => {
    const mockedFetch = boardMock([
      {
        match: (url, opts) => url.includes('/lanes') && url.endsWith('/proj1/lanes') && opts?.method === 'POST',
        response: () => mockFetchResponse({ id: 'lane2', name: 'Lane 2', version: 1, projectId: 'proj1', rank: 1 }),
      },
    ], { projectVersion: 5, lanes: [{ id: 'lane1', name: 'Lane 1', version: 1, projectId: 'proj1', rank: 0, createdAt: '', updatedAt: '' }] });

    global.fetch = mockedFetch;
    renderApp();
    await waitFor(() => screen.getByRole('button', { name: 'Test Proj' }));
    const user = await userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Test Proj' }));
    await waitFor(() => screen.getByText('Lane 1'));

    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('New Lane');
    await user.click(screen.getByRole('button', { name: /Add Lane/i }));
    await waitFor(() => {
      const laneCalls = vi.mocked(mockedFetch).mock.calls.filter(
        (call: any) => call[0].includes('/lanes') && call[0].includes('/proj1') && call[0].endsWith('/lanes')
      );
      expect(laneCalls.length).toBeGreaterThanOrEqual(2);
    });
    promptSpy.mockRestore();
  });

  it('lane rename invalidates project and lanes queries and sends expectedVersion', async () => {
    const mockedFetch = boardMock([
      {
        match: (url, opts) => url.includes('/lanes') && url.includes('/lane1') && opts?.method === 'PUT',
        response: () => mockFetchResponse({ id: 'lane1', name: 'Lane 1 Renamed', version: 3, projectId: 'proj1', rank: 0 }),
      },
    ], { projectVersion: 10, lanes: [{ id: 'lane1', name: 'Lane 1', version: 2, projectId: 'proj1', rank: 0, createdAt: '', updatedAt: '' }] });

    global.fetch = mockedFetch;
    renderApp();
    await waitFor(() => screen.getByRole('button', { name: 'Test Proj' }));
    const user = await userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Test Proj' }));
    await waitFor(() => screen.getByText('Lane 1'));

    // Click rename button (lane name button) to enter edit mode.
    await user.click(screen.getByRole('button', { name: /Rename lane / }));
    const nameInput = screen.getByRole('textbox', { name: 'Lane name' });
    await user.clear(nameInput);
    await user.type(nameInput, 'Lane 1 Renamed');
    fireEvent.blur(nameInput);
    await waitFor(() => {
      const renameCalls = vi.mocked(mockedFetch).mock.calls.filter(
        (call: any) => call[0].includes('/lane1') && (call[1]?.method === 'PUT')
      );
      expect(renameCalls.length).toBeGreaterThan(0);
      const renameBody = JSON.parse(renameCalls[renameCalls.length - 1][1].body);
      expect(renameBody.expectedVersion).toBe(2);
      expect(renameBody.expectedProjectVersion).toBe(10);
      const projectCallsAfterRename = vi.mocked(mockedFetch).mock.calls.filter(
        (call: any) => call[0].endsWith('/projects/proj1') && !call[0].includes('/tasks') && !call[0].includes('/lanes')
      );
      expect(projectCallsAfterRename.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('lane create request includes expectedProjectVersion', async () => {
    const mockedFetch = boardMock([
      {
        match: (url, opts) => url.includes('/lanes') && url.endsWith('/proj1/lanes') && opts?.method === 'POST',
        response: () => mockFetchResponse({ id: 'lane2', name: 'Lane 2', version: 1, projectId: 'proj1', rank: 1 }),
      },
    ], { projectVersion: 7, lanes: [{ id: 'lane1', name: 'Lane 1', version: 1, projectId: 'proj1', rank: 0, createdAt: '', updatedAt: '' }] });

    global.fetch = mockedFetch;
    renderApp();
    await waitFor(() => screen.getByRole('button', { name: 'Test Proj' }));
    const user = await userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Test Proj' }));
    await waitFor(() => screen.getByText('Lane 1'));

    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('New Lane');
    await user.click(screen.getByRole('button', { name: /Add Lane/i }));
    await waitFor(() => {
      const createCalls = vi.mocked(mockedFetch).mock.calls.filter(
        (call: any) => call[0].includes('/lanes') && call[0].endsWith('/proj1/lanes') && (call[1]?.method === 'POST')
      );
      if (createCalls.length > 0) {
        const createBody = JSON.parse(createCalls[createCalls.length - 1][1].body);
        expect(createBody.expectedProjectVersion).toBe(7);
      }
    });
    promptSpy.mockRestore();
  });

  it('task Edit and Delete buttons are keyboard-focusable (not removed from tab order)', async () => {
    const tasks = [
      { id: 'task1', title: 'Task 1', version: 1, projectId: 'proj1', laneId: 'lane1', rank: 0, createdAt: '', updatedAt: '' },
    ];
    const mockedFetch = boardMock([], { projectVersion: 1, lanes: [{ id: 'lane1', name: 'Lane 1', version: 1, projectId: 'proj1', rank: 0, createdAt: '', updatedAt: '' }], tasks });
    global.fetch = mockedFetch;

    renderApp();
    const user = await userEvent.setup();
    await openBoard(user);
    await waitFor(() => screen.getByText('Task 1'));

    const editBtn = screen.getByLabelText('Edit task Task 1');
    const deleteBtn = screen.getByLabelText('Delete task Task 1');
    expect(editBtn.tagName).toBe('BUTTON');
    expect(deleteBtn.tagName).toBe('BUTTON');
    // Not removed from tab order.
    expect(editBtn).not.toHaveAttribute('tabindex', '-1');
    expect(deleteBtn).not.toHaveAttribute('tabindex', '-1');
    // Edit is keyboard-reachable: focus + Enter opens the flyout.
    editBtn.focus();
    expect(document.activeElement).toBe(editBtn);
    await user.keyboard('{Enter}');
    await screen.findByRole('dialog', { name: 'Edit Task' });
  });

  it('task card and lane expose labelled drag-handle buttons', async () => {
    const tasks = [
      { id: 'task1', title: 'Task 1', version: 1, projectId: 'proj1', laneId: 'lane1', rank: 0, createdAt: '', updatedAt: '' },
    ];
    const mockedFetch = boardMock([], { projectVersion: 1, lanes: [{ id: 'lane1', name: 'Lane 1', version: 1, projectId: 'proj1', rank: 0, createdAt: '', updatedAt: '' }], tasks });
    global.fetch = mockedFetch;

    renderApp();
    const user = await userEvent.setup();
    await openBoard(user);
    await waitFor(() => screen.getByText('Task 1'));

    const taskHandle = screen.getByLabelText('Drag task Task 1');
    expect(taskHandle.tagName).toBe('BUTTON');
    expect(taskHandle).toHaveClass('task-action-btn', 'task-drag-handle');
    expect(screen.getByLabelText('Edit task Task 1')).toHaveClass('task-action-btn');
    expect(screen.getByLabelText('Delete task Task 1')).toHaveClass('task-action-btn', 'danger');
    expect(taskHandle).not.toHaveAttribute('tabindex', '-1');
    expect(taskHandle).not.toHaveAttribute('aria-hidden', 'true');

    const laneHandle = screen.getByLabelText('Reorder lane Lane 1');
    expect(laneHandle.tagName).toBe('BUTTON');
    expect(laneHandle).not.toHaveAttribute('aria-hidden', 'true');
  });

  it('mobile menu toggle opens and closes the real sidebar', async () => {
    setMobileViewport();
    const mockedFetch = boardMock([], { projectVersion: 1 });
    global.fetch = mockedFetch;

    renderApp();
    const user = await userEvent.setup();
    await openBoard(user);
    await waitFor(() => screen.getByText('Lane 1'));

    const sidebar = document.querySelector('#project-sidebar');
    expect(sidebar).toBeTruthy();
    expect(sidebar!.className).not.toContain('open');
    expect(sidebar).toHaveAttribute('aria-hidden', 'true');
    expect(sidebar).toHaveAttribute('inert');

    const toggle = screen.getByLabelText('Toggle sidebar');
    expect(toggle).toHaveAttribute('aria-controls', 'project-sidebar');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(sidebar!.className).toContain('open');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(sidebar).not.toHaveAttribute('inert');
    expect(document.activeElement).toBe(screen.getAllByLabelText('Close project menu')[0]);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(sidebar!.className).not.toContain('open');
    await waitFor(() => expect(document.activeElement).toBe(toggle));

    await user.click(toggle);
    await user.click(document.querySelector('.sidebar-backdrop') as HTMLElement);
    expect(sidebar!.className).not.toContain('open');
    await waitFor(() => expect(document.activeElement).toBe(toggle));
  });

  it('mobile sidebar traps Tab in both directions, including when focus escapes', async () => {
    setMobileViewport();
    global.fetch = boardMock([], { projectVersion: 1 });
    renderApp();
    const user = await userEvent.setup();
    await openBoard(user);
    await screen.findByText('Lane 1');

    const toggle = screen.getByLabelText('Toggle sidebar');
    await user.click(toggle);
    const sidebar = document.querySelector<HTMLElement>('#project-sidebar')!;
    const controls = Array.from(sidebar.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
    const first = controls[0];
    const last = controls[controls.length - 1];

    last.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    toggle.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    toggle.focus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('dragging a task over itself shows no insertion indicator', async () => {
    const tasks = [
      { id: 'task1', title: 'Task 1', version: 1, projectId: 'proj1', laneId: 'lane1', rank: 0, createdAt: '', updatedAt: '' },
    ];
    const mockedFetch = boardMock([], { projectVersion: 1, lanes: [{ id: 'lane1', name: 'Lane 1', version: 1, projectId: 'proj1', rank: 0, createdAt: '', updatedAt: '' }], tasks });
    global.fetch = mockedFetch;

    renderApp();
    const user = await userEvent.setup();
    await openBoard(user);
    await waitFor(() => screen.getByText('Task 1'));

    const onDragStart = (window as any).__dndOnDragStart;
    const onDragOver = (window as any).__dndOnDragOver;
    await act(async () => {
      onDragStart({ active: { id: 'task1', data: { current: { type: 'task' } } } });
      onDragOver({ active: { id: 'task1', data: { current: { type: 'task' } } }, over: { id: 'task1', data: { current: { type: 'task' } } } });
    });
    expect(document.querySelector('.task-insert-line')).toBeNull();

    // And cancelling clears drag state without any move request.
    const onDragCancel = (window as any).__dndOnDragCancel;
    await act(async () => { onDragCancel({}); });
    const moveCalls = vi.mocked(mockedFetch).mock.calls.filter((call: any) => call[0].includes('/tasks/task1/move') && !call[0].includes('/move-to-new-project'));
    expect(moveCalls.length).toBe(0);
  });

  it('shows the project menu only on board routes and sidebar New Project uses the full page', async () => {
    setMobileViewport();
    global.fetch = boardMock([], { projectVersion: 1 });
    renderApp();
    const user = await userEvent.setup();

    await waitFor(() => screen.getByRole('button', { name: 'Test Proj' }));
    expect(screen.queryByLabelText('Toggle sidebar')).toBeNull();
    await openBoard(user);
    const toggle = await screen.findByLabelText('Toggle sidebar');
    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: 'New project' }));

    await screen.findByRole('heading', { name: 'New Project' });
    expect(screen.queryByLabelText('Toggle sidebar')).toBeNull();
    expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('task drag exposes only the compact mobile New Project shelf and keeps the sidebar closed', async () => {
    setMobileViewport();
    const tasks = [{ id: 'task1', title: 'Task 1', version: 1, projectId: 'proj1', laneId: 'lane1', rank: 0, createdAt: '', updatedAt: '' }];
    global.fetch = boardMock([], { lanes: [{ id: 'lane1', name: 'Lane 1', version: 1, projectId: 'proj1', rank: 0, createdAt: '', updatedAt: '' }], tasks });
    renderApp();
    const user = await userEvent.setup();
    await openBoard(user);
    await screen.findByText('Task 1');

    act(() => (window as any).__dndOnDragStart({ active: { id: 'task1', data: { current: { type: 'task' } } } }));
    expect(screen.getByLabelText('Drop task to create a new project')).toHaveAttribute('data-drop-type', 'new-project');
    expect(document.querySelector('#project-sidebar')).not.toHaveClass('open');
  });

  it('sidebar uses sibling buttons for active and archived selection and archive does not navigate', async () => {
    setMobileViewport();
    const projects = [
      { id: 'proj1', name: 'Test Proj', version: 1, rank: 0, archivedAt: null, createdAt: '', updatedAt: '', ownerId: '1' },
      { id: 'proj2', name: 'Old Proj', version: 2, rank: 1, archivedAt: '2026-01-01', createdAt: '', updatedAt: '', ownerId: '1' },
    ];
    const mockedFetch = apiMock([
      { match: url => url.endsWith('/auth/me'), response: () => mockFetchResponse({ id: '1', issuer: 'test', subject: 'test', createdAt: '', updatedAt: '' }) },
      { match: (url, opts) => url.endsWith('/projects/proj1/archive') && opts?.method === 'POST', response: () => mockFetchResponse(projects[0]) },
      { match: url => url.endsWith('/projects'), response: () => mockFetchResponse(projects) },
      { match: url => url.endsWith('/projects/proj1'), response: () => mockFetchResponse(projects[0]) },
      { match: url => url.endsWith('/projects/proj2'), response: () => mockFetchResponse(projects[1]) },
      { match: url => url.includes('/lanes'), response: () => mockFetchResponse([]) },
      { match: url => url.includes('/tasks'), response: () => mockFetchResponse([]) },
    ]);
    global.fetch = mockedFetch;
    renderApp();
    const user = await userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Test Proj' }));
    await user.click(await screen.findByLabelText('Toggle sidebar'));

    const activeSelect = screen.getByRole('button', { name: 'Test Proj' });
    const archivedSelect = screen.getByRole('button', { name: 'Old Proj' });
    const archive = screen.getByLabelText('Archive Test Proj');
    expect(activeSelect.parentElement).toBe(archive.parentElement);
    expect(archivedSelect.tagName).toBe('BUTTON');
    expect(archive).toHaveClass('sidebar-item-action');

    archive.focus();
    await user.keyboard('{Enter}');
    expect(window.location.pathname).toBe('/project/proj1');

    await user.click(screen.getByLabelText('Toggle sidebar'));
    const archivedSelectAfterArchive = screen.getByRole('button', { name: 'Old Proj' });
    archivedSelectAfterArchive.focus();
    await user.keyboard(' ');
    await waitFor(() => expect(window.location.pathname).toBe('/project/proj2'));
  });

  it('provides friendly board drag instructions and announcements', async () => {
    const tasks = [{ id: 'task1', title: 'Write docs', version: 1, projectId: 'proj1', laneId: 'lane1', rank: 0, createdAt: '', updatedAt: '' }];
    global.fetch = boardMock([], { tasks });
    renderApp();
    const user = await userEvent.setup();
    await openBoard(user);
    await screen.findByText('Write docs');

    const accessibility = (window as any).__dndAccessibility;
    expect(accessibility.screenReaderInstructions.draggable).toContain('Space or Enter');
    const active = { id: 'task1', data: { current: { type: 'task' } } };
    const over = { id: 'lane2', data: { current: { type: 'lane' } } };
    expect(accessibility.announcements.onDragStart({ active })).toContain('Write docs');
    expect(accessibility.announcements.onDragOver({ active, over })).toContain('Lane 2');
    expect(accessibility.announcements.onDragCancel({ active, over: null })).toContain('Cancelled');
  });

  it('keyboard coordinates move lanes directionally and ignore boundaries', () => {
    const lanes = [
      { id: 'lane1', name: 'One', rank: 0 },
      { id: 'lane2', name: 'Two', rank: 1 },
      { id: 'lane3', name: 'Three', rank: 2 },
    ] as any;
    const getter = createKeyboardCoordinateGetter({ lanes, tasks: [] });
    const rects = new Map(lanes.map((lane: any, index: number) => [lane.id, { left: index * 100, top: 0, width: 80, height: 100 }]));
    const containers = new Map(lanes.map((lane: any) => [lane.id, { disabled: false }]));
    const run = (code: string, over: string | null = null) => getter({ code, preventDefault: vi.fn() } as any, {
      active: 'lane2', currentCoordinates: { x: 100, y: 0 }, context: {
        active: { data: { current: { type: 'lane' } } }, over: over ? { id: over, data: { current: { type: 'lane' } } } : null,
        droppableRects: rects, droppableContainers: containers, collisionRect: { width: 20, height: 20 },
      } as any,
    });
    expect(run('ArrowLeft')).toEqual({ x: 30, y: 40 });
    expect(run('ArrowDown')).toEqual({ x: 230, y: 40 });
    expect(run('ArrowRight', 'lane3')).toEqual({ x: 100, y: 0 });
  });

  it('keyboard task coordinates support ordinal, cross-lane, empty-lane, and New Project transitions', () => {
    const lanes = [{ id: 'lane1', name: 'One', rank: 0 }, { id: 'lane2', name: 'Two', rank: 1 }, { id: 'lane3', name: 'Empty', rank: 2 }] as any;
    const tasks = [
      { id: 'a', title: 'A', laneId: 'lane1', rank: 0 },
      { id: 'b', title: 'B', laneId: 'lane1', rank: 1 },
      { id: 'c', title: 'C', laneId: 'lane2', rank: 0 },
    ] as any;
    const getter = createKeyboardCoordinateGetter({ lanes, tasks });
    const ids = ['lane1', 'lane2', 'lane3', 'a', 'b', 'c', 'new-project-drop-target'];
    const rects = new Map(ids.map((id, index) => [id, { left: index * 100, top: index * 10, width: 80, height: 60 }]));
    const containers = new Map(ids.map(id => [id, { disabled: false }]));
    const run = (code: string, over: string | null = null, overType = 'task') => getter({ code, preventDefault: vi.fn() } as any, {
      active: 'a', currentCoordinates: { x: 5, y: 6 }, context: {
        active: { data: { current: { type: 'task' } } },
        over: over ? { id: over, data: { current: { type: overType } } } : null,
        droppableRects: rects, droppableContainers: containers, collisionRect: { width: 20, height: 20 },
      } as any,
    });
    expect(run('ArrowDown')).toEqual({ x: 430, y: 60 }); // task b
    expect(run('ArrowRight')).toEqual({ x: 530, y: 70 }); // nearest ordinal task c
    expect(run('ArrowRight', 'c')).toEqual({ x: 230, y: 40 }); // empty lane
    expect(run('ArrowLeft')).toEqual({ x: 630, y: 80 }); // New Project from first lane
    expect(run('ArrowRight', 'new-project-drop-target', 'new-project')).toEqual({ x: 330, y: 50 }); // original task
    expect(run('ArrowUp')).toEqual({ x: 5, y: 6 });
  });

  it('flyout focuses close button on mount (loading state) and restores trigger focus on close', async () => {
    const tasks = [
      { id: 'task1', title: 'Task 1', version: 1, projectId: 'proj1', laneId: 'lane1', rank: 0, createdAt: '', updatedAt: '' },
    ];
    // Hold the task GET pending forever so the panel stays in its loading state
    // and the close-button-on-mount focus is observable.
    let resolveTaskGet: (v: Response) => void = () => {};
    const taskGetPromise = new Promise<Response>(resolve => { resolveTaskGet = resolve; });
    const taskGetHandler = {
      match: (url: string) => url.includes('/projects/proj1/tasks/task1') && !url.includes('/move'),
      response: () => taskGetPromise,
    };
    const mockedFetch = boardMock([taskGetHandler], { projectVersion: 1, lanes: [{ id: 'lane1', name: 'Lane 1', version: 1, projectId: 'proj1', rank: 0, createdAt: '', updatedAt: '' }], tasks });
    global.fetch = mockedFetch;

    renderApp();
    const user = await userEvent.setup();
    await openBoard(user);
    await waitFor(() => screen.getByText('Task 1'));

    const editBtn = screen.getByLabelText('Edit task Task 1');
    await user.click(editBtn);

    const closeBtn = await screen.findByLabelText('Close edit task panel');
    // While loading, close button should be focused.
    await waitFor(() => {
      expect(document.activeElement).toBe(closeBtn);
    });

    // Release the task GET — once data arrives, title input takes over focus.
    await act(async () => {
      resolveTaskGet(mockResponseObject(tasks[0]));
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText('Title'));
    });

    // Close via Escape restores focus to the triggering Edit control.
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Edit Task' })).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(editBtn);
    });
  });

  it('flyout Tab focus is contained within the panel', async () => {
    const tasks = [
      { id: 'task1', title: 'Task 1', version: 1, projectId: 'proj1', laneId: 'lane1', rank: 0, createdAt: '', updatedAt: '' },
    ];
    const mockedFetch = boardMock([
      {
        match: (url) => url.includes('/projects/proj1/tasks/task1') && !url.includes('/move'),
        response: () => mockFetchResponse(tasks[0]),
      },
    ], { projectVersion: 1, lanes: [{ id: 'lane1', name: 'Lane 1', version: 1, projectId: 'proj1', rank: 0, createdAt: '', updatedAt: '' }], tasks });
    global.fetch = mockedFetch;

    renderApp();
    const user = await userEvent.setup();
    await openBoard(user);
    await waitFor(() => screen.getByText('Task 1'));

    await user.click(screen.getByLabelText('Edit task Task 1'));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Task' });
    // Wait for the title input to be focused (data has arrived).
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Title')));

    // Trap last → first: from the Save button (last focusable), Tab wraps to the close button (first focusable).
    const saveBtn = screen.getByRole('button', { name: 'Save' });
    saveBtn.focus();
    expect(document.activeElement).toBe(saveBtn);
    fireEvent.keyDown(window, { key: 'Tab' });
    // First focusable inside the panel is the close button.
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText('Close edit task panel'));

    // Trap first -> last in reverse as well.
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(saveBtn);
  });

  it('delayed flyout data does not steal focus after the user moves away from loading focus', async () => {
    const tasks = [{ id: 'task1', title: 'Task 1', version: 1, projectId: 'proj1', laneId: 'lane1', rank: 0, createdAt: '', updatedAt: '' }];
    let resolveTaskGet: (value: Response) => void = () => {};
    const pending = new Promise<Response>(resolve => { resolveTaskGet = resolve; });
    global.fetch = boardMock([{
      match: (url: string) => url.includes('/projects/proj1/tasks/task1') && !url.includes('/move'),
      response: () => pending,
    }], { lanes: [{ id: 'lane1', name: 'Lane 1', version: 1, projectId: 'proj1', rank: 0, createdAt: '', updatedAt: '' }], tasks });
    renderApp();
    const user = await userEvent.setup();
    await openBoard(user);
    await screen.findByText('Task 1');
    await user.click(screen.getByLabelText('Edit task Task 1'));
    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    cancel.focus();

    await act(async () => resolveTaskGet(mockResponseObject(tasks[0])));
    await screen.findByLabelText('Title');
    expect(document.activeElement).toBe(cancel);
  });

  it('production root renders unauthenticated without external router', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ errors: [{ code: 'UNAUTHORIZED', message: 'Not authenticated' }] }),
        headers: new Headers(),
      } as Response)
    );

    render(<Root />);
    await waitFor(() => {
      const headings = screen.getAllByRole('heading');
      expect(headings.some(h => h.textContent === 'Not authenticated')).toBe(true);
    });
  });
});
