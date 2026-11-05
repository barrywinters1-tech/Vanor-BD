// Turns scanner signals into leads in the board's review queue. Never touches founder evidence or stages.
import { createHash } from 'node:crypto';
import { CONFIG, scan, companiesHouseDirectors, leadContext, type Scored } from './intel';
import { sellability } from './lead-classify';
import { listScope, saveEntity, logEvent, type Entity } from './bd-store';
import { laneOfSignal, lenderIn } from './signals-clean';
import '../public/vanor-classify.js';
import '../public/vanor-pursuits.js';

const SOURCE_LABEL: Record<string, string> = {
  planit: 'Planning (PlanIt)', planning_data_gov: 'Planning (planning.data.gov.uk)', london_datahub: 'Planning (London Datahub)', construction_news: 'Construction News', place_north_west: 'Place North West', architects_journal: 'Architects\' Journal', insider_media: 'Insider Media', construction_enquirer: 'Construction Enquirer', estates_gazette: 'Estates Gazette', property_week: 'Property Week', building: 'Building',
  hotelowner_admin: 'Hotel Owner', hotelowner_refurb: 'Hotel Owner', gazette_construction: 'The Gazette', gazette_2450: 'The Gazette: winding-up petition', gazette_2441: 'The Gazette: administration', gazette_2410: 'The Gazette: liquidation', hospitalitynet: 'Hospitality Net', hiring_reed: 'Hiring (Reed)', hiring_adzuna: 'Hiring (Adzuna)', pw_finance: 'Property Week: Finance', pw_investment: 'Property Week: Investment', pw_hotels: 'Property Week: Hotels', pw_offices: 'Property Week: Offices', dcd: 'DatacenterDynamics', datacentre_review: 'Data Centre Review', find_a_tender: 'Find a Tender', tcc_judgments: 'TCC judgments (Find Case Law)',
};
const norm = (s = '') => s.toLowerCase().replace(/\b(ltd|limited|plc|llp|group|holdings|uk|the)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export const intelId = (link: string) => 'intel:' + createHash('sha1').update(link).digest('hex').slice(0, 16);

export async function runIntel({ write, limit = CONFIG.maxPerRun, minScore = CONFIG.minScore }: { write: boolean; limit?: number; minScore?: number }) {
  const result = await scan();
  // The bar (29 Oct 2026): only signals that pass all three tests are written. The rest are dropped here, not parked.
  const C = (globalThis as any).VanorClassify;
  const passes = (s: Scored) => { const b = C?.bar?.({ origin: 'intel', title: s.title, context: s.summary, region: s.lead.region, createdAt: s.date, intel: { stage: s.lead.stage, buyerType: s.buyerType, parties: s.lead.parties, signalDate: (C?.isoDate?.(s.date) || s.date), region: s.lead.region } }); return !b || b.pass; };
  const candidates = result.scored.filter(s => s.score >= minScore && passes(s));
  // Yield, by lane: how many scored, how many cleared the bar. Written to the board so a quiet lane is visible, not silent.
  const laneOf = (s: Scored) => laneOfSignal({ headline: s.title, text: s.summary, stage: s.lead.stage, sector: s.lead.sector, source: s.source, buyerType: s.buyerType });
  const byLane: Record<string, { scored: number; passed: number }> = {};
  const passedIds = new Set(candidates.map(s => s.link));
  for (const s of result.scored) { const l = laneOf(s); (byLane[l] ||= { scored: 0, passed: 0 }).scored++; if (passedIds.has(s.link)) byLane[l].passed++; }
  const preview = (s: Scored) => ({ score: s.score, tier: s.sell.tier, why: s.sell.why, title: s.title, organisation: s.organisation, buyer: s.buyerType, talkTo: s.talkTo, link: s.link, stage: s.lead.stage, sector: s.lead.sector, value: s.lead.valueBand, region: s.lead.region, parties: s.lead.parties });
  if (!write) return { ...result, scored: undefined, candidates: candidates.length, byLane, top: candidates.slice(0, limit).map(preview) };

  const [records, work] = await Promise.all([listScope('source'), listScope('work')]);
  const ids = new Set(records.map(r => r.id));
  const PV = (globalThis as any).VanorPursuits;
  const pursuitOrgs = new Set(work.filter(w => PV?.isPursuit?.(w) && PV.isOpen(w)).map(w => norm(w.org || '')).filter(o => o.length > 3));
  let onBoard = 0;
  const added: ReturnType<typeof preview>[] = []; const triggers: string[] = [];
  for (const s of candidates) {
    if (added.length >= limit) break;
    const id = intelId(s.link);
    if (ids.has(id)) continue;
    const lane = laneOf(s);
    const text = `${s.title} ${s.summary}`;
    // Funder lane: the lender named in a facility is the buyer for monitoring; the borrower is context.
    const lender = ['funded', 'distress'].includes(s.lead.stage) ? lenderIn(text) : '';
    if (lender && s.lead.stage === 'funded') { s.lead.parties.funder = s.lead.parties.funder || lender; s.lead.parties.borrower = s.organisation; s.organisation = lender; }
    const org = norm(s.organisation);
    // Already a pursuit: no second signal for the same organisation, except a funded signal, where the lender repeats but the borrower and asset are new.
    if (org.length > 3 && pursuitOrgs.has(org) && !(lender && s.lead.stage === 'funded')) { onBoard++; continue; }
    const known = org.length > 3 ? records.filter(r => r.kind !== 'lead' && norm(r.company) === org) : [];
    const directors = await companiesHouseDirectors(s.organisation);
    if (known.length) { s.sell = sellability(s.lead, s.buyerType, `${s.title} ${s.summary}`, s.date, { knownContacts: known.length }); s.score = s.sell.score; }
    const record: Entity = {
      id, kind: 'lead', origin: 'intel', addedBy: 'Vanor intel scanner',
      name: s.talkTo, company: (s.organisation || s.title).slice(0, 120), jobTitle: s.talkTo, title: s.title.slice(0, 160),
      email: '', phone: '', linkedin: '', notes: '',
      context: leadContext(s, directors, known.map(k => `${k.name} (${k.jobTitle || 'role unknown'})`)),
      source: SOURCE_LABEL[s.source] || s.source, sourceUrl: s.link, sourceOwner: '', route: '',
      lastContact: '', nextAsk: '', nextDate: '', sourceStage: 'New lead', classification: 'New lead',
      intel: { lane, lender, score: s.score, complexity: s.complexity, distress: s.distress, money: s.money, timing: s.timing, buyerType: s.buyerType, signs: s.signs, contractors: s.contractors, directors, signalDate: C?.isoDate?.(s.date) || s.date, stage: s.lead.stage, sector: s.lead.sector, devType: s.lead.devType, size: s.lead.size, valueBand: s.lead.valueBand, region: s.lead.region, parties: s.lead.parties, isLarge: s.lead.isLarge, tier: s.sell.tier, why: s.sell.why, play: s.sell.play, call: s.sell.call, parts: s.sell.parts },
      segment: '', region: s.lead.region,
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
  // Scan stats for the Signals page: every configured source with its count (zeros included), yield by lane, errors.
  const prev = work.find(w => w.id === 'scan:stats') || ({} as Entity);
  const stats: Entity = { ...prev, id: 'scan:stats', kind: 'scanstats', ranAt: new Date().toISOString(), bySource: result.bySource, byLane, errors: result.errors, added: added.length, candidates: candidates.length, onBoard, minScore };
  const savedStats = await saveEntity('work', stats, prev._rev || 0).catch(() => null);
  if (!savedStats) console.warn('scan:stats not saved (revision conflict)');
  return { fetched: result.fetched, signals: result.signals, candidates: candidates.length, byLane, onBoard, added, triggers, errors: result.errors };
}
