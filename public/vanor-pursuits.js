/* Vanor pursuits and people: the shared rules for the Pursuits and People screens and the MCP tools.
   A pursuit is a named piece of work Vanor could be paid for. It lives in one lane and one state.
   A person is someone we have met or want to meet; they sit on a rung that sets how often we meet them. */
(function (root) {
  const LANES = [
    { key: 'funder', label: 'Funders', long: 'Funders: recovery, independent monitoring, technical due diligence' },
    { key: 'claims', label: 'Claims & disputes', long: 'Claims & disputes: sub-consulting to claims, delay and planning firms' },
    { key: 'dc', label: 'Data centres', long: 'Data centres: programme, controls and recovery on mission-critical builds' },
    { key: 'hotel', label: 'Hotels', long: 'Hotels: owner-side PM and cost on hospitality schemes' },
    { key: 'offices', label: 'Commercial offices', long: 'Commercial offices: lease events (find, relocate or refit at lease end), £2-25m; owner-side PM/EA, or CM where no funder conflict' },
    { key: 'other', label: 'Other project work', long: 'Other project work: owner-side PM/EA, peer review and recovery' },
  ];
  const LANE = Object.fromEntries(LANES.map(l => [l.key, l]));

  // Open states, in the order they are worked. Closed states drop off the board.
  const STATES = [
    { key: 'table', label: 'Money on the table', hint: 'A price is with them. The only job is a decision by its date.' },
    { key: 'act', label: 'Act now', hint: 'Named asset, real problem, exposed funder or owner, a route in. Approach within a day.' },
    { key: 'waiting', label: 'Waiting on them', hint: 'Ball is in their court. Each has the date we chase.' },
    { key: 'watch', label: 'Watch', hint: 'Credible, but the asset, the money or the person is not yet clear.' },
  ];
  const STATE = Object.fromEntries(STATES.map(s => [s.key, s]));
  const CLOSED = ['won', 'lost', 'parked'];

  // The four conditions. Anything outside Watch must have all four.
  const GATE = [
    { key: 'asset', label: 'Named project or asset' },
    { key: 'problem', label: 'A real delivery, cost or completion problem' },
    { key: 'capital', label: 'A funder or owner exposed to it' },
    { key: 'route', label: 'A route to the person who decides' },
  ];

  // Rungs, and how often we meet people on each. Target = not met yet, we want to.
  // OWNER SETTING (Barry, 31 Oct 2026): active 2 weeks, referrer 6 weeks, everyone else 8 weeks.
  const RUNGS = [
    { key: 'partner', label: 'Partner', days: 14, hint: 'Has sent us work; owner and plan' },
    { key: 'active', label: 'Active', days: 14, hint: 'Has put a named job in front of us' },
    { key: 'referrer', label: 'Referrer', days: 42, hint: 'Understands what we do and who to send' },
    { key: 'contact', label: 'Contact', days: 56, hint: 'Met; no referral or job yet' },
    { key: 'target', label: 'Target', days: 0, hint: 'Not met yet; we want to' },
  ];
  const RUNG = Object.fromEntries(RUNGS.map(r => [r.key, r]));
  const DUE_SOON_DAYS = 7;
  const TARGET_FIRST_DAYS = 14;

  // McMakin, How Clients Buy: where a buyer is after this meeting.
  const BUYING = ['Aware', 'Understands', 'Interested', 'Respects', 'Trusts', 'Able', 'Ready'];

  const TYPES = ['one-off', 'monthly'];
  const IN_HOUSE = ['yes', 'no', 'unknown'];
  const PROPOSAL_DAYS = 7, STALE_DAYS = 14;
  const isPursuit = w => !!w && w.kind === 'pursuit';
  const isOpen = p => isPursuit(p) && !p.archived && !CLOSED.includes(p.state);
  const laneOf = p => (LANE[p && p.lane] ? p.lane : 'other');
  const stateOf = p => (STATE[p && p.state] ? p.state : CLOSED.includes(p && p.state) ? p.state : 'watch');

  function gateMissing(p) {
    const g = (p && p.gate) || {};
    return GATE.filter(c => !g[c.key]).map(c => c.key);
  }
  // Returns '' when the pursuit may be saved, otherwise the reason it may not.
  function validate(p) {
    if (!p || !String(p.name || '').trim()) return 'Give the pursuit a name.';
    if (!LANE[p.lane]) return 'Pick a lane.';
    const s = p.state || 'watch';
    if (!STATE[s] && !CLOSED.includes(s)) return 'Pick a state.';
    if (s !== 'watch' && !CLOSED.includes(s)) {
      const miss = gateMissing(p);
      if (miss.length) return `Only Watch can hold a pursuit missing: ${miss.map(k => GATE.find(c => c.key === k).label.toLowerCase()).join('; ')}.`;
    }
    if (!CLOSED.includes(s) && s !== 'watch' && !String(p.nextAction || '').trim()) return 'Every open pursuit needs one next action.';
    if (p.amount != null && p.amount !== '' && !(Number(p.amount) >= 0 && Number.isFinite(Number(p.amount)))) return 'Amount must be a number in pounds.';
    if (p.type && !TYPES.includes(p.type)) return 'Type must be one-off or monthly.';
    if (p.invoicedOn && (!/^\d{4}-\d{2}-\d{2}$/.test(p.invoicedOn) || Number.isNaN(Date.parse(p.invoicedOn)))) return 'Invoice date must be a real date.';
    for (const [k, l] of [['issuedOn', 'Proposal issued'], ['validUntil', 'Valid until'], ['decisionDate', 'Client decision date'], ['chaseOn', 'Chase on'], ['energisedBy', 'Grid energisation date']]) if (p[k] && (!/^\d{4}-\d{2}-\d{2}$/.test(p[k]) || Number.isNaN(Date.parse(p[k])))) return l + ' must be a real date.';
    if (s === 'lost' && !String(p.lostReason || '').trim()) return 'Say why it was lost, so we learn which lanes to drop.';
    return '';
  }

  // Parses "£42,500", "42.5k", "£6,500/month" into pounds (first figure only). Used for totals only.
  function pounds(text) {
    const m = String(text || '').replace(/,/g, '').match(/£?\s*(\d+(?:\.\d+)?)\s*(k|m)?/i);
    if (!m) return 0;
    let n = Number(m[1]);
    if (/k/i.test(m[2] || '')) n *= 1e3;
    if (/m/i.test(m[2] || '')) n *= 1e6;
    return Math.round(n);
  }

  // Pounds for one pursuit: the numeric amount if set, else the first figure in the old free-text field.
  const value = p => (p && p.amount != null && p.amount !== '' && Number(p.amount) >= 0 ? Math.round(Number(p.amount)) : pounds(p && p.atStake));
  const isMonthly = p => !!p && p.type === 'monthly';
  const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
  // A proposal from Claude stands for 7 days, then drops off the board (the pursuit keeps its own next action).
  // Funder sales cycles are longer: Claude's proposals on funder pursuits stand 21 days (panel, 31 Oct 2026).
  const FUNDER_PROPOSAL_DAYS = 21;
  const proposalDays = p => (p && p.lane === 'funder' ? FUNDER_PROPOSAL_DAYS : PROPOSAL_DAYS);
  const liveProposal = (p, today) => !!(p && p.proposed && p.proposed.at && daysBetween(String(p.proposed.at).slice(0, 10), today) <= proposalDays(p));
  // A proposal whose validity has lapsed no longer counts in the pounds out.
  const lapsedProposal = (p, today) => !!(p && p.validUntil && today && p.validUntil < today);
  const touched = p => p && (p.founderTouchedAt || p.createdAt || p.updatedAt);
  const stale = (p, today) => isOpen(p) && !!touched(p) && daysBetween(String(touched(p)).slice(0, 10), today) > STALE_DAYS;
  const late = (p, today) => !!(p.dueBy && p.dueBy < today);
  function sortRows(list, today) {
    return list.slice().sort((a, b) =>
      (late(b, today) - late(a, today)) ||
      String(a.dueBy || '9999').localeCompare(String(b.dueBy || '9999')) ||
      (value(b) - value(a)) ||
      String(a.name).localeCompare(String(b.name)));
  }

  // Groups open pursuits: { lane: { state: [rows] } } plus totals.
  function board(pursuits, { lane = 'all', owner = 'Both', today } = {}) {
    const open = pursuits.filter(isOpen).filter(p => lane === 'all' || laneOf(p) === lane)
      .filter(p => owner === 'Both' || !p.owner || p.owner === owner || p.owner === 'Both');
    const by = Object.fromEntries(STATES.map(s => [s.key, []]));
    for (const p of open) by[stateOf(p)].push(p);
    for (const k of Object.keys(by)) by[k] = sortRows(by[k], today);
    const counts = Object.fromEntries(LANES.map(l => [l.key, pursuits.filter(isOpen).filter(p => laneOf(p) === l.key).length]));
    const counted = by.table.filter(p => !lapsedProposal(p, today));
    const onTable = counted.filter(p => !isMonthly(p)).reduce((t, p) => t + value(p), 0);
    const onTableMonthly = counted.filter(isMonthly).reduce((t, p) => t + value(p), 0);
    const overdue = open.filter(p => late(p, today)).length;
    const staleCount = open.filter(p => stale(p, today)).length;
    return { by, counts, total: open.length, onTable, onTableMonthly, overdue, stale: staleCount, proposalsOut: counted.length };
  }

  // The only numbers that matter first: proposals out, fees invoiced, days since the last invoice.
  function money(pursuits, today) {
    const inv = pursuits.filter(isPursuit).filter(p => p.invoicedOn);
    const oneOff = inv.filter(p => !isMonthly(p)).reduce((t, p) => t + value(p), 0);
    const monthly = inv.filter(isMonthly).reduce((t, p) => t + value(p), 0);
    const last = inv.map(p => p.invoicedOn).sort().pop() || '';
    const out = pursuits.filter(isOpen).filter(p => stateOf(p) === 'table' && !lapsedProposal(p, today));
    return { proposalsOut: out.length, proposalsValue: out.filter(p => !isMonthly(p)).reduce((t, p) => t + value(p), 0), proposalsMonthly: out.filter(isMonthly).reduce((t, p) => t + value(p), 0), invoicedOneOff: oneOff, invoicedMonthly: monthly, invoices: inv.length, lastInvoice: last, daysSinceInvoice: last ? daysBetween(last, today) : null };
  }

  function addDays(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  // Next meeting due for a person. Target: due now if never met. Unknown rung: contact.
  function nextMeeting(person, today) {
    const rung = RUNG[person && person.rung] || RUNG.contact;
    // A target has a first-contact deadline: 14 days from when it was added (working setting).
    if (rung.key === 'target') return person && person.lastMet ? addDays(person.lastMet, RUNG.contact.days) : (person && person.targetSince ? addDays(String(person.targetSince).slice(0, 10), TARGET_FIRST_DAYS) : today);
    if (!person || !person.lastMet) return today;
    return addDays(person.lastMet, rung.days);
  }
  function meetingStatus(person, today) {
    const next = nextMeeting(person, today);
    const days = Math.round((Date.parse(next) - Date.parse(today)) / 864e5);
    // 'Due' means overdue or due within DUE_SOON_DAYS, defined once here (review 31 Oct 2026).
    return { next, days, overdue: days < 0, dueSoon: days >= 0 && days <= DUE_SOON_DAYS };
  }

  root.VanorPursuits = { FUNDER_PROPOSAL_DAYS, lapsedProposal, proposalDays, DUE_SOON_DAYS, TARGET_FIRST_DAYS, touched, TYPES, IN_HOUSE, PROPOSAL_DAYS, STALE_DAYS, value, isMonthly, liveProposal, stale, money, daysBetween, LANES, LANE, STATES, STATE, CLOSED, GATE, RUNGS, RUNG, BUYING, isPursuit, isOpen, laneOf, stateOf, gateMissing, validate, pounds, sortRows, board, nextMeeting, meetingStatus, addDays };
  if (typeof module !== 'undefined') module.exports = root.VanorPursuits;
})(typeof globalThis !== 'undefined' ? globalThis : this);
