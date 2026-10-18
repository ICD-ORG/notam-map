// בדיקות יחידה ללוגיקה הטהורה של שכבות האיסורים והנוטמים במפת הבקשות ושל פס הסיכום לנקודה (js/maplayers.js) — בלי DOM.
// הרצה: node --test tests/requests/maplayers.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const C = require(path.join(ROOT, "members-k38p/requests/js/core.js"));
const L = require(path.join(ROOT, "members-k38p/requests/js/maplayers.js"));
const J = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const cfg = J("members-k38p/requests/config.json"), exp = J("members-k38p/requests/selftest/expected.json");
const zones = J("members-k38p/data/zones.json"), inpa = J("members-k38p/data/inpa-zones.json"), snap = J("members-k38p/requests/selftest/notam-data.snap.json");
const TH = cfg.thresholds, NOW = new Date("2026-10-16T21:00:00Z");

/* ---------- עזרים לנתונים סינתטיים ---------- */
const P0 = new C.Proj(32.0, 34.8);   // 32°00'00"N 34°48'00"E
const rect = (x0, x1, y0, y1) => [P0.ll(x0, y0), P0.ll(x1, y0), P0.ll(x1, y1), P0.ll(x0, y1), P0.ll(x0, y0)];   // מלבן במטרים סביב הנקודה (טבעת סגורה)
const zA17 = (id, name, ring, extra) => Object.assign({ id, cat: "LLP", name, alt: "GND – 3,000 ft AMSL", pmt: "ציטוט מהפמ״ת", pmtRef: "עמ' 1", rings: [ring] }, extra || {});
const zB09 = (id, minFt, ring) => ({ id, cat: "B09", name: id, appendix: "נספח ב'-1", alt: "גובה מרבי: 1 500", minFt, pmt: "שם: " + id, pmtRef: "", rings: [ring] });
const mkZ = list => ({ zones: list }), noInpa = { sites: [] };
const ntm = (id, { q = "QWPLW", b = "2610200000", c = "2610202359", e, qc = "3200N03448E005", f = "F) GND G) 500FT AMSL)" } = {}) =>
  ({ id, loc: "LLLL", name: id, heb: id + " תיאור\nבתוקף: x", raw: id + " NOTAMN\nQ) LLLL/" + q + "/IV/BO /W /000/050/" + qc + "\nA) LLLL B) " + b + " C) " + c + "\nE) " + (e || "OPS CLSD IN AREA") + "\n" + f });
const POS = (latDms, lonDms) => "OPS WI 500M RADIUS CENTERED ON PSN " + latDms + "N" + lonDms + "E CLSD";   // "320130" + "N" + "0344800" + "E"
const noCoordQ = "";   // Q בלי קואורדינטות — גיאומטריה אפשרית רק מטקסט E
const baseArgs = (over) => Object.assign({ lat: 32.0, lon: 34.8, radius: 100, heightM: 80, dateFrom: "2026-10-20", dateTo: "2026-10-20", timeFrom: "17:00", timeTo: "20:00", zones: mkZ([]), inpa: noInpa, notams: [], notamFetchedIso: "2026-10-16T20:00:00Z", thresholds: TH, now: NOW }, over || {});
const RLM = String.fromCharCode(0x200F), noRlm = t => t.split(RLM).join("");   // RLM אחרי מזהה לטיני בפס (ראו בדיקת ״סדר תצוגה״): מוסר לפני השוואות טקסט
const line = (r, k) => r.lines.find(l => l.k === k);
const textOf = r => r.lines.map(l => (l.label ? l.label + ": " : "") + l.text).join("\n");

/* ================= העדפות ================= */
test("העדפות: ברירת מחדל שני המתגים דולקים; ערך פגום/חסר לא מכבה; שמירה וקריאה חוזרת", () => {
  assert.equal(L.KEY, "icd_req_layers_v1");
  assert.deepEqual(L.parsePrefs(null), { zones: true, notams: true });
  assert.deepEqual(L.parsePrefs("זבל{"), { zones: true, notams: true });
  assert.deepEqual(L.parsePrefs('{"zones":"no","notams":0}'), { zones: true, notams: true }, "ערכים שאינם בוליאניים נדחים");
  assert.deepEqual(L.parsePrefs('{"zones":false}'), { zones: false, notams: true });
  const p = { zones: false, notams: true };
  assert.deepEqual(L.parsePrefs(L.serializePrefs(p)), p);
  assert.equal(L.serializePrefs({ zones: 1, notams: 0 }), '{"zones":true,"notams":false}');
});

/* ================= חלון הזמן של הנוטמים ================= */
test("חלון זמן: תאריכים ושעות מהטופס — כמו בבדיקות המלאות (תחילת היום הראשון עד סוף היום האחרון), בשעון ישראל", () => {
  const inp = { dateFrom: "2026-10-20", dateTo: "2026-10-23", timeFrom: "17:00", timeTo: "20:00" };
  const w = L.inputWindow(inp, NOW), rows = C.dayNightTable(32, 34.8, inp.dateFrom, inp.dateTo, inp.timeFrom, inp.timeTo);
  assert.equal(w.mode, "form");
  assert.equal(w.fromMs, +rows[0].startUtc); assert.equal(w.toMs, +rows[rows.length - 1].endUtc, "אותו חלון ש-C.analyze מעביר ל-analyzeNotams");
  assert.equal(new Date(w.fromMs).toISOString(), "2026-10-20T14:00:00.000Z", "17:00 בשעון קיץ = 14:00Z");
  assert.equal(new Date(w.toMs).toISOString(), "2026-10-23T17:00:00.000Z");
  assert.equal(w.label, "20.10.2026 17:00 – 23.10.2026 20:00 (שעון מקומי)");
});

test("חלון זמן: חלון שחוצה חצות (22:00–02:00) מסתיים למחרת, בשעון חורף; dateTo חסר = dateFrom", () => {
  const w = L.inputWindow({ dateFrom: "2026-11-10", timeFrom: "22:00", timeTo: "02:00" }, NOW);
  assert.equal(new Date(w.fromMs).toISOString(), "2026-11-10T20:00:00.000Z");
  assert.equal(new Date(w.toMs).toISOString(), "2026-11-11T00:00:00.000Z", "02:00 המקומי של המחרת");
  assert.equal(w.label, "10.11.2026 22:00 – 11.11.2026 02:00 (שעון מקומי)", "התווית מציינת את תאריך הסיום האמיתי");
});

test("חלון זמן: בלי שעות — כל היום; בלי תאריכים או תאריכים שגויים — מעכשיו (חלון התוקף לא הסתיים)", () => {
  const d = L.inputWindow({ dateFrom: "2026-10-20", dateTo: "2026-10-21" }, NOW);
  assert.equal(d.mode, "dates"); assert.equal(new Date(d.fromMs).toISOString(), "2026-10-19T21:00:00.000Z", "00:00 המקומי"); assert.equal(new Date(d.toMs).toISOString(), "2026-10-21T20:59:00.000Z", "23:59 המקומי");
  assert.match(d.label, /כל היום/);
  const half = L.inputWindow({ dateFrom: "2026-10-20", timeFrom: "17:00" }, NOW);
  assert.equal(half.mode, "dates", "שעה אחת בלבד = כל היום (לא מנחשים את השנייה)");
  for (const inp of [{}, { dateFrom: "" }, { dateFrom: "זבל" }]) { const n = L.inputWindow(inp, NOW); assert.equal(n.mode, "now"); assert.equal(n.fromMs, NOW.getTime()); assert.equal(n.toMs, Infinity); assert.match(n.label, /מעכשיו \(עוד לא נבחרו תאריכים\)/); }
  const bad = L.inputWindow({ dateFrom: "2026-10-20", dateTo: "2026-10-19", timeFrom: "10:00", timeTo: "11:00" }, NOW);
  assert.equal(bad.mode, "now"); assert.match(bad.label, /אינם תקינים/);
});

/* ================= בחירת נוטמים לתצוגה ================= */
test("בחירת נוטמים: בחלון / מחוץ לחלון / חלון שחוצה חצות בנוטם ובטופס", () => {
  const nts = [
    ntm("IN1/26", { b: "2610200000", c: "2610202359" }),
    ntm("OUT1/26", { b: "2610210000", c: "2610212359" }),
    ntm("MID/26", { b: "2610202250", c: "2610210200" }),   // 22:50Z עד 02:00Z למחרת — חוצה חצות
    ntm("PAST/26", { b: "2610010000", c: "2610011200" })
  ];
  const ids = w => L.selectNotams(nts, w).items.map(n => n.id).sort();
  assert.deepEqual(ids(L.inputWindow({ dateFrom: "2026-10-20", timeFrom: "17:00", timeTo: "20:00" }, NOW)), ["IN1/26"], "17:00–20:00 המקומיים = 14:00–17:00Z: רק הנוטם של כל היום");
  assert.deepEqual(ids(L.inputWindow({ dateFrom: "2026-10-21", timeFrom: "00:30", timeTo: "01:30" }, NOW)), ["IN1/26"], "00:30–01:30 של ה-21 = 21:30–22:30Z של ה-20: MID מתחיל רק ב-22:50Z — מחוץ לחלון");
  assert.deepEqual(ids(L.inputWindow({ dateFrom: "2026-10-21", timeFrom: "02:30", timeTo: "03:30" }, NOW)), ["IN1/26", "MID/26", "OUT1/26"], "02:30–03:30 של ה-21 = 23:30Z–00:30Z: MID (חוצה חצות) בפנים, IN1 עוד לא הסתיים (23:59Z), OUT1 כבר התחיל (00:00Z)");
  assert.deepEqual(ids(L.inputWindow({ dateFrom: "2026-10-20", timeFrom: "22:00", timeTo: "02:00" }, NOW)), ["IN1/26", "MID/26"], "חלון שחוצה חצות בטופס (22:00–02:00 = 19:00Z–23:00Z): MID בפנים; OUT1 מתחיל ב-00:00Z של ה-21 — אחרי הסיום");
  assert.equal(ids(L.inputWindow({ dateFrom: "2026-10-05", timeFrom: "10:00", timeTo: "12:00" }, NOW)).length, 0, "אף נוטם אינו בתוקף ב-5.10");
  assert.deepEqual(ids(L.inputWindow({ dateFrom: "2026-10-01", timeFrom: "10:00", timeTo: "11:00" }, NOW)), ["PAST/26"], "10:00–11:00 ב-1.10 = 07:00–08:00Z: בתוך חלון התוקף של PAST (00:00–12:00Z)");
});

