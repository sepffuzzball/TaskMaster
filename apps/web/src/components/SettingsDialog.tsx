import React, { useEffect, useRef, useState } from 'react';
import { X, Copy, Trash } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { ThemeName, ApiToken, Tag } from '../types';
import { triggerToast } from '../App';
import TagChip from './TagChip';

const THEME_STORAGE_KEY = 'taskmaster-theme';
const PRESETS = ['#4c8ddb', '#9c7bcf', '#4ad19e', '#f9c440', '#f4476b', '#e879b9', '#64748b', '#f97316'];
const HEX = /^#[0-9a-fA-F]{6}$/;

function getStoredTheme(): ThemeName {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored && ['tokyo-night', 'latte', 'frappe', 'macchiato', 'mocha'].includes(stored) ? stored as ThemeName : 'tokyo-night';
}

function TagSettingsRow({ tag, onChanged }: { tag: Tag; onChanged: () => void }) {
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color);
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () => api.tags.update(tag.id, { name: name.trim(), color, expectedVersion: tag.version }),
    onSuccess: () => { setError(''); triggerToast('Tag updated', 'success'); onChanged(); },
    onError: (value: any) => setError(value.errors?.[0]?.code === 'STALE_VERSION' ? 'This tag changed elsewhere. Refresh and try again.' : value.errors?.[0]?.message || 'Could not update tag.'),
  });
  const remove = useMutation({
    mutationFn: () => api.tags.delete(tag.id, tag.version),
    onSuccess: () => { triggerToast('Tag deleted', 'success'); onChanged(); },
    onError: (value: any) => setError(value.errors?.[0]?.code === 'STALE_VERSION' ? 'This tag changed elsewhere. Refresh and try again.' : value.errors?.[0]?.message || 'Could not delete tag.'),
  });
  const validName = /^[A-Za-z0-9_-]{1,32}$/.test(name.trim());
  const valid = validName && HEX.test(color);
  return (
    <li className="tag-settings-row">
      <div className="tag-settings-preview"><TagChip name={name || tag.name} color={HEX.test(color) ? color : '#596078'} /></div>
      <div className="tag-settings-fields">
        <label><span>Name</span><input value={name} maxLength={32} onChange={event => { setName(event.target.value); setError(''); }} aria-invalid={!validName} /></label>
        <label><span>Color</span><span className="tag-color-controls">
          <input type="color" value={HEX.test(color) ? color : '#596078'} onChange={event => setColor(event.target.value)} aria-label={`Choose color for ${tag.name}`} />
          <input value={color} onChange={event => { setColor(event.target.value); setError(''); }} aria-label={`Hex color for ${tag.name}`} aria-invalid={!HEX.test(color)} maxLength={7} />
        </span></label>
        <div className="tag-preset-list" aria-label={`Preset colors for ${tag.name}`}>
          {PRESETS.map(preset => <button key={preset} type="button" className={color.toLowerCase() === preset ? 'selected' : ''} style={{ backgroundColor: preset }} onClick={() => setColor(preset)} aria-label={`Use color ${preset} for ${tag.name}`} />)}
        </div>
      </div>
      <div className="tag-settings-actions">
        <button type="button" className="btn btn-primary btn-small" disabled={!valid || save.isPending} onClick={() => save.mutate()}>Save</button>
        <button type="button" className="btn btn-icon btn-small danger" disabled={remove.isPending} onClick={() => window.confirm(`Delete tag ${tag.name}? It will be removed from all tasks.`) && remove.mutate()} aria-label={`Delete tag ${tag.name}`}><Trash size={16} /></button>
      </div>
      {!validName && <p className="field-error">Use 1-32 letters, numbers, hyphens, or underscores.</p>}
      {!HEX.test(color) && <p className="field-error">Enter a six-digit hex color such as #4c8ddb.</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
    </li>
  );
}

