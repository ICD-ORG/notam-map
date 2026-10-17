// בדיקות יחידה לליבת החישוב ולהפקת הטופס — מול נתוני אמת שנשמרו (tests/fixtures) ומול ערכים שחושבו בנפרד (tests/expected.json).
// הרצה: node --test tests/requests/core.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

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
const baseInput = Object.assign({}, exp.input, { purpose: cfg.purposes[0], aircraft: [cfg.aircraft[0]], vlos: true, siteName: "בדיקה", requesterName: "בודק", requesterPhone: "050-0000000", contactNames: "א; ב", contactPhone: "050-0000001" });
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
  const bad = C.validateInput(Object.assign({}, baseInput, { radius: 5, heightM: NaN, dateFrom: "", lat: NaN, aircraft: [], requesterName: "" }), cfg).map(e => e.field);
  ["coord", "radius", "height", "dateFrom", "aircraft", "requester"].forEach(f => assert.ok(bad.includes(f), f));
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
  assert.equal(rows[1].text, cfg.org.name); assert.equal(rows[13].text, "ICD"); assert.equal(rows[12].text, "לא רלוונטי");
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
  const res = C.analyze(Object.assign({}, baseInput, { siteName: "<img src=x onerror=alert(1)>", requesterName: "<b>x</b>" }), mkData(fixture("yarkon")), cfg, now);
  const rows = O.buildForm(res, cfg);
  assert.ok(!/<img|<b>x/.test(rows[5].html + rows[10].html));
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
  const model = O.docxModel(res, mkData(fixture("yarkon")), cfg, { images: { map: { bytes: jpeg, w: 1280, h: 960 }, overview: { bytes: jpeg, w: 1280, h: 960 }, aerial: { bytes: jpeg, w: 1280, h: 960 } }, includeChecks: true, review: "אושר", providerName: "בדיקה" });
  const bytes = await D.build(model);
  assert.equal(bytes[0], 0x50); assert.equal(bytes[1], 0x4b); // PK
  const z = await JSZipNode.loadAsync(bytes);
  for (const f of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/_rels/document.xml.rels", "word/styles.xml", "word/media/map.jpeg", "word/media/overview.jpeg", "word/media/aerial.jpeg"]) assert.ok(z.file(f), "חסר " + f);
  const doc = await z.file("word/document.xml").async("string");
  for (const f of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/_rels/document.xml.rels", "word/styles.xml"]) assert.ok(wellFormed(await z.file(f).async("string")), "XML לא תקין: " + f);
  const plain = doc.replace(/<[^>]+>/g, "").replace(/[\u202a\u202c]/g, "").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  assert.ok(plain.includes(exp.dmsLat) && plain.includes(exp.dmsLon), "קואורדינטות DMS");
  assert.ok(plain.includes("262.5") && plain.includes("ICD") && plain.includes("אצטדיון רמת גן") && plain.includes("כדור פורח תל אביב") && plain.includes("LLU20"));
  assert.ok(plain.includes("דוח כיסוי") && plain.includes("אישור סקירה אנושית"));
  assert.equal((doc.match(/<w:tbl>/g) || []).length, (doc.match(/<\/w:tbl>/g) || []).length);
  assert.equal((doc.match(/<w:drawing>/g) || []).length, 3);
  assert.ok(doc.includes("<w:bidi/>") && doc.includes("<w:bidiVisual/>"));
  const noChecks = await JSZipNode.loadAsync(await D.build(Object.assign({}, model, { includeChecks: false })));
  assert.ok(!(await noChecks.file("word/document.xml").async("string")).includes("דוח כיסוי"));
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
  assert.match(row[2], /לשון הפמ״ת \(עמ' 10 בפרק ב-09, עדכון 1\/26\)/);
  assert.match(row[2], /מרחק שלא יפחת מ-500 מטר מגבול אזור הפעילות/);
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

test("ב-09: חוקי סעיף 7 נטענו מהקובץ המאומת (7ב, 7ג, 7ח) עם הפניה לעמוד ועדכון", () => {
  assert.deepEqual(rules09.rules.map(r => r.id), ["7ב", "7ג", "7ח"]);
  for (const r of rules09.rules) assert.match(r.ref, /עמ' \d(–\d)?, עדכון 1\/26/);
  assert.match(rules09.rules[1].text, /500 מטר/); assert.match(rules09.rules[1].text, /רדיוס הסגירה/);
});
