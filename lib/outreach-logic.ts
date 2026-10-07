// Outreach engine (pure): picks the angle and writes a first draft in Barry's voice for one contact.
// Rule-built so it runs for hundreds of contacts in seconds; the scheduled Claude run polishes the top ones.
// Nothing here sends anything. No database imports, so tests and the browser can share it.
type Entity = { id: string; [key: string]: any };

export type Draft = {
  kind: 'signal' | 'nurture' | 'intro' | 'first' | 'chase' | 'call';
  angle: string; subject: string; body: string; to: string;
  status: 'suggested' | 'edited' | 'approved' | 'pushed' | 'skipped';
  origin: 'engine' | 'Claude' | 'founder'; generatedAt: string; template?: string; approvedAt?: string; approvedBy?: string; pushedAt?: string; outlookId?: string; via?: string;
};

const DAY = 864e5;
const norm = (s = '') => String(s).toLowerCase().replace(/\b(ltd|limited|plc|llp|group|holdings|uk|the)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const first = (name = '') => String(name).trim().split(/\s+/)[0] || '';
const daysAgo = (d?: string) => { const t = Date.parse(d || ''); return isNaN(t) ? 9999 : (Date.now() - t) / DAY; };

/** "w/c 20th October": the Monday at least 8 days out, so the ask lands a clear week ahead. */
export function weekCommencing(from = new Date()): string {
  const d = new Date(from); d.setDate(d.getDate() + 8);
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  const n = d.getDate(); const sfx = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
  return `w/c ${n}${sfx} ${d.toLocaleDateString('en-GB', { month: 'long' })}`;
}

const greeting = (name: string) => `Hi ${first(name) || 'there'},`;
const SIGN_FIRST = 'Kind regards,\nBarry';
const SIGN = 'Regards,\nBarry';
const VANOR = 'Graeme and I set up Vanor after years on the contractor side. We work client-side, alongside the existing team';


/** Editable templates. Placeholders: {first} {company} {wc} {offer} {scheme} {via_first} {name} {vanor}. Founders edit these in the board (Templates). */
export type Template = { key: string; label: string; when: string; subject: string; body: string };
export const DEFAULT_TEMPLATES: Template[] = [
  { key: 'first_approach', label: 'First approach (cold, right buyer)', when: 'Grade A, no trigger, no way in', subject: 'Coffee?',
    body: "Hi {first},\n\nThought I'd drop you a line.\n\n{vanor}; mainly {offer}.\n\nWould you be up for a coffee {wc}? Happy to come to you.\n\nKind regards,\nBarry" },
  { key: 'signal_cold', label: 'Signal-led, cold', when: 'Dated trigger (planning, funding, new vehicle), not yet a relationship', subject: 'Coffee?',
    body: "Hi {first},\n\n{opener}\n\n{vanor}; mainly {offer}.\n\nWould you be up for a coffee {wc}? Happy to come to you.\n\nKind regards,\nBarry" },
  { key: 'signal_warm', label: 'Signal-led, warm', when: 'Dated trigger and we already know them', subject: 'Due a catch up',
    body: "Hi {first},\n\n{opener_warm}\n\nIf there's a contractor programme or cost plan you'd like a second pair of eyes on before it starts, happy to take a look. Can we get something in {wc}?\n\nRegards,\nBarry" },
  { key: 'nurture', label: 'Catch up (warm, no trigger)', when: 'Known contact, nothing live', subject: 'Due a catch up',
    body: "Hi {first},\n\nDue a catch up. Hows all with you guys, keeping busy?\n\nWould be good to hear what's coming through at {company} and whether there's anywhere we could help, {offer}.\n\nCan we get something in {wc}? Happy to come to you.\n\nRegards,\nBarry" },
  { key: 'chase1', label: 'Chase 1 (from day 4)', when: 'We wrote, no reply after 4 working days', subject: 'Following up',
    body: "Hi {first},\n\nJust following up on the below. Can we get 20 minutes in {wc}? Happy to come to you.\n\nRegards,\nBarry" },
  { key: 'chase2', label: 'Chase 2 (day 9 to 20)', when: 'Second chase, then we stop', subject: 'Last one from me',
    body: "Hi {first},\n\nLast one from me on this. If it's not the right time, no problem at all, just say and I'll leave it there.\n\nIf it is, I'm around {wc} and happy to come to you.\n\nRegards,\nBarry" },
  { key: 'intro_ask', label: 'Ask a warm contact for an intro', when: 'Target is cold or has no email and we know a colleague', subject: 'Intro to {first}?',
    body: "Hi {via_first},\n\nQuick one. Would you be happy to introduce me to {name} at {company}? Looks like the sort of job where {offer}.\n\nA two-line email is plenty, happy to take it from there and will keep you in the loop.\n\nRegards,\nBarry" },
  { key: 'post_meeting', label: 'After a meeting', when: 'Logged meeting with no follow-up sent', subject: 'Thanks for today',
    body: "Hi {first},\n\nThanks for today, good to catch up properly.\n\nAs discussed, {promise}.\n\n{ask}\n\nRegards,\nBarry" },
  { key: 'proposal_cover', label: 'Proposal cover note', when: 'Sending a Stress Test or peer review proposal', subject: 'Proposal: {scheme}',
    body: "Hi {first},\n\nAs discussed, please find attached our proposal for {scheme}.\n\nWe've set it out in stages so you can start with the peer review and position finding and go from there.\n\nHappy to talk it through, can we get 20 minutes in {wc}?\n\nRegards,\nBarry" },
];
export function renderTemplate(t: { subject: string; body: string }, vars: Record<string, string>) {
  const sub = (s: string) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  return { subject: sub(t.subject), body: sub(t.body).replace(/\n{3,}/g, '\n\n').trim() };
}
export function templateMap(overrides?: Array<Partial<Template> & { key: string }>) {
  const m = new Map(DEFAULT_TEMPLATES.map(t => [t.key, { ...t }]));
  (overrides || []).forEach(o => { const base = m.get(o.key); if (!base) return; const patch: Partial<Template> = {}; if (o.subject) patch.subject = o.subject; if (o.body) patch.body = o.body; m.set(o.key, { ...base, ...patch }); });
  return m;
}

type Signal = { type: string; date?: string; text?: string };
function topSignal(r: Entity): Signal | null {
  const sigs: Signal[] = (r.companyIntel?.signals || []).filter((s: Signal) => s.type !== 'inactive' && daysAgo(s.date) <= 180);
  const weight: Record<string, number> = { property: 5, lending: 5, planning: 4, new_spv: 3, distress: 2, new_director: 1 };
  return sigs.sort((a, b) => (weight[b.type] || 0) - (weight[a.type] || 0) || daysAgo(a.date) - daysAgo(b.date))[0] || null;
}

/** A place name or scheme the way Barry would say it, from a planning signal; never a filing quote. */
function schemeHint(sig: Signal | null): string {
  if (!sig || sig.type !== 'planning') return '';
  const t = String(sig.text || '').replace(/^(planning|application|consent)[:\s-]*/i, '').split(/[.;|]/)[0].trim();
  return t.length > 6 && t.length < 70 ? t : '';
}

function offerFor(r: Entity, segment: string): string {
  if (/lender|debt|bank|credit|fund/i.test(segment)) return 'we act as the monitoring surveyor or do a quick independent position review when a loan drifts';
  if (/investor|private equity/i.test(segment)) return 'we do a short peer review of the contractor\'s programme and cost before a scheme starts, or position finding when one has drifted';
  if (/hotel|operator|hospitality/i.test(segment)) return 'we run a short peer review of the contractor\'s programme and cost before the refurb starts, or position finding when a job has slipped';
  if (/public|housing|council/i.test(segment)) return 'we do a focused peer review of one challenged scheme, or a first-principles reset where a project has stalled';
  if (/data cent/i.test(segment)) return 'we give the owner an independent view of the contractor\'s programme and cost, and monitor for the funder';
  return 'we do a short peer review of the contractor\'s programme and cost before a job starts, or position finding when one has drifted';
}

export type DraftInput = { r: Entity; d?: Entity | null; warm: boolean; cell: string; wayIn?: { name: string; company: string; email?: string } | null; lastSentDaysAgo?: number | null; touches?: number; segment: string; templates?: Map<string, Template> };

export function composeDraft(input: DraftInput): Draft | null {
  const { r, warm, cell, wayIn, segment } = input; const T = input.templates || templateMap();
  const name = r.name || ''; const company = r.company || ''; const email = r.email || '';
  const wc = weekCommencing(); const sig = topSignal(r); const scheme = schemeHint(sig);
  const now = new Date().toISOString();
  const base = { to: email, status: 'suggested' as const, origin: 'engine' as const, generatedAt: now };
  const vars: Record<string, string> = { first: first(name) || 'there', name, company, wc, offer: offerFor(r, segment), scheme, vanor: VANOR, via_first: wayIn ? first(wayIn.name) : '',
    opener: sig?.type === 'planning' && scheme ? `Saw ${scheme} has gone in, so thought I'd drop you a line.` : sig?.type === 'planning' ? `Saw you've got a scheme going through planning, so thought I'd drop you a line.` : `Sounds like you've got something moving at ${company}, so thought I'd drop you a line.`,
    opener_warm: sig?.type === 'planning' && scheme ? `Saw ${scheme} has gone in and we're due a catch up.` : `Sounds like you've got something moving at ${company} and we're due a catch up.` };
  const use = (key: string, kind: Draft['kind'], angle: string, extra: Partial<Draft> = {}): Draft => { const t = T.get(key)!; const out = renderTemplate(t, vars); return { ...base, kind, angle, subject: out.subject, body: out.body, template: key, ...extra } as Draft; };

  if (cell === 'C' || !name) return null;

  // Touches 2 and 3: we wrote, nothing came back.
  const touches = input.touches ?? (input.lastSentDaysAgo != null ? 1 : 0);
  if (input.lastSentDaysAgo != null && email) {
    const d = input.lastSentDaysAgo;
    if (touches >= 3) return null;
    if (touches === 2 && d >= 9 && d <= 20) return use('chase2', 'chase', `Second chase, ${Math.floor(d)} days since touch 2; then we stop`);
    if (touches === 1 && d >= 4 && d <= 35) return use('chase1', 'chase', `No reply for ${Math.floor(d)} days; one plain chase with a date`);
    if (d <= 35) return null; // too soon, or between windows: wait
  }

  if (sig?.type === 'distress') return { ...base, kind: 'call', angle: 'Distress signal on this company: a call to the exposed employer or funder beats an email to them', subject: '', body: '', to: '' };

  if (!email && wayIn?.email) return use('intro_ask', 'intro', `Ask ${wayIn.name} for an intro; no direct email for ${first(name)}`, { to: wayIn.email, via: wayIn.name });
  if (!email) return null;

  if (sig && ['property', 'lending', 'planning', 'new_spv'].includes(sig.type))
    return use(warm ? 'signal_warm' : 'signal_cold', 'signal', `${sig.type.replace('_', ' ')} signal ${sig.date || ''}: ${warm ? 'catch up and offer a peer review' : 'first approach with one concrete offer'}`);
  if (warm) return use('nurture', 'nurture', 'Warm relationship, no live trigger: catch up and ask what is next');
  if (wayIn?.email) return use('intro_ask', 'intro', `Cold target; ask ${wayIn.name} for an intro rather than write cold`, { to: wayIn.email, via: wayIn.name });
  if (cell.startsWith('A')) return use('first_approach', 'first', 'Right buyer, no trigger, no way in: short first approach with one offer');
  return null;
}

