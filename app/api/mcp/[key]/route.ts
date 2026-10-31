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
  findByEmail, getOne, listScope, listWork, logEvent, saveEntity, searchSources, updateEntity, type Entity,
} from '../../../../lib/bd-store';
import '../../../../public/vanor-classify.js';
import { lookupPerson, searchPeople } from '../../../../lib/rocketreach';
import { runIntel } from '../../../../lib/intel-ingest';
import { PRICE_LIST, RULES, firstStep, options as feeOptions, offerLines, decisionDateFrom } from '../../../../lib/fees';
import { signalFeed, setHeadline } from '../../../../lib/signals-feed';
import { researchCompany, normCompany } from '../../../../lib/company-intel';
import { bolsterPeople } from '../../../../lib/people-bolster';
import { addTodos, listTodos, jobRan } from '../../../../lib/todos';
import { proposePeople } from '../../../../lib/people-tray';
import { openCaptures, captureDone, captureImages } from '../../../../lib/captures';
import { researchBatch, saveIntel, signalContacts } from '../../../../lib/company-intel-store';
import { listPursuits, savePursuits, proposeNext, recordMeetings, setPerson, peopleDue } from '../../../../lib/pursuits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ACTOR = 'Claude';
const normRegion = (v?: string) => ((globalThis as any).VanorClassify?.normRegion(v || '') || '') as string;
const out = (data: unknown, text: string) => ({ structuredContent: data as Record<string, unknown>, content: [{ type: 'text' as const, text: text + '\n' + JSON.stringify(data) }] });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('YYYY-MM-DD');
const score = z.number().int().min(0).max(2);

