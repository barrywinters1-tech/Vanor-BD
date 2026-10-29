import { test } from 'node:test';
// @ts-ignore plain script
import '../public/vanor-classify.js';
import assert from 'node:assert/strict';
import { addWorkingDays, followUpAfter } from '../lib/pursuit-logic.ts';
// @ts-ignore plain script that sets a global
import '../public/vanor-priority.js';
const P = (globalThis as any).VanorPriority;

test('working days skip weekends', () => {
  assert.equal(addWorkingDays('2026-10-15', 5), '2026-10-22'); // Thu + 5 wd = Thu next week
  assert.equal(addWorkingDays('2026-10-16', 1), '2026-10-19'); // Fri + 1 = Mon
  assert.equal(followUpAfter('2026-10-15', 0), '2026-10-22');
  assert.equal(followUpAfter('2026-10-15', 2), '2026-10-26');
});

const now = Date.parse('2026-10-15T12:00:00Z');
const r = { id: 'x', kind: 'lead', origin: 'manual', createdAt: '2026-10-10', name: 'A B', company: 'Co', email: 'a@co.com', segment: 'Developer', lastContact: '2026-09-01' };
const p = { grade: 'A', cell: 'A2', score: 60, live: false, warm: false, top: null, play: 'Approach' };
const q = (d: any, h: any = {}) => P.queue(r, d, [], p, h, now);

test('a lead added by hand in the last 30 days sits in the inbox; an old relationship with nothing live does not', () => {
  const x = q({});
  assert.equal(x.bucket, 'inbox');
  assert.equal(P.queue({ ...r, kind: 'relationship', origin: undefined, createdAt: '2026-01-01' }, {}, [], p, {}, now).bucket, 'later');
});
test('no = off, later = parked until the date then back to the inbox', () => {
  assert.equal(q({ pursuit: { triage: 'no', reason: 'agency' } }).bucket, 'off');
  assert.equal(q({ pursuit: { triage: 'later', laterUntil: '2026-11-14' } }).bucket, 'later');
  const back = q({ pursuit: { triage: 'later', laterUntil: '2026-10-01' } });
  assert.equal(back.bucket, 'inbox'); assert.match(back.reason, /back for a decision/);
});
test('yes = to do; sent = waiting until the clock runs out, then follow-up due; chases rank higher', () => {
  assert.equal(q({ pursuit: { triage: 'yes', step: 'to_write', stepAt: '2026-10-10T00:00:00Z' } }).bucket, 'todo');
  const w = q({ pursuit: { triage: 'yes', step: 'sent', sentAt: '2026-10-13', followUpAt: '2026-10-20' } }, { lastSent: '2026-10-13' });
  assert.equal(w.bucket, 'waiting');
  const f = q({ pursuit: { triage: 'yes', step: 'sent', sentAt: '2026-10-01', followUpAt: '2026-10-08', chases: 0 } }, { lastSent: '2026-10-01' });
  assert.equal(f.bucket, 'followup'); assert.match(f.reason, /7 days overdue/);
  const f2 = q({ pursuit: { triage: 'yes', step: 'sent', sentAt: '2026-10-01', followUpAt: '2026-10-08', chases: 2 } }, { lastSent: '2026-10-01' });
  assert.ok(f2.rank > f.rank); assert.match(f2.move, /Call, or park/);
});
test('a reply after the email beats the clock: back on the to-do list', () => {
  const x = q({ pursuit: { triage: 'yes', step: 'sent', sentAt: '2026-10-01', followUpAt: '2026-10-08' } }, { lastSent: '2026-10-01', lastBack: '2026-10-14' });
  assert.equal(x.bucket, 'todo'); assert.match(x.reason, /replied/);
});
test('ranking order across buckets: follow-ups, then to do, then inbox', () => {
  const rows = [q({}), q({ pursuit: { triage: 'yes', step: 'replied', stepAt: '2026-10-14T00:00:00Z' } }), q({ pursuit: { triage: 'yes', step: 'sent', sentAt: '2026-10-01', followUpAt: '2026-10-08' } }, { lastSent: '2026-10-01' })];
  rows.sort((a, b) => (P.BUCKET_ORDER[a.bucket] - P.BUCKET_ORDER[b.bucket]) || b.rank - a.rank);
  assert.deepEqual(rows.map(x => x.bucket), ['followup', 'todo', 'inbox']);
});

