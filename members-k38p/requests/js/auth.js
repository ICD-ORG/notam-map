/* התחברות נפרדת לבקשות טיסה: שם משתמש וסיסמה מול שרת Apps Script (apps-script/Code.gs).
   האכיפה בשרת: חסימת משתמש, החלפת סיסמה ופקיעת אסימון נבדקות בכל קריאה, ושמירה לדרייב אפשרית רק עם אסימון תקף.
   מסך הכניסה כאן הוא ממשק בלבד — הוא מסתיר את הטופס, אך את הדף עצמו לא ניתן "לנעול" באתר סטטי. */
(function () {
  "use strict";
  const KEY = "icdReqSession";
  const A = { cfg: null, requireMember: undefined, token: "", user: "", role: "", exp: 0, mode: "login", mailMode: "test", mailTo: [], email: "", copyTo: "", copyToIsOwner: false, features: [], org: false, orgKnown: false, adv: false, advKnown: false, busy: false, until: null };
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const ERR = {
    bad_login: "שם משתמש או סיסמה שגויים.", locked: "יותר מדי ניסיונות כושלים — נסו שוב בעוד כרבע שעה.", blocked: "המשתמש חסום מבקשות טיסה. פנו לתמיכה.",
    expired: "פג תוקף ההתחברות — יש להתחבר מחדש.", auth: "ההתחברות אינה תקפה — יש להתחבר מחדש.", weak_pass: "הסיסמה קצרה מדי (לפחות 10 תווים).",
    bad_user: "שם משתמש לא תקין (3–40 תווים: אותיות, ספרות, נקודה, מקף).", exists: "המשתמש כבר קיים.", no_user: "המשתמש לא נמצא.", self: "לא ניתן לבצע פעולה זו על המשתמש שלך.",
    forbidden: "הפעולה מותרת למנהל בלבד.", bad_code: "הקוד שגוי או שפג תוקפו.", no_setup: "המערכת אינה במצב הקמה.", busy: "השרת עסוק, נסו שוב.", bad_folder: "התיקייה בדרייב אינה תקפה.",
    bad_file: "הקובץ גדול מדי או ריק.", already_sent: "הבקשה כבר נשלחה.", missing_files: "חסר קובץ Word או תמונת מפה/תצ״א בתיקייה — יש לשמור שוב בדרייב.", rate: "יותר מדי שליחות בשעה האחרונה — נסו שוב מאוחר יותר.", mail_quota: "מכסת המיילים היומית של המערכת הסתיימה — נסו שוב מחר, או פנו לתמיכה.", bad_mail: "נושא או גוף המייל ריקים.", no_owner: "לא ניתן לזהות את כתובת הארגון או את כתובת הבעלים של המערכת (נדרשת לכל שליחה, כי כתובת הארגון מקבלת עותק).", too_big: "הקבצים גדולים מדי לשליחה במייל (מעל 24MB).", sub_expired: "המנוי הסתיים. לחידוש יש לרכוש כרטיס חדש ואז ללחוץ כאן על ״הרשמה / חידוש מנוי״.", bad_email: "כתובת המייל אינה תקינה.", no_ticket: "לא נמצא כרטיס ששולם עבור הכתובת הזו (או שכבר נוצל).", need_credentials: "יש לבחור שם משתמש וסיסמה.",
    ticket_expired: "הכרטיס ישן מדי (מעבר לתקופת המנוי) — יש לרכוש כרטיס חדש.", not_configured: "ההרשמה עדיין לא הופעלה במערכת. יש לפנות למשרד הארגון.", wix_down: "לא ניתן לאמת כרגע את הכרטיס מול האתר — נסו שוב בעוד כמה דקות.", bad_date: "תאריך לא תקין (YYYY-MM-DD).", bad_name: "שם התיקייה אינו תקין.", bad_rid: "מזהה הבקשה אינו תקין — רעננו את הדף.", not_ready: "הבקשה לא נשמרה בשרת כמוכנה לשליחה — יש להשלים את הבדיקות ולשמור שוב בדרייב.", mode_changed: "מצב השליחה בשרת השתנה.", server: "שגיאת שרת.", bad_request: "בקשה לא תקינה.", bad_org: "סוג החשבון אינו תקין.", is_admin: "חשבון מנהל הוא תמיד חשבון ארגוני — לא ניתן לשנות את הסוג שלו.", bad_adv: "ערך התצוגה המתקדמת אינו תקין.", is_admin_adv: "חשבון מנהל תמיד רואה את התצוגה המתקדמת — לא ניתן לשנות אותה.", bad_action: "פעולה לא מוכרת."
  };
  // הודעות שמפנות לפעולה של מנהל (שמירה בדרייב, README, שרת) מוצגות רק למנהל; למטיס רגיל — ניסוח ניטרלי שמפנה לתמיכה
  const ERR_PILOT = {
    forbidden: "אין לך הרשאה לפעולה הזו.",
    not_ready: "לא ניתן היה להכין את הבקשה לשליחה — נסו לשלוח שוב; אם הבעיה חוזרת, פנו לתמיכה.",
    missing_files: "לא ניתן היה להכין את הבקשה לשליחה — נסו לשלוח שוב; אם הבעיה חוזרת, פנו לתמיכה.",
    no_owner: "השליחה אינה זמינה כרגע — פנו לתמיכה."
  };
  // תקרת השליחות מחזירה scope: "user" = המגבלה האישית של המשתמש, "all" = מגבלה כללית של המערכת (המטיס צריך להבין שהמערכת עמוסה ולא הוא חרג). עם scope מוכר מציגים את הודעת השרת (היא מפרטת מה הוגבל: משרד נוטאם / עותקים / ניסיונות); בלעדיה — נוסח קבוע לפי ה-scope
  const SCOPE_ALL = /^(all|global|system|total|overall|shared)$/i, SCOPE_USER = /^(user|self|personal|requester|me)$/i;
  // כתובת התמיכה (config.json → support_email): מוצגת בכל הודעה שמפנה את המטיס ל"תמיכה" / "מנהל המערכת" / "משרד הארגון", ובמסכי הכניסה וההרשמה. נתון ציבורי של ההגדרות; מוצג רק אם היא כתובת מייל תקינה (נכשל סגור: בלי כתובת תקינה — ההודעות נשארות כפי שהן).
  // הערך נכנס ל-HTML רק דרך esc ובקישור mailto: שמותר לו רק תווי כתובת בטוחים (אין בו רווח, מירכאות או סוגריים)
  const SUPPORT_RE = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63}){1,5}$/;
  const supportEmail = () => { const e = A.cfg && typeof A.cfg.support_email === "string" ? A.cfg.support_email.trim() : ""; return SUPPORT_RE.test(e) ? e : ""; };
  const REFER_RE = /(פנו לתמיכה|פנו למנהל המערכת|לפנות למנהל המערכת|פנו למשרד הארגון|לפנות למשרד הארגון)/;
  const withSupport = t => { const e = supportEmail(), s = String(t == null ? "" : t); return (!e || s.indexOf(e) >= 0) ? s : s.replace(REFER_RE, "$1: " + e); };
  // שורת עזרה קבועה במסכי הכניסה / ההרשמה / שרת לא מוגדר (HTML בטוח); בלי כתובת תקינה — ריקה
  const supportLine = () => { const e = supportEmail(); return e ? '<p class="small" id="auSupport">תמיכה: <a href="mailto:' + esc(e) + '" dir="ltr">' + esc(e) + '</a></p>' : ""; };
  const rawMsg = r => {
    if (!r) return "שגיאה לא ידועה";
    if (r.error === "rate") {
      const sc = String(r.scope == null ? "" : r.scope), all = SCOPE_ALL.test(sc);
      if ((all || SCOPE_USER.test(sc)) && typeof r.message === "string" && r.message) return r.message;
      if (all) return "המערכת עמוסה כרגע — המגבלה אינה אישית ואינה קשורה אליכם; נסו שוב מאוחר יותר.";
      return (!sc && r.message) ? String(r.message) : ERR.rate;   // בלי scope (שרת ישן): הודעת השרת אם יש
    }
    if (r.error === "mail_quota" && A.role === "admin" && r.message) return String(r.message);
    if (A.role !== "admin" && ERR_PILOT[r.error]) return ERR_PILOT[r.error];
    return ERR[r.error] || r.message || r.error || "שגיאה לא ידועה";
  };
  const msg = r => withSupport(rawMsg(r));
  // מצב השליחה והנמענים מתשובת השרת (login / regFinish / me / changePassword). full: מאפס קודם — תשובה בלי features היא שרת ישן, ולכן "שלח רק לעצמי" מושבת והלקוח לא שולח target.
  // email = כתובת המבקש השמורה ("" אם אין); copyTo = לאן יישלחו עותקים (email, ובלי כתובת — כתובת הבעלים); copyToIsOwner = copyTo היא כתובת הבעלים כי אין למשתמש כתובת
  // org (boolean) = סוג החשבון מהשרת (ארגוני / מטיס עצמאי); orgKnown = השרת דיווח org. שרת ישן לא מדווח — A.isOrg() נגזר אז מהתפקיד (מנהל = ארגוני)
  // adv (boolean) = התצוגה המתקדמת בפועל של המשתמש (הכרעת המנהל, ובלעדיה ברירת המחדל לפי הסוג); advKnown = השרת דיווח adv. שרת ישן לא מדווח — A.isAdv() נגזר אז מהתפקיד והסוג
  function applyMail(r, full) {
    if (full) { A.mailMode = "test"; A.mailTo = []; A.email = ""; A.copyTo = ""; A.copyToIsOwner = false; A.features = []; A.org = false; A.orgKnown = false; A.adv = false; A.advKnown = false; }
    if (r.org === true || r.org === false) { A.org = r.org; A.orgKnown = true; }
    if (r.adv === true || r.adv === false) { A.adv = r.adv; A.advKnown = true; }
    if (r.mailMode) A.mailMode = r.mailMode === "live" ? "live" : "test";
    if (Array.isArray(r.mailTo)) A.mailTo = r.mailTo;
    if (typeof r.email === "string") A.email = r.email;
    if (typeof r.copyTo === "string") A.copyTo = r.copyTo;
    if (r.copyToIsOwner === true || r.copyToIsOwner === false) A.copyToIsOwner = r.copyToIsOwner;
    if (Array.isArray(r.features)) A.features = r.features.filter(x => typeof x === "string");
  }

  /* ---------- הסברים ללחצני "!" (js/help.js): כל טקסט מתאר את מה שהפעולה עושה בפועל בקוד (Code.gs ובקובץ הזה) ---------- */
  const HELP = {
    myreq: "פותח רשימה של הבקשות ששמרתם או שלחתם מהחשבון הזה, מהחדשה לישנה, ולכל בקשה את מצבה: נשלחה למשרד נוטאם, נשלחה לבדיקה בלבד, או נשמרה ולא נשלחה. מכל בקשה אפשר לראות סיכום לקריאה בלבד, או להשתמש בה כבסיס לבקשה חדשה — הנתונים נטענים לטופס, והבדיקות והאישור של ההצהרה נעשים מחדש. הפעולה לא שולחת ולא משנה בקשה שמורה.",
    pass: "פותח חלון להחלפת הסיסמה שלך: מקלידים את הסיסמה הנוכחית ואת החדשה פעמיים (לפחות 10 תווים). אחרי ההחלפה כל ההתחברויות האחרות של המשתמש שלך מתבטלות, וההתחברות הנוכחית נשארת.",
    admin: "פותח את חלון ניהול המשתמשים (למנהל בלבד): סיכום הבקשות לפי סוג (הארגון / מטיסים), מצב השליחה, רשימת המשתמשים וסוג החשבון של כל אחד (ארגוני / עצמאי), התצוגה המתקדמת שלו והפעולות עליהם, יומן הבקשות עם סינון לפי סוג, הוספת משתמש, איפוס סיסמה ובדיקת כרטיס.",
    out: "מוחק את ההתחברות השמורה בחלון הדפדפן הזה, מנקה מהדף את הבקשה, הדוח והפרטים שעל המסך (הדף נטען מחדש) ומחזיר למסך הכניסה. פרטי המבקש, אנשי הקשר וכלי הטיס ששמרתם בדפדפן נשארים שמורים לכניסה הבאה שלכם; אין בכך מחיקה של קבצים שכבר נשמרו או נשלחו.",
    mode: "מחליף את מצב השליחה של כל המערכת. במצב בדיקה (ברירת המחדל) כפתור ״שלח״ בדף הבקשה שולח את המייל רק לכתובת שנרשמה בחשבון המבקש (בחשבון ארגוני בלי כתובת — לכתובת הארגון), ולא למשרד נוטאם. במצב חי המבקש בוחר בין שליחה למשרד נוטאם (notamoffice@iaa.gov.il, nofm@iaa.gov.il) לבין שליחה רק לעצמו. חשבון ארגוני שולח בשם הארגון: שם השולח ״הארגון הישראלי לרב להב״, עותק לארגון, והתשובות חוזרות אל הארגון. חשבון עצמאי (מטיס) שולח בשם הגורם שהצהיר עליו (בתוספת ״— דרך מערכת בקשות הטיסה״): העותק והתשובות חוזרים אל המטיס, והארגון מקבל עותק סמוי לצורכי תמיכה בלבד. המעבר למצב חי מבקש אישור, והשינוי חל מיד על כל המשתמשים.",
    block: "חסום מבקשות: המשתמש לא יוכל להתחבר כלל, ולכן גם לא לשמור בדרייב או לשלוח. כל ההתחברויות הפעילות שלו מתבטלות מיד, וניסיון כניסה חדש (גם עם סיסמה נכונה) נדחה עד שתלחצו ״פתח מחדש את הבקשות״. הנתונים שלו והקבצים שכבר שמר אינם נמחקים. אי אפשר לחסום את עצמך.",
    unblock: "פתח מחדש את הבקשות: מסיר את החסימה, והמשתמש יוכל להתחבר שוב עם הסיסמה שלו. ההתחברויות הקודמות שלו נשארות מבוטלות, ולכן עליו להתחבר מחדש. הפעולה אינה משנה את תוקף המנוי (מי שהמנוי שלו הסתיים עדיין לא יוכל להתחבר) ואינה מוחקת דבר. חשבון שנחסם אוטומטית בגלל הזמנה שבוטלה עלול להיחסם שוב בבדיקה היומית כל עוד ההזמנה מבוטלת.",
    rst: "איפוס סיסמה (בשורת המשתמש): ממלא את שם המשתמש בטופס ״איפוס סיסמה״ שבתחתית החלון ומעביר אליו את הסמן. הסיסמה עצמה נקבעת שם, בלחיצה על ״אפס״.",
    exp: "שינוי תוקף: שואל תאריך סיום מנוי (YYYY-MM-DD) למשתמש; תאריך ריק = ללא הגבלה. אחרי התאריך המשתמש לא יוכל להיכנס עד חידוש המנוי. השינוי גם מאפס את תזכורות סיום המנוי שנשלחו.",
    del: "מוחק את המשתמש לצמיתות, אחרי אישור. כרטיסי הרכישה ששויכו אליו ומייל ההרשמה שלו משתחררים, וניתן להירשם איתם מחדש. קבצי הבקשות שלו בדרייב וביומן הבקשות אינם נמחקים. אי אפשר למחוק את עצמך.",
    add: "מוסיף משתמש חדש עם שם משתמש וסיסמה זמנית (לפחות 10 תווים). ״מנהל״ מוסיף גם הרשאת ניהול (ומנהל הוא תמיד חשבון ארגוני). ״חשבון ארגוני״ (מסומן כברירת מחדל) קובע את סוג החשבון — בלי הסימון המשתמש הוא מטיס עצמאי. למשתמש שנוסף כך אין תאריך סיום מנוי עד שתקבעו אחד ב״שינוי תוקף״.",
    addOrg: "סוג החשבון של המשתמש החדש. חשבון ארגוני (מסומן כברירת מחדל): נשלח בשם הארגון, התשובות והעותק חוזרים אל הארגון, ברירות המחדל של הארגון (גורם מבקש, אות קריאה ורישום) נטענות בטופס, והבקשות נשמרות בתיקיית ״הארגון״ בדרייב. בלי הסימון — מטיס עצמאי: נשלח בשם הגורם שהמטיס מצהיר עליו, התשובות והעותק חוזרים אליו, הארגון מקבל עותק סמוי לצורכי תמיכה בלבד, אין ברירות מחדל של הארגון, והבקשות נשמרות בתיקיית ״מטיסים״ תחת שם המשתמש. אפשר להחליף את הסוג אחר כך בטבלת המשתמשים.",
    type: "סוג החשבון קובע איך הבקשות של המשתמש נשלחות ואיפה הן נשמרות. ארגוני: שם השולח ״הארגון הישראלי לרב להב״, העותק והתשובות חוזרים אל הארגון, ברירות המחדל של הארגון נטענות בטופס (למי שאין לו ערך שמור), והבקשות נשמרות בתיקיית ״הארגון״ בדרייב. עצמאי: שם השולח הוא הגורם שהמטיס מצהיר עליו (בתוספת ״— דרך מערכת בקשות הטיסה״), העותק והתשובות חוזרים אל המטיס, הארגון מקבל עותק סמוי לצורכי תמיכה בלבד, אין ברירות מחדל של הארגון, והבקשות נשמרות בתיקיית ״מטיסים״ תחת שם המשתמש. ההחלפה חלה על בקשות חדשות בלבד — בקשות שכבר נשמרו נשארות בתיקייה שלהן. לא ניתן לשנות מנהל (מנהל הוא תמיד ארגוני).",
    adv: "תצוגה מתקדמת מציגה למשתמש את הכלים הפנימיים של המערכת: מגבלות המקורות, הבדיקה העצמית של המערכת וסעיף ההגשה המלא בדף הבדיקות ובקובץ ה-Word. בלעדיה המשתמש אינו רואה את מגבלות המקורות ואת הבדיקה העצמית (שממשיכה לרוץ ברקע ולחסום שליחה כשהיא נכשלת), ובמקום סעיף ההגשה המלא מופיע סיכום קצר. ברירת המחדל: חשבון ארגוני — כן, מטיס עצמאי — לא; ההחלפה כאן קובעת למשתמש הזה ערך משלו, גם למטיס שנרשם בעצמו. המשתמש רואה את השינוי בכניסה הבאה או ברענון מול השרת, ואינו מתנתק. חשבון מנהל תמיד רואה את התצוגה המתקדמת ואי אפשר לשנות זאת.",
    prev: "מציג למנהל את דף הבקשות כפי שנרשם רגיל רואה אותו: בלי תצוגה מתקדמת, בלי הכלים הפנימיים ובלי הפירוט הטכני (שמות מקורות, שרתים). זו תצוגה בלבד — הבדיקות, השמירה והשליחה ממשיכות לפעול בחשבון המנהל כרגיל. לחיצה נוספת מחזירה לתצוגת מנהל; גם טעינה מחדש של הדף או התנתקות מחזירות אותה.",
    reset: "קובע למשתמש הנבחר סיסמה חדשה (לפחות 10 תווים). כל ההתחברויות הקיימות שלו מתבטלות, והוא צריך להיכנס מחדש עם הסיסמה החדשה.",
    wix: "בודק מול אתר הארגון (Wix) אילו הזמנות ששולמו קיימות לכתובת המייל שהוקלדה, ולכל הזמנה אם היא כבר נוצלה להרשמה ועל ידי מי, ואם היא זכאית להרשמה. פעולת אבחון בלבד — אינה משנה דבר."
  };
  // לחצן ״!״ מוכן; אם help.js לא נטען — כלום (הממשק ממשיך לעבוד). name = שם קצר סטטי לקורא מסך (aria-label="הסבר על: <שם>"); נקבע בכל אתר קריאה ולא נקרא מתווית הכפתור, שעשויה להשתנות (#admMode)
  const hb = (t, name) => (window.ReqHelp ? window.ReqHelp.btn(t, name) : "");
  const withHelp = (html, t, name) => '<span class="hw">' + html + hb(t, name) + "</span>";

  function save() { try { sessionStorage.setItem(KEY, JSON.stringify({ token: A.token, user: A.user, role: A.role, exp: A.exp })); } catch (e) { /* ignore */ } }
  let preview = false;   // תצוגת ״נרשם רגיל״ למנהל (בזיכרון בלבד: טעינה מחדש והתנתקות מבטלות אותה) — משנה רק מה שמוצג, לא את החשבון בשרת
  function clear() { A.token = ""; A.user = ""; A.role = ""; A.exp = 0; A.email = ""; A.copyTo = ""; A.copyToIsOwner = false; A.features = []; A.org = false; A.orgKnown = false; A.adv = false; A.advKnown = false; preview = false; try { sessionStorage.removeItem(KEY); } catch (e) { /* ignore */ } }
  function restore() { try { const s = JSON.parse(sessionStorage.getItem(KEY) || "null"); if (s && s.token && s.exp > Date.now()) { A.token = s.token; A.user = s.user; A.role = s.role; A.exp = s.exp; return true; } } catch (e) { /* ignore */ } return false; }

  async function post(body) {
    const r = await fetch(A.cfg.api_url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body), redirect: "follow" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }
  // קריאה מאומתת: אסימון נשלח אוטומטית; אסימון פסול/פג/חסום מחזיר למסך הכניסה
  async function call(action, payload) {
    const res = await post(Object.assign({ action, token: A.token }, payload || {}));
    if (!res.ok && (res.error === "auth" || res.error === "expired" || res.error === "blocked" || res.error === "sub_expired")) logout(msg(res));
    return res;
  }
  // התנתקות (יזומה, פקיעת אסימון, חסימה או שגיאת auth) = איפוס מיידי ומלא: מנקים את הסשן, נועלים את הדף באמת (inert, לא רק CSS), ומודיעים ל-ui.js (req-logout) שמוחק את כל מצב הבקשה והדף וטוען את הדף מחדש.
  // ההודעה (למשל "פג תוקף ההתחברות") נשמרת ב-sessionStorage ומוצגת בכיסוי של הדף הנקי. אם איש לא טיפל באירוע (ui.js לא נטען) — מציגים את הכיסוי כאן. הטעינה מחדש היא הדרך הבטוחה: לא נשאר דבר מהמשתמש הקודם, גם לא במקלדת, בשחזור היסטוריה או בכלי מפתחים נקי
  function logout(note) {
    const n = typeof note === "string" ? note : "";
    clear(); closeModal(); renderBar(); setLocked(true);
    stashNote(n);
    if (document.dispatchEvent(new CustomEvent("req-logout", { cancelable: true, detail: { note: n } }))) showCover(n);
  }
  const NOTE_KEY = "icdReqNote";
  function stashNote(n) { try { if (n) sessionStorage.setItem(NOTE_KEY, String(n).slice(0, 400)); else sessionStorage.removeItem(NOTE_KEY); } catch (e) { /* ignore */ } }
  function takeNote() { try { const n = sessionStorage.getItem(NOTE_KEY) || ""; sessionStorage.removeItem(NOTE_KEY); return n; } catch (e) { return ""; } }
  // נעילת הדף: מחלקת authLocked (טשטוש ו-pointer-events ב-CSS) וגם inert + aria-hidden על הכותרת והטופס — כך Tab, Shift+Tab, Enter וקורא מסך לא מגיעים אליהם מאחורי הכיסוי (הכיסוי הוא אח של header ו-main ב-body ונשאר פעיל)
  function setLocked(on) {
    document.body.classList.toggle("authLocked", !!on);
    ["header", "main"].forEach(t => { const e = document.querySelector(t); if (!e) return; if (on) { e.setAttribute("inert", ""); e.setAttribute("aria-hidden", "true"); } else { e.removeAttribute("inert"); e.removeAttribute("aria-hidden"); } });
  }

  /* ---------- מסך כניסה ---------- */
  // הכיסוי (position:fixed, מעל הכותרת) מסתיר את "← חזרה למפה" שבכותרת, ובאפליקציה מותקנת (standalone) אין כפתור חזרה של הדפדפן — לכן קישור משלו בתוך כל גרסה של הכיסוי (כניסה, הרשמה, שרת לא מוגדר). הכיסוי מרוחק מהאזורים הבטוחים (padding ב-index.html); גובה 44px ב-.backMap
  const BACK_MAP = '<a class="backMap" href="../" id="auMap">← חזרה למפה</a>';
  function cover() {
    let c = $("authCover");
    if (!c) { c = document.createElement("div"); c.id = "authCover"; c.setAttribute("role", "dialog"); c.dir = "rtl"; document.body.appendChild(c); }
    return c;
  }
  function hideCover() { const c = $("authCover"); if (c) c.remove(); setLocked(false); }
  async function showCover(note) {
    setLocked(true);
    const c = cover();
    if (!A.cfg || !A.cfg.api_url) {
      c.innerHTML = '<div class="authBox"><h2>בקשות טיסה</h2><p class="err">שרת ההתחברות עדיין לא הוגדר, ולכן אי אפשר להשתמש בדף כרגע. נסו שוב מאוחר יותר, ואם זה נמשך פנו לתמיכה.</p>' + supportLine() + BACK_MAP + '</div>';
      return;
    }
    let boot = false;
    try { const r = await fetch(A.cfg.api_url, { redirect: "follow" }); const j = await r.json(); boot = !!j.needsBootstrap; if (typeof j.requireMember === "boolean") A.requireMember = j.requireMember; } catch (e) { note = note || "אין חיבור לשרת ההתחברות. בדקו את האינטרנט ונסו שוב."; }
    c.innerHTML = '<form class="authBox" id="authForm" autocomplete="on"><h2>בקשות טיסה — כניסה</h2>' + (boot ? "" : buyBox()) +
      (boot ? '<p class="small">הקמה ראשונה: הקלידו את קוד ההקמה שהוצג בהרצת <code>initialize()</code> ובחרו שם משתמש וסיסמה למנהל.</p><label class="f"><b>קוד הקמה</b><input id="auCode" type="text" autocomplete="off" dir="ltr"></label>' : '') +
      '<label class="f"><b>שם משתמש</b><input id="auUser" type="text" autocomplete="username" dir="ltr"></label>' +
      '<label class="f"><b>סיסמה' + (boot ? ' (לפחות 10 תווים)' : '') + '</b><input id="auPass" type="password" autocomplete="' + (boot ? "new-password" : "current-password") + '" dir="ltr"></label>' +
      '<div class="err" id="auErr">' + esc(note || "") + '</div><button class="primary" id="auGo" type="submit">' + (boot ? "הקם מנהל והיכנס" : "כניסה") + '</button>' +
      (boot ? "" : '<button type="button" class="linkBtn" id="auReg">מטיס מסחרי? הרשמה / חידוש מנוי</button>') + supportLine() + BACK_MAP + '</form>';
    if ($("auReg")) $("auReg").onclick = () => showRegister();
    $("authForm").onsubmit = async ev => {
      ev.preventDefault();
      const btn = $("auGo"); btn.disabled = true; $("auErr").textContent = "";
      try {
        const body = boot ? { action: "bootstrap", code: $("auCode").value.trim(), user: $("auUser").value.trim(), pass: $("auPass").value } : { action: "login", user: $("auUser").value.trim(), pass: $("auPass").value };
        const r = await post(body);
        if (!r.ok) { if (r.error === "sub_expired") expiredNote(r); else $("auErr").textContent = msg(r); btn.disabled = false; return; }
        A.token = r.token; A.user = r.user; A.role = r.role; A.exp = r.exp; A.until = r.until || null; applyMail(r, true); save();
        hideCover(); renderBar();
        document.dispatchEvent(new CustomEvent("req-auth", { detail: { user: A.user, role: A.role } }));
      } catch (e) { $("auErr").textContent = "אין חיבור לשרת ההתחברות. נסו שוב."; btn.disabled = false; }
    };
    const u = $("auUser"); if (u) u.focus({ preventScroll: true });   // בלי גלילה: בטלפון ב-landscape תיבת ההסבר גבוהה, והפוקוס היה מגלגל את החלון ומסתיר את הכותרת
  }

  // דרישת החברות (REQUIRE_MEMBER בשרת): הטקסט על חברות מוצג אלא אם השרת מדווח במפורש שהדרישה כבויה (requireMember === false בתשובת ה-GET הציבורית — שרת שאינו מדווח: מניחים שהדרישה פעילה). זה מידע כללי של המערכת, זהה לכל כתובת
  const memberRule = () => A.requireMember !== false;
  const fmtD = t => t ? new Date(t).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" }) : "";
  // כתובת רכישת הכרטיס (config.json → renew_url): נכנסת ל-href רק אחרי אימות — https בלבד, בלי רווחים / מירכאות / סוגריים משולשים, בלי שם משתמש וסיסמה בכתובת. כתובת שאינה עומדת בכך (חסרה, http, javascript:...) = אין קישור (נכשל סגור); שרת / הגדרות ישנים בלי renew_url — פשוט בלי כפתור
  const httpsUrl = s => {
    if (typeof s !== "string") return "";
    const t = s.trim();
    if (!/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?(?:[\/?#][^\s"'<>\\`]*)?$/i.test(t)) return "";   // שרת ASCII בלבד (בלי @ ובלי רווח לפני הנתיב), ואחריו נתיב / שאילתה / עוגן בלי תווים מסוכנים
    try { const u = new URL(t); return u.protocol === "https:" && u.hostname && !u.username && !u.password ? u.href : ""; } catch (e) { return ""; }
  };
  const renewUrl = () => httpsUrl(A.cfg && A.cfg.renew_url);
  const renewLink = () => renewUrl() ? ' <a href="' + esc(renewUrl()) + '" target="_blank" rel="noopener">לרכישת כרטיס</a>' : "";
  /* ---------- הסבר מראש על הכרטיס (נוסח מאושר בעל המערכת — לא לשנות): בראש מסך הכניסה ומסך ההרשמה, ואחרי ״שלחו לי קוד״ ---------- */
  const NOTICE = "שימו לב: מנוי או הרשמה למפת הנוט״מים אינם כוללים בקשות טיסה. בקשות טיסה מיועדות למטיסים מסחריים בלבד, ודורשות רכישה נפרדת של הכרטיס ״בקשת אישורי טיסה״.";
  const BENEFIT = "הצטרפות למערכת בקשות הטיסה מאפשרת להכין ולהגיש בקשות לסגירה אווירית בקלות ובמהירות, עם פחות בירוקרטיה. המערכת בודקת מראש אזורי איסור, נוטמים ומכשולים באזור, ובכך מסייעת למנוע תאונות שנובעות מחוסר ידיעה.";
  const BUY_LABEL = "לרכישת הכרטיס והצטרפות";
  const NO_CODE = "לא הגיע קוד? כנראה שלא נרכש הכרטיס ״בקשת אישורי טיסה״. מנוי למפת הנוט״מים בלבד אינו מקנה גישה לבקשות טיסה.";
  // כפתור הרכישה: קישור אמיתי (לא button) שנפתח בלשונית חדשה; בלי כתובת תקינה — ריק
  const buyBtn = id => { const h = renewUrl(); return h ? '<a class="buyBtn" id="' + id + '" href="' + esc(h) + '" target="_blank" rel="noopener noreferrer">' + esc(BUY_LABEL) + "</a>" : ""; };
  const buyBox = () => '<div class="buyBox" id="buyBox" role="note"><p class="buyNote">' + esc(NOTICE) + '</p><p class="buyWhy">' + esc(BENEFIT) + "</p>" + buyBtn("buyBtn") + "</div>";
  // ההודעה אחרי ״שלחו לי קוד״: אותה הודעה בדיוק לכל כתובת (גם כשאין כרטיס, גם כשהכתובת רשומה, גם כשהכרטיס נרכש כאורח): אסור שהודעה כלשהי תגלה מי רכש כרטיס או מי רשום. לכן היא נגזרת רק מהגדרות המערכת (דרישת החברות), ולא מתשובת השרת
  const regSentMessage = () => withSupport("אם נמצא כרטיס ששולם עבור הכתובת הזו — נשלח אליה קוד (תקף ל-15 דקות). לא הגיע? בדקו בספאם; ודאו שהכרטיס שולם, שהמייל שהקלדתם הוא מייל הרכישה" + (memberRule() ? ", ושהכרטיס נרכש כשאתם מחוברים כחברים רשומים באתר" : "") + ". " + NO_CODE + " אם הבעיה נמשכת — פנו לתמיכה.");
  function expiredNote(r) {
    $("auErr").innerHTML = esc("המנוי הסתיים" + (r && r.until ? " ב-" + fmtD(r.until) : "") + ". לחידוש: רוכשים כרטיס חדש, ואז לוחצים על ״הרשמה / חידוש מנוי״ ומקלידים את המייל שבו קנו.") + renewLink();
  }
  /* ---------- הרשמה וחידוש מנוי: רק למי שרכש כרטיס "בקשת אישורי טיסה" ששולם. שלבים: מייל -> קוד למייל -> שם משתמש וסיסמה ---------- */
  function showRegister(email) {
    setLocked(true);
    const c = cover();
    c.innerHTML = '<form class="authBox" id="regForm" autocomplete="on"><h2>הרשמה / חידוש מנוי</h2>' + buyBox() +
      '<p class="small">לבקשות טיסה נכנסים מטיסים מסחריים (מפעילים אוויריים) שרכשו באתר הארגון את הכרטיס ״בקשת אישורי טיסה״.' + renewLink() + '<br>הקלידו את המייל שבו רכשתם את הכרטיס — נשלח אליו קוד אימות. אחרי האימות בוחרים שם משתמש וסיסמה משלכם.</p>' +
      (memberRule() ? '<p class="small" id="rgMember"><b>האירוע לחברי האתר בלבד:</b> הכרטיס מזכה בהרשמה רק אם נרכש כשאתם מחוברים כחברים רשומים באתר הארגון. כרטיס שנרכש כאורח, בלי חשבון חבר, אינו מאפשר הרשמה — הירשמו כחברים באתר, התחברו אליו, ורק אז רכשו את הכרטיס.</p>' : "") +
      '<label class="f"><b>מייל הרכישה</b><input id="rgEmail" type="email" autocomplete="email" dir="ltr" value="' + esc(email || "") + '"></label>' +
      '<button type="button" id="rgSend">שלחו לי קוד</button><div class="small" id="rgInfo" role="status"></div>' +
      '<div id="rgStep2" style="display:none"><label class="f"><b>קוד מהמייל (6 ספרות)</b><input id="rgCode" inputmode="numeric" autocomplete="one-time-code" dir="ltr" maxlength="8"></label>' +
      '<label class="f"><b>שם משתמש</b><input id="rgUser" type="text" autocomplete="username" dir="ltr"></label>' +
      '<label class="f"><b>סיסמה (לפחות 10 תווים)</b><input id="rgPass" type="password" autocomplete="new-password" dir="ltr"></label>' +
      '<p class="small">אם כבר נרשמתם בעבר ואתם רק מחדשים מנוי — השאירו שם משתמש וסיסמה ריקים.</p>' +
      '<button class="primary" id="rgGo" type="submit">אישור</button></div>' +
      '<div class="err" id="rgErr"></div><button type="button" class="linkBtn" id="rgBack">חזרה לכניסה</button>' + supportLine() + BACK_MAP + '</form>';
    $("rgBack").onclick = () => showCover();
    $("rgSend").onclick = async () => {
      $("rgErr").textContent = ""; $("rgInfo").textContent = "";
      const btn = $("rgSend"); btn.disabled = true;
      try {
        const r = await post({ action: "regStart", email: $("rgEmail").value.trim() });
        if (!r.ok) { $("rgErr").textContent = msg(r); return; }
        // אותה הודעה בדיוק לכל כתובת (regSentMessage), ואחריה כפתור הרכישה (אם יש כתובת תקינה): אסור שהודעה כלשהי תגלה מי רכש כרטיס או מי רשום
        $("rgInfo").innerHTML = esc(regSentMessage()) + buyBtn("rgBuy");
        $("rgStep2").style.display = "block"; $("rgCode").focus();
      } catch (e) { $("rgErr").textContent = "אין חיבור לשרת. נסו שוב."; } finally { btn.disabled = false; }
    };
    $("regForm").onsubmit = async ev => {
      ev.preventDefault(); $("rgErr").textContent = "";
      // Enter בשדה המייל (או ״Go״ במקלדת הנייד) לפני שנשלח קוד: הכפתור היחיד מסוג submit הוא ״אישור״ שבתוך האזור המוסתר, ולכן הדפדפן מפעיל אותו — שולחים קוד במקום ״אישור״ עם קוד ריק. אם ״שלחו לי קוד״ מושבת (בקשה רצה) לחיצה עליו אינה עושה דבר, כך שאין שליחה כפולה
      if ($("rgStep2").style.display === "none") { $("rgSend").click(); return; }
      // אחרי שנשלח קוד: Enter בשדה המייל עם שדה קוד ריק/לא שלם לא פונה לשרת (הקוד בן 6 ספרות); מוליך לשדה הקוד
      if (($("rgCode").value.replace(/\D/g, "")).length !== 6) { $("rgErr").textContent = "יש להקליד את קוד האימות (6 ספרות) שנשלח למייל."; $("rgCode").focus(); return; }
      const btn = $("rgGo"); btn.disabled = true;
      try {
        const r = await post({ action: "regFinish", email: $("rgEmail").value.trim(), code: $("rgCode").value.trim(), user: $("rgUser").value.trim(), pass: $("rgPass").value });
        if (!r.ok) { $("rgErr").textContent = msg(r); return; }
        if (r.renewed) { showCover("המנוי חודש עד " + fmtD(r.until) + ". אפשר להיכנס."); return; }
        A.token = r.token; A.user = r.user; A.role = r.role; A.exp = r.exp; A.until = r.until || null; applyMail(r, true); save();
        hideCover(); renderBar();
        document.dispatchEvent(new CustomEvent("req-auth", { detail: { user: A.user, role: A.role } }));
      } catch (e) { $("rgErr").textContent = "אין חיבור לשרת. נסו שוב."; } finally { btn.disabled = false; }
    };
    $("rgEmail").focus({ preventScroll: true });
  }

  /* ---------- שורת משתמש, החלפת סיסמה וניהול משתמשים ---------- */
  const isOrg = () => A.orgKnown ? A.org : A.role === "admin";   // סוג החשבון: ארגוני (השרת מדווח org; שרת ישן — מנהל = ארגוני) או מטיס עצמאי
  // תצוגה מתקדמת = הכלים הפנימיים (מגבלות המקורות, הבדיקה העצמית, סעיף ההגשה המלא בדף הבדיקות ובקובץ ה-Word). מנהל תמיד כן; אחרת הערך בפועל מהשרת (adv); שרת ישן בלי השדה — לפי סוג החשבון (isOrg). מנותק או אסימון שפג — לא (נכשל סגור)
  const isAdv = () => A.loggedIn() && !preview && (A.role === "admin" || (A.advKnown ? A.adv : isOrg()));
  // רענון של משתמש שכבר מחובר (me, החלפת סיסמה): אם התצוגה המתקדמת השתנתה מאז (המנהל החליף אותה) — מודיעים ל-ui.js (req-adv) להציג מחדש. בכניסה עצמה אין צורך: req-auth בא אחריה
  const notifyAdv = was => { if (isAdv() !== was) document.dispatchEvent(new CustomEvent("req-adv", { detail: { adv: isAdv() } })); };
  // מנהל בלבד: מעבר לתצוגת נרשם רגיל ובחזרה (התצוגה המתקדמת כבויה ותפקיד ״משתמש״ רק בדף; הטוקן והחשבון בשרת נשארים של המנהל). req-adv מצייר מחדש את הדף
  function togglePreview() {
    if (!A.loggedIn() || A.role !== "admin") return false;
    const was = isAdv(); preview = !preview; renderBar(); notifyAdv(was);
    return preview;
  }
  // ״הבקשות שלי״ (js/myreq.js): לכל משתמש מחובר, רק כשהשרת מדווח myRequests והדגל features.myreq לא כבוי; שרת ישן — בלי כפתור (נכשל סגור)
  const myReqOn = () => !!(window.ReqMyReq && window.ReqMyReq.available && window.ReqMyReq.available(A.cfg, A.features));
  const myReqBtn = () => myReqOn() ? withHelp('<button type="button" id="ubMyReq">הבקשות שלי</button>', HELP.myreq, "הבקשות שלי") + " " : "";
  function renderBar() {
    let bar = $("userBar");
    if (!bar) { bar = document.createElement("div"); bar.id = "userBar"; bar.className = "userBar"; const w = document.querySelector("header .wrap"); (w || document.body).appendChild(bar); }
    if (!A.token) { bar.innerHTML = ""; return; }
    const daysLeft = A.until ? Math.ceil((A.until - Date.now()) / 86400000) : null;
    bar.innerHTML = '<span>מחובר: <b>' + esc(A.user) + '</b>' + (A.role === "admin" ? " (מנהל)" : isOrg() ? " (חשבון ארגוני)" : "") + '</span> ' + (preview ? '<b class="prevTag" id="ubPrevTag">תצוגת נרשם רגיל — לצפייה בלבד</b> ' : "") +
      (A.until ? '<span id="ubSub">מנוי עד ' + esc(fmtD(A.until)) + (daysLeft <= 30 ? ' — <b>מסתיים בעוד ' + daysLeft + ' ימים</b>' + renewLink() : "") + '</span> ' : "") +
      myReqBtn() + withHelp('<button type="button" id="ubPass">החלפת סיסמה</button>', HELP.pass, "החלפת סיסמה") + (A.role === "admin" ? " " + withHelp('<button type="button" id="ubPrev"' + (preview ? ' class="primary"' : "") + '>' + (preview ? "חזרה לתצוגת מנהל" : "הצג כנרשם רגיל") + '</button>', HELP.prev, "הצג כנרשם רגיל") + " " + withHelp('<button type="button" id="ubAdmin">ניהול משתמשים</button>', HELP.admin, "ניהול משתמשים") : "") + " " + withHelp('<button type="button" id="ubOut">התנתק</button>', HELP.out, "התנתקות");
    $("ubPass").onclick = openPassword; $("ubOut").onclick = () => logout();
    if ($("ubMyReq")) $("ubMyReq").onclick = () => { try { window.ReqMyReq.open(); } catch (e) { /* תוספת: כשל בה לא פוגע בשאר הדף */ } };
    if (A.role === "admin") { $("ubAdmin").onclick = openAdmin; $("ubPrev").onclick = () => { togglePreview(); }; }
  }
  function modal(html, cls) {   // cls (אופציונלי): מחלקה נוספת על תיבת החלון כבר ביצירתה (ללא היסט פריסה/מעבר עיצוב אחרי ההוספה) — js/myreq.js
    if (A.busy) return null;     // באמצע שמירה/שליחה לא מחליפים את החלון הפתוח
    closeModal();
    const m = document.createElement("div"); m.id = "authModal"; m.className = "authCover2"; m.dir = "rtl"; m.setAttribute("role", "dialog"); m.setAttribute("aria-modal", "true");
    m.innerHTML = '<div class="authBox wide' + (cls ? " " + esc(cls) : "") + '">' + html + '<div style="margin-top:12px"><button type="button" id="mdClose">סגור</button></div></div>';
    lastFocus = document.activeElement;   // ההתמקדות חוזרת לשם כשהחלון נסגר (הכפתור שפתח אותו)
    document.body.appendChild(m); $("mdClose").onclick = closeModal;
    setBackdropInert(true);
    const box = m.firstElementChild; box.setAttribute("tabindex", "-1"); box.style.outline = "none"; try { box.focus({ preventScroll: true }); } catch (e) { /* ignore */ }   // הרקע inert, ולכן המיקוד עובר אל החלון (קורא מסך מקריא אותו)
    return m;
  }
  let lastFocus = null;
  function closeModal() {
    const m = $("authModal"); if (m) m.remove();
    setBackdropInert(false);
    const f = lastFocus; lastFocus = null;
    if (m && f && f.isConnected && f !== document.body) { try { f.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }
  // בזמן שחלון פתוח (שליחה, ניהול, סיסמה) הכותרת והטופס שמאחוריו אינם ניתנים למיקוד, להקלדה ולקורא מסך — אחרת אפשר לערוך את הבקשה מאחורי חלון האישור (Tab החוצה). inert על header ו-main בלבד (לא על body):
  // כיסוי הכניסה (#authCover) ובועת ה"!" הם אחים ב-body ונשארים פעילים. ההגנה העיקרית היא קשירת החלון לגרסת הבקשה (S.rev ב-ui.js); זו הגנה בעומק
  function setBackdropInert(on) {
    if (!on && document.body.classList.contains("authLocked")) return;   // הדף נעול (כיסוי הכניסה): סגירת חלון מאוחרת, למשל אחרי פקיעת אסימון, לא משחררת את הנעילה
    ["header", "main"].forEach(t => { const e = document.querySelector(t); if (!e) return; if (on) e.setAttribute("inert", ""); else e.removeAttribute("inert"); });
  }

  function openPassword() {
    if (A.busy) return;
    modal('<h2>החלפת סיסמה</h2><form id="pwForm"><label class="f"><b>סיסמה נוכחית</b><input id="pwOld" type="password" autocomplete="current-password" dir="ltr"></label>' +
      '<label class="f"><b>סיסמה חדשה (לפחות 10 תווים)</b><input id="pwNew" type="password" autocomplete="new-password" dir="ltr"></label>' +
      '<label class="f"><b>סיסמה חדשה שוב</b><input id="pwNew2" type="password" autocomplete="new-password" dir="ltr"></label>' +
      '<div class="err" id="pwErr"></div><button class="primary" type="submit">החלף</button></form>');
    $("pwForm").onsubmit = async ev => {
      ev.preventDefault(); $("pwErr").textContent = "";
      if ($("pwNew").value !== $("pwNew2").value) { $("pwErr").textContent = "הסיסמאות החדשות אינן זהות."; return; }
      const r = await call("changePassword", { oldPass: $("pwOld").value, newPass: $("pwNew").value });
      if (!r.ok) { $("pwErr").textContent = msg(r); return; }
      const was = isAdv();
      A.token = r.token; A.exp = r.exp; applyMail(r, false); save(); closeModal(); notifyAdv(was);
      alert("הסיסמה הוחלפה. התחברויות אחרות של המשתמש נותקו.");
    };
  }

  async function openAdmin() {
    if (A.busy) return null;
    const m = modal('<h2>ניהול משתמשים</h2><div id="admBody">טוען…</div>');
    let filter = "", kindFilter = "";   // kindFilter: "" = הכול, "org" = הארגון, "pilot" = מטיסים (סינון בלקוח, על הבקשות שנטענו)
    const draw = async () => {
      const [r, rq] = await Promise.all([call("listUsers"), call("listRequests", { user: filter || undefined, kind: kindFilter || undefined, limit: 100 })]);
      const body = $("admBody"); if (!body) return;
      if (!r.ok) { body.innerHTML = '<div class="err">' + esc(msg(r)) + "</div>"; return; }
      A.mailMode = r.mailMode || A.mailMode;
      const logWarn = r.logError ? '<div class="err" style="margin:0 0 8px"><b>יומן הבקשות לא נקרא:</b> ' + esc(r.logError) + " — השליחה והשמירה נעצרות עד שיטופל (אפשר עדיין לחסום משתמשים).</div>" : "";
      const fmt = t => t ? new Date(t).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }) : "—";
      const modeLive = A.mailMode === "live";
      // סוג חשבון (חוזה הפרדה בין הארגון למטיסים עצמאיים): השרת מחזיר org לכל משתמש; בלי org (שרת ישן) אין עמודת סוג, סיכומים ולא סינון. משתמש בלי org מפורש — מנהל = ארגוני
      const split = A.hasFeature("orgSplit") || r.users.some(u => typeof u.org === "boolean");
      const userOrg = u => typeof u.org === "boolean" ? u.org : u.role === "admin";
      const kindOf = x => x.kind === "pilot" ? "pilot" : "org";   // רשומה בלי סוג (נשמרה לפני ההפרדה) נחשבת ארגונית
      const num = v => typeof v === "number" && isFinite(v) ? v : null;
      // סיכומים לפי סוג: מהשרת (totals: {org:{requests,sent}, pilot:{requests,sent}}); בלעדיהם — סכום השורות לפי הסוג הנוכחי של המשתמשים
      const totals = (() => {
        const t = r.totals, ok = k => t && t[k] && num(t[k].requests) != null && num(t[k].sent) != null;
        if (ok("org") && ok("pilot")) return { org: { requests: t.org.requests, sent: t.org.sent }, pilot: { requests: t.pilot.requests, sent: t.pilot.sent } };
        const z = { org: { requests: 0, sent: 0 }, pilot: { requests: 0, sent: 0 } };
        r.users.forEach(u => { const k = userOrg(u) ? "org" : "pilot"; z[k].requests += num(u.requests) || 0; z[k].sent += num(u.sent) || 0; });
        return z;
      })();
      const totalsHtml = split ? '<div class="admTotals" id="admTotals" role="status"><b>בקשות הארגון:</b> ' + esc(String(totals.org.requests)) + " (נשלחו " + esc(String(totals.org.sent)) + ") · <b>בקשות מטיסים:</b> " + esc(String(totals.pilot.requests)) + " (נשלחו " + esc(String(totals.pilot.sent)) + ")</div>" : "";
      const reqRows = rq.ok ? rq.requests.filter(x => !split || !kindFilter || kindOf(x) === kindFilter) : [];
      const typeCell = u => {
        const o = userOrg(u), lbl = '<b class="utype ' + (o ? "org" : "pilot") + '" data-type="' + (o ? "org" : "pilot") + '">' + (o ? "ארגוני" : "עצמאי") + "</b>";
        if (u.role === "admin" || !split) return lbl;
        return lbl + " " + withHelp('<button type="button" data-setorg="' + esc(u.user) + '" data-to="' + (o ? 0 : 1) + '">' + (o ? "הפוך לעצמאי" : "הפוך לארגוני") + "</button>", HELP.type, "סוג החשבון — " + u.user);
      };
      // תצוגה מתקדמת (features.advView / שדה adv בשורת המשתמש): המצב בפועל, אם זו ברירת מחדל לפי הסוג (advExplicit === null) או הכרעת המנהל, וכפתור החלפה. מנהל — תמיד כן, בלי כפתור. שרת ישן בלי השדה — אין עמודה
      const advCol = A.hasFeature("advView") || r.users.some(u => typeof u.adv === "boolean");
      const userAdv = u => u.role === "admin" || (typeof u.adv === "boolean" ? u.adv : userOrg(u));
      const advCell = u => {
        const on = userAdv(u), lbl = '<b class="uadv ' + (on ? "on" : "off") + '" data-adv="' + (on ? 1 : 0) + '">' + (on ? "כן" : "לא") + "</b>";
        if (u.role === "admin") return lbl + ' <span class="small">(תמיד)</span>';
        return lbl + (u.advExplicit === null ? ' <span class="small">(ברירת מחדל)</span>' : "") + " " + withHelp('<button type="button" data-setadv="' + esc(u.user) + '" data-to="' + (on ? 0 : 1) + '">' + (on ? "בטל תצוגה מתקדמת" : "הפעל תצוגה מתקדמת") + "</button>", HELP.adv, "תצוגה מתקדמת — " + u.user);
      };
      // מכסת המייל היומית של המערכת (Google): נותרו N נמענים; אזהרה כשנמוך מ-30. השרת מחזיר מספר או null (לא ידוע) — ללא שורה כשאינו מספר
      const ql = r.mailQuotaLeft, quotaHtml = (typeof ql === "number" && isFinite(ql)) ? '<div class="small' + (ql < 30 ? ' err' : '') + '" id="admQuota" role="status">' + (ql < 30 ? '⚠ ' : '') + (Math.floor(ql) === 1 ? 'נותר נמען אחד' : 'נותרו ' + esc(String(Math.max(0, Math.floor(ql)))) + ' נמענים') + ' במכסת המייל היומית' + (ql < 30 ? ' — המכסה עומדת להיגמר; אחרי שתיגמר לא יישלחו מיילים (לא בקשות ולא קודי הרשמה) עד מחר' : '') + '.</div>' : '';
      // ארבעת כפתורי הפעולה בשורת משתמש, כל אחד עם ״!״ משלו. בחסימה/פתיחה ההסבר נבחר לפי u.blocked (הכפתור משנה תווית): HELP.block מול HELP.unblock, כפי ש-setBlocked בשרת מתנהג בכל כיוון
      const actCell = u => {
        const un = u.blocked, q = esc(u.user);
        return withHelp('<button type="button" class="' + (un ? "unblock" : "block") + '" data-blk="' + q + '" data-to="' + (un ? 0 : 1) + '">' + (un ? "✔ פתח מחדש את הבקשות" : "🚫 חסום מבקשות") + '</button>', un ? HELP.unblock : HELP.block, (un ? "פתיחה מחדש של בקשות" : "חסימת בקשות") + " — " + u.user) +
          withHelp('<button type="button" data-rst="' + q + '">איפוס סיסמה</button>', HELP.rst, "איפוס סיסמה — " + u.user) +
          withHelp('<button type="button" data-exp="' + q + '">שינוי תוקף</button>', HELP.exp, "שינוי תוקף — " + u.user) +
          withHelp('<button type="button" data-del="' + q + '">מחק</button>', HELP.del, "מחיקת משתמש — " + u.user);
      };
      body.innerHTML = logWarn + totalsHtml +
        '<div class="admMode ' + (modeLive ? "live" : "test") + '"><b>מצב שליחה: ' + (modeLive ? "חי — למשרד נוטאם" : "בדיקה — המייל נשלח רק למבקש עצמו") + '</b> ' +
        withHelp('<button type="button" id="admMode">' + (modeLive ? "העבר למצב בדיקה" : "העבר למצב חי (שליחה אמיתית למשרד נוטאם)") + '</button>', HELP.mode, "מצב שליחה") + '</div>' + quotaHtml +
        '<h3 style="margin:12px 0 6px">משתמשים — מי הגיש בקשות</h3>' +
        '<div class="small admHelp"><span>הסבר על הפעולות בעמודה האחרונה (גם ליד כל כפתור בשורה):</span>' + [["חסום מבקשות", HELP.block], ["פתח מחדש את הבקשות", HELP.unblock], ["איפוס סיסמה", HELP.rst], ["שינוי תוקף", HELP.exp], ["מחק", HELP.del]].map(([l, t]) => withHelp(esc(l), t, l)).join("") + '</div>' +
        '<table class="admTbl"><tr><th>משתמש</th><th>תפקיד</th>' + (split ? "<th>סוג</th>" : "") + '<th>מצב</th><th>מייל</th><th>תוקף מנוי</th><th>בקשות שנשמרו</th><th>נשלחו למשרד נוטאם</th><th>בקשה אחרונה</th><th>כניסה אחרונה</th>' + (advCol ? "<th>תצוגה מתקדמת</th>" : "") + '<th>פעולות</th></tr>' +
        r.users.map(u => '<tr' + (u.blocked ? ' class="blocked"' : "") + '><td dir="ltr"><a href="#" data-flt="' + esc(u.user) + '">' + esc(u.user) + '</a></td><td>' + (u.role === "admin" ? "מנהל" : "משתמש") + '</td>' + (split ? "<td>" + typeCell(u) + "</td>" : "") + '<td>' + (u.blocked ? '<b class="err">חסום מבקשות</b>' + (u.blockedWhy ? ' <span class="small">(' + esc(u.blockedWhy) + ')</span>' : "") : "פעיל") + '</td><td dir="ltr">' + esc(u.email || "—") + '</td><td>' + (u.until ? (u.until < Date.now() ? '<b class="err">' + esc(fmtD(u.until)) + ' (הסתיים)</b>' : esc(fmtD(u.until))) : "ללא הגבלה") + '</td><td>' + u.requests + '</td><td>' + u.sent + '</td><td>' + esc(fmt(u.lastRequest)) + '</td><td>' + esc(fmt(u.lastLogin)) + '</td>' + (advCol ? "<td>" + advCell(u) + "</td>" : "") + '<td class="acts">' +
          (u.user === A.user ? "—" : actCell(u)) + '</td></tr>').join("") + "</table>" +
        '<h3 style="margin:14px 0 6px">יומן בקשות' + (filter ? ' של <span dir="ltr">' + esc(filter) + '</span> <a href="#" id="admAll">(הצג את כולם)</a>' : " — כל המשתמשים") + '</h3>' +
        (split ? '<div class="row admKind"><label class="small">סוג: <select id="admKind" autocomplete="off"><option value="">הכול</option><option value="org">הארגון</option><option value="pilot">מטיסים</option></select></label></div>' : "") +
        (reqRows.length ? '<table class="admTbl"><tr><th>נשמרה</th><th>משתמש</th>' + (split ? "<th>סוג</th>" : "") + '<th>בקשה</th><th>סטטוס</th><th>תיקייה</th></tr>' +
          reqRows.map(x => '<tr><td>' + esc(fmt(x.saved)) + '</td><td dir="ltr">' + esc(x.user) + (x.lastUser && x.lastUser !== x.user ? " ← " + esc(x.lastUser) : "") + '</td>' + (split ? '<td data-kind="' + kindOf(x) + '">' + (kindOf(x) === "pilot" ? "מטיס" : "הארגון") + "</td>" : "") + '<td>' + esc(x.name) + '</td><td>' +
            (x.sentLive ? "✔ נשלחה למשרד נוטאם" + (x.sentLive > 1 ? " (" + x.sentLive + " פעמים)" : "") + (x.lastSent ? " · " + esc(fmt(x.lastSent.t)) : "") : (x.sentSelf || x.sentTest) ? [x.sentSelf ? "נשלחה לעצמו" : "", x.sentTest ? "נשלחה לבדיקה בלבד" : ""].filter(Boolean).join(" · ") : "נשמרה, לא נשלחה") + '</td><td><a href="' + esc(x.url) + '" target="_blank" rel="noopener">פתח</a></td></tr>').join("") + "</table>"
          : '<div class="small">' + (rq.ok ? (kindFilter && split ? "אין בקשות מהסוג הזה בין הבקשות שנטענו." : "אין בקשות ביומן.") : esc(msg(rq))) + "</div>") +
        '<h3 style="margin:14px 0 6px">הוספת משתמש</h3><form id="addForm" class="row"><input id="adU" type="text" placeholder="שם משתמש" dir="ltr" autocomplete="off" style="flex:1 1 160px"><input id="adP" type="password" placeholder="סיסמה זמנית (10+ תווים)" dir="ltr" autocomplete="new-password" style="flex:1 1 180px"><label class="small"><input type="checkbox" id="adA"> מנהל</label>' + (split ? withHelp('<label class="small"><input type="checkbox" id="adO" checked> חשבון ארגוני</label>', HELP.addOrg, "חשבון ארגוני") : "") + withHelp('<button class="primary" type="submit">הוסף</button>', HELP.add, "הוספת משתמש") + '</form>' +
        '<h3 style="margin:14px 0 6px">איפוס סיסמה</h3><form id="rstForm" class="row"><input id="rsU" type="text" placeholder="שם משתמש" dir="ltr" autocomplete="off" style="flex:1 1 160px"><input id="rsP" type="password" placeholder="סיסמה חדשה (10+ תווים)" dir="ltr" autocomplete="new-password" style="flex:1 1 180px">' + withHelp('<button type="submit">אפס</button>', HELP.reset, "קביעת סיסמה חדשה") + '</form><div class="err" id="admErr"></div>' +
        '<h3 style="margin:14px 0 6px">בדיקת כרטיס באתר (אבחון)</h3><form id="wxForm" class="row"><input id="wxE" type="email" placeholder="מייל הרכישה" dir="ltr" autocomplete="off" style="flex:1 1 220px">' + withHelp('<button type="submit">בדוק</button>', HELP.wix, "בדיקת כרטיס באתר") + '</form><div class="small" id="wxOut"></div>';
      const fail = rr => { $("admErr").textContent = msg(rr); };
      if ($("admKind")) { $("admKind").value = kindFilter; $("admKind").onchange = () => { kindFilter = $("admKind").value; draw(); }; }
      body.querySelectorAll("[data-setorg]").forEach(b => b.onclick = async () => {
        const to = b.dataset.to === "1", who = b.dataset.setorg;
        // הנוסח מתאר את מה שהחלפת הסוג משנה בפועל (שם השולח, ניתוב התשובות והעותקים, ברירות המחדל והתיקייה בדרייב) — ורק לבקשות חדשות
        if (!confirm(to ? "להפוך את " + who + " לחשבון ארגוני? מעכשיו הבקשות שלו יישלחו בשם הארגון (שם השולח ״הארגון הישראלי לרב להב״), התשובות והעותק יחזרו אל הארגון, ברירות המחדל של הארגון ייטענו בטופס שלו, והבקשות החדשות יישמרו בתיקיית ״הארגון״ בדרייב. בקשות שכבר נשמרו נשארות במקומן." : "להפוך את " + who + " לחשבון עצמאי? מעכשיו הבקשות שלו יישלחו בשם הגורם שהוא מצהיר עליו, התשובות והעותק יחזרו אליו, הארגון יקבל עותק סמוי לצורכי תמיכה בלבד, והבקשות החדשות יישמרו בתיקיית ״מטיסים״ תחת שמו בדרייב. בקשות שכבר נשמרו נשארות במקומן.")) return;
        const rr = await call("setOrg", { target: who, org: to }); rr.ok ? draw() : fail(rr);
      });
      body.querySelectorAll("[data-setadv]").forEach(b => b.onclick = async () => {
        const to = b.dataset.to === "1", who = b.dataset.setadv;
        // הנוסח מתאר את מה שההחלפה משנה בפועל (הכלים הפנימיים וסעיף ההגשה בדף ובקובץ ה-Word) ומתי היא נקלטת אצל המשתמש
        if (!confirm(to ? "להפעיל תצוגה מתקדמת ל-" + who + "? המשתמש יראה את הכלים הפנימיים של המערכת: מגבלות המקורות, הבדיקה העצמית וסעיף ההגשה המלא בדף הבדיקות ובקובץ ה-Word. השינוי ייקלט אצלו בכניסה הבאה או ברענון מול השרת." : "לבטל את התצוגה המתקדמת של " + who + "? המשתמש לא יראה יותר את מגבלות המקורות ואת הבדיקה העצמית (היא תמשיך לרוץ ברקע ולחסום שליחה אם תיכשל), ובדף הבדיקות ובקובץ ה-Word יופיע במקום סעיף ההגשה המלא סיכום קצר. השינוי ייקלט אצלו בכניסה הבאה או ברענון מול השרת.")) return;
        const rr = await call("setAdv", { target: who, adv: to }); rr.ok ? draw() : fail(rr.error === "is_admin" ? { error: "is_admin_adv" } : rr);
      });
      if ($("adA")) $("adA").onchange = () => { const a = $("adA").checked, o = $("adO"); if (o) { if (a) o.checked = true; o.disabled = a; } };   // מנהל הוא תמיד ארגוני (נאכף בשרת)
      body.querySelectorAll("[data-blk]").forEach(b => b.onclick = async () => { const rr = await call("setBlocked", { target: b.dataset.blk, blocked: b.dataset.to === "1" }); rr.ok ? draw() : fail(rr); });
      body.querySelectorAll("[data-exp]").forEach(b => b.onclick = async () => {
        const v = prompt("תאריך סיום המנוי של " + b.dataset.exp + " (YYYY-MM-DD). ריק = ללא הגבלה:", ""); if (v === null) return;
        const rr = await call("setExpiry", { target: b.dataset.exp, until: v.trim() }); rr.ok ? draw() : fail(rr);
      });
      body.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => { if (!confirm("למחוק את המשתמש " + b.dataset.del + "?")) return; const rr = await call("deleteUser", { target: b.dataset.del }); rr.ok ? draw() : fail(rr); });
      body.querySelectorAll("[data-rst]").forEach(b => b.onclick = () => { $("rsU").value = b.dataset.rst; $("rsP").focus(); });
      body.querySelectorAll("[data-flt]").forEach(b => b.onclick = ev => { ev.preventDefault(); filter = b.dataset.flt; draw(); });
      if ($("admAll")) $("admAll").onclick = ev => { ev.preventDefault(); filter = ""; draw(); };
      $("admMode").onclick = async () => {
        const toLive = !modeLive;
        // הנוסח מתאר את ההתנהגות בפועל (Code.gs, mailPlan_): כל מטיס בוחר בעצמו — למשרד נוטאם (עותק אליו, התשובות אליו, עותק סמוי למנהל) או רק לעצמו; ואין אישור נוסף של המנהל לכל בקשה
        const offTo = (A.mailTo && A.mailTo.length ? A.mailTo : ["notamoffice@iaa.gov.il", "nofm@iaa.gov.il"]).join(", ");
        const modeMsg = A.hasFeature("orgSplit")
          ? "במצב חי כל משתמש יוכל לשלוח את בקשתו באמת למשרד נוטאם (" + offTo + "). חשבון ארגוני שולח בשם הארגון (שם השולח ״הארגון הישראלי לרב להב״), עם עותק לארגון, ותשובות המשרד יחזרו אל הארגון. חשבון עצמאי (מטיס) שולח בשם הגורם שהוא מצהיר עליו, עם עותק למטיס, ותשובות המשרד יחזרו אליו; הארגון יקבל עותק סמוי של כל שליחה לצורכי תמיכה בלבד. אין אישור נוסף שלך לכל בקשה, וכל משתמש יכול גם לבחור לשלוח רק לעצמו. השינוי חל מיד על כל המשתמשים. להמשיך?"
          : "במצב חי כל מטיס יוכל לשלוח את בקשתו באמת למשרד נוטאם (" + offTo + "), מחשבון הארגון, עם עותק למטיס — ותשובות המשרד יגיעו אליו ולא אליך. אתה תקבל עותק סמוי של כל שליחה, בלי אישור נוסף שלך לכל בקשה. כל מטיס יכול גם לבחור לשלוח רק לעצמו. השינוי חל מיד על כל המשתמשים. להמשיך?";
        if (toLive && !confirm(modeMsg)) return;
        const rr = await call("setMailMode", { mode: toLive ? "live" : "test" }); rr.ok ? draw() : fail(rr);
      };
      $("addForm").onsubmit = async ev => { ev.preventDefault(); const rr = await call("addUser", { newUser: $("adU").value.trim(), newPass: $("adP").value, role: $("adA").checked ? "admin" : "user", org: $("adA").checked || !$("adO") || $("adO").checked }); rr.ok ? draw() : fail(rr); };
      $("wxForm").onsubmit = async ev => {
        ev.preventDefault(); $("wxOut").textContent = "בודק…";
        const rr = await call("wixCheck", { email: $("wxE").value.trim() });
        if (!rr.ok) { $("wxOut").textContent = msg(rr); return; }
        $("wxOut").textContent = rr.orders.length ? rr.orders.map(o => "הזמנה " + o.orderNumber + " · " + fmtD(o.created) + " · " + (o.member ? "חבר רשום" : "לא חבר רשום באתר") + " · " + (o.used ? "נוצלה ע״י " + o.by : o.eligible ? "זכאית להרשמה" : "לא זכאית")).join(" | ") + (rr.account ? " · חשבון קיים: " + rr.account : "") : "לא נמצאה הזמנה ששולמה למייל הזה באירוע.";
      };
      $("rstForm").onsubmit = async ev => { ev.preventDefault(); const rr = await call("resetPassword", { target: $("rsU").value.trim(), newPass: $("rsP").value }); if (rr.ok) { draw(); } else fail(rr); };
    };
    draw();
    return m;
  }

  /* ---------- ממשק ציבורי ---------- */
  A.init = async function (cfg) {
    A.cfg = cfg || {};
    setLocked(true);
    const note = takeNote();   // הודעה מההתנתקות שקדמה לטעינה (פג תוקף, חסום...) — מוצגת בכיסוי; אם יש סשן תקף היא נזרקת
    if (A.cfg.api_url && restore()) {
      try {
        const r = await post({ action: "me", token: A.token });
        if (r.ok) { A.user = r.user; A.role = r.role; A.until = r.until || null; applyMail(r, true); hideCover(); renderBar(); document.dispatchEvent(new CustomEvent("req-auth", { detail: { user: A.user, role: A.role } })); return; }
      } catch (e) { /* אין רשת — מציגים כניסה */ }
      clear();
    }
    renderBar();
    await showCover(note);
  };
  A.loggedIn = () => !!A.token && A.exp > Date.now();
  A.getMailMode = () => A.mailMode;
  A.getMailTo = () => A.mailTo;
  A.getRole = () => (preview ? "user" : A.role);   // בתצוגת נרשם רגיל — ui.js מתנהג כמו אצל משתמש רגיל (בלי פירוט למנהל); A.role הפנימי נשאר של המנהל
  A.isOrg = isOrg;                            // חשבון ארגוני? השרת מדווח org; שרת ישן (בלי org) — מנהל = ארגוני
  A.isPreview = () => preview;
  A.togglePreview = togglePreview;
  A.isAdv = isAdv;                            // תצוגה מתקדמת? השרת מדווח adv; שרת ישן (בלי adv) — מנהל כן, אחרת לפי סוג החשבון; מנותק — לא
  A.getEmail = () => A.email;                  // כתובת המבקש השמורה בשרת ("" = אין)
  A.getCopyTo = () => A.copyTo;                // לאן יישלחו העותקים ו"שלח רק לעצמי" (email, ובלי כתובת — כתובת הבעלים)
  A.getCopyToIsOwner = () => A.copyToIsOwner;  // true = אין כתובת רשומה בחשבון, והעותק יישלח לבעל המערכת
  A.getFeatures = () => A.features.slice();
  A.hasFeature = f => A.features.indexOf(f) >= 0;
  A.setMailModeValue = m => { A.mailMode = m === "live" ? "live" : "test"; };
  A.setBusy = b => { A.busy = !!b; };
  // מרענן מהשרת את מצב השליחה והנמענים (ואת תקפות ההתחברות); נכשל סגור — בלי תשובה תקינה אין שליחה
  A.refresh = async () => {
    try {
      const r = await call("me");
      if (r.ok) { const was = isAdv(); applyMail(r, true); A.user = r.user; A.role = r.role; A.until = r.until || null; notifyAdv(was); }
      return r;
    } catch (e) { return { ok: false, error: "network", message: "אין חיבור לשרת" }; }
  };
  A.modal = (html, cls) => modal(html, cls);
  A.closeModal = closeModal;
  A.user_ = () => A.user;
  A.call = call;
  A.msg = msg;
  A.logout = () => logout();
  A.show = () => showCover();
  A.lock = () => setLocked(true);               // ui.js: נעילה מחדש של הדף בזמן איפוס (כניסת משתמש אחר)
  A.setConfig = cfg => { if (cfg && typeof cfg === "object") A.cfg = A.cfg ? Object.assign(A.cfg, cfg) : cfg; };   // ui.js מעביר את ההגדרות מיד כשנטענו (לפני A.init), כדי שהודעות הסנכרון יכללו את כתובת התמיכה
  A.supportEmail = supportEmail;
  A.withSupport = withSupport;
  A.renewHref = renewUrl;                       // כתובת הרכישה המאומתת (https בלבד) או "" — לבדיקות
  A.buyBox = buyBox;                            // תיבת ההסבר + כפתור הרכישה (HTML) — לבדיקות
  A.regSentMessage = regSentMessage;            // ההודעה שאחרי ״שלחו לי קוד״ (זהה לכל כתובת) — לבדיקות
  // המשתמש שבסשן השמור ב-sessionStorage (אם תקף ולא פג), בלי לשנות דבר בזיכרון — לשחזור מהיסטוריית הדפדפן (ui.js: pageshow)
  A.storedUser = () => { try { const s = JSON.parse(sessionStorage.getItem(KEY) || "null"); return s && s.token && s.exp > Date.now() ? String(s.user || "") : ""; } catch (e) { return ""; } };
  window.ReqAuth = A;
})();
