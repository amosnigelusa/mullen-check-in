# Mullen Library · Patron Sign-In — Documentation

**Version 1.0.0** · The Catholic University of America — University Libraries, Mullen Library

This is the technical and operational reference for the welcome-desk check-in app.
For a quick start, see [README.md](README.md). For what changed, see [CHANGELOG.md](CHANGELOG.md).

---

## 1. Overview

The app replaces a manually filled Google Form that welcome-desk staff complete for
every visitor (which caused entrance queues). It is a **single-page web app**,
operated by staff, that appends rows to the existing responses **Google Sheet** via a
**Google Apps Script** web-app endpoint — so every downstream report and process that
already reads the Sheet keeps working unchanged.

- **Audience:** welcome-desk staff (not self-service).
- **Devices:** Chrome on the desk PC, or an Android tablet (installable as a PWA).
- **Backend:** the existing Google Sheet, unchanged in structure.

---

## 2. Architecture

```
┌─────────────────────────────┐         JSONP over GET          ┌──────────────────────┐
│  Single-page app (browser)  │  ───────────────────────────▶   │  Apps Script web app │
│  index.html + config.js     │     check-in / roster / lookup   │  (Code.gs, /exec)    │
│  app.js · aamva.js ·        │  ◀───────────────────────────   │                      │
│  passport.js · styles.css   │            JSON result           └───────────┬──────────┘
└──────────────┬──────────────┘                                              │
               │ offline queue (localStorage)                                │ openById
               ▼                                                             ▼
        browser storage                                          Google Sheet ("Form responses 1")
```

**Why JSONP over GET?** A `no-cors` POST is write-only and unverifiable, and Google's
endpoints answer with a redirect that a `fetch` cannot follow cross-origin. A GET with
a JSONP `callback` parameter clears the redirect cleanly and returns a real, readable
result, so the app can confirm each write succeeded.

### Data flow

1. Staff scan a barcode, scan a passport, or type into the form.
2. On submit, the app sends the row as GET query params with a `callback`.
3. `Code.gs` **upserts** the row into the Sheet (update existing ID, else append) and
   returns `{ok:true, updated:…}`.
4. If the endpoint is missing or the network is down, the row is queued in
   `localStorage` and flushed automatically once connectivity returns.
5. For autofill, the app fetches a **roster** (one entry per visitor) and does live
   single-record **lookups** by ID Number.

---

## 3. Files

| File | Purpose |
| --- | --- |
| [`index.html`](index.html) | App shell: scan box, check-in form, recent panel, settings & camera dialogs. |
| [`app.js`](app.js) | Front-end logic — entry, validation, defaults, autofill, submit, offline queue, toasts. |
| [`config.js`](config.js) | All site-specific configuration (ID types, sub-lists, auto-issuer, defaults). **Edit this to retarget the app.** |
| [`aamva.js`](aamva.js) | Parses AAMVA PDF417 barcodes (US/Canada State IDs & licenses) into form fields. |
| [`passport.js`](passport.js) | Reads passport MRZ via the `mrz` library and maps it to form fields. |
| [`styles.css`](styles.css) | Material 3 / Material You styling, CUA branding, responsive tablet layout. |
| [`server.js`](server.js) | Zero-dependency static server on `http://localhost:8000` (secure context for the camera). |
| [`start.bat`](start.bat) | Launches `server.js` and opens the browser. |
| [`manifest.webmanifest`](manifest.webmanifest) | PWA manifest (installable app, icons, theme color). |
| [`apps-script/Code.gs`](apps-script/Code.gs) | The Google Apps Script endpoint (deployed in the Sheet, not run locally). |
| [`assets/`](assets/) | CUA wordmark and the maskable app icon. |

---

## 4. Data model

The Sheet columns, in the exact append order:

| Col | Field | Notes |
| --- | --- | --- |
| A | Timestamp | Generated server-side on save. |
| B | Full Name | As written on the ID. |
| C | ID Number | Upsert key (no spaces/special chars). |
| D | ID Type | One of the `config.js` `idTypes`. |
| E | Card Issuer | School / state / country / institution. |
| F | Expiration Date | `MM/DD/YYYY` or `NA`. |

**Upsert key:** ID Number (case-insensitive); when blank, Full Name is used. A new
check-in for the same key **updates** that row rather than adding a duplicate.

---

## 5. Configuration ([`config.js`](config.js))

- **`idTypes`** — the ID Type dropdown options. **Must match the strings the Sheet/Form
  expects exactly.**
