// Vanor BD connector for Claude (MCP over streamable HTTP).
// URL: https://<app>/api/mcp/<VANOR_MCP_KEY>  — add it in Claude as a custom connector.
// Claude can read, suggest, log and draft. It cannot review, archive, move stages or delete:
// those stay founder decisions in the board.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  CONDITIONS, CONDITION_QUESTIONS, chaseList, contactSummary, findDuplicate, reviewStatus, today, validDate,
} from '../../../../lib/bd-logic';
import {
  findByEmail, getOne, listScope, logEvent, saveEntity, searchSources, updateEntity, type Entity,
} from '../../../../lib/bd-store';
import { lookupPerson } from '../../../../lib/rocketreach';
import { runIntel } from '../../../../lib/intel-ingest';
import { priorityList } from '../../../../lib/priority';
import { logOutcome, funnel, STEPS } from '../../../../lib/funnel';
import { generateDrafts, approvedDrafts, markDraftPushed, saveDraft, autoClassify, batchApprove, listTemplates, saveTemplate, saveProposal, approvedProposals, markProposalPushed, getSettings } from '../../../../lib/outreach';
import { signalFeed, setHeadline } from '../../../../lib/signals-feed';
import { researchCompany, normCompany } from '../../../../lib/company-intel';
import { researchBatch, saveIntel, signalContacts } from '../../../../lib/company-intel-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ACTOR = 'Claude';
const out = (data: unknown, text: string) => ({ structuredContent: data as Record<string, unknown>, content: [{ type: 'text' as const, text: text + '\n' + JSON.stringify(data) }] });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('YYYY-MM-DD');
const score = z.number().int().min(0).max(2);

async function workFor(recordId: string) {
  return (await listScope('work')).filter(w => w.recordId === recordId);
}

async function eventsFor(ids: string[]) {
  const wanted = new Set(ids);
  return (await listScope('event')).filter(e => wanted.has(e.entityId) || wanted.has(e.recordId));
}

async function summary(id: string) {
  const record = await getOne('source', id);
  if (!record) throw new Error(`No contact with id ${id}. Use search_contacts first.`);
  const [decision, works] = await Promise.all([getOne('decision', id), workFor(id)]);
  const events = await eventsFor([id, ...works.map(w => w.id)]);
  return contactSummary(record, decision, works, events);
}

