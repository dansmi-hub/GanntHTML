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
  /* Persistence (settings only — never file contents)                 */
  /* ---------------------------------------------------------------- */
  function loadStyle() {
    const base = RM.presets.apply('powerpoint', RM.presets.DEFAULT_STYLE);
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved) return U.deepMerge(base, saved);
    } catch (e) { /* ignore */ }
    return base;
  }
  let saveTimer = null;
  function saveStyle() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.style)); } catch (e) { /* ignore */ }
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
    saveStyle();
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
    renderDataPreview();
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

  function renderDataPreview() {
    const box = $('#tablePreview');
    box.innerHTML = '';
    if (!state.table || !state.table.rows.length) { box.textContent = 'No rows.'; return; }
    const used = new Set(Object.values(state.mapping).filter(Boolean));
    const cols = ['__group'].concat(state.table.columns).filter((c) => c !== '__group' || state.table.meta.groupsDetected);
    const tbl = document.createElement('table');
    const head = tbl.createTHead().insertRow();
    cols.forEach((c) => {
      const th = document.createElement('th');
      th.textContent = c === '__group' ? '(group)' : c;
      if (used.has(c)) th.className = 'mapped';
      head.appendChild(th);
    });
    const body = tbl.createTBody();
    state.table.rows.slice(0, 12).forEach((r) => {
      const tr = body.insertRow();
      if (r.__isSub) tr.className = 'sub';
      cols.forEach((c) => {
        const td = tr.insertCell();
        const v = r[c];
        td.textContent = v === null || v === undefined ? '' : String(v);
        if (used.has(c)) td.className = 'mapped';
      });
    });
    box.appendChild(tbl);
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
