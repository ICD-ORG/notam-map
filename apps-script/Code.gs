/**
 * שרת בקשות הטיסה של הארגון הישראלי לרחפנים — Google Apps Script (רץ בחשבון של הבעלים).
 *  - התחברות נפרדת בשם משתמש וסיסמה (לא קשורה לשער חברי האתר).
 *  - ניהול משתמשים: הוספה, חסימה/ביטול חסימה, איפוס סיסמה, החלפת סיסמה עצמית, מחיקה — הכול נאכף כאן, בשרת, בכל קריאה.
 *  - שמירת קבצי הבקשה (Word, KML, תמונות) בדרייב, בתיקייה "<מקום> — <תאריך>" שנפרדת לפי סוג החשבון: "הארגון" (בקשות הארגון), "מטיסים/<משתמש>" (בקשות מטיסים עצמאיים).
 *  - הפרדה בין חשבון ארגוני (org=true: מנהלים, ומשתמשים שהמנהל הוסיף ידנית) לבין מטיס עצמאי (org=false: נרשם עם כרטיס): הארגון שולח בשם הארגון, מטיס שולח בשם הגורם שהצהיר עליו.
 *  - יומן בקשות: מי שמר ושלח מה ומתי (קובץ _יומן בקשות.json בתיקיית הבקשות), עם סוג כל בקשה (kind) — המנהל רואה את כולם.
 *  - שליחה במייל, עם הקבצים מהתיקייה: למשרד נוטאם (הכתובות הקבועות מפמ"ת א-11 סעיף 6(א) בלבד) או רק למבקש עצמו.
 *    המבקש = המשתמש המחובר, בכתובת המייל ששמורה אצלו (נרשמה ואומתה בקוד). כתובת הארגון (CFG.ADMIN_COPY_TO) מקבלת עותק: סמוי (BCC) ממטיס עצמאי, גלוי (CC) מחשבון ארגוני בשליחה חיה.
 *  - "הבקשות שלי" (myRequests), טעינת בקשה שנשמרה (getRequest) ושמירת דוח בדיקה חוזרת בתת-תיקייה של הבקשה (saveRecheck) — פעולות נוספות בלבד, השמירה והשליחה אינן משתנות.
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
  SENDER_NAME: 'הארגון הישראלי לרב להב',   // שם השולח במיילים של חשבון ארגוני (ובמיילי מערכת: קודי הרשמה, תזכורות)
  // שם השולח במייל של מטיס עצמאי = שם הגורם המבקש שהצהיר עליו (מנוקה, עד SENDER_MAX תווים) + הסיומת הקבועה הזו, שנועדה למנוע התחזות לרשות או לגוף אחר.
  // בלי שם בבקשה: displayName השמור (מ-Wix), ובלי גם אותו: SENDER_FALLBACK
  SENDER_SUFFIX: ' — דרך מערכת בקשות הטיסה',
  SENDER_FALLBACK: 'מטיס',
  SENDER_MAX: 60,
  // כתובת הארגון: מקבלת עותק מכל שליחה (סמוי ממטיס עצמאי, גלוי מחשבון ארגוני בשליחה חיה) והיא "המבקש" של חשבון ארגוני בלי כתובת שמורה. מפורשת — לא תלויה בבעל הסקריפט.
  // ריקה/לא תקינה: נופלים לכתובת הבעלים (Session.getEffectiveUser). אם גם היא לא ידועה — השליחה נכשלת סגור (no_owner). לעולם לא מוחזרת ללקוח אלא לחשבון ארגוני.
  ADMIN_COPY_TO: 'office@icd.org.il',
  // כתובת התמיכה שמוצגת למטיסים בגוף המיילים (זהה ל-support_email ב-config.json). כתובת הארגון עצמה לעולם לא מודפסת למטיס
  SUPPORT_EMAIL: 'info@icd.org.il',
  // תיקיות הדרייב החדשות מתחת ל-ROOT_FOLDER_ID: בקשות ארגוניות ב-ORG_FOLDER_NAME, בקשות מטיסים ב-PILOTS_FOLDER_NAME/<שם המשתמש>. נוצרות לפי דרישה; תיקיות בקשה ישנות (ישירות תחת התיקייה הראשית) נשארות במקומן
  ORG_FOLDER_NAME: 'הארגון',
  PILOTS_FOLDER_NAME: 'מטיסים',
  // הגבלת קצב שעתית בשני דליים נפרדים: 'o' = שליחה חיה למשרד נוטאם (בקשה אמיתית), 'c' = עותקים ("שלח רק לעצמי", וגם "שלח למשרד" במצב בדיקה שנשלח למבקש בלבד).
  // כך עיון בעותקים (הפעולה השכיחה ביותר) לא חוסם שליחה אמיתית — לא של אותו מטיס ולא של אחרים. אלה תקרות קצב בלבד; מכסת המיילים היומית של גוגל נבדקת בנפרד (MAIL_QUOTA_RESERVE).
  // חשבון ארגוני (org) פטור מהתקרות הכוללות (..._ALL) ומהרזרבה — כדי שמטיסים לא ירעיבו את הארגון — אך לא מהתקרות האישיות; שליחותיו עדיין נספרות בסך הכול.
  MAX_OFFICE_PER_HOUR: 10,       // שליחות חיות למשרד נוטאם — לכל משתמש בנפרד
  MAX_OFFICE_PER_HOUR_ALL: 60,   // ... ובסך הכול לכל המערכת
  MAX_COPIES_PER_HOUR: 10,       // עותקים (לעצמו / בדיקה) — לכל משתמש בנפרד
  MAX_COPIES_PER_HOUR_ALL: 120,  // ... ובסך הכול לכל המערכת (לא נמוכה מ-60: עיון בעותקים הוא הפעולה השכיחה, ומאה מטיסים לא אמורים לחסום זה את זה)
  MAX_SEND_ATTEMPTS_PER_HOUR: 40, // ניסיונות שליחה שהגיעו עד MailApp (גם כושלים) לכל משתמש — שליחה שנכשלה אינה צורכת את הדליים למעלה, אבל לולאת ניסיונות לא תציף את היומן
  MAIL_QUOTA_RESERVE: 20,        // רזרבה במכסת המיילים היומית של גוגל (נמענים) שעותקים אינם צורכים — כדי שהשליחה האמיתית למשרד וקודי ההרשמה לא יורעבו
  FEATURES: ['sendTarget', 'orgSplit', 'advView', 'myRequests', 'recheck'],      // יכולות שהשרת מדווח עליהן ללקוח (שרת ישן לא מדווח — והלקוח משבית "שלח רק לעצמי"; בלי orgSplit הלקוח גוזר את סוג החשבון מ-role ואינו שולח שם שולח; בלי advView אין שדה adv והלקוח נשאר עם ברירת המחדל לפי סוג החשבון; בלי myRequests אין "הבקשות שלי" (myRequests/getRequest); בלי recheck אין בדיקה חוזרת (saveRecheck))
  MAX_MAIL_BYTES: 24 * 1024 * 1024,
  LOG_NAME: '_יומן בקשות.json',
  LOG_MAX: 2000,           // יעד רך: מעבר לכך נמחקות רק הישנות ביותר שלא נשלחו חי ולא נגעו בהן LOG_KEEP_DAYS ימים; כשהכול מוגן היומן פשוט גדל
  LOG_KEEP_DAYS: 30,       // בקשה שלא נשלחה חי ושונתה/נשלחה לעצמה בתקופה הזו לעולם אינה נמחקת בגיזום (של אף משתמש)
  MAX_NEW_FOLDERS_PER_HOUR: 30,  // תקרת תיקיות בקשה חדשות למשתמש בשעה — מונע הצפה של הדרייב והיומן
  // --- תקרות אחסון (saveFile / saveBegin): מטיס אחד לא ממלא את הדרייב של הבעלים, לא מנפח את היומן ולא מאט את השרת (נעילת הסקריפט) לאחרים. מנהל פטור מהמכסות האישיות (לא מהתקרות לתיקייה).
  MAX_FOLDER_FILES: 12,          // קבצי בקשה (Word, KML, תמונות, JSON) בתיקייה אחת — הלקוח כותב 7 (Word, KML, 4 תמונות, JSON); סימוני "נשלח — ....txt" אינם נספרים
  MAX_FOLDER_BYTES: 24 * 1024 * 1024,   // נפח כולל של קבצי הבקשה בתיקייה — לא מעל תקרת המייל (MAX_MAIL_BYTES): בקשה גדולה יותר לא תישלח בכל מקרה
  // הדף מעלה לדרייב אוטומטית בכל פעם שהבקשה הופכת מוכנה (saveBegin + 7-8 קבצים + saveEnd, ושמירה חוזרת מוחקת את הקודמים — הקבצים בתיקייה לא מצטברים), ולכן נפח השעה והיום מוגדר לפי מחזורים:
  // מחזור שמגיע לתקרת התיקייה (24MB, המקסימום האפשרי) × 5 מחזורים × 3 בקשות בשעה = 360MB ≤ 400MB; ו-10 בקשות × 4 מחזורים ביום = 960MB ≤ 1000MB. (בגודל טיפוסי, כ-10–15MB למחזור: ארבע תמונות 1280×960 + Word + KML, אלה 26–40 מחזורים בשעה)
  MAX_UPLOAD_BYTES_PER_HOUR: 400 * 1024 * 1024,   // בייטים שנכתבו בשעה לכל משתמש (נמדדים בכתיבה, לא בנפח שנשמר: גרסה ישנה שנזרקה לאשפה עדיין תופסת מקום בדרייב)
  MAX_UPLOAD_BYTES_PER_DAY: 1000 * 1024 * 1024,   // ... וביום (שעון ישראל) לכל משתמש
  MAX_OPEN_REQUESTS_PER_USER: 60, // בקשות של משתמש שלא נשלחו חי ושנגעו בהן ב-LOG_KEEP_DAYS הימים האחרונים — מעבר לכך אין תיקייה חדשה (בקשה שנשלחה חי משחררת מקום)
  MAX_SENT_PER_REQUEST: 100,     // רשומות שליחה בבקשה אחת ביומן; מעבר לכך נמחקות הישנות ביותר שאינן שליחה חיה
  // --- שלב ב׳: "הבקשות שלי" (myRequests, getRequest) ובדיקה חוזרת (saveRecheck). כל הקריאות רצות תחת נעילת הסקריפט הכללית, ולכן קטנות וחסומות: myRequests נבנית מהיומן בלבד (בלי קריאת דרייב לכל שורה),
  // getRequest קוראת קובץ אחד קטן, saveRecheck מפענחת קובץ אחד קטן. בדיקה חוזרת נכתבת בתת-תיקייה של תיקיית הבקשה (לא בתיקייה עצמה: שם היא הייתה מצורפת למייל ונספרת בתקרות הקבצים)
  MAX_MYREQ_ROWS: 50,            // שורות ב"הבקשות שלי" (החדשות ביותר)
  MAX_MYREQ_ROWS_ADMIN: 100,     // ... למנהל (כולל all / user)
  MAX_MYREQ_PER_HOUR: 60,        // קריאות myRequests בשעה לכל משתמש
  MAX_RECORD_BYTES: 600000,      // גודל מרבי של קובץ "נתוני הבקשה" ש-getRequest מוכנה לקרוא (תחת הנעילה)
  MAX_RECORD_SCAN_FILES: 80,     // כמה קבצים בתיקיית הבקשה getRequest סורקת בחיפוש קובץ נתוני הבקשה (תיקייה מנופחת לא נסרקת עד הסוף)
  MAX_RECORD_READS_PER_HOUR: 30, // קריאות getRequest בשעה לכל משתמש (מנהל פטור)
  RECHECK_FOLDER_NAME: 'בדיקות חוזרות',   // תת-התיקייה (בתוך תיקיית הבקשה) שבה נשמרים דוחות הבדיקה החוזרת; נוצרת לפי דרישה
  MAX_RECHECK_B64: 3 * 1024 * 1024,        // תקרת דוח בדיקה חוזרת אחד אחרי קידוד base64
  MAX_RECHECKS_PER_REQUEST: 20,            // דוחות בדיקה חוזרת לבקשה אחת
  MAX_RECHECK_FOLDER_BYTES: 16 * 1024 * 1024,   // נפח כולל של תת-התיקייה
  MAX_RECHECK_SAVES_PER_HOUR: 10,          // שמירות בדיקה חוזרת בשעה לכל משתמש (מנהל פטור); בנוסף נספרות בתקציבי ההעלאה (MAX_UPLOAD_BYTES_PER_HOUR / PER_DAY)
  // --- מנוי מטיס מסחרי: כרטיס "בקשת אישורי טיסה" באתר הארגון (Wix Events). הרשמה רק למי שיש לו הזמנה ששולמה בפועל.
  WIX_SITE_ID: '29dca6d8-08d4-4679-a6e5-c5f4f3317d90',        // icd.org.il
  WIX_EVENT_ID: 'fbcb2cc1-4dc7-4545-b9d5-08febf9f8153',       // האירוע "בקשת אישורי טיסה"
  RENEW_URL: 'https://www.icd.org.il/events-1/bqst-yswry-tysh',
  REQUIRE_MEMBER: true,         // הרוכש חייב להיות חבר רשום באתר (להזמנה memberId)
  VALID_MONTHS: 12,             // כל כרטיס ששולם מזכה בתקופה הזו, מיום הרכישה (ובחידוש מוקדם — מתווסף לסוף התקופה הנוכחית)
  REMIND_DAYS: [30, 3],         // תזכורות: חודש לפני הסיום, ו-3 ימים לפני
  CODE_TTL_MIN: 15, CODE_MAX_TRIES: 5,
  CODE_FAIL_MAX: 10, CODE_FAIL_HOURS: 6,   // ניחושי קוד שגויים לכתובת מצטברים בין קודים: אחרי CODE_FAIL_MAX כשלונות מושהית ההרשמה לכתובת (בשקט) עד שחלון CODE_FAIL_HOURS חולף
  // --- הרשמה (regStart, ללא התחברות). כל שער כאן זהה לכל כתובת: אסור שתשובה כלשהי תגלה מי רכש כרטיס או מי רשום.
  REG_PER_EMAIL_HOUR: 5,         // בקשות תקינות לכתובת בשעה — נספרות בכל בקשה, בלי קשר לכרטיס (ספירה רק של מיילים שנשלחו הייתה מגלה בעלי כרטיס)
  REG_WIX_PER_HOUR: 600,         // שאילתות Wix בשעה לכל המערכת (כל בקשה שעוברת את שאר השערים) — מגן על מכסת UrlFetch היומית (20,000 בחשבון Gmail רגיל) ועל נעילת הסקריפט; חריגה = אותה תשובה לכולם
  REG_MAILS_PER_HOUR: 150,       // מיילי הרשמה שנשלחו בפועל (קודים והודעת "כבר קיים חשבון") בשעה, בסך הכול — מותאם להשקה של כ-100 נרשמים בשעה אחת
  REG_MAILS_PER_DAY: 400,        // ... וביום (שעון ישראל)
  REG_MAILS_PER_EMAIL_DAY: 10,   // קודי הרשמה/חידוש שנשלחו בפועל לכתובת ביום — מעבר לכך נדחה בשקט (אותה תשובה), כדי שכתובת אחת לא תצרוך את התקציב הכללי ולא תוצף
  REG_EXISTS_HOURS: 24,          // הודעת "כבר קיים חשבון" לכל היותר פעם בחלון הזה לכתובת (חותמת ב-Script Properties; המטמון מוגבל ל-6 שעות)
  // הודעת "לא נמצא כרטיס" (regStart): נשלחת רק לכתובת שהקלידו, ורק כששאילתת Wix הצליחה ואין לכתובת כרטיס זכאי וגם לא חשבון. התקציב שלה נפרד לגמרי מתקציב קודי ההרשמה (REG_MAILS_*), כדי שמי שמקליד כתובות אקראיות לא יאכל קודים אמיתיים
  REG_NOTICKET_HOURS: 24,        // לכל היותר הודעה אחת בחלון הזה לכתובת (נרשם ברשומה אחת ב-Script Properties בשם REG_NOTICKET, שגוזמת את עצמה — לא נוצר מאפיין לכל כתובת זבל)
  REG_NOTICKET_PER_HOUR: 20,     // הודעות כאלה שיצאו בפועל בשעה האחרונה, בסך הכול (חלון מתגלגל)
  REG_NOTICKET_PER_DAY: 100,     // ... ובעשרים וארבע השעות האחרונות (עד 300 — הרשומה היא מאפיין אחד, עד 9KB). חריגה מכל תקרה = דילוג בשקט, באותה תשובה; ההודעה משאירה גם את MAIL_QUOTA_RESERVE
  MAIL_QUOTA_RESERVE_REG: 8,     // רזרבה במכסת המיילים היומית שקודי הרשמה אינם צורכים (שתי שליחות חיות למשרד נוטאם); הודעת "כבר קיים חשבון" משאירה MAIL_QUOTA_RESERVE כמו עותקים
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
// הקמה ראשונה נדרשת כשאין אף מנהל *פעיל* (לא כשאין אף משתמש): מי ששכח את סיסמת המנהל מוחק רק את חשבון המנהל, ומאות המטיסים נשארים.
// מנהל חסום או שפג תוקפו אינו נספר: הוא לא יכול להתחבר, ואם אין עוד מי שישחרר אותו הספירה שלו הייתה נועלת את השחזור ("כבר מאותחל ויש מנהל") בלי רמז.
// אין בכך פתח לתוקף: הקמה דורשת את SETUP_CODE, שרק הבעלים מנפיק (initialize מהעורך, ואין לו מקבילה בשרת), ו-initialize מוחק קוד ישן כשיש מנהל פעיל. ראו גם bootstrap.
function isActiveAdmin_(u) { return !!u && u.role === 'admin' && !u.blocked && !(u.until && Number(u.until) < now_()); }
function countAdmins_() { var us = users_(), n = 0; for (var k in us) if (isActiveAdmin_(us[k])) n++; return n; }
// כל מנהלי ה-U: (גם חסומים/שפג תוקפם) עם הסטטוס — להדפסה ביומן ההרצה של initialize, כדי שהבעלים יידע מה עוד מחזיק את הנעילה
function adminSummary_() {
  var us = users_(), out = [];
  Object.keys(us).sort().forEach(function (k) { if (us[k] && us[k].role === 'admin') out.push(k + (us[k].blocked ? ' (חסום)' : (us[k].until && Number(us[k].until) < now_()) ? ' (פג תוקף)' : ' (פעיל)')); });
  return out;
}
function secret_() { var s = props_().getProperty('SECRET'); if (!s) throw new Error('לא בוצעה אתחול — להריץ initialize()'); return s; }
function ownerEmail_() { try { return Session.getEffectiveUser().getEmail() || ''; } catch (e) { return ''; } }
// כתובת הארגון (orgAddr): CFG.ADMIN_COPY_TO כשהיא כתובת תקינה אחת (normEmail_ דוחה פסיק/כמה כתובות), ואחרת כתובת הבעלים; '' כשאף אחת לא ידועה (נכשל סגור)
function orgAddr_() { return normEmail_(CFG.ADMIN_COPY_TO) || normEmail_(ownerEmail_()); }
// סוג חשבון: מנהל הוא תמיד ארגוני (גם אם מישהו ערך את הרשומה ב-Properties); אחרת לפי השדה org (רק true בדיוק). משתמש קיים בלי שדה — עצמאי
function isOrg_(u) { return !!u && (u.role === 'admin' || u.org === true); }
// "תצוגה מתקדמת" (adv) — הרשאה אישית לכל משתמש, נפרדת מסוג החשבון: מנהל תמיד כן (גם אם הרשומה נערכה ל-false); אחרת הערך הבוליאני השמור ברשומה (ההכרעה של המנהל, setAdv);
// ובלי ערך שמור (או ערך שאינו בוליאני) — ברירת מחדל לפי סוג החשבון: ארגוני כן, מטיס עצמאי לא. כך משתמש קיים בלי השדה שומר על ברירת המחדל. נקרא מהרשומה בכל קריאה, לא מהאסימון
function advOf_(u) { return !!u && (u.role === 'admin' || (typeof u.adv === 'boolean' ? u.adv : isOrg_(u))); }
// ההכרעה השמורה כפי שהיא (true / false), או null = ברירת המחדל לפי הסוג (גם למנהל: ערך שמור אצלו אינו נקרא) — כדי שהמנהל יראה מה ברירת מחדל ומה עקיפה
function advExplicit_(u) { return (u && u.role !== 'admin' && typeof u.adv === 'boolean') ? u.adv : null; }
// סוג בקשה ביומן: 'pilot' רק כשנרשם כך ב-saveBegin; רשומה ישנה (בלי kind, בתיקייה ישירות תחת הראשית) נחשבת ארגונית
function kindOf_(e) { return e && e.kind === 'pilot' ? 'pilot' : 'org'; }
// מצב שליחה: 'test' (ברירת מחדל) — "שלח למשרד" נשלח רק למבקש עצמו; 'live' — למשרד נוטאם. רק מנהל משנה (setMailMode).
function mailMode_() { return props_().getProperty('MAIL_MODE') === 'live' ? 'live' : 'test'; }
// כתובת המבקש = הכתובת ששמורה אצל המשתמש (נשמרת רק ברישום עם כרטיס, אחרי אימות קוד שנשלח אליה). אין שום קלט בבקשה שקובע אותה —
// אחרת השרת היה הופך לממסר דואר זבל. נבדקת שוב בכל שימוש. משתמש בלי כתובת (נוצר ידנית ע"י המנהל, כולל המנהל עצמו) — מחזיר ''.
function requesterEmail_(u) { return normEmail_(u && u.email); }
// מה שהלקוח צריך לדעת על המייל: email = כתובת המבקש השמורה (או ''), org = חשבון ארגוני, copyTo = לאן יישלחו עותקים/"שלח לעצמי" (בלי כתובת — כתובת הארגון).
// copyToIsOwner (שם ישן, לתאימות) = העותק יוצא לכתובת הארגון כי אין כתובת למשתמש. כתובת הארגון מוחזרת רק לחשבון ארגוני: מטיס עצמאי בלי כתובת שמורה
// (נוצר ידנית עם org:false) מקבל copyTo ריק ו-false — לעולם לא את כתובת הארגון. adv = התצוגה המתקדמת בפועל (advOf_) של המשתמש עצמו בלבד — לא של אחרים.
function mailInfo_(u) {
  var email = requesterEmail_(u), org = isOrg_(u), oa = org ? orgAddr_() : '';
  return { email: email, copyTo: email || oa, copyToIsOwner: !email && !!oa, org: org, adv: advOf_(u), features: CFG.FEATURES.slice() };
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
    var q = MailApp.getRemainingDailyQuota();
    return (typeof q === 'number' && q === q) ? q : null;      // null / '' / NaN = לא ידוע (Number(null) === 0 היה נקרא "המכסה נגמרה" ונועל את כל ההרשמות)
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
// נמענים לפי סוג החשבון, המצב והיעד. stored = כתובת המשתמש השמורה (או ''), orgA = כתובת הארגון; אותה כתובת (באותיות קטנות) לא מופיעה פעמיים (addRcpt_).
//  ארגוני — חי + משרד: to = משרד נוטאם (קבוע בקוד), cc = כתובת הארגון (וגם כתובת המשתמש השמורה אם שונה), בלי BCC, replyTo = כתובת הארגון.
//           בדיקה + משרד, או "לעצמי": to = כתובת המשתמש השמורה, ובלי — כתובת הארגון; cc = כתובת הארגון (אם שונה, כדי שהארגון יקבל עותק מכל שליחה של עובד, גם בדיקה); בלי BCC; replyTo = כתובת הארגון.
//  עצמאי — חי + משרד: to = משרד נוטאם, cc = המבקש (הכתובת השמורה), BCC = כתובת הארגון, replyTo = המבקש.
//           בדיקה + משרד, או "לעצמי": to = המבקש, BCC = כתובת הארגון, replyTo = המבקש. (המבקש בלי כתובת שמורה = כתובת הארגון.)
function mailPlan_(org, mode, target, stored, orgA) {
  var seen = {}, to = [], cc = [], bcc = [], live = target === 'office' && mode === 'live', requester = stored || orgA;
  if (live) CFG.MAIL_TO.forEach(function (x) { addRcpt_(to, seen, x); });
  if (org) {
    if (live) { addRcpt_(cc, seen, orgA); addRcpt_(cc, seen, stored); } else { addRcpt_(to, seen, requester); addRcpt_(cc, seen, orgA); }
    return { to: to, cc: cc, bcc: bcc, replyTo: orgA };
  }
  addRcpt_(live ? cc : to, seen, requester);
  addRcpt_(bcc, seen, orgA);
  return { to: to, cc: cc, bcc: bcc, replyTo: requester };
}
// שם השולח (name של MailApp). ארגוני: CFG.SENDER_NAME. עצמאי: שם הגורם המבקש שהמטיס הצהיר עליו (fromName, מנוקה) + CFG.SENDER_SUFFIX הקבועה — כך אי אפשר להתחזות
// לרשות ("משטרת ישראל — דרך מערכת בקשות הטיסה"). בלי שם אחרי הניקוי: displayName השמור, ובלי גם אותו: SENDER_FALLBACK. הסיומת נוספת בכל שלושת המקרים.
// הניקוי מסיר בקרה/כיווניות/שורות חדשות, וגם <>"@ ולוכסן הפוך (שם תצוגה שנראה ככתובת מייל או שבורח ממירכאות), מכווץ רווחים וחותך ל-SENDER_MAX
function cleanSender_(s) {
  var t = (typeof s === 'string' ? s : '').replace(SENDER_BAD_RE_, ' ').replace(/\s+/g, ' ').trim().slice(0, CFG.SENDER_MAX), last = t.charCodeAt(t.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) t = t.slice(0, -1).trim();      // לא נחתכים באמצע זוג חלופי (אימוג'י)
  return t;
}
function senderName_(u, fromName) {
  if (isOrg_(u)) return CFG.SENDER_NAME;
  return (cleanSender_(fromName) || cleanSender_(u && u.displayName) || CFG.SENDER_FALLBACK) + CFG.SENDER_SUFFIX;
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
// תווים בלתי נראים שאסור להשאיר בשמות תיקיות/קבצים ובנושא המייל: בקרה (C0 ו-C1, כולל NUL ו-NEL), סימוני כיווניות (U+200B-200F, U+202A-202E, U+2066-2069, U+061C),
// מפרידי שורה/פסקה (U+2028-2029) ו-BOM. הטווחים נבנים ב-String.fromCharCode כדי שהקוד עצמו לא יכיל תווים בלתי נראים (או רצפי escape שכלי עריכה מפענחים)
var HIDDEN_CHARS_ = [[0, 0x1f], [0x7f, 0x9f], [0x61c, 0x61c], [0x200b, 0x200f], [0x2028, 0x202e], [0x2066, 0x2069], [0xfeff, 0xfeff]]
  .map(function (r) { return String.fromCharCode(r[0]) + (r[1] > r[0] ? '-' + String.fromCharCode(r[1]) : ''); }).join('');
var HIDDEN_RE_ = new RegExp('[' + HIDDEN_CHARS_ + ']', 'g');
var SENDER_BAD_RE_ = new RegExp('[<>"@' + String.fromCharCode(92) + String.fromCharCode(92) + HIDDEN_CHARS_ + ']', 'g');   // לוכסן הפוך כפול: בתוך מחלקת תווים ברגקס הוא תו מילולי אחד
function cleanFolderName_(s) { return String(s || '').replace(/[\\/:*?"<>|]/g, ' ').replace(HIDDEN_RE_, ' ').replace(/\s+/g, ' ').trim().slice(0, 120); }
function cleanFileName_(s) {   // חיתוך אורך לא שומט את הסיומת (אחרת הקובץ לא יזוהה כ-Word/תמונה בשליחה)
  var raw = String(s || '').trim(), m = /\.[A-Za-z0-9]{1,5}$/.exec(raw), ext = m ? m[0].toLowerCase() : '';
  var base = cleanFolderName_(ext ? raw.slice(0, -ext.length) : raw).slice(0, 110).trim();
  return (base || 'file') + ext;
}
// נושא מייל: שורה אחת בלבד (מונע הזרקת כותרות), ללא תווי בקרה — כולל תווי C1 (ביניהם NEL), מפרידי השורה של יוניקוד וסימוני כיווניות (שמסתירים/הופכים טקסט)
function cleanSubject_(s) { return String(s || '').replace(HIDDEN_RE_, ' ').replace(/\s+/g, ' ').trim().slice(0, 200); }
function cleanBody_(s) { return String(s || '').replace(/\r\n?/g, '\n').replace(/\r/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, 20000); }
// גרסת ה-HTML של גוף המייל (htmlBody; ה-body הטקסטואלי נשאר כגיבוי לקורא בלי HTML), מימין לשמאל ומיושרת לימין: שורות רצופות שמתחילות ב"• " (תבליט + רווח) הופכות לרשימה אחת,
// שורה אחרת — שורה בפני עצמה (גוף ישן בלי תבליטים נשאר שורות), שורה ריקה — רווח. הגוף מגיע מהלקוח ואינו אמין: כל טקסט עובר escape, ולא נוצרים קישורים, תמונות או סקריפטים.
function escapeHtml_(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function htmlBody_(text) { return rtlWrap_(htmlLines_(text)); }
// העטיפה המשותפת (מימין לשמאל, מיושרת לימין) — גם למייל "לא נמצא כרטיס", שמוסיף לה כפתור אחד משלו (ראו noTicketMail_)
function rtlWrap_(inner) { return '<div dir="rtl" style="direction:rtl;text-align:right;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6">' + inner + '</div>'; }
function htmlLines_(text) {
  var out = [], items = null;
  var flush = function () {
    if (items) out.push('<ul dir="rtl" style="direction:rtl;text-align:right;margin:4px 0;padding:0 22px 0 0">' + items.join('') + '</ul>');
    items = null;
  };
  var lines = String(text).split('\n'), a = 0, b = lines.length;
  while (a < b && !lines[a].trim()) a++;                  // שורות ריקות בהתחלה ובסוף לא הופכות לרווח (בלי regex על רצף רווחים: ריצוד ריבועי)
  while (b > a && !lines[b - 1].trim()) b--;
  lines.slice(a, b).forEach(function (line) {
    var m = /^\u2022 ([\s\S]*)$/.exec(line);       // [\s\S] ולא . — נקודה לא תופסת U+2028/2029 שנשארים בגוף
    if (m) { (items = items || []).push('<li style="text-align:right">' + escapeHtml_(m[1].trim()) + '</li>'); return; }
    flush();
    out.push(line.trim() ? '<div style="text-align:right">' + escapeHtml_(line.trim()) + '</div>' : '<br>');
  });
  flush();
  return out.join('');
}

/* ---------- אתחול (פעם אחת, מהעורך) ---------- */
// קוד ההקמה הוא הדבר היחיד שמאפשר ליצור מנהל מרחוק, ולכן הוא ארוך (128 ביט) ו*אין נעילה לניסיונות שגויים* ב-bootstrap: כל נעילה ללא זהות (Apps Script לא מוסר כתובת IP)
// היא כפתור שכל אחד לוחץ עליו כדי לחסום את שחזור המנהל לצמיתות; את ניחוש הקוד עוצרת האנטרופיה, לא ספירת ניסיונות. הקוד אינו נשלח לאף מקום והוא נשמר מגובב.
function initialize() {
  var p = props_();
  if (!p.getProperty('SECRET')) p.setProperty('SECRET', randHex_(64));
  if (!countAdmins_()) {
    var code = randHex_(32);
    p.setProperty('SETUP_CODE', sha256Hex_(code));
    Logger.log('קוד הקמה חד-פעמי (להקליד בדף ההתחברות בשדה "קוד הקמה"): ' + code);
    var held = adminSummary_();
    if (held.length) Logger.log('שימו לב: קיימים חשבונות מנהל לא פעילים (' + held.join(', ') + '). הם נשארים ואינם נספרים; מנהל חדש ייווצר בשם אחר.');
    return code;
  }
  p.deleteProperty('SETUP_CODE');      // קוד הקמה ישן שלא נוצל: כשיש מנהל פעיל הוא לא אמור להישאר (אחרת יופעל אם כל המנהלים יחסמו בעתיד)
  Logger.log('כבר מאותחל ויש מנהל פעיל (' + adminSummary_().join(', ') + '). אם שכחת את סיסמת המנהל — ב-Script Properties מחק רק את המאפיין של המנהל ("U:" ואחריו שם המשתמש שלו), והרץ שוב. מטיסים רשומים נשארים. מנהל חסום או שפג תוקפו אינו נספר כמנהל פעיל.');
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
function readJsonProp_(k) { var raw = props_().getProperty(k); if (!raw) return null; try { var o = JSON.parse(raw); return (o && typeof o === 'object') ? o : null; } catch (e) { return null; } }
function readReg_(rk) { return readJsonProp_(rk); }
function regLocked_(rec) { return !!rec && rec.fx > now_() && (Number(rec.f) || 0) >= CFG.CODE_FAIL_MAX; }
// סוגרים רשומת קוד שאינה בשימוש: אם יש מונה כשלונות בתוקף — נשאר רק המונה (בלי הקוד), אחרת נמחקת
function closeReg_(rk, rec) {
  if (rec && rec.fx > now_() && (Number(rec.f) || 0) > 0) props_().setProperty(rk, JSON.stringify({ f: Number(rec.f), fx: rec.fx, exp: 0, tries: 0 }));
  else props_().deleteProperty(rk);
}
// ----- הרשמה: תקציבי מיילים ושערים כלליים (regStart). כולם תלויים רק במצב המערכת, אף פעם לא בכתובת/כרטיס/חשבון — כדי שאי אפשר יהיה לגלות דרכם מי רכש כרטיס או מי רשום -----
function dayKey_() { return Utilities.formatDate(new Date(now_()), 'Asia/Jerusalem', 'yyyy-MM-dd'); }
// סיכום מיילי הרשמה לכתובת שהמערכת שלחה לה בפועל (M:): d = יום, n = קודים שנשלחו באותו יום, x = מתי נשלחה לאחרונה הודעת "כבר קיים חשבון".
// נוצר רק אחרי שליחה אמיתית — בקשות זבל לכתובות שרירותיות לא יוצרות אותו, ולכן מספרו חסום במספר בעלי הכרטיסים/החשבונות
function mailRecKey_(email) { return 'M:' + sha256Hex_(email).slice(0, 30); }
// תקציב מיילי ההרשמה הכללי (קודים והודעת "כבר קיים חשבון" שיצאו בפועל): שעתי במטמון ויומי ב-Script Properties (המטמון מוגבל ל-6 שעות). נבדק בתחילת regStart ונספר רק אחרי ש-MailApp הצליח
function regBudgetFull_(cache, hk) {
  if ((Number(cache.get('regM:' + hk)) || 0) >= CFG.REG_MAILS_PER_HOUR) return true;
  var d = readJsonProp_('REG_MAILS');
  return (d && d.d === dayKey_() ? Number(d.n) || 0 : 0) >= CFG.REG_MAILS_PER_DAY;
}
function regBudgetAdd_(cache, hk) {
  cache.put('regM:' + hk, String((Number(cache.get('regM:' + hk)) || 0) + 1), 3600);
  var d = readJsonProp_('REG_MAILS'), day = dayKey_();
  props_().setProperty('REG_MAILS', JSON.stringify({ d: day, n: (d && d.d === day ? Number(d.n) || 0 : 0) + 1 }));
}
function regOk_() { return { ok: true, sent: true }; }
// חריגה במכסה כללית (שאילתות Wix / תקציב מיילי ההרשמה): אותה תשובה לכל כתובת. scope:'all' = המגבלה אינה אישית (הדף מציג את ההודעה כפי שהיא)
function regBusyErr_() { return { ok: false, error: 'rate', scope: 'all', message: 'המערכת עמוסה כרגע בבקשות הרשמה — המגבלה אינה אישית; נסו שוב בעוד זמן קצר' }; }
// ----- הודעת "לא נמצא כרטיס": ספר ההודעות שיצאו (REG_NOTICKET) -----
// מאפיין אחד בלבד: { l: ['<10 תווי גיבוב של הכתובת>:<שניות>', ...] }, נגזם לפי הזמן בכל קריאה — כך כתובות זבל שרירותיות לא יוצרות מאפיין לכל כתובת ולא ממלאות את Script Properties
// (בניגוד ל-M:, שנוצר רק לבעלי כרטיס/חשבון). משמש גם לחותמת הכתובת (REG_NOTICKET_HOURS) וגם לתקציב השעתי והיומי; המערכת רצה תחת נעילת הסקריפט, ולכן אין מרוץ בין קריאה לכתיבה.
var NOTICKET_PROP_ = 'REG_NOTICKET', NOTICKET_MAX_TRACKED_ = 300;   // 300 רשומות ≈ 8KB, מתחת לתקרת מאפיין בודד (9KB)
function noTicketLog_(t0) {
  var rec = readJsonProp_(NOTICKET_PROP_), cut = Math.floor(t0 / 1000) - Math.max(CFG.REG_NOTICKET_HOURS, 24) * 3600, out = [];
  ((rec && Array.isArray(rec.l)) ? rec.l : []).forEach(function (s) {
    var m = /^([0-9a-f]{10}):([0-9]{9,11})$/.exec(String(s));
    if (m && Number(m[2]) > cut) out.push({ h: m[1], s: Number(m[2]) });      // רשומה פגומה או ישנה נשמטת
  });
  return out;
}
// מותר לשלוח עכשיו? הכתובת לא קיבלה בחלון REG_NOTICKET_HOURS, התקציב השעתי והיומי של ההודעה הזו לא מלאים (נפרדים מתקציב הקודים), והרשומה לא גדולה מדי. תלוי רק בכתובת ובמצב המערכת
function noTicketOk_(log, h, t0) {
  var sec = Math.floor(t0 / 1000), seen = false, hour = 0, day = 0;
  log.forEach(function (e) {
    if (e.h === h && sec - e.s < CFG.REG_NOTICKET_HOURS * 3600) seen = true;
    if (sec - e.s < 3600) hour++;
    if (sec - e.s < 86400) day++;
  });
  return !seen && hour < CFG.REG_NOTICKET_PER_HOUR && day < CFG.REG_NOTICKET_PER_DAY && log.length < NOTICKET_MAX_TRACKED_;
}
function noTicketWrite_(log, h, t0) {
  var l = log.map(function (e) { return e.h + ':' + e.s; });
  l.push(h + ':' + Math.floor(t0 / 1000));
  props_().setProperty(NOTICKET_PROP_, JSON.stringify({ l: l }));
}
// בעת מחיקת משתמש: מונים שעתיים/יומיים ששמורים לפי שם המשתמש לא עוברים למי שיתפוס את השם אחריו
function clearUserCounters_(name) {
  var c = CacheService.getScriptCache(), uh = sha256Hex_(name).slice(0, 16), h = Math.floor(now_() / 3600000);
  ['nf:' + uh + ':' + h, 'up:' + uh + ':' + h, 'sends:u:o:' + uh + ':' + h, 'sends:u:c:' + uh + ':' + h, 'sends:t:' + uh + ':' + h].forEach(function (k) { c.remove(k); });
  props_().deleteProperty('B:' + uh);
}
// תוקף חדש אחרי הוספת הזמנות: כל הזמנה מוסיפה VALID_MONTHS, מהמאוחר מבין (סוף התקופה הנוכחית, יום ההזמנה)
function applyOrders_(until, orders) {
  var u = Number(until) || 0;
  orders.forEach(function (o) { u = addMonths_(Math.max(u, o.created), CFG.VALID_MONTHS); });
  return u;
}
// כתובת https בלבד לכפתור: מארח (בלי פרטי משתמש) ונתיב ב-ASCII הניתן להדפסה, בלי רווחים, מירכאות, סוגריים משולשים ולוכסן הפוך. כל דבר אחר = '' (בלי כפתור; נכשל סגור)
function safeHttpsUrl_(u) {
  u = String(u || '');
  return (u.length <= 300 && /^https:\/\/[a-z0-9]([a-z0-9.\-]*[a-z0-9])?(:[0-9]{1,5})?([\/?#][\x21-\x7e]*)?$/i.test(u) && !/[<>"'\\]/.test(u)) ? u : '';
}
// מייל "לא נמצא כרטיס" (regStart): נבנה אך ורק ממחרוזות קבועות בשרת וממה שבקונפיגורציה — שום טקסט מהלקוח, והנמען הוא הכתובת שהוקלדה בלבד.
// כפתור אחד לכל היותר (<a> עם כתובת CFG.RENEW_URL אם היא https תקינה, אחרת בלי כפתור); כתובת הארגון אינה מופיעה בגוף (רק ב"השב ל"); כתובת התמיכה נדפסת רק אם היא לא כתובת הארגון.
function noTicketMail_(email) {
  var sup = normEmail_(CFG.SUPPORT_EMAIL), url = safeHttpsUrl_(CFG.RENEW_URL), label = 'לרכישת הכרטיס והצטרפות';
  if (sup && sup === orgAddr_()) sup = '';
  var head = ['שלום,', '',
    'ביקשתם להירשם לבקשות טיסה בכתובת הזו. בדקנו את הרישומים ולא נמצא כרטיס ששולם עבור ״בקשת אישורי טיסה״.', '',
    'ייתכן שנרשמתם רק למפת הנוט״מים — היא אינה כוללת בקשות טיסה, שמיועדות למטיסים מסחריים ודורשות רכישה נפרדת של הכרטיס.', '',
    'הצטרפות למערכת בקשות הטיסה מאפשרת להכין ולהגיש בקשות לסגירה אווירית בקלות ובמהירות, עם פחות בירוקרטיה. המערכת בודקת מראש אזורי איסור, נוטמים ומכשולים באזור, ובכך מסייעת למנוע תאונות שנובעות מחוסר ידיעה.'].join('\n');
  var tail = 'אם כבר רכשתם את הכרטיס, ודאו שהמייל שהקלדתם הוא מייל הרכישה' + (CFG.REQUIRE_MEMBER ? ', ושהכרטיס נרכש כשאתם מחוברים כחברים רשומים באתר' : '') + '.' + (sup ? ' לשאלות: ' + sup : '');
  var button = url ? '<div style="text-align:right;margin:12px 0"><a href="' + escapeHtml_(url) + '" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 22px;background:#0b5cad;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold">' + escapeHtml_(label) + '</a></div>' : '<br>';
  return { to: email, name: CFG.SENDER_NAME, replyTo: orgAddr_() || '', subject: 'לא נמצא כרטיס ״בקשת אישורי טיסה״ על הכתובת הזו',
    body: head + '\n\n' + (url ? label + ': ' + url + '\n\n' : '') + tail,      // גיבוי טקסטואלי לקורא בלי HTML
    htmlBody: rtlWrap_(htmlLines_(head) + button + htmlLines_(tail)) };
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
// נעילת הסקריפט הגלובלית (שאותה לוקח כל doPost) אינה מוחזקת בזמן קריאות רשת: עד 200 שאילתות Wix ומאות מיילים הן דקות, ובהן כל מטיס היה מקבל "השרת עסוק".
//  שלב א' — בלי נעילה: צילום קריא-בלבד של המשתמשים ושאילתות Wix; יוצא ממנו רק מי שיש לגביו מה לעשות (חסימה / תזכורת).
//  שלב ב' — לכל משתמש כזה נעילה קצרה: קוראים את הרשומה מחדש (לא את הצילום — חידוש, איפוס סיסמה או חסימה שהגיעו בינתיים לא נדרסים; כתיבת הצילום החזירה
//  למשל הזמנה שנוצלה לפנויה ושחזרה סיסמה ישנה), בודקים שהתנאי עדיין נכון, משנים ושולחים את התזכורת (מייל אחד), ומשחררים. הרשמה במקביל מחכה לכל היותר מייל אחד.
// מגבלת 200 השאילתות מסתובבת בין המשתמשים (DC_CURSOR): מי שנבדק אתמול נבדק שוב רק אחרי שהאחרים קיבלו תור, כך שאף משתמש לא נשאר בסוף הרשימה ללא בדיקה.
var DAILY_WIX_CALLS = 200;
function rotateFrom_(names, after) {
  if (!after) return names;
  var i = 0; while (i < names.length && names[i] <= after) i++;
  return names.slice(i).concat(names.slice(0, i));
}
function dailyCheck() {
  var stat = { checked: 0, reminded: 0, blocked: 0, errors: 0, busy: 0 };
  var us = users_(), now = now_(), calls = 0, cut = false, lastDone = '', orgA = orgAddr_(), jobs = [];
  rotateFrom_(Object.keys(us).sort(), props_().getProperty('DC_CURSOR')).forEach(function (name) {
    var u = us[name], job = { name: name, bad: '', remind: false };
    if (!u || !u.until) return;
    stat.checked++;
    if (CFG.RECHECK_ORDERS && !u.blocked && u.orders && u.orders.length && !cut) {
      try {
        for (var i = 0; i < u.orders.length; i++) {
          if (calls >= DAILY_WIX_CALLS) { cut = true; break; }
          calls++;
          var st = wixOrderStatus_(u.orders[i]);
          if (st === 'CANCELED' || st === 'DECLINED' || st === 'VOIDED') { job.bad = String(u.orders[i]); job.why = 'order_' + st; break; }
        }
      } catch (e) { stat.errors++; /* תקלה ב-Wix אינה חוסמת משתמשים */ }
      if (!cut) lastDone = name;
    }
    if (job.bad || reminderStep_(u, now)) jobs.push(job);
  });
  if (cut) props_().setProperty('DC_CURSOR', lastDone); else props_().deleteProperty('DC_CURSOR');
  jobs.forEach(function (job) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) { stat.busy++; return; }       // השרת עסוק מאוד: המשתמש הזה יטופל בריצה הבאה
    try {
      var u = getUser_(job.name), changed = false;
      if (!u) return;
      if (job.bad && !u.blocked && (u.orders || []).indexOf(job.bad) >= 0) { u.blocked = true; u.blockedWhy = job.why; u.tv = (Number(u.tv) || 1) + 1; changed = true; stat.blocked++; }
      var step = u.blocked ? '' : reminderStep_(u, now);
      if (step) {
        try {
          var days = Math.ceil((u.until - now) / 86400000), rem = u.reminded || {}, m = subscriptionMail_(u, job.name, days, u.until);
          MailApp.sendEmail({ to: u.email, subject: m.subject, body: m.body, name: CFG.SENDER_NAME, replyTo: orgA || '' });
          rem[step] = now; if (step === 'd3') rem.d30 = rem.d30 || now;
          u.reminded = rem; changed = true; stat.reminded++;
        } catch (e) { stat.errors++; }
      }
      if (changed) putUser_(job.name, u);
    } finally { lock.releaseLock(); }
  });
  Logger.log('dailyCheck ' + JSON.stringify(stat));
  return stat;
}
// איזו תזכורת מגיעה למשתמש עכשיו ('d30' / 'd3'), או '' — יש כתובת מאומתת, המנוי לא הסתיים, החשבון פעיל והתזכורת הזו (או המאוחרת ממנה) עוד לא נשלחה
function reminderStep_(u, now) {
  if (!u || !u.email || !u.until || u.blocked) return '';
  var days = Math.ceil((u.until - now) / 86400000), rem = u.reminded || {};
  if (days < 0) return '';
  var step = days <= CFG.REMIND_DAYS[1] ? 'd3' : days <= CFG.REMIND_DAYS[0] ? 'd30' : '';
  return (step && !rem[step] && !(step === 'd30' && rem.d3)) ? step : '';
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
// שם תיקייה ייחודי בתוך תיקיית האב (parentId): בקשה אחרת באותו מקום ותאריך *באותה תיקיית אב* מקבלת סיומת (2), (3)… — בקשות ארגוניות בתיקיית "הארגון", ובקשות של מטיס בתיקייה האישית שלו
// (רשומה ישנה בלי parent היא בתיקייה הראשית). owner (לא חובה): מתחשב רק בבקשות של אותו משתמש — כך מטיס אינו יכול ללמוד משם שקיבל (סיומת "(2)") שבקשה של מישהו אחר כבר קיימת
function uniqueName_(log, name, rid, parentId, owner) {
  var taken = {};
  log.forEach(function (e) { if (e.rid !== rid && (e.parent || CFG.ROOT_FOLDER_ID) === parentId && (owner === undefined || e.user === owner)) taken[e.name] = true; });
  var u = name, n = 1;
  while (taken[u]) u = name.slice(0, 112) + ' (' + (++n) + ')';
  return u;
}
// "השליחה התחילה" נרשמת לפני שהמייל יוצא; בסיום מתעדכנת ל-sent, ובכשל ל-failed
function logSentBegin_(user, folderId, name, mode, target, to, sid, from) {
  var log = readLog_(), t = now_(), e = findById_(log, folderId);
  if (!e) { e = { id: folderId, rid: '', name: name, user: user, created: t, saved: t, lastUser: user, ready: false, sent: [] }; log.push(e); }
  e.sent = e.sent || [];
  e.sent.push({ sid: sid, t: t, user: user, mode: mode, target: target, to: to, from: from || '', st: 'sending' });
  trimSent_(e);
  writeLog_(log, folderId);
  return t;
}
// תקרת רשומות שליחה בבקשה אחת (MAX_SENT_PER_REQUEST): מטיס שמשגר שוב ושוב עותקים/בדיקות/ניסיונות כושלים לא מנפח את היומן. נמחקות הישנות ביותר שאינן שליחה חיה פעילה —
// שליחה חיה נועלת עריכה וחוסמת כפילות, ולכן לעולם אינה נמחקת כאן
function trimSent_(e) {
  var drop = (e.sent || []).length - CFG.MAX_SENT_PER_REQUEST;
  if (drop <= 0) return;
  e.sent = e.sent.filter(function (x) { if (drop > 0 && !(sendKind_(x) === 'live' && sentOk_(x))) { drop--; return false; } return true; });
}
function logSentEnd_(folderId, sid, st) {
  var log = readLog_(), e = findById_(log, folderId);
  if (!e) return;
  (e.sent || []).forEach(function (x) { if (x.sid === sid) x.st = st; });
  writeLog_(log, folderId);
}

/* ---------- פעולות ---------- */
var ACTIONS = {
  // הקמת מנהל ראשון/שחזור: רק כשאין מנהל פעיל וקיים SETUP_CODE (שרק הבעלים יכול להנפיק, מהעורך). בכוונה בלי נעילה אחרי קודים שגויים — ראו הערה ב-initialize
  bootstrap: function (r) {
    if (countAdmins_()) return { ok: false, error: 'exists' };
    var sc = props_().getProperty('SETUP_CODE');
    if (!sc) return { ok: false, error: 'no_setup' };
    if (!safeEq_(sha256Hex_(String(r.code || '')), sc)) return { ok: false, error: 'bad_code' };
    if (!validName_(r.user)) return { ok: false, error: 'bad_user' };
    if (!validPass_(r.pass)) return { ok: false, error: 'weak_pass' };
    if (getUser_(r.user)) return { ok: false, error: 'exists' };      // לא דורסים חשבון קיים (מטיס) בשם שנבחר למנהל
    var salt = randHex_(24), u = { role: 'admin', org: true, blocked: false, tv: now_(), salt: salt, hash: hashPass_(salt, r.pass), created: now_(), changed: now_() };
    putUser_(r.user, u);
    props_().deleteProperty('SETUP_CODE');
    return loginOk_(r.user, u);
  },

  login: function (r) {
    var name = String(r.user || ''), fk = 'u:' + name;     // מפתח הנעילה של כניסה בקידומת משלו: שם שמוקלד בדף ("bootstrap", "pw:...") לא מתנגש במפתחות נעילה אחרים (שחזור מנהל, החלפת סיסמה)
    if (lockedFor_(fk)) return { ok: false, error: 'locked', message: 'יותר מדי ניסיונות — נסו שוב בעוד ' + CFG.LOCK_MINUTES + ' דקות' };
    var u = getUser_(name);
    var good = !!u && safeEq_(hashPass_(u.salt, String(r.pass || '')), u.hash);
    if (!good) { noteFail_(fk); return { ok: false, error: 'bad_login' }; }
    if (u.blocked) return { ok: false, error: 'blocked' };
    if (u.until && Number(u.until) < now_()) { clearFails_(fk); return { ok: false, error: 'sub_expired', until: u.until, renewUrl: CFG.RENEW_URL }; }
    clearFails_(fk);
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

  // המנהל רואה את כל המשתמשים, וליד כל אחד: סוג חשבון (org), כמה בקשות שמר/שלח ומתי לאחרונה. totals = סיכומי היומן כולו לפי סוג הבקשה (kind), להפרדה בין הארגון למטיסים:
  // { org: { requests, sent }, pilot: { requests, sent } } — requests = רשומות ביומן, sent = שליחות חיות למשרד נוטאם (כמו sent ליד כל משתמש). בקשה ישנה בלי kind נספרת כארגונית.
  listUsers: function (r) {
    var a = admin_(r); if (a.error) return { ok: false, error: a.error };
    var us = users_(), log = [], st = {}, logError = '', totals = { org: { requests: 0, sent: 0 }, pilot: { requests: 0, sent: 0 } };
    try { log = readLog_(); } catch (err) { logError = String(err && err.message || err); }   // תקלת יומן לא מונעת מהמנהל לחסום משתמשים
    log.forEach(function (e) {
      var s = st[e.user] || (st[e.user] = { requests: 0, sent: 0, lastRequest: 0, lastSent: 0 }), tk = totals[kindOf_(e)];
      s.requests++; tk.requests++; if (e.saved > s.lastRequest) s.lastRequest = e.saved;
      (e.sent || []).forEach(function (x) { if (sendKind_(x) === 'live' && sentOk_(x)) { s.sent++; tk.sent++; if (x.t > s.lastSent) s.lastSent = x.t; } });   // רק שליחות חיות למשרד נוטאם
    });
    var out = withMailInfo_({ ok: true, mailMode: mailMode_(), logError: logError, totals: totals, users: Object.keys(us).sort().map(function (k) {
      var u = us[k], s = st[k] || { requests: 0, sent: 0, lastRequest: 0, lastSent: 0 };
      return { user: k, role: u.role, org: isOrg_(u), blocked: !!u.blocked, created: u.created, changed: u.changed, lastLogin: u.lastLogin || null, requests: s.requests, sent: s.sent, lastRequest: s.lastRequest || null, lastSent: s.lastSent || null,
        email: u.email || '', until: u.until || null, source: u.source || 'manual', blockedWhy: u.blockedWhy || '', adv: advOf_(u), advExplicit: advExplicit_(u) };
    }) }, a.user);
    out.mailQuotaLeft = mailQuotaLeft_();      // מכסת המייל היומית שנותרה (נמענים), למנהל בלבד; null = לא ידוע
    return out;
  },

  // יומן הבקשות: כל מי שהגיש בקשה (או רק משתמש מסוים), מהחדשה לישנה
  listRequests: function (r) {
    var a = admin_(r); if (a.error) return { ok: false, error: a.error };
    var limit = Math.max(1, Math.min(200, Number(r.limit) || 100)), who = r.user ? String(r.user) : '', only = (r.kind === 'org' || r.kind === 'pilot') ? r.kind : '';   // kind (לא חובה): רק בקשות ארגוניות / של מטיסים
    var rows = readLog_().filter(function (e) { return (!only || kindOf_(e) === only) && (!who || e.user === who || e.lastUser === who || (e.sent || []).some(function (s) { return s.user === who; })); })
      .sort(function (x, y) { return y.saved - x.saved; }).slice(0, limit)
      .map(function (e) {
        // sentLive = שליחות חיות למשרד נוטאם; sentTest = מצב בדיקה (למבקש); sentSelf = "שלח רק לעצמי". כל שליחה נספרת באחד בלבד.
        // lastSent = השליחה החיה האחרונה למשרד אם יש (כדי שהזמן שמוצג ליד "נשלחה למשרד נוטאם" לא יהיה של שליחה לעצמו); אחרת האחרונה מכל סוג.
        var sent = e.sent || [], last = sent.length ? sent[sent.length - 1] : null, lastLive = null;
        sent.forEach(function (s) { if (sendKind_(s) === 'live' && sentOk_(s)) lastLive = s; });
        var shown = lastLive || last, kinds = sent.filter(sentOk_).map(sendKind_);
        return { name: e.name, kind: kindOf_(e), user: e.user, lastUser: e.lastUser, created: e.created, saved: e.saved, url: 'https://drive.google.com/drive/folders/' + e.id,
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
    // org: חשבון ארגוני (ברירת מחדל true — משתמש שהמנהל מוסיף ידנית הוא של הארגון) או false = מטיס עצמאי. מנהל הוא תמיד ארגוני. ערך שאינו בוליאני נדחה (לא מנחשים הרשאה)
    if (r.org != null && typeof r.org !== 'boolean') return { ok: false, error: 'bad_org' };
    var salt = randHex_(24), role = r.role === 'admin' ? 'admin' : 'user';
    var nu = { role: role, org: role === 'admin' || r.org !== false, blocked: false, tv: now_(),   // tv=זמן יצירה: משתמש שנמחק ונוצר מחדש באותו שם לא מחייה אסימונים ישנים
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

  // מנהל: שינוי סוג חשבון (org: true = ארגוני, false = מטיס עצמאי). רק למשתמש שאינו מנהל — מנהל הוא תמיד ארגוני (is_admin). לא מבטל אסימונים: הסוג נקרא מהרשומה בכל קריאה.
  // משפיע על שליחות ובקשות חדשות בלבד; בקשות קיימות נשארות במקומן ובסוגן (kind)
  setOrg: function (r) {
    var a = admin_(r); if (a.error) return { ok: false, error: a.error };
    var u = getUser_(String(r.target || ''));
    if (!u) return { ok: false, error: 'no_user' };
    if (typeof r.org !== 'boolean') return { ok: false, error: 'bad_org' };
    if (u.role === 'admin') return { ok: false, error: 'is_admin', message: 'חשבון מנהל הוא תמיד חשבון ארגוני' };
    u.org = r.org;
    putUser_(r.target, u);
    return { ok: true, org: r.org };
  },

  // מנהל: הרשאת תצוגה מתקדמת למשתמש (adv: true = מוצגת, false = מוסתרת), בלי קשר לסוג החשבון — גם למטיס שנרשם לבד. רק למשתמש שאינו מנהל: מנהל תמיד רואה (is_admin).
  // לא מבטלת אסימונים: ההרשאה נקראת מהרשומה בכל קריאה. מחזירה את הערך בפועל (advOf_). משתמש שלא הוכרע לגביו (או רשומה ישנה בלי השדה) נשאר בברירת המחדל לפי סוג החשבון
  setAdv: function (r) {
    var a = admin_(r); if (a.error) return { ok: false, error: a.error };
    var u = getUser_(String(r.target || ''));
    if (!u) return { ok: false, error: 'no_user' };
    if (typeof r.adv !== 'boolean') return { ok: false, error: 'bad_adv' };
    if (u.role === 'admin') return { ok: false, error: 'is_admin', message: 'חשבון מנהל תמיד רואה את התצוגה המתקדמת' };
    u.adv = r.adv;
    putUser_(r.target, u);
    return { ok: true, adv: advOf_(u) };
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

  // מחיקת משתמש משחררת את השם: מטיס חדש יכול להירשם באותו שם. לכן ביומן הבקשות שם המשתמש של הנמחק מוחלף בשם מוחלף ("<שם>:נמחק:<מזהה>") — validName_ אוסר ':', אז אי אפשר להירשם בשם הזה —
  // וכך המשתמש החדש לא יורש יומן: לא רואה, לא עורך ולא שולח את הבקשות של הקודם, ואין חשיפה של "כבר נשלח"/שעת שליחה שלו. הרשומות והתיקיות נשארות למנהל (listRequests מציג את השם המוחלף).
  // נעשה לפני מחיקת החשבון: אם היומן פגום/הדרייב נופל — המחיקה נכשלת (נכשל סגור, ואפשר לחסום את המשתמש במקום). מחיר מוסכם: מטיס שנמחק ונרשם מחדש מאבד את אזהרת הכפילות על בקשות שכבר שלח.
  deleteUser: function (r) {
    var a = admin_(r); if (a.error) return { ok: false, error: a.error };
    if (!getUser_(String(r.target || ''))) return { ok: false, error: 'no_user' };
    if (r.target === a.name) return { ok: false, error: 'self' };
    var du = getUser_(r.target);
    var tomb = r.target + ':נמחק:' + randHex_(8), log = readLog_(), touched = false;
    log.forEach(function (e) {
      if (e.user === r.target) { e.user = tomb; touched = true; }
      if (e.lastUser === r.target) { e.lastUser = tomb; touched = true; }
      (e.sent || []).forEach(function (x) { if (x.user === r.target) { x.user = tomb; touched = true; } });
    });
    if (touched) writeLog_(log, '');
    // הכרטיסים משתחררים: אפשר להירשם מחדש איתם. מנקים רק מיפויים ששייכים לחשבון הזה (לא של מי שתפס את השם או הכתובת בעקבות מיפוי עקר)
    (du && du.orders || []).forEach(function (o) { if (orderOwner_(o) === r.target) props_().deleteProperty(orderKey_(o)); });
    if (du && du.email) {
      if (props_().getProperty(emailKey_(du.email)) === r.target) props_().deleteProperty(emailKey_(du.email));
      props_().deleteProperty(regKey_(normEmail_(du.email)));      // קוד הרשמה פתוח/מונה כשלונות של הכתובת
      props_().deleteProperty(mailRecKey_(normEmail_(du.email)));  // וסיכום מיילי ההרשמה של הכתובת (מכסת קודים יומית, חותמת "כבר קיים חשבון")
    }
    clearUserCounters_(r.target);
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
  // כלל ברזל: התשובה כאן זהה בין אם יש כרטיס, חשבון או שום דבר, כדי שאי אפשר לברר דרכה מי רכש כרטיס או מי רשום. מייל יוצא רק לכתובת שהשרת אימת: זו שבהזמנה ששולמה ב-Wix
  // (נבדקת בשוויון מלא, ראו wixPaidOrders_) או זו ששמורה בחשבון (emailUser_) — מה שהוקלד בדף לא נשלח אליו קוד או פרטי חשבון בלי אחד משני אלה.
  // יוצא מן הכלל היחיד: הודעת "לא נמצא כרטיס" לכתובת שהוקלדה — טקסט קבוע לגמרי (שום קלט מהלקוח, בלי פרטי חשבון), רק אחרי ששאילתת Wix הצליחה, פעם ב-REG_NOTICKET_HOURS לכתובת ובתקציב משלה (REG_NOTICKET_*).
  // לכן כל השערים שמחזירים שגיאה עומדים *לפני* בדיקת הכרטיס ותלויים רק בכתובת שהוקלדה (מספר בקשות) ובמצב המערכת הכללי; מה שתלוי בכרטיס/חשבון (מכסת קודים לכתובת,
  // חותמת "כבר קיים חשבון", נעילת ניחושים, כשל שליחה) נדחה או נכשל *בשקט* — עם אותה תשובה { ok:true, sent:true } שמקבלת גם כתובת בלי כרטיס.
  //  1. מכסה לכתובת (REG_PER_EMAIL_HOUR) — נספרת בכל בקשה תקינה, גם בלי כרטיס (ספירה רק של מיילים שנשלחו הייתה מגלה בעלי כרטיס).
  //  2. מכסת המייל היומית של גוגל (עם רזרבה למשרד נוטאם) · 3. תקציב מיילי ההרשמה הכללי (נספר רק על מיילים שיצאו) · 4. שאילתות Wix (REG_WIX_PER_HOUR) — כולן כלליות.
  // בקשות זבל לכתובות שרירותיות אינן צורכות את תקציב המיילים, ולכן אינן חוסמות מטיס אמיתי; הן צורכות רק שאילתות Wix (מאות בשעה).
  regStart: function (r) {
    var email = normEmail_(r.email);
    if (!email) return { ok: false, error: 'bad_email' };
    var cache = CacheService.getScriptCache(), t0 = now_(), hk = Math.floor(t0 / 3600000), ek = 'regE:' + sha256Hex_(email).slice(0, 20) + ':' + hk, wk = 'regW:' + hk;
    var ne = Number(cache.get(ek)) || 0, nw = Number(cache.get(wk)) || 0;
    if (ne >= CFG.REG_PER_EMAIL_HOUR) return { ok: false, error: 'rate', message: 'יותר מדי ניסיונות לכתובת הזו — נסו שוב בעוד זמן מה (עד שעה)' };
    // מכסת המיילים היומית של גוגל, עם רזרבה לשליחה האמיתית למשרד נוטאם: תנאי כללי שנבדק בתחילה, זהה לכל כתובת
    if (!mailQuotaOk_(1, CFG.MAIL_QUOTA_RESERVE_REG)) return quotaErr_();
    if (regBudgetFull_(cache, hk) || nw >= CFG.REG_WIX_PER_HOUR) return regBusyErr_();
    cache.put(ek, String(ne + 1), 3600); cache.put(wk, String(nw + 1), 3600);
    var rk = regKey_(email), prevRaw = props_().getProperty(rk), prev = readReg_(rk), orders;
    try { orders = wixPaidOrders_(email); } catch (e) { return { ok: false, error: wixErr_(e) }; }
    // כשלונות קוד מצטברים לכתובת בין קודים (חלון CODE_FAIL_HOURS): אחרי CODE_FAIL_MAX כשלונות לא נוצר קוד ולא נשלח מייל, והתשובה זהה לכתובת בלי כרטיס.
    // הבדיקה אחרי שאילתת Wix (ולא לפניה) כדי שגם כשל Wix יהיה זהה לכל הכתובות, כולל נעולות
    if (regLocked_(prev)) return regOk_();
    // 'noticket' = שאילתת Wix הצליחה (כשל כבר חזר למעלה) ואין כרטיס זכאי ואין חשבון: הודעה מנומסת שמסבירה מה חסר (ראו noTicketMail_). כל ענף שלא נדחה בשקט שולח בדיוק מייל אחד
    var eu = emailUser_(email), fresh = eligibleOrders_(orders), mode = '';
    if (eu && eu.user) mode = fresh.length ? 'renew' : 'exists';
    else mode = fresh.length ? 'register' : 'noticket';
    var mk = mailRecKey_(email), mrec = readJsonProp_(mk), day = dayKey_(), codes = (mrec && mrec.d === day) ? Number(mrec.n) || 0 : 0, lastExists = Number(mrec && mrec.x) || 0;
    var msg, wroteReg = false, ntWrote = false, ntRaw = null;
    try {
      if (mode === 'noticket') {
        // תקציב משלה (REG_NOTICKET_*), לא מתקציב הקודים, ורזרבת עותקים כמו ב"כבר קיים חשבון": כתובות אקראיות לא מרוקנות לא את הקודים ולא את מכסת גוגל. חריגה = דילוג בשקט
        var ntLog = noTicketLog_(t0), ntH = sha256Hex_(email).slice(0, 10);
        if (!noTicketOk_(ntLog, ntH, t0) || !mailQuotaOk_(1, CFG.MAIL_QUOTA_RESERVE)) return regOk_();
        ntRaw = props_().getProperty(NOTICKET_PROP_);
        noTicketWrite_(ntLog, ntH, t0); ntWrote = true;       // נרשם לפני השליחה (נכשל סגור: אם הרישום נכשל לא שולחים) ומוחזר אם השליחה נכשלה — נספרים רק מיילים שיצאו
        msg = noTicketMail_(email);
      } else if (mode === 'exists') {
        // הודעת נימוס בלבד: פעם ב-REG_EXISTS_HOURS לכתובת (בלי להפריע לקודים), ומשאירה את הרזרבה של עותקים; אחרת מדלגים בשקט
        if (t0 - lastExists < CFG.REG_EXISTS_HOURS * 3600000 || !mailQuotaOk_(1, CFG.MAIL_QUOTA_RESERVE)) return regOk_();
        msg = { to: email, name: CFG.SENDER_NAME, replyTo: orgAddr_() || '', subject: 'כבר קיים חשבון לבקשות טיסה בכתובת הזו',
          body: 'שלום,\n\nכבר קיים חשבון בבקשות טיסה המשויך לכתובת הזו. שם המשתמש: ' + eu.name + (eu.user.until && Number(eu.user.until) >= t0 ? '\nהמנוי בתוך תוקף עד ' + fmtDate_(eu.user.until) + '.' : '') + '\n\nאם שכחת את הסיסמה — פנה לתמיכה' + (normEmail_(CFG.SUPPORT_EMAIL) ? ' (' + normEmail_(CFG.SUPPORT_EMAIL) + ')' : '') + ' ונאפס אותה.\nלחידוש מנוי: ' + CFG.RENEW_URL + '\n\nצוות הארגון הישראלי לרחפנים' };
      } else {
        if (codes >= CFG.REG_MAILS_PER_EMAIL_DAY) return regOk_();      // מכסת קודים יומית לכתובת: נדחה בשקט (אחרת התשובה הייתה מבדילה כתובת עם כרטיס)
        var code = ('000000' + (parseInt(randHex_(8), 16) % 1000000)).slice(-6), salt = randHex_(16);
        var carry = (prev && prev.fx > t0) ? { f: Number(prev.f) || 0, fx: prev.fx } : { f: 0, fx: 0 };   // מונה הכשלונות עובר לקוד החדש — לא מתאפס
        props_().setProperty(rk, JSON.stringify({ h: sha256Hex_(salt + ':' + code), s: salt, exp: t0 + CFG.CODE_TTL_MIN * 60000, tries: 0, f: carry.f, fx: carry.fx })); wroteReg = true;
        msg = { to: email, name: CFG.SENDER_NAME, replyTo: orgAddr_() || '', subject: (mode === 'renew' ? 'קוד לחידוש המנוי לבקשות טיסה' : 'קוד הרשמה לבקשות טיסה') + ': ' + code,
          body: 'שלום,\n\nהקוד שלך ' + (mode === 'renew' ? 'לחידוש המנוי' : 'להרשמה לבקשות טיסה') + ': ' + code + '\nהקוד תקף ל-' + CFG.CODE_TTL_MIN + ' דקות. אם לא ביקשת — אפשר להתעלם מהמייל.\n\nצוות הארגון הישראלי לרחפנים' };
      }
      MailApp.sendEmail(msg);
      wroteReg = false; ntWrote = false;
      if (mode === 'noticket') return regOk_();               // כבר נרשם בספר ההודעות; לא נספר בתקציב מיילי ההרשמה (קודים)
      // נספר רק אחרי שהמייל יצא
      regBudgetAdd_(cache, hk);
      props_().setProperty(mk, JSON.stringify({ d: day, n: mode === 'exists' ? codes : codes + 1, x: mode === 'exists' ? t0 : lastExists }));
    } catch (err) {
      // כשל שליחה (MailApp זרק, מכסה, כתיבה): לא מגלים אותו — אותה תשובה כמו לכתובת בלי כרטיס. הרשומה הקודמת חוזרת במקום להימחק (מוני הכשלונות וקוד קודם שעדיין תקף נשמרים)
      Logger.log('regStart: שליחת מייל נכשלה — ' + String(err && err.message || err));
      if (wroteReg) { try { if (prevRaw) props_().setProperty(rk, prevRaw); else props_().deleteProperty(rk); } catch (e2) { /* שמרני: ממשיכים */ } }
      if (ntWrote) { try { if (ntRaw) props_().setProperty(NOTICKET_PROP_, ntRaw); else props_().deleteProperty(NOTICKET_PROP_); } catch (e3) { /* שמרני: ממשיכים */ } }
    }
    return regOk_();
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
    var salt = randHex_(24), nu2 = { role: 'user', org: false, blocked: false, tv: t, salt: salt, hash: hashPass_(salt, pass), created: t, changed: t, source: 'ticket', email: email, displayName: fresh[0].name || '', until: until, orders: fresh.map(function (o) { return o.orderNumber; }), reminded: {}, lastLogin: t };
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
  // התיקייה נוצרת לפי סוג החשבון ברגע הפתיחה (kind נרשם ביומן): ארגוני ← "הארגון"; עצמאי ← "מטיסים/<שם המשתמש>" (ראו requestParent_). בקשה קיימת נשארת בתיקייה שלה.
  // התחלת שמירה מוחקת את קבצי הבקשה הקודמים בתיקייה ומאפסת את סימון ה"מוכנה"; רק saveEnd מסמן מוכנה.
  saveBegin: function (r) {
    var a = auth_(r.token); if (a.error) return { ok: false, error: a.error };
    var name = cleanFolderName_(r.folderName);
    if (!name) return { ok: false, error: 'bad_name' };
    var rid = String(r.rid || '');
    if (!/^[a-f0-9]{16,64}$/.test(rid)) return { ok: false, error: 'bad_rid' };
    var log = readLog_(), entry = findByRid_(log, rid), folder = null, t = now_(), unique, parentId;
    if (entry) {
      if (entry.user !== a.name && a.user.role !== 'admin') return { ok: false, error: 'forbidden' };
      if (liveSentAt_(entry)) return { ok: false, error: 'already_sent', sentAt: liveSentAt_(entry) };
      try { folder = DriveApp.getFolderById(entry.id); if (folder.isTrashed()) folder = null; } catch (err) { folder = null; }
    }
    if (!folder) {
      var cache = CacheService.getScriptCache(), nk = 'nf:' + sha256Hex_(a.name).slice(0, 16) + ':' + Math.floor(t / 3600000), made = Number(cache.get(nk)) || 0;
      if (made >= CFG.MAX_NEW_FOLDERS_PER_HOUR) return { ok: false, error: 'rate', message: 'יותר מדי בקשות חדשות בשעה האחרונה' };
      // תקרת בקשות פתוחות למשתמש (לא נשלחו חי, ונגעו בהן בחודש האחרון): מטיס אחד לא מנפח את היומן ואת הדרייב. רק בקשה חדשה נבדקת (שמירה חוזרת לא), ומנהל פטור.
      // בקשה שנשלחה חי, או שלא נגעו בה LOG_KEEP_DAYS ימים, אינה "פתוחה" — כך ששימוש רגיל לעולם לא נתקע בתקרה
      if (!entry && a.user.role !== 'admin' && openRequests_(log, a.name, t) >= CFG.MAX_OPEN_REQUESTS_PER_USER)
        return { ok: false, error: 'too_many_open', message: 'יש לכם יותר מדי בקשות שמורות שעדיין לא נשלחו (' + CFG.MAX_OPEN_REQUESTS_PER_USER + ') — שלחו או המתינו, ואם נדרש פנו לתמיכה' };
      cache.put(nk, String(made + 1), 3600);
      // סוג התיקייה לפי הבקשה (אם כבר ביומן: תיקייה שנמחקה נוצרת מחדש אצל בעליה, גם כשמנהל הוא שמשחזר), ואחרת לפי המשתמש שפותח. התיקיות העוטפות נוצרות רק כאן — אחרי כל הבדיקות
      var kind = entry ? kindOf_(entry) : (isOrg_(a.user) ? 'org' : 'pilot'), parent = requestParent_(kind, entry ? entry.user : a.name, log);
      parentId = parent.getId();
      unique = uniqueName_(log, name, rid, parentId);
      folder = parent.createFolder(unique);
      if (!entry) { entry = { id: folder.getId(), rid: rid, name: unique, user: a.name, kind: kind, created: t, sent: [] }; log.push(entry); }
    } else {
      parentId = entry.parent || CFG.ROOT_FOLDER_ID;
      unique = uniqueName_(log, name, rid, parentId);
      if (folder.getName() !== unique) folder.setName(unique);
      var old = folder.getFiles();
      while (old.hasNext()) { var of = old.next(); if (REQ_FILE_RE_.test(of.getName())) of.setTrashed(true); }   // אין שאריות מגרסה קודמת (שם אחר) שיצורפו בטעות
    }
    entry.id = folder.getId(); entry.name = unique; entry.base = name; entry.parent = parentId; entry.saved = t; entry.lastUser = a.name; entry.ready = false; entry.readyAt = 0;
    writeLog_(log, entry.id);
    // השם בדרייב ייחודי בתוך תיקיית האב, אבל מטיס רגיל מקבל בחזרה שם שחושב מהבקשות שלו בלבד — סיומת "(2)" שנגרמה מבקשה של מישהו אחר (למשל בעל קודם של אותו שם משתמש, שנמחק
    // והתיקייה האישית שלו נשארה) הייתה מגלה לו שקיימת בקשה כזו. קישור התיקייה בדרייב מוחזר למנהל בלבד: למטיס אין גישה אליה
    var out = { ok: true, folderId: folder.getId(), name: a.user.role === 'admin' ? unique : uniqueName_(log, name, rid, parentId, a.name) };
    if (a.user.role === 'admin') out.url = folder.getUrl();
    return out;
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
    if (c.tooMany) return { ok: false, error: 'folder_full', message: folderFullMsg_() };      // תיקייה מנופחת (לא נוצרה דרך saveFile): לא מסמנים מוכנה
    e.ready = !!r.ready && c.hasDocx && c.hasImage; e.readyAt = e.ready ? now_() : 0;
    writeLog_(log, e.id);
    return { ok: true, ready: e.ready };
  },

  // שמירת קובץ בתיקיית בקשה. רק סוגי הקבצים של בקשה (Word, KML, תמונות, JSON), ותקרות: קבצים ונפח לתיקייה (folder_full), ונפח העלאה לשעה וליום לכל משתמש (rate, kind:'upload').
  // חריגה מחזירה שגיאה ברורה ואינה מוחקת דבר ממה שכבר נשמר (גם לא מבטלת "מוכנה"). הסוגים המותרים סוגרים גם זיוף/דריסה של סימון "נשלח — ....txt" שהשרת כותב בתיקייה.
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
    var fname = cleanFileName_(r.name);
    if (!REQ_FILE_RE_.test(fname)) return { ok: false, error: 'bad_file', message: 'סוג קובץ לא נתמך (נשמרים רק Word, KML, תמונות ו-JSON של הבקשה)' };
    var size = Math.floor(b64.length * 3 / 4), use = folderUsage_(folder, fname);      // use: הקבצים שכבר בתיקייה, בלי הקובץ שיוחלף באותו שם
    if (use.count >= CFG.MAX_FOLDER_FILES || use.bytes + size > CFG.MAX_FOLDER_BYTES) return { ok: false, error: 'folder_full', message: folderFullMsg_() };
    var up = a.user.role === 'admin' ? null : uploadUsed_(a.name);
    if (up && (up.h + size > CFG.MAX_UPLOAD_BYTES_PER_HOUR || up.d + size > CFG.MAX_UPLOAD_BYTES_PER_DAY))
      return { ok: false, error: 'rate', scope: 'user', kind: 'upload', message: 'הגעתם למגבלת נפח ההעלאה ה' + (up.h + size > CFG.MAX_UPLOAD_BYTES_PER_HOUR ? 'שעתית (' + Math.round(CFG.MAX_UPLOAD_BYTES_PER_HOUR / 1048576) + 'MB בשעה)' : 'יומית (' + Math.round(CFG.MAX_UPLOAD_BYTES_PER_DAY / 1048576) + 'MB ביום)') + ' — נסו שוב מאוחר יותר' };
    if (e.ready) { e.ready = false; e.readyAt = 0; writeLog_(log, e.id); }
    var old = folder.getFilesByName(fname);
    while (old.hasNext()) old.next().setTrashed(true);           // גרסה חדשה מחליפה ישנה באותו שם
    var blob = Utilities.newBlob(Utilities.base64Decode(b64), String(r.mime || 'application/octet-stream'), fname);
    var file = folder.createFile(blob);
    if (up) uploadAdd_(up, size);
    return { ok: true, id: file.getId(), url: file.getUrl() };
  },

  // שליחת הבקשה במייל. target: 'office' (ברירת מחדל; כמו בשרת הישן) = "שלח למשרד", 'self' = "שלח רק לעצמי"; כל ערך אחר => bad_target.
  // הנמענים נקבעים בשרת בלבד (ראו mailPlan_ — לפי סוג החשבון, המצב והיעד): משרד נוטאם = CFG.MAIL_TO הקבוע (רק במצב חי + office), המבקש = כתובת המשתמש המחובר
  // השמורה אצלו (או כתובת הארגון, למשתמש בלי כתובת), וכתובת הארגון מקבלת עותק. שום שדה בבקשה לא קובע נמען. שם השולח (name) נקבע ב-senderName_: ארגוני — שם הארגון;
  // עצמאי — fromName מהבקשה (הגורם שהמטיס הצהיר עליו) אחרי ניקוי ועם סיומת קבועה. fromName אינו משפיע על שום דבר חוץ משם השולח, ואינו נקרא מחשבון ארגוני.
  // תנאים שנאכפים כאן ולא רק בדפדפן: הבקשה ביומן ונשמרה כ"מוכנה" (saveEnd), רק בעליה או מנהל שולחים אותה,
  // ב-office הלקוח חייב לציין באיזה מצב (test/live) הוצג למשתמש — אם המצב השתנה השרת לא שולח (mode_changed),
  // ושליחה חוזרת למשרד של בקשה שכבר נשלחה "חי" דורשת again:true במפורש. שליחה לעצמו אינה נחשבת "נשלחה למשרד נוטאם":
  // היא לא נועלת את הבקשה, לא חוסמת שליחה אמיתית ולא נבדקת מול expectMode — אבל נספרת בהגבלת הקצב וב"נשלח — ....txt".
  sendRequest: function (r) {
    var a = auth_(r.token); if (a.error) return { ok: false, error: a.error };
    var target = r.target === undefined ? 'office' : r.target;      // חסר => office (לקוח ישן); null/ריק/מחרוזת אחרת => נדחה
    if (target !== 'office' && target !== 'self') return { ok: false, error: 'bad_target' };
    var mode = mailMode_(), toOffice = target === 'office', org = isOrg_(a.user);
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
    // חשבון ארגוני פטור מהתקרה הכוללת בלבד (לא מהאישית): מטיסים שמילאו את הדלי הכללי לא מרעיבים את הארגון. השליחה עדיין נספרת בסך הכול
    if (sendsUser >= lim.u) return rateErr_('user', kind);
    if (!org && sendsAll >= lim.a) return rateErr_('all', kind);
    if (tries >= CFG.MAX_SEND_ATTEMPTS_PER_HOUR) return rateErr_('user', 't');

    var c = folderFiles_(folder);
    if (c.tooMany) return { ok: false, error: 'folder_full', message: folderFullMsg_() };
    if (!c.hasDocx || !c.hasImage) return { ok: false, error: 'missing_files', message: 'חסר קובץ Word או תמונת מפה/תצ"א בתיקייה' };   // א-11 נספח ג': חובה לצרף מפה/תצ"א
    if (c.total > CFG.MAX_MAIL_BYTES) return { ok: false, error: 'too_big' };

    // המבקש = כתובת המשתמש המחובר (שמורה ומאומתת); בלי כתובת — כתובת הארגון. כתובת הארגון חייבת להיות ידועה: היא מקבלת עותק מכל שליחה של מטיס
    // וכתובת ה"השב ל" של חשבון ארגוני (נכשל סגור)
    var orgA = orgAddr_(), stored = requesterEmail_(a.user);
    if (!orgA) return { ok: false, error: 'no_owner' };
    var plan = mailPlan_(org, mode, target, stored, orgA), to = plan.to, sender = senderName_(a.user, r.fromName);
    // מכסת המיילים היומית של גוגל נספרת לפי נמענים (to+cc+bcc): בודקים מראש, כדי שהכשל יהיה ברור, לא יירשם "failed" ביומן ולא יצרוך קצב.
    // עותקים משאירים רזרבה (MAIL_QUOTA_RESERVE) לשליחה האמיתית למשרד ולקודי ההרשמה — מלבד חשבון ארגוני, שפטור מהרזרבה (הרזרבה נועדה לשמור מכסה *לארגון* מפני מטיסים).
    var need = plan.to.length + plan.cc.length + plan.bcc.length;
    if (!mailQuotaOk_(need, (kind === 'o' || org) ? 0 : CFG.MAIL_QUOTA_RESERVE)) return quotaErr_();
    var prefix = !toOffice ? '[עותק לעצמי — לא נשלח למשרד נוטאם] ' : mode === 'live' ? '' : '[בדיקה — לא נשלח למשרד נוטאם] ';
    // ביומן: שליחה לעצמו נרשמת כ-mode:'self' (ראו sendKind_) — לעולם לא כ"נשלחה חי"
    var sid = randHex_(12), t = logSentBegin_(a.name, folder.getId(), folder.getName(), toOffice ? mode : 'self', target, to, sid, sender);   // נרשם לפני היציאה: אם משהו קורס אחרי השליחה, אין מייל כפול
    cache.put(allKey, String(sendsAll + 1), 3600); cache.put(userKey, String(sendsUser + 1), 3600); cache.put(tryKey, String(tries + 1), 3600);
    try {
      var opts = { to: to.join(','), replyTo: plan.replyTo, name: sender, subject: prefix + subject, body: body, htmlBody: htmlBody_(body), attachments: c.blobs };   // body = גיבוי טקסטואלי, htmlBody = המייל שנראה (RTL, תבליטים)
      if (plan.cc.length) opts.cc = plan.cc.join(',');
      if (plan.bcc.length) opts.bcc = plan.bcc.join(',');
      MailApp.sendEmail(opts);
    } catch (err) {
      rateRefund_(cache, allKey); rateRefund_(cache, userKey);      // המייל לא יצא — לא צורכים מכסת שליחות (קריסה באמצע נשארת צרוכה: שמרני)
      try { logSentEnd_(folder.getId(), sid, 'failed'); } catch (e2) { /* הרשומה נשארת "בשליחה" — שמרני */ }
      throw err;
    }
    try { logSentEnd_(folder.getId(), sid, 'sent'); } catch (e3) { /* המייל כבר יצא; הרשומה נשארת "בשליחה" וממשיכה לחסום כפילות */ }
    // כתובת הארגון לא נחשפת למטיס עצמאי (בתשובה ובסימון): היא מוסתרת ממנו, אלא אם זו כתובתו השמורה. חשבון ארגוני רואה הכול
    var show = function (list) { return org ? list : list.filter(function (x) { x = String(x).toLowerCase(); return x !== orgA || x === stored; }); };
    var shownTo = show(to), shownCc = show(plan.cc);
    try {   // סימון בתוך תיקיית הבקשה, כדי שגם מי שפותח את התיקייה בדרייב יראה שנשלחה
      var kindName = !toOffice ? 'עותק לעצמו — לא נשלח למשרד נוטאם' : mode === 'live' ? 'חי — למשרד נוטאם' : 'בדיקה — למבקש בלבד, לא נשלח למשרד נוטאם';
      folder.createFile('נשלח — ' + Utilities.formatDate(new Date(t), 'Asia/Jerusalem', 'yyyy-MM-dd HH-mm') + (!toOffice ? ' (לעצמו)' : mode === 'live' ? '' : ' (בדיקה)') + '.txt',
        ['נשלח ע"י: ' + a.name, 'סוג חשבון: ' + (org ? 'ארגוני' : 'עצמאי'), 'שם השולח: ' + sender, 'יעד: ' + (toOffice ? 'משרד' : 'לעצמו'), 'מצב: ' + kindName,
          'אל: ' + (shownTo.length ? shownTo.join(', ') : '—'), 'עותק: ' + (shownCc.length ? shownCc.join(', ') : '—'), 'עותק סמוי לארגון: ' + (plan.bcc.length ? 'כן' : 'לא'),
          'נושא: ' + prefix + subject, 'קבצים: ' + c.names.join(' | ')].join('\n'), 'text/plain');
    } catch (e4) { /* הסימון אינו חיוני */ }
    // כתובת הארגון לא מוחזרת ללקוח אלא לחשבון ארגוני (to/cc של מטיס מכילים רק את כתובת המבקש וכתובות משרד נוטאם; ה-BCC לא מוחזר). adminCopy = כתובת הארגון בין הנמענים (בכל תפקיד)
    return { ok: true, mode: mode, target: target, to: shownTo, cc: shownCc, adminCopy: [].concat(plan.to, plan.cc, plan.bcc).some(function (x) { return String(x).toLowerCase() === orgA; }), from: sender, files: c.names, sentAt: t };
  },

  // ----- שלב ב׳: "הבקשות שלי" ובדיקה חוזרת. רק מוסיפות פעולות: שמירה ושליחה (saveBegin / saveFile / saveEnd / sendRequest) לא נוגעות בשום שדה או קובץ שהפעולות האלה כותבות -----

  // "הבקשות שלי": הבקשות של המשתמש המחובר (e.user === שמו; לא lastUser: מנהל ששמר בשם מטיס לא "גונב" לו שורה), מהחדשה לישנה, עד MAX_MYREQ_ROWS (למנהל MAX_MYREQ_ROWS_ADMIN).
  // נבנית מהיומן בלבד — אין קריאת דרייב לשורה (נעילת הסקריפט כללית). כל משתמש מחובר (לא חסום) רשאי, גם מטיס עצמאי; רק מנהל רשאי להעביר all:true (כל הבקשות) או user (בקשות משתמש אחר).
  // רשומה של משתמש שנמחק נושאת שם מוחלף (ראו deleteUser) ולכן לא מופיעה אצל מי שנרשם אחריו בשם הזה. קישור לתיקיית הדרייב (folderUrl) ושם הבעלים (user) — למנהל בלבד.
  myRequests: function (r) {
    var a = auth_(r.token); if (a.error) return { ok: false, error: a.error };
    var admin = a.user.role === 'admin', wantAll = r.all === true, hasUser = r.user !== undefined && r.user !== null && r.user !== '';
    if ((wantAll || hasUser) && !admin) return { ok: false, error: 'forbidden' };
    if (hasUser && typeof r.user !== 'string') return { ok: false, error: 'bad_user' };
    if (readRateHit_('myreq', a.name, CFG.MAX_MYREQ_PER_HOUR)) return readRateErr_();
    var who = hasUser ? r.user : a.name, cap = admin ? CFG.MAX_MYREQ_ROWS_ADMIN : CFG.MAX_MYREQ_ROWS;
    var mine = readLog_().filter(function (e) { return e && typeof e === 'object' && (wantAll || e.user === who); })
      .sort(function (x, y) { return (Number(y.saved) || 0) - (Number(x.saved) || 0) || (Number(y.created) || 0) - (Number(x.created) || 0); });
    return { ok: true, requests: mine.slice(0, cap).map(function (e) { return myReqRow_(e, admin); }), total: mine.length };
  },

  // בקשה אחת במלואה (נתוני הבקשה ששמר הדפדפן, JSON) — לטעינת בקשה לבדיקה חוזרת. בעלים או מנהל. התיקייה חייבת להיות תיקיית בקשה תקפה ורשומה ביומן ולא בפח; הקובץ נבחר בשרת
  // (קובץ אחד ששמו מסתיים ב-" — נתוני הבקשה.json", בסריקה חסומה של MAX_RECORD_SCAN_FILES קבצים), נקרא רק אם גודלו עד MAX_RECORD_BYTES, ומוחזר רק אם הוא JSON תקין מסוג אובייקט.
  // תוכן הקובץ מגיע מהדפדפן ואינו אמין — השרת מחזיר אותו כמות שהוא והלקוח מאמת אותו לפני שימוש.
  getRequest: function (r) {
    var a = auth_(r.token); if (a.error) return { ok: false, error: a.error };
    var admin = a.user.role === 'admin';
    if (typeof r.folderId !== 'string' || !r.folderId) return { ok: false, error: 'bad_folder' };
    if (!admin && readRateHit_('rrec', a.name, CFG.MAX_RECORD_READS_PER_HOUR)) return readRateErr_();
    var folder = requestFolder_(r.folderId);
    if (!folder || folder.isTrashed()) return { ok: false, error: 'bad_folder' };
    var log = readLog_(), e = findById_(log, folder.getId());
    if (!e) return { ok: false, error: 'bad_folder' };
    if (e.user !== a.name && !admin) return { ok: false, error: 'forbidden' };
    var f = recordFile_(folder);
    if (!f) return { ok: false, error: 'no_record', message: 'לא נמצא קובץ נתוני הבקשה בתיקיית הבקשה' };
    if (f.getSize() > CFG.MAX_RECORD_BYTES) return { ok: false, error: 'too_big', message: 'קובץ נתוני הבקשה גדול מדי' };
    var rec = null;
    try {
      var txt = String(f.getBlob().getDataAsString('UTF-8'));
      rec = JSON.parse(txt.charCodeAt(0) === 0xfeff ? txt.slice(1) : txt);      // BOM בתחילת הקובץ נסבל (editor/כלי חיצוני)
      JSON.stringify(rec);      // קינון עמוק מאוד (שהפענוח עוד עובר) היה מפיל את בניית התשובה; רשומה אמיתית רדודה — כאן הוא נדחה כפגום
    } catch (err) { rec = null; }
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return { ok: false, error: 'bad_record', message: 'קובץ נתוני הבקשה פגום' };
    return { ok: true, meta: myReqRow_(e, admin), rec: rec };
  },

  // שמירת דוח "בדיקה חוזרת" (Word) לבקשה שכבר נשלחה (חי או בדיקה). בעלים או מנהל, ורק מי שיש לו תצוגה מתקדמת (advOf_; אחרת recheck_off).
  // הדוח נכתב בתת-התיקייה RECHECK_FOLDER_NAME של תיקיית הבקשה — לא בתיקייה עצמה: folderFiles_ מצרף למייל כל Word שבה, ו-MAX_FOLDER_FILES / MAX_FOLDER_BYTES נספרים עליה; תת-תיקייה אינה נראית להם,
  // ואינה נמחקת בניקוי של saveBegin. שם הקובץ נבנה בשרת בלבד (בלי שום שם מהלקוח). בתיקיית הבקשה נכתב סימון .txt ("לא צורף לבקשה שנשלחה ב-...") — גם הוא לא מצורף ולא נספר.
  // הפעולה לא נוגעת ב-ready, ב-sent[] ובקבצי הבקשה, ולכן אינה פותחת את הבקשה לעריכה ואינה משנה מה שיצורף בשליחה הבאה. הבקשה נשארת נעולה לשמירה (saveFile) אם נשלחה חי.
  // sum = ספירות הממצאים {a: חדשים, r: הוסרו, c: שונו} — מספרים שלמים בלבד (כל ערך אחר הופך ל-0); נרשמות ביומן ב-rc כ-[זמן, a, r, c].
  saveRecheck: function (r) {
    var a = auth_(r.token); if (a.error) return { ok: false, error: a.error };
    if (!advOf_(a.user)) return { ok: false, error: 'recheck_off', message: 'בדיקה חוזרת זמינה רק בתצוגה מתקדמת — פנו לבעל המערכת' };
    var b64 = r.b64;
    if (typeof b64 !== 'string' || !b64 || b64.length > CFG.MAX_RECHECK_B64 || b64.indexOf('UEsD') !== 0 || !/^[A-Za-z0-9+\/]+={0,2}$/.test(b64))
      return { ok: false, error: 'bad_file', message: 'הקובץ אינו דוח Word תקין' };
    var admin = a.user.role === 'admin';
    if (typeof r.folderId !== 'string' || !r.folderId) return { ok: false, error: 'bad_folder' };
    if (!admin && readRateHit_('rsave', a.name, CFG.MAX_RECHECK_SAVES_PER_HOUR)) return readRateErr_();
    var folder = requestFolder_(r.folderId);
    if (!folder || folder.isTrashed()) return { ok: false, error: 'bad_folder' };
    var log = readLog_(), e = findById_(log, folder.getId());
    if (!e) return { ok: false, error: 'bad_folder' };
    if (e.user !== a.name && !admin) return { ok: false, error: 'forbidden' };
    var sent = sentSummary_(e), rc = Array.isArray(e.rc) ? e.rc : [];
    if (!(sent.live || sent.test)) return { ok: false, error: 'not_sent', message: 'בדיקה חוזרת נשמרת רק לבקשה שנשלחה' };
    if (rc.length >= CFG.MAX_RECHECKS_PER_REQUEST) return { ok: false, error: 'recheck_limit', message: 'הגעתם למספר הבדיקות המרבי לבקשה זו — פנו לתמיכה' };
    var size = Math.floor(b64.length * 3 / 4), skip = folderIdSet_(log), subName = cleanFolderName_(CFG.RECHECK_FOLDER_NAME) || 'בדיקות חוזרות';
    var sub = findFolder_(folder, subName, skip);
    if (sub) { var use = subUsage_(sub); if (use.full || use.bytes + size > CFG.MAX_RECHECK_FOLDER_BYTES) return { ok: false, error: 'recheck_full', message: 'תיקיית הבדיקות החוזרות מלאה — פנו לתמיכה' }; }
    var up = admin ? null : uploadUsed_(a.name);
    if (up && (up.h + size > CFG.MAX_UPLOAD_BYTES_PER_HOUR || up.d + size > CFG.MAX_UPLOAD_BYTES_PER_DAY))
      return { ok: false, error: 'rate', scope: 'user', kind: 'upload', message: 'הגעתם למגבלת נפח ההעלאה ה' + (up.h + size > CFG.MAX_UPLOAD_BYTES_PER_HOUR ? 'שעתית (' + Math.round(CFG.MAX_UPLOAD_BYTES_PER_HOUR / 1048576) + 'MB בשעה)' : 'יומית (' + Math.round(CFG.MAX_UPLOAD_BYTES_PER_DAY / 1048576) + 'MB ביום)') + ' — נסו שוב מאוחר יותר' };
    var sm = r.sum && typeof r.sum === 'object' ? r.sum : {}, cnt = [cleanCount_(sm.a), cleanCount_(sm.r), cleanCount_(sm.c)];
    var t = now_(), stem = recheckStem_(t, sub, folder), name = stem + '.docx';
    sub = sub || childFolder_(folder, subName, skip);
    var file = sub.createFile(Utilities.newBlob(Utilities.base64Decode(b64), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', name));
    if (up) uploadAdd_(up, size);
    rc = rc.slice(-(CFG.MAX_RECHECKS_PER_REQUEST - 1)); rc.push([t, cnt[0], cnt[1], cnt[2]]); e.rc = rc;
    try { writeLog_(log, e.id); } catch (err) { try { file.setTrashed(true); } catch (e1) { /* מיטב המאמץ */ } throw err; }      // הרישום נכשל: לא משאירים דוח יתום שאינו נספר
    try {   // סימון בתיקיית הבקשה, כדי שגם מי שפותח את התיקייה בדרייב יראה שנעשתה בדיקה חוזרת ושהיא לא חלק ממה שנשלח
      folder.createFile(stem + '.txt', ['בדיקה חוזרת — דוח נפרד, לא חלק מהבקשה שנשלחה', 'נשמרה ע"י: ' + a.name, 'מתי: ' + Utilities.formatDate(new Date(t), 'Asia/Jerusalem', 'dd.MM.yyyy HH:mm'),
        'ממצאים: חדשים ' + cnt[0] + ' · הוסרו ' + cnt[1] + ' · שונו ' + cnt[2],
        'דוח זה לא צורף לבקשה שנשלחה ב-' + (sent.at ? fmtDate_(sent.at) : '—'), 'סוג השליחה: ' + (sent.mode === 'live' ? 'חי — למודיעין טיס' : 'בדיקה — למבקש בלבד, לא נשלח למודיעין טיס'),
        'קובץ הדוח: ' + subName + '/' + name].join('\n'), 'text/plain');
    } catch (e2) { /* הסימון אינו חיוני */ }
    var out = { ok: true, name: name, rechecks: rc.length };
    if (admin) out.url = file.getUrl();
    return out;
  }
};

/* ---------- שלב ב׳: "הבקשות שלי" ובדיקה חוזרת — עזרים ---------- */
// סיכום השליחות של בקשה ליומן: live / test = כמה שליחות שלא נכשלו (sentOk_) בכל סוג, ו-at / mode = המועד והמצב של השליחה האחרונה — חיה אם יש כזו, אחרת בדיקה (0 / '' כשאין).
// "לעצמו" (sendKind_ === 'self') אינה שליחה למשרד ואינה נספרת בשום שדה. אותו סיווג כמו liveSentAt_: שליחה שלא ידוע אם הסתיימה ('sending') נחשבת שליחה (שמרני)
function sentSummary_(e) {
  var out = { live: 0, test: 0, at: 0, mode: '' }, lastLive = 0, lastTest = 0;
  ((e && e.sent) || []).forEach(function (s) {
    if (!s || !sentOk_(s)) return;
    var k = sendKind_(s), t = Number(s.t) || 0;
    if (k === 'live') { out.live++; if (t > lastLive) lastLive = t; } else if (k === 'test') { out.test++; if (t > lastTest) lastTest = t; }
  });
  if (out.live) { out.at = lastLive; out.mode = 'live'; } else if (out.test) { out.at = lastTest; out.mode = 'test'; }
  return out;
}
// שורה ל"הבקשות שלי" (גם meta של getRequest). state: draft = לא נשלחה למשרד (גם לא בבדיקה), sent_test = נשלחה רק במצב בדיקה, sent_live = נשלחה חי.
// folderUrl ו-user — למנהל בלבד (למטיס אין גישה לדרייב, ושם בעלים אחר לא רלוונטי לו)
function myReqRow_(e, admin) {
  var s = sentSummary_(e), row = { id: e.id, name: e.name, kind: kindOf_(e), created: Number(e.created) || 0, saved: Number(e.saved) || 0, ready: !!e.ready,
    state: s.live ? 'sent_live' : s.test ? 'sent_test' : 'draft', sentAt: s.at, sentMode: s.mode, sentLive: s.live, sentTest: s.test, rechecks: Array.isArray(e.rc) ? e.rc.length : 0 };
  if (admin) { row.folderUrl = 'https://drive.google.com/drive/folders/' + e.id; row.user = e.user; }
  return row;
}
// הגבלת קצב שעתית לקריאות (מונה ב-CacheService לכל משתמש): true = עברו את התקרה (לא נספר), אחרת הקריאה נספרת
function readRateHit_(kind, name, limit) {
  var cache = CacheService.getScriptCache(), k = kind + ':' + sha256Hex_(name).slice(0, 16) + ':' + Math.floor(now_() / 3600000), n = Number(cache.get(k)) || 0;
  if (n >= limit) return true;
  cache.put(k, String(n + 1), 3600);
  return false;
}
function readRateErr_() { return { ok: false, error: 'rate', scope: 'user', kind: 'read', message: 'יותר מדי פעולות בשעה האחרונה — נסו שוב בעוד זמן מה' }; }
// מספר שלם 0..99999 (ספירת ממצאים מהלקוח); כל ערך אחר (טקסט, שלילי, NaN, אובייקט) הופך ל-0
function cleanCount_(v) { return (typeof v === 'number' && v >= 0) ? Math.min(Math.floor(v), 99999) : 0; }
var RECORD_SUFFIX_ = ' — נתוני הבקשה.json';   // כמו שהדף כותב אותו: "<מקום> — <תאריך> — נתוני הבקשה.json" (מקף ארוך)
// קובץ נתוני הבקשה בתיקייה: בדיוק אחד ששמו מסתיים ב-RECORD_SUFFIX_, בין MAX_RECORD_SCAN_FILES הקבצים הראשונים (ילדים ישירים בלבד). אין / כמה כאלה = null
function recordFile_(folder) {
  var it = folder.getFiles(), seen = 0, hits = [], sl = RECORD_SUFFIX_.length;
  while (it.hasNext() && seen < CFG.MAX_RECORD_SCAN_FILES && hits.length < 2) {
    var f = it.next(), n = String(f.getName()); seen++;
    if (n.length >= sl && n.slice(-sl) === RECORD_SUFFIX_) hits.push(f);
  }
  return hits.length === 1 ? hits[0] : null;
}
// תת-תיקייה בשם נתון *בלי ליצור אותה*: הראשונה שאינה בפח ואינה תיקיית בקשה מהיומן (כמו childFolder_), או null
function findFolder_(parent, name, skip) {
  var it = parent.getFoldersByName(name);
  while (it.hasNext()) { var f = it.next(); if (!skip[f.getId()] && !f.isTrashed()) return f; }
  return null;
}
// נפח הדוחות בתת-התיקייה. הסריקה חסומה (פי 3 מתקרת הדוחות לבקשה): תת-תיקייה מנופחת (למשל קבצים שנוספו ידנית) מסומנת full ואינה נסרקת עד הסוף
function subUsage_(sub) {
  var out = { count: 0, bytes: 0, full: false }, it = sub.getFiles(), cap = CFG.MAX_RECHECKS_PER_REQUEST * 3;
  while (it.hasNext()) {
    if (out.count >= cap) { out.full = true; break; }
    out.count++; out.bytes += it.next().getSize();
  }
  return out;
}
// שם הדוח (ללא סיומת): "בדיקה חוזרת — yyyy-MM-dd HH-mm" בשעון ישראל, ו-" (2)", " (3)"… כשכבר קיים דוח (בתת-התיקייה) או סימון (בתיקיית הבקשה) בשם הזה. sub יכול להיות null (עוד לא נוצרה)
function recheckStem_(t, sub, folder) {
  var base = 'בדיקה חוזרת — ' + Utilities.formatDate(new Date(t), 'Asia/Jerusalem', 'yyyy-MM-dd HH-mm'), stem = base, n = 1;
  while (n < 50 && ((sub && sub.getFilesByName(stem + '.docx').hasNext()) || folder.getFilesByName(stem + '.txt').hasNext())) stem = base + ' (' + (++n) + ')';
  return stem;
}

// קבצי הבקשה בתיקייה (Word, KML, תמונות) — לא יומן, לא JSON ולא סימוני שליחה.
// תיקייה עם יותר מ-MAX_FOLDER_FILES קבצים (לא נוצרה דרך saveFile, שאוכף תקרה) מסומנת tooMany ותכניה לא נקראים: קריאת מאות קבצים תחת נעילת הסקריפט הייתה מחזיקה את כל המטיסים ב"השרת עסוק"
function folderFiles_(folder) {
  var out = { blobs: [], names: [], total: 0, hasDocx: false, hasImage: false, tooMany: false }, it = folder.getFiles(), picked = [];
  while (it.hasNext()) {
    var f = it.next(), n = f.getName();
    if (!/\.(docx|kml|png|jpe?g)$/i.test(n)) continue;
    if (picked.length >= CFG.MAX_FOLDER_FILES) { out.tooMany = true; return out; }
    picked.push(f);
    out.total += f.getSize();
    if (/\.docx$/i.test(n)) out.hasDocx = true;
    if (/\.(png|jpe?g)$/i.test(n)) out.hasImage = true;
    out.names.push(n);
  }
  picked.forEach(function (f) { out.blobs.push(f.getBlob()); });
  return out;
}
// הסוגים היחידים ש-saveFile כותב ושהניקוי ב-saveBegin מכיר (Word, KML, תמונות, JSON של הבקשה). סימוני "נשלח — ....txt" ויומן אינם ביניהם
var REQ_FILE_RE_ = /\.(docx|kml|png|jpe?g|json)$/i;
function folderFullMsg_() { return 'בתיקיית הבקשה יותר מדי קבצים (עד ' + CFG.MAX_FOLDER_FILES + ') או נפח גדול מדי (עד ' + Math.round(CFG.MAX_FOLDER_BYTES / 1048576) + 'MB) — שמרו את הבקשה מחדש'; }
// כמה קבצי בקשה (REQ_FILE_RE_) וכמה בייטים כבר בתיקייה, בלי קובץ בשם exceptName (הוא יוחלף). עוצר כשהגיע לתקרת הקבצים — תיקייה מנופחת לא נסרקת עד הסוף
function folderUsage_(folder, exceptName) {
  var out = { count: 0, bytes: 0 }, it = folder.getFiles();
  while (it.hasNext() && out.count < CFG.MAX_FOLDER_FILES) {
    var f = it.next(), n = f.getName();
    if (n === exceptName || !REQ_FILE_RE_.test(n)) continue;
    out.count++; out.bytes += f.getSize();
  }
  return out;
}
// נפח העלאה של משתמש: שעתי (CacheService) ויומי (Script Properties, כי המטמון מוגבל ל-6 שעות). נמדדים בייטים שנכתבו (לא מה שנשמר): setTrashed לא מפנה מקום בדרייב
function uploadUsed_(name) {
  var uh = sha256Hex_(name).slice(0, 16), cache = CacheService.getScriptCache(), hk = 'up:' + uh + ':' + Math.floor(now_() / 3600000), bk = 'B:' + uh, day = dayKey_(), d = readJsonProp_(bk);
  return { hk: hk, bk: bk, day: day, h: Number(cache.get(hk)) || 0, d: (d && d.d === day) ? Number(d.b) || 0 : 0 };
}
function uploadAdd_(u, bytes) {
  CacheService.getScriptCache().put(u.hk, String(u.h + bytes), 3600);
  props_().setProperty(u.bk, JSON.stringify({ d: u.day, b: u.d + bytes }));
}
// בקשות "פתוחות" של משתמש: לא נשלחו חי ונגעו בהן בתוך LOG_KEEP_DAYS הימים האחרונים
function openRequests_(log, user, t) {
  var cutoff = t - CFG.LOG_KEEP_DAYS * 86400000, n = 0;
  log.forEach(function (e) { if (e.user === user && !liveSentAt_(e) && lastTouch_(e) >= cutoff) n++; });
  return n;
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
// תיקיית בקשה תקפה = תיקייה בעומק 1-3 מתחת לתיקייה הראשית ורק כזו: עומק 1 = תיקיות ישנות (נוצרו לפני ההפרדה לפי סוג; ללא סוג — נחשבות ארגוניות),
// עומק 2 = "הארגון/<בקשה>", עומק 3 = "מטיסים/<משתמש>/<בקשה>". התיקייה הראשית עצמה, תיקייה עמוקה יותר ותיקייה מחוץ לעץ — נדחות.
// שמות התיקיות העוטפות אינם נבדקים (שינוי שם ידני בדרייב לא שובר בקשות קיימות); הפעולות שמשתמשות בה דורשות בנוסף רשומה ביומן, שאותה יוצרת רק saveBegin
function requestFolder_(id) {
  var folder;
  try { folder = DriveApp.getFolderById(String(id)); } catch (err) { return null; }
  var depth = 0, cur = folder;
  while (cur && depth <= 3) {
    if (cur.getId() === CFG.ROOT_FOLDER_ID) return depth >= 1 ? folder : null;
    var ps = cur.getParents();
    cur = ps.hasNext() ? ps.next() : null;
    depth++;
  }
  return null;
}
// ----- תיקיות הדרייב של הבקשות לפי סוג -----
function folderIdSet_(log) { var o = {}; log.forEach(function (e) { o[e.id] = true; }); return o; }
// תת-תיקייה בשם נתון: הראשונה שאינה בפח ואינה תיקיית בקשה מהיומן (בקשה ישנה ששמה במקרה "הארגון"/"מטיסים" אינה תיקייה עוטפת); אחרת נוצרת.
// אידמפוטנטית: קריאה שנייה מוצאת את התיקייה ואינה יוצרת כפילות. קריאות מקבילות מסודרות בנעילת הסקריפט של doPost
function childFolder_(parent, name, skip) {
  var it = parent.getFoldersByName(name);
  while (it.hasNext()) { var f = it.next(); if (!skip[f.getId()] && !f.isTrashed()) return f; }
  return parent.createFolder(name);
}
// שם התיקייה האישית של מטיס = שם המשתמש, מנוקה. שם שהניקוי שינה (למשל רווחים כפולים, או שם מוחלף של משתמש שנמחק) מקבל סיומת גיבוב, כדי ששני משתמשים לא יתכנסו לאותה תיקייה
function pilotFolderName_(user) {
  var raw = String(user || ''), c = cleanFolderName_(raw);
  return (c && c === raw) ? c : ((c || 'user') + ' ~' + sha256Hex_(raw).slice(0, 6)).slice(0, 120);
}
// תיקיית האב של בקשה חדשה: ארגוני — "הארגון" תחת התיקייה הראשית; עצמאי — "מטיסים/<משתמש>". נוצרת לפי דרישה
function requestParent_(kind, owner, log) {
  var skip = folderIdSet_(log), root = DriveApp.getFolderById(CFG.ROOT_FOLDER_ID);
  if (kind !== 'pilot') return childFolder_(root, cleanFolderName_(CFG.ORG_FOLDER_NAME) || 'הארגון', skip);
  return childFolder_(childFolder_(root, cleanFolderName_(CFG.PILOTS_FOLDER_NAME) || 'מטיסים', skip), pilotFolderName_(owner), skip);
}