test('met in the last 30 days with no proposal since sits at the top of to do', () => {
  const x = q({}, { lastMet: '2026-10-09', lastSent: '2026-10-01' });
  assert.equal(x.bucket, 'todo'); assert.match(x.reason, /Met 6 days ago, no proposal yet/);
  assert.equal(q({}, { lastMet: '2026-10-09', lastProposal: '2026-10-12' }).bucket === 'todo' && /Met/.test(q({}, { lastMet: '2026-10-09', lastProposal: '2026-10-12' }).reason), false);
  assert.notEqual(q({}, { lastMet: '2026-08-01' }).reason.slice(0, 3), 'Met');
});

test('met split: buyer gets a proposal prompt, introducer gets an introduction prompt; a press after the meeting clears it', () => {
  const at = (company: string, dd: any = {}) => P.queue({ ...r, company, segment: '' }, dd, [], p, { lastMet: '2026-10-12' }, now);
  assert.match(at('Southern Housing').reason, /no proposal yet/);
  assert.match(at('Heyne Tillett Steel').reason, /introducer/);
  assert.match(at('Heyne Tillett Steel').move, /named introduction/);
  const acted = at('Heyne Tillett Steel', { pursuit: { triage: 'yes', step: 'sent', stepAt: '2026-10-13T09:00:00Z', sentAt: '2026-10-13', followUpAt: '2026-10-20' } });
  assert.equal(acted.bucket, 'waiting');
});

import { firstStep, options, offerLines, decisionDateFrom, PRICE_LIST } from '../lib/fees.ts';
test('fees: lenders get the monitoring report, distress gets the Stress Test, default is the Stress Test', () => {
  assert.equal(firstStep({ type: 'Funder / Investor', stage: 'on_site' }).key, 'lender_report');
  assert.equal(firstStep({ type: 'Developer / Owner', stage: 'Stalled' }).key, 'stress_test');
  assert.equal(firstStep({ type: 'Developer / Owner', stage: 'contractor_appointed' }).key, 'review');
  assert.equal(firstStep({}).key, 'stress_test');
  const o = options({ type: 'Developer / Owner', stage: 'stalled' });
  assert.ok(o.A.fee < o.B.fee); assert.equal(o.C.unit, 'month');
});
test('fees: offer lines carry a price and the decision date, and the date is a working day', () => {
  const dd = decisionDateFrom('2026-10-22', 10);
  assert.equal(dd, '2026-11-05');
  const lines = offerLines({ type: 'Developer / Owner', stage: 'stalled' }, dd);
  assert.match(lines[0], /£9,500/); assert.match(lines[1], /Thursday 5 November/);
  assert.ok(PRICE_LIST.every(p => p.fee % 100 === 0));
});

