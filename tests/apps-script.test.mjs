// בדיקות שרת Apps Script (apps-script/Code.gs) עם הדמיה של שירותי גוגל: משתמשים, חסימה, סיסמאות, אסימונים ושמירה לדרייב.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import crypto from "node:crypto";
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

test("גיזום היומן לא מוחק רשומה עם שליחה חיה; מוחק קודם בקשות ישנות שלא נשלחו", () => {
  const { env, token } = bootstrapped(); goLive(env, token);
  vm.runInContext("CFG.LOG_MAX = 4", env.sandbox);
  const sent = savedRequest(env, token, "נשלחה — 01.11.2026");
  assert.ok(env.call(sendBody(env, token, sent.folderId)).ok);
  const names = [];
  for (let i = 0; i < 8; i++) names.push(savedRequest(env, token, "טיוטה " + i).name);
  const log = JSON.parse(env.folders.ROOT.files.find(f => f.name === "_יומן בקשות.json").bytes.toString());
  assert.equal(log.length, 4);
  assert.ok(log.some(x => x.id === sent.folderId), "הרשומה שנשלחה חי נשמרה");
  assert.equal(env.call({ action: "sendRequest", expectMode: "live", token, folderId: sent.folderId, subject: "נ", body: "ג" }).error, "already_sent");
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

test("הרשמה: הגבלת קצב לכתובת ולשרת כולו", () => {
  const { env } = withWix();
  for (let i = 0; i < 5; i++) assert.ok(env.call({ action: "regStart", email: "x@example.com" }).ok);
  assert.equal(env.call({ action: "regStart", email: "x@example.com" }).error, "rate");
  env.advance(61 * 60000);
  assert.ok(env.call({ action: "regStart", email: "x@example.com" }).ok);
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

test("הגבלת קצב: נספרת לכל משתמש בנפרד (גם שליחה לעצמו); מטיס אחד לא חוסם אחרים; יש תקרה כוללת; מתאפסת אחרי שעה", () => {
  const { env, token } = withWix();
  const a = pilotUser(env, "a@example.com", "pilot.a"), c = pilotUser(env, "c@example.com", "pilot.c");
  const ba = savedRequest(env, a.token, "קצב א — 15.12.2026"), bc = savedRequest(env, c.token, "קצב ג — 15.12.2026");
  for (let i = 0; i < 10; i++) assert.ok(sendTo(env, a.token, ba.folderId, { target: "self" }).ok, "i=" + i);
  assert.equal(sendTo(env, a.token, ba.folderId, { target: "self" }).error, "rate", "שליחה 11 לעצמו");
  assert.equal(sendTo(env, a.token, ba.folderId, { target: "office" }).error, "rate", "גם למשרד — אותה מכסה");
  assert.equal(env.mails.length, 10);
  assert.ok(sendTo(env, c.token, bc.folderId, { target: "office" }).ok, "מטיס אחר לא נחסם");
  assert.ok(sendTo(env, token, savedRequest(env, token, "מנהל — 15.12.2026").folderId, { target: "self" }).ok, "המנהל לא נחסם");
  env.advance(61 * 60000);
  assert.ok(sendTo(env, a.token, ba.folderId, { target: "self" }).ok, "אחרי שעה");
  // תקרה כוללת למערכת
  vm.runInContext("CFG.MAX_SENDS_PER_HOUR_ALL = 3", env.sandbox);
  env.advance(61 * 60000);
  const d = pilotUser(env, "d@example.com", "pilot.d"), bd = savedRequest(env, d.token, "קצב ד — 15.12.2026");
  const got = [a, c, d, token].map((u, i) => sendTo(env, u === token ? token : u.token, u === a ? ba.folderId : u === c ? bc.folderId : u === d ? bd.folderId : savedRequest(env, token, "מנהל ב — 15.12.2026").folderId, { target: "self" }));
  assert.deepEqual(got.map(x => x.ok || x.error), [true, true, true, "rate"]);
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
