/*
 * Roadmap renderer: model + style -> SVG string.
 *
 * Pure function of its inputs (no DOM writes), so the same output is used for
 * the on-screen preview and for PNG/SVG export. Text is measured with a canvas
 * so label placement decisions (inside vs beside the bar) match what is drawn.
 */
(function (global) {
  'use strict';
  const RM = global.RM;
  const U = RM.util;

  /* ------------------------------------------------------------------ */
  /* Time scale                                                          */
  /* ------------------------------------------------------------------ */
  function resolveRange(model, style) {
    let start = null, end = null;
    if (style.range.mode === 'custom') {
      start = U.dayFromMonthKey(style.range.start);
      const e = U.dayFromMonthKey(style.range.end);
      end = e !== null ? U.addMonths(e, 1) : null;
    }
    if (start === null) start = model.minDay !== null ? U.startOfMonth(model.minDay) : U.startOfMonth(U.todayDay());
    if (end === null) end = model.maxDay !== null ? U.addMonths(U.startOfMonth(model.maxDay), 1) : U.addMonths(start, 6);
    if (end <= start) end = U.addMonths(start, 1);
    return { start, end };
  }

  function monthsBetween(a, b) {
    const A = U.ymd(a), B = U.ymd(b);
    return (B.y - A.y) * 12 + (B.m - A.m);
  }

  /** Build header tiers: [{cells:[{start,end,labels:[long, short, tiny]}]}] (top tier first) */
  function buildTiers(range, timescale) {
    const months = monthsBetween(range.start, range.end);
    let scale = timescale;
    if (scale === 'auto') scale = months <= 3 ? 'weeks' : months <= 30 ? 'months' : 'quarters';

    const monthCells = [];
    for (let d = range.start; d < range.end; d = U.addMonths(d, 1)) {
      const { y, m } = U.ymd(d);
      const name = U.MONTH_LABELS[m - 1];
      monthCells.push({ start: d, end: Math.min(U.addMonths(d, 1), range.end), labels: [name, name[0]], long: `${name} ${y}` });
    }
    const quarterCells = [];
    const yearCells = [];
    for (const c of monthCells) {
      const { y, m } = U.ymd(c.start);
      const q = Math.floor((m - 1) / 3) + 1;
      const qk = `${y}-${q}`;
      const lastQ = quarterCells[quarterCells.length - 1];
      if (lastQ && lastQ.key === qk) lastQ.end = c.end;
      else quarterCells.push({ key: qk, start: c.start, end: c.end, labels: [`Q${q} ${y}`, `Q${q} '${String(y).slice(2)}`, `Q${q}`] });
      const lastY = yearCells[yearCells.length - 1];
      if (lastY && lastY.key === y) lastY.end = c.end;
      else yearCells.push({ key: y, start: c.start, end: c.end, labels: [String(y), `'${String(y).slice(2)}`] });
    }

    if (scale === 'weeks') {
      const weekCells = [];
      let d = range.start;
      // first boundary: next Monday (dow 1)
      const dow = U.ymd(d).dow;
      let next = d + ((8 - dow) % 7 || 7);
      while (d < range.end) {
        const e = Math.min(next, range.end);
        const { d: dd } = U.ymd(d);
        weekCells.push({ start: d, end: e, labels: [String(dd)] });
        d = e; next = d + 7;
      }
      return { scale, tiers: [monthCells.map((c) => ({ ...c, labels: [c.long, c.labels[0], c.labels[1]] })), weekCells] };
    }
    if (scale === 'quarters') {
      return { scale, tiers: [yearCells, quarterCells.map((c) => ({ ...c, labels: [`Q${c.key.split('-')[1]}`] }))] };
    }
    return { scale, tiers: [months <= 18 ? quarterCells : yearCells, monthCells] };
  }

  /* ------------------------------------------------------------------ */
  /* Layout                                                              */
  /* ------------------------------------------------------------------ */
  function colourFor(ws, i, style) {
    const ov = style.colours.overrides && style.colours.overrides[ws];
    if (ov) return ov;
    const pal = (RM.presets.PALETTES[style.colours.palette] || RM.presets.PALETTES.executive).colours;
    return pal[i % pal.length];
  }

  function statusColour(status) {
    if (!status) return null;
    const hit = RM.presets.STATUS_COLOURS.find((s) => s.rx.test(status));
    return hit ? hit.colour : null;
  }

  function orderedWorkstreams(model, style) {
    const names = model.workstreams.map((w) => w.name);
    const order = (style.order || []).filter((n) => names.includes(n));
    names.forEach((n) => { if (!order.includes(n)) order.push(n); });
    return order.map((n) => model.workstreams.find((w) => w.name === n));
  }

  function itemLabel(it, style) {
    if (it.milestone) {
      return style.labels.milestoneDates ? `${it.name} (${U.formatDay(it.start, 'short')})` : it.name;
    }
    if (!style.labels.dates) return it.name;
    const a = U.formatDay(it.start, 'short'), b = U.formatDay(it.end, 'short');
    return a === b ? `${it.name} · ${a}` : `${it.name} · ${a} – ${b}`;
  }

  /**
   * Horizontal geometry for every item at a given font size, then pack into lanes.
   * Returns lanes count; mutates item.g with geometry.
   */
  function layoutItems(items, ctx) {
    const { xOf, x0, x1, fs, family, style } = ctx;
    const gap = Math.max(4, fs * 0.45);
    const pad = Math.max(4, fs * 0.5);
    for (const it of items) {
      const g = (it.g = {});
      const showLabel = it.milestone ? style.labels.milestones : style.labels.activities;
      const text = showLabel ? itemLabel(it, style) : '';
      const tw = text ? U.textWidth(text, fs, family, 500) : 0;
      if (it.milestone) {
        const s = ctx.msSize;
        const cx = xOf(it.start + 0.5);
        g.cx = cx; g.size = s;
        g.left = cx - s / 2; g.right = cx + s / 2;
        if (text) {
          if (cx + s / 2 + gap + tw <= x1 || cx - s / 2 - gap - tw < x0) {
            g.label = { text, x: cx + s / 2 + gap, anchor: 'start', inside: false };
            g.right = cx + s / 2 + gap + tw;
            if (g.right > x1) { g.label.text = U.truncate(text, x1 - g.label.x, fs, family, 500); g.right = x1; }
          } else {
            g.label = { text, x: cx - s / 2 - gap, anchor: 'end', inside: false };
            g.left = cx - s / 2 - gap - tw;
          }
        }
        continue;
      }
      let xs = xOf(Math.max(it.start, ctx.range.start));
      let xe = xOf(Math.min(it.end + 1, ctx.range.end));
      if (xe - xs < 3) { const mid = (xs + xe) / 2; xs = mid - 1.5; xe = mid + 1.5; }
      g.x = xs; g.w = xe - xs; g.left = xs; g.right = xe;
      if (!text) continue;
      const fitsInside = tw + pad * 2 <= g.w;
      const pos = style.labels.position;
      if (pos === 'inside' || (pos === 'auto' && fitsInside)) {
        const t = fitsInside ? text : U.truncate(text, g.w - pad * 2, fs, family, 500);
        if (t) g.label = { text: t, x: xs + pad, anchor: 'start', inside: true };
        continue;
      }
      // Beside the bar: right if there is room, otherwise left, otherwise the roomier side (truncated)
      const roomR = x1 - (xe + gap), roomL = xs - gap - x0;
      if (tw <= roomR) {
        g.label = { text, x: xe + gap, anchor: 'start', inside: false };
        g.right = xe + gap + tw;
      } else if (tw <= roomL) {
        g.label = { text, x: xs - gap, anchor: 'end', inside: false };
        g.left = xs - gap - tw;
      } else if (g.w - pad * 2 > Math.max(roomR, roomL)) {
        const t = U.truncate(text, g.w - pad * 2, fs, family, 500);
        if (t) g.label = { text: t, x: xs + pad, anchor: 'start', inside: true };
      } else if (roomR >= roomL) {
        g.label = { text: U.truncate(text, roomR, fs, family, 500), x: xe + gap, anchor: 'start', inside: false };
        g.right = x1;
      } else {
        g.label = { text: U.truncate(text, roomL, fs, family, 500), x: xs - gap, anchor: 'end', inside: false };
        g.left = x0;
      }
    }

    // Lane packing
    const laneRight = [];
    const sep = fs * 0.9;
    items.forEach((it, idx) => {
      let lane;
      if (style.packing === 'single') lane = idx;
      else {
        lane = laneRight.findIndex((r) => r + sep <= it.g.left);
        if (lane < 0) lane = laneRight.length;
      }
      laneRight[lane] = Math.max(laneRight[lane] || -Infinity, it.g.right);
      it.g.lane = lane;
    });
    return Math.max(1, laneRight.length);
  }

  function computeLayout(model, style, fs, rowH) {
    const slide = style.canvas.mode === 'slide';
    const family = style.fontFamily;
    const W = slide ? 1920 : Math.max(800, +style.canvas.width || 1920);
    const P = style.canvas.padding;
    const band = style.workstream.style === 'band';
    const bandW = band ? style.workstream.width : 0;
    const x0 = P + (band ? bandW + 14 : 0);
    const x1 = W - P;
    const range = resolveRange(model, style);
    const span = range.end - range.start;
    const xOf = (d) => x0 + ((d - range.start) / span) * (x1 - x0);

    const showTitle = style.canvas.showTitle && style.canvas.title;
    const titleH = slide
      ? Math.round(1080 * (style.canvas.titleSpace / 100))
      : showTitle ? Math.round(fs * 4.2) : 0;
    const todayLabelH = style.today.show && style.today.label ? Math.round(fs * 1.7) : 0;
    const yHeader = (slide ? titleH : P + titleH) + todayLabelH;
    const tierH = Math.round(fs * 1.9);
    const headerH = tierH * 2;
    const yBody = yHeader + headerH + Math.round(fs * 0.6);

    const ctx = { xOf, x0, x1, fs, family, style, range, msSize: Math.min(style.milestones.size * (fs / 15), rowH * 0.78) };

    // Collect visible workstreams and items within range
    const inRange = (it) => it.end >= range.start && it.start < range.end;
    const blocks = [];
    const wsList = orderedWorkstreams(model, style);
    const keyMilestones = [];
    wsList.forEach((ws, i) => {
      if (style.hidden[ws.name]) return;
      const colour = colourFor(ws.name, model.workstreams.indexOf(ws), style);
      let items = ws.items.filter(inRange).filter((it) => !it.milestone || style.milestones.show);
      if (style.milestones.show && style.milestones.placement === 'top') {
        items.filter((it) => it.milestone).forEach((it) => keyMilestones.push({ ...it, wsColour: colour }));
        items = items.filter((it) => !it.milestone);
      }
      items = items.map((it) => ({ ...it, wsColour: colour }));
      if (style.sortByStart) items.sort((a, b) => a.start - b.start || a.end - b.end);
      blocks.push({ name: ws.name, colour, items });
    });
    if (keyMilestones.length) {
      keyMilestones.sort((a, b) => a.start - b.start);
      blocks.unshift({ name: 'Key milestones', colour: style.milestones.colour, items: keyMilestones, isKey: true });
    }

    const wsFs = style.workstream.fontSize * (fs / style.fontSize);
    const innerPad = rowH * 0.18;
    const headerRowH = band ? 0 : Math.round(wsFs * 2.1);
    let y = yBody;
    for (const b of blocks) {
      b.lanes = b.items.length ? layoutItems(b.items, ctx) : 1;
      let h = b.lanes * rowH + innerPad * 2;
      if (band) {
        b.titleLines = U.wrapText(b.name, bandW - 20, wsFs, family, 600);
        const needed = b.titleLines.length * wsFs * 1.22 + 14;
        h = Math.max(h, needed);
      }
      b.y = y;
      b.headerH = headerRowH;
      b.h = h + headerRowH;
      y += b.h + style.workstreamGap;
    }
    const bodyBottom = blocks.length ? y - style.workstreamGap : yBody + rowH;
    const legendH = style.colours.byStatus ? Math.round(fs * 2.2) : 0;
    const H = slide ? 1080 : Math.ceil(bodyBottom + legendH + P);
    const availBottom = slide ? 1080 - Math.max(24, P * 0.7) - legendH : Infinity;

    return {
      W, H, P, slide, family, fs, rowH, wsFs, band, bandW, x0, x1, xOf, range,
      titleH, showTitle, yHeader, tierH, headerH, yBody, bodyBottom, legendH,
      todayLabelH, availBottom, innerPad, blocks, msSize: ctx.msSize,
      overflow: bodyBottom - availBottom,
      // Height that scales with rowH (lanes + padding), used for fitting
      laneUnits: blocks.reduce((s, b) => s + b.lanes, 0) + blocks.length * 0.36,
    };
  }

  /** Lay out, auto-fitting to the slide when requested. */
  function layout(model, style) {
    let fs = style.fontSize, rowH = style.rowHeight;
    let L = computeLayout(model, style, fs, rowH);
    if (!(L.slide && style.canvas.fit) || !L.blocks.length) return L;

    for (let k = 0; k < 10; k++) {
      const fixed = (L.bodyBottom - L.yBody) - L.laneUnits * rowH; // gaps, headers, wrapped-title minimums
      const avail = L.availBottom - L.yBody;
      let ideal = (avail - fixed) / L.laneUnits;
      const maxRow = style.rowHeight * 1.7; // fill the slide, bars are capped separately
      const minRow = fs * 1.45;
      if (ideal >= minRow) {
        rowH = Math.min(ideal, maxRow);
        L = computeLayout(model, style, fs, rowH);
        if (L.overflow <= 0.5) return L;
        // Band titles may have forced extra height; shrink slightly and retry
        rowH *= 0.96;
        L = computeLayout(model, style, fs, rowH);
        if (L.overflow <= 0.5) return L;
      } else {
        if (fs <= 9) { rowH = minRow; L = computeLayout(model, style, fs, rowH); break; }
        fs = Math.max(9, fs * 0.92);
        rowH = Math.max(fs * 1.45, Math.min(rowH, ideal));
        L = computeLayout(model, style, fs, rowH);
      }
    }
    return L;
  }

  /* ------------------------------------------------------------------ */
  /* SVG output                                                          */
  /* ------------------------------------------------------------------ */
  const f1 = (n) => (Math.round(n * 10) / 10).toString();

  function text(x, y, str, attrs) {
    const a = Object.entries(attrs || {}).map(([k, v]) => `${k}="${U.esc(v)}"`).join(' ');
    return `<text x="${f1(x)}" y="${f1(y)}" ${a}>${U.esc(str)}</text>`;
  }

  function render(model, style, opts) {
    opts = opts || {};
    const L = layout(model, style);
    const C = style.colours;
    const bg = C.background;
    // Text on the page background: use the chosen colour unless it would be unreadable
    const ink = U.contrastRatio(C.text, bg) >= 3 ? C.text : U.readableOn(bg);
    const muted = U.contrastRatio(C.muted, bg) >= 2.5 ? C.muted : ink;
    const grid = C.grid;
    const { W, H, fs, family } = L;
    const out = [];
    const warnings = [];
    const base = (s) => s + fs * 0.35; // baseline for vertically-centred text

    out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${U.esc(family)}">`);
    out.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);

    // Title area
    if (L.slide && L.titleH > 0 && style.canvas.showTitleGuide && !opts.forExport) {
      out.push(`<g class="rm-guide"><rect x="12" y="12" width="${W - 24}" height="${L.titleH - 24}" fill="none" stroke="#9CA3AF" stroke-dasharray="8 6" rx="6"/>`);
      if (!L.showTitle) out.push(text(W / 2, L.titleH / 2 + 6, 'Space reserved for slide title (guide not exported)', { 'font-size': 18, fill: '#9CA3AF', 'text-anchor': 'middle' }));
      out.push('</g>');
    }
    if (L.showTitle) {
      const tfs = Math.round(Math.min(44, Math.max(fs * 2, (L.titleH || fs * 4) * 0.34)));
      const ty = L.slide ? L.titleH * 0.5 + tfs * 0.35 : L.P + L.titleH * 0.45 + tfs * 0.35;
      out.push(text(L.P, ty, style.canvas.title, { 'font-size': tfs, 'font-weight': 600, fill: ink }));
    }

    // Timeline header
    const { tiers } = buildTiers(L.range, style.timescale);
    const tierFs = [fs * 0.95, fs * 0.9];
    const tierW = [600, 500];
    tiers.forEach((cells, t) => {
      const ty = L.yHeader + t * L.tierH;
      for (const c of cells) {
        const xa = L.xOf(c.start), xb = L.xOf(c.end);
        const w = xb - xa;
        const label = c.labels.find((l) => U.textWidth(l, tierFs[t], family, tierW[t]) <= w - 6);
        if (label) out.push(text((xa + xb) / 2, base(ty + L.tierH / 2), label, { 'font-size': f1(tierFs[t]), 'font-weight': tierW[t], fill: t === 0 ? ink : muted, 'text-anchor': 'middle' }));
        if (c.start !== L.range.start) out.push(`<line x1="${f1(xa)}" y1="${f1(ty + (t === 0 ? 4 : 6))}" x2="${f1(xa)}" y2="${f1(ty + L.tierH - (t === 0 ? 2 : 6))}" stroke="${grid}" stroke-width="1"/>`);
      }
    });
    out.push(`<line x1="${f1(L.x0)}" y1="${f1(L.yHeader + L.tierH)}" x2="${f1(L.x1)}" y2="${f1(L.yHeader + L.tierH)}" stroke="${grid}" stroke-width="1"/>`);
    out.push(`<line x1="${f1(L.x0)}" y1="${f1(L.yHeader + L.headerH)}" x2="${f1(L.x1)}" y2="${f1(L.yHeader + L.headerH)}" stroke="${U.mix(grid, ink, 0.25)}" stroke-width="1.2"/>`);

    // Workstream backgrounds
    for (const b of L.blocks) {
      const tint = U.mix(b.colour, bg, b.isKey ? 0.95 : 0.92);
      if (style.workstream.stripes) {
        out.push(`<rect x="${f1(L.band ? L.x0 - 6 : L.x0)}" y="${f1(b.y)}" width="${f1(L.x1 - L.x0 + (L.band ? 6 : 0))}" height="${f1(b.h)}" fill="${tint}" rx="4"/>`);
      } else {
        out.push(`<line x1="${f1(L.x0)}" y1="${f1(b.y + b.h + style.workstreamGap / 2)}" x2="${f1(L.x1)}" y2="${f1(b.y + b.h + style.workstreamGap / 2)}" stroke="${grid}"/>`);
      }
      if (L.band) {
        const bx = L.P, bw = L.bandW;
        const fill = b.isKey ? U.mix(b.colour, bg, 0.82) : b.colour;
        const tc = U.readableOn(fill, '#111827', '#FFFFFF');
        out.push(`<rect x="${f1(bx)}" y="${f1(b.y)}" width="${f1(bw)}" height="${f1(b.h)}" fill="${fill}" rx="6"/>`);
        const lh = L.wsFs * 1.22;
        let lines = b.titleLines;
        const maxLines = Math.max(1, Math.floor((b.h - 8) / lh));
        if (lines.length > maxLines) {
          lines = lines.slice(0, maxLines);
          lines[maxLines - 1] = U.truncate(lines[maxLines - 1] + '…', bw - 20, L.wsFs, family, 600);
        }
        const cy = b.y + b.h / 2 - ((lines.length - 1) * lh) / 2;
        lines.forEach((ln, k) => out.push(text(bx + bw / 2, cy + k * lh + L.wsFs * 0.35, ln, { 'font-size': f1(L.wsFs), 'font-weight': 600, fill: tc, 'text-anchor': 'middle' })));
      } else {
        // Centred heading row above the workstream's activities
        const hy = b.y + b.headerH / 2 + 2;
        const col = U.contrastRatio(b.colour, bg) >= 3 ? b.colour : ink;
        const tw = U.textWidth(b.name, L.wsFs, family, 600);
        const cx = (L.x0 + L.x1) / 2;
        const name = U.truncate(b.name, L.x1 - L.x0 - 40, L.wsFs, family, 600);
        out.push(text(cx, hy + L.wsFs * 0.35, name, { 'font-size': f1(L.wsFs), 'font-weight': 600, fill: col, 'text-anchor': 'middle' }));
        const half = Math.min(tw, L.x1 - L.x0 - 40) / 2 + 14;
        out.push(`<line x1="${f1(L.x0 + 10)}" y1="${f1(hy)}" x2="${f1(cx - half)}" y2="${f1(hy)}" stroke="${U.mix(b.colour, bg, 0.55)}" stroke-width="1.5"/>`);
        out.push(`<line x1="${f1(cx + half)}" y1="${f1(hy)}" x2="${f1(L.x1 - 10)}" y2="${f1(hy)}" stroke="${U.mix(b.colour, bg, 0.55)}" stroke-width="1.5"/>`);
      }
    }

    // Vertical gridlines over the body (bottom tier boundaries, stronger for top tier)
    const topStarts = new Set(tiers[0].map((c) => c.start));
    for (const c of tiers[1]) {
      if (c.start === L.range.start) continue;
      const x = L.xOf(c.start);
      const strong = topStarts.has(c.start);
      out.push(`<line x1="${f1(x)}" y1="${f1(L.yBody - 4)}" x2="${f1(x)}" y2="${f1(L.bodyBottom)}" stroke="${strong ? U.mix(grid, ink, 0.18) : grid}" stroke-width="${strong ? 1.2 : 0.8}" ${strong ? '' : 'stroke-dasharray="3 4"'}/>`);
    }

    // Today marker (under bars so it never hides labels)
    let todayD = style.today.date ? U.parseDate(style.today.date, 'dmy') : U.todayDay();
    if (style.today.show && todayD !== null && todayD >= L.range.start && todayD < L.range.end) {
      const x = L.xOf(todayD + 0.5);
      const tc = style.today.colour;
      out.push(`<line x1="${f1(x)}" y1="${f1(L.yHeader)}" x2="${f1(x)}" y2="${f1(L.bodyBottom + 4)}" stroke="${tc}" stroke-width="2" stroke-dasharray="6 4"/>`);
      if (style.today.label) {
        const label = 'Today';
        const lfs = fs * 0.8;
        const tw = U.textWidth(label, lfs, family, 600) + 14;
        const ph = lfs * 1.5;
        const px = U.clamp(x - tw / 2, L.x0, L.x1 - tw);
        const py = L.yHeader - ph - 3;
        out.push(`<rect x="${f1(px)}" y="${f1(py)}" width="${f1(tw)}" height="${f1(ph)}" rx="${f1(ph / 2)}" fill="${tc}"/>`);
        out.push(text(px + tw / 2, py + ph / 2 + lfs * 0.35, label, { 'font-size': f1(lfs), 'font-weight': 600, fill: U.readableOn(tc), 'text-anchor': 'middle' }));
      }
    } else if (style.today.show && todayD !== null) {
      warnings.push('Today marker is outside the selected date range.');
    }

    // Activities and milestones
    const barFrac = U.clamp(style.barThickness / 100, 0.2, 0.95);
    const lfs = fs;
    const legend = new Map();
    for (const b of L.blocks) {
      const top = b.y + b.headerH + L.innerPad;
      // Vertically centre the lanes inside the block (block may be taller because of a wrapped title)
      const lanesH = b.lanes * L.rowH;
      const offset = (b.h - b.headerH - L.innerPad * 2 - lanesH) / 2;
      for (const it of b.items) {
        const g = it.g;
        const cy = top + offset + g.lane * L.rowH + L.rowH / 2;
        let colour = it.wsColour;
        if (style.colours.byStatus && !it.milestone) {
          const sc = statusColour(it.status);
          if (sc) { colour = sc; legend.set(it.status.replace(/\s+/g, ' '), sc); }
        }
        if (it.isSub) colour = U.mix(colour, bg, 0.3);

        if (it.milestone) {
          let mc = style.milestones.useWorkstreamColour ? it.wsColour : style.milestones.colour;
          if (U.contrastRatio(mc, bg) < 2) mc = ink; // never let a diamond vanish into the background
          const s = g.size / 2;
          out.push(`<path d="M${f1(g.cx)} ${f1(cy - s)} L${f1(g.cx + s)} ${f1(cy)} L${f1(g.cx)} ${f1(cy + s)} L${f1(g.cx - s)} ${f1(cy)} Z" fill="${mc}" stroke="${bg}" stroke-width="1.5"/>`);
          if (g.label) out.push(text(g.label.x, base(cy), g.label.text, { 'font-size': f1(lfs), 'font-weight': 500, fill: ink, 'text-anchor': g.label.anchor }));
          continue;
        }

        // Cap bar thickness so auto-fit's taller rows add breathing space, not chunky bars
        const bh = Math.max(4, Math.min(L.rowH * barFrac, style.rowHeight * barFrac * 1.25, fs * 2.2));
        const r = Math.min(bh / 2, Math.max(2, bh * 0.28));
        out.push(`<rect x="${f1(g.x)}" y="${f1(cy - bh / 2)}" width="${f1(g.w)}" height="${f1(bh)}" rx="${f1(r)}" fill="${colour}"/>`);
        if (g.label) {
          // Inside: contrast against the bar. Outside: page ink colour, never white-on-white.
          const fill = g.label.inside ? U.readableOn(colour, '#111827', '#FFFFFF') : ink;
          out.push(text(g.label.x, base(cy), g.label.text, { 'font-size': f1(lfs), 'font-weight': 500, fill, 'text-anchor': g.label.anchor }));
        }
      }
    }

    // Status legend
    if (style.colours.byStatus && legend.size) {
      const lfs2 = fs * 0.85;
      let x = L.x1;
      const y = L.slide ? 1080 - L.legendH * 0.5 - Math.max(12, L.P * 0.35) : L.bodyBottom + L.legendH * 0.6;
      const entries = Array.from(legend.entries()).reverse();
      for (const [name, col] of entries) {
        const tw = U.textWidth(name, lfs2, family, 400);
        x -= tw;
        out.push(text(x, y + lfs2 * 0.35, name, { 'font-size': f1(lfs2), fill: muted }));
        x -= lfs2 + 6;
        out.push(`<rect x="${f1(x)}" y="${f1(y - lfs2 / 2)}" width="${f1(lfs2)}" height="${f1(lfs2)}" rx="3" fill="${col}"/>`);
        x -= 18;
      }
    }

    out.push('</svg>');

    if (L.slide && L.overflow > 1) warnings.push('Content is taller than the slide. Try hiding workstreams, compact packing, or a smaller font.');
    if (!L.blocks.length) warnings.push('Nothing to show: all workstreams are hidden or no dated activities were found.');

    return { svg: out.join(''), width: W, height: H, layout: { fontSize: L.fs, rowHeight: L.rowH }, warnings };
  }

  RM.render = { render, resolveRange, colourFor, orderedWorkstreams };
})(window);
