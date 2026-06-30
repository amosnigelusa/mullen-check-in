// Thin wrapper around the open-source `mrz` library (Zakodium, MIT).
// The library does all interpretation/validation of the document's code zone;
// this file only: picks candidate text rows, calls the library, and maps its
// output to our form fields. Loaded lazily from a CDN on first use.
(() => {
  let libParse = null;

  async function ensureLib() {
    if (libParse) return libParse;
    const mod = await import("https://cdn.jsdelivr.net/npm/mrz@3/+esm");
    libParse = mod.parse;
    return libParse;
  }

  // Keep only A–Z 0–9 < ; the two data rows are the long ones (~44 chars).
  function pickRows(text) {
    const rows = String(text)
      .toUpperCase()
      .split(/\r?\n/)
      .map((l) => l.replace(/[^A-Z0-9<]/g, ""))
      .filter((l) => l.length >= 40);
    if (rows.length < 2) return null;
    const pad = (l) => (l + "<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<").slice(0, 44);
    return [pad(rows[rows.length - 2]), pad(rows[rows.length - 1])];
  }

  function titleCase(s) {
    return String(s || "").toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).trim();
  }

  // library date string "YYMMDD" -> "MM/DD/YYYY"
  function toDate(s) {
    if (!/^\d{6}$/.test(s || "")) return "";
    const yy = +s.slice(0, 2);
    const year = yy < 50 ? 2000 + yy : 1900 + yy;
    return s.slice(2, 4) + "/" + s.slice(4, 6) + "/" + year;
  }

  async function parse(text) {
    const rows = pickRows(text);
    if (!rows) return null;

    let out;
    try {
      const fn = await ensureLib();
      out = fn(rows);
    } catch (e) {
      return null;
    }

    const f = (out && out.fields) || {};
    // Surname first, then given names (e.g. "Funguriro Amos Nigel").
    const raw = [f.lastName, f.firstName].filter(Boolean).join(" ");
    const name = titleCase(raw.replace(/[^A-Za-z\s'-]/g, " ").replace(/\s+/g, " "));
    return {
      valid: !!(out && out.valid) && !!f.documentNumber,
      fullName: name,
      idNumber: String(f.documentNumber || "").replace(/[^A-Za-z0-9]/g, ""),
      idType: "International ID / Passport",
      cardIssuer: f.issuingState || "",     // 3-letter code; staff can adjust
      expiration: toDate(f.expirationDate) || "NA",
    };
  }

  window.Passport = { parse };
})();
