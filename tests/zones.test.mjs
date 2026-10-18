// בדיקות ייצוא האזורים: התוצאה חייבת להתאים לנתונים שאומתו בנפרד (מרחקי ויסנטי, ציטוט הפמ"ת) ולמה שהמפה מציגה.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build, loadAreas, cardQuotes, contactsOf } from "../scripts/export-zones.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PARTIES = createRequire(import.meta.url)(path.join(ROOT, "members-k38p", "requests", "js", "parties.js"));
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

/* ================= פרטי קשר בכרטיסי המפה → zone.contacts (דיווח לגורמים נוספים) ================= */
// golden-contacts.json = עותק קפוא של כרטיסים נבחרים וערכים שנכתבו ידנית ונבדקו בעין. הבדיקות של האזורים החיים למטה בודקות רק עקביות ושלמות (לא ספרות מדויקות),
// כדי שרענון אוטומטי של הפמ"ת (zones-export.yml) לא ישבור את ה-CI.
const GC = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "fixtures", "golden-contacts.json"), "utf8"));
const squash = t => String(t).replace(/\s+/g, " ").trim();
const bare = t => squash(t).replace(/^…/, "").replace(/…$/, "").trim();
const NOTE_OF = new Map(H.AREAS.map(a => [a.dispCode || a.code, a.note || ""]));

test("cardQuotes: רק ציטוט <i> מילולי — לא span.mapnote, לא טבלת קואורדינטות (details / xlb); ישויות HTML מפוענחות; התווית כלשונה", () => {
  const html = 'לשון הפמ"ת (עמ\' 4, עדכון 2/25): <i>LLX1, האזור &quot;בדיקה&quot;. בטלפון 03-5487211.<br>שורה שנייה &amp; עוד</i><br>'
    + '<span class="mapnote">הערת המפה (אינה מהפמ"ת): <i>התקשרו 04-1111111 או x@y.co</i></span><br>'
    + 'סעיף 2 בפמ"ת (עמ\' 8, עדכון 2/25): <i>2. כותרת<br>[…]<br>בטלפון 02-5305042/1</i>'
    + '<details class="xl"><summary>הצג</summary><div class="xlb"><i>34° 29&#39; 17.00&quot; E | 31° 38&#39; 58.00&quot; N<br>054-1111111</i></div></details>'
    + '<div class="xlb"><i>050-2222222</i></div><br>מפת נספח א\' (עמ\' 51, עדכון 1/26), תווית LLX1: <i>UNL<br>GND</i>';
  assert.deepEqual(cardQuotes(html), [
    { label: 'לשון הפמ"ת (עמ\' 4, עדכון 2/25)', text: 'LLX1, האזור "בדיקה". בטלפון 03-5487211.\nשורה שנייה & עוד' },
    { label: 'סעיף 2 בפמ"ת (עמ\' 8, עדכון 2/25)', text: "2. כותרת\n[…]\nבטלפון 02-5305042/1" },
    { label: "מפת נספח א' (עמ' 51, עדכון 1/26), תווית LLX1", text: "UNL\nGND" }]);
  assert.deepEqual(cardQuotes(""), []); assert.deepEqual(cardQuotes(null), []); assert.deepEqual(cardQuotes("בלי ציטוט"), []);
  const c = contactsOf(html, "LLX1");
  assert.deepEqual(c.map(e => e.scope + ":" + e.phones.join("|") + ":" + e.emails.join("|")), ["zone:03-5487211:", "general:02-5305042/1:"], "המספרים שבמפה (mapnote) ובטבלת הקואורדינטות אינם נסרקים");
  assert.ok(!JSON.stringify(c).includes("04-1111111") && !JSON.stringify(c).includes("x@y.co") && !JSON.stringify(c).includes("054-1111111") && !JSON.stringify(c).includes("050-2222222"));
});

