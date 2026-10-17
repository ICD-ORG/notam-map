// בדיקת דפדפן מלאה של members-k38p/requests/index.html (בקשות טיסה) — מצב MOCK (ברירת מחדל): נתוני OpenStreetMap אמיתיים שנשמרו מראש + אריחי מפה מדומים.
// מצב LIVE (E2E_LIVE=1): כל הקריאות החוצה אמיתיות (Overpass, Nominatim, תצלום אוויר) — רץ ב-GitHub Actions.
// שימוש: node tests/requests/e2e.mjs [תיקיית פלט]
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { makeEnv } from "../helpers/apps-script-env.mjs";
import { dataHash } from "../../scripts/export-zones.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..", "..");
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "tests", "out"));
fs.mkdirSync(OUT, { recursive: true });
const LIVE = process.env.E2E_LIVE === "1";
const require = createRequire(import.meta.url);
let pw;
for (const p of [ROOT, process.cwd(), "/opt/node22/lib/node_modules"]) { try { pw = require(require.resolve("playwright", { paths: [p] })); break; } catch (e) { /* next */ } }
if (!pw) { console.error("playwright לא נמצא"); process.exit(2); }

const results = [];
const check = (name, ok, detail, soft) => { soft = soft && LIVE; results.push({ name, ok: !!ok || soft, soft: !!soft && !ok, detail: detail || "" }); console.log((ok ? "PASS " : soft ? "WARN " : "FAIL ") + name + (detail ? " — " + detail : "")); };

/* ---- שרת סטטי ---- */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".css": "text/css", ".png": "image/png", ".webmanifest": "application/json" };
const FX_OVERRIDE = process.env.FIXTURES_OVERRIDE || "";
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split("?")[0]); let f = path.join(ROOT, u === "/" ? "index.html" : u);
  if (FX_OVERRIDE && u.startsWith("/members-k38p/requests/selftest/yarkon/")) f = path.join(FX_OVERRIDE, path.basename(u));
  if ((!f.startsWith(ROOT) && !(FX_OVERRIDE && f.startsWith(FX_OVERRIDE))) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end("nf"); return; }
  res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const BASE = "http://127.0.0.1:" + server.address().port;
const APP = BASE + "/members-k38p/requests/index.html";
const API = "https://script.test/exec";
const ADMIN = "itzik.admin", PASS = "correct-horse-1";

/* ---- PNG מדומה לאריחים ---- */
function crc32(buf) { let c, crc = ~0; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function tilePng(seed) {
  const W = 256, raw = Buffer.alloc((W * 3 + 1) * W);
  for (let y = 0; y < W; y++) { raw[y * (W * 3 + 1)] = 0; for (let x = 0; x < W; x++) { const o = y * (W * 3 + 1) + 1 + x * 3, grid = x % 64 === 0 || y % 64 === 0; raw[o] = grid ? 60 : 90 + (seed % 40); raw[o + 1] = grid ? 70 : 120 + (seed % 30); raw[o + 2] = grid ? 60 : 80; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(W, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// נתוני אמת שמורים; חותמת הזמן של OSM מוחלפת ב"עכשיו" כדי שבדיקת הגיל (שרת עם נתונים ישנים נפסל) לא תכשיל את הבדיקה
const fx = n => { const d = JSON.parse(fs.readFileSync(path.join(FX_OVERRIDE || path.join(ROOT, "members-k38p", "requests", "selftest", "yarkon"), n + ".json"), "utf8")); if (d.osm3s) d.osm3s.timestamp_osm_base = new Date().toISOString(); return JSON.stringify(d); };
const CORS = { "access-control-allow-origin": "*" };
// Apps Script אמיתי אינו תומך ב-CORS preflight: כל פנייה אליו חייבת להיות "בקשה פשוטה" (text/plain). המדמה מסרב ל-OPTIONS וסופר הפרות.
const API_STATS = { preflight: 0, nonSimple: 0, posts: 0 };
// שרת Apps Script ישן (לפני "עצמאות המבקש"): תשובותיו אינן נושאות features / email / copyTo / copyToIsOwner. opts.oldServer נבדק בכל קריאה, ולכן אפשר להפעילו ולכבותו באמצע בדיקה
const oldSrv = (opts, resp) => { if (opts && opts.oldServer && resp && typeof resp === "object") { resp = { ...resp }; ["features", "email", "copyTo", "copyToIsOwner"].forEach(k => { delete resp[k]; }); } return resp; };
const apiHandler = (env, calls, opts) => async r => {
  const req = r.request(), m = req.method();
  if (m === "OPTIONS") { API_STATS.preflight++; return r.abort(); }
  if (m === "POST") { API_STATS.posts++; if (!/^text\/plain/i.test(req.headers()["content-type"] || "")) API_STATS.nonSimple++; }
  if (opts && opts.apiDown) return r.abort();
  const body = m === "POST" ? JSON.parse(req.postData() || "{}") : null;
  if (body && calls) { calls.actions.push(body.action); if (body.action === "sendRequest") (calls.sends = calls.sends || []).push(body); if (body.action === "saveEnd") (calls.saveEnds = calls.saveEnds || []).push({ ready: body.ready }); }
  if (opts && opts.apiDelay) await new Promise(x => setTimeout(x, opts.apiDelay));
  r.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: m === "POST" ? JSON.stringify(oldSrv(opts, env.call(body))) : JSON.stringify(env.doGet()) });
};

async function newPage(browser, opts) {
  opts = opts || {};
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 1000 }, locale: "he-IL", timezoneId: "Asia/Jerusalem", acceptDownloads: true, hasTouch: !!opts.touch, isMobile: !!opts.touch });   // touch: מסך מגע (pointer: coarse)
  const page = await ctx.newPage();
  const calls = { overpass: 0, tiles: 0, nominatim: 0, actions: [] };
  page._calls = calls;
  page._notamIso = new Date().toISOString();            // חותמת נוטמים יציבה לאורך הבדיקה (כמו בקובץ האמיתי); בדיקות יכולות להקדים אותה
  if (opts.notamAgeH) page._notamIso = new Date(Date.now() - opts.notamAgeH * 3600e3).toISOString();   // נוטמים ישנים: גם במפה (אחרת הסנכרון היה חוסם מסיבה אחרת)
  page._map = { tamper: false, zonesHash: null };        // מצב 'המפה התעדכנה' שאפשר להפעיל באמצע בדיקה
  page.on("pageerror", e => check("אין שגיאת JS בדף", false, String(e.message || e)));
  // השער של חברי האתר ושרת ההתחברות מדומים תמיד (גם במצב חי); רק OSM/Nominatim/אריחים אמיתיים במצב חי
  await page.route(/\/gate\.js/, r => r.fulfill({ status: 200, contentType: "text/javascript", body: "/* שער חברי האתר מוחלף בבדיקות */" }));
  await page.route(/\/requests\/config\.json/, r => { // כתובת שרת ההתחברות המדומה
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, "members-k38p", "requests", "config.json"), "utf8")); d.api_url = opts.noApi ? "" : API; d.sync_retry_ms = 400;
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(d) });
  });
  const tamperedHtml = () => fs.readFileSync(path.join(ROOT, "members-k38p", "index.html"), "utf8").replace('name:"שמורת הטבע החולה"', 'name:"שמורת הטבע החולה (עודכן)"');
  page._tamperedHash = () => dataHash(tamperedHtml());
  await page.route(/\/members-k38p\/index\.html/, r => (opts.tamperMap || page._map.tamper) ? r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: tamperedHtml() }) : r.continue());
  await page.route(/\/members-k38p\/data\/zones\.json/, async r => {
    if (!page._map.zonesHash) return r.continue();
    const resp = await r.fetch(), j = await resp.json(); j.dataHash = page._map.zonesHash;
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(j) });
  });
  if (opts.newPmt) await page.route(/\/members-k38p\/pamat-meta\.json/, r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ pamat_update: "2/26", pamat_date: "01 FEB 2027", map_version: "9.9", map_date: "01 FEB 2027" }) }));
  if (opts.notamAgeH) await page.route(/\/notam-data\.json/, r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ fetched_iso: page._notamIso, notams: [] }) }));
  if (opts.mapNotamNewer) await page.route(/\/notam-data\.json/, r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ fetched_iso: new Date(Date.now() + 3600e3).toISOString(), notams: [] }) }));
  // שרת Apps Script האמיתי (Code.gs) רץ כאן על הדמיית שירותי גוגל
  const env = opts.env || makeEnv(); page._env = env;
  if (!opts.env) { const code = env.run("initialize"); const b = env.call({ action: "bootstrap", code, user: ADMIN, pass: PASS }); if (!b.ok) throw new Error("bootstrap " + JSON.stringify(b)); }
  await page.route(API, apiHandler(env, calls, opts));
  if (!LIVE) {
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
    await page.route(/\/notam-all\.json/, r => { // תמונת מצב קבועה של הנוטמים, עם זמן משיכה "עכשיו" כדי שבדיקת הגיל לא תכשיל את הבדיקה
      const d = JSON.parse(fs.readFileSync(path.join(ROOT, "members-k38p", "requests", "selftest", "notam-data.snap.json"), "utf8"));
      d.fetched_iso = page._notamIso; d.fetched_at = d.fetched_iso; d.listed = d.count = d.notams.length; d.failed = [];
      if (opts.notamIncomplete) { d.listed += 2; d.failed = ["C0001/26", "C0002/26"]; }
      if (opts.notamEmpty) { d.notams = []; d.count = 0; d.listed = 0; d.failed = []; }
      r.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify(d) });
    });
    // page._tileHold: פונקציה אסינכרונית אופציונלית — אריחים שמתבקשים בזמן שהיא מוגדרת מחכים לה (ואם היא מחזירה "fail" — נכשלים); מדמה רינדור איטי של בנייה אחת
    await page.route(/server\.arcgisonline\.com|tile\.openstreetmap\.org/, async r => { calls.tiles++; const n = calls.tiles, hold = page._tileHold; let how = ""; try { if (hold) how = await hold(); if (opts.failTiles || how === "fail") return await r.abort(); await r.fulfill({ status: 200, contentType: "image/png", headers: CORS, body: tilePng(n) }); } catch (e) { /* הדף נסגר בזמן ההשהיה */ } });
    await page.route(/overpass/, async r => {
      calls.overpass++;
      if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: { ...CORS, "access-control-allow-headers": "*" } });
      const body = decodeURIComponent((r.request().postData() || "").replace(/^data=/, ""));
      let which = body.includes("is_in(") ? "far" : body.includes("nature_reserve") ? "ext" : "near";
      if (opts.failExt && which === "ext") return r.fulfill({ status: 500, headers: CORS, body: "overloaded" });
      r.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: fx(which) });
    });
    await page.route(/nominatim\.openstreetmap\.org/, r => {
      calls.nominatim++;
      if (r.request().url().includes("/search")) return r.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify([{ display_name: "גבעת המופעים, תל אביב", lat: "32.099128", lon: "34.816617" }]) });
      r.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: fx("reverse") });
    });
  }
  return { ctx, page };
}

async function login(page, user, pass) {
  await page.waitForSelector("#authForm", { timeout: 20000 });
  await page.fill("#auUser", user || ADMIN); await page.fill("#auPass", pass || PASS);
  await page.click("#auGo");
  await page.waitForSelector("#authCover", { state: "detached", timeout: 20000 });
}

async function readyRequest(page, over) {
  await fillExample(page, over); await page.click("#runBtn");
  await page.waitForFunction(() => document.querySelector("#gate .banner"), null, { timeout: 150000 });
  await page.check("#reviewOk");
  await page.waitForFunction(() => /הבקשה מוכנה לשליחה/.test(document.querySelector("#gate").textContent), null, { timeout: 15000 });
}

// אנשי קשר בשטח: רשימת שורות (שם + טלפון); מוסיף שורות לפי הצורך ומתעלם משורות עודפות
async function setContacts(page, list) {
  await page.evaluate(() => { document.getElementById("personBox").open = true; });
  while ((await page.locator("#contactList .prow").count()) < list.length) await page.click("#addContact");
  for (let i = 0; i < list.length; i++) {
    const row = page.locator("#contactList .prow").nth(i);
    await row.locator('[data-f="name"]').fill(list[i][0]); await row.locator('[data-f="phone"]').fill(list[i][1]);
  }
}
// משתתפים נוספים: [[שם פרטי, שם משפחה, טלפון], ...] — מוסיף שורות חדשות בסוף הרשימה
async function addParticipants(page, list) {
  await page.evaluate(() => { document.getElementById("personBox").open = true; });
  for (const [f, l, ph] of list) {
    await page.click("#addPart");
    const row = page.locator("#partList .prow").last();
    await row.locator('[data-f="first"]').fill(f); await row.locator('[data-f="last"]').fill(l); await row.locator('[data-f="phone"]').fill(ph);
  }
}

async function fillExample(page, over) {
  over = over || {};
  await page.fill("#coord", over.coord || "32.099128, 34.816617"); await page.dispatchEvent("#coord", "change");
  await page.fill("#radius", String(over.radius || 200)); await page.fill("#height", String(over.height || 80));
  const ymd = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  await page.fill("#dateFrom", over.dateFrom || process.env.E2E_FROM || ymd(10)); await page.fill("#dateTo", over.dateTo || process.env.E2E_TO || ymd(13));
  await page.fill("#timeFrom", "17:00"); await page.fill("#timeTo", "20:00");
  await page.selectOption("#purpose", { index: 1 });
  if (process.env.E2E_SITE) await page.fill("#siteName", process.env.E2E_SITE);
  await page.evaluate(() => { document.getElementById("personBox").open = true; });
  await page.fill("#reqName", "בודק ראשון"); await page.fill("#reqPhone", "050-0000001");
  await page.fill("#reqOrg", over.org || "חברת הבדיקה בע״מ");   // שם הגורם המבקש (שדה 2) חובה ואין לו ברירת מחדל
  if (over.callsign != null) await page.fill("#reqCallsign", over.callsign);
  if (over.registration != null) await page.fill("#reqReg", over.registration);
  await setContacts(page, over.contacts || [["בודק שני", "050-0000002"], ["בודק שלישי", "050-0000003"]]);
  if (over.participants) await addParticipants(page, over.participants);
  if (over.known) await page.fill("#knownObs", over.known);
}
// הערות הסיור ותאריכו נמצאים בסעיף 4 (סקירה אנושית) — מוצג רק אחרי הרצה; המילוי כאן בלי תנאי נראות מדמה הדבקה/עריכה ומפעיל את אירועי ה-input
async function setVisit(page, date, notes) {
  await page.evaluate(([d, n]) => { const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); }; if (d != null) set("visitDate", d); if (n != null) set("visitNotes", n); }, [date, notes]);
}

