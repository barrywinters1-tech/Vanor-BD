import test from 'node:test';
import assert from 'node:assert/strict';
import { stepOf, STEPS } from '../lib/funnel.ts';

test('funnel steps map from Claude outcomes and founder outcome records', () => {
  assert.equal(stepOf({ id: '1', type: 'Outcome: sent' }), 'sent');
  assert.equal(stepOf({ id: '2', type: 'Meeting arranged' }), 'meeting_booked');
  assert.equal(stepOf({ id: '3', type: 'Interaction: email in' }), 'reply');
  assert.equal(stepOf({ id: '4', type: 'Record edited' }), null);
  assert.equal(stepOf({ id: '5', type: 'Outcome: bogus' }), null);
  assert.equal(STEPS.length, 6);
});
