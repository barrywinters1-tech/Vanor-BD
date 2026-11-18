import './_memstore.ts';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { _memReset, saveEntity, getOne, updateEntity } from '../lib/bd-store.ts';
import { proposeNext, undoClaudeUpdate, DIRECT_PER_DAY } from '../lib/pursuits.ts';

const gate = { asset: true, problem: true, capital: true, route: true };
const seed = (id: string, x: any) => saveEntity('work', { id: 'pursuit:' + id, kind: 'pursuit', name: id, lane: 'other', gate, nextAction: 'old step', dueBy: '2026-11-10', latest: 'old', owner: 'Barry', ...x }, 0);
const on = () => saveEntity('work', { id: 'setting:apply-direct', kind: 'setting', on: true }, 0);
const P = (x: any = {}) => ({ nextAction: 'Chase Dovile for feedback', dueBy: '2026-11-20', latest: '17 Nov: chased', why: 'Sent Item 17 Nov', evidenceOn: new Date().toISOString().slice(0, 10), ...x });
beforeEach(() => _memReset());

test('propose mode (default): nothing applied, proposal stored', async () => {
  await seed('a', { state: 'waiting' });
  const r = await proposeNext('pursuit:a', P());
  assert.equal(r.mode, 'proposed');
  const a = await getOne('work', 'pursuit:a');
  assert.equal(a!.nextAction, 'old step'); assert.equal(a!.proposed.nextAction, 'Chase Dovile for feedback');
});

test('direct mode: narrow update applied with claudePrev; Undo restores', async () => {
  await on(); await seed('a', { state: 'watch' });
  const r = await proposeNext('pursuit:a', P({ state: 'act' }));
  assert.equal(r.mode, 'applied');
  const a = await getOne('work', 'pursuit:a');
  assert.equal(a!.nextAction, 'Chase Dovile for feedback'); assert.equal(a!.state, 'act'); assert.equal(a!.claudePrev.fields.nextAction, 'old step');
  const u = await undoClaudeUpdate('pursuit:a', 'Barry');
  assert.deepEqual(u.restored.sort(), ['dueBy', 'latest', 'nextAction', 'state']);
  const b = await getOne('work', 'pursuit:a');
  assert.equal(b!.nextAction, 'old step'); assert.equal(b!.state, 'watch'); assert.equal(b!.claudePrev, null);
});

test('Undo keeps a partner edit made after Claude\'s update', async () => {
  await on(); await seed('a', { state: 'waiting' });
  await proposeNext('pursuit:a', P());
  await updateEntity('work', 'pursuit:a', c => ({ ...c, nextAction: 'Barry: call her Friday' }));
  const u = await undoClaudeUpdate('pursuit:a', 'Barry');
  assert.ok(!u.restored.includes('nextAction'));
  assert.equal((await getOne('work', 'pursuit:a'))!.nextAction, 'Barry: call her Friday');
});

test('direct mode refuses table, closed, priced, founder-newer and forbidden moves (kept as proposal)', async () => {
  await on();
  await seed('t', { state: 'table', amount: 42500 });
  await seed('w', { state: 'won' });
  await seed('p', { state: 'waiting', issuedOn: '2026-11-01' });
  await seed('f', { state: 'waiting', founderTouchedAt: '2026-11-18T09:00:00Z' });
  await seed('m', { state: 'act' });
  for (const [id, x] of [['t', {}], ['w', {}], ['p', {}], ['f', { evidenceOn: '2026-11-17' }], ['m', { state: 'watch' }]] as const) {
    const r = await proposeNext('pursuit:' + id, P(x));
    assert.equal(r.mode, 'proposed', id);
    assert.equal((await getOne('work', 'pursuit:' + id))!.nextAction, 'old step', id);
  }
});

test('founder-only states become a Decide ask, never applied', async () => {
  await on(); await seed('a', { state: 'watch' }); await seed('t', { state: 'table', amount: 2000 });
  const r = await proposeNext('pursuit:a', P({ state: 'table' }));
  assert.equal(r.mode, 'ask');
  const a = await getOne('work', 'pursuit:a');
  assert.equal(a!.state, 'watch'); assert.equal(a!.ask.state, 'table');
  const w = await proposeNext('pursuit:t', P({ state: 'won', why: 'Invoice 1118 paid 11 Nov' }));
  assert.equal(w.mode, 'ask'); assert.equal((await getOne('work', 'pursuit:t'))!.state, 'table');
});

test('daily cap on direct updates', async () => {
  await on();
  for (let i = 0; i <= DIRECT_PER_DAY; i++) await seed('c' + i, { state: 'waiting' });
  const modes = [];
  for (let i = 0; i <= DIRECT_PER_DAY; i++) modes.push((await proposeNext('pursuit:c' + i, P())).mode);
  assert.equal(modes.filter(m => m === 'applied').length, DIRECT_PER_DAY);
  assert.equal(modes[DIRECT_PER_DAY], 'proposed');
});

test('direct mode keeps a proposal when the evidence date is missing or the move would make the record invalid', async () => {
  await on();
  await seed('noev', { state: 'waiting' });
  assert.equal((await proposeNext('pursuit:noev', P({ evidenceOn: undefined }))).mode, 'proposed');
  await seed('ungated', { state: 'watch', gate: { asset: true } });
  const r = await proposeNext('pursuit:ungated', P({ state: 'act' }));
  assert.equal(r.mode, 'proposed'); assert.equal((await getOne('work', 'pursuit:ungated'))!.state, 'watch');
});

test('two Claude updates in a row: Undo goes back to the partner\'s original', async () => {
  await on(); await seed('a', { state: 'waiting' });
  await proposeNext('pursuit:a', P());
  await proposeNext('pursuit:a', P({ nextAction: 'Second step' }));
  await undoClaudeUpdate('pursuit:a', 'Barry');
  assert.equal((await getOne('work', 'pursuit:a'))!.nextAction, 'old step');
});
