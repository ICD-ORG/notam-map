/* ReqPartiesUI — עורך "דיווח לגורמים נוספים" (שלב ב׳, features.parties): הצמד בין מנוע הגורמים (js/parties.js, טהור) לבין הדף (ui.js). UMD כמו myreq.js: המצב והשמירה בדפדפן טהורים ורצים גם ב-Node; ה-DOM (mount, render, אירועים) — בדפדפן בלבד.
   מה הוא עושה: בונה את הרשימה אחרי כל הרצה (rebuild) ומעבירה ב-P.merge מול הסימונים הקודמים של אותה בקשה; מציג עורך בכרטיס "4 · סקירה" (כרטיס לכל גורם: סוג, סטטוס, הערה; הוספה ידנית; "הצג רק פתוחות");
   נותן ל-ui.js את מה שהעמוד, המייל וקובץ נתוני הבקשה צריכים (modelOpts / mailOpts / record). לא חוסם מוכנות לעולם (S.ready ו-refreshGate לא נוגעים בו), לא שואל ולא מתריע.
   כללי ברזל: (1) דגל config.features.parties === false (מפתח חסר = פעיל), או parties.js לא נטען, או ui.js לא חיבר hook.changed ← אין DOM, אין סגנון, אין אחסון ואין פלט (modelOpts/mailOpts/record מחזירים ריק): ההתנהגות זהה לשלב א׳;
   (2) כל מחרוזת שמגיעה ממקור (פמ״ת, נוטם, OSM, שדה שהמטיס הקליד, אחסון) נכנסת ל-HTML רק דרך E (ואסימונים לטיניים בתוך <bdi dir=ltr>), ולעולם לא ל-innerHTML גולמי; קישור tel: רק למספר חד-משמעי (TEL_RE), קישור אתר רק אחרי P.cleanUrl;
   (3) כל עריכה שמשנה את ה-Word עוברת hook.changed() (= onSoftInputChange של ui.js: clearOutcome, נעילת הלחצנים עד הרינדור מחדש, שמירה אוטומטית בדרייב לפי אותו תזמון של שאר השדות הרכים) — כך הקובץ בדרייב זהה למה שעל המסך;
   (4) נשמר בדפדפן רק כנוחות (try/catch, ללא טיימרים — כתיבה סינכרונית דרך hook.store של ui.js, שהמפתח שלה לפי המשתמש), נכשל = אין שחזור; תקרות: 20 בקשות, 60KB; (5) התנתקות / החלפת משתמש ← reset(): לא נשאר דבר בזיכרון ובדף.

   ===== API =====
   hook({changed, store:{get,set,del}, now?})   ui.js מחבר: changed() נקרא אחרי כל עריכה; store = אחסון לפי המשתמש (icd_req_parties_v1:<גיבוב>);  mount(cfg) — יוצר את הכרטיס (#partiesBox) לפני ההצהרה; false וללא DOM כשהדגל כבוי
   rebuild(res, data, cfg)                     אחרי C.analyze (run / reanalyze): P.buildResult + P.merge מול הזיכרון (אותו fp) או האחסון בדפדפן; שומר; מרנדר. data = אותו אובייקט שהועבר ל-C.analyze
   rows(res) / modelOpts(res) / mailOpts(res) / record(res)   null/{}/null/null כשהדגל כבוי, או כשהשורות אינן של הניתוח הנוכחי;  modelOpts → {parties, partiesDropped, partiesFailed} ל-O.docxModel;  mailOpts → {parties} ל-O.mail;  record → P.record ל-inputsForRecord
   setField(key, field, value) / addManual(init) / removeManual(key)   עריכה (מחזירות {ok, error, key?}); reset() — מנקה זיכרון ו-DOM;  wipe() — מוחק את האחסון של המשתמש;  state() — עותק לקריאה
   טהורים (לבדיקות): E, ltrHtml, telHref, cardHtml, listHtml, storeParse / storeWrite / storeRead, isOpen, STORE, TEL_RE, HELP, STR */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./parties.js"));
  else root.ReqPartiesUI = factory(root.ReqParties);
})(typeof self !== "undefined" ? self : this, function (P) {
  "use strict";

  const doc = typeof document !== "undefined" ? document : null, byId = id => (doc ? doc.getElementById(id) : null);
  const STR = {
    lead: "גורמים שייתכן שצריך לתאם איתם, לדווח להם או לעדכן אותם.",
    add: "הוסף גורם", draft: "גורם חדש", name: "שם הגורם", contact: "פרטי קשר", type: "סוג", status: "סטטוס", note: "הערה", ok: "הוסף", cancel: "ביטול", rm: "הסר", suggest: "הצעות:",
    onlyOpen: "הצג רק פתוחות", shown: (n, t) => "מוצגות " + n + " מתוך " + t, manualTag: "ידני", manualN: n => "גורם ידני " + n,
    added: n => "נוסף גורם " + n, removed: n => "הוסר גורם " + n, partial: names => "לא נסרקו כל המקורות (" + names + "). אפשר להוסיף גורמים ידנית.", reverted: "הוחזר הערך הקודם",
    always: "עמוד ״דיווח לגורמים נוספים״ נכלל תמיד", wipeNote: " כמו כן נמחקים הסימונים השמורים של ״דיווח לגורמים נוספים״ (הרשימה שעל המסך נשארת).", chipAuth: "רשות מקומית: "
  };
  // שמות מקורות שנכשלו בבנייה (P.buildResult.failed) להודעה למטיס
  const SRC_NAME = { zones: "אזורים", notams: "נוטמים", agri: "מנחתים חקלאיים", airfields: "שדות תעופה", osm: "OpenStreetMap" };
  // ההסבר ללחצן ״!״: מתאר מה הרשימה עושה בפועל בקוד (js/parties.js, output.js, docx.js, ui.js)
  const HELP = "רשימה של גורמים שייתכן שצריך לתאם איתם, לדווח להם או לעדכן אותם: אזורי איסור וגנים, נוטמים, מנחתים חקלאיים ומה שנמצא בסביבה במפה. המערכת מעתיקה פרטי קשר כלשונם מהמקורות (פמ״ת, נוטמים, OpenStreetMap, טבלת המנחתים) — הם אינם מאומתים, ויש לוודא אותם. לכל גורם בוחרים סוג וסטטוס וכותבים הערה, ואפשר להוסיף גורם ידנית (עד 20). " +
    "הסימונים הם שלכם בלבד: המערכת לא פונה לאף גורם ולא בודקת שדווח לו. הרשימה מצורפת כעמוד נפרד לקובץ ה-Word, להדפסה ולבקשה שנשלחת למודיעין טיס, גם כשסימון ״כולל דף בדיקות״ כבוי; בגוף המייל מופיעה שורה אחת עם ספירה בלבד, בלי שמות וטלפונים, וקובץ נתוני הבקשה שנשמר בארכיון המערכת כולל את כל הפרטים. " +
    "הרשימה אינה מונעת שמירה או שליחה ואין חובה להשלים אותה. הסימונים נשמרים בדפדפן הזה בלבד, לפי החשבון והבקשה, וחוזרים בהרצה חוזרת של אותה בקשה (אותו מקום ואותם תאריכים).";

  /* ================= עזרים טהורים ================= */
  const E = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
    // טקסט ל-HTML: escape, ואסימונים לטיניים/ספרתיים (טלפון, דוא״ל, אתר, מזהה) בתוך <bdi dir="ltr"> כדי שלא יתהפכו בפסקה מימין לשמאל (אותו עיקרון כמו ב-output.js ltrHtml)
  const LTR_TOK = /[A-Za-z0-9]+(?:(?:[-.\/:@_%+=&?#~]|:\/\/)[A-Za-z0-9]+)*\/?/g;
  const ltrHtml = t => { t = String(t == null ? "" : t); let o = "", i = 0; t.replace(LTR_TOK, (m, at) => { o += E(t.slice(i, at)) + '<bdi dir="ltr">' + E(m) + "</bdi>"; i = at + m.length; return m; }); return o + E(t.slice(i)); };
  // קישור tel: רק למספר חד-משמעי: ישראלי מלא (+972 ו-8–9 ספרות) או קו שירות (1-700/800/599); לא סיומת מקוצרת ("073-3636954/5"), לא "לא אומת" ולא כל ערך אחר שהגיע מהנתונים
  const TEL_RE = /^tel:(?:\+972\d{8,9}|1(?:700|800|599)\d{6})$/;
  const telHref = p => (p && typeof p === "object" && typeof p.tel === "string" && p.kind !== "unverified" && !p.range && TEL_RE.test(p.tel) ? p.tel : "");
  const urlHref = u => (P && typeof u === "string" ? P.cleanUrl(u) || "" : "");
  const SRC_LABEL = { zone: "פמ״ת", notam: "נוטם", agri: "מנחת חקלאי", airfield: "שדה תעופה", osm: "OpenStreetMap", manual: "ידני" };
  const srcLabel = r => (r && r.src === "zone" && r.party === "רשות הטבע והגנים" ? "רט״ג" : own(SRC_LABEL, r && r.src) ? SRC_LABEL[r.src] : "");
  const ORDER = ["unmarked", "needed", "done", "nocontact", "notneeded"];   // סדר הסטטוסים בתיבה: טרם סומן ראשון
  const statuses = () => (P ? ORDER.filter(s => P.STATUSES.includes(s)).concat(P.STATUSES.filter(s => !ORDER.includes(s))) : []);
  const typeOpts = sel => P.TYPES.map(t => '<option value="' + E(t) + '"' + (t === sel ? " selected" : "") + ">" + E(P.TYPE_LABEL[t]) + "</option>").join("");
  const statusOpts = sel => statuses().map(s => '<option value="' + E(s) + '"' + (s === sel ? " selected" : "") + ">" + E(P.STATUS_ICON[s] + " " + P.STATUS_LABEL[s]) + "</option>").join("");
  // שורה "פתוחה" = לא הוסתרה ב"הצג רק פתוחות": ידנית, או סטטוס שאינו "אין צורך" / "לא נמצא איש קשר", או שנכתבה בה הערה
  const isOpen = r => !!r && (!!r.manual || (r.status !== "notneeded" && r.status !== "nocontact") || !!(typeof r.note === "string" && r.note.trim()));

  /* ---------- HTML של כרטיס ---------- */
  function phoneHtml(p) {
    p = p && typeof p === "object" ? p : {};
    const bdi = '<bdi dir="ltr">' + E(P.txt(p.text || p.display || p.raw || "", 60)) + "</bdi>", href = telHref(p);
    return (href ? '<a class="pty-tel" href="' + E(href) + '" dir="ltr">' + bdi + "</a>" : '<span class="pty-ph">' + bdi + "</span>") + (p.kind === "unverified" ? ' <span class="pty-un">(' + E(P.TEXT.unverified) + ")</span>" : "");
  }
  function urlHtml(u) {
    const h = urlHref(u), t = '<bdi dir="ltr">' + E(P.txt(u, 120)) + "</bdi>";
    return h ? '<a class="pty-url" href="' + E(h) + '" target="_blank" rel="noopener noreferrer" dir="ltr">' + t + "</a>" : '<span class="pty-ph">' + t + "</span>";
  }
  function blockHtml(b) {
    b = b || {}; const out = [];
    if (b.label) out.push('<b class="pty-bl">' + ltrHtml(P.txt(b.label, 120)) + ":</b>");
    if (Array.isArray(b.pairs)) out.push('<ul class="pty-pairs">' + b.pairs.map(x => "<li>" + ltrHtml(P.txt(x && x.label, 40)) + " " + phoneHtml(x && x.phone) + "</li>").join("") + "</ul>");
    else {
      const items = [].concat((b.phones || []).map(phoneHtml), (b.emails || []).map(e => '<bdi class="pty-em" dir="ltr">' + E(P.txt(e, 120)) + "</bdi>"), (b.urls || []).map(urlHtml));
      if (items.length) out.push('<div class="pty-items">' + items.map(x => '<span class="pty-it">' + x + "</span>").join(" ") + "</div>");
    }
    (b.lines || []).forEach(l => out.push('<p class="pty-q">' + ltrHtml(P.txt(l, 240)) + "</p>"));
    if (b.src) out.push('<span class="pty-s">' + E(P.TEXT.srcPrefix) + ltrHtml(P.txt(b.src, 200)) + "</span>");
    return '<div class="pty-b">' + out.join("") + "</div>";
  }
  function contactHtml(r) {
    let d; try { d = P.describe(r); } catch (e) { d = { none: true, cue: "", blocks: [] }; }   // שורה פגומה לא מפילה את העורך
    if (d.none) return '<div class="pty-b"><p class="pty-none">' + E(P.TEXT.noContact) + "</p>" + (d.cue ? '<p class="pty-q">' + ltrHtml(P.txt(d.cue, 240)) + "</p>" : "") + "</div>";
    return d.blocks.map(blockHtml).join("");
  }
  // כרטיס אחד. n = מספר השורה ברשימה המלאה (קבוע גם כשהסינון מסתיר שורות — כמו בעמוד ה-Word). ids לפי המספר, לא לפי המפתח (המפתח עלול להכיל כל תו; הוא רק ב-data-key, מוגן)
  function cardHtml(r, n) {
    r = r || {};
    const st = P.STATUSES.includes(r.status) ? r.status : "unmarked", ty = P.TYPES.includes(r.type) ? r.type : "approval", tid = "ptyT" + n, eid = "ptyE" + n, man = !!r.manual;
    const flags = (r.isNew ? '<span class="pty-flag">חדש</span>' : "") + (r.updated ? '<span class="pty-flag">' + E(P.TEXT.updated) + "</span>" : "") + (r.stale ? '<span class="pty-flag">' + E(P.TEXT.outOfRange) + "</span>" : "");
    const sl = srcLabel(r);
    const num = '<span class="pty-n" aria-hidden="true">' + n + ".</span> ";   // המספר בתוך הכותרת (נשבר איתה בשורה אחת), ומחוץ לשם הנגיש של הקבוצה
    const head = '<div class="pty-h">' +
      (man ? num + '<span class="vh" id="' + tid + '">' + E(STR.manualN(n)) + '</span><span class="pty-manual">' + E(STR.manualTag) + "</span>"
        : '<b class="pty-t" id="' + tid + '">' + num + ltrHtml(P.txt(r.title, 120)) + "</b>" + (r.count > 1 ? ' <span class="pty-tag">' + E(r.count) + " פריטים</span>" : "") + (r.tag ? ' <span class="pty-tag">' + ltrHtml(P.txt(r.tag, 60)) + "</span>" : "") + (sl ? ' <span class="pty-srcc">' + E(sl) + "</span>" : "")) +
      flags + (man ? '<button type="button" class="pty-rm" data-act="rm" aria-label="' + E(STR.rm + " " + STR.manualN(n)) + '">' + E(STR.rm) + "</button>" : "") + "</div>";
    const mid = man
      ? '<div class="pty-m"><label class="pty-l"><span>' + E(STR.name) + '</span><input type="text" data-f="name" maxlength="80" autocomplete="off" aria-describedby="' + eid + '" value="' + E(r.title) + '"></label>' +
        '<label class="pty-l"><span>' + E(STR.contact) + '</span><input type="text" data-f="contact" maxlength="120" autocomplete="off" aria-describedby="' + eid + '" value="' + E(r.contact || "") + '"></label></div>'
      : (r.party ? '<p class="pty-party">' + ltrHtml(P.txt(r.party, 80)) + "</p>" : "") + '<div class="pty-c">' + contactHtml(r) + "</div>";
    return '<li class="pty" role="group" aria-labelledby="' + tid + '" data-key="' + E(r.key) + '" data-st="' + E(st) + '">' + head + mid +
      '<div class="pty-f"><label class="pty-l"><span>' + E(STR.type) + '</span><select data-f="type">' + typeOpts(ty) + "</select></label>" +
      '<label class="pty-l"><span>' + E(STR.status) + ' <span class="pty-ic" aria-hidden="true">' + E(P.STATUS_ICON[st]) + '</span></span><select data-f="status">' + statusOpts(st) + "</select></label>" +
      '<label class="pty-l pty-ln"><span>' + E(STR.note) + '</span><input type="text" data-f="note" maxlength="' + P.LIMITS.note + '" autocomplete="off" aria-describedby="' + eid + '" value="' + E(r.note || "") + '"></label></div>' +
      '<p class="err pty-e" id="' + eid + '"></p></li>';
  }
  // o: {onlyOpen}. השורות המוסתרות בסינון לא נמחקות — רק לא מוצגות; המספור קבוע
  function listHtml(rows, o) {
    rows = Array.isArray(rows) ? rows : []; o = o || {};
    return rows.map((r, i) => (o.onlyOpen && !isOpen(r) ? "" : cardHtml(r, i + 1))).join("");
  }

  /* ---------- אחסון בדפדפן (טהור: מחרוזת → מחרוזת; ui.js נותן את ה-get/set לפי המשתמש) ---------- */
  // { [fp]: {t, keys, marks, manual} }, עד 20 בקשות (הישנה ביותר נמחקת) ועד 60KB. המפתח fp = P.fingerprint (נקודה ומועדים); כל מפתח אחר, וכל ערך שאינו אובייקט, נזרק. התוכן עצמו מנוקה שוב ב-P.merge (fromMarks)
  const STORE = { entries: 20, bytes: 60000, raw: 200000 };
  const FP_RE = /^-?\d{1,3}(?:\.\d{1,6})?,-?\d{1,3}(?:\.\d{1,6})?,(?:\d{4}-\d\d-\d\d)?,(?:\d{4}-\d\d-\d\d)?$/;
  function storeParse(raw) {
    const map = Object.create(null);   // בלי אב-טיפוס: מפתח כמו __proto__ לא משפיע על דבר
    try {
      if (typeof raw !== "string" || !raw || raw.length > STORE.raw) return map;
      const o = JSON.parse(raw); if (!o || typeof o !== "object" || Array.isArray(o)) return map;
      Object.keys(o).forEach(fp => {
        const e = o[fp]; if (!FP_RE.test(fp) || !e || typeof e !== "object" || Array.isArray(e)) return;
        const t = +e.t;
        map[fp] = { t: isFinite(t) && t > 0 ? t : 0, keys: Array.isArray(e.keys) ? e.keys : [], marks: e.marks && typeof e.marks === "object" && !Array.isArray(e.marks) ? e.marks : {}, manual: Array.isArray(e.manual) ? e.manual : [] };
      });
    } catch (e) { /* אחסון פגום = אין שחזור */ }
    return map;
  }
  const storeRead = (raw, fp) => { const m = storeParse(raw); return own(m, fp) ? m[fp] : null; };
  // מחזיר את המחרוזת החדשה לכתיבה ("" = למחוק את המפתח). now = מילי-שניות. הרשומה הנוכחית אינה נמחקת בגלל התקרות, אלא אם היא לבדה חורגת מ-60KB
  function storeWrite(raw, fp, rows, now) {
    const map = storeParse(raw);
    if (FP_RE.test(fp)) { const m = P.marks(rows); map[fp] = { t: +now || 0, keys: m.keys, marks: m.marks, manual: m.manual }; }
    const order = () => Object.keys(map).sort((a, b) => map[b].t - map[a].t), enc = () => (Object.keys(map).length ? JSON.stringify(map) : "");
    if (own(map, fp) && JSON.stringify(map[fp]).length + fp.length + 6 > STORE.bytes) { delete map[fp]; return enc(); }   // הנוכחית לבדה מעל התקרה: היא נמחקת, ושאר הבקשות נשארות (לא מפנים אותן לחינם)
    order().slice(STORE.entries).forEach(k => { if (k !== fp) delete map[k]; });
    while (Object.keys(map).length > STORE.entries) { const old = order().filter(k => k !== fp).pop(); if (old === undefined) break; delete map[old]; }
    let s = enc();
    while (s.length > STORE.bytes) {
      const old = order().filter(k => k !== fp).pop();
      if (old === undefined) { delete map[fp]; return enc(); }
      delete map[old]; s = enc();
    }
    return s;
  }

  /* ================= מצב ================= */
  let HK = null, CFG = null;
  const ST = { res: null, fp: "", rows: [], built: false, failed: [], dropped: 0, news: 0, onlyOpen: false, far: null };
  const on = cfg => !!(P && typeof P.buildResult === "function" && typeof P.describe === "function" && P.enabled(cfg));
  const hooked = () => !!(HK && typeof HK.changed === "function");
  const live = () => ST.built && on(CFG) && hooked();
  const nowDate = () => { try { const d = HK && HK.now ? HK.now() : new Date(); return d instanceof Date && isFinite(+d) ? d : new Date(); } catch (e) { return new Date(); } };
  function clear() { ST.res = null; ST.fp = ""; ST.rows = []; ST.built = false; ST.failed = []; ST.dropped = 0; ST.news = 0; ST.far = null; }
  function persist() {
    try {
      if (!HK || !HK.store || !ST.built || !ST.fp) return;
      const s = storeWrite(HK.store.get(), ST.fp, ST.rows, nowDate().getTime());
      if (s) HK.store.set(s); else HK.store.del();
    } catch (e) { /* נוחות בלבד */ }
  }
  function notify() { try { if (HK && typeof HK.changed === "function") HK.changed(); } catch (e) { /* עריכה שלא הגיעה ל-ui.js לא מפילה את העורך */ } }

  function rebuild(res, data, cfg) {
    if (cfg !== undefined) CFG = cfg;
    if (!on(CFG) || !hooked() || !res || !res.zones) { clear(); render(); return false; }
    const fp = P.fingerprint(res.inp || {});
    let prev = null;
    if (ST.built && ST.fp === fp) prev = ST.rows;                       // אותה בקשה (הרצה חוזרת / תוספת ידנית): הסימונים שבזיכרון
    else { try { prev = HK.store ? storeRead(HK.store.get(), fp) : null; } catch (e) { prev = null; } }   // בקשה אחרת / דף שנטען מחדש: מה שנשמר בדפדפן
    let fresh = [], failed = [], dropped = 0;
    try { const b = P.buildResult(res, CFG, data); fresh = b.rows; failed = b.failed || []; dropped = b.dropped || 0; } catch (e) { failed = ["*"]; }   // כשל כללי ("*"): נשארות הידניות ומה שסומן (מחוץ לטווח)
    let rows; try { rows = P.merge(prev, fresh); } catch (e) { rows = fresh; }
    ST.res = res; ST.fp = fp; ST.rows = rows; ST.built = true; ST.far = data && data.far ? data.far : null; ST.failed = failed; ST.dropped = dropped; ST.news = rows.filter(r => r.isNew).length;
    persist(); render();
    return true;
  }
  const rows = res => (live() && res && ST.res === res ? ST.rows : null);
  function modelOpts(res) { const r = rows(res); return r ? { parties: r, partiesDropped: ST.dropped, partiesFailed: ST.failed.length > 0 } : {}; }
  const mailOpts = res => { const r = rows(res); return r ? { parties: r } : null; };
  function record(res) { const r = rows(res); if (!r) return null; try { return P.record(r, { now: nowDate() }); } catch (e) { return null; } }

  /* ---------- עריכה ---------- */
  function touched() { persist(); updSummary(); notify(); }
  function setField(key, field, value) {
    if (!live()) return { ok: false, error: "" };
    const r = P.setField(ST.rows, key, field, value);
    if (r.error) return { ok: false, error: r.error };
    ST.rows = r.rows; touched();
    return { ok: true, error: "" };
  }
  function addManual(init) {
    if (!live()) return { ok: false, error: "", key: "" };
    const r = P.addManual(ST.rows, init);
    if (r.error) return { ok: false, error: r.error, key: "" };
    ST.rows = r.rows; render(); touched();
    return { ok: true, error: "", key: r.key };
  }
  function removeManual(key) {
    if (!live()) return { ok: false };
    const before = ST.rows.length; ST.rows = P.removeManual(ST.rows, key);
    if (ST.rows.length === before) return { ok: false };
    render(); touched();
    return { ok: true };
  }
  function reset() { clear(); render(); const l = byId("ptyLive"); if (l) l.textContent = ""; const d = byId("ptyDraft"); if (d) d.hidden = true; }
  function wipe() { try { if (HK && HK.store) HK.store.del(); } catch (e) { /* ignore */ } }
  const state = () => ({ built: ST.built, fp: ST.fp, rows: ST.rows.slice(), failed: ST.failed.slice(), dropped: ST.dropped, news: ST.news, onlyOpen: ST.onlyOpen });

  /* ================= DOM (דפדפן בלבד) ================= */
  const CSS = [
    ".pty-box{margin-top:18px;padding:14px 16px 16px;border:1px solid var(--line);border-radius:12px;background:var(--panel-2)}",
    ".pty-box h3{display:flex;align-items:center;flex-wrap:wrap;gap:6px;font-size:17px;font-weight:900;color:var(--amber);line-height:1.4}",
    ".pty-box p.small{margin-top:6px}.pty-box button,.pty-box select,.pty-box input{transition:none}",   // prefers-reduced-motion: אין אנימציות בכלל בעורך (גם לא ה-transition הכללי של כפתורי הדף)
    ".pty-sum{margin-top:10px;font-size:14.5px;font-weight:700;line-height:1.6;overflow-wrap:anywhere}",
    ".pty-sum:empty{display:none}",
    ".pty-msg{margin-top:4px;font-size:13px;line-height:1.6;color:#ffe0b0}.pty-msg:empty{display:none}",
    ".pty-tools{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin-top:8px;font-size:13px;color:var(--muted)}",
    ".pty-tools label{display:inline-flex;align-items:center;gap:6px;color:var(--ink);cursor:pointer;min-height:32px}.pty-tools input{width:18px;height:18px;accent-color:var(--cyan)}",
    ".pty-list{list-style:none;display:grid;gap:10px;margin-top:10px}",
    ".pty{position:relative;border:1px solid var(--line);border-inline-start:4px solid var(--muted);border-radius:10px;padding:10px 12px;background:var(--panel);min-width:0}",
    ".pty[data-st=needed]{border-inline-start-color:var(--amber)}.pty[data-st=done]{border-inline-start-color:var(--green)}.pty[data-st=nocontact],.pty[data-st=notneeded]{border-inline-start-color:#566580}",
    ".pty-empty{padding:10px 12px;border:1px dashed var(--line);border-radius:10px;color:var(--muted);font-size:13.5px}",
    ".pty-h{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px}",
    ".pty-n{color:var(--muted);font-weight:700}.pty-t{color:var(--ink);font-size:14.5px;overflow-wrap:anywhere;min-width:0}",
    ".pty-tag,.pty-srcc,.pty-manual,.pty-flag{display:inline-block;padding:1px 8px;border-radius:999px;border:1px solid var(--line);background:var(--panel-2);font-size:12px;color:var(--muted);white-space:nowrap}",
    ".pty-flag{border-color:var(--cyan);color:var(--cyan)}",
    ".pty-rm{margin-inline-start:auto;min-height:32px;padding:3px 12px;font-size:13px}",
    ".pty-party{margin-top:4px;font-size:13px;color:var(--muted);overflow-wrap:anywhere}",
    ".pty-c{margin-top:6px;padding:8px 10px;border-radius:8px;background:var(--panel-2);font-size:13.5px;line-height:1.7;overflow-wrap:anywhere}",
    ".pty-b+.pty-b{margin-top:8px;padding-top:8px;border-top:1px dashed var(--line)}",
    ".pty-bl{display:block;color:var(--ink)}.pty-items{display:flex;flex-wrap:wrap;gap:2px 0}.pty-it{white-space:nowrap}.pty-it+.pty-it::before{content:\" · \";white-space:pre}",
    ".pty-none{color:var(--muted)}.pty-q{margin-top:3px;color:var(--ink);overflow-wrap:anywhere;padding-inline-start:8px;border-inline-start:2px solid var(--line)}.pty-s{display:block;margin-top:3px;font-size:12px;color:var(--muted)}.pty-un{font-size:12px;color:var(--muted)}",
    ".pty-pairs{list-style:none;display:grid;gap:2px;margin:2px 0}",
    ".pty a.pty-tel,.pty a.pty-url{color:var(--cyan)}.pty-url{overflow-wrap:anywhere}",
    ".pty-m{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;margin-top:6px}",
    ".pty-f{display:grid;grid-template-columns:11rem 15rem minmax(0,1fr);gap:8px;margin-top:8px;align-items:end}",
    ".pty-l{display:flex;flex-direction:column;gap:3px;font-size:12.5px;color:var(--muted);min-width:0}.pty-l>span{font-weight:700;color:var(--ink)}",
    ".pty-ic{display:inline-block;min-width:1em;text-align:center;color:var(--amber)}.pty[data-st=done] .pty-ic{color:var(--green)}.pty[data-st=nocontact] .pty-ic,.pty[data-st=notneeded] .pty-ic,.pty[data-st=unmarked] .pty-ic{color:var(--muted)}",
    ".pty-e{margin-top:4px}.pty-e:empty{display:none}",
    ".pty input[aria-invalid=true]{border-color:var(--red)}",
    ".pty-add{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:12px}.pty-chips{display:flex;flex-wrap:wrap;align-items:center;gap:6px}",
    ".pty-chip{min-height:32px;padding:3px 12px;border-radius:999px;font-size:13px;font-weight:500}",
    ".pty-draft{margin-top:10px;padding:10px 12px;border:1px solid var(--amber);border-radius:10px;background:var(--panel)}",
    ".pty-draft-g{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;margin-top:8px}.pty-draft-g .pty-ln{grid-column:1 / -1}",
    ".pty-draft .row{margin-top:8px}",
    ".vh{position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}",
    "@media (max-width:640px){",
    " .pty-box{padding:12px}.pty-f{grid-template-columns:1fr 1fr}.pty-ln{grid-column:1 / -1}.pty-m,.pty-draft-g{grid-template-columns:1fr}",
    " .pty-items{display:grid;gap:4px}.pty-it{white-space:normal}.pty-it+.pty-it::before{content:none}.pty a.pty-tel{display:flex;align-items:center;min-height:44px;width:100%}.pty-rm{min-width:44px;min-height:44px}",
    " .pty-chip,.pty-box button{min-height:44px}.pty-pairs a.pty-tel{display:inline-flex;width:auto}",
    "}",
    "@media (max-width:420px){.pty-f{grid-template-columns:1fr}}",
    "@media (pointer:coarse){.pty select,.pty input[type=text],.pty-draft input,.pty-draft select,.pty-box button,.pty a.pty-tel,.pty-tools label{min-height:44px}}",
    // עמוד הקריאה בדוח (div.paper.parties, output.js partiesHtml) בטלפון: כל שורה ככרטיס (כמו דף הבדיקות); מסך בלבד — ההדפסה וה-Word נשארים טבלה
    "@media screen and (max-width:640px){",
    " .paper.parties table.t,.paper.parties table.t tbody{display:block;width:auto}.paper.parties table.t colgroup{display:none}",
    " .paper.parties table.t thead{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}",
    " .paper.parties table.t tr{display:grid;grid-template-columns:auto minmax(0,1fr);gap:3px 8px;border:1px solid #aaa;border-radius:6px;background:#fafafa;padding:7px 9px;margin:0 0 8px}",
    " .paper.parties table.t td{display:block;border:0;padding:0;text-align:right;min-width:0;white-space:normal;overflow-wrap:anywhere}",
    " .paper.parties table.t td:nth-child(1){grid-column:1;font-weight:700;color:#555;white-space:nowrap}.paper.parties table.t td:nth-child(2){grid-column:2;font-weight:700}",
    " .paper.parties table.t td:nth-child(n+3){grid-column:1 / -1}.paper.parties table.t td:empty{display:none}",
    " .paper.parties table.t td:nth-child(3)::before{content:\"סוג: \";font-weight:700}.paper.parties table.t td:nth-child(4)::before{content:\"פרטי קשר: \";font-weight:700}",
    " .paper.parties table.t td:nth-child(5)::before{content:\"סטטוס: \";font-weight:700}.paper.parties table.t td:nth-child(6)::before{content:\"הערה: \";font-weight:700}",
    "}"
  ].join("\n");
  const DRAFT_HTML = '<div class="pty-draft" id="ptyDraft" role="group" aria-labelledby="ptyDraftT" hidden><b id="ptyDraftT">' + E(STR.draft) + '</b><div class="pty-draft-g">' +
    '<label class="pty-l"><span>' + E(STR.name) + '</span><input type="text" id="ptyDName" maxlength="80" autocomplete="off" aria-describedby="ptyDErr"></label>' +
    '<label class="pty-l"><span>' + E(STR.contact) + '</span><input type="text" id="ptyDContact" maxlength="120" autocomplete="off" aria-describedby="ptyDErr"></label>' +
    '<label class="pty-l"><span>' + E(STR.type) + '</span><select id="ptyDType"></select></label>' +
    '<label class="pty-l"><span>' + E(STR.status) + '</span><select id="ptyDStatus"></select></label>' +
    '<label class="pty-l pty-ln"><span>' + E(STR.note) + '</span><input type="text" id="ptyDNote" maxlength="300" autocomplete="off" aria-describedby="ptyDErr"></label></div>' +
    '<p class="err" id="ptyDErr"></p><div class="row"><button type="button" class="primary" data-act="draft-ok">' + E(STR.ok) + '</button><button type="button" data-act="draft-cancel">' + E(STR.cancel) + "</button></div></div>";

  function updSummary() {
    const s = byId("ptySum"); if (!s) return;
    const t = ST.built && ST.rows.length ? P.summaryText(P.summary(ST.rows)) : "";
    if (s.textContent !== t) s.textContent = t;   // רק כשהשתנה: קורא מסך לא יקריא שוב על כל הקלדה
  }
  function say(text) {
    const l = byId("ptyLive"); if (!l) return;
    l.textContent = "";
    setTimeout(() => { if (ST.built) l.textContent = text; }, 40);
  }
  function authority() { try { return P.localAuthority(ST.far, CFG); } catch (e) { return null; } }
  function chipsHtml() {
    const a = authority();
    // כשזוהתה הרשות המקומית (לפי OSM) הצ׳יפ הספציפי ״רשות מקומית: <שם>״ מחליף את הכללי
    const chips = P.SUGGESTIONS.filter(s => !(a && a.name && s === "רשות מקומית")).map(s => '<button type="button" class="pty-chip" data-act="chip" data-name="' + E(s) + '">' + E(s) + "</button>");
    if (a && a.name) { const c = [a.phones[0] && a.phones[0].text, a.urls[0] || a.emails[0]].filter(Boolean).join(" · "); chips.unshift('<button type="button" class="pty-chip" data-act="chip" data-name="' + E(P.txt(STR.chipAuth + a.name, 80)) + '" data-contact="' + E(P.txt(c, 120)) + '">' + E(P.txt(STR.chipAuth + a.name, 80)) + "</button>"); }
    return chips.join("");
  }
  function render() {
    const box = byId("partiesBox"); if (!box) return;
    const list = byId("ptyList"), rs = ST.built && on(CFG) ? ST.rows : [];
    const total = rs.length, opened = ST.onlyOpen && total > 8;
    if (!ST.built) { list.innerHTML = ""; updSummary(); byId("ptyMsg").textContent = ""; byId("ptyTools").hidden = true; return; }
    const shown = opened ? rs.filter(isOpen).length : total;
    list.innerHTML = total ? listHtml(rs, { onlyOpen: opened }) : '<li class="pty-empty">' + E(ST.failed.length ? P.TEXT.failed : P.TEXT.empty) + "</li>";
    const notes = [];
    if (ST.news) notes.push(P.TEXT.newFound(ST.news));
    if (ST.failed[0] === "*") notes.push(P.TEXT.failed);
    else if (ST.failed.length) notes.push(STR.partial(ST.failed.map(k => (own(SRC_NAME, k) ? SRC_NAME[k] : "")).filter(Boolean).join(", ") || SRC_NAME.zones));
    if (ST.dropped) notes.push(P.TEXT.dropped(ST.dropped));
    byId("ptyMsg").textContent = notes.join(" ");
    const tools = byId("ptyTools"); tools.hidden = total <= 8;
    byId("ptyOpenN").textContent = total > 8 && opened ? STR.shown(shown, total) : "";
    byId("ptyOpen").checked = ST.onlyOpen;
    byId("ptyChips").innerHTML = chipsHtml();
    updSummary();
  }

  /* ---------- אירועים ---------- */
  const cardOf = el => (el && el.closest ? el.closest("li.pty[data-key]") : null);
  const curVal = (key, f) => { const r = ST.rows.find(x => x.key === key); return !r ? "" : f === "note" ? r.note || "" : f === "name" ? r.title || "" : f === "contact" ? r.contact || "" : ""; };
  function flag(t, li, err) {
    const e = li && li.querySelector(".pty-e");
    if (err) t.setAttribute("aria-invalid", "true"); else t.removeAttribute("aria-invalid");
    if (e) e.textContent = err || "";
  }
  function onEdit(ev) {
    const t = ev.target, li = cardOf(t); if (!t || !li || !t.dataset || !t.dataset.f) return;
    const f = t.dataset.f, r = setField(li.dataset.key, f, t.value);
    if (f === "status" && r.ok) { li.dataset.st = t.value; const ic = li.querySelector(".pty-ic"); if (ic) ic.textContent = P.STATUS_ICON[t.value] || ""; }
    flag(t, li, r.error);
  }
  function onChangeEv(ev) {
    const t = ev.target, li = cardOf(t); if (!t || !li) return;
    if (t.tagName === "SELECT") { onEdit(ev); return; }
    // שדה טקסט שנשאר פגום ביציאה ממנו: מחזירים את הערך האחרון התקין (המודל לא השתנה, ולכן ה-Word וה-JSON אינם של הערך הפגום)
    if (t.getAttribute("aria-invalid") === "true") { t.value = curVal(li.dataset.key, t.dataset.f); t.removeAttribute("aria-invalid"); const e = li.querySelector(".pty-e"); if (e) e.textContent = (e.textContent ? e.textContent + " — " : "") + STR.reverted; }
  }
  function openDraft(name, contact) {
    const d = byId("ptyDraft"); d.hidden = false;
    byId("ptyDType").innerHTML = typeOpts("approval"); byId("ptyDStatus").innerHTML = statusOpts("unmarked");
    if (name != null) { byId("ptyDName").value = name; byId("ptyDContact").value = contact || ""; byId("ptyDNote").value = ""; byId("ptyDErr").textContent = ""; byId("ptyDName").removeAttribute("aria-invalid"); }
    byId("ptyDName").focus();
  }
  function closeDraft() { const d = byId("ptyDraft"); d.hidden = true; byId("ptyDErr").textContent = ""; ["ptyDName", "ptyDContact", "ptyDNote"].forEach(id => { byId(id).value = ""; byId(id).removeAttribute("aria-invalid"); }); byId("ptyAdd").focus(); }
  function draftOk() {
    const r = addManual({ name: byId("ptyDName").value, contact: byId("ptyDContact").value, note: byId("ptyDNote").value, type: byId("ptyDType").value, status: byId("ptyDStatus").value });
    const err = byId("ptyDErr");
    if (!r.ok) { err.textContent = r.error || ""; byId("ptyDName").setAttribute("aria-invalid", "true"); byId("ptyDName").focus(); return; }
    ["ptyDName", "ptyDContact", "ptyDNote"].forEach(id => { byId(id).value = ""; byId(id).removeAttribute("aria-invalid"); });
    err.textContent = ""; byId("ptyDraft").hidden = true;
    const n = ST.rows.findIndex(x => x.key === r.key) + 1;
    const li = [...byId("ptyList").children].find(x => x.dataset && x.dataset.key === r.key), f = li && li.querySelector('[data-f="name"]');
    say(STR.added(n)); if (f) f.focus();
  }
  function onClick(ev) {
    const b = ev.target && ev.target.closest ? ev.target.closest("[data-act]") : null; if (!b) return;
    const a = b.dataset.act;
    if (a === "draft-ok") draftOk();
    else if (a === "draft-cancel") closeDraft();
    else if (a === "add") openDraft(null);
    else if (a === "chip") openDraft(b.dataset.name || "", b.dataset.contact || "");
    else if (a === "rm") {
      const li = cardOf(b); if (!li) return;
      const key = li.dataset.key, idx = ST.rows.findIndex(x => x.key === key) + 1, sibs = [...byId("ptyList").children], pos = sibs.indexOf(li);
      if (!removeManual(key).ok) return;
      const next = [...byId("ptyList").children][Math.min(pos, byId("ptyList").children.length - 1)], f = next && next.querySelector && next.querySelector("select,input");
      say(STR.removed(idx)); (f || byId("ptyAdd")).focus();
    }
  }
  function onKey(ev) {
    const t = ev.target;
    if (ev.key === "Enter" && t && t.closest && t.closest("#ptyDraft") && t.tagName === "INPUT") { ev.preventDefault(); draftOk(); }
    else if (ev.key === "Escape" && t && t.closest && t.closest("#ptyDraft")) { ev.preventDefault(); closeDraft(); }
  }

  /* ---------- חיבור לדף ---------- */
  function hook(h) { HK = h && typeof h === "object" ? h : null; }
  function mount(cfg) {
    if (cfg !== undefined) CFG = cfg;
    if (!doc || !on(CFG) || !hooked()) return false;
    if (byId("partiesBox")) return true;
    const decl = byId("declBox"), host = byId("reviewBox"); if (!decl || !host) return false;
    const st = doc.createElement("style"); st.id = "partiesStyle"; st.textContent = CSS; doc.head.appendChild(st);
    const H = typeof window !== "undefined" ? window.ReqHelp : null;
    const sec = doc.createElement("section"); sec.id = "partiesBox"; sec.className = "pty-box"; sec.setAttribute("aria-labelledby", "ptyTitle");
    sec.innerHTML = '<h3 id="ptyTitle"><span>' + E(P.TEXT.title) + "</span>" + (H && H.btn ? H.btn(HELP, P.TEXT.title) : "") + "</h3>" +
      '<p class="small">' + E(STR.lead + " " + P.TEXT.intro) + "</p>" +
      '<div class="pty-sum" id="ptySum" role="status" aria-live="polite"></div><p class="pty-msg" id="ptyMsg"></p>' +
      '<div class="pty-tools" id="ptyTools" hidden><label><input type="checkbox" id="ptyOpen"> ' + E(STR.onlyOpen) + '</label><span id="ptyOpenN"></span></div>' +
      '<ol class="pty-list" id="ptyList"></ol>' +
      '<div class="pty-add"><button type="button" id="ptyAdd" data-act="add"><span aria-hidden="true">➕</span> ' + E(STR.add) + '</button><span class="small" id="ptyChipsL">' + E(STR.suggest) + '</span><span class="pty-chips" id="ptyChips" role="group" aria-labelledby="ptyChipsL"></span></div>' +
      DRAFT_HTML + '<div class="vh" id="ptyLive" role="status" aria-live="polite"></div>';
    host.insertBefore(sec, decl);
    sec.addEventListener("input", ev => { const t = ev.target; if (t && t.dataset && t.dataset.f && t.tagName === "INPUT" && cardOf(t)) onEdit(ev); });
    sec.addEventListener("change", ev => { const t = ev.target; if (t && t.id === "ptyOpen") { ST.onlyOpen = !!t.checked; render(); return; } onChangeEv(ev); });
    sec.addEventListener("click", onClick); sec.addEventListener("keydown", onKey);
    // ליד "כולל דף בדיקות": העמוד הזה אינו תלוי בתיבה. וההסבר של "מחק פרטים שמורים" מזכיר גם את הסימונים השמורים
    const inc = byId("incChecks"), lab = inc && inc.closest("label"), anchor = lab && (lab.closest(".hw") || lab);
    if (anchor) anchor.insertAdjacentHTML("afterend", '<span class="small" id="ptyChkNote">' + E(STR.always) + "</span>");
    const w = byId("wipePerson"), wb = w && w.closest(".hw") && w.closest(".hw").querySelector(".hbtn");
    if (wb) wb.setAttribute("data-help", (wb.getAttribute("data-help") || "") + STR.wipeNote);
    render();
    return true;
  }

  return { hook, mount, rebuild, rows, modelOpts, mailOpts, record, setField, addManual, removeManual, reset, wipe, state,
    E, ltrHtml, telHref, cardHtml, listHtml, isOpen, storeParse, storeWrite, storeRead, STORE, TEL_RE, HELP, STR, FP_RE, srcLabel };
});
