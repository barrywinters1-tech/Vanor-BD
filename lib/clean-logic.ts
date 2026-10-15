// Data clean-up, pure: find duplicates and dead records. Nothing here deletes; the caller archives with a reason.
export type Rec = { id: string; kind?: string; name?: string; company?: string; email?: string; phone?: string; linkedin?: string; jobTitle?: string; lastContact?: string; createdAt?: string; origin?: string; [k: string]: any };
export type Plan = { duplicates: Array<{ keep: string; archive: string[]; why: string }>; dead: Array<{ id: string; why: string }>; summary: { records: number; duplicateGroups: number; toArchive: number; dead: number } };

const normName = (s = '') => s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
const normCo = (s = '') => s.toLowerCase().replace(/\b(ltd|limited|plc|llp|group|holdings|uk|the|&|and|co)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const normEmail = (s = '') => s.toLowerCase().trim();

/** How much a record knows: used to pick which duplicate survives. Human-touched records always win. */
export function richness(r: Rec, touched: boolean) {
  // A relationship record always outranks a lead-register row for the same person.
  return (touched ? 1000 : 0) + (r.kind === 'relationship' ? 500 : 0) + (r.email ? 8 : 0) + (r.phone ? 4 : 0) + (r.linkedin ? 3 : 0) + (r.jobTitle ? 2 : 0) + (r.lastContact ? 4 : 0) + (r.companyIntel ? 2 : 0) + (r.notes ? 1 : 0) + (r.context ? 1 : 0);
}

export function planClean(records: Rec[], touchedIds: Set<string>, archivedIds: Set<string>): Plan {
  const live = records.filter(r => r.kind !== 'opportunity' && !archivedIds.has(r.id));
  const groups = new Map<string, Rec[]>();
  const put = (k: string, r: Rec) => { if (!k) return; const g = groups.get(k) || []; if (!g.includes(r)) g.push(r); groups.set(k, g); };
  for (const r of live) {
    if (r.email && r.email.includes('@')) put('e:' + normEmail(r.email), r);
    const n = normName(r.name), c = normCo(r.company);
    if (n && n.split(' ').length >= 2 && c) put('n:' + n + '|' + c, r);
  }
  // Merge groups that share a member (same person keyed by email in one and by name in another).
  const parent = new Map<string, string>(); const find = (x: string): string => parent.get(x) === undefined || parent.get(x) === x ? x : find(parent.get(x)!);
  for (const g of groups.values()) { for (const r of g) if (!parent.has(r.id)) parent.set(r.id, r.id); for (let i = 1; i < g.length; i++) parent.set(find(g[i].id), find(g[0].id)); }
  const clusters = new Map<string, Rec[]>();
  for (const r of live) { if (!parent.has(r.id)) continue; const root = find(r.id); const c = clusters.get(root) || []; c.push(r); clusters.set(root, c); }
  const duplicates: Plan['duplicates'] = [];
  for (const c of clusters.values()) {
    if (c.length < 2) continue;
    const sorted = [...c].sort((a, b) => richness(b, touchedIds.has(b.id)) - richness(a, touchedIds.has(a.id)) || String(a.id).localeCompare(String(b.id)));
    const keep = sorted[0]; const rest = sorted.slice(1).filter(r => !touchedIds.has(r.id));
    if (rest.length) duplicates.push({ keep: keep.id, archive: rest.map(r => r.id), why: keep.email && rest.every(r => normEmail(r.email || '') === normEmail(keep.email || '')) ? `same email ${keep.email}` : `same person at ${keep.company}` });
  }
  const dupIds = new Set(duplicates.flatMap(d => d.archive));
  const dead: Plan['dead'] = [];
  for (const r of live) {
    if (dupIds.has(r.id) || touchedIds.has(r.id)) continue;
    const hasPerson = !!(r.name && normName(r.name).length > 2);
    if (!hasPerson && !r.email && !r.company) dead.push({ id: r.id, why: 'no name, no email, no company' });
    else if (!hasPerson && !r.email && r.origin !== 'intel' && !r.companyIntel) dead.push({ id: r.id, why: 'company only, nobody to contact, no signal' });
  }
  return { duplicates, dead, summary: { records: live.length, duplicateGroups: duplicates.length, toArchive: dupIds.size, dead: dead.length } };
}
