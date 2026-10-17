// בדיקות שרת Apps Script (apps-script/Code.gs) עם הדמיה של שירותי גוגל: משתמשים, חסימה, סיסמאות, אסימונים ושמירה לדרייב.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
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
  assert.ok(env.call({ action: "saveBegin", token: dave.token, folderName: "בדיקה" }).ok);
  assert.ok(env.call({ action: "setBlocked", token, target: "dave", blocked: true }).ok);
  assert.equal(env.call({ action: "me", token: dave.token }).error, "blocked");
  assert.equal(env.call({ action: "saveBegin", token: dave.token, folderName: "אחרי חסימה" }).error, "blocked");
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
  const b = env.call({ action: "saveBegin", token, folderName: 'פי גלילות, תל אביב — 22.10.2026' });
  assert.ok(b.ok);
  const content = Buffer.from("שלום docx").toString("base64");
  const f1 = env.call({ action: "saveFile", token, folderId: b.folderId, name: "בקשה.docx", mime: "application/octet-stream", b64: content });
  assert.ok(f1.ok);
  const f2 = env.call({ action: "saveFile", token, folderId: b.folderId, name: "בקשה.docx", mime: "application/octet-stream", b64: content });
  assert.ok(f2.ok);
  const live = env.folders[b.folderId].files.filter(f => !f.trashed);
  assert.equal(live.length, 1);
  assert.equal(live[0].bytes.toString("utf8"), "שלום docx");
  const again = env.call({ action: "saveBegin", token, folderName: 'פי גלילות, תל אביב — 22.10.2026' });
  assert.equal(again.folderId, b.folderId);
});

