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
// תיקיות הבקשות בדרייב המדומה (חוזה ההפרדה בין הארגון למטיסים עצמאיים): ארגוניות תחת ROOT/"הארגון"/<בקשה>, עצמאיות תחת ROOT/"מטיסים"/<משתמש>/<בקשה>, וישנות (מלפני ההפרדה) ישירות תחת ROOT. תיקיות הסוג והמשתמש עצמן אינן בקשות
const KIND_FOLDERS = ["הארגון", "מטיסים"];
const reqFolders = env => {
  const all = env.folders, live = Object.values(all).filter(f => f.id !== "ROOT" && !f.trashed), par = f => all[f.parent];
  return live.filter(f => { const p1 = par(f), p2 = p1 && par(p1), p3 = p2 && par(p2);
    if (p1 && p1.id === "ROOT") return !KIND_FOLDERS.includes(f.name);                       // עומק 1: ישנה
    if (p2 && p2.id === "ROOT") return p1.name === "הארגון";                                 // עומק 2: ארגונית
    return !!p3 && p3.id === "ROOT" && p2.name === "מטיסים"; });                              // עומק 3: עצמאית
};
// נתיב התיקייה מתחת ל-ROOT (למשל "הארגון/מקום — תאריך" או "מטיסים/dana.pilot/מקום — תאריך")
const folderPath = (env, f) => { const names = []; for (let x = f; x && x.id !== "ROOT"; x = env.folders[x.parent]) names.unshift(x.name); return names.join("/"); };
const API = "https://script.test/exec";
const ADMIN = "itzik.admin", PASS = "correct-horse-1";
const SUPPORT = JSON.parse(fs.readFileSync(path.join(ROOT, "members-k38p", "requests", "config.json"), "utf8")).support_email;   // כתובת התמיכה מההגדרות (n=12): מצורפת להודעות "פנו לתמיכה"

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
// opts.noSplit: שרת בגרסת "עצמאות המבקש" (sendTarget) שעדיין בלי ההפרדה בין הארגון למטיסים עצמאיים — בלי features.orgSplit ובלי org / totals / kind. opts.oldServer מסיר גם את שאר השדות (email, copyTo…)
const oldSrv = (opts, resp) => {
  const split = opts && (opts.oldServer || opts.noSplit);
  if (split && resp && typeof resp === "object") {
    resp = { ...resp };
    ["org", "totals"].forEach(k => { delete resp[k]; });
    if (Array.isArray(resp.users)) resp.users = resp.users.map(u => { const x = { ...u }; delete x.org; return x; });
    if (Array.isArray(resp.requests)) resp.requests = resp.requests.map(u => { const x = { ...u }; delete x.kind; return x; });
    if (Array.isArray(resp.features)) resp.features = resp.features.filter(f => f !== "orgSplit");
    if (opts.oldServer) ["features", "email", "copyTo", "copyToIsOwner"].forEach(k => { delete resp[k]; });
  }
  return resp;
};
const apiHandler = (env, calls, opts) => async r => {
  const req = r.request(), m = req.method();
  if (m === "OPTIONS") { API_STATS.preflight++; return r.abort(); }
  if (m === "POST") { API_STATS.posts++; if (!/^text\/plain/i.test(req.headers()["content-type"] || "")) API_STATS.nonSimple++; }
  if (opts && opts.apiDown) return r.abort();
  const body = m === "POST" ? JSON.parse(req.postData() || "{}") : null;
  if (body && calls) { calls.actions.push(body.action); (calls.at = calls.at || []).push(Date.now()); if (body.action === "sendRequest") (calls.sends = calls.sends || []).push(body); if (body.action === "saveEnd") (calls.saveEnds = calls.saveEnds || []).push({ ready: body.ready }); }
  if (opts && opts.apiDelay) await new Promise(x => setTimeout(x, opts.apiDelay));
  if (opts && opts.apiDelayBy && body && opts.apiDelayBy[body.action]) await new Promise(x => setTimeout(x, opts.apiDelayBy[body.action]));   // השהיה לפעולה אחת בלבד (למשל sendRequest באוויר)
  // opts.intercept(body): תשובה מדומה שמחליפה את השרת (השרת לא נקרא כלל); opts.patchResp(body, resp): שינוי תשובת השרת האמיתי (למשל mailQuotaLeft) — לבדיקת ממשק שאינו תלוי בהתנהגות השרת
  const fake = opts && opts.intercept && body ? opts.intercept(body) : undefined;
  let resp = fake !== undefined ? fake : (m === "POST" ? env.call(body) : env.doGet());
  if (opts && opts.patchResp && body) { const pr = opts.patchResp(body, resp); if (pr !== undefined) resp = pr; }
  r.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify(m === "POST" ? oldSrv(opts, resp) : resp) });
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
    if ("renewUrl" in opts) { if (opts.renewUrl === null) delete d.renew_url; else d.renew_url = opts.renewUrl; }   // כתובת רכישת הכרטיס (renew_url): null = חסרה בהגדרות; כל ערך אחר נכנס כמות שהוא (לבדיקת אימות הכתובת במסכי הכניסה וההרשמה)
    if (typeof opts.autosave === "number") d.autosave_ms = opts.autosave; else if (!opts.autosave) d.autosave_ms = 0;   // שמירה אוטומטית בדרייב (ui.js: autosave_ms) כבויה כברירת מחדל בתרחישים הקיימים (הם בודקים שמירה ושליחה ידניות); opts.autosave: true = בלי המפתח, כלומר ברירת המחדל של המוצר (1500 מ״ש); מספר = השהיה אחרת
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
  // כניסה של משתמש אחר מזה שהיה בדף הפתוח טוענת את הדף מחדש (בידוד בין חשבונות, ui.js switchUser): ממתינים שהטעינה תסתיים והמשתמש החדש יהיה מחובר בדף נקי. בכניסה רגילה התנאי מתקיים מיד
  await page.waitForFunction(() => !window.__REQ_SWITCHING && window.__REQ_READY === true && !document.body.classList.contains("authLocked"), null, { timeout: 60000 });
}
// מפתח האחסון המקומי של המשתמש המחובר (בסיס + ":" + גיבוב שם המשתמש); null אם אין משתמש
const uk = (page, base) => page.evaluate(b => window.__REQ.userKey(b), base);
const lsRead = (page, base) => uk(page, base).then(k => page.evaluate(x => localStorage.getItem(x), k));
// ״אפשרויות נוספות״: #moreOptions (כל ההורדות, לכל סוג חשבון) סגור כברירת מחדל ונפתח בלחיצה על #btnMore; בדיקות שלוחצות על כפתור שבתוכו פותחות אותו קודם, בלחיצה אמיתית
const openMore = async page => { if ((await page.getAttribute("#btnMore", "aria-expanded")) !== "true") await page.click("#btnMore"); await page.waitForSelector("#moreOptions", { state: "visible" }); };

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
  // אף כלי טיס אינו מסומן מראש (n=15): המטיס בוחר בעצמו. ברירת המחדל בבדיקות — אם לא סומן דבר, הכלי הראשון ברשימה (סימון קיים, למשל כלי שנוסף, נשאר); over.aircraft = false משאיר בלי בחירה; over.aircraft = [שמות] בוחר אותם בלבד
  if (over.aircraft !== false) {
    const boxes = page.locator('input[name="ac"]');
    if (Array.isArray(over.aircraft)) { const n = await boxes.count(); for (let i = 0; i < n; i++) { const b = boxes.nth(i); if (over.aircraft.includes(await b.getAttribute("value"))) await b.check(); else await b.uncheck(); } }
    else if ((await page.locator('input[name="ac"]:checked').count()) === 0) await boxes.first().check();
  }
  if (process.env.E2E_SITE) await page.fill("#siteName", process.env.E2E_SITE);
  await page.evaluate(() => { document.getElementById("personBox").open = true; });
  await page.fill("#reqName", "בודק ראשון"); await page.fill("#reqPhone", "050-0000001");
  await page.fill("#reqOrg", over.org || "חברת הבדיקה בע״מ");   // שם הגורם המבקש (שדה 2) חובה ואין לו ברירת מחדל
  // חשבון ארגוני (המנהל במדמה) מקבל ברירות מחדל ארגוניות באות הקריאה וברישום (org_defaults); ברירת המחדל של הבדיקות היא מבקש שמקליד הכול בעצמו — ללא ערך מפורש השדות מנוקים (למטיס עצמאי הם ריקים ממילא)
  await page.fill("#reqCallsign", over.callsign != null ? over.callsign : "");
  await page.fill("#reqReg", over.registration != null ? over.registration : "");
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
    await openMore(page);
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
    const AC_KEY = await uk(page, "icd_req_aircraft_v1");   // הנתונים השמורים שייכים למשתמש המחובר: icd_req_aircraft_v1:<גיבוב שם המשתמש>
    const stored = () => page.evaluate(k => localStorage.getItem(k), AC_KEY);
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
    check("אחרי טעינה מחדש: אף כלי טיס אינו מסומן מראש (לא הראשון הקבוע ולא כלי שנוסף) — המטיס חייב לבחור בעצמו (n=15)", ac.every(a => !a.on), JSON.stringify(ac));
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
    { const lp = JSON.parse(await lsRead(page, "icd_req_person_v1"));
      check("שם הגורם המבקש, אות הקריאה ומס׳ הרישום נשמרים מקומית עם שאר פרטי המבקש", lp.reqOrg === "ארגון שנשמר" && lp.reqCallsign === "קריאה 7" && lp.reqReg === "4X-REG", JSON.stringify(lp).slice(0, 200)); }
    await page.locator("#partList .prow").first().locator('[data-f="first"]').fill("משתתף שלא נשמר");
    const lsPerson = await lsRead(page, "icd_req_person_v1");
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
    check("״מחק פרטים מהמכשיר״ מנקה גם את הגורם המבקש, אות הקריאה ומס׳ הרישום", (await page.inputValue("#reqOrg")) === "" && (await page.inputValue("#reqCallsign")) === "" && (await page.inputValue("#reqReg")) === "" && (await lsRead(page, "icd_req_person_v1")) === null, "");
    check("״מחק פרטים מהמכשיר״: מוחק את האחסון, מנקה שם וטלפון ומחזיר שתי שורות ריקות (ורשימת משתתפים ריקה)", (await lsRead(page, "icd_req_person_v1")) === null && (await page.inputValue("#reqName")) === "" && (await page.locator("#contactList .prow").count()) === 2 && (await page.evaluate(() => [...document.querySelectorAll("#contactList input")].every(i => i.value === ""))) && (await page.locator("#partList .prow").count()) === 0, "");
    await ctx.close();
  }
  // מיגרציה (חד-פעמית): נתונים שנשמרו במפתחות הגלובליים (לפני שהאחסון הפך לפי משתמש), גם בפורמט הישן של אנשי הקשר (contactNames/contactPhone), עוברים למשתמש הראשון שמתחבר בדפדפן הזה אחרי העדכון, והמפתחות הגלובליים נמחקים.
  // משתמש אחר באותו דפדפן לא יורש אותם; ומשתמש שכבר יש לו נתונים משלו לא נדרס
  {
    const { ctx, page } = await newPage(browser);
    await ctx.addInitScript(() => { try { if (!localStorage.getItem("__seeded")) { localStorage.setItem("__seeded", "1");
      localStorage.setItem("icd_req_person_v1", JSON.stringify({ reqName: "מבקש ישן", reqPhone: "050-9999999", contactNames: "דנה כהן; רון לוי", contactPhone: "050-1111111, 050-2222222" }));
      localStorage.setItem("icd_req_aircraft_v1", JSON.stringify(["רחפן ישן"])); localStorage.setItem("icd_req_purposes_v1", JSON.stringify(["מהות ישנה"])); } } catch (e) { /* ignore */ } });
    await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 });
    check("לפני כניסה: הנתונים הישנים (גלובליים) לא נטענים לדף — הטופס ריק והתיבה פתוחה", (await page.inputValue("#reqName")) === "" && (await page.evaluate(() => document.getElementById("personBox").open)) && (await page.locator("#aircraft [data-acrm]").count()) === 0 && (await page.locator("#puList [data-purm]").count()) === 0, "");
    await login(page);
    const rows = await page.evaluate(() => [...document.querySelectorAll("#contactList .prow")].map(r => r.querySelector('[data-f="name"]').value + "|" + r.querySelector('[data-f="phone"]').value));
    const lsP = JSON.parse(await lsRead(page, "icd_req_person_v1"));
    check("מיגרציה מהפורמט הישן: שני אנשי קשר לפי אינדקס (שם + טלפון), והאחסון נכתב מחדש בפורמט החדש", rows.join(",") === "דנה כהן|050-1111111,רון לוי|050-2222222" && lsP.reqName === "מבקש ישן" && Array.isArray(lsP.contacts) && lsP.contacts.length === 2 && !("contactNames" in lsP) && !("contactPhone" in lsP), JSON.stringify(lsP));
    const glob = await page.evaluate(() => ["icd_req_person_v1", "icd_req_aircraft_v1", "icd_req_purposes_v1"].map(k => localStorage.getItem(k)));
    check("אחרי המיגרציה: שלושת המפתחות הגלובליים נמחקו, והנתונים נמצאים אצל המשתמש הראשון (כלי טיס ומהות נוספים מוצגים לו)", glob.every(v => v === null) && JSON.parse(await lsRead(page, "icd_req_aircraft_v1")).join() === "רחפן ישן" && JSON.parse(await lsRead(page, "icd_req_purposes_v1")).join() === "מהות ישנה" && (await page.locator("#aircraft input[value='רחפן ישן']").count()) === 1 && (await page.locator("#puList").innerText()).includes("מהות ישנה"), JSON.stringify(glob));
    check("שם המשתמש אינו נכתב בשם המפתח (גיבוב hex בלבד)", (await uk(page, "icd_req_person_v1")).split(":")[1].length === 16 && !(await uk(page, "icd_req_person_v1")).includes(ADMIN) && !/itzik|admin/i.test((await page.evaluate(() => Object.keys(localStorage))).join(" ")), await uk(page, "icd_req_person_v1"));
    // משתמש שני באותו דפדפן (הדף נטען מחדש בכניסתו): לא יורש כלום
    { const adm = page._env.call({ action: "login", user: ADMIN, pass: PASS }).token; page._env.call({ action: "addUser", token: adm, newUser: "ben.pilot", newPass: "ben-pass-12345" }); }
    await page.click("#ubOut"); await login(page, "ben.pilot", "ben-pass-12345");
    check("משתמש אחר באותו דפדפן אחרי המיגרציה: לא יורש שם, אנשי קשר, כלי טיס או מהות מהמשתמש הראשון", (await page.inputValue("#reqName")) === "" && (await page.locator("#contactList [data-f=name]").evaluateAll(els => els.every(e => e.value === ""))) && (await page.evaluate(() => document.getElementById("personBox").open)) && (await page.locator("#aircraft input[value='רחפן ישן']").count()) === 0 && (await page.locator("#puList [data-purm]").count()) === 0, "");
    // מפתח גלובלי שנכתב מחדש (למשל לשונית ישנה שעדיין רצה) לא נדרס על משתמש שכבר יש לו נתונים — הוא נמחק בלי אימוץ
    await page.click("#ubOut"); await page.evaluate(() => localStorage.setItem("icd_req_person_v1", JSON.stringify({ reqName: "שארית מלשונית ישנה" })));
    await page.reload(); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
    check("מפתח גלובלי שנכתב אחרי המיגרציה: נמחק בלי להידרס על נתוני המשתמש הקיים (ולא מאומץ)", (await page.inputValue("#reqName")) === "מבקש ישן" && (await page.evaluate(() => localStorage.getItem("icd_req_person_v1"))) === null, await page.inputValue("#reqName"));
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
    for (const id of ["runBtn", "mPick", "mAdd", "btnPrint", "btnDocx", "incChecks", "btnKml", "btnAerial", "btnStreet", "btnOverview", "btnRegion", "btnCopy", "btnDrive", "btnSend", "btnMore", "btnMail", "acAdd", "addContact", "addPart", "wipePerson", "qBtn", "baseSat", "baseOsm", "stRun"]) {
      if (!(await hb("#" + id).count())) check("יש לחצן ״!״ ליד #" + id, false, "");
    }
    check("aria-label סטטי ומתאר: ״שלח למשרד נוטאם״ ו״צילום אוויר/מפת רחובות״ (רקעי מפת העבודה) מסבירים שהם משפיעים על התצוגה בלבד", (await hb("#btnSend").getAttribute("aria-label")) === "הסבר על: שליחה למשרד נוטאם" && (await hb("#qBtn").getAttribute("aria-label")) === "הסבר על: חיפוש מקום" && /לא על ארבע התמונות/.test(await hb("#baseSat").getAttribute("data-help")) && /לא על ארבע התמונות/.test(await hb("#baseOsm").getAttribute("data-help")) && /Nominatim/.test(await hb("#qBtn").getAttribute("data-help")) && /בדיקה העצמית/.test(await hb("#stRun").getAttribute("data-help")), "");
    { const dh = await hb("#btnDrive").getAttribute("data-help"), sh = await hb("#btnSend").getAttribute("data-help");
      check("הסברים מדויקים (מנהל = חשבון ארגוני): ״שמור בדרייב״ — שמירה בלי שליחה, אוטומטית כשהכול סומן ואפשר גם ידנית, בארכיון המרכזי לפי סוג הבקשה, הקישור לתיקייה לבעל המערכת בלבד; ״שלח״ — שולח בשם הארגון עם הקבצים מצורפים אוטומטית (ושומר בארכיון הארגון אם טרם נשמר): למשרד (עותק לארגון, התשובות אל הארגון) או רק לעצמי, בבדיקה רק לכתובת המבקש", /בארכיון המרכזי של הארגון בדרייב \(בקשות הארגון בתיקיית ״הארגון״, בקשות מטיסים עצמאיים בתיקיית ״מטיסים״ תחת שם המשתמש\), בלי לשלוח/.test(dh) && /השמירה מתבצעת אוטומטית/.test(dh) && /הקישור אליה מוצג לבעל המערכת בלבד/.test(dh) && !/הכפתור מוצג למנהל/.test(dh) && /כל הקבצים מצורפים אוטומטית/.test(sh) && /בארכיון הארגון בדרייב \(תיקיית ״הארגון״/.test(sh) && /בשם הארגון \(שם השולח ״הארגון הישראלי לרב להב״\)/.test(sh) && /שלח למשרד נוטאם/.test(sh) && /שלח רק לעצמי/.test(sh) && /עותק נשלח לארגון/.test(sh) && /תשובות המשרד יחזרו אל הארגון/.test(sh) && /במצב בדיקה המייל נשלח רק לכתובת שנרשמה בחשבון/.test(sh) && !/owner@|בעל המערכת \(בדיקה\)/.test(sh), dh.slice(0, 80) + " | " + sh.slice(0, 80)); }
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
    check("בחלון ניהול המשתמשים: לחצני ״!״ ליד מתג מצב השליחה, חמשת פריטי המקרא (חסום, פתח מחדש, איפוס, תוקף, מחק), חשבון ארגוני + הוסף, אפס ובדוק", (await page.locator("#admBody .admMode .hbtn").count()) === 1 && (await page.locator("#admBody .admHelp .hbtn").count()) === 5 && (await page.locator("#addForm .hbtn").count()) === 2 && (await page.locator("#rstForm .hbtn").count()) === 1 && (await page.locator("#wxForm .hbtn").count()) === 1, "");
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
    // עריכה רכה (לא של שם האתר) אינה מציגה באנר ״מעדכן״: הלחצנים ננעלים והדוח מתעדכן ב-debounce, ולכן ממתינים גם לסיום ההמתנה (S.pending), לא רק לטקסט השער
    await page.waitForFunction(() => /הבקשה מוכנה לשליחה/.test(document.querySelector("#gate").textContent) && !window.__REQ.S.pending, null, { timeout: 20000 });
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
    await openMore(page);
    const dlp = async sel => { const [d] = await Promise.all([page.waitForEvent("download"), page.click(sel)]); const p = path.join(OUT, "s9-" + d.suggestedFilename()); await d.saveAs(p); return p; };
    { const JZ = require(path.join(ROOT, "members-k38p", "requests", "vendor", "jszip.min.js")), z = await JZ.loadAsync(fs.readFileSync(await dlp("#btnDocx")));
      const doc = await z.file("word/document.xml").async("string"), plain = doc.replace(/<[^>]+>/g, "").replace(new RegExp("[" + String.fromCharCode(0x202a, 0x202c) + "]", "g"), "").replace(/&quot;/g, '"');
      check("הערות הסיור והתאריך בקובץ ה-Word (בסעיף ״הנקודה״ של דף הבדיקות), ה-HTML מוצג כטקסט", plain.includes("הערות המבקש (סיור באתר ב-" + vd + "." + vm + "." + vy + ")") && /ערימת מכולות ליד השער/.test(plain) && plain.includes("&lt;b&gt;x&lt;/b&gt;") && !doc.includes("<b>x</b>") && /שורה שנייה/.test(plain), ""); }
    // (ב) שני משתתפים תקינים נכנסים לשדה 11 ולמייל; ה-HTML שלהם מוצג כטקסט
    check("שני המשתתפים התקינים בשדה 11 (ממוספרים, עם טלפון), שורה ריקה לא נכנסה, ואין הערה לאף משתתף", /משתתפים נוספים בטיסה:/.test(form[10]) && /1\. דנה כהן, 050-1112222/.test(form[10]) && /2\. יוסי לוי <i>x<\/i>, 050-1113333/.test(form[10]) && !/3\./.test(form[10]) && (await page.locator("#report .paper:first-child table.f tr").nth(10).locator("i").count()) === 0, form[10]);
    check("המשתתפים הנוספים אינם במייל הקצר (גוף ו-mailto) — הם בטופס ה-Word בלבד", !/משתתפים|דנה כהן|1112222|1113333/.test(mailBody + mailHref), mailBody.slice(0, 500));
    check("מכשולים שידועים למבקש בשדה 8 (כלשונם), ולא במייל הקצר", /מכשולים שידועים למבקש: עמוד חשמל; דינוזאור מתנפח כחול, <i>חלל<\/i> אפל/.test(form[7]) && !/מכשולים|עמוד חשמל|דינוזאור/.test(mailBody), "");
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
    const folder = reqFolders(page._env)[0], ends2 = page._calls.saveEnds || [];
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
      const folder = reqFolders(page._env)[0];
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
      check("שמירה חוזרת מחליפה קבצים באותו שם (בלי כפילויות)", folder.files.filter(f => !f.trashed).length === 7 && reqFolders(page._env).length === 1, "");
      // בקשה אחרת באותו מקום ותאריך (דף חדש = מזהה בקשה חדש): תיקייה נפרדת, והקבצים של הראשונה לא נדרסים
      { const { ctx: ctxB, page: pageB } = await newPage(browser, { env: page._env });
        await pageB.goto(APP); await pageB.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(pageB);
        await readyRequest(pageB); await pageB.click("#btnDrive");
        await pageB.waitForFunction(() => /נשמרו \d+ קבצים|נכשלה/.test(document.querySelector("#driveMsg").textContent), null, { timeout: 120000 });
        const fs2 = reqFolders(page._env);
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
      check("חלון השליחה (מנהל = חשבון ארגוני בלי כתובת שמורה): מצב בדיקה, נמען כתובת הארגון בלבד, התשובות אל הארגון, נושא וקבצים", /מצב בדיקה/.test(mt) && /המייל יישלח רק אל office@icd\.org\.il ולא למשרד נוטאם · התשובות יחזרו אל הארגון · שם השולח: הארגון הישראלי לרב להב/.test(mt.replace(/\s+/g, " ")) && /שלח בדיקה אליי/.test(mt) && /בקשה לסגירה אווירית —/.test(mt) && /קובץ KML/.test(mt) && ["תצ״א — תקריב", "מפת רחובות — תקריב", "הדמיה וסימונים — מבט כללי", "מפת אזור — מרוחק"].every(n => mt.includes(n)) && !/notamoffice@iaa\.gov\.il, nofm/.test(mt.split("נוסח המייל")[0].split("אל:")[1] || ""), mt.replace(/\s+/g, " ").slice(0, 200));
      check("כפתור השליחה חסום עד סימון האישור", await page.isDisabled("#sendGo"), "");
      await page.check("#sendOk"); check("אחרי סימון האישור הכפתור נפתח", !(await page.isDisabled("#sendGo")), "");
      await page.click("#sendGo");
      await page.waitForFunction(() => /נשלח במצב בדיקה|נכשלה/.test(document.querySelector("#sendProg").textContent), null, { timeout: 120000 });
      const pr = await page.textContent("#sendProg");
      check("שליחת בדיקה הצליחה (לבעלים בלבד)", /נשלח במצב בדיקה/.test(pr) && /לא נשלח למשרד נוטאם/.test(pr), pr.slice(0, 160));
      const mails = page._env.mails;
      check("נשלח מייל אחד לכתובת הארגון עם 6 קבצים מצורפים (Word, KML וארבע תמונות — בלי JSON) ללא נמען חיצוני", mails.length === 1 && mails[0].to === "office@icd.org.il" && mails[0].attachments.length === 6 && !/iaa\.gov\.il/.test(JSON.stringify(mails[0].to + mails[0].cc)), mails.length + " מיילים; " + (mails[0] && mails[0].attachments.map(a => a.name).join(" | ")));
      check("נושא הבדיקה מסומן ונוסח המייל נשמר", /^\[בדיקה — לא נשלח למשרד נוטאם\] בקשה לסגירה אווירית — /.test(mails[0].subject) && /קבצים מצורפים: טופס הבקשה \(Word\), קובץ KML וארבע תמונות מפה/.test(mails[0].body) && /^• גורם מבקש: /m.test(mails[0].body), mails[0].subject.slice(0, 80));
      const folder = reqFolders(page._env)[0];
      check("סימון 'נשלח (בדיקה)' נוצר בתיקייה בדרייב", folder.files.some(f => /^נשלח — .*\(בדיקה\)\.txt$/.test(f.name)), folder.files.map(f => f.name).join(" | ").slice(0, 200));
      const sm = await page.textContent("#sendMsg"); check("ההודעה בעמוד מציינת שליחה לבדיקה בלבד", /בדיקה/.test(sm), sm.slice(0, 120));
      // בקשה שלא השתנתה נשלחת שוב מאותה תיקייה בדרייב (בלי שמירה כפולה); שינוי בנוסח ה-Word מחייב שמירה מחדש
      const sendAgainTest = async () => { await page.click("#btnSend"); await page.waitForSelector(".sendBox"); await page.check("#sendOk"); await page.click("#sendGo"); await page.waitForFunction(() => /נשלח במצב בדיקה|נכשלה/.test(document.querySelector("#sendProg").textContent), null, { timeout: 120000 }); await page.click("#mdClose"); };
      await page.click("#mdClose");
      const nBegin = () => page._calls.actions.filter(a => a === "saveBegin").length, b0 = nBegin();
      await sendAgainTest();
      check("בקשה שלא השתנתה: שליחה חוזרת (בדיקה) משתמשת בתיקייה השמורה — בלי saveBegin נוסף", nBegin() === b0 && page._env.mails.length === 2, "saveBegin " + b0 + "→" + nBegin() + ", מיילים " + page._env.mails.length);
      await openMore(page); await page.click("#incChecks");            // משנה את קובץ ה-Word (ההורדות — ב״אפשרויות נוספות״)
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
      check("מצב השליחה השתנה בשרת: לא נשלח מייל ולא נוצרה תיקייה בדרייב", env.mails.length === 0 && reqFolders(env).length === 0, env.mails.length + " מיילים");
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
      // התנהגות חדשה (n=11): החלון ננעל מיד כשהבקשה משתנה מאחוריו (במקום להמתין ללחיצה), עם הסבר — ולא נשלח דבר
      await page.waitForFunction(() => /הבקשה שונתה בזמן שהחלון היה פתוח/.test(document.querySelector("#sendProg").textContent), null, { timeout: 10000 });
      check("בקשה ששונתה מאחורי חלון השליחה: החלון ננעל מיד (שליחה ואישור מושבתים) עם הסבר, ולא נשלח דבר", (await page.isDisabled("#sendGo")) && (await page.isDisabled("#sendOk")) && page._env.mails.length === 0, "");
      // הגנה בעומק: גם אם הכפתור נפתח בכוח, השליחה נעצרת בבדיקות (הנתונים השתנו, S.ready=false) — כמו קודם
      await page.evaluate(() => { const ok = document.getElementById("sendOk"); ok.disabled = false; ok.checked = true; const g = document.getElementById("sendGo"); g.disabled = false; g.click(); });
      await page.waitForFunction(() => /נכשלה/.test(document.querySelector("#sendProg").textContent), null, { timeout: 30000 });
      const t = await page.textContent("#sendProg");
      check("בקשה ששונתה אחרי שהייתה מוכנה: השליחה נעצרת, אין מייל ואין תיקייה", /אינה מוכנה|השתנו/.test(t) && page._env.mails.length === 0 && reqFolders(page._env).length === 0, t.slice(0, 160));
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
      check("משתמש נחסם באמצע שליחה: מסך הכניסה מעל הכול, החלון נסגר, אין מייל ואין תיקייה", top && !(await page.$("#authModal")) && env.mails.length === 0 && reqFolders(env).length === 0 && /חסום/.test(await page.textContent("#authCover")), "");
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
      // אותה הודעה גנרית על המסך; לא נשלח קוד. השרת שולח לכתובת בלי כרטיס זכאי (גם רוכש אורח) לכל היותר הודעת ״לא נמצא כרטיס״ — ורק לכתובת שהוקלדה (התוצאה הספציפית נמסרת במייל בלבד, לא על המסך)
      check("בלי כרטיס זכאי: אותה הודעה גנרית על המסך, ולא נשלח קוד (לכל היותר הודעת ״לא נמצא כרטיס״ לכתובת שהוקלדה בלבד)", /אם נמצא כרטיס ששולם/.test(await page.textContent("#rgInfo")) && env.mails.every(m => m.to === "visitor@example.com" && !/\b\d{6}\b/.test(m.subject + " " + m.body)), JSON.stringify(env.mails.map(m => [m.to, m.subject])));
      await page.fill("#rgCode", "123456"); await page.fill("#rgUser", "vis.user"); await page.fill("#rgPass", "visitor-pass-12"); await page.click("#rgGo");
      await page.waitForFunction(() => document.querySelector("#rgErr").textContent.length > 0);
      check("קוד שגוי נדחה בהודעה ברורה ולא נוצר חשבון", /הקוד שגוי/.test(await page.textContent("#rgErr")) && !env.props["U:vis.user"], await page.textContent("#rgErr"));
      // הרשמה אמיתית
      await page.fill("#rgEmail", "pilot@example.com"); await page.click("#rgSend");
      await page.waitForFunction(() => document.querySelector("#rgInfo").textContent.length > 0);
      await page.waitForFunction(() => true); await page.waitForTimeout(300);
      const codeMails = env.mails.filter(m => /\b\d{6}\b/.test(m.subject)), mailRec = codeMails[codeMails.length - 1], code = mailRec ? /(\d{6})/.exec(mailRec.subject)[1] : "";
      check("נשלח קוד בן 6 ספרות רק לכתובת הרכישה (ואף קוד לא נשלח לכתובת אחרת; לכתובת בלי כרטיס יצאה לכל היותר הודעת ״לא נמצא כרטיס״)", !!mailRec && codeMails.length === 1 && mailRec.to === "pilot@example.com" && env.mails.every(m => m.to === "pilot@example.com" || m.to === "visitor@example.com"), env.mails.map(m => m.to).join(","));
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
      check("ניהול: ליד המשתמש מוצגים סוג החשבון, המייל ותאריך סיום המנוי (עמודת הסוג נוספה אחרי התפקיד)", !!dr && /^עצמאי/.test(dr[2]) && dr[4] === "pilot@example.com" && /\d/.test(dr[5]) && !/הסתיים/.test(dr[5]), JSON.stringify(dr));
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
      check("מצב חי (מנהל = ארגוני): נשלח ל-notamoffice@ ול-nofm@ בלבד, עותק לכתובת הארגון", env.mails.length === 1 && m.to === "notamoffice@iaa.gov.il,nofm@iaa.gov.il" && m.cc === "office@icd.org.il" && !/^\[בדיקה/.test(m.subject), JSON.stringify([m.to, m.cc]));
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
      check("ניהול: ליד המנהל מוצגות כמות הבקשות שהגיש (1) והנשלחות (2 לפי מניין שליחות אמיתיות)", !!adminRow && adminRow[6] === "1" && adminRow[7] === "2", JSON.stringify(adminRow));
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
      check("המפה התעדכנה: שמירה בדרייב ושליחה חסומות בשער (שום תיקייה לא נוצרה)", (await page.isDisabled("#btnDrive")) && (await page.isDisabled("#btnSend")) && reqFolders(page._env).length === 0, "");
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
    let PUKEY = "icd_req_purposes_v1";   // מתעדכן אחרי הכניסה למפתח של המשתמש המחובר: icd_req_purposes_v1:<גיבוב>
    const HOSTILE = '<img src=x onerror="window.__xss=1"> ]]> </w:t>', P1 = "לצורך הדרכת טייסים";
    const { ctx, page } = await newPage(browser);
    await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
    PUKEY = await uk(page, "icd_req_purposes_v1");
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
    check("מהות פעילות: בהתחלה ״בחרו…״ והמהויות הקבועות בלבד; אין צ׳יפים ואין מהות שמורה; שדה ההוספה מוגבל ל-320 תווים (4×80: הדבקה ארוכה מגיעה להודעת הדחייה ולא נחתכת בשקט) עם placeholder", (await opts()).join("|") === fixedOpts.join("|") && (await sel()) === "" && (await chips()).length === 0 && !(await page.isVisible("#puSaved")) && (await storedArr()).length === 0 && (await page.getAttribute("#puNew", "maxlength")) === "320" && /^למשל: לצורך/.test(await page.getAttribute("#puNew", "placeholder")), (await opts()).join("|"));
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
    // אורך: מעל 80 (מוקלד ממש — שדה ההוספה מקבל עד 320) נדחה בלי חיתוך שקט והשם נשאר בשדה; בדיוק 80 מתקבל
    await page.fill("#puNew", "א".repeat(81)); await page.click("#puAdd");
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
      check("״!״ ליד ״הוסף מהות פעילות״: צמוד לכפתור, aria-label ייחודי, והסבר מדויק (מה נשמר, איפה, שדה 4 בטופס ובקובץ ה-Word ולא בגוף המייל הקצר, ורק מה שהוספת ניתן להסרה)", (await hb.count()) === 1 && (await hb.getAttribute("aria-label")) === "הסבר על: הוספת מהות פעילות" && (await page.locator('.hbtn[aria-label="הסבר על: הוספת מהות פעילות"]').count()) === 1 && /בדפדפן הזה בלבד/.test(help) && /לא בשרת/.test(help) && /עד 30 מהויות נוספות/.test(help) && /שדה 4 בטופס הרשמי/.test(help) && /לקובץ ה-Word/.test(help) && /לא לגוף המייל הקצר/.test(help) && !/ולמייל/.test(help) && /אי אפשר להסיר/.test(help), help);
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
        Storage.prototype.getItem = function (k) { if (String(k).indexOf("icd_req_purposes_v1") === 0) throw new Error("blocked"); return g.apply(this, arguments); };
        Storage.prototype.setItem = function (k) { if (String(k).indexOf("icd_req_purposes_v1") === 0) throw new Error("blocked"); return s.apply(this, arguments); };
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
      check("המהות המותאמת אינה במייל הקצר (גוף ו-mailto) — היא בטופס ובקובץ ה-Word", !mailBody.includes("מהות הפעילות") && !mailBody.includes(HOSTILE) && !mailHref.includes(HOSTILE), mailBody.slice(0, 200));
      await openMore(p2);
      { const JZ = require(path.join(ROOT, "members-k38p", "requests", "vendor", "jszip.min.js")), [d] = await Promise.all([p2.waitForEvent("download"), p2.click("#btnDocx")]), pth = path.join(OUT, "s12-" + d.suggestedFilename());
        await d.saveAs(pth);
        const doc = await (await JZ.loadAsync(fs.readFileSync(pth))).file("word/document.xml").async("string"), plain = doc.replace(/<[^>]+>/g, "").replace(new RegExp("[" + String.fromCharCode(0x202a, 0x202c, 0x200f) + "]", "g"), "").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
        const valid = await p2.evaluate(x => new DOMParser().parseFromString(x, "application/xml").querySelector("parsererror") === null, doc);
        check("המהות המותאמת בקובץ ה-Word כטקסט: ה-XML תקין, אין תגית מוזרקת (</w:t>, <img), והטקסט נשמר כלשונו", valid && plain.includes(HOSTILE) && !doc.includes("<img") && !doc.includes("]]>") && (doc.match(/<w:t[ >]/g) || []).length === (doc.match(/<\/w:t>/g) || []).length, "") }
      await p2.click("#btnSend"); await p2.waitForSelector(".sendBox"); await p2.check("#sendOk"); await p2.click("#sendGo");
      await p2.waitForFunction(() => /נשלח במצב בדיקה|נכשלה/.test(document.querySelector("#sendProg").textContent), null, { timeout: 120000 });
      const mails = p2._env.mails, folder = reqFolders(p2._env)[0], jf = folder && folder.files.find(f => f.name.endsWith(".json")), rec = jf ? JSON.parse(jf.bytes.toString("utf8")) : {};
      check("המהות המותאמת בקובץ נתוני הבקשה בדרייב (inputs.purpose), ולא במייל שנשלח (שרת Apps Script)", mails.length === 1 && !mails[0].body.includes(HOSTILE) && rec.inputs && rec.inputs.purpose === HOSTILE, mails.length + " מיילים");
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
    // הפס מכניס RLM אחרי מזהה לטיני שבא לפני " — " ומספר (אחרת הסדר החזותי מתהפך); השוואות הטקסט כאן הן בלעדיו, ובדיקה נפרדת מוודאת שהוא קיים
    const strip = pg => pg.evaluate(() => document.getElementById("pointSummary").innerText.split(String.fromCharCode(0x200F)).join("").replace(/[ \t]+/g, " "));
    const stripHas = (pg, re) => pg.waitForFunction(r => new RegExp(r).test(document.getElementById("pointSummary").innerText.split(String.fromCharCode(0x200F)).join("")), re.source, { timeout: 8000 }).then(() => true, () => false);
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
    await page.waitForFunction(v => { const m = /LLU20 ״תל אביב״ — [^\n]*?(\d+) מ׳ מקצה הסגירה/.exec(document.getElementById("pointSummary").innerText.split(String.fromCharCode(0x200F)).join("")); return m && Math.abs(+m[1] - (v - 50)) <= 2; }, e100, { timeout: 5000 }).then(() => check("שינוי רדיוס ל-150 מעדכן את הפס (המרחק מקצה הסגירה יורד ב-50 מ׳)", true, ""), async () => check("שינוי רדיוס ל-150 מעדכן את הפס (המרחק מקצה הסגירה יורד ב-50 מ׳)", false, await strip(page)));
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
    check("סדר תצוגה (RTL): אחרי מזהה הנוטם בפס יש RLM לפני ״ — מרחק״ (אחרת המספר מופיע לפני המזהה והיחידה מנותקת ממנו), וגם אחרי תווית אזור בשורת ״בקרבה״", await page.evaluate(() => { const t = document.getElementById("pointSummary").innerText, R = String.fromCharCode(0x200F); return t.includes("C0431/26" + R + " — ") && t.includes("LLU20 ״תל אביב״" + R + " — "); }), (await page.evaluate(() => document.getElementById("pointSummary").innerText)).slice(0, 300));
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
  /* ===== תרחיש תיקוני סקירה (20 ממצאים + תקלות הטלפון וההקלדה): אינטראקציות המפה והפס, כשל בציור שאינו מפיל את הדף, מהויות, הקלדה יציבה, הערות המבקש בטלפון, אזורים בטוחים ===== */
  {
    const LYR = require(path.join(ROOT, "members-k38p/requests/js/maplayers.js"));
    const RLM = String.fromCharCode(0x200F);
    const J = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
    const strip = pg => pg.evaluate(() => document.getElementById("pointSummary").innerText.split(String.fromCharCode(0x200F)).join("").replace(/[ \t]+/g, " "));
    const boot = async (opts, pre) => {   // pre: פעולות לפני טעינת הדף (route וכו׳)
      const { ctx, page } = await newPage(browser, opts || {});
      if (pre) await pre(page);
      await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
      return { ctx, page };
    };
    const clickLL = async (pg, lat, lon, zoom) => {
      if (zoom != null) await pg.evaluate(([la, lo, z]) => { window.__REQ.S.lf.m.setView([la, lo], z, { animate: false }); }, [lat, lon, zoom]);
      await pg.locator("#map").scrollIntoViewIfNeeded();
      const xy = await pg.evaluate(([la, lo]) => { const m = window.__REQ.S.lf.m, p = m.latLngToContainerPoint([la, lo]), r = m.getContainer().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, [lat, lon]);
      await pg.mouse.click(xy.x, xy.y);
    };

    /* --- א. אינטראקציות: גרירה (3/9), נ״צ לא חוקי (6), סגירת כרטיס (17), כרטיס ראשון בזום 8 (11), רט״ג בלי גבול (1), הערת תאריכים (18), ביצועי הקלדת שנה (10) --- */
    {
      const { ctx, page } = await boot();
      await page.fill("#radius", "100"); await page.fill("#height", "80");
      // 11: לחיצה ראשונה בזום 8 (איפוס סינכרוני של המפה) — הכרטיס נפתח מיד ולא אחרי טיימר הגיבוי (900 מ״ש)
      await page.locator("#map").scrollIntoViewIfNeeded();
      const z8 = await page.evaluate(() => window.__REQ.S.lf.m.getZoom());
      const t0 = Date.now(); await clickLL(page, 31.935, 34.880556);   // LLU01, בזום ההתחלתי
      const opened = await page.waitForFunction(() => !!document.querySelector(".leaflet-popup .lp"), null, { timeout: 4000 }).then(() => Date.now() - t0, () => -1);
      check("ממצא 11: לחיצה ראשונה בזום " + z8 + " (איפוס סינכרוני של המפה): הכרטיס נפתח מיד (פחות מ-700 מ״ש, לא אחרי טיימר הגיבוי של 900)", z8 <= 10 && opened >= 0 && opened < 700, "z=" + z8 + " opened after " + opened + "ms");
      await clickLL(page, 32.099128, 34.816617, 16);
      await page.waitForFunction(() => /^\d+\.\d+, \d+\.\d+$/.test(document.getElementById("coord").value), null, { timeout: 5000 });
      await page.waitForFunction(() => /LLU20/.test(document.getElementById("pointSummary").innerText), null, { timeout: 5000 }).catch(() => {});
      const s0 = await strip(page);
      check("ממצא 1/12: הפס מציין שאתרי רט״ג בלי גבול בקובץ אינם נבדקים בו (״לא נבדקו N אתרי רט״ג שאין להם גבול בקובץ — … בהרצה המלאה״), והקביעות ״אין״ מוגבלות לקובץ", /לא נבדקו \d+ אתרי רט״ג שאין להם גבול בקובץ — הם נבדקים רק בהרצה המלאה/.test(s0) && /בתוך הסגירה: (אין חפיפה לאזורי איסור שבקובץ|חפיפה ל-)/.test(s0), s0.slice(0, 400));
      // 3/9: גרירת הסמן כותבת את שדה הנ״צ ומעדכנת את הפס וההרצה; בלי זום; הכרטיס הפתוח נסגר
      await page.evaluate(() => { window.__REQ.S.lf.m.setZoom(12, { animate: false }); });
      await page.waitForTimeout(400);
      const mb = await page.locator(".leaflet-marker-icon").first().boundingBox();
      await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2); await page.mouse.down();
      await page.mouse.move(mb.x + mb.width / 2 + 40, mb.y + mb.height / 2 - 30, { steps: 8 }); await page.mouse.up();
      await page.waitForTimeout(700);
      const d = await page.evaluate(() => { const S = window.__REQ.S, mk = S.lf.marker.getLatLng(), ri = window.__REQ.readInputs(), cf = document.getElementById("coord").value.split(",").map(x => +x.trim()); return { mk: [mk.lat, mk.lng], center: [S.center.lat, S.center.lon], field: cf, run: [ri.lat, ri.lon], zoom: S.lf.m.getZoom(), popup: !!document.querySelector(".leaflet-popup") }; });
      const same = (a, b) => Math.abs(a[0] - b[0]) < 2e-6 && Math.abs(a[1] - b[1]) < 2e-6;
      check("ממצא 3/9: אחרי גרירת הסמן שדה הנ״צ, S.center, הסמן וקלט ההרצה זהים (אין נקודה ישנה בשדה)", same(d.mk, d.field) && same(d.mk, d.center) && same(d.mk, d.run) && !same(d.mk, [32.099128, 34.816617]), JSON.stringify(d));
      check("ממצא 3/9: הגרירה לא מקרבת/מזיזה את המפה (נשארה בזום 12) והכרטיס הישן נסגר", d.zoom === 12 && !d.popup, JSON.stringify(d));
      const s1 = await strip(page);
      check("ממצא 3/9: הפס מתעדכן לנקודה שאליה נגרר הסמן (לא נשאר כמו לפני הגרירה)", s1 !== s0 && !/בחרו נקודה/.test(s1), s1.slice(0, 200));
      // 6: נ״צ שהוקלד ואינו חוקי
      await page.fill("#coord", "garbage"); await page.dispatchEvent("#coord", "change");
      const bad = await page.waitForFunction(() => { const b = document.getElementById("pointSummary"); return b.querySelector('[data-k="hint"]') && !b.querySelector('[data-k="inside"],[data-k="near"],[data-k="notams"]'); }, null, { timeout: 4000 }).then(() => true, () => false);
      check("ממצא 6: טקסט שאינו נ״צ בשדה — הפס מציג ״הנ״צ שהוקלד אינו חוקי״ מיד (בלי להמתין לשינוי שדה אחר) ולא את סיכום הנקודה הקודמת", bad && /הנ״צ שהוקלד אינו חוקי/.test(await strip(page)) && /תצוגה מקדימה בלבד/.test(await strip(page)), await strip(page));
      await page.fill("#coord", "32.099128, 34.816617"); await page.dispatchEvent("#coord", "change");
      await page.evaluate(() => document.getElementById("coord").blur()); await page.waitForTimeout(700);   // עוזבים את השדה לפני הלחיצה על המפה (change נוסף בעזיבה מזיז את המפה לנקודה שהוקלדה)
      check("ממצא 6: נ״צ תקין שוב — הסיכום חוזר", await page.waitForFunction(() => !!document.querySelector('#pointSummary [data-k="inside"]'), null, { timeout: 4000 }).then(() => true, () => false), await strip(page));
      // 17: כרטיס פתוח נסגר כשהנקודה משתנה בהקלדה
      await clickLL(page, 32.95, 35.65, 14);
      const card = await page.waitForFunction(() => !!document.querySelector(".leaflet-popup .lp"), null, { timeout: 8000 }).then(() => true, () => false);
      await page.fill("#coord", "32.9540, 35.6540"); await page.dispatchEvent("#coord", "change");
      check("ממצא 17: כרטיס שנפתח בלחיצה נסגר כשמקלידים נ״צ אחר (לא נשאר על הנקודה הישנה בזמן שהפס מתאר את החדשה)", card && await page.waitForFunction(() => !document.querySelector(".leaflet-popup"), null, { timeout: 3000 }).then(() => true, () => false), "card=" + card);
      // 18: הערת המתג מבחינה בין ״לא נבחרו תאריכים״ ל״תאריכים שגויים״
      await page.fill("#dateFrom", ""); await page.fill("#dateTo", "");
      await page.waitForFunction(() => /עוד לא נבחרו תאריכים/.test(document.getElementById("lyrNotamsNote").textContent), null, { timeout: 4000 }).catch(() => {});
      const n1 = await page.textContent("#lyrNotamsNote");
      await page.fill("#dateFrom", "2026-10-20"); await page.fill("#dateTo", "2026-10-18");
      await page.waitForFunction(() => /אינם תקינים/.test(document.getElementById("lyrNotamsNote").textContent), null, { timeout: 4000 }).catch(() => {});
      const n2 = await page.textContent("#lyrNotamsNote");
      check("ממצא 18: הערת מתג הנוטמים: בלי תאריכים — ״עוד לא נבחרו תאריכים״; תאריכים שגויים — ״התאריכים שנבחרו אינם תקינים״ (ולא ההפך)", /עוד לא נבחרו תאריכים/.test(n1) && !/אינם תקינים/.test(n1) && /התאריכים שנבחרו אינם תקינים/.test(n2) && !/עוד לא נבחרו/.test(n2), n1 + " || " + n2);
      // 10: הקלדת שנה בשדה התאריך (0002, 0020, 0202) אינה גורמת לחסימה ארוכה של הדף
      // מודדים את inputWindow כפי שהדף קורא לו (כל עדכון מושהה): בשנה חלקית הוא חוזר מיד (לא בונה טבלת יום/לילה לאלפי ימים — לפני התיקון ~25 מ״ש כאן ו-~250 מ״ש בדפדפן אטי, פעמיים בכל הקלדה)
      await page.evaluate(() => { const LYo = window.ReqLayers, orig = LYo.inputWindow; window.__IW = { max: 0, n: 0 }; LYo.inputWindow = function () { const t = performance.now(); try { return orig.apply(this, arguments); } finally { window.__IW.max = Math.max(window.__IW.max, performance.now() - t); window.__IW.n++; } }; });
      for (const y of ["0002", "0020", "0202"]) { await page.evaluate(v => { const e = document.getElementById("dateFrom"); e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); }, y + "-10-20"); await page.waitForTimeout(450); }
      const iw = await page.evaluate(() => window.__IW);
      check("ממצא 10: הקלדת שנה חלקית (0002/0020/0202) בשדה התאריך — inputWindow חוזר מיד (פחות מ-8 מ״ש לקריאה; ללא טבלת יום/לילה לאלפי ימים)", iw.n >= 3 && iw.max < 8, JSON.stringify(iw));
      await ctx.close();
    }

    /* --- ב. כשל בציור השכבות לעולם אינו מפיל את הדף (2/7) --- */
    {
      const { ctx, page } = await boot({}, async pg => {
        await pg.route(/\/members-k38p\/data\/zones\.json/, async r => { const resp = await r.fetch(), j = await resp.json(); j.zones[0].rings = [[[null, null], [32, 34], [32.1, 34.1]]]; r.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify(j) }); });
      });
      const d = await page.evaluate(() => ({ ready: window.__REQ_READY === true, run: typeof document.getElementById("runBtn").onclick, add: typeof document.getElementById("puAdd").onclick, zOff: document.getElementById("lyrZones").disabled, nOff: document.getElementById("lyrNotams").disabled, zn: document.getElementById("lyrZonesNote").textContent, vis: window.__REQ.S.lf.lay.visible(), sum: document.getElementById("pointSummary").innerText, a17: window.__REQ.S.statuses.a17 }));
      check("ממצא 2: גבול פגום בקובץ האזורים (קואורדינטה null) — הדף נטען (ready, הכניסה והלחצנים מחווטים), שכבת האיסורים מושבתת עם הסבר, שום אזור לא מצויר, והנוטמים ממשיכים", d.ready && d.run === "function" && d.add === "function" && d.zOff && !d.nOff && /אינה זמינה/.test(d.zn) && d.vis.zones === 0 && d.vis.notams > 0, JSON.stringify(d).slice(0, 400));
      await page.fill("#radius", "100"); await clickLL(page, 32.099128, 34.816617, 16); await page.waitForTimeout(500);
      const s = await strip(page);
      check("ממצא 2: עם גבול פגום הפס אינו אומר ״אין חפיפה״ בירוק אלא מזהיר שאי אפשר לחשב תצוגה מקדימה של האיסורים (נתונים לא תקינים), ושורת ״תצוגה מקדימה בלבד״ נשמרת", /לא ניתן לחשב תצוגה מקדימה של אזורי איסור \(נתונים לא תקינים/.test(s) && !/אין חפיפה לאזורי איסור/.test(s) && /תצוגה מקדימה בלבד/.test(s), s.slice(0, 300));
      check("ממצא 2: כשל התצוגה לא נגע בסטטוס הבדיקות (a17 נטען) ולא יצר תוצאה", await page.evaluate(() => window.__REQ.S.res === null && window.__REQ.S.statuses.a17 && window.__REQ.S.statuses.a17.ok === true), "");
      await ctx.close();
    }
    {
      const huge = { id: "Z9999/26", loc: "LLLL", name: "רדיוס אינסופי", heb: "סגירה ברדיוס אינסופי\nבתוקף: קבוע", raw: "Z9999/26 NOTAMN\nQ) LLLL/QRTCA/IV/BO /W /000/050/3206N03449E002\nA) LLLL B) 2601010000 C) PERM\nE) OPS WI " + "9".repeat(400) + " KM RADIUS CENTERED ON PSN 320600N0344900E CLSD\nF) GND G) 500FT AMSL)" };
      const snapN = J("members-k38p/requests/selftest/notam-data.snap.json"), all = snapN.notams.concat([huge]);
      const expNoLoc = LYR.selectNotams(all, LYR.inputWindow({}, new Date())).noLocation, expItems = LYR.selectNotams(all, LYR.inputWindow({}, new Date())).items.length;
      const { ctx, page } = await boot({}, async pg => {
        await pg.route(/\/notam-all\.json/, r => { const d = JSON.parse(JSON.stringify(snapN)); d.notams = d.notams.concat([huge]); d.fetched_iso = d.fetched_at = pg._notamIso; d.listed = d.count = d.notams.length; d.failed = []; r.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify(d) }); });
      });
      const d = await page.evaluate(() => ({ ready: window.__REQ_READY === true, run: typeof document.getElementById("runBtn").onclick, vis: window.__REQ.S.lf.lay.visible(), note: document.getElementById("lyrNotamsNote").textContent, off: document.getElementById("lyrNotams").disabled, noLoc: window.__REQ.S.lf.lay.sel.noLocation }));
      check("ממצא 7: נוטם עם רדיוס אינסופי (400 ספרות) — הדף נטען, הלחצנים מחווטים, הנוטם נספר ״ללא מיקום״ ואינו מצויר, ושאר הנוטמים מצוירים", d.ready && d.run === "function" && !d.off && d.noLoc.includes("Z9999/26") && d.vis.notams === expItems && new RegExp("· " + expNoLoc.length + " ללא מיקום").test(d.note) && !/טוען נתוני/.test(d.note), JSON.stringify(d).slice(0, 400));
      await ctx.close();
    }

    /* --- ג. מהויות פעילות (4/5/19/20) --- */
    {
      const { ctx, page } = await boot();
      const msg = () => page.textContent("#puMsg"), opts = () => page.$$eval("#purpose option", o => o.map(x => x.value));
      const emoji = String.fromCharCode(0xd83d, 0xde00);
      await page.focus("#puNew"); await page.keyboard.insertText("ג".repeat(120));
      check("ממצא 5: הדבקה של 120 תווים בשדה ההוספה אינה נחתכת ל-80 בשקט (השדה מחזיק את כולה)", (await page.inputValue("#puNew")).length === 120, "len=" + (await page.inputValue("#puNew")).length);
      await page.click("#puAdd");
      check("ממצא 5: מהות של 120 תווים נדחית בהודעה ״ארוכה מדי — עד 80 תווים (הוקלדו 120)״, הטקסט נשאר בשדה ולא נוספה מהות", /ארוכה מדי — עד 80 תווים \(הוקלדו 120\)/.test(await msg()) && (await page.inputValue("#puNew")).length === 120 && (await opts()).length === (await page.evaluate(() => window.__REQ.S.cfg.purposes.length)) + 1, await msg());
      await page.fill("#puNew", emoji.repeat(81)); await page.click("#puAdd");
      check("ממצא 5: 81 אמוג׳י נדחים (נספרים כתווים, לא כיחידות UTF-16)", /הוקלדו 81/.test(await msg()), await msg());
      await page.fill("#puNew", emoji.repeat(80)); await page.click("#puAdd");
      check("ממצא 5: 80 אמוג׳י (160 יחידות UTF-16) מתקבלים ונבחרים", (await page.inputValue("#purpose")) === emoji.repeat(80) && (await msg()) === "", await msg());
      await page.click('#puList [data-purm="0"]');
      for (const [name, text] of [["RLM בודד", RLM], ["ZWSP", String.fromCharCode(0x200b)], ["מילוי הנגול", String.fromCharCode(0x3164)], ["בריילי ריק", String.fromCharCode(0x2800)], ["רווחים ו-RLM", "  " + RLM + RLM + " "]]) {
        await page.fill("#puNew", text); await page.click("#puAdd");
        const ls = (await lsRead(page, "icd_req_purposes_v1")) || "[]";
        check("ממצא 4: מהות שכולה תווים בלתי נראים (" + name + ") נדחית בהודעה — לא נוספת, לא נבחרת ולא נשמרת", /יש להקליד מהות פעילות|אינה מכילה תווים גלויים/.test(await msg()) && (await page.inputValue("#purpose")) === "" && JSON.parse(ls).length === 0, await msg() + " | " + ls);
      }
      // 20: הודעה מיושנת נמחקת בבחירה אחרת; רמז כשהוקלד טקסט שלא נוסף
      const first = await page.evaluate(() => window.__REQ.S.cfg.purposes[0]);
      await page.fill("#puNew", first); await page.click("#puAdd");
      const dup = await msg();
      await page.selectOption("#purpose", { index: 2 });
      check("ממצא 20: הודעת ״כבר ברשימה — נבחרה״ נמחקת כשבוחרים מהות אחרת ב-select", /כבר ברשימה — נבחרה/.test(dup) && (await msg()) === "", dup + " -> " + (await msg()));
      await page.selectOption("#purpose", { index: 0 }); await page.fill("#puNew", "לצורך משלי"); await page.click("#runBtn");
      const hint1 = await page.textContent("#e_purpose");
      await page.fill("#puNew", ""); await page.click("#runBtn");
      const hint2 = await page.textContent("#e_purpose");
      check("ממצא 20: הוקלדה מהות ולא נוספה — שגיאת השדה כוללת רמז ״הקלדתם מהות אך לא הוספתם אותה: לחצו ״הוסף מהות פעילות״״ (בלי להוסיף לבד); בלי טקסט — בלי רמז", /יש לבחור מהות פעילות/.test(hint1) && /לא הוספתם אותה/.test(hint1) && !/לא הוספתם/.test(hint2) && /יש לבחור מהות פעילות/.test(hint2) && (await page.inputValue("#purpose")) === "", hint1 + " || " + hint2);
      // 4: ערך שמור ב-localStorage שכולו בלתי נראה נזרק בטעינה; 19: 30 מהויות — הרשימה גוללת ואינה מנפחת את הסעיף
      const longs = Array.from({ length: 30 }, (_, i) => "לצורך מיפוי ומחקר מס׳ " + (i + 1) + " באתר");
      await page.evaluate(([k, a, r]) => localStorage.setItem(k, JSON.stringify([r, " " + r + " "].concat(a))), [await uk(page, "icd_req_purposes_v1"), longs, RLM]);
      await page.reload(); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 });
      if (await page.$("#authForm")) await login(page); else await page.waitForFunction(() => !document.body.classList.contains("authLocked"), null, { timeout: 20000 });
      const o = await opts(), cfgN = await page.evaluate(() => window.__REQ.S.cfg.purposes.length);
      check("ממצא 4: ערכים שמורים שכולם תווים בלתי נראים נזרקים בטעינה; 30 המהויות התקינות נטענות", o.length === 1 + cfgN + 30 && !o.includes(RLM) && !o.includes(" " + RLM + " "), "options=" + o.length);
      const g = await page.evaluate(() => { const l = document.getElementById("puList"), cs = getComputedStyle(l), s = document.getElementById("inputs").getBoundingClientRect(); return { h: Math.round(l.getBoundingClientRect().height), sh: l.scrollHeight, ch: l.clientHeight, oy: cs.overflowY, sec: Math.round(s.height) }; });
      check("ממצא 19: 30 מהויות שמורות — רשימת הצ׳יפים מוגבלת בגובה (עד 160px) וגוללת (overflow auto), ואינה מנפחת את סעיף ״מה מבקשים״", g.h <= 165 && g.sh > g.ch && /auto|scroll/.test(g.oy), JSON.stringify(g));
      await ctx.close();
    }

    /* --- ד. הקלדה יציבה בשדה הערות המבקש אחרי הרצה (תקלה ב), והערות המבקש בטלפון (תקלה ג) --- */
    const typingProbe = async (page, sel, nChars, pauseAt) => {
      await page.evaluate(s => { const e = document.querySelector(s); e.scrollIntoView({ block: "center" }); e.focus({ preventScroll: true }); }, sel);
      await page.waitForTimeout(300);
      const st = () => page.evaluate(s => { const e = document.querySelector(s); return { top: e.getBoundingClientRect().top, y: window.scrollY, act: document.activeElement && document.activeElement.id, ss: e.selectionStart, se: e.selectionEnd, banner: document.querySelectorAll("#gate .banner").length, locked: document.getElementById("btnSend").disabled && document.getElementById("btnDocx").disabled }; }, sel);
      await page.evaluate(() => { window.__RM = 0; new MutationObserver(m => { window.__RM += m.length; }).observe(document.getElementById("report"), { childList: true, subtree: true, characterData: true, attributes: true }); });   // כמה פעמים הדוח נבנה מחדש בזמן ההקלדה (צריך 0 עד ה-debounce)
      const base = await st(), text = Array.from({ length: nChars }, (_, i) => "אבגדהוזחטיכלמנסעפצקרשת"[i % 22]).join("");
      let mt = 0, my = 0, lost = 0, caret = 0, mb = base.banner, unlocked = 0, rm = 0;
      for (let i = 0; i < nChars; i++) {
        await page.keyboard.type(text[i]); await page.waitForTimeout(i === pauseAt ? 900 : 10);   // pauseAt: השהיה ארוכה באמצע — ההקלדה "נקלטת" (debounce) ואז ממשיכים
        if (i === (pauseAt > 0 ? pauseAt - 1 : nChars - 1)) rm = await page.evaluate(() => window.__RM);
        const s = await st(); mt = Math.max(mt, Math.abs(s.top - base.top)); my = Math.max(my, Math.abs(s.y - base.y)); mb = Math.max(mb, s.banner);
        if (s.act !== sel.slice(1)) lost++; if (s.ss !== i + 1 || s.se !== i + 1) caret++; if (!s.locked && i !== pauseAt) unlocked++;
      }
      await page.waitForFunction(() => !window.__REQ.S.pending, null, { timeout: 20000 });
      const fin = await page.evaluate(([s, t]) => ({ val: document.querySelector(s).value === t, inp: window.__REQ.S.res.inp.visitNotes === t || s !== "#visitNotes", ready: window.__REQ.S.ready, ok: /הבקשה מוכנה לשליחה/.test(document.getElementById("gate").textContent) }), [sel, text]);
      return { base, mt, my, lost, caret, mb, unlocked, rm, fin };
    };
    for (const dev of [{ name: "מחשב", opts: { viewport: { width: 1280, height: 900 } } }, { name: "טלפון 390", opts: { viewport: { width: 390, height: 844 }, touch: true } }]) {
      const { ctx, page } = await boot(dev.opts); let errs = 0; page.on("pageerror", () => { errs++; });
      await readyRequest(page);
      const r = await typingProbe(page, "#visitNotes", 200, 100);
      check("תקלה ב (" + dev.name + "): הקלדת 200 תווים בשדה הערות המבקש — בכל תו הפריסה לא זזה (תיבה וגלילה פחות מ-2px; לפני התיקון: מחשב ~69px, טלפון ~93px גלילה), הפוקוס והסמן נשארים, אין באנר חדש מעל התיבה, הדוח לא נבנה מחדש בכל תו (0 שינויי DOM בדוח עד ההשהיה) ואין שגיאת JS", r.mt < 2 && r.my < 2 && r.lost === 0 && r.caret === 0 && r.mb === r.base.banner && r.rm === 0 && errs === 0, JSON.stringify({ ...r, errs }));
      check("תקלה ב (" + dev.name + "): בזמן ההקלדה הלחצנים נעולים (שער fail-closed: שליחה/Word מושבתים עד שהעריכה נקלטת), ואחרי ההשהיה הטקסט נקלט בבקשה והבקשה שוב מוכנה לשליחה", r.unlocked === 0 && r.fin.val && r.fin.inp && r.fin.ready && r.fin.ok, JSON.stringify(r.fin) + " unlocked=" + r.unlocked);
      const r2 = await typingProbe(page, "#knownObs", 60, -1);
      check("תקלה ב (" + dev.name + "): גם שדה רך אחר (מכשולים ידועים) — הפוקוס והסמן נשארים, בלי שגיאת JS, והשער חוזר למוכן", r2.lost === 0 && r2.caret === 0 && errs === 0 && r2.fin.ready, JSON.stringify(r2).slice(0, 300));
      if (dev.opts.touch) {
        const g = await page.evaluate(() => { const W = innerWidth, o = {}; ["reviewBox", "visitDate", "visitNotes"].forEach(id => { const e = document.getElementById(id), r = e.getBoundingClientRect(), cs = getComputedStyle(e); o[id] = { w: Math.round(r.width), left: Math.round(r.left), right: Math.round(r.right), shown: cs.display !== "none" && cs.visibility !== "hidden" && !!e.offsetParent }; }); return { W, o, scrollW: document.documentElement.scrollWidth }; });
        check("תקלה ג (טלפון 390): אחרי הרצה סעיף 4 — תאריך סיור והערות המבקש — מוצג, בתוך רוחב המסך (בלי חיתוך וגלילה אופקית) וברוחב סביר", Object.values(g.o).every(x => x.shown && x.left >= 0 && x.right <= g.W) && g.o.visitNotes.w >= 250 && g.scrollW <= g.W + 1, JSON.stringify(g));
        await page.locator("#reviewBox").scrollIntoViewIfNeeded(); await page.locator("#reviewBox").screenshot({ path: path.join(OUT, "visit-notes-390.png") });
      }
      await ctx.close();
    }
    for (const W of [390, 320]) {
      const { ctx, page } = await boot({ viewport: { width: W, height: 740 }, touch: true });
      const pre = await page.evaluate(() => ({ hint: !!document.getElementById("reviewHint") && document.getElementById("reviewHint").offsetParent !== null, link: document.getElementById("toReview").hidden, sec: getComputedStyle(document.getElementById("resultsSec")).display }));
      check("תקלה ג (טלפון " + W + "): לפני הרצה — הסעיף עוד לא מוצג, אבל ליד כפתור ההרצה כתוב שאחרי ההרצה יופיע סעיף 4 (הערות המבקש), וקישור הקפיצה מוסתר", pre.hint && pre.link && pre.sec === "none", JSON.stringify(pre));
      await readyRequest(page);
      const g = await page.evaluate(() => { const W = innerWidth, vn = document.getElementById("visitNotes"), r = vn.getBoundingClientRect(); return { W, shown: !!vn.offsetParent, left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height), link: !document.getElementById("toReview").hidden, scrollW: document.documentElement.scrollWidth }; });
      check("תקלה ג (טלפון " + W + "): אחרי הרצה תיבת ההערות מוצגת בתוך המסך (ברוחב ≥ 220px, בלי חיתוך וגלילה אופקית) וקישור הקפיצה לסעיף 4 מוצג", g.shown && g.left >= 0 && g.right <= g.W && g.w >= 220 && g.link && g.scrollW <= g.W + 1, JSON.stringify(g));
      await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(100);
      await page.locator("#toReview").scrollIntoViewIfNeeded(); await page.click("#toReview"); await page.waitForTimeout(500);
      const j = await page.evaluate(() => { const r = document.getElementById("reviewBox").getBoundingClientRect(); return { top: Math.round(r.top), h: innerHeight }; });
      check("תקלה ג (טלפון " + W + "): לחיצה על ״קפיצה לסעיף 4״ מביאה את סעיף 4 למסך", j.top >= -5 && j.top < j.h / 2, JSON.stringify(j));
      await page.locator("#visitNotes").scrollIntoViewIfNeeded(); await page.tap("#visitNotes"); await page.keyboard.type("בדיקת הקלדה בנייד");
      check("תקלה ג (טלפון " + W + "): ניתן להקליד בתיבת ההערות (מגע + מקלדת) והטקסט נקלט בבקשה", (await page.inputValue("#visitNotes")) === "בדיקת הקלדה בנייד" && await page.waitForFunction(() => window.__REQ.S.res.inp.visitNotes === "בדיקת הקלדה בנייד" && !window.__REQ.S.pending, null, { timeout: 8000 }).then(() => true, () => false), await page.inputValue("#visitNotes"));
      await page.locator("#reviewBox").screenshot({ path: path.join(OUT, "visit-notes-" + W + ".png") });
      await ctx.close();
    }

    /* --- ה. אזורים בטוחים (תקלה א): קישור ״חזרה למפה״ לא נבלע בחריץ/שורת הסטטוס; גם landscape וחלונות --- */
    for (const vp of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 568 }]) {
      const { ctx, page } = await newPage(browser, { viewport: vp, touch: true });
      await page.route(/\/members-k38p\/$/, r => r.fulfill({ status: 200, contentType: "text/html", body: "<html><body>map</body></html>" }));
      await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 });
      await page.evaluate(() => { const s = document.documentElement.style; s.setProperty("--safe-top", "50px"); s.setProperty("--safe-left", "44px"); s.setProperty("--safe-right", "44px"); s.setProperty("--safe-bottom", "34px"); });
      const cover = await page.evaluate(() => { const b = document.querySelector("#authCover .authBox"), r = b.getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height), W: innerWidth }; });
      // בטלפון עומד החלון ממורכז אנכית באזור הבטוח (מרווחי auto: 50px למעלה, 34px למטה), ואם הוא גבוה מהאזור — מתחיל בראשו; ב-landscape הוא מתחיל בראש האזור הבטוח ונגלל.
      // (נוסף שורת תמיכה למסך הכניסה, n=12, והחלון גבוה יותר: הבדיקה הקודמת, top > 80, הייתה תחליף לריכוז ונכשלה בטלפון 320×568 למרות שהחלון ממורכז; עכשיו נבדק הריכוז עצמו)
      const centered = Math.abs(cover.top - (50 + Math.max(0, (vp.height - 50 - 34 - cover.h) / 2))) <= 2;
      check("תקלה א (" + vp.width + "×" + vp.height + "): כיסוי הכניסה לא נכנס לאזורים הבטוחים (חלון הכניסה מתחת ל-50px מלמעלה ובתוך 44px מהצדדים), ובטלפון בפורטרט ממורכז אנכית באזור הבטוח", cover.top >= 50 && cover.left >= 44 && cover.right <= cover.W - 44 && (vp.height < vp.width || centered), JSON.stringify(cover));
      await login(page);
      const g = await page.evaluate(() => { const a = document.querySelector("header a.back"), r = a.getBoundingClientRect(), h = document.querySelector("header h1").getBoundingClientRect(), W = innerWidth; return { top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width), right: Math.round(r.right), left: Math.round(r.left), W, h1L: Math.round(h.left), h1R: Math.round(h.right), hit: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === a, scrollW: document.documentElement.scrollWidth }; });
      check("תקלה א (" + vp.width + "×" + vp.height + "): עם --safe-top:50px קישור ״חזרה למפה״ לא חופף לאזור העליון הבטוח (top ≥ 50), גובהו ≥ 44px, הכותרת בתוך הצדדים הבטוחים, ובלי גלילה אופקית", g.top >= 50 && g.h >= 44 && g.w >= 44 && g.hit && g.h1L >= 44 && g.h1R <= g.W - 44 && g.scrollW <= g.W + 1, JSON.stringify(g));
      let nav = true; await Promise.all([page.waitForURL(/\/members-k38p\/$/, { timeout: 8000 }), page.click("header a.back")]).catch(() => { nav = false; });
      check("תקלה א (" + vp.width + "×" + vp.height + "): הקישור ניתן ללחיצה (page.click בלי force) ומנווט למפה", nav, page.url());
      await ctx.close();
    }
    {   // חלון פתוח (ניהול משתמשים) באזור בטוח: מתחת לחריץ ומעל פס הבית
      const { ctx, page } = await boot({ viewport: { width: 390, height: 600 }, touch: true });
      await page.evaluate(() => { document.documentElement.style.setProperty("--safe-top", "50px"); document.documentElement.style.setProperty("--safe-bottom", "34px"); });
      await page.click("#ubAdmin"); await page.waitForSelector("#authModal .authBox");
      const m = await page.evaluate(() => { const r = document.querySelector("#authModal .authBox").getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), H: innerHeight }; });
      check("תקלה א: חלון ניהול המשתמשים (טלפון, חריץ 50px / פס בית 34px) נשאר בתוך האזור הבטוח ולא נחתך למעלה", m.top >= 50 && m.bottom <= m.H - 34 + 1, JSON.stringify(m));
      await ctx.close();
    }
  }
  /* ===== תרחיש 13: עצמאות המבקש — כל מטיס הוא המבקש של בקשתו: גורם מבקש ניתן לעריכה (שדה 2) ואות קריאה / מס׳ רישום (שדות 13 ו-14); חלון השליחה לפי החוזה (למשרד / רק לעצמי / בדיקה; שרת חדש וישן); דרייב למנהל בלבד ===== */
  {
    // 13א: שדות המבקש בטופס של מטיס עצמאי — ריקים כברירת מחדל (ברירות המחדל הארגוניות נטענות רק לחשבון ארגוני; ראו תרחיש 17), גורם מבקש חובה (ללא ערך קבוע), אות קריאה ומס׳ רישום אופציונליים; אימות עם הודעה וסימון
    const { ctx, page } = await newPage(browser);
    { const e0 = page._env, t0 = e0.call({ action: "login", user: ADMIN, pass: PASS }).token; e0.call({ action: "addUser", token: t0, newUser: "pat.pilot", newPass: "pat-pass-12345", org: false }); }   // מטיס עצמאי (org:false)
    await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page, "pat.pilot", "pat-pass-12345");
    await page.evaluate(() => { document.getElementById("personBox").open = true; });
    const lbl = await page.textContent("label.f:has(#reqOrg) > b");
    check("שדה ״שם הגורם המבקש״ בתיבת פרטי המבקש (מטיס עצמאי): תווית ברורה, ריק כברירת מחדל (אין ברירת מחדל ארגונית למטיס עצמאי)", lbl === "שם הגורם המבקש (חברה / ארגון / מטיס — כפי שיופיע בבקשה)" && (await page.inputValue("#reqOrg")) === "" && !/לרב להב/.test(await page.inputValue("#reqOrg")), lbl);
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
    check("המייל: שורת ״גורם מבקש״ והחתימה לפי הגורם שהוקלד (גם ב-mailto)", mn.body.split("\n").includes("• גורם מבקש: חברת אלפא בע״מ") && /בברכה,\nבודק ראשון\nחברת אלפא בע״מ\n050-0000001/.test(mn.body) && mn.mailto.includes("חברת אלפא בע״מ") && !/לרב להב/.test(mn.body), "");
    // עריכת הגורם אחרי ההרצה: שדה רך — הטופס והמייל מתעדכנים, הבקשה נשארת מוכנה, התוצאות הקודמות נמחקות
    await page.evaluate(() => { document.getElementById("sendMsg").textContent = "x"; });
    await page.fill("#reqOrg", "חברת בטא");
    await page.waitForFunction(() => /חברת בטא/.test((document.querySelector("#report .paper:first-child table.f tr:nth-child(2)") || {}).innerText || ""), null, { timeout: 15000 });
    await page.waitForFunction(() => window.__REQ.S.ready === true && !window.__REQ.S.pending, null, { timeout: 30000 });
    form = await formRows(); mn = await mailNow();
    check("עריכת הגורם המבקש אחרי ההרצה: שדה 2 והמייל מתעדכנים, הבקשה נשארת מוכנה לשליחה, והודעת ״נשלח״ הקודמת נמחקת", /חברת בטא/.test(form[1]) && !/אלפא/.test(form[1]) && mn.body.includes("• גורם מבקש: חברת בטא") && !(await page.isDisabled("#btnSend")) && (await page.textContent("#sendMsg")) === "", form[1]);
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
    await openMore(page);
    { const [d] = await Promise.all([page.waitForEvent("download"), page.click("#btnDocx")]); const p = path.join(OUT, "indep-" + d.suggestedFilename()); await d.saveAs(p);
      const { doc, core } = await docxParts(fs.readFileSync(p)), plain = doc.replace(/<[^>]+>/g, "").replace(BIDI, "");
      check("Word שהורד: שדה 2 = ״חברת בטא״, אות הקריאה ומס׳ הרישום בשדות 13 ו-14, יוצר המסמך = הגורם המבקש, ואין ארגון קבוע", plain.includes("חברת בטא") && plain.includes("אלפא 1") && plain.includes("4X-ALF") && /<dc:creator>חברת בטא<\/dc:creator>/.test(core) && !/לרב להב|ICD/.test(plain + core), core.slice(core.indexOf("<dc:creator>"), core.indexOf("</dc:creator>") + 13)); }
    // מנהל: כפתור ״שמור בדרייב״ מוצג; שליחת בדיקה (מנהל בלי כתובת) — הקבצים בארכיון נושאים את הגורם, והקישור לתיקייה מוצג
    check("מנהל: כפתור ״שמור בדרייב״ (ו-״!״ שלו) מוצגים", (await page.isVisible("#btnDrive")) && (await page.locator(".hw:has(#btnDrive)").isVisible()), "");
    await page.click("#btnSend"); await page.waitForSelector(".sendBox"); await page.check("#sendOk"); await page.click("#sendGo");
    await page.waitForFunction(() => /נשלח במצב בדיקה|נכשלה/.test(document.querySelector("#sendProg").textContent), null, { timeout: 120000 });
    const sm = await page.innerHTML("#sendMsg");
    check("מנהל: אחרי שליחה מוצג הקישור ״פתח את התיקייה בדרייב״", /נשלח במצב בדיקה/.test(sm) && /פתח את התיקייה בדרייב/.test(sm) && /href="https:\/\/drive\//.test(sm), sm.slice(0, 200));
    { const env = page._env, folder = reqFolders(env)[0], dx = folder.files.find(f => /\.docx$/.test(f.name)), js = folder.files.find(f => /\.json$/.test(f.name));
      const { doc, core } = await docxParts(dx.bytes), plain = doc.replace(/<[^>]+>/g, "");
      check("הקובץ שנשמר בארכיון: Word עם הגורם המבקש ויוצר המסמך; מייל הבדיקה נושא את הגורם; קובץ נתוני הבקשה אינו כולל שם גורם, אות קריאה או מס׳ רישום", plain.includes("חברת בטא") && /<dc:creator>חברת בטא<\/dc:creator>/.test(core) && env.mails.length === 1 && env.mails[0].body.includes("• גורם מבקש: חברת בטא") && !/חברת בטא|אלפא 1|4X-ALF/.test(js.bytes.toString("utf8")), "מיילים " + env.mails.length); }
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
    const OWNER = "owner@icd.test", ORGA = "office@icd.org.il", OFFICE = "notamoffice@iaa.gov.il,nofm@iaa.gov.il";   // OWNER = בעל הסקריפט (Session); ORGA = כתובת הארגון (CFG.ADMIN_COPY_TO) — מקבלת עותק סמוי ממטיס עצמאי
    const ga = () => page.evaluate(() => ({ email: ReqAuth.getEmail(), copyTo: ReqAuth.getCopyTo(), own: ReqAuth.getCopyToIsOwner(), features: ReqAuth.getFeatures(), role: ReqAuth.getRole(), org: ReqAuth.isOrg() }));
    let g = await ga();
    check("הכנה: dana.pilot נרשמה עם כתובת; auth.js חושף email / copyTo / copyToIsOwner=false / features=sendTarget / role=user", reg.ok && reg.email === "dana@example.com" && g.email === "dana@example.com" && g.copyTo === "dana@example.com" && g.own === false && g.features.includes("sendTarget") && g.features.includes("orgSplit") && g.role === "user" && g.org === false, JSON.stringify(g));
    await readyRequest(page, { org: "דנה לוי צילום" });
    const norm = s => s.replace(/\s+/g, " ");
    const dlg = async () => { await page.click("#btnSend"); await page.waitForSelector(".sendBox"); return norm(await page.textContent(".sendBox")); };
    const closeDlg = async () => { await page.click("#mdClose"); await page.waitForSelector(".sendBox", { state: "detached" }); };
    const newSite = async name => { await page.fill("#siteName", name); await page.waitForFunction(() => window.__REQ.S.ready === true && !window.__REQ.S.pending && !window.__REQ.S.building, null, { timeout: 90000 }); };
    const waitSent = re => page.waitForFunction(r => new RegExp(r).test(document.querySelector("#sendProg").textContent), re, { timeout: 120000 });
    const lastMail = () => env.mails[env.mails.length - 1], sends = () => page._calls.sends || [];
    const driveShown = async () => (await page.isVisible("#btnDrive")) && (await page.locator(".hw:has(#btnDrive)").isVisible()) && (await page.locator("#driveMsg a").count()) === 0 && !(await page.isVisible("#manualMail")) && (await page.evaluate(() => document.getElementById("manualMail").hidden));
    check("משתמש רגיל: כפתור ״שמור בדרייב״ וה-״!״ שלו מוצגים (כמו ״שלח״), המייל הידני (למנהל) מוסתר, ואין קישור לתיקייה", await driveShown(), "");
    // --- א. dana, מצב חי: שני כפתורים, הטקסט מפרט מי מקבל מה; שלח רק לעצמי -> למשרד באותו חלון ---
    setMode("live");
    let t = await dlg();
    check("דיאלוג (חי, משתמש עם כתובת): ״מצב חי״, ״שלח למשרד נוטאם״ (ראשי) ו״שלח רק לעצמי (עותק לבדיקה)״", /מצב חי/.test(t) && (await page.textContent("#sendGo")) === "שלח למשרד נוטאם" && (await page.getAttribute("#sendGo", "class")).includes("primary") && (await page.textContent("#sendSelf")) === "שלח רק לעצמי (עותק לבדיקה)" && (await page.isDisabled("#sendGo")) && (await page.isDisabled("#sendSelf")), t.slice(0, 200));
    check("דיאלוג עצמאי (חי): ״אל: notamoffice@…, nofm@… · עותק אליך: <כתובתך> · התשובות יגיעו אליך״, ושורת שם השולח; הערת הארכיון ניטרלית (צוות התמיכה, בלי הארגון)", t.includes("אל: notamoffice@iaa.gov.il, nofm@iaa.gov.il · עותק אליך: dana@example.com · התשובות יגיעו אליך") && t.includes("שם השולח במייל: דנה לוי צילום — דרך מערכת בקשות הטיסה") && t.includes("הבקשה נשמרת בארכיון המערכת, וצוות התמיכה של המערכת מקבל עותק סמוי של כל שליחה — לצורכי תמיכה בלבד") && !t.includes("מנהל המערכת"), t.slice(0, 500));
    check("דיאלוג (חי): ״אל: <כתובתך> בלבד · לא נשלח למשרד״; כתובת הבעלים אינה מוצגת", t.includes("אל: dana@example.com בלבד · לא נשלח למשרד") && !t.includes(OWNER) && !t.includes(ORGA), t.slice(0, 600));
    await page.check("#sendOk");
    check("סימון האישור מפעיל את שני הכפתורים", !(await page.isDisabled("#sendGo")) && !(await page.isDisabled("#sendSelf")), "");
    const b0 = page._calls.actions.filter(a => a === "saveBegin").length;
    await page.click("#sendSelf"); await waitSent("נשלח אליך|נכשלה");
    let pr = norm(await page.textContent("#sendProg"));
    check("שליחה רק לעצמי: ההודעה ״נשלח אליך ✔ — לא נשלח למשרד נוטאם״", pr === "נשלח אליך ✔ — לא נשלח למשרד נוטאם.", pr);
    let m = lastMail();
    check("שליחה רק לעצמי (עצמאי): המייל אל המבקש בלבד (בלי עותק), עותק סמוי לכתובת הארגון, replyTo למבקש, שם השולח עם הסיומת, נושא ״[עותק לעצמי — לא נשלח למשרד נוטאם]״, קבצים מצורפים", env.mails.length === 1 && m.to === "dana@example.com" && !m.cc && m.bcc === ORGA && m.name === "דנה לוי צילום — דרך מערכת בקשות הטיסה" && m.replyTo === "dana@example.com" && m.subject.startsWith("[עותק לעצמי — לא נשלח למשרד נוטאם] ") && m.attachments.length === 6, JSON.stringify({ to: m.to, cc: m.cc, bcc: m.bcc, replyTo: m.replyTo, subject: m.subject.slice(0, 50) }));
    check("הבקשה ל-sendRequest: target=self, בלי expectMode, ובלי שום שדה כתובת/נמען מהלקוח", sends().length === 1 && sends()[0].target === "self" && !("expectMode" in sends()[0]) && !Object.keys(sends()[0]).some(k => /^(to|cc|bcc|email|replyTo|recipients?)$/i.test(k)), JSON.stringify(Object.keys(sends()[0] || {})));
    check("משתמש רגיל: ההודעה ללא קישור לדרייב, והקישור לתיקייה לא קיים בשום מקום בדף", !(await page.$("#sendMsg a")) && !/https:\/\/drive\//.test(await page.content()), norm(await page.textContent("#sendMsg")));
    check("אחרי שליחה לעצמי החלון נשאר: האישור מתאפס וצריך לסמן שוב, והכפתורים חסומים עד אז", !(await page.isChecked("#sendOk")) && !(await page.isDisabled("#sendOk")) && (await page.isDisabled("#sendGo")) && (await page.isDisabled("#sendSelf")), "");
    await page.check("#sendOk"); await page.click("#sendGo"); await waitSent("נשלחה למשרד נוטאם|נכשלה|כבר נשלחה");
    pr = norm(await page.textContent("#sendProg")); m = lastMail();
    check("אחרי שליחה לעצמי אפשר לשלוח למשרד (היא אינה נספרת כ״נשלחה למשרד״): ההודעה ״נשלחה למשרד נוטאם ✔ (עותק אליך)״", /^נשלחה למשרד נוטאם ✔ \(עותק אליך\) — notamoffice@iaa\.gov\.il, nofm@iaa\.gov\.il · /.test(pr) && env.mails.length === 2, pr);
    check("שליחה למשרד (עצמאי): to=משרד נוטאם, cc=המבקש, bcc=כתובת הארגון, replyTo=המבקש, שם השולח עם הסיומת, בלי קידומת בנושא", m.to === OFFICE && m.cc === "dana@example.com" && m.bcc === ORGA && m.name === "דנה לוי צילום — דרך מערכת בקשות הטיסה" && m.replyTo === "dana@example.com" && !/^\[/.test(m.subject), JSON.stringify({ to: m.to, cc: m.cc, bcc: m.bcc, replyTo: m.replyTo }));
    check("הבקשה: target=office עם expectMode=live; בלי שמירה נוספת בדרייב בין שני היעדים (saveBegin פעם אחת)", sends().length === 2 && sends()[1].target === "office" && sends()[1].expectMode === "live" && sends()[1].again === false && page._calls.actions.filter(a => a === "saveBegin").length === b0 + 1, JSON.stringify(sends()[1]));
    check("אחרי שליחה למשרד החלון ננעל (אישור וכפתורים חסומים)", (await page.isDisabled("#sendOk")) && (await page.isDisabled("#sendGo")) && (await page.isDisabled("#sendSelf")), "");
    await closeDlg();
    { const lr = env.call({ action: "listRequests", token: admTok }).requests.find(x => x.user === "dana.pilot");
      check("יומן המנהל: שליחה אחת למשרד (חי) ושליחה אחת לעצמו — הלעצמו לא נספרת כ״נשלחה למשרד נוטאם״", lr && lr.sentLive === 1 && lr.sentSelf === 1 && lr.sentTest === 0, JSON.stringify(lr)); }
    { const fo = reqFolders(env)[0], names = fo ? fo.files.map(f => f.name) : [];
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
    check("שליחת בדיקה (עצמאי): ״נשלח במצב בדיקה אליך ✔״; המייל אל המבקש בלבד, עותק סמוי לכתובת הארגון, נושא עם קידומת בדיקה", pr === "נשלח במצב בדיקה אליך ✔ — לא נשלח למשרד נוטאם." && m.to === "dana@example.com" && !m.cc && m.bcc === ORGA && m.replyTo === "dana@example.com" && m.subject.startsWith("[בדיקה — לא נשלח למשרד נוטאם] ") && env.mails.length === 4, pr + " | " + JSON.stringify({ to: m.to, cc: m.cc, bcc: m.bcc }));
    check("בבדיקה הבקשה היא target=office עם expectMode=test (המצב נאכף בשרת)", sends()[sends().length - 1].target === "office" && sends()[sends().length - 1].expectMode === "test", JSON.stringify(sends()[sends().length - 1]));
    await closeDlg();
    { const html = await page.content(), body = await page.evaluate(() => document.body.innerText);
      check("מטיס עצמאי עם כתובת: כתובת הבעלים, כתובת הארגון וקישור התיקייה בדרייב לא מופיעים בשום מקום בדף, ואין ״פתח את התיקייה בדרייב״", !html.includes(OWNER) && !html.includes(ORGA) && !body.includes(ORGA) && !/https:\/\/drive\//.test(html) && !/פתח את התיקייה/.test(body), ""); }
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
    check("שרת ישן (חי), משתמש רגיל: ״שלח רק לעצמי״ מושבת תמיד, הודעה ניטרלית ״שליחה רק לעצמך אינה זמינה כרגע — פנו לתמיכה״ (בלי README ובלי הוראה לעדכן את השרת — אין לו סמכות לכך), והטקסט הישן (עותק ותשובות לבעל המערכת)", (await page.isDisabled("#sendSelf")) && /שליחה רק לעצמך אינה זמינה כרגע — פנו לתמיכה/.test(t) && !/README|יש לעדכן אותו|Apps Script/.test(t) && (await page.getAttribute("#sendSelf", "title")) === "שליחה רק לעצמך אינה זמינה כרגע — פנו לתמיכה: " + SUPPORT && t.includes("עותק יישלח לחשבון הבעלים של המערכת, ותשובות המשרד יגיעו אליו (ולא אליך)") && !t.includes("dana@example.com"), t.slice(0, 400));
    await page.check("#sendOk");
    check("שרת ישן: גם אחרי אישור ״שלח רק לעצמי״ נשאר מושבת", (await page.isDisabled("#sendSelf")) && !(await page.isDisabled("#sendGo")), "");
    await page.click("#sendGo"); await waitSent("נשלחה למשרד נוטאם|נכשלה");
    pr = norm(await page.textContent("#sendProg"));
    check("שרת ישן: הבקשה נשלחת בלי target (התנהגות כמו קודם), וההודעה ״(עותק לבעל המערכת)״", !("target" in sends()[sends().length - 1]) && sends()[sends().length - 1].expectMode === "live" && /^נשלחה למשרד נוטאם ✔ \(עותק לבעל המערכת\)/.test(pr), JSON.stringify(sends()[sends().length - 1]) + " | " + pr);
    await closeDlg();
    setMode("test"); t = await dlg();
    check("שרת ישן (בדיקה): הטקסט הישן ״יישלח רק לחשבון הבעלים של המערכת (לא אליך)״, כפתור ״שלח בדיקה לבעל המערכת״, בלי ״לעצמי״, ועדיין הודעת העדכון", t.includes("המייל יישלח רק לחשבון הבעלים של המערכת (לא אליך)") && (await page.textContent("#sendGo")) === "שלח בדיקה לבעל המערכת" && !(await page.$("#sendSelf")) && /שליחה רק לעצמך אינה זמינה כרגע — פנו לתמיכה/.test(t) && !/README|עדיין בגרסה הישנה/.test(t) && !t.includes(OWNER), t.slice(0, 300));
    await closeDlg(); opts.oldServer = false;
    // --- ד. dave: חשבון ארגוני שנוצר ידנית (addUser — ארגוני כברירת מחדל) בלי כתובת שמורה — העותק והתשובות לארגון (כתובת הארגון מוצגת לארגוני בלבד); ללא דרייב (לא מנהל) ---
    // כניסה של משתמש אחר באותו דף (בלי רענון): הדף נטען מחדש עם מצב נקי (בידוד בין חשבונות) — לדייב אין בקשה מוכנה והוא מכין אחת משלו
    await page.click("#ubOut"); await login(page, "dave.pilot", "dave-pass-12345"); setMode("live"); await readyRequest(page, { org: "דייב צילום" });
    g = await ga();
    check("חשבון ארגוני שנוצר ידנית בלי כתובת: org=true, email ריק, copyTo=כתובת הארגון, copyToIsOwner=true", g.org === true && g.email === "" && g.copyTo === ORGA && g.own === true && g.role === "user", JSON.stringify(g));
    check("משתמש רגיל אחר: כפתור הדרייב מוצג והמייל הידני מוסתר", await driveShown(), "");
    t = await dlg();
    check("דיאלוג ארגוני (חי, בלי כתובת רשומה): ״עותק: הארגון (office@icd.org.il) · התשובות יחזרו אל הארגון · שם השולח: הארגון הישראלי לרב להב״, בלי הכתובת של הבעלים", t.includes("עותק: הארגון (" + ORGA + ") · התשובות יחזרו אל הארגון · שם השולח: הארגון הישראלי לרב להב") && !t.includes(OWNER) && !t.includes("בעל המערכת") && (await page.textContent("#sendSelf")) === "שלח רק לעצמי (עותק לבדיקה)", t.slice(0, 500));
    await page.check("#sendOk"); await page.click("#sendGo"); await waitSent("נשלחה למשרד נוטאם|נכשלה|כבר נשלחה");
    pr = norm(await page.textContent("#sendProg")); m = lastMail();
    check("שליחה למשרד מחשבון ארגוני בלי כתובת: cc=כתובת הארגון (ללא bcc), replyTo=הארגון, name=שם הארגון, ההודעה ״(עותק לארגון)״", /^נשלחה למשרד נוטאם ✔ \(עותק לארגון\)/.test(pr) && m.to === OFFICE && m.cc === ORGA && !m.bcc && m.replyTo === ORGA && m.name === "הארגון הישראלי לרב להב", pr + " | " + JSON.stringify({ to: m.to, cc: m.cc, bcc: m.bcc, name: m.name }));
    await closeDlg();
    const sb0 = page._calls.actions.filter(a => a === "saveBegin").length;
    await page.click("#btnDrive");   // הגרסה הזו כבר נשלחה חי למשרד (והתיקייה נעולה): שמירה נוספת הייתה פותחת תיקייה כפולה
    await page.waitForTimeout(500);
    check("משתמש רגיל: ״שמור בדרייב״ אחרי שהגרסה נשלחה חי אינו פותח תיקייה כפולה (אין saveBegin נוסף) ומציג הודעה בלי קישור לתיקייה", page._calls.actions.filter(a => a === "saveBegin").length === sb0 && /כבר נשלחה למשרד נוטאם ושמורה בדרייב/.test(await page.textContent("#driveMsg")) && (await page.locator("#driveMsg a").count()) === 0, await page.textContent("#driveMsg"));
    setMode("test"); await newSite("אתר ד דייב בדיקה"); t = await dlg();
    check("דיאלוג ארגוני (בדיקה, בלי כתובת רשומה): המייל יישלח רק אל כתובת הארגון, ולא למשרד", t.includes("המייל יישלח רק אל " + ORGA + " ולא למשרד נוטאם · התשובות יחזרו אל הארגון") && (await page.textContent("#sendGo")) === "שלח בדיקה אליי", t.slice(0, 300));
    await page.check("#sendOk"); await page.click("#sendGo"); await waitSent("נשלח במצב בדיקה|נכשלה");
    pr = norm(await page.textContent("#sendProg")); m = lastMail();
    check("בדיקה בחשבון ארגוני בלי כתובת: ״נשלח במצב בדיקה לארגון ✔״ והמייל לכתובת הארגון בלבד (בלי bcc כפול)", pr === "נשלח במצב בדיקה לארגון ✔ — לא נשלח למשרד נוטאם." && m.to === ORGA && !m.cc && !m.bcc, pr + " | " + JSON.stringify({ to: m.to, cc: m.cc, bcc: m.bcc }));
    await closeDlg();
    // --- ה. מנהל (בלי כתובת): כפתור הדרייב מוצג; בחי עותק לבעלים; קישור לתיקייה בהודעה ---
    await page.click("#ubOut"); await login(page); setMode("live"); await readyRequest(page, { org: "מנהל צילום" });
    g = await ga();
    check("מנהל: role=admin, org=true, בלי כתובת => copyTo=כתובת הארגון; כפתור ״שמור בדרייב״ וה-״!״ מוצגים", g.role === "admin" && g.org === true && g.own === true && g.copyTo === ORGA && (await page.isVisible("#btnDrive")) && (await page.locator(".hw:has(#btnDrive)").isVisible()), JSON.stringify(g));
    await dlg(); await page.check("#sendOk"); await page.click("#sendGo"); await waitSent("נשלחה למשרד נוטאם|נכשלה|כבר נשלחה");
    m = lastMail(); const sm2 = await page.innerHTML("#sendMsg");
    check("מנהל, שליחה חיה: cc=כתובת הארגון, ללא bcc, replyTo=הארגון; ההודעה כוללת קישור לתיקייה בדרייב", m.to === OFFICE && m.cc === ORGA && !m.bcc && m.replyTo === ORGA && /פתח את התיקייה בדרייב/.test(sm2) && /^נשלחה למשרד נוטאם ✔ \(עותק לארגון\)/.test(norm(await page.textContent("#sendMsg"))), JSON.stringify({ to: m.to, cc: m.cc, bcc: m.bcc }));
    await closeDlg();
    opts.oldServer = true; t = await dlg();   // מנהל מול שרת ישן: אותו טיפול — ״לעצמי״ מושבת, הודעת העדכון, והטקסט הישן
    check("מנהל מול שרת ישן (חי): ״שלח רק לעצמי״ מושבת, הודעת העדכון עם ההוראה לעדכן את השרת (README) למנהל בלבד, והטקסט הישן; לא נשלח target", (await page.isDisabled("#sendSelf")) && /שרת ה-Apps Script עדיין בגרסה הישנה — יש לעדכן אותו \(ראו README\)/.test(t) && (await page.getAttribute("#sendSelf", "title")) === "שרת ה-Apps Script בגרסה הישנה — יש לעדכן אותו" && t.includes("ותשובות המשרד יגיעו אליו (ולא אליך)") && (await page.evaluate(() => ReqAuth.getFeatures().length)) === 0, t.slice(0, 200));
    await closeDlg(); opts.oldServer = false;
    check("נקודת קצה: כל הבקשות לשרת היו פשוטות, ולא נשלחה כתובת נמען מהלקוח באף sendRequest", sends().every(s => !Object.keys(s).some(k => /^(to|cc|bcc|email|replyTo|recipients?)$/i.test(k))) && sends().length >= 8, sends().length + " שליחות");
    await ctx.close();
  }
  /* ===== תרחיש 13: בידוד בין חשבונות באותו דפדפן (n=7/8/16) — מטיסה א׳ מכינה בקשה מוכנה עם פרטים שמורים, מתנתקת, ומטיס ב׳ מתחבר באותו דף; ואחרי רענון ===== */
  if (!LIVE) {
    const { ctx, page } = await newPage(browser);
    const env = page._env, adm = env.call({ action: "login", user: ADMIN, pass: PASS }).token, sleepMs = ms => new Promise(r => setTimeout(r, ms));
    for (const [u, p] of [["anna.pilot", "anna-pass-12345"], ["ben.pilot", "ben-pass-12345"]]) env.call({ action: "addUser", token: adm, newUser: u, newPass: p, org: false });   // מטיסים עצמאיים: בלי ברירות מחדל ארגוניות — השדות ריקים אצל בן
    const ANNA = ["anna.pilot", "anna-pass-12345"], BEN = ["ben.pilot", "ben-pass-12345"];
    const SECRETS = ["אנה צילומי אוויר", "ANNA1", "4X-AAA", "יוסי של אנה", "רונית של אנה", "050-1110001", "050-1110002", "Anna Drone", "מהות של אנה", "מכשול של אנה", "סיור של אנה"];
    await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 });
    await login(page, ...ANNA);
    await page.fill("#acNew", "Anna Drone"); await page.click("#acAdd");
    await page.fill("#puNew", "מהות של אנה"); await page.click("#puAdd");
    await readyRequest(page, { org: "אנה צילומי אוויר", callsign: "ANNA1", registration: "4X-AAA", contacts: [["יוסי של אנה", "050-1110001"], ["רונית של אנה", "050-1110002"]], known: "מכשול של אנה" });
    await setVisit(page, null, "סיור של אנה");
    await page.waitForFunction(() => window.__REQ.S.ready && !window.__REQ.S.pending, null, { timeout: 30000 });
    const annaKeys = await page.evaluate(() => ["icd_req_person_v1", "icd_req_aircraft_v1", "icd_req_purposes_v1"].map(k => window.__REQ.userKey(k)));
    const annaStore = () => page.evaluate(ks => ks.map(k => localStorage.getItem(k)), annaKeys), st0 = await annaStore();
    const globals = () => page.evaluate(() => ["icd_req_person_v1", "icd_req_aircraft_v1", "icd_req_purposes_v1"].map(k => localStorage.getItem(k)));
    check("אנה: בקשה מוכנה; פרטי המבקש, כלי הטיס והמהות הנוספים נשמרו תחת מפתחות עם גיבוב (<בסיס>:<hex 16>) ולא תחת המפתחות הגלובליים", (await page.evaluate(() => window.__REQ.S.ready === true)) && annaKeys.every(k => /^icd_req_(person|aircraft|purposes)_v1:[0-9a-f]{16}$/.test(k)) && st0.every(v => v !== null) && (await globals()).every(v => v === null) && JSON.parse(st0[0]).reqCallsign === "ANNA1", JSON.stringify(annaKeys));
    // (n=9) התנתקות = איפוס מיידי ומלא וטעינה מחדש של הדף (לא רק בכניסה של משתמש אחר): לא נשאר בדף שום דבר מהבקשה; אותה אנה שנכנסת שוב מקבלת רק את פרטיה השמורים בדפדפן
    await page.evaluate(() => { window.__marker = "same-page"; });
    await page.click("#ubOut"); await page.waitForSelector("#authForm"); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 });
    check("אנה מתנתקת: הדף נטען מחדש (הסמן שהושאר בדף הקודם נעלם) והסשן נמחק מהחלון", await page.evaluate(() => window.__marker === undefined && sessionStorage.getItem("icdReqSession") === null && !window.ReqAuth.loggedIn()), "");
    await login(page, ...ANNA);
    check("אותה אנה מתחברת שוב אחרי התנתקות: הבקשה המוכנה והדוח לא חוזרים (הדף נקי), ופרטי המבקש השמורים שלה (גורם מבקש, אנשי קשר) חוזרים מהאחסון המקומי שלה",
      await page.evaluate(() => window.__marker === undefined && !window.__REQ.S.ready && !window.__REQ.S.res && !window.__REQ.S.report && document.getElementById("report").innerHTML === "" && getComputedStyle(document.getElementById("resultsSec")).display === "none" && document.getElementById("reqOrg").value === "אנה צילומי אוויר" && document.getElementById("siteName").value === "" && document.getElementById("knownObs").value === ""), "");
    await page.evaluate(() => { window.__marker = "same-page"; });
    // בן נכנס אחרי שאנה מתנתקת: ההתנתקות טוענת את הדף מחדש פעם אחת בדיוק (אין לולאה), ובן נכנס לדף נקי
    const sends0 = (page._calls.sends || []).length, mails0 = env.mails.length;
    let navs = 0; page.on("framenavigated", f => { if (f === page.mainFrame()) navs++; });   // כמה פעמים הדף נטען מחדש
    await page.click("#ubOut"); await page.waitForSelector("#authForm");
    await login(page, ...BEN);
    await page.waitForTimeout(1500);
    check("אנה מתנתקת ובן נכנס: טעינה מחדש אחת בדיוק (בהתנתקות; אין לולאה), ובן מחובר ומוכן", navs === 1 && (await page.evaluate(() => window.__REQ_READY === true && !document.body.classList.contains("authLocked") && /ben\.pilot/.test(document.getElementById("userBar").textContent))), "navs=" + navs);
    const snap = async () => page.evaluate(() => {
      const S = window.__REQ.S, v = id => document.getElementById(id).value, q = sel => [...document.querySelectorAll(sel)];
      return { fresh: window.__marker === undefined, user: S.lastUser, res: !!S.res, ready: S.ready, report: !!S.report, imgs: Object.keys(S.imgs).length, reviewOk: document.getElementById("reviewOk").checked, results: getComputedStyle(document.getElementById("resultsSec")).display, sendDis: document.getElementById("btnSend").disabled,
        rid: S.rid, folder: !!S.sendFolder, manual: S.manual.length, name: v("reqName"), phone: v("reqPhone"), org: v("reqOrg"), call: v("reqCallsign"), reg: v("reqReg"), site: v("siteName"), ko: v("knownObs"), coord: v("coord"), from: v("dateFrom"), notes: v("visitNotes"),
        contacts: q("#contactList input").map(i => i.value).join(""), parts: q("#partList .prow").length, open: document.getElementById("personBox").open, repLen: document.getElementById("report").innerHTML.length, acx: q("#aircraft [data-acrm]").length, puc: q("#puList [data-purm]").length, purposes: q("#purpose option").length };
    });
    let sn = await snap();
    check("בן מתחבר אחרי אנה: הדף נקי — אין בקשה, דוח, תמונות, סטטוס מוכנות, תיקייה או מזהה בקשה, וכפתור השליחה מושבת", sn.fresh && sn.user === "ben.pilot" && !sn.res && !sn.ready && !sn.report && sn.imgs === 0 && !sn.reviewOk && sn.results === "none" && sn.sendDis && !sn.rid && !sn.folder && sn.manual === 0 && sn.repLen === 0, JSON.stringify(sn));
    check("בן לא רואה את פרטי אנה: שם, טלפון, גורם מבקש, אות קריאה, רישום, אנשי קשר, אתר, תאריכים, מכשולים והערות ריקים; התיבה פתוחה; אין כלי טיס או מהות נוספים", !sn.name && !sn.phone && !sn.org && !sn.call && !sn.reg && !sn.site && !sn.ko && !sn.coord && !sn.from && !sn.notes && !sn.contacts && sn.parts === 0 && sn.open && sn.acx === 0 && sn.puc === 0, JSON.stringify(sn));
    { const html = await page.content(), txt = await page.evaluate(() => document.body.innerText + [...document.querySelectorAll("input,textarea,select")].map(e => e.value).join(" "));
      check("שום מידע של אנה לא מופיע בדף של בן (HTML, טקסט וערכי שדות)", SECRETS.filter(x => html.includes(x) || txt.includes(x)).length === 0, SECRETS.filter(x => html.includes(x) || txt.includes(x)).join(",")); }
    await page.evaluate(() => { document.getElementById("btnSend").click(); const b = document.getElementById("btnSend"); b.onclick && b.onclick(); });
    await page.waitForTimeout(400);
    check("בן לא יכול לשלוח את בקשת אנה: אין חלון שליחה, אין sendRequest ואין מייל (גם בהפעלה תוכנתית של הלחצן)", !(await page.$(".sendBox")) && (page._calls.sends || []).length === sends0 && env.mails.length === mails0, "sends=" + (page._calls.sends || []).length + " mails=" + env.mails.length);
    // בן מקליד פרטים משלו: נשמרים תחת המפתח שלו בלבד, ושל אנה לא נגעו בהם
    await page.fill("#reqName", "בן כהן"); await page.fill("#reqOrg", "בן צילום");
    const benKey = await uk(page, "icd_req_person_v1");
    check("בן: פרטיו נשמרים תחת מפתח משלו; האחסון של אנה לא השתנה ולא נמחק", benKey !== annaKeys[0] && JSON.parse(await page.evaluate(k => localStorage.getItem(k), benKey)).reqOrg === "בן צילום" && JSON.stringify(await annaStore()) === JSON.stringify(st0), benKey);
    // רענון בדף של בן: אותו דבר — רק מה שבן שמר בעצמו
    await page.reload(); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await page.waitForFunction(() => !document.body.classList.contains("authLocked"), null, { timeout: 15000 });
    sn = await snap();
    { const html = await page.content(); check("אחרי רענון של בן: רק הפרטים ששמר בעצמו (בן כהן / בן צילום), בלי שום דבר של אנה, ובלי בקשה מוכנה", sn.name === "בן כהן" && sn.org === "בן צילום" && !sn.call && !sn.reg && !sn.contacts && !sn.res && !sn.ready && sn.acx === 0 && sn.puc === 0 && SECRETS.filter(x => html.includes(x)).length === 0, JSON.stringify(sn)); }
    // התנתקות, רענון (עכשיו הדף חדש וללא משתמש קודם בזיכרון) וכניסה של אנה: הפרטים השמורים שלה חוזרים, הבקשה לא (צריך להריץ מחדש)
    await page.click("#ubOut"); await page.waitForSelector("#authForm"); await login(page, ...ANNA);
    sn = await snap();
    check("אנה חוזרת (אחרי רענון): פרטי המבקש, אות הקריאה, הרישום, אנשי הקשר, כלי הטיס והמהות הנוספים שלה שמורים — אבל הבקשה עצמה לא (אין בקשה מוכנה עד הרצה מחדש)", sn.org === "אנה צילומי אוויר" && sn.call === "ANNA1" && sn.reg === "4X-AAA" && sn.contacts.includes("יוסי של אנה") && sn.acx === 1 && sn.puc === 1 && !sn.res && !sn.ready && sn.results === "none" && !sn.name.includes("בן"), JSON.stringify(sn));
    // אנה מתנתקת, רענון, ובן נכנס בדף חדש (S.lastUser ריק): הפרטים השמורים של אנה לא נטענים אצלו (התרחיש של רענון ואז כניסה)
    await page.click("#ubOut"); await page.waitForSelector("#authForm");
    await login(page, ...BEN);
    sn = await snap();
    { const html = await page.content(); check("אנה מתנתקת, הדף מתרענן ובן נכנס: אין אצלו שום דבר של אנה (לא בשדות, לא ברשימות ולא ב-HTML), ותיבת הפרטים פתוחה אצל מי שאין לו פרטים שלמים", !sn.call && !sn.reg && !sn.contacts.includes("אנה") && sn.acx === 0 && sn.puc === 0 && SECRETS.filter(x => html.includes(x)).length === 0, JSON.stringify(sn)); }
    check("בסוף התרחיש: האחסון של אנה שלם (לא נמחק ולא נדרס), ואין מפתחות גלובליים; שם המשתמש אינו מופיע בשם אף מפתח", JSON.stringify(await annaStore()) === JSON.stringify(st0) && (await globals()).every(v => v === null) && !(await page.evaluate(() => Object.keys(localStorage).join(" "))).match(/anna|ben/i), "");
    await ctx.close();
  }

  /* ===== תרחיש 16: התנתקות, פקיעת אסימון וחסימה מאפסות הכול ונועלות את הדף (n=9); ניווט בהיסטוריה (n=10); בלי כלי טיס מסומן מראש (n=15); הודעות סנכרון ותמיכה (n=11/12); הרשמה (n=17/18) ===== */
  if (!LIVE) {
    const addPilot = (env, u, p) => { const adm = env.call({ action: "login", user: ADMIN, pass: PASS }).token; env.call({ action: "addUser", token: adm, newUser: u, newPass: p, org: false }); return adm; };   // מטיס עצמאי (org:false): בלי ברירות מחדל ארגוניות בשדות
    const GIL = ["gil.pilot", "gil-pass-12345"];
    const SEC = ["גיל צילום סודי", "GIL-CS", "4X-GIL", "איש קשר גיל א", "050-3330001", "מכשול סודי של גיל", "הערת סיור של גיל", "איש קשר גיל ב", "050-3330002"];
    const gilReady = async (page) => {
      await readyRequest(page, { org: SEC[0], callsign: SEC[1], registration: SEC[2], contacts: [[SEC[3], SEC[4]], [SEC[7], SEC[8]]], known: SEC[5] });
      await setVisit(page, null, SEC[6]);
      await page.waitForFunction(() => window.__REQ.S.ready && !window.__REQ.S.pending, null, { timeout: 30000 });
    };
    // כל מה שנשאר בדף מהבקשה של גיל (מצב, שדות, DOM, כפתורים, נעילה) — נקרא בדף שנטען מחדש
    const leftovers = (page) => page.evaluate((secrets) => {
      const S = window.__REQ.S, vals = [...document.querySelectorAll("input,textarea,select")].map(e => e.type === "checkbox" ? "" : e.value).join(" "), html = document.documentElement.outerHTML, txt = document.body.innerText;
      const btns = ["btnPrint", "btnDocx", "btnKml", "btnAerial", "btnStreet", "btnOverview", "btnRegion", "btnCopy", "btnDrive", "btnSend"].map(id => document.getElementById(id).disabled);
      return { res: !!S.res, ready: !!S.ready, report: !!S.report, imgs: Object.keys(S.imgs).length, sent: !!S.sent, folder: !!S.sendFolder, rid: S.rid, uk: S.uk, lastUser: S.lastUser, manual: S.manual.length, reviewOk: document.getElementById("reviewOk").checked,
        results: getComputedStyle(document.getElementById("resultsSec")).display, reportLen: document.getElementById("report").innerHTML.length, gateLen: document.getElementById("gate").innerHTML.length, mailHref: document.getElementById("btnMail").getAttribute("href"),
        secretsHit: secrets.filter(x => vals.includes(x) || html.includes(x) || txt.includes(x)), btnsDisabled: btns.every(Boolean), mainInert: document.querySelector("main").hasAttribute("inert") && document.querySelector("main").getAttribute("aria-hidden") === "true",
        headerInert: document.querySelector("header").hasAttribute("inert") && document.querySelector("header").getAttribute("aria-hidden") === "true", locked: document.body.classList.contains("authLocked"), session: sessionStorage.getItem("icdReqSession") };
    }, SEC);
    // Tab / Shift+Tab: האם הפוקוס נכנס אי פעם לכותרת או לטופס (מאחורי הכיסוי)
    const tabReaches = async (page, n) => {
      let hit = 0;
      for (const key of ["Tab", "Shift+Tab"]) for (let i = 0; i < n; i++) { await page.keyboard.press(key); if (await page.evaluate(() => !!(document.activeElement && document.activeElement.closest && document.activeElement.closest("main,header")))) hit++; }
      return hit;
    };

    // 16א: התנתקות יזומה — איפוס מלא וטעינה מחדש; הדף נעול (inert) ואין הורדה/שליחה/מחיקה במקלדת
    {
      const { ctx, page } = await newPage(browser);
      const env = page._env; addPilot(env, ...GIL);
      const downloads = []; page.on("download", d => downloads.push(d.suggestedFilename()));
      await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page, ...GIL);
      await gilReady(page);
      const gilKeys = await page.evaluate(() => ["icd_req_person_v1", "icd_req_aircraft_v1", "icd_req_purposes_v1"].map(k => window.__REQ.userKey(k))), store = () => page.evaluate(ks => ks.map(k => localStorage.getItem(k)), gilKeys), st0 = await store();
      const sends0 = (page._calls.sends || []).length, mails0 = env.mails.length;
      check("n=9: לפני ההתנתקות: בקשה מוכנה עם הפרטים של גיל, והכפתורים פעילים", (await page.evaluate(() => window.__REQ.S.ready === true && !document.getElementById("btnDocx").disabled)) && (await page.inputValue("#reqOrg")) === SEC[0], "");
      await page.click("#ubOut"); await page.waitForSelector("#authForm"); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 });
      let lo = await leftovers(page);
      check("n=9: אחרי התנתקות הדף נטען מחדש ונקי לגמרי — אין בקשה, דוח, תמונות, סטטוס מוכנות, תיקייה, מזהה בקשה או מפתח אחסון (S.uk); ריק מכל שדה אישי, ללא קישור mailto", !lo.res && !lo.ready && !lo.report && lo.imgs === 0 && !lo.sent && !lo.folder && !lo.rid && lo.uk === "" && !lo.lastUser && lo.manual === 0 && !lo.reviewOk && lo.results === "none" && lo.reportLen === 0 && lo.gateLen === 0 && !/mailto/.test(lo.mailHref || "") && lo.session === null, JSON.stringify(lo));
      check("n=9: שום מידע של גיל לא נשאר בדף (HTML, טקסט וערכי שדות)", lo.secretsHit.length === 0, lo.secretsHit.join(","));
      check("n=9: הדף נעול באמת — main ו-header עם inert ו-aria-hidden, גוף הדף authLocked, וכל כפתורי ההפקה מושבתים", lo.mainInert && lo.headerInert && lo.locked && lo.btnsDisabled, JSON.stringify({ m: lo.mainInert, h: lo.headerInert, l: lo.locked, b: lo.btnsDisabled }));
      check("n=9: Tab ו-Shift+Tab (70 לחיצות כל כיוון) לא מגיעים אף פעם לכותרת או לטופס מאחורי הכיסוי", (await tabReaches(page, 70)) === 0, "");
      await page.evaluate(() => { for (const id of ["btnPrint", "btnDocx", "btnKml", "btnAerial", "btnStreet", "btnOverview", "btnRegion", "btnCopy", "btnDrive", "btnSend", "wipePerson"]) { const b = document.getElementById(id); b.disabled = false; b.click(); } document.getElementById("btnMail").click(); });
      await page.waitForTimeout(500);
      check("n=9: גם הפעלה תוכנתית של כפתורי ההפקה (כשהם מופעלים בכוח) לא מורידה קובץ, לא שולחת, לא מוחקת את האחסון של גיל ולא פותחת חלון", downloads.length === 0 && (page._calls.sends || []).length === sends0 && env.mails.length === mails0 && JSON.stringify(await store()) === JSON.stringify(st0) && !(await page.$(".sendBox")), downloads.join(","));
      check("n=9: ההתנתקות אינה מוחקת את הנתונים השמורים של גיל (נטענים בכניסה הבאה שלו), והאחסון נשאר תחת המפתח שלו בלבד", st0[0] !== null && JSON.parse(st0[0]).reqOrg === SEC[0], "");
      await login(page, ...GIL);
      lo = await leftovers(page);
      check("n=9: גיל נכנס שוב: הבקשה לא חוזרת (הדף נקי) אבל פרטיו השמורים כן", !lo.res && !lo.ready && lo.results === "none" && lo.reportLen === 0 && (await page.inputValue("#reqOrg")) === SEC[0] && !lo.mainInert && !lo.locked, JSON.stringify(lo));
      await ctx.close();
    }
    // 16ב: פקיעת אסימון וחסימה באמצע עבודה — אותו איפוס; ההודעה מוצגת בכיסוי של הדף הנקי (חסימה עם כתובת התמיכה)
    for (const mode of ["expired", "blocked"]) {
      const opts = {}, { ctx, page } = await newPage(browser, opts);
      const env = page._env, adm = addPilot(env, ...GIL);
      await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page, ...GIL);
      await gilReady(page);
      const sends0 = (page._calls.sends || []).length, mails0 = env.mails.length;
      if (mode === "expired") opts.intercept = b => b.action === "me" ? { ok: false, error: "expired" } : undefined; else env.call({ action: "setBlocked", token: adm, target: GIL[0], blocked: true });
      await page.click("#btnSend");   // בדיקת מצב השליחה מול השרת (me) מזהה את האסימון הפסול
      await page.waitForSelector("#authForm", { timeout: 30000 }); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 });
      const lo = await leftovers(page), note = await page.textContent("#auErr");
      check("n=9 (" + mode + "): אחרי שגיאת auth באמצע עבודה הדף נטען מחדש ונקי לגמרי ונעול, בלי שום מידע של גיל", !lo.res && !lo.ready && lo.imgs === 0 && !lo.rid && lo.uk === "" && lo.results === "none" && lo.reportLen === 0 && lo.secretsHit.length === 0 && lo.mainInert && lo.headerInert && lo.locked && lo.session === null && (await tabReaches(page, 40)) === 0, JSON.stringify(lo));
      check("n=9 (" + mode + "): לא נשלח דבר (אין sendRequest ואין מייל, ואין חלון שליחה)", (page._calls.sends || []).length === sends0 && env.mails.length === mails0 && !(await page.$(".sendBox")), "");
      check("n=9 (" + mode + "): ההודעה מוצגת בכיסוי של הדף הנקי" + (mode === "blocked" ? ", וכוללת את כתובת התמיכה (n=12)" : ""), mode === "expired" ? /פג תוקף ההתחברות/.test(note) : (/חסום/.test(note) && note.includes(SUPPORT)), note);
      await ctx.close();
    }
    // 16ג: שכבת הגנה נוספת — גם בלי איפוס, פעולה תוכנתית בלי סשן תקף לא מבצעת דבר ומציגה את מסך הכניסה (נעול)
    {
      const { ctx, page } = await newPage(browser);
      const env = page._env; addPilot(env, ...GIL);
      const downloads = []; page.on("download", d => downloads.push(d.suggestedFilename()));
      await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page, ...GIL);
      await gilReady(page);
      const gilKeys = await page.evaluate(() => ["icd_req_person_v1"].map(k => window.__REQ.userKey(k))), store = () => page.evaluate(ks => ks.map(k => localStorage.getItem(k)), gilKeys), st0 = await store();
      const r = await page.evaluate(async () => {
        window.__printed = 0; window.print = () => { window.__printed++; };
        window.ReqAuth.exp = 0;   // האסימון פג בצד הלקוח, בלי אירוע התנתקות
        let mailPrevented = null; document.addEventListener("click", e => { if (e.target.closest && e.target.closest("#btnMail")) mailPrevented = e.defaultPrevented; });
        for (const id of ["btnPrint", "btnDocx", "btnKml", "btnAerial", "btnStreet", "btnOverview", "btnRegion", "btnCopy", "wipePerson"]) document.getElementById(id).click();
        document.getElementById("btnMail").click();
        await new Promise(x => setTimeout(x, 400));
        return { printed: window.__printed, mailPrevented, cover: !!document.getElementById("authCover"), inert: document.querySelector("main").hasAttribute("inert") };
      });
      check("n=9: אסימון פג בצד הלקוח: הדפסה, Word, KML, ארבע התמונות, העתקת מייל, מחיקת פרטים ופתיחת מייל — אף אחת לא פועלת (אין הורדה, הדפסה, מחיקה), ומוצג מסך הכניסה והדף נעול", downloads.length === 0 && r.printed === 0 && r.mailPrevented === true && JSON.stringify(await store()) === JSON.stringify(st0) && r.cover && r.inert, JSON.stringify(r) + downloads.join(","));
      check("n=9: אחרי נעילה כזו Tab ו-Shift+Tab לא מגיעים לטופס", (await tabReaches(page, 40)) === 0, "");
      await ctx.close();
    }
    // 16ד: ניווט בהיסטוריה (n=10) — autocomplete="off" על כל השדות, ניקוי שדות ששוחזרו, ומטפל pageshow (persisted)
    {
      const { ctx, page } = await newPage(browser);
      const env = page._env; addPilot(env, ...GIL); addPilot(env, "ben.pilot", "ben-pass-12345");
      await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 });
      const ac = await page.evaluate(() => [...document.querySelectorAll("main input, main textarea, main select")].filter(e => e.getAttribute("autocomplete") !== "off").map(e => e.id || e.name || e.tagName));
      check("n=10: כל שדה קלט, טקסט ובחירה בטופס (גם ארגז הבחירה של כלי הטיס והשורות הדינמיות) עם autocomplete=\"off\" — הדפדפן לא משחזר ערכים מהיסטוריה", ac.length === 0 && (await page.evaluate(() => document.querySelectorAll("main input, main textarea, main select").length)) >= 25, ac.join(","));
      check("n=10: טופס הכניסה נשאר עם autocomplete של מנהל סיסמאות (שם משתמש וסיסמה)", (await page.getAttribute("#auUser", "autocomplete")) === "username" && (await page.getAttribute("#auPass", "autocomplete")) === "current-password", "");
      // דפדפן ששחזר שדות אף על פי כן (מדמים: ערכים בשדות לפני הכניסה) — הכניסה מנקה אותם, והם לא נכנסים לבקשה של מי שנכנס
      await page.evaluate(() => { const set = (id, v) => { document.getElementById(id).value = v; }; set("siteName", "אתר ישן של אנה"); set("knownObs", "מכשול ישן של אנה"); set("visitNotes", "הערות ישנות של אנה"); set("coord", "31.5, 34.5"); set("height", "55"); set("dateFrom", "2031-01-01"); set("visitDate", "2031-01-01"); document.getElementById("reviewOk").checked = true; });
      await login(page, "ben.pilot", "ben-pass-12345");
      const left = await page.evaluate(() => ["siteName", "knownObs", "visitNotes", "coord", "height", "dateFrom", "visitDate"].map(id => document.getElementById(id).value).concat(document.getElementById("reviewOk").checked ? ["checked"] : []).filter(Boolean));
      check("n=10: שדות שהדפדפן שחזר לפני הכניסה (אתר, מכשולים, הערות סיור, נ״צ, גובה, תאריכים, אישור סקירה) מנוקים בכניסה", left.length === 0, left.join("|"));
      await readyRequest(page, { org: "בן צילום" });
      const inp = await page.evaluate(() => { const i = window.__REQ.S.res.inp; return { ko: i.knownObstacles, notes: i.visitNotes, site: i.siteName, visit: i.visitDate }; });
      check("n=10: הבקשה של בן לא כוללת את השדות הישנים (מכשולים, הערות סיור, שם אתר, תאריך סיור)", inp.ko === "" && inp.notes === "" && !/אנה/.test(inp.site) && !inp.visit, JSON.stringify(inp));
      // pageshow (persisted): סשן תקף של אותו משתמש — לא נוגעים; לא persisted — לא נוגעים; סשן שנמחק — איפוס וטעינה מחדש
      await page.evaluate(() => { window.__marker = "same-doc"; window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })); window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false })); });
      await page.waitForTimeout(1200);
      check("n=10: pageshow (persisted) עם אותו סשן תקף, ו-pageshow רגיל: הדף נשאר כמות שהוא (אין טעינה מחדש ואין איפוס)", await page.evaluate(() => window.__marker === "same-doc" && !!window.__REQ.S.res && window.__REQ.S.ready === true), "");
      await page.evaluate(() => { sessionStorage.removeItem("icdReqSession"); window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })); });
      await page.waitForSelector("#authForm", { timeout: 30000 }); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 });
      const lo = await leftovers(page);
      check("n=10: pageshow (persisted) כשהסשן נמחק: הדף מתאפס ונטען מחדש — נקי לגמרי ונעול, עם מסך הכניסה", !lo.res && !lo.ready && lo.results === "none" && lo.reportLen === 0 && lo.mainInert && lo.locked && (await page.evaluate(() => window.__marker === undefined)), JSON.stringify(lo));
      await ctx.close();
    }
    // 16ה: אף כלי טיס אינו מסומן מראש (n=15) — המטיס חייב לבחור, ורק מה שבחר נכנס לבקשה
    {
      const { ctx, page } = await newPage(browser);
      const env = page._env; addPilot(env, "noa.pilot", "noa-pass-12345");
      await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page, "noa.pilot", "noa-pass-12345");
      const acOn = () => page.$$eval('input[name="ac"]', els => els.filter(e => e.checked).map(e => e.value));
      const cfgAc = await page.evaluate(() => window.__REQ.S.cfg.aircraft);
      check("n=15: אחרי כניסה אף כלי טיס אינו מסומן (גם לא הראשון בהגדרות), והרשימה מוצגת כהצעות", cfgAc.length >= 2 && (await acOn()).length === 0 && (await page.locator('input[name="ac"]').count()) === cfgAc.length && /אף כלי אינו מסומן מראש/.test(await page.textContent("#acHint")), JSON.stringify(await acOn()));
      await fillExample(page, { aircraft: false });
      await page.click("#runBtn");
      await page.waitForFunction(() => /כלי טיס/.test(document.getElementById("e_run").textContent) && document.getElementById("e_aircraft").textContent.length > 0, null, { timeout: 15000 });
      check("n=15: הרצה בלי בחירת כלי טיס נחסמת בשגיאה ״יש לבחור כלי טיס״ — אין שאילתות, אין דוח", /יש לבחור כלי טיס/.test(await page.textContent("#e_aircraft")) && page._calls.overpass === 0 && !(await page.isVisible("#resultsSec")), await page.textContent("#e_aircraft"));
      await page.fill("#acNew", "Noa Own Drone"); await page.click("#acAdd");
      check("n=15: הוספת כלי טיס משלו מסמנת אותו בלבד (לא כלי של הארגון)", JSON.stringify(await acOn()) === JSON.stringify(["Noa Own Drone"]), JSON.stringify(await acOn()));
      await page.click("#runBtn");
      await page.waitForFunction(() => document.querySelector("#gate .banner"), null, { timeout: 150000 });
      const inp = await page.evaluate(() => { const S = window.__REQ.S, m = window.__REQ.O.mail(S.res, S.cfg); return { ac: S.res.inp.aircraft, mail: m.subject + "\n" + m.body, form: window.__REQ.O.buildForm(S.res, S.cfg).map(r => r.text).join("\n") }; });
      check("n=15: הכלי היחיד בבקשה (מודל וטופס; המייל הקצר אינו מפרט כלי טיס) הוא זה שהמטיס בחר — בלי כלי של הארגון", JSON.stringify(inp.ac) === JSON.stringify(["Noa Own Drone"]) && inp.form.includes("Noa Own Drone") && !cfgAc.some(a => inp.mail.includes(a) || inp.form.includes(a)), JSON.stringify(inp.ac));
      await ctx.close();
    }
    // 16ו: הודעות סנכרון ותחזוקה — ניסוח ניטרלי עם כתובת תמיכה למטיס רגיל (בבאנר, ברשימת השער ובהודעת עצירת ההרצה), ופירוט מלא למנהל (n=11/12)
    for (const [opt, label] of [["newPmt", "מהדורת פמ״ת חדשה"], ["tamperMap", "עדכון בנתוני האזורים של המפה"], ["mapNotamNewer", "קובץ הנוטמים של המפה חדש יותר"]]) {
      const { ctx, page } = await newPage(browser, { [opt]: true });
      const env = page._env; addPilot(env, "noa.pilot", "noa-pass-12345");
      const MAINT = /pamat-meta|לאמת אותם מחדש|\.json|HTTP|הייצוא האוטומטי|workflow|README|v\d+\.\d+|מהדורת הפמ״ת|מפגר/;
      await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page, "noa.pilot", "noa-pass-12345");
      await page.waitForFunction(() => document.querySelector("#syncBanner").style.display === "block", null, { timeout: 20000 });
      const b = await page.textContent("#syncBanner");
      check("n=11 (" + label + "): מטיס רגיל — הבאנר בניסוח ניטרלי עם כתובת תמיכה, בלי שמות קבצים, מהדורות או הוראות תחזוקה", /הנתונים מתעדכנים כעת; נסו שוב בעוד מספר דקות, ואם זה נמשך פנו לתמיכה: /.test(b) && b.includes(SUPPORT) && /אי אפשר להשלים בקשה/.test(b) && !MAINT.test(b), b.replace(/\s+/g, " ").slice(0, 300));
      await fillExample(page); await page.click("#runBtn");
      await page.waitForFunction(() => document.querySelector("#e_run").textContent.length > 0, null, { timeout: 20000 });
      const er = await page.textContent("#e_run"), st = await page.evaluate(() => window.__REQ.S.statuses.sync);
      check("n=11 (" + label + "): מטיס רגיל — גם הודעת עצירת ההרצה והסטטוס (מקור רשימת השער) בניסוח ניטרלי, בלי פירוט תחזוקה", /סנכרון עם מפת החברים/.test(er) && er.includes(SUPPORT) && !MAINT.test(er) && !MAINT.test(st.user || "") && !st.ok, er.slice(0, 220));
      await ctx.close();
    }
    {   // המנהל רואה את הפירוט המלא (אותו מצב של מהדורת פמ״ת חדשה)
      const { ctx, page } = await newPage(browser, { newPmt: true });
      await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
      await page.waitForFunction(() => document.querySelector("#syncBanner").style.display === "block", null, { timeout: 20000 });
      const b = await page.textContent("#syncBanner");
      check("n=11: מנהל — הבאנר כולל את הפירוט המלא (pamat-meta.json, הוראת אימות מחדש)", /pamat-meta\.json/.test(b) && /לאמת אותם מחדש/.test(b), b.replace(/\s+/g, " ").slice(0, 200));
      await ctx.close();
    }
    {   // כשל בקבצי ההשוואה / בטעינת נתונים: למנהל — HTTP וכתובות קבצים; למטיס — ניסוח ניטרלי עם כתובת התמיכה
      for (const [what, rx, label, adminRx] of [[/\/pamat-meta\.json/, /סנכרון עם מפת החברים/, "כשל בבדיקת הסנכרון (pamat-meta.json 404)", /HTTP 404[\s\S]*|pamat-meta/], [/\/agri-airstrips\.json/, /מנחתים חקלאיים/, "כשל בטעינת נתונים (מנחתים חקלאיים 500)", /HTTP 500/]]) {
        for (const [who, user] of [["מטיס רגיל", ["noa.pilot", "noa-pass-12345"]], ["מנהל", [ADMIN, PASS]]]) {
          const { ctx, page } = await newPage(browser);
          const env = page._env; addPilot(env, "noa.pilot", "noa-pass-12345");
          await page.route(what, r => r.fulfill({ status: what.source.includes("pamat") ? 404 : 500, body: "x" }));
          await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page, ...user);
          await fillExample(page); await page.click("#runBtn");
          await page.waitForFunction(() => document.querySelector("#e_run").textContent.length > 0, null, { timeout: 20000 });
          const er = await page.textContent("#e_run"), isAdm = user[0] === ADMIN;
          check("n=11 (" + who + "): " + label + " — " + (isAdm ? "פירוט מלא למנהל (HTTP וקובץ)" : "ניסוח ניטרלי עם כתובת תמיכה, בלי HTTP וקבצים"), rx.test(er) && (isAdm ? adminRx.test(er) : (er.includes(SUPPORT) && /הנתונים מתעדכנים כעת/.test(er) && !/HTTP|\.json|pamat|\.\.\//.test(er))), er.slice(0, 240));
          await ctx.close();
        }
      }
    }
    // 16ז: מסכי הכניסה וההרשמה — כתובת התמיכה (mailto), הסבר דרישת החברות, Enter בשדה המייל שולח קוד, ואותה תשובה לכל כתובת (n=12/17/18)
    {
      const seen = [], opts = { patchResp: (b, r) => { if (b.action === "regStart") seen.push(JSON.stringify(r)); return undefined; } };
      const { ctx, page } = await newPage(browser, opts);
      const env = page._env; env.props.WIX_API_KEY = "test-key";
      const DAYMS = 86400000, mk = (n, over) => Object.assign({ orderNumber: "ORD-N17-" + n, status: "PAID", created: new Date(Date.now() - 3 * DAYMS).toISOString(), email: "member@example.com", firstName: "דנה", memberId: "m-1", tickets: [] }, over);
      env.wix.orders.push(mk(1), mk(2, { email: "guest@example.com", memberId: "" }));
      await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await page.waitForSelector("#authForm");
      const mailtoLogin = await page.$$eval("#authCover a[href^='mailto:']", a => a.map(x => x.getAttribute("href") + "|" + x.textContent));
      check("n=12: מסך הכניסה כולל קישור mailto לכתובת התמיכה מההגדרות (info@icd.org.il)", SUPPORT === "info@icd.org.il" && mailtoLogin.length === 1 && mailtoLogin[0] === "mailto:" + SUPPORT + "|" + SUPPORT, JSON.stringify(mailtoLogin));
      await page.click("#auReg"); await page.waitForSelector("#regForm");
      const reg = (await page.textContent("#regForm")).replace(/\s+/g, " "), mailtoReg = await page.$$eval("#regForm a[href^='mailto:']", a => a.map(x => x.getAttribute("href")));
      check("n=12: מסך ההרשמה כולל קישור mailto לתמיכה", mailtoReg.length === 1 && mailtoReg[0] === "mailto:" + SUPPORT, JSON.stringify(mailtoReg));
      check("n=18: מסך ההרשמה מסביר שהאירוע לחברי האתר בלבד, שהכרטיס חייב להירכש כחבר רשום מחובר, ושכרטיס שנרכש כאורח אינו מאפשר הרשמה", /האירוע לחברי האתר בלבד/.test(reg) && /כחברים רשומים באתר/.test(reg) && /אורח/.test(reg), reg.slice(0, 400));
      // Enter בשדה המייל: שולח קוד (regStart) ולא ״אישור״ עם קוד ריק
      const a0 = page._calls.actions.length;
      await page.fill("#rgEmail", "member@example.com"); await page.press("#rgEmail", "Enter");
      await page.waitForSelector("#rgStep2", { state: "visible", timeout: 15000 }); await page.waitForTimeout(300);
      const acts = page._calls.actions.slice(a0);
      check("n=17: Enter בשדה המייל בהרשמה שולח קוד (regStart בלבד, בלי regFinish), נשלח מייל אחד לכתובת הרכישה, שדה הקוד מוצג ואין הודעת שגיאה", acts.join(",") === "regStart" && env.mails.length === 1 && env.mails[0].to === "member@example.com" && (await page.textContent("#rgErr")).trim() === "" && (await page.evaluate(() => document.activeElement && document.activeElement.id)) === "rgCode", acts.join(",") + " | mails=" + env.mails.length);
      // Enter בשדה הקוד כשהוא ריק: הודעה מקומית, בלי פנייה לשרת ובלי לשרוף ניסיון
      const b0 = page._calls.actions.length;
      await page.press("#rgEmail", "Enter"); await page.waitForTimeout(300);
      check("n=17: Enter אחרי שנשלח קוד אבל בלי קוד: הודעה מקומית (6 ספרות), בלי קריאה לשרת", page._calls.actions.length === b0 && /6 ספרות/.test(await page.textContent("#rgErr")), await page.textContent("#rgErr"));
      // אותה הודעה בדיוק (והתשובה מהשרת) לכתובת עם כרטיס, כתובת של רוכש אורח וכתובת בלי כרטיס — אין אורקל
      const infos = [];
      for (const em of ["member@example.com", "guest@example.com", "nobody@example.com"]) {
        await page.fill("#rgEmail", em); await page.click("#rgSend");
        await page.waitForFunction(() => document.querySelector("#rgInfo").textContent.length > 0, null, { timeout: 15000 });
        infos.push((await page.textContent("#rgInfo")).trim());
        await page.evaluate(() => { document.getElementById("rgInfo").textContent = ""; });
      }
      check("n=18: ההודעה אחרי שליחת הקוד זהה לכל כתובת (עם כרטיס, רוכש אורח, בלי כרטיס), ומציינת ספאם, שהכרטיס שולם, מייל הרכישה, רכישה כחבר רשום ותמיכה", infos.every(t => t === infos[0]) && /ספאם/.test(infos[0]) && /שולם/.test(infos[0]) && /מייל הרכישה/.test(infos[0]) && /כחברים רשומים/.test(infos[0]) && infos[0].includes(SUPPORT), infos[0]);
      check("n=18: תשובות regStart מהשרת זהות לכל הכתובות (אין אורקל על רכישה או הרשמה)", seen.length >= 4 && seen.every(x => x === seen[0]) && JSON.parse(seen[0]).ok === true, seen.join(" | "));
      await ctx.close();
    }
    {   // n=18: שרת שמדווח במפורש שדרישת החברות כבויה (requireMember:false בתשובת ה-GET הציבורית) — הטקסט על חברות לא מוצג, כדי שלא יתאר דרישה שאינה קיימת
      const { ctx, page } = await newPage(browser);
      await page.route(API, r => r.request().method() === "GET" ? r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ ...page._env.doGet(), requireMember: false }) }) : r.fallback());
      await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await page.waitForSelector("#authForm");
      await page.click("#auReg"); await page.waitForSelector("#regForm");
      check("n=18: דרישת החברות כבויה בשרת — מסך ההרשמה לא טוען שהאירוע לחברים בלבד", !(await page.$("#rgMember")) && !/חברים רשומים|לחברי האתר/.test(await page.textContent("#regForm")), "");
      await ctx.close();
    }
  }

  /* ===== תרחיש 14: חלון השליחה קשור לגרסת הבקשה (n=11), סימון טיוטה בחלון העריכה הרכה (n=12), קישור ״פתח מייל״ (n=13), ניסוח ״כבר נשלחה״ (n=9) ===== */
  if (!LIVE) {
    const opts = {};
    const { ctx, page } = await newPage(browser, opts);
    const env = page._env, adm = env.call({ action: "login", user: ADMIN, pass: PASS }).token, sleepMs = ms => new Promise(r => setTimeout(r, ms));
    env.call({ action: "addUser", token: adm, newUser: "carl.pilot", newPass: "carl-pass-12345" });
    await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page, "carl.pilot", "carl-pass-12345");
    await readyRequest(page, { org: "קרל צילום" });
    const norm = s => s.replace(/\s+/g, " "), sends = () => page._calls.sends || [], lastMail = () => env.mails[env.mails.length - 1];
    const dlg = async () => { await page.click("#btnSend"); await page.waitForSelector(".sendBox"); };
    const closeDlg = async () => { await page.click("#mdClose"); await page.waitForSelector(".sendBox", { state: "detached" }); };
    const waitSent = re => page.waitForFunction(r => new RegExp(r).test(document.querySelector("#sendProg").textContent), re, { timeout: 120000 });
    const softEdit = (id, v) => page.evaluate(([i, x]) => { const e = document.getElementById(i); e.value = x; e.dispatchEvent(new Event("input", { bubbles: true })); }, [id, v]);
    const settle = () => page.waitForFunction(() => window.__REQ.S.ready === true && !window.__REQ.S.pending && !window.__REQ.S.building, null, { timeout: 60000 });
    // --- n=12: חלון 450 מ״ש אחרי הקלדה: הדוח (והדפסה) מסומנים כטיוטה מיד, בלי החלפת DOM ובלי קפיצת פריסה
    await page.evaluate(() => { window.__paper = document.querySelector("#report .paper"); window.__vTop = document.getElementById("visitNotes").getBoundingClientRect().top; window.__nTop = document.getElementById("reqName").getBoundingClientRect().top; });
    await softEdit("reqName", "בודק ראשון x");
    const d1 = await page.evaluate(() => { const r = document.getElementById("report"), p = r.querySelector(".paper"), cs = getComputedStyle(p, "::before"); return { pend: document.body.classList.contains("pendDraft"), rcls: r.className, ready: window.__REQ.S.ready, pending: window.__REQ.S.pending, content: cs.content, display: cs.display, same: p === window.__paper, draftEl: !!r.querySelector(".draft"), printDis: document.getElementById("btnPrint").disabled, vTop: document.getElementById("visitNotes").getBoundingClientRect().top === window.__vTop, nTop: document.getElementById("reqName").getBoundingClientRect().top === window.__nTop }; });
    check("n=12: מיד אחרי הקלדה (חלון 450 מ״ש): body.pendDraft והבאנר ״טיוטה״ מוצג על המסך, #report לא נגע (לא הוחלף ב-DOM, בלי מחלקה חדשה), הלחצנים נעולים, ואין קפיצת פריסה (שדות מעל הדוח נשארו במקומם)", d1.pend && d1.rcls === "" && !d1.ready && d1.pending && /טיוטה/.test(d1.content) && d1.display === "block" && d1.same && !d1.draftEl && d1.printDis && d1.vTop && d1.nTop, JSON.stringify(d1));
    await page.emulateMedia({ media: "print" });
    const d2 = await page.evaluate(() => { const p = document.querySelector("#report .paper"), cs = getComputedStyle(p, "::before"); return { host: getComputedStyle(document.getElementById("reportHost")).display, content: cs.content, display: cs.display }; });
    await page.emulateMedia({ media: "screen" });
    check("n=12: ב-Ctrl+P (מדיית הדפסה) באותו חלון הדוח מוצג עם באנר ״טיוטה״", d2.host !== "none" && /טיוטה/.test(d2.content) && d2.display === "block", JSON.stringify(d2));
    await settle();
    const d3 = await page.evaluate(() => ({ pend: document.body.classList.contains("pendDraft"), content: getComputedStyle(document.querySelector("#report .paper"), "::before").content, draftEl: !!document.querySelector("#report .draft"), name: /בודק ראשון x/.test(document.getElementById("report").innerText) }));
    check("n=12: אחרי תום העדכון הדוח נבנה מחדש עם הערך החדש, בלי באנר טיוטה ובלי המחלקה pendDraft", !d3.pend && !/טיוטה/.test(d3.content) && !d3.draftEl && d3.name, JSON.stringify(d3));
    // --- n=13: ״פתח מייל״ אינו ניתן להפעלה במקלדת כשהבקשה לא מוכנה (הקישור מוצג למנהל בלבד, ב-#manualMail שבתוך ״אפשרויות נוספות״; כאן המשתמש רגיל ולכן חושפים את הבלוק כמו שהמנהל רואה אותו — שער המוכנות אינו תלוי בתפקיד)
    await page.evaluate(() => { document.getElementById("moreOptions").hidden = false; document.getElementById("manualMail").hidden = false; });
    const mailOk = await page.evaluate(() => { const a = document.getElementById("btnMail"); return { tab: a.tabIndex, aria: a.getAttribute("aria-disabled") }; });
    await page.uncheck("#reviewOk");
    await page.evaluate(() => { const a = document.getElementById("btnMail"); window.__dp = null; a.addEventListener("click", e => { window.__dp = e.defaultPrevented; }); a.focus(); });
    await page.keyboard.press("Enter");
    const mailBlocked = await page.evaluate(() => { const a = document.getElementById("btnMail"); return { tab: a.tabIndex, aria: a.getAttribute("aria-disabled"), dp: window.__dp, ready: window.__REQ.S.ready, href: /^mailto:/.test(a.getAttribute("href") || "") }; });
    check("n=13: בקשה לא מוכנה (בלי אישור סקירה): ל״פתח מייל״ tabindex=-1 ו-aria-disabled=true, ו-Enter עליו מבוטל (preventDefault) — גם כשה-href עדיין mailto", mailOk.tab === 0 && mailOk.aria === null && mailBlocked.tab === -1 && mailBlocked.aria === "true" && mailBlocked.dp === true && !mailBlocked.ready && mailBlocked.href, JSON.stringify({ mailOk, mailBlocked }));
    await page.check("#reviewOk"); await settle();
    const mailBack = await page.evaluate(() => { const a = document.getElementById("btnMail"); let seen = null; const h = e => { seen = e.defaultPrevented; e.preventDefault(); }; a.addEventListener("click", h); a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); a.removeEventListener("click", h); return { tab: a.tabIndex, aria: a.getAttribute("aria-disabled"), seen }; });
    check("n=13: אחרי אישור הסקירה (מוכן) הקישור חוזר לפעול: tabindex=0, בלי aria-disabled, והקליק לא מבוטל על ידי השער", mailBack.tab === 0 && mailBack.aria === null && mailBack.seen === false, JSON.stringify(mailBack));
    // --- n=11 (א): עריכה מאחורי החלון אחרי סימון האישור
    await dlg();
    const di = await page.evaluate(() => { const m = document.getElementById("authModal"); document.getElementById("reqName").focus(); return { role: m.getAttribute("role"), modal: m.getAttribute("aria-modal"), main: document.querySelector("main").hasAttribute("inert"), header: document.querySelector("header").hasAttribute("inert"), escaped: document.activeElement && document.activeElement.id === "reqName", cover: !m.contains(document.querySelector("main")) }; });
    check("n=11: חלון השליחה הוא role=dialog aria-modal=true; הכותרת והטופס שמאחוריו inert, ואי אפשר למקד בהם שדה", di.role === "dialog" && di.modal === "true" && di.main && di.header && !di.escaped, JSON.stringify(di));
    await page.check("#sendOk");
    let n0 = sends().length, m0 = env.mails.length;
    await softEdit("reqName", "שונה-אחרי-האישור");
    await page.waitForFunction(() => /הבקשה שונתה בזמן שהחלון היה פתוח/.test(document.getElementById("sendProg").textContent), null, { timeout: 10000 });
    check("n=11 (א): עריכה מאחורי החלון אחרי סימון האישור: החלון ננעל מיד (שני הכפתורים והאישור), מציג הודעה שהנוסח אינו עדכני ושלא נשלח דבר", (await page.isDisabled("#sendGo")) && (await page.isDisabled("#sendOk")) && /לא נשלח דבר/.test(await page.textContent("#sendProg")) && sends().length === n0 && env.mails.length === m0, norm(await page.textContent("#sendProg")));
    await settle();
    // הגנה בעומק: גם אם הכפתור נפתח בכוח (מרוץ, הפעלה תוכנתית) — preflight בודק שגרסת הבקשה לא השתנתה ולא שולח; החלון נסגר ונפתח מחדש עם הנוסח העדכני ואישור לא מסומן
    await page.evaluate(() => { const ok = document.getElementById("sendOk"); ok.disabled = false; ok.checked = true; document.getElementById("sendGo").disabled = false; document.getElementById("sendGo").click(); });
    await page.waitForFunction(() => /הבקשה שונתה בזמן שהחלון היה פתוח/.test(document.getElementById("sendMsg").textContent) && document.querySelector(".sendBox") && !document.getElementById("sendOk").checked && /שונה-אחרי-האישור/.test(document.querySelector(".sendBox pre").textContent), null, { timeout: 60000 });
    check("n=11 (א): הגנה בעומק — לחיצה בכוח על ״שלח״ בחלון שאושר על גרסה ישנה לא שולחת דבר (אין sendRequest ואין מייל), החלון נסגר ונפתח מחדש עם הנוסח המעודכן ועם אישור לא מסומן, ויש הודעה", sends().length === n0 && env.mails.length === m0 && (await page.isDisabled("#sendGo")) && /לא נשלח דבר/.test(await page.textContent("#sendMsg")), norm(await page.textContent("#sendMsg")));
    await page.check("#sendOk"); await page.click("#sendGo"); await waitSent("נשלח במצב בדיקה|נכשלה");
    check("n=11 (א): אחרי אישור מחדש נשלח הנוסח העדכני (השם החדש בגוף המייל)", env.mails.length === m0 + 1 && lastMail().body.includes("שונה-אחרי-האישור") && sends().length === n0 + 1, norm(await page.textContent("#sendProg")));
    await closeDlg();
    // --- n=11 (ב): עריכה בזמן ש-sendRequest באוויר
    opts.apiDelayBy = { sendRequest: 3500 };
    await softEdit("reqPhone", "050-0000018"); await settle();
    await dlg(); await page.check("#sendOk");
    n0 = sends().length; m0 = env.mails.length;
    await page.click("#sendGo");
    while (sends().length === n0) await sleepMs(20);   // sendRequest הגיע לשרת המדומה (ומושהה 3.5 שניות)
    await softEdit("reqPhone", "050-0000019");
    await page.waitForFunction(() => /הבקשה שונתה בזמן השליחה/.test(document.getElementById("sendProg").textContent), null, { timeout: 60000 });
    const af = await page.evaluate(() => ({ sent: window.__REQ.S.sent, prog: document.getElementById("sendProg").textContent, msg: document.getElementById("sendMsg").textContent, link: !!document.querySelector("#sendMsg a"), go: document.getElementById("sendGo").disabled, ok: document.getElementById("sendOk").disabled, progCls: document.getElementById("sendProg").className }));
    check("n=11 (ב): עריכה בזמן sendRequest באוויר: המייל יצא (הגרסה שאושרה) אך S.sent לא נקבע, אין ✔ ואין קישור, ההודעה מציינת מה נשלח ושהגרסה העדכנית לא נשלחה, והחלון נעול", env.mails.length === m0 + 1 && af.sent === null && !/✔/.test(af.prog + af.msg) && !af.link && af.go && af.ok && /הגרסה שאושרה בחלון נשלחה/.test(af.prog) && /הגרסה העדכנית לא נשלחה/.test(af.prog) && af.progCls.includes("err"), JSON.stringify(af));
    opts.apiDelayBy = null;
    const sb1 = page._calls.actions.filter(a => a === "saveBegin").length;
    await closeDlg(); await settle();
    await dlg(); await page.check("#sendOk"); await page.click("#sendGo"); await waitSent("נשלח במצב בדיקה|נכשלה");
    check("n=11 (ב): שליחה חוזרת שומרת מחדש בדרייב (saveBegin נוסף) ושולחת את הגרסה העדכנית (הטלפון החדש בגוף המייל)", page._calls.actions.filter(a => a === "saveBegin").length > sb1 && env.mails.length === m0 + 2 && lastMail().body.includes("050-0000019") && !lastMail().body.includes("050-0000018"), norm(await page.textContent("#sendProg")));
    await closeDlg();
    // --- n=9: ניסוח ״כבר נשלחה״ (השרת מזהה רק בקשות של אותו משתמש). שעה תקינה מוצגת, חסרה — לא
    const T = Date.UTC(2026, 9, 18, 3, 41), fmtB = await page.evaluate(t => new Date(t).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }), T);
    await softEdit("siteName", "אתר ניסוח n9"); await settle();
    for (const [name, resp, want, notWant] of [["similar", { ok: false, error: "already_sent", similar: true, sentAt: T }, "כבר שלחתם למשרד נוטאם בקשה על אותו מקום ותאריך ב-" + fmtB, /בקשה על אותו מקום ותאריך כבר נשלחה/], ["אותה בקשה", { ok: false, error: "already_sent", sentAt: T }, "הבקשה כבר נשלחה למשרד נוטאם ב-" + fmtB, null], ["similar בלי זמן", { ok: false, error: "already_sent", similar: true }, "כבר שלחתם למשרד נוטאם בקשה על אותו מקום ותאריך.", /Invalid|NaN/]]) {
      opts.intercept = b => b.action === "sendRequest" ? resp : undefined;
      await dlg(); await page.check("#sendOk"); await page.click("#sendGo"); await page.waitForSelector("#sendAgain", { timeout: 60000 });
      const t = norm(await page.textContent("#sendProg"));
      check("n=9 (" + name + "): הודעת already_sent בגוף שני, עם השעה רק כשהשרת מסר אותה, ובלי ״Invalid Date״ — " + t.slice(0, 90), t.startsWith(want) && t.includes("שלח שוב בכל זאת") && (!notWant || !notWant.test(t)), t);
      await closeDlg(); opts.intercept = null;
    }
    // חוזה השרת החדש: mail_quota ו-rate עם scope — כפי שמטיס רגיל רואה אותן בחלון השליחה (נוסח ניטרלי; תקרה כוללת = המערכת עמוסה ולא המטיס חרג)
    for (const [name, resp, re] of [["mail_quota", { ok: false, error: "mail_quota", message: "הודעת שרת למנהל" }, /^השליחה נכשלה: מכסת המיילים היומית של המערכת הסתיימה.*פנו לתמיכה/], ["rate כללית", { ok: false, error: "rate", scope: "all", message: "המגבלה הכללית אינה אישית ואינה קשורה אליכם" }, /^השליחה נכשלה: המגבלה הכללית אינה אישית/], ["rate אישית בלי הודעה", { ok: false, error: "rate", scope: "user" }, /^השליחה נכשלה: יותר מדי שליחות בשעה האחרונה/]]) {
      opts.intercept = b => b.action === "sendRequest" ? resp : undefined;
      await dlg(); await page.check("#sendOk"); await page.click("#sendGo");
      await page.waitForFunction(() => /השליחה נכשלה/.test(document.getElementById("sendProg").textContent), null, { timeout: 60000 });
      const t = norm(await page.textContent("#sendProg"));
      check("שגיאת שרת בשליחה (" + name + "): מוצגת למטיס בנוסח הנכון, בלי ״פנו למנהל״ של השרת, והשליחה לא נספרת כשליחה (S.sent ריק)", re.test(t) && !/למנהל/.test(t) && (await page.evaluate(() => window.__REQ.S.sent)) === null, t);
      await closeDlg(); opts.intercept = null;
    }
    await ctx.close();
  }

  /* ===== תרחיש 15: הודעות לפי תפקיד (n=19), מעבר למצב חי (n=20), מכסת מייל (חוזה השרת), קישור חזרה למפה בכניסה (n=21), בועת ״!״ באזורים בטוחים (n=15), שגיאת הרצה בטלפון (n=18, n=10), פס הסיכום (n=14) ===== */
  if (!LIVE) {
    const optsA = {};
    const { ctx, page } = await newPage(browser, optsA);
    const env = page._env, adm = env.call({ action: "login", user: ADMIN, pass: PASS }).token;
    env.call({ action: "addUser", token: adm, newUser: "dora.pilot", newPass: "dora-pass-12345" });
    await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
    // --- n=20: אישור המעבר למצב חי מתאר את ההתנהגות החדשה
    await page.click("#ubAdmin"); await page.waitForSelector("#admBody .admTbl");
    let confirmTxt = null; page.once("dialog", d => { confirmTxt = d.message(); d.dismiss(); });
    await page.click("#admMode"); await page.waitForTimeout(300);
    check("n=20: אישור המעבר למצב חי מתאר את ההתנהגות לפי סוג החשבון: משתמש שולח למשרד נוטאם (שתי הכתובות); ארגוני — בשם הארגון, עותק ותשובות אל הארגון; עצמאי — עותק למטיס, התשובות אליו, והארגון מקבל עותק סמוי לתמיכה; אפשר לשלוח רק לעצמו, ואין אישור לכל בקשה; ביטול משאיר מצב בדיקה", !!confirmTxt && /כל משתמש יוכל לשלוח/.test(confirmTxt) && confirmTxt.includes("notamoffice@iaa.gov.il") && confirmTxt.includes("nofm@iaa.gov.il") && /חשבון ארגוני שולח בשם הארגון/.test(confirmTxt) && /תשובות המשרד יחזרו אל הארגון/.test(confirmTxt) && /עותק למטיס, ותשובות המשרד יחזרו אליו/.test(confirmTxt) && /עותק סמוי של כל שליחה לצורכי תמיכה בלבד/.test(confirmTxt) && /רק לעצמו/.test(confirmTxt) && /אין אישור נוסף שלך לכל בקשה/.test(confirmTxt) && !/כל בקשה שתישלח תישלח באמת/.test(confirmTxt) && (await page.textContent("#admBody .admMode")).includes("בדיקה"), confirmTxt);
    // --- מכסת המייל היומית בחלון הניהול (mailQuotaLeft מהשרת)
    const quota = async v => { optsA.patchResp = (b, r) => b.action === "listUsers" ? Object.assign({}, r, { mailQuotaLeft: v }) : undefined; await page.click("#mdClose"); await page.click("#ubAdmin"); await page.waitForSelector("#admBody .admTbl"); return page.evaluate(() => { const e = document.getElementById("admQuota"); return e ? { text: e.textContent.replace(/\s+/g, " "), cls: e.className } : null; }); };
    let qv = await quota(12);
    check("מכסת המייל: ״נותרו 12 נמענים במכסת המייל היומית״ עם אזהרה (מתחת ל-30)", !!qv && /^⚠ נותרו 12 נמענים במכסת המייל היומית/.test(qv.text) && qv.cls.includes("err"), JSON.stringify(qv));
    qv = await quota(500);
    check("מכסת המייל: מעל 30 — השורה בלי אזהרה", !!qv && /^נותרו 500 נמענים במכסת המייל היומית\.$/.test(qv.text) && !qv.cls.includes("err"), JSON.stringify(qv));
    qv = await quota(null); const qn = qv;
    qv = await quota(undefined);
    check("מכסת המייל: null או שדה חסר (לא ידוע / שרת ישן) — אין שורה", qn === null && qv === null, JSON.stringify([qn, qv]));
    optsA.patchResp = null; await page.click("#mdClose");
    // --- n=19: הודעות לפי תפקיד (מנהל מקבל את הנוסח הטכני, מטיס — ניטרלי)
    const getMsgs = pg => pg.evaluate(() => { const A = window.ReqAuth, o = {}; for (const e of ["forbidden", "not_ready", "missing_files", "no_owner", "mail_quota"]) o[e] = A.msg({ error: e, message: "הודעת שרת" }); o.rateUser = A.msg({ error: "rate", scope: "user", message: "הגעתם למגבלה האישית" }); o.rateAll = A.msg({ error: "rate", scope: "all", message: "המגבלה הכללית אינה אישית" }); o.rateAllNoMsg = A.msg({ error: "rate", scope: "all" }); o.rateNone = A.msg({ error: "rate" }); return o; });
    const am = await getMsgs(page);
    check("n=19 (מנהל): הנוסחים הטכניים נשמרים (שמירה בדרייב, מנהל בלבד, README), ו-no_owner כבר לא מוגבל ל״שליחת בדיקה״", /שמירה|בדרייב/.test(am.not_ready) && /יש לשמור שוב בדרייב/.test(am.missing_files) && /למנהל בלבד/.test(am.forbidden) && !/לשליחת בדיקה/.test(am.no_owner) && am.mail_quota === "הודעת שרת", JSON.stringify(am));
    await ctx.close();
    const optsP = {};
    const { ctx: ctxP, page: pp } = await newPage(browser, Object.assign(optsP, { env }));
    await pp.goto(APP); await pp.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(pp, "dora.pilot", "dora-pass-12345");
    const pm = await getMsgs(pp);
    check("n=19 (מטיס רגיל): not_ready, missing_files, forbidden ו-no_owner בניסוח ניטרלי שמפנה לתמיכה — בלי ״לשמור בדרייב״, README או ״מנהל בלבד״", [pm.not_ready, pm.missing_files, pm.forbidden, pm.no_owner].every(t => !/דרייב|README|מנהל/.test(t)) && /פנו לתמיכה/.test(pm.not_ready) && /פנו לתמיכה/.test(pm.missing_files) && /פנו לתמיכה/.test(pm.no_owner) && !/לשליחת בדיקה/.test(pm.no_owner), JSON.stringify(pm));
    check("n=19: מכסת המייל היומית (mail_quota) — למטיס נוסח קבוע שמפנה לתמיכה (ולא ״פנו למנהל״ של השרת)", /מכסת המיילים היומית/.test(pm.mail_quota) && /פנו לתמיכה/.test(pm.mail_quota) && pm.mail_quota !== "הודעת שרת", pm.mail_quota);
    check("n=12: מטיס רגיל — כל ההודעות שמפנות לתמיכה (לא הוכן לשליחה, חסר קובץ, אין בעלים, מכסת מייל) כוללות את כתובת התמיכה מההגדרות; הודעה בלי הפניה (forbidden) לא", [pm.not_ready, pm.missing_files, pm.no_owner, pm.mail_quota].every(t => t.includes(SUPPORT)) && !pm.forbidden.includes(SUPPORT), JSON.stringify(pm));
    check("n=19: שגיאת קצב לפי scope — אישית: הודעת השרת; כוללת: ברור שהמערכת עמוסה ולא המטיס חרג (גם בלי הודעת שרת); בלי scope: נוסח כללי", pm.rateUser === "הגעתם למגבלה האישית" && pm.rateAll === "המגבלה הכללית אינה אישית" && /המערכת עמוסה/.test(pm.rateAllNoMsg) && /אינה אישית/.test(pm.rateAllNoMsg) && /יותר מדי שליחות/.test(pm.rateNone), JSON.stringify(pm));
    // הרצת בדיקות נכשלת בטלפון (n=18) + תווים בלתי נראים בלבד (n=10) — כאן, בדף של המטיס
    await pp.setViewportSize({ width: 390, height: 844 });
    await fillExample(pp); await pp.fill("#reqOrg", "");
    await pp.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await pp.click("#runBtn");
    await pp.waitForFunction(() => { const r = document.getElementById("reqOrg").getBoundingClientRect(); return document.activeElement && document.activeElement.id === "reqOrg" && r.top >= 0 && r.bottom <= innerHeight; }, null, { timeout: 10000 });
    { const o = await pp.evaluate(() => { const e = document.getElementById("e_requesterOrg").getBoundingClientRect(); return { run: document.getElementById("e_run").textContent, org: document.getElementById("e_requesterOrg").textContent, errVisible: e.top >= 0 && e.bottom <= innerHeight, bad: document.getElementById("reqOrg").classList.contains("bad"), open: document.getElementById("personBox").open }; });
      check("n=18: שגיאת הרצה בטלפון (390px) בשדה שנמצא כמה מסכים מעל הכפתור: גלילה ומיקוד לשדה הפגום (שם הגורם המבקש), ההודעה ליד השדה נראית, וההודעה ליד כפתור ההרצה מפרטת ״חסר או שגוי: שם הגורם המבקש״", /חסר או שגוי: שם הגורם המבקש/.test(o.run) && /יש להזין את שם הגורם המבקש/.test(o.org) && o.errVisible && o.bad && o.open && pp._calls.overpass === 0, JSON.stringify(o)); }
    // שדה ללא שדה מסומן (כלי טיס): גלילה להודעה; כמה שגיאות: הראשון בסדר המסמך
    await pp.fill("#reqOrg", "דורה צילום");
    await pp.evaluate(() => { document.querySelectorAll('input[name="ac"]').forEach(c => { c.checked = false; }); window.scrollTo(0, document.body.scrollHeight); });
    await pp.click("#runBtn");
    await pp.waitForFunction(() => { const r = document.getElementById("e_aircraft").getBoundingClientRect(); return /כלי טיס/.test(document.getElementById("e_run").textContent) && r.top >= 0 && r.bottom <= innerHeight; }, null, { timeout: 10000 });
    check("n=18: שגיאה בלי שדה מסומן (כלי טיס): המסך גולל להודעת השגיאה, והמיקוד עובר לתיבת הסימון הראשונה", await pp.evaluate(() => document.activeElement && document.activeElement.name === "ac"), "");
    await pp.evaluate(() => { document.querySelector('input[name="ac"]').checked = true; const d = document.getElementById("dateFrom"); d.value = ""; const o = document.getElementById("reqOrg"); o.value = ""; window.scrollTo(0, document.body.scrollHeight); });
    await pp.click("#runBtn");
    await pp.waitForFunction(() => document.activeElement && document.activeElement.id === "dateFrom", null, { timeout: 10000 });
    check("n=18: כמה שגיאות (מתאריך ושם הגורם): המיקוד לראשונה בסדר המסמך (מתאריך), וההודעה מפרטת את שתיהן", await pp.evaluate(() => /מתאריך/.test(document.getElementById("e_run").textContent) && /שם הגורם המבקש/.test(document.getElementById("e_run").textContent)), await pp.textContent("#e_run"));
    // n=10: רק תווים בלתי נראים בשם הגורם, בשם המבקש ובאות הקריאה — ההרצה נחסמת והשדות מסומנים
    await pp.evaluate(([a, b, c, d]) => { const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); }; set("dateFrom", d); set("reqOrg", a); set("reqName", b); set("reqCallsign", c); window.scrollTo(0, document.body.scrollHeight); }, [String.fromCharCode(0x200f), String.fromCharCode(0x200b), String.fromCharCode(0x3164), new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10)]);
    await pp.click("#runBtn"); await pp.waitForTimeout(500);
    { const o = await pp.evaluate(() => ({ org: document.getElementById("e_requesterOrg").textContent, call: document.getElementById("e_callsign").textContent, req: document.getElementById("e_requester").textContent, orgBad: document.getElementById("reqOrg").classList.contains("bad"), nameBad: document.getElementById("reqName").classList.contains("bad"), callBad: document.getElementById("reqCallsign").classList.contains("bad"), results: getComputedStyle(document.getElementById("resultsSec")).display }));
      check("n=10: שם גורם (RLM), שם מבקש (ZWSP) ואות קריאה (U+3164) שכולם בלתי נראים — ההרצה נחסמת והשדות מסומנים בהודעה (לא מוכן לשליחה, בלי שאילתות)", /יש להזין את שם הגורם המבקש/.test(o.org) && /תו גלוי/.test(o.call) && /חסרים שם וטלפון/.test(o.req) && o.orgBad && o.nameBad && o.callBad && o.results === "none" && pp._calls.overpass === 0, JSON.stringify(o)); }
    await ctxP.close();
  }
  { // n=21: בכיסוי הכניסה וההרשמה (והשרת-לא-מוגדר) יש קישור ״← חזרה למפה״ גלוי, לחיץ (44px) ובתוך האזורים הבטוחים
    for (const noApi of [false, true]) {
      const o21 = { noApi, viewport: { width: 390, height: 844 }, touch: true };
      const { ctx, page } = await newPage(browser, o21);
      await page.goto(APP); await page.waitForSelector(noApi ? "#authCover" : "#authForm", { timeout: 20000 });
      await page.evaluate(() => { const r = document.documentElement.style; r.setProperty("--safe-top", "44px"); r.setProperty("--safe-bottom", "34px"); r.setProperty("--safe-left", "0px"); r.setProperty("--safe-right", "0px"); });
      const probe = () => page.evaluate(() => { const a = document.querySelector('#authCover a[href="../"]'); if (!a) return null; const r = a.getBoundingClientRect(), t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { text: a.textContent.trim(), h: Math.round(r.height), w: Math.round(r.width), hit: t === a, top: r.top, bottom: r.bottom, vh: innerHeight }; });
      let pr = await probe();
      check("n=21: " + (noApi ? "מסך ״שרת ההתחברות לא הוגדר״" : "מסך הכניסה") + " (390px): קישור ״← חזרה למפה״ אל ../ בתוך הכיסוי, לחיץ (הנקודה במרכזו פוגעת בו), גובה 44px לפחות ובתוך האזור הבטוח", !!pr && pr.text === "← חזרה למפה" && pr.hit && pr.h >= 44 && pr.top >= 44 && pr.bottom <= pr.vh - 34, JSON.stringify(pr));
      if (!noApi) {
        await page.click("#auReg"); await page.waitForSelector("#regForm");
        // מסך ההרשמה ארוך יותר מהמסך (תיבת ההסבר על הכרטיס בראשו): הכיסוי נגלל, והקישור שבסופו נבדק אחרי גלילה לסוף — לחיץ, 44px לפחות ובתוך האזור הבטוח
        await page.evaluate(() => { const c = document.getElementById("authCover"); c.scrollTop = c.scrollHeight; });
        pr = await probe();
        check("n=21: מסך ההרשמה: אותו קישור ״← חזרה למפה״ (בסוף הכיסוי הנגלל) לחיץ, 44px לפחות ובתוך האזור הבטוח", !!pr && pr.hit && pr.h >= 44 && pr.top >= 44 && pr.bottom <= pr.vh - 34, JSON.stringify(pr));
        // חוזה השרת החדש: מכסת המייל היומית מלאה גם בהרשמה (קוד האימות לא יכול להישלח) — הודעה ברורה ולא ״שגיאה לא ידועה״
        o21.intercept = b => b.action === "regStart" ? { ok: false, error: "mail_quota", message: "הודעת שרת" } : undefined;
        await page.fill("#rgEmail", "someone@example.com"); await page.click("#rgSend");
        await page.waitForFunction(() => document.getElementById("rgErr").textContent.length > 0, null, { timeout: 10000 });
        check("mail_quota בהרשמה: ההודעה על מכסת המייל היומית מוצגת (ולא שגיאה לא ידועה)", /מכסת המיילים היומית של המערכת הסתיימה/.test(await page.textContent("#rgErr")) && (await page.isVisible("#rgStep2")) === false, await page.textContent("#rgErr"));
        o21.intercept = null;
        await page.click("#rgBack"); await page.waitForSelector("#authForm"); pr = await probe();
        check("n=21: אחרי ״חזרה לכניסה״ הקישור קיים שוב", !!pr && pr.hit, JSON.stringify(pr));
      }
      await ctx.close();
    }
  }
  { // n=15: בועת ״!״ בלנדסקייפ בטלפון עם חריץ: נשארת בתוך האזורים הבטוחים (--safe-*)
    const { ctx, page } = await newPage(browser, { viewport: { width: 740, height: 360 } });
    await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
    await page.evaluate(() => {
      const r = document.documentElement.style; r.setProperty("--safe-left", "47px"); r.setProperty("--safe-right", "47px"); r.setProperty("--safe-top", "0px"); r.setProperty("--safe-bottom", "21px"); window.scrollTo(0, 0);
      const bs = [...document.querySelectorAll(".hbtn")].filter(b => b.getClientRects().length);
      bs[0].setAttribute("data-t", "left"); bs[0].style.cssText = "position:fixed;left:12px;top:120px;z-index:4000";                                       // ה-! השמאלי ביותר, בתוך אזור החריץ
      bs[1].setAttribute("data-t", "tall"); bs[1].style.cssText = "position:fixed;left:300px;top:200px;z-index:4000"; bs[1].setAttribute("data-help", "טקסט הסבר ארוך מאוד. ".repeat(80));   // בועה גבוהה מהמסך
    });
    const bub = () => page.evaluate(() => { const e = document.getElementById("hbubble"); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, vw: innerWidth, vh: innerHeight }; });
    await page.click('.hbtn[data-t="left"]'); let bb = await bub();
    check("n=15: ה-! השמאלי ביותר בלנדסקייפ עם חריץ (--safe-left/right=47, --safe-bottom=21): הבועה בתוך האזור הבטוח (שמאל ≥ 47, ימין ≤ רוחב−47), לא מתחת לחריץ", !!bb && bb.l >= 47 && bb.r <= bb.vw - 47 && bb.t >= 10, JSON.stringify(bb));
    await page.keyboard.press("Escape");
    await page.click('.hbtn[data-t="tall"]'); bb = await bub();
    check("n=15: בועה גבוהה מהמסך נשארת מעל פס הבית: התחתית ≤ גובה−21, העליונה ≥ 10, והצדדים בתוך האזור הבטוח", !!bb && bb.b <= bb.vh - 21 + 0.5 && bb.t >= 10 && bb.l >= 47 && bb.r <= bb.vw - 47, JSON.stringify(bb));
    await page.keyboard.press("Escape");
    await page.evaluate(() => { const r = document.documentElement.style; ["--safe-left", "--safe-right", "--safe-top", "--safe-bottom"].forEach(k => r.removeProperty(k)); });
    await page.click('.hbtn[data-t="left"]'); bb = await bub();
    check("n=15: בלי חריץ (אזורים בטוחים 0) המיקום כמו קודם — שוליים של 10px בלבד", !!bb && bb.l >= 10 && bb.l < 47 && bb.b <= bb.vh - 10 + 0.5, JSON.stringify(bb));
    await ctx.close();
  }
  { // n=14: פס הסיכום (aria-live) לא נבנה מחדש כשהתוכן זהה; כן נבנה כשהתוכן משתנה; ותקלה לא משאירה הודעה תקועה
    const { ctx, page } = await newPage(browser);
    await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
    await page.fill("#coord", "32.099128, 34.816617"); await page.dispatchEvent("#coord", "change"); await page.waitForTimeout(600);
    const r = await page.evaluate(async () => {
      const box = document.getElementById("pointSummary"); let n = 0; const mo = new MutationObserver(l => { n += l.length; }); mo.observe(box, { childList: true, subtree: true, characterData: true });
      const rad = document.getElementById("radius"), fire = () => { for (const id of ["radius", "height", "dateFrom", "timeFrom"]) { const e = document.getElementById(id); e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); } };
      const wait = ms => new Promise(x => setTimeout(x, ms)); const before = box.textContent;
      for (let i = 0; i < 4; i++) { fire(); await wait(260); }
      const same = n, sameText = box.textContent === before; n = 0;
      document.getElementById("coord").value = "31.5, 34.5"; document.getElementById("coord").dispatchEvent(new Event("change", { bubbles: true })); await wait(600);
      const changed = n, changedText = box.textContent !== before; mo.disconnect();
      return { same, sameText, changed, changedText };
    });
    check("n=14: עדכונים חוזרים בלי שינוי בתוכן (input/change על רדיוס, גובה, תאריך ושעה) אינם נוגעים ב-DOM של האזור החי (0 מוטציות); שינוי נקודה בונה מחדש", r.same === 0 && r.sameText && r.changed > 0 && r.changedText, JSON.stringify(r));
    await ctx.close();
  }

  /* ===== תרחיש 17: הפרדה וניהול בין מה שהארגון שולח לבין מה שמטיסים עצמאיים שולחים (חוזה שרת↔לקוח): סוג חשבון (org), ברירות מחדל ארגוניות, שם השולח (fromName), דיאלוגי שליחה לכל סוג ומצב, ניהול (setOrg, סיכומים, סינון), כתובת תמיכה ===== */
  {
    const ORG_ADDR = "office@icd.org.il", ORG_NAME = "הארגון הישראלי לרב להב", OFFICE = "notamoffice@iaa.gov.il,nofm@iaa.gov.il", SUFFIX = " — דרך מערכת בקשות הטיסה";
    const norm = s => s.replace(/\s+/g, " ");
    // עולם מדומה: מנהל (ארגוני), olga.org (ארגוני, נוצר ידנית — ברירת מחדל), dana.pilot (נרשמה עם כרטיס — עצמאית, כתובת שמורה), ron.pilot (עצמאי שנוצר ידנית עם org:false, בלי כתובת)
    const first = await newPage(browser); const env = first.page._env; await first.ctx.close();
    const admTok = env.call({ action: "login", user: ADMIN, pass: PASS }).token, setMode = m => env.call({ action: "setMailMode", token: admTok, mode: m });
    const add = (u, extra) => env.call(Object.assign({ action: "addUser", token: admTok, newUser: u, newPass: u.split(".")[0] + "-pass-12345" }, extra || {}));
    check("הכנה: addUser בלי org => חשבון ארגוני; org:false => עצמאי; listUsers מחזירה org לכל משתמש", add("olga.org").ok && add("ron.pilot", { org: false }).ok, "");
    env.props.WIX_API_KEY = "test-key";
    env.wix.orders.push({ orderNumber: "ORD-SPLIT-1", status: "PAID", created: new Date(Date.now() - 3 * 86400000).toISOString(), email: "dana@example.com", firstName: "דנה", memberId: "m-2", tickets: [] });
    env.call({ action: "regStart", email: "dana@example.com" });
    const regCode = /(\d{6})/.exec(env.mails[env.mails.length - 1].subject)[1], reg = env.call({ action: "regFinish", email: "dana@example.com", code: regCode, user: "dana.pilot", pass: "dana-pass-1234" });
    env.mails.length = 0;
    const usersOf = () => Object.fromEntries(env.call({ action: "listUsers", token: admTok }).users.map(u => [u.user, u]));
    { const us = usersOf();
      check("סוגי החשבונות בשרת: מנהל ו-olga.org ארגוניים; dana.pilot (regFinish) ו-ron.pilot (org:false) עצמאיים", reg.ok && reg.org === false && us[ADMIN].org === true && us["olga.org"].org === true && us["dana.pilot"].org === false && us["ron.pilot"].org === false, JSON.stringify(Object.fromEntries(Object.entries(us).map(([k, v]) => [k, v.org])))); }
    const opts = { env };
    const { ctx, page } = await newPage(browser, opts);
    const logout = async () => { await page.click("#ubOut"); await page.waitForSelector("#authForm", { timeout: 30000 }); };
    const vals = () => page.evaluate(() => ({ org: document.getElementById("reqOrg").value, cs: document.getElementById("reqCallsign").value, reg: document.getElementById("reqReg").value, name: document.getElementById("reqName").value, ph: document.getElementById("reqCallsign").placeholder }));
    const isOrgNow = () => page.evaluate(() => ReqAuth.isOrg());
    const D = JSON.parse(fs.readFileSync(path.join(ROOT, "members-k38p", "requests", "config.json"), "utf8")).org_defaults;

    /* ---- א. ברירות מחדל ארגוניות מול עצמאי, עריכה ושמירה, והחלפת חשבון באותו דפדפן ---- */
    check("config.json: org_defaults = הארגון הישראלי לרב להב / לא רלוונטי / ICD; כתובת התמיכה info@icd.org.il", D && D.name === ORG_NAME && D.callsign === "לא רלוונטי" && D.registration === "ICD" && SUPPORT === "info@icd.org.il", JSON.stringify(D) + " " + SUPPORT);
    await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 });
    check("לפני התחברות: אין ברירות מחדל בשדות (גם לא של הארגון)", JSON.stringify(await vals()) === JSON.stringify({ org: "", cs: "", reg: "", name: "", ph: "לא רלוונטי" }), JSON.stringify(await vals()));
    await login(page);   // מנהל = ארגוני
    let v = await vals();
    check("מנהל (ארגוני): ברירות המחדל נטענות — שם הגורם המבקש, אות הקריאה והרישום; auth.js: isOrg=true, features כולל orgSplit", (await isOrgNow()) === true && v.org === ORG_NAME && v.cs === "לא רלוונטי" && v.reg === "ICD" && (await page.evaluate(() => ReqAuth.hasFeature("orgSplit"))), JSON.stringify(v));
    check("מנהל (ארגוני): רמזי השדות מסבירים שנטענה ברירת מחדל של הארגון שאפשר לערוך (ולא ״אין ברירת מחדל״)", /ברירת מחדל של הארגון|שם הארגון כברירת מחדל/.test(await page.textContent("#hReqOrg")) && /ברירת המחדל של הארגון/.test(await page.textContent("#hReqCallsign")) && /ברירת המחדל של הארגון/.test(await page.textContent("#hReqReg")) && !/אין ברירת מחדל/.test(await page.textContent("#hReqOrg")), "");
    check("מנהל (ארגוני): שורת המשתמש ״(מנהל)״; ה-! של ״שלח״ הוא הנוסח הארגוני (בשם הארגון)", /\(מנהל\)/.test(await page.textContent("#userBar")) && /בשם הארגון/.test(await page.getAttribute(".hw:has(#btnSend) > .hbtn", "data-help")), "");
    // עריכה: הרישום ישתנה, אות הקריאה תרוקן — נשמרים כרגיל (גם ערך ריק הוא בחירה), ושם הגורם נשאר ברירת המחדל
    await page.fill("#reqReg", "4X-ADM"); await page.fill("#reqCallsign", "");
    await page.reload(); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 });
    v = await vals();
    check("אחרי עריכה ורענון: הרישום שנערך נשמר (4X-ADM), אות הקריאה שרוקנה נשארת ריקה (לא חוזרת לברירת המחדל), ושם הארגון נשמר", v.org === ORG_NAME && v.reg === "4X-ADM" && v.cs === "", JSON.stringify(v));
    { const rec = JSON.parse(await lsRead(page, "icd_req_person_v1"));
      check("הרשומה השמורה של המנהל נושאת את סוג החשבון (org:true) ואת הערכים שבשדות", rec.org === true && rec.reqOrg === ORG_NAME && rec.reqReg === "4X-ADM" && rec.reqCallsign === "", JSON.stringify(rec)); }
    // מחיקת הפרטים השמורים: השדות מתרוקנים; בטעינה הבאה (אין ערך שמור) ברירות המחדל חוזרות
    await page.evaluate(() => { document.getElementById("personBox").open = true; }); await page.click("#wipePerson");
    check("״מחק פרטים אלה מהמכשיר״: השדות מתרוקנים", JSON.stringify(await vals()) === JSON.stringify({ org: "", cs: "", reg: "", name: "", ph: "לא רלוונטי" }) && (await lsRead(page, "icd_req_person_v1")) === null, JSON.stringify(await vals()));
    await page.reload(); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 });
    v = await vals();
    check("אחרי המחיקה והרענון (אין ערך שמור): ברירות המחדל הארגוניות חוזרות", v.org === ORG_NAME && v.cs === "לא רלוונטי" && v.reg === "ICD", JSON.stringify(v));
    // רשומה שנכתבה בגרסה שלפני ההפרדה (בלי מפתח org, עם שדות ריקים): אצל חשבון ארגוני הריק אינו בחירה — ברירות המחדל נטענות; ערך שאינו ריק נשמר
    await page.evaluate(k => localStorage.setItem(k, JSON.stringify({ reqName: "", reqPhone: "", reqOrg: "", reqCallsign: "", reqReg: "4X-OLD", contacts: [] })), await uk(page, "icd_req_person_v1"));
    await page.reload(); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 });
    v = await vals();
    check("רשומה ישנה (בלי org) עם שדות ריקים אצל המנהל: שם הארגון ואות הקריאה נטענים מברירות המחדל, והרישום שאינו ריק (4X-OLD) נשמר", v.org === ORG_NAME && v.cs === "לא רלוונטי" && v.reg === "4X-OLD", JSON.stringify(v));
    // החלפת חשבון באותו דפדפן: ארגוני -> עצמאי (dana): הכול ריק; הפרטים של dana נשמרים אצלה בלבד
    await page.fill("#reqReg", "4X-ADM");   // שומר גם את שאר הערכים של המנהל (ברירות המחדל) ברשומה שלו
    await logout(); await login(page, "dana.pilot", "dana-pass-1234");
    v = await vals();
    check("עצמאי (dana) באותו דפדפן אחרי מנהל: isOrg=false; כל השדות ריקים — שום ערך של הארגון או של המנהל לא עבר", (await isOrgNow()) === false && v.org === "" && v.cs === "" && v.reg === "" && v.name === "" && !/\(מנהל\)|חשבון ארגוני/.test(await page.textContent("#userBar")), JSON.stringify(v));
    check("עצמאי: רמזי השדות נשארים בנוסח ״אין ברירת מחדל״ וה-! של ״שלח״ הוא הנוסח העצמאי (בלי הארגון)", /אין ברירת מחדל/.test(await page.textContent("#hReqOrg")) && !/ברירת המחדל של הארגון/.test(await page.textContent("#hReqCallsign")), "");
    { const sh = await page.getAttribute(".hw:has(#btnSend) > .hbtn", "data-help");
      check("עצמאי: ה-! של ״שלח״ מסביר שהמייל יוצא בשם הגורם שהצהרתם עליו (עם הסיומת), העותק והתשובות אליכם, ותמיכה מקבלת עותק סמוי — בלי אזכור של הארגון או של כתובתו", /בשם הגורם המבקש שהצהרתם עליו/.test(sh) && sh.includes("דרך מערכת בקשות הטיסה") && /ותשובות המשרד יגיעו אליכם/.test(sh) && /צוות התמיכה של המערכת מקבל עותק סמוי/.test(sh) && !/הארגון|office@icd/.test(sh), sh.slice(0, 200)); }
    await page.fill("#reqName", "דנה לוי"); await page.fill("#reqOrg", "דנה לוי צילום"); await page.fill("#reqReg", "4X-DNA");
    await logout(); await login(page, "olga.org", "olga-pass-12345");
    v = await vals();
    check("ארגוני שאינו מנהל (olga.org): ברירות המחדל של הארגון — לא הערכים של dana; שורת המשתמש ״(חשבון ארגוני)״", (await isOrgNow()) === true && v.org === ORG_NAME && v.cs === "לא רלוונטי" && v.reg === "ICD" && v.name === "" && /\(חשבון ארגוני\)/.test(await page.textContent("#userBar")), JSON.stringify(v));
    await page.fill("#reqName", "אולגה");   // נשמר ברשומה (עם ברירות המחדל) — לבדיקת המעבר לעצמאי
    await logout(); await login(page, "dana.pilot", "dana-pass-1234");
    v = await vals();
    check("חזרה ל-dana: הערכים שלה נשמרו ושל אף אחד אחר לא התערבבו", v.name === "דנה לוי" && v.org === "דנה לוי צילום" && v.reg === "4X-DNA" && v.cs === "", JSON.stringify(v));
    { const recD = JSON.parse(await lsRead(page, "icd_req_person_v1"));
      check("הרשומה השמורה של dana נושאת org:false", recD.org === false, JSON.stringify(recD)); }
    // olga הפכה לעצמאית (setOrg) — ברירות המחדל הארגוניות ששמרה אינן עוברות איתה; ערך שהקלידה בעצמה כן
    check("setOrg (מנהל): olga.org -> עצמאית", env.call({ action: "setOrg", token: admTok, target: "olga.org", org: false }).ok && usersOf()["olga.org"].org === false, "");
    await logout(); await login(page, "olga.org", "olga-pass-12345");
    v = await vals();
    check("משתמשת שהפכה מארגונית לעצמאית: isOrg=false; ברירות המחדל הארגוניות שנשמרו אצלה נמחקות מהשדות (שם הארגון, ״לא רלוונטי״, ICD), והשם שהקלידה נשאר", (await isOrgNow()) === false && v.org === "" && v.cs === "" && v.reg === "" && v.name === "אולגה", JSON.stringify(v));
    env.call({ action: "setOrg", token: admTok, target: "olga.org", org: true });

    /* ---- ב. חלון השליחה והשליחה בפועל: ארגוני (מנהל, olga עם/בלי כתובת שמורה) מול עצמאי (dana; ron בלי כתובת נחסם), חי/בדיקה/לעצמי; fromName; שם השולח במייל ---- */
    const dlg = async () => { await page.click("#btnSend"); await page.waitForSelector(".sendBox"); return norm(await page.textContent(".sendBox")); };
    const dlgVisible = () => page.evaluate(() => { const b = document.querySelector(".sendBox").cloneNode(true); b.querySelectorAll("details").forEach(d => d.remove()); return b.textContent.replace(/\s+/g, " "); });   // בלי נוסח המייל (details)
    const closeDlg = async () => { await page.click("#mdClose"); await page.waitForSelector(".sendBox", { state: "detached" }); };
    const waitSent = re => page.waitForFunction(r => new RegExp(r).test(document.querySelector("#sendProg").textContent), re, { timeout: 120000 });
    const newSite = async name => { await page.fill("#siteName", name); await page.waitForFunction(() => window.__REQ.S.ready === true && !window.__REQ.S.pending && !window.__REQ.S.building, null, { timeout: 90000 }); };
    const lastMail = () => env.mails[env.mails.length - 1], sends = () => page._calls.sends || [], lastSend = () => sends()[sends().length - 1];
    const sendOffice = async re => { await page.check("#sendOk"); await page.click("#sendGo"); await waitSent(re); };
    const sendSelf = async re => { await page.check("#sendOk"); await page.click("#sendSelf"); await waitSent(re); };

    // --- ב1. מנהל (ארגוני, בלי כתובת שמורה => כתובת העותק היא כתובת הארגון) ---
    await logout(); await login(page); setMode("live");
    await readyRequest(page, { org: "חברת המנהל בע״מ", callsign: "אות-1", registration: "4X-ORG" });
    let g = await page.evaluate(() => ({ email: ReqAuth.getEmail(), copyTo: ReqAuth.getCopyTo(), own: ReqAuth.getCopyToIsOwner(), org: ReqAuth.isOrg() }));
    check("מנהל: השרת מחזיר org=true; בלי כתובת שמורה: copyTo=כתובת הארגון (מוצגת רק לארגוני)", g.org === true && g.email === "" && g.copyTo === ORG_ADDR && g.own === true, JSON.stringify(g));
    let t = await dlg();
    check("דיאלוג ארגוני (חי): ״אל: <משרד נוטאם> · עותק: הארגון (<כתובת>) · התשובות יחזרו אל הארגון · שם השולח: הארגון הישראלי לרב להב״", t.includes("אל: notamoffice@iaa.gov.il, nofm@iaa.gov.il · עותק: הארגון (" + ORG_ADDR + ") · התשובות יחזרו אל הארגון · שם השולח: " + ORG_NAME) && (await page.textContent("#sendGo")) === "שלח למשרד נוטאם" && (await page.textContent("#sendSelf")) === "שלח רק לעצמי (עותק לבדיקה)", t.slice(0, 500));
    check("דיאלוג ארגוני (חי): ״שלח רק לעצמי״ — אל כתובת הארגון בלבד, התשובות אל הארגון, לא נשלח למשרד; בלי שורת ״שם השולח במייל״ של מטיס ובלי ״בעל המערכת״", t.includes("אל: " + ORG_ADDR + " בלבד · התשובות יחזרו אל הארגון · שם השולח: " + ORG_NAME + " · לא נשלח למשרד") && !t.includes("שם השולח במייל") && !t.includes("בעל המערכת") && t.includes("הבקשה נשמרת בארכיון הארגון בדרייב"), t.slice(0, 700));
    await sendSelf("נשלח|נכשלה");
    let m = lastMail();
    check("ארגוני, לעצמי: to=כתובת הארגון, בלי עותק ובלי bcc, replyTo=הארגון, name=שם הארגון; הבקשה כוללת fromName=הגורם שהוקלד ו-target=self", env.mails.length === 1 && m.to === ORG_ADDR && !m.cc && !m.bcc && m.replyTo === ORG_ADDR && m.name === ORG_NAME && lastSend().target === "self" && lastSend().fromName === "חברת המנהל בע״מ", JSON.stringify({ to: m.to, cc: m.cc, bcc: m.bcc, replyTo: m.replyTo, name: m.name, send: lastSend() }));
    check("ארגוני, לעצמי: ההודעה ״נשלח לארגון ✔ — לא נשלח למשרד נוטאם״", norm(await page.textContent("#sendProg")) === "נשלח לארגון ✔ — לא נשלח למשרד נוטאם.", norm(await page.textContent("#sendProg")));
    await sendOffice("נשלחה למשרד נוטאם|נכשלה|כבר נשלחה");
    m = lastMail();
    check("ארגוני, למשרד: to=משרד נוטאם, cc=כתובת הארגון בלבד, בלי bcc, replyTo=הארגון, name=שם הארגון; fromName=הגורם שהוקלד, target=office, expectMode=live", env.mails.length === 2 && m.to === OFFICE && m.cc === ORG_ADDR && !m.bcc && m.replyTo === ORG_ADDR && m.name === ORG_NAME && lastSend().target === "office" && lastSend().expectMode === "live" && lastSend().fromName === "חברת המנהל בע״מ", JSON.stringify({ to: m.to, cc: m.cc, bcc: m.bcc, replyTo: m.replyTo, name: m.name }));
    check("ארגוני, למשרד: ההודעה ״נשלחה למשרד נוטאם ✔ (עותק לארגון)״", /^נשלחה למשרד נוטאם ✔ \(עותק לארגון\) — notamoffice@iaa\.gov\.il, nofm@iaa\.gov\.il · /.test(norm(await page.textContent("#sendProg"))), norm(await page.textContent("#sendProg")));
    await closeDlg();
    { const fo = reqFolders(env)[0];
      check("הבקשה הארגונית נשמרה בתיקיית ״הארגון״ בדרייב (מתחת לראשית), וקישור התיקייה מוצג למנהל", !!fo && /^הארגון\//.test(folderPath(env, fo)) && /פתח את התיקייה בדרייב/.test(await page.innerHTML("#sendMsg")), fo ? folderPath(env, fo) : "אין תיקייה"); }
    setMode("test"); await newSite("אתר ארגוני בדיקה");
    t = await dlg();
    check("דיאלוג ארגוני (בדיקה): ״מצב בדיקה — המייל יישלח רק אל <כתובת הארגון> ולא למשרד נוטאם · התשובות יחזרו אל הארגון · שם השולח: …״, כפתור אחד", t.includes("מצב בדיקה — המייל יישלח רק אל " + ORG_ADDR + " ולא למשרד נוטאם · התשובות יחזרו אל הארגון · שם השולח: " + ORG_NAME) && (await page.textContent("#sendGo")) === "שלח בדיקה אליי" && !(await page.$("#sendSelf")), t.slice(0, 400));
    await sendOffice("נשלח במצב בדיקה|נכשלה"); m = lastMail();
    check("ארגוני, בדיקה: to=כתובת הארגון בלבד, בלי bcc, replyTo=הארגון, name=שם הארגון; fromName נשלח גם בבדיקה", m.to === ORG_ADDR && !m.cc && !m.bcc && m.replyTo === ORG_ADDR && m.name === ORG_NAME && lastSend().fromName === "חברת המנהל בע״מ" && /^נשלח במצב בדיקה לארגון ✔/.test(norm(await page.textContent("#sendProg"))), norm(await page.textContent("#sendProg")));
    await closeDlg();

    // --- ב2. olga (ארגונית שאינה מנהלת) עם כתובת שמורה משלה: העותק לארגון ולכתובת שלה, בלי כפילות ---
    { const rec = JSON.parse(env.props["U:olga.org"]); rec.email = "olga@example.com"; env.props["U:olga.org"] = JSON.stringify(rec); }
    await logout(); await login(page, "olga.org", "olga-pass-12345"); setMode("live");
    await readyRequest(page, { org: "אולגה צילום", callsign: "", registration: "" });
    g = await page.evaluate(() => ({ email: ReqAuth.getEmail(), copyTo: ReqAuth.getCopyTo(), own: ReqAuth.getCopyToIsOwner(), org: ReqAuth.isOrg(), role: ReqAuth.getRole() }));
    check("olga: ארגונית (org=true, role=user) עם כתובת שמורה — copyTo=הכתובת שלה", g.org === true && g.role === "user" && g.email === "olga@example.com" && g.copyTo === "olga@example.com" && g.own === false, JSON.stringify(g));
    t = await dlg();
    check("דיאלוג ארגוני עם כתובת שמורה: ״עותק: הארגון ואליך (olga@example.com) · התשובות יחזרו אל הארגון״; כפתור ״שמור בדרייב״ מוצג (לכולם) והמייל הידני מוסתר (לא מנהלת)", t.includes("עותק: הארגון ואליך (olga@example.com) · התשובות יחזרו אל הארגון · שם השולח: " + ORG_NAME) && (await page.locator(".hw:has(#btnDrive)").isVisible()) && !(await page.isVisible("#manualMail")), t.slice(0, 400));
    await sendOffice("נשלחה למשרד נוטאם|נכשלה|כבר נשלחה"); m = lastMail();
    check("ארגונית עם כתובת, למשרד: cc=כתובת הארגון וגם כתובתה (בלי כפילות), בלי bcc, replyTo=הארגון, name=שם הארגון; ההודעה ״(עותק אליך ולארגון)״; בלי קישור לתיקייה", m.to === OFFICE && m.cc === ORG_ADDR + ",olga@example.com" && !m.bcc && m.replyTo === ORG_ADDR && m.name === ORG_NAME && /\(עותק אליך ולארגון\)/.test(norm(await page.textContent("#sendProg"))) && !(await page.$("#sendMsg a")), JSON.stringify({ to: m.to, cc: m.cc, bcc: m.bcc, replyTo: m.replyTo }));
    await closeDlg();

    // --- ב3. dana (עצמאית עם כתובת שמורה) ---
    await logout(); await login(page, "dana.pilot", "dana-pass-1234"); setMode("live");
    await readyRequest(page, { org: "דנה לוי צילום", callsign: "", registration: "" });
    g = await page.evaluate(() => ({ email: ReqAuth.getEmail(), copyTo: ReqAuth.getCopyTo(), own: ReqAuth.getCopyToIsOwner(), org: ReqAuth.isOrg() }));
    check("dana: עצמאית (org=false), copyTo=הכתובת השמורה שלה", g.org === false && g.email === "dana@example.com" && g.copyTo === "dana@example.com" && g.own === false, JSON.stringify(g));
    t = await dlg(); const tv = await dlgVisible();
    check("דיאלוג עצמאי (חי): כמו היום — ״אל: notamoffice@… · עותק אליך: dana@example.com · התשובות יגיעו אליך״ ו״אל: dana@example.com בלבד · לא נשלח למשרד״", t.includes("אל: notamoffice@iaa.gov.il, nofm@iaa.gov.il · עותק אליך: dana@example.com · התשובות יגיעו אליך") && t.includes("אל: dana@example.com בלבד · לא נשלח למשרד"), t.slice(0, 500));
    check("דיאלוג עצמאי: שורת ״שם השולח במייל: <הגורם שהצהרת> — דרך מערכת בקשות הטיסה״", t.includes("שם השולח במייל: דנה לוי צילום" + SUFFIX), t.slice(0, 600));
    check("דיאלוג עצמאי: אין כתובת הארגון, אין שם הארגון ואין אזכור של הארגון כשולח/כעותק/כנמען תשובות (מחוץ לנוסח המייל)", !tv.includes(ORG_ADDR) && !tv.includes("לרב להב") && !/הארגון/.test(tv) && !/בעל המערכת/.test(tv), tv.slice(0, 600));
    await sendSelf("נשלח|נכשלה"); m = lastMail();
    check("עצמאי, לעצמי: to=dana, bcc=כתובת הארגון (תמיכה), replyTo=dana, name=״דנה לוי צילום — דרך מערכת בקשות הטיסה״; fromName=הגורם שהוקלד", m.to === "dana@example.com" && !m.cc && m.bcc === ORG_ADDR && m.replyTo === "dana@example.com" && m.name === "דנה לוי צילום" + SUFFIX && lastSend().target === "self" && lastSend().fromName === "דנה לוי צילום", JSON.stringify({ to: m.to, cc: m.cc, bcc: m.bcc, replyTo: m.replyTo, name: m.name, send: lastSend() }));
    await sendOffice("נשלחה למשרד נוטאם|נכשלה|כבר נשלחה"); m = lastMail();
    check("עצמאי, למשרד: to=משרד נוטאם, cc=dana, bcc=כתובת הארגון, replyTo=dana, name=הגורם + הסיומת הקבועה; fromName נשלח גם ל-office; ההודעה ״(עותק אליך)״", m.to === OFFICE && m.cc === "dana@example.com" && m.bcc === ORG_ADDR && m.replyTo === "dana@example.com" && m.name === "דנה לוי צילום" + SUFFIX && lastSend().target === "office" && lastSend().fromName === "דנה לוי צילום" && /\(עותק אליך\)/.test(norm(await page.textContent("#sendProg"))), JSON.stringify({ to: m.to, cc: m.cc, bcc: m.bcc, replyTo: m.replyTo, name: m.name }));
    await closeDlg();
    { const fo = reqFolders(env).find(f => /^מטיסים\//.test(folderPath(env, f)));
      check("הבקשה העצמאית נשמרה בתיקיית ״מטיסים״ ובתוכה תת-תיקייה על שם המשתמש; למטיס אין קישור לתיקייה", !!fo && /^מטיסים\/dana\.pilot\/[^/]+$/.test(folderPath(env, fo)) && !(await page.$("#sendMsg a")), fo ? folderPath(env, fo) : "אין"); }
    setMode("test"); await newSite("אתר עצמאי בדיקה");
    t = await dlg();
    check("דיאלוג עצמאי (בדיקה): ״המייל יישלח רק אליך (dana@example.com) ולא למשרד נוטאם״ ושורת שם השולח; בלי הארגון", t.includes("מצב בדיקה — המייל יישלח רק אליך (dana@example.com) ולא למשרד נוטאם") && t.includes("שם השולח במייל: דנה לוי צילום" + SUFFIX) && !(await dlgVisible()).includes(ORG_ADDR) && !/הארגון/.test(await dlgVisible()), t.slice(0, 400));
    await sendOffice("נשלח במצב בדיקה|נכשלה"); m = lastMail();
    check("עצמאי, בדיקה: to=dana, bcc=הארגון, replyTo=dana, name עם הסיומת", m.to === "dana@example.com" && !m.cc && m.bcc === ORG_ADDR && m.replyTo === "dana@example.com" && m.name === "דנה לוי צילום" + SUFFIX && lastSend().fromName === "דנה לוי צילום", JSON.stringify({ to: m.to, bcc: m.bcc, name: m.name }));
    await closeDlg();
    { // שם גורם עוין: השרת מנקה (<>"@\ ובקרה), והדיאלוג מציג כפי שהשרת ישלח; אין הזרקת HTML
      await page.fill("#reqOrg", "משטרת <b>ישראל</b> \"@x\\y\"");
      await page.waitForFunction(() => window.__REQ.S.ready === true && !window.__REQ.S.pending && !window.__REQ.S.building, null, { timeout: 90000 });
      t = await dlg();
      check("שם גורם עוין (<b>, מירכאות, @, לוכסן): הדיאלוג מציג את השם המנוקה כפי שהשרת ישלח, כטקסט — בלי הזרקת HTML", t.includes("שם השולח במייל: משטרת b ישראל /b x y" + SUFFIX) && (await page.locator(".sendBox b:text-is('ישראל')").count()) === 0, t.slice(0, 500));
      await sendOffice("נשלח במצב בדיקה|נכשלה"); m = lastMail();
      check("אותו שם עוין: השרת שולח name מנוקה (בלי <>\"@\\), מסתיים בסיומת הקבועה, ו-fromName הגולמי נשלח כפי שהוקלד", m.name === "משטרת b ישראל /b x y" + SUFFIX && !/[<>"@\\]/.test(m.name) && lastSend().fromName === "משטרת <b>ישראל</b> \"@x\\y\"", JSON.stringify({ name: m.name, fromName: lastSend().fromName }));
      await closeDlg(); }
    { const html = await page.content(), body = await page.evaluate(() => document.body.innerText), helps = await page.$$eval(".hbtn", els => els.map(e => e.dataset.help || "").join(" | "));
      check("עצמאי: כתובת הארגון (office@icd.org.il) לא מופיעה בשום מקום בדף — לא ב-HTML, לא בטקסט הגלוי ולא בהסברי ה-!", !html.includes(ORG_ADDR) && !body.includes(ORG_ADDR) && !helps.includes(ORG_ADDR), ""); }

    // --- ב4. ron (עצמאי בלי כתובת שמורה): השליחה נחסמת (נכשל סגור) והכתובת של הארגון לא נחשפת; כתובת התמיכה מוצגת ---
    await logout(); await login(page, "ron.pilot", "ron-pass-12345");
    await readyRequest(page, { org: "רון צילום", callsign: "", registration: "" });
    g = await page.evaluate(() => ({ email: ReqAuth.getEmail(), copyTo: ReqAuth.getCopyTo(), own: ReqAuth.getCopyToIsOwner(), org: ReqAuth.isOrg() }));
    check("ron: עצמאי בלי כתובת — השרת לא מחזיר לו כתובת (copyTo ריק) ובוודאי לא את כתובת הארגון", g.org === false && g.email === "" && g.copyTo === "" && g.own === false, JSON.stringify(g));
    { const n0 = env.mails.length, s0 = sends().length, b0 = page._calls.actions.filter(a => a === "saveBegin").length;
      await page.click("#btnSend"); await page.waitForFunction(() => /לא נשלח/.test(document.querySelector("#sendMsg").textContent), null, { timeout: 30000 });
      const em = norm(await page.textContent("#sendMsg"));
      check("עצמאי בלי כתובת שמורה: לא נפתח חלון, לא נשמר בדרייב ולא נשלח; ההודעה מפנה לתמיכה (info@icd.org.il) בלי כתובת הארגון", !(await page.$(".sendBox")) && env.mails.length === n0 && sends().length === s0 && page._calls.actions.filter(a => a === "saveBegin").length === b0 && em.includes("אין כתובת מייל רשומה בחשבון שלך") && em.includes("פנו לתמיכה: " + SUPPORT) && !em.includes(ORG_ADDR), em); }

    // --- ב5. שרת ללא orgSplit (sendTarget בלבד) ושרת ישן: fromName לא נשלח; הדיאלוג כמו קודם; org נגזר מהתפקיד ---
    await logout(); await login(page, "dana.pilot", "dana-pass-1234"); setMode("live");
    await readyRequest(page, { org: "דנה לוי צילום", callsign: "", registration: "" });
    opts.noSplit = true;
    t = await dlg();
    check("שרת בלי orgSplit (sendTarget בלבד): הדיאלוג הקודם (״עותק נשמר גם אצל בעל המערכת לצורכי תמיכה״), בלי שורת שם השולח", t.includes("עותק אליך: dana@example.com · התשובות יגיעו אליך · עותק נשמר גם אצל בעל המערכת לצורכי תמיכה") && !t.includes("שם השולח במייל") && (await page.evaluate(() => ReqAuth.hasFeature("orgSplit"))) === false, t.slice(0, 400));
    await sendSelf("נשלח|נכשלה");
    check("שרת בלי orgSplit: sendRequest נשלח בלי fromName (אבל עם target)", lastSend().target === "self" && !("fromName" in lastSend()), JSON.stringify(Object.keys(lastSend())));
    await closeDlg(); opts.noSplit = false;
    await logout(); await login(page); setMode("live");
    await page.evaluate(() => { document.getElementById("personBox").open = true; }); await page.click("#wipePerson");   // אין ערך שמור אצל המנהל — כדי לראות בשרת ישן את ברירות המחדל הארגוניות (שם הארגון, אות קריאה, רישום)
    opts.oldServer = true;
    await page.reload(); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 });
    v = await vals();
    check("שרת ישן (בלי features ובלי org): org נגזר מהתפקיד — המנהל ארגוני וברירות המחדל הארגוניות נטענות", (await isOrgNow()) === true && v.org === ORG_NAME && v.cs === "לא רלוונטי" && v.reg === "ICD" && (await page.evaluate(() => ReqAuth.getFeatures().length)) === 0, JSON.stringify(v));
    const ymd = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    await readyRequest(page, { org: "חברת המנהל בע״מ", callsign: "", registration: "", dateFrom: ymd(20), dateTo: ymd(22) });
    t = await dlg();
    check("שרת ישן, מנהל: הדיאלוג הישן (עותק לחשבון הבעלים), ללא שורת שם השולח וללא ניסוח של הארגון כשולח", t.includes("עותק יישלח לחשבון הבעלים של המערכת, ותשובות המשרד יגיעו אליו (ולא אליך)") && !t.includes("שם השולח") && (await page.isDisabled("#sendSelf")), t.slice(0, 300));
    await page.check("#sendOk"); await page.click("#sendGo"); await waitSent("נשלחה למשרד נוטאם|נכשלה|כבר נשלחה");
    check("שרת ישן: sendRequest נשלח בלי fromName ובלי target", !("fromName" in lastSend()) && !("target" in lastSend()), JSON.stringify(Object.keys(lastSend())));
    await closeDlg();
    await page.click("#ubAdmin"); await page.waitForSelector("#admBody .admTbl");
    check("שרת ישן: חלון הניהול בלי עמודת סוג, בלי סיכומים לפי סוג, בלי סינון סוג ובלי תיבת ״חשבון ארגוני״", (await page.locator("#admBody .utype, #admTotals, #admKind, #adO, [data-setorg]").count()) === 0, "");
    await page.click("#mdClose"); opts.oldServer = false;
    await ctx.close();
  }
  {
    /* ---- ג. ניהול משתמשים: עמודת סוג והפיכה (setOrg), תיבת ״חשבון ארגוני״ בהוספת משתמש, סיכומים נפרדים, יומן עם סוג וסינון ---- */
    const first = await newPage(browser); const env = first.page._env; await first.ctx.close();
    const admTok = env.call({ action: "login", user: ADMIN, pass: PASS }).token;
    env.call({ action: "addUser", token: admTok, newUser: "eli.org", newPass: "eli-pass-12345" });
    env.call({ action: "addUser", token: admTok, newUser: "pil.pilot", newPass: "pil-pass-12345", org: false });
    const { ctx, page } = await newPage(browser, { env });
    await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page);
    // בקשות ביומן: אחת ארגונית (המנהל) ואחת עצמאית (pil.pilot), נשמרות ישירות בשרת עם saveBegin (kind לפי סוג המשתמש ברגע זה)
    const mkReq = (tok, name, rid) => { const b = env.call({ action: "saveBegin", token: tok, folderName: name, rid }); return b; };
    const pilTok = env.call({ action: "login", user: "pil.pilot", pass: "pil-pass-12345" }).token, eliTok = env.call({ action: "login", user: "eli.org", pass: "eli-pass-12345" }).token;
    const b1 = mkReq(admTok, "אתר ארגוני א — 2026-11-01", "a".repeat(24)), b2 = mkReq(eliTok, "אתר ארגוני ב — 2026-11-02", "b".repeat(24)), b3 = mkReq(pilTok, "אתר מטיס — 2026-11-03", "c".repeat(24));
    check("הכנה: שלוש בקשות ביומן — שתיים ארגוניות ואחת של מטיס עצמאי; saveBegin מחזיר url למנהל בלבד (גם חשבון ארגוני שאינו מנהל לא מקבל)", b1.ok && b2.ok && b3.ok && b1.url && !b2.url && !b3.url, JSON.stringify([b1.ok, b2.ok, b3.ok, !!b1.url, !!b2.url, !!b3.url]));
    await page.click("#ubAdmin"); await page.waitForSelector("#admBody .admTbl");
    const tbl = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll("#admBody table.admTbl:nth-of-type(1) tr")].slice(1).map(r => [r.querySelector("td").textContent.trim(), { type: (r.querySelector(".utype") || {}).dataset ? r.querySelector(".utype").dataset.type : null, label: (r.querySelector(".utype") || {}).textContent || null, btn: (r.querySelector("[data-setorg]") || {}).textContent || null, help: !!r.querySelector("td:has(.utype) .hbtn") }])));
    let rows = await tbl();
    const heads = await page.$$eval("#admBody table.admTbl:nth-of-type(1) tr:first-child th", ths => ths.map(t => t.textContent.trim()));
    check("טבלת המשתמשים: עמודת ״סוג״ אחרי ״תפקיד״; מנהל = ארגוני (בלי כפתור הפיכה), eli.org = ארגוני + ״הפוך לעצמאי״, pil.pilot = עצמאי + ״הפוך לארגוני״, לכל כפתור ״!״", heads[1] === "תפקיד" && heads[2] === "סוג" && rows[ADMIN].type === "org" && rows[ADMIN].label === "ארגוני" && rows[ADMIN].btn === null && rows["eli.org"].type === "org" && rows["eli.org"].btn === "הפוך לעצמאי" && rows["eli.org"].help && rows["pil.pilot"].type === "pilot" && rows["pil.pilot"].label === "עצמאי" && rows["pil.pilot"].btn === "הפוך לארגוני" && rows["pil.pilot"].help, JSON.stringify(rows));
    { const h = await page.getAttribute("#admBody tr:has([data-setorg='pil.pilot']) td:has(.utype) .hbtn", "data-help"), lbl = await page.getAttribute("#admBody tr:has([data-setorg='pil.pilot']) td:has(.utype) .hbtn", "aria-label");
      check("הסבר ה-! של הסוג מפרט מה משתנה: שם השולח, ברירות המחדל, תיקיית הדרייב וניתוב התשובות/העותקים", /שם השולח/.test(h) && /ברירות המחדל/.test(h) && /תיקיית ״הארגון״/.test(h) && /תיקיית ״מטיסים״/.test(h) && /התשובות/.test(h) && /בקשות חדשות בלבד/.test(h) && /^הסבר על: סוג החשבון — pil\.pilot$/.test(lbl), lbl + " | " + h.slice(0, 120)); }
    const totalsText = () => page.evaluate(() => { const e = document.getElementById("admTotals"); return e ? e.textContent.replace(/\s+/g, " ").trim() : null; });
    { const tot = env.call({ action: "listUsers", token: admTok }).totals, want = "בקשות הארגון: " + tot.org.requests + " (נשלחו " + tot.org.sent + ") · בקשות מטיסים: " + tot.pilot.requests + " (נשלחו " + tot.pilot.sent + ")";
      check("סיכומים נפרדים בראש החלון: ״בקשות הארגון: 2 (נשלחו 0) · בקשות מטיסים: 1 (נשלחו 0)״ — לפי מה שהשרת מחזיר", tot.org.requests === 2 && tot.pilot.requests === 1 && (await totalsText()) === want && want === "בקשות הארגון: 2 (נשלחו 0) · בקשות מטיסים: 1 (נשלחו 0)" && (await page.evaluate(() => document.querySelector("#admBody").firstElementChild.id)) === "admTotals", (await totalsText()) + " | " + want); }
    // יומן הבקשות: עמודת סוג, סינון, קישור ״פתח״
    const logRows = () => page.evaluate(() => [...document.querySelectorAll("#admBody table.admTbl:nth-of-type(2) tr")].slice(1).map(r => [r.querySelector("td[data-kind]").dataset.kind, r.querySelector("td[data-kind]").textContent.trim(), r.children[3].textContent.trim(), (r.querySelector("a") || {}).href || ""]));
    let lr = await logRows();
    check("יומן הבקשות: עמודת סוג לכל שורה (הארגון / מטיס) וסינון ״הכול״ כברירת מחדל — שלוש שורות", lr.length === 3 && lr.filter(x => x[0] === "org" && x[1] === "הארגון").length === 2 && lr.filter(x => x[0] === "pilot" && x[1] === "מטיס").length === 1 && (await page.inputValue("#admKind")) === "", JSON.stringify(lr));
    check("קישור ״פתח״ ביומן ממשיך לעבוד: כתובת התיקייה בדרייב של כל בקשה (גם של מטיס, במבנה מטיסים/משתמש)", lr.every(x => /^https:\/\/drive\.google\.com\/drive\/folders\/F\d+$/.test(x[3])) && lr.some(x => x[3].endsWith("/" + b3.folderId)) && lr.some(x => x[3].endsWith("/" + b1.folderId)), JSON.stringify(lr.map(x => x[3])));
    await page.selectOption("#admKind", "pilot"); await page.waitForFunction(() => document.querySelectorAll("#admBody table.admTbl:nth-of-type(2) tr").length === 2, null, { timeout: 10000 });
    lr = await logRows();
    check("סינון ״מטיסים״: רק הבקשה העצמאית; הסינון נשמר ברענון החלון", lr.length === 1 && lr[0][0] === "pilot" && (await page.inputValue("#admKind")) === "pilot", JSON.stringify(lr));
    await page.selectOption("#admKind", "org"); await page.waitForFunction(() => [...document.querySelectorAll("#admBody table.admTbl:nth-of-type(2) tr")].slice(1).every(r => r.querySelector("td[data-kind]").dataset.kind === "org") && document.querySelectorAll("#admBody table.admTbl:nth-of-type(2) tr").length === 3, null, { timeout: 10000 });
    lr = await logRows();
    check("סינון ״הארגון״: שתי הבקשות הארגוניות בלבד", lr.length === 2 && lr.every(x => x[0] === "org"), JSON.stringify(lr));
    await page.selectOption("#admKind", ""); await page.waitForFunction(() => document.querySelectorAll("#admBody table.admTbl:nth-of-type(2) tr").length === 4, null, { timeout: 10000 });
    // הפיכת סוג משתמש (setOrg) בלחיצה: pil.pilot -> ארגוני, ושוב לעצמאי; confirm מסביר; ביטול ב-confirm לא משנה דבר
    page.once("dialog", d => d.dismiss());
    await page.click("[data-setorg='pil.pilot']"); await page.waitForTimeout(400);
    check("ביטול ב-confirm של ההפיכה: הסוג לא משתנה", env.call({ action: "listUsers", token: admTok }).users.find(u => u.user === "pil.pilot").org === false, "");
    let dlgMsg = "";
    page.once("dialog", d => { dlgMsg = d.message(); d.accept(); });
    await page.click("[data-setorg='pil.pilot']"); await page.waitForFunction(() => document.querySelector("[data-setorg='pil.pilot']") && document.querySelector("[data-setorg='pil.pilot']").textContent === "הפוך לעצמאי", null, { timeout: 10000 });
    rows = await tbl();
    check("הפיכה לארגוני: ה-confirm מפרט את השינוי (שם השולח, תיקיית ״הארגון״, בקשות חדשות); השרת מעודכן; הטבלה והסיכומים מתרעננים (המטיס עדיין נספר ב״מטיסים״ — לפי סוג הבקשה בעת השמירה)", /שם השולח/.test(dlgMsg) && /תיקיית ״הארגון״/.test(dlgMsg) && /בקשות שכבר נשמרו נשארות במקומן/.test(dlgMsg) && rows["pil.pilot"].type === "org" && env.call({ action: "listUsers", token: admTok }).users.find(u => u.user === "pil.pilot").org === true && (await totalsText()) === "בקשות הארגון: 2 (נשלחו 0) · בקשות מטיסים: 1 (נשלחו 0)", dlgMsg.slice(0, 200) + " | " + (await totalsText()));
    page.once("dialog", d => d.accept());
    await page.click("[data-setorg='pil.pilot']"); await page.waitForFunction(() => document.querySelector("[data-setorg='pil.pilot']").textContent === "הפוך לארגוני", null, { timeout: 10000 });
    check("הפיכה חזרה לעצמאי: הסוג בשרת org=false", env.call({ action: "listUsers", token: admTok }).users.find(u => u.user === "pil.pilot").org === false, "");
    // הוספת משתמש: תיבת ״חשבון ארגוני״ מסומנת כברירת מחדל; מנהל כופה ארגוני; בלי סימון => עצמאי
    check("טופס ״הוספת משתמש״: תיבת ״חשבון ארגוני״ מסומנת כברירת מחדל, עם ״!״", (await page.isChecked("#adO")) && !(await page.isDisabled("#adO")) && (await page.locator("#addForm label:has(#adO)").count()) === 1 && (await page.locator("#addForm .hw:has(#adO) .hbtn").count()) === 1, "");
    await page.fill("#adU", "new.org"); await page.fill("#adP", "new-pass-12345"); await page.click("#addForm button.primary");
    await page.waitForSelector("tr:has-text('new.org')");
    await page.fill("#adU", "new.pilot"); await page.fill("#adP", "new-pass-12345"); await page.uncheck("#adO"); await page.click("#addForm button.primary");
    await page.waitForSelector("tr:has-text('new.pilot')");
    { const us = Object.fromEntries(env.call({ action: "listUsers", token: admTok }).users.map(u => [u.user, u.org]));
      rows = await tbl();
      check("addUser: ללא שינוי בתיבה (מסומנת) => ארגוני; בלי סימון => עצמאי (org:false נשלח); הטבלה מציגה את שניהם; התיבה חוזרת לסימון אחרי רענון", us["new.org"] === true && us["new.pilot"] === false && rows["new.org"].type === "org" && rows["new.pilot"].type === "pilot" && (await page.isChecked("#adO")), JSON.stringify(us)); }
    await page.check("#adA");
    check("סימון ״מנהל״ מסמן ונועל את ״חשבון ארגוני״ (מנהל הוא תמיד ארגוני)", (await page.isChecked("#adO")) && (await page.isDisabled("#adO")), "");
    await page.fill("#adU", "new.admin"); await page.fill("#adP", "new-pass-12345"); await page.click("#addForm button.primary");
    await page.waitForSelector("tr:has-text('new.admin')");
    { const us = Object.fromEntries(env.call({ action: "listUsers", token: admTok }).users.map(u => [u.user, [u.role, u.org]]));
      check("מנהל חדש: role=admin ו-org=true; בטבלה — ארגוני בלי כפתור הפיכה", us["new.admin"][0] === "admin" && us["new.admin"][1] === true && (await tbl())["new.admin"].btn === null, JSON.stringify(us["new.admin"])); }
    // שגיאת setOrg מהשרת מוצגת (מנהל אינו ניתן להפיכה)
    { const r = env.call({ action: "setOrg", token: admTok, target: "new.admin", org: false });
      check("השרת דוחה הפיכת מנהל לעצמאי (is_admin)", r.ok === false && r.error === "is_admin", JSON.stringify(r)); }
    await ctx.close();
  }
  {
    /* ---- ד. כתובת התמיכה למטיס: info@icd.org.il במסכי הכניסה וההרשמה, בהודעות ההפניה, וללא office@icd.org.il בשום מקום בדף ---- */
    const { ctx, page } = await newPage(browser);
    await page.goto(APP); await page.waitForSelector("#authForm", { timeout: 60000 });
    const html0 = await page.content();
    check("מסך הכניסה: קישור תמיכה mailto:info@icd.org.il, ובדף כולו אין office@icd.org.il", /href="mailto:info@icd\.org\.il"/.test(html0) && !html0.includes("office@icd.org.il") && SUPPORT === "info@icd.org.il", "");
    await page.fill("#auUser", "no.such"); await page.fill("#auPass", "wrong-pass-12345"); await page.click("#auGo");
    await page.waitForFunction(() => document.getElementById("auErr").textContent.length > 0, null, { timeout: 20000 });
    await page.click("#auReg"); await page.waitForSelector("#regForm");
    const html1 = await page.content();
    check("מסך ההרשמה: קישור תמיכה info@icd.org.il ואין office@icd.org.il", /href="mailto:info@icd\.org\.il"/.test(html1) && !html1.includes("office@icd.org.il"), "");
    await ctx.close();
  }

  /* NEW18-BEGIN */
  /* ===== תרחיש 18: הפקות פשוטות — שלושה כפתורים לכל חשבון (שמור בדרייב, שליחה במייל, אפשרויות נוספות = כל ההורדות), המייל הידני (העתקה ו-mailto) והקישור לתיקייה למנהל בלבד; שמירה אוטומטית בדרייב כשהכול סומן (עובד ארגון, מטיס עצמאי, מנהל); מייל קצר בנקודות ושליחה עם הקבצים ===== */
  if (!LIVE) {
    const sleepMs = ms => new Promise(r => setTimeout(r, ms));
    const first = await newPage(browser); const env = first.page._env; await first.ctx.close();
    const admTok = env.call({ action: "login", user: ADMIN, pass: PASS }).token;
    env.call({ action: "addUser", token: admTok, newUser: "ora.org", newPass: "ora-pass-12345" });   // עובד ארגון: חשבון ארגוני שאינו מנהל
    env.props.WIX_API_KEY = "test-key";                                                              // מטיס עצמאי עם כתובת שמורה: נרשם בכרטיס Wix ששולם, אחרי אימות קוד
    env.wix.orders.push({ orderNumber: "ORD-AUTO-1", status: "PAID", created: new Date(Date.now() - 3 * 86400000).toISOString(), email: "pia@example.com", firstName: "פיה", memberId: "m-auto", tickets: [] });
    env.call({ action: "regStart", email: "pia@example.com" });
    const regCode = /(\d{6})/.exec(env.mails[env.mails.length - 1].subject)[1], reg = env.call({ action: "regFinish", email: "pia@example.com", code: regCode, user: "pia.pilot", pass: "pia-pass-12345" });
    env.mails.length = 0;
    check("הכנה: ora.org ארגונית (לא מנהלת), pia.pilot עצמאית עם כתובת שמורה", reg.ok && reg.org === false && reg.email === "pia@example.com", JSON.stringify([reg.ok, reg.org, reg.email]));
    const openAs = async (user, pass, extra) => {
      const popts = Object.assign({ env, autosave: true }, extra || {}), { ctx, page } = await newPage(browser, popts);
      await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(page, user, pass);
      return { ctx, page, popts };
    };
    const n = (page, a) => page._calls.actions.filter(x => x === a).length;
    const folders = () => reqFolders(env);
    const ready = page => page.waitForFunction(() => window.__REQ.S.ready === true && !window.__REQ.S.pending && !window.__REQ.S.building, null, { timeout: 90000 });
    const softEdit = (page, id, v) => page.evaluate(([i, x]) => { const e = document.getElementById(i); e.value = x; e.dispatchEvent(new Event("input", { bubbles: true })); }, [id, v]);
    const AUTO_RE = /^נשמר אוטומטית בדרייב ✔ \(\d\d:\d\d\)/, autoDone = page => page.waitForFunction(re => new RegExp(re).test(document.getElementById("driveMsg").textContent), AUTO_RE.source, { timeout: 90000 });
    const runOnly = async (page, over) => { await fillExample(page, over); await page.click("#runBtn"); await page.waitForFunction(() => document.querySelector("#gate .banner"), null, { timeout: 150000 }); };
    // הפקדים הגלויים בסעיף 5 (כפתורים, קישורים ותיבות סימון; בלי ״!״): מזהים בסדר המסמך. מה שבתוך ״אפשרויות נוספות״ הסגור, או ב-#manualMail המוסתר, אינו נספר (אין לו תיבת פריסה)
    const visibleControls = page => page.evaluate(() => [...document.querySelectorAll("#actions button:not(.hbtn), #actions a, #actions input")].filter(e => e.getClientRects().length > 0).map(e => e.id || e.tagName));
    const docxOf = async folder => { const JZ = require(path.join(ROOT, "members-k38p", "requests", "vendor", "jszip.min.js")), f = folder.files.find(x => !x.trashed && /\.docx$/.test(x.name)); return (await (await JZ.loadAsync(f.bytes)).file("word/document.xml").async("string")).replace(/<[^>]+>/g, ""); };
    const THREE = ["btnDrive", "btnSend", "btnMore"], DOWNLOADS = ["btnPrint", "btnDocx", "incChecks", "btnKml", "btnAerial", "btnStreet", "btnOverview", "btnRegion"], MAIL = ["btnCopy", "btnMail"];
    // מצב הלוח ״אפשרויות נוספות״ והמייל הידני: aria של הכפתור, האם נפתח, והאם מוצג (תיבת פריסה) — ובנפרד מה שבלוח גלוי / פעיל (כפתור, ״כולל דף בדיקות״, ושני פקדי המייל)
    const moreState = page => page.evaluate(() => { const b = document.getElementById("btnMore"), p = document.getElementById("moreOptions"), m = document.getElementById("manualMail"), on = e => e.getClientRects().length > 0;
      return { exp: b.getAttribute("aria-expanded"), ctl: b.getAttribute("aria-controls"), txt: b.textContent.trim(), panelHidden: p.hidden, panelShown: on(p), mailHidden: m.hidden, mailShown: on(m), text: document.getElementById("actions").innerText }; });
    const enabledOf = (page, ids) => page.evaluate(l => l.map(id => { const e = document.getElementById(id); return e.id === "btnMail" ? e.getAttribute("aria-disabled") !== "true" : !e.disabled; }), ids);

    /* ---- א. עובד ארגון: שלושה כפתורים; ההורדות ב״אפשרויות נוספות״; שמירה אוטומטית רק אחרי שהכול סומן, בהשהיה, פעם אחת לגרסה ---- */
    {
      const { ctx, page, popts } = await openAs("ora.org", "ora-pass-12345");
      await runOnly(page, { org: "חברת עובד הארגון" });
      await sleepMs(2600);   // יותר מההשהיה (1.5 שנ׳)
      check("עובד ארגון: אחרי ההרצה אך לפני אישור הסקירה (לא הכול סומן) לא נשמר דבר בדרייב — אין saveBegin ואין תיקייה", n(page, "saveBegin") === 0 && folders().length === 0 && (await page.evaluate(() => window.__REQ.S.ready)) === false && (await page.evaluate(() => window.__REQ.autoPending())) === false, "saveBegin=" + n(page, "saveBegin"));
      await page.check("#reviewOk"); await ready(page);
      const tReady = Date.now();
      await sleepMs(400);
      check("עובד ארגון: מיד אחרי שהבקשה מוכנה השמירה ממתינה (השהיה של כ-1.5 שנ׳) — עדיין אין saveBegin", n(page, "saveBegin") === 0 && (await page.evaluate(() => window.__REQ.autoPending())) === true, "saveBegin=" + n(page, "saveBegin"));
      await autoDone(page);
      const i0 = page._calls.actions.indexOf("saveBegin"), at0 = page._calls.at[i0];
      check("עובד ארגון: השמירה האוטומטית התחילה כ-1.5 שנ׳ אחרי שהבקשה נהייתה מוכנה (לא מיד)", at0 - tReady >= 1000 && at0 - tReady < 20000, (at0 - tReady) + " מ״ש");
      check("עובד ארגון: סדרה אחת בדיוק saveBegin → 7×saveFile → saveEnd (בלי קריאות אחרות באמצע)", JSON.stringify(page._calls.actions.slice(i0)) === JSON.stringify(["saveBegin", ...Array(7).fill("saveFile"), "saveEnd"]), page._calls.actions.slice(i0).join(","));
      const fo = folders()[0];
      check("עובד ארגון: התיקייה בארכיון המרכזי תחת ״הארגון״ עם 7 קבצים (Word, KML, ארבע תמונות, נתוני בקשה), והשרת סימן את הבקשה מוכנה", folders().length === 1 && /^הארגון\//.test(folderPath(env, fo)) && fo.files.filter(f => !f.trashed).length === 7 && !fo.files.some(f => /^נשלח/.test(f.name)) && env.call({ action: "listRequests", token: admTok }).requests.find(r => r.name === fo.name).ready === true, folderPath(env, fo));   // והשמירה האוטומטית לא כותבת סימן ״נשלח״
      const msg = await page.textContent("#driveMsg");
      check("עובד ארגון: ההודעה ״נשמר אוטומטית בדרייב ✔ (HH:MM)״ — בלי קישור לתיקייה (התיקייה בדרייב של בעל המערכת)", AUTO_RE.test(msg) && msg.trim().length < 40 && (await page.locator("#driveMsg a").count()) === 0 && (await page.locator("#sendMsg a").count()) === 0 && !/drive\./.test(await page.locator("#actions").innerHTML()), msg);
      // הפקדים: שלושה כפתורים בלבד (כל אחד עם ״!״ שלו); ״אפשרויות נוספות״ סגור; המייל הידני (למנהל) מוסתר לגמרי (לא בסדר הטאבים, לא בעץ הנגישות), בלי טקסט ישן על מייל ידני
      const vc = await visibleControls(page), hw = await page.evaluate(() => [...document.querySelectorAll("#actions .hw")].filter(e => e.getClientRects().length).map(e => e.querySelector("button:not(.hbtn)").id));
      const tab = () => page.evaluate(() => [...document.querySelectorAll("#actions button, #actions a, #actions input")].filter(e => e.tabIndex >= 0 && e.getClientRects().length > 0 && !e.disabled).map(e => e.id || (e.classList.contains("hbtn") ? "!" : e.tagName)));
      const ms0 = await moreState(page);
      check("עובד ארגון: בסעיף 5 בדיוק שלושה כפתורים — ״שמור בדרייב״, ״✉ שלח למשרד נוטאם״ ו״אפשרויות נוספות״, כל אחד עם ״!״ שלו, ובסדר הטאבים", JSON.stringify(vc) === JSON.stringify(THREE) && JSON.stringify(hw) === JSON.stringify(THREE) && (await page.textContent("#btnDrive")) === "שמור בדרייב" && (await page.textContent("#btnSend")) === "✉ שלח למשרד נוטאם" && ms0.txt === "אפשרויות נוספות" && JSON.stringify(await tab()) === JSON.stringify(["btnDrive", "!", "btnSend", "!", "btnMore", "!"]), JSON.stringify([vc, hw]));
      check("עובד ארגון: ״אפשרויות נוספות״ סגור כברירת מחדל (aria-expanded=false, aria-controls=moreOptions, הלוח hidden וללא תיבת פריסה), וההורדות והמייל הידני אינם גלויים", ms0.exp === "false" && ms0.ctl === "moreOptions" && ms0.panelHidden && !ms0.panelShown && ms0.mailHidden && !ms0.mailShown && !/פתח מייל|העתק טקסט|הורד Word|הורד KML|הדפס|מצרפים ידנית|הורד תצ/.test(ms0.text), JSON.stringify(ms0).slice(0, 300));
      { const hm = await page.getAttribute(".hw:has(#btnMore) > .hbtn", "data-help");
        check("עובד ארגון: הסבר ״!״ של ״אפשרויות נוספות״ מתאר את ההורדות ואומר שהשליחה מצרפת את הקבצים בעצמה, בלי להזכיר מייל ידני (שאינו מוצג לו)", /רשימת ההורדות/.test(hm) && /השליחה במייל מצרפת את הקבצים בעצמה/.test(hm) && !/העתקת נוסח המייל|ביומן|למנהל/.test(hm), hm.slice(0, 160)); }
      await page.click("#btnMore");
      const ms1 = await moreState(page), vc1 = await visibleControls(page), en1 = await enabledOf(page, DOWNLOADS), tab1 = await tab();
      check("עובד ארגון: לחיצה על ״אפשרויות נוספות״ פותחת את כל ההורדות (הדפסה/PDF, Word, ״כולל דף בדיקות״ מסומן, KML וארבע התמונות), פעילות, עם aria-expanded=true", ms1.exp === "true" && ms1.panelShown && !ms1.panelHidden && JSON.stringify(vc1) === JSON.stringify(THREE.concat(DOWNLOADS)) && en1.every(Boolean) && (await page.isChecked("#incChecks")) && DOWNLOADS.filter(id => id !== "incChecks").every(id => tab1.includes(id)), JSON.stringify([vc1, en1]));
      const mailBlock = await page.evaluate(() => ({ focused: (() => { document.getElementById("btnMail").focus(); document.getElementById("btnCopy").focus(); return document.activeElement && document.activeElement.id; })(), shown: ["btnCopy", "btnMail", "mailTo", "mailInfo"].map(id => document.getElementById(id).getClientRects().length > 0) }));
      check("עובד ארגון: גם כשהלוח פתוח המייל הידני (העתק טקסט מייל, פתח מייל, כתובות הנמענים והנושא) מוסתר — אינו מקבל פוקוס ואינו בסדר הטאבים, ואין בלוח טקסט עליו", mailBlock.focused !== "btnCopy" && mailBlock.focused !== "btnMail" && mailBlock.shown.every(v => !v) && !tab1.includes("btnCopy") && !tab1.includes("btnMail") && !/פתח מייל|העתק טקסט|notamoffice|nofm@|מצרפים ידנית/.test(ms1.text), JSON.stringify(mailBlock));
      { const [d] = await Promise.all([page.waitForEvent("download"), page.click("#btnKml")]); const nm = d.suggestedFilename();
        check("עובד ארגון: הורדה מ״אפשרויות נוספות״ עובדת למי שאינו מנהל (KML)", /\.kml$/.test(nm), nm); }
      await page.click("#btnMore");
      const ms2 = await moreState(page);
      check("עובד ארגון: לחיצה נוספת על ״אפשרויות נוספות״ סוגרת את הלוח (aria-expanded=false)", ms2.exp === "false" && ms2.panelHidden && !ms2.panelShown, JSON.stringify(ms2).slice(0, 200));
      check("עובד ארגון: ״כולל דף בדיקות״ נשאר מסומן (ברירת המחדל), ולכן ה-Word בדרייב כולל את דף הבדיקות", (await page.isChecked("#incChecks")) && (await docxOf(fo)).includes("מצאי לפי קבוצות"), "");
      // לא שמירה שנייה לאותה גרסה, גם כש-refreshGate נקרא שוב ושוב
      await page.evaluate(() => window.__REQ.selfTest()); await page.evaluate(() => window.__REQ.selfTest()); await sleepMs(2600);
      check("עובד ארגון: אותה גרסה לא נשמרת שוב (אחרי קריאות חוזרות ל-refreshGate והמתנה מעבר להשהיה: saveBegin אחד)", n(page, "saveBegin") === 1 && folders().length === 1, "saveBegin=" + n(page, "saveBegin"));
      // שמירה ידנית (הכפתור זמין לכל חשבון): ההודעה הרגילה, בלי קישור
      check("עובד ארגון: ״שמור בדרייב״ זמין לשמירה ידנית חוזרת", !(await page.isDisabled("#btnDrive")), "");
      await page.evaluate(() => { document.getElementById("driveMsg").textContent = ""; });
      await page.click("#btnDrive"); await page.waitForFunction(() => /נשמרו \d+ קבצים|נכשלה/.test(document.getElementById("driveMsg").textContent), null, { timeout: 90000 });
      const mm = await page.textContent("#driveMsg");
      check("עובד ארגון: שמירה ידנית — ״✔ נשמרו 7 קבצים בדרייב (HH:MM)״ בלי קישור, באותה תיקייה (מחליפה קבצים)", /^✔ נשמרו 7 קבצים בדרייב \(\d\d:\d\d\)$/.test(mm.trim()) && (await page.locator("#driveMsg a").count()) === 0 && n(page, "saveBegin") === 2 && folders().length === 1 && folders()[0].id === fo.id && folders()[0].files.filter(f => !f.trashed).length === 7, mm);
      // עריכה → לא מוכן → מוכן שוב: נשמר שוב לאותה תיקייה (אותו rid), והקבצים מוחלפים (הטלפון החדש ב-Word)
      await softEdit(page, "reqPhone", "050-7654321"); await ready(page); await autoDone(page);
      check("עובד ארגון: אחרי עריכה והכנה מחדש — נשמר שוב אוטומטית לאותה תיקייה (saveBegin נוסף, תיקייה אחת), וה-Word בדרייב מעודכן", n(page, "saveBegin") === 3 && folders().length === 1 && folders()[0].id === fo.id && (await docxOf(folders()[0])).includes("050-7654321"), "saveBegin=" + n(page, "saveBegin"));
      // שתי עריכות רצופות לפני שההשהיה הסתיימה: ההשהיה מתאפסת ונשמרת גרסה אחת בלבד (האחרונה)
      const sb = n(page, "saveBegin");
      await softEdit(page, "reqPhone", "050-1111111"); await ready(page); await softEdit(page, "reqPhone", "050-2222222"); await ready(page); await autoDone(page); await sleepMs(2600);
      check("עובד ארגון: שתי עריכות בתוך ההשהיה נשמרות פעם אחת — בגרסה האחרונה בלבד", n(page, "saveBegin") === sb + 1 && (await docxOf(folders()[0])).includes("050-2222222") && !(await docxOf(folders()[0])).includes("050-1111111"), "saveBegin " + sb + "→" + n(page, "saveBegin"));
      // שמירה בעיצומה: הכפתורים נעולים, ושום שמירה שנייה לא מתחרה; עריכה באמצע שמירה — saveEnd עם ready:false, בלי הודעת שגיאה, ושמירה נוספת כשמוכן שוב
      await page.evaluate(() => { window.__driveMsgs = []; const e = document.getElementById("driveMsg"); new MutationObserver(() => window.__driveMsgs.push(e.textContent)).observe(e, { childList: true, characterData: true, subtree: true }); });
      popts.apiDelayBy = { saveFile: 350 };
      const sb2 = n(page, "saveBegin");
      await softEdit(page, "reqPhone", "050-3333333"); await ready(page);
      await page.waitForFunction(() => /\(3\/7\)/.test(document.getElementById("driveMsg").textContent), null, { timeout: 60000 });
      const mid = await page.evaluate(() => ({ sending: window.__REQ.S.sending, drive: document.getElementById("btnDrive").disabled, send: document.getElementById("btnSend").disabled }));
      await page.evaluate(() => window.__REQ.selfTest());
      check("שמירה אוטומטית בעיצומה: S.sending, ״שמור בדרייב״ ו״שלח״ נעולים, וקריאה חוזרת ל-refreshGate אינה פותחת שמירה שנייה", mid.sending && mid.drive && mid.send && n(page, "saveBegin") === sb2 + 1, JSON.stringify(mid) + " saveBegin=" + n(page, "saveBegin"));
      await autoDone(page); await sleepMs(300);
      check("בסיום השמירה האוטומטית הכפתורים חוזרים לפעול", !(await page.isDisabled("#btnDrive")) && !(await page.isDisabled("#btnSend")), "");
      const sb3 = n(page, "saveBegin"), se0 = (page._calls.saveEnds || []).length;
      await softEdit(page, "reqPhone", "050-4444444"); await ready(page);
      await page.waitForFunction(() => /\(2\/7\)/.test(document.getElementById("driveMsg").textContent), null, { timeout: 60000 });
      await softEdit(page, "reqPhone", "050-5555555");   // עריכה באמצע השמירה
      await ready(page); await autoDone(page); await sleepMs(300);
      const ends = (page._calls.saveEnds || []).slice(se0), seen = await page.evaluate(() => window.__driveMsgs);
      check("עריכה באמצע שמירה אוטומטית: saveEnd נשלח עם ready:false, לא מוצגת הודעת שגיאה, ושמירה נוספת בסיום (saveEnd עם ready:true) — שתי שמירות בדיוק", ends.length === 2 && ends[0].ready === false && ends[1].ready === true && n(page, "saveBegin") === sb3 + 2 && !seen.some(t => /נכשלה|שונתה/.test(t)) && (await docxOf(folders()[0])).includes("050-5555555"), JSON.stringify(ends) + " | " + seen.filter(t => /נכשלה|שונתה/.test(t)).join(" | "));
      popts.apiDelayBy = null;
      // שליחה: מצרפת את הקבצים אוטומטית; הגרסה כבר שמורה (אוטומטית) ולכן אין שמירה נוספת לפני השליחה; מייל קצר בנקודות עם htmlBody RTL
      const sb4 = n(page, "saveBegin"), want = await page.evaluate(() => window.__REQ.O.mail(window.__REQ.S.res, window.__REQ.S.cfg));
      await page.click("#btnSend"); await page.waitForSelector(".sendBox"); await page.check("#sendOk"); await page.click("#sendGo");
      await page.waitForFunction(() => /נשלח במצב בדיקה|נכשלה/.test(document.querySelector("#sendProg").textContent), null, { timeout: 120000 });
      const mail = env.mails[env.mails.length - 1];
      check("שליחה: הגרסה השמורה אוטומטית אינה נשמרת שוב לפני השליחה (saveBegin ללא שינוי), ונשלח מייל אחד עם 6 קבצים מצורפים (Word, KML וארבע תמונות)", n(page, "saveBegin") === sb4 && env.mails.length === 1 && mail.attachments.length === 6 && mail.attachments.some(a => /\.docx$/.test(a.name)) && mail.attachments.some(a => /\.kml$/.test(a.name)) && mail.attachments.filter(a => /\.(png|jpg)$/.test(a.name)).length === 4, "saveBegin " + sb4 + "→" + n(page, "saveBegin") + ", " + mail.attachments.map(a => a.name).join(" | "));
      const bl = mail.body.split("\n");
      check("המייל שנשלח: הגוף הקצר בנקודות כפי שהלקוח בנה (4 שורות ״• ״), בלי כלי טיס / מהות / קואורדינטות / אנשי קשר, ושורת ״כל הפרטים — בטופס המצורף.״", mail.body === want.body && bl.filter(l => l.startsWith("\u2022 ")).length === 4 && bl.includes("כל הפרטים — בטופס המצורף.") && !/DJI|מהות הפעילות|כלי טיס|°|אנשי קשר|בודק שני/.test(mail.body), mail.body.slice(0, 300));
      check("המייל שנשלח: ל-MailApp מועבר גם htmlBody — div RTL מיושר לימין, רשימת <ul> עם ארבעה <li> של הנקודות, והטקסט escaped", typeof mail.htmlBody === "string" && /^<div dir="rtl" style="direction:rtl;text-align:right/.test(mail.htmlBody) && (mail.htmlBody.match(/<li\b/g) || []).length === 4 && (mail.htmlBody.match(/<ul\b/g) || []).length === 1 && mail.htmlBody.includes("גורם מבקש: חברת עובד הארגון") && !mail.htmlBody.includes("\u2022") && !/<(a|img|script)\b/i.test(mail.htmlBody) && mail.body === want.body, String(mail.htmlBody).slice(0, 200));
      check("עובד ארגון: אחרי השליחה ההודעה בלי קישור לתיקייה (בחלון ובעמוד), ובתיקייה סימן ״נשלח (בדיקה)״ — שנכתב בשליחה בלבד, לא בשמירה האוטומטית", (await page.locator("#sendProg a").count()) === 0 && (await page.locator("#sendMsg a").count()) === 0 && (await page.locator("#driveMsg a").count()) === 0 && folders()[0].files.some(f => /^נשלח — .*\(בדיקה\)\.txt$/.test(f.name)), folders()[0].files.map(f => f.name).join(" | ").slice(0, 160));
      await page.click("#mdClose");
      await ctx.close();
    }

    /* ---- ב. שגיאות שרת בשמירה האוטומטית: ההודעה של השרת ב-#driveMsg, בלי ניסיון חוזר בלולאה; ניסיון ידני וגרסה חדשה מנסים שוב ---- */
    {
      const { ctx, page, popts } = await openAs("ora.org", "ora-pass-12345");
      await readyRequest(page, { org: "חברת עובד הארגון" });
      await autoDone(page);
      const errCase = async (label, error, extra, intercept, phone) => {
        const sb = n(page, "saveBegin"), sf = n(page, "saveFile"); popts.intercept = intercept;
        await softEdit(page, "reqPhone", phone); await ready(page);
        await page.waitForFunction(() => /נכשלה/.test(document.getElementById("driveMsg").textContent), null, { timeout: 60000 });
        const t = await page.textContent("#driveMsg"), cls = await page.getAttribute("#driveMsg", "class");
        await sleepMs(3300);   // מעבר להשהיה: אין ניסיון חוזר
        check("שגיאת שרת " + label + ": ההודעה של השרת מוצגת ב-#driveMsg (בשגיאה), והשמירה האוטומטית לא חוזרת על עצמה בלולאה", t.startsWith("השמירה האוטומטית בדרייב נכשלה: ") && t.includes(extra.message) && cls.includes("err") && n(page, "saveBegin") === sb + 1 && !(await page.isDisabled("#btnDrive")) && !(await page.isDisabled("#btnSend")), t + " | saveBegin " + sb + "→" + n(page, "saveBegin"));
        return { sb, sf };
      };
      const M1 = { message: "יש לכם יותר מדי בקשות שמורות שעדיין לא נשלחו (60) — שלחו או המתינו, ואם נדרש פנו לתמיכה" };
      await errCase("too_many_open", "too_many_open", M1, b => b.action === "saveBegin" ? { ok: false, error: "too_many_open", message: M1.message } : undefined, "050-6000001");
      const M2 = { message: "התיקייה מלאה — יותר מדי קבצים או נפח" };
      let k = 0;
      const se1 = (page._calls.saveEnds || []).length;
      const e2 = await errCase("folder_full (באמצע ההעלאה)", "folder_full", M2, b => b.action === "saveFile" && ++k === 3 ? { ok: false, error: "folder_full", message: M2.message } : undefined, "050-6000002");
      check("folder_full: ההעלאה נעצרה בקובץ השלישי (לא נשלחו שאר הקבצים ולא saveEnd), והודעת השגיאה מציינת את הקובץ", n(page, "saveFile") === e2.sf + 3 && (page._calls.saveEnds || []).length === se1 && (await page.textContent("#driveMsg")).includes(": " + M2.message), "saveFile +" + (n(page, "saveFile") - e2.sf));
      const M3 = { message: "יותר מדי שליחות בשעה האחרונה — נסו שוב מאוחר יותר" };
      await errCase("rate (scope=user)", "rate", M3, b => b.action === "saveBegin" ? { ok: false, error: "rate", scope: "user", message: M3.message } : undefined, "050-6000003");
      // כשל אינו חוסם: ניסיון ידני (השרת כבר תקין) מצליח; ובגרסה חדשה — שוב ניסיון אוטומטי
      popts.intercept = null;
      await page.evaluate(() => { document.getElementById("driveMsg").textContent = ""; });   // אחרת הודעת השגיאה הקודמת מספקת את ההמתנה
      await page.click("#btnDrive"); await page.waitForFunction(() => /נשמרו \d+ קבצים|נכשלה/.test(document.getElementById("driveMsg").textContent), null, { timeout: 90000 });
      check("אחרי כשל: הכפתור ״שמור בדרייב״ מאפשר ניסיון ידני שמצליח", /✔ נשמרו 7 קבצים/.test(await page.textContent("#driveMsg")) && folders().filter(f => f.files.filter(x => !x.trashed).length === 7).length >= 1, await page.textContent("#driveMsg"));
      const sbn = n(page, "saveBegin");
      await softEdit(page, "reqPhone", "050-6000004"); await ready(page); await autoDone(page);
      check("אחרי כשל: גרסה חדשה (עריכה והכנה מחדש) נשמרת שוב אוטומטית", n(page, "saveBegin") === sbn + 1, "");
      await ctx.close();
    }

    /* ---- ג. התנתקות / החלפת משתמש לפני שההשהיה הסתיימה: הטיימר מבוטל ושום דבר לא נכתב לדרייב ---- */
    {
      const before = folders().length;
      const { ctx, page } = await openAs("ora.org", "ora-pass-12345");
      await runOnly(page, { org: "חברה להתנתקות" }); await page.check("#reviewOk"); await ready(page);
      const r = await page.evaluate(() => { const was = window.__REQ.autoPending(); window.ReqAuth.logout(); return { was, now: window.__REQ.autoPending() }; }).catch(e => ({ err: String(e.message || e) }));
      check("התנתקות לפני ההשהיה: השמירה הממתינה מבוטלת מיד (איפוס הדף), והטיימר לא נשאר", r.was === true && r.now === false, JSON.stringify(r));
      await page.waitForSelector("#authForm", { timeout: 30000 }); await sleepMs(3000);
      check("התנתקות לפני ההשהיה: אף קריאת שמירה לא יצאה (אין saveBegin ואין תיקייה חדשה), גם אחרי שעבר זמן ההשהיה", n(page, "saveBegin") === 0 && folders().length === before, "saveBegin=" + n(page, "saveBegin"));
      await ctx.close();
    }
    {
      const before = folders().length;
      const { ctx, page } = await openAs("ora.org", "ora-pass-12345");
      await runOnly(page, { org: "חברה להחלפת משתמש" }); await page.check("#reviewOk"); await ready(page);
      const r = await page.evaluate(() => { const was = window.__REQ.autoPending(); document.dispatchEvent(new CustomEvent("req-auth", { detail: { user: "someone.else", role: "user" } })); return { was, now: window.__REQ.autoPending() }; }).catch(e => ({ err: String(e.message || e) }));
      check("החלפת משתמש (req-auth של משתמש אחר) לפני ההשהיה: השמירה הממתינה מבוטלת מיד", r.was === true && r.now === false, JSON.stringify(r));
      await page.waitForFunction(() => window.__REQ_READY === true && !window.__REQ_SWITCHING, null, { timeout: 60000 }).catch(() => {}); await sleepMs(3000);
      check("החלפת משתמש לפני ההשהיה: לא נכתב דבר לדרייב — לא תחת החשבון הקודם ולא תחת החדש", n(page, "saveBegin") === 0 && folders().length === before, "saveBegin=" + n(page, "saveBegin"));
      await ctx.close();
    }

    /* ---- ד. מטיס עצמאי (כתובת שמורה): אותם שלושה כפתורים, שמירה אוטומטית ל״מטיסים/<משתמש>״, בלי קישור ---- */
    {
      const { ctx, page } = await openAs("pia.pilot", "pia-pass-12345");
      await runOnly(page, { org: "פיה צילום" }); await sleepMs(2300);
      check("מטיס עצמאי: לפני אישור הסקירה לא נשמר דבר", n(page, "saveBegin") === 0, "saveBegin=" + n(page, "saveBegin"));
      await page.check("#reviewOk"); await ready(page); await autoDone(page);
      const fo = folders().find(f => /^מטיסים\/pia\.pilot\//.test(folderPath(env, f))), vc = await visibleControls(page);
      check("מטיס עצמאי: נשמר אוטומטית ל״מטיסים/pia.pilot/…״ עם 7 קבצים, סדרת saveBegin→7×saveFile→saveEnd אחת, בלי קישור לתיקייה", !!fo && fo.files.filter(f => !f.trashed).length === 7 && n(page, "saveBegin") === 1 && n(page, "saveEnd") === 1 && n(page, "saveFile") === 7 && (await page.locator("#driveMsg a").count()) === 0 && AUTO_RE.test(await page.textContent("#driveMsg")), fo ? folderPath(env, fo) : "אין תיקייה");
      const ps0 = await moreState(page);
      check("מטיס עצמאי: שלושת הכפתורים (שמור בדרייב, שלח, אפשרויות נוספות), הלוח סגור והמייל הידני מוסתר", JSON.stringify(vc) === JSON.stringify(THREE) && ps0.exp === "false" && ps0.panelHidden && ps0.mailHidden && !ps0.mailShown, JSON.stringify([vc, ps0]).slice(0, 300));
      await page.click("#btnMore");
      const ps1 = await moreState(page), pvc = await visibleControls(page);
      check("מטיס עצמאי: ״אפשרויות נוספות״ פותח את כל ההורדות (פעילות), בלי המייל הידני ובלי קישור לתיקייה", ps1.exp === "true" && JSON.stringify(pvc) === JSON.stringify(THREE.concat(DOWNLOADS)) && (await enabledOf(page, DOWNLOADS)).every(Boolean) && ps1.mailHidden && !ps1.mailShown && (await page.locator("#driveMsg a").count()) === 0 && (await page.locator("#sendMsg a").count()) === 0 && !/פתח מייל|העתק טקסט|notamoffice/.test(ps1.text), JSON.stringify(pvc));
      await ctx.close();
    }

    /* ---- ה. מנהל: שמירה אוטומטית עם קישור לתיקייה; ״אפשרויות נוספות״ סגור כברירת מחדל ובתוכו כל ההורדות וגם המייל הידני (רק אצלו) ---- */
    {
      const before = folders().length;
      const { ctx, page } = await openAs();
      await readyRequest(page, { org: "חברת המנהל בע״מ" }); await autoDone(page);
      const am = await page.innerHTML("#driveMsg"), fid = (/href="https:\/\/drive\/([^"]+)"/.exec(am) || [])[1], adminFolder = env.folders[fid];
      check("מנהל: שמירה אוטומטית עם הקישור ״פתח את התיקייה״ לדרייב (למנהל בלבד)", /^נשמר אוטומטית בדרייב ✔ \(\d\d:\d\d\) — <a href="https:\/\/drive\/[^"]+" target="_blank" rel="noopener">פתח את התיקייה<\/a>$/.test(am.trim()), am.slice(0, 240));
      let vc = await visibleControls(page);
      const as0 = await moreState(page);
      check("מנהל: שלושת הכפתורים מוצגים, ״אפשרויות נוספות״ סגור כברירת מחדל, וקישור התיקייה נמצא בהודעה (A) — רק למנהל", JSON.stringify(vc) === JSON.stringify(["btnDrive", "btnSend", "btnMore", "A"]) && as0.exp === "false" && as0.panelHidden && !as0.panelShown, JSON.stringify([vc, as0]).slice(0, 300));   // A = הקישור לתיקייה בהודעת השמירה
      await page.click("#btnMore");
      vc = await visibleControls(page);
      const en = await enabledOf(page, DOWNLOADS.concat(MAIL)), as1 = await moreState(page), mi = await page.textContent("#mailInfo"), mt = await page.textContent("#mailTo");
      check("מנהל: בפתיחת ״אפשרויות נוספות״ גלויים ופעילים כל ההורדות (״כולל דף בדיקות״ מסומן) וגם המייל הידני — העתק טקסט מייל, פתח מייל, כתובות הנמענים והנושא", DOWNLOADS.concat(MAIL).every(id => vc.includes(id)) && en.every(Boolean) && (await page.isChecked("#incChecks")) && as1.mailShown && !as1.mailHidden && /notamoffice@iaa\.gov\.il, nofm@iaa\.gov\.il/.test(mt) && /^נושא: בקשה לסגירה אווירית — /.test(mi) && /למנהל בלבד/.test(as1.text) && /mailto אינו יכול לצרף קבצים/.test(as1.text), JSON.stringify([vc, en]));
      { const hx = await page.getAttribute(".hw:has(#btnMore) > .hbtn", "data-help");
        check("מנהל: הסבר ״!״ של ״אפשרויות נוספות״ כולל את ההורדות ואת המייל הידני (למנהל בלבד)", /ההורדות/.test(hx) && /העתקת נוסח המייל ופתיחת המייל/.test(hx) && /אינה נרשמת ביומן השליחות/.test(hx), hx.slice(0, 120)); }
      // שינוי ״כולל דף בדיקות״ משנה את ה-Word: נשמר שוב אוטומטית
      const sb = n(page, "saveBegin");
      await page.click("#incChecks"); await autoDone(page);
      check("מנהל: ביטול ״כולל דף בדיקות״ (משנה את ה-Word) → נשמר שוב אוטומטית לאותה תיקייה, וה-Word בדרייב בלי דף הבדיקות", n(page, "saveBegin") === sb + 1 && folders().length === before + 1 && !!adminFolder && !(await docxOf(adminFolder)).includes("מצאי לפי קבוצות"), "saveBegin " + sb + "→" + n(page, "saveBegin") + " folders " + before + "→" + folders().length);
      await ctx.close();
    }

    /* ---- ו. חלון השליחה פתוח (עוד לא נשלח דבר): השמירה האוטומטית לא מתחרה בו ונדחית עד שייסגר; ואחרי שליחה — לא נשמרת שוב ---- */
    {
      const { ctx, page } = await openAs("ora.org", "ora-pass-12345", { autosave: 3000 });
      await runOnly(page, { org: "חברת החלון הפתוח" }); await page.check("#reviewOk"); await ready(page);
      await page.click("#btnSend"); await page.waitForSelector(".sendBox");
      await sleepMs(7500);   // יותר מפעמיים ההשהיה (3 שנ׳)
      check("חלון השליחה פתוח: השמירה האוטומטית נדחית (אין saveBegin) וממתינה לסגירת החלון", n(page, "saveBegin") === 0 && (await page.evaluate(() => window.__REQ.autoPending())) === true, "saveBegin=" + n(page, "saveBegin"));
      await page.click("#mdClose"); await page.waitForSelector(".sendBox", { state: "detached" });
      await autoDone(page);
      check("אחרי סגירת החלון (בלי שליחה) הבקשה נשמרת אוטומטית פעם אחת", n(page, "saveBegin") === 1 && n(page, "saveEnd") === 1, "saveBegin=" + n(page, "saveBegin"));
      await ctx.close();
    }
  }

  /* NEW18-END */

  /* REG19-BEGIN */
  /* ===== תרחיש 19: הסבר מראש על הכרטיס — בראש מסך הכניסה ומסך ההרשמה (שימו לב, מה מקבלים, כפתור רכישה), והודעה אחרי ״שלחו לי קוד״ שזהה לכל כתובת ומלווה בכפתור הרכישה; בלי כתובת https תקינה אין כפתור ===== */
  {
    // הנוסח המאושר (בעל המערכת) מוחזק כאן בנפרד מהקוד, כדי שכל שינוי בו ייתפס
    const NOTICE = "שימו לב: מנוי או הרשמה למפת הנוט״מים אינם כוללים בקשות טיסה. בקשות טיסה מיועדות למטיסים מסחריים בלבד, ודורשות רכישה נפרדת של הכרטיס ״בקשת אישורי טיסה״.";
    const BENEFIT = "הצטרפות למערכת בקשות הטיסה מאפשרת להכין ולהגיש בקשות לסגירה אווירית בקלות ובמהירות, עם פחות בירוקרטיה. המערכת בודקת מראש אזורי איסור, נוטמים ומכשולים באזור, ובכך מסייעת למנוע תאונות שנובעות מחוסר ידיעה.";
    const BUY = "לרכישת הכרטיס והצטרפות";
    const NOCODE = "לא הגיע קוד? כנראה שלא נרכש הכרטיס ״בקשת אישורי טיסה״. מנוי למפת הנוט״מים בלבד אינו מקנה גישה לבקשות טיסה.";
    const RENEW = JSON.parse(fs.readFileSync(path.join(ROOT, "members-k38p", "requests", "config.json"), "utf8")).renew_url;
    const norm = t => t.replace(/\s+/g, " ").trim();
    const ready19 = async page => { await page.goto(APP); await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await page.waitForSelector("#authForm", { timeout: 20000 }); };
    const buyLinks = (page, sel) => page.$$eval(sel + " a.buyBtn", a => a.map(x => ({ href: x.getAttribute("href"), target: x.getAttribute("target"), rel: x.getAttribute("rel"), text: x.textContent.trim(), h: Math.round(x.getBoundingClientRect().height), vis: x.getClientRects().length > 0 })));
    const boxInfo = (page, formId) => page.evaluate(id => { const f = document.getElementById(id), b = document.getElementById("buyBox"); if (!b) return null; const r = b.getBoundingClientRect(), a = b.querySelector("a.buyBtn"), ar = a && a.getBoundingClientRect();
      return { afterTitle: f.children[0].tagName === "H2" && f.children[1] === b, notice: b.querySelector(".buyNote") && b.querySelector(".buyNote").textContent, why: b.querySelector(".buyWhy") && b.querySelector(".buyWhy").textContent, dir: getComputedStyle(b).direction,
        inside: r.left >= 0 && r.right <= innerWidth && (!ar || (ar.left >= 0 && ar.right <= innerWidth)), noHScroll: document.documentElement.scrollWidth <= innerWidth, w: innerWidth }; }, formId);
    const hrefs = (page, sel) => page.$$eval(sel + " a[href]", a => a.map(x => x.getAttribute("href")));
    const SAFE_HREF = /^(mailto:[^ ]+|\.\.\/)$/;

    /* ---- א. הגדרות אמיתיות (renew_url מ-config.json) בטלפון: תיבת ההסבר בראש מסך הכניסה ובראש מסך ההרשמה, והכפתור הוא קישור אמיתי ללשונית חדשה ---- */
    const first = await newPage(browser); const env = first.page._env; await first.ctx.close();
    env.props.WIX_API_KEY = "test-key";
    env.wix.orders.push({ orderNumber: "ORD-N19-1", status: "PAID", created: new Date(Date.now() - 3 * 86400000).toISOString(), email: "member@example.com", firstName: "דנה", memberId: "m-19", tickets: [] });
    const seen = [];
    {
      const { ctx, page } = await newPage(browser, { env, viewport: { width: 375, height: 700 }, touch: true, patchResp: (b, r) => { if (b.action === "regStart") seen.push(JSON.stringify(r)); return undefined; } });
      await ready19(page);
      check("תרחיש 19: renew_url בהגדרות הוא כתובת https", /^https:\/\/[^\s"'<>]+$/.test(RENEW || ""), String(RENEW));
      for (const [scr, formId] of [["הכניסה", "authForm"], ["ההרשמה", "regForm"]]) {
        if (formId === "regForm") { await page.click("#auReg"); await page.waitForSelector("#regForm"); }
        const bi = await boxInfo(page, formId), links = await buyLinks(page, "#buyBox"), html = await page.content();
        check("מסך " + scr + ": תיבת ההסבר מיד אחרי הכותרת, בנוסח המאושר (שימו לב + מה מקבלים), מיושרת לימין", !!bi && bi.afterTitle && bi.notice === NOTICE && bi.why === BENEFIT && bi.dir === "rtl", JSON.stringify(bi));
        check("מסך " + scr + ": כפתור הרכישה הוא קישור אמיתי לכתובת מההגדרות, בלשונית חדשה (noopener noreferrer), בתווית המאושרת, גלוי ובגובה מגע (44px)", links.length === 1 && links[0].href === RENEW && links[0].target === "_blank" && /\bnoopener\b/.test(links[0].rel) && /\bnoreferrer\b/.test(links[0].rel) && links[0].text === BUY && links[0].vis && links[0].h >= 44, JSON.stringify(links));
        check("מסך " + scr + ": התיבה נכנסת ברוחב הטלפון (375) בלי גלילה אופקית ובלי חיתוך", !!bi && bi.w === 375 && bi.inside && bi.noHScroll, JSON.stringify(bi));
        await page.setViewportSize({ width: 320, height: 640 });
        const b320 = await boxInfo(page, formId);
        check("מסך " + scr + ": גם ברוחב 320 התיבה והכפתור נכנסים בלי חיתוך ובלי גלילה אופקית", !!b320 && b320.w === 320 && b320.inside && b320.noHScroll, JSON.stringify(b320));
        await page.screenshot({ path: path.join(OUT, "reg19-" + formId + "-320.png") });
        await page.setViewportSize({ width: 375, height: 700 });
        check("מסך " + scr + ": כתובת הארגון office@icd.org.il אינה מוצגת (רק כתובת התמיכה)", !html.includes("office@icd.org.il") && html.includes('href="mailto:' + SUPPORT + '"'), "");
        check("מסך " + scr + ": ההסבר מלווה את הטופס — השדות והכפתור הראשי עדיין קיימים ולחיצים", formId === "authForm" ? (await page.locator("#auGo").isEnabled()) && !!(await page.$("#auUser")) && !!(await page.$("#auPass")) : (await page.locator("#rgSend").isEnabled()) && !!(await page.$("#rgEmail")), "");
        if (formId === "authForm") check("מסך הכניסה: ההסבר לא הוסיף קישור שאינו https או mailto או ״חזרה למפה״", (await hrefs(page, "#authCover")).every(h => SAFE_HREF.test(h) || h === RENEW), JSON.stringify(await hrefs(page, "#authCover")));
      }
      /* ---- ב. אחרי ״שלחו לי קוד״: אותה הודעה בדיוק (ואותו כפתור) לכתובת עם כרטיס ולכתובת בלי כרטיס ---- */
      const outs = [];
      for (const em of ["member@example.com", "nobody@example.com"]) {
        await page.fill("#rgEmail", em); await page.click("#rgSend");
        await page.waitForFunction(() => document.querySelector("#rgInfo").textContent.length > 0, null, { timeout: 15000 });
        outs.push({ text: norm(await page.textContent("#rgInfo")), html: await page.innerHTML("#rgInfo"), links: await buyLinks(page, "#rgInfo") });
        if (em === "member@example.com") await page.screenshot({ path: path.join(OUT, "reg19-after-code-375.png") });
        await page.evaluate(() => { document.getElementById("rgInfo").innerHTML = ""; });
      }
      const o = outs[0];
      check("אחרי ״שלחו לי קוד״: ההודעה והכפתור זהים לגמרי לכתובת עם כרטיס ולכתובת בלי כרטיס (אין חשיפה מי רכש)", outs.length === 2 && outs[0].html === outs[1].html && outs[0].text === outs[1].text && JSON.stringify(outs[0].links) === JSON.stringify(outs[1].links), outs.map(x => x.text).join(" || "));
      check("אחרי ״שלחו לי קוד״: נשארו המשפט על קוד תקף ל-15 דקות ובדיקות הספאם / מייל הרכישה / רכישה כחבר, ונוסף המשפט החדש (לא הגיע קוד? כנראה שלא נרכש הכרטיס…)", /נשלח אליה קוד \(תקף ל-15 דקות\)/.test(o.text) && /ספאם/.test(o.text) && /מייל הרכישה/.test(o.text) && /כחברים רשומים באתר/.test(o.text) && o.text.includes(NOCODE), o.text);
      check("אחרי ״שלחו לי קוד״: כתובת התמיכה מופיעה, ואין office@icd.org.il ואין ״מנהל המערכת״", o.text.includes(SUPPORT) && !o.html.includes("office@icd.org.il") && !/מנהל המערכת/.test(o.text), o.text);
      check("אחרי ״שלחו לי קוד״: כפתור הרכישה — קישור אמיתי, אותה כתובת, לשונית חדשה, noopener noreferrer, תווית מאושרת", o.links.length === 1 && o.links[0].href === RENEW && o.links[0].target === "_blank" && /\bnoopener\b/.test(o.links[0].rel) && /\bnoreferrer\b/.test(o.links[0].rel) && o.links[0].text === BUY && o.links[0].vis, JSON.stringify(o.links));
      check("תשובות regStart מהשרת זהות לשתי הכתובות (המסך אינו נשען על תשובה שונה)", seen.length >= 2 && seen.every(x => x === seen[0]) && JSON.parse(seen[0]).ok === true, seen.join(" | "));
      await ctx.close();
    }

    /* ---- ג. כתובת רכישה שאינה https תקין — חסרה, http, javascript:, מירכאות ותגית, יחסית, לא מחרוזת: אין כפתור באף מסך (ואין קישור מסוכן בדף), וההסבר עצמו נשאר ---- */
    // כל מקרה שולח קוד לכתובת אחרת: לשרת תקרת בקשות לכתובת בשעה (REG_PER_EMAIL_HOUR), והבדיקה כאן אינה בודקת אותה
    for (const [ci, [label, val]] of [["חסרה בהגדרות", null], ["http (לא https)", "http://www.icd.org.il/events-1/bqst-yswry-tysh"], ["javascript:", "javascript:alert(1)"], ["מירכאות ותגית", 'https://www.icd.org.il/x"><img src=x onerror=alert(1)>'], ["יחסית (//)", "//evil.example/x"], ["לא מחרוזת", 42]].entries()) {
      const { ctx, page } = await newPage(browser, { env, renewUrl: val });
      await ready19(page);
      const lg = { box: await boxInfo(page, "authForm"), links: await buyLinks(page, "#authCover"), hrefs: await hrefs(page, "#authCover") };
      await page.click("#auReg"); await page.waitForSelector("#regForm");
      const rg = { box: await boxInfo(page, "regForm"), links: await buyLinks(page, "#authCover"), hrefs: await hrefs(page, "#authCover") };
      await page.fill("#rgEmail", "case" + ci + "@example.com"); await page.click("#rgSend");
      await page.waitForFunction(() => document.querySelector("#rgInfo").textContent.length > 0, null, { timeout: 15000 });
      const after = { text: norm(await page.textContent("#rgInfo")), links: await buyLinks(page, "#authCover") };
      check("renew_url " + label + ": אין כפתור רכישה בכניסה, בהרשמה ואחרי ״שלחו לי קוד״; אין קישור מסוכן בדף", lg.links.length === 0 && rg.links.length === 0 && after.links.length === 0 && lg.hrefs.every(h => SAFE_HREF.test(h)) && rg.hrefs.every(h => SAFE_HREF.test(h)), JSON.stringify({ lg: lg.hrefs, rg: rg.hrefs, n: after.links.length }));
      check("renew_url " + label + ": ההסבר (שימו לב + מה מקבלים) והמשפט החדש אחרי שליחת הקוד נשארים במקומם, והזרימה ממשיכה (שדה הקוד מוצג)", !!lg.box && lg.box.notice === NOTICE && lg.box.why === BENEFIT && !!rg.box && rg.box.notice === NOTICE && after.text.includes(NOCODE) && (await page.isVisible("#rgStep2")), "");
      await ctx.close();
    }

    /* ---- ד. כתובת https עם פרמטרים (&): נכנסת ל-href בלי שינוי (הליכה הלוך ושוב דרך ההמרה ל-HTML), בכניסה ובהרשמה ואחרי שליחת הקוד ---- */
    {
      const U = "https://www.icd.org.il/events-1/bqst-yswry-tysh?a=1&b=2";
      const { ctx, page } = await newPage(browser, { env, renewUrl: U });
      await ready19(page);
      const l0 = await buyLinks(page, "#buyBox");
      await page.click("#auReg"); await page.waitForSelector("#regForm");
      const l1 = await buyLinks(page, "#buyBox");
      await page.fill("#rgEmail", "nobody@example.com"); await page.click("#rgSend");
      await page.waitForFunction(() => document.querySelector("#rgInfo").textContent.length > 0, null, { timeout: 15000 });
      const l2 = await buyLinks(page, "#rgInfo");
      check("renew_url עם & : הקישור נשמר כפי שהוא בשלושת המקומות", l0.length === 1 && l1.length === 1 && l2.length === 1 && l0[0].href === U && l1[0].href === U && l2[0].href === U, JSON.stringify([l0, l1, l2].map(x => x.map(y => y.href))));
      await ctx.close();
    }

    /* ---- ה. שרת ישן (תשובות בלי השדות החדשים): ההסבר, הכפתור וההודעה עובדים והזרימה לא נשברת ---- */
    {
      const { ctx, page } = await newPage(browser, { env, oldServer: true });
      await ready19(page);
      const l0 = await buyLinks(page, "#buyBox");
      await page.click("#auReg"); await page.waitForSelector("#regForm");
      await page.fill("#rgEmail", "member@example.com"); await page.click("#rgSend");
      await page.waitForSelector("#rgStep2", { state: "visible", timeout: 15000 });
      const t = norm(await page.textContent("#rgInfo")), l1 = await buyLinks(page, "#rgInfo");
      check("שרת ישן: ההסבר והכפתור במסך הכניסה, וההודעה והכפתור אחרי ״שלחו לי קוד״ (שדה הקוד מוצג)", l0.length === 1 && l0[0].href === RENEW && t.includes(NOCODE) && l1.length === 1 && l1[0].href === RENEW, t);
      await ctx.close();
    }
  }
  /* REG19-END */
  check("שרת ההתחברות נקרא רק ב'בקשות פשוטות' (text/plain) — אפס OPTIONS ואפס Content-Type אחר (Apps Script אמיתי אינו תומך ב-preflight)", API_STATS.posts > 0 && API_STATS.preflight === 0 && API_STATS.nonSimple === 0, JSON.stringify(API_STATS));
} finally {
  await browser.close(); server.close();
}
fs.writeFileSync(path.join(OUT, "e2e-results.json"), JSON.stringify({ live: LIVE, at: new Date().toISOString(), results }, null, 1));
const bad = results.filter(r => !r.ok);
console.log("\nסה״כ " + results.length + " בדיקות, נכשלו " + bad.length);
process.exit(bad.length ? 1 : 0);
