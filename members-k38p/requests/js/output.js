/* הפקת הטופס (נספח ג׳), דף הבדיקות, KML וטקסט המייל מתוצאת הניתוח (request/core.js). בלי DOM — נבדק ב-Node. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./core.js"));
  else root.ReqOut = factory(root.ReqCore);
})(typeof self !== "undefined" ? self : this, function (C) {
  "use strict";
  const E = C.esc;
  const dLabel = d => (d < 1 ? "בתוך השטח" : C.fmtDist(d));

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
  function itemText(it) {
    return it.n + ". " + it.title + " — " + dLabel(it.d) + (it.height ? " · גובה " + C.trimNum(it.height, 0) + " מ׳" : "");
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
    res.zones.near.forEach(z => lines.push("בקרבת האזור: " + z.label + " — במרחק " + C.fmtDist(z.d) + " מהנקודה (" + C.fmtDist(z.edge) + " מקצה הסגירה המבוקשת) — " + z.kind + ", " + zoneAlt(z) + approxMark(z) + "."));
    const have = new Set(); res.nearScan.items.forEach(i => i.ids.forEach(x => have.add(x)));
    res.airfields.filter(a => a.d - R <= th.airfield_near_m && !have.has(a.id)).forEach(a =>
      lines.push("בקרבת האזור: " + (a.type === "aerodrome" ? "שדה תעופה" : "מנחת מסוקים") + (a.name ? " ״" + a.name + "״" : "") + (a.icao ? " (" + a.icao + ")" : "") + " — במרחק " + C.fmtDist(a.d) + " מהנקודה" + (a.inactive ? " (לא פעיל לפי OSM)" : "") + "."));
    res.agri.filter(a => a.d - R <= (th.agri_near_m || 3000)).forEach(a =>
      lines.push("בקרבת האזור: מנחת חקלאי ״" + a.name + "״ (" + a.ops.join(" / ") + ") — במרחק " + C.fmtDist(a.d) + " מהנקודה."));
    res.borders.filter(b => b.violates).forEach(b =>
      lines.push("קרבה לגבול " + b.name + ": הסגירה המבוקשת נמצאת " + C.fmtDist(Math.max(0, b.d - R)) + " מהגבול (פמ״ת א-17 סעיף 4: אין לטוס במרחק של פחות מ-" + b.km + " ק״מ מגבול " + b.name + ")."));
    return lines;
  }
  function listCapped(items, cap) {
    const shown = items.slice(0, cap).map(itemText);
    return shown.join("; ") + (items.length > cap ? "; ועוד " + (items.length - cap) + " פריטים (ראו דף הבדיקות)" : "");
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

  /* ---------- 17 שדות הטופס ---------- */
  function buildForm(res, cfg) {
    const inp = res.inp, R = res.R;
    const air = airInfraLines(res, null, cfg);
    const ins = res.nearScan.inside, ring = res.nearScan.ring;
    let f8 = "<b>מעגל</b> — נ.צ. מרכזי:<br><span dir='ltr'>" + E(C.dmsLat(inp.lat)) + " &nbsp; " + E(C.dmsLon(inp.lon)) + "</span> <span class='muted'>(עשרוני: " + inp.lat + ", " + inp.lon + ")</span>";
    if (air.length) f8 += "<br>תשתית אווירית מושפעת: " + air.map(E).join(" ");
    if (res.b09Footnote) f8 += "<br><span class='muted'>" + E(footnoteText(res)) + "</span>";
    if (ins.length) f8 += "<br>מכשולים ותשתיות בתוך האזור (עד " + R + " מ׳): " + E(listCapped(ins, 25)) + ".";
    if (ring.length) f8 += "<br>בקרבת האזור (עד " + 2 * R + " מ׳): " + E(listCapped(ring, 25)) + ".";
    const sites = res.nearScan.near;
    if (sites.length) f8 += "<br>אתרים ותשתיות נוספים בקרבת האזור (עד " + C.fmtDist(R + cfg.thresholds.site_near_m) + " מהנקודה): " + E(listCapped(sites, 25)) + ".";
    const vl = inp.vlos ? "קיים קשר עין" : "ללא קשר עין";
    const rows = [
      ["מס׳ נוטאם", "(ימולא ע״י משרד נוטאם)", "<i class='muted'>(ריק – " + E(cfg.fixed.notam_notam_field) + ")</i>"],
      ["שם/גורם המבקש", "", E(cfg.org.name)],
      ["סוג כלי הטיס או מכשול", "כטמ״מ או רב להב = לציין האם קיים קשר עין", E(inp.aircraft.join(", ")) + " — רב להב, " + vl],
      ["מהות הפעילות המבוקשת", "", E(inp.purpose)],
      ["האם הסגירה חלה על מרססים", "(ימולא ע״י חיל האוויר)", "<span class='muted'>כן ☐ &nbsp; לא ☐ &nbsp;·&nbsp; " + E(cfg.fixed.sprayers_note) + "</span>"],
      ["מיקום קרקעי", "(שם ישוב או תשתית אווירית קרובה)", E(inp.siteName)],
      ["מועדי הפעילות", "(יום, תאריך, שעות בזמן מקומי)", datesText(res)],
      ["סגירה/הגבלה", "במקרה של פוליגון או מיקום נקודתי יש לציין תשתיות אוויריות מושפעות · נ״צ גאוגרפי דאטום WGS84 – מעלות/דקות/שניות (DMS)", f8],
      ["רדיוס הסגירה (אם רלוונטי)", "רדיוס ביחידות מטר או ק״מ או מייל ימי (רדיוס בק״מ / 1.852 = רדיוס במייל)", R + " מטר &nbsp;<span class='muted'>(= " + C.trimNum(R / 1000, 3) + " ק״מ = " + (R / C.NM).toFixed(3) + " מייל ימי)</span>"],
      ["גבהי הטיסה או גובה המכשול", "מטרים או רגל (m/feet) · מעפ״ש או מעפ״י (AGL/AMSL) · (גובה במטר × 3.28084 = גובה ברגל)", "מגובה: קרקע (0) &nbsp; עד גובה: <b>" + res.ft.toFixed(1) + " רגל</b> (" + C.trimNum(inp.heightM, 2) + " מ׳ × 3.28084)<br>בסיס: מעפ״ש (AGL)"],
      ["מבקש הבקשה + מס׳ טלפון", "", E(inp.requesterName) + ", <span dir='ltr'>" + E(inp.requesterPhone) + "</span>"],
      ["אנשי קשר בשטח בעת הפעלת הסגירה", "2 אנשי קשר + טלפונים", E(inp.contactNames) + " — <span dir='ltr'>" + E(inp.contactPhone) + "</span>"],
      ["אות קריאה", "(אם רלוונטי)", E(cfg.org.callsign)],
      ["מס׳ רישום כלי הטיס", "(אם רלוונטי)", E(cfg.org.registration)],
      ["גודל וצבע הבלון", "(רלוונטי לבלון מעוגן)", E(cfg.fixed.balloon)],
      ["סימוני אזהרה לתעופה (לגבי מכשולים בלבד)", "סימוני יום, תאורת לילה", E(cfg.fixed.warning_markings)],
      ["זמן קיפול מנוף בחירום", "(אם רלוונטי)", E(cfg.fixed.crane)]
    ];
    return rows.map((r, i) => ({ n: i + 1, label: r[0], sub: r[1], html: r[2], text: toText(r[2]) }));
  }
  function toText(h) {
    return String(h).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
  }

  /* ---------- דף הבדיקות ---------- */
  function buildChecks(res, data, cfg) {
    const R = res.R, th = cfg.thresholds, inp = res.inp, rows = [];
    const z17 = x => x.src === "a17", zin = res.zones.inside, znear = res.zones.near;
    const seenNotes = new Set(); // הגדרת LLU מהפמ״ת (סעיף 1א) מוצגת פעם אחת בלבד
    const gen = data.zones && data.zones.general && data.zones.general.LLU;
    const zl = z => {
      let extra = "";
      if (z.cat === "LLU" && gen && !seenNotes.has("LLU")) { seenNotes.add("LLU"); extra += " · לשון הפמ״ת (" + gen.ref + "): " + gen.text.split("גורם המעוניין")[0].trim() + " […]"; }
      if (z.pmt) extra += " · לשון הפמ״ת (" + z.pmtRef + "): ״" + z.pmt + "״";
      return z.id + " ״" + z.name + "״ (" + z.kind + "; " + zoneAlt(z) + ") — " + C.fmtDist(z.d) + " מהנקודה" + approxMark(z) + extra;
    };
    const a17edition = (data.zones && data.zones.edition) || "";
    // א-17
    const a_in = zin.filter(z17), a_near = znear.filter(z17);
    rows.push(["אזורים אסורים, מוגבלים ומסוכנים (LLP, LLR, LLD, LLU) ובלונים מעוגנים", a17edition,
      (a_in.length ? "<b>חפיפה לסגירה המבוקשת:</b> " + a_in.map(zl).map(E).join("; ") + ". " : "בתוך הסגירה (" + R + " מ׳): אין. ") +
      (a_near.length ? "<b>בקרבת הסגירה (עד " + C.fmtDist(R + th.near_zone_m) + " מהנקודה; אזור שנשרטט בקירוב — עד " + C.fmtDist(R + th.near_zone_m + th.approx_margin_m) + "):</b> " + a_near.map(zl).map(E).join("; ") + "." : "בטווח " + C.fmtDist(R + th.near_zone_m) + " מהנקודה: אין אזור נוסף.")]);
    // חפיפה/קרבה לאזור א-17: מסלול הבקשה לחריגה (בלי להחליט עבור המבקש אם נדרש פטור)
    if (a_in.length || a_near.length) {
      const q = ["A11-3ג", "A17-5"].map(id => rule09(data, id)).filter(Boolean);
      if (q.length) rows.push(["בקשת חריגה מאזור אסור/מוגבל/מסוכן (א-11 סעיף 3(ג); א-17 סעיף 5)", a17edition, E(q.map(r => "לשון " + r.ref + ": ״" + r.text + "״").join(" · ") + " · המערכת אינה קובעת אם נדרשת חריגה — ההחלטה והפנייה לרת״א הן של המבקש.")]);
    }
    // פרק ב-09 — אזורי טיסה לכטב״ם (חובה: מוצג תמיד, גם כשאין אזור בקרבה)
    {
      const b_in = zin.filter(isB09), b_near = znear.filter(isB09), ex09 = (res.zones.excluded || []);
      const bz = z => z.label + " (" + z.kind + "; " + zoneAlt(z) + ") — " + C.fmtDist(z.d) + " מהנקודה" + approxMark(z) + " · לשון הפמ״ת (" + z.pmtRef + "): ״" + z.pmt + "״";
      const quotes = ["7ב", "7ג"].map(id => rule09(data, id)).filter(Boolean).map(r => "לשון " + r.ref + ": ״" + r.text + "״").join(" · ");
      const intro = data.zones && data.zones.general && data.zones.general.B09 && data.zones.general.B09.intro;
      rows.push(["אזורי טיסה לכטב״ם (פרק ב-09: נספחים ב׳-1, ב׳-2, ב׳-3 ומפת נספח א׳)", (data.zones && data.zones.rules09 && data.zones.rules09.edition) || "פמ״ת פנים ארצי ב-09",
        (b_in.length ? "<b>הסגירה בתוך אזור טיסה לכטב״ם:</b> " + b_in.map(bz).map(E).join("; ") + ". " : "בתוך הסגירה (" + R + " מ׳): אין אזור טיסה לכטב״ם. ") +
        (b_near.length ? "<b>בקרבת הסגירה (עד " + C.fmtDist(R + th.near_zone_m) + " מהנקודה; אזור שנשרטט בקירוב — עד " + C.fmtDist(R + th.near_zone_m + th.approx_margin_m) + "):</b> " + b_near.map(bz).map(E).join("; ") + ". " : "בטווח " + C.fmtDist(R + th.near_zone_m) + " מהנקודה: אין אזור נוסף. ") +
        ((b_in.length || b_near.length) ? E((intro ? "לשון הפמ״ת (" + intro.ref + "): ״" + intro.text + "״ · " : "") + quotes + (res.b09Footnote ? " · " + footnoteText(res) : "")) : "") +
        (ex09.length ? " <span class='muted'>נשללו לפי גובה (גובה מזערי מעפ״י גבוה מגובה הסגירה בכל קרקע בישראל): " + E(ex09.map(x => x.id).join(", ")) + ".</span>" : "")]);
    }
    // קשר עין: בסגירה ייעודית הוא חובה (ב-09 סעיף 3(ג)); בקשה "ללא קשר עין" מחייבת הסדר מיוחד שהמערכת אינה יכולה לאמת
    { const r3 = rule09(data, "3ג");
      rows.push(["קשר עין בסגירה ייעודית (פרק ב-09 סעיף 3(ג))", (r3 && r3.ref) || "פרק ב-09",
        inp.vlos ? "הבקשה מציינת: קיים קשר עין." : "<b>הבקשה מציינת: ללא קשר עין.</b> " + (r3 ? E("לשון " + r3.ref + ": ״" + r3.text + "״ ") : "") + E("המערכת אינה יכולה לוודא אם הדבר מצוין בתעודת כושר הטיסה של כלי הטיס או באישור המנהל.")]); }
    // כללי ב-09 החלים על כל הפעלה/סגירה — בלשון הפמ״ת, בלי לחשב עבור המבקש אם נדרשת סגירה או אם חל פטור
    { const ids = ["4א", "5ה1", "6ד", "7ב", "7ג", "7ד", "7ה", "7ח"].concat((inp.aircraft || []).length > 1 ? ["2ד", "5ד"] : []);
      const q = ids.map(id => rule09(data, id)).filter(Boolean);
      if (q.length) rows.push(["כללי פרק ב-09 החלים על הפעלת כטב״ם וסגירה אווירית (לשון הפמ״ת)", (data.zones && data.zones.rules09 && data.zones.rules09.edition) || "פמ״ת פנים ארצי ב-09",
        E(q.map(r => "לשון " + r.ref + ": ״" + r.text + "״").join(" · ") + " · הציטוטים מוצגים כלשונם; המערכת אינה מחשבת עבור המבקש אם נדרשת סגירה, אם חל פטור או אם הרדיוס והגובה שנבחרו עומדים בהפרדות — האחריות לכך על המבקש.")]); }
    // רט״ג
    const n_in = zin.filter(z => z.src === "inpa"), n_near = znear.filter(z => z.src === "inpa");
    const matches = matchUnmapped(data.inpa && data.inpa.unmapped, res.osmProtected.filter(p => p.d <= R + th.near_zone_m));
    rows.push(["שמורות טבע וגנים לאומיים", (data.inpa && data.inpa.edition) || "",
      (n_in.length ? "<b>חפיפה:</b> " + n_in.map(zl).map(E).join("; ") + ". " : "בתוך הסגירה: אין. ") +
      (n_near.length ? "<b>בקרבת הסגירה:</b> " + n_near.map(zl).map(E).join("; ") + ". " : "בטווח " + C.fmtDist(R + th.near_zone_m) + ": אין. ") +
      (matches.length ? "<b>אתרי נספח ה׳ ללא גבולות בקובץ שזוהו לפי שם ב-OpenStreetMap:</b> " + matches.map(m => E(m.site.id + " ״" + m.site.name + "״ (" + m.osm.name + ", " + C.fmtDist(m.osm.d) + ")")).join("; ") + "." : "")]);
    // מנחתים חקלאיים
    const ag = res.agri;
    rows.push(["מנחתים חקלאיים", (data.agri && data.agri.edition) || "",
      ag.length ? (ag[0].d - R <= (th.agri_near_m || 3000) ? "<b>בקרבת הסגירה:</b> " : "אין בסביבה. ") + "הקרוב ביותר: " + E(ag[0].name) + " (" + E(ag[0].ops.join(" / ")) + "), " + C.fmtDist(ag[0].d) + "." : "אין נתונים."]);
    // סריקת סביבה
    const osmBase = data.near && data.near.osm3s && data.near.osm3s.timestamp_osm_base;
    const siteR = R + th.site_near_m;
    rows.push(["סריקת סביבה: מכשולים, תשתיות קרקעיות, שדות תעופה ומנחתים", "OpenStreetMap" + (osmBase ? ", נתונים מ-" + osmBase.slice(0, 16).replace("T", " ") + " UTC" : ""),
      (res.nearScan.inside.length ? "<b>בתוך " + R + " מ׳:</b> " + E(res.nearScan.inside.map(itemText).join("; ")) + ". " : "בתוך " + R + " מ׳: אין. ") +
      (res.nearScan.ring.length ? "<b>בקרבת האזור (עד " + 2 * R + " מ׳):</b> " + E(res.nearScan.ring.map(itemText).join("; ")) + ". " : "בטבעת הכתומה (עד " + 2 * R + " מ׳): אין. ") +
      (res.nearScan.near.length ? "<b>אתרים ותשתיות נוספים (עד " + C.fmtDist(siteR) + " מהנקודה):</b> " + E(res.nearScan.near.map(itemText).join("; ")) + "." : "אתרים ותשתיות נוספים (עד " + C.fmtDist(siteR) + "): אין.") +
      (res.nearScan.items.some(i => /^בלון/.test(i.label)) ? "<br><b>בלון:</b> " + E(res.nearScan.items.filter(i => /^בלון/.test(i.label)).map(i => i.title + " — " + dLabel(i.d)).join("; ")) + ". גובה העלאה, שעות הפעלה ואופן העיגון אינם מופיעים ב-OpenStreetMap — יש לוודא מול מפעיל הבלון." : "") +
      " <span class='muted'>(מכשולים — עד " + C.fmtDist(2 * R) + " מהנקודה: מגדלים, תרנים, ארובות, עגורנים, קווי ועמודי חשמל, תחנות משנה, רכבלים, מבנים בגובה 20 מ׳ ומעלה או 6 קומות ומעלה. אתרים ותשתיות — עד " + C.fmtDist(siteR) + ": תשתיות שדה תעופה ומנחתים, אזורים צבאיים, כבישים מהירים/ראשיים, מסילות, בתי חולים, בתי סוהר, משטרה, אצטדיונים.)</span>"]);
    // שדות תעופה
    const af = res.airfields.filter(a => a.type === "aerodrome").slice(0, 3), hp = res.airfields.filter(a => a.type !== "aerodrome").slice(0, 2);
    rows.push(["שדות תעופה ומנחתים בסביבה (עד " + C.fmtDist(th.airfield_scan_m) + ")", "OpenStreetMap",
      (af.length ? "שדות תעופה: " + af.map(a => E((a.name || "ללא שם") + (a.icao ? " (" + a.icao + ")" : "") + " — " + C.fmtDist(a.d))).join("; ") + ". " : "שדות תעופה: אין בטווח. ") +
      (hp.length ? "מנחתי מסוקים: " + hp.map(a => E((a.name || "ללא שם") + " — " + C.fmtDist(a.d))).join("; ") + "." : "")]);
    // גבולות
    rows.push(["קרבה לגבול מדינה (פמ״ת א-17 סעיף 4)", "OpenStreetMap",
      res.borders.length ? res.borders.map(b => E("גבול " + b.name + ": " + C.fmtDist(b.d) + " מהנקודה (מגבלה: " + b.km + " ק״מ) — " + (b.violates ? "הסגירה נכנסת לרצועה" : "הסגירה מחוץ לרצועה"))).join("; ") + "." : "אין גבול מצרים/סוריה/לבנון בטווח " + C.fmtDist(res.borderScanM || th.border_scan_m) + "."]);
    // נוטמים: סגירות אוויריות עד notam_near_m מקצה הסגירה; מכשולים שפורסמו בנוטם עד site_near_m
    const fetched = data.notamFetchedIso ? data.notamFetchedIso.replace("T", " ").slice(0, 16) + " UTC" : "";
    const nh = res.notams.hits, nob = res.notams.obstacles || [], ex = res.notams.excluded || [];
    const cnt = r => ex.filter(x => x.reason === r).length;
    const win = n => { const f = ms => ms === Infinity ? "קבוע" : new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z"; return f(n.window.from) + " – " + f(n.window.to); };
    const where = n => n.relation === "no-geometry" ? "אין מיקום בנוטם — יש לקרוא" : n.inside ? "חופף לסגירה המבוקשת" : C.fmtDist(n.edge) + " מקצה הסגירה";
    const line = n => "<b>" + E(n.id) + "</b> — " + E(where(n)) + ": " + E((n.heb || n.name || "").split("\n")[0].slice(0, 260)) + " <span class='muted'>(בתוקף " + E(win(n)) + ")</span>";
    const exParts = [];
    [["comms", "תדרים/תקשורת"], ["gnss", "הפרעות GNSS"], ["route", "נתיבים"], ["checklist", "רשימות נוטמים"], ["cancel", "ביטולים"], ["other", "נוטמים אחרים שאינם סגירת מרחב (שדות תעופה, מכשירי ניווט, שינויי נוהל וכד׳)"]].forEach(([k, l]) => { if (cnt(k)) exParts.push(l + ": " + cnt(k)); });
    if (cnt("far")) exParts.push("סגירות/מכשולים רחוקים מהטווח: " + cnt("far"));
    const above = ex.filter(x => x.reason === "above").map(x => x.id);
    if (above.length) exParts.push("בגובה מעל " + C.fmtInt(Math.round(res.ft + 9500)) + " רגל: " + above.join(", "));
    const exTxt = exParts.length ? "<br><span class='muted'>לא נכללו (אינם סגירה אווירית בטווח): " + E(exParts.join(" · ")) + ".</span>" : "";
    rows.push(["סגירות אוויריות בנוטמים (עד " + C.fmtDist(th.notam_near_m) + " מקצה הסגירה) ומכשולים שפורסמו", "נוטמים שנמשכו " + fetched,
      (nh.length ? nh.map(line).join("<br>") : "אין סגירה אווירית בתוקף בחלון הפעילות במרחק עד " + C.fmtDist(th.notam_near_m) + " מקצה הסגירה.") +
      "<br>" + (nob.length ? "<b>מכשולים שפורסמו בנוטם (עד " + C.fmtDist(th.site_near_m) + " מקצה הסגירה):</b><br>" + nob.map(line).join("<br>") : "מכשולים שפורסמו בנוטם עד " + C.fmtDist(th.site_near_m) + " מקצה הסגירה: אין.") + exTxt]);
    // שיטת הבדיקה
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
      ["OpenStreetMap — סביבה", osmN + " אלמנטים הוחזרו מהשרת. חיפוש מכשולים (מגדלים, חשמל, מבנים גבוהים...) עד " + C.fmtDist(2 * R) + " מהנקודה; חיפוש אתרים ותשתיות (אצטדיונים, כבישים, מסילות, מנחתים, בלונים, אתרי המונים...) עד " + C.fmtDist(siteR)],
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
  const whereOf = i => i.zone === "in" ? "בתוך האזור" : i.zone === "ring" ? "בטבעת הכתומה" : "בקרבת האזור";
  // o: {images:{map,aerial}, includeChecks, draft, review (טקסט), creator}
  function docxModel(res, data, cfg, o) {
    o = o || {};
    const inp = res.inp, now = o.now || new Date();
    return {
      docTitle: "בקשה לסגירה אווירית — " + fileBase(res), creator: o.creator || cfg.org.name,
      title: "פמ״ת פנים ארצי א-11 — נספח ג׳", subtitle: "טופס בקשה לסגירה אווירית",
      draftText: o.draft ? "טיוטה — לא מוכן לשליחה: " + o.draft : "",
      rows: buildForm(res, cfg).map(r => ({ n: r.n, label: r.label, sub: r.sub, html: r.html })),
      mailLine: "*את הבקשה יש להגיש לכתובות המייל: " + cfg.mail.to.join(", "),
      formFooter: cfg.form + " · הופק " + now.toLocaleDateString("he-IL"),
      mapTitle: "הדמיה מצורפת לבקשה — תקריב" + (o.providerName ? " — " + o.providerName : ""),
      overviewTitle: "הדמיה מצורפת לבקשה — מבט כללי (כל מה שמופיע בשדה 8)",
      mapNote: "ירוק: אזור הסגירה (" + res.R + " מ׳) · כתום: עד " + 2 * res.R + " מ׳ · אדום: אזור אסור/מוגבל (פמ״ת א-17) · צהוב: מכשול · תכלת: אתר/תשתית קרקעית · סגול: תשתית/מכשול אווירי · ירוק בהיר: אתר המונים/תשתית נוספת. המספרים תואמים לרשימה בשדה 8; בתקריב מופיעים רק הפריטים שבתוך התצוגה, והשאר במבט הכללי.",
      items: res.nearScan.items.map(i => ({ n: i.n, title: i.title + (i.height ? " · גובה " + C.trimNum(i.height, 0) + " מ׳" : ""), dist: dLabel(i.d), where: whereOf(i) })),
      images: o.images || {}, aerialTitle: "תצ״א (צילום אוויר) של האזור — ללא סימון",
      includeChecks: !!o.includeChecks,
      checkPoint: C.dmsLat(inp.lat) + " " + C.dmsLon(inp.lon) + " · ירוק: " + res.R + " מ׳ · כתום: עד " + 2 * res.R + " מ׳ · גובה " + C.trimNum(inp.heightM, 2) + " מ׳ (" + res.ft.toFixed(1) + " רגל)",
      checks: buildChecks(res, data, cfg).map(r => [r[0], r[1], r[2]]),
      coverage: (function () { const c = buildCoverage(res, data, cfg); return { sources: c.sources, groups: c.groups, censusOnly: c.censusOnly.map(i => ({ title: i.title, dist: dLabel(i.d) })), censusMore: c.censusMore }; })(),
      dayNightHead: ["תאריך", "זריחה", "שקיעה", "שעות יום בחלון", "שעות לילה בחלון"],
      dayNight: res.sun.map(r => ["יום " + r.dayName + " " + C.ddmmyyyy(r.date), r.sunrise, r.sunset, C.fmtHM(r.dayMin), C.fmtHM(r.nightMin)]),
      submission: submissionHtml(res, cfg, data),
      notes: sourceNotes(res, data, cfg),
      review: o.review || "",
      footer: "מקורות: " + ((data.zones && data.zones.edition) || "") + " · פמ״ת א-11 עדכון 1/26 · OpenStreetMap · נוטמים · הופק " + now.toLocaleString("he-IL")
    };
  }

  /* ---------- KML ---------- */
  function kml(res, data, cfg) {
    const inp = res.inp, P = res.P, R = res.R, X = E;
    const coords = pts => pts.map(p => p[1] + "," + p[0] + ",0").join(" ");
    const poly = (outer, inner) => "<Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>" + coords(outer) + "</coordinates></LinearRing></outerBoundaryIs>" +
      (inner ? "<innerBoundaryIs><LinearRing><coordinates>" + coords(inner) + "</coordinates></LinearRing></innerBoundaryIs>" : "") + "</Polygon>";
    const circ = r => C.circlePoints(P, r, 96);
    const out = [];
    out.push('<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>');
    out.push("<name>" + X("בקשת סגירה אווירית — " + inp.siteName + " — " + C.ddmmyyyy(C.parseDate(inp.dateFrom)) + (inp.dateFrom !== inp.dateTo ? "–" + C.ddmmyyyy(C.parseDate(inp.dateTo)) : "")) + "</name>");
    out.push('<Style id="green"><LineStyle><color>ff3e8e1e</color><width>3</width></LineStyle><PolyStyle><color>663e8e1e</color></PolyStyle></Style>');
    out.push('<Style id="orange"><LineStyle><color>ff007be0</color><width>3</width></LineStyle><PolyStyle><color>55007be0</color></PolyStyle></Style>');
    out.push('<Style id="red"><LineStyle><color>ff202dd9</color><width>3</width></LineStyle><PolyStyle><color>55202dd9</color></PolyStyle></Style>');
    out.push('<Style id="blue"><LineStyle><color>ffeb6325</color><width>3</width></LineStyle><PolyStyle><color>55eb6325</color></PolyStyle></Style>');   // אזורי טיסה לכטב"ם (ב-09)
    out.push('<Style id="dist"><LineStyle><color>ff202dd9</color><width>2</width></LineStyle></Style>');
    out.push('<Style id="powerline"><LineStyle><color>ff00d4ff</color><width>4</width></LineStyle></Style>');
    out.push('<Style id="ground"><IconStyle><color>ffeed322</color><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_square.png</href></Icon></IconStyle><LineStyle><color>ffeed322</color><width>3</width></LineStyle><PolyStyle><color>55eed322</color></PolyStyle></Style>');
    out.push('<Style id="air"><IconStyle><color>fffb40e0</color><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/airports.png</href></Icon></IconStyle><LineStyle><color>fffb40e0</color><width>3</width></LineStyle><PolyStyle><color>55fb40e0</color></PolyStyle></Style>');
    out.push('<Style id="obst"><IconStyle><color>ff00d4ff</color><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/caution.png</href></Icon></IconStyle><LineStyle><color>ff00d4ff</color><width>2</width></LineStyle><PolyStyle><color>5500d4ff</color></PolyStyle></Style>');
    out.push("<Placemark><name>נקודת ההטסה (מרכז)</name><description>" + X(C.dmsLat(inp.lat) + " " + C.dmsLon(inp.lon) + " · גובה " + inp.heightM + " מ׳ (" + res.ft.toFixed(1) + " רגל)") + "</description><Point><coordinates>" + inp.lon + "," + inp.lat + ",0</coordinates></Point></Placemark>");
    out.push("<Placemark><name>" + X("אזור ההטסה — רדיוס " + R + " מ׳") + '</name><styleUrl>#green</styleUrl>' + poly(circ(R)) + "</Placemark>");
    out.push("<Placemark><name>" + X(R + " מ׳ נוספים (עד " + 2 * R + " מ׳)") + '</name><styleUrl>#orange</styleUrl>' + poly(circ(2 * R), circ(R).slice().reverse()) + "</Placemark>");
    [...res.zones.inside, ...res.zones.near].forEach(z => {
      const rings = z.z.rings && z.z.rings.length ? z.z.rings : (z.z.c && z.z.r ? [C.circlePoints(new C.Proj(z.z.c[0], z.z.c[1]), z.z.r, 96)] : []);
      rings.forEach(rg => out.push("<Placemark><name>" + X(z.label + " — " + z.kind + "; " + z.alt + (z.approx ? " (שרטוט בקירוב)" : "") + " (" + z.d.toFixed(0) + " מ׳ מהנקודה)") + '</name><styleUrl>#' + (z.src === "b09" ? "blue" : "red") + '</styleUrl>' + poly(rg) + "</Placemark>"));
      if (z.d >= 1) out.push("<Placemark><name>" + X(Math.round(z.d) + " מ׳ עד " + z.id) + '</name><styleUrl>#dist</styleUrl><LineString><tessellate>1</tessellate><coordinates>' + inp.lon + "," + inp.lat + ",0 " + z.ll[1] + "," + z.ll[0] + ",0</coordinates></LineString></Placemark>");
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
  function mail(res, cfg) {
    const inp = res.inp, a = C.parseDate(inp.dateFrom), b = C.parseDate(inp.dateTo);
    const dates = inp.dateFrom === inp.dateTo ? "יום " + C.dayName(a) + " " + C.ddmmyyyy(a) : "יום " + C.dayName(a) + " " + C.ddmmyyyy(a) + " עד יום " + C.dayName(b) + " " + C.ddmmyyyy(b);
    const subject = "בקשה לסגירה אווירית — " + inp.siteName + " — " + dates;
    const win = res.sun.length ? res.sun[0].start + "–" + res.sun[0].end : inp.timeFrom + "–" + inp.timeTo;
    const lines = [
      "שלום רב,", "",
      "מצורפת בקשה לסגירה אווירית על גבי הטופס שבנספח ג׳ לפמ״ת א-11 (עדכון 1/26).", "",
      "שם/גורם המבקש: " + cfg.org.name,
      "כלי טיס: " + inp.aircraft.join(", ") + " — רב להב, " + (inp.vlos ? "קיים קשר עין" : "ללא קשר עין"),
      "מהות הפעילות: " + inp.purpose,
      "מיקום: " + inp.siteName,
      "מועדים: " + dates + (inp.dateFrom === inp.dateTo ? "" : ", בכל יום") + " " + win + " (שעון מקומי)",
      "סגירה: מעגל ברדיוס " + res.R + " מטר סביב " + C.dmsLat(inp.lat) + " " + C.dmsLon(inp.lon),
      "גובה: " + res.ft.toFixed(1) + " רגל (" + C.trimNum(inp.heightM, 2) + " מטר) מעפ״ש (AGL)",
      "אנשי קשר בשטח: " + inp.contactNames + " — " + inp.contactPhone, "",
      "מצורפים: טופס הבקשה (נספח ג׳, קובץ Word), הדמיות עם סימון האזור על רקע תצ״א, תצ״א נקי של האזור (מפה/תצ״א — נדרש בנספח ג׳), וקובץ KML.", "",
      "בברכה,", inp.requesterName, cfg.org.name, inp.requesterPhone
    ];
    const body = lines.join("\n");
    return { to: cfg.mail.to, subject, body, mailto: "mailto:" + cfg.mail.to.join(",") + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body) };
  }

  return { fileBase, safeName, submissionHtml, whereOf, docxModel, buildForm, buildChecks, buildCoverage, sourceNotes, kml, mail, matchUnmapped, itemText, airInfraLines, toText, dLabel };
});
