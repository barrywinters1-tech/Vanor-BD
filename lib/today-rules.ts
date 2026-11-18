// Rules for the new Today / Money / People / Events screens (18 Nov 2026). Pure functions: the screens and the tests use them.
// Plan: scratchpad refresh/plan-v2.md. Today shows only things we owe, at most MAX_ROWS rows, decisions first.

export type Item = { id: string; [k: string]: any };
export type Owner = 'Both' | 'Barry' | 'Graeme';
export const MAX_ROWS = 7;
const DAY = 864e5;
const CLOSED = ['won', 'lost', 'parked'];
export const londonDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
export const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
export function addWorkingDays(iso: string, n: number) { let t = Date.parse(iso + 'T12:00:00Z'), left = n; while (left > 0) { t += DAY; const w = new Date(t).getUTCDay(); if (w !== 0 && w !== 6) left--; } return new Date(t).toISOString().slice(0, 10); }
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10) + 'T12:00:00Z') - Date.parse(a.slice(0, 10) + 'T12:00:00Z')) / DAY);
export const stateOf = (p: Item) => String(p.state || 'watch');
export const isOpenPursuit = (p: Item) => p.kind === 'pursuit' && !p.archived && !CLOSED.includes(stateOf(p)) && !p.outcome;
export const isPriced = (p: Item) => stateOf(p) === 'table';
export const valueOf = (p: Item) => Number(p.amount) || 0;
export const isMonthly = (p: Item) => p.type === 'monthly';
export const nextTouch = (p: Item) => String(p.chaseOn || p.dueBy || '');
const snoozed = (x: Item, today: string) => !!(x.snoozedUntil && String(x.snoozedUntil) > today);
const mine = (owner: Owner, o: unknown) => owner === 'Both' || !o || o === owner || o === 'Both';

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
/** The meeting a to-do is about: meetingAt if set, else the "brief for <day date time>" in the title (older rows). */
export function meetingOf(t: Item, today: string): { date: string; time: string; who: string } | null {
  const title = String(t.title || '');
  const who = title.split(':')[0].trim();
  if (t.meetingAt) { const d = new Date(t.meetingAt); return { date: londonDate(d), time: d.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }), who }; }
  const i = title.toLowerCase().indexOf('brief for'); if (t.type !== 'meeting' || i < 0) return null;
  const m = /(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:\s+(?:at\s+)?(\d{1,2})[:.](\d{2}))?/i.exec(title.slice(i));
  if (!m) return null;
  const y = Number(today.slice(0, 4)); const now = Date.parse(today);
  const best = [y - 1, y, y + 1].map(yy => Date.UTC(yy, MONTHS[m[2].toLowerCase()], Number(m[1]))).sort((a, b) => Math.abs(a - now) - Math.abs(b - now))[0];
  return { date: new Date(best).toISOString().slice(0, 10), time: m[3] ? `${m[3].padStart(2, '0')}:${m[4]}` : '', who };
}

export type Row = { key: string; kind: 'decide' | 'money' | 'todo' | 'pursuit'; title: string; why: string; ref: string; link?: string; money?: number; monthly?: boolean; ask?: string; due?: string; late?: boolean; owner?: string };

