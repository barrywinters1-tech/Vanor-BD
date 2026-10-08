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
  { key: 'first_approach', label: 'First approach (cold, right buyer)', when: 'Grade A, no trigger, no way in', subject: '{company}: client-side support',
    body: "Hi {first},\n\nHope all's well. I'm getting in touch as {company} looks like the sort of business we'd like to be working with.\n\nGraeme and I set up Vanor after years on the contractor side. We support clients on the owner side of complex developments where additional senior bandwidth is needed around programme, commercial performance, risk and delivery, {offer}.\n\nRather than assume where the pressure points are, I'd be interested to hear how you're resourcing the client side of what you've got coming through and whether there's anywhere independent support would add value.\n\nIf useful, happy to have a short call or grab a coffee, equally happy to come over to you. Would {wc} work?\n\nKind regards,\nBarry" },
  { key: 'signal_cold', label: 'Signal-led, cold', when: 'Dated trigger (planning, funding, new vehicle), not yet a relationship', subject: '{scheme_or_company}: client-side delivery support',
    body: "Hi {first},\n\n{opener}\n\nGraeme and I set up Vanor after years on the contractor side. We support clients on the owner side where additional senior bandwidth is needed around programme, commercial performance, risk, mobilisation and delivery assurance, {offer}.\n\nGiven where {scheme_or_it} appears to be in its lifecycle, I thought it worth reaching out. Rather than assume where the pressure points are, I'd be interested to understand how you're resourcing the client side and whether there are any areas where independent support could add value.\n\nIf useful, I'd be happy to have a short discovery call, or grab a coffee, happy to come to you. Would {wc} work?\n\nKind regards,\nBarry" },
  { key: 'signal_warm', label: 'Signal-led, warm', when: 'Dated trigger and we already know them', subject: '{scheme_or_company}',
    body: "Hi {first},\n\nHope all's well at {company}.\n\n{opener_warm}\n\nFollowing on from our last catch up I was thinking whether a peer review or position finding exercise would be useful on it before things get fixed. Happy to talk through what that would look like, it's a light-touch, fixed-fee first stage and if we don't think it's needed we'll say so.\n\nCould we have a 20-minute call {wc}?\n\nRegards,\nBarry" },
  { key: 'nurture', label: 'Catch up (warm, no trigger)', when: 'Known contact, nothing live', subject: 'Catch up',
    body: "Hi {first},\n\nDue a catch up. Hows all with you guys, keeping busy?\n\nWould be good to hear what's coming through at {company} and whether there's anywhere we could help, {offer}.\n\nCan we get something in {wc}? Happy to come to you, or a spot of breakfast if easier.\n\nRegards,\nBarry" },
  { key: 'chase1', label: 'Chase 1 (from day 4)', when: 'We wrote, no reply after 4 working days', subject: 'Following up',
    body: "Hi {first},\n\nJust following up on the below in case it got buried.\n\nIf it's useful, could we have a 20-minute call {wc}? Equally happy to grab a coffee, I can come to you.\n\nRegards,\nBarry" },
  { key: 'chase2', label: 'Chase 2 (day 9 to 20)', when: 'Second chase, then we stop', subject: 'Last one from me',
    body: "Hi {first},\n\nLast one from me on this, I know how busy things get.\n\nIf the timing isn't right no problem at all, just say and I'll leave it there. If it's worth a conversation at some point, I'm around {wc} and happy to come to you.\n\nRegards,\nBarry" },
  { key: 'intro_ask', label: 'Ask a warm contact for an intro', when: 'Target is cold or has no email and we know a colleague', subject: 'Intro to {name}?',
    body: "Hi {via_first},\n\nHope all's well. Quick one.\n\nWould you be happy to introduce me to {name} at {company}? Looks like the sort of job where we could add value, {offer}, and a warm intro from you would go a long way.\n\nA two-line email is plenty, happy to take it from there and will keep you in the loop. And if there's anything I can do the other way, just say.\n\nRegards,\nBarry" },
  { key: 'post_meeting', label: 'After a meeting', when: 'Logged meeting with no follow-up sent', subject: 'Good to catch up',
    body: "Hi {first},\n\nGreat to catch up {when} and good to hear more about what you've got coming through at {company}.\n\nReally useful discussion, particularly around {promise}. It gave me a much better picture of where we may be able to support you as things develop.\n\n{ask}\n\nI'll keep in touch and, as discussed, happy to pick up anything where an extra pair of hands or some independent support would be useful.\n\nKind regards,\nBarry" },
  { key: 'proposal_cover', label: 'Proposal cover note', when: 'Sending a Stress Test or peer review proposal', subject: '{scheme}: proposal',
    body: "Hi {first},\n\nThanks again for your time {when}. As discussed, please find attached our proposal for {scheme}.\n\nWe've set it out in stages so each one is a separate appointment and you can decide whether and when to progress to the next. The first stage is fixed-fee and deliberately light-touch: it separates what's established from what's assumed, and if we don't think the next stage is needed we'll say so.\n\nHappy to talk it through, could we get 20 minutes {wc}?\n\nKind regards,\nBarry" },
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
  const t = String(sig.text || '').replace(/^(planning|application|consent)[:\s-]*/i, '').split(/[.;|]/)[0]
    .split(',').map(x => x.replace(/\b\d[\d,]*\s?-?\s?(beds?|keys|homes|units|rooms|apartments|flats|storeys?|sq\s?(ft|m))\b/gi, '').trim()).filter(Boolean).join(', ').trim();
  return t.length > 3 && t.length < 60 ? t : '';
}

