// Tasks: the obligations the engine and the founders create, in one list. Stored as decision entities with id 'task:<uuid>' (no schema change).
import { createHash } from 'node:crypto';
import { listScope, getOne, updateEntity, logEvent, type Entity } from './bd-store';

export type Task = { id: string; title: string; owner: string; due: string; status: 'Open' | 'Done' | 'Snoozed'; priority: 'High' | 'Normal' | 'Low'; source: { kind: 'record' | 'event' | 'draft' | 'proposal' | 'meeting' | 'manual' | 'engine'; id?: string; label?: string }; notes: string; createdBy: string; createdAt: string; doneAt?: string; doneBy?: string; snoozedUntil?: string; key?: string };
const DAY = 864e5;
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10);
/** v3.1 (30 Oct 2026): every task has one kind, read from its id, source and title. */
export function taskKind(t: { id?: string; title?: string; source?: { kind?: string } }) {
  const id = String(t.id || ''), ti = String(t.title || ''), k = t.source?.kind || '';
  if (id.startsWith('task:invoice:') || /raise the (po|invoice)|invoice/i.test(ti)) return 'Invoice';
  if (id.startsWith('task:decision:') || /^Decision due|^Call .*decision|decision date/i.test(ti)) return 'Decision';
  if (id.startsWith('task:chase:') || /^Chase |^Decide on .*two chases/i.test(ti)) return 'Chase';
  if (/from Outlook Drafts|^Send the .*(draft|proposal)|^Read and send/i.test(ti) || k === 'draft' || k === 'proposal') return 'Send';
  if (/clash|calendar|invite/i.test(ti)) return 'Diary';
  if (k === 'event' || /^Decide and book|^Prepare for|^Follow up the people from/i.test(ti)) return 'Event';
  if (k === 'meeting' || /^Introduce /i.test(ti)) return 'Promise';
  if (k === 'manual' || t.source == null) return 'Own';
  return 'Next ask';
}
export const taskKey = (kind: string, id: string, title: string) => 'task:' + createHash('sha1').update(`${kind}|${id}|${title.toLowerCase().trim()}`).digest('hex').slice(0, 20);

export async function listTasks({ owner, status, dueBefore, limit = 200 }: { owner?: string; status?: Task['status'] | 'All'; dueBefore?: string; limit?: number } = {}) {
  const all = (await listScope('decision')).filter(d => String(d.id).startsWith('task:')) as unknown as Task[];
  return all.filter(t => (!owner || owner === 'All' || t.owner === owner) && (!status || status === 'All' ? t.status !== 'Done' : t.status === status) && (!dueBefore || (t.due && t.due <= dueBefore)))
    .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (a.priority === 'High' ? -1 : 1)).slice(0, limit);
}

/** Idempotent: same source + title never duplicates; a Done task is not resurrected. */
export async function addTask(input: Omit<Task, 'id' | 'status' | 'createdAt'> & { id?: string; status?: Task['status'] }) {
  const id = input.id || taskKey(input.source.kind, input.source.id || '', input.title);
  const existing = await getOne('decision', id);
  if (existing) return { created: false, id, status: existing.status };
  await updateEntity('decision', id, cur => ({ ...cur, ...input, id, status: input.status || 'Open', createdAt: new Date().toISOString() }), true);
  await logEvent({ entityId: input.source.id || id, recordId: input.source.id || undefined, type: 'Task added', actor: input.createdBy, note: `${input.title} (${input.owner}, due ${input.due || 'no date'})` });
  return { created: true, id, status: 'Open' };
}
export async function completeTask(id: string, actor: string, done = true) {
  const t = await updateEntity('decision', id, cur => ({ ...cur, status: done ? 'Done' : 'Open', doneAt: done ? new Date().toISOString() : undefined, doneBy: done ? actor : undefined }));
  await logEvent({ entityId: (t as any).source?.id || id, recordId: (t as any).source?.id || undefined, type: done ? 'Task done' : 'Task reopened', actor, note: String((t as any).title || '') });
  return { ok: true };
}
export async function snoozeTask(id: string, days: number, actor: string) {
  await updateEntity('decision', id, cur => ({ ...cur, status: 'Open', due: addDays(cur.due && cur.due >= today() ? cur.due : today(), days), snoozedUntil: addDays(today(), days) }));
  await logEvent({ entityId: id, type: 'Task snoozed', actor, note: `${days} days` });
  return { ok: true };
}

