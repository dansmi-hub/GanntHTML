/*
 * Format adapters turn a raw sheet (array-of-arrays) into a flat table:
 *
 *   {
 *     columns: ['Name', 'Status', 'Timeline', ...],   // data column headers
 *     rows:    [{ __group, __parent, __isSub, Name: ..., Timeline: ... }],
 *     meta:    { title, groupsDetected: bool, adapter: id }
 *   }
 *
 * To support a new export format, add a file that calls RM.adapters.register()
 * with { id, label, detect(rows) -> 0..1, toTable(rows) } and include it in
 * index.html. The highest-scoring adapter wins (users can override in the UI).
 */
(function (global) {
  'use strict';
  const RM = global.RM;
  const list = [];

  function register(adapter) {
    if (!adapter || !adapter.id || !adapter.detect || !adapter.toTable) throw new Error('Invalid adapter');
    list.push(adapter);
  }

  function all() { return list.slice(); }
  function get(id) { return list.find((a) => a.id === id); }

  /** Pick the best adapter for these rows. Returns {adapter, score}. */
  function detect(rows) {
    let best = null, bestScore = -1;
    for (const a of list) {
      let s = 0;
      try { s = a.detect(rows) || 0; } catch (e) { s = 0; }
      if (s > bestScore) { best = a; bestScore = s; }
    }
    return { adapter: best, score: bestScore };
  }

  /* Shared helpers for adapters ------------------------------------- */
  const NAME_HEADER = /^(name|item|items|item name|task|task name|activity|activities|title|deliverable|milestone name|project)$/i;

  function nonEmpty(row) {
    return (row || []).filter((v) => v !== null && v !== undefined && String(v).trim() !== '').length;
  }

  // Column titles commonly found in monday.com (and similar) exports
  const KNOWN_HEADER = /^(name|items?|item name|tasks?|task name|activit(y|ies)|title|deliverables?|projects?|initiatives?|epics?|features?|status|owners?|person|people|assignees?|team|priority|timeline.*|.*\bdates?\b.*|start.*|end.*|due.*|deadline|duration.*|dependen.*|sub-?items|group|notes?|files?|tags?|link.*|.*effort.*|progress|budget|phase|workstream|creation log|last updated|item id.*|location|text|numbers?|time tracking|week|resource)$/i;

  /**
   * Is this row a table header? Either its first cell is a name-like title
   * ("Name", "Item", "Task"...), or it is all text and several cells are
   * well-known column titles (so renamed first columns still work).
   */
  function looksLikeHeader(row) {
    const n = nonEmpty(row);
    if (!row || n < 2) return false;
    const cells = row.filter((v) => v !== null && v !== undefined && String(v).trim() !== '');
    if (cells.some((v) => typeof v !== 'string')) return false;
    const first = String(cells[0]).trim();
    if (/^sub-?items?$/i.test(first)) return false; // subitem header, handled separately
    if (NAME_HEADER.test(first)) return true;
    const known = cells.filter((v) => KNOWN_HEADER.test(String(v).trim())).length;
    return known >= 2 && known >= n * 0.4;
  }

  /** Make header labels unique and non-empty */
  function cleanHeaders(row) {
    const seen = {};
    return (row || []).map((h, i) => {
      let name = h === null || h === undefined || String(h).trim() === '' ? `Column ${i + 1}` : String(h).trim();
      if (seen[name]) { seen[name]++; name = `${name} (${seen[name]})`; } else seen[name] = 1;
      return name;
    });
  }

  RM.adapters = { register, all, get, detect, helpers: { nonEmpty, looksLikeHeader, cleanHeaders, NAME_HEADER } };
})(window);
