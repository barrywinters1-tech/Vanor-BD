// Made-up names only (no contact data in the repo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildToday, seeThisWeek, meetingOf, MAX_ROWS, addWorkingDays } from '../lib/today-rules.ts';

const NOW = new Date('2026-11-18T08:30:00Z');
const P = (id: string, x: any) => ({ id: 'pursuit:' + id, kind: 'pursuit', name: id, state: 'watch', owner: 'Barry', ...x });
const T = (id: string, x: any) => ({ id: 'todo:' + id, kind: 'todo', status: 'open', type: 'action', title: id, due: '2026-11-18', owner: 'Barry', ...x });

test('Today: decisions first, then money, replies, others; never more than seven; no duplicate pursuit', () => {
  const work = [
    P('big', { state: 'table', amount: 62000, dueBy: '2026-11-17', nextAction: 'Call Alex' }),
    P('small', { state: 'table', amount: 2000, dueBy: '2026-11-30' }),
    P('ask', { state: 'table', amount: 2000, ask: { state: 'won', why: 'Invoice paid 11 Nov' } }),
    T('chase-big', { type: 'followup', pursuitId: 'pursuit:big', link: 'https://outlook.office365.com/d' }),
    ...Array.from({ length: 9 }, (_, i) => T('r' + i, { type: i % 2 ? 'reply' : 'action' })),
  ];
  const d = buildToday({ work, now: NOW });
  assert.equal(d.rows.length, MAX_ROWS);
  assert.equal(d.rows[0].kind, 'decide'); assert.equal(d.rows[0].ask, 'won');
  assert.equal(d.rows[1].kind, 'money'); assert.equal(d.rows[1].title, 'big'); assert.equal(d.rows[1].link, 'https://outlook.office365.com/d');
  assert.ok(!d.rows.some(r => r.ref === 'todo:chase-big'), 'the chase is folded into the money row');
  assert.ok(!d.rows.some(r => r.ref === 'pursuit:small'), 'not yet due');
  assert.equal(d.rows[2].title, 'r1', 'replies before actions');
  // 1 ask + 1 money + 9 to-dos = 11 rows due; MAX_ROWS shown.
  assert.equal(d.more, 11 - MAX_ROWS);
  const keys = d.rows.map(r => r.ref); assert.equal(new Set(keys).size, keys.length);
});

test('Today: the other side\'s move, future dates, snoozed rows, briefs and other owners stay off', () => {
  const work = [
    P('waiting', { state: 'waiting', nextAction: 'Await reply', dueBy: '2026-11-10' }),
    P('future', { state: 'act', nextAction: 'x', dueBy: '2026-11-25' }),
    P('ours', { state: 'act', nextAction: 'Send the fee', dueBy: '2026-11-17' }),
    T('snoozed', { snoozedUntil: '2026-11-20' }),
    T('brief', { type: 'meeting', title: 'Pat Doe · Acme: brief for Wed 18 Nov 15:30' }),
    T('graeme', { owner: 'Graeme' }),
  ];
  const d = buildToday({ work, owner: 'Barry', now: NOW });
  assert.deepEqual(d.rows.map(r => r.title), ['ours']);
  assert.equal(d.meetings.length, 1); assert.equal(d.meetings[0].time, '15:30'); assert.equal(d.meetings[0].today, true);
  assert.deepEqual(buildToday({ work, owner: 'Graeme', now: NOW }).rows.map(r => r.title), ['graeme']);
});

test('Money: priced sorted by value (monthly x12), suggestions and Claude changes listed', () => {
  const work = [
    P('a', { state: 'table', amount: 42500 }), P('m', { state: 'table', amount: 6500, type: 'monthly' }),
    P('s', { state: 'waiting', nextAction: 'old', proposed: { nextAction: 'new', at: '2026-11-17T08:00:00Z', why: 'Sent Item' } }),
    P('c', { state: 'act', claudePrev: { at: '2026-11-17T08:00:00Z', set: { nextAction: 'Chase' }, fields: {}, why: 'Inbox 16 Nov' } }),
    T('closed', { status: 'done', doneBy: 'Claude', doneReason: 'expired', doneAt: '2026-11-18T06:10:00Z', doneNote: 'draft not sent after 15 days' }),
  ];
  const d = buildToday({ work, now: NOW });
  assert.deepEqual(d.priced.map(p => p.name), ['m', 'a']);
  assert.equal(d.pricedTotal, 42500); assert.equal(d.pricedMonthly, 6500);
  assert.equal(d.suggestions.length, 1);
  assert.deepEqual(d.changed.map(c => c.id).sort(), ['pursuit:c', 'todo:closed']);
});

test('meetingOf reads meetingAt in London time and old "brief for" titles', () => {
  assert.equal(meetingOf({ id: 'x', title: 'A · B: brief', meetingAt: '2026-11-24T12:30:00Z' }, '2026-11-18')!.time, '12:30');
  assert.equal(meetingOf({ id: 'x', type: 'meeting', title: 'A · B: brief for Tue 24 Nov 16:00' }, '2026-11-18')!.date, '2026-11-24');
  assert.equal(meetingOf({ id: 'x', type: 'meeting', title: 'A · B' }, '2026-11-18'), null);
});

test('seeThisWeek: five, partners/active/referrers only, longest since met, none met in the last fortnight', () => {
  const people = [
    { id: '1', rung: 'referrer', lastMet: '2026-06-01' }, { id: '2', rung: 'contact', lastMet: '2026-01-01' },
    { id: '3', rung: 'active', lastMet: '2026-11-11' }, { id: '4', rung: 'partner', lastMet: '2026-09-01' },
    ...Array.from({ length: 6 }, (_, i) => ({ id: 'r' + i, rung: 'referrer', lastMet: '2026-07-0' + (i + 1) })),
  ];
  const s = seeThisWeek(people, { now: NOW });
  assert.equal(s.length, 5); assert.equal(s[0].id, '1'); assert.ok(!s.some(x => x.id === '2' || x.id === '3'));
});

test('addWorkingDays skips weekends', () => { assert.equal(addWorkingDays('2026-11-20', 1), '2026-11-23'); });

test('fee is read from the "at stake" line when no amount is set; monthly detected', () => {
  const work = [P('v', { state: 'table', atStake: '£62,000 initial (then £25,000 a month)' }), P('a', { state: 'table', atStake: '£6,500/month monitoring' }), P('k', { state: 'table', atStake: '£42,500 (stages 1 and 2)' }), P('b', { state: 'table', amount: 11550, atStake: '£17,600 stages 1-2' })];
  const d = buildToday({ work, now: NOW });
  assert.equal(d.pricedTotal, 62000 + 42500 + 11550); assert.equal(d.pricedMonthly, 6500);
  assert.equal(d.priced[0].name, 'a');
});

test('dead to-dos never reach Today even before the tidy has run', () => {
  const work = [T('old', { type: 'followup', createdBy: 'Claude', link: 'https://outlook.office365.com/x', createdAt: '2026-11-03T08:00:00Z', due: '2026-11-03' }), T('live', { type: 'reply', createdBy: 'Claude', createdAt: '2026-11-17T08:00:00Z' })];
  assert.deepEqual(buildToday({ work, now: NOW }).rows.map(r => r.title), ['live']);
});