/** Derive tasks from what already creates obligations. Safe to run often. */
export async function deriveTasks() {
  const [records, decisions, events] = await Promise.all([listScope('source'), listScope('decision'), listScope('planned_event')]);
  const dById = new Map(decisions.map(d => [d.id, d]));
  const owner = (r: Entity) => (dById.get(r.id)?.owner || r.sourceOwner || 'Barry') as string;
  const t0 = today(); let created = 0;
  const add = async (x: Parameters<typeof addTask>[0]) => { if ((await addTask(x)).created) created++; };
  for (const r of records) {
    const d: Entity = dById.get(r.id) || { id: r.id }; const ask = d.nextAsk || r.nextAsk; const due = d.nextDate || r.nextDate;
    // v3.1: next asks live on Today, not as tasks. Kept for the record only when a founder typed the ask (not the engine) and it is due inside 7 days.
    if (ask && due && due >= t0 && due <= addDays(t0, 7) && d.nextAskBy && d.nextAskBy !== 'Engine')
      await add({ title: `${ask}`.slice(0, 140), owner: owner(r), due, priority: due <= addDays(t0, 3) ? 'High' : 'Normal', source: { kind: 'record', id: r.id, label: `${r.name || ''} · ${r.company || ''}` }, notes: '', createdBy: 'Engine' });
    const dr = d.draft; if (dr && dr.status === 'pushed' && dr.pushedAt && String(dr.pushedAt).slice(0, 10) >= addDays(t0, -7))
      await add({ title: `Send the draft to ${r.name || r.company} from Outlook`, owner: owner(r), due: addDays(String(dr.pushedAt).slice(0, 10), 1), priority: 'High', source: { kind: 'draft', id: r.id, label: dr.subject }, notes: 'It is in Outlook Drafts. Read it once, then send.', createdBy: 'Engine' });
    const pr = d.proposal; if (pr && pr.status === 'pushed' && pr.pushedAt && String(pr.pushedAt).slice(0, 10) >= addDays(t0, -7))
      await add({ title: `Send the ${pr.scheme || ''} proposal to ${r.name || r.company}`.replace(/\s+/g, ' '), owner: owner(r), due: addDays(String(pr.pushedAt).slice(0, 10), 1), priority: 'High', source: { kind: 'proposal', id: r.id, label: pr.title }, notes: 'Cover note and proposal are in Outlook Drafts.', createdBy: 'Engine' });
  }
  for (const e of events) {
    if (e.archived) continue;
    if (e.bookingDeadline && ['Research', 'Interested', 'Qualified', 'Deciding'].includes(e.status) && e.bookingDeadline >= t0)
      await add({ title: `Decide and book: ${e.title}`, owner: e.owner && e.owner !== 'Unassigned' ? e.owner : 'Barry', due: addDays(e.bookingDeadline, -2), priority: 'Normal', source: { kind: 'event', id: e.id, label: e.title }, notes: `Booking deadline ${e.bookingDeadline}. ${e.objective || ''}`, createdBy: 'Engine' });
    if (['Booked', 'Attending'].includes(e.status) && e.date >= t0 && e.date <= addDays(t0, 21))
      await add({ title: `Prepare for ${e.title}: who to meet and the ask`, owner: e.owner && e.owner !== 'Unassigned' ? e.owner : 'Barry', due: addDays(e.date, -2), priority: 'Normal', source: { kind: 'event', id: e.id, label: e.title }, notes: e.targets ? `Targets: ${e.targets}` : 'No named targets yet; add them in Events.', createdBy: 'Engine' });
    if (['Booked', 'Attending'].includes(e.status) && e.date < t0 && e.date >= addDays(t0, -10))
      await add({ title: `Follow up the people from ${e.title}`, owner: e.owner && e.owner !== 'Unassigned' ? e.owner : 'Barry', due: addDays(e.date, 2), priority: 'High', source: { kind: 'event', id: e.id, label: e.title }, notes: 'Log who you met (add_lead / log_interaction) and send the follow-ups within 48 hours.', createdBy: 'Engine' });
  }
  return { created };
}