// ---- next(): the one object per contact behind the Today screen
const n = (d: any, h: any = {}) => P.next(r, d, [], p, h, now);
test('next: sent and clock running = waiting, with the date it comes back', () => {
  const x = n({ pursuit: { triage: 'yes', step: 'sent', sentAt: '2026-10-14', followUpAt: '2026-10-21', chases: 0 } });
  assert.equal(x.section, 'waiting'); assert.equal(x.due, '2026-10-21'); assert.equal(x.verb, 'Replied');
});
test('next: clock run out = chase, overdue first', () => {
  const x = n({ pursuit: { triage: 'yes', step: 'sent', sentAt: '2026-10-01', followUpAt: '2026-10-08', chases: 0 } });
  assert.equal(x.section, 'chase'); assert.match(x.sentence, /No reply from A B at Co/); assert.equal(x.step, 'sent');
});
test('next: met a buyer with no outcome pressed = decide; after 2 working days it chases', () => {
  const x = n({}, { lastMet: '2026-10-14' });
  assert.equal(x.section, 'write'); assert.match(x.sentence, /decide, opportunity, relationship or done/); assert.equal(x.step, 'outcome');
  const late = n({}, { lastMet: '2026-10-09' });
  assert.equal(late.section, 'chase');
});
test('next: opportunity = send the free look; relationship waits until the re-engage date then writes; done is off', () => {
  const op = n({ pursuit: { triage: 'yes', step: 'to_write', outcome: 'opportunity', outcomeAt: '2026-10-14T10:00:00Z', scheme: 'Brighton hotel' } }, { lastMet: '2026-10-14' });
  assert.equal(op.section, 'write'); assert.match(op.sentence, /free first look on Brighton hotel/); assert.equal(op.step, 'sent');
  const rel = n({ pursuit: { triage: 'yes', step: 'to_write', outcome: 'relationship', outcomeAt: '2026-10-14T10:00:00Z', reengageAt: '2026-12-13' } }, { lastMet: '2026-10-14' });
  assert.equal(rel.section, 'waiting'); assert.equal(rel.due, '2026-12-13');
  const back = n({ pursuit: { triage: 'yes', step: 'to_write', outcome: 'relationship', outcomeAt: '2026-08-01T10:00:00Z', reengageAt: '2026-10-01' } }, { lastMet: '2026-08-01' });
  assert.equal(back.section, 'write'); assert.match(back.sentence, /Re-engage/);
});
test('next: ledger clocks: a promised intro overdue chases; an intro made ten working days ago asks how it went', () => {
  const prom = n({ pursuit: { triage: 'yes', step: 'sent', sentAt: '2026-10-14', followUpAt: '2026-10-21' } }, { ledger: { owes: -1, open: [{ kind: 'promised', counterpart: 'Tom at Ridge', date: '2026-09-25', due: '2026-10-09', status: 'open' }] } });
  assert.equal(prom.section, 'chase'); assert.match(prom.sentence, /introduction to Tom at Ridge/);
  const made = n({ pursuit: { triage: 'yes', step: 'sent', sentAt: '2026-10-14', followUpAt: '2026-10-21' } }, { ledger: { owes: 1, open: [{ kind: 'made', counterpart: 'Sean at Hewick', date: '2026-09-25', due: '2026-10-09', status: 'open' }] } });
  assert.equal(made.section, 'write'); assert.match(made.sentence, /how it went/);
  assert.equal(P.owesLine({ ledger: { owes: 2 } }), 'owes you 2'); assert.equal(P.owesLine({ ledger: { owes: -1 } }), 'you owe 1');
});
test('next: proposal with a future decision date waits; past date chases; no date asks for one', () => {
  const base = { triage: 'yes', step: 'proposal', stepAt: '2026-10-10T10:00:00Z' };
  assert.equal(n({ pursuit: base, proposal: { price: 9500, decisionDate: '2026-10-20' } }).section, 'waiting');
  const late = n({ pursuit: base, proposal: { price: 9500, decisionDate: '2026-10-12' } });
  assert.equal(late.section, 'chase'); assert.match(late.sentence, /3 days ago/); assert.equal(late.verb, 'Won');
  const none = n({ pursuit: base });
  assert.equal(none.section, 'write'); assert.match(none.sentence, /decision date/);
});
test('next: untriaged = new; triaged no = off; parked = off', () => {
  assert.equal(n({}).section, 'new');
  assert.equal(n({ pursuit: { triage: 'no' } }).section, 'off');
  assert.equal(n({ pursuit: { triage: 'later', laterUntil: '2026-11-30' } }).section, 'off');
});

// ---- The signals bar (29 Oct 2026): three tests, ranked distress > contract let > funding closed ----
const C: any = (globalThis as any).VanorClassify; const Q: any = (globalThis as any).VanorPriority;
const NOW = Date.parse('2026-10-29T12:00:00Z');
const sig = (o: any) => ({ id: o.id || 'intel:x', origin: 'intel', company: o.company || 'Acme Developments', title: o.title || 'A scheme', context: o.context || '', createdAt: '2026-10-27', intel: { stage: o.stage, buyerType: o.buyer || 'developer', parties: o.parties ?? { developer: o.company || 'Acme Developments' }, signalDate: o.date || '2026-10-27', region: o.region || 'London' } });

