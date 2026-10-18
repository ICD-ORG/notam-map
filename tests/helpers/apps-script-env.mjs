// הדמיה של שירותי Google Apps Script סביב apps-script/Code.gs — משותפת לבדיקות השרת ולבדיקת הדפדפן
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// APPS_SCRIPT_SRC (אופציונלי): קובץ Code.gs חלופי — לאימות שבדיקת רגרסיה נכשלת על הקוד שלפני התיקון; ברירת המחדל היא הקובץ שבמאגר
const SRC = fs.readFileSync(process.env.APPS_SCRIPT_SRC || path.join(ROOT, "apps-script", "Code.gs"), "utf8");
export const ROOT_ID = "ROOT";

export function makeEnv() {
  const props = {}, cache = {}, logs = [];
  // השעון המדומה מתחיל בזמן אמיתי: הדפדפן בבדיקות e2e משווה אותו (פקיעת אסימון) לשעון שלו
  let clock = Date.now();
  const hooks = {}, fail = { drive: false, mail: false, lockBusy: false, wix: 0, logWrite: false, quotaCall: false };
  // מודל נעילת הסקריפט: כבוי כברירת מחדל (tryLock תמיד מצליח). עם lock.strict = true הנעילה היא הדרה הדדית אמיתית — tryLock נכשל בזמן שמישהו מחזיק אותה (המדמה אינו ממתין) —
  // וכל החזקה נרשמת ב-lock.holds עם מספר קריאות הרשת (fetches) והמיילים (mails) שבוצעו בזמן שהנעילה הייתה מוחזקת. hooks.beforeFetch / hooks.beforeMail מאפשרים לדמות doPost מקביל בתוך קריאת רשת.
  const lock = { strict: false, held: false, cur: null, holds: [] };
  const mailQuota = { left: 100000, sentRcpts: 0 };   // נמענים שנותרו ביום / כמה נמענים נשלחו בפועל
  const rcptCount = m => ["to", "cc", "bcc"].reduce((n, k) => n + (m[k] ? String(m[k]).split(",").map(x => x.trim()).filter(Boolean).length : 0), 0);
  // Wix מדומה (Events orders): env.wix.orders = [{orderNumber,status,created,email,firstName,memberId,tickets,eventId}], נבדקים הכותרות והסינון כמו ב-API האמיתי
  const wix = { orders: [], calls: [], eventId: "fbcb2cc1-4dc7-4545-b9d5-08febf9f8153", siteId: "29dca6d8-08d4-4679-a6e5-c5f4f3317d90" };
  const triggers = [];
  const fetchApp = (url, opts) => {
    const u = new URL(url), q = u.searchParams, headers = (opts && opts.headers) || {};
    wix.calls.push({ path: u.pathname, search: u.search, headers });
    if (lock.cur) lock.cur.fetches++;
    if (hooks.beforeFetch) hooks.beforeFetch(u);
    const reply = (code, body) => ({ getResponseCode: () => code, getContentText: () => (typeof body === "string" ? body : JSON.stringify(body)) });
    if (fail.wix) return reply(fail.wix, "boom");
    if (u.host !== "www.wixapis.com" || u.pathname !== "/events/v1/orders") return reply(404, "nf");
    if (!headers.Authorization || headers["wix-site-id"] !== wix.siteId) return reply(401, "unauthorized");
    let list = wix.orders.filter(o => (o.eventId || wix.eventId) === q.get("eventId"));
    const st = q.getAll("status"); if (st.length) list = list.filter(o => st.includes(o.status));
    if (q.get("orderNumber")) list = list.filter(o => o.orderNumber === q.get("orderNumber"));
    const sp = (q.get("searchPhrase") || "").toLowerCase();   // חיפוש חלקי (כמו Wix): הקוד חייב להשוות שוויון בעצמו
    if (sp) list = list.filter(o => [o.email, o.firstName, o.orderNumber].some(x => String(x || "").toLowerCase().includes(sp)) || (o.tickets || []).some(t => String((t.guestDetails || {}).email || "").toLowerCase().includes(sp)));
    const off = Number(q.get("offset") || 0), lim = Math.min(100, Number(q.get("limit") || 100));
    const page = list.slice(off, off + lim).map(o => { const c = { ...o }; delete c.eventId; return c; });
    return reply(200, { total: list.length, offset: off, limit: lim, orders: page, facets: {} });
  };
  const toBuf = v => Array.isArray(v) ? Buffer.from(v.map(x => x & 0xff)) : Buffer.from(String(v), "utf8");
  const signed = b => [...b].map(x => (x > 127 ? x - 256 : x));
  // Drive מדומה: תיקיות וקבצים בזיכרון
  const folders = { ROOT: { id: "ROOT", name: "root", parent: null, files: [] } };
  let seq = 0;
  const mails = [];
  const fileApi = file => ({
    getId: () => file.id, getUrl: () => "https://drive/file/" + file.id, getName: () => file.name, getSize: () => file.bytes.length,
    setTrashed: t => { file.trashed = t; }, setContent: c => { if (fail.logWrite && file.name.startsWith("_")) throw new Error("drive write failed"); file.bytes = Buffer.from(String(c), "utf8"); },
    getBlob: () => ({ bytes: file.bytes, mime: file.mime, name: file.name, getDataAsString: () => file.bytes.toString("utf8") }),
  });
  const mkFolder = f => ({
    getId: () => f.id, getUrl: () => "https://drive/" + f.id, getName: () => f.name, setName: n => { f.name = n; }, isTrashed: () => !!f.trashed,
    getParents() { const p = f.parent && folders[f.parent]; let used = !p; return { hasNext: () => !used, next: () => { used = true; return mkFolder(p); } }; },
    // כמו Drive האמיתי: getFoldersByName לא מחזיר תיקיות שבפח
    getFoldersByName(n) { const hit = Object.values(folders).filter(x => x.parent === f.id && x.name === n && !x.trashed); let i = 0; return { hasNext: () => i < hit.length, next: () => mkFolder(hit[i++]) }; },
    createFolder(n) { if (hooks.beforeCreateFolder) hooks.beforeCreateFolder(n, f.id); const id = "F" + ++seq; folders[id] = { id, name: n, parent: f.id, files: [] }; return mkFolder(folders[id]); },
    getFilesByName(n) { const hit = f.files.filter(x => x.name === n && !x.trashed); let i = 0; return { hasNext: () => i < hit.length, next: () => fileApi(hit[i++]) }; },
    getFiles() { const hit = f.files.filter(x => !x.trashed); let i = 0; return { hasNext: () => i < hit.length, next: () => fileApi(hit[i++]) }; },
    createFile(a1, content, mime) {
      const file = typeof a1 === "object" ? { id: "X" + ++seq, name: a1.name, mime: a1.mime, bytes: a1.bytes, trashed: false }
        : { id: "X" + ++seq, name: a1, mime: mime || "text/plain", bytes: Buffer.from(String(content), "utf8"), trashed: false };
      f.files.push(file); return fileApi(file);
    },
  });
  const tzFmt = (d, tz, pat) => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map(x => [x.type, x.value])); return pat.replace("yyyy", p.year).replace("MM", p.month).replace("dd", p.day).replace("HH", p.hour).replace("mm", p.minute); };
  const sandbox = {
    Logger: { log: m => logs.push(String(m)) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; }, getProperties: () => ({ ...props }) }) },
    UrlFetchApp: { fetch: fetchApp },
    ScriptApp: { getProjectTriggers: () => triggers.slice(), deleteTrigger: t => { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); },
      newTrigger: fn => { const t = { fn, getHandlerFunction: () => fn, spec: {} }; const b = { timeBased: () => b, everyDays: n => { t.spec.days = n; return b; }, atHour: h => { t.spec.hour = h; return b; }, inTimezone: z => { t.spec.tz = z; return b; }, create: () => { triggers.push(t); return t; } }; return b; } },
    // MailApp מדומה כמו האמיתי: המכסה היומית נספרת לפי נמענים (to+cc+bcc), ושליחה מעבר למה שנותר זורקת. ברירת המחדל גדולה מאוד — בדיקות מורידות env.mailQuota.left כדי לדמות מכסה שנגמרת.
    // להסרת הפונקציה (שרת/מדמה ישן): delete env.sandbox.MailApp.getRemainingDailyQuota. fail.quotaCall = true => הקריאה לבדיקת המכסה עצמה זורקת.
    MailApp: {
      sendEmail: m => {
        if (lock.cur) lock.cur.mails++;
        if (hooks.beforeMail) hooks.beforeMail(m);
        if (fail.mail) throw new Error("mail down");
        const n = rcptCount(m);
        if (n > mailQuota.left) throw new Error("Service invoked too many times for one day: email.");
        mailQuota.left -= n; mailQuota.sentRcpts += n;
        mails.push(m);
      },
      getRemainingDailyQuota: () => { if (fail.quotaCall) throw new Error("quota api down"); return mailQuota.left; },
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => "owner@icd.test" }) },
    CacheService: { getScriptCache: () => ({ get: k => (cache[k] && cache[k].exp > clock ? cache[k].v : null), put: (k, v, s) => { cache[k] = { v, exp: clock + s * 1000 }; }, remove: k => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({
      tryLock: () => {
        if (fail.lockBusy) return false;
        if (!lock.strict) return true;
        if (lock.held) return false;
        lock.held = true; lock.cur = { fetches: 0, mails: 0 }; lock.holds.push(lock.cur); return true;
      },
      releaseLock() { if (lock.strict) { lock.held = false; lock.cur = null; } },
    }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: t => ({ text: t, setMimeType() { return this; } }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" },
      computeDigest: (_a, s) => signed(crypto.createHash("sha256").update(toBuf(s)).digest()),
      computeHmacSha256Signature: (v, k) => signed(crypto.createHmac("sha256", toBuf(k)).update(toBuf(v)).digest()),
      getUuid: () => crypto.randomUUID(),
      base64EncodeWebSafe: v => toBuf(v).toString("base64url"),
      base64DecodeWebSafe: s => signed(Buffer.from(s, "base64url")),
      base64Decode: s => signed(Buffer.from(s, "base64")),
      formatDate: tzFmt,
      newBlob: (bytes, mime, name) => ({ bytes: toBuf(bytes), mime, name, getDataAsString: () => toBuf(bytes).toString("utf8") }),
    },
    DriveApp: { getFolderById: id => { if (fail.drive) throw new Error("drive down"); if (!folders[id]) throw new Error("no folder"); return mkFolder(folders[id]); } },
    Date: Object.assign(function (...a) { return new Date(...a); }, { now: () => clock }),
    Math, JSON, String, Number, Object, Array, Error, RegExp, parseInt,
  };
  sandbox.Date.prototype = Date.prototype;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: "Code.gs" });
  vm.runInContext("CFG.ROOT_FOLDER_ID = '" + ROOT_ID + "'", sandbox);   // בבדיקות התיקייה הראשית היא ההדמיה
  const call = (obj) => JSON.parse(vm.runInContext("doPost", sandbox)({ postData: { contents: JSON.stringify(obj) } }).text);
  return { sandbox, call, props, logs, folders, mails, hooks, fail, wix, triggers, mailQuota, lock, now: () => clock, advance: ms => { clock += ms; },
    run: name => vm.runInContext(name + "()", sandbox), doGet: () => JSON.parse(vm.runInContext("doGet", sandbox)().text) };
}

