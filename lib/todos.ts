// To-dos that Claude's scheduled runs put on the board (replies owed, meetings to arrange, drafts waiting),
// and the job-run log that shows on the board when a scheduled job stops reporting.
import { createHash } from 'node:crypto';
import { listScope, updateEntity, type Entity } from './bd-store';
import { today } from './bd-logic';

export const TODO_TYPES = ['reply', 'meeting', 'followup', 'event', 'action'] as const;
import { hasPlaceholder } from './todos-rules';
export { hasPlaceholder };

export type TodoIn = { type: string; title: string; why?: string; due?: string; owner?: string; link?: string; recordId?: string; pursuitId?: string; draftText?: string; source?: string; toEmail?: string; subject?: string; conversationId?: string; meetingAt?: string };

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
    if (t.meetingAt && Number.isNaN(Date.parse(t.meetingAt))) { skipped.push({ title: t.title, why: 'meetingAt must be a date-time' }); continue; }
    const meetingAt = t.meetingAt ? new Date(t.meetingAt).toISOString() : '';
    const differs = (a: unknown, b: unknown) => !!(a && b && String(a) !== String(b));
    const same = open.find(w => w.type === t.type && norm(w.title) === norm(t.title) && !differs(w.conversationId, t.conversationId) && !differs(w.recordId, t.recordId) && !differs(w.pursuitId, t.pursuitId));
    const id = same ? String(same.id) : 'todo:' + createHash('sha1').update([t.type, t.title, t.recordId || '', t.pursuitId || '', t.link || '', t.conversationId || ''].join('|')).digest('hex').slice(0, 16);
    let fresh = false, closed = '';
    await updateEntity('work', id, cur => {
      if (cur.kind === 'todo' && cur.status === 'done') { closed = String(cur.doneAt || '').slice(0, 10); return cur; }
      if (cur.kind === 'todo' && cur.status) return { ...cur, why: t.why || cur.why, link: /^https:\/\//.test(t.link || '') ? t.link : cur.link, due: t.due || cur.due, owner: t.owner || cur.owner || '', recordId: t.recordId || cur.recordId || '', pursuitId: t.pursuitId || cur.pursuitId || '', toEmail: String(t.toEmail || cur.toEmail || '').toLowerCase().slice(0, 120), subject: (t.subject || cur.subject || '').slice(0, 200), conversationId: (t.conversationId || cur.conversationId || '').slice(0, 200), meetingAt: meetingAt || cur.meetingAt || '' };
      fresh = true;
      return { id, kind: 'todo', status: 'open', type: t.type, title: t.title.slice(0, 160), why: (t.why || '').slice(0, 300), due: t.due || today(), owner: t.owner || '', link: /^https:\/\//.test(t.link || '') ? t.link : '', recordId: t.recordId || '', pursuitId: t.pursuitId || '', source: (t.source || '').slice(0, 200), toEmail: String(t.toEmail || '').toLowerCase().slice(0, 120), subject: (t.subject || '').slice(0, 200), conversationId: (t.conversationId || '').slice(0, 200), meetingAt, createdAt: new Date().toISOString(), createdBy: 'Claude' };
    }, true);
    if (fresh) added.push(id); else skipped.push({ title: t.title, why: closed ? `already closed on ${closed}; reopen it on the board if it is still needed` : 'already on the board, updated' });
  }
  return { added: added.length, skipped };
}

export async function listTodos({ includeDone = false } = {}) {
  return (await listScope('work')).filter(w => w.kind === 'todo' && (includeDone || w.status === 'open'))
    .map(w => ({ id: w.id, type: w.type, title: w.title, why: w.why, due: w.due, owner: w.owner, link: w.link, recordId: w.recordId, pursuitId: w.pursuitId, status: w.status, toEmail: w.toEmail || '', subject: w.subject || '', conversationId: w.conversationId || '', meetingAt: w.meetingAt || '', createdAt: w.createdAt || '', doneBy: w.doneBy || '', doneReason: w.doneReason || '', doneNote: w.doneNote || '', sentOn: w.sentOn || '' }));
}

