/* נתיב (קו) כאזור פעילות — גיאומטריה, ניתוח ושאילתות. המעגל נשמר בייט-בבייט (golden.test.mjs); כאן רק הנתיב. */
import test from "node:test"; import assert from "node:assert/strict"; import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url"; import { createRequire } from "node:module";
const require = createRequire(import.meta.url), ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const C = require(path.join(ROOT, "members-k38p/requests/js/core.js"));
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "members-k38p/requests/config.json"), "utf8"));
const LAT0 = 32.0991, LON0 = 34.8166, KY = 111132.92 - 559.82 * Math.cos(2 * LAT0 * Math.PI / 180), KX = 111412.84 * Math.cos(LAT0 * Math.PI / 180);
const ll = (x, y) => [LAT0 + y / KY, LON0 + x / KX];             // מטרים ממקור קבוע -> [lat,lon]
const route = (xy, W) => ({ kind: "route", pts: C.roundPts(xy.map(q => ll(q[0], q[1]))), halfWidth: W });
// אורקל עצמאי: מרחק נקודה מקו שבור במטרים (ברזל, בלי הקוד שנבדק)
const oracleD = (px, py, xy) => { let best = Infinity; for (let i = 0; i < xy.length - 1; i++) { const [ax, ay] = xy[i], [bx, by] = xy[i + 1], dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))); best = Math.min(best, Math.hypot(px - ax - t * dx, py - ay - t * dy)); } return best; };
const inRing = (px, py, ring) => { let c = false; for (let i = 0, n = ring.length - 1; i < n; i++) { const [x1, y1] = ring[i], [x2, y2] = ring[i + 1]; if ((y1 > py) !== (y2 > py) && px < ((x2 - x1) * (py - y1)) / (y2 - y1) + x1) c = !c; } return c; };
const ringXY = ring => ring.map(q => [(q[1] - LON0) * KX, (q[0] - LAT0) * KY]);

test("נתיב: אורך, תיבה ועוגן — קו ישר של 1,000 מ׳ מזרחה", () => {
  const a = route([[0, 0], [1000, 0]], 50), info = C.routeInfo(a.pts);
  assert.ok(Math.abs(info.lengthM - 1000) < 1, "אורך " + info.lengthM);
  assert.ok(Math.abs(info.anchor[1] - ll(500, 0)[1]) < 1e-5 && Math.abs(info.anchor[0] - ll(500, 0)[0]) < 1e-5, "העוגן באמצע האורך");
  const bent = route([[0, 0], [300, 0], [300, 400]], 50), ib = C.routeInfo(bent.pts);
  assert.ok(Math.abs(ib.lengthM - 700) < 1, "אורך נתיב עם פנייה " + ib.lengthM);
  assert.ok(Math.abs(oracleD(...[(ib.anchor[1] - LON0) * KX, (ib.anchor[0] - LAT0) * KY], [[0, 0], [300, 0], [300, 400]])) < 1, "העוגן על הקו");
});

test("נתיב: Proj.dPt מודד מהקו (קפסולה), ולא מהמרכז — מול אורקל עצמאי על 2,000 נקודות אקראיות", () => {
  const xy = [[0, 0], [400, 150], [700, -120], [1100, 200]], a = route(xy, 80), P = C.projFor({ area: a });
  assert.ok(P.route && P.route.length === 4);
  let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let i = 0; i < 2000; i++) {
    const x = -500 + rnd() * 2000, y = -500 + rnd() * 1000, p = P.xy(...ll(x, y));
    assert.ok(Math.abs(P.dPt(p[0], p[1]) - oracleD(x, y, xy)) < 0.6, "נקודה " + i);
  }
  assert.equal(new C.Proj(LAT0, LON0).dPt(3, 4), 5, "מעגל: מרחק מהראשית");
});