test("בחירת נוטמים: נוטם קבוע (PERM) ונוטם עם סיום משוער (EST); בלי שורת C — לא נכלל וסופר כ'בלי חלון'", () => {
  const nts = [ntm("PERM/26", { b: "2601010000", c: "PERM" }), ntm("EST/26", { b: "2610010000", c: "2611051239EST" }),
    { id: "NOEND/26", raw: "NOEND/26 NOTAMN\nQ) LLLL/QWPLW/IV/BO /W /000/050/3200N03448E005\nA) LLLL B) 2610010000\nE) OPS WI 500M RADIUS CENTERED ON PSN 320000N0344800E CLSD" },
    ntm("FUT/26", { b: "2701010000", c: "PERM" })];
  const now = L.inputWindow({}, NOW), s = L.selectNotams(nts, now);
  assert.deepEqual(s.items.map(n => n.id).sort(), ["EST/26", "FUT/26", "PERM/26"], "מצב 'מעכשיו': כל נוטם שחלון התוקף שלו לא הסתיים (גם עתידי וקבוע)");
  assert.deepEqual(s.noWindow, ["NOEND/26"]);
  const far = L.selectNotams(nts, L.inputWindow({ dateFrom: "2030-01-01", dateTo: "2030-01-02", timeFrom: "10:00", timeTo: "12:00" }, NOW));
  assert.deepEqual(far.items.map(n => n.id).sort(), ["FUT/26", "PERM/26"], "בחלון רחוק: רק קבועים; EST הסתיים");
  const before = L.selectNotams(nts, L.inputWindow({ dateFrom: "2026-01-02", timeFrom: "10:00", timeTo: "12:00" }, NOW));
  assert.deepEqual(before.items.map(n => n.id), ["PERM/26"], "נוטם קבוע שהתחיל ב-01.01.2026 בתוקף ב-02.01.2026; האחרים עוד לא התחילו");
});

test("בחירת נוטמים: סינון לפי סוג — סגירה ומכשול בלבד כברירת מחדל; תדרים/GNSS/נתיבים/ביטולים/רשימות נספרים בנפרד", () => {
  const nts = [ntm("CL/26"), ntm("OB/26", { q: "QOBCE" }), ntm("COM/26", { q: "QCAAH" }), ntm("GN/26", { q: "QGAXX" }),
    ntm("RT/26", { q: "QWPLW", e: "ULTRALIGHT RTE NEGEV-BOKER CLSD" }), ntm("CK/26", { q: "QKKKK" }),
    { id: "CN/26", raw: "CN/26 NOTAMC CL/26\nQ) LLLL/QWPLW/IV/BO /W /000/050/3200N03448E005\nA) LLLL B) 2610200000 C) 2610202359\nE) CANCEL" }];
  const w = L.inputWindow({ dateFrom: "2026-10-20", timeFrom: "00:00", timeTo: "23:00" }, NOW), s = L.selectNotams(nts, w);
  assert.deepEqual(s.items.map(n => n.id + ":" + n.kind).sort(), ["CL/26:closure", "OB/26:obstacle"]);
  assert.deepEqual(s.otherKinds.map(x => x.id + ":" + x.kind).sort(), ["CK/26:checklist", "CN/26:cancel", "COM/26:comms", "GN/26:gnss", "RT/26:route"]);
  assert.equal(s.inWindow, 7);
  const only = L.selectNotams(nts, w, { kinds: ["closure"] });
  assert.deepEqual(only.items.map(n => n.id), ["CL/26"], "אפשר לצמצם לסגירות בלבד");
});

test("בחירת נוטמים: נוטם בלי מיקום אינו מצויר ונספר; מיקום משורת Q מסומן src=Q, ומטקסט E src=E", () => {
  const withE = ntm("E1/26", { e: POS("320130", "0344800") }), onlyQ = ntm("Q1/26", { qc: "3201N03448E005" }), none = ntm("NL1/26", { qc: noCoordQ }), none2 = ntm("NL2/26", { qc: noCoordQ, e: "OTHER OPS" });
  const s = L.selectNotams([withE, onlyQ, none, none2], L.inputWindow({ dateFrom: "2026-10-20", timeFrom: "00:00", timeTo: "23:00" }, NOW));
  assert.deepEqual(s.noLocation.sort(), ["NL1/26", "NL2/26"]);
  assert.deepEqual(s.items.map(n => n.id + ":" + n.geometry.src).sort(), ["E1/26:E", "Q1/26:Q"]);
  const e1 = s.items.find(n => n.id === "E1/26"); assert.equal(e1.geometry.kind, "circle"); assert.equal(e1.geometry.r, 500);
  assert.ok(Math.abs(e1.geometry.c[0] - 32.025) < 1e-6 && Math.abs(e1.geometry.c[1] - 34.8) < 1e-6);
});

test("בחירת נוטמים על הנתונים האמיתיים: בדיוק היקום שהבדיקה המלאה בוחנת (סגירות+מכשולים בחלון), בלי סינון מרחק", () => {
  for (const inp of [{ dateFrom: "2026-10-20", dateTo: "2026-10-23", timeFrom: "17:00", timeTo: "20:00" }, { dateFrom: "2026-12-20", dateTo: "2026-12-21", timeFrom: "08:00", timeTo: "10:00" }, {}]) {
    const w = L.inputWindow(inp, NOW), sel = L.selectNotams(snap.notams, w);
    const full = C.analyzeNotams(new C.Proj(32.099128, 34.816617), 100, snap.notams, w.fromMs, w.toMs, null, 1e9, 1e9);
    const universe = full.hits.concat(full.obstacles).map(n => n.id).sort(), mine = sel.items.map(n => n.id).concat(sel.noLocation).sort();
    assert.deepEqual(mine, universe, "אותם נוטמים כמו ב-analyzeNotams: " + JSON.stringify(inp));
    assert.equal(sel.inWindow, full.valid, "אותו מספר נוטמים בתוקף בחלון");
  }
  assert.ok(L.selectNotams(snap.notams, L.inputWindow({ dateFrom: "2026-10-20", dateTo: "2026-10-23", timeFrom: "17:00", timeTo: "20:00" }, NOW)).items.length > 5);
});

/* ================= צורות האזורים ================= */
test("צורות אזורים: כל האזורים עם גבול (א-17, ב-09) וכל אתרי רט״ג עם גבול; בקירוב לפי הנתונים; סדר ציור שמורות<ב-09<א-17", () => {
  const sh = L.zoneShapes(zones, inpa);
  const a17 = sh.filter(s => s.src === "a17"), b09 = sh.filter(s => s.src === "b09"), ip = sh.filter(s => s.src === "inpa");
  assert.equal(a17.length, zones.zones.filter(z => !/^B09/.test(z.cat)).length); assert.equal(b09.length, zones.zones.filter(z => /^B09/.test(z.cat)).length);
  assert.equal(ip.length, inpa.sites.filter(s => s.rings && s.rings.length).length);
  assert.ok(sh.every(s => s.rings.length > 0 && s.rings.every(r => r.length >= 3)), "לכל צורה גבול");
  assert.deepEqual(a17.filter(s => s.approx).map(s => s.id).sort(), zones.approxIds.slice().sort(), "בקירוב (א-17) = approxIds");
  assert.deepEqual(b09.filter(s => s.approx).map(s => s.id).sort(), zones.approx09Ids.slice().sort(), "בקירוב (ב-09) = approx09Ids");
  const firstOf = src => sh.findIndex(s => s.src === src), lastOf = src => sh.map(s => s.src).lastIndexOf(src);
  assert.ok(lastOf("inpa") < firstOf("b09") && lastOf("b09") < firstOf("a17"), "סדר הציור");
  assert.ok(sh.some(s => s.src === "a17" && s.id === "LLU01" && s.kind === C.ZONE_KIND.LLU));
});

test("צורות אזורים: אזור עם מעגל c+r בלבד (בלי rings) מצויר כטבעת מחושבת", () => {
  const sh = L.zoneShapes({ zones: [{ id: "C1", cat: "LLU", name: "עיגול", c: [32, 34.8], r: 1000, alt: "x" }, { id: "NONE", cat: "LLU", name: "בלי גבול" }] }, null);
  assert.equal(sh.length, 1); assert.equal(sh[0].id, "C1"); assert.ok(sh[0].rings[0].length >= 96);
  assert.ok(L.hitZones(sh, 32, 34.8).length === 1 && L.hitZones(sh, 32.02, 34.8).length === 0, "1000 מ׳ ≈ 0.009°");
});

