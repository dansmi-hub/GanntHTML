/*
 * Generates monday.com export variants used by tests/parse.test.js:
 *   node tests/make-fixtures.js
 * Each variant mimics a real-world difference seen in monday.com exports.
 */
const XLSX = require('../vendor/xlsx.full.min.js');
const path = require('path');
const out = path.join(__dirname, 'fixtures');
const S = (y, m, d) => (Date.UTC(y, m - 1, d) / 86400000) + 25569; // Excel serial

function save(name, sheets) {
  const wb = XLSX.utils.book_new();
  for (const [sheetName, rows, fmt] of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    if (fmt) Object.keys(ws).forEach((k) => { if (k[0] !== '!' && ws[k].t === 'n' && ws[k].v > 40000) ws[k].z = fmt; });
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }
  require('fs').writeFileSync(path.join(out, name), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

const H = ['Name', 'Subitems', 'Owner', 'Status', 'Priority', 'Timeline - Start', 'Timeline - End', 'Dependent On'];
const SH = ['Subitems', 'Name', 'Owner', 'Status', 'Date', 'Timeline - Start', 'Timeline - End'];

// 1. Several groups, Excel-saved (blank cells, date-formatted serials), summary rows
const multi = [
  ['Board 001'], ['Group Alpha'], H,
  ['Alpha one', 'a, b', null, 'Done', 'High', S(2026, 10, 5), S(2026, 10, 30)],
  SH,
  [null, 'a', 'P1', 'Done', null, S(2026, 10, 5), S(2026, 10, 12)],
  [null, 'b', 'P1', 'Done', null, S(2026, 10, 13), S(2026, 10, 30)],
  ['Alpha gate', null, null, 'Done', 'High', S(2026, 11, 2), S(2026, 11, 2)],
  [null, null, null, null, null, S(2026, 10, 5), S(2026, 11, 2)],
  [],
  ['Group Beta'], H,
  ['Beta build', null, null, 'Working on it', 'Medium', S(2026, 11, 9), S(2027, 1, 22)],
  ['Beta launch', null, null, 'To begin', 'High', S(2027, 1, 25), S(2027, 1, 25)],
  [null, null, null, null, null, S(2026, 11, 9), S(2027, 1, 25)],
];
save('multi-group-dateformat.xlsx', [['Board', multi, 'dd/mm/yyyy']]);

// 2. Item column renamed (monday lets you rename "Name"), single Timeline text column
save('renamed-name-timeline-text.xlsx', [['Sheet1', [
  ['Roadmap board'], ['Q1 Initiatives'],
  ['Initiative', 'Owner', 'Status', 'Timeline'],
  ['Discovery', 'X', 'Done', '2026-11-02 - 2026-11-20'],
  ['Pilot', 'Y', 'Working on it', '2026-11-23 - 2027-01-15'],
  ['Board approval', 'Z', 'To begin', '2027-01-20 - 2027-01-20'],
]]]);

// 3. Parents have no dates; only subitems are dated
save('dates-on-subitems-only.xlsx', [['Sheet1', [
  ['Board'], ['Delivery'], H,
  ['Project A', 'one, two', null, 'Working on it', 'High', null, null],
  SH,
  [null, 'one', null, 'Done', null, S(2026, 11, 2), S(2026, 11, 13)],
  [null, 'two', null, 'To begin', S(2026, 12, 1), null, null],
  ['Project B', 'three', null, 'To begin', 'High', null, null],
  SH,
  [null, 'three', null, 'To begin', null, S(2026, 12, 7), S(2027, 1, 8)],
]]]);

// 4. Cover sheet first, data on the second sheet; data starts in column B; dates as text with weekdays
save('cover-sheet-offset-text-dates.xlsx', [
  ['Info', [['Exported from monday.com'], ['Board: Something'], ['Date: today']]],
  ['Items', [
    [], [null, 'Big Board'], [null, 'Workstream One'],
    [null, 'Name', 'Status', 'Timeline - Start', 'Timeline - End'],
    [null, 'Thing one', 'Done', 'Monday, November 2, 2026', 'Friday, November 27, 2026'],
    [null, 'Thing two', 'Done', 'Nov 30, 2026', 'Dec 18, 2026'],
    [null, 'Go live', 'Done', 'Jan 4, 2027', 'Jan 4, 2027'],
  ]],
]);

// 5. CSV export (plain text) with ISO dates
const csv = [
  ['Board 9'], ['Group X'], ['Name', 'Person', 'Status', 'Timeline - Start', 'Timeline - End'],
  ['Item 1', 'A', 'Done', '2026-11-02', '2026-11-30'], ['Item 2', 'B', 'Stuck', '2026-12-01', '2026-12-01'],
  [], ['Group Y'], ['Name', 'Person', 'Status', 'Timeline - Start', 'Timeline - End'],
  ['Item 3', 'C', 'Done', '2026-12-07', '2027-02-26'],
].map((r) => r.join(',')).join('\n');
require('fs').writeFileSync(path.join(out, 'board-export.csv'), csv);
console.log('fixtures written to', out);