test("נתיב: ניתוח — פריט OSM במרחקים שונים מהקו: בתוך (≤W), טבעת (≤2W), קרוב; ופריט ליד קצה הקו נמדד מהקצה", () => {
  const xy = [[0, 0], [1000, 0]], a = route(xy, 100), inp = { area: a, lat: C.routeInfo(a.pts).anchor[0], lon: C.routeInfo(a.pts).anchor[1], heightM: 50, dateFrom: "2030-01-10", dateTo: "2030-01-10", timeFrom: "10:00", timeTo: "12:00" };
  const tower = (id, x, y) => { const [la, lo] = ll(x, y); return { type: "node", id, lat: la, lon: lo, tags: { man_made: "mast", name: "תורן " + id } }; };
  const near = { elements: [tower(1, 500, 60), tower(2, 500, 150), tower(3, 500, 230), tower(4, 1100, 60), tower(5, -90, 0), tower(6, 500, -99)] };
  const res = C.analyze(inp, { near, far: { elements: [] }, ext: { elements: [] }, zones: { zones: [] }, inpa: { sites: [] }, agri: { airstrips: [] }, notams: [] }, cfg, new Date("2030-01-01T08:00:00Z"));
  assert.equal(res.R, 100); assert.equal(res.area.kind, "route"); assert.ok(Math.abs(res.area.lengthM - 1000) < 1);
  const by = id => res.nearScan.items.find(i => i.ids.includes("node/" + id));
  assert.equal(by(1).zone, "in"); assert.ok(Math.abs(by(1).d - 60) < 1);
  assert.equal(by(2).zone, "ring"); assert.ok(Math.abs(by(2).d - 150) < 1);
  assert.equal(by(3), undefined, "230 מ׳ מהקו — מעבר לטבעת עד פי 2 (200) ולכן אינו מכשול רלוונטי");
  assert.equal(by(4).zone, "ring"); assert.ok(Math.abs(by(4).d - Math.hypot(100, 60)) < 1.5, "קצה הקו (פינה מעוגלת): " + by(4).d);
  assert.equal(by(5).zone, "in"); assert.ok(Math.abs(by(5).d - 90) < 1);
  assert.equal(by(6).zone, "in");
  assert.ok(res.sun.length >= 1, "שעות זריחה ושקיעה מחושבות מהעוגן");
});

test("נתיב: אזורים — מצולע שחוצה את הנתיב, מצולע שמכיל אותו, מצולע קרוב, ועיגול (LLR) לצד הקו", () => {
  const xy = [[0, 0], [800, 0], [800, 600]], a = route(xy, 50), inpa = { sites: [] };
  const sq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(q => ll(q[0], q[1]));
  const zone = (id, rings, extra) => Object.assign({ id, name: id, cat: "LLR", rings, min: "GND", max: "1000", maxunit: "AGL" }, extra || {});
  const zones = [zone("cross", [sq(300, -200, 400, 200)]), zone("contain", [sq(-5000, -5000, 5000, 5000)]), zone("near", [sq(300, 300, 400, 400)]), zone("far", [sq(3000, 3000, 3100, 3100)]),
    zone("circ", [], { rings: undefined, c: ll(400, -500), r: 400 })];
  const P = C.projFor({ area: a }), out = C.analyzeZones(P, 50, { zones, inpa }, 1000, 164, 0);
  const id = l => l.map(z => z.id).sort().join(","), dOf = (l, n) => l.find(z => z.id === n).d;
  assert.equal(id(out.inside), "contain,cross", "בתוך: מצולע שחוצה את הנתיב ומצולע שמכיל אותו (מרחק 0)");
  assert.equal(dOf(out.inside, "cross"), 0); assert.equal(dOf(out.inside, "contain"), 0);
  assert.equal(id(out.near), "circ,near", "קרוב: מצולע במרחק 300 ועיגול במרחק 100 (500 מהקו פחות רדיוס 400); האזור הרחוק לא נכלל");
  assert.ok(Math.abs(dOf(out.near, "near") - 300) < 1, "מרחק " + dOf(out.near, "near")); assert.ok(Math.abs(dOf(out.near, "circ") - 100) < 1, "עיגול " + dOf(out.near, "circ"));
  const circ = out.near.find(z => z.id === "circ"), pXY = P.xy(...circ.ll);   // הנקודה הקרובה על שפת העיגול, בכיוון הקו
  assert.ok(Math.abs(oracleD(pXY[0], pXY[1], P.route) - 100) < 1.5, "הנקודה הקרובה על שפת העיגול במרחק 100 מהקו");
});