test("צורות אזורים: kind/alt/label/approx/pmt זהים בדיוק למה שהבדיקות המלאות (analyzeZones) מפיקות — אותם טקסטים, בלי סטייה", () => {
  const sh = L.zoneShapes(zones, inpa), byId = new Map(sh.map(s => [s.src + ":" + s.id, s]));
  const pts = [[32.099128, 34.816617], [32.432685, 35.333095], [33.0, 35.5], [31.5, 35.0], [30.8, 34.9], [32.8, 35.1]];
  let compared = 0;
  for (const [la, lo] of pts) {
    const z = C.analyzeZones(new C.Proj(la, lo), 3000, { zones: zones.zones, inpa }, 5000, null, 750);
    for (const r of z.inside.concat(z.near)) {
      const s = byId.get(r.src + ":" + r.id); assert.ok(s, "יש צורה לכל אזור שהבדיקה המלאה מוצאת: " + r.id);
      assert.equal(s.kind, r.kind, r.id); assert.equal(s.alt, r.alt, r.id); assert.equal(s.label, r.label, r.id); assert.equal(s.approx, r.approx, r.id); assert.equal(s.pmt, r.pmt, r.id);
      compared++;
    }
  }
  assert.ok(compared > 30, "נבדקו אזורים רבים: " + compared);
});

/* ================= מה בנקודה ================= */
test("בדיקת נקודה בתוך צורה: טבעת פתוחה/סגורה, כמה טבעות, מעגל נוטם ושטח נוטם", () => {
  const ring = [[32.0, 34.0], [32.0, 34.1], [32.1, 34.1], [32.1, 34.0]];
  assert.ok(L.ringHas(ring, 32.05, 34.05)); assert.ok(!L.ringHas(ring, 32.2, 34.05)); assert.ok(!L.ringHas(ring, 32.05, 33.9));
  assert.ok(L.ringHas(ring.concat([ring[0]]), 32.05, 34.05), "טבעת סגורה (נקודה אחרונה = ראשונה)");
  const shapes = [{ id: "A", rings: [ring] }, { id: "B", rings: [ring, [[33, 34], [33, 34.1], [33.1, 34.1]]] }];
  assert.deepEqual(L.hitZones(shapes, 32.05, 34.05).map(s => s.id), ["A", "B"]); assert.deepEqual(L.hitZones(shapes, 33.03, 34.08).map(s => s.id), ["B"], "טבעות נפרדות = איחוד (לא חורים)");
  const circ = { geometry: { kind: "circle", c: [32, 34.8], r: 500 } }, poly = { geometry: { kind: "polygon", pts: [[32, 34], [32, 34.1], [32.1, 34.1]] } };
  assert.ok(L.notamHas(circ, 32.004, 34.8) && !L.notamHas(circ, 32.006, 34.8), "500 מ׳ ≈ 0.0045°");
  assert.ok(L.notamHas(poly, 32.01, 34.08) && !L.notamHas(poly, 32.09, 34.01));
  assert.deepEqual(L.hitNotams([circ, poly], 32.001, 34.8), [circ]);
});

test("הנקודה בתוך האזור במסד האמיתי: LLU01 בנקודת המרכז; הירקון — מחוץ ל-LLU20", () => {
  const sh = L.zoneShapes(zones, inpa);
  assert.ok(L.hitZones(sh, 31.935, 34.880556).some(s => s.id === "LLU01"));
  assert.ok(!L.hitZones(sh, 32.099128, 34.816617).some(s => s.id === "LLU20"));
});

/* ================= כרטיס הפופאפ ================= */
const TAG_OK = /^<\/?(div|span|b)( (class|dir|style)="[^"<>]*")*>$/;
const tagsOf = html => html.match(/<[^>]*>/g) || [];
test("פופאפ: תוכן האזור — מספר ושם, סוג, גבהים, הלשון מהפמ״ת בתוך ״…״ והערת קירוב", () => {
  const sh = L.zoneShapes(zones, inpa), ap = sh.find(s => s.src === "a17" && s.approx), plain = sh.find(s => s.id === "LLU01");
  const h1 = L.popupHtml({ zones: [plain], notams: [] }, {});
  assert.ok(h1.includes("LLU01 ״איילון-מעשיהו״") && h1.includes(plain.kind) && h1.includes("גבהים: " + C.esc(plain.alt)) && h1.includes("״" + C.esc(plain.pmt) + "״"));
  assert.ok(!/שרטוט בקירוב/.test(h1) && /פריט אחד/.test(h1));
  const h2 = L.popupHtml({ zones: [ap], notams: [] }, {});
  assert.ok(/שרטוט בקירוב — אינו הגבול הרשמי/.test(h2) && h2.includes(C.esc(ap.label)));
  assert.ok(tagsOf(h1).every(t => TAG_OK.test(t)) && tagsOf(h2).every(t => TAG_OK.test(t)), "רק תגיות מהרשימה הלבנה");
});

test("פופאפ: תוכן הנוטם — מספר, שורה ראשונה, תוקף UTC, גבהים, סימון מיקום משוער (Q)", () => {
  const s = L.selectNotams([ntm("C1/26", { e: POS("320130", "0344800"), b: "2610191600", c: "2610230200" }), ntm("Q2/26", { qc: "3201N03448E005", b: "2601010000", c: "PERM" })], L.inputWindow({ dateFrom: "2026-10-20", timeFrom: "00:00", timeTo: "23:00" }, NOW));
  const h = L.popupHtml({ zones: [], notams: s.items }, {});
  assert.ok(h.includes("C1/26") && h.includes("C1/26 תיאור") && h.includes("2026-10-19 16:00Z</span> – <span") && h.includes("2026-10-23 02:00Z") && h.includes("2026-01-01 00:00Z</span> – קבוע"), "תאריך+שעה בכל תוקף ברצף ltr נפרד שאינו נשבר (nowrap); ״קבוע״ עברית מחוץ ל-ltr");
  assert.ok(h.includes("GND – 500FT AMSL"), "גבהים משורות F)/G)");
  assert.equal((h.match(/המיקום משוער, מתוך שורת Q/g) || []).length, 1, "רק הנוטם שמיקומו מ-Q");
  assert.ok(/נוטם — סגירת מרחב אוויר/.test(h) && /פריטים/.test(h) && !/גללו/.test(h), "שני פריטים — בלי הנחיית גלילה");
  assert.ok(tagsOf(h).every(t => TAG_OK.test(t)));
});

test("פופאפ: טקסט עוין בשם אזור, בציטוט, בהערת הסעיף ובנוטם — הכול escaped ואין תגית שאינה מהרשימה הלבנה", () => {
  const hz = { src: "a17", id: "X\"><img src=x onerror=alert(1)>", name: "<script>alert(2)</script>", label: "X\"><img src=x onerror=alert(1)> ״<script>alert(2)</script>״", kind: "<b>kind</b>", alt: "<i>alt</i>\"'&",
    pmt: "<img src=x onerror=alert(3)> \"ציטוט\" 'q' &amp;", note: "", approx: true, footnote: true, rings: [] };
  const hi = { src: "inpa", id: "I", name: "<u>", label: "I ״<u>״", kind: "שמורה", alt: "x", pmt: "", note: "<svg onload=alert(4)>", approx: false, footnote: false, rings: [] };
  const hn = { id: "N<img src=z>", kind: "obstacle", heb: "<script>alert(5)</script>\nשורה שנייה", name: "", window: { from: 0, to: Infinity },
    raw: "N NOTAMN\nQ) LLLL/QOBCE/IV/M /W /000/050/3200N03448E001\nA) LLLL B) 2601010000 C) PERM\nE) X\nF) <u>GND</u> G) <svg onload=alert(6)> AMSL)", geometry: { kind: "circle", c: [32, 34.8], r: 10, src: "Q" } };
  const html = L.popupHtml({ zones: [hz, hi], notams: [hn] }, { b09Footnote: "<img src=y onerror=alert(7)> ¹ הערה" });
  const bad = tagsOf(html).filter(t => !TAG_OK.test(t));
  assert.deepEqual(bad, [], "אין תגיות זרות: " + bad.join(" "));
  for (const s of ["&lt;img src=x onerror=alert(1)&gt;", "&lt;script&gt;alert(2)&lt;/script&gt;", "&lt;b&gt;kind&lt;/b&gt;", "&lt;i&gt;alt&lt;/i&gt;&quot;&#39;", "&lt;svg onload=alert(4)&gt;", "N&lt;img src=z&gt;", "&lt;script&gt;alert(5)&lt;/script&gt;", "&lt;svg onload=alert(6)&gt;", "&lt;img src=y onerror=alert(7)&gt;", "&amp;amp;"])
    assert.ok(html.includes(s) || html.includes(s.replace("&#39;", "'")), "חסר escaping: " + s);
  assert.ok(!/<(img|script|svg|u|i)\b/i.test(html));
  assert.ok(/גללו/.test(html), "3 פריטים — הנחיית גלילה");
});

test("פופאפ: הגבלת אורך הרשימה (ועוד N) והערת הסעיף ¹ של ב-09 רק כשהאזור מסומן ¹", () => {
  const zs = Array.from({ length: 12 }, (_, i) => ({ src: "a17", id: "Z" + i, name: "n", label: "Z" + i + " ״n״", kind: "k", alt: "", pmt: "", note: "", approx: false, footnote: false, rings: [] }));
  const h = L.popupHtml({ zones: zs, notams: [] }, { maxZones: 8 });
  assert.equal((h.match(/lp-i/g) || []).length, 8); assert.ok(/ועוד 4 אזורים/.test(h) && /12 פריטים/.test(h));
  const withFn = { src: "b09", id: "302", name: "302", label: "302", kind: "k", alt: "גובה מרבי¹: 1 500", pmt: "", note: "", approx: false, footnote: true, rings: [] };
  assert.ok(L.popupHtml({ zones: [withFn], notams: [] }, { b09Footnote: "¹ הערת סעיף" }).includes("¹ הערת סעיף"));
  assert.ok(!L.popupHtml({ zones: [Object.assign({}, withFn, { footnote: false })], notams: [] }, { b09Footnote: "¹ הערת סעיף" }).includes("הערת סעיף"));
});

