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
  // in: {html (index.html של המפה), meta (pamat-meta.json), zones (zones.json), cfg, mapNotam ({fetched_iso}), notamAll ({fetched_iso})}
  async function check(inp) {
    const problems = [];
    try {
      const h = await sha256Hex(dataText(inp.html));
      if (h !== inp.zones.dataHash) problems.push("נתוני האזורים במפה עודכנו (" + (inp.zones.mapVersion ? "הקובץ שלנו נגזר ממפה v" + inp.zones.mapVersion : "הקובץ שלנו ישן") + ") ועדיין לא יוצאו לבקשות — הייצוא האוטומטי רץ אחרי כל עדכון של המפה; נסו שוב בעוד כמה דקות");
    } catch (e) { problems.push(e.message); }
    const meta = inp.meta || {}, zp = inp.zones.pamat || {};
    if (meta.pamat_update !== zp.update || meta.pamat_date !== zp.date) problems.push("מהדורת הפמ״ת במפה (" + meta.pamat_update + " · " + meta.pamat_date + ") שונה ממה שבקובץ האזורים (" + zp.update + " · " + zp.date + ")");
    const ed = inp.cfg && inp.cfg.pmt_editions && inp.cfg.pmt_editions.package;
    if (!ed) problems.push("חסרה בהגדרות המהדורה שעליה אומתו נוהל א-11, פרק ב-09 וטופס הבקשה");
    else if (ed.update !== meta.pamat_update || ed.date !== meta.pamat_date) problems.push("פורסם עדכון פמ״ת (" + meta.pamat_update + " · " + meta.pamat_date + "), ונוהל א-11, פרק ב-09 וטופס הבקשה אומתו מול " + ed.update + " · " + ed.date + " — יש לאמת אותם מחדש לפני שליחה");
    const a = inp.mapNotam && Date.parse(inp.mapNotam.fetched_iso), b = inp.notamAll && Date.parse(inp.notamAll.fetched_iso);
    if (!(a > 0) || !(b > 0)) problems.push("לא ניתן להשוות את מועד משיכת הנוטמים של המפה ושל הבקשות");
    else if (a - b > MAX_NOTAM_LAG_MS) problems.push("קובץ הנוטמים של הבקשות מפגר אחרי קובץ הנוטמים של המפה (" + Math.round((a - b) / 60000) + " דקות)");
    return { ok: problems.length === 0, problems };
  }
  return { check, dataText, sha256Hex, MARKS };
});
