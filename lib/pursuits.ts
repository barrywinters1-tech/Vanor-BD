// Pursuits (named, payable pieces of work in five lanes) and People (who we meet, how often).
// Pursuits are stored in the 'work' scope with kind 'pursuit' so no migration is needed;
// the older engine ignores them (see listWork in bd-store).
import '../public/vanor-pursuits.js';
import { findByEmail, getOne, listScope, updateEntity, logEvent, type Entity } from './bd-store';
import { today } from './bd-logic';
import { TRADE_KEYS } from './trades';

const V = (globalThis as any).VanorPursuits;
export const PURSUIT_RULES = { lanes: V.LANES, states: V.STATES, closed: V.CLOSED, gate: V.GATE, rungs: V.RUNGS, buying: V.BUYING };

const slug = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const FIELDS = ['name', 'lane', 'state', 'atStake', 'amount', 'type', 'invoicedOn', 'lostReason', 'issuedOn', 'validUntil', 'decisionDate', 'chaseOn', 'outcome', 'contract', 'energisedBy', 'capital', 'keyContractors', 'latest', 'nextAction', 'owner', 'dueBy', 'org', 'person', 'email', 'recordId', 'source', 'notes'] as const;
// Money and outcome decisions belong to the founders: Claude never sets them, new or existing (31 Oct 2026).
const FOUNDER_ONLY = ['invoicedOn', 'lostReason', 'outcome', 'contract'] as const;
const CLAUDE_NEW_PER_DAY = 5;

