/* ממשק "בקשת סגירה אווירית": קלט -> הרצת כל הבדיקות -> טופס, מפה, KML, מייל. כל כשל בבדיקה חוסם את "מוכן לשליחה". */
(function () {
  "use strict";
  const C = window.ReqCore, O = window.ReqOut, M = window.ReqMap, H = window.ReqHelp, $ = id => document.getElementById(id);
  // rev: מונה גרסת הבקשה (מתקדם בכל שינוי בה, ב-clearOutcome); buildSeq/building: בניית ההדמיות ("האחרון מנצח"); pending: הדמיות ממתינות לעדכון (נגזר מטיימר עריכה ממתין או מבנייה רצה);
  // driveTry: הגרסה האחרונה (S.rev) שנוסתה לשמור בדרייב (אוטומטית, ידנית או בשליחה) — השמירה האוטומטית לא חוזרת עליה, גם אחרי כשל; saved: {rev, folder} של שמירה מוצלחת בדרייב לגרסה הנוכחית (נמחק בכל שינוי)
  const S = { cfg: null, data: {}, res: null, statuses: {}, imgs: {}, imgSite: null, manual: [], manualKey: "", reviewAt: null, pick: false, scanKey: null, stale: false, running: false, center: null, autoSite: "", lf: {}, report: null, sending: false, rid: "", rev: 0, buildSeq: 0, building: false, pending: false, uk: "", lastUser: "", driveTry: -1, saved: null };
  let rebuildTimer = null;   // טיימר העריכה הרכה (null = אין עדכון ממתין)
  let autoTimer = null, autoFor = -1;   // טיימר השמירה האוטומטית בדרייב (null = אין) והגרסה (S.rev) שהוא מתוזמן אליה
  // מפתחות הבסיס של הנתונים השמורים בדפדפן. כולם שייכים למשתמש: הנשמר בפועל הוא <בסיס>:<גיבוב שם המשתמש> (ukey), כך שמשתמש אחר באותו דפדפן לא רואה ולא יורש אותם. מתגי השכבות (icd_req_layers_v1) נשארים גלובליים — אינם נתוני משתמש
  const PERSON_KEY = "icd_req_person_v1", AIRCRAFT_KEY = "icd_req_aircraft_v1";
  const MAX_EXTRA_AC = 30;   // תקרת כלי הטיס הנוספים השמורים בדפדפן — נאכפת גם בהוספה וגם בטעינה (אחרת כלים מעל התקרה נשמרים ואז נעלמים בשקט)
  const PURPOSE_KEY = "icd_req_purposes_v1", MAX_EXTRA_PURPOSES = 30, PURPOSE_MAX = 80;   // מהויות פעילות נוספות (כמו כלי טיס): התקרה נאכפת בהוספה ובטעינה; PURPOSE_MAX זהה ל-PURPOSE_MAX ב-core.js (validateInput)
  const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", OSM = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const esc = C.esc;
  const LY = window.ReqLayers;   // שכבות איסורים ונוטמים + פס סיכום לנקודה (js/maplayers.js) — תצוגה מקדימה בלבד
  // ארבע התמונות המצורפות לכל בקשה (המפתחות קבועים בחוזה mapimg/output/ui): אפשרויות הציור, התווית בשם הקובץ, כפתור ההורדה והשם בחלון השליחה
  const IMGS = [
    { k: "aerial", opts: { view: "detail", provider: "esri" }, file: "תצ״א תקריב", btn: "btnAerial", send: "תצ״א — תקריב" },
    { k: "street", opts: { view: "detail", provider: "osm" }, file: "מפת רחובות תקריב", btn: "btnStreet", send: "מפת רחובות — תקריב" },
    { k: "overview", opts: { view: "overview", provider: "esri" }, file: "הדמיה מבט כללי", btn: "btnOverview", send: "הדמיה וסימונים — מבט כללי" },
    { k: "region", opts: { view: "region", provider: "esri", labels: true }, file: "מפת אזור", btn: "btnRegion", send: "מפת אזור — מרוחק" }
  ];

  /* ---------- עזרים ---------- */
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* פרטיות/חסימה */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  // אחסון לפי המשתמש המחובר (S.uk = C.userHash של שם המשתמש, נקבע ב-req-auth). בלי משתמש מחובר אין מפתח ולכן לא קוראים ולא כותבים ("" / null) — אין נתונים "בלי בעלים".
  // הגיבוב סינכרוני (core.js): כל שמירה/טעינה בזמן הקלדה והתחברות סינכרונית. שם המשתמש עצמו לא נכתב בשם המפתח
  const ukey = base => S.uk ? base + ":" + S.uk : "";
  const lsGet = base => { const k = ukey(base); return k ? ls.get(k) : null; };
  const lsSet = (base, v) => { const k = ukey(base); if (k) ls.set(k, v); };
  const lsDel = base => { const k = ukey(base); if (k) ls.del(k); };
  // כתובת ייחודית בכל בקשה: עוקפת את מטמון ה-HTTP של GitHub Pages ואת ה-service worker של המפה (שמגיש מהמטמון כשהרשת איטית)
  const bust = u => u + (u.indexOf("?") >= 0 ? "&" : "?") + "_=" + Date.now();
  async function getJson(url) {
    const r = await fetch(bust(url), { cache: "no-store" });
    if (!r.ok) throw new Error(url + " — HTTP " + r.status);
    return r.json();
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));
  // מזהה בקשה: אותה בקשה נשמרת תמיד לאותה תיקייה בדרייב, ובקשה אחרת (גם באותו מקום ותאריך) — לתיקייה נפרדת
  const newRid = () => { const a = new Uint8Array(12); (window.crypto || window.msCrypto).getRandomValues(a); return [...a].map(x => x.toString(16).padStart(2, "0")).join(""); };
  // תוצאות שמירה/שליחה שייכות לבקשה שנשמרה; כשהבקשה משתנה או מורצת מחדש הן כבר לא נכונות ולא נשארות על המסך
  function clearOutcome() {
    S.rev++;   // כל נתיב ששינה את הבקשה עובר כאן: שמירה בדרייב שהתחילה לפני השינוי תזהה אותו (persistToDrive)
    S.sent = null; S.driveUrl = ""; S.saved = null;
    ["driveMsg", "sendMsg"].forEach(id => { const e = $(id); if (e) { e.textContent = ""; e.className = "small"; } });
    if (S.onStale) { if ($("sendProg")) S.onStale(); else S.onStale = null; }   // חלון שליחה פתוח (sendToNotam): הבקשה השתנתה מאחוריו — הוא ננעל ומסביר, במקום להמתין ללחיצה
  }
  // opts.maint: ההודעה היא פירוט תחזוקה (שמות קבצים, HTTP, מהדורות, הוראות למתחזק) — מוצגת רק למנהל; מטיס רגיל מקבל opts.user אם ניתן, ואחרת ניסוח ניטרלי (maintNote). opts.adv: הפירוט מוצג גם למי שיש לו תצוגה מתקדמת
  function setStatus(k, ok, msg, opts) { S.statuses[k] = { ok: !!ok, msg: msg || "", maint: !!(opts && opts.maint), adv: !!(opts && opts.adv), user: opts && typeof opts.user === "string" ? opts.user : null }; refreshGate(); }
  // כתובת התמיכה (config.json → support_email) מצורפת לכל הודעה שמפנה ל"תמיכה" (auth.js: withSupport); ללא כתובת תקינה — ההודעה כמות שהיא
  const sup = t => (window.ReqAuth && window.ReqAuth.withSupport) ? window.ReqAuth.withSupport(t) : t;
  const maintNote = () => sup("הנתונים מתעדכנים כעת; נסו שוב בעוד מספר דקות, ואם זה נמשך פנו לתמיכה.");
  // st.adv: פירוט שגם משתמש עם תצוגה מתקדמת רואה (הבדיקה העצמית — הפירוט גלוי לו בתיבת הבדיקה העצמית); מטיס בלעדיה מקבל את הניסוח הניטרלי
  const statusMsg = st => !st ? "" : (isAdmin() || !st.maint || (st.adv && isAdv())) ? st.msg : (st.user != null ? st.user : maintNote());

  /* ---------- טעינת נתונים סטטיים ---------- */
  // טוען את כל הנתונים שנגזרים מהמפה ומהנוטמים (אזורים, שמורות, חוקי ב-09, מנחתים חקלאיים, נוטמים) — וגם בטעינה מחדש אחרי עדכון
  function loadData() {
    return [
      ["a17", Promise.all([getJson("../data/zones.json"), getJson("../data/inpa-zones.json"), getJson("../data/pmt-b09-rules.json")]).then(([z, i, r9]) => { z.rules09 = r9; S.data.zones = z; S.data.inpa = i; return (z.edition || "") + " · " + z.zones.length + " אזורים, " + i.sites.length + " אתרי רט״ג"; })],
      ["agri", getJson("../data/agri-airstrips.json").then(a => { S.data.agri = a; return a.airstrips.length + " מנחתים"; })],
      ["notam", loadNotams()]
    ];
  }
  const applyJobs = jobs => Promise.all(jobs.map(([k, p]) => p.then(m => setStatus(k, true, m), e => setStatus(k, false, "לא נטען: " + (e && e.message ? e.message : e), { maint: true })))).then(r => { try { layerDataChanged(); } catch (e) { logLayerErr("layerDataChanged", e); } return r; });   // אחרי כל טעינה (גם טעינה מחדש ב-checkSync): מציירים מחדש את השכבות והפס. כשל בתצוגה לעולם לא דוחה את הטעינה ולא עוצר את init


  async function loadStatic() {
    try { S.cfg = await getJson("config.json"); }
    catch (e) { $("e_run").textContent = "לא נטען קובץ ההגדרות: " + e.message; return false; }
    try { window.ReqAuth.setConfig(S.cfg); } catch (e) { /* ignore */ }   // כתובת התמיכה זמינה להודעות הסנכרון כבר לפני ההתחברות
    buildControls();
    const jobs = loadData();
    await applyJobs(jobs);
    await checkSync();
    setInterval(checkSync, (S.cfg && S.cfg.sync_interval_ms) || 15 * 60 * 1000);   // גם בדף שנשאר פתוח שעות
    return true;
  }
  async function loadNotams() {
    const d = await getJson("../../notam-all.json");
    if (!d || !Array.isArray(d.notams) || !d.notams.length || !(d.count > 0) || !(d.listed > 0)) throw new Error("קובץ הנוטמים ריק או חסר — אי אפשר להסיק שאין סגירות");
    const missing = (d.failed && d.failed.length) || (d.listed > d.count ? d.listed - d.count : 0);
    if (missing) throw new Error("הקובץ אינו שלם: חסרים פרטים ל-" + missing + " נוטמים" + (d.failed && d.failed.length ? " (" + d.failed.join(", ") + ")" : "") + " — ממתינים לעדכון הבא");
    S.data.notams = d.notams; S.data.notamFetchedIso = d.fetched_iso;
    return d.notams.length + " נוטמים, נמשכו " + d.fetched_at;
  }

  /* ---------- סנכרון עם מפת החברים: המפה מתעדכנת בפרויקט אחר, ואסור לעבוד על מידע ישן ---------- */
  // כל הקבצים נמשכים טריים (כתובת ייחודית) ומושווים: זה לזה (המפה מול הייצוא), לנתונים שבזיכרון הדף, ולנתונים שעליהם נעשה הניתוח
  let syncBusy = null, syncRetry = null;
  // כשהסנכרון נכשל הדף חוסם — ובודק שוב מעצמו (ברירת מחדל כל 30 שניות) עד שהוא מצליח, כדי שדף פתוח יתאושש אחרי שהייצוא האוטומטי הסתיים
  function scheduleSyncRetry(ok) {
    if (ok) { if (syncRetry) { clearTimeout(syncRetry); syncRetry = null; } return; }
    if (!syncRetry) syncRetry = setTimeout(() => { syncRetry = null; checkSync(); }, (S.cfg && S.cfg.sync_retry_ms) || 30000);
  }
  async function fetchSyncInputs() {
    const getText = async u => { const r = await fetch(bust(u), { cache: "no-store" }); if (!r.ok) throw new Error(u + " — HTTP " + r.status); return r.text(); };
    const [html, meta, mapNotam, notamAll, zones] = await Promise.all([getText("../index.html"), getJson("../pamat-meta.json"), getJson("../../notam-data.json"), getJson("../../notam-all.json"), getJson("../data/zones.json")]);
    return { html, meta, mapNotam, notamAll, zones };
  }
  // מה שמטיס רגיל רואה מתוצאת הסנכרון: הודעות מסוג "user" (הדף טוען מחדש, יש להריץ את הבדיקות שוב) כלשונן, וכל שאר הבעיות (kind "maint": נתוני המפה, מהדורת פמ״ת, קבצי ייצוא — דברים שרק המנהל יכול לטפל בהם) כניסוח ניטרלי אחד. תשובה בלי kind (sync.js ישן) — הכול תחזוקה
  function pilotProblems(res) {
    const items = res.items || res.problems.map(t => ({ kind: "maint", text: t }));
    const out = items.filter(i => i.kind === "user").map(i => i.text);
    if (items.some(i => i.kind !== "user")) out.unshift(maintNote());
    return out;
  }
  // הבאנר בראש הדף: למנהל — כל הפירוט; למטיס רגיל — ניסוח ניטרלי בלי שמות קבצים והוראות תחזוקה. נקרא אחרי כל בדיקה ושוב אחרי ההתחברות (התפקיד ידוע רק אז)
  function renderSyncBanner() {
    const b = $("syncBanner"), res = S.syncRes;
    if (!b) return;
    if (!res || res.ok) { b.style.display = "none"; return; }
    b.style.display = "block";
    b.innerHTML = isAdmin()
      ? "<b>הנתונים אינם מסונכרנים עם מפת החברים — אי אפשר להשלים בקשה עד שהסנכרון יושלם.</b><ul>" + res.problems.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul>"
      : "<b>הנתונים מתעדכנים כעת — אי אפשר להשלים בקשה עד שהעדכון יושלם.</b><ul>" + pilotProblems(res).map(x => "<li>" + esc(x) + "</li>").join("") + "</ul>";
  }
  async function checkSync() {
    if (syncBusy) return syncBusy;
    syncBusy = (async () => {
      try {
        let res = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          const f = await fetchSyncInputs();
          res = await window.ReqSync.check({ ...f, cfg: S.cfg, loaded: { zonesHash: S.data.zones && S.data.zones.dataHash, notamIso: S.data.notamFetchedIso }, analysis: S.analysisStamp || null });
          if (res.reload && attempt === 0) { await applyJobs(loadData()); if (S.res) { S.stale = true; S.staleWhy = "data"; } continue; }   // נתוני הדף ישנים: טוענים מחדש ובודקים שוב
          break;
        }
        if (res.analysisStale && S.res) { S.stale = true; S.staleWhy = "data"; }
        S.syncRes = res;
        setStatus("sync", res.ok, res.problems.join(" · "), { maint: true, user: pilotProblems(res).join(" · ") });
        renderSyncBanner();
        S.syncAt = new Date();
        scheduleSyncRetry(res.ok);
        return res.ok;
      } catch (e) {
        setStatus("sync", false, "לא ניתן לאמת סנכרון עם המפה: " + (e && e.message ? e.message : e), { maint: true });   // הפירוט (כתובות קבצים, HTTP) למנהל; מטיס רגיל מקבל ניסוח ניטרלי
        scheduleSyncRetry(false);
        return false;
      } finally { syncBusy = null; }
    })();
    return syncBusy;
  }

  /* ---------- הסברים ללחצני "!" (js/help.js): כל טקסט מתאר את מה שהכפתור עושה בפועל בקוד ---------- */
  const HELP = {
    qBtn: "מחפש את המקום שהקלדתם בשדה החיפוש באתר Nominatim של OpenStreetMap (ישראל והשטחים) ומציג עד 6 תוצאות לבחירה. בחירת תוצאה קובעת אותה כמרכז הסגירה ומזיזה אליה את המפה; ואם כבר הורצו בדיקות, יש להריץ אותן שוב. החיפוש עצמו אינו מריץ בדיקות.",
    baseSat: "מחליף את רקע מפת העבודה שלמעלה לצילום אוויר (Esri). זה משפיע רק על התצוגה כאן — לא על ארבע התמונות שנוצרות לבקשה.",
    baseOsm: "מחליף את רקע מפת העבודה שלמעלה למפת רחובות (OpenStreetMap). זה משפיע רק על התצוגה כאן — לא על ארבע התמונות שנוצרות לבקשה.",
    runBtn: "מריץ את כל הבדיקות לנקודה, לרדיוס, לגובה ולמועדים שהוזנו: אזורי פמ״ת א-17 ופרק ב-09, שמורות וגנים, מנחתים חקלאיים, נוטמים, וסריקת מכשולים ותשתיות ב-OpenStreetMap. בסיום הוא מכין את הטופס ואת ארבע תמונות המפה. הבקשה תסומן ״מוכנה לשליחה״ רק אחרי שכל הבדיקות הצליחו ואישרתם את ההצהרה בסעיף 4.",
    mPick: "אחרי הלחיצה, לחיצה אחת על המפה שמעל מכניסה את הנ״צ שנלחץ לשדה ״נ״צ״ של התוספת הידנית. הלחיצה הזו אינה משנה את מרכז הסגירה.",
    mAdd: "מוסיף את המכשול או התשתית שהזנתם (שם, נ״צ וגובה אופציונלי) לבקשה: הם נכנסים לשדה 8 בטופס, לתמונות המפה ול-KML. ההוספה מריצה מחדש את הניתוח ומבטלת את אישור ההצהרה — יש לאשר אותה שוב.",
    btnPrint: "פותח את חלון ההדפסה של הדפדפן, ומשם אפשר להדפיס או לשמור כ-PDF. מודפס הדוח בלבד: הטופס, ארבע התמונות, וכן דף הבדיקות אם ״כולל דף בדיקות״ מסומן.",
    btnDocx: "מוריד קובץ Word לעריכה: טופס נספח ג׳, ארבע התמונות וטבלת המכשולים והתשתיות. דף הבדיקות נכלל רק אם ״כולל דף בדיקות״ מסומן.",
    incChecks: "קובע אם דף הבדיקות נכלל בקובץ ה-Word, בהדפסה ובקבצים שנשמרים בדרייב ונשלחים במייל. שינוי הסימון מוחק את ההודעות ״נשמר״ ו״נשלח״, והבקשה תישמר מחדש בדרייב (אוטומטית).",
    btnKml: "מוריד קובץ KML לפתיחה ב-Google Earth, עם מעגלי הסגירה, אזורי האיסור והמכשולים והתשתיות שנמצאו.",
    btnAerial: "מוריד את תמונת התצ״א בתקריב (PNG), עם כל הסימונים — כפי שהיא מצורפת לבקשה.",
    btnStreet: "מוריד את מפת הרחובות (OpenStreetMap) בתקריב (PNG), עם שמות הרחובות וכל הסימונים — כפי שהיא מצורפת לבקשה.",
    btnOverview: "מוריד את ההדמיה במבט כללי (PNG): כל האזורים, המכשולים והתשתיות שמופיעים בשדה 8, ממוספרים לפי הרשימה.",
    btnRegion: "מוריד את מפת האזור המרוחקת (PNG), בטווח של כ-10 ק״מ ומעלה, עם סמן וחץ שמצביעים על המיקום. הפריטים מסומנים בה בלי מספרים.",
    btnMore: "פותח וסוגר את רשימת ההורדות: הדפסה או שמירה כ-PDF, קובץ Word לעריכה (עם ״כולל דף בדיקות״), קובץ KML וארבע תמונות המפה (PNG). אין בהן צורך כדי לשלוח: השליחה במייל מצרפת את הקבצים בעצמה, והבקשה נשמרת בדרייב אוטומטית.",
    btnCopy: "מעתיק ללוח את נוסח המייל המוכן (נמענים, נושא וגוף ההודעה) כדי להדביק בתוכנת המייל. לא שולח ולא שומר דבר.",
    btnDrive: "שומר את כל קבצי הבקשה — Word, KML, ארבע התמונות וקובץ נתוני הבקשה — בארכיון המרכזי של הארגון בדרייב (בקשות הארגון בתיקיית ״הארגון״, בקשות מטיסים עצמאיים בתיקיית ״מטיסים״ תחת שם המשתמש), בלי לשלוח. השמירה מתבצעת אוטומטית כשכל הבדיקות הושלמו, הכול סומן וההצהרה אושרה — אין צורך ללחוץ; הכפתור מיועד לשמירה ידנית חוזרת, למשל כשהשמירה האוטומטית נכשלה. התיקייה נמצאת בדרייב של בעל המערכת ולכן הקישור אליה מוצג לבעל המערכת בלבד. שמירה חוזרת של אותה בקשה מחליפה את הקבצים באותה תיקייה.",
    btnSend: "פותח חלון אישור; אחרי שתאשרו הוא שולח את הבקשה במייל כשכל הקבצים מצורפים אוטומטית (טופס Word, KML וארבע תמונות המפה) — אין צורך להוריד או לצרף דבר; גוף המייל קצר, וכל הפרטים בטופס המצורף. אם הגרסה הנוכחית עדיין לא נשמרה בארכיון המרכזי בדרייב (בדרך כלל היא כבר נשמרה אוטומטית) היא נשמרת קודם; התיקייה אינה נפתחת למטיס. במצב חי תבחרו: ״שלח למשרד נוטאם״ (notamoffice@iaa.gov.il, nofm@iaa.gov.il) — המייל יוצא בשם הגורם המבקש שהצהרתם עליו (בתוספת ״— דרך מערכת בקשות הטיסה״), עותק נשלח אליכם לכתובת שנרשמה בחשבון, ותשובות המשרד יגיעו אליכם; או ״שלח רק לעצמי״ — עותק לבדיקה אליכם בלבד, שלא נשלח למשרד. במצב בדיקה המייל נשלח רק אליכם. בכל שליחה צוות התמיכה של המערכת מקבל עותק סמוי לצורכי תמיכה בלבד. שליחה למשרד נוטאם אינה ניתנת לביטול.",
    btnMail: "פותח את תוכנת המייל עם הנמענים, הנושא וגוף ההודעה ממולאים. הקבצים אינם מצורפים אוטומטית — יש לצרף אותם ידנית (לשליחה עם הקבצים מצורפים אוטומטית — ״שלח למשרד נוטאם״).",
    acAdd: "מוסיף את שם כלי הטיס שהקלדתם לרשימה ומסמן אותו. הוא נשמר בדפדפן הזה בלבד (לא בשרת), ורק עבור החשבון שלכם, ויופיע גם בביקורים הבאים — עד " + MAX_EXTRA_AC + " כלי טיס נוספים; מעל זה יש להסיר כלי כדי להוסיף. כלי שנוסף כך מוצג עם × שמסיר אותו מהרשימה השמורה; כלים הקבועים בהגדרות המערכת אינם ניתנים להסרה.",
    puAdd: "מוסיף את המהות שהקלדתם (עד " + PURPOSE_MAX + " תווים) לרשימת ״מהות הפעילות״ ובוחר אותה מיד. היא נשמרת בדפדפן הזה בלבד (לא בשרת), ורק עבור החשבון שלכם, ותופיע גם בביקורים הבאים — עד " + MAX_EXTRA_PURPOSES + " מהויות נוספות; מעל זה יש להסיר אחת כדי להוסיף. בבקשה אחת נבחרת מהות אחת, והיא נכנסת כלשונה לשדה 4 בטופס הרשמי ולקובץ ה-Word (לא לגוף המייל הקצר). מהות שהוספתם מוצגת מתחת לשדה עם × שמסירה אותה מהרשימה השמורה; את המהויות הקבועות בהגדרות המערכת אי אפשר להסיר.",
    addContact: "מוסיף שורה לאיש קשר נוסף בשטח (שם וטלפון), עד 20. נדרשים לפחות שני אנשי קשר עם שם, ולפחות טלפון תקין אחד (נספח ג׳ שדה 12). אנשי הקשר נשמרים בדפדפן הזה בלבד, ורק עבור החשבון שלכם.",
    addPart: "מוסיף שורה למשתתף נוסף בטיסה (שם פרטי, שם משפחה וטלפון), עד 20. הרשימה אופציונלית, ואין חובה לטוס יחד. משתתפים מלאים נכנסים לשדה 11 בטופס ולקובץ ה-Word (לא לגוף המייל הקצר); שורה שמולאה חלקית חוסמת את ההרצה. המשתתפים אינם נשמרים בדפדפן.",
    wipePerson: "מוחק מהדפדפן הזה את הפרטים השמורים של החשבון המחובר: שם וטלפון המבקש, שם הגורם המבקש, אות הקריאה ומס׳ הרישום ואת אנשי הקשר השמורים, מנקה את השדות ומחזיר שתי שורות ריקות לאנשי הקשר; גם רשימת המשתתפים מתרוקנת. קבצים שכבר נשמרו בדרייב אינם משתנים.",
    stRun: "מריץ מחדש את הבדיקה העצמית: מחשב את נקודת הירקון מנתוני אמת שנשמרו מראש ומשווה לתוצאות שחושבו בנפרד. הבדיקה רצה גם אוטומטית בכל טעינת דף; אם נכשלה — הבקשה אינה מסומנת כמוכנה לשליחה."
  };
  // הסבר ״שלח״ לחשבון ארגוני (מוחלף ב-data-help אחרי ההתחברות, ב-applyRole): שליחה בשם הארגון, עותק ותשובות אל הארגון
  const HELP_SEND_ORG = "פותח חלון אישור; אחרי שתאשרו הוא שולח את הבקשה במייל בשם הארגון (שם השולח ״הארגון הישראלי לרב להב״), וכל הקבצים מצורפים אוטומטית (טופס Word, KML וארבע תמונות המפה) — אין צורך להוריד או לצרף דבר; גוף המייל קצר, וכל הפרטים בטופס המצורף. אם הגרסה הנוכחית עדיין לא נשמרה בארכיון הארגון בדרייב (תיקיית ״הארגון״; בדרך כלל היא כבר נשמרה אוטומטית) היא נשמרת קודם. במצב חי תבחרו: ״שלח למשרד נוטאם״ (notamoffice@iaa.gov.il, nofm@iaa.gov.il) — עותק נשלח לארגון (ולכתובת שנרשמה בחשבונכם, אם יש), ותשובות המשרד יחזרו אל הארגון; או ״שלח רק לעצמי״ — עותק לבדיקה בלבד, שלא נשלח למשרד. במצב בדיקה המייל נשלח רק לכתובת שנרשמה בחשבון (ובלעדיה — לכתובת הארגון). שליחה למשרד נוטאם אינה ניתנת לביטול.";
  // תוספת להסבר ״אפשרויות נוספות״ למנהל (applyRole): רק הוא רואה את המייל הידני
  const HELP_MORE_ADMIN = " למנהל נוספים כאן גם העתקת נוסח המייל ופתיחת המייל בתוכנת המייל — שליחה כזו אינה מצרפת קבצים ואינה נרשמת ביומן השליחות.";
  // שם קצר וסטטי של מה שהלחצן מסביר — ל-aria-label של קורא מסך ("הסבר על: <שם>"). נקבע כאן ולא נקרא מתווית הכפתור, שעשויה להשתנות
  const HELP_NAME = {
    qBtn: "חיפוש מקום", baseSat: "רקע צילום אוויר", baseOsm: "רקע מפת רחובות", runBtn: "הרצת הבדיקות", mPick: "בחירת מיקום מהמפה", mAdd: "הוספה לבקשה", btnPrint: "הדפסה או PDF", btnDocx: "הורדת Word",
    incChecks: "כולל דף בדיקות", btnKml: "הורדת KML", btnAerial: "הורדת תצ״א תקריב", btnStreet: "הורדת מפת רחובות תקריב", btnOverview: "הורדת הדמיה במבט כללי", btnRegion: "הורדת מפת אזור", btnCopy: "העתקת טקסט מייל",
    btnMore: "אפשרויות נוספות", btnDrive: "שמירה בדרייב", btnSend: "שליחה למשרד נוטאם", btnMail: "פתיחת מייל", acAdd: "הוספת כלי טיס", puAdd: "הוספת מהות פעילות", addContact: "הוספת איש קשר", addPart: "הוספת משתתף", wipePerson: "מחיקת פרטים מהמכשיר", stRun: "בדיקה עצמית",
    knownObs: "מכשולים שידועים למבקש", visitNotes: "הערות המבקש"
  };
  const HELP_FIELD = {
    knownObs: "מכשולים שאתם מכירים באתר, עד " + (C.KO_MAX || 20) + " פריטים, מופרדים בפסיק, בנקודה-פסיק או בשורה חדשה (יותר מזה חוסם את ההרצה). כל פריט מושווה לסריקה לפי מילים בלבד (בלי מיקום): התאמה אפשרית מוצגת בדף הבדיקות, ופריט שלא נמצא מופיע כאזהרה מעל הדוח וגם בדף הבדיקות. ההשוואה אינה מחליפה סימון ידני בסעיף 4. הטקסט נכנס לשדה 8 בטופס ולקובץ ה-Word כלשונו (לא לגוף המייל הקצר).",
    visitNotes: "מלל חופשי, למשל ממצאי סיור באתר. ההערות, ותאריך הסיור אם הוזן, מופיעים בדף הבדיקות (בסעיף ״הנקודה״) ובקובץ ה-Word בלבד — לא בשדות הטופס ולא בנוסח המייל. כל שינוי בהן מוחק את ההודעות ״נשמר״ ו״נשלח״."
  };
  function wrapHelp(el, text, name) {
    if (!el || !H || el.closest(".hw")) return;
    const w = document.createElement("span"); w.className = "hw";
    el.parentNode.insertBefore(w, el); w.appendChild(el); w.insertAdjacentHTML("beforeend", H.btn(text, name));
  }
  function attachHelp() {
    Object.keys(HELP).forEach(id => { const el = $(id); if (el) wrapHelp(id === "incChecks" ? el.closest("label") : el, HELP[id], HELP_NAME[id]); });
    Object.keys(HELP_FIELD).forEach(id => { const el = $(id), h = el && el.parentNode.querySelector(".flh"); if (h && H) h.insertAdjacentHTML("beforeend", H.btn(HELP_FIELD[id], HELP_NAME[id])); });
  }

  /* ---------- כלי טיס נוספים (נשמרים בדפדפן) ---------- */
  // ניקוי: בלי תווי בקרה, רווחים מכווצים ו-trim, עד 60 תווים. השוואת כפילויות לא תלויה ברישיות
  const cleanAircraft = t => String(t == null ? "" : t).replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  const acKey = t => cleanAircraft(t).toLowerCase();
  function loadExtraAircraft() {
    let a = []; try { a = JSON.parse(lsGet(AIRCRAFT_KEY) || "[]"); } catch (e) { a = []; }
    const seen = new Set((S.cfg.aircraft || []).map(acKey)), out = [];
    (Array.isArray(a) ? a : []).forEach(x => { const n = cleanAircraft(x); if (n && !seen.has(acKey(n)) && out.length < MAX_EXTRA_AC) { seen.add(acKey(n)); out.push(n); } });
    return out;
  }
  const saveExtraAircraft = () => lsSet(AIRCRAFT_KEY, JSON.stringify(S.extraAc));
  const checkedAc = () => new Set([...document.querySelectorAll('input[name="ac"]:checked')].map(i => acKey(i.value)));
  // keep: קבוצת המפתחות המסומנים כרגע (שומרת את הסימון בעת רינדור מחדש). אף כלי טיס אינו מסומן מראש (גם לא הראשון בהגדרות): הכלי נכנס לבקשה הרשמית לרשות שדות התעופה כהצהרה של המטיס, ולכן הוא חייב לבחור בעצמו;
  // בלי בחירה — שגיאת האימות "יש לבחור כלי טיס" (core.js validateInput) חוסמת את ההרצה. רשימת config.json היא הצעות בלבד
  function renderAircraft(keep) {
    const on = name => !!keep && keep.has(acKey(name));
    $("aircraft").innerHTML = S.cfg.aircraft.map(a => '<label><input autocomplete="off" type="checkbox" name="ac" value="' + esc(a) + '"' + (on(a) ? " checked" : "") + "> " + esc(a) + "</label>").join("") +
      S.extraAc.map((a, i) => '<span class="acx"><label><input autocomplete="off" type="checkbox" name="ac" value="' + esc(a) + '"' + (on(a) ? " checked" : "") + "> " + esc(a) + '</label><button type="button" class="xbtn" data-acrm="' + i + '" title="הסר מהרשימה השמורה" aria-label="' + esc("הסר את " + a + " מהרשימה השמורה") + '">×</button></span>').join("");
  }
  function addAircraft() {
    const name = cleanAircraft($("acNew").value), msg = $("acMsg");
    msg.textContent = "";
    if (!name) { msg.textContent = "יש להקליד שם כלי טיס."; return; }
    const k = acKey(name), have = S.cfg.aircraft.concat(S.extraAc).find(a => acKey(a) === k), keep = checkedAc();
    if (!have && S.extraAc.length >= MAX_EXTRA_AC) { msg.textContent = "ניתן לשמור עד " + MAX_EXTRA_AC + " כלי טיס נוספים — הסירו כלי כדי להוסיף."; return; }   // בלי הוספה; השם נשאר בשדה
    if (!have) { S.extraAc.push(name); saveExtraAircraft(); }
    keep.add(k);   // כלי שכבר קיים (גם קבוע, בכל רישיות) — רק מסמנים אותו, בלי כפילות
    renderAircraft(keep);
    $("acNew").value = "";
    if (have) msg.textContent = "״" + have + "״ כבר ברשימה — סומן.";
    onSoftInputChange();
  }
  function removeAircraft(i) {
    const keep = checkedAc(), gone = S.extraAc.splice(i, 1)[0];
    if (gone == null) return;
    keep.delete(acKey(gone)); saveExtraAircraft(); renderAircraft(keep);
    onSoftInputChange();
  }

  /* ---------- מהויות פעילות נוספות (נשמרות בדפדפן; בבקשה אחת נבחרת מהות אחת, ב-select#purpose) ---------- */
  // אותה תבנית כמו כלי טיס: ניקוי (בלי תווי בקרה, רווחים מכווצים, trim), כפילות לא תלויה ברישיות, תקרה בהוספה ובטעינה. מה שנחשב מהות חוקית נקבע ב-C.validateInput (core.js)
  let extraPu = [];   // המהויות שהמשתמש הוסיף, לפי סדר ההוספה (המהויות הקבועות ב-S.cfg.purposes ואינן ניתנות להסרה)
  // תווים אסורים (בקרה, U+2028/2029, חצי סרוגייט בודד, U+FFFE/FFFF — כמו purposeHasBadChar ב-core.js) הופכים לרווח, ואז רווחים מכווצים ו-trim.
  // בלי חיתוך: מהות ארוכה מ-PURPOSE_MAX נדחית, לא נחתכת בשקט
  function cleanPurpose(t) {
    let o = "";
    for (const ch of String(t == null ? "" : t)) { const c = ch.codePointAt(0); o += (c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029 || (c >= 0xd800 && c <= 0xdfff) || c === 0xfffe || c === 0xffff) ? " " : ch; }
    return o.replace(/\s+/g, " ").trim();
  }
  const puKey = t => cleanPurpose(t).toLowerCase();
  // טעינה מוגנת מ-localStorage משובש: JSON שבור / לא מערך -> ריק; ערך שאינו מחרוזת או ארוך מדי נזרק; בלי כפילויות (גם מול הקבועות); לא יותר מהתקרה
  function loadExtraPurposes() {
    let a = []; try { a = JSON.parse(lsGet(PURPOSE_KEY) || "[]"); } catch (e) { a = []; }
    const seen = new Set((S.cfg.purposes || []).map(puKey)), out = [];
    (Array.isArray(a) ? a : []).forEach(x => {
      if (typeof x !== "string" || x.length > 4 * PURPOSE_MAX) return;   // הבדיקה הראשונה חוסכת ניקוי של מחרוזת ענקית
      const n = cleanPurpose(x), k = n.toLowerCase();
      if (n && C.purposeHasVisible(n) && C.purposeLen(n) <= PURPOSE_MAX && !seen.has(k) && out.length < MAX_EXTRA_PURPOSES) { seen.add(k); out.push(n); }   // גם ערך שנשמר בעבר ושכולו תווים בלתי נראים נזרק
    });
    return out;
  }
  const saveExtraPurposes = () => lsSet(PURPOSE_KEY, JSON.stringify(extraPu));
  // sel: המהות שתיבחר ("" = ״בחרו…״; ערך שאינו ברשימה גם הוא חוזר ל״בחרו…״). הכול נכנס ל-HTML דרך esc
  function renderPurposes(sel) {
    const el = $("purpose"), opt = p => '<option value="' + esc(p) + '">' + esc(p) + "</option>";
    el.innerHTML = '<option value="">בחרו…</option>' + S.cfg.purposes.map(opt).join("") + extraPu.map(opt).join("");
    el.value = sel || ""; if (el.value !== (sel || "")) el.value = "";
    $("puList").innerHTML = extraPu.map((p, i) => '<span class="acx pux"><span>' + esc(p) + '</span><button type="button" class="xbtn" data-purm="' + i + '" title="הסר מהרשימה השמורה" aria-label="' + esc("הסר את " + p + " מהרשימה השמורה") + '">×</button></span>').join("");
    $("puSaved").hidden = !extraPu.length;
  }
  function addPurpose() {
    const name = cleanPurpose($("puNew").value), msg = $("puMsg");
    msg.textContent = "";
    if (!name) { msg.textContent = "יש להקליד מהות פעילות."; return; }
    if (!C.purposeHasVisible(name)) { msg.textContent = "המהות אינה מכילה תווים גלויים — יש להקליד מהות פעילות."; return; }   // למשל תו RLM/רווח בלתי נראה שהודבק: נראית ריקה בטופס. בלי הוספה; הטקסט נשאר בשדה
    if (C.purposeLen(name) > PURPOSE_MAX) { msg.textContent = "מהות הפעילות ארוכה מדי — עד " + PURPOSE_MAX + " תווים (הוקלדו " + C.purposeLen(name) + ")."; return; }   // בלי הוספה; השם נשאר בשדה. שדה ההוספה מקבל עד 4×PURPOSE_MAX, ולכן הדבקה ארוכה מגיעה לכאן ולא נחתכת בשקט
    const k = name.toLowerCase(), have = S.cfg.purposes.concat(extraPu).find(p => puKey(p) === k);
    if (!have && extraPu.length >= MAX_EXTRA_PURPOSES) { msg.textContent = "ניתן לשמור עד " + MAX_EXTRA_PURPOSES + " מהויות פעילות נוספות — הסירו אחת כדי להוסיף"; return; }   // בלי הוספה; השם נשאר בשדה
    if (!have) { extraPu.push(name); saveExtraPurposes(); }
    renderPurposes(have || name);   // מהות שכבר קיימת (גם קבועה, בכל רישיות) — רק בוחרים אותה, בלי כפילות
    $("puNew").value = "";
    if (have) msg.textContent = "״" + have + "״ כבר ברשימה — נבחרה.";
    onSoftInputChange();
  }
  function removePurpose(i) {
    const gone = extraPu.splice(i, 1)[0];
    if (gone == null) return;
    const cur = $("purpose").value;
    saveExtraPurposes(); renderPurposes(cur === gone ? "" : cur);   // אם הוסרה הנבחרת — חוזרים ל״בחרו…״
    $("puMsg").textContent = "";
    const xs = document.querySelectorAll("#puList [data-purm]");
    (xs[Math.min(i, xs.length - 1)] || $("purpose")).focus();   // המיקוד לא הולך לאיבוד עם הרינדור מחדש
    onSoftInputChange();
  }

  /* ---------- אנשי קשר ומשתתפים: שורות ב-DOM (ה-DOM הוא המצב; שורה ריקה לגמרי נזרקת בקריאה) ---------- */
  // cols: [שדה, תווית, מחלקה, סוג input, אורך מרבי]
  const LISTS = {
    contacts: { el: "contactList", add: "addContact", min: 2, label: "איש קשר", cls: "cont", cols: [["name", "שם", "pn", "text", 60], ["phone", "טלפון", "pp", "tel", 30]] },
    participants: { el: "partList", add: "addPart", min: 0, label: "משתתף", cls: "part", cols: [["first", "שם פרטי", "pn", "text", 40], ["last", "שם משפחה", "pn", "text", 40], ["phone", "טלפון", "pp", "tel", 30]] }
  };
  const rowsOf = kind => [...$(LISTS[kind].el).querySelectorAll("[data-row]")];
  const cellOf = (row, f) => row.querySelector('[data-f="' + f + '"]');
  const cellVal = (row, f) => (cellOf(row, f).value || "").trim();
  function rowHtml(kind, v) {
    const L = LISTS[kind];
    return '<div class="prow ' + L.cls + '" data-row>' + L.cols.map(([f, ph, cls, type, max]) =>
      '<input type="' + type + '" class="' + cls + '" data-f="' + f + '" placeholder="' + esc(ph) + '" aria-label="' + esc(L.label + " — " + ph) + '" maxlength="' + max + '" autocomplete="off"' + (type === "tel" ? ' dir="ltr"' : "") + ' value="' + esc((v && v[f]) || "") + '">').join("") +
      '<button type="button" class="xbtn" data-rm title="הסר שורה" aria-label="' + esc("הסר " + L.label) + '">×</button></div>';
  }
  // × מוסתר כשנשארו רק השורות המינימליות (שתי אנשי קשר); כפתור ההוספה נחסם בתקרה
  function syncRows(kind) {
    const L = LISTS[kind], rows = rowsOf(kind);
    rows.forEach(r => { r.querySelector("[data-rm]").hidden = L.min > 0 && rows.length <= L.min; });
    $(L.add).disabled = rows.length >= C.MAX_PEOPLE;
  }
  function setRows(kind, arr) {
    const L = LISTS[kind], rows = (arr || []).slice(0, C.MAX_PEOPLE);
    while (rows.length < L.min) rows.push({});
    $(L.el).innerHTML = rows.map(r => rowHtml(kind, r)).join("");
    syncRows(kind);
  }
  function addRow(kind) {
    if (rowsOf(kind).length >= C.MAX_PEOPLE) return;
    $(LISTS[kind].el).insertAdjacentHTML("beforeend", rowHtml(kind, {}));
    syncRows(kind);
    const rows = rowsOf(kind); rows[rows.length - 1].querySelector("input").focus();
    savePerson(); onSoftInputChange();
  }
  function removeRow(btn) {
    const row = btn.closest("[data-row]"); if (!row) return;
    const kind = row.parentNode.id === LISTS.contacts.el ? "contacts" : "participants";
    if (rowsOf(kind).length <= LISTS[kind].min) return;
    row.remove(); syncRows(kind);
    savePerson(); onSoftInputChange();
  }
  function readRows(kind) {
    return rowsOf(kind).map(r => { const o = {}; LISTS[kind].cols.forEach(([f]) => { o[f] = cellVal(r, f); }); return o; }).filter(o => Object.values(o).some(Boolean));
  }

  /* ---------- סוג החשבון (ארגוני / מטיס עצמאי) וברירות המחדל של הארגון ---------- */
  // חשבון ארגוני: השרת מדווח org (שרת ישן — מנהל = ארגוני), ורק כשיש התחברות תקפה. ברירות המחדל הארגוניות (שם הארגון, אות קריאה, רישום) קיימות רק ב-config.json → org_defaults; אין להוסיף כאלה למטיס עצמאי
  const isOrg = () => { const A = window.ReqAuth; return !!(A && A.loggedIn && A.loggedIn() && A.isOrg && A.isOrg()); };
  const orgDefaults = () => { const d = S.cfg && S.cfg.org_defaults; return d && typeof d === "object" ? d : null; };
  const ORG_NAME = () => { const d = orgDefaults(); return d && typeof d.name === "string" && d.name.trim() ? d.name.trim() : "הארגון הישראלי לרב להב"; };   // שם השולח במייל של חשבון ארגוני (CFG.SENDER_NAME בשרת)
  /* ---------- בקרי הטופס ---------- */
  function buildControls() {
    extraPu = loadExtraPurposes(); renderPurposes("");
    S.extraAc = loadExtraAircraft(); renderAircraft(null);
    $("radius").value = S.cfg.defaults.radius_m; $("radius").min = S.cfg.defaults.min_radius_m; $("radius").max = S.cfg.defaults.max_radius_m;
    $("mailTo").textContent = S.cfg.mail.to.join(", ");
    loadPerson();
  }
  // פרטי המבקש ואנשי הקשר נשמרים בדפדפן; משתתפים והערות הסיור לא. פורמט ישן (contactNames/contactPhone) עובר מיגרציה לרשימה לפי אינדקס
  function loadPerson() {
    let p = null; try { p = JSON.parse(lsGet(PERSON_KEY) || "null"); } catch (e) { p = null; }
    if (!p || typeof p !== "object") p = {};
    let contacts = Array.isArray(p.contacts) ? p.contacts.filter(c => c && typeof c === "object").map(c => ({ name: String(c.name || ""), phone: String(c.phone || "") })) : null, migrated = false;
    if (!contacts && (p.contactNames || p.contactPhone)) {
      const names = C.splitList(p.contactNames), phones = C.splitList(p.contactPhone);
      contacts = names.map((n, i) => ({ name: n, phone: phones[i] || "" })); migrated = true;
    }
    contacts = contacts || [];
    $("reqName").value = String(p.reqName || ""); $("reqPhone").value = String(p.reqPhone || "");
    // גורם מבקש, אות קריאה ומס׳ רישום: נשמרים מקומית עם שאר פרטי המבקש (לפי חשבון). ברירות המחדל של הארגון (config.json → org_defaults) נטענות רק בחשבון ארגוני ורק לשדה שאין לו ערך שמור (גם ערך שמור ריק הוא בחירה של המשתמש ונשאר);
    // למטיס עצמאי אין ברירת מחדל. רשומה שנשמרה בחשבון ארגוני והחשבון כבר עצמאי — ערך שהוא ברירת המחדל של הארגון לא עובר למטיס
    const od = isOrg() ? orgDefaults() : null, od0 = orgDefaults();
    const legacy = typeof p.org !== "boolean";   // רשומה שנכתבה לפני ההפרדה (בלי org): שדה ריק בה אינו בחירה של המשתמש
    const field = (k, dk) => {
      if (typeof p[k] === "string" && !(legacy && !p[k].trim())) return (p.org === true && !isOrg() && od0 && typeof od0[dk] === "string" && p[k].trim() === od0[dk].trim()) ? "" : p[k];
      return od && typeof od[dk] === "string" ? od[dk] : "";
    };
    $("reqOrg").value = field("reqOrg", "name"); $("reqCallsign").value = field("reqCallsign", "callsign"); $("reqReg").value = field("reqReg", "registration");
    $("reqCallsign").placeholder = $("reqReg").placeholder = (S.cfg.fixed && S.cfg.fixed.not_relevant) || "לא רלוונטי";
    setRows("contacts", contacts); setRows("participants", []);
    $("personBox").open = !(p.reqName && $("reqOrg").value.trim() && contacts.filter(c => c.name.trim()).length >= 2);
    if (migrated) savePerson();   // כותב בפורמט החדש ומסיר את המפתחות הישנים
  }
  function savePerson() {
    lsSet(PERSON_KEY, JSON.stringify({ reqName: $("reqName").value, reqPhone: $("reqPhone").value, reqOrg: $("reqOrg").value, reqCallsign: $("reqCallsign").value, reqReg: $("reqReg").value, contacts: readRows("contacts"), org: isOrg() }));   // org: סוג החשבון בעת השמירה (loadPerson: ברירות מחדל ארגוניות לא עוברות למי שהפך לעצמאי)
  }
  // ניקוי שדות פרטי המבקש בדף בלבד (בלי לגעת באחסון)
  function clearPersonFields() {
    $("reqName").value = ""; $("reqPhone").value = ""; $("reqOrg").value = ""; $("reqCallsign").value = ""; $("reqReg").value = "";
    setRows("contacts", []); setRows("participants", []);
  }
  function wipePerson() {
    if (!authed()) return;
    lsDel(PERSON_KEY);   // רק של המשתמש המחובר
    clearPersonFields();
    onSoftInputChange();
  }
  /* ---------- בידוד בין חשבונות באותו דפדפן ---------- */
  // מיגרציה חד-פעמית: נתונים שנשמרו לפני שהאחסון הפך לפי משתמש (מפתחות גלובליים) עוברים למשתמש הראשון שמתחבר בדפדפן הזה אחרי העדכון, והמפתחות הגלובליים נמחקים — כך משתמש אחר באותו מכשיר לא יורש אותם.
  // מי שכבר יש לו נתונים משלו לא נדרס (הגלובלי נמחק בלי אימוץ); ואם הכתיבה נכשלה (אחסון חסום/מלא) הוא נמחק בכל זאת — עדיף לאבד נוחות מלהשאיר פרטי מבקש פתוחים לכל משתמש
  function adoptLegacyStorage() {
    [PERSON_KEY, AIRCRAFT_KEY, PURPOSE_KEY].forEach(base => {
      const old = ls.get(base);
      if (old === null) return;
      if (lsGet(base) === null) lsSet(base, old);
      ls.del(base);
    });
  }
  // ניקוי כל השדות החופשיים של הטופס והבקשה (לא פרטי המבקש השמורים — אלה נטענים/נמחקים ב-loadPerson / clearPersonFields): מה שהדפדפן שחזר מהיסטוריה (גם אם התעלם מ-autocomplete="off") או מה שנשאר ממשתמש קודם
  const FREE_FIELDS = ["coord", "height", "dateFrom", "dateTo", "timeFrom", "timeTo", "siteName", "knownObs", "visitDate", "visitNotes", "mName", "mCoord", "mHeight", "puNew", "acNew", "q"];
  function resetFormFields() {
    FREE_FIELDS.forEach(id => { const e = $(id); if (e) e.value = ""; });
    $("reviewOk").checked = false;
  }
  // כניסה ראשונה בדף הזה: קובעים את מפתח האחסון של המשתמש, מאמצים נתונים ישנים (פעם אחת), וטוענים את הנתונים השמורים של המשתמש הזה בלבד. הדף הוא מסמך חדש ולכן אין בו בקשה שמתאימה לשדות: כל שדה חופשי שהדפדפן שחזר
  // (ניווט היסטוריה, שחזור לשונית) מנוקה — שלא ייכנס לבקשה של המטיס שנכנס עכשיו (שכבת הגנה נוספת על autocomplete="off" ב-index.html). כניסה חוזרת של אותו משתמש באותו דף (למשל בלי התנתקות) לא מגיעה לכאן
  function enterUser(u) {
    S.uk = C.userHash(u);
    resetFormFields();
    adoptLegacyStorage();
    extraPu = loadExtraPurposes(); renderPurposes("");
    S.extraAc = loadExtraAircraft(); renderAircraft(null);
    loadPerson();
  }
  // איפוס מלא ומיידי של הדף ושל מצב הבקשה: בהתנתקות (יזומה, פקיעת אסימון, חסימה, שגיאת auth — auth.js: אירוע req-logout), בכניסת משתמש אחר באותו דף ובשחזור מהיסטוריה (pageshow) של דף שהסשן שלו כבר אינו תקף.
  // לא נשאר דבר: לא הבקשה המוכנה, לא הדוח והתמונות, לא הסטטוסים, לא התיקייה ומזהה הבקשה, לא פרטי המבקש ואנשי הקשר, לא חלונות פתוחים ולא ה-DOM של התוצאות; הכפתורים מושבתים. הדרך הבטוחה: טעינת הדף מחדש (תמיד, גם אם שלב באיפוס נכשל).
  // הטעינה מחדש מגיעה לדף נקי: אם יש סשן שמור (כניסת משתמש אחר — האסימון שלו נשמר לפני האירוע) הוא מחובר עם הנתונים השמורים שלו בלבד; אחרת מוצג כיסוי הכניסה. אין לולאה — בדף החדש S.lastUser ריק.
  // S.uk מרוקן כדי שאף ניקוי לא ייכתב או יימחק באחסון של המשתמש הקודם (נשמר שלם לכניסה הבאה שלו). עד שהטעינה מתבצעת הדף נעול (inert), והרינדור חסום (S.resetting)
  function resetPage() {
    if (S.resetting) return;
    S.resetting = true;
    const step = fn => { try { fn(); } catch (e) { /* שלב שנכשל לא עוצר את האיפוס — הטעינה מחדש בסוף היא ההגנה העיקרית */ } };
    try {
      S.uk = "";
      step(() => window.ReqAuth.lock());
      step(() => { clearTimeout(rebuildTimer); rebuildTimer = null; clearTimeout(LAY.timer); LAY.timer = null; });
      step(cancelAutoSave);   // שמירה אוטומטית שממתינה לא תיכתב לדרייב אחרי ההתנתקות / החלפת המשתמש / פקיעת האסימון / החסימה
      S.buildSeq++; S.building = false; S.pending = false; S.ready = false; S.stale = false; S.staleWhy = ""; S.running = false; S.onStale = null;
      S.res = null; S.report = null; S.reportHtml = false; S.reportDraft = false; S.imgs = {}; S.imgSite = null; S.manual = []; S.manualKey = ""; S.reviewAt = null; S.scanKey = null; S.analysisStamp = null;
      S.sent = null; S.sendFolder = null; S.rid = ""; S.ridKey = ""; S.driveUrl = ""; S.center = null; S.autoSite = ""; S.pick = false;
      S.data.near = S.data.far = S.data.ext = S.data.reverse = undefined;
      S.statuses.review = { ok: false, msg: O.DECLARATION.gate }; S.statuses.input = { ok: false, msg: "" };
      ["osm_near", "osm_far", "osm_ext", "map"].forEach(k => { S.statuses[k] = { ok: false, msg: "לא הושלם" }; });   // סטטוסי ההרצה האחרונה
      step(clearOutcome);   // מקדם את S.rev: שמירה או שליחה של הקודם שעדיין באוויר נעצרת בבדיקת הגרסה
      step(() => window.ReqAuth.closeModal());
      step(clearPersonFields);
      step(resetFormFields);
      step(() => { extraPu = []; renderPurposes(""); S.extraAc = []; renderAircraft(null); });
      step(() => { S.lf.marker && S.lf.m.removeLayer(S.lf.marker); S.lf.green && S.lf.m.removeLayer(S.lf.green); S.lf.orange && S.lf.m.removeLayer(S.lf.orange); S.lf.marker = S.lf.green = S.lf.orange = null; closeCard(); });
      step(() => {
        document.body.classList.remove("pendDraft");
        ["report", "gate", "staleBox", "progress", "limits", "manualList", "mailInfo", "places", "qMsg", "ftHint", "acMsg", "puMsg", "e_manual", "pointSummary"].forEach(id => { const e = $(id); if (e) { e.innerHTML = ""; e._html = undefined; e._k = ""; } });
        document.querySelectorAll(".err[id^=e_]").forEach(e => { e.textContent = ""; });
        document.querySelectorAll("input.bad,select.bad,textarea.bad").forEach(e => e.classList.remove("bad"));
        $("resultsSec").style.display = "none";
        $("btnMail").href = "#";
      });
      step(() => {
        ["btnPrint", "btnDocx", "btnKml", "btnAerial", "btnStreet", "btnOverview", "btnRegion", "btnCopy", "btnDrive", "btnSend"].forEach(id => { $(id).disabled = true; });
        const mailA = $("btnMail"); mailA.querySelector("button").disabled = true; mailA.style.pointerEvents = "none"; mailA.tabIndex = -1; mailA.setAttribute("aria-disabled", "true");
      });
    } finally {
      window.__REQ_SWITCHING = true;   // לבדיקות: הדף נטען מחדש
      location.reload();
    }
  }
  // שחזור מהיסטוריית הדפדפן (bfcache): זה אותו מצב זיכרון שהיה בעת העזיבה, בלי שום אירוע. אם בינתיים הסשן נמחק/פג או שהוא של משתמש אחר מזה שבדף — מאפסים וטוענים מחדש;
  // אם הדף כיסוי נקי (לא היה בו משתמש) אבל יש סשן — טעינה מחדש מחברת אותו בדף נקי
  function onPageShow(ev) {
    if (!ev || !ev.persisted) return;
    const A = window.ReqAuth, stored = A.storedUser();
    if ((S.lastUser && (!A.loggedIn() || stored !== S.lastUser)) || (!S.lastUser && stored)) resetPage();
  }
  function readInputs() {
    const c = C.parseCoordInput($("coord").value) || S.center || {};
    return {
      lat: c.lat, lon: c.lon, radius: parseFloat($("radius").value), heightM: parseFloat($("height").value),
      dateFrom: $("dateFrom").value, dateTo: $("dateTo").value || $("dateFrom").value, timeFrom: $("timeFrom").value, timeTo: $("timeTo").value,
      purpose: $("purpose").value, aircraft: [...document.querySelectorAll('input[name="ac"]:checked')].map(i => i.value),
      vlos: $("vlos").value === "yes", siteName: $("siteName").value.trim(),
      requesterName: $("reqName").value.trim(), requesterPhone: $("reqPhone").value.trim(),
      requesterOrg: $("reqOrg").value.trim(), callsign: $("reqCallsign").value.trim(), registration: $("reqReg").value.trim(),
      contacts: readRows("contacts"), participants: readRows("participants"),
      knownObstacles: $("knownObs").value, visitDate: $("visitDate").value || "", visitNotes: $("visitNotes").value
    };
  }
  const scanKeyOf = i => JSON.stringify([i.lat, i.lon, i.radius, i.heightM, i.dateFrom, i.dateTo, i.timeFrom, i.timeTo]);
  const scanKey = () => scanKeyOf(readInputs());
  // מסמן ב-bad את השורות והשדות שגורמים לשגיאת אנשי הקשר / המשתתפים (אותם כללים כמו ב-C.validateInput)
  function markPeople(errs) {
    const has = f => errs.some(e => e.field === f), bad = el => { if (el) el.classList.add("bad"); };
    if (has("contacts")) {
      const all = rowsOf("contacts"), named = all.filter(r => cellVal(r, "name"));
      all.forEach(r => { const n = cellVal(r, "name"), ph = cellVal(r, "phone"); if (!n && ph) bad(cellOf(r, "name")); if (ph && !C.validPhone(ph)) bad(cellOf(r, "phone")); });
      if (named.length < 2) all.forEach(r => { if (!cellVal(r, "name")) bad(cellOf(r, "name")); });
      else if (!named.some(r => C.validPhone(cellVal(r, "phone")))) named.forEach(r => bad(cellOf(r, "phone")));
    }
    if (has("participants")) rowsOf("participants").forEach(r => {
      const f = cellVal(r, "first"), l = cellVal(r, "last"), ph = cellVal(r, "phone");
      if (!(f || l || ph)) return;
      if (!f || f.length > 40) bad(cellOf(r, "first")); if (!l || l.length > 40) bad(cellOf(r, "last")); if (!C.validPhone(ph)) bad(cellOf(r, "phone"));
    });
  }
  function showErrors(errs) {
    document.querySelectorAll(".err[id^=e_]").forEach(e => { if (e.id !== "e_run") e.textContent = ""; });
    document.querySelectorAll("input.bad,select.bad,textarea.bad").forEach(e => e.classList.remove("bad"));
    const idMap = { coord: "coord", radius: "radius", height: "height", dateFrom: "dateFrom", dateTo: "dateTo", timeFrom: "timeFrom", timeTo: "timeTo", purpose: "purpose", aircraft: null, siteName: "siteName", knownObstacles: "knownObs", visitNotes: "visitNotes", requesterOrg: "reqOrg", callsign: "reqCallsign", registration: "reqReg" };
    errs.forEach(e => {
      const el = $("e_" + e.field); if (el) el.textContent = e.msg;
      const dateErr = e.field === "visitNotes" && /תאריך/.test(e.msg);   // שגיאת תאריך הסיור מדווחת תחת הערות המבקש
      const inp = !dateErr && idMap[e.field] && $(idMap[e.field]); if (inp) inp.classList.add("bad");
      if (dateErr) $("visitDate").classList.add("bad");
      if (e.field === "requester") { if (!$("reqName").value.trim() || !C.purposeHasVisible($("reqName").value)) $("reqName").classList.add("bad"); if (!C.validPhone($("reqPhone").value)) $("reqPhone").classList.add("bad"); }
    });
    markPeople(errs);
    // טקסט שהוקלד בשדה ההוספה ולא נוסף: רמז בלבד (לא חוסם, לא מוסיף לבד) — ההרצה ממילא נעצרת כי לא נבחרה מהות
    if (errs.some(e => e.field === "purpose") && $("puNew").value.trim() && $("e_purpose")) $("e_purpose").textContent += " — הקלדתם מהות אך לא הוספתם אותה: לחצו ״הוסף מהות פעילות״.";
    if (errs.some(e => e.field === "requester" || e.field === "requesterOrg" || e.field === "callsign" || e.field === "registration" || e.field === "contacts" || e.field === "participants")) $("personBox").open = true;   // השגיאה לא תוסתר בתוך תיבה סגורה
  }

  /* ---------- מפה חיה (Leaflet) ---------- */
  function initMap() {
    if (typeof L === "undefined") { $("map").innerHTML = '<div class="hint" style="padding:20px">המפה לא נטענה (אין חיבור לספריית המפות). אפשר להקליד קואורדינטות בשדה.</div>'; return; }
    const m = L.map("map").setView([31.9, 35.0], 8);
    const sat = L.tileLayer(ESRI, { maxZoom: 19, attribution: "Esri World Imagery" }), osm = L.tileLayer(OSM, { maxZoom: 19, attribution: "OpenStreetMap" });
    sat.addTo(m);
    $("baseSat").onclick = () => { m.removeLayer(osm); sat.addTo(m); };
    $("baseOsm").onclick = () => { m.removeLayer(sat); osm.addTo(m); };
    m.on("click", e => {
      if (S.pick) { S.pick = false; $("mCoord").value = e.latlng.lat.toFixed(6) + ", " + e.latlng.lng.toFixed(6); $("mPick").textContent = "בחר מיקום מהמפה"; $("mCoord").scrollIntoView({ behavior: "smooth", block: "center" }); return; }
      const moved = setCenter(e.latlng.lat, e.latlng.lng, false);
      showHitsAt(e.latlng, moved);   // הנקודה נבחרת תמיד; במקביל נפתח כרטיס עם האזורים והנוטמים שמתחתיה (אם יש)
    });
    S.lf = { m, sat, osm, marker: null, green: null, orange: null };
    try { initLayers(m); } catch (e) { S.lf.lay = null; LAY.initFailed = true; try { console.error("[layers] initLayers", e); } catch (e2) { /* ignore */ } }   // כשל בהקמת השכבות לעולם לא עוצר את המפה, את הטופס או את ההרצה
  }
  function drawCircles() {
    if (!S.lf.m || !S.center) return;
    const R = parseFloat($("radius").value) || 0, ll = [S.center.lat, S.center.lon];
    if (!S.lf.marker) {
      S.lf.marker = L.marker(ll, { draggable: true }).addTo(S.lf.m);
      S.lf.marker.on("dragend", () => { const p = S.lf.marker.getLatLng(); setCenter(p.lat, p.lng, false, true); });   // גרירה כותבת גם את שדה הנ״צ (אחרת הפס וההרצה ממשיכים לנקודה הישנה שבשדה), ובלי להזיז/לקרב את המפה — המשתמש כבר מסתכל על המקום
      S.lf.orange = L.circle(ll, { radius: 2 * R, color: "#ff9500", weight: 3, fillColor: "#ff9500", fillOpacity: 0.12 }).addTo(S.lf.m);
      S.lf.green = L.circle(ll, { radius: R, color: "#22c55e", weight: 3, fillColor: "#22c55e", fillOpacity: 0.22 }).addTo(S.lf.m);
    } else { S.lf.marker.setLatLng(ll); S.lf.orange.setLatLng(ll).setRadius(2 * R); S.lf.green.setLatLng(ll).setRadius(R); }
  }
  // fromInput: הקריאה באה משדה הנ״צ עצמו (לא כותבים אותו בחזרה). noMove: בלי קירוב/הזזת המפה (גרירת הסמן)
  function setCenter(lat, lon, fromInput, noMove) {
    S.center = { lat, lon };
    if (!fromInput) $("coord").value = lat.toFixed(6) + ", " + lon.toFixed(6);
    closeCard();   // כרטיס שנפתח בלחיצה קודמת מתאר נקודה אחרת (הקלדה, חיפוש מקום, גרירה); בלחיצה על המפה הכרטיס החדש נפתח מיד אחרי הקריאה הזו
    drawCircles();
    let moved = false;   // האם המפה קרבה/זזה (setView) ועוד לא סיימה: כרטיס הלחיצה נפתח רק אחרי שהתנועה הסתיימה
    if (S.lf.m && !noMove) {
      const m = S.lf.m, z = m.getZoom();
      if (z < 15 || !m.getBounds().contains([lat, lon])) {
        // פער זום גדול מ-4 (למשל הלחיצה הראשונה, מזום 8) הוא איפוס סינכרוני: moveend נורה בתוך setView עצמו, לפני שמישהו הספיק להאזין לו. מאזינים לפני הקריאה, ו-moved נקבע לפי מה שקרה בפועל
        let settled = false; const mark = () => { settled = true; };
        m.once("moveend", mark);
        m.setView([lat, lon], Math.max(z, 16));
        if (!settled) { moved = true; m.off("moveend", mark); }
      }
    }
    onScanInputChange();
    scheduleLayerUpdate();   // הפס והנוטמים מתעדכנים בעקבות הנקודה (debounce)
    return moved;
  }

  /* ---------- שכבות איסורים (פמ״ת) ונוטמים על המפה + פס סיכום לנקודה (js/maplayers.js) ----------
     תצוגה מקדימה ומידעית בלבד: הקוד כאן אינו קורא ל-setStatus/refreshGate ואינו נוגע ב-S.res / S.statuses / S.stale / S.ready — שער "מוכן לשליחה" (C.gate) נקבע אך ורק בהרצת הבדיקות המלאות.
     החלטות: (1) האזורים והנוטמים אינם אינטראקטיביים ב-Leaflet (interactive:false) ולכן אינם "בולעים" לחיצה: לחיצה על המפה תמיד בוחרת נקודה (ה-click ב-initMap),
     ובמקביל נפתח כרטיס אחד עם כל האזורים והנוטמים שמתחת לנקודה (ReqLayers.hitZones/hitNotams) — במקום פופאפ נפרד לכל שכבה שהיה מכסה את הנקודה.
     (2) ציור על קנבס (L.canvas, קל לנייד) בשני panes שמתחת ל-overlayPane — טבעות הסגירה והסמן תמיד מעליהם. (3) טקסט נתונים (שמות אזורים, נוטמים) נכנס לכרטיס רק דרך ReqLayers.popupHtml (escaping מלא), והפס נבנה ב-textContent. */
  // broken: למה שכבה אינה זמינה ("" = תקינה). כשל בציור/בחישוב של התצוגה לעולם לא עוצר את הדף, את ההרצה או את הטעינה מחדש של הנתונים (כל נקודת כניסה כאן אינה זורקת) — השכבה מושבתת עם הסבר, ושום סטטוס/שער אינו נגע
  const LAY = { prefs: LY ? LY.parsePrefs(ls.get(LY.KEY)) : { zones: true, notams: true }, timer: null, seq: 0, broken: { zones: "", notams: "" }, initFailed: false };
  const layerHave = () => ({ zones: !!(S.data.zones && S.data.zones.zones && S.data.inpa && S.data.inpa.sites), notams: Array.isArray(S.data.notams) });
  const numVal = id => { const v = parseFloat($(id).value); return isFinite(v) ? v : NaN; };
  const logLayerErr = (what, e) => { try { console.error("[layers] " + what, e); } catch (e2) { /* ignore */ } };
  // הנקודה שהפס מתאר: הנ״צ שבשדה אם הוא תקין; שדה ריק — הנקודה שעל המפה (S.center); טקסט שאינו נ״צ — אין נקודה (invalid), ולא נפילה שקטה לנקודה הקודמת שהסמן עדיין עליה
  function layerPoint() {
    const raw = $("coord").value.trim(), c = raw ? C.parseCoordInput(raw) : null;
    return raw && !c ? { invalid: true } : { c: c || S.center || {} };
  }
  // שדות הטופס שמשפיעים על התצוגה (נקודה, רדיוס, גובה, תאריכים ושעות) — נקראים ישירות, בלי readInputs
  function layerInputs() {
    const pt = layerPoint(), c = pt.c || {};
    return { lat: c.lat, lon: c.lon, coordInvalid: !!pt.invalid, radius: numVal("radius"), heightM: numVal("height"), dateFrom: $("dateFrom").value, dateTo: $("dateTo").value || $("dateFrom").value, timeFrom: $("timeFrom").value, timeTo: $("timeTo").value };
  }
  // סוגר את כרטיס הלחיצה ומבטל פתיחה ממתינה שלו (moveend/טיימר גיבוי) — כשהנקודה משתנה בדרך אחרת מלחיצה על המפה
  function closeCard() { LAY.seq++; try { if (S.lf.m) S.lf.m.closePopup(); } catch (e) { logLayerErr("closeCard", e); } }
  function initLayers(m) {
    if (!LY) return;
    const pane = (name, z) => { m.createPane(name); m.getPane(name).style.zIndex = z; return L.canvas({ pane: name, padding: 0.4 }); };
    const lay = S.lf.lay = { zoneR: pane("icdZones", 340), notamR: pane("icdNotams", 360), zoneGroup: L.layerGroup(), notamGroup: L.layerGroup(), zoneLayers: [], notamLayers: [], shapes: [], notamItems: [], zonesKey: "", notamKey: "", sel: null, win: null,
      popup: L.popup({ className: "lpop", maxWidth: 300, minWidth: 190, maxHeight: 200, offset: [0, -34], autoPanPadding: [12, 12] }) };
    lay.visible = () => ({ zones: lay.zoneLayers.filter(l => m.hasLayer(l)).length, notams: lay.notamLayers.filter(l => m.hasLayer(l)).length });   // לבדיקות: כמה שכבות מוצגות כרגע במפה
    lay.refresh = refreshLayers;
  }
  const showGroup = (g, on) => { const m = S.lf.m; if (on) { if (!m.hasLayer(g)) g.addTo(m); } else if (m.hasLayer(g)) m.removeLayer(g); };
  // כל צורה בציור בתוך try/catch משלה (נספרת); אבל צורה שנכשלה אינה מדולגת בשקט — מפה שחסר בה אזור איסור ומוצגת כשלמה מטעה — ולכן הכשל של אפילו צורה אחת מסמן את כל השכבה כלא זמינה (ראו refreshLayers)
  function buildZones() {
    const lay = S.lf.lay, bad = [];
    lay.zoneGroup.clearLayers(); lay.zoneLayers = [];
    lay.shapes = LY.zoneShapes(S.data.zones, S.data.inpa);   // זורק (badId) על גבול פגום בקובץ
    lay.shapes.forEach(sh => {
      try {
        const c = LY.COLORS[sh.src].line;
        // כמה טבעות = כמה מצולעים נפרדים (multi-polygon) ולא "חורים"; שרטוט בקירוב = קו מקווקו (כמו במפת החברים)
        const ly = L.polygon(sh.rings.length === 1 ? sh.rings[0] : sh.rings.map(r => [r]), { renderer: lay.zoneR, interactive: false, color: c, weight: sh.src === "inpa" ? 1.2 : 1.8, opacity: 0.9, fillColor: c, fillOpacity: sh.src === "inpa" ? 0.12 : 0.18, dashArray: sh.approx ? "7 5" : null });
        lay.zoneGroup.addLayer(ly); lay.zoneLayers.push(ly);
      } catch (e) { bad.push(sh.id); logLayerErr("zone " + sh.id, e); }
    });
    if (bad.length) { const e = new Error("ציור נכשל באזורים: " + bad.slice(0, 5).join(", ")); e.badId = bad[0]; throw e; }
  }
  function buildNotams(sel) {
    const lay = S.lf.lay, c = LY.COLORS.notam.line, bad = [];
    lay.notamGroup.clearLayers(); lay.notamLayers = []; lay.notamItems = sel.items;
    sel.items.forEach(n => {
      try {
        const g = n.geometry, q = g.src === "Q", pts = g.kind === "circle" ? C.circlePoints(new C.Proj(g.c[0], g.c[1]), g.r, 96) : g.pts;   // עיגול כמצולע: בלי רדיוס ענק בפיקסלים כשהעיגול גדול מהמסך
        const base = { renderer: lay.notamR, interactive: false, dashArray: q ? "6 6" : null };
        lay.notamGroup.addLayer(L.polygon(pts, Object.assign({}, base, { color: "#000", opacity: 0.55, weight: 5, fill: false })));   // מסגרת כהה מתחת לצהוב — קריאות גם על מפת רחובות בהירה
        const ly = L.polygon(pts, Object.assign({}, base, { color: c, opacity: 1, weight: 2.4, fillColor: c, fill: !(q && g.r > 20000), fillOpacity: q ? 0.08 : 0.2 }));   // מיקום גס משורת Q: מקווקו; מעל 20 ק״מ — קו מתאר בלבד
        lay.notamGroup.addLayer(ly); lay.notamLayers.push(ly);
      } catch (e) { bad.push(n.id); logLayerErr("notam " + n.id, e); }
    });
    if (bad.length) { const e = new Error("ציור נכשל בנוטמים: " + bad.slice(0, 5).join(", ")); e.badId = bad[0]; throw e; }
  }
  // כשל בשכבה אחת: מנקים אותה (גם את מה שנקלט לצורך כרטיס הלחיצה), רושמים את הסיבה להצגה ליד המתג ובקונסולה. לא נוגעים בסטטוסים, בשער או בהרצה
  function layerFailed(which, e) {
    logLayerErr("build " + which, e);
    const lay = S.lf.lay; if (!lay) return;
    try {
      if (which === "zones") { lay.zoneGroup.clearLayers(); lay.zoneLayers = []; lay.shapes = []; }
      else { lay.notamGroup.clearLayers(); lay.notamLayers = []; lay.notamItems = []; }
    } catch (e2) { logLayerErr("clear " + which, e2); }
    LAY.broken[which] = (which === "zones" ? "תצוגת האיסורים אינה זמינה — נתוני האזורים אינם תקינים" : "תצוגת הנוטמים אינה זמינה — נתוני הנוטמים אינם תקינים") + (e && e.badId ? " (" + e.badId + ")" : "") + ". הבדיקות המלאות נקבעות רק ב״הרץ״.";
  }
  // אחרי טעינה (או טעינה מחדש) של הנתונים מבטלים מפתחות ובנייה קודמת, כדי שהציור יתבסס על הנתונים החדשים וכשל קודם לא יישאר
  function layerDataChanged() {
    LAY.broken.zones = LAY.broken.notams = "";
    const lay = S.lf.lay; if (lay) { lay.zonesKey = ""; lay.notamKey = ""; }
    onLayerData();
  }
  // בונה/מעדכן את הציור לפי הנתונים, המתגים ותאריכי הטופס, ואת בקרות המתגים. בנייה מחדש רק כשהתוכן השתנה (מפתח), כדי שגרירת סמן או הקלדת רדיוס לא יצייר הכול מחדש
  // לא זורקת לעולם: כל שכבה בנויה ב-try/catch משלה (כשל באחת משביתה אותה עם הסבר ואינו פוגע בשנייה), והחלק של בקרות המתגים גם הוא מוגן
  function refreshLayers() {
    if (!LY) return;
    const lay = S.lf.lay, have = layerHave();
    let sel = null, win = null;
    if (lay) {
      if (have.zones) {
        try {
          const key = [S.data.zones.dataHash || "", S.data.zones.zones.length, S.data.inpa.sites.length, S.data.inpa.edition || ""].join("|");
          if (key !== lay.zonesKey) { lay.zonesKey = key; LAY.broken.zones = ""; buildZones(); }   // המפתח נקבע לפני הבנייה: כשל אינו נבנה מחדש בכל עדכון (רק כשהנתונים משתנים)
        } catch (e) { layerFailed("zones", e); }
      }
      if (have.notams) {
        try {
          win = LY.inputWindow(layerInputs(), new Date()); sel = LY.selectNotams(S.data.notams, win);
          const key = sel.items.map(n => n.id).join(",") + "|" + (S.data.notamFetchedIso || "");
          if (key !== lay.notamKey) { lay.notamKey = key; LAY.broken.notams = ""; buildNotams(sel); } else if (!LAY.broken.notams) lay.notamItems = sel.items;
          lay.sel = sel; lay.win = win;
        } catch (e) { layerFailed("notams", e); }
      }
      try {
        showGroup(lay.zoneGroup, have.zones && LAY.prefs.zones && !LAY.broken.zones);
        showGroup(lay.notamGroup, have.notams && LAY.prefs.notams && !LAY.broken.notams);
      } catch (e) { logLayerErr("showGroup", e); }
    }
    try { syncLayerControls(have, sel, win); } catch (e) { logLayerErr("syncLayerControls", e); }
  }
  function syncLayerControls(have, sel, win) {
    const hasMap = !!S.lf.lay, cz = $("lyrZones"), cn = $("lyrNotams"), bz = LAY.broken.zones, bn = LAY.broken.notams;
    cz.checked = LAY.prefs.zones; cn.checked = LAY.prefs.notams;
    cz.disabled = !hasMap || !have.zones || !!bz; cn.disabled = !hasMap || !have.notams || !!bn;
    // מתג מושבת מסביר למה: המפה לא נטענה / הנתונים עוד נטענים / הטעינה נכשלה / הנתונים אינם תקינים (broken)
    const why = (key, what) => LAY.initFailed ? "שכבות המפה אינן זמינות (תקלה בטעינה)." : !hasMap ? "המפה לא נטענה." : S.statuses[key] && !S.statuses[key].ok ? "נתוני " + what + " לא נטענו — רעננו את הדף." : "טוען נתוני " + what + "…";
    $("lyrZonesNote").textContent = bz || (hasMap && have.zones ? "" : why("a17", "האזורים"));
    let nn = "";
    if (bn) nn = bn;
    else if (!hasMap || !have.notams) nn = why("notam", "הנוטמים");
    else {
      const age = LY.notamAge(S.data.notamFetchedIso, new Date());
      nn = (age ? age.text : "לא ידוע מתי נמשכו נתוני הנוטמים") + ".";
      if (LAY.prefs.notams && sel) {
        const n = sel.items.length, nl = sel.noLocation.length;
        nn += " מוצגים " + n + " " + (n === 1 ? "נוטם" : "נוטמים") + (win.mode === "now" ? " שעדיין בתוקף (" + win.reason + ")" : " לפי התאריכים והשעות שנבחרו") + (nl ? " · " + nl + " ללא מיקום (אינם מצוירים)" : "") + ".";   // win.reason: ״עוד לא נבחרו תאריכים״ או ״התאריכים שנבחרו אינם תקינים״
      }
    }
    $("lyrNotamsNote").textContent = nn;
    document.querySelectorAll("#lyrKey [data-lyr]").forEach(e => { e.hidden = !(hasMap && have[e.dataset.lyr] && LAY.prefs[e.dataset.lyr] && !LAY.broken[e.dataset.lyr]); });
  }
  // פס הסיכום מתחת למפה: אותן פונקציות חישוב של הבדיקות המלאות (ReqLayers.preview), אך תצוגה בלבד — לא נכנס לדוח, לטופס, ל-Word או למייל
  function updateSummary() {
    const box = $("pointSummary"); if (!box || !LY) return;
    const r = LY.preview(Object.assign(layerInputs(), { zones: S.data.zones, inpa: S.data.inpa, notams: S.data.notams, notamFetchedIso: S.data.notamFetchedIso, thresholds: (S.cfg && S.cfg.thresholds) || {}, now: new Date() }));
    // אזור aria-live: בנייה מחדש של הצמתים גם כשהתוכן זהה גורמת לקורא מסך להקריא את כל הסיכום שוב (בכל תו, בכל change/blur). לכן משווים לתוכן שנבנה בפעם האחרונה ולא נוגעים ב-DOM כשהוא זהה.
    // summaryFailed מאפס את המפתח — אחרת עדכון תקין עם אותו תוכן כמו לפני תקלה היה משאיר את הודעת התקלה על המסך
    const k = JSON.stringify(r.lines);
    if (box._k === k && box.firstChild) return;
    box._k = k;
    box.textContent = "";
    const ttl = document.createElement("div"); ttl.className = "pst"; ttl.textContent = "סיכום מקדים לנקודה שנבחרה"; box.appendChild(ttl);
    r.lines.forEach(l => {
      const d = document.createElement("div"); d.className = "psl" + (l.cls ? " " + l.cls : ""); d.dataset.k = l.k;
      if (l.label) { const b = document.createElement("b"); b.textContent = l.label + ": "; d.appendChild(b); }
      d.appendChild(document.createTextNode(l.text)); box.appendChild(d);
    });
  }
  // עדכון התצוגה כולה (ציור + פס): לא זורק לעולם — כל חלק בנפרד ב-try/catch. כשל בפס מוצג כהסבר בפס עצמו (לא נעלמת הפס בשקט), ושום סטטוס/שער אינו נגע
  function summaryFailed(e) {
    logLayerErr("updateSummary", e);
    try { const box = $("pointSummary"); if (box) { box._k = ""; box.textContent = "סיכום מקדים אינו זמין (תקלה בחישוב התצוגה). הבדיקות המלאות נקבעות רק ב״הרץ את כל הבדיקות״."; } } catch (e2) { /* ignore */ }
  }
  function onLayerData() {
    try { refreshLayers(); } catch (e) { logLayerErr("refreshLayers", e); }
    try { updateSummary(); } catch (e) { summaryFailed(e); }
  }
  function scheduleLayerUpdate() { clearTimeout(LAY.timer); LAY.timer = setTimeout(() => { LAY.timer = null; onLayerData(); }, 200); }
  // כרטיס בלחיצה על המפה: כל האזורים והנוטמים (של השכבות הדלוקות) שמתחת לנקודה שנלחצה; בלי כלום מתחת — לא נפתח כלום
  function showHitsAt(ll, moved) { try { showHits(ll, moved); } catch (e) { logLayerErr("showHitsAt", e); try { closeCard(); } catch (e2) { /* ignore */ } } }   // כשל בכרטיס אינו נזרק ל-click של המפה: הנקודה כבר נבחרה
  function showHits(ll, moved) {
    const lay = S.lf.lay, m = S.lf.m; if (!lay || !LY) return;
    const zones = m.hasLayer(lay.zoneGroup) ? LY.hitZones(lay.shapes, ll.lat, ll.lng) : [], notams = m.hasLayer(lay.notamGroup) ? LY.hitNotams(lay.notamItems, ll.lat, ll.lng) : [], seq = ++LAY.seq;
    if (!zones.length && !notams.length) { m.closePopup(); return; }
    const gen = S.data.zones && S.data.zones.general, html = LY.popupHtml({ zones, notams }, { b09Footnote: (gen && gen.B09 && gen.B09.footnote) || "" });
    let done = false;
    const open = () => {
      if (done || seq !== LAY.seq) return; done = true;
      try {
      const sz = m.getSize(), o = lay.popup.options;   // הכרטיס תמיד נכנס למפה, גם בטלפון (מפה צרה ונמוכה): רוחב וגובה מרביים לפי גודל המפה, וגלילה פנימית כשיש הרבה פריטים
      o.maxWidth = Math.max(170, Math.min(320, sz.x - 64)); o.minWidth = Math.min(190, o.maxWidth); o.maxHeight = Math.max(140, Math.min(300, sz.y - 120));
      lay.popup.setLatLng(ll).setContent(html); m.openPopup(lay.popup);
      } catch (e) { logLayerErr("openCard", e); }
    };
    if (moved) { m.once("moveend", open); setTimeout(open, 900); } else open();   // המפה זזה: מחכים לסיום התנועה (גיבוי: טיימר) כדי שהכרטיס לא ייפתח במקום הלא נכון
  }
  function initLayerUi() {
    if (!LY || !$("lyrZones")) return;
    [["lyrZones", "zones"], ["lyrNotams", "notams"]].forEach(([id, k]) => {
      const cb = $(id);
      cb.addEventListener("change", () => { LAY.prefs[k] = cb.checked; ls.set(LY.KEY, LY.serializePrefs(LAY.prefs)); if (S.lf.m) S.lf.m.closePopup(); refreshLayers(); });
      wrapHelp(cb.closest("label"), LY.HELP[k], LY.HELP_NAME[k]);
    });
    ["radius", "height", "dateFrom", "dateTo", "timeFrom", "timeTo"].forEach(id => ["input", "change"].forEach(ev => $(id).addEventListener(ev, scheduleLayerUpdate)));
    onLayerData();
  }

  async function searchPlace() {
    const q = $("q").value.trim(); if (!q) return;
    $("qMsg").textContent = "מחפש…"; $("places").innerHTML = "";
    try {
      const r = await fetch("https://nominatim.openstreetmap.org/search?" + new URLSearchParams({ format: "jsonv2", q, "accept-language": "he", countrycodes: "il,ps", limit: 6 }));
      const j = await r.json();
      $("qMsg").textContent = j.length ? "בחרו תוצאה:" : "לא נמצאו תוצאות.";
      $("places").innerHTML = j.map((x, i) => '<button type="button" data-i="' + i + '">' + esc(x.display_name) + "</button>").join("");
      $("places").querySelectorAll("button").forEach(b => b.onclick = () => { const x = j[+b.dataset.i]; setCenter(+x.lat, +x.lon, false); $("places").innerHTML = ""; $("qMsg").textContent = ""; });
    } catch (e) { $("qMsg").textContent = "החיפוש נכשל (" + e.message + "). אפשר להקליד קואורדינטות."; }
  }

  /* ---------- שער "מוכן לשליחה" ---------- */
  // pending נגזר ממה שבאמת ממתין: טיימר עריכה רכה שעוד לא פעל, או בנייה רצה של ההדמיות. אף בנייה (ובמיוחד לא בנייה מיושנת) לא מאפסת אותו "על דעת עצמה"
  const syncPending = () => { S.pending = rebuildTimer !== null || S.building; };
  // opts.quiet: קריאה מהקלדה בשדה רך. נועלת את הלחצנים מיד (S.ready), אבל לא מרנדרת את הדוח ולא מחליפה את אזור השער אם לא השתנה — אחרת הפריסה מעל תיבת ההקלדה "קופצת" בכל תו
  function refreshGate(opts) {
    const box = $("gate"); if (!box || S.resetting) return;
    const toReview = $("toReview"); if (toReview) toReview.hidden = !S.res;   // קישור קפיצה לסעיף 4 (סקירה, תאריך סיור והערות המבקש) — אחרי הרצה בלבד; בטלפון הסעיף רחוק מתחת לשער ולאזהרות
    if (!S.res) { $("resultsSec").style.display = "none"; return; }
    $("resultsSec").style.display = "block";
    syncPending();
    const g = C.gate(S.statuses);
    S.ready = g.ready && !S.stale && !S.pending;     // pending = הדמיות המפה נבנות מחדש אחרי עריכה — עד שהסתיימו אסור לשמור או לשלוח (התמונות עדיין של הגרסה הקודמת)
    // באנר ״מעדכן את ההדמיות״ רק כשההמתנה היא להדמיות (שם האתר שונה או בנייה רצה); עריכה רכה אחרת שממתינה לרינדור נועלת את הלחצנים בלבד, והבאנר נשאר כפי שהיה
    // הודעת השער ליד כפתורי ההפקה (#declGate, סעיף 5) כל עוד ההצהרה לא אושרה; נגזרת מסטטוס "review" (נכשל סגור: בלי סטטוס — מוצגת). textContent רק כשהשתנה, כדי שקורא מסך לא יקריא שוב בכל רינדור
    { const dg = $("declGate"), rv = S.statuses.review, t = rv && rv.ok ? "" : O.DECLARATION.gate; if (dg && dg.textContent !== t) dg.textContent = t; }
    const imgWait = S.pending && !S.stale && (S.building || (S.imgSite != null && S.imgSite !== ($("siteName").value || "").trim()));
    const showReady = S.ready || (S.pending && !imgWait && g.ready && !S.stale);
    const skipHtml = !!(opts && opts.quiet) && !imgWait && box._html !== undefined;   // הקלדה בשדה רך בלי שינוי הדמיות: אזור השער אינו משתנה — לא בונים מחדש (גם לא את האזהרות, שחישובן כבד יחסית) ולא נוגעים ב-DOM
    const w = skipHtml ? [] : warnings();
    let html = "";
    if (S.stale) html += '<div class="banner no">' + (S.staleWhy === "data" ? "נתוני המפה או הנוטמים התעדכנו מאז הרצת הבדיקות." : "הנתונים בטופס השתנו מאז הרצת הבדיקות.") + ' יש ללחוץ שוב על "הרץ את כל הבדיקות" לפני שליחה.</div>';
    if (imgWait) html += '<div class="banner warn">מעדכן את ההדמיות לפי השינוי האחרון… (אפשר לשמור ולשלוח רק אחרי שהסתיים)</div>';
    html += showReady ? '<div class="banner ok">✔ כל הבדיקות הושלמו ללא כשל. הבקשה מוכנה לשליחה.</div>'
      : '<div class="banner no">✖ הבקשה אינה מוכנה לשליחה — בדיקות שלא הושלמו:<ul>' + g.failing.map(f => "<li>" + esc(f.label) + ": " + esc(statusMsg(S.statuses[f.key]) || f.msg) + "</li>").join("") + "</ul></div>";
    html += w.map(x => '<div class="banner warn">' + x + "</div>").join("");
    if (!skipHtml && box._html !== html) { box.innerHTML = html; box._html = html; }   // לא מחליפים DOM זהה
    ["btnPrint", "btnDocx", "btnKml", "btnAerial", "btnStreet", "btnOverview", "btnRegion", "btnCopy", "btnDrive", "btnSend"].forEach(id => { $(id).disabled = !S.ready || ((id === "btnDrive" || id === "btnSend") && S.sending); });
    // הקישור "פתח מייל" הוא <a href=mailto>: disabled על ה-button שבתוכו ו-pointer-events חוסמים עכבר בלבד — Enter על הקישור עצמו (מקלדת) היה פותח את תוכנת המייל גם כשהבקשה אינה מוכנה. לכן גם tabindex ו-aria-disabled, ומאזין click (ב-init) שמבטל את הפעולה כש-!S.ready
    const mailA = $("btnMail");
    mailA.querySelector("button").disabled = !S.ready;
    mailA.style.pointerEvents = S.ready ? "" : "none";
    mailA.tabIndex = S.ready ? 0 : -1;
    if (S.ready) mailA.removeAttribute("aria-disabled"); else mailA.setAttribute("aria-disabled", "true");
    if (S.report && !(opts && opts.quiet)) renderReport();
    markReportDraft();
    scheduleAutoSave();
  }
  // סימון טיוטה מיידי של הדוח המוצג והמודפס (Ctrl+P) בחלון העריכה הרכה: ההקלדה נועלת את הלחצנים מיד אך הדוח (quiet) לא נבנה מחדש עד תום ה-debounce, ולכן הוא עדיין של הגרסה הקודמת וללא באנר טיוטה.
  // מחלקה pendDraft על ה-body (ולא על #report: הדוח אינו נוגע ב-DOM שלו בזמן הקלדה); CSS ב-index.html מציג ממנה באנר על כל עמוד בדוח, גם ב-@media print — בלי להחליף DOM ובלי להזיז שדות. דוח שכבר נבנה כטיוטה (S.reportDraft) מכיל את הבאנר בעצמו
  function markReportDraft() {
    document.body.classList.toggle("pendDraft", !!(S.res && S.report && S.reportHtml && !S.ready && !S.reportDraft));
  }
  function warnings() {
    const out = [], r = S.res; if (!r) return out;
    const th = S.cfg.thresholds;
    if (r.nearScan.inside.length) out.push("<b>נמצאו מכשולים או תשתיות בתוך האזור המיועד לטיסה (" + r.nearScan.inside.length + "):</b> " + esc(r.nearScan.inside.map(O.itemText).join("; ")) + ".");
    const bl = r.nearScan.items.filter(i => /^בלון/.test(i.label));
    if (bl.length) out.push("<b>נמצא בלון (אטרקציה/מעוגן) בקרבת האזור:</b> " + esc(bl.map(O.itemText).join("; ")) + ". גובה ההעלאה ושעות ההפעלה אינם ידועים — יש לוודא מול מפעיל הבלון.");
    const sites = r.nearScan.near; if (sites.length) out.push("<b>אתרים ותשתיות בקרבת האזור (" + sites.length + "):</b> " + esc(sites.map(O.itemText).join("; ")) + ".");
    const a17in = r.zones.inside.filter(z => z.src === "a17"), b09in = r.zones.inside.filter(z => z.src === "b09"), b09near = r.zones.near.filter(z => z.src === "b09");
    const rl = id => ((S.data.zones && S.data.zones.rules09 && S.data.zones.rules09.rules) || []).find(x => x.id === id);
    if (!r.inp.vlos) { const r3 = rl("3ג"); out.push("<b>הבקשה מציינת טיסה ללא קשר עין.</b> " + (r3 ? esc(r3.ref) + ": ״" + esc(r3.text) + "״ " : "") + "המערכת אינה יכולה לאמת אם הדבר מצוין בתעודת כושר הטיסה של כלי הטיס או באישור המנהל."); }
    // איש קשר בלי טלפון תקין: אזהרה בלבד (האימות דורש שני שמות וטלפון תקין אחד לפחות) — לכל איש קשר בנפרד
    (r.inp.contacts || []).filter(c => (c.name || "").trim() && !C.validPhone(c.phone)).forEach(c => out.push("איש הקשר ״" + esc(c.name.trim()) + "״ — חסר מספר טלפון תקין. בנספח ג׳ שדה 12 נדרשים 2 אנשי קשר וטלפונים."));
    // מכשולים שהמבקש הזין: מה שלא נמצא בסריקה, ומה שנמצא רק במצאי הרחב ואינו ברשימת הטופס (פריט שנמצא בטופס — בלי אזהרה, מוצג בדף הבדיקות)
    { const km = C.matchKnownObstacles(r.inp.knownObstacles, r.nearScan), q = t => "״" + esc(t) + "״";
      const none = km.filter(k => k.none);
      if (none.length) out.push("<b>מכשול שהוזן ולא נמצא בסריקה:</b> " + none.map(k => q(k.text)).join(", ") + ". ייתכן שאינו ממופה ב-OpenStreetMap או שהוא מחוץ לטווח הסריקה — אם הוא בטווח, הוסיפו אותו ידנית בסעיף 4.");
      const cen = km.filter(k => !k.found.length && k.census.length);
      if (cen.length) out.push("<b>נמצא בסריקה בקרבה אך אינו ברשימת הטופס:</b> " + cen.map(k => q(k.text) + " (" + k.census.slice(0, 3).map(c => esc(c.title + " — " + O.dLabel(c.d))).join("; ") + (k.census.length > 3 ? "; ועוד " + (k.census.length - 3) : "") + ")").join(", ") + "."); }
    if (a17in.length) out.push("<b>הסגירה המבוקשת חופפת לאזור איסור/הגבלה:</b> " + esc(a17in.map(z => z.label).join("; ")) + ". בקשה לחריגה: א-11 סעיף 3(ג) וא-17 סעיף 5 — <span dir='ltr'>caai-charigot@mot.gov.il</span> (הלשון המלאה בדף הבדיקות).");
    if (b09in.length) out.push("<b>הסגירה המבוקשת חופפת (חלקית או כולה) לאזור טיסה לכטב״ם (פרק ב-09):</b> " + esc(b09in.map(z => z.label + " (" + z.alt + ")").join("; ")) + ". יש לעיין בהערות האזור ובתיאום הנדרש (דף הבדיקות).");
    if (b09near.length) out.push("<b>בקרבת אזור טיסה לכטב״ם (פרק ב-09):</b> " + esc(b09near.map(z => z.label + " — " + C.fmtDist(z.edge) + " מקצה הסגירה (" + C.fmtDist(z.d) + " מהנקודה)").join("; ")) + ". סעיף 7(ג): מרחק של לפחות 500 מ׳ מגבול אזור הפעילות שאושר (דף הבדיקות).");
    const bv = r.borders.filter(b => b.violates); if (bv.length) out.push("<b>הסגירה נכנסת לרצועת הגבול:</b> " + esc(bv.map(b => b.name + " (" + b.km + " ק״מ)").join("; ")) + ".");
    if (r.workingDays != null && r.workingDays < th.min_working_days) out.push("הבקשה מוגשת " + r.workingDays + " ימים (א׳–ה׳) לפני מועד הפעילות; הנוהל (א-11 סעיף 6.ב) דורש לפחות " + th.min_working_days + " ימי עבודה. המערכת אינה מנכה חגים — אם יש חג בטווח, ייתכן שמספר ימי העבודה בפועל נמוך יותר.");
    if (r.notamAgeH != null && r.notamAgeH > th.notam_warn_age_h) out.push("נתוני הנוטמים נמשכו לפני " + Math.round(r.notamAgeH) + " שעות.");
    return out;
  }

  /* ---------- הרצה ---------- */
  function progress(items) {
    $("progress").innerHTML = items.map(i => '<li><span class="s ' + i.s + '">' + ({ ok: "✔", no: "✖", wait: "…" }[i.s]) + "</span><span>" + esc(i.t) + (i.m ? ' <span class="hint">' + esc(i.m) + "</span>" : "") + "</span></li>").join("");
  }
  // שם השדה בהודעה ליד כפתור ההרצה (לפי שדה השגיאה של C.validateInput)
  const FIELD_LABEL = { coord: "נקודת מרכז", radius: "רדיוס", height: "גובה", dateFrom: "מתאריך", dateTo: "עד תאריך", timeFrom: "משעה", timeTo: "עד שעה", purpose: "מהות הפעילות", aircraft: "כלי טיס", siteName: "ישוב / אתר",
    requester: "שם וטלפון המבקש", requesterOrg: "שם הגורם המבקש", callsign: "אות קריאה", registration: "מס׳ רישום כלי הטיס", contacts: "אנשי קשר בשטח", participants: "משתתפים", knownObstacles: "מכשולים שידועים", visitNotes: "הערות המבקש / תאריך סיור" };
  // הראשון בסדר המסמך מבין השדות המסומנים (bad) והודעות השגיאה שליד שדות (גם כשאין שדה מסומן, כמו כלי טיס): גולל אליו למרכז המסך (showErrors כבר פתחה את תיבת פרטי המבקש) וממקד אותו; ב-prefers-reduced-motion — בלי אנימציה
  function focusFirstError() {
    try {
      const cand = [...document.querySelectorAll("input.bad,select.bad,textarea.bad,.err[id^=e_]")].filter(e => e.id !== "e_run" && (e.matches(".bad") || (e.textContent || "").trim()) && e.getClientRects().length > 0);   // רק מה שגלוי: שגיאה בסעיף 4 לפני ההרצה הראשונה (מוסתר) לא תתפוס את המיקוד
      const first = cand[0]; if (!first) return;
      const calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      first.scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" });
      const f = first.matches("input,select,textarea") ? first : (first.parentNode && first.parentNode.querySelector("input,select,textarea"));   // הודעה בלי שדה מסומן: השדה הראשון באותו אזור
      if (f) f.focus({ preventScroll: true });
    } catch (e) { /* גלילה/מיקוד הם נוחות בלבד — לעולם לא מפילים את ההרצה */ }
  }
  async function run() {
    if (S.running) return;
    if (!window.ReqAuth.loggedIn()) { window.ReqAuth.show(); return; }
    $("e_run").textContent = "";
    const inp0 = readInputs();
    const errs = C.validateInput(Object.assign({}, inp0, { siteName: inp0.siteName || "-" }), S.cfg);
    { const raw = $("coord").value.trim(); if (raw && !C.parseCoordInput(raw)) errs.push({ field: "coord", msg: "הנ״צ שהוקלד אינו חוקי — תקנו אותו או בחרו נקודה במפה (אחרת הבדיקות היו רצות על הנקודה הקודמת)" }); }
    if (inp0.dateFrom && inp0.dateFrom < C.ilToday(new Date())) errs.push({ field: "dateFrom", msg: "תאריך ההתחלה כבר עבר" });
    showErrors(errs);
    if (errs.length) {
      setStatus("input", false, errs.map(e => e.msg).join(" · "));
      // ההודעה ליד כפתור ההרצה מפרטת אילו שדות (בטלפון הכפתור רחוק מהשדות), והמסך גולל ומתמקד בשדה הפגום הראשון. כאן בלבד, לא ב-showErrors: זו נקראת גם בעריכה רכה אחרי הרצה, וגלילה או מיקוד שם היו גונבים את המקלדת באמצע הקלדה
      const names = [...new Set(errs.map(e => FIELD_LABEL[e.field]).filter(Boolean))];
      $("e_run").textContent = "יש להשלים את השדות המסומנים" + (names.length ? " — חסר או שגוי: " + names.join(", ") : "") + ".";
      focusFirstError();
      return;
    }
    S.analysisStamp = null;   // ניתוח חדש בדרך: 'הניתוח ישן' אינו אמור לחסום את ההרצה שמתקנת אותו
    await checkSync();
    for (const k of ["a17", "sync", "agri", "notam"]) if (!(S.statuses[k] && S.statuses[k].ok)) { $("e_run").textContent = "ההרצה נעצרה — " + ({ a17: "אזורי איסור וגנים", sync: "סנכרון עם מפת החברים", agri: "מנחתים חקלאיים", notam: "נוטמים" })[k] + " אינם תקינים: " + (S.statuses[k] ? statusMsg(S.statuses[k]) : "ממתין") + (k === "sync" ? "" : ". רעננו את הדף."); return; }
    S.running = true; $("runBtn").disabled = true;
    const steps = [
      { k: "osm_near", t: "מכשולים ותשתיות בסביבה (OpenStreetMap)" }, { k: "osm_far", t: "שדות תעופה, מנחתים וישובים (OpenStreetMap)" },
      { k: "osm_ext", t: "גבולות מדינה ושטחי טבע (OpenStreetMap)" }, { k: "reverse", t: "שם המקום (Nominatim)" },
      { k: "calc", t: "חישוב מרחקים ובדיקת א-17, רט״ג, מנחתים ונוטמים" }, { k: "map", t: "ארבע תמונות מפה עם רקע (תצ״א, מפת רחובות, הדמיה, מפת אזור)" }
    ].map(x => Object.assign(x, { s: "wait", m: "" }));
    const upd = () => progress(steps.map(x => ({ s: x.s, t: x.t, m: x.m })));
    const st = (k, s, m) => { const x = steps.find(y => y.k === k); x.s = s; x.m = m || ""; upd(); };
    upd();
    // ניתוח חדש בדרך: בנייה שרצה על הניתוח הקודם הופכת למיושנת (buildSeq), ועריכה רכה שממתינה לא תפעל על תוצאה שנמחקת (clearTimeout) — ואז אין טיימר שיזרוק על S.res=null
    S.buildSeq++; S.building = false; clearTimeout(rebuildTimer); rebuildTimer = null; S.pending = false;
    S.res = null; S.report = null; S.stale = false; S.staleWhy = ""; S.imgs = {}; S.imgSite = null; clearOutcome();
    { const ck = inp0.lat + "," + inp0.lon; if (S.manualKey !== ck) { S.manual = []; S.manualKey = ck; } }
    S.reviewAt = null; $("reviewOk").checked = false; S.statuses.review = { ok: false, msg: O.DECLARATION.gate };
    ["osm_near", "osm_far", "osm_ext", "map"].forEach(k => { S.statuses[k] = { ok: false, msg: "לא הושלם" }; });
    const data = { zones: S.data.zones, inpa: S.data.inpa, agri: S.data.agri, notams: S.data.notams, notamFetchedIso: S.data.notamFetchedIso };
    const q = C.buildQueries(inp0.lat, inp0.lon, inp0.radius, S.cfg);
    const fetchOpts = { log: () => {}, maxAgeH: S.cfg.thresholds.osm_max_age_h };
    try {
      // שלוש השאילתות במקביל (מסונכרנות בהפרש קטן כדי לא להציף שרת אחד); כשל באחת מהן עוצר את ההכנה
      const qs = [["near", "near", "osm_near"], ["far", "far", "osm_far"], ["ext", "ext", "osm_ext"]];
      const results = await Promise.allSettled(qs.map(([k, key, sk], i) => (async () => {
        await wait(i * 1500);
        try {
          const r = await C.overpass(q[k], fetchOpts); data[key] = r.data; st(sk, "ok", new URL(r.mirror).hostname + " · " + r.data.elements.length + " אלמנטים");
          setStatus(sk, true, "");
        } catch (e) { st(sk, "no", e.message); setStatus(sk, false, e.message); throw e; }
      })()));
      const failed = results.find(r => r.status === "rejected");
      if (failed) throw failed.reason;
      try {
        const ctl = new AbortController(); setTimeout(() => ctl.abort(), 20000);
        const rr = await fetch("https://nominatim.openstreetmap.org/reverse?" + new URLSearchParams({ format: "jsonv2", lat: inp0.lat, lon: inp0.lon, zoom: 18, "accept-language": "he", addressdetails: 1 }), { signal: ctl.signal });
        if (!rr.ok) throw new Error("HTTP " + rr.status);
        data.reverse = await rr.json(); st("reverse", "ok", data.reverse.display_name || "");
      } catch (e) { data.reverse = null; st("reverse", "ok", "לא התקבל שם מ-Nominatim — השם נגזר משכבות OpenStreetMap או מהקלדה"); }
      // שדות הסריקה (נקודה, רדיוס, גובה, מועדים) נלקחים מרגע הלחיצה — עליהם נשלפו נתוני OSM; שדות "רכים" (שם, מטרה, אנשי קשר, משתתפים, הערות) עשויים להשתנות בזמן ההרצה
      const inp = Object.assign(readInputs(), { lat: inp0.lat, lon: inp0.lon, radius: inp0.radius, heightM: inp0.heightM, dateFrom: inp0.dateFrom, dateTo: inp0.dateTo, timeFrom: inp0.timeFrom, timeTo: inp0.timeTo, manualItems: S.manual });
      const res = C.analyze(inp, data, S.cfg, new Date());
      S.analysisStamp = { zonesHash: data.zones.dataHash, notamIso: data.notamFetchedIso };   // לפי הנתונים שהניתוח השתמש בהם, לא לפי מה שנטען בינתיים
      const prevAuto = S.autoSite;
      if (!inp.siteName || inp.siteName === prevAuto) { if (res.siteSuggestion) { $("siteName").value = res.siteSuggestion; S.autoSite = res.siteSuggestion; res.inp.siteName = res.siteSuggestion; } }
      const errs2 = C.validateInput(res.inp, S.cfg); showErrors(errs2);
      if (errs2.length) { setStatus("input", false, errs2.map(e => e.msg).join(" · ")); st("calc", "no", errs2.map(e => e.msg).join(" · ")); throw new Error("חסרים פרטים בטופס"); }
      setStatus("input", true, "");
      const age = res.notamAgeH;
      if (age == null || age > S.cfg.thresholds.notam_max_age_h) { setStatus("notam", false, age == null ? "לא ידוע מתי נמשכו הנוטמים" : "נתוני הנוטמים ישנים (" + Math.round(age) + " שעות; מרבי " + S.cfg.thresholds.notam_max_age_h + ")." + (isAdmin() ? " יש לרענן: GitHub → Actions → עדכון נוטמים יומי → Run workflow. אם הריצה נכשלת בגלל תעודת TLS של אתר רשות שדות התעופה — ממתינים לחידושה (אין לכבות אימות)." : " " + sup("אי אפשר להשלים בקשה עד שיתעדכנו — נסו שוב מאוחר יותר, ואם הבעיה נמשכת פנו לתמיכה."))); }   // ההוראה לרענן ב-GitHub מופנית למנהל בלבד
      else setStatus("notam", true, "");
      S.data.near = data.near; S.data.far = data.far; S.data.ext = data.ext; S.data.reverse = data.reverse;
      S.res = res; S.scanKey = scanKeyOf(inp0);
      if (scanKey() !== S.scanKey) { S.stale = true; S.staleWhy = ""; }   // הטופס שונה בזמן ההרצה — הבקשה לא תסומן מוכנה
      st("calc", "ok", "נמצאו " + res.nearScan.items.length + " מכשולים/תשתיות עד פי 2 מהרדיוס · " + (res.zones.inside.length + res.zones.near.length) + " אזורי איסור בקרבה");
      await buildMapImage(steps, st);
      S.report = true;
      renderAll();
      $("resultsSec").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      $("e_run").textContent = "הבדיקות לא הושלמו: " + e.message + ". הבקשה אינה מסומנת כמוכנה לשליחה — אפשר להריץ שוב.";
      if (S.res) { S.report = true; renderAll(); } else { $("resultsSec").style.display = "none"; }
    } finally { S.running = false; $("runBtn").disabled = false; }
  }
  // ארבע התמונות במקביל (aerial, street, overview, region); השער נסגר בהצלחה רק כשכולן עם רקע אמיתי ובלי קנבס "מזוהם".
  // "האחרון מנצח": כל בנייה לוכדת בתחילתה מספר רץ (S.buildSeq) ואת ניתוח הבקשה (res). תוצאה שהוחלפה — בבנייה חדשה יותר, בהרצה חדשה או בהוספה ידנית (res אחר) — נזרקת: היא אינה נוגעת
  // ב-S.imgs, בשם האתר שצויר (S.imgSite), בסטטוס map ובדגל ההמתנה. שם האתר נקבע ברגע הציור עצמו (ההמשך של render בלי מעבר בין משימות), לא ברגע שהבנייה מסתיימת.
  let lastBuild = null;
  async function buildMapImage(steps, st) {
    const res = S.res, seq = ++S.buildSeq;
    S.building = true; syncPending();
    const stale = () => seq !== S.buildSeq || res !== S.res;
    const job = (async () => {
      try {
        const out = await Promise.all(IMGS.map(m => M.render(res, m.opts).then(x => { x.site = (res.inp.siteName || "").trim(); return x; })));
        if (stale()) return false;
        const imgs = {}; IMGS.forEach((m, i) => { imgs[m.k] = out[i]; });
        const sites = [...new Set(out.map(x => x.site))];   // יותר משם אחד = השם שונה באמצע הציור; לא אמור לקרות (עריכה כזו מחליפה את הבנייה), ואם קרה — נכשל סגור
        S.imgs = imgs; S.imgSite = sites.length === 1 ? sites[0] : null;
        if (sites.length === 1 && out.every(x => x.background && !x.tainted)) { st && st("map", "ok", "הרקע נטען (" + imgs.aerial.tiles + " אריחים לתקריב)"); setStatus("map", true, ""); }
        else { const why = sites.length > 1 ? "שם האתר שונה בזמן ציור התמונות" : out.some(x => x.tainted) ? "הדפדפן חסם יצוא תמונה" : out.reduce((a, x) => a + x.failedTiles, 0) + " אריחי רקע לא נטענו"; st && st("map", "no", why); setStatus("map", false, why); }
        return true;
      } catch (e) {
        if (stale()) return false;
        S.imgs = {}; S.imgSite = null; st && st("map", "no", e.message); setStatus("map", false, e.message);
        return true;
      } finally { if (seq === S.buildSeq) { S.building = false; syncPending(); } }
    })();
    lastBuild = job;
    const applied = await job;
    // בניית ההרצה הוחלפה בעדכנית יותר: מחכים לה ומדווחים בהתקדמות את התוצאה שלה (שלב "תמונות" לא נשאר תלוי על "…")
    if (!applied && st) {
      let p = lastBuild;
      while (p && p !== job) { await p; if (lastBuild === p) break; p = lastBuild; }
      const m = S.statuses.map;
      st("map", m && m.ok ? "ok" : "no", m && m.ok ? "עודכן לפי השינוי האחרון בטופס" : (m && m.msg) || "");
    }
    return applied;
  }

  /* ---------- שינויי קלט אחרי הרצה ---------- */
  function onScanInputChange() {
    $("ftHint").textContent = isFinite(parseFloat($("height").value)) ? "= " + (parseFloat($("height").value) * C.M2FT).toFixed(1) + " רגל" : "";
    if (S.res && S.scanKey !== scanKey()) { S.stale = true; clearOutcome(); refreshGate(); }
  }
  // שדות "רכים": משנים את הטופס והדוח אך לא את הניתוח. כל שינוי בהם מבטל את תוצאות השמירה/השליחה (הם נכנסים ל-Word) ומרנדר את הדוח מחדש
  const SOFT_KEYS = ["siteName", "purpose", "aircraft", "vlos", "requesterName", "requesterPhone", "requesterOrg", "callsign", "registration", "contacts", "participants", "knownObstacles", "visitDate", "visitNotes"];
  function onSoftInputChange() {
    if (!S.res) return;
    clearOutcome();
    clearTimeout(rebuildTimer);
    const t = rebuildTimer = setTimeout(async () => {
      if (!S.res) { if (rebuildTimer === t) rebuildTimer = null; syncPending(); return; }   // הרצה חדשה אפסה את התוצאה אחרי העריכה (run מנקה את הטיימר; זו רשת ביטחון)
      try {
        const i = readInputs();
        SOFT_KEYS.forEach(k => { S.res.inp[k] = i[k]; });
        const errs = C.validateInput(S.res.inp, S.cfg); showErrors(errs);
        setStatus("input", errs.length === 0, errs.map(e => e.msg).join(" · "));
        // התמונות תלויות רק בשם האתר (כותרת הקנבס): מציירים מחדש כששם האתר השתנה, כשהציור הקודם נכשל/חסר, או כשבנייה רצה כעת (ייתכן שצוירה עם שם ביניים — היא מוחלפת בעדכנית)
        const imgsOk = IMGS.every(m => S.imgs[m.k]) && S.statuses.map && S.statuses.map.ok;
        const building = S.scanKey === scanKey() && (S.building || !imgsOk || S.imgSite !== (S.res.inp.siteName || "").trim()) ? buildMapImage(null, null) : null;
        if (rebuildTimer === t) rebuildTimer = null;   // מכאן "ממתין" נגזר מהבנייה (S.building, שהתחילה מיד) — ובנייה מיושנת שעוד רצה לא תחזיק את השער סגור
        if (building) await building;
      } finally {
        if (rebuildTimer === t) rebuildTimer = null;
        if (S.res && !S.running) renderAll(); else { syncPending(); if (S.res) refreshGate(); }   // באמצע הרצה: run מרנדר בסיומה
      }
    }, 450);
    // בכל תו: הלחצנים ננעלים מיד (pending), אבל אזור השער והדוח אינם מרונדרים מחדש ואין באנר חדש (אלא אם שם האתר שונה — ההדמיות באמת ייבנו מחדש).
    // הרינדור, האימות והמייל קורים פעם אחת אחרי 450 מ״ש בלי הקלדה — כך הפריסה מעל תיבת ההקלדה לא זזה והמיקוד והסמן נשארים
    syncPending(); refreshGate({ quiet: true });
  }

  /* ---------- הדוח ---------- */
  function renderAll() { if (!S.res || S.resetting) return; S.report = true; refreshGate(); renderLimits(); const m = O.mail(S.res, S.cfg); $("btnMail").href = m.mailto; $("mailInfo").textContent = "נושא: " + m.subject; }
  // מגבלות המקורות הן כלי פנימי (תצוגה מתקדמת): למי שאין לו — התיבה מוסתרת (applyRole) וגם ריקה
  function renderLimits() { if (!isAdv()) { $("limits").innerHTML = ""; return; } $("limits").innerHTML = O.sourceNotes(S.res, S.data.zones ? { zones: S.data.zones, inpa: S.data.inpa } : {}, S.cfg).concat("זריחה ושקיעה לפי חישוב אסטרונומי לנקודה, לא לוח רשמי. ההתייחסות לגובה ולתנאים זהה ביום ובלילה.").map(x => "<li>" + esc(x) + "</li>").join(""); }
  const reportData = () => ({ zones: S.data.zones, inpa: S.data.inpa, agri: S.data.agri, notamFetchedIso: S.data.notamFetchedIso, near: S.data.near });
  const reviewText = () => O.reviewText(S.reviewAt);   // ״אישור סקירה אנושית״ בדף הבדיקות וב-Word: המבקש אישר את ההצהרה ב-<מועד> (הנוסח ב-output.js)
  // אפשרויות משותפות למסך ול-Word: שם ספק הרקע בכל תמונה (לכותרות), טקסט אישור הסקירה, והאם לכלול דף בדיקות
  function modelOpts(images) {
    const pn = {}; IMGS.forEach(m => { const x = S.imgs[m.k]; pn[m.k] = x ? ((M.PROVIDERS[x.provider] || {}).name || "") : ""; });
    return { images: images || {}, providerName: (M.PROVIDERS.esri || {}).name || "", providerNames: pn, includeChecks: $("incChecks").checked, review: reviewText(), draft: S.ready ? "" : "יש בדיקות שלא הושלמו", adv: isAdv() };   // adv: סעיף ההגשה במסך וב-Word לפי תצוגת המבקש (מלא / סיכום)
  }
  // מבנה הדוח על המסך זהה לזה שב-Word: הכול נבנה מאותו מודל (O.docxModel) — טופס, ארבעה עמודי תמונה, ודף בדיקות עם כותרות סעיף ממוספרות ברצף
  function renderReport() {
    const res = S.res, cfg = S.cfg; if (!res || S.resetting) return;
    const data = reportData(), mdl = O.docxModel(res, data, cfg, modelOpts({})), draft = !S.ready;
    const rowsHtml = mdl.rows.map(r => "<tr><td class='k'>" + r.n + ". " + esc(r.label) + (r.sub ? "<small>" + esc(r.sub) + "</small>" : "") + "</td><td>" + r.html + "</td></tr>").join("");
    const draftBanner = draft ? "<div class='draft'>טיוטה — לא מוכן לשליחה: " + (S.stale ? "הנתונים השתנו מאז הרצת הבדיקות" : "יש בדיקות שלא הושלמו") + ".</div>" : "";
    const now = new Date();
    const p1 = "<div class='paper'>" + draftBanner + "<div class='hdr'><span>" + esc(mdl.title) + "</span><span>" + esc(mdl.subtitle) + "</span></div><table class='f'>" + rowsHtml + "</table>" +
      "<p style='margin-top:8px'>" + O.attachmentsLine() + "<br>*את הבקשה יש להגיש לכתובות המייל: <span dir='ltr'>" + esc(cfg.mail.to.join(", ")) + "</span></p>" +
      "<div class='foot'><span>" + esc(cfg.form) + "</span><span>הופק " + esc(now.toLocaleDateString("he-IL")) + "</span></div></div>";
    // ארבעה עמודי תמונה: תצ״א, מפת רחובות, מבט כללי (+ טבלת הפריטים) ומפת אזור. מקרא הצבעים מתחת לתצ״א הראשונה
    const imgOf = (m, alt) => m && m.dataUrl ? "<img class='mapimg' alt='" + alt + "' src='" + (m.jpegUrl || m.dataUrl) + "'>" : "<div class='draft'>התמונה לא נוצרה.</div>";
    const imgPage = (title, inner) => "<div class='paper'>" + draftBanner + "<div class='hdr'><span>" + esc(title) + "</span></div>" + inner + "</div>";
    const items = mdl.items.length ? "<h2>מכשולים, אתרים ותשתיות המסומנים במפה</h2><table class='t'><tr><th>#</th><th>מה</th><th>מרחק מהנקודה</th><th>איפה</th></tr>" +
      mdl.items.map(i => "<tr><td>" + esc(i.n) + "</td><td>" + esc(i.title) + "</td><td>" + esc(i.dist) + "</td><td>" + esc(i.where) + "</td></tr>").join("") + "</table>" : "";
    const pImgs = imgPage(mdl.aerialTitle, imgOf(S.imgs.aerial, "תצ״א תקריב") + "<p class='muted' style='margin-top:6px'>" + esc(mdl.mapNote) + "</p>") +
      imgPage(mdl.streetTitle, imgOf(S.imgs.street, "מפת רחובות תקריב")) +
      imgPage(mdl.overviewTitle, imgOf(S.imgs.overview, "הדמיה וסימונים במבט כללי") + items) +
      imgPage(mdl.regionTitle, imgOf(S.imgs.region, "מפת אזור מרוחקת"));
    // דף בדיקות: כותרות סעיף ממוספרות במונה רץ — רק סעיפים שמוצגים
    let sec = 0;
    const secH = t => "<h2>" + (++sec) + ". " + esc(t) + "</h2>";
    const chk = mdl.checks.map((r, k) => "<tr><td>" + (k + 1) + "</td><td>" + esc(r[0]) + "</td><td>" + esc(r[1]) + "</td><td>" + r[2] + "</td></tr>").join("");
    const cov = mdl.coverage;
    // covHtml פונקציה: המונה רץ לפי סדר ההצגה, ולכן כותרת הסעיף נוצרת רק במקומה בדף
    // "פריטים נוספים" היא תת-סעיף של המצאי: כותרת משנית "<מס' הסעיף>.1" (לא סעיף ממוספר נפרד, כדי שהמספור יישאר רצוף בלי חורים), כמו ב-Word
    const covHtml = () => { const h = secH("מצאי לפי קבוצות"), n = sec; return h + "<table class='t'><tr><th>קבוצה</th><th>נמצאו</th><th>בתוך הסגירה</th><th>בטבעת הכתומה</th><th>בקרבה</th></tr>" +
      cov.groups.map(g => "<tr><td>" + esc(g.group) + "</td><td>" + g.found + "</td><td>" + g.inside + "</td><td>" + g.ring + "</td><td>" + g.near + "</td></tr>").join("") + "</table>" +
      (cov.censusOnly.length ? "<h3>" + n + ".1 פריטים נוספים שנמצאו בקרבה ואינם בטופס</h3><p>" + cov.censusOnly.map(i => esc(i.title + " — " + i.dist)).join("; ") + (cov.censusMore ? "; ועוד " + cov.censusMore + " פריטים" : "") + ".</p>" : ""); };
    const dn = mdl.dayNight.map(r => "<tr>" + r.map(c => "<td>" + esc(c) + "</td>").join("") + "</tr>").join("");
    const rv = reviewText(), visitNote = O.visitNoteHtml(res);   // הערות המבקש / ממצאי סיור: HTML מוכן (escaped) או ""
    const p3 = "<div class='paper checks'><div class='hdr'><span>דף בדיקות</span><span>לא חלק מהטופס הרשמי</span></div>" +
      secH("הנקודה") + "<p><span dir='ltr'>" + esc(C.dmsLat(res.inp.lat) + " " + C.dmsLon(res.inp.lon)) + "</span> · ירוק: " + res.R + " מ׳ · כתום: עד " + 2 * res.R + " מ׳ · גובה " + C.trimNum(res.inp.heightM, 2) + " מ׳ (" + res.ft.toFixed(1) + " רגל)</p>" +
      (visitNote ? "<p>" + visitNote + "</p>" : "") +
      secH("הבדיקות שבוצעו") + "<table class='t ck'><tr><th>#</th><th>בדיקה</th><th>מקור</th><th>תוצאה</th></tr>" + chk + "</table>" + covHtml() +
      (dn ? secH("יום ולילה בחלון הפעילות") + "<table class='t'><tr>" + mdl.dayNightHead.map(h => "<th>" + esc(h) + "</th>").join("") + "</tr>" + dn + "</table>" : "") +
      secH(mdl.submissionHead) + (mdl.summary ? "<ul>" + mdl.summary.map(l => "<li>" + l + "</li>").join("") + "</ul>" : "<p>" + mdl.submission + "</p>") +   // סיכום בנקודות (בלי תצוגה מתקדמת) או הנוסח המלא
      (rv ? secH("אישור סקירה אנושית") + "<p>" + esc(rv) + "</p>" : "") +
      "<div class='foot'><span>" + esc(mdl.footer) + "</span></div></div>";
    $("report").className = $("incChecks").checked ? "" : "nochecks";
    S.reportDraft = draft;   // הדוח נבנה עכשיו מהמצב הנוכחי: markReportDraft (בסוף refreshGate) מסיר את pendDraft
    $("report").innerHTML = p1 + pImgs + p3;
    const style = document.getElementById("nochecksStyle") || Object.assign(document.createElement("style"), { id: "nochecksStyle" });
    style.textContent = ".nochecks .paper.checks{display:none !important}"; document.head.appendChild(style);
    S.reportHtml = true;
    markReportDraft();
  }

  /* ---------- תוספות ידניות ואישור סקירה ---------- */
  function renderManual() {
    $("manualList").innerHTML = S.manual.length ? S.manual.map((m, i) => '<li>' + esc(m.name) + (m.heightM ? " · גובה " + m.heightM + " מ׳" : "") + ' <span class="hint" dir="ltr">(' + m.lat.toFixed(6) + ", " + m.lon.toFixed(6) + ')</span> <button type="button" data-del="' + i + '" style="min-height:28px;padding:2px 10px;font-size:12px">הסר</button></li>').join("") : '<li class="hint">לא הוזנו תוספות.</li>';
    $("manualList").querySelectorAll("[data-del]").forEach(b => b.onclick = () => { S.manual.splice(+b.dataset.del, 1); reanalyze(); });
  }
  async function reanalyze() {
    renderManual();
    if (!S.res) return;
    const inp = Object.assign({}, S.res.inp, { manualItems: S.manual });
    const data = { zones: S.data.zones, inpa: S.data.inpa, agri: S.data.agri, notams: S.data.notams, notamFetchedIso: S.data.notamFetchedIso, near: S.data.near, far: S.data.far, ext: S.data.ext, reverse: S.data.reverse };
    const prev = S.res; S.res = C.analyze(inp, data, S.cfg, new Date());
    S.analysisStamp = { zonesHash: data.zones.dataHash, notamIso: data.notamFetchedIso };
    S.reviewAt = null; $("reviewOk").checked = false; S.statuses.review = { ok: false, msg: "הרשימה השתנתה — " + O.DECLARATION.gate + " מחדש" }; clearOutcome();
    const building = buildMapImage(null, null);   // מתחילה מיד ומסמנת "ממתין" (נגזר מהבנייה הרצה ומטיימר עריכה, לא מדגל שבנייה מיושנת מאפסת)
    refreshGate();
    try { await building; } finally { renderAll(); }
  }
  function addManual() {
    const name = $("mName").value.trim(), c = C.parseCoordInput($("mCoord").value), h = parseFloat($("mHeight").value);
    $("e_manual").textContent = "";
    if (!name) { $("e_manual").textContent = "יש להזין שם או תיאור."; return; }
    if (!c) { $("e_manual").textContent = "יש להזין נ״צ (או ללחוץ ״בחר מיקום מהמפה״)."; return; }
    S.manual.push({ name, lat: c.lat, lon: c.lon, heightM: isFinite(h) && h > 0 ? h : null });
    $("mName").value = ""; $("mCoord").value = ""; $("mHeight").value = "";
    reanalyze();
  }
  function onReviewChange() {
    clearOutcome();   // נוסח אישור הסקירה נכנס לקובץ ה-Word, ולכן הגרסה השמורה בדרייב כבר לא תואמת
    S.reviewAt = $("reviewOk").checked ? new Date() : null;
    setStatus("review", $("reviewOk").checked, $("reviewOk").checked ? "" : O.DECLARATION.gate);
  }

  /* ---------- הורדות והעתקה ---------- */
  // כל הפקה/העתקה/הדפסה/מחיקה בודקת התחברות בעצמה — בנוסף לנעילת הדף (inert), לכפתורים המושבתים ולאיפוס בהתנתקות: הפעלה במקלדת, תוכנתית או בטכנולוגיה מסייעת בלי סשן תקף לא עושה דבר ומציגה את מסך הכניסה
  const authed = () => { const A = window.ReqAuth; if (A && A.loggedIn()) return true; try { A && A.show(); } catch (e) { /* ignore */ } return false; };
  function download(name, mime, data) {
    if (!authed() || !S.res) return;
    const b = data instanceof Blob ? data : new Blob([data], { type: mime });
    const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  const baseName = () => O.fileBase(S.res);
  const b64ToBytes = u => { const bin = atob(u.split(",")[1]), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; };
  async function docxBytes() {
    const img = m => m && m.jpegUrl ? { bytes: b64ToBytes(m.jpegUrl), w: m.canvas.width, h: m.canvas.height } : null;
    const images = {}; IMGS.forEach(m => { images[m.k] = img(S.imgs[m.k]); });
    return window.ReqDocx.build(O.docxModel(S.res, reportData(), S.cfg, modelOpts(images)));
  }
  const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  async function downloadDocx() {
    if (!authed() || !S.res) return;
    const bytes = await docxBytes();
    download(baseName() + " — בקשה לסגירה אווירית.docx", DOCX_MIME, new Blob([bytes], { type: DOCX_MIME }));
  }
  // הורדת אחת מארבע התמונות (PNG) בשם לפי החוזה: "<מקום — תאריך> — <תווית>.png"
  async function downloadImg(m) {
    if (!authed() || !S.res) return;
    const x = S.imgs[m.k]; if (!x || !x.dataUrl) return;
    download(baseName() + " — " + m.file + ".png", "image/png", await (await fetch(x.dataUrl)).blob());
  }

  /* ---------- שמירה אוטומטית בדרייב (דרך שרת ההתחברות) ---------- */
  const bytesToB64 = bytes => { let s = ""; const CH = 0x8000; for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return btoa(s); };
  const utf8B64 = t => bytesToB64(new TextEncoder().encode(t));
  const MAX_B64 = 8.5 * 1024 * 1024;   // תקרת השרת לקובץ אחד היא 9MB אחרי קידוד
  // הנתונים שהוזנו (בלי שמות וטלפונים) — מאפשרים להריץ את הבדיקות שוב על אותה בקשה
  function inputsForRecord() {
    const o = {}; Object.keys(S.res.inp).forEach(k => { if (!/^(req|contact|requester|participant|callsign|registration)/i.test(k)) o[k] = S.res.inp[k]; });
    // declaration: הצהרת המבקש (גרסת הנוסח, מועד האישור והטקסט) — ללא שם או טלפון; בקשה שנשמרת מוכנה תמיד נושאת אותה (השער S.ready דורש את הסימון), null רק כרשת ביטחון
    return { savedAt: new Date().toISOString(), site: baseName(), version: (S.data.zones && S.data.zones.mapVersion) || "", edition: (S.data.zones && S.data.zones.edition) || "", declaration: O.declarationRecord(S.reviewAt), inputs: o,
      zones: [...S.res.zones.inside, ...S.res.zones.near].map(z => ({ id: z.id, d: Math.round(z.d) })), items: S.res.nearScan.items.map(i => ({ n: i.n, title: i.title, d: Math.round(i.d) })) };
  }
  function imageFile(m, label) {
    if (!m) return null;
    const png = m.dataUrl && m.dataUrl.split(",")[1];
    if (png && png.length < MAX_B64) return { name: baseName() + " — " + label + ".png", mime: "image/png", b64: png };
    return m.jpegUrl ? { name: baseName() + " — " + label + ".jpg", mime: "image/jpeg", b64: m.jpegUrl.split(",")[1] } : null;
  }
  // שומר את כל קבצי הבקשה בתיקייה בדרייב ומחזיר {folderId,url,name,count}; זורק שגיאה בכשל.
  // rid: אותה בקשה נשמרת לאותה תיקייה; כשהמקום או התאריך השתנו זו בקשה אחרת — מזהה חדש, כדי לא לדרוס בקשה קודמת בדרייב.
  async function persistToDrive(progress) {
    const rev0 = S.rev;   // גרסת הבקשה שממנה נבנים הקבצים; עריכה בזמן השמירה מקדמת אותה (clearOutcome) והקבצים בדרייב כבר אינם מעודכנים
    S.driveTry = rev0;    // הגרסה הזו נוסתה: השמירה האוטומטית לא תחזור עליה (גם אם הניסיון נכשל)
    S.saved = null;       // שמירה חדשה מתחילה: הקבצים הקודמים בדרייב עומדים להיות מוחלפים, ולכן ״נשמר לגרסה הזו״ אינו נכון עד שהיא מצליחה (אחרת שליחה אחרי כשל תדלג על השמירה)
    const A = window.ReqAuth, i0 = S.res.inp, key = JSON.stringify([i0.lat, i0.lon, i0.dateFrom, i0.dateTo]);
    if (!S.rid || (S.ridKey && S.ridKey !== key)) S.rid = newRid();
    S.ridKey = key;
    let begin = await A.call("saveBegin", { folderName: baseName(), rid: S.rid });
    // הבקשה הקודמת עם אותו מזהה כבר נשלחה (והתיקייה שלה נעולה) והבקשה השתנתה מאז — זו בקשה חדשה, בתיקייה חדשה
    if (!begin.ok && begin.error === "already_sent") { S.rid = newRid(); begin = await A.call("saveBegin", { folderName: baseName(), rid: S.rid }); }
    if (!begin.ok) { const e = new Error(A.msg(begin)); e.code = begin.error; throw e; }
    const files = [
      { name: baseName() + " — בקשה לסגירה אווירית.docx", mime: DOCX_MIME, b64: bytesToB64(await docxBytes()) },
      { name: baseName() + ".kml", mime: "application/vnd.google-earth.kml+xml", b64: utf8B64(O.kml(S.res, { zones: S.data.zones }, S.cfg)) },
      ...IMGS.map(m => imageFile(S.imgs[m.k], m.file)),
      { name: baseName() + " — נתוני הבקשה.json", mime: "application/json", b64: utf8B64(JSON.stringify(inputsForRecord(), null, 1)) }
    ].filter(Boolean);
    let n = 0;
    for (const f of files) {
      if (progress) progress(++n, files.length, f.name);
      const r = await A.call("saveFile", { folderId: begin.folderId, name: f.name, mime: f.mime, b64: f.b64 });
      if (!r.ok) throw new Error(f.name + ": " + A.msg(r));
    }
    // השרת מסמן את הבקשה "מוכנה" רק כאן, אחרי שכל הקבצים נשמרו, והדפדפן מצהיר שכל הבדיקות עברו — ורק בקשה מסומנת תישלח
    // הבקשה שונתה בזמן ההעלאה: saveEnd נשלח עם ready:false (הקבצים אינם הגרסה הנוכחית, ולכן לא תסומן מוכנה), ונזרקת שגיאה — בלי ״נשמרו״ ובלי תוצאה
    // הקוד request_changed סוגר את חלון השליחה (guarded) ופותח אותו מחדש; בשמירה ידנית ההודעה מוצגת בשורת הסטטוס, ובשמירה אוטומטית היא לא מוצגת (עריכה בזמן השמירה — הבקשה תישמר שוב כשתהיה מוכנה)
    const changedErr = () => { const e = new Error("הבקשה שונתה בזמן השמירה — הקבצים בדרייב אינם מעודכנים; יש לשמור שוב."); e.code = "request_changed"; return e; };
    const changed = S.rev !== rev0;
    const end = await A.call("saveEnd", { folderId: begin.folderId, ready: !!S.ready && !changed });
    if (!end.ok) throw new Error(A.msg(end));
    if (changed || S.rev !== rev0) throw changedErr();   // השני: שינוי שהגיע בזמן שקריאת saveEnd עצמה הייתה בדרך
    if (!end.ready) throw new Error(isAdmin() ? "השרת לא סימן את הבקשה כמוכנה לשליחה (חסר קובץ Word או תמונת מפה/תצ״א, או שהבדיקות לא הושלמו) — יש לשמור שוב" : sup("לא ניתן היה להכין את הבקשה לשליחה — נסו שוב; אם הבעיה חוזרת, פנו לתמיכה."));
    S.driveUrl = begin.url;
    const saved = { folderId: begin.folderId, url: begin.url, name: begin.name, count: files.length };
    S.saved = { rev: rev0, folder: saved };   // הגרסה הנוכחית שמורה בדרייב: שליחה לא תשמור אותה שוב, והשמירה האוטומטית לא תחזור עליה (S.saved נמחק בכל שינוי — clearOutcome)
    return saved;
  }
  // ״שמור בדרייב״, השמירה האוטומטית ו״אפשרויות נוספות״ (הדפסה/PDF, Word, KML, ארבע התמונות) זמינים לכל חשבון (ארכיון מרכזי: ארגוני תחת ״הארגון״, מטיס תחת ״מטיסים/<משתמש>״). התיקייה בדרייב של בעל המערכת, ולכן הקישור אליה למנהל בלבד;
  // וכן המייל הידני (העתקה ופתיחת mailto, ב-#manualMail) והפירוט הטכני — למנהל בלבד: mailto אינו מצרף קבצים ואינו נרשם ביומן השליחות
  const isAdmin = () => !!(window.ReqAuth && window.ReqAuth.getRole && window.ReqAuth.getRole() === "admin");
  // רמזי שדות הגורם המבקש, אות הקריאה ומס׳ הרישום בחשבון ארגוני (בחשבון עצמאי נשאר הנוסח שב-index.html: אין ברירת מחדל)
  const ORG_HINTS = {
    hReqOrg: "נספח ג׳ שדה 2 — חובה, עד 80 תווים. בחשבון ארגוני נטען כאן שם הארגון כברירת מחדל; אפשר לערוך אותו, והעריכה נשמרת.",
    hReqCallsign: "נספח ג׳ שדה 13 — עד 40 תווים. בחשבון ארגוני נטענת כאן ברירת המחדל של הארגון; אפשר לערוך אותה, והעריכה נשמרת. ריק = ״לא רלוונטי״.",
    hReqReg: "נספח ג׳ שדה 14 — עד 40 תווים. בחשבון ארגוני נטענת כאן ברירת המחדל של הארגון; אפשר לערוך אותה, והעריכה נשמרת. ריק = ״לא רלוונטי״."
  };
  function applyRole() {
    const mm = $("manualMail");
    if (mm) mm.hidden = !isAdmin();   // המייל הידני (העתקה ופתיחת mailto) — למנהל בלבד (hidden = גם לא נגיש במקלדת ובקורא מסך)
    const mb = $("btnMore") && $("btnMore").closest(".hw") && $("btnMore").closest(".hw").querySelector(".hbtn");
    if (mb) mb.setAttribute("data-help", HELP.btnMore + (isAdmin() ? HELP_MORE_ADMIN : ""));
    // ההסבר של ״שלח״ ורמזי שדות הגורם המבקש לפי סוג החשבון: ארגוני (שולח בשם הארגון, וברירות המחדל שלו נטענות) או מטיס עצמאי (ברירת המחדל; הנוסח הקבוע ב-HELP וב-index.html)
    const org = isOrg(), sb = $("btnSend"), hb = sb && sb.closest(".hw") && sb.closest(".hw").querySelector(".hbtn");
    if (hb) hb.setAttribute("data-help", org ? HELP_SEND_ORG : HELP.btnSend);
    Object.keys(ORG_HINTS).forEach(id => { const e = $(id); if (!e) return; if (e.dataset.base == null) e.dataset.base = e.textContent; e.textContent = org ? ORG_HINTS[id] : e.dataset.base; });
  }
  const hhmm = () => { const d = new Date(); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
  // auto: שמירה אוטומטית (scheduleAutoSave) — אותה זרימה כמו הכפתור, בלי A.setBusy (לא חוסמת חלונות), ובלי הודעת שגיאה כשהבקשה שונתה בזמן השמירה
  async function saveToDrive(auto) {
    const out = $("driveMsg"), btn = $("btnDrive"), A = window.ReqAuth;
    if (!S.ready || S.sending) return;
    if (!A.loggedIn()) { if (!auto) A.show(); return; }
    // גרסה שכבר נשלחה חי למשרד: התיקייה נעולה (already_sent) ושמירה נוספת הייתה פותחת תיקייה כפולה ״פתוחה״ — לא שומרים שוב
    if (S.sent && S.sent.mode === "live" && S.sent.target === "office") { out.className = "small ok"; out.textContent = "הגרסה הזו כבר נשלחה למשרד נוטאם ושמורה בדרייב — אין צורך לשמור שוב."; return; }
    const rev0 = S.rev;
    S.driveTry = rev0;   // גם ניסיון שנעצר לפני ההעלאה (סנכרון) סוגר את הגרסה לשמירה אוטומטית — אין לולאת ניסיונות
    S.sending = true; if (!auto) A.setBusy(true); refreshGate();
    try {
      if (!(await checkSync())) { out.className = "small err"; out.textContent = "לא נשמר: הנתונים אינם מסונכרנים עם מפת החברים (ראו ההודעה בראש הדף)."; return; }
      if (!S.ready) { out.className = "small err"; out.textContent = "לא נשמר: הנתונים השתנו מאז הרצת הבדיקות — יש להריץ אותן שוב."; return; }
      out.className = "small"; out.textContent = "שומר בדרייב…";
      const r = await persistToDrive((n, t, name) => { if (S.rev === rev0) out.textContent = "שומר בדרייב… (" + n + "/" + t + ") " + name; });
      const link = isAdmin() ? ' — <a href="' + esc(r.url) + '" target="_blank" rel="noopener">פתח את התיקייה</a>' : "";   // התיקייה בדרייב של בעל המערכת: הקישור למנהל בלבד
      out.className = "small ok";
      out.innerHTML = auto ? "נשמר אוטומטית בדרייב ✔ (" + hhmm() + ")" + link
        : isAdmin() ? "✔ נשמרו " + r.count + " קבצים בדרייב, בתיקייה <b>" + esc(r.name) + "</b>" + link : "✔ נשמרו " + r.count + " קבצים בדרייב (" + hhmm() + ")";
    } catch (e) {
      if (auto && e && e.code === "request_changed") { out.className = "small"; out.textContent = ""; }
      else { out.className = "small err"; out.textContent = (auto ? "השמירה האוטומטית בדרייב נכשלה: " : "השמירה בדרייב נכשלה: ") + (e && e.message ? e.message : e); }
    } finally { S.sending = false; if (!auto) A.setBusy(false); btn.disabled = !S.ready; refreshGate(); }
  }

  /* ---------- שמירה אוטומטית בדרייב כשהבקשה מוכנה ---------- */
  // כשכל הבדיקות הושלמו, הכול סומן והסקירה אושרה (S.ready) הבקשה נשמרת בדרייב מעצמה, לכל סוג חשבון, כמו לחיצה על ״שמור בדרייב״: פעם אחת לכל גרסה (S.rev) של הבקשה, כ-1.5 שנ׳ אחרי שנהייתה מוכנה
  // (קריאות חוזרות לא דוחות; הפיכה ללא-מוכנה מבטלת). אחרי עריכה שהפכה אותה ללא-מוכנה ושוב למוכנה — נשמרת שוב לאותה תיקייה (אותו rid, הקבצים מוחלפים). שמירה/שליחה בעיצומה (או חלון שליחה פתוח) נדחית, לא מתחרה.
  // כשל מוצג בשורת הסטטוס (הודעת השרת) ואינו חוזר על עצמו (S.driveTry): הכפתור ״שמור בדרייב״ נשאר זמין לניסיון ידני, ועריכה חדשה מתחילה מחזור חדש. הטיימר מבוטל באיפוס הדף (resetPage). config.json → autosave_ms: 1500 כברירת מחדל, 0 = כבוי
  function autoDelay() { const d = S.cfg && S.cfg.autosave_ms; return typeof d === "number" && d >= 0 ? d : 1500; }
  function cancelAutoSave() { clearTimeout(autoTimer); autoTimer = null; autoFor = -1; }
  function autoDue(rev) { return !S.resetting && !!S.res && !S.running && S.ready && S.rev === rev && S.driveTry !== rev && autoDelay() > 0 && !!(window.ReqAuth && window.ReqAuth.loggedIn()); }
  function scheduleAutoSave() {
    const rev = S.rev;
    if (!autoDue(rev)) { cancelAutoSave(); return; }
    if (autoTimer !== null && autoFor === rev) return;   // כבר מתוזמנת לגרסה הזו
    cancelAutoSave(); autoFor = rev;
    autoTimer = setTimeout(() => fireAutoSave(rev), autoDelay());
  }
  function fireAutoSave(rev) {
    autoTimer = null; autoFor = -1;
    if (S.rev !== rev) { scheduleAutoSave(); return; }   // הבקשה השתנתה בהמתנה בלי refreshGate: מתזמנים מחדש אם היא מוכנה
    if (!autoDue(rev)) return;
    if (S.sending || S.opening || $("sendProg")) { autoFor = rev; autoTimer = setTimeout(() => fireAutoSave(rev), autoDelay()); return; }   // שמירה/שליחה אחרת בעיצומה או חלון שליחה פתוח (השליחה שומרת בעצמה): לא מתחרים
    saveToDrive(true);
  }

  /* ---------- שליחה למשרד נוטאם (פמ"ת א-11 סעיף 6(א)) ---------- */
  const fmtTime = t => new Date(t).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
  // קידומות הנושא לפי השרת (Code.gs): בדיקה — לא נשלח למשרד; עותק לעצמי — לא נשלח למשרד. מוצגות בחלון השליחה כדי שהמבקש ידע מה יראה בתיבת הדואר
  const SUBJ_TEST = "[בדיקה — לא נשלח למשרד נוטאם] ", SUBJ_SELF = "[עותק לעצמי — לא נשלח למשרד נוטאם] ";
  const ARCHIVE_NOTE = '<p class="small">הבקשה נשמרת בארכיון המרכזי בדרייב של בעל המערכת, והוא מקבל עותק סמוי של כל שליחה — לצורכי תמיכה בלבד.</p>';
  // הפרדה בין הארגון למטיסים עצמאיים (features.orgSplit): חשבון ארגוני שולח בשם הארגון; מטיס עצמאי — בשם הגורם שהצהיר עליו (fromName), והארגון מקבל עותק סמוי לתמיכה בלבד. למטיס עצמאי לא מוצגת כתובת הארגון ולא נאמר שהארגון הוא השולח או נמען העותק
  const ARCHIVE_ORG = '<p class="small">הבקשה נשמרת בארכיון הארגון בדרייב (תיקיית ״הארגון״).</p>';
  const ARCHIVE_PILOT = '<p class="small">הבקשה נשמרת בארכיון המערכת, וצוות התמיכה של המערכת מקבל עותק סמוי של כל שליחה — לצורכי תמיכה בלבד.</p>';
  const SENDER_SUFFIX = " — דרך מערכת בקשות הטיסה";   // קבוע בשרת (מונע התחזות לרשות); מוצג בחלון השליחה כפי שיופיע בתיבת הדואר
  // שם השולח במייל של מטיס עצמאי כפי שהשרת ינקה אותו (cleanSender_ ב-Code.gs): תווי בקרה וכיווניות (U+0000-001F, 007F-009F, 061C, 200B-200F, 2028-202E, 2066-2069, FEFF) וגם <>"@ ולוכסן הפוך — לרווח; רווחים מכווצים, trim, עד 60 תווים (בלי חצי זוג חלופי בסוף).
  // ריק אחרי ניקוי — השרת משתמש בשם השמור בחשבון (או ״מטיס״); כאן ״מטיס״. הטווחים נבדקים במספרים (בלי רצפי escape בקובץ)
  const SENDER_HIDDEN = [[0, 0x1f], [0x7f, 0x9f], [0x61c, 0x61c], [0x200b, 0x200f], [0x2028, 0x202e], [0x2066, 0x2069], [0xfeff, 0xfeff]];
  function pilotSenderName(raw) {
    let o = "";
    for (const ch of String(raw == null ? "" : raw)) {
      const c = ch.codePointAt(0);
      o += (ch === "<" || ch === ">" || ch === '"' || ch === "@" || ch === String.fromCharCode(92) || SENDER_HIDDEN.some(r => c >= r[0] && c <= r[1])) ? " " : ch;
    }
    let n = o.replace(/\s+/g, " ").trim().slice(0, 60);
    const last = n.charCodeAt(n.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) n = n.slice(0, -1).trim();
    return (n || "מטיס") + SENDER_SUFFIX;
  }
  // S.opening: בזמן שהחלון נבנה (רענון מצב ובדיקת סנכרון מול השרת) השמירה האוטומטית לא מתחילה — אחרת החלון היה נפתח כשזרימה אחרת כבר בעיצומה והלחצן ״שלח״ לא היה עושה כלום
  async function sendToNotam() {
    if (S.opening) return;
    S.opening = true;
    try { await sendToNotamOpen(); } finally { S.opening = false; }
  }
  async function sendToNotamOpen() {
    if (!S.ready || S.sending) return;
    const A = window.ReqAuth;
    if (!A.loggedIn()) { A.show(); return; }
    const out = $("sendMsg");
    // מצב השליחה (בדיקה/חי) נקבע בשרת. מרעננים אותו כאן, ושולחים לשרת את המצב שהוצג למשתמש — אם הוא השתנה, השרת לא שולח
    const me = await A.refresh();
    if (!me.ok) { out.className = "small err"; out.textContent = "לא נשלח: לא ניתן לאמת את מצב השליחה מול השרת — " + A.msg(me); return; }
    if (!(await checkSync())) { out.className = "small err"; out.textContent = "לא נשלח: הנתונים אינם מסונכרנים עם מפת החברים (ראו ההודעה בראש הדף)."; refreshGate(); return; }
    if (!S.ready) { out.className = "small err"; out.textContent = "לא נשלח: הנתונים השתנו מאז הרצת הבדיקות — יש להריץ אותן שוב."; return; }
    // נוסח המייל, האזהרות והאישור שיסומן בחלון הם של גרסת הבקשה הזו (rev0, באותו רגע של בדיקת S.ready). כל שינוי בבקשה מקדם את S.rev (clearOutcome): preflight ולפני כל sendRequest בודקים שהיא לא השתנתה, ואחרי השליחה לא מסמנים S.sent אם השתנתה
    const rev0 = S.rev;
    const mail = O.mail(S.res, S.cfg), shown = A.getMailMode() === "live" ? "live" : "test", live = shown === "live";
    const serverTo = (A.getMailTo() || []).slice().sort().join(","), cfgTo = mail.to.slice().sort().join(",");
    // כתובות היעד קבועות בשרת; מוודאים שהן זהות לכתובות שמצוינות בנוהל (config.json) — אחרת לא שולחים
    if (serverTo !== cfgTo) { out.className = "small err"; out.textContent = isAdmin() ? "לא נשלח: כתובות היעד בשרת (" + serverTo + ") שונות מהכתובות בנוהל א-11 סעיף 6(א) שבהגדרות (" + cfgTo + "). יש לעדכן את השרת." : sup("לא נשלח: כתובות היעד בשרת אינן תואמות את הנוהל (א-11 סעיף 6(א)) — השליחה אינה זמינה כרגע, פנו לתמיכה."); return; }
    const names = ["טופס הבקשה (Word)" + ($("incChecks").checked ? " כולל דף בדיקות" : " בלי דף בדיקות"), "קובץ KML"].concat(IMGS.map(m => m.send));
    const warn = warnings().filter(w => /ימי עבודה|נוטמים נמשכו|מכשול שהוזן ולא נמצא/.test(w));   // אזהרות שחשוב לראות ממש לפני השליחה
    // יעד השליחה. שרת חדש (features.sendTarget) שולח לפי כתובת המבקש שנשמרה בו (נרשמה עם אימות קוד במייל; הלקוח אינו שולח כתובת כלל): למשרד נוטאם (target "office") — עותק למבקש והתשובות אליו, או רק למבקש עצמו (target "self"); במצב בדיקה — רק למבקש.
    // משתמש בלי כתובת (נוצר ידנית על ידי המנהל) — העותק והתשובות נופלים לבעל המערכת (copyToIsOwner), ורק אז מוצגת כתובתו. שרת ישן: בלי target ובלי "לעצמי", ההתנהגות והטקסט כמו קודם (עותק ותשובות לבעל המערכת; בבדיקה — רק לבעל המערכת)
    // שרת עם הפרדה (orgSplit): org = חשבון ארגוני; fromName = הגורם המבקש שהוקלד (השרת מנקה אותו ומשתמש בו כשם השולח של מטיס עצמאי). מטיס עצמאי חייב כתובת שנשמרה ואומתה בשרת — בלעדיה אין לאן לשלוח עותק ותשובות, ולא נחשפת לו כתובת הארגון
    const newSrv = A.hasFeature("sendTarget"), split = newSrv && A.hasFeature("orgSplit"), org = split && A.isOrg(), toOwner = A.getCopyToIsOwner(), addr = A.getCopyTo(), personal = A.getEmail() || "";
    const fromName = split ? String(S.res.inp.requesterOrg || "") : "";
    if (split && !org && (toOwner || !addr)) { out.className = "small err"; out.textContent = sup("לא נשלח: אין כתובת מייל רשומה בחשבון שלך, ולכן אי אפשר לשלוח את הבקשה — פנו לתמיכה."); return; }
    if (newSrv && !addr) { out.className = "small err"; out.textContent = "לא נשלח: השרת לא החזיר את כתובת העותק — אי אפשר להציג למי יישלח המייל."; return; }
    const adr = '<span dir="ltr">' + esc(addr) + "</span>", officeTo = '<span dir="ltr">' + esc(mail.to.join(", ")) + "</span>";
    const noAddr = "אין כתובת מייל רשומה בחשבון שלך — העותק יישלח לבעל המערכת (" + adr + ")";
    const subjOf = t => esc((t === "self" ? SUBJ_SELF : t === "test" ? SUBJ_TEST : "") + mail.subject);
    // שרת ישן: ההוראה לעדכן את השרת (README) מופנית למנהל בלבד; מטיס רגיל אינו יכול ואינו אמור לעדכן שרת — הוא מקבל הודעה ניטרלית
    const adm = isAdmin();
    const oldNote = adm ? '<div class="banner warn" style="margin:8px 0 0"><b>שרת ה-Apps Script עדיין בגרסה הישנה — יש לעדכן אותו (ראו README).</b> עד שיעודכן אי אפשר לשלוח רק לעצמי, והשליחה ממשיכה כמו קודם.</div>'
      : '<div class="banner warn" style="margin:8px 0 0"><b>' + esc(sup("שליחה רק לעצמך אינה זמינה כרגע — פנו לתמיכה.")) + '</b> השליחה ממשיכה כמו קודם.</div>';
    const oldSrvTitle = adm ? "שרת ה-Apps Script בגרסה הישנה — יש לעדכן אותו" : sup("שליחה רק לעצמך אינה זמינה כרגע — פנו לתמיכה");
    const orgName = esc(ORG_NAME()), selfName = esc(pilotSenderName(fromName)), pAdr = '<span dir="ltr">' + esc(personal) + "</span>";
    const sameAddr = !!personal && personal.toLowerCase() === String(addr).toLowerCase();
    // חשבון ארגוני: העותק אל הארגון (כתובת העותק כפי שהשרת מחזיר), ואל כתובת המבקש השמורה אם יש ושונה
    const orgCc = sameAddr ? "הארגון ואליך (" + adr + ")" : "הארגון (" + adr + ")" + (personal ? " ואליך (" + pAdr + ")" : "");
    const dlg = split ? (org ? (live ? {   // הפרדה, חשבון ארגוני, מצב חי
      title: "שליחה למשרד נוטאם",
      banner: '<div class="banner ok" style="margin:0 0 8px"><b>מצב חי:</b> אפשר לשלוח את הבקשה באמת למשרד נוטאם בשם הארגון, או לשלוח רק לעצמך עותק לבדיקה.</div>',
      to: '<p><b>שלח למשרד נוטאם</b><br>אל: ' + officeTo + ' · עותק: ' + orgCc + ' · התשובות יחזרו אל הארגון · שם השולח: ' + orgName + '</p>' +
        '<p><b>שלח רק לעצמי (עותק לבדיקה)</b><br>אל: ' + adr + ' בלבד · התשובות יחזרו אל הארגון · שם השולח: ' + orgName + ' · לא נשלח למשרד</p><p><b>נושא:</b> ' + subjOf("") + ' <span class="hint">(בשליחה לעצמך הנושא יסומן ״' + esc(SUBJ_SELF.trim()) + '״)</span></p>',
      archive: ARCHIVE_ORG, go: "שלח למשרד נוטאם", self: "on"
    } : {   // הפרדה, חשבון ארגוני, מצב בדיקה
      title: "שליחת בדיקה",
      banner: '<div class="banner warn" style="margin:0 0 8px"><b>מצב בדיקה</b> — המייל יישלח רק אל ' + adr + ' ולא למשרד נוטאם · התשובות יחזרו אל הארגון · שם השולח: ' + orgName + '. (מנהל יכול להעביר למצב חי בניהול משתמשים.)</div>',
      to: '<p><b>אל:</b> ' + adr + '</p><p><b>נושא:</b> ' + subjOf("test") + '</p>',
      archive: ARCHIVE_ORG, go: "שלח בדיקה אליי", self: ""
    }) : (live ? {   // הפרדה, מטיס עצמאי, מצב חי
      title: "שליחה למשרד נוטאם",
      banner: '<div class="banner ok" style="margin:0 0 8px"><b>מצב חי:</b> אפשר לשלוח את הבקשה באמת למשרד נוטאם, או לשלוח רק לעצמך עותק לבדיקה.</div>',
      to: '<p><b>שלח למשרד נוטאם</b><br>אל: ' + officeTo + ' · עותק אליך: ' + adr + ' · התשובות יגיעו אליך</p>' +
        '<p><b>שלח רק לעצמי (עותק לבדיקה)</b><br>אל: ' + adr + ' בלבד · לא נשלח למשרד</p><p><b>שם השולח במייל:</b> ' + selfName + '</p><p><b>נושא:</b> ' + subjOf("") + ' <span class="hint">(בשליחה לעצמך הנושא יסומן ״' + esc(SUBJ_SELF.trim()) + '״)</span></p>',
      archive: ARCHIVE_PILOT, go: "שלח למשרד נוטאם", self: "on"
    } : {   // הפרדה, מטיס עצמאי, מצב בדיקה
      title: "שליחת בדיקה",
      banner: '<div class="banner warn" style="margin:0 0 8px"><b>מצב בדיקה</b> — המייל יישלח רק אליך (' + adr + ') ולא למשרד נוטאם. (בעל המערכת יכול להעביר למצב חי בניהול משתמשים.)</div>',
      to: '<p><b>אל:</b> ' + adr + '</p><p><b>שם השולח במייל:</b> ' + selfName + '</p><p><b>נושא:</b> ' + subjOf("test") + '</p>',
      archive: ARCHIVE_PILOT, go: "שלח בדיקה אליי", self: ""
    })) : !newSrv ? {   // שרת ישן
      title: "שליחה למשרד נוטאם",
      banner: (live ? '<div class="banner ok" style="margin:0 0 8px"><b>מצב חי:</b> המייל יישלח באמת אל ' + officeTo + '. עותק יישלח לחשבון הבעלים של המערכת, ותשובות המשרד יגיעו אליו (ולא אליך).</div>'
        : '<div class="banner warn" style="margin:0 0 8px"><b>מצב בדיקה:</b> המייל יישלח רק לחשבון הבעלים של המערכת (לא אליך) ולא יישלח למשרד נוטאם. (בעל המערכת יכול להעביר למצב חי בניהול משתמשים.)</div>') + oldNote,
      to: '<p><b>אל:</b> <span dir="ltr">' + esc((live ? mail.to : ["בעל המערכת (בדיקה)"]).join(", ")) + '</span></p><p><b>נושא:</b> ' + subjOf(live ? "" : "test") + '</p>',
      archive: "", go: live ? "שלח למשרד נוטאם" : "שלח בדיקה לבעל המערכת", self: live ? "disabled" : ""
    } : live ? {   // שרת חדש, מצב חי: שני יעדים
      title: "שליחה למשרד נוטאם",
      banner: '<div class="banner ok" style="margin:0 0 8px"><b>מצב חי:</b> אפשר לשלוח את הבקשה באמת למשרד נוטאם, או לשלוח רק לעצמך עותק לבדיקה.</div>',
      to: '<p><b>שלח למשרד נוטאם</b><br>אל: ' + officeTo + ' · ' + (toOwner ? noAddr + ' · התשובות יגיעו לבעל המערכת' : 'עותק אליך: ' + adr + ' · התשובות יגיעו אליך') + ' · עותק נשמר גם אצל בעל המערכת לצורכי תמיכה</p>' +
        '<p><b>שלח רק לעצמי (עותק לבדיקה)</b><br>אל: ' + (toOwner ? noAddr : adr) + ' בלבד · לא נשלח למשרד</p><p><b>נושא:</b> ' + subjOf("") + ' <span class="hint">(בשליחה לעצמך הנושא יסומן ״' + esc(SUBJ_SELF.trim()) + '״)</span></p>',
      archive: ARCHIVE_NOTE, go: "שלח למשרד נוטאם", self: "on"
    } : {   // שרת חדש, מצב בדיקה: כפתור אחד, ושליחה ל-office נשלחת ממילא למבקש בלבד
      title: "שליחת בדיקה",
      banner: '<div class="banner warn" style="margin:0 0 8px"><b>מצב בדיקה</b> — ' + (toOwner ? "אין כתובת מייל רשומה בחשבון שלך, ולכן המייל יישלח רק לבעל המערכת (" + adr + ")" : "המייל יישלח רק אליך (" + adr + ")") + ' ולא למשרד נוטאם. (בעל המערכת יכול להעביר למצב חי בניהול משתמשים.)</div>',
      to: '<p><b>אל:</b> ' + adr + '</p><p><b>נושא:</b> ' + subjOf("test") + '</p>',
      archive: ARCHIVE_NOTE, go: "שלח בדיקה אליי", self: ""
    };
    const m = A.modal('<div class="sendBox"><h2>' + dlg.title + '</h2>' + dlg.banner + dlg.to +
      '<p><b>קבצים שיצורפו:</b> ' + esc(names.join(" · ")) + '</p><details><summary>נוסח המייל</summary><pre>' + esc(mail.body) + '</pre></details>' +
      warn.map(w => '<div class="banner warn" style="margin:8px 0 0">' + w + '</div>').join("") +
      '<label class="checks" style="margin-top:10px"><span style="display:flex;gap:8px;align-items:flex-start;font-size:14px"><input type="checkbox" id="sendOk" style="margin-top:4px"> עברתי על הבקשה (הטופס, התצ״א והמצאי) והיא מוכנה לשליחה' + (live ? " — שליחה למשרד נוטאם אינה ניתנת לביטול" : "") + '</span></label>' + dlg.archive +
      '<div class="row" style="margin-top:10px"><button type="button" class="primary" id="sendGo" disabled>' + dlg.go + '</button>' +
      (dlg.self ? '<button type="button" id="sendSelf" disabled' + (dlg.self === "disabled" ? ' data-oldsrv="1" title="' + esc(oldSrvTitle) + '"' : "") + '>שלח רק לעצמי (עותק לבדיקה)</button>' : "") +
      '</div><div class="small" id="sendProg" role="status" style="margin-top:8px"></div></div>');
    if (!m) return;
    const ok = document.getElementById("sendOk"), go = document.getElementById("sendGo"), prog = document.getElementById("sendProg"), closeBtn = document.getElementById("mdClose");
    const selfBtn = dlg.self === "on" ? document.getElementById("sendSelf") : null;   // בשרת ישן הכפתור מוצג מושבת תמיד (לא ברשימת הכפתורים הפעילים) — ושום target לא נשלח
    const setGo = d => { go.disabled = d; if (selfBtn) selfBtn.disabled = d; };
    ok.onchange = () => { setGo(!ok.checked); };
    // הבקשה השתנתה בזמן שהחלון פתוח (clearOutcome מקדם את S.rev; הרקע inert, אך שינוי תוכנתי או של טכנולוגיה מסייעת אפשרי): הנוסח והאישור שבחלון אינם של הגרסה העדכנית — נועלים אותו ומסבירים. בזמן שמירה/שליחה (S.sending) הזרימה עצמה בודקת את הגרסה
    S.onStale = () => {
      if (S.sending) return;
      prog.className = "small err"; prog.textContent = "הבקשה שונתה בזמן שהחלון היה פתוח — הנוסח והאישור שבחלון אינם של הגרסה העדכנית, ולא נשלח דבר. יש לסגור את החלון ולפתוח אותו מחדש.";
      setGo(true); ok.disabled = true;
    };
    // target: "office" | "self" (נשלח רק לשרת חדש; expectMode רק ל-office, כמו בחוזה); again: "שלח שוב בכל זאת" — רק ל-office
    const doSend = async (target, again) => {
      const req = { folderId: S.sendFolder.folderId, subject: mail.subject, body: mail.body, again: !!again };
      if (newSrv) req.target = target;
      if (split) req.fromName = fromName;   // שם השולח של מטיס עצמאי (השרת מנקה ומוסיף את הסיומת הקבועה); לחשבון ארגוני השרת משתמש בשם הארגון ומתעלם ממנו
      if (target === "office") req.expectMode = shown;
      const r = await A.call("sendRequest", req);
      if (!r.ok && r.error === "mode_changed") { A.setMailModeValue(r.mailMode); const e = new Error("מצב השליחה השתנה בשרת"); e.code = "mode_changed"; throw e; }
      if (!r.ok && r.error === "already_sent") {
        // similar: השרת מזהה בקשה קודמת של אותו משתמש בלבד על אותו מקום ותאריך (בקשה של מטיס אחר לעולם לא נספרת ולא מדווחת) — לכן הניסוח בגוף שני. השעה מוצגת רק כשהשרת מסר זמן תקין
        const when = r.sentAt != null && r.sentAt !== "" && !isNaN(new Date(r.sentAt).getTime()) ? ' ב-<b>' + esc(fmtTime(r.sentAt)) + '</b>' : "";
        prog.innerHTML = (r.similar ? 'כבר שלחתם למשרד נוטאם בקשה על אותו מקום ותאריך' : 'הבקשה כבר נשלחה למשרד נוטאם') + when + '. <button type="button" id="sendAgain">שלח שוב בכל זאת</button>';
        document.getElementById("sendAgain").onclick = () => guarded(async () => { await preflight(); prog.textContent = "שולח…"; await doSend("office", true); });
        setGo(true); return;
      }
      if (!r.ok) throw new Error(A.msg(r));
      // הבקשה שונתה בזמן ש-sendRequest היה באוויר: המייל כן יצא (הגרסה שאושרה בחלון), ולכן לא מסתירים אותו — אבל לא מסמנים S.sent, לא מציגים ✔ ולא קישור לתיקייה, ונועלים את החלון. שליחה נוספת תשמור ותשלח את הגרסה העדכנית
      if (S.rev !== rev0) {
        const what = newSrv && r.target === "self" ? "הגרסה שאושרה בחלון נשלחה אליך (לא למשרד נוטאם)" : r.mode === "live" ? "הגרסה שאושרה בחלון נשלחה למשרד נוטאם" : "הגרסה שאושרה בחלון נשלחה במצב בדיקה (לא למשרד נוטאם)";
        const m2 = "⚠ " + what + ". הבקשה שונתה בזמן השליחה ולכן הגרסה העדכנית לא נשלחה — יש לסגור את החלון, לאשר ולשלוח מחדש.";
        prog.className = "small err"; prog.textContent = m2; out.className = "small err"; out.textContent = m2;
        setGo(true); ok.disabled = true; return;
      }
      S.sent = { at: r.sentAt, mode: r.mode, to: r.to, target: r.target || "office" };
      // ההודעה לפי מה שהשרת דיווח בפועל (target / mode), לא לפי מה שהתבקש. הכתובת של הבעלים לא מוצגת (רק "בעל המערכת"); פרט ל-copyToIsOwner שמוצג בחלון עצמו
      // חשבון ארגוני: העותק (ובלי כתובת רשומה — גם שליחה לעצמי) אל הארגון; מטיס עצמאי — אליו
      const who = split ? (org ? (toOwner ? "לארגון" : "אליך") : "אליך") : newSrv && !toOwner ? "אליך" : "לבעל המערכת", whoCopy = split && org ? (toOwner ? "לארגון" : "אליך ולארגון") : who;
      let msgHtml;
      if (newSrv && r.target === "self") msgHtml = "נשלח " + who + " ✔ — לא נשלח למשרד נוטאם.";
      else if (r.mode === "live") msgHtml = "נשלחה למשרד נוטאם ✔ (עותק " + whoCopy + ") — <span dir='ltr'>" + esc((r.to || []).join(", ")) + "</span> · " + esc(fmtTime(r.sentAt)) + ".";
      else msgHtml = "נשלח במצב בדיקה " + who + " ✔ — לא נשלח למשרד נוטאם.";
      // התיקייה בדרייב היא של בעל המערכת: הקישור רק למנהל. מטיס רגיל מקבל הודעה בלי קישור (הבקשה נשמרה בארכיון המרכזי כחלק מהשליחה)
      prog.className = "small ok"; prog.innerHTML = msgHtml; out.className = "small ok"; out.innerHTML = msgHtml + (isAdmin() ? ' <a href="' + esc(S.sendFolder.url) + '" target="_blank" rel="noopener">פתח את התיקייה בדרייב</a>' : "");
      // שליחה לעצמי אינה סוגרת את האפשרות לשלוח אחר כך למשרד: האישור מתאפס וצריך לסמן אותו שוב; כל שליחה אחרת נועלת את החלון
      if (newSrv && r.target === "self") { ok.checked = false; ok.disabled = false; setGo(true); } else { setGo(true); ok.disabled = true; }
    };
    const fail = e => { prog.className = "small err"; prog.textContent = "השליחה נכשלה: " + (e && e.message ? e.message : e); setGo(!ok.checked); ok.disabled = false; };
    // זרימה אחת בכל רגע: בזמן שמירה/שליחה אי אפשר לסגור את החלון, לפתוח חלון אחר או להתחיל זרימה שנייה
    const guarded = async fn => {
      if (S.sending) { prog.className = "small"; prog.textContent = "שמירה בדרייב בעיצומה — יש להמתין לסיומה וללחוץ שוב."; return; }
      S.sending = true; A.setBusy(true); refreshGate(); closeBtn.disabled = true; setGo(true); ok.disabled = true; prog.className = "small";
      let reopen = "";
      try { await fn(); }
      catch (e) { if (e && (e.code === "mode_changed" || e.code === "dest_changed" || e.code === "request_changed")) reopen = e.code; else fail(e); }
      finally { S.sending = false; A.setBusy(false); refreshGate(); closeBtn.disabled = false; }
      if (reopen) { A.closeModal(); out.className = "small err"; out.textContent = (reopen === "dest_changed" ? "יעד השליחה בשרת (כתובת העותק) השתנה בזמן שהחלון היה פתוח" : reopen === "request_changed" ? "הבקשה שונתה בזמן שהחלון היה פתוח" : "מצב השליחה בשרת השתנה בזמן שהחלון היה פתוח") + " — לא נשלח דבר. נפתח חלון חדש עם המצב העדכני; יש לאשר מחדש."; sendToNotam(); }
    };
    // בדיקות ממש לפני כל שליחה (גם "שלח שוב בכל זאת"): מצב השליחה בשרת, שהבקשה עדיין מוכנה ומאושרת, והסנכרון עם המפה
    const preflight = async () => {
      prog.textContent = "בודק מצב שליחה…";
      const me2 = await A.refresh();
      if (!me2.ok) throw new Error(A.msg(me2));
      if ((A.getMailMode() === "live" ? "live" : "test") !== shown) { const e = new Error("מצב השליחה השתנה"); e.code = "mode_changed"; throw e; }
      // גם היעד שהוצג בחלון (כתובת העותק, האם היא של הבעלים, ויכולת "לעצמי" של השרת) חייב להיות זהה למה שהשרת מדווח עכשיו — אחרת המשתמש אישר טקסט שאינו תואם למציאות
      if (A.hasFeature("sendTarget") !== newSrv || (A.hasFeature("orgSplit") && newSrv) !== split || (split && A.isOrg() !== org) || A.getCopyTo() !== addr || A.getCopyToIsOwner() !== toOwner || (split && (A.getEmail() || "") !== personal)) { const e = new Error("יעד השליחה השתנה"); e.code = "dest_changed"; throw e; }
      if (!S.ready || !$("reviewOk").checked) throw new Error("הבקשה אינה מוכנה לשליחה (בדיקות שלא הושלמו, נתונים ששונו או הצהרה שלא אושרה) — לא נשלח");
      prog.textContent = "בודק סנכרון עם המפה…";
      if (!(await checkSync())) throw new Error("הנתונים אינם מסונכרנים עם מפת החברים — לא נשלח");
      if (!S.ready) throw new Error("הנתונים השתנו מאז הרצת הבדיקות — לא נשלח");
      // אחרונה, אחרי בדיקות המוכנות (אחרת, כשההדמיות עדיין נבנות, החלון היה נסגר ונפתח מחדש בלי שהפתיחה החוזרת תצליח): האישור שסומן בחלון הוא על גרסה אחת בלבד של הבקשה
      if (S.rev !== rev0) { const e = new Error("הבקשה שונתה בזמן שהחלון היה פתוח"); e.code = "request_changed"; throw e; }
    };
    // שני היעדים עוברים אותן הגנות: preflight, שמירה בארכיון המרכזי (persistToDrive) והשער S.ready. "למשרד" ובמצב בדיקה = target "office" (בבדיקה השרת שולח ממילא רק למבקש)
    const startSend = target => guarded(async () => {
      await preflight();
      // הגרסה הנוכחית כבר שמורה בדרייב (שמירה אוטומטית או ידנית, או שליחה קודמת שלה — clearOutcome מאפס כל שינוי) — לא שומרים שוב, כדי שהשרת יזהה שליחה כפולה
      if (S.saved && S.saved.rev === S.rev) S.sendFolder = S.saved.folder;
      else S.sendFolder = await persistToDrive((n, t, name) => { prog.textContent = "שומר בדרייב… (" + n + "/" + t + ") " + name; });
      if (!S.ready) throw new Error("הנתונים השתנו בזמן השמירה — לא נשלח. הרצו את הבדיקות שוב");
      if (S.rev !== rev0) { const e = new Error("הבקשה שונתה בזמן שהחלון היה פתוח"); e.code = "request_changed"; throw e; }
      prog.textContent = "שולח…";
      await doSend(target, false);
    });
    go.onclick = () => startSend("office");
    if (selfBtn) selfBtn.onclick = () => startSend("self");
    return m;
  }
  async function copyMail() {
    if (!authed() || !S.res) return;
    const m = O.mail(S.res, S.cfg), txt = "אל: " + m.to.join(", ") + "\nנושא: " + m.subject + "\n\n" + m.body;
    try { await navigator.clipboard.writeText(txt); } catch (e) { const t = document.createElement("textarea"); t.value = txt; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); } catch (e2) { /* ignore */ } t.remove(); }
    $("btnCopy").textContent = "הועתק ✔"; setTimeout(() => { $("btnCopy").textContent = "העתק טקסט מייל"; }, 2000);
  }

  const r_name = (cfg, iso) => (cfg.borders[iso] || {}).name || iso;
  /* ---------- בדיקה עצמית ---------- */
  async function selfTest() {
    const out = [], add = (name, ok, detail) => out.push({ name, ok, detail: detail || "" });
    try {
      const [exp, near, far, ext, rev, nsnap] = await Promise.all(["selftest/expected.json", "selftest/yarkon/near.json", "selftest/yarkon/far.json", "selftest/yarkon/ext.json", "selftest/yarkon/reverse.json", "selftest/notam-data.snap.json"].map(getJson));
      const cfg = S.cfg, inp = Object.assign({}, exp.input, { purpose: cfg.purposes[0], aircraft: [cfg.aircraft[0]], vlos: true, siteName: "בדיקה", requesterName: "בודק", requesterPhone: "050-0000000", requesterOrg: "בודק", callsign: "", registration: "", contacts: [{ name: "א", phone: "050-0000001" }, { name: "ב", phone: "050-0000002" }] });
      const data = { zones: S.data.zones, inpa: S.data.inpa, agri: S.data.agri, notams: nsnap.notams, notamFetchedIso: nsnap.fetched_iso, near, far, ext, reverse: rev };
      const res = C.analyze(inp, data, cfg, new Date(exp.now));
      const near1 = (a, b, tol) => Math.abs(a - b) <= tol;
      exp.items.forEach(e => { const it = res.nearScan.items.find(i => i.title === e.title); add("מכשול: " + e.title + " — " + e.d + " מ׳", !!it && near1(it.d, e.d, e.tol || 1.5) && it.zone === e.zone, it ? "חושב " + it.d.toFixed(1) + " מ׳" : "לא נמצא"); });
      add("מספר המכשולים והתשתיות (" + exp.items.length + ")", res.nearScan.items.length === exp.items.length, "נמצאו " + res.nearScan.items.length);
      exp.zones.forEach(e => { const z = [...res.zones.inside, ...res.zones.near].find(x => x.id === e.id); add("אזור " + e.id + " במרחק " + e.d + " מ׳", !!z && near1(z.d, e.d, e.tol || 1.5) && (e.where === "near" ? res.zones.near.includes(z) : res.zones.inside.includes(z)), z ? "חושב " + z.d.toFixed(1) : "לא נמצא"); });
      add("שקיעות " + exp.sunset.join(", "), JSON.stringify(res.sun.map(r => r.sunset)) === JSON.stringify(exp.sunset), res.sun.map(r => r.sunset).join(", "));
      add("המרה לרגל: " + exp.heightM + " מ׳ = " + exp.ft + " רגל", near1(res.ft, exp.ft, 0.01), res.ft.toFixed(3));
      add("DMS של הנקודה", C.dmsLat(inp.lat) === exp.dmsLat && C.dmsLon(inp.lon) === exp.dmsLon, C.dmsLat(inp.lat) + " " + C.dmsLon(inp.lon));
      add("הצעת שם המקום", res.siteSuggestion === exp.siteSuggestion, res.siteSuggestion);
      add("נוטמים רלוונטיים", JSON.stringify(res.notams.hits.map(h => h.id).sort()) === JSON.stringify(exp.notamHits.slice().sort()), res.notams.hits.map(h => h.id).join(", "));
      const rows = O.buildForm(res, cfg);
      add("בטופס 17 שדות", rows.length === 17, String(rows.length));
      add("אין מילות 'טרם נבדק' בטופס", !/טרם נבדק|לא נבדק/.test(rows.map(r => r.text).join(" ")), "");
      for (const b of exp.borders || []) {
        const bx = await getJson("selftest/" + b.fixture + "/ext.json");
        const r = C.analyzeBorders(new C.Proj(b.lat, b.lon), bx, cfg, b.R).find(y => y.iso === b.iso);
        add("גבול " + r_name(cfg, b.iso) + " — " + b.d + " מ׳ (" + b.fixture + ")", !!r && near1(r.d, b.d, b.tol) && r.violates === b.violates, r ? "חושב " + r.d.toFixed(1) : "לא זוהה");
      }
      const kml = O.kml(res, data, cfg);
      add("KML תקין (XML)", new DOMParser().parseFromString(kml, "application/xml").getElementsByTagName("parsererror").length === 0, kml.length + " תווים");
    } catch (e) { add("טעינת נתוני הבדיקה", false, e.message); }
    const ok = out.every(x => x.ok);
    $("stList").innerHTML = out.map(x => '<li class="' + (x.ok ? "ok" : "no") + '">' + (x.ok ? "✔ " : "✖ ") + esc(x.name) + (x.detail ? ' <span class="hint">— ' + esc(x.detail) + "</span>" : "") + "</li>").join("");
    setStatus("selftest", ok, ok ? "" : out.filter(x => !x.ok).map(x => x.name).join("; "));
    const b = $("selftestBanner");
    if (ok) { b.style.display = "none"; } else { b.style.display = "block"; b.textContent = sup("הבדיקה העצמית של המערכת נכשלה — לא ניתן לסמן בקשה כמוכנה לשליחה. פתחו את 'בדיקה עצמית' למטה לפרטים, ואם הבעיה נמשכת פנו לתמיכה."); $("stBox").open = true; }
    return ok;
  }

  /* ---------- אתחול ---------- */
  async function init() {
    if (H) { H.wire(); attachHelp(); }   // לחצני ״!״ ליד כפתורי הדף (ההסברים ב-HELP)
    applyRole();   // עד שהתחברות מזוהה — המייל הידני (#manualMail) מוסתר (נכשל סגור); המנהל מקבל אותו ב-req-auth
    initMap();
    try { initLayerUi(); } catch (e) { logLayerErr("initLayerUi", e); }   // מתגי האיסורים והנוטמים + פס הסיכום (גם כשהמפה לא נטענה: המתגים מושבתים עם הסבר); כשל בהם לעולם לא עוצר את האתחול
    const okCfg = await loadStatic();
    // התנתקות מכל סיבה (auth.js): איפוס מלא וטעינה מחדש; preventDefault = ui.js מטפל (auth.js לא מציג כיסוי בדף הישן — הכיסוי יוצג בדף הנקי, עם ההודעה)
    document.addEventListener("req-logout", ev => { ev.preventDefault(); resetPage(); });
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("req-auth", ev => {   // משתמש אחר באותו דף לא יורש דבר מקודמו (הגנה בעומק: ההתנתקות כבר מטעינה את הדף מחדש, כך שהמקרה הזה אינו אמור להתרחש)
      const u = ev.detail && ev.detail.user;
      if (!u) return;
      if (S.lastUser && S.lastUser !== u) { resetPage(); return; }
      if (!S.lastUser) enterUser(u);
      S.lastUser = u;
      applyRole();
      renderSyncBanner(); refreshGate();   // התפקיד ידוע רק עכשיו: הודעות הסנכרון והשער מוצגות לפי תפקיד
    });
    window.ReqAuth.init(S.cfg);
    ["radius", "height", "dateFrom", "dateTo", "timeFrom", "timeTo"].forEach(id => $(id).addEventListener("input", () => { if (id === "radius") drawCircles(); onScanInputChange(); }));
    $("coord").addEventListener("change", () => { const c = C.parseCoordInput($("coord").value); if (c) setCenter(c.lat, c.lon, true); else scheduleLayerUpdate(); });   // טקסט שאינו נ״צ: הפס מתעדכן להנחיה (layerPoint), ולא ממשיך להציג את הנקודה הקודמת
    ["siteName", "purpose", "vlos", "reqName", "reqPhone", "reqOrg", "reqCallsign", "reqReg", "knownObs", "visitDate", "visitNotes"].forEach(id => (id === "visitDate" ? ["input", "change"] : ["input"]).forEach(ev => $(id).addEventListener(ev, () => { if (id.startsWith("req")) savePerson(); onSoftInputChange(); })));
    // אנשי קשר ומשתתפים: מאזין אחד (delegation) לכל השורות; הוספה והסרה של שורות ב-click
    $("personBox").addEventListener("input", ev => { if (ev.target.closest && ev.target.closest(".plist")) { savePerson(); onSoftInputChange(); } });
    $("personBox").addEventListener("click", ev => { const b = ev.target.closest && ev.target.closest("[data-rm]"); if (b) removeRow(b); });
    $("addContact").onclick = () => addRow("contacts"); $("addPart").onclick = () => addRow("participants");
    $("aircraft").addEventListener("change", onSoftInputChange);
    $("aircraft").addEventListener("click", ev => { const b = ev.target.closest && ev.target.closest("[data-acrm]"); if (b) removeAircraft(+b.dataset.acrm); });
    $("acAdd").onclick = addAircraft; $("acNew").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addAircraft(); } });
    $("puAdd").onclick = addPurpose; $("puNew").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addPurpose(); } });
    $("purpose").addEventListener("change", () => { $("puMsg").textContent = ""; });   // הודעת ההוספה האחרונה ("כבר ברשימה — נבחרה") לא נשארת אחרי שבחרו מהות אחרת
    $("puList").addEventListener("click", ev => { const b = ev.target.closest && ev.target.closest("[data-purm]"); if (b) removePurpose(+b.dataset.purm); });
    $("incChecks").addEventListener("change", () => { if (S.res) { clearOutcome(); renderReport(); scheduleAutoSave(); } });
    $("runBtn").onclick = run; $("qBtn").onclick = searchPlace; $("q").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); searchPlace(); } });
    $("btnPrint").onclick = () => { if (authed() && S.res) window.print(); };
    $("btnMail").addEventListener("click", ev => { if (!S.ready || !authed()) ev.preventDefault(); });   // Enter/הפעלה תוכנתית על הקישור כשהבקשה אינה מוכנה (השער S.ready) — לא פותח את תוכנת המייל, ולא משנה כיצד ה-href נקבע
    $("btnKml").onclick = () => S.res && download(baseName() + ".kml", "application/vnd.google-earth.kml+xml", O.kml(S.res, { zones: S.data.zones }, S.cfg));
    IMGS.forEach(m => { $(m.btn).onclick = () => downloadImg(m); });
    $("btnDocx").onclick = downloadDocx;
    $("mAdd").onclick = addManual;
    $("mPick").onclick = () => { S.pick = true; $("mPick").textContent = "לחצו על המפה למעלה…"; $("map").scrollIntoView({ behavior: "smooth", block: "center" }); };
    $("reviewOk").addEventListener("change", onReviewChange);
    $("btnCopy").onclick = copyMail;
    $("btnMore").onclick = () => { const p = $("moreOptions"), open = p.hidden; p.hidden = !open; $("btnMore").setAttribute("aria-expanded", String(open)); };   // ״אפשרויות נוספות״: פותח / סוגר את ההורדות (סגור כברירת מחדל)
    $("btnDrive").onclick = () => saveToDrive(false);
    $("btnSend").onclick = sendToNotam;
    $("wipePerson").onclick = wipePerson;
    $("stRun").onclick = selfTest;
    renderManual();
    setStatus("selftest", false, "טרם הורצה");
    if (okCfg) await selfTest();
    window.__REQ = { S, C, O, M, run, selfTest, setCenter, readInputs, userKey: ukey, autoPending: () => autoTimer !== null };   // autoPending: לבדיקות — האם שמירה אוטומטית ממתינה
    window.__REQ_READY = true;
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
