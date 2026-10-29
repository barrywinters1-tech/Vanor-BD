// Closed-loop outcome tracking: what we sent, who replied, what got booked. Lets the board show a funnel and learn which triggers work.
import { followUpAfter } from './pursuit-logic';
import { listScope, getOne, logEvent, updateEntity, type Entity } from './bd-store';
import { priorityList } from './priority';

export { STEPS, STEP_LABEL, stepOf, type Step } from './funnel-logic';
import { STEPS, stepOf, lessons, type Step } from './funnel-logic';
const TYPE_PREFIX = 'Outcome: ';
const DAY = 864e5;
export type Outcome = { id: string; step: Step; date: string; ref?: string; trigger?: string; channel?: string; note: string; source?: string };
const when = (e: Entity) => String(e.happenedOn || e.date || e.at || '').slice(0, 10);

/** Idempotent: the same Outlook message or calendar event is never counted twice. */
export async function logOutcome(o: Omit<Outcome, 'id'> & { id: string }) {
  if (!await getOne('source', o.id)) throw new Error(`No contact with id ${o.id}.`);
  const existing = await listScope('event');
  if (o.ref) {
    const dup = existing.find(e => e.ref === o.ref && stepOf(e) === o.step);
    if (dup) return { logged: false, reason: 'Already recorded', eventId: dup.id };
  }
  if (o.step === 'sent') { const same = existing.find(e => String(e.recordId || e.entityId) === o.id && stepOf(e) === 'sent' && String(e.happenedOn || e.date || e.at || '').slice(0, 10) === o.date); if (same) { await syncPursuit(o); return { logged: false, reason: 'An email to this contact is already recorded for that day', eventId: same.id }; } }
  await updateEntity('source', o.id, r => (!r.lastContact || String(r.lastContact).slice(0, 10) < o.date) ? { ...r, lastContact: o.date } : r);
  const eventId = await logEvent({ entityId: o.id, recordId: o.id, type: TYPE_PREFIX + o.step, note: o.note, date: o.date,
    ref: o.ref || '', trigger: o.trigger || '', channel: o.channel || 'email', source: o.source || '' });
  // Keep the founders' pursuit step in line with what the mailbox shows: a reply, meeting or proposal moves the lead on and stops the follow-up clock; a sent email starts it.
  await syncPursuit(o);
  return { logged: true, eventId };
}

const PURSUIT_STEP: Record<string, string> = { sent: 'sent', reply: 'replied', meeting_booked: 'meeting', proposal: 'proposal', won: 'won' };
const ORDER = ['to_write', 'sent', 'replied', 'meeting', 'proposal', 'won'];
/** Keep decision.pursuit in line with the mailbox. A sent email to a contact nobody has triaged starts a pursuit (triage yes) so the follow-up clock runs for it too. */
async function syncPursuit(o: { id: string; step: string; date: string }) {
  const next = PURSUIT_STEP[o.step];
  if (next) await updateEntity('decision', o.id, cur => {
    let pu = cur.pursuit;
    if (!pu && next === 'sent' && cur.status !== 'Archive') pu = { triage: 'yes', triagedAt: new Date().toISOString(), triagedBy: 'Engine', reason: 'Email sent from Outlook', step: 'to_write', stepAt: new Date().toISOString() };
    if (!pu || pu.triage !== 'yes' || pu.step === 'lost') return cur;
    if (next === 'sent') { if (pu.step !== 'to_write' && pu.step !== 'sent') return cur; const chases = pu.sentAt && pu.sentAt !== o.date ? (pu.chases || 0) + 1 : (pu.chases || 0); return { ...cur, pursuit: { ...pu, step: 'sent', stepAt: new Date().toISOString(), sentAt: o.date, chases, followUpAt: followUpAfter(o.date, chases) } }; }
    if (ORDER.indexOf(next) <= ORDER.indexOf(pu.step || 'to_write')) return cur;
    return { ...cur, pursuit: { ...pu, step: next, stepAt: new Date().toISOString(), followUpAt: undefined } };
  });
}