export type PursuitInput = {
  id?: string; name?: string; lane?: string; state?: string; atStake?: string; latest?: string; nextAction?: string;
  owner?: string; dueBy?: string; org?: string; person?: string; email?: string; recordId?: string; source?: string; notes?: string;
  amount?: number; type?: string; invoicedOn?: string; lostReason?: string;
  issuedOn?: string; validUntil?: string; decisionDate?: string; chaseOn?: string; outcome?: string; contract?: Record<string, boolean>;
  energisedBy?: string; capital?: string; keyContractors?: string;
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
    // A new Claude pursuit starts in Watch; it keeps the next step Claude found (18 Nov 2026: an empty next step helped no one).
    if (!prior && actor === 'Claude') patch.state = 'watch';
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

/** Claude's view of the next move (18 Nov 2026).
 *  Always: a requested change to table, won, lost or parked is never applied; it is kept as an ask that the board shows as
 *  a "Decide" row, and only a partner's Yes applies it.
 *  Propose mode (default): the update waits as a proposal, as before.
 *  Direct mode (a partner switches it on from the board; setting:apply-direct): a narrow, reversible update is applied at
 *  once: only nextAction, dueBy, latest and the moves watch->act, act->waiting, waiting->act. Every check runs inside the
 *  write on the current revision. Refused (falls back to a proposal) for a pursuit on the table, closed or priced
 *  (issuedOn, decisionDate, validUntil or amount), when a partner edited it after the evidence date, and beyond
 *  DIRECT_PER_DAY a day. The previous values are kept in claudePrev for Undo, with a history line and a log event. */
export const DIRECT_PER_DAY = 10;
const ALLOWED_MOVES: Record<string, string[]> = { watch: ['act'], act: ['waiting'], waiting: ['act'] };
const priced = (c: Entity) => !!(c.issuedOn || c.decisionDate || c.validUntil || (c.amount !== undefined && c.amount !== null && c.amount !== ''));
export async function directMode() { const s = await getOne('work', 'setting:apply-direct'); return !!(s && s.on === true); }
const londonDay = (iso: unknown) => iso ? new Date(String(iso)).toLocaleDateString('en-CA', { timeZone: 'Europe/London' }) : '';

export async function proposeNext(id: string, p: { nextAction: string; dueBy?: string; state?: string; latest?: string; why: string; evidenceOn?: string }) {
  const first = await getOne('work', id);
  if (!first || !V.isPursuit(first)) throw new Error('No pursuit with id ' + id);
  if (p.state && !V.STATE[p.state] && !V.CLOSED.includes(p.state)) throw new Error('Unknown state ' + p.state);
  if (p.evidenceOn && !/^\d{4}-\d{2}-\d{2}/.test(p.evidenceOn)) throw new Error('evidenceOn must be a date');
  const now = new Date().toISOString();
  const direct = await directMode();
  const doneToday = direct ? (await listScope('work')).filter(w => V.isPursuit(w) && w.claudePrev && londonDay(w.claudePrev.at) === today()).length : 0;
  let outcome: { mode: 'ask' | 'proposed' | 'applied'; note: string } = { mode: 'proposed', note: '' };
  await updateEntity('work', id, c => {
    const cur = V.stateOf(c);
    const q: Record<string, any> = { ...p }; delete q.evidenceOn;
    if (q.state === cur) delete q.state;
    // Founder-only states become an ask: shown as a Decide row, applied only by a partner's Yes.
    let ask: Record<string, unknown> | null = null;
    if (q.state && (V.CLOSED.includes(q.state) || q.state === 'table')) { ask = { state: q.state, why: p.why, at: now }; delete q.state; }
    else if (q.state && cur === 'table') { delete q.state; outcome.note = 'State change dropped: a pursuit with a proposal out stays on the table until a partner decides.'; }
    if (ask) outcome = { mode: 'ask', note: `Asked the partners to decide: ${ask.state}.` };
    const evidence = p.evidenceOn || now.slice(0, 10);
    const founderNewer = !!(c.founderTouchedAt && String(c.founderTouchedAt).slice(0, 10) > evidence);
    const nextState = q.state || cur;
    const valid = !V.validate({ ...c, state: nextState, nextAction: q.nextAction || c.nextAction });
    const moveOk = !q.state || (ALLOWED_MOVES[cur] || []).includes(q.state);
    // Direct needs the date of the evidence (so a partner's later edit always wins) and a record that stays valid.
    const canApply = direct && !!p.evidenceOn && !ask && !V.CLOSED.includes(cur) && cur !== 'table' && !priced(c) && !founderNewer && moveOk && valid && doneToday < DIRECT_PER_DAY;
    if (!canApply) {
      if (!ask && direct) outcome.note = outcome.note || (!p.evidenceOn ? 'Kept as a proposal: no evidence date given.' : founderNewer ? 'Kept as a proposal: a partner edited this after the evidence.' : !valid ? 'Kept as a proposal: that move needs a partner (the pursuit is not qualified for it).' : priced(c) || cur === 'table' ? 'Kept as a proposal: priced pursuits are the partners\' to move.' : !moveOk ? `Kept as a proposal: ${cur} to ${q.state} is the partners' move.` : doneToday >= DIRECT_PER_DAY ? 'Kept as a proposal: daily limit for direct updates reached.' : '');
      const hasAction = !!(q.nextAction || q.dueBy || q.state);
      return { ...c, latest: q.latest || c.latest, proposed: hasAction ? { ...q, at: now } : c.proposed || null, ...(ask ? { ask } : {}) };
    }
    outcome = { mode: 'applied', note: 'Applied (Claude). Undo on the board for 14 days.' };
    // A second update on top of Claude's first keeps the partner's original values for Undo.
    const stillClaude = c.claudePrev && ['nextAction', 'dueBy', 'latest'].every(k => String(c[k] || '') === String(c.claudePrev.set?.[k] || '')) && cur === c.claudePrev.set?.state;
    const prev = stillClaude ? c.claudePrev.fields : { nextAction: c.nextAction || '', dueBy: c.dueBy || '', latest: c.latest || '', state: cur };
    const next = { nextAction: q.nextAction || c.nextAction || '', dueBy: q.dueBy || c.dueBy || '', latest: q.latest || c.latest || '', state: q.state || cur };
    const history = [{ at: now, by: 'Claude', change: `updated: ${next.nextAction}${q.dueBy ? ' by ' + q.dueBy : ''}${q.state ? '; ' + cur + ' -> ' + q.state : ''} (${String(p.why).slice(0, 120)})` }, ...((c.history as unknown[]) || [])].slice(0, 30);
    return { ...c, ...next, proposed: null, claudePrev: { fields: prev, set: next, at: now, why: p.why }, history, updatedAt: now, updatedBy: 'Claude' };
  });
  if (outcome.mode === 'applied') await logEvent({ entityId: id, type: 'Claude updated pursuit', note: `${p.nextAction} (${String(p.why).slice(0, 160)})` });
  return { id, mode: outcome.mode, note: outcome.note };
}

/** Undo Claude's last direct update. Only fields still holding Claude's values are restored, so a partner's later edit stays. */
export async function undoClaudeUpdate(id: string, actor: string) {
  let restored: string[] = [];
  await updateEntity('work', id, c => {
    const cp = c.claudePrev; if (!cp) return c;
    const back: Record<string, unknown> = {};
    for (const k of ['nextAction', 'dueBy', 'latest', 'state'] as const) if (String(V.stateOf && k === 'state' ? V.stateOf(c) : c[k] || '') === String(cp.set[k] || '')) back[k] = cp.fields[k];
    restored = Object.keys(back);
    const history = [{ at: new Date().toISOString(), by: actor, change: `undid Claude's update (${restored.join(', ') || 'nothing left to undo'})` }, ...((c.history as unknown[]) || [])].slice(0, 30);
    return { ...c, ...back, claudePrev: null, history, founderTouchedAt: new Date().toISOString(), updatedBy: actor };
  });
  if (restored.length) await logEvent({ entityId: id, type: 'Claude update undone', actor, note: restored.join(', ') });
  return { id, restored };
}

/** Park a pursuit on a founder's instruction (10 Nov 2026). Only Watch or Waiting with no proposal issued; table, act, won
 *  and lost are refused with the reason. History is kept (parkedFrom, parkedAt, the instruction); the board shows Unpark. */
export type ParkResult = { id: string; parked: boolean; from?: string; why?: string };
export async function parkPursuit(p: { id: string; instructedBy: 'Barry' | 'Graeme'; instruction: string; reason: string }): Promise<ParkResult> {
  const cur = await getOne('work', p.id);
  if (!cur || !V.isPursuit(cur)) throw new Error('No pursuit with id ' + p.id);
  if (!['Barry', 'Graeme'].includes(p.instructedBy)) throw new Error('instructedBy must be Barry or Graeme');
  const instruction = String(p.instruction || '').trim(), reason = String(p.reason || '').trim();
  if (instruction.length < 10) throw new Error('instruction must quote the founder\'s words (at least 10 characters)');
  if (reason.length < 5) throw new Error('reason is required');
  const state = V.stateOf(cur);
  const refuse = (why: string) => ({ id: p.id, parked: false, why });
  if (state === 'table') return refuse('a pursuit with a proposal out stays on the table until a founder marks it won, lost or parked on the board');
  if (state === 'act') return refuse('Act now pursuits are the founders\' live work; park it on the board if that is the decision');
  if (V.CLOSED.includes(state)) return refuse(`already ${state}; nothing to park`);
  if (state !== 'watch' && state !== 'waiting') return refuse(`only Watch or Waiting pursuits can be parked from here (this one is ${state})`);
  if (cur.issuedOn || cur.decisionDate || cur.validUntil) return refuse('a proposal has been issued on this pursuit; only a founder parks it, on the board');
  const at = new Date().toISOString();
  await updateEntity('work', p.id, c => ({ ...c, state: 'parked', parkedAt: at, parkedFrom: state, parkedBy: p.instructedBy, parkedVia: 'Claude', parkedInstruction: instruction.slice(0, 300), parkedReason: reason.slice(0, 200), parkedLatest: c.latest || '', proposed: null, latest: `${at.slice(0, 10)}: parked on ${p.instructedBy}'s instruction (${reason.slice(0, 120)})`, archived: true, updatedAt: at, updatedBy: 'Claude', history: [{ at, by: 'Claude', change: `parked from ${state} on ${p.instructedBy}'s instruction: "${instruction.slice(0, 120)}"` }, ...((c.history as unknown[]) || [])].slice(0, 30) }));
  await logEvent({ entityId: p.id, recordId: String(cur.recordId || ''), type: 'Pursuit parked', note: `${p.instructedBy}: "${instruction.slice(0, 160)}" (${reason.slice(0, 80)})`, actor: 'Claude' });
  return { id: p.id, parked: true, from: state };
}

// ---------- People ----------
type Met = { email?: string; name?: string; date: string; note?: string; lane?: string; rung?: string; buyingStage?: string; eventId?: string };

/** Exact email match only. A name alone is never enough to say someone was met (a wrong match hides the people we most need to chase). */
async function resolveByEmail(m: Met): Promise<Entity | null> {
  if (!m.email) return null;
  const hits = await findByEmail(m.email);
  if (hits.length <= 1) return hits[0] || null;
  // After a merge two records share an email: the one merged away does not count (18 Nov 2026).
  const live = [];
  for (const h of hits) { const d = await getOne('decision', h.id); if (!d?.mergedInto) live.push(h); }
  return live.length === 1 ? live[0] : null;
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
      if (m.lane && V.PEOPLE_LANE[m.lane]) next.lane = m.lane;
      return next;
    }, true);
    if (dup) skipped.push(who); else matched.push(r.id);
  }
  return { matched: matched.length, alreadyRecorded: skipped.length, unmatched, toConfirm };
}