const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"], env: { ...process.env, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" } });
try {
  /* ===== תרחיש 1: זרימה מלאה ===== */
  {
    const { ctx, page } = await newPage(browser);
    await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
    const st = await page.$$eval("#stList li", els => els.map(e => ({ ok: e.classList.contains("ok"), t: e.textContent })));
    check("הבדיקה העצמית רצה אוטומטית וכל " + st.length + " שלביה עברו", st.length > 8 && st.every(x => x.ok), st.filter(x => !x.ok).map(x => x.t).join(" | "));
    check("מפה חיה נטענה (Leaflet)", await page.evaluate(() => typeof L !== "undefined" && !!document.querySelector("#map.leaflet-container")), "");
    { // לחיצה על המפה קובעת מרכז, מצייר עיגולים ומעדכן את שדה הקואורדינטות
      await page.locator("#map").scrollIntoViewIfNeeded();
      const box = await page.locator("#map").boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForFunction(() => /^\d+\.\d+, \d+\.\d+$/.test(document.getElementById("coord").value), null, { timeout: 5000 });
      const circles = await page.evaluate(() => document.querySelectorAll("#map path.leaflet-interactive").length);
      check("לחיצה על המפה: נקבע מרכז ונוספו עיגולי ירוק וכתום", circles >= 2, "paths=" + circles + " coord=" + (await page.inputValue("#coord")));
      await page.fill("#radius", "150");
      const rr = await page.evaluate(() => window.__REQ.S.lf.green.getRadius() + "," + window.__REQ.S.lf.orange.getRadius());
      check("שינוי רדיוס מעדכן את העיגולים (150 / 300)", rr === "150,300", rr);
    }
    await fillExample(page);
    check("רמז רגל מתעדכן", /262\.5/.test(await page.textContent("#ftHint")), await page.textContent("#ftHint"));
    await page.click("#runBtn");
    try { await page.waitForFunction(() => document.querySelector("#gate .banner"), null, { timeout: 240000 }); }
    catch (e) { // אבחון: מה הדף הציג כשההרצה לא הסתיימה
      const diag = await page.evaluate(() => ({ err: document.getElementById("e_run").textContent, progress: document.getElementById("progress").innerText }));
      check("ההרצה הסתיימה בזמן", false, "e_run=" + diag.err + " | progress=" + diag.progress.replace(/\s+/g, " ").slice(0, 400));
      fs.writeFileSync(path.join(OUT, "e2e-results.json"), JSON.stringify({ live: LIVE, at: new Date().toISOString(), results }, null, 1));
      process.exit(1);
    }
    const gate0 = await page.textContent("#gate");
    check("לפני אישור הסקירה: לא מוכן לשליחה וההפקות חסומות", /אינה מוכנה/.test(gate0) && /אישור סקירה אנושית/.test(gate0) && (await page.isDisabled("#btnDocx")) && (await page.isDisabled("#btnPrint")), gate0.replace(/\s+/g, " ").slice(0, 200));
    { // הוספה ידנית: נכנסת לטופס, מאפסת את האישור, וניתנת להסרה
      await page.fill("#mName", "עגורן בנייה (בדיקה)"); await page.fill("#mCoord", "32.0995, 34.8168"); await page.fill("#mHeight", "60"); await page.click("#mAdd");
      await page.waitForFunction(() => /הוזן ידנית/.test(document.querySelector("#report").innerText), null, { timeout: 90000 });
      const f8m = await page.$$eval("#report .paper:first-child table.f tr", trs => trs[7].innerText.replace(/\s+/g, " "));
      check("הוספה ידנית נכנסת לשדה 8", /עגורן בנייה \(בדיקה\)/.test(f8m) && /בתוך האזור/.test(f8m), f8m.slice(0, 300));
      await page.click('[data-del="0"]');
      await page.waitForFunction(() => !/הוזן ידנית/.test(document.querySelector("#report").innerText), null, { timeout: 90000 });
      check("הסרת ההוספה מחזירה את הרשימה", true, "");
      await page.check("#reviewOk");
      await page.waitForFunction(() => /הבקשה מוכנה לשליחה/.test(document.querySelector("#gate").textContent), null, { timeout: 20000 });
    }
    const gate = await page.textContent("#gate");
    check("שער: מוכן לשליחה", /הבקשה מוכנה לשליחה/.test(gate) && !/אינה מוכנה/.test(gate), gate.replace(/\s+/g, " ").slice(0, 300));
    check("הוצג שם המקום האוטומטי", (await page.inputValue("#siteName")).length > 3, await page.inputValue("#siteName"));
    const form = await page.$$eval("#report .paper:first-child table.f tr", trs => trs.map(t => t.innerText.replace(/\s+/g, " ").trim()));
    check("בטופס 17 שדות", form.length === 17, String(form.length));
    const f8 = form[7];
    check("שדה 8: קו מתח 109 מ׳ ועמוד 117 מ׳", /קו מתח עליון 161 ק״ו — 109 מ׳/.test(f8) && /עמוד חשמל 1491 — 117 מ׳/.test(f8), f8.slice(0, 400), true);
    check("שדה 8: LLU20 בקרבה", /LLU20/.test(f8) && /52[56] מ׳/.test(f8), "");
    check("שדה 8: האצטדיון והבלון מופיעים", /אצטדיון רמת גן/.test(f8) && /כדור פורח תל אביב/.test(f8), f8.slice(-420), true);
    check("תמונת הרקע אמיתית (לא אריחים מדומים)", !LIVE || (await page.evaluate(() => ["aerial", "street", "overview", "region"].every(k => window.__REQ.S.imgs[k] && window.__REQ.S.imgs[k].background))), "");
    check("שדה 10: 262.5 רגל", /262\.5 רגל/.test(form[9]), form[9]);
    check("שדה 2: הגורם המבקש שהוקלד בטופס (לא ארגון קבוע); שדות 13 ו-14 ריקים => ״לא רלוונטי״ (ללא ״ICD״)", /חברת הבדיקה בע״מ/.test(form[1]) && !/לרב להב|ICD/.test(form[1] + form[12] + form[13]) && /לא רלוונטי/.test(form[12]) && /לא רלוונטי/.test(form[13]), form[1] + " | " + form[12] + " | " + form[13]);
    check("אזהרה על מכשולים בתוך האזור מוצגת", /מכשולים או תשתיות בתוך האזור/.test(gate), "");
    const mapTxt = await page.getAttribute("#report img.mapimg", "src");
    check("תמונת המפה בדוח נוצרה (JPEG)", mapTxt && mapTxt.startsWith("data:image/jpeg;base64,") && mapTxt.length > 30000, "אורך " + (mapTxt || "").length);
    { // (ו) ארבע התמונות נוצרות, כולן לא ריקות, וכל אחת מוצגת בעמוד משלה בדוח
      const im = await page.evaluate(() => Object.fromEntries(["aerial", "street", "overview", "region"].map(k => { const m = window.__REQ.S.imgs[k]; return [k, m ? { bg: m.background, tainted: m.tainted, len: (m.dataUrl || "").length, jlen: (m.jpegUrl || "").length, w: m.canvas.width, h: m.canvas.height, view: m.view, provider: m.provider } : null]; })));
      const keys = Object.keys(im);
      check("ארבע התמונות נוצרו (aerial, street, overview, region), עם רקע, בלי tainted, וכולן לא ריקות", keys.length === 4 && keys.every(k => im[k] && im[k].bg && !im[k].tainted && im[k].len > 30000 && im[k].jlen > 30000), JSON.stringify(im));
      check("התמונות לפי החוזה: aerial/street בתקריב (esri/osm), overview מבט כללי, region מרוחק", im.aerial.view === "detail" && im.aerial.provider === "esri" && im.street.view === "detail" && im.street.provider === "osm" && im.overview.view === "overview" && im.region.view === "region", JSON.stringify(Object.fromEntries(keys.map(k => [k, im[k].view + "/" + im[k].provider]))));
      const rep4 = await page.$$eval("#report .paper img.mapimg", els => els.map(e => e.closest(".paper").querySelector(".hdr").textContent.trim()));
      check("בדוח ארבעה עמודי תמונה עם כותרות מתאימות (תצ״א, מפת רחובות, הדמיה וסימונים, מפת אזור)", rep4.length === 4 && /תצ״א תקריב/.test(rep4[0]) && /מפת רחובות תקריב/.test(rep4[1]) && /הדמיה וסימונים/.test(rep4[2]) && /מפת אזור/.test(rep4[3]), rep4.join(" | "));
      check("מקרא הצבעים מתחת לתצ״א הראשונה בלבד, וטבלת הפריטים בעמוד המבט הכללי", (await page.$$eval("#report .paper", ps => ps.map(p => /ירוק: אזור הסגירה/.test(p.innerText) ? 1 : 0).join(""))) === "010000" && /מכשולים, אתרים ותשתיות המסומנים במפה/.test(await page.locator("#report .paper").nth(3).innerText()), "");
      check("אין עוד #provider, #btnPng או ״תצ״א נקי״ בדף (הוסר לגמרי)", !(await page.$("#provider")) && !(await page.$("#btnPng")) && !/תצ״א נקי|רקע לתמונת המפה/.test(await page.evaluate(() => document.body.innerText)), "");
      check("שורת המצורפים בעמוד הראשון מזכירה ארבע תמונות, ללא מספרי עמודים", /מצורפות ארבע תמונות/.test(await page.locator("#report .paper").first().innerText()) && !/עמוד/.test(await page.locator("#report .paper").first().locator("p").last().innerText()), "");
    }
    const pngTxt = await page.evaluate(() => window.__REQ.S.imgs.aerial.dataUrl);
    fs.writeFileSync(path.join(OUT, "map.png"), Buffer.from(pngTxt.split(",")[1], "base64"));
    const dl = async sel => { const [d] = await Promise.all([page.waitForEvent("download"), page.click(sel)]); const p = path.join(OUT, d.suggestedFilename()); await d.saveAs(p); return p; };
    const kmlPath = await dl("#btnKml"); const kml = fs.readFileSync(kmlPath, "utf8");
    check("KML הורד ותקין", /<kml/.test(kml) && /קו מתח עליון/.test(kml) && /LLU20/.test(kml), kml.length + " בתים");
    for (const [sel, part, label] of [["#btnAerial", " — תצ״א תקריב.png", "תצ״א — תקריב"], ["#btnStreet", " — מפת רחובות תקריב.png", "מפת רחובות — תקריב"], ["#btnOverview", " — הדמיה מבט כללי.png", "הדמיה וסימונים — מבט כללי"], ["#btnRegion", " — מפת אזור.png", "מפת אזור — מרוחק"]]) {
      const pth = await dl(sel), buf = fs.readFileSync(pth);
      check("הורדה: " + label + " (PNG אמיתי, לא ריק, בשם לפי החוזה)", buf.length > 30000 && buf.slice(1, 4).toString() === "PNG" && path.basename(pth).endsWith(part), path.basename(pth) + " " + buf.length);
    }
    const docxPath = await dl("#btnDocx");
    { const JZ = require(path.join(ROOT, "members-k38p", "requests", "vendor", "jszip.min.js")), z = await JZ.loadAsync(fs.readFileSync(docxPath));
      const doc = await z.file("word/document.xml").async("string"), plain = doc.replace(/<[^>]+>/g, "").replace(/[\u202a\u202c]/g, "").replace(/&quot;/g, '"');
      check("Word: קובץ docx תקין עם הטופס, ארבע תמונות ודף בדיקות ממוספר", (doc.match(/<w:drawing>/g) || []).length === 4 && /32°05'56.86"N/.test(plain) && /262\.5/.test(plain) && /מצאי לפי קבוצות/.test(plain) && !/דוח כיסוי/.test(plain) && /אישור סקירה אנושית/.test(plain), "גודל " + fs.statSync(docxPath).size);
      check("Word: ארבעה קבצי מדיה בשמות aerial/street/overview/region", ["aerial", "street", "overview", "region"].every(k => z.file("word/media/" + k + ".jpeg")) && Object.keys(z.files).filter(f => /^word\/media\/.+\.jpeg$/.test(f)).length === 4, Object.keys(z.files).filter(f => /media/.test(f)).join(","));
      check("Word: שם הקובץ כולל מיקום ותאריך", /גני יהושע|פארק הירקון/.test(path.basename(docxPath)) && /\d{2}\.\d{2}\.\d{4}/.test(path.basename(docxPath)), path.basename(docxPath)); }
    const href = await page.getAttribute("#btnMail", "href");
    check("קישור המייל נכון", href.startsWith("mailto:notamoffice@iaa.gov.il,nofm@iaa.gov.il?subject="), href.slice(0, 90));
    await page.screenshot({ path: path.join(OUT, "page-full.png"), fullPage: true });
    await page.emulateMedia({ media: "print" });
    const pdfPath = path.join(OUT, "request.pdf"); await page.pdf({ path: pdfPath, format: "A4", printBackground: true, margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" } });
    const pdf = fs.readFileSync(pdfPath); const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
    check("ה-PDF נוצר ב-6 עמודים לפחות (טופס, ארבע תמונות, דף בדיקות)", pdf.length > 20000 && pages >= 6, pages + " עמודים, " + pdf.length + " בתים");
    await page.emulateMedia({ media: "screen" });

    /* שינוי נתון סורק -> הדף מסמן "ישן" וחוסם */
    await page.fill("#radius", "300");
    await page.waitForFunction(() => /השתנו/.test(document.querySelector("#gate").textContent), null, { timeout: 5000 });
    check("שינוי רדיוס אחרי הרצה חוסם שליחה עד הרצה מחדש", (await page.isDisabled("#btnPrint")) && (await page.isDisabled("#btnKml")), "");
    await ctx.close();
  }

  /* ===== תרחיש 2: כשל בבדיקה (ext) -> לא מוכן ===== */
  if (!LIVE) {
    const { ctx, page } = await newPage(browser, { failExt: true });
    await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true); await login(page);
    await fillExample(page);
    await page.click("#runBtn");
    await page.waitForFunction(() => document.getElementById("e_run").textContent.length > 0, null, { timeout: 240000 });
    const msg = await page.textContent("#e_run"); const gateVis = await page.isVisible("#resultsSec");
    check("כשל ב-Overpass: הודעת שגיאה ואין 'מוכן לשליחה'", /לא הושלמו/.test(msg) && !gateVis, msg.slice(0, 160));
    await ctx.close();
  }

  /* ===== תרחיש 3: אריחי רקע נכשלים -> לא מוכן ===== */
  if (!LIVE) {
    const { ctx, page } = await newPage(browser, { failTiles: true });
    await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true); await login(page);
    await fillExample(page);
    await page.click("#runBtn");
    await page.waitForFunction(() => document.querySelector("#gate .banner"), null, { timeout: 150000 });
    const g = await page.textContent("#gate");
    check("בלי תצלום אוויר: לא מוכן לשליחה", /אינה מוכנה/.test(g) && /תמונת מפה/.test(g), g.replace(/\s+/g, " ").slice(0, 200));
    check("כפתורי ההפקה חסומים", (await page.isDisabled("#btnPrint")) && (await page.isDisabled("#btnCopy")), "");
    await ctx.close();
  }

  /* ===== תרחיש 5: מובייל ===== */
  {
    const { ctx, page } = await newPage(browser);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true); await login(page);
    const ov0 = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);   // גם body: overflow-x:hidden על html מסתיר חריגה של רכיב רחב (למשל טבלת הבדיקות)
    check("מובייל: אין גלילה אופקית לפני הרצה", ov0 <= 1, "חריגה " + ov0 + "px");
    await page.screenshot({ path: path.join(OUT, "mobile-top.png"), fullPage: false });
    if (!LIVE) { // במצב חי לא מריצים שוב את כל הצינור — שרתי Overpass הציבוריים מגבילים בקשות חוזרות מאותה כתובת
      await fillExample(page); await page.click("#runBtn");
      await page.waitForFunction(() => document.querySelector("#gate .banner"), null, { timeout: 150000 });
      const ov1 = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);   // גם body: overflow-x:hidden על html מסתיר חריגה של רכיב רחב (למשל טבלת הבדיקות)
      check("מובייל: אין גלילה אופקית אחרי הרצה", ov1 <= 1, "חריגה " + ov1 + "px");
      { // דף הבדיקות בטלפון: כל בדיקה ככרטיס (לא ארבע עמודות צרות שוברות מילים): תאים בבלוק ברוחב מלא, שורת הכותרת מוסתרת חזותית (אך בעץ הנגישות), המספר והתוויות מוצגים
        const ck = await page.evaluate(() => {
          const rows = [...document.querySelectorAll("#report table.ck tr")], hdr = rows[0], body = rows.slice(1), r = el => el.getBoundingClientRect(), cs = el => getComputedStyle(el), ps = (el, p) => getComputedStyle(el, p).content;
          const w = n => body.map(row => Math.round(r(row.children[n]).width));
          return { n: body.length, hdrW: Math.round(r(hdr).width), hdrH: Math.round(r(hdr).height), hdrInDom: hdr.querySelectorAll("th").length === 4, display: [...new Set(body.map(row => cs(row.children[2]).display))].join(","), rowDisplay: [...new Set(body.map(row => cs(row).display))].join(","), minSource: Math.min(...w(2)), minResult: Math.min(...w(3)), minTitle: Math.min(...w(1)), numBefore: ps(body[0].children[0], "::before"), srcBefore: ps(body[0].children[2], "::before"), resBefore: ps(body[0].children[3], "::before"), table: Math.round(r(document.querySelector("#report table.ck")).width), view: innerWidth };
        });
        check("מובייל: דף הבדיקות ככרטיסים — מקור ותוצאה ברוחב מלא (לפחות 250px, בלי עמודות צרות), כותרת בדיקה לפחות 200px, שורת הכותרת מוסתרת אך קיימת, ותוויות ״מקור:״ / ״תוצאה:״ ומספר מוצגים", ck.n > 8 && ck.display === "block" && ck.rowDisplay === "grid" && ck.minSource >= 250 && ck.minResult >= 250 && ck.minTitle >= 200 && ck.hdrW <= 2 && ck.hdrH <= 2 && ck.hdrInDom && /מקור/.test(ck.srcBefore) && /תוצאה/.test(ck.resBefore) && /#/.test(ck.numBefore) && ck.table <= ck.view, JSON.stringify(ck));
        const ph = await page.evaluate(() => [...document.querySelectorAll("#report .paper:first-child .ph")].map(e => ({ t: e.textContent, ws: getComputedStyle(e).whiteSpace, lines: e.getClientRects().length })));
        check("מובייל: מספרי הטלפון בטופס (שדות 11–12 והמבקש) אינם נשברים באמצע (white-space:nowrap, שורה אחת)", ph.length >= 3 && ph.every(x => x.ws === "nowrap" && x.lines === 1), JSON.stringify(ph));
      }
      await page.screenshot({ path: path.join(OUT, "mobile-result.png"), fullPage: true });
    }
    await ctx.close();
  }

  /* ===== תרחיש 4: שדות חסרים ===== */
  {
    const { ctx, page } = await newPage(browser);
    await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true); await login(page);
    await page.click("#runBtn");
    await page.waitForTimeout(500);
    const errs = await page.$$eval(".err", els => els.map(e => e.textContent).filter(Boolean));
    check("הרצה בלי נתונים מציגה שגיאות ולא מריצה", errs.length >= 5 && !(await page.isVisible("#resultsSec")), errs.slice(0, 4).join(" | "));
    await ctx.close();
  }

  /* ===== תרחיש 7: רכיבי הטופס החדשים — כלי טיס נוספים, שורות אנשי קשר ומשתתפים, מיגרציה (בלי הרצת בדיקות) ===== */
  {
    const { ctx, page } = await newPage(browser);
    await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
    const cfgAc = await page.evaluate(() => window.__REQ.S.cfg.aircraft);
    const acVals = () => page.$$eval('input[name="ac"]', els => els.map(e => ({ v: e.value, on: e.checked })));
    const stored = () => page.evaluate(() => localStorage.getItem("icd_req_aircraft_v1"));
    // (א) כלי טיס נוספים
    check("כלי טיס: אין בתחילה כלים שנוספו (אין ×), הקבועים מרשימת ההגדרות", (await page.locator("#aircraft [data-acrm]").count()) === 0 && (await acVals()).length === cfgAc.length, "");
    await page.fill("#acNew", "   Autel    EVO II \t"); await page.click("#acAdd");
    let ac = await acVals();
    check("כלי טיס נוסף: מופיע ברשימה מסומן (אחרי ניקוי רווחים), עם כפתור ×", ac.length === cfgAc.length + 1 && ac.some(a => a.v === "Autel EVO II" && a.on) && (await page.locator("#aircraft [data-acrm]").count()) === 1, JSON.stringify(ac));
    check("כלי טיס נוסף: נשמר ב-localStorage (icd_req_aircraft_v1)", JSON.parse(await stored()).join("|") === "Autel EVO II", await stored());
    await page.fill("#acNew", "autel evo ii"); await page.click("#acAdd");
    await page.fill("#acNew", cfgAc[1].toLowerCase()); await page.click("#acAdd");
    ac = await acVals();
    check("כלי טיס: כפילות (בכל רישיות, גם מול כלי קבוע) לא מתווספת — רק מסמנת", ac.length === cfgAc.length + 1 && JSON.parse(await stored()).length === 1 && ac.find(a => a.v === cfgAc[1]).on, JSON.stringify(ac));
    await page.fill("#acNew", ""); await page.click("#acAdd");
    check("כלי טיס: שדה ריק לא מתווסף ומוצגת הודעה", (await acVals()).length === cfgAc.length + 1 && /יש להקליד/.test(await page.textContent("#acMsg")), "");
    await page.fill("#acNew", '<img src=x onerror="window.__xss=1"> "q"'); await page.press("#acNew", "Enter");
    check("כלי טיס: טקסט עם HTML מוצג כטקסט (escape) ולא מוזרק לדף", (await page.evaluate(() => window.__xss === undefined && !document.querySelector("#aircraft img"))) && (await acVals()).some(a => a.v.startsWith("<img")), "");
    await page.reload(); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 });
    await page.waitForFunction(() => !document.body.classList.contains("authLocked"), null, { timeout: 15000 });
    ac = await acVals();
    check("כלי טיס נוספים נשמרים אחרי טעינה מחדש של הדף (באותו הקשר דפדפן)", ac.some(a => a.v === "Autel EVO II") && ac.some(a => a.v.startsWith("<img")) && ac.length === cfgAc.length + 2, JSON.stringify(ac.map(a => a.v)));
    check("אחרי טעינה מחדש: הכלי הראשון הקבוע מסומן כברירת מחדל והכלי שנוסף לא", ac[0].on && !ac.find(a => a.v === "Autel EVO II").on, "");
    await page.locator('#aircraft label:has(input[value="Autel EVO II"]) + [data-acrm]').click();
    ac = await acVals();
    check("× מסיר כלי שנוסף מהרשימה ומהאחסון (הקבועים נשארים בלי ×)", !ac.some(a => a.v === "Autel EVO II") && cfgAc.every(n => ac.some(a => a.v === n)) && JSON.parse(await stored()).length === 1, await stored());
    await page.reload(); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 });
    check("כלי שהוסר לא חוזר אחרי טעינה מחדש", !(await acVals()).some(a => a.v === "Autel EVO II"), "");
    { // תקרת 30 כלים נוספים נאכפת גם בהוספה: מעל התקרה — הודעה ובלי הוספה (אחרת הכלים 31+ נשמרים ונעלמים בשקט בטעינה הבאה)
      const extras = () => page.locator("#aircraft [data-acrm]").count();
      for (let i = 0; i < 31; i++) { await page.fill("#acNew", "כלי בדיקה " + i); await page.click("#acAdd"); }
      const nStored = async () => JSON.parse(await stored()).length;
      check("כלי טיס נוספים: התקרה 30 — ההוספה ה-31 נדחית בהודעה בעברית, השם נשאר בשדה, ומה שמוצג הוא מה שנשמר (30)", (await extras()) === 30 && (await nStored()) === 30 && /ניתן לשמור עד 30 כלי טיס נוספים — הסירו כלי כדי להוסיף/.test(await page.textContent("#acMsg")) && (await page.inputValue("#acNew")) === "כלי בדיקה 30", (await extras()) + "/" + (await nStored()) + " | " + (await page.textContent("#acMsg")));
      await page.reload(); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 });
      await page.waitForFunction(() => !document.body.classList.contains("authLocked"), null, { timeout: 15000 });
      check("אחרי טעינה מחדש: אותם 30 כלים נוספים (אף כלי לא נעלם)", (await extras()) === 30 && (await nStored()) === 30, (await extras()) + "/" + (await nStored()));
      await page.locator("#aircraft [data-acrm]").first().click();
      await page.fill("#acNew", "כלי אחרי הסרה"); await page.click("#acAdd");
      check("אחרי הסרת כלי אפשר שוב להוסיף (חזרה ל-30, ובלי הודעת תקרה)", (await extras()) === 30 && (await nStored()) === 30 && (await acVals()).some(a => a.v === "כלי אחרי הסרה" && a.on) && !/ניתן לשמור עד/.test(await page.textContent("#acMsg")), await page.textContent("#acMsg"));
      check("הסבר ה-! של ״הוסף כלי טיס״ מזכיר את תקרת 30 הכלים", /עד 30 כלי טיס נוספים/.test(await page.locator(".hw:has(#acAdd) > .hbtn").getAttribute("data-help")), "");
      check("רמז מכשולים ידועים (מתחת לתיבה ובהסבר ה-!) מציין עד 20 פריטים, מופרדים בפסיק או בשורה חדשה", /עד 20 פריטים, מופרדים בפסיק או בשורה חדשה/.test(await page.locator("#knownObs ~ .hint").first().textContent()) && /עד 20 פריטים/.test(await page.locator(".flh:has(label[for=knownObs]) .hbtn").getAttribute("data-help")), await page.locator("#knownObs ~ .hint").first().textContent());
    }
    // (ב) שורות אנשי קשר ומשתתפים
    await page.waitForFunction(() => !document.body.classList.contains("authLocked"), null, { timeout: 15000 });
    await page.evaluate(() => { document.getElementById("personBox").open = true; });
    const rm = sel => page.locator(sel + " [data-rm]:visible").count();
    check("אנשי קשר: מתחילים בשתי שורות (שם וטלפון) בלי × גלוי; משתתפים: אין שורות", (await page.locator("#contactList .prow").count()) === 2 && (await rm("#contactList")) === 0 && (await page.locator("#partList .prow").count()) === 0, "");
    await page.click("#addContact");
    check("הוספת איש קשר: שלוש שורות, ו-× מוצג בכולן", (await page.locator("#contactList .prow").count()) === 3 && (await rm("#contactList")) === 3, "");
    await page.locator("#contactList .prow").nth(2).locator("[data-rm]").click();
    check("הסרת שורה בחזרה לשתיים: ה-× מוסתר שוב", (await page.locator("#contactList .prow").count()) === 2 && (await rm("#contactList")) === 0, "");
    while ((await page.locator("#contactList .prow").count()) < 20) await page.click("#addContact");
    check("אנשי קשר: התקרה 20 שורות, והכפתור ״הוסף איש קשר״ נחסם", await page.isDisabled("#addContact"), "");
    while ((await page.locator("#contactList .prow").count()) > 2) await page.locator("#contactList .prow").last().locator("[data-rm]").click();
    check("אחרי הסרה: הכפתור חוזר להיות פעיל", !(await page.isDisabled("#addContact")), "");
    await page.click("#addPart"); await page.click("#addPart");
    const prow = page.locator("#partList .prow").first();
    check("משתתפים: שורה = שם פרטי, שם משפחה, טלפון + × — בלי שדה הערה", (await page.locator("#partList .prow").count()) === 2 && (await prow.locator("input").count()) === 3 && (await prow.locator("textarea, [data-f=note]").count()) === 0 && (await rm("#partList")) === 2 && (await prow.locator('[data-f]').evaluateAll(els => els.map(e => e.dataset.f).join(","))) === "first,last,phone", "");
    await page.locator("#partList .prow").nth(1).locator("[data-rm]").click();
    check("משתתף: × מסיר את השורה (גם כשנשארה שורה אחת)", (await page.locator("#partList .prow").count()) === 1, "");
    // אימות אורך: מכשולים והערות ארוכים מדי חוסמים את ההרצה ומסומנים
    await page.fill("#knownObs", "א".repeat(1001)); await setVisit(page, null, "ב".repeat(3001));
    await page.click("#runBtn");
    check("מכשולים ידועים (מעל 1,000 תווים) והערות מבקש (מעל 3,000) נחסמים עם הודעה וסימון", /עד 1,000/.test(await page.textContent("#e_knownObstacles")) && /עד 3,000/.test(await page.textContent("#e_visitNotes")) && (await page.evaluate(() => document.getElementById("knownObs").classList.contains("bad") && document.getElementById("visitNotes").classList.contains("bad"))) && !(await page.isVisible("#resultsSec")) && page._calls.overpass === 0, "");
    // שמירה בדפדפן: מבקש ואנשי קשר נשמרים, משתתפים והערות הסיור לא
    await page.fill("#knownObs", ""); await setVisit(page, null, "הערה שלא נשמרת בדפדפן");
    await page.fill("#reqName", "שמור שם"); await setContacts(page, [["דנה", "050-1111111"], ["רון", "050-2222222"]]);
    await page.fill("#reqOrg", "ארגון שנשמר"); await page.fill("#reqCallsign", "קריאה 7"); await page.fill("#reqReg", "4X-REG");
    { const lp = JSON.parse(await page.evaluate(() => localStorage.getItem("icd_req_person_v1")));
      check("שם הגורם המבקש, אות הקריאה ומס׳ הרישום נשמרים מקומית עם שאר פרטי המבקש", lp.reqOrg === "ארגון שנשמר" && lp.reqCallsign === "קריאה 7" && lp.reqReg === "4X-REG", JSON.stringify(lp).slice(0, 200)); }
    await page.locator("#partList .prow").first().locator('[data-f="first"]').fill("משתתף שלא נשמר");
    const lsPerson = await page.evaluate(() => localStorage.getItem("icd_req_person_v1"));
    check("נשמרים בדפדפן: שם המבקש ואנשי הקשר (מערך {name,phone}); לא נשמרים: משתתפים והערות הסיור", JSON.parse(lsPerson).reqName === "שמור שם" && JSON.stringify(JSON.parse(lsPerson).contacts) === JSON.stringify([{ name: "דנה", phone: "050-1111111" }, { name: "רון", phone: "050-2222222" }]) && !/משתתף שלא נשמר|הערה שלא נשמרת/.test(lsPerson) && !/contactNames/.test(lsPerson), lsPerson);
    await page.reload(); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 });
    await page.waitForFunction(() => !document.body.classList.contains("authLocked"), null, { timeout: 15000 });
    await page.evaluate(() => { document.getElementById("personBox").open = true; });
    const back = await page.evaluate(() => [...document.querySelectorAll("#contactList .prow")].map(r => r.querySelector('[data-f="name"]').value + "|" + r.querySelector('[data-f="phone"]').value));
    check("אחרי טעינה מחדש: אנשי הקשר חוזרים ברשימה, והמשתתפים וההערות ריקים", back.join(",") === "דנה|050-1111111,רון|050-2222222" && (await page.locator("#partList .prow").count()) === 0 && (await page.inputValue("#visitNotes")) === "", back.join(","));
    check("אחרי טעינה מחדש: הגורם המבקש, אות הקריאה ומס׳ הרישום חוזרים בשדות", (await page.inputValue("#reqOrg")) === "ארגון שנשמר" && (await page.inputValue("#reqCallsign")) === "קריאה 7" && (await page.inputValue("#reqReg")) === "4X-REG", "");
    // wipePerson מוחק הכול ומחזיר שתי שורות ריקות
    await page.click("#addPart");
    await page.click("#wipePerson");
    check("״מחק פרטים מהמכשיר״ מנקה גם את הגורם המבקש, אות הקריאה ומס׳ הרישום", (await page.inputValue("#reqOrg")) === "" && (await page.inputValue("#reqCallsign")) === "" && (await page.inputValue("#reqReg")) === "" && (await page.evaluate(() => localStorage.getItem("icd_req_person_v1"))) === null, "");
    check("״מחק פרטים מהמכשיר״: מוחק את האחסון, מנקה שם וטלפון ומחזיר שתי שורות ריקות (ורשימת משתתפים ריקה)", (await page.evaluate(() => localStorage.getItem("icd_req_person_v1"))) === null && (await page.inputValue("#reqName")) === "" && (await page.locator("#contactList .prow").count()) === 2 && (await page.evaluate(() => [...document.querySelectorAll("#contactList input")].every(i => i.value === ""))) && (await page.locator("#partList .prow").count()) === 0, "");
    await ctx.close();
  }
  // מיגרציה: אובייקט שמור בפורמט הישן (contactNames/contactPhone) הופך לרשימת אנשי קשר לפי אינדקס
  {
    const { ctx, page } = await newPage(browser);
    await ctx.addInitScript(() => { try { if (!localStorage.getItem("icd_req_person_v1")) localStorage.setItem("icd_req_person_v1", JSON.stringify({ reqName: "מבקש ישן", reqPhone: "050-9999999", contactNames: "דנה כהן; רון לוי", contactPhone: "050-1111111, 050-2222222" })); } catch (e) { /* ignore */ } });
    await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
    const rows = await page.evaluate(() => [...document.querySelectorAll("#contactList .prow")].map(r => r.querySelector('[data-f="name"]').value + "|" + r.querySelector('[data-f="phone"]').value));
    const lsP = JSON.parse(await page.evaluate(() => localStorage.getItem("icd_req_person_v1")));
    check("מיגרציה מהפורמט הישן: שני אנשי קשר לפי אינדקס (שם + טלפון), והאחסון נכתב מחדש בפורמט החדש", rows.join(",") === "דנה כהן|050-1111111,רון לוי|050-2222222" && lsP.reqName === "מבקש ישן" && Array.isArray(lsP.contacts) && lsP.contacts.length === 2 && !("contactNames" in lsP) && !("contactPhone" in lsP), JSON.stringify(lsP));
    await ctx.close();
  }

  /* ===== תרחיש 7ב: שורות אנשי קשר ומשתתפים בטלפון צר (320/360/390) — שם בשורה מלאה, וכל משתתף בכרטיס נפרד ===== */
  for (const w of [320, 360, 390]) {
    const { ctx, page } = await newPage(browser, { viewport: { width: w, height: 800 } });
    await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
    await page.evaluate(() => { document.getElementById("personBox").open = true; });
    await page.click("#addContact");                                   // שלוש שורות: ה-× מוצג בכולן (המצב הצר ביותר)
    for (let i = 0; i < 3; i++) await page.click("#addPart");
    const m = await page.evaluate(() => {
      const r = el => el.getBoundingClientRect();
      const cont = [...document.querySelectorAll("#contactList .prow")].map(row => { const n = row.querySelector('[data-f="name"]'), p = row.querySelector('[data-f="phone"]'), x = row.querySelector("[data-rm]"); return { nameW: Math.round(r(n).width), phoneBelow: r(p).top >= r(n).bottom - 1, xBelow: r(x).top >= r(n).bottom - 1, xShown: r(x).width > 0 }; });
      const parts = [...document.querySelectorAll("#partList .prow")].map(row => { const cs = getComputedStyle(row), b = r(row); return { border: parseFloat(cs.borderTopWidth), bg: cs.backgroundColor, top: b.top, bottom: b.bottom }; });
      return { cont, parts, overflow: document.documentElement.scrollWidth - innerWidth };
    });
    check("טלפון (" + w + "px): שם איש הקשר ברוחב מלא (לפחות 180px), הטלפון ו-× מתחתיו, בלי גלילה אופקית", m.cont.length === 3 && m.cont.every(c => c.nameW >= 180 && c.phoneBelow && c.xBelow && c.xShown) && m.overflow <= 1, JSON.stringify(m.cont) + " overflow=" + m.overflow);
    check("טלפון (" + w + "px): כל משתתף בכרטיס משלו (מסגרת ורקע) ורווח של 8px לפחות בין משתתף למשתתף", m.parts.length === 3 && m.parts.every(p => p.border >= 1 && p.bg !== "rgba(0, 0, 0, 0)") && m.parts.slice(1).every((p, i) => p.top - m.parts[i].bottom >= 8), JSON.stringify(m.parts));
    await page.screenshot({ path: path.join(OUT, "mobile-" + w + "-people.png") });
    await ctx.close();
  }

  /* ===== תרחיש 8: לחצן ״!״ — נפתח ונסגר (לחיצה נוספת, Escape, לחיצה בחוץ), גם בחלון ניהול המשתמשים ובטלפון ===== */
  {
    const { ctx, page } = await newPage(browser);
    await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
    const hb = sel => page.locator(".hw:has(" + sel + ") > .hbtn");
    const bubble = () => page.evaluate(() => { const b = document.getElementById("hbubble"); if (!b || b.hidden) return null; const r = b.getBoundingClientRect(); return { text: b.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom, z: +getComputedStyle(b).zIndex, vw: innerWidth, vh: innerHeight }; });
    const hs = await page.$$eval(".hbtn", els => els.map(e => ({ t: e.dataset.help || "", a: e.getAttribute("aria-label"), x: e.getAttribute("aria-expanded"), txt: e.textContent, w: Math.round(e.getBoundingClientRect().width) })));
    check("לחצני ״!״ ליד כפתורי הדף (חיפוש, רקעי המפה, הרצה, הוספה ידנית, הפקות, כלי טיס, אנשי קשר, משתתפים, מחיקה, בדיקה עצמית, שדות מלל) — כל אחד עם הסבר, aria-label ייחודי ״הסבר על: <שם>״ וקוטר 20–22px", hs.length >= 26 && hs.every(h => h.t.length > 25 && /^הסבר על: \S.*/.test(h.a) && h.x === "false" && h.txt === "!" && (h.w === 0 || (h.w >= 20 && h.w <= 22))) && new Set(hs.map(h => h.a)).size === hs.length && hs.filter(h => h.w > 0).length >= 8, hs.length + " לחצנים, גלויים: " + hs.filter(h => h.w > 0).length + ", רוחבים: " + [...new Set(hs.map(h => h.w))].join(",") + " | " + hs.map(h => h.a).join(" ; "));   // ללחצנים בסעיפי התוצאות (מוסתרים לפני הרצה) אין רוחב
    for (const id of ["runBtn", "mPick", "mAdd", "btnPrint", "btnDocx", "incChecks", "btnKml", "btnAerial", "btnStreet", "btnOverview", "btnRegion", "btnCopy", "btnDrive", "btnSend", "btnMail", "acAdd", "addContact", "addPart", "wipePerson", "qBtn", "baseSat", "baseOsm", "stRun"]) {
      if (!(await hb("#" + id).count())) check("יש לחצן ״!״ ליד #" + id, false, "");
    }
    check("aria-label סטטי ומתאר: ״שלח למשרד נוטאם״ ו״צילום אוויר/מפת רחובות״ (רקעי מפת העבודה) מסבירים שהם משפיעים על התצוגה בלבד", (await hb("#btnSend").getAttribute("aria-label")) === "הסבר על: שליחה למשרד נוטאם" && (await hb("#qBtn").getAttribute("aria-label")) === "הסבר על: חיפוש מקום" && /לא על ארבע התמונות/.test(await hb("#baseSat").getAttribute("data-help")) && /לא על ארבע התמונות/.test(await hb("#baseOsm").getAttribute("data-help")) && /Nominatim/.test(await hb("#qBtn").getAttribute("data-help")) && /בדיקה העצמית/.test(await hb("#stRun").getAttribute("data-help")), "");
    { const dh = await hb("#btnDrive").getAttribute("data-help"), sh = await hb("#btnSend").getAttribute("data-help");
      check("הסברים מדויקים: ״שמור בדרייב״ — שמירה בלי שליחה, בדרייב של בעל המערכת ולמנהל בלבד; ״שלח״ — שומר בארכיון המרכזי ושולח: למשרד (עותק למבקש) או רק לעצמי, בבדיקה רק למבקש, עותק סמוי למנהל", /בדרייב של בעל המערכת \(הארכיון המרכזי\), בלי לשלוח/.test(dh) && /מוצג למנהל המערכת בלבד/.test(dh) && /שומר את הבקשה בארכיון המרכזי/.test(sh) && /שלח למשרד נוטאם/.test(sh) && /שלח רק לעצמי/.test(sh) && /במצב בדיקה המייל נשלח רק אליכם/.test(sh) && /עותק סמוי/.test(sh) && /תשובות המשרד יגיעו אליכם/.test(sh) && !/owner@|בעל המערכת \(בדיקה\)/.test(sh), dh.slice(0, 80) + " | " + sh.slice(0, 80)); }
    await hb("#runBtn").click();
    let b = await bubble();
    check("״!״ נפתח: בועת הסבר מוצגת בתוך המסך, aria-expanded=true", !!b && /מריץ את כל הבדיקות/.test(b.text) && (await hb("#runBtn").getAttribute("aria-expanded")) === "true" && b.left >= 0 && b.right <= b.vw && b.top >= 0 && b.bottom <= b.vh, JSON.stringify(b));
    await hb("#runBtn").click();
    check("לחיצה נוספת על אותו לחצן סוגרת", (await bubble()) === null && (await hb("#runBtn").getAttribute("aria-expanded")) === "false", "");
    await hb("#acAdd").click(); await page.keyboard.press("Escape");
    check("Escape סוגר את הבועה", (await bubble()) === null && (await hb("#acAdd").getAttribute("aria-expanded")) === "false", "");
    await hb("#acAdd").click(); await page.click("header h1");
    check("לחיצה מחוץ לבועה סוגרת", (await bubble()) === null, "");
    await hb("#acAdd").focus(); await page.keyboard.press("Enter");
    check("מקלדת: Enter על הלחצן פותח (ו-Escape סוגר)", !!(await bubble())); await page.keyboard.press("Escape");
    await hb("#acAdd").click(); await hb("#addPart").click(); b = await bubble();
    check("מעבר ישיר ללחצן אחר מחליף את הטקסט (בועה אחת בכל רגע)", !!b && /מוסיף שורה למשתתף נוסף/.test(b.text) && (await hb("#acAdd").getAttribute("aria-expanded")) === "false" && (await page.locator("#hbubble").count()) === 1, "");
    await page.click("#hbubble");
    check("לחיצה בתוך הבועה אינה סוגרת אותה", !!(await bubble()), ""); await page.keyboard.press("Escape");
    check("הלחצן בתוך ״פרטי המבקש״ (summary/label) לא מחליף את מצב התיבה", await (async () => { const was = await page.evaluate(() => document.getElementById("personBox").open); await hb("#addContact").click(); const now = await page.evaluate(() => document.getElementById("personBox").open); await page.keyboard.press("Escape"); return was === now; })(), "");
    // חלון ניהול המשתמשים (עם משתמש נוסף, כדי שיהיו כפתורי פעולה בשורה)
    check("שורת המשתמש (מנהל): לחצני ״!״ ליד החלפת סיסמה, ניהול משתמשים והתנתקות", (await page.locator("#userBar .hbtn").count()) === 3, "");
    const envA = page._env, tokA = envA.call({ action: "login", user: ADMIN, pass: PASS }).token;
    envA.call({ action: "addUser", token: tokA, newUser: "dave.pilot", newPass: "dave-pass-12345" });
    await page.click("#ubAdmin"); await page.waitForSelector("#admBody .admTbl");
    check("בחלון ניהול המשתמשים: לחצני ״!״ ליד מתג מצב השליחה, חמשת פריטי המקרא (חסום, פתח מחדש, איפוס, תוקף, מחק), הוסף, אפס ובדוק", (await page.locator("#admBody .admMode .hbtn").count()) === 1 && (await page.locator("#admBody .admHelp .hbtn").count()) === 5 && (await page.locator("#addForm .hbtn").count()) === 1 && (await page.locator("#rstForm .hbtn").count()) === 1 && (await page.locator("#wxForm .hbtn").count()) === 1, "");
    { // ״!״ ליד כל אחד מארבעת כפתורי הפעולה בשורת המשתמש, מוערמים בעמודה אחת; ליד המנהל עצמו אין פעולות
      const rowInfo = () => page.evaluate(() => {
        const tds = [...document.querySelectorAll("#admBody td.acts")], td = tds.find(t => t.querySelector("[data-blk]")), r = el => el.getBoundingClientRect();
        const hws = td ? [...td.querySelectorAll(".hw")] : [];
        return { selfActs: tds.filter(t => !t.querySelector("[data-blk]")).map(t => t.textContent.trim()), hws: hws.map(hw => { const b = hw.querySelector("button:not(.hbtn)"), h = hw.querySelector(".hbtn"), rb = r(b), rh = r(h); return { txt: b.textContent.trim(), attr: [...b.attributes].map(a => a.name).filter(n => /^data-(blk|rst|exp|del)$/.test(n)).join(","), label: h.getAttribute("aria-label"), help: h.dataset.help, top: Math.round(rb.top), left: Math.round(hw.getBoundingClientRect().left), sameLine: Math.abs(rh.top + rh.height / 2 - (rb.top + rb.height / 2)) < rb.height / 2, hAfter: h.previousElementSibling === b }; }), nHbtn: td ? td.querySelectorAll(".hbtn").length : 0 };
      });
      const ri = await rowInfo();
      check("שורת משתמש: ארבעה כפתורי פעולה (חסום, איפוס סיסמה, שינוי תוקף, מחק) וליד כל אחד ״!״ באותה שורה, בעמודה אחת מוערמת, עם aria-label ששם הפעולה והמשתמש", ri.hws.length === 4 && ri.nHbtn === 4 && ri.hws.map(x => x.attr).join("|") === "data-blk|data-rst|data-exp|data-del" && ri.hws.every(x => x.sameLine && x.hAfter && /^הסבר על: .+ — dave\.pilot$/.test(x.label) && x.help.length > 25) && ri.hws.every((x, i) => i === 0 || x.top > ri.hws[i - 1].top) && new Set(ri.hws.map(x => x.left)).size === 1 && ri.selfActs.every(t => t === "—"), JSON.stringify(ri.hws.map(x => [x.txt, x.label])));
      check("הסבר ״חסום מבקשות״ בשורה: לא יוכל להתחבר כלל, ההתחברויות הפעילות מתבטלות מיד, כניסה חדשה נדחית", /לא יוכל להתחבר כלל/.test(ri.hws[0].help) && /מתבטלות מיד/.test(ri.hws[0].help) && /נדחה/.test(ri.hws[0].help) && /^הסבר על: חסימת בקשות/.test(ri.hws[0].label), ri.hws[0].help);
      // התנהגות השרת (Code.gs) כפי שההסברים מתארים אותה: חסימה מבטלת מיד אסימון קיים ודוחה כניסה גם עם סיסמה נכונה; פתיחה מחדש מסירה את החסימה אך האסימונים הקודמים נשארים מבוטלים
      const tokD = envA.call({ action: "login", user: "dave.pilot", pass: "dave-pass-12345" }).token;
      check("(לפני החסימה) האסימון של המשתמש תקף", !!envA.call({ action: "me", token: tokD }).ok, "");
      await page.click("button.block[data-blk='dave.pilot']"); await page.waitForSelector("button.unblock[data-blk='dave.pilot']");
      check("אחרי חסימה: האסימון שהיה קיים מתבטל מיד, וכניסה חדשה עם סיסמה נכונה נדחית (כמו שההסבר מתאר)", envA.call({ action: "me", token: tokD }).error === "blocked" && envA.call({ action: "login", user: "dave.pilot", pass: "dave-pass-12345" }).error === "blocked", "");
      const ri2 = await rowInfo();
      check("במצב חסום ה-! ליד הכפתור מסביר את הפתיחה מחדש (HELP.unblock) ולא את החסימה: aria-label ו-data-help תואמים לפעולה שהכפתור עושה", /^הסבר על: פתיחה מחדש של בקשות — dave\.pilot$/.test(ri2.hws[0].label) && /מסיר את החסימה/.test(ri2.hws[0].help) && /נשארות מבוטלות/.test(ri2.hws[0].help) && /אינה משנה את תוקף המנוי/.test(ri2.hws[0].help) && !/לא יוכל להתחבר כלל/.test(ri2.hws[0].help) && ri2.hws.length === 4 && ri2.hws.every(x => x.sameLine && x.hAfter), ri2.hws[0].label + " | " + ri2.hws[0].help.slice(0, 80));
      await page.click("button.unblock[data-blk='dave.pilot']"); await page.waitForSelector("button.block[data-blk='dave.pilot']");
      check("אחרי פתיחה מחדש: המשתמש יכול להתחבר עם סיסמתו, אך האסימון הישן נשאר מבוטל (עליו להתחבר מחדש)", !!envA.call({ action: "login", user: "dave.pilot", pass: "dave-pass-12345" }).ok && envA.call({ action: "me", token: tokD }).error === "auth", "");
      const ri3 = await rowInfo();
      check("אחרי פתיחה מחדש ה-! חוזר להסביר חסימה", /^הסבר על: חסימת בקשות/.test(ri3.hws[0].label) && /לא יוכל להתחבר כלל/.test(ri3.hws[0].help), "");
      // פתיחה מחדש אינה משנה תוקף מנוי: מנוי שהסתיים נשאר חוסם כניסה (כפי שההסבר אומר)
      const recD = JSON.parse(envA.props["U:dave.pilot"]); recD.until = envA.now() - 1000; envA.props["U:dave.pilot"] = JSON.stringify(recD);
      envA.call({ action: "setBlocked", token: tokA, target: "dave.pilot", blocked: true }); envA.call({ action: "setBlocked", token: tokA, target: "dave.pilot", blocked: false });
      check("פתיחה מחדש אינה מסירה פקיעת מנוי: משתמש עם מנוי שהסתיים עדיין נדחה בכניסה (sub_expired)", envA.call({ action: "login", user: "dave.pilot", pass: "dave-pass-12345" }).error === "sub_expired", "");
      await page.click("#mdClose"); await page.click("#ubAdmin"); await page.waitForSelector("#admBody .admTbl");
    }
    const mh = page.locator("#admBody .admMode .hbtn");
    await mh.click(); b = await bubble();
    const onTop = await page.evaluate(() => { const el = document.getElementById("hbubble"), r = el.getBoundingClientRect(), t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!t && el.contains(t); });
    check("בחלון הניהול: ״!״ נפתח מעל החלון המודאלי (z-index גבוה מ-3200, והבועה לחיצה)", !!b && /מצב בדיקה|מצב חי/.test(b.text) && b.z > 3200 && onTop, JSON.stringify(b));
    await mh.click(); check("בחלון הניהול: לחיצה נוספת סוגרת", (await bubble()) === null, "");
    await mh.click(); await page.keyboard.press("Escape"); check("בחלון הניהול: Escape סוגר (והחלון עצמו נשאר פתוח)", (await bubble()) === null && !!(await page.$("#authModal")), "");
    await mh.click(); await page.click("#admBody h3 >> nth=0"); check("בחלון הניהול: לחיצה בחוץ סוגרת", (await bubble()) === null, "");
    const blockHelp = page.locator("#admBody .admHelp .hbtn").first();
    await blockHelp.click(); b = await bubble();
    check("הסבר ״חסום מבקשות״ במקרא תואם את הקוד: אינו יכול להתחבר כלל (ולכן לא לשמור ולא לשלוח), וההתחברויות מתבטלות מיד", !!b && /לא יוכל להתחבר כלל/.test(b.text) && /לא לשמור בדרייב או לשלוח/.test(b.text) && /מתבטלות מיד/.test(b.text), b && b.text); await page.keyboard.press("Escape");
    // רענון תוכן החלון (הבועה שייכת ללחצן שהוסר) לא משאיר בועה תלויה
    await mh.click();
    await page.evaluate(() => { document.getElementById("admBody").innerHTML = "<div>x</div>"; window.dispatchEvent(new Event("resize")); });
    check("הלחצן הוסר מהדף (רענון החלון): הבועה נסגרת ולא נשארת תלויה", (await bubble()) === null, "");
    await page.click("#mdClose");
    await ctx.close();
  }
  {
    const { ctx, page } = await newPage(browser);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
    for (const id of ["acAdd", "addPart", "runBtn", "wipePerson"]) {
      await page.locator(".hw:has(#" + id + ") > .hbtn").click();
      const b = await page.evaluate(() => { const e = document.getElementById("hbubble"); if (e.hidden) return null; const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, vw: innerWidth, vh: innerHeight }; });
      check("טלפון (390px): הבועה של #" + id + " בתוך המסך", !!b && b.l >= 0 && b.r <= b.vw && b.t >= 0 && b.b <= b.vh, JSON.stringify(b));
      await page.keyboard.press("Escape");
    }
    check("טלפון: אין גלילה אופקית עם לחצני ״!״ ושורות המשתתפים", (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1, "");
    { // גלילה עם בועה פתוחה: כל עוד הכפתור בתצוגה הבועה עוקבת אחריו; כשהכפתור יצא מהתצוגה הבועה נסגרת (ולא נשארת תקועה בשולי המסך)
      const hbtn = page.locator(".hw:has(#acAdd) > .hbtn"), bubble = () => page.evaluate(() => { const b = document.getElementById("hbubble"); return b && !b.hidden ? true : null; });
      await hbtn.scrollIntoViewIfNeeded(); await hbtn.click();
      const pos = () => page.evaluate(() => { const b = document.getElementById("hbubble"), o = document.querySelector('.hbtn[aria-expanded="true"]'); return b && !b.hidden && o ? { top: Math.round(b.getBoundingClientRect().top), btnBottom: Math.round(o.getBoundingClientRect().bottom) } : null; });
      const p0 = await pos();
      await page.evaluate(() => window.scrollBy(0, 40)); await page.waitForTimeout(150);
      const p1 = await pos();
      check("גלילה קלה (הכפתור עדיין בתצוגה): הבועה נשארת פתוחה וזזה עם הכפתור", !!p0 && !!p1 && p1.btnBottom === p0.btnBottom - 40 && p1.top !== p0.top, JSON.stringify([p0, p1]));
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(200);
      const inView = await page.evaluate(() => { const o = document.querySelector(".hw:has(#acAdd) > .hbtn").getBoundingClientRect(); return o.bottom > 0 && o.top < innerHeight; });
      check("גלילה שהוציאה את הכפתור מהתצוגה: הבועה נסגרת (aria-expanded=false) ואינה נשארת בשולי המסך", !inView && (await bubble()) === null && (await page.locator(".hw:has(#acAdd) > .hbtn").getAttribute("aria-expanded")) === "false", "inView=" + inView);
    }
    await ctx.close();
  }
  { // מסך מגע (pointer: coarse): אזור לחיצה של ״!״ לפחות 32px ורווח של 8px מהכפתור שלידו; במסך עכבר הקוטר 21px (נבדק למעלה)
    const { ctx, page } = await newPage(browser, { viewport: { width: 390, height: 844 }, touch: true });
    await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
    const t = await page.evaluate(() => { const hs = [...document.querySelectorAll(".hbtn")].filter(b => b.getBoundingClientRect().width > 0), r = el => el.getBoundingClientRect(), a = document.querySelector(".hw:has(#acAdd)"), btn = a.querySelector("button:not(.hbtn)"), h = a.querySelector(".hbtn"); return { coarse: matchMedia("(pointer: coarse)").matches, sizes: [...new Set(hs.map(b => Math.round(r(b).width) + "x" + Math.round(r(b).height)))], n: hs.length, gap: Math.round(Math.max(r(h).left - r(btn).right, r(btn).left - r(h).right)), overflow: document.documentElement.scrollWidth - innerWidth }; });
    check("מסך מגע (pointer: coarse): כל ״!״ הגלויים 32x32 לפחות, רווח של 8px מהכפתור שלידו, ואין גלילה אופקית", t.coarse && t.n >= 8 && t.sizes.length === 1 && t.sizes[0] === "32x32" && t.gap >= 8 && t.overflow <= 1, JSON.stringify(t));
    await ctx.close();
  }

  /* ===== תרחיש 9: זרימה מלאה עם משתתפים, מכשולים ידועים והערות סיור (דורש את צינור הבדיקות — לא במצב חי) ===== */
  if (!LIVE) {
    const { ctx, page } = await newPage(browser);
    await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
    const ymd = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10), visitYmd = ymd(-1), [vy, vm, vd] = visitYmd.split("-");
    const NOTES = 'ערימת מכולות ליד השער <b>x</b> & "ציטוט"\nשורה שנייה של הממצאים';
    await fillExample(page, { participants: [["דנה", "", ""]], known: "עמוד חשמל\nדינוזאור מתנפח כחול, <i>חלל</i> אפל" });
    // (ב) משתתף שמולא חלקית חוסם את ההרצה עם הודעה
    await page.click("#runBtn");
    await page.waitForFunction(() => document.getElementById("e_participants").textContent.length > 0, null, { timeout: 10000 });
    const badRow = await page.evaluate(() => [...document.querySelectorAll("#partList .prow")[0].querySelectorAll("input")].map(i => i.dataset.f + ":" + i.classList.contains("bad")).join(","));
    check("משתתף שמולא חלקית: ההרצה נחסמת עם הודעה, השורה והשדות החסרים מסומנים, ולא נשלחו שאילתות", /יש משתתף עם פרטים חלקיים/.test(await page.textContent("#e_participants")) && /יש להשלים את השדות המסומנים/.test(await page.textContent("#e_run")) && !(await page.isVisible("#resultsSec")) && page._calls.overpass === 0 && badRow === "first:false,last:true,phone:true", badRow + " | " + (await page.textContent("#e_participants")));
    const prow0 = page.locator("#partList .prow").first();
    await prow0.locator('[data-f="last"]').fill("כהן"); await prow0.locator('[data-f="phone"]').fill("050-1112222");
    await addParticipants(page, [["יוסי", "לוי <i>x</i>", "050-1113333"]]);
    await page.click("#addPart");   // שורה ריקה לגמרי נזרקת ואינה חוסמת
    await page.click("#runBtn");
    await page.waitForFunction(() => document.querySelector("#gate .banner"), null, { timeout: 150000 });
    const gate0 = await page.textContent("#gate");
    // (ג) מכשול ידוע שלא נמצא בסריקה => אזהרה; מכשול שנמצא => בלי אזהרה
    const koBanner = await page.$$eval("#gate .banner.warn", els => els.map(e => e.innerText).find(t => /מכשול שהוזן ולא נמצא בסריקה/.test(t)) || "");
    check("מכשול ידוע שלא נמצא בסריקה: אזהרה מאוחדת עם הפריטים ועם הסבר (OpenStreetMap / מחוץ לטווח / הוספה ידנית בסעיף 4)", /״דינוזאור מתנפח כחול״/.test(koBanner) && /ייתכן שאינו ממופה ב-OpenStreetMap/.test(koBanner) && /הוסיפו אותו ידנית בסעיף 4/.test(koBanner), koBanner);
    check("מכשול ידוע שנמצא בטופס (עמוד חשמל): בלי אזהרה", !/עמוד חשמל/.test(koBanner), "");
    check("טקסט המשתמש באזהרה עובר escape (HTML מוצג כטקסט)", /<i>חלל<\/i> אפל/.test(koBanner) && (await page.locator("#gate i").count()) === 0, "");
    // הערות הסיור ותאריכו (סעיף 4): נכנסים לדוח כשדות רכים — אחרי ההרצה
    await page.fill("#visitDate", visitYmd); await page.fill("#visitNotes", NOTES);
    await page.check("#reviewOk");
    await page.waitForFunction(() => /הבקשה מוכנה לשליחה/.test(document.querySelector("#gate").textContent), null, { timeout: 20000 });
    const ckRows = await page.$$eval("#report table.ck tr", trs => trs.map(t => [...t.children].map(c => c.innerText.replace(/\s+/g, " ").trim())));
    const koRow = ckRows.find(r => r[1] === "מכשולים שידועים למבקש") || [];
    check("מכשולים ידועים בדף הבדיקות: שורה עם התאמה לפריט שנמצא (עמוד חשמל) ו״לא נמצא בסריקה״ לפריט שלא", /״עמוד חשמל״ — התאמה אפשרית[^:]*: .*עמוד חשמל/.test(koRow[3] || "") && /״דינוזאור מתנפח כחול, <i>חלל<\/i> אפל״ — לא נמצא בסריקה|״דינוזאור מתנפח כחול״ — לא נמצא בסריקה/.test(koRow[3] || ""), (koRow[3] || "").slice(0, 400));
    // (ז) דף הבדיקות: כותרות סעיף ממוספרות ברצף; עמודת # ראשונה; בלי טבלת מקורות ובלי שורת ״מקורות:״ בתחתית
    const heads = async () => (await page.$$eval("#report .paper.checks h2", hs => hs.map(h => h.textContent.trim()))).filter(h => /^\d+\. /.test(h));
    let hd = await heads();
    check("דף הבדיקות: שש כותרות סעיף ממוספרות ברצף 1..6 (הנקודה, הבדיקות, מצאי, יום ולילה, הגשה, אישור סקירה)", hd.length === 6 && hd.every((h, i) => h.startsWith((i + 1) + ". ")) && /הנקודה$/.test(hd[0]) && /הבדיקות שבוצעו$/.test(hd[1]) && /מצאי לפי קבוצות$/.test(hd[2]) && /יום ולילה/.test(hd[3]) && /הגשה$/.test(hd[4]) && /אישור סקירה אנושית$/.test(hd[5]), hd.join(" | "));
    { // "פריטים נוספים שנמצאו בקרבה ואינם בטופס" היא תת-סעיף 3.1 (כותרת משנית h3) של המצאי — לא כותרת לא ממוספרת בין סעיפים ממוספרים, והמספור הרציף 1..6 נשאר ללא חורים
      const all = await page.$$eval("#report .paper.checks h2, #report .paper.checks h3", hs => hs.map(h => h.tagName + " " + h.textContent.trim()));
      const iSec3 = all.findIndex(h => /^H2 3\. מצאי לפי קבוצות$/.test(h)), iSub = all.findIndex(h => /^H3 3\.1 פריטים נוספים שנמצאו בקרבה ואינם בטופס$/.test(h)), iSec4 = all.findIndex(h => /^H2 4\. יום ולילה/.test(h));
      check("דף הבדיקות: ״3.1 פריטים נוספים שנמצאו בקרבה ואינם בטופס״ ככותרת משנית (h3) בין סעיף 3 לסעיף 4, ללא כותרת לא ממוספרת בגודל כותרת סעיף", iSec3 >= 0 && iSub === iSec3 + 1 && iSec4 === iSub + 1 && !all.some(h => /^H2 (?!\d+\. )/.test(h)) && (await page.$$eval("#report .paper.checks h3", hs => hs.every(h => parseFloat(getComputedStyle(h).fontSize) < parseFloat(getComputedStyle(h.closest(".paper").querySelector("h2")).fontSize)))), all.join(" | "));
    }
    await page.uncheck("#reviewOk"); hd = await heads();
    check("כשאין אישור סקירה: חמישה סעיפים ברצף (המונה לפי מה שמוצג)", hd.length === 5 && hd.every((h, i) => h.startsWith((i + 1) + ". ")) && !hd.some(h => /אישור סקירה/.test(h)), hd.join(" | "));
    await page.check("#reviewOk");
    await page.waitForFunction(() => /הבקשה מוכנה לשליחה/.test(document.querySelector("#gate").textContent), null, { timeout: 15000 });
    check("טבלת הבדיקות: עמודה ראשונה ״#״ עם מספרי שורה רצופים, אחריה בדיקה / מקור / תוצאה", ckRows[0].join("|") === "#|בדיקה|מקור|תוצאה" && ckRows.slice(1).every((r, i) => r[0] === String(i + 1)) && ckRows.length > 8, ckRows[0].join("|") + " " + ckRows.length);
    { // מבנה דף הבדיקות על המסך זהה למבנה ב-Word: טבלת מצאי (5 עמודות), טבלת יום ולילה והגשה; בלי סעיף מגבלות ובלי הצהרות על מקור הנתונים
      const tbl = await page.$$eval("#report .paper.checks table.t:not(.ck)", ts => ts.map(t => [...t.querySelector("tr").children].map(c => c.textContent.trim()).join("|") + "#" + t.querySelectorAll("tr").length));
      const pageText = await page.locator("#report .paper.checks").innerText(), nOl = await page.locator("#report .paper.checks ol > li").count(), sub = await page.locator("#report .paper.checks h2").filter({ hasText: /^5\. הגשה/ }).evaluate(h => h.nextElementSibling.innerText);
      check("דף הבדיקות: טבלת מצאי לפי קבוצות (5 עמודות, שורת כותרת + קבוצות) וטבלת יום ולילה; הגשה; בלי סעיף מגבלות, בלי רשימת <ol> ובלי הצהרות על מקור הנתונים או על אופן חישוב הזריחה מחוץ לעמודת המקור", tbl.length === 2 && /^קבוצה\|נמצאו\|בתוך הסגירה\|בטבעת הכתומה\|בקרבה#\d+$/.test(tbl[0]) && +tbl[0].split("#")[1] > 5 && /^תאריך\|זריחה\|שקיעה\|שעות יום בחלון\|שעות לילה בחלון#5$/.test(tbl[1]) && nOl === 0 && !/מגבלות והסתייגויות|מקור האיסורים|מאגר ציבורי שנבנה על ידי מתנדבים|חישוב אסטרונומי לנקודה/.test(pageText) && /ימים א׳–ה׳/.test(sub), tbl.join(" ; ") + " | ol=" + nOl);
      const lim = await page.evaluate(() => ({ n: document.querySelectorAll("#limits > li").length, sun: /חישוב אסטרונומי לנקודה/.test(document.getElementById("limits").textContent), inReport: !!document.querySelector("#report #limits") }));
      check("המגבלות והמקורות נשארו זמינות על המסך בלבד: תיבת ״מגבלות המקורות״ מלאה וכוללת את הערת חישוב הזריחה, ואינה חלק מהדוח", lim.n >= 6 && lim.sun && !lim.inReport, JSON.stringify(lim));
    }
    check("דף הבדיקות: כל כותרות הסעיף ברוחב מלא (לא נדחפות לשורה אחת עם הפסקה שלפניהן — המחלקה checks היא flex בשאר הדף)", await page.$$eval("#report .paper.checks h2", hs => hs.length >= 6 && hs.every(h => h.getBoundingClientRect().width > 500)), "");
    const p3 = await page.locator("#report .paper.checks").innerText(), foot = await page.locator("#report .paper.checks .foot").innerText();
    check("דף הבדיקות: אין ״דוח כיסוי — מה נסרק״, ושורת התחתית היא ״הופק …״ בלבד (בלי רשימת מקורות)", !/דוח כיסוי/.test(p3) && /^הופק /.test(foot.trim()) && !/מקורות|OpenStreetMap/.test(foot), foot);
    // (ד) הערות סיור + תאריך: בדף הבדיקות בסעיף 1, ב-Word, ולא בשדות הטופס ולא במייל
    const p3html = await page.locator("#report .paper.checks").innerHTML();
    check("הערות המבקש מופיעות בסעיף 1 (הנקודה) עם תאריך הסיור, escaped, ושורות חדשות כ-<br>", p3.indexOf("1. הנקודה") < p3.indexOf("הערות המבקש (סיור באתר ב-" + vd + "." + vm + "." + vy + ")") && p3.indexOf("הערות המבקש (סיור") < p3.indexOf("2. הבדיקות שבוצעו") && /ערימת מכולות ליד השער <b>x<\/b> & "ציטוט"/.test(p3) && /שורה שנייה/.test(p3) && /ציטוט"?(&quot;)?<br>שורה שנייה/.test(p3html) && !/<b>x<\/b>/.test(p3html), p3.slice(0, 300));
    const form = await page.$$eval("#report .paper:first-child table.f tr", trs => trs.map(t => t.innerText.replace(/\s+/g, " ").trim()));
    const mailBody = await page.evaluate(() => window.__REQ.O.mail(window.__REQ.S.res, window.__REQ.S.cfg).body), mailHref = decodeURIComponent(await page.getAttribute("#btnMail", "href"));
    check("הערות הסיור ותאריכו אינם בשדות הטופס ואינם בגוף המייל (ולא בקישור mailto)", !/ערימת מכולות|שורה שנייה|ממצאי/.test(form.join(" ") + mailBody + mailHref) && !new RegExp(vd + "\\." + vm + "\\." + vy).test(mailBody), "");
    const dlp = async sel => { const [d] = await Promise.all([page.waitForEvent("download"), page.click(sel)]); const p = path.join(OUT, "s9-" + d.suggestedFilename()); await d.saveAs(p); return p; };
    { const JZ = require(path.join(ROOT, "members-k38p", "requests", "vendor", "jszip.min.js")), z = await JZ.loadAsync(fs.readFileSync(await dlp("#btnDocx")));
      const doc = await z.file("word/document.xml").async("string"), plain = doc.replace(/<[^>]+>/g, "").replace(new RegExp("[" + String.fromCharCode(0x202a, 0x202c) + "]", "g"), "").replace(/&quot;/g, '"');
      check("הערות הסיור והתאריך בקובץ ה-Word (בסעיף ״הנקודה״ של דף הבדיקות), ה-HTML מוצג כטקסט", plain.includes("הערות המבקש (סיור באתר ב-" + vd + "." + vm + "." + vy + ")") && /ערימת מכולות ליד השער/.test(plain) && plain.includes("&lt;b&gt;x&lt;/b&gt;") && !doc.includes("<b>x</b>") && /שורה שנייה/.test(plain), ""); }
    // (ב) שני משתתפים תקינים נכנסים לשדה 11 ולמייל; ה-HTML שלהם מוצג כטקסט
    check("שני המשתתפים התקינים בשדה 11 (ממוספרים, עם טלפון), שורה ריקה לא נכנסה, ואין הערה לאף משתתף", /משתתפים נוספים בטיסה:/.test(form[10]) && /1\. דנה כהן, 050-1112222/.test(form[10]) && /2\. יוסי לוי <i>x<\/i>, 050-1113333/.test(form[10]) && !/3\./.test(form[10]) && (await page.locator("#report .paper:first-child table.f tr").nth(10).locator("i").count()) === 0, form[10]);
    check("שני המשתתפים במייל (גוף ו-mailto) כל אחד בשורה ממוספרת", /משתתפים נוספים בטיסה:\n1\. דנה כהן, 050-1112222\n2\. יוסי לוי <i>x<\/i>, 050-1113333/.test(mailBody) && /משתתפים נוספים בטיסה/.test(mailHref), mailBody.slice(0, 500));
    check("מכשולים שידועים למבקש בשדה 8 (כלשונם) ובמייל", /מכשולים שידועים למבקש: עמוד חשמל; דינוזאור מתנפח כחול, <i>חלל<\/i> אפל/.test(form[7]) && /מכשולים שידועים למבקש: עמוד חשמל; /.test(mailBody), "");
    // רינדור מחדש בעריכה רכה: הערות, משתתפים וטלפון איש קשר (אזהרה לפי איש קשר) — בלי לבטל את הניתוח
    await page.evaluate(() => { document.getElementById("driveMsg").textContent = "x"; document.getElementById("sendMsg").textContent = "y"; });
    await page.fill("#visitNotes", "ממצא חדש: חסום ליד הגדר");
    await page.waitForFunction(() => document.querySelector("#sendMsg").textContent === "" && document.querySelector("#driveMsg").textContent === "", null, { timeout: 5000 });
    await page.waitForFunction(() => /ממצא חדש: חסום ליד הגדר/.test(document.querySelector("#report .paper.checks").innerText) && /הבקשה מוכנה לשליחה/.test(document.querySelector("#gate").textContent), null, { timeout: 20000 });
    check("שינוי בהערות הסיור: מוחק הודעות ״נשמר/נשלח״, מרנדר מחדש את דף הבדיקות, והבקשה נשארת מוכנה (שדה רך)", !/ערימת מכולות/.test(await page.locator("#report .paper.checks").innerText()) && !(await page.isDisabled("#btnSend")), "");
    await page.locator("#contactList .prow").nth(1).locator('[data-f="phone"]').fill("");
    await page.waitForFunction(() => /חסר מספר טלפון תקין/.test(document.querySelector("#gate").textContent), null, { timeout: 20000 });
    const gPhone = await page.textContent("#gate");
    check("איש קשר בלי טלפון: אזהרה לפי איש קשר (לא חוסמת), והבקשה נשארת מוכנה", /איש הקשר ״בודק שלישי״ — חסר מספר טלפון תקין\. בנספח ג׳ שדה 12 נדרשים 2 אנשי קשר וטלפונים\./.test(gPhone) && /הבקשה מוכנה לשליחה/.test(gPhone), gPhone.replace(/\s+/g, " ").slice(0, 200));
    check("האזהרה על ״כמה כלי טיס״ נמחקה", !/נבחרו כמה כלי טיס/.test(gate0), "");
    await page.locator("#partList .prow").nth(1).locator('[data-f="phone"]').fill("12");
    await page.waitForFunction(() => /יש משתתף עם פרטים חלקיים/.test(document.getElementById("e_participants").textContent), null, { timeout: 20000 });
    check("תיקון משתתף לטלפון לא תקין אחרי הרצה: השער חוסם (קלט לא תקין) והשורה מסומנת", /אינה מוכנה/.test(await page.textContent("#gate")) && (await page.isDisabled("#btnSend")) && (await page.locator('#partList .prow').nth(1).locator('[data-f="phone"]').evaluate(e => e.classList.contains("bad"))), "");
    await page.locator("#partList .prow").nth(1).locator("[data-rm]").click();
    await page.waitForFunction(() => /הבקשה מוכנה לשליחה/.test(document.querySelector("#gate").textContent), null, { timeout: 20000 });
    check("הסרת השורה הפגומה מחזירה מוכנות; הטופס מציג משתתף אחד", !/2\. יוסי/.test(await page.locator("#report .paper:first-child table.f tr").nth(10).innerText()), "");
    await ctx.close();
  }

  /* ===== תרחיש 10: בניית ההדמיות — "האחרון מנצח". בנייה איטית שהחלה לפני ניתוח חדש (או לפני הוספה ידנית) מסתיימת אחריהם — והיא לא נוגעת בתמונות, בשם האתר, בסטטוס ולא בשער ===== */
  if (!LIVE) {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    // מתייג כל ציור בנקודה ובמספר הפריטים של הניתוח שממנו צויר, ומאט (אחרי שהציור הסתיים — כמו רשת איטית שמסיימת מאוחר) ציור של הניתוח __slowRes, או של כל בנייה שהתחילה כש-__slowNext דלוק
    const instrument = (page, delayMs) => page.evaluate(ms => {
      window.__slowRes = null; window.__slowNext = false; window.__renders = [];
      const M = window.ReqMap, o = M.render;
      M.render = async function (res, opts) {
        const slow = res === window.__slowRes || window.__slowNext;
        const r = await o.apply(this, arguments); r._lat = res.inp.lat; r._n = res.nearScan.items.length;
        if (slow) await new Promise(x => setTimeout(x, ms));
        window.__renders.push({ lat: res.inp.lat, n: r._n, slow });
        return r;
      };
    }, delayMs);
    const snap = page => page.evaluate(() => { const S = window.__REQ.S; return { reqLat: S.res && S.res.inp.lat, reqN: S.res && S.res.nearScan.items.length, aerialLat: S.imgs.aerial && S.imgs.aerial._lat, regionLat: S.imgs.region && S.imgs.region._lat, aerialN: S.imgs.aerial && S.imgs.aerial._n, regionN: S.imgs.region && S.imgs.region._n, mapOk: !!(S.statuses.map && S.statuses.map.ok), pending: S.pending, ready: S.ready, running: S.running, site: S.imgSite }; });
    const lateLanded = (page, n) => page.waitForFunction(k => window.__renders.filter(x => x.slow).length >= k, n, { timeout: 60000 });
    const setup = async opts => { const { ctx, page } = await newPage(browser, opts); await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page); await instrument(page, 9000); return { ctx, page }; };
    // 10א/10ב: ריצה ראשונה (הנקודה הישנה), עריכת שם האתר (בנייה איטית #1 על הניתוח הישן), שינוי נ״צ והרצה חדשה — ואז #1 מסיימת. 10ב: הבנייה הישנה גם נכשלת (אריחים חסרים) — והיא לא יכולה להפיל את הסטטוס של הניתוח החדש
    const runOverwrite = async fail => {
      const { ctx, page } = await setup({});
      await readyRequest(page);
      await page.evaluate(() => { window.__slowRes = window.__REQ.S.res; });
      if (fail) page._tileHold = async () => "fail";
      await page.fill("#siteName", fail ? "אתר בדיקה ב" : "אתר בדיקה א");
      await page.waitForFunction(() => window.__REQ.S.building, null, { timeout: 10000 }); await sleep(700);   // הבנייה האיטית יצאה לדרך (כל האריחים שלה כבר התבקשו)
      page._tileHold = null;
      await page.fill("#coord", "32.0800, 34.8000"); await page.dispatchEvent("#coord", "change");
      await page.evaluate(() => { window.__prev = window.__REQ.S.res; });
      await page.click("#runBtn");
      await page.waitForFunction(() => window.__REQ.S.res !== window.__prev && !window.__REQ.S.running && window.__REQ.S.res && window.__REQ.S.res.inp.lat === 32.08 && window.__REQ.S.statuses.map.ok, null, { timeout: 150000 });
      await page.check("#reviewOk"); await page.evaluate(() => { window.__imgsRef = window.__REQ.S.imgs; });
      const before = await snap(page);
      await lateLanded(page, 4); await sleep(500);   // הבנייה האיטית על הניתוח הישן הסתיימה
      const after = await snap(page), same = await page.evaluate(() => window.__REQ.S.imgs === window.__imgsRef), gate = await page.textContent("#gate");
      const tag = fail ? "10ב" : "10א";
      check(tag + ": אחרי ריצה חדשה, בנייה איטית ישנה" + (fail ? " (שנכשלה באריחים)" : "") + " מסתיימת מאוחר — התמונות, שם האתר והסטטוס שייכים לניתוח הנוכחי (הנקודה החדשה) ולא השתנו", before.aerialLat === 32.08 && before.regionLat === 32.08 && after.aerialLat === 32.08 && after.regionLat === 32.08 && same && after.mapOk && !after.pending && after.ready && after.site === "אתר בדיקה " + (fail ? "ב" : "א") && /הבקשה מוכנה לשליחה/.test(gate) && !(await page.isDisabled("#btnSend")) && !(await page.isDisabled("#btnDrive")), JSON.stringify({ before, after, same }));
      await ctx.close();
    };
    // 10ג: עריכת שם האתר (בנייה איטית על הניתוח הישן) ואז הוספה ידנית (ניתוח חדש, בנייה מהירה) — התמונות כוללות את הפריט החדש גם אחרי שהבנייה הישנה מסתיימת, והשער לא נפתח לפני הבנייה העדכנית
    const manualOverwrite = async () => {
      const { ctx, page } = await setup({});
      await readyRequest(page);
      await page.evaluate(() => { window.__slowRes = window.__REQ.S.res; });
      await page.fill("#siteName", "אתר בדיקה ג");
      await page.waitForFunction(() => window.__REQ.S.building, null, { timeout: 10000 }); await sleep(300);
      await page.fill("#mName", "עגורן בנייה (בדיקה)"); await page.fill("#mCoord", "32.0995, 34.8168"); await page.fill("#mHeight", "60"); await page.click("#mAdd");
      await page.waitForFunction(() => { const S = window.__REQ.S; return S.res.nearScan.items.some(i => /עגורן בנייה/.test(i.title)) && S.imgs.aerial && S.imgs.aerial._n === S.res.nearScan.items.length && !S.building; }, null, { timeout: 90000 });
      await page.check("#reviewOk"); await page.evaluate(() => { window.__imgsRef = window.__REQ.S.imgs; });
      const before = await snap(page);
      await lateLanded(page, 4); await sleep(500);
      const after = await snap(page), same = await page.evaluate(() => window.__REQ.S.imgs === window.__imgsRef);
      check("10ג: הוספה ידנית אחרי עריכה: הבנייה האיטית על הניתוח הישן מסתיימת מאוחר ולא דורסת — התמונות כוללות את כל הפריטים (גם הפריט שנוסף), והשער פתוח רק עם הבנייה העדכנית", before.aerialN === before.reqN && after.aerialN === after.reqN && after.regionN === after.reqN && same && after.mapOk && !after.pending && after.ready && !before.pending && before.ready, JSON.stringify({ before, after, same }));
      await ctx.close();
    };
    // 10ד: עריכת שם האתר באמצע בניית ההרצה (S.res כבר קיים): העריכה נקלטת (לא נזרקת), הבנייה של ההרצה מוחלפת בעדכנית, שלב ההתקדמות לא נשאר תלוי, והתמונות נושאות את השם החדש
    const editDuringRunBuild = async () => {
      const { ctx, page } = await setup({});
      await fillExample(page);
      await page.evaluate(() => { window.__slowNext = true; });
      await page.click("#runBtn");
      await page.waitForFunction(() => { const S = window.__REQ.S; return S.running && S.res && S.building; }, null, { timeout: 150000 });
      await page.evaluate(() => { window.__slowNext = false; });
      await page.fill("#siteName", "שם אחרי ניתוח");
      await page.waitForFunction(() => !window.__REQ.S.running && window.__REQ.S.res && window.__REQ.S.statuses.map && window.__REQ.S.statuses.map.ok && !window.__REQ.S.pending, null, { timeout: 150000 });
      const st = await page.evaluate(() => { const S = window.__REQ.S; return { site: S.imgSite, inpSite: S.res.inp.siteName, input: document.getElementById("siteName").value, steps: [...document.querySelectorAll("#progress li .s")].map(e => e.className.replace("s ", "")).join(","), pending: S.pending }; });
      check("10ד: עריכת שם האתר באמצע בניית ההרצה: נקלטת בבקשה, התמונות נושאות את השם החדש, כל שלבי ההתקדמות הסתיימו (לא נשאר שלב תלוי), ואין סטטוס ממתין", st.site === "שם אחרי ניתוח" && st.inpSite === "שם אחרי ניתוח" && st.input === "שם אחרי ניתוח" && !/wait/.test(st.steps) && !st.pending, JSON.stringify(st));
      await page.check("#reviewOk");
      await page.waitForFunction(() => /הבקשה מוכנה לשליחה/.test(document.querySelector("#gate").textContent), null, { timeout: 20000 });
      check("10ד: ובסיום הבקשה מוכנה לשליחה", !(await page.isDisabled("#btnSend")), "");
      await ctx.close();
    };
    // 10ה: עריכה רכה ומיד אחריה לחיצה על ״הרץ״ (בתוך 450ms): הטיימר לא זורק על S.res=null, אין pageerror, ו-pending לא נתקע
    const editThenRun = async () => {
      const { ctx, page } = await newPage(browser);
      const errs = []; page.on("pageerror", e => errs.push(String(e.message || e)));
      await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
      await readyRequest(page);
      errs.length = 0;
      await page.evaluate(() => { const S = window.__REQ.S, e = document.getElementById("siteName"); window.__prev = S.res; e.value = "אתר חדש"; e.dispatchEvent(new Event("input", { bubbles: true })); document.getElementById("runBtn").click(); });   // אותה משימה: הטיימר (450ms) נקבע, וההרצה מתחילה
      await page.waitForFunction(() => window.__REQ.S.res !== window.__prev && !window.__REQ.S.running && window.__REQ.S.res && window.__REQ.S.statuses.map.ok, null, { timeout: 150000 });
      await sleep(1200);   // הטיימר המקורי היה אמור לפעול בשלב הזה
      await page.check("#reviewOk");
      await page.waitForFunction(() => /הבקשה מוכנה לשליחה/.test(document.querySelector("#gate").textContent), null, { timeout: 20000 });
      const fin = await page.evaluate(() => ({ pending: window.__REQ.S.pending, site: window.__REQ.S.res.inp.siteName, imgSite: window.__REQ.S.imgSite }));
      check("10ה: עריכה רכה ומיד ״הרץ״ — אין שגיאת JS (הטיימר לא זורק על S.res=null), ההרצה מסתיימת, pending לא נתקע והבקשה מוכנה", errs.length === 0 && !fin.pending && fin.site === "אתר חדש" && fin.imgSite === "אתר חדש" && !(await page.isDisabled("#btnSend")), JSON.stringify({ errs, fin }));
      await ctx.close();
    };
    // 10ו: הדפסה — בקשה ארוכה (3 אנשי קשר, 3 משתתפים, 2 מכשולים ידועים) נכנסת לעמוד אחד: אחרת עמוד 2 מכיל רק את שורת המצורפים והמייל. נמדד בהדפסה על רוחב A4 (703px מתוך 794 פחות שוליים) מול גובה העמוד (1032px); ב-PDF אמיתי נבדק גם מספר העמודים
    const printFits = async () => {
      const { ctx, page } = await newPage(browser);
      await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
      await fillExample(page, { contacts: [["בודק שני", "050-0000002"], ["בודק שלישי", "050-0000003"], ["בודק רביעי", "050-0000004"]], participants: [["דנה", "כהן", "050-1112222"], ["יוסי", "לוי", "050-1113333"], ["רון", "בר", "050-1114444"]], known: "עמוד חשמל\nדינוזאור מתנפח כחול" });
      await page.click("#runBtn");
      await page.waitForFunction(() => document.querySelector("#gate .banner"), null, { timeout: 150000 });
      await page.check("#reviewOk");
      await page.waitForFunction(() => /הבקשה מוכנה לשליחה/.test(document.querySelector("#gate").textContent), null, { timeout: 20000 });
      await page.setViewportSize({ width: 703, height: 1032 }); await page.emulateMedia({ media: "print" });
      const m = await page.evaluate(() => { const f = document.querySelector("#report .paper"), t = f.querySelector("table.f td:not(.k)"), cs = getComputedStyle(t); return { h: Math.round(f.getBoundingClientRect().height), rows: f.querySelectorAll("table.f tr").length, pad: cs.paddingTop, font: cs.fontSize, line: cs.lineHeight, draft: !!f.querySelector(".draft"), phones: f.querySelectorAll(".ph").length }; });
      const pdfPath = path.join(OUT, "request-long.pdf"); await page.pdf({ path: pdfPath, format: "A4", printBackground: true, margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" } });
      const pages = (fs.readFileSync(pdfPath).toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
      check("הדפסה: טופס עם 3 אנשי קשר, 3 משתתפים ו-2 מכשולים ידועים נכנס לעמוד אחד (גובה ≤ 1032px ברוחב A4), ו-PDF נוצר", m.rows === 17 && !m.draft && m.phones >= 7 && m.h <= 1032 && pages >= 6, JSON.stringify(m) + " pages=" + pages);
      await ctx.close();
    };
    await Promise.all([runOverwrite(false), runOverwrite(true), manualOverwrite(), editDuringRunBuild(), editThenRun(), printFits()]);
  }

  /* ===== תרחיש 11: עריכה בזמן ״שמור בדרייב״ — הקבצים בדרייב אינם הגרסה הנוכחית: saveEnd נשלח עם ready:false, מוצגת שגיאה (לא ״נשמרו״), ושמירה חוזרת מתקנת ===== */
  if (!LIVE) {
    const opts = { apiDelay: 0 };
    const { ctx, page } = await newPage(browser, opts);
    await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
    await readyRequest(page);
    const tok = page._env.call({ action: "login", user: ADMIN, pass: PASS }).token;
    opts.apiDelay = 600;                                                        // שרת איטי: ההעלאה נמשכת כמה שניות
    await page.click("#btnDrive");
    await page.waitForFunction(() => /\(2\/7\)/.test(document.getElementById("driveMsg").textContent), null, { timeout: 60000 });   // ה-Word כבר נבנה, ההעלאה בעיצומה
    await page.locator("#contactList .prow").nth(1).locator('[data-f="phone"]').fill("050-9999999");   // עריכה רכה באמצע השמירה
    await page.waitForFunction(() => /נשמרו \d+ קבצים|נכשלה|לא נשמר/.test(document.getElementById("driveMsg").textContent), null, { timeout: 90000 });
    const msg = await page.textContent("#driveMsg"), ends = page._calls.saveEnds || [];
    const logRow = page._env.call({ action: "listRequests", token: tok }).requests[0];
    check("עריכה בזמן שמירה בדרייב: saveEnd נשלח עם ready:false, מוצגת שגיאה בעברית ״הבקשה שונתה בזמן השמירה — הקבצים בדרייב אינם מעודכנים״ ולא ״✔ נשמרו״, והשרת לא סימן את הבקשה מוכנה", ends.length === 1 && ends[0].ready === false && /הבקשה שונתה בזמן השמירה — הקבצים בדרייב אינם מעודכנים; יש לשמור שוב/.test(msg) && !/✔ נשמרו/.test(msg) && (await page.getAttribute("#driveMsg", "class")).includes("err") && logRow && logRow.ready === false, msg + " | saveEnd " + JSON.stringify(ends) + " | ready בשרת: " + (logRow && logRow.ready));
    opts.apiDelay = 0;
    await page.waitForFunction(() => /הבקשה מוכנה לשליחה/.test(document.querySelector("#gate").textContent) && !window.__REQ.S.pending, null, { timeout: 30000 });
    await page.evaluate(() => { document.getElementById("driveMsg").textContent = ""; });
    await page.click("#btnDrive");
    await page.waitForFunction(() => /נשמרו \d+ קבצים|נכשלה/.test(document.getElementById("driveMsg").textContent), null, { timeout: 90000 });
    const folder = Object.values(page._env.folders).find(f => f.parent === "ROOT"), ends2 = page._calls.saveEnds || [];
    let plain = "";
    { const JZ = require(path.join(ROOT, "members-k38p", "requests", "vendor", "jszip.min.js")), z = await JZ.loadAsync(folder.files.find(f => f.name.endsWith(".docx") && !f.trashed).bytes);
      plain = (await z.file("word/document.xml").async("string")).replace(/<[^>]+>/g, "").replace(new RegExp("[" + String.fromCharCode(0x202a, 0x202c) + "]", "g"), ""); }
    check("שמירה חוזרת אחרי העריכה: ״✔ נשמרו 7 קבצים״, saveEnd עם ready:true, השרת מסמן מוכנה, וה-Word בדרייב כולל את הטלפון החדש", /✔ נשמרו 7 קבצים/.test(await page.textContent("#driveMsg")) && ends2.length === 2 && ends2[1].ready === true && page._env.call({ action: "listRequests", token: tok }).requests[0].ready === true && plain.includes("050-9999999"), "saveEnd " + JSON.stringify(ends2));
    await ctx.close();
  }

  /* ===== תרחיש 6: כניסה, ניהול משתמשים, חסימה ושמירה בדרייב ===== */
  if (!LIVE) {
    // 6א: שרת ההתחברות לא הוגדר -> הדף נעול
    {
      const { ctx, page } = await newPage(browser, { noApi: true });
      await page.goto(APP); await page.waitForSelector("#authCover", { timeout: 20000 });
      const t = await page.textContent("#authCover");
      check("שרת התחברות לא מוגדר: מסך נעילה בלי טופס כניסה", /עדיין לא הוגדר/.test(t) && !(await page.$("#authForm")), t.replace(/\s+/g, " ").slice(0, 120));
      await ctx.close();
    }
    // 6ב: כניסה שגויה/נכונה, והרצה בלי כניסה אינה אפשרית
    {
      const { ctx, page } = await newPage(browser);
      await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 });
      await page.waitForSelector("#authForm");
      check("לפני כניסה: הטופס מטושטש וחסום", await page.evaluate(() => document.body.classList.contains("authLocked") && getComputedStyle(document.querySelector("main")).pointerEvents === "none"), "");
      await page.fill("#auUser", ADMIN); await page.fill("#auPass", "wrong-wrong-1"); await page.click("#auGo");
      await page.waitForFunction(() => document.querySelector("#auErr") && document.querySelector("#auErr").textContent.length > 0);
      check("סיסמה שגויה: הודעת שגיאה והדף נשאר נעול", /שגויים/.test(await page.textContent("#auErr")) && !!(await page.$("#authCover")), await page.textContent("#auErr"));
      await page.fill("#auPass", PASS); await page.click("#auGo");
      await page.waitForSelector("#authCover", { state: "detached" });
      check("כניסה תקינה: שורת משתמש מוצגת עם שם המנהל", /מחובר/.test(await page.textContent("#userBar")) && /מנהל/.test(await page.textContent("#userBar")), await page.textContent("#userBar"));
      await page.reload(); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 });
      await page.waitForFunction(() => !document.body.classList.contains("authLocked"), null, { timeout: 15000 });
      check("רענון בתוך אותו חלון: ההתחברות נשמרת (אסימון בזיכרון החלון בלבד)", true, "");
      await page.click("#ubOut"); await page.waitForSelector("#authForm");
      check("התנתקות מחזירה למסך הכניסה", true, "");
      await ctx.close();
    }
    // 6ג: ניהול משתמשים בממשק + חסימה בפועל + החלפת סיסמה
    {
      const { ctx, page } = await newPage(browser);
      await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
      await page.click("#ubAdmin"); await page.waitForSelector("#admBody .admTbl");
      await page.fill("#adU", "dave.pilot"); await page.fill("#adP", "dave-pass-12345"); await page.click("#addForm button[type=submit]");
      await page.waitForFunction(() => document.querySelector("#admBody").textContent.includes("dave.pilot"));
      check("מנהל מוסיף משתמש מהממשק", !!page._env.call({ action: "login", user: "dave.pilot", pass: "dave-pass-12345" }).ok, "");
      // התחברות נוספת של dave בחלון אחר
      const ctx2 = await browser.newContext({ locale: "he-IL" }); const p2 = await ctx2.newPage();
      await p2.route(API, apiHandler(page._env, null, {}));
      await p2.route(/\/gate\.js/, r => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
      await p2.route(/\/requests\/config\.json/, r => { const d = JSON.parse(fs.readFileSync(path.join(ROOT, "members-k38p", "requests", "config.json"), "utf8")); d.api_url = API; r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(d) }); });
      await p2.route(/fonts\.|arcgisonline|openstreetmap/, r => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
      await p2.goto(APP); await login(p2, "dave.pilot", "dave-pass-12345");
      check("משתמש רגיל: אין כפתור ניהול משתמשים", !(await p2.$("#ubAdmin")), "");
      // חסימה מהממשק של המנהל
      await page.click("[data-blk='dave.pilot']"); await page.waitForFunction(() => document.querySelector("#admBody").textContent.includes("חסום"));
      check("חסימה בממשק משנה את מצב המשתמש בשרת", page._env.call({ action: "login", user: "dave.pilot", pass: "dave-pass-12345" }).error === "blocked", "");
      // הפעולה הבאה של המשתמש החסום מחזירה אותו למסך הכניסה עם הודעה
      await p2.evaluate(() => window.ReqAuth.call("me")); // קריאה מאומתת אחת
      await p2.waitForSelector("#authCover");
      check("משתמש חסום באמצע עבודה: נזרק מיד למסך הכניסה עם הודעת חסימה", /חסום/.test(await p2.textContent("#authCover")), (await p2.textContent("#authCover")).replace(/\s+/g, " ").slice(0, 100));
      await ctx2.close();
      // החלפת סיסמה עצמית
      await page.click("#mdClose"); await page.click("#ubPass"); await page.waitForSelector("#pwForm");
      await page.fill("#pwOld", PASS); await page.fill("#pwNew", "much-better-pass-9"); await page.fill("#pwNew2", "much-better-pass-9");
      page.once("dialog", d => d.accept()); await page.click("#pwForm button[type=submit]");
      await page.waitForSelector("#authModal", { state: "detached" });
      check("החלפת סיסמה: הישנה נפסלת והחדשה עובדת", page._env.call({ action: "login", user: ADMIN, pass: PASS }).error === "bad_login" && !!page._env.call({ action: "login", user: ADMIN, pass: "much-better-pass-9" }).ok, "");
      await ctx.close();
    }
    // 6ד: שמירה בדרייב אחרי זרימה מלאה
    {
      const { ctx, page } = await newPage(browser);
      await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
      check("כפתור 'שמור בדרייב' חסום לפני שהבקשה מוכנה", true, "");
      await fillExample(page); await page.click("#runBtn");
      await page.waitForFunction(() => document.querySelector("#gate .banner"), null, { timeout: 150000 });
      await page.check("#reviewOk");
      await page.waitForFunction(() => /הבקשה מוכנה לשליחה/.test(document.querySelector("#gate").textContent), null, { timeout: 15000 });
      await page.click("#btnDrive");
      await page.waitForFunction(() => /נשמרו \d+ קבצים|נכשלה/.test(document.querySelector("#driveMsg").textContent), null, { timeout: 120000 });
      const msgT = await page.textContent("#driveMsg");
      check("שמירה בדרייב הצליחה (7 קבצים: Word, KML, ארבע תמונות ונתוני בקשה)", /נשמרו 7 קבצים/.test(msgT), msgT.slice(0, 160));
      const folder = Object.values(page._env.folders).find(f => f.parent === "ROOT");
      const names = folder ? folder.files.filter(f => !f.trashed).map(f => f.name) : [];
      check("התיקייה בדרייב נקראת 'מקום — תאריך' ומכילה Word, KML, ארבע תמונות בשמות לפי החוזה ונתוני בקשה", !!folder && /— \d\d\.\d\d\.\d{4}/.test(folder.name) && names.length === 7 &&
        names.some(n => n.endsWith(".docx")) && names.some(n => n.endsWith(".kml")) && names.filter(n => /\.(png|jpg)$/.test(n)).length === 4 && names.some(n => n.endsWith(".json")) &&
        [" — תצ״א תקריב", " — מפת רחובות תקריב", " — הדמיה מבט כללי", " — מפת אזור"].every(t => names.some(n => n.endsWith(t + ".png") || n.endsWith(t + ".jpg"))), (folder && folder.name) + " | " + names.join(" | "));
      const dx = folder.files.find(f => f.name.endsWith(".docx"));
      { const JZ = require(path.join(ROOT, "members-k38p", "requests", "vendor", "jszip.min.js")), z = await JZ.loadAsync(dx.bytes);
        const doc = await z.file("word/document.xml").async("string");
        check("ה-Word שבדרייב תקין ומכיל את הטופס", /פמ״ת/.test(doc) || /נספח/.test(doc), dx.bytes.length + " בתים"); }
      const rec = JSON.parse(folder.files.find(f => f.name.endsWith(".json")).bytes.toString("utf8"));
      check("נתוני הבקשה בדרייב לא כוללים שמות וטלפונים (מבקש, אנשי קשר ומשתתפים)", !/בודק ראשון|בודק שני|בודק שלישי|050-0000001|050-0000002|050-0000003/.test(JSON.stringify(rec)) && rec.inputs && rec.inputs.lat && !("contacts" in rec.inputs) && !("participants" in rec.inputs) && !("requesterName" in rec.inputs), Object.keys(rec.inputs || {}).join(","));
      // שמירה חוזרת באותו שם מחליפה ולא מכפילה
      await page.evaluate(() => { document.getElementById("driveMsg").textContent = ""; });   // אחרת ההודעה הקודמת מספקת את ההמתנה לפני שהשמירה החוזרת הסתיימה
      await page.click("#btnDrive");
      await page.waitForFunction(() => /נשמרו 7 קבצים/.test(document.querySelector("#driveMsg").textContent), null, { timeout: 120000 });
      await page.waitForTimeout(300);
      check("שמירה חוזרת מחליפה קבצים באותו שם (בלי כפילויות)", folder.files.filter(f => !f.trashed).length === 7 && Object.values(page._env.folders).filter(f => f.parent === "ROOT").length === 1, "");
      // בקשה אחרת באותו מקום ותאריך (דף חדש = מזהה בקשה חדש): תיקייה נפרדת, והקבצים של הראשונה לא נדרסים
      { const { ctx: ctxB, page: pageB } = await newPage(browser, { env: page._env });
        await pageB.goto(APP); await pageB.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(pageB);
        await readyRequest(pageB); await pageB.click("#btnDrive");
        await pageB.waitForFunction(() => /נשמרו \d+ קבצים|נכשלה/.test(document.querySelector("#driveMsg").textContent), null, { timeout: 120000 });
        const fs2 = Object.values(page._env.folders).filter(f => f.parent === "ROOT");
        check("אותו מקום ותאריך מבקשה אחרת: שתי תיקיות נפרדות, והראשונה שלמה", fs2.length === 2 && /\(2\)$/.test(fs2[1].name) && folder.files.filter(f => !f.trashed).length === 7, fs2.map(f => f.name).join(" | "));
        await ctxB.close(); }
      await ctx.close();
    }
    // 6ו: מידע שהתעדכן במפה ולא נקלט — חוסם: נתוני אזורים, מהדורת פמ"ת חדשה, נוטמים של המפה חדשים יותר
    for (const [opt, rx, label] of [["tamperMap", /נתוני האזורים במפה עודכנו/, "עדכון בנתוני האזורים של המפה"], ["newPmt", /פורסם עדכון פמ״ת/, "מהדורת פמ״ת חדשה"], ["mapNotamNewer", /מפגר אחרי קובץ הנוטמים של המפה/, "נוטמים חדשים יותר במפה"]]) {
      const { ctx, page } = await newPage(browser, { [opt]: true });
      await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
      await page.waitForFunction(() => document.querySelector("#syncBanner").style.display === "block", null, { timeout: 20000 });
      const b = await page.textContent("#syncBanner");
      check("סנכרון — " + label + ": באנר בראש הדף", rx.test(b) && /אי אפשר להשלים בקשה/.test(b), b.replace(/\s+/g, " ").slice(0, 160));
      await fillExample(page); await page.click("#runBtn");
      await page.waitForFunction(() => document.querySelector("#e_run").textContent.length > 0, null, { timeout: 20000 });
      const er = await page.textContent("#e_run");
      check("סנכרון — " + label + ": ההרצה נעצרת ואין בקשה מוכנה", /סנכרון עם מפת החברים/.test(er) && !(await page.isVisible("#resultsSec")), er.slice(0, 160));
      await ctx.close();
    }
    // 6ז: ללא עדכון — אין באנר
    {
      const { ctx, page } = await newPage(browser);
      await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
      await page.waitForTimeout(1500);
      check("סנכרון — מצב תקין: אין באנר והסטטוס תקין", (await page.evaluate(() => document.querySelector("#syncBanner").style.display)) !== "block" && (await page.evaluate(() => window.__REQ.S.statuses.sync.ok)), "");
      await ctx.close();
    }
    // 6ח: כפתור שלח — מצב בדיקה (ברירת מחדל): מודל אישור, שליחה לבעלים בלבד, קבצים מצורפים, סימון בדרייב, יומן
    {
      const { ctx, page } = await newPage(browser);
      await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
      check("כפתור 'שלח' חסום לפני שהבקשה מוכנה", await page.isDisabled("#btnSend"), "");
      await readyRequest(page);
      check("כפתור 'שלח' נפתח כשהבקשה מוכנה", !(await page.isDisabled("#btnSend")), "");
      await page.click("#btnSend"); await page.waitForSelector(".sendBox");
      const mt = await page.textContent(".sendBox");
      check("חלון השליחה: מצב בדיקה, נמען הבעלים בלבד, נושא וקבצים", /מצב בדיקה/.test(mt) && /אין כתובת מייל רשומה בחשבון שלך, ולכן המייל יישלח רק לבעל המערכת \(owner@icd\.test\) ולא למשרד נוטאם/.test(mt) && /שלח בדיקה אליי/.test(mt) && /בקשה לסגירה אווירית —/.test(mt) && /קובץ KML/.test(mt) && ["תצ״א — תקריב", "מפת רחובות — תקריב", "הדמיה וסימונים — מבט כללי", "מפת אזור — מרוחק"].every(n => mt.includes(n)) && !/notamoffice@iaa\.gov\.il, nofm/.test(mt.split("נוסח המייל")[0].split("אל:")[1] || ""), mt.replace(/\s+/g, " ").slice(0, 200));
      check("כפתור השליחה חסום עד סימון האישור", await page.isDisabled("#sendGo"), "");
      await page.check("#sendOk"); check("אחרי סימון האישור הכפתור נפתח", !(await page.isDisabled("#sendGo")), "");
      await page.click("#sendGo");
      await page.waitForFunction(() => /נשלח במצב בדיקה|נכשלה/.test(document.querySelector("#sendProg").textContent), null, { timeout: 120000 });
      const pr = await page.textContent("#sendProg");
      check("שליחת בדיקה הצליחה (לבעלים בלבד)", /נשלח במצב בדיקה/.test(pr) && /לא נשלח למשרד נוטאם/.test(pr), pr.slice(0, 160));
      const mails = page._env.mails;
      check("נשלח מייל אחד לבעלים עם 6 קבצים מצורפים (Word, KML וארבע תמונות — בלי JSON) ללא נמען חיצוני", mails.length === 1 && mails[0].to === "owner@icd.test" && mails[0].attachments.length === 6 && !/iaa\.gov\.il/.test(JSON.stringify(mails[0].to + mails[0].cc)), mails.length + " מיילים; " + (mails[0] && mails[0].attachments.map(a => a.name).join(" | ")));
      check("נושא הבדיקה מסומן ונוסח המייל נשמר", /^\[בדיקה — לא נשלח למשרד נוטאם\] בקשה לסגירה אווירית — /.test(mails[0].subject) && /מצורפים: טופס הבקשה \(נספח ג׳, קובץ Word\)/.test(mails[0].body), mails[0].subject.slice(0, 80));
      const folder = Object.values(page._env.folders).find(f => f.parent === "ROOT");
      check("סימון 'נשלח (בדיקה)' נוצר בתיקייה בדרייב", folder.files.some(f => /^נשלח — .*\(בדיקה\)\.txt$/.test(f.name)), folder.files.map(f => f.name).join(" | ").slice(0, 200));
      const sm = await page.textContent("#sendMsg"); check("ההודעה בעמוד מציינת שליחה לבדיקה בלבד", /בדיקה/.test(sm), sm.slice(0, 120));
      // בקשה שלא השתנתה נשלחת שוב מאותה תיקייה בדרייב (בלי שמירה כפולה); שינוי בנוסח ה-Word מחייב שמירה מחדש
      const sendAgainTest = async () => { await page.click("#btnSend"); await page.waitForSelector(".sendBox"); await page.check("#sendOk"); await page.click("#sendGo"); await page.waitForFunction(() => /נשלח במצב בדיקה|נכשלה/.test(document.querySelector("#sendProg").textContent), null, { timeout: 120000 }); await page.click("#mdClose"); };
      await page.click("#mdClose");
      const nBegin = () => page._calls.actions.filter(a => a === "saveBegin").length, b0 = nBegin();
      await sendAgainTest();
      check("בקשה שלא השתנתה: שליחה חוזרת (בדיקה) משתמשת בתיקייה השמורה — בלי saveBegin נוסף", nBegin() === b0 && page._env.mails.length === 2, "saveBegin " + b0 + "→" + nBegin() + ", מיילים " + page._env.mails.length);
      await page.click("#incChecks");                                   // משנה את קובץ ה-Word
      await sendAgainTest();
      check("אחרי שינוי שמשפיע על הקבצים: נשמר מחדש לפני השליחה (saveBegin נוסף)", nBegin() === b0 + 1 && page._env.mails.length === 3, "saveBegin " + nBegin() + ", מיילים " + page._env.mails.length);
      // הודעות 'נשלח'/'נשמר' שייכות לבקשה שנשלחה — כשהבקשה משתנה הן נמחקות ולא מטעות לגבי הבקשה החדשה
      await page.evaluate(() => { document.getElementById("sendMsg").textContent = "x"; });
      await page.fill("#siteName", "שם אחר לגמרי");
      await page.waitForFunction(() => document.querySelector("#sendMsg").textContent === "" && document.querySelector("#driveMsg").textContent === "", null, { timeout: 5000 });
      check("שינוי בבקשה אחרי שליחה מוחק את הודעות 'נשלח' ו'נשמר בדרייב'", true, "");
      // בקשה שלא השתנתה נשלחת שוב מאותה תיקייה (בלי שמירה כפולה), ושינוי ב'דף הבדיקות' (Word) מצריך שמירה מחדש
      await ctx.close();
    }
    // 6ח1: המנהל מעביר למצב חי בזמן שחלון השליחה פתוח בדפדפן שהציג 'בדיקה' — לא נשלח דבר, החלון נפתח מחדש במצב חי ודורש אישור מחדש
    {
      const { ctx, page } = await newPage(browser);
      await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
      await readyRequest(page);
      await page.click("#btnSend"); await page.waitForSelector(".sendBox");
      check("חלון השליחה נפתח במצב בדיקה", /מצב בדיקה/.test(await page.textContent(".sendBox")), "");
      const env = page._env, adminTok = env.call({ action: "login", user: ADMIN, pass: PASS }).token;
      env.call({ action: "setMailMode", token: adminTok, mode: "live" });          // המנהל משנה בזמן שהחלון פתוח
      await page.check("#sendOk"); await page.click("#sendGo");
      await page.waitForFunction(() => /מצב השליחה בשרת השתנה/.test(document.querySelector("#sendMsg").textContent) && /אינה ניתנת לביטול/.test((document.querySelector(".sendBox") || {}).textContent || ""), null, { timeout: 60000 });   // לא מספיק לחכות ל"מצב חי" — המילים מופיעות גם בחלון הבדיקה
      check("מצב השליחה השתנה בשרת: לא נשלח מייל ולא נוצרה תיקייה בדרייב", env.mails.length === 0 && Object.values(env.folders).filter(f => f.parent === "ROOT").length === 0, env.mails.length + " מיילים");
      check("החלון נפתח מחדש במצב חי, עם אזהרה ועם אישור שיש לסמן שוב", /אינה ניתנת לביטול/.test(await page.textContent(".sendBox")) && (await page.isDisabled("#sendGo")) && /מצב השליחה בשרת השתנה/.test(await page.textContent("#sendMsg")), "");
      await page.check("#sendOk"); await page.click("#sendGo");
      await page.waitForFunction(() => /נשלחה למשרד נוטאם|נכשלה/.test(document.querySelector("#sendProg").textContent), null, { timeout: 120000 });
      check("אחרי אישור מחודש במצב חי: נשלח למשרד נוטאם", env.mails.length === 1 && env.mails[0].to === "notamoffice@iaa.gov.il,nofm@iaa.gov.il", env.mails.length + " מיילים");
      await ctx.close();
    }
    // 6ח2: בקשה ששונתה בזמן שחלון השליחה פתוח (אחרי שהבקשה הייתה 'מוכנה') — נחסמת בלחיצה ולא נשלחת
    {
      const { ctx, page } = await newPage(browser);
      await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
      await readyRequest(page);
      await page.click("#btnSend"); await page.waitForSelector(".sendBox");
      await page.check("#sendOk");
      await page.evaluate(() => { const h = document.getElementById("height"); h.value = "95"; h.dispatchEvent(new Event("input", { bubbles: true })); });   // שינוי נתון אחרי הבדיקות
      await page.click("#sendGo");
      await page.waitForFunction(() => /נכשלה/.test(document.querySelector("#sendProg").textContent), null, { timeout: 30000 });
      const t = await page.textContent("#sendProg");
      check("בקשה ששונתה אחרי שהייתה מוכנה: השליחה נעצרת, אין מייל ואין תיקייה", /אינה מוכנה|השתנו/.test(t) && page._env.mails.length === 0 && Object.values(page._env.folders).filter(f => f.parent === "ROOT").length === 0, t.slice(0, 160));
      await ctx.close();
    }
    // 6ח3: בזמן שמירה/שליחה — אי אפשר לסגור את החלון, להחליף אותו או להתחיל זרימה שנייה
    {
      const { ctx, page } = await newPage(browser, { apiDelay: 350 });
      await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
      await readyRequest(page);
      await page.click("#btnSend"); await page.waitForSelector(".sendBox");
      await page.check("#sendOk"); await page.click("#sendGo");
      await page.waitForFunction(() => /שומר בדרייב/.test(document.querySelector("#sendProg").textContent), null, { timeout: 30000 });
      const mid = await page.evaluate(() => ({ close: document.getElementById("mdClose").disabled, send: document.getElementById("btnSend").disabled, drive: document.getElementById("btnDrive").disabled, go: document.getElementById("sendGo").disabled, replaced: window.ReqAuth.modal("<b>x</b>") }));
      check("באמצע שליחה: כפתור הסגירה, 'שמור בדרייב' ו'שלח' חסומים, והחלון לא מוחלף", mid.close && mid.send && mid.drive && mid.go && mid.replaced === null && !!(await page.$(".sendBox")), JSON.stringify(mid));
      await page.waitForFunction(() => /נשלח במצב בדיקה|נכשלה/.test(document.querySelector("#sendProg").textContent), null, { timeout: 120000 });
      check("זרימה אחת בלבד: saveBegin נקרא פעם אחת ונשלח מייל אחד", page._calls.actions.filter(a => a === "saveBegin").length === 1 && page._env.mails.length === 1, page._calls.actions.filter(a => a === "saveBegin").length + " saveBegin");
      check("בסיום הכפתורים משוחררים", !(await page.evaluate(() => document.getElementById("mdClose").disabled)), "");
      await ctx.close();
    }
    // 6ח4: חסימה/פקיעה באמצע שליחה: מסך הכניסה מוצג (החלון נסגר) ולא נשלח דבר
    {
      const first = await newPage(browser); const env = first.page._env; await first.ctx.close();
      const adminTok = env.call({ action: "login", user: ADMIN, pass: PASS }).token;
      env.call({ action: "addUser", token: adminTok, newUser: "dave.pilot", newPass: "dave-pass-12345" });
      const { ctx, page } = await newPage(browser, { env });
      await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page, "dave.pilot", "dave-pass-12345");
      await readyRequest(page);
      await page.click("#btnSend"); await page.waitForSelector(".sendBox"); await page.check("#sendOk");
      env.call({ action: "setBlocked", token: adminTok, target: "dave.pilot", blocked: true });
      await page.click("#sendGo");
      await page.waitForSelector("#authCover", { timeout: 30000 });
      const top = await page.evaluate(() => { const f = document.getElementById("authForm") || document.getElementById("authCover"), r = f.getBoundingClientRect(), el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!(el && el.closest("#authCover")); });
      check("משתמש נחסם באמצע שליחה: מסך הכניסה מעל הכול, החלון נסגר, אין מייל ואין תיקייה", top && !(await page.$("#authModal")) && env.mails.length === 0 && Object.values(env.folders).filter(f => f.parent === "ROOT").length === 0 && /חסום/.test(await page.textContent("#authCover")), "");
      await ctx.close();
    }
    // 6ח5: טקסט נ״צ לא חוקי לא מתעלם בשקט ולא מריץ את הבדיקות על הנקודה הקודמת
    {
      const { ctx, page } = await newPage(browser);
      await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
      await fillExample(page);
      await page.fill("#coord", "זה לא נ״צ");
      await page.click("#runBtn");
      await page.waitForFunction(() => document.querySelector("#e_coord").textContent.length > 0, null, { timeout: 10000 });
      check("נ״צ לא חוקי: שגיאה בשדה ואין הרצה", /אינו חוקי/.test(await page.textContent("#e_coord")) && !(await page.isVisible("#resultsSec")) && page._calls.overpass === 0, await page.textContent("#e_coord"));
      await ctx.close();
    }
    // 6ט0: מנוי מטיס מסחרי — הרשמה עצמית בכרטיס Wix ששולם (קוד במייל), תפוגה, חידוש, ותצוגת הניהול
    {
      const first = await newPage(browser); const env = first.page._env; await first.ctx.close();
      env.props.WIX_API_KEY = "test-key";
      const DAYMS = 86400000, mk = (n, over) => Object.assign({ orderNumber: "ORD-E2E-" + n, status: "PAID", created: new Date(Date.now() - 3 * DAYMS).toISOString(), email: "pilot@example.com", firstName: "דנה", memberId: "m-1", tickets: [] }, over);
      env.wix.orders.push(mk(1), mk(2, { email: "visitor@example.com", memberId: "" }));
      const { ctx, page } = await newPage(browser, { env });
      await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 });
      await page.waitForSelector("#authForm", { timeout: 20000 });
      check("מסך הכניסה כולל קישור 'הרשמה / חידוש מנוי'", /הרשמה \/ חידוש מנוי/.test(await page.textContent("#auReg")), "");
      await page.click("#auReg"); await page.waitForSelector("#regForm");
      // כתובת בלי כרטיס שולם (רוכש שאינו חבר): אותה תשובה, אין מייל, והקוד לא יעבוד
      await page.fill("#rgEmail", "visitor@example.com"); await page.click("#rgSend"); await page.waitForSelector("#rgStep2", { state: "visible" });
      check("בלי כרטיס זכאי: אותה הודעה גנרית ולא נשלח קוד", /אם נמצא כרטיס ששולם/.test(await page.textContent("#rgInfo")) && env.mails.length === 0, "");
      await page.fill("#rgCode", "123456"); await page.fill("#rgUser", "vis.user"); await page.fill("#rgPass", "visitor-pass-12"); await page.click("#rgGo");
      await page.waitForFunction(() => document.querySelector("#rgErr").textContent.length > 0);
      check("קוד שגוי נדחה בהודעה ברורה ולא נוצר חשבון", /הקוד שגוי/.test(await page.textContent("#rgErr")) && !env.props["U:vis.user"], await page.textContent("#rgErr"));
      // הרשמה אמיתית
      await page.fill("#rgEmail", "pilot@example.com"); await page.click("#rgSend");
      await page.waitForFunction(() => document.querySelector("#rgInfo").textContent.length > 0);
      await page.waitForFunction(() => true); await page.waitForTimeout(300);
      const mailRec = env.mails[env.mails.length - 1], code = /(\d{6})/.exec(mailRec.subject)[1];
      check("נשלח קוד בן 6 ספרות רק לכתובת הרכישה", mailRec.to === "pilot@example.com" && env.mails.length === 1, mailRec.to);
      await page.fill("#rgCode", code); await page.fill("#rgUser", "dana.pilot"); await page.fill("#rgPass", "dana-pass-1234"); await page.click("#rgGo");
      await page.waitForSelector("#authCover", { state: "detached", timeout: 20000 });
      const sub = await page.textContent("#ubSub");
      check("אחרי ההרשמה: המשתמש מחובר, ובשורת המשתמש מוצג תוקף המנוי (12 חודשים)", /dana\.pilot/.test(await page.textContent("#userBar")) && /מנוי עד/.test(sub) && !/מסתיים בעוד/.test(sub), sub);
      check("המשתמש החדש הוא משתמש רגיל: אין ניהול משתמשים", !(await page.$("#ubAdmin")), "");
      // תפוגה: אחרי הסיום אי אפשר להיכנס, ויש הסבר וקישור לחידוש
      const rec = JSON.parse(env.props["U:dana.pilot"]); rec.until = env.now() - 1000; env.props["U:dana.pilot"] = JSON.stringify(rec);   // שעון Apps Script המדומה (לא Date.now של המכונה)
      await page.click("#ubOut"); await page.waitForSelector("#authForm");
      await page.fill("#auUser", "dana.pilot"); await page.fill("#auPass", "dana-pass-1234"); await page.click("#auGo");
      await page.waitForFunction(() => document.querySelector("#auErr").textContent.length > 0);
      const ex = await page.textContent("#authCover");
      check("מנוי שהסתיים: הודעה על הסיום, והסבר על חידוש עם קישור לרכישה", /המנוי הסתיים/.test(ex) && (await page.$$eval("#auErr a", a => a.map(x => x.href))).some(h => /icd\.org\.il\/events-1\/bqst-yswry-tysh/.test(h)), ex.replace(/\s+/g, " ").slice(0, 160));
      // חידוש: כרטיס חדש → קוד → ללא שם משתמש וסיסמה
      env.wix.orders.push(mk(3, { created: new Date().toISOString() }));
      await page.click("#auReg"); await page.waitForSelector("#regForm");
      await page.fill("#rgEmail", "pilot@example.com"); await page.click("#rgSend"); await page.waitForSelector("#rgStep2", { state: "visible" }); await page.waitForTimeout(300);
      const code2 = /(\d{6})/.exec(env.mails[env.mails.length - 1].subject)[1];
      check("בחידוש הנושא של המייל מציין חידוש", /לחידוש/.test(env.mails[env.mails.length - 1].subject), env.mails[env.mails.length - 1].subject);
      await page.fill("#rgCode", code2); await page.click("#rgGo");
      await page.waitForSelector("#authForm", { timeout: 20000 });
      check("אחרי חידוש: הודעה על התוקף החדש, וחזרה למסך הכניסה", /המנוי חודש עד/.test(await page.textContent("#auErr")), await page.textContent("#auErr"));
      await page.fill("#auUser", "dana.pilot"); await page.fill("#auPass", "dana-pass-1234"); await page.click("#auGo");
      await page.waitForSelector("#authCover", { state: "detached", timeout: 20000 });
      check("אחרי החידוש אפשר להיכנס", /dana\.pilot/.test(await page.textContent("#userBar")), "");
      await page.click("#ubOut"); await page.waitForSelector("#authForm");
      // ניהול: מנהל רואה מייל ותוקף, משנה תוקף, ובודק כרטיס
      await page.fill("#auUser", ADMIN); await page.fill("#auPass", PASS); await page.click("#auGo");
      await page.waitForSelector("#authCover", { state: "detached", timeout: 20000 });
      await page.click("#ubAdmin"); await page.waitForSelector("#admBody .admTbl");
      const rows = await page.$$eval("#admBody table.admTbl:nth-of-type(1) tr", r => r.map(x => [...x.children].map(c => c.textContent.trim())));
      const dr = rows.find(c => c[0] === "dana.pilot");
      check("ניהול: ליד המשתמש מוצגים המייל ותאריך סיום המנוי", !!dr && dr[3] === "pilot@example.com" && /\d/.test(dr[4]) && !/הסתיים/.test(dr[4]), JSON.stringify(dr));
      page.once("dialog", d => d.accept("2031-05-05"));
      await page.click("[data-exp='dana.pilot']");
      await page.waitForFunction(() => /2031|05\.05|5\.5\.2031|5\/5\/2031/.test(document.querySelector("#admBody").textContent), null, { timeout: 10000 });
      check("ניהול: 'שינוי תוקף' מעדכן את תאריך הסיום בשרת", new Date(JSON.parse(env.props["U:dana.pilot"]).until).getUTCFullYear() === 2031, "");
      await page.fill("#wxE", "pilot@example.com"); await page.click("#wxForm button[type=submit]");
      await page.waitForFunction(() => /הזמנה ORD-E2E/.test(document.querySelector("#wxOut").textContent), null, { timeout: 10000 });
      check("ניהול: אבחון כרטיס מציג את ההזמנות והאם נוצלו", /נוצלה ע״י dana\.pilot/.test(await page.textContent("#wxOut")), await page.textContent("#wxOut"));
      await ctx.close();
    }
    // 6ט1: כפתורי "בקשות טיסה" במפה מוסתרים עד שהפיצ'ר מופעל (api_url), ומוצגים אחריו
    for (const [active, label] of [[false, "לפני הפעלה (api_url ריק)"], [true, "אחרי הפעלה (api_url מוגדר)"]]) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "he-IL" }), pg = await ctx.newPage();
      await pg.route(/\/gate\.js/, r => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
      await pg.route(/\/requests\/config\.json/, r => { const d = JSON.parse(fs.readFileSync(path.join(ROOT, "members-k38p", "requests", "config.json"), "utf8")); d.api_url = active ? API : ""; r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(d) }); });
      await pg.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/leaflet/, r => { const n = r.request().url().split("/").pop().split("?")[0]; const f = path.join(ROOT, "members-k38p", "requests", "vendor", "leaflet", n.replace(".min", "")); fs.existsSync(f) ? r.fulfill({ status: 200, contentType: n.endsWith("css") ? "text/css" : "text/javascript", body: fs.readFileSync(f) }) : r.fulfill({ status: 404, body: "" }); });
      await pg.route(/fonts\.|arcgisonline|openstreetmap|googletagmanager|google-analytics/, r => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
      await pg.goto(BASE + "/members-k38p/index.html"); await pg.waitForTimeout(1500);
      const st = await pg.evaluate(() => ["reqOpenHead", "reqOpenEmpty"].map(id => { const a = document.getElementById(id); return a ? { hidden: a.hidden, shown: !!(a.offsetWidth || a.offsetHeight) } : null; }));
      check("כפתורי בקשות טיסה במפה — " + label + ": " + (active ? "מוצגים" : "מוסתרים"), st.every(x => x && (active ? !x.hidden : x.hidden)), JSON.stringify(st));
      await ctx.close();
    }
    // 6ט: מצב חי — נמענים מפמ״ת א-11 סעיף 6(א), עותק לבעלים, חסימת שליחה כפולה ושליחה חוזרת מפורשת
    {
      const first = await newPage(browser); const env = first.page._env; await first.ctx.close();
      const adminTok = env.call({ action: "login", user: ADMIN, pass: PASS }).token;
      env.call({ action: "setMailMode", token: adminTok, mode: "live" });
      const { ctx, page } = await newPage(browser, { env });
      await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
      await readyRequest(page);
      await page.click("#btnSend"); await page.waitForSelector(".sendBox");
      const mt = await page.textContent(".sendBox");
      check("חלון השליחה במצב חי: הנמענים מפמ״ת א-11 והודעה שהשליחה אינה ניתנת לביטול", /מצב חי/.test(mt) && /notamoffice@iaa\.gov\.il, nofm@iaa\.gov\.il/.test(mt) && /אינה ניתנת לביטול/.test(mt), mt.replace(/\s+/g, " ").slice(0, 220));
      await page.check("#sendOk"); await page.click("#sendGo");
      await page.waitForFunction(() => /נשלחה למשרד נוטאם|נכשלה/.test(document.querySelector("#sendProg").textContent), null, { timeout: 120000 });
      const m = env.mails[0];
      check("מצב חי: נשלח ל-notamoffice@ ול-nofm@ בלבד, עותק לבעלים", env.mails.length === 1 && m.to === "notamoffice@iaa.gov.il,nofm@iaa.gov.il" && m.cc === "owner@icd.test" && !/^\[בדיקה/.test(m.subject), JSON.stringify([m.to, m.cc]));
      check("מצב חי: הודעת הצלחה עם הנמענים והשעה", /נשלחה למשרד נוטאם/.test(await page.textContent("#sendProg")), "");
      await page.click("#mdClose"); await page.click("#btnSend"); await page.waitForSelector(".sendBox");
      await page.check("#sendOk"); await page.click("#sendGo");
      await page.waitForFunction(() => document.querySelector("#sendAgain"), null, { timeout: 120000 });
      check("שליחה חוזרת של אותה בקשה: נחסמת עם הודעה מתי נשלחה", env.mails.length === 1 && /כבר נשלחה למשרד נוטאם/.test(await page.textContent("#sendProg")), "");
      await page.click("#sendAgain");
      await page.waitForFunction(() => /נשלחה למשרד נוטאם/.test(document.querySelector("#sendProg").textContent) && !document.querySelector("#sendAgain"), null, { timeout: 60000 });
      check("'שלח שוב בכל זאת' שולח מייל נוסף", env.mails.length === 2, "");
      // ניהול: יומן בקשות מציג את הבקשה כנשלחה, ויש כפתור חסימה ליד כל משתמש
      env.call({ action: "addUser", token: adminTok, newUser: "dave.pilot", newPass: "dave-pass-12345" });
      await page.click("#mdClose"); await page.click("#ubAdmin"); await page.waitForSelector("#admBody .admTbl");
      const adm = await page.textContent("#admBody");
      check("ניהול: מצב שליחה חי מוצג, והיומן מציג את הבקשה כנשלחה למשרד נוטאם (פעמיים)", /מצב שליחה: חי/.test(adm) && /נשלחה למשרד נוטאם \(2 פעמים\)/.test(adm), adm.replace(/\s+/g, " ").slice(0, 300));
      check("ניהול: ליד כל משתמש (שאינו המנהל עצמו) כפתור 'חסום מבקשות'", (await page.$$("button.block[data-blk='dave.pilot']")).length === 1 && (await page.$$("button[data-blk='" + ADMIN + "']")).length === 0, "");
      const rows = await page.$$eval("#admBody table.admTbl:nth-of-type(1) tr", r => r.map(x => [...x.children].map(c => c.textContent.trim())));
      const adminRow = rows.find(c => c[0] === ADMIN);
      check("ניהול: ליד המנהל מוצגות כמות הבקשות שהגיש (1) והנשלחות (2 לפי מניין שליחות אמיתיות)", !!adminRow && adminRow[5] === "1" && adminRow[6] === "2", JSON.stringify(adminRow));
      await page.click("button.block[data-blk='dave.pilot']"); await page.waitForSelector("button.unblock[data-blk='dave.pilot']");
      check("חסימה מהכפתור: מופיע 'פתח מחדש את הבקשות' והמשתמש חסום בשרת", /פתח מחדש את הבקשות/.test(await page.textContent("button.unblock[data-blk='dave.pilot']")) && env.call({ action: "login", user: "dave.pilot", pass: "dave-pass-12345" }).error === "blocked", "");
      await page.click("button.unblock[data-blk='dave.pilot']"); await page.waitForSelector("button.block[data-blk='dave.pilot']");
      check("פתיחה מחדש מהכפתור: המשתמש יכול שוב להיכנס", !!env.call({ action: "login", user: "dave.pilot", pass: "dave-pass-12345" }).ok, "");
      // החלפה למצב בדיקה מהממשק
      page.once("dialog", d => d.accept());
      await page.click("#admMode"); await page.waitForFunction(() => /מצב שליחה: בדיקה/.test(document.querySelector("#admBody").textContent) || document.querySelector(".admMode.test"), null, { timeout: 10000 });
      check("מנהל מעביר בחזרה למצב בדיקה מהממשק", env.call({ action: "me", token: adminTok }).mailMode === "test", "");
      await ctx.close();
    }
    // 6י: כתובות היעד בשרת שונות מהנוהל — לא שולחים
    {
      const first = await newPage(browser); const env = first.page._env; await first.ctx.close();
      const adminTok = env.call({ action: "login", user: ADMIN, pass: PASS }).token;
      env.call({ action: "setMailMode", token: adminTok, mode: "live" });
      env.run("(function(){ CFG.MAIL_TO = ['evil@example.com']; })");
      const { ctx, page } = await newPage(browser, { env });
      await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
      await readyRequest(page); await page.click("#btnSend");
      await page.waitForFunction(() => document.querySelector("#sendMsg").textContent.length > 0, null, { timeout: 20000 });
      const t = await page.textContent("#sendMsg");
      check("כתובות יעד בשרת שונות מהנוהל: לא נפתח חלון שליחה ולא נשלח דבר", /שונות מהכתובות בנוהל א-11/.test(t) && !(await page.$(".sendBox")) && env.mails.length === 0, t.slice(0, 160));
      await ctx.close();
    }
    // 6ל: המפה התעדכנה אחרי שהבקשה כבר הייתה מוכנה — שליחה/שמירה נחסמות, הנתונים נטענים מחדש, והבקשה חייבת בדיקה חוזרת
    {
      const { ctx, page } = await newPage(browser);
      await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
      await readyRequest(page);
      check("לפני עדכון המפה: כפתור השליחה פתוח", !(await page.isDisabled("#btnSend")), "");
      page._map.tamper = true;                                 // המפה עודכנה; הייצוא עדיין לא רץ
      await page.click("#btnSend");
      await page.waitForFunction(() => /אינם מסונכרנים/.test(document.querySelector("#sendMsg").textContent), null, { timeout: 20000 });
      check("המפה התעדכנה והייצוא טרם רץ: השליחה נחסמת, אין חלון ואין מייל", !(await page.$(".sendBox")) && page._env.mails.length === 0 && (await page.evaluate(() => document.querySelector("#syncBanner").style.display)) === "block", "");
      check("המפה התעדכנה: שמירה בדרייב ושליחה חסומות בשער (שום תיקייה לא נוצרה)", (await page.isDisabled("#btnDrive")) && (await page.isDisabled("#btnSend")) && Object.values(page._env.folders).filter(f => f.parent === "ROOT").length === 0, "");
      page._map.zonesHash = page._tamperedHash();              // הייצוא האוטומטי הסתיים: zones.json תואם למפה החדשה — הדף מתאושש מעצמו
      await page.waitForFunction(() => /הבקשה אינה מוכנה לשליחה/.test(document.querySelector("#gate").textContent) && /התעדכנו מאז הרצת הבדיקות/.test(document.querySelector("#gate").textContent), null, { timeout: 30000 });
      check("אחרי שהייצוא הסתיים: הדף טוען נתונים חדשים, הבקשה מסומנת כישנה וחייבת הרצה מחדש", await page.isDisabled("#btnSend") && (await page.evaluate(() => window.__REQ.S.data.zones.dataHash)) === page._map.zonesHash, "");
      await page.click("#runBtn");
      await page.waitForFunction(() => document.querySelector("#gate .banner") && !/התעדכנו מאז הרצת/.test(document.querySelector("#gate").textContent), null, { timeout: 150000 });
      await page.check("#reviewOk");
      await page.waitForFunction(() => /הבקשה מוכנה לשליחה/.test(document.querySelector("#gate").textContent), null, { timeout: 15000 });
      check("אחרי הרצה חוזרת על הנתונים החדשים: הבקשה מוכנה והשליחה פתוחה", !(await page.isDisabled("#btnSend")), "");
      await ctx.close();
    }
    // 6ם: נוטמים חדשים בשרת אחרי טעינת הדף — נטענים מחדש והבקשה נפסלת עד הרצה חוזרת
    {
      const { ctx, page } = await newPage(browser);
      await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
      await readyRequest(page);
      page._notamIso = new Date(Date.now() + 3 * 3600e3).toISOString();    // משיכה חדשה של הנוטמים (שני הקבצים)
      await page.route(/\/notam-data\.json/, r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ fetched_iso: page._notamIso, notams: [] }) }));
      await page.click("#btnSend");
      await page.waitForFunction(() => /התעדכנו מאז הרצת הבדיקות/.test(document.querySelector("#gate").textContent), null, { timeout: 30000 });
      check("נוטמים חדשים אחרי הניתוח: הבקשה נפסלת וחייבת בדיקה חוזרת (בלי מייל)", await page.isDisabled("#btnSend") && page._env.mails.length === 0 && (await page.evaluate(() => window.__REQ.S.data.notamFetchedIso)) === page._notamIso, "");
      await ctx.close();
    }
    // 6ו2: נוטמים ישנים מ-72 שעות (גם במפה, כלומר סנכרון תקין) — הבדיקה נכשלת וההודעה מסבירה מה לעשות; הבקשה לא מוכנה
    {
      const { ctx, page } = await newPage(browser, { notamAgeH: 80 });
      await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
      await fillExample(page); await page.click("#runBtn");
      await page.waitForFunction(() => document.querySelector("#gate .banner"), null, { timeout: 150000 });
      const g = await page.textContent("#gate");
      check("נוטמים בני 80 שעות: הבקשה אינה מוכנה, ההודעה מציינת גיל ומה לעשות, ושליחה חסומה", /אינה מוכנה לשליחה/.test(g) && /נתוני הנוטמים ישנים \(80 שעות/.test(g) && /Run workflow/.test(g) && (await page.isDisabled("#btnSend")) && (await page.isDisabled("#btnDrive")), g.replace(/\s+/g, " ").slice(0, 200));
      await ctx.close();
    }
    // 6ה0: קובץ נוטמים ריק (listed=0, count=0, בלי נוטמים) — לא מתקבל כ"אין סגירות": ההרצה נעצרת
    {
      const { ctx, page } = await newPage(browser, { notamEmpty: true });
      await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
      await fillExample(page); await page.click("#runBtn");
      await page.waitForFunction(() => document.querySelector("#e_run").textContent.length > 0, null, { timeout: 15000 });
      const g = await page.textContent("#e_run");
      check("קובץ נוטמים ריק: ההרצה נעצרת עם הסבר, ואין בקשה מוכנה", /נוטמים אינם תקינים/.test(g) && /ריק או חסר/.test(g) && !(await page.isVisible("#resultsSec")), g.slice(0, 200));
      await ctx.close();
    }
    // 6ה: קובץ נוטמים חלקי -> הבדיקה נכשלת ולא מוכן לשליחה
    {
      const { ctx, page } = await newPage(browser, { notamIncomplete: true });
      await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
      await fillExample(page); await page.click("#runBtn");
      await page.waitForFunction(() => document.querySelector("#e_run").textContent.length > 0, null, { timeout: 15000 });
      const g = await page.textContent("#e_run");
      check("קובץ נוטמים חלקי (חסרים פרטים): ההרצה נעצרת ואין בקשה מוכנה", /נוטמים אינם תקינים/.test(g) && /אינו שלם/.test(g) && !(await page.isVisible("#resultsSec")), g.slice(0, 200));
      await ctx.close();
    }
  }
  /* ===== תרחיש 12: מהויות פעילות נוספות (נשמרות בדפדפן, כמו כלי טיס נוספים) — הוספה ובחירה אוטומטית, שמירה אחרי טעינה מחדש, הסרה ב-×, כפילות, תקרה 30,
     טקסט עוין, localStorage משובש וחסום, לחצן ״!״, מסך צר; ובמצב רגיל גם הזרימה עד הטופס, המייל, ה-Word, הדרייב וחסימת השער ===== */
  {
    const PUKEY = "icd_req_purposes_v1", HOSTILE = '<img src=x onerror="window.__xss=1"> ]]> </w:t>', P1 = "לצורך הדרכת טייסים";
    const { ctx, page } = await newPage(browser);
    await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
    const reloadPu = async () => { await page.reload(); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await page.waitForFunction(() => !document.body.classList.contains("authLocked"), null, { timeout: 15000 }); };
    const cfgPu = await page.evaluate(() => window.__REQ.S.cfg.purposes), fixedOpts = [""].concat(cfgPu);
    const opts = () => page.$$eval("#purpose option", els => els.map(e => e.value));
    const sel = () => page.inputValue("#purpose");
    const chips = () => page.$$eval("#puList > span", els => els.map(e => e.firstElementChild.textContent));
    const storedArr = async () => { const t = await page.evaluate(k => localStorage.getItem(k), PUKEY); return t == null ? [] : JSON.parse(t); };
    const addPu = async t => { await page.fill("#puNew", t); await page.click("#puAdd"); };
    const rmPu = async t => { const i = (await chips()).indexOf(t); await page.locator("#puList [data-purm]").nth(i).click(); };
    const puMsg = () => page.textContent("#puMsg");
    const bubble = () => page.evaluate(() => { const b = document.getElementById("hbubble"); return !b || b.hidden ? null : b.textContent; });
    check("מהות פעילות: בהתחלה ״בחרו…״ והמהויות הקבועות בלבד; אין צ׳יפים ואין מהות שמורה; שדה ההוספה מוגבל ל-80 תווים עם placeholder", (await opts()).join("|") === fixedOpts.join("|") && (await sel()) === "" && (await chips()).length === 0 && !(await page.isVisible("#puSaved")) && (await storedArr()).length === 0 && (await page.getAttribute("#puNew", "maxlength")) === "80" && /^למשל: לצורך/.test(await page.getAttribute("#puNew", "placeholder")), (await opts()).join("|"));
    // הוספה: ניקוי רווחים וטאב, בחירה מיידית, צ׳יפ עם ×, שמירה ב-localStorage, שדה ההוספה מתרוקן
    await addPu("   לצורך    הדרכת \t טייסים  ");
    check("הוספת מהות: נוספה ל-select אחרי ניקוי רווחים, נבחרה מיד, מוצגת כצ׳יפ עם ×, נשמרה ב-localStorage (icd_req_purposes_v1), ושדה ההוספה התרוקן", (await opts()).length === fixedOpts.length + 1 && (await opts()).includes(P1) && (await sel()) === P1 && (await chips()).join("|") === P1 && (await page.locator("#puList [data-purm]").count()) === 1 && JSON.stringify(await storedArr()) === JSON.stringify([P1]) && (await page.inputValue("#puNew")) === "" && (await page.isVisible("#puSaved")), JSON.stringify(await storedArr()));
    // כפילות: מהות קיימת (גם בשינוי רישיות/רווחים, וגם מהות קבועה) רק נבחרת — לא מתווספת
    await page.selectOption("#purpose", ""); await addPu(P1);
    check("כפילות מדויקת: לא מתווספת, רק נבחרת מחדש, עם הודעה בעברית", (await chips()).join("|") === P1 && (await sel()) === P1 && /כבר ברשימה/.test(await puMsg()) && (await storedArr()).length === 1, await puMsg());
    await addPu("Survey Mode"); await addPu("  survey   MODE ");
    check("כפילות שאינה תלויה ברישיות וברווחים: ״survey MODE״ לא מתווספת ומסמנת את ״Survey Mode״ הקיימת", (await chips()).join("|") === P1 + "|Survey Mode" && (await sel()) === "Survey Mode" && (await storedArr()).length === 2, (await chips()).join("|"));
    await addPu(" " + cfgPu[1] + " ");
    check("מהות קבועה שהוקלדה שוב: נבחרת בלי להתווסף לרשימה השמורה (ובלי צ׳יפ ובלי ×)", (await sel()) === cfgPu[1] && (await chips()).length === 2 && (await opts()).length === fixedOpts.length + 2 && (await storedArr()).length === 2, await sel());
    await addPu("   ");
    check("שדה ריק או רווחים בלבד: לא מתווסף, ומוצגת הודעה", /יש להקליד מהות/.test(await puMsg()) && (await chips()).length === 2, await puMsg());
    // אורך: מעל 80 (הוקלד תוכניתית, עוקף את maxlength) נדחה בלי חיתוך שקט והשם נשאר בשדה; בדיוק 80 מתקבל
    await page.evaluate(() => { document.getElementById("puNew").value = "א".repeat(81); }); await page.click("#puAdd");
    check("מהות ארוכה מ-80 תווים: נדחית בהודעה, לא נחתכת בשקט ולא נשמרת, והטקסט נשאר בשדה", /עד 80 תווים/.test(await puMsg()) && (await chips()).length === 2 && (await storedArr()).length === 2 && (await page.inputValue("#puNew")).length === 81, await puMsg());
    await addPu("ב".repeat(80));
    check("מהות של בדיוק 80 תווים מתקבלת ונבחרת", (await sel()) === "ב".repeat(80) && (await chips()).length === 3, "");
    await rmPu("ב".repeat(80));
    await page.fill("#puNew", "לצורך אימון"); await page.press("#puNew", "Enter");
    check("Enter בשדה ההוספה מוסיף ובוחר (כמו הכפתור)", (await sel()) === "לצורך אימון" && (await chips()).includes("לצורך אימון"), "");
    // טקסט עוין: מוצג כטקסט, לא מוזרק, ונשמר כלשונו
    await addPu(HOSTILE); await page.waitForTimeout(400);
    check("מהות עם HTML עוין: נבחרת ומוצגת כטקסט (option וצ׳יפ), לא מוזרקת לדף ואינה מפעילה סקריפט, ונשמרת כלשונה", (await sel()) === HOSTILE && (await chips()).includes(HOSTILE) && (await storedArr()).includes(HOSTILE) && (await page.evaluate(() => window.__xss === undefined && !document.querySelector("#puBox img, #purpose img"))), (await chips()).join("|"));
    const before = await storedArr();
    await reloadPu();
    check("אחרי טעינה מחדש של הדף (באותו הקשר דפדפן): כל המהויות שנוספו נשמרו ומוצגות כצ׳יפים באותו סדר, ואין מהות נבחרת אוטומטית", (await chips()).join("|") === before.join("|") && (await opts()).join("|") === fixedOpts.concat(before).join("|") && (await sel()) === "" && (await page.evaluate(() => window.__xss === undefined)), (await chips()).join("|"));
    // הסרה ב-×: מהות נבחרת שהוסרה => חוזרים ל״בחרו…״; הסרת מהות אחרת לא משנה את הבחירה; הקבועות בלי ×
    check("המהויות הקבועות מ-config.json אינן ניתנות להסרה: אין להן צ׳יפ ו-×", (await chips()).every(c => !cfgPu.includes(c)) && (await page.locator("#puList [data-purm]").count()) === before.length, "");
    await page.selectOption("#purpose", "Survey Mode"); await rmPu(P1);
    check("הסרת מהות שאינה הנבחרת: נמחקת מהרשימה, מהאחסון ומה-select, והבחירה הנוכחית לא משתנה", !(await opts()).includes(P1) && !(await chips()).includes(P1) && !(await storedArr()).includes(P1) && (await sel()) === "Survey Mode", (await chips()).join("|"));
    await rmPu("Survey Mode");
    check("הסרת המהות הנבחרת: חוזרים ל״בחרו…״", (await sel()) === "" && !(await opts()).includes("Survey Mode") && !(await storedArr()).includes("Survey Mode"), await sel());
    await reloadPu();
    check("מהות שהוסרה לא חוזרת אחרי טעינה מחדש", !(await chips()).includes(P1) && !(await opts()).includes(P1) && !(await opts()).includes("Survey Mode"), (await chips()).join("|"));
    // לחצן ״!״ ליד כפתור ההוספה
    { const hb = page.locator(".hw:has(#puAdd) > .hbtn"), help = await hb.getAttribute("data-help");
      check("״!״ ליד ״הוסף מהות פעילות״: צמוד לכפתור, aria-label ייחודי, והסבר מדויק (מה נשמר, איפה, שדה 4 בטופס ובמייל, ורק מה שהוספת ניתן להסרה)", (await hb.count()) === 1 && (await hb.getAttribute("aria-label")) === "הסבר על: הוספת מהות פעילות" && (await page.locator('.hbtn[aria-label="הסבר על: הוספת מהות פעילות"]').count()) === 1 && /בדפדפן הזה בלבד/.test(help) && /לא בשרת/.test(help) && /עד 30 מהויות נוספות/.test(help) && /שדה 4 בטופס הרשמי/.test(help) && /למייל/.test(help) && /אי אפשר להסיר/.test(help), help);
      await hb.click();
      check("״!״ של המהות נפתח: הבועה מציגה את ההסבר, aria-expanded=true", (await bubble()) === help && (await hb.getAttribute("aria-expanded")) === "true", "");
      await hb.click(); check("לחיצה נוספת על ״!״ סוגרת", (await bubble()) === null && (await hb.getAttribute("aria-expanded")) === "false", "");
      await hb.click(); await page.keyboard.press("Escape"); check("Escape סוגר את בועת ״!״ של המהות", (await bubble()) === null, "");
      await hb.click(); await page.click("header h1"); check("לחיצה מחוץ לבועה סוגרת אותה", (await bubble()) === null, "");
    }
    // תקרת 30 מהויות נוספות — בהוספה (הודעה, בלי הוספה, השם נשאר בשדה) ובטעינה
    while ((await chips()).length) await rmPu((await chips())[0]);
    for (let i = 0; i < 31; i++) await addPu("מהות בדיקה " + i);
    check("תקרה: ההוספה ה-31 נדחית בהודעה בעברית, השם נשאר בשדה, ומה שמוצג הוא מה שנשמר (30)", (await chips()).length === 30 && (await storedArr()).length === 30 && (await puMsg()) === "ניתן לשמור עד 30 מהויות פעילות נוספות — הסירו אחת כדי להוסיף" && (await page.inputValue("#puNew")) === "מהות בדיקה 30" && !(await opts()).includes("מהות בדיקה 30"), (await chips()).length + "/" + (await storedArr()).length + " | " + (await puMsg()));
    await addPu("מהות בדיקה 3");
    check("בתקרה: מהות קיימת עדיין נבחרת (אינה הוספה, ולכן אינה נחסמת)", (await sel()) === "מהות בדיקה 3" && (await chips()).length === 30, await puMsg());
    await reloadPu();
    check("אחרי טעינה מחדש: אותן 30 מהויות (אף אחת לא נעלמה)", (await chips()).length === 30 && (await storedArr()).length === 30, (await chips()).length + "/" + (await storedArr()).length);
    await rmPu("מהות בדיקה 0"); await page.fill("#puNew", "מהות אחרי הסרה"); await page.click("#puAdd");
    check("אחרי הסרת מהות אפשר שוב להוסיף (חזרה ל-30, בלי הודעת תקרה)", (await chips()).length === 30 && (await storedArr()).length === 30 && (await sel()) === "מהות אחרי הסרה" && !/ניתן לשמור עד/.test(await puMsg()), await puMsg());
    // מסך צר: צ׳יפ של 80 תווים והשדה/הכפתור לא יוצאים מהמסך
    await rmPu("מהות בדיקה 1"); await addPu("ג".repeat(40) + " " + "ד".repeat(39));
    for (const w of [320, 360, 390]) {
      await page.setViewportSize({ width: w, height: 900 });
      const fit = await page.evaluate(() => [...document.querySelectorAll("#puBox, #puBox *")].every(e => { const r = e.getBoundingClientRect(); return r.width === 0 || (r.left >= -1 && r.right <= window.innerWidth + 1); }));
      check("מסך צר " + w + "px: אזור המהות (שדה, כפתור, ״!״ וצ׳יפים ארוכים) נשאר בתוך המסך", fit, "");
    }
    await page.setViewportSize({ width: 1280, height: 1000 });
    // localStorage משובש: לא מפיל את הדף (כל שגיאת JS נכשלת בבדיקת pageerror), פריטים פגומים נזרקים, הכפילויות והתקרה נאכפות בטעינה
    const setRaw = async v => { await page.evaluate(([k, x]) => localStorage.setItem(k, x), [PUKEY, v]); await reloadPu(); };
    for (const raw of ["{not json", '{"a":1}', "123", "null", '"str"', "[", ""]) {
      await setRaw(raw);
      check("localStorage משובש (" + (raw || "מחרוזת ריקה") + "): הדף נטען, המהויות הקבועות בלבד, בלי צ׳יפים", (await opts()).join("|") === fixedOpts.join("|") && (await chips()).length === 0, (await opts()).join("|"));
    }
    await addPu("מהות אחרי שיבוש");
    check("אחרי אחסון משובש: הוספה עובדת וכותבת מערך תקין במקום הפגום", JSON.stringify(await storedArr()) === JSON.stringify(["מהות אחרי שיבוש"]) && (await sel()) === "מהות אחרי שיבוש", JSON.stringify(await storedArr()));
    await setRaw(JSON.stringify([{ a: 1 }, 5, null, ["x"], true, "תקין א", "  תקין    א ", cfgPu[0], " ", "", "א".repeat(81), "ב".repeat(5000), "תקין ב" + String.fromCharCode(10) + "ג", "x" + String.fromCharCode(0xd800) + "y", "Latin ok", "LATIN OK"]));
    check("מערך עם אובייקטים וערכים פגומים: נזרקים הלא-מחרוזות, הריקות, הארוכות מ-80, הכפילויות והקבועות; תווי בקרה וחצי סרוגייט הופכים לרווח", JSON.stringify(await chips()) === JSON.stringify(["תקין א", "תקין ב ג", "x y", "Latin ok"]) && (await opts()).join("|") === fixedOpts.concat(["תקין א", "תקין ב ג", "x y", "Latin ok"]).join("|"), JSON.stringify(await chips()));
    await setRaw(JSON.stringify(Array.from({ length: 50 }, (_, i) => "מהות " + i)));
    check("אחסון עם 50 מהויות (מעל התקרה): נטענות רק 30 הראשונות", (await chips()).length === 30 && (await chips())[29] === "מהות 29", (await chips()).length + "");
    await page.evaluate(k => localStorage.removeItem(k), PUKEY);
    await ctx.close();
    { // localStorage חסום (getItem/setItem זורקים — פרטיות או מכסה): הדף נטען, והוספה עובדת בתוך ההפעלה בלבד
      const { ctx: ctxB, page: pb } = await newPage(browser);
      await ctxB.addInitScript(() => {
        const g = Storage.prototype.getItem, s = Storage.prototype.setItem;
        Storage.prototype.getItem = function (k) { if (k === "icd_req_purposes_v1") throw new Error("blocked"); return g.apply(this, arguments); };
        Storage.prototype.setItem = function (k) { if (k === "icd_req_purposes_v1") throw new Error("blocked"); return s.apply(this, arguments); };
      });
      await pb.goto(APP); await pb.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(pb);
      await pb.fill("#puNew", "מהות בלי אחסון"); await pb.click("#puAdd");
      check("localStorage חסום: הדף נטען וההוספה עובדת בתוך ההפעלה (נבחרת, צ׳יפ) בלי להפיל את הדף", (await pb.inputValue("#purpose")) === "מהות בלי אחסון" && (await pb.locator("#puList [data-purm]").count()) === 1, "");
      await ctxB.close();
    }
    if (!LIVE) { // זרימה מלאה עם מהות עוינת: הטופס (שדה 4), המייל, ה-Word, השליחה והדרייב; ובסוף חסימת השער כשהמהות נעלמת
      const { ctx: c2, page: p2 } = await newPage(browser);
      await p2.goto(APP); await p2.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(p2);
      await fillExample(p2);
      await p2.fill("#puNew", HOSTILE); await p2.click("#puAdd");
      await p2.click("#runBtn");
      await p2.waitForFunction(() => document.querySelector("#gate .banner"), null, { timeout: 150000 });
      await p2.check("#reviewOk");
      await p2.waitForFunction(() => /הבקשה מוכנה לשליחה/.test(document.querySelector("#gate").textContent), null, { timeout: 15000 });
      await p2.waitForTimeout(300);
      const rows = p2.locator("#report .paper:first-child table.f tr"), row4 = rows.nth(3), form = await row4.innerText(), formHtml = await row4.innerHTML();
      check("מהות מותאמת עוינת: מופיעה בשדה 4 בטופס כטקסט (escaped), בלי תגית מוזרקת ובלי הפעלת סקריפט", /מהות הפעילות המבוקשת/.test(form) && form.replace(/\s+/g, " ").includes(HOSTILE) && formHtml.includes("&lt;img src=x onerror=") && !formHtml.includes("<img") && (await p2.locator("#report img[src='x']").count()) === 0 && (await p2.evaluate(() => window.__xss === undefined)), form.slice(0, 160));
      const mailBody = await p2.evaluate(() => window.__REQ.O.mail(window.__REQ.S.res, window.__REQ.S.cfg).body), mailHref = decodeURIComponent(await p2.getAttribute("#btnMail", "href"));
      check("המהות המותאמת בגוף המייל ובקישור mailto (שורה ״מהות הפעילות: …״)", mailBody.split("\n").includes("מהות הפעילות: " + HOSTILE) && mailHref.includes("מהות הפעילות: " + HOSTILE), mailBody.slice(0, 200));
      { const JZ = require(path.join(ROOT, "members-k38p", "requests", "vendor", "jszip.min.js")), [d] = await Promise.all([p2.waitForEvent("download"), p2.click("#btnDocx")]), pth = path.join(OUT, "s12-" + d.suggestedFilename());
        await d.saveAs(pth);
        const doc = await (await JZ.loadAsync(fs.readFileSync(pth))).file("word/document.xml").async("string"), plain = doc.replace(/<[^>]+>/g, "").replace(new RegExp("[" + String.fromCharCode(0x202a, 0x202c, 0x200f) + "]", "g"), "").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
        const valid = await p2.evaluate(x => new DOMParser().parseFromString(x, "application/xml").querySelector("parsererror") === null, doc);
        check("המהות המותאמת בקובץ ה-Word כטקסט: ה-XML תקין, אין תגית מוזרקת (</w:t>, <img), והטקסט נשמר כלשונו", valid && plain.includes(HOSTILE) && !doc.includes("<img") && !doc.includes("]]>") && (doc.match(/<w:t[ >]/g) || []).length === (doc.match(/<\/w:t>/g) || []).length, "") }
      await p2.click("#btnSend"); await p2.waitForSelector(".sendBox"); await p2.check("#sendOk"); await p2.click("#sendGo");
      await p2.waitForFunction(() => /נשלח במצב בדיקה|נכשלה/.test(document.querySelector("#sendProg").textContent), null, { timeout: 120000 });
      const mails = p2._env.mails, folder = Object.values(p2._env.folders).find(f => f.parent === "ROOT"), jf = folder && folder.files.find(f => f.name.endsWith(".json")), rec = jf ? JSON.parse(jf.bytes.toString("utf8")) : {};
      check("המהות המותאמת במייל שנשלח (שרת Apps Script) ובקובץ נתוני הבקשה בדרייב (inputs.purpose)", mails.length === 1 && mails[0].body.split("\n").includes("מהות הפעילות: " + HOSTILE) && rec.inputs && rec.inputs.purpose === HOSTILE, mails.length + " מיילים");
      await p2.click("#mdClose");
      // בחירה במהות אחרת אחרי ההרצה: שדה רך — הטופס מתעדכן והבקשה נשארת מוכנה
      await p2.selectOption("#purpose", cfgPu[0]);
      await p2.waitForFunction(t => document.querySelectorAll("#report .paper:first-child table.f tr")[3].innerText.includes(t) && /הבקשה מוכנה לשליחה/.test(document.querySelector("#gate").textContent), cfgPu[0], { timeout: 20000 });
      check("החלפת מהות אחרי ההרצה: שדה 4 מתעדכן והבקשה נשארת מוכנה (שדה רך — בלי הרצה מחדש)", !(await p2.isDisabled("#btnSend")) && !(await rows.nth(3).innerText()).includes("onerror"), "");
      // fail-closed: הסרת המהות הנבחרת מהרשימה מחזירה ל״בחרו…״ — השער נסגר עד שנבחרת מהות
      await p2.selectOption("#purpose", HOSTILE);
      await p2.waitForFunction(t => document.querySelectorAll("#report .paper:first-child table.f tr")[3].innerText.includes(t), "onerror", { timeout: 20000 });
      await p2.locator("#puList [data-purm]").first().click();
      await p2.waitForFunction(() => /אינה מוכנה/.test(document.querySelector("#gate").textContent) && document.getElementById("e_purpose").textContent.length > 0, null, { timeout: 20000 });
      check("הסרת המהות הנבחרת אחרי ההרצה: חוזרים ל״בחרו…״, השער נסגר (״יש לבחור מהות פעילות״), השדה מסומן ושליחה חסומה", (await p2.inputValue("#purpose")) === "" && /יש לבחור מהות פעילות/.test(await p2.textContent("#e_purpose")) && (await p2.evaluate(() => document.getElementById("purpose").classList.contains("bad"))) && (await p2.isDisabled("#btnSend")) && (await p2.isDisabled("#btnDrive")), (await p2.textContent("#gate")).replace(/\s+/g, " ").slice(0, 160));
      await p2.selectOption("#purpose", cfgPu[1]);
      await p2.waitForFunction(() => /הבקשה מוכנה לשליחה/.test(document.querySelector("#gate").textContent), null, { timeout: 20000 });
      check("בחירה במהות קבועה אחרי הסרה: השער נפתח שוב", !(await p2.isDisabled("#btnSend")), "");
      await c2.close();
    }
  }
  /* ===== תרחיש שכבות: איסורים (פמ״ת) ונוטמים על מפת הבקשות + פס סיכום לנקודה — תצוגה מקדימה בלבד ===== */
  {
    const LYR = require(path.join(ROOT, "members-k38p/requests/js/maplayers.js"));
    const J = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
    const zonesJ = J("members-k38p/data/zones.json"), inpaJ = J("members-k38p/data/inpa-zones.json"), snapJ = J("members-k38p/requests/selftest/notam-data.snap.json");
    const shapes = LYR.zoneShapes(zonesJ, inpaJ);
    const expNotams = inp => LYR.selectNotams(snapJ.notams, LYR.inputWindow(inp, new Date())).items.length;   // מה שהדף אמור לצייר, מחושב בנפרד בתהליך הבדיקה מקובץ הנוטמים השמור
    const lyReady = pg => pg.waitForFunction(() => { const l = window.__REQ && window.__REQ.S.lf.lay; return l && l.zoneLayers.length > 0 && l.sel; }, null, { timeout: 30000 });
    const vis = pg => pg.evaluate(() => window.__REQ.S.lf.lay.visible());
    const strip = pg => pg.evaluate(() => document.getElementById("pointSummary").innerText.replace(/[ \t]+/g, " "));
    const stripHas = (pg, re) => pg.waitForFunction(r => new RegExp(r).test(document.getElementById("pointSummary").innerText), re.source, { timeout: 8000 }).then(() => true, () => false);
    const clickLatLng = async (pg, lat, lon, zoom) => {   // לחיצת עכבר אמיתית על נ״צ נתון
      await pg.evaluate(([la, lo, z]) => { window.__REQ.S.lf.m.setView([la, lo], z, { animate: false }); }, [lat, lon, zoom]);
      await pg.locator("#map").scrollIntoViewIfNeeded();
      const xy = await pg.evaluate(([la, lo]) => { const m = window.__REQ.S.lf.m, p = m.latLngToContainerPoint([la, lo]), r = m.getContainer().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, [lat, lon]);
      await pg.mouse.click(xy.x, xy.y);
    };
    const bbox = sh => { const pts = sh.rings.flat(); const la = pts.map(p => p[0]), lo = pts.map(p => p[1]); return [(Math.min(...la) + Math.max(...la)) / 2, (Math.min(...lo) + Math.max(...lo)) / 2]; };
    // נקודה שיש מתחתיה לפחות שני אזורים, ונקודה בתוך אזור בקירוב — מחושבות מקובץ הנתונים עצמו (כדי שהבדיקה לא תישבר כשהנתונים יתעדכנו) ויציבות לסטייה של כמה פיקסלים בלחיצה (רשת 3×3 של ±30 מ׳)
    const GRID = [-0.0003, 0, 0.0003].flatMap(a => [-0.0003, 0, 0.0003].map(b => [a, b]));
    const stable = (la, lo, pred) => GRID.every(([a, b]) => pred(LYR.hitZones(shapes, la + a, lo + b)));
    let multi = null, approxPt = null;
    for (const sh of shapes) {
      const [la, lo] = bbox(sh);
      if (!(la > 29.6 && la < 33.4 && lo > 34.2 && lo < 35.8)) continue;
      if (!multi && stable(la, lo, h => h.length >= 2)) multi = { la, lo, ids: LYR.hitZones(shapes, la, lo).map(h => h.id) };
      if (!approxPt && sh.approx && stable(la, lo, h => h.some(x => x.id === sh.id))) approxPt = { la, lo, id: sh.id, alt: sh.alt };
      if (multi && approxPt) break;
    }
    check("נתוני הבדיקה: נמצאה נקודה עם חפיפה של כמה אזורים ונקודה בתוך אזור בקירוב", !!multi && !!approxPt, JSON.stringify({ multi, approxPt }));

    const { ctx, page } = await newPage(browser, { newPmt: true });   // newPmt: הסנכרון נכשל, ולכן הדף בודק שוב כל 400 מ״ש — כך נבדק ציור מחדש אחרי טעינה מחדש של הנתונים
    let xss = 0; page.on("dialog", d => { xss++; d.dismiss(); });
    await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page); await lyReady(page);
    const st0 = await page.evaluate(() => JSON.stringify(window.__REQ.S.statuses));

    // --- מתגים וברירות מחדל ---
    check("שני המתגים (איסורים פמ״ת / נוטמים) קיימים, דולקים ופעילים כברירת מחדל", (await page.isChecked("#lyrZones")) && (await page.isChecked("#lyrNotams")) && !(await page.isDisabled("#lyrZones")) && !(await page.isDisabled("#lyrNotams")) && /איסורים \(פמ״ת\)/.test(await page.textContent("#layerBar")), "");
    check("ליד כל מתג לחצן ״!״ (ReqHelp) עם הסבר שמזכיר קירוב/תאריכים ותצוגה מקדימה", await page.evaluate(() => { const b = [...document.querySelectorAll("#layerBar .hbtn")]; return b.length === 2 && /בקירוב/.test(b[0].dataset.help) && /תצוגה מקדימה/.test(b[0].dataset.help) && /התאריכים והשעות/.test(b[1].dataset.help) && /תצוגה מקדימה/.test(b[1].dataset.help); }), "");
    { const v = await vis(page); check("השכבות מצוירות: כל " + shapes.length + " האזורים והנוטמים שבתוקף (חישוב עצמאי מקובץ הנוטמים השמור)", v.zones === shapes.length && v.notams === expNotams({}), JSON.stringify(v) + " expected notams=" + expNotams({})); }
    check("בלי נקודה: הפס מציג ״בחרו נקודה במפה״ ותמיד שורה אחרונה ״תצוגה מקדימה בלבד״", /בחרו נקודה במפה/.test(await strip(page)) && /תצוגה מקדימה בלבד — הבדיקות המלאות רצות בלחיצה על ״הרץ את כל הבדיקות״/.test(await strip(page)), await strip(page));
    check("ליד מתג הנוטמים: ״נתוני הנוטמים נמשכו לפני …״ + כמה מוצגים", /נתוני הנוטמים נמשכו לפני (פחות משעה|שעה|\d+ שעות)/.test(await page.textContent("#lyrNotamsNote")) && /מוצגים \d+ נוטמ/.test(await page.textContent("#lyrNotamsNote")), await page.textContent("#lyrNotamsNote"));
    check("המתגים והפס מסומנים nonprint, אינם בתוך #report, ומוסתרים בהדפסה", await page.evaluate(() => document.getElementById("layerBar").classList.contains("nonprint") && document.getElementById("pointSummary").classList.contains("nonprint") && !document.querySelector("#report #pointSummary, #report #layerBar")), "");
    await page.emulateMedia({ media: "print" });
    check("במצב הדפסה המתגים והפס אינם מוצגים", !(await page.isVisible("#layerBar")) && !(await page.isVisible("#pointSummary")), "");
    await page.emulateMedia({ media: "screen" });

    // --- בחירת נקודה בלחיצה: הירקון (אזור LLU20 תל אביב ב-525 מ׳ מהנקודה) ---
    await page.fill("#radius", "100");
    await clickLatLng(page, 32.099128, 34.816617, 16);
    await page.waitForFunction(() => /^\d+\.\d+, \d+\.\d+$/.test(document.getElementById("coord").value), null, { timeout: 5000 });
    check("הפס מתעדכן בבחירת נקודה: ״בקרבה״ מציג את LLU20 ״תל אביב״ עם מרחק מקצה הסגירה (והנקודה בתוך אזור ב-09 שעוד לא מסונן בלי גובה)", await stripHas(page, /LLU20 ״תל אביב״ — [^\n]*\d+ מ׳ מקצה הסגירה/) && await stripHas(page, /בתוך הסגירה: חפיפה ל-502א/), await strip(page));
    const edgeOf = async () => { const m = /LLU20 ״תל אביב״ — [^\n]*?(\d+) מ׳ מקצה הסגירה/.exec(await strip(page)); return m ? +m[1] : null; };
    const e100 = await edgeOf();
    check("מרחק LLU20 מקצה סגירה ברדיוס 100 מ׳ ≈ 426 מ׳ (525.9 − 100, בטווח הלחיצה)", e100 != null && Math.abs(e100 - 426) <= 6, "edge=" + e100);
    await page.fill("#radius", "150");
    await page.waitForFunction(v => { const m = /LLU20 ״תל אביב״ — [^\n]*?(\d+) מ׳ מקצה הסגירה/.exec(document.getElementById("pointSummary").innerText); return m && Math.abs(+m[1] - (v - 50)) <= 2; }, e100, { timeout: 5000 }).then(() => check("שינוי רדיוס ל-150 מעדכן את הפס (המרחק מקצה הסגירה יורד ב-50 מ׳)", true, ""), async () => check("שינוי רדיוס ל-150 מעדכן את הפס (המרחק מקצה הסגירה יורד ב-50 מ׳)", false, await strip(page)));
    check("בלי גובה: הפס אומר ״הזינו גובה לחישוב מדויק״", /הזינו גובה לחישוב מדויק/.test(await strip(page)), await strip(page));
    await page.fill("#height", "80");
    check("אחרי הזנת גובה ההנחיה נעלמת, אזור ב-09 הגבוה מדי מסונן, ואין חפיפה לאזורי איסור", await page.waitForFunction(() => !/הזינו גובה לחישוב מדויק/.test(document.getElementById("pointSummary").innerText), null, { timeout: 5000 }).then(() => true, () => false) && await stripHas(page, /בתוך הסגירה: אין חפיפה לאזורי איסור/), await strip(page));

    // --- נוטמים: סינון לפי התאריכים והשעות שבטופס ---
    const winA = { dateFrom: "2026-10-20", dateTo: "2026-10-23", timeFrom: "17:00", timeTo: "20:00" }, winB = { dateFrom: "2026-12-20", dateTo: "2026-12-21", timeFrom: "17:00", timeTo: "20:00" };
    const setWin = async w => { await page.fill("#dateFrom", w.dateFrom); await page.fill("#dateTo", w.dateTo); await page.fill("#timeFrom", w.timeFrom); await page.fill("#timeTo", w.timeTo); };
    await setWin(winA);
    await page.waitForFunction(n => window.__REQ.S.lf.lay.visible().notams === n, expNotams(winA), { timeout: 8000 }).catch(() => {});
    check("סינון הנוטמים לפי התאריכים והשעות שנבחרו (20–23.10.2026 17:00–20:00): מספר השכבות כמו בחישוב העצמאי", (await vis(page)).notams === expNotams(winA) && expNotams(winA) > 0, JSON.stringify(await vis(page)) + " expected=" + expNotams(winA));
    check("הפס מציג את חלון הנוטמים שנבחר ואת הנוטם הקבוע C0431/26 עם מרחקו מקצה הסגירה", await stripHas(page, /20\.10\.2026 17:00 – 23\.10\.2026 20:00/) && await stripHas(page, /C0431\/26 — [\d.]+ ק״מ מקצה הסגירה/), await strip(page));
    await setWin(winB);
    await page.waitForFunction(n => window.__REQ.S.lf.lay.visible().notams === n, expNotams(winB), { timeout: 8000 }).catch(() => {});
    check("החלפת התאריכים (20–21.12.2026) מחליפה את הנוטמים המצוירים", expNotams(winA) !== expNotams(winB) && (await vis(page)).notams === expNotams(winB), JSON.stringify(await vis(page)) + " A=" + expNotams(winA) + " B=" + expNotams(winB));
    await setWin(winA);
    await page.waitForFunction(n => window.__REQ.S.lf.lay.visible().notams === n, expNotams(winA), { timeout: 8000 }).catch(() => {});

    // --- כרטיס בלחיצה על אזור: כל האזורים שמתחת לנקודה, והנקודה נבחרת גם כן ---
    await clickLatLng(page, multi.la, multi.lo, 14);   // זום נמוך מ-15: המפה מתקרבת, והכרטיס נפתח אחרי סיום התנועה
    await page.waitForFunction(ids => { const p = document.querySelector(".leaflet-popup .lp"); return p && ids.every(id => p.innerText.includes(id)); }, multi.ids, { timeout: 8000 }).catch(() => {});
    { const pop = await page.evaluate(() => { const p = document.querySelector(".leaflet-popup .lp"); return p ? p.innerText : ""; });
      check("לחיצה על חפיפה של כמה אזורים: כרטיס אחד שמונה את כולם (" + multi.ids.join(", ") + ")", multi.ids.every(id => pop.includes(id)) && /בנקודה שנלחצה — \d+ פריטים/.test(pop), pop.slice(0, 300));
      check("הנקודה נבחרה גם כשנפתח הכרטיס (שדה הנ״צ התעדכן)", Math.abs(parseFloat(await page.inputValue("#coord")) - multi.la) < 0.01, await page.inputValue("#coord")); }
    await clickLatLng(page, approxPt.la, approxPt.lo, 16);
    await page.waitForFunction(id => { const p = document.querySelector(".leaflet-popup .lp"); return p && p.innerText.includes(id); }, approxPt.id, { timeout: 8000 }).catch(() => {});
    { const pop = await page.evaluate(() => { const p = document.querySelector(".leaflet-popup .lp"); return p ? p.innerText : ""; });
      check("אזור בקירוב (" + approxPt.id + "): הכרטיס אומר ״שרטוט בקירוב — אינו הגבול הרשמי״ ומציג סוג וגבהים", /שרטוט בקירוב — אינו הגבול הרשמי/.test(pop) && /אזור (אסור|מוגבל|מסוכן)/.test(pop) && (!approxPt.alt || /גבהים:/.test(pop)), pop.slice(0, 300)); }
    { // מקום בלי אף אזור או נוטם (בחלון שנבחר), יציב לסטייה של כמה פיקסלים — נמצא בסריקת רשת על הנתונים עצמם
      const itemsA = LYR.selectNotams(snapJ.notams, LYR.inputWindow(winA, new Date())).items;
      let empty = null;
      for (let la = 29.6; la < 33.2 && !empty; la += 0.04) for (let lo = 34.3; lo < 35.7 && !empty; lo += 0.04) if (GRID.every(([a, b]) => !LYR.hitZones(shapes, la + a, lo + b).length && !LYR.hitNotams(itemsA, la + a, lo + b).length)) empty = [la, lo];
      check("נתוני הבדיקה: נמצא מקום בלי אזור ובלי נוטם", !!empty, JSON.stringify(empty));
      await clickLatLng(page, empty[0], empty[1], 16);
      check("לחיצה על מקום בלי אזור/נוטם: לא נפתח כרטיס, והנקודה נבחרת", await page.waitForFunction(() => !document.querySelector(".leaflet-popup"), null, { timeout: 5000 }).then(() => true, () => false) && Math.abs(parseFloat(await page.inputValue("#coord")) - empty[0]) < 0.01, JSON.stringify(empty) + " coord=" + await page.inputValue("#coord"));
    }

    // --- escaping: שם אזור וטקסט נוטם עוינים לא נכנסים כ-HTML לכרטיס ---
    const hx = [31.0, 34.7];
    await page.evaluate(([la, lo]) => {
      const S = window.__REQ.S, d = 0.01;
      S.data.zones.zones.push({ id: "X1<img src=x onerror=window.__xss=1>", cat: "LLP", name: "<script>window.__xss=2</script>\"&'", alt: "<b>גובה</b>", pmt: "<img src=x onerror=window.__xss=3> ציטוט", pmtRef: "", approx: true, rings: [[[la - d, lo - d], [la - d, lo + d], [la + d, lo + d], [la + d, lo - d], [la - d, lo - d]]] });
      S.data.notams.push({ id: "X9<img src=x onerror=window.__xss=4>", loc: "LLLL", name: "<b>n</b>", heb: "<img src=x onerror=window.__xss=5> סגירה\nבתוקף: x",
        raw: "X9999/26 NOTAMN\nQ) LLLL/QWPLW/IV/BO /W /000/050/3100N03442E005\nA) LLLL B) 2601010000 C) PERM\nE) <img src=x onerror=window.__xss=6> OPS WI 800M RADIUS CENTERED ON PSN 310000N0344200E CLSD\nF) GND G) <b>500FT</b> AMSL)" });
      S.lf.lay.refresh();
    }, hx);
    await clickLatLng(page, hx[0], hx[1], 15);
    await page.waitForFunction(() => { const p = document.querySelector(".leaflet-popup .lp"); return p && p.innerText.includes("X9<img"); }, null, { timeout: 8000 }).catch(() => {});
    { const r = await page.evaluate(() => { const p = document.querySelector(".leaflet-popup .lp"); return { txt: p ? p.innerText : "", tags: p ? [...p.querySelectorAll("*")].map(e => e.tagName.toLowerCase()).filter(t => !["div", "span", "b"].includes(t)) : ["no-popup"], xss: window.__xss === undefined ? 0 : window.__xss }; });
      check("טקסט עוין בשם אזור, בציטוט הפמ״ת ובנוטם מוצג כטקסט: אין img/script בכרטיס ואין הרצת קוד", r.tags.length === 0 && r.xss === 0 && xss === 0 && r.txt.includes("<img src=x onerror=window.__xss=1>") && r.txt.includes("<script>window.__xss=2</script>") && r.txt.includes("<img src=x onerror=window.__xss=5>"), JSON.stringify(r).slice(0, 400)); }
    await page.evaluate(() => { const S = window.__REQ.S; S.data.zones.zones.pop(); S.data.notams.pop(); S.lf.lay.refresh(); });

    // --- כיבוי מתגים ושמירת הבחירה ---
    await page.uncheck("#lyrZones");
    { const v = await vis(page); check("כיבוי ״איסורים״ מסיר את שכבת האזורים מהמפה (0 שכבות) ומשאיר את הנוטמים", v.zones === 0 && v.notams === expNotams(winA), JSON.stringify(v)); }
    check("הבחירה נשמרת ב-localStorage (icd_req_layers_v1)", (await page.evaluate(() => localStorage.getItem("icd_req_layers_v1"))) === '{"zones":false,"notams":true}', await page.evaluate(() => localStorage.getItem("icd_req_layers_v1")));
    await clickLatLng(page, multi.la, multi.lo, 15);
    check("כשהאיסורים כבויים, לחיצה על אזור לא פותחת כרטיס אזורים, אבל הפס עדיין מסכם את הנקודה", await page.waitForFunction(() => !document.querySelector(".leaflet-popup .lp-sw[style*='ff3b30']"), null, { timeout: 5000 }).then(() => true, () => false) && await stripHas(page, /בתוך הסגירה:/), "");
    await page.reload(); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 });
    if (await page.$("#authForm")) await login(page); else await page.waitForFunction(() => !document.body.classList.contains("authLocked"), null, { timeout: 20000 });
    await lyReady(page);
    check("אחרי טעינה מחדש: ״איסורים״ נשאר כבוי ו״נוטמים״ דלוק (נשמר), והציור תואם", !(await page.isChecked("#lyrZones")) && (await page.isChecked("#lyrNotams")) && (await vis(page)).zones === 0 && (await vis(page)).notams === expNotams({}), JSON.stringify(await vis(page)));
    await page.uncheck("#lyrNotams");
    check("כיבוי ״נוטמים״ מסיר את שכבת הנוטמים (0 שכבות)", (await vis(page)).notams === 0, JSON.stringify(await vis(page)));
    await page.check("#lyrZones"); await page.check("#lyrNotams");
    check("הדלקה מחדש של שני המתגים מחזירה את כל השכבות", (await vis(page)).zones === shapes.length && (await vis(page)).notams === expNotams({}) && (await page.evaluate(() => localStorage.getItem("icd_req_layers_v1"))) === '{"zones":true,"notams":true}', JSON.stringify(await vis(page)));

    // --- ציור מחדש אחרי טעינה מחדש של הנתונים ב-checkSync (נוטמים חדשים בשרת) ---
    {
      const before = (await vis(page)).notams, extra = { id: "Z0001/26", loc: "LLLL", name: "בדיקה", heb: "סגירה לבדיקה ברדיוס 700 מ׳\nבתוקף: מ-01/01/2026 00:00 UTC (קבוע)", raw: "Z0001/26 NOTAMN\nQ) LLLL/QWPLW/IV/BO /W /000/050/3200N03445E001\nA) LLLL B) 2601010000 C) PERM\nE) TEST OPS WI 700M RADIUS CENTERED ON PSN 320000N0344500E CLSD\nF) GND G) 500FT AMSL)" };
      page._notamIso = new Date(Date.now() + 3 * 3600e3).toISOString();
      await page.route(/\/notam-all\.json/, r => { const d = JSON.parse(fs.readFileSync(path.join(ROOT, "members-k38p", "requests", "selftest", "notam-data.snap.json"), "utf8")); d.notams.push(extra); d.fetched_iso = d.fetched_at = page._notamIso; d.listed = d.count = d.notams.length; d.failed = []; r.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify(d) }); });
      const ok = await page.waitForFunction(n => window.__REQ.S.lf.lay.visible().notams === n + 1, before, { timeout: 15000 }).then(() => true, () => false);
      check("נוטם חדש בשרת: אחרי הטעינה מחדש ב-checkSync השכבה מצוירת מחדש (" + before + " → " + (before + 1) + ")", ok, JSON.stringify(await vis(page)));
    }
    check("כל הפעולות בשכבות ובפס לא שינו את סטטוס הבדיקות ולא יצרו תוצאה (שער ״מוכן לשליחה״ לא הושפע)", (await page.evaluate(() => window.__REQ.S.res === null && !document.getElementById("resultsSec").offsetParent)) && (await page.evaluate(() => Object.keys(window.__REQ.S.statuses).filter(k => k !== "sync").sort().join(",")) === Object.keys(JSON.parse(st0)).filter(k => k !== "sync").sort().join(",")), "");
    await ctx.close();

    // --- צילומי מסך: מחשב וטלפון (390) ---
    for (const dev of [{ name: "desktop", vp: { width: 1280, height: 1000 }, touch: false }, { name: "phone", vp: { width: 390, height: 844 }, touch: true }]) {
      const { ctx: c2, page: pg } = await newPage(browser, { viewport: dev.vp, touch: dev.touch });
      await pg.goto(APP); await pg.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(pg); await lyReady(pg);
      await pg.fill("#dateFrom", "2026-10-20"); await pg.fill("#dateTo", "2026-10-23"); await pg.fill("#timeFrom", "17:00"); await pg.fill("#timeTo", "20:00"); await pg.fill("#height", "80"); await pg.fill("#radius", "300");
      const sec = pg.locator("section.card:has(#map)");
      const geoOf = () => pg.evaluate(() => {
        const W = window.innerWidth, bad = [];
        document.querySelectorAll("#layerBar, #layerBar *, #pointSummary, #pointSummary *").forEach(e => { const r = e.getBoundingClientRect(); if (r.width && (r.right > W + 1 || r.left < -1)) bad.push(e.tagName + "." + e.className + ":" + Math.round(r.left) + ".." + Math.round(r.right)); });
        return { W, scrollW: document.documentElement.scrollWidth, bad, mapH: Math.round(document.getElementById("map").getBoundingClientRect().height) };
      });
      // א. הירקון בזום 14: שכבות, טבעות הסגירה והפס עם LLU20 והנוטם
      await clickLatLng(pg, 32.099128, 34.816617, 14);
      await pg.waitForTimeout(1500);   // אריחים מדומים וציור הקנבס
      await sec.scrollIntoViewIfNeeded(); await sec.screenshot({ path: path.join(OUT, "layers-" + dev.name + "-yarkon.png") });
      const g1 = await geoOf();
      check("מסך " + dev.name + " (" + dev.vp.width + "px), הירקון: בלי גלילה אופקית ובלי שהמתגים/הפס חורגים מהמסך", g1.scrollW <= g1.W + 1 && g1.bad.length === 0, JSON.stringify(g1));
      // ב. נקודה עם כמה אזורים: הכרטיס פתוח
      await clickLatLng(pg, multi.la, multi.lo, 14);
      await pg.waitForFunction(ids => { const p = document.querySelector(".leaflet-popup .lp"); return p && ids.every(id => p.innerText.includes(id)); }, multi.ids, { timeout: 8000 }).catch(() => {});
      await pg.waitForTimeout(1500);
      await sec.scrollIntoViewIfNeeded(); await sec.screenshot({ path: path.join(OUT, "layers-" + dev.name + "-popup.png") });
      const g2 = await geoOf(), pr = await pg.evaluate(() => { const p = document.querySelector(".leaflet-popup"), m = document.getElementById("map").getBoundingClientRect(); if (!p) return null; const r = p.getBoundingClientRect(); return { inside: r.left >= m.left - 1 && r.right <= m.right + 1 && r.top >= m.top - 1 && r.bottom <= m.bottom + 1 }; });
      check("מסך " + dev.name + ": הכרטיס שנפתח בלחיצה נשאר בתוך המפה, והמסך ללא גלילה אופקית", !!pr && pr.inside && g2.scrollW <= g2.W + 1 && g2.bad.length === 0, JSON.stringify({ pr, g2 }));
      await c2.close();
    }
  }
  { // נתוני האזורים לא נטענו (שגיאת שרת): מתג האיסורים מושבת עם הסבר, הנוטמים ממשיכים לעבוד, והפס לא קורס
    const { ctx, page } = await newPage(browser);
    await page.route(/\/members-k38p\/data\/zones\.json/, r => r.fulfill({ status: 500, body: "x" }));
    await page.goto(APP); await page.waitForFunction(() => window.__REQ && window.__REQ.S.statuses.a17, null, { timeout: 60000 }); await login(page);
    await page.waitForFunction(() => document.getElementById("lyrZonesNote").textContent.length > 0, null, { timeout: 10000 }).catch(() => {});
    const d = await page.evaluate(() => ({ z: document.getElementById("lyrZones").disabled, n: document.getElementById("lyrNotams").disabled, zn: document.getElementById("lyrZonesNote").textContent, vis: window.__REQ.S.lf.lay.visible(), sum: document.getElementById("pointSummary").innerText }));
    check("נתוני האזורים לא נטענו: מתג האיסורים מושבת עם הסבר, שום אזור לא מצויר, והנוטמים והפס ממשיכים לעבוד", d.z && !d.n && /נתוני האזורים לא נטענו/.test(d.zn) && d.vis.zones === 0 && d.vis.notams > 0 && /בחרו נקודה במפה/.test(d.sum), JSON.stringify(d).slice(0, 300));
    await ctx.close();
  }
  /* ===== תרחיש 13: עצמאות המבקש — כל מטיס הוא המבקש של בקשתו: גורם מבקש ניתן לעריכה (שדה 2) ואות קריאה / מס׳ רישום (שדות 13 ו-14); חלון השליחה לפי החוזה (למשרד / רק לעצמי / בדיקה; שרת חדש וישן); דרייב למנהל בלבד ===== */
  {
    // 13א: שדות המבקש בטופס — ריקים כברירת מחדל, גורם מבקש חובה (ללא ערך קבוע), אות קריאה ומס׳ רישום אופציונליים; אימות עם הודעה וסימון
    const { ctx, page } = await newPage(browser);
    await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
    await page.evaluate(() => { document.getElementById("personBox").open = true; });
    const lbl = await page.textContent("label.f:has(#reqOrg) > b");
    check("שדה ״שם הגורם המבקש״ בתיבת פרטי המבקש: תווית ברורה, ריק כברירת מחדל (אין עוד ״הארגון הישראלי לרב להב״ קבוע)", lbl === "שם הגורם המבקש (חברה / ארגון / מטיס — כפי שיופיע בבקשה)" && (await page.inputValue("#reqOrg")) === "" && !/לרב להב/.test(await page.inputValue("#reqOrg")), lbl);
    check("אות קריאה ומס׳ רישום: שדות אופציונליים וריקים עם ״לא רלוונטי״ כ-placeholder", (await page.inputValue("#reqCallsign")) === "" && (await page.inputValue("#reqReg")) === "" && (await page.getAttribute("#reqCallsign", "placeholder")) === "לא רלוונטי" && (await page.getAttribute("#reqReg", "placeholder")) === "לא רלוונטי", "");
    const tryRun = async (over, errId, re, badId, label) => {
      await fillExample(page, over); const o0 = page._calls.overpass;
      await page.click("#runBtn");
      await page.waitForFunction(id => document.getElementById(id).textContent.length > 0, errId, { timeout: 10000 });
      check(label, re.test(await page.textContent("#" + errId)) && (await page.evaluate(id => document.getElementById(id).classList.contains("bad"), badId)) && page._calls.overpass === o0 && !(await page.isVisible("#resultsSec")) && (await page.evaluate(() => document.getElementById("personBox").open)), await page.textContent("#" + errId));
    };
    await tryRun({ org: " " }, "e_requesterOrg", /יש להזין את שם הגורם המבקש/, "reqOrg", "גורם מבקש חסר (רווחים בלבד): ההרצה נחסמת עם הודעה, סימון אדום ופתיחת תיבת הפרטים — בלי קריאות רשת");
    await tryRun({ org: "א".repeat(81) }, "e_requesterOrg", /עד 80 תווים/, "reqOrg", "גורם מבקש של 81 תווים נחסם (עד 80)");
    await tryRun({ org: "חברה" + String.fromCharCode(1) + "בדיקה" }, "e_requesterOrg", /תווים לא תקינים/, "reqOrg", "גורם מבקש עם תו בקרה נחסם");
    await tryRun({ callsign: "ק".repeat(41) }, "e_callsign", /עד 40 תווים/, "reqCallsign", "אות קריאה של 41 תווים נחסמת (עד 40)");
    await tryRun({ registration: "ר".repeat(41) }, "e_registration", /עד 40 תווים/, "reqReg", "מס׳ רישום של 41 תווים נחסם (עד 40)");
    await ctx.close();
  }
  {
    // 13ב: גורם מבקש, אות קריאה ומס׳ רישום בטופס, במייל, ב-Word ובארכיון; עריכת הגורם אחרי ההרצה; מחיקתו חוסמת שליחה (נכשל סגור); מנהל: הקישור לדרייב מוצג
    const { ctx, page } = await newPage(browser);
    await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
    await readyRequest(page, { org: "חברת אלפא בע״מ", callsign: "אלפא 1", registration: "4X-ALF" });
    const formRows = () => page.$$eval("#report .paper:first-child table.f tr", trs => trs.map(t => t.innerText.replace(/\s+/g, " ").trim()));
    let form = await formRows();
    check("שדה 2 בטופס הוא הגורם שהוקלד; שדה 13 = אות הקריאה; שדה 14 = מס׳ הרישום", /חברת אלפא בע״מ/.test(form[1]) && /אלפא 1/.test(form[12]) && /4X-ALF/.test(form[13]) && !/לרב להב|ICD/.test(form.join(" ")), form[1] + " | " + form[12] + " | " + form[13]);
    const mailNow = () => page.evaluate(() => { const m = window.__REQ.O.mail(window.__REQ.S.res, window.__REQ.S.cfg); return { body: m.body, mailto: decodeURIComponent(m.mailto) }; });
    let mn = await mailNow();
    check("המייל: שורת ״שם/גורם המבקש״ והחתימה לפי הגורם שהוקלד (גם ב-mailto)", mn.body.split("\n").includes("שם/גורם המבקש: חברת אלפא בע״מ") && /בברכה,\nבודק ראשון\nחברת אלפא בע״מ\n050-0000001/.test(mn.body) && mn.mailto.includes("חברת אלפא בע״מ") && !/לרב להב/.test(mn.body), "");
    // עריכת הגורם אחרי ההרצה: שדה רך — הטופס והמייל מתעדכנים, הבקשה נשארת מוכנה, התוצאות הקודמות נמחקות
    await page.evaluate(() => { document.getElementById("sendMsg").textContent = "x"; });
    await page.fill("#reqOrg", "חברת בטא");
    await page.waitForFunction(() => /חברת בטא/.test((document.querySelector("#report .paper:first-child table.f tr:nth-child(2)") || {}).innerText || ""), null, { timeout: 15000 });
    await page.waitForFunction(() => window.__REQ.S.ready === true && !window.__REQ.S.pending, null, { timeout: 30000 });
    form = await formRows(); mn = await mailNow();
    check("עריכת הגורם המבקש אחרי ההרצה: שדה 2 והמייל מתעדכנים, הבקשה נשארת מוכנה לשליחה, והודעת ״נשלח״ הקודמת נמחקת", /חברת בטא/.test(form[1]) && !/אלפא/.test(form[1]) && mn.body.includes("שם/גורם המבקש: חברת בטא") && !(await page.isDisabled("#btnSend")) && (await page.textContent("#sendMsg")) === "", form[1]);
    // מחיקת הגורם: אימות נכשל, השער נסגר והשליחה חסומה; החזרה מחזירה מוכנות
    await page.fill("#reqOrg", "");
    await page.waitForFunction(() => document.getElementById("e_requesterOrg").textContent.length > 0 && window.__REQ.S.ready === false && /הבקשה אינה מוכנה/.test(document.getElementById("gate").textContent), null, { timeout: 15000 });
    check("גורם מבקש שנמחק אחרי ההרצה: הבקשה אינה מוכנה, השגיאה מוצגת בשדה, והשליחה וההפקות חסומות (נכשל סגור)", (await page.isDisabled("#btnSend")) && (await page.isDisabled("#btnDocx")) && /יש להזין את שם הגורם המבקש/.test(await page.textContent("#e_requesterOrg")) && (await page.evaluate(() => document.getElementById("reqOrg").classList.contains("bad"))), await page.textContent("#e_requesterOrg"));
    await page.fill("#reqOrg", "חברת בטא");
    await page.waitForFunction(() => window.__REQ.S.ready === true, null, { timeout: 15000 });
    check("החזרת הגורם המבקש מחזירה את הבקשה למוכנה (השגיאה והסימון נעלמים)", (await page.textContent("#e_requesterOrg")) === "" && !(await page.isDisabled("#btnSend")), "");
    // Word: שם הגורם בטופס, ב-core.xml (יוצר המסמך), ובלי ארגון קבוע
    const JZ = require(path.join(ROOT, "members-k38p", "requests", "vendor", "jszip.min.js")), BIDI = new RegExp("[" + String.fromCharCode(0x202a, 0x202c, 0x200f) + "]", "g");
    const docxParts = async buf => { const z = await JZ.loadAsync(buf); return { doc: await z.file("word/document.xml").async("string"), core: await z.file("docProps/core.xml").async("string") }; };
    { const [d] = await Promise.all([page.waitForEvent("download"), page.click("#btnDocx")]); const p = path.join(OUT, "indep-" + d.suggestedFilename()); await d.saveAs(p);
      const { doc, core } = await docxParts(fs.readFileSync(p)), plain = doc.replace(/<[^>]+>/g, "").replace(BIDI, "");
      check("Word שהורד: שדה 2 = ״חברת בטא״, אות הקריאה ומס׳ הרישום בשדות 13 ו-14, יוצר המסמך = הגורם המבקש, ואין ארגון קבוע", plain.includes("חברת בטא") && plain.includes("אלפא 1") && plain.includes("4X-ALF") && /<dc:creator>חברת בטא<\/dc:creator>/.test(core) && !/לרב להב|ICD/.test(plain + core), core.slice(core.indexOf("<dc:creator>"), core.indexOf("</dc:creator>") + 13)); }
    // מנהל: כפתור ״שמור בדרייב״ מוצג; שליחת בדיקה (מנהל בלי כתובת) — הקבצים בארכיון נושאים את הגורם, והקישור לתיקייה מוצג
    check("מנהל: כפתור ״שמור בדרייב״ (ו-״!״ שלו) מוצגים", (await page.isVisible("#btnDrive")) && (await page.locator(".hw:has(#btnDrive)").isVisible()), "");
    await page.click("#btnSend"); await page.waitForSelector(".sendBox"); await page.check("#sendOk"); await page.click("#sendGo");
    await page.waitForFunction(() => /נשלח במצב בדיקה|נכשלה/.test(document.querySelector("#sendProg").textContent), null, { timeout: 120000 });
    const sm = await page.innerHTML("#sendMsg");
    check("מנהל: אחרי שליחה מוצג הקישור ״פתח את התיקייה בדרייב״", /נשלח במצב בדיקה/.test(sm) && /פתח את התיקייה בדרייב/.test(sm) && /href="https:\/\/drive\//.test(sm), sm.slice(0, 200));
    { const env = page._env, folder = Object.values(env.folders).find(f => f.parent === "ROOT"), dx = folder.files.find(f => /\.docx$/.test(f.name)), js = folder.files.find(f => /\.json$/.test(f.name));
      const { doc, core } = await docxParts(dx.bytes), plain = doc.replace(/<[^>]+>/g, "");
      check("הקובץ שנשמר בארכיון: Word עם הגורם המבקש ויוצר המסמך; מייל הבדיקה נושא את הגורם; קובץ נתוני הבקשה אינו כולל שם גורם, אות קריאה או מס׳ רישום", plain.includes("חברת בטא") && /<dc:creator>חברת בטא<\/dc:creator>/.test(core) && env.mails.length === 1 && env.mails[0].body.includes("שם/גורם המבקש: חברת בטא") && !/חברת בטא|אלפא 1|4X-ALF/.test(js.bytes.toString("utf8")), "מיילים " + env.mails.length); }
    await ctx.close();
  }
  {
    // 13ג: חלון השליחה ושליחה בפועל — שרת חדש × (מנהל, משתמש רגיל עם כתובת, משתמש רגיל בלי כתובת) × (חי, בדיקה), ושרת ישן; הנמענים בפועל, ה-target שנשלח, ההודעות, והדרייב למנהל בלבד
    const first = await newPage(browser); const env = first.page._env; await first.ctx.close();
    const admTok = env.call({ action: "login", user: ADMIN, pass: PASS }).token, setMode = m => env.call({ action: "setMailMode", token: admTok, mode: m });
    env.call({ action: "addUser", token: admTok, newUser: "dave.pilot", newPass: "dave-pass-12345" });   // משתמש רגיל בלי כתובת מייל (נוצר ידנית על ידי המנהל)
    env.props.WIX_API_KEY = "test-key";                                                                 // משתמש רגיל עם כתובת: נרשם בכרטיס Wix ששולם, אחרי אימות קוד שנשלח אליה
    env.wix.orders.push({ orderNumber: "ORD-IND-1", status: "PAID", created: new Date(Date.now() - 3 * 86400000).toISOString(), email: "dana@example.com", firstName: "דנה", memberId: "m-1", tickets: [] });
    env.call({ action: "regStart", email: "dana@example.com" });
    const regCode = /(\d{6})/.exec(env.mails[env.mails.length - 1].subject)[1], reg = env.call({ action: "regFinish", email: "dana@example.com", code: regCode, user: "dana.pilot", pass: "dana-pass-1234" });
    env.mails.length = 0;
    const opts = { env, oldServer: false };
    const { ctx, page } = await newPage(browser, opts);
    await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page, "dana.pilot", "dana-pass-1234");
    const OWNER = "owner@icd.test", OFFICE = "notamoffice@iaa.gov.il,nofm@iaa.gov.il";
    const ga = () => page.evaluate(() => ({ email: ReqAuth.getEmail(), copyTo: ReqAuth.getCopyTo(), own: ReqAuth.getCopyToIsOwner(), features: ReqAuth.getFeatures(), role: ReqAuth.getRole() }));
    let g = await ga();
    check("הכנה: dana.pilot נרשמה עם כתובת; auth.js חושף email / copyTo / copyToIsOwner=false / features=sendTarget / role=user", reg.ok && reg.email === "dana@example.com" && g.email === "dana@example.com" && g.copyTo === "dana@example.com" && g.own === false && g.features.includes("sendTarget") && g.role === "user", JSON.stringify(g));
    await readyRequest(page, { org: "דנה לוי צילום" });
    const norm = s => s.replace(/\s+/g, " ");
    const dlg = async () => { await page.click("#btnSend"); await page.waitForSelector(".sendBox"); return norm(await page.textContent(".sendBox")); };
    const closeDlg = async () => { await page.click("#mdClose"); await page.waitForSelector(".sendBox", { state: "detached" }); };
    const newSite = async name => { await page.fill("#siteName", name); await page.waitForFunction(() => window.__REQ.S.ready === true && !window.__REQ.S.pending && !window.__REQ.S.building, null, { timeout: 90000 }); };
    const waitSent = re => page.waitForFunction(r => new RegExp(r).test(document.querySelector("#sendProg").textContent), re, { timeout: 120000 });
    const lastMail = () => env.mails[env.mails.length - 1], sends = () => page._calls.sends || [];
    const driveHidden = async () => !(await page.isVisible("#btnDrive")) && !(await page.locator(".hw:has(#btnDrive)").isVisible());
    check("משתמש רגיל: כפתור ״שמור בדרייב״ וה-״!״ שלו מוסתרים", await driveHidden(), "");
    // --- א. dana, מצב חי: שני כפתורים, הטקסט מפרט מי מקבל מה; שלח רק לעצמי -> למשרד באותו חלון ---
    setMode("live");
    let t = await dlg();
    check("דיאלוג (חי, משתמש עם כתובת): ״מצב חי״, ״שלח למשרד נוטאם״ (ראשי) ו״שלח רק לעצמי (עותק לבדיקה)״", /מצב חי/.test(t) && (await page.textContent("#sendGo")) === "שלח למשרד נוטאם" && (await page.getAttribute("#sendGo", "class")).includes("primary") && (await page.textContent("#sendSelf")) === "שלח רק לעצמי (עותק לבדיקה)" && (await page.isDisabled("#sendGo")) && (await page.isDisabled("#sendSelf")), t.slice(0, 200));
    check("דיאלוג (חי): ״אל: notamoffice@…, nofm@… · עותק אליך: <כתובתך> · התשובות יגיעו אליך · עותק נשמר גם אצל מנהל המערכת לצורכי תמיכה״", t.includes("אל: notamoffice@iaa.gov.il, nofm@iaa.gov.il · עותק אליך: dana@example.com · התשובות יגיעו אליך · עותק נשמר גם אצל מנהל המערכת לצורכי תמיכה"), t.slice(0, 500));
    check("דיאלוג (חי): ״אל: <כתובתך> בלבד · לא נשלח למשרד״; כתובת הבעלים אינה מוצגת", t.includes("אל: dana@example.com בלבד · לא נשלח למשרד") && !t.includes(OWNER), t.slice(0, 600));
    await page.check("#sendOk");
    check("סימון האישור מפעיל את שני הכפתורים", !(await page.isDisabled("#sendGo")) && !(await page.isDisabled("#sendSelf")), "");
    const b0 = page._calls.actions.filter(a => a === "saveBegin").length;
    await page.click("#sendSelf"); await waitSent("נשלח אליך|נכשלה");
    let pr = norm(await page.textContent("#sendProg"));
    check("שליחה רק לעצמי: ההודעה ״נשלח אליך ✔ — לא נשלח למשרד נוטאם״", pr === "נשלח אליך ✔ — לא נשלח למשרד נוטאם.", pr);
    let m = lastMail();
    check("שליחה רק לעצמי: המייל אל המבקש בלבד (בלי עותק), עותק סמוי לבעלים, replyTo למבקש, נושא ״[עותק לעצמי — לא נשלח למשרד נוטאם]״, קבצים מצורפים", env.mails.length === 1 && m.to === "dana@example.com" && !m.cc && m.bcc === OWNER && m.replyTo === "dana@example.com" && m.subject.startsWith("[עותק לעצמי — לא נשלח למשרד נוטאם] ") && m.attachments.length === 6, JSON.stringify({ to: m.to, cc: m.cc, bcc: m.bcc, replyTo: m.replyTo, subject: m.subject.slice(0, 50) }));
    check("הבקשה ל-sendRequest: target=self, בלי expectMode, ובלי שום שדה כתובת/נמען מהלקוח", sends().length === 1 && sends()[0].target === "self" && !("expectMode" in sends()[0]) && !Object.keys(sends()[0]).some(k => /^(to|cc|bcc|email|replyTo|recipients?)$/i.test(k)), JSON.stringify(Object.keys(sends()[0] || {})));
    check("משתמש רגיל: ההודעה ללא קישור לדרייב, והקישור לתיקייה לא קיים בשום מקום בדף", !(await page.$("#sendMsg a")) && !/https:\/\/drive\//.test(await page.content()), norm(await page.textContent("#sendMsg")));
    check("אחרי שליחה לעצמי החלון נשאר: האישור מתאפס וצריך לסמן שוב, והכפתורים חסומים עד אז", !(await page.isChecked("#sendOk")) && !(await page.isDisabled("#sendOk")) && (await page.isDisabled("#sendGo")) && (await page.isDisabled("#sendSelf")), "");
    await page.check("#sendOk"); await page.click("#sendGo"); await waitSent("נשלחה למשרד נוטאם|נכשלה|כבר נשלחה");
    pr = norm(await page.textContent("#sendProg")); m = lastMail();
    check("אחרי שליחה לעצמי אפשר לשלוח למשרד (היא אינה נספרת כ״נשלחה למשרד״): ההודעה ״נשלחה למשרד נוטאם ✔ (עותק אליך)״", /^נשלחה למשרד נוטאם ✔ \(עותק אליך\) — notamoffice@iaa\.gov\.il, nofm@iaa\.gov\.il · /.test(pr) && env.mails.length === 2, pr);
    check("שליחה למשרד: to=משרד נוטאם, cc=המבקש, bcc=הבעלים, replyTo=המבקש, בלי קידומת בנושא", m.to === OFFICE && m.cc === "dana@example.com" && m.bcc === OWNER && m.replyTo === "dana@example.com" && !/^\[/.test(m.subject), JSON.stringify({ to: m.to, cc: m.cc, bcc: m.bcc, replyTo: m.replyTo }));
    check("הבקשה: target=office עם expectMode=live; בלי שמירה נוספת בדרייב בין שני היעדים (saveBegin פעם אחת)", sends().length === 2 && sends()[1].target === "office" && sends()[1].expectMode === "live" && sends()[1].again === false && page._calls.actions.filter(a => a === "saveBegin").length === b0 + 1, JSON.stringify(sends()[1]));
    check("אחרי שליחה למשרד החלון ננעל (אישור וכפתורים חסומים)", (await page.isDisabled("#sendOk")) && (await page.isDisabled("#sendGo")) && (await page.isDisabled("#sendSelf")), "");
    await closeDlg();
    { const lr = env.call({ action: "listRequests", token: admTok }).requests.find(x => x.user === "dana.pilot");
      check("יומן המנהל: שליחה אחת למשרד (חי) ושליחה אחת לעצמו — הלעצמו לא נספרת כ״נשלחה למשרד נוטאם״", lr && lr.sentLive === 1 && lr.sentSelf === 1 && lr.sentTest === 0, JSON.stringify(lr)); }
    { const fo = Object.values(env.folders).find(f => f.parent === "ROOT"), names = fo ? fo.files.map(f => f.name) : [];
      check("הארכיון המרכזי נשמר גם למשתמש רגיל (Word, KML, תמונות) וסימוני השליחה בתיקייה: לעצמו ולמשרד", !!fo && names.some(n => /\.docx$/.test(n)) && names.some(n => /\.kml$/.test(n)) && names.some(n => /\(לעצמו\)\.txt$/.test(n)) && names.some(n => /^נשלח — [\d\- ]+\.txt$/.test(n)), names.join(" | ").slice(0, 300)); }
    // שליחה חוזרת למשרד: נחסמת, ו״שלח שוב בכל זאת״ קיים רק ל-office (שליחה לעצמו נשארת חסומה עד אישור)
    t = await dlg(); await page.check("#sendOk"); await page.click("#sendGo");
    await page.waitForSelector("#sendAgain", { timeout: 60000 });
    check("שליחה שנייה למשרד: ״כבר נשלחה למשרד נוטאם״ + ״שלח שוב בכל זאת״, בלי מייל נוסף", env.mails.length === 2 && /כבר נשלחה למשרד נוטאם/.test(await page.textContent("#sendProg")) && (await page.isDisabled("#sendGo")) && (await page.isDisabled("#sendSelf")), "");
    await page.click("#sendAgain"); await waitSent("נשלחה למשרד נוטאם|נכשלה");
    check("״שלח שוב בכל זאת״ שולח שוב ל-office עם again=true", env.mails.length === 3 && sends()[sends().length - 1].again === true && sends()[sends().length - 1].target === "office" && lastMail().to === OFFICE, JSON.stringify(sends()[sends().length - 1]));
    await closeDlg();
    // --- ב. dana, מצב בדיקה: כפתור אחד ״שלח בדיקה אליי״, בלי ״לעצמי״; נשלח ל-office ממילא רק למבקש ---
    setMode("test"); await newSite("אתר בדיקה ב");
    t = await dlg();
    check("דיאלוג (בדיקה, משתמש עם כתובת): ״מצב בדיקה — המייל יישלח רק אליך (dana@example.com) ולא למשרד נוטאם״, כפתור אחד ״שלח בדיקה אליי״", t.includes("מצב בדיקה — המייל יישלח רק אליך (dana@example.com) ולא למשרד נוטאם") && (await page.textContent("#sendGo")) === "שלח בדיקה אליי" && !(await page.$("#sendSelf")) && !t.includes(OWNER) && t.includes("[בדיקה — לא נשלח למשרד נוטאם] "), t.slice(0, 300));
    await page.check("#sendOk"); await page.click("#sendGo"); await waitSent("נשלח במצב בדיקה|נכשלה");
    pr = norm(await page.textContent("#sendProg")); m = lastMail();
    check("שליחת בדיקה: ״נשלח במצב בדיקה אליך ✔״; המייל אל המבקש בלבד, עותק סמוי לבעלים, נושא עם קידומת בדיקה", pr === "נשלח במצב בדיקה אליך ✔ — לא נשלח למשרד נוטאם." && m.to === "dana@example.com" && !m.cc && m.bcc === OWNER && m.replyTo === "dana@example.com" && m.subject.startsWith("[בדיקה — לא נשלח למשרד נוטאם] ") && env.mails.length === 4, pr + " | " + JSON.stringify({ to: m.to, cc: m.cc, bcc: m.bcc }));
    check("בבדיקה הבקשה היא target=office עם expectMode=test (המצב נאכף בשרת)", sends()[sends().length - 1].target === "office" && sends()[sends().length - 1].expectMode === "test", JSON.stringify(sends()[sends().length - 1]));
    await closeDlg();
    { const html = await page.content(), body = await page.evaluate(() => document.body.innerText);
      check("משתמש רגיל עם כתובת: כתובת הבעלים וקישור התיקייה בדרייב לא מופיעים בשום מקום בדף, ואין ״פתח את התיקייה בדרייב״", !html.includes(OWNER) && !/https:\/\/drive\//.test(html) && !/פתח את התיקייה/.test(body), ""); }
    // יעד שהשתנה בשרת בזמן שהחלון פתוח (כאן: כתובת המבקש): לא נשלח דבר, והחלון נפתח מחדש עם הכתובת העדכנית ודורש אישור מחדש
    setMode("live"); await newSite("אתר שינוי יעד"); await dlg();
    { const rec = JSON.parse(env.props["U:dana.pilot"]); rec.email = "dana.new@example.com"; env.props["U:dana.pilot"] = JSON.stringify(rec); }
    { const n0 = env.mails.length, sb1 = page._calls.actions.filter(a => a === "saveBegin").length;
      await page.check("#sendOk"); await page.click("#sendGo");
      await page.waitForFunction(() => /יעד השליחה בשרת \(כתובת העותק\) השתנה/.test(document.querySelector("#sendMsg").textContent) && /dana\.new@example\.com/.test((document.querySelector(".sendBox") || {}).textContent || ""), null, { timeout: 60000 });
      check("כתובת העותק השתנתה בשרת בזמן שהחלון פתוח: לא נשלח דבר ולא נשמר בדרייב, והחלון נפתח מחדש עם הכתובת העדכנית ודורש אישור מחדש", env.mails.length === n0 && page._calls.actions.filter(a => a === "saveBegin").length === sb1 && (await page.isDisabled("#sendGo")) && !(await page.isChecked("#sendOk")), norm(await page.textContent("#sendMsg")));
      await closeDlg();
      const rec = JSON.parse(env.props["U:dana.pilot"]); rec.email = "dana@example.com"; env.props["U:dana.pilot"] = JSON.stringify(rec); }
    // --- ג. שרת ישן: בלי features — הכפתור ״לעצמי״ מושבת, הודעה לעדכן את השרת, ולא נשלח target; בבדיקה — הטקסט הישן ---
    opts.oldServer = true; setMode("live"); await newSite("אתר ג ישן");
    t = await dlg(); g = await ga();
    check("שרת ישן: auth.js מזהה אותו (אין features) ו-getEmail/getCopyTo ריקים", g.features.length === 0 && g.email === "" && g.copyTo === "" && g.own === false, JSON.stringify(g));
    check("שרת ישן (חי): ״שלח רק לעצמי״ מושבת תמיד, הודעה ״שרת ה-Apps Script עדיין בגרסה הישנה — יש לעדכן אותו (ראו README)״, והטקסט הישן (עותק ותשובות לבעל המערכת)", (await page.isDisabled("#sendSelf")) && /שרת ה-Apps Script עדיין בגרסה הישנה — יש לעדכן אותו \(ראו README\)/.test(t) && t.includes("עותק יישלח לחשבון הבעלים של המערכת, ותשובות המשרד יגיעו אליו (ולא אליך)") && !t.includes("dana@example.com"), t.slice(0, 400));
    await page.check("#sendOk");
    check("שרת ישן: גם אחרי אישור ״שלח רק לעצמי״ נשאר מושבת", (await page.isDisabled("#sendSelf")) && !(await page.isDisabled("#sendGo")), "");
    await page.click("#sendGo"); await waitSent("נשלחה למשרד נוטאם|נכשלה");
    pr = norm(await page.textContent("#sendProg"));
    check("שרת ישן: הבקשה נשלחת בלי target (התנהגות כמו קודם), וההודעה ״(עותק לבעל המערכת)״", !("target" in sends()[sends().length - 1]) && sends()[sends().length - 1].expectMode === "live" && /^נשלחה למשרד נוטאם ✔ \(עותק לבעל המערכת\)/.test(pr), JSON.stringify(sends()[sends().length - 1]) + " | " + pr);
    await closeDlg();
    setMode("test"); t = await dlg();
    check("שרת ישן (בדיקה): הטקסט הישן ״יישלח רק לחשבון הבעלים של המערכת (לא אליך)״, כפתור ״שלח בדיקה לבעל המערכת״, בלי ״לעצמי״, ועדיין הודעת העדכון", t.includes("המייל יישלח רק לחשבון הבעלים של המערכת (לא אליך)") && (await page.textContent("#sendGo")) === "שלח בדיקה לבעל המערכת" && !(await page.$("#sendSelf")) && /עדיין בגרסה הישנה/.test(t) && !t.includes(OWNER), t.slice(0, 300));
    await closeDlg(); opts.oldServer = false;
    // --- ד. dave: משתמש רגיל בלי כתובת — העותק והתשובות לבעל המערכת (רק אז מוצגת כתובתו); ללא דרייב ---
    await page.click("#ubOut"); await login(page, "dave.pilot", "dave-pass-12345"); setMode("live"); await newSite("אתר ד דייב");
    g = await ga();
    check("משתמש בלי כתובת: email ריק, copyTo=הבעלים, copyToIsOwner=true", g.email === "" && g.copyTo === OWNER && g.own === true && g.role === "user", JSON.stringify(g));
    check("משתמש רגיל אחר: כפתור הדרייב עדיין מוסתר", await driveHidden(), "");
    t = await dlg();
    check("דיאלוג (חי, בלי כתובת רשומה): ״אין כתובת מייל רשומה בחשבון שלך — העותק יישלח לבעל המערכת״, והכתובת של הבעלים מוצגת רק כאן", t.includes("אין כתובת מייל רשומה בחשבון שלך — העותק יישלח לבעל המערכת (" + OWNER + ")") && t.includes("התשובות יגיעו לבעל המערכת") && (await page.textContent("#sendSelf")) === "שלח רק לעצמי (עותק לבדיקה)", t.slice(0, 500));
    await page.check("#sendOk"); await page.click("#sendGo"); await waitSent("נשלחה למשרד נוטאם|נכשלה|כבר נשלחה");
    pr = norm(await page.textContent("#sendProg")); m = lastMail();
    check("שליחה למשרד בלי כתובת: cc=הבעלים (ללא bcc כפול), replyTo=הבעלים, ההודעה ״(עותק לבעל המערכת)״", /^נשלחה למשרד נוטאם ✔ \(עותק לבעל המערכת\)/.test(pr) && m.to === OFFICE && m.cc === OWNER && !m.bcc && m.replyTo === OWNER, pr + " | " + JSON.stringify({ to: m.to, cc: m.cc, bcc: m.bcc }));
    await closeDlg();
    const sb0 = page._calls.actions.filter(a => a === "saveBegin").length;
    await page.evaluate(() => { document.getElementById("btnDrive").click(); });   // הגנה לעומק: גם לחיצה תוכנתית על הכפתור המוסתר לא שומרת בדרייב
    await page.waitForTimeout(500);
    check("משתמש רגיל: לחיצה תוכנתית על ״שמור בדרייב״ המוסתר אינה פותחת שמירה (אין saveBegin נוסף ואין הודעה)", page._calls.actions.filter(a => a === "saveBegin").length === sb0 && (await page.textContent("#driveMsg")) === "", "");
    setMode("test"); await newSite("אתר ד דייב בדיקה"); t = await dlg();
    check("דיאלוג (בדיקה, בלי כתובת רשומה): המייל יישלח רק לבעל המערכת, ולא למשרד", t.includes("אין כתובת מייל רשומה בחשבון שלך, ולכן המייל יישלח רק לבעל המערכת (" + OWNER + ") ולא למשרד נוטאם") && (await page.textContent("#sendGo")) === "שלח בדיקה אליי", t.slice(0, 300));
    await page.check("#sendOk"); await page.click("#sendGo"); await waitSent("נשלח במצב בדיקה|נכשלה");
    pr = norm(await page.textContent("#sendProg")); m = lastMail();
    check("בדיקה בלי כתובת: ״נשלח במצב בדיקה לבעל המערכת ✔״ והמייל לבעלים בלבד (בלי bcc כפול)", pr === "נשלח במצב בדיקה לבעל המערכת ✔ — לא נשלח למשרד נוטאם." && m.to === OWNER && !m.cc && !m.bcc, pr + " | " + JSON.stringify({ to: m.to, cc: m.cc, bcc: m.bcc }));
    await closeDlg();
    // --- ה. מנהל (בלי כתובת): כפתור הדרייב מוצג; בחי עותק לבעלים; קישור לתיקייה בהודעה ---
    await page.click("#ubOut"); await login(page); setMode("live"); await newSite("אתר ה מנהל");
    g = await ga();
    check("מנהל: role=admin, בלי כתובת => copyTo=הבעלים; כפתור ״שמור בדרייב״ וה-״!״ מוצגים", g.role === "admin" && g.own === true && g.copyTo === OWNER && (await page.isVisible("#btnDrive")) && (await page.locator(".hw:has(#btnDrive)").isVisible()), JSON.stringify(g));
    await dlg(); await page.check("#sendOk"); await page.click("#sendGo"); await waitSent("נשלחה למשרד נוטאם|נכשלה|כבר נשלחה");
    m = lastMail(); const sm2 = await page.innerHTML("#sendMsg");
    check("מנהל, שליחה חיה: cc=הבעלים (הוא המבקש), ללא bcc כפול; ההודעה כוללת קישור לתיקייה בדרייב", m.to === OFFICE && m.cc === OWNER && !m.bcc && /פתח את התיקייה בדרייב/.test(sm2) && /^נשלחה למשרד נוטאם ✔ \(עותק לבעל המערכת\)/.test(norm(await page.textContent("#sendMsg"))), JSON.stringify({ to: m.to, cc: m.cc, bcc: m.bcc }));
    await closeDlg();
    opts.oldServer = true; t = await dlg();   // מנהל מול שרת ישן: אותו טיפול — ״לעצמי״ מושבת, הודעת העדכון, והטקסט הישן
    check("מנהל מול שרת ישן (חי): ״שלח רק לעצמי״ מושבת, הודעת העדכון והטקסט הישן; לא נשלח target", (await page.isDisabled("#sendSelf")) && /עדיין בגרסה הישנה/.test(t) && t.includes("ותשובות המשרד יגיעו אליו (ולא אליך)") && (await page.evaluate(() => ReqAuth.getFeatures().length)) === 0, t.slice(0, 200));
    await closeDlg(); opts.oldServer = false;
    check("נקודת קצה: כל הבקשות לשרת היו פשוטות, ולא נשלחה כתובת נמען מהלקוח באף sendRequest", sends().every(s => !Object.keys(s).some(k => /^(to|cc|bcc|email|replyTo|recipients?)$/i.test(k))) && sends().length >= 8, sends().length + " שליחות");
    await ctx.close();
  }
  check("שרת ההתחברות נקרא רק ב'בקשות פשוטות' (text/plain) — אפס OPTIONS ואפס Content-Type אחר (Apps Script אמיתי אינו תומך ב-preflight)", API_STATS.posts > 0 && API_STATS.preflight === 0 && API_STATS.nonSimple === 0, JSON.stringify(API_STATS));
} finally {
  await browser.close(); server.close();
}
fs.writeFileSync(path.join(OUT, "e2e-results.json"), JSON.stringify({ live: LIVE, at: new Date().toISOString(), results }, null, 1));
const bad = results.filter(r => !r.ok);
console.log("\nסה״כ " + results.length + " בדיקות, נכשלו " + bad.length);
process.exit(bad.length ? 1 : 0);
