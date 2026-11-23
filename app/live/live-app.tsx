'use client';
// Vanor Live (23 Nov 2026): Today, Pipeline, Clients, a client record, Closed, and the deal drawer.
// Ported from the Vanor Live artifact onto the board's own data: a deal is a pursuit, a client is work kind 'client',
// tasks are the board's to-dos. Stage is a plain-English view of the board state (lib/live-rules), so Claude's jobs,
// the MCP tools and the old screens (/today, /board) keep working on the same records.

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { STAGES, STAGE, stageOf, isOpenDeal, lateDays, quietDays, isQuiet, missingNext, score, kpis, clientTimeline, WARMTH, type Item, type Stage } from '../../lib/live-rules';
import { londonDate } from '../../lib/today-rules';
import './live.css';

type Data = { work: Item[]; events: Item[]; people: Item[]; contacts: number };
type View = 'today' | 'calendar' | 'pipeline' | 'clients' | 'closed';
type Owner = 'All' | 'Barry' | 'Graeme';

async function call(path: string, body?: unknown) {
  const r = await fetch('/api/workspace' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: body === undefined ? undefined : JSON.stringify(body) });
  const out = await r.json().catch(() => ({ error: 'The board did not answer. Try again.' }));
  if (!r.ok) throw new Error(out.error || 'That did not save. Try again.');
  return out;
}
const api = {
  load: (): Promise<Data> => call('/today'),
  user: (): Promise<{ actor: string }> => call('/user'),
  patch: (id: string, fields: Record<string, unknown>, note?: string) => call('/patch', { scope: 'work', id, fields, note }),
  note: (id: string, text: string, kind = 'Note', date?: string) => call('/note', { id, text, kind, date }),
  person: (id: string, person: Record<string, string>) => call('/person', { id, person }),
  client: (c: Record<string, unknown>): Promise<{ id: string }> => call('/client', c),
  deal: (d: Record<string, unknown>): Promise<{ id: string }> => call('/deal', d),
  todo: (t: Record<string, unknown>) => call('/todo', t),
  opened: () => call('/opened', {}),
};

