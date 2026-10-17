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
  LOG_MAX: 1000,           // מעבר לכך נמחקות הישנות ביותר שלא נשלחו; רשומה עם שליחה חיה נשמרת תמיד
  MAX_NEW_FOLDERS_PER_HOUR: 30,  // תקרת תיקיות בקשה חדשות למשתמש בשעה — מונע הצפה של הדרייב והיומן
  // --- מנוי מטיס מסחרי: כרטיס "בקשת אישורי טיסה" באתר הארגון (Wix Events). הרשמה רק למי שיש לו הזמנה ששולמה בפועל.
  WIX_SITE_ID: '29dca6d8-08d4-4679-a6e5-c5f4f3317d90',        // icd.org.il
  WIX_EVENT_ID: 'fbcb2cc1-4dc7-4545-b9d5-08febf9f8153',       // האירוע "בקשת אישורי טיסה"
  RENEW_URL: 'https://www.icd.org.il/events-1/bqst-yswry-tysh',
  REQUIRE_MEMBER: true,         // הרוכש חייב להיות חבר רשום באתר (להזמנה memberId)
  VALID_MONTHS: 12,             // כל כרטיס ששולם מזכה בתקופה הזו, מיום הרכישה (ובחידוש מוקדם — מתווסף לסוף התקופה הנוכחית)
  REMIND_DAYS: [30, 3],         // תזכורות: חודש לפני הסיום, ו-3 ימים לפני
  CODE_TTL_MIN: 15, CODE_MAX_TRIES: 5,
  REG_PER_EMAIL_HOUR: 5, REG_PER_HOUR: 60,
  RECHECK_ORDERS: true,         // בבדיקה היומית: הזמנה שבוטלה/הוחזרה — החשבון נחסם
  WIX_MAX_PAGES: 5
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
  if (u.until && Number(u.until) < now_()) return { error: 'sub_expired' };      // המנוי הסתיים: האסימון הקיים מפסיק לעבוד באותו רגע
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
function cleanFileName_(s) {   // חיתוך אורך לא שומט את הסיומת (אחרת הקובץ לא יזוהה כ-Word/תמונה בשליחה)
  var raw = String(s || '').trim(), m = /\.[A-Za-z0-9]{1,5}$/.exec(raw), ext = m ? m[0].toLowerCase() : '';
  var base = cleanFolderName_(ext ? raw.slice(0, -ext.length) : raw).slice(0, 110).trim();
  return (base || 'file') + ext;
}
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

