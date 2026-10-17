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
const apiHandler = (env, calls, opts) => async r => {
  const req = r.request(), m = req.method();
  if (m === "OPTIONS") { API_STATS.preflight++; return r.abort(); }
  if (m === "POST") { API_STATS.posts++; if (!/^text\/plain/i.test(req.headers()["content-type"] || "")) API_STATS.nonSimple++; }
  if (opts && opts.apiDown) return r.abort();
  const body = m === "POST" ? JSON.parse(req.postData() || "{}") : null;
  if (body && calls) calls.actions.push(body.action);
  if (opts && opts.apiDelay) await new Promise(x => setTimeout(x, opts.apiDelay));
  r.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: m === "POST" ? JSON.stringify(env.call(body)) : JSON.stringify(env.doGet()) });
};

async function newPage(browser, opts) {
  opts = opts || {};
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: "he-IL", timezoneId: "Asia/Jerusalem", acceptDownloads: true });
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
      r.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify(d) });
    });
    await page.route(/server\.arcgisonline\.com|tile\.openstreetmap\.org/, r => { calls.tiles++; if (opts.failTiles) return r.abort(); r.fulfill({ status: 200, contentType: "image/png", headers: CORS, body: tilePng(calls.tiles) }); });
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

async function readyRequest(page) {
  await fillExample(page); await page.click("#runBtn");
  await page.waitForFunction(() => document.querySelector("#gate .banner"), null, { timeout: 150000 });
  await page.check("#reviewOk");
  await page.waitForFunction(() => /הבקשה מוכנה לשליחה/.test(document.querySelector("#gate").textContent), null, { timeout: 15000 });
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
  await page.fill("#reqName", "בודק ראשון"); await page.fill("#reqPhone", "050-0000001");
  await page.fill("#contactNames", "בודק שני; בודק שלישי"); await page.fill("#contactPhone", "050-0000002");
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
    check("תמונת הרקע אמיתית (לא אריחים מדומים)", !LIVE || (await page.evaluate(() => window.__REQ.S.map && window.__REQ.S.map.background)), "");
    check("שדה 10: 262.5 רגל", /262\.5 רגל/.test(form[9]), form[9]);
    check("שדה 14: ICD", /ICD/.test(form[13]), form[13]);
    check("אזהרה על מכשולים בתוך האזור מוצגת", /מכשולים או תשתיות בתוך האזור/.test(gate), "");
    const mapTxt = await page.getAttribute("#report img.mapimg", "src");
    check("תמונת המפה בדוח נוצרה (JPEG)", mapTxt && mapTxt.startsWith("data:image/jpeg;base64,") && mapTxt.length > 30000, "אורך " + (mapTxt || "").length);
    const pngTxt = await page.evaluate(() => window.__REQ.S.map.dataUrl);
    fs.writeFileSync(path.join(OUT, "map.png"), Buffer.from(pngTxt.split(",")[1], "base64"));
    const dl = async sel => { const [d] = await Promise.all([page.waitForEvent("download"), page.click(sel)]); const p = path.join(OUT, d.suggestedFilename()); await d.saveAs(p); return p; };
    const kmlPath = await dl("#btnKml"); const kml = fs.readFileSync(kmlPath, "utf8");
    check("KML הורד ותקין", /<kml/.test(kml) && /קו מתח עליון/.test(kml) && /LLU20/.test(kml), kml.length + " בתים");
    const pngPath = await dl("#btnPng"); check("הדמיה (PNG) הורדה", fs.statSync(pngPath).size > 50000, fs.statSync(pngPath).size + " בתים");
    const ovPath = await dl("#btnOverview"); check("הדמיה — מבט כללי (PNG) הורדה", fs.statSync(ovPath).size > 50000 && path.basename(ovPath).includes("מבט כללי"), path.basename(ovPath) + " " + fs.statSync(ovPath).size);
    const aerialPath = await dl("#btnAerial"); check("תצ״א נקי (PNG) הורד", fs.statSync(aerialPath).size > 30000 && path.basename(aerialPath).includes("תצ״א"), path.basename(aerialPath) + " " + fs.statSync(aerialPath).size);
    const docxPath = await dl("#btnDocx");
    { const JZ = require(path.join(ROOT, "members-k38p", "requests", "vendor", "jszip.min.js")), z = await JZ.loadAsync(fs.readFileSync(docxPath));
      const doc = await z.file("word/document.xml").async("string"), plain = doc.replace(/<[^>]+>/g, "").replace(/[\u202a\u202c]/g, "").replace(/&quot;/g, '"');
      check("Word: קובץ docx תקין עם הטופס, שלוש תמונות ודף בדיקות", (doc.match(/<w:drawing>/g) || []).length === 3 && /32°05'56.86"N/.test(plain) && /262\.5/.test(plain) && /דוח כיסוי/.test(plain) && /אישור סקירה אנושית/.test(plain), "גודל " + fs.statSync(docxPath).size);
      check("Word: שם הקובץ כולל מיקום ותאריך", /גני יהושע|פארק הירקון/.test(path.basename(docxPath)) && /\d{2}\.\d{2}\.\d{4}/.test(path.basename(docxPath)), path.basename(docxPath)); }
    const href = await page.getAttribute("#btnMail", "href");
    check("קישור המייל נכון", href.startsWith("mailto:notamoffice@iaa.gov.il,nofm@iaa.gov.il?subject="), href.slice(0, 90));
    await page.screenshot({ path: path.join(OUT, "page-full.png"), fullPage: true });
    await page.emulateMedia({ media: "print" });
    const pdfPath = path.join(OUT, "request.pdf"); await page.pdf({ path: pdfPath, format: "A4", printBackground: true, margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" } });
    const pdf = fs.readFileSync(pdfPath); const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
    check("ה-PDF נוצר ב-3 עמודים לפחות", pdf.length > 20000 && pages >= 3, pages + " עמודים, " + pdf.length + " בתים");
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
    const ov0 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check("מובייל: אין גלילה אופקית לפני הרצה", ov0 <= 1, "חריגה " + ov0 + "px");
    await page.screenshot({ path: path.join(OUT, "mobile-top.png"), fullPage: false });
    if (!LIVE) { // במצב חי לא מריצים שוב את כל הצינור — שרתי Overpass הציבוריים מגבילים בקשות חוזרות מאותה כתובת
      await fillExample(page); await page.click("#runBtn");
      await page.waitForFunction(() => document.querySelector("#gate .banner"), null, { timeout: 150000 });
      const ov1 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check("מובייל: אין גלילה אופקית אחרי הרצה", ov1 <= 1, "חריגה " + ov1 + "px");
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
      check("שמירה בדרייב הצליחה", /נשמרו 6 קבצים/.test(msgT), msgT.slice(0, 160));
      const folder = Object.values(page._env.folders).find(f => f.parent === "ROOT");
      const names = folder ? folder.files.filter(f => !f.trashed).map(f => f.name) : [];
      check("התיקייה בדרייב נקראת 'מקום — תאריך' ומכילה Word, KML, שלוש תמונות ונתוני בקשה", !!folder && /— \d\d\.\d\d\.\d{4}/.test(folder.name) && names.length === 6 &&
        names.some(n => n.endsWith(".docx")) && names.some(n => n.endsWith(".kml")) && names.filter(n => /\.(png|jpg)$/.test(n)).length === 3 && names.some(n => n.endsWith(".json")), (folder && folder.name) + " | " + names.join(" | "));
      const dx = folder.files.find(f => f.name.endsWith(".docx"));
      { const JZ = require(path.join(ROOT, "members-k38p", "requests", "vendor", "jszip.min.js")), z = await JZ.loadAsync(dx.bytes);
        const doc = await z.file("word/document.xml").async("string");
        check("ה-Word שבדרייב תקין ומכיל את הטופס", /פמ״ת/.test(doc) || /נספח/.test(doc), dx.bytes.length + " בתים"); }
      const rec = JSON.parse(folder.files.find(f => f.name.endsWith(".json")).bytes.toString("utf8"));
      check("נתוני הבקשה בדרייב לא כוללים שמות וטלפונים", !/בודק ראשון|050-0000001|050-0000002/.test(JSON.stringify(rec)) && rec.inputs && rec.inputs.lat, Object.keys(rec.inputs || {}).join(","));
      // שמירה חוזרת באותו שם מחליפה ולא מכפילה
      await page.evaluate(() => { document.getElementById("driveMsg").textContent = ""; });   // אחרת ההודעה הקודמת מספקת את ההמתנה לפני שהשמירה החוזרת הסתיימה
      await page.click("#btnDrive");
      await page.waitForFunction(() => /נשמרו 6 קבצים/.test(document.querySelector("#driveMsg").textContent), null, { timeout: 120000 });
      await page.waitForTimeout(300);
      check("שמירה חוזרת מחליפה קבצים באותו שם (בלי כפילויות)", folder.files.filter(f => !f.trashed).length === 6 && Object.values(page._env.folders).filter(f => f.parent === "ROOT").length === 1, "");
      // בקשה אחרת באותו מקום ותאריך (דף חדש = מזהה בקשה חדש): תיקייה נפרדת, והקבצים של הראשונה לא נדרסים
      { const { ctx: ctxB, page: pageB } = await newPage(browser, { env: page._env });
        await pageB.goto(APP); await pageB.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 60000 }); await login(pageB);
        await readyRequest(pageB); await pageB.click("#btnDrive");
        await pageB.waitForFunction(() => /נשמרו \d+ קבצים|נכשלה/.test(document.querySelector("#driveMsg").textContent), null, { timeout: 120000 });
        const fs2 = Object.values(page._env.folders).filter(f => f.parent === "ROOT");
        check("אותו מקום ותאריך מבקשה אחרת: שתי תיקיות נפרדות, והראשונה שלמה", fs2.length === 2 && /\(2\)$/.test(fs2[1].name) && folder.files.filter(f => !f.trashed).length === 6, fs2.map(f => f.name).join(" | "));
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
      check("חלון השליחה: מצב בדיקה, נמען הבעלים בלבד, נושא וקבצים", /מצב בדיקה/.test(mt) && /בעל המערכת \(בדיקה\)/.test(mt) && /בקשה לסגירה אווירית —/.test(mt) && /קובץ KML/.test(mt) && !/notamoffice@iaa\.gov\.il, nofm/.test(mt.split("נוסח המייל")[0].split("אל:")[1] || ""), mt.replace(/\s+/g, " ").slice(0, 200));
      check("כפתור השליחה חסום עד סימון האישור", await page.isDisabled("#sendGo"), "");
      await page.check("#sendOk"); check("אחרי סימון האישור הכפתור נפתח", !(await page.isDisabled("#sendGo")), "");
      await page.click("#sendGo");
      await page.waitForFunction(() => /נשלח במצב בדיקה|נכשלה/.test(document.querySelector("#sendProg").textContent), null, { timeout: 120000 });
      const pr = await page.textContent("#sendProg");
      check("שליחת בדיקה הצליחה (לבעלים בלבד)", /נשלח במצב בדיקה/.test(pr) && /לא נשלח למשרד נוטאם/.test(pr), pr.slice(0, 160));
      const mails = page._env.mails;
      check("נשלח מייל אחד לבעלים עם 5 קבצים מצורפים (Word, KML ושלוש תמונות — בלי JSON) ללא נמען חיצוני", mails.length === 1 && mails[0].to === "owner@icd.test" && mails[0].attachments.length === 5 && !/iaa\.gov\.il/.test(JSON.stringify(mails[0].to + mails[0].cc)), mails.length + " מיילים; " + (mails[0] && mails[0].attachments.map(a => a.name).join(" | ")));
      check("נושא הבדיקה מסומן ונוסח המייל נשמר", /^\[בדיקה — לא נשלח למשרד נוטאם\] בקשה לסגירה אווירית — /.test(mails[0].subject) && /מצורפים: טופס הבקשה \(נספח ג׳, קובץ Word\)/.test(mails[0].body), mails[0].subject.slice(0, 80));
      const folder = Object.values(page._env.folders).find(f => f.parent === "ROOT");
      check("סימון 'נשלח (בדיקה)' נוצר בתיקייה בדרייב", folder.files.some(f => /^נשלח — .*\(בדיקה\)\.txt$/.test(f.name)), folder.files.map(f => f.name).join(" | ").slice(0, 200));
      const sm = await page.textContent("#sendMsg"); check("ההודעה בעמוד מציינת שליחה לבדיקה בלבד", /בדיקה/.test(sm), sm.slice(0, 120));
      // הודעות 'נשלח'/'נשמר' שייכות לבקשה שנשלחה — כשהבקשה משתנה הן נמחקות ולא מטעות לגבי הבקשה החדשה
      await page.click("#mdClose");
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
      await page.waitForFunction(() => /מצב חי/.test((document.querySelector(".sendBox") || {}).textContent || ""), null, { timeout: 60000 });
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
      check("ניהול: ליד המנהל מוצגות כמות הבקשות שהגיש (1) והנשלחות (2 לפי מניין שליחות אמיתיות)", !!adminRow && adminRow[3] === "1" && adminRow[4] === "2", JSON.stringify(adminRow));
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
  check("שרת ההתחברות נקרא רק ב'בקשות פשוטות' (text/plain) — אפס OPTIONS ואפס Content-Type אחר (Apps Script אמיתי אינו תומך ב-preflight)", API_STATS.posts > 50 && API_STATS.preflight === 0 && API_STATS.nonSimple === 0, JSON.stringify(API_STATS));
} finally {
  await browser.close(); server.close();
}
fs.writeFileSync(path.join(OUT, "e2e-results.json"), JSON.stringify({ live: LIVE, at: new Date().toISOString(), results }, null, 1));
const bad = results.filter(r => !r.ok);
console.log("\nסה״כ " + results.length + " בדיקות, נכשלו " + bad.length);
process.exit(bad.length ? 1 : 0);
