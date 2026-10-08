// Market + planning signal scanner (ported from vanor-intel: trigger_monitor, planning, buyers, lead_pipeline).
// Plain code, no AI: fetch feeds -> keep real signals -> score -> leads for the board's review queue.

import { classifyLead, isLeadWorthy, sellability, type Lead, type Sellability } from './lead-classify.ts';
export type Signal = { title: string; link: string; date: string; summary: string; source: string; applicant?: string; hint?: { applicant?: string; authority?: string; appType?: string; appState?: string; appSize?: string } };
export type Scored = Signal & {
  score: number; complexity: number; distress: number; money: number; timing: number;
  buyerType: string; talkTo: string; signs: string; organisation: string; contractors: string[]; lead: Lead; sell: Sellability;
};

export const CONFIG = {
  sectors: ['hotel', 'hospitality', 'hospital', 'school', 'university', 'student accommodation', 'theatre', 'museum', 'gallery', 'office',
    'mixed use', 'mixed-use', 'listed building', 'heritage', 'refurbishment', 'refurb', 'change of use', 'conversion', 'fit-out',
    'extension and alteration', 'residential', 'build to rent', 'data centre', 'data center'],
  planningKeywords: ['refurbishment', 'change of use', 'listed building consent', 'conversion', 'hotel', 'mixed use',
    'student accommodation', 'office', 'build to rent', 'data centre'],
  planningMinSize: 'Large',
  planningRecentDays: 7,
  signalWords: ['petition to wind up', 'administrat', 'insolven', 'liquidat', 'notice of intent', 'delay', 'postpone', 'remain closed', 'refurb', 'renovat',
    'reopen', 'refinanc', 'loan', 'facility', 'acquire', 'acquisition', 'stalled', 'restart', 'ceased trading', 'collapse'],
  minScore: 30,
  maxPerRun: 15,
};