function offerFor(r: Entity, segment: string): string {
  if (/lender|debt|bank|credit|fund/i.test(segment)) return 'typically acting as monitoring surveyor or a quick independent position review when a loan drifts';
  if (/investor|private equity/i.test(segment)) return 'typically a short peer review of the contractor\'s programme and cost before a scheme starts, or position finding when one has drifted';
  if (/hotel|operator|hospitality/i.test(segment)) return 'typically a short peer review of the contractor\'s programme and cost before the refurb starts, or position finding when a job has slipped';
  if (/public|housing|council/i.test(segment)) return 'typically a focused peer review of one challenged scheme, or a first-principles reset where a project has stalled';
  if (/data cent/i.test(segment)) return 'typically an independent view of the contractor\'s programme and cost for the owner, and monitoring for the funder';
  return 'typically a short peer review of the contractor\'s programme and cost before a job starts, or position finding when one has drifted';
}

export type DraftInput = { r: Entity; d?: Entity | null; warm: boolean; cell: string; wayIn?: { name: string; company: string; email?: string } | null; lastSentDaysAgo?: number | null; touches?: number; segment: string; templates?: Map<string, Template> };

export function composeDraft(input: DraftInput): Draft | null {
  const { r, warm, cell, wayIn, segment } = input; const T = input.templates || templateMap();
  const name = r.name || ''; const company = r.company || ''; const email = r.email || '';
  const wc = weekCommencing(); const sig = topSignal(r); const scheme = schemeHint(sig);
  const now = new Date().toISOString();
  const base = { to: email, status: 'suggested' as const, origin: 'engine' as const, generatedAt: now };
  const vars: Record<string, string> = { first: first(name) || 'there', name, company, wc, offer: offerFor(r, segment), scheme, scheme_or_company: scheme || company, scheme_or_it: scheme || 'the scheme', when: 'earlier', promise: 'the pipeline and how you are thinking about procurement and delivery', ask: '', vanor: VANOR, via_first: wayIn ? first(wayIn.name) : '',
    opener: sig?.type === 'planning' && scheme ? `Hope all's well. I've been following ${scheme} with interest and understand it's now going through planning.` : sig?.type === 'planning' ? `Hope all's well. I understand you've got a scheme going through planning at the moment.` : sig?.type === 'lending' || sig?.type === 'property' ? `Hope all's well. I understand funding is now in place on your next scheme and it's moving towards a start.` : `Hope all's well. Sounds like you've got something moving at ${company}.`,
    opener_warm: sig?.type === 'planning' && scheme ? `Saw ${scheme} has gone in, good news.` : sig?.type === 'lending' || sig?.type === 'property' ? `Heard the funding's landed on the next one, good news.` : `Sounds like you've got something moving.` };
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

