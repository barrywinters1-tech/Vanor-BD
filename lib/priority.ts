// Server-side access to the shared priority matrix (public/vanor-priority.js).
import '../public/vanor-priority.js';
import { listScope, type Entity } from './bd-store';

type Prio = { grade: string; heat: number; cell: string; score: number; need: number; relationship: number; live: boolean; warm: boolean; top: any; play: string };
const P = () => (globalThis as any).VanorPriority as { compute: (r: Entity, d: Entity | undefined, w: Entity[], now?: number) => Prio; tierOne: (rows: any[], n: number) => (r: Entity) => boolean };

export async function priorityList({ cell = 'All', limit = 30 }: { cell?: string; limit?: number } = {}) {
  const [records, decisions, work] = await Promise.all([listScope('source'), listScope('decision'), listScope('work')]);
  const dById = new Map(decisions.map(d => [d.id, d]));
  const wByRecord = new Map<string, Entity[]>();
  for (const w of work) { const list = wByRecord.get(w.recordId) || []; list.push(w); wByRecord.set(w.recordId, list); }
  const rows = records.filter(r => r.kind !== 'opportunity' && dById.get(r.id)?.status !== 'Archive')
    .map(r => ({ r, p: P().compute(r, dById.get(r.id), wByRecord.get(r.id) || []) }));
  const t1 = P().tierOne(rows, 40);
  const counts: Record<string, number> = {};
  for (const x of rows) counts[x.p.cell] = (counts[x.p.cell] || 0) + 1;
  counts.T1 = rows.filter(x => x.p.grade === 'A' && t1(x.r)).length;
  const pick = rows.filter(x => cell === 'All' ? x.p.cell !== 'C' : cell === 'T1' ? x.p.grade === 'A' && t1(x.r) : x.p.cell === cell)
    .sort((a, b) => b.p.score - a.p.score).slice(0, limit)
    .map(({ r, p }) => ({ id: r.id, name: r.name, company: r.company, jobTitle: r.jobTitle, email: r.email || '', cell: p.cell, score: p.score,
      topOfTier: p.grade === 'A' && t1(r), why: p.top ? `${p.top.date} ${p.top.text}` : p.warm ? 'Warm relationship' : 'No trigger', move: p.play }));
  return { counts, rows: pick };
}