export async function setPerson(id: string, p: { rung?: string; lane?: string; lastNote?: string; buyingStage?: string; lastMet?: string; inHousePM?: string; lastEmailed?: string; nextStep?: string; seqStep?: number; seqStarted?: string; seqTrigger?: string }) {
  if (p.seqStarted && (!/^\d{4}-\d{2}-\d{2}$/.test(p.seqStarted) || p.seqStarted > today())) throw new Error('seqStarted must be a past or today YYYY-MM-DD');
  if (p.lastEmailed && (!/^\d{4}-\d{2}-\d{2}$/.test(p.lastEmailed) || p.lastEmailed > today())) throw new Error('lastEmailed cannot be in the future');
  if (p.lastMet && (!/^\d{4}-\d{2}-\d{2}$/.test(p.lastMet) || p.lastMet > today())) throw new Error('lastMet cannot be in the future');
  if (p.inHousePM && !V.IN_HOUSE.includes(p.inHousePM)) throw new Error('inHousePM must be yes, no or unknown');
  if (p.rung && !V.RUNG[p.rung]) throw new Error('Unknown rung ' + p.rung);
  if (p.lane && !V.PEOPLE_LANE[p.lane]) throw new Error('Unknown lane ' + p.lane);
  if (p.buyingStage && !V.BUYING.includes(p.buyingStage)) throw new Error('Unknown buying stage ' + p.buyingStage);
  await updateEntity('decision', id, d => {
    const next: Entity = { ...d };
    for (const k of ['rung', 'lane', 'buyingStage', 'inHousePM'] as const) if (p[k]) next[k] = p[k];
    if (p.rung === 'target' && !d.targetSince) next.targetSince = today();
    if (p.lastNote) { next.lastNote = p.lastNote; next.lastNoteDate = today(); }
    if (p.lastEmailed && p.lastEmailed > String(d.lastEmailed || '')) next.lastEmailed = p.lastEmailed;
    if (p.nextStep) next.nextStep = p.nextStep;
    if (p.seqStep != null) next.seqStep = Math.max(0, Math.min(4, Math.round(p.seqStep)));
    if (p.seqStarted) next.seqStarted = p.seqStarted;
    if (p.seqTrigger) next.seqTrigger = p.seqTrigger.slice(0, 120);
    if (p.lastMet) { const dates = [...new Set([...(d.metDates as string[] || []), p.lastMet])].sort().slice(-12); next.metDates = dates; next.lastMet = dates[dates.length - 1]; next.metCount = dates.length; }
    return next;
  }, true);
  return { id, ...p };
}