test("תיקון המייצא (הכרטיסים הקפואים): LLR30 — 4 מתא״מים + דוא״ל עם ההפניה לסעיף 2; LLU21 — המספר הייעודי בנוסף להנחיה הכללית; LLP19 — sinhrun5 ובקשת החריגה role:exception", () => {
  for (const [id, want] of Object.entries(GC.expected.entries)) {
    const got = contactsOf(GC.cards[id], id);
    assert.equal(got.length, want.length, id + ": מספר רשומות");
    got.forEach((g, i) => {
      assert.equal(g.ref, want[i].ref, id + "#" + i + " ref"); assert.equal(g.scope, want[i].scope, id + "#" + i + " scope");
      assert.deepEqual(g.phones, want[i].phones, id + "#" + i + " phones"); assert.deepEqual(g.emails, want[i].emails, id + "#" + i + " emails"); assert.equal(g.role, want[i].role, id + "#" + i + " role");
      want[i].textIncludes.forEach(t => assert.ok(g.text.includes(t), id + "#" + i + " text: " + g.text));
    });
  }
  // הנקודות הרגישות במפורש: LLU21 קיבל את המספר הייעודי שלו; LLU20 אינו מקבל אותו; LLR30 קיבל את מתא"מי סעיף 2; LLP19 — בקשת החריגה מסומנת
  assert.deepEqual(contactsOf(GC.cards.LLU21, "LLU21").filter(e => e.scope === "zone").flatMap(e => e.phones), ["03-5038875"]);
  assert.ok(!JSON.stringify(contactsOf(GC.cards.LLU20, "LLU20")).includes("03-5038875"));
  assert.equal(contactsOf(GC.cards.LLR30, "LLR30").length, 4);
  assert.deepEqual(contactsOf(GC.cards.LLP19, "LLP19").map(e => e.role || "-"), ["-", "exception"]);
  assert.deepEqual(contactsOf(GC.cards.LLR120, "LLR120"), [], "כרטיס עם span.mapnote בלבד");
  assert.deepEqual(contactsOf(GC.cards.LLD41, "LLD41"), [], "הפניה בלי מספר — אין רשומה (ולא משלימים)");
});

test("ייצוא חי: השדה היחיד שנוסף לאזורים הוא contacts (אופציונלי); שאר השדות והסדר כמו קודם", () => {
  const legacy = new Set(["id", "cat", "name", "alt", "approx", "rings", "c", "r", "pmt", "pmtRef", "appendix", "minFt", "coord", "note"]);
  const extra = new Set();
  for (const z of out.zones) for (const k of Object.keys(z)) if (!legacy.has(k)) extra.add(k);
  assert.deepEqual([...extra], ["contacts"]);
  for (const z of out.zones) { const ks = Object.keys(z); if ("contacts" in z) assert.equal(ks[ks.length - 1], "contacts", z.id + ": contacts אחרון"); }
  assert.deepEqual(Object.keys(out), ["edition", "mapVersion", "mapDate", "dataHash", "pamat", "zones", "approxIds", "approx09Ids", "general"]);
  assert.deepEqual(Object.keys(out.general), ["LLU", "B09"]);
  assert.equal(out.general.LLU.text.includes("[…]"), true, "הנוסח הכללי של LLU נשאר כפי שהיה (הפלט של שלב א׳ אינו משתנה)");
});

test("ייצוא חי: כל רשומת contacts תקינה — שדות, scope, role, בלי כתובות הארגון / נמעני נוטאם, בלי מפת-הערות", () => {
  const withC = out.zones.filter(z => z.contacts);
  assert.ok(withC.length >= 80, "אזורים עם contacts: " + withC.length);
  for (const z of withC) {
    assert.ok(Array.isArray(z.contacts) && z.contacts.length > 0, z.id);
    for (const e of z.contacts) {
      assert.deepEqual(Object.keys(e).filter(k => k !== "role"), ["ref", "scope", "text", "phones", "emails"], z.id);
      assert.ok(e.ref && typeof e.ref === "string", z.id); assert.ok(e.scope === "zone" || e.scope === "general", z.id);
      assert.ok(e.phones.length + e.emails.length > 0, z.id + ": רשומה בלי פרט קשר");
      assert.ok(e.role === undefined || ["exception", "recipient"].includes(e.role), z.id);
      for (const ph of e.phones) assert.match(ph, /^(0[2-9]\d?-\d{7}|1-(700|800|599)-\d{3}-\d{3})(\/\d{1,3})?$/, z.id + " " + ph);
      for (const m of e.emails) assert.match(m, /^[^\s@<>]+@[^\s@<>]+\.[A-Za-z]{2,}$/, z.id);
      assert.ok(!/icd\.org\.il|5076677|notamoffice|nofm@|fpl@iaa/i.test(JSON.stringify(e)), z.id + ": כתובת/טלפון פנימיים");
      assert.ok(!/הערת המפה|הודעה קבועה של המפה/.test(e.text), z.id + ": טקסט המפה בפרטי הקשר");
      if (e.role) assert.ok(e.phones.length === 0 && e.emails.every(m => /caai-charigot@|notamoffice@|nofm@|fpl@/i.test(m)), z.id + ": role על רשומה מעורבת");
    }
  }
});

