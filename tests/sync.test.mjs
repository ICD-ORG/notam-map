// בדיקות סנכרון עם מפת החברים (requests/js/sync.js): כל עדכון במפה שלא נקלט חייב להיתפס.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dataHash } from "../scripts/export-zones.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const S = require(path.join(ROOT, "members-k38p", "requests", "js", "sync.js"));
const J = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const html = fs.readFileSync(path.join(ROOT, "members-k38p", "index.html"), "utf8");
const zones = J("members-k38p/data/zones.json"), meta = J("members-k38p/pamat-meta.json"), cfg = J("members-k38p/requests/config.json");
const T = "2026-10-17T06:00:00Z";
const base = () => ({ html, meta: { ...meta }, zones, cfg, mapNotam: { fetched_iso: T }, notamAll: { fetched_iso: T } });

test("המצב הנוכחי של המאגר מסונכרן (הגיבוב בדפדפן = הגיבוב של הייצוא)", async () => {
  const r = await S.check(base());
  assert.deepEqual(r.problems, []);
  assert.equal(await S.sha256Hex(S.dataText(html)), dataHash(html));
});

test("שינוי כלשהו בנתוני המפה (שם אזור, קואורדינטה, טקסט בכרטיס) נתפס", async () => {
  for (const [a, b] of [['name:"שמורת הטבע החולה"', 'name:"שמורת הטבע החולה!"'], ["LLP01", "LLP0X"], ["const NM=1852;", "const NM=1853;"], ["תחילת פעילות בכל אזור דורשת אישור", "תחילת פעילות בכל אזור אינה דורשת אישור"]]) {
    assert.ok(html.includes(a), "הסימון לא נמצא: " + a);
    const r = await S.check({ ...base(), html: html.replace(a, b) });
    assert.ok(!r.ok && r.problems.some(x => /נתוני האזורים במפה עודכנו/.test(x)), a);
  }
});

test("שינוי מחוץ לקטעי הנתונים (עיצוב הדף) אינו מפיל את הסנכרון", async () => {
  const r = await S.check({ ...base(), html: html.replace("<title>", "<title> ") });
  assert.ok(r.ok, r.problems.join("|"));
});

test("מהדורת פמ״ת חדשה במפה: נתפסת גם מול קובץ האזורים וגם מול המהדורה שאומתה", async () => {
  const r = await S.check({ ...base(), meta: { ...meta, pamat_update: "2/26", pamat_date: "01 FEB 2027" } });
  assert.ok(!r.ok);
  assert.ok(r.problems.some(x => /שונה ממה שבקובץ האזורים/.test(x)));
  assert.ok(r.problems.some(x => /פורסם עדכון פמ״ת/.test(x) && /לאמת אותם מחדש/.test(x)));
});

test("המהדורה שאומתה חסרה בהגדרות — כשל", async () => {
  const c = JSON.parse(JSON.stringify(cfg)); delete c.pmt_editions;
  assert.ok((await S.check({ ...base(), cfg: c })).problems.some(x => /חסרה בהגדרות המהדורה/.test(x)));
});

test("נוטמים: קובץ הבקשות מפגר אחרי קובץ המפה ביותר מ-15 דקות — כשל; שווה או ישן יותר של המפה — תקין", async () => {
  const lag = await S.check({ ...base(), mapNotam: { fetched_iso: "2026-10-17T06:20:00Z" } });
  assert.ok(lag.problems.some(x => /מפגר אחרי קובץ הנוטמים של המפה \(20 דקות\)/.test(x)));
  assert.ok((await S.check({ ...base(), mapNotam: { fetched_iso: "2026-10-17T06:10:00Z" } })).ok);
  assert.ok((await S.check({ ...base(), mapNotam: { fetched_iso: "2026-10-16T06:00:00Z" } })).ok);
  assert.ok((await S.check({ ...base(), notamAll: {} })).problems.some(x => /לא ניתן להשוות/.test(x)));
});

test("מבנה המפה השתנה (סימון חסר) — כשל ברור ולא קריסה", async () => {
  const r = await S.check({ ...base(), html: html.replace("const NO_COORDS=[", "const NO_COORDS_RENAMED=[") });
  assert.ok(r.problems.some(x => /מבנה המפה השתנה/.test(x)));
});

test("סימוני הדפדפן זהים לסימוני הייצוא", async () => {
  const src = fs.readFileSync(path.join(ROOT, "scripts", "export-zones.mjs"), "utf8");
  for (const [a, b] of S.MARKS) { assert.ok(src.includes(JSON.stringify(a)), a); assert.ok(src.includes(JSON.stringify(b)), b); }
});
