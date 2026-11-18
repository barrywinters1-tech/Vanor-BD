'use client';
// Vanor BD, the refreshed screens (18 Nov 2026): Today, Money, People, Events, and "+ Note" everywhere.
// Plan: four goldfish reviews -> plan v2 (Musk's five steps). Only things we owe on Today, at most seven rows.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildToday, seeThisWeek, addWorkingDays, addDays, londonDate, daysBetween, type Item, type Owner, type Row } from '../../lib/today-rules';

export type Api = {
  load(): Promise<{ work: Item[]; events: Item[]; people: Item[]; contacts: number }>;
  user(): Promise<{ actor: string; role: string }>;
  patch(scope: string, id: string, fields: Record<string, unknown>, note?: string): Promise<Item>;
  create(entity: Item, note: string): Promise<Item>;
  undoClaude(id: string): Promise<unknown>;
  search(q: string): Promise<Item[]>;
  opened(): Promise<unknown>;
};

async function call(path: string, init?: RequestInit) {
  const r = await fetch('/api/workspace' + path, { ...init, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' });
  const body = await r.json().catch(() => ({ error: 'The board did not answer. Try again.' }));
  if (!r.ok) throw new Error(body.error || 'That did not save. Try again.');
  return body;
}
export const liveApi: Api = {
  load: () => call('/today'),
  user: () => call('/user'),
  patch: (scope, id, fields, note) => call('/patch', { method: 'POST', body: JSON.stringify({ scope, id, fields, note }) }),
  create: (entity, note) => call('/entity', { method: 'POST', body: JSON.stringify({ scope: 'work', entity, expectedRev: 0, event: { type: note, recordId: '', note: String(entity.text || '').slice(0, 80) } }) }),
  undoClaude: id => call('/undo-claude', { method: 'POST', body: JSON.stringify({ id }) }),
  search: q => call('/people?q=' + encodeURIComponent(q)).then(r => r.items),
  opened: () => call('/opened', { method: 'POST', body: '{}' }),
};

const gbp = (n: number) => '£' + Math.round(n).toLocaleString('en-GB');
const fee = (n: number, monthly?: boolean) => n ? gbp(n) + (monthly ? '/month' : '') : '';
const nice = (iso: string) => { if (!iso) return ''; const d = new Date(iso.slice(0, 10) + 'T12:00:00Z'); return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); };
const short = (iso: string) => iso ? new Date(iso.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
const ASK: Record<string, string> = { table: 'Priced: a proposal is out', won: 'Won', lost: 'Lost', parked: 'Park it' };
type Tab = 'today' | 'money' | 'people' | 'events';
type Sheet = { kind: 'pursuit'; id: string } | { kind: 'todo'; id: string } | { kind: 'person'; person: Item } | { kind: 'note'; about?: { label: string; pursuitId?: string; recordId?: string; eventId?: string; eventTitle?: string } } | { kind: 'step'; id: string; chased: boolean } | { kind: 'lost'; id: string; fromAsk?: boolean } | { kind: 'priced'; id: string } | { kind: 'list'; title: string; rows: Row[] } | null;

export default function TodayApp({ api = liveApi, initialTab = 'today' as Tab }: { api?: Api; initialTab?: Tab }) {
  const [data, setData] = useState<{ work: Item[]; events: Item[]; people: Item[]; contacts: number } | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>(initialTab);
  const [owner, setOwner] = useState<Owner>('Both');
  const [actor, setActor] = useState('');
  const [sheet, setSheet] = useState<Sheet>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => Promise<void> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [moneyOpen, setMoneyOpen] = useState<Record<string, boolean>>({});
  const loadedAt = useRef(0);

  const reload = useCallback(async () => { try { const d = await api.load(); setData(d); loadedAt.current = Date.now(); setError(''); } catch (e: any) { setError(e.message || String(e)); } }, [api]);
  useEffect(() => {
    reload();
    api.user().then(u => { setActor(u.actor); let saved = ''; try { saved = localStorage.getItem('vanor.owner') || ''; } catch {} setOwner((saved || (['Barry', 'Graeme'].includes(u.actor) ? u.actor : 'Both')) as Owner); }).catch(() => {});
    api.opened().catch(() => {});
    const onFocus = () => { if (document.visibilityState === 'visible' && Date.now() - loadedAt.current > 60000) reload(); };
    document.addEventListener('visibilitychange', onFocus); window.addEventListener('focus', onFocus);
    return () => { document.removeEventListener('visibilitychange', onFocus); window.removeEventListener('focus', onFocus); };
  }, [api, reload]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), toast.undo ? 7000 : 3500); return () => clearTimeout(t); }, [toast]);
  const pickOwner = (o: Owner) => { setOwner(o); try { localStorage.setItem('vanor.owner', o); } catch {} };

  const now = new Date();
  const today = londonDate(now);
  const view = useMemo(() => data ? buildToday({ work: data.work, events: data.events, owner, now }) : null, [data, owner]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = (id: string) => data?.work.find(w => w.id === id);

  async function act(run: () => Promise<unknown>, text: string, undo?: () => Promise<void>) {
    if (busy) return; setBusy(true);
    try { await run(); await reload(); setToast({ text, undo: undo ? async () => { await undo(); await reload(); setToast({ text: 'Put back.' }); } : undefined }); setSheet(null); }
    catch (e: any) { setToast({ text: e.message || String(e) }); }
    finally { setBusy(false); }
  }
  const tomorrow = addDays(today, 1);
  const todoDone = (id: string) => { const t = byId(id); return act(() => api.patch('work', id, { status: 'done', doneAt: new Date().toISOString(), doneBy: actor || 'Barry' }, 'Done'), 'Done.', async () => { await api.patch('work', id, { status: 'open', doneAt: '', doneBy: '', reopenedAt: new Date().toISOString() }, 'Reopened'); void t; }); };
  const notToday = (scope: string, id: string) => act(() => api.patch(scope, id, { snoozedUntil: tomorrow }, 'Not today'), 'Back tomorrow.', async () => { await api.patch(scope, id, { snoozedUntil: '' }, 'Back on'); });
  function decide(p: Item, yes: boolean) {
    if (!yes) return act(() => api.patch('work', p.id, { ask: null }, `No to Claude's question (${p.ask?.state})`), 'Noted. Claude will not ask again.');
    const s = p.ask.state; const prev = { state: p.state || 'watch', ask: p.ask };
    if (s === 'lost') return setSheet({ kind: 'lost', id: p.id, fromAsk: true });
    if (s === 'table') return setSheet({ kind: 'priced', id: p.id });
    const fields: Record<string, unknown> = { state: s, ask: null };
    if (s === 'won') Object.assign(fields, { outcome: 'Won', wonOn: today });
    if (s === 'parked') Object.assign(fields, { parkedAt: new Date().toISOString(), parkedBy: actor, parkedFrom: p.state || 'watch', parkedReason: p.ask.why || '' });
    return act(() => api.patch('work', p.id, fields, `Decided: ${ASK[s]}`), `${p.name}: ${ASK[s].toLowerCase()}.`, async () => { await api.patch('work', p.id, { ...prev, ...(s === 'won' ? { outcome: '', wonOn: '' } : {}) }, 'Undid decision'); });
  }

  if (error && !data) return <div className="vt"><div className="vt-empty"><h1>The board did not open</h1><p>{error}</p><button className="vt-btn primary" onClick={reload}>Try again</button></div></div>;
  if (!data || !view) return <div className="vt"><div className="vt-empty"><p>Opening…</p></div></div>;
  if (!data.contacts) return <div className="vt"><div className="vt-empty"><h1>The workspace is empty</h1><p>Load the data on the old board first.</p><a className="vt-btn primary" href="/board">Open the old board</a></div></div>;

  const meetingsToday = view.meetings.filter(m => m.today);
  const header = <header className="vt-head">
    <div className="vt-brand">VANOR</div>
    <div className="vt-owner" role="group" aria-label="Whose list">{(['Barry', 'Graeme', 'Both'] as Owner[]).map(o => <button key={o} className={owner === o ? 'on' : ''} onClick={() => pickOwner(o)}>{o}</button>)}</div>
  </header>;

  const rowView = (r: Row) => {
    const p = r.kind !== 'todo' ? byId(r.ref) : null;
    return <li key={r.key} className={`vt-row ${r.kind}`}>
      <button className="vt-row-main" onClick={() => setSheet(r.kind === 'todo' ? { kind: 'todo', id: r.ref } : { kind: 'pursuit', id: r.ref })}>
        <span className="vt-row-title"><span>{r.kind === 'decide' ? <span className="vt-tag">Decide</span> : null}{r.title}</span>{r.money ? <span className="vt-fee">{fee(r.money, r.monthly)}</span> : null}</span>
        <span className="vt-row-why">{r.kind === 'decide' ? <><b>{ASK[r.ask || ''] || r.ask}?</b> {r.why}</> : r.why}{r.late ? <span className="vt-late"> · decision date passed</span> : null}</span>
      </button>
      <div className="vt-row-acts">
        {r.kind === 'decide' && p ? <><button className="vt-btn primary" onClick={() => decide(p, true)}>Yes</button><button className="vt-btn" onClick={() => decide(p, false)}>No</button></> : <>
          {r.link ? <a className="vt-btn primary" href={r.link} target="_blank" rel="noopener">Open draft</a> : null}
          {r.kind === 'todo' ? <button className="vt-btn" onClick={() => todoDone(r.ref)}>Done</button> : <button className="vt-btn" onClick={() => setSheet({ kind: 'step', id: r.ref, chased: r.kind === 'money' })}>{r.kind === 'money' ? 'Chased' : 'Done'}</button>}
          <button className="vt-btn quiet" onClick={() => notToday('work', r.ref)}>Not today</button>
        </>}
      </div>
    </li>;
  };

  const todayTab = <section>
    <p className="vt-summary"><b>{fee(view.pricedTotal) || '£0'}</b>{view.pricedMonthly ? <> + <b>{fee(view.pricedMonthly, true)}</b></> : null} priced · {view.priced.length} proposal{view.priced.length === 1 ? '' : 's'} out · {view.meetings.length} meeting{view.meetings.length === 1 ? '' : 's'} this week</p>
    <h2 className="vt-h">Today <span>{nice(today)}</span></h2>
    {view.rows.length ? <ul className="vt-rows">{view.rows.map(rowView)}</ul> : <p className="vt-clear">Nothing owed today. A quiet morning is the goal.</p>}
    {view.more > 0 ? <button className="vt-link" onClick={() => setSheet({ kind: 'list', title: 'Also due', rows: view.overflow })}>and {view.more} more</button> : null}
    {meetingsToday.length ? <><h2 className="vt-h">Meetings today</h2><ul className="vt-list">{meetingsToday.map(m => <li key={m.id} className="vt-meet"><span className="vt-time">{m.time || '—'}</span><div><b>{m.who}</b><p>{m.brief}</p><button className="vt-link" onClick={() => setSheet({ kind: 'note', about: { label: m.who } })}>What was agreed?</button></div></li>)}</ul></> : null}
  </section>;

  const moneyTab = <MoneyTab view={view} today={today} open={moneyOpen} setOpen={setMoneyOpen} onPursuit={id => setSheet({ kind: 'pursuit', id })}
    onDirect={on => act(() => api.patch('work', 'setting:apply-direct', { on }, on ? 'Direct updates on' : 'Direct updates off'), on ? 'Claude will update next steps directly, with Undo.' : 'Claude will suggest; you approve.')}
    onSuggestion={(id, yes) => { const p = byId(id)!; const q = p.proposed; if (!yes) return act(() => api.patch('work', id, { proposed: null }, 'Rejected suggestion'), 'Left as it was.');
      const fields: Record<string, unknown> = { nextAction: q.nextAction, proposed: null, ...(q.dueBy ? { dueBy: q.dueBy } : {}), ...(q.latest ? { latest: q.latest } : {}), ...(q.state && q.state !== p.state && p.state !== 'table' && ['act', 'waiting', 'watch'].includes(q.state) ? { state: q.state } : {}) };
      const prev = { nextAction: p.nextAction || '', dueBy: p.dueBy || '', latest: p.latest || '', state: p.state || 'watch', proposed: q };
      return act(() => api.patch('work', id, fields, 'Accepted suggestion'), `${p.name}: updated.`, async () => { await api.patch('work', id, prev, 'Undid accept'); }); }}
    onAllSuggestions={() => act(async () => { for (const sg of view.suggestions) { const p = byId(sg.id); if (!p || !p.proposed) continue; const q = p.proposed;
      await api.patch('work', p.id, { nextAction: q.nextAction, proposed: null, ...(q.dueBy ? { dueBy: q.dueBy } : {}), ...(q.latest ? { latest: q.latest } : {}), ...(q.state && q.state !== p.state && p.state !== 'table' && ['act', 'waiting', 'watch'].includes(q.state) ? { state: q.state } : {}) }, 'Accepted suggestion').catch(() => api.patch('work', p.id, { nextAction: q.nextAction, proposed: null, ...(q.dueBy ? { dueBy: q.dueBy } : {}) }, 'Accepted suggestion')); } }, `${view.suggestions.length} next steps updated.`)}
    onUndo={(c) => c.kind === 'pursuit' ? act(() => api.undoClaude(c.id), 'Claude\'s change undone.') : act(() => api.patch('work', c.id, { status: 'open', doneAt: '', doneBy: '', doneReason: '', doneNote: '', reopenedAt: new Date().toISOString() }, 'Reopened'), 'Back on the list.')}
    onUnpark={id => { const p = byId(id)!; return act(() => api.patch('work', id, { state: ['watch', 'waiting', 'act'].includes(p.parkedFrom) ? p.parkedFrom : 'watch', parkedAt: '', parkedBy: '', parkedReason: '', nextAction: p.nextAction || 'Decide the next step' }, 'Unparked'), `${p.name} is back.`); }} />;

  const peopleTab = <PeopleTab api={api} people={data.people} contacts={data.contacts} owner={owner} now={now} onPerson={person => setSheet({ kind: 'person', person })}
    onNotThisWeek={id => notToday('decision', id)} />;

  const eventsTab = <section>
    <h2 className="vt-h">Events <span>next four weeks</span></h2>
    {view.events.length ? <ul className="vt-list">{view.events.map(e => <li key={e.id} className="vt-event">
      <div className="vt-date"><b>{short(e.date)}</b><span>{new Date(e.date + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short' })}</span></div>
      <div className="vt-event-body">
        <b>{e.title}</b>{e.link ? <> <a className="vt-link small" href={e.link} target="_blank" rel="noopener">page</a></> : null}
        <p>{[e.location, e.cost].filter(Boolean).join(' · ')}</p>
        {e.verdict ? <p className={/^skip/i.test(e.verdict) ? 'vt-skip' : 'vt-go'}>{e.verdict}</p> : null}
        {e.going && e.targets ? <p className="vt-muted">Want to meet: {e.targets}</p> : null}
        <div className="vt-row-acts">
          {e.past ? <button className="vt-btn primary" onClick={() => setSheet({ kind: 'note', about: { label: e.title, eventId: e.id, eventTitle: e.title } })}>Who did you meet?</button>
            : e.going ? <><span className="vt-pill">Going</span><button className="vt-btn quiet" onClick={() => act(() => api.patch('planned_event', e.id, { status: 'Research' }, 'Not going'), 'Not going.', async () => { await api.patch('planned_event', e.id, { status: e.status }, 'Going again'); })}>Not going</button></>
            : <><button className="vt-btn primary" onClick={() => act(() => api.patch('planned_event', e.id, { status: 'Booked', owner: actor || 'Barry' }, 'Going'), 'Going. Book your place on the event page.', async () => { await api.patch('planned_event', e.id, { status: e.status }, 'Undid going'); })}>Go</button><button className="vt-btn" onClick={() => act(() => api.patch('planned_event', e.id, { status: 'Declined' }, 'Skip'), 'Skipped.', async () => { await api.patch('planned_event', e.id, { status: e.status }, 'Undid skip'); })}>Skip</button></>}
        </div>
      </div></li>)}</ul> : <p className="vt-clear">No events in the next four weeks. Monday's run adds the best few.</p>}
  </section>;

  return <div className="vt">
    {header}
    <main className="vt-main">{tab === 'today' ? todayTab : tab === 'money' ? moneyTab : tab === 'people' ? peopleTab : eventsTab}</main>
    <button className="vt-note-btn" onClick={() => setSheet({ kind: 'note' })} aria-label="Add a note">+ Note</button>
    <nav className="vt-tabs" aria-label="Screens">{([['today', 'Today'], ['money', 'Money'], ['people', 'People'], ['events', 'Events']] as [Tab, string][]).map(([k, l]) =>
      <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); window.scrollTo(0, 0); }}>{l}{k === 'today' && view.rows.length ? <span className="vt-badge">{view.rows.length}</span> : null}</button>)}
      <a className="vt-old" href="/board">Old board</a></nav>
    {sheet ? <SheetView sheet={sheet} close={() => setSheet(null)} data={data} today={today} actor={actor} api={api} act={act} decide={decide} setSheet={setSheet} todoDone={todoDone} /> : null}
    {toast ? <div className="vt-toast" role="status">{toast.text}{toast.undo ? <button onClick={() => { const u = toast.undo!; setToast(null); u(); }}>Undo</button> : null}</div> : null}
  </div>;

}

