// ----------------------------------------------------------------------------
// AAMVA PDF417 parser — decodes the barcode on the back of US/Canada
// State IDs & Driver's Licenses into the check-in form fields.
//
// Spec: AAMVA DL/ID Card Design Standard. Data elements are 3-letter codes,
// each on its own line (LF-separated):
//   DCS = family/last name      DAC = first name        DAD = middle name
//   DAQ = customer/license ID    DBA = expiration date   DAJ = jurisdiction
//   DCG = country                DAA = full name (older single-field form)
// ----------------------------------------------------------------------------
(() => {
  const STATES = {
    AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
    CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
    FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
    IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
    ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
    MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
    NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
    NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
    OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
    RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
    TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
    WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
    PR: "Puerto Rico", GU: "Guam", VI: "U.S. Virgin Islands",
    // Canadian provinces (AAMVA is used in Canada too)
    AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick",
    NL: "Newfoundland and Labrador", NS: "Nova Scotia", NT: "Northwest Territories",
    NU: "Nunavut", ON: "Ontario", PE: "Prince Edward Island", QC: "Quebec",
    SK: "Saskatchewan", YT: "Yukon",
  };

  // Does this text look like an AAMVA barcode payload at all?
  function isAAMVA(text) {
    return /ANSI\s*\d|@\s*\n?\x1e|DAQ|DCS|DAC/.test(text);
  }

  // Pull each 3-letter data element. Elements sit at the start of their own
  // line; we scan line-by-line and strip any leading subfile designator (DL/ID).
  function elements(text) {
    const map = {};
    const lines = text.split(/[\r\n]+/);
    const CODE = /^(?:DL|ID)?([A-Z]{3})(.*)$/;
    for (const raw of lines) {
      const line = raw.replace(/[\x00-\x1f]/g, "").trim();
      const m = CODE.exec(line);
      if (m) {
        const code = m[1];
        if (!(code in map)) map[code] = m[2].trim();
      }
    }
    return map;
  }

  // AAMVA dates: US = MMDDCCYY, Canada = CCYYMMDD. Detect and normalise to MM/DD/YYYY.
  function formatDate(raw) {
    if (!raw) return "";
    const s = raw.replace(/\D/g, "");
    if (s.length !== 8) return raw;
    let mm, dd, yyyy;
    if (/^(19|20)\d{2}(0[1-9]|1[0-2])([0-2]\d|3[01])$/.test(s)) {
      // CCYYMMDD
      yyyy = s.slice(0, 4); mm = s.slice(4, 6); dd = s.slice(6, 8);
    } else {
      // MMDDCCYY
      mm = s.slice(0, 2); dd = s.slice(2, 4); yyyy = s.slice(4, 8);
    }
    return `${mm}/${dd}/${yyyy}`;
  }

  function titleCase(s) {
    return (s || "")
      .toLowerCase()
      .replace(/\b[a-z]/g, (c) => c.toUpperCase())
      .trim();
  }

  // Returns { fullName, idNumber, cardIssuer, expiration, idType } or null.
  function parse(text) {
    if (!text || !isAAMVA(text)) return null;
    const el = elements(text);

    let fullName;
    if (el.DAC || el.DCS) {
      fullName = [el.DAC, el.DAD, el.DCS]
        .map((p) => titleCase(p))
        .filter((p) => p && p !== "Na" && p !== "Nca" && p !== "Unavl")
        .join(" ");
    } else if (el.DAA) {
      // Older single-field name, usually "LAST,FIRST,MIDDLE" or "LAST FIRST"
      fullName = titleCase(el.DAA.replace(/,/g, " ").replace(/\s+/g, " "));
    }

    const idNumber = (el.DAQ || "").replace(/[^A-Za-z0-9]/g, "");
    const jur = (el.DAJ || "").toUpperCase();
    const cardIssuer = STATES[jur] || el.DAJ || "";
    const expiration = formatDate(el.DBA);

    if (!idNumber && !fullName) return null;

    return {
      fullName: fullName || "",
      idNumber,
      cardIssuer,
      expiration: expiration || "NA",
      idType: "US State ID / Driver's License",
    };
  }

  window.AAMVA = { parse, isAAMVA };
})();
