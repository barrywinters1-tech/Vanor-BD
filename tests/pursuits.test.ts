import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain script that sets a global
import '../public/vanor-pursuits.js';
const V = (globalThis as any).VanorPursuits;
const T = '2026-10-30';
const full = { asset: true, problem: true, capital: true, route: true };

test('validate: only Watch may miss a gate condition', () => {
  assert.match(V.validate({ name: 'X', lane: 'funder', state: 'act', gate: { asset: true }, nextAction: 'Call' }), /Only Watch/);
  assert.equal(V.validate({ name: 'X', lane: 'funder', state: 'watch', gate: {} }), '');
  assert.equal(V.validate({ name: 'X', lane: 'funder', state: 'act', gate: full, nextAction: 'Call' }), '');
  assert.match(V.validate({ name: 'X', lane: 'funder', state: 'table', gate: full }), /next action/);
  assert.match(V.validate({ name: 'X', lane: 'nope', state: 'watch' }), /lane/);
  assert.match(V.validate({ name: '', lane: 'funder' }), /name/);
  assert.match(V.validate({ name: 'X', lane: 'hotel', state: 'lost' }), /why/);
  assert.equal(V.validate({ name: 'X', lane: 'hotel', state: 'lost', lostReason: 'Went in-house' }), '');
  assert.match(V.validate({ name: 'X', lane: 'funder', state: 'watch', amount: 'lots' }), /Amount/);
  assert.equal(V.validate({ name: 'X', lane: 'funder', state: 'watch', amount: 12000, type: 'monthly' }), '');
});

test('pounds parses fees for totals', () => {
  assert.equal(V.pounds('£42,500'), 42500);
  assert.equal(V.pounds('£62k initial then £25k/month'), 62000);
  assert.equal(V.pounds('£6,500/month'), 6500);
  assert.equal(V.pounds('relationship'), 0);
});

test('board groups open pursuits by state, overdue first, closed dropped', () => {
  const ps = [
    { kind: 'pursuit', id: 'a', name: 'A', lane: 'funder', state: 'table', atStake: '£42,500', dueBy: '2026-10-30', gate: full },
    { kind: 'pursuit', id: 'b', name: 'B', lane: 'dc', state: 'table', atStake: '£62k', dueBy: '2026-10-29', gate: full },
    { kind: 'pursuit', id: 'c', name: 'C', lane: 'funder', state: 'act', dueBy: '2026-11-05', gate: full },
    { kind: 'pursuit', id: 'd', name: 'D', lane: 'hotel', state: 'won' },
    { kind: 'work', id: 'e', name: 'old engine item', state: 'act' },
  ];
  const b = V.board(ps, { today: T });
  assert.deepEqual(b.by.table.map((p: any) => p.id), ['b', 'a']);
  assert.equal(b.total, 3);
  assert.equal(b.onTable, 104500);
  assert.equal(b.overdue, 1);
  assert.equal(b.counts.funder, 2);
  assert.equal(b.counts.hotel, 0);
  const f = V.board(ps, { today: T, lane: 'funder' });
  assert.equal(f.total, 2);
});

test('owner filter keeps unassigned and shared', () => {
  const ps = [
    { kind: 'pursuit', id: 'a', name: 'A', lane: 'funder', state: 'watch', owner: 'Graeme' },
    { kind: 'pursuit', id: 'b', name: 'B', lane: 'funder', state: 'watch', owner: 'Barry' },
    { kind: 'pursuit', id: 'c', name: 'C', lane: 'funder', state: 'watch' },
  ];
  assert.equal(V.board(ps, { today: T, owner: 'Barry' }).total, 2);
});

test('meeting cadence by rung', () => {
  assert.equal(V.nextMeeting({ rung: 'referrer', lastMet: '2026-08-01' }, T), '2026-09-12');
  assert.equal(V.meetingStatus({ rung: 'active', lastMet: '2026-09-01' }, T).overdue, true);
  assert.equal(V.meetingStatus({ rung: 'contact', lastMet: '2026-09-20' }, T).overdue, false);
  assert.equal(V.nextMeeting({ rung: 'target' }, T), T);
  assert.equal(V.nextMeeting({ rung: 'partner' }, T), T);
});

