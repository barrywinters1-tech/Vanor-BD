// Outreach engine against the board: batch generation, approvals, Outlook hand-off, auto-classification.
// Drafts live on the decision record as d.draft and go to Outlook only after a founder approves.
import { listScope, getOne, updateEntity, logEvent, type Entity } from './bd-store';
import { priorityList } from './priority';
import { composeDraft, templateMap, DEFAULT_TEMPLATES, type Draft, type Template } from './outreach-logic';
export { composeDraft, weekCommencing, templateMap, DEFAULT_TEMPLATES, renderTemplate, type Draft, type DraftInput, type Template } from './outreach-logic';

const DAY = 864e5;
const norm = (s = '') => String(s).toLowerCase().replace(/\b(ltd|limited|plc|llp|group|holdings|uk|the)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const daysAgo = (d?: string) => { const t = Date.parse(d || ''); return isNaN(t) ? 9999 : (Date.now() - t) / DAY; };

// ---- Batch generation against the board ----

function warmScore(r: Entity, d: Entity | undefined, works: Entity[]) {
  let v = 0;
  works.forEach(w => { if (!w.archived && w.stage !== 'Watch') v = Math.max(v, w.stage === 'Won' ? 5 : ['Commercial', 'Opportunity'].includes(w.stage) ? 4 : 3); });
  if (r.classification === 'Known contact') v = Math.max(v, 2);
  const lc = daysAgo(r.lastContact); if (lc <= 90) v = Math.max(v, 3); else if (lc <= 365) v = Math.max(v, 2);
  const c = d?.conditions || {}; if ((c.Trust || 0) >= 1 || (c.Respect || 0) >= 1) v = Math.max(v, 3);
  return v;
}

export async function generateDrafts({ limit = 40, cells = ['A1', 'A2', 'B1'], staleDays = 14, ids }: { limit?: number; cells?: string[]; staleDays?: number; ids?: string[] } = {}) {
  const [records, decisions, work, events, prio] = await Promise.all([listScope('source'), listScope('decision'), listScope('work'), listScope('event'), priorityList({ cell: 'All', limit: 5000 })]);
  const dById = new Map(decisions.map(d => [d.id, d]));
  const templates = templateMap(decisions.filter(d => String(d.id).startsWith('template:')).map(d => ({ key: String(d.id).slice(9), subject: d.subject, body: d.body })));
  const wByRecord = new Map<string, Entity[]>(); for (const w of work) { const l = wByRecord.get(w.recordId) || []; l.push(w); wByRecord.set(w.recordId, l); }
  const cellOf = new Map<string, string>((prio.rows || []).map((x: any) => [x.id, x.cell]));
  // Warmest known person per company, for intro paths.
  const warmest = new Map<string, { r: Entity; v: number }>();
  for (const r of records) { if (r.kind === 'opportunity') continue; const k = norm(r.company); if (!k) continue; const v = warmScore(r, dById.get(r.id), wByRecord.get(r.id) || []); if (!v) continue; const cur = warmest.get(k); if (!cur || v > cur.v) warmest.set(k, { r, v }); }
  // Last sent / last answered per contact.
  const lastSent = new Map<string, string>(), lastBack = new Map<string, string>(), sends = new Map<string, string[]>();
  for (const e of events) { const rid = String(e.recordId || e.entityId); const d = String(e.date || e.at || '').slice(0, 10); const t = String(e.type || '');
    if (t === 'Outcome: sent' || t === 'Interaction: email out') { if ((lastSent.get(rid) || '') < d) lastSent.set(rid, d); sends.set(rid, [...(sends.get(rid) || []), d]); }
    else if (/^Outcome: (reply|meeting|proposal|won)|^Interaction: (email in|meeting)/.test(t)) { if ((lastBack.get(rid) || '') < d) lastBack.set(rid, d); } }

  const targets = records.filter(r => r.kind !== 'opportunity' && (ids ? ids.includes(r.id) : (cells.includes(cellOf.get(r.id) || '') || (lastSent.has(r.id) && (lastBack.get(r.id) || '') < (lastSent.get(r.id) || '')))))
    .filter(r => { const d = dById.get(r.id); if (d?.status === 'Archive') return false; const dr = d?.draft as Draft | undefined;
      if (ids) return true; if (!dr) return true; if (dr.status === 'pushed' && (lastSent.get(r.id) || '') >= String(dr.pushedAt || '').slice(0, 10)) return true; if (['approved', 'pushed', 'edited'].includes(dr.status)) return false; return daysAgo(dr.generatedAt) > staleDays; })
    .sort((a, b) => ((prio.rows.find((x: any) => x.id === b.id)?.score) || 0) - ((prio.rows.find((x: any) => x.id === a.id)?.score) || 0))
    .slice(0, limit);

  let made = 0, skipped = 0; const out: Array<{ id: string; kind: string; angle: string }> = [];
  for (const r of targets) {
    const d = dById.get(r.id); const works = wByRecord.get(r.id) || [];
    const warm = warmScore(r, d, works) >= 2;
    const wi = warmest.get(norm(r.company)); const wayIn = wi && wi.r.id !== r.id && !warm ? { name: wi.r.name, company: wi.r.company, email: wi.r.email } : null;
    const sent = lastSent.get(r.id); const back = lastBack.get(r.id) || ''; const lastSentDaysAgo = sent && back < sent ? daysAgo(sent) : null;
    const touches = sent ? (sends.get(r.id) || []).filter(d => d > back).length : 0;
    const segment = d?.segment || r.segment || r.fitSector || '';
    const draft = composeDraft({ r, d, warm, cell: cellOf.get(r.id) || 'C', wayIn, lastSentDaysAgo, touches, segment, templates });
    if (!draft) { skipped++; continue; }
    await updateEntity('decision', r.id, cur => ({ ...cur, draft }), true);
    made++; out.push({ id: r.id, kind: draft.kind, angle: draft.angle });
  }
  return { made, skipped, considered: targets.length, drafts: out };
}

/** Drafts a founder has approved in the board and that still need to go to Outlook. */
export async function approvedDrafts(limit = 30) {
  const [records, decisions] = await Promise.all([listScope('source'), listScope('decision')]);
  const byId = new Map(records.map(r => [r.id, r]));
  return decisions.filter(d => (d.draft as Draft | undefined)?.status === 'approved').slice(0, limit).map(d => {
    const r = byId.get(d.id) || ({} as Entity); const dr = d.draft as Draft;
    return { id: d.id, name: r.name || '', company: r.company || '', to: dr.to, via: dr.via || '', subject: dr.subject, body: dr.body, kind: dr.kind, angle: dr.angle, approvedAt: dr.approvedAt || '', approvedBy: dr.approvedBy || '' };
  });
}

export async function markDraftPushed(id: string, outlookId: string) {
  await updateEntity('decision', id, cur => ({ ...cur, draft: { ...(cur.draft || {}), status: 'pushed', pushedAt: new Date().toISOString(), outlookId } }));
  await logEvent({ entityId: id, recordId: id, type: 'Draft to Outlook', note: `Approved draft placed in Outlook Drafts (${outlookId.slice(0, 12)}…). Not sent.` });
  return { ok: true };
}

export async function saveDraft(id: string, patch: Partial<Draft>, origin: Draft['origin']) {
  const now = new Date().toISOString();
  await updateEntity('decision', id, cur => { const prev = (cur.draft || {}) as Draft; const status = prev.status === 'approved' || prev.status === 'pushed' ? prev.status : (origin === 'founder' ? 'edited' : 'suggested');
    return { ...cur, draft: { ...prev, ...patch, status, origin, generatedAt: prev.generatedAt || now } }; }, true);
  return { ok: true };
}

/** Auto-classify contacts with no fit score yet, from segment and seniority. Never overwrites a Claude or founder score. */
export async function autoClassify({ limit = 400 } = {}) {
  const records = (await listScope('source')).filter(r => r.kind !== 'opportunity' && typeof r.fitScore !== 'number').slice(0, limit);
  const { categoriseLead } = await import('./lead-categorisation');
  const BUYER = /developer|asset owner|lender|debt|investor|private equity|hotel|operational|data centre|public sector/i;
  const SENIOR = /\b(director|head|chief|ceo|cfo|coo|cio|md|managing|partner|founder|owner|principal|vp|vice president|president)\b/i;
  const SECTOR: Record<string, string> = { 'Developer / Asset Owner': 'Developer/Asset Owner', 'Lender / Debt Fund': 'Lender/Debt Fund', 'Investor / Private Equity': 'Investor/PE', 'Hotel / Operational Real Estate': 'Hotel/Operator', 'Data Centre': 'Data Centre', 'Public Sector': 'Public/Housing', 'PM / QS': 'PM/QS/Consultant', Contractor: 'Contractor', 'Designer / Consultant': 'PM/QS/Consultant', 'Introducer / Professional Network': 'Introducer', 'Other / Unclassified': 'Supplier/Other' };
  let scored = 0;
  for (const r of records) {
    const cat = categoriseLead(r); const seg = cat.segment; const senior = SENIOR.test(String(r.jobTitle || ''));
    const fit = BUYER.test(seg) ? (senior ? 2 : 1) : /PM|Contractor|Designer|Introducer/.test(seg) ? 1 : 0;
    const reason = `${seg}${r.jobTitle ? ', ' + r.jobTitle : ''}; auto-classified at ${cat.confidence}% confidence`;
    await updateEntity('source', r.id, cur => ({ ...cur, fitScore: fit, fitSector: SECTOR[seg] || 'Supplier/Other', fitReason: reason.slice(0, 200), suggestionOrigin: 'Auto classification' }));
    scored++;
  }
  return { scored, remaining: Math.max(0, records.length === limit ? 1 : 0) };
}


// ---- Settings, batch approval, templates, proposals ----
export type Settings = { dailyQuota: number; batchApprove: boolean; batchCap: number };
export async function getSettings(): Promise<Settings> {
  const d = await getOne('decision', 'settings:board');
  return { dailyQuota: Number(d?.dailyQuota ?? 10), batchApprove: !(d?.batchApprove === false || d?.batchApprove === 'Off'), batchCap: Number(d?.batchCap ?? 10) };
}

/** Approve the top N drafts that a founder or Claude has already shaped (never raw engine text). */
export async function batchApprove({ limit, actor }: { limit?: number; actor: string }) {
  const s = await getSettings(); if (!s.batchApprove) return { approved: 0, reason: 'Batch approve is off' };
  const cap = Math.min(limit ?? s.batchCap, s.batchCap);
  const [decisions, prio] = await Promise.all([listScope('decision'), priorityList({ cell: 'All', limit: 5000 })]);
  const score = new Map<string, number>((prio.rows || []).map((x: any) => [x.id, x.score]));
  const todo = decisions.filter(d => { const dr = d.draft as Draft | undefined; return dr && ['suggested', 'edited'].includes(dr.status) && dr.origin !== 'engine' && dr.kind !== 'call' && dr.to; })
    .sort((a, b) => (score.get(b.id) || 0) - (score.get(a.id) || 0)).slice(0, cap);
  const now = new Date().toISOString();
  for (const d of todo) { await updateEntity('decision', d.id, cur => ({ ...cur, draft: { ...cur.draft, status: 'approved', approvedAt: now, approvedBy: actor + ' (batch)' } }));
    await logEvent({ entityId: d.id, recordId: d.id, type: 'Draft approved', actor, note: `Batch approve: ${(d.draft as Draft).subject}` }); }
  return { approved: todo.length, ids: todo.map(d => d.id) };
}

export async function listTemplates() {
  const over = (await listScope('decision')).filter(d => String(d.id).startsWith('template:'));
  const m = templateMap(over.map(d => ({ key: String(d.id).slice(9), subject: d.subject, body: d.body })));
  return [...m.values()].map(t => ({ ...t, custom: over.some(d => d.id === 'template:' + t.key && (d.subject || d.body)) }));
}
export async function saveTemplate(key: string, patch: { subject?: string; body?: string; reset?: boolean }) {
  if (!DEFAULT_TEMPLATES.some(t => t.key === key)) throw new Error('Unknown template ' + key);
  await updateEntity('decision', 'template:' + key, cur => patch.reset ? { id: cur.id, updatedAt: new Date().toISOString() } : ({ ...cur, ...(patch.subject != null ? { subject: patch.subject } : {}), ...(patch.body != null ? { body: patch.body } : {}), updatedAt: new Date().toISOString() }), true);
  return { ok: true };
}

/** Proposals: Claude writes one from a logged meeting; founders approve; the morning run puts it in Outlook as a draft with the cover note. */
export type Proposal = { title: string; scheme: string; body: string; cover: string; subject: string; to: string; status: 'suggested' | 'edited' | 'approved' | 'pushed' | 'skipped'; origin: 'Claude' | 'founder'; generatedAt: string; approvedAt?: string; approvedBy?: string; pushedAt?: string; outlookId?: string };
export async function saveProposal(id: string, p: Omit<Proposal, 'status' | 'generatedAt' | 'origin'> & { origin?: Proposal['origin'] }) {
  await updateEntity('decision', id, cur => { const prev = (cur.proposal || {}) as Partial<Proposal>; if (['approved', 'pushed'].includes(String(prev.status))) return cur;
    return { ...cur, proposal: { ...prev, ...p, status: 'suggested', origin: p.origin || 'Claude', generatedAt: prev.generatedAt || new Date().toISOString() } }; }, true);
  await logEvent({ entityId: id, recordId: id, type: 'Proposal drafted', note: p.title });
  return { ok: true };
}
export async function approvedProposals(limit = 20) {
  const [records, decisions] = await Promise.all([listScope('source'), listScope('decision')]);
  const byId = new Map(records.map(r => [r.id, r]));
  return decisions.filter(d => (d.proposal as Proposal | undefined)?.status === 'approved').slice(0, limit).map(d => { const r = byId.get(d.id) || ({} as Entity); const p = d.proposal as Proposal; return { id: d.id, name: r.name || '', company: r.company || '', ...p }; });
}
export async function markProposalPushed(id: string, outlookId: string) {
  await updateEntity('decision', id, cur => ({ ...cur, proposal: { ...(cur.proposal || {}), status: 'pushed', pushedAt: new Date().toISOString(), outlookId } }));
  await logEvent({ entityId: id, recordId: id, type: 'Proposal to Outlook', note: `Approved proposal placed in Outlook Drafts (${outlookId.slice(0, 12)}…). Not sent.` });
  return { ok: true };
}