// ---------- Relationships (18 Nov 2026) ----------
export type NextMove = { type: string; text: string; owner?: string; owes?: 'us' | 'them'; due: string };
export type PersonRel = { stage?: string; nextMove?: NextMove | null; trade?: string; tradeSuggested?: string; metBy?: string[]; evidenceOn?: string; why?: string; restoreArchived?: boolean };
const STAGE_ORDER = ['known', 'met', 'warm'];
/** Claude's relationship write for one person. Stage: Known, Met or Warm only (Proposal and Instructed come from work);
 *  never backwards except Warm -> Met after six months with no two-way contact. A next move a partner set after the
 *  evidence date is never overwritten. The old rung is kept in step so the old board and jobs keep working. */
export async function setRelationship(id: string, p: PersonRel, actor = 'Claude') {
  if (p.stage && !STAGE_ORDER.includes(p.stage)) throw new Error('Stage must be known, met or warm (proposal and instructed follow the work)');
  if (p.nextMove) {
    const m = p.nextMove;
    if (!V.NEXT_TYPE[m.type]) throw new Error('Next move type must be one of ' + Object.keys(V.NEXT_TYPE).join(', '));
    if (!m.text || m.text.length < 3) throw new Error('Next move needs a line of text');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.due || '')) throw new Error('Next move needs a due date (YYYY-MM-DD)');
    if (m.owes && !['us', 'them'].includes(m.owes)) throw new Error('owes must be us or them');
    if (m.owner && !['Barry', 'Graeme', 'Both'].includes(m.owner)) throw new Error('owner must be Barry, Graeme or Both');
  }
  if (p.trade && !TRADE_KEYS.includes(p.trade)) throw new Error('Unknown trade ' + p.trade);
  if (p.tradeSuggested && !TRADE_KEYS.includes(p.tradeSuggested)) throw new Error('Unknown trade ' + p.tradeSuggested);
  const evidence = p.evidenceOn || today();
  const notes: string[] = [];
  await updateEntity('decision', id, d => {
    const next: Entity = { ...d };
    const now = new Date().toISOString();
    if (p.restoreArchived && d.status === 'Archive') { next.status = ''; next.restoredAt = now; next.restoredBy = actor; notes.push('Restored from the archive.'); }
    if (p.stage) {
      const cur = V.stageOf(d);
      const back = STAGE_ORDER.indexOf(p.stage) < STAGE_ORDER.indexOf(cur);
      const last = V.lastContactOf(d);
      const silent = !last || V.daysBetween(last, today()) >= V.SILENT_DAYS;
      if (back && !(actor !== 'Claude' || (cur === 'warm' && p.stage === 'met' && silent))) notes.push(`Stage left at ${cur}: Claude only moves people forward (or Warm to Met after six months' silence).`);
      else if (p.stage !== cur) { next.stagePrev = { stage: cur, at: now, by: actor }; next.stage = p.stage; next.stageWhy = String(p.why || '').slice(0, 200); next.stageAt = now; }
    }
    if (p.nextMove !== undefined) {
      const cur = d.nextMove;
      const partnerNewer = cur && cur.setBy && cur.setBy !== 'Claude' && String(cur.setAt || '').slice(0, 10) >= evidence;
      if (actor === 'Claude' && partnerNewer) notes.push('Next move left as the partner set it after this evidence.');
      else if (p.nextMove === null) next.nextMove = null;
      else { next.nextMovePrev = cur || null; next.nextMove = { type: p.nextMove.type, text: p.nextMove.text.slice(0, 200), owner: p.nextMove.owner || d.owner || 'Barry', owes: p.nextMove.owes || 'us', due: p.nextMove.due, setBy: actor, setAt: now, why: String(p.why || '').slice(0, 200) }; next.nextStep = p.nextMove.text.slice(0, 160); }
    }
    if (p.tradeSuggested && !d.trade) next.tradeSuggested = p.tradeSuggested;
    if (p.trade) { if (actor === 'Claude' && d.trade && d.tradeBy && d.tradeBy !== 'Claude') notes.push('Trade left as the partner confirmed it.'); else { next.trade = p.trade; next.tradeBy = actor; } }
    if (p.metBy?.length) next.metBy = [...new Set([...(d.metBy as string[] || []), ...p.metBy.filter(x => ['Barry', 'Graeme'].includes(x))])];
    const stage = V.stageOf(next);
    const rung = V.rungFor(stage, V.introducerOf(next), d.rung || '');
    if (rung && rung !== d.rung) next.rung = rung;
    return next;
  }, true);
  return { id, note: notes.join(' ') };
}

