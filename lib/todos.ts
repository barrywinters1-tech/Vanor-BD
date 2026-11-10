// To-dos that Claude's scheduled runs put on the board (replies owed, meetings to arrange, drafts waiting),
// and the job-run log that shows on the board when a scheduled job stops reporting.
import { createHash } from 'node:crypto';
import { listScope, updateEntity, type Entity } from './bd-store';
import { today } from './bd-logic';

export const TODO_TYPES = ['reply', 'meeting', 'followup', 'event', 'action'] as const;
import { hasPlaceholder } from './todos-rules';
export { hasPlaceholder };

export type TodoIn = { type: string; title: string; why?: string; due?: string; owner?: string; link?: string; recordId?: string; pursuitId?: string; draftText?: string; source?: string; toEmail?: string; subject?: string; conversationId?: string };

const norm = (v: unknown) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');

export async function addTodos(items: TodoIn[]) {
  const added: string[] = [], skipped: { title: string; why: string }[] = [];
  // An open to-do with the same type and title is the same to-do, whatever ids or links it was first saved with:
  // re-adding it (e.g. now with a recipient or a draft link) updates that row instead of creating a second one.
  const open = (await listScope('work')).filter(w => w.kind === 'todo' && w.status === 'open');
  for (const t of items) {
    if (!TODO_TYPES.includes(t.type as any)) { skipped.push({ title: t.title, why: 'unknown type' }); continue; }
    if (hasPlaceholder(t.title) || hasPlaceholder(t.why) || hasPlaceholder(t.draftText)) { skipped.push({ title: t.title, why: 'contains placeholder text instead of a real name' }); continue; }
    if (t.due && !/^\d{4}-\d{2}-\d{2}$/.test(t.due)) { skipped.push({ title: t.title, why: 'due must be YYYY-MM-DD' }); continue; }
    const same = open.find(w => w.type === t.type && norm(w.title) === norm(t.title));
    const id = same ? String(same.id) : 'todo:' + createHash('sha1').update([t.type, t.title, t.recordId || '', t.pursuitId || '', t.link || ''].join('|')).digest('hex').slice(0, 16);
    let fresh = false;
    await updateEntity('work', id, cur => {
      if (cur.kind === 'todo' && cur.status) return { ...cur, why: t.why || cur.why, link: /^https:\/\//.test(t.link || '') ? t.link : cur.link, due: t.due || cur.due, owner: t.owner || cur.owner || '', recordId: t.recordId || cur.recordId || '', pursuitId: t.pursuitId || cur.pursuitId || '', toEmail: String(t.toEmail || cur.toEmail || '').toLowerCase().slice(0, 120), subject: (t.subject || cur.subject || '').slice(0, 200), conversationId: (t.conversationId || cur.conversationId || '').slice(0, 200) };
      fresh = true;
      return { id, kind: 'todo', status: 'open', type: t.type, title: t.title.slice(0, 160), why: (t.why || '').slice(0, 300), due: t.due || today(), owner: t.owner || '', link: /^https:\/\//.test(t.link || '') ? t.link : '', recordId: t.recordId || '', pursuitId: t.pursuitId || '', source: (t.source || '').slice(0, 200), toEmail: String(t.toEmail || '').toLowerCase().slice(0, 120), subject: (t.subject || '').slice(0, 200), conversationId: (t.conversationId || '').slice(0, 200), createdAt: new Date().toISOString(), createdBy: 'Claude' };
    }, true);
    (fresh ? added : skipped).push(fresh ? id : ({ title: t.title, why: 'already on the board' } as any));
  }
  return { added: added.length, skipped };
}

export async function listTodos({ includeDone = false } = {}) {
  return (await listScope('work')).filter(w => w.kind === 'todo' && (includeDone || w.status === 'open'))
    .map(w => ({ id: w.id, type: w.type, title: w.title, why: w.why, due: w.due, owner: w.owner, link: w.link, recordId: w.recordId, pursuitId: w.pursuitId, status: w.status, toEmail: w.toEmail || '', subject: w.subject || '', conversationId: w.conversationId || '', createdAt: w.createdAt || '', doneBy: w.doneBy || '', doneReason: w.doneReason || '', doneNote: w.doneNote || '', sentOn: w.sentOn || '' }));
}

export const DONE_REASONS = ['sent', 'superseded', 'meeting_held', 'no_longer_needed'] as const;
export type DoneReason = typeof DONE_REASONS[number];
export const CLOSED_BY_CLAUDE_DAYS = 14;

/** Closing the loop (5 Nov 2026, reasons added 10 Nov 2026).
 *  reason "sent" (default): Claude may close a reply, followup, meeting or action to-do only when the sent mail matches it:
 *  same recipient (toEmail) or the same conversation, and sent on or after the to-do was created.
 *  reason "superseded" | "meeting_held" | "no_longer_needed": no Sent Item needed, but the note must carry the evidence
 *  (at least 20 characters). Every close records doneBy "Claude", the reason and the note; the board lists them for 14 days
 *  with a one-tap Undo, so a wrong close is reversible. */
export async function todoDone(p: { id: string; sentOn?: string; toEmail?: string; conversationId?: string; note?: string; reason?: DoneReason }) {
  const reason: DoneReason = (p.reason || 'sent') as DoneReason;
  if (!DONE_REASONS.includes(reason)) throw new Error('reason must be one of ' + DONE_REASONS.join(', '));
  const all = await listScope('work');
  const cur = all.find(w => w.id === p.id && w.kind === 'todo');
  if (!cur) throw new Error('No to-do with id ' + p.id);
  if (cur.status !== 'open') return { id: p.id, closed: false, why: 'already ' + cur.status };
  if (!['reply', 'followup', 'meeting', 'action'].includes(String(cur.type))) return { id: p.id, closed: false, why: 'only reply, followup, meeting and action to-dos close this way' };
  const note = String(p.note || '').trim();
  if (reason !== 'sent') {
    if (note.length < 20) return { id: p.id, closed: false, why: `reason ${reason} needs a note with the evidence (at least 20 characters)` };
    if (cur.reopenedAt) return { id: p.id, closed: false, why: 'a founder reopened this; only a founder closes it now' };
    await updateEntity('work', p.id, c => ({ ...c, status: 'done', doneAt: new Date().toISOString(), doneBy: 'Claude', doneReason: reason, doneNote: note.slice(0, 300), matchedBy: '' }));
    return { id: p.id, closed: true, reason };
  }
  if (!p.sentOn || !/^\d{4}-\d{2}-\d{2}$/.test(p.sentOn)) throw new Error('sentOn must be YYYY-MM-DD for reason sent');
  const created = String(cur.createdAt || '').slice(0, 10);
  if (cur.reopenedAt && String(cur.reopenedAt).slice(0, 10) >= p.sentOn) return { id: p.id, closed: false, why: 'a founder reopened this after that mail was sent' };
  if (created && p.sentOn < created) return { id: p.id, closed: false, why: `sent ${p.sentOn} is before the to-do was created (${created})` };
  const to = String(p.toEmail || '').toLowerCase(); const want = String(cur.toEmail || '').toLowerCase();
  const byMail = !!(to && want && to === want);
  const byThread = !!(p.conversationId && cur.conversationId && p.conversationId === cur.conversationId);
  if (!byMail && !byThread) return { id: p.id, closed: false, why: want || cur.conversationId ? 'recipient and conversation do not match the to-do' : 'the to-do has no recipient or conversation recorded; a founder closes it with "I sent it"' };
  await updateEntity('work', p.id, c => ({ ...c, status: 'done', doneAt: new Date().toISOString(), doneBy: 'Claude', doneReason: 'sent', sentOn: p.sentOn, doneNote: note.slice(0, 300), matchedBy: byThread ? 'conversation' : 'recipient' }));
  return { id: p.id, closed: true, reason: 'sent', matchedBy: byThread ? 'conversation' : 'recipient' };
}

export async function todoReopen(id: string) {
  await updateEntity('work', id, c => ({ ...c, status: 'open', doneAt: '', doneBy: '', doneReason: '', sentOn: '', doneNote: '', matchedBy: '', reopenedAt: new Date().toISOString() }));
  return { id, status: 'open' };
}

/** Jobs report each run; the board flags any job that stops reporting (expectHours) or fails. */
export async function jobRan(p: { job: string; ok: boolean; note?: string; expectHours?: number; name?: string }) {
  const id = 'job:' + p.job.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50);
  const at = new Date().toISOString();
  await updateEntity('work', id, (cur: Entity) => ({ ...cur, id, kind: 'job', name: p.name || cur.name || p.job, lastRan: at, ok: p.ok, note: (p.note || '').slice(0, 300), expectHours: p.expectHours || cur.expectHours || 24, runs: [{ at, ok: p.ok, note: (p.note || '').slice(0, 120) }, ...((cur.runs as any[]) || [])].slice(0, 20) }), true);
  return { id, at };
}
