// בדיקות שרת Apps Script (apps-script/Code.gs) עם הדמיה של שירותי גוגל: משתמשים, חסימה, סיסמאות, אסימונים ושמירה לדרייב.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeEnv } from "./helpers/apps-script-env.mjs";

// הצהרת המבקש כפי שהדפדפן שולח ב-saveEnd (נוסח 2026-10-19 ומועד האישור): בלעדיה השרת לא מסמן בקשה מוכנה
const DECL = { v: "2026-10-19", at: "2026-10-19T10:00:00.000Z" };
const PASS = "correct-horse-1";
// כתובת הארגון (CFG.ADMIN_COPY_TO): מקבלת עותק מכל שליחה, והיא "המבקש" של חשבון ארגוני בלי כתובת שמורה. כתובת הבעלים (Session) היא רק נפילה כשהיא ריקה/לא תקינה
const ORG = "office@icd.org.il";
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
  const e = env.call({ action: "saveEnd", decl: DECL, token, folderId: b.folderId, ready });
  assert.ok(e.ok, JSON.stringify(e));
  return Object.assign(b, { rid, ready: e.ready });
}
const goLive = (env, token) => assert.ok(env.call({ action: "setMailMode", token, mode: "live" }).ok);

// עודכן לדרישת עצמאות המבקש: מצב בדיקה שולח לכתובת המבקש (ולא "לבעלים"); כאן המבקש הוא המנהל — משתמש בלי כתובת שמורה — ולכן הכתובת היא כתובת הארגון (ADMIN_COPY_TO, לא כתובת הבעלים)
test("ברירת מחדל: מצב בדיקה — המייל נשלח רק לכתובת המבקש (מנהל בלי כתובת = כתובת הארגון), עם קידומת בדיקה ובלי עותק למשרד נוטאם", () => {
  const { env, token } = bootstrapped();
  assert.equal(env.call({ action: "me", token }).mailMode, "test");
  const b = savedRequest(env, token);
  const r = env.call({ action: "sendRequest", expectMode: modeOf(env), token, folderId: b.folderId, subject: "בקשה לסגירה אווירית — פי גלילות", body: "שלום" });
  assert.ok(r.ok && r.mode === "test", JSON.stringify(r));
  assert.deepEqual(r.to, [ORG]);
  assert.equal(env.mails.length, 1);
  assert.equal(env.mails[0].to, ORG);
  assert.equal(env.mails[0].bcc, undefined, "הארגון כבר ב-to — לא נשלח אליו פעמיים");
  assert.match(env.mails[0].subject, /^\[בדיקה — לא נשלח למשרד נוטאם\] בקשה לסגירה אווירית/);
  assert.ok(!/iaa\.gov\.il/.test(JSON.stringify(env.mails[0])));
});

test("מצב חי: נמענים קבועים מפמ״ת א-11 סעיף 6(א) בלבד, עותק גלוי לכתובת הארגון (חשבון ארגוני; בלי BCC), נושא ללא קידומת", () => {
  const { env, token } = bootstrapped(); goLive(env, token);
  const b = savedRequest(env, token);
  const r = env.call({ action: "sendRequest", expectMode: modeOf(env), token, folderId: b.folderId, subject: "בקשה לסגירה אווירית — פי גלילות", body: "שלום" });
  assert.ok(r.ok && r.mode === "live");
  assert.deepEqual(r.to, ["notamoffice@iaa.gov.il", "nofm@iaa.gov.il"]);
  const m = env.mails[0];
  assert.equal(m.to, "notamoffice@iaa.gov.il,nofm@iaa.gov.il");
  assert.equal(m.cc, ORG);
  assert.equal(m.bcc, undefined, "חשבון ארגוני: אין עותק סמוי, הארגון ב-cc");
  assert.equal(m.subject, "בקשה לסגירה אווירית — פי גלילות");
  assert.equal(m.replyTo, ORG);
  assert.deepEqual(r.cc, [ORG]); assert.equal(r.target, "office"); assert.equal(r.adminCopy, true);
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
  assert.equal(env.call({ action: "saveEnd", decl: DECL, token, folderId: b.folderId, ready: true }).ready, false, "בלי תמונה — לא מוכנה");
  env.call({ action: "saveFile", token, folderId: b.folderId, name: "שם חדש.png", mime: "image/png", b64: b64("2") });
  assert.equal(env.call({ action: "saveEnd", decl: DECL, token, folderId: b.folderId, ready: false }).ready, false, "הלקוח לא אישר מוכנה");
  assert.equal(env.call(sendBody(env, token, b.folderId)).error, "not_ready");
  assert.equal(env.call({ action: "saveEnd", decl: DECL, token, folderId: b.folderId, ready: true }).ready, true);
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
  assert.equal(env.call({ action: "saveEnd", decl: DECL, token: dave.token, folderId: mine.folderId, ready: true }).error, "forbidden");
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
const withWixInto = env => { env.props.WIX_API_KEY = "test-key"; return env; };    // מפעיל את מפתח Wix המדומה בסביבה קיימת
// הודעת "לא נמצא כרטיס" (regStart לכתובת בלי כרטיס זכאי ובלי חשבון) היא סוג מייל נפרד מקודי ההרשמה ומ"כבר קיים חשבון"; בדיקות שסופרות קודים מסננות אותה (ובדיקות ייעודיות בודקות אותה: "הודעת 'לא נמצא כרטיס'" בהמשך)
const NOTICKET_SUBJECT = "לא נמצא כרטיס ״בקשת אישורי טיסה״ על הכתובת הזו";
const isNotice = m => m.subject === NOTICKET_SUBJECT;
const notices = env => env.mails.filter(isNotice);
const nonNotice = env => env.mails.filter(m => !isNotice(m));

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
  assert.equal(nonNotice(env).length, 0, "לא נשלח אף קוד (ולא 'כבר קיים חשבון')");
  assert.equal(notices(env).length, 8, "כל כתובת בלי כרטיס זכאי קיבלה רק את הודעת 'לא נמצא כרטיס' — אל הכתובת שהוקלדה בלבד");
});