test("שמירה: אי אפשר לכתוב מחוץ לתיקיית הבקשות, שמות מנוקים, ללא אסימון נדחה", () => {
  const { env, token } = bootstrapped();
  env.folders.OUT = { id: "OUT", name: "פרטי", parent: null, files: [] };
  assert.equal(env.call({ action: "saveFile", token, folderId: "OUT", name: "x.txt", b64: "AAAA" }).error, "bad_folder");
  assert.equal(env.call({ action: "saveFile", token, folderId: "nope", name: "x.txt", b64: "AAAA" }).error, "bad_folder");
  const b = env.call({ action: "saveBegin", token, folderName: '../..\\evil:*?"<>|' });
  assert.ok(b.ok && !/[\\/:*?"<>|]/.test(b.name));
  assert.equal(env.call({ action: "saveBegin", folderName: "x" }).ok, false);
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
function savedRequest(env, token, name = "פי גלילות, תל אביב — 22.10.2026", files) {
  const b = env.call({ action: "saveBegin", token, folderName: name });
  assert.ok(b.ok, JSON.stringify(b));
  for (const [n, mime] of (files || [["בקשה.docx", "application/octet-stream"], ["הדמיה.png", "image/png"], ["תצ״א.png", "image/png"], ["קובץ.kml", "application/vnd.google-earth.kml+xml"], ["נתונים.json", "application/json"]]))
    assert.ok(env.call({ action: "saveFile", token, folderId: b.folderId, name: n, mime, b64: b64("תוכן " + n) }).ok);
  return b;
}
const goLive = (env, token) => assert.ok(env.call({ action: "setMailMode", token, mode: "live" }).ok);

test("ברירת מחדל: מצב בדיקה — המייל נשלח רק לבעלים, עם קידומת בדיקה ובלי עותק למשרד נוטאם", () => {
  const { env, token } = bootstrapped();
  assert.equal(env.call({ action: "me", token }).mailMode, "test");
  const b = savedRequest(env, token);
  const r = env.call({ action: "sendRequest", token, folderId: b.folderId, subject: "בקשה לסגירה אווירית — פי גלילות", body: "שלום" });
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
  const r = env.call({ action: "sendRequest", token, folderId: b.folderId, subject: "בקשה לסגירה אווירית — פי גלילות", body: "שלום" });
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
  const r = env.call({ action: "sendRequest", token, folderId: b.folderId, subject: "נושא", body: "גוף", to: "evil@example.com", cc: "evil@example.com", bcc: "evil@example.com", recipients: ["evil@example.com"] });
  assert.ok(r.ok);
  assert.ok(!/evil@example/.test(JSON.stringify(env.mails[0])));
});

test("מצורפים רק Word, KML ותמונות; לא JSON, לא יומן ולא סימוני שליחה", () => {
  const { env, token } = bootstrapped();
  const b = savedRequest(env, token);
  const r = env.call({ action: "sendRequest", token, folderId: b.folderId, subject: "נושא", body: "גוף" });
  assert.deepEqual(r.files.sort(), ["בקשה.docx", "הדמיה.png", "קובץ.kml", "תצ״א.png"].sort());
  assert.equal(env.mails[0].attachments.length, 4);
  const marks = env.folders[b.folderId].files.filter(f => /^נשלח — /.test(f.name));
  assert.equal(marks.length, 1);
  assert.match(marks[0].name, /\(בדיקה\)\.txt$/);
  // שליחה נוספת לא מצרפת את סימון השליחה הקודם
  const r2 = env.call({ action: "sendRequest", token, folderId: b.folderId, subject: "נושא", body: "גוף" });
  assert.ok(r2.ok && !r2.files.some(n => /^נשלח/.test(n)));
});

test("חובה לצרף Word ותמונת מפה/תצ״א (א-11 נספח ג׳): בלי אחד מהם — נדחה", () => {
  const { env, token } = bootstrapped();
  const noImg = savedRequest(env, token, "בלי תמונה", [["בקשה.docx", "x"]]);
  assert.equal(env.call({ action: "sendRequest", token, folderId: noImg.folderId, subject: "נ", body: "ג" }).error, "missing_files");
  const noDoc = savedRequest(env, token, "בלי וורד", [["הדמיה.png", "image/png"]]);
  assert.equal(env.call({ action: "sendRequest", token, folderId: noDoc.folderId, subject: "נ", body: "ג" }).error, "missing_files");
  assert.equal(env.mails.length, 0);
});

test("שליחה חוזרת למשרד נוטאם של אותה בקשה נחסמת, ורק again:true מאפשר; שליחות בדיקה לא חוסמות", () => {
  const { env, token } = bootstrapped();
  const b = savedRequest(env, token);
  assert.ok(env.call({ action: "sendRequest", token, folderId: b.folderId, subject: "נ", body: "ג" }).ok);
  assert.ok(env.call({ action: "sendRequest", token, folderId: b.folderId, subject: "נ", body: "ג" }).ok);   // בדיקה פעמיים — מותר
  goLive(env, token);
  const first = env.call({ action: "sendRequest", token, folderId: b.folderId, subject: "נ", body: "ג" });
  assert.ok(first.ok && first.mode === "live");
  const dup = env.call({ action: "sendRequest", token, folderId: b.folderId, subject: "נ", body: "ג" });
  assert.equal(dup.error, "already_sent"); assert.ok(dup.sentAt > 0);
  assert.equal(env.mails.length, 3);
  assert.ok(env.call({ action: "sendRequest", token, folderId: b.folderId, subject: "נ", body: "ג", again: true }).ok);
  assert.equal(env.mails.length, 4);
});

test("הזרקת כותרות: שורות חדשות ותווי בקרה בנושא מנוקים; גוף נחתך", () => {
  const { env, token } = bootstrapped();
  const b = savedRequest(env, token);
  env.call({ action: "sendRequest", token, folderId: b.folderId, subject: "נושא\r\nBcc: evil@example.com\u2028x", body: "א".repeat(30000) });
  assert.ok(!/[\r\n]/.test(env.mails[0].subject));
  assert.ok(!/\u2028/.test(env.mails[0].subject));
  assert.equal(env.mails[0].body.length, 20000);
  assert.equal(env.call({ action: "sendRequest", token, folderId: b.folderId, subject: "  ", body: "ג" }).error, "bad_mail");
  assert.equal(env.call({ action: "sendRequest", token, folderId: b.folderId, subject: "נ", body: "" }).error, "bad_mail");
});

test("שליחה: רק מתוך תיקיית הבקשות, רק למשתמש מחובר ולא חסום, והגבלת קצב בשעה", () => {
  const { env, token } = bootstrapped();
  env.folders.OUT = { id: "OUT", name: "פרטי", parent: null, files: [{ id: "q", name: "בקשה.docx", mime: "x", bytes: Buffer.from("x"), trashed: false }, { id: "q2", name: "a.png", mime: "x", bytes: Buffer.from("x"), trashed: false }] };
  assert.equal(env.call({ action: "sendRequest", token, folderId: "OUT", subject: "נ", body: "ג" }).error, "bad_folder");
  assert.equal(env.call({ action: "sendRequest", token, folderId: "ROOT", subject: "נ", body: "ג" }).error, "bad_folder");
  assert.equal(env.call({ action: "sendRequest", folderId: "x", subject: "נ", body: "ג" }).ok, false);
  const b = savedRequest(env, token);
  env.call({ action: "addUser", token, newUser: "dave", newPass: "dave-pass-123" });
  const dave = env.call({ action: "login", user: "dave", pass: "dave-pass-123" });
  env.call({ action: "setBlocked", token, target: "dave", blocked: true });
  assert.equal(env.call({ action: "sendRequest", token: dave.token, folderId: b.folderId, subject: "נ", body: "ג" }).error, "blocked");
  for (let i = 0; i < 10; i++) assert.ok(env.call({ action: "sendRequest", token, folderId: b.folderId, subject: "נ", body: "ג" }).ok);
  assert.equal(env.call({ action: "sendRequest", token, folderId: b.folderId, subject: "נ", body: "ג" }).error, "rate");
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
  env.call({ action: "sendRequest", token: dave.token, folderId: b2.folderId, subject: "נ", body: "ג" });
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
  savedRequest(env, dave.token, "אתר ג — 03.11.2026"); savedRequest(env, dave.token, "אתר ג — 03.11.2026");
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
