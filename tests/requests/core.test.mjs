// בדיקות יחידה לליבת החישוב ולהפקת הטופס — מול נתוני אמת שנשמרו (tests/fixtures) ומול ערכים שחושבו בנפרד (tests/expected.json).
// הרצה: node --test tests/requests/core.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import os from "node:os";
import crypto from "node:crypto";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const C = require(path.join(ROOT, "members-k38p/requests/js/core.js"));
const O = require(path.join(ROOT, "members-k38p/requests/js/output.js"));
const J = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const cfg = J("members-k38p/requests/config.json"), exp = J("members-k38p/requests/selftest/expected.json");
const zones = J("members-k38p/data/zones.json"), rules09 = J("members-k38p/data/pmt-b09-rules.json"), inpa = J("members-k38p/data/inpa-zones.json"), agri = J("members-k38p/data/agri-airstrips.json");
zones.rules09 = rules09;
const snap = J("members-k38p/requests/selftest/notam-data.snap.json");
const fixture = n => ({ near: J(`members-k38p/requests/selftest/${n}/near.json`), far: J(`members-k38p/requests/selftest/${n}/far.json`), ext: J(`members-k38p/requests/selftest/${n}/ext.json`), reverse: J(`members-k38p/requests/selftest/${n}/reverse.json`) });
const baseInput = Object.assign({}, exp.input, { purpose: cfg.purposes[0], aircraft: [cfg.aircraft[0]], vlos: true, siteName: "בדיקה", requesterName: "בודק", requesterPhone: "050-0000000", requesterOrg: "חברת הבדיקה בע״מ", contacts: [{ name: "א", phone: "050-0000001" }, { name: "ב", phone: "050-0000002" }] });
const mkData = fx => Object.assign({ zones, inpa, agri, notams: snap.notams, notamFetchedIso: snap.fetched_iso }, fx);
const now = new Date(exp.now);

/* מרחק גיאודזי עצמאי (ויסנטי) לבדיקת היטל */
function vincenty(lat1, lon1, lat2, lon2) {
  const a = 6378137.0, f = 1 / 298.257223563, b = (1 - f) * a, rad = Math.PI / 180;
  const L = (lon2 - lon1) * rad, U1 = Math.atan((1 - f) * Math.tan(lat1 * rad)), U2 = Math.atan((1 - f) * Math.tan(lat2 * rad));
  const sU1 = Math.sin(U1), cU1 = Math.cos(U1), sU2 = Math.sin(U2), cU2 = Math.cos(U2);
  let lam = L, ss, cs, sig, c2a, c2sm, sa;
  for (let i = 0; i < 200; i++) {
    const sl = Math.sin(lam), cl = Math.cos(lam);
    ss = Math.hypot(cU2 * sl, cU1 * sU2 - sU1 * cU2 * cl); cs = sU1 * sU2 + cU1 * cU2 * cl; sig = Math.atan2(ss, cs);
    sa = (cU1 * cU2 * sl) / ss; c2a = 1 - sa * sa; c2sm = c2a ? cs - (2 * sU1 * sU2) / c2a : 0;
    const Cc = (f / 16) * c2a * (4 + f * (4 - 3 * c2a)), lp = lam;
    lam = L + (1 - Cc) * f * sa * (sig + Cc * ss * (c2sm + Cc * cs * (-1 + 2 * c2sm * c2sm)));
    if (Math.abs(lam - lp) < 1e-12) break;
  }
  const u2 = (c2a * (a * a - b * b)) / (b * b), A = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2))), B = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  const ds = B * ss * (c2sm + (B / 4) * (cs * (-1 + 2 * c2sm * c2sm) - (B / 6) * c2sm * (-3 + 4 * ss * ss) * (-3 + 4 * c2sm * c2sm)));
  return b * A * (sig - ds);
}

test("המרות יחידות ו-DMS", () => {
  assert.equal(C.dmsLat(32.099128), exp.dmsLat); assert.equal(C.dmsLon(34.816617), exp.dmsLon);
  assert.equal(C.dms(32.9999999, "N", "S"), "33°00'00.00\"N", "עיגול שניות ל-60 עובר לדקה");
  assert.ok(Math.abs(80 * C.M2FT - 262.4672) < 1e-3);
  assert.ok(Math.abs(100 / C.NM - 0.054) < 1e-4, "100 מ׳ = 0.054 מייל ימי");
  assert.equal(C.fmtDist(526), "526 מ׳"); assert.equal(C.fmtDist(1500), "1.5 ק״מ");
});

test("היטל מקומי מסכים עם גיאודזיה על האליפסואיד (עד 0.3 מ׳ ב-1 ק״מ)", () => {
  const P = new C.Proj(32.099128, 34.816617);
  for (const [la, lo] of [[32.1058, 34.8025], [32.0995, 34.8210], [32.0950, 34.8100], [32.1100, 34.8300]]) {
    const [x, y] = P.xy(la, lo), d = Math.hypot(x, y), v = vincenty(32.099128, 34.816617, la, lo);
    assert.ok(Math.abs(d - v) <= Math.max(0.3, v * 0.0003), `d=${d} vincenty=${v}`);
  }
});

test("קלט נקודה: עשרוני, DMS, היפוך סדר, קישור גוגל", () => {
  const same = (a, la, lo) => a && Math.abs(a.lat - la) < 1e-4 && Math.abs(a.lon - lo) < 1e-4;
  assert.ok(same(C.parseCoordInput("32.099128, 34.816617"), 32.099128, 34.816617));
  assert.ok(same(C.parseCoordInput("34.816617 32.099128"), 32.099128, 34.816617));
  assert.ok(same(C.parseCoordInput("32°05'56.86\"N 34°48'59.82\"E"), 32.099128, 34.816617));
  assert.ok(same(C.parseCoordInput("https://www.google.com/maps/@32.099128,34.816617,17z"), 32.099128, 34.816617));
  assert.equal(C.parseCoordInput("שלום"), null);
});

test("הירקון: מכשולים לפי ערכי הייחוס שחושבו בנפרד", () => {
  const res = C.analyze(baseInput, mkData(fixture("yarkon")), cfg, now);
  assert.equal(res.nearScan.items.length, exp.items.length);
  exp.items.forEach(e => {
    const it = res.nearScan.items.find(i => i.title === e.title);
    assert.ok(it, "חסר: " + e.title);
    assert.ok(Math.abs(it.d - e.d) <= (e.tol || 1.5), `${e.title}: ${it.d} מול ${e.d}`);
    assert.equal(it.zone, e.zone, e.title);
  });
  assert.deepEqual(res.nearScan.items.map(i => i.n), exp.items.map((_, i) => i + 1));
});

