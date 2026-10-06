import test from 'node:test';
import assert from 'node:assert/strict';
import { attention, chaseList, chaseScore, contactSummary, findDuplicate, reviewStatus, sourceHash } from '../lib/bd-logic.ts';

const at = '2026-10-05';
const rec = { id: 'r1', kind: 'relationship', name: 'Jane Smith', company: 'Acme Debt Fund', email: 'jane@acme.com', suggestedScores: { Aware: 2, Understand: 1 } };

test('Claude assessment fields do not flip a reviewed contact to Changed', () => {
  const decision = { reviewedAt: at, reviewedFingerprint: sourceHash(rec) };
  const assessed = { ...rec, suggestedScores: { Aware: 2, Trust: 2 }, suggestedEvidence: { Aware: 'Met at MIPIM' }, fitScore: 2, fitReason: 'Head of lending', assessedAt: at, enrichment: { at } };
  assert.equal(reviewStatus(assessed, decision, at), 'Reviewed');
  assert.equal(reviewStatus({ ...rec, lastContact: at }, decision, at), 'Changed');
});

test('attention matches the board rules', () => {
  assert.equal(attention({ stage: 'Opportunity', confirmed: true, owner: 'Barry', nextAsk: 'Call', nextDate: '2026-10-01' }, at)?.label, 'Next ask overdue');
  assert.equal(attention({ stage: 'Watch', watchDate: '2026-10-05' }, at)?.label, 'Watch review due');
  assert.equal(attention({ stage: 'Won' }, at), null);
});

test('founder evidence outranks suggestions and stage lifts chase score', () => {
  const low = chaseScore(rec, {});
  const founder = chaseScore(rec, { conditions: { Trust: { score: 2, note: 'Prior instruction' } } });
  assert.ok(founder.relationship > low.relationship);
  assert.ok(chaseScore(rec, {}, { stage: 'Commercial' }).score > low.score);
});

test('chase list puts overdue cards first and ranks contacts not on the board', () => {
  const records = [rec, { id: 'r2', kind: 'lead', name: 'Bob', company: 'B Ltd', fitScore: 2, suggestedScores: { Aware: 2, Interest: 2, Ready: 2 } }];
  const work = [{ id: 'w1', recordId: 'r1', stage: 'Opportunity', confirmed: true, owner: 'Barry', nextAsk: 'Send note', nextDate: '2026-09-30' }];
  const list = chaseList(records, {}, work, at);
  assert.equal(list.due[0].reason, 'Next ask overdue');
  assert.deepEqual(list.bestNotOnBoard.map(x => x.id), ['r2']);
});

test('summary exposes the constraint and live card', () => {
  const s = contactSummary(rec, null, [{ id: 'w1', recordId: 'r1', stage: 'Relationship', nextAsk: 'Coffee', nextDate: at, confirmed: true, owner: 'Graeme' }], [], at);
  assert.equal(s.board?.stage, 'Relationship');
  assert.equal(s.constraint, 'Understand');
  assert.equal(s.owner, 'Graeme');
});

test('duplicate guard matches email or name+company', () => {
  assert.equal(findDuplicate([rec], { name: 'X', company: 'Y', email: 'JANE@acme.com' })?.id, 'r1');
  assert.equal(findDuplicate([rec], { name: 'jane smith', company: 'Acme Debt Fund.' })?.id, 'r1');
  assert.equal(findDuplicate([rec], { name: 'Jane Smith', company: 'Other' }), null);
});

test('storage timestamps do not flip a reviewed contact to Changed', () => {
  const decision = { reviewedAt: at, reviewedFingerprint: sourceHash(rec) };
  assert.equal(reviewStatus({ ...rec, updatedAt: '2026-10-06T11:00:00Z', fitScore: 2 }, decision, at), 'Reviewed');
});
