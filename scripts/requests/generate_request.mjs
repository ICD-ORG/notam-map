// מריץ את זרימת "בקשת סגירה אווירית" בדפדפן אמיתי מול הרשת (Overpass, Nominatim, תצלום אוויר), ושומר נתונים גולמיים ותמונות.
// פרטי אנשים אינם נכנסים לכאן: הרכבת הטופס הסופי (עם שמות וטלפונים) נעשית מקומית אצל המבקש/Claude.
// שימוש: LAT=.. LON=.. RADIUS=.. HEIGHT=.. DATE_FROM=YYYY-MM-DD DATE_TO=.. TIME_FROM=HH:MM TIME_TO=.. SITE=".." node scripts/generate_request.mjs <תיקיית פלט>
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(here, "..");
const OUT = path.resolve(process.argv[2] || "gen-out");
fs.mkdirSync(OUT, { recursive: true });
const require = createRequire(import.meta.url);
let pw;
for (const p of [ROOT, process.cwd(), "/opt/node22/lib/node_modules"]) { try { pw = require(require.resolve("playwright", { paths: [p] })); break; } catch (e) { /* next */ } }
if (!pw) { console.error("playwright לא נמצא"); process.exit(2); }
const E = process.env, need = k => { if (!E[k]) { console.error("חסר משתנה " + k); process.exit(2); } return E[k]; };
const inp = { lat: need("LAT"), lon: need("LON"), radius: E.RADIUS || "100", height: need("HEIGHT"), dateFrom: need("DATE_FROM"), dateTo: E.DATE_TO || need("DATE_FROM"), timeFrom: need("TIME_FROM"), timeTo: need("TIME_TO"), site: E.SITE || "", purposeIdx: +(E.PURPOSE_IDX || 0), aircraftIdx: (E.AIRCRAFT_IDX || "0").split(",").map(Number), vlos: E.VLOS !== "no", provider: E.PROVIDER || "esri" };

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".css": "text/css", ".png": "image/png" };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split("?")[0]); const f = path.join(ROOT, u === "/" ? "index.html" : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end("nf"); return; }
  res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const BASE = "http://127.0.0.1:" + server.address().port;
const browser = await pw.chromium.launch({ executablePath: E.CHROMIUM_PATH || undefined, args: ["--no-sandbox"], env: { ...process.env, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" } });
const fail = (msg, extra) => { fs.writeFileSync(path.join(OUT, "error.json"), JSON.stringify({ error: msg, ...(extra || {}) }, null, 1)); console.error(msg); process.exit(1); };
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: "he-IL", timezoneId: "Asia/Jerusalem" })).newPage();
  await page.goto(BASE + "/request.html");
  await page.waitForFunction(() => window.__REQ_READY === true, null, { timeout: 90000 });
  const st = await page.$$eval("#stList li", els => els.map(e => ({ ok: e.classList.contains("ok"), t: e.textContent })));
  if (!st.length || !st.every(x => x.ok)) fail("הבדיקה העצמית נכשלה", { selftest: st.filter(x => !x.ok) });
  await page.fill("#coord", inp.lat + ", " + inp.lon); await page.dispatchEvent("#coord", "change");
  await page.fill("#radius", inp.radius); await page.fill("#height", inp.height);
  await page.fill("#dateFrom", inp.dateFrom); await page.fill("#dateTo", inp.dateTo);
  await page.fill("#timeFrom", inp.timeFrom); await page.fill("#timeTo", inp.timeTo);
  await page.selectOption("#purpose", { index: inp.purposeIdx + 1 }); // אינדקס 0 = המהות הראשונה ברשימה (האפשרות 0 בתפריט היא "בחרו…")
  await page.selectOption("#provider", inp.provider);
  await page.selectOption("#vlos", inp.vlos ? "yes" : "no");
  const boxes = await page.$$('input[name="ac"]');
  for (let i = 0; i < boxes.length; i++) await boxes[i].setChecked(inp.aircraftIdx.includes(i));
  if (inp.site) await page.fill("#siteName", inp.site);
  // מזהים חלופיים לפרטי אנשים — המסמך הסופי נבנה מקומית עם הפרטים האמיתיים
  await page.fill("#reqName", "PLACEHOLDER-REQ"); await page.fill("#reqPhone", "0900000001");
  await page.fill("#contactNames", "PLACEHOLDER-CONTACTS"); await page.fill("#contactPhone", "0900000002");
  await page.click("#runBtn");
  try { await page.waitForFunction(() => document.querySelector("#gate .banner") || document.getElementById("e_run").textContent.length > 0, null, { timeout: 300000 }); }
  catch (e) { fail("ההרצה לא הסתיימה בזמן", await page.evaluate(() => ({ err: document.getElementById("e_run").textContent, progress: document.getElementById("progress").innerText }))); }
  const errRun = await page.textContent("#e_run");
  if (errRun) fail("ההרצה נכשלה: " + errRun, await page.evaluate(() => ({ progress: document.getElementById("progress").innerText })));
  const data = await page.evaluate(() => {
    const S = window.__REQ.S, r = S.res;
    return {
      near: S.data.near, far: S.data.far, ext: S.data.ext, reverse: S.data.reverse,
      statuses: S.statuses, siteName: r.inp.siteName,
      items: r.nearScan.items.map(i => ({ n: i.n, title: i.title, d: i.d, zone: i.zone, cat: i.cat })),
      censusOnly: r.nearScan.censusOnly.length, zonesInside: r.zones.inside.map(z => z.id), zonesNear: r.zones.near.map(z => ({ id: z.id, d: z.d })),
      notamHits: r.notams.hits.map(h => h.id), borders: r.borders.map(b => ({ iso: b.iso, d: b.d, violates: b.violates })),
      images: { detail: { png: S.map.dataUrl, jpeg: S.map.jpegUrl, w: S.map.canvas.width, h: S.map.canvas.height, background: S.map.background }, overview: { png: S.overview.dataUrl, jpeg: S.overview.jpegUrl, w: S.overview.canvas.width, h: S.overview.canvas.height, background: S.overview.background }, aerial: { png: S.aerial.dataUrl, jpeg: S.aerial.jpegUrl, w: S.aerial.canvas.width, h: S.aerial.canvas.height, background: S.aerial.background } },
      gate: document.getElementById("gate").innerText
    };
  });
  const save = (name, durl) => fs.writeFileSync(path.join(OUT, name), Buffer.from(durl.split(",")[1], "base64"));
  for (const k of ["detail", "overview", "aerial"]) { save(k + ".png", data.images[k].png); save(k + ".jpg", data.images[k].jpeg); }
  const images = Object.fromEntries(Object.entries(data.images).map(([k, v]) => [k, { w: v.w, h: v.h, background: v.background }]));
  fs.writeFileSync(path.join(OUT, "raw.json"), JSON.stringify({ inputs: inp, near: data.near, far: data.far, ext: data.ext, reverse: data.reverse, at: new Date().toISOString() }));
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify({ inputs: inp, siteName: data.siteName, statuses: data.statuses, items: data.items, censusOnly: data.censusOnly, zonesInside: data.zonesInside, zonesNear: data.zonesNear, notamHits: data.notamHits, borders: data.borders, images, gate: data.gate }, null, 1));
  console.log("נשמר ב-" + OUT + ": " + data.items.length + " פריטים, שער: " + data.gate.replace(/\s+/g, " ").slice(0, 160));
} finally { await browser.close(); server.close(); }