/* ---------- מנוי מטיס מסחרי: אימות כרטיס מול Wix ---------- */
// המפתח (API key של Wix עם הרשאת "Read Basic Events Order Info") נשמר ב-Script Properties בשם WIX_API_KEY — לא בקוד ולא ביומן.
function normEmail_(e) { e = String(e || '').trim().toLowerCase(); return (e.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) ? e : ''; }
function addMonths_(ms, n) { var d = new Date(ms); d.setUTCMonth(d.getUTCMonth() + n); return d.getTime(); }
// YYYY-MM-DD (או מספר מילישניות) -> סוף אותו יום בשעון ישראל (בקירוב: 21:00 UTC)
function parseUntil_(v) {
  if (typeof v === 'number' && v > 0) return v;
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || '').trim());
  if (!m) return 0;
  var t = new Date(m[1] + '-' + m[2] + '-' + m[3] + 'T21:00:00Z').getTime();
  return t > 0 ? t : 0;
}
function fmtDate_(ms) { return Utilities.formatDate(new Date(ms), 'Asia/Jerusalem', 'dd.MM.yyyy'); }
function emailKey_(email) { return 'E:' + sha256Hex_(email).slice(0, 30); }
function orderKey_(orderNumber) { return 'O:' + sha256Hex_(String(orderNumber)).slice(0, 30); }
function wixFetch_(path) {
  var key = props_().getProperty('WIX_API_KEY');
  if (!key) throw new Error('not_configured');
  var res = UrlFetchApp.fetch('https://www.wixapis.com' + path, { method: 'get', muteHttpExceptions: true, headers: { Authorization: key, 'wix-site-id': CFG.WIX_SITE_ID } });
  var code = res.getResponseCode();
  if (code !== 200) throw new Error('wix_http_' + code);
  try { return JSON.parse(res.getContentText()); } catch (e) { throw new Error('wix_bad_json'); }
}
// כל ההזמנות ששולמו באירוע, עבור כתובת מייל. אימות סגור: רק status=PAID בפועל (לא FREE ולא OFFLINE_PENDING), והמייל חייב להיות זהה (לא חיפוש חלקי).
// מחזיר [{orderNumber, created(ms), email, name, member(bool), status}]
function wixPaidOrders_(email) {
  var out = [], offset = 0;
  for (var page = 0; page < CFG.WIX_MAX_PAGES; page++) {
    var r = wixFetch_('/events/v1/orders?eventId=' + encodeURIComponent(CFG.WIX_EVENT_ID) + '&status=PAID&fieldset=DETAILS&fieldset=TICKETS&searchPhrase=' + encodeURIComponent(email) + '&limit=100&offset=' + offset);
    var list = (r && r.orders) || [];
    list.forEach(function (o) {
      if (!o || o.status !== 'PAID' || !o.orderNumber) return;
      var mails = [o.email];
      (o.tickets || []).forEach(function (t) { mails.push(t && t.guestDetails && t.guestDetails.email); });
      if (!mails.some(function (m) { return normEmail_(m) === email; })) return;
      var created = new Date(o.created).getTime();
      if (!(created > 0)) return;
      out.push({ orderNumber: String(o.orderNumber), created: created, email: email, name: String(o.firstName || '').slice(0, 40), member: !!o.memberId, status: o.status });
    });
    if (list.length < 100) break;
    offset += 100;
  }
  return out.sort(function (a, b) { return a.created - b.created; });
}
// שגיאת Wix -> קוד שהלקוח מבין: לא הוגדר מפתח / Wix לא זמין (בשני המקרים לא מאשרים כלום — נכשל סגור)
function wixErr_(e) { return String(e && e.message || e) === 'not_configured' ? 'not_configured' : 'wix_down'; }
function wixOrderStatus_(orderNumber) {
  var r = wixFetch_('/events/v1/orders?eventId=' + encodeURIComponent(CFG.WIX_EVENT_ID) + '&orderNumber=' + encodeURIComponent(orderNumber) + '&fieldset=DETAILS&limit=1');
  var o = r && r.orders && r.orders[0];
  return o ? String(o.status || '') : '';
}
function emailUser_(email) { var n = props_().getProperty(emailKey_(email)); return n ? { name: n, user: getUser_(n) } : null; }
function orderOwner_(orderNumber) { return props_().getProperty(orderKey_(orderNumber)); }
// ההזמנות שזכאות להרשמה/חידוש: שולמו, הרוכש חבר (אם נדרש), ועדיין לא נוצלו ע"י אף חשבון
function eligibleOrders_(orders) {
  return orders.filter(function (o) { return (!CFG.REQUIRE_MEMBER || o.member) && !orderOwner_(o.orderNumber); });
}
// תוקף חדש אחרי הוספת הזמנות: כל הזמנה מוסיפה VALID_MONTHS, מהמאוחר מבין (סוף התקופה הנוכחית, יום ההזמנה)
function applyOrders_(until, orders) {
  var u = Number(until) || 0;
  orders.forEach(function (o) { u = addMonths_(Math.max(u, o.created), CFG.VALID_MONTHS); });
  return u;
}
function subscriptionMail_(u, name, days, until) {
  var first = String(u.displayName || '').trim(), hi = first ? 'שלום ' + first + ',' : 'שלום,', date = fmtDate_(until);
  var renew = 'לחידוש המנוי: ' + CFG.RENEW_URL + '\nאחרי הרכישה נכנסים לדף בקשות הטיסה, לוחצים על "הרשמה / חידוש מנוי" ומקלידים את כתובת המייל שבה קניתם את הכרטיס. זה הכול — והתקופה החדשה מתווספת לסוף התקופה הנוכחית, כך שלא מפסידים אף יום.';
  if (days > CFG.REMIND_DAYS[CFG.REMIND_DAYS.length - 1]) {
    return { subject: 'המנוי שלך לבקשות טיסה מסתיים בעוד כחודש ✈', body: [hi, '',
      'תודה שאתה חלק מהארגון הישראלי לרחפנים, ושאתה משתמש במערכת בקשות הטיסה שלנו — זה בדיוק בשביל זה היא נבנתה.',
      'רצינו רק לעדכן שהמנוי שלך (שם משתמש: ' + name + ') מסתיים ב-' + date + ' — בעוד ' + days + ' ימים.', '',
      renew, '', 'בהצלחה בטיסות ובאישורים,', 'צוות הארגון הישראלי לרחפנים'].join('\n') };
  }
  return { subject: 'תזכורת: המנוי שלך לבקשות טיסה מסתיים בעוד ' + (days <= 1 ? 'יום' : days + ' ימים'), body: [hi, '',
    'תזכורת קצרה: המנוי שלך לבקשות טיסה (שם משתמש: ' + name + ') מסתיים ב-' + date + '. אחרי התאריך הזה לא יהיה אפשר להתחבר ולהגיש בקשות עד שהמנוי יחודש.', '',
    renew, '', 'אם כבר חידשת — תודה, ואפשר להתעלם מהמייל.', 'צוות הארגון הישראלי לרחפנים'].join('\n') };
}
// בדיקה יומית (טריגר): תזכורות חודש ו-3 ימים לפני הסיום, וחסימת חשבון שהזמנתו בוטלה. להתקנה — להריץ פעם אחת installTrigger().
function dailyCheck() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { skipped: 'busy' };
  var stat = { checked: 0, reminded: 0, blocked: 0, errors: 0 };
  try {
    var us = users_(), now = now_(), calls = 0, owner = ownerEmail_();
    Object.keys(us).forEach(function (name) {
      var u = us[name], changed = false;
      if (!u.until) return;
      stat.checked++;
      if (CFG.RECHECK_ORDERS && !u.blocked && u.orders && u.orders.length && calls < 200) {
        try {
          for (var i = 0; i < u.orders.length && calls < 200; i++) {
            calls++;
            var st = wixOrderStatus_(u.orders[i]);
            if (st === 'CANCELED' || st === 'DECLINED' || st === 'VOIDED') { u.blocked = true; u.blockedWhy = 'order_' + st; u.tv = (Number(u.tv) || 1) + 1; changed = true; stat.blocked++; break; }
          }
        } catch (e) { stat.errors++; /* תקלה ב-Wix אינה חוסמת משתמשים */ }
      }
      var days = Math.ceil((u.until - now) / 86400000), rem = u.reminded || {};
      if (u.email && days >= 0 && !u.blocked) {
        var step = days <= CFG.REMIND_DAYS[1] ? 'd3' : days <= CFG.REMIND_DAYS[0] ? 'd30' : '';
        if (step && !rem[step] && !(step === 'd30' && rem.d3)) {
          try {
            var m = subscriptionMail_(u, name, days, u.until);
            MailApp.sendEmail({ to: u.email, subject: m.subject, body: m.body, name: CFG.SENDER_NAME, replyTo: owner || '' });
            rem[step] = now; if (step === 'd3') rem.d30 = rem.d30 || now;
            u.reminded = rem; changed = true; stat.reminded++;
          } catch (e) { stat.errors++; }
        }
      }
      if (changed) putUser_(name, u);
    });
  } finally { lock.releaseLock(); }
  Logger.log('dailyCheck ' + JSON.stringify(stat));
  return stat;
}
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'dailyCheck') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyCheck').timeBased().everyDays(1).atHour(8).inTimezone('Asia/Jerusalem').create();
  Logger.log('נוצר טריגר יומי (08:00 שעון ישראל) ל-dailyCheck');
}

