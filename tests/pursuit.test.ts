import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addWorkingDays, followUpAfter } from '../lib/pursuit-logic.ts';
// @ts-ignore plain script that sets a global
import '../public/vanor-priority.js';
const P = (globalThis as any).VanorPriority;

test('working days skip weekends', () => {
  assert.equal(addWorkingDays('2026-10-15', 5), '2026-10-22'); // Thu + 5 wd = Thu next week
  assert.equal(addWorkingDays('2026-10-16', 1), '2026-10-19'); // Fri + 1 = Mon
  assert.equal(followUpAfter('2026-10-15', 0), '2026-10-22');
  assert.equal(followUpAfter('2026-10-15', 2), '2026-10-26');
});

const now = Date.parse('2026-10-15T12:00:00Z');
const r = { id: 'x', name: 'A B', company: 'Co', email: 'a@co.com', segment: 'Developer', lastContact: '2026-09-01' };
const p = { grade: 'A', cell: 'A2', score: 60, live: false, warm: false, top: null, play: 'Approach' };
const q = (d: any, h: any = {}) => P.queue(r, d, [], p, h, now);

test('untriaged grade-A with email sits in the inbox', () => {
  const x = q({});
  assert.equal(x.bucket, 'inbox'); assert.equal(x.lane, 'Next');
});
test('no = off, later = parked until the date then back to the inbox', () => {
  assert.equal(q({ pursuit: { triage: 'no', reason: 'agency' } }).bucket, 'off');
  assert.equal(q({ pursuit: { triage: 'later', laterUntil: '2026-11-14' } }).bucket, 'later');
  const back = q({ pursuit: { triage: 'later', laterUntil: '2026-10-01' } });
  assert.equal(back.bucket, 'inbox'); assert.match(back.reason, /back for a decision/);
});
test('yes = to do; sent = waiting until the clock runs out, then follow-up due; chases rank higher', () => {
  assert.equal(q({ pursuit: { triage: 'yes', step: 'to_write', stepAt: '2026-10-10T00:00:00Z' } }).bucket, 'todo');
  const w = q({ pursuit: { triage: 'yes', step: 'sent', sentAt: '2026-10-13', followUpAt: '2026-10-20' } }, { lastSent: '2026-10-13' });
  assert.equal(w.bucket, 'waiting');
  const f = q({ pursuit: { triage: 'yes', step: 'sent', sentAt: '2026-10-01', followUpAt: '2026-10-08', chases: 0 } }, { lastSent: '2026-10-01' });
  assert.equal(f.bucket, 'followup'); assert.match(f.reason, /7 days overdue/);
  const f2 = q({ pursuit: { triage: 'yes', step: 'sent', sentAt: '2026-10-01', followUpAt: '2026-10-08', chases: 2 } }, { lastSent: '2026-10-01' });
  assert.ok(f2.rank > f.rank); assert.match(f2.move, /Call, or park/);
});
test('a reply after the email beats the clock: back on the to-do list', () => {
  const x = q({ pursuit: { triage: 'yes', step: 'sent', sentAt: '2026-10-01', followUpAt: '2026-10-08' } }, { lastSent: '2026-10-01', lastBack: '2026-10-14' });
  assert.equal(x.bucket, 'todo'); assert.match(x.reason, /replied/);
});
test('ranking order across buckets: follow-ups, then to do, then inbox', () => {
  const rows = [q({}), q({ pursuit: { triage: 'yes', step: 'replied', stepAt: '2026-10-14T00:00:00Z' } }), q({ pursuit: { triage: 'yes', step: 'sent', sentAt: '2026-10-01', followUpAt: '2026-10-08' } }, { lastSent: '2026-10-01' })];
  rows.sort((a, b) => (P.BUCKET_ORDER[a.bucket] - P.BUCKET_ORDER[b.bucket]) || b.rank - a.rank);
  assert.deepEqual(rows.map(x => x.bucket), ['followup', 'todo', 'inbox']);
});

test('met in the last 30 days with no proposal since sits at the top of to do', () => {
  const x = q({}, { lastMet: '2026-10-09', lastSent: '2026-10-01' });
  assert.equal(x.bucket, 'todo'); assert.match(x.reason, /Met 6 days ago, no proposal yet/);
  assert.equal(q({}, { lastMet: '2026-10-09', lastProposal: '2026-10-12' }).bucket === 'todo' && /Met/.test(q({}, { lastMet: '2026-10-09', lastProposal: '2026-10-12' }).reason), false);
  assert.notEqual(q({}, { lastMet: '2026-08-01' }).reason.slice(0, 3), 'Met');
});