test('amount beats free text; monthly never added to one-off', () => {
  assert.equal(V.value({ amount: 12000, atStake: '£6k-£60k' }), 12000);
  assert.equal(V.value({ atStake: '£42,500' }), 42500);
  const ps = [
    { kind: 'pursuit', id: 'a', name: 'A', lane: 'funder', state: 'table', amount: 30800, gate: full, nextAction: 'x' },
    { kind: 'pursuit', id: 'b', name: 'B', lane: 'dc', state: 'table', amount: 6500, type: 'monthly', gate: full, nextAction: 'x' },
  ];
  const b = V.board(ps, { today: T });
  assert.equal(b.onTable, 30800);
  assert.equal(b.onTableMonthly, 6500);
  assert.equal(b.proposalsOut, 2);
});

test('money line: invoiced, last invoice, days since', () => {
  const ps = [
    { kind: 'pursuit', id: 'a', name: 'A', lane: 'funder', state: 'won', amount: 9000, invoicedOn: '2026-10-20' },
    { kind: 'pursuit', id: 'b', name: 'B', lane: 'dc', state: 'won', amount: 4000, type: 'monthly', invoicedOn: '2026-10-25' },
    { kind: 'pursuit', id: 'c', name: 'C', lane: 'dc', state: 'table', amount: 1000, nextAction: 'x', gate: full },
  ];
  const m = V.money(ps, T);
  assert.equal(m.invoicedOneOff, 9000);
  assert.equal(m.invoicedMonthly, 4000);
  assert.equal(m.lastInvoice, '2026-10-25');
  assert.equal(m.daysSinceInvoice, 5);
  assert.equal(m.proposalsOut, 1);
  assert.equal(V.money([], T).daysSinceInvoice, null);
});

test('proposals expire after 7 days; stale after 14', () => {
  assert.equal(V.liveProposal({ proposed: { at: '2026-10-25T08:00:00Z' } }, T), true);
  assert.equal(V.liveProposal({ proposed: { at: '2026-10-20T08:00:00Z' } }, T), false);
  assert.equal(V.liveProposal({}, T), false);
  assert.equal(V.stale({ kind: 'pursuit', state: 'act', updatedAt: '2026-10-10T00:00:00Z' }, T), true);
  assert.equal(V.stale({ kind: 'pursuit', state: 'act', updatedAt: '2026-10-25T00:00:00Z' }, T), false);
});

test('stale counts from the founder\'s last touch, not Claude\'s refresh', () => {
  const p = { kind: 'pursuit', state: 'act', updatedAt: '2026-10-29T00:00:00Z', founderTouchedAt: '2026-10-01T00:00:00Z' };
  assert.equal(V.stale(p, T), true);
  assert.equal(V.stale({ ...p, founderTouchedAt: '2026-10-28T00:00:00Z' }, T), false);
  assert.match(V.validate({ name: 'X', lane: 'funder', state: 'watch', invoicedOn: '2026-13-01' }), /real date/);
});

test('target first-contact deadline is 14 days from when it was added; due means within 7 days', () => {
  const V = (globalThis as any).VanorPursuits;
  assert.equal(V.nextMeeting({ rung: 'target', targetSince: '2026-10-31' }, '2026-10-31'), '2026-11-14');
  assert.equal(V.meetingStatus({ rung: 'contact', lastMet: '2026-09-10' }, '2026-11-04').dueSoon, true);
  assert.equal(V.meetingStatus({ rung: 'contact', lastMet: '2026-09-20' }, '2026-11-04').dueSoon, false);
});

test('lapsed proposals leave the pounds out; funder proposals stand 21 days', () => {
  const ps = [{ kind: 'pursuit', id: 'a', name: 'A', state: 'table', amount: 10000, validUntil: '2026-10-01', gate: full, nextAction: 'x' }, { kind: 'pursuit', id: 'b', name: 'B', state: 'table', amount: 5000, gate: full, nextAction: 'x' }];
  assert.equal(V.money(ps, T).proposalsValue, 5000);
  const prop = { at: '2026-10-15T09:00:00Z', nextAction: 'x' };
  assert.equal(V.liveProposal({ lane: 'funder', proposed: prop }, T), true);
  assert.equal(V.liveProposal({ lane: 'hotel', proposed: prop }, T), false);
  assert.ok(V.validate({ kind: 'pursuit', name: 'Z', state: 'watch', decisionDate: '31/10/2026' }));
});
