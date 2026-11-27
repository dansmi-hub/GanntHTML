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

  function looksLikeHeader(row) {
    if (!row || nonEmpty(row) < 2) return false;
    const first = row.find((v) => v !== null && String(v).trim() !== '');
    const strings = row.filter((v) => typeof v === 'string' && v.trim() !== '').length;
    return NAME_HEADER.test(String(first).trim()) && strings >= Math.max(2, nonEmpty(row) * 0.8);
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
