// Turns scanner signals into leads in the board's review queue. Never touches founder evidence or stages.
import { createHash } from 'node:crypto';
import { CONFIG, scan, companiesHouseDirectors, leadContext, type Scored } from './intel';
import { listScope, saveEntity, logEvent, type Entity } from './bd-store';

const SOURCE_LABEL: Record<string, string> = {
  planit: 'Planning (PlanIt)', planning_data_gov: 'Planning (planning.data.gov.uk)', construction_enquirer: 'Construction Enquirer', estates_gazette: 'Estates Gazette', property_week: 'Property Week', building: 'Building',
  hotelowner_admin: 'Hotel Owner', hotelowner_refurb: 'Hotel Owner', gazette_construction: 'The Gazette', gazette_2450: 'The Gazette: winding-up petition', gazette_2441: 'The Gazette: administration', gazette_2410: 'The Gazette: liquidation', hospitalitynet: 'Hospitality Net',
};
const norm = (s = '') => s.toLowerCase().replace(/\b(ltd|limited|plc|llp|group|holdings|uk|the)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export const intelId = (link: string) => 'intel:' + createHash('sha1').update(link).digest('hex').slice(0, 16);

export async function runIntel({ write, limit = CONFIG.maxPerRun, minScore = CONFIG.minScore }: { write: boolean; limit?: number; minScore?: number }) {
  const result = await scan();
  const candidates = result.scored.filter(s => s.score >= minScore);
  const preview = (s: Scored) => ({ score: s.score, title: s.title, organisation: s.organisation, buyer: s.buyerType, talkTo: s.talkTo, link: s.link });
  if (!write) return { ...result, scored: undefined, candidates: candidates.length, top: candidates.slice(0, limit).map(preview) };

  const records = await listScope('source');
  const ids = new Set(records.map(r => r.id));
  const added: ReturnType<typeof preview>[] = []; const triggers: string[] = [];
  for (const s of candidates) {
    if (added.length >= limit) break;
    const id = intelId(s.link);
    if (ids.has(id)) continue;
    const org = norm(s.organisation);
    const known = org.length > 3 ? records.filter(r => r.kind !== 'lead' && norm(r.company) === org) : [];
    const directors = await companiesHouseDirectors(s.organisation);
    const record: Entity = {
      id, kind: 'lead', origin: 'intel', addedBy: 'Vanor intel scanner',
      name: s.talkTo, company: (s.organisation || s.title).slice(0, 120), jobTitle: s.talkTo,
      email: '', phone: '', linkedin: '', notes: '',
      context: leadContext(s, directors, known.map(k => `${k.name} (${k.jobTitle || 'role unknown'})`)),
      source: SOURCE_LABEL[s.source] || s.source, sourceUrl: s.link, sourceOwner: '', segment: '', region: '', route: '',
      lastContact: '', nextAsk: '', nextDate: '', sourceStage: 'New lead', classification: 'New lead',
      intel: { score: s.score, complexity: s.complexity, distress: s.distress, money: s.money, timing: s.timing, buyerType: s.buyerType, signs: s.signs, contractors: s.contractors, directors, signalDate: s.date },
      createdAt: new Date().toISOString(),
    };
    if (!(await saveEntity('source', record, 0))) continue;
    ids.add(id);
    await logEvent({ entityId: id, recordId: id, type: 'Lead added', actor: 'Vanor intel scanner', note: `${record.source}, score ${s.score}: ${s.title.slice(0, 160)}` });
    for (const k of known.slice(0, 3)) {
      await logEvent({ entityId: k.id, recordId: k.id, type: 'Trigger', actor: 'Vanor intel scanner', note: `${record.source}: ${s.title.slice(0, 200)} ${s.link}` });
      triggers.push(`${k.name} (${k.company})`);
    }
    added.push(preview(s));
  }
  return { fetched: result.fetched, signals: result.signals, candidates: candidates.length, added, triggers, errors: result.errors };
}
