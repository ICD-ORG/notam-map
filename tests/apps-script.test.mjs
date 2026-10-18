// בדיקות שרת Apps Script (apps-script/Code.gs) עם הדמיה של שירותי גוגל: משתמשים, חסימה, סיסמאות, אסימונים ושמירה לדרייב.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeEnv } from "./helpers/apps-script-env.mjs";

const PASS = "correct-horse-1";
function bootstrapped() {
  const env = makeEnv();
  const code = env.run("initialize");
  const r = env.call({ action: "bootstrap", code, user: "itzik", pass: PASS });
  assert.ok(r.ok, JSON.stringify(r));
  return { env, token: r.token };
}

test("לפני אתחול: בלי קוד הקמה אי אפשר ליצור מנהל, והשרת מדווח שצריך הקמה רק אחרי initialize", () => {
  const env = makeEnv();
  assert.equal(env.doGet().needsBootstrap, false);
  assert.equal(env.call({ action: "bootstrap", code: "x", user: "itzik", pass: PASS }).ok, false);
  env.run("initialize");
  assert.equal(env.doGet().needsBootstrap, true);
});

test("הקמת מנהל ראשון: קוד שגוי נדחה, קוד נכון עובד פעם אחת בלבד", () => {
  const env = makeEnv();
  const code = env.run("initialize");
  assert.equal(env.call({ action: "bootstrap", code: "wrong", user: "itzik", pass: PASS }).error, "bad_code");
  assert.equal(env.call({ action: "bootstrap", code, user: "itzik", pass: "short" }).error, "weak_pass");
  const ok = env.call({ action: "bootstrap", code, user: "itzik", pass: PASS });
  assert.ok(ok.ok && ok.role === "admin" && ok.token);
  assert.equal(env.call({ action: "bootstrap", code, user: "other", pass: PASS }).ok, false);
  assert.equal(env.doGet().needsBootstrap, false);
});

test("הסיסמה לא נשמרת גלויה ב-Properties", () => {
  const { env } = bootstrapped();
  assert.ok(!JSON.stringify(env.props).includes(PASS));
});

test("כניסה: סיסמה נכונה מצליחה, שגויה נכשלת, משתמש לא קיים נכשל באותה הודעה", () => {
  const { env } = bootstrapped();
  assert.ok(env.call({ action: "login", user: "itzik", pass: PASS }).ok);
  assert.equal(env.call({ action: "login", user: "itzik", pass: "nope-nope-nope" }).error, "bad_login");
  assert.equal(env.call({ action: "login", user: "ghost", pass: PASS }).error, "bad_login");
});

test("נעילה אחרי 5 ניסיונות כושלים, ושחרור אחרי 15 דקות", () => {
  const { env } = bootstrapped();
  for (let i = 0; i < 5; i++) env.call({ action: "login", user: "itzik", pass: "bad-bad-bad-" + i });
  assert.equal(env.call({ action: "login", user: "itzik", pass: PASS }).error, "locked");
  env.advance(16 * 60 * 1000);
  assert.ok(env.call({ action: "login", user: "itzik", pass: PASS }).ok);
});

test("אסימון: מזויף נדחה, שונה נדחה, פג תוקף אחרי 8 שעות", () => {
  const { env, token } = bootstrapped();
  assert.ok(env.call({ action: "me", token }).ok);
  assert.equal(env.call({ action: "me", token: token + "x" }).ok, false);
  const [p, s] = token.split(".");
  const forged = Buffer.from("itzik|admin|1|" + (Date.now() + 1e12)).toString("base64url");
  assert.equal(env.call({ action: "me", token: forged + "." + s }).ok, false);
  assert.equal(env.call({ action: "me", token: "garbage" }).ok, false);
  env.advance(9 * 3600 * 1000);
  assert.equal(env.call({ action: "me", token }).error, "expired");
});

test("מנהל מוסיף משתמש; משתמש רגיל נכנס אבל לא יכול לנהל משתמשים", () => {
  const { env, token } = bootstrapped();
  assert.ok(env.call({ action: "addUser", token, newUser: "dave", newPass: "dave-pass-123", role: "user" }).ok);
  const u = env.call({ action: "login", user: "dave", pass: "dave-pass-123" });
  assert.ok(u.ok && u.role === "user");
  for (const a of [{ action: "listUsers" }, { action: "addUser", newUser: "x-user", newPass: "xxxxxxxxxx1" }, { action: "setBlocked", target: "itzik", blocked: true }, { action: "resetPassword", target: "itzik", newPass: "zzzzzzzzzz1" }, { action: "deleteUser", target: "itzik" }]) {
    assert.equal(env.call({ ...a, token: u.token }).error, "forbidden", a.action);
  }
});

test("חסימה: משתמש חסום לא נכנס, והאסימון שכבר בידיו נפסל מיד גם לשמירה בדרייב; ביטול חסימה מחזיר כניסה", () => {
  const { env, token } = bootstrapped();
  env.call({ action: "addUser", token, newUser: "dave", newPass: "dave-pass-123" });
  const dave = env.call({ action: "login", user: "dave", pass: "dave-pass-123" });
  assert.ok(env.call({ action: "saveBegin", token: dave.token, folderName: "בדיקה", rid: newRid() }).ok);
  assert.ok(env.call({ action: "setBlocked", token, target: "dave", blocked: true }).ok);
  assert.equal(env.call({ action: "me", token: dave.token }).error, "blocked");
  assert.equal(env.call({ action: "saveBegin", token: dave.token, folderName: "אחרי חסימה", rid: newRid() }).error, "blocked");
  assert.equal(env.call({ action: "login", user: "dave", pass: "dave-pass-123" }).error, "blocked");
  assert.ok(env.call({ action: "setBlocked", token, target: "dave", blocked: false }).ok);
  assert.ok(env.call({ action: "login", user: "dave", pass: "dave-pass-123" }).ok);
  assert.equal(env.call({ action: "me", token: dave.token }).ok, false, "האסימון הישן נשאר פסול גם אחרי ביטול החסימה");
});

test("מנהל לא יכול לחסום או למחוק את עצמו", () => {
  const { env, token } = bootstrapped();
  assert.equal(env.call({ action: "setBlocked", token, target: "itzik", blocked: true }).error, "self");
  assert.equal(env.call({ action: "deleteUser", token, target: "itzik" }).error, "self");
});

test("החלפת סיסמה: צריך את הישנה; הישנה אינה עובדת יותר; אסימונים קודמים נפסלים", () => {
  const { env, token } = bootstrapped();
  assert.equal(env.call({ action: "changePassword", token, oldPass: "wrong-wrong-1", newPass: "brand-new-pass-1" }).error, "bad_login");
  assert.equal(env.call({ action: "changePassword", token, oldPass: PASS, newPass: "short" }).error, "weak_pass");
  const ch = env.call({ action: "changePassword", token, oldPass: PASS, newPass: "brand-new-pass-1" });
  assert.ok(ch.ok && ch.token);
  assert.equal(env.call({ action: "me", token }).ok, false);
  assert.ok(env.call({ action: "me", token: ch.token }).ok);
  assert.equal(env.call({ action: "login", user: "itzik", pass: PASS }).error, "bad_login");
  assert.ok(env.call({ action: "login", user: "itzik", pass: "brand-new-pass-1" }).ok);
});

test("איפוס סיסמה ע״י מנהל: הסיסמה הישנה והאסימונים של המשתמש נפסלים", () => {
  const { env, token } = bootstrapped();
  env.call({ action: "addUser", token, newUser: "dave", newPass: "dave-pass-123" });
  const dave = env.call({ action: "login", user: "dave", pass: "dave-pass-123" });
  assert.ok(env.call({ action: "resetPassword", token, target: "dave", newPass: "reset-pass-456" }).ok);
  assert.equal(env.call({ action: "me", token: dave.token }).ok, false);
  assert.equal(env.call({ action: "login", user: "dave", pass: "dave-pass-123" }).error, "bad_login");
  assert.ok(env.call({ action: "login", user: "dave", pass: "reset-pass-456" }).ok);
});

test("רשימת משתמשים לא חושפת סיסמאות או גיבובים", () => {
  const { env, token } = bootstrapped();
  const r = env.call({ action: "listUsers", token });
  assert.equal(r.users.length, 1);
  const txt = JSON.stringify(r);
  assert.ok(!/hash|salt|pass/i.test(txt.replace(/"newPass"/g, "")));
});

test("מחיקת משתמש", () => {
  const { env, token } = bootstrapped();
  env.call({ action: "addUser", token, newUser: "dave", newPass: "dave-pass-123" });
  assert.ok(env.call({ action: "deleteUser", token, target: "dave" }).ok);
  assert.equal(env.call({ action: "login", user: "dave", pass: "dave-pass-123" }).error, "bad_login");
});

test("שמירה לדרייב: תת-תיקייה בשם המקום והתאריך, קבצים נשמרים, אותו שם מחליף ישן, אותה תיקייה לא מוכפלת", () => {
  const { env, token } = bootstrapped();
  const rid = newRid();
  const b = env.call({ action: "saveBegin", token, folderName: 'פי גלילות, תל אביב — 22.10.2026', rid });
  assert.ok(b.ok);
  const content = Buffer.from("שלום docx").toString("base64");
  const f1 = env.call({ action: "saveFile", token, folderId: b.folderId, name: "בקשה.docx", mime: "application/octet-stream", b64: content });
  assert.ok(f1.ok);
  const f2 = env.call({ action: "saveFile", token, folderId: b.folderId, name: "בקשה.docx", mime: "application/octet-stream", b64: content });
  assert.ok(f2.ok);
  const live = env.folders[b.folderId].files.filter(f => !f.trashed);
  assert.equal(live.length, 1);
  assert.equal(live[0].bytes.toString("utf8"), "שלום docx");
  const again = env.call({ action: "saveBegin", token, folderName: 'פי גלילות, תל אביב — 22.10.2026', rid });
  assert.equal(again.folderId, b.folderId, "אותו rid חוזר לאותה תיקייה");
});