test("ייצוא חי: סגירות — כל פרט קשר בציטוט מילולי בכרטיס (ובשורות ב-09) נמצא ב-contacts של האזור; ולכל רשומה יש מקור מילולי בכרטיס", () => {
  for (const z of out.zones) {
    if (/^B09/.test(z.cat)) {
      const ex = PARTIES.extract(z.pmt), want = new Set(ex.phones.map(p => p.text).concat(ex.emails.map(e => e.raw)));
      const have = new Set((z.contacts || []).flatMap(e => e.phones.concat(e.emails)));
      assert.deepEqual([...want].sort(), [...have].sort(), z.id);
      for (const e of z.contacts || []) assert.ok(squash(z.pmt).includes(bare(e.text)), z.id + ": " + e.text);
      continue;
    }
    if (z.approx && !NOTE_OF.has(z.id)) continue;
    const qs = cardQuotes(NOTE_OF.get(z.id)), want = new Set(), pool = squash(qs.map(q => q.text).join("\n"));
    for (const q of qs) { const ex = PARTIES.extract(q.text); ex.phones.filter(p => !p.role).forEach(p => want.add(p.text)); ex.emails.forEach(e => want.add(e.raw)); }
    const have = new Set((z.contacts || []).flatMap(e => e.phones.concat(e.emails)));
    for (const w of want) assert.ok(have.has(w), z.id + ": חסר " + w);
    for (const e of z.contacts || []) assert.ok(pool.includes(bare(e.text)), z.id + ": הטקסט אינו מצוטט כלשונו בכרטיס: " + e.text);
  }
});

test("ייצוא חי: שיוך — פסקה כללית (1א) לכל אזורי LLU; מספר ייעודי (scope:zone) מציטוט כללי רק כשמצוין בו מזהה האזור עצמו; אין מספר LLU21 באף אזור אחר", () => {
  const llu = out.zones.filter(z => z.cat === "LLU");
  assert.ok(llu.length >= 60);
  for (const z of llu) {
    assert.ok((z.contacts || []).some(e => e.scope === "general" && /^סעיף 1א בפמ"ת/.test(e.ref)), z.id + ": חסרה ההנחיה הכללית");
    for (const e of z.contacts) if (e.scope === "zone" && /^סעיף 1א/.test(e.ref)) assert.ok(new RegExp("(^|[^A-Za-z0-9])" + z.id + "(?![A-Za-z0-9])").test(e.text), z.id + ": מספר ייעודי בלי מזהה האזור: " + e.text);
  }
  const l21 = out.zones.find(z => z.id === "LLU21"), own = l21.contacts.filter(e => e.scope === "zone");
  assert.ok(own.length === 1 && own[0].phones.length === 1 && own[0].text.includes("LLU21"), "המספר הייעודי של LLU21");
  const num = own[0].phones[0];
  for (const z of out.zones) if (z.id !== "LLU21") for (const e of z.contacts || []) assert.ok(!e.phones.includes(num), z.id + " ירש את המספר של LLU21");
  const l20 = out.zones.find(z => z.id === "LLU20"); assert.deepEqual(l20.contacts.map(e => e.scope), ["general"]);
});

test("ייצוא חי: LLR (שטחי אש), LLP19, LLP14 — אנשי הקשר שבכרטיסים הגיעו ל-zones.json", () => {
  const Z2 = new Map(out.zones.map(z => [z.id, z]));
  const l30 = Z2.get("LLR30"); assert.ok(l30.contacts.every(e => /^סעיף 2 בפמ"ת/.test(e.ref) && e.scope === "general"));
  assert.ok(new Set(l30.contacts.flatMap(e => e.phones)).size >= 4 && l30.contacts.some(e => e.emails.length), "ארבעה מתא״מים ודוא״ל");
  const l19 = Z2.get("LLP19"); assert.ok(l19.contacts.some(e => !e.role && e.emails.length) && l19.contacts.some(e => e.role === "exception"));
  assert.ok(new Set(Z2.get("LLP14").contacts.flatMap(e => e.phones)).size >= 4, "רגרסיה: ארבעת הטלפונים של LLP14");
  const withSec2 = out.zones.filter(z => (z.contacts || []).some(e => /^סעיף 2 בפמ"ת/.test(e.ref))).map(z => z.id);
  assert.ok(withSec2.length >= 16 && withSec2.every(id => /^LLR/.test(id)), "אזורי LLR עם סעיף 2: " + withSec2.length);
});
