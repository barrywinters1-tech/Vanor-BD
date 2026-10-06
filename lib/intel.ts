// Market + planning signal scanner (ported from vanor-intel: trigger_monitor, planning, buyers, lead_pipeline).
// Plain code, no AI: fetch feeds -> keep real signals -> score -> leads for the board's review queue.

export type Signal = { title: string; link: string; date: string; summary: string; source: string; applicant?: string };
export type Scored = Signal & {
  score: number; complexity: number; distress: number; money: number; timing: number;
  buyerType: string; talkTo: string; signs: string; organisation: string; contractors: string[];
};

export const CONFIG = {
  sectors: ['hotel', 'hospitality', 'hospital', 'school', 'university', 'student accommodation', 'theatre', 'museum', 'gallery', 'office',
    'mixed use', 'mixed-use', 'listed building', 'heritage', 'refurbishment', 'refurb', 'change of use', 'conversion', 'fit-out',
    'extension and alteration', 'residential', 'build to rent', 'data centre', 'data center'],
  planningKeywords: ['refurbishment', 'change of use', 'listed building consent', 'conversion', 'hotel', 'mixed use',
    'student accommodation', 'office', 'build to rent', 'data centre'],
  planningMinSize: 'Large',
  planningRecentDays: 7,
  signalWords: ['administrat', 'insolven', 'liquidat', 'notice of intent', 'delay', 'postpone', 'remain closed', 'refurb', 'renovat',
    'reopen', 'refinanc', 'loan', 'facility', 'acquire', 'acquisition', 'stalled', 'restart', 'ceased trading', 'collapse'],
  minScore: 30,
  maxPerRun: 15,
};

export const FEEDS: Record<string, string> = {
  construction_enquirer: 'https://www.constructionenquirer.com/feed/',
  hotelowner_admin: 'https://www.hotelowner.co.uk/tag/administration/feed/',
  hotelowner_refurb: 'https://www.hotelowner.co.uk/tag/refurbishment/feed/',
  gazette_construction: 'https://www.thegazette.co.uk/insolvency/notice/data.feed?text=construction+OR+fit-out+OR+interiors+OR+mechanical+OR+electrical&results-page-size=50',
  hospitalitynet: 'https://www.hospitalitynet.org/rss/news.xml',
};

// ---- buyer map (lib/buyers.py) ----
export const BUYERS: Record<string, { talkTo: string; signs: string; weight: number }> = {
  developer: { talkTo: 'Development Director / Head of Delivery', signs: 'MD or founder', weight: 1.0 },
  hotel_group: { talkTo: 'Group Property Director / Head of Development', signs: 'CEO or owner', weight: 1.0 },
  fund: { talkTo: 'Head of Asset Management', signs: 'Investment Committee', weight: 0.9 },
  family_office: { talkTo: 'Principal or their asset manager', signs: 'Principal', weight: 0.9 },
  lender: { talkTo: 'Director, Real Estate Finance', signs: 'Credit committee', weight: 0.9 },
  owner_occupier: { talkTo: 'Director of Estates / Head of Capital Projects', signs: 'Board or Finance Director', weight: 1.0 },
  public_body: { talkTo: 'Head of Capital Projects', signs: 'Cabinet / Board (framework route)', weight: 0.7 },
  unknown: { talkTo: 'Whoever loses money if the date moves', signs: 'Unknown', weight: 0.5 },
};
const KEYS: [string, string[]][] = [
  ['hotel_group', ['hotel', 'hotels', 'hospitality', 'resort', 'inn']],
  ['fund', ['capital', 'partners', 'asset management', 'investment', 'fund', 'reit']],
  ['family_office', ['family office', 'estates ltd', 'holdings']],
  ['lender', ['bank', 'lending', 'finance', 'debt', 'credit']],
  ['public_body', ['council', 'borough', 'city of', 'authority', 'government']],
  ['owner_occupier', ['university', 'nhs', 'trust', 'college', 'theatre', 'museum', 'gallery', 'school', 'headquarters', 'cathedral', 'church']],
  ['developer', ['developments', 'development', 'properties', 'property', 'homes', 'regeneration', 'estates']],
];
const COMPLEXITY: Record<string, number> = { listed: 10, 'grade ii': 10, 'grade i': 12, heritage: 8, live: 8, phased: 8, occupied: 8, mep: 8, 'm&e': 8,
  mechanical: 6, commissioning: 8, hotel: 6, theatre: 8, hospital: 8, laboratory: 8, basement: 6, 'change of use': 6, conversion: 6, refurb: 6,
  'fit-out': 4, 'data centre': 8, 'student accommodation': 6, 'build to rent': 6 };
const DISTRESS: Record<string, number> = { administrat: 25, 'notice of intent': 25, insolven: 25, liquidat: 20, delay: 15, postpone: 15,
  'remain closed': 20, behind: 10, dispute: 15, adjudicat: 15, terminat: 20, replace: 10, 'new contractor': 15, slipped: 15, 'later than': 10,
  stalled: 15, 'ceased trading': 25, collapse: 20 };
