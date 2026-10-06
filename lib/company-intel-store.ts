// Runs company research for fit contacts and stores a compact copy on every contact at that company.
import { listScope, updateEntity, logEvent, type Entity } from './bd-store';
import { researchCompany, normCompany, type CompanyIntel } from './company-intel';

const fitOf = (r: Entity) => (typeof r.fitScore === 'number' ? r.fitScore : -1);
const SKIP_SECTORS = new Set(['Supplier/Other']);

export async function companyGroups(minFit = 1) {
  const [records, decisions] = await Promise.all([listScope('source'), listScope('decision')]);
  const archived = new Set(decisions.filter(d => d.status === 'Archive').map(d => d.id));
  const groups = new Map<string, { company: string; ids: string[]; fit: number; checkedAt: string }>();
  for (const r of records) {
    if (r.kind === 'opportunity' || archived.has(r.id) || fitOf(r) < minFit || SKIP_SECTORS.has(r.fitSector) || !r.company) continue;
    const key = normCompany(r.company); if (key.length < 3) continue;
    const g = groups.get(key) || { company: r.company as string, ids: [] as string[], fit: -1, checkedAt: (r.companyIntel?.checkedAt || '') as string };
    g.ids.push(r.id); g.fit = Math.max(g.fit, fitOf(r));
    if (!r.companyIntel?.checkedAt) g.checkedAt = ''; // any unchecked contact makes the group due
    groups.set(key, g);
  }
  return [...groups.values()];
}

export async function saveIntel(ids: string[], intel: CompanyIntel) {
  const compact = { ...intel, errors: intel.errors.slice(0, 3) };
  for (const id of ids) await updateEntity('source', id, r => ({ ...r, companyIntel: compact }));
  const fresh = intel.signals.filter(s => s.type !== 'inactive' && Date.now() - Date.parse(s.date) < 45 * 86400000);
  if (fresh.length) await logEvent({ entityId: ids[0], recordId: ids[0], type: 'Signal', actor: 'Vanor intel scanner',
    note: `${intel.name}: ${fresh.map(s => s.text).join('; ').slice(0, 400)}` });
}

/** Research the most valuable stale companies until the time budget runs out. */
export async function researchBatch({ limit = 10, budgetMs = 40000, minFit = 1, staleDays = 30 } = {}) {
  const started = Date.now();
  const cutoff = new Date(Date.now() - staleDays * 86400000).toISOString();
  const due = (await companyGroups(minFit)).filter(g => !g.checkedAt || g.checkedAt < cutoff)
    .sort((a, b) => b.fit - a.fit || (a.checkedAt || '').localeCompare(b.checkedAt || ''));
  const done: { company: string; active: string; need: string; signals: number; errors: string[] }[] = [];
  for (const g of due) {
    if (done.length >= limit || Date.now() - started > budgetMs) break;
    const intel = await researchCompany(g.company);
    await saveIntel(g.ids, intel);
    done.push({ company: g.company, active: intel.active, need: intel.need, signals: intel.signals.length, errors: intel.errors });
  }
  return { researched: done.length, remaining: Math.max(0, due.length - done.length), done };
}

/** Contacts at companies with live signals, best first, for outreach. */
export async function signalContacts({ minFit = 2, maxAgeDays = 120, limit = 40 } = {}) {
  const records = await listScope('source');
  const rows = records.filter(r => fitOf(r) >= minFit && r.companyIntel?.signals?.some((s: any) => s.type !== 'inactive' && Date.now() - Date.parse(s.date) < maxAgeDays * 86400000))
    .map(r => ({ id: r.id, name: r.name, company: r.company, jobTitle: r.jobTitle, email: r.email || '', fit: r.fitScore,
      need: r.companyIntel.need, active: r.companyIntel.active, directors: r.companyIntel.directors || [],
      signals: r.companyIntel.signals.filter((s: any) => s.type !== 'inactive').slice(0, 3) }));
  return rows.sort((a, b) => (b.signals[0]?.date || '').localeCompare(a.signals[0]?.date || '')).slice(0, limit);
}
