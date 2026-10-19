/* תמונות המפה של נתיב (js/mapimg.js): גודל, תצוגה והתאמת זום, פריסת הציור בפיקסלים, תגיות, מקרא ותיבת הכיתוב — פונקציות טהורות, ובנוסף הרצת render על קנבס מדומה (בלי דפדפן).
   הציור עצמו (פיקסלים, אריחים) נבדק בדפדפן ב-e2e. המעגל (בלי res.area) נבדק כאן רק כשוויון לנוסחה הישנה של viewFor. */
import test from "node:test"; import assert from "node:assert/strict"; import fs from "node:fs"; import path from "node:path"; import vm from "node:vm"; import { fileURLToPath } from "node:url"; import { createRequire } from "node:module";
const require = createRequire(import.meta.url), ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const C = require(path.join(ROOT, "members-k38p/requests/js/core.js")), LY = require(path.join(ROOT, "members-k38p/requests/js/maplayers.js"));
const SRC = fs.readFileSync(path.join(ROOT, "members-k38p/requests/js/mapimg.js"), "utf8");
const J = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const cfg = J("members-k38p/requests/config.json");

// ---- טעינת mapimg.js כמו בדפדפן (self.ReqCore → self.ReqMap), וקנבס מדומה שמתעד קריאות ----
let calls = [];
const ctxStub = new Proxy({}, { get: (t, k) => (k === "measureText" ? s => ({ width: String(s).length * 7 }) : k === "getImageData" ? () => ({}) : typeof k === "symbol" ? undefined : (...a) => { calls.push([k, a]); }), set: () => true });
globalThis.self = { ReqCore: C };
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctxStub, toDataURL: () => "data:image/png;base64,AA==" }) };
globalThis.Image = class { set src(v) { setTimeout(() => this.onerror && this.onerror(), 0); } };   // כל האריחים נכשלים: מספיק כדי להריץ את הציור
vm.runInThisContext(SRC, { filename: "mapimg.js" });
const M = self.ReqMap;

/* ---- נתונים: נתיב סביב נקודה קבועה, ותוצאת ניתוח עם מכשולי OSM סינתטיים ---- */
const LAT0 = 32.0991, LON0 = 34.8166, P0 = new C.Proj(LAT0, LON0), ll = (x, y) => P0.ll(x, y);
const mkArea = (xy, W) => ({ kind: "route", pts: C.roundPts(xy.map(q => ll(q[0], q[1]))), halfWidth: W });
const inpOf = a => { const info = C.routeInfo(a.pts); return { area: a, lat: info.anchor[0], lon: info.anchor[1], heightM: 50, siteName: "אתר בדיקה", dateFrom: "2030-01-10", dateTo: "2030-01-10", timeFrom: "10:00", timeTo: "12:00" }; };
const tower = (id, x, y, tags) => { const [la, lo] = ll(x, y); return { type: "node", id, lat: la, lon: lo, tags: tags || { man_made: "mast", name: "תורן " + id } }; };
const EMPTY = { far: { elements: [] }, ext: { elements: [] }, zones: { zones: [] }, inpa: { sites: [] }, agri: { airstrips: [] }, notams: [] }, NOW = new Date("2030-01-01T08:00:00Z");
const analyzeRoute = (xy, W, towers, tags, zonesData) => C.analyze(inpOf(mkArea(xy, W)), Object.assign({ near: { elements: (towers || []).map((t, i) => tower(i + 1, t[0], t[1], tags)) } }, EMPTY, zonesData ? { zones: zonesData } : {}), cfg, NOW);
const BEND = [[-600, -200], [-200, -150], [100, 50], [400, 300], [800, 350]];
const analyzeCircle = (lat, lon, R) => C.analyze({ lat, lon, radius: R, heightM: 50, siteName: "מעגל", dateFrom: "2030-01-10", dateTo: "2030-01-10", timeFrom: "10:00", timeTo: "12:00" }, Object.assign({ near: { elements: [tower(1, 100, 80)] } }, EMPTY), cfg, NOW);
const inRect = (q, W, H) => q[0] > 24 && q[0] < W - 24 && q[1] > 96 && q[1] < H - 24;   // inView של mapimg.js
const bbPx = pts => { const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };

