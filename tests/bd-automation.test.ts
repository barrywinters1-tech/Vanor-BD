import test from 'node:test';
import assert from 'node:assert/strict';
import { draftFollowUp, isPotentialReply, routeLead, scoreBuyingFacts } from '../lib/bd-automation.ts';

test('scores only confirmed facts with evidence', () => {
  const result = scoreBuyingFacts({
    namedProblem: { confirmed: true, evidence: 'Kirkstall Road project recovery' },
    economicBuyer: { confirmed: true, evidence: '' },
    feeOrBudget: { confirmed: false, evidence: 'Indicative fee only' },
  });
  assert.equal(result.score, 1);
  assert.deepEqual(result.confirmed, ['namedProblem']);
});

test('routes real buying evidence to a partner and obeys stop rules', () => {
  const buyingEvidence = Object.fromEntries(
    ['namedProblem', 'economicBuyer', 'feeOrBudget', 'decisionDate'].map(key => [key, { confirmed: true, evidence: key }]),
  );
  assert.equal(routeLead({ buyingEvidence }).route, 'partner');
  assert.equal(routeLead({ buyingEvidence, chaseCount: 2 }).route, 'parked');
  assert.equal(routeLead({ positiveReply: true }).route, 'partner');
});

test('drafts do not invent a project or problem', () => {
  const draft = draftFollowUp({ company: 'Example Ltd', senderName: 'Barry' });
  assert.match(draft.body, /Example Ltd/);
  assert.doesNotMatch(draft.body, /project recovery|budget/);
  assert.equal(isPotentialReply('Please remove me from this list'), 'opt_out');
});
