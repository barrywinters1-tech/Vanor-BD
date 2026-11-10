import './_memstore.ts';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { _memReset, listScope } from '../lib/bd-store.ts';
import { addTodos, listTodos, todoDone, todoReopen } from '../lib/todos.ts';

beforeEach(() => _memReset());

test('re-adding a to-do with the same title but a new recipient updates the row, no duplicate', async () => {
  const a = await addTodos([{ type: 'meeting', title: 'Kieron Quayum · Brockton Everlast', why: 'Asked to meet.' }]);
  assert.equal(a.added, 1);
  const b = await addTodos([{ type: 'meeting', title: 'Kieron Quayum · Brockton Everlast', why: 'Asked to meet. Holds placed.', toEmail: 'kq@brockton.example', link: 'https://outlook.office365.com/owa/?ItemID=abc' }]);
  assert.equal(b.added, 0, 'second add is an update');
  const open = await listTodos();
  assert.equal(open.length, 1, 'one row, not two');
  assert.equal(open[0].toEmail, 'kq@brockton.example');
  assert.match(open[0].link, /^https:/);
});

test('todo_done: sent still needs a matching Sent Item; other reasons need evidence in the note', async () => {
  await addTodos([{ type: 'meeting', title: 'John Knight · Knight Harwood', toEmail: 'jk@kh.example' }, { type: 'reply', title: 'Jon Bailey · Preproconsult' }]);
  const [a, b] = await listTodos();
  const noMatch = await todoDone({ id: b.id, sentOn: '2026-11-10', toEmail: 'someone@else.example' });
  assert.equal(noMatch.closed, false);
  const shortNote = await todoDone({ id: b.id, reason: 'superseded', note: 'replied' });
  assert.equal(shortNote.closed, false);
  assert.match(String(shortNote.why), /at least 20 characters/);
  const ok = await todoDone({ id: b.id, reason: 'superseded', note: 'Barry replied to Jon on 10 Nov (Sent Items)' });
  assert.equal(ok.closed, true);
  const held = await todoDone({ id: a.id, reason: 'meeting_held', note: 'Meeting with John Knight held 9 Nov (calendar, accepted)' });
  assert.equal(held.closed, true);
  const done = (await listTodos({ includeDone: true })).filter(t => t.status === 'done');
  assert.equal(done.length, 2);
  assert.ok(done.every(t => t.doneBy === 'Claude' && t.doneNote.length >= 20));
  assert.deepEqual(done.map(t => t.doneReason).sort(), ['meeting_held', 'superseded']);
  // Undo, then Claude cannot re-close it with a reason
  await todoReopen(b.id);
  const again = await todoDone({ id: b.id, reason: 'superseded', note: 'Barry replied to Jon on 10 Nov (Sent Items)' });
  assert.equal(again.closed, false);
  assert.match(String(again.why), /reopened/);
  // Bad reason
  await assert.rejects(todoDone({ id: a.id, reason: 'because' as any, note: 'x'.repeat(30) }), /reason must be one of/);
});
