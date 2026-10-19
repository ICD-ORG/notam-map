/* נתיב (קו) כאזור הפעילות — הממשק והרשומות השמורות: מבנה index.html ו-ui.js (כמו בדיקות המבנה ב-core.test.mjs: ביטויים על שורות המקור), פונקציות טהורות שנשלפות מהמקור ומורצות,
   ו-ReqRecheckUI / ReqMyReq על רשומת נתיב (הכנת קלט, מפתח סריקה, השוואה, קלט נעול). המעגל נשאר בייט-בבייט (golden.test.mjs); כאן רק מה שנוסף. ההתנהגות בדפדפן נבדקת ב-e2e.mjs. */
import test from "node:test"; import assert from "node:assert/strict"; import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url"; import { createRequire } from "node:module";
const require = createRequire(import.meta.url), ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REQ = "members-k38p/requests/", rd = f => fs.readFileSync(path.join(ROOT, REQ, f), "utf8");
const C = require(path.join(ROOT, REQ, "js/core.js")), RC = require(path.join(ROOT, REQ, "js/recheck.js")), RU = require(path.join(ROOT, REQ, "js/recheckui.js")), MR = require(path.join(ROOT, REQ, "js/myreq.js"));
const cfg = JSON.parse(rd("config.json")), exp = JSON.parse(rd("selftest/expected.json")), html = rd("index.html"), ui = rd("js/ui.js");
const noComments = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const fnSrc = (name, src = ui) => { const i = src.indexOf("function " + name + "("); assert.ok(i >= 0, name); const m = /\n  \}\n/.exec(src.slice(i)); return src.slice(i, i + m.index + 4); };   // גוף פונקציה ברמת ה-IIFE (נסגרת ב-"  }" בהזחה של שני רווחים)

/* ============ index.html ============ */
test("index.html: מתג סוג האזור (רדיו, מעגל כברירת מחדל), תיבות המעגל והנתיב עם מזהים יציבים, והנתיב מוסתר כברירת מחדל", () => {
  for (const id of ["areaKindBox", "akTitle", "akCircle", "akRoute", "coordBox", "radiusBox", "hwBox", "halfWidth", "e_halfWidth", "routeBox", "routeList", "rtText", "rtApply", "e_route", "routeBar", "rtUndo", "rtClear", "rtInfo", "rtMsg", "mapTitle", "lgGreen", "lgOrange"]) assert.ok(html.includes('id="' + id + '"'), "חסר #" + id);
  assert.ok(html.includes('<input autocomplete="off" type="radio" name="areaKind" id="akCircle" value="circle" checked>') && /<input autocomplete="off" type="radio" name="areaKind" id="akRoute" value="route">/.test(html), "שני רדיו באותה קבוצה; מעגל מסומן");
  for (const id of ["hwBox", "routeBox", "routeBar"]) assert.match(html, new RegExp('id="' + id + '"[^>]*\\bhidden\\b|\\bhidden\\b[^>]*id="' + id + '"'), "#" + id + " מוסתר כברירת מחדל");
  for (const id of ["coordBox", "radiusBox"]) assert.ok(!new RegExp('id="' + id + '"[^>]*\\bhidden\\b').test(html), "#" + id + " גלוי");
  assert.match(html, /<label class="f" id="coordBox"><b>נקודת מרכז/); assert.match(html, /<label class="f" id="radiusBox"><b>רדיוס \(מטר\)/);
  assert.ok(html.includes('<input autocomplete="off" type="number" id="radius" min="10" max="5000" step="10" value="100">') && html.includes('id="coord" inputmode="decimal" placeholder="32.099128, 34.816617" autocomplete="off" dir="ltr"'), "#coord ו-#radius כמו תמיד (e2e וגם בדיקות אחרות ממלאים אותם)");
  assert.match(html, /<input autocomplete="off" type="number" id="halfWidth" min="10" max="1000" step="10" value="50">/, "ברירות מחדל ב-HTML = ההגדרות (ui.js מחליף לפי config.json)");
  const main = html.slice(html.indexOf("<main"), html.indexOf("</main>")), ctl = main.match(/<(input|textarea|select)\b[^>]*>/g) || [];
  assert.deepEqual(ctl.filter(t => !/\bautocomplete="off"/.test(t)), [], "כל בקר (גם החדשים) עם autocomplete=off");
});

