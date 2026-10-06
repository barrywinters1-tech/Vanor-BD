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

  /** Company-level tier: the top `size` grade-A companies by their best contact score. */
  function tierOne(rows, size) {
    var best = {};
    rows.forEach(function (x) { if (x.p.grade !== 'A') return; var k = norm(x.r.company); if (!k) return; if (!best[k] || x.p.score > best[k]) best[k] = x.p.score; });
    var keys = Object.keys(best).sort(function (a, b) { return best[b] - best[a]; }).slice(0, size || 40);
    var set = {}; keys.forEach(function (k) { set[k] = true; });
    return function (r) { return !!set[norm(r.company)]; };
  }

  root.VanorPriority = { compute: compute, tierOne: tierOne, norm: norm, PLAYS: PLAYS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