type View = ReturnType<typeof buildToday>;

function MoneyTab({ view, today, open, setOpen, onPursuit, onDirect, onSuggestion, onAllSuggestions, onUndo, onUnpark }: {
  view: View; today: string; open: Record<string, boolean>; setOpen: (f: (o: Record<string, boolean>) => Record<string, boolean>) => void;
  onPursuit(id: string): void; onDirect(on: boolean): void; onSuggestion(id: string, yes: boolean): void; onAllSuggestions(): void;
  onUndo(c: View['changed'][number]): void; onUnpark(id: string): void;
}) {
  const toggle = (k: string) => setOpen(o => ({ ...o, [k]: !o[k] }));
  const week = view.meetings;
  return <section>
    <h2 className="vt-h">Priced <span>{fee(view.pricedTotal) || '£0'}{view.pricedMonthly ? ' + ' + fee(view.pricedMonthly, true) : ''}</span></h2>
    {view.priced.length ? <ul className="vt-list">{view.priced.map(p => <li key={p.id}><button className="vt-card" onClick={() => onPursuit(p.id)}>
      <span className="vt-card-top"><b>{p.name}</b><span className="vt-fee">{fee(p.amount, p.monthly) || p.atStake}</span></span>
      <span className="vt-muted">{[p.who, p.out !== null ? `out ${p.out} days` : '', p.decision ? `decision ${short(p.decision)}` : 'no decision date agreed'].filter(Boolean).join(' · ')}</span>
      <span>Next: {p.next || 'set the next step'}{p.touch ? <span className={p.late ? 'vt-late' : 'vt-muted'}> · {p.late ? 'was due ' : ''}{short(p.touch)}</span> : null}</span>
    </button></li>)}</ul> : <p className="vt-clear">No proposals out.</p>}

    {week.length ? <><h2 className="vt-h">Meetings this week</h2><ul className="vt-list">{week.map(m => <li key={m.id} className="vt-meet"><span className="vt-time">{m.today ? 'Today' : short(m.date)}<br />{m.time}</span><div><b>{m.who}</b><p>{m.brief}</p></div></li>)}</ul></> : null}

    <h2 className="vt-h"><button className="vt-fold" onClick={() => toggle('talking')}>Talking, no price yet <span>{view.talking.length}</span> {open.talking ? '▴' : '▾'}</button></h2>
    {open.talking ? <ul className="vt-list">{view.talking.map(p => <li key={p.id}><button className="vt-card" onClick={() => onPursuit(p.id)}>
      <span className="vt-card-top"><b>{p.name}</b>{p.theirs ? <span className="vt-pill grey">their move</span> : null}</span>
      <span className="vt-muted">{p.who}</span><span>Next: {p.next || '—'}{p.due ? <span className="vt-muted"> · {short(p.due)}</span> : null}</span>
    </button></li>)}</ul> : null}

    <h2 className="vt-h">Claude's updates</h2>
    <label className="vt-switch"><input type="checkbox" checked={view.directOn} onChange={e => onDirect(e.target.checked)} /> <span>Let Claude update next steps directly (never prices, wins, losses or parking; Undo below for 14 days)</span></label>
    {view.suggestions.length ? <><div className="vt-sugg"><button className="vt-fold" onClick={() => toggle('sugg')}>Suggested next steps <span>{view.suggestions.length}</span> {open.sugg ? '▴' : '▾'}</button><button className="vt-btn primary" onClick={() => onAllSuggestions()}>Yes to all</button></div>
    {open.sugg ? <ul className="vt-list">{view.suggestions.map(s => <li key={s.id} className="vt-sugg">
      <div><b>{s.name}</b><p><s>{s.now || '(none)'}</s> → {s.next}{s.due ? ` · ${short(s.due)}` : ''}</p><p className="vt-muted">{s.why}</p></div>
      <div className="vt-row-acts"><button className="vt-btn primary" onClick={() => onSuggestion(s.id, true)}>Yes</button><button className="vt-btn" onClick={() => onSuggestion(s.id, false)}>No</button></div></li>)}</ul> : null}</> : null}
    <button className="vt-fold" onClick={() => toggle('changed')}>Changed by Claude, last 14 days <span>{view.changed.length}</span> {open.changed ? '▴' : '▾'}</button>
    {open.changed ? <ul className="vt-list">{view.changed.map(c => <li key={c.kind + c.id} className="vt-sugg"><div><b>{c.title}</b><p>{c.what}</p><p className="vt-muted">{short(c.at)} · {c.why}</p></div><button className="vt-btn quiet" onClick={() => onUndo(c)}>Undo</button></li>)}</ul> : null}

    {view.closed.length ? <><h2 className="vt-h">Closed this month</h2><ul className="vt-list">{view.closed.map(c => <li key={c.id} className="vt-sugg"><div><b>{c.name}</b> <span className="vt-pill grey">{c.state}</span></div>{c.state === 'parked' ? <button className="vt-btn quiet" onClick={() => onUnpark(c.id)}>Unpark</button> : null}</li>)}</ul></> : null}
    <p className="vt-muted small">Today is {nice(today)}.</p>
  </section>;
}

