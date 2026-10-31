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
    const k1 = `${it.id}|${it.key}`; const co = norm(it.company);
    const k2 = co && co.length > 3 ? `${co}|${it.stage}` : `${norm(it.headline)}|${it.stage}`;
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
