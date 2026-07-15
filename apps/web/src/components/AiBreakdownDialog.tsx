import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { triggerToast } from '../App';

export default function AiBreakdownDialog({ laneId, projectId, onClose }: {
  laneId: string;
  projectId: string;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [context, setContext] = useState('');
  const [cards, setCards] = useState<{ title: string; description?: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [creatingIds, setCreatingIds] = useState<Set<number>>(new Set());
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

  const handleCreateAllCards = async () => {
    if (creatingIds.size > 0) return;
    const allIndices = cards.map((_, i) => i);
    setCreatingIds(new Set(allIndices));
    const results = await Promise.allSettled(
      cards.map((card, i) => createMut.mutateAsync({ title: card.title, description: card.description }).then(() => ({ idx: i, ok: true })).catch((e) => ({ idx: i, ok: false, error: e })))
    );
    const successes = results.filter(r => r.status === 'fulfilled' || (r as any).value?.ok === true);
    const failures = results.filter(r => r.status === 'rejected' || (r as any).value?.ok === false);
    if (successes.length > 0) {
      queryClient.invalidateQueries({ queryKey: ['tasks', projectId] });
    }
    if (failures.length > 0) {
      triggerToast(`${failures.length} task(s) failed to create`, 'danger');
    }
    if (successes.length === cards.length) {
      triggerToast('All tasks created', 'success');
    }
    setCreatingIds(new Set());
  };

  const handleCreateSingleCard = async (card: { title: string; description?: string }, idx: number) => {
    if (creatingIds.has(idx)) return;
    setCreatingIds(prev => new Set([...prev, idx]));
    try {
      await createMut.mutateAsync({ title: card.title, description: card.description });
      queryClient.invalidateQueries({ queryKey: ['tasks', projectId] });
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
                      className={`btn btn-secondary btn-small ${creatingIds.has(i) ? 'disabled' : ''}`}
                      onClick={() => handleCreateSingleCard(c, i)}
                      disabled={creatingIds.has(i)}
                    >
                      {c.title} - {creatingIds.has(i) ? 'Creating...' : 'Create'}
                    </button>
                  </li>
                ))}
              </ul>
              <button className="btn btn-primary btn-small" onClick={handleCreateAllCards} disabled={creatingIds.size > 0}>
                {creatingIds.size > 0 ? 'Creating...' : 'Create All'}
              </button>
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
