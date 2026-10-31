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
    return { date: p.dueBy || '', assumed: !p.dueBy ? false : true };
  }
  /** A proposal leaves the £ figure once its validity has lapsed. */
  const lapsed = (p, today) => !!(p.validUntil && p.validUntil < today);

  function item(group, o) { return { group, ...o }; }

  function build({ pursuits = [], todos = [], people = [], events = [], jobs = [], state = {}, today, owner = 'Both', overdueOnly = false, PV }) {
    const out = [];
    const snoozed = state.snoozed || {}, done = state.done || {};
    const live = k => !(done[k]) && !(snoozed[k] && snoozed[k] > today);
    const mine = o => owner === 'Both' || !o || o === owner || o === 'Both';
    const open = pursuits.filter(p => !p.archived && !['won', 'lost', 'parked'].includes(p.state) || (p.state === 'won' && contractOpen(p).length));
    for (const p of open) {
      if (!mine(p.owner)) continue;
      const val = Number(PV ? PV.value(p) : p.amount) || 0;
      if (p.outcome && p.state !== 'won') continue;
      if (p.state === 'won') {
        const left = contractOpen(p);
        out.push(item('money', { key: 'contract:' + p.id + ':' + left.length, ref: p.id, kind: 'pursuit', title: p.name, why: `Won, ${left.length} contract item${left.length > 1 ? 's' : ''} open: ${left[0]}`, due: today, overdue: 0, value: val, owner: p.owner }));
        continue;
      }
      if (p.proposed && PV && PV.liveProposal(p, today)) out.push(item('proposed', { key: 'proposed:' + p.id + ':' + (p.proposed.at || ''), ref: p.id, kind: 'proposal', title: p.name, why: `Claude proposes: ${p.proposed.nextAction}${p.proposed.why ? ' (' + p.proposed.why + ')' : ''}`, due: today, overdue: 0, value: val, owner: p.owner }));
      if (p.state === 'table') {
        const d = decisionOf(p);
        if (lapsed(p, today)) { out.push(item('money', { key: 'lapsed:' + p.id + ':' + p.validUntil, ref: p.id, kind: 'pursuit', title: p.name, why: `Proposal validity lapsed ${p.validUntil}: decide, re-issue or close`, due: p.validUntil, overdue: days(p.validUntil, today), value: 0, owner: p.owner })); continue; }
        if (p.chaseOn && p.chaseOn <= today && (!d.date || p.chaseOn < d.date)) { out.push(item('money', { key: 'chase:' + p.id + ':' + p.chaseOn, ref: p.id, kind: 'pursuit', title: p.name, why: `Chase due ${p.chaseOn}. ${p.nextAction || 'Ask for a yes, no or a date'}`, due: p.chaseOn, overdue: days(p.chaseOn, today), value: val, owner: p.owner })); continue; }
        if (d.date && d.date <= addDays(today, 2)) out.push(item('money', { key: 'decision:' + p.id + ':' + d.date, ref: p.id, kind: 'pursuit', title: p.name, why: `Decision ${d.date < today ? 'was due' : 'due'} ${d.date}${d.assumed ? ' (assumed)' : ''}. ${p.nextAction || 'Chase for a yes, no or a date'}`, due: d.date, overdue: Math.max(0, days(d.date, today)), value: val, owner: p.owner }));
        continue;
      }
      if (p.dueBy && p.dueBy <= today) out.push(item('action', { key: 'action:' + p.id + ':' + p.dueBy, ref: p.id, kind: 'pursuit', title: p.name, why: p.nextAction || 'Next action due', due: p.dueBy, overdue: days(p.dueBy, today), value: val, owner: p.owner }));
    }
    for (const t of todos) {
      if (t.status === 'done' || t.status === 'skipped') continue;
      if (!mine(t.owner)) continue;
      const g = ['reply', 'meeting', 'followup', 'event', 'proposed', 'money', 'system'].includes(t.type) ? t.type : 'action';
      out.push(item(g, { key: 'todo:' + t.id, ref: t.id, kind: 'todo', title: t.title, why: t.why || '', due: t.due || today, overdue: Math.max(0, days(t.due || today, today)), value: Number(t.value || 0), owner: t.owner, link: t.link || '', person: t.recordId || '' }));
    }
    for (const x of people) {
      if (!x.s || !(x.s.overdue || x.s.dueSoon)) continue;
      const lastNote = x.d.lastNote ? ` Last: ${String(x.d.lastNote).slice(0, 80)}` : '';
      out.push(item('followup', { key: 'person:' + x.r.id + ':' + x.s.next, ref: x.r.id, kind: 'person', title: `${x.r.name || x.r.company}${x.r.company && x.r.name ? ' · ' + x.r.company : ''}`, why: `${x.s.overdue ? 'Overdue since' : 'Due'} ${x.s.next} (${x.rung}).${lastNote}`, due: x.s.next, overdue: Math.max(0, -x.s.days), value: 0, owner: x.owner || '' }));
    }
    for (const e of events) {
      if (e.archived || ['Declined', 'Completed'].includes(e.status) || !e.date) continue;
      const until = days(today, e.date);
      if (until >= 0 && until <= 14 && ['Booked', 'Attending', 'Interested', 'Qualified', 'Deciding'].includes(e.status)) {
        const need = !e.targets ? 'name 3-5 targets and send pre-event emails' : ['Interested', 'Qualified', 'Deciding'].includes(e.status) ? 'decide whether to book' : 'pre-event emails out?';
        out.push(item('event', { key: 'event:' + e.id + ':pre', ref: e.id, kind: 'event', title: e.title, why: `${e.date}${until === 0 ? ' (today)' : ` (in ${until} day${until > 1 ? 's' : ''})`}: ${need}`, due: e.date, overdue: 0, value: 0, owner: e.owner || '' }));
      } else if (until < 0 && until >= -3 && ['Booked', 'Attending'].includes(e.status)) {
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

  root.VanorStrip = { GROUPS, CONTRACT, contractOpen, decisionOf, lapsed, build, addDays };
  if (typeof module !== 'undefined') module.exports = root.VanorStrip;
})(typeof globalThis !== 'undefined' ? globalThis : this);
