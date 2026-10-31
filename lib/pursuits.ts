// Pursuits (named, payable pieces of work in five lanes) and People (who we meet, how often).
// Pursuits are stored in the 'work' scope with kind 'pursuit' so no migration is needed;
// the older engine ignores them (see listWork in bd-store).
import '../public/vanor-pursuits.js';
import { findByEmail, getOne, listScope, updateEntity, type Entity } from './bd-store';
import { today } from './bd-logic';

const V = (globalThis as any).VanorPursuits;
export const PURSUIT_RULES = { lanes: V.LANES, states: V.STATES, closed: V.CLOSED, gate: V.GATE, rungs: V.RUNGS, buying: V.BUYING };

const slug = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const FIELDS = ['name', 'lane', 'state', 'atStake', 'amount', 'type', 'invoicedOn', 'lostReason', 'latest', 'nextAction', 'owner', 'dueBy', 'org', 'person', 'email', 'recordId', 'source', 'notes'] as const;
// Money and outcome decisions belong to the founders: Claude never sets them, new or existing (31 Oct 2026).
const FOUNDER_ONLY = ['invoicedOn', 'lostReason'] as const;
const CLAUDE_NEW_PER_DAY = 5;

export type PursuitInput = {
  id?: string; name?: string; lane?: string; state?: string; atStake?: string; latest?: string; nextAction?: string;
  owner?: string; dueBy?: string; org?: string; person?: string; email?: string; recordId?: string; source?: string; notes?: string;
  amount?: number; type?: string; invoicedOn?: string; lostReason?: string;
  gate?: { asset?: boolean; problem?: boolean; capital?: boolean; route?: boolean };
};

export async function listPursuits({ lane = 'all', includeClosed = false }: { lane?: string; includeClosed?: boolean } = {}) {
  const all = (await listScope('work')).filter(V.isPursuit);
  const t = today();
  const b = V.board(all, { lane, today: t });
  const strip = (p: Entity) => ({ id: p.id, name: p.name, lane: V.laneOf(p), state: V.stateOf(p), atStake: p.atStake || '', latest: p.latest || '',
    nextAction: p.nextAction || '', owner: p.owner || '', dueBy: p.dueBy || '', late: !!(p.dueBy && p.dueBy < t), org: p.org || '', person: p.person || '',
    email: p.email || '', recordId: p.recordId || '', gateMissing: V.gateMissing(p), amount: p.amount ?? null, type: p.type || 'one-off', invoicedOn: p.invoicedOn || '', stale: V.stale(p, t), proposed: V.liveProposal(p, t) ? p.proposed : null });
  return {
    today: t, total: b.total, onTable: b.onTable, onTableMonthly: b.onTableMonthly, overdue: b.overdue, stale: b.stale, counts: b.counts, money: V.money(all, t),
    byState: Object.fromEntries(Object.entries(b.by).map(([k, rows]) => [k, (rows as Entity[]).map(strip)])),
    closed: includeClosed ? all.filter((p: Entity) => V.CLOSED.includes(p.state) || p.archived).map(strip) : undefined,
  };
}

