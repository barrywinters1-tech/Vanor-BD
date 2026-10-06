import test from 'node:test';
import assert from 'node:assert/strict';
import { nameMatch, chargeSignals, directorSignals, classifyNeed, activity } from '../lib/company-intel.ts';

const now = Date.parse('2026-10-06T12:00:00Z');

test('company name matching ignores Ltd/Group noise', () => {
  assert.equal(nameMatch('Apache Capital', 'APACHE CAPITAL PARTNERS LIMITED') >= 0.6, true);
  assert.equal(nameMatch('Apache Capital', 'APACHE GROUP LTD') < 0.6, true);
});

test('recent charges become lending or property signals with the lender named', () => {
  const s = chargeSignals([
    { created_on: '2026-08-01', status: 'outstanding', persons_entitled: [{ name: 'Octopus Real Estate' }], particulars: { description: 'The freehold land known as 1 High Street' } },
    { created_on: '2026-07-01', status: 'outstanding', persons_entitled: [{ name: 'Barclays Bank PLC' }], classification: { description: 'A registered charge' } },
    { created_on: '2022-01-01', status: 'outstanding', persons_entitled: [{ name: 'Old Lender' }] },
    { created_on: '2026-09-01', status: 'fully-satisfied', persons_entitled: [{ name: 'Repaid' }] },
  ], now);
  assert.equal(s.length, 2);
  assert.equal(s[0].type, 'property'); assert.match(s[0].text, /Octopus/);
  assert.equal(s[1].type, 'lending');
});

test('new directors in the last year are signals', () => {
  const s = directorSignals([{ name: 'SMITH, Jane', officer_role: 'director', appointed_on: '2026-05-01' }, { name: 'OLD, Bob', officer_role: 'director', appointed_on: '2019-01-01' }], now);
  assert.deepEqual(s.map(x => x.text), ['New director: SMITH, Jane']);
});

test('need and activity reads', () => {
  assert.match(classifyNeed([{ type: 'property', date: '2026-08-01', text: '' }, { type: 'planning', date: '2026-09-01', text: '' }], 'active'), /delivery need likely/);
  assert.match(classifyNeed([], 'liquidation'), /not active/);
  assert.equal(activity([], 'active'), 'quiet');
  assert.equal(activity([], 'dissolved'), 'inactive');
});
