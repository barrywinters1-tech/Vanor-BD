// Board clean-up: archive duplicates and dead records with a reason. Never deletes; a founder can un-archive in Relationships.
import { listScope, updateEntity, logEvent } from './bd-store';
import { planClean } from './clean-logic';

/** "Touched" = a founder or the engine has done something with it: board card, assessment, draft, note, event. Those are never archived automatically. */
export async function cleanBoard({ apply = false, limit = 400 }: { apply?: boolean; limit?: number } = {}) {
  const [records, decisions, work, events] = await Promise.all([listScope('source'), listScope('decision'), listScope('work'), listScope('event')]);
  const dById = new Map(decisions.map(d => [d.id, d]));
  const archived = new Set(decisions.filter(d => d.status === 'Archive').map(d => String(d.id)));
  const touched = new Set<string>();
  for (const w of work) if (!w.archived) touched.add(String(w.recordId));
  for (const d of decisions) if (d.reviewedAt || d.draft || d.proposal || d.nextAsk || d.owner || (d.conditions && Object.keys(d.conditions).length)) touched.add(String(d.id));
  for (const e of events) if (e.actor && e.actor !== 'Engine' && /Interaction|Outcome|Meeting/.test(String(e.type || ''))) touched.add(String(e.recordId || e.entityId));
  const plan = planClean(records as any, touched, archived);
  const names = new Map(records.map(r => [r.id, `${r.name || ''} · ${r.company || ''}`.trim()]));
  const preview = { ...plan, duplicates: plan.duplicates.slice(0, 40).map(d => ({ ...d, keepLabel: names.get(d.keep), archiveLabels: d.archive.map(a => names.get(a)) })), dead: plan.dead.slice(0, 40).map(x => ({ ...x, label: names.get(x.id) })) };
  if (!apply) return { applied: false, ...preview };
  let n = 0;
  for (const d of plan.duplicates) for (const id of d.archive) { if (n >= limit) break; await updateEntity('decision', id, cur => ({ ...cur, status: 'Archive', archiveReason: `Duplicate of ${d.keep} (${d.why})`, archivedBy: 'Clean-up', archivedAt: new Date().toISOString() }), true); await logEvent({ entityId: id, recordId: id, type: 'Archived', actor: 'Clean-up', note: `Duplicate of ${names.get(d.keep)} (${d.why})` }); n++; }
  for (const x of plan.dead) { if (n >= limit) break; await updateEntity('decision', x.id, cur => ({ ...cur, status: 'Archive', archiveReason: x.why, archivedBy: 'Clean-up', archivedAt: new Date().toISOString() }), true); await logEvent({ entityId: x.id, recordId: x.id, type: 'Archived', actor: 'Clean-up', note: x.why }); n++; }
  return { applied: true, archived: n, remaining: Math.max(0, plan.summary.toArchive + plan.summary.dead - n), ...preview };
}
