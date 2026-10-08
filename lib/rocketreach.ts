// RocketReach person lookup (API v2). Server-side only: the key never reaches a browser or Claude.
// NOTE: written against RocketReach's public v2 docs; verify with a live key before relying on it.
const BASE = 'https://api.rocketreach.co/api/v2';

export type Enrichment = {
  status: 'found' | 'not_found' | 'pending' | 'error';
  emails: { email: string; type?: string; valid?: string }[];
  phones: { number: string; type?: string }[];
  linkedin?: string; title?: string; employer?: string; rocketreachId?: number; message?: string;
};

type Person = {
  id?: number; status?: string; current_title?: string; current_employer?: string; linkedin_url?: string;
  emails?: { email?: string; type?: string; smtp_valid?: string }[]; phones?: { number?: string; type?: string }[];
};

async function call(path: string, fetcher: typeof fetch, apiKey: string) {
  const response = await fetcher(BASE + path, { headers: { 'Api-Key': apiKey, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`RocketReach returned HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return response.json();
}

function shape(person: Person): Enrichment {
  const emails = (person.emails || []).filter(e => e.email)
    // Professional, deliverable addresses first.
    .sort((a, b) => Number(b.type === 'professional') - Number(a.type === 'professional') || Number(b.smtp_valid === 'valid') - Number(a.smtp_valid === 'valid'))
    .map(e => ({ email: e.email!, type: e.type, valid: e.smtp_valid }));
  const phones = (person.phones || []).filter(p => p.number).map(p => ({ number: p.number!, type: p.type }));
  const done = person.status === 'complete';
  return {
    status: !done ? 'pending' : emails.length || phones.length ? 'found' : 'not_found',
    emails, phones, linkedin: person.linkedin_url, title: person.current_title, employer: person.current_employer, rocketreachId: person.id,
  };
}

export async function lookupPerson(input: { name: string; company?: string; linkedin?: string },
  options: { fetcher?: typeof fetch; apiKey?: string; pollMs?: number; maxPolls?: number } = {}): Promise<Enrichment> {
  const apiKey = options.apiKey ?? process.env.ROCKETREACH_API_KEY ?? '';
  if (!apiKey) return { status: 'error', emails: [], phones: [], message: 'ROCKETREACH_API_KEY is not set in Vercel.' };
  const fetcher = options.fetcher || fetch;
  const params = new URLSearchParams();
  if (input.linkedin) params.set('linkedin_url', input.linkedin);
  else { params.set('name', input.name); if (input.company) params.set('current_employer', input.company); }
  try {
    let person = await call('/person/lookup?' + params, fetcher, apiKey) as Person | null;
    if (!person) return { status: 'not_found', emails: [], phones: [] };
    for (let i = 0; person.status && person.status !== 'complete' && person.status !== 'failed' && i < (options.maxPolls ?? 6); i++) {
      await new Promise(resolve => setTimeout(resolve, options.pollMs ?? 2500));
      const list = await call(`/person/checkStatus?ids=${person.id}`, fetcher, apiKey) as Person[] | null;
      person = { ...person, ...(Array.isArray(list) ? list[0] : list || {}) };
    }
    if (person.status === 'failed') return { status: 'not_found', emails: [], phones: [] };
    return shape(person);
  } catch (error) {
    return { status: 'error', emails: [], phones: [], message: error instanceof Error ? error.message : 'Lookup failed' };
  }
}

/** People search by employer and title keywords, then lookups for contact details. Used on demand from the board, never automatically. */
export type Candidate = { rocketreachId?: number; name: string; title: string; employer: string; linkedin?: string; emails: Enrichment['emails']; phones: Enrichment['phones']; status: Enrichment['status'] };
export const BUYER_TITLES = ['Development Director', 'Managing Director', 'Chief Executive', 'Head of Development', 'Investment Director', 'Head of Construction', 'Project Director', 'Fund Manager', 'Finance Director', 'Head of Asset Management', 'Director'];
export async function searchPeople(input: { company: string; titles?: string[]; limit?: number }, options: { fetcher?: typeof fetch; apiKey?: string } = {}): Promise<{ candidates: Candidate[]; message?: string }> {
  const apiKey = options.apiKey ?? process.env.ROCKETREACH_API_KEY ?? '';
  if (!apiKey) return { candidates: [], message: 'ROCKETREACH_API_KEY is not set in Vercel.' };
  const fetcher = options.fetcher || fetch;
  const limit = Math.min(input.limit ?? 3, 5);
  try {
    const res = await fetcher(BASE + '/person/search', { method: 'POST', headers: { 'Api-Key': apiKey, Accept: 'application/json', 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ query: { current_employer: [input.company], current_title: input.titles?.length ? input.titles : BUYER_TITLES }, start: 1, page_size: 10 }) });
    if (!res.ok) throw new Error(`RocketReach search returned HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    const profiles: any[] = (json.profiles || []).filter((p: any) => p.name && String(p.current_employer || '').toLowerCase().includes(input.company.toLowerCase().split(' ')[0]));
    const seniority = (t: string) => /chief|ceo|managing director|\bmd\b|founder|partner|principal/i.test(t) ? 3 : /director|head of|fund manager/i.test(t) ? 2 : 1;
    profiles.sort((a, b) => seniority(b.current_title || '') - seniority(a.current_title || ''));
    const out: Candidate[] = [];
    for (const p of profiles.slice(0, limit)) {
      let detail: Person | null = null;
      try { detail = await call(`/person/lookup?id=${p.id}`, fetcher, apiKey) as Person | null;
        for (let i = 0; detail && detail.status && detail.status !== 'complete' && detail.status !== 'failed' && i < 4; i++) { await new Promise(r => setTimeout(r, 2500)); const list = await call(`/person/checkStatus?ids=${p.id}`, fetcher, apiKey) as Person[] | null; detail = { ...detail, ...(Array.isArray(list) ? list[0] : list || {}) }; }
      } catch { detail = null; }
      const e = detail ? shape(detail) : { status: 'not_found' as const, emails: [], phones: [] };
      out.push({ rocketreachId: p.id, name: p.name, title: p.current_title || '', employer: p.current_employer || '', linkedin: p.linkedin_url || e.linkedin, emails: e.emails, phones: e.phones, status: e.status });
    }
    return { candidates: out };
  } catch (error) { return { candidates: [], message: error instanceof Error ? error.message : 'Search failed' }; }
}