test("טקסטי נוטם: שורה ראשונה, קיצוץ ארוך, גבהים מ-F/G או מ-Q, תוקף UTC", () => {
  assert.equal(L.firstLine({ heb: "שורה א\nשורה ב" }), "שורה א"); assert.equal(L.firstLine({ name: "שם" }), "שם"); assert.equal(L.firstLine({}), "");
  assert.ok(L.firstLine({ heb: "א".repeat(500) }).length <= 281);
  assert.equal(L.notamAlt("E) X\nF) SFC\nG) 1000FT AGL)"), "SFC – 1000FT AGL");
  assert.equal(L.notamAlt("Q) LLLL/QWPLW/IV/BO /W /000/050/3200N03448E005\nE) X"), "0 – 5000 רגל (לפי שורת Q)");
  assert.match(L.notamAlt("Q) LLLL/QWPLW/IV/BO /W /000/999/3200N03448E005\nE) X"), /ללא הגבלה/);
  assert.equal(L.notamAlt("E) בלי גבהים"), "");
  assert.equal(L.fmtUtc(Date.UTC(2026, 9, 19, 16, 0)), "2026-10-19 16:00Z"); assert.equal(L.fmtUtc(Infinity), "קבוע");
});

/* ================= גיל הנתונים ================= */
test("גיל נתוני הנוטמים: פחות משעה / שעה / N שעות / לא ידוע", () => {
  const at = h => L.notamAge(new Date(NOW.getTime() - h * 3600e3).toISOString(), NOW);
  assert.equal(at(0.3).text, "נתוני הנוטמים נמשכו לפני פחות משעה"); assert.equal(at(1).text, "נתוני הנוטמים נמשכו לפני שעה");
  assert.equal(at(5).text, "נתוני הנוטמים נמשכו לפני 5 שעות"); assert.equal(at(80).text, "נתוני הנוטמים נמשכו לפני 80 שעות");
  assert.equal(at(-3).text, "נתוני הנוטמים נמשכו לפני פחות משעה", "חותמת עתידית (הפרשי שעונים) לא מציגה מספר שלילי");
  assert.equal(L.notamAge("", NOW), null); assert.equal(L.notamAge("זבל", NOW), null);
});

/* ================= פס הסיכום ================= */
test("פס סיכום: בלי נקודה / נקודה מחוץ לתחום — הנחיה, ותמיד שורה אחרונה 'תצוגה מקדימה בלבד'", () => {
  for (const a of [{}, { lat: NaN, lon: 34.8 }, { lat: "32", lon: "34.8" }, { lat: 32, lon: undefined }]) {
    const r = L.preview(Object.assign({ zones, inpa, notams: snap.notams, now: NOW }, a));
    assert.equal(r.state, "need-point"); assert.equal(r.lines[0].text, "בחרו נקודה במפה"); assert.equal(r.lines[r.lines.length - 1].text, L.LAST_LINE);
  }
  const far = L.preview({ lat: 48, lon: 2, zones, inpa, now: NOW }); assert.equal(far.state, "need-point"); assert.match(far.lines[0].text, /מחוץ לתחום ישראל/);
  assert.equal(L.LAST_LINE, "תצוגה מקדימה בלבד — הבדיקות המלאות רצות בלחיצה על ״הרץ את כל הבדיקות״.");
});

test("פס סיכום: חפיפה — 'בתוך הסגירה: חפיפה ל-…' עם שם האזור, ומחלקה hit", () => {
  const r = L.preview(baseArgs({ zones: mkZ([zA17("LLP9", "בדיקה", rect(-300, 300, -300, 300))]), notams: [] }));
  assert.equal(r.state, "ok");
  const l = line(r, "inside"); assert.equal(l.label, "בתוך הסגירה"); assert.equal(l.cls, "hit");
  assert.ok(l.text.startsWith("חפיפה ל-LLP9 ״בדיקה״") && l.text.includes(C.ZONE_KIND.LLP), l.text);
  assert.equal(r.lines[r.lines.length - 1].text, L.LAST_LINE);
});

test("פס סיכום: אין חפיפה / אין אזור בקרבה", () => {
  const r = L.preview(baseArgs({ zones: mkZ([zA17("FAR", "רחוק", rect(8000, 9000, 8000, 9000))]), notams: [] }));
  assert.equal(line(r, "inside").text, "אין חפיפה לאזורי איסור שבקובץ", "הקביעה מוגבלת לגבולות שבקובץ — אתרי רט״ג בלי גבול נבדקים רק בהרצה המלאה"); assert.equal(line(r, "inside").cls, "ok");
  assert.equal(line(r, "near").label, "בקרבה (עד 1,000 מ׳ מקצה הסגירה)"); assert.equal(line(r, "near").text, "אין אזור איסור בקובץ");
});

test("פס סיכום: בקרבה — מרחק מקצה הסגירה ומהנקודה, וסימון שרטוט בקירוב (עם שולי הקירוב)", () => {
  const r = L.preview(baseArgs({ zones: mkZ([zA17("N1", "קרוב", rect(600, 800, -100, 100)), zA17("N2", "בקירוב", rect(1500, 1700, -100, 100), { approx: true }), zA17("N3", "רחוק", rect(2500, 2700, -100, 100))]), notams: [] }));
  const n = line(r, "near");
  assert.ok(noRlm(n.text).includes("N1 ״קרוב״ — 500 מ׳ מקצה הסגירה (600 מ׳ מהנקודה)"), n.text);
  assert.ok(noRlm(n.text).includes("N2 ״בקירוב״ — 1.4 ק״מ מקצה הסגירה (1.5 ק״מ מהנקודה), שרטוט בקירוב"), "אזור בקירוב נכלל עד 1000+750 מ׳ מקצה הסגירה: " + n.text);
  assert.ok(!n.text.includes("N3"), "מעבר לטווח — לא מופיע");
  assert.equal(line(r, "inside").text, "אין חפיפה לאזורי איסור שבקובץ");
});

test("פס סיכום: אזור בקירוב בתוך הסגירה מסומן; רט״ג ו-ב-09 מסומנים בסוגם", () => {
  const r = L.preview(baseArgs({ heightM: NaN, zones: mkZ([zA17("AP", "בקירוב", rect(-300, 300, -300, 300), { approx: true }), zB09("901", 0, rect(-300, 300, -300, 300))]),
    inpa: { sites: [{ id: "LLP1", name: "שמורה", kind: "R", min: "GND", max: "300", rings: [rect(-300, 300, -300, 300)] }] }, notams: [] }));
  const t = line(r, "inside").text;
  assert.ok(t.includes("שרטוט בקירוב, אינו הגבול הרשמי") && t.includes("שמורת טבע (רט״ג)") && t.includes("אזור טיסה לכטב״ם (פרק ב-09"), t);
});

test("פס סיכום: חסר גובה — לא מסננים אזורי ב-09 ואומרים להזין גובה; עם גובה — ב-09 גבוה מדי מוחרג ונאמר", () => {
  const z = mkZ([zB09("902", 12000, rect(-300, 300, -300, 300))]);
  const noH = L.preview(baseArgs({ zones: z, heightM: undefined, notams: [] }));
  assert.ok(line(noH, "inside").text.includes("902") && /הזינו גובה לחישוב מדויק/.test(line(noH, "height").text), "בלי גובה: מופיע, ועם הנחיה");
  assert.equal(line(noH, "height").cls, "warn");
  for (const h of [0, -5, NaN, null]) assert.ok(line(L.preview(baseArgs({ zones: z, heightM: h, notams: [] })), "height"), "גובה לא תקין (" + h + ") = חסר");
  const withH = L.preview(baseArgs({ zones: z, heightM: 80, notams: [] }));
  assert.equal(line(withH, "inside").text, "אין חפיפה לאזורי איסור שבקובץ"); assert.ok(!line(withH, "height"));
  assert.equal(line(withH, "excluded").text, "אזורי ב-09 שאינם חופפים אנכית לגובה שהוזן: 902.");
});

test("פס סיכום: חסר רדיוס תקין — החישוב לנקודה עצמה, עם הנחיה", () => {
  const r = L.preview(baseArgs({ radius: NaN, zones: mkZ([zA17("LLP9", "בדיקה", rect(-300, 300, -300, 300))]), notams: [] }));
  assert.ok(line(r, "radius") && /הזינו רדיוס/.test(line(r, "radius").text) && line(r, "inside").text.includes("LLP9"));
});

test("פס סיכום נוטמים: חופף / בקרבה עם מרחק מקצה הסגירה / מכשול / אין בטווח — ועם חלון התאריכים", () => {
  // מרכז 90 שניות קשת צפונה (32°01'30"N) ברדיוס 500 מ׳; חופף: מרכז בנקודה
  const near = ntm("NR1/26", { e: POS("320130", "0344800") }), over = ntm("OV1/26", { e: POS("320000", "0344800") }), ob = ntm("OB1/26", { q: "QOBCE", e: "CRANE WI 500M RADIUS CENTERED ON PSN 320000N0344800E" }), farN = ntm("FAR1/26", { e: POS("330000", "0344800") });
  const r = L.preview(baseArgs({ notams: [near, over, ob, farN] }));
  const t = noRlm(line(r, "notams").text), exEdge = C.fmtDist(Math.hypot(...P0.xy(32.025, 34.8)) - 500 - 100);
  assert.ok(t.includes("OV1/26 — חופף לסגירה") && t.includes("OB1/26 — חופף לסגירה (מכשול)") && t.includes("NR1/26 — " + exEdge + " מקצה הסגירה"), t);
  assert.ok(!t.includes("FAR1/26"), "מעבר ל-10 ק״מ — לא מופיע");
  assert.equal(line(r, "notams").cls, "hit");
  assert.equal(line(r, "window").text, "20.10.2026 17:00 – 20.10.2026 20:00 (שעון מקומי)");
  const none = L.preview(baseArgs({ notams: [farN] }));
  assert.match(line(none, "notams").text, /^אין נוטם בטווח \(עד 10,000 מ׳ מקצה הסגירה, מכשולים עד 1,000 מ׳\)$/); assert.equal(line(none, "notams").cls, "ok");
  const nearOnly = L.preview(baseArgs({ notams: [near] })); assert.equal(line(nearOnly, "notams").cls, "near");
});