test("נתיב-מפה: ייצוא — הפונקציות הקיימות נשארו, ונוספו הטהורות לנתיב", () => {
  for (const k of ["render", "PROVIDERS", "worldPx", "mpp", "viewFor"]) assert.ok(k in M, k);
  for (const k of ["sizeFor", "viewProj", "routeLayout", "axisNearest", "placeBadges", "pickRect", "sampleLine", "captionSpot"]) assert.equal(typeof M[k], "function", k);
});

test("נתיב-מפה: גודל התמונה — מעגל תמיד 1280×960; נתיב מזרח-מערב רחב; נתיב צפון-דרום (יחס מעל 1.25) עומד 960×1200; opts מכריעים", () => {
  const circ = analyzeCircle(LAT0, LON0, 200);
  assert.deepEqual(M.sizeFor(circ, {}), { W: 1280, H: 960 }); assert.deepEqual(M.sizeFor(circ, undefined), { W: 1280, H: 960 });
  assert.deepEqual(M.sizeFor(circ, { width: 800, height: 600 }), { W: 800, H: 600 });
  const ew = analyzeRoute([[0, 0], [2000, 100]], 50), ns = analyzeRoute([[0, 0], [100, 3000]], 50), sq = analyzeRoute([[0, 0], [1000, 1100]], 50);
  assert.deepEqual(M.sizeFor(ew, {}), { W: 1280, H: 960 });
  assert.deepEqual(M.sizeFor(ns, {}), { W: 960, H: 1200 });
  assert.deepEqual(M.sizeFor(sq, {}), { W: 1280, H: 960 }, "כמעט ריבועי — לרוחב");
  const half = (w, h) => analyzeRoute([[0, 0], [w, h]], 10);   // הסף: גובה הטבעת מעל פי 1.25 מרוחבה (ה-2W מוסיף 20 מ׳ לכל צד)
  assert.deepEqual(M.sizeFor(half(1000, 1500), {}), { W: 960, H: 1200 }, "יחס 1.5 — עומדת"); assert.deepEqual(M.sizeFor(half(1000, 1100), {}), { W: 1280, H: 960 }, "יחס 1.1 — לרוחב");
  assert.deepEqual(M.sizeFor(half(1500, 1000), {}), { W: 1280, H: 960 }, "רחב — לרוחב");
  assert.deepEqual(M.sizeFor(ns, { width: 1280, height: 960 }), { W: 1280, H: 960 }, "גודל מפורש מכריע");
  assert.deepEqual(M.sizeFor(ns, { width: 640 }), { W: 640, H: 960 }, "רק רוחב מפורש: הגובה כברירת המחדל הקיימת");
});

test("נתיב-מפה: viewFor למעגל — אותו זום ו-E כמו הנוסחה הישנה (אורקל עצמאי), המרכז והפיקסל במרכז הקנבס", () => {
  const mppAt = (lat, z) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, z);
  const oldView = (res, W, H, mode) => {
    let E = 2 * res.R; if (mode === "region") E = Math.max(5000, 2.5 * res.R);
    else if (mode !== "detail") { [...res.zones.inside, ...res.zones.near].forEach(z => { E = Math.max(E, Math.hypot(z.p[0], z.p[1])); }); res.nearScan.items.forEach(it => { E = Math.max(E, Math.hypot(it.p[0], it.p[1])); }); }
    E *= 1.14; for (let z = 19; z >= 3; z--) if ((E / mppAt(res.inp.lat, z)) * 2 <= Math.min(W, H) - 20) return { z, E }; return { z: 3, E };
  };
  for (const R of [30, 200, 1500, 4000]) for (const mode of ["detail", "overview", "region"]) {
    const res = analyzeCircle(LAT0, LON0, R), v = M.viewFor(res, 1280, 960, mode), o = oldView(res, 1280, 960, mode);
    assert.equal(v.z, o.z, R + "/" + mode); assert.equal(v.E, o.E);
    assert.deepEqual([v.cLat, v.cLon, v.ox, v.oy], [LAT0, LON0, 640, 480]);
  }
});

