// מפיק data/zones.json מתוך הנתונים שבתוך members-k38p/index.html — כך מפת החברים היא המקור היחיד לאזורי א-17.
// אין כאן העתקת נתונים: הסקריפט מריץ את בלוקי הנתונים והפונקציות של המפה עצמה (בלי דפדפן) וממיר את התוצאה.
// שימוש: node scripts/export-zones.mjs [--check]   (--check: נכשל אם הקובץ שבמאגר שונה ממה שהמפה מפיקה)
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = path.join(ROOT, "members-k38p", "index.html");
const META = path.join(ROOT, "members-k38p", "pamat-meta.json");
const OUT = path.join(ROOT, "members-k38p", "data", "zones.json");

function slice(src, from, to, label) {
  const a = src.indexOf(from);
  if (a < 0) throw new Error("לא נמצא סימון התחלה: " + label);
  const b = to ? src.indexOf(to, a + from.length) : src.length;
  if (b < 0) throw new Error("לא נמצא סימון סיום: " + label);
  return src.slice(a, b);
}

const stripHtml = h => String(h || "")
  .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(div|p)>/gi, "\n").replace(/<[^>]+>/g, "")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
  .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

const MONTHS = { JAN: "ינו׳", FEB: "פבר׳", MAR: "מרץ", APR: "אפר׳", MAY: "מאי", JUN: "יוני", JUL: "יולי", AUG: "אוג׳", SEP: "ספט׳", OCT: "אוק׳", NOV: "נוב׳", DEC: "דצמ׳" };

export function loadAreas(html) {
  // הבלוקים לפי סדר הופעתם: פונקציות עזר + נתוני האזורים, אחר כך שורות ה-LLR המשורטטות בקירוב (מדלגים על שדות התעופה)
  const part1 = slice(html, "/* ===== helpers ===== */", "const AIRPORTS=[", "helpers..AIRPORTS");
  const part2 = slice(html, "const NO_COORDS=[", "/* ===== פרק ב-09", "NO_COORDS..ch09");
  const ctx = vm.createContext({ console: { log() {}, warn() {}, error() {} } });
  vm.runInContext(part1 + "\n" + part2 + "\n;globalThis.__out={AREAS,NO_COORDS,LLR_APPROX,dest,arc,circlePoly,capsule,stripPoly,LLU_DEFAULT_ALT};", ctx, { filename: "members-map-data.js", timeout: 20000 });
  return ctx.__out;
}

const round = n => Math.round(n * 1e6) / 1e6;
const rp = p => [round(p[0]), round(p[1])];
const closed = r => { const q = r.map(rp); const f = q[0], l = q[q.length - 1]; if (f[0] !== l[0] || f[1] !== l[1]) q.push(f); return q; };

function geometry(a, H) {
  const g = a.g;
  if (g.k === "circle") return { rings: [closed(H.circlePoly(g.c, g.r, 72))], c: rp(g.c), r: g.r };
  if (g.k === "poly") return { rings: [closed(g.pts)] };
  if (g.k === "multi") return { rings: g.rings.map(closed) };
  if (g.k === "capsule") return { rings: [closed(H.capsule(g.a, g.b, g.r))] };
  if (g.k === "strip") return { rings: [closed(H.stripPoly(g.line, g.w, g.side))] };
  if (g.k === "segs") {
    let pts = [];
    for (const s of g.segs) {
      if (s.p) pts.push(s.p);
      else if (s.arc) {
        // המפה מצמידה את קצות הקשת לרדיוס; בפמ"ת הקצה הוא נקודה מפורשת (לעיתים כמה מאות מטרים מהרדיוס) — מוסיפים אותה כדי שהגבול יעבור בה בדיוק
        const from = pts.length ? pts[pts.length - 1] : s.arc.to;
        pts = pts.concat(H.arc(s.arc.c, s.arc.r, from, s.arc.to, s.arc.dir)); pts.push(s.arc.to);
      }
      else if (s.arcFrom) {
        const A = H.dest(s.arcFrom.c[0], s.arcFrom.c[1], s.arcFrom.fromBrg, s.arcFrom.r), B = H.dest(s.arcFrom.c[0], s.arcFrom.c[1], s.arcFrom.toBrg, s.arcFrom.r);
        pts = pts.concat(H.arc(s.arcFrom.c, s.arcFrom.r, A, B, s.arcFrom.dir));
      }
    }
    return { rings: [closed(pts)] };
  }
  return null; // line (גבול ירדן) ורצועות הגבול — את הגבולות בודקת המערכת מול OpenStreetMap לפי א-17 סעיף 4
}