function PeopleTab({ api, people, contacts, owner, now, onPerson, onNotThisWeek }: { api: Api; people: Item[]; contacts: number; owner: Owner; now: Date; onPerson(p: Item): void; onNotThisWeek(id: string): void }) {
  const [q, setQ] = useState(''); const [hits, setHits] = useState<Item[] | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { if (q.trim().length < 2) { setHits(null); return; } setBusy(true); const t = setTimeout(() => { api.search(q.trim()).then(setHits).catch(() => setHits([])).finally(() => setBusy(false)); }, 250); return () => clearTimeout(t); }, [q, api]);
  const see = seeThisWeek(people, { owner, now });
  const today = londonDate(now);
  const groups = useMemo(() => { const m = new Map<string, Item[]>(); for (const h of hits || []) { const k = h.company || 'No company'; m.set(k, [...(m.get(k) || []), h]); } return [...m.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])); }, [hits]);
  return <section>
    <input className="vt-search" type="search" placeholder={`Search ${contacts.toLocaleString('en-GB')} contacts: name, company, email`} value={q} onChange={e => setQ(e.target.value)} aria-label="Search contacts" />
    {hits ? <>{busy ? <p className="vt-muted">Searching…</p> : null}{!hits.length && !busy ? <p className="vt-clear">No one matches.</p> : null}
      {groups.map(([co, list]) => <div key={co} className="vt-group"><h3>{co} <span>{list.length}</span></h3><ul className="vt-list">{list.map(h => <li key={h.id}><button className="vt-card" onClick={() => onPerson(h)}>
        <span className="vt-card-top"><b>{h.name || h.company}</b>{h.lastMet ? <span className="vt-pill">met {short(h.lastMet)}</span> : null}</span><span className="vt-muted">{h.jobTitle}</span></button></li>)}</ul></div>)}</>
    : <>
      <h2 className="vt-h">See this week <span>{see.length}</span></h2>
      <p className="vt-muted">Partners, active contacts and referrers you have not seen for longest. Five a week is plenty.</p>
      <ul className="vt-list">{see.map(x => <li key={x.id} className="vt-sugg"><button className="vt-card plain" onClick={() => onPerson(x)}><b>{x.name}</b><span className="vt-muted">{x.company} · {x.lastMet ? `last met ${short(x.lastMet)} (${Math.round(daysBetween(x.lastMet, today) / 7)} weeks)` : 'not met yet'}</span></button>
        <button className="vt-btn quiet" onClick={() => onNotThisWeek(x.id)}>Not this week</button></li>)}</ul>
    </>}
  </section>;
}

