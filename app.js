// ----------------------------------------------------------------------------
// Welcome Desk Check-In — front-end logic (Phase 1)
// Keyboard-first entry, smart defaults, returning-visitor autofill, and
// submission to a Google Apps Script endpoint (with offline fallback).
// ----------------------------------------------------------------------------
(() => {
  const CFG = window.CHECKIN_CONFIG;
  const LS_ENDPOINT = "checkin.endpoint";
  const LS_HISTORY = "checkin.history";       // returning-visitor memory
  const LS_QUEUE = "checkin.queue";           // rows captured while offline

  const $ = (id) => document.getElementById(id);
  const form = $("checkinForm");
  const els = {
    fullName: $("fullName"),
    idNumber: $("idNumber"),
    idType: $("idType"),
    subField: $("subField"),
    subSelect: $("subSelect"),
    subLabel: $("subLabel"),
    cardIssuer: $("cardIssuer"),
    expiration: $("expiration"),   // hidden canonical value: "NA" or "MM/DD/YYYY"
    expDate: $("expDate"),         // visible native date picker (YYYY-MM-DD)
    expNA: $("expNA"),             // "no expiry" toggle
    submitBtn: $("submitBtn"),
    suggestions: $("suggestions"),
    recentList: $("recentList"),
    recentCount: $("recentCount"),
    modeBadge: $("modeBadge"),
    scanInput: $("scanInput"),
    scanMsg: $("scanMsg"),
    banDialog: $("banDialog"),
    banDialogName: $("banDialogName"),
  };

  // --- state ---------------------------------------------------------------
  let history = load(LS_HISTORY, []);   // [{fullName, idNumber, idType, cardIssuer, expiration, count, last}]
  let roster = [];                       // known visitors pulled from the sheet (server-side)
  let lastRecent = null;                 // the single on-screen check-in (privacy)
  let sessionCount = 0;                   // total check-ins this session
  let recentTimer = null;                // clears the on-screen name after 10s
  let lastSubmitSig = "", lastSubmitAt = 0;  // guards against double-submits
  let endpoint = localStorage.getItem(LS_ENDPOINT) || "";
  let idleTimer = null;                  // clears the form after inactivity (privacy)
  const IDLE_MS = 15000;                 // 15 seconds of no operator activity

  // --- init ----------------------------------------------------------------
  function init() {
    // populate ID Type dropdown — always starts on the "Choose…" placeholder
    els.idType.innerHTML =
      `<option value="" disabled selected>Choose…</option>` +
      CFG.idTypes.map((t) => `<option>${escapeHtml(t)}</option>`).join("");
    els.idType.value = "";

    applyDefaults();
    updateSubList();
    refreshMode();
    renderRecent();
    wireEvents();
    attachRipples();
    // keep the background queue draining so optimistic submits reconcile fast
    setInterval(() => { if (endpoint && queueSize()) flushQueue(); }, 10000);
    armIdleTimer();
    els.scanInput.focus();
  }

  // Material-style touch ripple: spawn an expanding circle from the press
  // point on any .m3-ripple control, for that tactile Android feel.
  function attachRipples() {
    document.addEventListener("pointerdown", (e) => {
      const host = e.target.closest && e.target.closest(".m3-ripple");
      if (!host || host.disabled) return;
      const rect = host.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const r = document.createElement("span");
      r.className = "ripple";
      r.style.width = r.style.height = size + "px";
      r.style.left = (e.clientX - rect.left - size / 2) + "px";
      r.style.top = (e.clientY - rect.top - size / 2) + "px";
      host.appendChild(r);
      r.addEventListener("animationend", () => r.remove(), { once: true });
      setTimeout(() => r.remove(), 700);   // safety
    }, true);
  }

  // --- inactivity auto-clear (patron privacy) ------------------------------
  // If the desk is left unattended, wipe any half-entered patron details from
  // the screen after IDLE_MS so the next person can't see them.
  function armIdleTimer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(onIdle, IDLE_MS);
  }
  function onIdle() {
    // Don't yank the form out from under an open dialog (camera / settings).
    const cam = $("cameraDialog"), dlg = $("settingsDialog");
    if ((cam && cam.open) || (dlg && dlg.open)) { armIdleTimer(); return; }
    resetForm(true);
  }

  function applyDefaults() {
    els.cardIssuer.value = CFG.defaults.cardIssuer || "";
    setExpiration(CFG.defaults.expiration || "");
  }

  // --- expiration: hidden canonical "NA"/"MM/DD/YYYY" <-> date picker + NA box -
  function mdyToISO(mdy) {            // "MM/DD/YYYY" -> "YYYY-MM-DD" (date input)
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((mdy || "").trim());
    return m ? `${m[3]}-${m[1]}-${m[2]}` : "";
  }
  function isoToMDY(iso) {            // "YYYY-MM-DD" -> "MM/DD/YYYY" (canonical)
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso || "").trim());
    return m ? `${m[2]}/${m[3]}/${m[1]}` : "";
  }

  // Set both the UI controls and the hidden field from a canonical value.
  function setExpiration(val) {
    val = (val || "").trim();
    if (val.toUpperCase() === "NA") {
      els.expNA.checked = true;
      els.expDate.value = "";
      els.expiration.value = "NA";
    } else {
      els.expNA.checked = false;
      els.expDate.value = mdyToISO(val);
      els.expiration.value = els.expDate.value ? isoToMDY(els.expDate.value) : "";
    }
    reflectExpiryMode();
  }

  // Disable the picker when NA is ticked, and require it otherwise.
  function reflectExpiryMode() {
    const na = els.expNA.checked;
    els.expDate.disabled = na;
    els.expDate.required = !na;
    els.expDate.setCustomValidity("");
  }

  // Pull the current UI state back into the hidden canonical field.
  function syncExpiryFromUI() {
    els.expiration.value = els.expNA.checked
      ? "NA"
      : (els.expDate.value ? isoToMDY(els.expDate.value) : "");
  }

  // Show a second dropdown for ID types configured in CFG.subLists; picking an
  // option fills Card Issuer (which stays the required field). Not required
  // itself, so it never conflicts with a scanned license that fills the state.
  function updateSubList() {
    const idType = els.idType.value;
    const cfg = (CFG.subLists || {})[idType];
    if (cfg) {
      els.subLabel.textContent = cfg.label;
      els.subSelect.innerHTML =
        `<option value="" selected>${escapeHtml(cfg.placeholder || "Choose…")}</option>` +
        cfg.options.map((o) => `<option>${escapeHtml(o)}</option>`).join("");
      els.subField.hidden = false;
      els.subSelect.disabled = false;
      // if Card Issuer already matches an option (e.g. a scanned license state), select it
      const cur = els.cardIssuer.value.trim();
      if (cur && cfg.options.includes(cur)) els.subSelect.value = cur;
    } else {
      els.subField.hidden = true;
      els.subSelect.disabled = true;
      els.subSelect.innerHTML = "";
    }
    // Some ID types map to a single Card Issuer — fill it automatically.
    const fixed = (CFG.autoIssuer || {})[idType];
    if (fixed && els.cardIssuer.value.trim() !== fixed) flashFill(els.cardIssuer, fixed);
  }

  function setBadge(text, cls) {
    els.modeBadge.textContent = text;
    els.modeBadge.className = "badge badge--" + cls;
  }

  // Actually pings the endpoint so the badge tells the truth.
  async function refreshMode() {
    if (!endpoint) { setBadge("Offline mode", "mock"); return; }
    setBadge("Checking…", "mock");
    const res = await jsonp(endpoint, {});   // health check (no row data)
    if (res && res.ok) { setBadge("Connected", "live"); flushQueue(); loadRoster(); }
    else setBadge("Not reachable", "mock");
  }

  // Pull the known-visitor roster from the sheet so type-ahead auto-fill works
  // on any device, not just from this browser's local check-in history.
  async function loadRoster() {
    if (!endpoint) return;
    const res = await jsonp(endpoint, { action: "roster" }, 6000);
    if (res && res.ok && Array.isArray(res.roster)) roster = res.roster;
  }

  // The autocomplete pool. When connected, the sheet's roster is the source of
  // truth (refreshed on field focus), so deleted visitors disappear and never
  // auto-fill. Offline (no endpoint), fall back to this browser's memory.
  function candidates() {
    return endpoint ? roster : history;
  }

  // Look up a returning visitor by exact ID number. The SHEET is the source of
  // truth: when connected we ask the server live, so a record that's been
  // deleted from the sheet correctly returns nothing (no stale auto-fill).
  // Only with no endpoint at all do we fall back to this browser's memory.
  async function lookupVisitor(id) {
    const key = String(id || "").toLowerCase().trim();
    if (!key) return null;
    if (endpoint) {
      const res = await jsonp(endpoint, { action: "lookup", idNumber: id }, 4000);
      if (res && res.ok) return res.record || null;
      return null;   // unreachable — don't auto-fill from possibly-stale local data
    }
    return history.find((h) => String(h.idNumber || "").toLowerCase().trim() === key) || null;
  }

  // --- events --------------------------------------------------------------
  function wireEvents() {
    form.addEventListener("submit", onSubmit);
    // Any operator activity restarts the inactivity countdown.
    ["keydown", "pointerdown", "input"].forEach((ev) =>
      document.addEventListener(ev, armIdleTimer, true)
    );
    $("resetBtn").addEventListener("click", () => resetForm(true));
    $("banDialogClose").addEventListener("click", clearBanWarning);
    els.idType.addEventListener("change", updateSubList);
    els.subSelect.addEventListener("change", () => {
      if (els.subSelect.value) {
        els.cardIssuer.value = els.subSelect.value;
        els.cardIssuer.classList.remove("filled");
        void els.cardIssuer.offsetWidth;
        els.cardIssuer.classList.add("filled");
      }
    });

    // expiration: NA toggle disables the picker; either control updates the value
    els.expNA.addEventListener("change", () => { reflectExpiryMode(); syncExpiryFromUI(); });
    els.expDate.addEventListener("input", syncExpiryFromUI);

    // returning-visitor autocomplete on name + id number
    els.fullName.addEventListener("input", onNameInput);
    els.idNumber.addEventListener("input", () => showSuggestions(els.idNumber.value, "idNumber"));
    els.fullName.addEventListener("blur", () => setTimeout(hideSuggestions, 120));
    els.idNumber.addEventListener("blur", () => setTimeout(hideSuggestions, 120));
    // Pull a fresh roster from the sheet when the operator starts entering a
    // patron, so type-ahead reflects the sheet's current contents (deletions
    // included) rather than a stale snapshot from page load.
    els.fullName.addEventListener("focus", () => { if (endpoint) loadRoster(); });
    els.idNumber.addEventListener("focus", () => { if (endpoint) loadRoster(); });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { hideSuggestions(); resetForm(true); }
    });

    // barcode scanner (keyboard-wedge) → captured in the scan textarea
    wireScanner();

    // passport camera scanning
    const pBtn = $("scanPassportBtn");
    if (pBtn) pBtn.addEventListener("click", openCamera);
    $("camClose").addEventListener("click", closeCamera);
    $("camCapture").addEventListener("click", () => grabAndRead(true));

    // settings dialog
    const dlg = $("settingsDialog");
    $("settingsBtn").addEventListener("click", () => {
      $("endpointUrl").value = endpoint;
      dlg.showModal();
    });
    dlg.addEventListener("close", () => {
      if (dlg.returnValue === "save") {
        endpoint = $("endpointUrl").value.trim();
        localStorage.setItem(LS_ENDPOINT, endpoint);
        refreshMode();
        if (endpoint) flushQueue();
      }
    });
  }

  // --- barcode scanner -----------------------------------------------------
  // Keyboard-wedge scanners "type" the barcode payload very fast then send
  // Enter. We collect it in the scan textarea (which preserves the LF-separated
  // lines of an AAMVA license), then parse on a short debounce.
  let scanTimer = null;
  let scanStart = 0;

  function wireScanner() {
    els.scanInput.addEventListener("input", () => {
      if (!scanStart) scanStart = performance.now();
      clearTimeout(scanTimer);
      scanTimer = setTimeout(processScan, 140);
    });
    // Don't let the scanner's trailing Enter submit anything from the scan box;
    // embedded newlines (within an AAMVA payload) still register as input.
    els.scanInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        // allow the newline into the textarea but stop form-level side effects
        e.stopPropagation();
      }
    });
  }

  async function processScan() {
    const text = els.scanInput.value;
    const elapsed = performance.now() - scanStart;
    scanStart = 0;
    if (!text.trim()) return;
    clearBanWarning();   // drop any prior patron's flag before reading a new card

    const parsed = window.AAMVA.parse(text);
    if (parsed) {
      fillFromScan(parsed, ["fullName", "idNumber", "idType", "cardIssuer", "expiration"]);
      setScanMsg(`✓ Read ${parsed.cardIssuer || "ID"} — check details, then Enter`, "ok");
      clearScan();
      els.submitBtn.focus();
      return;
    }

    // A plain 1-D barcode (e.g. a university card ID number): no spaces, fast burst.
    const plain = text.trim();
    const looksLikeBarcode = /^[A-Za-z0-9\-]{4,40}$/.test(plain) && elapsed < 600;
    if (looksLikeBarcode) {
      const id = plain.replace(/[^A-Za-z0-9]/g, "");
      fillFromScan({ idNumber: id }, ["idNumber"]);
      clearScan();
      setScanMsg("Barcode read — checking the sheet…", "info");
      // Only auto-fill the rest if this ID actually exists in the sheet right now.
      const match = await lookupVisitor(id);
      if (match && match.fullName) {
        flashFill(els.fullName, match.fullName);
        if (CFG.idTypes.includes(match.idType)) flashFill(els.idType, match.idType);
        if (match.cardIssuer) flashFill(els.cardIssuer, match.cardIssuer);
        if (match.expiration) setExpiration(match.expiration);
        updateSubList();
        setScanMsg(`✓ Returning visitor: ${match.fullName} — check details, then Enter`, "ok");
        els.submitBtn.focus();
      } else {
        setScanMsg("Barcode read — choose ID Type & confirm name", "info");
        els.idType.focus();
      }
      return;
    }

    setScanMsg("Couldn't auto-read that card — please enter details manually below.", "err");
    clearScan();
    els.fullName.focus();
  }

  function fillFromScan(data, fields) {
    const map = {
      fullName: els.fullName, idNumber: els.idNumber, idType: els.idType,
      cardIssuer: els.cardIssuer, expiration: els.expiration,
    };
    for (const f of fields) {
      if (data[f] == null || data[f] === "") continue;
      if (f === "idType" && !CFG.idTypes.includes(data[f])) continue;
      let el = map[f];
      if (f === "expiration") {
        setExpiration(data[f]);       // routes "NA"/"MM/DD/YYYY" into the picker/toggle
        el = els.expNA.checked ? els.expNA : els.expDate;
      } else {
        el.value = data[f];
      }
      el.classList.remove("filled");
      void el.offsetWidth;            // restart the flash animation
      el.classList.add("filled");
    }
    updateSubList();   // a scan sets idType programmatically (no change event)
  }

  function clearScan() {
    els.scanInput.value = "";
    clearTimeout(scanTimer);
  }

  function setScanMsg(text, cls) {
    els.scanMsg.textContent = text;
    els.scanMsg.className = "scanmsg" + (cls ? " " + cls : "");
  }

  // --- passport camera + OCR ----------------------------------------------
  // Captures frames from the webcam, OCRs the lower "code" region, and hands
  // the raw text to window.Passport (the library-backed reader) to interpret.
  let stream = null;
  let worker = null;
  let scanning = false;

  function setCamStatus(t) { $("camStatus").textContent = t; }

  const MRZ_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<";

  // Prefer an OCR-B model (the passport code font); fall back to English.
  async function createReader() {
    const T = window.Tesseract;
    try {
      const w = await T.createWorker("ocrb", 1, {
        langPath: "https://raw.githubusercontent.com/Shreeshrii/tessdata_ocrb/master",
        gzip: false,
      });
      await w.setParameters({ tessedit_char_whitelist: MRZ_CHARS, tessedit_pageseg_mode: "6" });
      return w;
    } catch (e) {
      const w = await T.createWorker("eng");
      await w.setParameters({ tessedit_char_whitelist: MRZ_CHARS, tessedit_pageseg_mode: "6" });
      return w;
    }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("load failed: " + src));
      document.head.appendChild(s);
    });
  }

  async function openCamera() {
    $("cameraDialog").showModal();
    setCamStatus("Starting camera…");
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
    } catch (e) {
      try { stream = await navigator.mediaDevices.getUserMedia({ video: true }); }
      catch (err) { setCamStatus("Cannot access camera: " + err.message); return; }
    }
    const video = $("camVideo");
    video.srcObject = stream;
    await video.play();

    setCamStatus("Loading reader (first time downloads a small model)…");
    try {
      if (!window.Tesseract) await loadScript("https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js");
      worker = await createReader();
    } catch (e) {
      setCamStatus("Couldn't load the reader (no internet?). You can still type the details manually.");
      return;
    }

    setCamStatus("Hold the passport steady inside the box…");
    scanning = true;
    scanLoop();
  }

  async function scanLoop() {
    if (!scanning) return;
    const ok = await grabAndRead(false);
    if (scanning && !ok) setTimeout(scanLoop, 400);
  }

  // Otsu's method — picks the best black/white threshold for the lighting.
  function otsuThreshold(gray, n) {
    const hist = new Array(256).fill(0);
    for (let i = 0; i < n; i++) hist[gray[i]]++;
    let total = 0;
    for (let t = 0; t < 256; t++) total += t * hist[t];
    let sumB = 0, wB = 0, max = 0, thr = 127;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      const wF = n - wB;
      if (wF === 0) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (total - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > max) { max = between; thr = t; }
    }
    return thr;
  }

  // Crops the guide band, OCRs it, and asks the parser to interpret it.
  // Returns true if a record was accepted. `manual` relaxes the accept rule.
  async function grabAndRead(manual) {
    if (!worker) return false;
    const video = $("camVideo");
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw) return false;

    // Map the on-screen guide box to source pixels, accounting for the
    // object-fit:cover scaling/cropping of the video element.
    const dispW = video.clientWidth || vw, dispH = video.clientHeight || vh;
    const cover = Math.max(dispW / vw, dispH / vh);
    const visW = dispW / cover, visH = dispH / cover;     // source area actually shown
    const offX = (vw - visW) / 2, offY = (vh - visH) / 2;
    // guide box fractions — kept in sync with .camera__guide in styles.css
    const gL = 0.04, gW = 0.92, gT = 0.52, gH = 0.42;
    const sx = offX + gL * visW, sw = gW * visW;
    const sy = offY + gT * visH, sh = gH * visH;

    const canvas = $("camCanvas");
    const scale = 1500 / sw;                                // upscale for OCR
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(sh * scale);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    // grayscale → Otsu threshold → black text on white
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data, n = canvas.width * canvas.height;
    const gray = new Uint8Array(n);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      gray[j] = (0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) | 0;
    }
    const thr = otsuThreshold(gray, n);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const v = gray[j] > thr ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);

    let text = "";
    try { text = (await worker.recognize(canvas)).data.text || ""; }
    catch { return false; }

    const res = text && window.Passport ? await window.Passport.parse(text) : null;
    if (res && (res.valid || (manual && res.idNumber))) {
      acceptPassport(res, res.valid);
      return true;
    }
    if (manual) {
      const seen = String(text).toUpperCase().replace(/[^A-Z0-9<\n]/g, "")
        .split(/\n+/).filter((l) => l.length >= 8).join("  |  ").slice(0, 100);
      setCamStatus(seen ? "OCR saw:  " + seen : "Couldn't read — line up the two code rows and try again.");
    }
    return false;
  }

  function acceptPassport(res, clean) {
    scanning = false;
    fillFromScan(res, ["fullName", "idNumber", "idType", "cardIssuer", "expiration"]);
    setScanMsg(
      clean ? "✓ Read passport — check details, then Enter"
            : "⚠ Read passport (low confidence) — please verify every field",
      clean ? "ok" : "info"
    );
    closeCamera();
    els.submitBtn.focus();
  }

  async function closeCamera() {
    scanning = false;
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    if (worker) { try { await worker.terminate(); } catch {} worker = null; }
    const dlg = $("cameraDialog");
    if (dlg.open) dlg.close();
  }

  // --- autocomplete --------------------------------------------------------
  let sugIndex = -1;
  let sugItems = [];
  let nameAutofilled = false;   // true while the form was filled from a name match

  // Live, type-ahead fill on the name field: as soon as what you've typed is a
  // prefix of a returning visitor, complete the name (highlighting the rest)
  // and fill the other fields from that person — no click or Enter needed.
  function onNameInput(e) {
    const deleting = !!(e && /^delete/.test(e.inputType || ""));
    const raw = els.fullName.value;
    showSuggestions(raw, "fullName");

    const q = raw.trim().toLowerCase();
    if (!deleting && q.length >= 2) {
      const match = candidates()
        .filter((h) => (h.fullName || "").toLowerCase().startsWith(q))
        .sort((a, b) => (b.count || 0) - (a.count || 0))[0];
      if (match) {
        inlineComplete(match.fullName, q.length);
        fillFromHistory(match);
        nameAutofilled = true;
        return;
      }
    }
    // No match (or they're deleting): undo a previous auto-fill so stale
    // details from another person never ride along.
    if (nameAutofilled) { clearAutofill(); nameAutofilled = false; }
  }

  // Replace the input with the full matched name, keeping the cursor after what
  // they typed and selecting the completed tail (so the next keystroke or
  // Delete replaces it). `start` is how many characters they actually typed.
  function inlineComplete(full, start) {
    els.fullName.value = full;
    try { els.fullName.setSelectionRange(Math.min(start, full.length), full.length); }
    catch { /* setSelectionRange not supported here */ }
  }

  // Fill the remaining fields from a remembered visitor, flashing each one.
  function fillFromHistory(h) {
    flashFill(els.idNumber, h.idNumber || "");
    if (CFG.idTypes.includes(h.idType)) flashFill(els.idType, h.idType);
    flashFill(els.cardIssuer, h.cardIssuer || CFG.defaults.cardIssuer || "");
    setExpiration(h.expiration || CFG.defaults.expiration || "");
    updateSubList();
  }

  // Revert the auto-filled fields to their blank/default state.
  function clearAutofill() {
    els.idNumber.value = "";
    els.cardIssuer.value = CFG.defaults.cardIssuer || "";
    setExpiration(CFG.defaults.expiration || "");
    updateSubList();
    clearBanWarning();
  }

  function flashFill(el, val) {
    el.value = val;
    el.classList.remove("filled");
    void el.offsetWidth;          // restart the flash animation
    el.classList.add("filled");
  }

  // --- banned-patron warning ----------------------------------------------
  // A patron flagged "Banned Patriot" in the sheet (column G, set by staff —
  // never collected by this form) trips a loud animated red alert so the desk
  // stops and escalates instead of checking them in.
  function isBanned(rec) {
    const v = String((rec && rec.banned) ?? "").trim().toLowerCase();
    return v === "y" || v === "yes" || v === "true" || v === "1";
  }

  // Look the patron being checked in up against the known roster and return the
  // matching record only if it's flagged banned. Keyed on ID Number (or Full
  // Name when blank), matching the sheet's own upsert key. The roster is the
  // source of truth when connected; offline history carries no ban flag.
  function bannedRecordFor(row) {
    const id = String(row.idNumber || "").toLowerCase().trim();
    const name = String(row.fullName || "").toLowerCase().trim();
    const rec = candidates().find((h) =>
      id
        ? String(h.idNumber || "").toLowerCase().trim() === id
        : (name && String(h.fullName || "").toLowerCase().trim() === name)
    );
    return rec && isBanned(rec) ? rec : null;
  }

  function showBanWarning(name) {
    const el = els.banDialog;
    if (!el) return;
    els.banDialogName.textContent = name ? `Patron: ${name}` : "";
    if (!el.open) el.showModal();
  }

  function clearBanWarning() {
    const el = els.banDialog;
    if (!el) return;
    if (el.open) el.close();
    els.banDialogName.textContent = "";
  }

  function showSuggestions(q, field) {
    q = q.trim().toLowerCase();
    if (q.length < 2) return hideSuggestions();
    sugItems = candidates()
      .filter((h) => (h[field] || "").toLowerCase().includes(q))
      .sort((a, b) => (b.count || 0) - (a.count || 0))
      .slice(0, 6);
    if (!sugItems.length) return hideSuggestions();

    els.suggestions.innerHTML = sugItems
      .map(
        (h, i) =>
          `<li data-i="${i}" class="${i === 0 ? "active" : ""}">
             <div>${escapeHtml(h.fullName)} <span class="s-sub">· ${escapeHtml(h.idNumber)}</span></div>
             <div class="s-sub">${escapeHtml(h.idType)} · ${escapeHtml(h.cardIssuer)}</div>
           </li>`
      )
      .join("");
    els.suggestions.hidden = false;
    sugIndex = 0;

    els.suggestions.querySelectorAll("li").forEach((li) =>
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        pickSuggestion(sugItems[+li.dataset.i]);
      })
    );

    // arrow-key navigation, bound once per open
    const activeInput = field === "fullName" ? els.fullName : els.idNumber;
    activeInput.onkeydown = (e) => {
      if (els.suggestions.hidden) return;
      if (e.key === "ArrowDown") { e.preventDefault(); moveSel(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); moveSel(-1); }
      else if (e.key === "Enter" && sugIndex >= 0) {
        e.preventDefault();
        pickSuggestion(sugItems[sugIndex]);
      }
    };
  }

  function moveSel(dir) {
    const lis = [...els.suggestions.querySelectorAll("li")];
    if (!lis.length) return;
    lis[sugIndex]?.classList.remove("active");
    sugIndex = (sugIndex + dir + lis.length) % lis.length;
    lis[sugIndex].classList.add("active");
    lis[sugIndex].scrollIntoView({ block: "nearest" });
  }

  function pickSuggestion(h) {
    if (!h) return;
    els.fullName.value = h.fullName;
    els.idNumber.value = h.idNumber;
    els.idType.value = CFG.idTypes.includes(h.idType) ? h.idType : els.idType.value;
    els.cardIssuer.value = h.cardIssuer || CFG.defaults.cardIssuer || "";
    setExpiration(h.expiration || CFG.defaults.expiration || "");
    hideSuggestions();
    els.submitBtn.focus();
  }

  function hideSuggestions() {
    els.suggestions.hidden = true;
    sugIndex = -1;
    sugItems = [];
    els.fullName.onkeydown = null;
    els.idNumber.onkeydown = null;
  }

  // --- submit --------------------------------------------------------------
  async function onSubmit(e) {
    e.preventDefault();
    hideSuggestions();
    syncExpiryFromUI();
    // require an explicit choice: a real date or the NA toggle
    els.expDate.setCustomValidity(
      els.expNA.checked || els.expDate.value ? "" : "Pick a date, or tick NA if the card has none."
    );
    if (!form.reportValidity()) return;

    const row = {
      timestamp: formatTimestamp(new Date()),
      fullName: els.fullName.value.trim(),
      idNumber: els.idNumber.value.trim(),
      idType: els.idType.value,
      cardIssuer: els.cardIssuer.value.trim(),
      expiration: els.expiration.value.trim(),
    };

    // Stop a banned patron at the point of check-in: raise the loud alert and
    // don't record the visit, so the desk escalates instead of waving them in.
    const banned = bannedRecordFor(row);
    if (banned) { showBanWarning(banned.fullName || row.fullName); return; }

    // ignore an accidental repeat of the exact same person within a few seconds
    const sig = (row.idNumber || row.fullName || "").toLowerCase().trim();
    if (sig && sig === lastSubmitSig && Date.now() - lastSubmitAt < 4000) return;
    lastSubmitSig = sig;
    lastSubmitAt = Date.now();

    // A second sign-in by the same patron within 24h is a return entry, not a
    // fresh check-in — check before rememberVisitor updates the last-seen time.
    const isReturn = isReturnVisit(row);

    // Optimistic: confirm instantly and reset for the next patron. The write
    // runs in the background — the offline queue + the idempotent upsert make
    // it safe even if a send is slow and has to retry.
    if (isReturn) {
      toast(`${row.fullName} · already signed in today`, "return", { title: "Return entry" });
    } else {
      toast(row.fullName, "ok", { title: "Checked in" });
    }
    rememberVisitor(row);
    addRecent(row);
    resetForm(false);

    sendRow(row).then((res) => {
      if (res === false) {
        toast(`${row.fullName} — the server rejected this. Check the sheet.`, "err", { title: "Not saved", duration: 7000 });
      }
    });
  }

  // returns "live" | "queued" | false
  // Uses JSONP: Apps Script doesn't send CORS headers, so we load the response
  // via a <script> tag. GET follows Google's redirect cleanly and we get a real
  // result back (unlike a no-cors POST, which is write-only and can't confirm).
  async function sendRow(row) {
    if (!endpoint) { enqueue(row); return "queued"; }
    const res = await jsonp(endpoint, row);
    if (res && res.ok) return "live";
    if (res && res.ok === false) {
      console.warn("Script error:", res.error);
      return false;                 // script ran but rejected the row
    }
    enqueue(row);                    // network/timeout — keep it safe offline
    return "queued";
  }

  // Calls the endpoint with params + a callback; resolves with the parsed
  // response, or null on network error / timeout.
  function jsonp(url, params, timeoutMs = 2500) {
    return new Promise((resolve) => {
      const cb = "cb_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
      const qs = new URLSearchParams({ ...params, callback: cb }).toString();
      const src = url + (url.includes("?") ? "&" : "?") + qs;
      const script = document.createElement("script");
      let done = false;
      const finish = (val) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        delete window[cb];
        script.remove();
        resolve(val);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      window[cb] = (data) => finish(data);
      script.onerror = () => finish(null);
      script.src = src;
      document.head.appendChild(script);
    });
  }

  // --- offline queue -------------------------------------------------------
  function enqueue(row) {
    const q = load(LS_QUEUE, []);
    q.push(row);
    save(LS_QUEUE, q);
  }
  function queueSize() { return load(LS_QUEUE, []).length; }
  async function flushQueue() {
    if (!endpoint) return;
    const q = load(LS_QUEUE, []);
    if (!q.length) return;
    const remaining = [];
    for (const row of q) {
      const ok = await sendRow(row);
      if (ok !== "live") remaining.push(row);
    }
    save(LS_QUEUE, remaining);
    if (!remaining.length) toast("Offline rows synced to the sheet", "ok", { title: "Back online" });
  }

  // --- return-entry detection ---------------------------------------------
  const SESSION_MS = 24 * 60 * 60 * 1000;   // a 24-hour sign-in session

  // True when this patron already has a sign-in within the last 24 hours, so
  // the current submission is a return entry rather than a first check-in.
  // Reads from this browser's history (which carries the last-seen time), so it
  // works offline; the desk runs one consistent browser per session.
  function isReturnVisit(row) {
    const key = String(row.idNumber || "").toLowerCase().trim();
    if (!key) return false;
    const prev = history.find((h) => String(h.idNumber || "").toLowerCase().trim() === key);
    const t = prev && prev.last ? parseTimestamp(prev.last) : null;
    return t != null && Date.now() - t < SESSION_MS;
  }

  // Parse the "DD/MM/YYYY HH:MM:SS" string formatTimestamp produces back to ms.
  function parseTimestamp(s) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(String(s || "").trim());
    if (!m) return null;
    return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]).getTime();
  }

  // --- returning-visitor memory -------------------------------------------
  function rememberVisitor(row) {
    const key = row.idNumber.toLowerCase();
    const existing = history.find((h) => h.idNumber.toLowerCase() === key);
    if (existing) {
      Object.assign(existing, row, { count: (existing.count || 1) + 1, last: row.timestamp });
    } else {
      history.unshift({ ...row, count: 1, last: row.timestamp });
    }
    if (history.length > 2000) history.length = 2000;
    save(LS_HISTORY, history);
  }

  // --- recent list ---------------------------------------------------------
  function addRecent(row) {
    sessionCount++;
    lastRecent = row;
    renderRecent();
    // auto-clear the name from the screen after 10s for patron privacy
    clearTimeout(recentTimer);
    recentTimer = setTimeout(() => { lastRecent = null; renderRecent(); }, 10000);
  }
  function renderRecent() {
    els.recentCount.textContent = sessionCount ? `(${sessionCount} this session)` : "";
    if (lastRecent) {
      const r = lastRecent;
      els.recentList.innerHTML =
        `<li><span>${escapeHtml(r.fullName)} <span class="r-meta">· ${escapeHtml(r.idType)}</span></span>
             <span class="r-meta">${escapeHtml(r.timestamp.split(" ")[1] || "")}</span></li>`;
    } else if (sessionCount) {
      els.recentList.innerHTML = `<li class="recent-empty">Last entry cleared for privacy</li>`;
    } else {
      els.recentList.innerHTML = "";
    }
  }

  // --- helpers -------------------------------------------------------------
  function resetForm(full) {
    form.reset();
    nameAutofilled = false;
    applyDefaults();
    els.idType.value = "";       // no remembered type — start blank every time
    updateSubList();
    clearBanWarning();
    if (full) setScanMsg("", "");
    clearScan();
    armIdleTimer();
    els.scanInput.focus();
  }

  // --- toast notifications -------------------------------------------------
  // Modern stacked toasts: a glass card springs up from the bottom with a
  // colored icon chip, an optional title, and a self-draining progress bar.
  // Hovering pauses the countdown; the ✕ (or the timer) dismisses it.
  const TOAST_ICONS = { ok: "check_circle", return: "history", err: "error", info: "info" };

  function toast(text, kind = "ok", opts = {}) {
    const host = $("toastHost");
    if (!host) return null;
    const duration = opts.duration ?? 4200;

    const el = document.createElement("div");
    el.className = "toast toast--" + kind;
    el.setAttribute("role", kind === "err" ? "alert" : "status");

    const icon = document.createElement("span");
    icon.className = "toast__icon msym";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = TOAST_ICONS[kind] || "notifications";

    const body = document.createElement("div");
    body.className = "toast__body";
    if (opts.title) {
      const t = document.createElement("div");
      t.className = "toast__title";
      t.textContent = opts.title;     // textContent: safe for patron names
      body.appendChild(t);
    }
    const tx = document.createElement("div");
    tx.className = "toast__text";
    tx.textContent = text;
    body.appendChild(tx);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "toast__close";
    close.setAttribute("aria-label", "Dismiss");
    const closeIcon = document.createElement("span");
    closeIcon.className = "msym";
    closeIcon.setAttribute("aria-hidden", "true");
    closeIcon.textContent = "close";
    close.appendChild(closeIcon);

    const bar = document.createElement("span");
    bar.className = "toast__bar";
    bar.style.setProperty("--dur", duration + "ms");

    el.append(icon, body, close, bar);
    host.appendChild(el);

    // Don't let a busy desk pile up an endless stack.
    while (host.children.length > 4) host.firstElementChild.remove();

    let timer = null;
    const dismiss = () => {
      if (el.dataset.closing) return;
      el.dataset.closing = "1";
      clearTimeout(timer);
      el.classList.add("toast--out");
      el.addEventListener("animationend", () => el.remove(), { once: true });
      setTimeout(() => el.remove(), 400);   // safety net if the anim doesn't fire
    };
    const start = () => { clearTimeout(timer); timer = setTimeout(dismiss, duration); };

    close.addEventListener("click", dismiss);
    el.addEventListener("mouseenter", () => { clearTimeout(timer); bar.style.animationPlayState = "paused"; });
    el.addEventListener("mouseleave", () => { bar.style.animationPlayState = "running"; start(); });

    start();
    return el;
  }

  function formatTimestamp(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ` +
           `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function load(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  }
  function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  init();
})();