test("נתיב: נוטמים — סגירה מעגלית ליד הקו נמדדת מהקו פחות רדיוס", () => {
  // מרכז הנוטם בדקות שלמות (ה-Q מעוגל לדקה): 32°06'N 034°49'E; הנתיב 3,000 מ׳ מדרום לו; רדיוס 001 = מייל ימי אחד (1,852 מ׳) → d≈1,148
  const cLat = 32 + 6 / 60, cLon = 34 + 49 / 60, cx = (cLon - LON0) * KX, cy = (cLat - LAT0) * KY;
  const xy = [[cx - 500, cy - 3000], [cx + 500, cy - 3000]], a = route(xy, 100), P = C.projFor({ area: a }), now = Date.parse("2030-01-10T10:00:00Z");
  const raw = "A1234/30 NOTAMN\nQ) LLLL/QRTCA/IV/NBO/W /000/025/3206N03449E001\nA) LLLL B) 3001100800 C) 3001101400\nE) TEMPORARY RESTRICTED AREA\nF) GND G) 2500FT AMSL";
  const out = C.analyzeNotams(P, 100, [{ id: "A1234/30", raw, heb: "", name: "" }], now - 3600000, now + 3600000, 164, 10000, 1000);
  const all = out.hits.concat(out.obstacles);
  assert.equal(all.length, 1, JSON.stringify(out.excluded));
  const g = all[0].geometry; assert.equal(g.kind, "circle");
  assert.ok(Math.abs(all[0].d - (3000 - 1852)) < 2, "מרחק " + all[0].d); assert.equal(all[0].relation, "near");
});

test("נתיב: טבעת — קו ישר: מלבן עם קצוות מרובעים; כל הנקודות במרחק ≤ W מהקו בתוך הטבעת (2,000 נקודות), והטבעת פשוטה", () => {
  const xy = [[0, 0], [1000, 0]], a = route(xy, 50), r = C.corridorRing(a, 1);
  assert.ok(r.simple); assert.equal(r.ring.length, 5, "ארבע פינות + סגירה");
  const rx = ringXY(r.ring);
  const xs = rx.map(q => q[0]), ys = rx.map(q => q[1]);
  assert.ok(Math.abs(Math.min(...xs) + 50) < 0.5 && Math.abs(Math.max(...xs) - 1050) < 0.5, "הקצוות מורחבים ב-W");
  assert.ok(Math.abs(Math.min(...ys) + 50) < 0.5 && Math.abs(Math.max(...ys) - 50) < 0.5);
  assert.deepEqual(r.ring[0], r.ring[r.ring.length - 1], "טבעת סגורה");
  const r2 = C.corridorRing(a, 2), ys2 = ringXY(r2.ring).map(q => q[1]);
  assert.ok(Math.abs(Math.max(...ys2) - 100) < 0.5, "טבעת ה-2W רחבה כפליים");
});

test("נתיב: טבעת בנתיב מתעקל — הקפסולה כולה בפנים (מונטה-קרלו, כולל פניות חדות וחתך הפינה ב-2W), הטבעת פשוטה", () => {
  const routes = [[[0, 0], [400, 150], [700, -120], [1100, 200]], [[0, 0], [500, 0], [500, 500]], [[0, 0], [600, 0], [650, 300], [100, 380], [-200, 800]], [[0, 0], [500, 0], [60, 90]]];
  const Ws = [30, 80, 25, 15];
  routes.forEach((xy, k) => {
    const a = route(xy, Ws[k]), r = C.corridorRing(a, 1);
    assert.ok(r.simple, "נתיב " + k + " אמור להיות פשוט");
    const rx = ringXY(r.ring); let seed = 11 + k; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    let bad = 0, n = 0;
    const segs = xy.length - 1;
    for (let i = 0; i < 6000; i++) {   // נקודה אקראית על הקו + היסט אקראי קטן מ-W: תמיד בקפסולה (ובדיקה מול האורקל), כולל סביב הקודקודים והקצוות
      const sIdx = Math.floor(rnd() * segs), t = rnd(), bx = xy[sIdx][0] + (xy[sIdx + 1][0] - xy[sIdx][0]) * t, by = xy[sIdx][1] + (xy[sIdx + 1][1] - xy[sIdx][1]) * t, ang = rnd() * 2 * Math.PI, rad = rnd() * (Ws[k] - 0.6);
      const x = bx + rad * Math.cos(ang), y = by + rad * Math.sin(ang);
      if (oracleD(x, y, xy) <= Ws[k] - 0.5) { n++; if (!inRing(x, y, rx)) bad++; }
    }
    assert.ok(n > 100, "מספיק נקודות בקפסולה: " + n); assert.equal(bad, 0, "נתיב " + k + ": נקודות בקפסולה מחוץ לטבעת");
  });
});

