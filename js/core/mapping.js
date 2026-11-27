/*
 * Column mapping: works out which table columns hold the workstream, activity
 * name, dates, milestone flag and status, then builds the roadmap model the
 * renderer consumes:
 *
 *   {
 *     workstreams: [{ name, items: [{ id, name, start, end, milestone, status, isSub, parent }] }],
 *     minDay, maxDay,
 *     stats: { rows, used, undated, milestones, subitems }
 *   }
 */
(function (global) {
  'use strict';
  const RM = global.RM;
  const U = RM.util;

  const ROLES = ['workstream', 'name', 'timeline', 'start', 'end', 'date', 'milestone', 'status'];

  const RX = {
    workstream: /work\s*stream|stream|swim\s*lane|^group|group$|phase|programme|program|project|epic|category|area|team|theme|pillar|track/i,
    name: /^(name|item|items|item name|task|task name|activity|activities|title|deliverable|description)$/i,
    timeline: /timeline|time line|gantt|date range|period|schedule|dates$/i,
    start: /start|begin|from|kick.?off/i,
    end: /\bend\b|end date|finish|due|deadline|target|complet|deliver|\bto\b/i,
    milestone: /milestone/i,
    status: /status|\brag\b|health|state/i,
  };

  function values(table, col, limit) {
    const out = [];
    for (const r of table.rows) {
      const v = r[col];
      if (!U.isBlank(v)) out.push(v);
      if (limit && out.length >= limit) break;
    }
    return out;
  }

  function ratio(vals, fn) {
    if (!vals.length) return 0;
    let ok = 0;
    for (const v of vals) if (fn(v)) ok++;
    return ok / vals.length;
  }

  function profile(table, col, pref) {
    const vals = values(table, col, 300);
    const distinct = new Set(vals.map((v) => String(v).trim().toLowerCase())).size;
    return {
      count: vals.length,
      distinct,
      date: ratio(vals, (v) => U.parseDate(v, pref) !== null),
      range: ratio(vals, (v) => { const r = U.parseRange(v, pref); return !!r && (r.end !== r.start || /\s(-|–|to)\s/.test(String(v))); }),
      text: ratio(vals, (v) => typeof v === 'string' && U.parseDate(v, pref) === null && isNaN(+v)),
    };
  }

  /** Guess a mapping for the table. Returns {workstream, name, timeline, start, end, milestone, status}. */
  function autoMap(table, pref) {
    const cols = table.columns;
    const prof = {};
    cols.forEach((c) => { prof[c] = profile(table, c, pref); });
    const used = new Set();
    const pick = (fn) => { const c = cols.find((c) => !used.has(c) && fn(c, prof[c])); if (c) used.add(c); return c || ''; };

    const m = {};
    m.name = pick((c, p) => RX.name.test(c) && p.count > 0) || pick((c, p) => p.text > 0.7 && p.distinct > 1);
    m.start = pick((c, p) => RX.start.test(c) && p.date > 0.3);
    m.end = pick((c, p) => RX.end.test(c) && p.date > 0.3);
    m.timeline = pick((c, p) => RX.timeline.test(c) && p.range > 0.3) || (!m.start ? pick((c, p) => p.range > 0.5) : '');
    // A single-date column (e.g. monday.com "Date" / "Due date"): used when an item has no start/end,
    // which makes it a one-day item, i.e. a milestone.
    m.date = pick((c, p) => /date|due|deadline/i.test(c) && p.count > 0 && p.date > 0.3);
    if (!m.timeline && !m.start && !m.date) m.date = pick((c, p) => p.date > 0.6);
    m.milestone = pick((c, p) => RX.milestone.test(c) && p.count > 0);
    m.status = pick((c, p) => RX.status.test(c) && p.count > 0);

    if (table.meta && table.meta.groupsDetected) m.workstream = '__group';
    else {
      const n = table.rows.length;
      m.workstream = pick((c, p) => RX.workstream.test(c) && p.count > 0 && p.distinct <= Math.max(2, n * 0.6) && p.text > 0.5);
    }
    ROLES.forEach((r) => { if (m[r] === undefined) m[r] = ''; });
    return m;
  }

  const MILESTONE_TRUE = /milestone|^(yes|y|true|1|x|✓|✔|☑)$/i;

  function buildModel(table, mapping, opts) {
    opts = opts || {};
    const pref = opts.datePref || 'dmy';
    const wsMap = new Map();
    const stats = { rows: table.rows.length, used: 0, undated: 0, milestones: 0, subitems: 0 };
    let minDay = Infinity, maxDay = -Infinity;
    let id = 0;
    let lastParentId = null;

    for (const row of table.rows) {
      if (!row.__isSub) lastParentId = null;
      if (row.__isSub) { stats.subitems++; if (!opts.includeSubitems) continue; }
      const name = mapping.name ? row[mapping.name] : null;
      if (U.isBlank(name)) continue;

      let start = null, end = null;
      if (mapping.timeline) {
        const r = U.parseRange(row[mapping.timeline], pref);
        if (r) { start = r.start; end = r.end; }
      }
      if (start === null && (mapping.start || mapping.end)) {
        const s = mapping.start ? U.parseDate(row[mapping.start], pref) : null;
        const e = mapping.end ? U.parseDate(row[mapping.end], pref) : null;
        start = s !== null ? s : e;
        end = e !== null ? e : s;
        if (start !== null && end < start) { const t = start; start = end; end = t; }
      }
      if (start === null && mapping.date) {
        const d = U.parseDate(row[mapping.date], pref);
        if (d !== null) { start = d; end = d; }
      }
      if (start === null) { stats.undated++; continue; }

      // Rule: an item whose start and end fall on the same day is a milestone; anything longer is a bar.
      // An explicitly mapped milestone column can also mark items as milestones.
      let milestone = opts.singleDayMilestones !== false && start === end;
      if (!milestone && mapping.milestone && !U.isBlank(row[mapping.milestone])) {
        milestone = MILESTONE_TRUE.test(String(row[mapping.milestone]).trim());
      }
      if (milestone) { stats.milestones++; start = end; }

      let ws = 'All activities';
      if (mapping.workstream) {
        const v = mapping.workstream === '__group' ? row.__group : row[mapping.workstream];
        ws = U.isBlank(v) ? 'Other' : String(v).trim();
      }
      if (!wsMap.has(ws)) wsMap.set(ws, { name: ws, items: [] });
      wsMap.get(ws).items.push({
        id: ++id,
        name: String(name).trim(),
        start, end, milestone,
        status: mapping.status && !U.isBlank(row[mapping.status]) ? String(row[mapping.status]).trim() : '',
        isSub: !!row.__isSub,
        parent: row.__parent || null,
        parentId: row.__isSub ? lastParentId : null,
      });
      if (!row.__isSub) lastParentId = id;
      stats.used++;
      minDay = Math.min(minDay, start);
      maxDay = Math.max(maxDay, end);
    }

    return {
      workstreams: Array.from(wsMap.values()),
      minDay: isFinite(minDay) ? minDay : null,
      maxDay: isFinite(maxDay) ? maxDay : null,
      stats,
    };
  }

  RM.mapping = { ROLES, autoMap, buildModel };
})(window);
