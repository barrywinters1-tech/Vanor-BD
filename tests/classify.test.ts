import test from 'node:test';
import assert from 'node:assert/strict';

test('classification: region from stated, locality, postcode or text; type from segment', async () => {
  // @ts-ignore plain script that sets a global
  await import('../public/vanor-classify.js');
  const C = (globalThis as any).VanorClassify;
  assert.equal(C.regionOf({ region: 'London / UK-wide' }), 'London');
  assert.equal(C.regionOf({ region: 'UK' }), 'UK-wide');
  assert.equal(C.regionOf({ companyIntel: { locality: 'Salford' } }), 'North West');
  assert.equal(C.regionOf({ context: 'Site at Ogle Street W1W 6HU' }), 'London');
  assert.equal(C.regionOf({ title: 'Leeds: 300 student beds' }), 'Yorkshire');
  assert.equal(C.regionOf({}), 'Unknown');
  assert.equal(C.normRegion('Manchester, England, United Kingdom'), 'North West');
  assert.equal(C.typeOf({ segment: 'Investor / Private Equity' }), 'Funder / Investor');
  assert.equal(C.typeOf({ fitSector: 'PM/QS/Consultant' }), 'Consultancy');
  assert.equal(C.sectorOf({ context: 'a 220-key aparthotel' }), 'Hotel');
  assert.equal(C.stageOf({ companyIntel: { signals: [{ type: 'lending', date: '2026-09-01' }] } }), 'Funding secured');
});

test('route: funded developer = approach this week; planning submitted = watch; contractor = ignore', () => {
  const C = (globalThis as any).VanorClassify;
  const a = C.route({ company: 'Acme Homes', origin: 'intel', intel: { stage: 'funded', buyerType: 'developer', tier: 'Hot', score: 70, parties: { developer: 'Acme Homes' }, why: 'Funding in place · developer buys this' } });
  assert.equal(a.verdict, 'approach'); assert.equal(a.when, 'this week'); assert.equal(a.confidence, 'high'); assert.match(a.offer, /peer review/);
  assert.equal(C.route({ intel: { stage: 'submitted', buyerType: 'developer', tier: 'Warm', score: 50, parties: { developer: 'X' } } }).verdict, 'watch');
  assert.equal(C.route({ intel: { stage: 'funded', buyerType: 'contractor', tier: 'Hot', score: 70 } }).verdict, 'ignore');
  assert.equal(C.route({ intel: { stage: 'distress', buyerType: 'unknown', tier: 'Warm', score: 50, parties: {} } }).verdict, 'watch');
  assert.match(C.route({ intel: { stage: 'granted', buyerType: 'lender', tier: 'Hot', score: 66, parties: { funder: 'Bank' } } }).offer, /monitoring for the funder/);
  assert.equal(C.route({ name: 'x' }), null);
});
