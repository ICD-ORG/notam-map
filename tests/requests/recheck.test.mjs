// בדיקות יחידה ל"בדיקה חוזרת": תמונת מצב, השוואה (נכשל סגור), אימות ושחזור בקשה שמורה (קלט עוין), מודלים ו-HTML מוגן, ומחרוזות העדכון.
// הרצה: node --test tests/requests/recheck.test.mjs   (נתוני אמת: members-k38p/requests/selftest/*)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const C = require(path.join(ROOT, "members-k38p/requests/js/core.js"));
const O = require(path.join(ROOT, "members-k38p/requests/js/output.js"));
const RC = require(path.join(ROOT, "members-k38p/requests/js/recheck.js"));
const J = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const cfg = J("members-k38p/requests/config.json"), exp = J("members-k38p/requests/selftest/expected.json");
const zones = J("members-k38p/data/zones.json"), rules09 = J("members-k38p/data/pmt-b09-rules.json"), inpa = J("members-k38p/data/inpa-zones.json"), agri = J("members-k38p/data/agri-airstrips.json");
zones.rules09 = rules09;
const snap = J("members-k38p/requests/selftest/notam-data.snap.json");
const fixture = n => ({ near: J(`members-k38p/requests/selftest/${n}/near.json`), far: J(`members-k38p/requests/selftest/${n}/far.json`), ext: J(`members-k38p/requests/selftest/${n}/ext.json`) });
const now = new Date(exp.now), t2 = new Date(+now + 7 * 86400000);
const clone = o => JSON.parse(JSON.stringify(o));
const P0 = { lat: exp.input.lat, lon: exp.input.lon };
const proj = new C.Proj(P0.lat, P0.lon);
const metaOf = n => J(`members-k38p/requests/selftest/${n}/meta.json`);   // נקודת המרכז של כל fixture (lat/lon שבהם נאספו נתוני ה-OSM)
const baseInput = (R = 200, name = "yarkon") => Object.assign({}, exp.input, { lat: metaOf(name).lat, lon: metaOf(name).lon, radius: R, purpose: cfg.purposes[0], aircraft: [cfg.aircraft[0]], vlos: true, siteName: "בדיקה", requesterName: "בודק", requesterPhone: "050-0000000", requesterOrg: "חברה", contacts: [{ name: "א", phone: "050-0000001" }, { name: "ב", phone: "050-0000002" }] });
const baseData = (name = "yarkon") => Object.assign({ zones, inpa, agri, notams: snap.notams, notamFetchedIso: snap.fetched_iso }, fixture(name));
// נתונים "טריים יותר" (אחרי ההגשה): כל מקורות הזמן מתקדמים. שינוי תוכן מתבצע בנפרד, בעותקים רדודים
const fresher = d => {
  const stamp = x => Object.assign({}, x, { osm3s: Object.assign({}, x.osm3s, { timestamp_osm_base: "2026-10-23T05:00:00Z" }) });
  return Object.assign({}, d, { notamFetchedIso: "2026-10-23T08:00:00Z", near: stamp(d.near), far: stamp(d.far), ext: stamp(d.ext) });
};
const analyze = (d, R = 200, at = now, name = "yarkon") => C.analyze(baseInput(R, name), d, cfg, at);
const snapOf = (d, R = 200, at = now, c = cfg, name = "yarkon") => RC.snapshotOf(C.analyze(baseInput(R, name), d, c, at), d, c, at);
// השוואה: ההגשה = נתוני הבסיס ברגע now; הבדיקה החוזרת = נתונים טריים (עם השינוי mut) שבוע אחרי
const scenario = (mut, { R = 200, name = "yarkon", cfg2 = cfg } = {}) => {
  const d1 = baseData(name), d2 = (mut || (x => x))(fresher(baseData(name)));
  const prev = snapOf(d1, R, now, cfg, name), cur = RC.snapshotOf(C.analyze(baseInput(R, name), d2, cfg2, t2), d2, cfg2, t2);
  return { prev, cur, diff: RC.diffSnapshots(prev, cur), d1, d2 };
};
const rowsOf = d => [].concat(d.notams.rows, d.zones.rows, d.items.rows, d.other.rows);
const withNotams = (extra, drop = []) => d => Object.assign({}, d, { notams: d.notams.filter(n => drop.indexOf(n.id) < 0).concat(extra) });
const mkNotam = (id, o = {}) => ({
  id, loc: "LLLL", name: "T " + id, heb: o.heb || "נוטם " + id,
  raw: `${id} NOTAM${o.type || "N"}${o.ref ? " " + o.ref : ""}\nQ) LLLL/QRDCA/IV/NBO/AW/${o.lo || "000"}/${o.up || "050"}/3205N03449E001\nA) LLLL B) ${o.from || "2610201400"} C) ${o.to || "2610302100"}\nE) ${o.text || "TEMPORARY DANGER AREA ACT."} WI ${o.radius || "1NM"} RADIUS CENTERED ON PSN ${o.pos || "320558N0344900E"}.)`
});
const tower = (id, dx, dy, tags = {}) => { const [la, lo] = proj.ll(dx, dy); return { type: "node", id, lat: la, lon: lo, tags: Object.assign({ man_made: "tower", "tower:type": "communication" }, tags) }; };
const withElements = (add, drop = () => false, edit = null) => d => Object.assign({}, d, { near: Object.assign({}, d.near, { elements: d.near.elements.filter(e => !drop(e)).map(e => (edit ? edit(e) || e : e)).concat(add) }) });
const square = (dx, dy, r) => [[-r, -r], [r, -r], [r, r], [-r, r], [-r, -r]].map(([x, y]) => proj.ll(dx + x, dy + y));
const mkZone = (id, o = {}) => Object.assign({ id, cat: "LLP", name: "אזור בדיקה", alt: "GND – 500 ft AMSL", rings: [square(0, 0, 150)] }, o);
const withZones = (fn) => d => Object.assign({}, d, { zones: Object.assign({}, d.zones, { zones: fn(d.zones.zones) }) });
const mutSnap = (s, fn) => { const c = clone(s); fn(c); return c; };

/* ==================== תמונת מצב ==================== */
test("תמונת מצב: דטרמיניסטית, לא משנה את הקלט, ו-at רק כשנמסר זמן", () => {
  const d = baseData(), res = analyze(d);
  const before = JSON.stringify([res.inp, res.zones.inside.map(z => z.id), d.notams.length]);
  const a = RC.snapshotOf(res, d, cfg), b = RC.snapshotOf(analyze(d), baseData(), cfg);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(JSON.stringify([res.inp, res.zones.inside.map(z => z.id), d.notams.length]), before, "אין שינוי בקלט");
  assert.equal(a.at, undefined, "בלי זמן — בלי at");
  assert.equal(RC.snapshotOf(res, d, cfg, now).at, now.toISOString());
  assert.equal(RC.snapshotOf(res, d, cfg, +now).at, now.toISOString(), "גם מספר (ms)");
  assert.equal(a.v, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a, "JSON טהור (הלוך-חזור)");
});

test("תמונת מצב: אינה תלויה בסדר רשימות הקלט (נוטמים, אזורים, אלמנטי OSM)", () => {
  const d = baseData(), rev = Object.assign({}, d, {
    notams: d.notams.slice().reverse(), zones: Object.assign({}, d.zones, { zones: d.zones.zones.slice().reverse() }), near: Object.assign({}, d.near, { elements: d.near.elements.slice().reverse() })
  });
  const a = snapOf(d, 1000), b = snapOf(rev, 1000);
  assert.deepEqual(a.notams, b.notams); assert.deepEqual(a.zones, b.zones); assert.deepEqual(a.zex, b.zex);
  const cmpFields = i => [i.k, i.d, i.z, i.c, i.h, i.n, i.n === 1 ? i.t + "|" + i.x : ""];   // שדות ההשוואה; כותרת/שם של קבוצה מאוחדת = של האלמנט הראשון (תצוגה בלבד)
  assert.deepEqual(a.items.map(cmpFields), b.items.map(cmpFields), "פריטים: אותו סדר ותוכן");
  assert.equal(RC.diffSnapshots(a, mutSnap(b, x => { x.at = new Date(+now + 3600000).toISOString(); })).counts.total, 0, "סדר אלמנטים שונה אינו שינוי");
});

test("קבוצה מאוחדת (כביש/אזור): הרכב או שם של האלמנט הראשון שהשתנו אינם 'שינוי תכונות'; מרחק וקרבה כן נבדקים", () => {
  const road = (id, name, dx) => ({ type: "node", id, lat: proj.ll(dx, 0)[0], lon: proj.ll(dx, 0)[1], tags: { landuse: "industrial", name: "אזור תעשייה בדיקה", operator: name } });
  const d1 = withElements([road(9600002, "א", 60), road(9600003, "ב", 90)])(baseData()), p = snapOf(d1);
  const g = p.items.find(i => i.k.startsWith("אזור תעשייה|") && i.n >= 2);
  assert.ok(g && g.x === "", "קבוצה מאוחדת: בלי hash של שם/תכונות");
  // הוספת חבר בעל מזהה נמוך יותר (נהיה ה"ראשון") עם שם ותכונות אחרים
  const d2 = fresher(withElements([road(9600001, "ג", 150), road(9600002, "א", 60), road(9600003, "ב", 90)])(baseData()));
  const c = RC.snapshotOf(analyze(d2, 200, t2), d2, cfg, t2), diff = RC.diffSnapshots(p, c);
  assert.equal(diff.items.rows.filter(r => r.title.includes("אזור תעשייה")).length, 0, JSON.stringify(diff.items.rows.map(r => r.title + r.fields)));
  // מרחק הקבוצה (החבר הקרוב ביותר) שהשתנה — כן
  const d3 = fresher(withElements([road(9600002, "א", 20), road(9600003, "ב", 90)])(baseData()));
  const moved = RC.diffSnapshots(p, RC.snapshotOf(analyze(d3, 200, t2), d3, cfg, t2)).items.rows.filter(r => r.title.includes("אזור תעשייה"));
  assert.equal(moved.length, 1, "החבר הקרוב ביותר התקרב מ-60 ל-20 מ׳");
  assert.equal(moved[0].status, "closer"); assert.deepEqual(moved[0].fields, ["distance"]);
});

test("תמונת מצב: גודל קטן על נתוני האמת (כל מקרי selftest), הרבה מתחת לתקרה", () => {
  for (const [name, R] of [["yarkon", 200], ["yarkon", 1000], ["yarkon", 5000], ["hula", 300], ["nitzana", 300], ["metula", 500]]) {
    const s = snapOf(baseData(name), R, now, cfg, name), bytes = Buffer.byteLength(JSON.stringify(s));
    assert.ok(bytes < 60000, `${name} R=${R}: ${bytes} בייט`);
    assert.ok(bytes < RC.LIMITS.bytes);
    assert.equal(s.capped.items, 0); assert.equal(s.capped.known, 0);
  }
  assert.ok(Buffer.byteLength(JSON.stringify(snapOf(baseData("yarkon"), 200))) < 12000, "ירקון R=200 קטן מ-12KB");
});

test("תמונת מצב: כל תמונה אמיתית עוברת אימות מבני (cleanSnapshot) ללא שינוי; מזהים כפולים בשדות תעופה/מנחתים נאספים פעם אחת", () => {
  for (const [name, R] of [["yarkon", 200], ["yarkon", 5000], ["hula", 300], ["hula", 3000], ["nitzana", 300], ["metula", 500], ["metula", 5000]]) {
    const s = snapOf(baseData(name), R, now, cfg, name), v = RC.cleanSnapshot(JSON.parse(JSON.stringify(s)));
    assert.equal(v.ok, true, `${name} ${R}: ${v.detail}`); assert.deepEqual(v.snapshot, s);
  }
  const d = baseData("hula"), res = analyze(d, 3000, now, "hula");
  assert.ok(res.airfields.some(a => a.d - 3000 <= cfg.thresholds.airfield_near_m) && res.agri.some(a => a.d - 3000 <= cfg.thresholds.agri_near_m), "יש שדה תעופה ומנחת חקלאי בטווח");
  const dup = Object.assign({}, res, { airfields: res.airfields.concat(res.airfields).map(a => Object.assign({}, a, { d: 100 })), agri: res.agri.concat(res.agri).map(a => Object.assign({}, a, { d: 100 })) });
  const s = RC.snapshotOf(dup, d, cfg, now);
  assert.ok(s.oth.air.length >= 1 && s.oth.agri.length >= 1);
  assert.equal(s.oth.air.length, new Set(s.oth.air.map(a => a.id)).size); assert.equal(s.oth.agri.length, new Set(s.oth.agri.map(a => a.n)).size);
  assert.equal(RC.cleanSnapshot(s).ok, true);
});

test("clean: אידמפוטנטי (גם אחרי חיתוך שנגמר ברווח), מסיר בקרה/כיווניות/סרוגייט בודד, ושומר סרוגייט תקין (אימוג׳י)", () => {
  const samples = ["אזור מ-LEBANON BOUNDRAY ל-8 ק\"מ SB סגור ל-ALL טיסות פנים-ארציות, למעט POLICE, FIREFIGHTING, MEDEVAC xx", "א ".repeat(80), " \t\n x \u00a0 y ", "😀".repeat(70), "ab\ud800cd", "\u202eevil\u202c", "x".repeat(300)];
  for (const sx of samples) for (const max of [0, 10, 50, 100]) {
    const once = RC.clean(sx, max), twice = RC.clean(once, max);
    assert.equal(twice, once, JSON.stringify([sx.slice(0, 20), max]));
    for (const m of [false, true]) assert.equal(RC.clean(RC.clean(sx, max, m), max, m), RC.clean(sx, max, m));
  }
  assert.equal(RC.clean("ab\ud800cd"), "abcd"); assert.equal(RC.clean("😀x"), "😀x"); assert.equal(RC.clean("😀".repeat(70), 10), "😀".repeat(10), "חיתוך לפי תווי יוניקוד שלמים");
  assert.equal(RC.clean("\u202eevil\u202c"), "evil"); assert.equal(RC.clean(null), ""); assert.equal(RC.clean(undefined, 5), ""); assert.equal(RC.clean(12345, 3), "123");
  assert.equal(RC.clean("a\r\nb\n\n\n\nc", 0, true), "a\nb\n\nc"); assert.equal(RC.clean("a\r\nb\tc"), "a b c");
});

test("תמונת מצב: בלי שום פרט אישי — לא מבקש, לא טלפון, לא אנשי קשר, לא משתתפים, לא הערות או פריטים ידניים", () => {
  const secret = ["ישראל-ישראלי-סודי", "052-7654321", "ארגון-סודי-בע״מ", "TZ-4X-SECRET", "REG-SECRET-77", "איש-קשר-סודי", "משתתף-סודי", "הערת-סיור-סודית", "מכשול-ידוע-סודי", "פריט-ידני-סודי", "אתר-סודי"];
  const inp = Object.assign(baseInput(), {
    requesterName: secret[0], requesterPhone: secret[1], requesterOrg: secret[2], callsign: secret[3], registration: secret[4],
    contacts: [{ name: secret[5], phone: "050-1111111" }, { name: "ב", phone: "050-2222222" }], participants: [{ first: secret[6], last: "x", phone: "050-3333333" }],
    visitNotes: secret[7], knownObstacles: secret[8], siteName: secret[10], manualItems: [{ name: secret[9], lat: P0.lat + 0.0003, lon: P0.lon, heightM: 30 }]
  });
  const d = baseData(), res = C.analyze(inp, d, cfg, now);
  assert.ok(res.nearScan.items.some(i => i.manual), "הפריט הידני נמצא בניתוח");
  const json = JSON.stringify(RC.snapshotOf(res, d, cfg, now));
  secret.forEach(sv => assert.ok(!json.includes(sv), "דלף: " + sv));
  assert.ok(!/050-|052-/.test(json));
});

