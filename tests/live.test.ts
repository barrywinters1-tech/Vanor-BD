// Vanor Live: stage view over pursuits, client records, timeline notes. Made-up names only.
import './_memstore.ts';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { _memReset, saveEntity, getOne } from '../lib/bd-store.ts';
import { stageOf, stateForStage, stageChange, kpis, isQuiet, lateDays, score, clientTimeline } from '../lib/live-rules.ts';
import { saveClients, addNote, addPerson } from '../lib/clients.ts';
import { savePursuits } from '../lib/pursuits.ts';

beforeEach(() => _memReset());
const T = '2026-11-23';

test('stage follows the board state, and a stored stage counts only while it fits', () => {
  assert.equal(stageOf({ id: 'a', state: 'watch' }), 'lead');
  assert.equal(stageOf({ id: 'a', state: 'act' }), 'conversation');
  assert.equal(stageOf({ id: 'a', state: 'waiting' }), 'conversation');
  assert.equal(stageOf({ id: 'a', state: 'table' }), 'proposal');
  assert.equal(stageOf({ id: 'a', state: 'table', stage: 'negotiating', stageState: 'table' }), 'negotiating');
  assert.equal(stageOf({ id: 'a', state: 'act', stage: 'negotiating', stageState: 'table' }), 'conversation', 'Claude or the old board moved it back');
  assert.equal(stageOf({ id: 'a', state: 'table', stage: 'negotiating' }), 'proposal', 'a stage without the state it was set against does not count');
});

test('a stage tap maps to a board state Claude\'s jobs understand', () => {
  assert.equal(stateForStage('lead', 'act'), 'watch');
  assert.equal(stateForStage('conversation', 'waiting'), 'waiting');
  assert.equal(stateForStage('conversation', 'watch'), 'act');
  assert.equal(stateForStage('proposal', 'act'), 'table');
  assert.deepEqual(stageChange({ id: 'a', state: 'act' }, 'negotiating'), { stage: 'negotiating', state: 'table', stageState: 'table' });
});

test('money, late and quiet', () => {
  const deals = [
    { id: 'p1', kind: 'pursuit', state: 'table', amount: 10000, dueBy: '2026-11-20', log: [{ date: '2026-11-01', text: 'sent' }] },
    { id: 'p2', kind: 'pursuit', state: 'table', stage: 'negotiating', stageState: 'table', amount: 3000, type: 'monthly', founderTouchedAt: '2026-11-22T10:00:00Z' },
    { id: 'p3', kind: 'pursuit', state: 'act', amount: 8000, createdAt: '2026-11-20T09:00:00Z' },
    { id: 'p4', kind: 'pursuit', state: 'won', amount: 99999 },
  ];
  const k = kpis(deals, T);
  assert.equal(k.proposalsOut, 10000); assert.equal(k.monthlyOnOffer, 3000);
  assert.equal(k.weighted, 5000 + 2000); assert.equal(k.overdue, 1); assert.equal(k.quiet, 1);
  assert.equal(lateDays(deals[0], T), 3);
  assert.equal(isQuiet(deals[0], T), true, '22 days on a 7-day proposal limit');
  assert.equal(isQuiet(deals[1], T), false);
  assert.equal(score(deals[1]), 0.7 * 36000);
  assert.equal(score(deals[3]), 0, 'closed deals do not score');
});

test('client timeline merges client history with notes on its deals, newest first', () => {
  const c = { id: 'client:acme', history: [{ date: '2026-10-01', kind: 'Meeting', text: 'Coffee' }] };
  const rows = clientTimeline(c, [{ id: 'pursuit:x', name: 'Acme review', clientId: 'client:acme', log: [{ date: '2026-11-02', text: 'Proposal sent' }] }, { id: 'pursuit:y', clientId: 'client:other', log: [{ date: '2026-11-05', text: 'no' }] }]);
  assert.deepEqual(rows.map(r => r.text), ['Proposal sent', 'Coffee']);
});

test('clients: create, match by name, refuse bad warmth, never touch history', async () => {
  const a = await saveClients([{ name: 'Acme Lending', type: 'Lender', warmth: 'Warm', cares: 'Speed on drawdowns' }]);
  assert.deepEqual(a.saved, ['client:acme-lending']);
  await addNote({ id: 'client:acme-lending', text: 'Met at a conference', date: '2026-11-12', kind: 'Meeting' });
  const b = await saveClients([{ name: 'acme lending', weOwe: 'Monitoring deck' }, { name: 'Bad', warmth: 'Hot' }]);
  assert.deepEqual(b.saved, ['client:acme-lending']); assert.equal(b.rejected.length, 1);
  const c = await getOne('work', 'client:acme-lending');
  assert.equal(c!.kind, 'client'); assert.equal(c!.cares, 'Speed on drawdowns'); assert.equal(c!.weOwe, 'Monitoring deck');
  assert.equal(c!.history.length, 1, 'saving a client keeps its timeline');
});

