// Vanor Live rules (23 Nov 2026): the pipeline view over the board's pursuits.
// Pure functions only, shared by the screens, the workspace API and the tests.
// A deal IS a pursuit. Its stage is a plain-English view of the board state, so Claude's jobs keep working:
//   lead = watch, conversation = act or waiting, proposal / negotiating = table. won, lost, parked are closed.

export type Item = { id: string; [k: string]: any };
export type Stage = 'lead' | 'conversation' | 'proposal' | 'negotiating';

export const STAGES: { id: Stage; name: string; p: number; quietAfter: number; move: string }[] = [
  { id: 'lead', name: 'Lead', p: 0.10, quietAfter: 21, move: 'To move on: find the named scheme, the real problem and the person who pays.' },
  { id: 'conversation', name: 'Conversation', p: 0.25, quietAfter: 14, move: 'To move on: agree a scoped first piece of paid work.' },
  { id: 'proposal', name: 'Proposal out', p: 0.50, quietAfter: 7, move: 'To move on: get a yes, a no or a decision date.' },
  { id: 'negotiating', name: 'Negotiating', p: 0.70, quietAfter: 5, move: 'To move on: reshape scope before cutting the rate, then get a signature.' },
];
export const STAGE: Record<string, (typeof STAGES)[number]> = Object.fromEntries(STAGES.map(s => [s.id, s]));
export const CLOSED = ['won', 'lost', 'parked'] as const;
export const isClosed = (p: Item) => CLOSED.includes(p.state) || !!p.archived;
export const isOpenDeal = (p: Item) => p.kind === 'pursuit' && !isClosed(p);

/** The board state a stage maps to. A conversation keeps act or waiting if it already has one. */
export function stateForStage(stage: Stage, current = 'watch'): string {
  if (stage === 'lead') return 'watch';
  if (stage === 'conversation') return current === 'act' || current === 'waiting' ? current : 'act';
  return 'table';
}

/** A stored stage counts only while the board state is still the one it was set against (stageState). If Claude or
 *  the old screens moved the state, even away and back, the stage follows the state. */
export function stageOf(p: Item): Stage {
  const state = p.state || 'watch';
  if (p.stage && STAGE[p.stage] && p.stageState === state && stateForStage(p.stage, state) === state) return p.stage;
  if (state === 'table') return 'proposal';
  if (state === 'act' || state === 'waiting') return 'conversation';
  return 'lead';
}

const day = (v: unknown) => (v ? String(v).slice(0, 10) : '');
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);

/** Last real activity: a timeline note, a partner's edit, or Claude refreshing the latest line. */
export function lastActivity(p: Item): string {
  const dates = [day(p.log?.[0]?.date), day(p.founderTouchedAt), day(p.latestAt), day(p.createdAt)].filter(Boolean).sort();
  return dates[dates.length - 1] || '';
}
export function lateDays(p: Item, today: string) { return isOpenDeal(p) && p.dueBy && p.dueBy < today ? daysBetween(p.dueBy, today) : 0; }
export function quietDays(p: Item, today: string) { const a = lastActivity(p); return a ? daysBetween(a, today) : null; }
export function isQuiet(p: Item, today: string) { if (!isOpenDeal(p)) return false; const q = quietDays(p, today); return q == null || q > STAGE[stageOf(p)].quietAfter; }
export function missingNext(p: Item) { return isOpenDeal(p) && (!p.nextAction || !p.dueBy || !p.owner); }

export const isMonthly = (p: Item) => p.type === 'monthly';
export const oneOff = (p: Item) => (!isMonthly(p) && Number(p.amount) > 0 ? Number(p.amount) : 0);
export const monthly = (p: Item) => (isMonthly(p) && Number(p.amount) > 0 ? Number(p.amount) : 0);
/** Money first: chance of winning times the fee (a monthly fee counts as a year). */
export const score = (p: Item) => (isOpenDeal(p) ? STAGE[stageOf(p)].p * (oneOff(p) + 12 * monthly(p)) : 0);

export function kpis(deals: Item[], today: string) {
  const open = deals.filter(isOpenDeal);
  const out = open.filter(p => ['proposal', 'negotiating'].includes(stageOf(p)));
  return {
    proposalsOut: out.reduce((a, p) => a + oneOff(p), 0),
    monthlyOnOffer: out.reduce((a, p) => a + monthly(p), 0),
    weighted: Math.round(open.reduce((a, p) => a + oneOff(p) * STAGE[stageOf(p)].p, 0)),
    overdue: open.filter(p => lateDays(p, today) > 0).length,
    quiet: open.filter(p => isQuiet(p, today)).length,
  };
}

/** What a partner's stage tap changes on the pursuit. */
export function stageChange(p: Item, stage: Stage) {
  const state = stateForStage(stage, p.state);
  return { stage, state, stageState: state };
}

/** Client timeline: the client's own history plus every note on its deals, newest first. */
export function clientTimeline(client: Item, deals: Item[]) {
  const rows: { date: string; kind: string; text: string; deal?: string }[] = (client.history || []).map((h: Item) => ({ date: day(h.date), kind: h.kind || 'Note', text: h.text || '' }));
  for (const d of deals) if (d.clientId === client.id) for (const n of d.log || []) rows.push({ date: day(n.date), kind: d.name, text: n.text, deal: d.id });
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

export const slug = (s: string) => String(s || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'item';
export const CLIENT_FIELDS = ['name', 'type', 'owner', 'warmth', 'people', 'history', 'cares', 'theyOwe', 'weOwe', 'work', 'personal', 'whoElse'] as const;
export const WARMTH = ['New', 'Warm', 'Strong', 'Cooling'] as const;
