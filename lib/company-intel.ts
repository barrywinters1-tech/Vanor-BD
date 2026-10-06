// Company-level intelligence: Companies House (status, directors, charges = lending), PlanIt (planning),
// The Gazette (insolvency). Plain code; produces dated "signals" that say whether a firm is active and has a need.
import { parseFeed } from './intel.ts';

export type Signal = { type: 'lending' | 'property' | 'planning' | 'distress' | 'new_director' | 'inactive'; date: string; text: string; url?: string };
export type CompanyIntel = {
  name: string; checkedAt: string; matchedName?: string; companyNumber?: string; status?: string; incorporated?: string;
  sic?: string[]; locality?: string; directors?: string[]; lastAccounts?: string; signals: Signal[];
  active: 'active' | 'quiet' | 'inactive' | 'unknown'; need: string; sources: string[]; errors: string[];
};

const UA = { 'User-Agent': 'VanorBD/1.0 (+https://vanor-bd.vercel.app)' };
const monthsAgo = (d: string, today = Date.now()) => (today - Date.parse(d)) / (30.44 * 86400000);
export const normCompany = (s = '') => s.toLowerCase().replace(/&/g, ' and ').replace(/\b(ltd|limited|plc|llp|lp|group|holdings|uk|the|co|company)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ').trim();

/** Token overlap between our company name and a Companies House title (0..1). */
export function nameMatch(ours: string, theirs: string) {
  const a = new Set(normCompany(ours).split(' ').filter(Boolean)), b = new Set(normCompany(theirs).split(' ').filter(Boolean));
  if (!a.size || !b.size) return 0;
  let hit = 0; for (const t of a) if (b.has(t)) hit++;
  return hit / Math.max(a.size, b.size);
}

async function ch(path: string) {
  const key = (process.env.COMPANIES_HOUSE_KEY || '').replace(/\s+/g, '');
  if (!key) throw new Error('no COMPANIES_HOUSE_KEY');
  const r = await fetch(`https://api.company-information.service.gov.uk${path}`, {
    headers: { ...UA, Authorization: 'Basic ' + Buffer.from(key + ':').toString('base64') }, signal: AbortSignal.timeout(10000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Companies House HTTP ${r.status}`);
  return r.json();
}

const PROPERTY_WORDS = /\b(land|property|freehold|leasehold|title number|registered at hm land registry|premises|site)\b/i;

export function chargeSignals(charges: any[], today = Date.now()): Signal[] {
  return (charges || []).filter(c => c.created_on && monthsAgo(c.created_on, today) <= 18 && c.status !== 'fully-satisfied')
    .map(c => {
      const lender = (c.persons_entitled || []).map((p: any) => p.name).filter(Boolean).join(', ') || 'lender not named';
      const desc = [c.particulars?.description, c.classification?.description].filter(Boolean).join(' ');
      const property = PROPERTY_WORDS.test(desc);
      return { type: property ? 'property' : 'lending', date: c.created_on,
        text: `${property ? 'Property charge' : 'New charge'} in favour of ${lender}${desc ? ': ' + desc.slice(0, 140) : ''}` } as Signal;
    });
}

export function directorSignals(officers: any[], today = Date.now()): Signal[] {
  return (officers || []).filter(o => !o.resigned_on && o.appointed_on && monthsAgo(o.appointed_on, today) <= 12 && o.officer_role === 'director')
    .map(o => ({ type: 'new_director', date: o.appointed_on, text: `New director: ${o.name}` }) as Signal);
}

export function classifyNeed(signals: Signal[], status?: string) {
  if (status && status !== 'active') return 'Company not active: check before approaching';
  const has = (t: Signal['type']) => signals.some(s => s.type === t);
  if (has('distress')) return 'Distress: possible recovery or completion need';
  if (has('property') && has('planning')) return 'Acquired or funded site with planning activity: delivery need likely';
  if (has('lending') || has('property')) return 'New funding in place: lender monitoring or delivery assurance';
  if (has('planning')) return 'Planning activity: delivery need ahead';
  if (has('new_director')) return 'Leadership change: re-introduce Vanor';
  return 'No live trigger found';
}

export function activity(signals: Signal[], status?: string, lastAccounts?: string): CompanyIntel['active'] {
  if (status && status !== 'active') return 'inactive';
  if (signals.some(s => monthsAgo(s.date) <= 12)) return 'active';
  if (status === 'active' || lastAccounts) return 'quiet';
  return 'unknown';
}

export async function researchCompany(name: string): Promise<CompanyIntel> {
  const intel: CompanyIntel = { name, checkedAt: new Date().toISOString(), signals: [], active: 'unknown', need: '', sources: [], errors: [] };
  // Companies House
  try {
    const found = await ch(`/search/companies?q=${encodeURIComponent(name)}&items_per_page=5`);
    const best = (found?.items || []).map((i: any) => ({ i, m: nameMatch(name, i.title) })).sort((a: any, b: any) => b.m - a.m)[0];
    if (best && best.m >= 0.6) {
      const n = best.i.company_number;
      const [profile, officers, charges] = await Promise.all([ch(`/company/${n}`), ch(`/company/${n}/officers?items_per_page=35`), ch(`/company/${n}/charges?items_per_page=25`)]);
      Object.assign(intel, {
        matchedName: profile?.company_name || best.i.title, companyNumber: n, status: profile?.company_status,
        incorporated: profile?.date_of_creation, sic: profile?.sic_codes || [], locality: profile?.registered_office_address?.locality,
        lastAccounts: profile?.accounts?.last_accounts?.made_up_to,
        directors: (officers?.items || []).filter((o: any) => !o.resigned_on && ['director', 'llp-designated-member', 'llp-member'].includes(o.officer_role)).map((o: any) => o.name).slice(0, 8),
      });
      intel.signals.push(...chargeSignals(charges?.items || []), ...directorSignals(officers?.items || []));
      if (profile?.company_status && profile.company_status !== 'active')
        intel.signals.push({ type: 'inactive', date: profile.date_of_cessation || intel.checkedAt.slice(0, 10), text: `Companies House status: ${profile.company_status}` });
      intel.sources.push(`https://find-and-update.company-information.service.gov.uk/company/${n}`);
    } else if (found) intel.errors.push('Companies House: no confident name match');
  } catch (e) { intel.errors.push(e instanceof Error ? e.message : String(e)); }
  // The Gazette (insolvency notices naming the company)
  try {
    const q = encodeURIComponent(`"${name.replace(/"/g, '')}"`);
    const xml = await (await fetch(`https://www.thegazette.co.uk/insolvency/notice/data.feed?text=${q}&results-page-size=5`, { headers: UA, signal: AbortSignal.timeout(10000) })).text();
    for (const n of parseFeed(xml, 'gazette')) if (Date.parse(n.date) && monthsAgo(n.date) <= 24 && nameMatch(name, n.title) >= 0.5)
      intel.signals.push({ type: 'distress', date: n.date.slice(0, 10), text: n.title.slice(0, 160), url: n.link });
  } catch (e) { intel.errors.push('Gazette: ' + (e instanceof Error ? e.message : e)); }
  // Planning (PlanIt free-text search, last 12 months)
  try {
    const p = new URLSearchParams({ search: `"${name}"`, recent: '365', pg_sz: '10' });
    if (process.env.PLANIT_KEY) p.set('auth', process.env.PLANIT_KEY);
    const json = await (await fetch(`https://www.planit.org.uk/api/applics/json?${p}`, { headers: UA, signal: AbortSignal.timeout(12000) })).json();
    for (const r of (json.records || []).slice(0, 5)) {
      const who = `${r.applicant || ''} ${r.agent || ''} ${r.description || ''}`;
      if (nameMatch(name, who) < 0.5 && !normCompany(who).includes(normCompany(name))) continue;
      intel.signals.push({ type: 'planning', date: (r.start_date || r.last_changed || '').slice(0, 10),
        text: `${r.area_name || ''}: ${String(r.description || '').slice(0, 120)} (${r.app_state || 'status unknown'})`, url: r.link || r.url });
    }
  } catch (e) { intel.errors.push('PlanIt: ' + (e instanceof Error ? e.message : e)); }
  intel.signals.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  intel.signals = intel.signals.slice(0, 8);
  intel.active = activity(intel.signals, intel.status, intel.lastAccounts);
  intel.need = classifyNeed(intel.signals, intel.status);
  return intel;
}
