'use client';

import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window { VanorWorkbench?: { start(options: Record<string, unknown>): Promise<{ dispose(): void }> } }
}

class SitesRepository {
  mode = 'sites'; persistent = true; label = 'Saved for Barry and Graeme'; onchange?: () => void;
  private timer?: ReturnType<typeof setInterval>;
  private revision = '';
  private async request(path = '', options: RequestInit = {}) {
    const response = await fetch('/api/workspace' + path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const text = await response.text(); let body: any;
    try { body = JSON.parse(text); } catch { const error = new Error(response.ok ? 'The shared workspace returned an incomplete response.' : 'The shared workspace is temporarily unavailable.'); error.name = 'InvalidResponseError'; throw error; }
    if (!response.ok) { const error = new Error(body.error || 'The shared workspace could not be updated.'); error.name = response.status === 409 ? 'ConflictError' : 'Error'; throw error; }
    return body;
  }
  async isReady() { return !!(await this.request('/ready')).ready; }
  async init(seed: unknown) { if (seed) await this.request('/bootstrap', { method: 'POST', body: JSON.stringify(seed) }); this.revision = (await this.request('/revision')).revision; this.timer = setInterval(() => { void this.checkForChanges().catch(() => undefined); }, 15000); return this; }
  async checkForChanges() { const next = (await this.request('/revision')).revision; if (next && next !== this.revision) { this.revision = next; this.onchange?.(); } }
  async load() { const data = await this.request(); this.revision = (await this.request('/revision')).revision; return data; }
  saveDecision(entity: unknown, expectedRev: number, event: unknown) { return this.save('decision', entity, expectedRev, event); }
  saveWork(entity: unknown, expectedRev: number, event: unknown) { return this.save('work', entity, expectedRev, event); }
  savePlannedEvent(entity: unknown, expectedRev: number, event: unknown) { return this.save('planned_event', entity, expectedRev, event); }
  async save(scope: string, entity: any, expectedRev: number, event: unknown) {
    try { return await this.request('/entity', { method: 'POST', body: JSON.stringify({ scope, entity, expectedRev, event }) }); }
    catch (error: any) {
      if (error.name !== 'InvalidResponseError') throw error;
      const stored = await this.request(`/entity?scope=${encodeURIComponent(scope)}&id=${encodeURIComponent(entity.id)}`);
      if (stored?._rev > expectedRev) return stored;
      throw new Error('The save could not be confirmed. Please try again.');
    }
  }
  importSource(seed: unknown) { return this.request('/import', { method: 'POST', body: JSON.stringify(seed) }); }
  addSource(record: unknown) { return this.request('/source', { method: 'POST', body: JSON.stringify(record) }); }
  previewCategorisation(ids?: string[]) { return this.request('/categorize', { method: 'POST', body: JSON.stringify({ mode: 'preview', ids }) }); }
  applyCategorisation(ids?: string[]) { return this.request('/categorize', { method: 'POST', body: JSON.stringify({ mode: 'apply', ids }) }); }
  exportBackup() { return this.request('/backup'); }
  backup() { return this.exportBackup(); }
  restoreBackup(backup: unknown) { return this.request('/restore', { method: 'POST', body: JSON.stringify(backup) }); }
  restore(backup: unknown) { return this.restoreBackup(backup); }
  dispose() { if (this.timer) clearInterval(this.timer); }
}

export default function VanorWorkspace() {
  const host = useRef<HTMLDivElement>(null); const [error, setError] = useState('');
  const [setup, setSetup] = useState<'loading' | 'import' | 'waiting' | 'ready'>('loading');
  const [backup, setBackup] = useState<any>(null);
  const [importing, setImporting] = useState(false);
  useEffect(() => {
    let handle: { dispose(): void } | undefined;
    (async () => {
      const repo = new SitesRepository();
      const [ready, user] = await Promise.all([repo.isReady(), fetch('/api/workspace/user').then(r => r.json())]);
      if (!ready) { setSetup(user.role === 'admin' ? 'import' : 'waiting'); return; }
      setSetup('ready');
      if (!(window as any).VanorPriority) await new Promise<void>((resolve) => { const s = document.createElement('script'); s.src = '/vanor-priority.js?v=1'; s.onload = () => resolve(); s.onerror = () => resolve(); document.head.appendChild(s); });
      if (!window.VanorWorkbench) await new Promise<void>((resolve, reject) => { const script = document.createElement('script'); script.src = '/vanor-runtime.js?v=23'; script.onload = () => resolve(); script.onerror = () => reject(new Error('The Vanor application failed to load.')); document.head.appendChild(script); });
      if (host.current && window.VanorWorkbench) handle = await window.VanorWorkbench.start({ element: host.current, repo, seed: null, actor: user.actor });
    })().catch(e => setError(e.message || String(e)));
    return () => handle?.dispose();
  }, []);
  async function importBackup() {
    if (!backup) return;
    setImporting(true); setError('');
    try {
      const response = await fetch('/api/workspace/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(backup) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Backup import failed.');
      window.location.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Backup import failed.'); setImporting(false); }
  }
  const card: React.CSSProperties = { width: 'min(100%, 460px)', background: '#fff', padding: 28, borderRadius: 16, boxShadow: '0 8px 40px #20303918', fontSize: 16, lineHeight: 1.5 };
  const page: React.CSSProperties = { minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f5f5f1', padding: 16 };
  const btn: React.CSSProperties = { width: '100%', padding: 14, border: 0, borderRadius: 8, color: '#fff', background: '#385d61', fontSize: 16, cursor: 'pointer', marginTop: 12 };
  if (setup === 'import') return <main style={page}><div style={card}>
    <h1 style={{ fontSize: 26, marginBottom: 8 }}>Load your BD data</h1>
    <p style={{ color: '#52646b' }}>One-off step. Choose the backup file exported from the old Vanor BD app (vanor-bd-backup-….json), check the counts, then import.</p>
    <label style={{ ...btn, display: 'block', textAlign: 'center', background: '#e8eeee', color: '#203039' }}>
      {backup ? 'Choose a different file' : 'Choose backup file'}
      <input type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={async event => {
        const file = event.target.files?.[0]; if (!file) return;
        try {
          const value = JSON.parse(await file.text());
          if (value.schemaVersion !== 5 || !Array.isArray(value.records) || !Array.isArray(value.work) || !value.decisions) throw new Error('That file isn\'t a Vanor BD backup.');
          setBackup(value); setError('');
        } catch (cause) { setBackup(null); setError(cause instanceof Error ? cause.message : 'Cannot read that file.'); }
      }} />
    </label>
    {backup && <p role="status" style={{ marginTop: 16 }}><b>{backup.records.length}</b> contacts · <b>{Object.keys(backup.decisions).length}</b> reviews · <b>{backup.work.length}</b> board cards · <b>{(backup.events || []).length}</b> history entries</p>}
    {backup && <button style={btn} disabled={importing} onClick={importBackup}>{importing ? 'Importing… (up to a minute)' : 'Import'}</button>}
    {error && <p role="alert" style={{ marginTop: 16, color: '#9b2c2c' }}>{error}</p>}
  </div></main>;
  if (setup === 'waiting') return <main className="vanor-load"><h1>Vanor BD</h1><p>An administrator must import the workspace backup first.</p></main>;
  return error ? <main className="vanor-load"><h1>Vanor BD</h1><p>{error}</p></main> : <div className="vanor" ref={host} />;
}