const MONEY: Record<string, number> = { '£': 4, million: 6, bed: 4, rooms: 4, facility: 6, loan: 6, refinanc: 6, charge: 4, 'sq ft': 4, phase: 3 };
const sum = (table: Record<string, number>, t: string) => Object.entries(table).reduce((n, [k, v]) => n + (t.includes(k) ? v : 0), 0);

export function classify(text: string) {
  const t = text.toLowerCase();
  for (const [kind, words] of KEYS) if (words.some(w => t.includes(w))) return kind;
  return 'unknown';
}

export function moneySignal(text: string) {
  const t = text.toLowerCase(); let pts = 0;
  for (const m of t.matchAll(/£\s?(\d+(?:\.\d+)?)\s?(m|million|bn|billion)\b/g)) {
    const v = parseFloat(m[1]) * (m[2].startsWith('b') ? 1000 : 1);
    pts = Math.max(pts, v < 10 ? 6 : v < 40 ? 12 : 20);
  }
  for (const m of t.matchAll(/(\d{2,4})\s?-?\s?(bed|rooms?|keys)\b/g)) { const n = +m[1]; pts = Math.max(pts, n < 60 ? 4 : n < 150 ? 10 : 16); }
  if (/\d{2,3},?\d{3}\s?sq\s?ft/.test(t)) pts = Math.max(pts, 10);
  return Math.min(20, pts);
}

export function recency(date: string, today = new Date()) {
  const d = Date.parse(date); if (Number.isNaN(d)) return 1;
  return Math.max(0.3, 1 - (today.getTime() - d) / 86400000 / 120);
}

export function contractorsIn(text: string) {
  const out: string[] = [];
  for (const m of text.matchAll(/((?:[A-Z][\w&'-]+\s){1,4}(?:Ltd|Limited|Contractors|Construction|Interiors|Services|Engineering|Building)\b)/g)) {
    const name = m[1].trim(); const base = name.replace(/\s+(Ltd|Limited)$/, '');
    if (!out.some(o => o.startsWith(base))) out.push(name);
  }
  return out.slice(0, 5);
}

export function isSignal(s: Signal) {
  const t = `${s.title} ${s.summary}`.toLowerCase();
  if (s.source === 'planit' || s.source === 'planning_data_gov')
    return !t.includes('size: small') && !t.includes('householder') && CONFIG.sectors.some(k => t.includes(k));
  return CONFIG.signalWords.some(w => t.includes(w));
}

export function score(s: Signal, today = new Date()): Scored {
  const text = `${s.title} ${s.summary} ${s.applicant || ''}`;
  const t = text.toLowerCase();
  const complexity = Math.min(30, sum(COMPLEXITY, t));
  const distress = Math.min(40, sum(DISTRESS, t));
  const money = Math.max(Math.min(20, sum(MONEY, t)), moneySignal(text));
  const timing = distress ? 10 : 4;
  const buyerType = classify(s.applicant || text);
  const raw = Math.min(100, (complexity + distress + money + timing) * BUYERS[buyerType].weight);
  const rec = recency(s.date, today);
  return {
    ...s, complexity, distress, money, timing, buyerType,
    score: Math.round(raw * (distress ? rec : Math.max(rec, 0.8))),
    talkTo: BUYERS[buyerType].talkTo, signs: BUYERS[buyerType].signs,
    organisation: (s.applicant || '').trim(), contractors: contractorsIn(text),
  };
}

// ---- feed parsing (RSS + Atom, no XML library needed) ----
const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const strip = (s: string) => decode(decode(s)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (block: string, name: string) => block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'))?.[1] || '';

export function parseFeed(xml: string, source: string): Signal[] {
  const items: Signal[] = [];
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const b = m[0];
    items.push({ source, title: strip(tag(b, 'title')), link: strip(tag(b, 'link')), date: strip(tag(b, 'pubDate')),
      summary: strip(tag(b, 'description')).slice(0, 600) });
  }
  for (const m of xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)) {
    const b = m[0];
    const link = b.match(/<link[^>]*href="([^"]+)"/i)?.[1] || '';
    items.push({ source, title: strip(tag(b, 'title')), link: decode(link), date: strip(tag(b, 'updated') || tag(b, 'published')),
      summary: strip(tag(b, 'summary') || tag(b, 'content')).slice(0, 600) });
  }
  return items.filter(i => i.title && i.link);
}

// ---- fetchers ----
const UA = { 'User-Agent': 'VanorBD/1.0 (+https://vanor-bd.vercel.app)' };
async function get(url: string, ms = 15000) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms), cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
}