test("נתיב-מפה: תקריב — טבעת ה-2W נכנסת למלבן ההתאמה עם שוליים 14%, זום אחד קרוב יותר כבר לא נכנס, והיא ממורכזת בפיקסל (W/2, H/2+36)", () => {
  for (const [xy, Wd] of [[BEND, 50], [[[0, 0], [100, 3000]], 100], [[[0, 0], [80, 20]], 20], [[[-1500, 0], [0, 800], [1500, 0]], 1000]]) {
    const res = analyzeRoute(xy, Wd), { W, H } = M.sizeFor(res, {}), v = M.viewFor(res, W, H, "detail"), vp = M.viewProj(v);
    const ring = C.corridorRing(res.area, 2).ring, px = ring.map(q => vp.X(q[0], q[1])), b = bbPx(px);
    assert.equal(v.ox, W / 2); assert.equal(v.oy, H / 2 + 36);
    assert.ok((b[2] - b[0]) * 1.14 <= W - 48 + 1e-6 && (b[3] - b[1]) * 1.14 <= H - 120 + 1e-6, "נכנס עם שוליים: " + JSON.stringify(b));
    assert.ok(Math.abs((b[0] + b[2]) / 2 - v.ox) < 1.5 && Math.abs((b[1] + b[3]) / 2 - v.oy) < 1.5, "ממורכז: " + JSON.stringify(b));
    if (v.z < 19) { const b2 = bbPx(ring.map(q => M.viewProj(Object.assign({}, v, { z: v.z + 1 })).X(q[0], q[1]))); assert.ok((b2[2] - b2[0]) * 1.14 > W - 48 || (b2[3] - b2[1]) * 1.14 > H - 120, "זום אחד קרוב יותר חורג"); }
  }
});

test("נתיב-מפה: מבט כללי — כל אזור ופריט שבטופס (ll) בתוך אזור הציור; התקריב אינו כולל אותם", () => {
  const res = analyzeRoute(BEND, 50, [[-700, 900], [1100, -500], [200, 40], [300, 1200]], { amenity: "hospital", name: "בית חולים" });   // אתרים (עד R+1,000 מ׳ מהציר) — רחוקים מהקו
  assert.ok(res.nearScan.items.length >= 3 && res.nearScan.items.some(it => it.d > 500), "פריטים רחוקים בסריקה: " + res.nearScan.items.map(it => Math.round(it.d)));
  const { W, H } = M.sizeFor(res, {}), ov = M.viewFor(res, W, H, "overview"), de = M.viewFor(res, W, H, "detail"), vp = M.viewProj(ov);
  res.nearScan.items.forEach(it => assert.ok(inRect(vp.X(it.ll[0], it.ll[1]), W, H), "פריט " + it.n + " בתוך התמונה"));
  assert.ok(ov.z < de.z, "המבט הכללי מרוחק יותר: " + ov.z + " < " + de.z);
  const none = analyzeRoute(BEND, 50, []);
  assert.equal(M.viewFor(none, 1280, 960, "overview").z, M.viewFor(none, 1280, 960, "detail").z, "בלי פריטים ואזורים — כמו התקריב");
});