const LANES: [string, string][] = [['funder', 'Funder'], ['dc', 'Data centres'], ['hotel', 'Hotel'], ['offices', 'Offices'], ['claims', 'Claims'], ['other', 'Other']];
const CLIENT_TYPES = ['Lender', 'Fund', 'Developer', 'Owner', 'Operator', 'Contractor', 'Consultant', 'Council', 'Other'];
const OWNERS = ['Barry', 'Graeme', 'Both'];
const KINDS = ['Meeting', 'Call', 'Email', 'Proposal', 'Intro', 'Note'];
const CLOSED_LABEL: Record<string, string> = { won: 'Won', lost: 'Lost', parked: 'Parked' };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const todayIso = () => londonDate(new Date());
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const diff = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const fmtDate = (iso?: string) => { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return `${d} ${MON[m - 1]}${y !== new Date().getFullYear() ? ' ' + y : ''}`; };
const fmtMeet = (iso?: string) => { if (!iso) return ''; const d = new Date(iso); return isNaN(+d) ? iso : d.toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
const money = (n: number) => '£' + Math.round(n || 0).toLocaleString('en-GB');
const num = (v: unknown) => { const s = String(v ?? '').replace(/[£,\s]/g, ''); if (!s) return null; const n = Number(s); return Number.isFinite(n) && n >= 0 ? n : NaN; };
const valueLine = (d: Item) => Number(d.amount) > 0 ? money(d.amount) + (d.type === 'monthly' ? '/mo' : '') : d.atStake || '';
const closedOn = (d: Item) => String(d.closedAt || d.wonOn || d.parkedAt || '').slice(0, 10);
// Outlook times arrive as London wall-clock strings ("2026-11-24T12:30:00.0000000"); read them as written.
const wallDay = (s?: string) => String(s || '').slice(0, 10);
const wallTime = (s?: string) => String(s || '').slice(11, 16);
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayLabel = (iso: string, today: string) => { const n = diff(today, iso); const d = new Date(iso + 'T12:00:00Z'); return (n === 0 ? 'Today, ' : n === 1 ? 'Tomorrow, ' : DAYS[d.getUTCDay()] + ' ') + d.getUTCDate() + ' ' + MON[d.getUTCMonth()]; };
const closeWhy = (d: Item) => d.lostReason || d.parkedReason || (d.outcome && d.outcome !== 'Won' ? d.outcome : '') || '';

export default function LiveApp() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [actor, setActor] = useState('Barry');
  const [view, setView] = useState<View>('today');
  const [clientId, setClientId] = useState<string | null>(null);
  const [dealId, setDealId] = useState<string | null>(null);
  const [newFor, setNewFor] = useState<string | null>(null);
  const [owner, setOwnerState] = useState<Owner>('All');
  const [theme, setThemeState] = useState<'auto' | 'light' | 'dark'>('auto');
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  const reload = useCallback(async () => { try { setData(await api.load()); setError(''); } catch (e: any) { setError(e.message || String(e)); } }, []);
  useEffect(() => {
    reload(); api.user().then(u => setActor(u.actor)).catch(() => {}); api.opened().catch(() => {});
    try { const o = localStorage.getItem('vl-owner'); if (o === 'Barry' || o === 'Graeme' || o === 'All') setOwnerState(o); const t = localStorage.getItem('vl-theme'); if (t === 'light' || t === 'dark') setThemeState(t); } catch { /* private mode */ }
    const route = () => { const h = (location.hash || '#today').slice(1); if (h.startsWith('client-')) { setView('clients'); setClientId(decodeURIComponent(h.slice(7))); } else { setClientId(null); setView((['today', 'calendar', 'pipeline', 'clients', 'closed'].includes(h) ? h : 'today') as View); } window.scrollTo(0, 0); };
    route(); window.addEventListener('hashchange', route);
    const onFocus = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', onFocus);
    return () => { window.removeEventListener('hashchange', route); document.removeEventListener('visibilitychange', onFocus); };
  }, [reload]);
  const setOwner = (o: Owner) => { setOwnerState(o); try { localStorage.setItem('vl-owner', o); } catch { /* ignore */ } };
  const cycleTheme = () => { const t = theme === 'auto' ? 'dark' : theme === 'dark' ? 'light' : 'auto'; setThemeState(t); try { localStorage.setItem('vl-theme', t); } catch { /* ignore */ } };
  const flash = (text: string, bad = false) => { setMsg({ text, bad }); window.setTimeout(() => setMsg(m => (m?.text === text ? null : m)), bad ? 8000 : 2500); };
  const run = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); await reload(); if (ok) flash(ok); return true; } catch (e: any) { flash(e.message || 'That did not save.', true); return false; } };

  const today = todayIso();
  const work = data?.work || [];
  const allDeals = useMemo(() => work.filter(w => w.kind === 'pursuit'), [work]);
  const clients = useMemo(() => new Map(work.filter(w => w.kind === 'client').map(c => [c.id, c])), [work]);
  // Calendar mirror (Claude syncs Outlook each morning); each meeting is matched to a deal or client by attendee email.
  const cal = useMemo(() => {
    const byEmail = new Map<string, { deal?: Item; client?: Item }>();
    for (const cl of work.filter(w => w.kind === 'client')) for (const p of cl.people || []) if (p.email) byEmail.set(String(p.email).toLowerCase(), { client: cl });
    for (const d of work.filter(w => w.kind === 'pursuit' && isOpenDeal(w))) if (d.email) { const k = String(d.email).toLowerCase(); byEmail.set(k, { ...byEmail.get(k), deal: d }); }
    const merged = new Map<string, Item>();
    for (const c of work.filter(w => w.kind === 'calendar')) for (const e of c.events || []) {
      const prev = merged.get(e.id);
      if (prev) { prev.calOwner = 'Both'; continue; }
      const hit = (e.attendees || []).map((a: Item) => byEmail.get(a.email)).find(Boolean) || {};
      merged.set(e.id, { ...e, calOwner: c.owner, client: hit.client, deal: hit.deal || (hit.client ? work.find(w => w.kind === 'pursuit' && isOpenDeal(w) && w.clientId === hit.client.id) : undefined) });
    }
    return [...merged.values()].sort((a, b) => String(a.start).localeCompare(String(b.start)));
  }, [work]);
  const syncedAt = work.filter(w => w.kind === 'calendar').map(w => String(w.syncedAt || '')).sort().pop() || '';
  const todos = useMemo(() => work.filter(w => w.kind === 'todo' && w.status === 'open'), [work]);
  const ql = q.trim().toLowerCase();
  const ownerOk = (o?: string) => owner === 'All' || !o || o === owner || o === 'Both';
  const matchQ = (t: string) => !ql || t.toLowerCase().includes(ql);
  const clientName = (d: Item) => clients.get(d.clientId)?.name || d.org || '';
  const deals = allDeals.filter(d => ownerOk(d.owner) && matchQ([d.name, clientName(d), d.person, d.nextAction, d.atStake].join(' ')));

  const badges = (d: Item) => {
    const b: ReactNode[] = []; const ld = lateDays(d, today);
    if (ld > 0) b.push(<span key="l" className="badge late">{ld} day{ld > 1 ? 's' : ''} late</span>);
    else if (d.dueBy === today) b.push(<span key="d" className="badge info">Due today</span>);
    if (isQuiet(d, today)) { const qd = quietDays(d, today); b.push(<span key="q" className="badge quiet">{qd == null ? 'No activity logged' : `Quiet ${qd} days`}</span>); }
    if (missingNext(d)) b.push(<span key="m" className="badge quiet">No next step</span>);
    if (d.proposed?.nextAction || d.ask) b.push(<span key="c" className="badge info">Claude suggests</span>);
    return b;
  };
  const dealCard = (d: Item, showStage = false) => {
    const who = [clientName(d), d.person].filter(Boolean).join(' · '); const v = valueLine(d);
    return <button key={d.id} type="button" className="card" onClick={() => setDealId(d.id)}>
      <span className="row"><span className="t">{d.name}</span>{v && <span className="v">{v}</span>}</span>
      {(who || showStage) && <span className="who">{who}{showStage && isOpenDeal(d) ? (who ? ' · ' : '') + STAGE[stageOf(d)].name : ''}</span>}
      <span className="next">{d.nextAction || <em>No next action set</em>}</span>
      <span className="row"><span className="due">{d.dueBy ? 'Due ' + fmtDate(d.dueBy) : 'No due date'}{d.owner ? ' · ' + d.owner : ''}</span><span className="badges">{badges(d)}</span></span>
    </button>;
  };
  const kpiStrip = (list: Item[]) => { const k = kpis(list, today); const tile = (l: string, v: ReactNode, t = '') => <div className="kpi" title={t}><span>{l}</span><strong>{v}</strong></div>;
    return <div className="kpis">{tile('Proposals out', money(k.proposalsOut), 'One-off fees on deals at Proposal out or Negotiating')}{tile('Monthly fees on offer', money(k.monthlyOnOffer), 'Monthly fees on deals at Proposal out or Negotiating')}{tile('Weighted pipeline', money(k.weighted), "One-off fees on open deals, times each stage's win chance")}{tile('Overdue', k.overdue)}{tile('Gone quiet', k.quiet, 'Open deals with no activity for longer than their stage allows')}</div>; };
  const ownerChips = () => <div className="chips" role="group" aria-label="Owner"><span className="small">Owner</span>{(['All', 'Barry', 'Graeme'] as Owner[]).map(o => <button key={o} type="button" className="chip" aria-pressed={owner === o} onClick={() => setOwner(o)}>{o}</button>)}</div>;
  const empty = (text: string) => <div className="panel"><p className="empty">{text}</p></div>;

  function TodayView() {
    const open = deals.filter(isOpenDeal);
    const byScore = (a: Item, b: Item) => score(b) - score(a) || lateDays(b, today) - lateDays(a, today);
    const dueNow = open.filter(d => d.dueBy && d.dueBy <= today).sort(byScore);
    const quiet = open.filter(d => isQuiet(d, today) && !(d.dueBy && d.dueBy <= today)).sort(byScore);
    const missing = open.filter(d => missingNext(d) && !(d.dueBy && d.dueBy <= today) && !isQuiet(d, today));
    const soon = open.filter(d => d.dueBy && d.dueBy > today && d.dueBy <= addDays(today, 7) && !isQuiet(d, today)).sort((a, b) => a.dueBy.localeCompare(b.dueBy));
    const tasks = todos.filter(t => ownerOk(t.owner) && matchQ(t.title || ''));
    const in7 = addDays(today, 7);
    const meet = tasks.filter(t => { const d = londonDate(new Date(t.meetingAt || 0)); return t.meetingAt && d >= today && d <= in7; }).sort((a, b) => a.meetingAt.localeCompare(b.meetingAt));
    const calWeek = cal.filter(e => wallDay(e.start) >= today && wallDay(e.start) <= in7 && ownerOk(e.calOwner) && matchQ([e.subject, e.location, ...(e.attendees || []).map((a: Item) => a.name)].join(' ')));
    const todo = tasks.filter(t => !t.meetingAt || londonDate(new Date(t.meetingAt)) < today).sort((a, b) => String(a.due || '9').localeCompare(String(b.due || '9')));
    const sec = (title: string, items: Item[], none: string) => <section aria-label={title}><h2 className="sec">{title}</h2><div className="stack">{items.length ? items.map(d => dealCard(d, true)) : empty(none)}</div></section>;
    const addTodo = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); const form = e.currentTarget;
      run(() => api.todo({ title: f.get('title'), due: f.get('due'), owner: f.get('owner') }), 'To-do added.').then(ok => ok && form.reset()); };
    return <>
      {kpiStrip(deals)}{ownerChips()}
      <div className="today">
        {sec("Due today or late", dueNow, "Nothing due. Good place to be.")}
        <section aria-label="Meetings"><h2 className="sec">Meetings in the next 7 days</h2><div className="panel">{calWeek.length || meet.length ? <>{calWeek.map(meetingRow)}{meet.map(t => <div key={t.id} className="li"><time>{fmtMeet(t.meetingAt)}</time><span>{t.title}{t.why && <><br /><span className="small">{t.why}</span></>}</span></div>)}</> : <p className="empty">{cal.length ? 'Nothing booked in the next 7 days.' : 'Calendar not synced yet. Claude fills it from Outlook each morning.'}</p>}<p className="small" style={{ margin: 0, padding: '6px 12px 10px' }}><a href="#calendar">Full calendar</a>{syncedAt ? ' · synced ' + fmtMeet(syncedAt) : ''}</p></div></section>
        <section aria-label="To-dos"><h2 className="sec">To-dos</h2><div className="panel">
          {todo.length ? todo.map(t => { const past = t.meetingAt && londonDate(new Date(t.meetingAt)) < today; const late = t.due && t.due < today ? diff(t.due, today) : 0;
            return <div key={t.id} className="li"><label className="task"><input type="checkbox" onChange={e => e.target.checked && run(() => api.patch(t.id, { status: 'done', doneAt: new Date().toISOString(), doneBy: actor, doneReason: past ? 'meeting_held' : undefined }, 'Done'), 'Done.')} />
              <span>{t.link ? <a href={t.link} target="_blank" rel="noreferrer">{past ? 'Log how it went: ' + t.title : t.title}</a> : past ? 'Log how it went: ' + t.title : t.title}<br /><span className="small">{t.due ? 'Due ' + fmtDate(t.due) : 'No date'} · {t.owner || 'Unassigned'}</span>{late > 0 && <> <span className="badge late">{late} day{late > 1 ? 's' : ''} late</span></>}</span></label></div>; })
            : <p className="empty">No open to-dos.</p>}
          <form key={actor} className="inline-form" onSubmit={addTodo}><div className="f"><label htmlFor="t-title">New to-do</label><input id="t-title" name="title" required minLength={3} /></div><div className="f" style={{ flex: '0 1 150px' }}><label htmlFor="t-due">Due</label><input id="t-due" name="due" type="date" defaultValue={today} /></div><div className="f" style={{ flex: '0 1 120px' }}><label htmlFor="t-owner">Owner</label><select id="t-owner" name="owner" defaultValue={actor}>{OWNERS.map(o => <option key={o}>{o}</option>)}</select></div><button className="btn primary" type="submit">Add</button></form>
        </div></section>
        {soon.length > 0 && sec("Coming up this week", soon, "")}
        {sec("Gone quiet", quiet, "Nothing has gone quiet.")}
        {missing.length > 0 && sec("Missing a next step", missing, "")}
      </div>
    </>;
  }

  function meetingRow(e: Item) {
    const who = (e.attendees || []).filter((a: Item) => !/vanoradvisory/i.test(a.email || '')).map((a: Item) => a.name || a.email).slice(0, 3).join(', ');
    const lbl = dayLabel(wallDay(e.start), today);
    return <div key={e.id} className="li"><time>{lbl.startsWith('Today') || lbl.startsWith('Tomorrow') ? lbl.split(',')[0] : lbl}<br />{e.allDay ? 'All day' : wallTime(e.start)}</time>
      <span style={{ flex: 1 }}>{e.link ? <a href={e.link} target="_blank" rel="noreferrer">{e.subject}</a> : e.subject}{e.hold && <> <span className="badge quiet">Hold</span></>}{e.calOwner && e.calOwner !== 'Barry' && <> <span className="badge info">{e.calOwner}</span></>}
        {(who || e.location) && <><br /><span className="small">{[who, e.location].filter(Boolean).join(' · ')}</span></>}
        {e.deal && <><br /><button type="button" className="btn link" onClick={() => setDealId(e.deal.id)}>{e.deal.name}{e.deal.nextAction ? ': ' + e.deal.nextAction : ''}</button></>}
        {!e.deal && e.client && <><br /><a className="small" href={'#client-' + encodeURIComponent(e.client.id)}>{e.client.name}</a></>}
      </span></div>;
  }

  function CalendarView() {
    const rows = cal.filter(e => wallDay(e.start) >= today && ownerOk(e.calOwner) && matchQ([e.subject, e.location, ...(e.attendees || []).map((a: Item) => a.name)].join(' ')));
    const days = [...new Set(rows.map(e => wallDay(e.start)))];
    return <>{ownerChips()}
      {!cal.length && empty('Calendar not synced yet. Claude fills it from Outlook each morning.')}
      <div className="stack" style={{ gap: 14 }}>{days.map(d => <section key={d} aria-label={dayLabel(d, today)}><h2 className="sec">{dayLabel(d, today)}</h2><div className="panel">{rows.filter(e => wallDay(e.start) === d).map(meetingRow)}</div></section>)}</div>
      {syncedAt && <p className="small">From Outlook, synced {fmtMeet(syncedAt)}. Released holds are hidden; tentative holds show as Hold.</p>}</>;
  }

  function PipelineView() {
    return <>{kpiStrip(deals)}{ownerChips()}<div className="cols-wrap"><div className="cols">{STAGES.map(s => {
      const ds = deals.filter(d => isOpenDeal(d) && stageOf(d) === s.id).sort((a, b) => Number(lateDays(b, today) > 0) - Number(lateDays(a, today) > 0) || score(b) - score(a));
      const one = ds.reduce((a, d) => a + (d.type !== 'monthly' ? Number(d.amount) || 0 : 0), 0), mon = ds.reduce((a, d) => a + (d.type === 'monthly' ? Number(d.amount) || 0 : 0), 0);
      return <section key={s.id} className="col" aria-label={s.name}><div className="col-h"><h2>{s.name} <span>{Math.round(s.p * 100)}%</span></h2><small>{ds.length} deal{ds.length === 1 ? '' : 's'}{one ? ' · ' + money(one) : ''}{mon ? ' · ' + money(mon) + '/mo' : ''}</small></div>{ds.length ? ds.map(d => dealCard(d)) : empty("None.")}</section>;
    })}</div></div></>;
  }

  const stats = (c: Item) => {
    const tl = clientTimeline(c, allDeals); const mine = allDeals.filter(d => d.clientId === c.id);
    const open = mine.filter(isOpenDeal); const won = mine.filter(d => d.state === 'won');
    return { tl, open, won, last: tl[0]?.date || '', next: open.map(d => d.dueBy).filter(Boolean).sort()[0] || '', wonSum: won.reduce((a, d) => a + (Number(d.amount) || 0), 0) };
  };

  function ClientsView() {
    const list = [...clients.values()].filter(c => ownerOk(c.owner) && matchQ([c.name, ...(c.people || []).map((p: Item) => p.name)].join(' '))).map(c => ({ c, s: stats(c) })).sort((a, b) => b.s.last.localeCompare(a.s.last) || a.c.name.localeCompare(b.c.name));
    const add = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget);
      run(async () => { const r = await api.client({ name: String(f.get('name') || '').trim(), type: f.get('type'), owner: actor, warmth: 'New' }); location.hash = 'client-' + encodeURIComponent(r.id); }, 'Client added.'); };
    return <>{ownerChips()}
      <div className="clients">{list.length ? list.map(({ c, s }) => { const ov = s.open.reduce((a, d) => a + (Number(d.amount) || 0), 0);
        return <a key={c.id} className="card" style={{ textDecoration: 'none', color: 'inherit' }} href={'#client-' + encodeURIComponent(c.id)}>
          <span className="row"><span className="t">{c.name}</span><span className="badge info">{c.type || 'Other'}</span></span>
          <span className="who">{(c.people || []).slice(0, 2).map((p: Item) => p.name).join(', ') || 'No people yet'}</span>
          <span className="due">{s.last ? 'Last contact ' + fmtDate(s.last) : 'No contact logged'} · {c.owner || 'Unassigned'}{c.warmth ? ' · ' + c.warmth : ''}</span>
          <span className="due">{s.open.length} open deal{s.open.length === 1 ? '' : 's'}{ov ? ' · ' + money(ov) : ''}{s.wonSum ? ' · ' + money(s.wonSum) + ' won' : ''}</span></a>; }) : empty("No clients match.")}</div>
      <div className="panel" style={{ maxWidth: 640 }}><form className="inline-form" style={{ borderTop: 0 }} onSubmit={add}><div className="f"><label htmlFor="c-name">Add a client</label><input id="c-name" name="name" required minLength={2} placeholder="Organisation name" /></div><div className="f" style={{ flex: '0 1 160px' }}><label htmlFor="c-type">Type</label><select id="c-type" name="type">{CLIENT_TYPES.map(t => <option key={t}>{t}</option>)}</select></div><button className="btn primary" type="submit">Add</button></form></div>
    </>;
  }

  function clientView(c: Item) {
    const s = stats(c);
    const save = (field: string, value: unknown) => { if ((c[field] ?? '') === value) return; run(() => api.patch(c.id, { [field]: value }, 'Client updated'), 'Saved.'); };
    const ta = (field: string, label: string, ph: string) => <div className="f"><label htmlFor={'cf-' + field}>{label}</label><textarea id={'cf-' + field} defaultValue={c[field] || ''} placeholder={ph} onBlur={e => save(field, e.target.value.trim())} /></div>;
    const sel = (field: string, opts: string[], label: string) => <div className="f" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><label htmlFor={'cs-' + field} className="lbl">{label}</label><select id={'cs-' + field} defaultValue={c[field] || ''} onChange={e => save(field, e.target.value)}><option value="" disabled>Pick</option>{opts.map(o => <option key={o}>{o}</option>)}</select></div>;
    const addPerson = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const form = e.currentTarget; const f = new FormData(form); const p = { name: String(f.get('name')).trim(), role: String(f.get('role') || '').trim(), email: String(f.get('email') || '').trim() };
      run(() => api.person(c.id, p), 'Person added.').then(ok => ok && form.reset()); };
    const addHistory = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); const form = e.currentTarget;
      run(() => api.note(c.id, String(f.get('text')), String(f.get('kind')), String(f.get('date'))), 'Added to history.').then(ok => ok && form.reset()); };
    return <>
      <a href="#clients" className="small">Back to clients</a>
      <div className="client-head"><div className="stack" style={{ gap: 8 }}><h1>{c.name}</h1><div className="chips">{sel("type", CLIENT_TYPES, "Type")}{sel("warmth", [...WARMTH], "Relationship")}{sel("owner", OWNERS, "Owner")}</div></div>
        <div className="kpis" style={{ minWidth: 'min(100%,420px)' }}><div className="kpi"><span>Last contact</span><strong>{s.last ? fmtDate(s.last) : 'None'}</strong></div><div className="kpi"><span>Next touch</span><strong>{s.next ? fmtDate(s.next) : 'None set'}</strong></div><div className="kpi"><span>Fees won</span><strong>{money(s.wonSum)}</strong></div></div></div>
      <div className="c3"><div className="a">
        <section className="box"><h2 className="sec">People</h2>{(c.people || []).length ? (c.people as Item[]).map((p, i) => <div key={i} className="person"><strong>{p.name}</strong>{p.role && <span>{p.role}</span>}{p.email && <a className="small" href={'mailto:' + p.email}>{p.email}</a>}</div>) : <p className="small" style={{ margin: 0 }}>No one recorded yet.</p>}
          <form onSubmit={addPerson} className="stack" style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 10 }}><div className="g2"><div className="f"><label htmlFor="p-name">Name</label><input id="p-name" name="name" required minLength={2} /></div><div className="f"><label htmlFor="p-role">Role</label><input id="p-role" name="role" /></div></div><div className="f"><label htmlFor="p-email">Email</label><input id="p-email" name="email" type="email" /></div><button className="btn" type="submit">Add person</button></form></section>
        <section className="box">{ta("whoElse", "Who else is in the picture", "Other advisers, competitors, routes in through your network")}</section>
      </div><div className="b">
        <section className="box"><h2 className="sec">Relationship history</h2>
          <form onSubmit={addHistory} className="stack"><div className="g2"><div className="f"><label htmlFor="h-kind">Type</label><select id="h-kind" name="kind">{KINDS.map(k => <option key={k}>{k}</option>)}</select></div><div className="f"><label htmlFor="h-date">Date</label><input id="h-date" name="date" type="date" defaultValue={today} /></div></div><div className="f"><label htmlFor="h-text">What happened</label><input id="h-text" name="text" required minLength={2} /></div><button className="btn primary" type="submit">Add to history</button></form>
          <div className="tl">{s.tl.length ? s.tl.map((h, i) => <div key={i}><time>{fmtDate(h.date)}</time><span><strong style={{ fontWeight: 600 }}>{h.kind}.</strong> {h.text}</span></div>) : <p className="small" style={{ margin: 0 }}>Nothing logged yet.</p>}</div></section>
        <section className="box"><h2 className="sec">Open deals</h2>{s.open.length ? s.open.map(d => dealCard(d, true)) : <p className="small" style={{ margin: 0 }}>No open deals.</p>}<button type="button" className="btn" onClick={() => { setNewFor(c.id); setDealId('new'); }}>Add a deal for {c.name}</button></section>
      </div><div className="c">
        <section className="box">{ta("cares", "What they care about", "Their priorities, in their words")}</section>
        <section className="box"><h2 className="sec">Promises</h2>{ta("theyOwe", "They owe us", "Intros, information, decisions")}{ta("weOwe", "We owe them", "Anything you said you would send or do")}</section>
        <section className="box"><h2 className="sec">Work for them</h2>{s.won.length ? s.won.map(d => <div key={d.id} className="person"><strong>{d.name}</strong><span className="small">{valueLine(d)}{closedOn(d) ? ' · won ' + fmtDate(closedOn(d)) : ''}</span></div>) : <p className="small" style={{ margin: 0 }}>No paid work yet.</p>}{ta("work", "Notes on the work", "Scope delivered, lessons learned, who will give a reference")}</section>
        <section className="box">{ta("personal", "Personal notes", "What they shared: family, golf, how they like to be contacted")}</section>
        <p className="small" style={{ margin: 0 }}>Notes save when you click away from the box.</p>
      </div></div>
    </>;
  }

  function ClosedView() {
    const list = deals.filter(d => !isOpenDeal(d)).sort((a, b) => closedOn(b).localeCompare(closedOn(a)));
    const won = list.filter(d => d.state === 'won').reduce((a, d) => a + (Number(d.amount) || 0), 0);
    return <><div className="kpis" style={{ maxWidth: 520 }}><div className="kpi"><span>Won (last 45 days)</span><strong>{money(won)}</strong></div><div className="kpi"><span>Closed deals</span><strong>{list.length}</strong></div></div>
      <div className="tablewrap"><table><thead><tr><th scope="col">Deal</th><th scope="col">Outcome</th><th scope="col">Value</th><th scope="col">Closed</th><th scope="col">Why</th></tr></thead><tbody>
        {list.length ? list.map(d => <tr key={d.id}><td><button type="button" className="btn link" onClick={() => setDealId(d.id)}>{d.name}</button><br /><span className="small">{clientName(d)}</span></td><td><span className={'badge ' + (d.state === 'won' ? 'good' : d.state === 'lost' ? 'late' : 'quiet')}>{CLOSED_LABEL[d.state] || d.state}</span></td><td className="num">{valueLine(d)}</td><td className="num">{fmtDate(closedOn(d))}</td><td>{closeWhy(d)}</td></tr>) : <tr><td colSpan={5}>Nothing closed in the last 45 days.</td></tr>}
      </tbody></table></div><p className="small">Shows deals closed in the last 45 days.</p></>;
  }

  useEffect(() => { document.body.style.overflow = dealId ? 'hidden' : ''; return () => { document.body.style.overflow = ''; }; }, [dealId]);
  const client = clientId ? clients.get(clientId) : null;
  let body: ReactNode;
  if (error && !data) body = <div className="notice">The pipeline could not be loaded: {error}. <button className="btn link" onClick={reload}>Try again</button></div>;
  else if (!data) body = <div className="notice">Loading your pipeline…</div>;
  else if (view === 'today') body = TodayView();
  else if (view === 'calendar') body = CalendarView();
  else if (view === 'pipeline') body = PipelineView();
  else if (view === 'clients') body = clientId ? (client ? <div key={client.id}>{clientView(client)}</div> : <div className="notice">That client is not here. <a href="#clients">Back to clients</a></div>) : ClientsView();
  else body = ClosedView();

  return <div className="vl" data-theme={theme === 'auto' ? undefined : theme}>
    <header className="bar">
      <span className="brand">Vanor Live</span>
      <nav className="nav" aria-label="Sections">{(['today', 'calendar', 'pipeline', 'clients', 'closed'] as View[]).map(v => <a key={v} href={'#' + v} aria-current={view === v ? 'page' : undefined}>{v[0].toUpperCase() + v.slice(1)}</a>)}</nav>
      <div className="tools">
        <label htmlFor="vl-q" className="sr">Search deals and clients</label>
        <input id="vl-q" type="search" placeholder="Search deals, clients, people" value={q} onChange={e => setQ(e.target.value)} />
        <button type="button" className="btn theme" onClick={cycleTheme} aria-label={'Theme: ' + theme}>{theme === 'auto' ? 'Auto' : theme === 'dark' ? 'Dark' : 'Light'}</button>
        <button type="button" className="btn onbar" onClick={() => { setNewFor(null); setDealId('new'); }}>Add deal</button>
      </div>
    </header>
    <main className="main">{msg && <p className={'msg' + (msg.bad ? ' bad' : '')} role="status">{msg.text}</p>}{body}</main>
    {dealId && <Drawer key={dealId} ctx={{ dealId, newFor, actor, today, allDeals, clients, run, reload, flash, setDealId, setNewFor }} />}
    <datalist id="vl-clients">{[...clients.values()].map(c => <option key={c.id} value={c.name} />)}</datalist>
  </div>;
}