/* ---------- יומן בקשות (קובץ בתיקיית הבקשות) ---------- */
// היומן הוא גם ההגנה משליחה כפולה, ולכן הוא "נכשל סגור": שגיאת דרייב או JSON פגום זורקים שגיאה (ולא מחזירים רשימה ריקה),
// כדי שלא יימחק ההיסטוריה ולא תתאפשר שליחה כפולה בגלל תקלה זמנית.
function logFile_() {
  var root = DriveApp.getFolderById(CFG.ROOT_FOLDER_ID), it = root.getFilesByName(CFG.LOG_NAME);
  return it.hasNext() ? it.next() : root.createFile(CFG.LOG_NAME, '[]', 'application/json');
}
function readLog_() {
  var it = DriveApp.getFolderById(CFG.ROOT_FOLDER_ID).getFilesByName(CFG.LOG_NAME);
  if (!it.hasNext()) return [];                       // עדיין לא נוצר יומן
  var txt = it.next().getBlob().getDataAsString('UTF-8'), a;
  if (!String(txt).trim()) return [];
  try { a = JSON.parse(txt); } catch (e) { throw new Error('יומן הבקשות פגום — העבודה נעצרה כדי לא לאבד היסטוריה. יש לתקן או לשחזר את הקובץ בדרייב.'); }
  if (!Array.isArray(a)) throw new Error('יומן הבקשות פגום — העבודה נעצרה כדי לא לאבד היסטוריה.');
  return a;
}
// שליחה "פעילה" = לא נכשלה (כולל שליחה שהתחילה ולא ידוע אם הסתיימה — לכן שמרנית)
function sentOk_(s) { return s.st !== 'failed'; }
function liveSentAt_(entry) { var last = 0; ((entry && entry.sent) || []).forEach(function (s) { if (s.mode === 'live' && sentOk_(s) && s.t > last) last = s.t; }); return last; }
// גיזום: מוחקים קודם את הישנות ביותר שלא נשלחו חי. לעולם לא נמחקת רשומה עם שליחה חיה, ולא הרשומה שזה עתה נכתבה (keepId) —
// כשהיומן מלא ברשומות כאלה הוא פשוט גדל מעבר ל-LOG_MAX.
function trimLog_(arr, keepId) {
  var drop = arr.length - CFG.LOG_MAX, out = [];
  if (drop <= 0) return arr;
  arr.forEach(function (e) { if (drop > 0 && e.id !== keepId && !liveSentAt_(e)) { drop--; return; } out.push(e); });
  return out;
}
function writeLog_(arr, keepId) { logFile_().setContent(JSON.stringify(trimLog_(arr, keepId))); }
function findByRid_(log, rid) { for (var i = 0; i < log.length; i++) if (log[i].rid === rid) return log[i]; return null; }
function findById_(log, id) { for (var i = 0; i < log.length; i++) if (log[i].id === id) return log[i]; return null; }
// שם תיקייה ייחודי ליומן: בקשה אחרת באותו מקום ותאריך מקבלת סיומת (2), (3)…
function uniqueName_(log, name, rid) {
  var taken = {};
  log.forEach(function (e) { if (e.rid !== rid) taken[e.name] = true; });
  var u = name, n = 1;
  while (taken[u]) u = name.slice(0, 112) + ' (' + (++n) + ')';
  return u;
}
// "השליחה התחילה" נרשמת לפני שהמייל יוצא; בסיום מתעדכנת ל-sent, ובכשל ל-failed
function logSentBegin_(user, folderId, name, mode, to, sid) {
  var log = readLog_(), t = now_(), e = findById_(log, folderId);
  if (!e) { e = { id: folderId, rid: '', name: name, user: user, created: t, saved: t, lastUser: user, ready: false, sent: [] }; log.push(e); }
  e.sent = e.sent || [];
  e.sent.push({ sid: sid, t: t, user: user, mode: mode, to: to, st: 'sending' });
  writeLog_(log, folderId);
  return t;
}
function logSentEnd_(folderId, sid, st) {
  var log = readLog_(), e = findById_(log, folderId);
  if (!e) return;
  (e.sent || []).forEach(function (x) { if (x.sid === sid) x.st = st; });
  writeLog_(log, folderId);
}

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
    var salt = randHex_(24), u = { role: 'admin', blocked: false, tv: now_(), salt: salt, hash: hashPass_(salt, r.pass), created: now_(), changed: now_() };
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
    if (u.until && Number(u.until) < now_()) { clearFails_(name); return { ok: false, error: 'sub_expired', until: u.until, renewUrl: CFG.RENEW_URL }; }
    clearFails_(name);
    u.lastLogin = now_(); putUser_(name, u);
    return loginOk_(name, u);
  },

  me: function (r) {
    var a = auth_(r.token); if (a.error) return { ok: false, error: a.error };
    return { ok: true, user: a.name, role: a.user.role, mailMode: mailMode_(), mailTo: CFG.MAIL_TO, until: a.user.until || null, renewUrl: CFG.RENEW_URL };
  },

  changePassword: function (r) {
    var a = auth_(r.token); if (a.error) return { ok: false, error: a.error };
    if (!validPass_(r.newPass)) return { ok: false, error: 'weak_pass' };
    var u = a.user, lk = 'pw:' + a.name;      // גם ניחוש הסיסמה הישנה (למי שמחזיק אסימון) מוגבל, כמו בכניסה
    if (lockedFor_(lk)) return { ok: false, error: 'locked', message: 'יותר מדי ניסיונות — נסו שוב בעוד ' + CFG.LOCK_MINUTES + ' דקות' };
    if (!safeEq_(hashPass_(u.salt, String(r.oldPass || '')), u.hash)) { noteFail_(lk); return { ok: false, error: 'bad_login' }; }
    clearFails_(lk);
    u.salt = randHex_(24); u.hash = hashPass_(u.salt, r.newPass); u.tv = (Number(u.tv) || 1) + 1; u.changed = now_();
    putUser_(a.name, u);
    return loginOk_(a.name, u);
  },

  // המנהל רואה את כל המשתמשים, וליד כל אחד: כמה בקשות שמר/שלח ומתי לאחרונה
  listUsers: function (r) {
    var a = admin_(r); if (a.error) return { ok: false, error: a.error };
    var us = users_(), log = [], st = {}, logError = '';
    try { log = readLog_(); } catch (err) { logError = String(err && err.message || err); }   // תקלת יומן לא מונעת מהמנהל לחסום משתמשים
    log.forEach(function (e) {
      var s = st[e.user] || (st[e.user] = { requests: 0, sent: 0, lastRequest: 0, lastSent: 0 });
      s.requests++; if (e.saved > s.lastRequest) s.lastRequest = e.saved;
      (e.sent || []).forEach(function (x) { if (x.mode === 'live' && sentOk_(x)) { s.sent++; if (x.t > s.lastSent) s.lastSent = x.t; } });
    });
    return { ok: true, mailMode: mailMode_(), logError: logError, users: Object.keys(us).sort().map(function (k) {
      var u = us[k], s = st[k] || { requests: 0, sent: 0, lastRequest: 0, lastSent: 0 };
      return { user: k, role: u.role, blocked: !!u.blocked, created: u.created, changed: u.changed, lastLogin: u.lastLogin || null, requests: s.requests, sent: s.sent, lastRequest: s.lastRequest || null, lastSent: s.lastSent || null,
        email: u.email || '', until: u.until || null, source: u.source || 'manual', blockedWhy: u.blockedWhy || '' };
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
          sentLive: sent.filter(function (s) { return s.mode === 'live' && sentOk_(s); }).length, sentTest: sent.filter(function (s) { return s.mode !== 'live' && sentOk_(s); }).length,
          lastSent: last ? { t: last.t, user: last.user, mode: last.mode, st: last.st || 'sent' } : null, ready: !!e.ready };
      });
    return { ok: true, requests: rows };
  },

  addUser: function (r) {
    var a = admin_(r); if (a.error) return { ok: false, error: a.error };
    if (!validName_(r.newUser)) return { ok: false, error: 'bad_user' };
    if (!validPass_(r.newPass)) return { ok: false, error: 'weak_pass' };
    if (getUser_(r.newUser)) return { ok: false, error: 'exists' };
    var salt = randHex_(24);
    var nu = { role: r.role === 'admin' ? 'admin' : 'user', blocked: false, tv: now_(),   // tv=זמן יצירה: משתמש שנמחק ונוצר מחדש באותו שם לא מחייה אסימונים ישנים
      salt: salt, hash: hashPass_(salt, r.newPass), created: now_(), changed: now_(), source: 'manual' };
    if (r.until) { var ut = parseUntil_(r.until); if (!ut) return { ok: false, error: 'bad_date' }; nu.until = ut; }
    putUser_(r.newUser, nu);
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
    var du = getUser_(r.target);
    (du && du.orders || []).forEach(function (o) { props_().deleteProperty(orderKey_(o)); });    // הכרטיסים משתחררים: אפשר להירשם מחדש איתם
    if (du && du.email) props_().deleteProperty(emailKey_(du.email));
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

  // ----- הרשמה וחידוש מנוי (ללא התחברות): רק למי שרכש כרטיס "בקשת אישורי טיסה" ששולם בפועל -----
  // התשובה כאן זהה בין אם יש כרטיס ובין אם אין, כדי שאי אפשר לברר דרכה מי רכש כרטיס. הקוד נשלח רק לכתובת שבהזמנה.
  regStart: function (r) {
    var email = normEmail_(r.email);
    if (!email) return { ok: false, error: 'bad_email' };
    var cache = CacheService.getScriptCache(), hk = Math.floor(now_() / 3600000), ek = 'regE:' + sha256Hex_(email).slice(0, 20) + ':' + hk, gk = 'regG:' + hk;
    var ne = Number(cache.get(ek)) || 0, ng = Number(cache.get(gk)) || 0;
    if (ne >= CFG.REG_PER_EMAIL_HOUR || ng >= CFG.REG_PER_HOUR) return { ok: false, error: 'rate', message: 'יותר מדי ניסיונות — נסו שוב בעוד שעה' };
    cache.put(ek, String(ne + 1), 3600); cache.put(gk, String(ng + 1), 3600);
    var orders;
    try { orders = wixPaidOrders_(email); } catch (e) { return { ok: false, error: wixErr_(e) }; }
    var eu = emailUser_(email), fresh = eligibleOrders_(orders), owner = ownerEmail_(), mode = '';
    if (eu && eu.user) mode = fresh.length ? 'renew' : 'exists';
    else if (fresh.length) mode = 'register';
    if (mode === 'exists') {
      MailApp.sendEmail({ to: email, name: CFG.SENDER_NAME, replyTo: owner || '', subject: 'כבר קיים חשבון לבקשות טיסה בכתובת הזו',
        body: 'שלום,\n\nכבר קיים חשבון בבקשות טיסה המשויך לכתובת הזו. שם המשתמש: ' + eu.name + (eu.user.until ? '\nהמנוי בתוך תוקף עד ' + fmtDate_(eu.user.until) + '.' : '') + '\n\nאם שכחת את הסיסמה — פנה למשרד הארגון (office@icd.org.il) ונאפס אותה.\nלחידוש מנוי: ' + CFG.RENEW_URL + '\n\nצוות הארגון הישראלי לרחפנים' });
    } else if (mode) {
      var code = ('000000' + (parseInt(randHex_(8), 16) % 1000000)).slice(-6), salt = randHex_(16);
      props_().setProperty('R:' + sha256Hex_(email).slice(0, 30), JSON.stringify({ h: sha256Hex_(salt + ':' + code), s: salt, exp: now_() + CFG.CODE_TTL_MIN * 60000, tries: 0 }));
      MailApp.sendEmail({ to: email, name: CFG.SENDER_NAME, replyTo: owner || '', subject: (mode === 'renew' ? 'קוד לחידוש המנוי לבקשות טיסה' : 'קוד הרשמה לבקשות טיסה') + ': ' + code,
        body: 'שלום,\n\nהקוד שלך ' + (mode === 'renew' ? 'לחידוש המנוי' : 'להרשמה לבקשות טיסה') + ': ' + code + '\nהקוד תקף ל-' + CFG.CODE_TTL_MIN + ' דקות. אם לא ביקשת — אפשר להתעלם מהמייל.\n\nצוות הארגון הישראלי לרחפנים' });
    }
    return { ok: true, sent: true };
  },

  regFinish: function (r) {
    var email = normEmail_(r.email), code = String(r.code || '').replace(/\D/g, '');
    if (!email || code.length !== 6) return { ok: false, error: 'bad_code' };
    var rk = 'R:' + sha256Hex_(email).slice(0, 30), raw = props_().getProperty(rk), rec = null;
    try { rec = raw ? JSON.parse(raw) : null; } catch (e) { rec = null; }
    if (!rec || rec.exp < now_()) { props_().deleteProperty(rk); return { ok: false, error: 'bad_code' }; }
    if (rec.tries >= CFG.CODE_MAX_TRIES) { props_().deleteProperty(rk); return { ok: false, error: 'bad_code' }; }
    if (!safeEq_(sha256Hex_(rec.s + ':' + code), rec.h)) { rec.tries++; props_().setProperty(rk, JSON.stringify(rec)); return { ok: false, error: 'bad_code' }; }
    // הקוד נכון: בודקים שוב מול Wix (ייתכן שההזמנה בוטלה/נוצלה בינתיים)
    var orders;
    try { orders = wixPaidOrders_(email); } catch (e) { return { ok: false, error: wixErr_(e) }; }
    var eu = emailUser_(email), fresh = eligibleOrders_(orders);
    if (!fresh.length) { props_().deleteProperty(rk); return { ok: false, error: 'no_ticket' }; }
    var t = now_();
    if (eu && eu.user) {                                              // חידוש
      var u = eu.user, nu = applyOrders_(u.until, fresh);
      if (nu <= t) { props_().deleteProperty(rk); return { ok: false, error: 'ticket_expired' }; }
      u.until = nu; u.orders = (u.orders || []).concat(fresh.map(function (o) { return o.orderNumber; })); u.reminded = {}; u.renewed = t;
      fresh.forEach(function (o) { props_().setProperty(orderKey_(o.orderNumber), eu.name); });
      putUser_(eu.name, u); props_().deleteProperty(rk);
      return { ok: true, renewed: true, until: nu };
    }
    var name = String(r.user || '').trim(), pass = String(r.pass || '');
    if (!name || !pass) return { ok: false, error: 'need_credentials' };     // הקוד נשאר תקף
    if (!validName_(name)) return { ok: false, error: 'bad_user' };
    if (!validPass_(pass)) return { ok: false, error: 'weak_pass' };
    if (getUser_(name)) return { ok: false, error: 'exists' };
    var until = applyOrders_(0, fresh);
    if (until <= t) { props_().deleteProperty(rk); return { ok: false, error: 'ticket_expired' }; }
    var salt = randHex_(24), nu2 = { role: 'user', blocked: false, tv: t, salt: salt, hash: hashPass_(salt, pass), created: t, changed: t, source: 'ticket', email: email, displayName: fresh[0].name || '', until: until, orders: fresh.map(function (o) { return o.orderNumber; }), reminded: {}, lastLogin: t };
    putUser_(name, nu2);
    props_().setProperty(emailKey_(email), name);
    fresh.forEach(function (o) { props_().setProperty(orderKey_(o.orderNumber), name); });
    props_().deleteProperty(rk);
    return loginOk_(name, nu2);
  },

  // מנהל: שינוי תאריך סיום מנוי של משתמש (until = YYYY-MM-DD, או ריק = ללא הגבלה)
  setExpiry: function (r) {
    var a = admin_(r); if (a.error) return { ok: false, error: a.error };
    var u = getUser_(String(r.target || ''));
    if (!u) return { ok: false, error: 'no_user' };
    var ut = r.until ? parseUntil_(r.until) : 0;
    if (r.until && !ut) return { ok: false, error: 'bad_date' };
    if (ut) u.until = ut; else delete u.until;
    u.reminded = {}; putUser_(r.target, u);
    return { ok: true, until: ut || null };
  },

  // מנהל: אבחון — מה Wix מחזיר עבור כתובת מייל (לבדיקת ההגדרה אחרי הפעלה ולתמיכה). לא משנה דבר.
  wixCheck: function (r) {
    var a = admin_(r); if (a.error) return { ok: false, error: a.error };
    var email = normEmail_(r.email);
    if (!email) return { ok: false, error: 'bad_email' };
    var orders;
    try { orders = wixPaidOrders_(email); } catch (e) { return { ok: false, error: wixErr_(e) }; }
    return { ok: true, requireMember: CFG.REQUIRE_MEMBER, orders: orders.map(function (o) {
      return { orderNumber: o.orderNumber, created: o.created, member: o.member, used: !!orderOwner_(o.orderNumber), by: orderOwner_(o.orderNumber) || '', eligible: (!CFG.REQUIRE_MEMBER || o.member) && !orderOwner_(o.orderNumber) };
    }), account: (emailUser_(email) || {}).name || '' };
  },

  // פותח (או ממשיך) תיקיית בקשה. rid = מזהה בקשה שהדפדפן יוצר: אותה בקשה חוזרת לאותה תיקייה, ובקשה אחרת — גם באותו מקום ותאריך —
  // מקבלת תיקייה נפרדת. בקשה שכבר נשלחה "חי" אינה נערכת מחדש (מתחילים בקשה חדשה).
  // התחלת שמירה מוחקת את קבצי הבקשה הקודמים בתיקייה ומאפסת את סימון ה"מוכנה"; רק saveEnd מסמן מוכנה.
  saveBegin: function (r) {
    var a = auth_(r.token); if (a.error) return { ok: false, error: a.error };
    var name = cleanFolderName_(r.folderName);
    if (!name) return { ok: false, error: 'bad_name' };
    var rid = String(r.rid || '');
    if (!/^[a-f0-9]{16,64}$/.test(rid)) return { ok: false, error: 'bad_rid' };
    var log = readLog_(), entry = findByRid_(log, rid), folder = null, t = now_();
    if (entry) {
      if (entry.user !== a.name && a.user.role !== 'admin') return { ok: false, error: 'forbidden' };
      if (liveSentAt_(entry)) return { ok: false, error: 'already_sent', sentAt: liveSentAt_(entry) };
      try { folder = DriveApp.getFolderById(entry.id); if (folder.isTrashed()) folder = null; } catch (err) { folder = null; }
    }
    var unique = uniqueName_(log, name, rid);
    if (!folder) {
      var cache = CacheService.getScriptCache(), nk = 'nf:' + sha256Hex_(a.name).slice(0, 16) + ':' + Math.floor(t / 3600000), made = Number(cache.get(nk)) || 0;
      if (made >= CFG.MAX_NEW_FOLDERS_PER_HOUR) return { ok: false, error: 'rate', message: 'יותר מדי בקשות חדשות בשעה האחרונה' };
      cache.put(nk, String(made + 1), 3600);
      folder = DriveApp.getFolderById(CFG.ROOT_FOLDER_ID).createFolder(unique);
    } else {
      if (folder.getName() !== unique) folder.setName(unique);
      var old = folder.getFiles();
      while (old.hasNext()) { var of = old.next(); if (/\.(docx|kml|png|jpe?g|json)$/i.test(of.getName())) of.setTrashed(true); }   // אין שאריות מגרסה קודמת (שם אחר) שיצורפו בטעות
    }
    if (!entry) { entry = { id: folder.getId(), rid: rid, name: unique, user: a.name, created: t, sent: [] }; log.push(entry); }
    entry.id = folder.getId(); entry.name = unique; entry.base = name; entry.saved = t; entry.lastUser = a.name; entry.ready = false; entry.readyAt = 0;
    writeLog_(log, entry.id);
    return { ok: true, folderId: folder.getId(), url: folder.getUrl(), name: unique };
  },

  // סוף שמירה: מסמן את הבקשה "מוכנה לשליחה" רק אם הלקוח אישר שהיא מוכנה והתיקייה מכילה Word ותמונה
  saveEnd: function (r) {
    var a = auth_(r.token); if (a.error) return { ok: false, error: a.error };
    var folder = requestFolder_(r.folderId);
    if (!folder) return { ok: false, error: 'bad_folder' };
    var log = readLog_(), e = findById_(log, folder.getId());
    if (!e) return { ok: false, error: 'bad_folder' };
    if (e.user !== a.name && a.user.role !== 'admin') return { ok: false, error: 'forbidden' };
    var c = folderFiles_(folder);
    e.ready = !!r.ready && c.hasDocx && c.hasImage; e.readyAt = e.ready ? now_() : 0;
    writeLog_(log, e.id);
    return { ok: true, ready: e.ready };
  },

  saveFile: function (r) {
    var a = auth_(r.token); if (a.error) return { ok: false, error: a.error };
    var b64 = String(r.b64 || '');
    if (!b64 || b64.length > CFG.MAX_FILE_B64) return { ok: false, error: 'bad_file' };
    var folder = requestFolder_(r.folderId);
    if (!folder) return { ok: false, error: 'bad_folder' };     // כתיבה רק לתוך תיקיית הבקשות
    // כתיבה רק לבקשה שביומן, רק לבעליה (או מנהל), ולא לבקשה שכבר נשלחה חי. כתיבה לבקשה שסומנה "מוכנה" מבטלת את הסימון עד saveEnd.
    var log = readLog_(), e = findById_(log, folder.getId());
    if (!e) return { ok: false, error: 'bad_folder' };
    if (e.user !== a.name && a.user.role !== 'admin') return { ok: false, error: 'forbidden' };
    if (liveSentAt_(e)) return { ok: false, error: 'already_sent', sentAt: liveSentAt_(e) };
    if (e.ready) { e.ready = false; e.readyAt = 0; writeLog_(log, e.id); }
    var fname = cleanFileName_(r.name), old = folder.getFilesByName(fname);
    while (old.hasNext()) old.next().setTrashed(true);           // גרסה חדשה מחליפה ישנה באותו שם
    var blob = Utilities.newBlob(Utilities.base64Decode(b64), String(r.mime || 'application/octet-stream'), fname);
    var file = folder.createFile(blob);
    return { ok: true, id: file.getId(), url: file.getUrl() };
  },

  // שליחת הבקשה למשרד נוטאם. הנמענים קבועים (CFG.MAIL_TO); הקבצים נלקחים מהתיקייה שנשמרה בדרייב.
  // תנאים שנאכפים כאן ולא רק בדפדפן: הבקשה ביומן ונשמרה כ"מוכנה" (saveEnd), רק בעליה או מנהל שולחים אותה,
  // הלקוח חייב לציין באיזה מצב (test/live) הוצג למשתמש — אם המצב השתנה השרת לא שולח (mode_changed),
  // ושליחה חוזרת של בקשה שכבר נשלחה "חי" דורשת again:true במפורש. במצב test המייל נשלח רק לבעלים.
  sendRequest: function (r) {
    var a = auth_(r.token); if (a.error) return { ok: false, error: a.error };
    var mode = mailMode_();
    if (r.expectMode !== mode) return { ok: false, error: 'mode_changed', mailMode: mode };
    var folder = requestFolder_(r.folderId);
    if (!folder) return { ok: false, error: 'bad_folder' };
    var subject = cleanSubject_(r.subject), body = cleanBody_(r.body);
    if (!subject || !body) return { ok: false, error: 'bad_mail' };

    var log = readLog_(), entry = findById_(log, folder.getId());
    if (!entry) return { ok: false, error: 'bad_folder' };
    if (entry.user !== a.name && a.user.role !== 'admin') return { ok: false, error: 'forbidden' };
    if (!entry.ready) return { ok: false, error: 'not_ready', message: 'הבקשה לא נשמרה כמוכנה לשליחה — יש להשלים את הבדיקות ולשמור שוב בדרייב' };
    if (mode === 'live' && !r.again) {
      if (liveSentAt_(entry)) return { ok: false, error: 'already_sent', sentAt: liveSentAt_(entry) };
      // אותו מקום ותאריך שכבר נשלחו חי מבקשה אחרת (למשל אחרי רענון הדף, כשמזהה הבקשה אבד) — גם זו כפילות אפשרית למשרד נוטאם
      var base = entry.base || entry.name, twin = 0;
      log.forEach(function (e) { if (e.id !== entry.id && (e.base || e.name) === base) twin = Math.max(twin, liveSentAt_(e)); });
      if (twin) return { ok: false, error: 'already_sent', sentAt: twin, similar: true };
    }

    var cache = CacheService.getScriptCache(), hourKey = 'sends:' + Math.floor(now_() / 3600000), sends = Number(cache.get(hourKey)) || 0;
    if (sends >= CFG.MAX_SENDS_PER_HOUR) return { ok: false, error: 'rate', message: 'יותר מדי שליחות בשעה האחרונה' };

    var c = folderFiles_(folder);
    if (!c.hasDocx || !c.hasImage) return { ok: false, error: 'missing_files', message: 'חסר קובץ Word או תמונת מפה/תצ"א בתיקייה' };   // א-11 נספח ג': חובה לצרף מפה/תצ"א
    if (c.total > CFG.MAX_MAIL_BYTES) return { ok: false, error: 'too_big' };

    var owner = ownerEmail_(), to = mode === 'live' ? CFG.MAIL_TO.slice() : (owner ? [owner] : []);
    if (!to.length) return { ok: false, error: 'no_owner' };
    var sid = randHex_(12), t = logSentBegin_(a.name, folder.getId(), folder.getName(), mode, to, sid);   // נרשם לפני היציאה: אם משהו קורס אחרי השליחה, אין מייל כפול
    cache.put(hourKey, String(sends + 1), 3600);
    try {
      MailApp.sendEmail({
        to: to.join(','), cc: mode === 'live' && owner ? owner : '', replyTo: owner || '', name: CFG.SENDER_NAME,
        subject: (mode === 'live' ? '' : '[בדיקה — לא נשלח למשרד נוטאם] ') + subject, body: body, attachments: c.blobs
      });
    } catch (err) {
      try { logSentEnd_(folder.getId(), sid, 'failed'); } catch (e2) { /* הרשומה נשארת "בשליחה" — שמרני */ }
      throw err;
    }
    try { logSentEnd_(folder.getId(), sid, 'sent'); } catch (e3) { /* המייל כבר יצא; הרשומה נשארת "בשליחה" וממשיכה לחסום כפילות */ }
    try {   // סימון בתוך תיקיית הבקשה, כדי שגם מי שפותח את התיקייה בדרייב יראה שנשלחה
      folder.createFile('נשלח — ' + Utilities.formatDate(new Date(t), 'Asia/Jerusalem', 'yyyy-MM-dd HH-mm') + (mode === 'live' ? '' : ' (בדיקה)') + '.txt',
        ['נשלח ע"י: ' + a.name, 'מצב: ' + (mode === 'live' ? 'חי — למשרד נוטאם' : 'בדיקה — לבעלים בלבד'), 'אל: ' + to.join(', '), 'עותק: ' + (mode === 'live' ? owner : '—'), 'נושא: ' + subject, 'קבצים: ' + c.names.join(' | ')].join('\n'), 'text/plain');
    } catch (e4) { /* הסימון אינו חיוני */ }
    return { ok: true, mode: mode, to: to, cc: mode === 'live' ? owner : '', files: c.names, sentAt: t };
  }
};

// קבצי הבקשה בתיקייה (Word, KML, תמונות) — לא יומן, לא JSON ולא סימוני שליחה
function folderFiles_(folder) {
  var out = { blobs: [], names: [], total: 0, hasDocx: false, hasImage: false }, it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next(), n = f.getName();
    if (!/\.(docx|kml|png|jpe?g)$/i.test(n)) continue;
    out.total += f.getSize();
    if (/\.docx$/i.test(n)) out.hasDocx = true;
    if (/\.(png|jpe?g)$/i.test(n)) out.hasImage = true;
    out.blobs.push(f.getBlob()); out.names.push(n);
  }
  return out;
}

function loginOk_(name, u) {
  var t = makeToken_(name, u);
  return { ok: true, token: t.token, exp: t.exp, user: name, role: u.role, mailMode: mailMode_(), mailTo: CFG.MAIL_TO, until: u.until || null, renewUrl: CFG.RENEW_URL };
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