/** Create or update pursuits. Matches by id, else by name. Rejects anything the four-condition rule forbids. */
export async function savePursuits(items: PursuitInput[], actor = 'Claude') {
  const existing = (await listScope('work')).filter(V.isPursuit);
  const byName = new Map(existing.map((p: Entity) => [String(p.name).toLowerCase(), p]));
  const saved: string[] = [], rejected: { name: string; reason: string }[] = [];
  const todayIso = today();
  const londonDay = (iso: unknown) => iso ? new Date(String(iso)).toLocaleDateString('en-CA', { timeZone: 'Europe/London' }) : '';
  let madeToday = existing.filter((p: Entity) => p.createdBy === 'Claude' && londonDay(p.createdAt) === todayIso).length;
  for (const item of items) {
    let prior = item.id ? existing.find((p: Entity) => p.id === item.id) : byName.get(String(item.name || '').toLowerCase());
    const id = prior?.id || item.id || 'pursuit:' + slug(item.name || crypto.randomUUID());
    if (!prior) {
      // A near-identical name (dash, spacing, full stop) slugs to an existing id: that is an update, not a new pursuit.
      prior = existing.find((p: Entity) => p.id === id);
      // An id that already belongs to a non-pursuit row must never be taken over.
      if (!prior && (!id.startsWith('pursuit:') || await getOne('work', id))) { rejected.push({ name: item.name || id, reason: 'That id is not free for a new pursuit.' }); continue; }
    }
    if (!prior && actor === 'Claude') {
      if (!String(item.source || '').trim()) { rejected.push({ name: item.name || id, reason: 'A pursuit Claude creates needs source: the quote or link that shows it exists.' }); continue; }
      if (madeToday >= CLAUDE_NEW_PER_DAY) { rejected.push({ name: item.name || id, reason: `Claude may create at most ${CLAUDE_NEW_PER_DAY} pursuits a day; the founders decide the rest.` }); continue; }
    }
    const patch: Entity = { id };
    for (const k of FIELDS) if (item[k] !== undefined) patch[k] = item[k];
    if (actor === 'Claude') for (const k of FOUNDER_ONLY) delete patch[k];
    if (!prior) { patch.createdAt = new Date().toISOString(); patch.createdBy = actor; }
    if (item.gate) patch.gate = { ...(prior?.gate || {}), ...item.gate };
    // Claude may create pursuits and refresh facts, but on an existing pursuit the founder owns
    // state, next action, date and owner: Claude's view of those goes through proposeNext.
    if (prior && actor === 'Claude') for (const k of ['state', 'nextAction', 'dueBy', 'owner'] as const) delete patch[k];
    if (!prior && actor === 'Claude') { patch.state = 'watch'; delete patch.nextAction; }
    const merged: Entity = { ...(prior || {}), ...patch, kind: 'pursuit' };
    const why = V.validate(merged);
    if (why) { rejected.push({ name: item.name || id, reason: why }); continue; }
    await updateEntity('work', id, cur => {
      const changes = FIELDS.filter(k => patch[k] !== undefined && patch[k] !== cur[k]).map(k => `${k}: ${String(patch[k]).slice(0, 80)}`);
      const history = [{ at: new Date().toISOString(), by: actor, change: prior ? changes.join('; ') || 'no change' : 'created' }, ...((cur.history as unknown[]) || [])].slice(0, 30);
      // A founder edit to the next action or date settles any proposal.
      const proposed = (patch.nextAction !== undefined || patch.dueBy !== undefined || patch.state !== undefined) && actor !== 'Claude' ? null : cur.proposed || null;
      return { ...cur, ...patch, kind: 'pursuit', archived: V.CLOSED.includes(merged.state) ? true : false, proposed, history, updatedAt: new Date().toISOString(), updatedBy: actor, ...(actor !== 'Claude' ? { founderTouchedAt: new Date().toISOString() } : {}) };
    }, true);
    saved.push(id);
    if (!prior && actor === 'Claude') madeToday++;
  }
  return { saved, rejected };
}

/** Claude proposes the next move; the board shows it with an Accept button. It never overwrites the founder's action. */
export async function proposeNext(id: string, p: { nextAction: string; dueBy?: string; state?: string; latest?: string; why: string }) {
  const cur = await getOne('work', id);
  if (!cur || !V.isPursuit(cur)) throw new Error('No pursuit with id ' + id);
  if (p.state && !V.STATE[p.state] && !V.CLOSED.includes(p.state)) throw new Error('Unknown state ' + p.state);
  await updateEntity('work', id, c => ({ ...c, latest: p.latest || c.latest, proposed: { ...p, at: new Date().toISOString() } }));
  return { id, proposed: p };
}

// ---------- People ----------
type Met = { email?: string; name?: string; date: string; note?: string; lane?: string; rung?: string; buyingStage?: string; eventId?: string };

/** Exact email match only. A name alone is never enough to say someone was met (a wrong match hides the people we most need to chase). */
async function resolveByEmail(m: Met): Promise<Entity | null> {
  if (!m.email) return null;
  const hits = await findByEmail(m.email);
  return hits.length === 1 ? hits[0] : null;
}

/** Record meetings that have happened. Auto-records only on an exact email match, a past date and an unseen calendar event id.
 *  Everything else comes back in toConfirm for a founder to decide. */
