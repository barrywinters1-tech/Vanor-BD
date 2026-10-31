// New people Claude has found (calendar, email threads, events, imports) wait in a review tray as cards.
// Nothing is added to People until a founder taps Add or Merge.
import { createHash } from 'node:crypto';
import { listScope, updateEntity } from './bd-store';
import { hasPlaceholder } from './todos-rules';

export type Candidate = { name: string; company?: string; email?: string; jobTitle?: string; source: string; quote?: string; rung?: string; lane?: string; metOn?: string; matchId?: string };

export async function proposePeople(items: Candidate[]) {
  const [records, work] = await Promise.all([listScope('source'), listScope('work')]);
  const byEmail = new Map(records.filter(r => r.email).map(r => [String(r.email).toLowerCase(), r]));
  const added: string[] = [], skipped: { name: string; why: string }[] = [];
  for (const c of items) {
    const name = String(c.name || '').trim();
    if (!name || hasPlaceholder(name) || !/\s/.test(name) && !c.email) { skipped.push({ name, why: 'needs a full name or an email' }); continue; }
    const email = String(c.email || '').trim().toLowerCase();
    if (email && byEmail.has(email)) { skipped.push({ name, why: 'already on the board (' + byEmail.get(email)!.id + ')' }); continue; }
    if (c.metOn && (!/^\d{4}-\d{2}-\d{2}$/.test(c.metOn) || c.metOn > new Date().toISOString().slice(0, 10))) { skipped.push({ name, why: 'met date must be a past YYYY-MM-DD' }); continue; }
    const id = 'cand:' + createHash('sha1').update((email || name.toLowerCase() + '|' + String(c.company || '').toLowerCase())).digest('hex').slice(0, 16);
    if (work.some(w => w.id === id && w.status !== 'open')) { skipped.push({ name, why: 'already reviewed' }); continue; }
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
    const nameHit = records.find(r => norm(String(r.name || '')) === norm(name));
    await updateEntity('work', id, cur => ({ ...cur, id, kind: 'candidate', status: cur.status || 'open', name, company: c.company || '', email, jobTitle: c.jobTitle || '', source: c.source.slice(0, 120), quote: (c.quote || '').slice(0, 300), rung: c.rung || '', lane: c.lane || '', metOn: c.metOn || '', matchId: c.matchId || nameHit?.id || '', createdAt: cur.createdAt || new Date().toISOString() }), true);
    added.push(id);
  }
  return { added: added.length, skipped };
}
