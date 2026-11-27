/*
 * Parser unit tests (no browser needed):  node tests/parse.test.js
 */
const assert = require('assert');
global.window = global;
['js/core/util.js', 'js/core/mapping.js', 'js/adapters/registry.js', 'js/adapters/monday-board.js',
  'js/adapters/generic-table.js', 'samples/sample-data.js'].forEach((f) => require('../' + f));
const { util: U, adapters, mapping } = global.RM;
const iso = (d) => U.formatDay(d, 'iso');

// Dates
assert.strictEqual(iso(U.parseDate('2025-03-14')), '2025-03-14');
assert.strictEqual(iso(U.parseDate('03/04/2025', 'dmy')), '2025-04-03');
assert.strictEqual(iso(U.parseDate('03/04/2025', 'mdy')), '2025-03-04');
assert.strictEqual(iso(U.parseDate('25/12/2025', 'mdy')), '2025-12-25'); // unambiguous wins
assert.strictEqual(iso(U.parseDate('14 Mar 2025')), '2025-03-14');
assert.strictEqual(iso(U.parseDate('March 14, 2025')), '2025-03-14');
assert.strictEqual(iso(U.parseDate(45730)), '2025-03-14'); // Excel serial
assert.strictEqual(U.parseDate('31/02/2025'), null);
assert.strictEqual(U.parseDate('n/a'), null);

// Ranges
let r = U.parseRange('2025-01-06 - 2025-02-14');
assert.deepStrictEqual([iso(r.start), iso(r.end)], ['2025-01-06', '2025-02-14']);
r = U.parseRange('6 Jan 2025 to 14 Feb 2025');
assert.deepStrictEqual([iso(r.start), iso(r.end)], ['2025-01-06', '2025-02-14']);
r = U.parseRange('2025-01-06-2025-02-14');
assert.deepStrictEqual([iso(r.start), iso(r.end)], ['2025-01-06', '2025-02-14']);
r = U.parseRange('2025-05-01');
assert.strictEqual(r.start, r.end);

// monday.com board layout
const rows = global.RM.sample.rows(new Date(2026, 10, 15));
const det = adapters.detect(rows);
assert.strictEqual(det.adapter.id, 'monday-board');
const table = det.adapter.toTable(rows);
assert.strictEqual(table.meta.title, 'Digital Transformation Programme');
const m = mapping.autoMap(table, 'dmy');
assert.strictEqual(m.workstream, '__group');
assert.strictEqual(m.name, 'Name');
assert.strictEqual(m.timeline, 'Timeline');
assert.strictEqual(m.status, 'Status');
let model = mapping.buildModel(table, m, { singleDayMilestones: true });
assert.deepStrictEqual(model.workstreams.map((w) => w.name),
  ['Strategy & Governance', 'Platform Modernisation', 'Data & Analytics', 'Customer Experience', 'People & Change']);
assert.strictEqual(model.stats.used, 21);
assert.strictEqual(model.stats.milestones, 5);
assert.strictEqual(model.stats.undated, 1);
assert.strictEqual(model.stats.subitems, 2);
model = mapping.buildModel(table, m, { singleDayMilestones: true, includeSubitems: true });
assert.strictEqual(model.stats.used, 23);
const sub = model.workstreams[1].items.find((i) => i.name === 'Data cleanse');
assert.ok(sub && sub.isSub && sub.parent === 'Legacy CRM migration');

// Flat table with Group / Start / End / Type columns
const flat = [
  ['Task', 'Workstream', 'Start', 'Finish', 'Type'],
  ['Design', 'Alpha', '01/02/2025', '28/02/2025', 'Task'],
  ['Build', 'Alpha', '01/03/2025', '30/04/2025', ''],
  ['Gate 1', 'Beta', '15/03/2025', '', 'Milestone'],
];
const d2 = adapters.detect(flat);
assert.strictEqual(d2.adapter.id, 'generic-table');
const t2 = d2.adapter.toTable(flat);
const m2 = mapping.autoMap(t2, 'dmy');
assert.deepStrictEqual([m2.name, m2.workstream, m2.start, m2.end], ['Task', 'Workstream', 'Start', 'Finish']);
const mod2 = mapping.buildModel(t2, m2, { datePref: 'dmy' });
assert.strictEqual(mod2.workstreams.length, 2);
assert.strictEqual(iso(mod2.workstreams[0].items[0].start), '2025-02-01');
assert.ok(mod2.workstreams[1].items[0].milestone);

// Real monday.com export (Timeline - Start / Timeline - End as Excel serials, subitem blocks, group summary row)
global.XLSX = require('../vendor/xlsx.full.min.js');
global.FileReader = undefined;
const fs = require('fs');
const wb = XLSX.read(fs.readFileSync(__dirname + '/../samples/Example-Monday.com.xlsx'), { type: 'buffer' });
const exRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
const d3 = adapters.detect(exRows);
assert.strictEqual(d3.adapter.id, 'monday-board');
const t3 = d3.adapter.toTable(exRows);
const m3 = mapping.autoMap(t3, 'dmy');
assert.deepStrictEqual([m3.workstream, m3.name, m3.start, m3.end, m3.date], ['__group', 'Name', 'Timeline - Start', 'Timeline - End', 'Date']);
let mod3 = mapping.buildModel(t3, m3, { singleDayMilestones: true });
assert.strictEqual(mod3.workstreams[0].name, 'Programme 001 Platform and Product 001');
const byName = (mod, n) => mod.workstreams[0].items.find((i) => i.name === n);
assert.ok(byName(mod3, 'Project 001').milestone, 'one-day item is a milestone');
['Project 002', 'Project 003', 'Project 004'].forEach((n) => assert.ok(!byName(mod3, n).milestone, n + ' is a bar'));
assert.strictEqual(iso(byName(mod3, 'Project 003').start), '2026-11-23');
assert.strictEqual(iso(byName(mod3, 'Project 003').end), '2026-12-02');
mod3 = mapping.buildModel(t3, m3, { singleDayMilestones: true, includeSubitems: true });
const conf = byName(mod3, 'Confirm Organisation 001 will be doing the build/tech work');
const p2 = mod3.workstreams[0].items.find((i) => i.name === 'Project 002');
assert.ok(conf.isSub && conf.milestone && conf.parentId === p2.id, 'subitem with only a Date is a milestone under its parent');
assert.ok(!byName(mod3, 'DPIA').milestone);

console.log('parse tests OK');
