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
  assert.equal(V.validate({ name: 'X', lane: 'hotel', state: 'lost' }), '');
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
  assert.equal(V.nextMeeting({ rung: 'referrer', lastMet: '2026-08-01' }, T), '2026-10-30');
  assert.equal(V.meetingStatus({ rung: 'active', lastMet: '2026-09-01' }, T).overdue, true);
  assert.equal(V.meetingStatus({ rung: 'contact', lastMet: '2026-09-01' }, T).overdue, false);
  assert.equal(V.nextMeeting({ rung: 'target' }, T), T);
  assert.equal(V.nextMeeting({ rung: 'partner' }, T), T);
});
