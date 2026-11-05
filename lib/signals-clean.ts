// Pure cleaning rules for the Signals feed. No imports, so they can be tested on their own.
const norm = (s = '') => String(s).toLowerCase().replace(/\b(ltd|limited|plc|llp|group|holdings|uk|the)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Cleaning rules (31 Oct 2026). Working settings, not evidence: reviewed at day 30 against the outcome log.
export const PLANNING_FLOOR_M = 5; // Barry: ignore planning records under £5m
/** Lower bound of a value band such as "£5m–£20m", "£100m+", "Value unknown", in £m; 0 when unknown. */
export const valueFloor = (band = ''): number => { const m = String(band).replace(/,/g, '').match(/£\s?(\d+(?:\.\d+)?)\s?(m|bn|k)?/i); if (!m) return 0; const n = parseFloat(m[1]); const u = (m[2] || 'm').toLowerCase(); return u === 'bn' ? n * 1000 : u === 'k' ? n / 1000 : n; };
const GENERIC_COMPANY = new Set(['plans', 'plan', 'work', 'works', 'new', 'latest', 'council', 'scheme', 'project', 'site', 'group']);
/** A company name that is really a headline fragment, or the headline itself, is blanked so the row reads "needs company". */
export const cleanCompany = (company = '', headline = ''): string => {
  const c = String(company).trim(); if (!c) return '';
  const n = norm(c); const h = norm(headline);
  if (/&(hellip|nbsp|#\d+|[a-z]+;)|…|\.\.\.$/.test(c) || GENERIC_COMPANY.has(n) || (n.length > 3 && n === h) || c.split(/\s+/).length > 12) return '';
  return c;
};
const LOW_VALUE_NOTE = /\b(context only|no outreach|low fit|watch only|not a vanor buyer)\b/i;
/** Caps and labels: no Hot without a named party; the Claude note "context only / low fit" caps the row at Watch. */
export function tidyItem<T extends { tier: string; score: number; why: string; whyScore: string; parties: Record<string, string>; company: string; headline: string; hasPerson?: boolean }>(it: T): T & { needsContact: boolean } {
  // A company being named is not a person being named: needsContact is true unless a real individual is attached.
  const needsContact = !it.hasPerson;
  let { tier, score } = it;
  if (LOW_VALUE_NOTE.test(it.why || '')) { tier = 'Watch'; score = Math.min(score, 30); }
  else if (tier === 'Hot' && needsContact) tier = 'Warm';
  return { ...it, tier, score, needsContact, company: cleanCompany(it.company, it.headline) };
}
/** One row per record id and signal key, then one per company and stage (newest wins). */
export function dedupeItems<T extends { id: string; key: string; date: string; company: string; stage: string; headline: string }>(items: T[]): T[] {
  const sorted = [...items].sort((a, b) => b.date.localeCompare(a.date));
  const seen = new Set<string>(); const out: T[] = [];
  for (const it of sorted) {
    const k1 = `${it.id}|${it.key}`; const co = norm(it.company); const bor = norm((it as any).parties?.borrower || '');
    const k2 = co && co.length > 3 ? `${co}|${bor}|${it.stage}` : `${norm(it.headline)}|${it.stage}`;
    if (seen.has(k1) || seen.has(k2)) continue; seen.add(k1); seen.add(k2); out.push(it);
  }
  return out;
}

/** Who to call and what to offer for each kind of trigger (expert panel, 31 Oct 2026). */
export const TRIGGER: Record<string, { who: string; angle: string }> = {
  distress: { who: "The lender's workout or monitoring lead, the employer, or the administrator (never the insolvent firm)", angle: 'A two-week position review: what is built, what it costs to finish, and the completion route.' },
  funded: { who: "The funder's credit or asset-management lead, and the developer's development director", angle: 'Independent monitoring from first drawdown, or a pre-start peer review of programme and cost.' },
  stalled: { who: "The development director, or the funder's asset manager", angle: 'Position finding and a recovery plan before the restart is fixed.' },
  contractor_appointed: { who: "The client's development director, or the funder", angle: 'An early-warning review of the contractor\'s programme and cost as works start.' },
  acquired: { who: "The new owner's asset manager or development director", angle: 'A peer review before the team is fixed; for hotels, a refurbishment or PIP cost review.' },
  granted: { who: "The applicant's development director", angle: 'Who owns delivery risk before the contractor is appointed?' },
  tender: { who: "The buyer's procurement lead (check the framework route first)", angle: 'Bid or no-bid: does the scope fit and is the deadline workable?' },
  leadership: { who: 'The newly appointed director', angle: 'An introduction in their first 90 days.' },
  on_site: { who: "The client's development director or the funder", angle: 'Independent monitoring or a mid-build position check.' },
};
export const triggerFor = (stage = '') => TRIGGER[stage] || { who: 'Whoever loses money if the date moves', angle: 'A short, specific observation and a 20-minute call.' };

// ---- Lanes (5 Nov 2026, v8). Every signal gets the lane it would be sold in, so the page can say which lanes are quiet. ----
export type Lane = 'funder' | 'claims' | 'dc' | 'hotel' | 'offices' | 'other';
export const LANE_LABEL: Record<Lane, string> = { funder: 'Funders', claims: 'Claims & disputes', dc: 'Data centres', hotel: 'Hotels', offices: 'Offices', other: 'Other project work' };
const DC = /\bdata ?cent(re|er)s?\b|hyperscale|colocation|\bcolo\b|\b\d{2,4}\s?mw\b|\bai campus\b|\bgpu\b/i;
const HOTEL = /\bhotels?\b|hospitality|\bresorts?\b|aparthotel|serviced apartments?|\bhostel|\binn\b|\bpip\b/i;
const OFFICES = /\boffices?\b|\bhq\b|headquarters|workspace|\bcat ?[ab]\b|lease (end|expiry|event)|refit|fit[- ]?out|relocat/i;
const CLAIMS = /adjudicat|arbitrat|\bdispute|\bclaims?\b|delay (claim|analysis)|extension of time|\beot\b|\btcc\b|technology and construction court|judgment|\bv\.? [A-Z]|litigat|final account|termination|liquidated damages/i;
const FUNDER = /\bfacility\b|\bloan\b|\blender|\bdebt\b|refinanc|\bfunding\b|\bfunded\b|\bfinanc(e|ing)\b|credit (fund|committee)|drawdown|\bmonitoring\b|administrat|receiver|insolven|liquidat|wind(ing)?[- ]up|\bworkout\b|recover/i;
/** The lane a signal belongs to. Stage first (distress, funded and tenders for monitoring are funder work; disputes are claims), then the asset type. */
export function laneOfSignal(s: { headline?: string; text?: string; stage?: string; sector?: string; source?: string; buyerType?: string }): Lane {
  const t = `${s.headline || ''} ${s.text || ''} ${s.sector || ''}`;
  if (s.source === 'tcc_judgments' || s.stage === 'dispute') return 'claims';
  if (DC.test(t)) return 'dc';
  if (['distress', 'funded'].includes(s.stage || '') || s.buyerType === 'lender' || s.buyerType === 'fund') return 'funder';
  if (CLAIMS.test(t) && !/claims? (team|handler|manager)/i.test(t)) return 'claims';
  if (HOTEL.test(t)) return 'hotel';
  if (OFFICES.test(t) && !/office(s)? (block|to resi|conversion)/i.test(t)) return 'offices';
  if (FUNDER.test(t)) return 'funder';
  return 'other';
}
// Development lenders and debt funds active in UK and Irish real estate (public market knowledge, not contact data).
// Names that are also ordinary words or borrower-type firms are left out on purpose: precision beats coverage here.
export const LENDERS = ['NatWest', 'HSBC', 'Lloyds', 'Barclays', 'Santander', 'OakNorth', 'Shawbrook', 'Aldermore', 'Paragon Bank', 'Hampshire Trust Bank', 'United Trust Bank', 'Secure Trust Bank', 'Close Brothers', 'Atelier Capital Partners', 'Octopus Real Estate', 'Maslow Capital', 'Puma Property Finance', 'Precise Mortgages', 'Cheyne Capital', 'Starwood Capital', 'Ares Management', 'Blackstone', 'Apollo Global', 'ICG Real Estate', 'LaSalle', 'Pluto Finance', 'Fiera Real Estate', 'Zenzic Capital', 'Coutts', 'Investec', 'Allica Bank', 'Cynergy Bank', 'Arbuthnot Latham', 'Bank Leumi', 'Hilltop Credit Partners', 'Avamore Capital', 'Silbury Finance', 'HBFI', 'Home Building Finance Ireland', 'AIB', 'Bank of Ireland', 'Activate Capital', 'Homes England', 'GB Bank', 'Recognise Bank', 'Pollen Street', 'Tristan Capital', 'BlackRock', 'M&G', 'Aviva Investors', 'Legal & General', 'Canada Life', 'PGIM', 'Nuveen', 'Cain International', 'Patron Capital', 'MSP Capital', 'CrowdProperty', 'Blend Network', 'Assetz Capital', 'LendInvest', 'Ultimate Finance', 'Hunter Finance', 'Reward Finance', 'Bluecastle Capital', 'Glenhawk', 'Mint Property Finance', 'Octane Capital', 'MT Finance', 'ASK Partners', 'Fortwell Capital', 'Cohort Capital', 'Alpha Property Lending', 'Tuscan Capital', 'Beaufort Capital', 'Metro Bank', 'Virgin Money', 'Nationwide'];
const esc = (l: string) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LENDER_ALT = LENDERS.slice().sort((a, b) => b.length - a.length).map(esc).join('|');
// Case-sensitive, and only in lender context: "from X", "by X", "X facility/loan/debt/funding", "lender X", "X-backed".
const LENDER_CTX = new RegExp('(?:\\b(?:from|by|with|lender|lenders|backed by|provided by|arranged by|agreed with|secured from)\\s+(' + LENDER_ALT + ')\\b)|(?:\\b(' + LENDER_ALT + ')\\b(?:[\'’]s)?\\s+(?:facility|loan|debt|funding|finance|financing|refinancing|development finance|senior debt|mezzanine|credit|package)\\b)|(?:\\b(' + LENDER_ALT + ')-(?:backed|funded|led))');
/** The lender named in lender context in a headline or summary; '' when none or when two different lenders are named. */
export function lenderIn(text = ''): string {
  const found = new Set<string>();
  const re = new RegExp(LENDER_CTX.source, 'g'); let m: RegExpExecArray | null;
  while ((m = re.exec(String(text)))) { const hit = m[1] || m[2] || m[3]; if (hit) found.add(hit); if (m[0].length === 0) re.lastIndex++; }
  return found.size === 1 ? [...found][0] : '';
}
/** Plain job titles to search for a signal's "who to call" role, by stage and lane (used by the candidate finder). */
export function titlesFor(stage = '', lane: Lane = 'other'): string[] {
  if (lane === 'funder' && (stage === 'funded' || stage === 'distress')) return ['Head of Real Estate Finance', 'Relationship Director', 'Portfolio Manager', 'Head of Asset Management', 'Credit Director'];
  if (lane === 'claims') return ['Commercial Director', 'Development Director', 'Managing Director', 'General Counsel'];
  if (lane === 'dc') return ['Head of Construction', 'Development Director', 'Programme Director', 'Chief Development Officer'];
  if (lane === 'hotel') return ['Head of Development', 'Asset Manager', 'Director of Projects', 'Chief Operating Officer'];
  if (lane === 'offices') return ['Head of Property', 'Head of Workplace', 'Facilities Director', 'Chief Operating Officer'];
  if (stage === 'acquired') return ['Head of Asset Management', 'Development Director', 'Investment Director'];
  return ['Development Director', 'Head of Development', 'Managing Director', 'Project Director'];
}
