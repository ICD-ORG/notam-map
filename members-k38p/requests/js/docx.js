/* הפקת קובץ Word (.docx) ניתן לעריכה מהבקשה: טופס נספח ג׳ (17 שדות), מפה/הדמיה, תצ״א נקי, ודף בדיקות.
   בלי תלות חיצונית מלבד JSZip (request/vendor/jszip.min.js). רץ בדפדפן וב-Node. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("../vendor/jszip.min.js"));
  else root.ReqDocx = factory(root.JSZip);
})(typeof self !== "undefined" ? self : this, function (JSZip) {
  "use strict";

  const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const decode = s => s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&");
  const FONT = '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/>';
  const HEB = /[֐-׿יִ-ﭏ]/, LAT = /[A-Za-z0-9]/;

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
    return parts.map(p => {
      const rtl = p.t !== "L" && p.t !== "N" ? "<w:rtl/>" : p.t === "N" ? "<w:rtl/>" : "";
      const rpr = "<w:rPr>" + FONT + (o.bold ? "<w:b/><w:bCs/>" : "") + (o.italic ? "<w:i/><w:iCs/>" : "") + (o.color ? '<w:color w:val="' + o.color + '"/>' : "") +
        '<w:sz w:val="' + size + '"/><w:szCs w:val="' + size + '"/>' + rtl + "</w:rPr>";
      // מקטע לטיני/מספרי נעטף ב-LRE…PDF כדי שסימנים כמו ° ' " : – לא יתהפכו בתוך פסקה מימין לשמאל
      const txt = p.t === "L" ? "\u202A" + p.s.replace(/\s+$/, "") + "\u202C" + (/\s+$/.test(p.s) ? p.s.match(/\s+$/)[0] : "") : p.s;
      return "<w:r>" + rpr + '<w:t xml:space="preserve">' + esc(txt) + "</w:t></w:r>";
    }).join("");
  }
  const brRun = size => "<w:r><w:rPr>" + FONT + '<w:sz w:val="' + (size || 22) + '"/></w:rPr><w:br/></w:r>';

  // HTML מצומצם (<br>, <b>, <i>, <small>, <span>) -> ריצות
  function htmlRuns(html, o) {
    o = o || {};
    let bold = !!o.bold, italic = !!o.italic, small = false, out = "";
    String(html).split(/(<[^>]+>)/).forEach(tok => {
      if (!tok) return;
      if (tok[0] === "<") {
        const tag = tok.toLowerCase();
        if (/^<br\s*\/?>/.test(tag)) out += brRun(o.size);
        else if (tag === "<b>") bold = true; else if (tag === "</b>") bold = !!o.bold;
        else if (tag === "<i>") italic = true; else if (tag === "</i>") italic = !!o.italic;
        else if (tag === "<small>") small = true; else if (tag === "</small>") small = false;
        return;
      }
      const txt = decode(tok); if (!txt) return;
      out += runsOf(txt, { bold, italic, size: small ? Math.max(16, (o.size || 22) - 4) : o.size, color: o.color });
    });
    return out;
  }

  const para = (runs, o) => {
    o = o || {};
    return "<w:p><w:pPr><w:bidi/>" + (o.keepNext ? "<w:keepNext/>" : "") + (o.pageBreakBefore ? "<w:pageBreakBefore/>" : "") +
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
    return '<w:tbl><w:tblPr><w:tblW w:w="' + colWidths.reduce((a, c) => a + c, 0) + '" w:type="dxa"/><w:bidiVisual/><w:tblBorders>' + b + '</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="25" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="25" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      "<w:tblGrid>" + colWidths.map(w => '<w:gridCol w:w="' + w + '"/>').join("") + "</w:tblGrid>" +
      rows.map(r => "<w:tr><w:trPr><w:cantSplit/>" + (r.header ? "<w:tblHeader/>" : "") + "</w:trPr>" + r.cells.join("") + "</w:tr>").join("") + "</w:tbl>";
  };

  function imageXml(rid, id, wEmu, hEmu, name, descr) {
    return '<w:p><w:pPr><w:bidi/><w:spacing w:before="60" w:after="60"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + wEmu + '" cy="' + hEmu + '"/><wp:docPr id="' + id + '" name="' + esc(name) + '" descr="' + esc(descr) + '"/>' +
      '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="' + id + '" name="' + esc(name) + '"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + wEmu + '" cy="' + hEmu + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  }

  const PAGE_W = 11906, PAGE_H = 16838, MARGIN = 1000, CONTENT_W = PAGE_W - 2 * MARGIN; // twips
  const CM = 360000; // EMU לסנטימטר

  // model: {title, subtitle, draftText, rows:[{n,label,sub,html}], mailLine, formFooter, mapTitle, mapNote, items:[{n,title,dist,where}],
  //         images:{map:{bytes,w,h}, aerial:{bytes,w,h}}, aerialTitle, checks:[[name,source,html]], coverage:{sources,groups,censusOnly}, dayNight:[[...]], dayNightHead,
  //         submission, notes:[], review, footer, includeChecks}
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
      cell(htmlPara(r.html, { size: 19, after: 0, line: 245 }), wv)] }))));
    body.push(htmlPara("<b>חובה לצרף מפה/תצ״א</b> — מצורפות: הדמיה בתקריב ומבט כללי (עמודים 2–3) ותצ״א נקי (עמוד 4).<br>" + esc(m.mailLine || ""), { size: 20, before: 100 }));
    body.push(textPara(m.formFooter || "", { size: 16, color: "555555" }));

    // ----- עמוד 2: מפה והדמיה -----
    const imgs = [];
    const addImg = (img, name, descr) => {
      const w = 16.6 * CM, h = w * img.h / img.w, rid = "rId" + (100 + imgs.length);
      imgs.push({ rid, bytes: img.bytes, name: name + ".jpeg" });
      return imageXml(rid, imgs.length, Math.round(w), Math.round(h), name, descr);
    };
    body.push(textPara(m.mapTitle, { bold: true, size: 26, pageBreakBefore: true, after: 80 }));
    if (m.images && m.images.map) body.push(addImg(m.images.map, "map", m.mapTitle));
    if (m.mapNote) body.push(textPara(m.mapNote, { size: 18, color: "444444" }));
    if (m.images && m.images.overview) {
      body.push(textPara(m.overviewTitle || "מבט כללי", { bold: true, size: 26, pageBreakBefore: true, after: 80 }));
      body.push(addImg(m.images.overview, "overview", m.overviewTitle || "מבט כללי"));
    }
    if (m.items && m.items.length) {
      body.push(heading("מכשולים, אתרים ותשתיות המסומנים במפה"));
      const w = [700, 4700, 1800, CONTENT_W - 7200];
      body.push(tableXml(w, [{ header: true, cells: ["#", "מה", "מרחק מהנקודה", "איפה"].map((t, i) => cell(textPara(t, { bold: true, size: 20, after: 0 }), w[i], { fill: "EEEEEE" })) }]
        .concat(m.items.map(it => ({ cells: [String(it.n), it.title, it.dist, it.where].map((t, i) => cell(textPara(t, { size: 20, after: 0 }), w[i])) })))));
    }
    // ----- עמוד 3: תצ"א נקי -----
    if (m.images && m.images.aerial) {
      body.push(textPara(m.aerialTitle, { bold: true, size: 26, pageBreakBefore: true, after: 80 }));
      body.push(addImg(m.images.aerial, "aerial", m.aerialTitle));
    }
    // ----- דף בדיקות -----
    if (m.includeChecks) {
      body.push(textPara("דף בדיקות — לא חלק מהטופס הרשמי", { bold: true, size: 26, pageBreakBefore: true, after: 80 }));
      body.push(textPara(m.checkPoint || "", { size: 20 }));
      body.push(heading("הבדיקות שבוצעו"));
      const cw = [CONTENT_W * 0.22 | 0, CONTENT_W * 0.16 | 0, CONTENT_W - (CONTENT_W * 0.22 | 0) - (CONTENT_W * 0.16 | 0)];
      body.push(tableXml(cw, [{ header: true, cells: ["בדיקה", "מקור", "תוצאה"].map((t, i) => cell(textPara(t, { bold: true, size: 19, after: 0 }), cw[i], { fill: "EEEEEE" })) }]
        .concat((m.checks || []).map(r => ({ cells: [cell(textPara(r[0], { size: 19, after: 0 }), cw[0], { valign: "top" }), cell(textPara(r[1], { size: 17, after: 0 }), cw[1], { valign: "top" }), cell(htmlPara(r[2], { size: 19, after: 0 }), cw[2], { valign: "top" })] })))));
      if (m.coverage) {
        body.push(heading("דוח כיסוי — מה נסרק"));
        const sw = [CONTENT_W * 0.28 | 0, CONTENT_W - (CONTENT_W * 0.28 | 0)];
        body.push(tableXml(sw, m.coverage.sources.map(r => ({ cells: [cell(textPara(r[0], { bold: true, size: 19, after: 0 }), sw[0], { fill: "F6F6F6" }), cell(textPara(r[1], { size: 19, after: 0 }), sw[1])] }))));
        body.push(heading("מצאי לפי קבוצות (כל מה שנמצא בטווח החיפוש)"));
        const gw = [CONTENT_W * 0.40 | 0, 1200, 1400, 1400, CONTENT_W - (CONTENT_W * 0.40 | 0) - 4000];
        body.push(tableXml(gw, [{ header: true, cells: ["קבוצה", "נמצאו", "בתוך הסגירה", "בטבעת הכתומה", "בקרבה"].map((t, i) => cell(textPara(t, { bold: true, size: 19, after: 0 }), gw[i], { fill: "EEEEEE" })) }]
          .concat(m.coverage.groups.map(g => ({ cells: [g.group, String(g.found), String(g.inside), String(g.ring), String(g.near)].map((t, i) => cell(textPara(t, { size: 19, after: 0 }), gw[i])) })))));
        if (m.coverage.censusOnly && m.coverage.censusOnly.length) {
          body.push(heading("פריטים נוספים שנמצאו בקרבה ואינם בטופס"));
          body.push(textPara(m.coverage.censusOnly.map(i => i.title + " — " + i.dist).join("; ") + (m.coverage.censusMore ? "; ועוד " + m.coverage.censusMore + " פריטים" : "") + ".", { size: 19 }));
        }
      }
      if (m.dayNight && m.dayNight.length) {
        body.push(heading("יום ולילה בחלון הפעילות"));
        const dw = [CONTENT_W * 0.28 | 0, 1500, 1500, 1800, CONTENT_W - (CONTENT_W * 0.28 | 0) - 4800];
        body.push(tableXml(dw, [{ header: true, cells: (m.dayNightHead || []).map((t, i) => cell(textPara(t, { bold: true, size: 19, after: 0 }), dw[i], { fill: "EEEEEE" })) }]
          .concat(m.dayNight.map(r => ({ cells: r.map((t, i) => cell(textPara(String(t), { size: 19, after: 0 }), dw[i])) })))));
      }
      if (m.submission) { body.push(heading("הגשה")); body.push(htmlPara(m.submission, { size: 20 })); }
      if (m.notes && m.notes.length) { body.push(heading("מגבלות המקורות")); m.notes.forEach(n => body.push(textPara("• " + n, { size: 19 }))); }
      if (m.review) { body.push(heading("אישור סקירה אנושית")); body.push(textPara(m.review, { size: 20 })); }
    }
    body.push(textPara(m.footer || "", { size: 16, color: "555555", before: 120 }));

    return pack(body, imgs, m);
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

  return { build, pack, runsOf, htmlRuns, helpers: { para, textPara, htmlPara, heading, cell, tableXml, CONTENT_W } };
});