test("תמונת מצב: פריטים שהוזנו ידנית אינם משפיעים על ההשוואה (מוצאים אותם גם בהגשה וגם בבדיקה)", () => {
  const inp = Object.assign(baseInput(), { manualItems: [{ name: "עגורן ידני", lat: P0.lat + 0.0003, lon: P0.lon, heightM: 30 }] });
  const d1 = baseData(), d2 = fresher(baseData());
  const s1 = RC.snapshotOf(C.analyze(inp, d1, cfg, now), d1, cfg, now), s2 = RC.snapshotOf(C.analyze(inp, d2, cfg, t2), d2, cfg, t2);
  assert.equal(RC.diffSnapshots(s1, s2).counts.total, 0);
});

test("תמונת מצב: מבנה, סף הגדרות, מקורות ומגבלות חלון הפעילות", () => {
  const s = snapOf(baseData(), 200, now);
  assert.deepEqual(Object.keys(s), ["v", "scan", "src", "th", "notams", "zones", "zex", "items", "oth", "capped", "at"]);
  assert.equal(s.scan.lat, exp.input.lat); assert.equal(s.scan.R, 200); assert.equal(s.scan.ft, 262.47);
  assert.ok(s.scan.wf > 0 && s.scan.wt > s.scan.wf);
  assert.equal(s.src.ni, snap.fetched_iso); assert.equal(s.src.ob, "2026-10-17T05:39:33Z");
  assert.equal(s.src.mv, zones.mapVersion); assert.equal(s.src.zh, zones.dataHash);
  assert.equal(s.th.notam_near_m, 10000); assert.equal(s.th["bd.SY"], 6);
  assert.ok(s.notams.known.length === snap.notams.length && s.notams.known.every((x, i, a) => !i || a[i - 1] < x), "מזהים מוכרים: ממוינים וייחודיים");
  assert.ok(s.notams.rc.length > 0 && s.notams.rc.every(x => ["R", "C"].includes(x[1]) && x[2]));
  assert.ok(s.notams.hits.every(n => /^[0-9a-f]{12}$/.test(n.h)));
});

test("תמונת מצב: תקרות — פריטי OSM מעל 400 נחתכים (הקרובים נשמרים) ומסומנים; יותר מדי נוטמים/אזורים זורק", () => {
  const many = Array.from({ length: 600 }, (_, i) => tower(9100000 + i, ((i * 37) % 700) - 350, ((i * 91) % 700) - 350, { name: "תורן " + i }));
  const d = withElements(many)(baseData());
  const res = analyze(d, 1000), all = res.nearScan.items.filter(i => !i.manual).length;
  assert.ok(all > 400, "בנינו יותר מ-400 פריטים (" + all + ")");
  const s = RC.snapshotOf(res, d, cfg, now);
  assert.equal(s.items.length, 400); assert.equal(s.capped.items, all - 400);
  assert.ok(s.items.every((i, k, a) => !k || a[k - 1].d <= i.d), "ממוין לפי מרחק; הרחוקים נחתכו");
  assert.ok(Buffer.byteLength(JSON.stringify(s)) <= RC.LIMITS.bytes);
  const hits = Array.from({ length: 310 }, (_, i) => mkNotam("A" + String(7000 + i) + "/26"));
  const d2 = withNotams(hits)(baseData());
  assert.throws(() => RC.snapshotOf(analyze(d2), d2, cfg, now), /נוטמים/);
  const zs = Array.from({ length: 310 }, (_, i) => mkZone("LLP" + (800 + i), { rings: [square(i % 7, i % 5, 100 + i)] }));
  const d3 = withZones(z => z.concat(zs))(baseData());
  assert.throws(() => RC.snapshotOf(analyze(d3), d3, cfg, now), /אזורים/);
  assert.throws(() => RC.snapshotOf(null, d, cfg), /ניתוח/);
  assert.throws(() => RC.snapshotOf({ inp: {} }, d, cfg), /ניתוח/);
});

test("תמונת מצב: תקרת הגודל הכוללת — קודם נחתכים פריטי OSM רחוקים (מסומן), ואם עדיין גדול נמחקת רשימת המזהים; חריגה סופית זורקת", () => {
  const many = Array.from({ length: 450 }, (_, i) => tower(9100000 + i, ((i * 37) % 900) - 450, ((i * 91) % 900) - 450, { name: "תורן " + i }));
  const d = withElements(many)(baseData()), res = analyze(d, 1000), saved = RC.LIMITS.bytes;
  try {
    const full = RC.snapshotOf(res, d, cfg, now), fullBytes = Buffer.byteLength(JSON.stringify(full));
    assert.ok(fullBytes > 60000 && full.items.length === 400, String(fullBytes));
    RC.LIMITS.bytes = 40000;
    const s = RC.snapshotOf(res, d, cfg, now), b = Buffer.byteLength(JSON.stringify(s));
    assert.ok(b <= 40000 && s.items.length < 400 && s.items.length > 100, `${b} / ${s.items.length}`);
    assert.equal(s.capped.items, res.nearScan.items.length - s.items.length, "מסומן כמה נחתכו");
    assert.deepEqual(s.items, full.items.slice(0, s.items.length), "נשארים הקרובים ביותר");
    assert.equal(s.notams.known.length, snap.notams.length, "רשימת המזהים נשמרה כשהחיתוך הספיק");
    RC.LIMITS.bytes = 3000;
    const t = RC.snapshotOf(res, d, cfg, now);
    assert.equal(t.items.length, 0); assert.equal(t.notams.known.length, 0); assert.equal(t.capped.known, snap.notams.length);
    RC.LIMITS.bytes = 500;
    assert.throws(() => RC.snapshotOf(res, d, cfg, now), /חורגת/);
  } finally { RC.LIMITS.bytes = saved; }
  assert.equal(RC.LIMITS.bytes, 400000);
});

test("תמונת מצב: רשימת מזהים מוכרים מעל 3000 נחתכת ומסומנת, והסיווג בהשוואה הופך כללי", () => {
  const pad = Array.from({ length: 3100 }, (_, i) => ({ id: "Z" + String(i).padStart(4, "0") + "/26", raw: "Z" + String(i).padStart(4, "0") + "/26 NOTAMN\nQ) LLLL/QKKKK/K /K  /K /000/999/3124N03520E999\nA) LLLL B) 2610051239 C) 2611051239EST\nE) CHECKLIST)" }));
  const d = withNotams(pad)(baseData());
  const s = snapOf(d);
  assert.equal(s.notams.known.length, 3000); assert.equal(s.capped.known, snap.notams.length + 3100 - 3000);
  const cur = mutSnap(snapOf(fresher(baseData()), 200, t2), c => { c.notams.hits = []; });
  const diff = RC.diffSnapshots(s, cur);
  assert.equal(diff.reliability.notams, "capped");
  assert.equal(diff.notams.rows[0].status, "gone", "לא מסווגים בטענה מדויקת כשהרשימה חלקית");
});

/* ==================== השוואה: אפס רעש ==================== */
test("השוואה: נתונים זהים (גם שבוע אחרי, מקורות טריים יותר) ← אפס שינויים, עם ספירות", () => {
  for (const [name, R] of [["yarkon", 200], ["yarkon", 1000], ["hula", 300], ["metula", 500], ["nitzana", 300]]) {
    const { diff } = scenario(null, { R, name });
    assert.equal(diff.comparable, true); assert.equal(diff.anyChange, false); assert.equal(diff.counts.total, 0, `${name} R=${R}`);
    assert.equal(diff.notams.unchanged, diff.notams.checked); assert.equal(diff.zones.unchanged, diff.zones.checked); assert.equal(diff.items.unchanged, diff.items.checked);
    assert.ok(diff.zones.checked >= 1);
  }
  const { diff } = scenario(null, { R: 1000 });
  assert.ok(diff.items.checked > 50 && diff.items.unchanged === diff.items.checked);
  for (const [name, R] of [["hula", 3000], ["metula", 5000], ["nitzana", 5000]]) {
    const r = scenario(null, { R, name }).diff;
    assert.equal(r.counts.total, 0, `${name} ${R}`); assert.ok(r.other.checked >= 1 && r.other.unchanged === r.other.checked, `${name}: גבולות/שדות תעופה/מנחתים נבדקו (${r.other.checked})`);
  }
  assert.ok(scenario(null, { R: 300, name: "hula" }).diff.notams.checked >= 9, "ב-hula יש 9 נוטמים בטווח");
});

test("נתוני אמת (hula): כל 9 הנוטמים שנספרו — הסרה מהפיד ← 'אינו מופיע עוד…' / 'פג תוקפו' לפי סיום התוקף; החלפה וביטול מזוהים לפי הפניה", () => {
  const { prev } = scenario(null, { R: 300, name: "hula" });
  assert.ok(prev.notams.hits.length >= 9);
  const ids = prev.notams.hits.map(h => h.id), gone = (drop, extra = []) => fresher(Object.assign({}, baseData("hula"), { notams: baseData("hula").notams.filter(n => drop.indexOf(n.id) < 0).concat(extra) }));
  const run = d => RC.diffSnapshots(prev, RC.snapshotOf(analyze(d, 300, t2, "hula"), d, cfg, t2));
  const all = run(gone(ids));
  assert.equal(all.notams.rows.length, ids.length); assert.ok(all.notams.rows.every(r => r.cls === "removed" && ["withdrawn", "expired"].includes(r.status)));
  all.notams.rows.forEach(r => assert.equal(r.status, (r.before.t === 0 || r.before.t > +t2) ? "withdrawn" : "expired", r.id));
  const one = ids[0], c1 = run(gone([one], [mkNotam("C0001/26", { type: "C", ref: one, pos: "330000N0354000E" })]));
  assert.equal(c1.notams.rows.length, 1); assert.equal(c1.notams.rows[0].status, "cancelled"); assert.equal(c1.notams.rows[0].id, one);
  const pos = prev.notams.hits.find(h => h.id === one);
  const r1 = run(gone([one], [mkNotam("A0001/26", { type: "R", ref: one, pos: "330500N0353600E", radius: "2NM" })]));
  assert.equal(r1.notams.rows.length, 1, JSON.stringify(r1.notams.rows.map(r => r.id + r.status))); assert.equal(r1.notams.rows[0].status, "replaced"); assert.equal(r1.notams.rows[0].replaces, one);
  assert.ok(pos);
});

test("השוואה: הקלט של כל קריאה לא משתנה והתוצאה דטרמיניסטית", () => {
  const { prev, cur } = scenario(withNotams([mkNotam("A9999/26")]));
  const p = JSON.stringify(prev), c = JSON.stringify(cur);
  const a = RC.diffSnapshots(prev, cur), b = RC.diffSnapshots(prev, cur);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(JSON.stringify(prev), p); assert.equal(JSON.stringify(cur), c);
});

/* ==================== השוואה: נוטמים ==================== */
test("נוטם חדש שחופף לנקודה: חדש, חומרה גבוהה; נוטם חדש בקרבה בלבד: בינונית", () => {
  const near = mkNotam("A9998/26", { pos: "320800N0344859E", radius: "0.5NM" });
  const { diff } = scenario(withNotams([mkNotam("A9999/26"), near]));
  const rows = diff.notams.rows;
  const r = id => rows.find(x => x.id === id);
  assert.equal(r("A9999/26").status, "new"); assert.equal(r("A9999/26").cls, "added"); assert.equal(r("A9999/26").sev, "high");
  assert.equal(r("A9998/26").status, "new"); assert.equal(r("A9998/26").sev, "mid", "קרוב, לא חופף"); assert.equal(r("A9998/26").after.r, "n");
  const rep = scenario(withNotams([mkNotam("A9997/26", { type: "R", ref: "A5555/26" })])).diff.notams.rows.find(x => x.id === "A9997/26");
  assert.equal(rep.status, "new"); assert.equal(rep.replaces, "A5555/26", "החלפה של נוטם שלא נספר בהגשה — חדש, עם ההפניה");
  assert.equal(diff.counts.added, 2); assert.equal(diff.counts.high, 1);
  assert.equal(rows[0].id, "A9999/26", "חומרה גבוהה קודם");
});

test("נוטם שהיה בפיד בהגשה ולא נספר ואז נכנס לטווח: 'נכנס לטווח הבדיקה' ולא 'חדש'", () => {
  const { prev, cur } = scenario(withNotams([mkNotam("A9999/26")]));
  const p2 = mutSnap(prev, p => { p.notams.known.push("A9999/26"); p.notams.known.sort(); });
  const d = RC.diffSnapshots(p2, cur);
  assert.equal(d.notams.rows.find(r => r.id === "A9999/26").status, "entered");
  assert.equal(RC.diffSnapshots(prev, cur).notams.rows.find(r => r.id === "A9999/26").status, "new");
});

test("ביטול (NOTAMC): הנוטם שנעלם מסווג 'בוטל' עם מספר הביטול", () => {
  const { diff } = scenario(withNotams([mkNotam("C0999/26", { type: "C", ref: "C0431/26" })], ["C0431/26"]));
  const r = diff.notams.rows.find(x => x.id === "C0431/26");
  assert.equal(r.status, "cancelled"); assert.equal(r.cls, "removed"); assert.equal(r.by, "C0999/26");
  assert.equal(diff.counts.removed, 1);
  assert.ok(RC.sinceModel(diff, {}).sections[0].rows[0].lines.join(" ").includes("C0999/26"));
});

test("החלפה (NOTAMR): זוג אחד 'הוחלף' עם שדות ששונו — לא נעלם+חדש", () => {
  const x = mkNotam("A9001/26"), y = mkNotam("A9002/26", { type: "R", ref: "A9001/26", to: "2610241000", up: "100" });
  const { cur } = scenario(withNotams([y], []));
  const d1 = withNotams([x])(baseData()), p = snapOf(d1);
  assert.equal(p.notams.hits.find(h => h.id === "A9001/26").k, "c");
  const diff = RC.diffSnapshots(p, cur);
  assert.equal(diff.notams.rows.length, 1, "רק שורה אחת: " + JSON.stringify(diff.notams.rows.map(r => r.id + r.status)));
  const r = diff.notams.rows[0];
  assert.equal(r.status, "replaced"); assert.equal(r.cls, "changed"); assert.equal(r.id, "A9002/26"); assert.equal(r.replaces, "A9001/26");
  assert.ok(r.fields.includes("window") && r.fields.includes("height"), r.fields.join());
  assert.equal(r.sev, "high");
  const line = RC.sinceModel(diff, {}).sections[0].rows[0].lines.join("\n");
  assert.ok(line.includes("מחליף את A9001/26") && line.includes("2026-10-24 10:00Z") && line.includes("0–10,000"), line);
});

test("שרשרת החלפות: X←X'←X'' כש-X' כבר אינו בפיד — לא ממציאים קשר: X 'אינו מופיע עוד…' ו-X'' חדש עם 'מחליף את X''", () => {
  const x = mkNotam("A9001/26"), x2 = mkNotam("A9002/26", { type: "R", ref: "A9001/26" }), x3 = mkNotam("A9003/26", { type: "R", ref: "A9002/26", up: "100" });
  const p = snapOf(withNotams([x])(baseData()));
  const d2 = fresher(withNotams([x3])(baseData())), diff = RC.diffSnapshots(p, RC.snapshotOf(analyze(d2, 200, t2), d2, cfg, t2));
  const byId = id => diff.notams.rows.find(r => r.id === id);
  assert.equal(diff.notams.rows.length, 2);
  assert.equal(byId("A9001/26").status, "withdrawn"); assert.equal(byId("A9001/26").cls, "removed");
  assert.equal(byId("A9003/26").status, "new"); assert.equal(byId("A9003/26").replaces, "A9002/26");
  // אם X' עדיין בפיד (ונספר) — שתי החלפות רצופות: X←X' כזוג, ו-X'' חדש שמחליף את X'
  const d3 = fresher(withNotams([x2, x3])(baseData())), chain = RC.diffSnapshots(p, RC.snapshotOf(analyze(d3, 200, t2), d3, cfg, t2));
  assert.deepEqual(chain.notams.rows.map(r => r.id + ":" + r.status).sort(), ["A9002/26:replaced", "A9003/26:new"]);
  assert.equal(chain.notams.rows.find(r => r.id === "A9002/26").replaces, "A9001/26");
  assert.ok(RC.sinceModel(chain, {}).sections[0].rows.some(r => r.lines.join(" ").includes("מחליף את A9002/26")));
});