test("נתיב-מפה: מפת אזור — חצי-רוחב 5 ק״מ לפחות או פי 1.5 מחצי-הרוחב של הטבעת (לכל ציר), ממורכזת על תיבת הנקודות", () => {
  const halfM = bb => { const P = new C.Proj((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2); return [((bb[3] - bb[1]) / 2) * P.kx, ((bb[2] - bb[0]) / 2) * P.ky]; };
  const small = analyzeRoute(BEND, 50), vs = M.viewFor(small, 1280, 960, "region"), hs = halfM(vs.bb);
  assert.ok(Math.abs(hs[0] - 5000) < 2 && Math.abs(hs[1] - 5000) < 2, "נתיב קצר: 5 ק״מ לכל ציר " + hs);
  const long = analyzeRoute([[-9000, 0], [0, 3000], [9000, 0]], 50), vl = M.viewFor(long, 1280, 960, "region"), hl = halfM(vl.bb), ring = halfM(bbPxLL(C.corridorRing(long.area, 2).ring));
  assert.ok(Math.abs(hl[0] - 1.5 * ring[0]) < 3, "ציר X: פי 1.5 " + hl[0] + " vs " + 1.5 * ring[0]); assert.ok(Math.abs(hl[1] - 5000) < 2, "ציר Y: הרצפה 5 ק״מ (חצי-גובה הנתיב 1.5 ק״מ) " + hl[1]);
  const rb = long.area.bbox; assert.ok(Math.abs(vl.cLat - (rb[0] + rb[2]) / 2) < 1e-9 && Math.abs(vl.cLon - (rb[1] + rb[3]) / 2) < 1e-9, "ממורכז על תיבת הנקודות");
  function bbPxLL(r) { const a = r.map(q => q[0]), b = r.map(q => q[1]); return [Math.min(...a), Math.min(...b), Math.max(...a), Math.max(...b)]; }
});

test("נתיב-מפה: פריסה — הציר והטבעות בפיקסלים לפי התצוגה; רוחב הפס בפיקסלים הוא W×pxPerM; טבעת ה-W בתוך טבעת ה-2W", () => {
  const res = analyzeRoute([[0, 0], [1000, 0]], 60), { W, H } = M.sizeFor(res, {}), v = M.viewFor(res, W, H, "detail"), L = M.routeLayout(res, v, "detail"), vp = M.viewProj(v);
  assert.equal(L.axis.length, 2); L.axis.forEach((q, i) => { const e = vp.X(res.area.pts[i][0], res.area.pts[i][1]); assert.ok(Math.hypot(q[0] - e[0], q[1] - e[1]) < 1e-9); });
  assert.ok(!L.bands && !L.enlarged && L.ring1.length === 5 && L.ring2.length === 5, "קו ישר: מלבנים סגורים");
  const w1 = bbPx(L.ring1), w2 = bbPx(L.ring2), axy = L.axis[0][1];
  assert.ok(Math.abs((w1[3] - w1[1]) / 2 - 60 * vp.pxPerM) < 0.02 * 60 * vp.pxPerM + 0.5, "חצי-רוחב הירוק בפיקסלים: " + (w1[3] - w1[1]) / 2 + " vs " + 60 * vp.pxPerM);
  assert.ok(Math.abs((w2[3] - w2[1]) / 2 - 120 * vp.pxPerM) < 0.02 * 120 * vp.pxPerM + 0.5, "חצי-רוחב הכתום");
  assert.ok(Math.abs(L.wG - 60 * vp.pxPerM) < 1e-9 && Math.abs(L.wO - 120 * vp.pxPerM) < 1e-9, "wG/wO = W×pxPerM כשאין הגדלה: " + [L.wG, L.wO, vp.pxPerM]);
  assert.ok(w2[0] < w1[0] && w2[1] < w1[1] && w2[2] > w1[2] && w2[3] > w1[3], "ה-2W מכיל את ה-W");
  assert.ok(Math.abs((w1[1] + w1[3]) / 2 - axy) < 1, "הציר במרכז הפס");
  assert.deepEqual(L.anchor.map(Math.round), vp.X(res.area.lat, res.area.lon).map(Math.round), "העוגן: נקודת אמצע האורך");
});

test("נתיב-מפה: רוחב צר מדי לציור (בזום רחוק) — פס עבה סביב הציר ברוחב מינימלי גלוי (7/14 פיקסלים), enlarged; ברוחב גדול — פוליגונים אמיתיים", () => {
  const long = analyzeRoute([[-9000, -9000], [9000, 9000]], 30), { W, H } = M.sizeFor(long, {});
  for (const mode of ["detail", "overview", "region"]) {
    const L = M.routeLayout(long, M.viewFor(long, W, H, mode), mode);
    assert.ok(L.enlarged && L.bands && L.ring1.length === 0 && L.ring2.length === 0, mode + ": הפס מוגדל");
    assert.ok(L.wG >= 7 && L.wO >= 14 && L.wO >= 2 * L.wG - 1e-9, mode + ": רוחב מינימלי " + L.wG + "/" + L.wO);
  }
  const wide = analyzeRoute([[0, 0], [400, 0]], 100), Lw = M.routeLayout(wide, M.viewFor(wide, 1280, 960, "detail"), "detail");
  assert.ok(!Lw.enlarged && Lw.ring1.length > 0 && Lw.wG > 7);
});

test("נתיב-מפה: תגיות P1..PN — P1 ו-PN קודם; תגית חופפת הופכת לנקודה; במפת אזור רק P1 ו-PN", () => {
  const axis = [[100, 100], [300, 100], [310, 104], [320, 100], [600, 100]];   // P3 ו-P4 צמודות ל-P2 — לא נכנסות כתגיות
  const b = M.placeBadges(axis, false);
  assert.deepEqual(b.map(x => x.label), ["P1", "P2", "P3", "P4", "P5"]); assert.deepEqual(b.map(x => x.kind), ["badge", "badge", "dot", "dot", "badge"]);
  b.forEach((x, i) => assert.equal(x.i, i));
  const bad = b.filter(x => x.kind === "badge"); for (let i = 0; i < bad.length; i++) for (let j = i + 1; j < bad.length; j++) { const p = bad[i].rect, q = bad[j].rect; assert.ok(p[2] <= q[0] || q[2] <= p[0] || p[3] <= q[1] || q[3] <= p[1], "תגיות אינן חופפות"); }
  const r = M.placeBadges([[100, 100], [300, 100], [500, 100], [700, 100]], true);
  assert.deepEqual(r.map(x => x.kind), ["badge", "dot", "dot", "badge"], "מפת אזור: אמצעיות — נקודות");
  assert.deepEqual(M.placeBadges([[10, 10], [200, 10]], false).map(x => x.kind), ["badge", "badge"], "שתי נקודות");
  b.forEach(x => { assert.ok(x.rect[0] < x.x && x.rect[2] > x.x && x.rect[1] < x.y && x.rect[3] > x.y, "המלבן סביב הנקודה"); });
});

test("נתיב-מפה: pickRect — המלבן הראשון שלא מכסה את הנתיב; אם כולם מכסים — זה שמכסה הכי פחות; sampleLine צפוף מספיק", () => {
  const line = M.sampleLine([[0, 0], [100, 0], [100, 100]], 8);
  assert.deepEqual(line[0], [0, 0]); assert.deepEqual(line[line.length - 1], [100, 100]);
  for (let i = 1; i < line.length; i++) assert.ok(Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]) <= 8 + 1e-9);
  const rects = [[0, 0, 50, 50], [60, 60, 90, 90], [200, 200, 300, 300]];
  assert.equal(M.pickRect(rects, line, 10), 2, "הראשון בלי כיסוי (מרחק מהשוליים)");
  assert.equal(M.pickRect([[0, 0, 50, 50], [200, 200, 300, 300]], [[10, 10], [20, 20]], 0), 1);
  assert.equal(M.pickRect([[0, 0, 50, 50], [60, 0, 110, 50]], [[10, 10], [20, 20], [70, 10]], 0), 1, "כולם מכסים — הפחות מכסה");
  assert.equal(M.pickRect([[0, 0, 1, 1], [5, 5, 6, 6]], [[100, 100]], 0), 0, "שוויון — הראשון (ברירת מחדל)");
});

