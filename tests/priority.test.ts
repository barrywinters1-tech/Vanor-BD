import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/vanor-priority.js';
const P = (globalThis as any).VanorPriority;
const now = Date.parse('2026-10-06T12:00:00Z');

test('A1: right buyer, fresh lending signal, on the board', () => {
  const r = { fitScore: 2, company: 'Stanhope', companyIntel: { active: 'active', signals: [{ type: 'property', date: '2026-09-04', text: 'charge' }] } };
  const p = P.compute(r, {}, [{ stage: 'Opportunity' }], now);
  assert.equal(p.cell, 'A1'); assert.equal(p.score, 100); assert.match(p.play, /Pursue now/);
});

test('A2 splits into signal-led email (cold) and nurture (warm, no trigger)', () => {
  const cold = P.compute({ fitScore: 2, companyIntel: { signals: [{ type: 'lending', date: '2026-08-01' }] } }, {}, [], now);
  assert.equal(cold.cell, 'A2'); assert.match(cold.play, /Signal-led/);
  const warm = P.compute({ fitScore: 2, classification: 'Known contact' }, {}, [], now);
  assert.equal(warm.cell, 'A2'); assert.match(warm.play, /Nurture/);
});

test('signals fade after 90 days and vanish after a year', () => {
  const sig = (date: string) => P.compute({ fitScore: 2, companyIntel: { signals: [{ type: 'lending', date }] } }, {}, [], now).need;
  assert.equal(sig('2026-09-01'), 40);
  assert.ok(sig('2026-03-01') < 40 && sig('2026-03-01') > 0);
  assert.equal(sig('2025-06-01'), 0);
});

test('grades: introducers are B, suppliers, archived and dissolved firms are C', () => {
  assert.equal(P.compute({ fitScore: 1 }, {}, [], now).grade, 'B');
  assert.equal(P.compute({ fitScore: 0 }, {}, [], now).cell, 'C');
  assert.equal(P.compute({ fitScore: 2 }, { status: 'Archive' }, [], now).cell, 'C');
  assert.equal(P.compute({ fitScore: 2, companyIntel: { active: 'inactive', signals: [] } }, {}, [], now).cell, 'C');
});

test('tier one picks the top grade-A companies', () => {
  const rows = [
    { r: { company: 'Alpha Ltd' }, p: { grade: 'A', score: 90 } }, { r: { company: 'Beta' }, p: { grade: 'A', score: 50 } },
    { r: { company: 'Gamma' }, p: { grade: 'B', score: 99 } },
  ];
  const t1 = P.tierOne(rows, 1);
  assert.equal(t1({ company: 'ALPHA LIMITED' }), true); assert.equal(t1({ company: 'Beta' }), false); assert.equal(t1({ company: 'Gamma' }), false);
});