test("פס סיכום נוטמים: חלון התאריכים מסנן; ללא תאריכים — מעכשיו; נוטם שפג תוקפו לא נספר", () => {
  const n1 = ntm("D20/26", { b: "2610200000", c: "2610202359", e: POS("320000", "0344800") }), n2 = ntm("D25/26", { b: "2610250000", c: "2610252359", e: POS("320000", "0344800") }), old = ntm("OLD/26", { b: "2610010000", c: "2610011200", e: POS("320000", "0344800") });
  const ids = r => { const l = line(r, "notams"); return (l.text.match(/[A-Z0-9]+\/26/g) || []).sort(); };
  assert.deepEqual(ids(L.preview(baseArgs({ notams: [n1, n2, old] }))), ["D20/26"]);
  assert.deepEqual(ids(L.preview(baseArgs({ notams: [n1, n2, old], dateFrom: "2026-10-25", dateTo: "2026-10-25" }))), ["D25/26"]);
  const now = L.preview(baseArgs({ notams: [n1, n2, old], dateFrom: "", dateTo: "", timeFrom: "", timeTo: "" }));
  assert.deepEqual(ids(now), ["D20/26", "D25/26"], "מעכשיו (16.10): שניהם עדיין לא הסתיימו, והישן — כן");
  assert.equal(line(now, "window").text, "מעכשיו (עוד לא נבחרו תאריכים)");
});

test("פס סיכום נוטמים: נוטם בלי מיקום — נספר בשורה נפרדת 'יש לקרוא אותם בדוח'; יחיד/רבים", () => {
  const nl1 = ntm("NL1/26", { qc: noCoordQ }), nl2 = ntm("NL2/26", { qc: noCoordQ }), here = ntm("H/26", { e: POS("320000", "0344800") });
  const one = L.preview(baseArgs({ notams: [nl1, here] })), two = L.preview(baseArgs({ notams: [nl1, nl2, here] })), zero = L.preview(baseArgs({ notams: [here] }));
  assert.equal(line(one, "noloc").text, "1 נוטם ללא מיקום — יש לקרוא אותו בדוח."); assert.equal(line(two, "noloc").text, "2 נוטמים ללא מיקום — יש לקרוא אותם בדוח.");
  assert.ok(!line(zero, "noloc")); assert.ok(!line(two, "notams").text.includes("NL1/26"), "נוטם בלי מיקום אינו ברשימת הנוטמים שבטווח (מרחק לא ידוע)");
  assert.equal(two.selection.noLocation.length, 2);
});

test("פס סיכום נוטמים: רשימה ארוכה נחתכת ('ועוד N'), ממוינת לפי מרחק", () => {
  const many = Array.from({ length: 9 }, (_, i) => ntm("M" + i + "/26", { e: "OPS WI 100M RADIUS CENTERED ON PSN 32" + String(i + 1).padStart(2, "0") + "00N0344800E CLSD" }));   // 32°01'..32°09' — קרוב עד 16 ק״מ
  const t = line(L.preview(baseArgs({ notams: many, thresholds: Object.assign({}, TH, { notam_near_m: 40000 }) })), "notams").text;
  assert.match(t, /ועוד \d+ נוטמים/); assert.ok(t.indexOf("M0/26") < t.indexOf("M1/26") && t.indexOf("M1/26") < t.indexOf("M2/26"));
});

test("פס סיכום: נתונים חסרים — אזורים/נוטמים לא נטענו; השורה האחרונה נשמרת", () => {
  const noZ = L.preview(baseArgs({ zones: null, notams: [] })), noN = L.preview(baseArgs({ zones: mkZ([]), notams: undefined })), none = L.preview(baseArgs({ zones: undefined, inpa: undefined, notams: null }));
  assert.match(line(noZ, "zones").text, /נתוני האזורים לא נטענו/); assert.ok(line(noZ, "notams"), "הנוטמים עדיין מחושבים");
  assert.match(line(noN, "notams").text, /נתוני הנוטמים לא נטענו/); assert.ok(line(noN, "inside"));
  assert.ok(line(none, "zones") && line(none, "notams") && !line(none, "inside"));
  for (const r of [noZ, noN, none]) assert.equal(r.lines[r.lines.length - 1].text, L.LAST_LINE);
  assert.equal(line(noZ, "zones").cls, "warn");
});

test("פס סיכום: אזהרת גיל נוטמים רק מעל הסף (24 שעות); גיל לא ידוע — נאמר", () => {
  const iso = h => new Date(NOW.getTime() - h * 3600e3).toISOString();
  assert.ok(!line(L.preview(baseArgs({ notamFetchedIso: iso(5) })), "age"));
  const old = line(L.preview(baseArgs({ notamFetchedIso: iso(30) })), "age"); assert.equal(old.text, "נתוני הנוטמים נמשכו לפני 30 שעות — ייתכן שאינם עדכניים."); assert.equal(old.cls, "warn");
  assert.match(line(L.preview(baseArgs({ notamFetchedIso: undefined })), "age").text, /לא ידוע מתי נמשכו/);
});

test("פס סיכום על נתוני אמת: הירקון — LLU20 בקרבה כמו בבדיקות המלאות, והנוטם הקבוע C0431/26 כמו analyzeNotams", () => {
  const inp = exp.input, a = Object.assign({}, inp, { zones, inpa, notams: snap.notams, notamFetchedIso: snap.fetched_iso, thresholds: TH, now: NOW });
  const r = L.preview(a);
  const full = C.analyze(Object.assign({}, inp, { purpose: cfg.purposes[0], aircraft: [cfg.aircraft[0]], vlos: true, siteName: "בדיקה", requesterName: "בודק", requesterPhone: "050-0000000", contacts: [{ name: "א", phone: "050-0000001" }, { name: "ב", phone: "050-0000002" }] }),
    { zones, inpa, agri: J("members-k38p/data/agri-airstrips.json"), notams: snap.notams, notamFetchedIso: snap.fetched_iso, near: J("members-k38p/requests/selftest/yarkon/near.json"), far: J("members-k38p/requests/selftest/yarkon/far.json"), ext: J("members-k38p/requests/selftest/yarkon/ext.json"), reverse: J("members-k38p/requests/selftest/yarkon/reverse.json") }, cfg, NOW);
  // אותם אזורים ואותם מרחקים
  const z = full.zones; assert.deepEqual(r.zonesRes.inside.map(x => x.id), z.inside.map(x => x.id)); assert.deepEqual(r.zonesRes.near.map(x => x.id + ":" + Math.round(x.d)), z.near.map(x => x.id + ":" + Math.round(x.d)));
  const z20 = noRlm(line(r, "near").text); assert.ok(z20.includes("LLU20 ״תל אביב״ — " + C.fmtDist(z.near.find(x => x.id === "LLU20").edge) + " מקצה הסגירה (" + C.fmtDist(z.near.find(x => x.id === "LLU20").d) + " מהנקודה)"), z20);
  assert.ok(Math.abs(z.near.find(x => x.id === "LLU20").d - exp.zones[0].d) <= 1.5, "525.9 מ׳ מהנקודה");
  // אותם נוטמים
  assert.deepEqual(r.notamsRes.hits.map(h => h.id), full.notams.hits.map(h => h.id)); assert.deepEqual(r.notamsRes.hits.map(h => h.id), exp.notamHits);
  assert.ok(noRlm(line(r, "notams").text).includes("C0431/26 — " + C.fmtDist(full.notams.hits[0].edge) + " מקצה הסגירה"), line(r, "notams").text);
  assert.ok(!line(r, "height"), "הגובה הוזן");
});

test("פס סיכום: אין שינוי בקלט ואין תלות בשער (העתק עמוק לפני/אחרי)", () => {
  const a = baseArgs({ zones: mkZ([zA17("LLP9", "בדיקה", rect(-300, 300, -300, 300))]), notams: [ntm("N1/26", { e: POS("320000", "0344800") })] });
  const before = JSON.stringify(a); L.preview(a); L.selectNotams(a.notams, L.inputWindow(a, NOW)); L.zoneShapes(a.zones, a.inpa);
  assert.equal(JSON.stringify(a), before);
});

test("פס סיכום: טקסט עוין בשם אזור עובר כטקסט רגיל (ה-escaping נעשה ב-textContent בממשק)", () => {
  const r = L.preview(baseArgs({ zones: mkZ([zA17("H1", "<img src=x onerror=alert(1)>", rect(600, 800, -100, 100))]), notams: [ntm("N<b>1/26", { e: POS("320000", "0344800") })] }));
  assert.ok(line(r, "near").text.includes("<img src=x onerror=alert(1)>"), "הטקסט כפי שהוא — לא מקודד כפול"); assert.ok(!line(r, "near").text.includes("&lt;"));
});

/* ================= הפרדה מהשער, מההדפסה ומהדוח (בדיקות מבנה) ================= */
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
test("מבנה: מודול השכבות אינו מכיר את שער ״מוכן לשליחה״ ואינו כותב מצב", () => {
  const src = stripComments(fs.readFileSync(path.join(ROOT, "members-k38p/requests/js/maplayers.js"), "utf8"));
  assert.ok(!/REQUIRED_CHECKS|\bgate\b|setStatus|statuses|localStorage|(^|[^.\w])(document|window)\./.test(src), "לוגיקה טהורה: בלי שער, סטטוסים, אחסון או DOM");
  assert.ok(!/\\u[0-9a-fA-F]{4}/.test(fs.readFileSync(path.join(ROOT, "members-k38p/requests/js/maplayers.js"), "utf8")), "בלי רצפי unicode-escape בקובץ");
});

