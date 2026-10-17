/* ציור תמונת המפה לבקשה (PNG): רקע תצלום אוויר/מפה + העיגולים, אזורי א-17, מכשולים ותשתיות — הכול בקנבס, בלי תלות בספריית מפות.
   תמונה כזאת מצורפת לטופס ("חובה לצרף מפה/תצ״א"). דורש דפדפן. */
(function (root) {
  "use strict";
  const C = root.ReqCore;
  const PROVIDERS = {
    esri: { name: "צילום אוויר (Esri World Imagery)", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", attribution: "© Esri, Maxar, Earthstar Geographics" },
    osm: { name: "מפת רחובות (OpenStreetMap)", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: "© OpenStreetMap contributors" }
  };

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

  // detail: סביב הסגירה (עד פי 2 מהרדיוס) · overview: כולל כל מה שבטופס (אזורי איסור, אתרים ותשתיות)
  function viewFor(res, W, H, mode) {
    let E = 2 * res.R;
    if (mode !== "detail") {
      [...res.zones.inside, ...res.zones.near].forEach(z => { E = Math.max(E, Math.hypot(z.p[0], z.p[1])); });
      res.nearScan.items.forEach(it => { E = Math.max(E, Math.hypot(it.p[0], it.p[1])); });
    }
    E *= 1.14;
    const lat = res.inp.lat;
    for (let z = 19; z >= 3; z--) { if ((E / mpp(lat, z)) * 2 <= Math.min(W, H) - 20) return { z, E }; }
    return { z: 3, E };
  }

  // res: תוצאת ReqCore.analyze. opts: {provider, width, height, tileTimeoutMs, fetchTile}
  async function render(res, opts) {
    opts = opts || {};
    const W = opts.width || 1280, H = opts.height || 960, prov = PROVIDERS[opts.provider || "esri"];
    const view = opts.view === "detail" ? "detail" : "overview", { z } = viewFor(res, W, H, view), inp = res.inp, P = res.P;
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    const [cx, cy] = worldPx(inp.lat, inp.lon, z);
    const X = (lat, lon) => { const w = worldPx(lat, lon, z); return [W / 2 + (w[0] - cx), H / 2 + (w[1] - cy)]; };
    const mxy = (x, y) => { const ll = P.ll(x, y); return X(ll[0], ll[1]); };
    const pxPerM = 1 / mpp(inp.lat, z);

    // ---- רקע: אריחים ----
    g.fillStyle = "#cfd5dc"; g.fillRect(0, 0, W, H);
    const x0 = Math.floor((cx - W / 2) / 256), x1 = Math.floor((cx + W / 2) / 256), y0 = Math.floor((cy - H / 2) / 256), y1 = Math.floor((cy + H / 2) / 256);
    const jobs = []; const nT = Math.pow(2, z);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      if (ty < 0 || ty >= nT) continue;
      const wx = ((tx % nT) + nT) % nT;
      const url = (opts.tileUrl || prov.url).replace("{z}", z).replace("{x}", wx).replace("{y}", ty);
      jobs.push(loadImage(url, opts.tileTimeoutMs).then(img => ({ img, px: W / 2 + (tx * 256 - cx), py: H / 2 + (ty * 256 - cy) })));
    }
    const tiles = await Promise.all(jobs);
    let failed = 0;
    tiles.forEach(t => { if (t.img) g.drawImage(t.img, Math.round(t.px), Math.round(t.py), 256, 256); else failed++; });
    const background = failed === 0 && tiles.length > 0;

    const plain = !!opts.plain;
    g.lineJoin = "round";
    const path = (pts, close) => { g.beginPath(); pts.forEach((p, i) => { const q = X(p[0], p[1]); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); if (close) g.closePath(); };
    const text = (s, x, y, o) => {
      o = o || {}; g.font = (o.bold === false ? "" : "bold ") + (o.size || 15) + "px sans-serif"; g.textAlign = o.align || "center"; g.textBaseline = "middle"; g.direction = o.ltr ? "ltr" : "rtl";
      g.lineWidth = 4; g.strokeStyle = o.halo || "rgba(0,0,0,0.85)"; g.strokeText(s, x, y); g.fillStyle = o.color || "#fff"; g.fillText(s, x, y);
    };
    if (!plain) {
    [...res.zones.inside, ...res.zones.near].forEach(zn => {
      const zz = zn.z, rings = zz.rings && zz.rings.length ? zz.rings : (zz.c && zz.r ? [C.circlePoints(new C.Proj(zz.c[0], zz.c[1]), zz.r, 96)] : []);
      rings.forEach(rg => { path(rg, true); g.fillStyle = zn.src === "b09" ? "rgba(59,130,246,0.26)" : "rgba(255,59,48,0.30)"; g.fill(); g.lineWidth = 3; g.strokeStyle = zn.src === "b09" ? "#2563eb" : "#d92d20"; g.setLineDash(zn.approx ? [10, 7] : []); g.stroke(); g.setLineDash([]); });   // בקירוב = קו מקווקו
    });
    // ---- טבעת כתומה וירוקה ----
    const rO = 2 * res.R * pxPerM, rG = res.R * pxPerM;
    g.beginPath(); g.arc(W / 2, H / 2, rO, 0, 2 * Math.PI); g.arc(W / 2, H / 2, rG, 0, 2 * Math.PI, true);
    g.fillStyle = "rgba(255,149,0,0.28)"; g.fill("evenodd");
    g.lineWidth = 3; g.strokeStyle = "#ff9500"; g.beginPath(); g.arc(W / 2, H / 2, rO, 0, 2 * Math.PI); g.stroke();
    g.beginPath(); g.arc(W / 2, H / 2, rG, 0, 2 * Math.PI); g.fillStyle = "rgba(52,168,83,0.30)"; g.fill();
    g.lineWidth = 3.5; g.strokeStyle = "#22c55e"; g.stroke();

    // ---- מכשולים ותשתיות ----
    const labels = [];
    const COL = { obst: ["#ffd400", "rgba(255,212,0,0.40)"], ground: ["#22d3ee", "rgba(34,211,238,0.30)"], air: ["#e040fb", "rgba(224,64,251,0.32)"], census: ["#a3e635", "rgba(163,230,53,0.28)"] };
    res.nearScan.items.forEach(it => {
      const [c1, c2] = COL[it.cat] || COL.obst;
      it.geoms.forEach(gm => {
        if (gm.pt) return;
        path(gm.pts, gm.closed);
        if (gm.closed) { g.fillStyle = c2; g.fill(); g.lineWidth = 3; g.strokeStyle = it.cat === "obst" ? "#111" : c1; g.stroke(); }
        else { g.lineWidth = 5.5; g.strokeStyle = c1; g.setLineDash([]); g.stroke(); g.lineWidth = 2.2; g.strokeStyle = "#111"; g.setLineDash([9, 5]); g.stroke(); g.setLineDash([]); }
      });
    });
    const occupied = [];
    const inView = q => q[0] > 24 && q[0] < W - 24 && q[1] > 96 && q[1] < H - 24;
    res.nearScan.items.forEach(it => {
      const pt = it.geoms.find(gm => gm.pt), [c1] = COL[it.cat] || COL.obst;
      const q = pt ? X(pt.pt[0], pt.pt[1]) : X(it.ll[0], it.ll[1]);
      if (!inView(q)) return;
      if (pt) { g.fillStyle = c1; g.strokeStyle = "#111"; g.lineWidth = 2; g.fillRect(q[0] - 8, q[1] - 8, 16, 16); g.strokeRect(q[0] - 8, q[1] - 8, 16, 16); }
      labels.push({ q, n: it.n, c: c1, d: it.d, t: it.d < 1 ? "בתוך השטח" : C.fmtDist(it.d) });
    });
    // תוויות (מספר + מרחק) עם הימנעות מחפיפה: מנסה כמה מיקומים סביב הסימון
    const OFFS = [[16, -16], [16, 18], [-16, -16], [-16, 18], [0, -34], [0, 36], [38, -30], [38, 32], [-38, -30], [-38, 32], [60, 0], [-60, 0], [70, -50], [-70, 50]];
    g.font = "bold 12px sans-serif";
    labels.forEach(l => {
      const tw = g.measureText(l.t).width, w = 24 + 5 + tw;
      let best = null;
      for (const [dx, dy] of OFFS) {
        const cx = l.q[0] + dx, cy = l.q[1] + dy, left = dx < 0;
        const rect = left ? [cx - 12 - 5 - tw, cy - 12, cx + 12, cy + 12] : [cx - 12, cy - 12, cx + 12 + 5 + tw, cy + 12];
        const hit = occupied.some(o => rect[0] < o[2] && rect[2] > o[0] && rect[1] < o[3] && rect[3] > o[1]) || rect[0] < 4 || rect[2] > W - 4 || rect[1] < 76 || rect[3] > H - 4;
        if (!hit) { best = { cx, cy, left, rect }; break; }
        if (!best) best = { cx, cy, left, rect };
      }
      occupied.push(best.rect);
      if (Math.abs(best.cx - l.q[0]) > 20 || Math.abs(best.cy - l.q[1]) > 20) { g.strokeStyle = "rgba(255,255,255,0.8)"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(l.q[0], l.q[1]); g.lineTo(best.cx, best.cy); g.stroke(); }
      g.beginPath(); g.arc(best.cx, best.cy, 11, 0, 2 * Math.PI); g.fillStyle = "#111"; g.fill();
      g.fillStyle = l.c; g.font = "bold 14px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.direction = "ltr"; g.fillText(String(l.n), best.cx, best.cy + 1);
      g.font = "bold 12px sans-serif"; g.textAlign = best.left ? "right" : "left"; g.direction = "rtl";
      const tx = best.left ? best.cx - 17 : best.cx + 17;
      g.lineWidth = 3.5; g.strokeStyle = "rgba(0,0,0,0.85)"; g.strokeText(l.t, tx, best.cy + 1); g.fillStyle = "#fff"; g.fillText(l.t, tx, best.cy + 1);
    });

    // ---- קווי מרחק לאזורי איסור ----
    [...res.zones.inside, ...res.zones.near].forEach(zn => {
      const a = [W / 2, H / 2], b = X(zn.ll[0], zn.ll[1]);
      if (!inView(b)) return;
      if (zn.d >= 1) {
        const zc = zn.src === "b09" ? "#3b82f6" : "#ff3b30";
        g.setLineDash([8, 6]); g.lineWidth = 2.5; g.strokeStyle = zc; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); g.setLineDash([]);
        g.beginPath(); g.arc(b[0], b[1], 5, 0, 2 * Math.PI); g.fillStyle = zc; g.fill();
      }
      const lx = Math.min(Math.max(b[0], 150), W - 150), ly = Math.min(Math.max(b[1] - 20, 120), H - 40);
      text(zn.id + (zn.src === "b09" ? " · כטב״ם ב-09" : " · " + zn.name) + (zn.approx ? " (בקירוב)" : "") + (zn.d >= 1 ? " · " + C.fmtDist(zn.d) : ""), lx, ly, { color: zn.src === "b09" ? "#cfe0ff" : "#ffd1cc", ltr: true });
    });

    // ---- מרכז ----
    g.strokeStyle = "#fff"; g.lineWidth = 5; g.beginPath(); g.moveTo(W / 2 - 14, H / 2); g.lineTo(W / 2 + 14, H / 2); g.moveTo(W / 2, H / 2 - 14); g.lineTo(W / 2, H / 2 + 14); g.stroke();
    g.strokeStyle = "#111"; g.lineWidth = 2; g.stroke();
    g.beginPath(); g.arc(W / 2, H / 2, 4, 0, 2 * Math.PI); g.fillStyle = "#111"; g.fill();

    }
    // ---- סרגל קנה מידה ----
    const nice = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000]; let sm = nice[0];
    nice.forEach(n => { if (n * pxPerM <= 200) sm = n; });
    const sx = 24, sy = H - 28, sl = sm * pxPerM;
    g.fillStyle = "rgba(0,0,0,0.55)"; g.fillRect(sx - 10, sy - 28, sl + 90, 44);
    g.strokeStyle = "#fff"; g.lineWidth = 4; g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + sl, sy); g.stroke();
    text(sm >= 1000 ? sm / 1000 + " ק״מ" : sm + " מ׳", sx + sl + 36, sy - 4, { size: 14 });
    // צפון
    g.fillStyle = "rgba(0,0,0,0.55)"; g.fillRect(W - 62, 76, 44, 64);
    g.fillStyle = "#fff"; g.beginPath(); g.moveTo(W - 40, 84); g.lineTo(W - 30, 112); g.lineTo(W - 40, 106); g.lineTo(W - 50, 112); g.closePath(); g.fill();
    text("N", W - 40, 126, { size: 15 });

    if (!plain) {
    // ---- כותרת ----
    g.fillStyle = "rgba(11,18,32,0.88)"; g.fillRect(0, 0, W, 70);
    text("בקשת סגירה אווירית — " + inp.siteName + (view === "detail" ? " (תקריב)" : " (מבט כללי)"), W - 20, 22, { align: "right", size: 20, halo: "rgba(0,0,0,0)" });
    text("רדיוס " + res.R + " מ׳   ·   גובה " + C.trimNum(inp.heightM, 2) + " מ׳ (" + res.ft.toFixed(1) + " רגל) מעפ״ש (AGL)", W - 20, 50, { align: "right", size: 15, bold: false, color: "#cfe3ff", halo: "rgba(0,0,0,0)" });
    text(C.dmsLat(inp.lat) + "   " + C.dmsLon(inp.lon), 20, 50, { align: "left", ltr: true, size: 15, bold: false, color: "#cfe3ff", halo: "rgba(0,0,0,0)" });
    // ---- מקרא ----
    const items = [["#22c55e", "ירוק: אזור הסגירה (0–" + res.R + " מ׳)"], ["#ff9500", "כתום: עד " + 2 * res.R + " מ׳"], ["#ff3b30", "אדום: אזור אסור/מוגבל (פמ״ת א-17)"], ...(([...res.zones.inside, ...res.zones.near].some(z => z.src === "b09")) ? [["#3b82f6", "כחול: אזור טיסה לכטב״ם (פמ״ת ב-09)"]] : []), ["#ffd400", "צהוב: מכשול (מספר = ברשימה בטופס)"], ["#22d3ee", "תכלת: אתר/תשתית קרקעית (אצטדיון, כביש, מסילה...)"], ["#e040fb", "סגול: תשתית/מכשול אווירי (שדה, מנחת, בלון)"], ["#a3e635", "ירוק בהיר: אתר המונים / תשתית נוספת"]];
    const lx0 = W - 20 - 420, ly0 = H - 20 - items.length * 26 - 12;
    g.fillStyle = "rgba(0,0,0,0.62)"; g.fillRect(lx0 - 12, ly0 - 8, 432, items.length * 26 + 20);
    items.forEach((it, i) => { g.fillStyle = it[0]; g.fillRect(lx0 + 400, ly0 + 5 + i * 26, 16, 16); text(it[1], lx0 + 390, ly0 + 13 + i * 26, { align: "right", size: 14, bold: false, halo: "rgba(0,0,0,0)" }); });
    }
    // ---- זכויות יוצרים ----
    text(prov.attribution + " · " + new Date().toISOString().slice(0, 10), 6, H - 6, { align: "left", ltr: true, size: 11, bold: false, halo: "rgba(0,0,0,0.9)" });

    let dataUrl = null, jpegUrl = null, tainted = false;
    try { dataUrl = cv.toDataURL("image/png"); jpegUrl = cv.toDataURL("image/jpeg", 0.9); } catch (e) { tainted = true; }
    return { canvas: cv, view, dataUrl, jpegUrl, background: background && !tainted, tiles: tiles.length, failedTiles: failed, tainted, zoom: z, provider: opts.provider || "esri" };
  }

  root.ReqMap = { render, PROVIDERS, worldPx, mpp, viewFor };
})(typeof self !== "undefined" ? self : this);