test("נתיב-מפה: axisNearest — הנקודה על ציר הנתיב הקרובה לאזור (מול אורקל עצמאי), גם בקצה הקו", () => {
  const res = analyzeRoute([[0, 0], [1000, 0], [1000, 800]], 50);
  const check = (x, y) => { const q = M.axisNearest(res, ll(x, y)), p = P0.xy(q[0], q[1]); return [p, Math.hypot(x - p[0], y - p[1])]; };
  let [p, d] = check(400, 300); assert.ok(Math.abs(p[0] - 400) < 1 && Math.abs(p[1]) < 1 && Math.abs(d - 300) < 1, "אנך לקטע הראשון");
  [p, d] = check(1300, 400); assert.ok(Math.abs(p[0] - 1000) < 1 && Math.abs(p[1] - 400) < 1 && Math.abs(d - 300) < 1, "אנך לקטע השני");
  [p, d] = check(-200, -100); assert.ok(Math.abs(p[0]) < 1 && Math.abs(p[1]) < 1, "מעבר לקצה: הקצה"); assert.ok(Math.abs(d - Math.hypot(200, 100)) < 1);
  assert.ok(res.P.route, "res.P נושא את הקו");
});

test("נתיב-מפה: captionSpot — ברירת מחדל שמאל למטה; נמנע מאלמנטים קבועים; נתיב באמצע התמונה — תיבה צרה בגובה הסמן בלי לכסות את הנתיב", () => {
  const W = 1280, H = 960, bw = 450, bh = 104, far = [[1000, 200], [1100, 250]];
  let c = M.captionSpot([1050, 220], far, bw, bh, W, H, []);
  assert.deepEqual([c.bx, c.by, c.bw], [16, H - bh - 70, bw], "הנתיב רחוק מהפינה: ברירת המחדל"); assert.ok(c.ax >= c.bx && c.ax <= c.bx + c.bw && c.ay >= c.by && c.ay <= c.by + bh, "החץ יוצא משפת התיבה");
  c = M.captionSpot([1050, 220], far, bw, bh, W, H, [[0, H - bh - 70, 500, H]]);
  assert.notDeepEqual([c.bx, c.by], [16, H - bh - 70], "מקום תפוס — מועמד אחר"); assert.equal(c.by, 84);
  // נתיב צפון-דרום באמצע תמונה עומדת: תיבה ברוחב מלא משמאל או מימין תכסה אותו
  const Wp = 960, Hp = 1200, col = []; for (let y = 490; y <= 780; y += 8) col.push([440, y]);   // תיבה ברוחב מלא (16..466) הייתה מכסה אותו
  c = M.captionSpot([440, 630], col, bw, bh, Wp, Hp, [[508, 938, 940, 1192]]);
  assert.equal(c.bw, 360, "צרה"); assert.ok(c.bx + c.bw + 8 < 440, "לא מכסה את הנתיב"); assert.ok(Math.abs(c.by + bh / 2 - 630) < bh, "בגובה הסמן");
  assert.ok(c.bx + c.bw <= Wp && c.bx >= 0);
});

