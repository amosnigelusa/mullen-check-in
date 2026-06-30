# Welcome Desk Check-In

A fast, keyboard-first replacement for the visitor check-in Google Form.
Staff-operated, runs in Chrome on the desk PC, and appends rows straight to the
existing **Form_Responses** Google Sheet — so nothing downstream changes.

## 🔗 Live demo

**[amosnigelusa.github.io/mullen-check-in](https://amosnigelusa.github.io/mullen-check-in/)**

Open it on any phone, tablet, or computer. It runs in **Offline mode** (rows stay
in that browser, the real Sheet is untouched), so it's safe to explore. On Android
you can **Add to Home screen** to install it as an app.

## What it does today (Phase 1)

- **Keyboard-first**: Tab between fields, **Enter** to check in, focus jumps
  back to *Full Name* for the next person. **Esc** clears.
- **Smart defaults**: *Expiration* → `NA`; some ID types auto-fill *Card Issuer*
  (e.g. *Catholic U Alumni* → The Catholic University of America). The form starts
  blank on every refresh. (Edit in `config.js`.)
- **Expiration**: a date picker, or tick **NA** for cards without one. Stored
  as `MM/DD/YYYY` (or `NA`); scans/autofill pre-set it.
- **Returning-visitor autofill**: start typing a name or ID number; past
  visitors appear — pick one and the whole row fills.
- **Writes to your Sheet** via a Google Apps Script endpoint, in the exact
  column order. Timestamp is generated automatically.
- **Offline safety net**: if there's no endpoint (or the network drops), rows
  are saved in the browser and synced automatically once connected.

## Run it

**Double-click `start.bat`** (needs Node installed). It serves the app at
**http://localhost:8000** and opens your browser there.

> Why a local server instead of just opening the file? The passport **camera**
> only works in a browser "secure context" — `localhost` qualifies, a `file://`
> page does not. (You *can* still open `index.html` directly for everything
> except the camera.)

On first launch it runs in **Offline mode** — fully usable for trying it out;
rows stay in the browser until you connect the Sheet.

## Connect it to your Google Sheet

1. Open your responses Google Sheet → **Extensions ▸ Apps Script**.
2. Paste the contents of [`apps-script/Code.gs`](apps-script/Code.gs).
3. **Deploy ▸ New deployment ▸ Web app**
   - *Execute as:* **Me**
   - *Who has access:* **Anyone**
   - Deploy, authorise, and copy the **/exec** URL.
4. In the check-in app click **⚙ Settings**, paste the URL, **Save**.
   The badge turns to **Connected** and any offline rows sync.

## Configure

Edit [`config.js`](config.js):
- `idTypes` — **make this match the form's ID Type dropdown exactly.**
  (Currently only two options are filled in — add the rest.)
- `defaults` — the pre-filled Card Issuer / Expiration values.

## Passport scanning

Click **📘 Scan passport with camera**, allow camera access, and hold the
photo page so the two rows of code at the bottom sit inside the yellow box.
It reads them and fills Full Name, ID Number, ID Type and Expiration for you
to confirm. Card Issuer is filled with the country code (e.g. `ZWE`) — adjust
to the country name if your form prefers it.

- First use downloads the reader (a few MB) and needs internet; it's cached after.
- Reading is OCR-based, so it's good but not perfect — the passport's built-in
  check digits are validated, and staff still confirm before submitting. A clean
  read shows a green ✓; a low-confidence read shows an amber "please verify".

## Roadmap

- **Common Access Card** decoding for US federal/military IDs.
- A returning-visitor index **synced from the Sheet** (so history is shared
  across machines, not per-browser).
