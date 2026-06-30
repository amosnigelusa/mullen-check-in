/**
 * Welcome Desk Check-In — Google Apps Script endpoint.
 *
 * Appends a check-in row to the "Form_Responses" sheet in the SAME column
 * order the Google Form uses:
 *   Timestamp | Full Name | ID Number | ID Type | Card Issuer | Expiration Date
 *
 * The web app sends data as GET query params with a JSONP `callback`, which
 * gets through Google's redirect cleanly and lets the app read the response.
 * doPost is kept for compatibility.
 *
 * SETUP / UPDATE:
 *   1. Open your responses Google Sheet > Extensions > Apps Script.
 *   2. Replace all code with this file, Save.
 *   3. Deploy > Manage deployments > (pencil) Edit > Version: New version > Deploy.
 *      (The /exec URL stays the same.)
 */

const SHEET_NAME = "Form responses 1";

// Most reliable: paste the long ID from your sheet's URL here, between /d/ and
// /edit  ->  docs.google.com/spreadsheets/d/THIS_PART/edit
// Leave "" to use the spreadsheet this script is bound to.
const SPREADSHEET_ID = "118JvZhTGN1MbYNFq9o0KQdGOHCsxQjBaFTpgmLkfdcQ";

function getSheet() {
  const ss = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("No bound spreadsheet — set SPREADSHEET_ID.");

  const sheets = ss.getSheets();

  // 1. exact / tolerant name match (ignores stray spaces & casing)
  const want = SHEET_NAME.trim().toLowerCase();
  let sheet = sheets.find((s) => s.getName().trim().toLowerCase() === want);

  // 2. otherwise, auto-find the responses tab by its "Timestamp" header
  if (!sheet) {
    sheet = sheets.find((s) => {
      const v = s.getRange(1, 1).getValue();
      return typeof v === "string" && v.trim().toLowerCase() === "timestamp";
    });
  }

  // 3. last resort: if there's only one tab, use it
  if (!sheet && sheets.length === 1) sheet = sheets[0];

  if (!sheet) {
    const tabs = sheets.map((s) => '"' + s.getName() + '"').join(", ");
    throw new Error('No matching tab in "' + ss.getName() + '". Available tabs: ' + tabs);
  }
  return sheet;
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  // The front-end pulls the known-visitor roster for type-ahead auto-fill.
  if (p.action === "roster") {
    return respond({ ok: true, roster: buildRoster() }, p.callback);
  }
  // Live single-record lookup by ID number (used when a barcode is scanned).
  // Returns the record only if it currently exists in the sheet — a deleted
  // row correctly returns null, so nothing is auto-filled.
  if (p.action === "lookup") {
    return respond({ ok: true, record: lookupById(p.idNumber) }, p.callback);
  }
  // A check-in carries data; a bare visit is just a health check.
  if (p.fullName || p.idNumber) {
    return respond(saveRow(p), p.callback);
  }
  return respond({ ok: true, service: "check-in", sheet: SHEET_NAME }, p.callback);
}

// Collapses the sheet's check-in rows into one entry per person (keyed by ID
// Number, or Full Name when blank), keeping the most recent details and a
// visit count. Used by the front-end to auto-fill returning visitors.
function buildRoster() {
  const sheet = getSheet();
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const vals = sheet.getRange(2, 1, last - 1, 6).getValues();  // A..F
  const byKey = {};
  for (let i = 0; i < vals.length; i++) {
    const r = vals[i];
    const fullName = String(r[1] || "").trim();
    const idNumber = String(r[2] || "").trim();
    if (!fullName && !idNumber) continue;
    const key = (idNumber || fullName).toLowerCase();
    const e = byKey[key] || { fullName: "", idNumber: "", idType: "", cardIssuer: "", expiration: "", count: 0 };
    // Rows are in chronological order, so later rows overwrite with newer details.
    e.fullName = fullName || e.fullName;
    e.idNumber = idNumber || e.idNumber;
    if (r[3]) e.idType = String(r[3]).trim();
    if (r[4]) e.cardIssuer = String(r[4]).trim();
    if (r[5] !== "" && r[5] != null) e.expiration = fmtExpiration(r[5]);
    e.count++;
    byKey[key] = e;
  }
  return Object.keys(byKey)
    .map((k) => byKey[k])
    .sort((a, b) => b.count - a.count)
    .slice(0, 5000);
}

// Looks up the most recent row whose ID Number matches, reading the sheet
// live so the result reflects the current contents (including deletions).
// Returns a visitor record, or null when the ID is not present.
function lookupById(idNumber) {
  const key = String(idNumber || "").trim().toLowerCase();
  if (!key) return null;
  const sheet = getSheet();
  const last = sheet.getLastRow();
  if (last < 2) return null;
  const vals = sheet.getRange(2, 1, last - 1, 6).getValues();  // A..F
  let rec = null;
  for (let i = 0; i < vals.length; i++) {
    const rowId = String(vals[i][2] || "").trim().toLowerCase();  // col C
    if (rowId && rowId === key) {
      rec = {                                  // later rows are newer; keep the last
        fullName: String(vals[i][1] || "").trim(),
        idNumber: String(vals[i][2] || "").trim(),
        idType: String(vals[i][3] || "").trim(),
        cardIssuer: String(vals[i][4] || "").trim(),
        expiration: (vals[i][5] !== "" && vals[i][5] != null) ? fmtExpiration(vals[i][5]) : "",
      };
    }
  }
  return rec;
}

// The sheet may hold the expiration as a real Date; normalize to the
// "MM/DD/YYYY" / "NA" form the form expects.
function fmtExpiration(v) {
  if (Object.prototype.toString.call(v) === "[object Date]") {
    const p = (n) => String(n).padStart(2, "0");
    return p(v.getMonth() + 1) + "/" + p(v.getDate()) + "/" + v.getFullYear();
  }
  return String(v).trim();
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    return respond(saveRow(data), null);
  } catch (err) {
    return respond({ ok: false, error: String(err) }, null);
  }
}

// Upsert: if a row with the same ID Number (or, when blank, the same Full Name)
// already exists, update it to the latest values; otherwise append a new row.
// Columns: A Timestamp | B Full Name | C ID Number | D ID Type | E Card Issuer | F Expiration
function saveRow(data) {
  try {
    const sheet = getSheet();
    const row = [
      data.timestamp || new Date(),
      data.fullName || "",
      data.idNumber || "",
      data.idType || "",
      data.cardIssuer || "",
      data.expiration || "",
    ];

    const idKey = String(data.idNumber || "").trim().toLowerCase();
    const nameKey = String(data.fullName || "").trim().toLowerCase();
    const last = sheet.getLastRow();

    if (last >= 2 && (idKey || nameKey)) {
      const vals = sheet.getRange(2, 1, last - 1, 6).getValues();
      for (let i = 0; i < vals.length; i++) {
        const rowId = String(vals[i][2]).trim().toLowerCase();   // col C
        const rowName = String(vals[i][1]).trim().toLowerCase(); // col B
        const match = idKey ? rowId === idKey : (nameKey && rowName === nameKey);
        if (match) {
          sheet.getRange(i + 2, 1, 1, 6).setValues([row]);
          return { ok: true, updated: true };
        }
      }
    }

    sheet.appendRow(row);
    return { ok: true, updated: false };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// Returns JSONP (callback(...)) when a callback name is supplied, else JSON.
function respond(obj, callback) {
  const body = JSON.stringify(obj);
  if (callback) {
    return ContentService
      .createTextOutput(callback + "(" + body + ")")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(body)
    .setMimeType(ContentService.MimeType.JSON);
}