- **`subLists`** — for ID types that need a second choice (WRLC school, theological
  consortium member, US state). Picking an option fills *Card Issuer*.
- **`autoIssuer`** — ID types that always map to one issuer (e.g. *Catholic U Alumni*).
- **`defaults`** — `cardIssuer` (blank — varies too much) and `expiration` (`NA`).
- **`recentLimit`** — how many recent check-ins to show.

No other file needs editing to retarget the app to a different institution.

---

## 6. Running locally

**Double-click [`start.bat`](start.bat)** (needs Node). It serves the app at
`http://localhost:8000` and opens the browser.

A local server (rather than opening `index.html` directly) is required because the
passport **camera** (`getUserMedia`) only works in a browser **secure context** —
`localhost` qualifies, a `file://` page does not. Everything except the camera also
works from a plain `file://` open.

On first launch the app is in **Offline mode** — fully usable; rows stay in the browser
until the Sheet endpoint is connected.

---

## 7. Connecting the Google Sheet

1. Open the responses Sheet → **Extensions ▸ Apps Script**.
2. Replace all code with [`apps-script/Code.gs`](apps-script/Code.gs) and **Save**.
3. Confirm `SPREADSHEET_ID` (top of the file) points at your Sheet; the tab is matched
   tolerantly and falls back to the tab whose first cell is `Timestamp`.
4. **Deploy ▸ New deployment ▸ Web app** — *Execute as:* **Me**, *Who has access:*
   **Anyone**. Authorize (one-time; needs the Sheets scope) and copy the **/exec** URL.
5. In the app, click **⚙ Settings**, paste the URL, **Save**. The badge turns
   **Connected** and any queued offline rows sync.

> **Deploy gotcha:** editing `Code.gs` locally does **not** update Google. Paste into
> the Apps Script editor, Save, then **Deploy ▸ Manage deployments ▸ Edit ▸ Version:
> New version ▸ Deploy**. The `/exec` URL stays constant.

### Endpoint API (`Code.gs`)

| Request (GET params) | Action | Returns |
| --- | --- | --- |
| `fullName` / `idNumber` (+ row fields) | Upsert a check-in row | `{ok, updated}` |
| `action=roster` | One entry per visitor (for autofill) | `{ok, roster:[…]}` |
| `action=lookup&idNumber=…` | Live single-record lookup | `{ok, record\|null}` |
| *(none)* | Health check | `{ok, service, sheet}` |

All responses are wrapped as `callback(…)` JSONP when a `callback` param is supplied.

---

## 8. Capture methods

- **Manual / keyboard:** Tab through fields, **Enter** to submit, **Esc** to clear.
- **PDF417 barcode (USB scanner):** focus the scan box and scan the back of a US/Canada
  State ID or license; [`aamva.js`](aamva.js) fills Name, ID Number, ID Type, Issuing
  State, and Expiration.
- **Passport (camera):** click **Scan passport with camera**, line up the two MRZ rows
  in the guide box; [`passport.js`](passport.js) validates check digits and fills the
  form. First use downloads the reader (a few MB, then cached). Staff confirm before
  submitting.

---

## 9. Privacy & resilience

- The on-screen recent panel shows only the **last** check-in and clears the name after
  a short delay.
- A double-submit guard prevents accidental duplicate rows.
- Offline rows are queued locally and synced when connectivity returns; no check-in is
  lost if the network drops.

---

## 10. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Badge stuck on **Offline mode** | No endpoint saved, or the `/exec` URL is wrong/undeployed. Re-check Settings and the deployment. |
| Camera won't start | Opened as `file://` (not a secure context) or camera permission denied. Use `start.bat` (localhost) and allow access. |
| Rows go to the wrong tab | `SHEET_NAME` / `SPREADSHEET_ID` in `Code.gs` point elsewhere; the fallback finds the tab whose first cell is `Timestamp`. |
| Code edits don't take effect | `Code.gs` must be pasted into the Apps Script editor and **re-deployed as a New version**. |
| Barcode fills nothing | Card is not AAMVA (e.g. a Common Access Card uses the DoD format) — enter manually. |
| Icons show as boxes | Material Symbols font is loaded from Google Fonts — needs internet on first load. |

---

## 11. Roadmap (post-1.0)

- **Common Access Card** decoding (DoD PDF417, not AAMVA).
- OCR for non-barcoded university / high-school cards.
- A returning-visitor index synced from the Sheet across machines.

---

*See [CHANGELOG.md](CHANGELOG.md) for the version history.*