test('bar: distress with an exposed client passes and ranks first', () => {
  const b = C.bar(sig({ stage: 'distress', parties: { developer: 'Grand Hotel Owner Ltd', contractor: 'Builder Ltd' } }), NOW);
  assert.equal(b.pass, true); assert.equal(b.rank, 1); assert.match(b.reason, /^Distress: /);
});
test('bar: operating-company administration with no scheme or client fails', () => {
  const b = C.bar(sig({ stage: 'distress', parties: { contractor: 'Cafe Ltd' }, buyer: 'contractor' }), NOW);
  assert.equal(b.pass, false); assert.match(b.reason, /Contractor named|no exposed client/);
});
test('bar: contract let with no PM or EA named ranks second; with one named it is rank four', () => {
  assert.equal(C.bar(sig({ stage: 'contractor_appointed', title: 'Acme appoints Bob Build for 200 homes' }), NOW).rank, 2);
  assert.equal(C.bar(sig({ stage: 'contractor_appointed', title: 'Acme appoints Bob Build; Gardiner acts as employer\'s agent' }), NOW).rank, 4);
});
test('bar: funding closed ranks third; granted ranks fourth', () => {
  assert.equal(C.bar(sig({ stage: 'funded' }), NOW).rank, 3);
  assert.equal(C.bar(sig({ stage: 'granted' }), NOW).rank, 4);
});
test('bar: job adverts, planning-only, overseas, unnamed and stale signals fail', () => {
  assert.equal(C.bar(sig({ stage: 'hiring' }), NOW).pass, false);
  assert.equal(C.bar(sig({ stage: 'submitted' }), NOW).pass, false);
  assert.equal(C.bar(sig({ stage: 'funded', region: 'International' }), NOW).pass, false);
  assert.equal(C.bar(sig({ stage: 'funded', parties: {} }), NOW).pass, false);
  assert.equal(C.bar(sig({ stage: 'funded', date: '2026-10-01' }), NOW).reason, 'Trigger older than 14 days');
});
test('bar: a record without an intel block is not judged', () => { assert.equal(C.bar({ origin: 'manual' }, NOW), null); });
test('queue/next: a passing signal is New ranked by the bar; a failing one is Off, not parked', () => {
  const ok = Q.next(sig({ stage: 'distress', parties: { developer: 'Exposed Ltd' } }), undefined, [], { score: 10 }, {}, NOW);
  assert.equal(ok.section, 'new'); assert.match(ok.sentence, /^Distress: /);
  const funded = Q.next(sig({ stage: 'funded' }), undefined, [], { score: 10 }, {}, NOW);
  assert.ok(ok.rank > funded.rank, 'distress outranks funding closed');
  const no = Q.next(sig({ stage: 'hiring' }), undefined, [], { score: 90 }, {}, NOW);
  assert.equal(no.section, 'off'); assert.match(no.sentence, /^Dropped: Job advert/);
});
test('dedupeNew: same company and stage from two sources is one signal', () => {
  const a = { r: sig({ id: 'a', company: 'Acme Ltd', stage: 'funded' }), n: { section: 'new', rank: 900 } };
  const b: any = { r: sig({ id: 'b', company: 'ACME LIMITED', stage: 'funded' }), n: { section: 'new', rank: 800 } };
  const c = { r: sig({ id: 'c', company: 'Acme Ltd', stage: 'distress' }), n: { section: 'new', rank: 1200 } };
  const keep = Q.dedupeNew([a, b, c]);
  assert.deepEqual(keep.map((x: any) => x.r.id).sort(), ['a', 'c']); assert.equal(b.n.section, 'off'); assert.equal(b.n.dup, 'a');
});
test('old contacts stay out of New leads unless a Companies House signal inside 14 days passes the bar, or they were added by hand recently', () => {
  const old = { id: 'R-1', kind: 'relationship', name: 'A', company: 'Old Co', jobTitle: 'Development Director', createdAt: '2026-03-01' };
  assert.equal(Q.next(old, undefined, [], { score: 80 }, {}, NOW).section, 'off', 'nothing live: not shown');
  const funded = { ...old, companyIntel: { signals: [{ type: 'property', date: '2026-10-25', text: 'Property charge in favour of Barclays' }] } };
  const n = Q.next(funded, undefined, [], { score: 80 }, {}, NOW); assert.equal(n.section, 'new'); assert.match(n.sentence, /^Funding closed: /);
  const stale = { ...old, companyIntel: { signals: [{ type: 'property', date: '2026-08-25', text: 'x' }] } };
  assert.equal(Q.next(stale, undefined, [], { score: 80 }, {}, NOW).section, 'off');
  const hand = { id: 'claude:1', kind: 'lead', origin: 'manual', name: 'B', company: 'New Co', jobTitle: 'MD', createdAt: '2026-10-20' };
  assert.equal(Q.next(hand, undefined, [], { score: 10 }, {}, NOW).section, 'new');
});