test("הרשמה: הזמנה שנרשמה בשם מייל אחר/בכרטיס של משתתף אחר — מתאימים לפי המייל שבהזמנה או שבכרטיס, בשוויון מלא", () => {
  const { env } = withWix();
  addOrder(env, { email: "buyer@example.com", tickets: [{ guestDetails: { email: "holder@example.com" } }] });
  assert.ok(env.call({ action: "regStart", email: "holder@example.com" }).ok);
  assert.equal(nonNotice(env).length, 1, "בעל הכרטיס (לא הרוכש) זכאי");
  assert.ok(env.call({ action: "regStart", email: "holder@example.co" }).ok);
  assert.equal(nonNotice(env).length, 1, "מייל דומה אינו זכאי (לא נשלח לו קוד)");
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

test("הרשמה: מייל \"כבר קיים חשבון\" לא טוען שהמנוי בתוקף כשהוא כבר פג", () => {
  const { env } = withWix(); addOrder(env); assert.ok(regOk(env).ok);
  const u = userRec(env, "dana.pilot"); u.until = env.now() - 40 * DAY; env.props["U:dana.pilot"] = JSON.stringify(u);   // מנוי שפג לפני 40 יום, ואין כרטיס חדש
  let before = env.mails.length; env.call({ action: "regStart", email: "pilot@example.com" });
  assert.equal(env.mails.length, before + 1); assert.match(env.mails[before].subject, /כבר קיים חשבון/); assert.match(env.mails[before].body, /dana\.pilot/);
  assert.ok(!/בתוך תוקף/.test(env.mails[before].body), "מנוי שפג אינו מתואר כ״בתוך תוקף״");
  // בקרה: מנוי בתוקף — המשפט נשאר
  env.advance(25 * HOUR); const u2 = userRec(env, "dana.pilot"); u2.until = env.now() + 20 * DAY; env.props["U:dana.pilot"] = JSON.stringify(u2);
  before = env.mails.length; env.call({ action: "regStart", email: "pilot@example.com" });
  assert.equal(env.mails.length, before + 1); assert.match(env.mails[before].body, /המנוי בתוך תוקף עד/);
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
  assert.equal(nonNotice(env).length, 5, "5 קודים לבעל הכרטיס; לכתובת בלי כרטיס לא נשלח קוד");
  assert.equal(notices(env).length, 1, "ולכתובת בלי כרטיס הודעת 'לא נמצא כרטיס' אחת בלבד (פעם ב-24 שעות לכתובת)");
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
  assert.ok(env.call({ action: "saveEnd", decl: DECL, token, folderId: mine.folderId, ready: true }).ready);
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
const SENDER_SUFFIX = " — דרך מערכת בקשות הטיסה", ORG_NAME = "הארגון הישראלי לרב להב", FEATURES = ["sendTarget", "orgSplit", "advView"];

for (const [mode, target, want] of [
  ["test", "office", { to: ["pilot@example.com"], cc: [], prefix: TEST_PREFIX }],
  ["test", "self", { to: ["pilot@example.com"], cc: [], prefix: SELF_PREFIX }],
  ["live", "office", { to: OFFICE, cc: ["pilot@example.com"], prefix: "" }],
  ["live", "self", { to: ["pilot@example.com"], cc: [], prefix: SELF_PREFIX }],
]) {
  test(`נמענים — מטיס עצמאי, מצב ${mode} × יעד ${target}: to/cc/bcc/replyTo/נושא לפי המבקש (המטיס), כתובת הארגון רק בעותק סמוי`, () => {
    const { env, token } = withWix(); if (mode === "live") goLive(env, token);
    const pilot = pilotUser(env);
    const b = savedRequest(env, pilot.token, "אתר מטיס — 01.12.2026");
    const r = sendTo(env, pilot.token, b.folderId, { target });
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(env.mails.length, 1);
    const m = env.mails[0];
    assert.deepEqual(rcpts(m.to), want.to, "to");
    assert.deepEqual(rcpts(m.cc), want.cc, "cc");
    assert.deepEqual(rcpts(m.bcc), [ORG], "הארגון מקבל עותק סמוי ממטיס עצמאי");
    assert.equal(m.replyTo, "pilot@example.com", "תשובות חוזרות למבקש ולא לארגון");
    assert.equal(m.name, "דנה" + SENDER_SUFFIX, "שם השולח = displayName של המטיס (מ-Wix) + הסיומת הקבועה, לא שם הארגון");
    assert.equal(m.subject, want.prefix + "בקשה — נושא");
    assert.equal(m.attachments.length, 4);
    // כתובת הארגון לעולם לא ב-to/cc של מטיס ולא מוחזרת לו; כתובת הבעלים (Session) לא משמשת בכלל כשיש ADMIN_COPY_TO
    assert.ok(![...rcpts(m.to), ...rcpts(m.cc)].includes(ORG));
    assert.ok(!JSON.stringify(m).includes(OWNER));
    assert.equal(r.target, target); assert.equal(r.mode, mode); assert.equal(r.adminCopy, true);
    assert.deepEqual(r.to, want.to); assert.deepEqual(r.cc, want.cc);
    assert.ok(!JSON.stringify(r).includes(ORG) && !JSON.stringify(r).includes(OWNER), "כתובת הארגון לא נחשפת למטיס: " + JSON.stringify(r));
    assert.ok(r.sentAt > 0 && r.files.length === 4);
  });
}

test("המבקש הוא כתובת הארגון (מנהל בלי כתובת, או מטיס שנרשם עם כתובת הארגון): אין כפילות כתובות בשום צירוף", () => {
  const { env, token } = withWix();
  const owner = pilotUser(env, "Office@ICD.org.il", "owner.pilot");   // נרשם עם כתובת הארגון (באותיות אחרות) — הכתובת נשמרת מנורמלת
  const cases = [["admin", token], ["org-address-as-pilot", owner.token]];
  for (const [who, tok] of cases) for (const mode of ["test", "live"]) for (const target of ["office", "self"]) {
    if (mode === "live") goLive(env, token); else env.call({ action: "setMailMode", token, mode: "test" });
    const b = savedRequest(env, tok, who + " " + mode + " " + target + " — 02.12.2026");
    const before = env.mails.length;
    const r = sendTo(env, tok, b.folderId, { target });
    assert.ok(r.ok, JSON.stringify(r));
    const m = env.mails[before], all = [...rcpts(m.to), ...rcpts(m.cc), ...rcpts(m.bcc)].map(x => x.toLowerCase());
    assert.equal(new Set(all).size, all.length, who + " " + mode + " " + target + ": כתובת כפולה " + all.join(","));
    assert.ok(all.includes(ORG), "הארגון מקבל עותק (ב-to/cc כשהוא המבקש)");
    assert.equal(m.bcc, undefined, "הארגון כבר ב-to/cc");
    assert.equal(m.replyTo.toLowerCase(), ORG);
    if (mode === "live" && target === "office") { assert.deepEqual(rcpts(m.to), OFFICE); assert.deepEqual(rcpts(m.cc).map(x => x.toLowerCase()), [ORG]); }
    else assert.deepEqual(rcpts(m.to).map(x => x.toLowerCase()), [ORG]);
  }
});

test("כתובת המבקש גם אחד מנמעני משרד נוטאם — לא נשלח פעמיים לאותה כתובת (נרמול אותיות)", () => {
  const { env, token } = withWix(); goLive(env, token);
  const odd = pilotUser(env, "NOFM@iaa.gov.il", "odd.pilot");
  const r = sendTo(env, odd.token, savedRequest(env, odd.token, "כפילות — 03.12.2026").folderId);
  assert.ok(r.ok, JSON.stringify(r));
  const m = env.mails[0];
  assert.deepEqual(rcpts(m.to), OFFICE); assert.equal(m.cc, undefined);
  assert.deepEqual(rcpts(m.bcc), [ORG]); assert.equal(m.replyTo, "nofm@iaa.gov.il");
});

test("משתמש בלי כתובת שמורה (נוצר ידנית, ארגוני) נופל לכתובת הארגון; copyTo/email/org/features בכל תשובת כניסה", () => {
  const { env, token } = bootstrapped();
  env.call({ action: "addUser", token, newUser: "dave", newPass: "dave-pass-123" });
  const dave = env.call({ action: "login", user: "dave", pass: "dave-pass-123" });
  assert.equal(dave.email, ""); assert.equal(dave.copyTo, ORG); assert.equal(dave.copyToIsOwner, true); assert.equal(dave.org, true); assert.equal(dave.adv, true, "ארגוני בלי הכרעה: תצוגה מתקדמת"); assert.deepEqual(dave.features, FEATURES);
  const b = savedRequest(env, dave.token, "דייב — 04.12.2026");
  assert.ok(sendTo(env, dave.token, b.folderId, { target: "self" }).ok);
  assert.equal(env.mails[0].to, ORG); assert.equal(env.mails[0].replyTo, ORG); assert.equal(env.mails[0].bcc, undefined);
  // מנהל: אותו דבר
  const adm = env.call({ action: "me", token });
  assert.equal(adm.email, ""); assert.equal(adm.copyTo, ORG); assert.equal(adm.copyToIsOwner, true); assert.equal(adm.org, true); assert.equal(adm.adv, true); assert.deepEqual(adm.features, FEATURES);
});

test("תשובות login/me/changePassword/regFinish/listUsers/setMailMode מחזירות email, copyTo, copyToIsOwner, org, adv ו-features (מטיס עם כתובת; מנהל = ארגוני)", () => {
  const { env, token } = withWix();
  const reg = pilotUser(env);
  const check = (r, what) => {
    assert.ok(r.ok, what + " " + JSON.stringify(r));
    assert.equal(r.email, "pilot@example.com", what); assert.equal(r.copyTo, "pilot@example.com", what);
    assert.equal(r.copyToIsOwner, false, what); assert.equal(r.org, false, what); assert.equal(r.adv, false, what + ": מטיס עצמאי בלי הכרעה — בלי תצוגה מתקדמת"); assert.deepEqual(r.features, FEATURES, what);
    assert.ok(!JSON.stringify(r).includes(OWNER) && !JSON.stringify(r).includes(ORG), what + ": הבעלים וכתובת הארגון לא נחשפים");
  };
  check(reg, "regFinish");
  const lg = env.call({ action: "login", user: "dana.pilot", pass: "dana-pass-1234" }); check(lg, "login");
  check(env.call({ action: "me", token: lg.token }), "me");
  const cp = env.call({ action: "changePassword", token: lg.token, oldPass: "dana-pass-1234", newPass: "dana-new-pass-5678" }); check(cp, "changePassword");
  // תשובות מנהל (listUsers / setMailMode) נושאות את פרטי המנהל עצמו
  const lu = env.call({ action: "listUsers", token }), sm = env.call({ action: "setMailMode", token, mode: "live" });
  for (const r of [lu, sm]) { assert.equal(r.email, ""); assert.equal(r.copyTo, ORG); assert.equal(r.copyToIsOwner, true); assert.equal(r.org, true); assert.equal(r.adv, true); assert.deepEqual(r.features, FEATURES); }
  // וגם בשגיאת mode_changed (תשובה שמחזירה mailMode)
  const b = savedRequest(env, cp.token, "מוד — 05.12.2026");
  const mc = env.call({ action: "sendRequest", token: cp.token, folderId: b.folderId, subject: "נ", body: "ג", expectMode: "test" });
  assert.equal(mc.error, "mode_changed"); assert.equal(mc.mailMode, "live"); assert.deepEqual(mc.features, FEATURES); assert.equal(mc.org, false); assert.equal(mc.adv, false);
  assert.ok(!JSON.stringify(mc).includes(ORG));
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
  assert.ok(!/[\r\n]/.test(last.subject)); assert.equal(last.bcc, ORG); assert.equal(last.to, "pilot@example.com");
});

test("כתובת שמורה פגומה (פסיק/כמה כתובות) לא הופכת לכמה נמענים: נפילה לכתובת הארגון (בלי חשיפה למטיס); והרשמה עם כתובת כזו נדחית", () => {
  const { env, token } = withWix(); const pilot = pilotUser(env);
  const rec = JSON.parse(env.props["U:dana.pilot"]); rec.email = "a@example.com,victim@example.com"; env.props["U:dana.pilot"] = JSON.stringify(rec);
  const lg = env.call({ action: "login", user: "dana.pilot", pass: "dana-pass-1234" });
  assert.equal(lg.email, ""); assert.equal(lg.copyTo, "", "מטיס עצמאי בלי כתובת תקפה: כתובת הארגון לא מוחזרת לו"); assert.equal(lg.copyToIsOwner, false); assert.equal(lg.org, false);
  const r = sendTo(env, lg.token, savedRequest(env, lg.token, "פגום — 08.12.2026").folderId, { target: "self" });
  assert.ok(r.ok); assert.ok(!/victim|a@example/.test(JSON.stringify(env.mails[0])));
  assert.equal(env.mails[0].to, ORG); assert.equal(env.mails[0].replyTo, ORG); assert.equal(env.mails[0].bcc, undefined);
  assert.deepEqual([r.to, r.cc], [[], []], "התשובה למטיס לא כוללת את כתובת הארגון"); assert.ok(!JSON.stringify(r).includes(ORG));
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
  assert.equal(env.call({ action: "saveEnd", decl: DECL, token: pilot.token, folderId: b.folderId, ready: true }).ready, false, "אחרי saveBegin צריך לשמור מחדש (אין קבצים)");
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
  assert.match(t1, /יעד: לעצמו/); assert.match(t1, /אל: pilot@example\.com/); assert.match(t1, /עותק סמוי לארגון: כן/); assert.match(t1, /לא נשלח למשרד נוטאם/);
  assert.match(t1, /סוג חשבון: עצמאי/); assert.match(t1, new RegExp("שם השולח: דנה" + SENDER_SUFFIX)); assert.ok(!t1.includes(ORG), "כתובת הארגון לא נכתבת בסימון של מטיס");
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
  const e = pilotUser(env, "e@example.com", "pilot.e"), be = savedRequest(env, e.token, "קצב ה — 15.12.2026");
  const got = [[a, ba], [c, bc], [d, bd], [e, be]].map(([u, b]) => sendTo(env, u.token, b.folderId, { target: "self" }));
  assert.deepEqual(got.map(x => x.ok || x.error), [true, true, true, "rate"]);
  assert.equal(got[3].scope, "all"); assert.equal(got[3].kind, "copy");
  // חשבון ארגוני (המנהל) פטור מהתקרה הכוללת: עובר גם כשהיא מלאה (ראו גם "חשבון ארגוני פטור...")
  assert.ok(sendTo(env, token, savedRequest(env, token, "מנהל ב — 15.12.2026").folderId, { target: "self" }).ok);
});

test("שליחה: בלי כתובת ארגון ידועה (ADMIN_COPY_TO ריק/לא תקין ואין בעלים) — נכשל סגור: לא נשלח, לא נרשמת שליחה; כתובת הארגון או הבעלים — עותק לא נפגע", () => {
  const { env, token } = bootstrapped();
  const b = savedRequest(env, token);
  const noOwner = () => { env.sandbox.Session = { getEffectiveUser: () => ({ getEmail: () => "" }) }; };
  // כתובת הארגון מפורשת: לא תלויה בבעלים, גם כשאין כתובת בעלים
  noOwner();
  assert.ok(sendTo(env, token, b.folderId, { target: "self" }).ok, "ADMIN_COPY_TO מספיק");
  assert.equal(env.mails[0].to, ORG); env.mails.length = 0;
  // ריקה / לא תקינה / כמה כתובות + אין בעלים => no_owner (בשני היעדים)
  for (const bad of ["", "   ", "not-an-address", "a@example.com,b@example.com", "<a@example.com>", null]) {
    setCfg(env, "ADMIN_COPY_TO", bad);
    for (const target of ["office", "self"]) assert.equal(sendTo(env, token, b.folderId, { target }).error, "no_owner", JSON.stringify(bad) + " " + target);
  }
  assert.equal(env.mails.length, 0); assert.equal(readLogRaw(env)[0].sent.length, 1, "רק השליחה התקינה הראשונה נרשמה");
  // כתובת הארגון מנורמלת (רווחים, אותיות); ובלי שום כתובת ידועה copyTo ריק (ולא כתובת שגויה)
  setCfg(env, "ADMIN_COPY_TO", "  Office@ICD.org.il ");
  assert.equal(env.call({ action: "me", token }).copyTo, ORG);
  setCfg(env, "ADMIN_COPY_TO", "");
  { const me = env.call({ action: "me", token }); assert.deepEqual([me.copyTo, me.copyToIsOwner, me.org], ["", false, true]); }
  // עם כתובת בעלים תקינה, ADMIN_COPY_TO ריק/לא תקין => הכתובת היא כתובת הבעלים (ובתשובות me — copyTo)
  env.sandbox.Session = { getEffectiveUser: () => ({ getEmail: () => OWNER }) };
  for (const bad of ["", "a@example.com,b@example.com", "x"]) {
    setCfg(env, "ADMIN_COPY_TO", bad);
    assert.equal(env.call({ action: "me", token }).copyTo, OWNER, JSON.stringify(bad));
    assert.ok(sendTo(env, token, b.folderId, { target: "self" }).ok);
    const m = env.mails.pop(); assert.equal(m.to, OWNER); assert.equal(m.replyTo, OWNER);
  }
  // וגם מטיס עצמאי: העותק הסמוי לכתובת הבעלים כשאין ADMIN_COPY_TO
  setCfg(env, "ADMIN_COPY_TO", "");
  const pilot = pilotUser(withWixInto(env), "fallback@example.com", "pilot.fallback");
  assert.ok(sendTo(env, pilot.token, savedRequest(env, pilot.token, "נפילה — 08.12.2026").folderId, { target: "self" }).ok);
  assert.equal(env.mails.pop().bcc, OWNER);
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

test("עצמאות בין מטיסים: כל אחד שולח רק את הבקשות שלו, למבקש שלו; הארגון נכנס לתמונה רק כעותק סמוי ובתמיכה", () => {
  const { env, token } = withWix(); goLive(env, token);
  const p1 = pilotUser(env, "p1@example.com", "pilot.one"), p2 = pilotUser(env, "p2@example.com", "pilot.two");
  const b1 = savedRequest(env, p1.token, "אתר 1 — 16.12.2026"), b2 = savedRequest(env, p2.token, "אתר 2 — 16.12.2026");
  assert.equal(sendTo(env, p2.token, b1.folderId).error, "forbidden");
  assert.equal(sendTo(env, p1.token, b2.folderId, { target: "self" }).error, "forbidden");
  assert.equal(env.mails.length, 0);
  assert.ok(sendTo(env, p1.token, b1.folderId).ok); assert.ok(sendTo(env, p2.token, b2.folderId).ok);
  const [m1, m2] = env.mails;
  assert.deepEqual([m1.cc, m1.replyTo, m1.bcc], ["p1@example.com", "p1@example.com", ORG]);
  assert.deepEqual([m2.cc, m2.replyTo, m2.bcc], ["p2@example.com", "p2@example.com", ORG]);
  assert.deepEqual([m1.name, m2.name], ["דנה" + SENDER_SUFFIX, "דנה" + SENDER_SUFFIX]);
  assert.ok(!/p2@/.test(JSON.stringify(m1)) && !/p1@/.test(JSON.stringify(m2)));
  // תמיכה: המנהל שולח בקשה של מטיס — המבקש הוא המנהל המחובר (כמו שהלקוח מציג ב-copyTo), לא המטיס, ובשם הארגון
  const sup = savedRequest(env, p1.token, "תמיכה — 16.12.2026");
  assert.ok(sendTo(env, token, sup.folderId, { target: "self" }).ok);
  assert.equal(env.mails[2].to, ORG); assert.equal(env.mails[2].replyTo, ORG); assert.equal(env.mails[2].name, ORG_NAME);
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
  const dd = pilotUser(env, "dd@example.com", "pilot.dd");
  assert.equal(sendTo(env, dd.token, savedRequest(env, dd.token, "כשל ד — 26.12.2026").folderId, { target: "self" }).scope, "all");
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
  // גם "שלח למשרד" במצב בדיקה (עותק למבקש) נשאר מחוץ לרזרבה (ממטיס: מבקש + עותק סמוי לארגון = 2 נמענים)
  assert.ok(env.call({ action: "setMailMode", token, mode: "test" }).ok);
  env.mailQuota.left = 21; assert.equal(sendTo(env, b.token, rb.folderId).error, "mail_quota");
  env.mailQuota.left = 22; assert.ok(sendTo(env, b.token, rb.folderId).ok);
  // חשבון ארגוני (המנהל; נמען אחד: כתובת הארגון) פטור מהרזרבה — לא מורעב בידי מטיסים — ורק מכסה ריקה לגמרי עוצרת אותו
  const adm = savedRequest(env, token, "מנהל — 27.12.2026");
  env.mailQuota.left = 1; assert.ok(sendTo(env, token, adm.folderId, { target: "self" }).ok); assert.equal(env.mailQuota.left, 0);
  assert.equal(sendTo(env, token, adm.folderId, { target: "self" }).error, "mail_quota");
  assert.equal(logOf(env).find(e => e.id === adm.folderId).sent.length, 1, "החסימה לא נרשמה");
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
  // בראבו שומר אותו שם ותאריך: בלי סיומת (גם כשהבקשה של אלפא רק טיוטה). לכל מטיס תיקייה אישית, ולכן השם ייחודי בתוכה בלבד — גם בדרייב אין סיומת (2) שמעידה על אחר
  const draftA = savedRequest(env, a.token, "טיוטה משותפת — 22.10.2026");
  assert.equal(savedRequest(env, b.token, "טיוטה משותפת — 22.10.2026").name, "טיוטה משותפת — 22.10.2026", "טיוטה של אחר לא יוצרת סיומת");
  const rb = savedRequest(env, b.token, NAME);
  assert.equal(rb.name, NAME, "מטיס רגיל לא מקבל '(2)' בגלל בקשה של מישהו אחר");
  assert.equal(env.folders[rb.folderId].name, NAME, "בדרייב: השם ייחודי בתוך תיקיית האב (התיקייה האישית של בראבו), לא גלובלית");
  assert.notEqual(env.folders[rb.folderId].parent, env.folders[ra.folderId].parent, "תיקייה אישית נפרדת לכל מטיס");
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
  // המנהל (בקשות הארגון, בתיקיית "הארגון"): שמות ייחודיים בתוך התיקייה — בקשה שנייה באותו שם מקבלת סיומת, ובקשות המטיסים אינן משפיעות
  assert.equal(env.call({ action: "saveBegin", token, folderName: NAME, rid: newRid() }).name, NAME);
  assert.match(env.call({ action: "saveBegin", token, folderName: NAME, rid: newRid() }).name, / \(2\)$/);
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
  call({ action: "saveBegin", folderName: NAME, rid: ra.rid }); call({ action: "saveEnd", decl: DECL, folderId: ra.folderId, ready: true });
  call({ action: "saveFile", folderId: ra.folderId, name: "x.png", mime: "image/png", b64: b64("x") }); call({ action: "sendRequest", folderId: ra.folderId, subject: "נ", body: "ג", expectMode: "live" });
  const begin = call({ action: "saveBegin", folderName: NAME, rid: newRid() });
  for (const [n, mime] of STD_FILES) call({ action: "saveFile", folderId: begin.folderId, name: n, mime, b64: b64("x") });
  call({ action: "saveEnd", decl: DECL, folderId: begin.folderId, ready: true });
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
  assert.equal(env.mails.length, sent, "אבל לא נוצר קוד חדש ולא נשלח מייל (גם לא 'לא נמצא כרטיס' — לכתובת נעולה יש כרטיס)");
  assert.deepEqual(env.call({ action: "regStart", email: "nobody@example.com" }), r, "אי אפשר להבחין בין כתובת נעולה לכתובת בלי כרטיס");
  assert.equal(bad(c2).error, "bad_code");
  env.advance(7 * 3600000);                                                // CODE_FAIL_HOURS = 6
  assert.ok(env.call({ action: "regStart", email: "pilot@example.com" }).ok);
  assert.equal(nonNotice(env).length, sent + 1, "אחרי החלון נשלח קוד חדש");
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
  assert.equal(nonNotice(env).length, 0); assert.equal(env.wix.calls.length, 150, "כל בקשה שאלה את Wix פעם אחת");
  assert.equal(notices(env).length, 20, "הודעות 'לא נמצא כרטיס' חסומות בתקציב משלהן (REG_NOTICKET_PER_HOUR = 20) — לא 150 מיילים");
  assert.equal(env.props.REG_MAILS, undefined, "זבל לא נגע בתקציב המיילים היומי (קודים)");
  assert.deepEqual(regAns(env, "real@example.com"), { ok: true, sent: true });
  assert.equal(nonNotice(env).length, 1); assert.equal(nonNotice(env)[0].to, "real@example.com", "הקוד יצא למרות שתקציב ההודעות מלא");
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
  assert.equal(nonNotice(env).length, 0);
  assert.deepEqual(notices(env).map(m => m.to), ["nobody@example.com"], "רק בבקשה הראשונה (Wix עבד) נשלחה 'לא נמצא כרטיס', ורק לכתובת בלי כרטיס — לא לנעולה, ולא כש-Wix נופל או מכסת Wix מלאה");
});

test("תקציב מיילי ההרשמה (n=1/2/14): נספר רק על מיילים שיצאו בפועל; חריגה שעתית ויומית = אותה תשובה לכולם; שעה/יום חדשים משחררים", () => {
  const { env } = calmWix(); setCfg(env, "REG_MAILS_PER_HOUR", 3); setCfg(env, "REG_MAILS_PER_DAY", 5);
  for (const n of "abcdef") addOrder(env, { email: n + "@example.com" });
  for (let i = 0; i < 20; i++) regAns(env, "junk" + i + "@attacker.example");
  env.fail.mail = true; regAns(env, "a@example.com"); regAns(env, "b@example.com"); env.fail.mail = false;     // כשלי שליחה אינם נספרים
  assert.equal(env.props.REG_MAILS, undefined);
  for (const n of "abc") assert.deepEqual(regAns(env, n + "@example.com"), { ok: true, sent: true });
  assert.equal(nonNotice(env).length, 3);
  const busy = regAns(env, "d@example.com"), junk = regAns(env, "junk99@attacker.example");
  assert.deepEqual(busy, junk, "תשובה אחידה לכתובת עם כרטיס ולכתובת בלי"); assert.deepEqual([busy.ok, busy.error, busy.scope], [false, "rate", "all"]);
  assert.equal(nonNotice(env).length, 3, "החריגה לא שלחה ולא כתבה קוד"); assert.ok(!env.props[vm.runInContext("regKey_('d@example.com')", env.sandbox)]);
  env.advance(61 * 60000);                                                // שעה חדשה
  assert.deepEqual(regAns(env, "d@example.com"), { ok: true, sent: true }); assert.deepEqual(regAns(env, "e@example.com"), { ok: true, sent: true });
  assert.equal(nonNotice(env).length, 5);
  assert.equal(regAns(env, "f@example.com").error, "rate", "התקציב היומי (5) מלא גם בשעה חדשה"); assert.equal(regAns(env, "junk100@attacker.example").error, "rate");
  env.advance(24 * HOUR);
  assert.deepEqual(regAns(env, "f@example.com"), { ok: true, sent: true }); assert.equal(nonNotice(env).length, 6);
});

test("שאילתות Wix (n=1/13): מכסה כללית בשעה — חריגה היא אותה תשובה לכולם, לא צורכת מכסת כתובת ולא שולחת מייל; שעה חדשה משחררת", () => {
  const { env } = calmWix(); setCfg(env, "REG_WIX_PER_HOUR", 10); addOrder(env, { email: "holder@example.com" });
  for (let i = 0; i < 10; i++) regAns(env, "junk" + i + "@attacker.example");
  assert.equal(env.wix.calls.length, 10);
  const h = regAns(env, "holder@example.com"), n = regAns(env, "nobody@example.com");
  assert.deepEqual(h, n); assert.deepEqual([h.ok, h.error, h.scope], [false, "rate", "all"]); assert.match(h.message, /המגבלה אינה אישית/);
  assert.equal(env.wix.calls.length, 10, "הבקשות שנדחו לא שאלו את Wix"); assert.equal(nonNotice(env).length, 0);
  env.advance(61 * 60000);
  for (let i = 0; i < 5; i++) assert.ok(regAns(env, "holder@example.com").ok, "מכסת הכתובת לא נצרכה בבקשות שנדחו, i=" + i);
  assert.equal(nonNotice(env).length, 5);
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
  assert.deepEqual(regAns(env, "holder@example.com"), { ok: true, sent: true }); assert.equal(nonNotice(env).length, 1, "קוד יצא למרות שהמכסה לא ידועה");
  // הקריאה נכשלת והמכסה בפועל 0: MailApp זורק — אותה תשובה לכולם (ולא error:'server' רק לבעלי כרטיס)
  const { env: e2 } = calmWix(); addOrder(e2, { email: "holder@example.com" }); e2.fail.quotaCall = true; e2.mailQuota.left = 0;
  const h = regAns(e2, "holder@example.com"), n = regAns(e2, "nobody@example.com");
  assert.deepEqual(h, n); assert.deepEqual(n, { ok: true, sent: true }); assert.equal(e2.mails.length, 0);
});

test("מכסת קודים יומית לכתובת (n=2/14): מעבר ל-REG_MAILS_PER_EMAIL_DAY קוד לא נשלח — בשקט ובאותה תשובה — כך שכתובת אחת לא צורכת את התקציב הכללי ולא מוצפת", () => {
  const { env } = calmWix(); setCfg(env, "REG_MAILS_PER_EMAIL_DAY", 2); addOrder(env, { email: "victim@example.com" });
  const sendAt = () => { const r = regAns(env, "victim@example.com"); env.advance(61 * 60000); return r; };
  assert.deepEqual([sendAt(), sendAt(), sendAt(), sendAt()], Array(4).fill({ ok: true, sent: true }));
  assert.equal(nonNotice(env).length, 2, "שני קודים ביום, והשאר נדחו בשקט"); assert.equal(JSON.parse(env.props.REG_MAILS).n, 2, "רק מיילים שיצאו נספרים");
  assert.deepEqual(regAns(env, "nobody@example.com"), { ok: true, sent: true });
  env.advance(24 * HOUR); sendAt(); assert.equal(nonNotice(env).length, 3, "יום חדש — שוב");
});

/* ===== הודעת "לא נמצא כרטיס" (regStart): כתובת בלי כרטיס זכאי ובלי חשבון, אחרי ששאילתת Wix הצליחה ===== */
// הנוסח שאושר, מילה במילה (נפרד מהקוד בכוונה — טעות בקוד תיתפס כאן). ״ = ״, מקף ארוך = —
const NT = {
  hi: "שלום,",
  p1: "ביקשתם להירשם לבקשות טיסה בכתובת הזו. בדקנו את הרישומים ולא נמצא כרטיס ששולם עבור ״בקשת אישורי טיסה״.",
  p2: "ייתכן שנרשמתם רק למפת הנוט״מים — היא אינה כוללת בקשות טיסה, שמיועדות למטיסים מסחריים ודורשות רכישה נפרדת של הכרטיס.",
  benefit: "הצטרפות למערכת בקשות הטיסה מאפשרת להכין ולהגיש בקשות לסגירה אווירית בקלות ובמהירות, עם פחות בירוקרטיה. המערכת בודקת מראש אזורי איסור, נוטמים ומכשולים באזור, ובכך מסייעת למנוע תאונות שנובעות מחוסר ידיעה.",
  label: "לרכישת הכרטיס והצטרפות",
  member: ", ושהכרטיס נרכש כשאתם מחוברים כחברים רשומים באתר",
};
const ntTail = (member, support) => "אם כבר רכשתם את הכרטיס, ודאו שהמייל שהקלדתם הוא מייל הרכישה" + (member ? NT.member : "") + "." + (support ? " לשאלות: " + support : "");
const ntBody = (url, tail) => [NT.hi, "", NT.p1, "", NT.p2, "", NT.benefit, "", ...(url ? [NT.label + ": " + url, ""] : []), tail].join("\n");
const ntRtl = '<div dir="rtl" style="direction:rtl;text-align:right;';
const ntNoTicketEnv = () => { const r = calmWix(); addOrder(r.env, { email: "holder@example.com" }); return r.env; };
const ntRun = (env, email) => { const n = env.mails.length; assert.deepEqual(regAns(env, email), { ok: true, sent: true }, email); return env.mails.slice(n); };
const ntLedger = env => env.props.REG_NOTICKET === undefined ? [] : JSON.parse(env.props.REG_NOTICKET).l;

test("הודעת 'לא נמצא כרטיס': כתובת בלי כרטיס זכאי ובלי חשבון מקבלת מייל RTL בנוסח המאושר — לכתובת שהוקלדה בלבד, בשם הארגון, 'השב ל' כתובת הארגון, כפתור https אחד, ובלי כתובת הארגון בגוף", () => {
  const env = ntNoTicketEnv(), url = vm.runInContext("CFG.RENEW_URL", env.sandbox), senderName = vm.runInContext("CFG.SENDER_NAME", env.sandbox);
  const sent = ntRun(env, " Nobody@Example.com ");
  assert.equal(sent.length, 1); const m = sent[0];
  assert.deepEqual(Object.keys(m).sort(), ["body", "htmlBody", "name", "replyTo", "subject", "to"], "אין שדות נמענים נוספים (cc / bcc)");
  assert.equal(m.to, "nobody@example.com"); assert.equal(m.name, senderName); assert.equal(m.replyTo, ORG);
  assert.equal(m.subject, NOTICKET_SUBJECT);
  assert.equal(m.body, ntBody(url, ntTail(true, "info@icd.org.il")), "גוף הטקסט הרגיל (גיבוי) — הנוסח המאושר בלבד");
  // HTML: מימין לשמאל, פסקאות, כפתור אחד שכתובתו RENEW_URL, בלי כלום מעבר ל-div / br / a
  const h = m.htmlBody;
  assert.ok(h.startsWith(ntRtl) && h.endsWith("</div>") && h.includes('dir="rtl"'), h);
  assert.equal((h.match(/<a[\s>]/g) || []).length, 1, "כפתור אחד בלבד");
  assert.equal((h.match(/href=/g) || []).length, 1);
  assert.ok(h.includes('<a href="' + url + '" target="_blank" rel="noopener noreferrer" style="'), "כתובת הכפתור = RENEW_URL, בלשונית חדשה, עם noopener noreferrer");
  assert.ok(h.includes(">" + NT.label + "</a>"), "תווית הכפתור");
  assert.ok(url.startsWith("https://"));
  assert.deepEqual([...new Set([...h.matchAll(/<\/?([a-z0-9]+)/gi)].map(x => x[1].toLowerCase()))].sort(), ["a", "br", "div"], "בלי סקריפט / תמונה / רשימה");
  for (const p of [NT.hi, NT.p1, NT.p2, NT.benefit, ntTail(true, "info@icd.org.il")]) assert.ok(h.includes(p), "ב-HTML: " + p.slice(0, 30));
  assert.ok(h.indexOf(NT.benefit) < h.indexOf("<a ") && h.indexOf("<a ") < h.indexOf("אם כבר רכשתם"), "סדר: תועלת, כפתור, ואז 'אם כבר רכשתם'");
  // כתובת הארגון והבעלים לעולם לא בגוף / בנושא / בכותרת השולח; רק ב'השב ל'. ובנוסח פונה למטיס: בלי 'מנהל המערכת'
  for (const field of ["subject", "body", "htmlBody", "to", "name"]) assert.ok(!/office@icd\.org\.il|owner@icd\.test/i.test(m[field]) && !/מנהל המערכת/.test(m[field]), field);
  assert.ok(m.htmlBody.includes("info@icd.org.il") && m.body.includes("info@icd.org.il"), "כתובת התמיכה");
  assert.equal(env.props.REG_MAILS, undefined, "לא נספר בתקציב מיילי ההרשמה (קודים)");
});

test("הודעת 'לא נמצא כרטיס': ההסתייגות על חברות באתר רק כש-REQUIRE_MEMBER; כתובת התמיכה נדפסת רק אם תקינה ואינה כתובת הארגון; 'השב ל' נופל לכתובת הבעלים וגם היא לא בגוף", () => {
  const env = ntNoTicketEnv(), url = vm.runInContext("CFG.RENEW_URL", env.sandbox);
  const body = (email, member, support) => { const [m] = ntRun(env, email); assert.equal(m.body, ntBody(url, ntTail(member, support)), email); assert.ok(m.htmlBody.includes(ntTail(member, support)), email); return m; };
  body("a1@example.com", true, "info@icd.org.il");
  setCfg(env, "REQUIRE_MEMBER", false); body("a2@example.com", false, "info@icd.org.il");
  setCfg(env, "REQUIRE_MEMBER", true);
  setCfg(env, "SUPPORT_EMAIL", ""); body("a3@example.com", true, "");
  setCfg(env, "SUPPORT_EMAIL", "not an address"); body("a4@example.com", true, "");
  setCfg(env, "SUPPORT_EMAIL", ORG); const m5 = body("a5@example.com", true, ""); assert.ok(!JSON.stringify([m5.subject, m5.body, m5.htmlBody]).includes(ORG), "כתובת הארגון לא מודפסת גם אם הוגדרה בטעות כתובת תמיכה");
  setCfg(env, "SUPPORT_EMAIL", "info@icd.org.il"); setCfg(env, "ADMIN_COPY_TO", "");
  const m6 = body("a6@example.com", true, "info@icd.org.il"); assert.equal(m6.replyTo, "owner@icd.test", "כתובת הארגון ריקה: נופלים לכתובת הבעלים, כמו בשאר מיילי המערכת");
  assert.ok(!JSON.stringify([m6.subject, m6.body, m6.htmlBody]).includes("owner@icd.test"));
});

test("הודעת 'לא נמצא כרטיס': גם כרטיס ששולם בלי חברות באתר אינו 'כרטיס זכאי' — הודעה עם ההסתייגות על חברות; ועם כרטיס זכאי יוצא קוד ולא הודעה", () => {
  const env = ntNoTicketEnv();
  addOrder(env, { email: "visitor@example.com", memberId: "" });
  const [m] = ntRun(env, "visitor@example.com"); assert.equal(m.subject, NOTICKET_SUBJECT); assert.ok(m.body.includes(NT.member.slice(2)));
  const [c] = ntRun(env, "holder@example.com"); assert.match(c.subject, /^קוד הרשמה לבקשות טיסה: \d{6}$/);
  setCfg(env, "REQUIRE_MEMBER", false);                                        // בלי הדרישה — הכרטיס של visitor זכאי
  const [c2] = ntRun(env, "visitor@example.com"); assert.match(c2.subject, /^קוד הרשמה/, "כרטיס זכאי = קוד, לא הודעה (גם לכתובת שכבר קיבלה הודעה)");
});

test("הודעת 'לא נמצא כרטיס': כפתור רק עם RENEW_URL תקין ב-https — כתובת אחרת/מסוכנת = בלי כפתור וגם בלי הכתובת בגוף הטקסט; המייל עדיין יוצא; כתובת תקינה עוברת escape ב-HTML", () => {
  const env = ntNoTicketEnv(); let i = 0; setCfg(env, "REG_NOTICKET_PER_HOUR", 1000);
  const bad = ["http://www.icd.org.il/x", "javascript:alert(1)", "//www.icd.org.il/x", "ftp://x.example/z", "https://", "https:///x", 'https://evil.example/"><script>alert(1)</script>', "https://evil.example/x'onmouseover='y",
    "https://evil.example/a b", "https://u:p@evil.example/", "https://u:80@evil.example/", "https://evil.example/א", "https://evil.example/\\x", "https://evil.example/<x>", "", null, 12345, "https://" + "a".repeat(400) + ".com"];
  for (const u of bad) {
    setCfg(env, "RENEW_URL", u);
    const [m] = ntRun(env, "bad" + ++i + "@example.com");
    assert.ok(m, String(u).slice(0, 40)); assert.equal(m.subject, NOTICKET_SUBJECT);
    assert.ok(!/<a[\s>]|href|<script|javascript/i.test(m.htmlBody), "אין כפתור / קישור: " + String(u).slice(0, 40));
    assert.equal(m.body, ntBody("", ntTail(true, "info@icd.org.il")), "בלי שורת הכפתור והכתובת בטקסט: " + String(u).slice(0, 40));
    assert.ok(m.htmlBody.includes(NT.benefit) && m.htmlBody.includes("אם כבר רכשתם"), "שאר הנוסח נשאר");
  }
  setCfg(env, "RENEW_URL", "https://www.icd.org.il/events-1/x?a=1&b=2#f");
  let [m] = ntRun(env, "good1@example.com");
  assert.ok(m.htmlBody.includes('href="https://www.icd.org.il/events-1/x?a=1&amp;b=2#f"'), "escape של & ב-HTML"); assert.ok(m.body.includes("\nhttps://www.icd.org.il/events-1/x?a=1&b=2#f\n") || m.body.includes(NT.label + ": https://www.icd.org.il/events-1/x?a=1&b=2#f"));
  setCfg(env, "RENEW_URL", "https://icd.org.il");
  [m] = ntRun(env, "good2@example.com"); assert.equal((m.htmlBody.match(/<a[\s>]/g) || []).length, 1); assert.ok(m.htmlBody.includes('href="https://icd.org.il"'));
});

test("הודעת 'לא נמצא כרטיס': אותה תשובה לכתובת עם כרטיס, עם חשבון, בלי כלום ומוגבלת — וכל ענף שלא נדחה שולח בדיוק מייל אחד מסוגו (קוד / 'כבר קיים חשבון' / 'לא נמצא כרטיס'), בלי שינוי בשניים הראשונים", () => {
  const env = ntNoTicketEnv(); pilotUser(env, "acct@example.com", "acct.user"); env.mails.length = 0; env.advance(61 * 60000);
  const kind = m => isNotice(m) ? "notice" : /^כבר קיים חשבון/.test(m.subject) ? "exists" : /^קוד הרשמה/.test(m.subject) ? "code" : "other";
  const one = email => { const sent = ntRun(env, email); return sent.map(kind); };
  assert.deepEqual(one("holder@example.com"), ["code"]);
  assert.deepEqual(one("acct@example.com"), ["exists"]);
  assert.deepEqual(one("nobody@example.com"), ["notice"]);
  assert.deepEqual(one("nobody@example.com"), [], "מוגבלת (כבר קיבלה): אותה תשובה, בלי מייל");
  assert.deepEqual(one("acct@example.com"), [], "'כבר קיים חשבון' מוגבלת כמו קודם");
  assert.deepEqual(env.mails.map(kind), ["code", "exists", "notice"]);
  const [code, exists, notice] = env.mails;
  for (const [m, to] of [[code, "holder@example.com"], [exists, "acct@example.com"]]) { assert.deepEqual(Object.keys(m).sort(), ["body", "name", "replyTo", "subject", "to"], "מיילי הקוד ו'כבר קיים' ללא htmlBody (ללא שינוי)"); assert.equal(m.to, to); assert.equal(m.replyTo, ORG); }
  assert.match(code.body, /^שלום,\n\nהקוד שלך להרשמה לבקשות טיסה: \d{6}\nהקוד תקף ל-15 דקות\. אם לא ביקשת — אפשר להתעלם מהמייל\.\n\nצוות הארגון הישראלי לרחפנים$/);
  assert.equal(exists.subject, "כבר קיים חשבון לבקשות טיסה בכתובת הזו"); assert.match(exists.body, /^שלום,\n\nכבר קיים חשבון בבקשות טיסה המשויך לכתובת הזו\. שם המשתמש: acct\.user\n/); assert.ok(exists.body.includes("info@icd.org.il") && !exists.body.includes(ORG));
  assert.equal(notice.to, "nobody@example.com");
  // והתשובות זהות גם אחרי שהתקציב והמכסות מלאים
  setCfg(env, "REG_NOTICKET_PER_HOUR", 0); setCfg(env, "REG_NOTICKET_PER_DAY", 0);
  for (const e of ["holder@example.com", "acct@example.com", "nobody@example.com", "other-nobody@example.com"]) assert.deepEqual(regAns(env, e), { ok: true, sent: true });
});

test("הודעת 'לא נמצא כרטיס': נכשל סגור — לא נשלחת כש-Wix לא מוגדר, נופל או מחזיר שגיאה (בלי טענה שווא 'אין כרטיס'); ורק כש-Wix עונה היא יוצאת", () => {
  const a = bootstrapped();                                                      // בלי WIX_API_KEY
  assert.equal(a.env.call({ action: "regStart", email: "nobody@example.com" }).error, "not_configured");
  assert.equal(a.env.mails.length, 0); assert.equal(a.env.props.REG_NOTICKET, undefined);
  const { env } = calmWix();
  for (const code of [500, 401, 404, 429]) { env.fail.wix = code; assert.equal(env.call({ action: "regStart", email: "nobody@example.com" }).error, "wix_down", String(code)); }
  assert.equal(env.mails.length, 0); assert.equal(env.props.REG_NOTICKET, undefined, "גם לא נרשם בספר ההודעות");
  env.fail.wix = 0; delete env.props.WIX_API_KEY;
  assert.equal(env.call({ action: "regStart", email: "nobody@example.com" }).error, "not_configured"); assert.equal(env.mails.length, 0);
  env.props.WIX_API_KEY = "test-key"; env.advance(61 * 60000);                  // שעה חדשה: מכסת הכתובת (5 בשעה) מתאפסת
  const sent = ntRun(env, "nobody@example.com"); assert.equal(sent.length, 1, "Wix חזר: ההודעה יוצאת (לא נחסמה בגלל הניסיונות הקודמים)"); assert.equal(sent[0].subject, NOTICKET_SUBJECT);
});

test("הודעת 'לא נמצא כרטיס': לכל היותר אחת ב-24 שעות לכתובת (גם אחרי שהמטמון פג, ובלי רגישות לאותיות / רווחים) — ושוב אחרי החלון; הספר ב-Script Properties", () => {
  const env = ntNoTicketEnv(), N = () => notices(env).length;
  ntRun(env, "nobody@example.com"); assert.equal(N(), 1);
  assert.ok(ntLedger(env).length === 1, "נרשם ב-Script Properties (המטמון מוגבל ל-6 שעות)");
  assert.deepEqual(ntRun(env, "NOBODY@example.com "), [], "אותה כתובת (נורמלית) באותה שעה");
  env.advance(61 * 60000); assert.deepEqual(ntRun(env, "nobody@example.com"), []);
  env.advance(7 * HOUR); assert.deepEqual(ntRun(env, "nobody@example.com"), [], "אחרי 8 שעות — מעבר לחיי המטמון — עדיין לא");
  env.advance(15 * HOUR + 50 * 60000); assert.deepEqual(ntRun(env, "nobody@example.com"), [], "23 שעות ו-51 דקות מהראשונה");
  assert.equal(N(), 1);
  env.advance(11 * 60000); assert.equal(ntRun(env, "nobody@example.com").length, 1, "אחרי 24 שעות — שוב"); assert.equal(N(), 2);
  assert.equal(ntRun(env, "someone.else@example.com").length, 1, "כתובת אחרת לא הושפעה");
});

test("הודעת 'לא נמצא כרטיס': תקציב שעתי ויומי משלה (REG_NOTICKET_PER_HOUR / PER_DAY, חלון מתגלגל) — חריגה = דילוג בשקט באותה תשובה, ושעה/יממה חולפות משחררות", () => {
  const env = ntNoTicketEnv(); setCfg(env, "REG_NOTICKET_PER_HOUR", 3); setCfg(env, "REG_NOTICKET_PER_DAY", 5);
  const to = (...a) => a.map(x => x + "@example.com");
  const run = (...a) => a.flatMap(x => ntRun(env, x + "@example.com")).map(m => m.to);
  assert.deepEqual(run("a", "b", "c", "d", "e"), to("a", "b", "c"), "3 בשעה; השאר נדחו בשקט");
  env.advance(61 * 60000);
  assert.deepEqual(run("d", "e", "f"), to("d", "e"), "שעה חדשה: עוד שתיים עד תקרת היום (5); f נדחתה");
  env.advance(23 * HOUR);                                                      // 24 שעות ודקה מהשליחות הראשונות
  assert.deepEqual(run("f", "g", "h", "i"), to("f", "g", "h"), "היממה הראשונה חלפה (נשארו d, e): שלוש שוב עד תקרת השעה; i נדחתה");
  assert.equal(env.props.REG_MAILS, undefined, "ההודעות לא נספרו בתקציב מיילי ההרשמה"); assert.equal(env.mails.length, 8);
});

test("הודעת 'לא נמצא כרטיס': מיצוי התקציב שלה (גם 100 כתובות בלי כרטיס) לא חוסם קודי הרשמה ו'כבר קיים חשבון', ואינו צורך את תקציב הקודים (ובקשות 'עמוס' גורפות לא שולחות אותה)", () => {
  const { env } = calmWix(); pilotUser(env, "acct@example.com", "acct.user"); env.mails.length = 0; env.advance(61 * 60000);
  const codesBefore = JSON.parse(env.props.REG_MAILS).n;                       // הקוד של ההרשמה של acct
  for (let i = 0; i < 100; i++) regAns(env, "junk" + i + "@attacker.example");
  assert.equal(notices(env).length, 20, "REG_NOTICKET_PER_HOUR = 20");
  for (let i = 0; i < 100; i++) addOrder(env, { email: "pilot" + i + "@example.com" });
  for (let i = 0; i < 100; i++) assert.deepEqual(regAns(env, "pilot" + i + "@example.com"), { ok: true, sent: true });
  assert.equal(nonNotice(env).length, 100, "כל 100 הקודים יצאו"); assert.equal(JSON.parse(env.props.REG_MAILS).n, codesBefore + 100, "רק הקודים נספרו בתקציב ההרשמה");
  assert.deepEqual(ntRun(env, "acct@example.com").map(m => m.subject), ["כבר קיים חשבון לבקשות טיסה בכתובת הזו"], "'כבר קיים חשבון' עובדת");
  assert.equal(notices(env).length, 20, "ותקציב ההודעות עדיין מלא");
  // תקציב הקודים מלא: כל התשובות 'עמוס' לפני שאילתת Wix — ולכן גם לא נשלחת הודעה
  setCfg(env, "REG_MAILS_PER_HOUR", 0); const n = env.mails.length;
  assert.equal(regAns(env, "fresh@example.com").error, "rate"); assert.equal(env.mails.length, n);
});

test("הודעת 'לא נמצא כרטיס': מכבדת את MAIL_QUOTA_RESERVE — מתחת לרזרבת העותקים היא מדולגת בשקט (ולא נרשמת), וקודי הרשמה עדיין יוצאים", () => {
  const env = ntNoTicketEnv();
  env.mailQuota.left = 20;                                                     // 1 + רזרבה (20) = 21 נדרשים
  assert.deepEqual(ntRun(env, "nobody@example.com"), []); assert.equal(env.mailQuota.left, 20); assert.equal(env.props.REG_NOTICKET, undefined, "דילוג לפני הרישום");
  const [c] = ntRun(env, "holder@example.com"); assert.match(c.subject, /^קוד הרשמה/, "קוד כן (רזרבת הקודים 8)"); assert.equal(env.mailQuota.left, 19);
  env.mailQuota.left = 21; assert.equal(ntRun(env, "nobody@example.com").length, 1, "מעל הרזרבה — נשלחה (ולא נחסמה בגלל הניסיון שדולג)"); assert.equal(env.mailQuota.left, 20);
  env.mailQuota.left = 15; assert.deepEqual(ntRun(env, "someone@example.com"), []);
});

test("הודעת 'לא נמצא כרטיס': נרשמת רק אם יצאה — MailApp זורק = אותה תשובה, בלי רישום ובלי צריכת תקציב; ואם אי אפשר לרשום, לא שולחים (נכשל סגור)", () => {
  const env = ntNoTicketEnv(); setCfg(env, "REG_NOTICKET_PER_HOUR", 1);
  env.fail.mail = true; assert.deepEqual(ntRun(env, "a@example.com"), []); assert.equal(env.props.REG_NOTICKET, undefined, "הרישום שנכתב לפני השליחה חזר אחורה");
  env.fail.mail = false; assert.equal(ntRun(env, "a@example.com").length, 1, "הניסיון הכושל לא נחשב: לא תקציב ולא חותמת לכתובת");
  assert.deepEqual(ntRun(env, "b@example.com"), [], "התקציב (1) נצרך רק על מה שיצא");
  const ledger = env.props.REG_NOTICKET; setCfg(env, "REG_NOTICKET_PER_HOUR", 5);
  env.fail.mail = true; assert.deepEqual(ntRun(env, "c@example.com"), []); assert.equal(env.props.REG_NOTICKET, ledger, "הספר הקודם חזר כפי שהיה");
  env.fail.mail = false;
  const real = env.sandbox.PropertiesService.getScriptProperties;
  env.sandbox.PropertiesService.getScriptProperties = () => { const p = real(); return { ...p, setProperty: (k, v) => { if (k === "REG_NOTICKET") throw new Error("props full"); return p.setProperty(k, v); } }; };
  assert.deepEqual(ntRun(env, "d@example.com"), [], "הרישום נכשל — לא נשלח מייל שלא ניתן להגביל");
  env.sandbox.PropertiesService.getScriptProperties = real;
  assert.equal(ntRun(env, "d@example.com").length, 1);
});

test("הודעת 'לא נמצא כרטיס': הספר קטן ומגזים את עצמו — מאפיין אחד, גיבובים בלבד (בלי כתובות), בלי מאפיין לכל כתובת זבל, ישנים נשמטים, פגום מתעלמים, ותקרת 300 רשומות מתחת ל-9KB", () => {
  const env = ntNoTicketEnv();
  for (const n of "abc") ntRun(env, n + "@example.com");
  assert.equal(ntLedger(env).length, 3); for (const e of ntLedger(env)) assert.match(e, /^[0-9a-f]{10}:\d{10}$/);
  assert.ok(!/example|@/.test(env.props.REG_NOTICKET), "אין כתובות בספר");
  assert.deepEqual(Object.keys(env.props).filter(k => /^[MR]:/.test(k)), [], "לא נוצר M: / R: לכתובות בלי כרטיס");
  env.advance(25 * HOUR); ntRun(env, "d@example.com"); assert.equal(ntLedger(env).length, 1, "הישנות נגזמו");
  env.props.REG_NOTICKET = "not json"; assert.equal(ntRun(env, "e@example.com").length, 1); assert.equal(ntLedger(env).length, 1);
  env.props.REG_NOTICKET = JSON.stringify({ l: ["zz", 5, null, "0123456789:1"] }); assert.equal(ntRun(env, "f@example.com").length, 1); assert.equal(ntLedger(env).length, 1, "רשומות פגומות / ישנות נשמטות");
  setCfg(env, "REG_NOTICKET_PER_HOUR", 100000); setCfg(env, "REG_NOTICKET_PER_DAY", 100000);
  for (let i = 0; i < 310; i++) regAns(env, "bulk" + i + "@example.com");
  assert.equal(ntLedger(env).length, 300, "תקרת רשומות"); assert.ok(env.props.REG_NOTICKET.length < 9000, "מתחת לתקרת מאפיין בודד: " + env.props.REG_NOTICKET.length);
});

test("הודעת 'לא נמצא כרטיס': כתובת לא תקינה לא מקבלת דבר (ולא נשאלת ב-Wix); מכסת הכתובת לשעה חלה קודם — ההודעה יוצאת פעם אחת בלבד", () => {
  const env = ntNoTicketEnv();
  for (const bad of ["not-an-email", "a@b.com,c@d.com", "x@y.com\nbcc:z@w.com", "", "a b@c.com", "<a@b.com>", "a@b.com;c@d.com", "x".repeat(130) + "@example.com"]) assert.equal(env.call({ action: "regStart", email: bad }).error, "bad_email", bad.slice(0, 30));
  assert.equal(env.mails.length, 0); assert.equal(env.wix.calls.length, 0); assert.equal(env.props.REG_NOTICKET, undefined);
  const answers = Array.from({ length: 7 }, () => regAns(env, "nobody@example.com"));
  assert.deepEqual(answers.map(x => x.error || "ok"), ["ok", "ok", "ok", "ok", "ok", "rate", "rate"]);
  assert.equal(notices(env).length, 1); assert.equal(env.wix.calls.length, 5, "הבקשות שנדחו במכסת הכתובת לא שאלו את Wix");
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
  assert.ok(env.call({ action: "saveEnd", decl: DECL, token, folderId: b.folderId, ready: true }).ready);
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
  const end = env.call({ action: "saveEnd", decl: DECL, token, folderId: b.folderId, ready: true }); assert.deepEqual([end.ok, end.error], [false, "folder_full"]);
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


/* ===== הפרדה בין הארגון למטיסים עצמאיים: סוג חשבון (org), ניתוב מייל ושם שולח, יומן (kind), תיקיות דרייב, מכסות ===== */
const childrenOf = (env, id) => Object.values(env.folders).filter(f => f.parent === id && !f.trashed);
const pathOf = (env, id) => { const parts = []; for (let f = env.folders[id]; f && f.parent; f = env.folders[f.parent]) parts.unshift(f.name); return parts; };
const userRec = (env, name) => JSON.parse(env.props["U:" + name]);
const setOrg = (env, token, target, org) => env.call({ action: "setOrg", token, target, org });
// מטיס שנוצר ידנית בלי כתובת שמורה (addUser עם org:false) ונכנס
function manualPilot(env, token, name = "manual.pilot") {
  assert.ok(env.call({ action: "addUser", token, newUser: name, newPass: "manual-pass-123", org: false }).ok);
  const r = env.call({ action: "login", user: name, pass: "manual-pass-123" }); assert.ok(r.ok, JSON.stringify(r)); return r;
}

test("חשבון ארגוני × מצב × יעד: to/cc/bcc/replyTo/שם שולח/נושא — כתובת הארגון ב-cc גלוי (שליחה חיה), בלי BCC, השב-ל הארגון, ושם הארגון; גם כשנשלח fromName", () => {
  // מקרים: מנהל בלי כתובת שמורה; חשבון ארגוני עם כתובת שמורה שונה; חשבון ארגוני שכתובתו השמורה היא כתובת הארגון עצמה (בלי כפילות)
  const variants = [
    { who: "admin", stored: "", liveCc: [ORG], softTo: [ORG], softCc: [] },
    { who: "org-with-email", stored: "staff@example.com", liveCc: [ORG, "staff@example.com"], softTo: ["staff@example.com"], softCc: [ORG] },   // עובד ארגון עם כתובת משלו: הארגון מקבל עותק גם מבדיקה ומ"לעצמי"
    { who: "org-is-org-addr", stored: "Office@ICD.org.il", liveCc: [ORG], softTo: [ORG], softCc: [] },
  ];
  for (const v of variants) for (const [mode, target] of [["test", "office"], ["test", "self"], ["live", "office"], ["live", "self"]]) {
    const { env, token } = withWix(); if (mode === "live") goLive(env, token);
    let tok = token;
    if (v.stored) { const p = pilotUser(env, v.stored, "org.staff"); assert.ok(setOrg(env, token, "org.staff", true).ok); tok = p.token; }
    const b = savedRequest(env, tok, "אתר ארגוני — 01.03.2027");
    const r = sendTo(env, tok, b.folderId, { target, fromName: "משטרת ישראל" });
    const tag = v.who + " " + mode + " " + target;
    assert.ok(r.ok, tag + " " + JSON.stringify(r));
    const m = env.mails[env.mails.length - 1], live = mode === "live" && target === "office";
    assert.deepEqual(rcpts(m.to), live ? OFFICE : v.softTo, tag + " to");
    assert.deepEqual(rcpts(m.cc), live ? v.liveCc : v.softCc, tag + " cc");
    assert.equal(m.bcc, undefined, tag + ": חשבון ארגוני — אין BCC");
    assert.equal(m.replyTo, ORG, tag + ": השב-ל הארגון");
    assert.equal(m.name, ORG_NAME, tag + ": שם הארגון, fromName מתעלמים");
    assert.equal(m.subject, (target === "self" ? SELF_PREFIX : mode === "test" ? TEST_PREFIX : "") + "בקשה — נושא", tag);
    const all = [...rcpts(m.to), ...rcpts(m.cc)].map(x => x.toLowerCase());
    assert.equal(new Set(all).size, all.length, tag + ": כתובת כפולה");
    // חשבון ארגוני רואה את הכתובות בתשובה (כולל כתובת הארגון)
    assert.deepEqual(r.to, rcpts(m.to)); assert.deepEqual(r.cc, rcpts(m.cc)); assert.equal(r.from, ORG_NAME);
    assert.equal(r.adminCopy, all.includes(ORG), tag + " adminCopy");
    const mark = env.folders[b.folderId].files.find(f => /^נשלח — /.test(f.name)).bytes.toString();
    assert.match(mark, /סוג חשבון: ארגוני/); assert.match(mark, new RegExp("שם השולח: " + ORG_NAME)); assert.match(mark, /עותק סמוי לארגון: לא/);
  }
});

test("שם השולח של מטיס עצמאי: fromName מנוקה ועם סיומת קבועה; ניסיון התחזות, כיווניות, <script>, שורה חדשה, ארוך מדי; חסר => displayName => 'מטיס'", () => {
  const { env, token } = withWix(); goLive(env, token);
  vm.runInContext("CFG.MAX_OFFICE_PER_HOUR = 1000; CFG.MAX_COPIES_PER_HOUR = 1000; CFG.MAX_SEND_ATTEMPTS_PER_HOUR = 1000; CFG.MAX_NEW_FOLDERS_PER_HOUR = 1000; CFG.MAX_OPEN_REQUESTS_PER_USER = 1000", env.sandbox);
  const pilot = pilotUser(env);
  const fc = String.fromCharCode;
  const sendAs = (fromName, tag) => {
    const r = sendTo(env, pilot.token, savedRequest(env, pilot.token, "שולח " + tag + " — 02.03.2027").folderId, { fromName, again: true });
    assert.ok(r.ok, tag + " " + JSON.stringify(r));
    return env.mails[env.mails.length - 1];
  };
  const cases = [
    ["חברת רחפנים בע״מ", "חברת רחפנים בע״מ"],                                   // שם רגיל נשמר כמות שהוא
    ["  משטרת   ישראל  ", "משטרת ישראל"],                                         // התחזות: מותר לכתוב, אבל הסיומת הקבועה מבהירה שזו לא הרשות
    ["רשות שדות התעופה", "רשות שדות התעופה"],
    ["<script>alert(1)</script>", "script alert(1) /script"],                    // <> מוסרים
    ['שם "מצוטט" ו\\עוד', "שם מצוטט ו עוד"],                                       // מירכאות ולוכסן הפוך מוסרים
    ["שורה א\r\nBcc: evil@example.com\nשורה ב", "שורה א Bcc: evil example.com שורה ב"],   // הזרקת כותרת: שורות חדשות נאכלות, וגם @ (שם תצוגה שנראה ככתובת)
    [fc(0x202e) + "חברה" + fc(0x200f) + "בע״מ" + fc(0x2066) + fc(0x0) + fc(0x85) + fc(0x2028), "חברה בע״מ"],     // כיווניות/בקרה/NEL/מפריד שורה
    ["א".repeat(100), "א".repeat(60)],                                           // ארוך מדי: נחתך ל-60
    ["א".repeat(59) + "😀", "א".repeat(59)],                                      // חיתוך לא שובר זוג חלופי
  ];
  for (const [input, want] of cases) {
    const m = sendAs(input, input.length + ":" + input.slice(0, 6));
    assert.equal(m.name, want + SENDER_SUFFIX, JSON.stringify(input));
    assert.ok(!/[\r\n<>"@\\]/.test(m.name) && !new RegExp("[" + fc(0x202a) + "-" + fc(0x202e) + fc(0x2066) + "-" + fc(0x2069) + fc(0x200b) + "-" + fc(0x200f) + fc(0x2028) + fc(0x2029) + fc(0x85) + fc(0) + "]").test(m.name), "תווים אסורים בשם: " + JSON.stringify(m.name));
    assert.equal(m.replyTo, "pilot@example.com"); assert.equal(m.bcc, ORG);
    assert.equal(m.subject, "בקשה — נושא", "fromName לא משפיע על הנושא והגוף"); assert.equal(m.body, "גוף");
  }
  // חסר / ריק / כולו תווים אסורים / לא מחרוזת => displayName שנשמר מ-Wix ("דנה")
  for (const missing of [undefined, null, "", "   ", "<>", fc(0x202e) + fc(0x200f), 5, true, ["x"], { a: 1 }])
    assert.equal(sendAs(missing, "missing" + String(typeof missing)).name, "דנה" + SENDER_SUFFIX, JSON.stringify(missing));
  // ואם גם displayName חסר => "מטיס"
  const rec = userRec(env, "dana.pilot"); delete rec.displayName; env.props["U:dana.pilot"] = JSON.stringify(rec);
  assert.equal(sendAs(undefined, "nodisp").name, "מטיס" + SENDER_SUFFIX);
  assert.equal(sendAs("  ", "nodisp2").name, "מטיס" + SENDER_SUFFIX);
  assert.equal(sendAs("גוף אמיתי", "real").name, "גוף אמיתי" + SENDER_SUFFIX);
  // displayName עצמו מנוקה באותו אופן (נשמר מ-Wix, בלי שליטה של המטיס, אבל לא נסמך עליו)
  rec.displayName = "<b>דנה</b>\n@x"; env.props["U:dana.pilot"] = JSON.stringify(rec);
  assert.equal(sendAs(undefined, "dirtydisp").name, "b דנה /b x" + SENDER_SUFFIX);
  // בכל מצב ויעד: אותו שם; והשם נשלח גם בשליחה לעצמו ובמצב בדיקה
  env.call({ action: "setMailMode", token, mode: "test" });
  for (const target of ["office", "self"]) {
    const r = sendTo(env, pilot.token, savedRequest(env, pilot.token, "שולח יעד " + target + " — 03.03.2027").folderId, { target, fromName: "גוף " + target });
    assert.equal(r.from, "גוף " + target + SENDER_SUFFIX); assert.equal(env.mails[env.mails.length - 1].name, "גוף " + target + SENDER_SUFFIX);
  }
  // ביומן נרשם גם שם השולח (למנהל, לבירור שימוש לרעה)
  const sent = logOf(env).flatMap(e => e.sent || []);
  assert.ok(sent.some(s => s.from === "משטרת ישראל" + SENDER_SUFFIX), "שם השולח מתועד ברשומת השליחה");
});

test("מיילי מערכת (קוד הרשמה, תזכורת, 'כבר קיים חשבון') נשלחים בשם הארגון עם השב-ל כתובת הארגון — לא כתובת הבעלים", () => {
  const { env } = withWix(); addOrder(env);
  assert.ok(env.call({ action: "regStart", email: "pilot@example.com" }).ok);
  let m = env.mails[env.mails.length - 1];
  assert.equal(m.name, ORG_NAME); assert.equal(m.replyTo, ORG); assert.ok(!JSON.stringify(m).includes(OWNER));
  const r = env.call({ action: "regFinish", email: "pilot@example.com", code: codeFrom(env), user: "dana.pilot", pass: "dana-pass-1234" });
  assert.ok(r.ok);
  env.advance(25 * HOUR);
  assert.ok(env.call({ action: "regStart", email: "pilot@example.com" }).ok);      // כבר קיים חשבון
  m = env.mails[env.mails.length - 1];
  assert.match(m.subject, /כבר קיים חשבון/); assert.equal(m.name, ORG_NAME); assert.equal(m.replyTo, ORG); assert.ok(m.body.includes("info@icd.org.il") && !m.body.includes(ORG) && !m.body.includes(OWNER), "הודעת 'כבר קיים חשבון' מפנה לכתובת התמיכה ולא לכתובת הארגון או הבעלים");
  const u = userRec(env, "dana.pilot"); u.until = env.now() + 20 * DAY; env.props["U:dana.pilot"] = JSON.stringify(u);
  env.mails.length = 0; env.run("dailyCheck");
  assert.equal(env.mails.length, 1); assert.equal(env.mails[0].name, ORG_NAME); assert.equal(env.mails[0].replyTo, ORG);
});

test("בלי דליפה של כתובת הארגון למטיס עצמאי: לא בשום תשובה, לא בקובץ הסימון, לא בנושא ובגוף; המייל הסמוי בלבד מגיע אליה", () => {
  const { env, token } = withWix();
  const reg = pilotUser(env);
  const seen = [JSON.stringify(reg)];
  const call = o => { const r = env.call(Object.assign({ token: reg.token }, o)); seen.push(JSON.stringify(r)); return r; };
  call({ action: "me" }); call({ action: "listUsers" }); call({ action: "listRequests" }); call({ action: "setOrg", target: "dana.pilot", org: true }); call({ action: "setMailMode", mode: "live" });
  call({ action: "addUser", newUser: "x.y.z", newPass: "xyz-pass-123456", org: true });
  seen.push(JSON.stringify(env.call({ action: "login", user: "dana.pilot", pass: "dana-pass-1234" })));
  for (const mode of ["test", "live"]) {
    if (mode === "live") goLive(env, token);
    for (const target of ["office", "self"]) {
      const b = savedRequest(env, reg.token, "דליפה " + mode + target + " — 04.03.2027"); seen.push(JSON.stringify(b));
      const r = sendTo(env, reg.token, b.folderId, { target, fromName: "מטיס פרטי" }); seen.push(JSON.stringify(r)); assert.ok(r.ok, JSON.stringify(r));
      assert.ok(!env.folders[b.folderId].files.some(f => /^נשלח — /.test(f.name) && f.bytes.toString().includes(ORG)), "קובץ הסימון");
      const m = env.mails[env.mails.length - 1];
      assert.deepEqual(rcpts(m.bcc), [ORG], "העותק הסמוי כן מגיע לארגון");
      for (const k of ["to", "cc", "replyTo", "name", "subject", "body"]) assert.ok(!String(m[k] || "").includes(ORG), k);
    }
  }
  seen.push(JSON.stringify(call({ action: "sendRequest", folderId: "nope", subject: "נ", body: "ג", expectMode: "test" })));
  seen.push(JSON.stringify(call({ action: "changePassword", oldPass: "dana-pass-1234", newPass: "dana-new-pass-5678" })));
  assert.ok(!seen.join("\n").includes(ORG), "כתובת הארגון נחשפה למטיס");
  assert.ok(!seen.join("\n").includes(OWNER));
});

test("מטיס עצמאי שנוצר ידנית בלי כתובת שמורה: copyTo ריק (הארגון לא נחשף), והמייל יוצא לכתובת הארגון בלבד (בלי כפילות) ובלי חשיפה בתשובה ובסימון", () => {
  const { env, token } = bootstrapped(); goLive(env, token);
  const m1 = manualPilot(env, token);
  assert.deepEqual([m1.email, m1.copyTo, m1.copyToIsOwner, m1.org, m1.adv], ["", "", false, false, false]); assert.deepEqual(m1.features, FEATURES);
  assert.ok(!JSON.stringify(m1).includes(ORG));
  for (const target of ["office", "self"]) {
    const b = savedRequest(env, m1.token, "ידני " + target + " — 05.03.2027");
    const r = sendTo(env, m1.token, b.folderId, { target });
    assert.ok(r.ok, JSON.stringify(r));
    const m = env.mails[env.mails.length - 1];
    assert.deepEqual(rcpts(m.to), target === "office" ? OFFICE : [ORG]); assert.deepEqual(rcpts(m.cc), target === "office" ? [ORG] : []);
    assert.equal(m.bcc, undefined, "הארגון כבר נמען גלוי"); assert.equal(m.replyTo, ORG); assert.equal(m.name, "מטיס" + SENDER_SUFFIX);
    assert.ok(!JSON.stringify(r).includes(ORG), "תשובה: " + JSON.stringify(r)); assert.deepEqual(r.cc, []);
    assert.ok(!env.folders[b.folderId].files.find(f => /^נשלח — /.test(f.name)).bytes.toString().includes(ORG));
  }
});

test("setOrg: מנהל בלבד; מנהל אינו ניתן להורדה; ערך בוליאני בלבד; משתמש לא קיים; משנה ניתוב ושם שולח בלי לבטל אסימונים; listUsers/me מדווחים org", () => {
  const { env, token } = withWix(); goLive(env, token);
  const pilot = pilotUser(env);
  const row = () => env.call({ action: "listUsers", token }).users.find(x => x.user === "dana.pilot");
  assert.equal(row().org, false); assert.equal(userRec(env, "dana.pilot").org, false, "regFinish: org=false שמור");
  // הרשאות
  assert.equal(setOrg(env, pilot.token, "dana.pilot", true).error, "forbidden");
  assert.equal(env.call({ action: "setOrg", target: "dana.pilot", org: true }).ok, false);
  assert.equal(setOrg(env, "bad", "dana.pilot", true).ok, false);
  assert.equal(row().org, false, "ניסיונות לא מורשים לא שינו דבר");
  // קלט
  assert.equal(setOrg(env, token, "nobody", true).error, "no_user");
  for (const bad of [undefined, null, "true", "false", 1, 0, [], {}]) assert.equal(setOrg(env, token, "dana.pilot", bad).error, "bad_org", JSON.stringify(bad));
  assert.equal(row().org, false);
  // מנהל אינו ניתן להורדה (גם לא הוא עצמו), ונשאר ארגוני
  for (const target of ["itzik"]) { const r = setOrg(env, token, target, false); assert.deepEqual([r.ok, r.error], [false, "is_admin"]); }
  env.call({ action: "addUser", token, newUser: "second.admin", newPass: "admin-pass-12345", role: "admin" });
  assert.equal(setOrg(env, token, "second.admin", false).error, "is_admin");
  assert.equal(setOrg(env, token, "second.admin", true).error, "is_admin", "גם true נדחה: מנהל אינו ניתן לשינוי");
  assert.equal(env.call({ action: "me", token }).org, true);
  // עצמאי -> ארגוני: האסימון הקיים ממשיך לעבוד, הניתוב והשם משתנים, ו-me/listUsers מדווחים
  const b = savedRequest(env, pilot.token, "הסבה — 06.03.2027");
  assert.ok(sendTo(env, pilot.token, b.folderId).ok);
  let m = env.mails[env.mails.length - 1];
  assert.deepEqual([m.cc, m.bcc, m.replyTo, m.name], ["pilot@example.com", ORG, "pilot@example.com", "דנה" + SENDER_SUFFIX]);
  const set = setOrg(env, token, "dana.pilot", true);
  assert.deepEqual([set.ok, set.org], [true, true]);
  assert.equal(row().org, true); assert.equal(env.call({ action: "me", token: pilot.token }).org, true, "האסימון הקיים תקף");
  assert.equal(env.call({ action: "me", token: pilot.token }).copyTo, "pilot@example.com");
  assert.ok(sendTo(env, pilot.token, b.folderId, { again: true, fromName: "מתחזה" }).ok);
  m = env.mails[env.mails.length - 1];
  assert.deepEqual([rcpts(m.cc), m.bcc, m.replyTo, m.name], [[ORG, "pilot@example.com"], undefined, ORG, ORG_NAME]);
  // חידוש מנוי לא מחזיר אותו לעצמאי
  addOrder(env, { email: "pilot@example.com", created: iso(env.now() - DAY) });
  assert.ok(env.call({ action: "regStart", email: "pilot@example.com" }).ok);
  assert.ok(env.call({ action: "regFinish", email: "pilot@example.com", code: codeFrom(env) }).renewed);
  assert.equal(userRec(env, "dana.pilot").org, true);
  // ארגוני -> עצמאי: חוזר לניתוב של מטיס
  assert.ok(setOrg(env, token, "dana.pilot", false).ok);
  assert.ok(sendTo(env, pilot.token, b.folderId, { again: true }).ok);
  m = env.mails[env.mails.length - 1]; assert.deepEqual([m.bcc, m.replyTo], [ORG, "pilot@example.com"]);
  // משתמש חסום אפשר לסווג מחדש; הסוג לא נוגע בחסימה
  assert.ok(env.call({ action: "setBlocked", token, target: "dana.pilot", blocked: true }).ok);
  assert.ok(setOrg(env, token, "dana.pilot", true).ok); assert.equal(userRec(env, "dana.pilot").blocked, true);
});

/* ===== תצוגה מתקדמת (adv): הרשאה אישית לכל משתמש, נפרדת מסוג החשבון. בפועל: מנהל תמיד כן; אחרת הערך הבוליאני השמור; בלי ערך — לפי הסוג (ארגוני כן, עצמאי לא) ===== */
const setAdv = (env, token, target, adv) => env.call({ action: "setAdv", token, target, adv });
const rowOf = (env, token, name) => env.call({ action: "listUsers", token }).users.find(x => x.user === name);
const writeRec = (env, name, rec) => { env.props["U:" + name] = JSON.stringify(rec); };

test("adv: מטריצת הערך בפועל — מנהל / ארגוני / עצמאי × לא הוכרע / true / false / ערך משובש — בכניסה, ב-me, בהחלפת סיסמה וב-listUsers (advExplicit = ההכרעה השמורה או null)", () => {
  const { env, token } = bootstrapped();
  const stores = [undefined, true, false, "true", 1, null];     // לא-בוליאני ברשומה = לא הוכרע
  let n = 0;
  for (const kind of ["admin", "org", "pilot"]) for (const stored of stores) {
    const name = "adv.user." + (++n);
    const req = { action: "addUser", token, newUser: name, newPass: "some-pass-12345", role: kind === "admin" ? "admin" : "user" };
    if (kind === "pilot") req.org = false;
    assert.ok(env.call(req).ok);
    if (stored !== undefined) { const rec = userRec(env, name); rec.adv = stored; writeRec(env, name, rec); }
    const want = kind === "admin" ? true : (typeof stored === "boolean" ? stored : kind === "org"), what = `${kind} / ${JSON.stringify(stored)}`;
    const lg = env.call({ action: "login", user: name, pass: "some-pass-12345" });
    assert.ok(lg.ok, what); assert.strictEqual(lg.adv, want, "login " + what); assert.ok(lg.features.includes("advView"), what);
    assert.strictEqual(env.call({ action: "me", token: lg.token }).adv, want, "me " + what);
    const row = rowOf(env, token, name);
    assert.strictEqual(row.adv, want, "listUsers " + what);
    assert.strictEqual(row.advExplicit, kind !== "admin" && typeof stored === "boolean" ? stored : null, "advExplicit " + what);
    const cp = env.call({ action: "changePassword", token: lg.token, oldPass: "some-pass-12345", newPass: "other-pass-12345" });
    assert.strictEqual(cp.adv, want, "changePassword " + what);
  }
  assert.equal(n, 18);
  // המנהל שהוקם ב-bootstrap, ומשתמש ישן בלי השדה adv (כמו בכל רשומה שנוצרה לפני העדכון): ברירת מחדל לפי הסוג
  assert.strictEqual(env.call({ action: "login", user: "itzik", pass: PASS }).adv, true);
  assert.deepEqual([rowOf(env, token, "itzik").adv, rowOf(env, token, "itzik").advExplicit], [true, null]);
  assert.ok(!("adv" in userRec(env, "itzik")), "הקמת מנהל לא כותבת adv");
});

test("setAdv: מנהל בלבד; ערך בוליאני בלבד; משתמש לא קיים; מנהל אינו ניתן לשינוי; מטיס שנרשם לבד מקבל ומאבד תצוגה מתקדמת; לא מבטל אסימונים; נשמר בכניסה, בהחלפת סיסמה ובחידוש מנוי; setOrg לא נוגע בהכרעה", () => {
  const { env, token } = withWix();
  const pilot = pilotUser(env);
  assert.strictEqual(pilot.adv, false, "regFinish: מי שנרשם לבד — בלי תצוגה מתקדמת כברירת מחדל");
  assert.ok(!("adv" in userRec(env, "dana.pilot")), "ההרשמה לא כותבת adv: ההכרעה היא של המנהל בלבד");
  const row = () => rowOf(env, token, "dana.pilot"), me = () => env.call({ action: "me", token: pilot.token });
  assert.deepEqual([row().adv, row().advExplicit, row().org], [false, null, false]);
  // הרשאות: מטיס (גם על עצמו), עובד ארגוני (גם על עצמו), בלי אסימון, אסימון שגוי
  assert.ok(env.call({ action: "addUser", token, newUser: "org.staff", newPass: "staff-pass-12345" }).ok);
  const staff = env.call({ action: "login", user: "org.staff", pass: "staff-pass-12345" });
  assert.strictEqual(staff.adv, true);
  assert.equal(setAdv(env, pilot.token, "dana.pilot", true).error, "forbidden");
  assert.equal(setAdv(env, pilot.token, "org.staff", false).error, "forbidden");
  assert.equal(setAdv(env, staff.token, "org.staff", false).error, "forbidden");
  assert.equal(setAdv(env, staff.token, "dana.pilot", true).error, "forbidden");
  assert.equal(env.call({ action: "setAdv", target: "dana.pilot", adv: true }).ok, false);
  assert.equal(setAdv(env, "bad", "dana.pilot", true).ok, false);
  assert.ok(!("adv" in userRec(env, "dana.pilot")) && !("adv" in userRec(env, "org.staff")), "ניסיונות לא מורשים לא שינו דבר");
  assert.strictEqual(me().adv, false); assert.strictEqual(env.call({ action: "me", token: staff.token }).adv, true);
  // קלט
  assert.equal(setAdv(env, token, "nobody", true).error, "no_user");
  assert.equal(setAdv(env, token, undefined, true).error, "no_user");
  for (const bad of [undefined, null, "true", "false", 1, 0, [], {}]) assert.equal(setAdv(env, token, "dana.pilot", bad).error, "bad_adv", JSON.stringify(bad));
  assert.ok(!("adv" in userRec(env, "dana.pilot")), "ערך לא בוליאני לא נשמר");
  // מנהל אינו ניתן לשינוי (גם לא הוא עצמו, ובשני הכיוונים) ונשאר עם תצוגה מתקדמת
  assert.ok(env.call({ action: "addUser", token, newUser: "second.admin", newPass: "admin-pass-12345", role: "admin" }).ok);
  for (const target of ["itzik", "second.admin"]) for (const v of [true, false]) {
    const r = setAdv(env, token, target, v); assert.deepEqual([r.ok, r.error], [false, "is_admin"], target + " " + v);
    assert.ok(!("adv" in userRec(env, target)), target + ": לא נכתב adv");
  }
  assert.strictEqual(env.call({ action: "me", token }).adv, true);
  // מטיס שנרשם לבד: הפעלה — האסימון הקיים ממשיך לעבוד (הרשומה לא עברה tv), סוג החשבון לא משתנה, וכל התשובות מדווחות
  const tv = userRec(env, "dana.pilot").tv;
  const on = setAdv(env, token, "dana.pilot", true);
  assert.deepEqual([on.ok, on.adv], [true, true]);
  assert.strictEqual(userRec(env, "dana.pilot").adv, true); assert.equal(userRec(env, "dana.pilot").tv, tv, "setAdv לא מבטל אסימונים");
  assert.equal(userRec(env, "dana.pilot").org, false, "ההרשאה לא משנה את סוג החשבון");
  let m = me(); assert.ok(m.ok, "האסימון הקיים תקף"); assert.deepEqual([m.adv, m.org], [true, false]);
  assert.deepEqual([row().adv, row().advExplicit, row().org], [true, true, false]);
  // כיבוי: אותו אסימון, מיד
  const off = setAdv(env, token, "dana.pilot", false);
  assert.deepEqual([off.ok, off.adv], [true, false]);
  assert.deepEqual([me().adv, row().adv, row().advExplicit], [false, false, false], "הכרעה מפורשת לכבות");
  // setOrg לא נוגע בהכרעה המפורשת (בשני הכיוונים), גם כשהיא מנוגדת לברירת המחדל של הסוג החדש
  assert.ok(setOrg(env, token, "dana.pilot", true).ok); assert.deepEqual([me().adv, me().org, row().advExplicit], [false, true, false], "ארגוני שהמנהל כיבה לו — נשאר מכובה");
  assert.ok(setAdv(env, token, "dana.pilot", true).ok); assert.ok(setOrg(env, token, "dana.pilot", false).ok);
  assert.deepEqual([me().adv, me().org, row().advExplicit], [true, false, true], "עצמאי שהמנהל הפעיל לו — נשאר מופעל");
  // בכניסה חוזרת, בהחלפת סיסמה ובחידוש מנוי ההכרעה נשמרת
  const lg = env.call({ action: "login", user: "dana.pilot", pass: "dana-pass-1234" }); assert.strictEqual(lg.adv, true);
  const cp = env.call({ action: "changePassword", token: lg.token, oldPass: "dana-pass-1234", newPass: "dana-new-pass-5678" }); assert.strictEqual(cp.adv, true);
  addOrder(env, { email: "pilot@example.com", created: iso(env.now() - DAY) });
  assert.ok(env.call({ action: "regStart", email: "pilot@example.com" }).ok);
  assert.ok(env.call({ action: "regFinish", email: "pilot@example.com", code: codeFrom(env) }).renewed);
  assert.strictEqual(userRec(env, "dana.pilot").adv, true, "חידוש מנוי לא מאפס את ההכרעה");
  assert.strictEqual(env.call({ action: "login", user: "dana.pilot", pass: "dana-new-pass-5678" }).adv, true);
  // משתמש חסום אפשר להכריע לגביו; החסימה לא משתנה
  assert.ok(env.call({ action: "setBlocked", token, target: "dana.pilot", blocked: true }).ok);
  assert.ok(setAdv(env, token, "dana.pilot", false).ok); assert.equal(userRec(env, "dana.pilot").blocked, true);
  // עובד ארגוני: כיבוי אישי; הסוג נשאר ארגוני (שליחה בשם הארגון) והאסימון תקף
  const so = setAdv(env, token, "org.staff", false);
  assert.deepEqual([so.ok, so.adv], [true, false]);
  const sm = env.call({ action: "me", token: staff.token }); assert.deepEqual([sm.ok, sm.adv, sm.org], [true, false, true]);
  assert.deepEqual([rowOf(env, token, "org.staff").adv, rowOf(env, token, "org.staff").advExplicit], [false, false]);
  // ללא הכרעה — ברירת המחדל עוקבת אחרי הסוג (setOrg)
  assert.ok(env.call({ action: "addUser", token, newUser: "flip.user", newPass: "some-pass-12345" }).ok);
  const fl = env.call({ action: "login", user: "flip.user", pass: "some-pass-12345" }); assert.strictEqual(fl.adv, true);
  assert.ok(setOrg(env, token, "flip.user", false).ok); assert.deepEqual([env.call({ action: "me", token: fl.token }).adv, rowOf(env, token, "flip.user").advExplicit], [false, null]);
  assert.ok(setOrg(env, token, "flip.user", true).ok); assert.strictEqual(env.call({ action: "me", token: fl.token }).adv, true);
});

test("adv: לא חושף דבר על משתמשים אחרים — משתמש רגיל מקבל רק את הדגל של עצמו; listUsers/setAdv חסומים לו; הכרעה על אחר לא משנה את תשובותיו", () => {
  const { env, token } = withWix();
  const pilot = pilotUser(env);
  assert.ok(env.call({ action: "addUser", token, newUser: "org.staff", newPass: "staff-pass-12345" }).ok);
  const seen = [JSON.stringify(pilot)];
  const call = o => { const r = env.call(Object.assign({ token: pilot.token }, o)); seen.push(JSON.stringify(r)); return r; };
  const meBefore = call({ action: "me" });
  assert.strictEqual(meBefore.adv, false);
  const lu = call({ action: "listUsers" }); assert.deepEqual([lu.ok, lu.error], [false, "forbidden"]); assert.ok(!("users" in lu));
  call({ action: "listRequests" }); call({ action: "setAdv", target: "org.staff", adv: false }); call({ action: "setAdv", target: "dana.pilot", adv: true });
  assert.ok(setAdv(env, token, "org.staff", false).ok);       // החלטת מנהל על אחר
  const meAfter = call({ action: "me" });
  assert.deepEqual(meAfter, meBefore, "ההכרעה על משתמש אחר לא משנה את תשובת המטיס");
  seen.push(JSON.stringify(env.call({ action: "login", user: "dana.pilot", pass: "dana-pass-1234" })));
  const all = seen.join("\n");
  assert.ok(!all.includes("advExplicit"), "advExplicit הוא של המנהל בלבד");
  assert.ok(!all.includes("org.staff") && !all.includes("itzik"), "שמות משתמשים אחרים לא נחשפים");
  assert.ok(!all.includes(ORG) && !all.includes(OWNER));
  // למנהל כן: השורות נושאות adv ו-advExplicit לכל משתמש
  const rows = env.call({ action: "listUsers", token }).users;
  assert.ok(rows.every(x => typeof x.adv === "boolean" && (x.advExplicit === null || typeof x.advExplicit === "boolean")), JSON.stringify(rows));
  assert.deepEqual(rows.map(x => [x.user, x.adv, x.advExplicit]), [["dana.pilot", false, null], ["itzik", true, null], ["org.staff", false, false]]);
});

test("addUser: org ברירת מחדל true (ארגוני), org:false = מטיס עצמאי, מנהל תמיד ארגוני, ערך לא בוליאני נדחה; משתמשים קיימים בלי שדה: admin => ארגוני, אחרת עצמאי", () => {
  const { env, token } = bootstrapped();
  const add = (name, extra) => env.call({ action: "addUser", token, newUser: name, newPass: "some-pass-12345", ...extra });
  assert.ok(add("def.user").ok); assert.ok(add("pil.user", { org: false }).ok); assert.ok(add("org.user", { org: true }).ok);
  assert.ok(add("adm.one", { role: "admin" }).ok); assert.ok(add("adm.two", { role: "admin", org: false }).ok);
  assert.deepEqual(["def.user", "pil.user", "org.user", "adm.one", "adm.two"].map(n => userRec(env, n).org), [true, false, true, true, true]);
  for (const bad of ["false", "true", 0, 1, [], {}]) assert.equal(add("bad" + String(typeof bad) + JSON.stringify(bad).length, { org: bad }).error, "bad_org", JSON.stringify(bad));
  assert.equal(add("null.org", { org: null }).ok, true, "null = לא צוין => ברירת מחדל"); assert.equal(userRec(env, "null.org").org, true);
  const lu = env.call({ action: "listUsers", token }).users, orgOf = n => lu.find(u => u.user === n).org;
  assert.deepEqual(["def.user", "pil.user", "org.user", "adm.one", "adm.two", "itzik"].map(orgOf), [true, false, true, true, true, true]);
  assert.equal(userRec(env, "itzik").org, true, "מנהל שהוקם ב-bootstrap");
  // רשומות ישנות בלי שדה org
  for (const n of ["def.user", "pil.user", "adm.two", "itzik"]) { const r = userRec(env, n); delete r.org; env.props["U:" + n] = JSON.stringify(r); }
  const lu2 = env.call({ action: "listUsers", token }).users, org2 = n => lu2.find(u => u.user === n).org;
  assert.deepEqual(["def.user", "pil.user", "adm.two", "itzik"].map(org2), [false, false, true, true], "בלי שדה: role admin => ארגוני, אחרת עצמאי");
  assert.equal(env.call({ action: "login", user: "pil.user", pass: "some-pass-12345" }).org, false);
  assert.equal(env.call({ action: "login", user: "itzik", pass: PASS }).org, true);
  // ערך משובש ברשומה (למשל מחרוזת) אינו נחשב ארגוני, ומנהל נשאר ארגוני גם אם הרשומה נערכה ל-false
  const r1 = userRec(env, "def.user"); r1.org = "true"; env.props["U:def.user"] = JSON.stringify(r1);
  const r2 = userRec(env, "adm.one"); r2.org = false; env.props["U:adm.one"] = JSON.stringify(r2);
  const lu3 = env.call({ action: "listUsers", token }).users;
  assert.equal(lu3.find(u => u.user === "def.user").org, false); assert.equal(lu3.find(u => u.user === "adm.one").org, true);
});

test("יומן: כל בקשה נושאת kind לפי סוג החשבון ברגע saveBegin ('org'|'pilot'); listRequests מחזיר kind (ומסנן לפיו); ישנה בלי kind = ארגונית; הסוג נשאר גם אחרי setOrg", () => {
  const { env, token } = withWix(); goLive(env, token);
  const pilot = pilotUser(env);
  const ra = savedRequest(env, token, "ארגוני — 07.03.2027"), rp = savedRequest(env, pilot.token, "עצמאי — 07.03.2027");
  let log = logOf(env);
  assert.equal(log.find(e => e.id === ra.folderId).kind, "org"); assert.equal(log.find(e => e.id === rp.folderId).kind, "pilot");
  const rows = () => env.call({ action: "listRequests", token }).requests;
  assert.deepEqual(rows().map(x => [x.name, x.kind]).sort(), [["ארגוני — 07.03.2027", "org"], ["עצמאי — 07.03.2027", "pilot"]]);
  assert.deepEqual(env.call({ action: "listRequests", token, kind: "pilot" }).requests.map(x => x.name), ["עצמאי — 07.03.2027"]);
  assert.deepEqual(env.call({ action: "listRequests", token, kind: "org" }).requests.map(x => x.name), ["ארגוני — 07.03.2027"]);
  assert.equal(env.call({ action: "listRequests", token, kind: "other" }).requests.length, 2, "kind לא מוכר = בלי סינון");
  assert.equal(env.call({ action: "listRequests", token: pilot.token }).error, "forbidden", "רק מנהל רואה את היומן");
  // שמירה חוזרת (גם בידי מנהל, בתמיכה) לא משנה את הסוג; הסבה לארגוני לא משנה בקשות קיימות
  const again = env.call({ action: "saveBegin", token, folderName: "עצמאי — 07.03.2027", rid: rp.rid });
  assert.ok(again.ok); assert.equal(again.folderId, rp.folderId);
  assert.ok(setOrg(env, token, "dana.pilot", true).ok);
  const rp2 = savedRequest(env, pilot.token, "אחרי הסבה — 07.03.2027");
  assert.equal(rows().find(x => x.name === "עצמאי — 07.03.2027").kind, "pilot");
  assert.equal(rows().find(x => x.name === "אחרי הסבה — 07.03.2027").kind, "org", "בקשה חדשה אחרי ההסבה היא ארגונית");
  assert.deepEqual(pathOf(env, rp2.folderId), ["הארגון", "אחרי הסבה — 07.03.2027"]);
  // רשומה ישנה בלי kind
  log = logOf(env); delete log.find(e => e.id === rp.folderId).kind;
  env.folders.ROOT.files.find(f => f.name === "_יומן בקשות.json").bytes = Buffer.from(JSON.stringify(log));
  assert.equal(rows().find(x => x.name === "עצמאי — 07.03.2027").kind, "org", "בלי kind נחשבת ארגונית");
});

test("listUsers: סיכומים נפרדים לפי סוג בקשה (totals.org / totals.pilot) — בקשות ושליחות חיות; org לכל משתמש", () => {
  const { env, token } = withWix(); goLive(env, token);
  const pa = pilotUser(env, "a@example.com", "pilot.a"), pb = pilotUser(env, "b@example.com", "pilot.b");
  const orgReqs = ["א", "ב", "ג"].map(x => savedRequest(env, token, "ארגון " + x + " — 08.03.2027"));
  const pilotReqs = [[pa, "א"], [pa, "ב"], [pb, "ג"], [pb, "ד"], [pb, "ה"]].map(([p, x]) => savedRequest(env, p.token, "מטיס " + x + " — 08.03.2027"));
  assert.ok(sendTo(env, token, orgReqs[0].folderId).ok); assert.ok(sendTo(env, token, orgReqs[1].folderId, { target: "self" }).ok);
  assert.ok(sendTo(env, pa.token, pilotReqs[0].folderId).ok); assert.ok(sendTo(env, pb.token, pilotReqs[2].folderId).ok); assert.ok(sendTo(env, pb.token, pilotReqs[3].folderId).ok);
  assert.ok(sendTo(env, pb.token, pilotReqs[4].folderId, { target: "self" }).ok);
  const lu = env.call({ action: "listUsers", token });
  assert.deepEqual(lu.totals, { org: { requests: 3, sent: 1 }, pilot: { requests: 5, sent: 3 } });
  const u = n => lu.users.find(x => x.user === n);
  assert.deepEqual([u("itzik").requests, u("itzik").sent, u("itzik").org], [3, 1, true]);
  assert.deepEqual([u("pilot.a").requests, u("pilot.a").sent, u("pilot.a").org], [2, 1, false]);
  assert.deepEqual([u("pilot.b").requests, u("pilot.b").sent, u("pilot.b").org], [3, 2, false]);
  assert.equal(env.call({ action: "listUsers", token: pa.token }).error, "forbidden", "הסיכומים למנהל בלבד");
  // יומן פגום: totals מאופסים והמנהל עדיין מנהל משתמשים
  env.folders.ROOT.files.find(f => f.name === "_יומן בקשות.json").bytes = Buffer.from("{not json");
  const bad = env.call({ action: "listUsers", token });
  assert.ok(bad.ok && bad.logError); assert.deepEqual(bad.totals, { org: { requests: 0, sent: 0 }, pilot: { requests: 0, sent: 0 } });
});

test("תיקיות דרייב: בקשה ארגונית ב'הארגון', בקשת מטיס ב'מטיסים/<משתמש>'; יצירה לפי דרישה וללא כפילויות; שם ייחודי בתוך תיקיית האב; הקישור למנהל בלבד", () => {
  const { env, token } = withWix();
  assert.deepEqual(childrenOf(env, "ROOT").map(f => f.name), [], "בהתחלה אין תיקיות");
  const p1 = pilotUser(env, "p1@example.com", "pilot.one"), p2 = pilotUser(env, "p2@example.com", "pilot.two");
  const NAME = "אתר — 09.03.2027";
  const a1 = savedRequest(env, token, NAME), a2 = savedRequest(env, token, NAME), x1 = savedRequest(env, p1.token, NAME), x2 = savedRequest(env, p1.token, NAME), y1 = savedRequest(env, p2.token, NAME);
  assert.deepEqual(pathOf(env, a1.folderId), ["הארגון", NAME]); assert.deepEqual(pathOf(env, a2.folderId), ["הארגון", NAME + " (2)"]);
  assert.deepEqual(pathOf(env, x1.folderId), ["מטיסים", "pilot.one", NAME]); assert.deepEqual(pathOf(env, x2.folderId), ["מטיסים", "pilot.one", NAME + " (2)"]);
  assert.deepEqual(pathOf(env, y1.folderId), ["מטיסים", "pilot.two", NAME], "אותו שם אצל מטיס אחר: תיקייה אישית נפרדת, בלי סיומת");
  // השם שמוחזר לכל אחד = השם בפועל; אין כפילות של תיקיות עוטפות
  assert.deepEqual([a2.name, x2.name, y1.name], [NAME + " (2)", NAME + " (2)", NAME]);
  const names = id => childrenOf(env, id).map(f => f.name).sort();
  assert.deepEqual(names("ROOT"), ["הארגון", "מטיסים"]);
  const pilotsId = childrenOf(env, "ROOT").find(f => f.name === "מטיסים").id;
  assert.deepEqual(names(pilotsId), ["pilot.one", "pilot.two"]);
  // הקישור (url) מוחזר למנהל בלבד; למטיס — לא
  assert.match(a1.url, /^https:\/\/drive\//); assert.ok(!("url" in x1), "מטיס לא מקבל קישור לדרייב");
  // שמירה חוזרת (אותו rid) נשארת באותה תיקייה, בלי תיקיות חדשות
  const before = Object.keys(env.folders).length;
  assert.equal(env.call({ action: "saveBegin", token: p1.token, folderName: NAME, rid: x1.rid }).folderId, x1.folderId);
  assert.equal(env.call({ action: "saveBegin", token, folderName: NAME, rid: a1.rid }).folderId, a1.folderId);
  assert.equal(Object.keys(env.folders).length, before);
  // תיקייה שנזרקה לפח נוצרת מחדש אצל הבעלים (גם כשמנהל משחזר), לא אצל המנהל
  env.folders[x1.folderId].trashed = true;
  const re = env.call({ action: "saveBegin", token, folderName: NAME, rid: x1.rid });
  assert.ok(re.ok && re.folderId !== x1.folderId, JSON.stringify(re));
  assert.deepEqual(pathOf(env, re.folderId), ["מטיסים", "pilot.one", NAME], "נוצרה מחדש בתיקייה האישית של המטיס, ולא ב'הארגון'");
  assert.equal(names(pilotsId).length, 2, "אין תיקייה אישית כפולה");
  assert.equal(logOf(env).find(e => e.rid === x1.rid).kind, "pilot");
  // מחיקת המטיס: התיקייה נשארת בדרייב
  assert.ok(env.call({ action: "deleteUser", token, target: "pilot.two" }).ok);
  assert.deepEqual(pathOf(env, y1.folderId), ["מטיסים", "pilot.two", NAME]); assert.ok(!env.folders[y1.folderId].trashed);
});

test("תיקיות דרייב: יצירה אידמפוטנטית גם בקריאות מקבילות (נעילת הסקריפט), ולא נוצרות תיקיות עוטפות כשהבקשה נדחית; כפילות ידנית/פח/בקשה ישנה בשם עוטף", () => {
  const { env, token } = withWix();
  const p1 = pilotUser(env, "p1@example.com", "pilot.one"), p2 = pilotUser(env, "p2@example.com", "pilot.two");
  // קריאה מקבילה באמצע יצירת התיקייה העוטפת: הנעילה מחזירה busy, ואחרי שהראשונה מסתיימת — אין כפילות
  env.lock.strict = true;
  let nested = null;
  env.hooks.beforeCreateFolder = n => { if (n === "מטיסים" && !nested) nested = env.call({ action: "saveBegin", token: p2.token, folderName: "מקביל — 10.03.2027", rid: newRid() }); };
  const first = env.call({ action: "saveBegin", token: p1.token, folderName: "ראשון — 10.03.2027", rid: newRid() });
  env.hooks.beforeCreateFolder = null;
  assert.ok(first.ok, JSON.stringify(first)); assert.equal(nested.error, "busy", "קריאה מקבילה נדחית בנעילה");
  const retry = env.call({ action: "saveBegin", token: p2.token, folderName: "מקביל — 10.03.2027", rid: newRid() });
  assert.ok(retry.ok);
  assert.equal(childrenOf(env, "ROOT").filter(f => f.name === "מטיסים").length, 1);
  env.lock.strict = false;
  // בקשה שנדחתה (תקרה) לא יוצרת תיקיות עוטפות
  const { env: e2, token: t2 } = withWix(); const q = pilotUser(e2, "q@example.com", "pilot.q");
  vm.runInContext("CFG.MAX_NEW_FOLDERS_PER_HOUR = 0", e2.sandbox);
  assert.equal(e2.call({ action: "saveBegin", token: q.token, folderName: "דחוי — 10.03.2027", rid: newRid() }).error, "rate");
  assert.equal(e2.call({ action: "saveBegin", token: t2, folderName: "דחוי — 10.03.2027", rid: newRid() }).error, "rate");
  assert.deepEqual(childrenOf(e2, "ROOT").map(f => f.name), [], "לא נוצרו 'הארגון'/'מטיסים' לבקשה שנדחתה");
  // תיקיית 'הארגון' שבפח: נוצרת חדשה (כמו Drive האמיתי, getFoldersByName לא מחזיר פריטים בפח)
  const a = savedRequest(env, token, "פח — 10.03.2027");
  const orgId = childrenOf(env, "ROOT").find(f => f.name === "הארגון").id; env.folders[orgId].trashed = true;
  const b = savedRequest(env, token, "אחרי פח — 10.03.2027");
  assert.notEqual(env.folders[b.folderId].parent, orgId); assert.equal(childrenOf(env, "ROOT").filter(f => f.name === "הארגון").length, 1);
  assert.ok(a.ok);
  // בקשה ישנה (תיקיית בקשה בעומק 1) ששמה במקרה 'מטיסים' אינה נחשבת תיקייה עוטפת
  const { env: e3, token: t3 } = withWix(); const w = pilotUser(e3, "w@example.com", "pilot.w");
  const legacy = e3.call({ action: "saveBegin", token: t3, folderName: "שם", rid: newRid() });
  e3.folders[legacy.folderId].parent = "ROOT"; e3.folders[legacy.folderId].name = "מטיסים";      // כמו בקשה ישנה בעומק 1 ששמה זהה לשם העוטף
  const log3 = logOf(e3); log3[0].parent = "ROOT"; delete log3[0].kind; e3.folders.ROOT.files.find(f => f.name === "_יומן בקשות.json").bytes = Buffer.from(JSON.stringify(log3));
  const fresh = savedRequest(e3, w.token, "חדש — 10.03.2027");
  assert.deepEqual(pathOf(e3, fresh.folderId), ["מטיסים", "pilot.w", "חדש — 10.03.2027"]);
  assert.equal(childrenOf(e3, legacy.folderId).length, 0, "לא נכנס לתוך הבקשה הישנה");
  assert.equal(childrenOf(e3, "ROOT").filter(f => f.name === "מטיסים").length, 2, "נוצרה תיקייה עוטפת אמיתית לצד הבקשה הישנה");
});

test("requestFolder_: עומק 1 (ישנות, כולל ללא סוג) ועומק 2-3 החדשות עובדות בכל הפעולות; התיקייה הראשית, עומק 4, תיקיות עוטפות ותיקיות מחוץ לעץ נדחות", () => {
  const { env, token } = withWix(); goLive(env, token);
  const pilot = pilotUser(env);
  // בקשה ישנה בעומק 1 (נוצרה לפני ההפרדה): תיקייה ישירות תחת הראשית, רשומת יומן בלי kind ובלי parent — של מנהל ושל מטיס
  let legSeq = 0;
  const mkLegacy = (owner, name) => {
    const id = "LEG" + ++legSeq; env.folders[id] = { id, name, parent: "ROOT", files: [] };
    const f = env.folders.ROOT.files.find(x => x.name === "_יומן בקשות.json"), log = JSON.parse(f.bytes.toString());
    log.push({ id, rid: crypto.randomBytes(12).toString("hex"), name, user: owner, created: Date.now(), saved: Date.now(), lastUser: owner, ready: false, sent: [] });
    f.bytes = Buffer.from(JSON.stringify(log)); return { id, rid: log[log.length - 1].rid };
  };
  savedRequest(env, token, "פתיח — 11.03.2027");        // יוצר את קובץ היומן
  for (const [who, tok, owner] of [["מנהל", token, "itzik"], ["מטיס", pilot.token, "dana.pilot"]]) {
    const leg = mkLegacy(owner, "ישנה של " + who + " — 11.03.2027");
    for (const [n, mime] of STD_FILES) assert.ok(env.call({ action: "saveFile", token: tok, folderId: leg.id, name: n, mime, b64: b64("x") }).ok, who + " saveFile " + n);
    assert.equal(env.call({ action: "saveEnd", decl: DECL, token: tok, folderId: leg.id, ready: true }).ready, true, who);
    const r = sendTo(env, tok, leg.id); assert.ok(r.ok, who + " " + JSON.stringify(r));
    const row = env.call({ action: "listRequests", token }).requests.find(x => x.name.startsWith("ישנה של " + who));
    assert.equal(row.kind, "org", "בלי kind = ארגונית"); assert.equal(row.sentLive, 1);
    // saveBegin על rid ישן ממשיך באותה תיקייה (לא עוברת) — אחרי שליחה חיה נעולה
    assert.equal(env.call({ action: "saveBegin", token: tok, folderName: "x", rid: leg.rid }).error, "already_sent");
  }
  const leg2 = mkLegacy("dana.pilot", "ישנה פתוחה — 11.03.2027");
  const sb = env.call({ action: "saveBegin", token: pilot.token, folderName: "ישנה פתוחה — 11.03.2027", rid: leg2.rid });
  assert.ok(sb.ok && sb.folderId === leg2.id, "המשך עריכה בתיקייה הישנה"); assert.deepEqual(pathOf(env, leg2.id), ["ישנה פתוחה — 11.03.2027"]);
  // בקשות חדשות בעומק 2 (ארגוני) ו-3 (מטיס)
  const orgReq = savedRequest(env, token, "חדשה ארגונית — 11.03.2027"), pilotReq = savedRequest(env, pilot.token, "חדשה מטיס — 11.03.2027");
  assert.ok(sendTo(env, token, orgReq.folderId, { target: "self" }).ok); assert.ok(sendTo(env, pilot.token, pilotReq.folderId, { target: "self" }).ok);
  // דחייה: הראשית עצמה (גם אם רשומה ביומן), עומק 4, תיקיית אב עוטפת, תיקייה מחוץ לעץ, ותיקייה שאינה קיימת
  const logFile = env.folders.ROOT.files.find(x => x.name === "_יומן בקשות.json");
  const addEntry = id => { const log = JSON.parse(logFile.bytes.toString()); log.push({ id, rid: crypto.randomBytes(12).toString("hex"), name: id, user: "itzik", created: 1, saved: 1, lastUser: "itzik", ready: true, sent: [] }); logFile.bytes = Buffer.from(JSON.stringify(log)); };
  env.folders.DEEP = { id: "DEEP", name: "עמוק", parent: pilotReq.folderId, files: [] };            // עומק 4
  env.folders.OUT = { id: "OUT", name: "מחוץ", parent: null, files: [] };
  env.folders.OUTKID = { id: "OUTKID", name: "ילד", parent: "OUT", files: [] };
  env.folders.OFFCHAIN = { id: "OFFCHAIN", name: "שרשרת", parent: "OUTKID", files: [] };
  for (const id of ["ROOT", "DEEP", "OUT", "OUTKID", "OFFCHAIN", "nope"]) {
    if (id !== "nope") addEntry(id);      // גם עם רשומת יומן — התיקייה נדחית בגלל מיקומה
    const tag = id + " (" + (env.folders[id] ? env.folders[id].name : "-") + ")";
    for (const r of [
      env.call({ action: "saveFile", token, folderId: id, name: "x.png", mime: "image/png", b64: b64("x") }),
      env.call({ action: "saveEnd", decl: DECL, token, folderId: id, ready: true }),
      sendTo(env, token, id, { target: "self" }),
    ]) assert.equal(r.error, "bad_folder", tag + " " + JSON.stringify(r));
  }
  // התיקיות העוטפות עצמן (עומק 1-2) נדחות אם אין להן רשומת יומן
  const { env: e2, token: t2 } = withWix(); savedRequest(e2, t2, "ר — 11.03.2027");
  const w2 = childrenOf(e2, "ROOT").find(f => f.name === "הארגון").id;
  for (const r of [e2.call({ action: "saveFile", token: t2, folderId: w2, name: "x.png", mime: "image/png", b64: b64("x") }), e2.call({ action: "saveEnd", decl: DECL, token: t2, folderId: w2, ready: true }), sendTo(e2, t2, w2)]) assert.equal(r.error, "bad_folder");
  assert.equal(readLogRaw(e2).length, 1);
});

test("חשבון ארגוני פטור מהתקרות הכוללות של דליי הקצב (לא מהאישיות); מטיסים שמילאו אותן לא מרעיבים אותו", () => {
  const { env, token } = calmWix(); goLive(env, token);      // שעון מיושר: מוני השעה לא מתאפסים באמצע הבדיקה
  vm.runInContext("CFG.MAX_COPIES_PER_HOUR_ALL = 2; CFG.MAX_OFFICE_PER_HOUR_ALL = 1", env.sandbox);
  const ps = [1, 2, 3, 4].map(i => pilotUser(env, "ex" + i + "@example.com", "pilot.ex" + i));
  const rs = ps.map((p, i) => savedRequest(env, p.token, "פטור " + i + " — 12.03.2027"));
  assert.ok(sendTo(env, ps[0].token, rs[0].folderId, { target: "self" }).ok); assert.ok(sendTo(env, ps[1].token, rs[1].folderId, { target: "self" }).ok);
  assert.deepEqual(["scope", "kind"].map(k => sendTo(env, ps[2].token, rs[2].folderId, { target: "self" })[k]), ["all", "copy"], "מטיס חוסם בתקרה הכוללת של עותקים");
  assert.ok(sendTo(env, ps[0].token, rs[0].folderId).ok);
  assert.deepEqual(["scope", "kind"].map(k => sendTo(env, ps[3].token, rs[3].folderId)[k]), ["all", "office"], "ומטיס חוסם בתקרה הכוללת של שליחות חיות");
  // המנהל, וכל חשבון ארגוני אחר (נוסף ידנית), עוברים — בשני הדליים
  env.call({ action: "addUser", token, newUser: "org.staff", newPass: "staff-pass-12345" });
  const staff = env.call({ action: "login", user: "org.staff", pass: "staff-pass-12345" });
  let seq = 0;
  for (const tok of [token, staff.token]) {
    assert.ok(sendTo(env, tok, savedRequest(env, tok, "ארגון עותק " + ++seq + " — 12.03.2027").folderId, { target: "self" }).ok, "עותק");
    assert.ok(sendTo(env, tok, savedRequest(env, tok, "ארגון חי " + ++seq + " — 12.03.2027").folderId).ok, "שליחה חיה");
  }
  // והם עדיין נספרים בסך הכול (הדלי הכללי נשאר מדויק) ובמגבלה האישית
  assert.deepEqual(["scope", "kind"].map(k => sendTo(env, ps[3].token, rs[3].folderId)[k]), ["all", "office"]);
  vm.runInContext("CFG.MAX_COPIES_PER_HOUR = 2; CFG.MAX_OFFICE_PER_HOUR = 2", env.sandbox);
  env.advance(61 * 60000);
  const rr = [1, 2, 3].map(i => savedRequest(env, token, "אישי " + i + " — 12.03.2027").folderId);
  assert.ok(sendTo(env, token, rr[0], { target: "self" }).ok); assert.ok(sendTo(env, token, rr[1], { target: "self" }).ok);
  assert.deepEqual(["scope", "kind"].map(k => sendTo(env, token, rr[2], { target: "self" })[k]), ["user", "copy"], "התקרה האישית של עותקים חלה גם על הארגון");
  assert.ok(sendTo(env, token, rr[0]).ok); assert.ok(sendTo(env, token, rr[1]).ok);
  assert.deepEqual(["scope", "kind"].map(k => sendTo(env, token, rr[2])[k]), ["user", "office"], "והתקרה האישית של שליחות חיות");
  // חשבון שהוסב מארגוני לעצמאי מאבד את הפטור
  assert.ok(setOrg(env, token, "org.staff", false).ok);
  env.advance(61 * 60000);
  vm.runInContext("CFG.MAX_COPIES_PER_HOUR_ALL = 0", env.sandbox);
  assert.equal(sendTo(env, staff.token, savedRequest(env, staff.token, "הוסב — 12.03.2027").folderId, { target: "self" }).scope, "all");
  assert.ok(sendTo(env, token, rr[0], { target: "self" }).ok, "המנהל עדיין פטור");
});

test("מטיס עצמאי: כל הפעולות על בקשות של עצמו בלבד גם עם התיקיות החדשות (עצמאות בין מטיסים בדרייב ובשליחה); מנהל ממשיך לתמוך", () => {
  const { env, token } = withWix(); goLive(env, token);
  const p1 = pilotUser(env, "p1@example.com", "pilot.one"), p2 = pilotUser(env, "p2@example.com", "pilot.two");
  const r1 = savedRequest(env, p1.token, "פרטי — 13.03.2027");
  assert.equal(env.call({ action: "saveFile", token: p2.token, folderId: r1.folderId, name: "x.png", mime: "image/png", b64: b64("x") }).error, "forbidden");
  assert.equal(env.call({ action: "saveEnd", decl: DECL, token: p2.token, folderId: r1.folderId, ready: true }).error, "forbidden");
  assert.equal(sendTo(env, p2.token, r1.folderId).error, "forbidden");
  assert.equal(env.call({ action: "saveBegin", token: p2.token, folderName: "פרטי — 13.03.2027", rid: r1.rid }).error, "forbidden");
  assert.ok(env.call({ action: "saveFile", token, folderId: r1.folderId, name: "תמיכה.png", mime: "image/png", b64: b64("x") }).ok, "מנהל (תמיכה) כותב");
  assert.equal(env.call({ action: "saveEnd", decl: DECL, token, folderId: r1.folderId, ready: true }).ready, true);
  assert.ok(sendTo(env, p1.token, r1.folderId).ok);
});

test("README של השרת: כל קבוע CFG שמוזכר בו קיים בקוד (מונע סטייה בין התיעוד למימוש), והמספרים שנקבעו מופיעים בו", () => {
  const readme = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "apps-script", "README.md"), "utf8");
  const { sandbox } = makeEnv();
  const cfg = vm.runInContext("CFG", sandbox);
  const named = [...new Set([...readme.matchAll(/`([A-Z][A-Z0-9_]{3,})`/g)].map(m => m[1]))].filter(n => /^(MAX|LOG|CODE|MAIL|REQUIRE|VALID|REMIND|ROOT|WIX|SENDER|RENEW|REG|ADMIN|ORG|PILOTS)_/.test(n) && !["WIX_API_KEY", "MAIL_MODE", "REG_MAILS", "REG_NOTICKET"].includes(n));   // אלה Script Properties ולא CFG
  assert.ok(named.length >= 10, "נמצאו קבועים: " + named.join(","));
  for (const n of named) assert.ok(n in cfg, "README מזכיר את " + n + " אבל אין אותו ב-CFG");
  for (const [k, v] of [["MAX_OFFICE_PER_HOUR", 10], ["MAX_OFFICE_PER_HOUR_ALL", 60], ["MAX_COPIES_PER_HOUR", 10], ["MAX_COPIES_PER_HOUR_ALL", 120], ["MAX_SEND_ATTEMPTS_PER_HOUR", 40], ["MAIL_QUOTA_RESERVE", 20], ["LOG_MAX", 2000], ["LOG_KEEP_DAYS", 30], ["CODE_FAIL_MAX", 10], ["CODE_FAIL_HOURS", 6],
    ["MAIL_QUOTA_RESERVE_REG", 8], ["REG_PER_EMAIL_HOUR", 5], ["REG_WIX_PER_HOUR", 600], ["REG_MAILS_PER_HOUR", 150], ["REG_MAILS_PER_DAY", 400], ["REG_MAILS_PER_EMAIL_DAY", 10], ["REG_EXISTS_HOURS", 24], ["REG_NOTICKET_HOURS", 24], ["REG_NOTICKET_PER_HOUR", 20], ["REG_NOTICKET_PER_DAY", 100],
    ["MAX_FOLDER_FILES", 12], ["MAX_UPLOAD_BYTES_PER_HOUR", 400 * 1048576], ["MAX_UPLOAD_BYTES_PER_DAY", 1000 * 1048576], ["MAX_OPEN_REQUESTS_PER_USER", 60], ["MAX_SENT_PER_REQUEST", 100]])
    assert.equal(cfg[k], v, k);
  assert.ok(!("REG_PER_HOUR" in cfg), "המכסה הכללית הישנה (60 בשעה) בוטלה");
  assert.ok(cfg.MAIL_QUOTA_RESERVE_REG < cfg.MAIL_QUOTA_RESERVE, "קודי הרשמה משאירים רזרבה קטנה מזו של עותקים: משרד נוטאם ← קודים ← עותקים");
  assert.ok(cfg.MAX_FOLDER_BYTES <= cfg.MAX_MAIL_BYTES && cfg.REG_MAILS_PER_HOUR > 100, "תקרת תיקייה ≤ תקרת מייל; התקציב השעתי מכסה 100 נרשמים");
  assert.ok(cfg.MAX_COPIES_PER_HOUR_ALL >= 60, "תקרה כוללת לעותקים לא נמוכה מ-60");
  for (const fn of ["showMailQuota", "initialize", "installTrigger"]) assert.ok(readme.includes("`" + fn + "`"), "README מזכיר את " + fn);
  for (const k of ["REG_NOTICKET_HOURS", "REG_NOTICKET_PER_HOUR", "REG_NOTICKET_PER_DAY", "REG_NOTICKET"]) assert.ok(readme.includes("`" + k + "`"), "README מזכיר את " + k);   // הודעת 'לא נמצא כרטיס': שלושת הקבועים והספר ב-Script Properties
  assert.ok(cfg.REG_NOTICKET_PER_HOUR <= cfg.REG_NOTICKET_PER_DAY && cfg.REG_NOTICKET_PER_DAY <= 300, "התקציב השעתי ≤ היומי, והיומי בתוך תקרת הרשומה (300)");
  // הפרדה בין הארגון למטיסים: הקבועים החדשים, הפעולות והשדות מתועדים, וערכי ברירת המחדל זהים לחוזה
  for (const [k, v] of [["ADMIN_COPY_TO", "office@icd.org.il"], ["ORG_FOLDER_NAME", "הארגון"], ["PILOTS_FOLDER_NAME", "מטיסים"], ["SENDER_NAME", "הארגון הישראלי לרב להב"], ["SENDER_SUFFIX", " — דרך מערכת בקשות הטיסה"], ["SENDER_FALLBACK", "מטיס"], ["SENDER_MAX", 60]]) {
    assert.equal(cfg[k], v, k);
    assert.ok(readme.includes("`" + k + "`"), "README מזכיר את " + k);
  }
  assert.deepEqual(Array.from(cfg.FEATURES), ["sendTarget", "orgSplit", "advView"]);
  for (const w of ["setAdv", "advView", "bad_adv", "advExplicit", "setOrg", "fromName", "orgSplit", "totals", "kind", "copyToIsOwner", "is_admin", "bad_org", "no_owner", "הארגון/", "מטיסים/<", "htmlBody"]) assert.ok(readme.includes(w), "README מזכיר את " + w);
});

/* ===== גוף המייל: htmlBody (מימין לשמאל, תבליטים) לצד גוף טקסט רגיל ===== */
const htmlOf = (env, text) => vm.runInContext("htmlBody_", env.sandbox)(text);
const RTL_ROOT = '<div dir="rtl" style="direction:rtl;text-align:right;';
const tagNames = html => [...html.matchAll(/<\/?([a-z0-9]+)/gi)].map(m => m[1].toLowerCase());
const bareHtml = html => html.replace(/ style="[^"]*"/g, "");      // המבנה בלי העיצוב
const BULLET_BODY = "הבקשה לסגירה אווירית מצורפת (טופס Word מלא).\n• מקום: פי גלילות, תל אביב\n• תאריך: 22.10.2026, 08:00–12:00\n• קבצים: Word, KML, ארבע מפות\n\nבברכה,\nדנה";

test("htmlBody_: שורש מימין לשמאל ומיושר לימין; שורות '• ' רצופות = רשימה אחת (RTL, תבליטים מימין); שורה ריקה = רווח; שורה אחרת = שורה בפני עצמה", () => {
  const { env } = bootstrapped();
  const h = htmlOf(env, BULLET_BODY);
  assert.ok(h.startsWith(RTL_ROOT) && h.endsWith("</div>"), h);
  assert.equal(bareHtml(h), '<div dir="rtl"><div>הבקשה לסגירה אווירית מצורפת (טופס Word מלא).</div><ul dir="rtl"><li>מקום: פי גלילות, תל אביב</li><li>תאריך: 22.10.2026, 08:00–12:00</li><li>קבצים: Word, KML, ארבע מפות</li></ul><br><div>בברכה,</div><div>דנה</div></div>');
  const ul = /<ul dir="rtl" style="([^"]*)">/.exec(h)[1];
  assert.match(ul, /direction:rtl/); assert.match(ul, /text-align:right/); assert.match(ul, /padding:0 \d+px 0 0/, "מרווח לתבליט מצד ימין");
  assert.equal([...h.matchAll(/<li style="text-align:right">/g)].length, 3);
  assert.match(h.slice(RTL_ROOT.length, h.indexOf('">')), /font-family:[^;]+;font-size:\d+px/, "גופן קריא");
  assert.ok(!h.includes("• "), "התבליט הטקסטואלי הוחלף בתבליט של הרשימה");
});

test("htmlBody_: שתי רשימות מופרדות בשורה ריקה = שתי רשימות; שורה ריקה בהתחלה/בסוף לא הופכת לרווח; כמה שורות ריקות = כמה רווחים", () => {
  const { env } = bootstrapped();
  assert.equal(bareHtml(htmlOf(env, "• א\n• ב\n\n• ג")), '<div dir="rtl"><ul dir="rtl"><li>א</li><li>ב</li></ul><br><ul dir="rtl"><li>ג</li></ul></div>');
  assert.equal(bareHtml(htmlOf(env, "\n  \nשלום\n\n\n\nסוף\n \n")), '<div dir="rtl"><div>שלום</div><br><br><br><div>סוף</div></div>');
  for (const empty of ["", "\n\n", "   "]) { const h = htmlOf(env, empty); assert.ok(h.startsWith(RTL_ROOT) && h.endsWith("</div>") && !/<(ul|li|br)/.test(h), JSON.stringify(empty)); }
});

test("htmlBody_: גוף ישן בלי תבליטים נשאר שורות (RTL תקין); '•' בלי רווח או עם הזחה אינו תבליט", () => {
  const { env } = bootstrapped();
  const h = htmlOf(env, "שם: פי גלילות\nתאריך: 22.10.2026\n\nמצורף טופס.");
  assert.ok(h.startsWith(RTL_ROOT) && !h.includes("<ul"));
  assert.equal(bareHtml(h), '<div dir="rtl"><div>שם: פי גלילות</div><div>תאריך: 22.10.2026</div><br><div>מצורף טופס.</div></div>');
  const h2 = htmlOf(env, "•בלי רווח\n  • מוזח\n• באמת");
  assert.equal([...h2.matchAll(/<li/g)].length, 1); assert.equal(bareHtml(h2), '<div dir="rtl"><div>•בלי רווח</div><div>• מוזח</div><ul dir="rtl"><li>באמת</li></ul></div>');
  assert.equal(bareHtml(htmlOf(env, "• א ב\n• ג")), '<div dir="rtl"><ul dir="rtl"><li>א ב</li><li>ג</li></ul></div>', "U+2028 בתוך שורת תבליט לא שובר אותה");
});

test("htmlBody_: כל הטקסט עובר escape (& < > \" ') — אין תגית, תכונה, קישור או תמונה שנוצרים מהגוף", () => {
  const { env } = bootstrapped();
  const evil = "<script>alert(\"x\")</script> & 'q' <img src=x onerror=1> <a href=\"http://evil.example\">לחצו</a>\n• <b>x</b>\n• a&amp;b \" onmouseover=\"alert(1)\n</div><div dir=\"ltr\">";
  const h = htmlOf(env, evil);
  assert.deepEqual([...new Set(tagNames(h))].sort(), ["div", "li", "ul"], "רק התגיות שהקוד יצר: " + h);
  const text = h.replace(/<\/?(div|ul|li|br)\b[^>]*>/g, "");        // מה שנשאר אחרי הסרת תגיות הקוד: טקסט בלבד
  assert.ok(!/[<>"']/.test(text), "אין תו מסוכן גולמי: " + text);
  assert.ok(!/&(?!(amp|lt|gt|quot|#39);)/.test(text), "כל & הוא ישות: " + text);
  assert.ok(text.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39; &lt;img src=x onerror=1&gt;"));
  assert.ok(h.includes('<li style="text-align:right">&lt;b&gt;x&lt;/b&gt;</li>'), "שורת התבליט '• <b>x</b>' נשארת טקסט");
  assert.ok(h.includes("a&amp;amp;b &quot; onmouseover=&quot;alert(1)"), "ישות שהוקלדה כטקסט לא מפוענחת, ומירכאות לא בורחות");
  assert.ok(h.includes("&lt;/div&gt;&lt;div dir=&quot;ltr&quot;&gt;"), "ניסיון לסגור את השורש ולפתוח אחר נשאר טקסט");
  assert.equal((h.match(/<div dir=/g) || []).length, 1, "שורש יחיד");
});

test("htmlBody_: גוף ארוך (20,000 תווים) מתעבד מיד — רווחים ארוכים ושורות רבות לא גורמים לריצוד ריבועי", () => {
  const { env } = bootstrapped();
  const t0 = Date.now();
  const spaces = htmlOf(env, " ".repeat(19999) + "x"), lines = htmlOf(env, "• א\n".repeat(5000)), blanks = htmlOf(env, "\n".repeat(19999) + "x");
  assert.ok(Date.now() - t0 < 2000, "לקח " + (Date.now() - t0) + "ms");
  assert.ok(spaces.includes(">x</div>") && [...lines.matchAll(/<li /g)].length === 5000 && blanks.includes(">x</div>"));
});

// 3 חשבונות (מנהל = ארגוני בלי כתובת שמורה; עובד ארגון עם כתובת; מטיס עצמאי) × כל צירופי מצב ויעד
for (const who of ["admin", "org-worker", "pilot"]) {
  test(`שליחה — ${who}: ל-MailApp מועבר htmlBody (RTL, תבליטים) לצד body הטקסטואלי ללא שינוי, בכל מצב ויעד; שאר שדות המייל כמקודם`, () => {
    const { env, token } = withWix();
    let tok = token;
    if (who !== "admin") { const p = pilotUser(env, "staff@example.com", "worker.user"); tok = p.token; if (who === "org-worker") assert.ok(setOrg(env, token, "worker.user", true).ok); }
    for (const [mode, target] of [["test", "office"], ["test", "self"], ["live", "office"], ["live", "self"]]) {
      if (mode === "live") goLive(env, token); else env.call({ action: "setMailMode", token, mode: "test" });
      const tag = who + " " + mode + " " + target, before = env.mails.length;
      const b = savedRequest(env, tok, tag + " — 03.01.2027");
      const r = sendTo(env, tok, b.folderId, { target, body: BULLET_BODY });
      assert.ok(r.ok, tag + " " + JSON.stringify(r));
      assert.equal(env.mails.length, before + 1, tag); const m = env.mails[before];
      assert.equal(m.body, BULLET_BODY, tag + ": הגוף הטקסטואלי כפי שנשלח (שורות '• ' גולמיות)");
      assert.equal(m.htmlBody, htmlOf(env, BULLET_BODY), tag);
      assert.ok(m.htmlBody.startsWith(RTL_ROOT) && m.htmlBody.endsWith("</div>"), tag);
      assert.equal([...m.htmlBody.matchAll(/<ul /g)].length, 1, tag); assert.equal([...m.htmlBody.matchAll(/<li /g)].length, 3, tag);
      assert.deepEqual(Object.keys(m).filter(k => !["to", "cc", "bcc", "replyTo", "name", "subject", "body", "htmlBody", "attachments"].includes(k)), [], tag + ": אין שדות חדשים מלבד htmlBody");
      assert.equal(m.attachments.length, 4, tag + ": הקבצים מצורפים אוטומטית מהתיקייה");
      assert.equal(m.name, who === "pilot" ? "דנה" + SENDER_SUFFIX : ORG_NAME, tag);
      assert.equal(m.subject, (target === "self" ? SELF_PREFIX : mode === "test" ? TEST_PREFIX : "") + "בקשה — נושא", tag);
    }
  });
}

test("שליחה: גוף עוין (<script>, &, מירכאות, '• <b>x</b>') — ה-body נשאר גולמי כפי שנשלח, ה-htmlBody עובר escape", () => {
  const { env, token } = bootstrapped();
  const evil = "<script>alert(1)</script> & \"ציטוט\" 'x'\n• <b>x</b>\n• <img src=x onerror=alert(1)>";
  assert.ok(sendTo(env, token, savedRequest(env, token).folderId, { body: evil }).ok);
  const m = env.mails[0];
  assert.equal(m.body, evil, "הטקסט הרגיל אינו מקודד");
  assert.equal(m.htmlBody, htmlOf(env, evil));
  assert.deepEqual([...new Set(tagNames(m.htmlBody))].sort(), ["div", "li", "ul"]);
  assert.ok(!m.htmlBody.includes("<script") && !m.htmlBody.includes("<b>") && !m.htmlBody.includes("<img"));
  assert.ok(m.htmlBody.includes("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;ציטוט&quot; &#39;x&#39;") && m.htmlBody.includes("<li style=\"text-align:right\">&lt;b&gt;x&lt;/b&gt;</li>"));
});

test("שליחה: ניקוי הגוף לא משנה תבליט, פיסוק עברי (״ ׳ — –) ומבנה שורות; CRLF הופך ל-LF ותווי בקרה מוסרים; htmlBody נבנה מהגוף המנוקה", () => {
  const { env, token } = bootstrapped();
  const sent = "שלום\r\n• אתר ״גני יהושע״ — ת״א\r\n• מס׳ 5 – שעה 08:00\u0001\r\n\r\nסיום\tבטאב\u0000";
  const clean = "שלום\n• אתר ״גני יהושע״ — ת״א\n• מס׳ 5 – שעה 08:00\n\nסיום\tבטאב";
  assert.ok(sendTo(env, token, savedRequest(env, token).folderId, { body: sent }).ok);
  const m = env.mails[0];
  assert.equal(m.body, clean);
  assert.equal(bareHtml(m.htmlBody), '<div dir="rtl"><div>שלום</div><ul dir="rtl"><li>אתר ״גני יהושע״ — ת״א</li><li>מס׳ 5 – שעה 08:00</li></ul><br><div>סיום\tבטאב</div></div>');
  assert.ok(!/[\u0000-\u0008\r]/.test(m.htmlBody));
});

test("שליחה: גוף ישן (בלי תבליטים) ו-20,000 תווים — htmlBody תקין (RTL, שורות), נחתך כמו ה-body, ו'גוף ריק' עדיין נדחה בלי לשלוח", () => {
  const { env, token } = bootstrapped();
  const b = savedRequest(env, token);
  assert.ok(sendTo(env, token, b.folderId, { body: "בקשה לסגירה אווירית\nמקום: פי גלילות\nתאריך: 22.10.2026" }).ok);
  assert.equal(bareHtml(env.mails[0].htmlBody), '<div dir="rtl"><div>בקשה לסגירה אווירית</div><div>מקום: פי גלילות</div><div>תאריך: 22.10.2026</div></div>');
  assert.ok(sendTo(env, token, b.folderId, { body: "א".repeat(30000) }).ok);
  assert.equal(env.mails[1].body.length, 20000); assert.equal(env.mails[1].htmlBody, htmlOf(env, "א".repeat(20000)));
  assert.equal(sendTo(env, token, b.folderId, { body: "" }).error, "bad_mail"); assert.equal(env.mails.length, 2);
});

/* ===== העלאה אוטומטית לדרייב בכל מחזור 'מוכנה': תקרות האחסון מחזיקות סשן ריאליסטי (עובד ארגון + מטיס) ===== */
// מחזור = saveBegin + קבצי הבקשה (Word, KML, ארבע תמונות, JSON) + saveEnd, כמו persistToDrive בדפדפן. גדלי הקבצים ב-MB כך שהמחזור כולו (23.9MB) ממש מתחת לתקרת התיקייה (24MB) — המקסימום האפשרי.
// כל תקרות הנפח לינאריות בבייטים, ולכן הבדיקה מקטינה פי 1024 גם את הקבצים וגם את התקרות האמיתיות (MAX_UPLOAD_BYTES_PER_HOUR/DAY, MAX_FOLDER_BYTES) — במקום להעביר מאות MB בזיכרון
const MB_K = 1048576 / 1024;
const MAX_CYCLE = [["בקשה לסגירה אווירית.docx", 2.9], ["אתר.kml", 0.1], ["תצ״א תקריב.png", 6.8], ["מפת רחובות.png", 2.0], ["מבט כללי.png", 6.0], ["מפת אזור.png", 6.0], ["נתוני הבקשה.json", 0.1]];
const scaleCaps = env => ["MAX_UPLOAD_BYTES_PER_HOUR", "MAX_UPLOAD_BYTES_PER_DAY", "MAX_FOLDER_BYTES"].forEach(k => setCfg(env, k, vm.runInContext("CFG." + k, env.sandbox) / 1024));
function readyCycle(env, tok, rid, place) {
  const b = env.call({ action: "saveBegin", token: tok, folderName: place, rid });
  if (!b.ok) return { ok: false, step: "saveBegin", error: b.error, message: b.message };
  for (const [n, mb] of MAX_CYCLE) {
    const r = env.call({ action: "saveFile", token: tok, folderId: b.folderId, name: place + " — " + n, mime: "application/octet-stream", b64: bytesB64(Math.floor(mb * MB_K)) });
    if (!r.ok) return { ok: false, step: n, error: r.error, kind: r.kind, message: r.message, folderId: b.folderId };
  }
  const e = env.call({ action: "saveEnd", decl: DECL, token: tok, folderId: b.folderId, ready: true });
  return { ok: !!(e.ok && e.ready), step: "saveEnd", folderId: b.folderId };
}
function orgWorker(env, token, name = "org.worker") {
  assert.ok(env.call({ action: "addUser", token, newUser: name, newPass: "worker-pass-1234", org: true }).ok);
  const r = env.call({ action: "login", user: name, pass: "worker-pass-1234" }); assert.ok(r.ok && r.org === true); return r;
}

test("העלאה אוטומטית (מחזור 'מוכנה' בגודל תקרת התיקייה): 3 בקשות × 5 מחזורים בשעה לעובד ארגון ולמטיס במקביל לא נחסמים, התיקייה לא מצטברת, ותקרת השעה עדיין נאכפת", () => {
  const { env, token } = calmWix(); scaleCaps(env);
  const cfg = vm.runInContext("CFG", env.sandbox), cycleBytes = MAX_CYCLE.reduce((s, f) => s + Math.floor(f[1] * MB_K), 0);
  assert.ok(cycleBytes <= cfg.MAX_FOLDER_BYTES, "המחזור נכנס לתיקייה");
  const worker = orgWorker(env, token), pilot = pilotUser(env);
  const users = [{ n: "עובד", tok: worker.token, path: ["הארגון"] }, { n: "מטיס", tok: pilot.token, path: ["מטיסים", "dana.pilot"] }];
  users.forEach(u => { u.rids = [newRid(), newRid(), newRid()]; u.folders = {}; });
  for (let cycle = 1; cycle <= 5; cycle++) for (let q = 0; q < 3; q++) for (const u of users) {
    const place = "אתר " + (q + 1) + (cycle >= 3 ? " (מקום עודכן)" : "") + " — 20.11.2026";       // ממחזור 3 שם המקום משתנה: אותו rid, אותה תיקייה, קבצים בשמות חדשים
    const r = readyCycle(env, u.tok, u.rids[q], place), tag = u.n + " בקשה " + (q + 1) + " מחזור " + cycle;
    assert.ok(r.ok, tag + " נחסם: " + JSON.stringify(r));
    assert.equal(u.folders[q] || r.folderId, r.folderId, tag + ": אותה תיקייה בכל מחזור"); u.folders[q] = r.folderId;
    const files = livesIn(env, r.folderId);
    assert.equal(files.length, MAX_CYCLE.length, tag + ": הגרסה הקודמת הוחלפה ולא הצטברה (מקסימום " + cfg.MAX_FOLDER_FILES + ")");
    assert.equal(logOf(env).find(e => e.id === r.folderId).ready, true, tag);
  }
  for (const u of users) {
    const folders = Object.values(u.folders);
    assert.equal(new Set(folders).size, 3, u.n + ": תיקייה אחת לכל בקשה, לא תיקייה למחזור");
    folders.forEach(id => assert.deepEqual(pathOf(env, id).slice(0, -1), u.path, u.n + ": הארכיון המרכזי לפי סוג החשבון"));
    assert.equal(logOf(env).filter(e => folders.includes(e.id)).length, 3);
  }
  // המונים נפרדים לכל משתמש: מחזור 16 עובר לשניהם (16 × 23.9MB ≤ 400MB), ומחזור 17 נחסם לעובד בתקרת הנפח השעתית — בלי להפריע למטיס
  const w16 = readyCycle(env, worker.token, users[0].rids[0], "אתר 1 (מקום עודכן) — 20.11.2026"), p16 = readyCycle(env, pilot.token, users[1].rids[0], "אתר 1 (מקום עודכן) — 20.11.2026");
  assert.ok(w16.ok && p16.ok, JSON.stringify([w16, p16]));
  const w17 = readyCycle(env, worker.token, users[0].rids[0], "אתר 1 (מקום עודכן) — 20.11.2026");
  assert.deepEqual([w17.ok, w17.error, w17.kind], [false, "rate", "upload"]); assert.match(w17.message, /השעתית/);
  assert.equal(logOf(env).find(e => e.id === w17.folderId).ready, false, "מחזור שנחסם באמצע לא משאיר בקשה מסומנת מוכנה");
  env.advance(61 * 60000);
  assert.ok(readyCycle(env, worker.token, users[0].rids[0], "אתר 1 (מקום עודכן) — 20.11.2026").ok, "שעה חדשה — ההעלאה חוזרת לעבוד");
});

test("העלאה אוטומטית ביום עבודה של עובד ארגון: 10 בקשות × 4 מחזורים (מחזורי תקרה) לא נחסמים בשעה ולא ביום, ותקרת היום עדיין נאכפת", () => {
  const { env, token } = calmWix(); scaleCaps(env);
  const worker = orgWorker(env, token), rids = Array.from({ length: 10 }, newRid);
  let done = 0;
  const run = (q, tag) => { const r = readyCycle(env, worker.token, rids[q], "אתר " + (q + 1) + " — 21.11.2026"); assert.ok(r.ok, tag + " (מחזור " + (done + 1) + ") נחסם: " + JSON.stringify(r)); done++; };
  for (let hour = 0; hour < 3; hour++) {
    for (let i = 0; i < (hour < 2 ? 15 : 10); i++) { const k = done; run(k % 10, "שעה " + (hour + 1)); }
    env.advance(61 * 60000);
  }
  assert.equal(done, 40);
  run(0, "מחזור 41 (979.9MB מתוך 1000MB)");
  const r = readyCycle(env, worker.token, rids[1], "אתר 2 — 21.11.2026");
  assert.deepEqual([r.ok, r.error, r.kind], [false, "rate", "upload"]); assert.match(r.message, /היומית/);
  assert.equal(logOf(env).filter(e => e.user === "org.worker").length, 10, "עשר בקשות, לא תיקייה למחזור");
});

/* ===== הצהרת המבקש בשרת: saveEnd מסמן ״מוכנה״ רק עם הצהרה תקינה (גרסת נוסח + מועד אישור), והיא נרשמת ביומן וב״נשלח — ....txt״ ===== */
test("saveEnd: בלי הצהרה תקינה הבקשה אינה מוכנה (דף ישן ללא שער ההצהרה, קריאה ישירה, ערכים פגומים); הצהרה תקינה נרשמת ביומן ובסימון השליחה", () => {
  const { env, token } = bootstrapped();
  const b = savedRequest(env, token, "הצהרה — 20.11.2026", undefined, newRid(), false);
  const end = decl => env.call({ action: "saveEnd", token, folderId: b.folderId, ready: true, ...(decl === undefined ? {} : { decl }) });
  for (const bad of [undefined, null, "2026-10-19", 5, [], {}, { v: "2026-10-19" }, { at: DECL.at }, { v: "2026-10-19", at: "ממש עכשיו" }, { v: "x", at: DECL.at }, { v: "2026-10-19", at: "2026-10-19T10:00:00+03:00" }, { v: "2026-10-19", at: DECL.at + "x" }, { v: 20261019, at: DECL.at }, { v: "2026-10-19\n", at: DECL.at }]) {
    const r = end(bad); assert.equal(r.ok, true); assert.equal(r.ready, false, "הצהרה לא תקינה: " + JSON.stringify(bad));
    assert.equal(logOf(env).find(e => e.id === b.folderId).decl, null, "לא נרשמת הצהרה פגומה");
    assert.equal(env.call(sendBody(env, token, b.folderId)).error, "not_ready");
  }
  const ok = end(DECL); assert.equal(ok.ready, true);
  assert.deepEqual(logOf(env).find(e => e.id === b.folderId).decl, DECL, "גרסה ומועד נרשמים ביומן");
  const r = sendTo(env, token, b.folderId, { target: "self" }); assert.ok(r.ok, JSON.stringify(r));
  const mark = env.folders[b.folderId].files.find(f => /^נשלח — /.test(f.name)).bytes.toString();
  assert.match(mark, /הצהרת המבקש: אושרה 2026-10-19T10:00:00\.000Z \(נוסח 2026-10-19\)/);
  // שמירה חוזרת (saveBegin) מאפסת מוכנות; saveEnd חדש בלי הצהרה לא מחזיר אותה, ומוחק את ההצהרה הקודמת מהרשומה
  env.call({ action: "saveBegin", token, folderName: "הצהרה — 20.11.2026", rid: b.rid });
  for (const [n, mime] of STD_FILES) env.call({ action: "saveFile", token, folderId: b.folderId, name: n, mime, b64: b64("x" + n) });
  assert.equal(end(undefined).ready, false); assert.equal(logOf(env).find(e => e.id === b.folderId).decl, null);
});