const catOf = a => {
  const m = /^LL([PRDU])/.exec(a.code);
  if (!m) return null; // GVUL-* (רצועות גבול) לא אזורי פמ"ת
  if (a.cat === "O") return "OBS";
  return "LL" + m[1];
};

// הציטוט הראשון של לשון הפמ"ת בכרטיס ("לשון הפמ"ת (עמ' N, עדכון X): <i>…</i>") — ההפניה והטקסט המילולי
function firstQuote(noteHtml) {
  const m = /לשון הפמ"ת \(([^)]*)\):\s*<i>([\s\S]*?)<\/i>/.exec(noteHtml || "");
  return m ? { ref: m[1], text: stripHtml(m[2]) } : null;
}
// סעיף 1א (הגדרת אזורי LLU) כפי שמצוטט בכרטיסי LLU
function generalQuote(areas, re) {
  for (const a of areas) {
    const m = re.exec(a.note || "");
    if (m) return { ref: m[1], text: stripHtml(m[2]) };
  }
  return null;
}

export function build(html, meta) {
  const H = loadAreas(html);
  const byId = new Map();
  for (const a of H.AREAS) {
    const cat = catOf(a); if (!cat) continue;
    const geo = geometry(a, H); if (!geo) continue;
    const id = a.dispCode || a.code;
    const q = firstQuote(a.note);
    const z = byId.get(id);
    if (z) { z.rings.push(...geo.rings); continue; } // LLU22 מפוצל לשני חלקים בפמ"ת
    byId.set(id, {
      id, cat, name: a.name, alt: a.alt || "",
      ...(a.approx ? { approx: true } : {}),
      rings: geo.rings, ...(geo.c ? { c: geo.c, r: geo.r } : {}),
      pmt: q ? q.text : "", pmtRef: q ? q.ref : "",
    });
  }
  const zones = [...byId.values()].sort((x, y) => x.id.localeCompare(y.id, "en", { numeric: true }));
  const edition = `פמ"ת פנים ארצי א-17 · עדכון ${meta.pamat_update} · ${meta.pamat_date.replace(/^(\d+) ([A-Z]{3}) (\d{4})$/, (_, d, mo, y) => `${d} ${MONTHS[mo] || mo} ${y}`)}`;
  const llu = generalQuote(H.AREAS.filter(a => /^LLU/.test(a.code)), /סעיף 1א בפמ"ת \(([^)]*)\):\s*<i>([\s\S]*?)<\/i>/);
  const apx = zones.filter(z => z.approx).map(z => z.id);
  const mapVersion = (/v(\d+\.\d+(?:\.\d+)?)/.exec(html.slice(0, 20000)) || /MAP_VERSION\s*=\s*['"]([^'"]+)/.exec(html) || [])[1] || "";
  return { edition, mapVersion, mapDate: meta.map_date || "", zones, approxIds: apx, general: { LLU: llu } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const html = fs.readFileSync(HTML, "utf8"), meta = JSON.parse(fs.readFileSync(META, "utf8"));
  const out = build(html, meta);
  const text = JSON.stringify(out) + "\n";
  if (process.argv.includes("--check")) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
    if (cur !== text) { console.error("data/zones.json אינו תואם למפה — להריץ: node scripts/export-zones.mjs"); process.exit(1); }
    console.log("data/zones.json תואם למפה (" + out.zones.length + " אזורים)");
  } else {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, text);
    console.log("נכתבו " + out.zones.length + " אזורים אל " + path.relative(ROOT, OUT) + " (מהדורה: " + out.edition + ", מתוכם בקירוב: " + out.approxIds.length + ")");
  }
}
