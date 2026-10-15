import test from 'node:test';
import assert from 'node:assert/strict';
import { planClean } from '../lib/clean-logic.ts';

test('duplicates by email and by name+company; touched records survive; dead records found', () => {
  const recs = [
    { id: 'a', name: 'Jo Bloggs', company: 'Acme Developments Ltd', email: 'jo@acme.com' },
    { id: 'b', name: 'Jo Bloggs', company: 'Acme Developments', email: '' },
    { id: 'c', name: 'J. Bloggs', company: 'Other Co', email: 'JO@acme.com', phone: '0' },
    { id: 'd', name: '', company: '', email: '' },
    { id: 'e', name: '', company: 'Ghost Ltd', email: '' },
    { id: 'f', name: 'Sam Hill', company: 'Hill Homes', email: 's@hill.com' },
  ];
  const plan = planClean(recs, new Set(['b']), new Set());
  assert.equal(plan.duplicates.length, 1);
  assert.equal(plan.duplicates[0].keep, 'b');
  assert.deepEqual(plan.duplicates[0].archive.sort(), ['a', 'c']);
  assert.deepEqual(plan.dead.map(x => x.id), ['d', 'e']);
});
