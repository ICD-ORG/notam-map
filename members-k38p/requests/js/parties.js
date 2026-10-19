/* ReqParties — "דיווח לגורמים נוספים" (שלב ב׳): מנוע טהור (UMD כמו core.js; בדפדפן וב-Node) — בלי DOM, בלי רשת, בלי שעון.
   רשימה של גורמים שייתכן שנדרש לתאם איתם / לדווח להם / לעדכן אותם: נבנית אחרי הרצת הבדיקות מכל מה שנמצא, ומציגה פרטי קשר שהועתקו כלשונם מהמקורות.
   כללי ברזל: (1) רק מה שכתוב במקור — לא משלימים ספרות, לא מרחיבים סיומות ("073-3636954/5" נשאר כך, בלי tel:), לא מנחשים שם↔מספר; (2) כל פרט נושא את מקורו;
   (3) נכשל סגור — שדה שלא עבר אימות נפסל, והשורה נשארת "לא נמצא איש קשר"; (4) כתובות/טלפונים של הארגון, נמעני נוטאם ובקשת חריגה לעולם אינם פלט.
   כל המחרוזות בפלט הן טקסט רגיל (לא HTML): המציגים חייבים לעבור esc (HTML) / esc+xmlClean (Word). הקלט לא נסמך: restore() בודק מחדש כל שדה.
   זרימה טיפוסית: אחרי C.analyze — rows = P.merge(prev, P.build(res, cfg, data)); עריכה: P.setField / P.addManual / P.removeManual (מחזירות rows חדש, בלי מוטציה); הצגה: P.describe(row) + P.summary / P.summaryText;
   שמירה: P.record(rows, {now}) לדרייב או P.marks(rows) לדפדפן; שחזור: P.restore(rec, cfg). מקור פרטי הקשר באזורים: zone.contacts ב-zones.json (נכתב ע״י scripts/export-zones.mjs מאותו קוד חילוץ בדיוק —
   אחרי כל שינוי בדקדוק החילוץ כאן יש להריץ: node scripts/export-zones.mjs).

   ===== API (כל הפונקציות טהורות; "rows" = מערך שורות כמוגדר למטה, הכולל גם ידניות) =====
   VERSION                       1
   LIMITS                        {rows:40, stale:20, manual:20, note:300, name:80, contact:120}
   TYPES / STATUSES              ["approval","report","update"] / ["needed","done","nocontact","notneeded","unmarked"]
   TYPE_LABEL / STATUS_LABEL / STATUS_ICON   תוויות עברית וסמלים לסוג/סטטוס (STATUS_ICON: ! ✓ — ○ ·)
   TEXT                          נוסח קבוע לכותרת/הסבר/הערת תחתית/ריק/כשל (title, intro, paperNote, footer(stamp), empty, noContact, srcPrefix, unverified, outOfRange, updated, failed, more(n), dropped(n), newFound(n))
   GENERAL_LLU_LABEL             "הנחיה כללית של הפמ״ת לכל אזורי LLU (שירות בתי הסוהר)" — התווית הקבועה (לעולם לא "גורם: שירות בתי הסוהר")
   enabled(cfg)                  true אלא אם config.features.parties === false (מפתח חסר = פעיל)
   fingerprint(inp)              "lat,lon,dateFrom,dateTo" — מפתח זהות לבקשה (לשמירה בדפדפן / החלטה אם למזג)

   --- חילוץ (על טקסט בודד; משמש גם את המייצא scripts/export-zones.mjs) ---
   extract(text, blk?)           => {phones, emails, excerpts, segments}. phones: [{raw, display:"03-5487211", text:display+range, kind:"landline|mobile|voip|tollfree", tel:"tel:+9723…"|"" , range:"/5"|"", idx, end, role?}];
                                    emails: [{raw, idx, end, role?}] (role: "exception"|"recipient"; כתובות הארגון נפסלות לגמרי); excerpts: מחרוזות (המשפט/השורה/המקטע שבו המספר, כלשונו); segments: [{text, phones, emails}]
   scanPhones / scanEmails / pairs(sentence) / cleanUrl(v) / phonesFromTag(v) / osmContact(tagsList) — פרימיטיבים (נחשפים לבדיקות)
   quoteEntries(text, {ref, scope, zoneId?})   => [{ref, scope:"zone"|"general", text, phones:["03-5038875"|"08-9902926/8"…], emails:[str], role?}]  — הרשומות שהמייצא כותב ל-zones.json (zone.contacts)

   --- בנייה ---
   build(res, cfg, data?)        => rows (מערך). res = תוצאת C.analyze; data = אותו אובייקט data שהועבר ל-C.analyze ({zones, agri, near, far, …}) — דרוש לפסקאות כלליות מנתונים ישנים,
                                    לטלפוני מפעילי מנחתים ולתגיות OSM של חברי קבוצה; חסר => הרכיבים האלה פשוט בלי פרט קשר. כשל במקור אחד לא מפיל את האחרים.
   buildResult(res, cfg, data?)  => {rows, dropped:N (שורות מעבר לתקרה 40), failed:[שמות מקורות שנכשלו]} — build() = buildResult().rows
   merge(prev, fresh)            => rows. prev = rows קודמות (או {marks, manual} מ-marks()); fresh = build() חדש. סימוני המטיס נשמרים לפי key; key חדש => isNew; פרטי קשר ששונו => updated;
                                    שורה שסומנה "done" או נכתבה בה הערה ונעלמה מהסריקה => stale:true (נשארת "מחוץ לטווח"); ידניות נשמרות. אין בקשה חוזרת/שער — רק נתונים.
   setField(rows, key, field, value) => {rows, error}. field: "type"|"status"|"note" (לכל שורה), "name"|"contact" (ידנית בלבד). ערך לא תקין => rows ללא שינוי + error בעברית (להצגה ליד השדה)
   addManual(rows, {name, contact?, type?, status?, note?}) => {rows, key, error}      removeManual(rows, key) => rows
   cueOf(text)                   משפט תיאום בלי מספר ("…בטלפון המפורסם בפרק א׳ 07."); notamContacts(raw) => {phones, lines, coordWith}
   SUGGESTIONS                   שמות הצ׳יפים להוספה ידנית;  localAuthority(far, cfg?) => {name, phones, emails, urls}|null — הרשות המקומית לפי OSM (לצ׳יפ "רשות מקומית")
   summary(rows)                 => {total, done, needed, unmarked, nocontact, notneeded}
   summaryText(sum)              => "6 גורמים — 2 דווחו/התקבל אישור · 3 נדרש · 1 אין צורך" (אפסים מושמטים; "לא נמצאו גורמים")
   mailLine(sum)                 => "דיווח לגורמים נוספים: 6 גורמים — 2 דווחו/התקבל אישור" (ללא "• "; Q6: רק סך הכול ו"דווחו"; M=0 => בלי החלק השני)
   describe(row, {max?})         => {none, cue, blocks:[{label, phones, emails, urls, lines, pairs, src}], more} — מבנה מוכן להצגת פרטי הקשר (מסך / Word / דרייב). none => להציג "לא נמצא פרט קשר" (+cue); max (ב-Word: 3) = תקרת קטעים מצוטטים, more = "ועוד N"
   record(rows, {now?})          => {v, builtAt, summary, rows:[אוטומטיות], manual:[ידניות]} — בלוק "parties" בקובץ נתוני הבקשה (דרייב); restore(rec, cfg?) => rows (תקינות מחדש, תקרות, חסימות מההגדרות, אף פעם לא זורק)
   marks(rows)                   => {keys:[מפתחות הסריקה], marks:{key:{type?,status?,note?,title?}}, manual:[…]} — צורה קומפקטית לשמירה בדפדפן; merge מקבל אותה כ-prev

   ===== שורה (Row) — מחרוזות טקסט רגיל =====
   {key, src:"zone|notam|agri|airfield|osm|manual", title, tag, party, cue?,
    contacts:{phones:[phone], emails:[str], urls:[str], lines:[str — קטעים מצוטטים], pairs:[{label,phone}]|null,
              general:null | {label, src, phones, emails, lines, pairs}},    // general = "הנחיה כללית של הפמ״ת" (LLU סעיף 1א / LLR סעיף 2 / …), נפרד מפרטי הגורם עצמו
    contactSrc,                 // מקור פרטי הגורם עצמו ("פמ״ת א-17 (עמ׳ 6, עדכון 1/25)", "נוטם C1825/26", "OpenStreetMap — לא מאומת", …)
    general?:true, count?, hasContact:bool, dtype, mark:{type?,status?,note?}, type, status, note,   // type/status/note = ערכים אפקטיביים (mark גובר על ברירת המחדל)
    isNew?, updated?, stale?, manual?:true, contact?:str — ידנית בלבד}
   phone מוצג כ-phone.text (display+range); קישור tel: רק כש-phone.tel אינו ריק; phone.kind==="unverified" (OSM) — להציג "לא אומת" וללא קישור. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ReqParties = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const VERSION = 1;
  const LIMITS = { rows: 40, stale: 20, manual: 20, note: 300, name: 80, contact: 120 };
  const TYPES = ["approval", "report", "update"], STATUSES = ["needed", "done", "nocontact", "notneeded", "unmarked"];
  const TYPE_LABEL = { approval: "אישור מקומי", report: "דיווח", update: "עדכון" };
  const STATUS_LABEL = { needed: "נדרש", done: "דווח / התקבל אישור", nocontact: "לא נמצא איש קשר", notneeded: "אין צורך", unmarked: "טרם סומן" };
  const STATUS_ICON = { needed: "!", done: "✓", nocontact: "—", notneeded: "○", unmarked: "·" };
  const SRCS = ["zone", "notam", "agri", "airfield", "osm", "manual"];
  // נוסח קבוע (קצר, ענייני, ניטרלי) — משותף למסך, ל-Word ולדרייב. בלי כתובת הארגון ובלי ״מנהל המערכת״. footer(stamp) — stamp = תאריך ושעה מוכנים להצגה
  const TEXT = {
    title: "דיווח לגורמים נוספים",
    intro: "הרשימה נאספה אוטומטית. פרטי הקשר הועתקו כלשונם מהמקור ואינם מאומתים. הסימונים הם שלכם. הרשימה מצורפת לבקשה ואינה מונעת שליחה.",
    paperNote: "עמוד נלווה לבקשה, אינו חלק מ-17 שדות נספח ג׳. הסימונים הם הצהרת המבקש.",
    footer: stamp => "הרשימה נבנתה אוטומטית ממקורות המערכת (פמ״ת, נוטמים, OpenStreetMap, טבלת המנחתים החקלאיים). פרטי הקשר הועתקו כלשונם ואינם מאומתים." + (stamp ? " מצב נכון ל-" + stamp + "." : ""),
    empty: "לא נמצאו גורמים בסריקה, ולא נוספו גורמים ידנית.",
    noContact: "לא נמצא פרט קשר", srcPrefix: "מקור: ", unverified: "לא אומת", outOfRange: "מחוץ לטווח הסריקה הנוכחית", updated: "פרטי הקשר עודכנו",
    failed: "לא ניתן היה להכין רשימה אוטומטית. אפשר להוסיף גורמים ידנית.",
    more: n => "ועוד " + n, dropped: n => (n === 1 ? "גורם אחד נוסף לא הוצג" : n + " גורמים נוספים לא הוצגו"),
    newFound: n => (n === 1 ? "נוסף גורם אחד חדש מאז הבדיקה הקודמת" : "נוספו " + n + " גורמים חדשים מאז הבדיקה הקודמת")
  };
  const GENERAL_LLU_LABEL = "הנחיה כללית של הפמ״ת לכל אזורי LLU (שירות בתי הסוהר)";
  const enabled = cfg => !(cfg && cfg.features && cfg.features.parties === false);
  const fingerprint = inp => { inp = inp || {}; const n = v => (isFinite(+v) && v !== "" && v != null ? (+v).toFixed(6) : ""); return [n(inp.lat), n(inp.lon), inp.dateFrom || "", inp.dateTo || ""].join(","); };

  /* ================= היגיינת טקסט ================= */
  // תווי כיווניות/רוחב-אפס מוסרים (LRM/RLM/LRE/RLE/PDF/LRO/RLO/LRI/RLI/FSI/PDI, ZWSP/ZWNJ/ZWJ, BOM); NBSP -> רווח. הטקסט המוצג הוא הטקסט אחרי הניקוי הזה בלבד
  const BIDI = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
  const clean = s => String(s == null ? "" : s).replace(BIDI, "").replace(/\u00a0/g, " ");
  // תו אסור (כמו purposeHasBadChar בליבה): בקרה C0/DEL/C1, U+2028/9, חצי סרוגייט בודד, FFFE/FFFF — אסורים ב-XML (Word) וחצי סרוגייט זורק ב-encodeURIComponent
  const badCode = c => c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029 || (c >= 0xd800 && c <= 0xdfff) || c === 0xfffe || c === 0xffff;
  function hasBadChar(p) { for (const ch of String(p)) if (badCode(ch.codePointAt(0))) return true; return false; }
  // יש תו גלוי? (כמו purposeHasVisible בליבה): רווחים/בקרה/עיצוב ותווים "ריקים" ידועים אינם נחשבים
  const INVIS_CAT = /[\p{Cc}\p{Cf}\p{Z}]/u;
  function hasVisible(p) {
    for (const ch of String(p == null ? "" : p)) {
      if (INVIS_CAT.test(ch) || /\s/.test(ch)) continue;
      const c = ch.codePointAt(0);
      if (c === 0x115f || c === 0x1160 || c === 0x3164 || c === 0xffa0 || c === 0x2800 || c === 0x34f || c === 0x17b4 || c === 0x17b5 || (c >= 0x180b && c <= 0x180f) || (c >= 0xfe00 && c <= 0xfe0f) || (c >= 0xe0100 && c <= 0xe01ef)) continue;
      return true;
    }
    return false;
  }
  const len = s => Array.from(String(s)).length;
  // חיתוך למקסימום תווים (נקודות קוד), בגבול מילה כשאפשר, עם "…"
  function cap(t, max) {
    const a = Array.from(t); if (a.length <= max) return t;
    let cut = a.slice(0, max - 1).join(""); const sp = cut.lastIndexOf(" ");
    if (sp > max * 0.6) cut = cut.slice(0, sp);
    return cut.replace(/[\s,;:\-–]+$/, "") + "…";
  }
  // מחרוזת שורה בודדת לתצוגה מנתונים חיצוניים (OSM, נוטמים, אזורים, JSON שמור): בלי כיווניות/בקרה/שורות חדשות, רווחים מכווצים, עד max
  function txt(s, max) {
    let t = clean(s); if (hasBadChar(t)) t = Array.from(t, ch => badCode(ch.codePointAt(0)) ? " " : ch).join("");
    t = t.replace(/\s+/g, " ").trim();
    return max ? cap(t, max) : t;
  }

  /* ================= חסימות: כתובות/טלפונים שאינם גורמים ================= */
  const INTERNAL_DOMAINS = ["icd.org.il"];                                                // הארגון (כולל תת-דומיינים) — נפסל תמיד, בנקודת היציאה היחידה
  const INTERNAL_PHONES = ["525076677"];                                                  // 052-5076677 — תמיכה טכנית של הארגון (ספרות לאומיות)
  const RECIPIENTS = ["notamoffice@iaa.gov.il", "nofm@iaa.gov.il", "fpl@iaa.gov.il"];     // נמעני משרד נוטאם — הבקשה עצמה, לא "גורם נוסף"
  const EXCEPTION = ["caai-charigot@mot.gov.il"];                                         // בקשת חריגה מרת״א — מסומן role:"exception" ואינו נכנס לרשימה
  const lc = s => String(s).toLowerCase();
  function roleOfEmail(addr, blk) {
    const a = lc(addr), host = a.slice(a.lastIndexOf("@") + 1);
    if (INTERNAL_DOMAINS.some(d => host === d || host.endsWith("." + d))) return "internal";
    if (blk && blk.internalEmails && blk.internalEmails.has(a)) return "internal";
    if (RECIPIENTS.includes(a) || (blk && blk.recipients && blk.recipients.has(a))) return "recipient";
    if (EXCEPTION.includes(a)) return "exception";
    return "";
  }
  const natOf = s => { const d = String(s).replace(/\D/g, ""), v = validate(d); return v ? v.national : d; };
  const roleOfPhone = (nat, blk) => (INTERNAL_PHONES.includes(nat) || (blk && blk.phones && blk.phones.has(nat)) ? "internal" : "");
  // רשימת חסימה דינמית מההגדרות: נמעני המייל, כתובת התמיכה, ו-parties.block.{emails,phones} (אופציונלי)
  function blockFrom(cfg) {
    const blk = { recipients: new Set(), internalEmails: new Set(), phones: new Set() };
    const add = (set, v) => { if (typeof v === "string" && v.trim()) set.add(lc(v.trim())); };
    const m = (cfg && cfg.mail) || {};
    [].concat(m.to || [], m.fpl || []).forEach(v => add(blk.recipients, v));
    add(blk.internalEmails, cfg && cfg.support_email);
    const b = (cfg && cfg.parties && cfg.parties.block) || {};
    [].concat(b.emails || []).forEach(v => add(blk.internalEmails, v));
    [].concat(b.phones || []).forEach(v => { if (typeof v === "string" && v.trim()) blk.phones.add(natOf(v)); });
    return blk;
  }

  // ניקוי טקסט חופשי (שורות מצוטטות, כותרות, שמות) מכתובות/טלפונים חסומים: כתובת הארגון / נמעני נוטאם / בקשת חריגה / טלפון התמיכה => "…". נקודת היציאה היחידה של פלט הבנייה והשחזור
  // keepExc: כתובת בקשת חריגה נשארת (ברמת הרשומה היא מסומנת role:"exception"; רק הבנייה והשחזור מסירים גם אותה)
  function scrub(str, blk, keepExc) {
    if (typeof str !== "string" || !str) return str;
    let t = clean(str).replace(/[^\s"'<>(),;]*icd\.org\.il[^\s"'<>(),;]*/gi, "…");
    t = t.replace(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+/g, m => { const a = m.replace(/[.\-_]+$/, ""), r = roleOfEmail(a, blk); return r && !(keepExc && r === "exception") ? "…" + m.slice(a.length) : m; });
    const bad = scanPhones(t, blk, true).filter(p => p.role === "internal");
    for (let i = bad.length - 1; i >= 0; i--) t = t.slice(0, bad[i].idx) + "…" + t.slice(bad[i].end);
    return t;
  }
  function scrubRow(r, blk) {
    const f = x => scrub(x, blk), c = r.contacts;
    r.title = f(r.title); r.tag = f(r.tag); r.party = f(r.party); r.contactSrc = f(r.contactSrc); if (r.cue) r.cue = f(r.cue);
    c.lines = c.lines.map(f);
    if (c.pairs) c.pairs.forEach(x => { x.label = f(x.label); });
    if (c.general) { c.general.label = f(c.general.label); c.general.src = f(c.general.src); c.general.lines = c.general.lines.map(f); if (c.general.pairs) c.general.pairs.forEach(x => { x.label = f(x.label); }); }
    return r;
  }

  /* ================= טלפונים ישראליים ================= */
  // דקדוק קשיח (לא "כל רצף ספרות"): קידומת אזור/רשת + 7 ספרות בדיוק, מפריד אחד אפשרי (רווח/טאב/מקף מכל סוג) בין הקבוצות, ולעולם לא חוצה שורה.
  //   קווי: 0[23489]+7 · סלולרי: 05X+7 · VoIP: 07[2-9]+7 · בינלאומי: (+|00)972 [0 או (0) אופציונלי] + אותו דבר בלי 0 מוביל · קווי שירות: 1-700/1-800/1-599 + 6 ספרות.
  //   הרגרסיה שננעלה: מפריד שהוא \s חצה שורה ("…054-3390262⏎2) …") ובלע את הספרה של השורה הבאה — 3 מ-4 הטלפונים של LLP14 אבדו.
  // בלי lookbehind (Safari ישן): גבול תחילת-מספר נבדק ידנית (לא ספרה/אות לטינית צמודה: מזהי נוטם A0839/26 וחותמות 2610191000 אינם מספרים)
  const DASH = "\\-\\u2010-\\u2015\\u2212";   // - ‐ ‑ ‒ – — ― −
  const S = "[ \\t" + DASH + "]?";
  const TAIL = S + "\\d{3}" + S + "\\d{4}";
  const NAT0 = "(?:0(?:[23489]" + TAIL + "|5\\d" + TAIL + "|7[2-9]" + TAIL + ")|\\(0(?:[23489]|5\\d|7[2-9])\\)" + TAIL + ")";
  const INTL = "(?:\\+|00)?972[ \\t" + DASH + ".]{0,6}(?:\\(0\\)|0)?[ \\t" + DASH + ".]{0,6}(?:[23489]" + TAIL + "|5\\d" + TAIL + "|7[2-9]" + TAIL + ")";
  const CAND = new RegExp("(?:" + INTL + "|" + NAT0 + ")(?!\\d)", "g");
  const TOLL = new RegExp("1[ \\t" + DASH + "]?(?:700|800|599)[ \\t" + DASH + "]?\\d{3}[ \\t" + DASH + "]?\\d{3}(?!\\d)", "g");
  const RANGE_TAIL = /^[ \t]*\/[ \t]*(\d{1,3})(?![\d\-\u2010-\u2015\/])/;
  const startOk = (t, i) => i === 0 || !/[0-9A-Za-z_]/.test(t[i - 1]);
  function validate(digits) {
    // digits: ספרות בלבד (כולל תחילית). מחזיר {kind, national} (national = בלי 0 מוביל) או null
    let d = String(digits);
    if (/^00972/.test(d)) d = d.slice(5); else if (/^972/.test(d)) d = d.slice(3); else if (/^0/.test(d)) d = d.slice(1); else return null;
    if (/^0/.test(d)) d = d.slice(1);   // +972 (0)3… — ה-0 המיותר
    if (/^[23489]\d{7}$/.test(d)) return { kind: "landline", national: d };
    if (/^5\d{8}$/.test(d)) return { kind: "mobile", national: d };
    if (/^7[2-9]\d{7}$/.test(d)) return { kind: "voip", national: d };
    return null;
  }
  // תצוגה אחידה: 03-5487211 / 054-2479323 (מקף אחרי הקידומת). ה-raw נשמר כפי שנכתב במקור
  const display = (national, kind) => kind === "landline" ? "0" + national[0] + "-" + national.slice(1) : "0" + national.slice(0, 2) + "-" + national.slice(2);
  const mkPhone = (raw, disp, kind, tel, idx, end, range, role) => { const p = { raw, display: disp, text: disp + range, kind, tel, idx, end, range }; if (role) p.role = role; return p; };
  /* סורק טקסט: מחזיר [{raw, display, text, kind, tel, idx, end, range, role?}] בסדר הופעה. range = סיומת מקוצרת ("/5") שלא הורחבה — אין לה tel: ולעולם לא ממציאים את המספר השני.
     מספרי הארגון נפסלים לגמרי; מספרים שבהגדרות החסימה (blk.phones) נפסלים גם הם */
  function scanPhones(text, blk, keepInternal) {
    const t = clean(text), out = [], taken = [];
    const push = (m, v, toll) => {
      const idx = m.index; let end = idx + m[0].length;
      if (taken.some(([a, b]) => idx < b && end > a)) return;
      const nat = toll ? m[0].replace(/\D/g, "") : v.national, role = roleOfPhone(nat, blk);
      taken.push([idx, end]);
      if (role === "internal" && !keepInternal) return;
      let range = "";
      const rest = t.slice(end), tail = RANGE_TAIL.exec(rest);
      if (!toll && tail && !/^[ \t]*\/[ \t]*0\d/.test(rest)) { range = "/" + tail[1]; end += tail[0].length; }   // 073-3636954/5 — סיומת מקוצרת; "/052-9289403" הוא מספר מלא ונמצא בנפרד
      out.push(toll ? mkPhone(m[0].trim(), m[0].replace(/\D/g, "").replace(/^(\d)(\d{3})(\d{3})(\d{3})$/, "$1-$2-$3-$4"), "tollfree", "tel:" + m[0].replace(/\D/g, ""), idx, end, "", role) :
        mkPhone(m[0].trim(), display(v.national, v.kind), v.kind, range ? "" : "tel:+972" + v.national, idx, end, range, role));
    };
    let m;
    CAND.lastIndex = 0;
    while ((m = CAND.exec(t)) !== null) {
      if (!startOk(t, m.index)) { CAND.lastIndex = m.index + 1; continue; }
      const v = validate(m[0].replace(/\D/g, "")); if (v) push(m, v, false);
    }
    TOLL.lastIndex = 0;
    while ((m = TOLL.exec(t)) !== null) { if (!startOk(t, m.index)) { TOLL.lastIndex = m.index + 1; continue; } push(m, null, true); }
    return out.sort((a, b) => a.idx - b.idx);
  }

  /* ================= דוא״ל וכתובות אתר ================= */
  const EMAIL = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+/g;
  // דוא״ל כפי שנכתב (אות גדולה נשמרת); קיצוץ נקודה/מקף בסוף ובתחילה; כתובות הארגון נפסלות לגמרי; role: recipient (נמעני נוטאם) | exception (בקשת חריגה)
  function scanEmails(text, blk) {
    const t = clean(text), out = []; let m;
    EMAIL.lastIndex = 0;
    while ((m = EMAIL.exec(t)) !== null) {
      let raw = m[0], idx = m.index;
      const lead = /^[.\-_+%]+/.exec(raw); if (lead) { raw = raw.slice(lead[0].length); idx += lead[0].length; }
      raw = raw.replace(/[.\-_]+$/, "");
      if (!/\.[A-Za-z]{2,}$/.test(raw) || /\.\./.test(raw) || raw.indexOf("@") < 1 || raw.indexOf("@") > 64 || raw.length > 120) continue;
      const role = roleOfEmail(raw, blk); if (role === "internal") continue;
      const e = { raw, idx, end: idx + raw.length }; if (role) e.role = role;
      out.push(e);
    }
    return out;
  }
  // אתר מתג OSM (website / contact:website / url): רק http(s), בלי תווי בקרה/רווח/סוגריים משולשים/גרשיים/הרשאות (user:pw@), עד 120 תווים, מארח עם נקודה, לא של הארגון;
  // ללא סכמה — מוסיפים http:// (להצגה). javascript:, data:, mailto:, ftp:, //x, localhost — נפסלים
  function cleanUrl(v) {
    let s = clean(v).trim();
    if (!s || /[\u0000-\u001f\u007f\s<>"'`\\]/.test(s)) return null;
    if (/^[a-z][a-z0-9+.\-]*:/i.test(s) && !/^https?:\/\//i.test(s)) return null;
    if (!/^https?:\/\//i.test(s)) { if (!/^[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)+(\/|$)/.test(s)) return null; s = "http://" + s; }
    if (s.length > 120) return null;
    try {
      const u = new URL(s), h = lc(u.hostname);
      if (!/^https?:$/.test(u.protocol) || !h.includes(".") || u.username || u.password) return null;
      if (INTERNAL_DOMAINS.some(d => h === d || h.endsWith("." + d))) return null;
    } catch (e) { return null; }
    return s;
  }
  const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };
  // טלפון מתג OSM: ערך יכול להכיל כמה מספרים (מופרדים ב-; , או שורה) — כל חלק נבדק לחוד; חלק שהוא מספר ישראלי תקין (ובלי ספרות נוספות סביבו) => תקין;
  // חלק אחר שנראה כמספר (≥7 ספרות, תווי טלפון בלבד) נשמר כטקסט גולמי מסומן kind:"unverified" (בלי קישור); כל השאר נפסל
  function phonesFromTag(v, blk) {
    const out = [];
    String(v == null ? "" : v).split(/[;,\n]/).map(x => txt(x)).filter(Boolean).forEach(x => {
      const ph = scanPhones(x, blk);
      if (ph.length) {
        const rest = ph.reduce((s, p) => s.slice(0, p.idx) + " ".repeat(p.end - p.idx) + s.slice(p.end), clean(x));
        if (!/\d/.test(rest)) { ph.forEach(p => out.push({ raw: p.raw, display: p.display, text: p.text, kind: p.kind, tel: p.tel, range: p.range, valid: true })); return; }
      }
      const digits = x.replace(/\D/g, "");
      if (x.length <= 40 && digits.length >= 7 && digits.length <= 15 && /^[0-9+()\-\u2010-\u2015.\/ ]+$/.test(x) && !INTERNAL_PHONES.includes(natOf(digits)) && !(blk && blk.phones && blk.phones.has(natOf(digits))))
        out.push({ raw: x, display: x, text: x, kind: "unverified", tel: "", range: "", valid: false });
    });
    return out;
  }

  /* ================= קטע מצוטט ("excerpt") ================= */
  // יחידות טקסט: שורה (\n) ← קטע של מבנה הנתונים (" · " בשדות ב-09) ← משפט (נקודה+רווח). יחידה עד MAXEX תווים — כלשונה. ארוכה יותר — מתפצלת למקטעים בפסיק/נקודה-פסיק
  // ברמה העליונה (מחוץ לסוגריים) ונשארים רק מקטעים שיש בהם פרט קשר ("מתא״מ פיקוד דרום בטלפון 08-9902926/8 (…)"). מקטע ארוך מ-HARD נחתך בגבול מילה בלבד (משמאל לפני
  // הפרט הראשון, ומימין אחרי הפרט האחרון) עם "…". לעולם לא באמצע מילה, לעולם לא באמצע פרט קשר, לעולם לא מנוסח מחדש
  const MAXEX = 160, CTX = 40, HARD = 220, TAILCTX = 60;
  function units(line) {
    const spans = []; let start = 0, m; const re = /(\.\s+(?=\S)|\s·\s)/g;
    while ((m = re.exec(line)) !== null) { spans.push([start, m.index + (m[0].trim() === "." ? 1 : 0)]); start = m.index + m[0].length; }
    spans.push([start, line.length]);
    return spans;
  }
  function clauseSpans(line, a, b) {
    const spans = []; let depth = 0, start = a;
    for (let i = a; i < b; i++) {
      const c = line[i];
      if (c === "(" || c === "[") depth++;
      else if ((c === ")" || c === "]") && depth > 0) depth--;
      else if (depth === 0 && (c === "," || c === ";") && /\s/.test(line[i + 1] || " ")) { spans.push([start, i]); start = i + 1; }
    }
    spans.push([start, b]);
    return spans;
  }
  function fit(line, s, e, hs, off) {
    const first = Math.min.apply(null, hs.map(h => h.idx - off)), last = Math.max.apply(null, hs.map(h => h.end - off));
    while (s < first && /[\s,;:\-–▪•]/.test(line[s])) s++;
    while (e > last && /[\s,;:\-–]/.test(line[e - 1])) e--;
    let lead = "", trail = "";
    if (e - s > HARD && e - last > TAILCTX) { const cut = line.lastIndexOf(" ", last + TAILCTX); if (cut > last) { e = cut; trail = "…"; } }
    if (e - s > HARD) { const sp = line.indexOf(" ", Math.max(s, e - HARD)); if (sp > s && sp < first) { s = sp; lead = "…"; while (s < first && line[s] === " ") s++; } }
    return lead + line.slice(s, e).replace(/\s+/g, " ").trim() + trail;
  }
  /* מקטעים מצוטטים: [{text, phones, emails}] — כל מקטע עם הפרטים שבתוכו */
  function segments(text, hits) {
    const t = clean(text), out = [], seen = new Set(); let off = 0;
    t.split("\n").forEach(line => {
      units(line).forEach(([a, b]) => {
        const inU = hits.filter(h => h.idx - off >= a && h.idx - off < b + 1);
        if (!inU.length) return;
        const spans = b - a <= MAXEX ? [[a, b]] : clauseSpans(line, a, b);
        spans.forEach(([s, e]) => {
          const hs = inU.filter(h => h.idx - off >= s && h.idx - off < e + 1);
          if (!hs.length) return;
          const piece = fit(line, s, e, hs, off);
          if (!piece || seen.has(piece)) return;
          seen.add(piece);
          out.push({ text: piece, phones: hs.filter(h => "display" in h), emails: hs.filter(h => !("display" in h)) });
        });
      });
      off += line.length + 1;
    });
    return out;
  }
  /* סריקה מלאה של טקסט אחד. blk (אופציונלי) = רשימת חסימה דינמית */
  function extract(text, blk) {
    const phones = scanPhones(text, blk), emails = scanEmails(text, blk);
    const segs = segments(text, phones.concat(emails));
    segs.forEach(sg => { sg.text = scrub(sg.text, blk, true); });   // הקטע המצוטט לעולם אינו נושא כתובת/טלפון של הארגון או נמען נוטאם (גם אם הם באותו משפט עם פרט קשר אמיתי)
    return { phones, emails, excerpts: segs.map(s => s.text), segments: segs };
  }

  /* ================= זוגות "תווית — מספר" (רק כשהדקדוק חד-משמעי) ================= */
  // קטע (או הסוגריים הפנימיים שבו שמכילים ≥2 מספרים) שבו כל מקטע, המופרד ב-";" או בשורה, הוא "<תווית ללא ספרות עד 30 תווים> [-–:] <מספר אחד>". אחרת null (ונשארים עם הקטע המצוטט)
  function pairs(sentence) {
    let t = clean(sentence);
    const paren = Array.from(t.matchAll(/\(([^()]*)\)/g)).map(m => m[1]).filter(x => scanPhones(x).length >= 2);
    if (paren.length === 1) t = paren[0];
    const segs = t.split(/[;\n]+/).map(x => x.trim()).filter(Boolean);
    if (segs.length < 2) return null;
    const out = [];
    for (const seg of segs) {
      const ph = scanPhones(seg);
      if (ph.length !== 1) return null;
      const label = seg.slice(0, ph[0].idx).replace(/[\s:\-–\u2010-\u2015()]+$/, "").replace(/^[\s(]+/, "").trim();
      if (!label || /\d/.test(label) || len(label) > 30) return null;
      out.push({ label, phone: ph[0] });
    }
    return out;
  }

  /* ================= רשומות ציטוט (zones.json → zone.contacts) ================= */
  const hasId = (s, id) => { for (let i = s.indexOf(id); i >= 0; i = s.indexOf(id, i + 1)) { if (!/[A-Za-z0-9]/.test(s[i - 1] || " ") && !/[A-Za-z0-9]/.test(s[i + id.length] || " ")) return true; } return false; };
  const compactPhone = p => p.text;   // "074-7833333" / "08-9902926/8" — כפי שמוצג (מספר מנורמל + סיומת מקוצרת כלשונה); הלקוח סורק מחדש את text, כך שהמערך משמש לקריאה ולבדיקת diff
  function entryOf(seg, ref, scope) {
    const keep = e => !e.role, ph = seg.phones.filter(p => !p.role);
    const e = { ref, scope, text: seg.text, phones: ph.map(compactPhone), emails: seg.emails.filter(keep).map(x => x.raw) };
    // כתובת ייחודית של בקשת חריגה / נמעני נוטאם: אם זה כל מה שיש במקטע — הרשומה מסומנת role (ואינה נכנסת לרשימה); אם יש גם פרטים רגילים — הכתובת מוסרת (נכשל סגור)
    const rs = seg.emails.filter(x => x.role);
    if (rs.length && !e.phones.length && !e.emails.length) { e.emails = rs.map(x => x.raw); e.role = rs[0].role; }
    return e;
  }
  /* quoteEntries(text, {ref, scope:"zone"|"general", zoneId?}) — רשומות פרטי קשר מציטוט אחד.
     ציטוט כללי (סעיף/פרק שהכרטיס מצטט) שבסוגריים שבו מופיע מזהה האזור עצמו ("(לאזור LLU21 לטלפון 03-5038875)") מניב בנוסף רשומה scope:"zone" — המספר הייעודי של האזור */
  function quoteEntries(text, o) {
    const scope = o && o.scope === "general" ? "general" : "zone", ref = String((o && o.ref) || ""), out = [];
    extract(text).segments.forEach(seg => {
      out.push(entryOf(seg, ref, scope));
      if (scope === "general" && o.zoneId) {
        for (const m of seg.text.matchAll(/\(([^()]*)\)/g)) {
          if (!hasId(m[1], o.zoneId)) continue;
          const sub = extract(m[1]);
          if (sub.phones.length || sub.emails.length) out.push(entryOf({ text: m[1].trim(), phones: sub.phones, emails: sub.emails }, ref, "zone"));
        }
      }
    });
    return out;
  }

  /* ================= נוטמים ================= */
  // שדה E של הנוטם בלבד (ללא שורות Q/A/B/C/F/G — שם יש רצפי ספרות שאינם טלפונים), שורות מחוברות לרווח
  function notamE(raw) {
    const t = String(raw == null ? "" : raw).replace(/\r/g, ""), m = /(?:^|\n)E\)/.exec(t);
    if (!m) return "";
    let e = t.slice(m.index + m[0].length); const f = /\n[FG]\)/.exec(e); if (f) e = e.slice(0, f.index);
    return e.replace(/\)\s*$/, "").replace(/\s+/g, " ").trim();
  }
  const NOTAM_CUE = /\b(?:PHONE|TELEPHONE|CTC|CONTACT|CALL|MOBILE|MOB)\b|\bTEL\b(?!\s+AVIV)/;   // "TEL AVIV" אינו רמז לטלפון
  const COORD_RE = /\b(?:COORD(?:INATE)?|COOR)\s+WITH\s+([A-Z0-9][A-Z0-9 ,&\/\-()']{1,80}?)\s*(?:[.;]|$)/;
  // מחזיר {phones, lines, coordWith}: טלפון רק במשפט שיש בו מילת רמז (PHONE NR / TEL / CTC…), וגורם מתאם רק מ-"COORD WITH <X>" (X כלשונו באנגלית)
  function notamContacts(raw, blk) {
    const e = notamE(raw), phones = [], lines = [], seen = new Set(); let coordWith = "";
    const sentences = []; let st = 0;
    for (let i = 0; i < e.length; i++) if (e[i] === "." && (i + 1 === e.length || /\s/.test(e[i + 1]))) { sentences.push(e.slice(st, i + 1)); st = i + 1; }
    if (st < e.length) sentences.push(e.slice(st));
    sentences.map(s => s.trim()).filter(Boolean).forEach(s => {
      let keep = false;
      if (NOTAM_CUE.test(s)) { const ph = scanPhones(s, blk).filter(p => !p.role); if (ph.length) { ph.forEach(p => { if (!seen.has(p.display)) { seen.add(p.display); phones.push(p); } }); keep = true; } }
      const c = COORD_RE.exec(s); if (c) { keep = true; if (!coordWith) coordWith = c[1].trim(); }
      if (keep) lines.push(trimSentence(s));
    });
    return { phones, lines, coordWith };
  }
  function trimSentence(s) {
    s = s.replace(/\s+/g, " ").trim();
    if (len(s) <= HARD) return s;
    const a = Array.from(s), sp = a.slice(0, a.length - HARD).join("").length; const k = s.indexOf(" ", sp);
    return k > 0 ? "…" + s.slice(k + 1) : s;
  }

  /* ================= OSM ================= */
  const OSM_TAGS = { phone: ["phone", "contact:phone", "mobile", "contact:mobile"], email: ["email", "contact:email"], web: ["website", "contact:website", "url"], who: ["operator:he", "operator", "brand"] };
  // איחוד פרטי קשר מתגי כמה אלמנטים (חברי קבוצה): כל פרט מוצג כפי שמופיע, מנורמל, ולא מאומת. אתרים מאותו מארח מתכנסים לאחד (הקצר ביותר)
  function osmContact(tagsList, blk) {
    const phones = new Map(), emails = new Set(), urls = new Map(), who = new Set(), used = new Set();
    (tagsList || []).forEach(t => {
      if (!t || typeof t !== "object") return;
      OSM_TAGS.phone.forEach(k => { if (t[k]) phonesFromTag(t[k], blk).forEach(p => { used.add(k); if (!phones.has(p.display)) phones.set(p.display, p); }); });
      OSM_TAGS.email.forEach(k => { if (t[k]) scanEmails(t[k], blk).forEach(e => { if (!e.role) { used.add(k); emails.add(e.raw); } }); });
      OSM_TAGS.web.forEach(k => { if (t[k]) String(t[k]).split(";").forEach(u => { const c = cleanUrl(u); if (!c) return; used.add(k); const h = hostOf(c), cur = urls.get(h); if (!cur || c.length < cur.length) urls.set(h, c); }); });
      OSM_TAGS.who.forEach(k => { const v = t[k]; if (typeof v === "string" && v.trim() && !/^(disputed|yes|no|unknown)$/i.test(v.trim())) { const x = txt(v, 60); if (x) who.add(x); } });
    });
    return { phones: [...phones.values()], emails: [...emails], urls: [...urls.values()], who: [...who], tags: [...used] };
  }

  /* ================= שורות ================= */
  const blankContacts = () => ({ phones: [], emails: [], urls: [], lines: [], pairs: null, general: null });
  const fmtDist = d => d < 1000 ? Math.round(d) + " מ׳" : (d / 1000).toFixed(1) + " ק״מ";
  const DTYPE = { zone: inside => (inside ? "approval" : "report"), notam: () => "report", agri: () => "approval", airfield: () => "approval", osm: () => "update", manual: () => "approval" };
  const hasAny = c => !!(c && (c.phones.length || c.emails.length || c.urls.length || (c.general && (c.general.phones.length || c.general.emails.length))));
  const autoStatus = r => (r.manual ? "unmarked" : r.hasContact ? "unmarked" : "nocontact");
  function applyMark(r) {
    const m = r.mark || {};
    r.type = TYPES.includes(m.type) ? m.type : r.dtype;
    r.status = STATUSES.includes(m.status) ? m.status : autoStatus(r);
    r.note = typeof m.note === "string" ? m.note : "";
    return r;
  }
  function mkRow(o) {
    const c = Object.assign(blankContacts(), o.contacts || {});
    const r = { key: o.key, src: o.src, title: txt(o.title, 120), tag: txt(o.tag, 60), party: txt(o.party, 80), contacts: c, contactSrc: txt(o.contactSrc, 160), hasContact: false, dtype: o.dtype, mark: {} };
    if (o.cue) r.cue = txt(o.cue, HARD + 1);
    if (o.count > 1) r.count = o.count;
    if (c.general) r.general = true;
    r.hasContact = hasAny(c);
    return applyMark(r);
  }
  const clone = o => JSON.parse(JSON.stringify(o));
  const phoneOut = p => { const o = { raw: txt(p.raw, 40), display: txt(p.display, 40), text: txt(p.text || p.display, 48), kind: p.kind, tel: p.tel || "", range: p.range || "" }; return o; };

  // שם הפמ״ת/מהדורה בתצוגת המקור: "סעיף 1א בפמ"ת (עמ' 5, עדכון 1/25)" -> "פמ״ת א-17, סעיף 1א (עמ' 5, עדכון 1/25)"
  function srcLabel(ref, book) {
    ref = String(ref || "").trim(); let m;
    if ((m = /^סעיף (.+?) בפמ"ת \((.*)\)$/.exec(ref))) return "פמ״ת " + book + ", סעיף " + m[1] + " (" + m[2] + ")";
    if ((m = /^לשון הפמ"ת \((.*)\)$/.exec(ref))) return "פמ״ת " + book + " (" + m[1] + ")";
    if (/^לשון פרק /.test(ref)) return "פמ״ת " + ref.replace(/^לשון /, "").replace(/,? שאליו מפנה הפמ"ת$/, "");
    return ref ? "פמ״ת " + book + ", " + ref : "פמ״ת " + book;
  }
  function generalLabel(ref) {
    let m;
    if (/^סעיף 1א(?!\S)/.test(ref)) return GENERAL_LLU_LABEL;
    if ((m = /^סעיף (\S+)/.exec(ref))) return "הנחיה של הפמ״ת (סעיף " + m[1] + ")";
    if ((m = /^לשון פרק (\S+)/.exec(ref))) return "הנחיה של הפמ״ת (פרק " + m[1] + ")";
    return "הנחיה של הפמ״ת";
  }
  const uniq = (arr, f) => { const seen = new Set(), out = []; arr.forEach(x => { const k = f ? f(x) : x; if (!seen.has(k)) { seen.add(k); out.push(x); } }); return out; };
  // רשומת ציטוט מהנתונים (לא נסמכת): הטקסט הוא המקור — הפרטים נסרקים מחדש בדקדוק הנוכחי; role/ref/scope נבדקים
  function entryFacts(e, blk) {
    if (!e || typeof e !== "object" || typeof e.text !== "string" || !e.text.trim()) return null;
    if (e.role) return null;
    const sc = extract(e.text.slice(0, 1000), blk), phones = sc.phones.filter(p => !p.role), emails = sc.emails.filter(x => !x.role);
    if (!phones.length && !emails.length) return null;
    return { ref: txt(e.ref, 160), scope: e.scope === "general" ? "general" : "zone", text: txt(e.text, HARD + 1), phones, emails };
  }
  function entriesOfZone(rec, data, blk) {
    const z = rec.z || {};
    let raw;
    if (Array.isArray(z.contacts)) raw = z.contacts;
    else {   // נתונים בלי zone.contacts (מייצא ישן): סריקת ציטוט האזור עצמו; ב-LLU בלי פרט קשר משלו — פסקה 1א הכללית
      raw = quoteEntries(rec.pmt || "", { ref: rec.pmtRef || "", scope: "zone" });
      const gen = data && data.zones && data.zones.general && data.zones.general.LLU;
      if (rec.cat === "LLU" && gen && typeof gen.text === "string" && !raw.length) raw = quoteEntries(gen.text, { ref: 'סעיף 1א בפמ"ת (' + (gen.ref || "") + ")", scope: "general" });
    }
    return raw.slice(0, 40).map(e => entryFacts(e, blk)).filter(Boolean);
  }
  // משפט תיאום בלי מספר: המשפט שבו מופיעה מילת תיאום, מתחיל בסעיף הקטן שמכיל אותה ("לתיאום טיסה במרחב זה יש ליצור קשר עם מגדל רמת דוד בטלפון המפורסם בפרק א׳ 07."). לא משלימים כלום
  const NOTAM_OFFICE = /משרד\s+נוטאם/;
  const CUE_RE = /[^.\n]*?(לתיאום|ליצור קשר|יש לתאם|מחייב תיאום|תיאום מיוחד|יש לפנות)[^.\n]*\.?/;
  function cueOf(text) {
    const m = CUE_RE.exec(clean(text)); if (!m) return "";
    let s = m[0]; const k = s.indexOf(m[1]), pre = s.slice(0, k), j = Math.max(pre.lastIndexOf(", "), pre.lastIndexOf(": "), pre.lastIndexOf("; "));
    if (j >= 0) s = s.slice(j + 2);
    return s.trim();
  }
  function zoneRow(rec, inside, data, blk) {
    const b09 = rec.src === "b09", book = b09 ? "ב-09" : "א-17";
    const ents = entriesOfZone(rec, data, blk), ownLine = extract(rec.pmt || "", blk);
    const hasOwnLine = !!(ownLine.phones.filter(p => !p.role).length || ownLine.emails.filter(e => !e.role).length);
    const own = ents.filter(e => e.scope === "zone"), gen = hasOwnLine ? [] : ents.filter(e => e.scope === "general");
    const c = blankContacts();
    own.forEach(e => { e.phones.forEach(p => c.phones.push(p)); e.emails.forEach(x => c.emails.push(x.raw)); c.lines.push(e.text); });
    c.phones = uniq(c.phones, p => p.display + p.range).map(phoneOut); c.emails = uniq(c.emails, lc); c.lines = uniq(c.lines);
    if (gen.length) {
      const ownDisp = new Set(c.phones.map(p => p.display)), ownMail = new Set(c.emails.map(lc));
      const g = { label: uniq(gen, e => generalLabel(e.ref)).length === 1 ? generalLabel(gen[0].ref) : "הנחיות של הפמ״ת", src: uniq(gen.map(e => srcLabel(e.ref, book))).join("; "), phones: [], emails: [], lines: [], pairs: null };
      gen.forEach(e => { e.phones.forEach(p => { if (!ownDisp.has(p.display)) g.phones.push(p); }); e.emails.forEach(x => { if (!ownMail.has(lc(x.raw))) g.emails.push(x.raw); }); g.lines.push(e.text); if (!g.pairs) g.pairs = pairs(e.text); });
      g.phones = uniq(g.phones, p => p.display + p.range).map(phoneOut); g.emails = uniq(g.emails, lc); g.lines = uniq(g.lines);
      if (g.pairs) g.pairs = g.pairs.map(x => ({ label: txt(x.label, 30), phone: phoneOut(x.phone) }));
      if (g.phones.length || g.emails.length) c.general = g;
    }
    let cue = "";
    if (!hasAny(c)) {   // הפמ״ת מציין גורם/הפניה בלי מספר: מציגים את המשפט כלשונו, ללא השלמה ("בטלפון המפורסם בפרק א׳ 07")
      cue = b09 && rec.coord ? String(rec.coord) : cueOf(rec.pmt);
      if (NOTAM_OFFICE.test(cue)) cue = "";   // ״הגשת בקשה למשרד נוטאם״ היא הבקשה עצמה, לא גורם נוסף לתאם איתו
    }
    return mkRow({
      key: "z:" + txt(rec.id, 100), src: "zone", title: String(rec.label || rec.id) + " — " + String(rec.kind || ""), tag: inside ? "חפיפה לסגירה" : fmtDist(rec.edge) + " מקצה הסגירה",
      party: rec.src === "inpa" ? "רשות הטבע והגנים" : "", contacts: c, cue, dtype: DTYPE.zone(inside),
      contactSrc: own.length ? uniq(own.map(e => srcLabel(e.ref, book))).join("; ") : ""
    });
  }

  /* ---------- בניית הרשימה ---------- */
  // מדיניות קבוצות OSM (ברירת מחדל; ניתנת להגדרה ב-config.parties.groups): max = עד כמה פריטים בשורות נפרדות לפני איחוד לפי תווית; skip = לא נכנס; power = חשמל (קווים+עמודים בשורה אחת)
  const POLICY = {
    "מגדלים, תרנים, ארובות ועגורנים": { max: 4 }, "מבנים גבוהים": { skip: true }, "הוזן ידנית": { skip: true }, "רכבלים": { max: 4 },
    "שדות תעופה, מנחתים ובלונים": { max: 6 }, "אצטדיונים, מטווחים ואתרי המונים": { max: 6 }, "אזורים צבאיים": { max: 3 }, "כבישים ומסילות": { max: 0 },
    "מוסדות (בתי חולים, סוהר, משטרה, כיבוי)": { max: 6 }, "תעשייה ותשתיות": { max: 5 }, "קווי חשמל ותחנות": { power: true }
  };
  const CROWD = "אצטדיונים, מטווחים ואתרי המונים";
  function osmRows(res, cfg, data, blk) {
    const rows = [], pol = (grp) => { const c = cfg && cfg.parties && cfg.parties.groups && cfg.parties.groups[grp]; return Object.assign({ max: 5 }, POLICY[grp], c && typeof c === "object" ? c : {}); };
    const byId = new Map(); ((data && data.near && data.near.elements) || []).forEach(e => byId.set(e.type + "/" + e.id, e.tags || {}));
    const tagsOf = it => (it.ids || []).map(id => byId.get(id) || it.tags || {});
    const mk = (its, title, key) => {
      const oc = osmContact([].concat.apply([], its.map(tagsOf)), blk), phones = oc.phones.slice(0, 3), emails = oc.emails.slice(0, 2), urls = oc.urls.slice(0, 2);
      const c = Object.assign(blankContacts(), { phones: phones.map(phoneOut), emails, urls });
      const k = txt(key, 100);
      return mkRow({ key: k, src: "osm", title, tag: fmtDist(Math.min.apply(null, its.map(i => i.d))) + " מהנקודה", party: oc.who.join(" / "), contacts: c, dtype: "update", count: its.reduce((a, i) => a + (i.count || 1), 0),
        contactSrc: phones.length || emails.length || urls.length ? "OpenStreetMap (" + oc.tags.join(", ") + ") — לא מאומת" : "" });
    };
    const items = (res.nearScan && res.nearScan.items) || [], titleOf = i => i.title || i.label || "פריט";
    // אתרי המונים מהמצאי הרחב (מעבר לטופס, עד site_near_m): רק אם יש להם אתר/טלפון, ומתאחדים לפי מארח האתר (לונה פארק = שורה אחת)
    const byHost = new Map();
    ((res.nearScan && res.nearScan.censusOnly) || []).filter(i => i.grp === CROWD).forEach(i => {
      const oc = osmContact(tagsOf(i), blk), h = oc.urls[0] ? hostOf(oc.urls[0]) : "";
      if (h || oc.phones.length) { const k = h || ("tel:" + oc.phones[0].display); (byHost.get(k) || byHost.set(k, []).get(k)).push(i); }
    });
    byHost.forEach((its, host) => {
      its.sort((a, b) => (osmContact(tagsOf(b), blk).phones.length - osmContact(tagsOf(a), blk).phones.length) || a.d - b.d);
      rows.push(mk(its, titleOf(its[0]).replace(/\s*\(×.*$/, "") + (its.length > 1 ? " (+" + (its.length - 1) + " פריטים באותו אתר)" : ""), "h:" + host));
    });
    const groups = new Map();
    items.forEach(it => { const p = pol(it.grp); if (p.skip) return; (groups.get(it.grp) || groups.set(it.grp, []).get(it.grp)).push(it); });
    groups.forEach((its, grp) => {
      const p = pol(grp);
      if (p.power) {
        const lines = its.filter(i => /^(קו|עמוד)/.test(i.label)), rest = its.filter(i => !/^(קו|עמוד)/.test(i.label));
        if (lines.length) rows.push(mk(lines, "קווי חשמל ועמודים (" + lines.reduce((a, i) => a + (i.count || 1), 0) + " פריטים)", "g:power-lines"));
        if (rest.length > 3) rows.push(mk(rest, "תחנות משנה ומתקני חשמל (" + rest.length + ")", "g:power-other")); else rest.forEach(i => rows.push(mk([i], titleOf(i), "o:" + i.key)));
      } else if (p.max === 0 || its.length > p.max) {
        const byLabel = new Map(); its.forEach(i => (byLabel.get(i.label) || byLabel.set(i.label, []).get(i.label)).push(i));
        byLabel.forEach((ls, label) => { if (ls.length === 1 && p.max !== 0) rows.push(mk(ls, titleOf(ls[0]), "o:" + ls[0].key)); else rows.push(mk(ls, label + " (" + ls.reduce((a, i) => a + (i.count || 1), 0) + ")", "g:" + grp + "|" + label)); });
      } else its.forEach(i => rows.push(mk([i], titleOf(i).replace(/\s*\((?:×\d+[^)]*)\)/, ""), "o:" + i.key)));
    });
    return rows;
  }
  function notamRows(res, blk) {
    const rows = [], plain = [], ns = ((res.notams && res.notams.hits) || []).concat((res.notams && res.notams.obstacles) || []);
    ns.forEach(n => {
      const tag = n.relation === "overlap" ? "חפיפה לסגירה" : n.d == null ? "אין מיקום בנוטם" : fmtDist(n.edge) + " מקצה הסגירה";
      const nc = notamContacts(n.raw, blk);
      if (nc.phones.length || nc.coordWith) {
        rows.push(mkRow({ key: "n:" + txt(n.id, 40), src: "notam", title: "נוטם " + n.id, tag, party: nc.coordWith ? "מוזכר בנוטם: " + nc.coordWith : "",
          contacts: Object.assign(blankContacts(), { phones: nc.phones.map(phoneOut), lines: nc.lines.map(l => txt(l, HARD + 1)) }), contactSrc: "נוטם " + n.id, dtype: "report" }));
      } else plain.push({ n, tag });
    });
    if (plain.length) rows.push(mkRow({ key: "g:notams", src: "notam", title: "נוטמים בקרבה (" + plain.length + "): " + plain.slice(0, 8).map(x => x.n.id).join(", ") + (plain.length > 8 ? " ועוד " + (plain.length - 8) : ""),
      tag: plain.some(x => x.n.relation === "overlap") ? "חלקם חופפים לסגירה" : "בקרבה", party: "", contacts: blankContacts(), contactSrc: "", dtype: "report", count: plain.length }));
    return rows;
  }
  function agriRows(res, cfg, data, blk) {
    const th = (cfg && cfg.thresholds) || {}, ops = (data && data.agri && data.agri.operators) || {};
    return ((res.agri) || []).filter(a => a.d - res.R <= (th.agri_near_m || 3000)).map(a => {
      const phones = [], lines = [];
      (a.ops || []).forEach(o => { const t = ops[o] && ops[o].ops_office_tel; if (typeof t === "string") { const sc = scanPhones(t, blk).filter(p => !p.role); if (sc.length) { phones.push(sc[0]); lines.push(o + " — משרד מבצעים " + sc[0].text); } } });
      return mkRow({ key: "a:" + txt(a.name, 100), src: "agri", title: "מנחת חקלאי ״" + a.name + "״", tag: fmtDist(a.d - res.R) + " מקצה הסגירה", party: (a.ops || []).join(" / "),
        contacts: Object.assign(blankContacts(), { phones: uniq(phones, p => p.display).map(phoneOut), lines }), contactSrc: phones.length ? "טבלת המנחתים החקלאיים בפמ״ת" : "", dtype: "approval" });
    });
  }
  function airfieldRows(res, cfg, data, blk) {
    const th = (cfg && cfg.thresholds) || {}, have = new Set(); ((res.nearScan && res.nearScan.items) || []).forEach(i => (i.ids || []).forEach(x => have.add(x)));
    const far = new Map(); ((data && data.far && data.far.elements) || []).forEach(e => far.set(e.type + "/" + e.id, e.tags || {}));
    return ((res.airfields) || []).filter(a => a.d - res.R <= (th.airfield_near_m || 1000) && !have.has(a.id)).map(a => {
      const oc = osmContact([a.tags || far.get(a.id) || {}], blk), phones = oc.phones.slice(0, 3), emails = oc.emails.slice(0, 2), urls = oc.urls.slice(0, 2);
      return mkRow({ key: "f:" + txt(a.id, 60), src: "airfield", title: (a.type === "aerodrome" ? "שדה תעופה" : "מנחת מסוקים") + (a.name ? " ״" + a.name + "״" : "") + (a.icao ? " (" + a.icao + ")" : ""),
        tag: fmtDist(a.d - res.R) + " מקצה הסגירה" + (a.inactive ? " · לא פעיל לפי OSM" : ""), party: oc.who.join(" / "),
        contacts: Object.assign(blankContacts(), { phones: phones.map(phoneOut), emails, urls }), contactSrc: phones.length || emails.length || urls.length ? "OpenStreetMap (" + oc.tags.join(", ") + ") — לא מאומת" : "", dtype: "approval" });
    });
  }
  function buildResult(res, cfg, data) {
    if (!res || !res.zones) throw new Error("build: res חסר");
    const blk = blockFrom(cfg), failed = [], parts = [];
    const run = (name, f) => { try { parts.push.apply(parts, f()); } catch (e) { failed.push(name); } };
    run("zones", () => [].concat(res.zones.inside.map(z => zoneRow(z, true, data, blk)), res.zones.near.map(z => zoneRow(z, false, data, blk))));
    run("notams", () => notamRows(res, blk));
    run("agri", () => agriRows(res, cfg, data, blk));
    run("airfields", () => airfieldRows(res, cfg, data, blk));
    run("osm", () => osmRows(res, cfg, data, blk));
    parts.forEach(r => scrubRow(r, blk));
    // מפתחות ייחודיים (שני אתרים עם אותו שם קבוצה וכד׳): הכפילות מקבלת סיומת #2…
    const seen = new Map();
    parts.forEach(r => { const n = (seen.get(r.key) || 0) + 1; seen.set(r.key, n); if (n > 1) r.key = r.key + "#" + n; });
    let rows = parts, dropped = 0;
    const lim = Math.max(1, Math.min(LIMITS.rows, +(cfg && cfg.parties && cfg.parties.maxRows) || LIMITS.rows));
    if (rows.length > lim) {   // מעבר לתקרה: קודם נושרות שורות OSM בלי פרט קשר מהסוף, אחר כך כל שורה מהסוף
      let over = rows.length - lim; const drop = new Set();
      for (let i = rows.length - 1; i >= 0 && over > 0; i--) if (rows[i].src === "osm" && !rows[i].hasContact) { drop.add(i); over--; }
      for (let i = rows.length - 1; i >= 0 && over > 0; i--) if (!drop.has(i)) { drop.add(i); over--; }
      dropped = drop.size; rows = rows.filter((r, i) => !drop.has(i));
    }
    return { rows, dropped, failed };
  }
  const build = (res, cfg, data) => buildResult(res, cfg, data).rows;

  /* ================= ידניות ועריכה ================= */
  const FIELD_TXT = {   // שם השדה בעברית + נטיות (הערה — נקבה, פרטי הקשר — רבים)
    note: { name: "ההערה", has: "מכילה", not: "אינה", ok: "תקינה" },
    name: { name: "שם הגורם", has: "מכיל", not: "אינו", ok: "תקין" },
    contact: { name: "פרטי הקשר", has: "מכילים", not: "אינם", ok: "תקינים" }
  };
  function fieldProblem(field, v) {
    const t = FIELD_TXT[field], max = LIMITS[field];
    if (typeof v !== "string") return t.name + " " + t.not + " " + t.ok;
    if (len(v.trim()) > max) return t.name + ": עד " + max + " תווים";
    if (hasBadChar(v)) return t.name + " " + t.has + " תווים לא תקינים (למשל תווי בקרה)";
    if (field === "name" && (!v.trim() || !hasVisible(v))) return "יש להזין שם הגורם";
    if (v.trim() && !hasVisible(v)) return t.name + " " + t.not + " " + t.has + " תו גלוי";
    return "";
  }
  const num = key => { const m = /^m:(\d+)$/.exec(key); return m ? +m[1] : 0; };
  function newManual(key, f) {
    const r = { key, src: "manual", manual: true, title: f.name, tag: "", party: "", contacts: blankContacts(), contactSrc: "", hasContact: false, dtype: "approval", contact: f.contact || "", mark: {} };
    r.mark.type = TYPES.includes(f.type) ? f.type : "approval"; r.mark.status = STATUSES.includes(f.status) ? f.status : "unmarked"; r.mark.note = f.note || "";
    return applyMark(r);
  }
  function addManual(rows, init) {
    const list = rows.slice(), f = Object.assign({ name: "", contact: "", note: "" }, init || {});
    if (list.filter(r => r.manual).length >= LIMITS.manual) return { rows: list, key: "", error: "אפשר להוסיף עד " + LIMITS.manual + " גורמים ידנית" };
    for (const k of ["name", "contact", "note"]) { const e = fieldProblem(k, f[k] == null ? "" : f[k]); if (e) return { rows: list, key: "", error: e }; }
    const key = "m:" + (Math.max.apply(null, [0].concat(list.map(r => num(r.key)))) + 1);
    list.push(newManual(key, { name: f.name.trim(), contact: f.contact == null ? "" : String(f.contact).trim(), note: f.note == null ? "" : String(f.note).trim(), type: f.type, status: f.status }));
    return { rows: list, key, error: "" };
  }
  const removeManual = (rows, key) => rows.filter(r => !(r.manual && r.key === key));
  function setField(rows, key, field, value) {
    const i = rows.findIndex(r => r.key === key);
    if (i < 0) return { rows, error: "השורה לא נמצאה" };
    const r = clone(rows[i]);
    if (field === "type") { if (!TYPES.includes(value)) return { rows, error: "סוג לא מוכר" }; r.mark.type = value; }
    else if (field === "status") { if (!STATUSES.includes(value)) return { rows, error: "סטטוס לא מוכר" }; r.mark.status = value; }
    else if (field === "note") { const e = fieldProblem("note", value); if (e) return { rows, error: e }; r.mark.note = value.trim(); }
    else if ((field === "name" || field === "contact") && r.manual) {
      const e = fieldProblem(field, value); if (e) return { rows, error: e };
      if (field === "name") r.title = value.trim(); else r.contact = value.trim();
    } else return { rows, error: "שדה לא מוכר" };
    const out = rows.slice(); out[i] = applyMark(r);
    return { rows: out, error: "" };
  }

  /* ================= עזרים לממשק ================= */
  // הצעות להוספה ידנית (צ׳יפים): הלחיצה ממלאת את שם הגורם בלבד
  const SUGGESTIONS = ["רשות מקומית", "בעל הקרקע / מנהל האתר", "משטרה", "רט״ג", "גורם ביטחוני", "מגדל הבקרה", "מארגן האירוע", "שכנים וסובבים"];
  // הרשות המקומית לפי OSM: אזור boundary=administrative ברמה 6–8 (הגבוהה ביותר) — אותו חישוב של suggestSiteName בליבה. מחזיר {name, phones, emails, urls} (אתר/טלפון רק אם מופיעים בתגיות) או null
  function localAuthority(far, cfg) {
    const blk = blockFrom(cfg); let best = null, lv = 0;
    ((far && far.elements) || []).forEach(e => {
      const t = e && e.type === "area" && e.tags; if (!t) return;
      const l = parseInt(t.admin_level, 10);
      if (t.boundary === "administrative" && t.name && l >= 6 && l <= 8 && l > lv) { best = t; lv = l; }
    });
    if (!best) return null;
    const name = txt(best["name:he"] || best.name, LIMITS.name); if (!name) return null;
    const oc = osmContact([best], blk);
    return { name, phones: oc.phones.slice(0, 2).map(phoneOut), emails: oc.emails.slice(0, 2), urls: oc.urls.slice(0, 2) };
  }

  // תיאור מוכן להצגה של פרטי הקשר בשורה (אותו מבנה למסך, ל-Word ולקובץ הדרייב): none = אין פרט קשר (להציג ״לא נמצא פרט קשר״ + cue אם יש);
  // blocks = [{label, phones, emails, urls, lines, pairs, src}] — קודם פרטי הגורם עצמו (label ""), אחר כך ההנחיה הכללית (label = התווית). max = תקרת קטעים מצוטטים כוללת (ב-Word: 3);
  // more = כמה קטעים מצוטטים לא נכללו ("ועוד N"). כשיש pairs — מציגים אותם במקום lines. שורה ידנית: פרטי הקשר שהוקלדו כקטע אחד
  function describe(row, opt) {
    const max = opt && opt.max > 0 ? opt.max : Infinity, r = row || {}, c = r.contacts || blankContacts(), blocks = [];
    let left = max, more = 0;
    const take = (lines, pairs) => { if (pairs) { if (left > 0) { left--; return { lines: [], pairs }; } more++; return { lines: [], pairs: null }; } const out = lines.slice(0, left); left -= out.length; more += lines.length - out.length; return { lines: out, pairs: null }; };
    if (r.manual) {
      if (r.contact) blocks.push({ label: "", phones: [], emails: [], urls: [], lines: [r.contact], pairs: null, src: "" });
    } else {
      if (c.phones.length || c.emails.length || c.urls.length || c.lines.length) { const t = take(c.lines, c.pairs); blocks.push({ label: "", phones: c.phones, emails: c.emails, urls: c.urls, lines: t.lines, pairs: t.pairs, src: r.contactSrc || "" }); }
      if (c.general) { const g = c.general, t = take(g.lines, g.pairs); blocks.push({ label: g.label, phones: g.phones, emails: g.emails, urls: [], lines: t.lines, pairs: t.pairs, src: g.src }); }
    }
    const none = r.manual ? !r.contact : !r.hasContact;
    return { none, cue: none && r.cue ? r.cue : "", blocks, more };
  }

  /* ================= סיכום ================= */
  function summary(rows) {
    const s = { total: 0, done: 0, needed: 0, unmarked: 0, nocontact: 0, notneeded: 0 };
    (rows || []).forEach(r => { s.total++; if (s[r.status] != null) s[r.status]++; });
    return s;
  }
  const countWord = (n, one, many) => (n === 1 ? one : n + " " + many);
  function summaryText(s) {
    if (!s || !s.total) return "לא נמצאו גורמים";
    const parts = [];
    if (s.done) parts.push(s.done + " " + (s.done === 1 ? "דווח/התקבל אישור" : "דווחו/התקבל אישור"));
    if (s.needed) parts.push(s.needed + " נדרש");
    if (s.unmarked) parts.push(s.unmarked + " " + (s.unmarked === 1 ? "טרם סומן" : "טרם סומנו"));
    if (s.nocontact) parts.push(s.nocontact + " לא נמצא איש קשר");
    if (s.notneeded) parts.push(s.notneeded + " אין צורך");
    return countWord(s.total, "גורם אחד", "גורמים") + (parts.length ? " — " + parts.join(" · ") : "");
  }
  function mailLine(s) {
    if (!s || !s.total) return "דיווח לגורמים נוספים: לא נמצאו גורמים";
    return "דיווח לגורמים נוספים: " + countWord(s.total, "גורם אחד", "גורמים") + (s.done ? " — " + s.done + " " + (s.done === 1 ? "דווח/התקבל אישור" : "דווחו/התקבל אישור") : "");
  }

  /* ================= מיזוג בין הרצות ================= */
  const sig = r => JSON.stringify([r.title, r.party, r.contacts]);
  function fromMarks(m) {
    const out = [];
    if (!m || typeof m !== "object") return out;
    const marks = m.marks && typeof m.marks === "object" ? m.marks : {};
    (Array.isArray(m.keys) ? m.keys : []).slice(0, 120).forEach(key => { if (typeof key === "string" && KEY_RE.test(key) && !/^m:/.test(key) && !marks[key]) out.push({ key, src: "zone", title: key, tag: "", party: "", contacts: blankContacts(), contactSrc: "", hasContact: false, dtype: "update", mark: {}, stub: true, keyOnly: true }); });
    Object.keys(marks).forEach(key => {
      if (!KEY_RE.test(key) || /^m:/.test(key)) return;
      const k = marks[key] || {}, r = { key, src: SRCS.includes(k.src) ? k.src : "zone", title: txt(k.title || key, 120), tag: "", party: "", contacts: blankContacts(), contactSrc: "", hasContact: false, dtype: "update", mark: cleanMark(k), stub: true };
      out.push(applyMark(r));
    });
    (Array.isArray(m.manual) ? m.manual : []).slice(0, LIMITS.manual).forEach(x => { const r = cleanManual(x); if (r) out.push(r); });
    return out;
  }
  function merge(prev, fresh) {
    const P = Array.isArray(prev) ? prev : fromMarks(prev), F = Array.isArray(fresh) ? fresh : [];
    const pm = new Map(); P.forEach(r => { if (!r.manual) pm.set(r.key, r); });
    const hadScan = pm.size > 0, freshKeys = new Set(F.map(r => r.key)), out = [];
    F.forEach(r => {
      const n = clone(r), p = pm.get(r.key);
      delete n.isNew; delete n.updated; delete n.stale;
      if (p) { n.mark = clone(p.mark || {}); if (!p.stub && !p.stale && sig(p) !== sig(n)) n.updated = true; }
      else if (hadScan) n.isNew = true;
      out.push(applyMark(n));
    });
    let stale = 0;
    P.forEach(p => {
      if (p.manual || freshKeys.has(p.key)) return;
      const m = p.mark || {};
      if ((m.status === "done" || (typeof m.note === "string" && m.note.trim())) && stale < LIMITS.stale) { const n = clone(p); delete n.isNew; delete n.updated; delete n.stub; n.stale = true; out.push(applyMark(n)); stale++; }
    });
    P.forEach(p => { if (p.manual) { const n = clone(p); delete n.isNew; delete n.updated; delete n.stale; out.push(applyMark(n)); } });
    return out;
  }

  /* ================= רשומה לשמירה (דרייב / דפדפן) ובדיקה מחדש ================= */
  const KEY_RE = /^[a-z]:[^\u0000-\u001f\u007f\u2028\u2029]{1,110}$/;
  function cleanMark(m) {
    const o = {}; if (!m || typeof m !== "object") return o;
    if (TYPES.includes(m.type)) o.type = m.type;
    if (STATUSES.includes(m.status)) o.status = m.status;
    if (typeof m.note === "string") { const n = txt(m.note, LIMITS.note); if (n) o.note = n; }
    return o;
  }
  function cleanManual(x) {
    if (!x || typeof x !== "object" || typeof x.key !== "string" || !/^m:\d{1,6}$/.test(x.key)) return null;
    const name = txt(typeof x.title === "string" ? x.title : str(x.name), LIMITS.name);
    if (!name || !hasVisible(name)) return null;
    const r = newManual(x.key, { name, contact: txt(str(x.contact), LIMITS.contact), note: "", type: x.mark && x.mark.type != null ? x.mark.type : x.type, status: x.mark && x.mark.status != null ? x.mark.status : x.status });
    const note = x.mark && typeof x.mark.note === "string" ? x.mark.note : x.note;
    r.mark.note = typeof note === "string" ? txt(note, LIMITS.note) : "";
    return applyMark(r);
  }
  // טלפון משוחזר: תמיד נגזר מחדש מ-raw/display (לא נסמכים על tel/kind שבקובץ); לא ישראלי תקין => "unverified" רק אם נראה כמספר
  function cleanPhone(p, blk) {
    if (!p || typeof p !== "object") return null;
    const src = txt(p.raw != null ? p.raw : p.display, 40), rng = /^\/\d{1,3}$/.test(String(p.range || "")) ? p.range : "";
    if (p.kind === "unverified") { const v = phonesFromTag(src, blk)[0]; return v && v.kind === "unverified" ? phoneOut(v) : (v ? phoneOut(Object.assign({}, v, { range: "", text: v.display })) : null); }
    const ph = scanPhones(src + " " + txt(p.display, 40), blk).filter(x => !x.role)[0] || scanPhones(txt(p.display, 40), blk).filter(x => !x.role)[0];
    if (!ph) return null;
    const o = phoneOut(ph); if (rng) { o.range = rng; o.text = o.display + rng; o.tel = ""; }
    return o;
  }
  function cleanContacts(c, blk) {
    const o = blankContacts(); if (!c || typeof c !== "object") return o;
    const arr = a => (Array.isArray(a) ? a.slice(0, 12) : []);
    o.phones = uniq(arr(c.phones).map(p => cleanPhone(p, blk)).filter(Boolean), p => p.text);
    o.emails = uniq(arr(c.emails).map(e => (typeof e === "string" ? scanEmails(e.slice(0, 200), blk).filter(x => !x.role).map(x => x.raw)[0] : null)).filter(Boolean), lc);
    o.urls = uniq(arr(c.urls).map(u => (typeof u === "string" ? cleanUrl(u) : null)).filter(Boolean));
    o.lines = arr(c.lines).filter(l => typeof l === "string").map(l => txt(l, HARD + 1)).filter(Boolean);
    if (Array.isArray(c.pairs)) { const ps = c.pairs.slice(0, 12).map(x => { const ph = x && cleanPhone(x.phone, blk), lb = x && txt(x.label, 30); return ph && lb ? { label: lb, phone: ph } : null; }); if (ps.length >= 2 && ps.every(Boolean)) o.pairs = ps; }
    const g = c.general;
    if (g && typeof g === "object") {
      const gg = { label: txt(str(g.label), 100), src: txt(str(g.src), 200), phones: [], emails: [], lines: [], pairs: null };
      const t = cleanContacts({ phones: g.phones, emails: g.emails, lines: g.lines, pairs: g.pairs }, blk);
      gg.phones = t.phones; gg.emails = t.emails; gg.lines = t.lines; gg.pairs = t.pairs;
      if (gg.phones.length || gg.emails.length) o.general = gg;
    }
    return o;
  }
  const str = v => (typeof v === "string" ? v : "");   // בשחזור: רק מחרוזות אמיתיות (מספר/אובייקט/מערך אינם מומרים למחרוזת)
  function cleanRow(x, blk) {
    if (!x || typeof x !== "object" || typeof x.key !== "string" || !KEY_RE.test(x.key) || /^m:/.test(x.key)) return null;
    const src = SRCS.includes(x.src) && x.src !== "manual" ? x.src : "zone", title = txt(str(x.title), 120);
    if (!title) return null;
    const c = cleanContacts(x.contacts, blk);
    const r = { key: x.key, src, title, tag: txt(str(x.tag), 60), party: txt(str(x.party), 80), contacts: c, contactSrc: txt(str(x.contactSrc), 160), hasContact: hasAny(c), dtype: TYPES.includes(x.dtype) ? x.dtype : DTYPE[src](false), mark: cleanMark(x.mark) };
    if (txt(str(x.cue))) r.cue = txt(str(x.cue), HARD + 1);
    if (x.count > 1 && isFinite(x.count)) r.count = Math.min(99999, Math.floor(x.count));
    if (c.general) r.general = true;
    if (x.stale === true) r.stale = true;
    return applyMark(scrubRow(r, blk));
  }
  function restore(rec, cfg) {
    try {
      if (!rec || typeof rec !== "object") return [];
      const blk = blockFrom(cfg), seen = new Set(), out = [];
      (Array.isArray(rec.rows) ? rec.rows : []).slice(0, LIMITS.rows + LIMITS.stale).forEach(x => { const r = cleanRow(x, blk); if (r && !seen.has(r.key)) { seen.add(r.key); out.push(r); } });
      (Array.isArray(rec.manual) ? rec.manual : []).slice(0, LIMITS.manual).forEach(x => { const r = cleanManual(x); if (r && !seen.has(r.key)) { seen.add(r.key); out.push(r); } });
      return out;
    } catch (e) { return []; }
  }
  const outRow = r => {
    const o = { key: r.key, src: r.src, title: r.title, tag: r.tag, party: r.party, contacts: r.contacts, contactSrc: r.contactSrc, hasContact: r.hasContact, dtype: r.dtype, mark: r.mark, type: r.type, status: r.status, note: r.note };
    if (r.cue) o.cue = r.cue; if (r.count) o.count = r.count; if (r.general) o.general = true; if (r.stale) o.stale = true;
    return o;
  };
  function record(rows, opts) {
    const list = rows || [], now = opts && opts.now instanceof Date && isFinite(+opts.now) ? opts.now : null;
    return {
      v: VERSION, builtAt: now ? now.toISOString() : "", summary: summary(list),
      rows: list.filter(r => !r.manual).map(outRow),
      manual: list.filter(r => r.manual).map(r => ({ key: r.key, title: r.title, contact: r.contact || "", type: r.type, status: r.status, note: r.note }))
    };
  }
  // צורה קומפקטית לשמירה בדפדפן: רק מה שהמטיס סימן (ובשורות שסומנו "דווח"/הערה — גם הכותרת, כדי שאפשר יהיה להציג "מחוץ לטווח" אם הן ייעלמו מהסריקה) + הידניות
  function marks(rows) {
    const out = { keys: [], marks: {}, manual: [] };
    (rows || []).forEach(r => {
      if (!r.manual && out.keys.length < 120) out.keys.push(r.key);
      if (r.manual) { if (out.manual.length < LIMITS.manual) out.manual.push({ key: r.key, title: r.title, contact: r.contact || "", type: r.type, status: r.status, note: r.note }); return; }
      const m = cleanMark(r.mark); if (!Object.keys(m).length) return;
      const e = Object.assign({}, m); if (m.status === "done" || m.note) { e.title = txt(r.title, 120); e.src = r.src; }
      out.marks[r.key] = e;
    });
    return out;
  }

  return {
    VERSION, LIMITS, TYPES, STATUSES, TYPE_LABEL, STATUS_LABEL, STATUS_ICON, GENERAL_LLU_LABEL, TEXT, POLICY,
    enabled, fingerprint,
    extract, scanPhones, scanEmails, pairs, cueOf, cleanUrl, phonesFromTag, osmContact, quoteEntries, notamContacts, notamE, segments, validate, srcLabel, generalLabel,
    build, buildResult, merge, setField, addManual, removeManual, summary, summaryText, mailLine, record, restore, marks, SUGGESTIONS, localAuthority, describe, cueOf, notamContacts,
    txt, hasBadChar, hasVisible, scrub
  };
});
