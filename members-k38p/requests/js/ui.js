/* ממשק "בקשת סגירה אווירית": קלט -> הרצת כל הבדיקות -> טופס, מפה, KML, מייל. כל כשל בבדיקה חוסם את "מוכן לשליחה". */
(function () {
  "use strict";
  const C = window.ReqCore, O = window.ReqOut, M = window.ReqMap, $ = id => document.getElementById(id);
  const S = { cfg: null, data: {}, res: null, statuses: {}, map: null, overview: null, aerial: null, manual: [], manualKey: "", reviewAt: null, pick: false, scanKey: null, stale: false, running: false, center: null, autoSite: "", lf: {}, report: null };
  const PERSON_KEY = "icd_req_person_v1";
  const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", OSM = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const esc = C.esc;

  /* ---------- עזרים ---------- */
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* פרטיות/חסימה */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  async function getJson(url) {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(url + " — HTTP " + r.status);
    return r.json();
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));
  function setStatus(k, ok, msg) { S.statuses[k] = { ok: !!ok, msg: msg || "" }; refreshGate(); }

  /* ---------- טעינת נתונים סטטיים ---------- */
  async function loadStatic() {
    try { S.cfg = await getJson("config.json"); }
    catch (e) { $("e_run").textContent = "לא נטען קובץ ההגדרות: " + e.message; return false; }
    buildControls();
    const jobs = [
      ["a17", Promise.all([getJson("../data/zones.json"), getJson("../data/inpa-zones.json"), getJson("../data/pmt-b09-rules.json")]).then(([z, i, r9]) => { z.rules09 = r9; S.data.zones = z; S.data.inpa = i; return (z.edition || "") + " · " + z.zones.length + " אזורים, " + i.sites.length + " אתרי רט״ג"; })],
      ["agri", getJson("../data/agri-airstrips.json").then(a => { S.data.agri = a; return a.airstrips.length + " מנחתים"; })],
      ["notam", loadNotams()]
    ];
    await Promise.all(jobs.map(([k, p]) => p.then(m => setStatus(k, true, m), e => setStatus(k, false, "לא נטען: " + (e && e.message ? e.message : e)))));
    await checkSync();
    setInterval(checkSync, 15 * 60 * 1000);   // גם בדף שנשאר פתוח שעות
    return true;
  }
  async function loadNotams() {
    const d = await getJson("../../notam-all.json");
    if (!d || !Array.isArray(d.notams)) throw new Error("אין נתוני נוטמים");
    const missing = (d.failed && d.failed.length) || (d.listed > d.count ? d.listed - d.count : 0);
    if (missing) throw new Error("הקובץ אינו שלם: חסרים פרטים ל-" + missing + " נוטמים" + (d.failed && d.failed.length ? " (" + d.failed.join(", ") + ")" : "") + " — ממתינים לעדכון הבא");
    S.data.notams = d.notams; S.data.notamFetchedIso = d.fetched_iso;
    return d.notams.length + " נוטמים, נמשכו " + d.fetched_at;
  }

  /* ---------- סנכרון עם מפת החברים: המפה מתעדכנת בפרויקט אחר, ואסור לעבוד על מידע ישן ---------- */
  let syncBusy = null;
  async function checkSync() {
    if (syncBusy) return syncBusy;
    syncBusy = (async () => {
      try {
        const getText = async u => { const r = await fetch(u, { cache: "no-cache" }); if (!r.ok) throw new Error(u + " — HTTP " + r.status); return r.text(); };
        // הנוטמים נטענים מחדש כדי להשוות לגרסה העדכנית ביותר
        const [html, meta, mapNotam, nAll] = await Promise.all([getText("../index.html"), getJson("../pamat-meta.json"), getJson("../../notam-data.json"), getJson("../../notam-all.json")]);
        const res = await window.ReqSync.check({ html, meta, zones: S.data.zones, cfg: S.cfg, mapNotam, notamAll: nAll });
        setStatus("sync", res.ok, res.problems.join(" · "));
        const b = $("syncBanner");
        if (res.ok) b.style.display = "none"; else { b.style.display = "block"; b.innerHTML = "<b>הנתונים אינם מסונכרנים עם מפת החברים — אי אפשר להשלים בקשה עד שהסנכרון יושלם.</b><ul>" + res.problems.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul>"; }
        S.syncAt = new Date();
        return res.ok;
      } catch (e) {
        setStatus("sync", false, "לא ניתן לאמת סנכרון עם המפה: " + (e && e.message ? e.message : e));
        return false;
      } finally { syncBusy = null; }
    })();
    return syncBusy;
  }

  /* ---------- בקרי הטופס ---------- */
  function buildControls() {
    $("purpose").innerHTML = '<option value="">בחרו…</option>' + S.cfg.purposes.map(p => '<option>' + esc(p) + "</option>").join("");
    $("aircraft").innerHTML = S.cfg.aircraft.map((a, i) => '<label><input type="checkbox" name="ac" value="' + esc(a) + '"' + (i === 0 ? " checked" : "") + "> " + esc(a) + "</label>").join("");
    $("radius").value = S.cfg.defaults.radius_m; $("radius").min = S.cfg.defaults.min_radius_m; $("radius").max = S.cfg.defaults.max_radius_m;
    $("mailTo").textContent = S.cfg.mail.to.join(", ");
    try {
      const p = JSON.parse(ls.get(PERSON_KEY) || "null");
      if (p) { $("reqName").value = p.reqName || ""; $("reqPhone").value = p.reqPhone || ""; $("contactNames").value = p.contactNames || ""; $("contactPhone").value = p.contactPhone || ""; $("personBox").open = !(p.reqName && p.contactNames); }
    } catch (e) { /* ignore */ }
  }
  function savePerson() {
    ls.set(PERSON_KEY, JSON.stringify({ reqName: $("reqName").value, reqPhone: $("reqPhone").value, contactNames: $("contactNames").value, contactPhone: $("contactPhone").value }));
  }
  function readInputs() {
    const c = C.parseCoordInput($("coord").value) || S.center || {};
    return {
      lat: c.lat, lon: c.lon, radius: parseFloat($("radius").value), heightM: parseFloat($("height").value),
      dateFrom: $("dateFrom").value, dateTo: $("dateTo").value || $("dateFrom").value, timeFrom: $("timeFrom").value, timeTo: $("timeTo").value,
      purpose: $("purpose").value, aircraft: [...document.querySelectorAll('input[name="ac"]:checked')].map(i => i.value),
      vlos: $("vlos").value === "yes", siteName: $("siteName").value.trim(),
      requesterName: $("reqName").value.trim(), requesterPhone: $("reqPhone").value.trim(), contactNames: $("contactNames").value.trim(), contactPhone: $("contactPhone").value.trim()
    };
  }
  const scanKey = () => { const i = readInputs(); return JSON.stringify([i.lat, i.lon, i.radius, i.heightM, i.dateFrom, i.dateTo, i.timeFrom, i.timeTo]); };
  function showErrors(errs) {
    document.querySelectorAll(".err[id^=e_]").forEach(e => { if (e.id !== "e_run") e.textContent = ""; });
    document.querySelectorAll("input.bad,select.bad").forEach(e => e.classList.remove("bad"));
    const idMap = { coord: "coord", radius: "radius", height: "height", dateFrom: "dateFrom", dateTo: "dateTo", timeFrom: "timeFrom", timeTo: "timeTo", purpose: "purpose", aircraft: null, siteName: "siteName", requester: "reqName", contacts: "contactNames" };
    errs.forEach(e => { const el = $("e_" + e.field); if (el) el.textContent = e.msg; const inp = idMap[e.field] && $(idMap[e.field]); if (inp) inp.classList.add("bad"); });
  }

  /* ---------- מפה חיה (Leaflet) ---------- */
  function initMap() {
    if (typeof L === "undefined") { $("map").innerHTML = '<div class="hint" style="padding:20px">המפה לא נטענה (אין חיבור לספריית המפות). אפשר להקליד קואורדינטות בשדה.</div>'; return; }
    const m = L.map("map").setView([31.9, 35.0], 8);
    const sat = L.tileLayer(ESRI, { maxZoom: 19, attribution: "Esri World Imagery" }), osm = L.tileLayer(OSM, { maxZoom: 19, attribution: "OpenStreetMap" });
    sat.addTo(m);
    $("baseSat").onclick = () => { m.removeLayer(osm); sat.addTo(m); };
    $("baseOsm").onclick = () => { m.removeLayer(sat); osm.addTo(m); };
    m.on("click", e => {
      if (S.pick) { S.pick = false; $("mCoord").value = e.latlng.lat.toFixed(6) + ", " + e.latlng.lng.toFixed(6); $("mPick").textContent = "בחר מיקום מהמפה"; $("mCoord").scrollIntoView({ behavior: "smooth", block: "center" }); return; }
      setCenter(e.latlng.lat, e.latlng.lng, false);
    });
    S.lf = { m, sat, osm, marker: null, green: null, orange: null };
  }
  function drawCircles() {
    if (!S.lf.m || !S.center) return;
    const R = parseFloat($("radius").value) || 0, ll = [S.center.lat, S.center.lon];
    if (!S.lf.marker) {
      S.lf.marker = L.marker(ll, { draggable: true }).addTo(S.lf.m);
      S.lf.marker.on("dragend", () => { const p = S.lf.marker.getLatLng(); setCenter(p.lat, p.lng, true); });
      S.lf.orange = L.circle(ll, { radius: 2 * R, color: "#ff9500", weight: 3, fillColor: "#ff9500", fillOpacity: 0.12 }).addTo(S.lf.m);
      S.lf.green = L.circle(ll, { radius: R, color: "#22c55e", weight: 3, fillColor: "#22c55e", fillOpacity: 0.22 }).addTo(S.lf.m);
    } else { S.lf.marker.setLatLng(ll); S.lf.orange.setLatLng(ll).setRadius(2 * R); S.lf.green.setLatLng(ll).setRadius(R); }
  }
  function setCenter(lat, lon, fromInput) {
    S.center = { lat, lon };
    if (!fromInput) $("coord").value = lat.toFixed(6) + ", " + lon.toFixed(6);
    drawCircles();
    if (S.lf.m) { const z = S.lf.m.getZoom(); if (z < 15 || !S.lf.m.getBounds().contains([lat, lon])) S.lf.m.setView([lat, lon], Math.max(z, 16)); }
    onScanInputChange();
  }
  async function searchPlace() {
    const q = $("q").value.trim(); if (!q) return;
    $("qMsg").textContent = "מחפש…"; $("places").innerHTML = "";
    try {
      const r = await fetch("https://nominatim.openstreetmap.org/search?" + new URLSearchParams({ format: "jsonv2", q, "accept-language": "he", countrycodes: "il,ps", limit: 6 }));
      const j = await r.json();
      $("qMsg").textContent = j.length ? "בחרו תוצאה:" : "לא נמצאו תוצאות.";
      $("places").innerHTML = j.map((x, i) => '<button type="button" data-i="' + i + '">' + esc(x.display_name) + "</button>").join("");
      $("places").querySelectorAll("button").forEach(b => b.onclick = () => { const x = j[+b.dataset.i]; setCenter(+x.lat, +x.lon, false); $("places").innerHTML = ""; $("qMsg").textContent = ""; });
    } catch (e) { $("qMsg").textContent = "החיפוש נכשל (" + e.message + "). אפשר להקליד קואורדינטות."; }
  }

  /* ---------- שער "מוכן לשליחה" ---------- */
  function refreshGate() {
    const box = $("gate"); if (!box) return;
    if (!S.res) { $("resultsSec").style.display = "none"; return; }
    $("resultsSec").style.display = "block";
    const g = C.gate(S.statuses);
    S.ready = g.ready && !S.stale;
    const w = warnings();
    let html = "";
    if (S.stale) html += '<div class="banner no">הנתונים בטופס השתנו מאז הרצת הבדיקות. יש ללחוץ שוב על "הרץ את כל הבדיקות" לפני שליחה.</div>';
    html += S.ready ? '<div class="banner ok">✔ כל הבדיקות הושלמו ללא כשל. הבקשה מוכנה לשליחה.</div>'
      : '<div class="banner no">✖ הבקשה אינה מוכנה לשליחה — בדיקות שלא הושלמו:<ul>' + g.failing.map(f => "<li>" + esc(f.label) + ": " + esc(f.msg) + "</li>").join("") + "</ul></div>";
    html += w.map(x => '<div class="banner warn">' + x + "</div>").join("");
    box.innerHTML = html;
    ["btnPrint", "btnDocx", "btnKml", "btnPng", "btnOverview", "btnAerial", "btnCopy", "btnDrive", "btnSend"].forEach(id => { $(id).disabled = !S.ready; });
    $("btnMail").querySelector("button").disabled = !S.ready;
    $("btnMail").style.pointerEvents = S.ready ? "" : "none";
    if (S.report) renderReport();
  }
  function warnings() {
    const out = [], r = S.res; if (!r) return out;
    const th = S.cfg.thresholds;
    if (r.nearScan.inside.length) out.push("<b>נמצאו מכשולים או תשתיות בתוך האזור המיועד לטיסה (" + r.nearScan.inside.length + "):</b> " + esc(r.nearScan.inside.map(O.itemText).join("; ")) + ".");
    const bl = r.nearScan.items.filter(i => /^בלון/.test(i.label));
    if (bl.length) out.push("<b>נמצא בלון (אטרקציה/מעוגן) בקרבת האזור:</b> " + esc(bl.map(O.itemText).join("; ")) + ". גובה ההעלאה ושעות ההפעלה אינם ידועים — יש לוודא מול מפעיל הבלון.");
    const sites = r.nearScan.near; if (sites.length) out.push("<b>אתרים ותשתיות בקרבת האזור (" + sites.length + "):</b> " + esc(sites.map(O.itemText).join("; ")) + ".");
    const a17in = r.zones.inside.filter(z => z.src === "a17"), b09in = r.zones.inside.filter(z => z.src === "b09"), b09near = r.zones.near.filter(z => z.src === "b09");
    if (a17in.length) out.push("<b>הסגירה המבוקשת חופפת לאזור איסור/הגבלה:</b> " + esc(a17in.map(z => z.label).join("; ")) + ".");
    if (b09in.length) out.push("<b>הסגירה המבוקשת בתוך אזור טיסה לכטב״ם (פרק ב-09):</b> " + esc(b09in.map(z => z.label + " (" + z.alt + ")").join("; ")) + ". יש לעיין בהערות האזור ובתיאום הנדרש (דף הבדיקות).");
    if (b09near.length) out.push("<b>בקרבת אזור טיסה לכטב״ם (פרק ב-09):</b> " + esc(b09near.map(z => z.label + " — " + C.fmtDist(z.d)).join("; ")) + ". סעיף 7(ג): מרחק של לפחות 500 מ׳ מגבול אזור הפעילות (דף הבדיקות).");
    const bv = r.borders.filter(b => b.violates); if (bv.length) out.push("<b>הסגירה נכנסת לרצועת הגבול:</b> " + esc(bv.map(b => b.name + " (" + b.km + " ק״מ)").join("; ")) + ".");
    if (r.workingDays != null && r.workingDays < th.min_working_days) out.push("הבקשה מוגשת " + r.workingDays + " ימי עבודה לפני מועד הפעילות; הנוהל (א-11 סעיף 6.ב) דורש לפחות " + th.min_working_days + " ימי עבודה (ספירה א׳–ה׳, בלי חגים).");
    if (r.notamAgeH != null && r.notamAgeH > th.notam_warn_age_h) out.push("נתוני הנוטמים נמשכו לפני " + Math.round(r.notamAgeH) + " שעות.");
    return out;
  }

  /* ---------- הרצה ---------- */
  function progress(items) {
    $("progress").innerHTML = items.map(i => '<li><span class="s ' + i.s + '">' + ({ ok: "✔", no: "✖", wait: "…" }[i.s]) + "</span><span>" + esc(i.t) + (i.m ? ' <span class="hint">' + esc(i.m) + "</span>" : "") + "</span></li>").join("");
  }
  async function run() {
    if (S.running) return;
    if (!window.ReqAuth.loggedIn()) { window.ReqAuth.show(); return; }
    $("e_run").textContent = "";
    const inp0 = readInputs();
    const errs = C.validateInput(Object.assign({}, inp0, { siteName: inp0.siteName || "-" }), S.cfg);
    if (inp0.dateFrom && inp0.dateFrom < C.ilToday(new Date())) errs.push({ field: "dateFrom", msg: "תאריך ההתחלה כבר עבר" });
    showErrors(errs);
    if (errs.length) { setStatus("input", false, errs.map(e => e.msg).join(" · ")); $("e_run").textContent = "יש להשלים את השדות המסומנים."; return; }
    await checkSync();
    for (const k of ["a17", "sync", "agri", "notam"]) if (!(S.statuses[k] && S.statuses[k].ok)) { $("e_run").textContent = "ההרצה נעצרה — " + ({ a17: "אזורי איסור וגנים", sync: "סנכרון עם מפת החברים", agri: "מנחתים חקלאיים", notam: "נוטמים" })[k] + " אינם תקינים: " + (S.statuses[k] ? S.statuses[k].msg : "ממתין") + (k === "sync" ? "" : ". רעננו את הדף."); return; }
    S.running = true; $("runBtn").disabled = true;
    const steps = [
      { k: "osm_near", t: "מכשולים ותשתיות בסביבה (OpenStreetMap)" }, { k: "osm_far", t: "שדות תעופה, מנחתים וישובים (OpenStreetMap)" },
      { k: "osm_ext", t: "גבולות מדינה ושטחי טבע (OpenStreetMap)" }, { k: "reverse", t: "שם המקום (Nominatim)" },
      { k: "calc", t: "חישוב מרחקים ובדיקת א-17, רט״ג, מנחתים ונוטמים" }, { k: "map", t: "תמונת מפה עם רקע" }
    ].map(x => Object.assign(x, { s: "wait", m: "" }));
    const upd = () => progress(steps.map(x => ({ s: x.s, t: x.t, m: x.m })));
    const st = (k, s, m) => { const x = steps.find(y => y.k === k); x.s = s; x.m = m || ""; upd(); };
    upd();
    S.res = null; S.report = null; S.stale = false; S.map = null; S.overview = null; S.aerial = null;
    { const ck = inp0.lat + "," + inp0.lon; if (S.manualKey !== ck) { S.manual = []; S.manualKey = ck; } }
    S.reviewAt = null; $("reviewOk").checked = false; S.statuses.review = { ok: false, msg: "לא אושרה סקירה" };
    ["osm_near", "osm_far", "osm_ext", "map"].forEach(k => { S.statuses[k] = { ok: false, msg: "לא הושלם" }; });
    const data = { zones: S.data.zones, inpa: S.data.inpa, agri: S.data.agri, notams: S.data.notams, notamFetchedIso: S.data.notamFetchedIso };
    const q = C.buildQueries(inp0.lat, inp0.lon, inp0.radius, S.cfg);
    const fetchOpts = { log: () => {}, maxAgeH: S.cfg.thresholds.osm_max_age_h };
    try {
      // שלוש השאילתות במקביל (מסונכרנות בהפרש קטן כדי לא להציף שרת אחד); כשל באחת מהן עוצר את ההכנה
      const qs = [["near", "near", "osm_near"], ["far", "far", "osm_far"], ["ext", "ext", "osm_ext"]];
      const results = await Promise.allSettled(qs.map(([k, key, sk], i) => (async () => {
        await wait(i * 1500);
        try {
          const r = await C.overpass(q[k], fetchOpts); data[key] = r.data; st(sk, "ok", new URL(r.mirror).hostname + " · " + r.data.elements.length + " אלמנטים");
          setStatus(sk, true, "");
        } catch (e) { st(sk, "no", e.message); setStatus(sk, false, e.message); throw e; }
      })()));
      const failed = results.find(r => r.status === "rejected");
      if (failed) throw failed.reason;
      try {
        const ctl = new AbortController(); setTimeout(() => ctl.abort(), 20000);
        const rr = await fetch("https://nominatim.openstreetmap.org/reverse?" + new URLSearchParams({ format: "jsonv2", lat: inp0.lat, lon: inp0.lon, zoom: 18, "accept-language": "he", addressdetails: 1 }), { signal: ctl.signal });
        if (!rr.ok) throw new Error("HTTP " + rr.status);
        data.reverse = await rr.json(); st("reverse", "ok", data.reverse.display_name || "");
      } catch (e) { data.reverse = null; st("reverse", "ok", "לא התקבל שם מ-Nominatim — השם נגזר משכבות OpenStreetMap או מהקלדה"); }
      const inp = readInputs(); inp.manualItems = S.manual;
      const res = C.analyze(inp, data, S.cfg, new Date());
      const prevAuto = S.autoSite;
      if (!inp.siteName || inp.siteName === prevAuto) { if (res.siteSuggestion) { $("siteName").value = res.siteSuggestion; S.autoSite = res.siteSuggestion; res.inp.siteName = res.siteSuggestion; } }
      const errs2 = C.validateInput(res.inp, S.cfg); showErrors(errs2);
      if (errs2.length) { setStatus("input", false, errs2.map(e => e.msg).join(" · ")); st("calc", "no", errs2.map(e => e.msg).join(" · ")); throw new Error("חסרים פרטים בטופס"); }
      setStatus("input", true, "");
      const age = res.notamAgeH;
      if (age == null || age > S.cfg.thresholds.notam_max_age_h) { setStatus("notam", false, age == null ? "לא ידוע מתי נמשכו הנוטמים" : "נתוני הנוטמים ישנים (" + Math.round(age) + " שעות; מרבי " + S.cfg.thresholds.notam_max_age_h + "). יש לרענן: GitHub → Actions → עדכון נוטמים יומי → Run workflow"); }
      else setStatus("notam", true, "");
      S.data.near = data.near; S.data.far = data.far; S.data.ext = data.ext; S.data.reverse = data.reverse;
      S.res = res; S.scanKey = scanKey();
      st("calc", "ok", "נמצאו " + res.nearScan.items.length + " מכשולים/תשתיות עד פי 2 מהרדיוס · " + (res.zones.inside.length + res.zones.near.length) + " אזורי איסור בקרבה");
      await buildMapImage(steps, st);
      S.report = true;
      renderAll();
      $("resultsSec").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      $("e_run").textContent = "הבדיקות לא הושלמו: " + e.message + ". הבקשה אינה מסומנת כמוכנה לשליחה — אפשר להריץ שוב.";
      if (S.res) { S.report = true; renderAll(); } else { $("resultsSec").style.display = "none"; }
    } finally { S.running = false; $("runBtn").disabled = false; }
  }
  async function buildMapImage(steps, st) {
    try {
      const prov = $("provider").value;
      const [det, ovw, pl] = await Promise.all([M.render(S.res, { provider: prov, view: "detail" }), M.render(S.res, { provider: prov, view: "overview" }), M.render(S.res, { provider: prov, view: "detail", plain: true })]);
      S.map = det; S.overview = ovw; S.aerial = pl;
      const all = [det, ovw, pl];
      if (all.every(x => x.background)) { st && st("map", "ok", "הרקע נטען (" + det.tiles + " אריחים לתקריב)"); setStatus("map", true, ""); }
      else { const why = all.some(x => x.tainted) ? "הדפדפן חסם יצוא תמונה" : all.reduce((a, x) => a + x.failedTiles, 0) + " אריחי רקע לא נטענו"; st && st("map", "no", why); setStatus("map", false, why); }
    } catch (e) { S.map = null; S.overview = null; S.aerial = null; st && st("map", "no", e.message); setStatus("map", false, e.message); }
  }

  /* ---------- שינויי קלט אחרי הרצה ---------- */
  function onScanInputChange() {
    $("ftHint").textContent = isFinite(parseFloat($("height").value)) ? "= " + (parseFloat($("height").value) * C.M2FT).toFixed(1) + " רגל" : "";
    if (S.res && S.scanKey !== scanKey()) { S.stale = true; refreshGate(); }
  }
  let rebuildTimer = null;
  function onSoftInputChange() {
    if (!S.res) return;
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(async () => {
      const i = readInputs();
      ["siteName", "purpose", "aircraft", "vlos", "requesterName", "requesterPhone", "contactNames", "contactPhone"].forEach(k => { S.res.inp[k] = i[k]; });
      const errs = C.validateInput(S.res.inp, S.cfg); showErrors(errs);
      setStatus("input", errs.length === 0, errs.map(e => e.msg).join(" · "));
      if (S.scanKey === scanKey()) { await buildMapImage(null, null); }
      renderAll();
    }, 450);
  }

  /* ---------- הדוח ---------- */
  function renderAll() { S.report = true; refreshGate(); renderLimits(); const m = O.mail(S.res, S.cfg); $("btnMail").href = m.mailto; $("mailInfo").textContent = "נושא: " + m.subject; }
  function renderLimits() { $("limits").innerHTML = O.sourceNotes(S.res, S.data.zones ? { zones: S.data.zones, inpa: S.data.inpa } : {}, S.cfg).map(x => "<li>" + esc(x) + "</li>").join(""); }
  const reportData = () => ({ zones: S.data.zones, inpa: S.data.inpa, agri: S.data.agri, notamFetchedIso: S.data.notamFetchedIso, near: S.data.near });
  const reviewText = () => S.reviewAt ? "המבקש אישר ב-" + S.reviewAt.toLocaleString("he-IL") + " שעבר על התצ״א, על רשימת המצאי ועל המפה, ושאין מכשול או תשתית נוספת שלא הופיעה בטופס (או שהוסיף אותה ידנית)." : "";
  function renderReport() {
    const res = S.res, cfg = S.cfg; if (!res) return;
    const data = reportData();
    const rows = O.buildForm(res, cfg), draft = !S.ready;
    const rowsHtml = rows.map(r => "<tr><td class='k'>" + r.n + ". " + esc(r.label) + (r.sub ? "<small>" + esc(r.sub) + "</small>" : "") + "</td><td>" + r.html + "</td></tr>").join("");
    const draftBanner = draft ? "<div class='draft'>טיוטה — לא מוכן לשליחה: " + (S.stale ? "הנתונים השתנו מאז הרצת הבדיקות" : "יש בדיקות שלא הושלמו") + ".</div>" : "";
    const now = new Date();
    const p1 = "<div class='paper'>" + draftBanner + "<div class='hdr'><span>פמ״ת פנים ארצי א-11 — נספח ג׳</span><span>טופס בקשה לסגירה אווירית</span></div><table class='f'>" + rowsHtml + "</table>" +
      "<p style='margin-top:8px'><b>חובה לצרף מפה/תצ״א</b> — מצורפות: הדמיה בתקריב ומבט כללי (עמודים 2–3) ותצ״א נקי (עמוד 4).<br>*את הבקשה יש להגיש לכתובות המייל: <span dir='ltr'>" + esc(cfg.mail.to.join(", ")) + "</span></p>" +
      "<div class='foot'><span>" + esc(cfg.form) + "</span><span>הופק " + esc(now.toLocaleDateString("he-IL")) + "</span></div></div>";
    const items = res.nearScan.items;
    const legend = items.length ? "<h2>מכשולים, אתרים ותשתיות המסומנים במפה</h2><table class='t'><tr><th>#</th><th>מה</th><th>מרחק מהנקודה</th><th>איפה</th></tr>" +
      items.map(i => "<tr><td>" + i.n + "</td><td>" + esc(i.title) + (i.height ? " · גובה " + C.trimNum(i.height, 0) + " מ׳" : "") + "</td><td>" + esc(O.dLabel(i.d)) + "</td><td>" + esc(O.whereOf(i)) + "</td></tr>").join("") + "</table>" : "";
    const imgOf = (m, alt) => m && m.dataUrl ? "<img class='mapimg' alt='" + alt + "' src='" + (m.jpegUrl || m.dataUrl) + "'>" : "<div class='draft'>התמונה לא נוצרה.</div>";
    const pname = (M.PROVIDERS[S.map ? S.map.provider : "esri"] || {}).name || "";
    const p2 = "<div class='paper'>" + draftBanner + "<div class='hdr'><span>הדמיה מצורפת לבקשה — תקריב</span><span>" + esc(pname) + "</span></div>" + imgOf(S.map, "הדמיה") + "<p class='muted' style='margin-top:6px'>ירוק: אזור הסגירה · כתום: עד פי 2 מהרדיוס · אדום: אזור אסור/מוגבל (א-17) · צהוב: מכשול · תכלת: אתר/תשתית קרקעית · סגול: אווירי · ירוק בהיר: אתר המונים/תשתית. המספרים תואמים לרשימה בשדה 8.</p></div>";
    const p2o = "<div class='paper'>" + draftBanner + "<div class='hdr'><span>הדמיה מצורפת לבקשה — מבט כללי (כל מה שמופיע בשדה 8)</span><span>" + esc(pname) + "</span></div>" + imgOf(S.overview, "מבט כללי") + legend + "</div>";
    const p2b = "<div class='paper'>" + draftBanner + "<div class='hdr'><span>תצ״א (צילום אוויר) של האזור — ללא סימון</span><span>" + esc(pname) + "</span></div>" + imgOf(S.aerial, "תצ״א") + "</div>";
    const checks = O.buildChecks(res, data, cfg);
    const chk = checks.map(r => "<tr><td>" + esc(r[0]) + "</td><td>" + esc(r[1]) + "</td><td>" + r[2] + "</td></tr>").join("");
    const cov = O.buildCoverage(res, data, cfg);
    const covHtml = "<h2>דוח כיסוי — מה נסרק</h2><table class='t'>" + cov.sources.map(r => "<tr><td><b>" + esc(r[0]) + "</b></td><td>" + esc(r[1]) + "</td></tr>").join("") + "</table>" +
      "<h2>מצאי לפי קבוצות (כל מה שנמצא בטווח החיפוש)</h2><table class='t'><tr><th>קבוצה</th><th>נמצאו</th><th>בתוך הסגירה</th><th>בטבעת הכתומה</th><th>בקרבה</th></tr>" +
      cov.groups.map(g => "<tr><td>" + esc(g.group) + "</td><td>" + g.found + "</td><td>" + g.inside + "</td><td>" + g.ring + "</td><td>" + g.near + "</td></tr>").join("") + "</table>" +
      (cov.censusOnly.length ? "<h2>פריטים נוספים שנמצאו בקרבה ואינם בטופס</h2><p>" + cov.censusOnly.map(i => esc(i.title + " — " + O.dLabel(i.d))).join("; ") + (cov.censusMore ? "; ועוד " + cov.censusMore + " פריטים" : "") + ".</p>" : "");
    const dn = res.sun.map(r => "<tr><td>יום " + esc(r.dayName) + " " + C.ddmmyyyy(r.date) + "</td><td>" + r.sunrise + "</td><td>" + r.sunset + "</td><td>" + C.fmtHM(r.dayMin) + "</td><td>" + C.fmtHM(r.nightMin) + "</td></tr>").join("");
    const rv = reviewText();
    const p3 = "<div class='paper checks'><div class='hdr'><span>דף בדיקות</span><span>לא חלק מהטופס הרשמי</span></div>" +
      "<h2>הנקודה</h2><p><span dir='ltr'>" + esc(C.dmsLat(res.inp.lat) + " " + C.dmsLon(res.inp.lon)) + "</span> · ירוק: " + res.R + " מ׳ · כתום: עד " + 2 * res.R + " מ׳ · גובה " + C.trimNum(res.inp.heightM, 2) + " מ׳ (" + res.ft.toFixed(1) + " רגל)</p>" +
      "<h2>הבדיקות שבוצעו</h2><table class='t ck'><tr><th>בדיקה</th><th>מקור</th><th>תוצאה</th></tr>" + chk + "</table>" + covHtml +
      "<h2>יום ולילה בחלון הפעילות</h2><table class='t'><tr><th>תאריך</th><th>זריחה</th><th>שקיעה</th><th>שעות יום בחלון</th><th>שעות לילה בחלון</th></tr>" + dn + "</table>" +
      "<p class='muted'>זריחה ושקיעה לפי חישוב אסטרונומי לנקודה, לא לוח רשמי. ההתייחסות לגובה ולתנאים זהה ביום ובלילה.</p>" +
      "<h2>הגשה</h2><p>" + O.submissionHtml(res, cfg, data) + "</p>" +
      "<h2>מגבלות המקורות</h2><ul>" + O.sourceNotes(res, data, cfg).map(x => "<li>" + esc(x) + "</li>").join("") + "</ul>" +
      (rv ? "<h2>אישור סקירה אנושית</h2><p>" + esc(rv) + "</p>" : "") +
      "<div class='foot'><span>מקורות: " + esc((data.zones && data.zones.edition) || "") + " · פמ״ת א-11 עדכון 1/26 · OpenStreetMap · נוטמים</span><span>הופק " + esc(now.toLocaleString("he-IL")) + "</span></div></div>";
    $("report").className = $("incChecks").checked ? "" : "nochecks";
    $("report").innerHTML = p1 + p2 + p2o + p2b + p3;
    const style = document.getElementById("nochecksStyle") || Object.assign(document.createElement("style"), { id: "nochecksStyle" });
    style.textContent = ".nochecks .paper.checks{display:none !important}"; document.head.appendChild(style);
    S.reportHtml = true;
  }

  /* ---------- תוספות ידניות ואישור סקירה ---------- */
  function renderManual() {
    $("manualList").innerHTML = S.manual.length ? S.manual.map((m, i) => '<li>' + esc(m.name) + (m.heightM ? " · גובה " + m.heightM + " מ׳" : "") + ' <span class="hint" dir="ltr">(' + m.lat.toFixed(6) + ", " + m.lon.toFixed(6) + ')</span> <button type="button" data-del="' + i + '" style="min-height:28px;padding:2px 10px;font-size:12px">הסר</button></li>').join("") : '<li class="hint">לא הוזנו תוספות.</li>';
    $("manualList").querySelectorAll("[data-del]").forEach(b => b.onclick = () => { S.manual.splice(+b.dataset.del, 1); reanalyze(); });
  }
  async function reanalyze() {
    renderManual();
    if (!S.res) return;
    const inp = Object.assign({}, S.res.inp, { manualItems: S.manual });
    const data = { zones: S.data.zones, inpa: S.data.inpa, agri: S.data.agri, notams: S.data.notams, notamFetchedIso: S.data.notamFetchedIso, near: S.data.near, far: S.data.far, ext: S.data.ext, reverse: S.data.reverse };
    const prev = S.res; S.res = C.analyze(inp, data, S.cfg, new Date());
    S.reviewAt = null; $("reviewOk").checked = false; S.statuses.review = { ok: false, msg: "הרשימה השתנתה — יש לאשר מחדש" };
    await buildMapImage(null, null); renderAll();
  }
  function addManual() {
    const name = $("mName").value.trim(), c = C.parseCoordInput($("mCoord").value), h = parseFloat($("mHeight").value);
    $("e_manual").textContent = "";
    if (!name) { $("e_manual").textContent = "יש להזין שם או תיאור."; return; }
    if (!c) { $("e_manual").textContent = "יש להזין נ״צ (או ללחוץ ״בחר מיקום מהמפה״)."; return; }
    S.manual.push({ name, lat: c.lat, lon: c.lon, heightM: isFinite(h) && h > 0 ? h : null });
    $("mName").value = ""; $("mCoord").value = ""; $("mHeight").value = "";
    reanalyze();
  }
  function onReviewChange() {
    S.reviewAt = $("reviewOk").checked ? new Date() : null;
    setStatus("review", $("reviewOk").checked, $("reviewOk").checked ? "" : "לא אושרה סקירה");
  }

  /* ---------- הורדות והעתקה ---------- */
  function download(name, mime, data) {
    const b = data instanceof Blob ? data : new Blob([data], { type: mime });
    const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  const baseName = () => O.fileBase(S.res);
  const b64ToBytes = u => { const bin = atob(u.split(",")[1]), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; };
  async function docxBytes() {
    const pname = (M.PROVIDERS[S.map ? S.map.provider : "esri"] || {}).name || "";
    const img = m => m && m.jpegUrl ? { bytes: b64ToBytes(m.jpegUrl), w: m.canvas.width, h: m.canvas.height } : null;
    const model = O.docxModel(S.res, reportData(), S.cfg, { images: { map: img(S.map), overview: img(S.overview), aerial: img(S.aerial) }, includeChecks: $("incChecks").checked, providerName: pname, review: reviewText(), draft: S.ready ? "" : "יש בדיקות שלא הושלמו" });
    return window.ReqDocx.build(model);
  }
  const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  async function downloadDocx() {
    const bytes = await docxBytes();
    download(baseName() + " — בקשה לסגירה אווירית.docx", DOCX_MIME, new Blob([bytes], { type: DOCX_MIME }));
  }

  /* ---------- שמירה אוטומטית בדרייב (דרך שרת ההתחברות) ---------- */
  const bytesToB64 = bytes => { let s = ""; const CH = 0x8000; for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return btoa(s); };
  const utf8B64 = t => bytesToB64(new TextEncoder().encode(t));
  const MAX_B64 = 8.5 * 1024 * 1024;   // תקרת השרת לקובץ אחד היא 9MB אחרי קידוד
  // הנתונים שהוזנו (בלי שמות וטלפונים) — מאפשרים להריץ את הבדיקות שוב על אותה בקשה
  function inputsForRecord() {
    const o = {}; Object.keys(S.res.inp).forEach(k => { if (!/^(req|contact|requester)/i.test(k)) o[k] = S.res.inp[k]; });
    return { savedAt: new Date().toISOString(), site: baseName(), version: (S.data.zones && S.data.zones.mapVersion) || "", edition: (S.data.zones && S.data.zones.edition) || "", inputs: o,
      zones: [...S.res.zones.inside, ...S.res.zones.near].map(z => ({ id: z.id, d: Math.round(z.d) })), items: S.res.nearScan.items.map(i => ({ n: i.n, title: i.title, d: Math.round(i.d) })) };
  }
  function imageFile(m, label) {
    if (!m) return null;
    const png = m.dataUrl && m.dataUrl.split(",")[1];
    if (png && png.length < MAX_B64) return { name: baseName() + " — " + label + ".png", mime: "image/png", b64: png };
    return m.jpegUrl ? { name: baseName() + " — " + label + ".jpg", mime: "image/jpeg", b64: m.jpegUrl.split(",")[1] } : null;
  }
  // שומר את כל קבצי הבקשה בתיקייה בדרייב ומחזיר {folderId,url,name,count}; זורק שגיאה בכשל
  async function persistToDrive(progress) {
    const begin = await window.ReqAuth.call("saveBegin", { folderName: baseName() });
    if (!begin.ok) throw new Error(window.ReqAuth.msg(begin));
    const files = [
      { name: baseName() + " — בקשה לסגירה אווירית.docx", mime: DOCX_MIME, b64: bytesToB64(await docxBytes()) },
      { name: baseName() + ".kml", mime: "application/vnd.google-earth.kml+xml", b64: utf8B64(O.kml(S.res, { zones: S.data.zones }, S.cfg)) },
      imageFile(S.map, "הדמיה תקריב"), imageFile(S.overview, "הדמיה מבט כללי"), imageFile(S.aerial, "תצ״א"),
      { name: baseName() + " — נתוני הבקשה.json", mime: "application/json", b64: utf8B64(JSON.stringify(inputsForRecord(), null, 1)) }
    ].filter(Boolean);
    let n = 0;
    for (const f of files) {
      if (progress) progress(++n, files.length, f.name);
      const r = await window.ReqAuth.call("saveFile", { folderId: begin.folderId, name: f.name, mime: f.mime, b64: f.b64 });
      if (!r.ok) throw new Error(f.name + ": " + window.ReqAuth.msg(r));
    }
    S.driveUrl = begin.url;
    return { folderId: begin.folderId, url: begin.url, name: begin.name, count: files.length };
  }
  async function saveToDrive() {
    const out = $("driveMsg"), btn = $("btnDrive");
    if (!S.ready) return;
    if (!window.ReqAuth.loggedIn()) { window.ReqAuth.show(); return; }
    if (!(await checkSync())) { out.className = "small err"; out.textContent = "לא נשמר: הנתונים אינם מסונכרנים עם מפת החברים (ראו ההודעה בראש הדף)."; refreshGate(); return; }
    btn.disabled = true; out.className = "small"; out.textContent = "שומר בדרייב…";
    try {
      const r = await persistToDrive((n, t, name) => { out.textContent = "שומר בדרייב… (" + n + "/" + t + ") " + name; });
      out.className = "small ok";
      out.innerHTML = "✔ נשמרו " + r.count + " קבצים בדרייב, בתיקייה <b>" + esc(r.name) + '</b> — <a href="' + esc(r.url) + '" target="_blank" rel="noopener">פתח את התיקייה</a>';
    } catch (e) {
      out.className = "small err"; out.textContent = "השמירה בדרייב נכשלה: " + (e && e.message ? e.message : e);
    } finally { btn.disabled = !S.ready; }
  }

  /* ---------- שליחה למשרד נוטאם (פמ"ת א-11 סעיף 6(א)) ---------- */
  const fmtTime = t => new Date(t).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
  async function sendToNotam() {
    if (!S.ready) return;
    const A = window.ReqAuth;
    if (!A.loggedIn()) { A.show(); return; }
    const out = $("sendMsg");
    if (!(await checkSync())) { out.className = "small err"; out.textContent = "לא נשלח: הנתונים אינם מסונכרנים עם מפת החברים (ראו ההודעה בראש הדף)."; refreshGate(); return; }
    const mail = O.mail(S.res, S.cfg), live = A.getMailMode() === "live", serverTo = (A.getMailTo() || []).slice().sort().join(","), cfgTo = mail.to.slice().sort().join(",");
    // כתובות היעד קבועות בשרת; מוודאים שהן זהות לכתובות שמצוינות בנוהל (config.json) — אחרת לא שולחים
    if (serverTo !== cfgTo) { out.className = "small err"; out.textContent = "לא נשלח: כתובות היעד בשרת (" + serverTo + ") שונות מהכתובות בנוהל א-11 סעיף 6(א) שבהגדרות (" + cfgTo + "). יש לעדכן את השרת."; return; }
    const names = ["טופס הבקשה (Word)" + ($("incChecks").checked ? " כולל דף בדיקות" : " בלי דף בדיקות"), "קובץ KML", "הדמיה — תקריב", "הדמיה — מבט כללי", "תצ״א נקי"];
    const warn = warnings().filter(w => /ימי עבודה|נוטמים נמשכו/.test(w));
    const m = A.modal('<div class="sendBox"><h2>שליחה למשרד נוטאם</h2>' +
      (live ? '<div class="banner ok" style="margin:0 0 8px"><b>מצב חי:</b> המייל יישלח באמת אל <span dir="ltr">' + esc(mail.to.join(", ")) + '</span>, ועותק יישלח אליך.</div>'
            : '<div class="banner warn" style="margin:0 0 8px"><b>מצב בדיקה:</b> המייל יישלח רק אליך ולא יישלח למשרד נוטאם. (מנהל יכול להעביר למצב חי בניהול משתמשים.)</div>') +
      '<p><b>אל:</b> <span dir="ltr">' + esc((live ? mail.to : ["הבעלים (בדיקה)"]).join(", ")) + '</span></p><p><b>נושא:</b> ' + esc((live ? "" : "[בדיקה — לא נשלח למשרד נוטאם] ") + mail.subject) + '</p>' +
      '<p><b>קבצים שיצורפו:</b> ' + esc(names.join(" · ")) + '</p><details><summary>נוסח המייל</summary><pre>' + esc(mail.body) + '</pre></details>' +
      warn.map(w => '<div class="banner warn" style="margin:8px 0 0">' + w + '</div>').join("") +
      '<label class="checks" style="margin-top:10px"><span style="display:flex;gap:8px;align-items:flex-start;font-size:14px"><input type="checkbox" id="sendOk" style="margin-top:4px"> עברתי על הבקשה (הטופס, התצ״א והמצאי) והיא מוכנה לשליחה' + (live ? " — השליחה אינה ניתנת לביטול" : "") + '</span></label>' +
      '<div class="row" style="margin-top:10px"><button type="button" class="primary" id="sendGo" disabled>' + (live ? "שלח למשרד נוטאם" : "שלח בדיקה אליי") + '</button></div><div class="small" id="sendProg" role="status" style="margin-top:8px"></div></div>');
    const ok = document.getElementById("sendOk"), go = document.getElementById("sendGo"), prog = document.getElementById("sendProg");
    ok.onchange = () => { go.disabled = !ok.checked; };
    const doSend = async again => {
      const r = await A.call("sendRequest", { folderId: S.sendFolder.folderId, subject: mail.subject, body: mail.body, again: !!again });
      if (!r.ok && r.error === "already_sent") {
        prog.innerHTML = 'הבקשה כבר נשלחה למשרד נוטאם ב-<b>' + esc(fmtTime(r.sentAt)) + '</b>. <button type="button" id="sendAgain">שלח שוב בכל זאת</button>';
        document.getElementById("sendAgain").onclick = () => { prog.textContent = "שולח…"; doSend(true).catch(fail); };
        go.disabled = true; return;
      }
      if (!r.ok) throw new Error(A.msg(r));
      S.sent = { at: r.sentAt, mode: r.mode, to: r.to };
      const msgHtml = r.mode === "live" ? "✔ נשלחה למשרד נוטאם (<span dir='ltr'>" + esc(r.to.join(", ")) + "</span>) ב-" + esc(fmtTime(r.sentAt)) + (r.cc ? ". עותק נשלח אל <span dir='ltr'>" + esc(r.cc) + "</span>." : ".")
        : "✔ נשלח במצב בדיקה אל <span dir='ltr'>" + esc(r.to.join(", ")) + "</span> בלבד — לא נשלח למשרד נוטאם.";
      prog.className = "small ok"; prog.innerHTML = msgHtml; out.className = "small ok"; out.innerHTML = msgHtml + ' <a href="' + esc(S.sendFolder.url) + '" target="_blank" rel="noopener">פתח את התיקייה בדרייב</a>';
      go.disabled = true; ok.disabled = true;
    };
    const fail = e => { prog.className = "small err"; prog.textContent = "השליחה נכשלה: " + (e && e.message ? e.message : e); go.disabled = !ok.checked; ok.disabled = false; };
    go.onclick = async () => {
      go.disabled = true; ok.disabled = true; prog.className = "small"; prog.textContent = "בודק סנכרון עם המפה…";
      try {
        if (!(await checkSync())) throw new Error("הנתונים אינם מסונכרנים עם מפת החברים — לא נשלח");
        S.sendFolder = await persistToDrive((n, t, name) => { prog.textContent = "שומר בדרייב… (" + n + "/" + t + ") " + name; });
        prog.textContent = "שולח…";
        await doSend(false);
      } catch (e) { fail(e); }
    };
    return m;
  }
  async function copyMail() {
    const m = O.mail(S.res, S.cfg), txt = "אל: " + m.to.join(", ") + "\nנושא: " + m.subject + "\n\n" + m.body;
    try { await navigator.clipboard.writeText(txt); } catch (e) { const t = document.createElement("textarea"); t.value = txt; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); } catch (e2) { /* ignore */ } t.remove(); }
    $("btnCopy").textContent = "הועתק ✔"; setTimeout(() => { $("btnCopy").textContent = "העתק טקסט מייל"; }, 2000);
  }

  const r_name = (cfg, iso) => (cfg.borders[iso] || {}).name || iso;
  /* ---------- בדיקה עצמית ---------- */
  async function selfTest() {
    const out = [], add = (name, ok, detail) => out.push({ name, ok, detail: detail || "" });
    try {
      const [exp, near, far, ext, rev, nsnap] = await Promise.all(["selftest/expected.json", "selftest/yarkon/near.json", "selftest/yarkon/far.json", "selftest/yarkon/ext.json", "selftest/yarkon/reverse.json", "selftest/notam-data.snap.json"].map(getJson));
      const cfg = S.cfg, inp = Object.assign({}, exp.input, { purpose: cfg.purposes[0], aircraft: [cfg.aircraft[0]], vlos: true, siteName: "בדיקה", requesterName: "בודק", requesterPhone: "050-0000000", contactNames: "א; ב", contactPhone: "050-0000001" });
      const data = { zones: S.data.zones, inpa: S.data.inpa, agri: S.data.agri, notams: nsnap.notams, notamFetchedIso: nsnap.fetched_iso, near, far, ext, reverse: rev };
      const res = C.analyze(inp, data, cfg, new Date(exp.now));
      const near1 = (a, b, tol) => Math.abs(a - b) <= tol;
      exp.items.forEach(e => { const it = res.nearScan.items.find(i => i.title === e.title); add("מכשול: " + e.title + " — " + e.d + " מ׳", !!it && near1(it.d, e.d, e.tol || 1.5) && it.zone === e.zone, it ? "חושב " + it.d.toFixed(1) + " מ׳" : "לא נמצא"); });
      add("מספר המכשולים והתשתיות (" + exp.items.length + ")", res.nearScan.items.length === exp.items.length, "נמצאו " + res.nearScan.items.length);
      exp.zones.forEach(e => { const z = [...res.zones.inside, ...res.zones.near].find(x => x.id === e.id); add("אזור " + e.id + " במרחק " + e.d + " מ׳", !!z && near1(z.d, e.d, e.tol || 1.5) && (e.where === "near" ? res.zones.near.includes(z) : res.zones.inside.includes(z)), z ? "חושב " + z.d.toFixed(1) : "לא נמצא"); });
      add("שקיעות " + exp.sunset.join(", "), JSON.stringify(res.sun.map(r => r.sunset)) === JSON.stringify(exp.sunset), res.sun.map(r => r.sunset).join(", "));
      add("המרה לרגל: " + exp.heightM + " מ׳ = " + exp.ft + " רגל", near1(res.ft, exp.ft, 0.01), res.ft.toFixed(3));
      add("DMS של הנקודה", C.dmsLat(inp.lat) === exp.dmsLat && C.dmsLon(inp.lon) === exp.dmsLon, C.dmsLat(inp.lat) + " " + C.dmsLon(inp.lon));
      add("הצעת שם המקום", res.siteSuggestion === exp.siteSuggestion, res.siteSuggestion);
      add("נוטמים רלוונטיים", JSON.stringify(res.notams.hits.map(h => h.id).sort()) === JSON.stringify(exp.notamHits.slice().sort()), res.notams.hits.map(h => h.id).join(", "));
      const rows = O.buildForm(res, cfg);
      add("בטופס 17 שדות", rows.length === 17, String(rows.length));
      add("אין מילות 'טרם נבדק' בטופס", !/טרם נבדק|לא נבדק/.test(rows.map(r => r.text).join(" ")), "");
      for (const b of exp.borders || []) {
        const bx = await getJson("selftest/" + b.fixture + "/ext.json");
        const r = C.analyzeBorders(new C.Proj(b.lat, b.lon), bx, cfg, b.R).find(y => y.iso === b.iso);
        add("גבול " + r_name(cfg, b.iso) + " — " + b.d + " מ׳ (" + b.fixture + ")", !!r && near1(r.d, b.d, b.tol) && r.violates === b.violates, r ? "חושב " + r.d.toFixed(1) : "לא זוהה");
      }
      const kml = O.kml(res, data, cfg);
      add("KML תקין (XML)", new DOMParser().parseFromString(kml, "application/xml").getElementsByTagName("parsererror").length === 0, kml.length + " תווים");
    } catch (e) { add("טעינת נתוני הבדיקה", false, e.message); }
    const ok = out.every(x => x.ok);
    $("stList").innerHTML = out.map(x => '<li class="' + (x.ok ? "ok" : "no") + '">' + (x.ok ? "✔ " : "✖ ") + esc(x.name) + (x.detail ? ' <span class="hint">— ' + esc(x.detail) + "</span>" : "") + "</li>").join("");
    setStatus("selftest", ok, ok ? "" : out.filter(x => !x.ok).map(x => x.name).join("; "));
    const b = $("selftestBanner");
    if (ok) { b.style.display = "none"; } else { b.style.display = "block"; b.textContent = "הבדיקה העצמית של המערכת נכשלה — לא ניתן לסמן בקשה כמוכנה לשליחה. פתחו את 'בדיקה עצמית' למטה לפרטים."; $("stBox").open = true; }
    return ok;
  }

  /* ---------- אתחול ---------- */
  async function init() {
    initMap();
    const okCfg = await loadStatic();
    window.ReqAuth.init(S.cfg);
    ["radius", "height", "dateFrom", "dateTo", "timeFrom", "timeTo"].forEach(id => $(id).addEventListener("input", () => { if (id === "radius") drawCircles(); onScanInputChange(); }));
    $("coord").addEventListener("change", () => { const c = C.parseCoordInput($("coord").value); if (c) setCenter(c.lat, c.lon, true); });
    ["siteName", "purpose", "vlos", "reqName", "reqPhone", "contactNames", "contactPhone"].forEach(id => $(id).addEventListener("input", () => { if (id.startsWith("req") || id.startsWith("contact")) savePerson(); onSoftInputChange(); }));
    $("aircraft").addEventListener("change", onSoftInputChange);
    $("incChecks").addEventListener("change", () => { if (S.res) renderReport(); });
    $("provider").addEventListener("change", () => { if (S.res) { S.stale = true; refreshGate(); } });
    $("runBtn").onclick = run; $("qBtn").onclick = searchPlace; $("q").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); searchPlace(); } });
    $("btnPrint").onclick = () => window.print();
    $("btnKml").onclick = () => download(baseName() + ".kml", "application/vnd.google-earth.kml+xml", O.kml(S.res, { zones: S.data.zones }, S.cfg));
    $("btnPng").onclick = async () => { const b = await (await fetch(S.map.dataUrl)).blob(); download(baseName() + " — הדמיה תקריב.png", "image/png", b); };
    $("btnOverview").onclick = async () => { const b = await (await fetch(S.overview.dataUrl)).blob(); download(baseName() + " — הדמיה מבט כללי.png", "image/png", b); };
    $("btnAerial").onclick = async () => { const b = await (await fetch(S.aerial.dataUrl)).blob(); download(baseName() + " — תצ״א.png", "image/png", b); };
    $("btnDocx").onclick = downloadDocx;
    $("mAdd").onclick = addManual;
    $("mPick").onclick = () => { S.pick = true; $("mPick").textContent = "לחצו על המפה למעלה…"; $("map").scrollIntoView({ behavior: "smooth", block: "center" }); };
    $("reviewOk").addEventListener("change", onReviewChange);
    $("btnCopy").onclick = copyMail;
    $("btnDrive").onclick = saveToDrive;
    $("btnSend").onclick = sendToNotam;
    $("wipePerson").onclick = () => { ls.del(PERSON_KEY); ["reqName", "reqPhone", "contactNames", "contactPhone"].forEach(id => { $(id).value = ""; }); };
    $("stRun").onclick = selfTest;
    renderManual();
    setStatus("selftest", false, "טרם הורצה");
    if (okCfg) await selfTest();
    window.__REQ = { S, C, O, M, run, selfTest, setCenter, readInputs };
    window.__REQ_READY = true;
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
