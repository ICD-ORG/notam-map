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

test("נוסח המייל: שורה אחת למצורפים (Word, KML וארבע התמונות, בלי תצ״א נקי); שמות הקבצים נשארים מתחת לתקרת השרת גם לשם ארוך", () => {
  const res = C.analyze(baseInput, mkData(fixture("yarkon")), cfg, now), m = O.mail(res, cfg);
  assert.ok(m.body.split("\n").includes("קבצים מצורפים: טופס הבקשה (Word), קובץ KML וארבע תמונות מפה — תצ״א ומפת רחובות בתקריב, הדמיה וסימונים במבט כללי ומפת אזור מרוחקת."), "שורת המצורפים");
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
  // שדה 8: בסוף השדה, כותרת מודגשת ואחריה פריט בשורה (• לכל שורה שהוקלדה, בלי שורות ריקות), בלי תוצאות הצלבה, ו-HTML מנוטרל
  assert.ok(f[7].html.endsWith("<br><b>מכשולים שידועים למבקש:</b><br>• עגורן בנייה &lt;b&gt;x&lt;/b&gt;<br>• קו מתח<br>• מגדל מים &amp; אחר"), f[7].html.slice(-200));
  assert.ok(f[7].text.includes("מכשולים שידועים למבקש:") && f[7].text.split("\n").some(l => l.trim() === "• קו מתח") || /• קו מתח/.test(f[7].text), f[7].text.slice(-200));
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

test("מייל קצר בנקודות: הנוסח המדויק (יום בודד / כמה ימים), שורות הנקודות פותחות ב-״• ״, ושום פרט שכבר בטופס (כלי טיס, מהות, קואורדינטות, אנשי קשר, משתתפים, מכשולים, סיור) לא במייל", () => {
  const data = mkData(fixture("yarkon")), mailOf = over => O.mail(C.analyze(Object.assign({}, baseInput, over), data, cfg, now), cfg);
  const TAIL = ["", "קבצים מצורפים: טופס הבקשה (Word), קובץ KML וארבע תמונות מפה — תצ״א ומפת רחובות בתקריב, הדמיה וסימונים במבט כללי ומפת אזור מרוחקת.", "כל הפרטים — בטופס המצורף.", "", "בברכה,"];
  const head = ["שלום רב,", "", "מצורפת בקשה לסגירה אווירית על גבי הטופס שבנספח ג׳ לפמ״ת א-11 (עדכון 1/26).", ""];
  const bullets = when => ["• גורם מבקש: חברת הבדיקה בע״מ", "• מיקום: בדיקה", "• מועד: " + when + " 17:00–20:00 (שעון מקומי)", "• סגירה: מעגל ברדיוס 200 מטר · גובה 262.5 רגל (80 מטר) מעפ״ש (AGL)"];
  // כמה ימים: ״, בכל יום״ אחרי הטווח
  const multi = mailOf({});
  assert.equal(multi.body, head.concat(bullets("יום שלישי 20.10.2026 עד יום שישי 23.10.2026, בכל יום")).concat(TAIL, ["בודק", "חברת הבדיקה בע״מ", "050-0000000"]).join("\n"));
  // יום בודד: בלי ״בכל יום״
  const one = mailOf({ dateTo: "2026-10-20" });
  assert.equal(one.body, head.concat(bullets("יום שלישי 20.10.2026")).concat(TAIL, ["בודק", "חברת הבדיקה בע״מ", "050-0000000"]).join("\n"));
  // כל שורת נקודה פותחת ב-״• ״ (U+2022 ורווח) ואין עוד שורה שנראית כנקודה; ארבע נקודות בדיוק
  const lines = multi.body.split("\n"), pts = lines.filter(l => l.startsWith("\u2022 "));
  assert.equal(pts.length, 4); assert.ok(lines.every(l => !/^[-*·●▪]/.test(l)), "רק ״• ״ כסימון נקודה");
  // הנושא והצורה המוחזרת {to, subject, body, mailto} לא השתנו
  assert.deepEqual(Object.keys(multi).sort(), ["body", "mailto", "subject", "to"]);
  assert.equal(multi.subject, "בקשה לסגירה אווירית — בדיקה — יום שלישי 20.10.2026 עד יום שישי 23.10.2026");
  assert.equal(decodeURIComponent(multi.mailto.split("&body=")[1]), multi.body);
  // הטלפון אופציונלי: ריק => אין שורה ריקה או חסרה בסוף הגוף
  const nophone = mailOf({ requesterPhone: "" }).body;
  assert.ok(nophone.endsWith("בברכה,\nבודק\nחברת הבדיקה בע״מ"), JSON.stringify(nophone.slice(-40)));
  // פרטים שנמצאים בטופס ה-Word בלבד
  const full = mailOf(Object.assign({}, people, { knownObstacles: "עגורן בנייה\nקו מתח", visitDate: "2026-10-15", visitNotes: "ממצא סיור פנימי" })).body;
  assert.equal(full, multi.body, "אנשי קשר, משתתפים, מכשולים והערות סיור אינם משנים את הגוף");
  for (const t of [baseInput.aircraft[0], baseInput.purpose, "DJI", "32°", "34°", "32.0991", "קשר עין", "אנשי קשר", "משתתפים", "מכשולים", "סיור", "ממצא", "עגורן", "דנה כהן", "050-1112233", "מהות הפעילות", "כלי טיס", "(עשרוני"]) assert.ok(!full.includes(t), "לא אמור להופיע במייל: " + t);
  assert.ok(!/undefined|null|NaN/.test(full));
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
    const model = O.docxModel(res, data, cfg, Object.assign({ images: { aerial: img, street: img, overview: img, region: img }, includeChecks: true, review: "אושר", providerName: "Esri", adv: true }, o));   // adv: true = תצוגה מתקדמת (סעיף ההגשה המלא); בלי adv — סיכום (נכשל סגור)
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


test("מהות מותאמת (גם עוינת) זורמת לשדה 4 ול-Word כטקסט בלבד (ולא למייל הקצר): escape ב-HTML, XML תקין, בלי הזרקה", async () => {
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
    assert.ok(!m.body.includes("מהות הפעילות") && !m.body.includes(p), "המהות אינה במייל הקצר (היא בטופס ה-Word בלבד): " + p);
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

// עודכן בכוונה (הפרדה בין הארגון למטיסים עצמאיים): ברירות המחדל של הארגון חזרו, אך ורק כבלוק org_defaults שהלקוח טוען לחשבון ארגוני בלבד (js/ui.js loadPerson). שום מקום אחר בהגדרות אינו נושא שם ארגון או רישום קבועים, ובלוק org הישן לא חזר
test("config.json: ברירות המחדל של הארגון (שם, אות קריאה, רישום) רק ב-org_defaults; אין בלוק org ישן; הנוסח ״לא רלוונטי״ של שדות 13 ו-14 הוא fixed.not_relevant", () => {
  assert.equal(cfg.org, undefined, "בלוק org הישן לא חזר");
  assert.deepEqual(cfg.org_defaults, { name: "הארגון הישראלי לרב להב", callsign: "לא רלוונטי", registration: "ICD" });
  const rest = Object.assign({}, cfg); delete rest.org_defaults;
  assert.ok(!/הארגון הישראלי לרב להב|"ICD"/.test(JSON.stringify(rest)), "שם הארגון והרישום מופיעים רק ב-org_defaults");
  assert.equal(cfg.fixed.not_relevant, "לא רלוונטי");
  assert.equal(cfg.org_defaults.callsign, cfg.fixed.not_relevant);
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
  assert.ok(lines.includes("• גורם מבקש: " + org), "שורת הגורם המבקש");
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
  assert.equal(cfg.support_email, "info@icd.org.il", "כתובת התמיכה של המטיסים (לא כתובת הארגון)");
});

test("n=12: כתובת התמיכה מצורפת להודעות הפניה (תמיכה / מנהל המערכת / משרד הארגון) בלבד, פעם אחת, ורק אם היא כתובת מייל תקינה", () => {
  const A = loadAuth({ support_email: "info@icd.org.il" }), E = "info@icd.org.il";
  assert.equal(A.supportEmail(), E);
  assert.equal(A.withSupport("אם הבעיה חוזרת, פנו לתמיכה."), "אם הבעיה חוזרת, פנו לתמיכה: " + E + ".");
  assert.equal(A.withSupport("יש לפנות למנהל המערכת."), "יש לפנות למנהל המערכת: " + E + ".");
  assert.equal(A.withSupport("יש לפנות למשרד הארגון."), "יש לפנות למשרד הארגון: " + E + ".");
  assert.equal(A.withSupport(A.withSupport("פנו לתמיכה.")), "פנו לתמיכה: " + E + ".", "לא מצורפת פעמיים");
  assert.equal(A.withSupport("שם משתמש או סיסמה שגויים."), "שם משתמש או סיסמה שגויים.", "הודעה בלי הפניה — ללא שינוי");
  // ההודעות עצמן, דרך msg: מטיס רגיל (role ריק) ומנהל
  for (const code of ["blocked", "mail_quota", "not_configured", "not_ready", "missing_files", "no_owner"]) assert.ok(A.msg({ error: code }).includes(E), code + " כולל את כתובת התמיכה");
  assert.ok(!A.msg({ error: "bad_login" }).includes(E), "שגיאה בלי הפניה לתמיכה — בלי כתובת");
  assert.ok(/פנו לתמיכה: info@icd\.org\.il/.test(A.msg({ error: "no_owner" })), "נוסח המטיס ל-no_owner");
});

test("n=12: ערך support_email לא תקין (HTML, סכמה, רווחים, חסר) לא מוצג ולא משנה הודעות (נכשל סגור)", () => {
  for (const bad of ["", "x", "a b@c.d", 'a@b.c"><img src=x onerror=alert(1)>', "javascript:alert(1)", "<x@y.z>", "a@b", "mailto:a@b.co", "a@b.co?subject=x", null, 42, undefined]) {
    const A = loadAuth({ support_email: bad });
    assert.equal(A.supportEmail(), "", JSON.stringify(bad));
    assert.equal(A.withSupport("פנו לתמיכה."), "פנו לתמיכה.", JSON.stringify(bad));
    assert.equal(A.msg({ error: "blocked" }), "המשתמש חסום מבקשות טיסה. פנו לתמיכה.", JSON.stringify(bad));
  }
  assert.equal(loadAuth(null).supportEmail(), "", "בלי הגדרות");
});

/* ---------- הסבר מראש על הכרטיס (שימו לב + מה מקבלים + כפתור רכישה) במסכי הכניסה וההרשמה, והודעה אחרי ״שלחו לי קוד״ ---------- */
// הנוסח המאושר (בעל המערכת) מוחזק כאן בנפרד מהקוד: כל שינוי בו ייתפס
const BUY_NOTICE = "שימו לב: מנוי או הרשמה למפת הנוט״מים אינם כוללים בקשות טיסה. בקשות טיסה מיועדות למטיסים מסחריים בלבד, ודורשות רכישה נפרדת של הכרטיס ״בקשת אישורי טיסה״.";
const BUY_BENEFIT = "הצטרפות למערכת בקשות הטיסה מאפשרת להכין ולהגיש בקשות לסגירה אווירית בקלות ובמהירות, עם פחות בירוקרטיה. המערכת בודקת מראש אזורי איסור, נוטמים ומכשולים באזור, ובכך מסייעת למנוע תאונות שנובעות מחוסר ידיעה.";
const BUY_LABEL = "לרכישת הכרטיס והצטרפות";
const BUY_NO_CODE = "לא הגיע קוד? כנראה שלא נרכש הכרטיס ״בקשת אישורי טיסה״. מנוי למפת הנוט״מים בלבד אינו מקנה גישה לבקשות טיסה.";
const RENEW_OK = "https://www.icd.org.il/events-1/bqst-yswry-tysh";
const anchorsOf = html => [...html.matchAll(/<a\b[^>]*>/g)].map(m => m[0]);

test("הסבר הכרטיס: config.json מגדיר renew_url בכתובת https, והלקוח מקבל אותה כפי שהיא", () => {
  assert.equal(typeof cfg.renew_url, "string");
  assert.match(cfg.renew_url, /^https:\/\/[^\s"'<>]+$/);
  assert.equal(loadAuth({ renew_url: cfg.renew_url }).renewHref(), new URL(cfg.renew_url).href);
});

test("הסבר הכרטיס: כתובת הרכישה נכנסת לקישור רק כשהיא https תקין — חסרה, http, javascript:, data:, יחסית, עם רווח / מירכאות / סוגריים משולשים, עם שם משתמש וסיסמה, או לא מחרוזת = אין כתובת (נכשל סגור)", () => {
  const good = new Map([[RENEW_OK, RENEW_OK], ["  " + RENEW_OK + "  ", RENEW_OK], ["HTTPS://WWW.ICD.ORG.IL/x", "https://www.icd.org.il/x"], ["https://www.icd.org.il/p?a=1&b=2", "https://www.icd.org.il/p?a=1&b=2"]]);
  for (const [inp, out] of good) assert.equal(loadAuth({ renew_url: inp }).renewHref(), out, JSON.stringify(inp));
  const bad = ["", "   ", "http://www.icd.org.il/x", "javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,<b>x</b>", "//evil.example/x", "/events-1/x", "www.icd.org.il/x", "https://", "https:///x", "https://user:pw@www.icd.org.il/x", "https://www.icd.org.il/a b", 'https://www.icd.org.il/x"><img src=x>', "https://www.icd.org.il/x'onmouseover='y", "https://www.icd.org.il/<b>", "https://www.icd.org.il/\\x", "https://www.icd.org.il/`x", "ftp://www.icd.org.il/x", "mailto:a@b.co", null, undefined, 42, true, {}, [RENEW_OK]];
  for (const inp of bad) assert.equal(loadAuth({ renew_url: inp }).renewHref(), "", JSON.stringify(inp));
  assert.equal(loadAuth({}).renewHref(), "", "הגדרות בלי renew_url (הגדרות / שרת ישנים)");
  assert.equal(loadAuth(null).renewHref(), "", "בלי הגדרות");
});

test("הסבר הכרטיס: תיבת ההסבר — הנוסח המאושר במלואו, כפתור הרכישה כקישור אמיתי ללשונית חדשה (noopener noreferrer) והכתובת רק ב-href; בלי כתובת תקינה אין קישור אבל ההסבר נשאר", () => {
  const A = loadAuth({ renew_url: RENEW_OK, support_email: "info@icd.org.il" }), html = A.buyBox();
  assert.ok(html.includes(">" + BUY_NOTICE + "<") && html.includes(">" + BUY_BENEFIT + "<"), "שימו לב ויתרון הצטרפות בנוסח המאושר");
  assert.deepEqual(anchorsOf(html), ['<a class="buyBtn" id="buyBtn" href="' + RENEW_OK + '" target="_blank" rel="noopener noreferrer">'], "קישור אחד בלבד: href, target, rel");
  assert.ok(html.includes(">" + BUY_LABEL + "</a>"), "תווית הכפתור");
  assert.ok(!/<button/.test(html), "קישור אמיתי, לא button");
  assert.equal(html.split(RENEW_OK).length - 1, 1, "הכתובת מופיעה פעם אחת, ב-href בלבד");
  // & בכתובת: מומר ל-&amp; בתוך ה-href (HTML תקין), ובדפדפן חוזר ל-&
  assert.ok(loadAuth({ renew_url: "https://www.icd.org.il/p?a=1&b=2" }).buyBox().includes('href="https://www.icd.org.il/p?a=1&amp;b=2"'));
  for (const bad of [undefined, null, "", "http://www.icd.org.il/x", "javascript:alert(1)", 'https://x.y/"><img src=x>']) {
    const h = loadAuth({ renew_url: bad }).buyBox();
    assert.deepEqual(anchorsOf(h), [], "בלי קישור: " + JSON.stringify(bad));
    assert.ok(h.includes(BUY_NOTICE) && h.includes(BUY_BENEFIT) && !h.includes(BUY_LABEL), "ההסבר נשאר, בלי כפתור: " + JSON.stringify(bad));
  }
  assert.ok(!html.includes("office@icd.org.il") && !/מנהל המערכת/.test(html), "בלי כתובת הארגון ובלי ״מנהל המערכת״ בטקסט למטיס");
});

test("הסבר הכרטיס: ההודעה אחרי ״שלחו לי קוד״ — המשפט החדש נוסף למשפט הקיים (קוד ל-15 דקות, ספאם, מייל הרכישה, רכישה כחבר), כתובת התמיכה נשארת, והיא נגזרת רק מההגדרות (זהה לכל כתובת)", () => {
  const A = loadAuth({ support_email: "info@icd.org.il", renew_url: RENEW_OK }), m = A.regSentMessage();
  assert.ok(m.startsWith("אם נמצא כרטיס ששולם עבור הכתובת הזו — נשלח אליה קוד (תקף ל-15 דקות). לא הגיע? בדקו בספאם; ודאו שהכרטיס שולם, שהמייל שהקלדתם הוא מייל הרכישה"), "המשפט הקיים נשמר");
  assert.ok(m.includes(", ושהכרטיס נרכש כשאתם מחוברים כחברים רשומים באתר. " + BUY_NO_CODE + " "), "ברירת מחדל (דרישת החברות לא דווחה): סעיף החברות, ואחריו המשפט החדש");
  assert.ok(m.endsWith("אם הבעיה נמשכת — פנו לתמיכה: info@icd.org.il."), "כתובת התמיכה צורפה (withSupport)");
  assert.ok(!m.includes("office@icd.org.il") && !/מנהל המערכת/.test(m));
  assert.equal(A.regSentMessage(), m, "קריאה חוזרת — אותו טקסט");
  assert.equal(loadAuth({ support_email: "info@icd.org.il", renew_url: "http://x.y/z" }).regSentMessage(), m, "הכתובת (תקינה או לא) אינה משפיעה על הטקסט");
  A.requireMember = true; assert.equal(A.regSentMessage(), m);
  A.requireMember = false;   // השרת דיווח שדרישת החברות כבויה: סעיף החברות נעלם, והמשפט החדש נשאר
  const off = A.regSentMessage();
  assert.ok(!/חברים רשומים/.test(off) && off.includes("מייל הרכישה. " + BUY_NO_CODE + " אם הבעיה נמשכת"), off);
  // בלי כתובת תמיכה תקינה: בלי כתובת, ובלי כישלון
  const n = loadAuth({}).regSentMessage();
  assert.ok(n.includes(BUY_NO_CODE) && n.endsWith("אם הבעיה נמשכת — פנו לתמיכה.") && !n.includes("@"), n);
});

test("הסבר הכרטיס: מבנה — תיבת ההסבר בראש מסך הכניסה (לא בהקמה ראשונית) ובראש מסך ההרשמה, והודעת הקוד נבנית מ-regSentMessage בלבד (בלי תלות בתשובת השרת) עם כפתור הרכישה", () => {
  const au = readReq("js/auth.js");
  assert.ok(/<h2>בקשות טיסה — כניסה<\/h2>' \+ \(boot \? "" : buyBox\(\)\)/.test(au), "מסך הכניסה");
  assert.ok(/<h2>הרשמה \/ חידוש מנוי<\/h2>' \+ buyBox\(\)/.test(au), "מסך ההרשמה");
  const send = au.slice(au.indexOf('$("rgSend").onclick'), au.indexOf('$("regForm").onsubmit'));
  assert.ok(/\$\("rgInfo"\)\.innerHTML = esc\(regSentMessage\(\)\) \+ buyBtn\("rgBuy"\);/.test(send), "ההודעה והכפתור אחרי regStart");
  assert.equal((send.match(/\br\.[A-Za-z_]+/g) || []).join(","), "r.ok", "מתשובת השרת נקרא רק ok — אף שדה אחר (מי רכש, מי רשום) לא משפיע על המסך");
  assert.ok(!/renew_url/.test(readReq("js/ui.js")) && !readReq("js/auth.js").includes("window.open"), "אין פתיחת חלון בקוד; הקישור הוא a רגיל");
  assert.match(readReq("index.html"), /<script src="js\/auth\.js\?v=9"><\/script>/, "גרסת המטמון של auth.js");
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
  for (const id of ["btnZip", "btnPrint", "btnDocx", "btnKml", "btnAerial", "btnStreet", "btnOverview", "btnRegion", "btnCopy", "btnDrive", "btnSend"]) assert.match(html, new RegExp('<button[^>]*id="' + id + '"[^>]*disabled'), id + " מושבת בקובץ");
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
  const rm = auth.slice(auth.indexOf("const regSentMessage"), auth.indexOf("function expiredNote"));   // הנוסח עצמו נגזר מההגדרות בלבד (regSentMessage), והמטפל רק מציג אותו
  assert.ok(/אם נמצא כרטיס ששולם עבור הכתובת הזו/.test(rm) && /esc\(regSentMessage\(\)\)/.test(rs) && !/r\.(sent|exists|member|registered|ticket|mode)/.test(rs + rm), "הודעת regStart קבועה ואינה תלויה בתשובת השרת מעבר ל-ok");
  for (const f of ["js/auth.js", "js/ui.js", "js/sync.js", "index.html", "config.json"]) assert.ok(!new RegExp(String.fromCharCode(92) + "u[0-9a-fA-F]{4}").test(readReq(f)), f + ": בלי רצפי unicode-escape");
});

/* ===== הפרדה וניהול בין מה שהארגון שולח לבין מה שמטיסים עצמאיים שולחים (לקוח; חוזה שרת↔לקוח) ===== */
const ORG_ADDR = "office@icd.org.il", SUPPORT_ADDR = "info@icd.org.il";
const withFetch = async (resp, fn) => { const f = globalThis.fetch; globalThis.fetch = async () => ({ ok: true, json: async () => resp }); try { return await fn(); } finally { globalThis.fetch = f; } };

test("הפרדה: auth.js — A.isOrg לפי org מהשרת; שרת ישן (בלי org) נגזר מהתפקיד; features.orgSplit; ערך org לא בוליאני מתעלמים ממנו", async () => {
  const A = loadAuth({ api_url: "https://x.test/exec" });
  const NEW = ["sendTarget", "orgSplit"];
  const cases = [   // [תשובת me, isOrg צפוי, orgSplit צפוי]
    [{ ok: true, user: "a", role: "admin", org: true, features: NEW }, true, true],
    [{ ok: true, user: "p", role: "user", org: false, features: NEW }, false, true],
    [{ ok: true, user: "o", role: "user", org: true, features: NEW }, true, true],
    [{ ok: true, user: "a", role: "admin", features: ["sendTarget"] }, true, false],        // שרת ישן: מנהל = ארגוני
    [{ ok: true, user: "p", role: "user", features: ["sendTarget"] }, false, false],        // org=true הקודם לא נשאר (איפוס מלא בכל me)
    [{ ok: true, user: "p", role: "user" }, false, false],                                   // שרת ישן מאוד: בלי features
    [{ ok: true, user: "p", role: "user", org: "yes", features: NEW }, false, true],         // לא בוליאני — נגזר מהתפקיד
    [{ ok: true, user: "a", role: "admin", org: "yes", features: NEW }, true, true]
  ];
  for (const [resp, org, split] of cases) {
    await withFetch(resp, () => A.refresh());
    assert.equal(A.isOrg(), org, JSON.stringify(resp) + " isOrg");
    assert.equal(A.hasFeature("orgSplit"), split, JSON.stringify(resp) + " orgSplit");
  }
});

test("הפרדה: אין אזכור של כתובת הארגון (office@icd.org.il) בשום קובץ לקוח או בהגדרות; כתובת התמיכה היא info@icd.org.il ומוצגת בהודעות ההפניה", () => {
  for (const f of ["index.html", "config.json", "js/auth.js", "js/ui.js", "js/core.js", "js/output.js", "js/help.js", "js/docx.js", "js/sync.js", "js/mapimg.js", "js/maplayers.js"]) assert.ok(!readReq(f).includes(ORG_ADDR), f + ": כתובת הארגון לא נחשפת בקוד הלקוח");
  assert.equal(cfg.support_email, SUPPORT_ADDR);
  const A = loadAuth({ support_email: cfg.support_email });
  assert.ok(A.msg({ error: "blocked" }).includes(SUPPORT_ADDR) && !A.msg({ error: "blocked" }).includes("office@"), "הודעת חסימה");
  assert.ok(A.withSupport("אם הבעיה חוזרת, פנו לתמיכה.").endsWith("פנו לתמיכה: " + SUPPORT_ADDR + "."));
});

test("הפרדה: org_defaults נטענים לטופס רק בחשבון ארגוני ורק לשדה בלי ערך שמור; למטיס עצמאי אין ברירת מחדל — מבנה loadPerson", () => {
  const ui = readReq("js/ui.js"), lp = ui.slice(ui.indexOf("function loadPerson()"), ui.indexOf("function savePerson()"));
  assert.ok(/const od = isOrg\(\) \? orgDefaults\(\) : null/.test(lp), "ברירות המחדל רק כש-isOrg");
  assert.ok(/typeof p\[k\] === "string"/.test(lp) && /od && typeof od\[dk\] === "string" \? od\[dk\] : ""/.test(lp), "ערך שמור (גם ריק) גובר; בלעדיו — ברירת המחדל, ובלי ארגוני — ריק");
  for (const k of ["name", "callsign", "registration"]) assert.ok(new RegExp('"' + k + '"\\)').test(lp) || lp.includes('"' + k + '"'), "מיפוי " + k);
  assert.ok(/org: isOrg\(\)/.test(ui.slice(ui.indexOf("function savePerson()"), ui.indexOf("function clearPersonFields"))), "הרשומה השמורה נושאת את סוג החשבון");
  assert.ok(/isOrg = \(\) => \{[^}]*A\.loggedIn\(\)[^}]*A\.isOrg\(\)/.test(ui), "isOrg דורש התחברות תקפה");
});

test("הפרדה: שליחה — fromName נשלח רק לשרת עם orgSplit (= inp.requesterOrg, גם office וגם self); דיאלוג שונה לארגוני ולעצמאי; מטיס עצמאי בלי כתובת שמורה נחסם; הכתובת של הארגון לא בקוד", () => {
  const ui = readReq("js/ui.js"), st = ui.slice(ui.indexOf("async function sendToNotam()"), ui.indexOf("async function copyMail()"));
  assert.ok(/split = newSrv && A\.hasFeature\("orgSplit"\)/.test(st), "orgSplit מזהה שרת חדש");
  assert.ok(/fromName = split \? String\(S\.res\.inp\.requesterOrg \|\| ""\) : ""/.test(st), "fromName = הגורם שהוקלד");
  assert.ok(/if \(split\) req\.fromName = fromName;/.test(st) && !/req\.fromName = (?!fromName)/.test(st), "נשלח בכל sendRequest, ורק בשרת עם orgSplit");
  assert.ok(/אל: ' \+ officeTo \+ ' · עותק: ' \+ orgCc \+ ' · התשובות יחזרו אל הארגון · שם השולח: ' \+ orgName/.test(st), "דיאלוג ארגוני");
  assert.ok(/<b>שם השולח במייל:<\/b> ' \+ selfName/.test(st), "שורת שם השולח למטיס עצמאי");
  assert.ok(/if \(split && !org && \(toOwner \|\| !addr\)\)/.test(st), "מטיס עצמאי בלי כתובת שמורה נחסם (נכשל סגור)");
  assert.ok(/A\.isOrg\(\) !== org/.test(st), "preflight: שינוי סוג החשבון באמצע = dest_changed");
  const pilotParts = st.slice(st.indexOf("הפרדה, מטיס עצמאי, מצב חי"), st.indexOf(")) : !newSrv ? {"));
  assert.ok(pilotParts.length > 300 && pilotParts.length < 2500 && !/הארגון|orgName|orgCc|ORG_NAME/.test(pilotParts), "בדיאלוג מטיס עצמאי אין אזכור של הארגון");
  assert.ok(/ARCHIVE_PILOT = '<p class="small">[^']*'/.test(ui) && !/ARCHIVE_PILOT = [^;]*הארגון/.test(ui), "הערת הארכיון של המטיס ניטרלית");
});

test("הפרדה: חלון הניהול — עמודת סוג עם setOrg, תיבת ״חשבון ארגוני״ בהוספת משתמש (addUser עם org), סיכומים לפי סוג, עמודת סוג וסינון ביומן", () => {
  const au = readReq("js/auth.js"), ad = au.slice(au.indexOf("async function openAdmin()"), au.indexOf("/* ---------- ממשק ציבורי"));
  assert.ok(/call\("setOrg", \{ target: who, org: to \}\)/.test(ad), "setOrg");
  assert.ok(/id="adO" checked/.test(ad) && /org: \$\("adA"\)\.checked \|\| !\$\("adO"\) \|\| \$\("adO"\)\.checked/.test(ad), "תיבת חשבון ארגוני מסומנת כברירת מחדל, נשלחת ב-addUser; מנהל תמיד ארגוני");
  assert.ok(/id="admTotals"/.test(ad) && /בקשות הארגון:<\/b> /.test(ad) && /בקשות מטיסים:<\/b> /.test(ad), "סיכומים");
  assert.ok(/id="admKind"/.test(ad) && /<option value="org">הארגון<\/option><option value="pilot">מטיסים<\/option>/.test(ad), "סינון סוג ביומן");
  assert.ok(/HELP\.type/.test(ad) && /HELP\.addOrg/.test(ad), "לחצני ! לסוג ולתיבת הסימון");
  assert.ok(/data-setorg/.test(ad) && /u\.role === "admin" \|\| !split/.test(ad), "כפתור הפיכה לא למנהל ולא בשרת ישן");
  assert.ok(/A\.hasFeature\("orgSplit"\)/.test(ad), "בשרת ישן אין עמודת סוג");
});

test("הפרדה: אין רצפי unicode-escape בקבצי הלקוח שהשתנו, ו-config.json תקין", () => {
  for (const f of ["js/auth.js", "js/ui.js", "index.html", "config.json"]) assert.ok(!new RegExp(String.fromCharCode(92) + "u[0-9a-fA-F]{4}").test(readReq(f)), f);
  assert.doesNotThrow(() => JSON.parse(readReq("config.json")));
});

test("סקירה אחרונה: מרוץ שמירה אוטומטית מול חלון השליחה, S.saved אחרי כשל, חץ ה״אפשרויות נוספות״ מחוץ לשם הנגיש, וניסוח ״בעל המערכת״ בעזרת הדרייב", () => {
  const ui = readReq("js/ui.js"), html = readReq("index.html");
  // השמירה האוטומטית לא מתחילה בזמן שחלון השליחה נבנה (S.opening), והלחצן ״שלח״ מכסה את כל הבנייה בדגל
  assert.match(ui, /if \(S\.sending \|\| S\.opening \|\| \$\("sendProg"\)\) \{ autoFor = rev;/);
  assert.match(ui, /async function sendToNotam\(\) \{\s*if \(S\.opening\) return;\s*S\.opening = true;\s*try \{ await sendToNotamOpen\(\); \} finally \{ S\.opening = false; \}\s*\}/);
  // שמירה חדשה מבטלת את ״נשמר לגרסה הזו״ עד שהיא מצליחה
  assert.match(ui, /S\.driveTry = rev0;[^\n]*\n\s*S\.saved = null;/);
  // guarded אינו שותק כשיש שמירה בעיצומה
  assert.match(ui, /const guarded = async fn => \{\s*if \(S\.sending\) \{ prog\.className = "small"; prog\.textContent = "שמירה בדרייב בעיצומה/);
  // החץ הוא טקסט חלופי ריק: לא נכנס לשם הנגיש של הכפתור
  assert.ok(html.includes('#btnMore::after{content:" ▾" / ""}') && html.includes('#btnMore[aria-expanded=true]::after{content:" ▴" / ""}'));
  // עזרת ״שמור בדרייב״ (גלויה גם למטיס) לא מזכירה ״מנהל״
  const m = /btnDrive: "([^"]*)"/.exec(ui); assert.ok(m && /בעל המערכת בלבד/.test(m[1]) && !/למנהל בלבד/.test(m[1]));
  // גרסת הסקריפט הוקפצה כדי שמי שכבר גלש לא יקבל JS ישן
  assert.match(html, /js\/ui\.js\?v=14/);
});

test("כניסה והרשמה: הפוקוס האוטומטי בלי גלילה (תיבת ההסבר הגבוהה בטלפון ב-landscape), וגרסת auth.js הוקפצה", () => {
  const au = readReq("js/auth.js"), html = readReq("index.html");
  assert.match(au, /\$\("auUser"\); if \(u\) u\.focus\(\{ preventScroll: true \}\);/);
  assert.match(au, /\$\("rgEmail"\)\.focus\(\{ preventScroll: true \}\);/);
  assert.match(html, /js\/auth\.js\?v=9/);
});

/* ===== תצוגה מתקדמת (A2): סעיף 5 "הגשה" המלא רק למי שיש לו תצוגה מתקדמת; כל השאר מקבלים "סיכום והגשה" קצר בלי הפניות לפמ״ת ובלי הנחיות למודיעין טיס (החלטת בעל המערכת) ===== */
// כל מה שמסמן הפניה לפמ״ת (פרק, סעיף, עמוד, עדכון, מספרי נוהל) או הנחיה להגיש מחדש תכנית טיסה / לפנות למודיעין טיס
const PMT_REF = /פמ״ת|פמ"ת|א-1[0-9]|ב-0[0-9]|סעיף|פרק|עמ'|עדכון|מודיעין טיס|תכנית|הגש(ה|ת|ו)? .*שנית|שנית|3\.ד|6\(ד\)|7\(ח\)|6\.ב|\bAIP\b|ENR/;
test("סיכום והגשה: הספירות וימי העבודה מאותו ניתוח של הטופס (✔ כשיש מספיק ימים, ✘ כשאין), בנוסח שנקבע ובלי הפניות לפמ״ת", () => {
  const data = mkData(fixture("yarkon")), at = d => C.analyze(Object.assign({}, baseInput, { dateFrom: d, dateTo: d }), data, cfg, now);
  const far = at("2026-11-20"), nearD = at("2026-10-20"), zr = zones.zones.find(x => x.id === "LLR24"), c = centroid(zr);
  const inZone = C.analyze(Object.assign({}, baseInput, { lat: c[0], lon: c[1] }), data, cfg, now);
  assert.ok(inZone.zones.inside.length > 0 && far.nearScan.items.length > 0 && far.notams.hits.length + far.notams.obstacles.length > 0, "הנתונים לבדיקה: אזור חופף, מכשולים ונוטם בקרבה");
  for (const res of [far, nearD, inZone]) {
    const s = O.summaryModel(res, cfg), t = s.lines.map(O.toText);
    assert.equal(s.head, "סיכום והגשה");
    assert.deepEqual(s.counts, { zones: res.zones.inside.filter(z => z.src !== "b09").length, notams: res.notams.hits.length + res.notams.obstacles.length, items: res.nearScan.items.length });
    assert.equal(t.length, 2);
    assert.equal(t[0], "נמצאו בסריקה: אזורי איסור/הגבלה חופפים " + s.counts.zones + " · נוטמים בקרבה " + s.counts.notams + " · מכשולים ותשתיות " + s.counts.items);
    assert.equal(s.workingDays, res.workingDays); assert.equal(s.minWorkingDays, cfg.thresholds.min_working_days);
    assert.equal(t[1], "ימי עבודה עד הפעילות: " + res.workingDays + " (נדרשים לפחות " + cfg.thresholds.min_working_days + ") " + (res.workingDays >= cfg.thresholds.min_working_days ? "✔" : "✘"));
    assert.ok(!PMT_REF.test(s.head + "\n" + t.join("\n")), "הפניה לפמ״ת בסיכום: " + t.join(" | "));
    assert.ok(s.lines.every(l => !/<(a|script|img)\b/i.test(l)), "HTML בטוח");
  }
  assert.equal(O.summaryModel(far, cfg).daysOk, true); assert.equal(O.summaryModel(nearD, cfg).daysOk, false);
  assert.ok(O.toText(O.summaryModel(far, cfg).lines[1]).endsWith("✔") && O.toText(O.summaryModel(nearD, cfg).lines[1]).endsWith("✘"));
  assert.ok(O.summaryModel(inZone, cfg).counts.zones > 0);
  // אזורי טיסה לכטב״ם של פרק ב-09 (src "b09") הם אזורים ייעודיים לטיסה ולא איסור: אינם נספרים כ״אזורי איסור/הגבלה חופפים״
  { const b09 = { src: "b09", id: "B09-1" }, a17 = { src: "a17", id: "LLR1" }, mix = Object.assign({}, far, { zones: Object.assign({}, far.zones, { inside: [b09, b09, a17] }) }), only = Object.assign({}, far, { zones: Object.assign({}, far.zones, { inside: [b09, b09] }) });
    assert.equal(O.summaryModel(mix, cfg).counts.zones, 1); assert.equal(O.summaryModel(only, cfg).counts.zones, 0);
    assert.match(O.toText(O.summaryModel(only, cfg).lines[0]), /אזורי איסור\/הגבלה חופפים 0 ·/); }
  // ימי עבודה לא ידועים (אין תאריך תקין): בלי שורה (כמו בנוסח המלא), בלי ✔ / ✘ מומצא
  const unk = O.summaryModel(Object.assign({}, far, { workingDays: null }), cfg);
  assert.equal(unk.lines.length, 1); assert.equal(unk.daysOk, null); assert.ok(!/✔|✘|ימי עבודה/.test(unk.lines.join("")));
  // הסף נלקח מההגדרות
  assert.match(O.toText(O.summaryModel(far, Object.assign({}, cfg, { thresholds: Object.assign({}, cfg.thresholds, { min_working_days: 30 }) })).lines[1]), /\(נדרשים לפחות 30\) ✘$/);
});

test("סעיף ההגשה לפי תצוגת המבקש: adv === true — הנוסח המלא כמות שהוא (בלי שינוי); כל ערך אחר או חסר — הסיכום (נכשל סגור)", () => {
  const data = mkData(fixture("yarkon")), res = C.analyze(baseInput, data, cfg, now);
  const fullHtml = O.submissionHtml(res, cfg, data), full = O.submissionSection(res, cfg, data, true);
  assert.deepEqual(full, { head: "הגשה", html: fullHtml, lines: null });
  assert.match(O.toText(fullHtml), /3\.ד\.4/); assert.match(O.toText(fullHtml), /6\(ד\)/); assert.match(O.toText(fullHtml), /מודיעין טיס/);
  for (const v of [false, undefined, null, 1, "true", "yes", 0, {}]) {
    const s = O.submissionSection(res, cfg, data, v);
    assert.equal(s.head, "סיכום והגשה", String(v)); assert.equal(s.html, ""); assert.deepEqual(s.lines, O.summaryModel(res, cfg).lines);
  }
  assert.equal(O.docxModel(res, data, cfg, {}).submissionHead, "סיכום והגשה", "בלי adv במודל — סיכום");
});

test("Word / מודל: למבקש בלי תצוגה מתקדמת סעיף 5 הוא ״סיכום והגשה״ (שתי נקודות, בלי הפניות לפמ״ת), ולמי שיש לו — ״הגשה״ המלא; שאר הדף זהה", async () => {
  const data = mkData(fixture("yarkon")), res = C.analyze(Object.assign({}, baseInput, people), data, cfg, now);
  const BIDI = new RegExp("[" + String.fromCharCode(0x202a, 0x202c, 0x200f) + "]", "g");
  const build = async adv => {
    const model = O.docxModel(res, data, cfg, { includeChecks: true, review: "אושר", adv });
    const z = await JSZipNode.loadAsync(await D.build(model)), doc = await z.file("word/document.xml").async("string");
    const lines = doc.replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "").replace(BIDI, "").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").split("\n");
    return { model, doc, lines, plain: lines.join("\n") };
  };
  const pilot = await build(false), adm = await build(true), sum = O.summaryModel(res, cfg);
  // המודל
  assert.equal(pilot.model.submissionHead, "סיכום והגשה"); assert.equal(pilot.model.submission, ""); assert.deepEqual(pilot.model.summary, sum.lines);
  assert.equal(adm.model.submissionHead, "הגשה"); assert.equal(adm.model.summary, null); assert.equal(adm.model.submission, O.submissionHtml(res, cfg, data));
  // הקובץ: כותרת סעיף 5, שתי נקודות, ואחריהן סעיף 6 (אישור סקירה) — בלי שום הפניה לפמ״ת בין הכותרות
  const a = pilot.lines.indexOf("5. סיכום והגשה"), b = pilot.lines.indexOf("6. אישור סקירה אנושית");
  assert.ok(a > 0 && b === a + 3, "מיקום הסעיף " + a + "," + b);
  assert.deepEqual(pilot.lines.slice(a + 1, b), sum.lines.map(l => "• " + O.toText(l)));
  assert.ok(!PMT_REF.test(pilot.lines.slice(a, b).join("\n")), "הפניה לפמ״ת בסעיף 5 של ה-Word");
  assert.ok(!pilot.lines.includes("5. הגשה") && !/אינה מנכה חגים|למודיעין טיס|יש לבדוק מול/.test(pilot.plain));
  // תצוגה מתקדמת: הנוסח המלא (עם 3.ד.4 ו-6(ד)) ובלי הסיכום
  const a2 = adm.lines.indexOf("5. הגשה"); assert.ok(a2 > 0 && adm.lines[a2 + 1].includes("3.ד.4") && adm.lines[a2 + 1].includes("6(ד)") && adm.lines[a2 + 1].includes("מודיעין טיס"), "הנוסח המלא תחת ״5. הגשה״");
  assert.ok(!adm.lines.includes("5. סיכום והגשה") && !adm.plain.includes("נמצאו בסריקה:"));
  // כל השאר זהה בשני הקבצים: אותן כותרות סעיף ואותו מספר עמודים (רק סעיף 5 שונה)
  const heads = l => l.filter(x => /^\d+\. /.test(x)).map(x => x.replace(/^\d+\. /, "")).filter(x => x !== "סיכום והגשה" && x !== "הגשה");
  assert.deepEqual(heads(pilot.lines), heads(adm.lines));
  assert.equal((pilot.doc.match(/<w:drawing>/g) || []).length, (adm.doc.match(/<w:drawing>/g) || []).length);
  // בלי דף בדיקות — אין סעיף 5 כלל (בשני המצבים)
  const none = O.docxModel(res, data, cfg, { includeChecks: false, adv: false }), nz = await JSZipNode.loadAsync(await D.build(none)), nd = (await nz.file("word/document.xml").async("string")).replace(/<[^>]+>/g, "");
  assert.ok(!nd.includes("סיכום והגשה") && !nd.includes("נמצאו בסריקה"));
});

test("תצוגה מתקדמת בלקוח: auth.js חושף isAdv (מנהל תמיד; adv מהשרת; שרת ישן — לפי הסוג; מנותק — לא) ושגיאות setAdv; ui.js מסתיר את הכלים הפנימיים ב-hidden ומעביר adv לדוח ולקובץ ה-Word; index.html מסתיר אותם כברירת מחדל", () => {
  const au = readReq("js/auth.js"), ui = readReq("js/ui.js"), html = readReq("index.html");
  // auth.js
  assert.match(au, /const isAdv = \(\) => A\.loggedIn\(\) && \(A\.role === "admin" \|\| \(A\.advKnown \? A\.adv : isOrg\(\)\)\);/);
  assert.match(au, /A\.isAdv = isAdv;/);
  assert.match(au, /if \(r\.adv === true \|\| r\.adv === false\) \{ A\.adv = r\.adv; A\.advKnown = true; \}/);
  assert.match(au, /bad_adv: "[^"]+"/); assert.match(au, /is_admin_adv: "[^"]+"/);
  assert.match(au, /call\("setAdv", \{ target: who, adv: to \}\)/); assert.match(au, /<th>תצוגה מתקדמת<\/th>/); assert.match(au, /data-setadv=/);
  assert.match(au, /new CustomEvent\("req-adv"/);
  // ui.js: הסתרה אמיתית (hidden), באנר ניטרלי, הבדיקה העצמית ממשיכה לחסום, adv בדוח ובמודל
  assert.match(ui, /\["limitsBox", "stBox"\]\.forEach\(id => \{ const e = \$\(id\); if \(e\) e\.hidden = !adv; \}\);/);
  assert.match(ui, /else b\.textContent = maintNote\(\);/);
  assert.match(ui, /setStatus\("selftest", ok, [^\n]*\{ maint: true, adv: true \}\)/);
  assert.match(ui, /adv: isAdv\(\) \};/);
  assert.match(ui, /secH\(mdl\.submissionHead\) \+ \(mdl\.summary \?/);
  assert.match(ui, /document\.addEventListener\("req-adv"/);
  assert.ok(/function renderLimits\(\) \{ if \(!isAdv\(\)\)/.test(ui), "מגבלות המקורות ריקות למי שאין לו תצוגה מתקדמת");
  // index.html: ברירת מחדל מוסתרת גם בלי JS
  assert.match(html, /<details class="card nonprint" id="limitsBox" hidden>/); assert.match(html, /<details class="card" id="stBox" hidden>/);
});

/* ===== הצהרה ואישור המבקש + רשימת המכשולים בשדה 8 (שלב א) ===== */
// הנוסח המאושר (בעל המערכת) מוחזק כאן בנפרד מהקוד: כל שינוי בנוסח (ב-output.js או ב-index.html) ייתפס. גרשיים ״ (U+05F4) כבנוסח
const DECL = {
  version: "2026-10-19", title: "הצהרה ואישור המבקש", label: "קראתי, הבנתי ואני מאשר את האמור לעיל", gate: "יש לאשר את ההצהרה",
  ps: ["אני מאשר כי עברתי באופן אישי על התצ״א, על רשימת המצאי ועל המפה, וכי אני מודע לאזור ולסכנות הקיימות בו. אין מכשול או תשתית נוספת שלא הופיעו בטופס (או שהוספתי אותם ידנית).",
    "אני מבין כי נתוני המערכת הם כלי עזר בלבד ואין להסתמך עליהם באופן בלעדי: האחריות לבדיקת כלל הסכנות, המגבלות והאיסורים באזור, ולביצוע הטיסה, היא עליי בלבד.",
    "לא תהיה לי כל טענה כלפי המערכת, מפעיליה או יוצריה, בגין מידע חסר, שגוי או לא מעודכן, או בגין פעילות הטיסה."]
};
const BIDI_MARKS = new RegExp("[" + fcc(0x202a, 0x202c, 0x200f) + "]", "g");

test("הצהרת המבקש: output.js DECLARATION נושא את הנוסח המאושר כלשונו (כותרת, שלוש פסקאות, תווית, הודעת שער) וגרסה 2026-10-19", () => {
  const d = O.DECLARATION;
  assert.equal(d.version, DECL.version); assert.equal(d.title, DECL.title); assert.deepEqual(d.paragraphs, DECL.ps); assert.equal(d.label, DECL.label); assert.equal(d.gate, DECL.gate);
  assert.ok(d.paragraphs[0].includes("התצ" + fcc(0x5f4) + "א"), "גרשיים U+05F4 בנוסח");
});

test("הצהרת המבקש: index.html — #declBox זהה לנוסח המאושר (כותרת, שלוש פסקאות, תווית מודגשת), reviewOk נשאר, CSS בולט (מסגרת ענבר 2px, רקע מוטה, תיבה ≥28px, טקסט ≥15px), והודעת השער #declGate בסעיף 5 ליד הכפתורים", () => {
  const html = readReq("index.html"), m = html.match(/<div class="decl" id="declBox"([^>]*)>([\s\S]*?)<\/label>\s*<\/div>/);
  assert.ok(m, "#declBox");
  assert.match(m[1], /role="group"/); assert.match(m[1], /aria-labelledby="declTitle"/);
  assert.equal((m[2].match(/<h3 id="declTitle">([^<]*)<\/h3>/) || [])[1], DECL.title);
  assert.deepEqual([...m[2].matchAll(/<p id="declP\d">([^<]*)<\/p>/g)].map(x => x[1]), DECL.ps, "שלוש הפסקאות כלשונן");
  const lab = m[2].match(/<label class="declok" for="reviewOk"><input ([^>]*)><b>([^<]*)<\/b>$/);
  assert.ok(lab, "תווית עם תיבת סימון"); assert.match(lab[1], /type="checkbox"/); assert.match(lab[1], /id="reviewOk"/); assert.match(lab[1], /aria-required="true"/); assert.match(lab[1], /aria-describedby="declP1 declP2 declP3"/, "תיבת הסימון מקושרת לנוסח ההצהרה (קורא מסך)"); assert.equal(lab[2], DECL.label);
  assert.equal((html.match(/id="reviewOk"/g) || []).length, 1, "מזהה reviewOk פעם אחת");
  assert.ok(!/עברתי על התצ״א, על רשימת המצאי ועל המפה, ואני מאשר/.test(html), "השורה הקטנה הישנה הוסרה");
  // בולטות: מסגרת ענבר 2px, רקע מוטה בענבר, פסקאות ≥15px, תיבת סימון ≥28px, שורת סימון גבוהה (מגע)
  assert.match(html, /\.decl\{[^}]*border:2px solid var\(--amber\)[^}]*background:rgba\(255,184,77,\.10\)/);
  assert.ok(parseFloat((html.match(/\.decl p\{font-size:([\d.]+)px/) || [])[1]) >= 15, "פסקאות ≥15px");
  const cb = html.match(/\.declok input\{width:(\d+)px;height:(\d+)px/); assert.ok(cb && +cb[1] >= 28 && +cb[2] >= 28, "תיבת סימון ≥28px");
  assert.ok(parseFloat((html.match(/\.declok\{[^}]*min-height:(\d+)px/) || [])[1]) >= 44, "שורת סימון ≥44px");
  assert.match(html, /\.declok b\{[^}]*overflow-wrap:anywhere/); assert.match(html, /\.declgate:empty\{display:none\}/);
  // הודעת השער: בכרטיס ההפקות, אחרי שורת הכפתורים ולפני ההסבר
  assert.match(html, /id="actions"[\s\S]*?id="btnMore"[\s\S]*?<div role="status" aria-live="polite"><p class="declgate" id="declGate"><\/p><\/div>\s*<p class="small" id="actionsHint"/);
});

test("הצהרת המבקש: declarationRecord (גרסה, מועד ISO, שלוש הפסקאות מחוברות ב-\\n; null בלי אישור) ו-reviewText קצר ועובדתי — מי אישר ומתי, בלי סעיף הוויתור ובלי כתובת הארגון", () => {
  const at = new Date("2026-10-19T08:30:15.123Z");
  assert.deepEqual(O.declarationRecord(at), { version: DECL.version, confirmedAt: "2026-10-19T08:30:15.123Z", text: DECL.ps.join("\n") });
  assert.equal(O.declarationRecord(null), null); assert.equal(O.declarationRecord(undefined), null);
  const rt = O.reviewText(at);
  assert.ok(rt.startsWith("המבקש אישר ב-" + at.toLocaleString("he-IL") + " את ״" + DECL.title + "״: "), rt);
  assert.ok(rt.includes("שעבר באופן אישי על התצ״א, על רשימת המצאי ועל המפה") && rt.includes("שאין מכשול או תשתית נוספת שלא הופיעו בטופס (או שהוסיף אותם ידנית)") && rt.includes("האחריות לבדיקת כלל הסכנות, המגבלות והאיסורים באזור ולביצוע הטיסה היא עליו בלבד"), rt);
  assert.ok(!/טענה|מפעיליה|יוצריה/.test(rt), "סעיף הוויתור אינו נכנס לדף הבדיקות ול-Word"); assert.ok(!/office@icd\.org\.il/.test(rt) && rt.length < 450, "קצר: " + rt.length);
  assert.equal(O.reviewText(null), ""); assert.equal(O.reviewText(undefined), "");
  assert.ok(!/שעבר על התצ״א, על רשימת המצאי ועל המפה, ושאין/.test(rt), "הנוסח הישן הוחלף");
});

test("הצהרת המבקש: אישור ההצהרה נכנס לדף הבדיקות ול-Word (סעיף ״אישור סקירה אנושית״), ובלי אישור הסעיף נעדר", async () => {
  const data = mkData(fixture("yarkon")), res = C.analyze(baseInput, data, cfg, now), at = new Date("2026-10-19T08:30:15.123Z"), rt = O.reviewText(at);
  const text = async review => { const z = await JSZipNode.loadAsync(await D.build(O.docxModel(res, data, cfg, { includeChecks: true, review }))); return (await z.file("word/document.xml").async("string")).replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "").replace(BIDI_MARKS, ""); };
  const withRv = await text(rt), none = await text("");
  assert.ok(withRv.includes("אישור סקירה אנושית") && withRv.includes(rt.replace(BIDI_MARKS, "")), "האישור ב-Word");
  assert.ok(!none.includes("אישור סקירה אנושית"), "בלי אישור — בלי הסעיף");
  assert.equal(O.docxModel(res, data, cfg, { review: rt }).review, rt);
});

test("שער: ״הצהרה ואישור המבקש״ הוא התנאי האחרון שחסר — התווית וההודעה ״יש לאשר את ההצהרה״", () => {
  const st = {}; C.REQUIRED_CHECKS.forEach(([k]) => { st[k] = { ok: true }; }); st.review = { ok: false, msg: O.DECLARATION.gate };
  const g = C.gate(st);
  assert.equal(g.ready, false); assert.deepEqual(g.failing, [{ key: "review", label: "הצהרה ואישור המבקש", msg: "יש לאשר את ההצהרה" }]);
  assert.ok(!C.REQUIRED_CHECKS.some(([, l]) => /אישור סקירה אנושית של התצ״א והמצאי/.test(l)));
});

test("ui.js: סטטוס ״review״ והודעות השער מה-DECLARATION; הרשומה בנתוני הבקשה; reviewText מה-output; הודעת #declGate נגזרת מהסטטוס; השער נשאר נכשל סגור", () => {
  const ui = readReq("js/ui.js");
  assert.ok(!/לא אושרה סקירה|הרשימה השתנתה — יש לאשר מחדש"/.test(ui), "הנוסחים הישנים הוסרו");
  assert.equal((ui.match(/S\.statuses\.review = \{ ok: false, msg: O\.DECLARATION\.gate \}/g) || []).length, 3, "איפוס בהרצה, באיפוס הדף ובטעינת בקשה כבסיס (״הבקשות שלי״, myreqLoadBase)");
  assert.match(ui, /S\.statuses\.review = \{ ok: false, msg: "הרשימה השתנתה — " \+ O\.DECLARATION\.gate \+ " מחדש" \}/);
  assert.match(ui, /setStatus\("review", \$\("reviewOk"\)\.checked, \$\("reviewOk"\)\.checked \? "" : O\.DECLARATION\.gate\)/);
  assert.match(ui, /S\.reviewAt = \$\("reviewOk"\)\.checked \? new Date\(\) : null;/, "מועד האישור נקבע בסימון");
  assert.match(ui, /const reviewText = \(\) => O\.reviewText\(S\.reviewAt\);/);
  assert.match(ui, /declaration: O\.declarationRecord\(S\.reviewAt\), inputs: o,/, "הרשומה נכנסת לנתוני הבקשה");
  assert.match(ui, /const dg = \$\("declGate"\), rv = S\.statuses\.review, t = rv && rv\.ok \? "" : O\.DECLARATION\.gate;/, "ההודעה ליד הכפתורים: בלי סטטוס מאושר — מוצגת");
  assert.match(ui, /if \(!S\.ready \|\| !\$\("reviewOk"\)\.checked\) throw new Error\(/, "השליחה בודקת גם את הסימון עצמו");
  assert.ok(/\["btnZip", "btnPrint", "btnDocx", "btnKml"[^\]]*"btnDrive", "btnSend"\]\.forEach\(id => \{ \$\(id\)\.disabled = !S\.ready/.test(ui), "ההפקות נעולות לפי S.ready");
});

/* --- שדה 8: כותרת מודגשת לכל קבוצה, ופריט בשורה (מספר, שם, ומרחק בקצה) --- */
test("טופס שדה 8: כותרת מודגשת לכל קבוצה ופריט בשורה — התוכן, המספור והמרחקים כפי שחושבו (itemText), לא פסקה רצופה", () => {
  const data = mkData(fixture("yarkon")), res = C.analyze(baseInput, data, cfg, now), f = O.buildForm(res, cfg)[7], ns = res.nearScan, lines = f.text.split("\n");
  const groups = [["מכשולים ותשתיות בתוך האזור (עד 200 מ׳):", ns.inside], ["בקרבת האזור (עד 400 מ׳):", ns.ring], ["אתרים ותשתיות נוספים בקרבת האזור (עד 1.2 ק״מ מהנקודה):", ns.near]];
  assert.ok(groups.every(([, a]) => a.length > 0), "תנאי הבדיקה: בשלוש הקבוצות יש פריטים");
  let i = lines.indexOf(groups[0][0]); assert.ok(i >= 0, f.text);
  for (const [h, items] of groups) { assert.equal(lines[i], h); items.forEach((it, k) => assert.equal(lines[i + 1 + k], O.itemText(it), "שורה " + k + " של " + h)); i += 1 + items.length; }
  assert.equal(i, lines.length, "אין טקסט אחרי הרשימה האחרונה (בלי מכשולים שידועים)");
  assert.ok(!/\): \d+\. |מ׳; \d+\. |; ועוד/.test(f.text), "לא פסקה רצופה עם ״; ״");
  assert.equal(lines.find(l => /^1\. /.test(l)), "1. קו מתח עליון 161 ק״ו — 109 מ׳"); assert.ok(lines.includes("12. מתקן שעשועים — 312 מ׳ · גובה 11 מ׳"), "גובה אחרי המרחק, כמו ב-itemText");
  // HTML: כותרת מודגשת לכל קבוצה, שורת פריט (fl) לכל פריט עם שם (fn), מפריד (fs) ומרחק (fd) — ללא טבלה
  assert.deepEqual([...f.html.matchAll(/<b>([^<]*):<\/b>/g)].map(x => x[1] + ":"), groups.map(g => g[0]));
  assert.equal((f.html.match(/<span class='fl'>/g) || []).length, groups.reduce((a, g) => a + g[1].length, 0));
  assert.ok(f.html.includes("<b>מכשולים ותשתיות בתוך האזור (עד 200 מ׳):</b><br><span class='fl'><span class='fn'>1. קו מתח עליון 161 ק״ו</span><span class='fs'> — </span><span class='fd'>109 מ׳</span></span><br><span class='fl'><span class='fn'>2. עמוד חשמל 1491</span>"));
  assert.ok(f.html.includes("<span class='fn'>12. מתקן שעשועים</span><span class='fs'> — </span><span class='fd'>312 מ׳ · גובה 11 מ׳</span>"));
  assert.ok(!/<table|<ol|<ul|<li|\t/.test(f.html), "בלי טבלה, רשימת HTML או טאב בטקסט");
  // itemText נשאר זהה לפני ואחרי: שם עם מספר + " — " + מרחק (+ גובה)
  assert.equal(O.itemText({ n: 7, title: "מגדל", d: 0.4, height: 35 }), "7. מגדל — בתוך השטח · גובה 35 מ׳"); assert.equal(O.itemText({ n: 8, title: "עמוד", d: 1500 }), "8. עמוד — 1.5 ק״מ");
});

test("טופס שדה 8: שמות מפריטים ידניים (HTML עוין) נכנסים לשורת הפריט כטקסט בלבד, ובטקסט הפשוט כלשונם", () => {
  const evil = "מגדל <b>x</b> & \"y\" <img src=x onerror=1>", data = mkData(fixture("yarkon"));
  const res = C.analyze(Object.assign({}, baseInput, { manualItems: [{ name: evil, lat: 32.0995, lon: 34.8168, heightM: 40 }] }), data, cfg, now), f = O.buildForm(res, cfg)[7];
  assert.ok(f.html.includes("<span class='fn'>") && f.html.includes(E(evil)) && !/<img|<b>x/.test(f.html), "escape בתוך שורת הפריט");
  assert.ok(f.text.split("\n").some(l => l.includes(evil + "״ — ") && /— \d+ מ׳ · גובה 40 מ׳$/.test(l)), f.text);
});

test("טופס שדה 8: תקרת הרשימה (25 פריטים לקבוצה) נשמרת — שורה אחת ״ועוד N פריטים (ראו דף הבדיקות)״ אחרי הפריט ה-25, בלי ״; ״ מפריד", () => {
  const data = mkData(fixture("yarkon")), manual = Array.from({ length: 30 }, (_, i) => ({ name: "עגורן " + (i + 1), lat: 32.0995, lon: 34.8168 + i * 0.00001, heightM: 20 }));
  const res = C.analyze(Object.assign({}, baseInput, { manualItems: manual }), data, cfg, now), ns = res.nearScan, f = O.buildForm(res, cfg)[7], lines = f.text.split("\n");
  assert.ok(ns.inside.length > 25, "תנאי הבדיקה: יותר מ-25 פריטים בתוך האזור: " + ns.inside.length);
  const h = lines.indexOf("מכשולים ותשתיות בתוך האזור (עד 200 מ׳):"); assert.ok(h >= 0);
  ns.inside.slice(0, 25).forEach((it, k) => assert.equal(lines[h + 1 + k], O.itemText(it)));
  assert.equal(lines[h + 26], "ועוד " + (ns.inside.length - 25) + " פריטים (ראו דף הבדיקות)", "שורת ההמשך אחרי 25 פריטים");
  assert.ok(!lines.includes(O.itemText(ns.inside[25])), "הפריט ה-26 אינו מוצג"); assert.ok(!/; ועוד/.test(f.text));
  assert.equal(lines[h + 27], "בקרבת האזור (עד 400 מ׳):", "הקבוצה הבאה אחרי שורת ההמשך");
  assert.ok(f.html.includes("<br>ועוד " + (ns.inside.length - 25) + " פריטים (ראו דף הבדיקות)<br><b>בקרבת האזור"), f.html.slice(-200));
  assert.equal((f.html.match(/<span class='fl'>/g) || []).length, 25 + Math.min(25, ns.ring.length) + Math.min(25, ns.near.length));
});

test("Word שדה 8: כל פריט בפסקה אחת עם טאב ימני וקו מנחה בקצה התא (טאב אחד לכל פריט), כותרות מודגשות, בלי טבלה בתוך התא, ה-XML תקין והטקסט כפי שבמסך", async () => {
  const data = mkData(fixture("yarkon")), res = C.analyze(baseInput, data, cfg, now), ns = res.nearScan, items = [].concat(ns.inside, ns.ring, ns.near);
  const z = await JSZipNode.loadAsync(await D.build(O.docxModel(res, data, cfg, { includeChecks: false }))), xml = await z.file("word/document.xml").async("string");
  assert.ok(wellFormed(xml)); const lint = xmllint(xml); if (lint !== null) assert.equal(lint, "", "xmllint: " + lint);
  const cellX = xml.split("<w:tc>").find(c => c.includes("מכשולים ותשתיות בתוך האזור")), plain = cellX.replace(/<[^>]+>/g, "").replace(BIDI_MARKS, "");
  assert.ok(cellX, "תא שדה 8");
  assert.match(cellX, /<w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="(\d+)"\/><\/w:tabs><w:bidi\/>/, "טאב ימני עם קו מנחה לפני bidi (סדר הסכמה)");
  const pos = +cellX.match(/w:pos="(\d+)"/)[1], wv = D.helpers.CONTENT_W - ((D.helpers.CONTENT_W * 0.40) | 0);
  assert.ok(pos < wv - 180 && pos > wv - 400, "הטאב בקצה התא (רוחב התא פחות שולי התא): " + pos + " מתוך " + wv);
  assert.equal((cellX.match(/<w:tab\/>/g) || []).length, items.length, "טאב אחד לכל פריט"); assert.equal((xml.match(/<w:tab\/>/g) || []).length, items.length, "אין טאבים במקום אחר בטופס");
  assert.ok(!/<w:tbl>/.test(cellX), "בלי טבלה מקוננת");
  for (const h of ["מכשולים ותשתיות בתוך האזור (עד", "בקרבת האזור (עד", "אתרים ותשתיות נוספים בקרבת האזור (עד"]) { const run = cellX.split("</w:r>").find(r => r.replace(/<[^>]+>/g, "").includes(h)); assert.ok(run && /<w:b\/>/.test(run), "כותרת מודגשת: " + h); }
  let at = 0; for (const it of items) { const p = O.itemText(it).split(" — "), i = plain.indexOf(p[0] + p.slice(1).join(" — "), at); assert.ok(i >= 0, "פריט חסר או שלא לפי הסדר ב-Word: " + O.itemText(it)); at = i + 1; }
  assert.ok(!plain.includes(" — 109 מ׳"), "המפריד ״ — ״ אינו נכתב ב-Word (במקומו הטאב)");
  // פסקאות אחרות בטופס — בלי טאבים: tabEnd רק כשיש שורת פריט
  assert.ok(!/<w:tabs>/.test(xml.replace(cellX, "")), "tabs רק בתא שדה 8");
  // htmlRuns: מפריד fs => טאב בלי הטקסט שבו; para: tabEnd
  const r = D.htmlRuns("<span class='fl'><span class='fn'>1. א</span><span class='fs'> — </span><span class='fd'>9 מ׳</span></span>");
  assert.equal((r.match(/<w:tab\/>/g) || []).length, 1); assert.ok(!r.includes(" — ") && !r.includes("—"));
  assert.ok(D.helpers.para("", { tabEnd: 5000 }).startsWith('<w:p><w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="5000"/></w:tabs><w:bidi/>')); assert.ok(!/<w:tabs>/.test(D.helpers.para("", {})));
});

// בדיקת ההצגה בפועל (כמו בדיקת LibreOffice הקיימת): בכל שורת פריט המספר והשם מימין, המרחק בקצה השמאלי, וכל המרחקים מסתיימים באותו קו. מדלג אם soffice/pdftotext לא מותקנים
test("Word + LibreOffice: שורות הפריטים בשדה 8 — המספר והשם מימין, המרחק בקצה השמאלי של התא וכל המרחקים באותו קו (מדלג בלי soffice/pdftotext)", async t => {
  const has = (c, a) => { const r = spawnSync(c, a, { encoding: "utf8", timeout: 20000 }); return !r.error && r.status === 0; };
  if (!has("soffice", ["--version"]) || !has("pdftotext", ["-v"])) return t.skip("soffice/pdftotext לא מותקנים");
  const data = mkData(fixture("yarkon")), res = C.analyze(baseInput, data, cfg, now), first = res.nearScan.inside.slice(0, 4);
  assert.equal(first.length, 4, "תנאי המבחן: ארבעה פריטים בתוך האזור");
  const bytes = await D.build(O.docxModel(res, data, cfg, { includeChecks: false })), tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reqlist-"));
  try {
    fs.writeFileSync(path.join(tmp, "r.docx"), bytes);
    const cv = spawnSync("soffice", ["--headless", "-env:UserInstallation=file://" + path.join(tmp, "profile"), "--convert-to", "pdf", "--outdir", tmp, path.join(tmp, "r.docx")], { encoding: "utf8", timeout: 170000 });
    if (!fs.existsSync(path.join(tmp, "r.pdf"))) return t.skip("LibreOffice לא הפיק PDF: " + (cv.error ? cv.error.message : String(cv.stderr).slice(0, 120)));
    assert.equal(spawnSync("pdftotext", ["-bbox", path.join(tmp, "r.pdf"), path.join(tmp, "r.html")], { encoding: "utf8" }).status, 0, "pdftotext");
    const html = fs.readFileSync(path.join(tmp, "r.html"), "utf8"), re = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="[\d.]+">([^<]*)<\/word>/g;
    const ws = [...html.split("<page ")[1].matchAll(re)].map(m => ({ x0: +m[1], y: +m[2], x1: +m[3], t: m[4] }));
    // שורה = כל המילים באותו גובה (±2 נק׳); נקודות הקו המנחה אינן נספרות. האסימונים: המרחק (למשל 109) והמספר 161 שבשם הפריט הראשון
    const lineOf = tok => { const w = ws.find(v => v.t === tok); assert.ok(w, "חסר ב-PDF: " + tok); return ws.filter(v => Math.abs(v.y - w.y) < 2 && !/^\.+$/.test(v.t)).sort((a, b) => a.x0 - b.x0); };
    const lines = first.map(it => lineOf(O.dLabel(it.d).split(" ")[0]));
    const left = lines.map(l => l[0].x0), right = lines.map(l => l[l.length - 1].x1);
    assert.ok(Math.max(...left) - Math.min(...left) <= 1.5, "המרחקים מסתיימים באותו קו שמאלי: " + left.join(", "));
    assert.ok(Math.max(...right) - Math.min(...right) <= 1.5, "המספרים והשמות מתחילים באותו קו ימני: " + right.join(", "));
    const l1 = lines[0], x = tok => { const w = l1.find(v => v.t === tok); assert.ok(w, "חסר בשורה: " + tok + " | " + l1.map(v => v.t).join(" ")); return w.x0; };
    assert.ok(x("109") < x("161"), "המרחק משמאל לשם (בקריאה מימין לשמאל: שם ואז מרחק): " + l1.map(v => v.t).join(" "));
    assert.ok(Math.min(...left) < Math.max(...right) - 150, "המרחק רחוק מהשם — בקצה התא, לא צמוד אליו");
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

/* ===== השער (gate.js) הוסר מדף הבקשות: מי שרכש רק כרטיס בקשות (בלי מנוי מפה) לא מופנה לדף התשלום של המפה; הגישה לבקשות נקבעת בשרת לפי כרטיס האירוע. המפה עצמה ממשיכה להיות מוגנת בשער ===== */
test("״שמור הכול במחשב״: כפתור ZIP בתוך ״אפשרויות נוספות״ לכל חשבון, מושבת עד שהבקשה מוכנה, ובונה את אותם קבצים שנשמרים בדרייב (בלי קובץ הנתונים הפנימי)", () => {
  const html = readReq("index.html"), ui = readReq("js/ui.js");
  assert.match(html, /<div id="moreOptions" hidden>\s*<div class="row">\s*<button type="button" class="primary" id="btnZip" disabled>שמור הכול במחשב/, "הכפתור ראשון בלוח ״אפשרויות נוספות״ ומושבת בקובץ");
  assert.match(ui, /async function requestFiles\(withData\)/); assert.match(ui, /const files = await requestFiles\(true\);/, "הדרייב משתמש באותה רשימת קבצים (כולל נתוני הבקשה)");
  assert.match(ui, /\(await requestFiles\(false\)\)\.forEach\(f => zip\.file\(f\.name, f\.b64, \{ base64: true \}\)\)/, "ה-ZIP בלי קובץ הנתונים הפנימי");
  assert.match(ui, /if \(!authed\(\) \|\| !S\.res \|\| !S\.ready \|\| !window\.JSZip \|\| S\.zipping\) return;/, "בלי התחברות או בלי מוכנות אין הורדה");
  assert.match(ui, /if \(S\.rev !== rev0 \|\| S\.res !== res0\) \{[^}]*הבקשה שונתה בזמן הכנת הקובץ/, "עריכה בזמן הבנייה: לא מורידים קובץ מעורב");
  assert.match(ui, /\$\("btnZip"\)\.onclick = downloadZip;/);
  assert.ok(/btnZip: "שומר במחשב שלכם קובץ ZIP אחד/.test(ui) && /btnZip: "שמירת כל הקבצים במחשב"/.test(ui), "הסבר ״!״ ושם נגיש");
});

test("דף הבקשות בלי gate.js (כניסה לפי כרטיס האירוע בשרת), והמפה עדיין מוגנת בשער", () => {
  const html = readReq("index.html");
  assert.ok(!/gate\.js/.test(html), "אין טעינה של gate.js בדף הבקשות");
  assert.ok(!/icdGate/.test(html), "אין שאריות של השער בדף הבקשות");
  const map = fs.readFileSync(path.join(ROOT, "members-k38p/index.html"), "utf8");
  assert.match(map, /<script src="gate\.js"><\/script>/, "המפה עדיין טוענת את השער");
});

/* ========================================================================================================================================================
   שלב ב׳ — פלטים (O2): עמוד "דיווח לגורמים נוספים" (Word + מסך + שורת מייל), דוח "בדיקה חוזרת" (Word נפרד) ומייל עדכון. [בלוק O2 — סוף הקובץ]
   כשהדגלים (features.parties / features.recheck) כבויים הפלט זהה לשלב א׳ (טביעות אצבע מ-HEAD לפני שלב ב׳); ה-Word החדש עומד בסדר האלמנטים של הסכמה (ECMA-376).
   ======================================================================================================================================================== */
const PB_P = require(path.join(ROOT, "members-k38p/requests/js/parties.js")), PB_RC = require(path.join(ROOT, "members-k38p/requests/js/recheck.js"));
const PB_feat = f => Object.assign({}, cfg, { features: Object.assign({}, cfg.features, f) });
const PB_ON = PB_feat({ parties: true, recheck: true }), PB_OFF = PB_feat({ parties: false, recheck: false });
const PB_NOFEAT = (() => { const c = Object.assign({}, cfg); delete c.features; return c; })();   // מפתח חסר = פעיל
const PB_data = mkData(fixture("yarkon")), PB_res = C.analyze(baseInput, PB_data, cfg, now), PB_rows = PB_P.build(PB_res, cfg, PB_data);
const pbDocXml = async m => (await JSZipNode.loadAsync(await D.build(m))).file("word/document.xml").async("string");
const pbPlain = xml => xml.replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "").replace(BIDI_MARKS, "").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const pbTable = (xml, marker) => { const t = xml.split("<w:tbl>").slice(1).map(s => s.split("</w:tbl>")[0]).find(s => s.includes(marker)); assert.ok(t, "טבלה עם " + marker); return t; };
// שורת גורם ידנית לבדיקות (המבנה ש-ReqParties מייצרת); over מחליף שדות
const pbRow = over => {
  const r = Object.assign({ key: "z:T1", src: "zone", title: "אזור בדיקה", tag: "", party: "", contacts: { phones: [], emails: [], urls: [], lines: [], pairs: null, general: null }, contactSrc: "", hasContact: false, dtype: "report", mark: {}, type: "report", status: "unmarked", note: "" }, over);
  const c = r.contacts; r.hasContact = !!(c.phones.length || c.emails.length || c.urls.length || c.lines.length || c.general); return r;
};
const pbPhone = (display, kind) => ({ raw: display, display, text: display, kind: kind || "landline", tel: "", range: "" });

/* ---------- Phase A זהה כשהדגלים כבויים: טביעת אצבע (מודל JSON, document.xml, מייל) שחושבה מהקוד שלפני שלב ב׳ (HEAD 0c82775) ---------- */
// ה-footer של מודל ה-Word תלוי באזור הזמן/ICU — לכן toLocale* מוחלפות זמנית בפורמט קבוע; ההשוואה לא תלויה במכונה. שינוי מכוון בפלט של שלב א׳ מחייב לעדכן את PB_GOLD (הריצה מדפיסה את הערכים החדשים)
const PB_GOLD = { checks: ["0e0b48183e5defa6", "da0adb25eb1994f4", 28], plain: ["e42154bb5d9aab35", "83d2e90a57a58386", 28], images: ["eb83fa6d9be01443", "4d795955d253fd7e", 28], mail: "7c4f9ff7ca158346" };
async function pbFingerprint(c, extra) {
  extra = extra || {};
  const img = k => ({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9, k]), w: 800, h: 600 }), sha = s => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
  const L = Date.prototype.toLocaleString, LD = Date.prototype.toLocaleDateString;
  Date.prototype.toLocaleString = function () { return this.toISOString(); }; Date.prototype.toLocaleDateString = function () { return this.toISOString().slice(0, 10); };
  try {
    const out = {}, res = C.analyze(baseInput, PB_data, c, now);
    const variants = { checks: { includeChecks: true, adv: true }, plain: { includeChecks: false, adv: false, draft: "יש בדיקות שלא הושלמו" }, images: { includeChecks: true, adv: false, review: "אישור", providerName: "ספק", images: { aerial: img(1), street: img(2), overview: img(3), region: img(4) } } };
    for (const [k, o] of Object.entries(variants)) {
      const m = O.docxModel(res, PB_data, c, Object.assign({ now }, o, extra.docx)), z = await JSZipNode.loadAsync(await D.build(m));
      out[k] = [sha(JSON.stringify(m, (_, v) => (v instanceof Uint8Array ? Array.from(v) : v))), sha(await z.file("word/document.xml").async("string")), Object.keys(m).length];
    }
    out.mail = sha(JSON.stringify(O.mail(res, c, extra.mail)));
    return out;
  } finally { Date.prototype.toLocaleString = L; Date.prototype.toLocaleDateString = LD; }
}
test("שלב ב׳ O2: בלי אפשרויות שלב ב׳ הפלט זהה לשלב א׳ — מודל, document.xml ומייל (טביעת אצבע מהקוד שלפני השינוי)", async () => {
  for (const f of ["partiesPage", "partiesHtml", "partiesMailLine", "recheckDocxModel", "mailUpdate"]) assert.equal(typeof O[f], "function", "O." + f); assert.equal(typeof D.buildRecheck, "function");   // הבדיקה אינה ריקה: הקוד של שלב ב׳ קיים
  assert.deepEqual(await pbFingerprint(cfg), PB_GOLD, "ברירת מחדל (בלי parties/update)");
  assert.deepEqual(await pbFingerprint(PB_NOFEAT), PB_GOLD, "בלי features בכלל");
  assert.deepEqual(await pbFingerprint(PB_ON), PB_GOLD, "דגלים פעילים אך המתקשר לא העביר parties/update — אין פלט חדש");
  assert.deepEqual(await pbFingerprint(PB_ON, { docx: { parties: undefined }, mail: {} }), PB_GOLD);
});
test("שלב ב׳ O2: דגלים כבויים — גם כשמועברות שורות גורמים ועדכון הפלט זהה לשלב א׳ (בלי עמוד, בלי שורת מייל, בלי קידומת/משפט עדכון, בלי מפתח parties במודל)", async () => {
  const extra = { docx: { parties: PB_rows, partiesDropped: 3, partiesFailed: true }, mail: { parties: PB_rows, update: { sentAt: now } } };
  assert.deepEqual(await pbFingerprint(PB_OFF, extra), PB_GOLD);
  const m = O.docxModel(PB_res, PB_data, PB_OFF, { now, parties: PB_rows });
  assert.ok(!("parties" in m), "אין מפתח parties");
  // דגל אחד כבוי אינו משפיע על השני
  assert.ok("parties" in O.docxModel(PB_res, PB_data, PB_feat({ parties: true, recheck: false }), { now, parties: PB_rows }));
  assert.ok(!("parties" in O.docxModel(PB_res, PB_data, PB_feat({ parties: false, recheck: true }), { now, parties: PB_rows })));
  assert.equal(O.mail(PB_res, PB_feat({ parties: true, recheck: false }), { update: { sentAt: now } }).subject, O.mail(PB_res, cfg).subject);
  assert.ok(!/מחליפה/.test(O.mail(PB_res, PB_feat({ parties: true, recheck: false }), { update: { sentAt: now } }).body), "recheck כבוי — אין משפט החלפה");
  assert.ok(/דיווח לגורמים נוספים/.test(O.mail(PB_res, PB_feat({ parties: true, recheck: false }), { parties: PB_rows }).body));
  assert.ok(!/דיווח לגורמים נוספים/.test(O.mail(PB_res, PB_feat({ parties: false, recheck: true }), { parties: PB_rows }).body));
});

/* ---------- עמוד "דיווח לגורמים נוספים" ב-Word ---------- */
const PB_img = k => ({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9, k]), w: 800, h: 600 });
const PB_imgs = { aerial: PB_img(1), street: PB_img(2), overview: PB_img(3), region: PB_img(4) };
test("Word: עמוד הגורמים אחרי הטופס והתמונות ולפני דף הבדיקות, בעמוד חדש; טבלה של שש עמודות ברוחב התוכן, כותרת חוזרת ושורות שאינן נשברות", async () => {
  let rows = PB_P.setField(PB_rows, PB_rows[0].key, "status", "done").rows; rows = PB_P.setField(rows, PB_rows[0].key, "note", "דווח לשב״ס").rows;
  const m = O.docxModel(PB_res, PB_data, cfg, { now, includeChecks: true, images: PB_imgs, parties: rows }), xml = await pbDocXml(m), lines = pbPlain(xml).split("\n");
  const T = PB_P.TEXT, sum = PB_P.summary(rows);
  assert.equal(m.parties.head, T.title); assert.equal(m.parties.head, "דיווח לגורמים נוספים");
  assert.equal(m.parties.sub, T.paperNote); assert.equal(m.parties.summary, PB_P.summaryText(sum)); assert.equal(m.parties.rows.length, rows.length);
  assert.deepEqual(m.parties.rows.map(r => r.n), rows.map((_, i) => i + 1));
  assert.equal(m.parties.footer, T.footer(now.toLocaleString("he-IL")), "תחתית: נוסח ReqParties + מועד");
  const iImg = lines.findIndex(l => l.startsWith("הדמיה מצורפת — מפת אזור")), iPar = lines.indexOf(T.title), iChk = lines.findIndex(l => l.startsWith("דף בדיקות — לא חלק מהטופס הרשמי"));
  assert.ok(iImg > 0 && iPar > iImg && iChk > iPar, `סדר העמודים: ${iImg} < ${iPar} < ${iChk}`);
  assert.ok(lines.includes(T.paperNote) && lines.includes(m.parties.summary) && lines.includes(m.parties.footer.replace(/‏/g, "")), "משנה, סיכום ותחתית בעמוד");
  const head = xml.split("</w:p>").find(p => pbPlain(p + "</w:p>").trim() === T.title);
  assert.match(head, /<w:pageBreakBefore\/>/, "העמוד נפתח בעמוד חדש");
  const tbl = pbTable(xml, ">גורם<");
  assert.deepEqual([...tbl.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map(x => +x[1]), [460, 2300, 900, 2900, 1200, 2146]);
  assert.equal(460 + 2300 + 900 + 2900 + 1200 + 2146, D.helpers.CONTENT_W, "הרוחב = רוחב התוכן");
  assert.deepEqual([...tbl.split("</w:tr>")[0].matchAll(/<w:t xml:space="preserve">([^<]*)<\/w:t>/g)].map(x => x[1]), ["#", "גורם", "סוג", "פרטי קשר", "סטטוס", "הערה"]);
  assert.equal((tbl.match(/<w:tblHeader\/>/g) || []).length, 1, "שורת כותרת חוזרת"); assert.equal((tbl.match(/<w:tr>/g) || []).length, rows.length + 1); assert.equal((tbl.match(/<w:cantSplit\/>/g) || []).length, rows.length + 1);
  assert.match(tbl, /w:fill="EEEEEE"/, "כותרת באפור");
  const body = pbPlain(tbl);
  assert.ok(body.includes("LLU20") && body.includes(PB_P.STATUS_LABEL.done) && body.includes("דווח לשב״ס") && body.includes(PB_P.STATUS_LABEL.nocontact) && body.includes(PB_P.TYPE_LABEL.update) && body.includes(PB_P.TYPE_LABEL.report), "תוכן: גורם, סטטוס, הערה וסוגים");
  assert.ok(!/<w:tbl>/.test(tbl), "בלי טבלה מקוננת"); assert.ok(wellFormed(xml)); const lint = xmllint(xml); if (lint !== null) assert.equal(lint, "", "xmllint: " + lint);
});
test("Word: העמוד נכלל גם בלי דף בדיקות ובלי תמונות; רשימה ריקה — משפט 'לא נמצאו גורמים' בלי טבלה; כשל בהכנה — נוסח הכשל; חיתוך בתקרה — הודעה", async () => {
  const T = PB_P.TEXT;
  const part = await pbDocXml(O.docxModel(PB_res, PB_data, cfg, { now, includeChecks: false, parties: PB_rows }));
  assert.ok(pbPlain(part).split("\n").includes(T.title) && !/דף בדיקות — לא חלק/.test(pbPlain(part)), "includeChecks כבוי: עמוד הגורמים נשאר");
  const emptyM = O.docxModel(PB_res, PB_data, cfg, { now, parties: [] }), ex = await pbDocXml(emptyM);
  assert.equal(emptyM.parties.empty, T.empty); assert.equal(emptyM.parties.rows.length, 0); assert.equal(emptyM.parties.summary, "");
  assert.ok(pbPlain(ex).split("\n").includes("לא נמצאו גורמים בסריקה, ולא נוספו גורמים ידנית.") && !ex.includes(">גורם<"), "ריק: משפט ובלי טבלה");
  assert.equal(O.docxModel(PB_res, PB_data, cfg, { now, parties: [], partiesFailed: true }).parties.empty, T.failed, "ריק + נכשל");
  assert.equal(O.docxModel(PB_res, PB_data, cfg, { now, parties: PB_rows.slice(0, 2), partiesFailed: true }).parties.empty, "", "יש שורות — נכשל לא מחליף אותן");
  assert.equal(O.docxModel(PB_res, PB_data, cfg, { now, parties: PB_rows.slice(0, 2), partiesDropped: 3 }).parties.note, T.dropped(3));
  assert.equal(O.docxModel(PB_res, PB_data, cfg, { now, parties: PB_rows.slice(0, 2), partiesDropped: 0 }).parties.note, ""); assert.equal(O.docxModel(PB_res, PB_data, cfg, { now, parties: [], partiesDropped: 3 }).parties.note, "", "בלי שורות אין הודעת חיתוך"); assert.equal(O.docxModel(PB_res, PB_data, cfg, { now, parties: PB_rows.slice(0, 2), partiesDropped: -4 }).parties.note, "");
  // parties שאינו מערך (null, אובייקט, מחרוזת) — אין עמוד, והמודל זהה לשלב א׳
  for (const bad of [null, undefined, {}, "x", 5, true]) assert.ok(!("parties" in O.docxModel(PB_res, PB_data, cfg, { now, parties: bad })), JSON.stringify(bad));
  // שורות פגומות במערך (null, מספר, מחרוזת) נזרקות; שורה שבורה לא מפילה את העמוד
  const mixed = O.docxModel(PB_res, PB_data, cfg, { now, parties: [null, 5, "x", pbRow({ title: "תקין" }), { title: "בלי כלום", contacts: 7 }] });
  assert.equal(mixed.parties.rows.length, 2); assert.equal(mixed.parties.rows[0].party[0].t, "תקין"); assert.deepEqual(mixed.parties.rows[1].contact, [{ t: T.noContact, m: true }], "שורה שבורה: 'לא נמצא פרט קשר'");
  // תקרת בטיחות: מערך ענק נחתך
  assert.equal(O.docxModel(PB_res, PB_data, cfg, { now, parties: new Array(500).fill(0).map((_, i) => pbRow({ key: "z:" + i, title: "גורם " + i })) }).parties.rows.length, 120);
});
test("תא פרטי קשר: עד שלושה קטעים (זוג תווית–מספר = קטע אחד) ו-'ועוד N'; מקור הפרט בשורה קטנה; בלוק בלי קטעים מצוטטים — רשימה אחת; לא אומת מסומן; אין פרט קשר — 'לא נמצא פרט קשר' (+ משפט תיאום)", () => {
  const T = PB_P.TEXT, contact = r => O.docxModel(PB_res, PB_data, cfg, { now, parties: [r] }).parties.rows[0].contact;
  const five = pbRow({ contacts: { phones: [pbPhone("03-5038875")], emails: [], urls: [], lines: ["קטע א׳ 03-5038875", "קטע ב׳", "קטע ג׳", "קטע ד׳", "קטע ה׳"], pairs: null, general: null }, contactSrc: "פמ״ת א-17 (עמ׳ 6, עדכון 1/25)" });
  assert.deepEqual(contact(five), [{ t: "קטע א׳ 03-5038875" }, { t: "קטע ב׳" }, { t: "קטע ג׳" }, { t: T.srcPrefix + "פמ״ת א-17 (עמ׳ 6, עדכון 1/25)", s: true, m: true }, { t: T.more(2), s: true, m: true }]);
  const pairs = [{ label: "מטה ארצי", phone: pbPhone("074-7833333", "voip") }, { label: "מחוז צפון", phone: pbPhone("074-7834080", "voip") }];
  const gen = { label: PB_P.GENERAL_LLU_LABEL, src: "פמ״ת א-17 עמ׳ 5", phones: pairs.map(p => p.phone), emails: [], lines: [], pairs };
  assert.deepEqual(contact(pbRow({ contacts: { phones: [], emails: [], urls: [], lines: [], pairs: null, general: gen } })), [{ t: PB_P.GENERAL_LLU_LABEL + ":", b: true, s: true }, { t: "מטה ארצי 074-7833333 · מחוז צפון 074-7834080" }, { t: T.srcPrefix + "פמ״ת א-17 עמ׳ 5", s: true, m: true }]);
  // הקטעים של הגורם עצמו תופסים את התקרה — ההנחיה הכללית (זוגות) נספרת ב"ועוד" ולא מוצגת, כך שלא יופיע מספר בלי התווית שלו
  const full = contact(pbRow({ contacts: { phones: [], emails: [], urls: [], lines: ["א", "ב", "ג"], pairs: null, general: gen } }));
  assert.deepEqual(full.map(l => l.t), ["א", "ב", "ג", T.more(1)]); assert.ok(!JSON.stringify(full).includes("074-7833333"));
  assert.deepEqual(contact(pbRow({ contacts: { phones: [], emails: [], urls: [], lines: ["א", "ב"], pairs: null, general: gen } })).map(l => l.t), ["א", "ב", PB_P.GENERAL_LLU_LABEL + ":", "מטה ארצי 074-7833333 · מחוז צפון 074-7834080", T.srcPrefix + "פמ״ת א-17 עמ׳ 5"], "זוגות = קטע שלישי");
  // OSM: בלי קטעים מצוטטים — טלפון, דוא״ל ואתר ברשימה אחת; טלפון שלא אומת מסומן
  const osm = pbRow({ src: "osm", contacts: { phones: [pbPhone("03-6427080"), pbPhone("1-800-X", "unverified")], emails: ["a@b.co"], urls: ["https://www.lunapark.co.il/"], lines: [], pairs: null, general: null }, contactSrc: "OpenStreetMap (phone, website) — לא מאומת" });
  assert.deepEqual(contact(osm), [{ t: "03-6427080 · 1-800-X (" + T.unverified + ") · a@b.co · https://www.lunapark.co.il/" }, { t: T.srcPrefix + "OpenStreetMap (phone, website) — לא מאומת", s: true, m: true }]);
  assert.deepEqual(contact(pbRow({})), [{ t: T.noContact, m: true }]);
  assert.deepEqual(contact(pbRow({ cue: "לתאם בטלפון המפורסם בפרק א׳ 07." })), [{ t: T.noContact, m: true }, { t: "לתאם בטלפון המפורסם בפרק א׳ 07.", s: true, m: true }]);
  // שורה ידנית: מה שהוקלד, בלי "מקור"
  assert.deepEqual(contact({ key: "m:1", src: "manual", manual: true, title: "בעל הקרקע", contact: "050-1234567", contacts: { phones: [], emails: [], urls: [], lines: [], pairs: null, general: null }, hasContact: false, mark: {}, type: "approval", status: "needed", note: "" }), [{ t: "050-1234567" }]);
  assert.deepEqual(contact({ key: "m:2", src: "manual", manual: true, title: "x", contact: "", mark: {}, type: "approval", status: "needed", note: "" }), [{ t: T.noContact, m: true }]);
});
test("תא הגורם והסוג/סטטוס: כותרת מודגשת, מרחק/תג, גורם מוזכר, 'מחוץ לטווח'; סוג וסטטוס מהתוויות של ReqParties; ערך לא מוכר (גם שמות מאב-הטיפוס) לא מתפרש", () => {
  const T = PB_P.TEXT, m = O.docxModel(PB_res, PB_data, cfg, { now, parties: [
    pbRow({ title: "נוטם C1", tag: "בקרבה", party: "מוזכר בנוטם: קצין ביטחון", stale: true, type: "approval", status: "done", note: "הערה" }),
    pbRow({ key: "z:2", type: "constructor", status: "toString" }), pbRow({ key: "z:3", type: "__proto__", status: "hasOwnProperty" }), pbRow({ key: "z:4", type: undefined, status: undefined })] }).parties.rows;
  assert.deepEqual(m[0].party, [{ t: "נוטם C1", b: true }, { t: "בקרבה", s: true, m: true }, { t: "מוזכר בנוטם: קצין ביטחון", s: true }, { t: T.outOfRange, s: true, m: true }]);
  assert.equal(m[0].type, PB_P.TYPE_LABEL.approval); assert.equal(m[0].status, PB_P.STATUS_LABEL.done); assert.equal(m[0].note, "הערה");
  for (const r of m.slice(1)) { assert.equal(r.type, "", "סוג לא מוכר — ריק"); assert.equal(r.status, PB_P.STATUS_LABEL.unmarked, "סטטוס לא מוכר — טרם סומן"); }
});

/* ---------- שורת המייל ---------- */
test("מייל: שורה אחת '• דיווח לגורמים נוספים: N גורמים — M דווחו/התקבל אישור' אחרי שורת הסגירה, בתוך אותו בלוק נקודות; בלי שמות/טלפונים; הנושא לא משתנה", () => {
  const mk = st => PB_rows.map((r, i) => Object.assign({}, r, { status: st(i) })), base = O.mail(PB_res, cfg);
  const rows = mk(i => (i < 2 ? "done" : "needed")), m = O.mail(PB_res, cfg, { parties: rows }), ls = m.body.split("\n");
  const bullet = "• דיווח לגורמים נוספים: " + rows.length + " גורמים — 2 דווחו/התקבל אישור";
  assert.equal(PB_P.mailLine(PB_P.summary(rows)), bullet.slice(2));
  assert.equal(ls.filter(l => l.startsWith("• ")).length, 5, "ארבע הנקודות של שלב א׳ + אחת");
  const i = ls.indexOf(bullet); assert.ok(i > 0, "הנקודה קיימת"); assert.ok(ls[i - 1].startsWith("• סגירה:") && ls[i + 1] === "" && ls[i + 2].startsWith("קבצים מצורפים"), "ממוקמת אחרי הסגירה, בתוך בלוק הנקודות");
  assert.deepEqual(ls.slice(0, i).concat(ls.slice(i + 1)), base.body.split("\n"), "שאר הגוף זהה לשלב א׳");
  assert.equal(m.subject, base.subject); assert.deepEqual(m.to, base.to); assert.ok(decodeURIComponent(m.mailto).includes(bullet), "גם ב-mailto");
  assert.ok(!/LLU20|074-|03-|@/.test(bullet), "בלי שמות וטלפונים");
  // ללא M: רק הסך; גורם אחד; אפס שורות או שורות לא תקינות — אין שורה; סיכום מוכן; מספרים עוינים
  assert.ok(O.mail(PB_res, cfg, { parties: mk(() => "needed") }).body.includes("\n• דיווח לגורמים נוספים: " + rows.length + " גורמים\n"));
  assert.ok(O.mail(PB_res, cfg, { parties: [Object.assign({}, rows[0], { status: "done" })] }).body.includes("\n• דיווח לגורמים נוספים: גורם אחד — 1 דווח/התקבל אישור\n"));
  for (const none of [[], null, undefined, {}, "x", 7, [null, 3], { total: 0, done: 0 }, { total: -3, done: 2 }, { total: "x" }, { total: NaN }]) assert.equal(O.mail(PB_res, cfg, { parties: none }).body, base.body, JSON.stringify(none));
  assert.ok(O.mail(PB_res, cfg, { parties: { total: 4, done: 2 } }).body.includes("\n• דיווח לגורמים נוספים: 4 גורמים — 2 דווחו/התקבל אישור\n"));
  assert.ok(O.mail(PB_res, cfg, { parties: { total: 3, done: 99 } }).body.includes("3 גורמים — 3 דווחו/התקבל אישור"), "done מוגבל ל-total");
  assert.ok(O.mail(PB_res, cfg, { parties: { total: 2.9, done: "1" } }).body.includes("2 גורמים — 1 דווח/התקבל אישור"));
  assert.equal(O.partiesMailLine(rows, PB_OFF), ""); assert.equal(O.partiesMailLine(rows, PB_NOFEAT), bullet.slice(2));
});

/* ---------- מסך: אותו עמוד כ-HTML מוגן ---------- */
// קלט עוין בכל השדות שמוצגים: אסור שיוזרק HTML/XML, והטקסט נשמר כלשונו
const PB_HOSTILE = pbRow({ key: "o:x", src: "osm", title: '<img src=x onerror=alert(1)> "q" & \'a\' ' + fcc(0xb) + "ו" + fcc(0xfffe), tag: "</td><script>1</script>", party: "<b>x</b>", note: "<svg/onload=alert(2)>&amp;" + fcc(0xd800),
  contacts: { phones: [pbPhone("03-1234567")], emails: ['a"><i>@b.co'], urls: ["https://x.il/?a=1&b=<2>"], lines: ["<script>alert(3)</script> 03-1111111"], pairs: null, general: null }, contactSrc: 'OpenStreetMap "<u>"', cue: "<em>" });
test("HTML: עמוד הגורמים במסך — מבנה, כותרות עמודה, תוכן זהה למודל, ואסימונים לטיניים/מספרים ב-bdi ltr (טלפון: class ph)", () => {
  const m = O.docxModel(PB_res, PB_data, cfg, { now, parties: PB_rows }), h = O.partiesHtml(m.parties), txt = h.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|");
  assert.ok(h.startsWith("<div class='paper parties'>") && !/class='paper checks'|class='checks'/.test(h), "עמוד נפרד שאינו מושפע מתיבת ״כולל דף בדיקות״");
  assert.equal((h.match(/<tr>/g) || []).length, PB_rows.length + 1); assert.equal((h.match(/<th scope='col'>/g) || []).length, 6);
  assert.deepEqual([...h.matchAll(/<th scope='col'>([^<]*)<\/th>/g)].map(x => x[1]), ["#", "גורם", "סוג", "פרטי קשר", "סטטוס", "הערה"]);
  assert.ok(/aria-label="דיווח לגורמים נוספים"/.test(h), "שם נגיש לטבלה"); assert.ok(h.includes(PB_P.TEXT.paperNote) && h.includes(m.parties.summary) && h.includes(E(m.parties.footer)));
  assert.ok(h.includes("<bdi dir='ltr' class='ph'>074-7833333</bdi>") && h.includes("<bdi dir='ltr'>LLU20</bdi>") && /<bdi dir='ltr'>https:\/\/www\.lunapark\.co\.il\/<\/bdi>/.test(h), "טלפון, מזהה וכתובת אתר ב-bdi");
  assert.ok(!/<bdi dir='ltr' class='ph'>[^<]*[A-Za-z]/.test(h), "class ph רק למספרי טלפון");
  // הטקסט שבתאים (בלי תגיות) זהה לשורות המודל
  const rowsHtml = h.split("<tbody>")[1].split("</tbody>")[0].split("</tr>").filter(x => x.includes("<td"));
  rowsHtml.forEach((tr, k) => { const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(x => x[1]), r = m.parties.rows[k], flat = ls => ls.map(l => l.t).join("\n");
    assert.equal(cells[1].replace(/<br>/g, "\n").replace(/<[^>]+>/g, ""), E(flat(r.party)).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"'));
    assert.equal(cells[3].replace(/<br>/g, "\n").replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&"), flat(r.contact).replace(/&/g, "&"), "פרטי קשר שורה " + (k + 1)); });
  // ריק / כשל / null
  assert.ok(O.partiesHtml(O.docxModel(PB_res, PB_data, cfg, { now, parties: [] }).parties).includes("<p>" + PB_P.TEXT.empty + "</p>") && !O.partiesHtml(O.docxModel(PB_res, PB_data, cfg, { now, parties: [] }).parties).includes("<table"));
  for (const bad of [null, undefined, 0, "x", []]) assert.equal(O.partiesHtml(bad), "", JSON.stringify(bad));
  assert.equal(O.partiesHtml({}), ""); assert.equal(O.partiesHtml({ rows: [] }), "", "בלי כותרת אין עמוד"); assert.doesNotThrow(() => O.partiesHtml({ head: "x", rows: [null, 3, { party: "x", contact: null }] }));
});
test("קלט עוין (HTML/XML/בקרה/כיווניות) בשורות הגורמים: מוצג כטקסט בלבד ב-HTML וב-Word, ה-XML תקין, ואין כתובת/טלפון של הארגון בפלט", async () => {
  const rows = [PB_HOSTILE, pbRow({ key: "m:1", src: "manual", manual: true, title: "בעל <b>הקרקע</b>", contact: "<i>050</i>", mark: {}, type: "approval", status: "needed", note: "x".repeat(10) })];
  const m = O.docxModel(PB_res, PB_data, cfg, { now, parties: rows.concat(PB_rows) }), h = O.partiesHtml(m.parties), xml = await pbDocXml(m);
  const injected = h.match(/<(?!\/?(?:bdi|small|span|b|td|tr|th|br|table|tbody|thead|colgroup|col|div|p)\b)[a-z][^>]*>/gi); assert.equal(injected, null, "תגיות שלא מהתבנית: " + injected);
  const hText = h.replace(/<[^>]+>/g, "");   // בלי תגיות התבנית (bdi/small/b…): נשאר הטקסט עם ה-entities
  assert.ok(hText.includes("&lt;img src=x onerror=alert(1)&gt;") && hText.includes("&lt;/td&gt;&lt;script&gt;1&lt;/script&gt;") && hText.includes("&lt;svg/onload=alert(2)&gt;&amp;amp;"), "הטקסט כלשונו, מוגן: " + hText.slice(0, 200));
  assert.ok(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾�]/.test(m.parties.rows[0].party[0].t), "תווי בקרה מנוקים במודל");
  assert.ok(wellFormed(xml) && !XML_BAD.test(xml) && !xml.includes("<script") && !xml.includes("<img"), "Word: XML מאוזן, בלי תו אסור, בלי תגית");
  assert.ok(pbPlain(xml).includes("<img src=x onerror=alert(1)>") && pbPlain(xml).includes("<svg/onload=alert(2)>&amp;"), "Word: הטקסט כלשונו (esc)");
  const lint = xmllint(xml); if (lint !== null) assert.equal(lint, "", "xmllint: " + lint);
  for (const out of [JSON.stringify(m.parties), h, pbPlain(xml), O.mail(PB_res, cfg, { parties: rows.concat(PB_rows) }).body]) assert.ok(!/icd\.org\.il|052-?5076677/i.test(out), "כתובת/טלפון של הארגון בפלט");
  assert.ok(!new RegExp(ORG_ADDR.replace(".", "\\.")).test(JSON.stringify(m.parties)));
  // הערה ארוכה, שם ארוך ופרטי קשר ארוכים נחתכים בתקרות של ReqParties (לא מנפחים את העמוד)
  const long = O.docxModel(PB_res, PB_data, cfg, { now, parties: [pbRow({ title: "ת".repeat(5000), note: "נ".repeat(5000), contactSrc: "מ".repeat(5000), contacts: { phones: [], emails: [], urls: [], lines: ["ק".repeat(5000)], pairs: null, general: null } })] }).parties.rows[0];
  assert.ok(long.party[0].t.length <= 120 && long.note.length <= 300 && long.contact[0].t.length <= 240 && long.contact[1].t.length <= 210, JSON.stringify([long.party[0].t.length, long.note.length, long.contact.map(l => l.t.length)]));
});
test("Word מול מסך: אותם טקסטים — כל שורת תא של המודל מופיעה גם ב-HTML וגם ב-Word", async () => {
  const m = O.docxModel(PB_res, PB_data, cfg, { now, parties: PB_rows.slice(0, 8).concat([PB_HOSTILE]) }), xmlText = pbPlain(await pbDocXml(m)), h = O.partiesHtml(m.parties).replace(/<br>/g, "\n").replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  for (const r of m.parties.rows) for (const l of r.party.concat(r.contact, [{ t: r.type }, { t: r.status }, { t: r.note }])) if (l.t) {
    assert.ok(xmlText.includes(l.t.replace(/[‏]/g, "")), "חסר ב-Word: " + l.t); assert.ok(h.includes(l.t), "חסר ב-HTML: " + l.t);
  }
});

/* ---------- סדר האלמנטים של הסכמה (ECMA-376) בעמודים החדשים ---------- */
// בודק את סדר הילדים באלמנטים שבהם Word קפדן (pPr, rPr, tblPr, tcPr, pBdr, tblBorders, tblCellMar) ואת המבנה: tc נפתח ב-tcPr ונסגר בפסקה, tbl = tblPr, tblGrid, tr…, sectPr אחרון בגוף. סדר הרצפים לפי wml.xsd
const PB_SEQ = {
  pPr: ["pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr", "widowControl", "numPr", "suppressLineNumbers", "pBdr", "shd", "tabs", "suppressAutoHyphens", "kinsoku", "wordWrap", "overflowPunct", "topLinePunct", "autoSpaceDE", "autoSpaceDN", "bidi", "adjustRightInd", "snapToGrid", "spacing", "ind", "contextualSpacing", "mirrorIndents", "suppressOverlap", "jc", "textDirection", "textAlignment", "textboxTightWrap", "outlineLvl", "divId", "cnfStyle", "rPr", "sectPr", "pPrChange"],
  rPr: ["rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike", "dstrike", "outline", "shadow", "emboss", "imprint", "noProof", "snapToGrid", "vanish", "webHidden", "color", "spacing", "w", "kern", "position", "sz", "szCs", "highlight", "u", "effect", "bdr", "shd", "fitText", "vertAlign", "rtl", "cs", "em", "lang", "eastAsianLayout", "specVanish", "oMath"],
  tblPr: ["tblStyle", "tblpPr", "tblOverlap", "bidiVisual", "tblStyleRowBandSize", "tblStyleColBandSize", "tblW", "jc", "tblCellSpacing", "tblInd", "tblBorders", "shd", "tblLayout", "tblCellMar", "tblLook", "tblCaption", "tblDescription"],
  tcPr: ["cnfStyle", "tcW", "gridSpan", "hMerge", "vMerge", "tcBorders", "shd", "noWrap", "tcMar", "textDirection", "tcFitText", "vAlign", "hideMark"],
  pBdr: ["top", "left", "bottom", "right", "between", "bar"], tblBorders: ["top", "left", "bottom", "right", "insideH", "insideV"], tblCellMar: ["top", "left", "bottom", "right"]
};
function pbOrderErrors(xml) {
  const errs = [], stack = [];
  const closeEl = el => {
    const seq = PB_SEQ[el.name]; if (seq) { let at = -1; for (const k of el.kids) { const i = seq.indexOf(k); if (i < 0) errs.push(el.name + ": אלמנט לא צפוי " + k); else if (i < at) errs.push(el.name + ": " + k + " אחרי " + seq[at]); else at = i; } }
    if (el.name === "tc" && (el.kids[0] !== "tcPr" || el.kids[el.kids.length - 1] !== "p")) errs.push("tc: חייב להתחיל ב-tcPr ולהסתיים בפסקה: " + el.kids.join(","));
    if (el.name === "tbl" && (el.kids[0] !== "tblPr" || el.kids[1] !== "tblGrid" || el.kids.slice(2).some(k => k !== "tr"))) errs.push("tbl: " + el.kids.join(","));
    if (el.name === "tr" && el.kids.filter(k => k !== "trPr" && k !== "tc").length) errs.push("tr: " + el.kids.join(","));
    if (el.name === "body" && el.kids.includes("sectPr") && el.kids[el.kids.length - 1] !== "sectPr") errs.push("body: sectPr לא אחרון");
  };
  for (const m of xml.matchAll(/<(\/?)w:([A-Za-z]+)\b[^>]*?(\/?)>/g)) {
    const [, close, name, self] = m;
    if (close) { closeEl(stack.pop()); continue; }
    if (stack.length) stack[stack.length - 1].kids.push(name);
    const el = { name, kids: [] }; if (self) closeEl(el); else stack.push(el);
  }
  if (stack.length) errs.push("תגיות לא סגורות: " + stack.map(s => s.name).join(","));
  return errs;
}
test("בודק סדר הסכמה: מזהה סדר שגוי (בקרת-נגד), ומקבל את הבנאים החדשים", () => {
  assert.deepEqual(pbOrderErrors('<w:p><w:pPr><w:bidi/><w:keepNext/></w:pPr></w:p>'), ["pPr: keepNext אחרי bidi"]);
  assert.deepEqual(pbOrderErrors('<w:tbl><w:tblPr><w:tblW w:w="1" w:type="dxa"/><w:bidiVisual/></w:tblPr><w:tblGrid/></w:tbl>'), ["tblPr: bidiVisual אחרי tblW"]);
  assert.deepEqual(pbOrderErrors('<w:tc><w:tcPr><w:vAlign w:val="top"/><w:tcW w:w="1" w:type="dxa"/></w:tcPr><w:p/></w:tc>'), ["tcPr: tcW אחרי vAlign"]);
  assert.equal(pbOrderErrors('<w:tc><w:tcPr/></w:tc>').length, 1, "תא בלי פסקה");
  assert.ok(pbOrderErrors("<w:p><w:pPr><w:keepNext/><w:pageBreakBefore/><w:pBdr><w:top/><w:left/><w:bottom/><w:right/></w:pBdr><w:shd/><w:bidi/><w:spacing/><w:jc/></w:pPr></w:p>").length === 0);
  // שלב א׳ (para/tableXml הקיימות) מסדר אחרת — נקבע כאן כדי שלא ישתנה בטעות (הפלט ללא דגלים חייב להישאר זהה)
  assert.ok(pbOrderErrors(D.helpers.para("", { keepNext: true })).length > 0 && pbOrderErrors(D.helpers.tableXml([100], [{ cells: [D.helpers.cell(D.helpers.para(""), 100)] }])).length > 0);
  assert.deepEqual(pbOrderErrors(D.helpers.paraS("", { keepNext: true, pageBreakBefore: true, box: "E0A800", shade: "FFF3CD", center: true })), []);
  assert.deepEqual(pbOrderErrors(D.helpers.tableXml([100], [{ header: true, cells: [D.helpers.cell(D.helpers.paraS(""), 100, { fill: "EEEEEE" })] }], { strict: true })), []);
});
test("Word: עמוד הגורמים ודוח הבדיקה החוזרת עומדים בסדר האלמנטים של הסכמה (כולל תוכן עוין, מסגרת הבאנר וטבלאות)", async () => {
  const pm = O.docxModel(PB_res, PB_data, cfg, { now, parties: [PB_HOSTILE].concat(PB_rows) }).parties;
  assert.deepEqual(pbOrderErrors(D.helpers.partiesBody(pm).join("")), [], "עמוד הגורמים");
  assert.deepEqual(pbOrderErrors(D.helpers.partiesBody(O.docxModel(PB_res, PB_data, cfg, { now, parties: [] }).parties).join("")), [], "עמוד ריק");
  const rm = await pbRecheckModel({ hostile: true });
  assert.deepEqual(pbOrderErrors(D.helpers.recheckBody(rm.recheck).join("")), [], "פתיחת דוח הבדיקה החוזרת");
  const full = await pbDocXml0(await D.buildRecheck(rm));
  assert.deepEqual(pbOrderErrors(full), [], "הדוח המלא כולל דף הבדיקות");
  assert.ok(wellFormed(full) && !XML_BAD.test(full));
  // כל טבלה בעמודים החדשים: bidiVisual (טבלה מימין לשמאל) מיד לפני tblW
  for (const xml of [D.helpers.partiesBody(pm).join(""), D.helpers.recheckBody(rm.recheck).join(""), full]) assert.equal((xml.match(/<w:tbl>/g) || []).length, (xml.match(/<w:tblPr><w:bidiVisual\/><w:tblW /g) || []).length, "bidiVisual בכל טבלה");
});
test("Word: צבעים וצללים נכנסים למאפייני XML רק כ-6 ספרות הקס (קלט עוין במודל לא מזריק מאפיינים/אלמנטים)", () => {
  const evil = '"/><w:evil/><x a="', H = D.helpers;
  const x = H.textParaS("t", { color: evil, shade: evil, box: evil, bold: true }); assert.ok(!x.includes("evil") && !x.includes("w:pBdr") && !x.includes("<w:shd") && !x.includes("<w:color"), x);
  const ok = H.textParaS("t", { color: "aB12cD", shade: "ffe3e3", box: "e0a800" });   // צבע הקס תקין עובר, מנורמל לאותיות גדולות
  assert.ok(ok.includes('w:fill="FFE3E3"') && ok.includes('w:val="AB12CD"') && ok.includes('w:color="E0A800"') && !ok.includes("aB12cD"), ok);
  const body = H.partiesBody({ head: "h", sub: "s", summary: "", empty: "", note: "", footer: "f", rows: [{ n: 1, party: [{ t: "x", c: evil, b: true }], type: "t", contact: [{ t: "y", c: "12" }], status: "s", note: "n" }] }).join("");
  assert.ok(!body.includes("evil") && wellFormed(body), "צבע עוין בשורת תא"); assert.deepEqual(pbOrderErrors(body), []);
  const rc = H.recheckBody({ banner: [{ t: "b", b: true }], title: "t", identity: [], heading: "h", sections: [{ title: "x", head: ["a", "b", "c", "d"], rows: [{ status: evil, sev: evil, high: true, id: evil, title: evil, lines: [evil], dist: evil }] }] }).join("");
  assert.ok(!rc.includes("<w:evil") && wellFormed(rc), "טקסט עוין בדוח: מוגן"); assert.deepEqual(pbOrderErrors(rc), []);
});
const pbDocXml0 = async bytes => (await JSZipNode.loadAsync(bytes)).file("word/document.xml").async("string");

/* ---------- דוח "בדיקה חוזרת" (Word נפרד) ---------- */
const PB_t2 = new Date(+now + 7 * 864e5), PB_proj = new C.Proj(PB_res.inp.lat, PB_res.inp.lon);
async function pbRecheckScenario(o) {
  o = o || {};
  const stamp = x => Object.assign({}, x, { osm3s: Object.assign({}, x.osm3s, { timestamp_osm_base: "2026-10-23T05:00:00Z" }) });
  const d2 = Object.assign({}, PB_data, { notamFetchedIso: "2026-10-23T08:00:00Z", near: stamp(PB_data.near), far: stamp(PB_data.far), ext: stamp(PB_data.ext) }), [la, lo] = PB_proj.ll(40, 30);
  const name = o.hostile ? "תורן <script>alert(1)</script> & \"x\" " + fcc(0xb) + fcc(0xfffe) : "תורן חדש";
  d2.near = Object.assign({}, d2.near, { elements: d2.near.elements.concat([{ type: "node", id: 99001, lat: la, lon: lo, tags: { man_made: "tower", "tower:type": "communication", name } }]) });
  d2.notams = d2.notams.concat([{ id: "A9999/26", loc: "LLLL", name: "T", heb: o.hostile ? "נוטם <i>חדש</i> & A9999/26" : "נוטם חדש A9999/26", raw: "A9999/26 NOTAMN\nQ) LLLL/QRDCA/IV/NBO/AW/000/050/3205N03449E001\nA) LLLL B) 2610201400 C) 2610302100\nE) TEST" }]);
  const site = o.hostile ? { siteName: '<b>אתר</b> & "q" ' + fcc(0xb) + fcc(0xfffe) + " </w:t><w:evil/>" } : {};   // שם האתר מהבקשה השמורה (קלט שאינו אמין)
  const res2 = C.analyze(Object.assign({}, baseInput, site), d2, PB_ON, PB_t2), prev = PB_RC.snapshotOf(PB_res, PB_data, PB_ON, now), cur = PB_RC.snapshotOf(res2, d2, PB_ON, PB_t2);
  return { res2, d2, diff: PB_RC.diffSnapshots(prev, cur) };
}
async function pbRecheckModel(o) {
  o = o || {};
  const s = await pbRecheckScenario(o), since = PB_RC.sinceModel(s.diff, { sentAt: now, checkedAt: PB_t2, activity: { dateFrom: "2026-10-27", dateTo: "2026-10-27", timeFrom: "17:00", timeTo: "20:00" }, maxRows: o.maxRows == null ? 5 : o.maxRows, cfg: PB_ON });
  return O.recheckDocxModel(s.res2, s.d2, PB_ON, o.since || since, { now: PB_t2, includeChecks: o.includeChecks });
}
test("דוח בדיקה חוזרת: באנר 'לא צורף לבקשה שנשלחה למודיעין טיס' בראש, זהות הבקשה והתאריכים, סעיף 'שינויים מאז ההגשה' עם טבלאות, ובסוף דף הבדיקות העדכני בלי הגשה ואישור", async () => {
  const s = await pbRecheckScenario(), since = PB_RC.sinceModel(s.diff, { sentAt: now, checkedAt: PB_t2, activity: { dateFrom: "2026-10-27", dateTo: "2026-10-27", timeFrom: "17:00", timeTo: "20:00" }, cfg: PB_ON });
  assert.equal(since.kind, "changes", "תנאי המבחן: יש שינויים");
  const m = O.recheckDocxModel(s.res2, s.d2, PB_ON, since, { now: PB_t2 }), bytes = await D.buildRecheck(m), z = await JSZipNode.loadAsync(bytes), xml = await z.file("word/document.xml").async("string"), lines = pbPlain(xml).split("\n");
  assert.deepEqual([...Buffer.from(bytes).subarray(0, 2)], [0x50, 0x4b], "ZIP (PK)"); assert.ok(Buffer.from(bytes).toString("base64").startsWith("UEsD"), "מתחיל ב-UEsD כפי ש-saveRecheck דורש");
  for (const f of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/_rels/document.xml.rels", "word/styles.xml", "docProps/core.xml"]) assert.ok(z.file(f), f);
  assert.ok(Math.ceil(bytes.length * 4 / 3) < 3 * 1024 * 1024, "מתחת ל-CFG.MAX_RECHECK_B64 בשרת");
  assert.equal(lines[0], since.banner.text); assert.equal(lines[0], "דוח זה לא צורף לבקשה שנשלחה למודיעין טיס ב-" + PB_RC.fmtDate(now) + ".");
  assert.equal(lines[1], since.banner.sub); assert.equal(lines[2], since.banner.resend);
  assert.match(xml.split("</w:p>")[0], /<w:pBdr>.*<\/w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="FFF3CD"\/>/, "הבאנר בקופסה צהובה עם מסגרת");
  assert.equal(lines[3], "בדיקה חוזרת — " + O.fileBase(s.res2), "כותרת: זהות הבקשה");
  const idt = pbPlain(pbTable(xml, ">הבקשה<")); for (const t of [O.fileBase(s.res2), C.dmsLat(PB_res.inp.lat), "200 מ׳", ...since.dates.map(d => d.label), ...since.dates.map(d => d.value)]) assert.ok(idt.includes(t), "זהות/תאריכים: " + t);
  assert.ok(lines.includes(since.title) && lines.includes(since.summary) && lines.includes(since.checkedLine) && lines.includes(since.limitation), "סעיף השינויים: כותרת, סיכום, נבדקו, הגבלה");
  since.notes.forEach(n => assert.ok(lines.includes(n), n));
  const srcT = pbPlain(pbTable(xml, ">" + PB_RC.STR.srcCols[1] + "<")); since.sources.forEach(sr => assert.ok(srcT.includes(sr.label) && srcT.includes(sr.after), sr.label));
  since.sections.forEach(sc => { assert.ok(lines.includes(sc.title + " (" + sc.total + ")"), sc.title); const t = pbPlain(pbTable(xml, ">" + PB_RC.STR.cols[1] + "<")); assert.ok(t.length > 0); });
  const all = pbPlain(xml); assert.ok(all.includes("A9999/26") && all.includes("תורן חדש"), "השורות עצמן");
  assert.ok(all.includes(PB_RC.STR.status.notam.new) && all.includes(PB_RC.STR.sev.high), "תווית סטטוס וחומרה");
  // דף הבדיקות העדכני בסוף, בלי סעיף הגשה ואישור סקירה; אין טופס ואין תמונות
  const iChk = lines.findIndex(l => l.startsWith("דף הבדיקות העדכני")), iSince = lines.indexOf(since.title); assert.ok(iChk > iSince && iSince > 3, "דף הבדיקות אחרי הסעיף");
  assert.ok(lines.includes("1. הנקודה") && lines.includes("2. הבדיקות שבוצעו"), "סעיפי דף הבדיקות");
  assert.ok(!/סיכום והגשה|אישור סקירה אנושית|הגשה$/.test(all.split("\n").slice(iChk).join("\n")) && !/נספח ג׳|טופס בקשה לסגירה אווירית|הדמיה מצורפת/.test(all), "בלי הגשה, אישור, טופס ותמונות");
  assert.ok(!xml.includes("<w:drawing>") && !z.file(/word\/media\//).length, "בלי תמונות");
  assert.match(await z.file("docProps/core.xml").async("string"), /<dc:title>בדיקה חוזרת — /, "כותרת המסמך");
  assert.ok(wellFormed(xml)); const lint = xmllint(xml); if (lint !== null) assert.equal(lint, "", "xmllint: " + lint);
  // בלי דף בדיקות
  const m2 = O.recheckDocxModel(s.res2, s.d2, PB_ON, since, { now: PB_t2, includeChecks: false }), x2 = await pbDocXml0(await D.buildRecheck(m2));
  assert.ok(!/דף הבדיקות העדכני/.test(pbPlain(x2)) && pbPlain(x2).includes(since.summary)); assert.ok(x2.length < xml.length / 2);
});
test("דוח בדיקה חוזרת: מצבי 'אין שינוי', 'אין בסיס' ו'חסום' מוצגים עם הבאנר והסיבה; שורות מעבר לתקרת ה-Word מסוכמות ב'ועוד N'; קלט עוין מוגן", async () => {
  const mk = since => O.recheckDocxModel(PB_res, PB_data, PB_ON, since, { now: PB_t2 });
  const cur = PB_RC.snapshotOf(PB_res, PB_data, PB_ON, PB_t2), same = PB_RC.sinceModel(PB_RC.diffSnapshots(PB_RC.snapshotOf(PB_res, PB_data, PB_ON, now), cur), { sentAt: now, checkedAt: PB_t2, cfg: PB_ON });
  const none = pbPlain(await pbDocXml0(await D.buildRecheck(mk(same))));
  assert.equal(same.kind, "none"); assert.ok(none.includes(PB_RC.STR.none) && none.includes(PB_RC.STR.banner), "אין שינוי");
  const nobase = PB_RC.sinceModel(null, { sentAt: now, checkedAt: PB_t2, cfg: PB_ON }); assert.equal(nobase.kind, "nobase");
  const nb = pbPlain(await pbDocXml0(await D.buildRecheck(mk(nobase)))); assert.ok(nb.includes(PB_RC.STR.noBase) && nb.includes(PB_RC.STR.banner), "אין בסיס");
  const blocked = PB_RC.sinceModel(PB_RC.diffSnapshots(PB_RC.snapshotOf(PB_res, PB_data, PB_ON, now), PB_RC.snapshotOf(C.analyze(Object.assign({}, baseInput, { radius: 300 }), PB_data, PB_ON, PB_t2), PB_data, PB_ON, PB_t2)), { sentAt: now, checkedAt: PB_t2, cfg: PB_ON }); assert.equal(blocked.kind, "blocked");
  assert.ok(pbPlain(await pbDocXml0(await D.buildRecheck(mk(blocked)))).includes(blocked.summary), "חסום");
  // תקרה: 105 שורות בסעיף (15 ב-rows + 90 ב-rest) — ב-Word עד rowsWord (100), והשאר "ועוד 5"
  const row = i => ({ status: "added", cls: "added", sev: "low", statusLabel: "חדש", sevLabel: "", id: "", title: "פריט " + i, lines: ["שורה " + i], dist: i + " מ׳" });
  const big = { kind: "changes", title: "שינויים מאז ההגשה", banner: { text: "דוח זה לא צורף לבקשה שנשלחה למודיעין טיס ב-1.1.2026.", sub: "x", resend: "" }, dates: [], summary: "נמצאו 105 שינויים", checkedLine: "", limitation: "", notes: [], sources: [],
    sections: [{ key: "items", title: "מכשולים ותשתיות", total: 105, rows: new Array(15).fill(0).map((_, i) => row(i)), rest: new Array(90).fill(0).map((_, i) => row(i + 15)), hidden: 90 }], counts: null };
  const bm = mk(big), bx = await pbDocXml0(await D.buildRecheck(bm));
  assert.equal(bm.recheck.sections[0].rows.length, PB_RC.LIMITS.rowsWord); assert.equal(bm.recheck.sections[0].more, "ועוד 5 שורות אינן מוצגות בדוח זה"); assert.ok(pbPlain(bx).includes("פריט 99") && !pbPlain(bx).includes("פריט 100") && pbPlain(bx).split("\n").includes("ועוד 5 שורות אינן מוצגות בדוח זה"), "100 שורות + הודעת 'ועוד 5' ב-Word");
  assert.equal(mk(Object.assign({}, big, { sections: [Object.assign({}, big.sections[0], { rows: big.sections[0].rows.slice(0, 2), rest: [] })] })).recheck.sections[0].more, "", "בלי עודף — בלי הודעה");
  // עוין: באנר/שורות/מקורות עם HTML ובקרה; ה-XML תקין והטקסט כלשונו
  const hx = await pbDocXml0(await D.buildRecheck(await pbRecheckModel({ hostile: true })));
  assert.ok(wellFormed(hx) && !XML_BAD.test(hx) && !hx.includes("<script") && !hx.includes("<i>") && !hx.includes("<w:evil"), "עוין: XML תקין");
  const hsc = await pbRecheckScenario({ hostile: true }); assert.ok(pbPlain(hx).includes("בדיקה חוזרת — " + C.xmlClean(O.fileBase(hsc.res2))) && !/<w:evil|<b>/.test(hx), "שם האתר העוין (אחרי safeName ו-xmlClean) מוצג כטקסט: " + O.fileBase(hsc.res2));
  const hz = await JSZipNode.loadAsync(await D.buildRecheck(await pbRecheckModel({ hostile: true }))); assert.ok(wellFormed(await hz.file("docProps/core.xml").async("string")) && !(await hz.file("docProps/core.xml").async("string")).includes("<w:evil"), "core.xml של דוח עוין"); assert.ok(pbPlain(hx).includes("<script>alert(1)</script>") && pbPlain(hx).includes("<i>חדש</i>"), "עוין: כלשונו");
  const lint = xmllint(hx); if (lint !== null) assert.equal(lint, "", "xmllint: " + lint);
});
test("דוח בדיקה חוזרת: דגל כבוי / מודל חסר / מודל לא תקין — אין מודל; buildRecheck בלי מודל נכשל במפורש; שדות הסריקה נלקחים מהניתוח", async () => {
  const s = await pbRecheckScenario(), since = PB_RC.sinceModel(s.diff, { sentAt: now, checkedAt: PB_t2, cfg: PB_ON });
  assert.equal(O.recheckDocxModel(s.res2, s.d2, PB_OFF, since, { now: PB_t2 }), null, "recheck כבוי");
  assert.ok(O.recheckDocxModel(s.res2, s.d2, PB_NOFEAT, since, { now: PB_t2 }), "מפתח חסר = פעיל");
  for (const bad of [null, undefined, 0, "x"]) assert.equal(O.recheckDocxModel(s.res2, s.d2, PB_ON, bad, { now: PB_t2 }), null, JSON.stringify(bad));
  assert.equal(PB_RC.sinceModel(s.diff, { sentAt: now, cfg: PB_OFF }), null, "R1: דגל כבוי — אין מודל");
  await assert.rejects(() => D.buildRecheck(null), /m\.recheck/); await assert.rejects(() => D.buildRecheck({}), /m\.recheck/);
  assert.doesNotThrow(() => O.recheckDocxModel(s.res2, s.d2, PB_ON, {}, { now: PB_t2 }), "מודל ריק לא מפיל");
  // דוח בלי הפרטים האישיים של המבקש (הם אינם נשמרים בבדיקה חוזרת): שם/טלפון/ארגון המבקש אינם בדוח
  const x = pbPlain(await pbDocXml0(await D.buildRecheck(O.recheckDocxModel(s.res2, s.d2, PB_ON, since, { now: PB_t2 }))));
  for (const t of [baseInput.requesterPhone, baseInput.requesterName, baseInput.requesterOrg, "050-0000001", ORG_ADDR]) assert.ok(!x.includes(t), "פרט מבקש בדוח: " + t);
});

/* ---------- מייל עדכון (שליחה מחדש אחרי בדיקה חוזרת) ---------- */
test("מייל עדכון: משפט ההחלפה בגוף (ReqRecheck), הנושא ללא קידומת לשרת וקידומת מלאה ב-subjectFull/mailto; אידמפוטנטי; נקודת הגורמים נשמרת", () => {
  const base = O.mail(PB_res, cfg), d = PB_RC.fmtDate(now), up = O.mail(PB_res, PB_ON, { parties: PB_rows, update: { sentAt: now } });
  assert.equal(up.subject, base.subject, "subject — כפי שהשרת מצפה (הוא מוסיף את הקידומת)"); assert.equal(up.subjectFull, "[עדכון לבקשה מ-" + d + "] " + base.subject);
  assert.equal(up.subjectFull, PB_RC.updateSubjectPrefix(now) + base.subject);
  assert.ok(up.body.includes("מצורפת בקשה מעודכנת לסגירה אווירית על גבי הטופס שבנספח ג׳ לפמ״ת א-11 (עדכון 1/26). בקשה זו מחליפה את הבקשה שנשלחה ב-" + d + "."), up.body);
  assert.ok(!/^מצורפת בקשה לסגירה/m.test(up.body)); assert.ok(up.body.includes("• דיווח לגורמים נוספים: " + PB_rows.length + " גורמים"), "נקודת הגורמים נשמרת");
  assert.deepEqual(up.to, base.to);
  assert.ok(decodeURIComponent(up.mailto).includes(up.subjectFull) && decodeURIComponent(up.mailto).includes("מחליפה את הבקשה שנשלחה ב-" + d) && up.mailto.startsWith("mailto:" + base.to.join(",") + "?subject="));
  assert.deepEqual(Object.keys(base), ["to", "subject", "body", "mailto"], "בלי update — אין שדות חדשים"); assert.ok("subjectFull" in up);
  const twice = O.mailUpdate(up, now, PB_ON); assert.equal(twice.body, up.body, "אידמפוטנטי: בלי משפט כפול"); assert.equal((twice.body.match(/מחליפה את הבקשה/g) || []).length, 1);
  assert.equal(O.mailUpdate(base, now, PB_OFF), base, "דגל כבוי — אותו אובייקט"); assert.equal(O.mailUpdate(base, now, PB_NOFEAT).subjectFull, up.subjectFull, "מפתח חסר = פעיל");
  assert.equal(O.mail(PB_res, PB_ON, { update: now }).subjectFull.startsWith("[עדכון לבקשה מ-" + d + "]"), true, "update כתאריך ישיר");
  assert.ok(/הקודמת/.test(O.mail(PB_res, PB_ON, { update: { sentAt: "לא תאריך" } }).body), "תאריך לא תקין — נוסח כללי, בלי חריגה");
  assert.equal(O.mail(PB_res, PB_ON, { update: null }).body, base.body); assert.ok(!/office@icd|info@icd/.test(up.body + up.mailto));
});

/* ---------- טעינה עצלנית: מודולים חסרים, וסדר טעינה בדפדפן ---------- */
function pbLoadOut(env) {
  const src = fs.readFileSync(path.join(ROOT, "members-k38p/requests/js/output.js"), "utf8");
  if (env.requireFn) { const mod = { exports: {} }; new Function("module", "require", src)(mod, env.requireFn); return mod.exports; }
  new Function("self", src)(env.self); return env.self.ReqOut;
}
test("טעינה: ReqParties/ReqRecheck חסרים או שזורקים בטעינה — אין עמוד, אין שורת מייל, אין עדכון (כמו שלב א׳); בדפדפן הסדר לא משנה (נטענים בעת הקריאה)", async () => {
  const baseMail = O.mail(PB_res, cfg).body;
  const noMods = pbLoadOut({ requireFn: n => { if (n === "./core.js") return C; throw new Error("Cannot find module " + n); } });
  assert.ok(!("parties" in noMods.docxModel(PB_res, PB_data, cfg, { now, parties: PB_rows })));
  assert.equal(noMods.mail(PB_res, cfg, { parties: PB_rows, update: { sentAt: now } }).body, baseMail); assert.equal(noMods.partiesMailLine(PB_rows, cfg), ""); assert.equal(noMods.partiesPage(PB_rows, cfg), null);
  assert.equal(noMods.recheckDocxModel(PB_res, PB_data, cfg, {}, {}), null); assert.equal(noMods.mailUpdate({ subject: "s", body: "b" }, now, cfg).subject, "s");
  // מודול שנטען אך חסר ממשק (אובייקט ריק) — כבוי
  const stub = pbLoadOut({ requireFn: n => (n === "./core.js" ? C : {}) }); assert.ok(!("parties" in stub.docxModel(PB_res, PB_data, cfg, { now, parties: PB_rows })));
  // ההגנה של output.js על דגל recheck כבוי אינה נשענת על ההגנה הפנימית של ReqRecheck.updateMail: מודול שמדווח enabled=false ועדיין "מעדכן" — לא נקרא
  const rcStub = { enabled: () => false, updateMail: m => Object.assign({}, m, { subject: "X" + m.subject }) }, base0 = { to: ["a"], subject: "s", body: "b", mailto: "m" };
  const gated = pbLoadOut({ requireFn: n => { if (n === "./core.js") return C; if (n === "./recheck.js") return rcStub; throw new Error("missing"); } });
  assert.equal(gated.mailUpdate(base0, now, cfg), base0); assert.equal(gated.mail(PB_res, cfg, { update: { sentAt: now } }).subject, O.mail(PB_res, cfg).subject); assert.equal(gated.recheckDocxModel(PB_res, PB_data, cfg, {}, {}), null);
  // דפדפן: self.ReqOut נוצר לפני ש-ReqParties/ReqRecheck נטענים, ועובד אחרי שנטענו
  const self = { ReqCore: C }, out = pbLoadOut({ self });
  assert.ok(out && out === self.ReqOut); assert.ok(!("parties" in out.docxModel(PB_res, PB_data, cfg, { now, parties: PB_rows })), "לפני טעינת parties.js");
  self.ReqParties = PB_P; self.ReqRecheck = PB_RC;
  assert.ok("parties" in out.docxModel(PB_res, PB_data, cfg, { now, parties: PB_rows }), "אחרי טעינת parties.js"); assert.ok(out.mail(PB_res, cfg, { parties: PB_rows }).body.includes("דיווח לגורמים נוספים"));
  assert.ok(out.mail(PB_res, cfg, { update: { sentAt: now } }).subjectFull); assert.ok(out.recheckDocxModel(PB_res, PB_data, cfg, PB_RC.sinceModel(null, { sentAt: now, cfg }), { now }));
  assert.equal(JSON.stringify(Object.keys(out).sort()), JSON.stringify(Object.keys(O).sort()), "אותו ממשק בדפדפן וב-Node");
});

/* ---------- הצגה בפועל (LibreOffice): מדלג בלי soffice/pdftotext ---------- */
test("Word + LibreOffice: עמוד הגורמים בעמוד נפרד אחרי הטופס, ופיסוק אחרי מילה לטינית לא מתהפך — '(LLU)' ו-'OpenStreetMap (…)' (מדלג בלי soffice/pdftotext)", async t => {
  const has = (c, a) => { const r = spawnSync(c, a, { encoding: "utf8", timeout: 20000 }); return !r.error && r.status === 0; };
  if (!has("soffice", ["--version"]) || !has("pdftotext", ["-v"])) return t.skip("soffice/pdftotext לא מותקנים");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reqparties-")), words = (pdf, page) => {   // מילות העמוד בסדר חזותי (שמאל לימין), לפי שורה
    const html = spawnSync("pdftotext", ["-bbox", "-f", String(page), "-l", String(page), pdf, "-"], { encoding: "utf8" }).stdout, lines = {};
    [...html.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>([^<]*)<\/word>/g)].forEach(m => { const k = Math.round(+m[2] / 3); (lines[k] = lines[k] || []).push({ x: +m[1], t: m[3].replace(BIDI_MARKS, "").replace(/[\u202b]/g, "") }); });
    return Object.values(lines).map(l => l.sort((a, b) => a.x - b.x).map(w => w.t));
  }, convert = async (name, bytes) => {
    fs.writeFileSync(path.join(tmp, name + ".docx"), bytes);
    const cv = spawnSync("soffice", ["--headless", "-env:UserInstallation=file://" + path.join(tmp, "profile"), "--convert-to", "pdf", "--outdir", tmp, path.join(tmp, name + ".docx")], { encoding: "utf8", timeout: 170000 });
    return fs.existsSync(path.join(tmp, name + ".pdf")) ? path.join(tmp, name + ".pdf") : (t.skip("LibreOffice לא הפיק PDF: " + (cv.error ? cv.error.message : String(cv.stderr).slice(0, 120))), null);
  };
  try {
    // (א) סדר העמודים בבקשה שלמה: עמוד הגורמים אחרי עמוד הטופס ולפני דף הבדיקות
    const full = await convert("full", await D.build(O.docxModel(PB_res, PB_data, cfg, { now, includeChecks: true, parties: [pbRow({ title: "גורם בדיקה" })] }))); if (!full) return;
    const pageOf = n => spawnSync("pdftotext", ["-f", String(n), "-l", String(n), "-layout", full, "-"], { encoding: "utf8" }).stdout, total = +/Pages:\s+(\d+)/.exec(spawnSync("pdfinfo", [full], { encoding: "utf8" }).stdout)[1];
    const has2 = (n, s) => pageOf(n).replace(BIDI_MARKS, "").includes(s);
    let pp = 0, pc = 0; for (let n = 1; n <= total; n++) { if (!pp && has2(n, "עמוד נלווה לבקשה")) pp = n; if (!pc && has2(n, "הנקודה") && has2(n, "דף בדיקות") ) pc = n; }
    assert.ok(pp > 1, "עמוד הגורמים אחרי עמוד הטופס (" + pp + ")"); assert.ok(!has2(pp, "שדה 8") && !has2(pp, "הבדיקות שבוצעו"), "העמוד נקי מתוכן עמודים אחרים"); assert.ok(pc === 0 || pc > pp, "דף הבדיקות אחרי עמוד הגורמים");
    // (ב) פיסוק ליד לטינית: חזותית משמאל לימין "(" אחרי המילה ו-")" לפניה (קוד התו; הסוגרים מוחזרים בראי בכיוון RTL)
    const pdf = await convert("bidi", await D.pack(["אזור אסור (LLU)", "OpenStreetMap (שדות תעופה) ב"].map(x => D.helpers.textParaS(x, { size: 22 })), [], {})); if (!pdf) return;
    const ls = words(pdf, 1), l1 = ls.find(l => l.includes("LLU")), l2 = ls.find(l => l.includes("OpenStreetMap"));
    assert.ok(l1 && l2, JSON.stringify(ls)); const i1 = l1.indexOf("LLU"), i2 = l2.indexOf("OpenStreetMap");
    assert.ok(l1[i1 - 1] === ")" && l1[i1 + 1] === "(", "(LLU) — הסוגרים מחוץ למילה, כל אחד בצד הנכון: " + l1.join(" "));
    assert.ok(l2[i2 + 1] === undefined || !/^\(/.test(l2[i2 + 1]), "הסוגר לא נדבק אחרי OpenStreetMap: " + l2.join(" ")); assert.ok(/\(/.test(l2[i2 - 1] || ""), "הסוגר הפותח בצד השמאלי של OpenStreetMap, לפני העברית: " + l2.join(" "));
    // בקרת-נגד: ריצת שלב א׳ (בלי strictBidi) מדביקה את הסוגר לריצה הלטינית — הבדיקה הזו אכן מבחינה בין השניים
    const old = await convert("bidi-old", await D.pack(["אזור אסור (LLU)"].map(x => D.helpers.textPara(x, { size: 22 })), [], {})); if (!old) return;
    assert.ok(words(old, 1).find(l => l.includes("LLU)")), "ב-runsOf של שלב א׳ הסוגר דבוק ל-LLU");
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
/* ======================================================================= סוף בלוק O2 ======================================================================= */

/* MYREQ-UNIT-BEGIN */
/* ===== ״הבקשות שלי״ (שלב ב׳, U2): js/myreq.js — ליבה טהורה (דגל וזמינות, שורה ורשימה מקלט עוין, HTML מוגן, הודעות שגיאה) וצילום תמונת המצב לקובץ נתוני הבקשה (withSnapshot: בלי פרטי מבקש, לא חוסם שמירה, נכשל סגור); ובדיקות מבנה לחיבורים ב-ui.js / auth.js / index.html ===== */
{
  const MR = require(path.join(ROOT, "members-k38p/requests/js/myreq.js")), RCK = require(path.join(ROOT, "members-k38p/requests/js/recheck.js"));
  const RLO = String.fromCharCode(0x202e), ZW = String.fromCharCode(0x200b), NUL = String.fromCharCode(0);
  const src = f => fs.readFileSync(path.join(ROOT, "members-k38p/requests", f), "utf8");
  const analysis = (over, c) => { const d = mkData(fixture("yarkon")), inp = Object.assign({}, baseInput, over || {}); return { res: C.analyze(inp, d, c || cfg, now), data: d, inp }; };
  const REC = () => ({ savedAt: "2026-10-18T10:00:00.000Z", site: "אתר", version: "1", edition: "e", declaration: null, inputs: { lat: exp.input.lat, lon: exp.input.lon }, zones: [], items: [] });
  const PII = { requesterName: "פלוני אלמוני זהה", requesterPhone: "052-7654321", requesterOrg: "ארגון חשאי בע״מ", callsign: "CALL-9Z", registration: "REG-77", contacts: [{ name: "איש קשר סודי", phone: "053-1112223" }], participants: [{ first: "משתתף", last: "סודי", phone: "054-3332221" }] };

  test("הבקשות שלי: דגל וזמינות — רק features.myreq === false מכבה (מפתח / features חסרים = פעיל); הכפתור זמין רק כשהשרת מדווח myRequests (מערך, בדיוק בשם הזה)", () => {
    for (const c of [undefined, null, {}, { features: {} }, { features: null }, { features: { myreq: true } }, { features: { myreq: 0 } }, { features: { myreq: "false" } }, { features: { recheck: false } }, cfg]) assert.equal(MR.enabled(c), true, JSON.stringify(c));
    assert.equal(MR.enabled({ features: { myreq: false } }), false);
    assert.equal(cfg.features.myreq, true, "config.json: המפתח מוגדר במפורש (פעיל)");
    assert.equal(MR.available(cfg, ["sendTarget", "myRequests"]), true);
    assert.equal(MR.available(null, ["myRequests"]), true, "בלי הגדרות = פעיל");
    for (const f of [[], ["sendTarget", "orgSplit", "advView"], ["MyRequests"], ["myrequests"], undefined, null, "myRequests", { 0: "myRequests", length: 1 }]) assert.equal(MR.available(cfg, f), false, "שרת בלי myRequests — לא זמין: " + JSON.stringify(f));
    assert.equal(MR.available({ features: { myreq: false } }, ["myRequests"]), false, "הדגל כבוי גם כשהשרת מדווח");
    assert.equal(MR.available(Object.assign({}, cfg, { features: { myreq: false, recheck: true } }), ["myRequests", "recheck"]), false, "דגל recheck לא מפעיל את הבקשות שלי");
  });

  test("הבקשות שלי: תוויות המצב — שלוש בדיוק לפי המצב מהשרת; כל מצב אחר (גם עם רווח או באותיות אחרות) ← ״מצב לא ידוע״", () => {
    assert.deepEqual(MR.STATE_LABEL, { sent_live: "נשלחה למשרד נוטאם", sent_test: "נשלחה לבדיקה בלבד", draft: "נשמרה, לא נשלחה", unknown: "מצב לא ידוע" });
    for (const [st, lbl] of [["sent_live", "נשלחה למשרד נוטאם"], ["sent_test", "נשלחה לבדיקה בלבד"], ["draft", "נשמרה, לא נשלחה"]]) assert.equal(MR.rowModel({ id: "a1", state: st }).stateLabel, lbl);
    for (const st of ["sent_live ", "SENT_LIVE", "sent", "", null, undefined, 5, {}, "<script>", "__proto__", "constructor"]) { const r = MR.rowModel({ id: "a1", state: st }); assert.equal(r.stateLabel, "מצב לא ידוע", String(st)); assert.equal(r.state, ""); }
    const auth = src("js/auth.js"), help = /myreq: "([^"]+)"/.exec(auth);
    assert.ok(help, "יש הסבר HELP.myreq בשורת המשתמש");
    for (const l of ["נשלחה למשרד נוטאם", "נשלחה לבדיקה בלבד", "נשמרה ולא נשלחה"]) assert.ok(help[1].includes(l), "ההסבר מזכיר: " + l);
  });

  test("הבקשות שלי: rowModel — מזהה לא תקין נזרק; שם מנוקה (כיווניות, רוחב-אפס, בקרה, אורך), זמנים בשעון ישראל וקלט זמן עוין נבלע; sentAt רק למצב ששלח", () => {
    const ok = MR.rowModel({ id: "1AbC_-9", name: "חדרה — 02.11.2026", state: "sent_live", saved: Date.UTC(2026, 9, 18, 10, 3), sentAt: Date.UTC(2026, 9, 18, 10, 10) });
    assert.deepEqual([ok.id, ok.name, ok.state, ok.savedText, ok.sentText], ["1AbC_-9", "חדרה — 02.11.2026", "sent_live", "18.10.2026 13:03", "18.10.2026 13:10"], "שעון ישראל (UTC+3 באוקטובר 2026)");
    assert.equal(MR.rowModel({ id: "a1", state: "draft", saved: 1, sentAt: Date.UTC(2026, 9, 18) }).sentAt, 0, "טיוטה — בלי זמן שליחה");
    assert.equal(MR.rowModel({ id: "a1", state: "sent_test", saved: "2026-10-18T10:03:00Z" }).savedText, "18.10.2026 13:03", "זמן כמחרוזת ISO");
    for (const id of ["", null, undefined, 5, {}, [], "a b", 'a"b', "a<b>", "a'b", "a/b", "../x", "a\nb", "x".repeat(129), "א"]) assert.equal(MR.rowModel({ id, name: "n" }), null, "id נדחה: " + JSON.stringify(id));
    assert.ok(MR.rowModel({ id: "x".repeat(128) }), "128 תווים — עדיין תקין");
    for (const x of [null, undefined, 7, "x", [1], () => 1]) assert.equal(MR.rowModel(x), null);
    assert.equal(MR.rowModel({ id: "a1", name: "<img src=x onerror=1>" + RLO + "אבג" + ZW + "דה" + NUL + "ו" }).name, "<img src=x onerror=1>אבגדהו", "כיווניות, רוחב-אפס ותווי בקרה מוסרים — הטקסט נשאר טקסט");
    const long = MR.rowModel({ id: "a1", name: "א".repeat(500) }).name; assert.equal(long.length, 120);
    for (const n of [42, null, undefined, {}, [], "", "   ", RLO + ZW]) assert.equal(MR.rowModel({ id: "a1", name: n }).name, "בקשה ללא שם", JSON.stringify(n));
    for (const t of ["x", -1, 0, NaN, Infinity, 1e99, {}, [], null, "", "9999999999999999999999"]) { const r = MR.rowModel({ id: "a1", state: "sent_live", saved: t, sentAt: t }); assert.deepEqual([r.saved, r.savedText, r.sentAt, r.sentText], [0, "", 0, ""], "זמן עוין: " + String(t)); }
    const p = MR.rowModel({ id: "__proto__", name: "x" }); assert.equal(p.id, "__proto__"); assert.equal(({}).id, undefined, "אין זיהום אב-טיפוס");
  });

  test("הבקשות שלי: listModel — לא ok / לא מערך ← null (נכשל סגור); שורות פגומות וכפולות נזרקות; תקרה 100; סך הכול לא קטן ממה שמוצג; הודעת הספירה", () => {
    for (const r of [null, undefined, "x", 7, [], {}, { ok: false, requests: [] }, { ok: true }, { ok: true, requests: {} }, { ok: true, requests: "a" }, { ok: "true", requests: [] }]) assert.equal(MR.listModel(r), null, JSON.stringify(r));
    const rows = n => Array.from({ length: n }, (_, i) => ({ id: "id" + i, name: "בקשה " + i, state: "draft", saved: 1e12 + i }));
    const l1 = MR.listModel({ ok: true, total: 150, requests: rows(150) });
    assert.deepEqual([l1.rows.length, l1.total, l1.dropped], [100, 150, 0]);
    assert.equal(l1.rows[0].id, "id0", "סדר השרת נשמר");
    const l2 = MR.listModel({ ok: true, requests: [{ id: "a", name: "ראשון" }, { id: "a", name: "כפילות" }, null, "x", { id: 'b"' }, { id: "c" }] });
    assert.deepEqual([l2.rows.map(r => r.id + ":" + r.name).join(), l2.total, l2.dropped], ["a:ראשון,c:בקשה ללא שם", 2, 4]);
    for (const t of [1, NaN, Infinity, "9", -5, null, {}]) assert.equal(MR.listModel({ ok: true, total: t, requests: rows(3) }).total, 3, "total לא תקין/קטן: " + String(t));
    assert.equal(MR.listModel({ ok: true, total: 3.9e6, requests: rows(2) }).total, 3900000);
    assert.equal(MR.statusText({ rows: rows(3), total: 3 }), "3 בקשות."); assert.equal(MR.statusText({ rows: rows(1), total: 1 }), "בקשה אחת.");
    assert.equal(MR.statusText({ rows: [], total: 0 }), "עדיין אין בקשות שמורות בחשבון הזה.");
    assert.equal(MR.statusText({ rows: rows(3), total: 999 }), "מוצגות 3 הבקשות האחרונות מתוך 999.");
  });

  test("הבקשות שלי: listHtml — כל ערך דינמי (שם, מזהה, מצב, תווית נגישות) עובר escaping; אין אלמנט או מאפיין שהוזרקו; לכל שורה בדיוק שני כפתורי פעולה (הצג / כבסיס)", () => {
    const evil = '"><img src=x onerror=alert(1)><script>alert(2)</script> \' onmouseover=\'alert(3)';
    const lm = MR.listModel({ ok: true, requests: [{ id: "a1", name: evil, state: "sent_live", saved: 1e12, sentAt: 1e12 }, { id: "b2", name: "רגיל", state: "x" }] });
    const html = MR.listHtml(lm);
    assert.ok(!/<img|<script|<svg|<iframe|<b>x/i.test(html), html);
    assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;") && html.includes("&lt;script&gt;") && html.includes("&quot;") && html.includes("&#39;"), "הטקסט נשמר אך מוגן");
    assert.equal((html.match(/data-act="view"/g) || []).length, 2); assert.equal((html.match(/data-act="base"/g) || []).length, 2);
    assert.equal((html.match(/<li class="mrRow"/g) || []).length, 2);
    assert.ok(/aria-label="הצג: [^"]*&quot;/.test(html) && /aria-label="השתמש כבסיס לבקשה חדשה: /.test(html), "שם נגיש מתחיל בטקסט הנראה לעין");
    assert.ok(html.includes('data-state="sent_live"') && html.includes('data-state="unknown"') && html.includes("מצב לא ידוע") && html.includes("נשלחה למשרד נוטאם"));
    assert.ok(/נשמרה: \d\d\.\d\d\.\d{4} \d\d:\d\d · נשלחה: \d\d\.\d\d\.\d{4} \d\d:\d\d/.test(html));
    // גם מודל שנבנה ידנית (בלי rowModel) מוגן: ה-HTML לא נסמך על המודל
    const raw = MR.listHtml({ rows: [{ id: 'a"><i>', name: "<b>n</b>", state: "draft<u>", stateLabel: "<b>x</b>", savedText: "<s>t</s>", sentText: "" }] });
    assert.ok(!/<i>|<b>|<u>|<s>/.test(raw), raw);
    for (const e of [null, undefined, {}, { rows: [] }, { rows: "x" }]) assert.equal(MR.listHtml(e), "", "ריק — ההודעה מוצגת באזור הסטטוס, לא פעמיים");
  });

  test("הבקשות שלי: errText ו-noteText — הודעה בעברית לכל קוד, תשובה ״תקינה״ בלי נתונים או קלט לא תקין ← ״התשובה אינה תקינה״; בלי כתובות מייל בטקסטים של המודול", () => {
    const S = MR.STR, A = { msg: r => "A:" + (r.message || r.error) };
    for (const c of ["no_record", "bad_folder"]) assert.equal(MR.errText({ ok: false, error: c }, A), S.noRecord);
    assert.equal(MR.errText({ ok: false, error: "bad_record" }, A), S.badRecord); assert.equal(MR.errText({ ok: false, error: "too_big" }, A), S.tooBig);
    assert.equal(MR.errText({ ok: false, error: "forbidden" }, A), S.forbidden); assert.equal(MR.errText({ ok: false, error: "network" }, A), S.offline);
    assert.equal(MR.errText({ ok: false, error: "rate", message: "M" }, A), "A:M", "שאר השגיאות — הניסוח המרכזי של auth.js (rate וכו׳)");
    assert.equal(MR.errText({ ok: true }, A), S.badResp, "ok בלי הנתונים");
    for (const x of [null, undefined, "x", 5, [], { ok: false }, { ok: false, error: 5 }]) assert.equal(typeof MR.errText(x, undefined), "string");
    assert.equal(MR.errText({ ok: false, error: "weird" }), S.badResp, "בלי A ובקוד לא מוכר — ניסוח כללי");
    assert.ok(/אפשר למלא בקשה חדשה ידנית/.test(S.noRecord) && /אפשר למלא בקשה חדשה ידנית/.test(S.badRecord) && /אפשר למלא בקשה חדשה ידנית/.test(S.unusable));
    const all = JSON.stringify([MR.STR, MR.HELP, MR.STATE_LABEL]) + src("js/myreq.js");
    assert.ok(!/@|icd\.org\.il|office@/i.test(JSON.stringify([MR.STR, MR.HELP])), "בטקסטי המודול אין כתובת מייל (גם לא של הארגון)");
    assert.ok(!/icd\.org\.il|office@/i.test(all), "כתובת הארגון לא מופיעה בקוד המודול");
    const n = MR.noteText("חדרה" + RLO + ZW, ["מהות הפעילות", "כלי טיס: א, ב ועוד 12"]);
    assert.equal(n, "הבקשה ״חדרה״ נטענה כבסיס לבקשה חדשה (הבקשה השמורה לא משתנה). יש להזין תאריכים ושעות, להריץ את הבדיקות מחדש ולאשר שוב את ההצהרה. לא נטענו: מהות הפעילות, כלי טיס: א, ב ועוד 12.");
    assert.ok(!MR.noteText("x", []).includes("לא נטענו") && !MR.noteText("x").includes("לא נטענו"));
  });

  test("הבקשות שלי, snapshot: withSnapshot מוסיף snapshot (גרסה 1, תקף, עם זמן) לרשומה בלי לשנות אותה — ובלי שום פרט מבקש (שם, טלפון, גורם מבקש, אות קריאה, רישום, אנשי קשר, משתתפים) בתמונת המצב או ברשומה; הקובץ (עם ההזחה) מתחת לתקרת הקריאה", () => {
    const { res, data } = analysis(PII), rec = REC(), before = JSON.stringify(rec);
    const out = MR.withSnapshot(rec, res, data, cfg, now);
    assert.notEqual(out, rec); assert.equal(JSON.stringify(rec), before, "הרשומה המקורית לא שונתה"); assert.equal(rec.snapshot, undefined);
    assert.deepEqual(Object.keys(out), Object.keys(rec).concat(["snapshot"]), "שדות שלב א׳ ללא שינוי ובאותו סדר, ו-snapshot בסוף");
    assert.equal(out.inputs, rec.inputs); assert.equal(out.snapshot.v, 1); assert.equal(out.snapshot.at, now.toISOString());
    assert.equal(RCK.cleanSnapshot(out.snapshot).ok, true, "תמונת מצב תקפה לפי ReqRecheck");
    assert.equal(out.snapshot.scan.R, exp.input.radius); assert.ok(Math.abs(out.snapshot.scan.lat - exp.input.lat) < 1e-9);
    const text = JSON.stringify(out);
    for (const v of [PII.requesterName, PII.requesterPhone, PII.requesterOrg, PII.callsign, PII.registration, PII.contacts[0].name, PII.contacts[0].phone, PII.participants[0].first, PII.participants[0].last, PII.participants[0].phone, baseInput.requesterName, baseInput.requesterPhone, baseInput.requesterOrg, "050-0000001", "050-0000002"]) assert.ok(!text.includes(v), "פרט מבקש בתמונת המצב: " + v);
    assert.ok(!/requester|participants|contacts|callsign|registration/i.test(JSON.stringify(out.snapshot)), "גם לא שמות שדות");
    assert.ok(Buffer.byteLength(JSON.stringify(out, null, 1)) < RCK.LIMITS.record, "הקובץ כפי שנכתב (הזחה 1) קטן מתקרת getRequest בשרת");
  });

  test("הבקשות שלי, snapshot: דגל recheck כבוי ← אותה רשומה בדיוק (שלב א׳); דגל myreq כבוי לבדו לא מונע תמונת מצב; בלי נתוני ניתוח או נתונים שאינם אובייקט ← אותה רשומה", () => {
    const { res, data } = analysis(), rec = REC();
    const off = Object.assign({}, cfg, { features: { recheck: false } });
    assert.equal(MR.withSnapshot(rec, res, data, off, now), rec, "אותו אובייקט — לא עותק, בלי מפתחות חדשים");
    assert.deepEqual(Object.keys(rec), ["savedAt", "site", "version", "edition", "declaration", "inputs", "zones", "items"]);
    assert.ok(MR.withSnapshot(rec, res, data, Object.assign({}, cfg, { features: { myreq: false } }), now).snapshot, "myreq כבוי, recheck פעיל: נשמר snapshot (P0 של הבדיקה החוזרת)");
    assert.ok(MR.withSnapshot(rec, res, data, Object.assign({}, cfg, { features: { recheck: true, myreq: true } }), now).snapshot);
    assert.ok(MR.withSnapshot(rec, res, data, undefined, now).snapshot, "בלי הגדרות = פעיל");
    for (const d of [null, undefined, "x", 5, [], true]) assert.equal(MR.withSnapshot(rec, res, d, cfg, now), rec, "data לא תקין: " + JSON.stringify(d));
  });

  test("הבקשות שלי, snapshot: לעולם לא זורק ולא חוסם — ניתוח חסר/שבור ← הרשומה עם snapshotError (בלי snapshot); capture שזורק ← אותה רשומה; רשומה לא אובייקט ← כמות שהיא; תמונת מצב גדולה מהתקרה ← בלי snapshot ועם snapshotError", () => {
    const { res, data } = analysis(), rec = REC();
    for (const bad of [null, undefined, {}, { inp: {} }, "x", 5]) { const o = MR.withSnapshot(rec, bad, data, cfg, now); assert.equal(o.snapshot, undefined, JSON.stringify(bad)); assert.equal(typeof o.snapshotError, "string"); assert.ok(o.snapshotError.length > 0 && o.snapshotError.length <= 120); assert.equal(o.inputs, rec.inputs); }
    const poor = Object.assign({}, data, { notams: "not-a-list", zones: {} });
    assert.doesNotThrow(() => MR.withSnapshot(rec, res, poor, cfg, now));
    for (const r of [null, undefined, 5, "x", [], true]) assert.equal(MR.withSnapshot(r, res, data, cfg, now), r);
    const real = RCK.capture;
    try {
      RCK.capture = () => { throw new Error("boom"); };
      assert.equal(MR.withSnapshot(rec, res, data, cfg, now), rec, "capture שזורק ← הרשומה כפי שהיא");
      RCK.capture = () => ({ snapshot: { v: 1, pad: "x".repeat(RCK.LIMITS.record) } });
      const big = MR.withSnapshot(rec, res, data, cfg, now);
      assert.equal(big.snapshot, undefined); assert.equal(big.snapshotError, MR.STR.tooBigSnap);
      assert.ok(Buffer.byteLength(JSON.stringify(big, null, 1)) < RCK.LIMITS.record, "הקובץ שנכתב נשאר קריא לשרת");
      assert.deepEqual(Object.keys(big).sort(), Object.keys(rec).concat(["snapshotError"]).sort());
      RCK.capture = () => ({ snapshot: { v: 1, pad: "x".repeat(RCK.LIMITS.record - 20000) } });
      assert.ok(MR.withSnapshot(rec, res, data, cfg, now).snapshot, "מתחת לתקרה (גם עם ההזחה) — נשמר");
    } finally { RCK.capture = real; }
  });

  test("הבקשות שלי: חיבורים — index.html טוען recheck.js לפני myreq.js ושניהם לפני ui.js (?v=1); inputsForRecord מחזיר דרך myreqSnapRecord (try/catch, רק לנתוני הניתוח הנוכחי); myreqLoadBase לא נוגע בפרטי מבקש/אנשי קשר/משתתפים ומאפס בקשה כמו הרצה חדשה; הכפתור בשורת המשתמש רק לפי myReqOn", () => {
    const html = src("index.html"), ui = src("js/ui.js"), auth = src("js/auth.js"), my = src("js/myreq.js");
    const at = f => html.indexOf('<script src="js/' + f + '?v=');
    assert.ok(at("core.js") > 0 && at("core.js") < at("recheck.js") && at("recheck.js") < at("myreq.js") && at("myreq.js") < at("ui.js"), "סדר הטעינה");
    assert.ok(html.includes('<script src="js/myreq.js?v=1"></script>'));
    const rec = /function inputsForRecord\(\) \{[^]*?\n  \}\n/.exec(ui);
    assert.ok(rec && /return myreqSnapRecord\(rec\);/.test(rec[0]), "inputsForRecord מעביר את הרשומה דרך myreqSnapRecord");
    const sn = /function myreqSnapRecord\(rec\) \{[^]*?\n  \}\n/.exec(ui);
    assert.ok(sn && /try \{/.test(sn[0]) && /catch \(e\) \{ return rec; \}/.test(sn[0]) && /a\.zonesHash !== d\.zones\.dataHash \|\| a\.notamIso !== d\.notamFetchedIso\) return rec;/.test(sn[0]) && /M\.withSnapshot\(rec, S\.res,/.test(sn[0]), "כל כשל ← הרשומה כמות שהיא; רק כשנתוני הדף הם של הניתוח");
    const lb = /function myreqLoadBase\(inp\) \{[^]*?\n  \}\n/.exec(ui);
    assert.ok(lb, "myreqLoadBase");
    for (const must of ["S.res = null", "S.rid = newRid()", 'S.ridKey = ""', 'S.analysisStamp = null', '$("reviewOk").checked = false', "S.reviewAt = null", "clearOutcome();", "cancelAutoSave()", "S.sent = null", "S.saved", 'setCenter(inp.lat, inp.lon, true)', "S.manualKey = c.lat", '["dateFrom", "dateTo", "timeFrom", "timeTo", "visitDate"', "S.statuses.review = { ok: false"]) assert.ok(lb[0].includes(must) || (must === "S.saved" && /clearOutcome/.test(lb[0])), "myreqLoadBase: " + must);
    for (const never of ["reqName", "reqPhone", "reqOrg", "reqCallsign", "reqReg", "contactList", 'setRows("contacts"', "setRows(", "clearPersonFields", "savePerson", "PERSON_KEY", "partList"]) assert.ok(!lb[0].includes(never), "myreqLoadBase לא נוגע ב: " + never);
    assert.ok(/window\.ReqMyReq\.hook\(\{ loadBase: myreqLoadBase, busy: myreqBusy, inProgress: myreqInProgress \}\)/.test(ui), "החיבור ב-init (בתוך try/catch)");
    assert.ok(/const myreqBusy = \(\) => !!\(S\.resetting \|\| S\.running \|\| S\.sending \|\| S\.opening \|\| S\.zipping \|\| \$\("sendProg"\)\);/.test(ui));
    assert.ok(/const myReqOn = \(\) => !!\(window\.ReqMyReq && window\.ReqMyReq\.available && window\.ReqMyReq\.available\(A\.cfg, A\.features\)\);/.test(auth) && /myReqBtn\(\) \+ withHelp\('<button type="button" id="ubPass">/.test(auth) && /const myReqBtn = \(\) => myReqOn\(\) \?/.test(auth), "הכפתור בשורת המשתמש רק לפי available(cfg, features)");
    assert.ok(!/localStorage|sessionStorage|indexedDB/.test(my), "המודול לא שומר דבר בדפדפן");
    assert.ok(/R\.restoreInputs\(rec, \{ cfg: libCfg\(A_\(\)\.cfg\) \}\)/.test(my) && !/keepDates/.test(my), "״כבסיס״ משחזר בלי תאריכים ושעות (restoreInputs בלי keepDates)");
  });
}
/* MYREQ-UNIT-END */
/* RECHECKUI-UNIT-BEGIN */
/* ===== ״בדיקה חוזרת״ — ממשק (שלב ב׳, U3): js/recheckui.js — ליבה טהורה (זמינות, הכנת הקלט מהרשומה השמורה, השוואה, ממצאים, קלט נעול, HTML מוגן, Word, טקסטי בקשה מעודכנת), ההרחבה של ״הבקשות שלי״ (myreq.js: extraActs/listHtml) וחיבורי ui.js / index.html / config.json ===== */
{
  const RU = require(path.join(ROOT, "members-k38p/requests/js/recheckui.js")), RCK = require(path.join(ROOT, "members-k38p/requests/js/recheck.js")), MR = require(path.join(ROOT, "members-k38p/requests/js/myreq.js"));
  const src = f => fs.readFileSync(path.join(ROOT, "members-k38p/requests", f), "utf8");
  const RLO = String.fromCharCode(0x202e), ZW = String.fromCharCode(0x200b), NUL = String.fromCharCode(0);
  const feat = f => Object.assign({}, cfg, { features: Object.assign({}, cfg.features, f) });
  const sentAt = Date.UTC(2026, 9, 18, 10, 10), later = new Date(+now + 3600e3);
  const D0 = mkData(fixture("yarkon"));
  const inputsOnly = over => { const o = Object.assign({}, baseInput, over || {}); Object.keys(o).forEach(k => { if (/^(req|contact|requester|participant|callsign|registration)/i.test(k)) delete o[k]; }); return o; };
  const savedRec = (over, noSnap) => {
    const inputs = inputsOnly(over), res = C.analyze(Object.assign({}, baseInput, over || {}), D0, cfg, now);
    const rec = { savedAt: "2026-10-10T09:00:00.000Z", site: "בדיקה — x", version: "1", edition: "e", declaration: null, inputs, zones: [], items: [] };
    return noSnap ? rec : Object.assign(rec, RCK.capture(res, D0, cfg, now));
  };
  const clone = o => JSON.parse(JSON.stringify(o));
  // תמונת מצב שבה אזור, פריט ונוטם (שאינם בנתונים הנוכחיים) נושאים טקסט עוין ← שורות ״אינו מופיע עוד״ שמציגות אותו
  const hostileRec = evil => { const rec = savedRec(), S = rec.snapshot; S.zones.push(Object.assign({}, S.zones[0], { id: "ZZ9", n: evil })); S.items.push(Object.assign({}, S.items[0], { k: "evil-k", t: evil, i: ["x1"] })); S.notams.hits.push(Object.assign({}, S.notams.hits[0], { id: "C9999/26", x: evil })); return rec; };
  // השוואה מלאה כמו בדפדפן: prepare → ניתוח טרי (data זהה, שעה מאוחרת) → compare
  const runCmp = (rec, c, dataNow) => {
    const prep = RU.prepare(rec, { cfg: c || cfg, name: "בדיקה — x" }); assert.equal(prep.ok, true, JSON.stringify(prep));
    const d = dataNow || D0, res = C.analyze(prep.inp, d, c || cfg, later);
    return { prep, res, data: d, cmp: RU.compare({ raw: rec, inp: prep.inp, res, data: d, cfg: c || cfg, now: later, sentAt }) };
  };

  test("בדיקה חוזרת: זמינות — רק כשהמשתמש בתצוגה מתקדמת (בדיוק true), השרת מדווח recheck והדגל features.recheck לא כבוי (מפתח חסר = פעיל); ״נשלחה״ בלבד זכאית", () => {
    const F = ["sendTarget", "myRequests", "recheck"];
    assert.equal(cfg.features.recheck, true, "config.json: המפתח מוגדר במפורש (פעיל)");
    assert.equal(RU.available(cfg, F, true), true);
    for (const c of [undefined, null, {}, { features: {} }, { features: null }, { features: { recheck: true } }, { features: { recheck: 0 } }, { features: { recheck: "false" } }, { features: { myreq: false } }]) assert.equal(RU.available(c, F, true), true, "מפתח חסר/לא false = פעיל: " + JSON.stringify(c));
    assert.equal(RU.available({ features: { recheck: false } }, F, true), false, "דגל כבוי");
    for (const adv of [false, undefined, null, "true", 1, {}, [], "yes"]) assert.equal(RU.available(cfg, F, adv), false, "לא תצוגה מתקדמת: " + JSON.stringify(adv));
    for (const f of [[], ["sendTarget", "orgSplit", "advView", "myRequests"], ["Recheck"], ["recheck "], ["myRequests"], undefined, null, "recheck", { 0: "recheck", length: 1 }]) assert.equal(RU.available(cfg, f, true), false, "שרת בלי recheck — לא זמין: " + JSON.stringify(f));
    assert.equal(RU.available({ features: { recheck: false } }, F, false), false);
    assert.equal(MR.available({ features: { recheck: false } }, ["myRequests"]), true, "דגל recheck לא מכבה את ״הבקשות שלי״");
    assert.deepEqual(RU.STATES, ["sent_live", "sent_test"]);
    for (const s of ["sent_live", "sent_test"]) assert.equal(RU.eligible(s), true);
    for (const s of ["draft", "", "unknown", "sent", "SENT_LIVE", "sent_live ", null, undefined, 5, {}, "__proto__"]) assert.equal(RU.eligible(s), false, String(s));
  });

  test("בדיקה חוזרת: prepare — קלט הסריקה נלקח מהרשומה בלבד (נקודה, רדיוס, גובה, מועדים, תוספות ידניות), בלי פרטי מבקש, בלי הפניות לרשומה המקורית; כל סטייה (קלט עוין) ← ok:false בעברית", () => {
    const rec = savedRec({ manualItems: [{ name: "עמוד", lat: 32.1, lon: 34.8, heightM: 12 }], knownObstacles: "מגדל\nאנטנה", visitNotes: "הערה" });
    const p = RU.prepare(rec, { cfg, name: "שם" });
    assert.equal(p.ok, true);
    assert.deepEqual(RU.scanOf(p.inp), { lat: exp.input.lat, lon: exp.input.lon, radius: exp.input.radius, heightM: exp.input.heightM, dateFrom: exp.input.dateFrom, dateTo: exp.input.dateTo, timeFrom: exp.input.timeFrom, timeTo: exp.input.timeTo });
    for (const k of ["requesterName", "requesterPhone", "requesterOrg", "callsign", "registration"]) assert.equal(p.inp[k], "", k);
    assert.deepEqual([p.inp.contacts, p.inp.participants], [[], []]);
    assert.equal(p.inp.siteName, "בדיקה", "שם האתר מהקלט השמור");
    assert.deepEqual(p.inp.manualItems, [{ name: "עמוד", lat: 32.1, lon: 34.8, heightM: 12 }]);
    p.inp.manualItems[0].name = "שונה"; p.inp.aircraft.push("x"); assert.equal(rec.inputs.manualItems[0].name, "עמוד"); assert.equal(rec.inputs.aircraft.length, 1, "עותק, לא הפניה");
    assert.equal(p.raw, rec);
    assert.equal(RU.prepare(Object.assign({}, rec, { inputs: Object.assign({}, rec.inputs, { siteName: "" }) }), { cfg }).inp.siteName, "בדיקה — x", "שם אתר חסר ← שם הבקשה מהרשומה");
    const bad = x => { const r = RU.prepare(x, { cfg }); assert.equal(r.ok, false, String(JSON.stringify(x)).slice(0, 60)); assert.ok(r.text && /פגום|גדול/.test(r.text), r.text); return r; };
    for (const x of [null, undefined, 5, "x", [], true]) bad(x);
    const mod = (k, v) => Object.assign({}, rec, { inputs: Object.assign({}, rec.inputs, { [k]: v }) });
    for (const [k, v] of [["lat", 10], ["lon", 80], ["lat", "32.1"], ["lat", NaN], ["radius", 5], ["radius", 99999], ["radius", "200"], ["heightM", 0], ["heightM", -3], ["heightM", 30000], ["dateFrom", ""], ["dateFrom", "2026-02-31"], ["dateTo", "2026-01-01"], ["dateTo", "2030-01-01"], ["timeFrom", "25:00"], ["timeTo", ""], ["manualItems", "x"], ["aircraft", "x"], ["vlos", "yes"]]) bad(mod(k, v));
    bad(Object.assign({}, rec, { inputs: null })); bad(Object.assign({}, rec, { inputs: [] }));
    const huge = Object.assign({}, rec, { pad: "x".repeat(RCK.LIMITS.record) }); assert.equal(bad(huge).reason, "too_big");
    const hostile = RU.prepare(mod("siteName", "<img src=x onerror=alert(1)>" + RLO + "אבג" + ZW + "דה" + NUL + "ו"), { cfg });
    assert.equal(hostile.inp.siteName, "<img src=x onerror=alert(1)>אבגדהו", "בקרה וכיווניות מוסרות; הטקסט נשאר טקסט (ה-HTML נעשה escape בתצוגה)");
    const proto = JSON.parse('{"__proto__":{"polluted":1},"savedAt":"2026-10-10T09:00:00.000Z","inputs":' + JSON.stringify(rec.inputs) + '}');
    RU.prepare(proto, { cfg }); assert.equal(({}).polluted, undefined, "אין זיהום אב-טיפוס");
    const off = RU.prepare(rec, { cfg: feat({ recheck: false }) });
    assert.equal(off.ok, true, "prepare טהורה — הדגל נאכף ב-compare / available");
  });

  test("בדיקה חוזרת: compare — אותם נתונים ← ״אין שינויים״ בלי ״הכן בקשה מעודכנת״; נתונים ששונו ← שינויים, ספירות לשרת (a/r/c) ו-canUpdate; הרשומה והנתונים לא משתנים", () => {
    const rec = savedRec(), before = JSON.stringify(rec), dBefore = JSON.stringify(D0.near.elements.length + ":" + D0.notams.length);
    const same = runCmp(rec);
    assert.equal(same.cmp.ok, true); assert.equal(same.cmp.kind, "none"); assert.equal(same.cmp.comparable, true); assert.equal(same.cmp.anyChange, false); assert.equal(same.cmp.canUpdate, false);
    assert.deepEqual(same.cmp.sum, { a: 0, r: 0, c: 0 });
    assert.equal(same.cmp.since.summary, RCK.STR.none); assert.ok(same.cmp.cur && same.cmp.curError === "");
    // תמונת מצב ישנה שבה חסר אזור ופריט נעלם ושינוי מרחק ונוטם: בנתונים הנוכחיים הם "חדשים"/"שונו"
    const tam = clone(rec), S = tam.snapshot, zid = S.zones[0].id, nid = S.notams.hits[0].id;
    S.zones.shift(); S.items.shift(); S.items[0].d += 120; S.notams.hits.shift();
    const ch = runCmp(tam);
    assert.equal(ch.cmp.kind, "changes"); assert.equal(ch.cmp.comparable, true); assert.equal(ch.cmp.anyChange, true); assert.equal(ch.cmp.canUpdate, true);
    const c = ch.cmp.diff.counts;
    assert.deepEqual(ch.cmp.sum, { a: c.added, r: c.removed, c: c.changed }); assert.ok(c.added >= 3 && c.total >= 4, JSON.stringify(c));
    const ids = ch.cmp.diff.zones.rows.map(r => r.id).concat(ch.cmp.diff.notams.rows.map(r => r.id)); assert.ok(ids.includes(zid) && ids.includes(nid), ids.join());
    assert.ok(Object.values(ch.cmp.sum).every(n => Number.isInteger(n) && n >= 0), "ספירות שלמות לשרת (saveRecheck מנקה כל דבר אחר)");
    assert.equal(JSON.stringify(rec), before, "הרשומה המקורית לא שונתה"); assert.equal(JSON.stringify(D0.near.elements.length + ":" + D0.notams.length), dBefore);
    assert.deepEqual(ch.cmp.since.dates.map(d => d.label), ["הוגשה", "נבדקה מחדש", "מועד הפעילות"]);
  });

  test("בדיקה חוזרת: compare — בלי תמונת מצב ← ״אין בסיס להשוואה — הבקשה נשלחה לפני שהמערכת שמרה תמונת מצב״ (גם ב-Word); שגיאת צילום / תמונה פגומה / גרסה לא נתמכת ← הניסוח של ReqRecheck; אף אחד מהם אינו מאפשר ״הכן בקשה מעודכנת״", () => {
    const NB = "אין בסיס להשוואה — הבקשה נשלחה לפני שהמערכת שמרה תמונת מצב.";
    assert.equal(RU.STR.noBase, NB);
    const none = runCmp(savedRec({}, true)).cmp;
    assert.equal(none.kind, "nobase"); assert.equal(none.since.reason, "no_baseline"); assert.ok(none.since.summary.startsWith(NB) && /הממצאים הנוכחיים/.test(none.since.summary), none.since.summary);
    assert.equal(none.comparable, false); assert.equal(none.canUpdate, false); assert.deepEqual(none.sum, { a: 0, r: 0, c: 0 }); assert.ok(none.cur, "הממצאים הנוכחיים זמינים");
    assert.equal(runCmp(Object.assign(savedRec({}, true), { snapshot: null })).cmp.since.reason, "no_baseline", "snapshot:null = חסר");
    const err = runCmp(Object.assign(savedRec({}, true), { snapshotError: "תמונת המצב גדולה מדי לקובץ" })).cmp;
    assert.equal(err.kind, "nobase"); assert.ok(!err.since.summary.includes(NB) && err.since.summary === RCK.STR.noBase, "הוגשה כשהמערכת כבר ניסתה לשמור — לא אומרים ״לפני שהמערכת שמרה״");
    for (const bad of [{ v: 1 }, "x", 5, [], { v: 1, scan: {} }]) { const r = runCmp(Object.assign(savedRec({}, true), { snapshot: bad })).cmp; assert.equal(r.kind, "nobase"); assert.equal(r.since.reason, "bad_baseline", JSON.stringify(bad)); assert.equal(r.canUpdate, false); assert.ok(!r.since.summary.includes(NB)); }
    const old = savedRec(); old.snapshot.v = 99;
    const un = runCmp(old).cmp; assert.equal(un.since.reason, "baseline_unsupported"); assert.equal(un.canUpdate, false);
  });

  test("בדיקה חוזרת: compare — נכשל סגור: נוטמים/OSM ישנים מהשמור, הגדרות סריקה ששונו או תמונה נוכחית שנכשלה ← ״blocked״ (לא ״אין שינוי״), בלי עדכון; דגל כבוי ← off", () => {
    const rec = savedRec();
    const newerSaved = clone(rec); newerSaved.snapshot.src.ni = new Date(Date.parse(newerSaved.snapshot.src.ni) + 3600e3).toISOString();   // השמור חדש מהנוכחי
    const st = runCmp(newerSaved).cmp; assert.equal(st.kind, "blocked"); assert.equal(st.since.reason, "stale_notams"); assert.equal(st.canUpdate, false); assert.equal(st.comparable, false);
    const osm = clone(rec); osm.snapshot.src.ob = new Date(Date.parse(osm.snapshot.src.ob) + 3600e3).toISOString();
    assert.equal(runCmp(osm).cmp.since.reason, "stale_osm");
    const th = clone(rec); th.snapshot.th.near_zone_m += 500;
    const t = runCmp(th).cmp; assert.equal(t.kind, "blocked"); assert.equal(t.since.reason, "thresholds_changed"); assert.equal(t.canUpdate, false);
    const prep = RU.prepare(rec, { cfg }), res = C.analyze(prep.inp, D0, cfg, later), broken = Object.assign({}, res, { zones: null });
    const cf = RU.compare({ raw: rec, inp: prep.inp, res: broken, data: D0, cfg, now: later, sentAt });
    assert.equal(cf.ok, true); assert.equal(cf.cur, null); assert.ok(cf.curError.length > 0 && cf.curError.length <= 120); assert.equal(cf.since.reason, "bad_current"); assert.equal(cf.canUpdate, false); assert.equal(cf.kind, "blocked");
    assert.deepEqual(RU.compare({ raw: rec, inp: prep.inp, res, data: D0, cfg: feat({ recheck: false }), now: later, sentAt }), { ok: false, error: "off" });
    for (const x of [null, undefined, 5, "x"]) assert.equal(RU.compare(x).ok, false);
  });

  test("בדיקה חוזרת: sameScan — סריקה זהה רק בנקודה (עד מיקרון-מעלה), רדיוס, גובה, תאריכים ושעות; כל קלט לא תקין ← false (בקשה מעודכנת ״מחליפה״ רק אז)", () => {
    const a = { lat: 32.099128, lon: 34.816617, radius: 200, heightM: 80, dateFrom: "2026-11-02", dateTo: "2026-11-03", timeFrom: "17:00", timeTo: "20:00" };
    assert.equal(RU.sameScan(a, Object.assign({}, a)), true);
    assert.equal(RU.sameScan(a, Object.assign({}, a, { lat: a.lat + 5e-7, lon: a.lon - 5e-7 })), true, "קיצוץ ל-6 ספרות");
    for (const d of [{ lat: a.lat + 1e-5 }, { lon: a.lon + 1e-5 }, { radius: 201 }, { heightM: 81 }, { dateFrom: "2026-11-01" }, { dateTo: "2026-11-04" }, { timeFrom: "17:01" }, { timeTo: "20:01" }, { radius: "200" }, { dateFrom: "" }, { timeFrom: undefined }, { lat: NaN }, { lat: null }]) assert.equal(RU.sameScan(a, Object.assign({}, a, d)), false, JSON.stringify(d));
    for (const x of [null, undefined, 5, "x", [], {}]) { assert.equal(RU.sameScan(a, x), false); assert.equal(RU.sameScan(x, a), false); }
    assert.equal(RU.sameScan({}, {}), false, "אובייקטים ריקים אינם זהים");
    assert.equal(RU.sameScan(a, Object.assign({}, a, { extra: 1 })), true, "שדות אחרים לא נבדקים (שם האתר, מהות — עריכה רכה)");
  });

  test("בדיקה חוזרת: resultHtml — הבאנר ״לא צורף״ והסעיף ״שינויים מאז ההגשה״ בראש; כל ערך עוין (שם אזור/פריט/נוטם, שם בקשה, שדות נעולים) עובר escaping ואין אלמנט או מאפיין שהוזרקו; ממצאים נוכחיים רק כשאין עם מה להשוות", () => {
    const evil = '"><img src=x onerror=alert(1)>\'<b>x</b>';
    const c = runCmp(hostileRec(evil)).cmp;
    assert.equal(c.kind, "changes");
    const view = { since: c.since, findings: RU.findingsModel(c.cur), locked: RU.lockedModel({ lat: 32.1, lon: 34.8, radius: 150, heightM: 60, dateFrom: "2026-11-02", dateTo: "2026-11-02", timeFrom: "14:30", timeTo: "17:30" }, evil), past: true, testOnly: true };
    const h = RU.resultHtml(view);
    assert.ok(!/<img|<script/i.test(h) && !/<[^>]*\sonerror=/i.test(h) && !/<b>x<\/b>/.test(h), h.slice(0, 300));
    assert.ok(h.includes("&lt;img src=x onerror=alert(1)&gt;") && h.includes("&lt;b&gt;x&lt;/b&gt;") && h.includes("&quot;") && h.includes("&#39;"), "הטקסט נשמר אך מוגן");
    assert.ok((h.match(/&lt;img src=x onerror=alert\(1\)&gt;/g) || []).length >= 4, "האזור, הפריט, הנוטם והשם הנעול — כולם מוצגים כטקסט");
    assert.ok(h.startsWith('<div class="rcRes" id="rcRes" tabindex="-1" role="region" aria-label="תוצאות הבדיקה החוזרת"><div class="rcSince"><section class="rc-since"'), "הסעיף בראש, אזור נגיש עם שם");
    assert.ok(h.indexOf("דוח זה לא צורף לבקשה שנשלחה למודיעין טיס") > 0 && h.indexOf("דוח זה לא צורף") < h.indexOf("הוגשה") && h.indexOf("דוח זה לא צורף") < h.indexOf("<table"), "הבאנר לפני התאריכים והטבלאות");
    assert.ok(h.includes("מועד הפעילות שנבדק כבר עבר") && h.includes("מה נבדק") && h.includes("נלקח מהבקשה השמורה ואי אפשר לשנותו"), "הערת מועד שעבר וקלט נעול");
    assert.ok(/<dt>הבקשה<\/dt><dd dir="auto">&quot;&gt;&lt;img/.test(h), "שם הבקשה בקלט הנעול — מוגן");
    assert.ok(!h.includes("הממצאים הנוכחיים"), "kind=changes — בלי ממצאים נוכחיים");
    assert.ok(h.includes("הבקשה הזו נשלחה במצב בדיקה בלבד (לא נשלחה למודיעין טיס).") && h.indexOf("הבקשה הזו נשלחה במצב בדיקה בלבד") > h.indexOf("</section>"), "בקשה שנשלחה בבדיקה בלבד: הבהרה אחרי הסעיף (הבאנר אומר ״למודיעין טיס״)");
    const nb = runCmp(savedRec({}, true)).cmp, hn = RU.resultHtml({ since: nb.since, findings: RU.findingsModel(nb.cur), locked: [], past: false });
    assert.ok(hn.includes("הממצאים הנוכחיים") && hn.includes("אין בסיס להשוואה — הבקשה נשלחה לפני שהמערכת שמרה תמונת מצב.") && hn.includes("LLU20") && !hn.includes("מועד הפעילות שנבדק") && !hn.includes("נשלחה במצב בדיקה בלבד"), "בלי testOnly / past — בלי ההערות");
    const evilNb = RU.findingsModel(clone(runCmp(savedRec()).cmp.cur)); evilNb.items.rows[0].text = evil; evilNb.items.rows[0].id = evil; evilNb.zones.rows[0].dist = evil;
    const fh = RU.findingsHtml(evilNb); assert.ok(!/<img|<b>x/i.test(fh) && fh.includes("&lt;img src=x onerror=alert(1)&gt;"), "גם findingsHtml לא נסמך על המודל");
    assert.equal(RU.resultHtml(null), ""); assert.equal(RU.resultHtml({}), ""); assert.equal(RU.resultHtml({ since: "x" }).includes("undefined"), false);
    for (const x of [null, undefined, "x", 5, [], {}, { rows: "x" }]) assert.equal(typeof RU.findingsHtml(x), "string");
    assert.equal(RU.lockedHtml(null), ""); assert.equal(RU.lockedHtml([]), "");
  });

  test("בדיקה חוזרת: updateState — ״הכן בקשה מעודכנת״ רק כשיש שינויים והפעילות עוד לא החלה (היום עצמו מותר — כמו אימות ״תאריך ההתחלה כבר עבר״ ב-run); פעילות שהחלה ← בלי כפתור, עם הסבר; בלי שינויים ← בלי כפתור וגם בלי הסבר", () => {
    const U = RU.updateState, yes = { canUpdate: true };
    assert.deepEqual(U(yes, { dateFrom: "2026-10-25" }, "2026-10-19"), { started: false, canUpdate: true, blockedByDate: false });
    assert.deepEqual(U(yes, { dateFrom: "2026-10-19" }, "2026-10-19"), { started: false, canUpdate: true, blockedByDate: false }, "היום");
    assert.deepEqual(U(yes, { dateFrom: "2026-10-18" }, "2026-10-19"), { started: true, canUpdate: false, blockedByDate: true }, "אתמול");
    assert.deepEqual(U({ canUpdate: false }, { dateFrom: "2026-10-18" }, "2026-10-19"), { started: true, canUpdate: false, blockedByDate: false }, "בלי שינויים — בלי הסבר");
    assert.deepEqual(U({ canUpdate: false }, { dateFrom: "2026-10-25" }, "2026-10-19"), { started: false, canUpdate: false, blockedByDate: false });
    for (const [c, i, t] of [[null, {}, "x"], [undefined, null, undefined], [yes, null, "2026-10-19"], [yes, { dateFrom: 5 }, "2026-10-19"], [yes, { dateFrom: "2026-10-25" }, 5], [{ canUpdate: "yes" }, { dateFrom: "2026-10-25" }, "2026-10-19"]]) assert.equal(U(c, i, t).canUpdate, !!(c && c.canUpdate === true && i && typeof i.dateFrom === "string" && typeof t === "string"), "קלט לא תקין — לא מציעים: " + JSON.stringify([c, i, t]));
    assert.ok(RU.STR.noUpdate === "אי אפשר להכין בקשה מעודכנת, כי מועד הפעילות כבר החל." && RU.STR.testOnly === "הבקשה הזו נשלחה במצב בדיקה בלבד (לא נשלחה למודיעין טיס).");
    const ru = src("js/recheckui.js");
    assert.ok(/us = updateState\(cmp, prep\.inp, todayYmd\)/.test(ru) && /buttonsHtml\(view\.canUpdate, view\.blockedByDate\)/.test(ru) && /if \(!v \|\| !v\.canUpdate\) return;/.test(ru) && /rcNoUpd[^]*E\(STR\.noUpdate\)/.test(ru), "החיבור ב-run: הכפתור, ההסבר ובדיקת ההרשאה ב-actUpdate לפי view.canUpdate");
  });

  test("בדיקה חוזרת: findingsModel — נגזר מתמונת המצב הנוכחית אחרי ניקוי; תקרת 25 שורות לקבוצה + ״ועוד N״; תמונה פגומה ← null; מרחקים בטקסט (בתוך השטח / ללא מיקום)", () => {
    const res = C.analyze(Object.assign({}, baseInput), D0, cfg, now), snap = RCK.snapshotOf(res, D0, cfg, now), m = RU.findingsModel(snap);
    assert.equal(m.items.rows.length, 20); assert.equal(m.items.more, 0); assert.equal(m.counts.items, snap.items.length); assert.equal(m.counts.zones, snap.zones.length);
    assert.ok(m.zones.rows.some(r => r.id === "LLU20" && /525 מ׳/.test(r.dist)) && m.notams.rows.some(r => r.id === "C0431/26"));
    const many = clone(snap); const it = many.items[0]; many.items = Array.from({ length: 60 }, (_, i) => Object.assign({}, it, { k: "k" + i, t: "פריט " + i, d: 10 + i }));
    const mm = RU.findingsModel(many); assert.equal(mm.items.rows.length, 25); assert.equal(mm.items.more, 35);
    const hm = RU.findingsHtml(mm); assert.ok(hm.includes("(60)") && hm.includes("ועוד 35") && (hm.match(/<li>/g) || []).length >= 25);
    assert.equal(RU.findingsModel(null), null); assert.equal(RU.findingsModel({ v: 1 }), null); assert.equal(RU.findingsModel("x"), null);
    const odd = clone(snap); odd.notams.hits[0].d = -1; odd.items[0].d = 0; const om = RU.findingsModel(odd);
    assert.equal(om.notams.rows[0].dist, "ללא מיקום בנוטם"); assert.equal(om.items.rows[0].dist, "בתוך השטח");
  });

  test("בדיקה חוזרת: lockedModel — הקלט הנעול מוצג כפי ששמור (נקודה ב-DMS ובעשרוני, רדיוס, גובה ברגל, מועד בשעון מקומי; תאריך אחד / טווח)", () => {
    const rows = RU.lockedModel({ lat: 32.099128, lon: 34.816617, radius: 200, heightM: 80, dateFrom: "2026-11-02", dateTo: "2026-11-03", timeFrom: "17:00", timeTo: "20:00" }, "חדרה — 02.11.2026");
    assert.deepEqual(rows.map(r => r[0]), ["הבקשה", "נקודת מרכז", "רדיוס", "גובה", "מועד"]);
    assert.ok(/32°.*N.*34°.*E \(32\.099128, 34\.816617\)/.test(rows[1][1]), rows[1][1]); assert.equal(rows[2][1], "200 מ׳"); assert.equal(rows[3][1], "80 מ׳ (262.5 רגל) מעפ״ש");
    assert.equal(rows[4][1], "02.11.2026 עד 03.11.2026 · 17:00–20:00 (שעון מקומי)");
    const one = RU.lockedModel({ lat: 32.1, lon: 34.8, radius: 150, heightM: 60, dateFrom: "2026-11-02", dateTo: "2026-11-02", timeFrom: "14:30", timeTo: "17:30" });
    assert.equal(one.length, 4, "בלי שם בקשה — בלי שורת ״הבקשה״"); assert.equal(one[3][1], "02.11.2026 · 14:30–17:30 (שעון מקומי)", "יום אחד");
  });

  test("בדיקה חוזרת: wordBytes — דוח Word נפרד (באנר ״לא צורף״, השינויים, דף הבדיקות העדכני; בלי טופס ובלי תמונות), XML תקין, טקסט עוין מוגן; דגל כבוי או מודולים חסרים ← זורק", async () => {
    const evil = "<w:p>&amp;</w:p><x/>", { res, data, cmp } = runCmp(hostileRec(evil));
    const view = { res, data, cfg, now: later, since: cmp.since }, unesc = x => x.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    const bytes = await RU.wordBytes({ O, D }, view), z = await JSZipNode.loadAsync(bytes), doc = await z.file("word/document.xml").async("string"), plain = unesc(doc.replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "").replace(BIDI_MARKS, ""));
    assert.equal(bytes[0], 0x50); assert.ok(wellFormed(doc)); const lint = xmllint(doc); if (lint !== null) assert.equal(lint, "", lint);
    assert.ok(plain.includes("דוח זה לא צורף לבקשה שנשלחה למודיעין טיס") && plain.includes("שינויים מאז ההגשה") && plain.includes("דף הבדיקות העדכני") && plain.includes("מקורות הנתונים"), plain.slice(0, 200));
    assert.ok(!plain.includes("נספח ג׳") && !Object.keys(z.files).some(f => /^word\/media\/./.test(f)), "בלי טופס ובלי תמונות");
    assert.ok(!doc.includes("<x/>") && !/<w:p>&amp;<\/w:p>/.test(doc) && plain.includes("<w:p>&amp;</w:p><x/>"), "טקסט עוין מוצג כטקסט ולא נכנס כ-XML");
    const nb = runCmp(savedRec({}, true)), b2 = await RU.wordBytes({ O, D }, { res: nb.res, data: nb.data, cfg, now: later, since: nb.cmp.since }), d2 = await (await JSZipNode.loadAsync(b2)).file("word/document.xml").async("string");
    assert.ok(d2.includes("אין בסיס להשוואה") && d2.includes("דף הבדיקות העדכני") && wellFormed(d2), "בלי תמונת מצב — הניסוח גם ב-Word");
    await assert.rejects(RU.wordBytes({ O, D }, Object.assign({}, view, { cfg: feat({ recheck: false }) })), /כבוי/);
    await assert.rejects(RU.wordBytes({ O }, view), /חסרים/); await assert.rejects(RU.wordBytes(null, view), /חסרים/);
  });

  test("בדיקה חוזרת: בקשה מעודכנת — O.mail עם update מוסיף קידומת נושא (subjectFull) ומשפט החלפה; דגל כבוי / בלי update ← המייל כמו בשלב א׳; טקסטי הבאנר והודעת הטופס", () => {
    const res = C.analyze(baseInput, D0, cfg, now), plain = O.mail(res, cfg), upd = O.mail(res, cfg, { update: { sentAt } });
    assert.ok(!("subjectFull" in plain) && !/מחליפה את הבקשה/.test(plain.body), "ללא update — כמו בשלב א׳");
    assert.equal(upd.subject, plain.subject, "subject נשאר הנושא הרגיל"); assert.equal(upd.subjectFull, "[עדכון לבקשה מ-18.10.2026] " + plain.subject);
    assert.ok(upd.body.includes("בקשה זו מחליפה את הבקשה שנשלחה ב-18.10.2026.") && upd.body.includes("מצורפת בקשה מעודכנת"), upd.body);
    assert.ok(decodeURIComponent(upd.mailto).includes("[עדכון לבקשה מ-18.10.2026] "), "mailto בנוי מהנושא המלא");
    const off = O.mail(res, feat({ recheck: false }), { update: { sentAt } }); assert.deepEqual(off, O.mail(res, feat({ recheck: false })), "דגל כבוי — זהה לשלב א׳");
    assert.ok(!("subjectFull" in off));
    const noDate = O.mail(res, cfg, { update: { sentAt: null } }); assert.ok(noDate.subjectFull.startsWith("[עדכון לבקשה קודמת] ") && /מחליפה את הבקשה הקודמת שנשלחה/.test(noDate.body) && !/1970/.test(noDate.subjectFull + noDate.body), "בלי מועד — בלי תאריך שגוי");
    assert.equal(RU.updateLine(sentAt), "בקשה זו מחליפה את הבקשה שנשלחה ב-18.10.2026.");
    const live = RU.updateBanner(sentAt, true), test_ = RU.updateBanner(sentAt, false);
    assert.ok(live.startsWith(RU.updateLine(sentAt)) && /מודיעין טיס/.test(live) && /ואין צורך לבטל/.test(live) && !/נוטאם/.test(live), live);
    assert.ok(/במצב בדיקה/.test(test_) && /רק אליכם/.test(test_) && /לא למודיעין טיס/.test(test_), test_);
    const note = RU.updateNote("חדרה" + RLO + ZW, sentAt); assert.ok(note.includes("״חדרה״") && !note.includes(RLO) && note.includes("18.10.2026") && /להריץ את הבדיקות מחדש/.test(note) && /ההצהרה/.test(note) && /תחליף/.test(note), note);
    assert.ok(RU.updateNote("x", null).endsWith("השליחה תחליף את הבקשה שנשלחה."));
  });

  test("בדיקה חוזרת: errText ו-טקסטים — הודעה בעברית לכל קוד; בטקסטי המודול ובפלט אין כתובת מייל (גם לא של הארגון); טקסט חדש אומר ״מודיעין טיס״ ולא ״משרד נוטאם״", () => {
    const S = RU.STR, A = { msg: r => "A:" + (r.message || r.error) };
    for (const c of ["no_record", "bad_folder"]) assert.equal(RU.errText({ ok: false, error: c }, A), S.noRecord);
    assert.equal(RU.errText({ ok: false, error: "bad_record" }, A), S.badRecord); assert.equal(RU.errText({ ok: false, error: "too_big" }, A), S.tooBig); assert.equal(RU.errText({ ok: false, error: "forbidden" }, A), S.forbidden); assert.equal(RU.errText({ ok: false, error: "network" }, A), S.offline);
    for (const c of ["recheck_off", "recheck_limit", "recheck_full", "not_sent", "bad_file", "rate"]) assert.equal(RU.errText({ ok: false, error: c, message: "M" }, A), "A:M", "שאר השגיאות — הניסוח המרכזי של auth.js: " + c);
    assert.equal(RU.errText({ ok: true }, A), S.badResp);
    for (const c of ["no_record", "bad_folder", "bad_record", "too_big", "forbidden"]) assert.equal(RU.transient({ ok: false, error: c }), false, "ניסיון חוזר לא יעזור: " + c);
    for (const x of [{ ok: false, error: "network" }, { ok: false, error: "rate" }, { ok: false, error: "weird" }, { ok: false }, null, undefined, "x", 5, []]) assert.equal(RU.transient(x), true, "זמני: " + JSON.stringify(x));
    for (const x of [null, undefined, "x", 5, [], { ok: false }, { ok: false, error: 5 }]) assert.equal(typeof RU.errText(x, undefined), "string");
    const all = JSON.stringify([RU.STR, RU.HELP]) + [RU.STR.saveOk(3), RU.STR.updateLoaded("x", sentAt), RU.updateBanner(sentAt, true), RU.updateBanner(sentAt, false)].join(" ");
    assert.ok(!/@|icd\.org\.il|office@/i.test(all), "אין כתובת מייל בטקסטי המודול"); assert.ok(!/icd\.org\.il|office@/i.test(src("js/recheckui.js")), "כתובת הארגון לא בקוד");
    assert.ok(!/נוטאם/.test(all), "בטקסט החדש — ״מודיעין טיס״"); assert.ok(/מודיעין טיס/.test(RU.HELP.list + RU.HELP.save + RU.HELP.update));
    assert.equal(RU.STR.btn, "🔁 בדיקה חוזרת"); assert.equal(RU.STR.save, "שמור דוח בדרייב"); assert.equal(RU.STR.download, "הורד"); assert.equal(RU.STR.update, "הכן בקשה מעודכנת");
    assert.ok(RU.STR.saveOk(2).includes("מס׳ 2") && RU.STR.saveOk(2).includes("לא צורף לבקשה שנשלחה") && !RU.STR.saveOk(0).includes("מס׳"));
  });

  test("הבקשות שלי, הרחבה: extraActs/listHtml — בלי הרחבה (או ריקה) הרשימה זהה לשלב א׳ (שני כפתורים לשורה); פעולה נוספת רק לשורות במצב שהוגדר, עם שם נגיש וescaping; שמות פעולה לא תקינים או כפולים לפעולה קיימת נזרקים", () => {
    const lm = MR.listModel({ ok: true, requests: [{ id: "a1", name: "חי", state: "sent_live", saved: 1e12, sentAt: 1e12 }, { id: "b2", name: "בדיקה", state: "sent_test", saved: 1e12, sentAt: 1e12 }, { id: "c3", name: "טיוטה", state: "draft", saved: 1e12 }, { id: "d4", name: "?", state: "x" }] });
    const base = MR.listHtml(lm);
    for (const e of [undefined, null, [], "x", 5, {}, [null], [{}], [{ act: "recheck" }]]) assert.equal(MR.listHtml(Object.assign({}, lm, { extra: e })), base, "זהה לשלב א׳: " + JSON.stringify(e));
    assert.equal((base.match(/<button/g) || []).length, 8, "שני כפתורים ל-4 שורות");
    const ex = [{ act: "recheck", text: "🔁 בדיקה חוזרת", label: "בדיקה חוזרת", states: ["sent_live", "sent_test"] }];
    const h = MR.listHtml(Object.assign({}, lm, { extra: ex }));
    assert.equal((h.match(/data-act="recheck"/g) || []).length, 2, "רק לשורות שנשלחו (חי / בדיקה)");
    assert.ok(/data-act="recheck" data-id="a1" aria-label="בדיקה חוזרת: חי">🔁 בדיקה חוזרת<\/button>/.test(h) && /data-act="recheck" data-id="b2"/.test(h) && !/data-act="recheck" data-id="c3"/.test(h) && !/data-act="recheck" data-id="d4"/.test(h));
    const evil = MR.listHtml(Object.assign({}, lm, { extra: [{ act: "recheck", text: '<img src=x onerror=1>', label: '"><b>', states: ["sent_live"] }] }));
    assert.ok(!/<img|<b>/.test(evil) && evil.includes("&lt;img src=x onerror=1&gt;") && evil.includes("&quot;&gt;&lt;b&gt;"), evil);
    for (const act of ["view", "base", "back", "retry", "yes", "no", "A", "a b", "a", "x".repeat(17), "re-check", "re_check", "__proto__", '"><i>', 5, null, ""]) assert.deepEqual(MR.extraActs([{ act, text: "t", states: ["sent_live"] }]), [], "שם פעולה נזרק: " + String(act));
    for (const bad of [{ act: "recheck", text: "", states: [] }, { act: "recheck", text: 5, states: [] }, { act: "recheck", text: "t", states: "sent_live" }, { act: "recheck", text: "t" }]) assert.deepEqual(MR.extraActs([bad]), [], JSON.stringify(bad));
    assert.equal(MR.extraActs([1, 2, 3, 4, 5].map(i => ({ act: "act" + String.fromCharCode(96 + i), text: "t", states: [] }))).length, 3, "עד שלוש פעולות");
    const my = src("js/myreq.js");
    assert.ok(/function extend\(p\) \{ ST\.ext = isObj\(p\) \? p : null; \}/.test(my) && /extend, state:/.test(my) && /try \{ ST\.ext\.onAction\(/.test(my) && /catch \(e\) \{ return \[\]; \}/.test(my), "החיבור להרחבה (נכשל בשקט, לא פוגע ברשימה)");
    assert.ok(/default: if \(extraNow\(\)\.some\(a => a\.act === b\.dataset\.act\)/.test(my), "פעולה נשלחת להרחבה רק אם היא ברשימה הנוכחית");
  });

  test("בדיקה חוזרת: חיבורים — index.html (recheckui.js אחרי recheck.js ו-myreq.js ולפני ui.js, ?v=1); ui.js — recheckAnalyze לא נוגע בבקשה שבטופס (S.res, S.data.near/far/ext, סטטוסים, אחסון), נתונים טריים; שליחה: נושא מלא, again רק בבקשה מעודכנת למשרד, באנר; הטעינה כבסיס מבטלת S.update", () => {
    const html = src("index.html"), ui = src("js/ui.js"), ru = src("js/recheckui.js");
    const at = f => html.indexOf('<script src="js/' + f + '?v=');
    assert.ok(at("recheck.js") > 0 && at("recheck.js") < at("recheckui.js") && at("myreq.js") < at("recheckui.js") && at("recheckui.js") < at("ui.js"), "סדר הטעינה");
    assert.ok(html.includes('<script src="js/recheckui.js?v=2"></script>'));
    const an = /async function recheckAnalyze\(inp, step\) \{[^]*?\n  \}\n/.exec(ui);
    assert.ok(an, "recheckAnalyze");
    for (const must of ["S.running || S.resetting", "await checkSync();", '["a17", "sync", "agri", "notam"]', "C.buildQueries(inp.lat, inp.lon, inp.radius, S.cfg)", "C.overpass(q[k], fetchOpts)", "C.analyze(inp, data, S.cfg, now)", "age > S.cfg.thresholds.notam_max_age_h) return { ok: false", "Date.parse(data.notamFetchedIso)"]) assert.ok(an[0].includes(must), "recheckAnalyze: " + must);
    for (const never of ["S.data.near", "S.data.far", "S.data.ext", "S.data.reverse", "setStatus(", "S.statuses[k] =", "S.statuses.", "S.analysisStamp", "S.scanKey", "S.imgs", "S.rid", "clearOutcome", "localStorage", "lsSet", "buildMapImage", "renderAll", "refreshGate", "M.render", "nominatim"]) assert.ok(!an[0].includes(never), "recheckAnalyze לא נוגע ב: " + never);
    assert.ok(!/\bS\.res\b/.test(an[0]), "recheckAnalyze לא נוגע ב-S.res (הבקשה שבטופס)");
    assert.ok(/data\.zones|zones: S\.data\.zones/.test(an[0]) && !/S\.data\.near/.test(an[0]), "נתוני OSM תמיד טריים — לא נקראים מ-S.data");
    const lu = /function recheckLoadUpdate\(inp, meta\) \{[^]*?\n  \}\n/.exec(ui); assert.ok(lu, "recheckLoadUpdate");
    assert.ok(/const r = myreqLoadBase\(inp\);/.test(lu[0]) && /\["dateFrom", "dateTo", "timeFrom", "timeTo", "visitDate"\]\.forEach\(id => \{ \$\(id\)\.value = inp\[id\] \|\| ""; \}\);/.test(lu[0]) && /S\.update = U \? \{ sentAt, name: meta && meta\.name, live: !\(meta && meta\.live === false\), scan: U\.scanOf\(inp\) \} : null;/.test(lu[0]), "טוען כבסיס ומחזיר תאריכים ושעות; S.update קשור לסריקה");
    assert.ok(/clearUpdate\(\);/.test(/function myreqLoadBase\(inp\) \{[^]*?\n  \}\n/.exec(ui)[0]) && /function clearUpdate\(\) \{ S\.update = null; try \{ const U = RUI\(\); if \(U && U\.clearNote\) U\.clearNote\(\); \} catch \(e\) \{ \/\* ignore \*\/ \} \}/.test(ui), "טעינת בסיס אחרת מבטלת את הקשר לבקשה מעודכנת ואת ההודעה בדף");
    const ui2 = /function updateInfo\(\) \{[^]*?\n  \}\n/.exec(ui); assert.ok(ui2 && /!U\.enabled\(S\.cfg\) \|\| !U\.sameScan\(u\.scan, S\.res\.inp\)\) return null;/.test(ui2[0]) && /catch \(e\) \{ return null; \}/.test(ui2[0]), "updateInfo: דגל, סריקה זהה, נכשל סגור");
    assert.ok(/const withUpdate = o => \{ const u = updateInfo\(\); return u \? Object\.assign\(\{\}, o \|\| \{\}, \{ update: \{ sentAt: u\.sentAt \} \}\) : o; \};/.test(ui), "withUpdate: בלי update בתוקף — o כמות שהוא");
    assert.ok((ui.match(/O\.mail\(S\.res, S\.cfg, withUpdate\(mailOpts\(\)\)\)/g) || []).length >= 3, "כל נקודות הקריאה ל-O.mail (תצוגה מקדימה, חלון שליחה, העתקה) עוברות withUpdate");
    assert.ok(!/O\.mail\(S\.res, S\.cfg(?!, withUpdate)/.test(ui), "אין קריאה ל-O.mail בלי withUpdate");
    assert.ok(/subject: mail\.subjectFull \|\| mail\.subject, body: mail\.body, again: !!again/.test(ui), "השרת אינו מוסיף את הקידומת — הלקוח שולח את הנושא המלא");
    assert.ok(/await doSend\(target, false\);/.test(ui) && /upd = updateInfo\(\);/.test(ui) && /if \(upd && target === "office" && !again && r\.similar === true\)/.test(ui), "again רק במעבר אוטומטי לבקשה מעודכנת מול הבקשה שמוחלפת, ורק ליעד משרד");
    assert.ok(/'<div class="banner warn" id="sendUpdate"/.test(ui) && /updBanner \+ dlg\.to/.test(ui) && /\(mail\.subjectFull \|\| mail\.subject\)\)/.test(ui), "הבאנר בחלון והנושא עם הקידומת");
    assert.ok(/window\.ReqRecheckUI\.hook\(\{ analyze: recheckAnalyze, loadUpdate: recheckLoadUpdate, busy: myreqBusy, inProgress: myreqInProgress \}\)/.test(ui) && /catch \(e\) \{ \/\* ״בדיקה חוזרת״ היא תוספת/.test(ui), "החיבור ב-init בתוך try/catch");
    assert.ok(!/localStorage|sessionStorage|indexedDB/.test(ru), "המודול לא שומר דבר בדפדפן"); assert.equal((ru.match(/\.innerHTML\b/g) || []).length, 1, "innerHTML רק ב-setBody (תוכן שעבר escaping)");
    assert.ok(/R\.restoreInputs\(v\.rec, \{ keepDates: true, cfg: A_\(\)\.cfg \}\)/.test(ru), "הבקשה המעודכנת שומרת את התאריכים והשעות");
    assert.ok(/availNow\(\)/.test(/function actSave[^]*?\n  \}\n/.exec(ru)[0]) && /availNow\(\)/.test(/function actUpdate[^]*?\n  \}\n/.exec(ru)[0]), "ההרשאה נבדקת שוב לפני שמירה והכנת בקשה");
    assert.ok(/A\.call\("getRequest", \{ folderId: row\.id \}\)/.test(ru) && /A\.call\("saveRecheck", \{ folderId: v\.row\.id, b64: bytesToB64\(bytes\), sum: v\.cmp\.sum \}\)/.test(ru) && !/saveBegin|saveFile|saveEnd|sendRequest/.test(ru), "הכתיבה היחידה לדרייב היא saveRecheck; אין נגיעה בפעולות השמירה והשליחה");
    assert.ok(/ST\.hooks \? provider : null/.test(ru), "ההרחבה מנותקת כשאין hook");
    assert.ok(/actions\(\) \{ return availNow\(\) \? \[\{ act: "recheck"[^]*?\] : \[\]; \}/.test(ru) && /const availNow = \(\) => \{ const A = A_\(\); return !!\(A && A\.loggedIn && A\.loggedIn\(\) && available\(A\.cfg, A\.getFeatures\(\), advNow\(\)\)\); \};/.test(ru) && /A\.isAdv\(\) === true/.test(ru), "הכפתור ב״הבקשות שלי״ וכל פעולה — רק כש-availNow (מחובר, תצוגה מתקדמת, שרת עם recheck, דגל)");
  });
}
/* RECHECKUI-UNIT-END */

/* PARTIES-UI-UNIT-BEGIN */
/* ===== ״דיווח לגורמים נוספים״ — העורך (שלב ב׳, U4): js/partiesui.js — דגל וחיבור (כבוי = אין פלט כלל), בנייה ומיזוג בין הרצות (זיכרון ואחסון בדפדפן), עריכה שמעבירה hook.changed, גורמים ידניים, רשומת הדרייב, אחסון עוין ותקרות, HTML מוגן מקלט עוין (tel: רק למספר חד-משמעי), "הצג רק פתוחות" ובדיקות מבנה לחיבורים ב-ui.js / index.html / config.json ===== */
{
  let PU = null; try { PU = require(path.join(ROOT, "members-k38p/requests/js/partiesui.js")); } catch (e) { PU = null; }
  const PP = require(path.join(ROOT, "members-k38p/requests/js/parties.js"));
  const rdq = f => fs.readFileSync(path.join(ROOT, "members-k38p/requests", f), "utf8");
  const mkAn = over => { const d = mkData(fixture("yarkon")), inp = Object.assign({}, baseInput, over || {}); return { res: C.analyze(inp, d, cfg, now), data: d }; };
  const mkStore = init => { let v = init == null ? null : init; const st = { sets: 0, dels: 0, get: () => v, set: x => { v = x; st.sets++; }, del: () => { v = null; st.dels++; }, peek: () => v }; return st; };
  const NOW = new Date(Date.UTC(2026, 9, 18, 10, 0));
  // חיבור נקי של המודול (המצב שלו גלובלי): reset + hook חדש; מחזיר מונה לקריאות changed
  const wire = (store, extra) => { PU.reset(); const calls = { n: 0 }; PU.hook(Object.assign({ changed: () => { calls.n++; }, store, now: () => NOW }, extra || {})); return calls; };
  const on = { features: { parties: true } }, off = { features: { parties: false } };
  const EVIL = "<img src=x onerror=alert(1)>\"'`&<script>alert(2)</script>";

  test("דיווח לגורמים נוספים, עורך: דגל וחיבור — רק features.parties === false מכבה (מפתח / features חסרים = פעיל); בלי hook.changed אין בנייה; כבוי ← אין שורות, אין פלט (modelOpts / mailOpts / record), אין עריכה ואין כתיבה לאחסון", () => {
    assert.ok(PU, "js/partiesui.js קיים וניתן לטעינה");
    assert.equal(cfg.features.parties, true, "config.json: המפתח מוגדר במפורש (פעיל)");
    const { res, data } = mkAn(), store = mkStore();
    for (const c of [null, {}, { features: {} }, { features: null }, { features: { parties: true } }, { features: { parties: 0 } }, { features: { parties: "false" } }, { features: { recheck: false, myreq: false } }, cfg]) { wire(store); assert.equal(PU.rebuild(res, data, c), true, JSON.stringify(c)); }
    const store0 = mkStore(); wire(store0); assert.equal(PU.rebuild(res, data, off), false); assert.equal(store0.sets + store0.dels, 0, "כבוי: לא נכתב דבר לאחסון");
    assert.equal(PU.rows(res), null); assert.deepEqual(PU.modelOpts(res), {}); assert.equal(PU.mailOpts(res), null); assert.equal(PU.record(res), null);
    assert.deepEqual(PU.setField("z:LLU20", "status", "done"), { ok: false, error: "" }); assert.equal(PU.addManual({ name: "x" }).ok, false); assert.equal(PU.removeManual("m:1").ok, false);
    assert.equal(PU.state().built, false);
    // הדגל כבה אחרי שנבנה: הכול מתרוקן
    wire(store); PU.rebuild(res, data, cfg); assert.ok(PU.rows(res)); PU.rebuild(res, data, off); assert.equal(PU.rows(res), null); assert.deepEqual(PU.modelOpts(res), {});
    // בלי hook, או hook בלי changed (ui.js לא חיבר): עריכה שלא תנקה את תוצאות השמירה היא מסוכנת — לכן אין בנייה בכלל
    PU.reset(); PU.hook(null); assert.equal(PU.rebuild(res, data, cfg), false); assert.equal(PU.rows(res), null);
    PU.hook({ store }); assert.equal(PU.rebuild(res, data, cfg), false); assert.equal(PU.modelOpts(res).parties, undefined);
    PU.hook({ changed: "x" }); assert.equal(PU.rebuild(res, data, cfg), false);
    // ללא DOM (Node): mount לא יוצר דבר ולא זורק
    wire(store); assert.equal(PU.mount(cfg), false);
    // ניתוח לא תקין
    for (const bad of [null, undefined, {}, { zones: null }]) { wire(store); assert.equal(PU.rebuild(bad, data, cfg), false, JSON.stringify(bad)); }
  });

  test("דיווח לגורמים נוספים, עורך: דגל כבוי ← המודל ל-Word זהה לשלב א׳ (אין מפתח parties, גם כשהעורך הזין שורות), והמייל זהה; דגל פעיל ← model.parties ושורת מייל אחת בלי שמות וטלפונים", () => {
    const { res, data } = mkAn(), store = mkStore();
    const base = O.docxModel(res, data, cfg, { now, images: {} }), baseMail = O.mail(res, cfg), cfgOff = Object.assign({}, cfg, off);
    wire(store); PU.rebuild(res, data, cfgOff);
    const mOff = O.docxModel(res, data, cfgOff, Object.assign({ now, images: {} }, PU.modelOpts(res), { parties: [PP.build(res, cfg, data)[0]] }));
    assert.equal(mOff.parties, undefined, "דגל כבוי: גם אם מועברות שורות — אין עמוד");
    assert.equal(JSON.stringify(mOff), JSON.stringify(O.docxModel(res, data, cfgOff, { now, images: {} })), "כבוי: מודל זהה בדיוק");
    assert.equal(JSON.stringify(mOff), JSON.stringify(base), "כבוי: זהה למודל שלב א׳ (בלי אפשרויות בכלל)");
    assert.equal(O.mail(res, cfgOff, { parties: PP.build(res, cfg, data) }).body, baseMail.body, "כבוי: המייל זהה");
    wire(store); PU.rebuild(res, data, cfg);
    const o = PU.modelOpts(res), m = O.docxModel(res, data, cfg, Object.assign({ now, images: {} }, o));
    assert.deepEqual(Object.keys(o).sort(), ["parties", "partiesDropped", "partiesFailed"]); assert.equal(o.partiesDropped, 0); assert.equal(o.partiesFailed, false);
    assert.ok(m.parties && m.parties.rows.length === PU.rows(res).length && m.parties.rows.length > 0, "יש עמוד עם שורות");
    assert.deepEqual(Object.keys(m).filter(k => k !== "parties"), Object.keys(base).filter(k => k !== "parties"), "כל שאר המודל כפי שהיה");
    const mb = O.mail(res, cfg, PU.mailOpts(res)), ls = mb.body.split("\n"), i = ls.findIndex(l => l.startsWith("• דיווח לגורמים נוספים: "));
    assert.ok(i > 0 && ls[i - 1].startsWith("• סגירה:") && ls[i + 1] === "", "השורה אחרי ״סגירה״");
    assert.deepEqual(ls.slice(0, i).concat(ls.slice(i + 1)), baseMail.body.split("\n"), "שאר המייל זהה לשלב א׳");
    assert.equal(ls[i], "• דיווח לגורמים נוספים: " + PU.rows(res).length + " גורמים"); assert.equal(mb.subject, baseMail.subject);
    assert.ok(!/\d{2,3}-\d{6,7}|LLU|@|https?:/.test(ls[i]), "בלי שמות וטלפונים");
    PU.setField(PU.rows(res)[0].key, "status", "done");
    assert.ok(O.mail(res, cfg, PU.mailOpts(res)).body.includes("• דיווח לגורמים נוספים: " + PU.rows(res).length + " גורמים — 1 דווח/התקבל אישור"));
  });

  test("דיווח לגורמים נוספים, עורך: rebuild — שורות כמו P.build על הניתוח, קשורות לניתוח הזה בלבד (ניתוח אחר ← null), מסומנות ״טרם סומן״ / ״לא נמצא איש קשר״, והכול נשמר בדפדפן תחת המפתח של הבקשה", () => {
    const { res, data } = mkAn(), store = mkStore(), calls = wire(store);
    assert.equal(PU.rebuild(res, data, cfg), true);
    const fresh = PP.build(res, cfg, data), rows = PU.rows(res);
    assert.deepEqual(rows.map(r => r.key), fresh.map(r => r.key)); assert.equal(rows.length, 22);
    assert.equal(PU.rows(Object.assign({}, res)), null, "אובייקט ניתוח אחר ← אין שורות (לא מציגים שורות של ניתוח קודם)"); assert.equal(PU.rows(null), null);
    assert.ok(rows.every(r => r.status === "unmarked" || r.status === "nocontact") && !rows.some(r => r.isNew || r.stale), "הרצה ראשונה: בלי ״חדש״");
    assert.equal(calls.n, 0, "בנייה אינה עריכה: לא נקרא changed");
    const raw = store.peek(), fp = PP.fingerprint(res.inp), parsed = JSON.parse(raw);
    assert.deepEqual(Object.keys(parsed), [fp]); assert.ok(raw.length < PU.STORE.bytes);
    assert.equal(parsed[fp].t, NOW.getTime()); assert.deepEqual(parsed[fp].manual, []);
    assert.match(fp, PU.FP_RE);
    const crash = PP.buildResult; try {
      PP.buildResult = () => { throw new Error("boom"); };
      const r2 = mkAn(), c2 = wire(mkStore()); PU.rebuild(r2.res, r2.data, cfg);
      assert.deepEqual(PU.rows(r2.res), [], "כשל כללי: אין שורות אוטומטיות, העורך נשאר"); assert.equal(PU.modelOpts(r2.res).partiesFailed, true); assert.equal(c2.n, 0);
      const pg = O.partiesPage(PU.rows(r2.res), cfg, { failed: true }); assert.equal(pg.empty, PP.TEXT.failed, "ה-Word מציג את נוסח הכשל");
      PP.buildResult = () => ({ rows: PP.build(res, cfg, data).slice(0, 3), dropped: 5, failed: ["notams"] });
      wire(mkStore()); PU.rebuild(res, data, cfg); assert.equal(PU.rows(res).length, 3); assert.deepEqual([PU.modelOpts(res).partiesDropped, PU.modelOpts(res).partiesFailed], [5, true]);
    } finally { PP.buildResult = crash; }
  });

  test("דיווח לגורמים נוספים, עורך: עריכה — setField מחזירה ok ונקראת hook.changed פעם אחת; ערך פגום (301 תווים, בקרה, בלתי נראה, סוג/סטטוס לא מוכר) ← ok:false עם הודעה, המצב לא משתנה ו-changed לא נקרא; כל עריכה נשמרת בדפדפן ובסיכום", () => {
    const { res, data } = mkAn(), store = mkStore(), calls = wire(store);
    PU.rebuild(res, data, cfg);
    const k0 = PU.rows(res)[0].key, k1 = PU.rows(res)[1].key, snap = () => JSON.stringify(PU.rows(res)), s0 = snap(), sets0 = store.sets;
    for (const [f, v] of [["note", "א".repeat(301)], ["note", "ab\u0007c"], ["note", "​"], ["note", 5], ["note", null], ["type", "other"], ["status", "weird"], ["status", "__proto__"], ["name", "x"], ["contact", "x"], ["nope", "x"]]) {
      const r = PU.setField(k0, f, v); assert.equal(r.ok, false, f + "=" + String(v).slice(0, 10)); assert.ok(typeof r.error === "string" && r.error.length > 0, "יש הודעת שגיאה לשדה " + f);
    }
    assert.equal(PU.setField("z:לא-קיים", "note", "x").ok, false);
    assert.match(PU.setField(k0, "note", "א".repeat(301)).error, /300/);
    assert.equal(snap(), s0, "ערכים פגומים לא שינו דבר"); assert.equal(calls.n, 0, "changed לא נקרא"); assert.equal(store.sets, sets0, "לא נכתב לאחסון");
    assert.deepEqual(PU.setField(k0, "status", "needed"), { ok: true, error: "" }); assert.equal(calls.n, 1);
    assert.equal(PU.setField(k0, "note", "  התקשרתי, ממתין לאישור  ").ok, true); assert.equal(calls.n, 2);
    assert.equal(PU.setField(k1, "type", "update").ok, true); assert.equal(PU.setField(k1, "status", "notneeded").ok, true); assert.equal(calls.n, 4);
    const r0 = PU.rows(res)[0]; assert.deepEqual([r0.status, r0.note], ["needed", "התקשרתי, ממתין לאישור"], "ההערה נשמרת ללא רווחי קצה");
    assert.equal(PU.setField(k0, "note", "א".repeat(300)).ok, true, "300 בדיוק — תקין");
    const fp = PP.fingerprint(res.inp), saved = JSON.parse(store.peek())[fp];
    assert.equal(saved.marks[k0].status, "needed"); assert.equal(saved.marks[k1].status, "notneeded"); assert.equal(saved.marks[k1].type, "update");
    assert.match(O.mail(res, cfg, PU.mailOpts(res)).body, /• דיווח לגורמים נוספים: 22 גורמים — 1 דווח\/התקבל אישור|• דיווח לגורמים נוספים: 22 גורמים\n/, "המייל מבוסס על המצב העדכני");
    // changed שזורק / אחסון שזורק לא מפילים את העריכה
    const boom = { changed: () => { throw new Error("x"); }, store: { get: () => { throw new Error("g"); }, set: () => { throw new Error("s"); }, del: () => { throw new Error("d"); } }, now: () => { throw new Error("n"); } };
    PU.reset(); PU.hook(boom); assert.doesNotThrow(() => PU.rebuild(res, data, cfg)); assert.equal(PU.rows(res).length, 22);
    assert.equal(PU.setField(PU.rows(res)[0].key, "status", "done").ok, true); assert.ok(PU.record(res), "record עם שעון שזורק ← שעון ברירת מחדל"); assert.doesNotThrow(() => PU.wipe());
  });

  test("דיווח לגורמים נוספים, עורך: מיזוג בין הרצות — אותה בקשה (זיכרון) שומרת סימונים וגורמים ידניים; בקשה אחרת מתחילה נקי; חזרה לראשונה משחזרת מהאחסון; דף שנטען מחדש משחזר; גורם חדש מסומן ״חדש״; שורה שדווחה ונעלמה נשארת ״מחוץ לטווח״", () => {
    const A = mkAn(), store = mkStore(), calls = wire(store);
    PU.rebuild(A.res, A.data, cfg);
    const k0 = PU.rows(A.res)[0].key, k1 = PU.rows(A.res)[1].key;
    PU.setField(k0, "status", "done"); PU.setField(k0, "note", "אושר טלפונית"); PU.setField(k1, "type", "approval");
    const man = PU.addManual({ name: "מנהל האתר", contact: "050-7654321", type: "report", status: "needed", note: "להתקשר ביום לפני" }); assert.equal(man.ok, true);
    const before = calls.n;
    // הרצה חוזרת (תוספת ידנית / הרצה מחדש): ניתוח חדש, אותו fp
    const A2 = mkAn(); PU.rebuild(A2.res, A2.data, cfg);
    const r2 = PU.rows(A2.res), by = k => r2.find(r => r.key === k);
    assert.deepEqual([by(k0).status, by(k0).note, by(k1).type], ["done", "אושר טלפונית", "approval"], "סימונים נשמרו"); assert.equal(r2.filter(r => r.manual).length, 1); assert.equal(r2.find(r => r.manual).title, "מנהל האתר");
    assert.equal(r2.filter(r => r.isNew).length, 0); assert.equal(PU.state().news, 0); assert.equal(calls.n, before, "בנייה מחדש אינה עריכה");
    assert.equal(PU.rows(A.res), null, "השורות הן של הניתוח החדש בלבד");
    // בקשה אחרת (תאריכים אחרים): נקי
    const B = mkAn({ dateFrom: "2026-11-02", dateTo: "2026-11-03" }); PU.rebuild(B.res, B.data, cfg);
    assert.notEqual(PP.fingerprint(B.res.inp), PP.fingerprint(A.res.inp));
    assert.ok(PU.rows(B.res).every(r => r.status !== "done" && !r.note && !r.manual), "בקשה אחרת: בלי סימונים ובלי ידניים");
    assert.deepEqual(Object.keys(JSON.parse(store.peek())).length, 2, "שתי בקשות באחסון");
    // חזרה לבקשה הראשונה: מהאחסון
    const A3 = mkAn(); PU.rebuild(A3.res, A3.data, cfg);
    assert.equal(PU.rows(A3.res).find(r => r.key === k0).status, "done"); assert.equal(PU.rows(A3.res).filter(r => r.manual).length, 1);
    // דף שנטען מחדש: reset + חיבור מחדש לאותו אחסון
    PU.reset(); assert.equal(PU.rows(A3.res), null); PU.hook({ changed: () => {}, store, now: () => NOW });
    const A4 = mkAn(); PU.rebuild(A4.res, A4.data, cfg);
    assert.deepEqual([PU.rows(A4.res).find(r => r.key === k0).note, PU.rows(A4.res).find(r => r.manual).note], ["אושר טלפונית", "להתקשר ביום לפני"]); assert.equal(PU.state().news, 0);
    // אחסון שבו חסר מפתח (גורם שלא היה בסריקה הקודמת) ← ״חדש״; ושורה שדווחה ונעלמה מהסריקה ← ״מחוץ לטווח״ (מה שסומן נשאר)
    const fp = PP.fingerprint(A4.res.inp), obj = JSON.parse(store.peek()), gone = PU.rows(A4.res)[5].key;
    obj[fp].keys = obj[fp].keys.filter(k => k !== gone); obj[fp].keys.push("z:GONE-1"); obj[fp].marks["z:GONE-1"] = { status: "done", title: "אזור שנעלם", src: "zone" }; store.set(JSON.stringify(obj));
    PU.reset(); PU.hook({ changed: () => {}, store, now: () => NOW }); const A5 = mkAn(); PU.rebuild(A5.res, A5.data, cfg);
    const r5 = PU.rows(A5.res);
    assert.equal(r5.filter(r => r.isNew).map(r => r.key).join(), gone); assert.equal(PU.state().news, 1);
    const st = r5.find(r => r.key === "z:GONE-1"); assert.ok(st && st.stale && st.status === "done" && st.title === "אזור שנעלם", "נשאר ״מחוץ לטווח״");
    const html = PU.listHtml(r5); assert.ok(html.includes(PP.TEXT.outOfRange) && html.includes("חדש"));
  });

  test("דיווח לגורמים נוספים, עורך: אחסון חסום / פגום — הסימונים והגורמים הידניים עדיין נשמרים בזיכרון בין הרצות של אותה בקשה (האחסון הוא נוחות בלבד), ואחסון עם תוכן פגום פשוט מתעלמים ממנו", () => {
    const blocked = { get: () => null, set: () => {}, del: () => {} }, A = mkAn();
    PU.reset(); PU.hook({ changed: () => {}, store: blocked, now: () => NOW }); PU.rebuild(A.res, A.data, cfg);
    const k0 = PU.rows(A.res)[0].key; PU.setField(k0, "status", "done"); PU.setField(k0, "note", "בזיכרון"); PU.addManual({ name: "ידני בזיכרון" });
    const A2 = mkAn(); PU.rebuild(A2.res, A2.data, cfg);
    assert.deepEqual([PU.rows(A2.res)[0].status, PU.rows(A2.res)[0].note, PU.rows(A2.res).filter(r => r.manual).map(r => r.title)], ["done", "בזיכרון", ["ידני בזיכרון"]], "בלי אחסון — הזיכרון משמר");
    for (const junk of ["{", "[]", "null", '{"x":1}', '{"32.099128,34.816617,2026-10-20,2026-10-23":{"t":1,"keys":[1,2],"marks":{"z:LLU20":{"status":"nope","note":5,"type":{}}},"manual":[1,"x",{"key":"m:1"}]}}']) {
      PU.reset(); PU.hook({ changed: () => {}, store: mkStore(junk), now: () => NOW }); const B = mkAn(); assert.doesNotThrow(() => PU.rebuild(B.res, B.data, cfg), junk.slice(0, 20));
      assert.equal(PU.rows(B.res).length, 22, "נבנה כרגיל"); assert.ok(PU.rows(B.res).every(r => !r.manual && r.status !== "done"), "תוכן פגום לא יצר סימונים");
    }
  });

  test("דיווח לגורמים נוספים, עורך: גורמים ידניים — הוספה (הטקסט נשמר כטקסט), ״changed״, תקרה 20, שם חובה, הסרה (ידני בלבד); אוטומטיים לא ניתנים להסרה", () => {
    const { res, data } = mkAn(), store = mkStore(), calls = wire(store);
    PU.rebuild(res, data, cfg); const n0 = PU.rows(res).length;
    const a = PU.addManual({ name: EVIL, contact: EVIL, note: EVIL, type: "update", status: "needed" });
    assert.deepEqual([a.ok, a.error, a.key], [true, "", "m:1"]); assert.equal(calls.n, 1); assert.equal(PU.rows(res).length, n0 + 1);
    const row = PU.rows(res).find(r => r.key === "m:1"); assert.deepEqual([row.title, row.contact, row.note, row.type, row.status], [EVIL, EVIL, EVIL.slice(0, 300), "update", "needed"]);
    assert.ok(!/<img|<script/i.test(PU.cardHtml(row, n0 + 1)), "ה-HTML של הגורם הידני מוגן");
    const rec = PU.record(res), ms = rec.manual[0]; assert.deepEqual([ms.title, ms.contact], [EVIL, EVIL]); assert.doesNotThrow(() => JSON.parse(JSON.stringify(rec)));
    for (const bad of [{ name: "" }, { name: "   " }, { name: "​​" }, { name: "a".repeat(81) }, { name: "ok", contact: "c".repeat(121) }, { name: "ok", note: "n".repeat(301) }, { name: "ok\u0007" }, { name: 5 }, null, undefined]) {
      const r = PU.addManual(bad); assert.equal(r.ok, false, JSON.stringify(bad)); assert.ok(r.error.length > 0 && r.key === "");
    }
    assert.equal(PU.rows(res).length, n0 + 1, "הפגומים לא נוספו");
    for (let i = 2; i <= 20; i++) assert.equal(PU.addManual({ name: "גורם " + i }).ok, true, "" + i);
    const over = PU.addManual({ name: "עודף" }); assert.equal(over.ok, false); assert.match(over.error, /20/);
    const nBefore = calls.n; assert.equal(PU.removeManual("m:1").ok, true); assert.equal(calls.n, nBefore + 1); assert.equal(PU.rows(res).filter(r => r.manual).length, 19);
    assert.equal(PU.addManual({ name: "אחרי הסרה" }).key, "m:21", "מספור חדש לא חוזר על מפתח שהוסר");
    const auto = PU.rows(res)[0].key, nn = calls.n; assert.equal(PU.removeManual(auto).ok, false); assert.equal(PU.removeManual("m:999").ok, false); assert.equal(PU.removeManual("").ok, false); assert.equal(calls.n, nn, "הסרה שנכשלה אינה עריכה");
    assert.equal(PU.rows(res)[0].key, auto);
  });

  test("דיווח לגורמים נוספים, עורך: record — בלוק parties לקובץ נתוני הבקשה (גרסה, זמן, סיכום, שורות וידניות), JSON תקין עד 24KB, וחוזר דרך P.restore עם אותם סימונים; אין בו פרטי מבקש", () => {
    const { res, data } = mkAn(PII_LIKE()), store = mkStore(); wire(store); PU.rebuild(res, data, cfg);
    PU.setField(PU.rows(res)[0].key, "status", "needed"); PU.setField(PU.rows(res)[0].key, "note", "הערה"); PU.addManual({ name: "ידני", contact: "03-1234567", note: "x" });
    const rec = PU.record(res), txt = JSON.stringify(rec);
    assert.deepEqual(Object.keys(rec), ["v", "builtAt", "summary", "rows", "manual"]); assert.equal(rec.v, 1); assert.equal(rec.builtAt, NOW.toISOString());
    assert.deepEqual(rec.summary, PP.summary(PU.rows(res))); assert.equal(rec.summary.total, 23); assert.equal(rec.summary.needed, 1);
    assert.ok(txt.length < 24 * 1024, "עד 24KB: " + txt.length);
    const back = PP.restore(JSON.parse(txt), cfg); assert.equal(back.length, 23); assert.equal(back[0].status, "needed"); assert.equal(back[0].note, "הערה"); assert.equal(back.find(r => r.manual).title, "ידני");
    for (const v of ["בודק ראשון", "050-7654321", "פלוני אלמוני", "חברת הבדיקה"]) assert.ok(!txt.includes(v), "פרט מבקש בבלוק: " + v);
    assert.ok(!/icd\.org\.il|office@|052-5076677/.test(txt), "בלי כתובת הארגון וטלפון התמיכה");
    function PII_LIKE() { return { requesterName: "פלוני אלמוני", requesterPhone: "050-7654321", requesterOrg: "חברת הבדיקה" }; }
  });

  test("דיווח לגורמים נוספים, עורך: אחסון בדפדפן — storeParse/storeWrite: קלט עוין (__proto__, מערכים, מפתח לא חוקי, ענק, JSON שבור) נבלע; תקרות 20 בקשות ו-60KB (הנוכחית נשארת; לבדה מעל התקרה ← נמחקת); סדר לפי זמן", () => {
    const map = PU.storeParse('{"__proto__":{"x":1},"constructor":1,"a":1,"32.1,34.8,2026-10-20,2026-10-21":{"t":5,"keys":"x","marks":[],"manual":{}},"32.2,34.8,2026-10-20,2026-10-21":[1],"32.3,34.8,2026-10-20,2026-10-21":{"t":"zz","keys":["z:1"],"marks":{"z:1":{"status":"done"}},"manual":[]}}');
    assert.deepEqual(Object.keys(map).sort(), ["32.1,34.8,2026-10-20,2026-10-21", "32.3,34.8,2026-10-20,2026-10-21"]); assert.equal(({}).x, undefined, "אין זיהום אב-טיפוס");
    assert.deepEqual(map["32.1,34.8,2026-10-20,2026-10-21"], { t: 5, keys: [], marks: {}, manual: [] }); assert.equal(map["32.3,34.8,2026-10-20,2026-10-21"].t, 0);
    for (const bad of [null, undefined, 5, {}, [], "", "{", "[]", "null", '"x"', "x".repeat(PU.STORE.raw + 1), JSON.stringify([1, 2])]) assert.deepEqual(Object.keys(PU.storeParse(bad)), [], String(bad).slice(0, 20));
    assert.equal(PU.storeRead("{}", "32.1,34.8,2026-10-20,2026-10-21"), null); assert.equal(PU.storeRead('{"__proto__":{"t":1}}', "__proto__"), null);
    // תקרת 20 בקשות
    const fpOf = i => "32." + String(100000 + i) + ",34.800000,2026-10-20,2026-10-21", mkRows = (n, note, tl) => Array.from({ length: n }, (_, i) => PP.setField([{ key: "z:r" + i, src: "zone", title: ("שורה " + i + " ").padEnd(tl || 8, "ש"), tag: "", party: "", contacts: { phones: [], emails: [], urls: [], lines: [], pairs: null, general: null }, contactSrc: "", hasContact: false, dtype: "report", mark: {} }], "z:r" + i, "note", note).rows[0]);
    let raw = ""; for (let i = 0; i < 25; i++) raw = PU.storeWrite(raw, fpOf(i), mkRows(1, "n"), 1000 + i);
    let keys = Object.keys(JSON.parse(raw)); assert.equal(keys.length, 20); assert.ok(!keys.includes(fpOf(0)) && !keys.includes(fpOf(4)) && keys.includes(fpOf(5)) && keys.includes(fpOf(24)), "הישנות נמחקו");
    raw = PU.storeWrite(raw, fpOf(5), mkRows(1, "מעודכן"), 99999); keys = Object.keys(JSON.parse(raw)); assert.equal(keys.length, 20, "עדכון בקשה קיימת לא מוסיף"); assert.equal(JSON.parse(raw)[fpOf(5)].t, 99999);
    raw = PU.storeWrite(raw, fpOf(30), mkRows(1, "x"), 100000); assert.ok(!Object.keys(JSON.parse(raw)).includes(fpOf(6)), "הכי ישנה אחרי העדכון (fp 6) נמחקה"); assert.ok(Object.keys(JSON.parse(raw)).includes(fpOf(5)));
    // תקרת 60KB: ערימה של רשומות גדולות — הישנות נמחקות, הנוכחית נשארת
    const note = "א".repeat(300), bigRows = mkRows(60, note); let big = "";
    for (let i = 0; i < 12; i++) big = PU.storeWrite(big, fpOf(i), bigRows, 2000 + i);
    assert.ok(big.length <= PU.STORE.bytes, "עד 60KB: " + big.length); assert.ok(Object.keys(JSON.parse(big)).includes(fpOf(11)), "הנוכחית נשארה"); assert.ok(!Object.keys(JSON.parse(big)).includes(fpOf(0)), "הישנה נמחקה");
    // רשומה אחת מעל התקרה (120 שורות עם הערות) ← לא נכתבת, והאחרות נשארות
    let hugeRows = mkRows(120, note, 120); for (let i = 0; i < 20; i++) hugeRows = PP.addManual(hugeRows, { name: "ש".repeat(80), contact: "ג".repeat(120), note }).rows;
    assert.ok(JSON.stringify(PP.marks(hugeRows)).length > PU.STORE.bytes, "הרשומה המלאכותית באמת מעל התקרה: " + JSON.stringify(PP.marks(hugeRows)).length);
    const huge = PU.storeWrite(PU.storeWrite("", fpOf(1), mkRows(2, "x"), 5), fpOf(2), hugeRows, 6);
    assert.deepEqual(Object.keys(JSON.parse(huge)), [fpOf(1)], "רשומה לבדה מעל 60KB נמחקת"); assert.equal(PU.storeWrite("", fpOf(2), hugeRows, 6), "", "ואם היא היחידה — מחרוזת ריקה (מחיקת המפתח)");
    assert.equal(PU.storeWrite("{}", "not-a-fp", mkRows(1, "x"), 1), "", "fp לא חוקי לא נכתב");
    // חזרה: storeRead מחזיר את מה שנכתב (בצורה שמתאימה ל-P.merge)
    const rd1 = PU.storeRead(PU.storeWrite("", fpOf(3), mkRows(2, "נ"), 7), fpOf(3)); assert.equal(rd1.marks["z:r0"].note, "נ"); assert.equal(rd1.t, 7);
  });

  test("דיווח לגורמים נוספים, עורך: HTML מוגן מקלט עוין — כותרת, תג, גורם, קטעים, תוויות, מקור, טלפונים, דוא״ל, אתרים, זוגות, הערה ושם/פרטי קשר ידניים; tel: רק למספר חד-משמעי; אתר רק http(s) נקי; בלי אלמנט או מאפיין שהוזרקו", () => {
    const ph = (text, kind, tel, range) => ({ raw: text, display: text, text, kind, tel, range: range || "" });
    const row = { key: 'z:"><b>' + EVIL, src: "zone", title: EVIL, tag: EVIL, party: EVIL, count: 5, isNew: true, updated: true, stale: true,
      contacts: { phones: [ph("03-1234567", "landline", "tel:+97231234567"), ph(EVIL, "landline", "javascript:alert(1)"), ph("073-3636954/5", "voip", "tel:+97233636954", "/5"), ph("+1 555 0100", "unverified", "tel:+15550100"), ph("1-700-123-456", "tollfree", "tel:1700123456"), ph("050-1111111", "mobile", 'tel:+972501111111"onclick="x'), ph("052-2222222", "mobile", "TEL:+972522222222")],
        emails: [EVIL, "a@b.co"], urls: ["javascript:alert(1)", "data:text/html,<script>x</script>", "https://example.com/a?b=1&c=2", "https://example.com/x<y>", "//evil.com", "ftp://x.org/a", "https://icd.org.il/x"], lines: [EVIL, "שורה עם 03-1234567 בתוכה"], pairs: null,
        general: { label: EVIL, src: EVIL, phones: [], emails: [EVIL], lines: [EVIL], pairs: [{ label: EVIL, phone: ph("03-1111111", "landline", "tel:+97231111111") }, { label: "x", phone: ph("04-2222222", "landline", "tel:+97242222222") }] } },
      contactSrc: EVIL, hasContact: true, dtype: "report", mark: { note: EVIL }, type: "report", status: "needed", note: EVIL, cue: EVIL };
    const html = PU.cardHtml(row, 3), tags = [...html.matchAll(/<([a-z0-9]+)\b/gi)].map(m => m[1].toLowerCase());
    assert.deepEqual([...new Set(tags)].filter(t => !["li", "div", "span", "b", "bdi", "p", "a", "ul", "label", "select", "option", "input", "button"].includes(t)), [], "רק תגיות העורך: " + [...new Set(tags)].join());
    // כל "<" בפלט הוא תגית תקינה (שם + מאפיינים במרכאות כפולות בלי "<>" בערכים) — אין "<" גולמי בתוכן או בערכים; ואין מאפיין on* (שמות המאפיינים נבדקים בלי הערכים)
    const tagRe = /<\/?([a-z0-9]+)((?:\s+[a-z][a-z0-9\-]*(?:="[^"<>]*")?)*)\s*\/?>/gi, toks = [...html.matchAll(tagRe)];
    assert.equal(toks.length, (html.match(/</g) || []).length, "אין '<' גולמי בפלט");
    const attrNames = toks.flatMap(t => [...t[2].replace(/="[^"]*"/g, "").matchAll(/\s([a-z][a-z0-9\-]*)/gi)].map(m => m[1].toLowerCase()));
    assert.ok(attrNames.length > 10 && !attrNames.some(n => /^on/.test(n) || n === "style" || n === "srcdoc"), "אין מטפל on* / style שהוזרק: " + [...new Set(attrNames)].join());
    assert.ok(!/<(img|script|svg|iframe|style)\b/i.test(html));
    assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;") && html.includes("&quot;") && html.includes("&#39;") && html.includes("&amp;"), "הטקסט נשמר, מוגן");
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map(m => m[1]);
    assert.deepEqual(hrefs.filter(h => h.startsWith("tel:")).sort(), ["tel:+97231111111", "tel:+97231234567", "tel:+97242222222", "tel:1700123456"].sort(), "tel: רק למספרים חד-משמעיים (לא סיומת, לא ״לא אומת״, לא ערך חשוד)");
    assert.deepEqual(hrefs.filter(h => !h.startsWith("tel:")), ["https://example.com/a?b=1&amp;c=2"], "קישור אתר אחד בלבד — נקי; כל השאר טקסט");
    assert.ok(!/javascript:|data:text|ftp:|\/\/evil|icd\.org\.il(?!.*<\/)/.test(hrefs.join(" ")), "אין סכמות מסוכנות בקישורים");
    assert.ok(/<a class="pty-url" href="https:\/\/example\.com\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer" dir="ltr">/.test(html), "קישור חיצוני עם rel=noopener noreferrer");
    assert.equal((html.match(/target="_blank"/g) || []).length, 1); assert.ok(!/href="(?!tel:|https:\/\/example)/.test(html));
    assert.ok(/<bdi dir="ltr">03-1234567<\/bdi>/.test(html) && html.includes("(לא אומת)") && /<bdi class="pty-em" dir="ltr">a@b\.co<\/bdi>/.test(html), "מספרים ודוא״ל ב-bdi ltr");
    assert.ok(!html.includes('tel:+15550100') && !html.includes("+97233636954") && !html.includes("onclick="), "בלי tel: לסיומת / ללא אימות / לערך עם מרכאה");
    assert.match(html, /aria-labelledby="ptyT3"/); assert.match(html, /id="ptyT3"/); assert.match(html, /data-key="z:&quot;&gt;&lt;b&gt;&lt;img/); assert.match(html, /aria-describedby="ptyE3"/); assert.match(html, /id="ptyE3"/);
    assert.ok(html.includes(PP.TEXT.updated) && html.includes(PP.TEXT.outOfRange) && html.includes(">חדש<"), "תגי ״חדש״, ״עודכנו״ ו״מחוץ לטווח״");
    // ידני: ערכי השדות (name / contact / note) במאפיין value מוגנים
    const man = PU.cardHtml({ key: "m:1", src: "manual", manual: true, title: EVIL, contact: EVIL, note: EVIL, type: "report", status: "needed", contacts: {}, mark: {} }, 7);
    assert.ok(![...man.matchAll(/value="([^"]*)"/g)].some(m => /[<>]/.test(m[1])) && !/<(img|script)\b/i.test(man) && /data-f="name"/.test(man) && /data-f="contact"/.test(man) && /data-act="rm"/.test(man), "שדות הידני מוגנים, יש כפתור הסרה");
    assert.ok(/<span class="vh" id="ptyT7">גורם ידני 7<\/span>/.test(man) && /aria-label="הסר גורם ידני 7"/.test(man), "שם נגיש לקבוצה ולכפתור ההסרה");
    // שורה פגומה לא זורקת
    for (const bad of [{}, { key: "z:1" }, { key: "z:1", contacts: null }, { key: "z:1", contacts: { phones: [null, 5, "x"], emails: [5], urls: [{}], lines: [null], pairs: [null] }, status: 5, type: {} }, null, undefined]) assert.doesNotThrow(() => PU.cardHtml(bad, 1), JSON.stringify(bad));
    assert.doesNotThrow(() => PU.listHtml(null)); assert.equal(PU.listHtml(null), "");
    // tel: — הטבלה של telHref
    for (const [p, want] of [[ph("1", "landline", "tel:+972312345678"), "tel:+972312345678"], [ph("1", "mobile", "tel:+972501234567"), "tel:+972501234567"], [ph("1", "voip", "tel:+972312345"), ""], [ph("1", "landline", "tel:+9723123456789"), ""], [ph("1", "tollfree", "tel:1599123456"), "tel:1599123456"], [ph("1", "tollfree", "tel:1599123"), ""], [ph("1", "landline", " tel:+972312345678"), ""], [ph("1", "landline", "tel:+972312345678\n"), ""], [ph("1", "landline", "tel:+972312345678", "/5"), ""], [{ tel: "tel:+972312345678", kind: "unverified" }, ""], [null, ""], [undefined, ""], ["tel:+972312345678", ""], [{ tel: 5 }, ""], [{}, ""]]) assert.equal(PU.telHref(p), want, JSON.stringify(p));
  });

  test("דיווח לגורמים נוספים, עורך: ״הצג רק פתוחות״ — isOpen (ידני, נדרש, דווח, טרם סומן, או הערה ← פתוח; אין צורך / לא נמצא איש קשר בלי הערה ← מוסתר); המספור קבוע; הכרטיסים הם <li> עם מבנה נגיש ותוויות גלויות (סוג, סטטוס, הערה) וסמל סטטוס בטקסט", () => {
    const base = { contacts: { phones: [], emails: [], urls: [], lines: [], pairs: null, general: null }, src: "zone", title: "t", tag: "", party: "", contactSrc: "", mark: {} };
    const mk = (key, status, extra) => Object.assign({ key, status, type: "report", note: "" }, base, extra || {});
    const rows = [mk("z:1", "unmarked"), mk("z:2", "nocontact"), mk("z:3", "notneeded"), mk("z:4", "needed"), mk("z:5", "done"), mk("z:6", "nocontact", { note: "כתבתי" }), mk("z:7", "notneeded"), mk("m:1", "notneeded", { manual: true, src: "manual", title: "ידני", contact: "" })];
    assert.deepEqual(rows.map(PU.isOpen), [true, false, false, true, true, true, false, true]); assert.equal(PU.isOpen(null), false); assert.equal(PU.isOpen({ status: "weird" }), true);
    const all = PU.listHtml(rows), open = PU.listHtml(rows, { onlyOpen: true }), ids = h => [...h.matchAll(/id="ptyT(\d+)"/g)].map(m => +m[1]);
    assert.deepEqual(ids(all), [1, 2, 3, 4, 5, 6, 7, 8]); assert.deepEqual(ids(open), [1, 4, 5, 6, 8], "המספור קבוע גם כשהסינון מסתיר");
    assert.equal((all.match(/<li class="pty"/g) || []).length, 8); assert.ok(/<li class="pty" role="group" aria-labelledby="ptyT1" data-key="z:1" data-st="unmarked">/.test(all));
    const c1 = PU.cardHtml(rows[3], 4);
    assert.ok(/<label class="pty-l"><span>סוג<\/span><select data-f="type">/.test(c1) && /<span>סטטוס <span class="pty-ic" aria-hidden="true">!<\/span><\/span><select data-f="status">/.test(c1) && /<span>הערה<\/span><input type="text" data-f="note" maxlength="300"/.test(c1), "תוויות גלויות לכל בקר, ולא placeholder");
    assert.ok(!/placeholder/.test(c1), "אין placeholder בכרטיס");
    for (const [s, ic] of [["needed", "!"], ["done", "✓"], ["nocontact", "—"], ["notneeded", "○"], ["unmarked", "·"]]) assert.ok(PU.cardHtml(mk("z:9", s), 1).includes('<option value="' + s + '" selected>' + ic + " "), "סמל + טקסט לסטטוס " + s);
    assert.deepEqual([...c1.matchAll(/<option value="([a-z]+)"/g)].map(m => m[1]), ["approval", "report", "update", "unmarked", "needed", "done", "nocontact", "notneeded"], "שלושת הסוגים וחמשת הסטטוסים, טרם סומן ראשון");
    assert.ok(/<p class="err pty-e" id="ptyE4"><\/p>/.test(c1), "מקום להודעת שגיאה ליד השדה");
  });

  test("דיווח לגורמים נוספים, עורך: חיבורים — index.html טוען parties.js ואחריו partiesui.js ושניהם לפני ui.js (?v=1); ui.js: כל החיבורים (בנייה אחרי run ו-reanalyze, modelOpts, העמוד בדוח, שלושת קוראי O.mail, בלוק parties ברשומה לפני תמונת המצב, איפוס, מחיקת פרטים, hook ו-mount) — ולא נוגעים בשער; config.json: features.parties", () => {
    const html = rdq("index.html"), ui = rdq("js/ui.js"), pui = rdq("js/partiesui.js");
    const at = f => html.indexOf('<script src="js/' + f + '?v=');
    assert.ok(at("output.js") > 0 && at("parties.js") > at("output.js") && at("partiesui.js") > at("parties.js") && at("ui.js") > at("partiesui.js"), "סדר הטעינה");
    assert.ok(html.includes('<script src="js/parties.js?v=2"></script>') && html.includes('<script src="js/partiesui.js?v=2"></script>'));
    assert.ok(!/id="partiesBox"|ptyList|partiesStyle/.test(html), "אין DOM של העורך ב-index.html (נוצר רק כשהדגל פעיל)");
    assert.ok(/function partiesRebuild\(data\) \{ try \{ const U = PUI\(\); if \(U && S\.res\) U\.rebuild\(S\.res, data, S\.cfg\); \} catch \(e\)/.test(ui), "partiesRebuild: try/catch, רק עם ניתוח");
    const run = /async function run\(\) \{[^]*?\n  \}\n/.exec(ui)[0], rea = /async function reanalyze\(\) \{[^]*?\n  \}\n/.exec(ui)[0];
    assert.ok(/S\.res = res; S\.scanKey = scanKeyOf\(inp0\);[^]*?partiesRebuild\(data\);[^]*?await buildMapImage\(steps, st\);/.test(run), "run: הבנייה אחרי S.res ולפני תמונות המפה והדוח");
    assert.ok(/S\.res = C\.analyze\(inp, data, S\.cfg, new Date\(\)\);[^]*?partiesRebuild\(data\);[^]*?clearOutcome\(\);/.test(rea), "reanalyze: הבנייה אחרי הניתוח החדש");
    assert.ok(/const mo = \{ images: images \|\| \{\}, providerName:[^]*?adv: isAdv\(\) \};[^]*?return Object\.assign\(mo, partiesOpts\(\)\);/.test(ui), "modelOpts מוסיף partiesOpts");
    assert.ok(/\$\("report"\)\.innerHTML = p1 \+ pImgs \+ \(mdl\.parties \? O\.partiesHtml\(mdl\.parties\) : ""\) \+ p3;/.test(ui), "העמוד בדוח: אחרי התמונות ולפני דף הבדיקות");
    assert.equal((ui.match(/O\.mail\(S\.res, S\.cfg, (?:withUpdate\()?mailOpts\(\)/g) || []).length, 3, "שלושת הקוראים: renderAll, sendToNotamOpen, copyMail (אפשר לעטוף ב-withUpdate של הבדיקה החוזרת)"); assert.ok(!/O\.mail\(S\.res, S\.cfg\)/.test(ui), "אין קורא ישן");
    const rec = /function inputsForRecord\(\) \{[^]*?\n  \}\n/.exec(ui)[0];
    assert.ok(/const pr = partiesRecord\(\); if \(pr\) rec\.parties = pr;[^]*?return myreqSnapRecord\(rec\);/.test(rec) && rec.indexOf("rec.parties") < rec.indexOf("myreqSnapRecord(rec)"), "הבלוק נכנס לרשומה לפני תמונת המצב (הגודל נבדק עם הבלוק)");
    const rp = ui.slice(ui.indexOf("function resetPage()"), ui.indexOf("function onPageShow"));
    assert.ok(/step\(partiesReset\);/.test(rp) && /function enterUser\(u\) \{\n    S\.uk = C\.userHash\(u\);\n    partiesReset\(\);/.test(ui), "איפוס בהתנתקות / החלפת משתמש");
    assert.ok(/function wipePerson\(\) \{\n    if \(!authed\(\)\) return;\n    lsDel\(PERSON_KEY\);[^]*?U\.wipe\(\)/.test(ui), "״מחק פרטים שמורים״ מוחק גם את הסימונים");
    assert.ok(/U\.hook\(\{ changed: \(\) => \{ S\.autoSlowUntil = Date\.now\(\) \+ AUTO_SLOW_MS \+ 5000; onSoftInputChange\(\); \}, store: \{ get: \(\) => lsGet\(PARTIES_KEY\), set: v => lsSet\(PARTIES_KEY, v\), del: \(\) => lsDel\(PARTIES_KEY\) \}, now: \(\) => new Date\(\) \}\); U\.mount\(S\.cfg\);/.test(ui), "hook: changed = onSoftInputChange (אותו תזמון של שדה רך, עם שמירה אוטומטית איטית), אחסון לפי המשתמש");
    assert.ok(/const PARTIES_KEY = "icd_req_parties_v1";/.test(ui));
    const body = ui.slice(ui.indexOf("/* ---------- דיווח לגורמים נוספים"), ui.indexOf("/* ---------- הדוח ----------")).replace(/\/\/.*$/gm, "");   // בלי הערות
    assert.ok(body.length > 200 && !/S\.ready|S\.statuses|setStatus|REQUIRED_CHECKS|refreshGate/.test(body), "בלוק החיבור לא נוגע במוכנות");
    assert.ok(!/setStatus\(\s*"parties|statuses\.parties|statuses\["parties|S\.ready\s*=[^;\n]*partie/i.test(ui) && !/partie/i.test(rdq("js/core.js")), "הגורמים אינם בדיקת שער: לא ב-ui.js ולא ב-C.gate (core.js)");
    const puiCode = pui.replace(/\/\*[^]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");   // בלי הערות
    assert.ok(!/S\.ready|setStatus|refreshGate|clearOutcome|S\.statuses/.test(puiCode), "partiesui.js אינו נוגע בשער ובתוצאות — כל עריכה עוברת רק hook.changed");
    assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|setInterval|navigator\./.test(puiCode), "אין אחסון ישיר, רשת או טיימר חוזר במודול (האחסון דרך hook.store, ללא טיימר)");
    const rhs = [...pui.matchAll(/(?:\.innerHTML = |insertAdjacentHTML\("afterend", )([^;]{0,40})/g)].map(m => m[1]);
    assert.equal(rhs.length, 7, "שבעה מקומות כתיבת HTML בלבד"); assert.ok(rhs.every(x => /^(""|total \? listHtml\(|chipsHtml\(\)|typeOpts\(|statusOpts\(|'<h3 id="ptyTitle">|'<span class="small" id="ptyChkNote">)/.test(x)), "כל כתיבה ל-HTML היא ממבנה מוגן: " + rhs.join(" | "));
    assert.equal(JSON.parse(rdq("config.json")).features.parties, true);
    const feat = JSON.parse(rdq("config.json")).features; for (const k of ["myreq", "parties"]) assert.equal(feat[k], true, "config.features." + k);
  });

  test("דיווח לגורמים נוספים, עורך: נוסחים — הסבר ה-״!״ ומחרוזות העורך: בלי כתובת הארגון ובלי ״מנהל המערכת״; מודיעין טיס בטקסט החדש ולא ״משרד נוטאם״; ההסבר מתאר את מה שנעשה בפועל (עמוד בלי תלות בדף בדיקות, שורת מייל בלי שמות, נשמר בדפדפן, לא חוסם)", () => {
    const all = JSON.stringify([PU.HELP, PU.STR, PP.TEXT]) + rdq("js/partiesui.js").replace(/\/\*[^]*?\*\//, "");
    assert.ok(!/office@|icd\.org\.il|מנהל המערכת|info@|052-5076677/.test(JSON.stringify([PU.HELP, PU.STR])) && !/icd\.org\.il|office@/.test(rdq("js/partiesui.js")), "בלי כתובת הארגון ובלי ״מנהל המערכת״");
    assert.ok(/מודיעין טיס/.test(PU.HELP) && !/משרד נוטאם/.test(PU.HELP + JSON.stringify(PU.STR)), "ה-״!״ ו-STR: מודיעין טיס, לא ״משרד נוטאם״");
    for (const must of ["אינם מאומתים", "הסימונים הם שלכם", "עמוד נפרד", "גם כשסימון ״כולל דף בדיקות״ כבוי", "שורה אחת עם ספירה בלבד, בלי שמות וטלפונים", "אינה מונעת שמירה או שליחה", "נשמרים בדפדפן הזה בלבד", "עד 20"]) assert.ok(PU.HELP.includes(must), "ההסבר מזכיר: " + must);
    assert.ok(PU.HELP.length > 400 && PU.HELP.length < 1800, "אורך סביר: " + PU.HELP.length);
    assert.ok(all.length > 1000);
    // העובדות שההסבר מתאר — נבדקות מול הקוד: העמוד נכנס ל-Word גם כש-includeChecks כבוי; המייל בלי שמות
    const { res, data } = mkAn(), store = mkStore(); wire(store); PU.rebuild(res, data, cfg);
    const m = O.docxModel(res, data, cfg, Object.assign({ now, images: {}, includeChecks: false }, PU.modelOpts(res))); assert.ok(m.parties && m.includeChecks === false);
    assert.equal(PP.LIMITS.manual, 20);
  });
}
/* PARTIES-UI-UNIT-END */

/* ===== תיקוני סקירה שלב ב׳: ביטוי באנגלית ב-bdi אחד, בקשה מעודכנת (הגנת כפילות, חי בלבד, נושא מלא בהעתקה), שמירה אוטומטית איטית בעריכת גורמים, fmtZ בטוח ===== */
test("עמוד הגורמים: ביטוי באנגלית (TLV APP ON 119.35) נשאר bdi אחד — אחרת הסדר מתהפך בפסקה מימין לשמאל; שני טלפונים סמוכים נשארים נפרדים (nowrap)", () => {
  const row = pbRow({ key: "o:eng", src: "notam", title: "נוטם", party: "מוזכר בנוטם: TLV APP ON 119.35 לפני כניסה", contacts: { phones: [pbPhone("03-1234567"), pbPhone("052-9265944")], emails: [], urls: [], lines: ["03-1234567 052-9265944"], pairs: null, general: null }, contactSrc: "" });
  const h = O.partiesHtml(O.docxModel(PB_res, PB_data, cfg, { now, parties: [row] }).parties);
  assert.ok(h.includes("<bdi dir='ltr'>TLV APP ON 119.35</bdi>"), h.slice(0, 600));
  assert.ok(!/<bdi dir='ltr'>TLV<\/bdi>\s*<bdi/.test(h), "לא bdi נפרד לכל מילה");
  assert.ok(h.includes("<bdi dir='ltr' class='ph'>03-1234567</bdi>") && h.includes("<bdi dir='ltr' class='ph'>052-9265944</bdi>"), "טלפונים נפרדים עם nowrap");
  const pu = readReq("js/partiesui.js");
  assert.match(pu, /runs\.push\(\{ at: k\.at, end: k\.at \+ k\.m\.length, text: k\.m \}\)/, "אותו איחוד בעורך שבמסך");
});

test("ui.js: בקשה מעודכנת — doSend קודם בלי again; מעבר אוטומטי ל-again רק כשהשרת מזהה את הבקשה המוחלפת (similar); ניסוח ״מחליפה״ רק למקור שנשלח חי במצב חי; copyMail עם הנושא המלא; שמירה אוטומטית איטית בעריכת גורמים", () => {
  const ui = readReq("js/ui.js"), rc = readReq("js/recheckui.js");
  assert.match(ui, /await doSend\(target, false\);/, "תמיד קודם בלי again");
  assert.ok(!/await doSend\(target, !!upd/.test(ui), "אין again שנקבע מראש לבקשה מעודכנת");
  assert.match(ui, /if \(upd && target === "office" && !again && r\.similar === true\) \{[^}]*return doSend\(target, true\);/, "מעבר אוטומטי רק מול similar");
  assert.match(ui, /if \(u\.live === false && window\.ReqAuth && window\.ReqAuth\.getMailMode && window\.ReqAuth\.getMailMode\(\) === "live"\) return null;/, "מקור שנשלח רק בבדיקה אינו מוחלף במצב חי");
  assert.match(ui, /live: !\(meta && meta\.live === false\)/); assert.match(rc, /live: v\.row\.state === "sent_live"/);
  assert.match(ui, /"\\nנושא: " \+ \(m\.subjectFull \|\| m\.subject\) \+ "\\n\\n" \+ m\.body;/, "copyMail: הנושא המלא");
  assert.match(ui, /function autoDelay\(\) \{[^}]*Math\.max\(base, AUTO_SLOW_MS\)/); assert.match(ui, /const AUTO_SLOW_MS = 20000;/);
  assert.match(ui, /U\.hook\(\{ changed: \(\) => \{ S\.autoSlowUntil = Date\.now\(\) \+ AUTO_SLOW_MS \+ 5000; onSoftInputChange\(\); \}/, "עריכת גורמים מאטה את השמירה האוטומטית");
});

test("recheck.js: תאריכי NOTAM מחוץ לטווח בקובץ פגום לא זורקים RangeError בהצגה (fmtZ)", () => {
  const rc = readReq("js/recheck.js");
  assert.match(rc, /const fmtZ = ms => \{ const d = new Date\(ms\); return isNaN\(d\.getTime\(\)\) \? "" : /);
});

test("סעיף 3 (רשימת ההתקדמות): מבקש רגיל מקבל ניסוח פשוט בלי מקורות; מנהל ותצוגה מתקדמת — הפירוט הקיים", () => {
  const ui = readReq("js/ui.js");
  // upd בוחרת לפי isAdv: הפירוט הטכני כמו שהיה למתקדם, plainSteps לשאר
  assert.match(ui, /const upd = \(\) => progress\(steps\.flatMap\(x => isAdv\(\) \? \[\{ s: x\.s, t: x\.t, m: x\.m \}\] : plainSteps\(x\)\)\);/);
  // הכותרות והפירוט הטכני של המתקדם לא השתנו
  for (const t of ["מכשולים ותשתיות בסביבה (OpenStreetMap)", "שדות תעופה, מנחתים וישובים (OpenStreetMap)", "גבולות מדינה ושטחי טבע (OpenStreetMap)", "שם המקום (Nominatim)", "ארבע תמונות מפה עם רקע (תצ״א, מפת רחובות, הדמיה, מפת אזור)"]) assert.ok(ui.includes('t: "' + t + '"'), t);
  assert.ok(ui.includes('" אלמנטים"') && ui.includes('"הרקע נטען ("'));
  // הניסוח הפשוט: נתיבי plainSteps לא מזכירים מקורות
  const ps = ui.slice(ui.indexOf("function plainSteps"), ui.indexOf("async function run()"));
  assert.ok(ps.length > 500 && !/OpenStreetMap|Nominatim|overpass|אלמנט|אריח|mirror|hostname/i.test(ps), "plainSteps ללא שמות מקורות");
  for (const t of ["נבדקו \" + x.v + \" מכשולים ותשתיות בסביבה", "נבדקו \" + x.v + \" שדות תעופה, מנחתים וישובים", "נבדקו הגבולות הקרובים לאזור ההטסה ורשות הטבע והגנים באזור הקרוב להטסה", "זוהה המקום: ", "נבדקו אזורי איסור והגבלה באזור ההטסה", "נבדקו שמורות טבע וגנים לאומיים", "נבדקו מנחתים חקלאיים", "נבדקו נוטמים (סגירות מרחב אוויר ומכשולים שפורסמו)", "נוצרו ארבע תמונות מפה"]) assert.ok(ps.includes(t), t);
  // כשל טעינה: ניסוח ניטרלי אחד, גם בשורה, גם ליד הכפתור (כשל רשת מסומן e.net) וגם בבאנר השער; למנהל/מתקדם נשארת ההודעה המקורית
  assert.match(ui, /const NOT_LOADED = "הנתונים לא נטענו, נסו שוב בעוד מספר דקות";/);
  assert.match(ui, /setStatus\(sk, false, e\.message, \{ maint: true, adv: true, user: NOT_LOADED \}\);[^\n]*e\.net = true/);
  assert.match(ui, /\(e\.net && !isAdv\(\) \? NOT_LOADED : e\.message\)/);
  assert.match(ui, /isAdv\(\) \? f\.label : f\.label\.replace\(" \(OpenStreetMap\)", ""\)/);
});
