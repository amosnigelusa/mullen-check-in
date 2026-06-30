# Changelog

All notable changes to **Mullen Library · Patron Sign-In** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] — 2026-06-30

### Added

**Restricted-access (banned patron) alert**
- New **staff-only column G ("Banned Patriot")** on the responses Sheet. Tick the
  checkbox — or enter `Y` / `Yes` / `TRUE` — on a patron's row to flag them. The
  check-in form never writes this column, so the flag survives check-in updates
  (the app only writes columns A–F).
- When the operator **presses Check In** for a flagged patron, the form **blocks the
  check-in** (no row is recorded) and raises a loud, animated red
  **"Restricted Library Access"** banner asking staff to contact a supervisor. The
  alert flashes, pulses a halo, and shakes on entrance (respects
  `prefers-reduced-motion`).
- The flag is matched against the live roster by ID Number (or Full Name when blank).
  It is **not** shown during scanning or auto-fill — only at the moment of check-in —
  so it can't be dismissed by simply re-typing.
- [`apps-script/Code.gs`](apps-script/Code.gs) now reads column G in both `buildRoster`
  and `lookupById`; a ban on any matching row sticks to the person.

## [1.0.0] — 2026-06-30

First official release. A fast, staff-operated, keyboard-first replacement for the
welcome-desk visitor check-in Google Form, branded for The Catholic University of
America — University Libraries, Mullen Library. Writes straight to the existing
responses Google Sheet, so nothing downstream changes.

### Added

**Check-in form & entry**
- Keyboard-first workflow: Tab between fields, **Enter** to check in, focus returns
  to *Full Name* for the next person, **Esc** clears.
- Six captured fields matching the Sheet's column order:
  `Timestamp | Full Name | ID Number | ID Type | Card Issuer | Expiration Date`
  (Timestamp generated automatically).
- ID Type dropdown driven entirely from [`config.js`](config.js) (10 options).
- Context-sensitive sub-dropdown: choosing *WRLC University Card*, *Washington
  Theological Consortium ID Card*, or *US State ID / Driver's License* reveals a
  second list (school / member school / issuing state) that fills *Card Issuer*.
- Auto-issuer mapping: fixed-issuer ID types (e.g. *Catholic U Alumni* → The Catholic
  University of America) fill *Card Issuer* automatically with no sub-dropdown.
- Expiration entered via a native date picker or an **NA** toggle for cards with no
  expiry; stored canonically as `MM/DD/YYYY` or `NA`.
- Smart defaults: Expiration defaults to `NA`; the form starts blank on every refresh.

**Barcode & passport capture**
- **PDF417 barcode auto-fill** for US/Canada State IDs & Driver's Licenses via a
  keyboard-wedge USB scanner — AAMVA parser in [`aamva.js`](aamva.js) fills Name,
  ID Number, ID Type, Issuing State, and Expiration.
- **Passport MRZ camera scanning** ([`passport.js`](passport.js)): reads the two-line
  machine-readable zone with the open-source `mrz` library, validates the document's
  check digits, and fills the form for staff to confirm (green ✓ on a clean read,
  amber "please verify" on low confidence).

**Returning-visitor autofill**
- Type-ahead on Full Name / ID Number suggests past visitors and fills the whole row.
- Local per-browser history, plus a shared roster pulled live from the Sheet.
- Live single-record lookup by ID Number when a barcode is scanned (reflects current
  Sheet contents, including deletions).

**Backend & data flow**
- Google Apps Script web-app endpoint ([`apps-script/Code.gs`](apps-script/Code.gs))
  using **JSONP over GET** so responses survive Google's redirect and are verifiable.
- **Upsert** behavior: a check-in updates the existing row for that ID Number (or
  Full Name when blank) instead of creating duplicates.
- Spreadsheet pinned by ID with a tolerant tab match and a `Timestamp`-header
  fallback so the correct responses tab is always found.

**Resilience**
- **Offline mode**: with no endpoint configured (or when the network drops), rows are
  queued in the browser and synced automatically once connected; the mode badge shows
  current state.
- Double-submit guard against accidental repeat check-ins.
- On-screen name is cleared after a short delay for patron privacy.

**App shell & branding**
- Material 3 / Material You UI seeded with CUA Cardinal Red, optimized for Android
  tablets; Roboto / Roboto Flex type, Material Symbols Rounded icons, ripples,
  snackbar-style toasts, animated backdrop (respects `prefers-reduced-motion`).
- Installable **PWA**: [`manifest.webmanifest`](manifest.webmanifest) + maskable app
  icon; "Add to Home screen" on Android.
- Zero-dependency local static server ([`server.js`](server.js) / `start.bat`) so the
  camera works in a secure context (`localhost`).
- Live demo on GitHub Pages, running in offline mode for safe exploration.

### Known limitations / roadmap
- **Common Access Card** (US federal/military) barcodes use the DoD PDF417 format, not
  AAMVA — currently prompts for manual entry.
- OCR for non-barcoded university / high-school cards is not yet implemented.
- The shared returning-visitor roster is read from the Sheet; there is no separate
  synced index.

[1.0.0]: https://github.com/amosnigelusa/mullen-check-in/releases/tag/v1.0.0
