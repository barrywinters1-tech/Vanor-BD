import test from 'node:test';
import assert from 'node:assert/strict';
import { stepOf, STEPS } from '../lib/funnel-logic.ts';

test('funnel steps map from Claude outcomes and founder outcome records', () => {
  assert.equal(stepOf({ id: '1', type: 'Outcome: sent' }), 'sent');
  assert.equal(stepOf({ id: '2', type: 'Meeting arranged' }), 'meeting_booked');
  assert.equal(stepOf({ id: '3', type: 'Interaction: email in' }), 'reply');
  assert.equal(stepOf({ id: '4', type: 'Record edited' }), null);
  assert.equal(stepOf({ id: '5', type: 'Outcome: bogus' }), null);
  assert.equal(STEPS.length, 6);
});

test('notes logged via log_interaction can carry booked/proposal steps', () => {
  assert.equal(stepOf({ type: 'Interaction: note', note: 'Meeting booked: Thu 8 Oct 12:00' }), 'meeting_booked');
  assert.equal(stepOf({ type: 'Interaction: note', note: 'Proposal sent: Kirkstall Road' }), 'proposal');
  assert.equal(stepOf({ type: 'Interaction: note', note: 'General note' }), null);
});
