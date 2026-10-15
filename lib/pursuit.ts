// The founders' decision flow on a lead, in four moves: triage (yes / no / later), to-do step, "email issued", follow-up clock.
// Stored on the contact's decision entity as decision.pursuit. Everything else (lanes, tasks, drafts) reads from it.
import { getOne, updateEntity, logEvent, listScope } from './bd-store';
import { addTask } from './tasks';
import '../public/vanor-classify.js';

export type Triage = 'yes' | 'no' | 'later';
export type Step = 'to_write' | 'sent' | 'replied' | 'meeting' | 'proposal' | 'won' | 'lost';
export type Pursuit = { triage: Triage; triagedAt: string; triagedBy: string; reason?: string; step?: Step; stepAt?: string; sentAt?: string; followUpAt?: string; chases?: number; laterUntil?: string };
export const STEP_LABEL: Record<Step, string> = { to_write: 'To write', sent: 'Email issued', replied: 'Replied', meeting: 'Meeting', proposal: 'Proposal', won: 'Won', lost: 'Lost' };
import { followUpAfter } from './pursuit-logic';
export { addWorkingDays, followUpAfter } from './pursuit-logic';
const DAY = 864e5;
const today = () => new Date().toISOString().slice(0, 10);

export async function triage(id: string, decision: Triage, actor: string, reason = '', laterDays = 30) {
  const now = new Date().toISOString();
  const p: Pursuit = { triage: decision, triagedAt: now, triagedBy: actor, reason };
  (p as any).prev = undefined;
  if (decision === 'yes') { p.step = 'to_write'; p.stepAt = now; }
  if (decision === 'later') p.laterUntil = new Date(Date.now() + laterDays * DAY).toISOString().slice(0, 10);
  const rec = await getOne('source', id); if (!rec) throw new Error(`No contact with id ${id}.`); const action = decision === 'yes' ? String((globalThis as any).VanorClassify?.actionLine?.(rec) || '') : '';
  await updateEntity('decision', id, cur => ({ ...cur, pursuit: { ...(cur.pursuit || {}), ...p, prev: snapshot(cur) }, ...(action && !cur.nextAsk && /^Email/.test(action) ? { nextAsk: action.replace(/ \(.*\)$/, ''), nextDate: new Date(Date.now() + 3 * DAY).toISOString().slice(0, 10) } : {}), ...(decision === 'no' ? { status: 'Archive', archiveReason: reason || 'Not a lead', archivedBy: actor, archivedAt: now } : {}) }), true);
  await logEvent({ entityId: id, recordId: id, type: decision === 'yes' ? 'Lead accepted' : decision === 'no' ? 'Lead rejected' : 'Lead parked', actor, note: reason || (decision === 'later' ? `until ${p.laterUntil}` : '') });
  return { ok: true, pursuit: p };
}

/** Move a pursued lead along. "sent" logs an outreach outcome and starts the follow-up clock (5 working days; 7 after the second chase). */
export async function setStep(id: string, step: Step, actor: string, note = '') {
  const r = await getOne('source', id); if (!r) throw new Error(`No contact with id ${id}.`);
  const now = new Date().toISOString(); const t0 = today();
  let out: Pursuit | undefined;
  await updateEntity('decision', id, cur => {
    const p: Pursuit = { triage: 'yes', triagedAt: now, triagedBy: actor, ...(cur.pursuit || {}) };
    (p as any).prev = snapshot(cur);
    p.step = step; p.stepAt = now;
    if (step === 'sent') { const chases = (p.sentAt ? (p.chases || 0) + 1 : 0); p.chases = chases; p.sentAt = t0; p.followUpAt = followUpAfter(t0, chases); }
    if (step === 'replied' || step === 'meeting' || step === 'proposal') { p.followUpAt = undefined; }
    if (step === 'won' || step === 'lost') { p.followUpAt = undefined; }
    out = p; return { ...cur, pursuit: p, ...(step === 'lost' ? { status: 'Archive', archiveReason: note || 'Lost', archivedBy: actor, archivedAt: now } : {}) };
  }, true);
  if (step === 'sent') await logEvent({ entityId: id, recordId: id, type: 'Outcome: sent', note: note || 'Email issued (marked in the board)', date: t0, ref: `board:sent:${id}:${t0}`, trigger: 'warm', channel: 'email', source: 'board', actor });
  else if (step === 'replied') await logEvent({ entityId: id, recordId: id, type: 'Outcome: reply', note: note || 'Reply received (marked in the board)', date: t0, ref: `board:reply:${id}:${t0}`, actor });
  else if (step === 'meeting') await logEvent({ entityId: id, recordId: id, type: 'Outcome: meeting_booked', note: note || 'Meeting (marked in the board)', date: t0, ref: `board:meeting:${id}:${t0}`, actor });
  else if (step === 'proposal') await logEvent({ entityId: id, recordId: id, type: 'Outcome: proposal', note: note || 'Proposal (marked in the board)', date: t0, ref: `board:proposal:${id}:${t0}`, actor });
  else if (step === 'won') await logEvent({ entityId: id, recordId: id, type: 'Outcome: won', note: note || 'Won', date: t0, ref: `board:won:${id}:${t0}`, actor });
  else await logEvent({ entityId: id, recordId: id, type: step === 'lost' ? 'Lead lost' : 'Pursuit step', actor, note: note || STEP_LABEL[step] });
  return { ok: true, pursuit: out };
}

