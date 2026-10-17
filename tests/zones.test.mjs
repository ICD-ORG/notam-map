// בדיקות ייצוא האזורים: התוצאה חייבת להתאים לנתונים שאומתו בנפרד (מרחקי ויסנטי, ציטוט הפמ"ת) ולמה שהמפה מציגה.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, loadAreas } from "../scripts/export-zones.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(ROOT, "members-k38p", "index.html"), "utf8");
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, "members-k38p", "pamat-meta.json"), "utf8"));
const out = build(html, meta);
const golden = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "fixtures", "golden-pmt-zones.json"), "utf8"));
const G = new Map(golden.zones.map(z => [z.id, z]));
const Z = new Map(out.zones.map(z => [z.id, z]));

const dist = (a, b) => { const k = 111320; return Math.hypot((a[1] - b[1]) * k * Math.cos((a[0] + b[0]) * Math.PI / 360), (a[0] - b[0]) * k); };
const verts = z => z.rings.flat();

test("כל 147 אזורי הפמ״ת המאומתים קיימים בייצוא, ואין אזור מאומת שנעלם", () => {
  const missing = [...G.keys()].filter(id => !Z.has(id));
  assert.deepEqual(missing, []);
});

test("הקטגוריה של כל אזור זהה למאומת", () => {
  for (const [id, g] of G) assert.equal(Z.get(id).cat, g.cat, id);
});

// מרחק נקודה מקטע, במטרים (קירוב מישורי מקומי)
function segDist(p, a, b) {
  const k = 111320, c = Math.cos(p[0] * Math.PI / 180);
  const X = q => [(q[1] - p[1]) * k * c, (q[0] - p[0]) * k];
  const A = X(a), B = X(b), dx = B[0] - A[0], dy = B[1] - A[1], l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, -(A[0] * dx + A[1] * dy) / l2)) : 0;
  return Math.hypot(A[0] + t * dx, A[1] + t * dy);
}
const toBoundary = (p, rings) => Math.min(...rings.flatMap(r => r.slice(1).map((q, i) => segDist(p, r[i], q))));

// LLP173: קצה הקשת סביב LLP13 (רדיוס 6 ק"מ) נמצא בפמ"ת כנקודה מפורשת ~190 מ׳ מחוץ לרדיוס; המפה מציירת את הקשת על הרדיוס והמאומת שלנו מחבר ישר — סטייה מתועדת עד 200 מ׳
const TOL = { LLP173: 200 };
test("הגבולות זהים למאומת: כל קודקוד של כל צד נמצא על הגבול של הצד השני בטווח 40 מ׳", () => {
  const bad = [];
  for (const [id, g] of G) {
    const z = Z.get(id), tol = TOL[id] || 40;
    const farA = verts(g).filter(p => toBoundary(p, z.rings) > tol).length;
    const farB = verts(z).filter(p => toBoundary(p, g.rings) > tol).length;
    if (farA || farB) bad.push(id + " (" + farA + "/" + farB + ")");
  }
  assert.deepEqual(bad, []);
});

test("מעגלים: מרכז ורדיוס תואמים לפריסת הנקודות של המאומת", () => {
  const bad = [];
  for (const [id, z] of Z) {
    if (!z.c || !G.has(id)) continue;
    const g = G.get(id);
    const rs = verts(g).map(p => dist(z.c, p));
    const mean = rs.reduce((s, v) => s + v, 0) / rs.length;
    if (Math.abs(mean - z.r) > Math.max(6, z.r * 0.03)) bad.push(id + " " + z.r + " מול " + Math.round(mean));
  }
  assert.deepEqual(bad, []);
});

test("ששה־עשר אזורי LLR משורטטים בקירוב ומסומנים approx; האחרים לא", () => {
  assert.equal(out.approxIds.length, 16);
  for (const z of out.zones.filter(x => !/^B09/.test(x.cat))) assert.equal(!!z.approx, out.approxIds.includes(z.id), z.id);
  for (const id of out.approxIds) assert.ok(!G.has(id), id + " אינו בנתונים המאומתים — אין לו קואורדינטות רשמיות");
  assert.ok(out.approxIds.every(id => /^LLR/.test(id)));
});

test("סך האזורים = 147 מאומתים + 16 LLR בקירוב + 42 אזורי טיסה לכטב״ם (ב-09)", () => assert.equal(out.zones.length, 147 + 16 + 42));