test("ביטול של החלפה: X הוחלף ב-X' שבוטל — X אינו מופיע עוד; מספר הביטול מצוין רק כשהוא מפנה ישירות ל-X", () => {
  const x = mkNotam("A9001/26"), c = mkNotam("C0777/26", { type: "C", ref: "A9002/26" });
  const p = snapOf(withNotams([x])(baseData()));
  const d2 = fresher(withNotams([c])(baseData())), diff = RC.diffSnapshots(p, RC.snapshotOf(analyze(d2, 200, t2), d2, cfg, t2));
  assert.equal(diff.notams.rows.length, 1); assert.equal(diff.notams.rows[0].status, "withdrawn"); assert.equal(diff.notams.rows[0].by, undefined);
  const direct = fresher(withNotams([mkNotam("C0778/26", { type: "C", ref: "A9001/26" })])(baseData()));
  assert.equal(RC.diffSnapshots(p, RC.snapshotOf(analyze(direct, 200, t2), direct, cfg, t2)).notams.rows[0].by, "C0778/26");
});

test("החלפה: אותו תוכן במספר חדש ← 'הוחלף' בלי שדות; ההחלפה שאינה נספרת כסגירה ← שורת 'הוחלף' בלי זוג", () => {
  const x = mkNotam("A9001/26"), same = mkNotam("A9002/26", { type: "R", ref: "A9001/26" });
  const p = snapOf(withNotams([x])(baseData()));
  const c1 = RC.snapshotOf(analyze(fresher(withNotams([same])(baseData())), 200, t2), fresher(withNotams([same])(baseData())), cfg, t2);
  const d1 = RC.diffSnapshots(p, c1);
  assert.equal(d1.notams.rows.length, 1); assert.equal(d1.notams.rows[0].status, "replaced");
  assert.deepEqual(d1.notams.rows[0].fields, [], "הכותרת (מספר/סוג) אינה נחשבת שינוי תוכן");
  const far = mkNotam("A9003/26", { type: "R", ref: "A9001/26", pos: "330000N0354859E" });
  const dFar = fresher(withNotams([far])(baseData()));
  const d2 = RC.diffSnapshots(p, RC.snapshotOf(analyze(dFar, 200, t2), dFar, cfg, t2));
  const r = d2.notams.rows.find(q => q.id === "A9001/26");
  assert.equal(r.status, "replaced"); assert.equal(r.cls, "removed"); assert.equal(r.by, "A9003/26"); assert.equal(r.counted, false);
  assert.ok(RC.sinceModel(d2, {}).sections[0].rows.some(q => q.lines.join(" ").includes("אינו נספר כסגירה")));
});

test("נוטם שנעלם מהפיד בלי ביטול/החלפה: לפני תום תוקפו ← 'אינו מופיע עוד…'; אחרי ← 'פג תוקפו'; בלי זמן ← כללי", () => {
  const { prev, cur } = scenario(withNotams([], ["C0431/26"]));
  assert.equal(prev.notams.hits[0].t, 0, "קבוע (PERM)");
  const w = RC.diffSnapshots(prev, cur).notams.rows[0];
  assert.equal(w.status, "withdrawn"); assert.match(RC.STR.status.notam.withdrawn, /לפני תום תוקפו/);
  const pastP = mutSnap(prev, p => { p.notams.hits[0].t = +t2 - 3600000; });
  assert.equal(RC.diffSnapshots(pastP, cur).notams.rows[0].status, "expired");
  const futP = mutSnap(prev, p => { p.notams.hits[0].t = +t2 + 3600000; });
  assert.equal(RC.diffSnapshots(futP, cur).notams.rows[0].status, "withdrawn");
  const noAt = mutSnap(cur, c => { delete c.at; });
  assert.equal(RC.diffSnapshots(futP, noAt).notams.rows[0].status, "gone");
  assert.equal(RC.diffSnapshots(futP, noAt, { now: +t2 + 7200000 }).notams.rows[0].status, "expired", "opts.now");
});

test("נוטם שעדיין בפיד אך אינו נספר עוד כסגירה בטווח", () => {
  const { prev, cur } = scenario(withNotams([], []));
  const c2 = mutSnap(cur, c => { c.notams.hits = []; });
  assert.ok(c2.notams.known.includes(prev.notams.hits[0].id));
  assert.equal(RC.diffSnapshots(prev, c2).notams.rows[0].status, "out");
});

test("אותו נוטם בנוסח/תוקף/גובה/גיאומטריה ששונו ← 'שונה' עם השדות; בלי שינוי בתוכן ← כלום", () => {
  const mod = (fn) => d => Object.assign({}, d, { notams: d.notams.map(n => n.id === "C0431/26" ? Object.assign({}, n, { raw: fn(n.raw) }) : n) });
  const f = fn => scenario(mod(fn)).diff.notams.rows;
  const t = f(r => r.replace("PROHIBITED", "PROHIBITED. SEE AIP"));
  assert.equal(t.length, 1); assert.equal(t[0].status, "changed"); assert.deepEqual(t[0].fields, ["text"]);
  assert.ok(f(r => r.replace("/000/003/", "/000/005/"))[0].fields.includes("height"));
  assert.ok(f(r => r.replace("C) PERM", "C) 2701010000"))[0].fields.includes("window"));
  assert.ok(f(r => r.replace("PSN 320418N0344709.6E", "PSN 320518N0344709.6E"))[0].fields.includes("geometry"));
  assert.equal(f(r => r.replace(/\n/g, "\n  ")).length, 0, "רווחים בלבד — אותו נוסח");
  assert.equal(scenario(mod(r => r.replace("C0431/26 NOTAMN", "C0431/26 NOTAMN "))).diff.notams.rows.length, 0, "כותרת (מספר/סוג) אינה חלק מהנוסח");
});

/* ==================== השוואה: אזורים ==================== */
test("אזור שנוסחו/גובהו השתנה ← 'שונה' (text) עם לפני/אחרי; הזזת גבול ← geometry", () => {
  const id = "LLU20";
  const { diff } = scenario(withZones(zs => zs.map(z => z.id === id ? Object.assign({}, z, { alt: "GND – 500 ft AMSL" }) : z)));
  assert.equal(diff.zones.rows.length, 1); const r = diff.zones.rows[0];
  assert.equal(r.status, "changed"); assert.deepEqual(r.fields, ["text"]); assert.equal(r.before.a, "GND – 1,000 ft AGL"); assert.equal(r.after.a, "GND – 500 ft AMSL");
  assert.equal(r.sev, "mid", "בקרבה, לא בתוך הסגירה");
  const moved = scenario(withZones(zs => zs.map(z => z.id === id ? Object.assign({}, z, { rings: z.rings.map(rg => rg.map(p => [p[0] + 0.001, p[1]])) }) : z)));
  assert.ok(moved.diff.zones.rows[0].fields.includes("geometry"));
  const zAt = dx => withZones(zs => zs.concat([mkZone("LLP997", { rings: [square(dx, 0, 150)] })]))(baseData());
  const zm = RC.diffSnapshots(snapOf(zAt(0)), RC.snapshotOf(analyze(fresher(zAt(400)), 200, t2), fresher(zAt(400)), cfg, t2)).zones.rows[0];
  assert.deepEqual(zm.fields.slice().sort(), ["distance", "geometry", "inside"]); assert.equal(zm.before.d, 0); assert.ok(zm.after.d > 200);
  assert.ok(RC.sinceModel(RC.diffSnapshots(snapOf(zAt(0)), RC.snapshotOf(analyze(fresher(zAt(400)), 200, t2), fresher(zAt(400)), cfg, t2)), {}).sections[0].rows[0].lines.some(l => l.includes("בתוך השטח") && l.includes("מרחק")));
  // רעש מתחת לרזולוציית ה-hash (1e-5° ≈ 1.1 מ׳), על אזור שקואורדינטותיו על הרשת: אינו שינוי
  const snapZone = (dx) => { const z = mkZone("LLP998", { rings: [square(0, 0, 150).map(p => p.map(v => +v.toFixed(5)))] }); return Object.assign({}, z, { rings: z.rings.map(rg => rg.map(p => [p[0] + dx, p[1]])) }); };
  const dz = (dx) => { const d = withZones(zs => zs.concat([snapZone(dx)]))(baseData()); return d; };
  const g1 = snapOf(dz(0)), g2 = RC.snapshotOf(analyze(fresher(dz(3e-7)), 200, t2), fresher(dz(3e-7)), cfg, t2), g3 = RC.snapshotOf(analyze(fresher(dz(2e-5)), 200, t2), fresher(dz(2e-5)), cfg, t2);
  assert.equal(RC.diffSnapshots(g1, g2).zones.rows.length, 0, "הזזה של ~3 ס״מ אינה שינוי");
  assert.ok(RC.diffSnapshots(g1, g3).zones.rows[0].fields.includes("geometry"), "הזזה של ~2 מ׳ היא שינוי גבול");
});

test("אזור חדש בתוך הסגירה ← חדש, חומרה גבוהה; אזור שנעלם מהנתונים ← יצא מהטווח; אזור b09 שנשלל לפי גובה", () => {
  const add = scenario(withZones(zs => zs.concat([mkZone("LLP999")])));
  assert.equal(add.diff.zones.rows.length, 1);
  assert.equal(add.diff.zones.rows[0].status, "entered"); assert.equal(add.diff.zones.rows[0].sev, "high"); assert.equal(add.diff.zones.rows[0].after.in, 1);
  const del = scenario(withZones(zs => zs.filter(z => z.id !== "LLU20")));
  assert.equal(del.diff.zones.rows[0].status, "left"); assert.equal(del.diff.zones.rows[0].cls, "removed");
  const { prev, cur } = scenario(null);
  const p = mutSnap(prev, s => { s.zones.push({ id: "B09-77", s: "b09", c: "B09", n: "", d: 300, e: 100, in: 0, a: "", g: "aaaaaaaaaaaa", h: "bbbbbbbbbbbb" }); });
  const c = mutSnap(cur, s => { s.zex.push("B09-77"); });
  assert.equal(RC.diffSnapshots(p, c).zones.rows[0].status, "excluded");
  assert.equal(RC.diffSnapshots(p, cur).zones.rows[0].status, "left");
});

test("אזור: מעבר בין 'בקרבה' ל'בתוך הסגירה' ← שינוי inside", () => {
  const { prev, cur } = scenario(null);
  const c = mutSnap(cur, s => { s.zones[0].in = 1; s.zones[0].d = prev.zones[0].d; });
  const r = RC.diffSnapshots(prev, c).zones.rows[0];
  assert.deepEqual(r.fields, ["inside"]); assert.equal(r.sev, "high");
});

/* ==================== השוואה: מכשולים ותשתיות (OSM) ==================== */
test("פריט OSM חדש בתוך הרדיוס ← חדש, חומרה גבוהה; מחוץ לרדיוס (בטבעת) ← בינונית; נמחק ← אינו מופיע עוד", () => {
  const { diff } = scenario(withElements([tower(9200001, 40, 20, { name: "תורן חדש" }), tower(9200002, 300, 0, { name: "תורן בטבעת" })]));
  const r1 = diff.items.rows.find(r => r.title.includes("תורן חדש")), r2 = diff.items.rows.find(r => r.title.includes("תורן בטבעת"));
  assert.equal(r1.status, "added"); assert.equal(r1.sev, "high"); assert.equal(r1.after.z, "i");
  assert.equal(r2.sev, "mid"); assert.equal(r2.after.z, "r");
  const base = analyze(baseData()), victim = base.nearScan.items.find(i => i.cat === "obst" && i.ids.length === 1 && /^way/.test(i.ids[0]));
  const del = scenario(withElements([], e => victim.ids[0] === e.type + "/" + e.id));
  assert.equal(del.diff.items.rows.length, 1); assert.equal(del.diff.items.rows[0].status, "removed"); assert.equal(del.diff.items.rows[0].sev, "low");
  assert.equal(del.diff.items.rows[0].title, victim.title);
});

test("פריט מצאי רחב (census) חדש בתוך הרדיוס: בינונית ולא גבוהה", () => {
  const house = { type: "node", id: 9300001, lat: proj.ll(30, 0)[0], lon: proj.ll(30, 0)[1], tags: { landuse: "industrial", name: "אזור בדיקה" } };
  const { diff } = scenario(withElements([house]));
  const r = diff.items.rows.find(x => x.title.includes("אזור בדיקה"));
  assert.ok(r, JSON.stringify(diff.items.rows.map(x => x.title)));
  assert.equal(r.after.c, "census"); assert.equal(r.sev, "mid");
});

test("פריט OSM: שינוי תכונות (גובה/שם) ← 'שונה'; הזזה מעל הסף ← התקרב/התרחק; מתחת לסף ← כלום; הסף היחסי 5% למרחקים גדולים", () => {
  const t0 = tower(9400001, 100, 0, { name: "תורן", height: "40" });
  const d1 = withElements([t0])(baseData());
  const prevAll = (R) => snapOf(d1, R);
  const cur = (el, R = 200) => { const d = fresher(withElements([el], e => e.id === 9400001)(baseData())); return RC.snapshotOf(analyze(d, R, t2), d, cfg, t2); };
  const diffOf = (el, R = 200) => RC.diffSnapshots(prevAll(R), cur(el, R)).items.rows.filter(r => r.id.includes("9400001") || r.title.includes("תורן"));
  const tagged = diffOf(tower(9400001, 100, 0, { name: "תורן", height: "95" }));
  assert.equal(tagged.length, 1); assert.equal(tagged[0].status, "changed"); assert.ok(tagged[0].fields.includes("tags"));
  assert.equal(diffOf(tower(9400001, 108, 0, { name: "תורן", height: "40" })).length, 0, "8 מ׳ מתחת לסף 10");
  const closer = diffOf(tower(9400001, 70, 0, { name: "תורן", height: "40" }));
  assert.equal(closer.length, 1); assert.equal(closer[0].status, "closer");
  assert.equal(diffOf(tower(9400001, 140, 0, { name: "תורן", height: "40" }))[0].status, "farther");
  // R=1000: מרחק ~1500 מ׳; 5% = 75 מ׳. הזזה של 40 מ׳ אינה שינוי; הזזה של 120 מ׳ כן
  const far = tower(9400001, 1500, 0, { name: "תורן", height: "40" });
  const dFar = withElements([far])(baseData()), pFar = snapOf(dFar, 1000);
  const mk = x => { const d = fresher(withElements([tower(9400001, x, 0, { name: "תורן", height: "40" })], e => e.id === 9400001)(baseData())); return RC.snapshotOf(analyze(d, 1000, t2), d, cfg, t2); };
  assert.ok(pFar.items.some(i => i.k === "node/9400001"), "הפריט נסרק");
  assert.equal(RC.diffSnapshots(pFar, mk(1540)).items.rows.length, 0);
  assert.equal(RC.diffSnapshots(pFar, mk(1620)).items.rows.length, 1);
  assert.equal(RC.diffSnapshots(pFar, mk(1540), { eps: 10, epsPct: 1 }).items.rows.length, 1, "epsPct נקרא מהאפשרויות");
  assert.equal(RC.diffSnapshots(prevAll(200), cur(tower(9400001, 70, 0, { name: "תורן", height: "40" })), { eps: 100 }).items.rows.length, 0, "eps נקרא מהאפשרויות");
});

test("פריט שמפתחו השתנה אך אלמנט ה-OSM זהה ← 'שונה' (לא נעלם+חדש); התאמה דו-משמעית ← לא מנחשים", () => {
  const { prev, cur } = scenario(null);
  const it = prev.items.find(i => i.k.startsWith("קו מתח"));
  assert.ok(it, "יש קו מתח בנתונים");
  const c = mutSnap(cur, s => { const x = s.items.find(i => i.k === it.k); x.k = "קו מתח עליון 400 ק״ו|"; x.t = "קו מתח עליון 400 ק״ו"; x.h = "123456789abc"; });
  const d = RC.diffSnapshots(prev, c);
  assert.equal(d.items.rows.length, 1); assert.equal(d.items.rows[0].status, "changed"); assert.ok(d.items.rows[0].fields.includes("tags") && d.items.rows[0].fields.includes("title"));
  const amb = mutSnap(cur, s => {
    const x = s.items.find(i => i.k === it.k); x.k = "A|1"; x.t = "A";
    s.items.push(Object.assign({}, x, { k: "B|1", t: "B" }));
  });
  const d2 = RC.diffSnapshots(prev, amb);
  assert.deepEqual(d2.items.rows.map(r => r.status).sort(), ["added", "added", "removed"], "שני מועמדים לאותו מזהה — לא מנחשים");
});

