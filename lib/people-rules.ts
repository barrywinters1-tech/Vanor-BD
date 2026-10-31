// Pure rules that put the people we already know onto a follow-up rhythm. No imports, so they can be tested alone.
// Working settings (31 Oct 2026), not evidence: reviewed at day 30 against what actually led to meetings.
export const LOOKBACK_DAYS = 365;

const LANE_WORDS: [string, RegExp][] = [
  ['funder', /\b(lender|lending|funder|debt fund|bank|asset management|recoveries|monitoring|administrator|insolvency|credit|investment director|private equity|family office|fund)\b/i],
  ['dc', /\b(data ?cent(re|er)s?|mission[- ]critical|hyperscale|colocation|colo)\b/i],
  ['hotel', /\b(hotel|hotels|hospitality|resort|inn|boutique)\b/i],
  ['claims', /\b(claims?|dispute|delay|disputes|quantum|expert witness|adjudicat\w*|arbitrat\w*)\b/i],
  ['offices', /\b(workplace|occupier|lease|tenant rep|office agent|corporate real estate|occupational)\b/i],
];
export const inferLane = (text = ''): string => { for (const [lane, re] of LANE_WORDS) if (re.test(text)) return lane; return 'other'; };

const ROLE_PLACEHOLDER = /^(head of|director|group property|hotels? &|development director|the |team|whoever|investment team|recoveries)/i;
export const isPlaceholder = (name = ''): boolean => !name.trim() || ROLE_PLACEHOLDER.test(name.trim()) || !/\s/.test(name.trim());

const validPast = (d: unknown, today: string): string => { const s = String(d || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && s <= today ? s : ''; };
const daysAgo = (d: string, today: string) => Math.round((Date.parse(today) - Date.parse(d)) / 864e5);

export type Rec = { id: string; name?: string; company?: string; jobTitle?: string; email?: string; context?: string; notes?: string; lastContact?: string };
export type Existing = { rung?: string; lastMet?: string };
export type Suggestion = { id: string; rung: 'active' | 'contact'; lane: string; lastMet?: string; basis: string } | { id: string; skip: string };

/** What to set for one contact who has no rung yet. Never overrides a founder-set rung (callers pass Existing). */
export function suggest(r: Rec, existing: Existing, openPursuits: { ids: Set<string>; emails: Set<string> }, today: string): Suggestion {
  if (existing.rung) return { id: r.id, skip: 'already has a rung' };
  if (isPlaceholder(r.name)) return { id: r.id, skip: 'role or first-name placeholder, not a person' };
  const email = String(r.email || '').toLowerCase();
  const lane = inferLane(`${r.company || ''} ${r.jobTitle || ''} ${r.context || ''}`);
  const lastContact = validPast(r.lastContact, today);
  if (openPursuits.ids.has(r.id) || (email && openPursuits.emails.has(email))) return { id: r.id, rung: 'active', lane, lastMet: lastContact || undefined, basis: 'on an open pursuit' };
  if (r.lastContact && !lastContact) return { id: r.id, skip: 'last-contact date is in the future or unreadable' };
  if (lastContact && daysAgo(lastContact, today) <= LOOKBACK_DAYS) return { id: r.id, rung: 'contact', lane, lastMet: lastContact, basis: `last contact ${lastContact}` };
  return { id: r.id, skip: lastContact ? 'last contact over a year ago' : 'no contact on record' };
}
