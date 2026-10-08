// Server-side view of the Signals feed, for the Claude runs (headline polishing, weekly digest).
import { listScope, updateEntity, type Entity } from './bd-store';
import { priorityList } from './priority';
import { STAGE_PLAY, type Stage } from './lead-classify';

const DAY = 864e5;
const norm = (s = '') => String(s).toLowerCase().replace(/\b(ltd|limited|plc|llp|group|holdings|uk|the)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const SOURCE: Record<string, string> = { property: 'Companies House', lending: 'Companies House', new_spv: 'Companies House', new_director: 'Companies House', distress: 'The Gazette', planning: 'Planning' };
export const signalKey = (type: string, date: string) => `${type}:${String(date).slice(0, 10)}`;

function headline(company: string, sg: { type: string; text?: string }) {
  const t = String(sg.text || '').replace(/^(planning|application|consent)[:\s-]*/i, '').split(/[.;|]/)[0].trim();
  switch (sg.type) {
    case 'property': return `${company}: new property charge registered, funding in place`;
    case 'lending': return `${company} secures new lending`;
    case 'planning': return `${company}: ${t.length > 6 && t.length < 90 ? t : 'planning application lodged'}`;
    case 'new_spv': return `${company} sets up a new vehicle`;
    case 'new_director': return `${company} appoints a new director`;
    case 'distress': return `${company}: ${t || 'insolvency notice'}`;
    default: return `${company}: ${t || sg.type}`;
  }
}

export type FeedItem = { id: string; key: string; date: string; source: string; headline: string; why: string; text: string; link: string; cell: string; company: string; polished: boolean; stage: string; sector: string; value: string; region: string; parties: Record<string, string>; play: string };
const CH_STAGE: Record<string, string> = { property: 'funded', lending: 'funded', planning: 'submitted', new_spv: 'acquired', new_director: 'leadership', distress: 'distress' };

export async function signalFeed({ days = 30, buyersOnly = true, limit = 60 }: { days?: number; buyersOnly?: boolean; limit?: number } = {}): Promise<FeedItem[]> {
  const since = new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
  const [records, decisions, prio] = await Promise.all([listScope('source'), listScope('decision'), priorityList({ cell: 'All', limit: 5000 })]);
  const dById = new Map(decisions.map(d => [d.id, d]));
  const cellOf = new Map<string, { cell: string; score: number }>((prio.rows || []).map((x: any) => [x.id, { cell: x.cell, score: x.score }]));
  const items: FeedItem[] = [];
  const dismissed = (id: string) => new Set<string>((dById.get(id)?.dismissedSignals as string[]) || []);
  for (const r of records) {
    if (r.origin === 'intel') {
      const date = String(r.intel?.signalDate || r.createdAt || '').slice(0, 10); if (date < since) continue;
      if (dismissed(r.id).has('lead')) continue;
      const h = r.headlines?.lead || {};
      const src = /gazette/i.test(r.source || '') ? 'The Gazette' : /planning/i.test(r.source || '') ? 'Planning' : 'Press';
      const it = r.intel || {}; const stage = it.stage || (src === 'The Gazette' ? 'distress' : src === 'Planning' ? 'submitted' : 'news');
      items.push({ id: r.id, key: 'lead', date, source: src, headline: h.headline || r.title || r.company || r.name, why: h.why || '', text: String(r.context || '').split('\n')[0].slice(0, 200), link: r.sourceUrl || '', cell: cellOf.get(r.id)?.cell || '', company: r.company || '', polished: !!h.headline, stage, sector: it.sector || '', value: it.valueBand || '', region: it.region || r.region || '', parties: it.parties || {}, play: STAGE_PLAY[stage as Stage] || '' });
    }
  }
  const seen = new Set<string>();
  for (const r of records) {
    const sigs = r.companyIntel?.signals; if (!sigs || r.kind === 'opportunity') continue;
    const k = norm(r.company); if (!k || seen.has(k)) continue; seen.add(k);
    const mates = records.filter(y => y.kind !== 'opportunity' && norm(y.company) === k);
    let best: Entity | null = null, bestScore = -1;
    for (const y of mates) { const c = cellOf.get(y.id); if (c && c.score > bestScore) { bestScore = c.score; best = y; } }
    const target = best || r; const dis = dismissed(target.id);
    for (const sg of sigs) {
      if (sg.type === 'inactive') continue; const date = String(sg.date || '').slice(0, 10); if (date < since) continue;
      const key = signalKey(sg.type, date); if (dis.has(key)) continue;
      const h = target.headlines?.[key] || r.headlines?.[key] || {};
      const stage = CH_STAGE[sg.type] || 'news';
      items.push({ id: target.id, key, date, source: SOURCE[sg.type] || 'Companies House', headline: h.headline || headline(r.company, sg), why: h.why || '', text: `${sg.text || ''}${mates.length ? ` · ${mates.length} contact${mates.length > 1 ? 's' : ''} on the board` : ''}`, link: '', cell: cellOf.get(target.id)?.cell || '', company: r.company || '', polished: !!h.headline, stage, sector: '', value: '', region: r.region || '', parties: { developer: r.company || '' }, play: STAGE_PLAY[stage as Stage] || '' });
    }
  }
  return items.filter(i => !buyersOnly || (i.cell && i.cell !== 'C')).sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}

export async function setHeadline(id: string, key: string, h: { headline: string; why: string }) {
  await updateEntity('source', id, r => ({ ...r, headlines: { ...(r.headlines || {}), [key]: { ...h, at: new Date().toISOString() } } }));
  return { ok: true };
}
