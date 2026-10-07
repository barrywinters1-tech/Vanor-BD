import test from 'node:test';
import assert from 'node:assert/strict';
import { composeDraft, weekCommencing } from '../lib/outreach-logic.ts';

const base = { id: 'R1', name: 'Jane Smith', company: 'Acme Developments', email: 'jane@acme.co.uk', jobTitle: 'Development Director' };

test('week commencing is a Monday at least 8 days out', () => {
  const s = weekCommencing(new Date('2026-10-07T12:00:00Z'));
  assert.equal(s, 'w/c 19th October');
});

test('planning signal, cold contact: first approach that names the scheme and one offer', () => {
  const r = { ...base, companyIntel: { signals: [{ type: 'planning', date: '2026-10-01', text: 'Planning: 120 apartments, Kings Cross' }] } };
  const d = composeDraft({ r, warm: false, cell: 'A2', segment: 'Developer / Asset Owner' })!;
  assert.equal(d.kind, 'signal'); assert.match(d.body, /^Hi Jane,/); assert.match(d.body, /Kings Cross/); assert.match(d.body, /Graeme and I set up Vanor/); assert.match(d.body, /Kind regards,\nBarry$/);
  assert.doesNotMatch(d.body, /charge|filed|Companies House|I hope you/i);
});

test('warm contact with no trigger: catch up, signed Regards', () => {
  const d = composeDraft({ r: base, warm: true, cell: 'A2', segment: 'Lender / Debt Fund' })!;
  assert.equal(d.kind, 'nurture'); assert.match(d.body, /Due a catch up/); assert.match(d.body, /Regards,\nBarry$/); assert.doesNotMatch(d.body, /Kind regards/);
});

test('cold target with a warm colleague: intro ask goes to the colleague', () => {
  const d = composeDraft({ r: { ...base, email: '' }, warm: false, cell: 'A3', wayIn: { name: 'Tom Brown', company: 'Acme Developments', email: 'tom@acme.co.uk' }, segment: 'Developer / Asset Owner' })!;
  assert.equal(d.kind, 'intro'); assert.equal(d.to, 'tom@acme.co.uk'); assert.match(d.body, /^Hi Tom,/); assert.match(d.body, /introduce me to Jane Smith/);
});

test('recent unanswered email: a plain chase; distress: call instead; C: nothing', () => {
  assert.equal(composeDraft({ r: base, warm: true, cell: 'A1', lastSentDaysAgo: 9, segment: '' })!.kind, 'chase');
  assert.equal(composeDraft({ r: { ...base, companyIntel: { signals: [{ type: 'distress', date: '2026-10-01' }] } }, warm: false, cell: 'A1', segment: '' })!.kind, 'call');
  assert.equal(composeDraft({ r: base, warm: false, cell: 'C', segment: '' }), null);
  assert.equal(composeDraft({ r: base, warm: false, cell: 'B3', segment: '' }), null);
});