type Ctx = { dealId: string; newFor: string | null; actor: string; today: string; allDeals: Item[]; clients: Map<string, Item>; run: (fn: () => Promise<unknown>, ok: string) => Promise<boolean>; reload: () => Promise<void>; flash: (t: string, bad?: boolean) => void; setDealId: (id: string | null) => void; setNewFor: (id: string | null) => void };
function Drawer({ ctx }: { ctx: Ctx }) {
    const { dealId, newFor, actor, today, allDeals, clients, run, reload, flash, setDealId, setNewFor } = ctx;
    const isNew = dealId === 'new';
    const d: Item | undefined = isNew ? { id: 'new', state: 'watch', stage: 'lead', owner: actor, lane: 'other', clientId: newFor || '' } : allDeals.find(x => x.id === dealId);
    const [stage, setStage] = useState<Stage>(d ? stageOf(d) : 'lead');
    const [err, setErr] = useState('');
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && close(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
    if (!d) return null;
    const open = isNew || isOpenDeal(d); const c = clients.get(d.clientId);
    function close() { setDealId(null); setNewFor(null); }
    const submit = async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault(); if (busy) return; const f = new FormData(e.currentTarget); const g = (k: string) => String(f.get(k) ?? '').trim();
      const amount = num(g('amount')); if (Number.isNaN(amount)) return setErr('Fee must be a number in pounds.');
      if (g('name').length < 2) return setErr('Give the deal a name.');
      if (open && stage !== 'lead' && (!g('nextAction') || !g('dueBy') || !g('owner'))) return setErr('Past Lead, every deal needs a next action, a due date and an owner.');
      setBusy(true); setErr('');
      try {
        const cname = g('client'), before = String(c?.name || d.org || '');
        const linkClient = async () => { if (!cname) return ''; const hit = [...clients.values()].find(x => String(x.name).toLowerCase() === cname.toLowerCase()); return hit ? hit.id : (await api.client({ name: cname, owner: g('owner') || actor, warmth: 'New' })).id; };
        const fields: Record<string, unknown> = { name: g('name'), person: g('person'), email: g('email'), lane: g('lane'), atStake: g('atStake'), nextAction: g('nextAction'), dueBy: g('dueBy'), owner: g('owner'), type: g('type') || 'one-off' };
        if (amount !== null) fields.amount = amount;
        if (isNew) {
          const r = await api.deal({ ...fields, org: cname, ...(d.clientId ? { clientId: d.clientId } : {}), stage });
          if (cname && !d.clientId) { const cid = await linkClient(); if (cid) await api.patch(r.id, { clientId: cid }, 'Linked to client'); }
          setDealId(r.id); await reload(); flash('Deal added.'); setBusy(false); return;
        }
        // Only a changed Client field links or creates a client, so saving an old deal never invents one.
        if (cname !== before) { fields.org = cname; fields.clientId = await linkClient(); }
        const changed: Record<string, unknown> = {};
        const cur = (k: string) => (k === 'type' ? d.type || 'one-off' : d[k]);
        for (const [k, v] of Object.entries(fields)) if (String(cur(k) ?? '') !== String(v ?? '')) changed[k] = v;
        if (amount === null && d.amount != null && d.amount !== '') changed.amount = null;
        if (open && stage !== stageOf(d)) changed.stage = stage;
        if (!Object.keys(changed).length) { setBusy(false); return close(); }
        await api.patch(d.id, changed, changed.stage ? 'Stage: ' + STAGE[stage].name : 'Deal updated'); await reload(); flash('Saved.'); close();
      } catch (x: any) { setErr(x.message || 'That did not save.'); }
      setBusy(false);
    };
    const closeDeal = (to: 'won' | 'lost' | 'parked') => {
      if (to === 'lost' && !reason.trim()) return setErr('Say why it was lost, so we learn which lanes to drop.');
      const now = new Date().toISOString();
      const f: Record<string, unknown> = to === 'won' ? { state: 'won', outcome: 'Won', wonOn: today, ask: null } : to === 'lost' ? { state: 'lost', lostReason: reason.trim(), outcome: 'Lost', ask: null } : { state: 'parked', parkedAt: now, parkedBy: actor, parkedFrom: d.state || 'watch', parkedReason: reason.trim(), ask: null };
      run(() => api.patch(d.id, f, CLOSED_LABEL[to] + (reason ? ': ' + reason : '')), `${d.name}: ${CLOSED_LABEL[to].toLowerCase()}.`).then(ok => ok && close());
    };
    const addNote = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); const form = e.currentTarget;
      run(() => api.note(d.id, String(f.get('text')), String(f.get('kind') || 'Note')), 'Note added.').then(ok => ok && form.reset()); };
    const inp = (id: string, name: string, label: string, val?: unknown, type = 'text', extra: Record<string, unknown> = {}) => <div className="f"><label htmlFor={id}>{label}</label><input id={id} name={name} type={type} defaultValue={val == null ? '' : String(val)} {...extra} /></div>;
    const proposal = d.proposed?.nextAction ? d.proposed : null;
    return <><div className="scrim" onClick={close} /><aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="dr-title">
      <div className="dr-head"><h2 id="dr-title">{isNew ? 'New deal' : d.name}</h2><button type="button" className="btn" onClick={close} autoFocus={!isNew}>Close</button></div>
      <div className="dr-body">
        {proposal && <div className="ask"><strong>Claude suggests:</strong> {proposal.nextAction}{proposal.dueBy ? ' by ' + fmtDate(proposal.dueBy) : ''}{proposal.why ? <><br /><span className="small">{proposal.why}</span></> : null}
          <div className="chips" style={{ marginTop: 6 }}><button type="button" className="btn primary" onClick={() => run(() => api.patch(d.id, { nextAction: proposal.nextAction, ...(proposal.dueBy ? { dueBy: proposal.dueBy } : {}), proposed: null }, 'Took Claude\'s next step'), 'Next step updated.')}>Use it</button><button type="button" className="btn" onClick={() => run(() => api.patch(d.id, { proposed: null }, 'Dismissed Claude\'s suggestion'), 'Dismissed.')}>Dismiss</button></div></div>}
        {d.ask?.state && <div className="ask"><strong>Claude asks:</strong> mark this {CLOSED_LABEL[d.ask.state]?.toLowerCase() || 'proposal out'}? {d.ask.why || ''}</div>}
        <form key={String(d.nextAction || '') + '|' + String(d.dueBy || '')} className="box" onSubmit={submit} noValidate>
          {inp("f-name", "name", "Deal name", d.name, 'text', { autoFocus: isNew })}
          <div className="g2">{inp("f-client", "client", "Client", c?.name || d.org, 'text', { list: 'vl-clients', autoComplete: 'off' })}{inp("f-person", "person", "Main contact", d.person, 'text', {})}</div>
          <div className="g2">{inp("f-email", "email", "Email", d.email, "email", {})}<div className="f"><label htmlFor="f-lane">Lane</label><select id="f-lane" name="lane" defaultValue={d.lane || 'other'}>{LANES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div></div>
          {open ? <><fieldset><legend>Stage</legend><div className="seg">{STAGES.map(s => <label key={s.id}><input type="radio" name="stage" value={s.id} checked={stage === s.id} onChange={() => setStage(s.id)} /><span>{s.name}</span></label>)}</div></fieldset><p className="guide">{STAGE[stage].move}</p></>
            : <p className="guide"><span className={'badge ' + (d.state === 'won' ? 'good' : d.state === 'lost' ? 'late' : 'quiet')}>{CLOSED_LABEL[d.state] || d.state}</span> {closedOn(d) ? 'on ' + fmtDate(closedOn(d)) : ''}{closeWhy(d) ? '. ' + closeWhy(d) : ''}</p>}
          <div className="g2">{inp("f-amount", "amount", "Fee (£)", d.amount, 'text', { inputMode: 'numeric' })}<div className="f"><label htmlFor="f-type">Paid</label><select id="f-type" name="type" defaultValue={d.type || 'one-off'}><option value="one-off">One-off</option><option value="monthly">Monthly</option></select></div></div>
          {inp("f-stake", "atStake", "At stake, if no fee is set yet", d.atStake, 'text', {})}
          <div className="box" style={{ background: 'var(--accent-soft)', borderColor: 'var(--accent-soft)' }}>
            {inp("f-next", "nextAction", "Next action", d.nextAction, 'text', {})}
            <div className="g2">{inp("f-due", "dueBy", "Due", d.dueBy, "date", {})}<div className="f"><label htmlFor="f-owner">Owner</label><select id="f-owner" name="owner" defaultValue={d.owner || actor}>{OWNERS.map(o => <option key={o}>{o}</option>)}</select></div></div>
          </div>
          <p className="err" role="alert">{err}</p>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Saving…' : isNew ? 'Add deal' : 'Save'}</button>
        </form>
        {!isNew && <>
          <section className="box"><h2 className="sec">Timeline</h2>
            <form onSubmit={addNote} className="stack"><div className="g2"><div className="f"><label htmlFor="n-text">Add a note</label><input id="n-text" name="text" required minLength={2} placeholder="What happened?" /></div><div className="f"><label htmlFor="n-kind">Type</label><select id="n-kind" name="kind" defaultValue="Note">{KINDS.map(k => <option key={k}>{k}</option>)}</select></div></div><button type="submit" className="btn">Add note</button></form>
            <div className="tl">{(d.log || []).length ? (d.log as Item[]).map((n, i) => <div key={i}><time>{fmtDate(n.date)}</time><span>{n.kind && n.kind !== 'Note' ? <strong style={{ fontWeight: 600 }}>{n.kind}. </strong> : null}{n.text}</span></div>) : <p className="small" style={{ margin: 0 }}>No notes yet.</p>}</div>
            {d.latest && <p className="small" style={{ margin: 0 }}>Latest from Claude: {d.latest}</p>}
          </section>
          {c && <a className="btn" style={{ textAlign: 'center', textDecoration: 'none' }} href={'#client-' + encodeURIComponent(c.id)} onClick={() => setDealId(null)}>Open the {c.name} relationship record</a>}
          {open ? <section className="box"><div className="f"><label htmlFor="f-reason">Reason (needed for lost, optional for won or park)</label><input id="f-reason" value={reason} onChange={e => setReason(e.target.value)} /></div><div className="foot3"><button type="button" className="btn won" onClick={() => closeDeal('won')}>Won</button><button type="button" className="btn" onClick={() => closeDeal('lost')}>Lost</button><button type="button" className="btn" onClick={() => closeDeal('parked')}>Park</button></div></section>
            : <button type="button" className="btn primary" onClick={() => { const back: Stage = d.state === 'parked' ? stageOf({ id: d.id, state: d.parkedFrom || 'watch' }) : 'lead';
              run(() => api.patch(d.id, { stage: back, outcome: '', lostReason: '', wonOn: '', parkedReason: '', ask: null }, 'Reopened'), 'Reopened at ' + STAGE[back].name + '.'); }}>Reopen this deal</button>}
        </>}
      </div></aside></>;
  }
