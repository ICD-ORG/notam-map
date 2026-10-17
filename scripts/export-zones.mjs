// מפיק data/zones.json מתוך הנתונים שבתוך members-k38p/index.html — כך מפת החברים היא המקור היחיד לאזורי א-17.
// אין כאן העתקת נתונים: הסקריפט מריץ את בלוקי הנתונים והפונקציות של המפה עצמה (בלי דפדפן) וממיר את התוצאה.
// שימוש: node scripts/export-zones.mjs [--check]   (--check: נכשל אם הקובץ שבמאגר שונה ממה שהמפה מפיקה)
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
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

// הקטעים שמהם נגזרים האזורים — אותם סימונים בדיוק משמשים את בדיקת הסנכרון בדפדפן (requests/js/sync.js)
export function dataParts(html) {
  return [
    slice(html, "/* ===== helpers ===== */", "const AIRPORTS=[", "helpers..AIRPORTS"),
    slice(html, "const NO_COORDS=[", "/* ===== פרק ב-09", "NO_COORDS..ch09"),
    slice(html, "/* ===== פרק ב-09", "/* ===== map ===== */", "ch09..map"),   // אזורי הטיסה לכטב"ם (נספחים ב'-1, ב'-2, ב'-3)
  ];
}
export const dataHash = html => crypto.createHash("sha256").update(dataParts(html).join(""), "utf8").digest("hex");

export function loadAreas(html) {
  const [part1, part2, part3] = dataParts(html);
  const ctx = vm.createContext({ console: { log() {}, warn() {}, error() {} } });
  vm.runInContext(part1 + "\n" + part2 + "\n" + part3 + "\n;globalThis.__out={AREAS,NO_COORDS,LLR_APPROX,UAS09,P09_STAMP,pg09,U09_APP,U09_INTRO,U09_FOOT,U09_SEC4C,U09_SEC7A,dest,arc,circlePoly,capsule,stripPoly,LLU_DEFAULT_ALT};", ctx, { filename: "members-map-data.js", timeout: 20000 });
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


// גובה מזערי באלפי רגל מעפ"י (מספר) — GND או היעדר גובה מזערי = 0; מחרוזת שלא מפוענחת = null (הבדיקה תכשיל)
function b09MinFt(u) {
  if (u.t === "B1" || !u.mn || /^\s*GND\s*$/i.test(u.mn)) return 0;
  const m = /^\s*(\d[\d ]*)\s*רגל/.exec(u.mn);
  return m ? parseInt(m[1].replace(/ /g, ""), 10) : null;
}

// אזורי טיסה לכטב"ם מפרק ב-09 (נספחים ב'-1, ב'-2, ב'-3): הנתונים והציטוטים כפי שהמפה מציגה אותם
function b09Record(u, H) {
  const cells = ["שם: " + u.n];
  if (u.t === "B1") { if (u.mx) cells.push("גובה מרבי" + (u.p <= 11 ? "¹" : "") + ' (רגל מעפ"י): ' + u.mx); if (u.nt) cells.push("הערות: " + u.nt); }
  else { if (u.mn) cells.push("גובה מזערי: " + u.mn); if (u.mx) cells.push("גובה מרבי: " + u.mx); if (u.co) cells.push("תיאום: " + u.co); }
  const alt = u.t === "B1" ? (u.mx ? 'גובה מרבי (רגל מעפ"י): ' + u.mx : "") : [u.mn ? "גובה מזערי: " + u.mn : "", u.mx ? "גובה מרבי: " + u.mx : ""].filter(Boolean).join(" · ");
  const geo = u.g.k === "circle" ? { rings: [closed(H.circlePoly(u.g.c, u.g.r, 72))], c: rp(u.g.c), r: u.g.r } : { rings: [closed(u.g.pts)] };
  return {
    id: u.id, cat: u.t === "B3" ? "B09B" : "B09", name: u.n, appendix: H.U09_APP[u.t], alt,
    ...(u.g.k === "map" ? { approx: true } : {}),
    minFt: b09MinFt(u), ...geo, pmt: cells.join(" · "), pmtRef: H.pg09(u.p), coord: u.co || "", note: u.nt || "",
  };
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
  const b09 = (H.UAS09 || []).map(u => b09Record(u, H));
  const zones = [...byId.values()].sort((x, y) => x.id.localeCompare(y.id, "en", { numeric: true })).concat(b09);
  const edition = `פמ"ת פנים ארצי א-17 · עדכון ${meta.pamat_update} · ${meta.pamat_date.replace(/^(\d+) ([A-Z]{3}) (\d{4})$/, (_, d, mo, y) => `${d} ${MONTHS[mo] || mo} ${y}`)}`;
  const llu = generalQuote(H.AREAS.filter(a => /^LLU/.test(a.code)), /סעיף 1א בפמ"ת \(([^)]*)\):\s*<i>([\s\S]*?)<\/i>/);
  const apx = zones.filter(z => z.approx && !/^B09/.test(z.cat)).map(z => z.id);
  const apx09 = b09.filter(z => z.approx).map(z => z.id);
  const q09 = (ref, text) => ({ ref, text });
  const stamp = /MAP v(\d+(?:\.\d+)+) · (\d+ [A-Z]{3} \d{4})/.exec(html) || [], mapVersion = stamp[1] || "";
  // JSON בלבד: הנתונים נוצרו בהקשר vm נפרד ויש להם אב-טיפוס שונה (מערכים/אובייקטים) — מנרמלים כדי שיהיו רגילים לחלוטין
  return JSON.parse(JSON.stringify({ edition, mapVersion, mapDate: stamp[2] || meta.map_date || "", dataHash: dataHash(html), pamat: { update: meta.pamat_update, date: meta.pamat_date }, zones, approxIds: apx, approx09Ids: apx09,
    general: { LLU: llu, B09: { intro: q09(H.pg09(10), H.U09_INTRO), footnote: q09(H.pg09(10), H.U09_FOOT), sec4c: q09(H.pg09(2), H.U09_SEC4C), sec7a: q09(H.pg09(6), H.U09_SEC7A) } } }));
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