export type Funnel = {
  days: number; since: string;
  counts: Record<Step, number>; contacts: Record<Step, number>;
  rates: { replyRate: number | null; meetingRate: number | null };
  byTrigger: Array<{ trigger: string; sent: number; replies: number; meetings: number; replyRate: number | null }>;
  byCell: Array<{ cell: string; sent: number; replies: number; meetings: number; replyRate: number | null }>;
  byTemplate: Array<{ template: string; sent: number; replies: number; meetings: number; replyRate: number | null }>;
  learn: string[];
  recent: Array<{ step: Step; date: string; name: string; company: string; note: string }>;
};

const pct = (n: number, d: number) => d ? Math.round((100 * n) / d) : null;

export async function funnel({ days = 30 }: { days?: number } = {}): Promise<Funnel> {
  const since = new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
  const [events, sources, decisions, prio] = await Promise.all([listScope('event'), listScope('source'), listScope('decision'), priorityList({ cell: 'All', limit: 5000 })]);
  const byId = new Map(sources.map(s => [s.id, s]));
  const histOf = new Map<string, Array<{ template: string; pushedAt: string }>>(decisions.filter(d => Array.isArray(d.draftHistory)).map(d => [d.id, d.draftHistory]));
  // The template responsible for an outcome: the last one pushed to Outlook on or before that date (within 45 days).
  const templateFor = (rid: string, date: string) => { const h = (histOf.get(rid) || []).filter(x => String(x.pushedAt).slice(0, 10) <= date && Date.parse(date) - Date.parse(x.pushedAt) < 45 * DAY); return h.length ? h[h.length - 1].template : null; };
  const cellOf = new Map<string, string>((prio.rows || []).map((x: any) => [x.id, x.cell]));
  const rows = events.map(e => ({ e, step: stepOf(e), date: when(e) })).filter(x => x.step && x.date >= since) as Array<{ e: Entity; step: Step; date: string }>;

  const counts = Object.fromEntries(STEPS.map(s => [s, 0])) as Record<Step, number>;
  const people = Object.fromEntries(STEPS.map(s => [s, new Set<string>()])) as Record<Step, Set<string>>;
  const trig = new Map<string, { sent: Set<string>; replies: Set<string>; meetings: Set<string> }>();
  const cells = new Map<string, { sent: Set<string>; replies: Set<string>; meetings: Set<string> }>();
  const tmpl = new Map<string, { sent: Set<string>; replies: Set<string>; meetings: Set<string> }>();
  const bucket = (m: Map<string, any>, k: string) => m.get(k) || m.set(k, { sent: new Set(), replies: new Set(), meetings: new Set() }).get(k);

  for (const { e, step, date } of rows) {
    const rid = String(e.recordId || e.entityId);
    counts[step]++; people[step].add(rid);
    const r = byId.get(rid);
    const trigger = String(e.trigger || (r?.companyIntel?.signals?.[0]?.type) || (r?.origin === 'intel' ? 'scan' : 'none'));
    const cell = cellOf.get(rid) || '?';
    const t = templateFor(rid, date);
    for (const b of [bucket(trig, trigger), bucket(cells, cell), ...(t ? [bucket(tmpl, t)] : [])]) {
      if (step === 'sent') b.sent.add(rid);
      if (step === 'reply') b.replies.add(rid);
      if (step === 'meeting_booked' || step === 'meeting_held') b.meetings.add(rid);
    }
  }
  const table = (m: Map<string, any>, key: 'trigger' | 'cell' | 'template') => [...m.entries()].map(([k, b]) => ({ [key]: k, sent: b.sent.size, replies: b.replies.size, meetings: b.meetings.size, replyRate: pct(b.replies.size, b.sent.size) }))
    .sort((a, b) => b.sent - a.sent) as any;
  const contacts = Object.fromEntries(STEPS.map(s => [s, people[s].size])) as Record<Step, number>;
  const recent = rows.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 25).map(({ e, step, date }) => {
    const r = byId.get(String(e.recordId || e.entityId));
    return { step, date, name: r?.name || '', company: r?.company || '', note: String(e.note || '').slice(0, 160) };
  });
  const byTemplate = table(tmpl, 'template') as Funnel['byTemplate'];
  return {
    days, since, counts, contacts,
    rates: { replyRate: pct(contacts.reply, contacts.sent), meetingRate: pct(contacts.meeting_booked + contacts.meeting_held, contacts.sent) },
    byTrigger: table(trig, 'trigger'), byCell: table(cells, 'cell'), byTemplate, learn: lessons(byTemplate, table(trig, 'trigger')), recent,
  };
}

