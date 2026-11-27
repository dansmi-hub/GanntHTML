/*
 * Built-in sample in monday.com board-export layout (group title rows,
 * repeated header rows, "Timeline" ranges, a subitem block).
 * Dates are relative to the current month so the today marker is visible.
 */
(function (global) {
  'use strict';
  const RM = (global.RM = global.RM || {});

  function iso(base, offsetDays) {
    const d = new Date(base.getTime() + offsetDays * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }

  function rows(now) {
    now = now || new Date();
    // Start of the month four months ago
    const base = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 4, 1));
    const T = (a, b) => `${iso(base, a)} - ${iso(base, b)}`;
    const M = (a) => `${iso(base, a)} - ${iso(base, a)}`;
    const H = ['Name', 'Person', 'Status', 'Timeline', 'Priority'];

    return [
      ['Digital Transformation Programme'],
      [],
      ['Strategy & Governance'],
      H,
      ['Programme mobilisation', 'A. Patel', 'Done', T(0, 34), 'High'],
      ['Business case approved', 'A. Patel', 'Done', M(45), 'High'],
      ['Benefits realisation framework', 'J. Okafor', 'Working on it', T(50, 150), 'Medium'],
      ['Quarterly steering reviews', 'A. Patel', 'Working on it', T(90, 330), 'Low'],
      [],
      ['Platform Modernisation'],
      H,
      ['Cloud landing zone', 'R. Chen', 'Done', T(20, 95), 'High'],
      ['Legacy CRM migration', 'R. Chen', 'Working on it', T(80, 230), 'High'],
      ['Subitems', 'Name', 'Owner', 'Status', 'Timeline'],
      [null, 'Data cleanse', 'L. Moreau', 'Done', T(80, 120)],
      [null, 'Cutover rehearsal', 'L. Moreau', 'Not Started', T(200, 222)],
      ['API gateway', 'S. Novak', 'Stuck', T(110, 175), 'Medium'],
      ['Platform go-live', 'R. Chen', 'Not Started', M(235), 'High'],
      ['Decommission legacy estate', 'S. Novak', 'Not Started', T(240, 330), 'Low'],
      [],
      ['Data & Analytics'],
      H,
      ['Data strategy', 'M. Silva', 'Done', T(10, 60), 'Medium'],
      ['Enterprise data warehouse', 'M. Silva', 'Working on it', T(70, 210), 'High'],
      ['Self-service reporting pilot', 'K. Ahmed', 'Not Started', T(180, 250), 'Medium'],
      ['Executive KPI dashboard live', 'K. Ahmed', 'Not Started', M(260), 'High'],
      ['Data governance council', 'M. Silva', '', '', 'Low'],
      [],
      ['Customer Experience'],
      H,
      ['Customer journey mapping', 'E. Walsh', 'Done', T(5, 40), 'Medium'],
      ['New customer portal (MVP)', 'E. Walsh', 'Working on it', T(60, 180), 'High'],
      ['Portal beta launch', 'E. Walsh', 'Not Started', M(185), 'High'],
      ['Mobile app redesign and accessibility uplift', 'T. Brooks', 'Not Started', T(200, 320), 'Medium'],
      [],
      ['People & Change'],
      H,
      ['Change impact assessment', 'H. Kim', 'Done', T(30, 70), 'Medium'],
      ['Training programme', 'H. Kim', 'Working on it', T(150, 260), 'Medium'],
      ['Comms & engagement', 'D. Evans', 'Working on it', T(40, 330), 'Low'],
      ['Operating model sign-off', 'D. Evans', 'Not Started', M(270), 'High'],
    ];
  }

  RM.sample = { rows };
})(typeof window !== 'undefined' ? window : globalThis);
