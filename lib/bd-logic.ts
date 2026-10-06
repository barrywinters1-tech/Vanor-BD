// Pure BD rules shared by the Claude connector. Mirrors VanorDomain in
// public/vanor-runtime.js (the board UI) so both read records the same way.
type Rec = Record<string, any>;

export const STAGES = ['Target', 'Relationship', 'Opportunity', 'Commercial', 'Won', 'Watch'] as const;
export const CONDITIONS = ['Aware', 'Understand', 'Interest', 'Respect', 'Trust', 'Able', 'Ready'] as const;
export type Condition = typeof CONDITIONS[number];

export const CONDITION_QUESTIONS: Record<Condition, string> = {
  Aware: 'Do they know Vanor exists?',
  Understand: 'Do they know when to call Vanor?',
  Interest: 'Does this address something they care about?',
  Respect: 'Do they believe our expertise is relevant?',
  Trust: 'Would they put important work in our hands?',
  Able: 'Can they appoint us, or get us to the buyer?',
  Ready: 'Is there a reason to act now?',
};

const clean = (v: unknown) => String(v == null ? '' : v).trim();

export function today(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const a = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${a.year}-${a.month}-${a.day}`;
}

export function addDays(date: string, n: number) {
  const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}

export const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T12:00:00Z').toISOString().slice(0, 10) === s;

/** Same fingerprint as the UI: a change here flips a reviewed contact to "Changed". */
export function sourceHash(r: Rec) {
  const omit = new Set(['raw', 'hash', 'priority', 'suggestedOwner', 'suggestedScores', 'suggestedBlocker', 'suggestedAction', 'suggestionOrigin', 'suggestedEvidence', 'fitScore', 'fitReason', 'fitSector', 'enrichment', 'assessedAt', 'updatedAt', '_rev', '_etag', '_spId']);
  return JSON.stringify(Object.fromEntries(Object.keys(r).filter(k => !omit.has(k)).sort().map(k => [k, r[k]])));
}

export function reviewStatus(r: Rec, d: Rec = {}, at = today()) {
  if (d.status === 'Archive') return 'Archive';
  if (d.status === 'Watch' && d.watchDate && d.watchDate <= at) return 'Revisit';
  if (!d.reviewedAt) return 'New';
  if (d.reviewedFingerprint && d.reviewedFingerprint !== sourceHash(r)) return 'Changed';
  return 'Reviewed';
}

export function attention(w: Rec, at = today()) {
  if (w.archived || w.stage === 'Won') return null;
  if (w.stage === 'Watch') {
    if (w.watchDate && w.watchDate <= at) return { rank: 1, label: 'Watch review due', date: w.watchDate };
    if (!w.watchDate) return { rank: 4, label: 'Set a Watch review date', date: '' };
    return null;
  }
  if (!w.confirmed) return { rank: 0, label: 'Confirm imported position', date: w.nextDate || '' };
  if (!w.owner) return { rank: 2, label: 'Choose an action lead', date: '' };
  if (!clean(w.nextAsk)) return { rank: 3, label: 'Agree the next ask', date: '' };
  if (!w.nextDate) return { rank: 5, label: 'Set the next action date', date: '' };
  if (w.nextDate < at) return { rank: 1, label: 'Next ask overdue', date: w.nextDate };
  if (w.nextDate === at) return { rank: 2, label: w.waiting ? 'Response check due' : 'Due today', date: w.nextDate };
  if (w.nextDate <= addDays(at, 7)) return { rank: 6, label: 'Coming up', date: w.nextDate };
  return null;
}

/** Evidence-weighted view of the 7 conditions: founder evidence beats Claude/imported suggestions. */
export function conditions(r: Rec, d: Rec = {}, w?: Rec) {
  return Object.fromEntries(CONDITIONS.map(k => {
    const own = w?.conditions?.[k] || d?.conditions?.[k];
    if (own) return [k, { score: Number(own.score || 0), note: own.note || '', origin: 'Founder evidence' }];
    return [k, { score: Number(r.suggestedScores?.[k] || 0), note: r.suggestedEvidence?.[k] || '', origin: r.suggestionOrigin || (r.suggestedScores ? 'Imported suggestion' : 'Not assessed') }];
  })) as Record<Condition, { score: number; note: string; origin: string }>;
}

/** The first condition below "evidenced" is the thing to work on next. */
export function constraint(conds: Record<Condition, { score: number }>) {
  return CONDITIONS.find(k => conds[k].score < 2) || null;
}

const STAGE_WEIGHT: Record<string, number> = { Commercial: 40, Opportunity: 30, Relationship: 15, Target: 5, Watch: 0, Won: 0 };

/**
 * Chase priority, 0-100. Answers Barry's three questions in order:
 * right buyer (fit), do they know/trust us (relationship), do they need us (need/timing).
 */
export function chaseScore(r: Rec, d: Rec = {}, w?: Rec) {
  const c = conditions(r, d, w);
  const relationship = (['Aware', 'Understand', 'Respect', 'Trust'] as Condition[]).reduce((s, k) => s + c[k].score, 0); // 0-8
  const need = (['Interest', 'Able', 'Ready'] as Condition[]).reduce((s, k) => s + c[k].score, 0); // 0-6
  const fit = Number(d.fitScore ?? r.fitScore ?? 1); // 0-2, set by Claude or a founder
  const stage = w ? STAGE_WEIGHT[w.stage] ?? 0 : 0;
  const score = Math.round(Math.min(100, stage + fit * 8 + relationship * 2.5 + need * 4));
  return { score, fit, relationship, need, stage: w?.stage || 'Not on board' };
}

export function contactSummary(r: Rec, d: Rec | null, works: Rec[], events: Rec[] = [], at = today()) {
  const decision = d || {};
  const active = works.filter(w => !w.archived).sort((a, b) => (STAGE_WEIGHT[b.stage] ?? 0) - (STAGE_WEIGHT[a.stage] ?? 0))[0];
  const conds = conditions(r, decision, active);
  return {
    id: r.id, kind: r.kind, name: r.name, company: r.company, jobTitle: r.jobTitle || '',
    email: r.email || '', phone: r.phone || '', linkedin: r.linkedin || '',
    segment: decision.segment || r.segment || '', service: decision.service || '',
    owner: active?.owner || decision.owner || r.sourceOwner || '',
    reviewStatus: reviewStatus(r, decision, at),
    board: active ? { workId: active.id, stage: active.stage, nextAsk: active.nextAsk || '', nextDate: active.nextDate || '',
      problem: active.problem || '', buyer: active.buyer || '', attention: attention(active, at)?.label || '' } : null,
    nextAsk: active?.nextAsk || decision.nextAsk || r.nextAsk || '',
    nextDate: active?.nextDate || decision.nextDate || r.nextDate || '',
    lastContact: r.lastContact || '', context: clean(r.context).slice(0, 600), notes: clean(r.notes).slice(0, 600),
    conditions: conds, constraint: constraint(conds),
    suggestedAction: r.suggestedAction || '', chase: chaseScore(r, decision, active),
    recentHistory: events.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 10)
      .map(e => ({ at: e.at, actor: e.actor, type: e.type, note: e.note })),
  };
}

/** Cards that need action today, overdue first, then everything else ranked by chase score. */
export function chaseList(records: Rec[], decisions: Record<string, Rec>, work: Rec[], at = today(), limit = 15) {
  const byId = new Map(records.map(r => [r.id, r]));
  const due = work.map(w => ({ w, a: attention(w, at), r: byId.get(w.recordId) }))
    .filter(x => x.a && x.r && x.a.rank <= 3)
    .map(x => ({ id: x.r!.id, workId: x.w.id, name: x.r!.name, company: x.r!.company, stage: x.w.stage, owner: x.w.owner || '',
      reason: x.a!.label, date: x.a!.date, nextAsk: x.w.nextAsk || '', score: chaseScore(x.r!, decisions[x.r!.id], x.w).score, rank: x.a!.rank }))
    .sort((a, b) => a.rank - b.rank || b.score - a.score);
  const onBoard = new Set(work.filter(w => !w.archived).map(w => w.recordId));
  const untapped = records.filter(r => r.kind !== 'opportunity' && !onBoard.has(r.id) && decisions[r.id]?.status !== 'Archive')
    .map(r => ({ id: r.id, name: r.name, company: r.company, jobTitle: r.jobTitle || '', score: chaseScore(r, decisions[r.id]).score,
      constraint: constraint(conditions(r, decisions[r.id])), hasEmail: Boolean(r.email) }))
    .sort((a, b) => b.score - a.score).slice(0, limit);
  return { due: due.slice(0, limit), bestNotOnBoard: untapped };
}

const norm = (v: unknown) => clean(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const normEmail = (v: unknown) => clean(v).toLowerCase();

/** Dedupe guard for new leads: same email, or same name at the same company. */
export function findDuplicate(records: Rec[], lead: { name: string; company: string; email?: string }) {
  const email = normEmail(lead.email);
  return records.find(r => (email && normEmail(r.email) === email)
    || (norm(r.name) === norm(lead.name) && norm(r.company) === norm(lead.company))) || null;
}
