import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggest, inferLane, isPlaceholder } from '../lib/people-rules.ts';

const none = { ids: new Set<string>(), emails: new Set<string>() };
const T = '2026-10-31';
const r = (o: object) => ({ id: 'a', name: 'Jo Bloggs', company: 'Acme', ...o });

test('lane is read from company, title and notes', () => {
  assert.equal(inferLane('Triple Point lender recoveries'), 'funder');
  assert.equal(inferLane('Thylander Data Centers CEO'), 'dc');
  assert.equal(inferLane('Boutique hotel operator'), 'hotel');
  assert.equal(inferLane('QS practice'), 'other');
});
test('placeholders are not people', () => {
  assert.equal(isPlaceholder('Head of Development, Homes for Wandsworth'), true);
  assert.equal(isPlaceholder('Marcus'), true);
  assert.equal(isPlaceholder('Jo Bloggs'), false);
});
test('a founder-set rung is never overridden', () => {
  assert.ok('skip' in suggest(r({ lastContact: '2026-10-01' }), { rung: 'referrer' }, none, T));
});
test('recent contact becomes Contact with last met; old or none is left alone', () => {
  const s: any = suggest(r({ lastContact: '2026-09-01' }), {}, none, T);
  assert.equal(s.rung, 'contact'); assert.equal(s.lastMet, '2026-09-01');
  assert.ok('skip' in suggest(r({ lastContact: '2024-01-01' }), {}, none, T));
  assert.ok('skip' in suggest(r({}), {}, none, T));
});
test('future last-contact dates are never recorded', () => {
  assert.ok('skip' in suggest(r({ lastContact: '2026-11-03' }), {}, none, T));
});
test('anyone on an open pursuit is Active', () => {
  const s: any = suggest(r({ email: 'Jo@Acme.com' }), {}, { ids: new Set(), emails: new Set(['jo@acme.com']) }, T);
  assert.equal(s.rung, 'active');
});
