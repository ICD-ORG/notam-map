/* נתיב (קו) כאזור פעילות — פלטים: שדה 8 בטופס, דף הבדיקות, KML, מייל, מודל ה-Word, בדיקה חוזרת ודיווח לגורמים נוספים. המעגל נשמר בייט-בבייט (golden.test.mjs) — כאן רק הנתיב. */
import test from "node:test"; import assert from "node:assert/strict"; import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url"; import { createRequire } from "node:module"; import { spawnSync } from "node:child_process";
const require = createRequire(import.meta.url), ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REQ = "members-k38p/requests/";
const C = require(path.join(ROOT, REQ, "js/core.js")), O = require(path.join(ROOT, REQ, "js/output.js")), D = require(path.join(ROOT, REQ, "js/docx.js")), PP = require(path.join(ROOT, REQ, "js/parties.js")), JSZip = require(path.join(ROOT, REQ, "vendor/jszip.min.js"));
const J = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const cfg = J(REQ + "config.json"), exp = J(REQ + "selftest/expected.json");
const zones = J("members-k38p/data/zones.json"); zones.rules09 = J("members-k38p/data/pmt-b09-rules.json");
const inpa = J("members-k38p/data/inpa-zones.json"), agri = J("members-k38p/data/agri-airstrips.json"), snap = J(REQ + "selftest/notam-data.snap.json");
const fixture = n => ({ near: J(`${REQ}selftest/${n}/near.json`), far: J(`${REQ}selftest/${n}/far.json`), ext: J(`${REQ}selftest/${n}/ext.json`), reverse: J(`${REQ}selftest/${n}/reverse.json`) });
const mkData = fx => Object.assign({ zones, inpa, agri, notams: snap.notams, notamFetchedIso: snap.fetched_iso }, fx);
const baseInput = Object.assign({}, exp.input, { purpose: cfg.purposes[0], aircraft: [cfg.aircraft[0]], vlos: true, siteName: "בדיקה", requesterName: "בודק", requesterPhone: "050-0000000", requesterOrg: "חברת הבדיקה בע״מ", contacts: [{ name: "א", phone: "050-0000001" }, { name: "ב", phone: "050-0000002" }] });
const now = new Date(exp.now);
const xmllint = xml => { const r = spawnSync("xmllint", ["--noout", "-"], { input: xml, encoding: "utf8" }); return r.error ? null : r.status === 0 ? "" : String(r.stderr).slice(0, 300); };   // "" תקין, הודעה לא תקין, null לא מותקן
function wellFormed(xml) { const st = []; for (const m of xml.matchAll(/<(\/?)([A-Za-z0-9:_.-]+)([^>]*?)(\/?)>/g)) { if (m[0].startsWith("<?") || m[0].startsWith("<!") || m[4] === "/") continue; if (m[1] === "/") { if (st.pop() !== m[2]) return false; } else st.push(m[2]); } return st.length === 0; }

// בונה ניתוח של נתיב בדיוק כמו הממשק: inp.area = {kind, pts (6 ספרות), halfWidth}; inp.lat/lon = עוגן הנתיב; בלי inp.radius
function routeRes(pts, W, fx, over) {
  const a = { kind: "route", pts: C.roundPts(pts), halfWidth: W }, inp = Object.assign({}, baseInput, over || {}, { area: a, lat: C.routeInfo(a.pts).anchor[0], lon: C.routeInfo(a.pts).anchor[1] });
  delete inp.radius;
  const data = mkData(fixture(fx || "yarkon"));
  return { res: C.analyze(inp, data, cfg, now), data, inp };
}
const PTS = [[32.0985, 34.8120], [32.0991, 34.8166], [32.1002, 34.8200], [32.1030, 34.8215]];
const R1 = routeRes(PTS, 150), res = R1.res, data = R1.data;
const f8 = () => O.buildForm(res, cfg)[7];
const dmsPt = q => C.dmsLat(q[0]) + " " + C.dmsLon(q[1]);

