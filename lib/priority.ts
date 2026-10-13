// Server-side access to the shared priority matrix (public/vanor-priority.js).
import '../public/vanor-priority.js';
import { listScope, type Entity } from './bd-store';

type Prio = { grade: string; heat: number; cell: string; score: number; need: number; relationship: number; live: boolean; warm: boolean; top: any; play: string };
export type Lane = { lane: 'Now' | 'Next' | 'Later' | 'Off'; reason: string; move: string };
const P = () => (globalThis as any).VanorPriority as { compute: (r: Entity, d: Entity | undefined, w: Entity[], now?: number) => Prio; lane: (r: Entity, d: Entity | undefined, w: Entity[], p: Prio, h?: any, now?: number) => Lane; LANE_ORDER: Record<string, number>; tierOne: (rows: any[], n: number) => (r: Entity) => boolean };
const stepOf = (t: string) => /^Outcome: sent$|^Interaction: email out$/.test(t) ? 'sent' : /^Outcome: (reply|meeting|proposal|won)|^Interaction: (email in|meeting)/.test(t) ? 'back' : '';
/** Last sent / last answered per contact, from the event log. */
export async function history() {
  const events = await listScope('event'); const lastSent = new Map<string, string>(), lastBack = new Map<string, string>();
  for (const e of events) { const rid = String(e.recordId || e.entityId); const d = String(e.date || e.at || '').slice(0, 10); const st = stepOf(String(e.type || ''));
    if (st === 'sent' && (lastSent.get(rid) || '') < d) lastSent.set(rid, d); if (st === 'back' && (lastBack.get(rid) || '') < d) lastBack.set(rid, d); }
  return { lastSent, lastBack };
}

export async function priorityList({ cell = 'All', limit = 30, lane }: { cell?: string; limit?: number; lane?: Lane['lane'] } = {}) {
  const [records, decisions, work, h] = await Promise.all([listScope('source'), listScope('decision'), listScope('work'), history()]);
  const dById = new Map(decisions.map(d => [d.id, d]));
  const wByRecord = new Map<string, Entity[]>();
  for (const w of work) { const list = wByRecord.get(w.recordId) || []; list.push(w); wByRecord.set(w.recordId, list); }
  const rows = records.filter(r => r.kind !== 'opportunity' && dById.get(r.id)?.status !== 'Archive')
    .map(r => { const d = dById.get(r.id); const w = wByRecord.get(r.id) || []; const p = P().compute(r, d, w); const active = w.find(x => !x.archived);
      return { r, p, l: P().lane(r, d, w, p, { lastSent: h.lastSent.get(r.id), lastBack: h.lastBack.get(r.id), nextAsk: active?.nextAsk || d?.nextAsk || r.nextAsk, stage: active?.stage }) }; });
  const t1 = P().tierOne(rows, 40);
  const counts: Record<string, number> = {}; const lanes: Record<string, number> = { Now: 0, Next: 0, Later: 0, Off: 0 };
  for (const x of rows) { counts[x.p.cell] = (counts[x.p.cell] || 0) + 1; lanes[x.l.lane]++; }
  counts.T1 = rows.filter(x => x.p.grade === 'A' && t1(x.r)).length;
  const pick = rows.filter(x => lane ? x.l.lane === lane : cell === 'All' ? x.p.cell !== 'C' : cell === 'T1' ? x.p.grade === 'A' && t1(x.r) : x.p.cell === cell)
    .sort((a, b) => (P().LANE_ORDER[a.l.lane] - P().LANE_ORDER[b.l.lane]) || b.p.score - a.p.score).slice(0, limit)
    .map(({ r, p, l }) => ({ id: r.id, name: r.name, company: r.company, jobTitle: r.jobTitle, email: r.email || '', lane: l.lane, reason: l.reason, move: l.move, cell: p.cell, score: p.score,
      topOfTier: p.grade === 'A' && t1(r), why: p.top ? `${p.top.date} ${p.top.text}` : p.warm ? 'Warm relationship' : 'No trigger' }));
  return { counts, lanes, rows: pick };
}