async function workFor(recordId: string) {
  return (await listWork()).filter(w => w.recordId === recordId);
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

  server.registerTool('add_lead', {
    title: 'Add a new lead',
    description: 'Add a person who is not yet in Vanor BD (from email, a meeting, news, planning or administration research). It lands in the review queue as "New"; it does not go on the board. Duplicates are refused.',
    inputSchema: {
      name: z.string().min(2), company: z.string().min(2), jobTitle: z.string().optional(),
      email: z.string().email().optional(), phone: z.string().optional(), linkedin: z.string().url().optional(),
      context: z.string().min(10).max(1500).describe('Why this person matters to Vanor, with the trigger (scheme, distress, funding event, meeting).'),
      source: z.string().min(2).describe('e.g. "Outlook", "Pocket note", "Planning portal", "The Gazette", a news site'),
      sourceUrl: z.string().url().optional(), owner: z.enum(['Barry', 'Graeme']).optional(),
      signal: z.object({ stage: z.enum(['distress', 'stalled', 'funded', 'contractor_appointed', 'tender', 'on_site', 'granted', 'acquired']), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('The trigger date'), buyerType: z.enum(['developer', 'lender', 'fund', 'hotel_group', 'owner_occupier', 'public_body', 'family_office']).optional(), scheme: z.string().max(160).optional(), region: z.string().max(40).optional() }).optional().describe('Set this when the lead comes from a market signal (Distress Watch, press, a filing): it then lands on New leads ranked by the bar (distress first) and drops off after 14 days if untouched. company = the client who could hire Vanor (the exposed party in a distress), never the insolvent contractor.'),
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
    if (input.signal) { const g = input.signal; record.origin = 'intel'; record.region = g.region || ''; record.title = g.scheme || ''; record.intel = { stage: g.stage, signalDate: g.date, buyerType: g.buyerType || 'developer', parties: { developer: input.company }, region: g.region || '', score: 0, tier: 'Hot', why: input.source }; }
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
  }, async ({ minFit, maxAgeDays, limit }) => out({ items: await signalContacts({ minFit: minFit ?? 2, maxAgeDays: maxAgeDays ?? 120, limit: limit ?? 40 }) }, 'Signals listed.'));

  const pursuitItem = z.object({
    id: z.string().optional(), name: z.string().min(2).max(120).optional(),
    lane: z.enum(['funder', 'claims', 'dc', 'hotel', 'offices', 'other']).optional(),
    state: z.enum(['table', 'act', 'waiting', 'watch', 'won', 'lost', 'parked']).optional(),
    atStake: z.string().max(120).optional(), amount: z.number().min(0).max(5e7).optional().describe('Fee in pounds, a number'), type: z.enum(['one-off', 'monthly']).optional(), latest: z.string().max(300).optional(), nextAction: z.string().max(200).optional(),
    owner: z.enum(['Barry', 'Graeme', 'Both']).optional(), dueBy: date.optional(), org: z.string().max(120).optional(),
    person: z.string().max(160).optional(), email: z.string().max(160).optional(), recordId: z.string().optional(),
    source: z.string().max(200).optional(), notes: z.string().max(600).optional(),
    issuedOn: date.optional().describe('Date the proposal was sent'), validUntil: date.optional(), decisionDate: date.optional().describe('Only a date the client stated; quote it in latest'), chaseOn: date.optional(),
    energisedBy: date.optional().describe('Data centres: grid energisation date'), capital: z.string().max(200).optional().describe('Data centres: sponsor, equity and lenders'), keyContractors: z.string().max(200).optional().describe('Data centres: main, M&E and commissioning contractors'),
    gate: z.object({ asset: z.boolean().optional(), problem: z.boolean().optional(), capital: z.boolean().optional(), route: z.boolean().optional() }).optional(),
  });
  server.registerTool('pursuits_list', {
    title: 'Pursuits: the front page of the board, by lane and state',
    description: 'v4 (30 Oct 2026). A pursuit is a named piece of payable work. Lanes: funder (lender recovery, independent monitoring, technical due diligence), claims (sub-consulting to claims/delay/planning firms), dc (data centres), hotel, offices (commercial office lease events: find, relocate or refit at lease end, £2-25m), other. States: table (price with them), act (all four conditions met: named asset, real problem, exposed funder/owner, route to decider), waiting (their move), watch (credible but a condition missing); won/lost/parked are closed. Each open pursuit has one next action, an owner and a due date. Use this, not today/lead_matrix, to say what matters.',
    inputSchema: { lane: z.enum(['all', 'funder', 'claims', 'dc', 'hotel', 'offices', 'other']).optional(), includeClosed: z.boolean().optional() },
    annotations: { readOnlyHint: true },
  }, async ({ lane, includeClosed }) => out(await listPursuits({ lane: lane || 'all', includeClosed }), 'Pursuits.'));
  server.registerTool('pursuits_save', {
    title: 'Create or update pursuits (batch)',
    description: 'Matches by id, else exact name. Anything outside Watch must have all four gate conditions true and a next action, or it is rejected with the reason. Claude may create up to 5 pursuits a day, each in Watch, each with a source (quote or link); it may refresh latest/notes/contact fields and the amount; it can never set invoicedOn or lostReason; on an EXISTING pursuit Claude cannot change state, nextAction, dueBy or owner (use pursuit_propose). Founders change those on the board; there is no override from here.',
    inputSchema: { items: z.array(pursuitItem).min(1).max(50) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ items }) => out(await savePursuits(items, 'Claude'), 'Pursuits saved.'));
  server.registerTool('pursuit_propose', {
    title: 'Propose the next move on a pursuit from new evidence (mail, calendar, transcript)',
    description: 'The board shows it as "Proposed" with an Accept button; the founder\'s current next action stays until accepted. why = the evidence, e.g. "Matthew replied 30 Oct: board meets 5 Nov". latest = one line on what just happened.',
    inputSchema: { id: z.string(), nextAction: z.string().min(3).max(200), dueBy: date.optional(), state: z.enum(['table', 'act', 'waiting', 'watch', 'won', 'lost', 'parked']).optional(), latest: z.string().max(300).optional(), why: z.string().min(3).max(300) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ id, ...p }) => out(await proposeNext(id, p), 'Proposed.'));
  server.registerTool('people_met', {
    title: 'People: record meetings from the calendar (batch)',
    description: 'One item per external person per meeting that actually happened. Matches by exact email only; a name alone is never auto-recorded. Pass eventId (the calendar event id) so a meeting is never counted twice. Future dates are refused. Returns toConfirm (names with no email, bad dates) and unmatched emails for the founders. Sets last met, counts meetings, and optionally the one-line note from the meeting, the rung (target/contact/referrer/active/partner), lane and the McMakin buying stage reached (Aware, Understands, Interested, Respects, Trusts, Able, Ready). Returns the unmatched so they can be added.',
    inputSchema: { meetings: z.array(z.object({ email: z.string().optional(), name: z.string().optional(), date, eventId: z.string().max(200).optional(), note: z.string().max(300).optional(), rung: z.enum(['target', 'contact', 'referrer', 'active', 'partner']).optional(), lane: z.enum(['funder', 'claims', 'dc', 'hotel', 'offices', 'other']).optional(), buyingStage: z.enum(['Aware', 'Understands', 'Interested', 'Respects', 'Trusts', 'Able', 'Ready']).optional() })).min(1).max(100) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ meetings }) => out(await recordMeetings(meetings), 'Meetings recorded.'));
  server.registerTool('person_set', {
    title: 'People: set a person\'s rung, lane, buying stage or note',
    description: 'Rungs set the meeting rhythm: partner and active every 2 weeks, referrer every 6 weeks, contact every 8 weeks, target = not met yet. Promote to active the first time someone puts a named job in front of us.',
    inputSchema: { id: z.string(), rung: z.enum(['target', 'contact', 'referrer', 'active', 'partner']).optional(), lane: z.enum(['funder', 'claims', 'dc', 'hotel', 'offices', 'other']).optional(), buyingStage: z.enum(['Aware', 'Understands', 'Interested', 'Respects', 'Trusts', 'Able', 'Ready']).optional(), lastNote: z.string().max(300).optional(), lastMet: date.optional(), lastEmailed: date.optional().describe('Date of the last two-way email'), nextStep: z.string().max(160).optional().describe('The agreed next step with this person'), seqStep: z.number().int().min(0).max(4).optional().describe('Outbound sequence: touches sent so far (1 after the first email; 0 stops it)'), seqStarted: date.optional().describe('Date the first outbound email was sent'), seqTrigger: z.string().max(120).optional().describe('The signal or reason the sequence started'), inHousePM: z.enum(['yes', 'no', 'unknown']).optional().describe('Offices lane: does this agent or adviser run its own PM or design team? yes = competitor, no = a possible referrer') },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ id, ...p }) => { if (!(await getOne('source', id))) throw new Error('No contact with id ' + id); return out(await setPerson(id, p), 'Person updated.'); });
  server.registerTool('people_bolster', {
    title: 'People: put everyone we already know onto the follow-up rhythm',
    description: 'Reads the whole contact list, and for anyone with no rung yet: sets Active if they are on an open pursuit, Contact if the board shows a contact in the last 12 months, and a lane read from their company, title and notes. Never overrides a rung a founder set, never touches people with no contact on record, skips role placeholders and first-name-only records. Default is a dry run that returns counts only; apply=true writes up to `limit` people per call (repeat until remaining is 0).',
    inputSchema: { apply: z.boolean().optional(), limit: z.number().int().min(1).max(400).optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ apply, limit }) => out(await bolsterPeople({ apply: !!apply, limit: limit || 150 }), apply ? 'People bolstered.' : 'Dry run.'));
  server.registerTool('todo_add', {
    title: 'Put to-dos on the board strip (replies owed, meetings to arrange, drafts waiting)',
    description: 'Batch. type: reply (someone is waiting for Barry or Graeme), meeting (a meeting to arrange; say which slots were offered), followup, event, action. title names the real person and company; why says what happened and quotes the email or note; link = the Outlook draft webLink if a draft was made; recordId = the board contact id if known; due = YYYY-MM-DD. Items with placeholder text instead of a real name are refused. Re-adding the same item only refreshes it.',
    inputSchema: { items: z.array(z.object({ type: z.enum(['reply', 'meeting', 'followup', 'event', 'action']), title: z.string().min(3).max(160), why: z.string().max(300).optional(), due: date.optional(), owner: z.enum(['Barry', 'Graeme', 'Both']).optional(), link: z.string().max(600).optional(), recordId: z.string().optional(), pursuitId: z.string().optional(), draftText: z.string().max(4000).optional().describe('The draft body, checked for placeholders; not stored'), source: z.string().max(200).optional() })).min(1).max(50) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ items }) => out(await addTodos(items), 'To-dos added.'));
  server.registerTool('todos_list', {
    title: 'Open to-dos on the board strip',
    inputSchema: { includeDone: z.boolean().optional() },
    annotations: { readOnlyHint: true },
  }, async ({ includeDone }) => out({ items: await listTodos({ includeDone }) }, 'To-dos.'));
  server.registerTool('job_ran', {
    title: 'Report that a scheduled job ran (call at the end of every scheduled run)',
    description: 'job = short stable name (e.g. morning-sync, distress-watch). ok=false with a note when something failed. expectHours = how often it should run; the board flags it if it goes quiet.',
    inputSchema: { job: z.string().min(2).max(60), name: z.string().max(80).optional(), ok: z.boolean(), note: z.string().max(300).optional(), expectHours: z.number().int().min(1).max(400).optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async (p) => out(await jobRan(p), 'Run logged.'));
  server.registerTool('people_propose', {
    title: 'Propose new people for the founders to review (calendar, email threads, events, imports)',
    description: 'Batch. Use for anyone Barry or Graeme has met or corresponded with who is not yet on the board. Each lands as a card in the People review tray; nothing is added until a founder taps Add or Merge. source = where found (e.g. "Calendar 14 Oct: AHC breakfast", "Email thread Oct 2026", "Event: Bisnow UK Office 3 Nov"); quote = one line of evidence; full names only (no placeholders); metOn = past date if they met.',
    inputSchema: { items: z.array(z.object({ name: z.string().min(3).max(120), company: z.string().max(120).optional(), email: z.string().max(160).optional(), jobTitle: z.string().max(120).optional(), source: z.string().min(3).max(120), quote: z.string().max(300).optional(), rung: z.enum(['target', 'contact', 'referrer', 'active', 'partner']).optional(), lane: z.enum(['funder', 'claims', 'dc', 'hotel', 'offices', 'other']).optional(), metOn: date.optional(), matchId: z.string().optional() })).min(1).max(100) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ items }) => out(await proposePeople(items), 'People proposed for review.'));
  server.registerTool('captures_list', {
    title: 'Post-event captures waiting (typed notes, spoken notes, photos of business cards)',
    description: 'Returns open captures oldest first, with any card photos as images. For each: propose the people with people_propose (source "Event: <title>"), draft same-day follow-ups in Barry\'s voice into Outlook Drafts and add them with todo_add (type followup, link = draft webLink), then call capture_done.',
    inputSchema: { limit: z.number().int().min(1).max(10).optional() },
    annotations: { readOnlyHint: true },
  }, async ({ limit }) => {
    const caps = await openCaptures(limit || 3);
    const content: any[] = [{ type: 'text', text: JSON.stringify(caps.map(c => ({ id: c.id, eventId: c.eventId, eventTitle: c.eventTitle, by: c.by, createdAt: c.createdAt, text: c.text, photos: c.photos || (c.images || []).length }))) }];
    let budget = 6;
    for (const c of caps) for (const img of (await captureImages(c)).slice(0, 5)) { if (budget-- <= 0) break; const m = String(img).match(/^data:(image\/[a-z]+);base64,(.+)$/); if (m) { content.push({ type: 'text', text: `Photo for ${c.id}:` }); content.push({ type: 'image', data: m[2], mimeType: m[1] }); } }
    return { content };
  });
  server.registerTool('capture_done', {
    title: 'Mark a post-event capture as processed',
    inputSchema: { id: z.string(), note: z.string().max(300) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ id, note }) => out(await captureDone(id, note), 'Capture processed.'));
  server.registerTool('people_due', {
    title: 'People due a meeting (by rung cadence), overdue first',
    inputSchema: { limit: z.number().int().min(1).max(200).optional(), all: z.boolean().optional() },
    annotations: { readOnlyHint: true },
  }, async ({ limit, all }) => out(await peopleDue({ limit: limit || 20, onlyDue: !all }), 'People due.'));
  server.registerTool('price_list', {
    title: 'Vanor price list and the first step to offer a lead',
    description: 'The fixed price list (from the pricing workbook, 16 Oct 2026) and, for a given contact id, the first-step product to offer, options A/B/C, a decision date ten working days out and the two sentences to put in the follow-up email in Barry\'s voice. Read-only. Use it when drafting any follow-up to a buyer meeting: every buyer follow-up carries a priced first step and a decision date.',
    inputSchema: { id: z.string().optional().describe('Contact id; omit for the bare list'), decisionDate: z.string().optional().describe('yyyy-mm-dd if the client has a deadline of their own') },
    annotations: { readOnlyHint: true },
  }, async ({ id, decisionDate }) => {
    const rec: any = id ? await getOne('source', id) : null; if (id && !rec) throw new Error(`No contact with id ${id}.`);
    const dd = decisionDate || decisionDateFrom();
    return out({ rules: RULES, priceList: PRICE_LIST, ...(rec ? { contact: { id, name: rec.name, company: rec.company, type: rec.type, stage: rec.stage }, firstStep: firstStep(rec), options: feeOptions(rec), decisionDate: dd, offerLines: offerLines(rec, dd) } : {}) }, 'Price list.');
  });
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

  server.registerTool('fill_contact_details', {
    title: 'Fill missing contact details',
    description: 'Save an email, phone or LinkedIn found via the RocketReach connector (or another named source) onto a contact. Only fills EMPTY fields; never overwrites what a founder entered. Always say where it came from.',
    inputSchema: {
      id: z.string(), email: z.string().email().optional(), phone: z.string().max(40).optional(), linkedin: z.string().url().optional(),
      jobTitle: z.string().max(120).optional(), region: z.string().max(60).optional().describe('Where they are based, as RocketReach or Companies House gives it (city or postcode is fine); the board normalises it to a UK region'), source: z.string().min(2).describe('e.g. "RocketReach connector"'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ id, email, phone, linkedin, jobTitle, region, source }) => {
    const filled: string[] = [];
    const C = (globalThis as any).VanorClassify; const reg = region ? (C?.normRegion(region) || region) : undefined;
    await updateEntity('source', id, r => {
      const next = { ...r };
      for (const [k, v] of Object.entries({ email, phone, linkedin, jobTitle, region: reg })) if (v && (!r[k] || (k === 'region' && /^(uk|uk-wide|unknown)$/i.test(String(r[k]))))) { next[k] = v; filled.push(k); }
      next.enrichment = { ...(r.enrichment || {}), provider: source, at: new Date().toISOString(), filled };
      return next;
    });
    if (filled.length) await logEvent({ entityId: id, recordId: id, type: 'Details added', note: `${filled.join(', ')} from ${source}` });
    return out({ filled }, filled.length ? `Filled ${filled.join(', ')}.` : 'Nothing empty to fill.');
  });

  server.registerTool('find_people', {
    title: 'Find named decision-makers at a company (the board\'s own RocketReach search)',
    description: 'Read-only. Returns up to 5 people currently at the company whose titles match, most senior first. Use the role from a signal\'s "who to call" as titles (e.g. ["Head of Asset Management","Development Director"]). Accept only a clean employer and title match; nothing is added to the board (propose people with people_propose or pursuits_save).',
    inputSchema: { company: z.string().min(2).max(120), titles: z.array(z.string().min(2).max(80)).max(8).optional(), limit: z.number().int().min(1).max(5).optional() },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ company, titles, limit }) => { const r = await searchPeople({ company, titles, limit: limit || 3 }); if (r.message) throw new Error(r.message); return out({ items: r.candidates }, 'People found.'); });
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
      region: (!r.region || /^(uk|uk-wide)$/i.test(String(r.region))) && result.location ? (normRegion(result.location) || r.region || '') : r.region,
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
