import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { taskDescriptionCollapseStorageKey, useTaskDescriptionCollapse } from './useTaskDescriptionCollapse';

describe('useTaskDescriptionCollapse', () => {
  beforeEach(() => localStorage.clear());

  it('starts expanded in a normal lane and collapsed in an auto-collapse lane', () => {
    const normal = renderHook(() => useTaskDescriptionCollapse('normal-task', 'lane-1', false));
    const automatic = renderHook(() => useTaskDescriptionCollapse('auto-task', 'lane-2', true));

    expect(normal.result.current.collapsed).toBe(false);
    expect(automatic.result.current.collapsed).toBe(true);
  });

  it('persists a manual toggle across remounts', () => {
    const first = renderHook(() => useTaskDescriptionCollapse('task-1', 'lane-1', false));
    act(() => first.result.current.toggle());
    expect(first.result.current.collapsed).toBe(true);
    first.unmount();

    const second = renderHook(() => useTaskDescriptionCollapse('task-1', 'lane-1', false));
    expect(second.result.current.collapsed).toBe(true);
  });

  it('falls back safely when stored state is malformed', () => {
    localStorage.setItem(taskDescriptionCollapseStorageKey('task-1'), '{not json');
    const { result } = renderHook(() => useTaskDescriptionCollapse('task-1', 'lane-1', true));
    expect(result.current.collapsed).toBe(true);
  });

  it('collapses when moved into an auto-collapse lane', () => {
    const { result, rerender } = renderHook(
      ({ laneId, autoCollapse }) => useTaskDescriptionCollapse('task-1', laneId, autoCollapse),
      { initialProps: { laneId: 'normal', autoCollapse: false } },
    );
    expect(result.current.collapsed).toBe(false);
    rerender({ laneId: 'complete', autoCollapse: true });
    expect(result.current.collapsed).toBe(true);
  });

  it('preserves the manual choice when moved into a normal lane', () => {
    const { result, rerender } = renderHook(
      ({ laneId }) => useTaskDescriptionCollapse('task-1', laneId, false),
      { initialProps: { laneId: 'lane-1' } },
    );
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);
    rerender({ laneId: 'lane-2' });
    expect(result.current.collapsed).toBe(true);
  });

  it('collapses when auto-collapse is enabled in the same lane', () => {
    const { result, rerender } = renderHook(
      ({ autoCollapse }) => useTaskDescriptionCollapse('task-1', 'lane-1', autoCollapse),
      { initialProps: { autoCollapse: false } },
    );
    rerender({ autoCollapse: true });
    expect(result.current.collapsed).toBe(true);
  });

  it('does not expand when auto-collapse is disabled', () => {
    const { result, rerender } = renderHook(
      ({ autoCollapse }) => useTaskDescriptionCollapse('task-1', 'lane-1', autoCollapse),
      { initialProps: { autoCollapse: true } },
    );
    expect(result.current.collapsed).toBe(true);
    rerender({ autoCollapse: false });
    expect(result.current.collapsed).toBe(true);
  });

  it('preserves an expansion made at the earliest interactable point after auto-collapse is enabled', () => {
    function CollapseControl({ autoCollapse }: { autoCollapse: boolean }) {
      const state = useTaskDescriptionCollapse('task-1', 'lane-1', autoCollapse);
      return <button onClick={state.toggle}>{state.collapsed ? 'Expand' : 'Collapse'}</button>;
    }

    const view = render(<CollapseControl autoCollapse={false} />);
    view.rerender(<CollapseControl autoCollapse />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));

    expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(taskDescriptionCollapseStorageKey('task-1'))!)).toEqual({
      version: 1,
      collapsed: false,
      laneId: 'lane-1',
    });
  });
});
