/* הפקת הטופס (נספח ג׳), דף הבדיקות, KML וטקסט המייל מתוצאת הניתוח (request/core.js). בלי DOM — נבדק ב-Node. */
(function (root, factory) {
  // lazy(name): מודולי שלב ב׳ (parties, recheck) נטענים עצלנית ובאופן רופף — סקריפט חסר/שגוי = הפיצ׳ר כבוי (null), והפלט כמו בשלב א׳
  if (typeof module === "object" && module.exports) module.exports = factory(require("./core.js"), n => { try { return require("./" + n + ".js"); } catch (e) { return null; } });
  else root.ReqOut = factory(root.ReqCore, n => (n === "parties" ? root.ReqParties : n === "recheck" ? root.ReqRecheck : null) || null);
})(typeof self !== "undefined" ? self : this, function (C, lazy) {
  "use strict";
  /* שלב ב׳ — ממשק (כל התוספות כבויות כשהדגל כבוי, כשהמודול לא נטען או כשהמתקשר לא מעביר את האפשרות: הפלט זהה לשלב א׳):
     docxModel(res, data, cfg, {…, parties: שורות ReqParties, partiesDropped, partiesFailed}) ← model.parties (טקסט רגיל) ← ReqDocx.build מוסיף את העמוד; partiesHtml(model.parties) ← עמוד המסך (div.paper.parties)
     mail(res, cfg, {parties: שורות | {total, done}, update: {sentAt}}) ← שורת "• דיווח לגורמים נוספים: …" ו/או מייל עדכון (subject = הנושא הרגיל לשרת; subjectFull = עם קידומת העדכון, ל-mailto/העתקה)
     recheckDocxModel(res, data, cfg, ReqRecheck.sinceModel(…), {now, includeChecks}) ← ReqDocx.buildRecheck(model) = קובץ ה-Word של הבדיקה החוזרת (ZIP); null כשהדגל כבוי */
  const E = C.esc;
  const dLabel = d => (d < 1 ? "בתוך השטח" : C.fmtDist(d));

  /* ---------- נתיב (res.area.kind === "route") במקום מעגל ---------- */
  // נתיב: res.R = הרוחב מכל צד (W), המרחק d של כל פריט הוא מציר הנתיב, ו-res.inp.lat/lon הם רק נקודת עוגן לחישוב (לא "הנקודה"). מעגל: res.area חסר — כל הנוסחים כמו תמיד, בייט-בבייט (golden.test.mjs).
  const isRoute = res => !!(res && res.area && res.area.kind === "route");
  const FROM = res => (isRoute(res) ? "מהציר" : "מהנקודה");        // "במרחק D מהנקודה" -> "במרחק D מהציר"
  const FROMTO = res => (isRoute(res) ? "מציר הנתיב" : "מהנקודה");  // "עד X מהנקודה" -> "עד X מציר הנתיב"
  const RW = res => res.R + (isRoute(res) ? " מ׳ מכל צד של הציר" : " מ׳");        // "(R מ׳)" -> "(W מ׳ מכל צד של הציר)"
  const RW2 = res => 2 * res.R + (isRoute(res) ? " מ׳ מציר הנתיב" : " מ׳");        // "עד 2R מ׳" -> "עד 2W מ׳ מציר הנתיב"
  const dmsPair = q => "<span dir='ltr'>" + E(C.dmsLat(q[0])) + " &nbsp; " + E(C.dmsLon(q[1])) + "</span>";
  const lbl = t => "<bdi dir='ltr'>" + t + ".</bdi>";   // "P1." / "V1." כיחידה שמאל-לימין (במסך): הנקודה נשארת אחרי המספר ולא מתהפכת בפסקה מימין לשמאל; ב-Word התגית מדולגת (docx.js htmlRuns)
  const dmsText = q => C.dmsLat(q[0]) + " " + C.dmsLon(q[1]);
  // פינות פוליגון הסגירה של נתיב (C.corridorRing(area, 1) בלי הנקודה החוזרת בסגירה): [[lat,lon],...] לפי סדר ההקפה; נתיב מנוון (פחות משתי נקודות שונות) — []
  const routeCorners = res => { const r = C.corridorRing(res.area, 1).ring; return r.length > 1 ? r.slice(0, -1) : []; };
  const CORNER_CAP = 60;   // תקרת שורות הפינות בשדה 8 (נתיב עד 20 נקודות נותן עד 58 פינות, ולכן התקרה אינה נחתכת בפועל); מעבר לה — הפניה ל-KML
  const routeKm = res => (res.area.lengthM / 1000).toFixed(2);
  // הערה ב-KML כשאי אפשר לצייר את טבעת ה-2W (הכתומה) כפוליגון תקין לצורת הנתיב הזו
  const NOTE_NO_2W = "טבעת ה-2W (הכתומה) אינה מצוירת בקובץ זה: בצורת הנתיב הזו (פניות חדות או קטעים קצרים ביחס לרוחב) אי אפשר לבנות לה פוליגון תקין. הפריטים שברשימות נמדדים מהציר ולכן אינם מושפעים; הפוליגון הירוק (אזור הסגירה) מצויר במלואו.";
  // שדה 8 בנתיב: הנקודות לפי הסדר (P1..PN), האורך והרוחב, פינות הפוליגון המודפס (V1..VM; DMS בלבד) והסבר קצר איך הוא נבנה. הפוליגון מכיל את כל אזור הסגירה (כל נקודה במרחק עד W מהציר)
  function routeF8Head(res) {
    const a = res.area, W = res.R, cs = routeCorners(res);
    let h = "<b>נתיב</b> — " + a.pts.length + " נקודות, לפי סדר הטיסה:";
    a.pts.forEach((q, i) => { h += "<br>" + lbl("P" + (i + 1)) + " " + dmsPair(q) + " <span class='muted'>(עשרוני: " + C.trimNum(q[0], 6) + ", " + C.trimNum(q[1], 6) + ")</span>"; });
    h += "<br>אורך הנתיב: " + routeKm(res) + " ק״מ (" + C.fmtInt(Math.round(a.lengthM)) + " מ׳) · רוחב הסגירה מכל צד של הציר: " + W + " מ׳ (רוחב כולל " + 2 * W + " מ׳)";
    if (cs.length) {
      h += "<br><b>פינות פוליגון הסגירה (" + cs.length + " פינות, לפי סדר ההקפה):</b>";
      cs.slice(0, CORNER_CAP).forEach((q, i) => { h += "<br>" + lbl("V" + (i + 1)) + " " + dmsPair(q); });
      if (cs.length > CORNER_CAP) h += "<br>ועוד " + (cs.length - CORNER_CAP) + " פינות (הרשימה המלאה בקובץ ה-KML המצורף)";
      // המשפט ״הפוליגון מכיל את כל אזור הסגירה״ נכון רק כשהטבעת תקינה (simple: פשוטה ומכילה את הקפסולה). validateRoute דוחה כל נתיב אחר כבר בקלט (ולכן ב-UI הוא לא מגיע לכאן); הגנה לעומק לנתיב שמגיע בלי אימות (בקשה שנשמרה בכללים ישנים, בדיקה חוזרת) — במקום הטענה, אזהרה
      h += "<br><span class='muted'>הפוליגון נבנה במקביל לציר הנתיב במרחק " + W + " מ׳ מכל צד; בפנייה חדה הפינה החיצונית נחתכת במרחק " + 2 * W + " מ׳ מהקודקוד, וקצות הנתיב מורחבים ב-" + W + " מ׳. " +
        (C.corridorRing(a, 1).simple ? "הפוליגון מכיל את כל אזור הסגירה (כל נקודה במרחק עד " + W + " מ׳ מהציר)." : "לצורת נתיב זו (חדה או צפופה ביחס לרוחב) הפוליגון אינו מכיל בהכרח את כל אזור הסגירה — יש להשתמש בציר הנתיב וברוחב שצוינו.") + "</span>";
    }
    return h;
  }

  /* ---------- התאמת אתרי רט״ג ללא גבולות מול שמות מ-OSM ---------- */
  const norm = s => String(s || "").replace(/["'׳״`]/g, "").replace(/(שמורת טבע|שמורת|גן לאומי|פארק|אתר|רזרבת)/g, " ").replace(/[-–—_.,()]/g, " ").replace(/\s+/g, " ").trim();
  function matchUnmapped(unmapped, prot) {
    const out = [];
    (unmapped || []).forEach(u => {
      const a = norm(u.name); if (a.length < 4) return;
      prot.forEach(p => { const b = norm(p.name); if (b.length >= 4 && (a.includes(b) || b.includes(a))) out.push({ site: u, osm: p }); });
    });
    return out;
  }

  /* ---------- רשימות לשדה "סגירה/הגבלה" ---------- */
  // חלקי שורת פריט: שם (עם המספר שבמפה) ומרחק (עם הגובה, אם יש). itemText (אזהרות, דף הבדיקות) ושורת הפריט בשדה 8 (itemLine) נבנות מאותם חלקים — המספור והמרחקים זהים בכולן
  const itemParts = it => ({ name: it.n + ". " + it.title, dist: dLabel(it.d) + (it.height ? " · גובה " + C.trimNum(it.height, 0) + " מ׳" : "") });
  function itemText(it) {
    const p = itemParts(it);
    return p.name + " — " + p.dist;
  }
  // גובה האזור כפי שהוא במפה; לאזור משורטט בקירוב אין גובה מובנה — מציגים את לשון הפמ״ת
  const isB09 = z => z.src === "b09";
  const rule09 = (data, id) => ((data && data.zones && data.zones.rules09 && data.zones.rules09.rules) || []).find(r => r.id === id);
  // גובה האזור כפי שהוא במפה; לאזור משורטט בקירוב (LLR) אין גובה מובנה — מציגים את לשון הפמ״ת. באזור ב-09 עם גובה מזערי מעפ״י — מציינים מתי יש חפיפה אנכית
  const zoneAlt = z => (z.alt || (z.pmt ? "לפי הפמ״ת: " + z.pmt : "הגובה לפי הפמ״ת")) + (isB09(z) && z.needGroundFt > 0 ? " — אין חפיפה אנכית אלא אם גובה הקרקע באתר מעל " + C.fmtInt(z.needGroundFt) + " רגל מעפ״י" : "");
  const approxMark = z => !z.approx ? "" : isB09(z) ? " (שרטוט בקירוב לפי מפת נספח א׳ של פרק ב-09 — אינו הגבול הרשמי; הקואורדינטות והתיאור בשורת האזור בנספח)" : " (שרטוט בקירוב לפי מפת נספח א׳ בפמ״ת — אינו הגבול הרשמי; הקואורדינטות ב-ENR 5.1)";
  // נוסח הערת השוליים ¹ כפי שבפמ״ת (נספח ב׳-1), כשמוצג אזור שמציין "גובה מרבי¹"
  const footnoteText = res => res.b09Footnote ? "¹ " + String(res.b09Footnote.text).replace(/^1\s*/, "") + " (" + res.b09Footnote.ref + ")" : "";
  function airInfraLines(res, data, cfg) {
    const th = cfg.thresholds, lines = [], R = res.R;
    res.zones.inside.forEach(z => lines.push("חופף לאזור " + z.label + " — " + z.kind + ", " + zoneAlt(z) + approxMark(z) + "."));
    res.zones.near.forEach(z => lines.push("בקרבת האזור: " + z.label + " — במרחק " + C.fmtDist(z.d) + " " + FROM(res) + " (" + C.fmtDist(z.edge) + " מקצה הסגירה המבוקשת) — " + z.kind + ", " + zoneAlt(z) + approxMark(z) + "."));
    const have = new Set(); res.nearScan.items.forEach(i => i.ids.forEach(x => have.add(x)));
    res.airfields.filter(a => a.d - R <= th.airfield_near_m && !have.has(a.id)).forEach(a =>
      lines.push("בקרבת האזור: " + (a.type === "aerodrome" ? "שדה תעופה" : "מנחת מסוקים") + (a.name ? " ״" + a.name + "״" : "") + (a.icao ? " (" + a.icao + ")" : "") + " — במרחק " + C.fmtDist(a.d) + " " + FROM(res) + (a.inactive ? " (לא פעיל לפי OSM)" : "") + "."));
    res.agri.filter(a => a.d - R <= (th.agri_near_m || 3000)).forEach(a =>
      lines.push("בקרבת האזור: מנחת חקלאי ״" + a.name + "״ (" + a.ops.join(" / ") + ") — במרחק " + C.fmtDist(a.d) + " " + FROM(res) + "."));
    res.borders.filter(b => b.violates).forEach(b =>
      lines.push("קרבה לגבול " + b.name + ": הסגירה המבוקשת נמצאת " + C.fmtDist(Math.max(0, b.d - R)) + " מהגבול (פמ״ת א-17 סעיף 4: אין לטוס במרחק של פחות מ-" + b.km + " ק״מ מגבול " + b.name + ")."));
    return lines;
  }
  // שורת פריט בשדה 8: המספר והשם בתחילת השורה והמרחק בקצה שלה. הרכיב fs הוא המפריד — קו מנחה מקווקו במסך (index.html .fl), טאב ימני עם קו מנחה ב-Word (docx.js htmlRuns) ו-" — " בטקסט הפשוט (toText).
  // אותו HTML משמש את המסך ואת ה-Word: ללא טבלה, וללא טאב בטקסט עצמו (ב-Word הטאב מוגדר בפסקה, לא נכתב כתו)
  const itemLine = it => { const p = itemParts(it); return "<span class='fl'><span class='fn'>" + E(p.name) + "</span><span class='fs'> — </span><span class='fd'>" + E(p.dist) + "</span></span>"; };
  // פריט בשורה, עד cap פריטים; מעבר לכך שורה אחת "ועוד N פריטים (ראו דף הבדיקות)". כל שורה נפתחת ב-<br>, אחרי כותרת הקבוצה
  function listLines(items, cap) {
    return items.slice(0, cap).map(i => "<br>" + itemLine(i)).join("") + (items.length > cap ? "<br>ועוד " + (items.length - cap) + " פריטים (ראו דף הבדיקות)" : "");
  }

  /* ---------- מועדים ---------- */
  function datesText(res) {
    const inp = res.inp, a = C.parseDate(inp.dateFrom), b = C.parseDate(inp.dateTo);
    const one = d => "יום " + C.dayName(d) + " " + C.ddmmyyyy(d);
    const days = inp.dateFrom === inp.dateTo ? one(a) : one(a) + " עד " + one(b);
    const rows = res.sun, per = res.sun.length > 1 || true;
    const win = rows.length ? rows[0].start + "–" + rows[0].end : inp.timeFrom + "–" + inp.timeTo;
    let dn = "";
    if (rows.length) {
      const allDay = rows.every(r => r.nightMin === 0), allNight = rows.every(r => r.dayMin === 0);
      const sd = r => r.sunset + " ב-" + String(r.date.d).padStart(2, "0") + "." + String(r.date.m).padStart(2, "0");
      const f = rows[0], l = rows[rows.length - 1];
      const sunPhrase = rows.length === 1 ? "השקיעה " + f.sunset : "השקיעה: " + sd(f) + (rows.length > 1 ? ", " + sd(l) : "");
      if (allDay) dn = "כל החלון ביום (" + sunPhrase + ")";
      else if (allNight) dn = "כל החלון בלילה (אחרי השקיעה)";
      else dn = "יום: מ-" + f.start + " עד השקיעה · לילה: מהשקיעה עד " + f.end + " (" + sunPhrase + ")";
    }
    return days + "<br>" + (inp.dateFrom === inp.dateTo ? "" : "בכל יום: ") + win + " (שעון מקומי)" + (dn ? "<br>" + E(dn) : "");
  }

  /* ---------- אנשי קשר, משתתפים ומכשולים שידועים למבקש (קלט הבקשה) ---------- */
  // אנשי קשר עם שם (שורה בלי שם מתעלמים ממנה — האימות כבר דחה טלפון בלי שם)
  const namedContacts = inp => (Array.isArray(inp.contacts) ? inp.contacts : []).map(c => ({ name: String((c && c.name) || "").trim(), phone: String((c && c.phone) || "").trim() })).filter(c => c.name);
  // משתתפים נוספים: רק שורה מלאה (שם פרטי, שם משפחה וטלפון); שורה ריקה או חלקית לא נכנסת לפלט
  const fullParticipants = inp => (Array.isArray(inp.participants) ? inp.participants : []).map(p => ({ first: String((p && p.first) || "").trim(), last: String((p && p.last) || "").trim(), phone: String((p && p.phone) || "").trim() }))
    .filter(p => p.first && p.last && p.phone).map(p => ({ name: p.first + " " + p.last, phone: p.phone }));
  // מכשולים שידועים למבקש: שורה לכל פריט כפי שהוקלד (בלי שורות ריקות), בשדה 8; knownObstaclesText = אותם פריטים בשורה אחת מופרדים ב-"; " (לשימושים אחרים)
  const knownObstaclesLines = inp => String(inp.knownObstacles || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const knownObstaclesText = inp => knownObstaclesLines(inp).join("; ");
  // שם הגורם המבקש (שדה 2, מייל, חתימה, יוצר המסמך): מה שהמבקש הקליד, אחרי trim — אין ברירת מחדל של הארגון (האימות ב-core.js דורש ערך)
  const orgName = inp => String((inp && inp.requesterOrg) || "").trim();
  // אות קריאה / מס׳ רישום (שדות 13 ו-14): אופציונליים; ריק => "לא רלוונטי" (cfg.fixed.not_relevant, ובהיעדרו הנוסח הקבוע)
  const optionalId = (v, cfg) => String(v == null ? "" : v).trim() || ((cfg && cfg.fixed && cfg.fixed.not_relevant) || "לא רלוונטי");

  /* ---------- 17 שדות הטופס ---------- */
  function buildForm(res, cfg) {
    const inp = res.inp, R = res.R;
    const air = airInfraLines(res, null, cfg);
    const ins = res.nearScan.inside, ring = res.nearScan.ring;
    let f8;
    if (isRoute(res)) f8 = routeF8Head(res);   // נתיב: הנקודות, האורך והרוחב ופינות הפוליגון (במקום מעגל ונ.צ. מרכזי)
    else f8 = "<b>מעגל</b> — נ.צ. מרכזי:<br><span dir='ltr'>" + E(C.dmsLat(inp.lat)) + " &nbsp; " + E(C.dmsLon(inp.lon)) + "</span> <span class='muted'>(עשרוני: " + inp.lat + ", " + inp.lon + ")</span>";
    if (air.length) f8 += "<br>תשתית אווירית מושפעת: " + air.map(E).join(" ");
    if (res.b09Footnote) f8 += "<br><span class='muted'>" + E(footnoteText(res)) + "</span>";
    // מכשולים ותשתיות: כותרת מודגשת לכל קבוצה ואחריה פריט בשורה (מספר, שם, ומרחק בקצה השורה) — לא פסקה אחת רצופה
    if (ins.length) f8 += "<br><b>מכשולים ותשתיות בתוך האזור (עד " + RW(res) + "):</b>" + listLines(ins, 25);
    if (ring.length) f8 += "<br><b>בקרבת האזור (עד " + RW2(res) + "):</b>" + listLines(ring, 25);
    const sites = res.nearScan.near;
    if (sites.length) f8 += "<br><b>אתרים ותשתיות נוספים בקרבת האזור (עד " + C.fmtDist(R + cfg.thresholds.site_near_m) + " " + FROMTO(res) + "):</b>" + listLines(sites, 25);
    const ko = knownObstaclesLines(inp);   // מכשולים שהמבקש מכיר — הטקסט כלשונו, שורה לכל פריט, בלי תוצאות הצלבה (ההצלבה בדף הבדיקות)
    if (ko.length) f8 += "<br><b>מכשולים שידועים למבקש:</b>" + ko.map(x => "<br>• " + E(x)).join("");
    const vl = inp.vlos ? "קיים קשר עין" : "ללא קשר עין";
    // שדה 11: משתתפים נוספים בטיסה (אם יש שורה מלאה), כל אחד בשורה ממוספרת; שדה 12: אנשי קשר, כל אחד בשורה ממוספרת.
    // class='ph' על כל טלפון: ב-index.html (.paper .ph) הוא white-space:nowrap, כדי שהמספר לא יישבר באמצע בעמודה צרה
    const parts = fullParticipants(inp);
    const participantsHtml = parts.length ? "<br><b>משתתפים נוספים בטיסה:</b>" + parts.map((p, i) => "<br>" + (i + 1) + ". " + E(p.name) + ", <span dir='ltr' class='ph'>" + E(p.phone) + "</span>").join("") : "";
    const contactsHtml = namedContacts(inp).map((c, i) => (i + 1) + ". " + E(c.name) + " — " + (c.phone ? "<span dir='ltr' class='ph'>" + E(c.phone) + "</span>" : "ללא טלפון")).join("<br>");
    const radHtml = R + " מטר &nbsp;<span class='muted'>(= " + C.trimNum(R / 1000, 3) + " ק״מ = " + (R / C.NM).toFixed(3) + " מייל ימי)</span>";   // מטר / ק״מ / מייל ימי (שדה 9; בנתיב — הרוחב מכל צד)
    const rows = [
      ["מס׳ נוטאם", "(ימולא ע״י משרד נוטאם)", "<i class='muted'>(ריק – " + E(cfg.fixed.notam_notam_field) + ")</i>"],
      ["שם/גורם המבקש", "", E(orgName(inp))],
      ["סוג כלי הטיס או מכשול", "כטמ״מ או רב להב = לציין האם קיים קשר עין", E(inp.aircraft.join(", ")) + " — רב להב, " + vl],
      ["מהות הפעילות המבוקשת", "", E(inp.purpose)],
      ["האם הסגירה חלה על מרססים", "(ימולא ע״י חיל האוויר)", "<span class='muted'>כן ☐ &nbsp; לא ☐ &nbsp;·&nbsp; " + E(cfg.fixed.sprayers_note) + "</span>"],
      ["מיקום קרקעי", "(שם ישוב או תשתית אווירית קרובה)", E(inp.siteName)],
      ["מועדי הפעילות", "(יום, תאריך, שעות בזמן מקומי)", datesText(res)],
      ["סגירה/הגבלה", "במקרה של פוליגון או מיקום נקודתי יש לציין תשתיות אוויריות מושפעות · נ״צ גאוגרפי דאטום WGS84 – מעלות/דקות/שניות (DMS)", f8],
      ["רדיוס הסגירה (אם רלוונטי)", "רדיוס ביחידות מטר או ק״מ או מייל ימי (רדיוס בק״מ / 1.852 = רדיוס במייל)", isRoute(res) ? "לא רלוונטי — הסגירה היא פוליגון לאורך נתיב (פינותיו בשדה 8)<br>רוחב מכל צד של הציר: " + radHtml : radHtml],
      ["גבהי הטיסה או גובה המכשול", "מטרים או רגל (m/feet) · מעפ״ש או מעפ״י (AGL/AMSL) · (גובה במטר × 3.28084 = גובה ברגל)", "מגובה: קרקע (0) &nbsp; עד גובה: <b>" + res.ft.toFixed(1) + " רגל</b> (" + C.trimNum(inp.heightM, 2) + " מ׳ × 3.28084)<br>בסיס: מעפ״ש (AGL)"],
      ["מבקש הבקשה + מס׳ טלפון", "", E(inp.requesterName) + ", <span dir='ltr' class='ph'>" + E(inp.requesterPhone) + "</span>" + participantsHtml],
      ["אנשי קשר בשטח בעת הפעלת הסגירה", "2 אנשי קשר + טלפונים", contactsHtml],
      ["אות קריאה", "(אם רלוונטי)", E(optionalId(inp.callsign, cfg))],
      ["מס׳ רישום כלי הטיס", "(אם רלוונטי)", E(optionalId(inp.registration, cfg))],
      ["גודל וצבע הבלון", "(רלוונטי לבלון מעוגן)", E(cfg.fixed.balloon)],
      ["סימוני אזהרה לתעופה (לגבי מכשולים בלבד)", "סימוני יום, תאורת לילה", E(cfg.fixed.warning_markings)],
      ["זמן קיפול מנוף בחירום", "(אם רלוונטי)", E(cfg.fixed.crane)]
    ];
    return rows.map((r, i) => ({ n: i + 1, label: r[0], sub: r[1], html: r[2], text: toText(r[2]) }));
  }
  function toText(h) {
    return String(h).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
  }

  /* ---------- הצהרה ואישור המבקש ---------- */
  // הנוסח המאושר של הצהרת המבקש (index.html #declBox מציג אותו כלשונו; בדיקה ב-core.test.mjs מוודאת שהם זהים). שינוי בנוסח מחייב להקפיץ את version, כי הוא נרשם בנתוני הבקשה בדרייב ליד הטקסט
  const DECLARATION = {
    version: "2026-10-19",
    title: "הצהרה ואישור המבקש",
    paragraphs: [
      "אני מאשר כי עברתי באופן אישי על התצ״א, על רשימת המצאי ועל המפה, וכי אני מודע לאזור ולסכנות הקיימות בו. אין מכשול או תשתית נוספת שלא הופיעו בטופס (או שהוספתי אותם ידנית).",
      "אני מבין כי נתוני המערכת הם כלי עזר בלבד ואין להסתמך עליהם באופן בלעדי: האחריות לבדיקת כלל הסכנות, המגבלות והאיסורים באזור, ולביצוע הטיסה, היא עליי בלבד.",
      "לא תהיה לי כל טענה כלפי המערכת, מפעיליה או יוצריה, בגין מידע חסר, שגוי או לא מעודכן, או בגין פעילות הטיסה."
    ],
    label: "קראתי, הבנתי ואני מאשר את האמור לעיל",
    gate: "יש לאשר את ההצהרה"
  };
  // הרשומה שנשמרת בדרייב בקובץ נתוני הבקשה: גרסת הנוסח, מועד האישור (ISO) והטקסט שהמבקש אישר. at = Date של סימון התיבה; בלי אישור — null
  const declarationRecord = at => at ? { version: DECLARATION.version, confirmedAt: at.toISOString(), text: DECLARATION.paragraphs.join("\n") } : null;
  // טקסט אישור המבקש בדף הבדיקות ובקובץ ה-Word (סעיף ״אישור סקירה אנושית״): קצר ועובדתי — מי אישר ומתי, ומה בהצהרה; בלי סעיף הוויתור
  const reviewText = at => at ? "המבקש אישר ב-" + at.toLocaleString("he-IL") + " את ״" + DECLARATION.title + "״: שעבר באופן אישי על התצ״א, על רשימת המצאי ועל המפה ושהוא מודע לאזור ולסכנות הקיימות בו; שאין מכשול או תשתית נוספת שלא הופיעו בטופס (או שהוסיף אותם ידנית); ושהאחריות לבדיקת כלל הסכנות, המגבלות והאיסורים באזור ולביצוע הטיסה היא עליו בלבד." : "";

  /* ---------- דף הבדיקות ---------- */
  // תא תוצאה: כל ממצא בשורה משלו (מופרד ב-<br>); כשיש יותר משורה אחת הממצאים ממוספרים "1. …". הפריטים הם HTML מוכן (כבר עבר esc)
  const numbered = lines => { const ls = lines.filter(Boolean); return ls.length > 1 ? ls.map((l, i) => (i + 1) + ". " + l).join("<br>") : ls.join(""); };
  const muted = h => "<span class='muted'>" + h + "</span>";
  // ציטוט מהפמ״ת כלשונו בתוך ״…״ בלבד; הסעיף/העמוד/העדכון מופיעים רק בעמודת המקור
  const quote = t => "״" + E(t) + "״";
  const uniq = a => a.filter((x, i) => x && a.indexOf(x) === i);
  // כללי פרק ב-09 שמוצגים בדף הבדיקות: כל כלל בשורה נפרדת (הכותרת ניטרלית וקבועה; ה-ref בעמודת המקור והציטוט בתוצאה)
  const RULE_ROWS = [["4א", "הפעלה במרחב מבוקר אזרחית"], ["5ה1", "הפרדות מופחתות לכטב״ם בקשר עין"], ["6ד", "תכנית טיסה ואישור יחידת הנת״א בסגירה מאושרת"], ["7ב", "הודעה ליחידת הנת״א"],
    ["7ג", "מרחק מגבול אזור הפעילות שאושר"], ["7ד", "הפעלה באזור פיקוח שדה תעופה או בתחום אווירי של מנחת"], ["7ה", "הפעלה בקשר עין ללא סגירה אווירית"], ["7ח", "הפעלה שמחייבת בקשת סגירה אווירית"]];
  function buildChecks(res, data, cfg) {
    const R = res.R, th = cfg.thresholds, inp = res.inp, rows = [];
    const z17 = x => x.src === "a17", zin = res.zones.inside, znear = res.zones.near;
    const zdata = data.zones || {}, gen = zdata.general && zdata.general.LLU;
    // שורת אזור: תג (חפיפה/קרבה), שם האזור, סוג וגובה, מרחק, ואחריו טקסט הפמ״ת של האזור בתוך ״…״. כשאין גובה מובנה והציטוט מוצג בשורה — לא חוזרים עליו
    const altChk = z => (z.alt || !z.pmt) ? zoneAlt(z) : "";
    const zoneLine = (z, tag) => "<b>" + E(tag) + ":</b> " + E(z.label + " (" + [z.kind, altChk(z)].filter(Boolean).join("; ") + ") — " + C.fmtDist(z.d) + " " + FROM(res) + approxMark(z)) + (z.pmt ? " — " + quote(z.pmt) : "");
    const nearRange = "עד " + C.fmtDist(R + th.near_zone_m) + " " + FROMTO(res) + "; אזור שנשרטט בקירוב — עד " + C.fmtDist(R + th.near_zone_m + th.approx_margin_m);
    const a17edition = zdata.edition || "";
    // א-17
    const a_in = zin.filter(z17), a_near = znear.filter(z17), a_all = a_in.concat(a_near);
    const aLines = a_in.map(z => zoneLine(z, "חפיפה לסגירה המבוקשת")).concat(a_near.map(z => zoneLine(z, "בקרבת הסגירה")));
    const lluShown = !!gen && a_all.some(z => z.cat === "LLU");   // הגדרת LLU מהפמ״ת (סעיף 1א) מוצגת פעם אחת בלבד
    if (!aLines.length) aLines.push("אין אזור א-17 בחפיפה לסגירה (" + RW(res) + ") או בקרבתה (" + E(nearRange) + ").");
    else aLines.push(muted("טווח הבדיקה: חפיפה — בתוך הסגירה (" + RW(res) + "); בקרבה — " + E(nearRange) + "."));
    // ההגדרה במלואה, כלשונה (כולל סימוני […] של המקור, חובת יצירת הקשר עם שירות בתי הסוהר והאישור בכתב); רק מרכאות ה-ASCII העוטפות שבקובץ הנתונים מוסרות, כדי שלא יוכפלו
    if (lluShown) aLines.push("הגדרת LLU: " + quote(String(gen.text).trim().replace(/^"/, "").replace(/"$/, "")));
    rows.push(["אזורים אסורים, מוגבלים ומסוכנים (LLP, LLR, LLD, LLU) ובלונים מעוגנים", uniq([a17edition].concat(a_all.map(z => z.pmtRef), lluShown ? [gen.ref] : [])).join(" · "), numbered(aLines)]);
    // חפיפה/קרבה לאזור א-17: מסלול הבקשה לחריגה (בלי להחליט עבור המבקש אם נדרש פטור) — כל הנחיה בשורה נפרדת
    if (a_all.length) {
      const r11 = rule09(data, "A11-3ג"), r17 = rule09(data, "A17-5");
      if (r11) rows.push(["בקשת חריגה מאזור אסור/מוגבל/מסוכן (הנחיית א-11)", r11.ref, quote(r11.text)]);
      if (r17) rows.push(["בקשת חריגה מאזור אסור/מוגבל/מסוכן (הנחיית א-17)", r17.ref, numbered([quote(r17.text), E("המערכת אינה קובעת אם נדרשת חריגה — ההחלטה והפנייה לרת״א הן של המבקש.")])]);
    }
    // פרק ב-09 — אזורי טיסה לכטב״ם (חובה: מוצג תמיד, גם כשאין אזור בקרבה)
    {
      const b_in = zin.filter(isB09), b_near = znear.filter(isB09), ex09 = (res.zones.excluded || []), b_all = b_in.concat(b_near);
      const bLines = b_in.map(z => zoneLine(z, "הסגירה בתוך אזור טיסה לכטב״ם")).concat(b_near.map(z => zoneLine(z, "בקרבת הסגירה")));
      if (!bLines.length) bLines.push("אין אזור טיסה לכטב״ם בחפיפה לסגירה (" + RW(res) + ") או בקרבתה (" + E(nearRange) + ").");
      else bLines.push(muted("טווח הבדיקה: חפיפה — בתוך הסגירה (" + RW(res) + "); בקרבה — " + E(nearRange) + "."));
      if (ex09.length) bLines.push(muted("נשללו לפי גובה (גובה מזערי מעפ״י גבוה מגובה הסגירה בכל קרקע בישראל): " + E(ex09.map(x => x.id).join(", ")) + "."));
      const ed09 = (zdata.rules09 && zdata.rules09.edition) || "פמ״ת פנים ארצי ב-09";
      rows.push(["אזורי טיסה לכטב״ם (פרק ב-09: נספחים ב׳-1, ב׳-2, ב׳-3 ומפת נספח א׳)", uniq([ed09].concat(b_all.map(z => z.pmtRef))).join(" · "), numbered(bLines)]);
      // כשיש אזור ב-09 בחפיפה/בקרבה: ההגדרה הכללית של האזורים, ואם מוצג אזור "גובה מרבי¹" — הערת השוליים כפי שבפמ״ת (הפרדת 1,500/1,000 רגל)
      const intro = zdata.general && zdata.general.B09 && zdata.general.B09.intro;
      if (b_all.length && intro) rows.push(["אזורי טיסה לכטב״ם — הגדרה כללית", intro.ref, quote(intro.text)]);
      if (res.b09Footnote) rows.push(["הערת שוליים ¹ של נספח ב׳-1 (גובה מרבי)", res.b09Footnote.ref, quote("¹ " + String(res.b09Footnote.text).replace(/^1\s*/, ""))]);
    }
    // קשר עין: בסגירה ייעודית הוא חובה (ב-09 סעיף 3(ג)); בקשה "ללא קשר עין" מחייבת הסדר מיוחד שהמערכת אינה יכולה לאמת
    { const r3 = rule09(data, "3ג");
      rows.push(["קשר עין בסגירה ייעודית (פרק ב-09 סעיף 3(ג))", (r3 && r3.ref) || "פרק ב-09",
        inp.vlos ? "הבקשה מציינת: קיים קשר עין." : numbered(["<b>הבקשה מציינת: ללא קשר עין.</b>", r3 ? quote(r3.text) : "", E("המערכת אינה יכולה לוודא אם הדבר מצוין בתעודת כושר הטיסה של כלי הטיס או באישור המנהל.")])]); }
    // כללי ב-09 החלים על כל הפעלה/סגירה — כל כלל בשורה נפרדת, בלי לחשב עבור המבקש אם נדרשת סגירה או אם חל פטור
    { const shown = RULE_ROWS.map(([id, title]) => ({ r: rule09(data, id), title })).filter(x => x.r);
      shown.forEach(x => rows.push([x.title, x.r.ref, quote(x.r.text)]));
      if (shown.length) rows.push(["אחריות המבקש לגבי כללי פרק ב-09", "—", E("המערכת אינה מחשבת עבור המבקש אם נדרשת סגירה, אם חל פטור או אם " + (isRoute(res) ? "הרוחב" : "הרדיוס") + " והגובה שנבחרו עומדים בהפרדות — האחריות לכך על המבקש.")]); }
    // רט״ג
    const n_in = zin.filter(z => z.src === "inpa"), n_near = znear.filter(z => z.src === "inpa");
    const matches = matchUnmapped(data.inpa && data.inpa.unmapped, res.osmProtected.filter(p => p.d <= R + th.near_zone_m));
    const nLines = n_in.map(z => zoneLine(z, "חפיפה")).concat(n_near.map(z => zoneLine(z, "בקרבת הסגירה")),
      matches.map(m => "<b>אתר בנספח ה׳ ללא גבולות בקובץ, שזוהה לפי שם ב-OpenStreetMap:</b> " + E(m.site.id + " ״" + m.site.name + "״ (" + m.osm.name + ", " + C.fmtDist(m.osm.d) + ")")));
    rows.push(["שמורות טבע וגנים לאומיים", (data.inpa && data.inpa.edition) || "", numbered(nLines.length ? nLines : ["אין שמורת טבע או גן לאומי בחפיפה לסגירה או בטווח " + C.fmtDist(R + th.near_zone_m) + " " + FROMTO(res) + "."])]);
    // מנחתים חקלאיים
    const ag = res.agri;
    rows.push(["מנחתים חקלאיים", (data.agri && data.agri.edition) || "",
      ag.length ? (ag[0].d - R <= (th.agri_near_m || 3000) ? "<b>בקרבת הסגירה:</b> " : "אין בסביבה. ") + "הקרוב ביותר: " + E(ag[0].name) + " (" + E(ag[0].ops.join(" / ")) + "), " + C.fmtDist(ag[0].d) + "." : "אין נתונים."]);
    // סריקת סביבה: כותרת מודגשת ואחריה פריט בשורה (הפריטים ממוספרים כבר לפי מספר המפה), שורת בלון אם יש, ושורה אפורה אחרונה עם היקף הסריקה
    const osmBase = data.near && data.near.osm3s && data.near.osm3s.timestamp_osm_base;
    const siteR = R + th.site_near_m;
    const group = (title, items, none) => items.length ? "<b>" + E(title) + "</b><br>" + items.map(i => E(itemText(i))).join("<br>") : "<b>" + E(title) + "</b> " + none;
    const balloons = res.nearScan.items.filter(i => /^בלון/.test(i.label));
    rows.push(["סריקת סביבה: מכשולים, תשתיות קרקעיות, שדות תעופה ומנחתים", "OpenStreetMap" + (osmBase ? ", נתונים מ-" + osmBase.slice(0, 16).replace("T", " ") + " UTC" : ""),
      [group("בתוך " + RW(res) + ":", res.nearScan.inside, "אין."),
        group("בקרבת האזור (עד " + RW2(res) + "):", res.nearScan.ring, "אין."),
        group("אתרים ותשתיות נוספים (עד " + C.fmtDist(siteR) + " " + FROMTO(res) + "):", res.nearScan.near, "אין."),
        balloons.length ? "<b>בלון:</b> " + E(balloons.map(i => i.title + " — " + dLabel(i.d)).join("; ")) + ". גובה העלאה, שעות הפעלה ואופן העיגון אינם מופיעים ב-OpenStreetMap — יש לוודא מול מפעיל הבלון." : "",
        muted("(מכשולים — עד " + C.fmtDist(2 * R) + " " + FROMTO(res) + ": מגדלים, תרנים, ארובות, עגורנים, קווי ועמודי חשמל, תחנות משנה, רכבלים, מבנים בגובה 20 מ׳ ומעלה או 6 קומות ומעלה. אתרים ותשתיות — עד " + C.fmtDist(siteR) + ": תשתיות שדה תעופה ומנחתים, אזורים צבאיים, כבישים מהירים/ראשיים, מסילות, בתי חולים, בתי סוהר, משטרה, אצטדיונים.)")].filter(Boolean).join("<br>")]);
    // מכשולים שידועים למבקש: הצלבה מול סריקת הסביבה לפי מילים בלבד (בלי מיקום) — פריט שלא נמצא מוצג למבקש כדי שיוסיף אותו ידנית
    { const KO_CAP = 5, list = (arr, f) => arr.slice(0, KO_CAP).map(f).join("; ") + (arr.length > KO_CAP ? "; ועוד " + (arr.length - KO_CAP) : "");
      const km = C.matchKnownObstacles(inp.knownObstacles, res.nearScan);
      const koLines = km.map((k, i) => {
        const head = (i + 1) + ". " + quote(k.text) + " — ";
        // מספר הממצא (i+1) ומספרי הפריטים שבמפה הם שני רצפים שונים באותה שורה — התיוג מבהיר שהמספרים בתוך ההתאמות הם לפי המפה (itemText משותף, לא משתנה)
        if (k.found.length) return head + "התאמה אפשרית (מספרי הפריטים לפי המפה): " + E(list(k.found, itemText));
        if (k.census.length) return head + "נמצא בסריקה בקרבה (אינו ברשימת הטופס ואינו ממוספר במפה): " + E(list(k.census, c => c.title + " — " + dLabel(c.d)));
        return head + "לא נמצא בסריקה (מכשולים נסרקים עד " + C.fmtDist(2 * R) + " " + FROMTO(res) + " ואתרים עד " + C.fmtDist(siteR) + "). ייתכן שאינו ממופה ב-OpenStreetMap או שהוא מחוץ לטווח; אם הוא בטווח, יש להוסיפו ידנית בסעיף ״סקירה אנושית ותוספות״.";
      });
      rows.push(["מכשולים שידועים למבקש", "הוזן ע״י המבקש; הצלבה מול סריקת הסביבה (לפי מילים בלבד)",
        km.length ? koLines.join("<br>") + "<br>" + muted("ההצלבה לפי מילים בלבד, בלי מיקום — אינה תחליף לסימון ידני.") : "המבקש לא הזין מכשולים נוספים."]); }
    // שדות תעופה — כל שדה/מנחת בשורה
    const af = res.airfields.filter(a => a.type === "aerodrome").slice(0, 3), hp = res.airfields.filter(a => a.type !== "aerodrome").slice(0, 2);
    rows.push(["שדות תעופה ומנחתים בסביבה (עד " + C.fmtDist(th.airfield_scan_m) + (isRoute(res) ? " מציר הנתיב" : "") + ")", "OpenStreetMap",
      numbered((af.length ? af.map(a => "<b>שדה תעופה:</b> " + E((a.name || "ללא שם") + (a.icao ? " (" + a.icao + ")" : "") + " — " + C.fmtDist(a.d))) : ["שדות תעופה: אין בטווח."])
        .concat(hp.map(a => "<b>מנחת מסוקים:</b> " + E((a.name || "ללא שם") + " — " + C.fmtDist(a.d)))))]);
    // גבולות
    rows.push(["קרבה לגבול מדינה (פמ״ת א-17 סעיף 4)", "OpenStreetMap",
      res.borders.length ? numbered(res.borders.map(b => E("גבול " + b.name + ": " + C.fmtDist(b.d) + " " + FROM(res) + " (מגבלה: " + b.km + " ק״מ) — " + (b.violates ? "הסגירה נכנסת לרצועה" : "הסגירה מחוץ לרצועה") + "."))) : "אין גבול מצרים/סוריה/לבנון בטווח " + C.fmtDist(res.borderScanM || th.border_scan_m) + "."]);
    // נוטמים: סגירות אוויריות עד notam_near_m מקצה הסגירה; מכשולים שפורסמו בנוטם עד site_near_m — שורה לנוטם
    const fetched = data.notamFetchedIso ? data.notamFetchedIso.replace("T", " ").slice(0, 16) + " UTC" : "";
    const nh = res.notams.hits, nob = res.notams.obstacles || [], ex = res.notams.excluded || [];
    const cnt = r => ex.filter(x => x.reason === r).length;
    const win = n => { const f = ms => ms === Infinity ? "קבוע" : new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z"; return f(n.window.from) + " – " + f(n.window.to); };
    const where = n => n.relation === "no-geometry" ? "אין מיקום בנוטם — יש לקרוא" : n.inside ? "חופף לסגירה המבוקשת" : C.fmtDist(n.edge) + " מקצה הסגירה";
    const line = (n, kind) => "<b>" + E(n.id) + "</b>" + (kind ? " (" + kind + ")" : "") + " — " + E(where(n)) + ": " + E((n.heb || n.name || "").split("\n")[0].slice(0, 260)) + " " + muted("(בתוקף " + E(win(n)) + ")");
    const exParts = [];
    [["comms", "תדרים/תקשורת"], ["gnss", "הפרעות GNSS"], ["route", "נתיבים"], ["checklist", "רשימות נוטמים"], ["cancel", "ביטולים"], ["other", "נוטמים אחרים שאינם סגירת מרחב (שדות תעופה, מכשירי ניווט, שינויי נוהל וכד׳)"]].forEach(([k, l]) => { if (cnt(k)) exParts.push(l + ": " + cnt(k)); });
    if (cnt("far")) exParts.push("סגירות/מכשולים רחוקים מהטווח: " + cnt("far"));
    const above = ex.filter(x => x.reason === "above").map(x => x.id);
    if (above.length) exParts.push("בגובה מעל " + C.fmtInt(Math.round(res.ft + 9500)) + " רגל: " + above.join(", "));
    rows.push(["סגירות אוויריות בנוטמים (עד " + C.fmtDist(th.notam_near_m) + " מקצה הסגירה) ומכשולים שפורסמו", "נוטמים שנמשכו " + fetched,
      numbered((nh.length ? nh.map(n => line(n)) : ["אין סגירה אווירית בתוקף בחלון הפעילות במרחק עד " + C.fmtDist(th.notam_near_m) + " מקצה הסגירה."])
        .concat(nob.length ? nob.map(n => line(n, "מכשול שפורסם בנוטם")) : ["מכשולים שפורסמו בנוטם עד " + C.fmtDist(th.site_near_m) + " מקצה הסגירה: אין."],
          exParts.length ? [muted("לא נכללו (אינם סגירה אווירית בטווח): " + E(exParts.join(" · ")) + ".")] : []))]);
    return rows;
  }

  /* ---------- דוח כיסוי: מה נסרק ומה נמצא (מצאי מלא), כולל מה שלא נכנס לטופס ---------- */
  function buildCoverage(res, data, cfg) {
    const th = cfg.thresholds, R = res.R, all = res.nearScan.all || res.nearScan.items;
    const groups = C.COVERAGE_GROUPS.map(g => {
      const it = all.filter(i => i.grp === g), sum = f => it.filter(f).reduce((a, i) => a + i.count, 0);
      return { group: g, found: sum(() => true), inside: sum(i => i.zone === "in"), ring: sum(i => i.zone === "ring"), near: sum(i => i.zone === "near") };
    }).filter(g => g.group !== "הוזן ידנית" || g.found > 0);
    const z = res.zones, a17 = x => x.src === "a17", zl = (data.zones && data.zones.zones) || [], nz = zl.filter(x => !/^B09/.test(x.cat)).length, n09 = zl.length - nz;
    const nt = res.notams, osmN = data.near && data.near.elements ? data.near.elements.length : 0;
    const siteR = R + th.site_near_m;
    const sources = [
      ["אזורי איסור/הגבלה/סכנה (א-17)", nz + " אזורים נבדקו" + ((data.zones && data.zones.approxIds && data.zones.approxIds.length) ? " (מתוכם " + data.zones.approxIds.length + " אזורי LLR משורטטים בקירוב)" : "") + ". בתוך הסגירה: " + z.inside.filter(a17).length + " · בקרבה (עד " + C.fmtDist(th.near_zone_m) + " מקצה הסגירה): " + z.near.filter(a17).length],
      ["אזורי טיסה לכטב״ם (פרק ב-09)", n09 + " אזורים נבדקו" + ((data.zones && data.zones.approx09Ids && data.zones.approx09Ids.length) ? " (מתוכם " + data.zones.approx09Ids.length + " משורטטים בקירוב)" : "") + ". בתוך הסגירה: " + z.inside.filter(isB09).length + " · בקרבה (עד " + C.fmtDist(th.near_zone_m) + " מקצה הסגירה): " + z.near.filter(isB09).length + " · נשללו לפי גובה: " + ((z.excluded || []).length)],
      ["שמורות טבע וגנים לאומיים (רט״ג)", ((data.inpa && data.inpa.sites) ? data.inpa.sites.length : 0) + " אתרים עם גבולות נבדקו (+ " + ((data.inpa && data.inpa.unmapped) ? data.inpa.unmapped.length : 0) + " ללא גבולות — נבדקו לפי שם מול OpenStreetMap). בתוך הסגירה: " + z.inside.filter(x => x.src === "inpa").length + " · בקרבה: " + z.near.filter(x => x.src === "inpa").length],
      ["מנחתים חקלאיים", res.agri.length + " מנחתים נבדקו; הקרוב ביותר: " + (res.agri[0] ? res.agri[0].name + ", " + C.fmtDist(res.agri[0].d) : "—")],
      ["נוטמים", (nt.total || 0) + " נוטמים בקובץ · " + (nt.valid || 0) + " בתוקף בחלון הפעילות · " + nt.hits.length + " סגירות אוויריות בטווח " + C.fmtDist(th.notam_near_m) + " · " + (nt.obstacles ? nt.obstacles.length : 0) + " מכשולים שפורסמו בטווח " + C.fmtDist(th.site_near_m)],
      ["OpenStreetMap — סביבה", osmN + " אלמנטים הוחזרו מהשרת. חיפוש מכשולים (מגדלים, חשמל, מבנים גבוהים...) עד " + C.fmtDist(2 * R) + " " + FROMTO(res) + "; חיפוש אתרים ותשתיות (אצטדיונים, כבישים, מסילות, מנחתים, בלונים, אתרי המונים...) עד " + C.fmtDist(siteR)],
      ["OpenStreetMap — שדות תעופה", res.airfields.length + " שדות תעופה/מנחתים בטווח " + C.fmtDist(th.airfield_scan_m)],
      ["גבולות מדינה (א-17 סעיף 4)", res.borders.length ? res.borders.map(b => b.name + " " + C.fmtDist(b.d)).join(" · ") : "אין גבול מצרים/סוריה/לבנון בטווח " + C.fmtDist(res.borderScanM || th.border_scan_m)],
      ["פריטים שהוזנו ידנית", String((res.inp.manualItems || []).filter(m => (m.name || "").trim()).length)]
    ];
    const co = res.nearScan.censusOnly || [], CAP = 60;
    const censusOnly = co.slice(0, CAP).map(i => ({ title: i.title, grp: i.grp, d: i.d }));
    return { groups, sources, censusOnly, censusMore: Math.max(0, co.length - CAP) };
  }

  function sourceNotes(res, data, cfg) {
    const n = (data.zones && data.zones.approxIds) ? data.zones.approxIds.length : 0;
    return [
      "מקור האיסורים: " + ((data.zones && data.zones.edition) || "") + (data.zones && data.zones.mapVersion ? " (מפת החברים v" + data.zones.mapVersion + ")" : "") + ". " + n + " אזורי LLR שהפמ״ת אינו מפרסם להם קואורדינטות (הן בפרק ENR 5.1 של ה-AIP) משורטטים בקירוב לפי מפת נספח א׳ בפמ״ת — אינם גבול רשמי; בנוסף הם נבדקים מול הנוטמים וסימוני אזור צבאי/מטווח ב-OpenStreetMap.",
      "אזורי הטיסה לכטב״ם (פרק ב-09, עדכון 1/26): " + ((data.zones && data.zones.approx09Ids && data.zones.approx09Ids.length) || 0) + " אזורים (" + ((data.zones && data.zones.approx09Ids) || []).join(", ") + ") משורטטים בקירוב לפי מפת נספח א׳ של הפרק — אינם הגבול הרשמי; שאר האזורים לפי הקואורדינטות בנספחים ב׳-1, ב׳-2 וב׳-3. אזור שגובהו המזערי (מעפ״י) גבוה מגובה הסגירה בכל קרקע בישראל נשלל, והדבר מצוין בדף הבדיקות.",
      "אזורים שנשרטטו בקירוב נבדקים בשולי ביטחון נוספים של " + cfg.thresholds.approx_margin_m + " מ׳ (בנוסף ל-" + cfg.thresholds.near_zone_m + " מ׳ הרגילים), כי גבולם אינו הרשמי (אזורי LLR: אין בפמ״ת קואורדינטות; אזורי ב-09: הקואורדינטות בשורת האזור בנספח ב׳).",
      "אתרי טבע בנספח ה׳ שאין להם גבולות בקובץ: " + ((data.inpa && data.inpa.unmapped && data.inpa.unmapped.length) || 0) + " — נבדקו לפי שם מול OpenStreetMap.",
      "OpenStreetMap הוא מאגר ציבורי שנבנה על ידי מתנדבים: ייתכנו מכשולים שלא סומנו, וגבהים שלא צוינו. סקר האתר של המטיס נשאר בתוקף.",
      "גבולות מרחב מבוקר (CTR/ATZ) אינם בנתונים; מוצג המרחק לשדה התעופה הקרוב ביותר.",
      "הנוטמים נבדקים לפי המיקום והתאריכים בטקסט הנוטם (שורת E או שורת Q). נוטם בלי מיקום מוצג לקריאה."
    ];
  }

  /* ---------- שם קובץ, הגשה, ומודל ל-Word ---------- */
  const safeName = (t, n) => String(t || "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n || 80);
  // "<שם המיקום> — <תאריך הפעילות>" (התיקייה/הקובץ בדרייב)
  function fileBase(res) {
    const a = C.parseDate(res.inp.dateFrom), b = C.parseDate(res.inp.dateTo);
    return safeName(res.inp.siteName, 48) + " — " + C.ddmmyyyy(a) + (res.inp.dateTo !== res.inp.dateFrom ? " עד " + C.ddmmyyyy(b) : "");
  }
  function submissionHtml(res, cfg, data) {
    const wd = res.workingDays, r78 = rule09(data, "7ח");
    return (wd != null ? "ימים א׳–ה׳ מיום ההגשה (" + E(res.todayYmd.split("-").reverse().join(".")) + ") ועד תחילת הפעילות: <b>" + wd + "</b> (המערכת אינה מנכה חגים — אם יש חג בטווח, יש לספור ידנית). הנוהל (א-11 סעיף 6.ב) דורש לפחות " + cfg.thresholds.min_working_days + " ימי עבודה. " : "") +
      "א-11 סעיף 3.ד.4: ״יש להגיש את התכנית בשנית למודיעין טיס יום טרם ביצוע הטיסה במייל <span dir='ltr'>" + E(cfg.mail.fpl) + "</span>״. לעומת זאת בפרק ב-09 סעיף 6(ד) (מצוטט בדף הבדיקות): בסגירה אווירית מאושרת אין חובה להגיש תכנית טיסה, ונדרש אישור מראש מיחידת הנת״א ודיווח אחרי הנחיתה. המערכת אינה מכריעה איזה מהם חל על הפעילות — יש לבדוק מול מודיעין טיס." +
      (r78 ? " הערה: " + E(r78.ref) + " מציין 5 ימי עבודה מראש (״" + E(r78.text) + "״), בעוד פרק א-11 סעיף 6.ב (עדכון 1/26) מחייב לפחות " + cfg.thresholds.min_working_days + "; הבדיקה כאן לפי " + cfg.thresholds.min_working_days + "." : "");
  }
  /* ---------- סיכום והגשה: סעיף 5 בדף הבדיקות למי שאין לו תצוגה מתקדמת ---------- */
  // במקום סעיף ההגשה המלא (submissionHtml, עם הפניות לנוהל) — סיכום קצר בנקודות: מה נמצא בסריקה וכמה ימי עבודה יש עד הפעילות. בלי שום הפניה לפרק, סעיף או עמוד בפמ״ת, ובלי הנחיה להגיש מחדש תכנית טיסה או לפנות למודיעין טיס (החלטת בעל המערכת).
  // אזורי איסור/הגבלה = בלי אזורי טיסה לכטב״ם של פרק ב-09 (src "b09"): אלה אזורים ייעודיים לטיסה ואינם איסור, ולכן אינם נספרים כאן
  // הכול מאותו ניתוח של הטופס: הספירות מ-res (אזורים החופפים לסגירה, נוטמים בקרבה — סגירות ומכשולים שפורסמו, ומכשולים ותשתיות שבשדה 8), וימי העבודה מ-res.workingDays מול cfg.thresholds.min_working_days (כמו בנוסח המלא; בלי ערך — אין שורה)
  const SUBMIT_HEAD = "הגשה", SUMMARY_HEAD = "סיכום והגשה";
  function summaryModel(res, cfg) {
    const min = cfg.thresholds.min_working_days, wd = res.workingDays;
    const counts = { zones: res.zones.inside.filter(z => z.src !== "b09").length, notams: res.notams.hits.length + (res.notams.obstacles || []).length, items: res.nearScan.items.length };
    const ok = wd == null ? null : wd >= min;
    const lines = ["<b>נמצאו בסריקה:</b> אזורי איסור/הגבלה חופפים " + counts.zones + " · נוטמים בקרבה " + counts.notams + " · מכשולים ותשתיות " + counts.items];
    if (wd != null) lines.push("<b>ימי עבודה עד הפעילות:</b> " + wd + " (נדרשים לפחות " + min + ") " + (ok ? "✔" : "✘"));
    return { head: SUMMARY_HEAD, counts, workingDays: wd, minWorkingDays: min, daysOk: ok, lines };
  }
  // הסעיף לפי תצוגת המבקש: adv === true — הנוסח המלא כמות שהוא; כל ערך אחר (גם חסר) — הסיכום (נכשל סגור). html = הנוסח המלא (או ""), lines = נקודות הסיכום (או null)
  function submissionSection(res, cfg, data, adv) {
    if (adv === true) return { head: SUBMIT_HEAD, html: submissionHtml(res, cfg, data), lines: null };
    const s = summaryModel(res, cfg);
    return { head: s.head, html: "", lines: s.lines };
  }
  const whereOf = i => i.zone === "in" ? "בתוך האזור" : i.zone === "ring" ? "בטבעת הכתומה" : "בקרבת האזור";
  /* ---------- שורת המצורפים בטופס והערות המבקש (משותפות ל-UI ול-Word) ---------- */
  // ארבע התמונות המצורפות לכל בקשה: תצ״א ומפת רחובות בתקריב, הדמיה וסימונים במבט כללי, ומפת אזור מרוחקת
  function attachmentsLine() {
    return "<b>חובה לצרף מפה/תצ״א</b> — מצורפות ארבע תמונות: תצ״א ומפת רחובות בתקריב, הדמיה וסימונים במבט כללי, ומפת אזור מרוחקת עם סימון המיקום.";
  }
  // הערות המבקש / ממצאי סיור באתר לסעיף "הנקודה" בדף הבדיקות: HTML מוכן (escaped). תאריך תקין בלי הערות מוצג לבדו; בלי הערות ובלי תאריך — ""
  function visitNoteHtml(res) {
    const inp = res.inp, notes = String(inp.visitNotes || "").trim(), d = C.parseDate(inp.visitDate);
    if (!notes) return d ? "<b>סיור באתר ב-" + C.ddmmyyyy(d) + "</b>" : "";
    return "<b>הערות המבקש" + (d ? " (סיור באתר ב-" + C.ddmmyyyy(d) + ")" : "") + ":</b> " + E(notes).replace(/\r?\n/g, "<br>");
  }
  // o: {images:{aerial,street,overview,region} (כל אחד {bytes,w,h} או null), providerName, providerNames:{aerial,street,overview,region}, includeChecks, draft, review (טקסט), creator, adv (תצוגה מתקדמת של המבקש: true = סעיף ההגשה המלא; אחרת סיכום קצר),
  //     parties (שלב ב׳: מערך שורות ReqParties — עמוד "דיווח לגורמים נוספים" אחרי התמונות ולפני דף הבדיקות; [] = עמוד עם "לא נמצאו גורמים"), partiesDropped (מספר שורות שנחתכו בתקרה), partiesFailed (בניית הרשימה נכשלה)}
  function docxModel(res, data, cfg, o) {
    o = o || {};
    const inp = res.inp, now = o.now || new Date(), pn = o.providerNames || {}, sub = submissionSection(res, cfg, data, o.adv);
    const prov = (k, dflt) => { const p = pn[k] != null ? pn[k] : dflt; return p ? " — " + p : ""; };
    const model = {
      docTitle: "בקשה לסגירה אווירית — " + fileBase(res), creator: o.creator || orgName(inp),
      title: "פמ״ת פנים ארצי א-11 — נספח ג׳", subtitle: "טופס בקשה לסגירה אווירית",
      draftText: o.draft ? "טיוטה — לא מוכן לשליחה: " + o.draft : "",
      rows: buildForm(res, cfg).map(r => (isRoute(res) && r.n === 8 ? { n: r.n, label: r.label, sub: r.sub, html: r.html, split: true, cls: "f8route" } : { n: r.n, label: r.label, sub: r.sub, html: r.html })),   // נתיב: שורת שדה 8 ארוכה ולכן מותר לה להישבר בין עמודים (split: Word) ומקבלת class ‏f8route (מסך/הדפסה); במעגל השורה כמו תמיד
      attachLine: attachmentsLine(),
      mailLine: "*את הבקשה יש להגיש לכתובות המייל: " + cfg.mail.to.join(", "),
      formFooter: cfg.form + " · הופק " + now.toLocaleDateString("he-IL"),
      aerialTitle: "הדמיה מצורפת — תצ״א תקריב" + prov("aerial", o.providerName),
      streetTitle: "הדמיה מצורפת — מפת רחובות תקריב" + prov("street", "OpenStreetMap"),
      overviewTitle: "הדמיה מצורפת — הדמיה וסימונים (מבט כללי, כל מה שמופיע בשדה 8)" + prov("overview", o.providerName),
      regionTitle: "הדמיה מצורפת — מפת אזור (מרוחק)" + prov("region", o.providerName),
      mapNote: (isRoute(res) ? "ירוק: אזור הסגירה (נתיב, " + RW(res) + ") · כתום: עד " + 2 * res.R + " מ׳ מהציר · לבן: ציר הנתיב ונקודותיו P1–P" + res.area.pts.length + " (לפי הסדר)" : "ירוק: אזור הסגירה (" + res.R + " מ׳) · כתום: עד " + 2 * res.R + " מ׳") + " · אדום: אזור אסור/מוגבל (פמ״ת א-17) · כחול: אזור טיסה לכטב״ם (פרק ב-09) · צהוב: מכשול · תכלת: אתר/תשתית קרקעית · סגול: תשתית/מכשול אווירי · ירוק בהיר: אתר המונים/תשתית נוספת. הסימונים מופיעים בכל ארבע התמונות. המספרים תואמים לרשימה בשדה 8; בתקריב מופיעים רק הפריטים שבתוך התצוגה, והשאר במבט הכללי; במפת האזור המרוחקת הפריטים מסומנים בלי מספרים.",
      items: res.nearScan.items.map(i => ({ n: i.n, title: i.title + (i.height ? " · גובה " + C.trimNum(i.height, 0) + " מ׳" : ""), dist: dLabel(i.d), where: whereOf(i) })),
      images: o.images || {},
      includeChecks: !!o.includeChecks,
      checkPoint: C.dmsLat(inp.lat) + " " + C.dmsLon(inp.lon) + " · ירוק: " + res.R + " מ׳ · כתום: עד " + 2 * res.R + " מ׳ · גובה " + C.trimNum(inp.heightM, 2) + " מ׳ (" + res.ft.toFixed(1) + " רגל)",
      visitNote: visitNoteHtml(res),
      checks: buildChecks(res, data, cfg).map(r => [r[0], r[1], r[2]]),
      coverage: (function () { const c = buildCoverage(res, data, cfg); return { groups: c.groups, censusOnly: c.censusOnly.map(i => ({ title: i.title, dist: dLabel(i.d) })), censusMore: c.censusMore }; })(),
      dayNightHead: ["תאריך", "זריחה", "שקיעה", "שעות יום בחלון", "שעות לילה בחלון"],
      dayNight: res.sun.map(r => ["יום " + r.dayName + " " + C.ddmmyyyy(r.date), r.sunrise, r.sunset, C.fmtHM(r.dayMin), C.fmtHM(r.nightMin)]),
      submissionHead: sub.head, submission: sub.html, summary: sub.lines,   // סעיף ההגשה לפי o.adv (תצוגה מתקדמת): נוסח מלא, או סיכום קצר בלי הפניות לנוהל
      review: o.review || "",
      footer: "הופק " + now.toLocaleString("he-IL")
    };
    // נתיב: נקודת ההתחלה והסיום, האורך והרוחב במקום "נקודה + רדיוס" (דף הבדיקות), וכותרות שמחליפות את "הנקודה" / "מרחק מהנקודה" (docx.js: pointHeading, itemsDistHead). במעגל המפתחות האלה אינם במודל כלל
    if (isRoute(res)) {
      const a = res.area, last = a.pts[a.pts.length - 1];
      // שלוש שורות (\n; docx.js מפצל לפסקאות): סיכום בעברית, ואז התחלה וסוף — כל אחת מסתיימת בגוש לטיני אחד (P1/P5 ונ.צ.) בלי סוגריים ובלי מפריד אחריו, כי ב-Word מפריד או סוגר שאחרי ריצה לטינית נכנס לתוכה והשורה מתהפכת
      model.checkPoint = "נתיב: " + a.pts.length + " נקודות · אורך " + routeKm(res) + " ק״מ · ירוק: " + res.R + " מ׳ מכל צד של הציר · כתום: עד " + 2 * res.R + " מ׳ מהציר · גובה " + C.trimNum(inp.heightM, 2) + " מ׳ (" + res.ft.toFixed(1) + " רגל)\nהתחלה: P1 " + dmsText(a.pts[0]) + "\nסוף: P" + a.pts.length + " " + dmsText(last);
      model.pointHeading = "הנתיב"; model.itemsDistHead = "מרחק מהציר";
    }
    // דיווח לגורמים נוספים (שלב ב׳, features.parties): o.parties = מערך השורות (גם ריק). דגל כבוי / מודול לא נטען / o.parties חסר ← אין מפתח parties בכלל, והמודל זהה לשלב א׳
    if (Array.isArray(o.parties)) { const pm = partiesPage(o.parties, cfg, { now, dropped: o.partiesDropped, failed: o.partiesFailed }); if (pm) model.parties = pm; }
    return model;
  }

  /* ---------- דיווח לגורמים נוספים (שלב ב׳, features.parties): עמוד נלווה ב-Word/מסך + שורה במייל ---------- */
  // כל הנוסחים והתוויות מ-ReqParties (TEXT, TYPE_LABEL, STATUS_LABEL) — מקור אחד. המודל הוא טקסט רגיל (לא HTML): ה-Word עובר esc ב-docx.js, והמסך (partiesHtml) עובר E. פרטי הקשר הועתקו כלשונם מהמקור ואינם מאומתים (נאמר בעמוד)
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const partiesOn = cfg => { const P = lazy("parties"); return P && typeof P.enabled === "function" && typeof P.describe === "function" && P.enabled(cfg) ? P : null; };
  const PARTY_SEG_MAX = 3, PARTY_ROWS_MAX = 120;   // קטעים מצוטטים בתא פרטי הקשר (כמו describe({max:3}) ב-Word); תקרת בטיחות לשורות
  // תא "פרטי קשר": שורות {t, b (מודגש), s (קטן), m (אפור)}. עד PARTY_SEG_MAX קטעים (זוגות תווית–מספר נספרים כקטע אחד) בכל השורה, אחריהם "ועוד N"; מקור הפרט — שורה קטנה אחרי הקטעים; אין פרט קשר — "לא נמצא פרט קשר"
  // בלוק בלי קטעים מצוטטים (למשל OSM: טלפון/אתר מתגיות) מוצג כרשימה אחת מופרדת ב-" · ". בלוק שכל קטעיו נחתכו בתקרה לא מוצג כלל (נספר ב"ועוד N") — כך לא מופיע מספר בלי התווית שלו
  function partyContact(P, r) {
    const T = P.TEXT, d = P.describe(r), out = [], none = () => [{ t: T.noContact, m: true }].concat(d.cue ? [{ t: P.txt(d.cue, 240), s: true, m: true }] : []);
    if (d.none) return none();
    const ph = p => P.txt(p.text, 60) + (p.kind === "unverified" ? " (" + T.unverified + ")" : "");
    let left = PARTY_SEG_MAX, more = 0;
    d.blocks.forEach(b => {
      const seg = [];
      if (b.pairs) { if (left > 0) { left--; seg.push(b.pairs.map(x => P.txt(x.label, 40) + " " + ph(x.phone)).join(" · ")); } else more++; }
      else { const k = Math.min(left, b.lines.length); left -= k; more += b.lines.length - k; b.lines.slice(0, k).forEach(l => seg.push(P.txt(l, 240))); }
      const flat = b.pairs || b.lines.length ? [] : [].concat(b.phones.map(ph), b.emails.map(e => P.txt(e, 120)), b.urls.map(u => P.txt(u, 200)));
      if (flat.length) seg.push(flat.join(" · "));
      if (!seg.length) return;
      if (b.label) out.push({ t: P.txt(b.label, 120) + ":", b: true, s: true });
      seg.forEach(t => out.push({ t }));
      if (b.src) out.push({ t: T.srcPrefix + P.txt(b.src, 200), s: true, m: true });
    });
    if (more) out.push({ t: T.more(more), s: true, m: true });
    return out.length ? out : none();
  }
  function partyRow(P, r, i) {
    const T = P.TEXT, party = [{ t: P.txt(r.title, 120), b: true }];
    if (r.tag) party.push({ t: P.txt(r.tag, 60), s: true, m: true });
    if (r.party) party.push({ t: P.txt(r.party, 80), s: true });
    if (r.stale) party.push({ t: T.outOfRange, s: true, m: true });
    let contact; try { contact = partyContact(P, r); } catch (e) { contact = [{ t: T.noContact, m: true }]; }   // שורה פגומה לא מפילה את העמוד (ולא את השליחה)
    return { n: i + 1, party, type: hasOwn(P.TYPE_LABEL, r.type) ? P.TYPE_LABEL[r.type] : "", contact, status: hasOwn(P.STATUS_LABEL, r.status) ? P.STATUS_LABEL[r.status] : P.STATUS_LABEL.unmarked, note: P.txt(r.note, 300) };
  }
  // מעטפת העמוד: {head, sub, summary, rows, empty, note, footer, count}; empty = משפט במקום הטבלה (אין שורות / הכנת הרשימה נכשלה)
  function partiesShell(P, o, rows, empty) {
    const T = P.TEXT, now = o.now instanceof Date && isFinite(+o.now) ? o.now : new Date(), dropped = Math.floor(+o.dropped) > 0 ? Math.floor(+o.dropped) : 0;
    return { head: T.title, sub: T.paperNote, summary: rows.length ? P.summaryText(P.summary(o.list || [])) : "", rows, empty, note: rows.length && dropped ? T.dropped(dropped) : "", footer: T.footer(now.toLocaleString("he-IL")), count: rows.length };
  }
  // המודל לעמוד (Word + מסך). rows = מערך שורות ReqParties; o: {now, dropped, failed}. מחזיר null כשהדגל כבוי / המודול לא נטען. כשל פנימי ← עמוד עם נוסח הכשל (לא חריגה: docxModel נמצא בנתיב השליחה)
  function partiesPage(rows, cfg, o) {
    const P = partiesOn(cfg); if (!P) return null;
    o = o || {};
    try {
      const list = (Array.isArray(rows) ? rows : []).filter(r => r && typeof r === "object").slice(0, PARTY_ROWS_MAX);
      return partiesShell(P, Object.assign({}, o, { list }), list.map((r, i) => partyRow(P, r, i)), list.length ? "" : o.failed ? P.TEXT.failed : P.TEXT.empty);
    } catch (e) { return partiesShell(P, o, [], P.TEXT.failed); }
  }
  // טקסט ל-HTML: escape, ואסימונים לטיניים/ספרתיים (טלפון, דוא״ל, אתר, מזהה) בתוך <bdi dir='ltr'> כדי שלא יתהפכו בפסקה מימין לשמאל (מספר טלפון נושא גם class='ph' — לא נשבר באמצע, ראו index.html). אסימון = אות/ספרה לטינית (+ מפרידים בין אותיות/ספרות, ו-"/" סוגר); פיסוק סוגר (נקודה, פסיק, סוגריים) נשאר מחוץ לו
  const LTR_TOK = /[A-Za-z0-9]+(?:(?:[-.\/:@_%+=&?#~]|:\/\/)[A-Za-z0-9]+)*\/?/g;
  const ltrHtml = t => {
    t = String(t == null ? "" : t); const toks = [];
    t.replace(LTR_TOK, (m, at) => { toks.push({ m, at }); return m; });
    // רצף אסימונים לטיניים המופרדים ברווח בלבד (ביטוי באנגלית: ״TLV APP ON 119.35״) הוא bdi אחד — אחרת כל מילה בנפרד והסדר מתהפך בפסקה מימין לשמאל. שני מספרי טלפון סמוכים נשארים נפרדים (כל אחד nowrap)
    const runs = [];
    toks.forEach(k => { const last = runs[runs.length - 1]; if (last && /^\s+$/.test(t.slice(last.end, k.at)) && (/[A-Za-z]/.test(last.text) || /[A-Za-z]/.test(k.m))) { last.text = t.slice(last.at, k.at + k.m.length); last.end = k.at + k.m.length; } else runs.push({ at: k.at, end: k.at + k.m.length, text: k.m }); });
    let o = "", i = 0; runs.forEach(r => { o += E(t.slice(i, r.at)) + "<bdi dir='ltr'" + (/^[0-9+\/-]+$/.test(r.text) ? " class='ph'" : "") + ">" + E(r.text) + "</bdi>"; i = r.end; }); return o + E(t.slice(i));
  };
  const partyLineHtml = l => { l = l || {}; let h = ltrHtml(l.t); if (l.s) h = "<small>" + h + "</small>"; if (l.b) h = "<b>" + h + "</b>"; if (l.m) h = "<span class='muted'>" + h + "</span>"; return h; };
  // עמוד הקריאה בדוח שעל המסך: זהה בתוכן לעמוד ה-Word (אותו מודל). בלי class='checks' — הוא אינו מושפע מתיבת "כולל דף בדיקות"
  function partiesHtml(m) {
    if (!m || typeof m !== "object" || Array.isArray(m) || typeof m.head !== "string") return "";
    const cell = ls => (Array.isArray(ls) ? ls : []).map(partyLineHtml).join("<br>");
    const rows = Array.isArray(m.rows) ? m.rows : [], W = [4.6, 23.2, 9.1, 29.3, 12.1, 21.7], cols = ["#", "גורם", "סוג", "פרטי קשר", "סטטוס", "הערה"];
    return "<div class='paper parties'><div class='hdr'><span>" + E(m.head) + "</span></div><p class='muted'>" + E(m.sub) + "</p>" +
      (m.summary ? "<p><b>" + E(m.summary) + "</b></p>" : "") +
      (rows.length ? "<table class='t' style='table-layout:fixed' aria-label=\"" + E(m.head) + "\"><colgroup>" + W.map(w => "<col style='width:" + w + "%'>").join("") + "</colgroup><thead><tr>" + cols.map(c => "<th scope='col'>" + E(c) + "</th>").join("") + "</tr></thead><tbody>" +
        rows.map(r => { r = r || {}; return "<tr><td>" + E(r.n) + "</td><td style='overflow-wrap:anywhere'>" + cell(r.party) + "</td><td>" + E(r.type) + "</td><td style='overflow-wrap:anywhere'>" + cell(r.contact) + "</td><td>" + E(r.status) + "</td><td style='overflow-wrap:anywhere'>" + E(r.note) + "</td></tr>"; }).join("") + "</tbody></table>" : "<p>" + E(m.empty) + "</p>") +
      (m.note ? "<p class='muted'>" + E(m.note) + "</p>" : "") + "<div class='foot'><span>" + E(m.footer) + "</span></div></div>";
  }
  // שורת המייל: "דיווח לגורמים נוספים: N גורמים — M דווחו/התקבל אישור" (נוסח ReqParties.mailLine; בלי שמות ובלי טלפונים). parties = מערך שורות או סיכום {total, done}. אין שורות / דגל כבוי ← "" (המייל זהה לשלב א׳)
  function partiesMailLine(parties, cfg) {
    const P = partiesOn(cfg); if (!P) return "";
    const sum = Array.isArray(parties) ? P.summary(parties.filter(r => r && typeof r === "object")) : parties && typeof parties === "object" ? parties : null;
    const int = v => (isFinite(+v) && +v > 0 ? Math.floor(+v) : 0), total = sum ? int(sum.total) : 0;
    return total ? P.mailLine({ total, done: Math.min(total, int(sum.done)) }) : "";
  }

  /* ---------- דוח "בדיקה חוזרת" (Word נפרד; לא מצורף לבקשה שנשלחה למודיעין טיס) ---------- */
  // since = ReqRecheck.sinceModel(diff, ctx) (טקסט רגיל; שורות עודפות ב-rest). מחזיר מודל ל-ReqDocx.buildRecheck, או null כשהדגל כבוי / המודול לא נטען / אין מודל.
  // דף הבדיקות העדכני מצורף (o.includeChecks !== false) בלי סעיף ההגשה ובלי אישור הסקירה — הם שייכים לבקשה עצמה. o: {now, includeChecks, creator}
  function recheckDocxModel(res, data, cfg, since, o) {
    const RC = lazy("recheck"); if (!RC || typeof RC.enabled !== "function" || !RC.enabled(cfg) || !since || typeof since !== "object") return null;
    o = o || {};
    const inp = res.inp, now = o.now || new Date(), STR = RC.STR || {}, name = fileBase(res), b = since.banner || {}, cap = (RC.LIMITS && RC.LIMITS.rowsWord) || 100;
    const base = docxModel(res, data, cfg, { now, includeChecks: true, creator: o.creator });   // שדות דף הבדיקות (לא כולל parties: לא הועבר)
    const rc = {
      banner: [{ t: b.text, b: true, size: 26 }].concat(b.sub ? [{ t: b.sub, b: true, size: 22 }] : [], b.resend ? [{ t: b.resend, size: 20 }] : []),
      title: "בדיקה חוזרת — " + name,
      identity: [["הבקשה", name], ["נקודת מרכז", C.dmsLat(inp.lat) + " " + C.dmsLon(inp.lon)], ["רדיוס וגובה", res.R + " מ׳ · גובה " + C.trimNum(inp.heightM, 2) + " מ׳ (" + res.ft.toFixed(1) + " רגל)"]].concat((since.dates || []).map(d => [d.label, d.value])),
      heading: since.title || STR.title || "שינויים מאז ההגשה", summary: since.summary || "", checkedLine: since.checkedLine || "", notes: since.notes || [],
      sourcesTitle: STR.sources || "מקורות הנתונים", sourcesHead: STR.srcCols || ["מקור", "בהגשה", "כעת"], sources: (since.sources || []).map(s => [s.label, s.before, s.after, !!s.changed]),
      sections: (since.sections || []).map(sc => { const all = (sc.rows || []).concat(sc.rest || []), shown = all.slice(0, cap), hid = all.length - shown.length;
        return { title: sc.title + " (" + sc.total + ")", head: STR.cols || ["סטטוס", "פריט", "פירוט", "מרחק מהנקודה"], rows: shown.map(r => ({ status: r.statusLabel, sev: r.sevLabel, high: r.sev === "high", id: r.id, title: r.title, lines: r.lines || [], dist: r.dist })), more: hid > 0 ? "ועוד " + hid + " שורות אינן מוצגות בדוח זה" : "" }; }),
      limitation: since.limitation || ""
    };
    const out = { recheck: rc, docTitle: "בדיקה חוזרת — " + name, creator: base.creator, includeChecks: o.includeChecks !== false, checksTitle: "דף הבדיקות העדכני — נכון למועד הבדיקה החוזרת",
      checkPoint: base.checkPoint, visitNote: base.visitNote, checks: base.checks, coverage: base.coverage, dayNightHead: base.dayNightHead, dayNight: base.dayNight, footer: base.footer };
    // נתיב: שורות הזהות (נתיב; רוחב וגובה), כותרות ״הנתיב״ / ״מרחק מהציר״ בדף הבדיקות ובטבלאות השינויים. במעגל המודל כמות שהוא
    if (isRoute(res)) {
      const a = res.area;
      rc.identity = [["הבקשה", name], ["נתיב", a.pts.length + " נקודות · אורך " + routeKm(res) + " ק״מ · P1 " + dmsText(a.pts[0]) + " · P" + a.pts.length + " " + dmsText(a.pts[a.pts.length - 1])],
        ["רוחב מכל צד וגובה", res.R + " מ׳ מכל צד של הציר · גובה " + C.trimNum(inp.heightM, 2) + " מ׳ (" + res.ft.toFixed(1) + " רגל)"]].concat((since.dates || []).map(d => [d.label, d.value]));
      rc.sections.forEach(sc => { sc.head = sc.head.slice(0, 3).concat(["מרחק מהציר"]); });
      out.pointHeading = base.pointHeading; out.itemsDistHead = base.itemsDistHead;
    }
    return out;
  }

  /* ---------- KML ---------- */
  function kml(res, data, cfg) {
    const inp = res.inp, P = res.P, R = res.R, X = s => E(C.xmlClean(s));   // ניקוי תווים אסורים ב-XML (בקרה, U+FFFE/FFFF) לפני ה-escape; C.esc המשותפת ל-HTML לא משתנה
    const coords = pts => pts.map(p => p[1] + "," + p[0] + ",0").join(" ");
    const poly = (outer, inner) => "<Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>" + coords(outer) + "</coordinates></LinearRing></outerBoundaryIs>" +
      (inner ? "<innerBoundaryIs><LinearRing><coordinates>" + coords(inner) + "</coordinates></LinearRing></innerBoundaryIs>" : "") + "</Polygon>";
    const circ = r => C.circlePoints(P, r, 96);
    const axisPt = ll => { const q = P.xy(ll[0], ll[1]), n = C.routeNearest(P.route, q[0], q[1]); return P.ll(n.x, n.y); };   // נתיב: הנקודה הקרובה על הציר
    const out = [];
    // נתיב: טבעת ה-2W (C.corridorRing(area, 2)) אינה תמיד תקינה גם כשטבעת ה-W תקינה (חיתוך עצמי / אינה מכילה את הקפסולה): אז פוליגון הכתום מושמט (גאומטריה לא תקינה ב-KML) ומצוינת הערה ב-Document וב-Placemark הירוק; רשימות הפריטים נמדדות מהציר ואינן מושפעות
    const c2 = isRoute(res) ? C.corridorRing(res.area, 2) : null, ring2Ok = !!c2 && c2.ring.length > 0 && c2.simple, note2 = c2 && !ring2Ok && C.corridorRing(res.area, 1).ring.length ? X(NOTE_NO_2W) : "";
    out.push('<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>');
    out.push("<name>" + X("בקשת סגירה אווירית — " + inp.siteName + " — " + C.ddmmyyyy(C.parseDate(inp.dateFrom)) + (inp.dateFrom !== inp.dateTo ? "–" + C.ddmmyyyy(C.parseDate(inp.dateTo)) : "")) + "</name>");
    if (note2) out.push("<description>" + note2 + "</description>");
    out.push('<Style id="green"><LineStyle><color>ff3e8e1e</color><width>3</width></LineStyle><PolyStyle><color>663e8e1e</color></PolyStyle></Style>');
    out.push('<Style id="orange"><LineStyle><color>ff007be0</color><width>3</width></LineStyle><PolyStyle><color>55007be0</color></PolyStyle></Style>');
    out.push('<Style id="red"><LineStyle><color>ff202dd9</color><width>3</width></LineStyle><PolyStyle><color>55202dd9</color></PolyStyle></Style>');
    out.push('<Style id="blue"><LineStyle><color>ffeb6325</color><width>3</width></LineStyle><PolyStyle><color>55eb6325</color></PolyStyle></Style>');   // אזורי טיסה לכטב"ם (ב-09)
    out.push('<Style id="dist"><LineStyle><color>ff202dd9</color><width>2</width></LineStyle></Style>');
    out.push('<Style id="powerline"><LineStyle><color>ff00d4ff</color><width>4</width></LineStyle></Style>');
    out.push('<Style id="ground"><IconStyle><color>ffeed322</color><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_square.png</href></Icon></IconStyle><LineStyle><color>ffeed322</color><width>3</width></LineStyle><PolyStyle><color>55eed322</color></PolyStyle></Style>');
    out.push('<Style id="air"><IconStyle><color>fffb40e0</color><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/airports.png</href></Icon></IconStyle><LineStyle><color>fffb40e0</color><width>3</width></LineStyle><PolyStyle><color>55fb40e0</color></PolyStyle></Style>');
    out.push('<Style id="obst"><IconStyle><color>ff00d4ff</color><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/caution.png</href></Icon></IconStyle><LineStyle><color>ff00d4ff</color><width>2</width></LineStyle><PolyStyle><color>5500d4ff</color></PolyStyle></Style>');
    const route = isRoute(res);
    if (route) out.push('<Style id="route"><LineStyle><color>ffffffff</color><width>4</width></LineStyle></Style>');   // ציר הנתיב: קו לבן (כמו במפה)
    if (route) {
      // נתיב: פוליגון הסגירה (C.corridorRing(area, 1): אותם קודקודים כמו ב-V1..VM בשדה 8) בירוק, טבעת ה-2W בכתום (חור = הפוליגון הירוק, בכיוון הפוך), ציר הנתיב ונקודותיו P1..PN
      const a = res.area, n = a.pts.length, g1 = C.corridorRing(a, 1).ring, g2 = c2.ring;
      if (g1.length) out.push("<Placemark><name>" + X("אזור ההטסה — נתיב, " + R + " מ׳ מכל צד של הציר (אורך " + routeKm(res) + " ק״מ)") + '</name>' + (note2 ? "<description>" + note2 + "</description>" : "") + '<styleUrl>#green</styleUrl>' + poly(g1) + "</Placemark>");
      if (g1.length && ring2Ok) out.push("<Placemark><name>" + X(R + " מ׳ נוספים (עד " + 2 * R + " מ׳ מהציר)") + '</name><styleUrl>#orange</styleUrl>' + poly(g2, g1.slice().reverse()) + "</Placemark>");
      out.push("<Placemark><name>" + X("ציר הנתיב — " + n + " נקודות · " + routeKm(res) + " ק״מ") + "</name><description>" + X("רוחב הסגירה " + R + " מ׳ מכל צד של הציר · גובה " + inp.heightM + " מ׳ (" + res.ft.toFixed(1) + " רגל)") + '</description><styleUrl>#route</styleUrl><LineString><tessellate>1</tessellate><coordinates>' + coords(a.pts) + "</coordinates></LineString></Placemark>");
      a.pts.forEach((q, i) => out.push("<Placemark><name>P" + (i + 1) + "</name><description>" + X("נקודה " + (i + 1) + " מתוך " + n + (i === 0 ? " (התחלה)" : i === n - 1 ? " (סיום)" : "") + " · " + dmsText(q)) + "</description><Point><coordinates>" + q[1] + "," + q[0] + ",0</coordinates></Point></Placemark>"));
    } else {
      out.push("<Placemark><name>נקודת ההטסה (מרכז)</name><description>" + X(C.dmsLat(inp.lat) + " " + C.dmsLon(inp.lon) + " · גובה " + inp.heightM + " מ׳ (" + res.ft.toFixed(1) + " רגל)") + "</description><Point><coordinates>" + inp.lon + "," + inp.lat + ",0</coordinates></Point></Placemark>");
      out.push("<Placemark><name>" + X("אזור ההטסה — רדיוס " + R + " מ׳") + '</name><styleUrl>#green</styleUrl>' + poly(circ(R)) + "</Placemark>");
      out.push("<Placemark><name>" + X(R + " מ׳ נוספים (עד " + 2 * R + " מ׳)") + '</name><styleUrl>#orange</styleUrl>' + poly(circ(2 * R), circ(R).slice().reverse()) + "</Placemark>");
    }
    [...res.zones.inside, ...res.zones.near].forEach(z => {
      const rings = z.z.rings && z.z.rings.length ? z.z.rings : (z.z.c && z.z.r ? [C.circlePoints(new C.Proj(z.z.c[0], z.z.c[1]), z.z.r, 96)] : []);
      rings.forEach(rg => out.push("<Placemark><name>" + X(z.label + " — " + z.kind + "; " + z.alt + (z.approx ? " (שרטוט בקירוב)" : "") + " (" + z.d.toFixed(0) + " מ׳ " + FROM(res) + ")") + '</name><styleUrl>#' + (z.src === "b09" ? "blue" : "red") + '</styleUrl>' + poly(rg) + "</Placemark>"));
      const o = route ? axisPt(z.ll) : [inp.lat, inp.lon];   // נתיב: הקו מהנקודה הקרובה על הציר (המרחק d הוא מהציר)
      if (z.d >= 1) out.push("<Placemark><name>" + X(Math.round(z.d) + " מ׳ עד " + z.id) + '</name><styleUrl>#dist</styleUrl><LineString><tessellate>1</tessellate><coordinates>' + o[1] + "," + o[0] + ",0 " + z.ll[1] + "," + z.ll[0] + ",0</coordinates></LineString></Placemark>");
    });
    if (res.nearScan.items.length) {
      out.push("<Folder><name>מכשולים, אתרים ותשתיות בתוך האזור ובקרבתו (OpenStreetMap)</name>");
      res.nearScan.items.forEach(it => {
        const name = X(it.n + ". " + it.title + " — " + dLabel(it.d));
        const sty = it.tags.power === "line" ? "#powerline" : it.cat === "ground" ? "#ground" : it.cat === "air" ? "#air" : "#obst";
        it.geoms.forEach(g => {
          if (g.pt) out.push("<Placemark><name>" + name + '</name><styleUrl>' + sty + '</styleUrl><Point><coordinates>' + g.pt[1] + "," + g.pt[0] + ",0</coordinates></Point></Placemark>");
          else if (g.closed) out.push("<Placemark><name>" + name + '</name><styleUrl>' + sty + '</styleUrl>' + poly(g.pts) + "</Placemark>");
          else out.push("<Placemark><name>" + name + '</name><styleUrl>' + sty + '</styleUrl><LineString><tessellate>1</tessellate><coordinates>' + coords(g.pts) + "</coordinates></LineString></Placemark>");
        });
      });
      out.push("</Folder>");
    }
    out.push("</Document></kml>");
    return out.join("\n");
  }

  /* ---------- מייל ---------- */
  // נוסח קצר בנקודות: כל הפרטים כבר בטופס ה-Word המצורף, ולכן במייל רק העיקר. שורות הנקודות פותחות ב-"• " (חוזה מול השרת: הוא בונה מהן רשימה ב-htmlBody RTL; בלי שורות כאלה הגוף מוצג כפסקאות)
  // opts (שלב ב׳, אופציונלי): parties = שורות הגורמים (או סיכום {total, done}) — שורת "• דיווח לגורמים נוספים: …" אחרי שורת הסגירה, רק כשיש גורמים והדגל פעיל;
  // update = {sentAt} — שליחה מחדש כעדכון אחרי בדיקה חוזרת (mailUpdate). בלי opts (או עם דגלים כבויים) המייל זהה לשלב א׳
  function mail(res, cfg, opts) {
    opts = opts || {};
    const inp = res.inp, a = C.parseDate(inp.dateFrom), b = C.parseDate(inp.dateTo);
    const dates = inp.dateFrom === inp.dateTo ? "יום " + C.dayName(a) + " " + C.ddmmyyyy(a) : "יום " + C.dayName(a) + " " + C.ddmmyyyy(a) + " עד יום " + C.dayName(b) + " " + C.ddmmyyyy(b);
    const subject = "בקשה לסגירה אווירית — " + inp.siteName + " — " + dates;
    const win = res.sun.length ? res.sun[0].start + "–" + res.sun[0].end : inp.timeFrom + "–" + inp.timeTo;
    const phone = String(inp.requesterPhone == null ? "" : inp.requesterPhone).trim();   // הטלפון אופציונלי בחתימה: ריק — בלי שורה ריקה בסוף
    const partiesBullet = partiesMailLine(opts.parties, cfg);
    const lines = [
      "שלום רב,", "",
      "מצורפת בקשה לסגירה אווירית על גבי הטופס שבנספח ג׳ לפמ״ת א-11 (עדכון 1/26).", "",
      "• גורם מבקש: " + orgName(inp),
      "• מיקום: " + inp.siteName,
      "• מועד: " + dates + (inp.dateFrom === inp.dateTo ? "" : ", בכל יום") + " " + win + " (שעון מקומי)",
      "• סגירה: " + (isRoute(res) ? "נתיב באורך " + C.fmtDist(res.area.lengthM) + " (" + res.area.pts.length + " נקודות), רוחב " + res.R + " מטר מכל צד של הציר" : "מעגל ברדיוס " + res.R + " מטר") + " · גובה " + res.ft.toFixed(1) + " רגל (" + C.trimNum(inp.heightM, 2) + " מטר) מעפ״ש (AGL)"].concat(partiesBullet ? ["• " + partiesBullet] : [], [""], [
      "קבצים מצורפים: טופס הבקשה (Word), קובץ KML וארבע תמונות מפה — תצ״א ומפת רחובות בתקריב, הדמיה וסימונים במבט כללי ומפת אזור מרוחקת.",
      "כל הפרטים — בטופס המצורף.", "",
      "בברכה,", inp.requesterName, orgName(inp)
    ]);
    if (phone) lines.push(phone);
    const body = lines.join("\n");
    const out = { to: cfg.mail.to, subject, body, mailto: "mailto:" + cfg.mail.to.join(",") + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body) };
    return opts.update ? mailUpdate(out, opts.update && opts.update.sentAt != null ? opts.update.sentAt : opts.update, cfg) : out;
  }
  // עדכון בקשה אחרי בדיקה חוזרת (features.recheck): הגוף מקבל "מצורפת בקשה מעודכנת… בקשה זו מחליפה את הבקשה שנשלחה ב-dd.mm.yyyy." (ReqRecheck.updateMail).
  // subject נשאר הנושא הרגיל, כי השרת מוסיף בעצמו את הקידומת "[עדכון לבקשה מ-…] " בשליחה (updateOf); subjectFull = הנושא עם הקידומת — ל-mailto ולהעתקה ידנית (mailto כבר בנוי ממנו). דגל כבוי / מודול חסר ← המייל כמות שהוא
  function mailUpdate(m, sentAt, cfg) {
    const RC = lazy("recheck"); if (!RC || typeof RC.updateMail !== "function" || !RC.enabled(cfg)) return m;
    const u = RC.updateMail(m, sentAt, { cfg });
    return u === m ? m : Object.assign({}, u, { subject: m.subject, subjectFull: u.subject });
  }

  return { isRoute, routeCorners, routeF8Head, fileBase, safeName, submissionHtml, submissionSection, summaryModel, whereOf, attachmentsLine, visitNoteHtml, docxModel, buildForm, buildChecks, buildCoverage, sourceNotes, kml, mail, matchUnmapped, itemText, airInfraLines, toText, dLabel, DECLARATION, declarationRecord, reviewText,
    partiesPage, partiesHtml, partiesMailLine, recheckDocxModel, mailUpdate };
});