test("נתיב: אימות — מעט נקודות, יותר מדי, מחוץ לישראל, נקודות כפולות, ארוך מדי, רוחב מחוץ לטווח, והיפוך חד (טבעת חותכת את עצמה)", () => {
  const v = (pts, W) => C.validateRoute({ area: { kind: "route", pts, halfWidth: W } }, cfg).map(e => e.field + ":" + e.msg.slice(0, 18));
  const ok = C.roundPts([ll(0, 0), ll(500, 0)]);
  assert.deepEqual(v(ok, 50), []);
  assert.match(v([ok[0]], 50)[0], /^route:נתיב דורש/);
  assert.match(v(Array.from({ length: 21 }, (_, i) => ll(i * 30, 0)), 20)[0], /^route:נתיב: עד 20/);
  assert.match(v([[35, 34.8], [35.1, 34.9]], 50)[0], /^route:נקודה בנתיב מחוץ/);
  assert.match(v([ok[0], ok[0]], 50)[0], /^route:שתי נקודות עוקבות/);
  assert.match(v(C.roundPts([ll(0, 0), ll(26000, 0)]), 50)[0], /^route:אורך הנתיב/);
  assert.match(v(ok, 5)[0], /^halfWidth:/); assert.match(v(ok, 5000)[0], /^halfWidth:/);
  assert.match(v(C.roundPts([ll(0, 0), ll(500, 0), ll(20, 10)]), 50)[0], /^route:הנתיב חד/, "היפוך חד");
  // validateInput: בנתיב אין שגיאת נקודת מרכז/רדיוס
  const errs = C.validateInput({ area: { kind: "route", pts: ok, halfWidth: 50 }, heightM: 30, dateFrom: "2030-01-10", dateTo: "2030-01-10", timeFrom: "10:00", timeTo: "11:00" }, cfg);
  assert.ok(!errs.some(e => e.field === "coord" || e.field === "radius"), JSON.stringify(errs.map(e => e.field)));
});

test("נתיב: שאילתות Overpass — around על הקו השבור, תיבת קצה לקצה, ומעגל בלי שינוי", () => {
  const a = route([[0, 0], [500, 0], [500, 400]], 60), info = C.routeInfo(a.pts), q = C.buildQueries(info.anchor[0], info.anchor[1], 60, cfg, a);
  const pl = a.pts.map(p => p[0].toFixed(6) + "," + p[1].toFixed(6)).join(",");
  assert.ok(q.near.includes("(around:270," + pl + ")") && q.near.includes("(around:1110," + pl + ")"), "מכשולים עד 2R+150 ואתרים עד R+km");
  assert.ok(q.ext.includes("nwr(around:" + Math.ceil(120 + 1000) + "," + pl + ")[leisure=nature_reserve]") && q.ext.includes('way(r.cr)(around:' + 7060 + "," + pl + ")"));
  assert.ok(q.far.includes("is_in(" + info.anchor[0] + "," + info.anchor[1] + ")"), "שם המקום מהעוגן");
  const circ = C.buildQueries(32.0991, 34.8166, 100, cfg), same = C.buildQueries(32.0991, 34.8166, 100, cfg, undefined);
  assert.deepEqual(circ, same);
  assert.ok(circ.near.includes("(around:350,32.0991,34.8166)"));
});

test("נתיב: parseCoordList — שורה לכל נקודה, סדר הפוך מתוקן, שורות לא תקינות מדווחות", () => {
  const r = C.parseCoordList("32.0991, 34.8166\n\n34.82 32.1\nזבל\n32°05'56.86\"N 34°48'59.82\"E");
  assert.equal(r.pts.length, 3); assert.deepEqual(r.bad, [4]);
  assert.deepEqual(r.pts[1], [32.1, 34.82], "הוחלף (אורך, רוחב) → (רוחב, אורך)");
});
