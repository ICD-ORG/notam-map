/* ממשק "בקשת סגירה אווירית": קלט -> הרצת כל הבדיקות -> טופס, מפה, KML, מייל. כל כשל בבדיקה חוסם את "מוכן לשליחה". */
(function () {
  "use strict";
  const C = window.ReqCore, O = window.ReqOut, M = window.ReqMap, H = window.ReqHelp, $ = id => document.getElementById(id);
  // rev: מונה גרסת הבקשה (מתקדם בכל שינוי בה, ב-clearOutcome); buildSeq/building: בניית ההדמיות ("האחרון מנצח"); pending: הדמיות ממתינות לעדכון (נגזר מטיימר עריכה ממתין או מבנייה רצה)
  const S = { cfg: null, data: {}, res: null, statuses: {}, imgs: {}, imgSite: null, manual: [], manualKey: "", reviewAt: null, pick: false, scanKey: null, stale: false, running: false, center: null, autoSite: "", lf: {}, report: null, sending: false, rid: "", rev: 0, buildSeq: 0, building: false, pending: false };
  let rebuildTimer = null;   // טיימר העריכה הרכה (null = אין עדכון ממתין)
  const PERSON_KEY = "icd_req_person_v1", AIRCRAFT_KEY = "icd_req_aircraft_v1";
  const MAX_EXTRA_AC = 30;   // תקרת כלי הטיס הנוספים השמורים בדפדפן — נאכפת גם בהוספה וגם בטעינה (אחרת כלים מעל התקרה נשמרים ואז נעלמים בשקט)
  const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", OSM = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const esc = C.esc;
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
    S.sent = null; S.driveUrl = "";
    ["driveMsg", "sendMsg"].forEach(id => { const e = $(id); if (e) { e.textContent = ""; e.className = "small"; } });
  }
  function setStatus(k, ok, msg) { S.statuses[k] = { ok: !!ok, msg: msg || "" }; refreshGate(); }

  /* ---------- טעינת נתונים סטטיים ---------- */
  // טוען את כל הנתונים שנגזרים מהמפה ומהנוטמים (אזורים, שמורות, חוקי ב-09, מנחתים חקלאיים, נוטמים) — וגם בטעינה מחדש אחרי עדכון
  function loadData() {
    return [
      ["a17", Promise.all([getJson("../data/zones.json"), getJson("../data/inpa-zones.json"), getJson("../data/pmt-b09-rules.json")]).then(([z, i, r9]) => { z.rules09 = r9; S.data.zones = z; S.data.inpa = i; return (z.edition || "") + " · " + z.zones.length + " אזורים, " + i.sites.length + " אתרי רט״ג"; })],
      ["agri", getJson("../data/agri-airstrips.json").then(a => { S.data.agri = a; return a.airstrips.length + " מנחתים"; })],
      ["notam", loadNotams()]
    ];
  }
  const applyJobs = jobs => Promise.all(jobs.map(([k, p]) => p.then(m => setStatus(k, true, m), e => setStatus(k, false, "לא נטען: " + (e && e.message ? e.message : e)))));


  async function loadStatic() {
    try { S.cfg = await getJson("config.json"); }
    catch (e) { $("e_run").textContent = "לא נטען קובץ ההגדרות: " + e.message; return false; }
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
        setStatus("sync", res.ok, res.problems.join(" · "));
        const b = $("syncBanner");
        if (res.ok) b.style.display = "none"; else { b.style.display = "block"; b.innerHTML = "<b>הנתונים אינם מסונכרנים עם מפת החברים — אי אפשר להשלים בקשה עד שהסנכרון יושלם.</b><ul>" + res.problems.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul>"; }
        S.syncAt = new Date();
        scheduleSyncRetry(res.ok);
        return res.ok;
      } catch (e) {
        setStatus("sync", false, "לא ניתן לאמת סנכרון עם המפה: " + (e && e.message ? e.message : e));
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
    runBtn: "מריץ את כל הבדיקות לנקודה, לרדיוס, לגובה ולמועדים שהוזנו: אזורי פמ״ת א-17 ופרק ב-09, שמורות וגנים, מנחתים חקלאיים, נוטמים, וסריקת מכשולים ותשתיות ב-OpenStreetMap. בסיום הוא מכין את הטופס ואת ארבע תמונות המפה. הבקשה תסומן ״מוכנה לשליחה״ רק אחרי שכל הבדיקות הצליחו ואישרתם את הסקירה האנושית.",
    mPick: "אחרי הלחיצה, לחיצה אחת על המפה שמעל מכניסה את הנ״צ שנלחץ לשדה ״נ״צ״ של התוספת הידנית. הלחיצה הזו אינה משנה את מרכז הסגירה.",
    mAdd: "מוסיף את המכשול או התשתית שהזנתם (שם, נ״צ וגובה אופציונלי) לבקשה: הם נכנסים לשדה 8 בטופס, לתמונות המפה ול-KML. ההוספה מריצה מחדש את הניתוח ומבטלת את אישור הסקירה — יש לאשר אותה שוב.",
    btnPrint: "פותח את חלון ההדפסה של הדפדפן, ומשם אפשר להדפיס או לשמור כ-PDF. מודפס הדוח בלבד: הטופס, ארבע התמונות, וכן דף הבדיקות אם ״כולל דף בדיקות״ מסומן.",
    btnDocx: "מוריד קובץ Word לעריכה: טופס נספח ג׳, ארבע התמונות וטבלת המכשולים והתשתיות. דף הבדיקות נכלל רק אם ״כולל דף בדיקות״ מסומן.",
    incChecks: "קובע אם דף הבדיקות נכלל בקובץ ה-Word, בהדפסה ובקבצים שנשמרים בדרייב ונשלחים במייל. שינוי הסימון מוחק את ההודעות ״נשמר״ ו״נשלח״, והשמירה בדרייב תתבצע מחדש.",
    btnKml: "מוריד קובץ KML לפתיחה ב-Google Earth, עם מעגלי הסגירה, אזורי האיסור והמכשולים והתשתיות שנמצאו.",
    btnAerial: "מוריד את תמונת התצ״א בתקריב (PNG), עם כל הסימונים — כפי שהיא מצורפת לבקשה.",
    btnStreet: "מוריד את מפת הרחובות (OpenStreetMap) בתקריב (PNG), עם שמות הרחובות וכל הסימונים — כפי שהיא מצורפת לבקשה.",
    btnOverview: "מוריד את ההדמיה במבט כללי (PNG): כל האזורים, המכשולים והתשתיות שמופיעים בשדה 8, ממוספרים לפי הרשימה.",
    btnRegion: "מוריד את מפת האזור המרוחקת (PNG), בטווח של כ-10 ק״מ ומעלה, עם סמן וחץ שמצביעים על המיקום. הפריטים מסומנים בה בלי מספרים.",
    btnCopy: "מעתיק ללוח את נוסח המייל המוכן (נמענים, נושא וגוף ההודעה) כדי להדביק בתוכנת המייל. לא שולח ולא שומר דבר.",
    btnDrive: "שומר את כל קבצי הבקשה — Word, KML, ארבע התמונות וקובץ נתוני הבקשה — בתיקייה בדרייב של הארגון, בלי לשלוח. שמירה חוזרת של אותה בקשה מחליפה את הקבצים באותה תיקייה.",
    btnSend: "פותח חלון אישור; אחרי שתאשרו הוא שומר את הבקשה בדרייב ושולח אותה במייל עם הקבצים. במצב בדיקה המייל נשלח רק לבעל המערכת; במצב חי הוא נשלח למשרד נוטאם (notamoffice@iaa.gov.il, nofm@iaa.gov.il) ושליחה כזו אינה ניתנת לביטול.",
    btnMail: "פותח את תוכנת המייל עם הנמענים, הנושא וגוף ההודעה ממולאים. הקבצים אינם מצורפים אוטומטית — יש לצרף אותם ידנית.",
    acAdd: "מוסיף את שם כלי הטיס שהקלדתם לרשימה ומסמן אותו. הוא נשמר בדפדפן הזה בלבד (לא בשרת) ויופיע גם בביקורים הבאים — עד " + MAX_EXTRA_AC + " כלי טיס נוספים; מעל זה יש להסיר כלי כדי להוסיף. כלי שנוסף כך מוצג עם × שמסיר אותו מהרשימה השמורה; כלים הקבועים בהגדרות המערכת אינם ניתנים להסרה.",
    addContact: "מוסיף שורה לאיש קשר נוסף בשטח (שם וטלפון), עד 20. נדרשים לפחות שני אנשי קשר עם שם, ולפחות טלפון תקין אחד (נספח ג׳ שדה 12). אנשי הקשר נשמרים בדפדפן הזה בלבד.",
    addPart: "מוסיף שורה למשתתף נוסף בטיסה (שם פרטי, שם משפחה וטלפון), עד 20. הרשימה אופציונלית, ואין חובה לטוס יחד. משתתפים מלאים נכנסים לשדה 11 בטופס ולמייל; שורה שמולאה חלקית חוסמת את ההרצה. המשתתפים אינם נשמרים בדפדפן.",
    wipePerson: "מוחק מהדפדפן הזה את שם וטלפון המבקש ואת אנשי הקשר השמורים, מנקה את השדות ומחזיר שתי שורות ריקות לאנשי הקשר; גם רשימת המשתתפים מתרוקנת. קבצים שכבר נשמרו בדרייב אינם משתנים.",
    stRun: "מריץ מחדש את הבדיקה העצמית: מחשב את נקודת הירקון מנתוני אמת שנשמרו מראש ומשווה לתוצאות שחושבו בנפרד. הבדיקה רצה גם אוטומטית בכל טעינת דף; אם נכשלה — הבקשה אינה מסומנת כמוכנה לשליחה."
  };
  // שם קצר וסטטי של מה שהלחצן מסביר — ל-aria-label של קורא מסך ("הסבר על: <שם>"). נקבע כאן ולא נקרא מתווית הכפתור, שעשויה להשתנות
  const HELP_NAME = {
    qBtn: "חיפוש מקום", baseSat: "רקע צילום אוויר", baseOsm: "רקע מפת רחובות", runBtn: "הרצת הבדיקות", mPick: "בחירת מיקום מהמפה", mAdd: "הוספה לבקשה", btnPrint: "הדפסה או PDF", btnDocx: "הורדת Word",
    incChecks: "כולל דף בדיקות", btnKml: "הורדת KML", btnAerial: "הורדת תצ״א תקריב", btnStreet: "הורדת מפת רחובות תקריב", btnOverview: "הורדת הדמיה במבט כללי", btnRegion: "הורדת מפת אזור", btnCopy: "העתקת טקסט מייל",
    btnDrive: "שמירה בדרייב", btnSend: "שליחה למשרד נוטאם", btnMail: "פתיחת מייל", acAdd: "הוספת כלי טיס", addContact: "הוספת איש קשר", addPart: "הוספת משתתף", wipePerson: "מחיקת פרטים מהמכשיר", stRun: "בדיקה עצמית",
    knownObs: "מכשולים שידועים למבקש", visitNotes: "הערות המבקש"
  };
  const HELP_FIELD = {
    knownObs: "מכשולים שאתם מכירים באתר, עד " + (C.KO_MAX || 20) + " פריטים, מופרדים בפסיק, בנקודה-פסיק או בשורה חדשה (יותר מזה חוסם את ההרצה). כל פריט מושווה לסריקה לפי מילים בלבד (בלי מיקום): התאמה אפשרית מוצגת בדף הבדיקות, ופריט שלא נמצא מופיע כאזהרה מעל הדוח וגם בדף הבדיקות. ההשוואה אינה מחליפה סימון ידני בסעיף 4. הטקסט נכנס לשדה 8 בטופס ולמייל כלשונו.",
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
    let a = []; try { a = JSON.parse(ls.get(AIRCRAFT_KEY) || "[]"); } catch (e) { a = []; }
    const seen = new Set((S.cfg.aircraft || []).map(acKey)), out = [];
    (Array.isArray(a) ? a : []).forEach(x => { const n = cleanAircraft(x); if (n && !seen.has(acKey(n)) && out.length < MAX_EXTRA_AC) { seen.add(acKey(n)); out.push(n); } });
    return out;
  }
  const saveExtraAircraft = () => ls.set(AIRCRAFT_KEY, JSON.stringify(S.extraAc));
  const checkedAc = () => new Set([...document.querySelectorAll('input[name="ac"]:checked')].map(i => acKey(i.value)));
  // keep: קבוצת המפתחות המסומנים כרגע (שומרת את הסימון בעת רינדור מחדש); בלי keep — ברירת מחדל: הכלי הראשון בהגדרות בלבד
  function renderAircraft(keep) {
    const on = (name, dflt) => keep ? keep.has(acKey(name)) : dflt;
    $("aircraft").innerHTML = S.cfg.aircraft.map((a, i) => '<label><input type="checkbox" name="ac" value="' + esc(a) + '"' + (on(a, i === 0) ? " checked" : "") + "> " + esc(a) + "</label>").join("") +
      S.extraAc.map((a, i) => '<span class="acx"><label><input type="checkbox" name="ac" value="' + esc(a) + '"' + (on(a, false) ? " checked" : "") + "> " + esc(a) + '</label><button type="button" class="xbtn" data-acrm="' + i + '" title="הסר מהרשימה השמורה" aria-label="' + esc("הסר את " + a + " מהרשימה השמורה") + '">×</button></span>').join("");
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

  /* ---------- בקרי הטופס ---------- */
  function buildControls() {
    $("purpose").innerHTML = '<option value="">בחרו…</option>' + S.cfg.purposes.map(p => '<option>' + esc(p) + "</option>").join("");
    S.extraAc = loadExtraAircraft(); renderAircraft(null);
    $("radius").value = S.cfg.defaults.radius_m; $("radius").min = S.cfg.defaults.min_radius_m; $("radius").max = S.cfg.defaults.max_radius_m;
    $("mailTo").textContent = S.cfg.mail.to.join(", ");
    loadPerson();
  }
  // פרטי המבקש ואנשי הקשר נשמרים בדפדפן; משתתפים והערות הסיור לא. פורמט ישן (contactNames/contactPhone) עובר מיגרציה לרשימה לפי אינדקס
  function loadPerson() {
    let p = null; try { p = JSON.parse(ls.get(PERSON_KEY) || "null"); } catch (e) { p = null; }
    if (!p || typeof p !== "object") p = {};
    let contacts = Array.isArray(p.contacts) ? p.contacts.filter(c => c && typeof c === "object").map(c => ({ name: String(c.name || ""), phone: String(c.phone || "") })) : null, migrated = false;
    if (!contacts && (p.contactNames || p.contactPhone)) {
      const names = C.splitList(p.contactNames), phones = C.splitList(p.contactPhone);
      contacts = names.map((n, i) => ({ name: n, phone: phones[i] || "" })); migrated = true;
    }
    contacts = contacts || [];
    $("reqName").value = String(p.reqName || ""); $("reqPhone").value = String(p.reqPhone || "");
    setRows("contacts", contacts); setRows("participants", []);
    $("personBox").open = !(p.reqName && contacts.filter(c => c.name.trim()).length >= 2);
    if (migrated) savePerson();   // כותב בפורמט החדש ומסיר את המפתחות הישנים
  }
  function savePerson() {
    ls.set(PERSON_KEY, JSON.stringify({ reqName: $("reqName").value, reqPhone: $("reqPhone").value, contacts: readRows("contacts") }));
  }
  function wipePerson() {
    ls.del(PERSON_KEY);
    $("reqName").value = ""; $("reqPhone").value = "";
    setRows("contacts", []); setRows("participants", []);
    onSoftInputChange();
  }
  function readInputs() {
    const c = C.parseCoordInput($("coord").value) || S.center || {};
    return {
      lat: c.lat, lon: c.lon, radius: parseFloat($("radius").value), heightM: parseFloat($("height").value),
      dateFrom: $("dateFrom").value, dateTo: $("dateTo").value || $("dateFrom").value, timeFrom: $("timeFrom").value, timeTo: $("timeTo").value,
      purpose: $("purpose").value, aircraft: [...document.querySelectorAll('input[name="ac"]:checked')].map(i => i.value),
      vlos: $("vlos").value === "yes", siteName: $("siteName").value.trim(),
      requesterName: $("reqName").value.trim(), requesterPhone: $("reqPhone").value.trim(),
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
    const idMap = { coord: "coord", radius: "radius", height: "height", dateFrom: "dateFrom", dateTo: "dateTo", timeFrom: "timeFrom", timeTo: "timeTo", purpose: "purpose", aircraft: null, siteName: "siteName", knownObstacles: "knownObs", visitNotes: "visitNotes" };
    errs.forEach(e => {
      const el = $("e_" + e.field); if (el) el.textContent = e.msg;
      const dateErr = e.field === "visitNotes" && /תאריך/.test(e.msg);   // שגיאת תאריך הסיור מדווחת תחת הערות המבקש
      const inp = !dateErr && idMap[e.field] && $(idMap[e.field]); if (inp) inp.classList.add("bad");
      if (dateErr) $("visitDate").classList.add("bad");
      if (e.field === "requester") { if (!$("reqName").value.trim()) $("reqName").classList.add("bad"); if (!C.validPhone($("reqPhone").value)) $("reqPhone").classList.add("bad"); }
    });
    markPeople(errs);
    if (errs.some(e => e.field === "requester" || e.field === "contacts" || e.field === "participants")) $("personBox").open = true;   // השגיאה לא תוסתר בתוך תיבה סגורה
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
      setCenter(e.latlng.lat, e.latlng.lng, false);
    });
    S.lf = { m, sat, osm, marker: null, green: null, orange: null };
  }
  function drawCircles() {
    if (!S.lf.m || !S.center) return;
    const R = parseFloat($("radius").value) || 0, ll = [S.center.lat, S.center.lon];
    if (!S.lf.marker) {
      S.lf.marker = L.marker(ll, { draggable: true }).addTo(S.lf.m);
      S.lf.marker.on("dragend", () => { const p = S.lf.marker.getLatLng(); setCenter(p.lat, p.lng, true); });
      S.lf.orange = L.circle(ll, { radius: 2 * R, color: "#ff9500", weight: 3, fillColor: "#ff9500", fillOpacity: 0.12 }).addTo(S.lf.m);
      S.lf.green = L.circle(ll, { radius: R, color: "#22c55e", weight: 3, fillColor: "#22c55e", fillOpacity: 0.22 }).addTo(S.lf.m);
    } else { S.lf.marker.setLatLng(ll); S.lf.orange.setLatLng(ll).setRadius(2 * R); S.lf.green.setLatLng(ll).setRadius(R); }
  }
  function setCenter(lat, lon, fromInput) {
    S.center = { lat, lon };
    if (!fromInput) $("coord").value = lat.toFixed(6) + ", " + lon.toFixed(6);
    drawCircles();
    if (S.lf.m) { const z = S.lf.m.getZoom(); if (z < 15 || !S.lf.m.getBounds().contains([lat, lon])) S.lf.m.setView([lat, lon], Math.max(z, 16)); }
    onScanInputChange();
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
  function refreshGate() {
    const box = $("gate"); if (!box) return;
    if (!S.res) { $("resultsSec").style.display = "none"; return; }
    $("resultsSec").style.display = "block";
    syncPending();
    const g = C.gate(S.statuses);
    S.ready = g.ready && !S.stale && !S.pending;     // pending = הדמיות המפה נבנות מחדש אחרי עריכה — עד שהסתיימו אסור לשמור או לשלוח (התמונות עדיין של הגרסה הקודמת)
    const w = warnings();
    let html = "";
    if (S.stale) html += '<div class="banner no">' + (S.staleWhy === "data" ? "נתוני המפה או הנוטמים התעדכנו מאז הרצת הבדיקות." : "הנתונים בטופס השתנו מאז הרצת הבדיקות.") + ' יש ללחוץ שוב על "הרץ את כל הבדיקות" לפני שליחה.</div>';
    if (S.pending && !S.stale) html += '<div class="banner warn">מעדכן את ההדמיות לפי השינוי האחרון… (אפשר לשמור ולשלוח רק אחרי שהסתיים)</div>';
    html += S.ready ? '<div class="banner ok">✔ כל הבדיקות הושלמו ללא כשל. הבקשה מוכנה לשליחה.</div>'
      : '<div class="banner no">✖ הבקשה אינה מוכנה לשליחה — בדיקות שלא הושלמו:<ul>' + g.failing.map(f => "<li>" + esc(f.label) + ": " + esc(f.msg) + "</li>").join("") + "</ul></div>";
    html += w.map(x => '<div class="banner warn">' + x + "</div>").join("");
    box.innerHTML = html;
    ["btnPrint", "btnDocx", "btnKml", "btnAerial", "btnStreet", "btnOverview", "btnRegion", "btnCopy", "btnDrive", "btnSend"].forEach(id => { $(id).disabled = !S.ready || ((id === "btnDrive" || id === "btnSend") && S.sending); });
    $("btnMail").querySelector("button").disabled = !S.ready;
    $("btnMail").style.pointerEvents = S.ready ? "" : "none";
    if (S.report) renderReport();
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
  async function run() {
    if (S.running) return;
    if (!window.ReqAuth.loggedIn()) { window.ReqAuth.show(); return; }
    $("e_run").textContent = "";
    const inp0 = readInputs();
    const errs = C.validateInput(Object.assign({}, inp0, { siteName: inp0.siteName || "-" }), S.cfg);
    { const raw = $("coord").value.trim(); if (raw && !C.parseCoordInput(raw)) errs.push({ field: "coord", msg: "הנ״צ שהוקלד אינו חוקי — תקנו אותו או בחרו נקודה במפה (אחרת הבדיקות היו רצות על הנקודה הקודמת)" }); }
    if (inp0.dateFrom && inp0.dateFrom < C.ilToday(new Date())) errs.push({ field: "dateFrom", msg: "תאריך ההתחלה כבר עבר" });
    showErrors(errs);
    if (errs.length) { setStatus("input", false, errs.map(e => e.msg).join(" · ")); $("e_run").textContent = "יש להשלים את השדות המסומנים."; return; }
    S.analysisStamp = null;   // ניתוח חדש בדרך: 'הניתוח ישן' אינו אמור לחסום את ההרצה שמתקנת אותו
    await checkSync();
    for (const k of ["a17", "sync", "agri", "notam"]) if (!(S.statuses[k] && S.statuses[k].ok)) { $("e_run").textContent = "ההרצה נעצרה — " + ({ a17: "אזורי איסור וגנים", sync: "סנכרון עם מפת החברים", agri: "מנחתים חקלאיים", notam: "נוטמים" })[k] + " אינם תקינים: " + (S.statuses[k] ? S.statuses[k].msg : "ממתין") + (k === "sync" ? "" : ". רעננו את הדף."); return; }
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
    S.reviewAt = null; $("reviewOk").checked = false; S.statuses.review = { ok: false, msg: "לא אושרה סקירה" };
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
      if (age == null || age > S.cfg.thresholds.notam_max_age_h) { setStatus("notam", false, age == null ? "לא ידוע מתי נמשכו הנוטמים" : "נתוני הנוטמים ישנים (" + Math.round(age) + " שעות; מרבי " + S.cfg.thresholds.notam_max_age_h + "). יש לרענן: GitHub → Actions → עדכון נוטמים יומי → Run workflow. אם הריצה נכשלת בגלל תעודת TLS של אתר רשות שדות התעופה — ממתינים לחידושה (אין לכבות אימות)."); }
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
  const SOFT_KEYS = ["siteName", "purpose", "aircraft", "vlos", "requesterName", "requesterPhone", "contacts", "participants", "knownObstacles", "visitDate", "visitNotes"];
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
    syncPending(); refreshGate();
  }

  /* ---------- הדוח ---------- */
  function renderAll() { if (!S.res) return; S.report = true; refreshGate(); renderLimits(); const m = O.mail(S.res, S.cfg); $("btnMail").href = m.mailto; $("mailInfo").textContent = "נושא: " + m.subject; }
  function renderLimits() { $("limits").innerHTML = O.sourceNotes(S.res, S.data.zones ? { zones: S.data.zones, inpa: S.data.inpa } : {}, S.cfg).map(x => "<li>" + esc(x) + "</li>").join(""); }
  const reportData = () => ({ zones: S.data.zones, inpa: S.data.inpa, agri: S.data.agri, notamFetchedIso: S.data.notamFetchedIso, near: S.data.near });
  const reviewText = () => S.reviewAt ? "המבקש אישר ב-" + S.reviewAt.toLocaleString("he-IL") + " שעבר על התצ״א, על רשימת המצאי ועל המפה, ושאין מכשול או תשתית נוספת שלא הופיעה בטופס (או שהוסיף אותה ידנית)." : "";
  // אפשרויות משותפות למסך ול-Word: שם ספק הרקע בכל תמונה (לכותרות), טקסט אישור הסקירה, והאם לכלול דף בדיקות
  function modelOpts(images) {
    const pn = {}; IMGS.forEach(m => { const x = S.imgs[m.k]; pn[m.k] = x ? ((M.PROVIDERS[x.provider] || {}).name || "") : ""; });
    return { images: images || {}, providerName: (M.PROVIDERS.esri || {}).name || "", providerNames: pn, includeChecks: $("incChecks").checked, review: reviewText(), draft: S.ready ? "" : "יש בדיקות שלא הושלמו" };
  }
  // מבנה הדוח על המסך זהה לזה שב-Word: הכול נבנה מאותו מודל (O.docxModel) — טופס, ארבעה עמודי תמונה, ודף בדיקות עם כותרות סעיף ממוספרות ברצף
  function renderReport() {
    const res = S.res, cfg = S.cfg; if (!res) return;
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
      (dn ? secH("יום ולילה בחלון הפעילות") + "<table class='t'><tr>" + mdl.dayNightHead.map(h => "<th>" + esc(h) + "</th>").join("") + "</tr>" + dn + "</table>" +
        "<p class='muted'>זריחה ושקיעה לפי חישוב אסטרונומי לנקודה, לא לוח רשמי. ההתייחסות לגובה ולתנאים זהה ביום ובלילה.</p>" : "") +
      secH("הגשה") + "<p>" + mdl.submission + "</p>" +
      (mdl.notes.length ? secH("מגבלות והסתייגויות") + "<ol>" + mdl.notes.map(x => "<li>" + esc(x) + "</li>").join("") + "</ol>" : "") +
      (rv ? secH("אישור סקירה אנושית") + "<p>" + esc(rv) + "</p>" : "") +
      "<div class='foot'><span>" + esc(mdl.footer) + "</span></div></div>";
    $("report").className = $("incChecks").checked ? "" : "nochecks";
    $("report").innerHTML = p1 + pImgs + p3;
    const style = document.getElementById("nochecksStyle") || Object.assign(document.createElement("style"), { id: "nochecksStyle" });
    style.textContent = ".nochecks .paper.checks{display:none !important}"; document.head.appendChild(style);
    S.reportHtml = true;
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
    S.reviewAt = null; $("reviewOk").checked = false; S.statuses.review = { ok: false, msg: "הרשימה השתנתה — יש לאשר מחדש" }; clearOutcome();
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
    setStatus("review", $("reviewOk").checked, $("reviewOk").checked ? "" : "לא אושרה סקירה");
  }

  /* ---------- הורדות והעתקה ---------- */
  function download(name, mime, data) {
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
    const bytes = await docxBytes();
    download(baseName() + " — בקשה לסגירה אווירית.docx", DOCX_MIME, new Blob([bytes], { type: DOCX_MIME }));
  }
  // הורדת אחת מארבע התמונות (PNG) בשם לפי החוזה: "<מקום — תאריך> — <תווית>.png"
  async function downloadImg(m) {
    const x = S.imgs[m.k]; if (!x || !x.dataUrl) return;
    download(baseName() + " — " + m.file + ".png", "image/png", await (await fetch(x.dataUrl)).blob());
  }

  /* ---------- שמירה אוטומטית בדרייב (דרך שרת ההתחברות) ---------- */
  const bytesToB64 = bytes => { let s = ""; const CH = 0x8000; for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return btoa(s); };
  const utf8B64 = t => bytesToB64(new TextEncoder().encode(t));
  const MAX_B64 = 8.5 * 1024 * 1024;   // תקרת השרת לקובץ אחד היא 9MB אחרי קידוד
  // הנתונים שהוזנו (בלי שמות וטלפונים) — מאפשרים להריץ את הבדיקות שוב על אותה בקשה
  function inputsForRecord() {
    const o = {}; Object.keys(S.res.inp).forEach(k => { if (!/^(req|contact|requester|participant)/i.test(k)) o[k] = S.res.inp[k]; });
    return { savedAt: new Date().toISOString(), site: baseName(), version: (S.data.zones && S.data.zones.mapVersion) || "", edition: (S.data.zones && S.data.zones.edition) || "", inputs: o,
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
    const changedMsg = "הבקשה שונתה בזמן השמירה — הקבצים בדרייב אינם מעודכנים; יש לשמור שוב.";
    const changed = S.rev !== rev0;
    const end = await A.call("saveEnd", { folderId: begin.folderId, ready: !!S.ready && !changed });
    if (!end.ok) throw new Error(A.msg(end));
    if (changed || S.rev !== rev0) throw new Error(changedMsg);   // השני: שינוי שהגיע בזמן שקריאת saveEnd עצמה הייתה בדרך
    if (!end.ready) throw new Error("השרת לא סימן את הבקשה כמוכנה לשליחה (חסר קובץ Word או תמונת מפה/תצ״א, או שהבדיקות לא הושלמו) — יש לשמור שוב");
    S.driveUrl = begin.url;
    return { folderId: begin.folderId, url: begin.url, name: begin.name, count: files.length };
  }
  async function saveToDrive() {
    const out = $("driveMsg"), btn = $("btnDrive"), A = window.ReqAuth;
    if (!S.ready || S.sending) return;
    if (!A.loggedIn()) { A.show(); return; }
    S.sending = true; A.setBusy(true); refreshGate();
    try {
      if (!(await checkSync())) { out.className = "small err"; out.textContent = "לא נשמר: הנתונים אינם מסונכרנים עם מפת החברים (ראו ההודעה בראש הדף)."; return; }
      if (!S.ready) { out.className = "small err"; out.textContent = "לא נשמר: הנתונים השתנו מאז הרצת הבדיקות — יש להריץ אותן שוב."; return; }
      out.className = "small"; out.textContent = "שומר בדרייב…";
      const r = await persistToDrive((n, t, name) => { out.textContent = "שומר בדרייב… (" + n + "/" + t + ") " + name; });
      out.className = "small ok";
      out.innerHTML = "✔ נשמרו " + r.count + " קבצים בדרייב, בתיקייה <b>" + esc(r.name) + '</b> — <a href="' + esc(r.url) + '" target="_blank" rel="noopener">פתח את התיקייה</a>';
    } catch (e) {
      out.className = "small err"; out.textContent = "השמירה בדרייב נכשלה: " + (e && e.message ? e.message : e);
    } finally { S.sending = false; A.setBusy(false); btn.disabled = !S.ready; refreshGate(); }
  }

  /* ---------- שליחה למשרד נוטאם (פמ"ת א-11 סעיף 6(א)) ---------- */
  const fmtTime = t => new Date(t).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
  async function sendToNotam() {
    if (!S.ready || S.sending) return;
    const A = window.ReqAuth;
    if (!A.loggedIn()) { A.show(); return; }
    const out = $("sendMsg");
    // מצב השליחה (בדיקה/חי) נקבע בשרת. מרעננים אותו כאן, ושולחים לשרת את המצב שהוצג למשתמש — אם הוא השתנה, השרת לא שולח
    const me = await A.refresh();
    if (!me.ok) { out.className = "small err"; out.textContent = "לא נשלח: לא ניתן לאמת את מצב השליחה מול השרת — " + A.msg(me); return; }
    if (!(await checkSync())) { out.className = "small err"; out.textContent = "לא נשלח: הנתונים אינם מסונכרנים עם מפת החברים (ראו ההודעה בראש הדף)."; refreshGate(); return; }
    if (!S.ready) { out.className = "small err"; out.textContent = "לא נשלח: הנתונים השתנו מאז הרצת הבדיקות — יש להריץ אותן שוב."; return; }
    const mail = O.mail(S.res, S.cfg), shown = A.getMailMode() === "live" ? "live" : "test", live = shown === "live";
    const serverTo = (A.getMailTo() || []).slice().sort().join(","), cfgTo = mail.to.slice().sort().join(",");
    // כתובות היעד קבועות בשרת; מוודאים שהן זהות לכתובות שמצוינות בנוהל (config.json) — אחרת לא שולחים
    if (serverTo !== cfgTo) { out.className = "small err"; out.textContent = "לא נשלח: כתובות היעד בשרת (" + serverTo + ") שונות מהכתובות בנוהל א-11 סעיף 6(א) שבהגדרות (" + cfgTo + "). יש לעדכן את השרת."; return; }
    const names = ["טופס הבקשה (Word)" + ($("incChecks").checked ? " כולל דף בדיקות" : " בלי דף בדיקות"), "קובץ KML"].concat(IMGS.map(m => m.send));
    const warn = warnings().filter(w => /ימי עבודה|נוטמים נמשכו|מכשול שהוזן ולא נמצא/.test(w));   // אזהרות שחשוב לראות ממש לפני השליחה
    const m = A.modal('<div class="sendBox"><h2>שליחה למשרד נוטאם</h2>' +
      (live ? '<div class="banner ok" style="margin:0 0 8px"><b>מצב חי:</b> המייל יישלח באמת אל <span dir="ltr">' + esc(mail.to.join(", ")) + '</span>. עותק יישלח לחשבון הבעלים של המערכת, ותשובות המשרד יגיעו אליו (ולא אליך).</div>'
            : '<div class="banner warn" style="margin:0 0 8px"><b>מצב בדיקה:</b> המייל יישלח רק לחשבון הבעלים של המערכת (לא אליך) ולא יישלח למשרד נוטאם. (מנהל יכול להעביר למצב חי בניהול משתמשים.)</div>') +
      '<p><b>אל:</b> <span dir="ltr">' + esc((live ? mail.to : ["בעל המערכת (בדיקה)"]).join(", ")) + '</span></p><p><b>נושא:</b> ' + esc((live ? "" : "[בדיקה — לא נשלח למשרד נוטאם] ") + mail.subject) + '</p>' +
      '<p><b>קבצים שיצורפו:</b> ' + esc(names.join(" · ")) + '</p><details><summary>נוסח המייל</summary><pre>' + esc(mail.body) + '</pre></details>' +
      warn.map(w => '<div class="banner warn" style="margin:8px 0 0">' + w + '</div>').join("") +
      '<label class="checks" style="margin-top:10px"><span style="display:flex;gap:8px;align-items:flex-start;font-size:14px"><input type="checkbox" id="sendOk" style="margin-top:4px"> עברתי על הבקשה (הטופס, התצ״א והמצאי) והיא מוכנה לשליחה' + (live ? " — השליחה אינה ניתנת לביטול" : "") + '</span></label>' +
      '<div class="row" style="margin-top:10px"><button type="button" class="primary" id="sendGo" disabled>' + (live ? "שלח למשרד נוטאם" : "שלח בדיקה לבעל המערכת") + '</button></div><div class="small" id="sendProg" role="status" style="margin-top:8px"></div></div>');
    if (!m) return;
    const ok = document.getElementById("sendOk"), go = document.getElementById("sendGo"), prog = document.getElementById("sendProg"), closeBtn = document.getElementById("mdClose");
    ok.onchange = () => { go.disabled = !ok.checked; };
    const doSend = async again => {
      const r = await A.call("sendRequest", { folderId: S.sendFolder.folderId, subject: mail.subject, body: mail.body, again: !!again, expectMode: shown });
      if (!r.ok && r.error === "mode_changed") { A.setMailModeValue(r.mailMode); const e = new Error("מצב השליחה השתנה בשרת"); e.code = "mode_changed"; throw e; }
      if (!r.ok && r.error === "already_sent") {
        prog.innerHTML = (r.similar ? 'בקשה על אותו מקום ותאריך כבר נשלחה למשרד נוטאם ב-' : 'הבקשה כבר נשלחה למשרד נוטאם ב-') + '<b>' + esc(fmtTime(r.sentAt)) + '</b>. <button type="button" id="sendAgain">שלח שוב בכל זאת</button>';
        document.getElementById("sendAgain").onclick = () => guarded(async () => { await preflight(); prog.textContent = "שולח…"; await doSend(true); });
        go.disabled = true; return;
      }
      if (!r.ok) throw new Error(A.msg(r));
      S.sent = { at: r.sentAt, mode: r.mode, to: r.to };
      const msgHtml = r.mode === "live" ? "✔ נשלחה למשרד נוטאם (<span dir='ltr'>" + esc(r.to.join(", ")) + "</span>) ב-" + esc(fmtTime(r.sentAt)) + (r.cc ? ". עותק נשלח לחשבון הבעלים." : ".")
        : "✔ נשלח במצב בדיקה לבעל המערכת בלבד — לא נשלח למשרד נוטאם.";
      prog.className = "small ok"; prog.innerHTML = msgHtml; out.className = "small ok"; out.innerHTML = msgHtml + ' <a href="' + esc(S.sendFolder.url) + '" target="_blank" rel="noopener">פתח את התיקייה בדרייב</a>';
      go.disabled = true; ok.disabled = true;
    };
    const fail = e => { prog.className = "small err"; prog.textContent = "השליחה נכשלה: " + (e && e.message ? e.message : e); go.disabled = !ok.checked; ok.disabled = false; };
    // זרימה אחת בכל רגע: בזמן שמירה/שליחה אי אפשר לסגור את החלון, לפתוח חלון אחר או להתחיל זרימה שנייה
    const guarded = async fn => {
      if (S.sending) return;
      S.sending = true; A.setBusy(true); refreshGate(); closeBtn.disabled = true; go.disabled = true; ok.disabled = true; prog.className = "small";
      let reopen = false;
      try { await fn(); }
      catch (e) { if (e && e.code === "mode_changed") reopen = true; else fail(e); }
      finally { S.sending = false; A.setBusy(false); refreshGate(); closeBtn.disabled = false; }
      if (reopen) { A.closeModal(); out.className = "small err"; out.textContent = "מצב השליחה בשרת השתנה בזמן שהחלון היה פתוח — לא נשלח דבר. נפתח חלון חדש עם המצב העדכני; יש לאשר מחדש."; sendToNotam(); }
    };
    // בדיקות ממש לפני כל שליחה (גם "שלח שוב בכל זאת"): מצב השליחה בשרת, שהבקשה עדיין מוכנה ומאושרת, והסנכרון עם המפה
    const preflight = async () => {
      prog.textContent = "בודק מצב שליחה…";
      const me2 = await A.refresh();
      if (!me2.ok) throw new Error(A.msg(me2));
      if ((A.getMailMode() === "live" ? "live" : "test") !== shown) { const e = new Error("מצב השליחה השתנה"); e.code = "mode_changed"; throw e; }
      if (!S.ready || !$("reviewOk").checked) throw new Error("הבקשה אינה מוכנה לשליחה (בדיקות שלא הושלמו, נתונים ששונו או סקירה שלא אושרה) — לא נשלח");
      prog.textContent = "בודק סנכרון עם המפה…";
      if (!(await checkSync())) throw new Error("הנתונים אינם מסונכרנים עם מפת החברים — לא נשלח");
      if (!S.ready) throw new Error("הנתונים השתנו מאז הרצת הבדיקות — לא נשלח");
    };
    go.onclick = () => guarded(async () => {
      await preflight();
      // בקשה שלא השתנתה מאז השליחה הקודמת כבר שמורה בדרייב (clearOutcome מאפס כל שינוי) — לא שומרים שוב, כדי שהשרת יזהה שליחה כפולה
      if (!(S.sent && S.sendFolder)) S.sendFolder = await persistToDrive((n, t, name) => { prog.textContent = "שומר בדרייב… (" + n + "/" + t + ") " + name; });
      if (!S.ready) throw new Error("הנתונים השתנו בזמן השמירה — לא נשלח. הרצו את הבדיקות שוב");
      prog.textContent = "שולח…";
      await doSend(false);
    });
    return m;
  }
  async function copyMail() {
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
      const cfg = S.cfg, inp = Object.assign({}, exp.input, { purpose: cfg.purposes[0], aircraft: [cfg.aircraft[0]], vlos: true, siteName: "בדיקה", requesterName: "בודק", requesterPhone: "050-0000000", contacts: [{ name: "א", phone: "050-0000001" }, { name: "ב", phone: "050-0000002" }] });
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
    if (ok) { b.style.display = "none"; } else { b.style.display = "block"; b.textContent = "הבדיקה העצמית של המערכת נכשלה — לא ניתן לסמן בקשה כמוכנה לשליחה. פתחו את 'בדיקה עצמית' למטה לפרטים."; $("stBox").open = true; }
    return ok;
  }

  /* ---------- אתחול ---------- */
  async function init() {
    if (H) { H.wire(); attachHelp(); }   // לחצני ״!״ ליד כפתורי הדף (ההסברים ב-HELP)
    initMap();
    const okCfg = await loadStatic();
    document.addEventListener("req-auth", ev => {   // משתמש אחר באותו דף לא יורש תיקייה, מזהה בקשה או הודעות של קודמו
      const u = ev.detail && ev.detail.user;
      if (S.lastUser && S.lastUser !== u) { S.rid = ""; S.ridKey = ""; S.sendFolder = null; S.driveUrl = ""; clearOutcome(); }
      S.lastUser = u;
    });
    window.ReqAuth.init(S.cfg);
    ["radius", "height", "dateFrom", "dateTo", "timeFrom", "timeTo"].forEach(id => $(id).addEventListener("input", () => { if (id === "radius") drawCircles(); onScanInputChange(); }));
    $("coord").addEventListener("change", () => { const c = C.parseCoordInput($("coord").value); if (c) setCenter(c.lat, c.lon, true); });
    ["siteName", "purpose", "vlos", "reqName", "reqPhone", "knownObs", "visitDate", "visitNotes"].forEach(id => (id === "visitDate" ? ["input", "change"] : ["input"]).forEach(ev => $(id).addEventListener(ev, () => { if (id.startsWith("req")) savePerson(); onSoftInputChange(); })));
    // אנשי קשר ומשתתפים: מאזין אחד (delegation) לכל השורות; הוספה והסרה של שורות ב-click
    $("personBox").addEventListener("input", ev => { if (ev.target.closest && ev.target.closest(".plist")) { savePerson(); onSoftInputChange(); } });
    $("personBox").addEventListener("click", ev => { const b = ev.target.closest && ev.target.closest("[data-rm]"); if (b) removeRow(b); });
    $("addContact").onclick = () => addRow("contacts"); $("addPart").onclick = () => addRow("participants");
    $("aircraft").addEventListener("change", onSoftInputChange);
    $("aircraft").addEventListener("click", ev => { const b = ev.target.closest && ev.target.closest("[data-acrm]"); if (b) removeAircraft(+b.dataset.acrm); });
    $("acAdd").onclick = addAircraft; $("acNew").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addAircraft(); } });
    $("incChecks").addEventListener("change", () => { if (S.res) { clearOutcome(); renderReport(); } });
    $("runBtn").onclick = run; $("qBtn").onclick = searchPlace; $("q").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); searchPlace(); } });
    $("btnPrint").onclick = () => window.print();
    $("btnKml").onclick = () => download(baseName() + ".kml", "application/vnd.google-earth.kml+xml", O.kml(S.res, { zones: S.data.zones }, S.cfg));
    IMGS.forEach(m => { $(m.btn).onclick = () => downloadImg(m); });
    $("btnDocx").onclick = downloadDocx;
    $("mAdd").onclick = addManual;
    $("mPick").onclick = () => { S.pick = true; $("mPick").textContent = "לחצו על המפה למעלה…"; $("map").scrollIntoView({ behavior: "smooth", block: "center" }); };
    $("reviewOk").addEventListener("change", onReviewChange);
    $("btnCopy").onclick = copyMail;
    $("btnDrive").onclick = saveToDrive;
    $("btnSend").onclick = sendToNotam;
    $("wipePerson").onclick = wipePerson;
    $("stRun").onclick = selfTest;
    renderManual();
    setStatus("selftest", false, "טרם הורצה");
    if (okCfg) await selfTest();
    window.__REQ = { S, C, O, M, run, selfTest, setCenter, readInputs };
    window.__REQ_READY = true;
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