/** Overdue sweep: closes tasks whose reason has gone (record archived, draft sent or replaced, event passed) and reports what is still overdue, oldest first. Nothing is deleted. */
export async function sweepTasks() {
  const t0 = today();
  const [open, records, decisions, events, log] = await Promise.all([listTasks({ status: 'Open', limit: 1000 }), listScope('source'), listScope('decision'), listScope('planned_event'), listScope('event')]);
  // v3.1: the newest sent and reply per contact, so a task closes itself once the thing it waited for has happened.
  const lastOut = new Map<string, string>(), lastIn = new Map<string, string>();
  for (const e of log) { const rid = String(e.recordId || e.entityId || ''); const ty = String(e.type || ''); const at = String(e.happenedOn || e.date || e.at || '').slice(0, 10); if (!rid || !at) continue;
    if (/^Outcome: (sent|proposal)$|^Interaction: email out$|^Intro: made$/.test(ty) && (lastOut.get(rid) || '') < at) lastOut.set(rid, at);
    if (/^Outcome: (reply|meeting_held|won)$|^Interaction: email in$/.test(ty) && (lastIn.get(rid) || '') < at) lastIn.set(rid, at); }
  const rec = new Map(records.map(r => [r.id, r])); const dec = new Map(decisions.map(d => [d.id, d])); const ev = new Map(events.map(e => [e.id, e]));
  const closed: string[] = [];
  for (const t of open) {
    const s = t.source || ({} as Task['source']); let reason = '';
    if (s.kind === 'record' && s.id && (rec.get(s.id)?.archived || !rec.has(s.id))) reason = 'contact archived';
    if (s.kind === 'draft' && s.id) { const dr = dec.get(s.id)?.draft; if (!dr || dr.status !== 'pushed') reason = 'draft no longer waiting in Outlook'; }
    if (s.kind === 'proposal' && s.id) { const pr = dec.get(s.id)?.proposal; if (!pr || pr.status !== 'pushed') reason = 'proposal no longer waiting in Outlook'; }
    if (s.kind === 'event' && s.id) { const e = ev.get(s.id); if (!e || e.archived || (t.title.startsWith('Decide and book') && e.date && e.date < t0) || (t.title.startsWith('Prepare for') && e.date && e.date < t0)) reason = 'event passed or archived'; }
    if (String(t.id).startsWith('task:chase:')) { const [, , rid, sentAt] = String(t.id).split(':'); const pu = dec.get(rid)?.pursuit; if (!pu || pu.step !== 'sent' || pu.sentAt !== sentAt) reason = 'lead moved on (chase issued, reply, meeting or parked)'; }
    if (!reason && !String(t.id).startsWith('task:chase:') && s.kind === 'record' && t.createdBy === 'Engine' && t.due && t.due < addDays(t0, -21)) reason = 'stale next ask on the record (3+ weeks past); update the record if it still matters';
    const kind = taskKind(t); const rid = s.id || ''; const made = String((t as any).createdAt || '').slice(0, 10);
    if (!reason && kind === 'Send' && rid && made && (lastOut.get(rid) || '') >= made) reason = 'sent from Outlook (seen in Sent Items)';
    if (!reason && kind === 'Send' && made && made < addDays(t0, -5)) reason = 'draft not sent within 5 days; the chase clock or Today carries it now';
    if (!reason && kind === 'Chase' && rid && made && ((lastIn.get(rid) || '') >= made || (lastOut.get(rid) || '') > made)) reason = 'chased or they replied';
    if (!reason && kind === 'Decision' && rid) { const pr = dec.get(rid)?.proposal; const pu = dec.get(rid)?.pursuit; if (!pr || pr.open === false || pu?.step === 'won' || pu?.step === 'lost') reason = 'proposal decided or withdrawn'; }
    if (!reason && kind === 'Next ask' && t.createdBy === 'Engine') reason = 'next asks now live on Today, not as tasks';
    if (!reason && kind === 'Promise' && rid && made && (lastOut.get(rid) || '') > made) reason = 'you have written to them since the promise; reopen if it is still owed';
    if (!reason && t.due && t.due < addDays(t0, -21)) reason = 'more than 3 weeks overdue; closed by sweep, reopen if it still matters';
    if (reason) { await updateEntity('decision', t.id, cur => ({ ...cur, status: 'Done', doneAt: new Date().toISOString(), doneBy: 'Engine', notes: `${cur.notes || ''}\nClosed by sweep: ${reason}.`.trim() })); closed.push(`${t.title} (${reason})`); }
  }
  const overdue = open.filter(t => t.due && t.due < t0 && !closed.some(c => c.startsWith(t.title))).map(t => ({ id: t.id, title: t.title, owner: t.owner, due: t.due, daysLate: Math.round((Date.parse(t0) - Date.parse(t.due)) / DAY), label: t.source?.label || '' }));
  return { closed, overdue, line: overdue.length ? `Overdue: ${overdue.length} (oldest ${overdue[0].daysLate}d: ${overdue[0].title.slice(0, 60)})` : 'Overdue: none' };
}
