/* ReqRecheck — "בדיקה חוזרת" ו"שינויים מאז ההגשה" (שלב ב׳): ליבה טהורה (UMD כמו core.js; בדפדפן וב-Node) — בלי DOM, בלי רשת, בלי שעון.
   תמונת מצב קומפקטית של הניתוח שהוגש (נשמרת בקובץ נתוני הבקשה), השוואה שלה לניתוח חדש, שחזור קלט מבקשה שמורה, ובניית הטקסטים והתצוגות (HTML מוגן) של הסעיף.
   כללי ברזל: (1) נכשל סגור — קלט סריקה שונה, מקור נתונים ישן מהשמור, הגדרות סריקה ששונו או תמונת מצב פגומה ← {comparable:false, reason}, לא "אין שינוי";
   (2) בלי פרטי מבקש בתמונת המצב; (3) הקלט לא נסמך: validateRecord/restoreInputs בודקים כל שדה מחדש (טיפוסים, תקרות, מפתחות לא מוכרים נזרקים, בלי זיהום אב-טיפוס);
   (4) כל מחרוזת בפלט המודלים היא טקסט רגיל; *Html מחזירים HTML שכל ערך דינמי בו עבר esc. אין כאן הכרעה אם הטיסה מותרת — עובדות בלבד.

   ===== API =====
   VERSION                                 1 (גרסת תמונת המצב)
   LIMITS / STR                            תקרות ומחרוזות עברית (STR.banner = "דוח זה לא צורף לבקשה שנשלחה למודיעין טיס")
   enabled(cfg)                            true אלא אם config.features.recheck === false (מפתח חסר = פעיל)
   optsFromCfg(cfg)                        => opts ל-diffSnapshots מ-cfg.recheck (dist_eps_m, dist_eps_pct, rows_screen, rows_word); חסר => ברירות מחדל

   --- תמונת מצב ---
   snapshotOf(res, data, cfg, now?)        => snapshot (אובייקט JSON). res = C.analyze; data = אותו data שהועבר ל-analyze; now (Date|ms) רק לשדה at.
                                              דטרמיניסטי (מיון קבוע, בלי שעון); זורק Error כשהניתוח חסר/חורג מהתקרות (המתקשר עוטף ב-try/catch ושומר בלי תמונת מצב).
   cleanSnapshot(s)                        => {ok, snapshot?, reason?}  reason: not_object | version | malformed — נקי ומוגבל; כל חריגה ← לא תקין (לא משלימים)

   --- השוואה ---
   diffSnapshots(prev, cur, opts?)         => diff. opts: {eps (מ׳, 10), epsPct (5), now (ms; ברירת מחדל cur.at), osmSlackMs (0), excessive (200)}
       לא ניתן להשוות: {comparable:false, reason, ...}  reason: no_baseline | bad_baseline | baseline_unsupported | bad_current | scan_mismatch | thresholds_changed | stale_notams | stale_osm | no_source_time
       ניתן: {comparable:true, dates, sources[], notams|zones|items|other: {rows[], checked, unchanged}, counts:{added,removed,changed,total,high,byCat}, anyChange, excessive, reliability:{items,notams}}
       שורה: {cat, status, cls:'added'|'removed'|'changed', sev:'high'|'mid'|'low', id, title, fields[], before, after, by?, replaces?, d}
       status: new entered added cancelled replaced withdrawn expired gone out changed closer farther left excluded

   --- בקשה שמורה ---
   validateRecord(rec, cfg?)               => {ok:true, rec:{savedAt, site, version, edition, declaration, inputs, zones, items, snapshot, snapshotStatus, trimmed[]}} | {ok:false, reason:'bad_record'|'too_big', errors[]}
   restoreInputs(rec, {keepDates?, cfg?})  => אובייקט קלט לטופס ("השתמש כבסיס") או null כשהרשומה לא שמישה. תאריכים/שעות (וגם תאריך סיור) ריקים אלא אם keepDates

   --- מודלים ו-HTML ---
   sinceModel(diff, ctx)                   => מודל הסעיף (טקסט רגיל — Word/מסך): {kind:'changes'|'none'|'nobase'|'blocked', reason?, title, banner:{text,sub,resend}, dates:[{label,value}], summary, checkedLine, limitation, notes[],
                                              sources:[{label,before,after,changed}], sections:[{key,title,total,rows:[{status,cls,sev,statusLabel,sevLabel,id,title,lines[],dist}], rest[], hidden}], counts}
                                              ctx: {sentAt, checkedAt, activity:{dateFrom,dateTo,timeFrom,timeTo}, maxRows (15 למסך; LIMITS.rowsWord ל-Word — rest = השורות העודפות, hidden = מספרן), resendNote (true)}
   sinceHtml(model)                        => HTML מוגן של הסעיף (כולל הבאנר)         bannerHtml(sentAt, opts?) / bannerText(sentAt)
   requestModel(rec, ctx?) / requestHtml(m) => סיכום קריאה-בלבד של בקשה שמורה ("הצג בקשה")
   updateSubjectPrefix(sentAt)             => "[עדכון לבקשה מ-dd.mm.yyyy] "           updateBodyLine(sentAt) => "בקשה זו מחליפה את הבקשה שנשלחה ב-dd.mm.yyyy."
   updateMail(mail, sentAt)                => עותק של {to,subject,body,mailto} עם קידומת הנושא ומשפט ההחלפה (אידמפוטנטי)
   fmtDate(ms) / fmtDateTime(ms)           => תאריך / תאריך+שעה בשעון ישראל */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./core.js"));
  else root.ReqRecheck = factory(root.ReqCore);
})(typeof self !== "undefined" ? self : this, function (C) {
  "use strict";

  const VERSION = 1;
  const LIMITS = { items: 400, known: 3000, hits: 300, zones: 300, rc: 600, air: 40, agri: 20, borders: 10, bytes: 400000, record: 600000, manual: 50, aircraft: 20, aircraftLen: 60, name: 120, obstacles: 1000, notes: 3000, listZones: 500, listItems: 1000, rowsScreen: 15, rowsWord: 100, excessive: 200 };
  // הגדרות שמשפיעות על תוצאות הסריקה (ולכן נשמרות בתמונת המצב ונבדקות בהשוואה). ברירות המחדל זהות ל-fallback שבקוד הליבה
  const SCAN_TH = ["near_zone_m", "approx_margin_m", "site_near_m", "airfield_scan_m", "airfield_near_m", "border_scan_m", "notam_near_m", "agri_near_m"];
  const DEF_TH = { site_near_m: 1000, airfield_scan_m: 15000, airfield_near_m: 1000, border_scan_m: 7000, notam_near_m: 10000, agri_near_m: 3000 };
  const TH_LABEL = { near_zone_m: "טווח אזורים בקרבת הסגירה", approx_margin_m: "שולי אזורים משורטטים בקירוב", site_near_m: "טווח אתרים ותשתיות", airfield_scan_m: "טווח סריקת שדות תעופה", airfield_near_m: "טווח שדות תעופה בקרבת הסגירה", border_scan_m: "טווח סריקת גבולות", notam_near_m: "טווח נוטמים בקרבת הסגירה", agri_near_m: "טווח מנחתים חקלאיים" };
  const TH_BD = /^bd\.[A-Z]{2}$/;
  const SRC_KEYS = ["zh", "mv", "ed", "pm", "ni", "ob", "of", "ox", "cv"];

  const STR = {
    title: "שינויים מאז ההגשה",
    banner: "דוח זה לא צורף לבקשה שנשלחה למודיעין טיס",
    bannerSub: "הבקשה שנשלחה לא השתנתה.",
    resend: "אם הבקשה כבר אושרה — אין צורך לשלוח שוב. אם טרם אושרה, אפשר לשלוח בקשה מעודכנת; השליחה החדשה מחליפה את הקודמת.",
    none: "לא נמצאו שינויים מאז ההגשה.",
    limit: "ההשוואה היא בין נתוני המערכת (נוטמים, פמ״ת, OpenStreetMap) בהגשה לנתונים כעת. היא אינה מחליפה את בדיקת הטייס.",
    osm: "לפי OpenStreetMap — שינוי יכול לנבוע מעדכון המפה ולא משינוי בשטח.",
    excessive: "כמות שינויים חריגה — ייתכן שמקור הנתונים או הגדרות המערכת השתנו.",
    capped: "בהגשה נשמרו רק המכשולים והתשתיות הקרובים ביותר, ולכן ההשוואה שלהם חלקית.",
    cappedKnown: "רשימת הנוטמים שנשמרה בהגשה חלקית, ולכן הסיבה להיעלמות נוטם אינה מפורטת.",
    noBase: "לא נשמרה תמונת מצב בהגשה, ולכן אי אפשר לדעת מה השתנה. מוצגים הממצאים הנוכחיים בלבד.",
    badBase: "תמונת המצב שנשמרה בהגשה פגומה, ולכן אי אפשר לדעת מה השתנה. מוצגים הממצאים הנוכחיים בלבד.",
    oldBase: "תמונת המצב שנשמרה בהגשה היא מגרסה שאינה נתמכת, ולכן אי אפשר לדעת מה השתנה. מוצגים הממצאים הנוכחיים בלבד.",
    badCur: "תמונת המצב הנוכחית אינה תקינה, ולכן אי אפשר להשוות.",
    scan: "פרטי הסריקה (נקודה, רדיוס, גובה או מועדי הפעילות) שונים מאלה שבהגשה, ולכן אין השוואה. שינוי כזה הוא בקשה חדשה ולא בדיקה חוזרת.",
    noTime: "חסר מועד של מקור נתונים (נוטמים או OpenStreetMap), ולכן אי אפשר להשוות באופן אמין.",
    submitted: "הוגשה", checked: "נבדקה מחדש", activity: "מועד הפעילות",
    cat: { notams: "נוטמים", zones: "אזורי איסור והגבלה", items: "מכשולים ותשתיות", other: "גבולות, שדות תעופה ומנחתים" },
    catShort: { notams: "נוטמים", zones: "אזורי איסור/הגבלה", items: "מכשולים ותשתיות", other: "אחר" },
    cols: ["סטטוס", "פריט", "פירוט", "מרחק מהנקודה"],
    sev: { high: "חומרה גבוהה", mid: "חומרה בינונית", low: "" },
    sources: "מקורות הנתונים", srcCols: ["מקור", "בהגשה", "כעת"],
    srcLabel: { ni: "נוטמים נמשכו", ob: "OpenStreetMap", of: "OpenStreetMap (שדות תעופה)", ox: "OpenStreetMap (גבולות)", mv: "גרסת מפה", ed: "מהדורת הפמ״ת בנתוני המערכת", zh: "נתוני האזורים", cv: "הגדרות המערכת" },
    unchangedWord: "ללא שינוי", updatedWord: "עודכנו",
    more: "הצג את כל השורות",
    status: {
      notam: { new: "חדש — פורסם אחרי ההגשה", entered: "נכנס לטווח הבדיקה", added: "נוסף", cancelled: "בוטל", replaced: "הוחלף", withdrawn: "אינו מופיע עוד ברשימת הנוטמים לפני תום תוקפו (ביטול או החלפה)", expired: "פג תוקפו", gone: "אינו מופיע עוד ברשימת הנוטמים", out: "אינו נספר עוד כסגירה בטווח", changed: "שונה" },
      zone: { entered: "חדש בטווח הבדיקה", left: "יצא מהטווח או אינו בנתונים", excluded: "נשלל לפי הגובה המבוקש", changed: "שונה" },
      item: { added: "חדש", removed: "אינו מופיע עוד", changed: "שונה", closer: "התקרב", farther: "התרחק" },
      other: { added: "חדש", removed: "אינו מופיע עוד", changed: "שונה" }
    },
    field: { text: "נוסח", window: "תוקף", geometry: "גבול/גיאומטריה", height: "גבהים", kind: "סוג", inside: "מיקום ביחס לסגירה", distance: "מרחק", tags: "תכונות", title: "שם", zone: "קרבה לסגירה", violates: "חדירה לרצועת הגבול" },
    before: "לפני", after: "אחרי", by: "ע״י", replaces: "מחליף את", cancelBy: "בוטל ע״י הנוטם", replacedBy: "הוחלף בנוטם", notCounted: "(אינו נספר כסגירה בטווח)",
    inZone: "בתוך הסגירה", ringZone: "בטבעת (עד פי 2 מהרדיוס)", nearZone: "בקרבת הסגירה",
    perm: "קבוע", noGeo: "ללא מיקום בנוטם", inside: "בתוך השטח", feet: "רגל"
  };
  // סיבות שבהן אין השוואה → ניסוח
  const REASON_TEXT = { no_baseline: STR.noBase, bad_baseline: STR.badBase, baseline_unsupported: STR.oldBase, bad_current: STR.badCur, scan_mismatch: STR.scan, no_source_time: STR.noTime };

  /* ================= עזרים ================= */
  const isObj = o => o !== null && typeof o === "object" && !Array.isArray(o);
  const own = (o, k) => (o !== null && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k)) ? o[k] : undefined;
  const num = v => typeof v === "number" && isFinite(v);
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const r1 = x => Math.round(x);
  const h12 = s => C.sha256Hex(s).slice(0, 12);
  const q5 = v => +v.toFixed(5);
  const E = s => C.esc(s).replace(/'/g, "&#39;");
  const isDate = v => Object.prototype.toString.call(v) === "[object Date]";
  const toMs = v => { const t = isDate(v) ? v.getTime() : typeof v === "number" ? v : (typeof v === "string" && v) ? Date.parse(v) : NaN; return isFinite(t) && Math.abs(t) <= 8.64e15 ? t : NaN; };
  const byteLen = s => new TextEncoder().encode(s).length;

  // טקסט נקי: בלי בקרה/כיווניות/רוחב-אפס/חצי סרוגייט (אסורים ב-XML של Word ומטעים בתצוגה); שורה אחת (רווחים מכווצים); חיתוך לפי תווי יוניקוד שלמים
  const badCode = c => c < 0x20 || (c >= 0x7f && c <= 0x9f) || (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff || (c >= 0xd800 && c <= 0xdfff) || c === 0xfffe || c === 0xffff;
  function clean(v, max, multi) {
    let o = "";
    for (const ch of String(v == null ? "" : v)) {
      const c = ch.codePointAt(0);
      if (c === 10 && multi) { o += "\n"; continue; }
      if (c === 9 || c === 10 || c === 13) { o += c === 13 && multi ? "" : " "; continue; }
      if (!badCode(c)) o += ch;
    }
    o = multi ? o.split("\n").map(l => l.replace(/[ \u00a0]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim() : o.replace(/\s+/g, " ").trim();
    return max && o.length > max ? Array.from(o).slice(0, max).join("") : o;
  }

  let tzFmt = null;
  function ilParts(ms) {
    const f = tzFmt || (tzFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }));
    const o = {}; f.formatToParts(new Date(ms)).forEach(p => { o[p.type] = p.value; }); return o;
  }
  const fmtDate = ms => { ms = toMs(ms); if (isNaN(ms)) return ""; const o = ilParts(ms); return o.day + "." + o.month + "." + o.year; };
  const fmtDateTime = ms => { ms = toMs(ms); if (isNaN(ms)) return ""; const o = ilParts(ms); return o.day + "." + o.month + "." + o.year + " " + o.hour + ":" + o.minute; };
  const fmtZ = ms => new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z";   // כמו דף הבדיקות: UTC
  const ymd = s => { const d = C.parseDate(s); return d ? C.ddmmyyyy(d) : ""; };

  const enabled = cfg => !(cfg && cfg.features && cfg.features.recheck === false);
  function optsFromCfg(cfg) {
    const rc = (cfg && cfg.recheck) || {};
    return { eps: num(rc.dist_eps_m) ? rc.dist_eps_m : 10, epsPct: num(rc.dist_eps_pct) ? rc.dist_eps_pct : 5, rowsScreen: num(rc.rows_screen) ? rc.rows_screen : LIMITS.rowsScreen, rowsWord: num(rc.rows_word) ? rc.rows_word : LIMITS.rowsWord };
  }

  /* ================= תמונת מצב ================= */
  const notamBody = raw => String(raw == null ? "" : raw).replace(/^\s*\S+\s+NOTAM[NRC]\b(?:[ \t]+\S+)?/, "").replace(/\s+/g, " ").trim();   // בלי שורת הכותרת (מספר/סוג/הפניה): נוסח הנוטם עצמו
  const notamHead = raw => { const m = /^\s*(\S+)\s+NOTAM([NRC])\b(?:[ \t]+(\S+))?/.exec(String(raw == null ? "" : raw)); return m ? { id: m[1], type: m[2], ref: m[3] || "" } : null; };
  const geomHash = g => g ? h12(JSON.stringify(g.kind === "circle" ? [g.c.map(q5), r1(g.r)] : g.pts.map(p => p.map(q5)))) : "";
  const thresholdsOf = cfg => {
    const th = (cfg && cfg.thresholds) || {}, out = {};
    SCAN_TH.forEach(k => { const v = num(th[k]) ? th[k] : DEF_TH[k]; if (num(v)) out[k] = v; });
    const b = (cfg && cfg.borders) || {};
    Object.keys(b).sort().forEach(iso => { if (/^[A-Z]{2}$/.test(iso) && b[iso] && num(b[iso].km)) out["bd." + iso] = b[iso].km; });
    return out;
  };

  function snapshotOf(res, data, cfg, now) {
    if (!res || !res.inp || !res.notams || !res.zones || !res.nearScan || !Array.isArray(res.nearScan.items)) throw new Error("snapshotOf: הניתוח חסר או לא שלם");
    data = data || {}; cfg = cfg || {};
    const R = res.R, th = thresholdsOf(cfg), nowMs = toMs(now), zd = data.zones || {}, pm = zd.pamat || {};
    const osmBase = x => (x && x.osm3s && typeof x.osm3s.timestamp_osm_base === "string") ? clean(x.osm3s.timestamp_osm_base, 40) : "";
    const capped = { items: 0, known: 0 };

    // נוטמים: סגירות + מכשולים שפורסמו; מזהה כפול (לא אמור) — הראשון
    const nrec = (x, k) => ({
      id: clean(x.id, 80), k, f: x.window.from, t: x.window.to === Infinity ? 0 : x.window.to,
      d: x.d == null ? -1 : r1(x.d), e: r1(x.edge || 0), r: x.relation === "overlap" ? "o" : x.relation === "near" ? "n" : "x",
      lo: x.q ? x.q.lowerFt : null, up: x.q ? x.q.upperFt : null, g: geomHash(x.geometry), h: h12(notamBody(x.raw)),
      x: clean(String(x.heb || x.name || "").split("\n")[0], 100)
    });
    const seen = new Set(), hits = [];
    (res.notams.hits || []).forEach(x => { if (!seen.has(x.id)) { seen.add(x.id); hits.push(nrec(x, "c")); } });
    (res.notams.obstacles || []).forEach(x => { if (!seen.has(x.id)) { seen.add(x.id); hits.push(nrec(x, "o")); } });
    hits.sort((a, b) => (a.d - b.d) || cmp(a.id, b.id));
    if (hits.length > LIMITS.hits) throw new Error("snapshotOf: יותר מדי נוטמים בטווח (" + hits.length + ")");
    const feed = (data.notams || []).filter(n => n && typeof n.id === "string" && n.id && n.id.length <= 80);
    let known = Array.from(new Set(feed.map(n => clean(n.id, 80)))).filter(Boolean).sort(cmp);
    if (known.length > LIMITS.known) { capped.known = known.length - LIMITS.known; known = known.slice(0, LIMITS.known); }
    const rcSet = new Map();
    feed.forEach(n => { const hd = notamHead(n.raw); if (hd && hd.type !== "N" && hd.ref) rcSet.set(clean(n.id, 80) + "|" + hd.type + "|" + clean(hd.ref, 80), [clean(n.id, 80), hd.type, clean(hd.ref, 80)]); });
    const rc = Array.from(rcSet.values()).sort((a, b) => cmp(a[0] + a[1] + a[2], b[0] + b[1] + b[2])).slice(0, LIMITS.rc);

    // אזורים: מפתח src:id ייחודי (מזהה כפול מקבל #n)
    const zseen = new Map(), zones = [];
    const zrec = (z, inside) => {
      const base = z.src + ":" + z.id, n = (zseen.get(base) || 0) + 1; zseen.set(base, n);
      const zz = z.z || {};
      return {
        id: clean(z.id, 80) + (n > 1 ? "#" + n : ""), s: z.src, c: clean(z.cat, 12), n: clean(z.name, 60), d: r1(z.d), e: r1(z.edge || 0), in: inside ? 1 : 0, a: clean(z.alt, 100),
        g: h12(JSON.stringify(zz.rings ? zz.rings.map(rg => rg.map(p => p.map(q5))) : [zz.c, zz.r])),
        h: h12([z.name, z.alt, z.pmt, z.pmtRef, z.note, z.approx, zz.minFt, zz.max, zz.min].join("|"))
      };
    };
    (res.zones.inside || []).forEach(z => zones.push(zrec(z, true)));
    (res.zones.near || []).forEach(z => zones.push(zrec(z, false)));
    zones.sort((a, b) => (a.d - b.d) || cmp(a.s + a.id, b.s + b.id));
    if (zones.length > LIMITS.zones) throw new Error("snapshotOf: יותר מדי אזורים בטווח (" + zones.length + ")");
    const zex = Array.from(new Set((res.zones.excluded || []).map(x => clean(x.id, 80)))).filter(Boolean).sort(cmp);

    // פריטי OSM מקובצים (בלי פריטים שהוזנו ידנית: הם קלט המבקש, ונשמרים ב-manualItems)
    // קבוצה של כמה אלמנטים (קו חשמל/כביש/מצאי מאוחד) נושאת שם/תגיות של האלמנט *הראשון* שבה — תלוי בסדר ובהרכב הקבוצה, ולכן h = התווית בלבד,
    // והשם/התגיות (x) והכותרת נבדקים רק בפריט של אלמנט יחיד (n=1). כך שינוי הרכב קבוצה אינו נראה כשינוי תכונות
    let items = res.nearScan.items.filter(i => !i.manual).map(i => {
      const ids = Array.from(new Set(i.ids || [])).sort(cmp), tg = i.tags || {};
      return {
        k: clean(i.key, 120), i: ids.slice(0, 5).map(x => clean(x, 40)), n: ids.length, t: clean(i.title, 80), z: i.zone === "in" ? "i" : i.zone === "ring" ? "r" : "n",
        d: r1(i.d), c: clean(i.cat, 12), h: h12(String(i.label == null ? "" : i.label)),
        x: ids.length === 1 ? h12([i.name, tg.height, tg.voltage, tg.ref, tg.operator, tg["building:levels"]].join("|")) : ""
      };
    });
    const iseen = new Set(); items = items.filter(i => !iseen.has(i.k) && iseen.add(i.k));
    items.sort((a, b) => (a.d - b.d) || cmp(a.k, b.k));
    if (items.length > LIMITS.items) { capped.items = items.length - LIMITS.items; items = items.slice(0, LIMITS.items); }

    const aNear = x => x.d - R <= (th.agri_near_m || 3000);
    const oth = {
      borders: (res.borders || []).slice(0, LIMITS.borders).map(b => ({ iso: clean(b.iso, 8), d: r1(b.d), v: b.violates ? 1 : 0 })).sort((a, b) => cmp(a.iso, b.iso)),
      air: (res.airfields || []).filter(a => a.d - R <= (th.airfield_near_m || 1000)).slice(0, LIMITS.air).map(a => ({ id: clean(a.id, 40), d: r1(a.d), t: clean(a.type, 20), n: clean(a.name, 60) })).sort((a, b) => cmp(a.id, b.id)),
      agri: (res.agri || []).filter(aNear).slice(0, LIMITS.agri).map(a => ({ n: clean(a.name, 80), d: r1(a.d) })).sort((a, b) => cmp(a.n, b.n))
    };

    const snap = {
      v: VERSION,
      scan: { lat: res.inp.lat, lon: res.inp.lon, R, ft: +(+res.ft).toFixed(2), wf: res.sun && res.sun.length ? +res.sun[0].startUtc : 0, wt: res.sun && res.sun.length ? +res.sun[res.sun.length - 1].endUtc : 0 },
      src: {
        zh: clean(zd.dataHash, 80), mv: clean(zd.mapVersion, 40), ed: clean(zd.edition, 200), pm: clean((pm.update || "") + "|" + (pm.date || ""), 60),
        ni: clean(data.notamFetchedIso, 40), ob: osmBase(data.near), of: osmBase(data.far), ox: osmBase(data.ext), cv: clean(cfg.version, 40)
      },
      th,
      notams: { total: res.notams.total || 0, valid: res.notams.valid || 0, known, hits, rc },
      zones, zex, items, oth, capped
    };
    if (isFinite(nowMs)) snap.at = new Date(nowMs).toISOString();
    // תקרת גודל כוללת: קודם נחתכים פריטי OSM הרחוקים (הם מסומנים ב-capped וההשוואה שלהם חלקית), ואז רשימת המזהים המוכרים
    while (byteLen(JSON.stringify(snap)) > LIMITS.bytes && snap.items.length > 0) {
      const keep = Math.floor(snap.items.length * 0.8); snap.capped.items += snap.items.length - keep; snap.items = snap.items.slice(0, keep);
    }
    if (byteLen(JSON.stringify(snap)) > LIMITS.bytes && snap.notams.known.length) { snap.capped.known += snap.notams.known.length; snap.notams.known = []; }
    if (byteLen(JSON.stringify(snap)) > LIMITS.bytes) throw new Error("snapshotOf: תמונת המצב חורגת מהתקרה");
    return snap;
  }

  /* ----- בדיקת תקינות ונרמול (קלט עוין) ----- */
  class SnapErr extends Error {}
  const need = (c, w) => { if (!c) throw new SnapErr(w); };
  const finN = (v, w, min) => { need(num(v) && (min === undefined || v >= min), w); return v; };
  const strN = (v, max, w) => { need(typeof v === "string", w); return clean(v, max); };
  const hexN = (v, w) => { need(typeof v === "string" && /^[0-9a-f]{0,12}$/.test(v), w); return v; };
  const arrN = (v, max, w) => { need(Array.isArray(v) && v.length <= max, w); return v; };
  const oneN = (v, set, w) => { need(set.indexOf(v) >= 0, w); return v; };
  const idN = (v, w, max) => { const t = strN(v, max || 80, w); need(t, w); return t; };
  const objN = (v, w) => { need(isObj(v), w); return v; };
  const uniqN = (list, kf, w) => { const s = new Set(); list.forEach(x => { const k = kf(x); need(!s.has(k), w + ":dup"); s.add(k); }); return list; };

  function cleanSnapshot(s) {
    if (!isObj(s)) return { ok: false, reason: "not_object" };
    if (own(s, "v") !== VERSION) return { ok: false, reason: "version" };
    try {
      const g = k => own(s, k), sc = objN(g("scan"), "scan"), sr = objN(g("src"), "src"), th0 = objN(g("th"), "th"), nt = objN(g("notams"), "notams"), oh = objN(g("oth"), "oth"), cp = objN(g("capped"), "capped");
      const out = { v: VERSION };
      if (g("at") !== undefined) { const t = Date.parse(strN(g("at"), 40, "at")); need(isFinite(t), "at"); out.at = new Date(t).toISOString(); }
      out.scan = { lat: finN(own(sc, "lat"), "scan.lat"), lon: finN(own(sc, "lon"), "scan.lon"), R: finN(own(sc, "R"), "scan.R", 0), ft: finN(own(sc, "ft"), "scan.ft"), wf: finN(own(sc, "wf"), "scan.wf"), wt: finN(own(sc, "wt"), "scan.wt") };
      out.src = {}; SRC_KEYS.forEach(k => { const v = own(sr, k); out.src[k] = v === undefined ? "" : strN(v, 200, "src." + k); });
      out.th = {}; Object.keys(th0).sort().forEach(k => { if (SCAN_TH.indexOf(k) >= 0 || TH_BD.test(k)) out.th[k] = finN(own(th0, k), "th." + k); });
      const nrec = n => {
        need(isObj(n), "notam");
        const o = { id: idN(own(n, "id"), "notam.id"), k: oneN(own(n, "k"), ["c", "o"], "notam.k"), f: finN(own(n, "f"), "notam.f"), t: finN(own(n, "t"), "notam.t", 0), d: finN(own(n, "d"), "notam.d", -1), e: finN(own(n, "e"), "notam.e", 0), r: oneN(own(n, "r"), ["o", "n", "x"], "notam.r") };
        const lo = own(n, "lo"), up = own(n, "up"); need((lo === null || num(lo)) && (up === null || num(up)), "notam.q"); o.lo = lo; o.up = up;
        o.g = hexN(own(n, "g"), "notam.g"); o.h = hexN(own(n, "h"), "notam.h"); o.x = strN(own(n, "x"), 100, "notam.x"); return o;
      };
      const known = arrN(own(nt, "known"), LIMITS.known, "known").map(x => idN(x, "known.id"));
      out.notams = {
        total: finN(own(nt, "total"), "notams.total", 0), valid: finN(own(nt, "valid"), "notams.valid", 0), known: uniqN(known, x => x, "known"),
        hits: uniqN(arrN(own(nt, "hits"), LIMITS.hits, "hits").map(nrec), x => x.id, "hits"),
        rc: arrN(own(nt, "rc"), LIMITS.rc, "rc").map(x => { need(Array.isArray(x) && x.length === 3, "rc"); return [idN(x[0], "rc.id"), oneN(x[1], ["R", "C"], "rc.t"), idN(x[2], "rc.ref")]; })
      };
      out.zones = uniqN(arrN(g("zones"), LIMITS.zones, "zones").map(z => {
        need(isObj(z), "zone");
        return { id: idN(own(z, "id"), "zone.id"), s: oneN(own(z, "s"), ["a17", "b09", "inpa"], "zone.s"), c: strN(own(z, "c"), 12, "zone.c"), n: strN(own(z, "n"), 60, "zone.n"), d: finN(own(z, "d"), "zone.d", 0), e: finN(own(z, "e"), "zone.e", 0), in: oneN(own(z, "in"), [0, 1], "zone.in"), a: strN(own(z, "a"), 100, "zone.a"), g: hexN(own(z, "g"), "zone.g"), h: hexN(own(z, "h"), "zone.h") };
      }), z => z.s + ":" + z.id, "zones");
      out.zex = arrN(g("zex"), LIMITS.zones, "zex").map(x => idN(x, "zex.id"));
      out.items = uniqN(arrN(g("items"), LIMITS.items, "items").map(i => {
        need(isObj(i), "item");
        const n = finN(own(i, "n"), "item.n", 1); need(Number.isInteger(n), "item.n");
        return { k: idN(own(i, "k"), "item.k", 120), i: arrN(own(i, "i"), 5, "item.i").map(x => idN(x, "item.i")), n, t: strN(own(i, "t"), 80, "item.t"), z: oneN(own(i, "z"), ["i", "r", "n"], "item.z"), d: finN(own(i, "d"), "item.d", 0), c: strN(own(i, "c"), 12, "item.c"), h: hexN(own(i, "h"), "item.h"), x: hexN(own(i, "x"), "item.x") };
      }), i => i.k, "items");
      out.oth = {
        borders: uniqN(arrN(own(oh, "borders"), LIMITS.borders, "borders").map(b => { need(isObj(b), "border"); return { iso: idN(own(b, "iso"), "border.iso"), d: finN(own(b, "d"), "border.d", 0), v: oneN(own(b, "v"), [0, 1], "border.v") }; }), b => b.iso, "borders"),
        air: uniqN(arrN(own(oh, "air"), LIMITS.air, "air").map(a => { need(isObj(a), "air"); return { id: idN(own(a, "id"), "air.id"), d: finN(own(a, "d"), "air.d", 0), t: strN(own(a, "t"), 20, "air.t"), n: strN(own(a, "n"), 60, "air.n") }; }), a => a.id, "air"),
        agri: uniqN(arrN(own(oh, "agri"), LIMITS.agri, "agri").map(a => { need(isObj(a), "agri"); return { n: idN(own(a, "n"), "agri.n"), d: finN(own(a, "d"), "agri.d", 0) }; }), a => a.n, "agri")
      };
      out.capped = { items: finN(own(cp, "items"), "capped.items", 0), known: finN(own(cp, "known"), "capped.known", 0) };
      return { ok: true, snapshot: out };
    } catch (e) {
      if (e instanceof SnapErr) return { ok: false, reason: "malformed", detail: e.message };
      throw e;
    }
  }

  /* ================= השוואה ================= */
  const SEV_RANK = { high: 0, mid: 1, low: 2 };
  const rowSort = (a, b) => (SEV_RANK[a.sev] - SEV_RANK[b.sev]) || ((a.d == null || a.d < 0 ? Infinity : a.d) - (b.d == null || b.d < 0 ? Infinity : b.d)) || cmp(a.id, b.id);
  const scanFields = (p, c) => {
    const f = [];
    if (Math.abs(p.lat - c.lat) > 1e-6 || Math.abs(p.lon - c.lon) > 1e-6) f.push("point");
    if (Math.abs(p.R - c.R) > 1e-6) f.push("radius");
    if (Math.abs(p.ft - c.ft) > 0.01) f.push("height");
    if (p.wf !== c.wf || p.wt !== c.wt) f.push("window");
    return f;
  };
  const tms = iso => { const t = Date.parse(iso); return isFinite(t) ? t : NaN; };

  function notamFields(p, c) {
    const f = [];
    if (p.k !== c.k) f.push("kind");
    if (p.f !== c.f || p.t !== c.t) f.push("window");
    if (p.g !== c.g) f.push("geometry");
    if (p.lo !== c.lo || p.up !== c.up) f.push("height");
    if (p.h !== c.h) f.push("text");
    return f;
  }
  const sevNotam = n => (n.r === "o" ? "high" : "mid");   // חופף לסגירה — גבוהה; בקרבה או בלי מיקום — בינונית (לא מחליטים בשם הטייס)
  const sevItem = i => (i.z === "i" ? (i.c === "census" ? "mid" : "high") : "mid");

  function diffSnapshots(prev, cur, opts) {
    opts = opts || {};
    const eps = num(opts.eps) ? opts.eps : 10, epsPct = num(opts.epsPct) ? opts.epsPct : 5, slack = num(opts.osmSlackMs) ? opts.osmSlackMs : 0;
    const exLimit = num(opts.excessive) ? opts.excessive : LIMITS.excessive;
    const fail = (reason, extra) => Object.assign({ comparable: false, reason }, extra || {});
    if (prev == null) return fail("no_baseline");
    const vp = cleanSnapshot(prev);
    if (!vp.ok) return fail(vp.reason === "version" ? "baseline_unsupported" : "bad_baseline", { detail: vp.detail || vp.reason });
    const vc = cleanSnapshot(cur);
    if (!vc.ok) return fail("bad_current", { detail: vc.detail || vc.reason });
    const P = vp.snapshot, K = vc.snapshot;
    const dates = { snapshotAt: P.at ? tms(P.at) : null, checkedAt: K.at ? tms(K.at) : null };
    if (dates.snapshotAt !== null && isNaN(dates.snapshotAt)) dates.snapshotAt = null;
    if (dates.checkedAt !== null && isNaN(dates.checkedAt)) dates.checkedAt = null;
    const sf = scanFields(P.scan, K.scan);
    if (sf.length) return fail("scan_mismatch", { scanChanged: sf, dates });
    const keys = Array.from(new Set(Object.keys(P.th).concat(Object.keys(K.th)))).sort();
    const cc = keys.filter(k => P.th[k] !== K.th[k]);
    if (cc.length) return fail("thresholds_changed", { configChanged: cc, dates });
    // מקור שחדש בהגשה מהנוכחי (מראה Overpass ישן, קובץ נוטמים ישן ממטמון) היה מציג "הוסר" לדברים שנוספו אחרי ההגשה — לכן אין השוואה
    for (const [k, why] of [["ni", "stale_notams"], ["ob", "stale_osm"], ["of", "stale_osm"], ["ox", "stale_osm"]]) {
      const p = tms(P.src[k]), c = tms(K.src[k]), must = k === "ni" || k === "ob";
      if ((must && (isNaN(p) || isNaN(c))) || (!isNaN(p) && isNaN(c))) return fail("no_source_time", { feed: k, dates });
      if (!isNaN(p) && !isNaN(c) && c + slack < p) return fail(why, { feed: k, before: P.src[k], after: K.src[k], dates });
    }
    const nowMs = num(opts.now) ? opts.now : dates.checkedAt === null ? NaN : dates.checkedAt;

    const rows = { notams: [], zones: [], items: [], other: [] }, stat = {};
    const pushRow = (cat, r) => { r.cat = cat; rows[cat].push(r); };

    /* --- נוטמים --- */
    {
      const pm = new Map(P.notams.hits.map(x => [x.id, x])), cm = new Map(K.notams.hits.map(x => [x.id, x]));
      const knownP = new Set(P.notams.known), knownC = new Set(K.notams.known), knownOk = !P.capped.known && !K.capped.known;
      const added = K.notams.hits.filter(x => !pm.has(x.id)), removed = P.notams.hits.filter(x => !cm.has(x.id));
      const addedIds = new Set(added.map(x => x.id)), paired = new Set();
      const rcBy = (ref, type) => K.notams.rc.filter(x => x[2] === ref && x[1] === type).map(x => x[0]).sort(cmp)[0];
      let unchanged = 0;
      K.notams.hits.forEach(c => {
        const p = pm.get(c.id); if (!p) return;
        const f = notamFields(p, c);
        if (!f.length) { unchanged++; return; }
        pushRow("notams", { status: "changed", cls: "changed", sev: sevNotam(c), id: c.id, title: c.x, fields: f, before: p, after: c, d: c.d });
      });
      removed.forEach(x => {
        const cid = rcBy(x.id, "C"), rid = rcBy(x.id, "R");
        if (cid) { pushRow("notams", { status: "cancelled", cls: "removed", sev: "low", id: x.id, title: x.x, by: cid, before: x, after: null, d: x.d }); return; }
        if (rid) {
          const y = cm.get(rid);
          if (y && addedIds.has(rid) && !paired.has(rid)) {
            paired.add(rid);
            pushRow("notams", { status: "replaced", cls: "changed", sev: sevNotam(y), id: y.id, title: y.x, replaces: x.id, fields: notamFields(x, y), before: x, after: y, d: y.d });
          } else pushRow("notams", { status: "replaced", cls: "removed", sev: "low", id: x.id, title: x.x, by: rid, counted: !!y, before: x, after: null, d: x.d });
          return;
        }
        let st;
        if (knownC.has(x.id) && knownOk) st = "out";
        else if (!knownOk) st = "gone";
        else if (!isNaN(nowMs)) st = (x.t === 0 || x.t > nowMs) ? "withdrawn" : "expired";
        else st = "gone";
        pushRow("notams", { status: st, cls: "removed", sev: "low", id: x.id, title: x.x, before: x, after: null, d: x.d });
      });
      added.forEach(y => {
        if (paired.has(y.id)) return;
        const rep = K.notams.rc.filter(x => x[0] === y.id && x[1] === "R").map(x => x[2])[0];
        pushRow("notams", { status: !knownOk ? "added" : knownP.has(y.id) ? "entered" : "new", cls: "added", sev: sevNotam(y), id: y.id, title: y.x, replaces: rep || undefined, before: null, after: y, d: y.d });
      });
      stat.notams = { checked: new Set(P.notams.hits.map(x => x.id).concat(K.notams.hits.map(x => x.id))).size, unchanged };
    }

    /* --- אזורים --- */
    {
      const zk = z => z.s + ":" + z.id, pm = new Map(P.zones.map(z => [zk(z), z])), cm = new Map(K.zones.map(z => [zk(z), z])), exC = new Set(K.zex);
      let unchanged = 0;
      K.zones.forEach(c => {
        const p = pm.get(zk(c));
        if (!p) { pushRow("zones", { status: "entered", cls: "added", sev: c.in ? "high" : "mid", id: c.id, title: c.n, before: null, after: c, d: c.d }); return; }
        const f = [];
        if (p.h !== c.h) f.push("text"); if (p.g !== c.g) f.push("geometry"); if (p.in !== c.in) f.push("inside"); if (Math.abs(p.d - c.d) >= eps) f.push("distance");
        if (!f.length) { unchanged++; return; }
        pushRow("zones", { status: "changed", cls: "changed", sev: c.in ? "high" : "mid", id: c.id, title: c.n, fields: f, before: p, after: c, d: c.d });
      });
      P.zones.forEach(p => { if (!cm.has(zk(p))) pushRow("zones", { status: p.s === "b09" && exC.has(p.id) ? "excluded" : "left", cls: "removed", sev: "low", id: p.id, title: p.n, before: p, after: null, d: p.d }); });
      stat.zones = { checked: new Set(P.zones.map(zk).concat(K.zones.map(zk))).size, unchanged };
    }

    /* --- פריטי OSM --- */
    {
      let pl = P.items, cl = K.items, reliability = "ok";
      if (P.capped.items || K.capped.items) {
        // רשימה שנחתכה: משווים רק מה שבטוח נמצא בשתיהן (קרוב מהנקודה שבה נחתכה הקצרה); הקטגוריה מסומנת חלקית
        const cut = [P, K].filter(s => s.capped.items && s.items.length).map(s => Math.max.apply(null, s.items.map(i => i.d)));
        if (cut.length) { const lim = Math.min.apply(null, cut); pl = pl.filter(i => i.d < lim); cl = cl.filter(i => i.d < lim); }
        reliability = "capped";
      }
      const pm = new Map(pl.map(i => [i.k, i])), cm = new Map(cl.map(i => [i.k, i]));
      const pairs = [], pu = pl.filter(p => !cm.has(p.k)), cu = cl.filter(c => !pm.has(c.k));
      cl.forEach(c => { const p = pm.get(c.k); if (p) pairs.push([p, c]); });
      // מפתח שהשתנה (תווית/שם) עם אותו אלמנט OSM: התאמה לפי מזהים משותפים — רק כשהיא חד-חד-ערכית. אחרת לא מנחשים: נעלם + חדש
      const share = (a, b) => a.i.some(x => b.i.indexOf(x) >= 0);
      const lostP = new Set(), lostC = new Set();
      cu.forEach(c => {
        const ps = pu.filter(p => !lostP.has(p) && share(p, c)); if (ps.length !== 1) return;
        const cs = cu.filter(c2 => !lostC.has(c2) && share(ps[0], c2)); if (cs.length !== 1) return;
        pairs.push([ps[0], c]); lostP.add(ps[0]); lostC.add(c);
      });
      let unchanged = 0;
      pairs.forEach(([p, c]) => {
        const f = [];
        const single = p.n === 1 && c.n === 1;   // תכונות וכותרת נבדקות רק בפריט של אלמנט יחיד (ראו snapshotOf)
        if (p.h !== c.h || (single && p.x !== c.x)) f.push("tags"); if (single && p.t !== c.t) f.push("title"); if (p.z !== c.z) f.push("zone");
        if (Math.abs(p.d - c.d) >= Math.max(eps, p.d * epsPct / 100)) f.push("distance");
        if (!f.length) { unchanged++; return; }
        const only = f.length === 1 && f[0] === "distance";
        pushRow("items", { status: only ? (c.d < p.d ? "closer" : "farther") : "changed", cls: "changed", sev: sevItem(c), id: c.k, title: c.t, fields: f, before: p, after: c, d: c.d });
      });
      cu.forEach(c => { if (!lostC.has(c)) pushRow("items", { status: "added", cls: "added", sev: sevItem(c), id: c.k, title: c.t, before: null, after: c, d: c.d }); });
      pu.forEach(p => { if (!lostP.has(p)) pushRow("items", { status: "removed", cls: "removed", sev: "low", id: p.k, title: p.t, before: p, after: null, d: p.d }); });
      stat.items = { checked: pairs.length + pu.filter(p => !lostP.has(p)).length + cu.filter(c => !lostC.has(c)).length, unchanged, reliability };
    }

    /* --- אחר: גבולות, שדות תעופה, מנחתים חקלאיים --- */
    {
      let checked = 0, unchanged = 0;
      const part = (pl, cl, kf, sub, titleOf, changedFn, sevFn) => {
        const pm = new Map(pl.map(x => [kf(x), x])), cm = new Map(cl.map(x => [kf(x), x]));
        checked += new Set(pl.map(kf).concat(cl.map(kf))).size;
        cl.forEach(c => {
          const p = pm.get(kf(c));
          if (!p) { pushRow("other", { status: "added", cls: "added", sev: sevFn(c), sub, id: kf(c), title: titleOf(c), before: null, after: c, d: c.d }); return; }
          const f = changedFn(p, c);
          if (!f.length) { unchanged++; return; }
          pushRow("other", { status: "changed", cls: "changed", sev: sevFn(c), sub, id: kf(c), title: titleOf(c), fields: f, before: p, after: c, d: c.d });
        });
        pl.forEach(p => { if (!cm.has(kf(p))) pushRow("other", { status: "removed", cls: "removed", sev: "low", sub, id: kf(p), title: titleOf(p), before: p, after: null, d: p.d }); });
      };
      part(P.oth.borders, K.oth.borders, b => b.iso, "border", b => "גבול " + b.iso, (p, c) => { const f = []; if (p.v !== c.v) f.push("violates"); if (Math.abs(p.d - c.d) >= eps) f.push("distance"); return f; }, b => (b.v ? "high" : "mid"));
      part(P.oth.air, K.oth.air, a => a.id, "air", a => a.n || a.id, (p, c) => (Math.abs(p.d - c.d) >= eps ? ["distance"] : []), () => "mid");
      part(P.oth.agri, K.oth.agri, a => a.n, "agri", a => "מנחת חקלאי " + a.n, (p, c) => (Math.abs(p.d - c.d) >= eps ? ["distance"] : []), () => "mid");
      stat.other = { checked, unchanged };
    }

    Object.keys(rows).forEach(k => rows[k].sort(rowSort));
    const cnt = k => ({ added: rows[k].filter(r => r.cls === "added").length, removed: rows[k].filter(r => r.cls === "removed").length, changed: rows[k].filter(r => r.cls === "changed").length });
    const byCat = { notams: cnt("notams"), zones: cnt("zones"), items: cnt("items"), other: cnt("other") };
    const all = [].concat(rows.notams, rows.zones, rows.items, rows.other);
    const counts = { added: all.filter(r => r.cls === "added").length, removed: all.filter(r => r.cls === "removed").length, changed: all.filter(r => r.cls === "changed").length, total: all.length, high: all.filter(r => r.sev === "high").length, byCat };
    const srcRows = SRC_KEYS.map(k => {
      const a = P.src[k], b = K.src[k];
      if (!a && !b) return null;
      if (k === "pm") return null;   // pm = אותה מהדורה כמו ed בצורה מובנית; מוצגת רק ed
      if (k === "zh" || k === "cv") return { key: k, label: STR.srcLabel[k], before: "", after: a === b ? STR.unchangedWord : STR.updatedWord, changed: a !== b };
      const fmt = (k === "ni" || k === "ob" || k === "of" || k === "ox") ? (v => (v ? fmtDateTime(v) : "")) : (v => v);
      return { key: k, label: STR.srcLabel[k], before: fmt(a), after: fmt(b), changed: a !== b };
    }).filter(Boolean);
    return {
      comparable: true, dates, sources: srcRows,
      notams: Object.assign({ rows: rows.notams }, stat.notams), zones: Object.assign({ rows: rows.zones }, stat.zones), items: Object.assign({ rows: rows.items }, stat.items), other: Object.assign({ rows: rows.other }, stat.other),
      counts, anyChange: counts.total > 0, excessive: counts.total > exLimit,
      reliability: { items: stat.items.reliability, notams: P.capped.known || K.capped.known ? "capped" : "ok" }
    };
  }

  /* ================= בקשה שמורה: אימות ושחזור ================= */
  const inBox = (lat, lon) => num(lat) && num(lon) && lat >= 29 && lat <= 34 && lon >= 34 && lon <= 36.5;
  const okDate = s => { const d = typeof s === "string" ? C.parseDate(s) : null; if (!d || d.y < 2000 || d.y > 2100) return null; const t = new Date(Date.UTC(d.y, d.m - 1, d.d)); return t.getUTCFullYear() === d.y && t.getUTCMonth() === d.m - 1 && t.getUTCDate() === d.d ? d : null; };
  const okTime = s => { const m = typeof s === "string" ? /^(\d{1,2}):(\d{2})$/.exec(s) : null; return m && +m[1] < 24 && +m[2] < 60 ? String(+m[1]).padStart(2, "0") + ":" + m[2] : null; };
  const dayNum = d => Date.UTC(d.y, d.m - 1, d.d) / 86400000;

  // lenient: ערכים מספריים מחוץ לטווח נחתכים (שחזור לטופס); אחרת הם שגיאה (אימות). needDates: תאריכים ושעות הכרחיים
  function cleanInputs(raw, lenient, needDates, cfg) {
    const errors = [], trimmed = [], bad = f => errors.push(f);
    if (!isObj(raw)) return { inputs: null, errors: ["inputs"], trimmed };
    const g = k => own(raw, k), lim = (cfg && cfg.defaults) || {};
    const rmin = num(lim.min_radius_m) ? lim.min_radius_m : 10, rmax = num(lim.max_radius_m) ? lim.max_radius_m : 5000;
    const o = {};
    if (inBox(g("lat"), g("lon"))) { o.lat = g("lat"); o.lon = g("lon"); } else bad("coord");
    { const v = g("radius"); if (!num(v)) bad("radius"); else if (v >= rmin && v <= rmax) o.radius = v; else if (lenient) o.radius = Math.min(rmax, Math.max(rmin, Math.round(v))); else bad("radius"); }
    { const v = g("heightM"); if (!num(v) || v <= 0) bad("heightM"); else if (v <= 20000) o.heightM = v; else if (lenient) o.heightM = 20000; else bad("heightM"); }
    const df = okDate(g("dateFrom")), dt = okDate(g("dateTo")), tf = okTime(g("timeFrom")), tt = okTime(g("timeTo"));
    if (needDates) {
      if (!df) bad("dateFrom"); if (!dt) bad("dateTo");
      if (df && dt && (dayNum(dt) < dayNum(df) || dayNum(dt) - dayNum(df) > 60)) bad("dateTo");
      if (!tf) bad("timeFrom"); if (!tt) bad("timeTo");
    }
    o.dateFrom = df ? g("dateFrom") : ""; o.dateTo = dt ? g("dateTo") : ""; o.timeFrom = tf || ""; o.timeTo = tt || "";
    const txt = (k, max, multi) => { const v = g(k); if (v === undefined || v === null) return ""; if (typeof v !== "string") { bad(k); return ""; } const c = clean(v, 0, multi); if (Array.from(c).length > max) { trimmed.push(k); return Array.from(c).slice(0, max).join(""); } return c; };
    o.purpose = txt("purpose", C.PURPOSE_MAX || 300, false);
    { const v = g("aircraft"); o.aircraft = []; if (v !== undefined && v !== null) { if (!Array.isArray(v)) bad("aircraft"); else { if (v.length > LIMITS.aircraft) trimmed.push("aircraft"); v.slice(0, LIMITS.aircraft).forEach(a => { if (typeof a !== "string") bad("aircraft"); else { const c = clean(a, LIMITS.aircraftLen); if (c) o.aircraft.push(c); } }); } } }
    { const v = g("vlos"); if (v === undefined || v === null) o.vlos = false; else if (typeof v !== "boolean") { bad("vlos"); o.vlos = false; } else o.vlos = v; }
    o.siteName = txt("siteName", LIMITS.name, false);
    o.knownObstacles = txt("knownObstacles", LIMITS.obstacles, true);
    { const v = g("visitDate"); if (v === undefined || v === null || v === "") o.visitDate = ""; else if (okDate(v)) o.visitDate = v; else if (lenient) o.visitDate = ""; else bad("visitDate"); }
    o.visitNotes = txt("visitNotes", LIMITS.notes, true);
    { const v = g("manualItems"); o.manualItems = []; if (v !== undefined && v !== null) {
      // תוספות ידניות משפיעות על הסריקה — חריגה אינה נחתכת בשקט
      if (!Array.isArray(v) || v.length > LIMITS.manual) bad("manualItems");
      else v.forEach(m => {
        const name = isObj(m) && typeof own(m, "name") === "string" ? clean(own(m, "name"), LIMITS.name) : "", h = isObj(m) ? own(m, "heightM") : undefined;
        if (!name || !inBox(own(m, "lat"), own(m, "lon")) || !(h === undefined || h === null || (num(h) && h > 0 && h <= 20000))) { bad("manualItems"); return; }
        o.manualItems.push({ name, lat: own(m, "lat"), lon: own(m, "lon"), heightM: h == null ? null : h });
      });
    } }
    return { inputs: o, errors, trimmed };
  }

  const MAX_DECL = 40;
  function validateRecord(rec, cfg) {
    if (!isObj(rec)) return { ok: false, reason: "bad_record", errors: ["not_object"] };
    let size = 0;
    try { size = byteLen(JSON.stringify(rec)); } catch (e) { return { ok: false, reason: "bad_record", errors: ["unserializable"] }; }
    if (size > LIMITS.record) return { ok: false, reason: "too_big", errors: ["size"] };
    const g = k => own(rec, k), errors = [];
    const ci = cleanInputs(g("inputs"), false, true, cfg);
    ci.errors.forEach(e => errors.push(e));
    const out = { savedAt: "", site: "", version: "", edition: "", declaration: null, inputs: ci.inputs, zones: [], items: [], snapshot: null, snapshotStatus: "none", trimmed: ci.trimmed };
    { const v = g("savedAt"); if (v !== undefined && v !== null) { const t = typeof v === "string" ? Date.parse(v) : NaN; if (isFinite(t) && new Date(t).getUTCFullYear() >= 2000 && new Date(t).getUTCFullYear() <= 2100) out.savedAt = new Date(t).toISOString(); else errors.push("savedAt"); } }
    ["site", "version", "edition"].forEach(k => { const v = g(k); if (v === undefined || v === null) return; if (typeof v !== "string") errors.push(k); else out[k] = clean(v, k === "edition" ? 200 : k === "site" ? LIMITS.name : MAX_DECL); });
    { const d = g("declaration"); if (d !== undefined && d !== null) { if (!isObj(d)) errors.push("declaration"); else {
      const ver = own(d, "version"), at = own(d, "confirmedAt"), t = typeof at === "string" ? Date.parse(at) : NaN;
      out.declaration = { version: typeof ver === "string" || num(ver) ? clean(ver, MAX_DECL) : "", confirmedAt: isFinite(t) ? new Date(t).toISOString() : "" };
    } } }
    { const z = g("zones"); if (z !== undefined && z !== null) { if (!Array.isArray(z)) errors.push("zones"); else out.zones = z.slice(0, LIMITS.listZones).filter(x => isObj(x) && typeof own(x, "id") === "string" && num(own(x, "d"))).map(x => ({ id: clean(own(x, "id"), 80), d: own(x, "d") })).filter(x => x.id); } }
    { const z = g("items"); if (z !== undefined && z !== null) { if (!Array.isArray(z)) errors.push("items"); else out.items = z.slice(0, LIMITS.listItems).filter(x => isObj(x) && typeof own(x, "title") === "string" && num(own(x, "d"))).map(x => ({ n: num(own(x, "n")) ? own(x, "n") : 0, title: clean(own(x, "title"), 120), d: own(x, "d") })).filter(x => x.title); } }
    { const s = g("snapshot"); if (s !== undefined && s !== null) { const r = cleanSnapshot(s); if (r.ok) { out.snapshot = r.snapshot; out.snapshotStatus = "ok"; } else out.snapshotStatus = r.reason === "version" ? "unsupported" : "invalid"; } }
    if (errors.length) return { ok: false, reason: "bad_record", errors };
    return { ok: true, rec: out };
  }

  function restoreInputs(rec, opts) {
    opts = opts || {};
    const keep = !!opts.keepDates;
    const r = cleanInputs(isObj(rec) ? own(rec, "inputs") : null, true, keep, opts.cfg);
    if (!r.inputs || r.errors.length) return null;
    const o = r.inputs;
    return {
      lat: o.lat, lon: o.lon, radius: o.radius, heightM: o.heightM,
      dateFrom: keep ? o.dateFrom : "", dateTo: keep ? o.dateTo : "", timeFrom: keep ? o.timeFrom : "", timeTo: keep ? o.timeTo : "",
      purpose: o.purpose, aircraft: o.aircraft, vlos: o.vlos, siteName: o.siteName, knownObstacles: o.knownObstacles,
      visitDate: keep ? o.visitDate : "", visitNotes: o.visitNotes, manualItems: o.manualItems
    };
  }

  /* ================= מודל הסעיף ================= */
  const bannerText = sentAt => STR.banner + (fmtDate(sentAt) ? " ב-" + fmtDate(sentAt) : "") + ".";
  const distText = d => (d == null || d < 0 ? STR.noGeo : d < 1 ? STR.inside : C.fmtDist(d));
  const winText = n => fmtZ(n.f) + " – " + (n.t === 0 ? STR.perm : fmtZ(n.t));
  const hgtText = n => (n.lo == null && n.up == null) ? "" : C.fmtInt(n.lo == null ? 0 : n.lo) + "–" + C.fmtInt(n.up == null ? 0 : n.up) + " " + STR.feet;
  const ZONE3 = { i: STR.inZone, r: STR.ringZone, n: STR.nearZone };
  const ba = (label, b, a) => label + " — " + STR.before + ": " + (b === "" ? "—" : b) + " · " + STR.after + ": " + (a === "" ? "—" : a);

  function rowLines(r) {
    const L = [], p = r.before, c = r.after;
    if (r.cat === "notams") {
      if (r.status === "cancelled") L.push(STR.cancelBy + " " + r.by);
      else if (r.status === "replaced" && r.cls === "removed") L.push(STR.replacedBy + " " + r.by + (r.counted ? "" : " " + STR.notCounted));
      else if (c && !p) { L.push(STR.field.window + ": " + winText(c)); if (hgtText(c)) L.push(STR.field.height + ": " + hgtText(c)); if (r.replaces) L.push(STR.replaces + " " + r.replaces); }
      else if (p && !c) { L.push(STR.field.window + ": " + winText(p)); }
      if (r.cls === "changed") {
        if (r.replaces) L.push(STR.replaces + " " + r.replaces);
        (r.fields || []).forEach(f => {
          if (f === "window") L.push(ba(STR.field.window, winText(p), winText(c)));
          else if (f === "height") L.push(ba(STR.field.height, hgtText(p), hgtText(c)));
          else if (f === "kind") L.push(ba(STR.field.kind, p.k === "c" ? "סגירה" : "מכשול", c.k === "c" ? "סגירה" : "מכשול"));
          else L.push(STR.field[f] + " שונה");
        });
      }
    } else if (r.cat === "zones") {
      const sh = z => z.a ? z.a : "";
      if (c && !p) { if (sh(c)) L.push("גובה: " + sh(c)); L.push(c.in ? STR.inZone : STR.nearZone); }
      if (r.cls === "changed") (r.fields || []).forEach(f => {
        if (f === "text") L.push(sh(p) !== sh(c) ? ba("גובה", sh(p), sh(c)) : "הנוסח או התנאים של האזור שונו");
        else if (f === "geometry") L.push("גבול האזור שונה");
        else if (f === "inside") L.push(ba(STR.field.inside, p.in ? STR.inZone : STR.nearZone, c.in ? STR.inZone : STR.nearZone));
        else if (f === "distance") L.push(ba(STR.field.distance, distText(p.d), distText(c.d)));
      });
      if (p && !c && sh(p)) L.push("גובה: " + sh(p));
    } else if (r.cat === "items") {
      if (c && !p) L.push(ZONE3[c.z]);
      if (r.cls === "changed") (r.fields || []).forEach(f => {
        if (f === "title") L.push(ba(STR.field.title, p.t, c.t));
        else if (f === "tags") L.push("תכונות הפריט ב-OpenStreetMap שונו");
        else if (f === "zone") L.push(ba(STR.field.zone, ZONE3[p.z], ZONE3[c.z]));
        else if (f === "distance") L.push(ba(STR.field.distance, distText(p.d), distText(c.d)));
      });
      if (p && !c) L.push(ZONE3[p.z]);
    } else {
      if (r.cls === "changed") (r.fields || []).forEach(f => {
        if (f === "violates") L.push(ba(STR.field.violates, p.v ? "כן" : "לא", c.v ? "כן" : "לא"));
        else if (f === "distance") L.push(ba(STR.field.distance, distText(p.d), distText(c.d)));
      });
      if (c && !p && r.sub === "border" && c.v) L.push(STR.field.violates);
    }
    return L;
  }
  const statusLabel = r => {
    const grp = r.cat === "notams" ? "notam" : r.cat === "zones" ? "zone" : r.cat === "items" ? "item" : "other";
    return (STR.status[grp][r.status] || r.status);
  };
  const rowModel = r => ({
    status: r.status, cls: r.cls, sev: r.sev, statusLabel: statusLabel(r), sevLabel: STR.sev[r.sev] || "", id: r.cat === "items" ? "" : r.id, title: r.title || (r.cat === "items" ? r.id : ""),
    lines: rowLines(r), dist: distText(r.d)
  });

  // "נבדקו — נוטמים: 14 · אזורים: 3 · פריטים: 20. לא השתנו — …": ספירות ולא "אין שינוי" סתמי (וגם בלי הטיות מספר)
  const checkedLine = (d, withUnchanged) => "נבדקו — נוטמים: " + d.notams.checked + " · אזורים: " + d.zones.checked + " · פריטים: " + d.items.checked + "." +
    (withUnchanged ? " לא השתנו — נוטמים: " + d.notams.unchanged + " · אזורים: " + d.zones.unchanged + " · פריטים: " + d.items.unchanged + "." : "");

  function sinceModel(diff, ctx) {
    ctx = ctx || {};
    const maxRows = num(ctx.maxRows) && ctx.maxRows >= 0 ? Math.floor(ctx.maxRows) : LIMITS.rowsScreen;
    const sentMs = toMs(ctx.sentAt), chkMs = toMs(ctx.checkedAt != null ? ctx.checkedAt : diff && diff.dates && diff.dates.checkedAt != null ? diff.dates.checkedAt : NaN);
    const act = ctx.activity || {};
    const m = { kind: "", title: STR.title, banner: { text: bannerText(sentMs), sub: STR.bannerSub, resend: ctx.resendNote === false ? "" : STR.resend }, dates: [], summary: "", checkedLine: "", limitation: STR.limit, notes: [], sources: [], sections: [], counts: null };
    if (!isNaN(sentMs)) m.dates.push({ label: STR.submitted, value: fmtDateTime(sentMs) });
    if (!isNaN(chkMs)) m.dates.push({ label: STR.checked, value: fmtDateTime(chkMs) });
    if (act.dateFrom) {
      const a = ymd(act.dateFrom), b = ymd(act.dateTo || act.dateFrom), t = act.timeFrom && act.timeTo ? " " + act.timeFrom + "–" + act.timeTo : "";
      if (a) m.dates.push({ label: STR.activity, value: (a === b || !b ? a : a + " עד " + b) + t });
    }
    if (!diff || diff.comparable !== true) {
      const reason = diff && diff.reason ? diff.reason : "no_baseline";
      m.kind = (reason === "no_baseline" || reason === "bad_baseline" || reason === "baseline_unsupported") ? "nobase" : "blocked";
      m.reason = reason;
      if (reason === "thresholds_changed") m.summary = "הגדרות הסריקה של המערכת השתנו מאז ההגשה (" + ((diff && diff.configChanged) || []).map(k => TH_LABEL[k] || (TH_BD.test(k) ? "גבול " + k.slice(3) : k)).join(", ") + "), ולכן אי אפשר להשוות באופן אמין.";
      else if (reason === "stale_notams") m.summary = "קובץ הנוטמים שנטען (" + fmtDateTime(diff.after) + ") ישן מזה שבהגשה (" + fmtDateTime(diff.before) + "), ולכן אי אפשר להשוות. נסו שוב אחרי העדכון הבא.";
      else if (reason === "stale_osm") m.summary = "נתוני OpenStreetMap שנטענו (" + fmtDateTime(diff.after) + ") ישנים מאלה שבהגשה (" + fmtDateTime(diff.before) + "), ולכן אי אפשר להשוות. נסו שוב בעוד כמה דקות.";
      else m.summary = REASON_TEXT[reason] || STR.badBase;
      return m;
    }
    const c = diff.counts;
    m.counts = c;
    const cats = ["notams", "zones", "items", "other"];
    if (!c.total) {
      m.kind = "none"; m.summary = STR.none;
      m.checkedLine = checkedLine(diff, true);
    } else {
      m.kind = "changes";
      const parts = ["notams", "zones", "items"].map(k => STR.catShort[k] + " " + (c.byCat[k].added + c.byCat[k].removed + c.byCat[k].changed));
      const oth = c.byCat.other.added + c.byCat.other.removed + c.byCat.other.changed; if (oth) parts.push(STR.catShort.other + " " + oth);
      m.summary = (c.total === 1 ? "נמצא שינוי אחד" : "נמצאו " + c.total + " שינויים") + ": " + parts.join(" · ") + (c.high ? " (" + STR.sev.high + ": " + c.high + ")" : "");
      m.checkedLine = checkedLine(diff, false);
    }
    if (diff.excessive) m.notes.push(STR.excessive);
    if (diff.reliability.items === "capped") m.notes.push(STR.capped);
    if (diff.reliability.notams === "capped") m.notes.push(STR.cappedKnown);
    if (diff.items.rows.length || diff.items.checked) m.notes.push(STR.osm);
    m.sources = diff.sources.map(s => ({ label: s.label, before: s.before, after: s.after, changed: s.changed }));
    cats.forEach(k => {
      const rs = diff[k].rows.map(rowModel);
      if (!rs.length) return;
      m.sections.push({ key: k, title: STR.cat[k], total: rs.length, rows: rs.slice(0, maxRows), rest: rs.slice(maxRows), hidden: Math.max(0, rs.length - maxRows) });
    });
    return m;
  }

  /* ================= HTML (כל ערך דינמי עובר E) ================= */
  const S_BANNER = "background:#fff3cd;color:#4a3500;border:2px solid #e0a800;border-radius:10px;padding:10px 14px;margin:8px 0;font-weight:700;line-height:1.7";
  const S_TBL = "width:100%;border-collapse:collapse;margin:4px 0 10px", S_CELL = "border:1px solid #999;padding:5px 7px;text-align:right;vertical-align:top";
  const bannerBox = (text, sub, resend) => '<div class="rc-banner" role="note" style="' + S_BANNER + '">' + E(text) + " " + E(sub) + (resend ? '<div style="font-weight:400;margin-top:4px">' + E(resend) + "</div>" : "") + "</div>";
  const bannerHtml = (sentAt, opts) => bannerBox(bannerText(sentAt), STR.bannerSub, opts && opts.resendNote === false ? "" : STR.resend);
  function rowsHtml(rows) {
    return '<table class="rc-table" style="' + S_TBL + '"><thead><tr>' + STR.cols.map(h => '<th scope="col" style="' + S_CELL + ';background:#eee;color:#222">' + E(h) + "</th>").join("") + "</tr></thead><tbody>" +
      rows.map(r => {
        const hi = r.sev === "high";
        return '<tr data-sev="' + E(r.sev) + '"><td style="' + S_CELL + (hi ? ";font-weight:700;color:#b00020" : "") + '">' + E(r.statusLabel) + (r.sevLabel ? '<br><span style="font-weight:700">' + E(r.sevLabel) + "</span>" : "") + "</td>" +
          '<td style="' + S_CELL + '">' + (r.id ? "<b>" + E(r.id) + "</b> " : "") + E(r.title) + "</td>" +
          '<td style="' + S_CELL + '">' + r.lines.map(E).join("<br>") + "</td>" +
          '<td style="' + S_CELL + '">' + E(r.dist) + "</td></tr>";
      }).join("") + "</tbody></table>";
  }
  function sinceHtml(m) {
    if (!m || typeof m !== "object") return "";
    let h = '<section class="rc-since" dir="rtl" aria-label="' + E(STR.title) + '"><h3 style="margin:4px 0">' + E(m.title) + "</h3>";
    h += bannerBox(m.banner.text, m.banner.sub, m.banner.resend);
    if (m.dates.length) h += '<p class="rc-dates" style="margin:6px 0">' + m.dates.map(d => E(d.label) + ": <b>" + E(d.value) + "</b>").join(" · ") + "</p>";
    h += '<p class="rc-summary" role="status" style="margin:6px 0;font-weight:700">' + E(m.summary) + "</p>";
    if (m.checkedLine) h += '<p class="rc-checked" style="margin:4px 0">' + E(m.checkedLine) + "</p>";
    m.notes.forEach(n => { h += '<p class="rc-note" style="margin:4px 0;font-size:90%">' + E(n) + "</p>"; });
    if (m.sources.length) {
      h += '<table class="rc-sources" style="' + S_TBL + '"><caption style="text-align:right;font-weight:700">' + E(STR.sources) + "</caption><thead><tr>" + STR.srcCols.map(c => '<th scope="col" style="' + S_CELL + ';background:#eee;color:#222">' + E(c) + "</th>").join("") + "</tr></thead><tbody>" +
        m.sources.map(s => '<tr><td style="' + S_CELL + '">' + E(s.label) + '</td><td style="' + S_CELL + '">' + E(s.before) + '</td><td style="' + S_CELL + (s.changed ? ";font-weight:700" : "") + '">' + E(s.after) + "</td></tr>").join("") + "</tbody></table>";
    }
    m.sections.forEach(s => {
      h += '<h4 style="margin:10px 0 2px">' + E(s.title) + " (" + s.total + ")</h4>" + rowsHtml(s.rows);
      if (s.rest.length) h += '<details class="rc-more"><summary>' + E(STR.more) + " (" + s.rest.length + ")</summary>" + rowsHtml(s.rest) + "</details>";
    });
    h += '<p class="rc-limit" style="margin:8px 0;font-size:90%">' + E(m.limitation) + "</p></section>";
    return h;
  }

  /* ================= "הצג בקשה": סיכום קריאה-בלבד ================= */
  function requestModel(rec, ctx) {
    ctx = ctx || {};
    const v = validateRecord(rec, ctx.cfg);
    if (!v.ok) return { ok: false, reason: v.reason, text: "הנתונים השמורים של הבקשה אינם תקינים, ולכן אי אפשר להציגם." };
    const r = v.rec, i = r.inputs, rows = [];
    const add = (label, value) => { if (value !== "" && value != null) rows.push({ label, value: String(value) }); };
    add("שם האתר", i.siteName || r.site);
    const a = ymd(i.dateFrom), b = ymd(i.dateTo);
    add("מועד", (a === b ? a : a + " עד " + b) + " · " + i.timeFrom + "–" + i.timeTo + " (שעון מקומי)");
    add("נקודת מרכז", i.lat.toFixed(6) + ", " + i.lon.toFixed(6));
    add("רדיוס", C.fmtInt(Math.round(i.radius)) + " מ׳");
    add("גובה", C.trimNum(i.heightM, 2) + " מ׳ (" + (i.heightM * C.M2FT).toFixed(1) + " רגל) מעפ״ש");
    add("מהות הפעילות", i.purpose);
    add("כלי טיס", i.aircraft.join(", "));
    add("טיסה בקשר עין (VLOS)", i.vlos ? "כן" : "לא");
    add("מכשולים שידועים למבקש", i.knownObstacles);
    add("תאריך הסיור באתר", ymd(i.visitDate));
    add("הערות המבקש", i.visitNotes);
    add("נשמרה", fmtDateTime(r.savedAt));
    add("הצהרת המבקש אושרה", r.declaration && r.declaration.confirmedAt ? fmtDateTime(r.declaration.confirmedAt) : "");
    add("גרסת מפה ומהדורה", [r.version, r.edition].filter(Boolean).join(" · "));
    if (!isNaN(toMs(ctx.sentAt))) add("נשלחה", fmtDateTime(ctx.sentAt));
    return {
      ok: true, title: ctx.name ? "הבקשה: " + clean(ctx.name, LIMITS.name) : "הבקשה השמורה", rows,
      manual: i.manualItems.map(x => x.name + (x.heightM ? " · גובה " + C.trimNum(x.heightM, 2) + " מ׳" : "") + " (" + x.lat.toFixed(6) + ", " + x.lon.toFixed(6) + ")"),
      zones: r.zones.map(z => z.id + " — " + distText(z.d)), items: r.items.map(x => (x.n ? x.n + ". " : "") + x.title + " — " + distText(x.d)),
      snapshotStatus: r.snapshotStatus, note: "תצוגה לקריאה בלבד של מה שנשמר בהגשה. פרטי המבקש אינם נשמרים בקובץ זה."
    };
  }
  function requestHtml(m) {
    if (!m || typeof m !== "object") return "";
    if (!m.ok) return '<p class="rc-request" role="alert">' + E(m.text) + "</p>";
    let h = '<section class="rc-request" dir="rtl"><h3 style="margin:4px 0">' + E(m.title) + '</h3><table style="' + S_TBL + '"><tbody>' +
      m.rows.map(r => '<tr><th scope="row" style="' + S_CELL + ';width:32%;background:#eee;color:#222">' + E(r.label) + '</th><td style="' + S_CELL + ';white-space:pre-line">' + E(r.value) + "</td></tr>").join("") + "</tbody></table>";
    const list = (t, a) => a.length ? "<h4 style=\"margin:8px 0 2px\">" + E(t) + " (" + a.length + ")</h4><ul style=\"margin:0 18px\">" + a.map(x => "<li>" + E(x) + "</li>").join("") + "</ul>" : "";
    h += list("תוספות שהוזנו ידנית", m.manual) + list("אזורים שנמצאו", m.zones) + list("מכשולים ותשתיות שנמצאו", m.items);
    return h + '<p class="rc-note" style="margin:8px 0;font-size:90%">' + E(m.note) + "</p></section>";
  }

  /* ================= עדכון בקשה: נושא וגוף המייל ================= */
  const PREFIX_RE = /^\s*\[עדכון לבקשה[^\]]*\]\s*/;
  function updateSubjectPrefix(sentAt) { const d = fmtDate(sentAt); return d ? "[עדכון לבקשה מ-" + d + "] " : "[עדכון לבקשה קודמת] "; }
  function updateBodyLine(sentAt) { const d = fmtDate(sentAt); return d ? "בקשה זו מחליפה את הבקשה שנשלחה ב-" + d + "." : "בקשה זו מחליפה את הבקשה הקודמת שנשלחה."; }
  function updateMail(mail, sentAt) {
    const m = Object.assign({}, mail), line = updateBodyLine(sentAt);
    m.subject = updateSubjectPrefix(sentAt) + String(mail.subject == null ? "" : mail.subject).replace(PREFIX_RE, "");
    let body = String(mail.body == null ? "" : mail.body);
    if (body.indexOf(line) < 0) {
      const lines = body.split("\n"), at = lines.findIndex(l => /^מצורפת בקשה/.test(l));
      if (at >= 0) lines[at] = lines[at].replace(/^מצורפת בקשה(?! מעודכנת)/, "מצורפת בקשה מעודכנת") + " " + line;
      else { const g = lines.findIndex(l => l.trim() === ""); lines.splice(g >= 0 ? g + 1 : 0, 0, line, ""); }
      body = lines.join("\n");
    }
    m.body = body;
    if (typeof mail.mailto === "string" && mail.to) m.mailto = "mailto:" + [].concat(mail.to).join(",") + "?subject=" + encodeURIComponent(m.subject) + "&body=" + encodeURIComponent(m.body);
    return m;
  }

  return {
    VERSION, LIMITS, STR, SCAN_TH, enabled, optsFromCfg, snapshotOf, cleanSnapshot, diffSnapshots, validateRecord, restoreInputs,
    sinceModel, sinceHtml, bannerText, bannerHtml, requestModel, requestHtml, updateSubjectPrefix, updateBodyLine, updateMail, fmtDate, fmtDateTime, clean
  };
});
