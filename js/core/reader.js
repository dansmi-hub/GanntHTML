/*
 * File reading. Uses the locally bundled SheetJS (vendor/xlsx.full.min.js).
 * Nothing is uploaded anywhere: the File is read into memory with FileReader.
 *
 * Output: an array of sheets, each { name, rows } where rows is an
 * array-of-arrays of cell values. Date-formatted cells are converted to ISO
 * strings ("2025-03-14") so the rest of the app never has to guess whether a
 * number is a date.
 */
(function (global) {
  'use strict';
  const RM = global.RM;

  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error || new Error('Could not read file'));
      fr.readAsArrayBuffer(file);
    });
  }

  function isTextFile(name) {
    return /\.(csv|tsv|txt)$/i.test(name || '');
  }

  function sheetToRows(ws) {
    const XLSX = global.XLSX;
    if (!ws || !ws['!ref']) return [];
    const range = XLSX.utils.decode_range(ws['!ref']);
    const rows = [];
    // Guard against absurd ranges in malformed files
    const maxR = Math.min(range.e.r, range.s.r + 20000);
    const maxC = Math.min(range.e.c, range.s.c + 200);
    for (let r = range.s.r; r <= maxR; r++) {
      const row = [];
      for (let c = range.s.c; c <= maxC; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        row.push(cellValue(cell));
      }
      // Trim trailing nulls
      while (row.length && (row[row.length - 1] === null || row[row.length - 1] === '')) row.pop();
      rows.push(row);
    }
    return rows;
  }

  function cellValue(cell) {
    const XLSX = global.XLSX;
    if (!cell) return null;
    if (cell.t === 'd' && cell.v instanceof Date) {
      const d = cell.v;
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    if (cell.t === 'n' && cell.z && XLSX.SSF.is_date(cell.z)) {
      const p = XLSX.SSF.parse_date_code(cell.v);
      if (p) return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
    }
    if (cell.t === 'e') return null;
    if (cell.v === undefined || cell.v === null) return null;
    return typeof cell.v === 'string' ? cell.v.trim() : cell.v;
  }

  /** Read a File object into [{name, rows}] */
  async function readFile(file) {
    const XLSX = global.XLSX;
    if (!XLSX) throw new Error('Spreadsheet library failed to load (vendor/xlsx.full.min.js).');
    const buf = await readFileAsArrayBuffer(file);
    const text = isTextFile(file.name);
    // For CSV we keep raw strings so dates are parsed by our own (UK/US aware) parser
    const wb = XLSX.read(buf, { type: 'array', raw: text, cellDates: false, dense: false });
    return fromWorkbook(wb);
  }

  /** Workbook (already parsed by SheetJS) -> [{name, rows}] */
  function fromWorkbook(wb) {
    return wb.SheetNames.map((name) => ({ name, rows: sheetToRows(wb.Sheets[name]) }));
  }

  /** Build the same structure from an in-memory array-of-arrays (used by the sample). */
  function fromRows(name, rows) {
    return [{ name, rows }];
  }

  RM.reader = { readFile, fromRows, fromWorkbook };
})(typeof window !== 'undefined' ? window : globalThis);
