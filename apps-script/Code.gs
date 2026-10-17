/**
 * שרת בקשות הטיסה של הארגון הישראלי לרחפנים — Google Apps Script (רץ בחשבון של הבעלים).
 *  - התחברות נפרדת בשם משתמש וסיסמה (לא קשורה לשער חברי האתר).
 *  - ניהול משתמשים: הוספה, חסימה/ביטול חסימה, איפוס סיסמה, החלפת סיסמה עצמית. הכול נאכף כאן, בשרת, בכל קריאה.
 *  - שמירת קבצי הבקשה (Word, KML, תמונות) בתיקייה בדרייב: תת-תיקייה בשם "<מקום> — <תאריך>".
 * התקנה: ראו apps-script/README.md. הקוד אינו מכיל סיסמאות או מזהים סודיים; הם נשמרים ב-Script Properties בלבד.
 */

var CFG = {
  APP: 'icd-flight-requests',
  ROOT_FOLDER_ID: '1UvfFhmCau9P_mbfhSFP2AmOHMbvkVbtL',   // "בקשות סגירה אווירית — מערכת אוטומטית" בדרייב
  TOKEN_HOURS: 8,
  MIN_PASS: 10,
  MAX_FAILS: 5,            // ניסיונות כושלים לפני נעילה
  LOCK_MINUTES: 15,
  HASH_ROUNDS: 200,
  MAX_FILE_B64: 9 * 1024 * 1024   // תקרת קובץ בודד אחרי קידוד base64
};