export async function recordMeetings(meetings: Met[]) {
  const matched: string[] = [], unmatched: string[] = [], toConfirm: { who: string; date: string; why: string }[] = [], skipped: string[] = [];
  const t = today();
  for (const m of meetings) {
    const who = m.email || m.name || '?';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date) || Number.isNaN(Date.parse(m.date)) || m.date >= t) { toConfirm.push({ who, date: m.date, why: 'Date is today, in the future or invalid; a meeting counts once the day has passed. Nothing recorded.' }); continue; }
    const r = await resolveByEmail(m);
    if (!r) {
      if (m.email) unmatched.push(m.email);
      else toConfirm.push({ who, date: m.date, why: 'No email on the calendar event; a name alone is not enough to mark someone as met.' });
      continue;
    }
    let dup = false;
    await updateEntity('decision', r.id, d => {
      const seen = (d.metEvents as string[]) || [];
      if (m.eventId && seen.includes(m.eventId)) { dup = true; return d; }
      const dates = [...new Set([...(d.metDates as string[] || []), m.date])].sort().slice(-12);
      const next: Entity = { ...d, metDates: dates, lastMet: dates[dates.length - 1], metCount: dates.length, metSource: 'calendar' };
      if (m.eventId) next.metEvents = [...seen, m.eventId].slice(-30);
      if (m.note && m.date >= String(d.lastNoteDate || '')) { next.lastNote = m.note; next.lastNoteDate = m.date; }
      if (m.rung && V.RUNG[m.rung]) next.rung = m.rung;
      if (m.lane && V.LANE[m.lane]) next.lane = m.lane;
      return next;
    }, true);
    if (dup) skipped.push(who); else matched.push(r.id);
  }
  return { matched: matched.length, alreadyRecorded: skipped.length, unmatched, toConfirm };
}

export async function setPerson(id: string, p: { rung?: string; lane?: string; lastNote?: string; buyingStage?: string; lastMet?: string; inHousePM?: string }) {
  if (p.lastMet && (!/^\d{4}-\d{2}-\d{2}$/.test(p.lastMet) || p.lastMet > today())) throw new Error('lastMet cannot be in the future');
  if (p.inHousePM && !V.IN_HOUSE.includes(p.inHousePM)) throw new Error('inHousePM must be yes, no or unknown');
  if (p.rung && !V.RUNG[p.rung]) throw new Error('Unknown rung ' + p.rung);
  if (p.lane && !V.LANE[p.lane]) throw new Error('Unknown lane ' + p.lane);
  if (p.buyingStage && !V.BUYING.includes(p.buyingStage)) throw new Error('Unknown buying stage ' + p.buyingStage);
  await updateEntity('decision', id, d => {
    const next: Entity = { ...d };
    for (const k of ['rung', 'lane', 'buyingStage', 'inHousePM'] as const) if (p[k]) next[k] = p[k];
    if (p.rung === 'target' && !d.targetSince) next.targetSince = today();
    if (p.lastNote) { next.lastNote = p.lastNote; next.lastNoteDate = today(); }
    if (p.lastMet) { const dates = [...new Set([...(d.metDates as string[] || []), p.lastMet])].sort().slice(-12); next.metDates = dates; next.lastMet = dates[dates.length - 1]; next.metCount = dates.length; }
    return next;
  }, true);
  return { id, ...p };
}

/** People on a rung or with a meeting on record, with next meeting due. Overdue first. */
export async function peopleDue({ limit = 20, onlyDue = true }: { limit?: number; onlyDue?: boolean } = {}) {
  const [records, decisions] = await Promise.all([listScope('source'), listScope('decision')]);
  const dm = new Map(decisions.map(d => [d.id, d]));
  const t = today();
  const rows = records.map(r => ({ r, d: dm.get(r.id) || {} as Entity })).filter(x => (x.d.rung || x.d.lastMet) && x.d.status !== 'Archive' && !/@vanoradvisory\.co\.uk$/i.test(String(x.r.email || ''))).map(({ r, d }) => {
    const s = V.meetingStatus(d, t);
    return { id: r.id, name: r.name, company: r.company, email: r.email || '', rung: d.rung || 'contact', lane: d.lane || '', lastMet: d.lastMet || '', metCount: d.metCount || 0, lastNote: d.lastNote || '', buyingStage: d.buyingStage || '', nextMeeting: s.next, overdueDays: s.overdue ? -s.days : 0, due: s.overdue || s.dueSoon };
  });
  const order = (k: string) => V.RUNGS.findIndex((x: { key: string }) => x.key === k);
  rows.sort((a, b) => b.overdueDays - a.overdueDays || order(a.rung) - order(b.rung) || a.nextMeeting.localeCompare(b.nextMeeting));
  const list = onlyDue ? rows.filter(r => r.due) : rows;
  return { today: t, total: rows.length, due: rows.filter(r => r.due).length, rows: list.slice(0, limit) };
}
