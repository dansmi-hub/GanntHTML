/*
 * Smart loading: rather than trusting a single guess, try every sheet with
 * every registered format adapter, auto-map the columns, build the model, and
 * keep whichever combination plots the most activities. This is what makes
 * "just drop the monday.com export in" work across export variations
 * (renamed columns, extra cover sheets, dates only on subitems, ...).
 */
(function (global) {
  'use strict';
  const RM = global.RM;

  function hasContent(sheet) {
    return sheet.rows.some((r) => r && r.some((v) => v !== null && v !== undefined && String(v).trim() !== ''));
  }

  /**
   * @param sheets  [{name, rows}]
   * @param opts    data options passed to buildModel (datePref, subitems, singleDayMilestones)
   * @param forced  optional { sheetIndex, adapterId } to pin either choice
   * @returns { sheetIndex, adapterId, detectScore, table, mapping, model, tried }
   */
  function analyse(sheets, opts, forced) {
    forced = forced || {};
    const pref = (opts && opts.datePref) || 'dmy';
    let best = null;
    const tried = [];
    sheets.forEach((sheet, sheetIndex) => {
      if (forced.sheetIndex !== undefined && forced.sheetIndex !== sheetIndex) return;
      if (!hasContent(sheet)) return;
      const adapters = forced.adapterId && forced.adapterId !== 'auto'
        ? [RM.adapters.get(forced.adapterId)].filter(Boolean)
        : RM.adapters.all();
      for (const adapter of adapters) {
        let detectScore = 0, table, mapping, model;
        try {
          detectScore = adapter.detect(sheet.rows) || 0;
          table = adapter.toTable(sheet.rows);
          mapping = RM.mapping.autoMap(table, pref);
          model = RM.mapping.buildModel(table, mapping, opts);
        } catch (e) {
          console.warn('Adapter', adapter.id, 'failed on sheet', sheet.name, e);
          continue;
        }
        // Plotted items dominate; detection confidence and groups break ties
        const score = model.stats.used * 100 + detectScore * 10 + (table.meta.groupsDetected ? 1 : 0);
        const entry = { sheetIndex, sheetName: sheet.name, adapterId: adapter.id, detectScore, table, mapping, model, score };
        tried.push(entry);
        if (!best || score > best.score) best = entry;
      }
    });
    if (!best) {
      // Nothing usable at all: return an empty shell so the UI can explain
      const table = { columns: [], rows: [], meta: { title: null, groupsDetected: false, adapter: 'generic-table' } };
      const mapping = RM.mapping.autoMap(table, pref);
      best = { sheetIndex: 0, sheetName: sheets[0] && sheets[0].name, adapterId: 'generic-table', detectScore: 0, table, mapping, model: RM.mapping.buildModel(table, mapping, opts), score: 0 };
    }
    best.tried = tried;
    return best;
  }

  RM.loader = { analyse };
})(typeof window !== 'undefined' ? window : globalThis);
