// Relationship CRM rules (18 Nov 2026). Made-up names only (no contact data in the repo).
import './_memstore.ts';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { _memReset, saveEntity, getOne } from '../lib/bd-store.ts';
import { setRelationship, giveGet } from '../lib/pursuits.ts';
import { suggestTrade, isPlaceholder } from '../lib/trades.ts';
import { buildToday, MAX_ROWS } from '../lib/today-rules.ts';
import '../public/vanor-pursuits.js';
const V = (globalThis as any).VanorPursuits;
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
beforeEach(() => _memReset());

test('stage and rung map both ways; Known never gets a rung; work wins', () => {
  assert.equal(V.stageOf({}), 'known');
  assert.equal(V.stageOf({ lastMet: '2026-10-01' }), 'met');
  assert.equal(V.stageOf({ stage: 'warm' }, { proposal: true }), 'proposal');
  assert.equal(V.stageOf({ stage: 'met' }, { instructed: true }), 'instructed');
  assert.equal(V.rungFor('known', false, ''), '');
  assert.ok(V.rungFor('warm', false, ''));
  assert.equal(V.stageFromRung('target'), 'known');
});

test('setRelationship: Claude moves forward only; partner can move back; partner-newer next move kept', async () => {
  await saveEntity('decision', { id: 'R-1', stage: 'warm', lastContact: daysAgo(10) }, 0);
  const r = await setRelationship('R-1', { stage: 'met', evidenceOn: today });
  assert.equal((await getOne('decision', 'R-1'))!.stage, 'warm', 'Claude cannot move back inside six months');
  assert.ok(JSON.stringify(r).includes('forward'));
  await setRelationship('R-1', { stage: 'met' }, 'Barry');
  assert.equal((await getOne('decision', 'R-1'))!.stage, 'met');
  await setRelationship('R-1', { nextMove: { type: 'send', text: 'Send the scope', due: today, owes: 'us', owner: 'Barry' } } as any, 'Barry');
  await setRelationship('R-1', { nextMove: { type: 'follow', text: 'Claude idea', due: today }, evidenceOn: daysAgo(3) } as any);
  assert.equal((await getOne('decision', 'R-1'))!.nextMove.text, 'Send the scope');
  await assert.rejects(setRelationship('R-1', { stage: 'instructed' } as any), /Stage must be/);
  await assert.rejects(setRelationship('R-1', { nextMove: { type: 'meet', text: 'x', due: today } } as any), /line of text/);
});

test('Warm drops to Met after six months of silence (Claude allowed)', async () => {
  await saveEntity('decision', { id: 'R-2', stage: 'warm', lastContact: daysAgo(200) }, 0);
  await setRelationship('R-2', { stage: 'met', evidenceOn: today });
  assert.equal((await getOne('decision', 'R-2'))!.stage, 'met');
});

test('giveGet counts both ways; a received referral makes them an introducer', async () => {
  await saveEntity('decision', { id: 'R-3', stage: 'met' }, 0);
  await giveGet('R-3', { dir: 'gave', kind: 'introduction', note: 'Introduced to a lender' }, 'Barry');
  await giveGet('R-3', { dir: 'received', kind: 'referral', note: 'Passed us a hotel job' }, 'Barry');
  const d = await getOne('decision', 'R-3');
  assert.equal(d!.givenN, 1); assert.equal(d!.receivedN, 1); assert.ok(d!.lastReceivedAt);
  assert.ok(V.introducerOf(d));
  assert.equal(d!.ledger.length, 2);
});

test('trades: suggestion from title or firm, nothing for recruiters; placeholders spotted', () => {
  assert.equal(suggestTrade('Acme Consulting Engineers', 'Senior Structural Engineer'), 'structural engineer');
  assert.equal(suggestTrade('Acme Architects', 'Partner'), 'architect');
  assert.equal(suggestTrade('Acme Recruitment', 'Senior Consultant, Structural Engineering'), '');
  assert.ok(isPlaceholder({ id: 'intel:1', name: 'Head of Development' }));
  assert.ok(isPlaceholder({ id: 'R-9', name: '' }));
  assert.ok(!isPlaceholder({ id: 'R-9', name: 'Pat Doe', jobTitle: 'Director' }));
});

