/*
 * Styling presets and colour palettes.
 *
 * A preset is a partial style object merged over DEFAULT_STYLE. To add one,
 * call RM.presets.register({ id, label, description, style: {...} }) from a
 * new file and add it to index.html; it appears in the preset bar
 * automatically. "Custom" is special: it keeps whatever the user has set.
 */
(function (global) {
  'use strict';
  const RM = global.RM;

  const PALETTES = {
    executive: { label: 'Executive', colours: ['#1F4E79', '#21807A', '#6A4C93', '#C0532F', '#3A7CA5', '#5E7F31', '#9C4F6B', '#C9A227'] },
    muted: { label: 'Muted', colours: ['#4C6A92', '#557D5C', '#93624A', '#7462A3', '#3F7A80', '#7F6D3A', '#A26769', '#5E7189'] },
    vibrant: { label: 'Vibrant', colours: ['#0067C5', '#00845A', '#B86400', '#D62839', '#7B3F98', '#007FAA', '#C2185B', '#4E8418'] },
    ocean: { label: 'Ocean (monochrome)', colours: ['#0B3C5D', '#1D5F8A', '#2F7DB0', '#16486B', '#286E9C', '#0F4F78', '#3A6F94', '#245A80'] },
    slate: { label: 'Slate (greyscale)', colours: ['#2F3B4C', '#4A5568', '#5F6B7D', '#3C4858', '#556274', '#6B7789', '#435064', '#7A8597'] },
  };

  // Status → colour (used when "Colour bars by status" is on). Matches monday.com defaults loosely.
  const STATUS_COLOURS = [
    { rx: /done|complete|closed|delivered|finished/i, colour: '#2E8B57' },
    { rx: /stuck|blocked|at risk|red|overdue|late/i, colour: '#C8372D' },
    { rx: /working|progress|on track|ongoing|active|amber|doing/i, colour: '#E0A100' },
    { rx: /review|testing|qa/i, colour: '#6A4C93' },
    { rx: /not started|planned|to do|todo|backlog|future|green/i, colour: '#7A8699' },
  ];

  const DEFAULT_STYLE = {
    preset: 'powerpoint',
    canvas: {
      mode: 'slide',          // 'slide' (fixed 16:9) | 'auto' (height grows with content)
      width: 1920,            // px (slide mode always 1920x1080)
      titleSpace: 15,         // % of slide height kept free for the PowerPoint slide title
      showTitleGuide: true,   // dashed guide in the preview only, never exported
      showTitle: false,       // render a title inside the reserved space
      title: '',
      padding: 48,
      fit: true,              // shrink/grow rows so everything fits on the slide
    },
    fontFamily: 'Segoe UI, Helvetica Neue, Arial, sans-serif',
    fontSize: 15,
    rowHeight: 32,
    barThickness: 62,         // % of row height
    workstreamGap: 10,
    packing: 'compact',       // 'compact' | 'single'
    sortByStart: true,
    workstream: {
      style: 'band',          // 'band' (left column) | 'header' (row above)
      width: 230,
      fontSize: 15,
      stripes: true,
    },
    labels: {
      activities: true,
      position: 'auto',       // 'auto' | 'inside' | 'beside'
      dates: false,
      milestones: true,
      milestoneDates: true,
    },
    milestones: {
      show: true,
      placement: 'inline',    // 'inline' (in workstream) | 'top' (key milestones row)
      colour: '#1F2937',
      useWorkstreamColour: false,
      size: 16,
    },
    today: {
      show: true,
      colour: '#D9480F',
      date: '',               // '' = actual today
      label: true,
    },
    range: { mode: 'auto', start: '', end: '' }, // months, 'YYYY-MM'
    timescale: 'auto',        // 'auto' | 'weeks' | 'months' | 'quarters'
    colours: {
      palette: 'executive',
      byStatus: false,
      background: '#FFFFFF',
      text: '#1F2937',
      muted: '#6B7280',
      grid: '#E5E7EB',
      overrides: {},          // workstream name -> colour
    },
    hidden: {},               // workstream name -> true
    order: [],                // workstream names, user ordering
  };

  const list = [];
  function register(p) { list.push(p); }

  register({
    id: 'powerpoint',
    label: 'PowerPoint',
    description: '16:9 slide, space reserved for the title, compact rows that fit the slide.',
    style: {
      canvas: { mode: 'slide', titleSpace: 15, fit: true, padding: 48 },
      fontSize: 15, rowHeight: 32, barThickness: 62, workstreamGap: 10, packing: 'compact',
      workstream: { style: 'band', width: 230, fontSize: 15, stripes: true },
      labels: { activities: true, position: 'auto', dates: false, milestones: true, milestoneDates: true },
      milestones: { show: true, placement: 'inline', size: 16 },
      timescale: 'auto',
    },
  });

  register({
    id: 'detailed',
    label: 'Detailed',
    description: 'One activity per row with dates; height grows to show everything.',
    style: {
      canvas: { mode: 'auto', width: 1920, fit: false, padding: 40 },
      fontSize: 13, rowHeight: 28, barThickness: 60, workstreamGap: 16, packing: 'single',
      workstream: { style: 'band', width: 220, fontSize: 14, stripes: true },
      labels: { activities: true, position: 'auto', dates: true, milestones: true, milestoneDates: true },
      milestones: { show: true, placement: 'inline', size: 14 },
      timescale: 'auto',
    },
  });

  register({
    id: 'custom',
    label: 'Custom',
    description: 'Your own settings. Any change to a control switches to Custom.',
    style: null,
  });

  function all() { return list.slice(); }
  function get(id) { return list.find((p) => p.id === id); }

  /** Apply preset `id` on top of `current` (keeps colours/overrides/visibility). */
  function apply(id, current) {
    const U = RM.util;
    const p = get(id);
    const base = U.clone(current || DEFAULT_STYLE);
    if (p && p.style) U.deepMerge(base, U.clone(p.style));
    base.preset = id;
    return base;
  }

  RM.presets = { PALETTES, STATUS_COLOURS, DEFAULT_STYLE, register, all, get, apply };
})(window);