test("מחרוזת הגובה של המפה מכילה את הגובה המרבי המאומת (פרט לחריגים מתועדים)", () => {
  const known = new Set(["LLP11", "LLD42"]); // LLP11: "בכל גובה" לפי לשון הפמ"ת מול 8000 בטבלה; LLD42: מתחת לפני הים
  const bad = [];
  for (const [id, g] of G) {
    if (known.has(id)) continue;
    const alt = (Z.get(id).alt || "").replace(/,/g, "");
    if (g.max === "UNL") { if (!/UNL|בכל גובה/.test(alt)) bad.push(id + " " + alt); continue; }
    if (!alt.includes(String(g.max))) bad.push(id + " " + alt + " מול " + g.max);
  }
  assert.deepEqual(bad, []);
});

test("לכל אזור פמ״ת (לא בקירוב) יש ציטוט לשון הפמ״ת עם הפניה לעמוד", () => {
  const miss = out.zones.filter(z => !z.approx && z.cat !== "OBS" && (!z.pmt || !z.pmtRef)).map(z => z.id);
  assert.deepEqual(miss, []);
});

const B09 = out.zones.filter(z => /^B09/.test(z.cat));
const H = loadAreas(html);
// בפמ"ת שתי קואורדינטות מודפסות בלי גרש דקות (fx) — נקראות כדקות
const dmsPt = (n, e) => { const f = t => { const m = /(\d+)°\s*(\d+)(?:'|\s)\s*(\d+(?:\.\d+)?)/.exec(t); return +m[1] + m[2] / 60 + m[3] / 3600; }; return [f(n), f(e)]; };

test("ב-09: 42 אזורים (18 בנספח ב׳-1, 12 בב׳-2, 12 בב׳-3), מזהים ייחודיים, וחמישה משורטטים בקירוב מהמפה", () => {
  assert.equal(B09.length, 42);
  assert.deepEqual(["נספח ב'-1", "נספח ב'-2", "נספח ב'-3"].map(a => B09.filter(z => z.appendix === a).length), [18, 12, 12]);
  assert.equal(new Set(B09.map(z => z.id)).size, 42);
  assert.deepEqual(out.approx09Ids.slice().sort(), ["אשכול", "כוכב יאיר", "נטף", "קרן דרום", "קרן צפון"].sort());
});

test("ב-09: גבולות האזורים שבנספחים תואמים לקואורדינטות שבטבלה (אימות עצמאי מחרוזות ה-DMS) בטווח 5 מ׳", () => {
  const bad = [];
  let checked = 0;
  for (const u of H.UAS09) {
    if (u.g.k !== "poly" || u.rows.some(r => r.k !== "c")) continue;
    const z = B09.find(x => x.id === u.id), ring = z.rings[0].slice(0, -1);
    const pts = u.rows.map(r => dmsPt(r.n, r.e));
    checked++;
    // כל נקודה בטבלה חייבת להופיע בגבול; (חריגות כתיב מתועדות בשדה fx)
    const fx = (u.fx || []).length;
    // נקודת הסגירה האחרונה בטבלה (חוזרת לראשונה) עשויה להיות מודפסת בהפרש של מטרים בודדים; המפה מסירה אותה
    const closing = pts.length > 3 && dist(pts[pts.length - 1], pts[0]) <= 15 ? pts.length - 1 : -1;
    const miss = pts.filter((p, i) => i !== closing && !ring.some(q => dist(p, q) <= 5)).length;
    if (miss > fx) bad.push(u.id + " (" + miss + "/" + fx + ")");
  }
  assert.ok(checked >= 20, "נבדקו רק " + checked);
  assert.deepEqual(bad, []);
});

test("ב-09: כל אזור כולל גובה פרשני, ציטוט ושורת תיאום/הערות כפי שבפמ״ת; 401 א מחייב בקשה למשרד נוטאם", () => {
  for (const z of B09) assert.ok(z.alt && z.pmt.startsWith("שם: "), z.id);
  const z = B09.find(x => x.id === "401 א");
  assert.match(z.coord, /הגשת בקשה למשרד נוטאם 5 ימי עבודה מראש/);
  assert.equal(z.minFt, 9000);
  assert.equal(B09.filter(x => x.minFt > 0).length, 12);
});

test("מהדורת הפמ״ת נלקחת מ-pamat-meta.json", () => {
  assert.match(out.edition, /א-17 · עדכון 1\/26 · 06 אוג׳ 2026/);
});

test("סעיף 1א של LLU מצוטט (הגדרת רדיוס 500 מ׳ וגובה 1,000 רגל)", () => {
  assert.ok(out.general.LLU && /1 000 רגל|1,000 רגל/.test(out.general.LLU.text));
});

test("הקובץ שבמאגר זהה למה שהמפה מפיקה", () => {
  const cur = fs.readFileSync(path.join(ROOT, "members-k38p", "data", "zones.json"), "utf8");
  assert.equal(cur, JSON.stringify(out) + "\n");
});
