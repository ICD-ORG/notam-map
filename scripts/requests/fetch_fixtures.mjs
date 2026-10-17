// מושך נתוני OpenStreetMap אמיתיים סביב נקודות בדיקה, בדיוק עם השאילתות של האפליקציה (request/core.js).
// הפלט נשמר ב-tests/fixtures/<שם>/ ומשמש בדיקות אוטומטיות. רץ ב-GitHub Actions (בסביבת הפיתוח הרשת חסומה).
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const C = require("../request/core.js");
const cfg = JSON.parse(fs.readFileSync("data/request-config.json", "utf8"));
const UA = "icd-notam-map/1.0 (https://github.com/icd-org/notam-map-)";

const POINTS = [
  { name: "yarkon", lat: 32.099128, lon: 34.816617, R: 200 },
  { name: "metula", lat: 33.2790, lon: 35.5780, R: 100 },
  { name: "nitzana", lat: 30.8870, lon: 34.4240, R: 100 },
  { name: "hula", lat: 33.0900, lon: 35.6000, R: 300 },
  { name: "golan", lat: 33.1000, lon: 35.8200, R: 100 }
];
const only = process.argv.slice(2).find(a => !a.startsWith("--")) || null;
const force = process.argv.includes("--force");
const partsArg = (process.argv.find(a => a.startsWith("--parts=")) || "").slice(8);
const parts = partsArg ? partsArg.split(",") : ["near", "far", "ext", "reverse"];
const outRoot = "tests/fixtures";
let failed = 0;
const wait = ms => new Promise(r => setTimeout(r, ms));
const f = (u, o) => fetch(u, { ...(o || {}), headers: { "User-Agent": UA, ...((o && o.headers) || {}) } });

for (const p of POINTS) {
  if (only && only !== p.name) continue;
  const dir = `${outRoot}/${p.name}`; fs.mkdirSync(dir, { recursive: true });
  try { const m = JSON.parse(fs.readFileSync(`${dir}/meta.json`, "utf8")); if (!force && !partsArg && m.errors && m.errors.length === 0) { console.log("קיים ותקין — מדלג:", p.name); continue; } } catch (e) { /* אין קובץ */ }
  let meta = { name: p.name, lat: p.lat, lon: p.lon, R: p.R, fetched_utc: new Date().toISOString(), errors: [] };
  if (partsArg) { try { meta = JSON.parse(fs.readFileSync(`${dir}/meta.json`, "utf8")); meta.errors = (meta.errors || []).filter(e => !parts.some(x => e.startsWith(x))); } catch (e) { /* חדש */ } }
  const q = C.buildQueries(p.lat, p.lon, p.R, cfg);
  for (const k of ["near", "far", "ext"].filter(x => parts.includes(x))) {
    try {
      const { data, mirror } = await C.overpass(q[k], { fetch: f, log: s => console.log(p.name, k, s), wait, maxAgeH: cfg.thresholds.osm_max_age_h });
      fs.writeFileSync(`${dir}/${k}.json`, JSON.stringify(data));
      meta[k] = { mirror, elements: data.elements.length, osm_base: data.osm3s && data.osm3s.timestamp_osm_base };
      console.log(p.name, k, data.elements.length, "elements via", mirror);
    } catch (e) { meta.errors.push(k + ": " + e.message); failed++; console.log("FAIL", p.name, k, e.message); }
    await wait(3000);
  }
  if (parts.includes("reverse")) try {
    const r = await f("https://nominatim.openstreetmap.org/reverse?" + new URLSearchParams({ format: "jsonv2", lat: p.lat, lon: p.lon, zoom: 18, "accept-language": "he", addressdetails: 1 }));
    const j = await r.json(); fs.writeFileSync(`${dir}/reverse.json`, JSON.stringify(j)); meta.reverse = j.display_name;
  } catch (e) { meta.errors.push("reverse: " + e.message); failed++; }
  fs.writeFileSync(`${dir}/meta.json`, JSON.stringify(meta, null, 1));
  await wait(2000);
}
process.exit(failed ? 1 : 0);
