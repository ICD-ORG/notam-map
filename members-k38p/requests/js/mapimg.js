/* ציור תמונות המפה לבקשה (PNG): רקע תצלום אוויר/מפת רחובות + העיגולים, אזורי א-17 וב-09, מכשולים ותשתיות — הכול בקנבס, בלי תלות בספריית מפות.
   ארבע תמונות מצורפות לטופס ("חובה לצרף מפה/תצ״א"): תצ״א תקריב, מפת רחובות תקריב, הדמיה וסימונים (מבט כללי) ומפת אזור מרוחקת. הסימונים מופיעים תמיד בכולן. דורש דפדפן. */
(function (root) {
  "use strict";
  const C = root.ReqCore;
  const PROVIDERS = {
    esri: { name: "צילום אוויר (Esri World Imagery)", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", attribution: "© Esri, Maxar, Earthstar Geographics" },
    osm: { name: "מפת רחובות (OpenStreetMap)", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: "© OpenStreetMap contributors" },
    // שכבת שמות המקומות (שקופה) שמעל התצ״א במפת האזור — best-effort: כשל בה אינו כשל רקע
    labels: { name: "שמות מקומות (Esri World Boundaries and Places)", url: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", attribution: "© Esri" }
  };
  // צבעי הקטגוריות: [קו, מילוי]
  const COL = { obst: ["#ffd400", "rgba(255,212,0,0.40)"], ground: ["#22d3ee", "rgba(34,211,238,0.30)"], air: ["#e040fb", "rgba(224,64,251,0.32)"], census: ["#a3e635", "rgba(163,230,53,0.28)"] };
  const NICE = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];   // אורכי סרגל קנה המידה האפשריים (מ׳)
  const DARK = "rgba(17,17,17,0.88)";   // מסגרת כהה מתחת לקווים וצורות — קריאות גם על רקע בהיר (מפת רחובות)

  const worldPx = (lat, lon, z) => {
    const s = 256 * Math.pow(2, z), sin = Math.sin((lat * Math.PI) / 180);
    return [((lon + 180) / 360) * s, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s];
  };
  const mpp = (lat, z) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, z);

  function loadImage(url, timeoutMs) {
    return new Promise((resolve) => {
      const img = new Image(); img.crossOrigin = "anonymous";
      const t = setTimeout(() => resolve(null), timeoutMs || 25000);
      img.onload = () => { clearTimeout(t); resolve(img); };
      img.onerror = () => { clearTimeout(t); resolve(null); };
      img.src = url;
    });
  }

  // detail: סביב הסגירה (עד פי 2 מהרדיוס) · overview: כולל כל מה שבטופס (אזורי איסור, אתרים ותשתיות) · region: חצי-רוחב 5 ק״מ לפחות (כ-10 ק״מ ומעלה בצד הקצר)
  function viewFor(res, W, H, mode) {
    let E = 2 * res.R;
    if (mode === "region") E = Math.max(5000, 2.5 * res.R);
    else if (mode !== "detail") {
      [...res.zones.inside, ...res.zones.near].forEach(z => { E = Math.max(E, Math.hypot(z.p[0], z.p[1])); });
      res.nearScan.items.forEach(it => { E = Math.max(E, Math.hypot(it.p[0], it.p[1])); });
    }
    E *= 1.14;
    const lat = res.inp.lat;
    for (let z = 19; z >= 3; z--) { if ((E / mpp(lat, z)) * 2 <= Math.min(W, H) - 20) return { z, E }; }
    return { z: 3, E };
  }

  // כותרת הקנבס לפי (תצוגה, ספק) — הקידומת היא שם האתר
  function titleFor(site, view, pid) {
    const tail = view === "region" ? "מפת אזור (מרוחק)" : view === "overview" ? (pid === "osm" ? "הדמיה וסימונים על מפת רחובות (מבט כללי)" : "הדמיה וסימונים (מבט כללי)") : pid === "osm" ? "מפת רחובות תקריב" : "תצ״א תקריב";
    return site + " — " + tail;
  }

  // res: תוצאת ReqCore.analyze. opts: {provider: esri|osm, view: detail|overview|region, labels (region בלבד), width, height, tileTimeoutMs, tileUrl, labelTileUrl}
  async function render(res, opts) {
    opts = opts || {};
    const W = opts.width || 1280, H = opts.height || 960, pid = opts.provider === "osm" ? "osm" : "esri", prov = PROVIDERS[pid];
    const view = opts.view === "detail" || opts.view === "region" ? opts.view : "overview", region = view === "region";
    const { z } = viewFor(res, W, H, view), inp = res.inp, P = res.P;
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    const [cx, cy] = worldPx(inp.lat, inp.lon, z);
    const X = (lat, lon) => { const w = worldPx(lat, lon, z); return [W / 2 + (w[0] - cx), H / 2 + (w[1] - cy)]; };
    const pxPerM = 1 / mpp(inp.lat, z), zones = [...res.zones.inside, ...res.zones.near], items = res.nearScan.items;

    // ---- רקע: אריחים (ובמפת אזור גם שכבת שמות, במקביל ובלי להשפיע על תוצאת הרקע) ----
    g.fillStyle = "#cfd5dc"; g.fillRect(0, 0, W, H);
    const x0 = Math.floor((cx - W / 2) / 256), x1 = Math.floor((cx + W / 2) / 256), y0 = Math.floor((cy - H / 2) / 256), y1 = Math.floor((cy + H / 2) / 256), nT = Math.pow(2, z);
    const tileJobs = (tpl, timeoutMs) => {
      const jobs = [];
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
        if (ty < 0 || ty >= nT) continue;
        const wx = ((tx % nT) + nT) % nT, url = tpl.replace("{z}", z).replace("{x}", wx).replace("{y}", ty);
        jobs.push(loadImage(url, timeoutMs).then(img => ({ img, px: W / 2 + (tx * 256 - cx), py: H / 2 + (ty * 256 - cy) })));
      }
      return jobs;
    };
    const labelTpl = region && pid === "esri" && opts.labels ? (opts.labelTileUrl || PROVIDERS.labels.url) : "";
    const [tiles, ltiles] = await Promise.all([Promise.all(tileJobs(opts.tileUrl || prov.url, opts.tileTimeoutMs)), Promise.all(labelTpl ? tileJobs(labelTpl, Math.min(opts.tileTimeoutMs || 25000, 12000)) : [])]);
    let failed = 0;
    tiles.forEach(t => { if (t.img) g.drawImage(t.img, Math.round(t.px), Math.round(t.py), 256, 256); else failed++; });
    const background = failed === 0 && tiles.length > 0;
    // שכבת השמות מצוירת קודם על קנבס נפרד: אם משום מה היא "מלכלכת" אותו — מדלגים עליה, ואין היא פוסלת את התמונה כולה
    let labelTiles = 0;
    const gotL = ltiles.filter(t => t.img);
    if (gotL.length) {
      const lc = document.createElement("canvas"); lc.width = W; lc.height = H; const lg = lc.getContext("2d");
      gotL.forEach(t => lg.drawImage(t.img, Math.round(t.px), Math.round(t.py), 256, 256));
      let clean = true; try { lg.getImageData(0, 0, 1, 1); } catch (e) { clean = false; }
      if (clean) { g.drawImage(lc, 0, 0); labelTiles = gotL.length; }
    }

    g.lineJoin = "round";
    const path = (pts, close) => { g.beginPath(); pts.forEach((p, i) => { const q = X(p[0], p[1]); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); if (close) g.closePath(); };
    const text = (s, x, y, o) => {
      o = o || {}; g.font = (o.bold === false ? "" : "bold ") + (o.size || 15) + "px sans-serif"; g.textAlign = o.align || "center"; g.textBaseline = "middle"; g.direction = o.ltr ? "ltr" : "rtl";
      const mw = o.max || undefined;
      g.lineWidth = 4; g.strokeStyle = o.halo || "rgba(0,0,0,0.85)"; g.strokeText(s, x, y, mw); g.fillStyle = o.color || "#fff"; g.fillText(s, x, y, mw);
    };
    const NOHALO = "rgba(0,0,0,0)";
    const onCanvas = q => q[0] > 0 && q[0] < W && q[1] > 0 && q[1] < H;
    const inView = q => q[0] > 24 && q[0] < W - 24 && q[1] > 96 && q[1] < H - 24;

    // ---- אזורי א-17 (אדום), ב-09 (כחול) ורט״ג; בקירוב = קו מקווקו ----
    zones.forEach(zn => {
      const zz = zn.z, rings = zz.rings && zz.rings.length ? zz.rings : (zz.c && zz.r ? [C.circlePoints(new C.Proj(zz.c[0], zz.c[1]), zz.r, 96)] : []);
      rings.forEach(rg => { path(rg, true); g.fillStyle = zn.src === "b09" ? "rgba(59,130,246,0.26)" : "rgba(255,59,48,0.30)"; g.fill(); g.lineWidth = 3; g.strokeStyle = zn.src === "b09" ? "#2563eb" : "#d92d20"; g.setLineDash(zn.approx ? [10, 7] : []); g.stroke(); g.setLineDash([]); });
    });
    // ---- טבעת כתומה וירוקה (במפת אזור: בגודל מינימלי גלוי כשהרדיוס האמיתי קטן מדי) ----
    const rG0 = res.R * pxPerM, rO0 = 2 * res.R * pxPerM, rG = region ? Math.max(rG0, 14) : rG0, rO = region ? Math.max(rO0, 28) : rO0;
    const enlarged = region && (rG > rG0 + 0.5 || rO > rO0 + 0.5);
    g.beginPath(); g.arc(W / 2, H / 2, rO, 0, 2 * Math.PI); g.arc(W / 2, H / 2, rG, 0, 2 * Math.PI, true);
    g.fillStyle = "rgba(255,149,0,0.28)"; g.fill("evenodd");
    g.lineWidth = 3; g.strokeStyle = "#ff9500"; g.beginPath(); g.arc(W / 2, H / 2, rO, 0, 2 * Math.PI); g.stroke();
    g.beginPath(); g.arc(W / 2, H / 2, rG, 0, 2 * Math.PI); g.fillStyle = "rgba(52,168,83,0.30)"; g.fill();
    g.lineWidth = 3.5; g.strokeStyle = "#22c55e"; g.stroke();

    // ---- מקרא, סרגל וחץ צפון: נקבעים מראש כדי שתוויות המספרים והאזורים לא יוסתרו מתחתם ----
    const rows = [["#22c55e", "ירוק: אזור הסגירה (0–" + res.R + " מ׳)"], ["#ff9500", "כתום: עד " + 2 * res.R + " מ׳"], ["#ff3b30", "אדום: אזור אסור/מוגבל (פמ״ת א-17)"], ...(zones.some(z => z.src === "b09") ? [["#3b82f6", "כחול: אזור טיסה לכטב״ם (פמ״ת ב-09)"]] : []), ["#ffd400", region ? "צהוב: מכשול" : "צהוב: מכשול (מספר = ברשימה בטופס)"], ["#22d3ee", "תכלת: אתר/תשתית קרקעית (אצטדיון, כביש, מסילה...)"], ["#e040fb", "סגול: תשתית/מכשול אווירי (שדה, מנחת, בלון)"], ["#a3e635", "ירוק בהיר: אתר המונים / תשתית נוספת"]];
    if (enlarged) rows.push([null, "הטבעת מוגדלת לקריאות; הרדיוס האמיתי " + res.R + " מ׳"]);
    const lx0 = W - 20 - 420, ly0 = H - 20 - rows.length * 26 - 12;
    let sm = NICE[0];
    NICE.forEach(n => { if (n * pxPerM <= 200) sm = n; });
    const sx = 24, sy = H - 28, sl = sm * pxPerM;
    const blocked = [[lx0 - 12, ly0 - 8, lx0 + 420, H - 4], [sx - 10, sy - 28, sx + sl + 80, sy + 16], [W - 62, 76, W - 18, 140], [W / 2 - 18, H / 2 - 18, W / 2 + 18, H / 2 + 18]];   // מקרא · סרגל · צפון · צלב המרכז
    // מיקום כיתוב אזור איסור: מעל הנקודה הקרובה (במפת אזור: לצד הנקודה הרחוק מהסמן, כדי שהסמן לא יסתיר אותו)
    g.font = "bold 15px sans-serif"; g.direction = "ltr";
    const zlabels = zones.map(zn => {
      const b = X(zn.ll[0], zn.ll[1]); if (!inView(b)) return null;
      const s = zn.id + (zn.src === "b09" ? " · כטב״ם ב-09" : " · " + zn.name) + (zn.approx ? " (בקירוב)" : "") + (zn.d >= 1 ? " · " + C.fmtDist(zn.d) : ""), w = g.measureText(s).width;
      let x = Math.min(Math.max(b[0], 150), W - 150), y = Math.min(Math.max(b[1] - 20, 120), H - 40), align = "center";
      if (region) {
        y = Math.min(Math.max(b[1], 100), H - 40);
        if (b[0] <= W / 2 && b[0] - 14 - w >= 6) { x = b[0] - 14; align = "right"; } else if (b[0] + 14 + w <= W - 6) { x = b[0] + 14; align = "left"; }
      }
      const left = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
      return { zn, b, s, x, y, align, rect: [left - 4, y - 12, left + w + 4, y + 12] };
    }).filter(Boolean);

    // ---- מכשולים ותשתיות: קווים ושטחים (עם מסגרת כהה לקריאות גם על מפת רחובות בהירה) ----
    const k = region ? 0.7 : 1;   // במפת אזור הצורות דקות יותר
    items.forEach(it => {
      const [c1, c2] = COL[it.cat] || COL.obst;
      it.geoms.forEach(gm => {
        if (gm.pt) return;
        path(gm.pts, gm.closed);
        if (gm.closed) { g.fillStyle = c2; g.fill(); g.lineWidth = 5.5 * k; g.strokeStyle = DARK; g.stroke(); g.lineWidth = 2.4 * k; g.strokeStyle = c1; g.stroke(); }
        else { g.lineWidth = 7.5 * k; g.strokeStyle = DARK; g.setLineDash([]); g.stroke(); g.lineWidth = 4.5 * k; g.strokeStyle = c1; g.stroke(); g.lineWidth = 1.6 * k; g.strokeStyle = "#111"; g.setLineDash([9, 5]); g.stroke(); g.setLineDash([]); }
      });
    });
    if (region) {
      // בלי מספרים: נקודה קטנה בצבע הקטגוריה בכל פריט (נקודתי — בנקודה עצמה, אחר — בנקודה הקרובה ביותר לסגירה), כדי שפריט זעיר ייראה גם בסקאלה רחבה
      items.forEach(it => {
        const pt = it.geoms.find(gm => gm.pt), [c1] = COL[it.cat] || COL.obst, q = pt ? X(pt.pt[0], pt.pt[1]) : X(it.ll[0], it.ll[1]);
        if (!onCanvas(q)) return;
        g.fillStyle = c1; g.strokeStyle = "#111"; g.lineWidth = 2;
        if (pt) { g.fillRect(q[0] - 4.5, q[1] - 4.5, 9, 9); g.strokeRect(q[0] - 4.5, q[1] - 4.5, 9, 9); }
        else { g.beginPath(); g.arc(q[0], q[1], 4.5, 0, 2 * Math.PI); g.fill(); g.stroke(); }
      });
    } else {
      // תוויות (מספר + מרחק) עם הימנעות מחפיפה: מנסה כמה מיקומים סביב הסימון
      const labels = [], occupied = [...blocked, ...zlabels.map(l => l.rect)];
      items.forEach(it => {
        const pt = it.geoms.find(gm => gm.pt), [c1] = COL[it.cat] || COL.obst;
        const q = pt ? X(pt.pt[0], pt.pt[1]) : X(it.ll[0], it.ll[1]);
        if (!onCanvas(q)) return;
        if (pt) { g.fillStyle = c1; g.strokeStyle = "#111"; g.lineWidth = 2; g.fillRect(q[0] - 8, q[1] - 8, 16, 16); g.strokeRect(q[0] - 8, q[1] - 8, 16, 16); }
        labels.push({ q, n: it.n, c: c1, d: it.d, t: it.d < 1 ? "בתוך השטח" : C.fmtDist(it.d) });
      });
      const OFFS = [[16, -16], [16, 18], [-16, -16], [-16, 18], [0, -34], [0, 36], [38, -30], [38, 32], [-38, -30], [-38, 32], [60, 0], [-60, 0], [70, -50], [-70, 50]];
      // צפיפות גבוהה (במבט כללי): טבעות נוספות של מיקומים אפשריים במרחקים גדלים, עם קו מנחה — כדי שאף מספר לא יוסתר
      [50, 72, 96, 122, 150, 180].forEach((r, ri) => { for (let a = 0; a < 16; a++) { const t = (a + (ri % 2 ? 0.5 : 0)) * Math.PI / 8; OFFS.push([Math.round(r * Math.cos(t)), Math.round(r * Math.sin(t))]); } });
      g.font = "bold 12px sans-serif";
      labels.forEach(l => {
        const tw = g.measureText(l.t).width;
        const rectOf = (bx, by, left) => left ? [bx - 12 - 5 - tw, by - 12, bx + 12, by + 12] : [bx - 12, by - 12, bx + 12 + 5 + tw, by + 12];
        let best = null;
        for (const [dx, dy] of OFFS) {
          const bx = l.q[0] + dx, by = l.q[1] + dy, left = dx < 0, rect = rectOf(bx, by, left);
          const hit = occupied.some(o => rect[0] < o[2] && rect[2] > o[0] && rect[1] < o[3] && rect[3] > o[1]) || rect[0] < 4 || rect[2] > W - 4 || rect[1] < 76 || rect[3] > H - 4;
          if (!hit) { best = { cx: bx, cy: by, left, rect }; break; }
          if (!best) best = { cx: bx, cy: by, left, rect };
        }
        if (best.rect[0] < 4 || best.rect[2] > W - 4 || best.rect[1] < 76 || best.rect[3] > H - 4) {   // לא נמצא מקום פנוי: מצמידים את התווית לשטח התמונה (מתחת לכותרת) כדי שהמספר לא ייעלם
          const bx = Math.min(Math.max(best.cx, best.left ? 4 + 12 + 5 + tw : 4 + 12), best.left ? W - 4 - 12 : W - 4 - 12 - 5 - tw), by = Math.min(Math.max(best.cy, 76 + 12), H - 4 - 12);
          best = { cx: bx, cy: by, left: best.left, rect: rectOf(bx, by, best.left) };
        }
        occupied.push(best.rect); l.pos = best;
      });
      // קודם כל הקווים המנחים (עם מסגרת כהה, קריאים גם על רקע בהיר) ורק אחריהם הבועות — כדי שקו של פריט אחד לא יחצה מספר של פריט אחר
      labels.forEach(l => {
        const b = l.pos; if (Math.abs(b.cx - l.q[0]) <= 20 && Math.abs(b.cy - l.q[1]) <= 20) return;
        g.lineCap = "round"; g.strokeStyle = DARK; g.lineWidth = 4; g.beginPath(); g.moveTo(l.q[0], l.q[1]); g.lineTo(b.cx, b.cy); g.stroke();
        g.strokeStyle = "rgba(255,255,255,0.9)"; g.lineWidth = 1.6; g.beginPath(); g.moveTo(l.q[0], l.q[1]); g.lineTo(b.cx, b.cy); g.stroke(); g.lineCap = "butt";
      });
      labels.forEach(l => {
        const b = l.pos;
        g.beginPath(); g.arc(b.cx, b.cy, 11, 0, 2 * Math.PI); g.fillStyle = "#111"; g.fill(); g.lineWidth = 1.5; g.strokeStyle = "rgba(255,255,255,0.85)"; g.stroke();
        g.fillStyle = l.c; g.font = "bold 14px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.direction = "ltr"; g.fillText(String(l.n), b.cx, b.cy + 1);
        g.font = "bold 12px sans-serif"; g.textAlign = b.left ? "right" : "left"; g.direction = "rtl";
        const tx = b.left ? b.cx - 17 : b.cx + 17;
        g.lineWidth = 3.5; g.strokeStyle = "rgba(0,0,0,0.85)"; g.strokeText(l.t, tx, b.cy + 1); g.fillStyle = "#fff"; g.fillText(l.t, tx, b.cy + 1);
      });
    }

    // ---- קווי מרחק לאזורי איסור ----
    zlabels.forEach(l => {
      const zn = l.zn, a = [W / 2, H / 2], b = l.b;
      if (zn.d >= 1) {
        const zc = zn.src === "b09" ? "#3b82f6" : "#ff3b30";
        g.setLineDash([8, 6]); g.lineWidth = 2.5; g.strokeStyle = zc; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); g.setLineDash([]);
        g.beginPath(); g.arc(b[0], b[1], 5, 0, 2 * Math.PI); g.fillStyle = zc; g.fill();
      }
      text(l.s, l.x, l.y, { align: l.align, color: zn.src === "b09" ? "#cfe0ff" : "#ffd1cc", ltr: true });
    });

    // ---- מרכז: צלב (תקריב/הדמיה) או סמן טיפה אדום שקצהו על המרכז + חץ לכיתוב (מפת אזור) ----
    if (region) {
      const ncap = items.length, site = (inp.siteName || "").trim() || "בקשת סגירה אווירית";
      const bw = Math.min(450, W - 40), bh = 104, bx = Math.max(16, W / 2 - 120 - bw), by = Math.min(H / 2 + 80, H - bh - 70);
      // חץ מתיבת הכיתוב אל הטבעת (נעצר מחוץ לטבעת הכתומה כדי לא להסתיר את המיקום)
      const ax = bx + bw, ay = by, dist = Math.hypot(W / 2 - ax, H / 2 - ay), ux = (W / 2 - ax) / dist, uy = (H / 2 - ay) / dist, stop = rO + 14;
      const ex = W / 2 - ux * stop, ey = H / 2 - uy * stop;
      g.lineCap = "round"; g.strokeStyle = DARK; g.lineWidth = 7; g.beginPath(); g.moveTo(ax, ay); g.lineTo(ex, ey); g.stroke();
      g.strokeStyle = "#fff"; g.lineWidth = 3; g.beginPath(); g.moveTo(ax, ay); g.lineTo(ex, ey); g.stroke(); g.lineCap = "butt";
      const hx = ex + ux * 2, hy = ey + uy * 2, nx = -uy, ny = ux;   // ראש החץ: קצהו ב-(hx,hy)
      g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx - ux * 18 + nx * 9, hy - uy * 18 + ny * 9); g.lineTo(hx - ux * 18 - nx * 9, hy - uy * 18 - ny * 9); g.closePath();
      g.fillStyle = "#fff"; g.fill(); g.lineWidth = 2; g.strokeStyle = DARK; g.stroke();
      // סמן הטיפה: הקצה התחתון בדיוק על המרכז
      const pinPath = () => { g.beginPath(); g.moveTo(W / 2, H / 2); g.bezierCurveTo(W / 2 - 5, H / 2 - 12, W / 2 - 13, H / 2 - 21, W / 2 - 13, H / 2 - 31); g.arc(W / 2, H / 2 - 31, 13, Math.PI, 2 * Math.PI); g.bezierCurveTo(W / 2 + 13, H / 2 - 21, W / 2 + 5, H / 2 - 12, W / 2, H / 2); g.closePath(); };
      pinPath(); g.lineWidth = 6; g.strokeStyle = DARK; g.stroke();
      pinPath(); g.fillStyle = "#e11d48"; g.fill(); g.lineWidth = 2.5; g.strokeStyle = "#fff"; g.stroke();
      g.beginPath(); g.arc(W / 2, H / 2 - 31, 5, 0, 2 * Math.PI); g.fillStyle = "#fff"; g.fill();
      // תיבת הכיתוב: שם האתר, נ״צ, ומספר המכשולים/תשתיות במיקום
      g.fillStyle = "rgba(11,18,32,0.92)"; g.fillRect(bx, by, bw, bh); g.lineWidth = 2; g.strokeStyle = "#e11d48"; g.strokeRect(bx, by, bw, bh);
      const cap = ncap === 0 ? "במיקום: לא נמצאו מכשולים/תשתיות — ראו התמונות המקרבות" : ncap === 1 ? "במיקום: מכשול/תשתית אחד — ראו התמונות המקרבות" : "במיקום: " + ncap + " מכשולים/תשתיות — ראו התמונות המקרבות";
      text(site, bx + bw - 14, by + 25, { align: "right", size: 19, max: bw - 28, halo: NOHALO });
      text(C.dmsLat(inp.lat) + "   " + C.dmsLon(inp.lon), bx + bw - 14, by + 54, { align: "right", ltr: true, size: 15, bold: false, color: "#cfe3ff", max: bw - 28, halo: NOHALO });
      text(cap, bx + bw - 14, by + 82, { align: "right", size: 15, bold: false, color: "#ffe9a8", max: bw - 28, halo: NOHALO });
    } else {
      g.strokeStyle = "#fff"; g.lineWidth = 5; g.beginPath(); g.moveTo(W / 2 - 14, H / 2); g.lineTo(W / 2 + 14, H / 2); g.moveTo(W / 2, H / 2 - 14); g.lineTo(W / 2, H / 2 + 14); g.stroke();
      g.strokeStyle = "#111"; g.lineWidth = 2; g.stroke();
      g.beginPath(); g.arc(W / 2, H / 2, 4, 0, 2 * Math.PI); g.fillStyle = "#111"; g.fill();
    }

    // ---- סרגל קנה מידה ----
    g.fillStyle = "rgba(0,0,0,0.55)"; g.fillRect(sx - 10, sy - 28, sl + 90, 44);
    g.strokeStyle = "#fff"; g.lineWidth = 4; g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + sl, sy); g.moveTo(sx, sy - 6); g.lineTo(sx, sy + 6); g.moveTo(sx + sl, sy - 6); g.lineTo(sx + sl, sy + 6); g.stroke();
    text(sm >= 1000 ? sm / 1000 + " ק״מ" : sm + " מ׳", sx + sl + 36, sy - 4, { size: 14 });
    // צפון
    g.fillStyle = "rgba(0,0,0,0.55)"; g.fillRect(W - 62, 76, 44, 64);
    g.fillStyle = "#fff"; g.beginPath(); g.moveTo(W - 40, 84); g.lineTo(W - 30, 112); g.lineTo(W - 40, 106); g.lineTo(W - 50, 112); g.closePath(); g.fill();
    text("N", W - 40, 126, { size: 15 });

    // ---- כותרת ----
    g.fillStyle = "rgba(11,18,32,0.88)"; g.fillRect(0, 0, W, 70);
    text(titleFor((inp.siteName || "").trim() || "בקשת סגירה אווירית", view, pid), W - 20, 22, { align: "right", size: 20, halo: NOHALO, max: W - 40 });
    text("רדיוס " + res.R + " מ׳   ·   גובה " + C.trimNum(inp.heightM, 2) + " מ׳ (" + res.ft.toFixed(1) + " רגל) מעפ״ש (AGL)", W - 20, 50, { align: "right", size: 15, bold: false, color: "#cfe3ff", halo: NOHALO });
    text(C.dmsLat(inp.lat) + "   " + C.dmsLon(inp.lon), 20, 50, { align: "left", ltr: true, size: 15, bold: false, color: "#cfe3ff", halo: NOHALO });
    // ---- מקרא (אותו מקרא בכל התמונות; במפת אזור אין מספור ברשימה, והטבעת עשויה להיות מוגדלת) ----
    g.fillStyle = "rgba(0,0,0,0.72)"; g.fillRect(lx0 - 12, ly0 - 8, 432, rows.length * 26 + 20);
    rows.forEach((it, i) => {
      if (it[0]) { g.fillStyle = it[0]; g.fillRect(lx0 + 400, ly0 + 5 + i * 26, 16, 16); }
      else { g.beginPath(); g.arc(lx0 + 408, ly0 + 13 + i * 26, 7, 0, 2 * Math.PI); g.lineWidth = 2.5; g.strokeStyle = "#22c55e"; g.stroke(); }   // אייקון טבעת להערת ההגדלה
      text(it[1], lx0 + 390, ly0 + 13 + i * 26, { align: "right", size: 14, bold: false, halo: NOHALO });
    });
    // ---- זכויות יוצרים ----
    text(prov.attribution + " · " + new Date().toISOString().slice(0, 10), 6, H - 6, { align: "left", ltr: true, size: 11, bold: false, halo: "rgba(0,0,0,0.9)" });

    let dataUrl = null, jpegUrl = null, tainted = false;
    try { dataUrl = cv.toDataURL("image/png"); jpegUrl = cv.toDataURL("image/jpeg", 0.9); } catch (e) { tainted = true; }
    return { canvas: cv, view, dataUrl, jpegUrl, background: background && !tainted, tiles: tiles.length, failedTiles: failed, labelTiles, tainted, zoom: z, provider: pid };
  }

  root.ReqMap = { render, PROVIDERS, worldPx, mpp, viewFor };
})(typeof self !== "undefined" ? self : this);
