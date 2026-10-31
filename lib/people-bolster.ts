// One-off and repeatable: put the people we already know onto the follow-up rhythm, from data already on the board.
import '../public/vanor-pursuits.js';
import { listScope, updateEntity, type Entity } from './bd-store';
import { today } from './bd-logic';
import { suggest, type Suggestion } from './people-rules';

const V = (globalThis as any).VanorPursuits;

export async function bolsterPeople({ apply = false, limit = 150 }: { apply?: boolean; limit?: number } = {}) {
  const [records, decisions, work] = await Promise.all([listScope('source'), listScope('decision'), listScope('work')]);
  const dm = new Map(decisions.map(d => [d.id, d]));
  const t = today();
  const open = work.filter((w: Entity) => V.isPursuit(w) && V.isOpen(w));
  const ids = new Set<string>(open.map((w: Entity) => String(w.recordId || '')).filter(Boolean));
  const emails = new Set<string>(open.map((w: Entity) => String(w.email || '').toLowerCase()).filter(Boolean));
  const sugg: Suggestion[] = records.map(r => suggest(r as any, { rung: dm.get(r.id)?.rung as string, lastMet: dm.get(r.id)?.lastMet as string }, { ids, emails }, t));
  const set = sugg.filter((s): s is Extract<Suggestion, { rung: string }> => 'rung' in s);
  const skips: Record<string, number> = {};
  for (const s of sugg) if ('skip' in s) skips[s.skip] = (skips[s.skip] || 0) + 1;
  const by = (k: 'rung' | 'lane') => set.reduce((o: Record<string, number>, s) => (o[s[k]] = (o[s[k]] || 0) + 1, o), {});
  let applied = 0;
  if (apply) {
    for (const s of set.slice(0, Math.max(1, Math.min(limit, 400)))) {
      await updateEntity('decision', s.id, d => {
        const next: Entity = { ...d, rung: s.rung, lane: d.lane || s.lane, bolsteredAt: t, bolsterBasis: s.basis };
        if (s.lastMet && !d.lastMet) { next.lastMet = s.lastMet; next.metDates = [s.lastMet]; next.metCount = 1; next.metSource = 'board last contact'; }
        return next;
      }, true);
      applied++;
    }
  }
  const dueSoonOrOverdue = set.filter(s => s.lastMet && V.meetingStatus({ rung: s.rung, lastMet: s.lastMet }, t).overdue).length;
  return { today: t, records: records.length, wouldSet: set.length, applied, remaining: apply ? Math.max(0, set.length - applied) : set.length, byRung: by('rung'), byLane: by('lane'), overdueOnArrival: dueSoonOrOverdue, skipped: skips };
}
