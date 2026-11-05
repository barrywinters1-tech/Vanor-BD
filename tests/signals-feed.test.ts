import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valueFloor, cleanCompany, tidyItem, dedupeItems, laneOfSignal, lenderIn, titlesFor } from '../lib/signals-clean.ts';

test('valueFloor reads the lower bound of a band in £m', () => {
  assert.equal(valueFloor('£5m–£20m'), 5);
  assert.equal(valueFloor('£100m+'), 100);
  assert.equal(valueFloor('£1m–£5m'), 1);
  assert.equal(valueFloor('£1.2bn'), 1200);
  assert.equal(valueFloor('Value unknown'), 0);
  assert.equal(valueFloor(''), 0);
});

test('cleanCompany blanks headline fragments and the headline itself', () => {
  assert.equal(cleanCompany('Plans', 'Plans lodged for Welsh Water'), '');
  assert.equal(cleanCompany('Lambeth: Replacement of windows to the rear', 'Lambeth: Replacement of windows to the rear'), '');
  assert.equal(cleanCompany('JV North', 'JV North wins £95m'), 'JV North');
  assert.equal(cleanCompany('Christine Yorath&hellip', 'x'), '');
});

const base = { tier: 'Hot', score: 71, why: '', whyScore: 'Funding secured · nobody named', parties: {} as Record<string, string>, company: 'Great Places', headline: 'NatWest lends £50m to Great Places' };
test('no Hot without a named party; a named party keeps Hot', () => {
  assert.equal(tidyItem(base).tier, 'Warm');
  assert.equal(tidyItem(base).needsContact, true);
  assert.equal(tidyItem({ ...base, parties: { developer: 'Great Places' } }).tier, 'Warm'); // company named is not a person
  assert.equal(tidyItem({ ...base, hasPerson: true }).tier, 'Hot');
});
test('a "context only" note caps the row at Watch and 30', () => {
  const r = tidyItem({ ...base, why: 'Contractor M&A, not a Vanor buyer; context only, no outreach.', score: 54, tier: 'Warm' });
  assert.equal(r.tier, 'Watch'); assert.equal(r.score, 30);
});
test('dedupe: same id and key once; same company and stage once, newest wins', () => {
  const a = { id: 'x', key: 'distress:1', date: '2026-10-27', company: 'Property Light Homes Ltd', stage: 'distress', headline: 'h' };
  const out = dedupeItems([a, { ...a }, { ...a, id: 'y', key: 'lead', date: '2026-10-26' }]);
  assert.equal(out.length, 1); assert.equal(out[0].date, '2026-10-27');
});

test('lanes and lenders are read from the signal', () => {
  assert.equal(laneOfSignal({ headline: 'Great Places secures £50m NatWest facility for 300 homes', stage: 'funded' }), 'funder');
  assert.equal(lenderIn('Great Places secures £50m NatWest facility for 300 homes'), 'NatWest');
  assert.equal(laneOfSignal({ headline: 'Gamuda Land lets £45m Stratford student scheme to Graham', stage: 'contractor_appointed' }), 'other');
  assert.equal(laneOfSignal({ headline: 'Planning granted for 60MW data centre in Slough', stage: 'granted' }), 'dc');
  assert.equal(laneOfSignal({ headline: 'Taylor Wimpey UK Limited v Taylor Woodrow Construction', source: 'tcc_judgments' }), 'claims');
  assert.equal(laneOfSignal({ headline: 'Essendi UK Hotels 2 Limited v London Property Company', stage: 'dispute' }), 'claims');
  assert.equal(laneOfSignal({ headline: 'Chiltern Firehouse refurbishment to start', stage: 'on_site', sector: 'hotel' }), 'hotel');
  assert.equal(lenderIn('Developer starts 200 homes in Leeds'), '');
  assert.ok(titlesFor('funded', 'funder').includes('Relationship Director'));
});

test('lenderIn needs lender context and exactly one lender', () => {
  assert.equal(lenderIn('work together with partners'), '');
  assert.equal(lenderIn('Downing Street scheme funded by Acme Capital'), '');
  assert.equal(lenderIn('Elevation Group secures £50m loan from Lloyds Bank'), 'Lloyds');
  assert.equal(lenderIn('HSBC HQ refit funded by Landsec'), '');
  assert.equal(lenderIn('Developer agrees £30m NatWest facility for 200 homes'), 'NatWest');
  assert.equal(lenderIn('OakNorth-backed scheme tops out'), 'OakNorth');
  assert.equal(lenderIn('Refinanced by HSBC and by Barclays'), '', 'two lenders: no single target');
  assert.equal(lenderIn('natwest facility'), '', 'case-sensitive');
});
