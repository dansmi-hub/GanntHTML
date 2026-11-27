/*
 * Roadmap Studio — UI wiring.
 * Connects the controls to the style object, loads files, and re-renders.
 */
(function (global) {
  'use strict';
  const RM = global.RM;
  const U = RM.util;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const STORAGE_KEY = 'roadmap-studio.style.v1';
  // Validation for saved settings (declared before state, which loads them)
  const HEX = /^#[0-9a-f]{6}$/i;
  const SAFE_TEXT = /^[\w\s,.:#-]*$/; // no quotes, angle brackets or ampersands

  const ROLE_LABELS = {
    workstream: 'Workstream', name: 'Activity', timeline: 'Timeline',
    start: 'Start date', end: 'End date', date: 'Single date', milestone: 'Milestone flag', status: 'Status',
  };

  // Paths that are "content" rather than layout: changing them does not flip the preset to Custom
  const KEEP_PRESET = ['canvas.title', 'canvas.showTitle', 'canvas.showTitleGuide', 'colours.', 'today.', 'range.', 'groups.'];

  const state = {
    sheets: null,
    sheetIndex: 0,
    fileName: '',
    adapterId: 'auto',
    table: null,
    mapping: null,
    model: null,
    dataOpts: { datePref: 'dmy', singleDayMilestones: true, subitems: 'auto' },
    style: loadStyle(),
  };

  /* ---------------------------------------------------------------- */
  /* Persistence: layout/colour preferences only. Anything derived from  */
  /* the file (title, workstream names, their order/visibility/colours)  */
  /* is never written to browser storage.                                */
  /* ---------------------------------------------------------------- */
  /**
   * Accept only keys that exist in the defaults, with the same type. Colours must be
   * #rrggbb and other strings plain text, so tampered storage (e.g. written by another
   * app on the same host) can't inject markup into the SVG.
   */
  function sanitize(saved, def) {
    const out = {};
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return out;
    for (const k of Object.keys(def)) {
      if (!Object.prototype.hasOwnProperty.call(saved, k)) continue;
      const d = def[k], v = saved[k];
      if (d && typeof d === 'object' && !Array.isArray(d)) out[k] = sanitize(v, d);
      else if (typeof d === 'number') { if (typeof v === 'number' && isFinite(v)) out[k] = v; }
      else if (typeof d === 'boolean') { if (typeof v === 'boolean') out[k] = v; }
      else if (typeof d === 'string' && typeof v === 'string' && v.length <= 120) {
        if (HEX.test(d) ? HEX.test(v) : SAFE_TEXT.test(v)) out[k] = v;
      }
    }
    return out;
  }

  function persistable(style) {
    const s = U.clone(style);
    delete s.order;
    delete s.hidden;
    if (s.canvas) delete s.canvas.title;
    if (s.colours) delete s.colours.overrides;
    return s;
  }

  function loadStyle() {
    const base = RM.presets.apply('powerpoint', RM.presets.DEFAULT_STYLE);
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved) return U.deepMerge(base, sanitize(persistable(saved), RM.presets.DEFAULT_STYLE));
    } catch (e) { /* ignore */ }
    return base;
  }
  let saveTimer = null;
  function saveStyle() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable(state.style))); } catch (e) { /* ignore */ }
    }, 300);
  }

  /* ---------------------------------------------------------------- */
  /* Rendering                                                         */
  /* ---------------------------------------------------------------- */
  let raf = 0;
  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; renderNow(); });
  }

  function renderNow() {
    const has = !!(state.model && state.model.workstreams.length);
    const failed = !!(state.model && !has);
    $('#empty').hidden = has || failed;
    $('#diag').hidden = !failed;
    $('#preview').hidden = !has;
    ['#btnPng', '#btnSvg', '#btnCopy'].forEach((s) => { $(s).disabled = !has; });
    const warn = [];
    if (failed) renderDiagnostics();
    if (has) {
      const r = RM.render.render(state.model, state.style);
      $('#preview').innerHTML = r.svg;
      warn.push(...r.warnings);
      const fit = $('#fitInfo');
      if (state.style.canvas.mode === 'slide' && state.style.canvas.fit) {
        fit.textContent = `Auto-fit in use: ${Math.round(r.layout.fontSize * 10) / 10}px text, ${Math.round(r.layout.rowHeight)}px rows.`;
      } else fit.textContent = '';
    }
    const w = $('#warnings');
    w.hidden = !warn.length;
    w.textContent = warn.join(' ');
    $('#roadmapToolbar').hidden = !has;
    if (has) {
      const st = state.model.stats;
      const shown = state.model.workstreams.filter((ws) => !state.style.hidden[ws.name]).length;
      $('#statusLine').textContent = `${state.fileName} · ${shown} of ${state.model.workstreams.length} workstreams · ${st.used} items (${st.milestones} milestones)`;
      applyZoom();
    }
    updateDataCount();
    dataDirty = true;
    if (activeTab === 'data') renderDataTable();
    saveStyle();
  }

  /* ---------------------------------------------------------------- */
  /* Tabs, zoom and help                                               */
  /* ---------------------------------------------------------------- */
  let activeTab = 'roadmap';
  let dataDirty = true;

  function showTab(tab) {
    activeTab = tab;
    $$('.mainTabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    $$('[data-tabpane]').forEach((p) => { p.hidden = p.dataset.tabpane !== tab; });
    if (tab === 'data' && dataDirty) renderDataTable();
  }

  function showSidePane(pane) {
    $$('.sideTabs [data-side]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.side === pane)));
    $$('.sidePane').forEach((p) => { p.hidden = p.dataset.pane !== pane; });
  }

  function openHelp(id) {
    showTab('help');
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ block: 'start' });
      el.classList.remove('flash');
      void el.offsetWidth; // restart the highlight animation
      el.classList.add('flash');
    }
  }

  function applyZoom() {
    const pv = $('#preview');
    const z = $('#zoom').value;
    const svg = pv.querySelector('svg');
    if (!svg) return;
    if (z === 'fit') { pv.classList.remove('zoomed'); pv.style.width = ''; }
    else { pv.classList.add('zoomed'); pv.style.width = `${Math.round(svg.viewBox.baseVal.width * Number(z))}px`; }
  }

  function initTabs() {
    $$('.mainTabs [data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
    $$('[data-goto-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.gotoTab)));
    $$('.sideTabs [data-side]').forEach((b) => b.addEventListener('click', () => showSidePane(b.dataset.side)));
    $$('.helpLink').forEach((b) => b.addEventListener('click', (e) => {
      e.preventDefault(); // don't toggle the section it sits in
      e.stopPropagation();
      openHelp(b.dataset.help);
    }));
    $$('.helpToc a').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); openHelp(a.getAttribute('href').slice(1)); }));
    $('#zoom').addEventListener('change', applyZoom);
    $('#btnOpen').addEventListener('click', () => $('#fileInput').click());
  }

  /* ---------------------------------------------------------------- */
  /* Loaded data tab: every row and what happened to it                */
  /* ---------------------------------------------------------------- */
  const STATUS_LABEL = {
    bar: 'Bar', milestone: 'Milestone', summary: 'Summary', 'no-dates': 'No dates',
    'sub-hidden': 'Subitem hidden', 'ws-hidden': 'Workstream hidden', 'out-of-range': 'Outside date range',
  };
  const STATUS_TIP = {
    bar: 'Drawn as an activity bar',
    milestone: 'Drawn as a milestone (start and end on the same day)',
    summary: 'Has no dates of its own; drawn as a summary bar across its subitems',
    'no-dates': 'No readable date in the mapped date columns, so it is not drawn',
    'sub-hidden': 'A subitem hidden by the Subitems setting (Data setup)',
    'ws-hidden': 'Its workstream is hidden (Design → Workstreams)',
    'out-of-range': 'Outside the custom date range (Design → Date range)',
  };

  function wsNameOf(row) {
    const m = state.mapping;
    if (!m.workstream) return 'All activities';
    const v = m.workstream === '__group' ? row.__group : row[m.workstream];
    return U.isBlank(v) ? 'Other' : String(v).trim();
  }

  function rowEntries() {
    const t = state.table, model = state.model;
    if (!t || !model) return [];
    const range = RM.render.resolveRange(model, state.style);
    const custom = state.style.range.mode === 'custom';
    const out = [];
    t.rows.forEach((row, i) => {
      const o = model.outcomes[i] || { status: 'no-name' };
      if (o.status === 'no-name') return; // blank/summary rows from the export
      let key = o.status;
      if (o.item) {
        key = o.status === 'summary' ? 'summary' : (o.item.milestone ? 'milestone' : 'bar');
        const ws = wsNameOf(row);
        if (state.style.hidden[ws]) key = 'ws-hidden';
        else if (custom && (o.item.end < range.start || o.item.start >= range.end)) key = 'out-of-range';
      }
      out.push({ row, key, item: o.item || null, onChart: ['bar', 'milestone', 'summary'].includes(key) });
    });
    return out;
  }

  function updateDataCount() {
    const n = state.model ? state.model.outcomes.filter((o) => o && o.status !== 'no-name').length : 0;
    $('#dataCount').textContent = n ? String(n) : '';
  }

  function renderDataTable() {
    dataDirty = false;
    const has = !!state.table;
    $('#dataEmpty').hidden = has;
    $('#dataView').hidden = !has;
    if (!has) return;
    const m = state.mapping;
    const all = rowEntries();
    const q = $('#dataSearch').value.trim().toLowerCase();
    const filter = $('#dataFilter').value;
    const rows = all.filter((e) => {
      if (filter === 'plotted' && !e.onChart) return false;
      if (filter === 'milestone' && e.key !== 'milestone') return false;
      if (filter === 'skipped' && e.onChart) return false;
      if (filter === 'sub' && !e.row.__isSub) return false;
      if (q && !Object.keys(e.row).some((k) => !k.startsWith('__') && e.row[k] != null && String(e.row[k]).toLowerCase().includes(q)) && !String(e.row.__group || '').toLowerCase().includes(q)) return false;
      return true;
    });
    const on = all.filter((e) => e.onChart).length;
    $('#dataSummary').textContent = `${rows.length} of ${all.length} rows shown · ${on} on the roadmap · ${all.length - on} not`;

    const mapped = new Set(Object.values(m).filter((v) => v && v !== '__group'));
    const rawCols = $('#dataAllCols').checked ? state.table.columns : state.table.columns.filter((c) => mapped.has(c) && c !== m.name);
    const tbl = document.createElement('table');
    const hr = tbl.createTHead().insertRow();
    const th = (txt, cls, tip) => { const c = document.createElement('th'); c.textContent = txt; if (cls) c.className = cls; if (tip) c.title = tip; hr.appendChild(c); };
    th('Status'); th('Workstream'); th('Activity', 'mapped', `Column: ${m.name || '(none)'}`); th('Start', 'derived', 'Start date as read by the app'); th('End', 'derived', 'End date as read by the app');
    rawCols.forEach((c) => th(c, mapped.has(c) ? 'mapped' : '', mapped.has(c) ? 'Used for the chart' : 'Not used for the chart'));
    const body = tbl.createTBody();
    const LIMIT = 2000;
    rows.slice(0, LIMIT).forEach((e) => {
      const tr = body.insertRow();
      if (e.row.__isSub) tr.className = 'sub';
      const chip = document.createElement('span');
      chip.className = `chip ${e.onChart ? e.key : 'skipped'}`;
      chip.textContent = STATUS_LABEL[e.key] || e.key;
      chip.title = STATUS_TIP[e.key] || '';
      tr.insertCell().appendChild(chip);
      tr.insertCell().textContent = wsNameOf(e.row);
      const name = tr.insertCell();
      name.className = 'name';
      name.textContent = (e.row.__isSub ? '↳ ' : '') + String(e.row[m.name] ?? '');
      tr.insertCell().textContent = e.item ? U.formatDay(e.item.start) : '';
      tr.insertCell().textContent = e.item ? U.formatDay(e.item.end) : '';
      rawCols.forEach((c) => {
        const td = tr.insertCell();
        const v = e.row[c];
        td.textContent = v === null || v === undefined ? '' : String(v);
        if (mapped.has(c)) td.className = 'mapped';
      });
    });
    const box = $('#dataTable');
    box.innerHTML = '';
    box.appendChild(tbl);
    if (rows.length > LIMIT) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = `Showing the first ${LIMIT} rows. Use search or the filter to narrow down.`;
      box.appendChild(p);
    }
  }

  function initDataTab() {
    $('#dataSearch').addEventListener('input', renderDataTable);
    $('#dataFilter').addEventListener('change', renderDataTable);
    $('#dataAllCols').addEventListener('change', renderDataTable);
  }

  /* Short explanations shown when hovering a control */
  const TIPS = {
    'canvas.mode': 'Fixed 16:9 slide, or a chosen width with the height growing to fit',
    'canvas.width': 'Image width in pixels (Auto height canvas only)',
    'canvas.titleSpace': 'Share of the slide height kept empty at the top for the PowerPoint title',
    'canvas.fit': 'Grow or shrink rows (and text if needed) so everything fits the slide',
    'canvas.showTitleGuide': 'Dashed box showing the title space; never included in exports',
    'canvas.showTitle': 'Write a title into the image itself',
    'canvas.title': 'Title text written into the image',
    fontFamily: 'Font for all chart text; pick the one your slides use',
    fontSize: 'Base text size for activity labels and the timeline',
    rowHeight: 'Height of each row',
    barThickness: 'How much of the row height a bar fills',
    workstreamGap: 'Space between workstreams',
    'canvas.padding': 'Empty border around the chart',
    packing: 'Compact lets activities share a row when they do not overlap',
    sortByStart: 'Order activities by start date (off keeps the file order)',
    'workstream.style': 'How workstream names are shown',
    'workstream.width': 'Width of the coloured name band',
    'workstream.fontSize': 'Text size of workstream names',
    'workstream.stripes': 'Light tint of each workstream colour behind its rows',
    'groups.summaryLine': 'Thin line on a parent row spanning all its subitems',
    'groups.style': 'How a parent and its subitems are visually grouped',
    'range.mode': 'Fit the dates in the data, or choose the months shown',
    'range.start': 'First month shown',
    'range.end': 'Last month shown',
    timescale: 'Column headings across the top: weeks, months or quarters',
    'labels.activities': 'Show names on or beside bars',
    'labels.position': 'Auto puts the name inside the bar when it fits, otherwise beside it',
    'labels.dates': 'Add start and end dates to activity labels',
    'labels.milestones': 'Show milestone names',
    'labels.milestoneDates': 'Add the date to milestone labels',
    'milestones.show': 'Draw one-day items as diamonds',
    'milestones.placement': 'Within each workstream, or a Key milestones row at the top',
    'milestones.size': 'Diamond size',
    'milestones.useWorkstreamColour': 'Colour each diamond with its workstream colour',
    'milestones.colour': 'Colour for all milestone diamonds',
    'today.show': 'Dashed line at today (or the override date)',
    'today.label': 'Small "Today" tag above the line',
    'today.colour': 'Colour of the today line',
    'today.date': 'Show the marker on a different date, e.g. a reporting date',
    'colours.palette': 'Set of workstream colours',
    'colours.byStatus': 'Colour bars by the Status column and add a legend',
    'colours.background': 'Image background colour',
    'colours.text': 'Main text colour',
    'colours.muted': 'Colour for timeline headings and legend text',
    'colours.grid': 'Colour of the vertical gridlines',
  };
  function applyTips() {
    $$('[data-bind]').forEach((el) => {
      const tip = TIPS[el.dataset.bind];
      if (tip) (el.closest('label') || el).title = tip;
    });
    const byId = {
      sheetSelect: 'Which sheet of the workbook to use',
      adapterSelect: 'How to read the sheet: monday.com board layout, or a plain table',
      datePref: 'How to read dates such as 03/04/2026',
      singleDayMs: 'Items that start and end on the same day become milestones',
      subitemsMode: 'Auto shows subitems only where the parent has no dates',
      pngScale: 'PNG size multiplier (3× = 5760×3240 for a slide)',
      btnPng: 'Download a high-resolution PNG',
      btnSvg: 'Download a scalable SVG (insert into PowerPoint, or convert to shapes)',
    };
    Object.entries(byId).forEach(([id, tip]) => { const el = document.getElementById(id); if (el) (el.closest('label') || el).title = tip; });
  }

  /* ---------------------------------------------------------------- */
  /* Controls                                                          */
  /* ---------------------------------------------------------------- */
  function controlValue(el) {
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'range' || el.type === 'number') return el.value === '' ? 0 : Number(el.value);
    return el.value;
  }

  function onControl(el) {
    const path = el.dataset.bind;
    const v = controlValue(el);
    U.setPath(state.style, path, v);
    if (path === 'range.mode' && v === 'custom' && state.model) {
      const r = RM.render.resolveRange(state.model, Object.assign({}, state.style, { range: { mode: 'auto' } }));
      if (!state.style.range.start) state.style.range.start = U.monthKey(r.start);
      if (!state.style.range.end) state.style.range.end = U.monthKey(r.end - 1);
      syncControls();
    }
    if (!KEEP_PRESET.some((p) => path.startsWith(p)) && state.style.preset !== 'custom') {
      state.style.preset = 'custom';
      updatePresetBar();
    }
    updateOutputs();
    updateShows();
    schedule();
  }

  function bindControls() {
    $$('[data-bind]').forEach((el) => {
      const evt = el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input';
      el.addEventListener(evt, () => onControl(el));
    });
  }

  function syncControls() {
    $$('[data-bind]').forEach((el) => {
      const v = U.getPath(state.style, el.dataset.bind);
      if (el.type === 'checkbox') el.checked = !!v;
      else if (el.type === 'color') el.value = /^#[0-9a-f]{6}$/i.test(v) ? v : '#000000';
      else el.value = v === undefined || v === null ? '' : v;
    });
    updateOutputs();
    updateShows();
    updatePresetBar();
  }

  function updateOutputs() {
    $$('label.range').forEach((l) => {
      const i = l.querySelector('input'), o = l.querySelector('output');
      if (i && o) o.textContent = i.value + (o.dataset.unit || '');
    });
  }

  function updateShows() {
    $$('[data-show]').forEach((el) => {
      const [path, val] = el.dataset.show.split('=');
      el.hidden = String(U.getPath(state.style, path)) !== val;
    });
  }

  function initPresetBar() {
    const bar = $('#presetBar');
    RM.presets.all().forEach((p) => {
      const b = document.createElement('button');
      b.textContent = p.label;
      b.title = p.description;
      b.dataset.preset = p.id;
      b.addEventListener('click', () => {
        if (p.id === 'custom') state.style.preset = 'custom';
        else state.style = RM.presets.apply(p.id, state.style);
        syncControls();
        schedule();
      });
      bar.appendChild(b);
    });
  }
  function updatePresetBar() {
    $$('#presetBar button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.preset === state.style.preset)));
  }

  function initPalettes() {
    const sel = $('#paletteSelect');
    Object.entries(RM.presets.PALETTES).forEach(([id, p]) => {
      const o = document.createElement('option');
      o.value = id; o.textContent = p.label;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => renderWsList());
  }

  /* ---------------------------------------------------------------- */
  /* Workstream list                                                   */
  /* ---------------------------------------------------------------- */
  function renderWsList() {
    const box = $('#wsList');
    box.innerHTML = '';
    if (!state.model || !state.model.workstreams.length) {
      box.innerHTML = '<p class="hint">Load data to show, hide, reorder and recolour workstreams.</p>';
      return;
    }
    const list = RM.render.orderedWorkstreams(state.model, state.style);
    state.style.order = list.map((w) => w.name);
    list.forEach((ws, idx) => {
      const row = document.createElement('div');
      row.className = 'ws' + (state.style.hidden[ws.name] ? ' off' : '');

      const vis = document.createElement('input');
      vis.type = 'checkbox';
      vis.checked = !state.style.hidden[ws.name];
      vis.title = 'Show / hide';
      vis.addEventListener('change', () => {
        if (vis.checked) delete state.style.hidden[ws.name]; else state.style.hidden[ws.name] = true;
        row.classList.toggle('off', !vis.checked);
        schedule();
      });

      const col = document.createElement('input');
      col.type = 'color';
      col.value = RM.render.colourFor(ws.name, state.model.workstreams.indexOf(ws), state.style);
      col.title = 'Workstream colour';
      col.addEventListener('input', () => { state.style.colours.overrides[ws.name] = col.value; schedule(); });

      const name = document.createElement('div');
      name.className = 'name';
      name.title = ws.name;
      name.textContent = ws.name;
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = `(${ws.items.length})`;
      name.appendChild(count);

      const moves = document.createElement('div');
      moves.className = 'moves';
      [['▲', -1, 'Move up'], ['▼', 1, 'Move down']].forEach(([t, d, title]) => {
        const b = document.createElement('button');
        b.textContent = t; b.title = title;
        b.disabled = (d < 0 && idx === 0) || (d > 0 && idx === list.length - 1);
        b.addEventListener('click', () => {
          const o = state.style.order;
          const j = idx + d;
          [o[idx], o[j]] = [o[j], o[idx]];
          renderWsList();
          schedule();
        });
        moves.appendChild(b);
      });

      row.append(vis, col, name, moves);
      box.appendChild(row);
    });
  }

  /* ---------------------------------------------------------------- */
  /* Data loading                                                      */
  /* ---------------------------------------------------------------- */
  async function handleFile(file) {
    if (!file) return;
    try {
      toast(`Reading ${file.name}…`);
      const sheets = await RM.reader.readFile(file);
      loadSheets(sheets, file.name);
    } catch (e) {
      console.error(e);
      toast('Could not read that file: ' + (e.message || e), 5000);
    }
  }

  function loadSheets(sheets, fileName) {
    state.sheets = sheets;
    state.fileName = fileName;
    state.adapterId = 'auto';
    // Try every sheet x format and keep whichever plots the most
    const best = RM.loader.analyse(sheets, state.dataOpts);
    state.sheetIndex = best.sheetIndex;

    const ss = $('#sheetSelect');
    ss.innerHTML = '';
    sheets.forEach((s, i) => { const o = document.createElement('option'); o.value = i; o.textContent = s.name; ss.appendChild(o); });
    ss.value = String(best.sheetIndex);
    ss.closest('label').hidden = sheets.length < 2;
    $('#dataControls').hidden = false;
    applyAnalysis(best, true);
  }

  /** Re-run detection after the user picks a different sheet or format. */
  function loadSheet() {
    const best = RM.loader.analyse(state.sheets, state.dataOpts, { sheetIndex: state.sheetIndex, adapterId: state.adapterId });
    applyAnalysis(best, false);
  }

  function applyAnalysis(best, isNewFile) {
    if (isNewFile && activeTab === 'help') showTab('roadmap');
    state.detectedAdapter = best.adapterId;
    state.table = best.table;
    state.mapping = best.mapping;
    state.style.order = [];
    if (isNewFile) {
      if (state.table.meta.title && !state.style.canvas.title) state.style.canvas.title = state.table.meta.title;
      syncControls();
    }
    renderAdapterSelect();
    renderMapping();
    rebuildModel();
  }

  function rebuildModel() {
    state.model = RM.mapping.buildModel(state.table, state.mapping, state.dataOpts);
    renderWsList();
    renderFileInfo();
    schedule();
  }

  /* ---------------------------------------------------------------- */
  /* Diagnostics: explain what was read when nothing could be plotted   */
  /* ---------------------------------------------------------------- */
  function diagnosticsText() {
    // Column titles and a few date samples only: no activity names or other content
    const t = state.table, m = state.mapping, s = state.model.stats;
    const sheet = state.sheets[state.sheetIndex];
    const lines = [
      `File type: ${(state.fileName.split('.').pop() || '').toLowerCase()} · sheets: ${state.sheets.length} · using "${sheet.name}" (${sheet.rows.length} rows)`,
      `Format: ${state.detectedAdapter} · groups found: ${t.meta.groupsDetected ? 'yes' : 'no'} · data rows: ${t.rows.length} (${s.subitems} subitems)`,
      `Columns: ${t.columns.join(' | ') || '(none found)'}`,
      `Mapping: ${RM.mapping.ROLES.map((r) => `${ROLE_LABELS[r]}=${m[r] || '—'}`).join(', ')}`,
    ];
    ['timeline', 'start', 'end', 'date'].forEach((role) => {
      const col = m[role];
      if (!col) return;
      const vals = t.rows.map((r) => r[col]).filter((v) => !U.isBlank(v)).slice(0, 3);
      lines.push(`${ROLE_LABELS[role]} samples: ${vals.length ? vals.map((v) => `${JSON.stringify(v)} (${typeof v})`).join(', ') : '(all empty)'}`);
    });
    return lines.join('\n');
  }

  function renderDiagnostics() {
    const t = state.table, m = state.mapping;
    const reasons = [];
    if (!t.rows.length) reasons.push('No table was found in the file. Check it is the board export rather than a summary or chart.');
    else if (!m.name) reasons.push('No activity name column was recognised. Pick it under <em>Activity</em> in the Data panel.');
    else if (!m.timeline && !m.start && !m.end && !m.date) reasons.push('No date or timeline column was recognised. Pick the date columns in the Data panel.');
    else reasons.push('Date columns were found, but none of the items had dates that could be read. Check the date columns in the Data panel, or switch <em>Subitems</em> to <em>Always show</em> if the dates are on subitems.');
    $('#diagReason').innerHTML = reasons.join('<br>');
    $('#diagText').textContent = diagnosticsText();
  }

  function renderAdapterSelect() {
    const sel = $('#adapterSelect');
    sel.innerHTML = '';
    const det = RM.adapters.get(state.detectedAdapter);
    const auto = document.createElement('option');
    auto.value = 'auto';
    auto.textContent = `Auto-detect (${det ? det.label : '—'})`;
    sel.appendChild(auto);
    RM.adapters.all().forEach((a) => { const o = document.createElement('option'); o.value = a.id; o.textContent = a.label; sel.appendChild(o); });
    sel.value = state.adapterId;
  }

  function renderMapping() {
    const box = $('#mapping');
    box.innerHTML = '';
    RM.mapping.ROLES.forEach((role) => {
      const lab = document.createElement('span');
      lab.textContent = ROLE_LABELS[role];
      const sel = document.createElement('select');
      const opts = [['', '(none)']];
      if (role === 'workstream' && state.table.meta.groupsDetected) opts.push(['__group', 'monday.com group']);
      state.table.columns.forEach((c) => opts.push([c, c]));
      opts.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); });
      sel.value = state.mapping[role] || '';
      sel.addEventListener('change', () => { state.mapping[role] = sel.value; state.style.order = []; rebuildModel(); });
      box.append(lab, sel);
    });
  }

  function renderFileInfo() {
    const s = state.model.stats;
    const info = $('#fileInfo');
    info.hidden = false;
    const parts = [
      `<strong>${U.esc(state.fileName)}</strong>`,
      `${state.model.workstreams.length} workstreams · ${s.used} items plotted (${s.milestones} milestones)`,
    ];
    if (s.undated) parts.push(`${s.undated} item${s.undated > 1 ? 's' : ''} skipped (no dates)`);
    if (s.subitems) {
      parts.push(`${s.subitems} subitems: ${s.subitemsShown} shown${s.subitemsHidden ? `, ${s.subitemsHidden} hidden (see Subitems below)` : ''}`);
    }
    if (s.rollups) parts.push(`${s.rollups} undated item${s.rollups > 1 ? 's' : ''} drawn as a summary of ${s.rollups > 1 ? 'their' : 'its'} subitems`);
    if (state.model.minDay !== null) parts.push(`${U.formatDay(state.model.minDay)} → ${U.formatDay(state.model.maxDay)}`);
    info.innerHTML = parts.join('<br>');
  }

  function initData() {
    const input = $('#fileInput');
    const dz = $('#dropzone');
    dz.addEventListener('click', () => input.click());
    dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', () => { handleFile(input.files[0]); input.value = ''; });

    // Whole-window drag & drop
    const overlay = $('#dropOverlay');
    let depth = 0;
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; overlay.hidden = false; dz.classList.add('over'); });
    window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) { overlay.hidden = true; dz.classList.remove('over'); } });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0; overlay.hidden = true; dz.classList.remove('over');
      handleFile(e.dataTransfer.files[0]);
    });

    const sample = () => loadSheets(RM.reader.fromRows('Sample', RM.sample.rows()), 'Sample programme (monday.com format)');
    $('#btnSample').addEventListener('click', sample);
    $('#btnSample2').addEventListener('click', sample);

    $('#sheetSelect').addEventListener('change', (e) => { state.sheetIndex = +e.target.value; loadSheet(); });
    $('#adapterSelect').addEventListener('change', (e) => { state.adapterId = e.target.value; loadSheet(); });
    $('#datePref').addEventListener('change', (e) => { state.dataOpts.datePref = e.target.value; if (state.table) rebuildModel(); });
    $('#singleDayMs').addEventListener('change', (e) => { state.dataOpts.singleDayMilestones = e.target.checked; if (state.table) rebuildModel(); });
    $('#subitemsMode').addEventListener('change', (e) => { state.dataOpts.subitems = e.target.value; if (state.table) rebuildModel(); });
  }

  /* ---------------------------------------------------------------- */
  /* Export                                                            */
  /* ---------------------------------------------------------------- */
  function exportName(ext) {
    const base = (state.style.canvas.title || state.fileName || 'roadmap')
      .replace(/\.[a-z0-9]+$/i, '').replace(/[^a-z0-9\-_ ]+/gi, '').trim().replace(/\s+/g, '-').toLowerCase() || 'roadmap';
    return `${base}-${state.style.preset}.${ext}`;
  }

  function initExport() {
    const final = () => RM.render.render(state.model, state.style, { forExport: true });
    $('#btnSvg').addEventListener('click', () => {
      const r = final();
      RM.exporter.exportSVG(r.svg, exportName('svg'));
    });
    $('#btnPng').addEventListener('click', async () => {
      const r = final();
      const scale = +$('#pngScale').value;
      try {
        await RM.exporter.exportPNG(r.svg, r.width, r.height, scale, exportName('png'));
        toast(`PNG exported at ${r.width * scale}×${r.height * scale}px`);
      } catch (e) { toast('PNG export failed: ' + e.message, 5000); }
    });
    $('#btnCopy').addEventListener('click', async () => {
      const r = final();
      try {
        await RM.exporter.copyPNG(r.svg, r.width, r.height, +$('#pngScale').value);
        toast('Copied — paste into PowerPoint');
      } catch (e) { toast('Copy failed: ' + e.message + '. Use Export PNG instead.', 5000); }
    });
  }

  /* ---------------------------------------------------------------- */
  /* Misc                                                              */
  /* ---------------------------------------------------------------- */
  let toastTimer = null;
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms || 2200);
  }

  function initReset() {
    $('#btnReset').addEventListener('click', () => {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
      const title = state.style.canvas.title;
      state.style = RM.presets.apply('powerpoint', RM.presets.DEFAULT_STYLE);
      state.style.canvas.title = title;
      syncControls();
      renderWsList();
      schedule();
    });
    $('#btnResetColours').addEventListener('click', () => {
      state.style.colours.overrides = {};
      renderWsList();
      schedule();
    });
  }

  function init() {
    initPresetBar();
    initPalettes();
    bindControls();
    syncControls();
    initData();
    initExport();
    initReset();
    initTabs();
    initDataTab();
    applyTips();
    $('#btnCopyDiag').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText($('#diagText').textContent); toast('Copied'); }
      catch (e) { toast('Select the text and copy it manually', 4000); }
    });
    renderNow();
  }

  // Expose for debugging / automated tests
  RM.app = { state, loadSheets, renderNow };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
