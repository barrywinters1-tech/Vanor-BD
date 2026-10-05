import test from 'node:test';
import assert from 'node:assert/strict';
import { categoriseLead } from '../lib/lead-categorisation.ts';

test('categorises a lender monitoring lead', () => {
  const result = categoriseLead({ company: 'Real Estate Debt Fund', jobTitle: 'Head of Lending', context: 'Introduced after a meeting about fund monitoring and technical due diligence for a live project.' });
  assert.equal(result.segment, 'Lender / Debt Fund');
  assert.equal(result.service, 'Fund Monitoring & Technical Due Diligence');
  assert.notEqual(result.priority, 'Review');
});

test('flags a sparse lead for founder review', () => {
  const result = categoriseLead({ name: 'Jessica Harris' });
  assert.equal(result.segment, 'Other / Unclassified');
  assert.equal(result.service, 'To confirm');
  assert.equal(result.priority, 'Review');
  assert.equal(result.needsReview, true);
  assert.ok(result.reviewReasons.includes('Insufficient information'));
});
