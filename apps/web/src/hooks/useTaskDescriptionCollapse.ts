import { useCallback, useLayoutEffect, useRef, useState } from 'react';

const STORAGE_PREFIX = 'taskmaster:task-description-collapse:v1:';

type StoredCollapseState = {
  version: 1;
  collapsed: boolean;
  laneId: string;
};

function readStoredState(taskId: string): StoredCollapseState | null {
  try {
    const value = localStorage.getItem(`${STORAGE_PREFIX}${taskId}`);
    if (!value) return null;
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === 'object' && parsed !== null &&
      (parsed as StoredCollapseState).version === 1 &&
      typeof (parsed as StoredCollapseState).collapsed === 'boolean' &&
      typeof (parsed as StoredCollapseState).laneId === 'string'
    ) {
      return parsed as StoredCollapseState;
    }
  } catch {
    // Storage can be disabled or contain data written by an older client.
  }
  return null;
}

function writeStoredState(taskId: string, collapsed: boolean, laneId: string) {
  try {
    const value: StoredCollapseState = { version: 1, collapsed, laneId };
    localStorage.setItem(`${STORAGE_PREFIX}${taskId}`, JSON.stringify(value));
  } catch {
    // A storage failure must not prevent the in-memory control from working.
  }
}

export function useTaskDescriptionCollapse(taskId: string, laneId: string, autoCollapse: boolean) {
  const [collapsed, setCollapsed] = useState(() => {
    const stored = readStoredState(taskId);
    if (!stored) return autoCollapse;
    return stored.laneId !== laneId && autoCollapse ? true : stored.collapsed;
  });
  const previousContext = useRef({ laneId, autoCollapse });
  const laneChanged = previousContext.current.laneId !== laneId;
  const autoCollapseEnabled = !laneChanged && !previousContext.current.autoCollapse && autoCollapse;
  const mustCollapse = (laneChanged && autoCollapse) || autoCollapseEnabled;
  const renderedCollapsed = mustCollapse ? true : collapsed;

  useLayoutEffect(() => {
    previousContext.current = { laneId, autoCollapse };
    if (mustCollapse && !collapsed) {
      setCollapsed(true);
      return;
    }
    writeStoredState(taskId, collapsed, laneId);
  }, [autoCollapse, collapsed, laneId, mustCollapse, taskId]);

  const toggle = useCallback(() => {
    setCollapsed(current => !current);
  }, []);

  return { collapsed: renderedCollapsed, toggle };
}

export const taskDescriptionCollapseStorageKey = (taskId: string) => `${STORAGE_PREFIX}${taskId}`;
