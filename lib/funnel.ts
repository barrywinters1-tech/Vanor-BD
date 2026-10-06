// Closed-loop outcome tracking: what we sent, who replied, what got booked. Lets the board show a funnel and learn which triggers work.
import { listScope, getOne, logEvent, updateEntity, type Entity } from './bd-store';
import { priorityList } from './priority';

export { STEPS, STEP_LABEL, stepOf, type Step } from './funnel-logic';
import { STEPS, stepOf, type Step } from './funnel-logic';
const TYPE_PREFIX = 'Outcome: ';
const DAY = 864e5;
export type Outcome = { id: string; step: Step; date: string; ref?: string; trigger?: string; channel?: string; note: string; source?: string };
const when = (e: Entity) => String(e.happenedOn || e.date || e.at || '').slice(0, 10);

/** Idempotent: the same Outlook message or calendar event is never counted twice. */
export async function logOutcome(o: Omit<Outcome, 'id'> & { id: string }) {
  if (!await getOne('source', o.id)) throw new Error(`No contact with id ${o.id}.`);
  if (o.ref) {
    const dup = (await listScope('event')).find(e => e.ref === o.ref && stepOf(e) === o.step);
    if (dup) return { logged: false, reason: 'Already recorded', eventId: dup.id };
  }
  await updateEntity('source', o.id, r => (!r.lastContact || String(r.lastContact).slice(0, 10) < o.date) ? { ...r, lastContact: o.date } : r);
  const eventId = await logEvent({ entityId: o.id, recordId: o.id, type: TYPE_PREFIX + o.step, note: o.note, date: o.date,
    ref: o.ref || '', trigger: o.trigger || '', channel: o.channel || 'email', source: o.source || '' });
  return { logged: true, eventId };
}

export type Funnel = {
  days: number; since: string;
  counts: Record<Step, number>; contacts: Record<Step, number>;
  rates: { replyRate: number | null; meetingRate: number | null };
  byTrigger: Array<{ trigger: string; sent: number; replies: number; meetings: number; replyRate: number | null }>;
  byCell: Array<{ cell: string; sent: number; replies: number; meetings: number; replyRate: number | null }>;
  recent: Array<{ step: Step; date: string; name: string; company: string; note: string }>;
};

const pct = (n: number, d: number) => d ? Math.round((100 * n) / d) : null;

export async function funnel({ days = 30 }: { days?: number } = {}): Promise<Funnel> {
  const since = new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
  const [events, sources, prio] = await Promise.all([listScope('event'), listScope('source'), priorityList({ cell: 'All', limit: 5000 })]);
  const byId = new Map(sources.map(s => [s.id, s]));
  const cellOf = new Map<string, string>((prio.rows || []).map((x: any) => [x.id, x.cell]));
  const rows = events.map(e => ({ e, step: stepOf(e), date: when(e) })).filter(x => x.step && x.date >= since) as Array<{ e: Entity; step: Step; date: string }>;

  const counts = Object.fromEntries(STEPS.map(s => [s, 0])) as Record<Step, number>;
  const people = Object.fromEntries(STEPS.map(s => [s, new Set<string>()])) as Record<Step, Set<string>>;
  const trig = new Map<string, { sent: Set<string>; replies: Set<string>; meetings: Set<string> }>();
  const cells = new Map<string, { sent: Set<string>; replies: Set<string>; meetings: Set<string> }>();
  const bucket = (m: Map<string, any>, k: string) => m.get(k) || m.set(k, { sent: new Set(), replies: new Set(), meetings: new Set() }).get(k);

  for (const { e, step } of rows) {
    const rid = String(e.recordId || e.entityId);
    counts[step]++; people[step].add(rid);
    const r = byId.get(rid);
    const trigger = String(e.trigger || (r?.companyIntel?.signals?.[0]?.type) || (r?.origin === 'intel' ? 'scan' : 'none'));
    const cell = cellOf.get(rid) || '?';
    for (const b of [bucket(trig, trigger), bucket(cells, cell)]) {
      if (step === 'sent') b.sent.add(rid);
      if (step === 'reply') b.replies.add(rid);
      if (step === 'meeting_booked' || step === 'meeting_held') b.meetings.add(rid);
    }
  }
  const table = (m: Map<string, any>, key: 'trigger' | 'cell') => [...m.entries()].map(([k, b]) => ({ [key]: k, sent: b.sent.size, replies: b.replies.size, meetings: b.meetings.size, replyRate: pct(b.replies.size, b.sent.size) }))
    .sort((a, b) => b.sent - a.sent) as any;
  const contacts = Object.fromEntries(STEPS.map(s => [s, people[s].size])) as Record<Step, number>;
  const recent = rows.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 25).map(({ e, step, date }) => {
    const r = byId.get(String(e.recordId || e.entityId));
    return { step, date, name: r?.name || '', company: r?.company || '', note: String(e.note || '').slice(0, 160) };
  });
  return {
    days, since, counts, contacts,
    rates: { replyRate: pct(contacts.reply, contacts.sent), meetingRate: pct(contacts.meeting_booked + contacts.meeting_held, contacts.sent) },
    byTrigger: table(trig, 'trigger'), byCell: table(cells, 'cell'), recent,
  };
}