/* ==================== השוואה: גבולות, שדות תעופה, מנחתים ==================== */
test("אחר: חדירה לרצועת גבול (חדש/הפכה) ← גבוהה; שדה תעופה חדש בקרבה; מרחק מנחת חקלאי השתנה", () => {
  const { prev, cur } = scenario(null);
  const p = mutSnap(prev, s => { s.oth.borders = [{ iso: "LB", d: 5000, v: 0 }]; s.oth.agri = [{ n: "מנחת א", d: 1000 }]; });
  const c = mutSnap(cur, s => { s.oth.borders = [{ iso: "LB", d: 2500, v: 1 }]; s.oth.air = [{ id: "way/1", d: 800, t: "aerodrome", n: "שדה בדיקה" }]; s.oth.agri = [{ n: "מנחת א", d: 1100 }]; });
  const d = RC.diffSnapshots(p, c), by = id => d.other.rows.find(r => r.id === id);
  assert.equal(by("LB").status, "changed"); assert.equal(by("LB").sev, "high"); assert.deepEqual(by("LB").fields.sort(), ["distance", "violates"]);
  assert.equal(by("way/1").status, "added"); assert.equal(by("way/1").sev, "mid");
  assert.equal(by("מנחת א").status, "changed");
  const small = mutSnap(c, s => { s.oth.agri = [{ n: "מנחת א", d: 1005 }]; });
  assert.equal(RC.diffSnapshots(p, small).other.rows.some(r => r.id === "מנחת א"), false, "5 מ׳ — מתחת לסף");
  const gone = RC.diffSnapshots(p, mutSnap(c, s => { s.oth.borders = []; }));
  assert.equal(gone.other.rows.find(r => r.id === "LB").status, "removed");
});

test("מיון שורות: חומרה גבוהה קודם, אחר כך לפי מרחק; ספירות checked/unchanged עקביות", () => {
  const { diff } = scenario(d => withElements([tower(9200001, 150, 0, { name: "רחוק בתוך" }), tower(9200002, 20, 0, { name: "קרוב בתוך" }), tower(9200003, 300, 0, { name: "טבעת" })])(withNotams([mkNotam("A9999/26")])(d)));
  const rows = diff.items.rows;
  assert.deepEqual(rows.map(r => r.sev), ["high", "high", "mid"]);
  assert.ok(rows[0].d <= rows[1].d && rows[0].title.includes("קרוב"));
  const census = { type: "node", id: 9300009, lat: proj.ll(10, 0)[0], lon: proj.ll(10, 0)[1], tags: { landuse: "industrial", name: "מצאי קרוב" } };
  const mixed = scenario(withElements([census, tower(9200009, 150, 0, { name: "תורן רחוק יותר" })])).diff.items.rows;
  assert.deepEqual(mixed.map(r => [r.sev, r.title.includes("מצאי")]), [["high", false], ["mid", true]], "חומרה גבוהה קודם גם כשהיא רחוקה יותר");
  ["notams", "zones", "items"].forEach(k => assert.equal(diff[k].checked, diff[k].unchanged + diff[k].rows.length, k + ": נבדקו = ללא שינוי + שורות"));
  assert.equal(diff.counts.total, rowsOf(diff).length);
  assert.equal(diff.counts.high, rowsOf(diff).filter(r => r.sev === "high").length);
});

test("חריגה: מעל 200 שינויים ← excessive (ניתן להגדרה)", () => {
  const many = Array.from({ length: 30 }, (_, i) => mkNotam("A" + (6000 + i) + "/26"));
  const { diff } = scenario(withNotams(many));
  assert.equal(diff.counts.total, 30); assert.equal(diff.excessive, false);
  assert.equal(RC.diffSnapshots(scenario(null).prev, scenario(withNotams(many)).cur, { excessive: 20 }).excessive, true);
  assert.equal(RC.diffSnapshots(scenario(null).prev, scenario(withNotams(many)).cur, { excessive: 30 }).excessive, false, "בדיוק בתקרה — עדיין לא חריג");
  assert.ok(RC.sinceModel(RC.diffSnapshots(scenario(null).prev, scenario(withNotams(many)).cur, { excessive: 20 }), {}).notes.includes(RC.STR.excessive));
});

/* ==================== נכשל סגור ==================== */
test("קלט סריקה שונה ← comparable:false (scan_mismatch), עם השדות; סטיית רעש מתחת ל-1e-6 מותרת", () => {
  const { prev, cur } = scenario(null);
  const ch = (fn, field) => { const d = RC.diffSnapshots(prev, mutSnap(cur, fn)); assert.equal(d.comparable, false, field); assert.equal(d.reason, "scan_mismatch"); assert.ok(d.scanChanged.includes(field), d.scanChanged.join()); };
  ch(c => { c.scan.lat += 1e-5; }, "point"); ch(c => { c.scan.lon -= 1e-5; }, "point"); ch(c => { c.scan.R = 300; }, "radius"); ch(c => { c.scan.ft += 1; }, "height");
  ch(c => { c.scan.wf += 60000; }, "window"); ch(c => { c.scan.wt -= 60000; }, "window");
  assert.equal(RC.diffSnapshots(prev, mutSnap(cur, c => { c.scan.lat += 1e-8; c.scan.ft += 0.004; })).comparable, true);
  const real = scenario(null, { R: 200 }).prev, other = snapOf(fresher(baseData()), 300, t2);
  assert.equal(RC.diffSnapshots(real, other).reason, "scan_mismatch");
});

test("הגדרות סריקה ששונו ← thresholds_changed עם המפתחות (כולל כללי גבול); הגדרות שאינן משפיעות — לא", () => {
  const c2 = Object.assign({}, cfg, { thresholds: Object.assign({}, cfg.thresholds, { notam_near_m: 5000 }) });
  const d = scenario(null, { cfg2: c2 }).diff;
  assert.equal(d.comparable, false); assert.equal(d.reason, "thresholds_changed"); assert.deepEqual(d.configChanged, ["notam_near_m"]);
  const c3 = Object.assign({}, cfg, { borders: Object.assign({}, cfg.borders, { SY: { name: "סוריה", km: 8 } }) });
  assert.deepEqual(scenario(null, { cfg2: c3 }).diff.configChanged, ["bd.SY"]);
  const c4 = Object.assign({}, cfg, { thresholds: Object.assign({}, cfg.thresholds, { notam_max_age_h: 12, osm_max_age_h: 12, min_working_days: 3, notam_warn_age_h: 1, place_scan_m: 1 }) });
  assert.equal(scenario(null, { cfg2: c4 }).diff.comparable, true, "ספי גיל/ימי עבודה אינם משפיעים על התוצאות");
  const m = RC.sinceModel(d, {});
  assert.equal(m.kind, "blocked"); assert.match(m.summary, /טווח נוטמים בקרבת הסגירה/); assert.match(m.summary, /אי אפשר להשוות/);
});

test("מקור ישן מהשמור ← stale_notams / stale_osm (לא 'הוסר'); שווה — מותר; osmSlackMs מקל; חסר — no_source_time", () => {
  const { prev, cur } = scenario(null);
  const n = RC.diffSnapshots(prev, mutSnap(cur, c => { c.src.ni = "2026-10-14T00:00:00Z"; }));
  assert.equal(n.reason, "stale_notams"); assert.equal(n.feed, "ni"); assert.equal(n.before, prev.src.ni);
  assert.equal(RC.diffSnapshots(prev, mutSnap(cur, c => { c.src.ni = prev.src.ni; c.src.ob = prev.src.ob; c.src.of = prev.src.of; c.src.ox = prev.src.ox; })).comparable, true, "שווה מותר");
  const o = RC.diffSnapshots(prev, mutSnap(cur, c => { c.src.ob = "2026-10-17T05:00:00Z"; }));
  assert.equal(o.reason, "stale_osm"); assert.equal(o.feed, "ob");
  assert.equal(RC.diffSnapshots(prev, mutSnap(cur, c => { c.src.ox = "2026-10-01T00:00:00Z"; })).reason, "stale_osm");
  assert.equal(RC.diffSnapshots(prev, mutSnap(cur, c => { c.src.of = "2026-10-01T00:00:00Z"; })).reason, "stale_osm");
  const slight = mutSnap(cur, c => { c.src.ob = "2026-10-17T05:30:00Z"; });
  assert.equal(RC.diffSnapshots(prev, slight).reason, "stale_osm");
  assert.equal(RC.diffSnapshots(prev, slight, { osmSlackMs: 15 * 60000 }).comparable, true);
  assert.equal(RC.diffSnapshots(prev, mutSnap(cur, c => { c.src.ob = ""; })).reason, "no_source_time");
  assert.equal(RC.diffSnapshots(mutSnap(prev, p => { p.src.ni = ""; }), cur).reason, "no_source_time");
  assert.equal(RC.diffSnapshots(prev, mutSnap(cur, c => { c.src.of = ""; })).reason, "no_source_time", "היה בהגשה ונעלם עכשיו");
  assert.equal(RC.diffSnapshots(mutSnap(prev, p => { p.src.of = ""; }), cur).comparable, true, "לא היה בהגשה — אין עם מה להשוות");
  assert.match(RC.sinceModel(n, {}).summary, /ישן מזה שבהגשה/);
  assert.match(RC.sinceModel(o, {}).summary, /OpenStreetMap/);
});

test("בסיס חסר/פגום/לא נתמך ← no_baseline / bad_baseline / baseline_unsupported; נוכחי פגום ← bad_current", () => {
  const { prev, cur } = scenario(null);
  assert.equal(RC.diffSnapshots(null, cur).reason, "no_baseline"); assert.equal(RC.diffSnapshots(undefined, cur).reason, "no_baseline");
  assert.equal(RC.diffSnapshots(mutSnap(prev, p => { p.v = 3; }), cur).reason, "baseline_unsupported");   // גרסה 2 = תמונת מצב של נתיב (נתמכת); 3 — עתידית
  assert.equal(RC.diffSnapshots(mutSnap(prev, p => { delete p.v; }), cur).reason, "baseline_unsupported");
  for (const bad of ["x", 5, [], true, {}, { v: 1 }]) assert.equal(RC.diffSnapshots(bad, cur).comparable, false, JSON.stringify(bad));
  assert.equal(RC.diffSnapshots(mutSnap(prev, p => { p.items[0].d = "5"; }), cur).reason, "bad_baseline");
  assert.equal(RC.diffSnapshots(mutSnap(prev, p => { p.items.push(p.items[0]); }), cur).reason, "bad_baseline", "מפתח כפול");
  assert.equal(RC.diffSnapshots(mutSnap(prev, p => { p.notams.hits[0].h = "ZZ"; }), cur).reason, "bad_baseline");
  assert.equal(RC.diffSnapshots(mutSnap(prev, p => { delete p.zones; }), cur).reason, "bad_baseline");
  assert.equal(RC.diffSnapshots(prev, mutSnap(cur, c => { c.scan.lat = "x"; })).reason, "bad_current");
  assert.equal(RC.diffSnapshots(prev, null).reason, "bad_current");
  assert.equal(RC.sinceModel(RC.diffSnapshots(null, cur), {}).summary, RC.STR.noBase);
  assert.equal(RC.sinceModel(RC.diffSnapshots(null, cur), {}).kind, "nobase");
});

test("תמונת מצב עוינת: זיהום אב-טיפוס, מפתחות לא מוכרים, מבנים ענקיים, Infinity — נדחית/מנוקה בלי זליגה", () => {
  const { prev } = scenario(null);
  const polluted = JSON.parse(JSON.stringify(prev).replace('"v":1', '"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted2":1}},"v":1').replace('"th":{', '"th":{"__proto__":0,"x":1,'));
  const r = RC.cleanSnapshot(polluted);
  assert.equal(r.ok, true); assert.equal(({}).polluted, undefined); assert.equal(({}).polluted2, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(r.snapshot, "constructor"), false); assert.equal(Object.prototype.hasOwnProperty.call(r.snapshot.th, "x"), false);
  assert.ok(Object.keys(r.snapshot.th).every(k => RC.SCAN_TH.includes(k) || /^bd\./.test(k)));
  const big = mutSnap(prev, p => { p.items = Array.from({ length: 401 }, (_, i) => Object.assign({}, p.items[0], { k: "k" + i })); });
  assert.equal(RC.cleanSnapshot(big).ok, false);
  const inf = JSON.parse(JSON.stringify(prev).replace('"R":200', '"R":1e999'));
  assert.equal(RC.cleanSnapshot(inf).ok, false, "Infinity");
  const long = mutSnap(prev, p => { p.notams.hits[0].x = "<b>\u202e\u0000א" + "ב".repeat(5000); });
  const lc = RC.cleanSnapshot(long);
  assert.equal(lc.ok, true); assert.equal(lc.snapshot.notams.hits[0].x, "<b>א" + "ב".repeat(96), "נוקה מכיווניות/בקרה ונחתך ל-100");
  assert.equal(RC.cleanSnapshot(mutSnap(prev, p => { p.items[0].z = "x"; })).ok, false);
  assert.equal(RC.cleanSnapshot(mutSnap(prev, p => { p.at = "לא תאריך"; })).ok, false);
});

test("רשימה שנחתכה (capped) ← השוואת פריטים חלקית: לא מדווחים 'נעלם' על פריטים שמעבר לחיתוך", () => {
  const many = Array.from({ length: 450 }, (_, i) => tower(9100000 + i, ((i * 37) % 900) - 450, ((i * 91) % 900) - 450, { name: "תורן " + i }));
  const d = withElements(many)(baseData()), prev = snapOf(d, 1000);
  assert.equal(prev.capped.items > 0, true);
  const maxD = prev.items[prev.items.length - 1].d;
  const cur = RC.snapshotOf(analyze(fresher(d), 1000, t2), fresher(d), cfg, t2);
  const diff = RC.diffSnapshots(prev, cur);
  assert.equal(diff.counts.total, 0); assert.equal(diff.reliability.items, "capped");
  const dropped = mutSnap(cur, c => { c.items = c.items.filter(i => i.d > maxD - 1 || i.d < 50); });
  assert.ok(RC.diffSnapshots(prev, dropped).items.rows.every(r => r.d < maxD), "אין שורות בקצה החיתוך");
  assert.ok(RC.sinceModel(diff, {}).notes.includes(RC.STR.capped));
  // הבדיקה החוזרת קצרה מהתקרה (נמחקו 200 תורנים) ולכן כוללת פריטים רחוקים שנחתכו בהגשה: הם אינם "חדשים"
  const gone = new Set(Array.from({ length: 200 }, (_, i) => 9100000 + i));
  const d3 = fresher(withElements([], e => gone.has(e.id))(d)), c3 = RC.snapshotOf(analyze(d3, 1000, t2), d3, cfg, t2);
  assert.equal(c3.capped.items, 0, "הנוכחית לא נחתכה");
  assert.ok(c3.items.some(i => i.d >= maxD), "הנוכחית כוללת פריטים מעבר לנקודת החיתוך של ההגשה");
  const part = RC.diffSnapshots(prev, c3), expRemoved = prev.items.filter(i => gone.has(+i.k.replace("node/", "")) && i.d < maxD).length;
  assert.equal(part.items.rows.filter(r => r.cls === "added").length, 0, "אין 'חדש' בגלל חיתוך");
  assert.equal(part.items.rows.filter(r => r.cls === "removed").length, expRemoved); assert.ok(expRemoved > 20);
  assert.equal(part.reliability.items, "capped");
});

