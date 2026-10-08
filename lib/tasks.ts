// Tasks: the obligations the engine and the founders create, in one list. Stored as decision entities with id 'task:<uuid>' (no schema change).
import { createHash } from 'node:crypto';
import { listScope, getOne, updateEntity, logEvent, type Entity } from './bd-store';

export type Task = { id: string; title: string; owner: string; due: string; status: 'Open' | 'Done' | 'Snoozed'; priority: 'High' | 'Normal' | 'Low'; source: { kind: 'record' | 'event' | 'draft' | 'proposal' | 'meeting' | 'manual' | 'engine'; id?: string; label?: string }; notes: string; createdBy: string; createdAt: string; doneAt?: string; doneBy?: string; snoozedUntil?: string; key?: string };
const DAY = 864e5;
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10);
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
    if (ask && due && due >= addDays(t0, -30) && due <= addDays(t0, 60))
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