test("שדה 8 בנתיב: סדר הבלוקים, תוויות P ו-V, אורך ורוחב, ופינות הפוליגון זהות לטבעת (corridorRing)", () => {
  assert.equal(res.area.kind, "route"); assert.equal(res.inp.radius, undefined);
  const rows = O.buildForm(res, cfg), t = rows[7].text, L = t.split("\n"), ring = C.corridorRing(res.area, 1).ring, corners = ring.slice(0, -1);
  assert.equal(rows[7].label, "סגירה/הגבלה", "תווית הטופס הרשמית נשמרת");
  assert.equal(L[0], "נתיב — 4 נקודות, לפי סדר הטיסה:");
  PTS.forEach((q, i) => { const p = res.area.pts[i]; assert.equal(L[1 + i], `P${i + 1}. ${dmsPt(p)} (עשרוני: ${p[0]}, ${p[1]})`); });
  const km = (res.area.lengthM / 1000).toFixed(2);
  assert.equal(L[5], `אורך הנתיב: ${km} ק״מ (${C.fmtInt(Math.round(res.area.lengthM))} מ׳) · רוחב הסגירה מכל צד של הציר: 150 מ׳ (רוחב כולל 300 מ׳)`);
  assert.equal(L[6], `פינות פוליגון הסגירה (${corners.length} פינות, לפי סדר ההקפה):`);
  corners.forEach((q, i) => assert.equal(L[7 + i], `V${i + 1}. ${dmsPt(q)}`, "פינה " + (i + 1) + " לפי הטבעת, DMS בלבד"));
  assert.equal(corners.length, 8, "נתיב מתון של 4 נקודות: 2N פינות");
  const expl = L[7 + corners.length];
  assert.match(expl, /^הפוליגון נבנה במקביל לציר הנתיב במרחק 150 מ׳ מכל צד; בפנייה חדה הפינה החיצונית נחתכת במרחק 300 מ׳ מהקודקוד, וקצות הנתיב מורחבים ב-150 מ׳\. הפוליגון מכיל את כל אזור הסגירה/);
  const tail = L.slice(8 + corners.length).join("\n");
  assert.match(tail, /^תשתית אווירית מושפעת: בקרבת האזור: LLU20 .* — במרחק 210 מ׳ מהציר \(60 מ׳ מקצה הסגירה המבוקשת\)/, "הקו שאחרי ההסבר: תשתית אווירית, ב״מהציר״");
  assert.ok(tail.includes("מכשולים ותשתיות בתוך האזור (עד 150 מ׳ מכל צד של הציר):\n1. "), "פריטים ממוספרים 1..n אחרי הפינות (התוויות P/V שמורות לנקודות ולפינות)");
  assert.ok(tail.includes("בקרבת האזור (עד 300 מ׳ מציר הנתיב):") || !res.nearScan.ring.length, "טבעת 2W");
  assert.ok(tail.includes("אתרים ותשתיות נוספים בקרבת האזור (עד " + C.fmtDist(150 + cfg.thresholds.site_near_m) + " מציר הנתיב):"));
  // סדר: נקודות < אורך < פינות < הסבר < פריטים
  const at = s => t.indexOf(s); assert.ok(at("P1.") < at("P4.") && at("P4.") < at("אורך הנתיב") && at("אורך הנתיב") < at("פינות פוליגון") && at("V1.") < at("V8.") && at("V8.") < at("הפוליגון נבנה") && at("הפוליגון נבנה") < at("מכשולים ותשתיות"));
  assert.ok(!/^V\d+\. .*\(עשרוני/m.test(t), "בפינות רק DMS (העשרוני בקובץ ה-KML)");
});

test("שדה 8 ושדה 9 בנתיב: לא רלוונטי (פוליגון), רוחב מכל צד, ובלי מעגל / נ.צ. מרכזי", () => {
  const rows = O.buildForm(res, cfg);
  assert.equal(rows[8].label, "רדיוס הסגירה (אם רלוונטי)", "תווית הטופס הרשמית נשמרת");
  assert.equal(rows[8].text, "לא רלוונטי — הסגירה היא פוליגון לאורך נתיב (פינותיו בשדה 8)\nרוחב מכל צד של הציר: 150 מטר (= 0.15 ק״מ = 0.081 מייל ימי)");
  assert.ok(!/מעגל|נ\.צ\. מרכזי|מהנקודה/.test(rows[7].text));
  // בקשת מעגל: שדה 8 ושדה 9 כמו תמיד (golden מוודא בייט-בבייט; כאן הנוסח)
  const c = C.analyze(baseInput, data, cfg, now), cr = O.buildForm(c, cfg);
  assert.ok(cr[7].text.startsWith("מעגל — נ.צ. מרכזי:")); assert.ok(cr[8].text.startsWith("200 מטר"));
});

test("שדה 8 בנתיב של 20 נקודות: כל הנקודות והפינות (עד 58), בלי חיתוך; ובנתיב מנוון (היפוך מלא בכל נקודה) התקרה 60 שורות עם הפניה ל-KML", () => {
  const ll = (x, y) => [32.0991 + y / 111133, 34.8166 + x / 94400];
  const pts = Array.from({ length: 20 }, (_, i) => ll(i * 200, 90 * Math.sin(i / 2)));
  assert.deepEqual(C.validateRoute({ area: { kind: "route", pts: C.roundPts(pts), halfWidth: 50 } }, cfg), [], "נתיב מתעקל של 20 נקודות תקין");
  const r20 = routeRes(pts, 50).res, L = O.buildForm(r20, cfg)[7].text.split("\n"), M = C.corridorRing(r20.area, 1).ring.length - 1;
  assert.equal(L.filter(l => /^P\d+\. /.test(l)).length, 20); assert.equal(L[0], "נתיב — 20 נקודות, לפי סדר הטיסה:");
  assert.equal(L.filter(l => /^V\d+\. /.test(l)).length, M); assert.ok(M >= 40 && M <= 58, "2N עד 3N-2 פינות: " + M);
  assert.ok(!L.some(l => /^ועוד \d+ פינות/.test(l)), "אין חיתוך כשיש עד 58 פינות");
  // הגנה לעומק: היפוך כיוון מלא בכל נקודה נותן 4 פינות לכל קודקוד (76) — הרשימה נחתכת ב-60 ומפנה ל-KML (בנתיב תקין התקרה אינה מושגת)
  const zz = Array.from({ length: 20 }, (_, i) => ll((i % 2) * 100, 0)), rz = routeRes(zz, 20).res;
  const Lz = O.buildForm(rz, cfg)[7].text.split("\n"), Mz = C.corridorRing(rz.area, 1).ring.length - 1;
  assert.ok(Mz > 60, "תנאי הבדיקה: " + Mz);
  assert.equal(Lz.filter(l => /^V\d+\. /.test(l)).length, 60); assert.equal(Lz.find(l => /^ועוד \d+ פינות/.test(l)), `ועוד ${Mz - 60} פינות (הרשימה המלאה בקובץ ה-KML המצורף)`);
  assert.ok(Lz.find(l => /^פינות פוליגון הסגירה/.test(l)).includes(`(${Mz} פינות`), "הכותרת מציינת את המספר המלא");
});

// מסיר ציטוטי פמ״ת/חוקים כלשונם (״…״ כפי שנכתבו בנתוני האזורים והכללים): בהם מותר ״רדיוס״ וכד׳. מה שנשאר חייב להיות נוסח נתיב בלבד
function stripQuotes(s, extra) {
  const cand = new Set(extra || []);
  (function walk(v) { if (typeof v === "string") { if (v.length > 15) cand.add(v); } else if (v && typeof v === "object") Object.values(v).forEach(walk); })([zones.rules09, zones.general, zones.zones.map(z => z.pmt)]);
  for (const t of cand) {
    const x = String(t).trim().replace(/^"/, "").replace(/"$/, ""), forms = [x, "¹ " + x.replace(/^1\s*/, "")];
    for (const f of forms) { const q = "״" + C.esc(f) + "״"; if (s.includes(q)) s = s.split(q).join(""); }
  }
  return s;
}
const FORBID = /מעגל|רדיוס|נקודת מרכז|נ\.צ\. מרכזי|נקודת ההטסה|מהנקודה|הנקודה/;
const leaks = (name, s) => { const m = String(s).match(new RegExp(".{0,40}(" + FORBID.source + ").{0,40}", "g")); assert.equal(m, null, name + ": נוסח מעגל בפלט נתיב — " + (m || []).join(" | ")); };

test("אין נוסח מעגל בפלטי הנתיב (טופס, בדיקות, כיסוי, KML, מייל, מודל Word, בדיקה חוזרת) — חוץ מציטוטי הפמ״ת ותוויות הטופס הרשמיות", () => {
  const scenarios = [
    ["ירקון", R1],
    ["חדירה לאזור אסור", routeRes([[32.0985, 34.8120], [32.0998, 34.8100]], 100)],
    ["מטולה (גבול)", routeRes([[33.2755, 35.5740], [33.2830, 35.5820]], 120, "metula")],
    ["מנחת חקלאי", routeRes([[32.5355, 35.4300], [32.5358, 35.4350]], 100)]
  ];
  let sawInside = false, sawBorder = false, sawAgri = false;
  for (const [name, s] of scenarios) {
    const { res: r, data: d } = s, form = O.buildForm(r, cfg), checks = O.buildChecks(r, d, cfg);
    sawInside = sawInside || r.zones.inside.length > 0; sawBorder = sawBorder || r.borders.length > 0; sawAgri = sawAgri || r.agri.some(a => a.d - r.R <= cfg.thresholds.agri_near_m);
    leaks(name + " טופס (טקסט השדות)", form.map(x => x.text).join("\n"));
    leaks(name + " טופס (תוויות רשמיות לא נספרות; ערכים בלבד)", form.map(x => x.html).join("\n"));
    // שורת הנוטמים נושאת טקסט נוטם כלשונו (ייתכן ״ברדיוס 500 מטר״): נבדקות רק הכותרת והמקור שלה
    leaks(name + " בדיקות", stripQuotes(checks.map(x => (/^סגירות אוויריות בנוטמים/.test(x[0]) ? x.slice(0, 2) : x).join(" | ")).join("\n"), r.b09Footnote ? [r.b09Footnote.text] : []));
    leaks(name + " כיסוי", JSON.stringify(O.buildCoverage(r, d, cfg)));
    leaks(name + " אזהרות", O.airInfraLines(r, d, cfg).join("\n"));
    leaks(name + " KML", O.kml(r, d, cfg));
    leaks(name + " מייל", O.mail(r, cfg).body);
    const m = O.docxModel(r, d, cfg, { includeChecks: true });
    leaks(name + " מודל Word", JSON.stringify(Object.assign({}, m, { rows: m.rows.map(x => ({ n: x.n, html: x.html })), checks: m.checks.map(x => stripQuotes((/^סגירות אוויריות בנוטמים/.test(x[0]) ? x.slice(0, 2) : x).join(" | "), [])) })));
    const rc = O.recheckDocxModel(r, d, cfg, { banner: { text: "בדיקה חוזרת" }, dates: [{ label: "מועד", value: "20.10.2026" }], sections: [{ title: "מכשולים", total: 1, rows: [{ statusLabel: "חדש", title: "t", dist: "10 מ׳" }] }] }, { now });
    leaks(name + " בדיקה חוזרת (זהות וכותרות)", JSON.stringify([rc.recheck.identity, rc.recheck.sections.map(x => x.head), rc.pointHeading, rc.itemsDistHead, rc.checkPoint]));
  }
  assert.ok(sawInside, "תרחיש חדירה לאזור אסור באמת חופף"); assert.ok(sawBorder, "תרחיש גבול באמת בטווח"); assert.ok(sawAgri, "תרחיש מנחת חקלאי באמת בקרבה");
});

test("נוסח נתיב בשורות המרחק: ״מהציר״ באזהרות הקרבה (אזור, גבול, מנחת) ו״חפיפה״ כשהנתיב חודר לאזור", () => {
  const inside = routeRes([[32.0985, 34.8120], [32.0998, 34.8100]], 100), air = O.airInfraLines(inside.res, inside.data, cfg);
  assert.ok(inside.res.zones.inside.some(z => z.id === "LLU20")); assert.ok(air.some(l => /^חופף לאזור LLU20/.test(l)), air.join("\n"));
  assert.ok(O.airInfraLines(res, data, cfg).some(l => / במרחק 210 מ׳ מהציר \(60 מ׳ מקצה הסגירה המבוקשת\) — /.test(l)));
  const ck = O.buildChecks(inside.res, inside.data, cfg), a17 = O.toText(ck[0][2]);
  assert.match(a17, /חפיפה לסגירה המבוקשת: LLU20 /); assert.ok(!/מהנקודה/.test(a17));
  const near = O.toText(O.buildChecks(res, data, cfg)[0][2]);
  assert.ok(near.includes("בקרבת הסגירה: LLU20") && near.includes("— 210 מ׳ מהציר — ״"), near);
  assert.ok(near.includes("טווח הבדיקה: חפיפה — בתוך הסגירה (150 מ׳ מכל צד של הציר); בקרבה — עד 1.1 ק״מ מציר הנתיב; אזור שנשרטט בקירוב — עד 1.9 ק״מ."), near);
  const scan = O.toText(O.buildChecks(res, data, cfg).find(r => /^סריקת סביבה/.test(r[0]))[2]);
  assert.ok(scan.includes("בתוך 150 מ׳ מכל צד של הציר:") && scan.includes("בקרבת האזור (עד 300 מ׳ מציר הנתיב):") && scan.includes("(מכשולים — עד 300 מ׳ מציר הנתיב: מגדלים"), scan);
  const ap = O.buildChecks(res, data, cfg).find(r => /^שדות תעופה ומנחתים בסביבה/.test(r[0])); assert.ok(ap[0].endsWith("מציר הנתיב)"), ap[0]);
  const resp = O.buildChecks(res, data, cfg).find(r => /^אחריות המבקש/.test(r[0])); assert.ok(O.toText(resp[2]).includes("אם הרוחב והגובה שנבחרו"));
});

test("KML של נתיב: תקין (xmllint), ציר LineString, פוליגון ירוק = corridorRing(1), טבעת כתומה = corridorRing(2) עם חור הפוך, ונקודות P1..PN; קו מרחק מהציר", () => {
  const k = O.kml(res, data, cfg), lint = xmllint(k); if (lint !== null) assert.equal(lint, "", "xmllint: " + lint);
  assert.ok(wellFormed(k));
  const pm = k.split("<Placemark>").slice(1).map(x => x.split("</Placemark>")[0]), name = x => (x.match(/<name>([^<]*)<\/name>/) || [])[1];
  const parse = s => s.trim().split(/\s+/).map(c => c.split(",").map(Number)), toLL = ring => ring.map(q => [q[1], q[0], 0]);
  assert.ok(!k.includes("נקודת ההטסה") && !k.includes("רדיוס") && !k.includes("מעגל"));
  assert.equal((k.match(/<Style id="route">/g) || []).length, 1); assert.ok(k.indexOf('<Style id="route">') < k.indexOf("<Placemark>"), "הסגנון לפני ה-Placemark הראשון");
  // כל styleUrl מפנה לסגנון מוגדר
  const ids = new Set([...k.matchAll(/<Style id="([^"]+)"/g)].map(m => m[1])); [...k.matchAll(/<styleUrl>#([^<]+)</g)].forEach(m => assert.ok(ids.has(m[1]), "סגנון חסר: " + m[1]));
  // ציר
  const axis = pm.filter(x => /<styleUrl>#route<\/styleUrl>/.test(x)); assert.equal(axis.length, 1);
  assert.deepEqual(parse(axis[0].match(/<LineString><tessellate>1<\/tessellate><coordinates>([^<]*)</)[1]), res.area.pts.map(q => [q[1], q[0], 0]));
  assert.ok(/^ציר הנתיב — 4 נקודות · 1\.12 ק״מ$/.test(name(axis[0])));
  // פוליגונים
  const g1 = C.corridorRing(res.area, 1).ring, g2 = C.corridorRing(res.area, 2).ring;
  const green = pm.filter(x => /<styleUrl>#green<\/styleUrl>/.test(x)), orange = pm.filter(x => /<styleUrl>#orange<\/styleUrl>/.test(x)); assert.equal(green.length, 1); assert.equal(orange.length, 1);
  assert.equal(name(green[0]), "אזור ההטסה — נתיב, 150 מ׳ מכל צד של הציר (אורך 1.12 ק״מ)"); assert.equal(name(orange[0]), "150 מ׳ נוספים (עד 300 מ׳ מהציר)");
  assert.deepEqual(parse(green[0].match(/<outerBoundaryIs><LinearRing><coordinates>([^<]*)</)[1]), toLL(g1), "ירוק = הפוליגון המודפס (אותן פינות כמו ב-V1..VM)");
  assert.deepEqual(parse(orange[0].match(/<outerBoundaryIs><LinearRing><coordinates>([^<]*)</)[1]), toLL(g2));
  assert.deepEqual(parse(orange[0].match(/<innerBoundaryIs><LinearRing><coordinates>([^<]*)</)[1]), toLL(g1.slice().reverse()), "חור הטבעת = הפוליגון הירוק בכיוון הפוך");
  assert.ok(!/<innerBoundaryIs>/.test(green[0]));
  // נקודות
  const wp = pm.filter(x => /^P\d+$/.test(name(x))); assert.deepEqual(wp.map(name), ["P1", "P2", "P3", "P4"]);
  wp.forEach((x, i) => { const p = res.area.pts[i]; assert.deepEqual(parse(x.match(/<Point><coordinates>([^<]*)</)[1]), [[p[1], p[0], 0]]); assert.ok(x.includes(C.esc(dmsPt(p))), "תיאור: DMS"); });
  assert.match(wp[0], /נקודה 1 מתוך 4 \(התחלה\)/); assert.match(wp[3], /נקודה 4 מתוך 4 \(סיום\)/); assert.match(wp[1], /נקודה 2 מתוך 4 ·/);
  // קו מרחק: מהנקודה הקרובה על הציר (לא מהעוגן) אל האזור
  const dist = pm.find(x => /מ׳ עד LLU20/.test(name(x))); assert.ok(dist, "קו מרחק לאזור LLU20");
  const [a, b] = parse(dist.match(/<coordinates>([^<]*)</)[1]), P = res.P, ax = P.xy(a[1], a[0]), bx = P.xy(b[1], b[0]);
  assert.ok(C.routeNearest(P.route, ax[0], ax[1]).d < 0.01, "ראשית הקו על הציר");
  assert.ok(Math.abs(Math.hypot(ax[0] - bx[0], ax[1] - bx[1]) - res.zones.near[0].d) < 1, "אורך הקו = המרחק מהציר: " + Math.hypot(ax[0] - bx[0], ax[1] - bx[1]));
  assert.equal(parse(dist.match(/<coordinates>([^<]*)</)[1]).length, 2);
});

test("KML של מעגל נשאר בלי ציר, נקודות P וסגנון route (המעגל עצמו — golden.test.mjs)", () => {
  const c = C.analyze(baseInput, data, cfg, now), k = O.kml(c, data, cfg);
  assert.ok(!k.includes('id="route"') && !/<name>P\d+<\/name>/.test(k) && !k.includes("ציר הנתיב"));
  assert.ok(k.includes("<name>נקודת ההטסה (מרכז)</name>") && k.includes("אזור ההטסה — רדיוס 200 מ׳"));
});

test("מייל של נתיב: נקודה אחת בלבד לסגירה (אורך, מספר נקודות, רוחב), בלי מעגל; מעגל כמות שהוא", () => {
  const m = O.mail(res, cfg), bullets = m.body.split("\n").filter(l => l.startsWith("• "));
  assert.equal(bullets.length, 4, "גורם, מיקום, מועד, סגירה — כמו במעגל");
  assert.equal(bullets[3], "• סגירה: נתיב באורך 1.1 ק״מ (4 נקודות), רוחב 150 מטר מכל צד של הציר · גובה 262.5 רגל (80 מטר) מעפ״ש (AGL)");
  assert.ok(!/מעגל|רדיוס/.test(m.body)); assert.equal(decodeURIComponent(m.mailto.split("&body=")[1]), m.body);
  const short = routeRes([[32.0985, 34.8120], [32.0985, 34.8166]], 50).res;   // ~430 מ׳: במטרים
  assert.match(O.mail(short, cfg).body, /• סגירה: נתיב באורך 4\d\d מ׳ \(2 נקודות\), רוחב 50 מטר מכל צד של הציר · גובה 262\.5 רגל/);
  assert.ok(O.mail(C.analyze(baseInput, data, cfg, now), cfg).body.includes("• סגירה: מעגל ברדיוס 200 מטר · גובה 262.5 רגל (80 מטר) מעפ״ש (AGL)"));
});

const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");
const img = { bytes: jpeg, w: 960, h: 1280 };
const plainOf = xml => xml.replace(/<[^>]+>/g, "").replace(new RegExp("[" + String.fromCharCode(0x202a, 0x202c, 0x200f) + "]", "g"), "").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&apos;/g, "'");

test("מודל Word של נתיב: כותרות ״הנתיב״ / ״מרחק מהציר״, מקרא עם קו לבן ו-P1–PN, נקודת התחלה וסיום; במעגל המפתחות האלה אינם במודל", async () => {
  const m = O.docxModel(res, data, cfg, { includeChecks: true, review: "אושר", images: { aerial: img, street: img, overview: img, region: img } }), circ = O.docxModel(C.analyze(baseInput, data, cfg, now), data, cfg, {});
  assert.equal(m.pointHeading, "הנתיב"); assert.equal(m.itemsDistHead, "מרחק מהציר");
  assert.ok(!("pointHeading" in circ) && !("itemsDistHead" in circ), "במעגל המודל זהה לקודם (טביעת האצבע PB_GOLD ב-core.test.mjs)");
  assert.equal(Object.keys(m).length, Object.keys(circ).length + 2);
  assert.ok(m.mapNote.startsWith("ירוק: אזור הסגירה (נתיב, 150 מ׳ מכל צד של הציר) · כתום: עד 300 מ׳ מהציר · לבן: ציר הנתיב ונקודותיו P1–P4 (לפי הסדר) · אדום: אזור אסור/מוגבל (פמ״ת א-17)"), m.mapNote);
  assert.ok(m.mapNote.endsWith(circ.mapNote.slice(circ.mapNote.indexOf(" · אדום:"))), "שאר המקרא זהה למעגל");
  assert.equal(m.checkPoint, `נתיב: 4 נקודות · אורך ${(res.area.lengthM / 1000).toFixed(2)} ק״מ · התחלה (P1) ${dmsPt(res.area.pts[0])} · סוף (P4) ${dmsPt(res.area.pts[3])} · ירוק: 150 מ׳ מכל צד של הציר · כתום: עד 300 מ׳ מהציר · גובה 80 מ׳ (262.5 רגל)`);
  assert.equal(m.rows[7].html, f8().html, "שדה 8 במודל = שדה 8 בטופס");
  // Word: XML תקין, הכותרות החדשות, שורות P/V, ואין ״הנקודה״ / ״מרחק מהנקודה״
  const z = await JSZip.loadAsync(await D.build(m)), xml = await z.file("word/document.xml").async("string"), plain = plainOf(xml);
  assert.ok(wellFormed(xml)); const lint = xmllint(xml); if (lint !== null) assert.equal(lint, "", "xmllint: " + lint);
  assert.equal((xml.match(/<w:tbl>/g) || []).length, (xml.match(/<\/w:tbl>/g) || []).length); assert.equal((xml.match(/<w:drawing>/g) || []).length, 4);
  assert.ok(xml.includes("<w:bidi/>") && xml.includes("<w:bidiVisual/>"));
  for (const f of ["[Content_Types].xml", "_rels/.rels", "word/_rels/document.xml.rels", "word/styles.xml"]) assert.ok(wellFormed(await z.file(f).async("string")), f);
  const paras = xml.split("</w:p>").map(plainOf).map(x => x.trim());
  assert.ok(paras.includes("1. הנתיב"), "כותרת הסעיף הראשון בדף הבדיקות"); assert.ok(!paras.includes("1. הנקודה"), "אין סעיף ״הנקודה״");
  assert.ok(paras.includes("מרחק מהציר") && !paras.includes("מרחק מהנקודה"), "כותרת עמודת המרחק בטבלת הפריטים");
  const norm = x => x.replace(/\s+/g, " ");
  for (const s of ["P1. " + dmsPt(res.area.pts[0]), "P4. " + dmsPt(res.area.pts[3]), "V1. " + dmsPt(C.corridorRing(res.area, 1).ring[0]), "נתיב — 4 נקודות, לפי סדר הטיסה:", "פינות פוליגון הסגירה (8 פינות, לפי סדר ההקפה):"]) {
    assert.ok(norm(plain).includes(norm(s)), "חסר ב-Word: " + s);
  }
  assert.ok(plain.includes("התחלה (P1)") && plain.includes("סוף (P4)"));
  // מעגל: הכותרות הרגילות
  const cz = await JSZip.loadAsync(await D.build(Object.assign({}, circ, { includeChecks: true, images: { aerial: img } }))), cparas = (await cz.file("word/document.xml").async("string")).split("</w:p>").map(plainOf).map(x => x.trim());
  assert.ok(cparas.includes("1. הנקודה") && !cparas.includes("1. הנתיב"), "מעגל: ״הנקודה״"); assert.ok(cparas.includes("מרחק מהנקודה") && !cparas.includes("מרחק מהציר"));
});

test("בדיקה חוזרת של נתיב: שורות זהות (נתיב; רוחב וגובה), כותרת ״מרחק מהציר״ ו״הנתיב״ גם בדף הבדיקות העדכני; Word תקין", async () => {
  const since = { banner: { text: "בדיקה חוזרת — לא צורף לבקשה" }, title: "שינויים מאז ההגשה", summary: "s", dates: [{ label: "נשלחה", value: "18.10.2026" }], sections: [{ title: "מכשולים", total: 1, rows: [{ statusLabel: "חדש", sevLabel: "", sev: "", id: "node/1", title: "תורן", lines: ["l"], dist: "10 מ׳" }] }] };
  const m = O.recheckDocxModel(res, data, cfg, since, { now });
  assert.deepEqual(m.recheck.identity.map(r => r[0]), ["הבקשה", "נתיב", "רוחב מכל צד וגובה", "נשלחה"]);
  assert.equal(m.recheck.identity[1][1], `4 נקודות · אורך ${(res.area.lengthM / 1000).toFixed(2)} ק״מ · P1 ${dmsPt(res.area.pts[0])} · P4 ${dmsPt(res.area.pts[3])}`);
  assert.equal(m.recheck.identity[2][1], "150 מ׳ מכל צד של הציר · גובה 80 מ׳ (262.5 רגל)");
  assert.deepEqual(m.recheck.sections[0].head, ["סטטוס", "פריט", "פירוט", "מרחק מהציר"]);
  assert.equal(m.pointHeading, "הנתיב"); assert.equal(m.itemsDistHead, "מרחק מהציר"); assert.equal(m.checkPoint, O.docxModel(res, data, cfg, {}).checkPoint);
  const z = await JSZip.loadAsync(await D.buildRecheck(m)), xml = await z.file("word/document.xml").async("string"), plain = plainOf(xml);
  assert.ok(wellFormed(xml)); const lint = xmllint(xml); if (lint !== null) assert.equal(lint, "", "xmllint: " + lint);
  assert.ok(plain.includes("מרחק מהציר") && !plain.includes("מרחק מהנקודה") && plain.includes("רוחב מכל צד וגובה") && !plain.includes("נקודת מרכז"));
  // מעגל: כמו תמיד (recheck.test.mjs / core.test.mjs מוודאים את הנוסח)
  const c = O.recheckDocxModel(C.analyze(baseInput, data, cfg, now), data, cfg, since, { now });
  assert.deepEqual(c.recheck.identity.map(r => r[0]), ["הבקשה", "נקודת מרכז", "רדיוס וגובה", "נשלחה"]); assert.ok(!("pointHeading" in c)); assert.deepEqual(c.recheck.sections[0].head, ["סטטוס", "פריט", "פירוט", "מרחק מהנקודה"]);
});

test("דיווח לגורמים נוספים: תגית המרחק של אתרי OSM בנתיב היא ״מהציר״ (במעגל ״מהנקודה״)", () => {
  const circ = C.analyze(baseInput, data, cfg, now);
  const tagsOf = r => PP.build(r, cfg, data).filter(x => x.src === "osm").map(x => x.tag);
  const rt = tagsOf(res), ct = tagsOf(circ);
  assert.ok(ct.length > 0 && ct.every(t => / מהנקודה$/.test(t)), JSON.stringify(ct));
  assert.ok(rt.length > 0 && rt.every(t => / מהציר$/.test(t)), JSON.stringify(rt));
  assert.ok(!PP.build(res, cfg, data).some(x => /מהנקודה/.test(x.tag)), "אין ״מהנקודה״ באף שורה");
});

test("נתיב: summaryModel, גבולות ופריטים — מרחק מהציר בלבד (res.R = W) ופריט שעל הציר נקרא ״בתוך השטח״", () => {
  const s = O.summaryModel(res, cfg); assert.ok(s.lines[0].startsWith("<b>נמצאו בסריקה:</b>")); assert.ok(!/מעגל|נקודה/.test(s.lines.join(" ")));
  const first = res.nearScan.items[0]; assert.equal(first.d, 0); assert.equal(O.itemText(first), first.n + ". " + first.title + " — בתוך השטח");
  assert.equal(O.isRoute(res), true); assert.equal(O.isRoute(C.analyze(baseInput, data, cfg, now)), false);
});
