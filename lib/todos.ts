// To-dos that Claude's scheduled runs put on the board (replies owed, meetings to arrange, drafts waiting),
// and the job-run log that shows on the board when a scheduled job stops reporting.
import { createHash } from 'node:crypto';
import { listScope, updateEntity, type Entity } from './bd-store';
import { today } from './bd-logic';

export const TODO_TYPES = ['reply', 'meeting', 'followup', 'event', 'action'] as const;
import { hasPlaceholder } from './todos-rules';
export { hasPlaceholder };

export type TodoIn = { type: string; title: string; why?: string; due?: string; owner?: string; link?: string; recordId?: string; pursuitId?: string; draftText?: string; source?: string };

export async function addTodos(items: TodoIn[]) {
  const added: string[] = [], skipped: { title: string; why: string }[] = [];
  for (const t of items) {
    if (!TODO_TYPES.includes(t.type as any)) { skipped.push({ title: t.title, why: 'unknown type' }); continue; }
    if (hasPlaceholder(t.title) || hasPlaceholder(t.why) || hasPlaceholder(t.draftText)) { skipped.push({ title: t.title, why: 'contains placeholder text instead of a real name' }); continue; }
    if (t.due && !/^\d{4}-\d{2}-\d{2}$/.test(t.due)) { skipped.push({ title: t.title, why: 'due must be YYYY-MM-DD' }); continue; }
    const id = 'todo:' + createHash('sha1').update([t.type, t.title, t.recordId || '', t.pursuitId || '', t.link || ''].join('|')).digest('hex').slice(0, 16);
    let fresh = false;
    await updateEntity('work', id, cur => {
      if (cur.kind === 'todo' && cur.status) return { ...cur, why: t.why || cur.why, link: t.link || cur.link, due: t.due || cur.due };
      fresh = true;
      return { id, kind: 'todo', status: 'open', type: t.type, title: t.title.slice(0, 160), why: (t.why || '').slice(0, 300), due: t.due || today(), owner: t.owner || '', link: t.link || '', recordId: t.recordId || '', pursuitId: t.pursuitId || '', source: (t.source || '').slice(0, 200), createdAt: new Date().toISOString(), createdBy: 'Claude' };
    }, true);
    (fresh ? added : skipped).push(fresh ? id : ({ title: t.title, why: 'already on the board' } as any));
  }
  return { added: added.length, skipped };
}

export async function listTodos({ includeDone = false } = {}) {
  return (await listScope('work')).filter(w => w.kind === 'todo' && (includeDone || w.status === 'open'))
    .map(w => ({ id: w.id, type: w.type, title: w.title, why: w.why, due: w.due, owner: w.owner, link: w.link, recordId: w.recordId, pursuitId: w.pursuitId, status: w.status }));
}

/** Jobs report each run; the board flags any job that stops reporting (expectHours) or fails. */
export async function jobRan(p: { job: string; ok: boolean; note?: string; expectHours?: number; name?: string }) {
  const id = 'job:' + p.job.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50);
  const at = new Date().toISOString();
  await updateEntity('work', id, (cur: Entity) => ({ ...cur, id, kind: 'job', name: p.name || cur.name || p.job, lastRan: at, ok: p.ok, note: (p.note || '').slice(0, 300), expectHours: p.expectHours || cur.expectHours || 24, runs: [{ at, ok: p.ok, note: (p.note || '').slice(0, 120) }, ...((cur.runs as any[]) || [])].slice(0, 20) }), true);
  return { id, at };
}
