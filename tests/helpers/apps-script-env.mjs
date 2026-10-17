// הדמיה של שירותי Google Apps Script סביב apps-script/Code.gs — משותפת לבדיקות השרת ולבדיקת הדפדפן
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = fs.readFileSync(path.join(ROOT, "apps-script", "Code.gs"), "utf8");
export const ROOT_ID = "ROOT";

export function makeEnv() {
  const props = {}, cache = {}, logs = [];
  let clock = 1_800_000_000_000;
  const toBuf = v => Array.isArray(v) ? Buffer.from(v.map(x => x & 0xff)) : Buffer.from(String(v), "utf8");
  const signed = b => [...b].map(x => (x > 127 ? x - 256 : x));
  // Drive מדומה: תיקיות וקבצים בזיכרון
  const folders = { ROOT: { id: "ROOT", name: "root", parent: null, files: [] } };
  let seq = 0;
  const mkFolder = f => ({
    getId: () => f.id, getUrl: () => "https://drive/" + f.id,
    getParents() { const p = f.parent && folders[f.parent]; let used = !p; return { hasNext: () => !used, next: () => { used = true; return mkFolder(p); } }; },
    getFoldersByName(n) { const hit = Object.values(folders).filter(x => x.parent === f.id && x.name === n); let i = 0; return { hasNext: () => i < hit.length, next: () => mkFolder(hit[i++]) }; },
    createFolder(n) { const id = "F" + ++seq; folders[id] = { id, name: n, parent: f.id, files: [] }; return mkFolder(folders[id]); },
    getFilesByName(n) { const hit = f.files.filter(x => x.name === n && !x.trashed); let i = 0; return { hasNext: () => i < hit.length, next: () => ({ setTrashed: t => { hit[i++].trashed = t; } }) }; },
    createFile(blob) { const file = { id: "X" + ++seq, name: blob.name, mime: blob.mime, bytes: blob.bytes, trashed: false }; f.files.push(file); return { getId: () => file.id, getUrl: () => "https://drive/file/" + file.id }; },
  });
  const sandbox = {
    Logger: { log: m => logs.push(String(m)) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; } }) },
    CacheService: { getScriptCache: () => ({ get: k => (cache[k] && cache[k].exp > clock ? cache[k].v : null), put: (k, v, s) => { cache[k] = { v, exp: clock + s * 1000 }; }, remove: k => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: t => ({ text: t, setMimeType() { return this; } }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" },
      computeDigest: (_a, s) => signed(crypto.createHash("sha256").update(toBuf(s)).digest()),
      computeHmacSha256Signature: (v, k) => signed(crypto.createHmac("sha256", toBuf(k)).update(toBuf(v)).digest()),
      getUuid: () => crypto.randomUUID(),
      base64EncodeWebSafe: v => toBuf(v).toString("base64url"),
      base64DecodeWebSafe: s => signed(Buffer.from(s, "base64url")),
      base64Decode: s => signed(Buffer.from(s, "base64")),
      newBlob: (bytes, mime, name) => ({ bytes: toBuf(bytes), mime, name, getDataAsString: () => toBuf(bytes).toString("utf8") }),
    },
    DriveApp: { getFolderById: id => { if (!folders[id]) throw new Error("no folder"); return mkFolder(folders[id]); } },
    Date: Object.assign(function (...a) { return new Date(...a); }, { now: () => clock }),
    Math, JSON, String, Number, Object, Array, Error, RegExp, parseInt,
  };
  sandbox.Date.prototype = Date.prototype;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: "Code.gs" });
  vm.runInContext("CFG.ROOT_FOLDER_ID = '" + ROOT_ID + "'", sandbox);   // בבדיקות התיקייה הראשית היא ההדמיה
  const call = (obj) => JSON.parse(vm.runInContext("doPost", sandbox)({ postData: { contents: JSON.stringify(obj) } }).text);
  return { sandbox, call, props, logs, folders, advance: ms => { clock += ms; },
    run: name => vm.runInContext(name + "()", sandbox), doGet: () => JSON.parse(vm.runInContext("doGet", sandbox)().text) };
}

