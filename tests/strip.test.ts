import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain scripts that set globals
import '../public/vanor-pursuits.js';
// @ts-ignore
import '../public/vanor-strip.js';
const PV = (globalThis as any).VanorPursuits;
const S = (globalThis as any).VanorStrip;
const T = '2026-11-02';

test('groups come out in the approved order and nothing is capped', () => {
  const pursuits = [
    { id: 'p1', name: 'Kirkstall', state: 'table', amount: 42500, decisionDate: '2026-10-30', owner: 'Barry' },
    ...Array.from({ length: 12 }, (_, i) => ({ id: 'a' + i, name: 'Act ' + i, state: 'act', dueBy: '2026-10-2' + (i % 9), owner: 'Barry' })),
  ];
  const todos = [{ id: 't1', kind: 'todo', type: 'reply', title: 'Reply to Sean', due: T }, { id: 't2', kind: 'todo', type: 'meeting', title: 'Arrange Matt', due: T }];
  const g = S.build({ pursuits, todos, today: T, PV });
  assert.deepEqual(g.map((x: any) => x.key), ['money', 'reply', 'meeting', 'action']);
  assert.equal(g[3].items.length, 12);
});
test('decision date: client date, else issue + 14 flagged assumed; lapsed proposals flagged and worth £0', () => {
  assert.deepEqual(S.decisionOf({ issuedOn: '2026-10-19' }), { date: '2026-11-02', assumed: true });
  assert.deepEqual(S.decisionOf({ decisionDate: '2026-11-05', issuedOn: '2026-10-19' }), { date: '2026-11-05', assumed: false });
  const g = S.build({ pursuits: [{ id: 'x', name: 'X', state: 'table', amount: 9000, validUntil: '2026-10-31' }], today: T, PV });
  assert.match(g[0].items[0].why, /lapsed/); assert.equal(g[0].items[0].value, 0);
});
test('won with open contract items stays on the strip until the checklist is complete', () => {
  const won = { id: 'w', name: 'Hemiko', state: 'won', archived: true, contract: { scope: true } };
  assert.equal(S.build({ pursuits: [won], today: T, PV })[0].items.length, 1);
  const all = Object.fromEntries(S.CONTRACT.map(([k]: [string]) => [k, true]));
  assert.equal(S.build({ pursuits: [{ ...won, contract: all }], today: T, PV }).length, 0);
});
test('snoozed and done items disappear; owner filter works', () => {
  const pursuits = [{ id: 'a', name: 'A', state: 'act', dueBy: '2026-10-30', owner: 'Graeme' }];
  const k = S.build({ pursuits, today: T, PV })[0].items[0].key;
  assert.equal(S.build({ pursuits, today: T, PV, state: { snoozed: { [k]: '2026-11-05' } } }).length, 0);
  assert.equal(S.build({ pursuits, today: T, PV, state: { done: { [k]: T } } }).length, 0);
  assert.equal(S.build({ pursuits, today: T, PV, owner: 'Barry' }).length, 0);
});
test('a job that has not reported shows under System', () => {
  const g = S.build({ jobs: [{ id: 'job:morning', name: 'Morning sync', expectHours: 24, lastRan: '2026-10-30T08:15:00Z', ok: true }], today: T, PV });
  assert.equal(g[0].key, 'system');
});
test('placeholder text is caught before it can become a draft', async () => {
  const { hasPlaceholder } = await import('../lib/todos-rules.ts');
  assert.equal(hasPlaceholder('Would you be happy to introduce me to Development Director or MD at LS Estates?'), true);
  assert.equal(hasPlaceholder('Hi [FIRST NAME], quick one'), true);
  assert.equal(hasPlaceholder('Hi Rowan, would you introduce me to your development director?'), false);
});