/** One line of what we gave or received (proposal, introduction, referral, advice, lead, work), with counts on the person. */
export const GIVE_KINDS = ['proposal', 'introduction', 'referral', 'advice', 'lead', 'work', 'other'] as const;
export async function giveGet(id: string, p: { dir: 'gave' | 'received'; kind: string; note: string; date?: string }, actor = 'Claude') {
  if (!['gave', 'received'].includes(p.dir)) throw new Error('dir must be gave or received');
  if (!(GIVE_KINDS as readonly string[]).includes(p.kind)) throw new Error('kind must be one of ' + GIVE_KINDS.join(', '));
  if (!p.note || p.note.length < 5) throw new Error('note needs a few words');
  const date = p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : today();
  await updateEntity('decision', id, d => {
    const next: Entity = { ...d };
    const log = [{ dir: p.dir, kind: p.kind, note: p.note.slice(0, 200), date, by: actor }, ...((d.ledger as unknown[]) || [])].slice(0, 30);
    next.ledger = log;
    next.givenN = log.filter((x: any) => x.dir === 'gave').length;
    next.receivedN = log.filter((x: any) => x.dir === 'received').length;
    if (p.dir === 'received') { next.lastReceivedAt = date; if (['referral', 'lead', 'introduction', 'work'].includes(p.kind)) next.introducer = true; }
    return next;
  }, true);
  await logEvent({ entityId: id, recordId: id, type: p.dir === 'gave' ? 'We gave' : 'We received', actor, note: `${p.kind}: ${p.note}`.slice(0, 200) });
  return { id, ok: true };
}

