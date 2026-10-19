/* הפקת קובץ Word (.docx) ניתן לעריכה מהבקשה: טופס נספח ג׳ (17 שדות), ארבע תמונות (תצ״א תקריב, מפת רחובות תקריב, הדמיה במבט כללי, מפת אזור מרוחקת) ודף בדיקות; בשלב ב׳ — עמוד "דיווח לגורמים נוספים" (model.parties) ודוח "בדיקה חוזרת" נפרד (buildRecheck).
   בלי תלות חיצונית מלבד JSZip (request/vendor/jszip.min.js). רץ בדפדפן וב-Node. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("../vendor/jszip.min.js"));
  else root.ReqDocx = factory(root.JSZip);
})(typeof self !== "undefined" ? self : this, function (JSZip) {
  "use strict";

  // תווים שאסורים ב-XML 1.0 — בקרה פרט לטאב/LF/CR (למשל U+000B מהדבקה מ-Word), חצאי סרוגייט, U+FFFE ו-U+FFFF — מוסרים לפני ה-escape;
  // אחרת document.xml לא תקין ו-Word מסרב לפתוח את הקובץ. esc משמשת את כל טקסט המשתמש: w:t, שמות/תיאורי תמונות ו-core.xml
  const xmlClean = s => {
    let o = "";
    for (const ch of String(s == null ? "" : s)) {
      const c = ch.codePointAt(0);
      if (c === 9 || c === 10 || c === 13 || (c >= 0x20 && c <= 0xd7ff) || (c >= 0xe000 && c <= 0xfffd) || c >= 0x10000) o += ch;
    }
    return o;
  };
  const esc = s => xmlClean(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const decode = s => s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&");
  const FONT = '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/>';
  const LRE = String.fromCharCode(0x202a), PDF = String.fromCharCode(0x202c), RLM = String.fromCharCode(0x200f), LATIN_LETTER = /[A-Za-z]/;
  const HEB = /[֐-׿יִ-ﭏ]/, LAT = /[A-Za-z0-9]/;

  // o.strictBidi (עמודי שלב ב׳ בלבד): ריצה לטינית מסתיימת באות/ספרה האחרונה שלה — רווח, פיסוק וסוגר סוגר שאחריה עוברים לריצת ה-RTL הבאה, כך ש"(LLU)" ו-"OpenStreetMap (שדות תעופה)" אינם מתהפכים.
  // סוגר שנפתח בתוך הריצה הלטינית ("OpenStreetMap (phone, website)") נשאר בה עם הסוגר שלו. בלי strictBidi — הפלט כפי שהיה בשלב א׳ בדיוק
  const TAIL = /[\s()\[\]{}.,;:!?'"״׳\-–—…]+$/;
  function tailsOut(parts) {
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i], m = p.t === "L" && LATIN_LETTER.test(p.s) ? TAIL.exec(p.s) : null; if (!m) continue;
      let core = p.s.slice(0, m.index), tail = m[0], open = (core.match(/\(/g) || []).length - (core.match(/\)/g) || []).length;
      while (open-- > 0 && tail[0] === ")") { core += ")"; tail = tail.slice(1); }
      if (!tail) { p.s = core; continue; }
      p.s = core;
      if (parts[i + 1]) parts[i + 1].s = tail + parts[i + 1].s; else parts.push({ t: "N", s: tail });
    }
  }
  // טקסט -> ריצות: עברית (rtl) מופרדת מלטינית/מספרים (ltr), תווים ניטרליים מצטרפים לריצה הקודמת
  function runsOf(text, o) {
    o = o || {};
    const size = o.size || 22, parts = [];
    let cur = null;
    for (const ch of String(text)) {
      const t = HEB.test(ch) ? "H" : LAT.test(ch) ? "L" : null;
      if (t && (!cur || cur.t !== t)) { cur = { t, s: "" }; parts.push(cur); }
      if (!cur) { cur = { t: "N", s: "" }; parts.push(cur); }
      cur.s += ch;
    }
    if (o.strictBidi) tailsOut(parts);
    return parts.map(p => {
      const rtl = p.t !== "L" && p.t !== "N" ? "<w:rtl/>" : p.t === "N" ? "<w:rtl/>" : "";
      const rpr = "<w:rPr>" + FONT + (o.bold ? "<w:b/><w:bCs/>" : "") + (o.italic ? "<w:i/><w:iCs/>" : "") + (o.color ? '<w:color w:val="' + o.color + '"/>' : "") +
        '<w:sz w:val="' + size + '"/><w:szCs w:val="' + size + '"/>' + rtl + "</w:rPr>";
      // מקטע שיש בו אות לטינית נעטף ב-LRE…PDF כדי שסימנים כמו ° ' " : – לא יתהפכו בתוך פסקה מימין לשמאל, ואחרי ה-PDF בא RLM כדי שהריצה הבאה לא תתחיל במצב "שמאל"
      // ותתמזג עם הגוש הלטיני (אחרת המספור "1. " נדבק למזהה שאחריו והיחידה נפרדת מהמספר). מקטע של ספרות/סוגריים/פיסוק בלבד ("1. ", "7(", "(1") נשאר בתוך ריצת ה-RTL — עטיפה שלו הופכת סוגריים
      const txt = p.t === "L" && LATIN_LETTER.test(p.s) ? LRE + p.s.replace(/\s+$/, "") + PDF + RLM + (/\s+$/.test(p.s) ? p.s.match(/\s+$/)[0] : "") : p.s;
      return "<w:r>" + rpr + '<w:t xml:space="preserve">' + esc(txt) + "</w:t></w:r>";
    }).join("");
  }
  const brRun = size => "<w:r><w:rPr>" + FONT + '<w:sz w:val="' + (size || 22) + '"/></w:rPr><w:br/></w:r>';
  const tabRun = size => "<w:r><w:rPr>" + FONT + '<w:sz w:val="' + (size || 22) + '"/></w:rPr><w:tab/></w:r>';

  // HTML מצומצם (<br>, <b>, <i>, <small>, <span>) -> ריצות.
  // <span class='fs'>…</span> הוא מפריד שורת פריט (output.js itemLine): הטקסט שבו (" — ") לא נכתב ובמקומו בא טאב — הטאב ימני עם קו מנחה (pos בפסקה, ראו para ו-tabEnd), ולכן המרחק שאחריו נצמד לקצה השורה
  function htmlRuns(html, o) {
    o = o || {};
    let bold = !!o.bold, italic = !!o.italic, small = false, sep = false, out = "";
    String(html).split(/(<[^>]+>)/).forEach(tok => {
      if (!tok) return;
      if (tok[0] === "<") {
        const tag = tok.toLowerCase();
        if (/^<br\s*\/?>/.test(tag)) out += brRun(o.size);
        else if (tag === "<b>") bold = true; else if (tag === "</b>") bold = !!o.bold;
        else if (tag === "<i>") italic = true; else if (tag === "</i>") italic = !!o.italic;
        else if (tag === "<small>") small = true; else if (tag === "</small>") small = false;
        else if (/^<span class=['"]fs['"]>$/.test(tag)) { out += tabRun(o.size); sep = true; }
        else if (tag === "</span>") sep = false;
        return;
      }
      if (sep) return;
      const txt = decode(tok); if (!txt) return;
      out += runsOf(txt, { bold, italic, size: small ? Math.max(16, (o.size || 22) - 4) : o.size, color: o.color, strictBidi: o.strictBidi });
    });
    return out;
  }

  const para = (runs, o) => {
    o = o || {};
    // o.tabEnd: טאב ימני עם קו מנחה בקצה השורה (twips מתחילת הפסקה). בפסקה מימין לשמאל "ימני" הוא קצה השורה (שמאל חזותי) — כך המרחק בשורת פריט נצמד לקצה (ראו htmlRuns)
    return "<w:p><w:pPr>" + (o.tabEnd ? '<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="' + o.tabEnd + '"/></w:tabs>' : "") + "<w:bidi/>" + (o.keepNext ? "<w:keepNext/>" : "") + (o.pageBreakBefore ? "<w:pageBreakBefore/>" : "") +
      '<w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after == null ? 60 : o.after) + '" w:line="' + (o.line || 264) + '" w:lineRule="auto"/>' +
      (o.shade ? '<w:shd w:val="clear" w:color="auto" w:fill="' + o.shade + '"/>' : "") + (o.center ? '<w:jc w:val="center"/>' : "") + "</w:pPr>" + runs + "</w:p>";
  };
  const textPara = (text, o) => para(runsOf(text, o), o);
  const htmlPara = (html, o) => para(htmlRuns(html, o), o);
  const heading = text => textPara(text, { bold: true, size: 26, before: 160, after: 80, keepNext: true });

  const cell = (inner, w, o) => {
    o = o || {};
    return '<w:tc><w:tcPr><w:tcW w:w="' + w + '" w:type="dxa"/>' + (o.fill ? '<w:shd w:val="clear" w:color="auto" w:fill="' + o.fill + '"/>' : "") + '<w:vAlign w:val="' + (o.valign || "center") + '"/></w:tcPr>' + inner + "</w:tc>";
  };
  const tableXml = (colWidths, rows, o) => {
    o = o || {};
    const b = '<w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/>';
    // o.strict (עמודי שלב ב׳): bidiVisual לפני tblW, כסדר הסכמה (CT_TblPr); בלי strict — הפלט כפי שהיה בשלב א׳ בדיוק
    return '<w:tbl><w:tblPr>' + (o.strict ? "<w:bidiVisual/>" : "") + '<w:tblW w:w="' + colWidths.reduce((a, c) => a + c, 0) + '" w:type="dxa"/>' + (o.strict ? "" : "<w:bidiVisual/>") + '<w:tblBorders>' + b + '</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="25" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="25" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      "<w:tblGrid>" + colWidths.map(w => '<w:gridCol w:w="' + w + '"/>').join("") + "</w:tblGrid>" +
      rows.map(r => "<w:tr><w:trPr><w:cantSplit/>" + (r.header ? "<w:tblHeader/>" : "") + "</w:trPr>" + r.cells.join("") + "</w:tr>").join("") + "</w:tbl>";
  };

  /* ---------- בנאים בסדר האלמנטים של הסכמה (ECMA-376) — לעמודי שלב ב׳ בלבד ---------- */
  // para/tableXml הקיימות (שלב א׳) מסדרות חלק מהאלמנטים אחרת (למשל keepNext אחרי bidi), והפלט שלהן חייב להישאר זהה בדיוק כשדגלי שלב ב׳ כבויים — לכן העמודים החדשים נבנים בבנאים נפרדים.
  // CT_PPr: keepNext, pageBreakBefore, pBdr, shd, bidi, spacing, jc. o.box = צבע מסגרת (6 ספרות הקס) סביב הפסקה; פסקאות סמוכות עם אותה מסגרת מתמזגות ל"קופסה" אחת
  const HEX6 = /^[0-9A-Fa-f]{6}$/, hex = v => (typeof v === "string" && HEX6.test(v) ? v.toUpperCase() : "");   // צבעים נכנסים כמאפיין XML: רק 6 ספרות הקס, אחרת מושמטים
  const paraS = (runs, o) => {
    o = o || {};
    const box = hex(o.box), shade = hex(o.shade), bd = side => "<w:" + side + ' w:val="single" w:sz="12" w:space="4" w:color="' + box + '"/>';
    return "<w:p><w:pPr>" + (o.keepNext ? "<w:keepNext/>" : "") + (o.pageBreakBefore ? "<w:pageBreakBefore/>" : "") +
      (box ? "<w:pBdr>" + bd("top") + bd("left") + bd("bottom") + bd("right") + "</w:pBdr>" : "") +
      (shade ? '<w:shd w:val="clear" w:color="auto" w:fill="' + shade + '"/>' : "") + "<w:bidi/>" +
      '<w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after == null ? 60 : o.after) + '" w:line="' + (o.line || 264) + '" w:lineRule="auto"/>' + (o.center ? '<w:jc w:val="center"/>' : "") + "</w:pPr>" + runs + "</w:p>";
  };
  const textParaS = (text, o) => { o = o || {}; return paraS(runsOf(text == null ? "" : text, Object.assign({}, o, { color: hex(o.color) || undefined, strictBidi: true })), o); };
  const htmlParaS = (html, o) => paraS(htmlRuns(html, Object.assign({}, o, { color: hex((o || {}).color) || undefined, strictBidi: true })), o);
  const headingS = (text, o) => textParaS(text, Object.assign({ bold: true, size: 26, before: 160, after: 80, keepNext: true }, o));
  // שורות תא: [{t, b (מודגש), s (קטן), m (אפור), c (צבע)}] — כל שורה בפסקה משלה, בלי HTML; base = גודל הגופן הרגיל (חצאי נקודות)
  const cellLines = (lines, base) => {
    const ls = (Array.isArray(lines) ? lines : []).filter(l => l && l.t != null && String(l.t) !== "");
    return (ls.length ? ls : [{ t: "" }]).map((l, i) => textParaS(l.t, { size: l.s ? Math.max(14, base - 3) : base, bold: !!l.b, color: hex(l.c) || (l.m ? "666666" : ""), after: i === ls.length - 1 ? 0 : 20, line: 245 })).join("");
  };
  const hdrRow = (cols, w) => ({ header: true, cells: cols.map((t, i) => cell(textParaS(t, { bold: true, size: 19, after: 0 }), w[i], { fill: "EEEEEE" })) });

  function imageXml(rid, id, wEmu, hEmu, name, descr) {
    return '<w:p><w:pPr><w:bidi/><w:spacing w:before="60" w:after="60"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + wEmu + '" cy="' + hEmu + '"/><wp:docPr id="' + id + '" name="' + esc(name) + '" descr="' + esc(descr) + '"/>' +
      '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="' + id + '" name="' + esc(name) + '"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + wEmu + '" cy="' + hEmu + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  }

  const PAGE_W = 11906, PAGE_H = 16838, MARGIN = 1000, CONTENT_W = PAGE_W - 2 * MARGIN; // twips
  const CM = 360000; // EMU לסנטימטר

  // model: {title, subtitle, draftText, rows:[{n,label,sub,html}], attachLine, mailLine, formFooter, aerialTitle, streetTitle, overviewTitle, regionTitle, mapNote, items:[{n,title,dist,where}],
  //         images:{aerial,street,overview,region} (כל אחד {bytes,w,h}), checkPoint, visitNote (HTML), checks:[[name,source,html]], coverage:{groups,censusOnly,censusMore}, dayNight:[[...]], dayNightHead,
  //         submissionHead, submission (HTML; הנוסח המלא) או summary ([HTML] נקודות הסיכום), review, footer, includeChecks}
  async function build(m) {
    const body = [];
    // ----- עמוד 1: הטופס -----
    if (m.draftText) body.push(textPara(m.draftText, { bold: true, color: "8A1010", shade: "FFE3E3", after: 100 }));
    body.push(tableXml([CONTENT_W * 0.55 | 0, CONTENT_W - (CONTENT_W * 0.55 | 0)], [{ cells: [
      cell(textPara(m.title, { bold: true, size: 24, after: 0 }), CONTENT_W * 0.55 | 0, { fill: "FFFFFF" }),
      cell(textPara(m.subtitle, { bold: true, size: 24, after: 0 }), CONTENT_W - (CONTENT_W * 0.55 | 0), { fill: "FFFFFF" })] }]));
    body.push(para("", { after: 80 }));
    const wl = (CONTENT_W * 0.40) | 0, wv = CONTENT_W - wl;
    body.push(tableXml([wl, wv], m.rows.map(r => ({ cells: [
      cell(para(runsOf(r.n + ". " + r.label, { bold: true, size: 19 }), { after: r.sub ? 20 : 0 }) + (r.sub ? textPara(r.sub, { size: 14, color: "444444", after: 0 }) : ""), wl, { fill: "EFEFEF" }),
      cell(htmlPara(r.html, { size: 19, after: 0, line: 245, tabEnd: /class=['"]fs['"]/.test(r.html) ? wv - 200 : 0 }), wv)] }))));   // שורות פריט בשדה 8: הטאב הימני בקצה התא (רוחב התא פחות שולי התא)
    body.push(htmlPara((m.attachLine || "<b>חובה לצרף מפה/תצ״א</b>") + "<br>" + esc(m.mailLine || ""), { size: 20, before: 100 }));
    body.push(textPara(m.formFooter || "", { size: 16, color: "555555" }));

    // ----- עמודי התמונות: תצ״א, מפת רחובות, מבט כללי (+ טבלת הפריטים), מפת אזור -----
    const imgs = [];
    const addImg = (img, name, descr) => {
      const w = 16.6 * CM, h = w * img.h / img.w, rid = "rId" + (100 + imgs.length);
      imgs.push({ rid, bytes: img.bytes, name: name + ".jpeg" });
      return imageXml(rid, imgs.length, Math.round(w), Math.round(h), name, descr);
    };
    const im = m.images || {};
    let noteDone = !m.mapNote;   // מקרא הצבעים מתחת לתמונה הראשונה (בדרך כלל התצ״א; אם היא חסרה — מתחת לראשונה שקיימת)
    const imagePage = (key, title) => {
      body.push(textPara(title, { bold: true, size: 26, pageBreakBefore: true, after: 80 })); body.push(addImg(im[key], key, title));
      if (!noteDone) { noteDone = true; body.push(textPara(m.mapNote, { size: 18, color: "444444" })); }
    };
    if (im.aerial) imagePage("aerial", m.aerialTitle || "תצ״א תקריב");
    if (im.street) imagePage("street", m.streetTitle || "מפת רחובות תקריב");
    if (im.overview) imagePage("overview", m.overviewTitle || "מבט כללי");
    if (m.items && m.items.length) {
      if (!im.overview) body.push(textPara(m.overviewTitle || "מבט כללי", { bold: true, size: 26, pageBreakBefore: true, after: 80 }));
      body.push(heading("מכשולים, אתרים ותשתיות המסומנים במפה"));
      const w = [700, 4700, 1800, CONTENT_W - 7200];
      body.push(tableXml(w, [{ header: true, cells: ["#", "מה", "מרחק מהנקודה", "איפה"].map((t, i) => cell(textPara(t, { bold: true, size: 20, after: 0 }), w[i], { fill: "EEEEEE" })) }]
        .concat(m.items.map(it => ({ cells: [String(it.n), it.title, it.dist, it.where].map((t, i) => cell(textPara(t, { size: 20, after: 0 }), w[i])) })))));
    }
    if (im.region) imagePage("region", m.regionTitle || "מפת אזור (מרוחק)");
    // ----- דיווח לגורמים נוספים (שלב ב׳, features.parties): עמוד נלווה אחרי הטופס והתמונות ולפני דף הבדיקות; נכלל תמיד כשיש מודל (גם כש-includeChecks כבוי) -----
    if (m.parties) partiesBody(m.parties).forEach(x => body.push(x));
    // ----- דף בדיקות -----
    if (m.includeChecks) checksPages(body, m);
    body.push(textPara(m.footer || "", { size: 16, color: "555555", before: 120 }));

    return pack(body, imgs, m);
  }

  // דף הבדיקות: כותרות סעיף ממוספרות במונה רץ (רק סעיפים שמוצגים). משותף לבקשה (build) ולדוח הבדיקה החוזרת (buildRecheck); גוף הפונקציה הועבר מ-build כמות שהוא
  // strict (דוח הבדיקה החוזרת בלבד): בנאים בסדר האלמנטים של הסכמה; בלעדיו — הבנאים של שלב א׳, והפלט זהה לו בדיוק
  function checksPages(body, m, strict) {
    const tp = strict ? textParaS : textPara, hp = strict ? htmlParaS : htmlPara, hd = strict ? headingS : heading, tb = (w, r) => tableXml(w, r, strict ? { strict: true } : undefined);
    let sec = 0;
    const secHeading = t => hd(++sec + ". " + t);
    body.push(tp(m.checksTitle || "דף בדיקות — לא חלק מהטופס הרשמי", { bold: true, size: 26, pageBreakBefore: true, after: 80 }));
    body.push(secHeading("הנקודה"));
    body.push(tp(m.checkPoint || "", { size: 20 }));
    if (m.visitNote) body.push(hp(m.visitNote, { size: 20 }));
    body.push(secHeading("הבדיקות שבוצעו"));
    // עמודה ראשונה צרה "#" = מספר השורה; שאר העמודות: בדיקה / מקור / תוצאה
    const nw = 560, cw = [nw, CONTENT_W * 0.20 | 0, CONTENT_W * 0.16 | 0, CONTENT_W - nw - (CONTENT_W * 0.20 | 0) - (CONTENT_W * 0.16 | 0)];
    body.push(tb(cw, [{ header: true, cells: ["#", "בדיקה", "מקור", "תוצאה"].map((t, i) => cell(tp(t, { bold: true, size: 19, after: 0 }), cw[i], { fill: "EEEEEE" })) }]
      .concat((m.checks || []).map((r, k) => ({ cells: [cell(tp(String(k + 1), { size: 19, after: 0 }), cw[0], { valign: "top" }), cell(tp(r[0], { size: 19, after: 0 }), cw[1], { valign: "top" }), cell(tp(r[1], { size: 17, after: 0 }), cw[2], { valign: "top" }), cell(hp(r[2], { size: 19, after: 0 }), cw[3], { valign: "top" })] })))));
    if (m.coverage) {
      body.push(secHeading("מצאי לפי קבוצות"));
      const gw = [CONTENT_W * 0.40 | 0, 1200, 1400, 1400, CONTENT_W - (CONTENT_W * 0.40 | 0) - 4000];
      body.push(tb(gw, [{ header: true, cells: ["קבוצה", "נמצאו", "בתוך הסגירה", "בטבעת הכתומה", "בקרבה"].map((t, i) => cell(tp(t, { bold: true, size: 19, after: 0 }), gw[i], { fill: "EEEEEE" })) }]
        .concat(m.coverage.groups.map(g => ({ cells: [g.group, String(g.found), String(g.inside), String(g.ring), String(g.near)].map((t, i) => cell(tp(t, { size: 19, after: 0 }), gw[i])) })))));
      if (m.coverage.censusOnly && m.coverage.censusOnly.length) {
        // תת-סעיף של סעיף המצאי ("3.1"), לא סעיף חדש — כדי שמספור הסעיפים יישאר ברצף; הנוסח זהה לצד המסך (ui.js)
        body.push(tp(sec + ".1 פריטים נוספים שנמצאו בקרבה ואינם בטופס", { bold: true, size: 22, before: 100, after: 60, keepNext: true }));
        body.push(tp(m.coverage.censusOnly.map(i => i.title + " — " + i.dist).join("; ") + (m.coverage.censusMore ? "; ועוד " + m.coverage.censusMore + " פריטים" : "") + ".", { size: 19 }));
      }
    }
    if (m.dayNight && m.dayNight.length) {
      body.push(secHeading("יום ולילה בחלון הפעילות"));
      const dw = [CONTENT_W * 0.28 | 0, 1500, 1500, 1800, CONTENT_W - (CONTENT_W * 0.28 | 0) - 4800];
      body.push(tb(dw, [{ header: true, cells: (m.dayNightHead || []).map((t, i) => cell(tp(t, { bold: true, size: 19, after: 0 }), dw[i], { fill: "EEEEEE" })) }]
        .concat(m.dayNight.map(r => ({ cells: r.map((t, i) => cell(tp(String(t), { size: 19, after: 0 }), dw[i])) })))));
    }
    // סעיף ההגשה לפי תצוגת המבקש (O.docxModel): סיכום קצר בנקודות ("סיכום והגשה") או הנוסח המלא ("הגשה")
    if (m.summary && m.summary.length) { body.push(secHeading(m.submissionHead || "סיכום והגשה")); m.summary.forEach(l => body.push(hp("• " + l, { size: 20 }))); }
    else if (m.submission) { body.push(secHeading(m.submissionHead || "הגשה")); body.push(hp(m.submission, { size: 20 })); }
    if (m.review) { body.push(secHeading("אישור סקירה אנושית")); body.push(tp(m.review, { size: 20 })); }
  }

  /* ---------- עמוד "דיווח לגורמים נוספים" (שלב ב׳) ---------- */
  // p = O.partiesPage(...) (= model.parties של O.docxModel): {head, sub, summary, rows:[{n, party:[שורות], type, contact:[שורות], status, note}], empty, note, footer}. רוחב העמודות (#, גורם, סוג, פרטי קשר, סטטוס, הערה) = רוחב התוכן
  const PARTY_COLS = ["#", "גורם", "סוג", "פרטי קשר", "סטטוס", "הערה"], PARTY_W = [460, 2300, 900, 2900, 1200, 2146];
  function partiesBody(p) {
    const out = [], w = PARTY_W, top = { valign: "top" }, cl = (lines, i) => cell(cellLines(lines, 19), w[i], top);
    out.push(textParaS(p.head, { bold: true, size: 26, pageBreakBefore: true, after: 40, keepNext: true }));
    out.push(textParaS(p.sub, { size: 16, color: "555555", after: 60, keepNext: true }));
    if (p.summary) out.push(textParaS(p.summary, { bold: true, size: 20, after: 80, keepNext: true }));
    const rows = Array.isArray(p.rows) ? p.rows : [];
    if (rows.length) {
      out.push(tableXml(w, [hdrRow(PARTY_COLS, w)].concat(rows.map(r => ({ cells: [cl([{ t: String(r.n) }], 0), cl(r.party, 1), cl([{ t: r.type }], 2), cl(r.contact, 3), cl([{ t: r.status }], 4), cl([{ t: r.note }], 5)] }))), { strict: true }));
    } else out.push(textParaS(p.empty, { size: 20 }));
    if (p.note) out.push(textParaS(p.note, { size: 18, color: "444444", before: 60 }));
    out.push(textParaS(p.footer, { size: 16, color: "555555", before: 120 }));
    return out;
  }

  /* ---------- דוח "בדיקה חוזרת" (Word נפרד, לא חלק מהבקשה שנשלחה) ---------- */
  // rc = O.recheckDocxModel(...).recheck: {banner:[{t,b,size}], title, identity:[[תווית, ערך]], heading, summary, checkedLine, notes:[], sourcesTitle, sourcesHead:[3], sources:[[מקור, בהגשה, כעת, שונה]],
  //   sections:[{title, head:[4], rows:[{status, sev (טקסט חומרה), high, id, title, lines:[], dist}], more}], limitation}. כל הטקסט רגיל (esc ב-runsOf); בלי תמונות ובלי טופס
  function recheckBody(rc) {
    const out = [], B = rc.banner || [], bw = [2700, CONTENT_W - 2700];
    B.forEach((l, i) => out.push(textParaS(l.t, { bold: !!l.b, size: l.size || 22, color: "4A3500", shade: "FFF3CD", box: "E0A800", after: i === B.length - 1 ? 120 : 0 })));
    out.push(textParaS(rc.title, { bold: true, size: 30, before: 120, after: 80, keepNext: true }));
    if ((rc.identity || []).length) out.push(tableXml(bw, rc.identity.map(r => ({ cells: [cell(textParaS(r[0], { bold: true, size: 19, after: 0 }), bw[0], { fill: "EFEFEF" }), cell(textParaS(r[1], { size: 19, after: 0 }), bw[1])] })), { strict: true }));
    out.push(headingS(rc.heading));
    if (rc.summary) out.push(textParaS(rc.summary, { bold: true, size: 22, after: 60 }));
    if (rc.checkedLine) out.push(textParaS(rc.checkedLine, { size: 19 }));
    (rc.notes || []).forEach(n => out.push(textParaS(n, { size: 18, color: "444444" })));
    if ((rc.sources || []).length) {
      const sw = [3000, 3453, CONTENT_W - 6453];
      out.push(headingS(rc.sourcesTitle, { size: 22 }));
      out.push(tableXml(sw, [hdrRow(rc.sourcesHead || [], sw)].concat(rc.sources.map(r => ({ cells: [0, 1, 2].map(i => cell(textParaS(r[i], { size: 19, bold: i === 2 && !!r[3], after: 0 }), sw[i], { valign: "top" })) }))), { strict: true }));
    }
    (rc.sections || []).forEach(sc => {
      const xw = [1500, 2900, 4006, CONTENT_W - 8406];
      out.push(headingS(sc.title, { size: 22, before: 200 }));
      out.push(tableXml(xw, [hdrRow(sc.head || [], xw)].concat((sc.rows || []).map(r => ({ cells: [
        cell(cellLines([{ t: r.status, b: !!r.high, c: r.high ? "B00020" : "" }].concat(r.sev ? [{ t: r.sev, b: true, c: "B00020" }] : []), 18), xw[0], { valign: "top" }),
        cell(cellLines([{ t: (r.id ? r.id + " " : "") + (r.title || ""), b: !!r.id }], 18), xw[1], { valign: "top" }),
        cell(cellLines((r.lines || []).map(t => ({ t })), 18), xw[2], { valign: "top" }),
        cell(cellLines([{ t: r.dist }], 18), xw[3], { valign: "top" })] }))), { strict: true }));
      if (sc.more) out.push(textParaS(sc.more, { size: 18, color: "444444", before: 40 }));
    });
    if (rc.limitation) out.push(textParaS(rc.limitation, { size: 18, color: "444444", before: 120 }));
    return out;
  }
  // m = O.recheckDocxModel: {recheck, includeChecks + שדות דף הבדיקות כמו ב-build (checkPoint, visitNote, checks, coverage, dayNight…), checksTitle, docTitle, creator, footer}. מחזיר ZIP (bytes) כמו build
  async function buildRecheck(m) {
    if (!m || !m.recheck) throw new Error("buildRecheck: חסר m.recheck");
    const body = recheckBody(m.recheck);
    if (m.includeChecks) checksPages(body, m, true);
    body.push(textParaS(m.footer || "", { size: 16, color: "555555", before: 120 }));
    return pack(body, [], m);
  }

  // אורז גוף מסמך (מערך XML של פסקאות/טבלאות) + תמונות לקובץ docx
  async function pack(body, imgs, m) {
    m = m || {};
    const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
    const sect = '<w:sectPr><w:pgSz w:w="' + PAGE_W + '" w:h="' + PAGE_H + '"/><w:pgMar w:top="' + MARGIN + '" w:right="' + MARGIN + '" w:bottom="' + MARGIN + '" w:left="' + MARGIN + '" w:header="500" w:footer="500" w:gutter="0"/><w:bidi/></w:sectPr>';
    const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + NS + "><w:body>" + body.join("") + sect + "</w:body></w:document>";

    const zip = new JSZip();
    zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>');
    zip.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>');
    zip.file("docProps/core.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>' + esc(m.docTitle || m.title) + '</dc:title><dc:creator>' + esc(m.creator || "") + '</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">' + new Date().toISOString().replace(/\.\d+Z$/, "Z") + "</dcterms:created></cp:coreProperties>");
    zip.file("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      imgs.map(i => '<Relationship Id="' + i.rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + i.name + '"/>').join("") + "</Relationships>");
    zip.file("word/styles.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr>' + FONT + '<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="he-IL"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:bidi/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>');
    zip.file("word/document.xml", documentXml);
    imgs.forEach(i => zip.file("word/media/" + i.name, i.bytes));
    return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }

  return { build, buildRecheck, pack, runsOf, htmlRuns, helpers: { para, textPara, htmlPara, heading, cell, tableXml, CONTENT_W, paraS, textParaS, partiesBody, recheckBody } };
});