const NOW = new Date('2026-11-18T08:30:00Z');
const person = (id: string, x: any) => ({ id, name: id, company: 'Acme', stage: 'met', lastContact: '2026-11-01', ...x });
test('Today: we-owe moves, then chases after 3 working days, thank-yous, and at most 5 catch-ups', () => {
  const people = [
    person('owe', { nextMove: { type: 'send', text: 'Send scope', due: '2026-11-17', owes: 'us', owner: 'Barry' } }),
    person('notyet', { nextMove: { type: 'send', text: 'Later', due: '2026-11-25', owes: 'us' } }),
    person('chase', { nextMove: { type: 'chase', text: 'PO', due: '2026-11-12', owes: 'them' } }),
    person('chase-early', { nextMove: { type: 'chase', text: 'PO', due: '2026-11-16', owes: 'them' } }),
    person('thank', { lastReceivedAt: '2026-11-15T10:00:00Z' }),
    ...Array.from({ length: 8 }, (_, i) => person('old' + i, { lastContact: '2026-0' + (i + 1) + '-01' })),
    person('known', { stage: 'known', lastContact: '2025-01-01' }),
  ];
  const d = buildToday({ work: [], people, now: NOW });
  assert.deepEqual(d.rows.map(r => r.kind), ['move', 'chase', 'thank', 'catchup', 'catchup'].slice(0, MAX_ROWS));
  assert.equal(d.rows[0].ref, 'owe');
  const all = [...d.rows, ...d.overflow];
  assert.ok(!all.some(r => r.ref === 'notyet' || r.ref === 'chase-early' || r.ref === 'known'));
  assert.equal(all.filter(r => r.kind === 'catchup').length, 5);
  assert.equal(all.filter(r => r.kind === 'catchup')[0].ref, 'old7', 'most recent first');
});

test('Today: a person already on a money row or a to-do is not listed twice; snoozed people stay off', () => {
  const work = [{ id: 'todo:x', kind: 'todo', status: 'open', type: 'reply', title: 'Reply to owe', due: '2026-11-18', recordId: 'owe', createdAt: '2026-11-17T08:00:00Z' }];
  const people = [person('owe', { nextMove: { type: 'send', text: 'Send scope', due: '2026-11-17', owes: 'us' } }), person('snz', { snoozedUntil: '2026-11-20', nextMove: { type: 'send', text: 'x y z', due: '2026-11-10', owes: 'us' } })];
  const d = buildToday({ work, people, now: NOW });
  assert.deepEqual(d.rows.map(r => r.ref), ['todo:x']);
});

test('last contact is the latest of the three dates; a same-day partner move beats Claude', async () => {
  assert.equal(V.lastContactOf({ lastContact: '2026-05-01', lastMet: '2026-11-10', lastEmailed: '2026-09-01' }), '2026-11-10');
  await saveEntity('decision', { id: 'R-4', stage: 'warm', lastContact: daysAgo(300), lastMet: daysAgo(5) }, 0);
  await setRelationship('R-4', { stage: 'met', evidenceOn: today });
  assert.equal((await getOne('decision', 'R-4'))!.stage, 'warm', 'met last week: not silent');
  await setRelationship('R-4', { nextMove: { type: 'send', text: 'Partner promise', due: today } } as any, 'Graeme');
  await setRelationship('R-4', { nextMove: { type: 'follow', text: 'Claude same day', due: today }, evidenceOn: today } as any);
  assert.equal((await getOne('decision', 'R-4'))!.nextMove.text, 'Partner promise');
});
