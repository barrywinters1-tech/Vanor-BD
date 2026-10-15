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