test("הירקון: מצאי רחב — פריטים בטופס מול פריטים שבדף הבדיקות בלבד", () => {
  const res = C.analyze(baseInput, mkData(fixture("yarkon")), cfg, now);
  assert.equal(res.nearScan.censusOnly.length, exp.censusOnlyCount);
  assert.ok(res.nearScan.censusOnly.every(i => i.cat === "census" && i.zone === "near" && !i.n));
  assert.ok(res.nearScan.items.some(i => i.cat === "census" && i.zone === "ring"), "אתר המונים/תשתית בטבעת נכנס לטופס");
  const cov = O.buildCoverage(res, mkData(fixture("yarkon")), cfg);
  const total = cov.groups.reduce((a, g) => a + g.found, 0);
  assert.ok(total >= res.nearScan.all.length, "כל קבוצה נספרת");
  assert.ok(cov.groups.some(g => g.group === "אצטדיונים, מטווחים ואתרי המונים" && g.found > 20));
  assert.ok(cov.sources.some(r => /OpenStreetMap — סביבה/.test(r[0]) && /\d+ אלמנטים/.test(r[1])));
  assert.ok(cov.sources.length >= 7);
  const f8 = O.buildForm(res, cfg)[7].text;
  assert.ok(!/לונה פארק/.test(f8), "פריטי מצאי רחוקים לא בטופס");
  assert.ok(/מגלשת מים \(×\d+/.test(f8), "מגלשות המים בטבעת");
});

test("הירקון: LLU20 בקרבה, לא בתוך הסגירה, והמרחק נכון", () => {
  const res = C.analyze(baseInput, mkData(fixture("yarkon")), cfg, now);
  assert.equal(res.zones.inside.length, 0);
  const z = res.zones.near.find(x => x.id === "LLU20"); assert.ok(z);
  assert.ok(Math.abs(z.d - 525.9) <= 1.5, "d=" + z.d);
  assert.ok(Math.abs(z.edge - (z.d - 200)) < 1e-9);
  const c = vincenty(32.099128, 34.816617, 32.105833, 34.8025) - 1000; // מרכז האזור לפי הפמ״ת פחות רדיוס
  assert.ok(Math.abs(z.d - c) <= 1.5);
});

test("רדיוס גדול יותר מכניס את אותם פריטים לפי המרחק בלבד", () => {
  const big = C.analyze(Object.assign({}, baseInput, { radius: 120 }), mkData(fixture("yarkon")), cfg, now);
  assert.deepEqual(big.nearScan.inside.map(i => i.title), ["קו מתח עליון 161 ק״ו", "עמוד חשמל 1491"]);
  const small = C.analyze(Object.assign({}, baseInput, { radius: 100 }), mkData(fixture("yarkon")), cfg, now);
  assert.equal(small.nearScan.inside.length, 0, "ב-100 מ׳ הקו והעמוד בטבעת הכתומה");
  assert.ok(small.nearScan.ring.some(i => i.title.startsWith("קו מתח")));
});

test("הירקון: שקיעות, יום ולילה, שם מקום", () => {
  const res = C.analyze(baseInput, mkData(fixture("yarkon")), cfg, now);
  assert.deepEqual(res.sun.map(r => r.sunset), exp.sunset);
  res.sun.forEach(r => assert.equal(r.dayMin + r.nightMin, 180));
  assert.equal(res.siteSuggestion, exp.siteSuggestion);
});

test("שעון קיץ: מעבר ב-25.10.2026 (ישראל) מטופל נכון", () => {
  assert.equal(C.localToUtc(2026, 10, 24, 17, 0).toISOString(), "2026-10-24T14:00:00.000Z");
  assert.equal(C.localToUtc(2026, 10, 26, 17, 0).toISOString(), "2026-10-26T15:00:00.000Z");
  const t = C.dayNightTable(32.099128, 34.816617, "2026-10-24", "2026-10-26", "17:00", "20:00");
  assert.equal(t.length, 3); assert.deepEqual(t.map(r => r.start), ["17:00", "17:00", "17:00"]);
  assert.ok(t[2].dayMin === 0 && t[2].nightMin === 180, "ב-26.10 השקיעה לפני 17:00 (שעון חורף)");
});

test("חלון שחוצה חצות", () => {
  const t = C.dayNightTable(32.1, 34.8, "2026-10-20", "2026-10-20", "22:00", "02:00");
  assert.equal(t[0].dayMin, 0); assert.equal(t[0].nightMin, 240);
});

test("ימי עבודה", () => {
  assert.equal(C.workingDaysBefore("2026-10-16", "2026-10-20"), 2); // שישי -> שלישי: א׳, ב׳
  assert.equal(C.workingDaysBefore("2026-10-11", "2026-10-19"), 5); // ב׳–ה׳ + א׳
});

test("נקודה בתוך אזור א-17: חפיפה מזוהה", () => {
  const z = zones.zones.find(x => x.id === "LLP01"); // שמורת החולה
  const mid = z.rings[0].reduce((a, p) => [a[0] + p[0] / z.rings[0].length, a[1] + p[1] / z.rings[0].length], [0, 0]);
  const P = new C.Proj(mid[0], mid[1]);
  const r = C.analyzeZones(P, 100, { zones: zones.zones, inpa }, 1000);
  assert.ok(r.inside.some(x => x.id === "LLP01"), "LLP01 חייב להיות בתוך");
});

test("נקודה בתוך שמורת טבע של רט״ג: חפיפה מזוהה", () => {
  const s = inpa.sites.find(x => x.rings && x.rings[0].length > 6);
  const mid = s.rings[0].reduce((a, p) => [a[0] + p[0] / s.rings[0].length, a[1] + p[1] / s.rings[0].length], [0, 0]);
  const P = new C.Proj(mid[0], mid[1]);
  const r = C.analyzeZones(P, 50, { zones: [], inpa }, 1000);
  assert.ok(r.inside.length + r.near.length >= 1);
});

test("נוטמים: רק סגירות אוויריות עד 10 ק״מ ומכשולים שפורסמו; תדרים/GNSS/נתיבים/רשימות מוחרגים", () => {
  const P = new C.Proj(32.099128, 34.816617), w0 = Date.UTC(2026, 9, 20, 14), w1 = Date.UTC(2026, 9, 23, 17);
  const n = (id, q, e, extra) => ({ id, raw: `${id} NOTAMN\nQ) LLLL/${q}\nA) LLLL B) 2610010000 C) 2612312359\nE) ${e}`, heb: e, ...(extra || {}) });
  const list = [
    n("X1/26", "QKKKK/K /K /K /000/999/3200N03450E999", "CHECKLIST"),
    n("X2/26", "QANLT/I /NBO/E /050/600/3156N03501E027", "ATS RTE L53 CLSD BTN A-B. BTN 11,000-16,000FT"),
    n("X3/26", "QWULW/IV/BO /AW /000/005/3206N03449E002", "UAS ACT WI 2NM RADIUS CENTERED ON PSN 320606N0344900E"),
    n("X4/26", "QWULW/IV/BO /AW /000/005/3300N03600E002", "UAS ACT 2NM RADIUS CENTERED ON PSN 330000N0360000E"),
    n("X5/26", "QGWAU/IV/NBO/E /000/999/3125N03521E117", "POSS INTRP TO AIRBORNE GNSS EQPT"),
    n("X7/26", "QCAAS/IV/BO /E /000/999/3232N03453E060", "TEL AVIV CTL FLW FREQ TEMPO NOT AVBL"),
    n("X8/26", "QOBCE/IV/M  /AE /000/002/3206N03449E001", "CRANE ERECTED. AN AREA WI 0.1NM RADIUS CENTERED ON PSN 320606N0344900E. CTN ADZ"),
    n("X9/26", "QRPCA/IV/NBO/W /000/030/3206N03448E001", "AN AREA WI 0.5NM RADIUS CENTERED ON PSN 320600N0344800E CLSD FM GND UP TO 3000FT AMSL"),
    n("XA/26", "QMRLC/IV/NBO/A /000/999/3206N03449E005", "RWY 12/30 CLSD")
  ];
  list.push({ id: "X6/26", raw: "X6/26 NOTAMC X5/26\nQ) LLLL/QWULW/IV/NBO/E /000/999/3125N03521E117\nA) LLLL B) 2610010000 C) 2612312359\nE) CNL", heb: "" });
  const r = C.analyzeNotams(P, 200, list, w0, w1, 262.5, 10000, 1000);
  assert.deepEqual(r.hits.map(h => h.id).sort(), ["X3/26", "X9/26"], r.hits.map(h => h.id).join());
  assert.deepEqual(r.obstacles.map(h => h.id), ["X8/26"]);
  assert.deepEqual(r.excluded.map(e => e.id + ":" + e.reason).sort(), ["X1/26:checklist", "X2/26:route", "X4/26:far", "X5/26:gnss", "X6/26:cancel", "X7/26:comms", "XA/26:other"]);
  assert.equal(r.valid, 10);
  const x3 = r.hits.find(h => h.id === "X3/26"); assert.ok(x3.relation === "overlap" || x3.relation === "near");
});

test("סוג נוטם על הנתונים האמיתיים: סגירה / תדרים / GNSS / נתיב / רשימה / מכשול", () => {
  const kind = id => C.notamKind(snap.notams.find(n => n.id === id).raw);
  assert.equal(kind("C2137/26"), "closure");   // בלון מעוגן בחולה
  assert.equal(kind("C0431/26"), "closure");   // איסור כטב"ם ברדיוס 500 מ'
  assert.equal(kind("A0710/26"), "comms");
  assert.equal(kind("A0688/26"), "gnss");
  assert.equal(kind("A0764/26"), "route");
  assert.equal(kind("A0805/26"), "checklist");
  assert.equal(kind("A0785/26"), "obstacle");  // עגורן בנתב"ג
  assert.equal(kind("C1829/26"), "other");     // דרישת מקמ"ד — לא סגירה
});

test("הירקון: נוטמים — רק סגירה אווירית אחת בטווח 10 ק״מ, ללא תדרים", () => {
  const res = C.analyze(baseInput, mkData(fixture("yarkon")), cfg, now);
  assert.deepEqual(res.notams.hits.map(h => h.id), exp.notamHits);
  const chk = O.buildChecks(res, mkData(fixture("yarkon")), cfg).map(r => O.toText(r[2])).join("\n");
  assert.ok(/C0431\/26/.test(chk) && !/TEL AVIV CTL/.test(chk) && !/A0688/.test(chk) && !/A0710/.test(chk));
});

test("הוספה ידנית: מכשול שהוזן נכנס לטופס, לרשימה ולמפה", () => {
  const res = C.analyze(Object.assign({}, baseInput, { manualItems: [{ name: "עגורן בנייה", lat: 32.0995, lon: 34.8168, heightM: 60 }] }), mkData(fixture("yarkon")), cfg, now);
  const it = res.nearScan.items.find(i => i.manual);
  assert.ok(it && it.zone === "in" && it.d < 100 && it.height === 60);
  const f8 = O.buildForm(res, cfg)[7].text;
  assert.ok(/הוזן ידנית/.test(f8) && /עגורן בנייה/.test(f8), f8);
});

test("נוטם שפג תוקפו או טרם החל — לא נכלל", () => {
  const P = new C.Proj(32.1, 34.8);
  const nn = { id: "Y/26", raw: "Y/26 NOTAMN\nQ) LLLL/QGWAU/IV/NBO/E /000/999/3206N03448E100\nA) LLLL B) 2601010000 C) 2601312359\nE) X" };
  assert.equal(C.analyzeNotams(P, 200, [nn], Date.UTC(2026, 9, 20), Date.UTC(2026, 9, 21), 262).hits.length, 0);
});

test("אימות קלט", () => {
  const ok = C.validateInput(baseInput, cfg); assert.deepEqual(ok, []);
  const bad = C.validateInput(Object.assign({}, baseInput, { radius: 5, heightM: NaN, dateFrom: "", lat: NaN, aircraft: [], requesterName: "", requesterOrg: "" }), cfg).map(e => e.field);
  ["coord", "radius", "height", "dateFrom", "aircraft", "requester", "requesterOrg"].forEach(f => assert.ok(bad.includes(f), f));
  assert.ok(C.validateInput(Object.assign({}, baseInput, { dateTo: "2026-10-19" }), cfg).some(e => e.field === "dateTo"));
});

test("שער: כל בדיקה חייבת להצליח", () => {
  const st = {}; C.REQUIRED_CHECKS.forEach(([k]) => { st[k] = { ok: true }; });
  assert.equal(C.gate(st).ready, true);
  for (const [k] of C.REQUIRED_CHECKS) { const s2 = JSON.parse(JSON.stringify(st)); s2[k].ok = false; const g = C.gate(s2); assert.equal(g.ready, false, k); assert.equal(g.failing[0].key, k); }
  assert.equal(C.gate({}).ready, false, "בלי סטטוסים = לא מוכן");
});

test("הטופס: 17 שדות, ערכים קבועים, ואין 'טרם נבדק'", () => {
  const res = C.analyze(baseInput, mkData(fixture("yarkon")), cfg, now);
  const rows = O.buildForm(res, cfg); assert.equal(rows.length, 17);
  const t = rows.map(r => r.text).join("\n");
  assert.ok(!/טרם נבדק|לא נבדק|בדוק בעצמך/.test(t));
  // שדה 2 הוא מה שהמבקש הקליד (אין ברירת מחדל של הארגון); שדות 13 ו-14 ריקים => "לא רלוונטי" (בעבר הוצג ״ICD״ קבוע)
  assert.equal(rows[1].text, "חברת הבדיקה בע״מ"); assert.equal(rows[13].text, "לא רלוונטי"); assert.equal(rows[12].text, "לא רלוונטי");
  assert.ok(rows[15].text.includes("3 ק״מ ביום ו-5 ק״מ בלילה"));
  assert.ok(rows[8].text.startsWith("200 מטר") && rows[8].text.includes("0.108 מייל ימי"));
  assert.ok(rows[9].text.includes("262.5 רגל") && rows[9].text.includes("מעפ״ש (AGL)"));
  assert.ok(rows[7].text.includes(exp.dmsLat) && rows[7].text.includes(exp.dmsLon));
  assert.ok(rows[6].text.includes("20.10.2026") && rows[6].text.includes("23.10.2026") && rows[6].text.includes("17:00–20:00"));
});

test("הטופס: כשאין כלום בקרבת מקום — לא מוזכר (ניצנה)", () => {
  const input = Object.assign({}, baseInput, { lat: 30.887, lon: 34.424, radius: 100 });
  const res = C.analyze(input, mkData(fixture("nitzana")), cfg, now);
  const f8 = O.buildForm(res, cfg)[7].text;
  assert.ok(!/מכשולים/.test(f8) && !/עד 100 מ׳|עד 200 מ׳/.test(f8), f8);
  assert.ok(/LLP1162/.test(f8) && /LLU17/.test(f8), "אזורי האיסור הקרובים (גן ניצנה, LLU17) מוזכרים");
});

test("אתרי רט״ג ללא גבולות: התאמת שם מול OSM", () => {
  assert.equal(O.matchUnmapped([{ id: "L1", name: "נחל עינן" }], [{ name: "שמורת טבע נחל עינן", d: 100 }]).length, 1);
  assert.equal(O.matchUnmapped([{ id: "L2", name: "אום זוקא" }], [{ name: "שמורת טבע התנור", d: 100 }]).length, 0);
  assert.equal(O.matchUnmapped([{ id: "L3", name: "גן" }], [{ name: "גן", d: 1 }]).length, 0, "שם קצר מדי — לא מתאימים");
});

test("מייל ו-KML", () => {
  const res = C.analyze(baseInput, mkData(fixture("yarkon")), cfg, now);
  const m = O.mail(res, cfg);
  assert.deepEqual(m.to, ["notamoffice@iaa.gov.il", "nofm@iaa.gov.il"]);
  assert.ok(m.subject.includes("20.10.2026") && m.mailto.startsWith("mailto:notamoffice@iaa.gov.il,nofm@iaa.gov.il?subject="));
  const k = O.kml(res, mkData(fixture("yarkon")), cfg);
  assert.equal((k.match(/<Placemark>/g) || []).length, (k.match(/<\/Placemark>/g) || []).length);
  assert.ok(k.includes("LLU20") && k.includes("קו מתח עליון 161 ק״ו") && k.includes("<innerBoundaryIs>"));
  assert.ok(!k.includes("&lt;script"));
});

test("הזרקת HTML בשדות חופשיים מנוטרלת", () => {
  const res = C.analyze(Object.assign({}, baseInput, { siteName: "<img src=x onerror=alert(1)>", requesterName: "<b>x</b>", requesterOrg: "<u>ארגון</u>", callsign: "<i>c</i>", registration: "<s>r</s>" }), mkData(fixture("yarkon")), cfg, now);
  const rows = O.buildForm(res, cfg);
  assert.ok(!/<img|<b>x/.test(rows[5].html + rows[10].html));
  assert.ok(!/<[ubis]>/.test(rows[1].html + rows[12].html + rows[13].html), "שדות 2, 13, 14: בלי HTML גולמי");
});

test("הירקון: האצטדיון והבלון מופיעים בטופס ובדף הבדיקות", () => {
  const res = C.analyze(baseInput, mkData(fixture("yarkon")), cfg, now);
  const f8 = O.buildForm(res, cfg)[7].text;
  assert.ok(/אצטדיון ״אצטדיון רמת גן״ — 621 מ׳/.test(f8), f8);
  assert.ok(/״כדור פורח תל אביב״ — 581 מ׳/.test(f8), f8);
  assert.ok(/אתרים ותשתיות נוספים בקרבת האזור \(עד 1.2 ק״מ מהנקודה\)/.test(f8), f8);
  const chk = O.buildChecks(res, mkData(fixture("yarkon")), cfg).map(r => O.toText(r[2])).join("\n");
  assert.ok(/אצטדיון רמת גן/.test(chk) && /כדור פורח תל אביב/.test(chk));
  assert.ok(res.nearScan.near.every(i => i.zone === "near" && i.d > 2 * 200 && i.d <= 200 + cfg.thresholds.site_near_m));
  const k = O.kml(res, mkData(fixture("yarkon")), cfg);
  assert.ok(k.includes("כדור פורח תל אביב") && k.includes("אצטדיון רמת גן") && k.includes("#ground") && k.includes("#air"));
});

test("סיווג: בלון, מטווח, אצטדיון; מכשולים לא נכנסים מעבר ל-2R", () => {
  assert.equal(C.classify({ attraction: "balloon_ride" }), "air");
  assert.equal(C.classify({ tourism: "attraction", name: "Hot Air Balloon" }), "air");
  assert.equal(C.classify({ sport: "shooting" }), "ground");
  assert.equal(C.classify({ leisure: "stadium" }), "ground");
  assert.equal(C.classify({ power: "tower" }), "obst");
  const P = new C.Proj(32, 34.8), at = d => ({ lat: 32 + d / P.ky, lon: 34.8 });
  const near = { elements: [
    { type: "node", id: 1, ...at(500), tags: { power: "tower" } },                 // מכשול ב-500 (> 2R=400) — לא נכנס
    { type: "node", id: 2, ...at(700), tags: { leisure: "stadium", name: "א" } },   // אתר ב-700 (≤ R+1000) — נכנס
    { type: "node", id: 3, ...at(1300), tags: { leisure: "stadium", name: "ב" } }  // אתר ב-1300 (> R+1000) — לא נכנס
  ] };
  const r = C.analyzeNear(P, 200, near, cfg.thresholds);
  assert.deepEqual(r.items.map(i => i.ids[0]), ["node/2"]);
  assert.equal(r.items[0].zone, "near");
});

test("Overpass: שרת עם נתונים ישנים נפסל והבא אחריו נבחר", async () => {
  const old = new Date(Date.now() - 100 * 3600000).toISOString(), fresh = new Date(Date.now() - 3600000).toISOString();
  const mk = async (url) => ({ ok: true, status: 200, json: async () => ({ elements: [{ id: 1 }], osm3s: { timestamp_osm_base: url === C.MIRRORS[0] ? old : fresh } }) });
  const r = await C.overpass("q", { fetch: mk, wait: () => Promise.resolve(), staggerMs: 1, timeoutMs: 500, maxAgeH: 72, mirrors: [C.MIRRORS[0], C.MIRRORS[1]] });
  assert.equal(r.mirror, C.MIRRORS[1]);
  await assert.rejects(C.overpass("q", { fetch: async () => ({ ok: true, status: 200, json: async () => ({ elements: [], osm3s: { timestamp_osm_base: old } }) }), wait: () => Promise.resolve(), staggerMs: 1, timeoutMs: 500, maxAgeH: 72, mirrors: [C.MIRRORS[0]], rounds: 1 }), /נכשלו/);
});

test("שאילתות OSM: מכילות את כל הקטגוריות ומחזירות מיקום ליישובים (out body)", () => {
  const q = C.buildQueries(32.099128, 34.816617, 200, cfg);
  assert.ok(q.near.includes("out geom tags") && q.near.includes("man_made") && q.near.includes("[power") && q.near.includes("[aeroway]") && q.near.includes("[emergency=helipad]"));
  assert.ok(/node\[place\]\([\d.,-]+\);out body;/.test(q.far), "יישובים חייבים out body");
  assert.ok(/nwr\[aeroway~"\^\(aerodrome\|heliport\|helipad\)\$"\]\([\d.,-]+\);out center tags;/.test(q.far), "שדות תעופה בתיבה");
  assert.ok(q.ext.includes("nature_reserve") && q.ext.includes("admin_level"));
  assert.equal(C.buildQueries(32, 34.8, 1000, cfg).nearR, 2150, "רדיוס חיפוש גדל עם הסגירה");
  assert.equal(q.nearR, 1250, "חיפוש אתרים עד קילומטר מקצה הסגירה");
});

test("Overpass: מעבר לשרת הבא כשהראשון נכשל, ושגיאה כשכולם נכשלו", async () => {
  const mk = plan => async (url) => { const p = plan[url]; if (p === "boom") throw new Error("net"); if (p === 500) return { ok: false, status: 500 }; return { ok: true, status: 200, json: async () => ({ elements: [{ id: 1 }] }) }; };
  const wait = () => Promise.resolve();
  const r = await C.overpass("q", { fetch: mk({ [C.MIRRORS[0]]: "boom", [C.MIRRORS[1]]: 500, [C.MIRRORS[2]]: "ok", [C.MIRRORS[3]]: "ok" }), wait, staggerMs: 5, timeoutMs: 200 });
  assert.ok(r.mirror === C.MIRRORS[2] || r.mirror === C.MIRRORS[3]);
  const bad = {}; C.MIRRORS.forEach(m => { bad[m] = 500; });
  await assert.rejects(C.overpass("q", { fetch: mk(bad), wait, staggerMs: 5, timeoutMs: 200, rounds: 2 }), /כל שרתי Overpass נכשלו/);
});

test("גבולות מדינה: רצועת האיסור לפי מדינה (נתונים סינתטיים בגיאומטריה ידועה)", () => {
  const lat = 33.0, lon = 35.5, P = new C.Proj(lat, lon);
  const dLat = d => lat + d / P.ky; // מעלות צפונה במרחק d מטר
  const way = (id, d, tags) => ({ type: "way", id, tags: tags || { boundary: "administrative" }, geometry: [{ lat: dLat(d), lon: lon - 0.02 }, { lat: dLat(d), lon: lon + 0.02 }] });
  const rel = (id, iso, wids) => ({ type: "relation", id, tags: { boundary: "administrative", admin_level: "2", "ISO3166-1": iso }, members: wids.map(w => ({ type: "way", ref: w, role: "outer" })) });
  // 1: לבנון–ישראל ב-2.5 ק״מ; 2: סוריה–ישראל ב-5 ק״מ; 3: לבנון–סוריה (לא גבול ישראל) ב-1 ק״מ
  const ext = { elements: [way(1, 2500), way(2, 5000), way(3, 1000), rel(10, "LB", [1, 3]), rel(11, "IL", [1, 2]), rel(12, "SY", [2, 3])] };
  const b = C.analyzeBorders(P, ext, cfg, 100);
  const lb = b.find(x => x.iso === "LB"), sy = b.find(x => x.iso === "SY");
  assert.ok(lb && Math.abs(lb.d - 2500) < 1 && lb.violates, "לבנון 2.5 ק״מ < 3 ק״מ (ולא 1 ק״מ של גבול לבנון–סוריה)");
  assert.ok(sy && Math.abs(sy.d - 5000) < 1 && sy.violates, "סוריה 5 ק״מ < 6 ק״מ");
  assert.ok(!b.find(x => x.iso === "IL"), "ישראל אינה גבול מוגבל");
  const mk = d => ({ elements: [way(1, d), rel(10, "LB", [1]), rel(11, "IL", [1])] });
  assert.equal(C.analyzeBorders(P, mk(3200), cfg, 100)[0].violates, false, "3.2 ק״מ − רדיוס 100 = 3.1 ק״מ > 3 ק״מ");
  assert.equal(C.analyzeBorders(P, mk(3200), cfg, 300)[0].violates, true, "קצה סגירה 300 מ׳ נכנס לרצועה");
  assert.equal(C.analyzeBorders(P, { elements: [] }, cfg, 100).length, 0);
  const byName = C.analyzeBorders(P, { elements: [way(7, 2000, { boundary: "administrative", "name:en": "Egypt - Israel" })] }, cfg, 100);
  assert.equal(byName[0].iso, "EG", "גיבוי לפי שם הקטע כשאין שיוך ליחס");
});


test("גבולות מדינה על נתוני אמת (מטולה/ניצנה/גולן) מול מרחק גיאודזי עצמאי", () => {
  for (const b of exp.borders) {
    const ext = J(`members-k38p/requests/selftest/${b.fixture}/ext.json`), P = new C.Proj(b.lat, b.lon);
    const r = C.analyzeBorders(P, ext, cfg, b.R), x = r.find(y => y.iso === b.iso);
    assert.ok(x, b.fixture + ": לא זוהה גבול " + b.iso);
    assert.ok(Math.abs(x.d - b.d) <= b.tol, `${b.fixture}: ${x.d} מול ${b.d}`);
    assert.equal(x.violates, b.violates, b.fixture);
  }
  const y = C.analyzeBorders(new C.Proj(32.099128, 34.816617), J("members-k38p/requests/selftest/yarkon/ext.json"), cfg, 200);
  assert.equal(y.length, 0, "בירקון אין גבול בטווח");
});

test("שמורת טבע ואזורי א-17 על נתוני אמת (מטולה: התנור; החולה: חפיפה)", () => {
  const m = J("members-k38p/requests/selftest/metula/meta.json"), P = new C.Proj(m.lat, m.lon);
  const r = C.analyzeZones(P, m.R, { zones: zones.zones, inpa }, cfg.thresholds.near_zone_m);
  assert.ok([...r.inside, ...r.near].some(z => z.id === "LLP2219"), "התנור");
  const h = J("members-k38p/requests/selftest/hula/meta.json"), r2 = C.analyzeZones(new C.Proj(h.lat, h.lon), h.R, { zones: zones.zones, inpa }, 1000);
  assert.ok(r2.inside.some(z => z.id === "LLP01"), "שמורת החולה — חפיפה");
});

/* ---------- Word ---------- */
const D = require(path.join(ROOT, "members-k38p/requests/js/docx.js"));
const JSZipNode = require(path.join(ROOT, "members-k38p/requests/vendor/jszip.min.js"));
function wellFormed(xml) { // בדיקת איזון תגיות מינימלית
  const stack = [];
  for (const m of xml.matchAll(/<(\/?)([A-Za-z0-9:_.-]+)([^>]*?)(\/?)>/g)) {
    if (m[0].startsWith("<?") || m[0].startsWith("<!")) continue;
    if (m[4] === "/") continue;
    if (m[1] === "/") { if (stack.pop() !== m[2]) return false; } else stack.push(m[2]);
  }
  return stack.length === 0;
}
test("Word: קובץ docx תקין עם הטופס, תמונות, ודף בדיקות", async () => {
  const res = C.analyze(baseInput, mkData(fixture("yarkon")), cfg, now);
  const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");
  const img = { bytes: jpeg, w: 1280, h: 960 };
  const model = O.docxModel(res, mkData(fixture("yarkon")), cfg, { images: { aerial: img, street: img, overview: img, region: img }, includeChecks: true, review: "אושר", providerName: "בדיקה" });
  const bytes = await D.build(model);
  assert.equal(bytes[0], 0x50); assert.equal(bytes[1], 0x4b); // PK
  const z = await JSZipNode.loadAsync(bytes);
  for (const f of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/_rels/document.xml.rels", "word/styles.xml", "word/media/aerial.jpeg", "word/media/street.jpeg", "word/media/overview.jpeg", "word/media/region.jpeg"]) assert.ok(z.file(f), "חסר " + f);
  assert.ok(!z.file("word/media/map.jpeg"), "אין עוד תמונת map");
  const doc = await z.file("word/document.xml").async("string");
  for (const f of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/_rels/document.xml.rels", "word/styles.xml"]) assert.ok(wellFormed(await z.file(f).async("string")), "XML לא תקין: " + f);
  const plain = doc.replace(/<[^>]+>/g, "").replace(new RegExp("[" + String.fromCharCode(0x202a, 0x202c, 0x200f) + "]", "g"), "").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  assert.ok(plain.includes(exp.dmsLat) && plain.includes(exp.dmsLon), "קואורדינטות DMS");
  assert.ok(plain.includes("262.5") && plain.includes("חברת הבדיקה בע״מ") && !plain.includes("ICD") && plain.includes("אצטדיון רמת גן") && plain.includes("כדור פורח תל אביב") && plain.includes("LLU20"));
  assert.ok(plain.includes("אישור סקירה אנושית") && plain.includes("מצאי לפי קבוצות"));
  assert.ok(!plain.includes("דוח כיסוי"), "אין עוד טבלת דוח כיסוי — מה נסרק");
  assert.equal((doc.match(/<w:tbl>/g) || []).length, (doc.match(/<\/w:tbl>/g) || []).length);
  assert.equal((doc.match(/<w:drawing>/g) || []).length, 4);
  assert.ok(doc.includes("<w:bidi/>") && doc.includes("<w:bidiVisual/>"));
  const noChecks = await JSZipNode.loadAsync(await D.build(Object.assign({}, model, { includeChecks: false })));
  assert.ok(!(await noChecks.file("word/document.xml").async("string")).includes("הבדיקות שבוצעו"));
});

test("שם קובץ/תיקייה: מיקום + תאריך, בלי תווים אסורים", () => {
  const res = C.analyze(Object.assign({}, baseInput, { siteName: 'פארק/הירקון: "גבעה" <1>' }), mkData(fixture("yarkon")), cfg, now);
  const f = O.fileBase(res);
  assert.ok(f.startsWith("פארק הירקון גבעה 1") && f.includes("20.10.2026") && !/[\\/:*?"<>|]/.test(f), f);
});

/* ===== פרק ב-09: אזורי טיסה לכטב״ם ===== */
const z09 = id => zones.zones.find(z => z.cat.startsWith("B09") && z.id === id);
const centroid = z => { const r = z.rings[0].slice(0, -1); return [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length]; };

test("ב-09: 42 אזורים בנתונים — 30 בנספחים ב׳-1/ב׳-2 ו-12 אזורי בראשית — ולכולם ציטוט פמ״ת והפניה", () => {
  const all = zones.zones.filter(z => z.cat.startsWith("B09"));
  assert.equal(all.length, 42);
  assert.equal(all.filter(z => z.cat === "B09B").length, 12);
  for (const z of all) { assert.ok(z.pmt && z.pmtRef && z.appendix, z.id); assert.ok(z.minFt !== null && z.minFt >= 0, z.id); assert.ok(z.rings && z.rings[0].length >= 4, z.id); }
});

test("ב-09: נקודה בתוך אזור (כרמל מרכז) — בפנים, בלי חריגה, סיווג b09 ולא א-17", () => {
  const z = z09("כרמל מרכז"), c = centroid(z), P = new C.Proj(c[0], c[1]);
  const r = C.analyzeZones(P, 100, { zones: zones.zones, inpa: { sites: [] } }, 1000, 262.5);
  const hit = r.inside.find(x => x.id === "כרמל מרכז");
  assert.ok(hit && hit.src === "b09" && hit.d === 0, JSON.stringify(r.inside.map(x => x.id)));
  assert.match(hit.kind, /אזור טיסה לכטב״ם \(פרק ב-09, נספח ב'-1\)/);
  assert.equal(hit.label, "כרמל מרכז");
  assert.ok(!r.inside.concat(r.near).some(x => x.src === "a17" && x.id === "כרמל מרכז"));
});

test("ב-09: אזור שגובהו המזערי מעל הסגירה בכל קרקע נשלל (502א), ואזור עם 9,000 רגל נשאר עם הערת חפיפה אנכית", () => {
  const z502 = z09("502א"), P1 = new C.Proj(...centroid(z502));
  const r1 = C.analyzeZones(P1, 100, { zones: zones.zones, inpa: { sites: [] } }, 1000, 262.5);
  assert.ok(!r1.inside.concat(r1.near).some(x => x.id === "502א"));
  assert.ok(r1.excluded.some(x => x.id === "502א" && x.minFt === 11000));
  const z401 = z09("401 א"), P2 = new C.Proj(...centroid(z401));
  const r2 = C.analyzeZones(P2, 100, { zones: zones.zones, inpa: { sites: [] } }, 1000, 262.5);
  const h = r2.inside.find(x => x.id === "401 א"); assert.ok(h, "401 א חסר");
  assert.equal(h.needGroundFt, 8738);
  const c401 = centroid(z401), data = mkData(fixture("yarkon")), resF = C.analyze(Object.assign({}, baseInput, { lat: c401[0], lon: c401[1], heightM: 80 }), data, cfg, now);
  assert.match(O.airInfraLines(resF, data, cfg).join(" "), /אין חפיפה אנכית אלא אם גובה הקרקע באתר מעל 8,738 רגל/);
});

test("ב-09: מרחק לאזור קרוב נכון (בדיקה עצמאית מול ויסנטי) ומופיע כ'בקרבה' עד 1 ק״מ מקצה הסגירה", () => {
  const z = z09("כרמל מרכז"), ring = z.rings[0];
  const v = ring[0], P = new C.Proj(v[0] + 0.004, v[1]); // כ-445 מ׳ צפונה מקודקוד
  const r = C.analyzeZones(P, 100, { zones: zones.zones, inpa: { sites: [] } }, 1000, 262.5);
  const hits = r.inside.concat(r.near).filter(x => x.id === "כרמל מרכז");
  if (hits.length) {
    const h = hits[0], lat = P.ll(0, 0)[0], lon = P.ll(0, 0)[1];
    const dmin = Math.min(...ring.map(p => vincenty(lat, lon, p[0], p[1])));
    assert.ok(h.d <= dmin + 1, "d=" + h.d + " dmin=" + dmin);
    assert.ok(h.d <= 100 + 1000);
  }
});

test("ב-09: דף הבדיקות מציג תמיד שורת ב-09; בפנים — עם ציטוט הפמ״ת וסעיף 7(ג); בלי אזור — 'אין'", () => {
  const res0 = C.analyze(baseInput, mkData(fixture("yarkon")), cfg, now);
  const rows0 = O.buildChecks(res0, mkData(fixture("yarkon")), cfg);
  const row0 = rows0.find(r => /פרק ב-09/.test(r[0])); assert.ok(row0, "שורת ב-09 חסרה");
  assert.match(row0[2], /אין אזור טיסה לכטב״ם/);
  assert.match(row0[2], /נשללו לפי גובה/);       // 502א בירקון
  const z = z09("כרמל מרכז"), c = centroid(z);
  const fx = fixture("yarkon");
  const inp = Object.assign({}, baseInput, { lat: c[0], lon: c[1] });
  const data = mkData(fx); const res = C.analyze(inp, data, cfg, now);
  const row = O.buildChecks(res, data, cfg).find(r => /פרק ב-09/.test(r[0]));
  assert.match(row[2], /הסגירה בתוך אזור טיסה לכטב״ם/);
  assert.match(row[2], /כרמל מרכז/);
  assert.ok(z.pmtRef && row[1].startsWith(rules09.edition) && row[1].includes(z.pmtRef), "מקור: מהדורת ב-09 ואחריה ההפניה של האזור — " + row[1]);
  assert.ok(!row[2].includes(z.pmtRef) && !/לשון/.test(row[2]), "ההפניה והמילה 'לשון' לא בתוצאה");
  assert.match(O.toText(row[2]), new RegExp("״[^״]*" + z.pmt.slice(0, 12).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "ציטוט האזור (z.pmt) בתוך ״…״");
  const rowsAll = O.buildChecks(res, data, cfg);
  const intro = rowsAll.find(r => r[0] === "אזורי טיסה לכטב״ם — הגדרה כללית");
  assert.ok(intro, "הגדרה כללית כשיש אזור ב-09"); assert.equal(intro[1], zones.general.B09.intro.ref); assert.equal(O.toText(intro[2]), "״" + zones.general.B09.intro.text + "״");
  assert.ok(!O.buildChecks(res0, mkData(fixture("yarkon")), cfg).some(r => r[0] === "אזורי טיסה לכטב״ם — הגדרה כללית"), "בלי אזור — אין שורת הגדרה");
  const rule7c = rowsAll.find(r => r[0] === "מרחק מגבול אזור הפעילות שאושר");
  assert.match(O.toText(rule7c[2]), /מרחק שלא יפחת מ-500 מטר מגבול אזור הפעילות/);
});

test("ב-09: כיסוי — שורה נפרדת עם 42 אזורים; מגבלות המקורות מזכירות את אזורי הקירוב; הגשה מצטטת 7(ח)", () => {
  const data = mkData(fixture("yarkon")), res = C.analyze(baseInput, data, cfg, now);
  const cov = O.buildCoverage(res, data, cfg);
  const row = cov.sources.find(r => /פרק ב-09/.test(r[0]));
  assert.match(row[1], /^42 אזורים נבדקו \(מתוכם 5 משורטטים בקירוב\)/);
  const a17row = cov.sources.find(r => /א-17/.test(r[0])); assert.match(a17row[1], /^163 אזורים נבדקו/);
  assert.ok(O.sourceNotes(res, data, cfg).some(n => /אשכול/.test(n) && /אינם הגבול הרשמי/.test(n)));
  assert.match(O.submissionHtml(res, cfg, data), /5 ימי עבודה מראש/);
});

test("ב-09: KML — אזור כטב״ם בסגנון כחול ולא אדום", () => {
  const z = z09("כרמל מרכז"), c = centroid(z);
  const data = mkData(fixture("yarkon")), res = C.analyze(Object.assign({}, baseInput, { lat: c[0], lon: c[1] }), data, cfg, now);
  const kml = O.kml(res, { zones }, cfg);
  assert.match(kml, /<Style id="blue">/);
  assert.match(kml, /כרמל מרכז[^<]*<\/name><styleUrl>#blue<\/styleUrl>/);
});

test("ב-09: חוקי סעיפים 3(ג) ו-7 נטענו מהקובץ המאומת עם הפניה לעמוד ועדכון", () => {
  assert.deepEqual(rules09.rules.map(r => r.id), ["2ד", "3ג", "4א", "5ד", "5ה1", "6ד", "7ב", "7ג", "7ד", "7ה", "7ח", "A11-3ג", "A17-5"]);
  for (const r of rules09.rules) assert.match(r.ref, /עמ' \d+(–\d+)?, עדכון 1\/2[3-6]/);
  const r7c = rules09.rules.find(r => r.id === "7ג");
  assert.match(r7c.text, /500 מטר/); assert.match(r7c.text, /רדיוס הסגירה/);
  assert.match(rules09.rules.find(r => r.id === "3ג").text, /סגירה ייעודית מחייבת שמירת קשר עין/);
});

/* ===== תיקוני סקירה: ליבה ונתונים ===== */
test("LLR בקירוב: אין 'undefined' בשום פלט (שדה 8, דף בדיקות, KML) — מוצג לשון הפמ״ת", () => {
  const z = zones.zones.find(x => x.id === "LLR24"), c = centroid(z);
  const data = mkData(fixture("yarkon")), res = C.analyze(Object.assign({}, baseInput, { lat: c[0], lon: c[1] }), data, cfg, now);
  const hit = res.zones.inside.concat(res.zones.near).find(x => x.id === "LLR24"); assert.ok(hit);
  assert.equal(hit.alt, "");
  const txt = O.airInfraLines(res, data, cfg).join(" ") + JSON.stringify(O.buildChecks(res, data, cfg)) + O.kml(res, { zones }, cfg);
  assert.ok(!/undefined|NaN/.test(txt), "נמצא undefined/NaN");
  assert.match(O.airInfraLines(res, data, cfg).join(" "), /LLR24.*לפי הפמ״ת: .*בכל גובה.*שרטוט בקירוב/);
});

test("נוטם מצולע (BTN FLW PSN): נקודה בתוך האזור הסגור היא 'חפיפה' (מרחק 0), גם כשהמצולע לא חוזר לנקודת ההתחלה וגדול מ-10 ק״מ", () => {
  const raw = "C9999/26 NOTAMN\nQ) LLLL/QRDCA/IV/BO /W /000/050/3207N03452E020\nA) LLLL B) 2610170000 C) 2610232359\nE) CLSD AN AREA BTN FLW PSN 322500N0344000E 322500N0350500E 320500N0350500E 320500N0344000E.\nF) GND G) 5000FT AMSL";
  const from = Date.UTC(2026, 9, 20), to = Date.UTC(2026, 9, 21);
  const inside = new C.Proj(32.25, 34.8333);     // מרכז המצולע: ~11 ק״מ מכל צלע
  const r = C.analyzeNotams(inside, 100, [{ id: "C9999/26", raw, heb: "x", name: "x" }], from, to, 262.5, 10000, 1000);
  assert.equal(r.hits.length, 1, JSON.stringify(r.excluded));
  assert.equal(r.hits[0].relation, "overlap"); assert.equal(r.hits[0].d, 0);
  const near = new C.Proj(32.25, 35.1);          // ~1.57 ק״מ מזרחה לצלע המזרחית (קו אורך 35°05'00")
  const r2 = C.analyzeNotams(near, 100, [{ id: "C9999/26", raw, heb: "x", name: "x" }], from, to, 262.5, 10000, 1000);
  assert.equal(r2.hits.length, 1); assert.equal(r2.hits[0].relation, "near");
  assert.ok(Math.abs(r2.hits[0].d - vincenty(32.25, 35.1, 32.25, 35 + 5 / 60)) < 25, "d=" + r2.hits[0].d);
  const far = new C.Proj(32.25, 35.4);           // ~38 ק״מ — רחוק
  assert.equal(C.analyzeNotams(far, 100, [{ id: "C9999/26", raw, heb: "x", name: "x" }], from, to, 262.5, 10000, 1000).hits.length, 0);
});

test("polyNearest: טבעת פתוחה נסגרת אוטומטית — נקודה בפנים = 0, וגם הקטע החותם נבדק", () => {
  const sq = [[-100, -100], [100, -100], [100, 100], [-100, 100]];   // הראשית בפנים; בלי נקודת סגירה
  assert.equal(C.polyNearest(sq, true).d, 0);
  const off = sq.map(p => [p[0] + 1000, p[1]]);                       // הראשית מחוץ, ליד הקטע החותם (x=900..1100 ← הקטע השמאלי x=900)
  assert.ok(Math.abs(C.polyNearest(off, true).d - 900) < 1e-9);
  assert.ok(Math.abs(C.polyNearest(off.concat([off[0]]), true).d - 900) < 1e-9);
});

test("סריקת גבול: הרדיוס גדל עם הסגירה (R+7 ק״מ), ושאילתת OSM מכסה אותו", () => {
  const q1 = C.buildQueries(33.0, 35.5, 100, cfg), q2 = C.buildQueries(33.0, 35.5, 5000, cfg);
  const around = q => +/rel\(around:(\d+)/.exec(q.ext)[1];
  const s1 = around(q1), s2 = around(q2);
  assert.equal(s1, 7100); assert.equal(s2, 12000);
  assert.ok(s2 >= 5000 + 6000 + 1000);   // רצועת סוריה 6 ק״מ + רדיוס הסגירה + שולי ביטחון
});

/* ===== תיקוני סקירה: אנשי קשר, קשר עין, הערת שוליים, ניסוחים ===== */
test("נספח ג׳ שדה 12: נדרשים שני אנשי קשר; שם אחד נדחה, שני שמות בכל מפריד מתקבלים, וחייב להיות לפחות טלפון אחד", () => {
  const v = o => C.validateInput(Object.assign({}, baseInput, o), cfg).filter(e => e.field === "contacts");
  const c2 = (a, b) => [{ name: a[0], phone: a[1] }, { name: b[0], phone: b[1] }];
  assert.equal(v({}).length, 0);
  assert.equal(v({ contacts: [{ name: "אחד בלבד", phone: "050-0000001" }] }).length, 1);
  assert.equal(v({ contacts: [{ name: "אחד", phone: "050-0000001" }, { name: "  ", phone: "" }] }).length, 1);
  assert.equal(v({ contacts: [] }).length, 1);
  assert.equal(v({ contacts: undefined }).length, 1);
  assert.equal(v({ contacts: c2(["דנה כהן", "050-0000001"], ["יוסי לוי", ""]) }).length, 0, "טלפון חסר לאחד מהם הוא אזהרה בלבד");
  assert.equal(v({ contacts: c2(["דנה כהן", ""], ["יוסי לוי", ""]) }).length, 1, "אין אף טלפון");
  assert.equal(v({ contacts: c2(["דנה כהן", "12345"], ["יוסי לוי", "050-0000001"]) }).length, 1, "טלפון שהוזן חייב להיות תקין");
  assert.equal(v({ contacts: [{ name: "דנה", phone: "050-0000001" }, { name: "יוסי", phone: "050-0000002" }, { name: "", phone: "050-0000003" }] }).length, 1, "טלפון בלי שם");
  assert.equal(v({ contacts: Array.from({ length: 21 }, (_, i) => ({ name: "איש" + i, phone: "050-000000" + (i % 10) })) }).length, 1, "יותר מ-20");
  assert.equal(C.validPhone("050-000 0001"), true); assert.equal(C.validPhone("123"), false);
  // משתתפים נוספים: אופציונלי; שורה ריקה מתעלמים, שורה חלקית נדחית
  const pv = o => C.validateInput(Object.assign({}, baseInput, o), cfg).filter(e => e.field === "participants");
  assert.equal(pv({}).length, 0); assert.equal(pv({ participants: [] }).length, 0);
  assert.equal(pv({ participants: [{ first: "", last: "", phone: "" }] }).length, 0);
  assert.equal(pv({ participants: [{ first: "נועה", last: "אברהם", phone: "050-9998877" }, { first: "אלון", last: "שמעוני", phone: "053-4445566" }, { first: "גל", last: "בר", phone: "052-1112222" }] }).length, 0, "שלושה ומעלה");
  assert.equal(pv({ participants: [{ first: "נועה", last: "", phone: "050-9998877" }] }).length, 1);
  assert.equal(pv({ participants: [{ first: "נועה", last: "אברהם", phone: "" }] }).length, 1);
  assert.equal(pv({ participants: [{ first: "נועה", last: "אברהם", phone: "12" }] }).length, 1);
  assert.equal(pv({ participants: Array.from({ length: 21 }, () => ({ first: "א", last: "ב", phone: "050-0000001" })) }).length, 1);
  // n=16: ההודעה בלי מספר שורה — הממשק מסנן שורות ריקות לפני האימות, ולכן אינדקס כאן אינו מיקום השורה על המסך (הסימון האדום מראה איזו שורה)
  const PART_MSG = "יש משתתף עם פרטים חלקיים: יש להשלים שם פרטי, שם משפחה וטלפון תקין — או למחוק את השורה", okP = { first: "נועה", last: "אברהם", phone: "050-9998877" };
  assert.deepEqual(pv({ participants: [{ first: "דנה", last: "", phone: "" }] }).map(e => e.msg), [PART_MSG]);
  assert.deepEqual(pv({ participants: [okP, okP, { first: "דנה", last: "", phone: "" }] }).map(e => e.msg), [PART_MSG], "משתתף חלקי אחרי שורות תקינות — אותה הודעה");
  assert.deepEqual(pv({ participants: [{ first: "", last: "", phone: "" }, { first: "דנה", last: "", phone: "" }] }).map(e => e.msg), [PART_MSG], "שורה ריקה לפניו — אותה הודעה, בלי מספר שגוי");
  assert.ok(!/משתתף \d|\d/.test(PART_MSG), "בלי מספר");
  assert.equal(C.validateInput(Object.assign({}, baseInput, { knownObstacles: "x".repeat(1001) }), cfg).filter(e => e.field === "knownObstacles").length, 1);
  assert.equal(C.validateInput(Object.assign({}, baseInput, { visitNotes: "x".repeat(3001) }), cfg).filter(e => e.field === "visitNotes").length, 1);
  assert.equal(C.validateInput(Object.assign({}, baseInput, { visitDate: "לא תאריך" }), cfg).filter(e => e.field === "visitNotes").length, 1);
  assert.equal(C.validateInput(Object.assign({}, baseInput, { visitDate: "2026-10-15", visitNotes: "ביקרתי" }), cfg).length, 0);
  assert.deepEqual(C.splitList("א; ב ,ג\nד"), ["א", "ב", "ג", "ד"]);
});

test("קשר עין (ב-09 3(ג)): בקשה 'ללא קשר עין' מציגה בדף הבדיקות את ציטוט הפמ״ת (ההפניה בעמודת המקור); עם קשר עין — שורה קצרה", () => {
  const data = mkData(fixture("yarkon"));
  const no = C.analyze(Object.assign({}, baseInput, { vlos: false }), data, cfg, now), yes = C.analyze(baseInput, data, cfg, now);
  const row = res => O.buildChecks(res, data, cfg).find(r => /קשר עין בסגירה ייעודית/.test(r[0]));
  assert.ok(row(no) && row(yes));
  const t = O.toText(row(no)[2]);
  assert.match(t, /ללא קשר עין/); assert.match(t, /״[^״]*סגירה ייעודית מחייבת שמירת קשר עין בין המטיס לכטב.ם[^״]*״/); assert.match(t, /אינה יכולה לוודא/); assert.ok(!/תקינה רק אם|יש לצרף את האישור/.test(t), "אין טענות שאינן בפמ״ת");
  assert.match(row(no)[1], /עמ' 2, עדכון 1\/25/, "ההפניה בעמודת המקור"); assert.ok(!/עמ' 2, עדכון|לשון/.test(t), "ההפניה לא בתוצאה");
  assert.deepEqual(row(no)[2].split("<br>").map(l => l.slice(0, 3)), ["1. ", "2. ", "3. "], "שלוש שורות ממוספרות: ההצהרה, הציטוט וההסתייגות");
  assert.match(O.toText(row(yes)[2]), /קיים קשר עין/); assert.ok(!/אינה יכולה לוודא/.test(O.toText(row(yes)[2])));
});

test("הערת שוליים ¹ של נספח ב׳-1 מצוטטת במלואה כשמוצג אזור 'גובה מרבי¹' — בשדה 8 ובדף הבדיקות — ולא מופיעה כשאין אזור כזה", () => {
  const z = zones.zones.find(x => x.cat === "B09" && /¹/.test(x.pmt || "")), c = centroid(z);
  const data = mkData(fixture("yarkon")), res = C.analyze(Object.assign({}, baseInput, { lat: c[0], lon: c[1] }), data, cfg, now);
  assert.ok(res.b09Footnote, "הערת השוליים לא נטענה");
  const f8 = O.buildForm(res, cfg).find(r => r.n === 8).text, ck = O.toText(JSON.stringify(O.buildChecks(res, data, cfg)));
  for (const t of [f8, ck]) { assert.match(t, /1500 רגל אנכית מכלי טיס אזרחי מאויש/); assert.match(t, /1000 רגל הפרדה מכלי טיס צבאי מאויש/); }
  const none = C.analyze(baseInput, data, cfg, now);   // פי גלילות: אין אזור ב-09 בקרבה
  assert.equal(none.b09Footnote, null);
  assert.ok(!/1500 רגל אנכית/.test(O.buildForm(none, cfg).find(r => r.n === 8).text));
});

test("נוסח המייל: ארבע התמונות (בלי תצ״א נקי); שמות הקבצים נשארים מתחת לתקרת השרת גם לשם ארוך", () => {
  const res = C.analyze(baseInput, mkData(fixture("yarkon")), cfg, now), m = O.mail(res, cfg);
  assert.match(m.body, /מצורפים: טופס הבקשה \(נספח ג׳, קובץ Word\), ארבע תמונות — תצ״א בתקריב, מפת רחובות בתקריב, הדמיה וסימונים במבט כללי ומפת אזור מרוחקת עם סימון המיקום \(המפה\/התצ״א הנדרשים בנספח ג׳\), וקובץ KML\./);
  assert.ok(!/תצ״א נקי|תצ״א עם סימון|הדמיות עם סימון/.test(m.body));
  const long = C.analyze(Object.assign({}, baseInput, { siteName: "מקום ארוך מאוד ".repeat(20) }), mkData(fixture("yarkon")), cfg, now), base = O.fileBase(long);
  for (const tail of [" — בקשה לסגירה אווירית.docx", " — תצ״א תקריב.png", " — מפת רחובות תקריב.png", " — הדמיה מבט כללי.png", " — מפת אזור.png", " — נתוני הבקשה.json"]) assert.ok((base + tail).length <= 110, tail + " " + (base + tail).length);
});

test("ימי עבודה: הניסוח אינו טוען שחגים נוכו; אזהרת המערכת מציינת זאת", () => {
  const res = C.analyze(Object.assign({}, baseInput, { dateFrom: "2026-10-20", dateTo: "2026-10-20" }), mkData(fixture("yarkon")), cfg, new Date("2026-10-19T08:00:00Z"));
  const t = O.toText(O.submissionHtml(res, cfg, { zones }));
  assert.ok(!/בלי חגים/.test(t)); assert.match(t, /אינה מנכה חגים/);
});

test("כללי ב-09 מוצגים בדף הבדיקות כל כלל בשורה נפרדת: ההפניה בעמודת המקור, הציטוט כלשונו בתוצאה, בלי לחשב עבור המבקש", () => {
  const data = mkData(fixture("yarkon")), res = C.analyze(baseInput, data, cfg, now), rows = O.buildChecks(res, data, cfg);
  const RULES = [["4א", "הפעלה במרחב מבוקר אזרחית"], ["5ה1", "הפרדות מופחתות לכטב״ם בקשר עין"], ["6ד", "תכנית טיסה ואישור יחידת הנת״א בסגירה מאושרת"], ["7ב", "הודעה ליחידת הנת״א"], ["7ג", "מרחק מגבול אזור הפעילות שאושר"], ["7ד", "הפעלה באזור פיקוח שדה תעופה או בתחום אווירי של מנחת"], ["7ה", "הפעלה בקשר עין ללא סגירה אווירית"], ["7ח", "הפעלה שמחייבת בקשת סגירה אווירית"]];
  const at = RULES.map(([, title]) => rows.findIndex(r => r[0] === title));
  assert.ok(at.every(i => i >= 0), "כל כלל בשורה משלו: " + at.join());
  assert.deepEqual(at, at.slice().sort((x, y) => x - y), "הסדר: 4א, 5ה1, 6ד, 7ב, 7ג, 7ד, 7ה, 7ח");
  RULES.forEach(([id], k) => {
    const rule = rules09.rules.find(r => r.id === id), row = rows[at[k]];
    assert.equal(row[1], rule.ref, id + ": ההפניה בעמודת המקור"); assert.ok(!row[2].includes(rule.ref), id + ": ההפניה לא בתוצאה");
    assert.equal(O.toText(row[2]), "״" + rule.text + "״", id + ": הציטוט כלשונו, בתוך ״…״");
  });
  assert.match(O.toText(rows[at[1]][2]), /במרחק אנכי שלא יפחת מ-200 רגל מתקרת הסגירה שאושרה ובמרחק אופקי שלא יפחת מ-250 מטר מרדיוס הסגירה שאושרה/);   // 5(ה)(1)(ד), מילולי
  const resp = rows[at[7] + 1]; assert.equal(resp[0], "אחריות המבקש לגבי כללי פרק ב-09"); assert.equal(resp[1], "—"); assert.match(resp[2], /אינה מחשבת עבור המבקש/);
  assert.ok(!rows.some(r => /כללי פרק ב-09 החלים/.test(r[0])), "אין עוד שורה אחת מרוכזת");
  // 2(ד) ו-5(ד) נמחקו לגמרי מהדף — גם כשנבחרו כמה כלי טיס
  const multi = C.analyze(Object.assign({}, baseInput, { aircraft: cfg.aircraft.slice(0, 2) }), data, cfg, now);
  const all = r => r.map(x => x[0] + " " + x[1] + " " + O.toText(x[2])).join("\n");
  for (const t of [all(rows), all(O.buildChecks(multi, data, cfg))]) { assert.ok(!/סעיף 2\(ד\)|סעיף 5\(ד\)/.test(t)); assert.ok(!/יותר מכטב.ם אחד בעת ובעונה אחת/.test(t)); assert.ok(!/איסור פעילות שני כלי טיס/.test(t)); }
});

test("חפיפה/קרבה לאזור א-17: שתי שורות הפנייה לבקשת חריגה (א-11 3(ג), א-17 סעיף 5) — ההפניה בעמודת המקור והציטוט בתוצאה; בלי אזור כזה — לא", () => {
  const z = zones.zones.find(x => x.id === "LLR24"), c = centroid(z), data = mkData(fixture("yarkon"));
  const hit = C.analyze(Object.assign({}, baseInput, { lat: c[0], lon: c[1] }), data, cfg, now);
  const rows = O.buildChecks(hit, data, cfg).filter(r => /בקשת חריגה מאזור אסור/.test(r[0]));
  assert.equal(rows.length, 2); assert.match(rows[0][0], /הנחיית א-11/); assert.match(rows[1][0], /הנחיית א-17/);
  assert.equal(rows[0][1], rules09.rules.find(r => r.id === "A11-3ג").ref); assert.equal(rows[1][1], rules09.rules.find(r => r.id === "A17-5").ref);
  const t11 = O.toText(rows[0][2]), t17 = O.toText(rows[1][2]);
  assert.equal(t11, "״" + rules09.rules.find(r => r.id === "A11-3ג").text + "״", "הציטוט בלבד");
  assert.match(t11, /caai-charigot@mot\.gov\.il/); assert.match(t11, /ANS 4\.7\.004/); assert.match(t17, /לא נדרש גם אישור רת"א/);
  assert.match(t17, /\n2\. המערכת אינה קובעת אם נדרשת חריגה — ההחלטה והפנייה לרת״א הן של המבקש\.$/, "ההסתייגות בשורה נפרדת אחרי הציטוט");
  assert.ok(!/אינה קובעת/.test(t11));
  const none = C.analyze(Object.assign({}, baseInput, { lat: 31.55, lon: 34.95 }), data, cfg, now);   // אין אזור א-17 בקרבה
  assert.equal(none.zones.inside.concat(none.zones.near).filter(x => x.src === "a17").length, 0);
  assert.ok(!O.buildChecks(none, data, cfg).some(r => /בקשת חריגה מאזור אסור/.test(r[0])));
});

/* ===== חלון תוקף, שלילה לפי גובה ורחוק — כללי הסינון של הנוטמים ===== */
const polyNotam = (id, lower, upper, b, c) => ({ id, heb: "x", name: "x", raw: `${id} NOTAMN\nQ) LLLL/QRDCA/IV/BO /W /${lower}/${upper}/3207N03452E020\nA) LLLL B) ${b} C) ${c}\nE) CLSD AN AREA BTN FLW PSN 322500N0344000E 322500N0350500E 320500N0350500E 320500N0344000E.\nF) GND G) 5000FT AMSL` });
const at = new C.Proj(32.25, 34.8333);   // בתוך המצולע
const win = [Date.UTC(2026, 9, 20), Date.UTC(2026, 9, 21)];
const run = n => C.analyzeNotams(at, 100, [n], win[0], win[1], 262.5, 10000, 1000);

test("נוטמים: חלון תוקף — נוטם שפג לפני הפעילות או מתחיל אחריה לא נספר בכלל; חפיפה חלקית נספרת", () => {
  assert.equal(run(polyNotam("C1/26", "000", "050", "2610170000", "2610191200")).valid, 0, "פג לפני תחילת הפעילות");
  assert.equal(run(polyNotam("C2/26", "000", "050", "2610211200", "2610250000")).valid, 0, "מתחיל אחרי סוף הפעילות");
  assert.equal(run(polyNotam("C3/26", "000", "050", "2610200000", "2610232359")).hits.length, 1, "חופף לחלון");
  assert.equal(run(polyNotam("C4/26", "000", "050", "2610150000", "2610200100")).hits.length, 1, "נגמר זמן קצר אחרי תחילת הפעילות");
  assert.deepEqual(run({ id: "C5/26", raw: "C5/26 NOTAMN\nE) CLSD" }).skipped, ["C5/26"], "בלי חלון תוקף — מדווח כמדולג, לא נבלע");
});

test("נוטמים: שלילה לפי גובה — רצפה מעל הגובה המבוקש + 9,500 רגל נשללת; סף מדויק (9,762.5 רגל לגובה 262.5)", () => {
  const r = fl => run(polyNotam("C6/26", fl, "400", "2610200000", "2610232359"));
  assert.equal(r("097").hits.length, 1, "FL097 = 9,700 רגל < 9,762.5 — נשאר");
  const above = r("098");                                  // 9,800 רגל > 9,762.5
  assert.equal(above.hits.length, 0); assert.equal(above.excluded[0].reason, "above"); assert.equal(above.excluded[0].lowerFt, 9800);
  // הסף עולה עם הגובה המבוקש: אותו נוטם (FL098) נשאר כשהסגירה גבוהה ב-100 רגל
  const higher = C.analyzeNotams(at, 100, [polyNotam("C6/26", "098", "400", "2610200000", "2610232359")], win[0], win[1], 362.5, 10000, 1000);
  assert.equal(higher.hits.length, 1);
});

test("נוטמים: סגירה רחוקה (מעבר ל-10 ק״מ מהקצה) נשללת כ'far', ונוטם בלי גיאומטריה נשמר לבדיקה ידנית", () => {
  const far = C.analyzeNotams(new C.Proj(32.25, 35.4), 100, [polyNotam("C7/26", "000", "050", "2610200000", "2610232359")], win[0], win[1], 262.5, 10000, 1000);
  assert.equal(far.hits.length, 0); assert.equal(far.excluded[0].reason, "far");
  const nogeo = C.analyzeNotams(at, 100, [{ id: "C8/26", heb: "x", name: "x", raw: "C8/26 NOTAMN\nQ) LLLL/QRDCA/IV/BO /W /000/050/\nA) LLLL B) 2610200000 C) 2610232359\nE) AIRSPACE CLOSED TO UAS\nF) GND G) 1000FT AMSL" }], win[0], win[1], 262.5, 10000, 1000);
  assert.equal(nogeo.hits.length, 1); assert.equal(nogeo.hits[0].relation, "no-geometry");
});

test("אזור שנשרטט בקירוב נבדק בשולי ביטחון נוספים (750 מ׳); אזור מדויק באותו מרחק לא נכלל", () => {
  const mk = approx => ({ id: "T1", name: "T", cat: "LLR", approx, rings: [[[32.0, 34.0], [32.0, 34.001], [32.001, 34.001], [32.001, 34.0], [32.0, 34.0]]], alt: "" });
  const P = new C.Proj(32.0005, 34.0 - 0.0135);          // ~1,270 מ׳ מערבית לגבול (רדיוס 100 + near 1000 + 170)
  const run2 = (z, margin) => C.analyzeZones(P, 100, { zones: [z], inpa: null }, 1000, 262.5, margin);
  const d = run2(mk(false), 0).near.length + run2(mk(false), 0).inside.length;
  assert.equal(d, 0, "מדויק: מחוץ לטווח הקרבה");
  assert.equal(run2(mk(false), 750).near.length, 0, "שוליים אינם חלים על אזור מדויק");
  assert.equal(run2(mk(true), 0).near.length, 0, "בלי שוליים — לא נכלל");
  const near = run2(mk(true), 750).near;
  assert.equal(near.length, 1, "בקירוב + שוליים — נכלל כ'בקרבה'"); assert.ok(near[0].d > 1100 && near[0].d < 1400, "d=" + near[0].d);
  assert.equal(cfg.thresholds.approx_margin_m, 750);
});

test("הפניית A11-3ג מצוינת לפי השוליים של הדף עצמו (עדכון 1/23), ושורת ההגשה מציגה את שני הסעיפים הסותרים בלי להכריע", () => {
  assert.match(rules09.rules.find(r => r.id === "A11-3ג").ref, /עמ' 4, עדכון 1\/23/);
  assert.match(rules09.rules.find(r => r.id === "A17-5").ref, /עמ' 12, עדכון 1\/26/);
  const res = C.analyze(baseInput, mkData(fixture("yarkon")), cfg, now), t = O.toText(O.submissionHtml(res, cfg, { zones }));
  assert.match(t, /3\.ד\.4/); assert.match(t, /6\(ד\)/); assert.match(t, /אינה מכריעה/);
});

test("כותרת 'בקרבת הסגירה' מציינת את הטווח המורחב של אזורים שנשרטטו בקירוב", () => {
  const z = zones.zones.find(x => x.id === "LLR24"), c = centroid(z), data = mkData(fixture("yarkon"));
  const res = C.analyze(Object.assign({}, baseInput, { lat: c[0], lon: c[1] }), data, cfg, now);
  const t = O.toText(JSON.stringify(O.buildChecks(res, data, cfg)));
  assert.ok(cfg.thresholds.approx_margin_m > 0);
  if (res.zones.near.some(x => x.src === "a17")) assert.match(t, /אזור שנשרטט בקירוב — עד/);
  assert.match(O.sourceNotes(res, data, cfg).join(" "), /אזורי LLR: אין בפמ״ת קואורדינטות/);
});

test("מכשולים שידועים למבקש: הצלבה לפי מילים מול פריטי הסריקה (התאמה אפשרית / בקרבה בלבד / לא נמצא)", () => {
  const scan = {
    items: [{ n: 1, title: "עמוד חשמל", label: "עמוד חשמל", d: 90 }, { n: 2, title: "מגדל סלולרי", label: "מגדל סלולרי", d: 150 }, { n: 3, title: "מגדל מים", label: "מגדל מים", d: 60 }],
    censusOnly: [{ title: "בית חולים ״איכילוב״", label: "בית חולים", name: "איכילוב", d: 800 }]
  };
  const m = t => C.matchKnownObstacles(t, scan);
  assert.deepEqual(m(""), []); assert.deepEqual(m("  ;\n, "), []);
  const crane = m("עגורן בנייה בצד המזרחי");
  assert.equal(crane.length, 1); assert.equal(crane[0].none, true); assert.equal(crane[0].found.length, 0); assert.equal(crane[0].text, "עגורן בנייה בצד המזרחי");
  const tw = m("המגדל הסלולרי ליד בית הספר")[0];   // קידומת ה׳ מוסרת; "בית הספר" לא קיים בסריקה אבל מילה אחת מספיקה
  assert.equal(tw.none, false); assert.equal(tw.found[0].n, 2, "התאמה של שתי מילים קודמת להתאמה של מילה אחת");
  assert.deepEqual(m("מגדל")[0].found.map(i => i.n).sort(), [2, 3], "מילה כללית מחזירה את כל המועמדים");
  const hos = m("בית חולים")[0]; assert.equal(hos.found.length, 0); assert.equal(hos.census.length, 1); assert.equal(hos.none, false);
  assert.equal(m("ליד על")[0].none, true, "מילות קישור בלבד אינן התאמה");
  assert.equal(m("35")[0].none, true, "מספר בלבד אינו התאמה");
  const two = m("חשמל; עגורן, מגדל מים"); assert.equal(two.length, 3); assert.deepEqual(two.map(x => x.none), [false, true, false]);
  assert.equal(m("x".repeat(30) + ";".repeat(2) + Array.from({ length: 40 }, (_, i) => "פריט" + i).join(";")).length, 20, "matchKnownObstacles חותכת ל-20 רק כהגנה פנימית — validateInput דוחה יותר מ-20 (ראו הבדיקה 'אינה חותכת בשקט')");
  assert.deepEqual(C.matchKnownObstacles("מגדל", null), [{ text: "מגדל", found: [], census: [], none: true }]);
});

/* ===== טופס, מייל ודף בדיקות לפי הנוסח החדש (אנשי קשר/משתתפים/מכשולים שידועים, ארבע תמונות, דף בדיקות ממוספר) ===== */
const people = { contacts: [{ name: "דנה כהן", phone: "050-1112233" }, { name: "יוסי לוי", phone: "" }], participants: [{ first: "נועה", last: "אברהם", phone: "050-9998877" }, { first: "", last: "", phone: "" }, { first: "אלון", last: "שמעוני", phone: "053-4445566" }] };
const ltrSpan = t => "<span dir='ltr' class='ph'>" + t + "</span>";   // טלפון: class='ph' (nowrap ב-index.html) כדי שלא יישבר באמצע
const E = C.esc;

test("טופס שדות 8, 11, 12: מכשולים שידועים (טקסט כלשונו, escaped), משתתפים נוספים ממוספרים בלי הערה, אנשי קשר ממוספרים ('ללא טלפון'), ו-17 שדות", () => {
  const data = mkData(fixture("yarkon"));
  const res = C.analyze(Object.assign({}, baseInput, people, { knownObstacles: "עגורן בנייה <b>x</b>\n  קו מתח  \n\nמגדל מים & אחר" }), data, cfg, now), f = O.buildForm(res, cfg);
  assert.equal(f.length, 17);
  // שדה 8: בסוף השורה, שורות חדשות כ-"; ", בלי תוצאות הצלבה, ו-HTML מנוטרל
  assert.ok(f[7].html.endsWith("<br>מכשולים שידועים למבקש: עגורן בנייה &lt;b&gt;x&lt;/b&gt;; קו מתח; מגדל מים &amp; אחר"), f[7].html.slice(-160));
  assert.ok(!/<b>x<\/b>/.test(f[7].html)); assert.ok(!/התאמה אפשרית|לא נמצא בסריקה/.test(f[7].text));
  // שדה 11: מבקש + משתתפים נוספים (שורה ריקה מתעלמים), כל אחד בשורה ממוספרת, הטלפון ב-ltr, בלי הערה
  assert.equal(f[10].html, "בודק, " + ltrSpan("050-0000000") + "<br><b>משתתפים נוספים בטיסה:</b><br>1. נועה אברהם, " + ltrSpan("050-9998877") + "<br>2. אלון שמעוני, " + ltrSpan("053-4445566"));
  assert.equal(f[10].text, "בודק, 050-0000000\nמשתתפים נוספים בטיסה:\n1. נועה אברהם, 050-9998877\n2. אלון שמעוני, 053-4445566");
  // שדה 12: כל איש קשר בשורה ממוספרת; בלי טלפון — "ללא טלפון"; הסימון נשאר
  assert.equal(f[11].html, "1. דנה כהן — " + ltrSpan("050-1112233") + "<br>2. יוסי לוי — ללא טלפון");
  assert.equal(f[11].sub, "2 אנשי קשר + טלפונים");
  // n=19: כל span של טלפון (מבקש, משתתפים, אנשי קשר) נושא class='ph'; span הקואורדינטות בשדה 8 לא
  assert.equal((f[10].html.match(/class='ph'/g) || []).length, 3); assert.equal((f[11].html.match(/class='ph'/g) || []).length, 1);
  assert.ok(!/<span dir='ltr'>/.test(f[10].html + f[11].html), "טלפון בלי class ph"); assert.ok(/<span dir='ltr'>/.test(f[7].html) && !/class='ph'/.test(f[7].html), "קואורדינטות: בלי ph");
  // בלי משתתפים ובלי מכשולים שידועים: אין כותרת משתתפים ואין שורת מכשולים
  const plain = O.buildForm(C.analyze(Object.assign({}, baseInput, { participants: [{ first: "", last: "", phone: "" }, { first: "חלקי", last: "", phone: "050-1" }] }), data, cfg, now), cfg);
  assert.ok(!/משתתפים נוספים/.test(plain[10].html)); assert.ok(!/מכשולים שידועים למבקש/.test(plain[7].text));
  assert.equal(plain[11].text, "1. א — 050-0000001\n2. ב — 050-0000002");
  assert.ok(!/contactNames|contactPhone|undefined/.test(JSON.stringify(plain)), "אין שאריות מההסדר הישן");
});

test("הזרקת HTML בשדות אנשי הקשר, המשתתפים והמכשולים מנוטרלת בטופס ובדף הבדיקות", () => {
  const data = mkData(fixture("yarkon")), evil = "<img src=x onerror=alert(1)>";
  const res = C.analyze(Object.assign({}, baseInput, { contacts: [{ name: evil, phone: "050-1112233" }, { name: "<b>ב</b>", phone: "<i>0</i>" }], participants: [{ first: evil, last: "<u>ל</u>", phone: "050-1" }], knownObstacles: evil, visitNotes: evil }), data, cfg, now);
  const html = O.buildForm(res, cfg).map(r => r.html).join("\n") + O.buildChecks(res, data, cfg).map(r => r[2]).join("\n") + O.visitNoteHtml(res);
  assert.ok(!/<img|<u>|<i>|<b>ב<\/b>/.test(html), "תג שלא מהמערכת נכנס ל-HTML");
  assert.ok(/&lt;img src=x onerror=alert\(1\)&gt;/.test(html));
});

test("מייל: אנשי קשר כל אחד בשורה ממוספרת, משתתפים נוספים, מכשולים שידועים, בלי הערות סיור, ושורת ארבע התמונות", () => {
  const data = mkData(fixture("yarkon"));
  const res = C.analyze(Object.assign({}, baseInput, people, { knownObstacles: "עגורן בנייה\nקו מתח", visitDate: "2026-10-15", visitNotes: "ממצא סיור פנימי" }), data, cfg, now), body = O.mail(res, cfg).body, lines = body.split("\n");
  const at = t => lines.indexOf(t);
  assert.ok(at("אנשי קשר בשטח:") > 0);
  assert.deepEqual(lines.slice(at("אנשי קשר בשטח:") + 1, at("אנשי קשר בשטח:") + 3), ["1. דנה כהן — 050-1112233", "2. יוסי לוי — ללא טלפון"]);
  assert.deepEqual(lines.slice(at("משתתפים נוספים בטיסה:") + 1, at("משתתפים נוספים בטיסה:") + 3), ["1. נועה אברהם, 050-9998877", "2. אלון שמעוני, 053-4445566"]);
  assert.ok(lines.includes("מכשולים שידועים למבקש: עגורן בנייה; קו מתח"));
  assert.ok(at("אנשי קשר בשטח:") < at("משתתפים נוספים בטיסה:") && at("משתתפים נוספים בטיסה:") < lines.findIndex(l => /^מכשולים שידועים למבקש/.test(l)));
  assert.ok(!/ממצא סיור פנימי|הערות המבקש|סיור/.test(body), "הערות הסיור אינן במייל");
  assert.ok(lines.some(l => l.startsWith("מצורפים: טופס הבקשה (נספח ג׳, קובץ Word), ארבע תמונות")));
  // בלי משתתפים ובלי מכשולים: השורות האלה לא מופיעות
  const bare = O.mail(C.analyze(baseInput, data, cfg, now), cfg).body;
  assert.ok(!/משתתפים נוספים|מכשולים שידועים/.test(bare)); assert.ok(/אנשי קשר בשטח:\n1\. א — 050-0000001\n2\. ב — 050-0000002\n/.test(bare));
  assert.ok(!/contactNames|undefined/.test(bare));
});

test("O.attachmentsLine ו-O.visitNoteHtml: שורת המצורפים, הערות המבקש עם תאריך / בלי תאריך / ריקות / עם HTML", () => {
  assert.equal(O.attachmentsLine(), "<b>חובה לצרף מפה/תצ״א</b> — מצורפות ארבע תמונות: תצ״א ומפת רחובות בתקריב, הדמיה וסימונים במבט כללי, ומפת אזור מרוחקת עם סימון המיקום.");
  assert.ok(!/עמוד/.test(O.attachmentsLine()), "בלי מספרי עמודים");
  const R = o => C.analyze(Object.assign({}, baseInput, o), mkData(fixture("yarkon")), cfg, now);
  assert.equal(O.visitNoteHtml(R({ visitDate: "2026-10-15", visitNotes: "ביקור בשטח" })), "<b>הערות המבקש (סיור באתר ב-15.10.2026):</b> ביקור בשטח");
  assert.equal(O.visitNoteHtml(R({ visitDate: "", visitNotes: "ביקור בשטח" })), "<b>הערות המבקש:</b> ביקור בשטח");
  assert.equal(O.visitNoteHtml(R({ visitNotes: "  \n " })), ""); assert.equal(O.visitNoteHtml(R({})), "");
  // n=3/12: תאריך תקין בלי הערות לא נבלע — מוצג כשורה לבדה; בלי הערות ובלי תאריך תקין — כלום
  assert.equal(O.visitNoteHtml(R({ visitDate: "2026-10-15", visitNotes: "" })), "<b>סיור באתר ב-15.10.2026</b>", "תאריך בלי הערות — שורת תאריך בלבד");
  assert.equal(O.visitNoteHtml(R({ visitDate: "2026-10-15", visitNotes: " \n  " })), "<b>סיור באתר ב-15.10.2026</b>", "הערות של רווחים בלבד = בלי הערות");
  assert.equal(O.visitNoteHtml(R({ visitDate: "לא תאריך", visitNotes: "" })), "", "תאריך לא תקין ובלי הערות — כלום");
  assert.equal(O.visitNoteHtml(R({ visitNotes: "שורה א\r\nשורה <ב> & \"ג\"" })), "<b>הערות המבקש:</b> שורה א<br>שורה &lt;ב&gt; &amp; &quot;ג&quot;");
});

test("דף הבדיקות: אין 'לשון הפמ״ת' ואין קידומת 'לשון ' באף שורה; ההפניות בעמודת המקור בלבד; תאים מרובי שורות ממוספרים", () => {
  const data = mkData(fixture("yarkon")), outside = t => t.replace(/״[^״]*״/g, "");
  const cases = [baseInput, Object.assign({}, baseInput, { vlos: false, knownObstacles: "עגורן; מגדל; מבצע קדש" })];
  for (const id of ["LLR24", "LLP01"]) { const c = centroid(zones.zones.find(x => x.id === id)); cases.push(Object.assign({}, baseInput, { lat: c[0], lon: c[1] })); }
  for (const id of ["כרמל מרכז", "401 א"]) { const c = centroid(z09(id)); cases.push(Object.assign({}, baseInput, { lat: c[0], lon: c[1], aircraft: cfg.aircraft.slice(0, 2) })); }
  const lluZone = zones.zones.find(x => x.cat === "LLU"); cases.push(Object.assign({}, baseInput, { lat: centroid(lluZone)[0], lon: centroid(lluZone)[1] }));
  let withFootnote = 0, withLlu = 0;
  cases.forEach((inp, k) => {
    const res = C.analyze(inp, data, cfg, now), rows = O.buildChecks(res, data, cfg);
    if (res.b09Footnote) withFootnote++;
    rows.forEach((r, i) => {
      assert.equal(r.length, 3, "הצורה [name, source, html] נשארת");
      const label = "מקרה " + k + " שורה " + (i + 1) + " " + r[0];
      assert.ok(!/לשון/.test(outside(r[0] + " " + O.toText(r[1]) + " " + O.toText(r[2]))), label + " — 'לשון' מחוץ לציטוט");
      assert.ok(!/עמ' \d|, עדכון \d\/\d\d/.test(outside(O.toText(r[2]))), label + " — הפניה לסעיף/עמוד/עדכון בתוצאה");
      assert.ok(!/undefined|NaN|\[object/.test(r.join(" ")), label);
      // תא מרובה שורות ממוספר "1. …", "2. …" — חוץ מסריקת הסביבה ושורת מכשולים שידועים (כותרות מודגשות / פריטים שכבר ממוספרים לפי מפה, ושורה אפורה אחרונה)
      const lines = r[2].split("<br>");
      if (lines.length > 1 && !/^סריקת סביבה|^מכשולים שידועים/.test(r[0])) lines.forEach((l, j) => assert.ok(l.startsWith((j + 1) + ". "), label + " — שורה " + (j + 1) + " לא ממוספרת: " + l.slice(0, 60)));
    });
    const lluRow = rows[0][2]; if (/הגדרת LLU: ״/.test(lluRow)) { withLlu++; assert.ok(rows[0][1].includes(zones.general.LLU.ref), "הסעיף של LLU בעמודת המקור"); assert.ok(!lluRow.includes(zones.general.LLU.ref)); }
  });
  assert.ok(withFootnote >= 1 && withLlu >= 1, `כיסוי המקרים: הערת שוליים ${withFootnote}, LLU ${withLlu}`);
  // אזורי א-17: מקור = מהדורת א-17 ואחריה ההפניות הייחודיות של האזורים המוצגים
  const c24 = centroid(zones.zones.find(x => x.id === "LLR24")), r24 = C.analyze(Object.assign({}, baseInput, { lat: c24[0], lon: c24[1] }), data, cfg, now), row = O.buildChecks(r24, data, cfg)[0];
  const refs = [...new Set([...r24.zones.inside, ...r24.zones.near].filter(z => z.src === "a17").map(z => z.pmtRef).filter(Boolean))];
  assert.ok(refs.length >= 1 && row[1].startsWith(zones.edition) && refs.every(x => row[1].includes(x)), row[1]);
  assert.match(O.toText(row[2]), /^1\. (חפיפה לסגירה המבוקשת|בקרבת הסגירה): LLR24 /);
  assert.match(O.toText(row[2]), /״ד\. LLR24[^״]*בכל גובה[^״]*״/, "טקסט הפמ״ת של האזור בתוך ״…״");
  // בלי אזור א-17: שורה אחת "אין"
  const far = C.analyze(Object.assign({}, baseInput, { lat: 31.55, lon: 34.95 }), data, cfg, now), rowFar = O.buildChecks(far, data, cfg)[0];
  assert.ok(!rowFar[2].includes("<br>") && /^אין אזור א-17/.test(rowFar[2]), rowFar[2]);
});

test("דף הבדיקות: שורות שמורות/מנחתים/סריקה/גבולות/נוטמים — פריט בשורה, סריקת הסביבה עם כותרות מודגשות ושורה אפורה אחרונה, נוטמים ממוספרים", () => {
  const data = mkData(fixture("yarkon")), res = C.analyze(baseInput, data, cfg, now), rows = O.buildChecks(res, data, cfg);
  const scan = rows.find(r => /^סריקת סביבה/.test(r[0])), scanLines = scan[2].split("<br>");
  assert.equal(scanLines[0], "<b>בתוך 200 מ׳:</b>"); assert.equal(scanLines[1], E(O.itemText(res.nearScan.inside[0])));
  assert.ok(scanLines.includes("<b>בקרבת האזור (עד 400 מ׳):</b>")); assert.ok(scanLines.some(l => /^<b>אתרים ותשתיות נוספים \(עד 1\.2 ק״מ מהנקודה\):<\/b>$/.test(l)));
  assert.ok(!scanLines.some(l => /^\d+\. \d+\. /.test(l)), "אין מספור כפול — הפריטים ממוספרים לפי המפה");
  assert.ok(/^<b>בלון:<\/b> .*כדור פורח תל אביב/.test(scanLines.find(l => /^<b>בלון:/.test(l))));
  assert.ok(/^<span class='muted'>\(מכשולים — עד 400 מ׳ מהנקודה/.test(scanLines[scanLines.length - 1]), "שורה אחרונה אפורה — היקף הסריקה");
  const nt = rows.find(r => /^סגירות אוויריות בנוטמים/.test(r[0]));
  assert.match(nt[2], /^1\. <b>C0431\/26<\/b> — /); assert.ok(nt[2].split("<br>").every((l, j) => l.startsWith((j + 1) + ". ")));
  const air = rows.find(r => /^שדות תעופה ומנחתים בסביבה/.test(r[0])); assert.ok(air[2].split("<br>").length >= 3 && air[2].startsWith("1. <b>שדה תעופה:</b>"));
  // שמורת טבע בחפיפה / אזור מ-INPA: שורה לאזור
  const s = inpa.sites.find(x => x.rings && x.rings[0].length > 6), ctr = s.rings[0].reduce((a, p) => [a[0] + p[0] / s.rings[0].length, a[1] + p[1] / s.rings[0].length], [0, 0]);
  const rN = C.analyze(Object.assign({}, baseInput, { lat: ctr[0], lon: ctr[1] }), data, cfg, now), nr = O.buildChecks(rN, data, cfg).find(r => r[0] === "שמורות טבע וגנים לאומיים");
  assert.ok(/(חפיפה|בקרבת הסגירה):<\/b> /.test(nr[2]) && !/^אין שמורת/.test(nr[2]), nr[2].slice(0, 120));
  assert.ok(rows.find(r => r[0] === "שמורות טבע וגנים לאומיים")[2].startsWith("אין שמורת טבע או גן לאומי בחפיפה לסגירה"));
});

test("דף הבדיקות: שורת מכשולים שידועים למבקש — ריק / נמצא (עד 5 ו'ועוד N') / רק מצאי רחב בקרבה / לא נמצא", () => {
  const data = mkData(fixture("yarkon")), row = inp => O.buildChecks(C.analyze(Object.assign({}, baseInput, inp), data, cfg, now), data, cfg).find(r => r[0] === "מכשולים שידועים למבקש");
  const empty = row({});
  assert.equal(empty[2], "המבקש לא הזין מכשולים נוספים."); assert.equal(empty[1], "הוזן ע״י המבקש; הצלבה מול סריקת הסביבה (לפי מילים בלבד)");
  assert.equal(row({ knownObstacles: " \n ; " })[2], "המבקש לא הזין מכשולים נוספים.");
  const res = C.analyze(Object.assign({}, baseInput, { knownObstacles: "עמוד חשמל; מבצע קדש; עגורן בנייה" }), data, cfg, now), m = C.matchKnownObstacles("עמוד חשמל; מבצע קדש; עגורן בנייה", res.nearScan);
  assert.deepEqual(m.map(x => [x.found.length > 0, x.census.length > 0, x.none]), [[true, false, false], [false, true, false], [false, false, true]], "תנאי המבחן: נמצא / מצאי רחב בלבד / לא נמצא");
  const lines = O.buildChecks(res, data, cfg).find(r => r[0] === "מכשולים שידועים למבקש")[2].split("<br>"), t = lines.map(O.toText);
  assert.equal(lines.length, 4);
  assert.ok(t[0].startsWith("1. ״עמוד חשמל״ — התאמה אפשרית (מספרי הפריטים לפי המפה): ") && t[0].includes(O.itemText(m[0].found[0])), t[0]);
  assert.ok(t[1].startsWith("2. ״מבצע קדש״ — נמצא בסריקה בקרבה (אינו ברשימת הטופס ואינו ממוספר במפה): " + m[1].census[0].title + " — " + O.dLabel(m[1].census[0].d)), t[1]);
  assert.equal(t[2], "3. ״עגורן בנייה״ — לא נמצא בסריקה (מכשולים נסרקים עד 400 מ׳ מהנקודה ואתרים עד 1.2 ק״מ). ייתכן שאינו ממופה ב-OpenStreetMap או שהוא מחוץ לטווח; אם הוא בטווח, יש להוסיפו ידנית בסעיף ״סקירה אנושית ותוספות״.");
  assert.equal(lines[3], "<span class='muted'>ההצלבה לפי מילים בלבד, בלי מיקום — אינה תחליף לסימון ידני.</span>");
  // יותר מ-5 התאמות: מציגים 5 והשאר "ועוד N"
  const many = Array.from({ length: 8 }, (_, i) => ({ n: i + 1, title: "מגדל " + (i + 1), label: "מגדל", name: "", d: 50 + i, zone: "in" }));
  const fake = Object.assign({}, res, { inp: Object.assign({}, res.inp, { knownObstacles: "מגדל" }), nearScan: Object.assign({}, res.nearScan, { items: many, inside: many, ring: [], near: [], censusOnly: [] }) });
  const mt = O.toText(O.buildChecks(fake, data, cfg).find(r => r[0] === "מכשולים שידועים למבקש")[2]);
  assert.ok(/התאמה אפשרית \(מספרי הפריטים לפי המפה\): 1\. מגדל 1 — 50 מ׳; 2\. .*; 5\. מגדל 5 — 54 מ׳; ועוד 3\n/.test(mt), mt);
  // טקסט משתמש עם HTML — מנוטרל
  assert.ok(!/<img/.test(row({ knownObstacles: "<img src=x>" })[2]));
});

test("Word: ארבע תמונות בסדר העמודים, כותרות סעיף ממוספרות ברצף בדף הבדיקות, עמודת #, הערות הסיור, בלי 'דוח כיסוי' ובלי שורת מקורות", async () => {
  const data = mkData(fixture("yarkon")), res = C.analyze(Object.assign({}, baseInput, people, { visitDate: "2026-10-15", visitNotes: "תצפית מהגג" }), data, cfg, now);
  const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64"), img = { bytes: jpeg, w: 1280, h: 960 };
  const BIDI = new RegExp("[" + String.fromCharCode(0x202a, 0x202c, 0x200f) + "]", "g");   // LRE, PDF ו-RLM (נוסף אחרי כל PDF — ראו runsOf)
  const build = async o => {
    const model = O.docxModel(res, data, cfg, Object.assign({ images: { aerial: img, street: img, overview: img, region: img }, includeChecks: true, review: "אושר", providerName: "Esri" }, o));
    const z = await JSZipNode.loadAsync(await D.build(model)), doc = await z.file("word/document.xml").async("string");
    const lines = doc.replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "").replace(BIDI, "").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").split("\n");
    return { model, z, doc, lines, plain: lines.join("\n") };
  };
  const full = await build({}), m = full.model;
  // המודל לפי החוזה
  assert.ok(!("mapTitle" in m)); assert.equal(m.attachLine, O.attachmentsLine()); assert.equal(m.visitNote, O.visitNoteHtml(res));
  assert.deepEqual(Object.keys(m.coverage).sort(), ["censusMore", "censusOnly", "groups"]);
  assert.match(m.footer, /^הופק /); assert.ok(!/מקורות/.test(m.footer));
  assert.equal(m.aerialTitle, "הדמיה מצורפת — תצ״א תקריב — Esri"); assert.match(m.streetTitle, /^הדמיה מצורפת — מפת רחובות תקריב/);
  assert.match(m.overviewTitle, /^הדמיה מצורפת — הדמיה וסימונים \(מבט כללי/); assert.match(m.regionTitle, /^הדמיה מצורפת — מפת אזור \(מרוחק\)/);
  // ארבע תמונות, קבצי מדיה לפי הסדר, וכותרות העמודים בסדר: תצ״א, רחובות, מבט כללי (+ טבלת פריטים), אזור
  assert.equal((full.doc.match(/<w:drawing>/g) || []).length, 4);
  const rels = await full.z.file("word/_rels/document.xml.rels").async("string");
  assert.deepEqual([...rels.matchAll(/Target="media\/([a-z]+)\.jpeg"/g)].map(x => x[1]), ["aerial", "street", "overview", "region"]);
  const pos = t => { const i = full.plain.indexOf(t); assert.ok(i >= 0, "חסר: " + t); return i; };
  const order = [m.title, m.aerialTitle, m.streetTitle, m.overviewTitle, "מכשולים, אתרים ותשתיות המסומנים במפה", m.regionTitle, "דף בדיקות — לא חלק מהטופס הרשמי"].map(pos);
  assert.deepEqual(order, order.slice().sort((a, b) => a - b), "סדר העמודים");
  assert.ok(pos(m.mapNote.slice(0, 40)) > pos(m.aerialTitle) && pos(m.mapNote.slice(0, 40)) < pos(m.streetTitle), "מקרא הצבעים מתחת לתצ״א");
  assert.ok(full.plain.includes(O.toText(O.attachmentsLine())), "שורת המצורפים בטופס"); assert.ok(!/עמודים 2–3|תצ״א נקי/.test(full.plain));
  // דף הבדיקות: כותרות סעיף ממוספרות ברצף
  const HEADS = ["הנקודה", "הבדיקות שבוצעו", "מצאי לפי קבוצות", "יום ולילה בחלון הפעילות", "הגשה", "אישור סקירה אנושית"];
  const heads = lines => lines.map(l => /^(\d+)\. (.+)$/.exec(l)).filter(x => x && HEADS.includes(x[2])).map(x => x[1] + ". " + x[2]);
  assert.deepEqual(heads(full.lines), HEADS.map((h, i) => (i + 1) + ". " + h));
  // הערות הסיור בסעיף 1, מיד אחרי הנקודה ולפני סעיף 2
  const note = full.lines.findIndex(l => l.startsWith("הערות המבקש (סיור באתר ב-15.10.2026):")); assert.ok(note > full.lines.indexOf("1. הנקודה") && note < full.lines.indexOf("2. הבדיקות שבוצעו"));
  assert.ok(full.lines[note].endsWith("תצפית מהגג"));
  // טבלת הבדיקות: עמודה ראשונה "#" וממוספרת לפי השורה
  const h2 = full.lines.indexOf("2. הבדיקות שבוצעו");
  assert.deepEqual(full.lines.slice(h2 + 1, h2 + 6), ["#", "בדיקה", "מקור", "תוצאה", "1"]);
  assert.ok(full.lines.includes(String(m.checks.length)), "מספר השורה האחרון");
  const grid = /<w:tblGrid>((?:<w:gridCol w:w="\d+"\/>)+)<\/w:tblGrid>/.exec(full.doc.slice(full.doc.indexOf("הבדיקות שבוצעו")));
  const cols = [...grid[1].matchAll(/w:w="(\d+)"/g)].map(x => +x[1]);
  assert.equal(cols.length, 4); assert.ok(cols[0] <= 700 && cols[0] < cols[1] && cols[0] < cols[2], "העמודה הראשונה צרה"); assert.equal(cols.reduce((a, b) => a + b, 0), D.helpers.CONTENT_W, "רוחבי העמודות מתאימים לרוחב הדף");
  // אין "דוח כיסוי — מה נסרק", אין שורת "מקורות:" בתחתית ואין סעיף מגבלות/מקורות (הוא נשאר בתיבה שעל המסך בלבד); אין רשימת "• "
  assert.ok(!full.plain.includes("דוח כיסוי") && !full.plain.includes("מה נסרק") && !full.plain.includes("מקורות:") && !full.plain.includes("• "));
  assert.match(full.lines.filter(Boolean).pop(), /^הופק /);
  assert.ok(!full.plain.includes("מגבלות והסתייגויות") && !full.plain.includes("מקור האיסורים") && !full.plain.includes("מאגר ציבורי שנבנה על ידי מתנדבים"), "אין הצהרות על מקור הנתונים מחוץ לעמודת המקור");
  assert.equal(m.notes, undefined, "המודל לא נושא רשימת מגבלות");
  // המצאי נשאר: טבלת הקבוצות, והפריטים הנוספים בקרבה תחת סעיף המצאי
  assert.ok(pos("פריטים נוספים שנמצאו בקרבה ואינם בטופס") > pos("3. מצאי לפי קבוצות") && pos("פריטים נוספים שנמצאו בקרבה ואינם בטופס") < pos("4. יום ולילה בחלון הפעילות"));
  // n=26: הכותרת היא תת-סעיף "3.1" (לפי מונה הסעיף הנוכחי), לא כותרת בלי מספר ולא סעיף חדש שדוחף את הסעיפים הבאים
  assert.ok(full.lines.includes("3.1 פריטים נוספים שנמצאו בקרבה ואינם בטופס"), "3.1");
  assert.ok(pos("3.1 פריטים נוספים שנמצאו בקרבה ואינם בטופס") > pos("3. מצאי לפי קבוצות") && pos("3.1 פריטים נוספים שנמצאו בקרבה ואינם בטופס") < pos("4. יום ולילה בחלון הפעילות"));
  assert.ok(!full.lines.includes("פריטים נוספים שנמצאו בקרבה ואינם בטופס"), "אין עוד כותרת בלי מספר");
  // רק סעיפים שמוצגים: בלי אישור סקירה ובלי הערות סיור — ממשיכים לספור ברצף, בלי סעיף 7; ובלי דף בדיקות — אין כותרות
  const lean = await build({ review: "" }); assert.deepEqual(heads(lean.lines), HEADS.slice(0, 5).map((h, i) => (i + 1) + ". " + h));
  const noChecks = await build({ includeChecks: false }); assert.deepEqual(heads(noChecks.lines), []); assert.ok(!noChecks.plain.includes("הבדיקות שבוצעו"));
  // תמונה חסרה: העמוד שלה לא נוצר ושאר התמונות נשארות (גם אם חסרה הראשונה)
  const part = await build({ images: { aerial: null, street: img, overview: img, region: null } });
  assert.equal((part.doc.match(/<w:drawing>/g) || []).length, 2); assert.ok(!part.plain.includes(part.model.aerialTitle) && !part.plain.includes(part.model.regionTitle) && part.plain.includes(part.model.streetTitle));
  assert.ok(part.plain.indexOf(part.model.mapNote.slice(0, 40)) > part.plain.indexOf(part.model.streetTitle) && part.plain.indexOf(part.model.mapNote.slice(0, 40)) < part.plain.indexOf(part.model.overviewTitle), "המקרא מתחת לתמונה הראשונה שקיימת");
  assert.equal(part.plain.split(part.model.mapNote.slice(0, 40)).length, 2, "המקרא מופיע פעם אחת");
  assert.ok(wellFormed(part.doc) && wellFormed(full.doc));
});

/* ===== תיקוני סקירה עצמאית (סוכן 1): הצלבת מכשולים שידועים, הגדרת LLU במלואה, XML תקין ב-Word וב-KML, סדר דו-כיווני ב-Word ===== */
test("מכשולים שידועים: ריבוי, אותיות סופיות ונרדפים ברמת מילה (מגדלים, עגורנים, אנטנות, תרנים) — בלי התאמה בין ביטויים", () => {
  const it = (n, label, d) => ({ n, title: label, label, name: "", d });
  const scan = { items: [it(1, "מגדל תקשורת", 10), it(2, "מגדל תצפית", 20), it(3, "תורן", 30), it(4, "עגורן", 40), it(5, "ארובה", 50), it(6, "מגדל מים", 60), it(7, "עמוד חשמל", 70)], censusOnly: [] };
  const found = t => C.matchKnownObstacles(t, scan)[0].found.map(i => i.n).sort((a, b) => a - b);
  assert.deepEqual(found("מגדלים"), [1, 2, 6], "ריבוי ים: מגדלים -> מגדל תקשורת/תצפית/מים");
  assert.deepEqual(found("המגדלים"), [1, 2, 6], "ריבוי עם אות יחס");
  assert.deepEqual(found("עגורנים"), [4], "אות סופית: עגורנים -> עגורן");
  assert.deepEqual(found("עגורן"), [4]);
  assert.deepEqual(found("עמודים"), [7]);
  assert.deepEqual(found("ארובות"), [5], "ריבוי ות -> ה");
  assert.deepEqual(found("מנוף"), [4], "נרדף: מנוף = עגורן");
  for (const t of ["אנטנה", "אנטנות סלולריות", "תרנים", "תורנים", "תרן"]) assert.deepEqual(found(t), [3], t + " -> תורן בלבד (לא מגדל תקשורת/מים)");
  // בלי תורן ועגורן בסריקה: הנרדפים אינם מתאימים לפריטים אחרים (מילה במילה, לא ביטויים), ו"עגורן בנייה" נשאר none
  const noMast = { items: scan.items.filter(i => i.n !== 3 && i.n !== 4), censusOnly: [] };
  for (const t of ["עגורן בנייה", "עגורנים", "מנוף", "אנטנה", "אנטנות סלולריות", "תרנים"]) assert.equal(C.matchKnownObstacles(t, noMast)[0].none, true, t + " — אין תורן/עגורן בסריקה");
  // פיקסצ'ר הירקון: "מגדלים" מתאים ל"מגדל תקשורת"; ואחרי הוספת תורן (21 מ׳) ועגורן (35 מ׳) ל-OSM "אנטנה"/"תרנים"/"עגורנים" מתאימים, וכשאין עגורן "עגורן בנייה" נשאר none
  const res0 = C.analyze(baseInput, mkData(fixture("yarkon")), cfg, now), m0 = C.matchKnownObstacles("מגדלים", res0.nearScan)[0];
  assert.equal(m0.none, false); assert.ok(m0.found.some(i => i.label === "מגדל תקשורת"), m0.found.map(i => i.title).join("|"));
  assert.equal(C.matchKnownObstacles("עגורן בנייה", res0.nearScan)[0].none, true);
  const fx2 = fixture("yarkon"), node = (id, m, dm) => ({ type: "node", id, lat: baseInput.lat + dm / 111132, lon: baseInput.lon, tags: { man_made: m } });
  fx2.near = Object.assign({}, fx2.near, { elements: fx2.near.elements.concat([node(9000001, "mast", 21), node(9000002, "crane", 35)]) });
  const res1 = C.analyze(baseInput, mkData(fx2), cfg, now), f1 = t => C.matchKnownObstacles(t, res1.nearScan)[0];
  for (const t of ["אנטנה", "אנטנות סלולריות", "תרנים"]) assert.ok(f1(t).found.some(i => i.label === "תורן"), t);
  for (const t of ["עגורנים", "עגורן בנייה"]) assert.ok(f1(t).found.some(i => i.label === "עגורן"), t);
});

test("מכשולים שידועים: קישוט הפריט המקובץ '(×N, הקרוב)' ומילת 'הקרוב' אינם התאמה — ההצלבה לפי label ו-name בלבד", () => {
  const res = C.analyze(baseInput, mkData(fixture("yarkon")), cfg, now), scan = res.nearScan;
  const decorated = scan.items.concat(scan.censusOnly).filter(i => /\(×\d+, הקרוב\)/.test(i.title));
  assert.ok(decorated.length >= 2, "תנאי המבחן: פריטי מצאי מקובצים עם קישוט בפיקסצ'ר: " + decorated.length);
  for (const t of ["עגורן הקרוב לכניסה", "בניין הקרוב", "הקרוב", "הקרובה", "קרוב"]) {
    const r = C.matchKnownObstacles(t, scan)[0];
    assert.equal(r.none, true, t + " — נמצא: " + r.found.concat(r.census).map(i => i.title).join(" | "));
  }
  // התאמה אמיתית לפי השם נשארת: גם לפריט מקובץ
  const grouped = decorated[0], word = grouped.label.split(" ").pop();
  assert.ok(C.matchKnownObstacles(word, scan)[0].found.concat(C.matchKnownObstacles(word, scan)[0].census).includes(grouped), "התאמה לפי שם הפריט המקובץ: " + word);
  // פריט בלי label/name (title בלבד): הקישוט מוסר ולא נחשב
  const syn = { items: [], censusOnly: [{ title: "אזור תעשייה (×5, הקרוב)", label: "אזור תעשייה", name: "", d: 300 }, { title: "מגדל (×3, הקרוב)", d: 310 }] };
  assert.equal(C.matchKnownObstacles("הקרוב", syn)[0].none, true); assert.equal(C.matchKnownObstacles("עגורן הקרובה", syn)[0].none, true);
  assert.equal(C.matchKnownObstacles("תעשייה", syn)[0].census.length, 1); assert.equal(C.matchKnownObstacles("מגדל", syn)[0].census.length, 1);
  // KO_STOP מוחל גם אחרי הסרת אות היחס ("הקרוב" -> "קרוב"), בשני הצדדים: גם אם "הקרוב" הוא חלק מ-label של פריט הוא אינו מילת התאמה
  assert.equal(C.matchKnownObstacles("עגורן הקרוב", { items: [{ n: 1, title: "מגדל הקרוב", label: "מגדל הקרוב", name: "", d: 1 }], censusOnly: [] })[0].none, true);
});

test("מכשולים שידועים: knownSegments אינה חותכת בשקט, ו-validateInput דוחה יותר מ-20 פריטים בשגיאה חוסמת על השדה", () => {
  const many = n => Array.from({ length: n }, (_, i) => "פריט" + i + "xyz");
  const errs = ko => C.validateInput(Object.assign({}, baseInput, { knownObstacles: ko }), cfg).filter(e => e.field === "knownObstacles");
  const MSG = "מכשולים שידועים למבקש: עד 20 פריטים (מופרדים בפסיק או בשורה חדשה)";
  assert.equal(C.KO_MAX, 20);
  assert.equal(C.knownSegments(many(25).join(", ")).length, 25, "כל הקטעים, בלי slice");
  assert.equal(C.knownSegments(many(60).join("\n")).length, 60);
  assert.equal(errs(many(20).join(", ")).length, 0, "20 פריטים מותרים");
  assert.deepEqual(errs(many(21).join(", ")).map(e => e.msg), [MSG]);
  assert.deepEqual(errs(many(25).join("\n")).map(e => e.msg), [MSG], "גם מופרדים בשורות חדשות");
  assert.deepEqual(errs(many(45).join("; ")).map(e => e.msg), [MSG]);
  assert.deepEqual(errs(many(20).join(", ") + ", , ;;\n").map(e => e.msg), [], "מפרידים ריקים אינם פריטים");
  assert.equal(errs("א,".repeat(600)).length, 1, "מעל 1,000 תווים — שגיאה אחת בלבד (אורך), בלי כפילות");
  assert.equal(C.validateInput(Object.assign({}, baseInput, { knownObstacles: many(25).join(", ") }), cfg).length, 1, "השגיאה היחידה בבקשה");
  // matchKnownObstacles עצמה חותכת ל-20 רק כהגנה (הממשק חסום על ידי האימות)
  assert.equal(C.matchKnownObstacles(many(25).join(", "), { items: [], censusOnly: [] }).length, 20);
});

test("דף הבדיקות: הגדרת LLU מצוטטת במלואה וכלשונה (כולל […], יצירת קשר עם שירות בתי הסוהר ואישור בכתב), בלי מרכאות ASCII עוטפות", () => {
  const data = mkData(fixture("yarkon")), c = centroid(zones.zones.find(x => x.cat === "LLU"));
  const res = C.analyze(Object.assign({}, baseInput, { lat: c[0], lon: c[1] }), data, cfg, now), row = O.buildChecks(res, data, cfg)[0];
  const line = row[2].split("<br>").find(l => /הגדרת LLU: ״/.test(l)); assert.ok(line, "שורת הגדרת LLU");
  const src = zones.general.LLU.text, full = src.trim().replace(/^"/, "").replace(/"$/, "");
  assert.equal(O.toText(line).replace(/^\d+\. /, ""), "הגדרת LLU: ״" + full + "״", "הציטוט זהה מילה במילה ל-zones.json (בלי המרכאות העוטפות)");
  const t = O.toText(line);
  assert.ok(/שירות בתי הסוהר/.test(t) && /אישור בכתב/.test(t) && /מטה ארצי- 074-7833333/.test(t) && /ב\. אזורים שאינם תחת אחריות שירות בתי הסוהר/.test(t), "המשפט התפעולי וסעיף ב׳");
  assert.equal((t.match(/\[…\]/g) || []).length, 2, "סימוני […] של המקור");
  assert.ok(!/״"|"״/.test(t), "אין מרכאות כפולות עוטפות"); assert.ok(!line.includes(zones.general.LLU.ref), "ההפניה בעמודת המקור בלבד");
});

/* ---------- XML תקין: תווי בקרה אסורים (U+000B מהדבקה מ-Word, U+0001, U+FFFE, חצי סרוגייט) ---------- */
const fcc = (...a) => String.fromCharCode(...a);
const XML_BAD = new RegExp("[" + fcc(0) + "-" + fcc(8) + fcc(0xb, 0xc) + fcc(0xe) + "-" + fcc(0x1f) + fcc(0xd800) + "-" + fcc(0xdfff) + fcc(0xfffe, 0xffff) + "]");   // (חצאי סרוגייט נבדקים כיחידות קוד — בקלט הבדיקות אין תווים מחוץ ל-BMP)
// xmllint מחזיר "" כשהקובץ תקין, הודעת שגיאה כשלא, ו-null כשאינו מותקן (אז נשארת בדיקת ה-RegExp בלבד)
const xmllint = xml => { const r = spawnSync("xmllint", ["--noout", "-"], { input: xml, encoding: "utf8" }); return r.error ? null : r.status === 0 ? "" : String(r.stderr).slice(0, 300); };
const dirty = w => "א" + fcc(0xb) + w + fcc(1) + "ב" + fcc(0xfffe) + fcc(0xd800) + "ג";   // אחרי הניקוי: "א" + w + "בג"
const dirtyInput = Object.assign({}, baseInput, {
  knownObstacles: dirty("עגורן") + "\n" + dirty("קו מתח"), visitDate: "2026-10-15", visitNotes: dirty("סיור") + "\n" + dirty("ממצא"),
  contacts: [{ name: dirty("דנה"), phone: "050-111" + fcc(0xb) + "2233" }, { name: dirty("יוסי"), phone: "" }],
  participants: [{ first: dirty("נועה"), last: dirty("לוי"), phone: "050-9998877" + fcc(1) }],
  aircraft: [dirty("DJI")], siteName: dirty("אתר"), requesterName: dirty("בודק"), requesterPhone: "050-" + fcc(1) + "0000000"
});

test("Word: תווי בקרה אסורים ב-XML בכל שדה טקסט (הערות, מכשולים, שמות, כלי טיס, סקירה) — document.xml ו-core.xml נשארים XML תקין והטקסט נשמר", async () => {
  const data = mkData(fixture("yarkon")), res = C.analyze(dirtyInput, data, cfg, now);
  const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");
  const model = O.docxModel(res, data, cfg, { images: { aerial: { bytes: jpeg, w: 1280, h: 960 } }, includeChecks: true, review: dirty("סקירה"), providerName: dirty("Esri"), draft: dirty("טיוטה") });   // התמונה: כדי שגם descr של התמונה (תכונת XML) תכלול טקסט מלוכלך
  assert.ok(XML_BAD.test(model.rows.map(r => r.html).join("") + model.visitNote + model.checks.map(r => r.join("")).join("")), "תנאי המבחן: התווים האסורים נמצאים במודל");
  const z = await JSZipNode.loadAsync(await D.build(model));
  for (const f of ["word/document.xml", "docProps/core.xml", "word/_rels/document.xml.rels", "[Content_Types].xml"]) {
    const xml = await z.file(f).async("string");
    assert.ok(!XML_BAD.test(xml), f + " — תו אסור ב-XML");
    const lint = xmllint(xml); if (lint !== null) assert.equal(lint, "", f + " — xmllint: " + lint);
  }
  const doc = await z.file("word/document.xml").async("string"), plain = doc.replace(/<[^>]+>/g, "");
  for (const w of ["עגורן", "קו מתח", "סיור", "ממצא", "דנה", "יוסי", "נועה", "לוי", "אתר", "בודק", "סקירה", "טיוטה"]) assert.ok(plain.includes("א" + w + "בג"), "הטקסט נשמר (בלי התווים האסורים): " + w);
  assert.ok(plain.includes("DJI") && plain.includes("050-1112233") && plain.includes("050-9998877"), "הלטיני והטלפונים נשמרים");
  assert.ok((await z.file("docProps/core.xml").async("string")).includes("א אתר בג"), "כותרת המסמך (core.xml): safeName מחליף בקרה ברווח, esc מסיר FFFE/סרוגייט");
  // esc של docx: טאב/LF/CR נשארים, תווים תקינים מחוץ ל-BMP לא נפגעים
  const rt = D.runsOf("x\ty" + fcc(0xd83d, 0xde00) + "z");
  assert.ok(rt.includes("\t") && rt.includes(fcc(0xd83d, 0xde00)) && !XML_BAD.test(rt.replace(fcc(0xd83d, 0xde00), "")));
  assert.ok(!XML_BAD.test(D.runsOf("a" + fcc(0xb) + "b" + fcc(0) + fcc(0xfffe) + fcc(0xffff) + fcc(0xdc00) + "c")), "בקרה, FFFE, FFFF וסרוגייט בודד");
});

test("KML: תווי בקרה אסורים ב-XML (siteName ושמות) מנוקים, C.esc המשותפת ל-HTML אינה משתנה", () => {
  const data = mkData(fixture("yarkon")), res = C.analyze(dirtyInput, data, cfg, now), k = O.kml(res, data, cfg);
  assert.ok(!XML_BAD.test(k), "תו אסור ב-KML"); assert.ok(k.includes("<name>בקשת סגירה אווירית — אאתרבג"), "שם המסמך נשמר מנוקה");
  const lint = xmllint(k); if (lint !== null) assert.equal(lint, "", "xmllint: " + lint);
  assert.equal(C.esc("a" + fcc(0xb) + "<"), "a" + fcc(0xb) + "&lt;", "C.esc אינה מסירה תווים (משותפת ל-HTML)");
  assert.equal(C.xmlClean("a" + fcc(0xb) + "\t\n\rb" + fcc(0xfffe)), "a\t\n\rb");
});

/* ---------- סדר דו-כיווני ב-Word: LRE רק במקטע עם אות לטינית, RLM אחרי כל PDF, ספרות/סוגריים נשארים בריצת ה-RTL ---------- */
const LRE = fcc(0x202a), PDF = fcc(0x202c), RLM = fcc(0x200f);
const wTexts = xml => [...xml.matchAll(/<w:t xml:space="preserve">([^<]*)<\/w:t>/g)].map(m => m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
test("Word runsOf/htmlRuns: מספור ומזהה נוטם — '1. ' נשאר ללא עטיפה, המזהה עטוף ב-LRE…PDF ואחריו RLM; ספרות וסוגריים בלבד אינם עטופים", () => {
  assert.deepEqual(wTexts(D.htmlRuns("1. <b>C0010/26</b> — 1.5 ק״מ מקצה")), ["1. ", LRE + "C0010/26" + PDF + RLM, " — ", "1.5 ", "ק״מ מקצה"]);
  assert.deepEqual(wTexts(D.runsOf("סעיף 7(ג)")), ["סעיף ", "7(", "ג)"], "7( בתוך ה-RTL, לא עטוף");
  assert.deepEqual(wTexts(D.runsOf("(1) נ.צ")), ["(", "1) ", "נ.צ"]);
  assert.deepEqual(wTexts(D.runsOf("1/26")), ["1/26"]); assert.deepEqual(wTexts(D.runsOf("27.10.2026")), ["27.10.2026"]);
  assert.deepEqual(wTexts(D.runsOf("050-1234567")), ["050-1234567"]);
  // מקטע עם אות לטינית (נ"צ DMS עם N/E, מייל, מזהה): עטוף, ו-RLM מיד אחרי ה-PDF לפני רווחי הסיום
  assert.deepEqual(wTexts(D.runsOf("31°50'38.04\"N   34°56'48.12\"E (עשרוני)")), [LRE + "31°50'38.04\"N   34°56'48.12\"E (" + PDF + RLM, "עשרוני)"]);
  assert.deepEqual(wTexts(D.runsOf("a@b.co ב")), [LRE + "a@b.co" + PDF + RLM + " ", "ב"]);
  const all = wTexts(D.htmlRuns("<b>C0010/26</b> ו-ICD ו-LLU20, 3 מ׳ 7(ג) (1) a")).join("");
  assert.equal((all.match(new RegExp(LRE, "g")) || []).length, (all.match(new RegExp(PDF, "g")) || []).length); assert.equal((all.match(new RegExp(PDF + RLM, "g")) || []).length, (all.match(new RegExp(PDF, "g")) || []).length, "כל PDF ואחריו RLM");
});

// בדיקת ההצגה בפועל: ממירים את ה-docx ל-PDF ב-LibreOffice וקוראים את סדר המילים החזותי (pdftotext -bbox). מדלג אם הכלים אינם מותקנים
test("Word + LibreOffice: בשורת נוטם המספור בתחילת השורה והסדר מזהה — מרחק לא מתהפך (מדלג בלי soffice/pdftotext)", async t => {
  const has = (c, a) => { const r = spawnSync(c, a, { encoding: "utf8", timeout: 20000 }); return !r.error && r.status === 0; };
  if (!has("soffice", ["--version"]) || !has("pdftotext", ["-v"])) return t.skip("soffice/pdftotext לא מותקנים");
  const data = mkData(fixture("yarkon")), res = C.analyze(Object.assign({}, baseInput, { lat: 31.8439, lon: 34.9467 }), data, cfg, now);
  assert.equal(res.notams.hits[0].id, "C0010/26", "תנאי המבחן: נוטם C0010/26 בטווח");
  const bytes = await D.build(O.docxModel(res, data, cfg, { includeChecks: true })), tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reqdocx-"));
  try {
    fs.writeFileSync(path.join(tmp, "r.docx"), bytes);
    const cv = spawnSync("soffice", ["--headless", "-env:UserInstallation=file://" + path.join(tmp, "profile"), "--convert-to", "pdf", "--outdir", tmp, path.join(tmp, "r.docx")], { encoding: "utf8", timeout: 170000 });
    if (!fs.existsSync(path.join(tmp, "r.pdf"))) return t.skip("LibreOffice לא הפיק PDF: " + (cv.error ? cv.error.message : String(cv.stderr).slice(0, 120)));
    const bb = spawnSync("pdftotext", ["-bbox", path.join(tmp, "r.pdf"), path.join(tmp, "r.html")], { encoding: "utf8" });
    assert.equal(bb.status, 0, "pdftotext");
    const html = fs.readFileSync(path.join(tmp, "r.html"), "utf8"), re = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="[\d.]+" yMax="[\d.]+">([^<]*)<\/word>/g;
    let line = null;
    for (const pg of html.split("<page ").slice(1)) {
      const ws = [...pg.matchAll(re)].map(m => ({ x: +m[1], y: +m[2], t: m[3] })), id = ws.find(w => w.t === "C0010/26");
      if (id) { line = ws.filter(w => Math.abs(w.y - id.y) < 2).sort((a, b) => a.x - b.x); break; }
    }
    assert.ok(line, "שורת הנוטם C0010/26 ב-PDF");
    const x = tx => { const w = line.find(v => v.t === tx); assert.ok(w, "חסר בשורה: " + tx + " | " + line.map(v => v.t).join(" ")); return w.x; };
    // הקריאה מימין לשמאל: "N. C0010/26 — 1.5 ק״מ" — כלומר חזותית משמאל לימין: ק״מ, 1.5, —, מזהה, ואז המספור (הספרה הכי ימנית)
    assert.ok(x("1.5") < x("—") && x("—") < x("C0010/26"), "המזהה לפני המקף והמרחק (בקריאה מימין לשמאל): " + line.map(v => v.t).join(" "));
    assert.ok(line.some(w => (w.t === "1" || w.t === "1.") && w.x > x("C0010/26")), "המספור 1. מימין למזהה, בתחילת השורה: " + line.map(v => v.t).join(" "));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("Word: תאריך סיור בלי הערות מופיע בסעיף 'הנקודה' (והערות עם תאריך — בנוסח הקיים)", async () => {
  const data = mkData(fixture("yarkon")), BID = new RegExp("[" + fcc(0x202a, 0x202c, 0x200f) + "]", "g");
  const lines = async inp => { const model = O.docxModel(C.analyze(Object.assign({}, baseInput, inp), data, cfg, now), data, cfg, { includeChecks: true }), z = await JSZipNode.loadAsync(await D.build(model)); return { model, lines: (await z.file("word/document.xml").async("string")).replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "").replace(BID, "").split("\n") }; };
  const dateOnly = await lines({ visitDate: "2026-10-15", visitNotes: "" });
  assert.equal(dateOnly.model.visitNote, "<b>סיור באתר ב-15.10.2026</b>");
  const i = dateOnly.lines.indexOf("1. הנקודה"); assert.ok(i >= 0 && dateOnly.lines[i + 2] === "סיור באתר ב-15.10.2026", dateOnly.lines.slice(i, i + 4).join(" | "));
  assert.ok(!dateOnly.lines.some(l => /^הערות המבקש/.test(l)));
  const none = await lines({ visitDate: "", visitNotes: "" }); assert.equal(none.model.visitNote, ""); assert.ok(!none.lines.some(l => /סיור באתר/.test(l)));
  const both = await lines({ visitDate: "2026-10-15", visitNotes: "תצפית" }); assert.ok(both.lines.includes("הערות המבקש (סיור באתר ב-15.10.2026): תצפית"));
});

/* ---------- מהות הפעילות: טקסט חופשי (מהויות שהמשתמש מוסיף ב-ui.js ונשמרות בדפדפן), לא רק הרשימה שב-config.json ---------- */
const puErrs = p => C.validateInput(Object.assign({}, baseInput, { purpose: p }), cfg).filter(e => e.field === "purpose");

test("אימות מהות הפעילות: מהות מותאמת תקינה; ריקה, רווחים, לא-מחרוזת, 81 תווים ותווי בקרה נדחות", () => {
  // לפני השינוי נדרשה מהות מתוך cfg.purposes; עכשיו כל מחרוזת תקינה מתקבלת (תנאי הבדיקה: המהות המותאמת אינה ברשימה)
  const custom = ["לצורך הדרכת טייסים חדשים", "Survey of a roof", 'לצורך <b>x</b> & "y"', "  מהות עם רווחים בקצוות  ", "לצורך " + fcc(0xd83d, 0xde00)];
  custom.forEach(p => assert.ok(!cfg.purposes.includes(p), p));
  for (const p of cfg.purposes.concat(custom)) assert.deepEqual(C.validateInput(Object.assign({}, baseInput, { purpose: p }), cfg), [], "בלי שום שגיאה: " + p);
  // ריקה / רווחים בלבד / לא מחרוזת — נדחות בהודעה הקיימת, שגיאה אחת בשדה purpose
  for (const p of ["", "   ", "\t\n", undefined, null, 0, 5, true, [], ["לצורך צילום"], {}, { toString: () => "לצורך צילום" }]) {
    const e = puErrs(p); assert.equal(e.length, 1, JSON.stringify(p)); assert.equal(e[0].msg, "יש לבחור מהות פעילות");
  }
  // אורך: 80 תווים תקין, 81 נדחה; רווחי קצה אינם נספרים (הם נחתכים ב-trim לפני הבדיקה)
  assert.equal(puErrs("א".repeat(80)).length, 0);
  const long = puErrs("א".repeat(81)); assert.equal(long.length, 1); assert.match(long[0].msg, /80/);
  assert.equal(puErrs(" " + "א".repeat(80) + " ").length, 0);
  assert.equal(puErrs("א".repeat(40) + " ".repeat(10) + "ב".repeat(40)).length, 1, "רווחים פנימיים נספרים: 90 תווים");
  // תווים אסורים: בקרה (NUL, טאב, שורה חדשה, CR, ESC), DEL, C1 (NEL), מפרידי שורה/פסקה, חצי סרוגייט בודד (שהיה גורם ל-encodeURIComponent של המייל לזרוק) ו-U+FFFE/FFFF
  for (const c of [0, 9, 10, 13, 27, 0x7f, 0x85, 0x9f, 0x2028, 0x2029, 0xd800, 0xdc00, 0xfffe, 0xffff]) {
    const e = puErrs("לצורך" + fcc(c) + "צילום"); assert.equal(e.length, 1, "U+" + c.toString(16)); assert.match(e[0].msg, /תווים לא תקינים/);
  }
  assert.equal(puErrs("לצורך צילום" + fcc(10)).length, 1, "תו בקרה בסוף נדחה גם כש-trim היה מסיר אותו");
  assert.equal(puErrs(fcc(0xd800) + "לצורך").length, 1, "חצי סרוגייט בודד בתחילת המחרוזת");
  assert.equal(puErrs("לצורך " + fcc(0xd83d, 0xde00)).length, 0, "זוג סרוגייט תקין (אמוג'י) מתקבל");
  // הבקשה עם מהות מותאמת אינה מקבלת שגיאות אחרות, וכל השדות האחרים עדיין נבדקים
  assert.deepEqual(C.validateInput(Object.assign({}, baseInput, { purpose: "מהות חדשה", aircraft: [] }), cfg).map(e => e.field), ["aircraft"]);
});


test("מהות מותאמת (גם עוינת) זורמת לשדה 4, למייל ול-Word כטקסט בלבד: escape ב-HTML, XML תקין, בלי הזרקה", async () => {
  const data = mkData(fixture("yarkon")), BID = new RegExp("[" + fcc(0x202a, 0x202c, 0x200f) + "]", "g");
  const hostile = ["<img src=x onerror=1>", "]]>", "</w:t>", "<script>alert(1)</script> & \"q\" 'r'", "&lt;b&gt;&amp;lt;", "<![CDATA[ x ]]> <?xml?>", "לצורך הדרכה " + fcc(0xd83d, 0xde00), "לצורך מיפוי חקלאי (מותאם)"];
  for (const p of hostile) {
    const inp = Object.assign({}, baseInput, { purpose: p });
    assert.deepEqual(C.validateInput(inp, cfg), [], "מהות עוינת היא טקסט תקין: " + p);
    const res = C.analyze(inp, data, cfg, now), row = O.buildForm(res, cfg)[3];
    // שדה 4 בטופס: ה-HTML escaped (אין תו מסוכן גולמי), והטקסט הוא המהות כלשונה
    assert.equal(row.label, "מהות הפעילות המבוקשת"); assert.equal(row.html, C.esc(p)); assert.ok(!/[<>"]/.test(row.html), "HTML גולמי: " + row.html);
    assert.equal(row.text, p, "טקסט שדה 4");
    // מייל: שורה אחת בגוף, וגם בקישור mailto (אחרי פענוח)
    const m = O.mail(res, cfg);
    assert.ok(m.body.split("\n").includes("מהות הפעילות: " + p), "גוף המייל: " + p);
    assert.equal(decodeURIComponent(m.mailto.split("&body=")[1]), m.body, "mailto מקודד את הגוף במלואו");
    // Word: XML מאוזן ותקין, ללא תגית מוזרקת, והטקסט נשמר כלשונו אחרי פענוח ה-entities
    const model = O.docxModel(res, data, cfg, { includeChecks: true }), z = await JSZipNode.loadAsync(await D.build(model)), xml = await z.file("word/document.xml").async("string");
    assert.ok(wellFormed(xml), "Word: XML מאוזן"); assert.ok(!XML_BAD.test(xml.replace(fcc(0xd83d, 0xde00), "")), "Word: תו אסור ב-XML");
    assert.equal((xml.match(/<w:t[ >]/g) || []).length, (xml.match(/<\/w:t>/g) || []).length, "Word: כל <w:t> נסגר פעם אחת (אין הזרקת </w:t>)");
    assert.ok(!/<img|<script|<!\[CDATA\[|<\?xml\?>/.test(xml.replace(/^<\?xml[^>]*\?>/, "")) && !xml.includes("]]>"), "Word: תגית מוזרקת");
    const lint = xmllint(xml); if (lint !== null) assert.equal(lint, "", "xmllint: " + lint);
    const plain = xml.replace(/<[^>]+>/g, "").replace(BID, "").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    assert.ok(plain.includes(p), "Word: המהות כלשונה — " + p);
    // KML אינו נושא מהות (אין לה שם בקובץ): לפחות אינו נשבר
    const lintK = xmllint(O.kml(res, data, cfg)); if (lintK !== null) assert.equal(lintK, "", "KML: " + lintK);
  }
  // הגנה לעומק: גם אם תווי XML אסורים (U+FFFE, בקרה) היו מגיעים למהות (האימות דוחה אותם), ה-Word נשאר XML תקין
  const dirtyP = "א" + fcc(0xfffe) + "ב" + fcc(0xb) + "ג", resD = C.analyze(Object.assign({}, baseInput, { purpose: dirtyP }), data, cfg, now);
  const xmlD = await (await JSZipNode.loadAsync(await D.build(O.docxModel(resD, data, cfg, { includeChecks: false })))).file("word/document.xml").async("string");
  assert.ok(!XML_BAD.test(xmlD) && xmlD.includes("אבג"), "Word: תווים אסורים במהות מנוקים");
});

/* ===== עצמאות המבקש: שם הגורם המבקש (שדה 2), אות קריאה (שדה 13) ומס׳ רישום (שדה 14) נקבעים על ידי המבקש — אין עוד ערכים קבועים של הארגון ===== */
const ofErrs = (o, f) => C.validateInput(Object.assign({}, baseInput, o), cfg).filter(e => e.field === f);

test("config.json: אין בלוק org (שם, רישום, אות קריאה); הנוסח ״לא רלוונטי״ של שדות 13 ו-14 הוא fixed.not_relevant", () => {
  assert.equal(cfg.org, undefined, "הגדרות הארגון הוסרו");
  assert.ok(!/הארגון הישראלי לרב להב|"ICD"/.test(JSON.stringify(cfg)), "אין שם ארגון קבוע בהגדרות");
  assert.equal(cfg.fixed.not_relevant, "לא רלוונטי");
});

test("אימות שם הגורם המבקש (שדה 2): חובה; אחרי trim; עד 80 תווים; בלי תווי בקרה, חצי סרוגייט ותווים אסורים ב-XML", () => {
  assert.deepEqual(C.validateInput(baseInput, cfg), [], "baseInput תקין עם גורם מבקש");
  // חסר / רווחים / לא מחרוזת: שגיאה אחת בשדה requesterOrg
  for (const v of [undefined, null, "", "   ", "\t \n", 0, 5, true, [], ["חברה"], {}, { toString: () => "חברה" }]) {
    const e = ofErrs({ requesterOrg: v }, "requesterOrg"); assert.equal(e.length, 1, JSON.stringify(v)); assert.equal(e[0].msg, "יש להזין את שם הגורם המבקש");
  }
  // אורך אחרי trim: 80 תקין, 81 נדחה, רווחי קצה לא נספרים, רווחים פנימיים נספרים
  assert.equal(ofErrs({ requesterOrg: "א".repeat(80) }, "requesterOrg").length, 0);
  const long = ofErrs({ requesterOrg: "א".repeat(81) }, "requesterOrg"); assert.equal(long.length, 1); assert.match(long[0].msg, /80/);
  assert.equal(ofErrs({ requesterOrg: "  " + "א".repeat(80) + "  " }, "requesterOrg").length, 0);
  assert.equal(ofErrs({ requesterOrg: "א".repeat(40) + " ".repeat(10) + "ב".repeat(40) }, "requesterOrg").length, 1);
  // תווים אסורים: בקרה, DEL, C1, מפרידי שורה/פסקה, חצי סרוגייט בודד, U+FFFE/FFFF — גם בקצה (trim לא מסתיר אותם)
  for (const c of [0, 9, 10, 13, 27, 0x7f, 0x85, 0x9f, 0x2028, 0x2029, 0xd800, 0xdc00, 0xfffe, 0xffff]) {
    const e = ofErrs({ requesterOrg: "חברת" + fcc(c) + "בדיקה" }, "requesterOrg"); assert.equal(e.length, 1, "U+" + c.toString(16)); assert.match(e[0].msg, /תווים לא תקינים/);
  }
  assert.equal(ofErrs({ requesterOrg: "חברה" + fcc(10) }, "requesterOrg").length, 1, "תו בקרה בסוף");
  assert.equal(ofErrs({ requesterOrg: fcc(0xd800) + "חברה" }, "requesterOrg").length, 1, "חצי סרוגייט בתחילה");
  // טקסט חופשי תקין: אותיות לטיניות, מספרים, מירכאות, גרשיים ואמוג'י (זוג סרוגייט תקין); גם תווי HTML/XML (נוטרלים בפלט — ראו הבדיקות למטה)
  for (const v of ["Dana Levi Aerial Ltd.", "חברת ״הרחפן״ בע״מ", "מטיס פרטי — יוסי", 'א<ב>&"ג\'', "חברה " + fcc(0xd83d, 0xde00)]) assert.equal(ofErrs({ requesterOrg: v }, "requesterOrg").length, 0, v);
  // האימות אינו נוגע בשאר השדות, וכל שדה אחר עדיין נבדק
  assert.deepEqual(C.validateInput(Object.assign({}, baseInput, { requesterOrg: "", aircraft: [] }), cfg).map(e => e.field).sort(), ["aircraft", "requesterOrg"]);
  assert.equal(C.ORG_MAX, 80); assert.equal(C.ID_MAX, 40);
});

test("אימות אות קריאה ומס׳ רישום (שדות 13 ו-14): אופציונליים; עד 40 תווים; בלי תווים אסורים", () => {
  for (const f of ["callsign", "registration"]) {
    for (const v of [undefined, null, "", "   ", "4X-ABC", "ICD", "א".repeat(40), " " + "א".repeat(40) + " ", "Callsign " + fcc(0xd83d, 0xde00)]) assert.equal(ofErrs({ [f]: v }, f).length, 0, f + ": " + JSON.stringify(v));
    const long = ofErrs({ [f]: "x".repeat(41) }, f); assert.equal(long.length, 1, f); assert.match(long[0].msg, /40/);
    for (const c of [0, 9, 10, 0x7f, 0x85, 0x2028, 0xd800, 0xfffe, 0xffff]) { const e = ofErrs({ [f]: "ab" + fcc(c) + "cd" }, f); assert.equal(e.length, 1, f + " U+" + c.toString(16)); assert.match(e[0].msg, /תווים לא תקינים/); }
    for (const v of [5, true, [], {}]) assert.equal(ofErrs({ [f]: v }, f).length, 1, f + ": ערך שאינו מחרוזת נדחה " + JSON.stringify(v));
  }
  // שגיאת אות הקריאה אינה מוצמדת לשדה אחר
  assert.deepEqual(C.validateInput(Object.assign({}, baseInput, { callsign: "x".repeat(41), registration: "y".repeat(41) }), cfg).map(e => e.field).sort(), ["callsign", "registration"]);
});

test("n=10: ערך שכולו תווים בלתי נראים — שם הגורם והשם נחשבים חסרים, ואות קריאה/מס׳ רישום נדחים (ריק או רווחים בלבד עדיין מותרים)", () => {
  // RLM, ZWSP, LRM, WJ, מילוי הנגול U+3164, בריילי ריק U+2800, בורר וריאציה, CGJ, ושילוב של כמה מהם — כולם עוברים trim() אבל נראים ריקים בטופס, ב-Word ובמייל
  const invis = [0x200f, 0x200b, 0x200e, 0x2060, 0x3164, 0x2800, 0xfe0f, 0x34f, 0x115f, 0xffa0].map(c => fcc(c)).concat([fcc(0x200f, 0x200b, 0x2060), " " + fcc(0x200f) + " ", fcc(0x200b).repeat(30)]);
  for (const v of invis) {
    const o = ofErrs({ requesterOrg: v }, "requesterOrg"); assert.equal(o.length, 1, "גורם U+" + v.codePointAt(0).toString(16)); assert.equal(o[0].msg, "יש להזין את שם הגורם המבקש");
    assert.equal(ofErrs({ requesterName: v }, "requester").length, 1, "שם מבקש U+" + v.codePointAt(0).toString(16));
    for (const f of ["callsign", "registration"]) { const e = ofErrs({ [f]: v }, f); assert.equal(e.length, 1, f + " U+" + v.codePointAt(0).toString(16)); assert.match(e[0].msg, /תו גלוי/); }
  }
  // עם טקסט גלוי לצד התו הבלתי נראה (הדבקה מ-RTL, למשל) — תקין
  for (const c of [0x200f, 0x200b, 0x2060, 0x3164]) {
    const v1 = fcc(c) + "חברה", v2 = "חברה" + fcc(c), v3 = "חב" + fcc(c) + "רה";
    for (const v of [v1, v2, v3]) { assert.equal(ofErrs({ requesterOrg: v }, "requesterOrg").length, 0, v); assert.equal(ofErrs({ requesterName: v }, "requester").length, 0, v); assert.equal(ofErrs({ callsign: v }, "callsign").length, 0, v); assert.equal(ofErrs({ registration: v }, "registration").length, 0, v); }
  }
  // ריק / רווחים / חסר נשארים אופציונליים באות קריאה וברישום (הפלט ״לא רלוונטי״), וחובה בשם הגורם
  for (const v of [undefined, null, "", "   ", "\t \n"]) { for (const f of ["callsign", "registration"]) assert.equal(ofErrs({ [f]: v }, f).length, 0, f + JSON.stringify(v)); }
  assert.equal(ofErrs({ requesterOrg: "   " }, "requesterOrg").length, 1);
  // שגיאה אחת בלבד לכל שדה, וההודעה על תו בקרה נשארת (בקרה עם טקסט גלוי = ״תווים לא תקינים״, לא ״תו גלוי״)
  assert.match(ofErrs({ callsign: "ab" + fcc(1) + "cd" }, "callsign")[0].msg, /תווים לא תקינים/);
  assert.match(ofErrs({ requesterOrg: fcc(1) }, "requesterOrg")[0].msg, /תווים לא תקינים|יש להזין/);
});

test("אחסון לפי משתמש (n=7/8/16): sha256Hex זהה ל-crypto של node; userHash סינכרוני, קצר, יציב וייחודי; שם המשתמש לא נכנס למפתח; בלי משתמש אין מפתח", () => {
  for (const t of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "dana.pilot", "שלום עולם", "x".repeat(2000), fcc(0xd83d, 0xde00)]) assert.equal(C.sha256Hex(t), crypto.createHash("sha256").update(t, "utf8").digest("hex"), JSON.stringify(t.slice(0, 20)));
  const names = Array.from({ length: 100 }, (_, i) => "pilot." + i), hs = names.map(C.userHash);
  assert.equal(new Set(hs).size, 100, "מאה משתמשים — מאה גיבובים שונים");
  assert.ok(hs.every(h => /^[0-9a-f]{16}$/.test(h)), "16 תווי hex");
  assert.equal(C.userHash("dana.pilot"), C.userHash("dana.pilot"), "יציב");
  assert.notEqual(C.userHash("Dana"), C.userHash("dana"), "שמות משתמש רגישי רישיות בשרת — גם הגיבוב");
  const k = C.userKey("icd_req_person_v1", "dana.pilot");
  assert.ok(k.startsWith("icd_req_person_v1:") && k.length === "icd_req_person_v1:".length + 16 && !k.includes("dana"), k);
  assert.equal(C.userKey("icd_req_person_v1", "dana.pilot"), k); assert.notEqual(C.userKey("icd_req_person_v1", "dave.pilot"), k);
  assert.notEqual(C.userKey("icd_req_aircraft_v1", "dana.pilot"), C.userKey("icd_req_person_v1", "dana.pilot"));
  for (const bad of ["", null, undefined]) assert.equal(C.userKey("icd_req_person_v1", bad), "", "בלי משתמש — אין מפתח (הקורא לא קורא ולא כותב)");
});

test("הטופס: שדה 2 = הגורם שהוקלד; שדות 13 ו-14 = מה שהוקלד, וריק/רווחים => ״לא רלוונטי״; אין שם ארגון או ״ICD״ קבועים באף פלט", async () => {
  const data = mkData(fixture("yarkon")), org = "דנה לוי — צילום אווירי", res = C.analyze(Object.assign({}, baseInput, { requesterOrg: "  " + org + "  ", callsign: " רב-להב 7 ", registration: "4X-ABC" }), data, cfg, now);
  const rows = O.buildForm(res, cfg);
  assert.equal(rows[1].label, "שם/גורם המבקש"); assert.equal(rows[1].text, org, "שדה 2 אחרי trim");
  assert.equal(rows[12].label, "אות קריאה"); assert.equal(rows[12].text, "רב-להב 7");
  assert.equal(rows[13].label, "מס׳ רישום כלי הטיס"); assert.equal(rows[13].text, "4X-ABC");
  // ריק / רווחים / חסר => ״לא רלוונטי״ (שינוי ברירת מחדל: בעבר שדה 14 היה ״ICD״ קבוע)
  for (const v of [undefined, null, "", "   "]) { const r = O.buildForm(C.analyze(Object.assign({}, baseInput, { callsign: v, registration: v }), data, cfg, now), cfg); assert.equal(r[12].text, "לא רלוונטי", JSON.stringify(v)); assert.equal(r[13].text, "לא רלוונטי", JSON.stringify(v)); }
  // ארגון אחר => שדה 2 אחר; שני מבקשים באותה מערכת אינם חולקים שום ערך קבוע
  const other = O.buildForm(C.analyze(Object.assign({}, baseInput, { requesterOrg: "חברה אחרת" }), data, cfg, now), cfg);
  assert.equal(other[1].text, "חברה אחרת"); assert.notEqual(other[1].text, rows[1].text);
  // אין ברירת מחדל גם בלי הערך (הפלט לא ממציא ארגון); האימות הוא שחוסם
  assert.ok(!/הארגון הישראלי|לרב להב|ICD/.test(O.buildForm(C.analyze(Object.assign({}, baseInput, { requesterOrg: "" }), data, cfg, now), cfg).map(r => r.text).join("\n")), "בלי ארגון קבוע");
  // כל הפלטים כולם (טופס, דף בדיקות, מייל, KML, Word) נקיים מהשם הקבוע
  const all = [rows.map(r => r.text).join("\n"), O.buildChecks(res, data, cfg).map(r => r.join(" ")).join("\n"), O.mail(res, cfg).body, O.kml(res, data, cfg), JSON.stringify(O.docxModel(res, data, cfg, { includeChecks: true }).rows)].join("\n");
  assert.ok(!/הארגון הישראלי לרב להב|ICD/.test(all.replace(/ICD[A-Z0-9]/g, "")), "אין ״הארגון הישראלי לרב להב״ או ״ICD״ בשום פלט");
});

test("מייל: ״שם/גורם המבקש״ והחתימה לפי הגורם שהוקלד (בלי ארגון קבוע); mailto מקודד אותם במלואם", () => {
  const data = mkData(fixture("yarkon")), org = 'חברת "אלפא" & בטא', res = C.analyze(Object.assign({}, baseInput, { requesterOrg: org, requesterName: "דנה לוי", requesterPhone: "050-1234567" }), data, cfg, now), m = O.mail(res, cfg), lines = m.body.split("\n");
  assert.ok(lines.includes("שם/גורם המבקש: " + org), "שורת הגורם המבקש");
  const i = lines.indexOf("בברכה,"); assert.ok(i > 0); assert.deepEqual(lines.slice(i, i + 4), ["בברכה,", "דנה לוי", org, "050-1234567"], "חתימה: שם, גורם, טלפון");
  assert.ok(!/הארגון הישראלי|לרב להב/.test(m.body));
  assert.equal(decodeURIComponent(m.mailto.split("&body=")[1]), m.body, "mailto מקודד את הגוף במלואו");
  // כתובות היעד נשארות לפי הנוהל, בלי קשר לגורם המבקש (הנמענים בפועל נקבעים בשרת)
  assert.deepEqual(m.to, ["notamoffice@iaa.gov.il", "nofm@iaa.gov.il"]);
});

test("Word: הגורם המבקש בשדה 2 ובמאפיין יוצר המסמך (core.xml); ערך עוין נשאר טקסט, ה-XML תקין ובלי הזרקה", async () => {
  const data = mkData(fixture("yarkon")), BID = new RegExp("[" + fcc(0x202a, 0x202c, 0x200f) + "]", "g");
  const build = async over => { const res = C.analyze(Object.assign({}, baseInput, over), data, cfg, now), model = O.docxModel(res, data, cfg, { includeChecks: true }), z = await JSZipNode.loadAsync(await D.build(model));
    return { model, doc: await z.file("word/document.xml").async("string"), core: await z.file("docProps/core.xml").async("string") }; };
  const plainOf = xml => xml.replace(/<[^>]+>/g, "").replace(BID, "").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const ok = await build({ requesterOrg: "דנה לוי — צילום אווירי", callsign: "רב-להב 7", registration: "4X-ABC" });
  assert.equal(ok.model.creator, "דנה לוי — צילום אווירי", "יוצר המסמך = הגורם המבקש (לא ארגון קבוע)");
  assert.match(ok.core, /<dc:creator>דנה לוי — צילום אווירי<\/dc:creator>/);
  const p = plainOf(ok.doc); assert.ok(p.includes("דנה לוי — צילום אווירי") && p.includes("רב-להב 7") && p.includes("4X-ABC") && !p.includes("ICD"));
  // ערך עוין בשלושת השדות: escape ב-XML, בלי תגית מוזרקת, וה-XML מאוזן ועובר xmllint
  const bad = "<img src=x onerror=1> & ]]> </w:t><w:t>";
  const hostile = await build({ requesterOrg: bad, callsign: bad.slice(0, 30), registration: "<b>r</b>" });
  for (const xml of [hostile.doc, hostile.core]) {
    assert.ok(wellFormed(xml), "XML מאוזן"); assert.ok(!XML_BAD.test(xml), "תו אסור ב-XML");
    const lint = xmllint(xml); if (lint !== null) assert.equal(lint, "", "xmllint: " + lint);
  }
  assert.equal((hostile.doc.match(/<w:t[ >]/g) || []).length, (hostile.doc.match(/<\/w:t>/g) || []).length, "כל <w:t> נסגר פעם אחת");
  assert.ok(!/<img|<w:t><w:t>/.test(hostile.doc) && !hostile.doc.includes("]]>"), "תגית מוזרקת");
  assert.ok(plainOf(hostile.doc).includes(bad), "הטקסט העוין נשמר כלשונו כטקסט");
  assert.ok(hostile.core.includes("&lt;img src=x onerror=1&gt; &amp; ]]&gt;"), "core.xml: escape");
  // הגנה לעומק: תווים אסורים ב-XML שהיו מגיעים לשדה (האימות דוחה אותם) מנוקים ב-Word
  const dirty = await build({ requesterOrg: "א" + fcc(0xfffe) + "ב" + fcc(0xb) + "ג", callsign: "ד" + fcc(1) + "ה", registration: "ו" + fcc(0xffff) + "ז" });
  assert.ok(!XML_BAD.test(dirty.doc) && !XML_BAD.test(dirty.core) && plainOf(dirty.doc).includes("אבג") && plainOf(dirty.doc).includes("דה") && plainOf(dirty.doc).includes("וז"), "תווים אסורים מנוקים");
});

/* ---------- תיקוני סקירה: מהות בלי תווים גלויים (ממצא 4), אורך בנקודות קוד (ממצא 5), אזור בלי שם (ממצא 15) ---------- */
test("ממצא 4: מהות שכולה תווים בלתי נראים נדחית (RLM, ZWSP, LRM, WJ, SHY, מילוי הנגול, בריילי ריק, CGJ, בוררי וריאציה…) — גם בשילוב עם רווחים; מהות עם תו גלוי אחד מתקבלת", () => {
  const invisible = [0x200f, 0x200b, 0x200e, 0x2060, 0xad, 0x202e, 0x202a, 0x3164, 0x2800, 0x115f, 0x1160, 0xffa0, 0x34f, 0x180e, 0xfe0f, 0xfeff, 0xa0, 0x2003, 0x2064];
  for (const c of invisible) {
    assert.equal(C.purposeHasVisible(fcc(c)), false, "U+" + c.toString(16));
    const e = puErrs(fcc(c)); assert.equal(e.length, 1, "U+" + c.toString(16)); assert.equal(e[0].msg, "יש לבחור מהות פעילות");
    assert.equal(puErrs("  " + fcc(c) + " " + fcc(c, c) + "\t").length, 1, "בשילוב עם רווחים: U+" + c.toString(16));
  }
  assert.equal(puErrs(invisible.map(c => fcc(c)).join("")).length, 1, "כל הבלתי נראים יחד");
  assert.equal(C.purposeHasVisible(fcc(0xd83d, 0xde00)), true, "אמוג'י הוא תו גלוי");
  for (const ok of ["א", fcc(0x200f) + "א", "x" + fcc(0x200b), "1", "-", fcc(0x3164) + "ב" + fcc(0x2800)]) { assert.equal(C.purposeHasVisible(ok), true, JSON.stringify(ok)); assert.equal(puErrs(ok).length, 0, JSON.stringify(ok)); }
  assert.equal(C.purposeHasVisible(null), false); assert.equal(C.purposeHasVisible(undefined), false); assert.equal(C.purposeHasVisible(""), false);
});

test("ממצא 5: אורך המהות נספר בנקודות קוד — 80 אמוג'י תקינים, 81 נדחים בהודעה; ui.js ו-index.html מאפשרים הדבקה עד 4×80 כדי שהדחייה תגיע למשתמש ולא תיחתך בשקט", () => {
  const e = fcc(0xd83d, 0xde00);
  assert.equal(C.purposeLen(e.repeat(80)), 80); assert.equal(puErrs(e.repeat(80)).length, 0, "80 אמוג'י (160 יחידות UTF-16) תקינים");
  const over = puErrs(e.repeat(81)); assert.equal(over.length, 1); assert.match(over[0].msg, /80/);
  assert.equal(C.PURPOSE_MAX, 80);
  const html = fs.readFileSync(path.join(ROOT, "members-k38p/requests/index.html"), "utf8"); assert.match(html, /id="puNew" maxlength="320"/, "4×PURPOSE_MAX: הדבקה של 81–320 תווים מגיעה להודעת הדחייה");
  const ui = fs.readFileSync(path.join(ROOT, "members-k38p/requests/js/ui.js"), "utf8"); assert.match(ui, /C\.purposeLen\(name\) > PURPOSE_MAX/); assert.match(ui, /!C\.purposeHasVisible\(name\)/); assert.match(ui, /C\.purposeHasVisible\(n\) && C\.purposeLen\(n\) <= PURPOSE_MAX/, "גם ערך שמור ב-localStorage נבדק בטעינה");
});

test("ממצא 15: אזור בלי שם (LLR107/120/601 בנתונים) — התווית היא המזהה בלבד, בלי ״״ ריקות, בכל מקום שבו analyzeZones מפיקה תווית (דוח, KML, מייל)", () => {
  const noName = zones.zones.filter(z => !z.name && z.cat !== "B09" && z.cat !== "B09B"); assert.ok(noName.length >= 3, "בנתונים יש אזורים בלי שם: " + noName.map(z => z.id));
  for (const z of noName) {
    const c = z.rings ? z.rings[0][0] : z.c, P = new C.Proj(c[0], c[1]), r = C.analyzeZones(P, 100, { zones: [z], inpa: { sites: [] } }, 1000);
    const hit = r.inside.concat(r.near).find(x => x.id === z.id); assert.ok(hit, z.id + " נמצא"); assert.equal(hit.label, z.id); assert.ok(!hit.label.includes("״״"));
  }
  const named = zones.zones.find(z => z.name && z.cat !== "B09" && z.cat !== "B09B"), c = named.rings ? named.rings[0][0] : named.c;
  const rn = C.analyzeZones(new C.Proj(c[0], c[1]), 100, { zones: [named], inpa: { sites: [] } }, 1000), hn = rn.inside.concat(rn.near).find(x => x.id === named.id);
  assert.equal(hn.label, named.id + " ״" + named.name + "״", "אזור עם שם — כמו תמיד");
});

/* ---------- סבב 4 (לקוח): התנתקות מאפסת ונועלת (n=9), ניווט היסטוריה (n=10), הודעות תחזוקה ותמיכה (n=11/12), בלי כלי טיס מסומן מראש (n=15), הרשמה (n=17/18) ---------- */
// auth.js נטען ללא דפדפן: window / document מדומים (הקובץ נוגע ב-DOM רק בתוך פונקציות)
const loadAuth = c => { const win = {}; new Function("window", "document", fs.readFileSync(path.join(ROOT, "members-k38p/requests/js/auth.js"), "utf8"))(win, {}); win.ReqAuth.setConfig(c); return win.ReqAuth; };
const REQ_DIR = "members-k38p/requests/", readReq = f => fs.readFileSync(path.join(ROOT, REQ_DIR, f), "utf8");

test("n=12: config.json מגדיר support_email תקין (כתובת מייל בלבד)", () => {
  assert.equal(typeof cfg.support_email, "string");
  assert.match(cfg.support_email, /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63}){1,5}$/);
  assert.equal(cfg.support_email, "office@icd.org.il", "הכתובת שהוגדרה ממתינה לאישור המנהל");
});

test("n=12: כתובת התמיכה מצורפת להודעות הפניה (תמיכה / מנהל המערכת / משרד הארגון) בלבד, פעם אחת, ורק אם היא כתובת מייל תקינה", () => {
  const A = loadAuth({ support_email: "office@icd.org.il" }), E = "office@icd.org.il";
  assert.equal(A.supportEmail(), E);
  assert.equal(A.withSupport("אם הבעיה חוזרת, פנו לתמיכה."), "אם הבעיה חוזרת, פנו לתמיכה: " + E + ".");
  assert.equal(A.withSupport("יש לפנות למנהל המערכת."), "יש לפנות למנהל המערכת: " + E + ".");
  assert.equal(A.withSupport("יש לפנות למשרד הארגון."), "יש לפנות למשרד הארגון: " + E + ".");
  assert.equal(A.withSupport(A.withSupport("פנו לתמיכה.")), "פנו לתמיכה: " + E + ".", "לא מצורפת פעמיים");
  assert.equal(A.withSupport("שם משתמש או סיסמה שגויים."), "שם משתמש או סיסמה שגויים.", "הודעה בלי הפניה — ללא שינוי");
  // ההודעות עצמן, דרך msg: מטיס רגיל (role ריק) ומנהל
  for (const code of ["blocked", "mail_quota", "not_configured", "not_ready", "missing_files", "no_owner"]) assert.ok(A.msg({ error: code }).includes(E), code + " כולל את כתובת התמיכה");
  assert.ok(!A.msg({ error: "bad_login" }).includes(E), "שגיאה בלי הפניה לתמיכה — בלי כתובת");
  assert.ok(/פנו לתמיכה: office@icd\.org\.il/.test(A.msg({ error: "no_owner" })), "נוסח המטיס ל-no_owner");
});

test("n=12: ערך support_email לא תקין (HTML, סכמה, רווחים, חסר) לא מוצג ולא משנה הודעות (נכשל סגור)", () => {
  for (const bad of ["", "x", "a b@c.d", 'a@b.c"><img src=x onerror=alert(1)>', "javascript:alert(1)", "<x@y.z>", "a@b", "mailto:a@b.co", "a@b.co?subject=x", null, 42, undefined]) {
    const A = loadAuth({ support_email: bad });
    assert.equal(A.supportEmail(), "", JSON.stringify(bad));
    assert.equal(A.withSupport("פנו לתמיכה."), "פנו לתמיכה.", JSON.stringify(bad));
    assert.equal(A.msg({ error: "blocked" }), "המשתמש חסום מבקשות טיסה. יש לפנות למנהל המערכת.", JSON.stringify(bad));
  }
  assert.equal(loadAuth(null).supportEmail(), "", "בלי הגדרות");
});

test("n=11: sync.js מסווג כל בעיה — maint (תחזוקה: רק המנהל מטפל) מול user (הודעה שמטיס יכול לפעול לפיה) — ומשאיר את problems כמות שהיא", async () => {
  const SY = require(path.join(ROOT, REQ_DIR, "js/sync.js")), html = fs.readFileSync(path.join(ROOT, "members-k38p/index.html"), "utf8"), meta = J("members-k38p/pamat-meta.json");
  const T = "2026-10-17T06:00:00Z", base = () => ({ html, meta: { ...meta }, zones, cfg, mapNotam: { fetched_iso: T }, notamAll: { fetched_iso: T } });
  const ok = await SY.check(base());
  assert.deepEqual(ok.items, []); assert.deepEqual(ok.problems, []);
  const cases = [
    ["אזורי המפה עודכנו", { ...base(), html: html.replace("const NM=1852;", "const NM=1853;") }, "maint"],
    ["מהדורת פמ״ת חדשה", { ...base(), meta: { ...meta, pamat_update: "9/99", pamat_date: "01 JAN 2099" } }, "maint"],
    ["חסרה מהדורה בהגדרות", { ...base(), cfg: { ...cfg, pmt_editions: {} } }, "maint"],
    ["נוטמים מפגרים", { ...base(), mapNotam: { fetched_iso: "2026-10-17T07:00:00Z" } }, "maint"],
    ["לא ניתן להשוות נוטמים", { ...base(), notamAll: {} }, "maint"],
    ["מבנה המפה השתנה", { ...base(), html: "<html></html>" }, "maint"],
    ["הדף ישן", { ...base(), loaded: { zonesHash: "x".repeat(64), notamIso: T } }, "user"],
    ["הניתוח ישן", { ...base(), analysis: { zonesHash: "y".repeat(64), notamIso: T } }, "user"]
  ];
  for (const [name, inp, kind] of cases) {
    const r = await SY.check(inp);
    assert.ok(!r.ok && r.items.length === r.problems.length && r.items.every((it, i) => it.text === r.problems[i]), name);
    assert.ok(r.items.some(it => it.kind === kind), name + ": " + JSON.stringify(r.items.map(i => i.kind)));
  }
  const mixed = await SY.check({ ...base(), html: html.replace("const NM=1852;", "const NM=1853;"), loaded: { zonesHash: "x".repeat(64), notamIso: T } });
  assert.ok(mixed.items.some(i => i.kind === "maint") && mixed.items.some(i => i.kind === "user"), "תקלה מעורבת");
  assert.ok(mixed.items.filter(i => i.kind === "user").every(i => /טוען אותם מחדש|להריץ את הבדיקות מחדש/.test(i.text)), "הודעות user ניתנות לביצוע על ידי מטיס");
});

test("n=10: כל שדה קלט, טקסט ובחירה ב-main של index.html (וגם השורות והכלים הדינמיים ב-ui.js) עם autocomplete=\"off\"; כפתורי ההפקה מושבתים כברירת מחדל", () => {
  const html = readReq("index.html"), main = html.slice(html.indexOf("<main"), html.indexOf("</main>")), ui = readReq("js/ui.js");
  const ctl = main.match(/<(input|textarea|select)\b[^>]*>/g) || [];
  assert.ok(ctl.length >= 25, "נמצאו " + ctl.length + " שדות");
  assert.deepEqual(ctl.filter(t => !/\bautocomplete="off"/.test(t)), [], "שדה בלי autocomplete=off");
  const ra = ui.slice(ui.indexOf("function renderAircraft"), ui.indexOf("function addAircraft"));
  assert.ok((ra.match(/<input autocomplete="off" type="checkbox"/g) || []).length === 2, "תיבות כלי הטיס הדינמיות");
  assert.ok(/maxlength="' \+ max \+ '" autocomplete="off"/.test(ui), "שורות אנשי קשר ומשתתפים");
  for (const id of ["btnPrint", "btnDocx", "btnKml", "btnAerial", "btnStreet", "btnOverview", "btnRegion", "btnCopy", "btnDrive", "btnSend"]) assert.match(html, new RegExp('<button[^>]*id="' + id + '"[^>]*disabled'), id + " מושבת בקובץ");
  assert.match(html, /<a id="btnMail"[^>]*aria-disabled="true"[^>]*tabindex="-1"|<a id="btnMail"[^>]*tabindex="-1"[^>]*aria-disabled="true"/);
  assert.ok(/id="auUser"[^>]*autocomplete="username"/.test(readReq("js/auth.js")) && /autocomplete="' \+ \(boot \? "new-password" : "current-password"\)/.test(readReq("js/auth.js")), "טופס הכניסה נשאר עם autocomplete של מנהל סיסמאות");
});

test("n=15: אף כלי טיס אינו מסומן מראש — renderAircraft מסמן רק לפי בחירה קיימת; רשימת config.json נשארת (הצעות, ו-selfTest נשען עליה)", () => {
  const ui = readReq("js/ui.js"), ra = ui.slice(ui.indexOf("function renderAircraft"), ui.indexOf("function addAircraft"));
  assert.ok(!/i === 0|dflt/.test(ra), "אין ברירת מחדל לפי אינדקס");
  assert.ok(/const on = name => !!keep && keep\.has\(acKey\(name\)\)/.test(ra), "סימון רק מתוך keep");
  assert.ok(Array.isArray(cfg.aircraft) && cfg.aircraft.length >= 2, "הרשימה נשארת כהצעות");
  assert.ok(/aircraft: \[cfg\.aircraft\[0\]\]/.test(ui), "בדיקה עצמית נשענת על הרשימה");
  assert.deepEqual(C.validateInput(Object.assign({}, baseInput, { aircraft: [] }), cfg).map(e => e.field), ["aircraft"], "בלי בחירה — שגיאת אימות שחוסמת הרצה");
  assert.ok(C.validateInput(Object.assign({}, baseInput, { aircraft: [] }), cfg).some(e => e.msg === "יש לבחור כלי טיס"));
  assert.ok(/אף כלי אינו מסומן מראש/.test(readReq("index.html")), "הסבר בטופס");
});

test("n=9: מבנה — ההתנתקות מאפסת וטוענת מחדש (req-logout → resetPage → location.reload), הנעילה אמיתית (inert), וכל הפקה בודקת התחברות", () => {
  const auth = readReq("js/auth.js"), ui = readReq("js/ui.js");
  const lo = auth.slice(auth.indexOf("function logout("), auth.indexOf("const NOTE_KEY"));
  assert.ok(/setLocked\(true\)/.test(lo) && /new CustomEvent\("req-logout", \{ cancelable: true/.test(lo) && /showCover\(n\)/.test(lo), "logout נועל, מודיע ל-ui.js ורק אם לא טופל מציג כיסוי");
  assert.ok(/setAttribute\("inert", ""\)/.test(auth.slice(auth.indexOf("function setLocked"), auth.indexOf("function setLocked") + 500)) && /aria-hidden/.test(auth.slice(auth.indexOf("function setLocked"), auth.indexOf("function setLocked") + 500)), "נעילה = inert + aria-hidden");
  assert.ok(/if \(!on && document\.body\.classList\.contains\("authLocked"\)\) return;/.test(auth), "סגירת חלון מאוחרת לא משחררת את הנעילה");
  assert.ok(!/classList\.(add|remove)\("authLocked"\)/.test(auth), "authLocked נקבע רק דרך setLocked");
  assert.ok(/ubOut"\)\.onclick = \(\) => logout\(\)/.test(auth) && /A\.logout = \(\) => logout\(\)/.test(auth), "אירוע הלחיצה לא נשלח כהודעה");
  assert.ok(/document\.addEventListener\("req-logout", ev => \{ ev\.preventDefault\(\); resetPage\(\); \}\)/.test(ui), "ui.js מטפל בהתנתקות");
  const rp = ui.slice(ui.indexOf("function resetPage()"), ui.indexOf("function onPageShow"));
  for (const frag of ["S.uk = \"\"", "S.res = null", "S.imgs = {}", "S.sent = null", "S.sendFolder = null", "S.rid = \"\"", "S.statuses.review", "S.statuses.input", "\"osm_near\"", "clearPersonFields", "resetFormFields", "closeModal", "S.resetting"]) assert.ok(rp.includes(frag), "resetPage: " + frag);
  assert.ok(/\} finally \{[\s\S]{0,200}location\.reload\(\);/.test(rp), "הטעינה מחדש תמיד, גם אם שלב נכשל");
  assert.ok(/window\.addEventListener\("pageshow", onPageShow\)/.test(ui) && /ev\.persisted/.test(ui), "pageshow (persisted)");
  for (const fn of ["function download(", "async function downloadDocx(", "async function downloadImg(", "async function copyMail(", "function wipePerson("]) { const i = ui.indexOf(fn); assert.ok(i > 0 && /authed\(\)/.test(ui.slice(i, i + 160)), fn + " בודק התחברות"); }
  assert.ok(/btnPrint"\)\.onclick = \(\) => \{ if \(authed\(\)/.test(ui) && /!S\.ready \|\| !authed\(\)/.test(ui), "הדפסה ו-mailto בודקים התחברות");
});

test("n=11/12/17/18: מבנה — הודעות הסנכרון לפי תפקיד, תמיכה במסכי הכניסה וההרשמה, Enter בהרשמה ותשובה זהה לכל כתובת", () => {
  const ui = readReq("js/ui.js"), auth = readReq("js/auth.js");
  assert.ok(/function pilotProblems\(res\)/.test(ui) && /function renderSyncBanner\(\)/.test(ui) && /const statusMsg = st =>/.test(ui), "ניסוח לפי תפקיד");
  assert.ok(/renderSyncBanner\(\); refreshGate\(\);/.test(ui), "הבאנר והשער מתעדכנים אחרי ההתחברות (התפקיד ידוע רק אז)");
  assert.ok(/הנתונים מתעדכנים כעת; נסו שוב בעוד מספר דקות, ואם זה נמשך פנו לתמיכה\./.test(ui), "הניסוח הניטרלי");
  assert.ok((auth.match(/supportLine\(\)/g) || []).length >= 3, "שורת תמיכה בכניסה, בהרשמה ובמסך השרת");
  assert.ok(/id="rgMember"[^]*האירוע לחברי האתר בלבד/.test(auth), "הסבר דרישת החברות בהרשמה");
  assert.ok(/if \(\$\("rgStep2"\)\.style\.display === "none"\) \{ \$\("rgSend"\)\.click\(\); return; \}/.test(auth), "Enter בשדה המייל שולח קוד");
  const rs = auth.slice(auth.indexOf('$("rgSend").onclick'), auth.indexOf('$("regForm").onsubmit'));
  assert.ok(/אם נמצא כרטיס ששולם עבור הכתובת הזו/.test(rs) && !/r\.(sent|exists|member|registered|ticket|mode)/.test(rs), "הודעת regStart קבועה ואינה תלויה בתשובת השרת מעבר ל-ok");
  for (const f of ["js/auth.js", "js/ui.js", "js/sync.js", "index.html", "config.json"]) assert.ok(!new RegExp(String.fromCharCode(92) + "u[0-9a-fA-F]{4}").test(readReq(f)), f + ": בלי רצפי unicode-escape");
});