/* ---------- עזרים ---------- */
function props_() { return PropertiesService.getScriptProperties(); }
function now_() { return Date.now(); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function fail_(code, msg) { return json_({ ok: false, error: code, message: msg || code }); }
function bytesToHex_(b) { var s = ''; for (var i = 0; i < b.length; i++) { var v = (b[i] & 0xff).toString(16); s += (v.length < 2 ? '0' : '') + v; } return s; }
function sha256Hex_(str) { return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8)); }
function hashPass_(salt, pass) { var h = salt + '|' + pass; for (var i = 0; i < CFG.HASH_ROUNDS; i++) h = sha256Hex_(salt + h); return h; }
function randHex_(n) { var s = ''; while (s.length < n) s += sha256Hex_(Utilities.getUuid() + now_() + Math.random()); return s.slice(0, n); }
function safeEq_(a, b) { a = String(a); b = String(b); if (a.length !== b.length) return false; var r = 0; for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

function users_() { try { return JSON.parse(props_().getProperty('USERS') || '{}'); } catch (e) { return {}; } }
function saveUsers_(u) { props_().setProperty('USERS', JSON.stringify(u)); }
function secret_() { var s = props_().getProperty('SECRET'); if (!s) throw new Error('לא בוצעה אתחול — להריץ initialize()'); return s; }

/* ---------- אסימון חתום ---------- */
function sign_(payload) {
  var sig = Utilities.computeHmacSha256Signature(payload, secret_());
  return Utilities.base64EncodeWebSafe(sig);
}
function makeToken_(name, u) {
  var exp = now_() + CFG.TOKEN_HOURS * 3600 * 1000;
  var payload = Utilities.base64EncodeWebSafe([name, u.role, u.tv, exp].join('|'), Utilities.Charset.UTF_8);
  return { token: payload + '.' + sign_(payload), exp: exp };
}
// מחזיר {name,user} או {error}. בודק חתימה, תפוגה, שהמשתמש קיים, לא חסום, ושגרסת האסימון (tv) עדכנית.
function auth_(token) {
  if (!token || String(token).indexOf('.') < 0) return { error: 'auth' };
  var parts = String(token).split('.');
  if (!safeEq_(parts[1], sign_(parts[0]))) return { error: 'auth' };
  var f;
  try { f = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString('UTF-8').split('|'); } catch (e) { return { error: 'auth' }; }
  var name = f[0], exp = Number(f[3]);
  if (!(exp > now_())) return { error: 'expired' };
  var us = users_(), u = us[name];
  if (!u) return { error: 'auth' };
  if (u.blocked) return { error: 'blocked' };
  if (String(u.tv) !== f[2] || u.role !== f[1]) return { error: 'auth' };
  return { name: name, user: u };
}

/* ---------- הגבלת ניסיונות כניסה ---------- */
function failsKey_(name) { return 'fails:' + sha256Hex_(String(name).toLowerCase()).slice(0, 24); }
function lockedFor_(name) {
  var c = CacheService.getScriptCache().get(failsKey_(name));
  return c && Number(c) >= CFG.MAX_FAILS;
}
function noteFail_(name) {
  var cache = CacheService.getScriptCache(), k = failsKey_(name);
  cache.put(k, String((Number(cache.get(k)) || 0) + 1), CFG.LOCK_MINUTES * 60);
}
function clearFails_(name) { CacheService.getScriptCache().remove(failsKey_(name)); }

/* ---------- בדיקות קלט ---------- */
function validName_(n) { return typeof n === 'string' && /^[A-Za-z0-9._\-֐-׿ ]{3,40}$/.test(n) && n === n.trim(); }
function validPass_(p) { return typeof p === 'string' && p.length >= CFG.MIN_PASS && p.length <= 200; }
function cleanFolderName_(s) { return String(s || '').replace(/[\\/:*?"<>|‎‏‪-‮]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120); }
function cleanFileName_(s) { return cleanFolderName_(s) || 'file'; }

/* ---------- אתחול (פעם אחת, מהעורך) ---------- */
function initialize() {
  var p = props_();
  if (!p.getProperty('SECRET')) p.setProperty('SECRET', randHex_(64));
  if (!p.getProperty('USERS')) {
    var code = randHex_(10);
    p.setProperty('SETUP_CODE', sha256Hex_(code));
    Logger.log('קוד הקמה חד-פעמי (להקליד בדף ההתחברות בשדה "קוד הקמה"): ' + code);
    return code;
  }
  Logger.log('כבר מאותחל. אם אין לך מנהל — מחק את המאפיין USERS ב-Script Properties והרץ שוב.');
  return null;
}

/* ---------- נקודות כניסה ---------- */
function doGet() {
  var us = users_();
  return json_({ ok: true, app: CFG.APP, needsBootstrap: Object.keys(us).length === 0 && !!props_().getProperty('SETUP_CODE') });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var locked = lock.tryLock(20000);
  try {
    if (!locked) return fail_('busy', 'השרת עסוק, נסו שוב');
    var req;
    try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return fail_('bad_request'); }
    var h = ACTIONS[req.action];
    if (!h) return fail_('bad_action');
    return json_(h(req));
  } catch (err) {
    return fail_('server', String(err && err.message || err));
  } finally {
    if (locked) lock.releaseLock();
  }
}

/* ---------- פעולות ---------- */
var ACTIONS = {
  bootstrap: function (r) {
    var us = users_();
    if (Object.keys(us).length) return { ok: false, error: 'exists' };
    var sc = props_().getProperty('SETUP_CODE');
    if (!sc) return { ok: false, error: 'no_setup' };
    if (lockedFor_('bootstrap')) return { ok: false, error: 'locked' };
    if (!safeEq_(sha256Hex_(String(r.code || '')), sc)) { noteFail_('bootstrap'); return { ok: false, error: 'bad_code' }; }
    if (!validName_(r.user)) return { ok: false, error: 'bad_user' };
    if (!validPass_(r.pass)) return { ok: false, error: 'weak_pass' };
    var salt = randHex_(24);
    us[r.user] = { role: 'admin', blocked: false, tv: 1, salt: salt, hash: hashPass_(salt, r.pass), created: now_(), changed: now_() };
    saveUsers_(us);
    props_().deleteProperty('SETUP_CODE');
    return loginOk_(r.user, us[r.user]);
  },

  login: function (r) {
    var name = String(r.user || '');
    if (lockedFor_(name)) return { ok: false, error: 'locked', message: 'יותר מדי ניסיונות — נסו שוב בעוד ' + CFG.LOCK_MINUTES + ' דקות' };
    var us = users_(), u = us[name];
    var good = !!u && safeEq_(hashPass_(u.salt, String(r.pass || '')), u.hash);
    if (!good) { noteFail_(name); return { ok: false, error: 'bad_login' }; }
    if (u.blocked) return { ok: false, error: 'blocked' };
    clearFails_(name);
    u.lastLogin = now_(); saveUsers_(us);
    return loginOk_(name, u);
  },

  me: function (r) {
    var a = auth_(r.token); if (a.error) return { ok: false, error: a.error };
    return { ok: true, user: a.name, role: a.user.role };
  },

  changePassword: function (r) {
    var a = auth_(r.token); if (a.error) return { ok: false, error: a.error };
    if (!validPass_(r.newPass)) return { ok: false, error: 'weak_pass' };
    var us = users_(), u = us[a.name];
    if (!safeEq_(hashPass_(u.salt, String(r.oldPass || '')), u.hash)) return { ok: false, error: 'bad_login' };
    u.salt = randHex_(24); u.hash = hashPass_(u.salt, r.newPass); u.tv = (u.tv || 1) + 1; u.changed = now_();
    saveUsers_(us);
    return loginOk_(a.name, u);
  },

  listUsers: function (r) {
    var a = admin_(r); if (a.error) return { ok: false, error: a.error };
    var us = users_();
    return { ok: true, users: Object.keys(us).sort().map(function (k) { var u = us[k]; return { user: k, role: u.role, blocked: !!u.blocked, created: u.created, changed: u.changed, lastLogin: u.lastLogin || null }; }) };
  },

  addUser: function (r) {
    var a = admin_(r); if (a.error) return { ok: false, error: a.error };
    var us = users_();
    if (!validName_(r.newUser)) return { ok: false, error: 'bad_user' };
    if (!validPass_(r.newPass)) return { ok: false, error: 'weak_pass' };
    if (us[r.newUser]) return { ok: false, error: 'exists' };
    var salt = randHex_(24);
    us[r.newUser] = { role: r.role === 'admin' ? 'admin' : 'user', blocked: false, tv: 1, salt: salt, hash: hashPass_(salt, r.newPass), created: now_(), changed: now_() };
    saveUsers_(us);
    return { ok: true };
  },

  setBlocked: function (r) {
    var a = admin_(r); if (a.error) return { ok: false, error: a.error };
    var us = users_(), u = us[r.target];
    if (!u) return { ok: false, error: 'no_user' };
    if (r.target === a.name) return { ok: false, error: 'self' };
    u.blocked = !!r.blocked; u.tv = (u.tv || 1) + 1;     // מבטל מיידית כל אסימון קיים
    saveUsers_(us);
    return { ok: true };
  },

  resetPassword: function (r) {
    var a = admin_(r); if (a.error) return { ok: false, error: a.error };
    var us = users_(), u = us[r.target];
    if (!u) return { ok: false, error: 'no_user' };
    if (!validPass_(r.newPass)) return { ok: false, error: 'weak_pass' };
    u.salt = randHex_(24); u.hash = hashPass_(u.salt, r.newPass); u.tv = (u.tv || 1) + 1; u.changed = now_();
    saveUsers_(us);
    return { ok: true };
  },

  deleteUser: function (r) {
    var a = admin_(r); if (a.error) return { ok: false, error: a.error };
    var us = users_();
    if (!us[r.target]) return { ok: false, error: 'no_user' };
    if (r.target === a.name) return { ok: false, error: 'self' };
    delete us[r.target]; saveUsers_(us);
    return { ok: true };
  },

  saveBegin: function (r) {
    var a = auth_(r.token); if (a.error) return { ok: false, error: a.error };
    var name = cleanFolderName_(r.folderName);
    if (!name) return { ok: false, error: 'bad_name' };
    var root = DriveApp.getFolderById(CFG.ROOT_FOLDER_ID);
    var it = root.getFoldersByName(name), f = it.hasNext() ? it.next() : root.createFolder(name);
    return { ok: true, folderId: f.getId(), url: f.getUrl(), name: name };
  },

  saveFile: function (r) {
    var a = auth_(r.token); if (a.error) return { ok: false, error: a.error };
    var b64 = String(r.b64 || '');
    if (!b64 || b64.length > CFG.MAX_FILE_B64) return { ok: false, error: 'bad_file' };
    var folder;
    try { folder = DriveApp.getFolderById(String(r.folderId)); } catch (err) { return { ok: false, error: 'bad_folder' }; }
    if (!isUnderRoot_(folder)) return { ok: false, error: 'bad_folder' };     // כתיבה רק לתוך תיקיית הבקשות
    var fname = cleanFileName_(r.name), old = folder.getFilesByName(fname);
    while (old.hasNext()) old.next().setTrashed(true);                         // גרסה חדשה מחליפה ישנה באותו שם
    var blob = Utilities.newBlob(Utilities.base64Decode(b64), String(r.mime || 'application/octet-stream'), fname);
    var file = folder.createFile(blob);
    return { ok: true, id: file.getId(), url: file.getUrl() };
  }
};

function loginOk_(name, u) {
  var t = makeToken_(name, u);
  return { ok: true, token: t.token, exp: t.exp, user: name, role: u.role };
}
function admin_(r) {
  var a = auth_(r.token);
  if (a.error) return a;
  if (a.user.role !== 'admin') return { error: 'forbidden' };
  return a;
}
function isUnderRoot_(folder) {
  var seen = 0, cur = folder;
  while (cur && seen++ < 10) {
    if (cur.getId() === CFG.ROOT_FOLDER_ID) return true;
    var ps = cur.getParents();
    cur = ps.hasNext() ? ps.next() : null;
  }
  return false;
}