// Feeds that fail are reported by name in the 08:10 run; prune or fix from there.
export const FEEDS: Record<string, string> = {
  construction_enquirer: 'https://www.constructionenquirer.com/feed/',
  estates_gazette: 'https://eg.co.uk/feed/',
  property_week: 'https://www.propertyweek.com/rss',
  construction_news: 'https://www.constructionnews.co.uk/feed/',
  place_north_west: 'https://www.placenorthwest.co.uk/feed/',
  architects_journal: 'https://www.architectsjournal.co.uk/feed',
  insider_media: 'https://www.insidermedia.com/rss/news',
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
const DISTRESS: Record<string, number> = { 'petition to wind up': 30, administrat: 25, 'notice of intent': 25, insolven: 25, liquidat: 20, delay: 15, postpone: 15,
  'remain closed': 20, behind: 10, dispute: 15, adjudicat: 15, terminat: 20, replace: 10, 'new contractor': 15, slipped: 15, 'later than': 10,
  stalled: 15, 'ceased trading': 25, collapse: 20 };
const MONEY: Record<string, number> = { '£': 4, million: 6, bed: 4, rooms: 4, facility: 6, loan: 6, refinanc: 6, charge: 4, 'sq ft': 4, phase: 3 };
const sum = (table: Record<string, number>, t: string) => Object.entries(table).reduce((n, [k, v]) => n + (t.includes(k) ? v : 0), 0);

export function classify(text: string) {
  const t = text.toLowerCase();
  for (const [kind, words] of KEYS) if (words.some(w => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t))) return kind;
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

const PLANNING_NOISE = /householder|pursuant to condition|condition \d+|details reserved by|non[- ]material amendment|\bnma\b|section 73|\bs73\b|minor material amendment|discharge of condition|approval of details|prior approval|prior notification|lawful development|certificate of lawful|advertisement consent|\badvert\b|tree works|tpo\b|listed building consent only|variation of condition|removal of condition/i;
export function isSignal(s: Signal) {
  const t = `${s.title} ${s.summary}`.toLowerCase();
  if (s.source === 'planit' || s.source === 'planning_data_gov' || s.source === 'london_datahub')
    return !t.includes('size: small') && !PLANNING_NOISE.test(t) && CONFIG.sectors.some(k => t.includes(k));
  if (s.source.startsWith('gazette')) return true;
  // Press: a stage we act on, a sector we serve, and a size or a named party (Glenigan's 10 homes / £250k rule).
  return isLeadWorthy(classifyLead(`${s.title}. ${s.summary}`, s.hint));
}

const CONTRACTOR_NAME = /\b(mechanical|electrical|m ?& ?e|construction|contractors?|contracting|building|builders|scaffold\w*|roofing|cladding|groundworks?|civils?|civil engineering|interiors|fit[- ]?out|joinery|plumbing|drylining|plastering|brickwork|carpentry|demolition|steel\w*|glazing|flooring|decorat\w*|plant hire|engineering services)\b/i;
export function score(s: Signal, today = new Date()): Scored {
  const text = `${s.title} ${s.summary} ${s.applicant || ''}`;
  const t = text.toLowerCase();
  const complexity = Math.min(30, sum(COMPLEXITY, t));
  const distress = Math.min(40, sum(DISTRESS, t));
  const money = Math.max(Math.min(20, sum(MONEY, t)), moneySignal(text));
  const timing = distress ? 10 : 4;
  const lead = classifyLead(text, s.hint || (s.applicant ? { applicant: s.applicant } : undefined));
  if ((s.source === 'planit' || s.source === 'london_datahub') && ['news', 'leadership'].includes(lead.stage)) lead.stage = 'submitted';
  if (s.source.startsWith('gazette')) { lead.stage = 'distress'; if (s.applicant && CONTRACTOR_NAME.test(s.applicant)) lead.parties.contractor = s.applicant; }
  let buyerType = classify(s.applicant || lead.parties.developer || lead.parties.funder || text);
  if (buyerType === 'unknown' && ((s.source === 'planit' || s.source === 'london_datahub') && s.applicant || lead.parties.developer)) buyerType = 'developer';
  if (buyerType === 'unknown' && lead.parties.funder) buyerType = 'lender';
  const sell = sellability(lead, buyerType, text, s.date, { today });
  return {
    ...s, complexity, distress, money, timing, buyerType,
    score: sell.score,
    talkTo: sell.call, signs: BUYERS[buyerType].signs,
    organisation: (s.applicant || lead.parties.developer || lead.parties.funder || '').trim(), contractors: contractorsIn(text), lead, sell,
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

/** PlanIt (planit.org.uk): free, no key, but rate-limited and 403s bursty callers. One combined `or` search, paged sequentially, honouring Retry-After. */
export async function fetchPlanIt(errors: string[]): Promise<Signal[]> {
  const out: Signal[] = [];
  const search = CONFIG.planningKeywords.map(k => (k.includes(' ') ? `"${k}"` : k)).join(' or ');
  const ua = { 'User-Agent': 'Mozilla/5.0 (compatible; VanorBD/1.1; +https://vanor-bd.vercel.app; barryw@vanoradvisory.co.uk)' };
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  const deadline = Date.now() + 30000;
  for (let page = 1; page <= 4 && Date.now() < deadline; page++) {
    const p = new URLSearchParams({ search, recent: String(CONFIG.planningRecentDays), pg_sz: '100', page: String(page), app_size: CONFIG.planningMinSize, compress: 'on', sort: '-start_date' });
    let attempt = 0;
    while (attempt < 3) {
      attempt++;
      try {
        const r = await fetch(`https://www.planit.org.uk/api/applics/json?${p}`, { headers: ua, signal: AbortSignal.timeout(12000), cache: 'no-store' });
        if (r.status === 429) { const wait = Math.min(30000, (Number(r.headers.get('Retry-After')) || 5) * 1000); await sleep(wait); continue; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = await r.json();
        const records = json.records || [];
        for (const rec of records) {
          const applicant = [rec.applicant, rec.agent].filter(Boolean).join(' / ') || '';
          out.push({
            source: 'planit', applicant: rec.applicant || '', hint: { applicant: rec.applicant || '', authority: rec.area_name || '', appType: rec.app_type || '', appState: rec.app_state || '', appSize: rec.app_size || '' },
            title: `${rec.area_name || ''}: ${String(rec.description || '').slice(0, 110)}`,
            link: rec.link || rec.url || '', date: rec.start_date || rec.last_changed || '',
            summary: `${rec.description || ''} | Address: ${rec.address || ''} | Status: ${rec.app_state || ''} | Type: ${rec.app_type || ''} | Size: ${rec.app_size || ''} | Applicant/agent: ${applicant}`.slice(0, 600),
          });
        }
        if (records.length < 100 || (json.to != null && json.total != null && json.to >= json.total)) return out;
        break;
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (attempt >= 3 || !/HTTP 403|HTTP 5\d\d|timeout|abort/i.test(m)) { errors.push(`planit page ${page}: ${m}${m.includes('403') ? ' (IP or User-Agent refused; the scan retries slower next time)' : ''}`); return out; }
        await sleep(3000 * attempt);
      }
    }
    await sleep(1500);
  }
  return out;
}

/** Planning London Datahub (GLA): all London boroughs, guest Elasticsearch API, structured units/floorspace. */
export async function fetchLondonDatahub(errors: string[]): Promise<Signal[]> {
  const since = new Date(Date.now() - CONFIG.planningRecentDays * 86400000).toISOString().slice(0, 10);
  const body = { size: 200, query: { bool: { must: [{ range: { valid_date: { gte: since } } }, { query_string: { query: '(' + CONFIG.planningKeywords.map(k => `"${k}"`).join(' OR ') + ' OR "residential units" OR "mixed use" OR hotel OR offices) AND NOT (householder OR "non-material" OR "discharge of" OR "prior approval" OR advertisement OR tree)', default_field: 'description' } }] } } };
  try {
    const r = await fetch('https://planningdata.london.gov.uk/api-guest/applications/_search', { method: 'POST', headers: { ...UA, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(25000), cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const json = await r.json();
    return (json.hits?.hits || []).map((h: any) => h._source || {}).filter((e: any) => e.description).map((e: any) => {
      const det = e.application_details || {}; const units = det.residential_details?.total_no_proposed_residential_units; const gia = det.total_gia_proposed;
      const addr = [e.site_name, e.site_number, e.street_name, e.postcode].filter(Boolean).join(' ');
      return {
        source: 'london_datahub', applicant: '', hint: { authority: e.lpa_name || e.borough || '', appType: e.application_type || '', appState: e.status || e.decision || '', appSize: units >= 10 || gia >= 1000 ? 'Large' : '' },
        title: `${e.lpa_name || e.borough || 'London'}: ${String(e.description || '').slice(0, 110)}`,
        link: e.url_planning_app || `https://planningdata.london.gov.uk/?lpa_app_no=${encodeURIComponent(e.lpa_app_no || '')}`, date: e.valid_date || e.decision_date || e.last_updated || '',
        summary: `${e.description || ''} | Address: ${addr} | Status: ${e.status || ''} ${e.decision || ''} | Type: ${e.application_type || ''} ${e.development_type || ''} | Size: ${units ? units + ' homes' : ''} ${gia ? gia + ' sq m' : ''} | Ref: ${e.lpa_app_no || ''}`.slice(0, 600),
      } as Signal;
    });
  } catch (e) { errors.push(`london_datahub: ${e instanceof Error ? e.message : e}`); return []; }
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

// The Gazette notice-type feeds (thegazette.co.uk/data): titles are company names, so filter to construction/property firms.
export const GAZETTE_TYPES: Record<string, string> = { '2450': 'Petition to wind up', '2441': 'Appointment of administrators', '2410': 'Appointment of liquidators' };
const BUILT_ENV = /\b(construct\w*|build\w*|contract\w*|develop\w*|homes?|propert\w*|estates?|interiors?|fit[- ]?out|joinery|scaffold\w*|groundwork\w*|civil\w*|engineering|mechanical|electrical|m ?& ?e|plumbing|roofing|cladding|facades?|steel|concrete|demolition|housing|living|hotels?|hospitality|land|regeneration|refurb\w*|carpentry|brickwork|drylining|partition\w*|glazing|windows)\b/i;
export function gazetteSignals(xml: string, code: string): Signal[] {
  const label = GAZETTE_TYPES[code] || 'Insolvency notice';
  return parseFeed(xml, `gazette_${code}`).filter(n => BUILT_ENV.test(n.title)).map(n => ({
    ...n, applicant: n.title, title: `${label}: ${n.title}`,
    summary: `${label} notice in The Gazette for ${n.title}. Contractor or developer distress: projects, employers and funders exposed.`,
  }));
}
export async function fetchGazette(errors: string[]): Promise<Signal[]> {
  const out: Signal[] = [];
  await Promise.all(Object.keys(GAZETTE_TYPES).map(async code => {
    try { out.push(...gazetteSignals(await (await get(`https://www.thegazette.co.uk/insolvency/notice/data.feed?noticetypes=${code}&results-page-size=100`)).text(), code)); }
    catch (e) { errors.push(`gazette ${code}: ${e instanceof Error ? e.message : e}`); }
  }));
  return out;
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
  const all = (await Promise.all([fetchFeeds(errors), fetchGazette(errors), fetchPlanIt(errors), fetchLondonDatahub(errors)])).flat();
  const seen = new Set<string>();
  const scored = all.filter(isSignal).filter(s => s.link && !seen.has(s.link) && seen.add(s.link)).map(s => score(s, today))
    .sort((a, b) => b.score - a.score);
  return { fetched: all.length, signals: scored.length, scored, errors };
}

export function leadContext(s: Scored, directors: string[], known: string[]) {
  return [
    `${s.title}.`,
    `${s.sell.tier} ${s.score}/100: ${s.sell.why}.`,
    `Play: ${s.sell.play}. Call: ${s.sell.call}.`,
    `Stage: ${s.lead.stage.replace('_', ' ')}. Sector: ${s.lead.sector.replace('_', ' ')}. ${s.lead.valueBand}.${s.lead.region ? ' ' + s.lead.region + '.' : ''}${Object.entries(s.lead.parties).map(([k, v]) => ` ${k[0].toUpperCase() + k.slice(1)}: ${v}.`).join('')}`,
    s.summary,
    s.contractors.length ? `Contractors named: ${s.contractors.join(', ')}.` : '',
    directors.length ? `Directors (Companies House): ${directors.join('; ')}.` : '',
    known.length ? `Already on the board at this organisation: ${known.join(', ')}.` : '',
  ].filter(Boolean).join(' ').slice(0, 1500);
}