/** People on a rung or with a meeting on record, with next meeting due. Overdue first. */
export async function peopleDue({ limit = 20, onlyDue = true, offset = 0 }: { limit?: number; onlyDue?: boolean; offset?: number } = {}) {
  const [records, decisions, work] = await Promise.all([listScope('source'), listScope('decision'), listScope('work')]);
  const dm = new Map(decisions.map(d => [d.id, d]));
  const onPursuit = new Set(work.filter(w => V.isPursuit(w) && V.isOpen(w) && w.recordId).map(w => w.recordId));
  const t = today();
  // Same rule as the board (followMode): partners, actives, referrers, anyone on a pursuit or met recently get individual
  // follow-ups; the rest are the pool, paced a few a week, so they never flood the strip or this list.
  const rows = records.map(r => ({ r, d: dm.get(r.id) || {} as Entity })).filter(x => (x.d.rung || x.d.lastMet) && x.d.status !== 'Archive' && !x.d.mergedInto && !/@vanoradvisory\.co\.uk$/i.test(String(x.r.email || ''))).map(({ r, d }) => {
    const s = V.meetingStatus(d, t);
    const mode = V.followMode(d, t, onPursuit.has(r.id));
    return { id: r.id, name: r.name, company: r.company, email: r.email || '', rung: d.rung || 'contact', lane: d.lane || '', lastMet: d.lastMet || '', metCount: d.metCount || 0, lastNote: d.lastNote || '', buyingStage: d.buyingStage || '', stage: V.stageOf(d), nextMove: d.nextMove || null, trade: d.trade || d.tradeSuggested || '', metBy: d.metBy || [], nextMeeting: s.next, overdueDays: s.overdue ? -s.days : 0, mode, due: mode === 'individual' && (s.overdue || s.dueSoon) };
  });
  const order = (k: string) => V.RUNGS.findIndex((x: { key: string }) => x.key === k);
  rows.sort((a, b) => b.overdueDays - a.overdueDays || order(a.rung) - order(b.rung) || a.nextMeeting.localeCompare(b.nextMeeting));
  const list = onlyDue ? rows.filter(r => r.due) : rows;
  return { today: t, total: rows.length, due: rows.filter(r => r.due).length, pool: rows.filter(r => r.mode === 'pool').length, offset, rows: list.slice(offset, offset + limit) };
}
