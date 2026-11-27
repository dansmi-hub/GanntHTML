/*
 * Adapter: any flat table with a single header row
 * (monday.com CSV exports, Excel lists, other tools' exports).
 */
(function (global) {
  'use strict';
  const RM = global.RM;
  const { nonEmpty, cleanHeaders } = RM.adapters.helpers;

  function findHeaderRow(rows) {
    let best = -1, bestScore = 0;
    for (let i = 0; i < Math.min(rows.length, 25); i++) {
      const row = rows[i] || [];
      const strings = row.filter((v) => typeof v === 'string' && v.trim() !== '' && !/^\d/.test(v.trim())).length;
      // A header row has many text cells and is followed by data
      const score = strings + (nonEmpty(rows[i + 1]) > 0 ? 0.5 : 0);
      if (strings >= 2 && score > bestScore) { best = i; bestScore = score; }
    }
    return best;
  }

  function detect(rows) {
    return findHeaderRow(rows) >= 0 ? 0.5 : 0.1;
  }

  function toTable(rows) {
    const h = Math.max(0, findHeaderRow(rows));
    const names = cleanHeaders(rows[h] || []);
    const out = [];
    for (let i = h + 1; i < rows.length; i++) {
      const row = rows[i] || [];
      if (!nonEmpty(row)) continue;
      const rec = { __group: null, __isSub: false, __parent: null };
      names.forEach((n, k) => { rec[n] = row[k] === undefined ? null : row[k]; });
      out.push(rec);
    }
    // A title in the cell above the header (e.g. board name) is handy as a default slide title
    const above = h > 0 ? (rows[0] || []).find((v) => v !== null && String(v).trim() !== '') : null;
    return { columns: names, rows: out, meta: { title: above ? String(above) : null, groupsDetected: false, adapter: 'generic-table' } };
  }

  RM.adapters.register({
    id: 'generic-table',
    label: 'Generic table (single header row)',
    detect,
    toTable,
  });
})(window);
