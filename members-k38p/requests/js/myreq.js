/* ReqMyReq — "הבקשות שלי" (שלב ב׳): רשימת הבקשות של המשתמש המחובר (שרת: myRequests), "הצג" (סיכום קריאה-בלבד מהקובץ השמור, דרך ReqRecheck) ו"השתמש כבסיס לבקשה חדשה" (שרת: getRequest;
   הטעינה לטופס עצמה נעשית ב-ui.js דרך hook), וצילום תמונת המצב של הניתוח לתוך קובץ נתוני הבקשה (withSnapshot). UMD כמו core.js: הליבה (מודלים, HTML מוגן, טקסטים) טהורה ורצה גם ב-Node; ממשק החלון — בדפדפן בלבד.
   כללי ברזל: (1) דגל config.features.myreq === false או שרת שלא מדווח myRequests ← הכפתור לא מופיע, אין חלון ואין קריאת רשת (מפתח חסר = פעיל); (2) כל מחרוזת מהשרת או מהקובץ השמור נכנסת ל-HTML רק דרך E, או ל-DOM דרך textContent;
   (3) נכשל סגור: שורה פגומה נזרקת, קובץ פגום/חסר ← הודעה בעברית ולא טעינה חלקית (גם area פגום ברשומת נתיב — restoreInputs מחזיר null ← ״unusable״; לעולם לא טעינה כמעגל); (4) לא נשמר דבר בדפדפן (אין אחסון) — הרשימה נטענת מהשרת בכל פתיחה, ותשובה מאוחרת של משתמש שהתנתק נזרקת; (5) "כבסיס" לא טוען תאריכים, שעות, פרטי מבקש, אנשי קשר ומשתתפים,
   ולא תוצאות בדיקה: הבדיקות רצות מחדש וההצהרה מאושרת מחדש (ui.js: myreqLoadBase).

   ===== API =====
   STR / STATE_LABEL                        טקסטי עברית; תוויות המצב: sent_live / sent_test / draft
   enabled(cfg)                             true אלא אם config.features.myreq === false
   available(cfg, features)                 enabled(cfg) && features (מערך מ-ReqAuth.getFeatures) כולל "myRequests" && ReqRecheck נטען
   rowModel(x) / listModel(res)             שורה מהשרת → {id, name, state, stateLabel, saved, savedText, sentAt, sentText} או null (id לא תקין); תשובת myRequests → {rows, total, dropped} או null
   listHtml(model) / viewHtml(...)          HTML מוגן של הרשימה
   errText(res, A)                          הודעת שגיאה בעברית מתשובת שרת (no_record / bad_folder / bad_record / too_big / forbidden / network, ואחרת A.msg)
   noteText(name, notes)                    הודעת "נטענה בקשה כבסיס"
   withSnapshot(rec, res, data, cfg, now)   רשומה + {snapshot} (ReqRecheck.capture) — לא זורק לעולם; דגל recheck כבוי / בלי data ← אותה רשומה; חורגת מתקרת הקובץ ← בלי תמונת מצב + snapshotError
   hook({loadBase, busy, inProgress})       ui.js מחבר את טעינת הטופס;  open() — פותח את החלון;  reset() — מנקה מצב (התנתקות / משתמש אחר) */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./core.js"), require("./recheck.js"));
  else root.ReqMyReq = factory(root.ReqCore, root.ReqRecheck);
})(typeof self !== "undefined" ? self : this, function (C, R) {
  "use strict";

  const LIMITS = { rows: 100, name: 120 };
  const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;   // מזהה תיקייה בדרייב; כל דבר אחר (גם אם הוא נראה תמים) נזרק
  const STATES = ["sent_live", "sent_test", "draft"];
  const STATE_LABEL = { sent_live: "נשלחה למשרד נוטאם", sent_test: "נשלחה לבדיקה בלבד", draft: "נשמרה, לא נשלחה", unknown: "מצב לא ידוע" };
  const STR = {
    btn: "הבקשות שלי", title: "הבקשות שלי",
    intro: "הבקשות שנשמרו או נשלחו מהחשבון הזה, מהחדשה לישנה.",
    loading: "טוען את הבקשות…", loadingOne: "טוען את הבקשה…", empty: "עדיין אין בקשות שמורות בחשבון הזה.",
    view: "הצג", base: "השתמש כבסיס לבקשה חדשה", back: "חזרה לרשימה", retry: "נסו שוב", saved: "נשמרה", sent: "נשלחה", noName: "בקשה ללא שם",
    legend: "מה עושה כל כפתור:", viewName: "הצגת בקשה שמורה", baseName: "שימוש בבקשה כבסיס",
    listFail: "לא ניתן לטעון את רשימת הבקשות.",
    noRecord: "לא נמצא קובץ הנתונים של הבקשה הזו (ייתכן שנמחק או הועבר). אפשר למלא בקשה חדשה ידנית.",
    badRecord: "קובץ הנתונים של הבקשה הזו פגום, ולכן אי אפשר להשתמש בו. אפשר למלא בקשה חדשה ידנית.",
    tooBig: "קובץ הנתונים של הבקשה הזו גדול מדי לטעינה.", forbidden: "אין הרשאה לבקשה הזו.",
    unusable: "אי אפשר להשתמש בבקשה הזו כבסיס: הנקודה או הנתיב, הרדיוס או הרוחב, או הגובה שנשמרו חסרים או לא תקינים. אפשר למלא בקשה חדשה ידנית.",
    offline: "אין חיבור לשרת. נסו שוב.", badResp: "התשובה מהשרת אינה תקינה. נסו שוב.",
    busy: "הרצה, שמירה או שליחה בעיצומה. נסו שוב בעוד רגע.", notReady: "הדף עדיין נטען. נסו שוב בעוד רגע.", failed: "הטעינה נכשלה. רעננו את הדף ונסו שוב.",
    confirm: "בדף יש בקשה בעבודה. טעינת הבקשה השמורה תחליף אותה ותמחק את תוצאות הבדיקות שלה. להמשיך?", yes: "כן, החלף", no: "ביטול",
    close: "סגור", tooBigSnap: "תמונת המצב גדולה מדי לקובץ"
  };
  // הסברי ה-״!״ שבחלון (מתארים מה הפעולה עושה בפועל בקוד: סיכום מ-ReqRecheck.requestModel, טעינה ב-ui.js myreqLoadBase)
  const HELP = {
    view: "פותח סיכום לקריאה בלבד של הבקשה השמורה: המקום, הנקודה והרדיוס (או נקודות הנתיב, אורכו ורוחבו), הגובה, המועד, כלי הטיס, מהות הפעילות, המכשולים שהוזנו והאזורים והמכשולים שנמצאו בעת השמירה. פרטי המבקש אינם נשמרים בקובץ הזה. הפעולה לא משנה דבר בבקשה ולא בטופס.",
    base: "טוען את נתוני הבקשה השמורה לטופס, כבסיס לבקשה חדשה: המקום (נקודה ורדיוס, או נתיב ורוחב — כולל סוג האזור), הגובה, מהות הפעילות, כלי הטיס, קשר העין, המכשולים שהוזנו, ההערות והתוספות הידניות. התאריכים והשעות נשארים ריקים — יש להזין חדשים. תוצאות הבדיקות לא נטענות: יש להריץ אותן מחדש ולאשר שוב את ההצהרה. פרטי המבקש ואנשי הקשר נלקחים מהמכשיר, כמו תמיד, והמשתתפים נשארים כפי שהם בדף (הם אינם נשמרים בקובץ). הבקשה השמורה עצמה לא משתנה, והבקשה החדשה תישמר בנפרד. אם יש בדף בקשה בעבודה — תתבקשו לאשר את ההחלפה."
  };

  /* ================= עזרים טהורים ================= */
  const E = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const isObj = o => o !== null && typeof o === "object" && !Array.isArray(o);
  const clean = (v, max) => (R ? R.clean(v, max) : String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max || undefined));   // בלי R (לא נטען) המודול ממילא לא זמין (available) — ברירת מחדל מינימלית בלבד
  const byteLen = s => new TextEncoder().encode(s).length;
  const enabled = cfg => !(cfg && cfg.features && cfg.features.myreq === false);
  const available = (cfg, features) => !!R && enabled(cfg) && Array.isArray(features) && features.indexOf("myRequests") >= 0;
  const msOf = v => { const t = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Date.parse(v) : NaN; return isFinite(t) && t > 0 && t < 8.64e15 ? t : 0; };
  const when = ms => (ms && R ? R.fmtDateTime(ms) : "");

  function rowModel(x) {
    if (!isObj(x)) return null;
    const id = typeof x.id === "string" ? x.id : "";
    if (!ID_RE.test(id)) return null;
    const state = STATES.indexOf(x.state) >= 0 ? x.state : "", saved = msOf(x.saved), sentAt = state === "draft" || !state ? 0 : msOf(x.sentAt);
    return { id, name: clean(typeof x.name === "string" ? x.name : "", LIMITS.name) || STR.noName, state, stateLabel: STATE_LABEL[state] || STATE_LABEL.unknown, saved, savedText: when(saved), sentAt, sentText: when(sentAt) };
  }
  function listModel(res) {
    if (!isObj(res) || res.ok !== true || !Array.isArray(res.requests)) return null;
    const rows = [], seen = new Set();
    let dropped = 0;
    res.requests.slice(0, LIMITS.rows).forEach(x => { const m = rowModel(x); if (!m || seen.has(m.id)) { dropped++; return; } seen.add(m.id); rows.push(m); });
    const total = typeof res.total === "number" && isFinite(res.total) && res.total >= rows.length ? Math.floor(res.total) : rows.length;
    return { rows, total, dropped };
  }
  const countText = n => (n === 1 ? "בקשה אחת" : n + " בקשות");
  function statusText(lm) {
    if (!lm.rows.length) return STR.empty;
    return lm.total > lm.rows.length ? "מוצגות " + lm.rows.length + " הבקשות האחרונות מתוך " + lm.total + "." : countText(lm.rows.length) + ".";
  }
  // פעולות נוספות לשורה (שלב ב׳: ״בדיקה חוזרת״ מ-js/recheckui.js דרך extend): {act, text, label, states:[מצבי שורה], help, helpName}. שם הפעולה: אותיות קטנות בלבד ולא שם של פעולה קיימת; בלי הרחבה (או בלי פעולות) — הרשימה זהה לשלב א׳
  const BUILTIN_ACTS = ["view", "base", "back", "retry", "yes", "no"];
  function extraActs(list) {
    return (Array.isArray(list) ? list : []).filter(a => isObj(a) && typeof a.act === "string" && /^[a-z]{2,16}$/.test(a.act) && BUILTIN_ACTS.indexOf(a.act) < 0 && typeof a.text === "string" && a.text && Array.isArray(a.states)).slice(0, 3);
  }
  function listHtml(lm) {
    if (!lm || !Array.isArray(lm.rows) || !lm.rows.length) return "";   // הודעת "אין בקשות" מוצגת באזור הסטטוס (aria-live), לא פעמיים
    const ex = extraActs(lm.extra);
    return '<ul class="mrList" aria-label="' + E(STR.title) + '">' + lm.rows.map(r => {
      const meta = [r.savedText ? STR.saved + ": " + r.savedText : "", r.sentText ? STR.sent + ": " + r.sentText : ""].filter(Boolean).join(" · ");
      return '<li class="mrRow" data-id="' + E(r.id) + '"><div class="mrTop"><b class="mrName" dir="auto">' + E(r.name) + '</b><span class="mrChip" data-state="' + E(r.state || "unknown") + '">' + E(r.stateLabel) + "</span></div>" +
        (meta ? '<div class="mrMeta">' + E(meta) + "</div>" : "") +
        '<div class="mrAct"><button type="button" data-act="view" data-id="' + E(r.id) + '" aria-label="' + E(STR.view + ": " + r.name) + '">' + E(STR.view) + "</button>" +
        '<button type="button" data-act="base" data-id="' + E(r.id) + '" aria-label="' + E(STR.base + ": " + r.name) + '">' + E(STR.base) + "</button>" +
        ex.filter(a => a.states.indexOf(r.state) >= 0).map(a => '<button type="button" data-act="' + E(a.act) + '" data-id="' + E(r.id) + '" aria-label="' + E((a.label || a.text) + ": " + r.name) + '">' + E(a.text) + "</button>").join("") + "</div></li>";
    }).join("") + "</ul>";
  }
  function errText(res, A) {
    const c = isObj(res) && typeof res.error === "string" ? res.error : "";
    if (isObj(res) && res.ok === true) return STR.badResp;   // תשובה "תקינה" בלי הנתונים שנדרשו
    if (c === "no_record" || c === "bad_folder") return STR.noRecord;
    if (c === "bad_record") return STR.badRecord;
    if (c === "too_big") return STR.tooBig;
    if (c === "forbidden") return STR.forbidden;
    if (c === "network") return STR.offline;
    if (A && typeof A.msg === "function" && isObj(res)) return String(A.msg(res));
    return STR.badResp;
  }
  const noteText = (name, notes) => "הבקשה ״" + clean(name, LIMITS.name) + "״ נטענה כבסיס לבקשה חדשה (הבקשה השמורה לא משתנה). יש להזין תאריכים ושעות, להריץ את הבדיקות מחדש ולאשר שוב את ההצהרה." +
    (Array.isArray(notes) && notes.length ? " לא נטענו: " + notes.map(x => clean(x, 200)).filter(Boolean).join(", ") + "." : "");

  // הגדרות לספריית ReqRecheck כשהיא משמשת כאן רק לקריאת קובץ שמור: דגל recheck שולט בתצוגת הבדיקה החוזרת בלבד, לא ב"הבקשות שלי" (features ריק = פעיל); הגבולות (config.defaults) נשמרים
  const libCfg = cfg => Object.assign({}, cfg && typeof cfg === "object" ? cfg : {}, { features: {} });

  // רשומת נתוני הבקשה + תמונת מצב. לעולם לא זורקת ולא חוסמת: כל כשל (או דגל recheck כבוי, או נתוני ניתוח שאינם של הניתוח הנוכחי) ← הרשומה כמות שהיא, בדיוק כמו בשלב א׳.
  // הקובץ נכתב ב-JSON עם הזחה (ui.js) וה-getRequest של השרת מסרב לקובץ מעל R.LIMITS.record — לכן הגודל נבדק בצורה שבה הוא נכתב; גדול מדי ← בלי תמונת מצב (+ snapshotError), לא קובץ שאי אפשר לטעון
  function withSnapshot(rec, res, data, cfg, now) {
    try {
      if (!R || !isObj(rec) || !isObj(data) || !R.enabled(cfg)) return rec;
      const out = Object.assign({}, rec, R.capture(res, data, cfg, now));
      if (out.snapshot !== undefined && byteLen(JSON.stringify(out, null, 1)) > R.LIMITS.record) { delete out.snapshot; out.snapshotError = STR.tooBigSnap; }
      return out;
    } catch (e) { return rec; }
  }

  const api = { LIMITS, STR, STATE_LABEL, HELP, enabled, available, rowModel, listModel, listHtml, extraActs, statusText, errText, noteText, libCfg, withSnapshot };
  if (typeof document === "undefined" || typeof window === "undefined") return api;

  /* ================= ממשק החלון (דפדפן) ================= */
  const $ = id => document.getElementById(id);
  const ST = { hooks: null, ext: null, seq: 0, who: "", modal: null, rows: [], total: 0, view: null, pending: null, busy: false };
  // ההרחבה (recheckui.js): actions() ← פעולות נוספות לשורות, onAction(act, id, row) ← לחיצה עליהן. כשל בהרחבה לא פוגע ברשימה
  const extraNow = () => { try { return extraActs(ST.ext && typeof ST.ext.actions === "function" ? ST.ext.actions() : null); } catch (e) { return []; } };
  const hbtn = (t, name) => (window.ReqHelp ? window.ReqHelp.btn(t, name) : "");
  const CSS = ".mr .mrList{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}" +
    ".mr .mrRow{border:1px solid var(--line,#22304a);border-radius:10px;padding:10px 12px;background:var(--panel-2,#0f1726)}" +
    ".mr .mrTop{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px 10px}" +
    ".mr .mrName{font-size:14.5px;min-width:0;flex:1 1 140px;overflow-wrap:anywhere}" +
    ".mr .mrChip{font-size:12px;font-weight:700;border-radius:999px;padding:2px 10px;border:1px solid;line-height:1.5}" +
    ".mr .mrChip[data-state=sent_live]{color:#4ade80;border-color:rgba(74,222,128,.6)}.mr .mrChip[data-state=sent_test]{color:#67d8e8;border-color:rgba(103,216,232,.6)}" +
    ".mr .mrChip[data-state=draft]{color:#ffb84d;border-color:rgba(255,184,77,.6)}.mr .mrChip[data-state=unknown]{color:#8fa0ba;border-color:#8fa0ba}" +
    ".mr .mrMeta{font-size:12.5px;color:var(--muted,#8fa0ba);margin:4px 0 8px;line-height:1.7;overflow-wrap:anywhere}" +
    ".mr .mrAct{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}.mr .mrAct button,.mr .mrBtns button{min-height:44px;flex:1 1 120px}.mr button[aria-disabled=true]{opacity:.55;cursor:progress}.authBox.mr #mdClose{min-height:44px;min-width:44px}" +
    ".mr .mrBtns{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}.mr .mrLegend{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;margin:6px 0}" +
    ".mr .mrView table{table-layout:fixed;width:100%}.mr .mrView td,.mr .mrView th,.mr .mrView li{overflow-wrap:anywhere}.mr .mrView h3{font-size:16px;margin:4px 0 6px}.mr .mrView th{background:rgba(255,255,255,.07)!important;color:var(--ink,#e9eff9)!important}.mr .mrView th,.mr .mrView td{border-color:var(--line,#22304a)!important}.mr .mrView:focus{outline:none}" +
    ".mr .mrConfirm{border:1px solid var(--amber,#ffb84d);border-radius:10px;padding:12px;background:rgba(255,184,77,.10);line-height:1.7}" +
    ".mr .mrEmpty{margin:8px 0}.mr h2{margin:0 0 4px}" +
    "#baseNote{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 14px}#baseNote span{flex:1 1 220px;min-width:0;overflow-wrap:anywhere}#baseNote button{min-height:40px}";
  function ensureStyle() { if ($("myreqStyle")) return; const s = document.createElement("style"); s.id = "myreqStyle"; s.textContent = CSS; document.head.appendChild(s); }

  const A_ = () => window.ReqAuth;
  // החלון עדיין החלון הזה, והמשתמש עדיין אותו משתמש: אחרת תשובה מאוחרת (התנתקות, החלפת משתמש, סגירה) נזרקת
  function alive(seq) { const A = A_(); return !!A && seq === ST.seq && !!ST.modal && ST.modal.isConnected && $("authModal") === ST.modal && A.loggedIn() && A.user_() === ST.who; }
  const setStatus = t => { const e = $("mrStatus"); if (e) e.textContent = t || ""; };
  const setMsg = t => { const e = $("mrMsg"); if (e) e.textContent = t || ""; };
  // החלפת התוכן: אם המיקוד היה בתוך החלון והאלמנט שלו נעלם — חוזר אל החלון עצמו (אחרת הוא נופל ל-body: Escape ו-Tab היו מפסיקים לעבוד, וקורא מסך מאבד מקום)
  const setBody = h => { const e = $("mrBody"), m = ST.modal; if (!e) return; const had = !!m && m.contains(document.activeElement); e.innerHTML = h; if (had && !m.contains(document.activeElement)) focusSoon(m.firstElementChild); };
  // בזמן טעינה הכפתורים aria-disabled (לא disabled): כפתור שהמיקוד עליו לא מאבד אותו, ולחיצה נוספת מתעלמת (onClick)
  function setBusy(on) {
    ST.busy = !!on;
    if (!ST.modal) return;
    ST.modal.querySelectorAll("[data-act]").forEach(b => { if (on) b.setAttribute("aria-disabled", "true"); else b.removeAttribute("aria-disabled"); });
    const b = $("mrBody"); if (b) { if (on) b.setAttribute("aria-busy", "true"); else b.removeAttribute("aria-busy"); }
  }
  const focusables = m => [...m.querySelectorAll('button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(e => e.getClientRects().length > 0);
  const focusSoon = el => { try { if (el && el.isConnected) el.focus({ preventScroll: false }); } catch (e) { /* ignore */ } };

  function skeleton() {
    return '<h2 id="mrTitle">' + E(STR.title) + '</h2><p class="small">' + E(STR.intro) + "</p>" +
      '<p class="small mrLegend">' + E(STR.legend) + ' <span class="hw"><b>' + E(STR.view) + "</b>" + hbtn(HELP.view, STR.viewName) + '</span> <span class="hw"><b>' + E(STR.base) + "</b>" + hbtn(HELP.base, STR.baseName) + "</span>" +
      extraNow().filter(a => typeof a.help === "string" && a.help).map(a => ' <span class="hw"><b>' + E(a.text) + "</b>" + hbtn(a.help, a.helpName || a.label || a.text) + "</span>").join("") + "</p>" +
      '<div id="mrStatus" class="small" role="status" aria-live="polite"></div><div id="mrMsg" class="err" role="alert"></div><div id="mrBody"></div>';
  }

  function showList(focusId) {
    ST.view = null; ST.pending = null;
    setMsg("");
    const lm = { rows: ST.rows, total: ST.total || ST.rows.length, extra: extraNow() };
    setStatus(statusText(lm)); setBody(listHtml(lm));
    if (focusId) { const b = ST.modal && [...ST.modal.querySelectorAll('button[data-act="view"]')].find(x => x.dataset.id === focusId); focusSoon(b); }
  }
  async function loadList(seq) {
    const A = A_();
    setMsg(""); setStatus(STR.loading); setBody(""); setBusy(true);
    let res;
    try { res = await A.call("myRequests"); } catch (e) { res = { ok: false, error: "network" }; }
    if (!alive(seq)) return;
    setBusy(false);
    const lm = listModel(res);
    if (!lm) {
      setStatus("");
      setMsg(STR.listFail + " " + (isObj(res) && res.ok === false ? errText(res, A) : STR.badResp));
      setBody('<div class="mrBtns"><button type="button" data-act="retry">' + E(STR.retry) + "</button></div>");
      return;
    }
    ST.rows = lm.rows; ST.total = lm.total;
    showList();
  }
  async function fetchOne(id, seq) {
    const A = A_();
    setMsg(""); setStatus(STR.loadingOne); setBusy(true);
    let res;
    try { res = await A.call("getRequest", { folderId: id }); } catch (e) { res = { ok: false, error: "network" }; }
    if (!alive(seq)) return null;
    setBusy(false); setStatus("");
    if (!isObj(res) || res.ok !== true || !isObj(res.rec)) { setMsg(errText(res, A)); return null; }
    return res.rec;
  }
  async function actView(id, seq) {
    const row = ST.rows.find(r => r.id === id); if (!row) return;
    const rec = await fetchOne(id, seq); if (!rec) return;
    let html;
    try { html = R.requestHtml(R.requestModel(rec, { name: row.name, sentAt: row.sentAt || undefined, cfg: libCfg(A_().cfg) })); } catch (e) { html = ""; }
    if (!html) { setMsg(STR.badRecord); return; }
    ST.view = { id, rec, row };
    setStatus("");
    setBody('<div class="mrView" id="mrView" tabindex="-1">' + html + '</div><div class="mrBtns"><button type="button" data-act="base" data-id="' + E(id) + '">' + E(STR.base) + '</button><button type="button" data-act="back" data-id="' + E(id) + '">' + E(STR.back) + "</button></div>");
    const v = $("mrView"); if (v) { v.scrollIntoView && v.scrollIntoView({ block: "start" }); focusSoon(v); }
  }
  async function actBase(id, seq) {
    const row = ST.rows.find(r => r.id === id); if (!row) return;
    const rec = ST.view && ST.view.id === id ? ST.view.rec : await fetchOne(id, seq);
    if (!rec) return;
    const inputs = R.restoreInputs(rec, { cfg: libCfg(A_().cfg) });
    if (!inputs) { setMsg(STR.unusable); return; }
    const h = ST.hooks;
    if (!h || typeof h.loadBase !== "function") { setMsg(STR.notReady); return; }
    if (typeof h.busy === "function" && h.busy()) { setMsg(STR.busy); return; }
    if (typeof h.inProgress === "function" && h.inProgress()) {   // בקשה בעבודה: אישור לפני ההחלפה (בתוך החלון — לא confirm של הדפדפן, שחלק מהדפדפנים המשובצים חוסמים)
      ST.pending = { id, inputs, row };
      setStatus(""); setMsg("");
      setBody('<div class="mrConfirm" role="group" aria-labelledby="mrConfirmT"><p id="mrConfirmT">' + E(STR.confirm) + '</p><div class="mrBtns"><button type="button" data-act="no" class="primary" aria-describedby="mrConfirmT">' + E(STR.no) + '</button><button type="button" data-act="yes">' + E(STR.yes) + "</button></div></div>");
      focusSoon(ST.modal.querySelector('[data-act="no"]'));
      return;
    }
    apply(inputs, row);
  }
  function apply(inputs, row) {
    const A = A_(), h = ST.hooks;
    if (typeof h.busy === "function" && h.busy()) { setMsg(STR.busy); return; }
    let r;
    try { r = h.loadBase(inputs); } catch (e) { r = null; }
    if (!r || !r.ok) { setMsg(r && r.error === "busy" ? STR.busy : STR.failed); return; }
    ST.seq++; ST.modal = null; ST.pending = null; ST.view = null;
    A.closeModal();
    showNote(noteText(row.name, r.notes));
    const d = $("dateFrom"); if (d) { try { d.scrollIntoView({ block: "center", behavior: window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); d.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }
  function onClick(ev) {
    const b = ev.target && ev.target.closest ? ev.target.closest("button[data-act]") : null;
    if (!b || b.disabled || ST.busy || b.getAttribute("aria-disabled") === "true") return;
    const seq = ST.seq, id = b.dataset.id || "";
    switch (b.dataset.act) {
      case "view": actView(id, seq); break;
      case "base": actBase(id, seq); break;
      case "back": showList(id); break;
      case "retry": loadList(seq); break;
      case "yes": { const p = ST.pending; if (p) apply(p.inputs, p.row); break; }
      case "no": { const p = ST.pending; showList(p && p.id); break; }
      default: if (extraNow().some(a => a.act === b.dataset.act) && ST.ext && typeof ST.ext.onAction === "function") { try { ST.ext.onAction(b.dataset.act, id, ST.rows.find(r => r.id === id)); } catch (e) { /* הרחבה: כשל בה לא פוגע ברשימה */ } } break;
    }
  }
  // מאזין אחד על ה-document בשלב הלכידה (לפני help.js): עובד גם כשהמיקוד נפל ל-body, ורואה את בועת ה-״!״ עוד פתוחה
  function onKey(ev) {
    const A = A_(), m = ST.modal;
    if (!A || !m || !m.isConnected || $("authModal") !== m) return;
    if (ev.key === "Escape") {
      const hb = $("hbubble"); if (hb && !hb.hidden) return;   // בועת ״!״ פתוחה: Escape סוגר אותה (help.js) ולא את החלון
      ev.preventDefault(); A.closeModal(); return;
    }
    if (ev.key !== "Tab" || !m) return;
    const f = focusables(m); if (!f.length) return;
    const cur = document.activeElement, first = f[0], last = f[f.length - 1], box = m.firstElementChild;
    if (ev.shiftKey && (cur === first || cur === box)) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && (cur === last || !m.contains(cur))) { ev.preventDefault(); first.focus(); }
  }

  /* ----- הודעה בדף אחרי טעינת בסיס ----- */
  function removeNote() { const n = $("baseNote"); if (n) n.remove(); }
  function showNote(text) {
    removeNote();
    const sec = $("inputs"); if (!sec || !sec.parentNode) return;
    const n = document.createElement("div"); n.id = "baseNote"; n.className = "banner ok"; n.setAttribute("role", "status");
    const sp = document.createElement("span"); sp.textContent = text; n.appendChild(sp);
    const b = document.createElement("button"); b.type = "button"; b.textContent = STR.close; b.onclick = removeNote; n.appendChild(b);
    sec.parentNode.insertBefore(n, sec);
    const run = $("runBtn"); if (run) run.addEventListener("click", removeNote, { once: true });   // אחרי הרצה ההודעה כבר לא מועילה
  }

  function open() {
    const A = A_();
    if (!A || !A.loggedIn() || !available(A.cfg, A.getFeatures())) return null;
    ensureStyle();
    const m = A.modal(skeleton(), "mr");
    if (!m) return null;   // שמירה/שליחה בעיצומה: auth.js לא מחליף חלון
    ST.seq++; ST.who = A.user_(); ST.modal = m; ST.rows = []; ST.total = 0; ST.view = null; ST.pending = null; ST.busy = false;
    m.setAttribute("aria-labelledby", "mrTitle"); m.firstElementChild.classList.add("mr");
    m.addEventListener("click", onClick);
    loadList(ST.seq);
    return m;
  }
  function reset() { ST.seq++; ST.who = ""; ST.modal = null; ST.rows = []; ST.total = 0; ST.view = null; ST.pending = null; ST.busy = false; removeNote(); }
  function hook(h) { ST.hooks = isObj(h) ? h : null; }
  function extend(p) { ST.ext = isObj(p) ? p : null; }   // הרחבת פעולות לשורות (recheckui.js); null מנתק
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("req-logout", reset);
  document.addEventListener("req-auth", reset);

  return Object.assign(api, { open, reset, hook, extend, state: () => ({ seq: ST.seq, rows: ST.rows.length, view: !!ST.view, pending: !!ST.pending, who: ST.who }) });
});
