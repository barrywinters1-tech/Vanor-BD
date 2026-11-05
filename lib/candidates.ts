// Names the person to call for each fresh in-lane signal (5 Nov 2026, v8).
// Runs after the 05:40 scan as its own job so the scan never waits on RocketReach. A search returns names and titles only;
// no lookup credit is spent here and no email or phone is stored (a LinkedIn URL may be, in the database only). The 08:10 morning job verifies a candidate with find_people
// before any draft is written. Capped per day; the cap and the count used are shown on the Signals page.
import { listScope, saveEntity, getOne, type Entity } from './bd-store';
import { searchPeople } from './rocketreach';
import { laneOfSignal, titlesFor, type Lane } from './signals-clean';
import '../public/vanor-classify.js';

export const CANDIDATE_CAP_PER_DAY = 10;
const DAY = 864e5;
const iso = (s: string) => ((globalThis as any).VanorClassify?.isoDate?.(s) as string) || String(s || '').slice(0, 10);

export type CandidateHit = { name: string; title: string; employer: string; linkedin?: string; foundAt: string };

export async function findCandidates({ cap = CANDIDATE_CAP_PER_DAY, days = 3, lanes = ['funder', 'claims', 'dc', 'hotel', 'offices'] as Lane[], search = searchPeople }: { cap?: number; days?: number; lanes?: Lane[]; search?: typeof searchPeople } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const stats = (await getOne('work', 'scan:stats')) || { id: 'scan:stats', kind: 'scanstats' } as Entity;
  let used = stats.candidatesDate === today ? Number(stats.candidatesUsed || 0) : 0;
  const since = new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
  const records = await listScope('source');
  const fresh = records.filter(r => r.origin === 'intel' && iso(r.intel?.signalDate || r.createdAt) >= since && !r.candidates && r.company)
    .map(r => ({ r, lane: (r.intel?.lane as Lane) || laneOfSignal({ headline: r.title, text: r.context, stage: r.intel?.stage, sector: r.intel?.sector, source: r.source, buyerType: r.intel?.buyerType }) }))
    .filter(x => lanes.includes(x.lane) && ['Hot', 'Warm'].includes(String(x.r.intel?.tier || '')))
    .sort((a, b) => Number(b.r.intel?.score || 0) - Number(a.r.intel?.score || 0));
  const done: { id: string; company: string; found: number }[] = []; const errors: string[] = [];
  const byCompany = new Map<string, CandidateHit[]>(); // one search per company per run
  for (const { r, lane } of fresh) {
    const key = r.company.toLowerCase().trim();
    let hits = byCompany.get(key);
    if (!hits) {
      if (used >= cap) break;
      const res = await search({ company: r.company, titles: titlesFor(String(r.intel?.stage || ''), lane), limit: 2, lookup: false });
      if (res.message) { errors.push(`${r.company}: ${res.message}`); break; } // a failing search is not charged and the lead stays unchecked
      used++;
      hits = res.candidates.slice(0, 2).map(c => ({ name: c.name, title: c.title, employer: c.employer, linkedin: c.linkedin, foundAt: today }));
      byCompany.set(key, hits);
    }
    // Store names and titles only; the lead keeps its generic "talk to" name until a founder or the morning job verifies a person.
    const saved = await saveEntity('source', { ...r, candidates: hits, candidatesCheckedAt: new Date().toISOString(), intel: { ...(r.intel || {}), lane } }, r._rev || 0).catch(() => null);
    if (saved) done.push({ id: r.id, company: r.company, found: hits.length });
  }
  await saveEntity('work', { ...stats, candidatesDate: today, candidatesUsed: used, candidatesCap: cap, candidatesRanAt: new Date().toISOString() }, stats._rev || 0).catch(() => null);
  return { today, checked: done.length, found: done.filter(d => d.found).length, used, cap, done, errors };
}