/* ================= הרצת render על קנבס מדומה: שום חריגה, והטקסטים של נתיב ============================ */
const texts = () => calls.filter(c => c[0] === "fillText" || c[0] === "strokeText").map(c => String(c[1][0]));
async function renderOf(res, opts) { calls = []; const r = await M.render(res, opts); return { r, calls: calls.slice(), texts: texts() }; }
const VIEWS = [{ view: "detail", provider: "esri" }, { view: "detail", provider: "osm" }, { view: "overview", provider: "esri" }, { view: "region", provider: "esri", labels: true }];

test("נתיב-מפה: render — ארבע התמונות נבנות בלי חריגה; הקנבס בגודל sizeFor; מקרא וכותרת בניסוח נתיב, בלי ניסוח מעגל; result.area", async () => {
  const res = analyzeRoute(BEND, 50, [[-100, 80], [300, 200], [900, 600]]);
  for (const o of VIEWS) {
    const { r, texts: t } = await renderOf(res, o), z = M.sizeFor(res, o);
    assert.equal(r.area, "route"); assert.equal(r.canvas.width, z.W); assert.equal(r.canvas.height, z.H); assert.equal(r.view, o.view);
    assert.ok(t.includes("ירוק: אזור הסגירה (50 מ׳ מכל צד של הציר)"), o.view + ": שורת ירוק");
    assert.ok(t.includes("כתום: עד 100 מ׳ מציר הנתיב"), "שורת כתום");
    assert.ok(t.includes("לבן: ציר הנתיב ונקודותיו P1–P5 (לפי הסדר)"), "שורת הציר");
    assert.ok(t.some(s => /^נתיב 5 נקודות {3}· {3}1\.6 ק״מ {3}· {3}50 מ׳ מכל צד {3}· {3}גובה 50 מ׳/.test(s)), o.view + ": כותרת " + t.filter(s => /^נתיב/.test(s)));
    assert.ok(t.some(s => /^P1 32°/.test(s)), "פינה: הנקודה הראשונה");
    assert.ok(!t.some(s => /רדיוס|מעגל/.test(s)), o.view + ": אין ניסוח מעגל: " + t.filter(s => /רדיוס|מעגל/.test(s)));
    assert.ok(t.includes("P1") && t.includes("P5"), "תגיות P1 ו-P5 מצוירות");
    if (o.view === "region") { assert.ok(t.some(s => /^נתיב 5 נקודות {3}· {3}1\.6 ק״מ {3}· {3}50 מ׳ מכל צד$/.test(s)), "תיבת הכיתוב"); assert.ok(t.includes("הנתיב מוגדל לקריאות; הרוחב האמיתי 50 מ׳ מכל צד"), "הערת ההגדלה"); }
  }
});

