import './_memstore.ts';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { _memReset, saveEntity, getOne } from '../lib/bd-store.ts';
import { expiryReason, expireTodos, datesIn, addTodos, listTodos } from '../lib/todos.ts';

const NOW = '2026-11-18T08:00:00.000Z';
const T = (id: string, x: any) => ({ id: 'todo:' + id, kind: 'todo', status: 'open', type: 'action', title: 'x', createdBy: 'Claude', createdAt: '2026-11-17T08:00:00Z', ...x });
beforeEach(() => _memReset());

test('datesIn reads "18 Nov" and "Wednesday 25 November" in the nearest year', () => {
  assert.deepEqual(datesIn('Offered Mon 23 Nov 10:00, Wednesday 25 November at 09:30', '2026-11-18'), ['2026-11-23', '2026-11-25']);
  assert.deepEqual(datesIn('brief for Tue 6 Jan', '2026-12-30'), ['2027-01-06']);
});

test('expiryReason: past meetings, passed slots, old drafts and stale questions expire; live ones do not', () => {
  assert.match(expiryReason(T('a', { type: 'meeting', meetingAt: '2026-11-17T09:00:00Z' }), NOW), /has passed/);
  assert.equal(expiryReason(T('b', { type: 'meeting', meetingAt: '2026-11-18T15:30:00Z' }), NOW), '');
  assert.match(expiryReason(T('c', { type: 'meeting', title: 'Kieron Quayum · Brockton: brief for Tue 17 Nov 09:00' }), NOW), /17 has passed|2026-11-17 has passed/);
  assert.equal(expiryReason(T('d', { type: 'meeting', title: 'Peter Ashdown: brief for Wed 18 Nov 18:00' }), NOW), '');
  assert.match(expiryReason(T('e', { type: 'meeting', why: 'Asked to meet. Offered Thursday 5 November, Friday 6 November. Holds placed.' }), NOW), /every offered slot/);
  assert.equal(expiryReason(T('f', { type: 'meeting', why: 'Offered Mon 23 Nov 10:00, Wed 25 Nov 09:30' }), NOW), '');
  assert.match(expiryReason(T('g', { type: 'followup', link: 'https://outlook.office365.com/x', createdAt: '2026-11-03T08:00:00Z' }), NOW), /draft not sent after 15 days/);
  assert.equal(expiryReason(T('h', { type: 'followup', link: 'https://outlook.office365.com/x', createdAt: '2026-11-12T08:00:00Z' }), NOW), '');
  assert.match(expiryReason(T('i', { title: 'John Knight · Knight Harwood: tell me what you promised', createdAt: '2026-11-10T08:00:00Z' }), NOW), /unanswered/);
  assert.equal(expiryReason(T('j', { type: 'reply', title: 'Sam Faux · TudorMay', createdAt: '2026-11-01T08:00:00Z' }), NOW), '', 'a reply owed with no draft is never expired');
});

test('expiryReason never touches reopened, event, founder-made or closed rows', () => {
  const old = { link: 'https://outlook.office365.com/x', createdAt: '2026-10-01T08:00:00Z' };
  assert.equal(expiryReason(T('k', { ...old, reopenedAt: '2026-11-10T00:00:00Z' }), NOW), '');
  assert.equal(expiryReason(T('l', { ...old, type: 'event' }), NOW), '');
  assert.equal(expiryReason(T('m', { ...old, createdBy: 'Barry' }), NOW), '');
  assert.equal(expiryReason(T('n', { ...old, status: 'done' }), NOW), '');
});

test('expireTodos closes with reason expired and the rule; dry run writes nothing; limit holds', async () => {
  for (let i = 0; i < 5; i++) await saveEntity('work', T('old' + i, { link: 'https://outlook.office365.com/x', createdAt: '2026-10-20T08:00:00Z' }), 0);
  await saveEntity('work', T('live', { type: 'reply', title: 'Sam Faux · TudorMay' }), 0);
  const dry = await expireTodos({ apply: false, now: NOW });
  assert.equal(dry.closed, 5); assert.equal((await getOne('work', 'todo:old0'))!.status, 'open');
  const r = await expireTodos({ apply: true, limit: 3, now: NOW });
  assert.equal(r.closed, 3);
  const c = await getOne('work', 'todo:old0');
  assert.equal(c!.status, 'done'); assert.equal(c!.doneBy, 'Claude'); assert.equal(c!.doneReason, 'expired'); assert.match(String(c!.doneNote), /draft not sent/);
  assert.equal((await getOne('work', 'todo:live'))!.status, 'open');
});

test('todo_add stores meetingAt and refuses a bad one', async () => {
  const r = await addTodos([{ type: 'meeting', title: 'A B · C: brief for Wed 25 Nov 12:30', meetingAt: '2026-11-25T12:30:00Z' }, { type: 'meeting', title: 'X', meetingAt: 'soon' }]);
  assert.equal(r.added, 1); assert.match(r.skipped[0].why, /meetingAt/);
  assert.equal((await listTodos())[0].meetingAt, '2026-11-25T12:30:00.000Z');
});

test('a chase tied to a priced pursuit never expires', async () => {
  await saveEntity('work', { id: 'pursuit:k', kind: 'pursuit', name: 'k', state: 'table', amount: 42500 }, 0);
  await saveEntity('work', T('chase', { type: 'followup', pursuitId: 'pursuit:k', link: 'https://outlook.office365.com/x', createdAt: '2026-10-01T08:00:00Z' }), 0);
  const r = await expireTodos({ apply: true, now: NOW });
  assert.equal(r.closed, 0); assert.equal((await getOne('work', 'todo:chase'))!.status, 'open');
});