test("שמירה: אי אפשר לכתוב מחוץ לתיקיית הבקשות, שמות מנוקים, ללא אסימון נדחה", () => {
  const { env, token } = bootstrapped();
  env.folders.OUT = { id: "OUT", name: "פרטי", parent: null, files: [] };
  assert.equal(env.call({ action: "saveFile", token, folderId: "OUT", name: "x.txt", b64: "AAAA" }).error, "bad_folder");
  assert.equal(env.call({ action: "saveFile", token, folderId: "nope", name: "x.txt", b64: "AAAA" }).error, "bad_folder");
  const b = env.call({ action: "saveBegin", token, folderName: '../..\\evil:*?"<>|', rid: newRid() });
  assert.ok(b.ok && !/[\\/:*?"<>|]/.test(b.name));
  assert.equal(env.call({ action: "saveBegin", folderName: "x", rid: newRid() }).ok, false);
  assert.equal(env.call({ action: "saveFile", token: "bad", folderId: "ROOT", name: "x", b64: "AAAA" }).ok, false);
});

test("פעולה לא קיימת וגוף שבור נדחים בלי קריסה", () => {
  const { env } = bootstrapped();
  assert.equal(env.call({ action: "nope" }).error, "bad_action");
  const out = JSON.parse(vm.runInContext("doPost", env.sandbox)({ postData: { contents: "{not json" } }).text);
  assert.equal(out.error, "bad_request");
});

/* ===== שליחה למשרד נוטאם, מצב בדיקה/חי, יומן בקשות וניהול ===== */
const b64 = t => Buffer.from(t).toString("base64");
const newRid = () => crypto.randomBytes(12).toString("hex");
const modeOf = env => (env.props.MAIL_MODE === "live" ? "live" : "test");
const STD_FILES = [["בקשה.docx", "application/octet-stream"], ["הדמיה.png", "image/png"], ["תצ״א.png", "image/png"], ["קובץ.kml", "application/vnd.google-earth.kml+xml"], ["נתונים.json", "application/json"]];
// שמירה מלאה כמו בדפדפן: saveBegin (עם rid) → saveFile לכל קובץ → saveEnd (ready)
function savedRequest(env, token, name = "פי גלילות, תל אביב — 22.10.2026", files, rid = newRid(), ready = true) {
  const b = env.call({ action: "saveBegin", token, folderName: name, rid });
  assert.ok(b.ok, JSON.stringify(b));
  for (const [n, mime] of (files || STD_FILES))
    assert.ok(env.call({ action: "saveFile", token, folderId: b.folderId, name: n, mime, b64: b64("תוכן " + n) }).ok);
  const e = env.call({ action: "saveEnd", token, folderId: b.folderId, ready });
  assert.ok(e.ok, JSON.stringify(e));
  return Object.assign(b, { rid, ready: e.ready });
}
const goLive = (env, token) => assert.ok(env.call({ action: "setMailMode", token, mode: "live" }).ok);

// עודכן לדרישת עצמאות המבקש: מצב בדיקה שולח לכתובת המבקש (ולא "לבעלים"); כאן המבקש הוא המנהל — משתמש בלי כתובת שמורה — ולכן הכתובת היא של הבעלים
test("ברירת מחדל: מצב בדיקה — המייל נשלח רק לכתובת המבקש (מנהל בלי כתובת = הבעלים), עם קידומת בדיקה ובלי עותק למשרד נוטאם", () => {
  const { env, token } = bootstrapped();
  assert.equal(env.call({ action: "me", token }).mailMode, "test");
  const b = savedRequest(env, token);
  const r = env.call({ action: "sendRequest", expectMode: modeOf(env), token, folderId: b.folderId, subject: "בקשה לסגירה אווירית — פי גלילות", body: "שלום" });
  assert.ok(r.ok && r.mode === "test", JSON.stringify(r));
  assert.deepEqual(r.to, ["owner@icd.test"]);
  assert.equal(env.mails.length, 1);
  assert.equal(env.mails[0].to, "owner@icd.test");
  assert.equal(env.mails[0].bcc, undefined, "הבעלים כבר ב-to — לא נשלח אליו פעמיים");
  assert.match(env.mails[0].subject, /^\[בדיקה — לא נשלח למשרד נוטאם\] בקשה לסגירה אווירית/);
  assert.ok(!/iaa\.gov\.il/.test(JSON.stringify(env.mails[0])));
});

test("מצב חי: נמענים קבועים מפמ״ת א-11 סעיף 6(א) בלבד, עותק למבקש (כאן הבעלים, בלי כפילות ב-BCC), נושא ללא קידומת", () => {
  const { env, token } = bootstrapped(); goLive(env, token);
  const b = savedRequest(env, token);
  const r = env.call({ action: "sendRequest", expectMode: modeOf(env), token, folderId: b.folderId, subject: "בקשה לסגירה אווירית — פי גלילות", body: "שלום" });
  assert.ok(r.ok && r.mode === "live");
  assert.deepEqual(r.to, ["notamoffice@iaa.gov.il", "nofm@iaa.gov.il"]);
  const m = env.mails[0];
  assert.equal(m.to, "notamoffice@iaa.gov.il,nofm@iaa.gov.il");
  assert.equal(m.cc, "owner@icd.test");
  assert.equal(m.bcc, undefined, "הבעלים כבר ב-cc — לא נשלח אליו פעמיים");
  assert.equal(m.subject, "בקשה לסגירה אווירית — פי גלילות");
  assert.equal(m.replyTo, "owner@icd.test");
  assert.deepEqual(r.cc, ["owner@icd.test"]); assert.equal(r.target, "office"); assert.equal(r.adminCopy, true);
});

test("הלקוח לא יכול לקבוע נמענים: שדות to/cc/bcc בבקשה מתעלמים", () => {
  const { env, token } = bootstrapped(); goLive(env, token);
  const b = savedRequest(env, token);
  const r = env.call({ action: "sendRequest", expectMode: modeOf(env), token, folderId: b.folderId, subject: "נושא", body: "גוף", to: "evil@example.com", cc: "evil@example.com", bcc: "evil@example.com", recipients: ["evil@example.com"] });
  assert.ok(r.ok);
  assert.ok(!/evil@example/.test(JSON.stringify(env.mails[0])));
});

test("מצורפים רק Word, KML ותמונות; לא JSON, לא יומן ולא סימוני שליחה", () => {
  const { env, token } = bootstrapped();
  const b = savedRequest(env, token);
  const r = env.call({ action: "sendRequest", expectMode: modeOf(env), token, folderId: b.folderId, subject: "נושא", body: "גוף" });
  assert.deepEqual(r.files.sort(), ["בקשה.docx", "הדמיה.png", "קובץ.kml", "תצ״א.png"].sort());
  assert.equal(env.mails[0].attachments.length, 4);
  const marks = env.folders[b.folderId].files.filter(f => /^נשלח — /.test(f.name));
  assert.equal(marks.length, 1);
  assert.match(marks[0].name, /\(בדיקה\)\.txt$/);
  // שליחה נוספת לא מצרפת את סימון השליחה הקודם
  const r2 = env.call({ action: "sendRequest", expectMode: modeOf(env), token, folderId: b.folderId, subject: "נושא", body: "גוף" });
  assert.ok(r2.ok && !r2.files.some(n => /^נשלח/.test(n)));
});

test("חובה לצרף Word ותמונת מפה/תצ״א (א-11 נספח ג׳): בלי אחד מהם — נדחה", () => {
  const { env, token } = bootstrapped();
  // שמירה חלקית לא מסומנת "מוכנה" בשרת (saveEnd), ולכן השליחה נדחית
  const noImg = savedRequest(env, token, "בלי תמונה", [["בקשה.docx", "x"]]);
  assert.equal(noImg.ready, false);
  assert.equal(env.call({ action: "sendRequest", expectMode: modeOf(env), token, folderId: noImg.folderId, subject: "נ", body: "ג" }).error, "not_ready");
  const noDoc = savedRequest(env, token, "בלי וורד", [["הדמיה.png", "image/png"]]);
  assert.equal(env.call({ action: "sendRequest", expectMode: modeOf(env), token, folderId: noDoc.folderId, subject: "נ", body: "ג" }).error, "not_ready");
  // ואם הקובץ נמחק מהתיקייה אחרי שהבקשה סומנה מוכנה — השליחה עדיין נחסמת
  const full = savedRequest(env, token, "נמחק אחרי");
  env.folders[full.folderId].files.filter(f => /\.png$/.test(f.name)).forEach(f => { f.trashed = true; });
  assert.equal(env.call({ action: "sendRequest", expectMode: modeOf(env), token, folderId: full.folderId, subject: "נ", body: "ג" }).error, "missing_files");
  assert.equal(env.mails.length, 0);
});

test("שליחה חוזרת למשרד נוטאם של אותה בקשה נחסמת, ורק again:true מאפשר; שליחות בדיקה לא חוסמות", () => {
  const { env, token } = bootstrapped();
  const b = savedRequest(env, token);
  assert.ok(env.call({ action: "sendRequest", expectMode: modeOf(env), token, folderId: b.folderId, subject: "נ", body: "ג" }).ok);
  assert.ok(env.call({ action: "sendRequest", expectMode: modeOf(env), token, folderId: b.folderId, subject: "נ", body: "ג" }).ok);   // בדיקה פעמיים — מותר
  goLive(env, token);
  const first = env.call({ action: "sendRequest", expectMode: modeOf(env), token, folderId: b.folderId, subject: "נ", body: "ג" });
  assert.ok(first.ok && first.mode === "live");
  const dup = env.call({ action: "sendRequest", expectMode: modeOf(env), token, folderId: b.folderId, subject: "נ", body: "ג" });
  assert.equal(dup.error, "already_sent"); assert.ok(dup.sentAt > 0);
  assert.equal(env.mails.length, 3);
  assert.ok(env.call({ action: "sendRequest", expectMode: modeOf(env), token, folderId: b.folderId, subject: "נ", body: "ג", again: true }).ok);
  assert.equal(env.mails.length, 4);
});

test("הזרקת כותרות: שורות חדשות ותווי בקרה בנושא מנוקים; גוף נחתך", () => {
  const { env, token } = bootstrapped();
  const b = savedRequest(env, token);
  env.call({ action: "sendRequest", expectMode: modeOf(env), token, folderId: b.folderId, subject: "נושא\r\nBcc: evil@example.com\u2028x", body: "א".repeat(30000) });
  assert.ok(!/[\r\n]/.test(env.mails[0].subject));
  assert.ok(!/\u2028/.test(env.mails[0].subject));
  assert.equal(env.mails[0].body.length, 20000);
  assert.equal(env.call({ action: "sendRequest", expectMode: modeOf(env), token, folderId: b.folderId, subject: "  ", body: "ג" }).error, "bad_mail");
  assert.equal(env.call({ action: "sendRequest", expectMode: modeOf(env), token, folderId: b.folderId, subject: "נ", body: "" }).error, "bad_mail");
});

test("שליחה: רק מתוך תיקיית הבקשות, רק למשתמש מחובר ולא חסום, והגבלת קצב בשעה", () => {
  const { env, token } = bootstrapped();
  env.folders.OUT = { id: "OUT", name: "פרטי", parent: null, files: [{ id: "q", name: "בקשה.docx", mime: "x", bytes: Buffer.from("x"), trashed: false }, { id: "q2", name: "a.png", mime: "x", bytes: Buffer.from("x"), trashed: false }] };
  assert.equal(env.call({ action: "sendRequest", expectMode: modeOf(env), token, folderId: "OUT", subject: "נ", body: "ג" }).error, "bad_folder");
  assert.equal(env.call({ action: "sendRequest", expectMode: modeOf(env), token, folderId: "ROOT", subject: "נ", body: "ג" }).error, "bad_folder");
  assert.equal(env.call({ action: "sendRequest", expectMode: modeOf(env), folderId: "x", subject: "נ", body: "ג" }).ok, false);
  const b = savedRequest(env, token);
  env.call({ action: "addUser", token, newUser: "dave", newPass: "dave-pass-123" });
  const dave = env.call({ action: "login", user: "dave", pass: "dave-pass-123" });
  env.call({ action: "setBlocked", token, target: "dave", blocked: true });
  assert.equal(env.call({ action: "sendRequest", expectMode: modeOf(env), token: dave.token, folderId: b.folderId, subject: "נ", body: "ג" }).error, "blocked");
  for (let i = 0; i < 10; i++) assert.ok(env.call({ action: "sendRequest", expectMode: modeOf(env), token, folderId: b.folderId, subject: "נ", body: "ג" }).ok);
  assert.equal(env.call({ action: "sendRequest", expectMode: modeOf(env), token, folderId: b.folderId, subject: "נ", body: "ג" }).error, "rate");
  assert.equal(env.mails.length, 10);
});

test("מצב שליחה: רק מנהל משנה; משתמש רגיל לא יכול להעביר ל'חי'", () => {
  const { env, token } = bootstrapped();
  env.call({ action: "addUser", token, newUser: "dave", newPass: "dave-pass-123" });
  const dave = env.call({ action: "login", user: "dave", pass: "dave-pass-123" });
  assert.equal(env.call({ action: "setMailMode", token: dave.token, mode: "live" }).error, "forbidden");
  assert.equal(env.call({ action: "me", token: dave.token }).mailMode, "test");
  assert.ok(env.call({ action: "setMailMode", token, mode: "live" }).ok);
  assert.equal(env.call({ action: "me", token: dave.token }).mailMode, "live");
  assert.ok(env.call({ action: "setMailMode", token, mode: "garbage" }).ok);
  assert.equal(env.call({ action: "me", token }).mailMode, "test");
});

test("יומן בקשות: המנהל רואה את כל מי שהגיש, מתי, ומה נשלח; משתמש רגיל לא רואה", () => {
  const { env, token } = bootstrapped();
  env.call({ action: "addUser", token, newUser: "dave", newPass: "dave-pass-123" });
  const dave = env.call({ action: "login", user: "dave", pass: "dave-pass-123" });
  const b1 = savedRequest(env, token, "אתר א — 01.11.2026");
  const b2 = savedRequest(env, dave.token, "אתר ב — 02.11.2026");
  env.call({ action: "sendRequest", expectMode: modeOf(env), token: dave.token, folderId: b2.folderId, subject: "נ", body: "ג" });
  const reqs = env.call({ action: "listRequests", token });
  assert.ok(reqs.ok); assert.equal(reqs.requests.length, 2);
  const byName = Object.fromEntries(reqs.requests.map(x => [x.name, x]));
  assert.equal(byName["אתר ב — 02.11.2026"].user, "dave");
  assert.equal(byName["אתר ב — 02.11.2026"].sentTest, 1); assert.equal(byName["אתר ב — 02.11.2026"].sentLive, 0);
  assert.equal(byName["אתר א — 01.11.2026"].user, "itzik");
  assert.match(byName["אתר א — 01.11.2026"].url, /drive\.google\.com\/drive\/folders\//);
  assert.equal(env.call({ action: "listRequests", token, user: "dave" }).requests.length, 1);
  assert.equal(env.call({ action: "listRequests", token: dave.token }).error, "forbidden");
  const users = env.call({ action: "listUsers", token }).users;
  const d = users.find(u => u.user === "dave"), i = users.find(u => u.user === "itzik");
  assert.equal(d.requests, 1); assert.ok(d.lastRequest > 0); assert.equal(i.requests, 1);
  assert.equal(d.sent, 0);   // שליחת בדיקה לא נספרת כהגשה למשרד נוטאם
});

test("יומן: שמירה חוזרת של אותה בקשה לא יוצרת שורה נוספת; משתמש חסום נשאר ברשימה עם הבקשות שלו", () => {
  const { env, token } = bootstrapped();
  env.call({ action: "addUser", token, newUser: "dave", newPass: "dave-pass-123" });
  const dave = env.call({ action: "login", user: "dave", pass: "dave-pass-123" });
  const rid = newRid();
  savedRequest(env, dave.token, "אתר ג — 03.11.2026", null, rid); savedRequest(env, dave.token, "אתר ג — 03.11.2026", null, rid);
  assert.equal(env.call({ action: "listRequests", token }).requests.length, 1);
  env.call({ action: "setBlocked", token, target: "dave", blocked: true });
  const users = env.call({ action: "listUsers", token }).users, d = users.find(u => u.user === "dave");
  assert.ok(d.blocked && d.requests === 1);
});

test("מספר גדול של משתמשים: אין מגבלת 9KB של מאפיין בודד (80 משתמשים)", () => {
  const { env, token } = bootstrapped();
  for (let i = 0; i < 80; i++) assert.ok(env.call({ action: "addUser", token, newUser: "pilot." + String(i).padStart(3, "0"), newPass: "pilot-pass-" + i + "xx" }).ok, "i=" + i);
  assert.equal(env.call({ action: "listUsers", token }).users.length, 81);
  assert.ok(Object.keys(env.props).filter(k => k.startsWith("U:")).every(k => env.props[k].length < 9000));
  assert.ok(env.call({ action: "login", user: "pilot.079", pass: "pilot-pass-79xx" }).ok);
});

test("שם משתמש בעברית נתמך; שמות לא תקינים נדחים", () => {
  const { env, token } = bootstrapped();
  assert.ok(env.call({ action: "addUser", token, newUser: "יצחק בן שבת", newPass: "dave-pass-123" }).ok);
  assert.ok(env.call({ action: "login", user: "יצחק בן שבת", pass: "dave-pass-123" }).ok);
  for (const bad of ["ab", " lead", "x".repeat(41), "a/b", "evil\nname", "a<script>b"]) assert.equal(env.call({ action: "addUser", token, newUser: bad, newPass: "dave-pass-123" }).error, "bad_user", JSON.stringify(bad));
});

/* ===== תיקוני סקירה: מצב שליחה, מזהה בקשה, "מוכנה", יומן שנכשל סגור ===== */
const sendBody = (env, token, folderId, extra) => ({ action: "sendRequest", expectMode: modeOf(env), token, folderId, subject: "נ", body: "ג", ...extra });

test("מצב שליחה מיושן בדפדפן: אם הלקוח הציג 'בדיקה' והשרת במצב 'חי' — לא נשלח כלום (mode_changed)", () => {
  const { env, token } = bootstrapped();
  const b = savedRequest(env, token);
  goLive(env, token);
  const r = env.call({ action: "sendRequest", token, folderId: b.folderId, subject: "נ", body: "ג", expectMode: "test" });
  assert.equal(r.error, "mode_changed"); assert.equal(r.mailMode, "live");
  assert.equal(env.mails.length, 0);
  // ובכיוון ההפוך, ובלי expectMode בכלל
  assert.equal(env.call({ action: "sendRequest", token, folderId: b.folderId, subject: "נ", body: "ג" }).error, "mode_changed");
  assert.equal(env.call({ action: "sendRequest", token, folderId: b.folderId, subject: "נ", body: "ג", expectMode: "garbage" }).error, "mode_changed");
  assert.equal(env.mails.length, 0);
  assert.ok(env.call(sendBody(env, token, b.folderId)).ok);
});

test("מזהה בקשה (rid): בקשה אחרת באותו מקום ותאריך מקבלת תיקייה נפרדת ולא דורסת קבצים; rid לא תקין נדחה", () => {
  const { env, token } = bootstrapped();
  const one = savedRequest(env, token, "אתר — 01.11.2026", [["בקשה.docx", "x"], ["a.png", "image/png"]]);
  const two = savedRequest(env, token, "אתר — 01.11.2026", [["בקשה.docx", "y"], ["a.png", "image/png"]]);
  assert.notEqual(one.folderId, two.folderId);
  assert.equal(one.name, "אתר — 01.11.2026"); assert.equal(two.name, "אתר — 01.11.2026 (2)");
  const text = id => env.folders[id].files.filter(f => !f.trashed && /\.docx$/.test(f.name)).map(f => f.bytes.toString());
  assert.deepEqual(text(one.folderId), ["תוכן בקשה.docx"]);
  for (const bad of ["", "abc", "ZZZZZZZZZZZZZZZZ", "a".repeat(80), undefined])
    assert.equal(env.call({ action: "saveBegin", token, folderName: "x", rid: bad }).error, "bad_rid", String(bad));
});

test("שמירה חוזרת של אותו rid מנקה קבצים ישנים (גם אם השם השתנה) ומאפסת את סימון 'מוכנה' עד saveEnd", () => {
  const { env, token } = bootstrapped();
  const rid = newRid();
  const a = savedRequest(env, token, "שם ישן — 01.11.2026", [["שם ישן.docx", "x"], ["שם ישן.png", "image/png"]], rid);
  const b = env.call({ action: "saveBegin", token, folderName: "שם חדש — 01.11.2026", rid });
  assert.equal(b.folderId, a.folderId); assert.equal(env.folders[a.folderId].name, "שם חדש — 01.11.2026");
  assert.equal(env.folders[a.folderId].files.filter(f => !f.trashed).length, 0, "אין שאריות מהגרסה הקודמת");
  assert.equal(env.call(sendBody(env, token, a.folderId)).error, "not_ready", "באמצע שמירה אי אפשר לשלוח");
  env.call({ action: "saveFile", token, folderId: b.folderId, name: "שם חדש.docx", mime: "x", b64: b64("1") });
  assert.equal(env.call({ action: "saveEnd", token, folderId: b.folderId, ready: true }).ready, false, "בלי תמונה — לא מוכנה");
  env.call({ action: "saveFile", token, folderId: b.folderId, name: "שם חדש.png", mime: "image/png", b64: b64("2") });
  assert.equal(env.call({ action: "saveEnd", token, folderId: b.folderId, ready: false }).ready, false, "הלקוח לא אישר מוכנה");
  assert.equal(env.call(sendBody(env, token, b.folderId)).error, "not_ready");
  assert.equal(env.call({ action: "saveEnd", token, folderId: b.folderId, ready: true }).ready, true);
  assert.ok(env.call(sendBody(env, token, b.folderId)).ok);
  assert.deepEqual(Array.from(env.mails[0].attachments, x => x.name).sort(), ["שם חדש.docx", "שם חדש.png"]);
});

test("בקשה שנשלחה חי נעולה: אותו rid לא נערך מחדש (already_sent), ושמירה כבקשה חדשה מקבלת תיקייה אחרת", () => {
  const { env, token } = bootstrapped(); goLive(env, token);
  const first = savedRequest(env, token, "אתר — 02.11.2026");
  assert.ok(env.call(sendBody(env, token, first.folderId)).ok);
  const again = env.call({ action: "saveBegin", token, folderName: "אתר — 02.11.2026", rid: first.rid });
  assert.equal(again.error, "already_sent"); assert.ok(again.sentAt > 0);
  assert.equal(env.folders[first.folderId].files.filter(f => !f.trashed && /docx$/.test(f.name)).length, 1, "הקבצים שנשלחו לא נדרסו");
  const fresh = savedRequest(env, token, "אתר — 02.11.2026");
  assert.notEqual(fresh.folderId, first.folderId);
  assert.equal(env.call(sendBody(env, token, fresh.folderId)).similar, true, "אותו מקום ותאריך שכבר נשלחו — השרת מזהה כפילות אפשרית");
  assert.ok(env.call(sendBody(env, token, fresh.folderId, { again: true })).ok, "בקשה מעודכנת נשלחת רק באישור מפורש");
});

test("בעלות: משתמש אחר לא שומר לתוך rid של אחרים ולא שולח את התיקייה שלהם; מנהל כן", () => {
  const { env, token } = bootstrapped();
  env.call({ action: "addUser", token, newUser: "dave", newPass: "dave-pass-123" });
  const dave = env.call({ action: "login", user: "dave", pass: "dave-pass-123" });
  const mine = savedRequest(env, token, "של המנהל — 03.11.2026");
  assert.equal(env.call({ action: "saveBegin", token: dave.token, folderName: "x", rid: mine.rid }).error, "forbidden");
  assert.equal(env.call({ action: "saveEnd", token: dave.token, folderId: mine.folderId, ready: true }).error, "forbidden");
  assert.equal(env.call(sendBody(env, dave.token, mine.folderId)).error, "forbidden");
  assert.equal(env.mails.length, 0);
  const his = savedRequest(env, dave.token, "של דייב — 03.11.2026");
  assert.ok(env.call(sendBody(env, token, his.folderId)).ok, "מנהל רשאי");
  // תיקייה שהמערכת לא יצרה (אין ביומן) לא נשלחת גם אם היא בתוך תיקיית הבקשות
  const rogue = env.folders.ROOT && { id: "R1", name: "ידנית", parent: "ROOT", files: [{ id: "r1", name: "בקשה.docx", mime: "x", bytes: Buffer.from("x"), trashed: false }, { id: "r2", name: "a.png", mime: "x", bytes: Buffer.from("x"), trashed: false }] };
  env.folders.R1 = rogue;
  assert.equal(env.call(sendBody(env, token, "R1")).error, "bad_folder");
});

test("יומן נכשל סגור: JSON פגום או תקלת דרייב לא מאפסים אותו ולא מתירים שליחה כפולה", () => {
  const { env, token } = bootstrapped(); goLive(env, token);
  const b = savedRequest(env, token);
  assert.ok(env.call(sendBody(env, token, b.folderId)).ok);
  const logF = env.folders.ROOT.files.find(f => f.name === "_יומן בקשות.json");
  const good = logF.bytes.toString();
  // JSON פגום
  logF.bytes = Buffer.from("{corrupt");
  const dup = env.call(sendBody(env, token, b.folderId, { again: false }));
  assert.equal(dup.ok, false); assert.equal(dup.error, "server");
  assert.equal(env.mails.length, 1, "לא נשלח מייל נוסף");
  assert.equal(logF.bytes.toString(), "{corrupt", "היומן הפגום לא נדרס בריק");
  assert.equal(env.call({ action: "saveBegin", token, folderName: "חדש", rid: newRid() }).error, "server");
  assert.equal(logF.bytes.toString(), "{corrupt");
  // המנהל עדיין יכול לנהל משתמשים (חסימה) גם כשהיומן פגום, ורואה את התקלה
  const lu = env.call({ action: "listUsers", token });
  assert.ok(lu.ok && lu.logError && lu.users.length === 1);
  logF.bytes = Buffer.from(good);
  // תקלת דרייב חולפת
  env.fail.drive = true;
  assert.equal(env.call(sendBody(env, token, b.folderId)).ok, false);
  env.fail.drive = false;
  assert.equal(env.call(sendBody(env, token, b.folderId)).error, "already_sent");
  assert.equal(env.mails.length, 1);
});

test("'השליחה התחילה' נרשמת לפני יציאת המייל; כשל שליחה מתועד כ-failed ולא חוסם; כשל אחרי השליחה לא מתיר כפילות", () => {
  const { env, token } = bootstrapped(); goLive(env, token);
  const logOf = () => JSON.parse(env.folders.ROOT.files.find(f => f.name === "_יומן בקשות.json").bytes.toString());
  const b = savedRequest(env, token);
  let seen = null;
  env.hooks.beforeMail = () => { seen = logOf()[0].sent.map(x => x.st); };
  env.fail.mail = true;
  const bad = env.call(sendBody(env, token, b.folderId));
  assert.equal(bad.ok, false);
  assert.deepEqual(seen, ["sending"], "הרשומה קיימת לפני שהמייל יוצא");
  assert.deepEqual(logOf()[0].sent.map(x => x.st), ["failed"]);
  assert.equal(env.call({ action: "listRequests", token }).requests[0].sentLive, 0, "שליחה שנכשלה לא נספרת");
  env.fail.mail = false; env.hooks.beforeMail = null;
  assert.ok(env.call(sendBody(env, token, b.folderId)).ok, "אפשר לנסות שוב אחרי כשל");
  assert.deepEqual(logOf()[0].sent.map(x => x.st), ["failed", "sent"]);
  // קריסה אחרי היציאה: הרשומה נשארת "sending" וממשיכה לחסום כפילות
  const c = savedRequest(env, token, "אתר קריסה — 04.11.2026");
  env.hooks.beforeMail = () => { throw new Error("simulated crash after intent"); };
  env.call(sendBody(env, token, c.folderId));
  env.hooks.beforeMail = null;
  const entry = logOf().find(x => x.id === c.folderId);
  assert.ok(["failed", "sending"].includes(entry.sent[0].st));
});

// עודכן לדרישת הגיזום הבטוח (n=3): LOG_MAX הוא יעד רך. בקשה שלא נשלחה חי נמחקת רק אחרי LOG_KEEP_DAYS (30) ימים בלי מגע; צעירות מוגנות גם כשהיומן חורג.
test("גיזום היומן לא מוחק רשומה עם שליחה חיה ולא בקשה צעירה מ-30 יום; מוחק רק ישנות שלא נשלחו, הישנות ביותר קודם", () => {
  const { env, token } = bootstrapped(); goLive(env, token);
  vm.runInContext("CFG.LOG_MAX = 4", env.sandbox);
  const logF = () => env.folders.ROOT.files.find(f => f.name === "_יומן בקשות.json");
  const readL = () => JSON.parse(logF().bytes.toString());
  const sent = savedRequest(env, token, "נשלחה — 01.11.2026");
  assert.ok(env.call(sendBody(env, token, sent.folderId)).ok);
  for (let i = 0; i < 8; i++) savedRequest(env, token, "טיוטה " + i);
  assert.equal(readL().length, 9, "כל הטיוטות צעירות מ-30 יום: מוגנות גם כשהיומן חורג מ-LOG_MAX");
  assert.ok(readL().some(x => x.id === sent.folderId), "הרשומה שנשלחה חי נשמרה");
  // מזקינים 6 טיוטות (טיוטה 0 הישנה ביותר) ל-40..45 ימים אחורה
  const log = readL(), DAYMS = 86400000;
  for (let i = 0; i < 6; i++) { const e = log.find(x => x.base === "טיוטה " + i); e.saved = e.created = env.now() - (45 - i) * DAYMS; }
  logF().bytes = Buffer.from(JSON.stringify(log));
  vm.runInContext("CFG.LOG_MAX = 7", env.sandbox);
  savedRequest(env, token, "חדשה א");                       // 10 רשומות, יעד 7 => נמחקות 3: הישנות ביותר מבין המוזקנות
  let after = readL();
  assert.equal(after.length, 7);
  assert.deepEqual(["טיוטה 0", "טיוטה 1", "טיוטה 2"].filter(n => after.some(x => x.base === n)), [], "הישנות ביותר נמחקו");
  assert.ok(["טיוטה 3", "טיוטה 4", "טיוטה 5"].every(n => after.some(x => x.base === n)));
  vm.runInContext("CFG.LOG_MAX = 4", env.sandbox);
  savedRequest(env, token, "חדשה ב");
  after = readL();
  assert.ok(after.some(x => x.id === sent.folderId), "שליחה חיה לעולם לא נמחקת");
  assert.ok(!after.some(x => ["טיוטה 3", "טיוטה 4", "טיוטה 5"].includes(x.base)), "כל המוזקנות נמחקו, ורק הן");
  assert.ok(after.some(x => x.base === "טיוטה 6") && after.some(x => x.base === "טיוטה 7") && after.some(x => x.base === "חדשה א") && after.some(x => x.base === "חדשה ב"), "הצעירות נשארו, בלי קשר ליעד");
  assert.equal(env.call({ action: "sendRequest", expectMode: "live", token, folderId: sent.folderId, subject: "נ", body: "ג" }).error, "already_sent");
});

test("גיזום היומן: יומן מלא ברשומות שנשלחו חי — כתיבה של מטיס אחד לא מוחקת בקשה שמורה/מוכנה של מטיס אחר, גם באמצע זרימה", () => {
  const { env, token } = withWix(); goLive(env, token);
  vm.runInContext("CFG.LOG_MAX = 3", env.sandbox);
  const pilot = pilotUser(env, "b@example.com", "pilot.bravo");
  const b = savedRequest(env, pilot.token, "של בראבו — 20.12.2026");       // מוכנה, לא נשלחה
  for (let i = 0; i < 4; i++) assert.ok(env.call(sendBody(env, token, savedRequest(env, token, "חי " + i + " — 21.12.2026").folderId)).ok);   // 4 > LOG_MAX רשומות חיות
  const b2 = env.call({ action: "saveBegin", token: pilot.token, folderName: "באמצע זרימה — 22.12.2026", rid: newRid() });
  assert.ok(b2.ok);
  savedRequest(env, token, "מנהל כותב — 23.12.2026");              // כתיבה של משתמש אחר
  assert.ok(env.call({ action: "saveFile", token: pilot.token, folderId: b2.folderId, name: "בקשה.docx", mime: "x", b64: b64("1") }).ok, "saveFile באמצע זרימה לא קיבל bad_folder");
  const logNow = JSON.parse(env.folders.ROOT.files.find(f => f.name === "_יומן בקשות.json").bytes.toString());
  assert.ok(logNow.some(x => x.id === b.folderId), "הבקשה המוכנה של בראבו נשארה");
  assert.ok(env.call(sendBody(env, pilot.token, b.folderId)).ok, "והיא עדיין ניתנת לשליחה");
});

test("הצפה: תקרת תיקיות חדשות בשעה למשתמש; שמירה חוזרת של אותה בקשה אינה נספרת", () => {
  const { env, token } = bootstrapped();
  const rid = newRid();
  for (let i = 0; i < 30; i++) assert.ok(env.call({ action: "saveBegin", token, folderName: "בקשה " + i, rid: i === 0 ? rid : newRid() }).ok, "i=" + i);
  assert.equal(env.call({ action: "saveBegin", token, folderName: "אחת יותר מדי", rid: newRid() }).error, "rate");
  assert.ok(env.call({ action: "saveBegin", token, folderName: "בקשה 0", rid }).ok, "עריכה של בקשה קיימת מותרת");
  env.advance(61 * 60 * 1000);
  assert.ok(env.call({ action: "saveBegin", token, folderName: "אחרי שעה", rid: newRid() }).ok);
});

test("משתמש שנמחק ונוצר מחדש באותו שם: אסימון ישן לא חוזר לחיים", () => {
  const { env, token } = bootstrapped();
  env.call({ action: "addUser", token, newUser: "dave", newPass: "dave-pass-123" });
  const old = env.call({ action: "login", user: "dave", pass: "dave-pass-123" });
  assert.ok(env.call({ action: "me", token: old.token }).ok);
  env.call({ action: "deleteUser", token, target: "dave" });
  env.advance(5);
  env.call({ action: "addUser", token, newUser: "dave", newPass: "dave-pass-123" });
  assert.equal(env.call({ action: "me", token: old.token }).ok, false);
  assert.ok(env.call({ action: "me", token: env.call({ action: "login", user: "dave", pass: "dave-pass-123" }).token }).ok);
  // כנ"ל להקמת מנהל מחדש: tv אינו קבוע
  assert.ok(Number(JSON.parse(env.props["U:dave"]).tv) > 1000);
});

test("החלפת סיסמה: ניחושי סיסמה ישנה מוגבלים (5) ונעילה נפרדת מנעילת הכניסה", () => {
  const { env, token } = bootstrapped();
  for (let i = 0; i < 5; i++) assert.equal(env.call({ action: "changePassword", token, oldPass: "wrong-guess-" + i, newPass: "brand-new-pass-1" }).error, "bad_login");
  assert.equal(env.call({ action: "changePassword", token, oldPass: PASS, newPass: "brand-new-pass-1" }).error, "locked", "גם הסיסמה הנכונה נדחית בזמן הנעילה");
  assert.ok(env.call({ action: "login", user: "itzik", pass: PASS }).ok, "הכניסה עצמה לא ננעלה");
  env.advance(16 * 60 * 1000);
  assert.ok(env.call({ action: "changePassword", token: env.call({ action: "login", user: "itzik", pass: PASS }).token, oldPass: PASS, newPass: "brand-new-pass-1" }).ok);
});

test("שם קובץ ארוך נחתך בלי לאבד את הסיומת (אחרת Word לא יזוהה ויצורף)", () => {
  const { env, token } = bootstrapped();
  const long = "מקום ארוך מאוד ".repeat(12) + "— 22.10.2026 עד 30.10.2026 — בקשה לסגירה אווירית.docx";
  const b = env.call({ action: "saveBegin", token, folderName: "ארוך", rid: newRid() });
  const f = env.call({ action: "saveFile", token, folderId: b.folderId, name: long, mime: "x", b64: b64("1") });
  assert.ok(f.ok);
  const name = env.folders[b.folderId].files.find(x => !x.trashed).name;
  assert.match(name, /\.docx$/); assert.ok(name.length <= 120);
});

test("אותו מקום ותאריך שכבר נשלחו חי מבקשה אחרת (למשל אחרי רענון הדף) — נחסם כשליחה כפולה עד again:true", () => {
  const { env, token } = bootstrapped(); goLive(env, token);
  const first = savedRequest(env, token, "אתר כפול — 05.11.2026");
  assert.ok(env.call(sendBody(env, token, first.folderId)).ok);
  const second = savedRequest(env, token, "אתר כפול — 05.11.2026");   // rid חדש
  assert.equal(second.name, "אתר כפול — 05.11.2026 (2)");
  const dup = env.call(sendBody(env, token, second.folderId));
  assert.equal(dup.error, "already_sent"); assert.equal(dup.similar, true); assert.equal(env.mails.length, 1);
  assert.ok(env.call(sendBody(env, token, second.folderId, { again: true })).ok);
  // מקום אחר לא נחסם
  assert.ok(env.call(sendBody(env, token, savedRequest(env, token, "אתר אחר — 05.11.2026").folderId)).ok);
});

/* ===== מנוי מטיס מסחרי: כרטיס Wix → הרשמה בקוד מייל → תוקף, חידוש ותזכורות ===== */
const DAY = 86400000;
function withWix() {
  const r = bootstrapped(); r.env.props.WIX_API_KEY = "test-key";
  return r;
}
const iso = ms => new Date(ms).toISOString();
let ordSeq = 0;
function addOrder(env, over) {
  const o = Object.assign({ orderNumber: "ORD-" + String(++ordSeq).padStart(4, "0"), status: "PAID", created: iso(env.now() - 2 * DAY), email: "pilot@example.com", firstName: "דנה", memberId: "m-1", tickets: [] }, over);
  env.wix.orders.push(o); return o;
}
const codeFrom = env => { const m = env.mails[env.mails.length - 1]; const c = /(\d{6})/.exec(m.subject); assert.ok(c, "אין קוד בנושא: " + m.subject); return c[1]; };
const regOk = (env, over) => {
  assert.ok(env.call({ action: "regStart", email: "pilot@example.com" }).ok);
  return env.call({ action: "regFinish", email: "pilot@example.com", code: codeFrom(env), user: "dana.pilot", pass: "dana-pass-1234", ...over });
};
const HOUR = 3600000;
// מיישר את השעון המדומה ל-09:20 UTC (כ-12:20 בישראל): אמצע שעה ואמצע יום, כך שבדיקות שמונות לפי שעה/יום לא ייחתכו בגבול אקראי של השעון האמיתי. לקרוא לפני יצירת אסימונים (קידום עד 24 שעות)
function calm(env) {
  const day = 24 * HOUR, target = 9 * HOUR + 20 * 60000, off = env.now() % day;
  env.advance(off <= target ? target - off : day - off + target);
}
// כמו withWix, עם שעון מיושר (ראו calm)
function calmWix() {
  const env = makeEnv(); calm(env);
  const code = env.run("initialize"), r = env.call({ action: "bootstrap", code, user: "itzik", pass: PASS });
  assert.ok(r.ok, JSON.stringify(r)); env.props.WIX_API_KEY = "test-key";
  return { env, token: r.token };
}
const regAns = (env, email) => JSON.parse(JSON.stringify(env.call({ action: "regStart", email })));    // תשובת regStart כעותק פשוט להשוואת deepEqual
const setCfg = (env, k, v) => vm.runInContext("CFG." + k + " = " + JSON.stringify(v), env.sandbox);

test("הרשמה: כרטיס ששולם → קוד למייל → שם משתמש וסיסמה שהמשתמש בוחר → כניסה; תוקף 12 חודשים מיום הרכישה", () => {
  const { env, token } = withWix(); const o = addOrder(env);
  const s = env.call({ action: "regStart", email: "Pilot@Example.com " });
  assert.ok(s.ok);
  assert.equal(env.mails.length, 1); assert.equal(env.mails[0].to, "pilot@example.com");
  assert.match(env.mails[0].subject, /קוד הרשמה לבקשות טיסה: \d{6}/);
  const r = env.call({ action: "regFinish", email: "pilot@example.com", code: codeFrom(env), user: "dana.pilot", pass: "dana-pass-1234" });
  assert.ok(r.ok && r.token && r.role === "user", JSON.stringify(r));
  const created = new Date(o.created); created.setUTCMonth(created.getUTCMonth() + 12);
  assert.equal(r.until, created.getTime());
  assert.ok(env.call({ action: "login", user: "dana.pilot", pass: "dana-pass-1234" }).ok);
  const u = JSON.parse(env.props["U:dana.pilot"]); assert.equal(u.email, "pilot@example.com"); assert.deepEqual(Array.from(u.orders), [o.orderNumber]);
  assert.ok(!JSON.stringify(env.props).includes("dana-pass-1234"));
  // המשתמש הרגיל לא מנהל, והמנהל רואה אימייל ותוקף
  assert.equal(env.call({ action: "listUsers", token: r.token }).error, "forbidden");
  const row = env.call({ action: "listUsers", token }).users.find(x => x.user === "dana.pilot");
  assert.equal(row.email, "pilot@example.com"); assert.equal(row.until, r.until); assert.equal(row.source, "ticket");
  // בקריאות ל-Wix נשלחים מפתח וזיהוי אתר, ורק status=PAID של האירוע הנכון
  const c = env.wix.calls[0]; assert.equal(c.headers.Authorization, "test-key"); assert.equal(c.headers["wix-site-id"], "29dca6d8-08d4-4679-a6e5-c5f4f3317d90");
  assert.match(c.search, /eventId=fbcb2cc1-4dc7-4545-b9d5-08febf9f8153/); assert.match(c.search, /status=PAID/);
});

test("הרשמה: בלי כרטיס ששולם בפועל — לא נשלח קוד, והתשובה זהה (אי אפשר לברר מי רכש)", () => {
  const { env } = withWix();
  const base = env.call({ action: "regStart", email: "nobody@example.com" });   // אין הזמנות כלל
  addOrder(env, { email: "free@example.com", status: "FREE" });
  addOrder(env, { email: "offline@example.com", status: "OFFLINE_PENDING" });
  addOrder(env, { email: "canceled@example.com", status: "CANCELED" });
  addOrder(env, { email: "pending@example.com", status: "PENDING" });
  addOrder(env, { email: "visitor@example.com", memberId: "" });                    // לא חבר רשום באתר
  addOrder(env, { email: "other@example.com", eventId: "00000000-0000-0000-0000-000000000000" });   // אירוע אחר
  addOrder(env, { email: "pilot@example.com.evil", status: "PAID" });                // התאמה חלקית
  const answers = ["free", "offline", "canceled", "pending", "visitor", "other", "pilot"].map(n => env.call({ action: "regStart", email: n + "@example.com" }));
  for (const a of answers) assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(base)));
  assert.equal(env.mails.length, 0, "לא נשלח אף קוד");
});

test("הרשמה: הזמנה שנרשמה בשם מייל אחר/בכרטיס של משתתף אחר — מתאימים לפי המייל שבהזמנה או שבכרטיס, בשוויון מלא", () => {
  const { env } = withWix();
  addOrder(env, { email: "buyer@example.com", tickets: [{ guestDetails: { email: "holder@example.com" } }] });
  assert.ok(env.call({ action: "regStart", email: "holder@example.com" }).ok);
  assert.equal(env.mails.length, 1, "בעל הכרטיס (לא הרוכש) זכאי");
  assert.ok(env.call({ action: "regStart", email: "holder@example.co" }).ok);
  assert.equal(env.mails.length, 1, "מייל דומה אינו זכאי");
});

test("הרשמה: קוד שגוי נספר ונחסם אחרי 5, קוד פג תוקף אחרי 15 דקות, ושם משתמש/סיסמה נבדקים בלי לשרוף את הקוד", () => {
  const { env } = withWix(); addOrder(env);
  env.call({ action: "regStart", email: "pilot@example.com" }); const code = codeFrom(env);
  assert.equal(env.call({ action: "regFinish", email: "pilot@example.com", code, user: "dana.pilot" }).error, "need_credentials");
  assert.equal(env.call({ action: "regFinish", email: "pilot@example.com", code, user: "dana.pilot", pass: "short" }).error, "weak_pass");
  assert.equal(env.call({ action: "regFinish", email: "pilot@example.com", code, user: "a/b", pass: "dana-pass-1234" }).error, "bad_user");
  assert.equal(env.call({ action: "regFinish", email: "pilot@example.com", code, user: "itzik", pass: "dana-pass-1234" }).error, "exists");
  for (let i = 0; i < 5; i++) assert.equal(env.call({ action: "regFinish", email: "pilot@example.com", code: "000000", user: "dana.pilot", pass: "dana-pass-1234" }).error, "bad_code");
  assert.equal(env.call({ action: "regFinish", email: "pilot@example.com", code, user: "dana.pilot", pass: "dana-pass-1234" }).error, "bad_code", "אחרי 5 כשלונות גם הקוד הנכון נדחה");
  env.call({ action: "regStart", email: "pilot@example.com" }); const c2 = codeFrom(env);
  env.advance(16 * 60000);
  assert.equal(env.call({ action: "regFinish", email: "pilot@example.com", code: c2, user: "dana.pilot", pass: "dana-pass-1234" }).error, "bad_code", "פג תוקף");
});

test("הרשמה: כל הזמנה נצרכת פעם אחת — לא אפשר להירשם פעמיים עם אותו כרטיס (גם במייל שני)", () => {
  const { env } = withWix(); addOrder(env, { tickets: [{ guestDetails: { email: "friend@example.com" } }] });
  assert.ok(regOk(env).ok);
  env.call({ action: "regStart", email: "friend@example.com" });                    // אותה הזמנה, משתתף אחר
  assert.equal(env.mails.filter(m => /קוד/.test(m.subject)).length, 1, "ההזמנה כבר נוצלה — אין קוד נוסף");
  // מייל שכבר רשום ללא כרטיס חדש: מקבל תזכורת שם משתמש (לא קוד)
  const before = env.mails.length; env.call({ action: "regStart", email: "pilot@example.com" });
  assert.equal(env.mails.length, before + 1); assert.match(env.mails[before].subject, /כבר קיים חשבון/); assert.match(env.mails[before].body, /dana\.pilot/);
});

test("כרטיס ישן מ-12 חודשים — אי אפשר להירשם איתו (ticket_expired)", () => {
  const { env } = withWix(); addOrder(env, { created: iso(env.now() - 400 * DAY) });
  env.call({ action: "regStart", email: "pilot@example.com" });
  assert.equal(env.call({ action: "regFinish", email: "pilot@example.com", code: codeFrom(env), user: "dana.pilot", pass: "dana-pass-1234" }).error, "ticket_expired");
  assert.equal(env.props["U:dana.pilot"], undefined);
});

test("בלי מפתח Wix או כש-Wix נופל: נכשל סגור, בלי קוד ובלי חשבון", () => {
  const a = bootstrapped(); addOrder(a.env);
  assert.equal(a.env.call({ action: "regStart", email: "pilot@example.com" }).error, "not_configured");
  const { env } = withWix(); addOrder(env);
  env.fail.wix = 500;
  assert.equal(env.call({ action: "regStart", email: "pilot@example.com" }).error, "wix_down");
  env.fail.wix = 401;
  assert.equal(env.call({ action: "regStart", email: "pilot@example.com" }).error, "wix_down");
  assert.equal(env.mails.length, 0);
  assert.equal(env.call({ action: "regStart", email: "not-an-email" }).error, "bad_email");
});

// עודכן לדרישת ההשקה (n=1/13): המכסה הכללית של 60 בקשות בשעה נעלה את ההרשמה לכולם (60 כתובות זבל חסמו מטיס אמיתי, ו-100 מטיסים לגיטימיים — 40 מהם) והוחלפה בשערים כלליים
// שאינם צורכים את תקציב המיילים (ראו "השקה" בהמשך). נשארה המכסה לכתובת — והיא נספרת בכל בקשה תקינה, בלי קשר לכרטיס: ספירה רק של מיילים שנשלחו הייתה מגלה בעלי כרטיס.
test("הרשמה: מכסה לכתובת (5 בשעה) נספרת בכל בקשה תקינה — עם כרטיס ובלי — ומתאפסת בשעה הבאה; הסדרה זהה", () => {
  const { env } = withWix(); calm(env); addOrder(env, { email: "holder@example.com" });
  const seq = email => Array.from({ length: 7 }, () => regAns(env, email));
  const holder = seq("holder@example.com"), none = seq("nobody@example.com");
  assert.deepEqual(holder, none, "אין הבדל בין כתובת עם כרטיס לכתובת בלי");
  assert.deepEqual(holder.map(x => x.error || "ok"), ["ok", "ok", "ok", "ok", "ok", "rate", "rate"]);
  assert.equal(holder[5].scope, undefined, "מגבלה אישית של הכתובת, לא כללית");
  assert.equal(env.mails.length, 5, "5 קודים לבעל הכרטיס; לכתובת בלי כרטיס לא נשלח דבר");
  env.advance(61 * 60000);
  assert.ok(regAns(env, "holder@example.com").ok);
  assert.ok(regAns(env, "nobody@example.com").ok);
});

test("תוקף: אחרי תאריך הסיום אי אפשר להתחבר, והאסימון הקיים נפסל; מנהל ומשתמשים ידניים — ללא הגבלה", () => {
  const { env, token } = withWix(); addOrder(env);
  const r = regOk(env);
  assert.ok(env.call({ action: "me", token: r.token }).ok);
  assert.equal(env.call({ action: "me", token: r.token }).until, r.until);
  const rec = JSON.parse(env.props["U:dana.pilot"]); rec.until = env.now() + 3600000; env.props["U:dana.pilot"] = JSON.stringify(rec);   // שעה לפני הסיום, בתוך חיי האסימון (8 שעות)
  assert.ok(env.call({ action: "me", token: r.token }).ok);
  env.advance(2 * 3600000);
  const lg = env.call({ action: "login", user: "dana.pilot", pass: "dana-pass-1234" });
  assert.equal(lg.error, "sub_expired"); assert.match(lg.renewUrl, /icd\.org\.il\/events-1\//);
  assert.equal(env.call({ action: "me", token: r.token }).error, "sub_expired");
  assert.equal(env.call({ action: "saveBegin", token: r.token, folderName: "x", rid: newRid() }).error, "sub_expired");
  assert.equal(env.call({ action: "login", user: "dana.pilot", pass: "wrong-wrong-12" }).error, "bad_login", "סיסמה שגויה לא מגלה תפוגה");
  const adm = env.call({ action: "login", user: "itzik", pass: PASS }); assert.ok(adm.ok && adm.until === null);
});

test("חידוש: כרטיס חדש מאריך מהמאוחר מבין סוף התקופה ויום הרכישה; כרטיס שנוצל לא; התזכורות מתאפסות", () => {
  const { env } = withWix(); const o1 = addOrder(env, { created: iso(env.now() - 340 * DAY) });
  const r = regOk(env), end1 = r.until;
  env.advance(end1 - env.now() - 11 * DAY);                      // 11 ימים לפני הסיום
  const o2 = addOrder(env, { created: iso(env.now() - DAY) });   // חידוש מוקדם
  env.call({ action: "regStart", email: "pilot@example.com" });
  const fin = env.call({ action: "regFinish", email: "pilot@example.com", code: codeFrom(env) });
  assert.ok(fin.ok && fin.renewed, JSON.stringify(fin));
  const e = new Date(end1); e.setUTCMonth(e.getUTCMonth() + 12);
  assert.equal(fin.until, e.getTime(), "מתווסף לסוף התקופה הנוכחית — לא מפסידים ימים");
  assert.ok(env.call({ action: "login", user: "dana.pilot", pass: "dana-pass-1234" }).ok);
  assert.deepEqual(Array.from(JSON.parse(env.props["U:dana.pilot"]).orders), [o1.orderNumber, o2.orderNumber]);
  // אין כרטיס חדש → אין קוד חידוש
  const n = env.mails.length; env.call({ action: "regStart", email: "pilot@example.com" });
  assert.match(env.mails[n].subject, /כבר קיים חשבון/);
});

test("חידוש אחרי שהמנוי כבר פג: מתחיל מיום הרכישה החדשה", () => {
  const { env } = withWix(); addOrder(env, { created: iso(env.now() - 300 * DAY) });
  const r = regOk(env);
  env.advance(r.until - env.now() + 10 * DAY);                   // פג לפני 10 ימים
  const o2 = addOrder(env, { created: iso(env.now() - 1000) });
  env.call({ action: "regStart", email: "pilot@example.com" });
  const fin = env.call({ action: "regFinish", email: "pilot@example.com", code: codeFrom(env) });
  const e = new Date(Date.parse(o2.created)); e.setUTCMonth(e.getUTCMonth() + 12);
  assert.equal(fin.until, e.getTime());
  assert.ok(env.call({ action: "login", user: "dana.pilot", pass: "dana-pass-1234" }).ok);
});

test("תזכורות: חודש לפני (פעם אחת), 3 ימים לפני (פעם אחת), בלי כפילויות, עם קישור חידוש ושם המשתמש", () => {
  const { env } = withWix(); addOrder(env, { created: iso(env.now() - 300 * DAY) });
  const r = regOk(env), end = r.until, mailsBefore = () => env.mails.filter(m => /המנוי שלך לבקשות טיסה/.test(m.subject));
  assert.equal(env.run("dailyCheck").reminded, 0, "רחוק מהסיום — אין תזכורת");
  env.advance(end - env.now() - 29 * DAY);                       // 29 ימים לפני
  assert.equal(env.run("dailyCheck").reminded, 1);
  let ms = mailsBefore(); assert.equal(ms.length, 1);
  assert.match(ms[0].subject, /מסתיים בעוד כחודש/); assert.equal(ms[0].to, "pilot@example.com");
  assert.match(ms[0].body, /dana\.pilot/); assert.match(ms[0].body, /https:\/\/www\.icd\.org\.il\/events-1\/bqst-yswry-tysh/); assert.match(ms[0].body, /שלום דנה/);
  assert.equal(env.run("dailyCheck").reminded, 0, "אותה תזכורת לא נשלחת פעמיים");
  env.advance(25 * DAY);                                         // 4 ימים לפני: עדיין לא
  assert.equal(env.run("dailyCheck").reminded, 0);
  env.advance(DAY);                                              // 3 ימים לפני
  assert.equal(env.run("dailyCheck").reminded, 1);
  ms = mailsBefore(); assert.equal(ms.length, 2); assert.match(ms[1].subject, /תזכורת: .*מסתיים בעוד 3 ימים/); assert.match(ms[1].body, /bqst-yswry-tysh/);
  assert.equal(env.run("dailyCheck").reminded, 0);
  env.advance(5 * DAY);                                          // אחרי הסיום: אין מייל נוסף
  assert.equal(env.run("dailyCheck").reminded, 0);
});

test("תזכורות: אם הבדיקה הראשונה כבר בתוך 3 הימים — נשלח מייל אחד בלבד (לא שניים); חידוש מאפס את התזכורות", () => {
  const { env } = withWix(); addOrder(env, { created: iso(env.now() - 340 * DAY) });
  const r = regOk(env);
  env.advance(r.until - env.now() - 2 * DAY);
  assert.equal(env.run("dailyCheck").reminded, 1); assert.equal(env.run("dailyCheck").reminded, 0);
  assert.equal(env.mails.filter(m => /המנוי שלך/.test(m.subject)).length, 1);
  addOrder(env, { created: iso(env.now()) });
  env.call({ action: "regStart", email: "pilot@example.com" });
  assert.ok(env.call({ action: "regFinish", email: "pilot@example.com", code: codeFrom(env) }).renewed);
  assert.deepEqual(JSON.parse(JSON.stringify(JSON.parse(env.props["U:dana.pilot"]).reminded)), {});
});

test("בדיקה יומית: הזמנה שבוטלה/הוחזרה — החשבון נחסם והאסימון נפסל; תקלת Wix לא חוסמת אף אחד; מנהל ידני לא נבדק", () => {
  const { env, token } = withWix(); const o = addOrder(env); const r = regOk(env);
  env.fail.wix = 503;
  assert.equal(env.run("dailyCheck").blocked, 0); assert.ok(env.call({ action: "me", token: r.token }).ok);
  env.fail.wix = 0;
  assert.equal(env.run("dailyCheck").blocked, 0, "הזמנה עדיין שולמה");
  o.status = "CANCELED";
  const st = env.run("dailyCheck"); assert.equal(st.blocked, 1);
  assert.equal(env.call({ action: "me", token: r.token }).error, "blocked");
  assert.equal(env.call({ action: "login", user: "dana.pilot", pass: "dana-pass-1234" }).error, "blocked");
  assert.equal(env.call({ action: "listUsers", token }).users.find(x => x.user === "dana.pilot").blockedWhy, "order_CANCELED");
  // המנהל יכול לשחרר (חסימה/ביטול חסימה קיימים)
  assert.ok(env.call({ action: "setBlocked", token, target: "dana.pilot", blocked: false }).ok);
});

test("טריגר יומי: installTrigger יוצר טריגר אחד ל-dailyCheck ב-08:00 שעון ישראל, וגם בהרצה חוזרת", () => {
  const { env } = withWix();
  env.run("installTrigger"); env.run("installTrigger");
  assert.equal(env.triggers.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(env.triggers[0].spec)), { days: 1, hour: 8, tz: "Asia/Jerusalem" });
  assert.equal(env.triggers[0].getHandlerFunction(), "dailyCheck");
});

test("מנהל: שינוי תאריך סיום, הסרת הגבלה, משתמש ידני עם תוקף, אבחון Wix; משתמש רגיל לא; מחיקת משתמש משחררת את הכרטיס", () => {
  const { env, token } = withWix(); addOrder(env); const r = regOk(env);
  assert.equal(env.call({ action: "setExpiry", token: r.token, target: "dana.pilot", until: "2030-01-01" }).error, "forbidden");
  assert.equal(env.call({ action: "setExpiry", token, target: "dana.pilot", until: "31/12/2030" }).error, "bad_date");
  assert.ok(env.call({ action: "setExpiry", token, target: "dana.pilot", until: "2030-01-01" }).ok);
  assert.ok(env.call({ action: "listUsers", token }).users.find(x => x.user === "dana.pilot").until > Date.parse("2030-01-01T00:00:00Z"));
  assert.ok(env.call({ action: "setExpiry", token, target: "dana.pilot", until: "" }).ok);
  assert.equal(env.call({ action: "listUsers", token }).users.find(x => x.user === "dana.pilot").until, null);
  assert.ok(env.call({ action: "addUser", token, newUser: "tmp.user", newPass: "tmp-pass-12345", until: "2000-01-01" }).ok);
  assert.equal(env.call({ action: "login", user: "tmp.user", pass: "tmp-pass-12345" }).error, "sub_expired");
  const chk = env.call({ action: "wixCheck", token, email: "pilot@example.com" });
  assert.ok(chk.ok && chk.orders.length === 1 && chk.orders[0].used && chk.orders[0].by === "dana.pilot" && chk.account === "dana.pilot");
  assert.equal(env.call({ action: "wixCheck", token: r.token, email: "pilot@example.com" }).error, "forbidden");
  assert.ok(env.call({ action: "deleteUser", token, target: "dana.pilot" }).ok);
  assert.equal(env.call({ action: "wixCheck", token, email: "pilot@example.com" }).orders[0].eligible, true, "הכרטיס משתחרר");
  assert.ok(regOk(env, { user: "dana.second" }).ok, "אפשר להירשם מחדש עם אותו כרטיס");
});

test("אבחון Wix מציג למה כרטיס לא זכאי (הרוכש אינו חבר רשום)", () => {
  const { env, token } = withWix(); addOrder(env, { memberId: "" });
  const chk = env.call({ action: "wixCheck", token, email: "pilot@example.com" });
  assert.equal(chk.requireMember, true); assert.equal(chk.orders[0].member, false); assert.equal(chk.orders[0].eligible, false);
});

/* ===== תיקוני סקירה עצמאית: כשל כתיבה ליומן, קריסה אחרי שליחה, בעלות על saveFile, גיזום, נעילה ===== */
const readLogRaw = env => JSON.parse(env.folders.ROOT.files.find(f => f.name === "_יומן בקשות.json").bytes.toString());

test("כשל בכתיבת רשומת 'השליחה התחילה' ליומן — המייל לא יוצא (נכשל סגור)", () => {
  const { env, token } = bootstrapped(); goLive(env, token);
  const b = savedRequest(env, token);
  env.fail.logWrite = true;
  const r = env.call(sendBody(env, token, b.folderId));
  assert.equal(r.ok, false); assert.equal(r.error, "server");
  assert.equal(env.mails.length, 0, "לא נשלח מייל כשאי אפשר לתעד");
  env.fail.logWrite = false;
  assert.ok(env.call(sendBody(env, token, b.folderId)).ok, "אחרי שהיומן חזר — נשלח כרגיל");
});

test("קריסה אחרי יציאת המייל (כתיבת הסיום ליומן נכשלת): התשובה 'נשלח', הרשומה נשארת 'sending' וממשיכה לחסום שליחה חוזרת", () => {
  const { env, token } = bootstrapped(); goLive(env, token);
  const b = savedRequest(env, token);
  env.hooks.beforeMail = () => { env.fail.logWrite = true; };            // המייל יוצא, ואז כתיבת הסיום נכשלת
  const r = env.call(sendBody(env, token, b.folderId));
  env.hooks.beforeMail = null; env.fail.logWrite = false;
  assert.ok(r.ok, JSON.stringify(r)); assert.equal(env.mails.length, 1);
  assert.deepEqual(readLogRaw(env)[0].sent.map(x => x.st), ["sending"]);
  assert.equal(env.call(sendBody(env, token, b.folderId)).error, "already_sent");
  assert.equal(env.mails.length, 1);
  assert.equal(env.call({ action: "listUsers", token }).users.find(u => u.user === "itzik").sent, 1, "נספרת כשליחה חיה");
});

test("יומן שאינו מערך (JSON תקין אבל לא רשימה) נכשל סגור ולא נדרס; קובץ ריק נחשב יומן ריק", () => {
  const { env, token } = bootstrapped();
  const b = savedRequest(env, token);
  const f = env.folders.ROOT.files.find(x => x.name === "_יומן בקשות.json");
  f.bytes = Buffer.from('{"not":"an array"}');
  assert.equal(env.call(sendBody(env, token, b.folderId)).error, "server");
  assert.equal(f.bytes.toString(), '{"not":"an array"}');
  f.bytes = Buffer.from("   ");
  assert.equal(env.call({ action: "listRequests", token }).requests.length, 0);
});

test("השרת עסוק (נעילת הסקריפט): doPost מחזיר busy ולא מבצע פעולה", () => {
  const { env, token } = bootstrapped();
  env.fail.lockBusy = true;
  assert.equal(env.call({ action: "me", token }).error, "busy");
  env.fail.lockBusy = false;
  assert.ok(env.call({ action: "me", token }).ok);
});

test("expectMode בכיוון ההפוך: השרת במצב בדיקה והלקוח מצפה ל'חי' — לא נשלח", () => {
  const { env, token } = bootstrapped();
  const b = savedRequest(env, token);
  const r = env.call({ action: "sendRequest", token, folderId: b.folderId, subject: "נ", body: "ג", expectMode: "live" });
  assert.equal(r.error, "mode_changed"); assert.equal(r.mailMode, "test"); assert.equal(env.mails.length, 0);
});

test("מנהל שהוקם ב-bootstrap מקבל tv לפי זמן יצירה (לא קבוע) — כמו משתמש שנוסף", () => {
  const { env } = bootstrapped();
  assert.ok(Number(JSON.parse(env.props["U:itzik"]).tv) > 1e12);
});

test("גיזום היומן: רשומה חדשה נשמרת גם כשהיומן מלא ברשומות עם שליחה חיה, וניתנת לשליחה", () => {
  const { env, token } = bootstrapped(); goLive(env, token);
  vm.runInContext("CFG.LOG_MAX = 2", env.sandbox);
  for (const n of ["א — 01.11.2026", "ב — 02.11.2026"]) assert.ok(env.call(sendBody(env, token, savedRequest(env, token, n).folderId)).ok);
  const third = savedRequest(env, token, "ג — 03.11.2026");
  assert.equal(readLogRaw(env).length, 3, "היומן גדל מעבר ל-LOG_MAX במקום למחוק שליחה חיה או את הרשומה החדשה");
  assert.ok(readLogRaw(env).some(x => x.id === third.folderId));
  assert.ok(env.call(sendBody(env, token, third.folderId)).ok);
});

test("saveFile: רק לבקשה שביומן, רק לבעלים או מנהל, לא לבקשה שנשלחה חי; כתיבה לבקשה 'מוכנה' מבטלת את הסימון עד saveEnd", () => {
  const { env, token } = bootstrapped();
  env.call({ action: "addUser", token, newUser: "dave", newPass: "dave-pass-123" });
  const dave = env.call({ action: "login", user: "dave", pass: "dave-pass-123" });
  const mine = savedRequest(env, token, "של המנהל — 04.11.2026");
  const put = (tok, folderId, name = "תוספת.png") => env.call({ action: "saveFile", token: tok, folderId, name, mime: "image/png", b64: b64("x") });
  assert.equal(put(dave.token, mine.folderId).error, "forbidden");
  env.folders.R2 = { id: "R2", name: "ידנית", parent: "ROOT", files: [] };
  assert.equal(put(token, "R2").error, "bad_folder", "תיקייה שאינה ביומן");
  // כתיבה לבקשה מוכנה מבטלת 'מוכנה'
  assert.equal(env.call(sendBody(env, token, mine.folderId)).ok, true);
  assert.ok(put(token, mine.folderId).ok);
  assert.equal(env.call(sendBody(env, token, mine.folderId)).error, "not_ready");
  assert.ok(env.call({ action: "saveEnd", token, folderId: mine.folderId, ready: true }).ready);
  // אחרי שליחה חיה — נעולה
  goLive(env, token);
  const live = savedRequest(env, token, "חי — 05.11.2026");
  assert.ok(env.call(sendBody(env, token, live.folderId)).ok);
  assert.equal(put(token, live.folderId).error, "already_sent");
  // מנהל רשאי לכתוב לבקשה של אחר (שלא נשלחה)
  const his = savedRequest(env, dave.token, "של דייב — 06.11.2026");
  assert.ok(put(token, his.folderId).ok);
});

/* ===== עצמאות המבקש: נמענים לפי המבקש (לא לפי הבעלים), יעד office/self, עותק סמוי למנהל, הגבלת קצב לכל משתמש ===== */
const OFFICE = ["notamoffice@iaa.gov.il", "nofm@iaa.gov.il"], OWNER = "owner@icd.test";
// מטיס עצמאי: נרשם בכרטיס Wix + קוד במייל (כמו בפועל); הכתובת שלו נשמרת רק כך. מנקה את מייל הקוד מ-env.mails
function pilotUser(env, email = "pilot@example.com", user = "dana.pilot") {
  addOrder(env, { email });
  assert.ok(env.call({ action: "regStart", email }).ok);
  const r = env.call({ action: "regFinish", email, code: codeFrom(env), user, pass: "dana-pass-1234" });
  assert.ok(r.ok, JSON.stringify(r));
  env.mails.length = 0;
  return r;
}
const sendTo = (env, token, folderId, extra) => env.call({ action: "sendRequest", expectMode: modeOf(env), token, folderId, subject: "בקשה — נושא", body: "גוף", ...extra });
const rcpts = v => (v === undefined || v === "" ? [] : String(v).split(","));   // רשימת נמענים כפי שנמסרה ל-MailApp
const SELF_PREFIX = "[עותק לעצמי — לא נשלח למשרד נוטאם] ", TEST_PREFIX = "[בדיקה — לא נשלח למשרד נוטאם] ";

for (const [mode, target, want] of [
  ["test", "office", { to: ["pilot@example.com"], cc: [], prefix: TEST_PREFIX }],
  ["test", "self", { to: ["pilot@example.com"], cc: [], prefix: SELF_PREFIX }],
  ["live", "office", { to: OFFICE, cc: ["pilot@example.com"], prefix: "" }],
  ["live", "self", { to: ["pilot@example.com"], cc: [], prefix: SELF_PREFIX }],
]) {
  test(`נמענים — מצב ${mode} × יעד ${target}: to/cc/bcc/replyTo/נושא לפי המבקש (המטיס), הבעלים רק בעותק סמוי`, () => {
    const { env, token } = withWix(); if (mode === "live") goLive(env, token);
    const pilot = pilotUser(env);
    const b = savedRequest(env, pilot.token, "אתר מטיס — 01.12.2026");
    const r = sendTo(env, pilot.token, b.folderId, { target });
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(env.mails.length, 1);
    const m = env.mails[0];
    assert.deepEqual(rcpts(m.to), want.to, "to");
    assert.deepEqual(rcpts(m.cc), want.cc, "cc");
    assert.deepEqual(rcpts(m.bcc), [OWNER], "המנהל תמיד מקבל עותק סמוי");
    assert.equal(m.replyTo, "pilot@example.com", "תשובות חוזרות למבקש ולא לבעלים");
    assert.equal(m.subject, want.prefix + "בקשה — נושא");
    assert.equal(m.attachments.length, 4);
    // הבעלים לעולם לא ב-to/cc ולא מוחזר למטיס
    assert.ok(![...rcpts(m.to), ...rcpts(m.cc)].includes(OWNER));
    assert.equal(r.target, target); assert.equal(r.mode, mode); assert.equal(r.adminCopy, true);
    assert.deepEqual(r.to, want.to); assert.deepEqual(r.cc, want.cc);
    assert.ok(!JSON.stringify(r).includes(OWNER), "כתובת הבעלים לא נחשפת למטיס: " + JSON.stringify(r));
    assert.ok(r.sentAt > 0 && r.files.length === 4);
  });
}

test("המבקש הוא הבעלים (מנהל בלי כתובת, או נרשם עם כתובת הבעלים): אין כפילות כתובות בשום צירוף", () => {
  const { env, token } = withWix();
  const owner = pilotUser(env, "Owner@ICD.test", "owner.pilot");   // נרשם עם כתובת הבעלים (באותיות אחרות) — הכתובת נשמרת מנורמלת
  const cases = [["admin", token], ["owner-as-pilot", owner.token]];
  for (const [who, tok] of cases) for (const mode of ["test", "live"]) for (const target of ["office", "self"]) {
    if (mode === "live") goLive(env, token); else env.call({ action: "setMailMode", token, mode: "test" });
    const b = savedRequest(env, tok, who + " " + mode + " " + target + " — 02.12.2026");
    const before = env.mails.length;
    const r = sendTo(env, tok, b.folderId, { target });
    assert.ok(r.ok, JSON.stringify(r));
    const m = env.mails[before], all = [...rcpts(m.to), ...rcpts(m.cc), ...rcpts(m.bcc)].map(x => x.toLowerCase());
    assert.equal(new Set(all).size, all.length, who + " " + mode + " " + target + ": כתובת כפולה " + all.join(","));
    assert.ok(all.includes(OWNER), "הבעלים מקבל עותק (ב-to/cc כשהוא המבקש)");
    assert.equal(m.bcc, undefined, "הבעלים כבר ב-to/cc");
    assert.equal(m.replyTo.toLowerCase(), OWNER);
    if (mode === "live" && target === "office") { assert.deepEqual(rcpts(m.to), OFFICE); assert.deepEqual(rcpts(m.cc).map(x => x.toLowerCase()), [OWNER]); }
    else assert.deepEqual(rcpts(m.to).map(x => x.toLowerCase()), [OWNER]);
  }
});

test("כתובת המבקש גם אחד מנמעני משרד נוטאם — לא נשלח פעמיים לאותה כתובת (נרמול אותיות)", () => {
  const { env, token } = withWix(); goLive(env, token);
  const odd = pilotUser(env, "NOFM@iaa.gov.il", "odd.pilot");
  const r = sendTo(env, odd.token, savedRequest(env, odd.token, "כפילות — 03.12.2026").folderId);
  assert.ok(r.ok, JSON.stringify(r));
  const m = env.mails[0];
  assert.deepEqual(rcpts(m.to), OFFICE); assert.equal(m.cc, undefined);
  assert.deepEqual(rcpts(m.bcc), [OWNER]); assert.equal(m.replyTo, "nofm@iaa.gov.il");
});

test("משתמש בלי כתובת שמורה (נוצר ידנית) נופל לכתובת הבעלים; copyTo/email/features בכל תשובת כניסה", () => {
  const { env, token } = bootstrapped();
  env.call({ action: "addUser", token, newUser: "dave", newPass: "dave-pass-123" });
  const dave = env.call({ action: "login", user: "dave", pass: "dave-pass-123" });
  assert.equal(dave.email, ""); assert.equal(dave.copyTo, OWNER); assert.equal(dave.copyToIsOwner, true); assert.deepEqual(dave.features, ["sendTarget"]);
  const b = savedRequest(env, dave.token, "דייב — 04.12.2026");
  assert.ok(sendTo(env, dave.token, b.folderId, { target: "self" }).ok);
  assert.equal(env.mails[0].to, OWNER); assert.equal(env.mails[0].replyTo, OWNER); assert.equal(env.mails[0].bcc, undefined);
  // מנהל: אותו דבר
  const adm = env.call({ action: "me", token });
  assert.equal(adm.email, ""); assert.equal(adm.copyTo, OWNER); assert.equal(adm.copyToIsOwner, true); assert.deepEqual(adm.features, ["sendTarget"]);
});

test("תשובות login/me/changePassword/regFinish/listUsers/setMailMode מחזירות email, copyTo, copyToIsOwner ו-features (מטיס עם כתובת)", () => {
  const { env, token } = withWix();
  const reg = pilotUser(env);
  const check = (r, what) => {
    assert.ok(r.ok, what + " " + JSON.stringify(r));
    assert.equal(r.email, "pilot@example.com", what); assert.equal(r.copyTo, "pilot@example.com", what);
    assert.equal(r.copyToIsOwner, false, what); assert.deepEqual(r.features, ["sendTarget"], what);
    assert.ok(!JSON.stringify(r).includes(OWNER), what + ": הבעלים לא נחשף");
  };
  check(reg, "regFinish");
  const lg = env.call({ action: "login", user: "dana.pilot", pass: "dana-pass-1234" }); check(lg, "login");
  check(env.call({ action: "me", token: lg.token }), "me");
  const cp = env.call({ action: "changePassword", token: lg.token, oldPass: "dana-pass-1234", newPass: "dana-new-pass-5678" }); check(cp, "changePassword");
  // תשובות מנהל (listUsers / setMailMode) נושאות את פרטי המנהל עצמו
  const lu = env.call({ action: "listUsers", token }), sm = env.call({ action: "setMailMode", token, mode: "live" });
  for (const r of [lu, sm]) { assert.equal(r.email, ""); assert.equal(r.copyTo, OWNER); assert.equal(r.copyToIsOwner, true); assert.deepEqual(r.features, ["sendTarget"]); }
  // וגם בשגיאת mode_changed (תשובה שמחזירה mailMode)
  const b = savedRequest(env, cp.token, "מוד — 05.12.2026");
  const mc = env.call({ action: "sendRequest", token: cp.token, folderId: b.folderId, subject: "נ", body: "ג", expectMode: "test" });
  assert.equal(mc.error, "mode_changed"); assert.equal(mc.mailMode, "live"); assert.deepEqual(mc.features, ["sendTarget"]);
});

test("אין שום קלט שקובע נמען: to/cc/bcc/replyTo/email/requester/recipients/copyTo בבקשה מתעלמים, בכל יעד ומצב", () => {
  const { env, token } = withWix(); const pilot = pilotUser(env);
  const evil = "evil@example.com";
  for (const mode of ["test", "live"]) for (const target of ["office", "self"]) {
    if (mode === "live") goLive(env, token);
    const b = savedRequest(env, pilot.token, "הזרקה " + mode + target + " — 06.12.2026");
    const r = sendTo(env, pilot.token, b.folderId, { target, to: evil, cc: evil, bcc: evil, replyTo: evil, email: evil, requester: evil, copyTo: evil, recipients: [evil], from: evil, name: evil });
    assert.ok(r.ok, JSON.stringify(r));
  }
  assert.equal(env.mails.length, 4);
  assert.ok(!/evil@example/.test(JSON.stringify(env.mails)), "אף שדה של המייל לא כולל כתובת שהלקוח שלח");
  // גם נושא עם כתובת/כותרת מוזרקת לא מייצר נמען: הנושא שורה אחת, בלי תווי בקרה
  const b2 = savedRequest(env, pilot.token, "נושא — 07.12.2026");
  sendTo(env, pilot.token, b2.folderId, { target: "self", subject: "נושא\r\nBcc: " + evil + "\nTo: " + evil });
  const last = env.mails[env.mails.length - 1];
  assert.ok(!/[\r\n]/.test(last.subject)); assert.equal(last.bcc, OWNER); assert.equal(last.to, "pilot@example.com");
});

test("כתובת שמורה פגומה (פסיק/כמה כתובות) לא הופכת לכמה נמענים: נפילה לבעלים; והרשמה עם כתובת כזו נדחית", () => {
  const { env, token } = withWix(); const pilot = pilotUser(env);
  const rec = JSON.parse(env.props["U:dana.pilot"]); rec.email = "a@example.com,victim@example.com"; env.props["U:dana.pilot"] = JSON.stringify(rec);
  const lg = env.call({ action: "login", user: "dana.pilot", pass: "dana-pass-1234" });
  assert.equal(lg.email, ""); assert.equal(lg.copyTo, OWNER); assert.equal(lg.copyToIsOwner, true);
  const r = sendTo(env, lg.token, savedRequest(env, lg.token, "פגום — 08.12.2026").folderId, { target: "self" });
  assert.ok(r.ok); assert.ok(!/victim|a@example/.test(JSON.stringify(env.mails[0])));
  for (const bad of ["a,b@example.com", "a@example.com,b@example.com", "a;b@example.com", "<a@example.com>", "a b@example.com", '"a"@example.com', "a@b@example.com"])
    assert.equal(env.call({ action: "regStart", email: bad }).error, "bad_email", bad);
  assert.equal(env.call({ action: "wixCheck", token, email: "a,b@example.com" }).error, "bad_email");
});

test("target לא תקין נדחה (bad_target) בלי מייל ובלי רשומת יומן; חסר = office (שרת ישן/לקוח ישן)", () => {
  const { env, token } = bootstrapped();
  const b = savedRequest(env, token);
  for (const bad of ["", null, "OFFICE", "Self", "both", "owner", "x@y.com", 1, 0, true, false, ["self"], { a: 1 }]) {
    const r = sendTo(env, token, b.folderId, { target: bad });
    assert.equal(r.error, "bad_target", JSON.stringify(bad));
  }
  assert.equal(env.mails.length, 0);
  assert.equal(readLogRaw(env)[0].sent.length, 0, "לא נרשמה שליחה");
  const dflt = sendTo(env, token, b.folderId);
  assert.ok(dflt.ok && dflt.target === "office", JSON.stringify(dflt));
  // bad_target נבדק לפני expectMode ולפני כל גישה לתיקייה
  assert.equal(env.call({ action: "sendRequest", token, folderId: "nope", subject: "נ", body: "ג", target: "zzz" }).error, "bad_target");
  assert.equal(env.call({ action: "sendRequest", folderId: b.folderId, subject: "נ", body: "ג", target: "self" }).ok, false, "בלי אסימון נדחה");
});

test("שליחה לעצמו אינה 'נשלחה למשרד נוטאם': לא חוסמת שליחה חיה אחריה, לא נועלת עריכה, לא נבדקת מול expectMode; ובמצב חי office כן", () => {
  const { env, token } = withWix(); goLive(env, token);
  const pilot = pilotUser(env), rid = newRid();
  const b = savedRequest(env, pilot.token, "אתר עצמי — 09.12.2026", null, rid);
  // expectMode שגוי / חסר לא משפיע על self
  for (const expectMode of ["test", undefined, "garbage"]) assert.ok(sendTo(env, pilot.token, b.folderId, { target: "self", expectMode }).ok);
  assert.equal(env.mails.length, 3);
  assert.equal(sendTo(env, pilot.token, b.folderId, { target: "office", expectMode: "test" }).error, "mode_changed", "office עדיין נבדק");
  assert.equal(env.mails.length, 3);
  // עדיין ניתנת לעריכה (לא נעולה) ולא נחשבת כפילות
  assert.ok(env.call({ action: "saveBegin", token: pilot.token, folderName: "אתר עצמי — 09.12.2026", rid }).ok, "שליחה לעצמו לא נועלת עריכה");
  assert.equal(env.call({ action: "saveEnd", token: pilot.token, folderId: b.folderId, ready: true }).ready, false, "אחרי saveBegin צריך לשמור מחדש (אין קבצים)");
  const b2 = savedRequest(env, pilot.token, "אתר עצמי — 09.12.2026", null, rid);
  const live = sendTo(env, pilot.token, b2.folderId, { target: "office" });
  assert.ok(live.ok && live.mode === "live", JSON.stringify(live));
  assert.deepEqual(rcpts(env.mails[3].to), OFFICE);
  // אחרי שליחה חיה: הבקשה נעולה לעריכה וכפילות למשרד נחסמת — אבל שליחה לעצמו עדיין מותרת
  assert.equal(sendTo(env, pilot.token, b2.folderId, { target: "office" }).error, "already_sent");
  assert.equal(env.call({ action: "saveBegin", token: pilot.token, folderName: "אתר עצמי — 09.12.2026", rid }).error, "already_sent");
  assert.ok(sendTo(env, pilot.token, b2.folderId, { target: "self" }).ok);
  assert.equal(env.mails.length, 5);
});

test("שליחה לעצמו לא יוצרת 'דומה' (similar) ולא מונעת למשרד שליחה חיה של בקשה אחרת באותו מקום ותאריך", () => {
  const { env, token } = bootstrapped(); goLive(env, token);
  const first = savedRequest(env, token, "אתר תאום — 10.12.2026");
  assert.ok(sendTo(env, token, first.folderId, { target: "self" }).ok);
  const second = savedRequest(env, token, "אתר תאום — 10.12.2026");
  const r = sendTo(env, token, second.folderId);
  assert.ok(r.ok && r.mode === "live", JSON.stringify(r));
});

test("יומן: שליחה לעצמו נרשמת עם target ו-mode='self' (לעולם לא 'live'); listRequests מסווג sentSelf/sentTest/sentLive; listUsers.sent לא סופר אותה", () => {
  const { env, token } = withWix();
  const pilot = pilotUser(env);
  const b = savedRequest(env, pilot.token, "סיווג — 11.12.2026");
  assert.ok(sendTo(env, pilot.token, b.folderId, { target: "self" }).ok);
  let log = readLogRaw(env);
  assert.equal(log[0].sent[0].target, "self"); assert.equal(log[0].sent[0].mode, "self"); assert.deepEqual(log[0].sent[0].to, ["pilot@example.com"]);
  let row = env.call({ action: "listRequests", token }).requests[0];
  assert.deepEqual([row.sentLive, row.sentTest, row.sentSelf], [0, 0, 1]);
  assert.equal(row.lastSent.target, "self"); assert.equal(row.lastSent.st, "sent");
  assert.ok(sendTo(env, pilot.token, b.folderId, { target: "office" }).ok);      // מצב בדיקה → sentTest
  row = env.call({ action: "listRequests", token }).requests[0];
  assert.deepEqual([row.sentLive, row.sentTest, row.sentSelf], [0, 1, 1]);
  goLive(env, token);
  assert.ok(sendTo(env, pilot.token, b.folderId, { target: "office" }).ok);
  assert.ok(sendTo(env, pilot.token, b.folderId, { target: "self" }).ok);        // self אחרי החיה — lastSent נשאר השליחה החיה
  row = env.call({ action: "listRequests", token }).requests[0];
  assert.deepEqual([row.sentLive, row.sentTest, row.sentSelf], [1, 1, 2]);
  assert.equal(row.lastSent.target, "office"); assert.equal(row.lastSent.mode, "live");
  log = readLogRaw(env);
  assert.deepEqual(log[0].sent.map(x => x.target), ["self", "office", "office", "self"]);
  const u = env.call({ action: "listUsers", token }).users.find(x => x.user === "dana.pilot");
  assert.equal(u.sent, 1, "רק השליחה החיה למשרד נספרת כהגשה");
  // שליחה שנכשלה לא נספרת באף סיווג
  env.fail.mail = true;
  const b2 = savedRequest(env, pilot.token, "נכשלת — 12.12.2026");
  assert.equal(sendTo(env, pilot.token, b2.folderId, { target: "self" }).ok, false);
  env.fail.mail = false;
  const r2 = env.call({ action: "listRequests", token }).requests.find(x => x.name === "נכשלת — 12.12.2026");
  assert.deepEqual([r2.sentLive, r2.sentTest, r2.sentSelf], [0, 0, 0]);
});

test("תאימות לאחור ביומן: רשומת שליחה ישנה (בלי target) נחשבת שליחה למשרד — חיה חוסמת כפילות, בדיקה נספרת כבדיקה", () => {
  const { env, token } = bootstrapped(); goLive(env, token);
  const b = savedRequest(env, token, "ישן — 13.12.2026");
  const f = env.folders.ROOT.files.find(x => x.name === "_יומן בקשות.json"), log = JSON.parse(f.bytes.toString());
  log[0].sent = [{ sid: "a", t: Date.now() - 5000, user: "itzik", mode: "live", to: OFFICE, st: "sent" }, { sid: "b", t: Date.now() - 4000, user: "itzik", mode: "test", to: [OWNER], st: "sent" }];
  f.bytes = Buffer.from(JSON.stringify(log));
  assert.equal(sendTo(env, token, b.folderId).error, "already_sent");
  const row = env.call({ action: "listRequests", token }).requests[0];
  assert.deepEqual([row.sentLive, row.sentTest, row.sentSelf], [1, 1, 0]);
  assert.equal(row.lastSent.target, "office");
});

test("סימון 'נשלח — ....txt' בתיקייה: יעד, מצב ועותק סמוי; לא מצורף למייל הבא", () => {
  const { env, token } = withWix();
  const pilot = pilotUser(env), b = savedRequest(env, pilot.token, "סימון — 14.12.2026");
  const marks = () => env.folders[b.folderId].files.filter(f => /^נשלח — /.test(f.name));
  assert.ok(sendTo(env, pilot.token, b.folderId, { target: "self" }).ok);
  assert.equal(marks().length, 1); assert.match(marks()[0].name, /\(לעצמו\)\.txt$/);
  const t1 = marks()[0].bytes.toString();
  assert.match(t1, /יעד: לעצמו/); assert.match(t1, /אל: pilot@example\.com/); assert.match(t1, /עותק סמוי למנהל: כן/); assert.match(t1, /לא נשלח למשרד נוטאם/);
  assert.ok(sendTo(env, pilot.token, b.folderId, { target: "office" }).ok);
  assert.ok(marks().some(f => /\(בדיקה\)\.txt$/.test(f.name)));
  goLive(env, token);
  assert.ok(sendTo(env, pilot.token, b.folderId, { target: "office" }).ok);
  const live = marks().find(f => !/\((לעצמו|בדיקה)\)/.test(f.name));
  assert.ok(live, "סימון חי ללא סיומת"); assert.match(live.bytes.toString(), /יעד: משרד/); assert.match(live.bytes.toString(), /חי — למשרד נוטאם/); assert.match(live.bytes.toString(), /עותק: pilot@example\.com/);
  assert.ok(env.mails.every(m => m.attachments.every(a => !/^נשלח/.test(a.name))));
});

// עודכן לדרישת פיצול הדליים (n=1): עותקים (לעצמו, וגם "שלח למשרד" במצב בדיקה שנשלח למבקש בלבד) בדלי נפרד משליחה חיה למשרד נוטאם — לכל משתמש ובסך הכול
test("הגבלת קצב: עותקים נספרים לכל משתמש בנפרד (שליחה לעצמו, ובמצב בדיקה גם 'שלח למשרד'); מטיס אחד לא חוסם אחרים; יש תקרה כוללת; מתאפסת אחרי שעה", () => {
  const { env, token } = withWix();
  const a = pilotUser(env, "a@example.com", "pilot.a"), c = pilotUser(env, "c@example.com", "pilot.c");
  const ba = savedRequest(env, a.token, "קצב א — 15.12.2026"), bc = savedRequest(env, c.token, "קצב ג — 15.12.2026");
  for (let i = 0; i < 10; i++) assert.ok(sendTo(env, a.token, ba.folderId, { target: "self" }).ok, "i=" + i);
  const r11 = sendTo(env, a.token, ba.folderId, { target: "self" });
  assert.equal(r11.error, "rate", "שליחה 11 לעצמו"); assert.equal(r11.scope, "user"); assert.equal(r11.kind, "copy");
  assert.equal(sendTo(env, a.token, ba.folderId, { target: "office" }).error, "rate", "במצב בדיקה 'שלח למשרד' הוא עותק למבקש — אותו דלי");
  assert.equal(env.mails.length, 10);
  assert.ok(sendTo(env, c.token, bc.folderId, { target: "office" }).ok, "מטיס אחר לא נחסם");
  assert.ok(sendTo(env, token, savedRequest(env, token, "מנהל — 15.12.2026").folderId, { target: "self" }).ok, "המנהל לא נחסם");
  env.advance(61 * 60000);
  assert.ok(sendTo(env, a.token, ba.folderId, { target: "self" }).ok, "אחרי שעה");
  // תקרה כוללת לעותקים
  vm.runInContext("CFG.MAX_COPIES_PER_HOUR_ALL = 3", env.sandbox);
  env.advance(61 * 60000);
  const d = pilotUser(env, "d@example.com", "pilot.d"), bd = savedRequest(env, d.token, "קצב ד — 15.12.2026");
  const got = [a, c, d, token].map((u, i) => sendTo(env, u === token ? token : u.token, u === a ? ba.folderId : u === c ? bc.folderId : u === d ? bd.folderId : savedRequest(env, token, "מנהל ב — 15.12.2026").folderId, { target: "self" }));
  assert.deepEqual(got.map(x => x.ok || x.error), [true, true, true, "rate"]);
  assert.equal(got[3].scope, "all"); assert.equal(got[3].kind, "copy");
});

test("שליחה: בלי כתובת בעלים ידועה (נכשל סגור) — לא נשלח, לא נרשמת שליחה; עם כתובת הבעלים — עותק סמוי לא נפגע", () => {
  const { env, token } = bootstrapped();
  const b = savedRequest(env, token);
  env.sandbox.Session = { getEffectiveUser: () => ({ getEmail: () => "" }) };
  for (const target of ["office", "self"]) assert.equal(sendTo(env, token, b.folderId, { target }).error, "no_owner");
  assert.equal(env.mails.length, 0); assert.equal(readLogRaw(env)[0].sent.length, 0);
  env.sandbox.Session = { getEffectiveUser: () => ({ getEmail: () => OWNER }) };
  assert.ok(sendTo(env, token, b.folderId, { target: "self" }).ok);
});

// תווים שאסור שיישארו בנושא: שורה חדשה, C1 (כולל NEL) ומפרידי שורה/פסקה של יוניקוד — נבנה בלי רצפי escape בקובץ
const BAD_SUBJECT_CHARS = new RegExp("[\r\n" + [0x85, 0x9f, 0x2028, 0x2029].map(c => String.fromCharCode(c)).join("") + "]");
test("הזרקת כותרות: גם תווי C1 (NEL ועוד) ומפרידי שורה בנושא מנוקים, בכל יעד; הנושא נשאר שורה אחת עם הקידומת", () => {
  const { env, token } = bootstrapped();
  const b = savedRequest(env, token);
  const nasty = "א" + String.fromCharCode(0x85) + "ב" + String.fromCharCode(0x9f) + "ג" + String.fromCharCode(0x2028) + "ד\r\nBcc: evil@example.com\nCc: evil@example.com";
  for (const target of ["office", "self"]) assert.ok(sendTo(env, token, b.folderId, { target, subject: nasty }).ok);
  for (const m of env.mails) {
    assert.ok(!BAD_SUBJECT_CHARS.test(m.subject), JSON.stringify(m.subject));
    assert.ok(!m.bcc || m.bcc === OWNER);
    assert.ok(!/evil@example\.com/.test(JSON.stringify([m.to, m.cc, m.bcc, m.replyTo])));
  }
  assert.ok(env.mails[1].subject.startsWith(SELF_PREFIX + "א ב ג ד"));
});

test("עצמאות בין מטיסים: כל אחד שולח רק את הבקשות שלו, למבקש שלו; המנהל נכנס לתמונה רק כעותק סמוי ובתמיכה", () => {
  const { env, token } = withWix(); goLive(env, token);
  const p1 = pilotUser(env, "p1@example.com", "pilot.one"), p2 = pilotUser(env, "p2@example.com", "pilot.two");
  const b1 = savedRequest(env, p1.token, "אתר 1 — 16.12.2026"), b2 = savedRequest(env, p2.token, "אתר 2 — 16.12.2026");
  assert.equal(sendTo(env, p2.token, b1.folderId).error, "forbidden");
  assert.equal(sendTo(env, p1.token, b2.folderId, { target: "self" }).error, "forbidden");
  assert.equal(env.mails.length, 0);
  assert.ok(sendTo(env, p1.token, b1.folderId).ok); assert.ok(sendTo(env, p2.token, b2.folderId).ok);
  const [m1, m2] = env.mails;
  assert.deepEqual([m1.cc, m1.replyTo, m1.bcc], ["p1@example.com", "p1@example.com", OWNER]);
  assert.deepEqual([m2.cc, m2.replyTo, m2.bcc], ["p2@example.com", "p2@example.com", OWNER]);
  assert.ok(!/p2@/.test(JSON.stringify(m1)) && !/p1@/.test(JSON.stringify(m2)));
  // תמיכה: המנהל שולח בקשה של מטיס — המבקש הוא המנהל המחובר (כמו שהלקוח מציג ב-copyTo), לא המטיס
  const sup = savedRequest(env, p1.token, "תמיכה — 16.12.2026");
  assert.ok(sendTo(env, token, sup.folderId, { target: "self" }).ok);
  assert.equal(env.mails[2].to, OWNER); assert.equal(env.mails[2].replyTo, OWNER);
});

/* ===== תיקוני סקירה ג׳ (שרת): דליי קצב נפרדים, מכסת מייל יומית, כפילות רק של אותו מבקש, מצב עקר, ניחושי קוד ===== */
const logOf = env => JSON.parse(env.folders.ROOT.files.find(f => f.name === "_יומן בקשות.json").bytes.toString());
const QUOTA_MSG = "מכסת המיילים היומית של המערכת התמלאה — נסו שוב מחר או פנו למנהל";

test("דליי קצב נפרדים (n=1): עותקים — של מטיסים אחרים ושלו — לא חוסמים שליחה חיה למשרד נוטאם; ההודעה מבחינה בין תקרה כללית לאישית", () => {
  const { env, token } = withWix(); goLive(env, token);
  vm.runInContext("CFG.MAX_COPIES_PER_HOUR_ALL = 4; CFG.MAX_OFFICE_PER_HOUR_ALL = 3", env.sandbox);
  const ps = [1, 2, 3, 4, 5, 6].map(i => pilotUser(env, "p" + i + "@example.com", "pilot.p" + i));
  const rs = ps.map((p, i) => savedRequest(env, p.token, "אתר " + i + " — 24.12.2026"));
  for (let i = 0; i < 4; i++) assert.ok(sendTo(env, ps[i].token, rs[i].folderId, { target: "self" }).ok, "עותק " + i);
  const copyAll = sendTo(env, ps[4].token, rs[4].folderId, { target: "self" });
  assert.deepEqual([copyAll.ok, copyAll.error, copyAll.scope, copyAll.kind], [false, "rate", "all", "copy"]);
  assert.match(copyAll.message, /הכללית/); assert.doesNotMatch(copyAll.message, /האישית/);
  // התקרה הכללית של עותקים אזלה — ושליחה חיה למשרד עוברת: של המטיס שנחסם, של מטיס שכבר שלח עותק, ושל המנהל
  for (const [p, r] of [[ps[4], rs[4]], [ps[0], rs[0]]]) { const live = sendTo(env, p.token, r.folderId); assert.ok(live.ok && live.mode === "live", JSON.stringify(live)); }
  assert.ok(sendTo(env, token, savedRequest(env, token, "מנהל — 24.12.2026").folderId).ok);
  // ולהפך: תקרה כללית של שליחות למשרד נחסמת בהודעה כללית, והעותקים נשארים בדלי שלהם
  const officeAll = sendTo(env, ps[5].token, rs[5].folderId);
  assert.deepEqual([officeAll.ok, officeAll.error, officeAll.scope, officeAll.kind], [false, "rate", "all", "office"]);
  assert.match(officeAll.message, /הכללית/); assert.notEqual(officeAll.message, copyAll.message);
  assert.equal(env.mails.length, 7);
});

test("דליי קצב נפרדים לכל משתמש (n=1): מטיס שניצל את העותקים שלו עדיין שולח חי; לשליחות חיות תקרה אישית נפרדת, והשגיאה אומרת שהיא אישית", () => {
  const { env, token } = withWix(); goLive(env, token);
  vm.runInContext("CFG.MAX_COPIES_PER_HOUR = 3; CFG.MAX_OFFICE_PER_HOUR = 2", env.sandbox);
  const a = pilotUser(env, "a@example.com", "pilot.a"), c = pilotUser(env, "c@example.com", "pilot.c");
  const rs = [1, 2, 3].map(i => savedRequest(env, a.token, "של א " + i + " — 25.12.2026"));
  for (let i = 0; i < 3; i++) assert.ok(sendTo(env, a.token, rs[0].folderId, { target: "self" }).ok);
  const copyUser = sendTo(env, a.token, rs[0].folderId, { target: "self" });
  assert.deepEqual([copyUser.error, copyUser.scope, copyUser.kind], ["rate", "user", "copy"]);
  assert.match(copyUser.message, /האישית/); assert.doesNotMatch(copyUser.message, /הכללית/);
  assert.ok(sendTo(env, a.token, rs[0].folderId).ok, "שליחה חיה אמיתית עוברת למרות שהעותקים נגמרו");
  assert.ok(sendTo(env, a.token, rs[1].folderId).ok);
  const officeUser = sendTo(env, a.token, rs[2].folderId);
  assert.deepEqual([officeUser.error, officeUser.scope, officeUser.kind], ["rate", "user", "office"]);
  assert.match(officeUser.message, /האישית/); assert.notEqual(officeUser.message, copyUser.message);
  assert.ok(sendTo(env, c.token, savedRequest(env, c.token, "של ג — 25.12.2026").folderId).ok, "מטיס אחר לא נחסם");
  env.advance(61 * 60000);
  assert.ok(sendTo(env, a.token, rs[2].folderId).ok, "אחרי שעה");
});

test("שליחה שנכשלה ב-MailApp לא צורכת מכסת שליחות (אישית וכללית); ניסיונות כושלים מוגבלים בתקרה נפרדת", () => {
  const { env, token } = withWix();
  const a = pilotUser(env, "a@example.com", "pilot.a"), c = pilotUser(env, "c@example.com", "pilot.c");
  const ra = savedRequest(env, a.token, "כשל א — 26.12.2026"), rc = savedRequest(env, c.token, "כשל ג — 26.12.2026");
  env.fail.mail = true;
  for (let i = 0; i < 6; i++) assert.equal(sendTo(env, a.token, ra.folderId, { target: "self" }).error, "server");
  env.fail.mail = false;
  for (let i = 0; i < 10; i++) assert.ok(sendTo(env, a.token, ra.folderId, { target: "self" }).ok, "6 כשלונות לא אכלו מעשר השליחות, i=" + i);
  assert.equal(sendTo(env, a.token, ra.folderId, { target: "self" }).error, "rate");
  // תקרה כוללת: כשלונות לא אוכלים ממנה
  env.advance(61 * 60000);
  vm.runInContext("CFG.MAX_COPIES_PER_HOUR_ALL = 2", env.sandbox);
  env.fail.mail = true;
  for (let i = 0; i < 4; i++) assert.equal(sendTo(env, c.token, rc.folderId, { target: "self" }).error, "server");
  env.fail.mail = false;
  assert.ok(sendTo(env, c.token, rc.folderId, { target: "self" }).ok); assert.ok(sendTo(env, a.token, ra.folderId, { target: "self" }).ok);
  assert.equal(sendTo(env, token, savedRequest(env, token, "מנהל — 26.12.2026").folderId, { target: "self" }).scope, "all");
  // ניסיונות שהגיעו עד MailApp נספרים בנפרד: לולאת כשלונות נעצרת בתקרה (לא מציפה את היומן ואת MailApp)
  env.advance(61 * 60000);
  vm.runInContext("CFG.MAX_SEND_ATTEMPTS_PER_HOUR = 4", env.sandbox);
  let reached = 0; env.hooks.beforeMail = () => { reached++; };
  env.fail.mail = true;
  const res = []; for (let i = 0; i < 6; i++) res.push(sendTo(env, a.token, ra.folderId, { target: "self" }));
  assert.deepEqual(res.map(x => x.error), ["server", "server", "server", "server", "rate", "rate"]);
  assert.equal(res[4].kind, "attempts"); assert.equal(res[4].scope, "user");
  assert.equal(reached, 4, "MailApp נקרא רק 4 פעמים");
  assert.equal(logOf(env).find(e => e.id === ra.folderId).sent.filter(s => s.st === "failed").length, 4 + 6, "6 מהשעה הראשונה + 4");
});

test("מכסת המיילים היומית (n=2): בדיקה מוקדמת לפי מספר הנמענים — mail_quota בלי רשומת failed ובלי צריכת קצב; לעותקים נשמרת רזרבה לשליחה האמיתית", () => {
  const { env, token } = withWix(); goLive(env, token);
  const a = pilotUser(env, "a@example.com", "pilot.a"), b = pilotUser(env, "b@example.com", "pilot.b");
  const ra = savedRequest(env, a.token, "א — 27.12.2026"), rb = savedRequest(env, b.token, "ב — 27.12.2026");
  env.mailQuota.left = 6;
  assert.ok(sendTo(env, a.token, ra.folderId).ok);
  assert.equal(env.mailQuota.left, 2, "שליחה חיה = 4 נמענים: שניים במשרד, המבקש, והבעלים בעותק סמוי");
  const noq = sendTo(env, b.token, rb.folderId);
  assert.deepEqual([noq.ok, noq.error, noq.message], [false, "mail_quota", QUOTA_MSG]);
  assert.equal(env.mails.length, 1);
  assert.equal(logOf(env).find(e => e.id === rb.folderId).sent.length, 0, "לא נרשמה שליחה, גם לא failed");
  // לא נצרך קצב: 12 ניסיונות שנחסמו במכסה, ואז המכסה חוזרת — מלוא התקרה האישית (10) זמינה
  for (let i = 0; i < 11; i++) assert.equal(sendTo(env, b.token, rb.folderId).error, "mail_quota");
  env.mailQuota.left = 100000;
  for (let i = 0; i < 10; i++) assert.ok(sendTo(env, b.token, rb.folderId, { again: true }).ok, "i=" + i);
  assert.equal(sendTo(env, b.token, rb.folderId, { again: true }).error, "rate");
  // גבול מדויק לשליחה חיה: 4 נמענים
  env.advance(61 * 60000);
  env.mailQuota.left = 3; assert.equal(sendTo(env, a.token, ra.folderId, { again: true }).error, "mail_quota");
  env.mailQuota.left = 4; assert.ok(sendTo(env, a.token, ra.folderId, { again: true }).ok); assert.equal(env.mailQuota.left, 0);
  // עותקים: 2 נמענים + רזרבה של 20 שאינה נצרכת על ידם; שליחה חיה (4) ממשיכה לעבור
  env.advance(61 * 60000);
  env.mailQuota.left = 21;
  assert.equal(sendTo(env, b.token, rb.folderId, { target: "self" }).error, "mail_quota");
  assert.ok(sendTo(env, b.token, rb.folderId, { again: true }).ok); assert.equal(env.mailQuota.left, 17);
  assert.equal(sendTo(env, b.token, rb.folderId, { target: "self" }).error, "mail_quota");
  env.mailQuota.left = 22; assert.ok(sendTo(env, b.token, rb.folderId, { target: "self" }).ok); assert.equal(env.mailQuota.left, 20);
  // גם "שלח למשרד" במצב בדיקה (עותק למבקש) נשאר מחוץ לרזרבה; המנהל כמבקש = נמען אחד (הבעלים)
  assert.ok(env.call({ action: "setMailMode", token, mode: "test" }).ok);
  env.mailQuota.left = 21; assert.equal(sendTo(env, b.token, rb.folderId).error, "mail_quota");
  const adm = savedRequest(env, token, "מנהל — 27.12.2026");
  env.mailQuota.left = 20; assert.equal(sendTo(env, token, adm.folderId, { target: "self" }).error, "mail_quota");
  env.mailQuota.left = 21; assert.ok(sendTo(env, token, adm.folderId, { target: "self" }).ok); assert.equal(env.mailQuota.left, 20);
  assert.ok(logOf(env).every(e => (e.sent || []).every(s => s.st !== "failed")), "אף אחת מהחסימות לא נרשמה כ-failed");
});

test("מכסת המיילים היומית בהרשמה (n=2): regStart נכשל mail_quota לפני כתיבת קוד, שאילתת Wix וצריכת קצב — אותה תשובה לכל כתובת", () => {
  const { env } = withWix(); addOrder(env);
  env.mailQuota.left = 0;
  const withTicket = env.call({ action: "regStart", email: "pilot@example.com" }), noTicket = env.call({ action: "regStart", email: "nobody@example.com" });
  assert.deepEqual(withTicket, noTicket);
  assert.deepEqual([withTicket.ok, withTicket.error, withTicket.message], [false, "mail_quota", QUOTA_MSG]);
  assert.ok(!Object.keys(env.props).some(k => k.startsWith("R:")), "לא נכתבה רשומת קוד");
  assert.equal(env.wix.calls.length, 0, "גם לא נשלחה שאילתה ל-Wix");
  assert.equal(env.call({ action: "regStart", email: "not-an-email" }).error, "bad_email", "אימות הקלט קודם");
  // עודכן לדרישת ההשקה (n=1/2/14): קודי הרשמה כבר לא יורדים עד האפס — הם משאירים MAIL_QUOTA_RESERVE_REG (8 נמענים = שתי שליחות חיות למשרד נוטאם), כדי שהרשמות לא ישאירו את הארגון בלי יכולת לשלוח בקשה אמיתית
  env.mailQuota.left = 8;                                  // בדיוק הרזרבה: אין נמען פנוי להרשמה
  assert.deepEqual([env.call({ action: "regStart", email: "pilot@example.com" }).error, env.call({ action: "regStart", email: "nobody@example.com" }).error], ["mail_quota", "mail_quota"]);
  env.mailQuota.left = 9;                                  // נמען אחד מעל הרזרבה מספיק
  assert.ok(env.call({ action: "regStart", email: "pilot@example.com" }).ok); assert.equal(env.mails.length, 1); assert.equal(env.mailQuota.left, 8);
  assert.equal(env.call({ action: "regStart", email: "pilot@example.com" }).error, "mail_quota");
  env.mailQuota.left = 100000;
  for (let i = 0; i < 4; i++) assert.ok(env.call({ action: "regStart", email: "pilot@example.com" }).ok, "הניסיונות שנחסמו לא נצרכו מהקצב (נשארו 4 מתוך 5), i=" + i);
  assert.equal(env.call({ action: "regStart", email: "pilot@example.com" }).error, "rate");
});

test("mailQuotaLeft (n=2): למנהל בלבד (me, listUsers); מספר או null כשלא ידוע; בלי הפונקציה או כשהקריאה נכשלת — מדלגים על הבדיקה המוקדמת והשליחה נכשלת סגור", () => {
  const { env, token } = withWix(); const pilot = pilotUser(env);
  env.mailQuota.left = 123;
  assert.equal(env.run("showMailQuota"), 123, "פונקציית העורך למנהל לא מתכנת");
  assert.equal(env.call({ action: "me", token }).mailQuotaLeft, 123);
  assert.equal(env.call({ action: "listUsers", token }).mailQuotaLeft, 123);
  const pme = env.call({ action: "me", token: pilot.token });
  assert.ok(pme.ok && !("mailQuotaLeft" in pme), "משתמש רגיל לא מקבל את המכסה");
  assert.ok(!("mailQuotaLeft" in env.call({ action: "login", user: "dana.pilot", pass: "dana-pass-1234" })));
  const lu = env.call({ action: "listUsers", token: pilot.token }); assert.equal(lu.error, "forbidden"); assert.ok(!("mailQuotaLeft" in lu));
  const b = savedRequest(env, pilot.token, "מכסה — 28.12.2026");
  // קריאת המכסה נכשלת: null למנהל, מדלגים; MailApp האמיתי זורק כשהמכסה נגמרה — נכשל סגור, ה-intent נרשם failed והקצב מוחזר
  env.fail.quotaCall = true;
  assert.equal(env.call({ action: "me", token }).mailQuotaLeft, null);
  env.mailQuota.left = 0;
  const r = sendTo(env, pilot.token, b.folderId, { target: "self" });
  assert.equal(r.ok, false); assert.equal(r.error, "server"); assert.match(r.message, /too many times/);
  assert.deepEqual(logOf(env)[0].sent.map(x => x.st), ["failed"]);
  // הפונקציה חסרה (שרת/מדמה ישן)
  env.fail.quotaCall = false; delete env.sandbox.MailApp.getRemainingDailyQuota;
  assert.equal(env.call({ action: "me", token }).mailQuotaLeft, null); assert.equal(env.call({ action: "listUsers", token }).mailQuotaLeft, null);
  env.mailQuota.left = 100000;
  assert.ok(sendTo(env, pilot.token, b.folderId, { target: "self" }).ok);
  assert.ok(env.call({ action: "regStart", email: "pilot@example.com" }).ok);
});

test("כפילות 'אותו מקום ותאריך' (n=4/9): נבדקת רק מול שליחות חיות של אותו מבקש — מטיס אחר לא חוסם, לא מקבל שעה ולא מקבל סיומת (2)", () => {
  const { env, token } = withWix(); goLive(env, token);
  const a = pilotUser(env, "a@example.com", "pilot.alpha"), b = pilotUser(env, "b@example.com", "pilot.bravo");
  const NAME = "קיבוץ נחשון — 22.10.2026";
  const ra = savedRequest(env, a.token, NAME);
  assert.ok(sendTo(env, a.token, ra.folderId).ok);
  const aSentAt = logOf(env).find(e => e.id === ra.folderId).sent[0].t;
  env.advance(5000);
  // בראבו שומר אותו שם ותאריך: בלי סיומת (גם כשהבקשה של אלפא רק טיוטה), ובדרייב השם ייחודי כדי שהמנהל יבדיל
  const draftA = savedRequest(env, a.token, "טיוטה משותפת — 22.10.2026");
  assert.equal(savedRequest(env, b.token, "טיוטה משותפת — 22.10.2026").name, "טיוטה משותפת — 22.10.2026", "טיוטה של אחר לא יוצרת סיומת");
  const rb = savedRequest(env, b.token, NAME);
  assert.equal(rb.name, NAME, "מטיס רגיל לא מקבל '(2)' בגלל בקשה של מישהו אחר");
  assert.match(env.folders[rb.folderId].name, / \(2\)$/);
  const live = sendTo(env, b.token, rb.folderId);
  assert.ok(live.ok && live.mode === "live" && !("similar" in live), JSON.stringify(live));
  const bSentAt = logOf(env).find(e => e.id === rb.folderId).sent[0].t;
  assert.notEqual(bSentAt, aSentAt);
  assert.deepEqual(rcpts(env.mails[env.mails.length - 1].cc), ["b@example.com"]);
  // אלפא עצמו: בקשה חדשה באותו שם ותאריך — עדיין כפילות אפשרית, עם השעה שלו
  env.advance(5000);
  const dupA = sendTo(env, a.token, savedRequest(env, a.token, NAME).folderId);
  assert.deepEqual([dupA.error, dupA.similar, dupA.sentAt], ["already_sent", true, aSentAt]);
  // ובראבו: כפילות שלו עצמו מקבלת את השעה שלו, לא של אלפא
  const dupB = sendTo(env, b.token, savedRequest(env, b.token, NAME).folderId);
  assert.deepEqual([dupB.error, dupB.similar, dupB.sentAt], ["already_sent", true, bSentAt]);
  // המנהל (תמיכה) רואה את השם הייחודי בדרייב
  assert.match(env.call({ action: "saveBegin", token, folderName: NAME, rid: newRid() }).name, / \(\d+\)$/);
  assert.ok(draftA.ok !== false);
});

test("בלי דליפת מידע בין מטיסים (n=4/9): אף תשובה למטיס רגיל לא מכילה שם משתמש, שם בקשה, כתובת או שעת שליחה של מטיס אחר", () => {
  const { env, token } = withWix(); goLive(env, token);
  const a = pilotUser(env, "alpha.secret@example.com", "pilot.alphasecret"), b = pilotUser(env, "b@example.com", "pilot.bravo");
  const NAME = "אתר משותף — 29.12.2026", PRIVATE = "פרטי של אלפא בלבד — 30.12.2026";
  const ra = savedRequest(env, a.token, NAME); assert.ok(sendTo(env, a.token, ra.folderId).ok);
  savedRequest(env, a.token, PRIVATE);
  const aSentAt = logOf(env).find(e => e.id === ra.folderId).sent[0].t;
  env.advance(7777);
  const seen = [], mine = env.mails.length;
  const call = o => { const r = env.call(Object.assign({ token: b.token }, o)); seen.push(JSON.stringify(r)); return r; };
  call({ action: "me" }); call({ action: "listUsers" }); call({ action: "listRequests" }); call({ action: "listRequests", user: "pilot.alphasecret" }); call({ action: "wixCheck", email: "alpha.secret@example.com" });
  call({ action: "setMailMode", mode: "test" }); call({ action: "deleteUser", target: "pilot.alphasecret" }); call({ action: "setBlocked", target: "pilot.alphasecret", blocked: true });
  call({ action: "saveBegin", folderName: NAME, rid: ra.rid }); call({ action: "saveEnd", folderId: ra.folderId, ready: true });
  call({ action: "saveFile", folderId: ra.folderId, name: "x.png", mime: "image/png", b64: b64("x") }); call({ action: "sendRequest", folderId: ra.folderId, subject: "נ", body: "ג", expectMode: "live" });
  const begin = call({ action: "saveBegin", folderName: NAME, rid: newRid() });
  for (const [n, mime] of STD_FILES) call({ action: "saveFile", folderId: begin.folderId, name: n, mime, b64: b64("x") });
  call({ action: "saveEnd", folderId: begin.folderId, ready: true });
  const live = call({ action: "sendRequest", folderId: begin.folderId, subject: "נ", body: "ג", expectMode: "live" });
  call({ action: "sendRequest", folderId: begin.folderId, subject: "נ", body: "ג", expectMode: "live", target: "self" });
  const dup = call({ action: "sendRequest", folderId: begin.folderId, subject: "נ", body: "ג", expectMode: "live" });
  assert.ok(live.ok, JSON.stringify(live)); assert.equal(dup.error, "already_sent");
  call({ action: "regStart", email: "b@example.com" }); call({ action: "login", user: "pilot.bravo", pass: "dana-pass-1234" });
  const all = seen.join("\n");
  // שם הבקשה של בראבו עצמו זהה לשל אלפא (קלט שלו); מה שאסור הוא סיומת "(2)" שמעידה על בקשה אחרת, או כל פרט אחר של אלפא
  for (const secret of ["pilot.alphasecret", "alpha.secret", "אלפא", "(2)", ra.rid, String(aSentAt)]) assert.ok(!all.includes(secret), "דליפה: " + secret);
  assert.ok(!seen.map(x => JSON.parse(x)).some(r => r.folderId === ra.folderId || String(r.url || "").endsWith("/" + ra.folderId)), "מזהה התיקייה של אלפא לא מוחזר");
  for (const m of env.mails.slice(mine)) assert.ok(!/alpha\.secret|alphasecret/.test(JSON.stringify(m)), "המייל של בראבו חושף את אלפא");
});

test("מצב עקר אחרי מחיקת חשבונות ידנית (n=5): E:/O: שנשארו לא חוסמים הרשמה שקטה, לא חושפים שם של אחר ולא מצרפים כרטיס לחשבון של אדם אחר", () => {
  const { env } = withWix();
  addOrder(env);                                                           // הכרטיס הישן של X (pilot@example.com)
  assert.ok(regOk(env).ok);
  Object.keys(env.props).filter(k => k.startsWith("U:")).forEach(k => { delete env.props[k]; });     // מחיקה ידנית של כל חשבונות U: (נוהל 'שכחתי סיסמה' הישן)
  env.mails.length = 0;
  // (א) אין חשבון בכלל: ההרשמה לא נתקעת בשקט — נשלח קוד הרשמה
  assert.ok(env.call({ action: "regStart", email: "pilot@example.com" }).ok);
  assert.equal(env.mails.length, 1); assert.match(env.mails[0].subject, /קוד הרשמה/);
  // (ב) מטיס אחר תפס את השם הפנוי; X קנה כרטיס חדש
  addOrder(env, { email: "y@example.com", firstName: "יוסי" });
  assert.ok(env.call({ action: "regStart", email: "y@example.com" }).ok);
  const y = env.call({ action: "regFinish", email: "y@example.com", code: codeFrom(env), user: "dana.pilot", pass: "yossi-pass-1234" });
  assert.ok(y.ok, JSON.stringify(y));
  const before = env.props["U:dana.pilot"];
  addOrder(env, { email: "pilot@example.com" });
  env.mails.length = 0;
  assert.ok(env.call({ action: "regStart", email: "pilot@example.com" }).ok);
  assert.equal(env.mails.length, 1); assert.match(env.mails[0].subject, /קוד הרשמה/, "לא 'כבר קיים חשבון' (שהיה חושף את שם המשתמש של Y)");
  assert.ok(!/dana\.pilot/.test(JSON.stringify(env.mails[0])));
  const fin = env.call({ action: "regFinish", email: "pilot@example.com", code: codeFrom(env) });
  assert.equal(fin.error, "need_credentials", "אין חשבון על הכתובת הזו: זו הרשמה ולא חידוש של חשבון Y");
  assert.equal(env.props["U:dana.pilot"], before, "החשבון של Y לא השתנה");
  const fin2 = env.call({ action: "regFinish", email: "pilot@example.com", code: codeFrom(env), user: "pilot.x2", pass: "xavier-pass-1234" });
  assert.ok(fin2.ok && !fin2.renewed, JSON.stringify(fin2));
  assert.equal(JSON.parse(env.props["U:pilot.x2"]).orders.length, 2, "שני הכרטיסים של X אצלו");
  assert.equal(JSON.parse(env.props["U:dana.pilot"]).orders.length, 1);
  assert.equal(JSON.parse(env.props["U:dana.pilot"]).email, "y@example.com");
});

test("מצב עקר (n=5): הכרטיס הישן של X אינו תפוס כשבעל המיפוי O: כבר אינו קיים או אינו מחזיק בו; wixCheck מדווח בהתאם", () => {
  const { env, token } = withWix();
  const old = addOrder(env); assert.ok(regOk(env).ok);
  delete env.props["U:dana.pilot"];                                       // החשבון נמחק ידנית; E:/O: נשארו
  const chk = env.call({ action: "wixCheck", token, email: "pilot@example.com" });
  assert.deepEqual([chk.orders[0].used, chk.orders[0].by, chk.orders[0].eligible, chk.account], [false, "", true, ""]);
  addOrder(env, { email: "y@example.com" });                              // Y נרשם בשם הפנוי
  assert.ok(env.call({ action: "regStart", email: "y@example.com" }).ok);
  assert.ok(env.call({ action: "regFinish", email: "y@example.com", code: codeFrom(env), user: "dana.pilot", pass: "yossi-pass-1234" }).ok);
  env.mails.length = 0;
  assert.ok(env.call({ action: "regStart", email: "pilot@example.com" }).ok);
  assert.equal(env.mails.length, 1); assert.match(env.mails[0].subject, /קוד הרשמה/);
  assert.ok(!/dana\.pilot/.test(JSON.stringify(env.mails[0])), "לא חושף את שמו של Y");
  const chk2 = env.call({ action: "wixCheck", token, email: "pilot@example.com" });
  assert.deepEqual([chk2.orders[0].used, chk2.orders[0].eligible, chk2.account], [false, true, ""]);
  assert.equal(chk2.orders[0].orderNumber, old.orderNumber);
});

test("מחיקת משתמש (n=5): מנקה E:/O:/R: של אותו משתמש בלבד — מיפוי ששייך לחשבון אחר נשאר", () => {
  const { env, token } = withWix();
  addOrder(env); assert.ok(regOk(env).ok);
  const ek = vm.runInContext("emailKey_('pilot@example.com')", env.sandbox), rk = vm.runInContext("regKey_('pilot@example.com')", env.sandbox);
  addOrder(env);                                                           // כרטיס נוסף => regStart יוצר רשומת קוד (חידוש)
  assert.ok(env.call({ action: "regStart", email: "pilot@example.com" }).ok);
  assert.ok(env.props[rk], "יש רשומת קוד פתוחה");
  assert.ok(env.call({ action: "deleteUser", token, target: "dana.pilot" }).ok);
  assert.equal(env.props[ek], undefined); assert.equal(env.props[rk], undefined, "גם קוד ההרשמה הפתוח של הכתובת נמחק");
  assert.ok(!Object.keys(env.props).some(k => k.startsWith("O:")), "הכרטיסים של החשבון שוחררו");
  // מיפוי E: שכבר שייך לחשבון אחר (מצב עקר) לא נמחק במחיקת חשבון שנושא את אותה כתובת
  assert.ok(env.call({ action: "addUser", token, newUser: "pilot.other", newPass: "other-pass-12345" }).ok);
  assert.ok(env.call({ action: "addUser", token, newUser: "pilot.third", newPass: "third-pass-12345" }).ok);
  const t = JSON.parse(env.props["U:pilot.third"]); t.email = "pilot@example.com"; env.props["U:pilot.third"] = JSON.stringify(t);
  env.props[ek] = "pilot.other";
  assert.ok(env.call({ action: "deleteUser", token, target: "pilot.third" }).ok);
  assert.equal(env.props[ek], "pilot.other");
});

test("שכחתי סיסמת מנהל (n=5): מחיקת חשבון המנהל בלבד מאפשרת הקמה מחדש בלי למחוק את המטיסים; חשבון מטיס לא נדרס", () => {
  const { env } = withWix(); addOrder(env); regOk(env);
  delete env.props["U:itzik"];
  assert.equal(env.doGet().needsBootstrap, false, "לפני initialize אין קוד הקמה");
  const code = env.run("initialize"); assert.ok(code, "יש מטיסים אבל אין מנהל — מונפק קוד הקמה");
  assert.equal(env.doGet().needsBootstrap, true);
  assert.equal(env.call({ action: "bootstrap", code, user: "dana.pilot", pass: PASS }).error, "exists", "לא דורסים חשבון מטיס בשם שנבחר למנהל");
  const ok = env.call({ action: "bootstrap", code, user: "itzik2", pass: PASS });
  assert.ok(ok.ok && ok.role === "admin", JSON.stringify(ok));
  assert.ok(env.call({ action: "login", user: "dana.pilot", pass: "dana-pass-1234" }).ok, "המטיס נשאר");
  assert.equal(env.doGet().needsBootstrap, false);
  assert.equal(env.run("initialize"), null, "כשיש מנהל לא מונפק קוד הקמה");
  assert.equal(env.call({ action: "bootstrap", code, user: "itzik3", pass: PASS }).error, "exists");
});

test("ניחושי קוד הרשמה (n=6): הכשלונות מצטברים לכתובת בין קודים — אחרי CODE_FAIL_MAX לא נוצר קוד (בשקט, אותה תשובה), והחלון חולף אחרי CODE_FAIL_HOURS", () => {
  const { env } = withWix(); addOrder(env);
  const bad = c => env.call({ action: "regFinish", email: "pilot@example.com", code: c, user: "dana.pilot", pass: "dana-pass-1234" });
  assert.ok(env.call({ action: "regStart", email: "pilot@example.com" }).ok);
  const c1 = codeFrom(env);
  for (let i = 0; i < 5; i++) assert.equal(bad("000000").error, "bad_code");
  assert.equal(bad(c1).error, "bad_code", "הקוד נשרף אחרי 5 ניחושים (הרשומה נסגרת, מונה הכשלונות נשאר)");
  env.advance(20 * 60000);                                                 // הקוד הראשון פג — המונה נשאר
  assert.equal(bad("000000").error, "bad_code");
  assert.ok(env.call({ action: "regStart", email: "pilot@example.com" }).ok);
  const c2 = codeFrom(env), sent = env.mails.length;
  assert.equal(sent, 2);
  for (let i = 0; i < 4; i++) assert.equal(bad("000000").error, "bad_code");     // 9 כשלונות עד כה
  assert.equal(bad("000000").error, "bad_code");                                  // 10
  assert.equal(bad(c2).error, "bad_code", "אחרי 10 כשלונות בחלון גם הקוד הנכון נדחה");
  const r = env.call({ action: "regStart", email: "pilot@example.com" });
  assert.deepEqual(r, { ok: true, sent: true }, "אותה תשובה כרגיל");
  assert.equal(env.mails.length, sent, "אבל לא נוצר קוד חדש ולא נשלח מייל");
  assert.deepEqual(env.call({ action: "regStart", email: "nobody@example.com" }), r, "אי אפשר להבחין בין כתובת נעולה לכתובת בלי כרטיס");
  assert.equal(bad(c2).error, "bad_code");
  env.advance(7 * 3600000);                                                // CODE_FAIL_HOURS = 6
  assert.ok(env.call({ action: "regStart", email: "pilot@example.com" }).ok);
  assert.equal(env.mails.length, sent + 1, "אחרי החלון נשלח קוד חדש");
  const ok = bad(codeFrom(env));
  assert.ok(ok.ok && ok.token, JSON.stringify(ok));
  assert.ok(!Object.keys(env.props).some(k => k.startsWith("R:")), "הצלחה מנקה את הרשומה כולה");
});

test("ניחושי קוד הרשמה (n=6): טעות הקלדה בודדת לא נועלת; הצלחה מאפסת את המונה לפעם הבאה", () => {
  const { env } = withWix(); addOrder(env);
  const fin = (c, extra) => env.call({ action: "regFinish", email: "pilot@example.com", code: c, user: "dana.pilot", pass: "dana-pass-1234", ...extra });
  assert.ok(env.call({ action: "regStart", email: "pilot@example.com" }).ok);
  assert.equal(fin("000000").error, "bad_code"); assert.equal(fin("111111").error, "bad_code");
  assert.ok(fin(codeFrom(env)).ok);
  // חידוש אחרי רכישה חדשה: המונה התחיל מאפס
  addOrder(env);
  for (let i = 0; i < 3; i++) {
    assert.ok(env.call({ action: "regStart", email: "pilot@example.com" }).ok);
    for (let j = 0; j < 3; j++) assert.equal(env.call({ action: "regFinish", email: "pilot@example.com", code: "000000" }).error, "bad_code");
    env.advance(20 * 60000);
  }
  // 9 כשלונות ולא 10: עדיין לא נעול
  const sent = env.mails.length;
  assert.ok(env.call({ action: "regStart", email: "pilot@example.com" }).ok); assert.equal(env.mails.length, sent + 1);
  const renewed = env.call({ action: "regFinish", email: "pilot@example.com", code: codeFrom(env) });
  assert.ok(renewed.ok && renewed.renewed, JSON.stringify(renewed));
});

/* ===== השקה של כ-100 מטיסים: הרשמה במקביל, מכסות שאינן ניתנות לניצול, אותה תשובה לכל כתובת (n=1/2/7/13/14) ===== */
test("השקה (n=1/13): 100 מטיסים שונים נרשמים באותה שעה, כל אחד עם כרטיס ששולם — כולם מקבלים קוד אל הכתובת שבהזמנה ומשלימים הרשמה", () => {
  const { env } = calmWix();
  const emails = Array.from({ length: 100 }, (_, i) => "pilot" + i + "@example.com");
  emails.forEach((email, i) => addOrder(env, { email, firstName: "מטיס" + i }));
  for (const email of emails) assert.deepEqual(regAns(env, email), { ok: true, sent: true }, email);
  assert.equal(env.mails.length, 100, "100 קודים");
  emails.forEach((email, i) => assert.equal(env.mails[i].to, email, "הקוד נשלח לכתובת שבהזמנה בלבד"));
  emails.forEach((email, i) => {
    const f = env.call({ action: "regFinish", email, code: /(\d{6})/.exec(env.mails[i].subject)[1], user: "pilot.n" + i, pass: "pilot-pass-" + i + "-xx" });
    assert.ok(f.ok && f.token, email + " " + JSON.stringify(f));
  });
  assert.equal(Object.keys(env.props).filter(k => k.startsWith("U:")).length, 101, "המנהל ו-100 המטיסים");
  // מטיס 101 באותה שעה עדיין מקבל קוד (התקציב השעתי 150, שאילתות Wix 600)
  addOrder(env, { email: "late@example.com" });
  assert.deepEqual(regAns(env, "late@example.com"), { ok: true, sent: true }); assert.equal(env.mails.length, 101);
});

test("השקה (n=1/13): 150 בקשות אנונימיות לכתובות זבל לא חוסמות מטיס אמיתי ולא צורכות את תקציב מיילי ההרשמה (הוא נספר רק על מיילים שיצאו)", () => {
  const { env } = calmWix(); addOrder(env, { email: "real@example.com" });
  for (let i = 0; i < 150; i++) assert.deepEqual(regAns(env, "junk" + i + "@attacker.example"), { ok: true, sent: true });
  assert.equal(env.mails.length, 0); assert.equal(env.wix.calls.length, 150, "כל בקשה שאלה את Wix פעם אחת");
  assert.equal(env.props.REG_MAILS, undefined, "זבל לא נגע בתקציב המיילים היומי");
  assert.deepEqual(regAns(env, "real@example.com"), { ok: true, sent: true });
  assert.equal(env.mails.length, 1); assert.equal(env.mails[0].to, "real@example.com");
  assert.equal(JSON.parse(env.props.REG_MAILS).n, 1, "נספר רק המייל שיצא");
});

// כל תרחיש מפעיל את אותה הפרעה בעולם זהה (כרטיס / חשבון קיים / כלום), ושולח 7 בקשות לכתובת אחת — הסדרות חייבות להיות זהות
function oracleWorld() {
  const { env } = calmWix();
  addOrder(env, { email: "holder@example.com" });
  pilotUser(env, "acct@example.com", "acct.user");           // חשבון קיים, בלי כרטיס חדש
  env.mails.length = 0; env.advance(61 * 60000);              // שעה חדשה: מוני הכתובת מתאפסים
  return env;
}
const ORACLE_SCENARIOS = {
  "רגיל": () => {},
  "MailApp זורק (n=7)": env => { env.fail.mail = true; },
  "קריאת המכסה נכשלת והמכסה 0 (n=7)": env => { env.fail.quotaCall = true; env.mailQuota.left = 0; },
  "המכסה על הרזרבה": env => { env.mailQuota.left = 8; },
  "המכסה בין הרזרבות (קודים כן, 'כבר קיים' לא)": env => { env.mailQuota.left = 15; },
  "תקציב מיילים שעתי מלא": env => setCfg(env, "REG_MAILS_PER_HOUR", 0),
  "תקציב מיילים יומי מלא": env => setCfg(env, "REG_MAILS_PER_DAY", 0),
  "שאילתות Wix מלאות": env => setCfg(env, "REG_WIX_PER_HOUR", 0),
  "מכסת קודים יומית לכתובת מלאה": env => setCfg(env, "REG_MAILS_PER_EMAIL_DAY", 0),
  "Wix נופל": env => { env.fail.wix = 500; },
  "בלי מפתח Wix": env => { delete env.props.WIX_API_KEY; },
};
test("הרשמה — אין אורקל (n=1/2/7/13/14): סדרת תשובות זהה לכתובת עם כרטיס, עם חשבון קיים ובלי כלום — גם בכשל מייל, כשל קריאת מכסה, מכסה נמוכה וחריגת כל מכסה כללית", () => {
  for (const [title, perturb] of Object.entries(ORACLE_SCENARIOS)) {
    const seqs = ["holder@example.com", "acct@example.com", "nobody@example.com"].map(email => { const env = oracleWorld(); perturb(env); return Array.from({ length: 7 }, () => regAns(env, email)); });
    assert.deepEqual(seqs[0], seqs[2], title + ": כתובת עם כרטיס שונה מכתובת בלי");
    assert.deepEqual(seqs[1], seqs[2], title + ": כתובת עם חשבון שונה מכתובת בלי");
  }
  // ובסדרה הרגילה: 5 תשובות ok ואז rate לכולם
  const env = oracleWorld(); assert.deepEqual(Array.from({ length: 7 }, () => regAns(env, "holder@example.com")).map(x => x.error || "ok"), ["ok", "ok", "ok", "ok", "ok", "rate", "rate"]);
});

test("הרשמה — כתובת נעולה (10 כשלונות קוד) אינה מובחנת מכתובת בלי כרטיס גם כש-Wix נופל או שמכסת Wix מלאה (n=1/13)", () => {
  const { env } = calmWix(); addOrder(env, { email: "holder@example.com" });
  const rk = email => vm.runInContext("regKey_(" + JSON.stringify(email) + ")", env.sandbox);
  env.props[rk("holder@example.com")] = JSON.stringify({ f: 10, fx: env.now() + 3 * HOUR, exp: 0, tries: 0 });
  const both = () => [regAns(env, "holder@example.com"), regAns(env, "nobody@example.com")];
  let [a, b] = both(); assert.deepEqual(a, b); assert.deepEqual(a, { ok: true, sent: true });
  env.fail.wix = 500; [a, b] = both(); assert.deepEqual(a, b); assert.equal(a.error, "wix_down", "הנעולה לא מדלגת על שאילתת Wix — אחרת כשל Wix היה מגלה אותה");
  env.fail.wix = 0; setCfg(env, "REG_WIX_PER_HOUR", 0); [a, b] = both(); assert.deepEqual(a, b); assert.equal(a.error, "rate"); assert.equal(a.scope, "all");
  assert.equal(env.mails.length, 0);
});

test("תקציב מיילי ההרשמה (n=1/2/14): נספר רק על מיילים שיצאו בפועל; חריגה שעתית ויומית = אותה תשובה לכולם; שעה/יום חדשים משחררים", () => {
  const { env } = calmWix(); setCfg(env, "REG_MAILS_PER_HOUR", 3); setCfg(env, "REG_MAILS_PER_DAY", 5);
  for (const n of "abcdef") addOrder(env, { email: n + "@example.com" });
  for (let i = 0; i < 20; i++) regAns(env, "junk" + i + "@attacker.example");
  env.fail.mail = true; regAns(env, "a@example.com"); regAns(env, "b@example.com"); env.fail.mail = false;     // כשלי שליחה אינם נספרים
  assert.equal(env.props.REG_MAILS, undefined);
  for (const n of "abc") assert.deepEqual(regAns(env, n + "@example.com"), { ok: true, sent: true });
  assert.equal(env.mails.length, 3);
  const busy = regAns(env, "d@example.com"), junk = regAns(env, "junk99@attacker.example");
  assert.deepEqual(busy, junk, "תשובה אחידה לכתובת עם כרטיס ולכתובת בלי"); assert.deepEqual([busy.ok, busy.error, busy.scope], [false, "rate", "all"]);
  assert.equal(env.mails.length, 3, "החריגה לא שלחה ולא כתבה קוד"); assert.ok(!env.props[vm.runInContext("regKey_('d@example.com')", env.sandbox)]);
  env.advance(61 * 60000);                                                // שעה חדשה
  assert.deepEqual(regAns(env, "d@example.com"), { ok: true, sent: true }); assert.deepEqual(regAns(env, "e@example.com"), { ok: true, sent: true });
  assert.equal(env.mails.length, 5);
  assert.equal(regAns(env, "f@example.com").error, "rate", "התקציב היומי (5) מלא גם בשעה חדשה"); assert.equal(regAns(env, "junk100@attacker.example").error, "rate");
  env.advance(24 * HOUR);
  assert.deepEqual(regAns(env, "f@example.com"), { ok: true, sent: true }); assert.equal(env.mails.length, 6);
});

test("שאילתות Wix (n=1/13): מכסה כללית בשעה — חריגה היא אותה תשובה לכולם, לא צורכת מכסת כתובת ולא שולחת מייל; שעה חדשה משחררת", () => {
  const { env } = calmWix(); setCfg(env, "REG_WIX_PER_HOUR", 10); addOrder(env, { email: "holder@example.com" });
  for (let i = 0; i < 10; i++) regAns(env, "junk" + i + "@attacker.example");
  assert.equal(env.wix.calls.length, 10);
  const h = regAns(env, "holder@example.com"), n = regAns(env, "nobody@example.com");
  assert.deepEqual(h, n); assert.deepEqual([h.ok, h.error, h.scope], [false, "rate", "all"]); assert.match(h.message, /המגבלה אינה אישית/);
  assert.equal(env.wix.calls.length, 10, "הבקשות שנדחו לא שאלו את Wix"); assert.equal(env.mails.length, 0);
  env.advance(61 * 60000);
  for (let i = 0; i < 5; i++) assert.ok(regAns(env, "holder@example.com").ok, "מכסת הכתובת לא נצרכה בבקשות שנדחו, i=" + i);
  assert.equal(env.mails.length, 5);
});

test("'כבר קיים חשבון' (n=2/14): לכל היותר פעם ב-24 שעות לכתובת (חותמת ב-Properties) ולא מפריע לקודי חידוש — והתשובה תמיד זהה", () => {
  const { env } = calmWix(); pilotUser(env, "acct@example.com", "acct.user");
  const existsMails = () => env.mails.filter(m => /כבר קיים חשבון/.test(m.subject)).length, mk = vm.runInContext("mailRecKey_('acct@example.com')", env.sandbox);
  for (let i = 0; i < 3; i++) assert.deepEqual(regAns(env, "acct@example.com"), { ok: true, sent: true });
  assert.equal(existsMails(), 1, "שלוש בקשות באותה שעה — הודעה אחת");
  assert.ok(JSON.parse(env.props[mk]).x > 0, "חותמת ב-Script Properties (המטמון מוגבל ל-6 שעות)");
  env.advance(7 * HOUR); regAns(env, "acct@example.com"); assert.equal(existsMails(), 1, "גם אחרי 7 שעות (מעבר לחיי מטמון) — עדיין לא");
  env.advance(18 * HOUR); assert.deepEqual(regAns(env, "acct@example.com"), { ok: true, sent: true }); assert.equal(existsMails(), 2, "אחרי 24 שעות — שוב");
  // כרטיס חדש = חידוש: הקוד יוצא מיד, בלי קשר לחותמת
  addOrder(env, { email: "acct@example.com" }); assert.ok(regAns(env, "acct@example.com").ok);
  assert.match(env.mails[env.mails.length - 1].subject, /קוד לחידוש המנוי.*: \d{6}/); assert.equal(existsMails(), 2);
});

test("'כבר קיים חשבון' (n=2/14): הודעת נימוס בלבד — מתחת לרזרבת העותקים היא מדולגת בשקט (אותה תשובה כמו לכתובת בלי חשבון), וקודי הרשמה עדיין עוברים מעל רזרבת ההרשמה", () => {
  const { env } = calmWix(); pilotUser(env, "acct@example.com", "acct.user"); addOrder(env, { email: "holder@example.com" });
  const existsMails = () => env.mails.filter(m => /כבר קיים חשבון/.test(m.subject)).length;
  env.mailQuota.left = 15;                                              // מעל רזרבת ההרשמה (8), מתחת לרזרבת העותקים (20)
  assert.deepEqual(regAns(env, "acct@example.com"), regAns(env, "nobody@example.com")); assert.equal(existsMails(), 0, "לא נשלחה");
  assert.deepEqual(regAns(env, "holder@example.com"), { ok: true, sent: true }); assert.match(env.mails[env.mails.length - 1].subject, /קוד הרשמה/, "קוד כן יצא");
  env.mailQuota.left = 21;                                              // 1 + רזרבת העותקים
  regAns(env, "acct@example.com"); assert.equal(existsMails(), 1, "מעל הרזרבה — נשלחה");
  assert.equal(env.mailQuota.left, 20);
});

test("כשל שליחה ב-regStart (n=7): MailApp זורק בכל ענף — אותה תשובה לכולם, רשומת הקוד הקודמת (מוני כשלונות וקוד תקף) חוזרת במקום להימחק, והתקציב לא נצרך", () => {
  const { env } = calmWix(); addOrder(env, { email: "holder@example.com" }); pilotUser(env, "acct@example.com", "acct.user");
  const rk = vm.runInContext("regKey_('holder@example.com')", env.sandbox), mk = vm.runInContext("mailRecKey_('acct@example.com')", env.sandbox);
  assert.ok(regAns(env, "holder@example.com").ok); const code1 = codeFrom(env);
  for (let i = 0; i < 3; i++) assert.equal(env.call({ action: "regFinish", email: "holder@example.com", code: "000000", user: "h.user", pass: "holder-pass-1234" }).error, "bad_code");
  const prevRaw = env.props[rk], budget = env.props.REG_MAILS, mBefore = env.props[mk]; assert.equal(JSON.parse(prevRaw).f, 3);
  env.fail.mail = true;
  const h = regAns(env, "holder@example.com"), a = regAns(env, "acct@example.com"), n = regAns(env, "nobody@example.com");
  assert.deepEqual([h, a], [n, n]); assert.deepEqual(n, { ok: true, sent: true });
  assert.equal(env.props[rk], prevRaw, "רשומת הקוד הקודמת (כולל מונה הכשלונות) חזרה כפי שהייתה");
  assert.equal(env.props[mk], mBefore, "גם חותמת 'כבר קיים' לא נכתבה — אחרי שהמייל יעבוד ההודעה תצא"); assert.equal(env.props.REG_MAILS, budget, "התקציב לא נצרך");
  env.fail.mail = false;
  const fin = env.call({ action: "regFinish", email: "holder@example.com", code: code1, user: "h.user", pass: "holder-pass-1234" });
  assert.ok(fin.ok, "הקוד הקודם עדיין תקף: " + JSON.stringify(fin));
  // בלי רשומה קודמת: הכשל לא משאיר רשומת קוד
  addOrder(env, { email: "second@example.com" }); env.fail.mail = true;
  assert.deepEqual(regAns(env, "second@example.com"), n); assert.ok(!env.props[vm.runInContext("regKey_('second@example.com')", env.sandbox)]);
  env.fail.mail = false; assert.ok(regAns(env, "second@example.com").ok); assert.match(env.mails[env.mails.length - 1].subject, /קוד הרשמה/);
});

test("כשל קריאת מכסה (n=7): מכסה שחוזרת null / ריקה / NaN / טקסט היא 'לא ידוע' ולא 0 — ההרשמה לא ננעלת; ו-MailApp שזורק כשהמכסה באמת נגמרה לא מבדיל כתובות", () => {
  const { env } = calmWix(); addOrder(env, { email: "holder@example.com" });
  for (const bad of [null, undefined, "", NaN, "5"]) {
    env.sandbox.MailApp.getRemainingDailyQuota = () => bad;
    assert.equal(env.run("showMailQuota"), null, "ערך לא מספרי = לא ידוע: " + String(bad));
    assert.ok(regAns(env, "nobody" + String(bad) + "@example.com").ok);
  }
  env.sandbox.MailApp.getRemainingDailyQuota = () => null;
  assert.deepEqual(regAns(env, "holder@example.com"), { ok: true, sent: true }); assert.equal(env.mails.length, 1, "קוד יצא למרות שהמכסה לא ידועה");
  // הקריאה נכשלת והמכסה בפועל 0: MailApp זורק — אותה תשובה לכולם (ולא error:'server' רק לבעלי כרטיס)
  const { env: e2 } = calmWix(); addOrder(e2, { email: "holder@example.com" }); e2.fail.quotaCall = true; e2.mailQuota.left = 0;
  const h = regAns(e2, "holder@example.com"), n = regAns(e2, "nobody@example.com");
  assert.deepEqual(h, n); assert.deepEqual(n, { ok: true, sent: true }); assert.equal(e2.mails.length, 0);
});

test("מכסת קודים יומית לכתובת (n=2/14): מעבר ל-REG_MAILS_PER_EMAIL_DAY קוד לא נשלח — בשקט ובאותה תשובה — כך שכתובת אחת לא צורכת את התקציב הכללי ולא מוצפת", () => {
  const { env } = calmWix(); setCfg(env, "REG_MAILS_PER_EMAIL_DAY", 2); addOrder(env, { email: "victim@example.com" });
  const sendAt = () => { const r = regAns(env, "victim@example.com"); env.advance(61 * 60000); return r; };
  assert.deepEqual([sendAt(), sendAt(), sendAt(), sendAt()], Array(4).fill({ ok: true, sent: true }));
  assert.equal(env.mails.length, 2, "שני קודים ביום, והשאר נדחו בשקט"); assert.equal(JSON.parse(env.props.REG_MAILS).n, 2, "רק מיילים שיצאו נספרים");
  assert.deepEqual(regAns(env, "nobody@example.com"), { ok: true, sent: true });
  env.advance(24 * HOUR); sendAt(); assert.equal(env.mails.length, 3, "יום חדש — שוב");
});

/* ===== שחזור גישת מנהל (n=3/6) ===== */
test("שחזור מנהל (n=3): ניסיונות כניסה בשם 'Bootstrap'/'pw:...' וקודי הקמה שגויים לא נועלים את ההקמה ולא את החלפת הסיסמה", () => {
  const { env, token } = bootstrapped();
  assert.ok(env.call({ action: "addUser", token, newUser: "pilot.p1", newPass: "pilot-pass-12345" }).ok);
  const p1 = env.call({ action: "login", user: "pilot.p1", pass: "pilot-pass-12345" });
  delete env.props["U:itzik"];
  const code = env.run("initialize"); assert.match(code, /^[0-9a-f]{32}$/, "קוד הקמה של 128 ביט");
  for (const name of ["Bootstrap", "bootstrap", "BOOTSTRAP"]) for (let i = 0; i < 6; i++) env.call({ action: "login", user: name, pass: "x" + i });
  for (let i = 0; i < 6; i++) env.call({ action: "login", user: "pw:pilot.p1", pass: "x" + i });
  assert.equal(env.call({ action: "login", user: "Bootstrap", pass: "x" }).error, "locked", "נעילת הכניסה עצמה לא נפגעה (שם שהוקלד נעול)");
  for (let i = 0; i < 40; i++) assert.equal(env.call({ action: "bootstrap", code: "wrong" + i, user: "itzik2", pass: PASS }).error, "bad_code");
  assert.equal(env.doGet().needsBootstrap, true);
  const cp = env.call({ action: "changePassword", token: p1.token, oldPass: "pilot-pass-12345", newPass: "pilot-pass-67890" });
  assert.ok(cp.ok, "החלפת סיסמה של pilot.p1 לא ננעלה ע״י כניסות בשם pw:pilot.p1: " + JSON.stringify(cp));
  const ok = env.call({ action: "bootstrap", code, user: "itzik2", pass: PASS });
  assert.ok(ok.ok && ok.role === "admin", "הקוד הנכון עובד אחרי 40 ניסיונות שגויים: " + JSON.stringify(ok));
});

test("שחזור מנהל (n=6): מנהל חסום או שפג תוקפו אינו נספר כ'קיים' — initialize מנפיק קוד ומדפיס את כל המנהלים, ו-bootstrap יוצר מנהל חדש", () => {
  const { env, token } = bootstrapped();
  assert.ok(env.call({ action: "addUser", token, newUser: "volunteer", newPass: "volunteer-pass-1", role: "admin" }).ok);
  assert.ok(env.call({ action: "addUser", token, newUser: "old.admin", newPass: "old-admin-pass-1", role: "admin", until: "2000-01-01" }).ok);
  assert.ok(env.call({ action: "setBlocked", token, target: "volunteer", blocked: true }).ok);
  delete env.props["U:itzik"];                                          // כפי שה-README מורה: מוחקים רק את מנהל המטיס/הבעלים
  assert.equal(env.doGet().needsBootstrap, false, "בלי initialize אין הקמה (לא ניתן להפעיל מרחוק)");
  assert.equal(env.call({ action: "bootstrap", code: "anything", user: "itzik2", pass: PASS }).error, "no_setup");
  const code = env.run("initialize"); assert.match(code, /^[0-9a-f]{32}$/, "מונפק קוד גם שיש מנהל חסום ומנהל שפג תוקפו");
  const log = env.logs.join("\n"); assert.match(log, /volunteer \(חסום\)/); assert.match(log, /old\.admin \(פג תוקף\)/);
  assert.equal(env.doGet().needsBootstrap, true);
  const ok = env.call({ action: "bootstrap", code, user: "itzik2", pass: PASS });
  assert.ok(ok.ok && ok.role === "admin", JSON.stringify(ok));
  assert.ok(JSON.parse(env.props["U:volunteer"]).blocked, "החסום נשאר חסום"); assert.equal(env.doGet().needsBootstrap, false);
  // כשיש מנהל פעיל: initialize לא מנפיק, ומוחק קוד הקמה ישן שלא נוצל — כך שחסימת כל המנהלים בעתיד לא תפעיל אותו
  env.props.SETUP_CODE = vm.runInContext("sha256Hex_('stale-code')", env.sandbox);
  assert.equal(env.run("initialize"), null); assert.equal(env.props.SETUP_CODE, undefined);
  const u = JSON.parse(env.props["U:itzik2"]); u.blocked = true; env.props["U:itzik2"] = JSON.stringify(u);
  assert.equal(env.call({ action: "bootstrap", code: "stale-code", user: "itzik3", pass: PASS }).error, "no_setup", "לא ניתן להקים מנהל בלי initialize חדש");
  assert.equal(env.doGet().needsBootstrap, false);
});

/* ===== מחיקת משתמש לא משאירה יומן שאפשר לרשת (n=4) ===== */
test("מחיקת משתמש (n=4): ביומן שמו מוחלף בשם שאי אפשר להירשם בו — משתמש חדש באותו שם לא יורש יומן, לא רואה, לא עורך ולא שולח את הבקשות של הקודם", () => {
  const { env, token } = withWix(); goLive(env, token);
  const old = pilotUser(env, "old@example.com", "pilot.shared");
  const NAME = "מקום סודי — 05.12.2026", ro = savedRequest(env, old.token, NAME);
  assert.ok(sendTo(env, old.token, ro.folderId).ok);
  assert.ok(env.call({ action: "deleteUser", token, target: "pilot.shared" }).ok);
  const e0 = logOf(env).find(e => e.id === ro.folderId);
  assert.match(e0.user, /^pilot\.shared:נמחק:[0-9a-f]{8}$/); assert.equal(e0.lastUser, e0.user); assert.equal(e0.sent[0].user, e0.user);
  assert.equal(vm.runInContext("validName_(" + JSON.stringify(e0.user) + ")", env.sandbox), false, "אי אפשר להירשם בשם המוחלף");
  assert.ok(!JSON.stringify(logOf(env)).includes('"user":"pilot.shared"'), "אין יותר רשומה על השם הפנוי");
  // אדם אחר נרשם באותו שם, שומר את אותו מקום ותאריך ושולח: בלי 'כבר נשלח', בלי שעה של הקודם, בלי סיומת (2)
  const fresh = pilotUser(env, "new@example.com", "pilot.shared");
  const rn = savedRequest(env, fresh.token, NAME); assert.equal(rn.name, NAME);
  const sent = sendTo(env, fresh.token, rn.folderId); assert.ok(sent.ok, JSON.stringify(sent));
  // ואי אפשר לגעת בבקשה של הקודם
  assert.equal(env.call({ action: "saveFile", token: fresh.token, folderId: ro.folderId, name: "x.png", mime: "image/png", b64: b64("x") }).error, "forbidden");
  assert.equal(sendTo(env, fresh.token, ro.folderId).error, "forbidden");
  assert.equal(env.call({ action: "saveBegin", token: fresh.token, folderName: NAME, rid: ro.rid }).error, "forbidden");
  // המנהל רואה הכול, בשמות נפרדים; הסטטיסטיקה לא מערבבת שני אנשים
  const rows = env.call({ action: "listRequests", token }).requests; assert.equal(rows.length, 2);
  assert.ok(rows.some(r => r.user === e0.user && r.sentLive === 1) && rows.some(r => r.user === "pilot.shared" && r.sentLive === 1));
  const st = env.call({ action: "listUsers", token }).users.find(u => u.user === "pilot.shared"); assert.deepEqual([st.requests, st.sent], [1, 1]);
});

test("מחיקת משתמש (n=4): נכשלת סגור כשהיומן פגום (החשבון נשאר, אפשר לחסום במקום), ומונים שעתיים לפי שם לא עוברים למי שיתפוס את השם", () => {
  const { env, token } = calmWix();
  assert.ok(env.call({ action: "addUser", token, newUser: "dave", newPass: "dave-pass-1234" }).ok);
  const dave = env.call({ action: "login", user: "dave", pass: "dave-pass-1234" });
  savedRequest(env, dave.token, "של דייב — 07.12.2026");
  const f = env.folders.ROOT.files.find(x => x.name === "_יומן בקשות.json"), good = f.bytes;
  f.bytes = Buffer.from("{not json");
  const r = env.call({ action: "deleteUser", token, target: "dave" }); assert.deepEqual([r.ok, r.error], [false, "server"]);
  assert.ok(env.props["U:dave"], "החשבון לא נמחק"); assert.ok(env.call({ action: "setBlocked", token, target: "dave", blocked: true }).ok, "חסימה עדיין אפשרית");
  f.bytes = good;
  // מונה תיקיות חדשות וניסיונות כניסה של דייב: אחרי מחיקה ויצירה מחדש — מכסה נקייה
  setCfg(env, "MAX_NEW_FOLDERS_PER_HOUR", 2);
  assert.ok(env.call({ action: "setBlocked", token, target: "dave", blocked: false }).ok);
  const d2 = env.call({ action: "login", user: "dave", pass: "dave-pass-1234" });
  assert.ok(env.call({ action: "saveBegin", token: d2.token, folderName: "ב", rid: newRid() }).ok);       // השני בשעה (הראשון היה קודם)
  assert.equal(env.call({ action: "saveBegin", token: d2.token, folderName: "ג", rid: newRid() }).error, "rate");
  assert.ok(env.call({ action: "deleteUser", token, target: "dave" }).ok);
  assert.ok(env.call({ action: "addUser", token, newUser: "dave", newPass: "dave-pass-5678" }).ok);
  const d3 = env.call({ action: "login", user: "dave", pass: "dave-pass-5678" });
  assert.ok(env.call({ action: "saveBegin", token: d3.token, folderName: "חדש", rid: newRid() }).ok, "מכסת התיקיות של הקודם לא עברה");
});

/* ===== תקרות אחסון (n=5/16) וסוגי קבצים (n=8) ===== */
const bytesB64 = n => Buffer.alloc(n, 7).toString("base64");
const putFile = (env, tok, folderId, name, n = 3, mime = "application/octet-stream") => env.call({ action: "saveFile", token: tok, folderId, name, mime, b64: bytesB64(n) });
const livesIn = (env, folderId) => env.folders[folderId].files.filter(f => !f.trashed);
function daveUser(env, token, name = "dave") {
  assert.ok(env.call({ action: "addUser", token, newUser: name, newPass: "dave-pass-1234" }).ok);
  return env.call({ action: "login", user: name, pass: "dave-pass-1234" });
}

test("saveFile (n=8/16): רק סוגי קבצי הבקשה — אי אפשר לזייף או לדרוס את סימון 'נשלח — ....txt', וסיומות אחרות נדחות", () => {
  const { env, token } = bootstrapped();
  const b = savedRequest(env, token, "סימון — 06.12.2026");
  assert.ok(sendTo(env, token, b.folderId, { target: "self" }).ok);
  const marker = () => livesIn(env, b.folderId).filter(f => f.name.startsWith("נשלח — "));
  assert.equal(marker().length, 1); const name = marker()[0].name, content = marker()[0].bytes.toString();
  for (const bad of [name, "נשלח — 2026-01-01 00-00.txt", "x.txt", "x.bin", "noext", "x.docx.exe", "x.html"]) {
    const r = putFile(env, token, b.folderId, bad); assert.deepEqual([r.ok, r.error], [false, "bad_file"], bad);
  }
  assert.equal(marker().length, 1); assert.equal(marker()[0].name, name); assert.equal(marker()[0].bytes.toString(), content, "הסימון האמיתי לא נדרס ולא נשלח לאשפה");
  assert.ok(putFile(env, token, b.folderId, "ח.PNG").ok, "סיומת באותיות גדולות מותרת (מנורמלת)"); assert.ok(livesIn(env, b.folderId).some(f => f.name === "ח.png"));
  for (const okName of ["a.docx", "a.kml", "a.png", "a.jpg", "a.jpeg", "a.json"]) assert.ok(putFile(env, token, b.folderId, okName).ok, okName);
  assert.equal(env.call({ action: "saveFile", token: "bad", folderId: b.folderId, name: "x.txt", b64: "AAAA" }).ok, false);
});

test("תקרת קבצים לתיקייה (n=5/16): 12 קבצי בקשה לכל היותר — סימוני שליחה לא נספרים, החלפה באותו שם מותרת, חריגה לא מוחקת דבר ולא מבטלת 'מוכנה'", () => {
  const { env, token } = bootstrapped();
  const b = savedRequest(env, token, "מלא — 08.12.2026");                                  // 5 קבצים, מוכנה
  assert.ok(sendTo(env, token, b.folderId, { target: "self" }).ok); assert.ok(sendTo(env, token, b.folderId, { target: "self" }).ok);   // שני סימוני 'נשלח'
  for (let i = 0; i < 7; i++) assert.ok(putFile(env, token, b.folderId, "נוסף" + i + ".png").ok, "קובץ " + i);
  assert.equal(livesIn(env, b.folderId).filter(f => /\.(docx|kml|png|json)$/.test(f.name)).length, 12);
  assert.ok(env.call({ action: "saveEnd", token, folderId: b.folderId, ready: true }).ready);
  const before = livesIn(env, b.folderId).map(f => f.id).sort();
  const r = putFile(env, token, b.folderId, "אחד-יותר-מדי.png"); assert.deepEqual([r.ok, r.error], [false, "folder_full"]); assert.match(r.message, /12/);
  assert.deepEqual(livesIn(env, b.folderId).map(f => f.id).sort(), before, "לא נמחק ולא נוסף דבר");
  assert.equal(logOf(env).find(e => e.id === b.folderId).ready, true, "החריגה לא ביטלה 'מוכנה'");
  assert.ok(putFile(env, token, b.folderId, "נוסף3.png", 5).ok, "החלפה באותו שם מותרת גם כשהתיקייה מלאה");
  assert.equal(livesIn(env, b.folderId).filter(f => /\.(docx|kml|png|json)$/.test(f.name)).length, 12);
});

test("תקרת נפח לתיקייה (n=5/16): קבצי הבקשה לא עוברים את MAX_FOLDER_BYTES (≤ תקרת המייל); החלפה מנכה את הקובץ שיוחלף; חריגה לא מוחקת דבר", () => {
  const { env, token } = bootstrapped();
  const cfg = vm.runInContext("CFG", env.sandbox); assert.ok(cfg.MAX_FOLDER_BYTES <= cfg.MAX_MAIL_BYTES, "לא מעל תקרת המייל");
  setCfg(env, "MAX_FOLDER_BYTES", 1000);
  const b = env.call({ action: "saveBegin", token, folderName: "נפח — 09.12.2026", rid: newRid() });
  assert.ok(putFile(env, token, b.folderId, "א.png", 399).ok); assert.ok(putFile(env, token, b.folderId, "ב.png", 399).ok);
  const r = putFile(env, token, b.folderId, "ג.png", 300); assert.deepEqual([r.ok, r.error], [false, "folder_full"]); assert.match(r.message, /MB/);
  assert.equal(livesIn(env, b.folderId).length, 2);
  assert.ok(putFile(env, token, b.folderId, "א.png", 501).ok, "החלפת א.png ב-501: 399+501=900"); assert.equal(livesIn(env, b.folderId).length, 2);
  assert.equal(putFile(env, token, b.folderId, "א.png", 603).error, "folder_full", "399+603>1000");
});

test("תקרות העלאה למשתמש (n=5/16): נפח שעתי ויומי נמדדים בכתיבה (לא בנפח שנשמר), חריגה לא נספרת, מנהל פטור, ומונה של משתמש שנמחק לא עובר למחליפו", () => {
  const { env, token } = calmWix(); setCfg(env, "MAX_UPLOAD_BYTES_PER_HOUR", 1000); setCfg(env, "MAX_UPLOAD_BYTES_PER_DAY", 1500);
  const dave = daveUser(env, token), b = env.call({ action: "saveBegin", token: dave.token, folderName: "העלאות — 10.12.2026", rid: newRid() });
  assert.ok(putFile(env, dave.token, b.folderId, "א.png", 399).ok); assert.ok(putFile(env, dave.token, b.folderId, "א.png", 399).ok);     // אותו שם: הישן באשפה, אבל נכתבו 798
  const r = putFile(env, dave.token, b.folderId, "א.png", 399);
  assert.deepEqual([r.ok, r.error, r.scope, r.kind], [false, "rate", "user", "upload"]); assert.match(r.message, /השעתית/);
  assert.equal(livesIn(env, b.folderId).length, 1, "בתיקייה קובץ אחד, ובכל זאת הגרסאות החוזרות נספרו");
  env.advance(61 * 60000);                                                                  // שעה חדשה: 798 היום, 399 → 1197 ≤ 1500
  assert.ok(putFile(env, dave.token, b.folderId, "ב.png", 399).ok);
  const r2 = putFile(env, dave.token, b.folderId, "ב.png", 399); assert.equal(r2.error, "rate", "1596 > 1500 ביום"); assert.match(r2.message, /היומית/);
  for (let i = 0; i < 6; i++) assert.ok(putFile(env, token, savedRequest(env, token, "מנהל " + i + " — 10.12.2026").folderId, "ענק.png", 3000).ok, "מנהל פטור מהמכסות האישיות");
  // מחיקה ויצירה מחדש: המכסה (שעתית ויומית) של הקודם לא עוברת
  assert.ok(env.call({ action: "deleteUser", token, target: "dave" }).ok);
  const d2 = daveUser(env, token), b2 = env.call({ action: "saveBegin", token: d2.token, folderName: "אחרי — 10.12.2026", rid: newRid() });
  assert.ok(putFile(env, d2.token, b2.folderId, "ג.png", 399).ok); assert.ok(putFile(env, d2.token, b2.folderId, "ג.png", 399).ok);
  env.advance(24 * HOUR);
  const d3 = env.call({ action: "login", user: "dave", pass: "dave-pass-1234" }); assert.ok(d3.ok);
  assert.ok(putFile(env, d3.token, b2.folderId, "ד.png", 399).ok, "יום חדש — המכסה היומית מתאפסת");
});

test("תקרת בקשות פתוחות (n=5): משתמש עם יותר מדי בקשות שלא נשלחו חי לא פותח תיקייה חדשה; שמירה חוזרת, שליחה חיה ובקשות ישנות משחררות; אחרים ומנהל לא נפגעים", () => {
  const { env, token } = bootstrapped(); setCfg(env, "MAX_OPEN_REQUESTS_PER_USER", 3);
  const dave = daveUser(env, token), eve = daveUser(env, token, "eve.pilot"), rids = [newRid(), newRid(), newRid()];
  rids.forEach((rid, i) => assert.ok(env.call({ action: "saveBegin", token: dave.token, folderName: "פתוחה " + i, rid }).ok));
  const full = env.call({ action: "saveBegin", token: dave.token, folderName: "פתוחה 3", rid: newRid() });
  assert.deepEqual([full.ok, full.error], [false, "too_many_open"]); assert.match(full.message, /3/);
  assert.ok(env.call({ action: "saveBegin", token: dave.token, folderName: "פתוחה 0", rid: rids[0] }).ok, "שמירה חוזרת של בקשה קיימת אינה בקשה חדשה");
  const foldersBefore = Object.keys(env.folders).length;
  assert.equal(env.call({ action: "saveBegin", token: dave.token, folderName: "ועוד", rid: newRid() }).error, "too_many_open"); assert.equal(Object.keys(env.folders).length, foldersBefore, "לא נוצרה תיקייה");
  assert.ok(env.call({ action: "saveBegin", token: eve.token, folderName: "של חוה", rid: newRid() }).ok, "משתמש אחר לא נפגע");
  assert.ok(env.call({ action: "saveBegin", token, folderName: "מנהל 1", rid: newRid() }).ok && env.call({ action: "saveBegin", token, folderName: "מנהל 2", rid: newRid() }).ok && env.call({ action: "saveBegin", token, folderName: "מנהל 3", rid: newRid() }).ok && env.call({ action: "saveBegin", token, folderName: "מנהל 4", rid: newRid() }).ok, "מנהל פטור");
  // בקשה שנשלחה חי אינה 'פתוחה'
  goLive(env, token);
  const sent = savedRequest(env, eve.token, "של חוה לשליחה"); assert.ok(sendTo(env, eve.token, sent.folderId).ok);
  const log = logOf(env), mine = log.find(e => e.rid === rids[1]); mine.sent = [{ sid: "s1", t: env.now(), user: "dave", mode: "live", target: "office", to: [], st: "sent" }];   // dave שלח חי בקשה אחת
  env.folders.ROOT.files.find(f => f.name === "_יומן בקשות.json").bytes = Buffer.from(JSON.stringify(log));
  assert.ok(env.call({ action: "saveBegin", token: dave.token, folderName: "אחרי שחרור", rid: newRid() }).ok, "שליחה חיה משחררת מקום");
  assert.equal(env.call({ action: "saveBegin", token: dave.token, folderName: "מלא שוב", rid: newRid() }).error, "too_many_open");
  // בקשות שלא נגעו בהן LOG_KEEP_DAYS ימים אינן פתוחות
  const log2 = logOf(env); log2.filter(e => e.user === "dave" && !e.sent.length).forEach(e => { e.created = e.saved = env.now() - 40 * 86400000; });
  env.folders.ROOT.files.find(f => f.name === "_יומן בקשות.json").bytes = Buffer.from(JSON.stringify(log2));
  assert.ok(env.call({ action: "saveBegin", token: dave.token, folderName: "אחרי חודש", rid: newRid() }).ok);
  assert.ok(logOf(env).some(e => e.user === "eve.pilot" && e.name === "של חוה"), "הבקשות של אחרים נשארו ביומן");
});

test("רשומות שליחה בבקשה אחת (n=5): MAX_SENT_PER_REQUEST — נמחקות הישנות ביותר שאינן שליחה חיה; שליחה חיה לעולם לא נמחקת וממשיכה לחסום כפילות", () => {
  const { env, token } = bootstrapped(); goLive(env, token); setCfg(env, "MAX_SENT_PER_REQUEST", 4);
  const b = savedRequest(env, token, "הרבה שליחות — 11.12.2026");
  assert.ok(sendTo(env, token, b.folderId).ok);                                              // חיה
  for (let i = 0; i < 7; i++) { assert.ok(sendTo(env, token, b.folderId, { target: "self" }).ok, "עותק " + i); }
  const e = logOf(env).find(x => x.id === b.folderId);
  assert.equal(e.sent.length, 4, "התקרה נאכפת"); assert.equal(e.sent[0].mode, "live", "השליחה החיה נשארה, הישנות מבין העותקים נמחקו");
  assert.deepEqual(e.sent.slice(1).map(s => s.target), ["self", "self", "self"]);
  assert.equal(sendTo(env, token, b.folderId).error, "already_sent");
});

test("תיקייה מנופחת (שלא נוצרה דרך saveFile) (n=16): saveEnd ו-sendRequest מסרבים (folder_full) בלי לקרוא את תכני הקבצים ובלי לשלוח", () => {
  const { env, token } = bootstrapped(); goLive(env, token);
  const b = savedRequest(env, token, "מנופחת — 12.12.2026"); let reads = 0;
  for (let i = 0; i < 40; i++) env.folders[b.folderId].files.push({ id: "rogue" + i, name: "r" + i + ".docx", mime: "x", get bytes() { reads++; return Buffer.from("x"); }, trashed: false });
  const end = env.call({ action: "saveEnd", token, folderId: b.folderId, ready: true }); assert.deepEqual([end.ok, end.error], [false, "folder_full"]);
  assert.equal(sendTo(env, token, b.folderId).error, "folder_full"); assert.equal(env.mails.length, 0);
  assert.ok(reads <= 2 * 12, "לא נקראו תכני 40 הקבצים תחת הנעילה (נקראו " + reads + ")");
});

test("ניקוי שמות (n=8): תווי כיווניות, NUL, NEL ומפרידי שורה מוסרים משמות תיקיות, קבצים ונושא מייל; שם שכולו תווים בלתי נראים נדחה", () => {
  const { env, token } = bootstrapped();
  const dirty = [0x2066, 0x2067, 0x2068, 0x2069, 0x61c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x0, 0x85, 0x2028, 0x2029, 0x200b, 0xfeff].map(c => String.fromCharCode(c)).join("");
  const hidden = new RegExp("[" + [[0, 0x1f], [0x7f, 0x9f], [0x61c, 0x61c], [0x200b, 0x200f], [0x2028, 0x202e], [0x2066, 0x2069], [0xfeff, 0xfeff]].map(([a, z]) => String.fromCharCode(a) + "-" + String.fromCharCode(z)).join("") + "]");
  const b = env.call({ action: "saveBegin", token, folderName: "פי" + dirty + " גלילות — 01.01.2026", rid: newRid() });
  assert.ok(b.ok); assert.equal(b.name, "פי גלילות — 01.01.2026");
  assert.ok(!hidden.test(env.folders[b.folderId].name) && !hidden.test(logOf(env)[0].name) && !hidden.test(logOf(env)[0].base), "גם בדרייב וגם ביומן");
  assert.ok(putFile(env, token, b.folderId, "a" + dirty + "b.png").ok);
  assert.deepEqual(livesIn(env, b.folderId).map(f => f.name), ["a b.png"]);
  assert.equal(env.call({ action: "saveBegin", token, folderName: dirty, rid: newRid() }).error, "bad_name");
  const ready = savedRequest(env, token, "נושא — 02.01.2026");
  assert.ok(sendTo(env, token, ready.folderId, { subject: "נושא" + dirty + "כלשהו", target: "self" }).ok);
  const m = env.mails[env.mails.length - 1]; assert.ok(!hidden.test(m.subject), "הנושא נקי"); assert.match(m.subject, /נושא כלשהו$/);
});

/* ===== הבדיקה היומית לא מחזיקה את נעילת הסקריפט בזמן קריאות רשת (n=19) ===== */
test("בדיקה יומית (n=19): נעילת הסקריפט לא מוחזקת בזמן Wix; doPost במקביל לא מקבל busy; חידוש, איפוס סיסמה ומחיקה שהגיעו באמצע לא נדרסים; תזכורת בנעילה קצרה", () => {
  const { env, token } = withWix();
  const a = pilotUser(env, "a@example.com", "pilot.a"), b = pilotUser(env, "b@example.com", "pilot.b"), c = pilotUser(env, "c@example.com", "pilot.c");
  const orderOf = email => env.wix.orders.find(o => o.email === email);
  orderOf("a@example.com").status = "CANCELED";
  for (const n of ["pilot.b", "pilot.c"]) { const u = JSON.parse(env.props["U:" + n]); u.until = env.now() + 20 * DAY; env.props["U:" + n] = JSON.stringify(u); }     // תזכורת חודש מגיעה
  env.mails.length = 0; env.lock.strict = true;
  const hookResults = []; let fired = false;
  env.hooks.beforeFetch = () => {                               // doPost מקביל בתוך שאילתת ה-Wix הראשונה
    if (fired) return; fired = true;
    hookResults.push(env.call({ action: "setExpiry", token, target: "pilot.b", until: "2100-01-01" }));          // חידוש (תוקף חדש, תזכורות מתאפסות)
    hookResults.push(env.call({ action: "resetPassword", token, target: "pilot.a", newPass: "brand-new-pass-1" }));
    hookResults.push(env.call({ action: "deleteUser", token, target: "pilot.c" }));                              // נמחק באמצע
  };
  const stat = env.run("dailyCheck");
  assert.ok(hookResults.length === 3 && hookResults.every(r => r.ok), "doPost שהגיע באמצע לא קיבל busy: " + JSON.stringify(hookResults));
  assert.equal(stat.blocked, 1, "pilot.a נחסם (הזמנה בוטלה)");
  assert.equal(env.call({ action: "login", user: "pilot.a", pass: "brand-new-pass-1" }).error, "blocked", "איפוס הסיסמה שהגיע באמצע לא נדרס (אחרת bad_login)");
  const ub = JSON.parse(env.props["U:pilot.b"]); assert.ok(ub.until > Date.parse("2099-12-31"), "החידוש לא נדרס"); assert.deepEqual(JSON.parse(JSON.stringify(ub.reminded)), {}, "ולא נשלחה תזכורת על תקופה שכבר חודשה");
  assert.equal(env.props["U:pilot.c"], undefined, "משתמש שנמחק באמצע לא קם לתחייה");
  assert.equal(env.mails.filter(m => /המנוי שלך/.test(m.subject)).length, 0, "אין תזכורות לאף אחד מהשלושה");
  assert.ok(env.lock.holds.length >= 4 && env.lock.holds.every(h => h.fetches === 0), "אף קריאת Wix לא בוצעה כשהנעילה מוחזקת: " + JSON.stringify(env.lock.holds));
  // ריצה רגילה: תזכורת אחת בנעילה קצרה (מייל אחד לכל היותר בכל החזקה)
  env.hooks.beforeFetch = null; env.lock.holds.length = 0;
  const u = JSON.parse(env.props["U:pilot.b"]); u.until = env.now() + 20 * DAY; env.props["U:pilot.b"] = JSON.stringify(u);
  assert.equal(env.run("dailyCheck").reminded, 1); assert.equal(env.mails.filter(m => /המנוי שלך/.test(m.subject)).length, 1);
  assert.ok(env.lock.holds.every(h => h.fetches === 0 && h.mails <= 1), JSON.stringify(env.lock.holds));
});

test("בדיקה יומית (n=19): מגבלת 200 השאילתות מסתובבת בין המשתמשים — אף משתמש לא נשאר בסוף הרשימה בלי בדיקה", () => {
  const { env, token } = withWix();
  for (const n of ["u1", "u2", "u3"]) {
    assert.ok(env.call({ action: "addUser", token, newUser: "pilot." + n, newPass: "pilot-pass-12345", until: "2100-01-01" }).ok);
    const rec = JSON.parse(env.props["U:pilot." + n]); rec.orders = [n.toUpperCase() + "-A", n.toUpperCase() + "-B"]; rec.email = n + "@example.com"; env.props["U:pilot." + n] = JSON.stringify(rec);
    for (const s of ["A", "B"]) env.wix.orders.push({ orderNumber: n.toUpperCase() + "-" + s, status: "PAID", created: iso(env.now()), email: n + "@example.com", memberId: "m" });
  }
  vm.runInContext("DAILY_WIX_CALLS = 4", env.sandbox);
  const checked = () => env.wix.calls.map(c => /orderNumber=([^&]+)/.exec(c.search)[1]);
  env.run("dailyCheck"); assert.deepEqual(checked(), ["U1-A", "U1-B", "U2-A", "U2-B"], "ריצה ראשונה: שני משתמשים ראשונים");
  env.wix.calls.length = 0; env.run("dailyCheck");
  assert.deepEqual(checked().slice(0, 2), ["U3-A", "U3-B"], "ריצה שנייה מתחילה אחרי מי שנבדק");
  env.wix.orders.find(o => o.orderNumber === "U3-B").status = "CANCELED"; env.wix.calls.length = 0;
  env.run("dailyCheck"); env.run("dailyCheck");
  assert.equal(JSON.parse(env.props["U:pilot.u3"]).blocked, true, "הזמנה שבוטלה אצל משתמש שבסוף הרשימה נתפסת");
});


test("README של השרת: כל קבוע CFG שמוזכר בו קיים בקוד (מונע סטייה בין התיעוד למימוש), והמספרים שנקבעו מופיעים בו", () => {
  const readme = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "apps-script", "README.md"), "utf8");
  const { sandbox } = makeEnv();
  const cfg = vm.runInContext("CFG", sandbox);
  const named = [...new Set([...readme.matchAll(/`([A-Z][A-Z0-9_]{3,})`/g)].map(m => m[1]))].filter(n => /^(MAX|LOG|CODE|MAIL|REQUIRE|VALID|REMIND|ROOT|WIX|SENDER|RENEW|REG)_/.test(n) && !["WIX_API_KEY", "MAIL_MODE", "REG_MAILS"].includes(n));   // אלה Script Properties ולא CFG
  assert.ok(named.length >= 10, "נמצאו קבועים: " + named.join(","));
  for (const n of named) assert.ok(n in cfg, "README מזכיר את " + n + " אבל אין אותו ב-CFG");
  for (const [k, v] of [["MAX_OFFICE_PER_HOUR", 10], ["MAX_OFFICE_PER_HOUR_ALL", 60], ["MAX_COPIES_PER_HOUR", 10], ["MAX_COPIES_PER_HOUR_ALL", 120], ["MAX_SEND_ATTEMPTS_PER_HOUR", 40], ["MAIL_QUOTA_RESERVE", 20], ["LOG_MAX", 2000], ["LOG_KEEP_DAYS", 30], ["CODE_FAIL_MAX", 10], ["CODE_FAIL_HOURS", 6],
    ["MAIL_QUOTA_RESERVE_REG", 8], ["REG_PER_EMAIL_HOUR", 5], ["REG_WIX_PER_HOUR", 600], ["REG_MAILS_PER_HOUR", 150], ["REG_MAILS_PER_DAY", 400], ["REG_MAILS_PER_EMAIL_DAY", 10], ["REG_EXISTS_HOURS", 24],
    ["MAX_FOLDER_FILES", 12], ["MAX_UPLOAD_BYTES_PER_HOUR", 200 * 1048576], ["MAX_UPLOAD_BYTES_PER_DAY", 500 * 1048576], ["MAX_OPEN_REQUESTS_PER_USER", 60], ["MAX_SENT_PER_REQUEST", 100]])
    assert.equal(cfg[k], v, k);
  assert.ok(!("REG_PER_HOUR" in cfg), "המכסה הכללית הישנה (60 בשעה) בוטלה");
  assert.ok(cfg.MAIL_QUOTA_RESERVE_REG < cfg.MAIL_QUOTA_RESERVE, "קודי הרשמה משאירים רזרבה קטנה מזו של עותקים: משרד נוטאם ← קודים ← עותקים");
  assert.ok(cfg.MAX_FOLDER_BYTES <= cfg.MAX_MAIL_BYTES && cfg.REG_MAILS_PER_HOUR > 100, "תקרת תיקייה ≤ תקרת מייל; התקציב השעתי מכסה 100 נרשמים");
  assert.ok(cfg.MAX_COPIES_PER_HOUR_ALL >= 60, "תקרה כוללת לעותקים לא נמוכה מ-60");
  for (const fn of ["showMailQuota", "initialize", "installTrigger"]) assert.ok(readme.includes("`" + fn + "`"), "README מזכיר את " + fn);
});
