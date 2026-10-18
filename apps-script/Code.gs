/**
 * שרת בקשות הטיסה של הארגון הישראלי לרחפנים — Google Apps Script (רץ בחשבון של הבעלים).
 *  - התחברות נפרדת בשם משתמש וסיסמה (לא קשורה לשער חברי האתר).
 *  - ניהול משתמשים: הוספה, חסימה/ביטול חסימה, איפוס סיסמה, החלפת סיסמה עצמית, מחיקה — הכול נאכף כאן, בשרת, בכל קריאה.
 *  - שמירת קבצי הבקשה (Word, KML, תמונות) בתיקייה בדרייב: תת-תיקייה בשם "<מקום> — <תאריך>".
 *  - יומן בקשות: מי שמר ושלח מה ומתי (קובץ _יומן בקשות.json בתיקיית הבקשות) — המנהל רואה את כולם.
 *  - שליחה במייל, עם הקבצים מהתיקייה: למשרד נוטאם (הכתובות הקבועות מפמ"ת א-11 סעיף 6(א) בלבד) או רק למבקש עצמו.
 *    המבקש = המשתמש המחובר, בכתובת המייל ששמורה אצלו (נרשמה ואומתה בקוד); הבעלים מקבל תמיד עותק סמוי (BCC).
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
  // הגבלת קצב שעתית בשני דליים נפרדים: 'o' = שליחה חיה למשרד נוטאם (בקשה אמיתית), 'c' = עותקים ("שלח רק לעצמי", וגם "שלח למשרד" במצב בדיקה שנשלח למבקש בלבד).
  // כך עיון בעותקים (הפעולה השכיחה ביותר) לא חוסם שליחה אמיתית — לא של אותו מטיס ולא של אחרים. אלה תקרות קצב בלבד; מכסת המיילים היומית של גוגל נבדקת בנפרד (MAIL_QUOTA_RESERVE).
  MAX_OFFICE_PER_HOUR: 10,       // שליחות חיות למשרד נוטאם — לכל משתמש בנפרד
  MAX_OFFICE_PER_HOUR_ALL: 60,   // ... ובסך הכול לכל המערכת
  MAX_COPIES_PER_HOUR: 10,       // עותקים (לעצמו / בדיקה) — לכל משתמש בנפרד
  MAX_COPIES_PER_HOUR_ALL: 120,  // ... ובסך הכול לכל המערכת (לא נמוכה מ-60: עיון בעותקים הוא הפעולה השכיחה, ומאה מטיסים לא אמורים לחסום זה את זה)
  MAX_SEND_ATTEMPTS_PER_HOUR: 40, // ניסיונות שליחה שהגיעו עד MailApp (גם כושלים) לכל משתמש — שליחה שנכשלה אינה צורכת את הדליים למעלה, אבל לולאת ניסיונות לא תציף את היומן
  MAIL_QUOTA_RESERVE: 20,        // רזרבה במכסת המיילים היומית של גוגל (נמענים) שעותקים אינם צורכים — כדי שהשליחה האמיתית למשרד וקודי ההרשמה לא יורעבו
  FEATURES: ['sendTarget'],      // יכולות שהשרת מדווח עליהן ללקוח (שרת ישן לא מדווח — והלקוח משבית "שלח רק לעצמי")
  MAX_MAIL_BYTES: 24 * 1024 * 1024,
  LOG_NAME: '_יומן בקשות.json',
  LOG_MAX: 2000,           // יעד רך: מעבר לכך נמחקות רק הישנות ביותר שלא נשלחו חי ולא נגעו בהן LOG_KEEP_DAYS ימים; כשהכול מוגן היומן פשוט גדל
  LOG_KEEP_DAYS: 30,       // בקשה שלא נשלחה חי ושונתה/נשלחה לעצמה בתקופה הזו לעולם אינה נמחקת בגיזום (של אף משתמש)
  MAX_NEW_FOLDERS_PER_HOUR: 30,  // תקרת תיקיות בקשה חדשות למשתמש בשעה — מונע הצפה של הדרייב והיומן
  // --- מנוי מטיס מסחרי: כרטיס "בקשת אישורי טיסה" באתר הארגון (Wix Events). הרשמה רק למי שיש לו הזמנה ששולמה בפועל.
  WIX_SITE_ID: '29dca6d8-08d4-4679-a6e5-c5f4f3317d90',        // icd.org.il
  WIX_EVENT_ID: 'fbcb2cc1-4dc7-4545-b9d5-08febf9f8153',       // האירוע "בקשת אישורי טיסה"
  RENEW_URL: 'https://www.icd.org.il/events-1/bqst-yswry-tysh',
  REQUIRE_MEMBER: true,         // הרוכש חייב להיות חבר רשום באתר (להזמנה memberId)
  VALID_MONTHS: 12,             // כל כרטיס ששולם מזכה בתקופה הזו, מיום הרכישה (ובחידוש מוקדם — מתווסף לסוף התקופה הנוכחית)
  REMIND_DAYS: [30, 3],         // תזכורות: חודש לפני הסיום, ו-3 ימים לפני
  CODE_TTL_MIN: 15, CODE_MAX_TRIES: 5,
  CODE_FAIL_MAX: 10, CODE_FAIL_HOURS: 6,   // ניחושי קוד שגויים לכתובת מצטברים בין קודים: אחרי CODE_FAIL_MAX כשלונות מושהית ההרשמה לכתובת (בשקט) עד שחלון CODE_FAIL_HOURS חולף
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
// הקמה ראשונה נדרשת כשאין אף מנהל (לא כשאין אף משתמש): מי ששכח את סיסמת המנהל מוחק רק את חשבון המנהל, ומאות המטיסים נשארים
function countAdmins_() { var us = users_(), n = 0; for (var k in us) if (us[k] && us[k].role === 'admin') n++; return n; }
function secret_() { var s = props_().getProperty('SECRET'); if (!s) throw new Error('לא בוצעה אתחול — להריץ initialize()'); return s; }
function ownerEmail_() { try { return Session.getEffectiveUser().getEmail() || ''; } catch (e) { return ''; } }
// מצב שליחה: 'test' (ברירת מחדל) — "שלח למשרד" נשלח רק למבקש עצמו; 'live' — למשרד נוטאם. רק מנהל משנה (setMailMode).
function mailMode_() { return props_().getProperty('MAIL_MODE') === 'live' ? 'live' : 'test'; }
// כתובת המבקש = הכתובת ששמורה אצל המשתמש (נשמרת רק ברישום עם כרטיס, אחרי אימות קוד שנשלח אליה). אין שום קלט בבקשה שקובע אותה —
// אחרת השרת היה הופך לממסר דואר זבל. נבדקת שוב בכל שימוש. משתמש בלי כתובת (נוצר ידנית ע"י המנהל, כולל המנהל עצמו) — מחזיר ''.
function requesterEmail_(u) { return normEmail_(u && u.email); }
// מה שהלקוח צריך לדעת על המייל: email = כתובת המבקש השמורה (או ''), copyTo = לאן יישלחו עותקים/"שלח לעצמי" (בלי כתובת — כתובת הבעלים).
function mailInfo_(u) {
  var email = requesterEmail_(u);
  return { email: email, copyTo: email || ownerEmail_(), copyToIsOwner: !email, features: CFG.FEATURES.slice() };
}
function withMailInfo_(o, u) { var m = mailInfo_(u); for (var k in m) o[k] = m[k]; return o; }
// מוסיף כתובת לרשימה אם אינה ריקה ועדיין לא נכללה (השוואה באותיות קטנות) — אותה כתובת לא מופיעה פעמיים באותה הודעה
function addRcpt_(list, seen, addr) {
  var a = String(addr || '').trim(), k = 'k:' + a.toLowerCase();
  if (!a || seen[k]) return;
  seen[k] = true; list.push(a);
}
// מכסת המיילים היומית של גוגל (MailApp סופר כל נמען: to+cc+bcc). מספר, או null כשלא ידוע (שרת/מדמה בלי הפונקציה, או שהקריאה נכשלה) —
// אז מדלגים על הבדיקה המוקדמת; השליחה עצמה עדיין נכשלת סגור כי MailApp זורק כשהמכסה נגמרה.
function mailQuotaLeft_() {
  try {
    if (typeof MailApp.getRemainingDailyQuota !== 'function') return null;
    var q = Number(MailApp.getRemainingDailyQuota());
    return q === q ? q : null;
  } catch (e) { return null; }
}
// להרצה ידנית מהעורך (בוחרים showMailQuota ← הפעלה ← יומן ביצוע): כמה נמענים נשארו היום במכסת המייל של גוגל — אותו מספר שהמנהל מקבל כ-mailQuotaLeft
function showMailQuota() {
  var q = mailQuotaLeft_();
  Logger.log(q === null ? 'לא ניתן לקרוא את מכסת המייל היומית' : 'נשארו להיום ' + q + ' נמענים במכסת המייל היומית של גוגל');
  return q;
}
function quotaErr_() { return { ok: false, error: 'mail_quota', message: 'מכסת המיילים היומית של המערכת התמלאה — נסו שוב מחר או פנו למנהל' }; }
// האם נשארו מספיק נמענים ביום (need) מעבר לרזרבה (reserve); null = לא ידוע = כן
function mailQuotaOk_(need, reserve) { var left = mailQuotaLeft_(); return left === null || left >= need + (reserve || 0); }
// שגיאת קצב בשליחה. scope: 'user' = המגבלה האישית של המשתמש, 'all' = מגבלה כללית של המערכת (לא קשורה אליו). kind: 'o' = שליחה למשרד נוטאם, 'c' = עותקים, 't' = ניסיונות שליחה
function rateErr_(scope, kind) {
  var what = kind === 'o' ? 'השליחות למשרד נוטאם' : kind === 'c' ? 'העותקים' : 'ניסיונות השליחה';
  var msg = scope === 'all'
    ? 'המערכת הגיעה למגבלה הכללית של ' + what + ' בשעה האחרונה (המגבלה אינה אישית ואינה קשורה אליכם) — נסו שוב בעוד זמן קצר'
    : 'הגעתם למגבלה האישית של ' + what + ' בשעה האחרונה — נסו שוב בעוד שעה';
  return { ok: false, error: 'rate', scope: scope, kind: kind === 'o' ? 'office' : kind === 'c' ? 'copy' : 'attempts', message: msg };
}
// מחזיר שליחה אחת לדלי קצב (כשהמייל לא יצא). מיטב המאמץ: בכשל המונה נשאר גבוה — שמרני
function rateRefund_(cache, key) {
  try { var n = Number(cache.get(key)) || 0; if (n > 0) cache.put(key, String(n - 1), 3600); } catch (e) { /* שמרני */ }
}
// נמענים לפי מצב ויעד. תמיד: replyTo = המבקש, והבעלים ב-BCC (אלא אם הוא כבר ב-to/cc, כשהוא עצמו המבקש).
//  חי + משרד: to = משרד נוטאם (קבוע בקוד), cc = המבקש.  בדיקה + משרד, או "לעצמי" (בכל מצב): to = המבקש בלבד.
function mailPlan_(mode, target, requester, owner) {
  var seen = {}, to = [], cc = [], bcc = [];
  if (target === 'office' && mode === 'live') {
    CFG.MAIL_TO.forEach(function (x) { addRcpt_(to, seen, x); });
    addRcpt_(cc, seen, requester);
  } else addRcpt_(to, seen, requester);
  addRcpt_(bcc, seen, owner);
  return { to: to, cc: cc, bcc: bcc, replyTo: requester };
}

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
// נושא מייל: שורה אחת בלבד (מונע הזרקת כותרות), ללא תווי בקרה — כולל תווי C1 (ביניהם NEL) ומפרידי השורה של יוניקוד
function cleanSubject_(s) { return String(s || '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200); }
function cleanBody_(s) { return String(s || '').replace(/\r\n?/g, '\n').replace(/\r/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, 20000); }

/* ---------- אתחול (פעם אחת, מהעורך) ---------- */
function initialize() {
  var p = props_();
  if (!p.getProperty('SECRET')) p.setProperty('SECRET', randHex_(64));
  if (!countAdmins_()) {
    var code = randHex_(10);
    p.setProperty('SETUP_CODE', sha256Hex_(code));
    Logger.log('קוד הקמה חד-פעמי (להקליד בדף ההתחברות בשדה "קוד הקמה"): ' + code);
    return code;
  }
  Logger.log('כבר מאותחל ויש מנהל. אם שכחת את סיסמת המנהל — ב-Script Properties מחק רק את המאפיין של המנהל ("U:" ואחריו שם המשתמש שלו), והרץ שוב. מטיסים רשומים נשארים.');
  return null;
}

/* ---------- נקודות כניסה ---------- */
function doGet() {
  return json_({ ok: true, app: CFG.APP, needsBootstrap: countAdmins_() === 0 && !!props_().getProperty('SETUP_CODE') });
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
// כתובת אחת בלבד: בלי פסיק/נקודה-פסיק/סוגריים/מירכאות — כתובת כזו יכלה להפוך נמען אחד לכמה נמענים כשהיא משמשת בשדה to/cc
function normEmail_(e) { e = String(e || '').trim().toLowerCase(); return (e.length <= 120 && /^[^\s@,;:<>()\[\]"\\]+@[^\s@,;:<>()\[\]"\\]+\.[^\s@,;:<>()\[\]"\\]{2,}$/.test(e)) ? e : ''; }
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
// החשבון של כתובת מייל — רק אם המיפוי E: עדיין נכון: המשתמש קיים והכתובת השמורה אצלו זהה. מיפוי עקר (חשבון שנמחק ידנית ב-Script Properties,
// או שמו נתפס מחדש בידי מטיס אחר) אינו חשבון: אחרת הרשמה שקטה נכשלת, וכרטיס חדש היה מתווסף לחשבון של אדם אחר.
function emailUser_(email) {
  var n = props_().getProperty(emailKey_(email));
  if (!n) return null;
  var u = getUser_(n);
  return (u && normEmail_(u.email) === email) ? { name: n, user: u } : null;
}
function orderOwner_(orderNumber) { return props_().getProperty(orderKey_(orderNumber)); }
// בעל ההזמנה בפועל: שם חשבון קיים שההזמנה רשומה אצלו. מיפוי עקר (O: שנשאר אחרי מחיקת חשבון, גם אם השם נתפס מחדש) — אין בעלים, וההזמנה פנויה
function orderHolder_(orderNumber) {
  var n = orderOwner_(orderNumber);
  if (!n) return '';
  var u = getUser_(n);
  return (u && (u.orders || []).indexOf(String(orderNumber)) >= 0) ? n : '';
}
// ההזמנות שזכאות להרשמה/חידוש: שולמו, הרוכש חבר (אם נדרש), ועדיין לא נוצלו ע"י אף חשבון קיים
function eligibleOrders_(orders) {
  return orders.filter(function (o) { return (!CFG.REQUIRE_MEMBER || o.member) && !orderHolder_(o.orderNumber); });
}
// רשומת קוד ההרשמה לכתובת (R:) — הקוד המגובב, תוקפו, ניסיונות, ומונה כשלונות מצטבר לכתובת (f עד fx) שאינו מתאפס בבקשת קוד חדשה
function regKey_(email) { return 'R:' + sha256Hex_(email).slice(0, 30); }
function readReg_(rk) { var raw = props_().getProperty(rk); if (!raw) return null; try { var o = JSON.parse(raw); return (o && typeof o === 'object') ? o : null; } catch (e) { return null; } }
function regLocked_(rec) { return !!rec && rec.fx > now_() && (Number(rec.f) || 0) >= CFG.CODE_FAIL_MAX; }
// סוגרים רשומת קוד שאינה בשימוש: אם יש מונה כשלונות בתוקף — נשאר רק המונה (בלי הקוד), אחרת נמחקת
function closeReg_(rk, rec) {
  if (rec && rec.fx > now_() && (Number(rec.f) || 0) > 0) props_().setProperty(rk, JSON.stringify({ f: Number(rec.f), fx: rec.fx, exp: 0, tries: 0 }));
  else props_().deleteProperty(rk);
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
// סוג שליחה ברשומת יומן: 'live' = נשלחה חי למשרד נוטאם; 'test' = מצב בדיקה (למבקש בלבד); 'self' = "שלח רק לעצמי" (target:'self').
// שליחה לעצמו נרשמת עם mode:'self' (ולא 'live') — כך גם קוד שאינו מכיר את target לעולם לא יחשיב אותה כשליחה למשרד נוטאם.
// רשומות ישנות (בלי target) הן שליחות למשרד נוטאם: 'live' או 'test' לפי mode.
function sendKind_(s) { return (s.target === 'self' || s.mode === 'self') ? 'self' : (s.mode === 'live' ? 'live' : 'test'); }
// רק שליחה חיה למשרד נוטאם נועלת עריכה וחוסמת שליחה כפולה; שליחה לעצמו/בדיקה לא
function liveSentAt_(entry) { var last = 0; ((entry && entry.sent) || []).forEach(function (s) { if (sendKind_(s) === 'live' && sentOk_(s) && s.t > last) last = s.t; }); return last; }
// מתי נגעו ברשומה לאחרונה: שמירה, יצירה, או שליחה (גם לעצמו / בדיקה)
function lastTouch_(e) {
  var t = Math.max(Number(e && e.saved) || 0, Number(e && e.created) || 0);
  ((e && e.sent) || []).forEach(function (s) { var st = Number(s && s.t) || 0; if (st > t) t = st; });
  return t;
}
// גיזום: LOG_MAX הוא יעד רך. נמחקות רק הרשומות הישנות ביותר שאין סיבה לשמור: לא נשלחו חי, לא נגעו בהן LOG_KEEP_DAYS ימים, ואינן הרשומה שזה עתה נכתבה (keepId).
// בקשה של מטיס אחר שנשמרה/הוכנה לשליחה ועדיין צעירה לעולם אינה נמחקת בכתיבה של מישהו אחר; כשכל מה שנשאר מוגן — היומן פשוט גדל מעבר ל-LOG_MAX.
function trimLog_(arr, keepId) {
  var drop = arr.length - CFG.LOG_MAX;
  if (drop <= 0) return arr;
  var cutoff = now_() - CFG.LOG_KEEP_DAYS * 86400000;
  var victims = arr.filter(function (e) { return e.id !== keepId && !liveSentAt_(e) && lastTouch_(e) < cutoff; })
    .sort(function (x, y) { return lastTouch_(x) - lastTouch_(y); }).slice(0, drop);
  if (!victims.length) return arr;
  return arr.filter(function (e) { return victims.indexOf(e) < 0; });
}
function writeLog_(arr, keepId) { logFile_().setContent(JSON.stringify(trimLog_(arr, keepId))); }
function findByRid_(log, rid) { for (var i = 0; i < log.length; i++) if (log[i].rid === rid) return log[i]; return null; }
function findById_(log, id) { for (var i = 0; i < log.length; i++) if (log[i].id === id) return log[i]; return null; }
// שם תיקייה ייחודי ליומן: בקשה אחרת באותו מקום ותאריך מקבלת סיומת (2), (3)…
// owner (לא חובה): מתחשב רק בבקשות של אותו משתמש — כך מטיס אינו יכול ללמוד משם שקיבל (סיומת "(2)") שבקשה של מישהו אחר כבר קיימת
function uniqueName_(log, name, rid, owner) {
  var taken = {};
  log.forEach(function (e) { if (e.rid !== rid && (owner === undefined || e.user === owner)) taken[e.name] = true; });
  var u = name, n = 1;
  while (taken[u]) u = name.slice(0, 112) + ' (' + (++n) + ')';
  return u;
}
// "השליחה התחילה" נרשמת לפני שהמייל יוצא; בסיום מתעדכנת ל-sent, ובכשל ל-failed
function logSentBegin_(user, folderId, name, mode, target, to, sid) {
  var log = readLog_(), t = now_(), e = findById_(log, folderId);
  if (!e) { e = { id: folderId, rid: '', name: name, user: user, created: t, saved: t, lastUser: user, ready: false, sent: [] }; log.push(e); }
  e.sent = e.sent || [];
  e.sent.push({ sid: sid, t: t, user: user, mode: mode, target: target, to: to, st: 'sending' });
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
    if (countAdmins_()) return { ok: false, error: 'exists' };
    var sc = props_().getProperty('SETUP_CODE');
    if (!sc) return { ok: false, error: 'no_setup' };
    if (lockedFor_('bootstrap')) return { ok: false, error: 'locked' };
    if (!safeEq_(sha256Hex_(String(r.code || '')), sc)) { noteFail_('bootstrap'); return { ok: false, error: 'bad_code' }; }
    if (!validName_(r.user)) return { ok: false, error: 'bad_user' };
    if (!validPass_(r.pass)) return { ok: false, error: 'weak_pass' };
    if (getUser_(r.user)) return { ok: false, error: 'exists' };      // לא דורסים חשבון קיים (מטיס) בשם שנבחר למנהל
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
    var out = withMailInfo_({ ok: true, user: a.name, role: a.user.role, mailMode: mailMode_(), mailTo: CFG.MAIL_TO, until: a.user.until || null, renewUrl: CFG.RENEW_URL }, a.user);
    if (a.user.role === 'admin') out.mailQuotaLeft = mailQuotaLeft_();      // מכסת המייל היומית שנותרה (נמענים): למנהל בלבד; null = לא ידוע
    return out;
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
      (e.sent || []).forEach(function (x) { if (sendKind_(x) === 'live' && sentOk_(x)) { s.sent++; if (x.t > s.lastSent) s.lastSent = x.t; } });   // רק שליחות חיות למשרד נוטאם
    });
    var out = withMailInfo_({ ok: true, mailMode: mailMode_(), logError: logError, users: Object.keys(us).sort().map(function (k) {
      var u = us[k], s = st[k] || { requests: 0, sent: 0, lastRequest: 0, lastSent: 0 };
      return { user: k, role: u.role, blocked: !!u.blocked, created: u.created, changed: u.changed, lastLogin: u.lastLogin || null, requests: s.requests, sent: s.sent, lastRequest: s.lastRequest || null, lastSent: s.lastSent || null,
        email: u.email || '', until: u.until || null, source: u.source || 'manual', blockedWhy: u.blockedWhy || '' };
    }) }, a.user);
    out.mailQuotaLeft = mailQuotaLeft_();      // מכסת המייל היומית שנותרה (נמענים), למנהל בלבד; null = לא ידוע
    return out;
  },

  // יומן הבקשות: כל מי שהגיש בקשה (או רק משתמש מסוים), מהחדשה לישנה
  listRequests: function (r) {
    var a = admin_(r); if (a.error) return { ok: false, error: a.error };
    var limit = Math.max(1, Math.min(200, Number(r.limit) || 100)), who = r.user ? String(r.user) : '';
    var rows = readLog_().filter(function (e) { return !who || e.user === who || e.lastUser === who || (e.sent || []).some(function (s) { return s.user === who; }); })
      .sort(function (x, y) { return y.saved - x.saved; }).slice(0, limit)
      .map(function (e) {
        // sentLive = שליחות חיות למשרד נוטאם; sentTest = מצב בדיקה (למבקש); sentSelf = "שלח רק לעצמי". כל שליחה נספרת באחד בלבד.
        // lastSent = השליחה החיה האחרונה למשרד אם יש (כדי שהזמן שמוצג ליד "נשלחה למשרד נוטאם" לא יהיה של שליחה לעצמו); אחרת האחרונה מכל סוג.
        var sent = e.sent || [], last = sent.length ? sent[sent.length - 1] : null, lastLive = null;
        sent.forEach(function (s) { if (sendKind_(s) === 'live' && sentOk_(s)) lastLive = s; });
        var shown = lastLive || last, kinds = sent.filter(sentOk_).map(sendKind_);
        return { name: e.name, user: e.user, lastUser: e.lastUser, created: e.created, saved: e.saved, url: 'https://drive.google.com/drive/folders/' + e.id,
          sentLive: kinds.filter(function (k) { return k === 'live'; }).length, sentTest: kinds.filter(function (k) { return k === 'test'; }).length, sentSelf: kinds.filter(function (k) { return k === 'self'; }).length,
          lastSent: shown ? { t: shown.t, user: shown.user, mode: shown.mode, target: sendKind_(shown) === 'self' ? 'self' : 'office', st: shown.st || 'sent' } : null, ready: !!e.ready };
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
    // הכרטיסים משתחררים: אפשר להירשם מחדש איתם. מנקים רק מיפויים ששייכים לחשבון הזה (לא של מי שתפס את השם או הכתובת בעקבות מיפוי עקר)
    (du && du.orders || []).forEach(function (o) { if (orderOwner_(o) === r.target) props_().deleteProperty(orderKey_(o)); });
    if (du && du.email) {
      if (props_().getProperty(emailKey_(du.email)) === r.target) props_().deleteProperty(emailKey_(du.email));
      props_().deleteProperty(regKey_(normEmail_(du.email)));      // קוד הרשמה פתוח/מונה כשלונות של הכתובת
    }
    delUser_(r.target);
    return { ok: true };
  },

  // מצב שליחה (מנהל בלבד): test = "שלח למשרד" נשלח רק למבקש עצמו (והבעלים בעותק סמוי); live = למשרד נוטאם
  setMailMode: function (r) {
    var a = admin_(r); if (a.error) return { ok: false, error: a.error };
    var m = r.mode === 'live' ? 'live' : 'test';
    props_().setProperty('MAIL_MODE', m);
    return withMailInfo_({ ok: true, mailMode: m }, a.user);
  },

  // ----- הרשמה וחידוש מנוי (ללא התחברות): רק למי שרכש כרטיס "בקשת אישורי טיסה" ששולם בפועל -----
  // התשובה כאן זהה בין אם יש כרטיס ובין אם אין, כדי שאי אפשר לברר דרכה מי רכש כרטיס. הקוד נשלח רק לכתובת שבהזמנה.
  regStart: function (r) {
    var email = normEmail_(r.email);
    if (!email) return { ok: false, error: 'bad_email' };
    var cache = CacheService.getScriptCache(), hk = Math.floor(now_() / 3600000), ek = 'regE:' + sha256Hex_(email).slice(0, 20) + ':' + hk, gk = 'regG:' + hk;
    var ne = Number(cache.get(ek)) || 0, ng = Number(cache.get(gk)) || 0;
    if (ne >= CFG.REG_PER_EMAIL_HOUR || ng >= CFG.REG_PER_HOUR) return { ok: false, error: 'rate', message: 'יותר מדי ניסיונות — נסו שוב בעוד שעה' };
    // מכסת המיילים היומית של גוגל: בודקים לפני כל כתיבה וצריכת קצב (נמען אחד: הקוד או ההודעה). התשובה זהה לכל כתובת — לא מגלה אם יש כרטיס
    if (!mailQuotaOk_(1, 0)) return quotaErr_();
    cache.put(ek, String(ne + 1), 3600); cache.put(gk, String(ng + 1), 3600);
    // כשלונות קוד מצטברים לכתובת בין קודים (חלון CODE_FAIL_HOURS): אחרי CODE_FAIL_MAX כשלונות לא נוצר קוד ולא נשלח מייל, והתשובה זהה לכתובת בלי כרטיס
    var rk = regKey_(email), prev = readReg_(rk);
    if (regLocked_(prev)) return { ok: true, sent: true };
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
      var carry = (prev && prev.fx > now_()) ? { f: Number(prev.f) || 0, fx: prev.fx } : { f: 0, fx: 0 };   // מונה הכשלונות עובר לקוד החדש — לא מתאפס
      props_().setProperty(rk, JSON.stringify({ h: sha256Hex_(salt + ':' + code), s: salt, exp: now_() + CFG.CODE_TTL_MIN * 60000, tries: 0, f: carry.f, fx: carry.fx }));
      MailApp.sendEmail({ to: email, name: CFG.SENDER_NAME, replyTo: owner || '', subject: (mode === 'renew' ? 'קוד לחידוש המנוי לבקשות טיסה' : 'קוד הרשמה לבקשות טיסה') + ': ' + code,
        body: 'שלום,\n\nהקוד שלך ' + (mode === 'renew' ? 'לחידוש המנוי' : 'להרשמה לבקשות טיסה') + ': ' + code + '\nהקוד תקף ל-' + CFG.CODE_TTL_MIN + ' דקות. אם לא ביקשת — אפשר להתעלם מהמייל.\n\nצוות הארגון הישראלי לרחפנים' });
    }
    return { ok: true, sent: true };
  },

  regFinish: function (r) {
    var email = normEmail_(r.email), code = String(r.code || '').replace(/\D/g, '');
    if (!email || code.length !== 6) return { ok: false, error: 'bad_code' };
    var rk = regKey_(email), rec = readReg_(rk), t0 = now_();
    if (!rec) return { ok: false, error: 'bad_code' };
    if (regLocked_(rec)) return { ok: false, error: 'bad_code' };          // יותר מדי כשלונות לכתובת בחלון — בלי להשוות בכלל (גם לקוד הנכון)
    if (!rec.h || rec.exp < t0 || rec.tries >= CFG.CODE_MAX_TRIES) { closeReg_(rk, rec); return { ok: false, error: 'bad_code' }; }
    if (!safeEq_(sha256Hex_(rec.s + ':' + code), rec.h)) {
      rec.tries++;
      if (!(rec.fx > t0)) { rec.f = 0; rec.fx = t0 + CFG.CODE_FAIL_HOURS * 3600000; }     // כשלון ראשון בחלון חדש
      rec.f = (Number(rec.f) || 0) + 1;
      props_().setProperty(rk, JSON.stringify(rec));
      return { ok: false, error: 'bad_code' };
    }
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
      return { orderNumber: o.orderNumber, created: o.created, member: o.member, used: !!orderHolder_(o.orderNumber), by: orderHolder_(o.orderNumber), eligible: (!CFG.REQUIRE_MEMBER || o.member) && !orderHolder_(o.orderNumber) };
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
    // השם בדרייב ייחודי גלובלית (כדי שהמנהל יבדיל בין תיקיות), אבל מטיס רגיל מקבל בחזרה שם שחושב מהבקשות שלו בלבד —
    // סיומת "(2)" שנגרמה מבקשה של מישהו אחר הייתה מגלה לו שקיימת בקשה כזו
    return { ok: true, folderId: folder.getId(), url: folder.getUrl(), name: a.user.role === 'admin' ? unique : uniqueName_(log, name, rid, a.name) };
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

  // שליחת הבקשה במייל. target: 'office' (ברירת מחדל; כמו בשרת הישן) = "שלח למשרד", 'self' = "שלח רק לעצמי"; כל ערך אחר => bad_target.
  // הנמענים נקבעים בשרת בלבד (ראו mailPlan_): משרד נוטאם = CFG.MAIL_TO הקבוע (רק במצב חי + office), המבקש = כתובת המשתמש המחובר
  // השמורה אצלו (או הבעלים, למשתמש בלי כתובת), והבעלים תמיד בעותק סמוי. שום שדה בבקשה לא קובע נמען.
  // תנאים שנאכפים כאן ולא רק בדפדפן: הבקשה ביומן ונשמרה כ"מוכנה" (saveEnd), רק בעליה או מנהל שולחים אותה,
  // ב-office הלקוח חייב לציין באיזה מצב (test/live) הוצג למשתמש — אם המצב השתנה השרת לא שולח (mode_changed),
  // ושליחה חוזרת למשרד של בקשה שכבר נשלחה "חי" דורשת again:true במפורש. שליחה לעצמו אינה נחשבת "נשלחה למשרד נוטאם":
  // היא לא נועלת את הבקשה, לא חוסמת שליחה אמיתית ולא נבדקת מול expectMode — אבל נספרת בהגבלת הקצב וב"נשלח — ....txt".
  sendRequest: function (r) {
    var a = auth_(r.token); if (a.error) return { ok: false, error: a.error };
    var target = r.target === undefined ? 'office' : r.target;      // חסר => office (לקוח ישן); null/ריק/מחרוזת אחרת => נדחה
    if (target !== 'office' && target !== 'self') return { ok: false, error: 'bad_target' };
    var mode = mailMode_(), toOffice = target === 'office';
    if (toOffice && r.expectMode !== mode) return withMailInfo_({ ok: false, error: 'mode_changed', mailMode: mode }, a.user);
    var folder = requestFolder_(r.folderId);
    if (!folder) return { ok: false, error: 'bad_folder' };
    var subject = cleanSubject_(r.subject), body = cleanBody_(r.body);
    if (!subject || !body) return { ok: false, error: 'bad_mail' };

    var log = readLog_(), entry = findById_(log, folder.getId());
    if (!entry) return { ok: false, error: 'bad_folder' };
    if (entry.user !== a.name && a.user.role !== 'admin') return { ok: false, error: 'forbidden' };
    if (!entry.ready) return { ok: false, error: 'not_ready', message: 'הבקשה לא נשמרה כמוכנה לשליחה — יש להשלים את הבדיקות ולשמור שוב בדרייב' };
    if (toOffice && mode === 'live' && !r.again) {
      if (liveSentAt_(entry)) return { ok: false, error: 'already_sent', sentAt: liveSentAt_(entry) };
      // אותו מקום ותאריך שכבר נשלחו חי מבקשה אחרת של אותו מבקש (למשל אחרי רענון הדף, כשמזהה הבקשה אבד) — גם זו כפילות אפשרית למשרד נוטאם.
      // רק של אותו מבקש (entry.user): מטיסים שונים הם בקשות שונות ולגיטימיות, ומטיס לעולם לא מקבל הודעה או שעה על שליחה של מטיס אחר
      var base = entry.base || entry.name, twin = 0;
      log.forEach(function (e) { if (e.id !== entry.id && e.user === entry.user && (e.base || e.name) === base) twin = Math.max(twin, liveSentAt_(e)); });
      if (twin) return { ok: false, error: 'already_sent', sentAt: twin, similar: true };
    }

    // הגבלת קצב שעתית בדליים נפרדים לפי סוג ('o' = שליחה חיה למשרד נוטאם, 'c' = עותקים: לעצמו / בדיקה), כל אחד לכל משתמש ובסך הכול — עיון בעותקים לא חוסם שליחה אמיתית.
    // הדליים עולים לפני היציאה ויורדים בחזרה אם MailApp נכשל (שליחה שלא יצאה לא צורכת מכסה); ניסיונות שהגיעו עד MailApp נספרים בנפרד (tryKey) ואינם יורדים — תקרה נגד לולאת ניסיונות.
    var kind = (toOffice && mode === 'live') ? 'o' : 'c', lim = kind === 'o' ? { u: CFG.MAX_OFFICE_PER_HOUR, a: CFG.MAX_OFFICE_PER_HOUR_ALL } : { u: CFG.MAX_COPIES_PER_HOUR, a: CFG.MAX_COPIES_PER_HOUR_ALL };
    var cache = CacheService.getScriptCache(), hour = Math.floor(now_() / 3600000), uh = sha256Hex_(a.name).slice(0, 16);
    var allKey = 'sends:' + kind + ':' + hour, userKey = 'sends:u:' + kind + ':' + uh + ':' + hour, tryKey = 'sends:t:' + uh + ':' + hour;
    var sendsAll = Number(cache.get(allKey)) || 0, sendsUser = Number(cache.get(userKey)) || 0, tries = Number(cache.get(tryKey)) || 0;
    if (sendsUser >= lim.u) return rateErr_('user', kind);
    if (sendsAll >= lim.a) return rateErr_('all', kind);
    if (tries >= CFG.MAX_SEND_ATTEMPTS_PER_HOUR) return rateErr_('user', 't');

    var c = folderFiles_(folder);
    if (!c.hasDocx || !c.hasImage) return { ok: false, error: 'missing_files', message: 'חסר קובץ Word או תמונת מפה/תצ"א בתיקייה' };   // א-11 נספח ג': חובה לצרף מפה/תצ"א
    if (c.total > CFG.MAX_MAIL_BYTES) return { ok: false, error: 'too_big' };

    // המבקש = כתובת המשתמש המחובר (שמורה ומאומתת); בלי כתובת — הבעלים. הבעלים חייב להיות ידוע: הוא תמיד מקבל עותק סמוי (נכשל סגור)
    var owner = ownerEmail_(), requester = requesterEmail_(a.user) || owner;
    if (!owner || !requester) return { ok: false, error: 'no_owner' };
    var plan = mailPlan_(mode, target, requester, owner), to = plan.to;
    // מכסת המיילים היומית של גוגל נספרת לפי נמענים (to+cc+bcc): בודקים מראש, כדי שהכשל יהיה ברור, לא יירשם "failed" ביומן ולא יצרוך קצב.
    // עותקים משאירים רזרבה (MAIL_QUOTA_RESERVE) לשליחה האמיתית למשרד ולקודי ההרשמה.
    var need = plan.to.length + plan.cc.length + plan.bcc.length;
    if (!mailQuotaOk_(need, kind === 'o' ? 0 : CFG.MAIL_QUOTA_RESERVE)) return quotaErr_();
    var prefix = !toOffice ? '[עותק לעצמי — לא נשלח למשרד נוטאם] ' : mode === 'live' ? '' : '[בדיקה — לא נשלח למשרד נוטאם] ';
    // ביומן: שליחה לעצמו נרשמת כ-mode:'self' (ראו sendKind_) — לעולם לא כ"נשלחה חי"
    var sid = randHex_(12), t = logSentBegin_(a.name, folder.getId(), folder.getName(), toOffice ? mode : 'self', target, to, sid);   // נרשם לפני היציאה: אם משהו קורס אחרי השליחה, אין מייל כפול
    cache.put(allKey, String(sendsAll + 1), 3600); cache.put(userKey, String(sendsUser + 1), 3600); cache.put(tryKey, String(tries + 1), 3600);
    try {
      var opts = { to: to.join(','), replyTo: plan.replyTo, name: CFG.SENDER_NAME, subject: prefix + subject, body: body, attachments: c.blobs };
      if (plan.cc.length) opts.cc = plan.cc.join(',');
      if (plan.bcc.length) opts.bcc = plan.bcc.join(',');
      MailApp.sendEmail(opts);
    } catch (err) {
      rateRefund_(cache, allKey); rateRefund_(cache, userKey);      // המייל לא יצא — לא צורכים מכסת שליחות (קריסה באמצע נשארת צרוכה: שמרני)
      try { logSentEnd_(folder.getId(), sid, 'failed'); } catch (e2) { /* הרשומה נשארת "בשליחה" — שמרני */ }
      throw err;
    }
    try { logSentEnd_(folder.getId(), sid, 'sent'); } catch (e3) { /* המייל כבר יצא; הרשומה נשארת "בשליחה" וממשיכה לחסום כפילות */ }
    try {   // סימון בתוך תיקיית הבקשה, כדי שגם מי שפותח את התיקייה בדרייב יראה שנשלחה
      var kindName = !toOffice ? 'עותק לעצמו — לא נשלח למשרד נוטאם' : mode === 'live' ? 'חי — למשרד נוטאם' : 'בדיקה — למבקש בלבד, לא נשלח למשרד נוטאם';
      folder.createFile('נשלח — ' + Utilities.formatDate(new Date(t), 'Asia/Jerusalem', 'yyyy-MM-dd HH-mm') + (!toOffice ? ' (לעצמו)' : mode === 'live' ? '' : ' (בדיקה)') + '.txt',
        ['נשלח ע"י: ' + a.name, 'יעד: ' + (toOffice ? 'משרד' : 'לעצמו'), 'מצב: ' + kindName, 'אל: ' + to.join(', '), 'עותק: ' + (plan.cc.length ? plan.cc.join(', ') : '—'), 'עותק סמוי למנהל: כן', 'נושא: ' + prefix + subject, 'קבצים: ' + c.names.join(' | ')].join('\n'), 'text/plain');
    } catch (e4) { /* הסימון אינו חיוני */ }
    // owner לא מוחזר ללקוח אלא כשהוא עצמו המבקש (to/cc מכילים רק את כתובת המבקש וכתובות משרד נוטאם; ה-BCC לא מוחזר)
    return { ok: true, mode: mode, target: target, to: to, cc: plan.cc, adminCopy: true, files: c.names, sentAt: t };
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
  return withMailInfo_({ ok: true, token: t.token, exp: t.exp, user: name, role: u.role, mailMode: mailMode_(), mailTo: CFG.MAIL_TO, until: u.until || null, renewUrl: CFG.RENEW_URL }, u);
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
