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
    // Clearly-named date columns are mapped even if their values can't be read yet,
    // so the user sees them (and their values) in the mapping/diagnostics.
    const DATEY = /date|timeline|^start$|^end$|^finish$/i;
    if (!m.timeline && !m.start) m.start = pick((c, p) => RX.start.test(c) && DATEY.test(c) && p.count > 0);
    if (!m.timeline && !m.end) m.end = pick((c, p) => RX.end.test(c) && DATEY.test(c) && p.count > 0);
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
    // Subitems: 'auto' shows them only where the parent item has no dates of its own
    // (common in monday.com boards where the detail lives in subitems), 'always', or 'never'.
    const subMode = opts.subitems || (opts.includeSubitems ? 'always' : 'auto');
    stats.subitemsShown = 0;
    stats.rollups = 0;
    stats.subitemsHidden = 0;
    let parent = null; // { row, dated, item (once plotted), ws }

    const rowDates = (row) => {
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
      return start === null ? null : { start, end };
    };

    const wsOf = (row) => {
      if (!mapping.workstream) return 'All activities';
      const v = mapping.workstream === '__group' ? row.__group : row[mapping.workstream];
      return U.isBlank(v) ? 'Other' : String(v).trim();
    };

    const push = (row, name, d, extra) => {
      const ws = wsOf(row);
      if (!wsMap.has(ws)) wsMap.set(ws, { name: ws, items: [] });
      const item = Object.assign({
        id: ++id,
        name: String(name).trim(),
        start: d.start, end: d.end, milestone: false,
        status: mapping.status && !U.isBlank(row[mapping.status]) ? String(row[mapping.status]).trim() : '',
        isSub: !!row.__isSub,
        parent: row.__parent || null,
        parentId: null,
        rollup: false,
      }, extra || {});
      wsMap.get(ws).items.push(item);
      return item;
    };

    const isMilestone = (row, d) => {
      // Rule: an item whose start and end fall on the same day is a milestone; anything longer is a bar.
      // An explicitly mapped milestone column can also mark items as milestones.
      let m = opts.singleDayMilestones !== false && d.start === d.end;
      if (!m && row && mapping.milestone && !U.isBlank(row[mapping.milestone])) {
        m = MILESTONE_TRUE.test(String(row[mapping.milestone]).trim());
      }
      return m;
    };

    for (const row of table.rows) {
      const name = mapping.name ? row[mapping.name] : null;
      const d = U.isBlank(name) ? null : rowDates(row);

      if (!row.__isSub) {
        parent = U.isBlank(name) ? null : { row, name, dated: !!d, item: null };
        if (U.isBlank(name)) continue;
        if (!d) { stats.undated++; continue; }
      } else {
        stats.subitems++;
        const parentDated = parent && parent.dated;
        if (subMode === 'never' || (subMode === 'auto' && parentDated)) { stats.subitemsHidden++; continue; }
        if (U.isBlank(name)) continue;
        if (!d) { stats.undated++; continue; }
        stats.subitemsShown++;
        // Parent without dates of its own: draw it as a summary bar spanning its subitems
        if (parent && !parent.dated && !parent.item) {
          parent.item = push(parent.row, parent.name, { start: d.start, end: d.end }, { rollup: true });
          stats.rollups++;
          stats.used++;
        }
      }

      const ms = isMilestone(row, d);
      const item = push(row, name, ms ? { start: d.end, end: d.end } : d, { milestone: ms });
      if (row.__isSub && parent && parent.item) {
        item.parentId = parent.item.id;
        if (parent.item.rollup) {
          parent.item.start = Math.min(parent.item.start, item.start);
          parent.item.end = Math.max(parent.item.end, item.end);
        }
      }
      if (!row.__isSub && parent) parent.item = item;
      stats.used++;
    }

    // Final pass: milestone flags for roll-ups, counts and overall date span
    for (const ws of wsMap.values()) {
      for (const it of ws.items) {
        if (it.rollup) it.milestone = isMilestone(null, it);
        if (it.milestone) stats.milestones++;
        minDay = Math.min(minDay, it.start);
        maxDay = Math.max(maxDay, it.end);
      }
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