/* ==================== אימות ושחזור בקשה שמורה ==================== */
// כמו inputsForRecord ב-ui.js (שלב א׳): inputs בלי פרטי מבקש, zones/items, הצהרה — ועכשיו גם snapshot
const savedRecord = (R = 200) => {
  const d = baseData(), res = analyze(d, R), inp = {};
  Object.keys(res.inp).forEach(k => { if (!/^(req|contact|requester|participant|callsign|registration)/i.test(k)) inp[k] = res.inp[k]; });
  return JSON.parse(JSON.stringify({ savedAt: now.toISOString(), site: "אתר", version: zones.mapVersion, edition: zones.edition, declaration: { version: "1", confirmedAt: now.toISOString(), text: "הצהרה ארוכה" }, inputs: Object.assign(inp, { visitDate: "2026-10-10", visitNotes: "הערות\nשורה שנייה", knownObstacles: "עגורן, תורן" }), zones: res.zones.near.concat(res.zones.inside).map(z => ({ id: z.id, d: Math.round(z.d) })), items: res.nearScan.items.map(i => ({ n: i.n, title: i.title, d: Math.round(i.d) })), snapshot: RC.snapshotOf(res, d, cfg, now) }));
};

test("validateRecord: רשומת שלב א׳ אמיתית (עם תמונת מצב) עוברת; השדות נשמרים בדיוק; הצהרה בלי הטקסט", () => {
  const rec = savedRecord(), v = RC.validateRecord(rec, cfg);
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.equal(v.rec.inputs.lat, exp.input.lat); assert.equal(v.rec.inputs.lon, exp.input.lon); assert.equal(v.rec.inputs.radius, 200);
  assert.equal(v.rec.inputs.dateFrom, "2026-10-20"); assert.equal(v.rec.inputs.timeFrom, "17:00");
  assert.equal(v.rec.snapshotStatus, "ok"); assert.deepEqual(v.rec.snapshot, rec.snapshot);
  assert.deepEqual(v.rec.declaration, { version: "1", confirmedAt: now.toISOString() });
  assert.equal(v.rec.inputs.visitNotes, "הערות\nשורה שנייה"); assert.equal(v.rec.items.length, rec.items.length);
  const old = clone(rec); delete old.snapshot;
  assert.equal(RC.validateRecord(old, cfg).rec.snapshotStatus, "none"); assert.equal(RC.validateRecord(old, cfg).rec.snapshot, null);
});

test("validateRecord: שורש לא-אובייקט, טיפוסים שגויים ושדות חסרים ← bad_record עם שם השדה", () => {
  for (const bad of [null, undefined, [], "x", 5, true]) { const v = RC.validateRecord(bad); assert.equal(v.ok, false); assert.equal(v.reason, "bad_record"); }
  const base = savedRecord();
  const bad = (fn, field) => { const r = clone(base); fn(r); const v = RC.validateRecord(r); assert.equal(v.ok, false, field); assert.equal(v.reason, "bad_record"); assert.ok(v.errors.includes(field), field + " ב-" + v.errors.join()); };
  bad(r => { delete r.inputs; }, "inputs"); bad(r => { r.inputs = []; }, "inputs"); bad(r => { r.inputs.lat = "32.1"; }, "coord"); bad(r => { delete r.inputs.lon; }, "coord");
  bad(r => { r.inputs.aircraft = "DJI"; }, "aircraft"); bad(r => { r.inputs.aircraft = [1, 2]; }, "aircraft"); bad(r => { r.inputs.vlos = "yes"; }, "vlos");
  bad(r => { r.inputs.purpose = { a: 1 }; }, "purpose"); bad(r => { r.inputs.siteName = 5; }, "siteName"); bad(r => { r.inputs.knownObstacles = []; }, "knownObstacles");
  bad(r => { r.site = {}; }, "site"); bad(r => { r.zones = "x"; }, "zones"); bad(r => { r.items = {}; }, "items"); bad(r => { r.declaration = "x"; }, "declaration"); bad(r => { r.savedAt = "אתמול"; }, "savedAt");
  bad(r => { r.inputs.manualItems = "x"; }, "manualItems");
});

test("validateRecord: מספרים עוינים — Infinity (1e999), מחוץ לתחום, שלילי, 0 — נדחים; תאריכים ושעות לא הגיוניים נדחים", () => {
  const base = JSON.stringify(savedRecord());
  const parse = (from, to) => JSON.parse(base.replace(from, to));
  const err = (r, f) => { const v = RC.validateRecord(r); assert.equal(v.ok, false); assert.ok(v.errors.includes(f), v.errors.join() + " ≠ " + f); };
  err(parse('"radius":200', '"radius":1e999'), "radius"); err(parse('"radius":200', '"radius":0'), "radius"); err(parse('"radius":200', '"radius":99999'), "radius"); err(parse('"radius":200', '"radius":-5'), "radius");
  err(parse('"heightM":80', '"heightM":-1'), "heightM"); err(parse('"heightM":80', '"heightM":0'), "heightM"); err(parse('"heightM":80', '"heightM":1e999'), "heightM"); err(parse('"heightM":80', '"heightM":99999'), "heightM");
  err(parse('"lat":32.099128', '"lat":-1e999'), "coord"); err(parse('"lat":32.099128', '"lat":40'), "coord"); err(parse('"lon":34.816617', '"lon":0'), "coord");
  err(parse('"dateFrom":"2026-10-20"', '"dateFrom":"2026-02-30"'), "dateFrom"); err(parse('"dateFrom":"2026-10-20"', '"dateFrom":"2026-13-01"'), "dateFrom");
  err(parse('"dateFrom":"2026-10-20"', '"dateFrom":"9999-01-01"'), "dateFrom"); err(parse('"dateFrom":"2026-10-20"', '"dateFrom":"20.10.2026"'), "dateFrom");
  err(parse('"dateTo":"2026-10-23"', '"dateTo":"2026-10-19"'), "dateTo"); err(parse('"dateTo":"2026-10-23"', '"dateTo":"2027-10-23"'), "dateTo");
  err(parse('"timeFrom":"17:00"', '"timeFrom":"24:00"'), "timeFrom"); err(parse('"timeTo":"20:00"', '"timeTo":"12:60"'), "timeTo"); err(parse('"timeTo":"20:00"', '"timeTo":"8pm"'), "timeTo");
  err(parse('"visitDate":"2026-10-10"', '"visitDate":"2026-99-99"'), "visitDate");
  assert.equal(RC.validateRecord(parse('"timeFrom":"17:00"', '"timeFrom":"7:05"')).rec.inputs.timeFrom, "07:05", "שעה חד-ספרתית מנורמלת");
});