test("index.html: כותרת המפה והמקרא — נוסח המעגל בדיוק כמו תמיד (עם מזהים להחלפה), פס הכלים מעל המפה מחוץ להדפסה, ו-e_route בתוך תיבת הנתיב ליד שדות הקלט", () => {
  assert.ok(html.includes('<h2 id="mapTitle">2 · מפה — לחצו כדי לסמן את מרכז הסגירה</h2>'));
  assert.ok(html.includes('<span><i style="background:#22c55e"></i><span id="lgGreen">רדיוס הסגירה</span></span><span><i style="background:#ff9500"></i><span id="lgOrange">עד פי 2 מהרדיוס</span></span>'));
  const iBar = html.indexOf('id="routeBar"'), iMap = html.indexOf('<div id="map">'), iSum = html.indexOf('id="pointSummary"');
  assert.ok(iBar > 0 && iBar < iMap && iMap < iSum, "הפס מעל המפה"); assert.match(html, /<div id="routeBar" class="nonprint" hidden>/);
  assert.match(html, /id="rtInfo" role="status" aria-live="polite"/);
  const iBox = html.indexOf('id="routeBox"'), iErr = html.indexOf('id="e_route"');
  assert.ok(iBox > 0 && html.indexOf('id="routeList"') > iBox && html.indexOf('id="rtText"') > iBox && html.indexOf('id="rtText"') < iErr, "e_route אחרי תיבות הקלט, בתוך #routeBox (focusFirstError ממקד את השדה הראשון באותו אזור)");
  assert.ok(/\.leaflet-container\.routeMode\{cursor:crosshair !important\}/.test(html) && /\.rtPt\{/.test(html) && /#routeBox\.bad\{border:1px solid var\(--red\)/.test(html), "CSS: סמן הצלב, הסמן הממוספר ומסגרת השגיאה");
});

test("index.html: גרסאות הסקריפטים הוקפצו (ui 17, recheck 3, myreq 2, recheckui 3 לפחות — מי שכבר גלש לא יקבל JS ישן עם HTML חדש) ובלי רצפי unicode-escape", () => {
  const v = f => { const m = new RegExp('<script src="js/' + f + '\\.js\\?v=(\\d+)"></script>').exec(html); assert.ok(m, f); return +m[1]; };
  assert.ok(v("ui") >= 17 && v("recheck") >= 3 && v("myreq") >= 2 && v("recheckui") >= 3, [v("ui"), v("recheck"), v("myreq"), v("recheckui")].join());
  for (const f of ["index.html", "js/ui.js", "config.json"]) assert.ok(!new RegExp(String.fromCharCode(92) + "u[0-9a-fA-F]{4}").test(rd(f)), f);
});

/* ============ ui.js: חיווט ============ */
test("ui.js: מצב — S.areaKind (מעגל כברירת מחדל) ו-S.route.pts; readInputs מעגל נשאר האובייקט כמות שהוא, ונתיב מוחלף ב-routeShape; scanKeyOf עם שני ענפים ובו שורת המעגל כלשונה", () => {
  assert.match(ui, /driveTry: -1, saved: null, areaKind: "circle", route: \{ pts: \[\] \} \};/);
  const ri = fnSrc("readInputs");
  assert.ok(ri.includes('const inp = {\n      lat: c.lat, lon: c.lon, radius: parseFloat($("radius").value), heightM: parseFloat($("height").value),') && /\};\n    return routeMode\(\) \? routeShape\(inp\) : inp;/.test(ri), "מעגל: אותו אובייקט, בלי מפתח area (גם לא undefined)");
  const rs = fnSrc("routeShape");
  assert.ok(/k === "radius"\) o\.area = area/.test(rs) && /k === "lat"\) o\.lat = an\[0\]/.test(rs) && /k === "lon"\) o\.lon = an\[1\]/.test(rs), "area במקום radius (אותו מקום), lat/lon = העוגן");
  assert.ok(ui.includes('JSON.stringify([i.lat, i.lon, i.radius, i.heightM, i.dateFrom, i.dateTo, i.timeFrom, i.timeTo])') && /const scanKeyOf = i => \(i\.area \? JSON\.stringify\(\["route", i\.area\.pts, i\.area\.halfWidth, i\.heightM,/.test(ui), "מפתח הסריקה: הנקודות והרוחב לנתיב; שורת המעגל כלשונה");
  assert.ok(ui.includes("const scanKey = () => scanKeyOf(readInputs());") && /S\.res = res; S\.scanKey = scanKeyOf\(inp0\);/.test(ui), "הקריאות הקיימות ללא שינוי");
});

test("ui.js: פונקציות טהורות שנשלפות מהמקור — scanKeyOf (מעגל זהה למה שהיה; נתיב: נקודות ורוחב), areaKey, routeShape (סדר מפתחות, עוגן, בלי radius)", () => {
  const line = name => { const m = new RegExp("\\n  const " + name + " = [^\\n]*").exec(ui); assert.ok(m, name); return m[0]; };
  const scanKeyOf = new Function(line("scanKeyOf") + "\nreturn scanKeyOf;")(), areaKey = new Function(line("areaKey") + "\nreturn areaKey;")();
  const circ = { lat: 32.099128, lon: 34.816617, radius: 200, heightM: 80, dateFrom: "2026-10-20", dateTo: "2026-10-23", timeFrom: "17:00", timeTo: "20:00" };
  assert.equal(scanKeyOf(circ), JSON.stringify([32.099128, 34.816617, 200, 80, "2026-10-20", "2026-10-23", "17:00", "20:00"]), "מעגל: בדיוק כפי שהיה");
  const pts = [[32.0991, 34.816], [32.0995, 34.817]], route = { lat: 32.0993, lon: 34.8165, area: { kind: "route", pts, halfWidth: 50 }, heightM: 80, dateFrom: "2026-10-20", dateTo: "2026-10-23", timeFrom: "17:00", timeTo: "20:00" };
  assert.equal(scanKeyOf(route), JSON.stringify(["route", pts, 50, 80, "2026-10-20", "2026-10-23", "17:00", "20:00"]));
  const k0 = scanKeyOf(route), chg = f => scanKeyOf(Object.assign({}, route, f));
  assert.notEqual(chg({ area: { kind: "route", pts: [pts[0], [32.0995, 34.8171]], halfWidth: 50 } }), k0, "נקודה שזזה"); assert.notEqual(chg({ area: { kind: "route", pts: pts.concat([[32.1, 34.82]]), halfWidth: 50 } }), k0, "נקודה נוספת");
  assert.notEqual(chg({ area: { kind: "route", pts, halfWidth: 60 } }), k0, "רוחב"); assert.notEqual(chg({ heightM: 81 }), k0); assert.equal(chg({ lat: 1, lon: 2 }), k0, "העוגן נגזר מהנקודות — אינו חלק מהמפתח");
  assert.notEqual(k0, scanKeyOf(Object.assign({}, circ, { radius: 50 })), "מעבר סוג משנה את המפתח (הניתוח ״ישן״)");
  assert.equal(areaKey(circ), "32.099128,34.816617", "מעגל: הנקודה כמו תמיד"); assert.equal(areaKey(route), "route:" + JSON.stringify(pts), "נתיב: הנקודות בלבד (הרוחב אינו במפתח, כמו הרדיוס)");
  assert.equal(areaKey(Object.assign({}, route, { area: { kind: "route", pts, halfWidth: 999 } })), areaKey(route));
  // routeShape: area במקום radius, lat/lon = העוגן (אמצע האורך), שאר המפתחות והסדר כפי שהם
  const area = { kind: "route", pts, halfWidth: 50 }, routeShape = new Function("readArea", "C", fnSrc("routeShape") + "\nreturn routeShape;")(() => area, C);
  const o = routeShape(Object.assign({}, circ, { purpose: "p", aircraft: ["a"] }));
  assert.deepEqual(Object.keys(o), ["lat", "lon", "area", "heightM", "dateFrom", "dateTo", "timeFrom", "timeTo", "purpose", "aircraft"]); assert.ok(!("radius" in o));
  assert.deepEqual([o.lat, o.lon], C.routeInfo(pts).anchor); assert.equal(o.area, area); assert.equal(o.heightM, 80);
  const e = new Function("readArea", "C", fnSrc("routeShape") + "\nreturn routeShape;")(() => ({ kind: "route", pts: [], halfWidth: NaN }), C)(circ);
  assert.deepEqual([e.lat, e.lon], [undefined, undefined], "בלי נקודות — בלי עוגן (ולא חריגה)"); assert.ok(C.validateInput(Object.assign({}, e, { siteName: "x" }), cfg).some(x => x.field === "route"));
});

test("ui.js: המפה — לחיצה מוסיפה נקודה אחרי בחירת מיקום ידנית (S.pick) ולפני בחירת מרכז; המעגל לא מצויר בנתיב; מעבר סוג מחליף שכבות, כותרות וגלגול כפול; סמנים נגררים ונמחקים בלחיצה ימנית בלבד", () => {
  const im = fnSrc("initMap");
  assert.ok(/if \(S\.pick\) \{[^\n]*return; \}\n\s*if \(routeMode\(\)\) \{ const w = e\.latlng\.wrap\(\); addRoutePoint\(w\.lat, w\.lng\); return; \}[^\n]*\n\s*const moved = setCenter\(e\.latlng\.lat, e\.latlng\.lng, false\);\n\s*showHitsAt\(e\.latlng, moved\);/.test(im), "S.pick קודם; בנתיב אין כרטיס לחיצה ולא setCenter");
  assert.match(fnSrc("drawCircles"), /^function drawCircles\(\) \{\n    if \(routeMode\(\) \|\| !S\.lf\.m \|\| !S\.center\) return;/);
  const sk = fnSrc("setAreaKind");
  for (const frag of ["S.areaKind = route ? \"route\" : \"circle\"", '$("akRoute").checked = route', '["coordBox", "radiusBox"].forEach(id => { $(id).hidden = route; })', '["hwBox", "routeBox", "routeBar"].forEach(id => { $(id).hidden = !route; })', "m.doubleClickZoom.disable()", "m.doubleClickZoom.enable()", 'classList.toggle("routeMode", route)', "m.removeLayer(l)", "l.addTo(m)", "if (!route) drawCircles();", "if (!quiet) { closeCard(); onScanInputChange(); scheduleLayerUpdate(); }", "routeLim().maxPts"]) assert.ok(sk.includes(frag), "setAreaKind: " + frag);
  const dr = fnSrc("drawRoute");
  assert.ok(/draggable: true/.test(dr) && /mk\.on\("drag"/.test(dr) && /mk\.on\("dragend"/.test(dr) && /mk\.on\("contextmenu"/.test(dr) && !/dblclick/.test(dr.replace(/\/\/[^\n]*/g, "")), "גרירה חיה + שמירה בסיום; לחיצה כפולה לא מוחקת (היא נוחתת על הסמן שזה עתה נוסף)");
  assert.ok(/C\.corridorRing\(a, 1\)\.ring/.test(dr) && /C\.corridorRing\(a, 2\)\.ring/.test(dr), "אותו פוליגון כמו בשדה 8: ירוק (1) וכתום (2)");
  assert.ok((ui.match(/interactive: false/g) || []).length >= 5, "שכבות הנתיב אינן בולעות לחיצה");
  assert.ok(/#22c55e/.test(dr + fnSrc("routeLayers")) && /#ff9500/.test(fnSrc("routeLayers")), "אותם צבעים כמו המעגלים");
  assert.match(fnSrc("drawRoute"), /try \{[\s\S]*catch \(e\) \{ try \{ console\.error\("\[route\] drawRoute", e\); \}/, "כשל בציור לא זורק ללחיצה");
});

test("ui.js: עריכת הנתיב — תקרת נקודות מההגדרות עם הודעה גלויה, מינימום מטר מהנקודה הקודמת, עיגול ל-6 ספרות, הדבקה ״הכול או כלום״, וכל שינוי עובר routeChanged (ציור, רשימה, ישן, פס)", () => {
  const ar = fnSrc("addRoutePoint");
  assert.ok(/pts\.length >= lim\.maxPts\) \{ routeMsg\("הנתיב מוגבל ל-" \+ lim\.maxPts \+ " נקודות — מחקו נקודה כדי להוסיף\."\); return false; \}/.test(ar) && /lengthM < 1\) \{ routeMsg\(/.test(ar) && /round6\(lat\), round6\(lon\)/.test(ar), "תקרה בהודעה (לא נעלמת בשקט), מטר, 6 ספרות");
  const rc = fnSrc("routeChanged");
  assert.ok(rc.includes("closeCard();") && rc.includes("drawRoute(); renderRouteList(); routeInfoLine();") && rc.includes("onScanInputChange(); scheduleLayerUpdate();"), "שינוי נתיב: ציור, רשימה, מידע, ישן ופס");
  for (const f of ["movePoint", "removeRoutePoint", "clearRoute", "setRoute"]) assert.ok(/routeChanged\(/.test(fnSrc(f)), f + " עובר routeChanged");
  const ap = fnSrc("applyRouteText");
  assert.ok(/r\.bad\.length\) \{[^}]*לא נטען דבר/.test(ap) && /r\.pts\.length > lim\.maxPts\) \{[^}]*לא נטען דבר/.test(ap) && /r\.pts\.length < 2/.test(ap) && /setRoute\(r\.pts, null, true\)/.test(ap), "הדבקה: שורה פגומה / יותר מדי / פחות משתיים ← לא נטען דבר; תקין ← setRoute עם קירוב");
  assert.ok(/C\.parseCoordList\(t\)/.test(ap) && /C\.parseCoordInput\(el\.value\)/.test(fnSrc("editRoutePoint")), "אותם מנתחי נ״צ של הליבה");
  assert.match(fnSrc("setRoute"), /S\.route\.pts = C\.roundPts\(pts\);/);
  assert.ok(/mapTitle|lgGreen/.test(fnSrc("setAreaKind")) && /if \(rows\.length === pts\.length\)/.test(fnSrc("renderRouteList")), "הרשימה מתעדכנת במקום כשהמספר זהה (× אחרי עריכה לא הולך לאיבוד)");
  const sec = noComments(ui.slice(ui.indexOf("/* ---------- נתיב (קו) כאזור הפעילות"), ui.indexOf("/* ---------- שכבות איסורים (פמ״ת)")));
  assert.ok(sec.length > 3000 && !/localStorage|sessionStorage|indexedDB|\blsSet\b|\bls\.set\b|\blsGet\b/.test(sec), "הנתיב אינו נשמר בדפדפן (זיכרון בלבד)");
});

test("ui.js: האזור בהרצה — שאילתות Overpass על הקו השבור, בדיקת #coord מוסתרת מדולגת, האזור שנשלף נשמר (בלי radius), מפתח התוספות והתיקייה לפי הנקודות, ושורת המעגל כלשונה", () => {
  const run = /async function run\(\) \{[^]*?\n  \}\n/.exec(ui)[0];
  assert.ok(run.includes("const q = inp0.area ? C.buildQueries(inp0.lat, inp0.lon, inp0.area.halfWidth, S.cfg, inp0.area) : C.buildQueries(inp0.lat, inp0.lon, inp0.radius, S.cfg);"), "בנתיב — האזור כולו; במעגל השורה המקורית");
  assert.ok(run.includes('if (!inp0.area && raw && !C.parseCoordInput(raw)) errs.push({ field: "coord"'), "נ״צ שגוי ב-#coord המוסתר אינו חוסם נתיב");
  assert.ok(/const inp = Object\.assign\(readInputs\(\), \{ lat: inp0\.lat, lon: inp0\.lon, radius: inp0\.radius,[^\n]*\n\s*if \(inp0\.area\) \{ inp\.area = inp0\.area; delete inp\.radius; \}[^\n]*\n\s*const res = C\.analyze\(inp, data, S\.cfg, new Date\(\)\);/.test(run), "האזור שנשלפו עליו נתוני OSM, בלי radius, ולפני הניתוח");
  assert.ok(run.includes("const ck = areaKey(inp0); if (S.manualKey !== ck) { S.manual = []; S.manualKey = ck; }"), "תוספות ידניות נשמרות כל עוד הנקודות זהות");
  assert.ok(run.includes('"נמצאו " + res.nearScan.items.length + " מכשולים/תשתיות עד פי 2 מ" + (res.area ? "הרוחב" : "הרדיוס") + " · "') && ui.includes('" מכשולים ותשתיות עד פי 2 מ" + (x.v.route ? "הרוחב" : "הרדיוס") + " · "'), "מעגל: אותו נוסח בדיוק");
  const an = /async function recheckAnalyze\(inp, step\) \{[^]*?\n  \}\n/.exec(ui)[0];
  assert.ok(an.includes("const q = inp.area ? C.buildQueries(inp.lat, inp.lon, inp.area.halfWidth, S.cfg, inp.area) : C.buildQueries(inp.lat, inp.lon, inp.radius, S.cfg), fetchOpts"), "בדיקה חוזרת: אותן שאילתות");
  assert.ok(!/\bS\.res\b/.test(an), "recheckAnalyze עדיין לא נוגע בבקשה שבטופס");
  const pd = fnSrc("persistToDrive");
  assert.ok(pd.includes("key = i0.area ? JSON.stringify([i0.lat, i0.lon, i0.dateFrom, i0.dateTo, i0.area.pts]) : JSON.stringify([i0.lat, i0.lon, i0.dateFrom, i0.dateTo]);"), "נתיב אחר באותו עוגן ותאריך — תיקייה אחרת");
});

test("ui.js: הרשומה השמורה ושחזורה — inputsForRecord מוחק lat/lon/radius בנתיב (לקוח ישן נכשל סגור); myreqLoadBase מחליף מצב, משחזר נקודות ורוחב ולא כותב undefined לרדיוס; ״בקשה בעבודה״ כולל נתיב", () => {
  const rec = /function inputsForRecord\(\) \{[^]*?\n  \}\n/.exec(ui)[0];
  assert.ok(/forEach\(k => \{[^\n]*o\[k\] = S\.res\.inp\[k\]; \}\);\n\s*if \(o\.area\) \{ delete o\.lat; delete o\.lon; delete o\.radius; \}/.test(rec) && rec.indexOf("delete o.lat") < rec.indexOf("const rec = {"), "נמחקים לפני בניית הרשומה; area עובר כמות שהוא");
  assert.ok(/return myreqSnapRecord\(rec\);/.test(rec) && rec.indexOf("rec.parties") < rec.indexOf("myreqSnapRecord(rec)"), "השאר כמו תמיד");
  const lb = /function myreqLoadBase\(inp\) \{[^]*?\n  \}\n/.exec(ui)[0];
  assert.ok(lb.indexOf('setAreaKind(inp.area ? "route" : "circle", true);') > lb.indexOf("clearOutcome();") && lb.indexOf('setAreaKind(inp.area ? "route"') < lb.indexOf('$("height").value = inp.heightM'), "מצב האזור נקבע אחרי איפוס הבקשה ולפני השדות");
  assert.ok(lb.includes('if (!inp.area) $("radius").value = inp.radius;'), "נתיב לא כותב undefined לרדיוס");
  assert.ok(lb.includes("if (inp.area) setRoute(inp.area.pts, inp.area.halfWidth, true);") && /else \{ dropRoute\(\); \$\("coord"\)\.value = inp\.lat \+ ", " \+ inp\.lon; setCenter\(inp\.lat, inp\.lon, true\); \}/.test(lb), "מעגל: ללא נתיב שנשאר בזיכרון ועם השורות המקוריות");
  assert.ok(/const c = readInputs\(\); S\.manualKey = c\.lat \+ "," \+ c\.lon;[^\n]*\n\s*if \(c\.area\) S\.manualKey = areaKey\(c\);/.test(lb), "מפתח התוספות לפי הנקודות");
  for (const never of ["reqName", "setRows(", "savePerson", "PERSON_KEY", "contactList", "localStorage"]) assert.ok(!lb.includes(never), never);
  assert.ok(/const myreqInProgress = \(\) => !!S\.res \|\| S\.manual\.length > 0 \|\| S\.route\.pts\.length > 0 \|\|/.test(ui), "נתיב שסומן ועדיין לא הורץ נחשב בקשה בעבודה (אישור לפני החלפה)");
});

test("ui.js: שגיאות והודעות — route / halfWidth ב-showErrors, FIELD_LABEL וב-focusFirstError (e_route בתוך תיבת הנתיב); דוח, אזהרות ופס המסך בנתיב עם ״הנתיב״ / ״מהציר״ ובמעגל בדיוק כמו תמיד", () => {
  const se = fnSrc("showErrors");
  assert.ok(se.includes('radius: "radius", halfWidth: "halfWidth", route: null, height:') && se.includes('$("routeBox").classList.remove("bad")') && se.includes('if (e.field === "route" && $("routeBox")) $("routeBox").classList.add("bad");'));
  assert.ok(ui.includes('route: "נקודות הנתיב", halfWidth: "רוחב מכל צד", height:'), "FIELD_LABEL");
  const rr = fnSrc("renderReport");
  assert.ok(rr.includes('esc(mdl.itemsDistHead || "מרחק מהנקודה")') && rr.includes('secH(mdl.pointHeading || "הנקודה") + (res.area ? "<p>" + esc(mdl.checkPoint) + "</p>" : "<p><span dir=\'ltr\'>" + esc(C.dmsLat(res.inp.lat) + " " + C.dmsLon(res.inp.lon)) + "</span> · ירוק: " + res.R + " מ׳ · כתום: עד " + 2 * res.R + " מ׳ · גובה "'), "הדוח על המסך מהמודל של output.js; במעגל השורות המקוריות");
  assert.ok(fnSrc("warnings").includes('C.fmtDist(z.d) + (r.area ? " מהציר)" : " מהנקודה)")).join("; "))'), "אזהרת קרבה לאזור ב-09");
  const li = fnSrc("layerInputs");
  assert.ok(li.startsWith("function layerInputs() {\n    if (routeMode()) return { area: readArea(), coordInvalid: false, heightM:") && !/\blat\b|\blon\b|radius/.test(li.split("\n")[1].replace(/\/\/.*$/, "")), "הפס בנתיב: area בלבד — בלי lat/lon/radius ובלי מעגל");
  assert.ok(ui.includes('ttl.textContent = routeMode() ? "סיכום מקדים לנתיב שנבחר" : "סיכום מקדים לנקודה שנבחרה"'));
  assert.ok(ui.includes('["input", "change"].forEach(ev => $("halfWidth").addEventListener(ev, scheduleLayerUpdate));'), "שינוי הרוחב מעדכן את הפס");
  assert.ok(/if \(routeMode\(\)\) \{ if \(S\.lf\.m\) S\.lf\.m\.setView\(\[\+x\.lat, \+x\.lon\], Math\.max\(S\.lf\.m\.getZoom\(\), 16\)\); \} else setCenter\(\+x\.lat, \+x\.lon, false\);/.test(ui), "חיפוש מקום בנתיב רק מזיז את המפה");
});

test("ui.js: איפוס ואתחול — resetPage ו-enterUser מחזירים למעגל בלי נקודות; האתחול מכריח מעגל ומחבר את הבקרים; window.__REQ חושף את פעולות הנתיב; הסברי ״!״ לכפתורים הסטטיים", () => {
  const rp = ui.slice(ui.indexOf("function resetPage()"), ui.indexOf("function onPageShow"));
  assert.ok(/closeCard\(\); \}\);\n\s*step\(resetRoute\);/.test(rp), "resetPage: הנתיב ושכבותיו");
  assert.ok(/function enterUser\(u\) \{\n    S\.uk = C\.userHash\(u\);\n    partiesReset\(\);[^\n]*\n    resetFormFields\(\);\n    resetRoute\(\);/.test(ui), "enterUser: אחרי איפוס השדות");
  assert.ok(/const FREE_FIELDS = \["coord", "rtText",/.test(ui), "הטקסט המודבק נמחק עם שאר השדות החופשיים");
  const ini = fnSrc("init");
  assert.ok(/initMap\(\);\n    setAreaKind\("circle", true\);/.test(ini), "מצב ברירת המחדל מכריח את הרדיו (גם כשהדפדפן שחזר אותו)");
  for (const frag of ['["akCircle", "akRoute"].forEach(id => $(id).addEventListener("change"', '$("halfWidth").addEventListener("input", () => { drawRoute(); routeInfoLine(); onScanInputChange(); });', '$("rtUndo").onclick = undoRoutePoint; $("rtClear").onclick = clearRoute; $("rtApply").onclick = applyRouteText;', '$("routeList").addEventListener("change"', '$("routeList").addEventListener("click"', "setAreaKind, addRoutePoint, removeRoutePoint, undoRoutePoint, clearRoute, setRoute };"]) assert.ok(ini.includes(frag), frag);
  const help = Object.fromEntries([...ui.matchAll(/\n    (akTitle|rtUndo|rtClear|rtApply): "([^"]*)"/g)].map(m => [m[1], m[2]])), names = ui.slice(ui.indexOf("const HELP_NAME"), ui.indexOf("const HELP_FIELD"));
  assert.deepEqual(Object.keys(help).sort(), ["akTitle", "rtApply", "rtClear", "rtUndo"]);
  for (const [k, t] of Object.entries(help)) { assert.ok(t.length > 25, k); assert.ok(new RegExp(k + ': "[^"]+"').test(names), "שם נגיש ל-" + k); }
  assert.equal(new Set([...names.matchAll(/: "([^"]+)"/g)].map(m => m[1])).size, [...names.matchAll(/: "([^"]+)"/g)].length, "שמות ה-aria-label ייחודיים");
  for (const id of ["akTitle", "rtUndo", "rtClear", "rtApply"]) assert.ok(html.includes('id="' + id + '"'), id + " סטטי ב-index.html (attachHelp רץ פעם אחת)");
});

/* ============ ReqRecheckUI / ReqMyReq על רשומת נתיב ============ */
const P0 = new C.Proj(exp.input.lat, exp.input.lon), PTS = C.roundPts([[0, 0], [250, 80], [520, 60]].map(([x, y]) => P0.ll(x, y)));
const meta = JSON.parse(rd("selftest/yarkon/meta.json")), zones = JSON.parse(fs.readFileSync(path.join(ROOT, "members-k38p/data/zones.json"), "utf8")), now = new Date(exp.now);
zones.rules09 = JSON.parse(fs.readFileSync(path.join(ROOT, "members-k38p/data/pmt-b09-rules.json"), "utf8"));
const data = Object.assign({ zones, inpa: JSON.parse(fs.readFileSync(path.join(ROOT, "members-k38p/data/inpa-zones.json"), "utf8")), agri: JSON.parse(fs.readFileSync(path.join(ROOT, "members-k38p/data/agri-airstrips.json"), "utf8")), notams: JSON.parse(rd("selftest/notam-data.snap.json")).notams, notamFetchedIso: JSON.parse(rd("selftest/notam-data.snap.json")).fetched_iso },
  Object.fromEntries(["near", "far", "ext"].map(k => [k, JSON.parse(rd("selftest/yarkon/" + k + ".json"))])));
const routeInp = (W = 60) => { const a = C.routeInfo(PTS).anchor; return Object.assign({}, exp.input, { lat: a[0], lon: a[1], area: { kind: "route", pts: PTS, halfWidth: W }, purpose: cfg.purposes[0], aircraft: [cfg.aircraft[0]], vlos: true, siteName: "בדיקה", requesterName: "בודק", requesterPhone: "050-0000000", requesterOrg: "חברה", contacts: [{ name: "א", phone: "050-0000001" }, { name: "ב", phone: "050-0000002" }] }, { radius: undefined }); };
const mkRes = W => { const i = routeInp(W); delete i.radius; return C.analyze(i, data, cfg, now); };
const record = (W = 60) => { const res = mkRes(W), inp = {}; Object.keys(res.inp).forEach(k => { if (!/^(req|contact|requester|participant|callsign|registration)/i.test(k)) inp[k] = res.inp[k]; }); delete inp.lat; delete inp.lon; delete inp.radius;
  return JSON.parse(JSON.stringify({ savedAt: now.toISOString(), site: "אתר", version: zones.mapVersion, edition: zones.edition, declaration: { version: "1", confirmedAt: now.toISOString() }, inputs: Object.assign(inp, { visitDate: "", visitNotes: "", knownObstacles: "" }), zones: [], items: [], snapshot: RC.snapshotOf(res, data, cfg, now) })); };

test("RecheckUI.scanOf / sameScan — נתיב: {area, גובה, תאריכים} בלי lat/lon/radius; סריקה זהה רק בנקודות (עד מיקרון-מעלה), רוחב, גובה, תאריכים ושעות; מעגל מול נתיב ← false; כל קלט לא תקין ← false", () => {
  const inp = RU.prepare(record(), { cfg, name: "x" }).inp, sc = RU.scanOf(inp);
  assert.deepEqual(Object.keys(sc), ["area", "heightM", "dateFrom", "dateTo", "timeFrom", "timeTo"]); assert.deepEqual(sc.area, { kind: "route", pts: PTS, halfWidth: 60 }); assert.notEqual(sc.area.pts, inp.area.pts, "עותק");
  assert.deepEqual(RU.scanOf({ lat: 1, lon: 2, radius: 3, heightM: 4, dateFrom: "a", dateTo: "b", timeFrom: "c", timeTo: "d", area: undefined }), { lat: 1, lon: 2, radius: 3, heightM: 4, dateFrom: "a", dateTo: "b", timeFrom: "c", timeTo: "d" }, "מעגל כמו תמיד (area: undefined אינו נתיב)");
  assert.equal(RU.sameScan(sc, mkRes(60).inp), true, "scan מהרשומה מול S.res.inp של הרצה חדשה (עם lat/lon של העוגן)");
  const d = f => Object.assign({}, sc, f), ar = f => ({ area: Object.assign({}, sc.area, f) });
  assert.equal(RU.sameScan(sc, d(ar({ pts: sc.area.pts.map(q => [q[0] + 5e-7, q[1] - 5e-7]) }))), true, "עד מיקרון-מעלה");
  for (const [n, o] of Object.entries({ "נקודה זזה": ar({ pts: [sc.area.pts[0], [sc.area.pts[1][0] + 1e-5, sc.area.pts[1][1]], sc.area.pts[2]] }), "נקודה חסרה": ar({ pts: sc.area.pts.slice(1) }), "נקודה נוספת": ar({ pts: sc.area.pts.concat([sc.area.pts[0]]) }), "רוחב": ar({ halfWidth: 61 }), "רוחב מחרוזת": ar({ halfWidth: "60" }), "גובה": { heightM: 81 }, "תאריך": { dateFrom: "2000-01-01" }, "שעה ריקה": { timeFrom: "" },
    "סוג": ar({ kind: "circle" }), "בלי נקודות": ar({ pts: [] }), "נקודה אחת": ar({ pts: [sc.area.pts[0]] }), "נקודה לא מערך": ar({ pts: [{}, {}] }), "נקודה NaN": ar({ pts: [[NaN, 1], [2, 3]] }) })) assert.equal(RU.sameScan(sc, d(o)), false, n);
  const circ = RU.scanOf({ lat: 32.1, lon: 34.8, radius: 60, heightM: 80, dateFrom: "2026-10-20", dateTo: "2026-10-23", timeFrom: "17:00", timeTo: "20:00" });
  assert.equal(RU.sameScan(sc, circ), false); assert.equal(RU.sameScan(circ, sc), false, "מעגל מול נתיב"); assert.equal(RU.sameScan(circ, Object.assign({}, circ)), true);
  for (const x of [null, undefined, 5, "x", [], {}, { area: null }, { area: "route" }]) { assert.equal(RU.sameScan(sc, x), false); assert.equal(RU.sameScan(x, sc), false); }
  assert.equal(RU.sameScan({ area: sc.area }, { area: sc.area }), false, "בלי גובה ותאריכים — לא זהה");
});

test("RecheckUI.prepare — נתיב: קלט הניתוח עם area, עוגן ב-lat/lon, בלי radius; קלט פגום ← ok:false בעברית; מעגל כמו תמיד", () => {
  const rec = record(), p = RU.prepare(rec, { cfg, name: "שם" });
  assert.equal(p.ok, true, JSON.stringify(p)); assert.deepEqual(p.inp.area, { kind: "route", pts: PTS, halfWidth: 60 }); assert.deepEqual([p.inp.lat, p.inp.lon], C.routeInfo(PTS).anchor); assert.ok(!("radius" in p.inp));
  assert.notEqual(p.inp.area.pts, rec.inputs.area.pts, "עותק, לא הפניה לרשומה"); p.inp.area.pts[0][0] = 0; assert.notEqual(rec.inputs.area.pts[0][0], 0);
  for (const x of ["kind", "pts", "halfWidth"]) { const r = record(); delete r.inputs.area[x]; const b = RU.prepare(r, { cfg }); assert.equal(b.ok, false, x); assert.match(b.text, /פגום/); }
  const bad = record(); bad.inputs.area.pts = bad.inputs.area.pts.concat(Array.from({ length: 20 }, () => [32.1, 34.8])); assert.equal(RU.prepare(bad, { cfg }).ok, false, "יותר מדי נקודות");
  const both = record(); Object.assign(both.inputs, { lat: 32.1, lon: 34.8, radius: 150 }); both.inputs.area = null; assert.equal(RU.prepare(both, { cfg }).ok, false, "area פגום עם lat/lon/radius תקינים — לא מעגל");
  const c = RU.prepare(JSON.parse(JSON.stringify({ savedAt: now.toISOString(), inputs: { lat: 32.1, lon: 34.8, radius: 150, heightM: 60, dateFrom: "2026-11-02", dateTo: "2026-11-02", timeFrom: "14:30", timeTo: "17:30", purpose: "p", aircraft: [], vlos: true, siteName: "s", knownObstacles: "", visitDate: "", visitNotes: "", manualItems: [] } })), { cfg });
  assert.equal(c.ok, true); assert.ok(!("area" in c.inp) && c.inp.radius === 150);
});

test("RecheckUI.lockedModel — נתיב: נקודות P1..PN, אורך ורוחב מכל צד במקום נקודת מרכז ורדיוס, בלי חריגה גם בלי lat/lon; מעגל כמו תמיד", () => {
  const inp = RU.prepare(record(), { cfg, name: "x" }).inp, rows = RU.lockedModel(inp, "בקשה");
  assert.deepEqual(rows.map(r => r[0]), ["הבקשה", "נתיב — נקודות לפי הסדר", "אורך הנתיב", "רוחב מכל צד של הציר", "גובה", "מועד"]);
  assert.equal(rows[1][1], PTS.map((q, k) => "P" + (k + 1) + ": " + q[0].toFixed(6) + ", " + q[1].toFixed(6)).join("\n")); assert.equal(rows[3][1], "60 מ׳"); assert.ok(/^0\.\d\d ק״מ$/.test(rows[2][1]));
  const noLat = Object.assign({}, inp); delete noLat.lat; delete noLat.lon; assert.doesNotThrow(() => RU.lockedModel(noLat, ""));
  assert.ok(RU.lockedHtml(rows).includes("<dd dir=\"auto\">P1: ") && RU.lockedHtml(rows).includes("רוחב מכל צד של הציר"));
  assert.deepEqual(RU.lockedModel({ lat: 32.1, lon: 34.8, radius: 150, heightM: 60, dateFrom: "2026-11-02", dateTo: "2026-11-02", timeFrom: "14:30", timeTo: "17:30" }).map(r => r[0]), ["נקודת מרכז", "רדיוס", "גובה", "מועד"]);
});

test("RecheckUI.compare על נתיב — אותה סריקה ← ניתן להשוואה ו״לא נמצאו שינויים״; הממצאים הנוכחיים מנוסחים לנתיב (פס כתום); שמירת הבקשה מחדש ובדיקת התאמה לבקשה מעודכנת", () => {
  const rec = record(), prep = RU.prepare(rec, { cfg, name: "x" }), res = C.analyze(prep.inp, data, cfg, now);
  const cmp = RU.compare({ raw: rec, inp: prep.inp, res, data, cfg, now, sentAt: "2026-10-18T11:05:00Z" });
  assert.equal(cmp.ok, true); assert.equal(cmp.comparable, true, JSON.stringify(cmp.since && cmp.since.reason)); assert.equal(cmp.kind, "none"); assert.equal(cmp.since.route, true);
  assert.equal(cmp.cur.v, 2); assert.equal(cmp.canUpdate, false);
  const f = RU.findingsModel(cmp.cur), items = f.items.rows.map(r => r.note); assert.ok(items.some(n => n === "בפס הכתום (עד פי 2 מהרוחב)" || n === "בתוך הסגירה"), items.join("|")); assert.ok(!items.some(n => /טבעת/.test(n)));
  const circle = RC.snapshotOf(C.analyze(Object.assign({}, prep.inp, { area: undefined, radius: 200, lat: meta.lat, lon: meta.lon }), data, cfg, now), data, cfg, now);
  assert.ok(RU.findingsModel(circle).items.rows.every(r => !/הכתום/.test(r.note)), "מעגל: ״בטבעת״ כמו תמיד");
  // מבקשת מעודכנת: אותו נתיב ⇒ אותה סריקה; נקודה אחרת ⇒ לא
  const inputs = RC.restoreInputs(rec, { keepDates: true, cfg }), scan = RU.scanOf(inputs);
  assert.equal(RU.sameScan(scan, res.inp), true); const moved = JSON.parse(JSON.stringify(res.inp)); moved.area.pts[2][0] += 1e-4; assert.equal(RU.sameScan(scan, moved), false);
  // תמונת מצב ישנה (מעגל, v:1) מול נתיב נוכחי: אין השוואה
  const old = Object.assign({}, rec, { snapshot: RC.snapshotOf(C.analyze(Object.assign({}, prep.inp, { area: undefined, radius: 200, lat: meta.lat, lon: meta.lon }), data, cfg, now), data, cfg, now) });
  const mism = RU.compare({ raw: old, inp: prep.inp, res, data, cfg, now, sentAt: "2026-10-18T11:05:00Z" }); assert.equal(mism.comparable, false); assert.equal(mism.since.reason, "scan_mismatch");
});

test("ReqMyReq — נתיב: ״כבסיס״ מקבל area מ-restoreInputs, וכל area פגום ← null (״unusable״); ניסוחי ההודעות ניטרליים לשני הסוגים", () => {
  const rec = record(), inputs = RC.restoreInputs(rec, { cfg: MR.libCfg(cfg) });
  assert.ok(inputs && inputs.area.kind === "route" && !("radius" in inputs) && !("lat" in inputs) && inputs.heightM === exp.input.heightM);
  const bad = record(); bad.inputs.area.pts = "x"; assert.equal(RC.restoreInputs(bad, { cfg: MR.libCfg(cfg) }), null);
  assert.ok(/הנתיב/.test(MR.STR.unusable) && /אפשר למלא בקשה חדשה ידנית/.test(MR.STR.unusable) && /נתיב/.test(MR.HELP.base) && /נתיב/.test(MR.HELP.view));
  assert.ok(!/@|icd\.org\.il|office@/i.test(JSON.stringify([MR.STR, MR.HELP])), "בלי כתובת מייל בטקסטי המודול");
  assert.ok(/נתיב/.test(RU.STR.unusable) && /נתיב/.test(RU.HELP.update) && /נתיב/.test(RU.STR.updateLoaded("x", 0)) && !/נוטאם|@/.test(JSON.stringify([RU.STR, RU.HELP])));
});