export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [theme, setTheme] = useState<ThemeName>(getStoredTheme());
  const [showSecret, setShowSecret] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const tokensQuery = useQuery({ queryKey: ['auth/tokens'], queryFn: () => api.tokens.list() });
  const tagsQuery = useQuery({ queryKey: ['tags'], queryFn: () => api.tags.list() });
  const invalidateTagsAndTasks = () => {
    queryClient.invalidateQueries({ queryKey: ['tags'] });
    queryClient.invalidateQueries({ predicate: query => query.queryKey[0] === 'tasks' || query.queryKey[0] === 'task' });
  };
  const createTokenMut = useMutation({ mutationFn: (data: { name: string; scopes: ('read'|'write')[] }) => api.tokens.create(data), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['auth/tokens'] }); triggerToast('Token created', 'success'); }, onError: () => triggerToast('Failed to create token', 'danger') });
  const revokeTokenMut = useMutation({ mutationFn: (id: string) => api.tokens.revoke(id), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['auth/tokens'] }); triggerToast('Token revoked', 'success'); }, onError: () => triggerToast('Failed to revoke token', 'danger') });
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialogRef.current?.querySelector('button')?.focus();
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);
  return (
    <div className="dialog-overlay" onClick={event => event.target === event.currentTarget && onClose()}>
      <div className="dialog dialog-wide settings-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="settings-dialog-title">
        <button className="dialog-close btn-icon" onClick={onClose} aria-label="Close"><X size={20} /></button>
        <h2 className="dialog-title" id="settings-dialog-title">Settings</h2>
        <section className="settings-section"><h3>Theme</h3><div className="settings-theme-list">
          {(['tokyo-night', 'latte', 'frappe', 'macchiato', 'mocha'] as ThemeName[]).map(item => <button key={item} className={`btn btn-secondary ${theme === item ? 'active' : ''}`} onClick={() => { setTheme(item); localStorage.setItem(THEME_STORAGE_KEY, item); document.documentElement.setAttribute('data-theme', item); }}>{item.replace('-', ' ')}</button>)}
        </div></section>
        <section className="settings-section" aria-labelledby="tags-settings-title"><div className="settings-section-heading"><h3 id="tags-settings-title">Tags</h3><p>Rename tags and tune their board colors.</p></div>
          {tagsQuery.isLoading ? <div className="loading">Loading tags...</div> : tagsQuery.error ? <div className="field-error" role="alert">Could not load tags. <button className="btn btn-secondary btn-small" onClick={() => tagsQuery.refetch()}>Retry</button></div> : tagsQuery.data?.length ? <ul className="tag-settings-list">{tagsQuery.data.map(tag => <TagSettingsRow key={tag.id} tag={tag} onChanged={invalidateTagsAndTasks} />)}</ul> : <p className="settings-empty">No tags yet. Add one while creating or editing a task.</p>}
        </section>
        <section className="settings-section"><h3>API Tokens</h3>
          <form onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const name = (form.elements.namedItem('token-name') as HTMLInputElement).value; const scopes = Array.from(form.querySelectorAll<HTMLInputElement>('[name="token-scope"]:checked')).map(input => input.value) as ('read'|'write')[]; createTokenMut.mutateAsync({ name, scopes }).then(data => setShowSecret(data.token)).catch(() => {}); }}>
            <div className="form-field"><label htmlFor="token-name">Token name</label><input id="token-name" name="token-name" required maxLength={80} /></div>
            <div className="token-scopes"><span>Scopes</span><label><input type="checkbox" name="token-scope" value="read" defaultChecked /> read</label><label><input type="checkbox" name="token-scope" value="write" /> write</label></div>
            <div className="dialog-actions"><button type="submit" className="btn btn-primary">Create Token</button></div>
          </form>
          {showSecret && <div className="token-secret"><strong>Token secret (shown once):</strong><div><code>{showSecret}</code><button type="button" className="btn-icon" onClick={() => { navigator.clipboard.writeText(showSecret); triggerToast('Copied', 'success'); }} aria-label="Copy secret"><Copy size={16} /></button></div><p className="token-secret-warning">This secret will not be shown again. Store it safely.</p></div>}
          {!!tokensQuery.data?.length && <ul className="token-list">{tokensQuery.data.map((token: ApiToken) => <li key={token.id}><span>{token.name} ({token.prefix}...)</span>{!token.revokedAt ? <button className="btn btn-danger btn-small" onClick={() => revokeTokenMut.mutate(token.id)}>Revoke</button> : <span className="field-help">revoked</span>}</li>)}</ul>}
        </section>
      </div>
    </div>
  );
}
