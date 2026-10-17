/**
 * שרת בקשות הטיסה של הארגון הישראלי לרחפנים — Google Apps Script (רץ בחשבון של הבעלים).
 *  - התחברות נפרדת בשם משתמש וסיסמה (לא קשורה לשער חברי האתר).
 *  - ניהול משתמשים: הוספה, חסימה/ביטול חסימה, איפוס סיסמה, החלפת סיסמה עצמית, מחיקה — הכול נאכף כאן, בשרת, בכל קריאה.
 *  - שמירת קבצי הבקשה (Word, KML, תמונות) בתיקייה בדרייב: תת-תיקייה בשם "<מקום> — <תאריך>".
 *  - יומן בקשות: מי שמר ושלח מה ומתי (קובץ _יומן בקשות.json בתיקיית הבקשות) — המנהל רואה את כולם.
 *  - שליחה למשרד נוטאם במייל, עם הקבצים מהתיקייה, לכתובות הקבועות מפמ"ת א-11 סעיף 6(א) בלבד.
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
  MAX_FILE_B64: 9 * 1024 * 1024,   // תקרת קובץ בודד אחרי קידוד base64
  // פמ"ת פנים ארצי א-11 (עדכון 1/26), סעיף 6(א): "יש להגיש בקשה לסגירה אווירית למשרד נוטאם בכתובות המייל הבאות:
  // notamoffice@iaa.gov.il, nofm@iaa.gov.il על גבי טופס כמפורט בנספח ג'". הנמענים קבועים כאן ואינם מתקבלים מהדפדפן.
  MAIL_TO: ['notamoffice@iaa.gov.il', 'nofm@iaa.gov.il'],
  SENDER_NAME: 'הארגון הישראלי לרב להב',
  MAX_SENDS_PER_HOUR: 10,
  MAX_MAIL_BYTES: 24 * 1024 * 1024,
  LOG_NAME: '_יומן בקשות.json',
  LOG_MAX: 1000
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

/* משתמשים: כל משתמש במאפיין נפרד "U:<שם>" — כדי לא להיתקל במגבלת 9KB של מאפיין בודד */
var UP = 'U:';
function users_() {
  var all = props_().getProperties(), out = {};
  for (var k in all) if (k.indexOf(UP) === 0) { try { out[k.slice(UP.length)] = JSON.parse(all[k]); } catch (e) { /* מדלגים על רשומה פגומה */ } }
  return out;
}
function getUser_(name) { var v = props_().getProperty(UP + name); if (!v) return null; try { return JSON.parse(v); } catch (e) { return null; } }
function putUser_(name, u) { props_().setProperty(UP + name, JSON.stringify(u)); }
function delUser_(name) { props_().deleteProperty(UP + name); }
function countUsers_() { return Object.keys(users_()).length; }
function secret_() { var s = props_().getProperty('SECRET'); if (!s) throw new Error('לא בוצעה אתחול — להריץ initialize()'); return s; }
function ownerEmail_() { try { return Session.getEffectiveUser().getEmail() || ''; } catch (e) { return ''; } }
// מצב שליחה: 'test' (ברירת מחדל) — המייל נשלח רק לבעלים; 'live' — למשרד נוטאם. רק מנהל משנה (setMailMode).
function mailMode_() { return props_().getProperty('MAIL_MODE') === 'live' ? 'live' : 'test'; }

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
  var u = getUser_(name);
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
function validName_(n) { return typeof n === 'string' && /^[A-Za-z0-9._\-\u0590-\u05FF ]{3,40}$/.test(n) && n === n.trim(); }
function validPass_(p) { return typeof p === 'string' && p.length >= CFG.MIN_PASS && p.length <= 200; }
function cleanFolderName_(s) { return String(s || '').replace(/[\\/:*?"<>|\u200e\u200f\u202a-\u202e]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120); }
function cleanFileName_(s) { return cleanFolderName_(s) || 'file'; }
// נושא מייל: שורה אחת בלבד (מונע הזרקת כותרות), ללא תווי בקרה
function cleanSubject_(s) { return String(s || '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200); }
function cleanBody_(s) { return String(s || '').replace(/\r\n?/g, '\n').replace(/\r/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, 20000); }

/* ---------- אתחול (פעם אחת, מהעורך) ---------- */
function initialize() {
  var p = props_();
  if (!p.getProperty('SECRET')) p.setProperty('SECRET', randHex_(64));
  if (!countUsers_()) {
    var code = randHex_(10);
    p.setProperty('SETUP_CODE', sha256Hex_(code));
    Logger.log('קוד הקמה חד-פעמי (להקליד בדף ההתחברות בשדה "קוד הקמה"): ' + code);
    return code;
  }
  Logger.log('כבר מאותחל. אם אין לך מנהל — מחק את המאפיינים שמתחילים ב-"U:" ב-Script Properties והרץ שוב.');
  return null;
}

/* ---------- נקודות כניסה ---------- */
function doGet() {
  return json_({ ok: true, app: CFG.APP, needsBootstrap: countUsers_() === 0 && !!props_().getProperty('SETUP_CODE') });
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

/* ---------- יומן בקשות (קובץ בתיקיית הבקשות) ---------- */
function logFile_() {
  var root = DriveApp.getFolderById(CFG.ROOT_FOLDER_ID), it = root.getFilesByName(CFG.LOG_NAME);
  return it.hasNext() ? it.next() : root.createFile(CFG.LOG_NAME, '[]', 'application/json');
}
function readLog_() { try { var a = JSON.parse(logFile_().getBlob().getDataAsString('UTF-8')); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function writeLog_(arr) { logFile_().setContent(JSON.stringify(arr.slice(-CFG.LOG_MAX))); }
// רשומה אחת לכל תיקיית בקשה: מי יצר, מי שמר לאחרונה, ורשימת שליחות
function logSave_(user, folderId, name) {
  var log = readLog_(), t = now_(), i;
  for (i = 0; i < log.length; i++) if (log[i].id === folderId) break;
  if (i === log.length) log.push({ id: folderId, name: name, user: user, created: t, saved: t, lastUser: user, sent: [] });
  else { log[i].saved = t; log[i].lastUser = user; log[i].name = name; }
  writeLog_(log);
}
function logSent_(user, folderId, name, mode, to) {
  var log = readLog_(), t = now_(), i;
  for (i = 0; i < log.length; i++) if (log[i].id === folderId) break;
  if (i === log.length) { log.push({ id: folderId, name: name, user: user, created: t, saved: t, lastUser: user, sent: [] }); i = log.length - 1; }
  log[i].sent.push({ t: t, user: user, mode: mode, to: to });
  writeLog_(log);
  return t;
}
function liveSentAt_(entry) { var last = 0; ((entry && entry.sent) || []).forEach(function (s) { if (s.mode === 'live' && s.t > last) last = s.t; }); return last; }

/* ---------- פעולות ---------- */
var ACTIONS = {
  bootstrap: function (r) {
    if (countUsers_()) return { ok: false, error: 'exists' };
    var sc = props_().getProperty('SETUP_CODE');
    if (!sc) return { ok: false, error: 'no_setup' };
    if (lockedFor_('bootstrap')) return { ok: false, error: 'locked' };
    if (!safeEq_(sha256Hex_(String(r.code || '')), sc)) { noteFail_('bootstrap'); return { ok: false, error: 'bad_code' }; }
    if (!validName_(r.user)) return { ok: false, error: 'bad_user' };
    if (!validPass_(r.pass)) return { ok: false, error: 'weak_pass' };
    var salt = randHex_(24), u = { role: 'admin', blocked: false, tv: 1, salt: salt, hash: hashPass_(salt, r.pass), created: now_(), changed: now_() };
    putUser_(r.user, u);
    props_().deleteProperty('SETUP_CODE');
    return loginOk_(r.user, u);
  },

  login: function (r) {
    var name = String(r.user || '');
    if (lockedFor_(name)) return { ok: false, error: 'locked', message: 'יותר מדי ניסיונות — נסו שוב בעוד ' + CFG.LOCK_MINUTES + ' דקות' };
    var u = getUser_(name);
    var good = !!u && safeEq_(hashPass_(u.salt, String(r.pass || '')), u.hash);
    if (!good) { noteFail_(name); return { ok: false, error: 'bad_login' }; }
    if (u.blocked) return { ok: false, error: 'blocked' };
    clearFails_(name);
    u.lastLogin = now_(); putUser_(name, u);
    return loginOk_(name, u);
  },

  me: function (r) {
    var a = auth_(r.token); if (a.error) return { ok: false, error: a.error };
    return { ok: true, user: a.name, role: a.user.role, mailMode: mailMode_(), mailTo: CFG.MAIL_TO };
  },

  changePassword: function (r) {
    var a = auth_(r.token); if (a.error) return { ok: false, error: a.error };
    if (!validPass_(r.newPass)) return { ok: false, error: 'weak_pass' };
    var u = a.user;
    if (!safeEq_(hashPass_(u.salt, String(r.oldPass || '')), u.hash)) return { ok: false, error: 'bad_login' };
    u.salt = randHex_(24); u.hash = hashPass_(u.salt, r.newPass); u.tv = (u.tv || 1) + 1; u.changed = now_();
    putUser_(a.name, u);
    return loginOk_(a.name, u);
  },

  // המנהל רואה את כל המשתמשים, וליד כל אחד: כמה בקשות שמר/שלח ומתי לאחרונה
  listUsers: function (r) {
    var a = admin_(r); if (a.error) return { ok: false, error: a.error };
    var us = users_(), log = readLog_(), st = {};
    log.forEach(function (e) {
      var s = st[e.user] || (st[e.user] = { requests: 0, sent: 0, lastRequest: 0, lastSent: 0 });
      s.requests++; if (e.saved > s.lastRequest) s.lastRequest = e.saved;
      (e.sent || []).forEach(function (x) { if (x.mode === 'live') { s.sent++; if (x.t > s.lastSent) s.lastSent = x.t; } });
    });
    return { ok: true, mailMode: mailMode_(), users: Object.keys(us).sort().map(function (k) {
      var u = us[k], s = st[k] || { requests: 0, sent: 0, lastRequest: 0, lastSent: 0 };
      return { user: k, role: u.role, blocked: !!u.blocked, created: u.created, changed: u.changed, lastLogin: u.lastLogin || null, requests: s.requests, sent: s.sent, lastRequest: s.lastRequest || null, lastSent: s.lastSent || null };
    }) };
  },

  // יומן הבקשות: כל מי שהגיש בקשה (או רק משתמש מסוים), מהחדשה לישנה
  listRequests: function (r) {
    var a = admin_(r); if (a.error) return { ok: false, error: a.error };
    var limit = Math.max(1, Math.min(200, Number(r.limit) || 100)), who = r.user ? String(r.user) : '';
    var rows = readLog_().filter(function (e) { return !who || e.user === who || e.lastUser === who || (e.sent || []).some(function (s) { return s.user === who; }); })
      .sort(function (x, y) { return y.saved - x.saved; }).slice(0, limit)
      .map(function (e) {
        var sent = e.sent || [], last = sent.length ? sent[sent.length - 1] : null;
        return { name: e.name, user: e.user, lastUser: e.lastUser, created: e.created, saved: e.saved, url: 'https://drive.google.com/drive/folders/' + e.id,
          sentLive: sent.filter(function (s) { return s.mode === 'live'; }).length, sentTest: sent.filter(function (s) { return s.mode !== 'live'; }).length,
          lastSent: last ? { t: last.t, user: last.user, mode: last.mode } : null };
      });
    return { ok: true, requests: rows };
  },

  addUser: function (r) {
    var a = admin_(r); if (a.error) return { ok: false, error: a.error };
    if (!validName_(r.newUser)) return { ok: false, error: 'bad_user' };
    if (!validPass_(r.newPass)) return { ok: false, error: 'weak_pass' };
    if (getUser_(r.newUser)) return { ok: false, error: 'exists' };
    var salt = randHex_(24);
    putUser_(r.newUser, { role: r.role === 'admin' ? 'admin' : 'user', blocked: false, tv: 1, salt: salt, hash: hashPass_(salt, r.newPass), created: now_(), changed: now_() });
    return { ok: true };
  },

  setBlocked: function (r) {
    var a = admin_(r); if (a.error) return { ok: false, error: a.error };
    var u = getUser_(String(r.target || ''));
    if (!u) return { ok: false, error: 'no_user' };
    if (r.target === a.name) return { ok: false, error: 'self' };
    u.blocked = !!r.blocked; u.tv = (u.tv || 1) + 1;     // מבטל מיידית כל אסימון קיים
    putUser_(r.target, u);
    return { ok: true };
  },

  resetPassword: function (r) {
    var a = admin_(r); if (a.error) return { ok: false, error: a.error };
    var u = getUser_(String(r.target || ''));
    if (!u) return { ok: false, error: 'no_user' };
    if (!validPass_(r.newPass)) return { ok: false, error: 'weak_pass' };
    u.salt = randHex_(24); u.hash = hashPass_(u.salt, r.newPass); u.tv = (u.tv || 1) + 1; u.changed = now_();
    putUser_(r.target, u);
    return { ok: true };
  },

  deleteUser: function (r) {
    var a = admin_(r); if (a.error) return { ok: false, error: a.error };
    if (!getUser_(String(r.target || ''))) return { ok: false, error: 'no_user' };
    if (r.target === a.name) return { ok: false, error: 'self' };
    delUser_(r.target);
    return { ok: true };
  },

  // מצב שליחה (מנהל בלבד): test = המייל נשלח רק לבעלים; live = למשרד נוטאם
  setMailMode: function (r) {
    var a = admin_(r); if (a.error) return { ok: false, error: a.error };
    var m = r.mode === 'live' ? 'live' : 'test';
    props_().setProperty('MAIL_MODE', m);
    return { ok: true, mailMode: m };
  },

  saveBegin: function (r) {
    var a = auth_(r.token); if (a.error) return { ok: false, error: a.error };
    var name = cleanFolderName_(r.folderName);
    if (!name) return { ok: false, error: 'bad_name' };
    var root = DriveApp.getFolderById(CFG.ROOT_FOLDER_ID);
    var it = root.getFoldersByName(name), f = it.hasNext() ? it.next() : root.createFolder(name);
    logSave_(a.name, f.getId(), name);
    return { ok: true, folderId: f.getId(), url: f.getUrl(), name: name };
  },

  saveFile: function (r) {
    var a = auth_(r.token); if (a.error) return { ok: false, error: a.error };
    var b64 = String(r.b64 || '');
    if (!b64 || b64.length > CFG.MAX_FILE_B64) return { ok: false, error: 'bad_file' };
    var folder = requestFolder_(r.folderId);
    if (!folder) return { ok: false, error: 'bad_folder' };     // כתיבה רק לתוך תיקיית הבקשות
    var fname = cleanFileName_(r.name), old = folder.getFilesByName(fname);
    while (old.hasNext()) old.next().setTrashed(true);           // גרסה חדשה מחליפה ישנה באותו שם
    var blob = Utilities.newBlob(Utilities.base64Decode(b64), String(r.mime || 'application/octet-stream'), fname);
    var file = folder.createFile(blob);
    return { ok: true, id: file.getId(), url: file.getUrl() };
  },

  // שליחת הבקשה למשרד נוטאם. הנמענים קבועים (CFG.MAIL_TO); הקבצים נלקחים מהתיקייה שנשמרה בדרייב.
  // במצב test המייל נשלח רק לבעלים. שליחה חוזרת של בקשה שכבר נשלחה "חי" דורשת again:true במפורש.
  sendRequest: function (r) {
    var a = auth_(r.token); if (a.error) return { ok: false, error: a.error };
    var folder = requestFolder_(r.folderId);
    if (!folder) return { ok: false, error: 'bad_folder' };
    var subject = cleanSubject_(r.subject), body = cleanBody_(r.body);
    if (!subject || !body) return { ok: false, error: 'bad_mail' };

    var cache = CacheService.getScriptCache(), hourKey = 'sends:' + Math.floor(now_() / 3600000), sends = Number(cache.get(hourKey)) || 0;
    if (sends >= CFG.MAX_SENDS_PER_HOUR) return { ok: false, error: 'rate', message: 'יותר מדי שליחות בשעה האחרונה' };

    var files = [], names = [], total = 0, hasDocx = false, hasImage = false, it = folder.getFiles();
    while (it.hasNext()) {
      var f = it.next(), n = f.getName();
      if (!/\.(docx|kml|png|jpe?g)$/i.test(n)) continue;       // רק קבצי הבקשה: לא יומן, לא JSON, לא סימוני שליחה
      total += f.getSize();
      if (/\.docx$/i.test(n)) hasDocx = true;
      if (/\.(png|jpe?g)$/i.test(n)) hasImage = true;
      files.push(f.getBlob()); names.push(n);
    }
    if (!hasDocx || !hasImage) return { ok: false, error: 'missing_files', message: 'חסר קובץ Word או תמונת מפה/תצ"א בתיקייה' };   // א-11 נספח ג': חובה לצרף מפה/תצ"א
    if (total > CFG.MAX_MAIL_BYTES) return { ok: false, error: 'too_big' };

    var log = readLog_(), entry = null;
    for (var i = 0; i < log.length; i++) if (log[i].id === String(r.folderId)) entry = log[i];
    var mode = mailMode_();
    if (mode === 'live' && !r.again && liveSentAt_(entry)) return { ok: false, error: 'already_sent', sentAt: liveSentAt_(entry) };

    var owner = ownerEmail_(), to = mode === 'live' ? CFG.MAIL_TO.slice() : (owner ? [owner] : []);
    if (!to.length) return { ok: false, error: 'no_owner' };
    MailApp.sendEmail({
      to: to.join(','), cc: mode === 'live' && owner ? owner : '', replyTo: owner || '', name: CFG.SENDER_NAME,
      subject: (mode === 'live' ? '' : '[בדיקה — לא נשלח למשרד נוטאם] ') + subject, body: body, attachments: files
    });
    cache.put(hourKey, String(sends + 1), 3600);
    var t = logSent_(a.name, String(r.folderId), folder.getName(), mode, to);
    try {   // סימון בתוך תיקיית הבקשה, כדי שגם מי שפותח את התיקייה בדרייב יראה שנשלחה
      folder.createFile('נשלח — ' + Utilities.formatDate(new Date(t), 'Asia/Jerusalem', 'yyyy-MM-dd HH-mm') + (mode === 'live' ? '' : ' (בדיקה)') + '.txt',
        ['נשלח ע"י: ' + a.name, 'מצב: ' + (mode === 'live' ? 'חי — למשרד נוטאם' : 'בדיקה — לבעלים בלבד'), 'אל: ' + to.join(', '), 'עותק: ' + (mode === 'live' ? owner : '—'), 'נושא: ' + subject, 'קבצים: ' + names.join(' | ')].join('\n'), 'text/plain');
    } catch (e) { /* הסימון אינו חיוני */ }
    return { ok: true, mode: mode, to: to, cc: mode === 'live' ? owner : '', files: names, sentAt: t };
  }
};

function loginOk_(name, u) {
  var t = makeToken_(name, u);
  return { ok: true, token: t.token, exp: t.exp, user: name, role: u.role, mailMode: mailMode_(), mailTo: CFG.MAIL_TO };
}
function admin_(r) {
  var a = auth_(r.token);
  if (a.error) return a;
  if (a.user.role !== 'admin') return { error: 'forbidden' };
  return a;
}
// תיקיית בקשה תקפה = בתוך תיקיית הבקשות (עד 10 רמות), לא מחוצה לה
function requestFolder_(id) {
  var folder;
  try { folder = DriveApp.getFolderById(String(id)); } catch (err) { return null; }
  var seen = 0, cur = folder;
  while (cur && seen++ < 10) {
    if (cur.getId() === CFG.ROOT_FOLDER_ID) return folder.getId() === CFG.ROOT_FOLDER_ID ? null : folder;
    var ps = cur.getParents();
    cur = ps.hasNext() ? ps.next() : null;
  }
  return null;
}
