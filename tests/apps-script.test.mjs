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
