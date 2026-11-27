# Security review: Roadmap Studio

**Date:** 27 November 2026 · **Scope:** the whole repository on branch `claude/busy-fermat-dggzy6` · **Type:** automated and manual code review with browser-based testing. This is not a formal penetration test.

## Summary

Roadmap Studio is a static, browser-only web page. It has no server-side code, database, login or outbound network access. Uploaded spreadsheets are read in the user's browser tab and never leave it.

The review found **one open item**: the bundled spreadsheet library (SheetJS 0.18.5) has two published advisories. Both need a deliberately crafted malicious file, and they're judged low risk in this context. Three further issues were **found and fixed** during the review.

| # | Finding | Rating (in context) | Status |
| --- | --- | --- | --- |
| 1 | SheetJS 0.18.5 advisories: prototype pollution (GHSA-4r6h-8v6p-xvw6, fixed in 0.19.3) and ReDoS (GHSA-5pgg-2g8v-p4x9, fixed in 0.20.2). Rated High by npm. | Low | **Open.** Upgrade to SheetJS ≥ 0.20.3 recommended |
| 2 | File-derived data (board title, workstream names, their colours and visibility) was saved in browser local storage, contrary to the documentation | Medium | **Fixed.** Only layout and colour preferences are stored |
| 3 | Saved settings were inserted into the chart markup without validation. Tampered storage (e.g. from another app on the same host) could inject markup. CSP blocked script execution and external loads. | Low | **Fixed.** Saved values are type-checked; colours must be `#rrggbb` |
| 4 | CSP allowed inline styles (`'unsafe-inline'`), which the app doesn't need | Low | **Fixed.** Removed |

## Controls verified

- **No network access from the page:** the Content-Security-Policy sets `connect-src 'none'`, with scripts and images limited to the app's own files. In a browser test, `fetch`, XHR, `sendBeacon`, WebSocket, external images, external scripts and iframes were all blocked. A monitoring server received zero requests.
- **No dynamic code:** no `eval`, `new Function` or string timers, in the app or the bundled library. The CSP also forbids them.
- **Output encoding:** all spreadsheet-derived text in the chart and UI is HTML-escaped or set as plain text.
- **Bundled library integrity:** `vendor/xlsx.full.min.js` is byte-identical to the official npm release `xlsx@0.18.5`. The tarball's SHA-1 matches the registry.
- **Input limits:** parsing is capped at 20,000 rows × 200 columns per sheet. The app's own regular expressions handle 50,000-character hostile cells in under 5 ms.
- **Secrets:** no credentials, keys or tokens in the repository. There are no external URLs in the app.
- **Regression tests:** `tests/smoke.js` checks that no network requests are made, that nothing from the file is stored, and that tampered settings are rejected.

## Hosting notes (Posit Connect)

- Connect serves the files as static content. Uploaded spreadsheets are still processed only in the user's browser.
- Restrict access with Connect's sharing settings, e.g. to specific groups.
- All content on a Connect server shares one web origin, so browser storage is shared with other Connect content. After fix 2, only non-sensitive preferences are stored.
- A CSP set in the page can't control framing (`frame-ancestors`); Connect's response headers govern that. The app performs no state-changing actions, so clickjacking impact is minimal.

## Limitations

- **Tested in Chromium only.** Other browsers weren't tested.
- **Not tested on a live Connect server.** Testing used a local web server that mimics how Connect serves files.
- **SheetJS internals weren't audited** beyond the published advisories.
