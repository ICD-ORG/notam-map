/* בדיקת סנכרון עם מפת החברים — מונעת עבודה על מידע ישן.
   המפה מתעדכנת בפרויקט אחר; כאן מוודאים בכל טעינה ש:
   1. נתוני האזורים שמהם נגזר data/zones.json זהים לנתונים שבמפה כרגע (גיבוב SHA-256 של אותם קטעי קוד בדיוק);
   2. מהדורת הפמ"ת במפה (pamat-meta.json) היא המהדורה שעליה אומתו נוהל א-11, פרק ב-09 וטופס הבקשה (config.json → pmt_editions);
   3. קובץ הנוטמים של הבקשות לא מפגר אחרי קובץ הנוטמים של המפה.
   כל אי-התאמה = כשל בשער (הבקשה אינה מוכנה לשליחה) עד שהסנכרון מושלם. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("node:crypto"));
  else root.ReqSync = factory(null);
})(typeof self !== "undefined" ? self : this, function (nodeCrypto) {
  "use strict";
  // חייב להיות זהה ל-dataParts ב-scripts/export-zones.mjs
  const MARKS = [
    ["/* ===== helpers ===== */", "const AIRPORTS=["],
    ["const NO_COORDS=[", "/* ===== פרק ב-09"],
    ["/* ===== פרק ב-09", "/* ===== map ===== */"]
  ];
  function dataText(html) {
    return MARKS.map(([a, b]) => {
      const i = html.indexOf(a); if (i < 0) throw new Error("מבנה המפה השתנה: לא נמצא הסימון " + a);
      const j = html.indexOf(b, i + a.length); if (j < 0) throw new Error("מבנה המפה השתנה: לא נמצא הסימון " + b);
      return html.slice(i, j);
    }).join("");
  }
  async function sha256Hex(text) {
    if (nodeCrypto) return nodeCrypto.createHash("sha256").update(text, "utf8").digest("hex");
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  const MAX_NOTAM_LAG_MS = 15 * 60 * 1000;   // שני הקבצים נכתבים באותה ריצה של המושך
  // חותמת מהדורת הפמ"ת כפי שהיא מוצגת בדף המפה עצמו ("UPDATE 1/26 · 06 AUG 2026") — המקור שהמשתמש רואה
  function htmlStamp(html) { const m = /UPDATE (\d+\/\d+) · (\d{1,2} [A-Z]{3} \d{4})/.exec(html); return m ? { update: m[1], date: m[2] } : null; }
  // in: {html, meta, zones, cfg, mapNotam, notamAll}   — כולם טריים מהרשת (עם עקיפת מטמון)
  //     loaded: {zonesHash, notamIso}                  — הנתונים שבזיכרון הדף (נטענו בטעינה/ברענון האחרון)
  //     analysis: {zonesHash, notamIso} | null         — הנתונים שעליהם נעשה הניתוח האחרון של הבקשה
  // מחזיר {ok, problems, reload (נתוני הדף ישנים מהעדכניים — לטעון מחדש), analysisStale (הבקשה נבדקה על נתונים ישנים — להריץ שוב)}
  async function check(inp) {
    const problems = [];
    let reload = false, analysisStale = false;
    const zhash = inp.zones && inp.zones.dataHash;
    try {
      const h = await sha256Hex(dataText(inp.html));
      if (h !== zhash) problems.push("נתוני האזורים במפה עודכנו (" + (inp.zones.mapVersion ? "הקובץ שלנו נגזר ממפה v" + inp.zones.mapVersion : "הקובץ שלנו ישן") + ") ועדיין לא יוצאו לבקשות — הייצוא האוטומטי רץ אחרי כל עדכון של המפה; נסו שוב בעוד כמה דקות");
    } catch (e) { problems.push(e.message); }
    const meta = inp.meta || {}, zp = inp.zones.pamat || {}, hs = htmlStamp(inp.html);
    if (meta.pamat_update !== zp.update || meta.pamat_date !== zp.date) problems.push("מהדורת הפמ״ת במפה (" + meta.pamat_update + " · " + meta.pamat_date + ") שונה ממה שבקובץ האזורים (" + zp.update + " · " + zp.date + ")");
    if (!hs) problems.push("מבנה המפה השתנה: לא נמצאה חותמת מהדורת הפמ״ת (UPDATE …) בדף המפה");
    else if (hs.update !== meta.pamat_update || hs.date !== meta.pamat_date) problems.push("מהדורת הפמ״ת המוצגת בדף המפה (" + hs.update + " · " + hs.date + ") שונה מ-pamat-meta.json (" + meta.pamat_update + " · " + meta.pamat_date + ") — יש לעדכן את הקובץ");
    const ed = inp.cfg && inp.cfg.pmt_editions && inp.cfg.pmt_editions.package;
    if (!ed) problems.push("חסרה בהגדרות המהדורה שעליה אומתו נוהל א-11, פרק ב-09 וטופס הבקשה");
    else {
      for (const [lbl, st] of [["pamat-meta.json", meta], ["חותמת דף המפה", hs ? { pamat_update: hs.update, pamat_date: hs.date } : null]]) {
        if (st && (ed.update !== st.pamat_update || ed.date !== st.pamat_date)) problems.push("פורסם עדכון פמ״ת (" + lbl + ": " + st.pamat_update + " · " + st.pamat_date + "), ונוהל א-11, פרק ב-09 וטופס הבקשה אומתו מול " + ed.update + " · " + ed.date + " — יש לאמת אותם מחדש לפני שליחה");
      }
    }
    const a = inp.mapNotam && Date.parse(inp.mapNotam.fetched_iso), b = inp.notamAll && Date.parse(inp.notamAll.fetched_iso);
    if (!(a > 0) || !(b > 0)) problems.push("לא ניתן להשוות את מועד משיכת הנוטמים של המפה ושל הבקשות");
    else if (a - b > MAX_NOTAM_LAG_MS) problems.push("קובץ הנוטמים של הבקשות מפגר אחרי קובץ הנוטמים של המפה (" + Math.round((a - b) / 60000) + " דקות)");
    // הנתונים שבזיכרון הדף ושעליהם נעשה הניתוח מול הנתונים העדכניים ברשת
    const freshN = inp.notamAll && inp.notamAll.fetched_iso;
    if (inp.loaded && ((inp.loaded.zonesHash && zhash && inp.loaded.zonesHash !== zhash) || (inp.loaded.notamIso && freshN && Date.parse(freshN) > Date.parse(inp.loaded.notamIso)))) {
      reload = true; problems.push("הנתונים התעדכנו מאז טעינת הדף (אזורים או נוטמים) — הדף טוען אותם מחדש");
    }
    if (inp.analysis && ((inp.analysis.zonesHash && zhash && inp.analysis.zonesHash !== zhash) || (inp.analysis.notamIso && freshN && Date.parse(freshN) > Date.parse(inp.analysis.notamIso)))) {
      analysisStale = true; problems.push("הנתונים התעדכנו אחרי שהבקשה נבדקה — יש להריץ את הבדיקות מחדש");
    }
    return { ok: problems.length === 0, problems, reload, analysisStale };
  }
  return { check, dataText, sha256Hex, htmlStamp, MARKS };
});
