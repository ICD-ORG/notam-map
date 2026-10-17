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

test("ברירת מחדל: מצב בדיקה — המייל נשלח רק לבעלים, עם קידומת בדיקה ובלי עותק למשרד נוטאם", () => {
  const { env, token } = bootstrapped();
  assert.equal(env.call({ action: "me", token }).mailMode, "test");
  const b = savedRequest(env, token);
  const r = env.call({ action: "sendRequest", expectMode: modeOf(env), token, folderId: b.folderId, subject: "בקשה לסגירה אווירית — פי גלילות", body: "שלום" });
  assert.ok(r.ok && r.mode === "test", JSON.stringify(r));
  assert.deepEqual(r.to, ["owner@icd.test"]);
  assert.equal(env.mails.length, 1);
  assert.equal(env.mails[0].to, "owner@icd.test");
  assert.match(env.mails[0].subject, /^\[בדיקה — לא נשלח למשרד נוטאם\] בקשה לסגירה אווירית/);
  assert.ok(!/iaa\.gov\.il/.test(JSON.stringify(env.mails[0])));
});

test("מצב חי: נמענים קבועים מפמ״ת א-11 סעיף 6(א) בלבד, עותק לבעלים, נושא ללא קידומת", () => {
  const { env, token } = bootstrapped(); goLive(env, token);
  const b = savedRequest(env, token);
  const r = env.call({ action: "sendRequest", expectMode: modeOf(env), token, folderId: b.folderId, subject: "בקשה לסגירה אווירית — פי גלילות", body: "שלום" });
  assert.ok(r.ok && r.mode === "live");
  assert.deepEqual(r.to, ["notamoffice@iaa.gov.il", "nofm@iaa.gov.il"]);
  const m = env.mails[0];
  assert.equal(m.to, "notamoffice@iaa.gov.il,nofm@iaa.gov.il");
  assert.equal(m.cc, "owner@icd.test");
  assert.equal(m.subject, "בקשה לסגירה אווירית — פי גלילות");
  assert.equal(m.replyTo, "owner@icd.test");
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