const snapshot = (cur: any) => ({ pursuit: cur.pursuit ? { ...cur.pursuit, prev: undefined } : null, status: cur.status, archiveReason: cur.archiveReason, nextAsk: cur.nextAsk, nextDate: cur.nextDate });

/** Undo the last board press on this lead: restores the previous pursuit state and retires the event it logged (kept, retyped "Undone: …", so the funnel ignores it). */
export async function undoLast(id: string, actor: string) {
  const cur = await getOne('decision', id); const prev = cur?.pursuit?.prev;
  if (!cur?.pursuit) throw new Error('Nothing to undo on this lead.');
  const events = (await listScope('event')).filter(e => String(e.recordId || e.entityId) === id && typeof e.ref === 'string' && e.ref.startsWith('board:')).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const last = events[0];
  if (last && String(last.at) >= String(cur.pursuit.stepAt || cur.pursuit.triagedAt || '')) await updateEntity('event', last.id, e => ({ ...e, type: 'Undone: ' + String(e.type).replace(/^Outcome: /, ''), undoneBy: actor, undoneAt: new Date().toISOString() }));
  await updateEntity('decision', id, c => { const n: any = { ...c }; if (prev) { n.pursuit = prev.pursuit || undefined; n.status = prev.status; n.archiveReason = prev.archiveReason; n.nextAsk = prev.nextAsk; n.nextDate = prev.nextDate; } else { delete n.pursuit; if (n.archivedBy === actor && /^(Not a lead|Lost)/.test(String(n.archiveReason || ''))) { n.status = 'New'; delete n.archiveReason; } } return n; });
  await logEvent({ entityId: id, recordId: id, type: 'Undo', actor, note: `Undid the last board press${last ? ` (${String(last.type).replace(/^Outcome: /, '')})` : ''}` });
  return { ok: true, restored: prev || null };
}

/** Follow-ups that have fallen due: the alert list. Creates a task per lead so the morning report and the hourly message carry it. */
export async function followUpsDue({ createTasks = true } = {}) {
  const [records, decisions] = await Promise.all([listScope('source'), listScope('decision')]);
  const byId = new Map(records.map(r => [r.id, r])); const t0 = today();
  const due = decisions.filter(d => d.pursuit && d.pursuit.triage === 'yes' && d.pursuit.step === 'sent' && d.pursuit.followUpAt && d.pursuit.followUpAt <= t0 && d.status !== 'Archive')
    .map(d => { const r: any = byId.get(d.id) || {}; return { id: d.id, name: r.name || '', company: r.company || '', sentAt: d.pursuit.sentAt, followUpAt: d.pursuit.followUpAt, chases: d.pursuit.chases || 0, daysSinceSent: Math.round((Date.parse(t0) - Date.parse(d.pursuit.sentAt)) / DAY) }; })
    .sort((a, b) => a.followUpAt.localeCompare(b.followUpAt));
  let created = 0;
  if (createTasks) for (const x of due) {
    const res = await addTask({ id: `task:chase:${x.id}:${x.sentAt}`, title: x.chases >= 2 ? `Decide on ${x.name || x.company}: two chases unanswered, park or call` : `Chase ${x.name || x.company} (no reply for ${x.daysSinceSent} days)`, owner: 'Barry', due: x.followUpAt, priority: 'High', source: { kind: 'record', id: x.id, label: `${x.name} · ${x.company}` }, notes: 'Follow-up clock from the board. Mark "Email issued" again when the chase goes.', createdBy: 'Engine' });
    if (res.created) created++;
  }
  return { due, created };
}
