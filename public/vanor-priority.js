/* Vanor priority matrix: Grade (fit, A/B/C) x Heat (need + relationship, 1-3) and a 0-100 score.
   Shared by the board (browser) and the Claude connector (server). Plain script: sets globalThis.VanorPriority. */
(function (root) {
  'use strict';
  var SIGNAL_WEIGHT = { property: 40, lending: 40, distress: 35, planning: 30, new_spv: 25, new_director: 15 };
  var STAGE_WEIGHT = { Won: 25, Commercial: 25, Opportunity: 25, Relationship: 20, Target: 10, Watch: 5 };
  var DAY = 864e5;
  function age(date, now) { var t = Date.parse(date); return isNaN(t) ? 9999 : (now - t) / DAY; }
  // Full value for 90 days, fading to nothing at a year.
  function decay(days) { return days <= 90 ? 1 : days >= 365 ? 0 : 1 - (days - 90) / 275; }
  function norm(s) { return String(s || '').toLowerCase().replace(/\b(ltd|limited|plc|llp|group|holdings|uk|the)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }

  function need(r, now) {
    var best = 0, top = null, sigs = (r.companyIntel && r.companyIntel.signals) || [];
    for (var i = 0; i < sigs.length; i++) {
      var s = sigs[i]; if (s.type === 'inactive') continue;
      var v = (SIGNAL_WEIGHT[s.type] || 10) * decay(age(s.date, now));
      if (v > best) { best = v; top = s; }
    }
    if (r.origin === 'intel' && r.intel && r.intel.score) {
      var iv = Math.min(40, r.intel.score * 0.45) * decay(age(r.createdAt, now));
      if (iv > best) { best = iv; top = { type: 'scan', date: (r.createdAt || '').slice(0, 10), text: r.source || 'Market scan' }; }
    }
    return { value: Math.round(best), top: top };
  }

  function relationship(r, d, works, now) {
    var v = 0;
    (works || []).forEach(function (w) { if (!w.archived) v = Math.max(v, STAGE_WEIGHT[w.stage] || 0); });
    if (r.classification === 'Known contact') v = Math.max(v, 12);
    var lc = age(r.lastContact, now);
    if (lc <= 180) v = Math.max(v, 15); else if (lc <= 365) v = Math.max(v, 10);
    var c = (d && d.conditions) || {};
    if ((c.Trust || 0) >= 1 || (c.Respect || 0) >= 1) v = Math.max(v, 15);
    return Math.min(25, v);
  }

  function grade(r, d) {
    if (d && d.status === 'Archive') return 'C';
    if (r.companyIntel && r.companyIntel.active === 'inactive') return 'C';
    if (r.fitScore === 2) return 'A';
    if (r.fitScore === 0) return 'C';
    return 'B';
  }

  var PLAYS = {
    A1: 'Pursue now: call this week and propose a Stress Test or monitoring scope.',
    A2n: 'Signal-led email: open with their trigger, ask for 20 minutes.',
    A2w: 'Nurture: catch up and ask what is being funded or built next.',
    A3: 'Watch: research will flag them when a trigger appears.',
    B1: 'Ask for the introduction to the decision-maker on this trigger.',
    B2: 'Keep warm as an introducer: share a useful insight, ask who needs help.',
    B3: 'Low priority: no action unless something changes.',
    C: 'Archive or ignore: not a buyer.'
  };

  function compute(r, d, works, now) {
    now = now || Date.now();
    var g = grade(r, d), n = need(r, now), rel = relationship(r, d, works, now);
    var live = n.value >= 15, warm = rel >= 12;
    var heat = live && warm ? 1 : (live || warm) ? 2 : 3;
    var cell = g === 'C' ? 'C' : g + heat;
    var playKey = g === 'C' ? 'C' : g === 'A' && heat === 2 ? (live ? 'A2n' : 'A2w') : cell;
    var score = Math.min(100, (g === 'A' ? 35 : g === 'B' ? 15 : 0) + n.value + rel);
    return { grade: g, heat: heat, cell: cell, score: g === 'C' ? 0 : score, need: n.value, relationship: rel, live: live, warm: warm, top: n.top, play: PLAYS[playKey] };
  }


  /* One word per contact. Now / Next / Later / Off, with the reason and the move in plain English.
     h (optional history): { hasEmail, lastSent, lastBack, nextAsk, stage } — the board and the server pass what they have. */
  function lane(r, d, works, p, h, now) {
    now = now || Date.now(); h = h || {};
    var hasEmail = h.hasEmail != null ? !!h.hasEmail : !!(r.email && String(r.email).indexOf('@') > 0);
    var stage = h.stage || ''; (works || []).forEach(function (w) { if (!w.archived && !stage) stage = w.stage; });
    var sentD = h.lastSent ? age(h.lastSent, now) : 9999, backD = h.lastBack ? age(h.lastBack, now) : 9999;
    var sigD = p.top && p.top.date ? age(p.top.date, now) : 9999;
    var out = function (l, reason, move) { return { lane: l, reason: reason, move: move || p.play }; };
    if (p.grade === 'C') return out('Off', (d && d.status === 'Archive') ? 'Archived' : 'Not a buyer', 'Nothing to do');
    if (stage === 'Opportunity' || stage === 'Commercial') return out('Now', 'Live ' + stage.toLowerCase() + (h.nextAsk ? ': ' + String(h.nextAsk).slice(0, 70) : ''), h.nextAsk ? 'Do the next ask' : 'Agree the next step and a date');
    if (backD < 0) return out('Now', 'Meeting in ' + Math.ceil(-backD) + ' days', 'Prepare: who is in the room and the one ask');
    if (backD <= 14 && backD <= sentD) return out('Now', backD < 1 ? 'They replied today' : 'They replied ' + Math.floor(backD) + ' days ago', 'Answer today and propose a date');
    if (sentD < 4 && backD > sentD) return out('Next', 'Sent ' + Math.floor(sentD) + ' days ago, waiting', 'Nothing until day 4');
    if (sentD <= 35 && backD > sentD) return out(p.grade === 'A' ? 'Now' : 'Next', 'No reply for ' + Math.floor(sentD) + ' days', 'One plain chase with a date, then stop');
    if (r.intel && r.intel.stage === 'hiring' && hasEmail) return out('Now', 'Hiring senior staff: more work than people', 'Offer senior capacity while they recruit');
    if (p.grade === 'A' && sigD <= 30 && (hasEmail || p.warm)) return out('Now', 'Trigger ' + Math.floor(sigD) + ' days ago: ' + String(p.top.text || p.top.type).slice(0, 70), p.play);
    if (p.cell === 'A1') return out('Now', 'Right buyer with a live need and a relationship', 'Call this week');
    if (p.grade === 'A' && hasEmail) return out('Next', 'Right buyer, email known, nothing live', 'First approach when the quota allows');
    if (p.grade === 'A' && p.live && !hasEmail) return out('Next', 'Live trigger, no email yet', 'Find the decision-maker (RocketReach)');
    if (p.cell === 'B1') return out('Next', 'Knows the decision-maker', 'Ask for the introduction');
    if (p.warm && age(r.lastContact, now) >= 60 && age(r.lastContact, now) < 9000) return out('Next', 'Gone quiet for ' + Math.floor(age(r.lastContact, now)) + ' days', 'Catch up: ask what is next');
    return out('Later', p.grade === 'A' ? 'Right buyer, no email, nothing live' : 'Possible introducer, nothing live', 'Research will flag a trigger');
  }
  var LANE_ORDER = { Now: 0, Next: 1, Later: 2, Off: 3 };

  /* The founders' decision on top of the lane. queue() is the one ranking the board uses:
       bucket  inbox     = nobody has said yes/no yet (only Now/Next lanes reach the inbox)
               todo      = said yes; working it (to_write, replied, meeting, proposal)
               followup  = said yes, email issued, clock has run out, no reply
               waiting   = said yes, email issued, clock still running
               later     = parked, or lane Later
               off       = said no, won, lost, archived, grade C
       rank    one number, higher first, comparable across buckets so one list can be shown. */
  var STEP_RANK = { replied: 900, meeting: 850, proposal: 800, to_write: 600 };
  function queue(r, d, works, p, h, now) {
    now = now || Date.now(); var t0 = new Date(now).toISOString().slice(0, 10);
    var L = lane(r, d, works, p, h, now); var pu = d && d.pursuit; var score = (p && p.score) || 0;
    var out = function (bucket, rank, reason, move) { return { bucket: bucket, rank: rank, lane: L.lane, reason: reason || L.reason, move: move || L.move }; };
    // Met, no proposal since: the biggest leak in the funnel (11 meetings held, 2 proposals, May-Oct 2026). Keep it at the top for 30 days.
    var metD = h && h.lastMet ? age(h.lastMet, now) : 9999;
    var proposedSince = h && h.lastProposal && h.lastMet && h.lastProposal >= h.lastMet;
    var stepNow = pu && pu.step;
    var actedSince = pu && h && h.lastMet && String(pu.stepAt || pu.triagedAt || '').slice(0, 10) >= h.lastMet && stepNow !== 'meeting';
    if (metD >= 0 && metD <= 30 && !proposedSince && !actedSince && !(pu && pu.triage === 'no') && stepNow !== 'proposal' && stepNow !== 'won' && stepNow !== 'lost') {
      // MECE split: a buyer gets a proposal; an introducer gets asked for a named introduction; unclear gets a decision.
      var Cl = root.VanorClassify; var ty = Cl && Cl.typeOf ? Cl.typeOf(r, d) : 'Other';
      var when = metD < 1 ? 'today' : Math.floor(metD) + ' days ago';
      if (/Developer|Funder|Operator|Public/.test(ty)) return out('todo', 960 - metD, 'Met ' + when + ', no proposal yet', 'Send the proposal, or close it');
      if (/Consultancy|Contractor|Introducer/.test(ty)) return out('todo', 700 - metD, 'Met ' + when + ' (introducer), no introduction yet', 'Ask for one named introduction to a client');
      return out('todo', 820 - metD, 'Met ' + when + ': buyer or introducer?', 'Decide: proposal, or ask for an introduction');
    }
    if (pu && pu.triage === 'no') return out('off', -1000, pu.reason ? 'Not a lead: ' + pu.reason : 'Not a lead', 'Nothing to do');
    if (pu && pu.triage === 'later') {
      if (pu.laterUntil && pu.laterUntil > t0) return out('later', 0, 'Parked until ' + pu.laterUntil, 'Nothing until then');
      return out('inbox', 500 + score, 'Parked, now back for a decision', 'Yes, no or park again');
    }
    if (pu && pu.triage === 'yes') {
      var st = pu.step || 'to_write';
      if (st === 'won' || st === 'lost') return out('off', -1000, st === 'won' ? 'Won' : 'Lost', 'Nothing to do');
      if (st === 'sent') {
        if (h && h.lastBack && pu.sentAt && h.lastBack >= pu.sentAt) return out('todo', 900 + score, 'They replied after your email', 'Answer today and propose a date');
        if (pu.followUpAt && pu.followUpAt <= t0) { var over = age(pu.followUpAt, now); return out('followup', 1000 + Math.min(over, 30) * 10 + (pu.chases || 0) * 5, 'Follow-up due' + (over >= 1 ? ' (' + Math.floor(over) + ' days overdue)' : '') + (pu.chases ? ', chase ' + (pu.chases + 1) : ''), (pu.chases || 0) >= 2 ? 'Call, or park it' : 'One plain chase with a date'); }
        return out('waiting', 100 + score, 'Email issued ' + pu.sentAt + ', waiting until ' + pu.followUpAt, 'Nothing until then');
      }
      var reasons = { to_write: 'On your list: email not yet issued', replied: 'They replied: book the meeting', meeting: 'Meeting stage', proposal: 'Proposal stage' };
      var moves = { to_write: 'Write and issue the email', replied: 'Propose a date today', meeting: 'Prepare, then follow up within a day', proposal: 'Agree the decision date' };
      var ageD = pu.stepAt ? age(pu.stepAt, now) : 0;
      return out('todo', (STEP_RANK[st] || 500) + Math.min(ageD, 30) + score / 100, reasons[st] + (ageD >= 3 ? ' (' + Math.floor(ageD) + ' days)' : ''), moves[st]);
    }
    // Scanner leads: the Jev-style route decides. Ignore = off, watch = later, approach = inbox ranked by confidence.
    var C = root.VanorClassify; var rt = C && C.route && r.origin === 'intel' ? C.route(r) : null;
    if (rt && rt.verdict === 'ignore') return out('off', -1000, 'Ignore: ' + rt.reason, 'Nothing to do');
    if (rt && rt.verdict === 'watch') return out('later', score, 'Watch: ' + rt.reason, 'Comes back when the signal moves');
    if (rt && rt.verdict === 'approach') return out(L.lane === 'Off' ? 'off' : 'inbox', 400 + (rt.confidence === 'high' ? 200 : rt.confidence === 'medium' ? 100 : 0) + score, rt.reason, C.actionLine(r));
    if (L.lane === 'Off') return out('off', -1000);
    if (L.lane === 'Later') return out('later', score);
    // Nobody has pressed yes, but the record is already in flight (an email went, a reply came, a meeting or a live opportunity). Bucket it by what happened; no second triage.
    var sentD = h && h.lastSent ? age(h.lastSent, now) : 9999, backD = h && h.lastBack ? age(h.lastBack, now) : 9999;
    if (/^Live (opportunity|commercial)|^Meeting in|^They replied/.test(L.reason)) return out('todo', 880 + score / 100, L.reason, L.move);
    if (/^No reply for/.test(L.reason)) return out('followup', 990 + Math.min(sentD, 30) * 5, L.reason, L.move);
    if (/^Sent /.test(L.reason)) return out('waiting', 90 + score, L.reason, L.move);
    return out('inbox', (L.lane === 'Now' ? 300 : 200) + score);
  }
  var BUCKET_ORDER = { followup: 0, todo: 1, inbox: 2, waiting: 3, later: 4, off: 5 };
  var BUCKET_LABEL = { followup: 'Follow-ups due', todo: 'To do', inbox: 'Inbox', waiting: 'Waiting', later: 'Later', off: 'Off' };

  /** Company-level tier: the top `size` grade-A companies by their best contact score. */
  function tierOne(rows, size) {
    var best = {};
    rows.forEach(function (x) { if (x.p.grade !== 'A') return; var k = norm(x.r.company); if (!k) return; if (!best[k] || x.p.score > best[k]) best[k] = x.p.score; });
    var keys = Object.keys(best).sort(function (a, b) { return best[b] - best[a]; }).slice(0, size || 40);
    var set = {}; keys.forEach(function (k) { set[k] = true; });
    return function (r) { return !!set[norm(r.company)]; };
  }

  root.VanorPriority = { compute: compute, lane: lane, queue: queue, LANE_ORDER: LANE_ORDER, BUCKET_ORDER: BUCKET_ORDER, BUCKET_LABEL: BUCKET_LABEL, tierOne: tierOne, norm: norm, PLAYS: PLAYS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