test("נתיב-מפה: render — פוליגונים אמיתיים (evenodd לכתום) כשהרוחב גדול מספיק; פס עבה (קנבס עזר) כשהוא צר מדי", async () => {
  const wide = analyzeRoute([[0, 0], [600, 100], [900, 500]], 100), a = await renderOf(wide, { view: "detail", provider: "esri" });
  assert.ok(a.calls.some(c => c[0] === "fill" && c[1][0] === "evenodd"), "טבעת כתומה ב-evenodd"); assert.ok(!a.texts.some(s => /מוגדל לקריאות/.test(s)));
  const long = analyzeRoute([[-9000, -9000], [9000, 9000]], 30), b = await renderOf(long, { view: "detail", provider: "esri" });
  assert.ok(!b.calls.some(c => c[0] === "fill" && c[1][0] === "evenodd"), "בלי פוליגונים"); assert.ok(b.texts.includes("הנתיב מוגדל לקריאות; הרוחב האמיתי 30 מ׳ מכל צד"));
  assert.ok(b.calls.filter(c => c[0] === "drawImage").length >= 2, "הפס מורכב מקנבס עזר");
});

test("נתיב-מפה: render — מעגל (בלי res.area) נשאר כפי שהיה: ניסוח רדיוס, בלי תגיות ובלי מקרא נתיב; result.area=circle; 1280×960", async () => {
  const res = analyzeCircle(LAT0, LON0, 200);
  for (const o of VIEWS) {
    const { r, texts: t } = await renderOf(res, o);
    assert.equal(r.area, "circle"); assert.equal(r.canvas.width, 1280); assert.equal(r.canvas.height, 960);
    assert.ok(t.includes("ירוק: אזור הסגירה (0–200 מ׳)") && t.includes("כתום: עד 400 מ׳"), "מקרא המעגל");
    assert.ok(t.some(s => /^רדיוס 200 מ׳ {3}· {3}גובה 50 מ׳/.test(s)), "כותרת המעגל");
    assert.ok(!t.some(s => /ציר הנתיב|^P1/.test(s)), "בלי נתיב");
  }
});

test("נתיב-מפה: render — קו המרחק לאזור איסור יוצא מהנקודה הקרובה על הציר (ולא ממרכז הקנבס); המעגל — מהמרכז", async () => {
  const sq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(q => ll(q[0], q[1]));
  const zd = { zones: [{ id: "LLR9", name: "אזור בדיקה", cat: "LLR", rings: [sq(300, 400, 400, 500)], min: "GND", max: "1000", maxunit: "AGL" }] };
  const res = analyzeRoute([[0, 0], [1000, 0]], 50, [], undefined, zd), zn = res.zones.near[0];
  assert.ok(zn && zn.d > 300 && zn.d < 500, "אזור קרוב: " + (zn && zn.d));
  const z = M.sizeFor(res, {}), v = M.viewFor(res, z.W, z.H, "overview"), vp = M.viewProj(v), want = vp.X(...M.axisNearest(res, zn.ll));
  await renderOf(res, { view: "overview", provider: "esri" });
  const i = calls.findIndex(c => c[0] === "setLineDash" && c[1][0] && c[1][0][0] === 8 && c[1][0][1] === 6), mv = calls.slice(i).find(c => c[0] === "moveTo");
  assert.ok(i >= 0 && mv, "קו מרחק מקווקו נמצא");
  assert.ok(Math.hypot(mv[1][0] - want[0], mv[1][1] - want[1]) < 1e-6, "מתחיל בנקודה על הציר: " + mv[1] + " vs " + want);
  assert.ok(Math.hypot(mv[1][0] - z.W / 2, mv[1][1] - z.H / 2) > 5, "לא ממרכז הקנבס");
});

test("נתיב-מפה: render — מקרא זז לפינה שאינה מכסה נתיב אלכסוני (ולא נשאר למטה מימין)", async () => {
  const res = analyzeRoute([[-2500, 1700], [-800, 600], [800, -600], [2500, -1700]], 60);   // מצפון-מערב לדרום-מזרח, בדיוק מעל פינת המקרא הרגילה
  const { r } = await renderOf(res, { view: "detail", provider: "esri" });
  const fr = calls.filter(c => c[0] === "fillRect" && c[1][2] === 432);   // רקע המקרא: 432 רוחב
  assert.equal(fr.length, 1); const lx = fr[0][1][0], ly = fr[0][1][1], lw = 432, lh = fr[0][1][3];
  const z = M.sizeFor(res, {}), v = M.viewFor(res, z.W, z.H, "detail"), L = M.routeLayout(res, v, "detail");
  const n = L.samples.filter(q => q[0] >= lx && q[0] <= lx + lw && q[1] >= ly && q[1] <= ly + lh).length;
  assert.equal(n, 0, "המקרא לא מכסה את הנתיב: " + [lx, ly, lw, lh]); assert.ok(!(lx === z.W - 452 && ly === z.H - 8 - lh), "זז מברירת המחדל");
  assert.ok(r.canvas.width > 0);
});

