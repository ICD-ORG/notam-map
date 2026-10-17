/* שכבות מידע על מפת הבקשות: אזורי איסור (פמ״ת א-17, פרק ב-09, שמורות וגנים של רט״ג) ונוטמים, ופס סיכום לנקודה שנבחרה.
   לוגיקה טהורה (בלי DOM ובלי Leaflet): רצה בדפדפן וגם ב-Node, כדי שאפשר לבדוק אותה; הציור עצמו (Leaflet) והפס נמצאים ב-ui.js.
   התצוגה מידעית בלבד: היא קוראת את אותן פונקציות חישוב של הבדיקות המלאות (analyzeZones/analyzeNotams, notamGeometry, notamWindow, notamKind)
   אבל אינה כותבת שום מצב ואינה נוגעת בשער "מוכן לשליחה" (C.gate/REQUIRED_CHECKS) — ההכרעה נשארת בבדיקות המלאות ("הרץ את כל הבדיקות"). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./core.js"));
  else root.ReqLayers = factory(root.ReqCore);
})(typeof self !== "undefined" ? self : this, function (C) {
  "use strict";
  const E = C.esc;

  /* ================= העדפות המשתמש (localStorage — נוחות בלבד, לא מצב של הבקשה) ================= */
  const KEY = "icd_req_layers_v1";
  function parsePrefs(raw) {   // ברירת מחדל: שני המתגים דולקים; ערך פגום/חסר לא מכבה כלום
    const d = { zones: true, notams: true };
    try { const o = JSON.parse(raw); if (o && typeof o === "object") { if (typeof o.zones === "boolean") d.zones = o.zones; if (typeof o.notams === "boolean") d.notams = o.notams; } } catch (e) { /* ברירת מחדל */ }
    return d;
  }
  const serializePrefs = p => JSON.stringify({ zones: !!(p && p.zones), notams: !!(p && p.notams) });

  /* ================= צבעים ומקרא ================= */
  // אדום/כתום-אדום כמו בתמונות המפה (mapimg.js) ובמפת החברים; ב-09 בכחול כמו בהדמיה; רט״ג ונוטמים בגוונים נפרדים שאינם ירוק/כתום (שמורים לטבעות הסגירה)
  const COLORS = {
    a17: { line: "#ff3b30", name: "א-17 (אסור/מוגבל)" },
    b09: { line: "#3b82f6", name: "ב-09 (אזורי טיסה לכטב״ם)" },
    inpa: { line: "#a855f7", name: "שמורות וגנים (רט״ג)" },
    notam: { line: "#ffd400", name: "נוטמים" }
  };

  /* ================= צורות האזורים לציור ולבדיקת "מה בנקודה" ================= */
  // מחזיר צורה לכל אזור א-17 / ב-09 / אתר רט״ג עם גבול. rings בלבד לציור (אם אין — מעגל c+r כמו ב-mapimg.js). הטקסטים (kind/alt/label) זהים לאלה ש-analyzeZones מפיק
  const isB09 = z => z.cat === "B09" || z.cat === "B09B";
  const kindOf = z => isB09(z) ? (C.ZONE_KIND[z.cat] || z.cat).replace("(פרק ב-09)", "(פרק ב-09, " + (z.appendix || "") + ")").replace(", )", ")") : (C.ZONE_KIND[z.cat] || z.cat);
  const ORDER = { inpa: 0, b09: 1, a17: 2 };   // סדר ציור: שמורות מלמטה, אחריהן ב-09, ואזורי האיסור למעלה
  // גבול פגום בקובץ הנתונים (קואורדינטה שאינה מספר סופי, טבעת קצרה מ-3 נקודות) אינו מדולג בשקט — מפה שחסר בה אזור איסור ומוצגת כשלמה מטעה (כשל סגור):
  // השכבה כולה נחשבת לא זמינה (ui.js מציג הסבר ומשבית את המתג), והבדיקות המלאות אינן מושפעות. החריגה נושאת badId (מזהה האזור הפגום)
  const finite2 = p => Array.isArray(p) && p.length >= 2 && typeof p[0] === "number" && typeof p[1] === "number" && isFinite(p[0]) && isFinite(p[1]);
  const ringOk = r => Array.isArray(r) && r.length >= 3 && r.every(finite2);
  const badGeom = id => { const e = new Error("גבול לא תקין בנתוני האזור " + id); e.badId = id; return e; };
  const zoneLabel = (id, name) => name ? id + " ״" + name + "״" : id;   // אזור בלי שם (למשל LLR120) — בלי גרשיים ריקות; אותו כלל ב-core.js (analyzeZones)
  function zoneShapes(zdata, inpa) {
    const out = [];
    ((zdata && zdata.zones) || []).forEach(z => {
      let rings = null;
      if (z.rings != null && !Array.isArray(z.rings)) throw badGeom(z.id);
      if (z.rings && z.rings.length) { if (!z.rings.every(ringOk)) throw badGeom(z.id); rings = z.rings; }
      else if (z.c && z.r) { if (!finite2(z.c) || !(typeof z.r === "number" && isFinite(z.r) && z.r > 0)) throw badGeom(z.id); rings = [C.circlePoints(new C.Proj(z.c[0], z.c[1]), z.r, 96)]; }   // בלי rings: מעגל c+r כמו ב-mapimg.js
      if (!rings) return;   // אזור בלי גבול בקובץ: אינו מצויר
      const alt = z.alt || (z.min != null ? C.altRange(z) : "");
      out.push({ src: isB09(z) ? "b09" : "a17", id: z.id, name: z.name || "", cat: z.cat, kind: kindOf(z), alt, pmt: z.pmt || "", pmtRef: z.pmtRef || "", note: z.note || "",
        approx: !!z.approx, rings, label: isB09(z) ? z.id : zoneLabel(z.id, z.name), footnote: /¹/.test(alt + (z.pmt || "")) });
    });
    ((inpa && inpa.sites) || []).forEach(s => {
      if (!s.rings || !s.rings.length) return;   // אתר בלי גבול בקובץ (inpa.unmapped) אינו מצויר
      if (!Array.isArray(s.rings) || !s.rings.every(ringOk)) throw badGeom(s.id);
      out.push({ src: "inpa", id: s.id, name: s.name || "", cat: s.kind === "P" ? "NP" : "NR", kind: s.kind === "P" ? "גן לאומי (רט״ג)" : "שמורת טבע (רט״ג)",
        alt: "סגור להטסה מהקרקע ועד " + C.fmtInt(s.max) + " רגל מעפ״ש", pmt: "", pmtRef: "", note: s.note || "", approx: false, rings: s.rings, label: zoneLabel(s.id, s.name), footnote: false });
    });
    return out.sort((a, b) => ORDER[a.src] - ORDER[b.src]);
  }

  /* ================= מה נמצא בנקודה (לכרטיס בלחיצה) ================= */
  function ringHas(ring, lat, lon) {   // קרן אופקית; טבעות [lat,lon], סגורות או לא
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const yi = ring[i][0], xi = ring[i][1], yj = ring[j][0], xj = ring[j][1];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  const hitZones = (shapes, lat, lon) => (shapes || []).filter(sh => sh.rings.some(r => ringHas(r, lat, lon)));
  function notamHas(it, lat, lon) {
    const g = it.geometry;
    if (g.kind === "circle") { const c = new C.Proj(lat, lon).xy(g.c[0], g.c[1]); return Math.hypot(c[0], c[1]) <= g.r; }
    return ringHas(g.pts, lat, lon);
  }
  const hitNotams = (items, lat, lon) => (items || []).filter(it => notamHas(it, lat, lon));

  /* ================= חלון הזמן של הנוטמים ================= */
  // כמו בבדיקות המלאות (C.analyze): מתחילת היום הראשון בשעת ההתחלה ועד סוף היום האחרון בשעת הסיום (חלון שחוצה חצות — עד למחרת). בלי שעות — כל היום (00:00–23:59).
  // כשעוד לא נבחרו תאריכים (או שהם שגויים): מעכשיו ואילך, כלומר כל נוטם שחלון התוקף שלו לא הסתיים.
  // ביצועים: נבנות רק שתי שורות (היום הראשון והיום האחרון) ולא טבלת יום/לילה לכל הטווח — הקלדת שנה בשדה התאריך (0002, 0020, 0202…) יצרה טווח של אלפי ימים וקפיאה של חצי שנייה בכל הקלדה,
  // והטבלה נחתכה בשקט ב-400 שורות כך שהתווית בפס אמרה חלון שונה מהחלון בפועל. החלון זהה לזה של השורה הראשונה/האחרונה בטבלה המלאה; תוצאה אחרונה נשמרת לפי הקלט (העדכון מושהה נקרא פעמיים)
  const MAX_RANGE_DAYS = 60;   // כמו validateInput: טווח ארוך יותר נדחה בהרצה; כאן הוא מסומן (tooLong) ולא נחתך
  const winMemo = { key: "", val: null };
  function inputWindow(inp, now) {
    inp = inp || {};
    const nowMs = (now || new Date()).getTime();
    const dFrom = inp.dateFrom || "", dTo = inp.dateTo || dFrom;
    const a = C.parseDate(dFrom), b = C.parseDate(dTo);
    const fallback = reason => ({ mode: "now", fromMs: nowMs, toMs: Infinity, reason, label: "מעכשיו (" + reason + ")" });
    const BAD = "התאריכים שנבחרו אינם תקינים", yOk = d => d.y >= 2000 && d.y <= 2200;   // שנה בהקלדה (0002…) אינה תאריך: Date.UTC(2,…) = 1902
    if (!a) return fallback("עוד לא נבחרו תאריכים");
    if (!b || !yOk(a) || !yOk(b) || Date.UTC(b.y, b.m - 1, b.d) < Date.UTC(a.y, a.m - 1, a.d)) return fallback(BAD);
    const t0 = C.parseTime(inp.timeFrom), t1 = C.parseTime(inp.timeTo), full = !(t0 && t1);
    const tf = full ? "00:00" : inp.timeFrom, tt = full ? "23:59" : inp.timeTo, key = [dFrom, dTo, tf, tt].join("|");
    let ms = winMemo.key === key ? winMemo.val : null;
    if (!ms) {
      const first = C.dayNightTable(31.8, 35.0, dFrom, dFrom, tf, tt)[0], last = C.dayNightTable(31.8, 35.0, dTo, dTo, tf, tt)[0];   // שעות זריחה/שקיעה לא בשימוש כאן — רק startUtc/endUtc
      if (!first || !last) return fallback(BAD);
      ms = { fromMs: +first.startUtc, toMs: +last.endUtc }; winMemo.key = key; winMemo.val = ms;
    }
    // חלון שחוצה חצות (שעת הסיום לא אחרי שעת ההתחלה): הסיום ביום שאחרי היום האחרון — וכך גם בתווית
    let bEnd = b;
    if (!full && t1.h * 60 + t1.mi <= t0.h * 60 + t0.mi) { const x = new Date(Date.UTC(b.y, b.m - 1, b.d + 1)); bEnd = { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() }; }
    const days = Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
    return { mode: full ? "dates" : "form", fromMs: ms.fromMs, toMs: ms.toMs, reason: "", tooLong: days > MAX_RANGE_DAYS,
      label: C.ddmmyyyy(a) + (full ? "" : " " + inp.timeFrom) + " – " + C.ddmmyyyy(bEnd) + (full ? " (כל היום)" : " " + inp.timeTo) + " (שעון מקומי)" };
  }

  /* ================= בחירת נוטמים לתצוגה ================= */
  // נוטמים שמוצגים במפה: אותם סוגים שהבדיקה המלאה מתייחסת אליהם כסגירה/מכשול (תדרים, GNSS, נתיבים, רשימות, ביטולים ו"אחר" אינם סגירת מרחב)
  const SHOWN_KINDS = ["closure", "obstacle"];
  const memo = new Map();   // לפי הטקסט הגולמי: חישוב החלון/הסוג/הגיאומטריה פעם אחת (נקרא שוב בכל שינוי תאריך)
  function parsed(raw) {
    let p = memo.get(raw);
    if (!p) {
      if (memo.size > 3000) memo.clear();
      p = { w: C.notamWindow(raw), kind: C.notamKind(raw), g: C.notamGeometry(raw), q: C.notamQ(raw) };
      memo.set(raw, p);
    }
    return p;
  }
  const MAX_NOTAM_R_M = 2e6;   // רדיוס סביר לציור: מעל 2,000 ק״מ הוא כשל בנתונים ולא סגירה
  function geomOk(g) {
    if (g.kind === "circle") return finite2(g.c) && typeof g.r === "number" && isFinite(g.r) && g.r > 0 && g.r <= MAX_NOTAM_R_M;
    return Array.isArray(g.pts) && g.pts.length >= 3 && g.pts.every(finite2);
  }
  // win: {fromMs,toMs} (inputWindow). מחזיר {items: נוטמים עם מיקום, noLocation: מזהים, otherKinds: [{id,kind}], noWindow: מזהים, inWindow: מספר הנוטמים בתוקף בחלון}
  function selectNotams(notams, win, opts) {
    const kinds = (opts && opts.kinds) || SHOWN_KINDS;
    const out = { items: [], noLocation: [], otherKinds: [], noWindow: [], inWindow: 0 };
    (notams || []).forEach(n => {
      const raw = String((n && n.raw) || ""), p = parsed(raw);
      if (!p.w) { out.noWindow.push(n && n.id); return; }
      if (!(p.w.from <= win.toMs && p.w.to >= win.fromMs)) return;
      out.inWindow++;
      if (!kinds.includes(p.kind)) { out.otherKinds.push({ id: n.id, kind: p.kind }); return; }
      if (!p.g || !geomOk(p.g)) { out.noLocation.push(n.id); return; }   // גיאומטריה פגומה (רדיוס אינסופי/שלילי/ענק, קואורדינטה שאינה מספר) = בלי מיקום: נמנית ב״ללא מיקום״ ומופנית לדוח, ואינה מצויה
      out.items.push({ id: n.id, kind: p.kind, heb: n.heb || "", name: n.name || "", raw, window: p.w, geometry: p.g, q: p.q });
    });
    return out;
  }

  /* ================= טקסטים של נוטם לכרטיס ================= */
  const fmtUtc = ms => ms === Infinity ? "קבוע" : new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z";   // כמו בדף הבדיקות
  const firstLine = n => { const s = String((n && (n.heb || n.name)) || "").split("\n")[0].trim(); return s.length > 280 ? s.slice(0, 280) + "…" : s; };
  // גבהים כפי שהם בנוטם: שורות F)/G) כלשונן; אם אין — טווח מתוך שורת Q (במאות רגל). מחרוזת ריקה כשאין.
  // סריקה ליניארית בכוונה: ביטוי רגולרי עם \s* לפני ואחרי קבוצה עצלה על אותם רווחים (F) ואחריו אלפי רווחים בלי G)) הוא מעוקב ונועל את הלשונית; כיסוי ב-/[ \t]*/ או חיתוך ל-5,000 תווים אינם פותרים את זה
  // F) ואחריו (אחרי רווחים, גם שורות) הערך בשורה אחת, ו-G) באותה שורה או בשורה הלא-ריקה הבאה. אם ל-F) הראשון אין G) — מנסים את הבא (עד 20)
  const isWs = c => c === 32 || (c >= 9 && c <= 13) || c === 160 || c === 0xfeff || c === 0x2028 || c === 0x2029;   // \s של JS (מספיק לטקסט נוטם), בלי regex
  function fgAlt(s) {
    const re = /(?:^|\s)F\)/g;
    for (let n = 0, m; n < 20 && (m = re.exec(s)); n++) {
      let i = m.index + m[0].length;
      while (i < s.length && isWs(s.charCodeAt(i))) i++;
      const lines = s.slice(i).split("\n");
      let lo = lines[0], hi = null;
      const g = lo.indexOf("G)");
      if (g >= 0) { hi = lo.slice(g + 2); lo = lo.slice(0, g); }
      else { const k = lines.findIndex((l, j) => j > 0 && l.trim() !== ""); if (k > 0 && /^\s*G\)/.test(lines[k])) hi = lines[k].replace(/^\s*G\)/, ""); }
      if (hi === null) continue;   // לא נמצא G) אחרי ה-F) הזה
      lo = lo.trim(); hi = hi.replace(/\)\s*$/, "").trim();
      return lo && hi ? lo + " – " + hi : null;   // כמו הביטוי הקודם: ההתאמה הראשונה קובעת (ריקה = לא משתמשים בה ועוברים ל-Q)
    }
    return null;
  }
  // {fg: "SFC – 1000FT AGL"} | {lowerFt, upperFt} (שורת Q) | null
  function notamAltParts(raw) {
    const fg = fgAlt(String(raw || ""));
    if (fg) return { fg };
    const q = C.notamQ(raw);
    return q ? { lowerFt: q.lowerFt, upperFt: q.upperFt } : null;
  }
  function notamAlt(raw) {
    const p = notamAltParts(raw);
    if (!p) return "";
    return p.fg ? p.fg : p.lowerFt + " – " + (p.upperFt >= 99900 ? "ללא הגבלה" : p.upperFt + " רגל") + " (לפי שורת Q)";
  }
  // אותו טקסט כ-HTML (escaped) לכרטיס: רק הרצפים הלטיניים/המספריים בתוך dir=ltr — לעולם לא עברית בתוך ltr (סדר המילים והסוגריים התהפכו)
  const ltr = t => '<span dir="ltr">' + E(t) + "</span>";
  function notamAltHtml(raw) {
    const p = notamAltParts(raw);
    if (!p) return "";
    if (p.fg) return ltr(p.fg);
    return ltr(p.lowerFt) + " – " + (p.upperFt >= 99900 ? "ללא הגבלה" : ltr(p.upperFt) + " רגל") + " (לפי שורת Q)";
  }

  /* ================= כרטיס הפופאפ (HTML; כל טקסט משתמש/נתונים עובר escaping) ================= */
  function zoneCard(z, opts) {
    const col = (COLORS[z.src] || COLORS.a17).line;
    let h = '<div class="lp-i"><span class="lp-sw" style="background:' + col + '"></span><b>' + E(z.label) + '</b><div class="lp-k">' + E(z.kind) + "</div>";
    if (z.alt) h += "<div>גבהים: " + E(z.alt) + "</div>";
    if (z.pmt) h += '<div class="lp-q">״' + E(z.pmt) + "״</div>";
    else if (z.note) h += "<div>הערה: " + E(z.note) + "</div>";
    if (z.footnote && opts.b09Footnote) h += '<div class="lp-n">' + E(opts.b09Footnote) + "</div>";
    if (z.approx) h += '<div class="lp-w">שרטוט בקירוב — אינו הגבול הרשמי</div>';
    return h + "</div>";
  }
  // תוקף (UTC): כל תאריך+שעה ברצף ltr אחד שאינו נשבר (nowrap) — אחרת שעת הסיום נשארת לבד בשורה הבאה בכרטיס צר; "קבוע" הוא טקסט עברי רגיל, מחוץ ל-ltr
  const utcSpan = ms => ms === Infinity ? E(fmtUtc(ms)) : '<span dir="ltr" style="white-space:nowrap">' + E(fmtUtc(ms)) + "</span>";
  function notamCard(n) {
    let h = '<div class="lp-i"><span class="lp-sw" style="background:' + COLORS.notam.line + '"></span><b dir="ltr">' + E(n.id) + '</b><div class="lp-k">' + (n.kind === "obstacle" ? "נוטם — מכשול" : "נוטם — סגירת מרחב אוויר") + "</div>";
    const line = firstLine(n), alt = notamAltHtml(n.raw);
    if (line) h += "<div>" + E(line) + "</div>";
    h += "<div>תוקף (UTC): " + utcSpan(n.window.from) + " – " + utcSpan(n.window.to) + "</div>";
    if (alt) h += "<div>גבהים: " + alt + "</div>";
    if (n.geometry && n.geometry.src === "Q") h += '<div class="lp-w">המיקום משוער, מתוך שורת Q של הנוטם — עיגול גס ולא שטח מדויק</div>';
    return h + "</div>";
  }
  // סדר הכרטיס (לא סדר הציור): אזורי א-17 האסורים (LLP/LLU/LLD) קודם, אחריהם שאר א-17 (מוגבל), אחריהם שמורות רט״ג ואז ב-09 — כמו בסדר הפס. מיון יציב; סדר הציור (zoneShapes) אינו משתנה
  const A17_FORBIDDEN = ["LLP", "LLU", "LLD"];
  const cardRank = z => z.src === "a17" ? (A17_FORBIDDEN.includes(z.cat) ? 0 : 1) : z.src === "inpa" ? 2 : 3;
  const plural = (n, one, many) => n === 1 ? one : n + " " + many;   // "נוטם אחד" / "3 נוטמים"
  // hits: {zones: צורות, notams: פריטי selectNotams}; opts: {b09Footnote, maxZones, maxNotams}
  function popupHtml(hits, opts) {
    opts = opts || {};
    const zs = ((hits && hits.zones) || []).map((z, i) => ({ z, i })).sort((a, b) => cardRank(a.z) - cardRank(b.z) || a.i - b.i).map(x => x.z), ns = (hits && hits.notams) || [];
    const mz = opts.maxZones || 8, mn = opts.maxNotams || 8, total = zs.length + ns.length;
    const split = zs.length && ns.length ? " (" + plural(zs.length, "אזור אחד", "אזורים") + " · " + plural(ns.length, "נוטם אחד", "נוטמים") + ")" : "";   // שורת הכותרת מפרטת את הרכב הכרטיס, בלי שורה נוספת (במסך צר כל שורה דוחפת את הפריט הראשון)
    let h = '<div class="lp" dir="rtl"><div class="lp-t">' + (total === 1 ? "בנקודה שנלחצה — פריט אחד" : "בנקודה שנלחצה — " + total + " פריטים") + split + (total >= 3 ? " (גללו לראות את כולם)" : "") + "</div>";
    zs.slice(0, mz).forEach(z => { h += zoneCard(z, opts); });
    if (zs.length > mz) h += '<div class="lp-more">ועוד ' + plural(zs.length - mz, "אזור אחד", "אזורים") + "</div>";
    ns.slice(0, mn).forEach(n => { h += notamCard(n); });
    if (ns.length > mn) h += '<div class="lp-more">ועוד ' + plural(ns.length - mn, "נוטם אחד", "נוטמים") + "</div>";
    return h + "</div>";
  }

  /* ================= גיל נתוני הנוטמים ================= */
  function notamAge(iso, now) {
    const t = Date.parse(iso || ""); if (!isFinite(t)) return null;
    const h = ((now || new Date()).getTime() - t) / 3600000, n = Math.max(0, Math.round(h));
    return { hours: h, text: "נתוני הנוטמים נמשכו " + (h < 1 ? "לפני פחות משעה" : n === 1 ? "לפני שעה" : "לפני " + n + " שעות") };
  }

  /* ================= פס סיכום לנקודה שנבחרה ================= */
  const LAST_LINE = "תצוגה מקדימה בלבד — הבדיקות המלאות רצות בלחיצה על ״הרץ את כל הבדיקות״.";
  const DEF_TH = { near_zone_m: 1000, approx_margin_m: 750, notam_near_m: 10000, site_near_m: 1000, notam_warn_age_h: 24 };
  const capList = (arr, n, one, many) => arr.slice(0, n).join("; ") + (arr.length > n ? "; ועוד " + plural(arr.length - n, one, many) : "");
  const RLM = String.fromCharCode(0x200F);   // אחרי מזהה לטיני (C0431/26, LLU20) שבא לפני " — " ומספר: בלי זה W7/N1 הופכים את הסדר ("3.6 — C0431/26 ק״מ…") ומנתקים את היחידה מהמספר
  // a: {lat, lon, coordInvalid, radius, heightM, dateFrom, dateTo, timeFrom, timeTo, zones, inpa, notams, notamFetchedIso, thresholds, now}
  // coordInvalid: בשדה הנ״צ הוקלד טקסט שאינו נ״צ — אין להציג סיכום של הנקודה הקודמת כאילו היא הנבחרת (ui.js)
  // מחזיר {state: "need-point"|"bad-coord"|"ok", lines: [{k, label, text, cls}], win, zonesRes, notamsRes, selection}. השורה האחרונה היא תמיד הערת "תצוגה מקדימה בלבד".
  // הפונקציה לא זורקת: כשל בחישוב של חלק (נתונים פגומים) מוצג כשורת אזהרה באותו חלק, והחלקים האחרים ממשיכים
  function preview(a) {
    a = a || {};
    const now = a.now || new Date(), th = Object.assign({}, DEF_TH, a.thresholds || {}), lines = [];
    const add = (k, label, text, cls) => lines.push({ k, label: label || "", text, cls: cls || "" });
    const last = () => add("last", "", LAST_LINE, "last");
    const num = v => typeof v === "number" && isFinite(v);
    if (a.coordInvalid) { add("hint", "", "הנ״צ שהוקלד אינו חוקי — תקנו אותו או בחרו נקודה במפה", "warn"); last(); return { state: "bad-coord", lines }; }
    if (!num(a.lat) || !num(a.lon)) { add("hint", "", "בחרו נקודה במפה"); last(); return { state: "need-point", lines }; }
    if (!(a.lat >= 29 && a.lat <= 34 && a.lon >= 34 && a.lon <= 36.5)) { add("hint", "", "הנקודה מחוץ לתחום ישראל והסביבה — בחרו נקודה במפה", "warn"); last(); return { state: "need-point", lines }; }
    const P = new C.Proj(a.lat, a.lon), R = num(a.radius) && a.radius > 0 ? a.radius : 0, topFt = num(a.heightM) && a.heightM > 0 ? a.heightM * C.M2FT : null;
    const out = { state: "ok", lines, win: inputWindow(a, now) };
    if (!R) add("radius", "", "לא הוזן רדיוס תקין — החישוב הוא לנקודה עצמה. הזינו רדיוס לחישוב מדויק.", "warn");

    /* ---- אזורי איסור: אותו חישוב כמו בבדיקות המלאות, אך רק מול הגבולות שבקובץ ---- */
    if (!a.zones || !a.zones.zones || !a.inpa) add("zones", "אזורי איסור", "נתוני האזורים לא נטענו — אין תצוגה מקדימה של אזורי איסור.", "warn");
    else try {
      const z = out.zonesRes = C.analyzeZones(P, R, { zones: a.zones.zones, inpa: a.inpa }, th.near_zone_m, topFt, th.approx_margin_m);
      const txt = r => r.label + " — " + r.kind + (r.approx ? " (שרטוט בקירוב, אינו הגבול הרשמי)" : "");
      if (z.inside.length) add("inside", "בתוך הסגירה", "חפיפה ל-" + capList(z.inside.map(txt), 4, "אזור אחד", "אזורים"), "hit");
      else add("inside", "בתוך הסגירה", "אין חפיפה לאזורי איסור שבקובץ", "ok");
      const nm = C.fmtInt(th.near_zone_m) + " מ׳";
      if (z.near.length) add("near", "בקרבה (עד " + nm + " מקצה הסגירה)", capList(z.near.map(r => r.label + RLM + " — " + C.fmtDist(r.edge) + " מקצה הסגירה (" + C.fmtDist(r.d) + " מהנקודה)" + (r.approx ? ", שרטוט בקירוב" : "")), 5, "אזור אחד", "אזורים"), "near");
      else add("near", "בקרבה (עד " + nm + " מקצה הסגירה)", "אין אזור איסור בקובץ", "ok");
      // אתרי רט״ג שאין להם גבול בקובץ (inpa.unmapped) אינם נבדקים כאן — הבדיקה המלאה מתאימה אותם לפי שם מול OpenStreetMap, ולכן ״אין״ למעלה אינו קביעה לגביהם. לא מנחשים התאמה מהשם
      const un = Array.isArray(a.inpa.unmapped) ? a.inpa.unmapped.length : 0;
      if (un) add("unmapped", "", "לא נבדקו " + (un === 1 ? "אתר רט״ג אחד שאין לו גבול" : un + " אתרי רט״ג שאין להם גבול") + " בקובץ — " + (un === 1 ? "הוא נבדק" : "הם נבדקים") + " רק בהרצה המלאה, לפי שם מול OpenStreetMap.");
      if (z.excluded.length) add("excluded", "", "אזורי ב-09 שאינם חופפים אנכית לגובה שהוזן: " + z.excluded.map(x => x.id).join(", ") + ".");
      if (topFt == null) add("height", "", "לא הוזן גובה — אזורי ב-09 אינם מסוננים לפי גובה. הזינו גובה לחישוב מדויק.", "warn");
    } catch (e) { out.zonesRes = null; add("zones", "אזורי איסור", "לא ניתן לחשב תצוגה מקדימה של אזורי איסור (נתונים לא תקינים) — הבדיקות המלאות רצות בלחיצה על ״הרץ״.", "warn"); }

    /* ---- נוטמים: חלון התאריכים שנבחר בטופס, ואותה בדיקה כמו במלאה ---- */
    if (!Array.isArray(a.notams)) add("notams", "נוטמים", "נתוני הנוטמים לא נטענו — אין תצוגה מקדימה של נוטמים.", "warn");
    else try {
      const w = out.win, nr = out.notamsRes = C.analyzeNotams(P, R, a.notams, w.fromMs, w.toMs, topFt, th.notam_near_m, th.site_near_m);
      out.selection = selectNotams(a.notams, w);
      add("window", "חלון הנוטמים", w.label);
      if (w.tooLong) add("range", "", "טווח התאריכים עולה על " + MAX_RANGE_DAYS + " ימים — ההרצה תידחה (הסינון כאן לפי הטווח שהוזן).", "warn");
      const located = nr.hits.map(n => ({ n, ob: false })).concat(nr.obstacles.map(n => ({ n, ob: true }))).filter(x => x.n.relation !== "no-geometry").sort((p, q) => p.n.d - q.n.d);
      const rng = "עד " + C.fmtInt(th.notam_near_m) + " מ׳ מקצה הסגירה, מכשולים עד " + C.fmtInt(th.site_near_m) + " מ׳";
      if (located.length) add("notams", "נוטמים", capList(located.map(x => x.n.id + RLM + " — " + (x.n.inside ? "חופף לסגירה" : C.fmtDist(x.n.edge) + " מקצה הסגירה") + (x.ob ? " (מכשול)" : "")), 6, "נוטם אחד", "נוטמים"), located.some(x => x.n.inside) ? "hit" : "near");
      else add("notams", "נוטמים", "אין נוטם בטווח (" + rng + ")", "ok");
      const nl = out.selection.noLocation.length;
      if (nl) add("noloc", "", nl + (nl === 1 ? " נוטם ללא מיקום" : " נוטמים ללא מיקום") + " — יש לקרוא " + (nl === 1 ? "אותו" : "אותם") + " בדוח.", "warn");
      const age = notamAge(a.notamFetchedIso, now);
      if (!age) add("age", "", "לא ידוע מתי נמשכו נתוני הנוטמים.", "warn");
      else if (age.hours > th.notam_warn_age_h) add("age", "", age.text + " — ייתכן שאינם עדכניים.", "warn");
    } catch (e) { out.notamsRes = null; out.selection = null; add("notams", "נוטמים", "לא ניתן לחשב תצוגה מקדימה של נוטמים (נתונים לא תקינים) — הבדיקות המלאות רצות בלחיצה על ״הרץ״.", "warn"); }
    last();
    return out;
  }

  /* ================= הסברי "!" ליד המתגים ================= */
  const HELP = {
    zones: "מציג על המפה את אזורי האיסור וההגבלה מפמ״ת א-17 (באדום), את אזורי הטיסה לכטב״ם מפרק ב-09 (בכחול) ואת שמורות הטבע והגנים הלאומיים של רט״ג (בסגול), כפי שהם בקובץ הנתונים של מפת החברים. אזורים שהשרטוט שלהם בקירוב מסומנים בקו מקווקו, ושרטוט כזה אינו הגבול הרשמי. אתר רט״ג שאין לו גבול בקובץ אינו מצויר ואינו נבדק בפס שמתחת למפה (הוא נבדק בהרצה המלאה, לפי שם). לחיצה על המפה פותחת כרטיס עם האזורים שבנקודה שנלחצה, ובו הלשון מהפמ״ת כשקיימת. זו תצוגה מקדימה בלבד: היא אינה משפיעה על ״מוכן לשליחה״, והבדיקות המלאות רצות רק ב״הרץ את כל הבדיקות והכן את הבקשה״.",
    notams: "מציג בצהוב נוטמים של סגירת מרחב אוויר ושל מכשולים שיש להם מיקום בנוטם (עיגול או שטח). הם מסוננים לפי התאריכים והשעות שבחרתם בטופס; כל עוד לא נבחרו תאריכים מוצגים נוטמים שעדיין בתוקף. נוטם בלי מיקום אינו מצויר: מספרם מופיע ליד המתג ובפס שמתחת למפה (אחרי בחירת נקודה), ויש לקרוא אותם בדוח. נוטמים של תדרים, GNSS, נתיבים ורשימות אינם מוצגים. מיקום שנגזר משורת Q של הנוטם הוא עיגול גס ומסומן בקו מקווקו. זו תצוגה מקדימה בלבד: היא אינה משפיעה על ״מוכן לשליחה״, והבדיקות המלאות רצות רק ב״הרץ את כל הבדיקות והכן את הבקשה״."
  };
  const HELP_NAME = { zones: "שכבת האיסורים", notams: "שכבת הנוטמים" };

  return { KEY, COLORS, SHOWN_KINDS, LAST_LINE, HELP, HELP_NAME, parsePrefs, serializePrefs, zoneShapes, ringHas, hitZones, hitNotams, notamHas, inputWindow, selectNotams, notamAlt, notamAltHtml, firstLine, fmtUtc, popupHtml, notamAge, preview };
});