export function buildToday({ work, events = [], owner = 'Both', now = new Date() }: { work: Item[]; events?: Item[]; owner?: Owner; now?: Date }) {
  const today = londonDate(now);
  const pursuits = work.filter(w => w.kind === 'pursuit');
  const open = pursuits.filter(isOpenPursuit);
  const todos = work.filter(w => w.kind === 'todo');
  const openTodos = todos.filter(t => t.status === 'open');
  const draftFor = (pid: string) => openTodos.find(t => t.pursuitId === pid && /^https:\/\//.test(t.link || ''));

  // 1. Decide: questions only a partner can answer (price, won, lost, park), asked by Claude with the evidence.
  const decide: Row[] = pursuits.filter(p => p.ask && p.ask.state && !snoozed(p, today) && p.ask.state !== stateOf(p) && !(CLOSED.includes(stateOf(p)) && CLOSED.includes(p.ask.state)))
    .map(p => ({ key: 'ask:' + p.id, kind: 'decide', title: p.name, ask: p.ask.state, why: p.ask.why || '', ref: p.id, money: valueOf(p), owner: p.owner }));
  // 2. Money: a priced proposal whose next touch or decision date has come.
  const asked = new Set(decide.map(r => r.ref));
  const money: Row[] = open.filter(p => isPriced(p) && !asked.has(p.id) && mine(owner, p.owner) && !snoozed(p, today) && ((nextTouch(p) && nextTouch(p) <= today) || (p.decisionDate && p.decisionDate <= today)))
    .sort((a, b) => valueOf(b) * (isMonthly(b) ? 12 : 1) - valueOf(a) * (isMonthly(a) ? 12 : 1))
    .map(p => ({ key: 'money:' + p.id, kind: 'money', title: p.name, why: p.nextAction || 'Ask for a yes, a no or a date', ref: p.id, link: draftFor(p.id)?.link || '', money: valueOf(p), monthly: isMonthly(p), due: nextTouch(p), late: !!(p.decisionDate && p.decisionDate < today), owner: p.owner }));
  const moneyIds = new Set([...money.map(r => r.ref), ...asked]);
  // 3. To-dos we owe, due today or before; meeting briefs are not rows (they appear under Meetings).
  const rank: Record<string, number> = { reply: 0, followup: 1, meeting: 2, action: 3 };
  const todoRows: Row[] = openTodos.filter(t => t.type !== 'event' && mine(owner, t.owner) && !snoozed(t, today) && !meetingOf(t, today) && String(t.due || today) <= today && !(t.pursuitId && moneyIds.has(t.pursuitId)))
    .sort((a, b) => (rank[a.type] ?? 4) - (rank[b.type] ?? 4) || String(a.due || '').localeCompare(String(b.due || '')))
    .map(t => ({ key: 'todo:' + t.id, kind: 'todo', title: t.title, why: t.why || '', ref: t.id, link: /^https:\/\//.test(t.link || '') ? t.link : '', due: t.due, owner: t.owner }));
  // 4. Pipeline steps that are ours and due (not the other side's move, not priced).
  const pursuitRows: Row[] = open.filter(p => !isPriced(p) && stateOf(p) !== 'waiting' && mine(owner, p.owner) && !snoozed(p, today) && p.nextAction && p.dueBy && p.dueBy <= today && !openTodos.some(t => t.pursuitId === p.id) && !asked.has(p.id))
    .sort((a, b) => String(a.dueBy).localeCompare(String(b.dueBy)))
    .map(p => ({ key: 'next:' + p.id, kind: 'pursuit', title: p.name, why: p.nextAction, ref: p.id, due: p.dueBy, owner: p.owner }));
  const all = [...decide, ...money, ...todoRows, ...pursuitRows];
  const rows = all.slice(0, MAX_ROWS);

  // Meetings: to-dos carrying a meeting, today and the next 7 days.
  const meetings = openTodos.filter(t => mine(owner, t.owner)).map(t => ({ t, m: meetingOf(t, today) })).filter(x => x.m && x.m.date >= today && x.m.date <= addDays(today, 7))
    .map(x => ({ id: x.t.id, date: x.m!.date, time: x.m!.time, who: x.m!.who, brief: x.t.why || '', today: x.m!.date === today }))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  // Money screen.
  const priced = open.filter(isPriced).sort((a, b) => valueOf(b) * (isMonthly(b) ? 12 : 1) - valueOf(a) * (isMonthly(a) ? 12 : 1))
    .map(p => ({ id: p.id, name: p.name, who: [p.person, p.org].filter(Boolean).join(' · '), amount: valueOf(p), monthly: isMonthly(p), atStake: p.atStake || '', next: p.nextAction || '', touch: nextTouch(p), decision: p.decisionDate || '', out: p.issuedOn ? daysBetween(p.issuedOn, today) : null, latest: p.latest || '', owner: p.owner || '', late: !!(nextTouch(p) && nextTouch(p) < today) }));
  const talking = open.filter(p => !isPriced(p) && mine(owner, p.owner)).sort((a, b) => String(a.dueBy || '9').localeCompare(String(b.dueBy || '9')))
    .map(p => ({ id: p.id, name: p.name, who: [p.person, p.org].filter(Boolean).join(' · '), state: stateOf(p), next: p.nextAction || '', due: p.dueBy || '', theirs: stateOf(p) === 'waiting', latest: p.latest || '', proposal: p.proposed && p.proposed.nextAction ? p.proposed : null }));
  const suggestions = open.filter(p => p.proposed && p.proposed.nextAction).map(p => ({ id: p.id, name: p.name, now: p.nextAction || '', next: p.proposed.nextAction, due: p.proposed.dueBy || '', state: p.proposed.state || '', why: p.proposed.why || '', at: String(p.proposed.at || '').slice(0, 10) }));
  const since = addDays(today, -14);
  const changed = [
    ...pursuits.filter(p => p.claudePrev && String(p.claudePrev.at).slice(0, 10) >= since).map(p => ({ kind: 'pursuit' as const, id: p.id, title: p.name, what: `Next: ${p.claudePrev.set?.nextAction || ''}`, why: p.claudePrev.why || '', at: String(p.claudePrev.at).slice(0, 10) })),
    ...todos.filter(t => t.status === 'done' && t.doneBy === 'Claude' && String(t.doneAt || '').slice(0, 10) >= since).map(t => ({ kind: 'todo' as const, id: t.id, title: t.title, what: ({ sent: 'Closed: your sent mail found', superseded: 'Closed: overtaken', meeting_held: 'Closed: meeting held', no_longer_needed: 'Closed: no longer needed', expired: 'Closed: out of date' } as Record<string, string>)[t.doneReason] || 'Closed', why: t.doneNote || '', at: String(t.doneAt).slice(0, 10) })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const monthStart = today.slice(0, 8) + '01';
  const closed = pursuits.filter(p => CLOSED.includes(stateOf(p)) && String(p.updatedAt || p.parkedAt || '').slice(0, 10) >= monthStart).map(p => ({ id: p.id, name: p.name, state: stateOf(p), amount: valueOf(p) }));

  // Events: last 7 days to 4 weeks ahead.
  const evs = events.filter(e => !e.archived && e.date && e.date >= addDays(today, -7) && e.date <= addDays(today, 28) && !['Declined', 'Watch'].includes(e.status))
    .map(e => ({ id: e.id, title: e.title, date: e.date, past: e.date < today, going: ['Booked', 'Attending', 'Completed'].includes(e.status), status: e.status, cost: e.cost || '', verdict: e.objective || '', targets: e.targets || '', location: e.location || '', link: e.link || '', captured: work.some(w => w.kind === 'capture' && w.eventId === e.id) }))
    .filter(e => !e.past || (e.going && !e.captured))
    .sort((a, b) => a.date.localeCompare(b.date));

  const pricedTotal = priced.filter(p => !p.monthly).reduce((n, p) => n + p.amount, 0);
  const pricedMonthly = priced.filter(p => p.monthly).reduce((n, p) => n + p.amount, 0);
  const setting = work.find(w => w.id === 'setting:apply-direct');
  return { today, rows, more: all.length - rows.length, overflow: all.slice(MAX_ROWS), meetings, priced, pricedTotal, pricedMonthly, talking, suggestions, changed, closed, events: evs, directOn: !!(setting && setting.on === true) };
}

/** People to see this week: partners, active and referrers first, longest since we met; never more than n. */
export function seeThisWeek(people: Item[], { owner = 'Both', n = 5, now = new Date() }: { owner?: Owner; n?: number; now?: Date } = {}) {
  const today = londonDate(now);
  const order: Record<string, number> = { partner: 0, active: 1, referrer: 2 };
  return people.filter(x => x.rung in order && mine(owner, x.owner) && !(x.lastMet && daysBetween(x.lastMet, today) < 14) && !(x.snoozedUntil && x.snoozedUntil > today))
    .sort((a, b) => String(a.lastMet || '0').localeCompare(String(b.lastMet || '0')) || (order[a.rung] - order[b.rung]))
    .slice(0, n);
}
