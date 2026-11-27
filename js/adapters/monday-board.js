/*
 * Adapter: monday.com board / Gantt export (Excel or CSV).
 *
 * Typical layout of a monday.com export:
 *
 *   Board name
 *   (blank)
 *   Group title                      <- becomes the workstream
 *   Name | Person | Status | Timeline | ...   <- header row, repeated per group
 *   Item 1 | ...
 *   Subitems | Owner | Status | Date          <- optional subitem header
 *            | Sub 1 | ...                    <- subitem rows (shifted one column)
 *   (blank)
 *   Next group title
 *   Name | Person | ...
 */
(function (global) {
  'use strict';
  const RM = global.RM;
  const { nonEmpty, looksLikeHeader, cleanHeaders, NAME_HEADER } = RM.adapters.helpers;

  const isEmpty = (v) => v === null || v === undefined || String(v).trim() === '';
  const firstIndex = (row) => (row || []).findIndex((v) => !isEmpty(v));

  function nextNonEmpty(rows, i) {
    for (let j = i + 1; j < rows.length; j++) if (nonEmpty(rows[j]) > 0) return rows[j];
    return null;
  }

  function isSubHeader(row) {
    const i = firstIndex(row);
    return i >= 0 && /^sub-?items?$/i.test(String(row[i]).trim()) && nonEmpty(row) >= 2;
  }

  function detect(rows) {
    let headers = 0, titleBeforeFirst = false, seenHeader = false;
    for (let i = 0; i < Math.min(rows.length, 5000); i++) {
      if (looksLikeHeader(rows[i])) {
        headers++;
        if (!seenHeader && i > 0) {
          for (let k = i - 1; k >= 0; k--) {
            if (nonEmpty(rows[k]) === 1) { titleBeforeFirst = true; break; }
            if (nonEmpty(rows[k]) > 1) break;
          }
        }
        seenHeader = true;
      }
    }
    if (headers >= 2) return 0.95;
    if (headers === 1 && titleBeforeFirst) return 0.7;
    return 0;
  }

  function toTable(rows) {
    const columns = [];
    const colSet = new Set();
    const addCols = (hs) => hs.forEach((h) => { if (!colSet.has(h)) { colSet.add(h); columns.push(h); } });

    const out = [];
    let header = null;
    let sub = null; // { header, start }
    let group = null;
    let title = null;
    const preamble = [];
    let lastItem = null;
    const groups = new Set();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || [];
      const n = nonEmpty(row);
      if (n === 0) { sub = null; continue; }

      if (looksLikeHeader(row)) {
        const start = firstIndex(row);
        header = { names: cleanHeaders(row.slice(start)), start };
        addCols(header.names);
        sub = null;
        if (preamble.length) {
          if (!title && preamble.length >= 2) title = preamble[0];
          group = preamble[preamble.length - 1];
          preamble.length = 0;
        }
        continue;
      }

      if (isSubHeader(row)) {
        const off = firstIndex(row);
        let names, start;
        if (NAME_HEADER.test(String(row[off + 1] || '').trim())) {
          names = cleanHeaders(row.slice(off + 1)); start = off + 1;
        } else {
          names = cleanHeaders(['Name'].concat(row.slice(off + 1))); start = off;
        }
        sub = { names, start };
        addCols(names);
        continue;
      }

      // A lone cell followed by a header row is a group title (or the board title)
      if (n === 1) {
        const next = nextNonEmpty(rows, i);
        if (!header || (next && looksLikeHeader(next))) {
          preamble.push(String(row[firstIndex(row)]).trim());
          continue;
        }
      }

      if (!header) continue; // descriptive rows above the first table

      // Sub-item row: leading cells before the subitem data start are blank
      if (sub && firstIndex(row) >= sub.start && row.slice(0, sub.start).every(isEmpty)) {
        const rec = { __group: group, __isSub: true, __parent: lastItem };
        sub.names.forEach((h, k) => { rec[h] = row[sub.start + k] === undefined ? null : row[sub.start + k]; });
        out.push(rec);
        continue;
      }
      sub = null;

      const rec = { __group: group, __isSub: false, __parent: null };
      header.names.forEach((h, k) => { rec[h] = row[header.start + k] === undefined ? null : row[header.start + k]; });
      lastItem = rec[header.names[0]];
      if (group) groups.add(group);
      out.push(rec);
    }

    return {
      columns,
      rows: out,
      meta: { title: title || null, groupsDetected: groups.size > 0, adapter: 'monday-board' },
    };
  }

  RM.adapters.register({
    id: 'monday-board',
    label: 'monday.com board / Gantt export',
    detect,
    toTable,
  });
})(window);
