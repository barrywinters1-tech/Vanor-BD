import { addWorkingDays } from './pursuit-logic';
// Server-side access to the shared priority matrix (public/vanor-priority.js).
import '../public/vanor-priority.js';
import '../public/vanor-classify.js';
export const classifyRecord = (r: Entity, d?: Entity) => ((globalThis as any).VanorClassify?.classify(r, d) || { type: '', sector: '', stage: '', region: 'Unknown', size: '' }) as { type: string; sector: string; stage: string; region: string; size: string };
export const normRegion = (v?: string) => ((globalThis as any).VanorClassify?.normRegion(v || '') || '') as string;
import { listScope, type Entity } from './bd-store';

type Prio = { grade: string; heat: number; cell: string; score: number; need: number; relationship: number; live: boolean; warm: boolean; top: any; play: string };
export type Lane = { lane: 'Now' | 'Next' | 'Later' | 'Off'; reason: string; move: string };
const P = () => (globalThis as any).VanorPriority as { compute: (r: Entity, d: Entity | undefined, w: Entity[], now?: number) => Prio; lane: (r: Entity, d: Entity | undefined, w: Entity[], p: Prio, h?: any, now?: number) => Lane; LANE_ORDER: Record<string, number>; tierOne: (rows: any[], n: number) => (r: Entity) => boolean };
const stepOf = (t: string) => /^Outcome: sent$|^Interaction: email out$/.test(t) ? 'sent' : /^Outcome: (reply|meeting|proposal|won)|^Interaction: (email in|meeting)/.test(t) ? 'back' : '';
/** Last sent / last answered per contact, from the event log. */
export async function history() {
  const events = await listScope('event'); const lastSent = new Map<string, string>(), lastBack = new Map<string, string>(), lastMet = new Map<string, string>(), lastProposal = new Map<string, string>();
  const today = new Date().toISOString().slice(0, 10);
  for (const e of events) { const rid = String(e.recordId || e.entityId); const d = String(e.date || e.at || '').slice(0, 10); const t = String(e.type || ''); const st = stepOf(t);
    if (st === 'sent' && (lastSent.get(rid) || '') < d) lastSent.set(rid, d); if (st === 'back' && (lastBack.get(rid) || '') < d) lastBack.set(rid, d);
    if (/^Outcome: meeting_(held|booked)$|^Meeting held$|^Interaction: meeting$/.test(t) && d <= today && (lastMet.get(rid) || '') < d) lastMet.set(rid, d);
    if (/^Outcome: (proposal|won)$|^Commercial discussion$/.test(t) && (lastProposal.get(rid) || '') < d) lastProposal.set(rid, d); }
  return { lastSent, lastBack, lastMet, lastProposal };
}

export async function priorityList({ cell = 'All', limit = 30, lane, region }: { cell?: string; limit?: number; lane?: Lane['lane']; region?: string } = {}) {
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
  const regions: Record<string, number> = {}; for (const x of rows) { const g = classifyRecord(x.r, dById.get(x.r.id)).region; regions[g] = (regions[g] || 0) + 1; }
  const pick = rows.filter(x => !region || classifyRecord(x.r, dById.get(x.r.id)).region === normRegion(region)).filter(x => lane ? x.l.lane === lane : cell === 'All' ? x.p.cell !== 'C' : cell === 'T1' ? x.p.grade === 'A' && t1(x.r) : x.p.cell === cell)
    .sort((a, b) => (P().LANE_ORDER[a.l.lane] - P().LANE_ORDER[b.l.lane]) || b.p.score - a.p.score).slice(0, limit)
    .map(({ r, p, l }) => ({ id: r.id, name: r.name, company: r.company, jobTitle: r.jobTitle, email: r.email || '', lane: l.lane, reason: l.reason, move: l.move, ...classifyRecord(r, dById.get(r.id)), cell: p.cell, score: p.score,
      topOfTier: p.grade === 'A' && t1(r), why: p.top ? `${p.top.date} ${p.top.text}` : p.warm ? 'Warm relationship' : 'No trigger' }));
  return { counts, lanes, regions, rows: pick };
}

export type Bucket = 'followup' | 'todo' | 'inbox' | 'waiting' | 'later' | 'off';
/** The one ranked list: every live contact with a bucket (follow-up due / to do / inbox / waiting / later / off) and a rank comparable across buckets. */
export async function workQueue({ bucket, region, limit = 50 }: { bucket?: Bucket; region?: string; limit?: number } = {}) {
  const [records, decisions, work, h] = await Promise.all([listScope('source'), listScope('decision'), listScope('work'), history()]);
  const dById = new Map(decisions.map(d => [d.id, d]));
  const wByRecord = new Map<string, Entity[]>();
  for (const w of work) { const list = wByRecord.get(w.recordId) || []; list.push(w); wByRecord.set(w.recordId, list); }
  const Q = (globalThis as any).VanorPriority;
  const rows = records.filter(r => r.kind !== 'opportunity').map(r => { const d = dById.get(r.id); const w = wByRecord.get(r.id) || []; const p = P().compute(r, d, w); const active = w.find(x => !x.archived);
    const q = Q.queue(r, d, w, p, { lastMet: h.lastMet.get(r.id), lastProposal: h.lastProposal.get(r.id), lastSent: h.lastSent.get(r.id), lastBack: h.lastBack.get(r.id), nextAsk: active?.nextAsk || d?.nextAsk || r.nextAsk, stage: active?.stage });
    if (d?.status === 'Archive' && q.bucket !== 'off') q.bucket = 'off';
    return { r, d, p, q, cls: classifyRecord(r, d) }; });
  const buckets: Record<string, number> = { followup: 0, todo: 0, inbox: 0, waiting: 0, later: 0, off: 0 };
  const want = (x: typeof rows[number]) => !region || x.cls.region === normRegion(region);
  for (const x of rows) if (want(x)) buckets[x.q.bucket]++;
  const pick = rows.filter(want).filter(x => bucket ? x.q.bucket === bucket : x.q.bucket !== 'off' && x.q.bucket !== 'later')
    .sort((a, b) => (Q.BUCKET_ORDER[a.q.bucket] - Q.BUCKET_ORDER[b.q.bucket]) || b.q.rank - a.q.rank).slice(0, limit)
    .map(({ r, d, p, q, cls }) => ({ id: r.id, name: r.name, company: r.company, jobTitle: r.jobTitle, email: r.email || '', bucket: q.bucket, rank: Math.round(q.rank), lane: q.lane, reason: q.reason, move: q.move, ...cls, cell: p.cell, score: p.score,
      pursuit: d?.pursuit || null, why: p.top ? `${p.top.date} ${p.top.text}` : p.warm ? 'Warm relationship' : 'No trigger' }));
  return { buckets, rows: pick };
}

