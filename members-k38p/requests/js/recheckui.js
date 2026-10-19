/* ReqRecheckUI — ממשק "בדיקה חוזרת" (שלב ב׳, U3): בקשה שנשלחה (חי או בדיקה) נבדקת מחדש מול הנתונים העדכניים, ומוצג "מה השתנה מאז ההגשה". UMD כמו core.js: הליבה (זמינות, הכנת הקלט מהרשומה השמורה, השוואה, טקסטים, HTML מוגן, קובץ ה-Word) טהורה
   ורצה גם ב-Node; ממשק החלון — בדפדפן בלבד. הלוגיקה של ההשוואה עצמה (תמונת מצב, diff, מודל הסעיף) היא של ReqRecheck (js/recheck.js); בניית ה-Word — O.recheckDocxModel + ReqDocx.buildRecheck; שמירה בדרייב — שרת: saveRecheck.
   כללי ברזל: (1) זמינות = ReqAuth.isAdv() (הדגל הקיים של התצוגה המתקדמת, בלי דגל משתמש חדש) וגם השרת מדווח "recheck" וגם config.features.recheck !== false (מפתח חסר = פעיל); אחרת — אין כפתור, אין חלון, אין קריאת רשת, והרשימה ב״הבקשות שלי״ זהה לשלב א׳;
   (2) קלט הסריקה (נקודה, רדיוס, גובה, מועדים, מוסיפים ידניים) נלקח מהרשומה השמורה בלבד, אחרי ReqRecheck.validateRecord, ואינו ניתן לשינוי; מפורטי המבקש לא נדרש דבר; (3) הניתוח תמיד טרי (ui.js: recheckAnalyze מושך נתונים מחדש) ואינו נוגע בבקשה שבטופס;
   (4) לא נכתב דבר בתיקיית הבקשה המקורית אלא דרך saveRecheck (תת-תיקייה נפרדת), ולא נשמר ולא נשלח דבר אוטומטית: כל פעולה בלחיצה; (5) כל מחרוזת מהשרת או מהרשומה נכנסת ל-HTML רק דרך E, או ל-DOM דרך textContent; (6) נכשל סגור: רשומה פגומה / תשובה לא תקינה ← הודעה בעברית, לא תוצאה חלקית.

   ===== API =====
   STR / HELP                              טקסטי עברית והסברי ה-״!״
   enabled(cfg) / available(cfg, features, adv)   enabled = ReqRecheck.enabled(cfg); available = enabled && adv === true && features (מערך מ-ReqAuth.getFeatures) כולל "recheck"
   eligible(state)                         true רק ל-sent_live / sent_test (בקשה שנשלחה)
   prepare(rec, {cfg, name})               => {ok, inp, rec, raw} | {ok:false, reason, text}: אימות הרשומה השמורה ובניית קלט הניתוח (inp) ממנה — בלי פרטי מבקש
   updateState(cmp, inp, todayYmd)         => {started, canUpdate, blockedByDate}: ״הכן בקשה מעודכנת״ רק כשיש שינויים והפעילות עוד לא החלה
   compare({raw, res, data, cfg, now, sentAt, inp})  => {ok, diff, since, cur, curError, comparable, anyChange, canUpdate, sum:{a,r,c}, kind} | {ok:false, error}  (since: מודל הסעיף; "אין בסיס להשוואה" נוסף כשאין תמונת מצב)
   findingsModel(snap) / findingsHtml(m)   הממצאים הנוכחיים (מתמונת המצב הנוכחית) — כשאין עם מה להשוות
   lockedModel(inp, name) / lockedHtml(m)  קלט הסריקה הנעול, לתצוגה
   resultHtml(view)                        הסעיף "שינויים מאז ההגשה" + ממצאים + קלט נעול (HTML מוגן)
   wordBytes(deps, view)                   => Promise<Uint8Array>: דוח ה-Word (O.recheckDocxModel + D.buildRecheck); זורק כשהדגל כבוי
   scanOf(inp) / sameScan(a, b)            מפתח הסריקה של בקשה, והשוואתו (בקשה מעודכנת "מחליפה" רק כשהסריקה זהה)
   updateLine(sentAt) / updateBanner(sentAt, live) / updateNote(name, sentAt)   טקסטי "בקשה מעודכנת"
   errText(res, A)                         הודעת שגיאה מתשובת שרת
   transient(res)                        true כשניסיון חוזר יכול לעזור (רשת, קצב, שרת עסוק); false כשהרשומה חסרה / פגומה / גדולה מדי / אין הרשאה
   hook({analyze, loadUpdate, busy, inProgress})   ui.js מחבר את הניתוח הטרי וטעינת הטופס;  start(row) — פותח את החלון;  reset() — מנקה מצב (התנתקות / משתמש אחר);  clearNote() — מסיר את ההודעה ״נטענה בקשה מעודכנת״ מהדף */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./core.js"), require("./recheck.js"));
  else root.ReqRecheckUI = factory(root.ReqCore, root.ReqRecheck);
})(typeof self !== "undefined" ? self : this, function (C, R) {
  "use strict";

  const STATES = ["sent_live", "sent_test"];
  const LIST = { n: 25 };   // שורות לכל קבוצה ב״הממצאים הנוכחיים״; העודף — ״ועוד N״
  const STR = {
    btn: "🔁 בדיקה חוזרת", btnLabel: "בדיקה חוזרת", title: "בדיקה חוזרת", creator: "מערכת בקשות הטיסה",
    intro: "בדיקה מחודשת של בקשה שנשלחה, מול הנתונים העדכניים. הבקשה שנשלחה לא משתנה, ושום דבר לא נשמר או נשלח בלי שתבחרו.",
    loading: "טוען את הבקשה…", syncing: "מעדכן את הנתונים ובודק סנכרון…", comparing: "משווה למה שהוגש…", done: "הבדיקה הסתיימה.",
    noBase: "אין בסיס להשוואה — הבקשה נשלחה לפני שהמערכת שמרה תמונת מצב.",
    curFail: "לא ניתן היה להכין את הממצאים הנוכחיים להשוואה.",
    currentOnly: "מוצגים הממצאים הנוכחיים בלבד.",
    past: "שימו לב: מועד הפעילות שנבדק כבר עבר.", testOnly: "הבקשה הזו נשלחה במצב בדיקה בלבד (לא נשלחה למודיעין טיס).", noUpdate: "אי אפשר להכין בקשה מעודכנת, כי מועד הפעילות כבר החל.",
    lockedTitle: "מה נבדק", lockedNote: "נלקח מהבקשה השמורה ואי אפשר לשנותו.",
    resultsLabel: "תוצאות הבדיקה החוזרת", findingsTitle: "הממצאים הנוכחיים", findingsNone: "לא נמצאו.", more: "ועוד",
    request: "הבקשה", point: "נקודת מרכז", radius: "רדיוס", height: "גובה", when: "מועד",
    save: "שמור דוח בדרייב", saving: "שומר…", saved: "הדוח נשמר ✔", download: "הורד", update: "הכן בקשה מעודכנת", back: "חזרה לרשימה", yes: "כן, החלף", no: "ביטול", retry: "נסו שוב", close: "סגור",
    saveOk: n => "הדוח נשמר בדרייב" + (n > 0 ? " (בדיקה חוזרת מס׳ " + n + " לבקשה זו)" : "") + ". הוא לא צורף לבקשה שנשלחה.",
    wordFail: "לא ניתן היה להכין את קובץ ה-Word. נסו שוב.",
    confirm: "בדף יש בקשה בעבודה. הכנת בקשה מעודכנת תחליף אותה ותמחק את תוצאות הבדיקות שלה. להמשיך?",
    noRecord: "לא נמצא קובץ הנתונים של הבקשה הזו (ייתכן שנמחק או הועבר), ולכן אי אפשר לבדוק אותה מחדש.",
    badRecord: "קובץ הנתונים של הבקשה הזו פגום או חסר פרטים, ולכן אי אפשר לבדוק אותה מחדש.",
    tooBig: "קובץ הנתונים של הבקשה הזו גדול מדי.", forbidden: "אין הרשאה לבקשה הזו.", offline: "אין חיבור לשרת. נסו שוב.", badResp: "התשובה מהשרת אינה תקינה. נסו שוב.",
    busy: "הרצה, שמירה או שליחה בעיצומה. נסו שוב בעוד רגע.", notReady: "הדף עדיין נטען. נסו שוב בעוד רגע.", failed: "הפעולה נכשלה. רעננו את הדף ונסו שוב.", running: "בדיקה חוזרת קודמת עדיין רצה. נסו שוב בעוד רגע.",
    unusable: "אי אפשר להכין בקשה מעודכנת מהבקשה הזו: הנקודה, הרדיוס, הגובה או המועדים שנשמרו חסרים או לא תקינים.",
    notAvailable: "הבדיקה החוזרת אינה זמינה בחשבון הזה.",
    updateLoaded: (name, sentAt) => "נטענה בקשה מעודכנת על בסיס ״" + clean(name, 120) + "״. המקום, הרדיוס, הגובה, התאריכים והשעות נשמרו. יש להריץ את הבדיקות מחדש ולאשר שוב את ההצהרה." +
      (fmtDate(sentAt) ? " השליחה תחליף את הבקשה שנשלחה ב-" + fmtDate(sentAt) + "." : " השליחה תחליף את הבקשה שנשלחה."),
    notes: "לא נטענו"
  };
  // הסברי ה-״!״ (מתארים מה הפעולה עושה בפועל בקוד)
  const HELP = {
    list: "בודק מחדש את הבקשה ששמורה ונשלחה: מריץ אותה שוב מול הנתונים העדכניים (אזורי איסור, נוטמים, OpenStreetMap) ומראה מה השתנה מאז ההגשה. המקום, הרדיוס, הגובה והמועדים נלקחים מהבקשה ואי אפשר לשנותם. הדוח לא מצורף ולא נשלח למודיעין טיס, והבקשה שנשלחה לא משתנה. אפשר לשמור את הדוח בדרייב, להוריד אותו כקובץ Word, ואם יש שינויים — להכין בקשה מעודכנת. הכפתור מוצג בתצוגה מתקדמת בלבד.",
    save: "שומר את דוח הבדיקה החוזרת (קובץ Word עם השינויים ודף הבדיקות העדכני) בתת-תיקייה נפרדת בתוך תיקיית הבקשה בדרייב. הדוח לא מצורף למייל של הבקשה ולא נשלח למודיעין טיס, והקבצים שנשלחו לא משתנים. אין שמירה אוטומטית — רק בלחיצה.",
    download: "מוריד את דוח הבדיקה החוזרת כקובץ Word למכשיר שלכם, בלי לשמור בדרייב ובלי לשלוח.",
    update: "טוען את נתוני הבקשה לטופס כבסיס לבקשה מעודכנת, עם אותו מקום, רדיוס, גובה, תאריכים ושעות. יש להריץ את הבדיקות מחדש ולאשר שוב את ההצהרה. כששולחים, הבקשה החדשה מחליפה את הבקשה שנשלחה, והנושא והמייל מציינים זאת. הבקשה שנשלחה לא משתנה, ושום דבר לא נשלח עד שתלחצו על ״שלח״. אם הבקשה כבר אושרה — אין צורך לשלוח שוב."
  };

  /* ================= עזרים טהורים ================= */
  const E = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const isObj = o => o !== null && typeof o === "object" && !Array.isArray(o);
  const own = (o, k) => (o !== null && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k)) ? o[k] : undefined;
  const num = v => typeof v === "number" && isFinite(v);
  const clean = (v, max) => (R ? R.clean(v, max) : String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max || undefined));
  const fmtDate = ms => (R && ms != null && ms !== "" ? R.fmtDate(ms) : "");
  const enabled = cfg => !!R && R.enabled(cfg);
  const available = (cfg, features, adv) => enabled(cfg) && adv === true && Array.isArray(features) && features.indexOf("recheck") >= 0;
  const eligible = state => STATES.indexOf(state) >= 0;
  const distText = d => (!num(d) || d < 0 ? "ללא מיקום בנוטם" : d < 1 ? "בתוך השטח" : C.fmtDist(d));

  const dateText = (a, b, tf, tt) => {
    const f = s => { const d = C.parseDate(s); return d ? C.ddmmyyyy(d) : ""; }, x = f(a), y = f(b);
    return (x && y && x !== y ? x + " עד " + y : x) + (tf && tt ? " · " + tf + "–" + tt + " (שעון מקומי)" : "");
  };
  const scanOf = inp => ({ lat: inp.lat, lon: inp.lon, radius: inp.radius, heightM: inp.heightM, dateFrom: inp.dateFrom, dateTo: inp.dateTo, timeFrom: inp.timeFrom, timeTo: inp.timeTo });
  // סריקה זהה: אותה נקודה (עד מיקרון-מעלה), רדיוס, גובה, תאריכים ושעות. כל קלט לא תקין ← false (נכשל סגור)
  function sameScan(a, b) {
    if (!isObj(a) || !isObj(b)) return false;
    if (![a.lat, a.lon, b.lat, b.lon, a.radius, b.radius, a.heightM, b.heightM].every(num)) return false;
    return Math.abs(a.lat - b.lat) <= 1e-6 && Math.abs(a.lon - b.lon) <= 1e-6 && a.radius === b.radius && a.heightM === b.heightM &&
      ["dateFrom", "dateTo", "timeFrom", "timeTo"].every(k => typeof a[k] === "string" && a[k] !== "" && a[k] === b[k]);
  }

  /* ----- הכנת הקלט מהרשומה השמורה ----- */
  // הרשומה לא נסמכת: R.validateRecord בודק כל שדה (טיפוסים, תקרות, תאריכים תקינים, נקודה בתוך ישראל). קלט הניתוח נבנה ממנה בלבד; פרטי מבקש, אנשי קשר ומשתתפים ריקים (הבדיקה החוזרת אינה בקשה — אין הצהרה ואין אימות מבקש)
  function prepare(rec, opts) {
    opts = opts || {};
    if (!R) return { ok: false, reason: "off", text: STR.notAvailable };
    const v = R.validateRecord(rec, opts.cfg);
    if (!v.ok) return { ok: false, reason: v.reason, text: v.reason === "too_big" ? STR.tooBig : STR.badRecord };
    const r = v.rec, i = r.inputs, site = i.siteName || r.site || clean(opts.name, 120) || "בקשה";
    const inp = {
      lat: i.lat, lon: i.lon, radius: i.radius, heightM: i.heightM, dateFrom: i.dateFrom, dateTo: i.dateTo, timeFrom: i.timeFrom, timeTo: i.timeTo,
      purpose: i.purpose, aircraft: i.aircraft.slice(), vlos: i.vlos, siteName: site, requesterName: "", requesterPhone: "", requesterOrg: "", callsign: "", registration: "", contacts: [], participants: [],
      knownObstacles: i.knownObstacles, visitDate: i.visitDate, visitNotes: i.visitNotes, manualItems: i.manualItems.map(m => ({ name: m.name, lat: m.lat, lon: m.lon, heightM: m.heightM }))
    };
    return { ok: true, inp, rec: r, raw: rec };
  }

  /* ----- השוואה ----- */
  // res/data: C.analyze הטרי ואותו data שהועבר אליו (ui.js recheckAnalyze); raw: הרשומה השמורה כפי שהתקבלה (תמונת המצב נבדקת ב-R.diffSnapshots עצמו: ללא/פגומה/גרסה לא נתמכת ← לא משווים)
  function compare(a) {
    if (!R || !isObj(a)) return { ok: false, error: "off" };
    const cfg = a.cfg, now = a.now || new Date(), inp = a.inp || (a.res && a.res.inp) || {};
    let cur = null, curError = "";
    try { cur = R.snapshotOf(a.res, a.data, cfg, now); } catch (e) { curError = clean(e && e.message, 120) || "שגיאה"; }
    const prevRaw = own(a.raw, "snapshot"), hadErr = typeof own(a.raw, "snapshotError") === "string" && own(a.raw, "snapshotError") !== "";
    const diff = R.diffSnapshots(prevRaw == null ? null : prevRaw, cur, R.optsFromCfg(cfg));
    const since = R.sinceModel(diff, { sentAt: a.sentAt, checkedAt: now, activity: { dateFrom: inp.dateFrom, dateTo: inp.dateTo, timeFrom: inp.timeFrom, timeTo: inp.timeTo }, maxRows: R.optsFromCfg(cfg).rowsScreen, cfg });
    if (!since) return { ok: false, error: "off" };
    // רשומה שנשמרה לפני שהמערכת שמרה תמונות מצב: מציינים זאת במפורש (ב-Word ובמסך). שגיאת צילום (snapshotError) או תמונה פגומה/ישנה — הניסוח של ReqRecheck כבר מדויק
    if (since.kind === "nobase" && since.reason === "no_baseline" && !hadErr) since.summary = STR.noBase + " " + STR.currentOnly;
    const comparable = diff.comparable === true, sum = comparable ? { a: diff.counts.added, r: diff.counts.removed, c: diff.counts.changed } : { a: 0, r: 0, c: 0 };
    return { ok: true, diff, since, cur, curError, kind: since.kind, comparable, anyChange: comparable && diff.anyChange === true, canUpdate: comparable && diff.anyChange === true, sum };
  }

  // ״הכן בקשה מעודכנת״: רק כשיש שינויים וגם אפשר להריץ את הבקשה — ההרצה חוסמת תאריך התחלה שכבר עבר (ui.js run), ולכן לפעילות שכבר החלה לא מציעים אותה (ומסבירים). todayYmd = C.ilToday
  function updateState(cmp, inp, todayYmd) {
    const ok = isObj(inp) && typeof inp.dateFrom === "string" && typeof todayYmd === "string", started = ok && inp.dateFrom < todayYmd, can = ok && isObj(cmp) && cmp.canUpdate === true;   // קלט לא תקין ← לא מציעים (נכשל סגור)
    return { started, canUpdate: can && !started, blockedByDate: can && started };
  }

  /* ----- הממצאים הנוכחיים (כשאין עם מה להשוות) ----- */
  // נגזר מתמונת המצב הנוכחית אחרי R.cleanSnapshot (טקסטים מנוקים ומוגבלים), לא מהנתונים הגולמיים
  function findingsModel(snap) {
    const s = R ? R.cleanSnapshot(snap) : { ok: false };
    if (!s.ok) return null;
    const S = s.snapshot, ZONE = { i: "בתוך הסגירה", r: "בטבעת (עד פי 2 מהרדיוס)", n: "בקרבת הסגירה" };
    const cap = a => ({ rows: a.slice(0, LIST.n), more: Math.max(0, a.length - LIST.n) });
    return {
      notams: cap(S.notams.hits.map(n => ({ id: n.id, text: n.x, dist: distText(n.d), note: n.r === "o" ? "חופף לסגירה" : n.r === "n" ? "בקרבת הסגירה" : "" }))),
      zones: cap(S.zones.map(z => ({ id: z.id, text: z.n + (z.a ? " · " + z.a : ""), dist: distText(z.d), note: z.in ? "בתוך הסגירה" : "בקרבת הסגירה" }))),
      items: cap(S.items.map(i => ({ id: "", text: i.t, dist: distText(i.d), note: ZONE[i.z] || "" }))),
      other: cap([].concat(
        S.oth.borders.map(b => ({ id: "", text: "גבול " + b.iso, dist: distText(b.d), note: b.v ? R.STR.field.violates : "" })),
        S.oth.air.map(x => ({ id: "", text: x.n || x.id, dist: distText(x.d), note: "" })),
        S.oth.agri.map(x => ({ id: "", text: "מנחת חקלאי " + x.n, dist: distText(x.d), note: "" })))),
      counts: { notams: S.notams.hits.length, zones: S.zones.length, items: S.items.length }
    };
  }
  function findingsHtml(m) {
    if (!m || typeof m !== "object") return "";
    const grp = (title, g) => {
      g = isObj(g) ? g : { rows: [], more: 0 };
      const rows = Array.isArray(g.rows) ? g.rows : [];
      return '<h5 class="rcH5">' + E(title) + " (" + E(rows.length + (num(g.more) ? g.more : 0)) + ")</h5>" + (rows.length
        ? '<ul class="rcList">' + rows.map(r => { r = r || {}; return "<li>" + (r.id ? "<b dir=\"auto\">" + E(r.id) + "</b> " : "") + '<span dir="auto">' + E(r.text) + "</span> — " + E(r.dist) + (r.note ? " · " + E(r.note) : "") + "</li>"; }).join("") + (num(g.more) && g.more > 0 ? "<li>" + E(STR.more + " " + g.more) + "</li>" : "") + "</ul>"
        : '<p class="small">' + E(STR.findingsNone) + "</p>");
    };
    const c = R.STR.cat;
    return '<section class="rcCur" aria-labelledby="rcCurT"><h4 id="rcCurT" class="rcH4">' + E(STR.findingsTitle) + "</h4>" + grp(c.notams, m.notams) + grp(c.zones, m.zones) + grp(c.items, m.items) + grp(c.other, m.other) + "</section>";
  }

  /* ----- קלט הסריקה הנעול ----- */
  function lockedModel(inp, name) {
    const rows = [];
    if (name) rows.push([STR.request, clean(name, 120)]);
    rows.push([STR.point, C.dmsLat(inp.lat) + " " + C.dmsLon(inp.lon) + " (" + inp.lat.toFixed(6) + ", " + inp.lon.toFixed(6) + ")"]);
    rows.push([STR.radius, C.fmtInt(Math.round(inp.radius)) + " מ׳"]);
    rows.push([STR.height, C.trimNum(inp.heightM, 2) + " מ׳ (" + (inp.heightM * C.M2FT).toFixed(1) + " רגל) מעפ״ש"]);
    rows.push([STR.when, dateText(inp.dateFrom, inp.dateTo, inp.timeFrom, inp.timeTo)]);
    return rows;
  }
  function lockedHtml(rows) {
    if (!Array.isArray(rows) || !rows.length) return "";
    return '<section class="rcLock" aria-labelledby="rcLockT"><h4 id="rcLockT" class="rcH4">' + E(STR.lockedTitle) + '</h4><p class="small">' + E(STR.lockedNote) + "</p><dl>" +
      rows.map(r => { r = Array.isArray(r) ? r : []; return "<dt>" + E(r[0]) + '</dt><dd dir="auto">' + E(r[1]) + "</dd>"; }).join("") + "</dl></section>";
  }

  // view: {since, findings (model|null), locked (rows), past (bool), curError}
  function resultHtml(view) {
    view = view || {};
    if (!view.since) return "";
    const kind = view.since.kind;
    return '<div class="rcRes" id="rcRes" tabindex="-1" role="region" aria-label="' + E(STR.resultsLabel) + '"><div class="rcSince">' + R.sinceHtml(view.since) + "</div>" +
      (view.testOnly ? '<p class="rcPast" role="note">' + E(STR.testOnly) + "</p>" : "") +
      (view.past ? '<p class="rcPast" role="note">' + E(STR.past) + "</p>" : "") +
      (view.curError ? '<p class="err" role="alert">' + E(STR.curFail) + "</p>" : "") +
      ((kind === "nobase" || kind === "blocked") && view.findings ? findingsHtml(view.findings) : "") +
      lockedHtml(view.locked) + "</div>";
  }

  /* ----- קובץ Word ----- */
  // deps: {O (ReqOut), D (ReqDocx)}; view: {res, data, since, cfg, now}. הדוח אינו חלק מהבקשה: בלי טופס ובלי תמונות — באנר "לא צורף", השינויים ודף הבדיקות העדכני
  async function wordBytes(deps, view) {
    const O = deps && deps.O, D = deps && deps.D;
    if (!O || !D || typeof O.recheckDocxModel !== "function" || typeof D.buildRecheck !== "function") throw new Error("wordBytes: חסרים מודולים");
    const model = O.recheckDocxModel(view.res, view.data, view.cfg, view.since, { now: view.now, includeChecks: true, creator: STR.creator });
    if (!model) throw new Error("wordBytes: דגל הבדיקה החוזרת כבוי");
    return D.buildRecheck(model);
  }

  /* ----- בקשה מעודכנת: טקסטים ----- */
  const updateLine = sentAt => (R ? R.updateBodyLine(sentAt) : "");
  // בחלון השליחה: בקשה מעודכנת מחליפה את הקודמת. במצב בדיקה לא נשלח דבר למודיעין טיס
  const updateBanner = (sentAt, live) => updateLine(sentAt) + (live ? " השליחה למודיעין טיס מחליפה אצלם את הבקשה הקודמת, ואין צורך לבטל אותה." : " במצב בדיקה המייל נשלח רק אליכם, ולא למודיעין טיס.");
  const updateNote = (name, sentAt) => STR.updateLoaded(name, sentAt);

  // כשל שניסיון חוזר לא יתקן (אין קובץ / הוא פגום / גדול מדי / אין הרשאה) — בלי ״נסו שוב״; כל השאר (רשת, קצב, שרת עסוק) זמני
  const transient = res => !(isObj(res) && ["no_record", "bad_folder", "bad_record", "too_big", "forbidden"].indexOf(res.error) >= 0);
  function errText(res, A) {
    const c = isObj(res) && typeof res.error === "string" ? res.error : "";
    if (isObj(res) && res.ok === true) return STR.badResp;
    if (c === "no_record" || c === "bad_folder") return STR.noRecord;
    if (c === "bad_record") return STR.badRecord;
    if (c === "too_big") return STR.tooBig;
    if (c === "forbidden") return STR.forbidden;
    if (c === "network") return STR.offline;
    if (A && typeof A.msg === "function" && isObj(res)) return String(A.msg(res));
    return STR.badResp;
  }

  const api = { STATES, STR, HELP, enabled, available, eligible, prepare, compare, updateState, findingsModel, findingsHtml, lockedModel, lockedHtml, resultHtml, wordBytes, scanOf, sameScan, dateText, updateLine, updateBanner, updateNote, errText, transient, E };
  if (typeof document === "undefined" || typeof window === "undefined") return api;

  /* ================= ממשק החלון (דפדפן) ================= */
  const $ = id => document.getElementById(id);
  const ST = { hooks: null, seq: 0, who: "", modal: null, row: null, view: null, busy: false, inflight: false, saved: false, pending: false };
  const hbtn = (t, name) => (window.ReqHelp ? window.ReqHelp.btn(t, name) : "");
  const A_ = () => window.ReqAuth;
  const CSS = ".rc h2{margin:0 0 4px}.rc .rcName{font-size:14.5px;overflow-wrap:anywhere;margin:2px 0}.rc .rcRes:focus{outline:none}" +
    ".rc .rcSince{background:#fff;color:#1a1a1a;border-radius:10px;padding:8px 12px;margin:8px 0}.rc .rcSince h3{font-size:16px;margin:4px 0}.rc .rcSince h4{font-size:14px}" +
    ".rc .rcSince table{table-layout:fixed;width:100%}.rc .rcSince td,.rc .rcSince th,.rc .rcSince p,.rc .rcSince li,.rc .rcSince summary,.rc .rcSince caption{overflow-wrap:anywhere;word-break:break-word}" +
    ".rc .rcSince details summary{color:#7a4a00;min-height:44px;display:flex;align-items:center}.rc .rcSince th,.rc .rcSince td{font-size:13px}" +
    ".rc .rc-table th:nth-child(1){width:24%}.rc .rc-table th:nth-child(2){width:24%}.rc .rc-table th:nth-child(3){width:34%}.rc .rc-table th:nth-child(4){width:18%}" +
    ".rc .rc-sources th:nth-child(1){width:34%}.rc .rc-sources th:nth-child(2),.rc .rc-sources th:nth-child(3){width:33%}" +
    ".rc .rcPast{border:1px solid var(--amber,#ffb84d);border-radius:10px;padding:8px 12px;margin:8px 0;background:rgba(255,184,77,.10);line-height:1.7}" +
    ".rc .rcH4{font-size:15px;margin:12px 0 4px;color:var(--amber,#ffb84d)}.rc .rcH5{font-size:13.5px;margin:8px 0 2px}.rc .rcList{margin:0 18px;padding:0;line-height:1.7;overflow-wrap:anywhere}" +
    ".rc .rcLock dl{display:grid;grid-template-columns:minmax(80px,max-content) 1fr;gap:4px 12px;margin:6px 0}.rc .rcLock dt{color:var(--muted,#8fa0ba);font-size:13px}.rc .rcLock dd{margin:0;overflow-wrap:anywhere}" +
    ".rc .rcBtns{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.rc .rcBtns .hw{flex:1 1 150px}.rc .rcBtns .hw button:not(.hbtn),.rc .rcBtns>button{flex:1 1 auto;min-height:44px}" +
    ".rc button[aria-disabled=true]{opacity:.55;cursor:progress}.authBox.rc #mdClose{min-height:44px;min-width:44px}.rc .rcOk{color:var(--green,#4ade80)}" +
    ".rc .rcConfirm{border:1px solid var(--amber,#ffb84d);border-radius:10px;padding:12px;background:rgba(255,184,77,.10);line-height:1.7}" +
    "#updNote{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 14px}#updNote span{flex:1 1 220px;min-width:0;overflow-wrap:anywhere}#updNote button{min-height:44px}" +
    "@media (max-width:480px){.rc .rcSince{padding:6px 8px}.rc .rcSince th,.rc .rcSince td{font-size:12px;padding:4px!important}.rc .rcLock dl{grid-template-columns:1fr}}";
  function ensureStyle() { if ($("recheckStyle")) return; const s = document.createElement("style"); s.id = "recheckStyle"; s.textContent = CSS; document.head.appendChild(s); }
  const advNow = () => { const A = A_(); return !!(A && A.isAdv && A.isAdv() === true); };
  const availNow = () => { const A = A_(); return !!(A && A.loggedIn && A.loggedIn() && available(A.cfg, A.getFeatures(), advNow())); };

  function alive(seq) { const A = A_(); return !!A && seq === ST.seq && !!ST.modal && ST.modal.isConnected && $("authModal") === ST.modal && A.loggedIn() && A.user_() === ST.who; }
  const setStatus = t => { const e = $("rcStatus"); if (e) e.textContent = t || ""; };
  const setMsg = t => { const e = $("rcMsg"); if (e) e.textContent = t || ""; };
  const focusSoon = el => { try { if (el && el.isConnected) el.focus({ preventScroll: false }); } catch (e) { /* ignore */ } };
  // החלפת התוכן: אם המיקוד היה בתוך החלון והאלמנט שלו נעלם — חוזר אל החלון עצמו (אחרת הוא נופל ל-body: Escape ו-Tab היו מפסיקים לעבוד)
  const setBody = h => { const e = $("rcBody"), m = ST.modal; if (!e) return; const had = !!m && m.contains(document.activeElement); e.innerHTML = h; if (had && !m.contains(document.activeElement)) focusSoon(m.firstElementChild); };
  function setBusy(on) {
    ST.busy = !!on;
    if (!ST.modal) return;
    ST.modal.querySelectorAll("[data-rc]").forEach(b => { if (on) b.setAttribute("aria-disabled", "true"); else if (!(b.dataset.rc === "save" && ST.saved)) b.removeAttribute("aria-disabled"); });
    const b = $("rcBody"); if (b) { if (on) b.setAttribute("aria-busy", "true"); else b.removeAttribute("aria-busy"); }
  }
  const focusables = m => [...m.querySelectorAll('button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(e => e.getClientRects().length > 0);

  function skeleton(row) {
    return '<h2 id="rcTitle">' + E(STR.title) + '</h2><p class="rcName" dir="auto"><b>' + E(row.name) + "</b></p><p class=\"small\">" + E(STR.intro) + "</p>" +
      '<div id="rcStatus" class="small" role="status" aria-live="polite"></div><div id="rcMsg" class="err" role="alert"></div><div id="rcBody" aria-live="off"></div>';
  }
  const btn = (act, text, helpText, helpName, cls, off) => '<span class="hw"><button type="button" data-rc="' + act + '"' + (cls ? ' class="' + cls + '"' : "") + (off ? ' aria-disabled="true"' : "") + ">" + E(text) + "</button>" + hbtn(helpText, helpName) + "</span>";
  function buttonsHtml(canUpdate, started) {
    return (started ? '<p class="small rcNoUpd" role="note">' + E(STR.noUpdate) + "</p>" : "") + '<div class="rcBtns">' + btn("save", ST.saved ? STR.saved : STR.save, HELP.save, STR.save, "primary", ST.saved) + btn("dl", STR.download, HELP.download, "הורדת דוח הבדיקה החוזרת") + (canUpdate ? btn("update", STR.update, HELP.update, STR.update) : "") +
      '<button type="button" data-rc="back">' + E(STR.back) + "</button></div>";
  }
  function showError(text, retryable) {
    setStatus(""); setBusy(false);
    setMsg(text);
    setBody('<div class="rcBtns">' + (retryable ? '<button type="button" data-rc="retry">' + E(STR.retry) + "</button>" : "") + '<button type="button" data-rc="back">' + E(STR.back) + "</button></div>");
    focusSoon(ST.modal && ST.modal.querySelector("[data-rc]"));
  }

  async function run(seq) {
    const A = A_(), h = ST.hooks, row = ST.row;
    ST.view = null; ST.saved = false; ST.pending = false;
    setMsg(""); setBody(""); setBusy(true); setStatus(STR.loading);
    if (!h || typeof h.analyze !== "function") { showError(STR.notReady, false); return; }
    if (ST.inflight) { showError(STR.running, true); return; }
    ST.inflight = true;
    try {
      let res;
      try { res = await A.call("getRequest", { folderId: row.id }); } catch (e) { res = { ok: false, error: "network" }; }
      if (!alive(seq)) return;
      if (!isObj(res) || res.ok !== true || !isObj(res.rec)) { showError(errText(res, A), transient(res)); return; }
      const prep = prepare(res.rec, { cfg: A.cfg, name: row.name });
      if (!prep.ok) { showError(prep.text, false); return; }
      const meta = isObj(res.meta) ? res.meta : {}, sentAt = num(meta.sentAt) && meta.sentAt > 0 ? meta.sentAt : row.sentAt;
      setStatus(STR.syncing);
      let an;
      try { an = await h.analyze(prep.inp, t => { if (alive(seq)) setStatus(t); }); } catch (e) { an = { ok: false, message: (e && e.message) || "" }; }
      if (!alive(seq)) return;
      if (!isObj(an) || an.ok !== true || !an.res || !an.data) { showError(isObj(an) && an.error === "busy" ? STR.busy : clean(isObj(an) && an.message, 400) || STR.failed, true); return; }
      setStatus(STR.comparing);
      const cmp = compare({ raw: res.rec, inp: prep.inp, res: an.res, data: an.data, cfg: A.cfg, now: an.now || new Date(), sentAt });
      if (!cmp.ok) { showError(STR.notAvailable, false); return; }
      const todayYmd = C.ilToday(an.now || new Date()), us = updateState(cmp, prep.inp, todayYmd);
      const view = { res: an.res, data: an.data, cfg: A.cfg, now: an.now || new Date(), since: cmp.since, cmp, rec: res.rec, prep, sentAt, row, bytes: null, started: us.started, canUpdate: us.canUpdate, blockedByDate: us.blockedByDate,
        findings: cmp.cur ? findingsModel(cmp.cur) : null, locked: lockedModel(prep.inp, row.name), past: prep.inp.dateTo < todayYmd, testOnly: row.state === "sent_test", curError: cmp.curError };
      ST.view = view;
      setBusy(false); setStatus(STR.done);
      setBody(resultHtml(view) + buttonsHtml(view.canUpdate, view.blockedByDate));
      const r = $("rcRes"); if (r) { try { r.scrollIntoView({ block: "start" }); } catch (e) { /* ignore */ } focusSoon(r); }
    } finally { ST.inflight = false; if (alive(seq) && ST.busy) setBusy(false); }
  }

  // בניית ה-Word פעם אחת לתצוגה (שמירה והורדה מקבלות אותו קובץ)
  async function bytesOf() {
    const v = ST.view; if (!v) throw new Error("no view");
    if (!v.bytes) v.bytes = await wordBytes({ O: window.ReqOut, D: window.ReqDocx }, v);
    return v.bytes;
  }
  const bytesToB64 = bytes => { let s = ""; const CH = 0x8000; for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return btoa(s); };
  const fileName = v => { const O = window.ReqOut; let base = ""; try { base = O && O.fileBase ? O.fileBase(v.res) : ""; } catch (e) { base = ""; } return (O && O.safeName ? O.safeName("בדיקה חוזרת — " + base, 120) : "בדיקה חוזרת") + ".docx"; };   // כמו שאר ההורדות: שם האתר והתאריך

  async function actSave(seq) {
    const A = A_(), v = ST.view; if (!v || ST.saved) return;
    if (!availNow()) { setMsg(STR.notAvailable); return; }
    setMsg(""); setBusy(true); setStatus(STR.saving);
    let bytes = null, r;
    try { bytes = await bytesOf(); } catch (e) { bytes = null; }
    if (!alive(seq)) return;
    if (!bytes) { setBusy(false); setStatus(""); setMsg(STR.wordFail); return; }
    try { r = await A.call("saveRecheck", { folderId: v.row.id, b64: bytesToB64(bytes), sum: v.cmp.sum }); } catch (e) { r = { ok: false, error: "network" }; }
    if (!alive(seq)) return;
    setBusy(false); setStatus("");
    if (!isObj(r) || r.ok !== true) { setMsg(errText(r, A)); return; }
    ST.saved = true;
    const sb = ST.modal.querySelector('[data-rc="save"]'); if (sb) { sb.textContent = STR.saved; sb.setAttribute("aria-disabled", "true"); }
    setStatus(STR.saveOk(num(r.rechecks) ? r.rechecks : 0));
    const st = $("rcStatus"); if (st) st.classList.add("rcOk");
  }
  async function actDownload(seq) {
    const v = ST.view; if (!v) return;
    setMsg(""); setBusy(true);
    let bytes = null;
    try { bytes = await bytesOf(); } catch (e) { bytes = null; }
    if (!alive(seq)) return;
    setBusy(false);
    if (!bytes) { setMsg(STR.wordFail); return; }
    const mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([bytes], { type: mime })); a.download = fileName(v); document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function actUpdate(seq) {
    const v = ST.view, h = ST.hooks; if (!v || !v.canUpdate) return;
    if (!availNow()) { setMsg(STR.notAvailable); return; }
    const inputs = R.restoreInputs(v.rec, { keepDates: true, cfg: A_().cfg });
    if (!inputs) { setMsg(STR.unusable); return; }
    if (!h || typeof h.loadUpdate !== "function") { setMsg(STR.notReady); return; }
    if (typeof h.busy === "function" && h.busy()) { setMsg(STR.busy); return; }
    if (typeof h.inProgress === "function" && h.inProgress()) {   // בקשה בעבודה: אישור לפני ההחלפה, בתוך החלון (לא confirm של הדפדפן)
      ST.pending = { inputs };
      setStatus(""); setMsg("");
      setBody('<div class="rcConfirm" role="group" aria-labelledby="rcConfirmT"><p id="rcConfirmT">' + E(STR.confirm) + '</p><div class="rcBtns"><button type="button" data-rc="no" class="primary" aria-describedby="rcConfirmT">' + E(STR.no) + '</button><button type="button" data-rc="yes">' + E(STR.yes) + "</button></div></div>");
      focusSoon(ST.modal.querySelector('[data-rc="no"]'));
      return;
    }
    applyUpdate(inputs);
  }
  function applyUpdate(inputs) {
    const A = A_(), h = ST.hooks, v = ST.view; if (!v || !h || typeof h.loadUpdate !== "function") return;
    if (typeof h.busy === "function" && h.busy()) { setMsg(STR.busy); return; }
    let r;
    try { r = h.loadUpdate(inputs, { sentAt: v.sentAt, name: v.row.name, live: v.row.state === "sent_live" }); } catch (e) { r = null; }
    if (!r || !r.ok) { setMsg(r && r.error === "busy" ? STR.busy : STR.failed); return; }
    ST.seq++; ST.modal = null; ST.pending = null; ST.view = null;
    A.closeModal();
    showNote(updateNote(v.row.name, v.sentAt) + (Array.isArray(r.notes) && r.notes.length ? " " + STR.notes + ": " + r.notes.map(x => clean(x, 200)).filter(Boolean).join(", ") + "." : ""));
    const run_ = $("runBtn"); if (run_) { try { run_.scrollIntoView({ block: "center", behavior: window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); run_.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }
  function backToList() {
    const M = window.ReqMyReq;
    ST.seq++; ST.modal = null; ST.view = null;
    if (M && typeof M.open === "function") M.open(); else A_().closeModal();
  }
  function onClick(ev) {
    const b = ev.target && ev.target.closest ? ev.target.closest("button[data-rc]") : null;
    if (!b || b.disabled || ST.busy || b.getAttribute("aria-disabled") === "true") return;
    const seq = ST.seq;
    switch (b.dataset.rc) {
      case "save": actSave(seq); break;
      case "dl": actDownload(seq); break;
      case "update": actUpdate(seq); break;
      case "back": backToList(); break;
      case "retry": run(seq); break;
      case "yes": { const p = ST.pending; if (p) applyUpdate(p.inputs); break; }
      case "no": ST.pending = null; if (ST.view) { setBody(resultHtml(ST.view) + buttonsHtml(ST.view.canUpdate, ST.view.blockedByDate)); focusSoon($("rcRes")); } break;
      default: break;
    }
  }
  // מאזין אחד על ה-document בשלב הלכידה (לפני help.js): Escape סוגר את החלון (אלא אם בועת ״!״ פתוחה — היא נסגרת ב-help.js), ו-Tab לא בורח לדף שמאחור
  function onKey(ev) {
    const A = A_(), m = ST.modal;
    if (!A || !m || !m.isConnected || $("authModal") !== m) return;
    if (ev.key === "Escape") {
      const hb = $("hbubble"); if (hb && !hb.hidden) return;
      ev.preventDefault(); A.closeModal(); return;
    }
    if (ev.key !== "Tab") return;
    const f = focusables(m); if (!f.length) return;
    const cur = document.activeElement, first = f[0], last = f[f.length - 1], box = m.firstElementChild;
    if (ev.shiftKey && (cur === first || cur === box)) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && (cur === last || !m.contains(cur))) { ev.preventDefault(); first.focus(); }
  }

  /* ----- הודעה בדף אחרי הכנת בקשה מעודכנת ----- */
  function removeNote() { const n = $("updNote"); if (n) n.remove(); }
  function showNote(text) {
    removeNote();
    const sec = $("inputs"); if (!sec || !sec.parentNode) return;
    const n = document.createElement("div"); n.id = "updNote"; n.className = "banner ok"; n.setAttribute("role", "status");
    const sp = document.createElement("span"); sp.textContent = text; n.appendChild(sp);
    const b = document.createElement("button"); b.type = "button"; b.textContent = STR.close; b.onclick = removeNote; n.appendChild(b);
    sec.parentNode.insertBefore(n, sec);
    const rb = $("runBtn"); if (rb) rb.addEventListener("click", removeNote, { once: true });
  }

  // נקודת הכניסה: מ״הבקשות שלי״ (myreq.js: onAction). אין חלון אם הבדיקה החוזרת אינה זמינה בחשבון (נכשל סגור)
  function start(row) {
    const A = A_();
    if (!A || !availNow() || !isObj(row) || typeof row.id !== "string" || !row.id || !eligible(row.state)) return null;
    ensureStyle();
    const safe = { id: row.id, name: clean(row.name, 120) || "בקשה", state: row.state, sentAt: num(row.sentAt) ? row.sentAt : 0 };
    const m = A.modal(skeleton(safe), "rc");
    if (!m) return null;   // שמירה/שליחה בעיצומה: auth.js לא מחליף חלון
    ST.seq++; ST.who = A.user_(); ST.modal = m; ST.row = safe; ST.view = null; ST.saved = false; ST.pending = null; ST.busy = false;
    m.setAttribute("aria-labelledby", "rcTitle"); m.firstElementChild.classList.add("rc");
    m.addEventListener("click", onClick);
    run(ST.seq);
    return m;
  }
  function reset() { ST.seq++; ST.who = ""; ST.modal = null; ST.row = null; ST.view = null; ST.busy = false; ST.saved = false; ST.pending = null; removeNote(); }

  // ההרחבה של ״הבקשות שלי״: כפתור לכל בקשה שנשלחה, רק כשהבדיקה החוזרת זמינה בחשבון (אחרת רשימה כמו בשלב א׳)
  const provider = {
    actions() { return availNow() ? [{ act: "recheck", text: STR.btn, label: STR.btnLabel, states: STATES.slice(), help: HELP.list, helpName: STR.btnLabel }] : []; },
    onAction(act, id, row) { if (act === "recheck" && isObj(row)) start(row); }
  };
  function hook(h) {
    ST.hooks = isObj(h) ? h : null;
    const M = window.ReqMyReq;
    if (M && typeof M.extend === "function") M.extend(ST.hooks ? provider : null);
  }
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("req-logout", reset);
  document.addEventListener("req-auth", reset);
  document.addEventListener("req-adv", () => { if (ST.modal && ST.modal.isConnected && !availNow()) { const A = A_(); ST.seq++; ST.modal = null; ST.view = null; if (A) A.closeModal(); } });   // ההרשאה בוטלה בזמן שהחלון פתוח: סוגרים

  return Object.assign(api, { start, reset, hook, provider, clearNote: removeNote, state: () => ({ seq: ST.seq, who: ST.who, view: !!ST.view, busy: ST.busy, saved: ST.saved }) });
});
