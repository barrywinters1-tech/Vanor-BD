// Client records and deal timelines for Vanor Live (23 Nov 2026).
// Clients live in the 'work' scope as kind 'client' (id client:<slug>), so no migration is needed and the older
// engine ignores them. Timeline notes go on a pursuit's `log` or a client's `history`, newest first, appended
// server-side so two writers never overwrite each other's notes.
import { getOne, listScope, updateEntity, logEvent, type Entity } from './bd-store';
import { CLIENT_FIELDS, WARMTH, slug } from './live-rules';

export type ClientInput = { id?: string; name?: string; type?: string; owner?: string; warmth?: string; people?: { name: string; role?: string; email?: string; recordId?: string }[];
  cares?: string; theyOwe?: string; weOwe?: string; work?: string; personal?: string; whoElse?: string };
const MAX_NOTES = 200;

export async function listClients() { return (await listScope('work')).filter(w => w.kind === 'client'); }

/** Create or update clients. Matches by id, else by name. Never touches history (use addNote). */
export async function saveClients(items: ClientInput[], actor = 'Claude') {
  const existing = await listClients();
  const byName = new Map(existing.map(c => [String(c.name).toLowerCase(), c]));
  const saved: string[] = [], rejected: { name: string; reason: string }[] = [];
  for (const item of items) {
    const prior = (item.id ? existing.find(c => c.id === item.id) : undefined) || byName.get(String(item.name || '').toLowerCase());
    const id = prior?.id || item.id || 'client:' + slug(item.name || '');
    if (!id.startsWith('client:')) { rejected.push({ name: item.name || id, reason: 'A client id starts client:' }); continue; }
    if (!prior && (!item.name || item.name.trim().length < 2)) { rejected.push({ name: id, reason: 'A new client needs a name.' }); continue; }
    if (!prior && await getOne('work', id)) { rejected.push({ name: item.name || id, reason: 'That id is not free for a new client.' }); continue; }
    if (item.warmth && !WARMTH.includes(item.warmth as any)) { rejected.push({ name: item.name || id, reason: 'warmth must be ' + WARMTH.join(', ') }); continue; }
    const patch: Entity = { id };
    for (const k of CLIENT_FIELDS) if (k !== 'history' && k !== 'people' && (item as any)[k] !== undefined) patch[k] = (item as any)[k];
    await updateEntity('work', id, cur => {
      // Claude never overwrites a field a partner typed (partnerEdited); people are merged, never replaced.
      const keep = actor === 'Claude' ? new Set<string>((cur.partnerEdited as string[]) || []) : new Set<string>();
      const p2 = Object.fromEntries(Object.entries(patch).filter(([k]) => !keep.has(k) || !cur[k]));
      return { ...cur, ...p2, people: mergePeople(cur.people, item.people || []), kind: 'client', history: cur.history || [], ...(cur.createdAt ? {} : { createdAt: new Date().toISOString(), createdBy: actor }), updatedAt: new Date().toISOString(), updatedBy: actor };
    }, true);
    saved.push(id);
  }
  return { saved, rejected };
}

const pkey = (p: Record<string, any>) => String(p.email || '').toLowerCase() || String(p.name || '').toLowerCase().replace(/\s+/g, ' ').trim();
/** People merge by email, else by name; a new detail fills a gap, it never blanks one. */
export function mergePeople(current: unknown, add: Record<string, any>[]) {
  const out: Record<string, any>[] = Array.isArray(current) ? current.map(p => ({ ...p })) : [];
  for (const p of add) {
    if (!p || String(p.name || '').trim().length < 2) continue;
    const hit = out.find(o => (p.email && String(o.email || '').toLowerCase() === String(p.email).toLowerCase()) || pkey(o) === pkey(p) || String(o.name || '').toLowerCase() === String(p.name).toLowerCase());
    if (hit) { for (const [k, v] of Object.entries(p)) if (v && !hit[k]) hit[k] = v; } else out.push({ ...p });
  }
  return out.slice(0, 60);
}

/** Add one person to a client, merged server-side (Vanor Live "Add person"). */
export async function addPerson(id: string, person: Record<string, any>, actor: string) {
  const cur = await getOne('work', id);
  if (!cur || cur.kind !== 'client') throw new Error('No client with id ' + id);
  if (String(person?.name || '').trim().length < 2) throw new Error('A person needs a name.');
  const clean = { name: String(person.name).trim().slice(0, 120), role: String(person.role || '').trim().slice(0, 120), email: String(person.email || '').trim().slice(0, 160) };
  return updateEntity('work', id, c => ({ ...c, people: mergePeople(c.people, [clean]), updatedAt: new Date().toISOString(), updatedBy: actor }));
}

const realDay = (d: string) => { const t = new Date(d + 'T12:00:00Z'); return !Number.isNaN(+t) && t.toISOString().slice(0, 10) === d; };
/** Add one timeline note to a deal (pursuit) or client. kind: Note, Call, Meeting, Email, Proposal, Intro. */
export async function addNote({ id, text, date, kind = 'Note', by = 'Claude' }: { id: string; text: string; date?: string; kind?: string; by?: string }) {
  const clean = String(text || '').trim();
  if (clean.length < 2) throw new Error('A note needs text.');
  const cur = await getOne('work', id);
  if (!cur || !['pursuit', 'client'].includes(cur.kind)) throw new Error('No deal or client with id ' + id);
  const todayLondon = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !realDay(date))) throw new Error('A note date must be a real date (YYYY-MM-DD).');
  if (date && date > todayLondon) throw new Error('A note cannot be dated in the future.');
  const on = date || todayLondon;
  const row = { date: on, kind, text: clean.slice(0, 1000), by, at: new Date().toISOString() };
  const field = cur.kind === 'pursuit' ? 'log' : 'history';
  const next = await updateEntity('work', id, c => {
    const list = [row, ...((c[field] as Entity[]) || [])];
    // A duplicate (same day, same text) is a retry, not a second note.
    const seen = new Set<string>(); const dedup = list.filter(n => { const k = n.date + '|' + n.text; if (seen.has(k)) return false; seen.add(k); return true; });
    dedup.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return { ...c, [field]: dedup.slice(0, MAX_NOTES), updatedAt: new Date().toISOString(), ...(by !== 'Claude' ? { founderTouchedAt: new Date().toISOString() } : {}) };
  });
  await logEvent({ entityId: id, type: 'Note added', actor: by, recordId: String(cur.recordId || ''), note: String(cur.name || id).slice(0, 80) + ': ' + clean.slice(0, 80) }).catch(() => {});
  return { id, field, count: (next?.[field] as unknown[] | undefined)?.length ?? 0 };
}
