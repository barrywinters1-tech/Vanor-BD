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
      if (!window.VanorWorkbench) await new Promise<void>((resolve, reject) => { const script = document.createElement('script'); script.src = '/vanor-runtime.js?v=13'; script.onload = () => resolve(); script.onerror = () => reject(new Error('The Vanor application failed to load.')); document.head.appendChild(script); });
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
  if (setup === 'import') return <main className="vanor-load" style={{ maxWidth: 620, margin: '10vh auto', padding: 24 }}>
    <h1>Set up Vanor BD</h1>
    <p>Import a fresh full backup from the live app. Review the counts before importing. This workspace must be empty.</p>
    <input type="file" accept=".json,application/json" onChange={async event => {
      const file = event.target.files?.[0]; if (!file) return;
      try {
        const value = JSON.parse(await file.text());
        if (value.schemaVersion !== 5 || !Array.isArray(value.records) || !Array.isArray(value.work) || !value.decisions) throw new Error('This is not a Vanor V5 full backup.');
        setBackup(value); setError('');
      } catch (cause) { setBackup(null); setError(cause instanceof Error ? cause.message : 'Cannot read backup.'); }
    }} />
    {backup && <p role="status">{backup.records.length} source records, {Object.keys(backup.decisions).length} decisions, {backup.work.length} BD positions, {(backup.events || []).length} history events.</p>}
    {backup && <button disabled={importing} onClick={importBackup}>{importing ? 'Importing…' : 'Import this backup'}</button>}
    {error && <p role="alert">{error}</p>}
  </main>;
  if (setup === 'waiting') return <main className="vanor-load"><h1>Vanor BD</h1><p>An administrator must import the workspace backup first.</p></main>;
  return error ? <main className="vanor-load"><h1>Vanor BD</h1><p>{error}</p></main> : <div className="vanor" ref={host} />;
}