function SheetView({ sheet, close, data, today, actor, api, act, decide, setSheet, todoDone }: {
  sheet: NonNullable<Sheet>; close(): void; data: { work: Item[]; events: Item[]; people: Item[] }; today: string; actor: string; api: Api;
  act(run: () => Promise<unknown>, text: string, undo?: () => Promise<void>): Promise<void>; decide(p: Item, yes: boolean): unknown; setSheet(s: Sheet): void; todoDone(id: string): unknown;
}) {
  const byId = (id: string) => data.work.find(w => w.id === id);
  const [text, setText] = useState(''); const [f, setF] = useState<Record<string, string>>({}); const [confirm, setConfirm] = useState('');
  const field = (k: string, d = '') => f[k] ?? d;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF(o => ({ ...o, [k]: e.target.value }));
  let title = '', body: React.ReactNode = null;

  if (sheet.kind === 'pursuit') {
    const p = byId(sheet.id); if (!p) return null;
    const closed = ['won', 'lost', 'parked'].includes(p.state);
    title = p.name;
    body = <>
      <p className="vt-muted">{[p.person, p.org].filter(Boolean).join(' · ')}{p.email ? <> · <a href={`mailto:${p.email}`}>{p.email}</a></> : null}</p>
      <p className="vt-big">{fee(Number(p.amount) || 0, p.type === 'monthly') || p.atStake || 'No fee yet'} <span className="vt-pill grey">{p.state === 'table' ? 'priced' : p.state === 'waiting' ? 'their move' : p.state}</span></p>
      {p.ask ? <div className="vt-ask"><b>Claude asks: {ASK[p.ask.state]}?</b><p>{p.ask.why}</p><div className="vt-row-acts"><button className="vt-btn primary" onClick={() => decide(p, true)}>Yes</button><button className="vt-btn" onClick={() => decide(p, false)}>No</button></div></div> : null}
      {p.latest ? <p><b>Latest:</b> {p.latest}</p> : null}
      <label className="vt-field">Next step<input value={field('nextAction', p.nextAction || '')} onChange={set('nextAction')} /></label>
      <div className="vt-two"><label className="vt-field">Next touch<input type="date" value={field('dueBy', p.chaseOn || p.dueBy || '')} onChange={set('dueBy')} /></label>
        <label className="vt-field">Client's decision date<input type="date" value={field('decisionDate', p.decisionDate || '')} onChange={set('decisionDate')} /></label></div>
      <div className="vt-two"><label className="vt-field">Fee (£)<input inputMode="numeric" value={field('amount', p.amount ?? '')} onChange={set('amount')} /></label>
        <label className="vt-field">Fee is<select value={field('type', p.type || 'one-off')} onChange={set('type')}><option value="one-off">one-off</option><option value="monthly">monthly</option></select></label></div>
      <label className="vt-field">Owner<select value={field('owner', p.owner || 'Barry')} onChange={set('owner')}><option>Barry</option><option>Graeme</option><option>Both</option></select></label>
      <label className="vt-field">Notes<textarea rows={3} value={field('notes', p.notes || '')} onChange={set('notes')} /></label>
      <div className="vt-row-acts"><button className="vt-btn primary" onClick={() => {
        const out: Record<string, unknown> = {};
        for (const k of ['nextAction', 'decisionDate', 'type', 'owner', 'notes']) if (f[k] !== undefined) out[k] = f[k];
        if (f.dueBy !== undefined) { out.dueBy = f.dueBy; if (p.state === 'table') out.chaseOn = f.dueBy; }
        if (f.amount !== undefined) out.amount = f.amount === '' ? null : Number(String(f.amount).replace(/[£,\s]/g, ''));
        if (!Object.keys(out).length) return close();
        return act(() => api.patch('work', p.id, out, 'Edited'), 'Saved.');
      }}>Save</button>
        <button className="vt-btn" onClick={() => setSheet({ kind: 'note', about: { label: p.name, pursuitId: p.id, recordId: p.recordId } })}>+ Note</button></div>
      {!closed ? <div className="vt-decide">
        {confirm === 'won' ? <><span>Mark {p.name} won?</span><button className="vt-btn primary" onClick={() => act(() => api.patch('work', p.id, { state: 'won', outcome: 'Won', wonOn: today, ask: null }, 'Won'), `${p.name} won.`, async () => { await api.patch('work', p.id, { state: p.state, outcome: '', wonOn: '' }, 'Undid won'); })}>Yes, won</button><button className="vt-btn quiet" onClick={() => setConfirm('')}>Cancel</button></>
          : <><button className="vt-btn" onClick={() => setConfirm('won')}>Won</button><button className="vt-btn" onClick={() => setSheet({ kind: 'lost', id: p.id })}>Lost</button>
            <button className="vt-btn" onClick={() => act(() => api.patch('work', p.id, { state: 'parked', parkedAt: new Date().toISOString(), parkedBy: actor, parkedFrom: p.state || 'watch', ask: null }, 'Parked'), `${p.name} parked.`, async () => { await api.patch('work', p.id, { state: p.state || 'watch', parkedAt: '' }, 'Unparked'); })}>Park</button>
            {p.state !== 'table' ? <button className="vt-btn" onClick={() => setSheet({ kind: 'priced', id: p.id })}>Proposal out</button> : null}</>}
      </div> : null}
      {p.claudePrev ? <p className="vt-muted small">Claude updated this {short(String(p.claudePrev.at))}: {p.claudePrev.why} <button className="vt-link small" onClick={() => act(() => api.undoClaude(p.id), 'Undone.')}>Undo</button></p> : null}
      {(p.history || []).length ? <details className="vt-hist"><summary>History</summary><ul>{(p.history as Item[]).slice(0, 8).map((h, i) => <li key={i}><span className="vt-muted">{short(String(h.at))} {h.by}</span> {h.change}</li>)}</ul></details> : null}
    </>;
  } else if (sheet.kind === 'todo') {
    const t = byId(sheet.id); if (!t) return null;
    title = t.title;
    body = <><p>{t.why}</p>{t.toEmail ? <p className="vt-muted">To: {t.toEmail}{t.subject ? ` · ${t.subject}` : ''}</p> : null}
      <div className="vt-row-acts">{/^https:\/\//.test(t.link || '') ? <a className="vt-btn primary" href={t.link} target="_blank" rel="noopener">Open draft</a> : null}
        <button className="vt-btn" onClick={() => todoDone(t.id)}>Done</button>
        <button className="vt-btn quiet" onClick={() => act(() => api.patch('work', t.id, { status: 'done', doneAt: new Date().toISOString(), doneBy: actor || 'Barry', doneReason: 'no_longer_needed' }, 'Not needed'), 'Cleared.')}>Not needed</button></div></>;
  } else if (sheet.kind === 'step') {
    const p = byId(sheet.id); if (!p) return null;
    title = sheet.chased ? `Chased: ${p.name}` : `Done: ${p.name}`;
    const def = addWorkingDays(today, sheet.chased ? 5 : 3);
    body = <><p className="vt-muted">Done: {p.nextAction}</p>
      <label className="vt-field">What next?<input autoFocus value={field('next', sheet.chased ? (p.nextAction || 'Ask for a yes, a no or a date') : '')} onChange={set('next')} placeholder="One line" /></label>
      <label className="vt-field">When<input type="date" value={field('when', def)} onChange={set('when')} /></label>
      <button className="vt-btn primary" onClick={() => { const nx = field('next', sheet.chased ? (p.nextAction || 'Ask for a yes, a no or a date') : '').trim(); if (!nx) return; const when = field('when', def);
        const prev = { nextAction: p.nextAction || '', dueBy: p.dueBy || '', chaseOn: p.chaseOn || '', latest: p.latest || '' };
        return act(() => api.patch('work', p.id, { nextAction: nx, dueBy: when, ...(p.state === 'table' ? { chaseOn: when } : {}), latest: `${short(today)}: ${sheet.chased ? 'chased' : 'done'}, ${p.nextAction || ''}`.slice(0, 200) }, sheet.chased ? 'Chased' : 'Done'), `Next: ${nx}, ${short(when)}.`, async () => { await api.patch('work', p.id, prev, 'Undid'); }); }}>Save</button></>;
  } else if (sheet.kind === 'priced') {
    const p = byId(sheet.id); if (!p) return null;
    title = `Proposal out: ${p.name}`;
    const def = addWorkingDays(today, 5);
    body = <><div className="vt-two"><label className="vt-field">Fee (£)<input autoFocus inputMode="numeric" value={field('amount', p.amount ?? '')} onChange={set('amount')} placeholder="e.g. 18000" /></label>
      <label className="vt-field">Fee is<select value={field('type', p.type || 'one-off')} onChange={set('type')}><option value="one-off">one-off</option><option value="monthly">monthly</option></select></label></div>
      <div className="vt-two"><label className="vt-field">Sent on<input type="date" value={field('issuedOn', p.issuedOn || today)} onChange={set('issuedOn')} /></label>
      <label className="vt-field">Client's decision date (if they gave one)<input type="date" value={field('decisionDate', p.decisionDate || '')} onChange={set('decisionDate')} /></label></div>
      <label className="vt-field">Next step<input value={field('next', p.nextAction || 'Ask for a yes, a no or a date')} onChange={set('next')} /></label>
      <label className="vt-field">Next touch<input type="date" value={field('when', def)} onChange={set('when')} /></label>
      <button className="vt-btn primary" onClick={() => { const amt = String(field('amount', p.amount ?? '')).replace(/[£,\s]/g, '');
        const fields: Record<string, unknown> = { state: 'table', ask: null, amount: amt === '' ? null : Number(amt), type: field('type', p.type || 'one-off'), issuedOn: field('issuedOn', p.issuedOn || today), decisionDate: field('decisionDate', p.decisionDate || ''), nextAction: field('next', p.nextAction || 'Ask for a yes, a no or a date'), dueBy: field('when', def), chaseOn: field('when', def) };
        const prev = { state: p.state || 'watch', amount: p.amount ?? null, issuedOn: p.issuedOn || '', decisionDate: p.decisionDate || '', nextAction: p.nextAction || '', dueBy: p.dueBy || '', chaseOn: p.chaseOn || '', ask: p.ask || null };
        return act(() => api.patch('work', p.id, fields, 'Proposal out'), `${p.name}: priced.`, async () => { await api.patch('work', p.id, prev, 'Undid priced'); }); }}>Save</button></>;
  } else if (sheet.kind === 'lost') {
    const p = byId(sheet.id); if (!p) return null;
    title = `Lost: ${p.name}`;
    body = <><label className="vt-field">Why<select value={field('why', 'Price')} onChange={set('why')}>{['Price', 'Went elsewhere', 'No decision, went quiet', 'Scope changed', 'Withdrawn', 'Other'].map(o => <option key={o}>{o}</option>)}</select></label>
      <label className="vt-field">One line (optional)<input value={field('line', '')} onChange={set('line')} /></label>
      <button className="vt-btn primary" onClick={() => { const why = [field('why', 'Price'), field('line', '')].filter(Boolean).join(': '); return act(() => api.patch('work', p.id, { state: 'lost', lostReason: why, outcome: /withdrawn/i.test(why) ? 'Withdrawn' : /no decision/i.test(why) ? 'No decision' : 'Lost', ask: null }, 'Lost: ' + why), `${p.name} marked lost.`, async () => { await api.patch('work', p.id, { state: p.state || 'watch', lostReason: '', outcome: '' }, 'Undid lost'); }); }}>Mark lost</button></>;
  } else if (sheet.kind === 'person') {
    const x = sheet.person; title = x.name || x.company;
    const theirs = data.work.filter(w => w.kind === 'pursuit' && !['won', 'lost', 'parked'].includes(w.state) && (w.recordId === x.id || (x.email && String(w.email || '').toLowerCase() === String(x.email).toLowerCase())));
    body = <><p className="vt-muted">{[x.jobTitle, x.company].filter(Boolean).join(' · ')}</p>
      <p>{x.email ? <a href={`mailto:${x.email}`}>{x.email}</a> : null}{x.phone ? <> · <a href={`tel:${x.phone}`}>{x.phone}</a></> : null}{x.linkedin ? <> · <a href={x.linkedin} target="_blank" rel="noopener">LinkedIn</a></> : null}</p>
      <p>{x.lastMet ? `Last met ${nice(x.lastMet)}.` : 'Not met yet.'} {x.lastNote ? `“${x.lastNote}”` : ''}</p>
      {x.notes ? <p className="vt-muted">{x.notes}</p> : null}
      {theirs.length ? <><b>Open pursuits</b><ul className="vt-list">{theirs.map(p => <li key={p.id}><button className="vt-card plain" onClick={() => setSheet({ kind: 'pursuit', id: p.id })}>{p.name}</button></li>)}</ul></> : null}
      <button className="vt-btn primary" onClick={() => setSheet({ kind: 'note', about: { label: x.name || x.company, recordId: x.id } })}>+ Note about {String(x.name || x.company).split(' ')[0]}</button></>;
  } else if (sheet.kind === 'list') {
    title = sheet.title;
    body = <ul className="vt-list">{sheet.rows.map(r => <li key={r.key}><button className="vt-card plain" onClick={() => setSheet(r.kind === 'todo' ? { kind: 'todo', id: r.ref } : { kind: 'pursuit', id: r.ref })}><b>{r.title}</b><span className="vt-muted">{r.why}</span></button></li>)}</ul>;
  } else if (sheet.kind === 'note') {
    const a = sheet.about;
    title = a ? `Note: ${a.label}` : 'Note';
    const Rec = typeof window !== 'undefined' ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null;
    body = <><textarea className="vt-note" autoFocus rows={6} value={text} onChange={e => setText(e.target.value)} placeholder={a?.eventId ? 'One person per line: name, company, what was said' : 'What happened? e.g. "Met Kieron, wants a fee for the Soho step-in by Friday."'} />
      <div className="vt-row-acts">{Rec ? <button className="vt-btn" onClick={() => { const r = new Rec(); r.lang = 'en-GB'; r.interimResults = false; r.onresult = (e: any) => setText(t => (t ? t + '\n' : '') + [...e.results].map((x: any) => x[0].transcript).join(' ')); r.start(); }}>Speak</button> : null}
        <button className="vt-btn primary" disabled={!text.trim()} onClick={() => { const id = 'capture:' + (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
          const entity = { id, kind: 'capture', status: 'open', eventId: a?.eventId || '', eventTitle: a?.eventTitle || '', pursuitId: a?.pursuitId || '', recordId: a?.recordId || '', about: a?.label || '', text: (a && !a.eventId ? `About ${a.label}: ` : '') + text.trim(), photos: 0, createdAt: new Date().toISOString(), by: actor || 'Barry' };
          return act(() => api.create(entity, a?.eventId ? 'Capture' : 'Note'), 'Saved. Claude files it and drafts any follow-up in the morning.'); }}>Save</button></div>
      <p className="vt-muted small">Claude reads notes each morning: updates the pursuit, adds new people for you to approve, drafts follow-ups.</p></>;
  }
  return <div className="vt-shade" onClick={e => { if (e.target === e.currentTarget) close(); }}><div className="vt-sheet" role="dialog" aria-modal="true" aria-label={title}>
    <div className="vt-sheet-head"><h2>{title}</h2><button className="vt-x" onClick={close} aria-label="Close">×</button></div>{body}</div></div>;
}