test("validateRecord: מפתחות לא מוכרים נזרקים; __proto__/constructor לא מזהמים ולא עוברים", () => {
  const raw = JSON.stringify(savedRecord()).replace(/^\{/, '{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"p2":1}},"requesterName":"סודי","parties":{"x":1},"extra":[1],')
    .replace('"inputs":{', '"inputs":{"__proto__":{"polluted3":1},"requesterPhone":"050","contacts":[1],"zzz":1,');
  const v = RC.validateRecord(JSON.parse(raw));
  assert.equal(v.ok, true);
  assert.equal(({}).polluted, undefined); assert.equal(({}).p2, undefined); assert.equal(({}).polluted3, undefined);
  assert.deepEqual(Object.keys(v.rec).sort(), ["declaration", "edition", "inputs", "items", "savedAt", "site", "snapshot", "snapshotStatus", "trimmed", "version", "zones"]);
  assert.deepEqual(Object.keys(v.rec.inputs).sort(), ["aircraft", "dateFrom", "dateTo", "heightM", "knownObstacles", "lat", "lon", "manualItems", "purpose", "radius", "siteName", "timeFrom", "timeTo", "visitDate", "visitNotes", "vlos"]);
  assert.ok(!JSON.stringify(v).includes("סודי") && !JSON.stringify(v).includes("050"));
  const r = RC.restoreInputs(JSON.parse(raw));
  assert.deepEqual(Object.keys(r).sort(), ["aircraft", "dateFrom", "dateTo", "heightM", "knownObstacles", "lat", "lon", "manualItems", "purpose", "radius", "siteName", "timeFrom", "timeTo", "visitDate", "visitNotes", "vlos"]);
});

test("validateRecord: טקסט עוין מנוקה (בקרה, כיווניות, חצאי סרוגייט), נחתך לתקרה ומסומן; HTML נשאר טקסט (הקידוד בתצוגה)", () => {
  const r = savedRecord();
  r.inputs.siteName = "\u0000א\u202eב\u200f\ud800ג\u2028ד<script>alert(1)</script>" + "x".repeat(500);
  r.inputs.visitNotes = "שורה1\r\nשורה2\u0007\n\n\n\n\nשורה3" + "ש".repeat(4000);
  r.inputs.aircraft = Array.from({ length: 30 }, (_, i) => "כלי " + i + "\u0000" + "ק".repeat(100));
  const v = RC.validateRecord(r);
  assert.equal(v.ok, true);
  const i = v.rec.inputs;
  assert.ok(i.siteName.startsWith("אבגד<script>"), JSON.stringify(i.siteName.slice(0, 20))); assert.ok(Array.from(i.siteName).length <= 120);
  assert.ok(!/[\u0000-\u0008\u202e\u200f\u2028\ud800]/.test(i.siteName));
  assert.ok(i.visitNotes.startsWith("שורה1\nשורה2\n\nשורה3") && Array.from(i.visitNotes).length <= 3000, JSON.stringify(i.visitNotes.slice(0, 30)));
  assert.equal(i.aircraft.length, 20); assert.ok(i.aircraft.every(a => Array.from(a).length <= 60));
  assert.ok(v.rec.trimmed.includes("aircraft") && v.rec.trimmed.includes("visitNotes") && v.rec.trimmed.includes("siteName"));
});

test("קלט עוין: מאפיינים מורשים (Object.prototype מזוהם) אינם נקראים כשדות של הרשומה או של תמונת המצב", () => {
  const def = (k, v) => Object.defineProperty(Object.prototype, k, { value: v, configurable: true, writable: true, enumerable: false });
  const rec = savedRecord(); delete rec.inputs.lat; delete rec.snapshot.scan;
  const snapNoV = clone(rec.snapshot); delete snapNoV.v;
  try {
    def("lat", 32.1); def("v", 1); def("scan", { lat: 1, lon: 2, R: 3, ft: 4, wf: 5, wt: 6 });
    assert.equal(RC.validateRecord(rec).ok, false, "lat מורש לא משלים");
    assert.equal(RC.cleanSnapshot(snapNoV).ok, false, "v מורש לא משלים");
    assert.equal(RC.restoreInputs(rec), null);
  } finally { delete Object.prototype.lat; delete Object.prototype.v; delete Object.prototype.scan; }
  assert.equal(({}).lat, undefined);
});

test("validateRecord: רשומה גדולה מדי ← too_big; מעגלית/לא ניתנת לסריאליזציה ← bad_record", () => {
  const r = savedRecord(); r.junk = "x".repeat(RC.LIMITS.record + 10);
  assert.equal(RC.validateRecord(r).reason, "too_big");
  const cyc = savedRecord(); cyc.self = cyc;
  assert.equal(RC.validateRecord(cyc).reason, "bad_record");
});

test("validateRecord: פריטים ידניים — תקינים נשמרים; פגומים/יותר מ-50 ← שגיאה (משפיעים על הסריקה, לא נחתכים בשקט)", () => {
  const ok = savedRecord(); ok.inputs.manualItems = [{ name: " עגורן\u0000 ", lat: 32.1, lon: 34.8, heightM: 30 }, { name: "תורן", lat: 32.1, lon: 34.8, heightM: null }, { name: "בלי גובה", lat: 32.1, lon: 34.8 }];
  const v = RC.validateRecord(ok); assert.equal(v.ok, true);
  assert.deepEqual(v.rec.inputs.manualItems.map(m => [m.name, m.heightM]), [["עגורן", 30], ["תורן", null], ["בלי גובה", null]]);
  for (const m of [{ name: "", lat: 32, lon: 34.8 }, { name: "x", lat: "32", lon: 34.8 }, { name: "x", lat: 50, lon: 34.8 }, { name: "x", lat: 32, lon: 34.8, heightM: -3 }, { name: "x", lat: 32, lon: 34.8, heightM: "5" }, 5, null, { name: 5, lat: 32, lon: 34.8 }]) {
    const r = savedRecord(); r.inputs.manualItems = [m]; assert.equal(RC.validateRecord(r).ok, false, JSON.stringify(m));
  }
  const many = savedRecord(); many.inputs.manualItems = Array.from({ length: 51 }, (_, i) => ({ name: "n" + i, lat: 32.1, lon: 34.8 }));
  assert.equal(RC.validateRecord(many).ok, false);
  many.inputs.manualItems.length = 50; assert.equal(RC.validateRecord(many).ok, true);
});

test("validateRecord: תמונת מצב פגומה/לא נתמכת בתוך רשומה תקינה ← הרשומה נקלטת בלי בסיס השוואה (סטטוס)", () => {
  const r = savedRecord(); r.snapshot.items[0].d = "x";
  const v = RC.validateRecord(r); assert.equal(v.ok, true); assert.equal(v.rec.snapshot, null); assert.equal(v.rec.snapshotStatus, "invalid");
  const r2 = savedRecord(); r2.snapshot.v = 3;
  assert.equal(RC.validateRecord(r2).rec.snapshotStatus, "unsupported");
  const r3 = savedRecord(); r3.snapshot = "x";
  assert.equal(RC.validateRecord(r3).rec.snapshotStatus, "invalid");
});

test("restoreInputs: תאריכים ושעות (ותאריך סיור) מנוקים כברירת מחדל, keepDates מחזיר; נ״צ בדיוק; רק מפתחות מותרים", () => {
  const rec = savedRecord();
  const a = RC.restoreInputs(rec), b = RC.restoreInputs(rec, { keepDates: true });
  assert.deepEqual([a.dateFrom, a.dateTo, a.timeFrom, a.timeTo, a.visitDate], ["", "", "", "", ""]);
  assert.deepEqual([b.dateFrom, b.dateTo, b.timeFrom, b.timeTo, b.visitDate], ["2026-10-20", "2026-10-23", "17:00", "20:00", "2026-10-10"]);
  assert.equal(a.lat, 32.099128); assert.equal(a.lon, 34.816617); assert.equal(a.radius, 200); assert.equal(a.heightM, 80);
  assert.equal(a.purpose, cfg.purposes[0]); assert.deepEqual(a.aircraft, [cfg.aircraft[0]]); assert.equal(a.vlos, true);
  assert.equal(a.visitNotes, "הערות\nשורה שנייה"); assert.equal(a.knownObstacles, "עגורן, תורן");
  assert.ok(!("requesterName" in a) && !("contacts" in a) && !("participants" in a));
  rec.inputs.lat = 32.123456789; rec.inputs.lon = 34.987654321;
  assert.equal(RC.restoreInputs(rec).lat, 32.123456789, "לא מעגלים");
  assert.equal(RC.restoreInputs(rec).lon, 34.987654321);
});

test("restoreInputs: מספרים נחתכים לטווח; נ״צ פגום/מחוץ לתחום או רדיוס/גובה חסרים ← null; לא זורק על קלט עוין", () => {
  const rec = savedRecord();
  rec.inputs.radius = 99999; rec.inputs.heightM = 1e6; assert.equal(RC.restoreInputs(rec).radius, 5000); assert.equal(RC.restoreInputs(rec).heightM, 20000);
  rec.inputs.radius = 1; assert.equal(RC.restoreInputs(rec).radius, 10);
  assert.equal(RC.restoreInputs(rec, { cfg: { defaults: { min_radius_m: 50, max_radius_m: 800 } } }).radius, 50);
  rec.inputs.radius = 200.6; assert.equal(RC.restoreInputs(rec).radius, 200.6, "בתוך הטווח — לא משנים");
  for (const mut of [r => { r.inputs.lat = 50; }, r => { r.inputs.lat = "x"; }, r => { delete r.inputs.lon; }, r => { r.inputs.radius = "x"; }, r => { r.inputs.heightM = -4; }, r => { r.inputs.manualItems = [5]; }, r => { r.inputs.aircraft = 7; }]) {
    const r = savedRecord(); mut(r); assert.equal(RC.restoreInputs(r), null);
  }
  for (const hostile of [null, undefined, 5, "x", [], {}, { inputs: null }, { inputs: [] }, { inputs: { lat: {}, lon: [] } }]) assert.equal(RC.restoreInputs(hostile), null);
  const bad = savedRecord(); bad.inputs.dateFrom = "לא תאריך"; assert.notEqual(RC.restoreInputs(bad), null, "תאריך פגום אינו חוסם כשמנקים תאריכים");
  assert.equal(RC.restoreInputs(bad, { keepDates: true }), null, "אבל חוסם כש-keepDates");
});

/* ==================== תצוגות ו-HTML מוגן ==================== */
const hostileRun = () => {
  const evil = '<img src=x onerror=alert(1)>"\'><script>alert(2)</script>&amp;';
  const { diff } = scenario(d => withElements([tower(9500001, 20, 0, { name: evil })])(withNotams([mkNotam("A9999/26", { heb: evil })])(withZones(zs => zs.map(z => z.id === "LLU20" ? Object.assign({}, z, { name: evil, alt: evil }) : z).concat([mkZone("LLP999", { name: evil })]))(d))));
  return { evil, diff };
};

test("HTML: כל מחרוזת דינמית (שם נוטם/אזור/OSM) מוגנת — אין תגיות או מאפיינים חיים", () => {
  const { diff } = hostileRun();
  const html = RC.sinceHtml(RC.sinceModel(diff, { sentAt: "2026-10-18T11:05:00Z", checkedAt: +t2 }));
  assert.ok(diff.counts.total >= 4);
  assert.ok(!html.includes("<img") && !html.includes("<script"), "אין תגית חיה");
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;") && html.includes("&lt;script&gt;alert(2)&lt;/script&gt;") && html.includes("&quot;&#39;&gt;"));
  assert.ok(html.includes("&amp;amp;"), "גם & מקודד");
  // מבנה: כל התגיות שבפלט הן מרשימה סגורה, ובלי מאפייני אירועים
  const tags = new Set([...html.matchAll(/<\/?([a-z0-9]+)/gi)].map(m => m[1].toLowerCase()));
  const allowed = ["b", "br", "caption", "details", "div", "h3", "h4", "p", "section", "span", "summary", "table", "tbody", "td", "th", "thead", "tr"];
  assert.ok([...tags].every(t => allowed.includes(t)), [...tags].join());
  assert.ok(!/<[a-z][^>]*\son[a-z]+\s*=/i.test(html), "אין מאפיין אירוע");
});

test("HTML: מאפיין בתוך תא נשאר סגור (data-sev מגיע מרשימה סגורה, מרכאות וגרש בתוכן מקודדים)", () => {
  const { diff } = hostileRun();
  const m = RC.sinceModel(diff, {}), html = RC.sinceHtml(m);
  [...html.matchAll(/data-sev="([^"]*)"/g)].forEach(x => assert.ok(["high", "mid", "low"].includes(x[1])));
  const hostileModel = Object.assign({}, m, { title: '"><img src=x>', banner: { text: "<b>x</b>", sub: "'", resend: "<i>" }, summary: "</p><script>", dates: [{ label: "<", value: ">" }], notes: ["<u>"], sources: [{ label: "<", before: "<", after: "<", changed: true }] });
  const h2 = RC.sinceHtml(hostileModel);
  assert.ok(!h2.includes("<img") && !h2.includes("<script") && !h2.includes("<u>") && !h2.includes("<i>"));
  assert.equal(RC.sinceHtml(null), ""); assert.equal(RC.sinceHtml(5), ""); assert.equal(RC.requestHtml(null), "");
  // מודל שגוי/חלקי/עוין לא זורק ולא מחדיר HTML
  for (const weird of [{}, { sections: [null, {}, { rows: [null, { lines: "x" }], total: "<img src=x onerror=1>", rest: 5 }], dates: [null], sources: [null, 5], notes: "x", banner: null }]) {
    const out = RC.sinceHtml(weird); assert.ok(typeof out === "string" && !out.includes("<img") && out.includes("דוח זה לא צורף לבקשה שנשלחה למודיעין טיס"), out.slice(0, 200));
  }
  for (const weird of [{ ok: true }, { ok: true, rows: [null, { label: "<i>" }], manual: "x", zones: [{}], items: 5 }, {}]) assert.ok(!RC.requestHtml(weird).includes("<i>"));
});

test("סעיף השינויים: באנר בולט עם התאריך, שורת תאריכים, סיכום ממוספר עם חומרה גבוהה, טבלאות לפי קטגוריה ומשפט הגבלה", () => {
  const { diff } = scenario(d => withElements([tower(9500001, 20, 0, { name: "תורן חדש" })])(withNotams([mkNotam("A9999/26")], ["C0431/26"])(d)));
  const m = RC.sinceModel(diff, { sentAt: "2026-10-18T11:05:00Z", checkedAt: "2026-10-24T06:12:00Z", activity: { dateFrom: "2026-10-26", dateTo: "2026-10-26", timeFrom: "17:00", timeTo: "20:00" } });
  assert.equal(m.kind, "changes"); assert.equal(m.title, "שינויים מאז ההגשה");
  assert.equal(m.banner.text, "דוח זה לא צורף לבקשה שנשלחה למודיעין טיס ב-18.10.2026.");
  assert.ok(m.banner.text.startsWith(RC.STR.banner));
  assert.deepEqual(m.dates.map(d => d.label + ":" + d.value), ["הוגשה:18.10.2026 14:05", "נבדקה מחדש:24.10.2026 09:12", "מועד הפעילות:26.10.2026 17:00–20:00"]);
  assert.equal(m.summary, "נמצאו 3 שינויים: נוטמים 2 · אזורי איסור/הגבלה 0 · מכשולים ותשתיות 1 (חומרה גבוהה: 2)");
  assert.deepEqual(m.sections.map(s => s.key), ["notams", "items"]);
  assert.equal(m.limitation, RC.STR.limit);
  const html = RC.sinceHtml(m);
  assert.ok(html.includes("דוח זה לא צורף לבקשה שנשלחה למודיעין טיס ב-18.10.2026.") && html.includes('role="status"') && html.includes('role="note"'));
  assert.ok(html.includes("חדש — פורסם אחרי ההגשה") && html.includes("חומרה גבוהה") && html.includes("A9999/26") && html.includes("תורן חדש") && html.includes(RC.STR.limit) && html.includes(RC.STR.osm));
  assert.ok(html.indexOf('role="note"') < html.indexOf('role="status"'), "הבאנר לפני הסיכום");
  const one = scenario(withNotams([mkNotam("A9999/26")]));
  assert.match(RC.sinceModel(one.diff, {}).summary, /^נמצא שינוי אחד: /);
});

test("הערת השליחה מחדש: ניטרלית (אין צורך אם אושרה / אפשר לשלוח מעודכנת) וניתנת לכיבוי; בלי מודאל/שער", () => {
  const { diff } = scenario(null);
  const on = RC.sinceHtml(RC.sinceModel(diff, { sentAt: "2026-10-18T11:05:00Z" })), off = RC.sinceHtml(RC.sinceModel(diff, { sentAt: "2026-10-18T11:05:00Z", resendNote: false }));
  assert.ok(on.includes("אין צורך לשלוח שוב") && on.includes("אפשר לשלוח בקשה מעודכנת") && on.includes("מחליפה את הקודמת"));
  assert.ok(!off.includes("אין צורך לשלוח שוב") && off.includes("דוח זה לא צורף לבקשה שנשלחה למודיעין טיס"));
  assert.ok(!/חובה|עליכם לשלוח|יש לשלוח|חייבים/.test(on), "בלי ניסוח מחייב");
  assert.ok(RC.bannerHtml("2026-10-18T11:05:00Z").includes("ב-18.10.2026") && RC.bannerHtml("2026-10-18T11:05:00Z", { resendNote: false }).indexOf("אין צורך") < 0);
  assert.equal(RC.bannerText("2026-10-18T11:05:00Z"), "דוח זה לא צורף לבקשה שנשלחה למודיעין טיס ב-18.10.2026.");
  assert.equal(RC.bannerText(undefined), "דוח זה לא צורף לבקשה שנשלחה למודיעין טיס.", "בלי תאריך — בלי 'ב-' ריק");
});

test("אין שינוי: המשפט + ספירות (נבדקו/לא השתנו) ולא טבלאות; משפט ההגבלה נשאר", () => {
  const { diff } = scenario(null, { R: 1000 });
  const m = RC.sinceModel(diff, { sentAt: "2026-10-18T11:05:00Z" });
  assert.equal(m.kind, "none"); assert.equal(m.summary, "לא נמצאו שינויים מאז ההגשה."); assert.equal(m.sections.length, 0);
  assert.match(m.checkedLine, /^נבדקו — נוטמים: 1 · אזורים: 1 · פריטים: \d+\. לא השתנו — נוטמים: 1 · אזורים: 1 · פריטים: \d+\.$/);
  const html = RC.sinceHtml(m);
  assert.ok(html.includes("לא נמצאו שינויים מאז ההגשה.") && html.includes(RC.STR.limit) && !html.includes("<h4"));
  assert.ok(!html.includes(RC.STR.osm), "הערת OpenStreetMap רק כשיש שינוי בפריטים");
  assert.ok(!/אין שינוי|מותר|אסור|בטוח/.test(m.summary + m.checkedLine), "אין הכרעה");
});

test("גלישה: מעל maxRows השורות העודפות בתוך details (מסך) ו-hidden (Word); ברירת מחדל 15", () => {
  const many = Array.from({ length: 20 }, (_, i) => mkNotam("A" + (6000 + i) + "/26", { pos: "3206" + String(10 + i) + "N0344859E" }));
  const { diff } = scenario(withNotams(many));
  const m = RC.sinceModel(diff, {});
  assert.equal(m.sections[0].total, 20); assert.equal(m.sections[0].rows.length, 15); assert.equal(m.sections[0].rest.length, 5); assert.equal(m.sections[0].hidden, 5);
  const html = RC.sinceHtml(m);
  assert.ok(html.includes("<details") && html.includes("הצג את כל השורות (5)"));
  assert.equal((html.match(/<tr data-sev/g) || []).length, 20, "כל 20 השורות בפלט (15 + 5 בתוך details)");
  const w = RC.sinceModel(diff, { maxRows: RC.LIMITS.rowsWord });
  assert.equal(w.sections[0].rows.length, 20); assert.equal(w.sections[0].hidden, 0);
  assert.equal(RC.sinceModel(diff, { maxRows: 0 }).sections[0].rows.length, 0);
  assert.equal(RC.optsFromCfg({ recheck: { rows_screen: 7 } }).rowsScreen, 7);
});

test("מצבי 'אין השוואה': ניסוח לכל סיבה; הבאנר נשאר; בלי טבלאות", () => {
  const { prev, cur } = scenario(null);
  const mk = d => RC.sinceModel(d, { sentAt: "2026-10-18T11:05:00Z" });
  const sc = mk(RC.diffSnapshots(prev, mutSnap(cur, c => { c.scan.R = 999; })));
  assert.equal(sc.kind, "blocked"); assert.match(sc.summary, /בקשה חדשה ולא בדיקה חוזרת/);
  assert.equal(mk(RC.diffSnapshots(mutSnap(prev, p => { p.v = 3; }), cur)).kind, "nobase");
  assert.match(mk(RC.diffSnapshots(mutSnap(prev, p => { p.v = 3; }), cur)).summary, /גרסה שאינה נתמכת/);
  assert.match(mk(RC.diffSnapshots(mutSnap(prev, p => { delete p.zones; }), cur)).summary, /פגומה/);
  assert.match(mk(RC.diffSnapshots(prev, mutSnap(cur, c => { c.src.ob = ""; }))).summary, /חסר מועד/);
  assert.match(mk(RC.diffSnapshots(prev, "x")).summary, /הנוכחית אינה תקינה/);
  [null, undefined, {}, { comparable: false }, { comparable: false, reason: "משהו-לא-מוכר" }].forEach(d => { const m = mk(d); assert.ok(["nobase", "blocked"].includes(m.kind)); assert.ok(m.summary.length > 10); assert.ok(m.banner.text.startsWith(RC.STR.banner)); });
  const html = RC.sinceHtml(sc);
  assert.ok(html.includes("דוח זה לא צורף לבקשה שנשלחה למודיעין טיס") && !html.includes("<table"));
});

test("'הצג בקשה': סיכום קריאה-בלבד עם פרטי הסריקה, בלי פרטי מבקש, וכל ערך מוגן", () => {
  const rec = savedRecord(), evil = '<img src=x onerror=alert(1)>"\'';
  rec.inputs.siteName = evil; rec.inputs.purpose = "<script>x</script>"; rec.inputs.knownObstacles = evil; rec.inputs.visitNotes = evil;
  rec.inputs.aircraft = [evil, "DJI"]; rec.inputs.manualItems = [{ name: evil, lat: 32.1, lon: 34.8, heightM: 20 }];
  rec.items[0].title = evil; rec.zones[0].id = evil; rec.requesterName = "סודי"; rec.inputs.requesterPhone = "050-9999999";
  const m = RC.requestModel(rec, { sentAt: "2026-10-18T11:05:00Z", name: evil });
  assert.equal(m.ok, true);
  const get = l => (m.rows.find(r => r.label === l) || {}).value;
  assert.equal(get("נקודת מרכז"), "32.099128, 34.816617"); assert.equal(get("רדיוס"), "200 מ׳"); assert.equal(get("גובה"), "80 מ׳ (262.5 רגל) מעפ״ש");
  assert.equal(get("מועד"), "20.10.2026 עד 23.10.2026 · 17:00–20:00 (שעון מקומי)"); assert.equal(get("טיסה בקשר עין (VLOS)"), "כן"); assert.equal(get("נשלחה"), "18.10.2026 14:05");
  const html = RC.requestHtml(m);
  assert.ok(!html.includes("<img") && !html.includes("<script") && html.includes("&lt;img src=x onerror=alert(1)&gt;&quot;&#39;"));
  assert.ok(!html.includes("סודי") && !html.includes("050-9999999"));
  const tags = new Set([...html.matchAll(/<\/?([a-z0-9]+)/gi)].map(x => x[1].toLowerCase()));
  assert.ok([...tags].every(t => ["section", "h3", "h4", "table", "tbody", "tr", "th", "td", "ul", "li", "p"].includes(t)), [...tags].join());
  const bad = RC.requestModel({ inputs: null });
  assert.equal(bad.ok, false); assert.match(RC.requestHtml(bad), /אינם תקינים/);
  assert.equal(RC.requestModel(null).ok, false);
});

test("אין כתובת הארגון בשום פלט (טקסטים, מודלים, HTML); תמיכה — רק אם מופיעה, מ-info@icd.org.il", () => {
  const { diff } = scenario(withNotams([mkNotam("A9999/26")]));
  const blob = JSON.stringify(RC.STR) + JSON.stringify(RC.sinceModel(diff, { sentAt: "2026-10-18T11:05:00Z" })) + RC.sinceHtml(RC.sinceModel(diff, {})) + RC.requestHtml(RC.requestModel(savedRecord())) +
    RC.updateSubjectPrefix("2026-10-18T11:05:00Z") + RC.updateBodyLine("2026-10-18T11:05:00Z") + fs.readFileSync(path.join(ROOT, "members-k38p/requests/js/recheck.js"), "utf8");
  assert.ok(!/office@icd\.org\.il/i.test(blob));
  assert.ok((blob.match(/[\w.]+@[\w.]+/g) || []).every(a => a === "info@icd.org.il" || /^(notamoffice|nofm|fpl)@/.test(a)), (blob.match(/[\w.]+@[\w.]+/g) || []).join());
});

/* ==================== נושא וגוף המייל לעדכון ==================== */
test("קידומת נושא וגוף העדכון: תאריך בשעון ישראל (לא UTC), בקיץ ובחורף; בלי תאריך — ניסוח כללי", () => {
  assert.equal(RC.updateSubjectPrefix("2026-10-18T11:05:00Z"), "[עדכון לבקשה מ-18.10.2026] ");
  assert.equal(RC.updateSubjectPrefix("2026-10-17T22:30:00Z"), "[עדכון לבקשה מ-18.10.2026] ", "01:30 בשעון ישראל (קיץ UTC+3)");
  assert.equal(RC.updateSubjectPrefix("2026-12-31T22:30:00Z"), "[עדכון לבקשה מ-01.01.2027] ", "00:30 בשעון ישראל (חורף UTC+2)");
  assert.equal(RC.updateSubjectPrefix(Date.parse("2026-03-05T10:00:00Z")), "[עדכון לבקשה מ-05.03.2026] ");
  assert.equal(RC.updateSubjectPrefix(new Date("2026-10-18T11:05:00Z")), "[עדכון לבקשה מ-18.10.2026] ");
  assert.equal(RC.updateBodyLine("2026-10-18T11:05:00Z"), "בקשה זו מחליפה את הבקשה שנשלחה ב-18.10.2026.");
  assert.ok(RC.updateBodyLine("2026-10-18T11:05:00Z").includes("בקשה זו מחליפה את הבקשה שנשלחה ב-18.10.2026"));
  for (const bad of [undefined, null, "", "לא תאריך", NaN, {}, [], 1e20]) {
    assert.equal(RC.updateSubjectPrefix(bad), "[עדכון לבקשה קודמת] ", String(bad)); assert.equal(RC.updateBodyLine(bad), "בקשה זו מחליפה את הבקשה הקודמת שנשלחה.");
  }
});

test("updateMail: קידומת בנושא, 'מצורפת בקשה מעודכנת' + משפט ההחלפה, mailto מחושב מחדש; אידמפוטנטי ולא משנה את המקור", () => {
  const res = analyze(baseData()), mail = O.mail(res, cfg), orig = JSON.stringify(mail);
  const u = RC.updateMail(mail, "2026-10-18T11:05:00Z");
  assert.equal(JSON.stringify(mail), orig, "המקור לא השתנה");
  assert.ok(u.subject.startsWith("[עדכון לבקשה מ-18.10.2026] בקשה לסגירה אווירית — "));
  assert.ok(u.body.includes("מצורפת בקשה מעודכנת לסגירה אווירית על גבי הטופס שבנספח ג׳ לפמ״ת א-11 (עדכון 1/26). בקשה זו מחליפה את הבקשה שנשלחה ב-18.10.2026."));
  assert.ok(!u.body.includes("מצורפת בקשה לסגירה"));
  assert.deepEqual(u.to, mail.to);
  assert.ok(u.mailto.includes(encodeURIComponent(u.subject)) && u.mailto.includes(encodeURIComponent("בקשה זו מחליפה")));
  assert.deepEqual(RC.updateMail(u, "2026-10-18T11:05:00Z"), u, "אידמפוטנטי");
  const re = RC.updateMail(u, "2026-11-02T11:05:00Z");
  assert.ok(re.subject.startsWith("[עדכון לבקשה מ-02.11.2026] בקשה לסגירה") && (re.subject.match(/\[/g) || []).length === 1, "קידומת אחת בלבד");
  assert.equal(mail.body.split("\n").length + 0, mail.body.split("\n").length);
  const free = RC.updateMail({ to: ["a@b"], subject: "נושא", body: "שלום רב,\n\nטקסט חופשי\nבברכה" }, "2026-10-18T11:05:00Z");
  assert.ok(free.body.includes("בקשה זו מחליפה את הבקשה שנשלחה ב-18.10.2026.") && free.body.indexOf("שלום רב") < free.body.indexOf("בקשה זו מחליפה"), free.body);
  assert.equal(free.mailto, undefined, "בלי mailto במקור — לא ממציאים");
  assert.equal(RC.updateMail({ subject: undefined, body: undefined }, undefined).subject, "[עדכון לבקשה קודמת] ");
});

/* ==================== דגלים, תאריכים, טוהר המודול ==================== */
test("דגל features.recheck: מפתח חסר = פעיל; false = כבוי; optsFromCfg בברירות מחדל וקריאה מ-config", () => {
  assert.equal(RC.enabled(undefined), true); assert.equal(RC.enabled({}), true); assert.equal(RC.enabled({ features: {} }), true); assert.equal(RC.enabled({ features: { myreq: false } }), true);
  assert.equal(RC.enabled({ features: { recheck: true } }), true); assert.equal(RC.enabled({ features: { recheck: false } }), false);
  assert.deepEqual(RC.optsFromCfg(undefined), { eps: 10, epsPct: 5, rowsScreen: 15, rowsWord: 100 });
  assert.deepEqual(RC.optsFromCfg({ recheck: { dist_eps_m: 25, dist_eps_pct: 8, rows_screen: 5, rows_word: 50 } }), { eps: 25, epsPct: 8, rowsScreen: 5, rowsWord: 50 });
  assert.equal(RC.optsFromCfg({ recheck: { dist_eps_m: "x" } }).eps, 10);
  assert.ok(!("recheck" in cfg) || typeof cfg.recheck === "object", "אם הלידר הוסיף recheck ל-config — אובייקט");
});

test("דגל כבוי (features.recheck=false): הרשומה השמורה, המייל, הסעיף והסיכום זהים לשלב א׳ — אין snapshot, אין שורת עדכון, אין פלט חדש", () => {
  const off = Object.assign({}, cfg, { features: { recheck: false } }), on = Object.assign({}, cfg, { features: { recheck: true } });
  const d = baseData(), res = analyze(d);
  const phaseA = { savedAt: now.toISOString(), site: "אתר", inputs: { lat: 1 }, zones: [], items: [] };
  assert.deepEqual(RC.capture(res, d, off, now), {});
  assert.equal(JSON.stringify(Object.assign({}, phaseA, RC.capture(res, d, off, now))), JSON.stringify(phaseA), "הרשומה זהה בייט לבייט");
  assert.equal(RC.capture(res, d, cfg, now).snapshot.v, 1, "מפתח חסר = פעיל");
  assert.deepEqual(Object.keys(RC.capture(res, d, on, now)), ["snapshot"]);
  assert.deepEqual(RC.capture(res, d, on, now).snapshot, RC.snapshotOf(res, d, on, now));
  const mail = O.mail(res, cfg), orig = JSON.stringify(mail);
  assert.equal(RC.updateMail(mail, "2026-10-18T11:05:00Z", { cfg: off }), mail, "אותו אובייקט — ללא שורה או קידומת");
  assert.equal(JSON.stringify(mail), orig); assert.ok(!mail.body.includes("מחליפה") && !mail.subject.includes("עדכון"));
  assert.notEqual(RC.updateMail(mail, "2026-10-18T11:05:00Z", { cfg: on }), mail);
  const { diff } = scenario(null);
  assert.equal(RC.sinceModel(diff, { cfg: off }), null); assert.equal(RC.sinceHtml(RC.sinceModel(diff, { cfg: off })), "");
  assert.equal(RC.requestModel(savedRecord(), { cfg: off }), null); assert.equal(RC.requestHtml(RC.requestModel(savedRecord(), { cfg: off })), "");
  assert.notEqual(RC.sinceModel(diff, { cfg: on }), null); assert.equal(RC.requestModel(savedRecord(), { cfg: on }).ok, true);
  assert.equal(RC.enabled(off), false);
});

test("capture: כשל בצילום (ניתוח חסר או חריגה מהתקרות) לא זורק — {snapshotError} קצר ומנוקה, והשמירה ממשיכה בלי תמונת מצב", () => {
  const d = baseData();
  const r = RC.capture(null, d, cfg, now);
  assert.deepEqual(Object.keys(r), ["snapshotError"]); assert.match(r.snapshotError, /ניתוח/);
  const hits = Array.from({ length: 310 }, (_, i) => mkNotam("A" + String(7000 + i) + "/26")), d2 = withNotams(hits)(baseData());
  const r2 = RC.capture(analyze(d2), d2, cfg, now);
  assert.match(r2.snapshotError, /נוטמים/); assert.ok(r2.snapshotError.length <= 120);
  const res = analyze(d); res.nearScan = null;
  assert.ok(RC.capture(res, d, cfg, now).snapshotError);
  assert.equal(RC.validateRecord(Object.assign(savedRecord(), r2, { snapshot: undefined })).rec.snapshotStatus, "none", "הרשומה עם snapshotError נקלטת בלי בסיס השוואה");
});

test("תאריכים: שעון ישראל, פורמט dd.mm.yyyy [HH:MM]; קלט פגום ← מחרוזת ריקה", () => {
  assert.equal(RC.fmtDate("2026-10-18T11:05:00Z"), "18.10.2026"); assert.equal(RC.fmtDateTime("2026-10-18T11:05:00Z"), "18.10.2026 14:05");
  assert.equal(RC.fmtDateTime("2026-12-18T11:05:00Z"), "18.12.2026 13:05", "חורף");
  assert.equal(RC.fmtDateTime("2026-10-17T21:30:00Z"), "18.10.2026 00:30", "חצות — 00 ולא 24");
  for (const b of [undefined, null, "x", NaN, {}, 1e20]) { assert.equal(RC.fmtDate(b), ""); assert.equal(RC.fmtDateTime(b), ""); }
});

test("טוהר: נטען כסקריפט דפדפן (self.ReqCore) בלי document/window/רשת, מייצא ReqRecheck בלבד ואינו משנה את הליבה והפלט; אותו פלט כמו ב-Node", () => {
  const src = fs.readFileSync(path.join(ROOT, "members-k38p/requests/js/recheck.js"), "utf8");
  assert.ok(!/\b(document|localStorage|sessionStorage|XMLHttpRequest|navigator)\b|\balert\(|\bwindow\.(document|location|localStorage|open|alert|fetch|navigator)\b|\bfetch\(|\bimport\(/.test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "אין תלות ב-DOM/רשת");
  const coreSrc = fs.readFileSync(path.join(ROOT, "members-k38p/requests/js/core.js"), "utf8");
  const sandbox = { TextEncoder, Intl, Date, Math, JSON, Object, Array, Set, Map, Error, String, Number, isFinite, encodeURIComponent, RegExp, Infinity, NaN, parseFloat, parseInt, Uint8Array, Uint32Array, DataView };
  sandbox.self = sandbox; vm.createContext(sandbox);
  vm.runInContext(coreSrc, sandbox); const keysBefore = Object.keys(sandbox.ReqCore).join();
  vm.runInContext(src, sandbox);
  assert.equal(Object.keys(sandbox.ReqCore).join(), keysBefore, "הליבה לא שונתה");
  assert.deepEqual(Object.keys(sandbox).filter(k => /^Req/.test(k)).sort(), ["ReqCore", "ReqRecheck"]);
  assert.equal(sandbox.ReqRecheck.updateSubjectPrefix("2026-10-18T11:05:00Z"), "[עדכון לבקשה מ-18.10.2026] ");
  const d = baseData(), res = analyze(d);
  assert.equal(JSON.stringify(sandbox.ReqRecheck.snapshotOf(res, d, cfg, now)), JSON.stringify(RC.snapshotOf(res, d, cfg, now)));
  const mail = JSON.stringify(O.mail(res, cfg));
  RC.updateMail(O.mail(res, cfg), now); RC.sinceHtml(RC.sinceModel(RC.diffSnapshots(null, null), {}));
  assert.equal(JSON.stringify(O.mail(res, cfg)), mail, "הפלט הקיים של המייל זהה אחרי שימוש במודול (Phase A ללא שינוי)");
});

test("טקסט המשתמש: תקצר ופשוט — אין פרטי נוהל, 'משרד נוטאם' אינו בטקסטים החדשים, המונח 'מודיעין טיס' בבאנר", () => {
  const all = JSON.stringify(RC.STR);
  assert.ok(!/נוטאם/.test(all.replace(/נוטמים|נוטם/g, ""))); assert.ok(RC.STR.banner.includes("מודיעין טיס"));
  assert.ok(RC.STR.resend.includes("מחליפה את הקודמת"));
  assert.ok(RC.updateBodyLine(now).includes("בקשה זו מחליפה את הבקשה שנשלחה ב-"));
});

/* ==================== נתיב (קו) כאזור הפעילות: רשומה שמורה, תמונת מצב v:2 והשוואה ==================== */
// נתיב סביב נקודת הירקון (קו שבור של כ-520 מ׳). inp: area במקום radius, ו-lat/lon = העוגן (core.routeInfo). הרשומה השמורה (ui.js inputsForRecord): inputs.area בלבד — בלי lat/lon/radius
const ROUTE_PTS = C.roundPts([[0, 0], [250, 80], [520, 60]].map(([x, y]) => proj.ll(x, y)));
const routeInput = (W = 60, pts = ROUTE_PTS) => { const i = Object.assign({}, baseInput(200), { area: { kind: "route", pts, halfWidth: W } }); delete i.radius; const a = C.routeInfo(pts).anchor; i.lat = a[0]; i.lon = a[1]; return i; };
const routeRes = (W = 60, d = baseData(), at = now, pts = ROUTE_PTS) => C.analyze(routeInput(W, pts), d, cfg, at);
const savedRouteRecord = (W = 60) => {
  const d = baseData(), res = routeRes(W, d), inp = {};
  Object.keys(res.inp).forEach(k => { if (!/^(req|contact|requester|participant|callsign|registration)/i.test(k)) inp[k] = res.inp[k]; });
  delete inp.lat; delete inp.lon; delete inp.radius;
  return JSON.parse(JSON.stringify({ savedAt: now.toISOString(), site: "אתר", version: zones.mapVersion, edition: zones.edition, declaration: { version: "1", confirmedAt: now.toISOString() }, inputs: Object.assign(inp, { visitDate: "2026-10-10", visitNotes: "הערות", knownObstacles: "עגורן" }), zones: res.zones.near.concat(res.zones.inside).map(z => ({ id: z.id, d: Math.round(z.d) })), items: res.nearScan.items.map(i => ({ n: i.n, title: i.title, d: Math.round(i.d) })), snapshot: RC.snapshotOf(res, d, cfg, now) }));
};

test("נתיב: תמונת מצב v:2 עם scan {k, pts, hw, ft, wf, wt} (בלי lat/lon/R); מעגל נשאר v:1 עם scan {lat, lon, R, ft, wf, wt} בדיוק כמו תמיד", () => {
  const d = baseData(), res = routeRes(60, d), s = RC.snapshotOf(res, d, cfg, now);
  assert.equal(RC.VERSION, 1); assert.equal(RC.VERSION_ROUTE, 2); assert.equal(s.v, 2);
  assert.deepEqual(Object.keys(s.scan), ["k", "pts", "hw", "ft", "wf", "wt"]); assert.equal(s.scan.k, "route"); assert.equal(s.scan.hw, 60); assert.deepEqual(s.scan.pts, ROUTE_PTS);
  assert.deepEqual(Object.keys(s).slice(0, 2), ["v", "scan"], "אותו סדר מפתחות בראש התמונה");
  assert.ok(!("lat" in s.scan) && !("R" in s.scan));
  const circle = RC.snapshotOf(analyze(d), d, cfg, now);
  assert.equal(circle.v, 1); assert.deepEqual(Object.keys(circle.scan), ["lat", "lon", "R", "ft", "wf", "wt"]);
  assert.equal(JSON.stringify(RC.snapshotOf(routeRes(60, d), d, cfg, now)), JSON.stringify(s), "דטרמיניסטי");
  assert.ok(s.items.length > 0 && s.items.every(i => i.d >= 0), "המרחקים מציר הנתיב");
  assert.ok(Buffer.byteLength(JSON.stringify(s)) <= RC.LIMITS.bytes);
});

test("נתיב: cleanSnapshot — v:2 תקין נקי ויציב; שילוב שגוי (v:2 עם scan של מעגל / v:1 עם scan של נתיב), נקודה מחוץ לתחום, פחות משתי נקודות, יותר מדי, רוחב שלילי ← malformed; v:3 ← version", () => {
  const d = baseData(), s = RC.snapshotOf(routeRes(60, d), d, cfg, now), v = RC.cleanSnapshot(s);
  assert.equal(v.ok, true); assert.equal(v.snapshot.v, 2); assert.deepEqual(v.snapshot.scan, s.scan); assert.deepEqual(RC.cleanSnapshot(v.snapshot).snapshot, v.snapshot, "אידמפוטנטי");
  const bad = fn => { const c = mutSnap(s, fn), r = RC.cleanSnapshot(c); assert.equal(r.ok, false, JSON.stringify(c.scan)); assert.equal(r.reason, "malformed"); return r; };
  bad(c => { c.scan = { lat: 32.1, lon: 34.8, R: 60, ft: 1, wf: 1, wt: 2 }; });   // v:2 עם scan של מעגל
  bad(c => { c.scan.k = "circle"; }); bad(c => { delete c.scan.k; });
  bad(c => { c.scan.pts = [c.scan.pts[0]]; }); bad(c => { c.scan.pts = []; }); bad(c => { c.scan.pts = "x"; });
  bad(c => { c.scan.pts[1] = [50, 34.8]; }); bad(c => { c.scan.pts[1] = [32.1]; }); bad(c => { c.scan.pts[1] = [32.1, "34.8"]; }); bad(c => { c.scan.pts[1] = [32.1, NaN]; });
  bad(c => { c.scan.pts = Array.from({ length: RC.LIMITS.routePts + 1 }, () => [32.1, 34.8]); });
  bad(c => { c.scan.hw = -1; }); bad(c => { c.scan.hw = "60"; }); bad(c => { delete c.scan.hw; });
  const asV1 = mutSnap(s, c => { c.v = 1; }); assert.equal(RC.cleanSnapshot(asV1).ok, false, "v:1 עם scan של נתיב"); assert.equal(RC.cleanSnapshot(asV1).reason, "malformed");
  assert.equal(RC.cleanSnapshot(mutSnap(s, c => { c.v = 3; })).reason, "version");
  assert.equal(RC.cleanSnapshot(mutSnap(snapOf(baseData()), c => { c.v = 2; })).reason, "malformed", "תמונת מעגל שסומנה v:2 — פגומה, לא נתמכת");
});

test("נתיב: diffSnapshots — אותה סריקה ניתנת להשוואה (diff.route); נקודה שזזה מעל מיקרון-מעלה / רוחב / מספר נקודות ← scan_mismatch עם השדה; מעגל מול נתיב ← area; עד מיקרון — עדיין זהה", () => {
  const d1 = baseData(), d2 = fresher(baseData()), prev = RC.snapshotOf(routeRes(60, d1), d1, cfg, now), cur = RC.snapshotOf(routeRes(60, d2, t2), d2, cfg, t2);
  const same = RC.diffSnapshots(prev, cur); assert.equal(same.comparable, true); assert.equal(same.route, true); assert.equal(same.anyChange, false, JSON.stringify(rowsOf(same).map(r => r.id)));
  assert.ok(!("route" in RC.diffSnapshots(snapOf(d1), RC.snapshotOf(analyze(d2, 200, t2), d2, cfg, t2))), "מעגל: אין מפתח route באובייקט");
  const mm = (fn, field) => { const r = RC.diffSnapshots(prev, mutSnap(cur, fn)); assert.equal(r.comparable, false, field); assert.equal(r.reason, "scan_mismatch"); assert.deepEqual(r.scanChanged, [field]); };
  mm(c => { c.scan.pts[1][0] += 1e-5; }, "route"); mm(c => { c.scan.pts[2][1] -= 1e-5; }, "route"); mm(c => { c.scan.pts.pop(); }, "route"); mm(c => { c.scan.hw = 61; }, "width"); mm(c => { c.scan.ft += 1; }, "height"); mm(c => { c.scan.wf += 1; }, "window");
  const near = RC.diffSnapshots(prev, mutSnap(cur, c => { c.scan.pts[1][0] += 5e-7; })); assert.equal(near.comparable, true, "עד מיקרון-מעלה — אותה נקודה");
  const circ = RC.snapshotOf(analyze(d2, 200, t2), d2, cfg, t2);
  assert.deepEqual(RC.diffSnapshots(prev, circ).scanChanged, ["area"]); assert.deepEqual(RC.diffSnapshots(snapOf(d1), cur).scanChanged, ["area"]);
  assert.equal(RC.diffSnapshots(prev, circ).reason, "scan_mismatch");
  // שינוי תוכן (מכשול חדש בתוך הרוחב) מתגלה כמו במעגל, והשורה והכותרת מנוסחות לנתיב
  const d3 = withElements([tower(9500009, 100, 55), tower(9500010, 100, 120)])(fresher(baseData())), after = RC.snapshotOf(routeRes(60, d3, t2), d3, cfg, t2), df = RC.diffSnapshots(prev, after);
  assert.equal(df.comparable, true); assert.ok(df.items.rows.some(r => r.status === "added"), JSON.stringify(df.counts));
  const m = RC.sinceModel(df, { sentAt: "2026-10-18T11:05:00Z" }), html = RC.sinceHtml(m);
  assert.equal(m.route, true); assert.ok(html.includes(">מרחק מהציר<") && !html.includes(">מרחק מהנקודה<"), "כותרת העמודה לנתיב");
  const lines = m.sections.flatMap(sc => sc.rows.flatMap(r => r.lines));
  assert.ok(lines.includes("בפס הכתום (עד פי 2 מהרוחב)") && lines.includes("בתוך הסגירה") && !lines.some(l => /טבעת/.test(l)), "ניסוח הפס הכתום לנתיב: " + lines.join(" | "));
  const c = RC.sinceHtml(RC.sinceModel(RC.diffSnapshots(snapOf(d1), RC.snapshotOf(analyze(d3, 200, t2), d3, cfg, t2)), {}));
  assert.ok(c.includes(">מרחק מהנקודה<") && !c.includes("מהציר"), "מעגל: הכותרת כמו תמיד");
});

test("נתיב: validateRecord / restoreInputs — הרשומה נושאת inputs.area בלבד; השחזור מחזיר area (בלי lat/lon/radius) ותאריכים רק עם keepDates; מפתחות קבועים", () => {
  const rec = savedRouteRecord(), v = RC.validateRecord(rec, cfg);
  assert.equal(v.ok, true, JSON.stringify(v)); assert.ok(!("lat" in rec.inputs) && !("lon" in rec.inputs) && !("radius" in rec.inputs) && rec.inputs.area.kind === "route");
  assert.deepEqual(Object.keys(v.rec.inputs).sort(), ["aircraft", "area", "dateFrom", "dateTo", "heightM", "knownObstacles", "manualItems", "purpose", "siteName", "timeFrom", "timeTo", "visitDate", "visitNotes", "vlos"]);
  assert.deepEqual(v.rec.inputs.area, { kind: "route", pts: ROUTE_PTS, halfWidth: 60 }); assert.equal(v.rec.snapshotStatus, "ok"); assert.equal(v.rec.snapshot.v, 2);
  const a = RC.restoreInputs(rec, { cfg }), b = RC.restoreInputs(rec, { keepDates: true, cfg });
  assert.deepEqual(Object.keys(a).sort(), ["aircraft", "area", "dateFrom", "dateTo", "heightM", "knownObstacles", "manualItems", "purpose", "siteName", "timeFrom", "timeTo", "visitDate", "visitNotes", "vlos"], "area במקום lat/lon/radius");
  assert.deepEqual(a.area, { kind: "route", pts: ROUTE_PTS, halfWidth: 60 }); assert.deepEqual([a.dateFrom, a.timeFrom, a.visitDate], ["", "", ""]); assert.deepEqual([b.dateFrom, b.dateTo, b.timeFrom, b.timeTo], ["2026-10-20", "2026-10-23", "17:00", "20:00"]);
  assert.notEqual(a.area, rec.inputs.area, "עותק נקי, לא הפניה לרשומה"); a.area.pts[0][0] = 0; assert.notEqual(rec.inputs.area.pts[0][0], 0);
  // מעגל: אותו מבנה ואותם מפתחות כמו תמיד (אין area)
  assert.ok(!("area" in RC.restoreInputs(savedRecord(), { cfg })) && "radius" in RC.restoreInputs(savedRecord(), { cfg }));
});

test("נתיב: נכשל סגור — area פגום (סוג, נקודות, תחום, מספר, רוחב) ← bad_record עם ״area״ ו-restoreInputs null; area סמכותי ואינו נופל למעגל גם כשיש lat/lon/radius; ובנוסף: רוחב נחתך בשחזור לטופס בלבד", () => {
  const mod = fn => { const r = savedRouteRecord(); fn(r.inputs); return r; };
  const cases = { "סוג": i => { i.area.kind = "circle"; }, "בלי סוג": i => { delete i.area.kind; }, "pts לא מערך": i => { i.area.pts = "x"; }, "נקודה אחת": i => { i.area.pts = [i.area.pts[0]]; }, "בלי נקודות": i => { i.area.pts = []; },
    "21 נקודות": i => { i.area.pts = Array.from({ length: 21 }, (_, k) => [32.1 + k * 0.001, 34.8]); }, "נקודה מחוץ לתחום": i => { i.area.pts[1] = [50, 34.8]; }, "נקודה לא מספרית": i => { i.area.pts[1] = [32.1, "34.8"]; }, "NaN": i => { i.area.pts[1] = [32.1, null]; },
    "נקודה בת 3 ערכים": i => { i.area.pts[1] = [32.1, 34.8, 5]; }, "נקודה לא מערך": i => { i.area.pts[1] = { lat: 32.1, lon: 34.8 }; }, "רוחב חסר": i => { delete i.area.halfWidth; }, "רוחב מחרוזת": i => { i.area.halfWidth = "60"; }, "רוחב קטן": i => { i.area.halfWidth = 5; }, "רוחב גדול": i => { i.area.halfWidth = 5000; },
    "area null": i => { i.area = null; }, "area מחרוזת": i => { i.area = "route"; }, "area מערך": i => { i.area = []; }, "נקודות כפולות": i => { i.area.pts[1] = i.area.pts[0].slice(); }, "ארוך מדי": i => { i.area.pts = [[32.1, 34.8], [32.35, 34.8]]; }, "היפוך חד": i => { i.area.pts = C.roundPts([[0, 0], [500, 0], [20, 10]].map(([x, y]) => proj.ll(x, y))); } };
  for (const [name, fn] of Object.entries(cases)) {
    const r = mod(fn), v = RC.validateRecord(r, cfg); assert.equal(v.ok, false, name); assert.equal(v.reason, "bad_record", name); assert.ok(v.errors.includes("area"), name + ": " + v.errors);
    const lenient = RC.restoreInputs(r, { cfg });
    if (name === "רוחב קטן" || name === "רוחב גדול") assert.ok(lenient && lenient.area.halfWidth === (name === "רוחב קטן" ? 10 : 1000), name + ": נחתך כמו רדיוס");
    else if (name === "נקודות כפולות" || name === "ארוך מדי" || name === "היפוך חד") assert.ok(lenient && lenient.area, name + ": שחזור לטופס מקבל (האימות המלא בהרצה)");
    else assert.equal(lenient, null, name);
  }
  // area סמכותי: lat/lon/radius שבצדו נזרקים; area פגום עם lat/lon/radius תקינים ← שגיאה, לא מעגל
  const both = savedRouteRecord(); Object.assign(both.inputs, { lat: 32.1, lon: 34.8, radius: 150 });
  const vb = RC.validateRecord(both, cfg); assert.equal(vb.ok, true); assert.ok(!("lat" in vb.rec.inputs) && !("radius" in vb.rec.inputs) && vb.rec.inputs.area);
  assert.ok(!("lat" in RC.restoreInputs(both, { cfg })) && RC.restoreInputs(both, { cfg }).area);
  both.inputs.area.kind = "x"; assert.equal(RC.validateRecord(both, cfg).ok, false); assert.equal(RC.restoreInputs(both, { cfg }), null);
  // מגבלות מההגדרות (route_max_points / טווח הרוחב) נאכפות; מפתח חסר — ברירות המחדל בקוד
  const lim = { defaults: Object.assign({}, cfg.defaults, { route_max_points: 3, route_min_half_width_m: 20, route_max_half_width_m: 100 }) };
  const four = savedRouteRecord(); four.inputs.area.pts.push(C.roundPts([proj.ll(780, 70)])[0]); assert.equal(RC.validateRecord(four, lim).ok, false); assert.equal(RC.validateRecord(four, cfg).ok, true);
  assert.equal(RC.validateRecord(savedRouteRecord(), lim).ok, true); assert.equal(RC.validateRecord(savedRouteRecord(150), lim).ok, false); assert.equal(RC.restoreInputs(savedRouteRecord(150), { cfg: lim }).area.halfWidth, 100);
  assert.equal(RC.validateRecord(savedRouteRecord(), { defaults: {} }).ok, true, "בלי מפתחות route_* בהגדרות");
});

test("נתיב: קלט עוין — area מורש מ-Object.prototype אינו נקרא ברשומת מעגל; area עם מפתחות מזוהמים נקי; גודל הרשומה נבדק כרגיל", () => {
  const def = (k, v) => Object.defineProperty(Object.prototype, k, { value: v, configurable: true, writable: true, enumerable: false });
  try {
    def("area", { kind: "route", pts: ROUTE_PTS, halfWidth: 60 });
    const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k), v = RC.validateRecord(savedRecord(), cfg); assert.equal(v.ok, true); assert.ok(!own(v.rec.inputs, "area") && own(v.rec.inputs, "radius"), "מורש לא הופך מעגל לנתיב");
    assert.ok(!own(RC.restoreInputs(savedRecord(), { cfg }), "area"));
    const rec = savedRouteRecord(); delete rec.inputs.area; assert.equal(RC.validateRecord(rec, cfg).ok, false, "בלי area ובלי lat/lon — לא משלימים מהאב-טיפוס");
  } finally { delete Object.prototype.area; }
  const r = savedRouteRecord(); r.inputs.area.__proto__ = { polluted: 1 }; r.inputs.area.extra = "x"; r.inputs.area.pts[0].extra = 1;
  const v2 = RC.validateRecord(JSON.parse(JSON.stringify(r)), cfg); assert.equal(v2.ok, true); assert.deepEqual(Object.keys(v2.rec.inputs.area), ["kind", "pts", "halfWidth"]); assert.equal(({}).polluted, undefined);
});

test("נתיב: ״הצג בקשה״ — שורות נתיב (P1..PN), אורך ורוחב מכל צד של הציר; בלי נקודת מרכז ורדיוס; הטקסט מוגן", () => {
  const m = RC.requestModel(savedRouteRecord(), { name: '<img src=x onerror=alert(1)>' }), get = l => (m.rows.find(r => r.label === l) || {}).value;
  assert.equal(m.ok, true); assert.ok(!get("נקודת מרכז") && !get("רדיוס"));
  assert.equal(get("נתיב"), ROUTE_PTS.map((q, k) => "P" + (k + 1) + ": " + q[0].toFixed(6) + ", " + q[1].toFixed(6)).join("\n"));
  assert.ok(/^0\.\d\d ק״מ$/.test(get("אורך הנתיב")), get("אורך הנתיב")); assert.equal(get("רוחב מכל צד של הציר"), "60 מ׳");
  const html = RC.requestHtml(m); assert.ok(html.includes("P1: ") && html.includes("white-space:pre-line") && !/<img/i.test(html));
  assert.equal(RC.requestModel(savedRecord()).rows.find(r => r.label === "רדיוס").value, "200 מ׳", "מעגל כמו תמיד");
});

test("נתיב: withSnapshot (ReqMyReq) — רשומת נתיב נושאת תמונת מצב v:2, ומעגל v:1; הגודל נבדק כפי שנכתב", () => {
  const MR = require(path.join(ROOT, "members-k38p/requests/js/myreq.js")), d = baseData(), rec = { savedAt: now.toISOString(), inputs: { area: { kind: "route", pts: ROUTE_PTS, halfWidth: 60 } } };
  const out = MR.withSnapshot(rec, routeRes(60, d), d, cfg, now); assert.equal(out.snapshot.v, 2); assert.equal(out.snapshot.scan.k, "route"); assert.ok(!out.snapshotError);
  assert.equal(MR.withSnapshot({ savedAt: "x", inputs: {} }, analyze(d), d, cfg, now).snapshot.v, 1);
});
