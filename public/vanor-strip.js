/* Vanor "Everything to do" strip (31 Oct 2026). Pure rules, shared by the board and tests.
   Groups in the order Barry approved: proposals and contracts, replies owed, meetings to arrange,
   next actions due, follow-ups due, proposed by Claude, events, system. Nothing is hidden: each group
   shows its first three and expands in place. */
(function (root) {
  const GROUPS = [
    { key: 'money', label: 'Proposals and contracts' },
    { key: 'reply', label: 'Replies owed' },
    { key: 'meeting', label: 'Meetings to arrange' },
    { key: 'action', label: 'Next actions due' },
    { key: 'followup', label: 'Follow-ups due' },
    { key: 'proposed', label: 'Proposed by Claude' },
    { key: 'event', label: 'Events' },
    { key: 'system', label: 'System' },
  ];
  const DAY = 864e5;
  const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
  const addDays = (d, n) => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10);
  /** n working days after d (Mon-Fri). */
  function addWorkingDays(d, n) { let t = Date.parse(d), left = n; while (left > 0) { t += DAY; const w = new Date(t).getUTCDay(); if (w !== 0 && w !== 6) left--; } return new Date(t).toISOString().slice(0, 10); }
  /** When "Done" is pressed on a pursuit row, the default next date by state (working days). */
  const DONE_DEFAULT = { table: 5, waiting: 5, act: 2, watch: 10 };
  const SENT_CHASE_DAYS = 5;
  const CONTRACT = [
    ['scope', 'Scope and fee confirmed in writing'], ['terms', 'Appointment or sub-consultancy terms agreed'],
    ['cap', 'Liability cap and exclusions agreed'], ['pi', 'PI level met and insurer confirmation sent'],
    ['warranties', 'Collateral warranties / third-party rights settled'], ['conflict', 'Conflict check done'],
    ['signatory', 'Named signatory and signature'], ['start', 'Start date and mobilisation agreed'],
  ];
  const contractOpen = p => CONTRACT.filter(([k]) => !(p.contract && p.contract[k])).map(([, l]) => l);

  /** Decision date: the client's own if recorded, else issue + 14 days (flagged as assumed). */
  function decisionOf(p) {
    if (p.decisionDate) return { date: p.decisionDate, assumed: false };
    if (p.issuedOn) return { date: addDays(p.issuedOn, 14), assumed: true };
    return { date: p.dueBy || '', assumed: false }; // dueBy is a date a person set
  }
  /** A proposal leaves the £ figure once its validity has lapsed. */
  const lapsed = (p, today) => !!(p.validUntil && p.validUntil < today);

  const TRIGGER = {
    distress: ["The lender's workout or monitoring lead, the employer, or the administrator (never the insolvent firm)", 'A two-week position review: what is built, what it costs to finish, and the completion route.'],
    funded: ["The funder's credit or asset-management lead, and the developer's development director", 'Independent monitoring from first drawdown, or a pre-start peer review of programme and cost.'],
    stalled: ["The development director, or the funder's asset manager", 'Position finding and a recovery plan before the restart is fixed.'],
    contractor_appointed: ["The client's development director, or the funder", "An early-warning review of the contractor's programme and cost as works start."],
    acquired: ["The new owner's asset manager or development director", 'A peer review before the team is fixed; for hotels, a refurbishment or PIP cost review.'],
    granted: ["The applicant's development director", 'Who owns delivery risk before the contractor is appointed?'],
    tender: ["The buyer's procurement lead (check the framework route first)", 'Bid or no-bid: does the scope fit and is the deadline workable?'],
    leadership: ['The newly appointed director', 'An introduction in their first 90 days.'],
    on_site: ["The client's development director or the funder", 'Independent monitoring or a mid-build position check.'],
  };
  const triggerFor = stage => { const t = TRIGGER[stage]; return t ? { who: t[0], angle: t[1] } : { who: 'Whoever loses money if the date moves', angle: 'A short, specific observation and a 20-minute call.' }; };
  const valueFloor = band => { const m = String(band || '').replace(/,/g, '').match(/£\s?(\d+(?:\.\d+)?)\s?(m|bn|k)?/i); if (!m) return 0; const n = parseFloat(m[1]); const u = (m[2] || 'm').toLowerCase(); return u === 'bn' ? n * 1000 : u === 'k' ? n / 1000 : n; };
  // Outbound: 4 touches over 3 weeks (email, LinkedIn, second email with a different angle, closing note).
  const SEQ = [0, 4, 10, 21];
  const SEQ_LABEL = ['First email', 'LinkedIn view or note', 'Second email, different angle', 'Closing note'];
  function seqNext(d) { const st = Number(d.seqStep || 0); if (!d.seqStarted || st < 1 || st >= SEQ.length) return null; return { step: st + 1, date: addDays(d.seqStarted, SEQ[st]), label: SEQ_LABEL[st] }; }
  function item(group, o) { return { group, ...o }; }

  function build({ pursuits = [], todos = [], people = [], events = [], jobs = [], captures = [], state = {}, today, owner = 'Both', overdueOnly = false, PV }) {
    const out = [];
    const snoozed = state.snoozed || {}, done = state.done || {};
    const live = k => !(done[k]) && !(snoozed[k] && snoozed[k] > today);
    const mine = o => owner === 'Both' || !o || o === owner || o === 'Both';
    const open = pursuits.filter(p => !p.archived && !['won', 'lost', 'parked'].includes(p.state) || (p.state === 'won' && contractOpen(p).length));
    for (const p of open) {
      if (!mine(p.owner)) continue;
      const val = Number(PV ? PV.value(p) : p.amount) || 0; const monthly = !!(PV && PV.isMonthly && PV.isMonthly(p));
      if (p.outcome && p.state !== 'won') continue;
      if (p.state === 'won') {
        const left = contractOpen(p);
        out.push(item('money', { key: 'contract:' + p.id + ':' + left.length, ref: p.id, kind: 'pursuit', title: p.name, why: `Won, ${left.length} contract item${left.length > 1 ? 's' : ''} open: ${left[0]}`, due: today, overdue: 0, value: val, contract: true, owner: p.owner }));
        continue;
      }
      if (p.proposed && PV && PV.liveProposal(p, today)) {
        // One row per pursuit: the proposal carries the pursuit's own action (before -> after) and the board row is not repeated.
        const q = p.proposed; const expires = PV.proposalDays(p) - days(String(q.at).slice(0, 10), today);
        const stateChange = q.state && q.state !== p.state ? { from: p.state, to: q.state } : null;
        out.push(item('proposed', { key: 'proposed:' + p.id + ':' + (q.at || ''), ref: p.id, kind: 'proposal', title: p.name, why: `Claude proposes: ${q.nextAction}${q.why ? ' (' + q.why + ')' : ''}`, was: p.nextAction || '', wasDue: p.dueBy || '', after: q.nextAction || '', afterDue: q.dueBy || '', stateChange, expiresIn: expires, due: today, overdue: 0, value: val, money: p.state === 'table' && !lapsed(p, today) ? val : 0, monthly, table: p.state === 'table', owner: p.owner }));
        continue;
      }
      if (p.state === 'table') {
        const d = decisionOf(p);
        if (p.chaseOn && p.chaseOn > today) continue; // chased, or sent: quiet until the chase date
        if (lapsed(p, today)) { out.push(item('money', { key: 'lapsed:' + p.id + ':' + p.validUntil, ref: p.id, kind: 'pursuit', title: p.name, why: `Proposal validity lapsed ${p.validUntil}: decide, re-issue or close`, due: p.validUntil, overdue: days(p.validUntil, today), value: 0, money: 0, table: true, owner: p.owner })); continue; }
        if (p.chaseOn && p.chaseOn <= today && (!d.date || p.chaseOn < d.date)) { out.push(item('money', { key: 'chase:' + p.id + ':' + p.chaseOn, ref: p.id, kind: 'pursuit', title: p.name, why: `Chase due ${p.chaseOn}. ${p.nextAction || 'Ask for a yes, no or a date'}`, due: p.chaseOn, overdue: days(p.chaseOn, today), value: val, money: val, monthly, table: true, owner: p.owner })); continue; }
        // Red only for a date someone actually set. An assumed date (issue + 14) is amber: "no decision date agreed".
        if (d.date && d.date <= addDays(today, 2)) out.push(item('money', { key: 'decision:' + p.id + ':' + d.date, ref: p.id, kind: 'pursuit', title: p.name, why: d.assumed ? `No decision date agreed (proposal out ${p.issuedOn || 'date unknown'}). ${p.nextAction || 'Ask for a yes, no or a date'}` : `Decision ${d.date < today ? 'was due' : 'due'} ${d.date}. ${p.nextAction || 'Chase for a yes, no or a date'}`, due: d.date, overdue: d.assumed ? 0 : Math.max(0, days(d.date, today)), amber: d.assumed, value: val, money: val, monthly, table: true, owner: p.owner }));
        continue;
      }
      // Waiting on them: Barry has done his part, so a chase date past is amber ("their move"), not red.
      if (p.dueBy && p.dueBy <= today) { const theirs = p.state === 'waiting'; out.push(item('action', { key: 'action:' + p.id + ':' + p.dueBy, ref: p.id, kind: 'pursuit', title: p.name, why: (theirs ? `Their move; chase due ${p.dueBy}. ` : '') + (p.nextAction || 'Next action due'), due: p.dueBy, overdue: theirs ? 0 : days(p.dueBy, today), amber: theirs, value: val, owner: p.owner })); }
    }
    for (const t of todos) {
      if (t.status === 'done' || t.status === 'skipped') continue;
      if (!mine(t.owner)) continue;
      const g = ['reply', 'meeting', 'followup', 'event', 'proposed', 'money', 'system'].includes(t.type) ? t.type : 'action';
      out.push(item(g, { key: 'todo:' + t.id, ref: t.id, kind: 'todo', title: t.title, why: t.why || '', due: t.due || today, overdue: Math.max(0, days(t.due || today, today)), value: Number(t.value || 0), owner: t.owner, link: t.link || '', person: t.recordId || '', pursuitId: t.pursuitId || '', meetingToday: t.type === 'meeting' && (t.due || '') === today }));
    }
    // People: individual rows for those who matter; the pool becomes one row a week ("Reconnect with 5").
    const pool = [];
    for (const x of people) {
      if (x.mode === 'pool') { if (x.s && x.s.overdue && mine(x.owner)) pool.push(x); continue; }
      const nx = seqNext(x.d || {});
      if (nx) { if (nx.date <= today) out.push(item('followup', { key: 'seq:' + x.r.id + ':' + nx.step, ref: x.r.id, kind: 'person', title: `${x.r.name || x.r.company}${x.r.company && x.r.name ? ' · ' + x.r.company : ''}`, why: `Touch ${nx.step} of 4 due: ${nx.label}${x.d.seqTrigger ? ' (' + x.d.seqTrigger + ')' : ''}`, due: nx.date, overdue: Math.max(0, days(nx.date, today)), value: 0, owner: x.owner || '' })); continue; }
      if (x.rung === 'target' && !x.d.targetSince && !x.d.lastMet) continue;
      if (!x.s || !(x.s.overdue || x.s.dueSoon)) continue;
      const lastNote = x.d.lastNote ? ` Last: ${String(x.d.lastNote).slice(0, 80)}` : '';
      out.push(item('followup', { key: 'person:' + x.r.id + ':' + x.s.next, ref: x.r.id, kind: 'person', title: `${x.r.name || x.r.company}${x.r.company && x.r.name ? ' · ' + x.r.company : ''}`, why: `${x.s.overdue ? 'Overdue since' : 'Due'} ${x.s.next} (${x.rung}).${lastNote}`, due: x.s.next, overdue: Math.max(0, -x.s.days), value: 0, owner: x.owner || '' }));
    }
    if (pool.length && PV && PV.reconnectPick) {
      const wk = PV.weekKey(today); const pick = PV.reconnectPick(pool, PV.POOL_WEEKLY);
      out.push(item('followup', { key: 'reconnect:' + wk, ref: '', kind: 'reconnect', title: `Reconnect with ${pick.length} this week`, why: pick.map(x => x.r.name || x.r.company).join(', ') + ` (${pool.length} people met once, no job yet; a few each week)`, people: pick.map(x => x.r.id), due: wk, overdue: 0, value: 0, owner: '' }));
    }
    for (const e of events) {
      if (e.archived || ['Declined', 'Completed'].includes(e.status) || !e.date) continue;
      const until = days(today, e.date);
      // Any event inside 14 days needs a verdict (go or skip), whatever its status; booked ones need targets and pre-event emails.
      if (until >= 0 && until <= 14) {
        const booked = ['Booked', 'Attending'].includes(e.status);
        const need = !booked ? `decide: go or skip (${e.cost || 'cost not recorded'}${e.targets ? ', targets named' : ', no targets yet'})` : !e.targets ? 'name 3-5 targets and send pre-event emails' : 'pre-event emails out?';
        out.push(item('event', { key: 'event:' + e.id + ':pre', ref: e.id, kind: 'event', title: e.title, why: `${e.date}${until === 0 ? ' (today)' : ` (in ${until} day${until > 1 ? 's' : ''})`}: ${need}`, due: e.date, overdue: 0, value: 0, owner: e.owner || '' }));
      } else if (until < 0 && until >= -3 && ['Booked', 'Attending'].includes(e.status) && !captures.some(c => c.eventId === e.id)) {
        out.push(item('event', { key: 'event:' + e.id + ':post', ref: e.id, kind: 'event', title: e.title, why: 'Who did you meet? Capture them and the follow-ups are drafted.', due: e.date, overdue: -until, value: 0, owner: e.owner || '' }));
      }
    }
    for (const j of jobs) {
      if (!j.expectHours) continue;
      const age = j.lastRan ? (Date.parse(today + 'T23:59:59Z') - Date.parse(j.lastRan)) / 36e5 : Infinity;
      if (!j.ok || age > j.expectHours * 1.5) out.push(item('system', { key: 'job:' + j.id + ':' + (j.lastRan || ''), ref: j.id, kind: 'job', title: j.name || j.id, why: !j.lastRan ? 'Has never reported a run' : !j.ok ? `Last run failed: ${j.note || 'no detail'}` : `Not run since ${String(j.lastRan).slice(0, 16).replace('T', ' ')}`, due: today, overdue: 0, value: 0, owner: '' }));
    }
    const shown = out.filter(i => live(i.key) && (!overdueOnly || i.overdue > 0 || i.group === 'money'));
    shown.sort((a, b) => b.overdue - a.overdue || b.value - a.value || String(a.due).localeCompare(String(b.due)));
    return GROUPS.map(g => ({ ...g, items: shown.filter(i => i.group === g.key) })).filter(g => g.items.length);
  }
  /** "Today": the few that matter most. Money first, then replies owed, meetings today, then real overdue, then the rest. */
  function score(i) {
    const base = i.meetingToday ? 70 : (i.money > 0 || i.table) ? 60 : i.group === 'reply' ? 45 : i.group === 'proposed' ? 35 : i.group === 'meeting' ? 30 : i.group === 'system' ? 25 : i.group === 'action' ? 20 : i.group === 'event' ? 15 : 5;
    return base + Math.min(i.overdue || 0, 30) / 3 + Math.min(i.money || 0, 100000) / 10000;
  }
  /** Top n by score; a row with money on it is never pushed out, so Today can run past n when several proposals are live. */
  function today5(groups, n = 5) { const all = groups.flatMap(g => g.items).sort((a, b) => score(b) - score(a)); const top = all.slice(0, n); for (const i of all.slice(n)) if (i.money > 0) top.push(i); return top; }

  root.VanorStrip = { addWorkingDays, DONE_DEFAULT, SENT_CHASE_DAYS, score, today5, SEQ, SEQ_LABEL, seqNext, TRIGGER, triggerFor, valueFloor, GROUPS, CONTRACT, contractOpen, decisionOf, lapsed, build, addDays };
  if (typeof module !== 'undefined') module.exports = root.VanorStrip;
})(typeof globalThis !== 'undefined' ? globalThis : this);
