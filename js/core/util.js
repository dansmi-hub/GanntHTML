/*
 * Roadmap Studio — shared utilities.
 * Everything hangs off a single global namespace (window.RM) so the app works
 * when index.html is opened straight from disk (file://), where ES modules are
 * blocked by browsers.
 */
(function (global) {
  'use strict';
  const RM = (global.RM = global.RM || {});

  /* ------------------------------------------------------------------ */
  /* Dates. Internally a date is an integer "day number": days since     */
  /* 1970-01-01 (UTC). This avoids time-zone and DST surprises entirely.  */
  /* ------------------------------------------------------------------ */
  const DAY_MS = 86400000;
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function dayFromYMD(y, m, d) {
    // m is 1-based
    if (!(y > 0 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    const ms = Date.UTC(y, m - 1, d);
    const back = new Date(ms);
    if (back.getUTCMonth() !== m - 1) return null; // e.g. 31 Feb
    return Math.round(ms / DAY_MS);
  }

  function ymd(day) {
    const dt = new Date(day * DAY_MS);
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), dow: dt.getUTCDay() };
  }

  function todayDay() {
    const n = new Date();
    return dayFromYMD(n.getFullYear(), n.getMonth() + 1, n.getDate());
  }

  function excelSerialToDay(serial) {
    // Excel day 25569 == 1970-01-01 (1900 date system, leap-year bug already baked in).
    return Math.floor(serial) - 25569;
  }

  function normYear(y) {
    y = +y;
    if (y < 100) y += y < 70 ? 2000 : 1900;
    return y;
  }

  function monthIndex(word) {
    const i = MONTHS.indexOf(String(word).slice(0, 3).toLowerCase());
    return i < 0 ? null : i + 1;
  }

  /**
   * Parse a single date value into a day number (or null).
   * @param {*} v       cell value (number, Date, string)
   * @param {string} pref 'dmy' or 'mdy' — used only for ambiguous numeric dates like 03/04/2025
   */
  function parseDate(v, pref) {
    if (v === null || v === undefined || v === '') return null;
    if (v instanceof Date) {
      if (isNaN(v)) return null;
      return dayFromYMD(v.getFullYear(), v.getMonth() + 1, v.getDate());
    }
    if (typeof v === 'number') {
      if (v > 20000 && v < 80000) return excelSerialToDay(v); // 1954 – 2119
      return null;
    }
    let s = String(v).trim();
    if (!s) return null;
    // "Monday, November 2, 2026" / "Mon 2 Nov 2026" -> drop the weekday
    s = s.replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i, '');
    let m;
    // ISO 2025-03-14 or 2025/03/14 (optionally followed by a time)
    if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[T\s])/))) {
      return dayFromYMD(+m[1], +m[2], +m[3]);
    }
    // 14/03/2025, 03-14-25, 14.03.2025
    if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:$|\s)/))) {
      let a = +m[1], b = +m[2];
      const y = normYear(m[3]);
      let dd, mm;
      if (a > 12) { dd = a; mm = b; }
      else if (b > 12) { dd = b; mm = a; }
      else if (pref === 'mdy') { mm = a; dd = b; }
      else { dd = a; mm = b; }
      return dayFromYMD(y, mm, dd);
    }
    // 14 Mar 2025 / 14-Mar-25 / 14th March 2025
    if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s\-/.]+([A-Za-z]{3,})\.?,?[\s\-/.]+(\d{2,4})/))) {
      const mm = monthIndex(m[2]);
      if (mm) return dayFromYMD(normYear(m[3]), mm, +m[1]);
    }
    // Mar 14, 2025 / March 14 2025
    if ((m = s.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})/))) {
      const mm = monthIndex(m[1]);
      if (mm) return dayFromYMD(normYear(m[3]), mm, +m[2]);
    }
    // Excel serial stored as text
    if (/^\d{5}(\.\d+)?$/.test(s)) return parseDate(+s, pref);
    return null;
  }

  /**
   * Parse a monday.com "Timeline" style range, e.g. "2025-01-06 - 2025-02-14".
   * Returns {start, end} or null.
   */
  function parseRange(v, pref) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number' || v instanceof Date) {
      const d = parseDate(v, pref);
      return d === null ? null : { start: d, end: d };
    }
    const s = String(v).trim();
    // Separators surrounded by whitespace (" - ", " – ", " to ")
    let parts = s.split(/\s+(?:-|–|—|to|until|→)\s+/i);
    if (parts.length !== 2) {
      // Two ISO dates glued together: 2025-01-06-2025-02-14 or 2025-01-06/2025-02-14
      const iso = s.match(/(\d{4}-\d{1,2}-\d{1,2}).+?(\d{4}-\d{1,2}-\d{1,2})/);
      if (iso) parts = [iso[1], iso[2]];
    }
    if (parts.length === 2) {
      const a = parseDate(parts[0], pref);
      let b = parseDate(parts[1], pref);
      if (a !== null && b === null) {
        // "Mar 3 - 14, 2025" style: borrow missing pieces from the first date
        b = parseDate(parts[1] + ' ' + ymd(a).y, pref);
      }
      if (a !== null && b !== null) return a <= b ? { start: a, end: b } : { start: b, end: a };
    }
    const single = parseDate(s, pref);
    return single === null ? null : { start: single, end: single };
  }

  function formatDay(day, style) {
    const { y, m, d } = ymd(day);
    if (style === 'iso') return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (style === 'month') return `${MONTH_LABELS[m - 1]} ${y}`;
    if (style === 'short') return `${d} ${MONTH_LABELS[m - 1]}`;
    return `${d} ${MONTH_LABELS[m - 1]} ${y}`;
  }

  function startOfMonth(day) { const { y, m } = ymd(day); return dayFromYMD(y, m, 1); }
  function addMonths(day, n) {
    const { y, m } = ymd(day);
    const t = (m - 1) + n;
    return dayFromYMD(y + Math.floor(t / 12), ((t % 12) + 12) % 12 + 1, 1);
  }
  function monthKey(day) { const { y, m } = ymd(day); return `${y}-${String(m).padStart(2, '0')}`; }
  function dayFromMonthKey(key) {
    const m = String(key || '').match(/^(\d{4})-(\d{2})/);
    return m ? dayFromYMD(+m[1], +m[2], 1) : null;
  }

  /* ------------------------------------------------------------------ */
  /* Colours                                                             */
  /* ------------------------------------------------------------------ */
  function hexToRgb(hex) {
    let h = String(hex || '').replace('#', '').trim();
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    if (isNaN(n) || h.length !== 6) return { r: 0, g: 0, b: 0 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgbToHex({ r, g, b }) {
    const c = (x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
    return '#' + c(r) + c(g) + c(b);
  }
  /** Mix colour a toward b by t (0..1). */
  function mix(a, b, t) {
    const A = hexToRgb(a), B = hexToRgb(b);
    return rgbToHex({ r: A.r + (B.r - A.r) * t, g: A.g + (B.g - A.g) * t, b: A.b + (B.b - A.b) * t });
  }
  function luminance(hex) {
    const { r, g, b } = hexToRgb(hex);
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  function contrastRatio(a, b) {
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  /** Pick whichever of the candidate text colours reads best on `bg`. */
  function readableOn(bg, dark, light) {
    dark = dark || '#1f2937';
    light = light || '#ffffff';
    return contrastRatio(bg, light) >= contrastRatio(bg, dark) ? light : dark;
  }

  /* ------------------------------------------------------------------ */
  /* Text measurement (canvas-based, matches the SVG font settings)      */
  /* ------------------------------------------------------------------ */
  let ctx = null;
  const cache = new Map();
  function textWidth(text, size, family, weight) {
    const key = `${weight || 400}|${size}|${family}|${text}`;
    let w = cache.get(key);
    if (w !== undefined) return w;
    if (!ctx) ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `${weight || 400} ${size}px ${family}`;
    w = ctx.measureText(String(text)).width;
    if (cache.size > 5000) cache.clear();
    cache.set(key, w);
    return w;
  }

  /** Greedy word wrap. Returns array of lines. */
  function wrapText(text, maxWidth, size, family, weight) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (!line || textWidth(test, size, family, weight) <= maxWidth) line = test;
      else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }

  function truncate(text, maxWidth, size, family, weight) {
    text = String(text);
    if (textWidth(text, size, family, weight) <= maxWidth) return text;
    let lo = 0, hi = text.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (textWidth(text.slice(0, mid) + '…', size, family, weight) <= maxWidth) lo = mid; else hi = mid - 1;
    }
    return lo > 0 ? text.slice(0, lo).trimEnd() + '…' : '';
  }

  /* ------------------------------------------------------------------ */
  /* Misc                                                                */
  /* ------------------------------------------------------------------ */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }
  function setPath(obj, path, value) {
    const keys = path.split('.');
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {};
      o = o[keys[i]];
    }
    o[keys[keys.length - 1]] = value;
  }
  function deepMerge(target, src) {
    for (const k of Object.keys(src || {})) {
      const v = src[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (!target[k] || typeof target[k] !== 'object') target[k] = {};
        deepMerge(target[k], v);
      } else target[k] = v;
    }
    return target;
  }
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';

  RM.util = {
    DAY_MS, MONTH_LABELS,
    dayFromYMD, ymd, todayDay, parseDate, parseRange, formatDay,
    startOfMonth, addMonths, monthKey, dayFromMonthKey,
    hexToRgb, rgbToHex, mix, luminance, contrastRatio, readableOn,
    textWidth, wrapText, truncate,
    esc, getPath, setPath, deepMerge, clone, clamp, isBlank,
  };
})(window);