test("מבנה: בלוק השכבות ב-ui.js לא נוגע בשער/בניתוח (קריאה בלבד של סטטוסים), והפס נבנה ב-textContent", () => {
  const ui = fs.readFileSync(path.join(ROOT, "members-k38p/requests/js/ui.js"), "utf8");
  const a = ui.indexOf("/* ---------- שכבות איסורים (פמ״ת) ונוטמים על המפה"), b = ui.indexOf("async function searchPlace");
  assert.ok(a > 0 && b > a, "הבלוק נמצא");
  const code = stripComments(ui.slice(a, b));
  assert.ok(!/setStatus\(|refreshGate\(|C\.gate\(|S\.ready|S\.stale|S\.res\b|clearOutcome\(|S\.statuses\s*(\[[^\]]*\])?\s*=[^=]/.test(code), "הבלוק אינו כותב לשער ולניתוח");
  const sm = code.slice(code.indexOf("function updateSummary"), code.indexOf("function onLayerData"));
  assert.ok(sm.includes("textContent") && sm.includes("createTextNode") && !/innerHTML|insertAdjacentHTML/.test(sm), "הפס נבנה בטקסט בלבד");
  assert.ok(code.includes("LY.popupHtml") && !/\.bindPopup\(|setContent\([^)]*\+/.test(code), "תוכן הכרטיס רק דרך popupHtml");
  assert.ok(/interactive:\s*false/.test(code), "האזורים והנוטמים אינם אינטראקטיביים (לא בולעים לחיצה)");
});

test("מבנה: המתגים והפס ב-index.html נמצאים לפני ובמחוץ לדוח ו-nonprint; הסקריפט נטען אחרי core.js ולפני ui.js", () => {
  const html = fs.readFileSync(path.join(ROOT, "members-k38p/requests/index.html"), "utf8");
  const iBar = html.indexOf('id="layerBar"'), iSum = html.indexOf('id="pointSummary"'), iRes = html.indexOf('id="resultsSec"'), iHost = html.indexOf('id="reportHost"');
  assert.ok(iBar > 0 && iSum > iBar && iRes > iSum && iHost > iRes, "המתגים והפס לפני #resultsSec ו-#report");
  assert.match(html, /id="layerBar"[^>]*>|class="lyrbar nonprint" id="layerBar"/); assert.ok(/class="[^"]*nonprint[^"]*" id="layerBar"/.test(html) && /id="pointSummary"[^>]*aria-live="polite"/.test(html) && /class="psum nonprint"/.test(html));
  const iCore = html.indexOf("js/core.js"), iLay = html.indexOf("js/maplayers.js?v=1"), iUi = html.indexOf("js/ui.js");
  assert.ok(iCore > 0 && iLay > iCore && iUi > iLay);
  assert.ok(/id="lyrZones" checked/.test(html) && /id="lyrNotams" checked/.test(html), "שני המתגים דולקים כברירת מחדל");
});

test("הסברי ״!״: מציינים מה מוצג, קירוב, סינון לפי תאריכים, תצוגה מקדימה והרצת הבדיקות המלאות", () => {
  assert.ok(/א-17/.test(L.HELP.zones) && /ב-09/.test(L.HELP.zones) && /רט״ג/.test(L.HELP.zones) && /בקירוב/.test(L.HELP.zones) && /אינו הגבול הרשמי/.test(L.HELP.zones));
  assert.ok(/התאריכים והשעות/.test(L.HELP.notams) && /עדיין בתוקף/.test(L.HELP.notams) && /ללא מיקום|בלי מיקום/.test(L.HELP.notams) && /בדוח/.test(L.HELP.notams));
  for (const k of ["zones", "notams"]) assert.ok(/תצוגה מקדימה בלבד/.test(L.HELP[k]) && /״מוכן לשליחה״/.test(L.HELP[k]) && /הרץ את כל הבדיקות/.test(L.HELP[k]) && L.HELP_NAME[k]);
});

/* ================= תיקוני הסקירה (20 ממצאים) ================= */
const un = n => ({ sites: [], unmapped: Array.from({ length: n }, (_, i) => ({ id: "LLP" + (1000 + i), name: "אתר " + i })) });

test("ממצא 1/12: אתרי רט״ג בלי גבול בקובץ — שורת ״לא נבדקו N …״ (יחיד/רבים) רק כשיש כאלה, בנייטרלי; ״אין״ מוגבל לקובץ; על הנתונים האמיתיים 121", () => {
  assert.ok(!line(L.preview(baseArgs({ inpa: un(0) })), "unmapped"), "אין אתרים בלי גבול — אין שורה");
  assert.ok(!line(L.preview(baseArgs({ inpa: { sites: [] } })), "unmapped"), "בלי שדה unmapped — אין שורה");
  assert.equal(line(L.preview(baseArgs({ inpa: un(1) })), "unmapped").text, "לא נבדק אתר רט״ג אחד שאין לו גבול בקובץ — הוא נבדק רק בהרצה המלאה, לפי שם מול OpenStreetMap.");
  const many = line(L.preview(baseArgs({ inpa: un(121) })), "unmapped");
  assert.equal(many.text, "לא נבדקו 121 אתרי רט״ג שאין להם גבול בקובץ — הם נבדקים רק בהרצה המלאה, לפי שם מול OpenStreetMap.");
  assert.equal(many.cls, "", "נייטרלי, לא אזהרה קבועה (עייפות אזהרות)");
  const r = L.preview(baseArgs({ inpa: un(5) })), keys = r.lines.map(l => l.k);
  assert.ok(keys.indexOf("near") < keys.indexOf("unmapped") && keys.indexOf("unmapped") < keys.indexOf("window"), "אחרי שורת ״בקרבה״ ולפני הנוטמים: " + keys.join());
  assert.match(line(r, "inside").text, /שבקובץ$/); assert.match(line(r, "near").text, /בקובץ$/);
  const real = L.preview(Object.assign({ lat: 33.09, lon: 35.6, radius: 300, heightM: 80, zones, inpa, notams: snap.notams, notamFetchedIso: snap.fetched_iso, thresholds: TH, now: NOW }));
  assert.match(line(real, "unmapped").text, new RegExp("לא נבדקו " + inpa.unmapped.length + " אתרי רט״ג"), "נתונים אמיתיים: " + inpa.unmapped.length);
  assert.ok(!L.HELP.zones.includes("אינו מצויר ואינו נבדק בפס") === false, "ה-״!״ מציין שאתר בלי גבול אינו נבדק בפס");
});

test("ממצא 2/7: נתונים פגומים — גבול פגום זורק badId מ-zoneShapes, נוטם עם רדיוס אינסופי/ענק עובר ל״ללא מיקום״, והפס לעולם לא זורק", () => {
  const badRings = [[[null, null], [32, 34], [32.1, 34.1]], [["x", "y"], [32, 34], [32.1, 34.1]], [[32], [32, 34], [32.1, 34.1]], [[NaN, 34], [32, 34], [32.1, 34.1]], [[32, 34], [32.1, 34.1]], [[Infinity, 34], [32, 34], [32.1, 34.1]]];
  for (const ring of badRings) {
    const z = mkZ([zA17("BAD1", "פגום", ring)]);
    assert.throws(() => L.zoneShapes(z, noInpa), e => e.badId === "BAD1", JSON.stringify(ring));
    let r; assert.doesNotThrow(() => { r = L.preview(baseArgs({ zones: z })); }, "הפס לא זורק: " + JSON.stringify(ring));
    const w = line(r, "zones"); assert.ok(w && w.cls === "warn" && /נתונים לא תקינים: BAD1/.test(w.text), "במקום ״אין חפיפה״ בירוק — אזהרה: " + JSON.stringify(r.lines.map(l => l.text)));
    assert.ok(!line(r, "inside") && !line(r, "near"), "אין קביעה על מפה פגומה"); assert.equal(r.lines[r.lines.length - 1].text, L.LAST_LINE); assert.ok(line(r, "notams"), "הנוטמים ממשיכים");
  }
  assert.throws(() => L.zoneShapes({ zones: [{ id: "R1", cat: "LLP", rings: "לא מערך" }] }, noInpa), e => e.badId === "R1");
  assert.throws(() => L.zoneShapes({ zones: [{ id: "C2", cat: "LLU", c: ["a", "b"], r: 100 }] }, noInpa), e => e.badId === "C2", "מעגל עם מרכז לא מספרי");
  assert.throws(() => L.zoneShapes({ zones: [{ id: "C3", cat: "LLU", c: [32, 34.8], r: NaN }] }, noInpa), e => e.badId === "C3");
  assert.throws(() => L.zoneShapes(mkZ([]), { sites: [{ id: "LLP7", kind: "R", max: 100, rings: [[["a", "b"], [1, 2], [3, 4]]] }] }), e => e.badId === "LLP7", "אתר רט״ג עם גבול פגום");
  // נוטם: רדיוס שגולש לאינסוף (400 ספרות), ענק (3,000 ק״מ) — בלי מיקום; רגיל — מצויר
  const w = L.inputWindow(baseArgs(), NOW);
  const huge = ntm("INF/26", { e: "OPS WI " + "9".repeat(400) + " KM RADIUS CENTERED ON PSN 320000N0344800E CLSD" }), big = ntm("BIG/26", { e: "OPS WI 3000 KM RADIUS CENTERED ON PSN 320000N0344800E CLSD" }), ok = ntm("OK/26", { e: POS("320000", "0344800") });
  const s = L.selectNotams([huge, big, ok], w);
  assert.deepEqual(s.noLocation.sort(), ["BIG/26", "INF/26"]); assert.deepEqual(s.items.map(n => n.id), ["OK/26"]);
  let r; assert.doesNotThrow(() => { r = L.preview(baseArgs({ notams: [huge, big, ok] })); });
  assert.match(line(r, "noloc").text, /^2 נוטמים ללא מיקום/);
  // קלט שאינו אובייקט / ערכים חסרים: בלי חריגה
  for (const a of [{ notams: [null, {}, { id: "X" }, { raw: 5 }] }, { zones: { zones: [null] } }, { zones: { zones: [{}] } }]) assert.doesNotThrow(() => L.preview(baseArgs(a)), JSON.stringify(a));
});

test("ממצא 8: notamAlt — F) ואחריו אלפי רווחים/שורות בלי G) הוא ליניארי (לא מעוקב), וההתנהגות הקודמת נשמרת", () => {
  const cases = ["E) X\nF)" + " ".repeat(5000) + "\nZ", "E) X\nF)" + " ".repeat(5000) + "Z", "E) X\nF)" + "\n".repeat(5000) + "Z", "E) X\nF) " + " \t".repeat(3000), "F)".repeat(3000) + " ".repeat(3000)];
  for (const raw of cases) { const t0 = performance.now(), r = L.notamAlt(raw), dt = performance.now() - t0; assert.equal(r, "", "אין G): ריק"); assert.ok(dt < 50, "זמן " + dt.toFixed(1) + " מ״ש ל-" + raw.length + " תווים"); }
  assert.equal(L.notamAlt("E) X\nF) SFC G) 1000FT AGL)"), "SFC – 1000FT AGL", "G) באותה שורה");
  assert.equal(L.notamAlt("E) X\nF) SFC\n  \nG) 500FT AMSL)"), "SFC – 500FT AMSL", "G) בשורה הלא-ריקה הבאה");
  assert.equal(L.notamAlt("E) X\nF) SFC\nE2) אחר\nG) 500FT)"), "", "שורה אחרת ביניהם: לא מחברים (כמו הביטוי הקודם)");
  assert.equal(L.notamAlt("F) ראשון\nF) SFC\nG) 1000FT AGL)"), "SFC – 1000FT AGL", "F) ראשון בלי G) — מנסים את הבא");
  assert.equal(L.notamAlt("E) X\nF) \nG) 1000FT)"), "0 – 5000 רגל (לפי שורת Q)".replace(/.*/, "") , "F) ריק — לא משתמשים בו (ואין Q בטקסט)");
});

test("ממצא 10: inputWindow — חלון זהה לשורה הראשונה/האחרונה בטבלת יום/לילה המלאה (180 צירופים, שעון קיץ וחורף, חוצה חצות), קל לחישוב, והטווח הארוך אינו נחתך בשקט", () => {
  const days = [["2026-03-20", 0], ["2026-03-25", 5], ["2026-10-20", 3], ["2026-10-22", 6], ["2026-10-25", 0], ["2026-12-30", 7], ["2027-03-24", 4], ["2026-01-10", 60]], times = [["17:00", "20:00"], ["22:00", "02:00"], ["00:00", "23:59"], ["06:30", "06:30"], ["", ""]];
  let n = 0;
  for (const [d0, span] of days) for (const [tf, tt] of times) {
    const dTo = new Date(Date.UTC(+d0.slice(0, 4), +d0.slice(5, 7) - 1, +d0.slice(8) + span)).toISOString().slice(0, 10), full = !(tf && tt);
    const rows = C.dayNightTable(31.8, 35.0, d0, dTo, full ? "00:00" : tf, full ? "23:59" : tt), w = L.inputWindow({ dateFrom: d0, dateTo: dTo, timeFrom: tf, timeTo: tt }, NOW);
    assert.equal(w.fromMs, +rows[0].startUtc, d0 + ".." + dTo + " " + tf); assert.equal(w.toMs, +rows[rows.length - 1].endUtc, d0 + ".." + dTo + " " + tt); assert.equal(w.tooLong, span > 60 ? true : false); n++;
  }
  assert.ok(n >= 40, "נבדקו " + n);
  // הקלדת שנה בשדה התאריך (0002 / 0020 / 0202): לא תאריך — נפילה למעכשיו עם הסבר, ובלי חישוב כבד
  for (const y of ["0002", "0020", "0202", "1999"]) { const t0 = performance.now(), w = L.inputWindow({ dateFrom: y + "-10-20", dateTo: "2026-10-23", timeFrom: "17:00", timeTo: "20:00" }, NOW), dt = performance.now() - t0; assert.equal(w.mode, "now"); assert.match(w.reason, /אינם תקינים/); assert.ok(dt < 20, y + ": " + dt.toFixed(1) + " מ״ש"); }
  { const t0 = performance.now(); for (let i = 0; i < 40; i++) L.inputWindow({ dateFrom: "2026-10-" + String(1 + (i % 28)).padStart(2, "0"), dateTo: "2026-12-20", timeFrom: "17:00", timeTo: "20:00" }, NOW); assert.ok(performance.now() - t0 < 400, "40 חישובי חלון (טווח 60 ימים) תוך " + (performance.now() - t0).toFixed(0) + " מ״ש"); }
  // טווח ארוך (400+ ימים): התווית והחלון מסכימים (לא נחתכים ב-400 שורות) ומסומנים tooLong; הפס מזהיר שההרצה תידחה
  const long = L.inputWindow({ dateFrom: "2026-10-20", dateTo: "2030-12-18", timeFrom: "17:00", timeTo: "20:00" }, NOW);
  assert.equal(long.label, "20.10.2026 17:00 – 18.12.2030 20:00 (שעון מקומי)"); assert.equal(long.tooLong, true);
  assert.equal(long.toMs, +C.dayNightTable(31.8, 35.0, "2030-12-18", "2030-12-18", "17:00", "20:00")[0].endUtc, "הסיום בפועל = סוף היום האחרון שבתווית");
  assert.match(line(L.preview(baseArgs({ dateTo: "2030-12-18" })), "range").text, /עולה על 60 ימים/); assert.ok(!line(L.preview(baseArgs()), "range"));
});

test("ממצא 13/15: סדר תצוגה RTL — RLM אחרי מזהה לטיני לפני ״ — מספר״ (נוטם ותווית אזור), ואזור בלי שם מוצג כמזהה בלבד (בלי ״״) בצורות, בפס ובבדיקה המלאה", () => {
  const noName = zA17("LLR120", "", rect(600, 800, -100, 100), { cat: "LLR" }), named = zA17("LLU20", "תל אביב", rect(800, 900, -100, 100));
  const near = ntm("NR1/26", { e: POS("320130", "0344800") });
  const r = L.preview(baseArgs({ zones: mkZ([noName, named]), notams: [near] }));
  const nt = line(r, "near").text, nn = line(r, "notams").text;
  assert.ok(nt.includes("LLR120" + RLM + " — ") && !nt.includes("״״"), nt); assert.ok(nt.includes("LLU20 ״תל אביב״" + RLM + " — "), nt);
  assert.ok(nn.includes("NR1/26" + RLM + " — "), nn);
  assert.equal(L.zoneShapes(mkZ([noName]), noInpa)[0].label, "LLR120");
  const z = C.analyzeZones(P0, 1000, { zones: [noName], inpa: noInpa }, 5000, null, 750); assert.equal(z.inside.concat(z.near)[0].label, "LLR120", "analyzeZones: אותו כלל");
  const inLine = line(L.preview(baseArgs({ zones: mkZ([zA17("LLR121", "", rect(-300, 300, -300, 300), { cat: "LLR" })]) })), "inside").text; assert.ok(/^חפיפה ל-LLR121 — /.test(inLine) && !inLine.includes("״״"), inLine);
  const rs = L.zoneShapes(zones, inpa); assert.ok(rs.filter(s => /״״/.test(s.label)).length === 0, "בנתונים האמיתיים אין ״״ ריקות");
  const noNm = zones.zones.filter(zz => !zz.name && zz.cat !== "B09" && zz.cat !== "B09B"); assert.ok(noNm.length >= 3, "בנתונים יש אזורים בלי שם (LLR107/120/601)");
  for (const zz of noNm) assert.equal(rs.find(s => s.id === zz.id).label, zz.id);
});

test("ממצא 14: גבהים בכרטיס נוטם — עברית לעולם לא בתוך dir=ltr (רק הרצפים הלטיניים/המספריים), טקסט עוין escaped, תוקף ב-nowrap", () => {
  const q = u => "E) X\nQ) LLLL/QWPLW/IV/BO /W /000/" + u + "/3200N03448E005";
  assert.equal(L.notamAltHtml(q("060")), '<span dir="ltr">0</span> – <span dir="ltr">6000</span> רגל (לפי שורת Q)');
  assert.equal(L.notamAltHtml(q("999")), '<span dir="ltr">0</span> – ללא הגבלה (לפי שורת Q)');
  assert.equal(L.notamAltHtml("E) X\nF) SFC\nG) 1000FT AGL)"), '<span dir="ltr">SFC – 1000FT AGL</span>');
  assert.equal(L.notamAltHtml("E) בלי גבהים"), ""); assert.equal(L.notamAltHtml(""), "");
  const host = L.notamAltHtml("E) X\nF) <img src=x onerror=alert(1)>\nG) 5'00 \"FT\" &amp;)");
  assert.ok(host.includes("&lt;img src=x onerror=alert(1)&gt;") && !/<img/i.test(host) && host.includes("&amp;amp;"), host);
  for (const h of [L.notamAltHtml(q("060")), L.notamAltHtml(q("999")), host]) assert.ok(!/<span dir="ltr">[^<]*[א-ת][^<]*<\/span>/.test(h), "אין עברית בתוך ltr: " + h);
  const sel = L.selectNotams([ntm("C1/26", { e: POS("320130", "0344800"), b: "2610191600", c: "2610230200", f: "E2) x" })], L.inputWindow({ dateFrom: "2026-10-20", timeFrom: "00:00", timeTo: "23:00" }, NOW));
  const card = L.popupHtml({ zones: [], notams: sel.items }, {});
  assert.ok(card.includes('<span dir="ltr" style="white-space:nowrap">2026-10-19 16:00Z</span> – <span dir="ltr" style="white-space:nowrap">2026-10-23 02:00Z</span>'), "כל תאריך+שעה ב-ltr נפרד שאינו נשבר");
  assert.ok(card.includes('<span dir="ltr">0</span> – <span dir="ltr">5000</span> רגל (לפי שורת Q)'), card);
  assert.ok(tagsOf(card).every(t => TAG_OK.test(t)), "תגיות מהרשימה הלבנה בלבד");
  assert.equal(L.notamAlt(q("050")), "0 – 5000 רגל (לפי שורת Q)", "notamAlt נשאר מחרוזת טקסט");
});

test("ממצא 16: סדר הכרטיס לפי חומרה — א-17 אסור (LLP/LLU/LLD), א-17 מוגבל (LLR), רט״ג, ב-09; סדר הציור (zoneShapes) לא השתנה; הכותרת מפרטת אזורים/נוטמים", () => {
  const mk = (src, cat, id) => ({ src, id, cat, name: "n", label: id, kind: "k", alt: "", pmt: "", note: "", approx: false, footnote: false, rings: [] });
  const zs = [mk("b09", "B09", "B1"), mk("inpa", "NR", "P1"), mk("a17", "LLR", "R1"), mk("a17", "LLU", "U1"), mk("inpa", "NP", "P2"), mk("a17", "LLP", "L1"), mk("a17", "LLD", "D1"), mk("a17", "LLR", "R2")];
  const h = L.popupHtml({ zones: zs, notams: [] }, { maxZones: 20 }), pos = id => h.indexOf("<b>" + id + "</b>");
  const order = ["U1", "L1", "D1", "R1", "R2", "P1", "P2", "B1"];
  assert.deepEqual(zs.map(z => z.id).sort((a, b) => pos(a) - pos(b)), order, "אסור (בסדר הקלט) < מוגבל < רט״ג < ב-09");
  assert.deepEqual(zs.map(z => z.id), ["B1", "P1", "R1", "U1", "P2", "L1", "D1", "R2"], "המערך המקורי לא עבר מיון");
  const draw = L.zoneShapes(zones, inpa), first = src => draw.findIndex(s => s.src === src), last = src => draw.map(s => s.src).lastIndexOf(src);
  assert.ok(last("inpa") < first("b09") && last("b09") < first("a17"), "סדר הציור נשאר שמורות < ב-09 < א-17");
  const two = L.popupHtml({ zones: [mk("a17", "LLU", "U1")], notams: L.selectNotams([ntm("A/26", { e: POS("320000", "0344800") }), ntm("B/26", { e: POS("320000", "0344800") })], L.inputWindow(baseArgs(), NOW)).items }, {});
  assert.match(two, /3 פריטים \(אזור אחד · 2 נוטמים\)/); assert.ok(!/אזור אחד · /.test(L.popupHtml({ zones: [mk("a17", "LLU", "U1")], notams: [] }, {})), "רק אזורים — בלי פירוט");
});

test("ממצא 18: יחיד/רבים — ״ועוד נוטם אחד״ / ״ועוד אזור אחד״ בכרטיס ובפס; ״ועוד N נוטמים״ מ-2", () => {
  const mkz = i => ({ src: "a17", id: "Z" + i, cat: "LLP", name: "n", label: "Z" + i, kind: "k", alt: "", pmt: "", note: "", approx: false, footnote: false, rings: [] });
  const items = k => L.selectNotams(Array.from({ length: k }, (_, i) => ntm("T" + i + "/26", { e: POS("320000", "0344800") })), L.inputWindow(baseArgs(), NOW)).items;
  assert.match(L.popupHtml({ zones: [], notams: items(9) }, {}), /ועוד נוטם אחד</); assert.match(L.popupHtml({ zones: [], notams: items(10) }, {}), /ועוד 2 נוטמים</);
  assert.match(L.popupHtml({ zones: Array.from({ length: 9 }, (_, i) => mkz(i)), notams: [] }, {}), /ועוד אזור אחד</); assert.match(L.popupHtml({ zones: Array.from({ length: 11 }, (_, i) => mkz(i)), notams: [] }, {}), /ועוד 3 אזורים</);
  const nm = k => Array.from({ length: k }, (_, i) => ntm("M" + i + "/26", { e: "OPS WI 100M RADIUS CENTERED ON PSN 32" + String(i + 1).padStart(2, "0") + "00N0344800E CLSD" }));
  const th = { thresholds: Object.assign({}, TH, { notam_near_m: 40000 }) };
  assert.match(line(L.preview(baseArgs(Object.assign({ notams: nm(7) }, th))), "notams").text, /; ועוד נוטם אחד$/); assert.match(line(L.preview(baseArgs(Object.assign({ notams: nm(8) }, th))), "notams").text, /; ועוד 2 נוטמים$/);
  const zl = k => Array.from({ length: k }, (_, i) => zA17("Y" + i, "n" + i, rect(-300 - i, 300 + i, -300, 300)));
  assert.match(line(L.preview(baseArgs({ zones: mkZ(zl(5)) })), "inside").text, /; ועוד אזור אחד$/); assert.match(line(L.preview(baseArgs({ zones: mkZ(zl(6)) })), "inside").text, /; ועוד 2 אזורים$/);
});

test("ממצא 6/9/17: נ״צ שהוקלד ואינו חוקי — מצב bad-coord עם אזהרה במקום סיכום של הנקודה הקודמת, ושורה אחרונה נשמרת", () => {
  const r = L.preview(baseArgs({ coordInvalid: true, zones: mkZ([zA17("LLP9", "בדיקה", rect(-300, 300, -300, 300))]) }));
  assert.equal(r.state, "bad-coord"); assert.equal(r.lines[0].k, "hint"); assert.equal(r.lines[0].cls, "warn"); assert.match(r.lines[0].text, /הנ״צ שהוקלד אינו חוקי/);
  assert.ok(!line(r, "inside") && !line(r, "near") && !line(r, "notams"), "אין סיכום של הנקודה הקודמת"); assert.equal(r.lines[r.lines.length - 1].text, L.LAST_LINE);
  assert.equal(L.preview(baseArgs({ coordInvalid: false })).state, "ok");
});

test("מבנה (ממצאים 2/3/6/7/9/11/17 + תקלות א/ב): ui.js — כשל תצוגה אינו זורק, גרירה כותבת את שדה הנ״צ, ההקלדה לא מרנדרת את השער, וה-CSS כולל אזורים בטוחים", () => {
  const ui = fs.readFileSync(path.join(ROOT, "members-k38p/requests/js/ui.js"), "utf8"), html = fs.readFileSync(path.join(ROOT, "members-k38p/requests/index.html"), "utf8");
  assert.ok(/applyJobs[^\n]*then\(r => \{ try \{ layerDataChanged\(\); \} catch/.test(ui), "applyJobs: טעינת נתונים לעולם לא נדחית בגלל ציור");
  const ol = ui.slice(ui.indexOf("function onLayerData()"), ui.indexOf("function scheduleLayerUpdate")); assert.ok(/try \{ refreshLayers\(\); \} catch/.test(ol) && /try \{ updateSummary\(\); \} catch/.test(ol), "onLayerData: כל חלק ב-try/catch");
  assert.ok(/try \{ initLayerUi\(\); \} catch/.test(ui) && /try \{ initLayers\(m\); \} catch/.test(ui), "אתחול השכבות והמתגים לא עוצר את init");
  assert.ok(/function showHitsAt\(ll, moved\) \{ try \{ showHits\(ll, moved\); \} catch/.test(ui), "כרטיס הלחיצה לא זורק ל-click");
  assert.ok(/marker\.on\("dragend", \(\) => \{[^}]*setCenter\(p\.lat, p\.lng, false, true\)/.test(ui), "גרירה: שדה הנ״צ נכתב (fromInput=false) ובלי הזזת מפה (noMove)");
  assert.ok(/function setCenter[\s\S]{0,400}\n\s*closeCard\(\);/.test(ui), "שינוי נקודה סוגר את הכרטיס הישן ומבטל פתיחה ממתינה");
  assert.ok(/addEventListener\("change", \(\) => \{ const c = C\.parseCoordInput[^\n]*else scheduleLayerUpdate\(\)/.test(ui), "טקסט לא חוקי בשדה הנ״צ מעדכן את הפס");
  assert.ok(/refreshGate\(\{ quiet: true \}\)/.test(ui) && /if \(S\.report && !\(opts && opts\.quiet\)\) renderReport\(\)/.test(ui) && /box\._html !== html/.test(ui), "הקלדה: בלי רינדור דוח ובלי החלפת DOM זהה של השער");
  assert.ok(/--safe-top:env\(safe-area-inset-top,0px\)/.test(html) && /header\{padding:calc\(16px \+ var\(--safe-top\)\)/.test(html) && /header \.back\{[^}]*min-height:44px/.test(html), "ריווח עליון בטוח, קישור חזרה ≥ 44px");
  assert.ok(/id="puNew" maxlength="320"/.test(html) && /#puList\{max-height:/.test(html), "שדה הוספת מהות מוגבל ל-4×80, ורשימת הצ׳יפים גוללת");
  assert.ok(/viewport-fit=cover/.test(html), "viewport-fit=cover נשאר — ולכן הריווח הבטוח הכרחי");
});
