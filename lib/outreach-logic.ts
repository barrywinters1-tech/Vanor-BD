// Outreach engine (pure): picks the angle and writes a first draft in Barry's voice for one contact.
// Rule-built so it runs for hundreds of contacts in seconds; the scheduled Claude run polishes the top ones.
// Nothing here sends anything. No database imports, so tests and the browser can share it.
type Entity = { id: string; [key: string]: any };

export type Draft = {
  kind: 'signal' | 'nurture' | 'intro' | 'first' | 'chase' | 'call';
  angle: string; subject: string; body: string; to: string;
  status: 'suggested' | 'edited' | 'approved' | 'pushed' | 'skipped';
  origin: 'engine' | 'Claude' | 'founder'; generatedAt: string; approvedAt?: string; approvedBy?: string; pushedAt?: string; outlookId?: string; via?: string;
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

export type DraftInput = { r: Entity; d?: Entity | null; warm: boolean; cell: string; wayIn?: { name: string; company: string; email?: string } | null; lastSentDaysAgo?: number | null; segment: string };

export function composeDraft(input: DraftInput): Draft | null {
  const { r, warm, cell, wayIn, segment } = input;
  const name = r.name || ''; const company = r.company || ''; const email = r.email || '';
  const wc = weekCommencing(); const sig = topSignal(r); const scheme = schemeHint(sig);
  const now = new Date().toISOString();
  const base = { to: email, status: 'suggested' as const, origin: 'engine' as const, generatedAt: now };

  if (cell === 'C' || !name) return null;

  // Chase: we wrote recently and heard nothing.
  if (input.lastSentDaysAgo != null && input.lastSentDaysAgo >= 7 && input.lastSentDaysAgo <= 35 && email) {
    return { ...base, kind: 'chase', angle: `No reply for ${Math.floor(input.lastSentDaysAgo)} days; one plain chase with a date`, subject: 'Following up',
      body: `${greeting(name)}\n\nJust following up on the below. Can we get 20 minutes in ${wc}? Happy to come to you.\n\n${SIGN}` };
  }

  // Distress at their own company: do not email; call the exposed employer or funder instead.
  if (sig?.type === 'distress') {
    return { ...base, kind: 'call', angle: 'Distress signal on this company: a call to the exposed employer or funder beats an email to them', subject: '', body: '', to: '' };
  }

  // No email and a way in: ask the warm contact for an introduction.
  if (!email && wayIn?.email) {
    return { ...base, to: wayIn.email, via: wayIn.name, kind: 'intro', angle: `Ask ${wayIn.name} for an intro; no direct email for ${first(name)}`, subject: `Intro to ${first(name)}?`,
      body: `${greeting(wayIn.name)}\n\nQuick one. Would you be happy to introduce me to ${name} at ${company}?${scheme ? ` Saw ${scheme} is moving and` : ' It'} looks like the sort of job where ${offerFor(r, segment)}.\n\nA two-line email is plenty, happy to take it from there and will keep you in the loop.\n\n${SIGN}` };
    }
  if (!email) return null;

  // Signal-led: there is a dated trigger. Say it the way Barry would, never quote the filing.
  if (sig && ['property', 'lending', 'planning', 'new_spv'].includes(sig.type)) {
    const opener = sig.type === 'planning' && scheme ? `Saw ${scheme} has gone in, so thought I'd drop you a line.`
      : sig.type === 'planning' ? `Saw you've got a scheme going through planning, so thought I'd drop you a line.`
      : `Sounds like you've got something moving at ${company}, so thought I'd drop you a line.`;
    const lead = warm ? `${opener.replace("so thought I'd drop you a line", 'and we are due a catch up')}` : opener;
    const body = warm
      ? `${greeting(name)}\n\n${lead}\n\nIf there's a contractor programme or cost plan you'd like a second pair of eyes on before it starts, happy to take a look. Can we get something in ${wc}?\n\n${SIGN}`
      : `${greeting(name)}\n\n${lead}\n\n${VANOR}; mainly ${offerFor(r, segment)}.\n\nWould you be up for a coffee ${wc}? Happy to come to you.\n\n${SIGN_FIRST}`;
    return { ...base, kind: 'signal', angle: `${sig.type.replace('_', ' ')} signal ${sig.date || ''}: ${warm ? 'catch up and offer a peer review' : 'first approach with one concrete offer'}`, subject: warm ? 'Due a catch up' : 'Coffee?', body };
  }

  // Warm, no trigger: nurture.
  if (warm) {
    return { ...base, kind: 'nurture', angle: 'Warm relationship, no live trigger: catch up and ask what is next', subject: 'Due a catch up',
      body: `${greeting(name)}\n\nDue a catch up. Hows all with you guys, keeping busy?\n\nWould be good to hear what's coming through at ${company} and whether there's anywhere ${offerFor(r, segment).replace(/^we /, 'we could help, we ')}.\n\nCan we get something in ${wc}? Happy to come to you.\n\n${SIGN}` };
  }

  // Cold with a way in: ask for the intro instead of writing cold.
  if (wayIn?.email) {
    return { ...base, to: wayIn.email, via: wayIn.name, kind: 'intro', angle: `Cold target; ask ${wayIn.name} for an intro rather than write cold`, subject: `Intro to ${first(name)}?`,
      body: `${greeting(wayIn.name)}\n\nQuick one. Would you be happy to introduce me to ${name} at ${company}? Looks like the sort of outfit where ${offerFor(r, segment)}.\n\nA two-line email is plenty, happy to take it from there and will keep you in the loop.\n\n${SIGN}` };
  }

  // Cold first approach, only for A grade.
  if (cell.startsWith('A')) {
    return { ...base, kind: 'first', angle: 'Right buyer, no trigger, no way in: short first approach with one offer', subject: 'Coffee?',
      body: `${greeting(name)}\n\n${r.linkedin ? "We connected on LinkedIn a while back and I've been meaning to drop you a line." : "Thought I'd drop you a line."}\n\n${VANOR}; mainly ${offerFor(r, segment)}.\n\nWould you be up for a coffee ${wc}? Happy to come to you.\n\n${SIGN_FIRST}` };
  }
  return null;
}