test("נתיב-מפה: מבנה — אין רצפי unicode-escape ב-mapimg.js, והקוד אינו קורא רדיוס/מרכז של מעגל כשיש res.area", () => {
  assert.ok(!/\\u[0-9a-fA-F]{4}/.test(SRC), "בלי \\uXXXX");
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.ok(!/new C\.Proj\(\s*(res\.)?inp\.lat/.test(code), "אין היטל מעגל סביב inp.lat/lon");
  assert.ok(!/inp\.radius/.test(code), "אין שימוש ב-inp.radius");
});

/* ================= פס הסיכום (maplayers.preview) בנתיב ================= */
test("נתיב-מפה: פס הסיכום — a.area מחשב מהציר: אזור שחוצה/קרוב/רחוק, ניסוח ״מהציר״, רוחב חסר, פחות משתי נקודות, מחוץ לישראל; המעגל בלי שינוי", () => {
  const sq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(q => ll(q[0], q[1]));
  const zone = (id, ring) => ({ id, cat: "LLP", name: id, alt: "GND – 3,000 ft AMSL", pmt: "ציטוט", pmtRef: "", rings: [ring] });
  const zonesData = { zones: [zone("ZIN", sq(450, -30, 550, 30)), zone("ZNEAR", sq(200, 400, 300, 500)), zone("ZFAR", sq(3000, 3000, 3100, 3100))] }, inpa = { sites: [] };
  const base = { zones: zonesData, inpa, notams: [], heightM: 80, dateFrom: "2030-01-10", dateTo: "2030-01-10", timeFrom: "10:00", timeTo: "12:00", thresholds: cfg.thresholds, now: NOW };
  const area = mkArea([[0, 0], [1000, 0]], 50), line = (r, k) => r.lines.find(l => l.k === k);
  const r = LY.preview(Object.assign({ area }, base));
  assert.equal(r.state, "ok"); assert.match(line(r, "inside").text, /^חפיפה ל-ZIN/); assert.ok(!/ZNEAR|ZFAR/.test(line(r, "inside").text));
  assert.match(line(r, "near").text, /ZNEAR/); assert.ok(!/ZFAR/.test(line(r, "near").text), "הרחוק לא מוצג");
  assert.match(line(r, "near").text, /מהציר\)/); assert.ok(!/מהנקודה/.test(line(r, "near").text), "ניסוח נתיב");
  assert.ok(!line(r, "radius"), "רוחב תקין — אין אזהרה");
  const nr = line(LY.preview(Object.assign({ area: Object.assign({}, area, { halfWidth: NaN }) }, base)), "radius"); assert.ok(nr && /רוחב/.test(nr.text) && !/רדיוס/.test(nr.text) && nr.cls === "warn");
  const one = LY.preview(Object.assign({ area: Object.assign({}, area, { pts: [area.pts[0]] }) }, base)); assert.equal(one.state, "need-point"); assert.match(one.lines[0].text, /שתי נקודות/);
  const out = LY.preview(Object.assign({ area: Object.assign({}, area, { pts: [[40, 34.8], [40.1, 34.9]] }) }, base)); assert.equal(out.state, "need-point"); assert.match(out.lines[0].text, /מחוץ לתחום/);
  // מעגל: אותו ניסוח כמו תמיד, ו-a.area שאינו נתיב אינו משנה
  const c = LY.preview(Object.assign({ lat: LAT0, lon: LON0, radius: 100 }, base)); assert.match(line(c, "near").text, /ZNEAR.*מהנקודה\)/); assert.ok(!/מהציר/.test(line(c, "near").text));
  const none = LY.preview(Object.assign({ lat: undefined, lon: undefined, radius: 100 }, base)); assert.equal(none.state, "need-point"); assert.equal(none.lines[0].text, "בחרו נקודה במפה");
  const rad = LY.preview(Object.assign({ lat: LAT0, lon: LON0, radius: NaN }, base)); assert.match(line(rad, "radius").text, /^לא הוזן רדיוס תקין — החישוב הוא לנקודה עצמה/);
});