function createServer() {
  const server = new McpServer(
    { name: 'vanor-bd', version: '2.0.0' },
    { instructions: [
      'Vanor BD is the business development board for Vanor Advisory (Barry and Graeme).',
      'Always search before adding a lead, and log every interaction you process against the right contact.',
      'Score the seven conditions 0 (no evidence), 1 (partial), 2 (evidenced), and only from evidence you can quote.',
      'Your scores are suggestions. Founders confirm evidence, move stages, review and archive in the board.',
      'Never invent projects, fees, problems or contact details.',
    ].join(' ') },
  );

  server.registerTool('pipeline_overview', {
    title: 'Pipeline overview and chase list',
    description: 'Start here. Counts by board stage and review status, cards due or overdue today, and the highest-scoring contacts not yet on the board.',
    inputSchema: { limit: z.number().int().min(1).max(50).optional() },
    annotations: { readOnlyHint: true },
  }, async ({ limit }) => {
    const [records, decisionList, work] = await Promise.all([listScope('source'), listScope('decision'), listScope('work')]);
    const decisions = Object.fromEntries(decisionList.map(d => [d.id, d]));
    const at = today();
    const stages: Record<string, number> = {};
    work.filter(w => !w.archived).forEach(w => { stages[w.stage] = (stages[w.stage] || 0) + 1; });
    const review: Record<string, number> = {};
    records.filter(r => r.kind !== 'opportunity').forEach(r => { const s = reviewStatus(r, decisions[r.id], at); review[s] = (review[s] || 0) + 1; });
    const data = {
      today: at, contacts: records.length, withEmail: records.filter(r => r.email).length,
      boardStages: stages, reviewStatus: review, ...chaseList(records, decisions, work, at, limit || 15),
    };
    return out(data, `${records.length} contacts, ${work.filter(w => !w.archived).length} live board cards.`);
  });

  server.registerTool('search_contacts', {
    title: 'Search contacts',
    description: 'Find contacts by name, company, email or job title. Returns ids for the other tools.',
    inputSchema: { query: z.string().min(2), limit: z.number().int().min(1).max(50).optional() },
    annotations: { readOnlyHint: true },
  }, async ({ query, limit }) => {
    const hits = await searchSources(query, limit || 20);
    const data = { results: hits.map(r => ({ id: r.id, kind: r.kind, name: r.name, company: r.company, jobTitle: r.jobTitle || '', email: r.email || '' })) };
    return out(data, `${hits.length} match(es) for "${query}".`);
  });

  server.registerTool('list_contacts', {
    title: 'List contacts in batches',
    description: 'Page through contacts for bulk work, e.g. scoring every contact Claude has not yet assessed. Returns compact rows with context so you can assess without calling get_contact each time.',
    inputSchema: {
      unassessedOnly: z.boolean().optional(), missingEmailOnly: z.boolean().optional(),
      offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(50).optional(),
    },
    annotations: { readOnlyHint: true },
  }, async ({ unassessedOnly, missingEmailOnly, offset, limit }) => {
    const [records, decisions] = await Promise.all([listScope('source'), listScope('decision')]);
    const byId = new Map(decisions.map(d => [d.id, d]));
    const pool = records.filter(r => r.kind !== 'opportunity' && byId.get(r.id)?.status !== 'Archive')
      .filter(r => !unassessedOnly || !r.assessedAt).filter(r => !missingEmailOnly || !r.email);
    const start = offset || 0, size = limit || 25;
    const rows = pool.slice(start, start + size).map(r => ({
      id: r.id, kind: r.kind, name: r.name, company: r.company, jobTitle: r.jobTitle || '', segment: byId.get(r.id)?.segment || r.segment || '',
      owner: r.sourceOwner || '', lastContact: r.lastContact || '', hasEmail: Boolean(r.email),
      context: String(r.context || '').slice(0, 300), notes: String(r.notes || '').slice(0, 300), currentScores: r.suggestedScores || {},
    }));
    return out({ total: pool.length, offset: start, nextOffset: start + size < pool.length ? start + size : null, contacts: rows }, `${rows.length} of ${pool.length}.`);
  });

  server.registerTool('find_contact_by_email', {
    title: 'Find contact by email',
    description: 'Exact email match. Use when processing an email to see if the sender or recipient is already known.',
    inputSchema: { email: z.string().email() },
    annotations: { readOnlyHint: true },
  }, async ({ email }) => {
    const hits = await findByEmail(email);
    return out({ results: hits.map(r => ({ id: r.id, name: r.name, company: r.company })) }, hits.length ? 'Known contact.' : 'Not in Vanor BD.');
  });

  server.registerTool('get_contact', {
    title: 'Get contact',
    description: 'Full picture of one contact: details, board stage, next ask, the seven conditions with evidence, chase score and recent history.',
    inputSchema: { id: z.string() },
    annotations: { readOnlyHint: true },
  }, async ({ id }) => out(await summary(id), 'Contact loaded.'));

  server.registerTool('log_interaction', {
    title: 'Log an interaction',
    description: 'Record an email, meeting, call or note against a contact (e.g. from Outlook or a Pocket meeting note). Updates last contact so the board flags it for review.',
    inputSchema: {
      id: z.string(), kind: z.enum(['email_in', 'email_out', 'meeting', 'call', 'note']), date,
      summary: z.string().min(10).max(2000).describe('What happened and anything they said about projects, needs, timing or decision-makers.'),
      source: z.string().optional().describe('Where this came from, e.g. "Outlook" or the Pocket note file name.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async ({ id, kind, date: when, summary: text, source }) => {
    await updateEntity('source', id, r => (!r.lastContact || String(r.lastContact).slice(0, 10) < when) ? { ...r, lastContact: when } : r);
    await logEvent({ entityId: id, recordId: id, type: `Interaction: ${kind.replace('_', ' ')}`, note: text, date: when, source: source || '' });
    return out(await summary(id), 'Interaction logged.');
  });

  server.registerTool('set_next_action', {
    title: 'Set next action',
    description: 'Set the next ask and date for a contact. Writes to their live board card if they have one, otherwise to their review record.',
    inputSchema: { id: z.string(), nextAsk: z.string().min(5).max(300), nextDate: date, reason: z.string().min(5).max(500) },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async ({ id, nextAsk, nextDate, reason }) => {
    if (!validDate(nextDate)) throw new Error('Invalid date.');
    if (!await getOne('source', id)) throw new Error(`No contact with id ${id}.`);
    const card = (await workFor(id)).find(w => !w.archived && w.stage !== 'Won');
    if (card) await updateEntity('work', card.id, w => ({ ...w, nextAsk, nextDate, waiting: false }));
    else await updateEntity('decision', id, d => ({ ...d, nextAsk, nextDate }), true);
    await logEvent({ entityId: card?.id || id, recordId: id, type: 'Next action set', note: `${nextAsk} (by ${nextDate}). ${reason}` });
    return out(await summary(id), card ? 'Board card updated.' : 'Review record updated.');
  });

  server.registerTool('record_assessment', {
    title: 'Record Claude assessment',
    description: 'Save your evidence-based scoring of a contact: buyer fit (0-2) and the seven conditions (0-2 each) with the evidence for each score, plus one suggested next move. '
      + 'Conditions: ' + CONDITIONS.map(k => `${k} = ${CONDITION_QUESTIONS[k]}`).join('; '),
    inputSchema: {
      id: z.string(),
      fit: score.describe('0 = not a buyer of Vanor services, 1 = adjacent/influencer/introducer, 2 = senior decision-maker in a target sector'),
      fitReason: z.string().min(5).max(300),
      scores: z.object(Object.fromEntries(CONDITIONS.map(k => [k, score])) as Record<string, typeof score>),
      evidence: z.record(z.string(), z.string().max(400)).describe('Evidence per condition you scored above 0, keyed by condition name.'),
      suggestedAction: z.string().min(5).max(400),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ id, fit, fitReason, scores, evidence, suggestedAction }) => {
    for (const [k, v] of Object.entries(scores)) if (v > 0 && !evidence[k]?.trim()) throw new Error(`Give evidence for ${k} or score it 0.`);
    const blocker = CONDITIONS.find(k => (scores as Record<string, number>)[k] < 2) || '';
    await updateEntity('source', id, r => ({ ...r, fitScore: fit, fitReason, suggestedScores: scores, suggestedEvidence: evidence,
      suggestedBlocker: blocker, suggestedAction, suggestionOrigin: 'Claude assessment', assessedAt: new Date().toISOString() }));
    return out(await summary(id), 'Assessment saved as a suggestion for founder review.');
  });

  server.registerTool('record_fit_batch', {
    title: 'Record buyer fit for many contacts',
    description: 'Bulk-save buyer fit (0-2), sector and a short reason for up to 200 contacts at once. Only touches fit fields; never founder evidence. Use for scoring passes.',
    inputSchema: { items: z.array(z.object({ id: z.string(), fit: score, sector: z.string().max(40), reason: z.string().max(200) })).min(1).max(200) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ items }) => {
    let saved = 0; const missing: string[] = [];
    const queue = [...items];
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const it = item;
        try {
          await updateEntity('source', it.id, r => ({ ...r, fitScore: it.fit, fitSector: it.sector, fitReason: it.reason, assessedAt: r.assessedAt || new Date().toISOString() }));
          saved++;
        } catch { missing.push(it.id); }
      }
    };
    await Promise.all(Array.from({ length: 20 }, worker));
    return out({ saved, missing }, `Saved fit for ${saved} contact(s).`);
  });

  server.registerTool('add_lead', {
    title: 'Add a new lead',
    description: 'Add a person who is not yet in Vanor BD (from email, a meeting, news, planning or administration research). It lands in the review queue as "New"; it does not go on the board. Duplicates are refused.',
    inputSchema: {
      name: z.string().min(2), company: z.string().min(2), jobTitle: z.string().optional(),
      email: z.string().email().optional(), phone: z.string().optional(), linkedin: z.string().url().optional(),
      context: z.string().min(10).max(1500).describe('Why this person matters to Vanor, with the trigger (scheme, distress, funding event, meeting).'),
      source: z.string().min(2).describe('e.g. "Outlook", "Pocket note", "Planning portal", "The Gazette", a news site'),
      sourceUrl: z.string().url().optional(), owner: z.enum(['Barry', 'Graeme']).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async input => {
    const records = await listScope('source');
    const dup = findDuplicate(records, input);
    if (dup) return out({ created: false, existingId: dup.id, name: dup.name, company: dup.company }, 'Already in Vanor BD. Log an interaction instead.');
    const id = 'claude:' + crypto.randomUUID();
    const record: Entity = {
      id, kind: 'lead', origin: 'manual', addedBy: ACTOR, name: input.name, company: input.company, jobTitle: input.jobTitle || '',
      email: input.email || '', phone: input.phone || '', linkedin: input.linkedin || '', context: input.context, notes: '',
      source: input.source, sourceUrl: input.sourceUrl || '', sourceOwner: input.owner || '', segment: '', region: '', route: '',
      lastContact: '', nextAsk: '', nextDate: '', sourceStage: 'New lead', classification: 'New lead', createdAt: new Date().toISOString(),
    };
    const saved = await saveEntity('source', record, 0);
    if (!saved) throw new Error('Could not save the lead. Try again.');
    await logEvent({ entityId: id, recordId: id, type: 'Lead added', note: `${input.source}: ${input.context.slice(0, 200)}` });
    return out({ created: true, id }, 'Lead added to the review queue.');
  });

  server.registerTool('scan_intel', {
    title: 'Scan planning, administration and market feeds',
    description: 'Runs the Vanor intel scanner: PlanIt and planning.data.gov.uk consents, Construction Enquirer, The Gazette insolvency notices, Hotel Owner and Hospitality Net. Scores each signal (complexity, distress, money, timing, buyer type). With write=false it only previews; with write=true the best new signals are added to the review queue as leads (deduplicated, max 15) and existing contacts at the same organisation get a Trigger note. Runs automatically every weekday at 05:40 UTC.',
    inputSchema: { write: z.boolean().default(false), limit: z.number().int().min(1).max(30).optional(), minScore: z.number().int().min(0).max(100).optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  }, async ({ write, limit, minScore }) => {
    const result = await runIntel({ write, limit, minScore });
    return out(result, write ? 'Scan complete; leads added to the review queue.' : 'Preview only; nothing written.');
  });

  server.registerTool('research_company', {
    title: 'Research one company',
    description: 'Companies House (status, directors, new charges = lending or property purchase, new directors), PlanIt planning applications and Gazette insolvency notices for one company. Saves the result on every contact at that company and returns dated signals plus a one-line "need" read. Give a contact id or a company name.',
    inputSchema: { id: z.string().optional(), company: z.string().min(2).optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  }, async ({ id, company }) => {
    const name = company || (id ? (await getOne('source', id))?.company : '');
    if (!name) throw new Error('Give a contact id with a company, or a company name.');
    const intel = await researchCompany(name);
    const ids = (await listScope('source')).filter(r => normCompany(r.company) === normCompany(name)).map(r => r.id);
    if (ids.length) await saveIntel(ids, intel);
    return out({ ...intel, savedOn: ids.length }, `${intel.matchedName || name}: ${intel.need}`);
  });

  server.registerTool('research_companies_batch', {
    title: 'Research the next batch of companies',
    description: 'Researches the highest-fit companies whose research is missing or over 30 days old, until ~40 seconds have passed (about 8-15 companies). Call repeatedly to work through the list; "remaining" says how many are left.',
    inputSchema: { limit: z.number().int().min(1).max(25).optional(), minFit: z.number().int().min(0).max(2).optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  }, async ({ limit, minFit }) => out(await researchBatch({ limit: limit || 15, minFit: minFit ?? 1 }), 'Batch researched.'));

  server.registerTool('list_signals', {
    title: 'Contacts with live buying signals',
    description: 'Contacts at companies with recent signals (new lending or property charge, planning, insolvency, new director), best fit first, with the company need read and directors. Use to pick who to contact and to draft outreach that references the signal.',
    inputSchema: { minFit: z.number().int().min(0).max(2).optional(), maxAgeDays: z.number().int().min(7).max(730).optional(), limit: z.number().int().min(1).max(100).optional() },
    annotations: { readOnlyHint: true },
  }, async ({ minFit, maxAgeDays, limit }) => out(await signalContacts({ minFit: minFit ?? 2, maxAgeDays: maxAgeDays ?? 120, limit: limit ?? 40 }), 'Signals listed.'));

  server.registerTool('priority_list', {
    title: 'Priority matrix: who to work, in order',
    description: 'The board\'s priority matrix. Grade A/B/C = right buyer (fit); Heat 1-3 = live need (dated signals, fading after 90 days) + relationship (board stage, recent contact, known contact). Cells: A1 pursue now (calls), A2 signal-led email or nurture, A3 watch, B1 ask for intro, B2 keep warm, B3 low, C not buyers; T1 = top 40 grade-A accounts. Returns counts per cell and the ranked contacts for one cell with "why" and "move".',
    inputSchema: { cell: z.enum(['All', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'T1']).optional(), limit: z.number().int().min(1).max(100).optional() },
    annotations: { readOnlyHint: true },
  }, async ({ cell, limit }) => out(await priorityList({ cell: cell || 'All', limit: limit || 30 }), 'Priority list.'));

  server.registerTool('log_outcome', {
    title: 'Log an outreach outcome (closes the loop)',
    description: 'Record a funnel step against a contact: sent (an email Barry/Graeme actually sent, from Outlook Sent Items), reply (the contact wrote back), meeting_booked (calendar event with them), meeting_held, proposal, won. '
      + 'Pass ref = the Outlook message id or calendar event id so the same thing is never counted twice. trigger = the signal that led to the outreach (lending, property, planning, distress, new_spv, new_director, scan, warm, none). Drafts are NOT sent; never log a draft as sent.',
    inputSchema: {
      id: z.string(), step: z.enum(STEPS), date, ref: z.string().max(300).optional(), trigger: z.string().max(40).optional(),
      channel: z.enum(['email', 'call', 'linkedin', 'in_person']).optional(), note: z.string().min(5).max(1000), source: z.string().max(80).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async (input) => out(await logOutcome(input), 'Outcome logged.'));

  server.registerTool('move_events', {
    title: 'Move misfiled history to the right contact',
    description: 'Re-attach Claude-logged interactions/outcomes that were filed against the wrong contact. Moves every Claude-authored event on fromId whose "at" timestamp falls within [fromAt, toAt] to toId. Founder-authored events are never moved. Returns the moved count.',
    inputSchema: { fromId: z.string(), toId: z.string(), fromAt: z.string().describe('ISO timestamp, inclusive'), toAt: z.string().describe('ISO timestamp, inclusive') },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ fromId, toId, fromAt, toAt }) => {
    if (!await getOne('source', toId)) throw new Error(`No contact with id ${toId}.`);
    const events = (await listScope('event')).filter(e => (e.recordId === fromId || e.entityId === fromId) && e.actor === ACTOR && String(e.at) >= fromAt && String(e.at) <= toAt);
    let moved = 0, latest = '';
    for (const e of events) {
      const saved = await saveEntity('event', { ...e, entityId: e.entityId === fromId ? toId : e.entityId, recordId: toId, movedFrom: fromId }, e._rev || 1);
      if (saved) { moved++; latest = [latest, String(e.date || e.at).slice(0, 10)].sort().pop() || latest; }
    }
    if (latest) await updateEntity('source', toId, r => (!r.lastContact || String(r.lastContact).slice(0, 10) < latest) ? { ...r, lastContact: latest } : r);
    return out({ moved, of: events.length }, `Moved ${moved} events.`);
  });

  server.registerTool('generate_draft', {
    title: 'Engine draft for a contact',
    description: 'Runs the outreach engine for one contact: picks the angle (signal-led, nurture, intro via a warm contact, first approach, chase) and writes a first draft in Barry\'s voice onto the record (decision.draft, status "suggested"). Returns it so you can polish it with save_draft. Never overwrites a draft the founders have edited or approved.',
    inputSchema: { id: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ id }) => { const made = await generateDrafts({ ids: [id], limit: 1 }); const d = await getOne('decision', id); return out({ ...made, draft: d?.draft || null }, 'Draft generated.'); });

  server.registerTool('save_draft', {
    title: 'Save a polished draft onto the record',
    description: 'Write your improved subject/body/angle for a contact into the board (decision.draft). Keep BARRY\'S VOICE. Status stays "suggested" until a founder approves it in the board; an approved or pushed draft is never downgraded. Use after generate_draft, or for a contact with no draft.',
    inputSchema: { id: z.string(), subject: z.string().min(2).max(120), body: z.string().min(20).max(3000), angle: z.string().max(200).optional(), kind: z.enum(['signal', 'nurture', 'intro', 'first', 'chase', 'post_meeting']).optional(), to: z.string().email().optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ id, ...patch }) => out(await saveDraft(id, patch as any, 'Claude'), 'Draft saved.'));

  server.registerTool('approved_drafts', {
    title: 'Drafts approved in the board, waiting for Outlook',
    description: 'Founders approve drafts inside the board. This lists those not yet in Outlook Drafts: to, subject, body (plain text, already in Barry\'s voice, do not rewrite). Create each as an Outlook DRAFT (never send), then call mark_draft_pushed with the Outlook message id.',
    inputSchema: { limit: z.number().int().min(1).max(50).optional() },
    annotations: { readOnlyHint: true },
  }, async ({ limit }) => out({ drafts: await approvedDrafts(limit || 30) }, 'Approved drafts.'));

  server.registerTool('mark_draft_pushed', {
    title: 'Record that an approved draft is now in Outlook Drafts',
    inputSchema: { id: z.string(), outlookId: z.string().min(5) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ id, outlookId }) => out(await markDraftPushed(id, outlookId), 'Marked pushed.'));

  server.registerTool('auto_classify', {
    title: 'Auto-classify unscored contacts',
    description: 'Gives every contact with no fit score a provisional fit (0-2), sector and reason from segment and seniority. Runs daily at 06:40 anyway; call it after adding many leads. Never overwrites existing scores.',
    inputSchema: { limit: z.number().int().min(1).max(500).optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ limit }) => out(await autoClassify({ limit: limit || 300 }), 'Classified.'));

  server.registerTool('batch_approve', {
    title: 'Approve the top polished drafts in one go',
    description: 'Approves up to N drafts (ranked by priority score) that Claude has polished or a founder has edited; raw engine text is never approved this way. Respects the board setting (batchApprove on/off, daily cap). Use only when the board setting allows it; founders can also press "Approve top N" in the board.',
    inputSchema: { limit: z.number().int().min(1).max(25).optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ limit }) => out(await batchApprove({ limit, actor: 'Claude' }), 'Batch approved.'));

  server.registerTool('list_templates', {
    title: 'Email templates the engine uses',
    description: 'The editable template library (first_approach, signal_cold, signal_warm, nurture, chase1, chase2, intro_ask, post_meeting, proposal_cover) with placeholders {first} {company} {wc} {offer} {scheme} {via_first} {name}. custom=true when a founder has edited it. When polishing a draft, stay close to the template the founders chose.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => out({ templates: await listTemplates(), settings: await getSettings() }, 'Templates.'));

  server.registerTool('save_template', {
    title: 'Edit an email template',
    description: 'Overwrite a template\'s subject and/or body. Only do this when a founder asks for a template change; keep the placeholders.',
    inputSchema: { key: z.string(), subject: z.string().max(120).optional(), body: z.string().max(3000).optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ key, ...patch }) => out(await saveTemplate(key, patch), 'Template saved.'));

  server.registerTool('save_proposal', {
    title: 'Draft a proposal onto a contact record',
    description: 'After a logged meeting that names a scheme or problem, write a short staged proposal (Stress Test / peer review / position finding, then options) in plain text: title, scheme, body (the proposal, 300-900 words, headed sections, fees only if the founders stated them), cover (the covering email in Barry\'s voice, use the proposal_cover template), subject, to. Stored as decision.proposal status "suggested"; founders approve in the board under Today > Proposals to issue; the morning run then puts it in Outlook Drafts (never sent). Never overwrites an approved or pushed proposal.',
    inputSchema: { id: z.string(), title: z.string().min(3).max(160), scheme: z.string().max(160), body: z.string().min(100).max(12000), cover: z.string().min(20).max(3000), subject: z.string().min(2).max(120), to: z.string().email() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ id, ...p }) => out(await saveProposal(id, p), 'Proposal saved.'));

  server.registerTool('approved_proposals', {
    title: 'Proposals approved in the board, waiting for Outlook',
    description: 'List approved proposals not yet in Outlook Drafts: to, subject, cover (email body), body (proposal text, append under a line after the cover, or attach as the email body). Create an Outlook DRAFT (never send), then mark_proposal_pushed.',
    inputSchema: { limit: z.number().int().min(1).max(50).optional() },
    annotations: { readOnlyHint: true },
  }, async ({ limit }) => out({ proposals: await approvedProposals(limit || 20) }, 'Approved proposals.'));

  server.registerTool('mark_proposal_pushed', {
    title: 'Record that an approved proposal is now in Outlook Drafts',
    inputSchema: { id: z.string(), outlookId: z.string().min(5) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ id, outlookId }) => out(await markProposalPushed(id, outlookId), 'Marked pushed.'));

  server.registerTool('signal_feed', {
    title: 'Signals feed (what the board shows under Signals)',
    description: 'Newest-first list of surfaced leads and company signals: id, key, date, source, headline, why, text, cell, polished (true once a Claude headline exists). Use to polish headlines (set_headline) and for the weekly digest. buyersOnly=false includes grade-C companies (e.g. Gazette insolvencies).',
    inputSchema: { days: z.number().int().min(1).max(365).optional(), buyersOnly: z.boolean().optional(), limit: z.number().int().min(1).max(200).optional() },
    annotations: { readOnlyHint: true },
  }, async ({ days, buyersOnly, limit }) => out({ items: await signalFeed({ days: days ?? 30, buyersOnly: buyersOnly ?? true, limit: limit ?? 60 }) }, 'Signal feed.'));

  server.registerTool('set_headline', {
    title: 'Polish a signal headline',
    description: 'Save a news-style headline (max 90 chars, plain, no filing quotes) and one line on why it matters for Vanor (max 160 chars) for a feed item, keyed by its id + key from signal_feed.',
    inputSchema: { id: z.string(), key: z.string(), headline: z.string().min(8).max(90), why: z.string().min(8).max(160) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ id, key, headline, why }) => out(await setHeadline(id, key, { headline, why }), 'Headline saved.'));

  server.registerTool('funnel_report', {
    title: 'Outreach funnel and what is working',
    description: 'Counts of sent / replies / meetings / proposals / won over the last N days (default 30), reply and meeting rates, and the same split by trigger type and priority cell so you can see which triggers and plays convert. Use in the Monday brief.',
    inputSchema: { days: z.number().int().min(7).max(365).optional() },
    annotations: { readOnlyHint: true },
  }, async ({ days }) => out(await funnel({ days: days || 30 }), 'Funnel.'));

  server.registerTool('fill_contact_details', {
    title: 'Fill missing contact details',
    description: 'Save an email, phone or LinkedIn found via the RocketReach connector (or another named source) onto a contact. Only fills EMPTY fields; never overwrites what a founder entered. Always say where it came from.',
    inputSchema: {
      id: z.string(), email: z.string().email().optional(), phone: z.string().max(40).optional(), linkedin: z.string().url().optional(),
      jobTitle: z.string().max(120).optional(), source: z.string().min(2).describe('e.g. "RocketReach connector"'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ id, email, phone, linkedin, jobTitle, source }) => {
    const filled: string[] = [];
    await updateEntity('source', id, r => {
      const next = { ...r };
      for (const [k, v] of Object.entries({ email, phone, linkedin, jobTitle })) if (v && !r[k]) { next[k] = v; filled.push(k); }
      next.enrichment = { ...(r.enrichment || {}), provider: source, at: new Date().toISOString(), filled };
      return next;
    });
    if (filled.length) await logEvent({ entityId: id, recordId: id, type: 'Details added', note: `${filled.join(', ')} from ${source}` });
    return out({ filled }, filled.length ? `Filled ${filled.join(', ')}.` : 'Nothing empty to fill.');
  });

  server.registerTool('enrich_contact', {
    title: 'Enrich contact via RocketReach',
    description: 'Look up email, phone and LinkedIn for a contact. Uses RocketReach credit, so only call it for contacts worth chasing (fit 2, or chase score 40+). Fills empty fields only; never overwrites.',
    inputSchema: { id: z.string(), force: z.boolean().optional().describe('Re-run even if looked up in the last 90 days') },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  }, async ({ id, force }) => {
    const record = await getOne('source', id);
    if (!record) throw new Error(`No contact with id ${id}.`);
    const last = record.enrichment?.at ? Date.parse(record.enrichment.at) : 0;
    if (!force && last && Date.now() - last < 90 * 86400000) return out({ skipped: true, enrichment: record.enrichment }, 'Looked up recently; skipped.');
    const result = await lookupPerson({ name: record.name, company: record.company, linkedin: record.linkedin || undefined });
    if (result.status === 'error') throw new Error(result.message || 'RocketReach lookup failed.');
    await updateEntity('source', id, r => ({
      ...r,
      email: r.email || result.emails[0]?.email || '',
      phone: r.phone || result.phones[0]?.number || '',
      linkedin: r.linkedin || result.linkedin || '',
      enrichment: { provider: 'RocketReach', at: new Date().toISOString(), ...result },
    }));
    await logEvent({ entityId: id, recordId: id, type: 'Contact enriched', note: `RocketReach: ${result.status}, ${result.emails.length} email(s), ${result.phones.length} phone(s).` });
    return out({ status: result.status, emails: result.emails, phones: result.phones, linkedin: result.linkedin }, `RocketReach: ${result.status}.`);
  });

  const eventSchema = {
    title: z.string().min(2), date, time: z.string().optional(), location: z.string().optional(), organiser: z.string().optional(),
    cost: z.string().optional(), link: z.string().url().optional(), fit: z.string().min(3), objective: z.string().min(3),
    targets: z.string().min(3), expectedOutcome: z.string().min(3), bookingDeadline: date.optional(), notes: z.string().optional(),
  };
  const key = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  server.registerTool('list_events', {
    title: 'List industry events', description: 'Events already in the Vanor Events tracker.',
    inputSchema: { includeArchived: z.boolean().optional() }, annotations: { readOnlyHint: true },
  }, async ({ includeArchived }) => {
    const events = (await listScope('planned_event')).filter(e => includeArchived || !e.archived);
    return out({ events }, `${events.length} events.`);
  });

  server.registerTool('add_researched_event', {
    title: 'Add researched event', description: 'Add one researched industry event as Research. Duplicates (same title and date) are skipped.',
    inputSchema: eventSchema, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async input => {
    const existing = (await listScope('planned_event')).find(e => !e.archived && e.date === input.date && key(e.title) === key(input.title));
    if (existing) return out({ created: false, duplicateId: existing.id }, 'Duplicate skipped.');
    const id = `event:${crypto.randomUUID()}`;
    await saveEntity('planned_event', { id, status: 'Research', owner: 'Unassigned', bookingReference: '', archived: false, ...input, createdBy: ACTOR, createdAt: new Date().toISOString() }, 0);
    await logEvent({ entityId: id, type: 'Event researched', note: `${input.title} / Research` });
    return out({ created: true, id }, 'Event added.');
  });

  return server;
}

function authorised(supplied: string) {
  const expected = process.env.VANOR_MCP_KEY || '';
  if (expected.length < 24) return false;
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(request: Request, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params;
  if (!authorised(key)) return Response.json({ error: 'Not found.' }, { status: 404 });
  const server = createServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