test('client id cannot take over another record', async () => {
  await saveEntity('work', { id: 'client:taken', kind: 'todo' }, 0);
  const r = await saveClients([{ id: 'client:taken', name: 'Taken' }]);
  assert.equal(r.saved.length, 0); assert.equal((await getOne('work', 'client:taken'))!.kind, 'todo');
});

test('notes: appended newest first, retries ignored, only on deals and clients', async () => {
  await saveEntity('work', { id: 'pursuit:acme', kind: 'pursuit', name: 'Acme', lane: 'funder', state: 'watch' }, 0);
  await addNote({ id: 'pursuit:acme', text: 'First call', date: '2026-11-01' });
  await addNote({ id: 'pursuit:acme', text: 'Proposal sent', date: '2026-11-10', kind: 'Proposal' });
  await addNote({ id: 'pursuit:acme', text: 'Proposal sent', date: '2026-11-10', kind: 'Proposal' });
  const p = await getOne('work', 'pursuit:acme');
  assert.deepEqual(p!.log.map((n: any) => n.text), ['Proposal sent', 'First call']);
  assert.equal(p!.state, 'watch', 'a note never moves a deal');
  await assert.rejects(addNote({ id: 'pursuit:missing', text: 'x y' }));
  await saveEntity('work', { id: 'todo:1', kind: 'todo' }, 0);
  await assert.rejects(addNote({ id: 'todo:1', text: 'x y' }));
});

test('Claude can link a deal to a client but still cannot move it', async () => {
  await saveEntity('work', { id: 'pursuit:acme', kind: 'pursuit', name: 'Acme', lane: 'funder', state: 'watch', createdBy: 'Barry' }, 0);
  const r = await savePursuits([{ id: 'pursuit:acme', clientId: 'client:acme-lending', state: 'table' } as any], 'Claude');
  assert.deepEqual(r.saved, ['pursuit:acme']);
  const p = await getOne('work', 'pursuit:acme');
  assert.equal(p!.clientId, 'client:acme-lending'); assert.equal(p!.state, 'watch');
});

test('notes: future or impossible dates are refused', async () => {
  await saveEntity('work', { id: 'pursuit:acme', kind: 'pursuit', name: 'Acme', lane: 'funder', state: 'watch' }, 0);
  await assert.rejects(addNote({ id: 'pursuit:acme', text: 'later', date: '2099-01-01' }));
  await assert.rejects(addNote({ id: 'pursuit:acme', text: 'bad', date: '2026-02-31' }));
});

test('people merge, never replace; Claude never overwrites a field a partner typed', async () => {
  await saveClients([{ name: 'Acme Lending', people: [{ name: 'Pat Example', email: 'pat@example.com' }] }]);
  await addPerson('client:acme-lending', { name: 'Kim Sample' }, 'Barry');
  await saveClients([{ name: 'Acme Lending', people: [{ name: 'Lee Demo' }, { name: 'Pat Example', role: 'Credit' }], cares: 'Claude view' }]);
  let c = await getOne('work', 'client:acme-lending');
  assert.deepEqual(c!.people.map((p: any) => p.name), ['Pat Example', 'Kim Sample', 'Lee Demo']);
  assert.equal(c!.people[0].role, 'Credit'); assert.equal(c!.cares, 'Claude view');
  await saveEntity('work', { ...c!, cares: 'Barry wrote this', partnerEdited: ['cares'] }, c!._rev!);
  await saveClients([{ name: 'Acme Lending', cares: 'Claude again', weOwe: 'Deck' }]);
  c = await getOne('work', 'client:acme-lending');
  assert.equal(c!.cares, 'Barry wrote this'); assert.equal(c!.weOwe, 'Deck');
});

test('calendar mirror: released and free holds dropped, tentative holds kept, sync replaces', async () => {
  const { syncCalendar } = await import('../lib/calendar.ts');
  const ev = (id: string, subject: string, showAs = 'busy') => ({ id, subject, start: '2026-11-24T12:30:00.0000000', showAs, attendees: [{ name: 'Pat Example', email: 'PAT@example.com' }] });
  const r = await syncCalendar('Barry', '2026-11-23', '2026-12-07', [ev('1', 'Coffee with Pat'), ev('2', 'Vanor hold released: Pat E', 'free'), ev('3', 'Vanor hold: Kim S', 'tentative'), ev('1', 'Coffee with Pat')]);
  assert.deepEqual(r, { owner: 'Barry', kept: 2, dropped: 2 });
  let c = await getOne('work', 'calendar:barry');
  assert.equal(c!.kind, 'calendar'); assert.equal(c!.events[1].hold, true); assert.equal(c!.events[0].attendees[0].email, 'pat@example.com');
  await syncCalendar('Barry', '2026-11-23', '2026-12-07', [ev('9', 'Lunch')]);
  c = await getOne('work', 'calendar:barry');
  assert.deepEqual(c!.events.map((e: any) => e.subject), ['Lunch']);
});