export async function fetchPlanIt(errors: string[]): Promise<Signal[]> {
  const out: Signal[] = [];
  await Promise.all(CONFIG.planningKeywords.map(async kw => {
    const p = new URLSearchParams({ search: kw, recent: String(CONFIG.planningRecentDays), pg_sz: '100', app_size: CONFIG.planningMinSize });
    if (process.env.PLANIT_KEY) p.set('auth', process.env.PLANIT_KEY);
    try {
      const json = await (await get(`https://www.planit.org.uk/api/applics/json?${p}`, 25000)).json();
      for (const r of json.records || []) {
        const applicant = [r.applicant, r.agent].filter(Boolean).join(' / ') || '';
        out.push({
          source: 'planit', applicant: r.applicant || '',
          title: `${r.area_name || ''}: ${String(r.description || '').slice(0, 110)}`,
          link: r.link || r.url || '', date: r.start_date || r.last_changed || '',
          summary: `${r.description || ''} | Address: ${r.address || ''} | Status: ${r.app_state || ''} | Type: ${r.app_type || ''} | Size: ${r.app_size || ''} | Applicant/agent: ${applicant}`.slice(0, 600),
        });
      }
    } catch (e) { errors.push(`planit "${kw}": ${e instanceof Error ? e.message : e}`); }
  }));
  return out;
}

export async function fetchPlanningDataGov(errors: string[]): Promise<Signal[]> {
  const since = new Date(Date.now() - CONFIG.planningRecentDays * 86400000).toISOString().slice(0, 10);
  const p = new URLSearchParams({ dataset: 'planning-application', limit: '500', entry_date: since, entry_date_match: 'since' });
  try {
    const json = await (await get(`https://www.planning.data.gov.uk/entity.json?${p}`, 25000)).json();
    return (json.entities || [])
      .filter((e: any) => CONFIG.planningKeywords.some(k => JSON.stringify(e).toLowerCase().includes(k)))
      .map((e: any) => ({
        source: 'planning_data_gov', title: `${e['organisation-entity'] || 'LPA'}: ${String(e.description || e.name || '').slice(0, 110)}`,
        link: `https://www.planning.data.gov.uk/entity/${e.entity}`, date: e['entry-date'] || '',
        summary: `${e.description || ''} | Reference: ${e.reference || ''} | Decision: ${e.decision || ''} | Status: ${e.status || ''}`.slice(0, 600),
      }));
  } catch (e) { errors.push(`planning.data.gov.uk: ${e instanceof Error ? e.message : e}`); return []; }
}

export async function fetchFeeds(errors: string[]): Promise<Signal[]> {
  const out: Signal[] = [];
  await Promise.all(Object.entries(FEEDS).map(async ([name, url]) => {
    try { out.push(...parseFeed(await (await get(url)).text(), name)); }
    catch (e) { errors.push(`${name}: ${e instanceof Error ? e.message : e}`); }
  }));
  return out;
}

export async function companiesHouseDirectors(name: string) {
  const key = (process.env.COMPANIES_HOUSE_KEY || '').replace(/\s+/g, '');
  if (!key || !name) return [];
  const auth = { Authorization: 'Basic ' + Buffer.from(key + ':').toString('base64') };
  try {
    const s = await (await fetch(`https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(name)}&items_per_page=3`, { headers: auth, signal: AbortSignal.timeout(10000) })).json();
    const co = (s.items || []).find((i: any) => i.company_status === 'active'); if (!co) return [];
    const o = await (await fetch(`https://api.company-information.service.gov.uk/company/${co.company_number}/officers?items_per_page=10`, { headers: auth, signal: AbortSignal.timeout(10000) })).json();
    return (o.items || []).filter((x: any) => !x.resigned_on && ['director', 'llp-member'].includes(x.officer_role))
      .map((x: any) => `${x.name} (${x.officer_role}, ${co.title} ${co.company_number})`).slice(0, 6) as string[];
  } catch { return []; }
}

/** Fetch everything, keep real signals, score, dedupe by link, best first. */
export async function scan(today = new Date()) {
  const errors: string[] = [];
  const all = (await Promise.all([fetchFeeds(errors), fetchPlanIt(errors), fetchPlanningDataGov(errors)])).flat();
  const seen = new Set<string>();
  const scored = all.filter(isSignal).filter(s => s.link && !seen.has(s.link) && seen.add(s.link)).map(s => score(s, today))
    .sort((a, b) => b.score - a.score);
  return { fetched: all.length, signals: scored.length, scored, errors };
}

export function leadContext(s: Scored, directors: string[], known: string[]) {
  return [
    `${s.title}.`,
    `Score ${s.score}/100 (complexity ${s.complexity}, distress ${s.distress}, money ${s.money}, timing ${s.timing}). Buyer type: ${s.buyerType.replace('_', ' ')}; signs: ${s.signs}.`,
    s.summary,
    s.contractors.length ? `Contractors named: ${s.contractors.join(', ')}.` : '',
    directors.length ? `Directors (Companies House): ${directors.join('; ')}.` : '',
    known.length ? `Already on the board at this organisation: ${known.join(', ')}.` : '',
  ].filter(Boolean).join(' ').slice(0, 1500);
}
