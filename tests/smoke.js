/*
 * Headless smoke test (optional, for development).
 *   node tests/smoke.js [outDir]
 * Requires Playwright (preinstalled in many CI images, or `npm i -g playwright`).
 * Opens index.html from disk, loads each sample, renders every preset,
 * exports PNG + SVG, and fails if the page attempts any network request.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const root = path.resolve(__dirname, '..');
  const out = path.resolve(process.argv[2] || path.join(root, 'tests', 'output'));
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const errors = [];
  const network = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) network.push(r.url()); });

  await page.goto('file://' + path.join(root, 'index.html'));
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));

  const shot = async (name) => {
    await page.waitForTimeout(150);
    await page.locator('#preview svg').screenshot({ path: path.join(out, name + '.png') });
  };
  const preset = async (label) => { await page.click(`#presetBar button:has-text("${label}")`); };

  // 1. Built-in sample
  await page.click('#btnSample2');
  await preset('PowerPoint'); await shot('sample-powerpoint');
  await preset('Detailed'); await shot('sample-detailed');

  // 2. monday.com xlsx export
  await page.setInputFiles('#fileInput', path.join(root, 'samples', 'monday-board-export-sample.xlsx'));
  await page.waitForFunction(() => window.RM.app.state.model && window.RM.app.state.fileName.endsWith('.xlsx'));
  await preset('PowerPoint'); await shot('xlsx-powerpoint');
  const info1 = await page.textContent('#fileInfo');

  // Header-style workstreams, key milestones row, status colours
  await page.selectOption('[data-bind="workstream.style"]', 'header');
  await page.selectOption('[data-bind="milestones.placement"]', 'top');
  await page.check('[data-bind="colours.byStatus"]');
  await shot('xlsx-custom-header-status');
  const pressed = await page.textContent('#presetBar button[aria-pressed="true"]');

  // 3. Flat CSV with Group / Start / End columns in UK format
  await page.setInputFiles('#fileInput', path.join(root, 'samples', 'flat-list-sample.csv'));
  await page.waitForFunction(() => window.RM.app.state.fileName.endsWith('.csv'));
  await preset('PowerPoint');
  await page.selectOption('[data-bind="workstream.style"]', 'band');
  await page.uncheck('[data-bind="colours.byStatus"]');
  await page.selectOption('[data-bind="milestones.placement"]', 'inline');
  await shot('csv-custom');
  const info2 = await page.textContent('#fileInfo');
  const mapping = await page.evaluate(() => window.RM.app.state.mapping);

  // 4. Real monday.com export with Timeline - Start / End columns and subitems
  await page.setInputFiles('#fileInput', path.join(root, 'samples', 'Example-Monday.com.xlsx'));
  await page.waitForFunction(() => window.RM.app.state.fileName === 'Example-Monday.com.xlsx');
  await preset('PowerPoint'); await shot('example-powerpoint');
  await page.selectOption('#subitemsMode', 'always'); await shot('example-with-subitems');
  await preset('Detailed'); await shot('example-detailed');
  const exInfo = await page.textContent('#fileInfo');
  console.log('example info:', exInfo.replace(/\s+/g, ' '));
  await page.selectOption('#subitemsMode', 'auto');

  // 5. Dates only on subitems (parents undated) -> parents drawn as summary bars
  await page.setInputFiles('#fileInput', path.join(root, 'tests', 'fixtures', 'dates-on-subitems-only.xlsx'));
  await page.waitForFunction(() => window.RM.app.state.fileName === 'dates-on-subitems-only.xlsx');
  await shot('subitems-only');
  if (!(await page.isVisible('#preview svg'))) { console.error('subitems-only fixture did not render'); process.exitCode = 1; }

  // 6. A file with no dates -> diagnostics card instead of a blank page
  await page.setInputFiles('#fileInput', { name: 'no-dates.csv', mimeType: 'text/csv', buffer: Buffer.from('Name,Status\nA,Done\nB,Stuck\n') });
  await page.waitForFunction(() => window.RM.app.state.fileName === 'no-dates.csv');
  await page.waitForTimeout(150);
  if (!(await page.isVisible('#diag'))) { console.error('diagnostics card not shown'); process.exitCode = 1; }
  console.log('diagnostics:', (await page.textContent('#diagText')).split('\n')[2]);

  await page.setInputFiles('#fileInput', path.join(root, 'samples', 'flat-list-sample.csv'));
  await page.waitForFunction(() => window.RM.app.state.fileName.endsWith('.csv'));

  // Exports
  const [png] = await Promise.all([page.waitForEvent('download'), page.click('#btnPng')]);
  await png.saveAs(path.join(out, 'export.png'));
  const [svg] = await Promise.all([page.waitForEvent('download'), page.click('#btnSvg')]);
  await svg.saveAs(path.join(out, 'export.svg'));
  const svgText = fs.readFileSync(path.join(out, 'export.svg'), 'utf8');

  await page.screenshot({ path: path.join(out, 'app.png') });
  await browser.close();

  console.log('xlsx info:', info1.replace(/\s+/g, ' '));
  console.log('csv info :', info2.replace(/\s+/g, ' '));
  console.log('csv mapping:', JSON.stringify(mapping));
  console.log('preset after tweak:', pressed);
  console.log('png:', png.suggestedFilename(), fs.statSync(path.join(out, 'export.png')).size, 'bytes');
  console.log('svg:', svg.suggestedFilename(), svgText.length, 'chars, guide present:', svgText.includes('rm-guide'));
  if (errors.length) { console.error('ERRORS:', errors); process.exitCode = 1; }
  if (network.length) { console.error('NETWORK REQUESTS:', network); process.exitCode = 1; }
  if (pressed.trim() !== 'Custom') { console.error('Preset did not switch to Custom'); process.exitCode = 1; }
  if (!process.exitCode) console.log('SMOKE OK');
})();
