import './_memstore.ts';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { _memReset, saveEntity, getOne, listScope } from '../lib/bd-store.ts';
import { parkPursuit } from '../lib/pursuits.ts';

const gate = { asset: true, problem: true, capital: true, route: true };
const seed = async (id: string, extra: any) => saveEntity('work', { id: 'pursuit:' + id, kind: 'pursuit', name: id, lane: 'funder', createdBy: 'Barry', history: [{ at: '2026-10-01', by: 'Barry', change: 'created' }], ...extra }, 0);
const ok = { instructedBy: 'Barry' as const, instruction: 'park them, no named payer or route to the decision-maker', reason: 'no named payer or route' };

beforeEach(() => _memReset());

test('park: Watch and Waiting without a proposal park, keep history, log an event', async () => {
  await seed('downing', { state: 'watch', gate: { asset: true } });
  await seed('starwood', { state: 'waiting', gate, nextAction: 'nudge', dueBy: '2026-11-20', proposed: { nextAction: 'x', at: '2026-11-09T08:00:00Z' } });
  const a = await parkPursuit({ id: 'pursuit:downing', ...ok });
  assert.deepEqual(a, { id: 'pursuit:downing', parked: true, from: 'watch' });
  const b = await parkPursuit({ id: 'pursuit:starwood', ...ok });
  assert.equal(b.parked, true);
  const d = await getOne('work', 'pursuit:downing');
  assert.equal(d!.state, 'parked'); assert.equal(d!.parkedFrom, 'watch'); assert.equal(d!.parkedBy, 'Barry'); assert.equal(d!.archived, true);
  assert.equal(d!.history.length, 2, 'history kept and extended');
  assert.equal(d!.parkedInstruction, ok.instruction);
  const s = await getOne('work', 'pursuit:starwood');
  assert.equal(s!.proposed, null, 'a live Claude proposal is cleared when parked');
  const events = await listScope('event');
  assert.equal(events.filter(e => e.type === 'Pursuit parked').length, 2);
});

test('park: refuses table, act, won, lost and anything with a proposal issued', async () => {
  await seed('t', { state: 'table', gate, nextAction: 'chase', amount: 1000 });
  await seed('a', { state: 'act', gate, nextAction: 'call' });
  await seed('w', { state: 'won' });
  await seed('l', { state: 'lost', lostReason: 'price' });
  await seed('i', { state: 'watch', issuedOn: '2026-10-19' });
  for (const [id, re] of [['t', /proposal out/], ['a', /Act now/], ['w', /already won/], ['l', /already lost/], ['i', /proposal has been issued/]] as const) {
    const r = await parkPursuit({ id: 'pursuit:' + id, ...ok });
    assert.equal(r.parked, false, id);
    assert.match(String(r.why), re as RegExp);
    assert.notEqual((await getOne('work', 'pursuit:' + id))!.state, 'parked');
  }
});

test('park: needs a founder, the quoted instruction and a reason; unknown id throws', async () => {
  await seed('x', { state: 'watch' });
  await assert.rejects(parkPursuit({ id: 'pursuit:x', ...ok, instructedBy: 'Claude' as any }), /Barry or Graeme/);
  await assert.rejects(parkPursuit({ id: 'pursuit:x', ...ok, instruction: 'park' }), /quote/);
  await assert.rejects(parkPursuit({ id: 'pursuit:x', ...ok, reason: '' }), /reason/);
  await assert.rejects(parkPursuit({ id: 'pursuit:nope', ...ok }), /No pursuit/);
});
