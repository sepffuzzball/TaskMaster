import React, { useEffect, useRef } from 'react';
import { Settings, X, Copy, AlertTriangle } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { ThemeName, ApiToken } from '../types';
import { triggerToast } from '../App';

const THEME_STORAGE_KEY = 'taskmaster-theme';

function getStoredTheme(): ThemeName {
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

export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [theme, setTheme] = React.useState<ThemeName>(getStoredTheme());
  const queryClient = useQueryClient();
  const tokensQuery = useQuery({ queryKey: ['auth/tokens'], queryFn: () => api.tokens.list() });
  const createTokenMut = useMutation({
    mutationFn: (data: { name: string; scopes: ('read'|'write')[] }) => api.tokens.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth/tokens'] });
      triggerToast('Token created', 'success');
    },
    onError: () => triggerToast('Failed to create token', 'danger'),
  });
  const revokeTokenMut = useMutation({
    mutationFn: (id: string) => api.tokens.revoke(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth/tokens'] });
      triggerToast('Token revoked', 'success');
    },
    onError: () => triggerToast('Failed to revoke token', 'danger'),
  });
  const [showSecret, setShowSecret] = React.useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.querySelector('button')?.focus();
    const handleEscape = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <div className="dialog-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="settings-dialog-title">
        <button className="dialog-close btn-icon" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>
        <h2 className="dialog-title" id="settings-dialog-title">Settings</h2>

        <section style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '1rem', marginBottom: '8px' }}>Theme</h3>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {(['tokyo-night', 'latte', 'frappe', 'macchiato', 'mocha'] as ThemeName[]).map(t => (
              <button
                key={t}
                className={`btn btn-secondary ${theme === t ? 'active' : ''}`}
                onClick={() => { setTheme(t); setStoredTheme(t); }}
                style={theme === t ? { background: 'var(--accent-blue)', color: '#fff' } : {}}
              >
                {t.replace('-', ' ')}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 style={{ fontSize: '1rem', marginBottom: '8px' }}>API Tokens</h3>
          <form onSubmit={e => {
            e.preventDefault();
            const form = e.currentTarget;
            const name = (form.elements as any)['token-name'].value;
            const scopes = Array.from(form.querySelectorAll('[name="token-scope"]:checked')).map((cb: any) => cb.value);
            createTokenMut.mutateAsync({ name, scopes: scopes as ('read'|'write')[] })
              .then((data: { token: string; apiToken: ApiToken }) => {
                setShowSecret(data.token);
              })
              .catch(() => {});
          }}>
            <div className="form-field">
              <label htmlFor="token-name">Token name</label>
              <input id="token-name" name="token-name" required maxLength={80} />
            </div>
            <div className="form-field">
              <label>Scopes</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <label><input type="checkbox" name="token-scope" value="read" defaultChecked /> read</label>
                <label><input type="checkbox" name="token-scope" value="write" /> write</label>
              </div>
            </div>
            <div className="dialog-actions">
              <button type="submit" className="btn btn-primary">Create Token</button>
            </div>
          </form>

          {showSecret && (
            <div style={{ marginTop: '16px', padding: '12px', background: 'var(--bg-surface)', borderRadius: '4px', position: 'relative' }}>
              <strong style={{ fontSize: '0.8rem' }}>Token secret (shown once):</strong>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
                <code style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{showSecret}</code>
                <button className="btn-icon" onClick={() => { navigator.clipboard.writeText(showSecret); triggerToast('Copied', 'success'); }} aria-label="Copy secret">
                  <Copy size={16} />
                </button>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--danger)', marginTop: '4px' }}>
                This secret will not be shown again. Store it safely.
              </div>
            </div>
          )}

          {tokensQuery.data?.length ? (
            <div style={{ marginTop: '16px' }}>
              <h4 style={{ fontSize: '0.875rem', marginBottom: '4px' }}>Existing tokens</h4>
              <ul style={{ listStyle: 'none' }}>
                {tokensQuery.data.map((t: ApiToken) => (
                  <li key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                    <span>{t.name} ({t.prefix}...)</span>
                    {!t.revokedAt ? (
                      <button className="btn btn-danger btn-small" onClick={() => revokeTokenMut.mutate(t.id)}>
                        Revoke
                      </button>
                    ) : <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>revoked</span>}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