export const DONE_REASONS = ['sent', 'superseded', 'meeting_held', 'no_longer_needed', 'expired'] as const;
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
    if (cur.reopenedAt) return { id: p.id, closed: false, why: 'a founder reopened this; only a founder closes it now' }; // deliberate: no date rule, a reopen is a founder decision
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


/** Self-tidy (18 Nov 2026). The board clears what is dead so the partners never have to:
 *  - a meeting brief or arrangement whose meeting time has passed (meetingAt, or a "brief for <date>" title on older rows);
 *  - a meeting request whose offered slots have all passed;
 *  - a draft that has not been sent after DRAFT_DAYS days (the Outlook draft itself is never touched);
 *  - a to-do that asks a partner for a fact and is over a week old.
 *  Never: a to-do a founder reopened, an event to-do, anything a founder created. At most `limit` per run. Each close records
 *  doneBy Claude, reason "expired" and the rule, so it shows under "Closed by Claude" with Undo. */
export const DRAFT_DAYS = 10;
const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
export function datesIn(text: string, todayIso: string): string[] {
  const out: string[] = []; const re = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/gi;
  const now = Date.parse(todayIso); const y = Number(todayIso.slice(0, 4)); let m: RegExpExecArray | null;
  while ((m = re.exec(String(text || '')))) {
    const d = Number(m[1]); if (d < 1 || d > 31) continue; const mo = MONTHS[m[2].toLowerCase()];
    const best = [y - 1, y, y + 1].map(yy => Date.UTC(yy, mo, d)).sort((a, b) => Math.abs(a - now) - Math.abs(b - now))[0];
    out.push(new Date(best).toISOString().slice(0, 10));
  }
  return out;
}
export function expiryReason(t: Entity, nowIso: string): string {
  const todayIso = nowIso.slice(0, 10);
  if (t.kind !== 'todo' || t.status !== 'open' || t.reopenedAt || t.type === 'event' || (t.createdBy && t.createdBy !== 'Claude')) return '';
  if (t.meetingAt) return Date.parse(t.meetingAt) < Date.parse(nowIso) ? `meeting time ${String(t.meetingAt).slice(0, 16).replace('T', ' ')} has passed` : '';
  const title = String(t.title || ''); const i = title.toLowerCase().indexOf('brief for');
  if (i >= 0) { const d = datesIn(title.slice(i), todayIso)[0]; return d && d < todayIso ? `meeting on ${d} has passed` : ''; }
  const why = String(t.why || ''); const o = why.toLowerCase().indexOf('offered');
  if (t.type === 'meeting' && o >= 0) { const ds = datesIn(why.slice(o), todayIso); if (ds.length && ds.every(d => d < todayIso)) return 'every offered slot has passed'; }
  const age = t.createdAt ? Math.floor((Date.parse(nowIso) - Date.parse(t.createdAt)) / 864e5) : 0;
  if (/^https:\/\//.test(t.link || '') && age >= DRAFT_DAYS) return `draft not sent after ${age} days`;
  if (/tell me what you promised|i need the|: tell me|pick slots/i.test(title) && age >= 7) return `question to a partner unanswered after ${age} days`;
  return '';
}
export async function expireTodos({ apply = true, limit = 40, now = new Date().toISOString() } = {}) {
  const work = await listScope('work');
  // A chase tied to a priced pursuit never expires by itself: money is the partners' call.
  const pricedIds = new Set(work.filter(w => w.kind === 'pursuit' && (w.state === 'table' || w.issuedOn || w.decisionDate || w.validUntil || (w.amount !== undefined && w.amount !== null && w.amount !== ''))).map(w => w.id));
  const all = work.filter(w => w.kind === 'todo' && w.status === 'open');
  const due = all.filter(t => !(t.pursuitId && pricedIds.has(t.pursuitId))).map(t => ({ t, why: expiryReason(t, now) })).filter(x => x.why).slice(0, limit);
  if (apply) for (const { t, why } of due) {
    await updateEntity('work', t.id, c => (c.status !== 'open' || c.reopenedAt) ? c : ({ ...c, status: 'done', doneAt: now, doneBy: 'Claude', doneReason: 'expired', doneNote: why, matchedBy: '' }));
  }
  return { checked: all.length, closed: due.length, applied: apply, items: due.map(x => ({ id: x.t.id, title: x.t.title, why: x.why })) };
}
