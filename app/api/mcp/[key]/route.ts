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
    for (const item of items) {
      try {
        await updateEntity('source', item.id, r => ({ ...r, fitScore: item.fit, fitSector: item.sector, fitReason: item.reason, assessedAt: r.assessedAt || new Date().toISOString() }));
        saved++;
      } catch { missing.push(item.id); }
    }
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