export type Section = 'chase' | 'write' | 'waiting' | 'new' | 'off' | 'touch';
/** The Today screen, server side: one object per contact {section, sentence, due, verb, step}. Same derivation the board uses (VanorPriority.next), so jobs and the screen never disagree. */
export async function today({ section, region, limit = 100 }: { section?: Section; region?: string; limit?: number } = {}) {
  const [records, decisions, work, events, h] = await Promise.all([listScope('source'), listScope('decision'), listScope('work'), listScope('event'), history()]);
  const dById = new Map(decisions.map(d => [d.id, d])); const t0 = new Date().toISOString().slice(0, 10);
  const nextMeeting = new Map<string, string>(); const ledger = new Map<string, any>();
  for (const e of events) {
    if (/^Intro: /.test(String(e.type || ''))) { const rid = String(e.recordId || e.entityId); const L = ledger.get(rid) || { open: [], given: 0, received: 0, owes: 0 }; const kind = String(e.type).replace('Intro: ', ''); const st = e.introStatus || 'open'; const d0 = String(e.happenedOn || e.date || e.at || '').slice(0, 10); if ((kind === 'made' || kind === 'lead_passed') && st !== 'lapsed') L.given++; if (kind === 'promised' && st === 'happened') L.received++; L.owes = L.given - L.received; if (st === 'open' && (kind === 'promised' || kind === 'made')) L.open.push({ id: e.id, kind, counterpart: e.counterpart || '', date: d0, due: addWorkingDays(d0, 10) }); ledger.set(rid, L); } if (/^Outcome: meeting_booked$/.test(String(e.type || ''))) { const rid = String(e.recordId || e.entityId); const d = String(e.happenedOn || e.date || e.at || '').slice(0, 10); if (d > t0 && (!nextMeeting.get(rid) || nextMeeting.get(rid)! > d)) nextMeeting.set(rid, d); } }
  const wByRecord = new Map<string, Entity[]>();
  for (const w of work) { const list = wByRecord.get(w.recordId) || []; list.push(w); wByRecord.set(w.recordId, list); }
  const Q = (globalThis as any).VanorPriority;
  const rows = records.filter(r => r.kind !== 'opportunity').map(r => { const d = dById.get(r.id); const w = wByRecord.get(r.id) || []; const p = P().compute(r, d, w); const active = w.find(x => !x.archived);
    const n = Q.next(r, d, w, p, { lastMet: h.lastMet.get(r.id), lastProposal: h.lastProposal.get(r.id), lastSent: h.lastSent.get(r.id), lastBack: h.lastBack.get(r.id), nextAsk: active?.nextAsk || d?.nextAsk || r.nextAsk, stage: active?.stage, nextMeeting: nextMeeting.get(r.id), ledger: ledger.get(r.id) });
    if (d?.status === 'Archive') n.section = 'off';
    return { r, d, n, cls: classifyRecord(r, d) }; });
  Q.dedupeNew(rows);
  const want = (x: typeof rows[number]) => (!region || x.cls.region === normRegion(region)) && (section === 'touch' ? x.n.kind === 'touch' : section ? x.n.section === section && x.n.kind !== 'touch' : x.n.section !== 'off' && x.n.section !== 'new');
  const counts: Record<string, number> = { chase: 0, write: 0, waiting: 0, new: 0, off: 0, touch: 0 };
  for (const x of rows) if (!region || x.cls.region === normRegion(region)) { if (x.n.kind === 'touch') counts.touch++; else counts[x.n.section]++; }
  const pick = rows.filter(want)
    .sort((a, b) => (Q.SECTION_ORDER[a.n.section] - Q.SECTION_ORDER[b.n.section]) || ((a.n.section === 'chase' || a.n.section === 'waiting') ? (a.n.due || '9999').localeCompare(b.n.due || '9999') : 0) || b.n.rank - a.n.rank).slice(0, limit)
    .map(({ r, d, n, cls }) => ({ id: r.id, name: r.name, company: r.company, email: r.email || '', section: n.section, sentence: n.sentence, due: n.due, verb: n.verb, step: n.step, type: cls.type, region: cls.region, proposal: d?.proposal || null, outcome: d?.pursuit?.outcome || null, owes: ledger.get(r.id)?.owes || 0, kind: n.kind || 'live', tier: n.tier || '', lastTouch: n.lastTouch || '', nextTouch: n.nextTouch || '' }));
  return { counts, rows: pick };
}
