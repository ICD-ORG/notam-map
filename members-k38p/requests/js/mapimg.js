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
  // מחזיר אובייקט תצוגה {z, E, cLat, cLon, ox, oy}: (cLat,cLon) נקודת המפה שמוצגת בפיקסל (ox,oy) של הקנבס. מעגל — מרכז המעגל במרכז הקנבס; נתיב — מרכז התיבה (routeView)
  function viewFor(res, W, H, mode) {
    if (res.area) return routeView(res, W, H, mode);
    let E = 2 * res.R;
    if (mode === "region") E = Math.max(5000, 2.5 * res.R);
    else if (mode !== "detail") {
      [...res.zones.inside, ...res.zones.near].forEach(z => { E = Math.max(E, Math.hypot(z.p[0], z.p[1])); });
      res.nearScan.items.forEach(it => { E = Math.max(E, Math.hypot(it.p[0], it.p[1])); });
    }
    E *= 1.14;
    const lat = res.inp.lat, c = { cLat: lat, cLon: res.inp.lon, ox: W / 2, oy: H / 2 };
    for (let z = 19; z >= 3; z--) { if ((E / mpp(lat, z)) * 2 <= Math.min(W, H) - 20) return Object.assign({ z, E }, c); }
    return Object.assign({ z: 3, E }, c);
  }

  /* ================= נתיב (res.area): תצוגה, פריסה וגיאומטריה — פונקציות טהורות (נבדקות ב-Node: tests/requests/route-map.test.mjs) =================
     הציור עצמו (render) משותף למעגל ולנתיב; כאן רק מה שנקבע מהנתונים: גודל התמונה, התיבה שמוצגת וההתאמה אליה, וגיאומטריית הציור בפיקסלים. המעגל אינו עובר כאן. */
  const FIT = { l: 24, t: 96, r: 24, b: 24, pad: 1.14 };   // מלבן ההתאמה: אותם גבולות כמו inView (מתחת לכותרת ובשוליים) ושוליים של 14% כמו במעגל
  const MIN_G = 7, MIN_O = 14;   // נתיב: חצי-רוחב מינימלי גלוי (פיקסלים) לפס הירוק ולכתום — צר מזה הוא נבלע בקו הציר, ואז הפס מוגדל לקריאות ומסומן במקרא
  const bboxOf = pts => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; pts.forEach(q => { a = Math.min(a, q[0]); b = Math.min(b, q[1]); c = Math.max(c, q[0]); d = Math.max(d, q[1]); }); return [a, b, c, d]; };   // [minLat,minLon,maxLat,maxLon]
  // תיבת הטבעת סביב הנתיב ברוחב mult×W (כשהטבעת לא נבנתה — תיבת הנקודות מורחבת ב-mult×W)
  // טבעת לא תקינה (simple=false: חותכת את עצמה או לא מכילה את הקפסולה) אינה מגדירה את גבולות הציור — התיבה היא איחוד תיבת הטבעת ותיבת הנקודות המורחבת ב-mult×W (תיבת הקפסולה המדויקת)
  function corridorBB(a, mult) {
    const cr = C.corridorRing(a, mult), r = cr.ring;
    if (r.length && cr.simple) return bboxOf(r);
    const bb = bboxOf(a.pts), P = new C.Proj((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2), d = a.halfWidth * mult;
    const ex = [bb[0] - d / P.ky, bb[1] - d / P.kx, bb[2] + d / P.ky, bb[3] + d / P.kx];
    if (!r.length) return ex;
    const rb = bboxOf(r);
    return [Math.min(rb[0], ex[0]), Math.min(rb[1], ex[1]), Math.max(rb[2], ex[2]), Math.max(rb[3], ex[3])];
  }
  const halfM = bb => { const P = new C.Proj((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2); return [((bb[3] - bb[1]) / 2) * P.kx, ((bb[2] - bb[0]) / 2) * P.ky]; };   // חצי-רוחב וחצי-גובה של תיבה, במטרים
  // גודל התמונה: כמו תמיד (1280×960); נתיב שגבוה יותר מרחב (צפון-דרום, יחס מעל 1.25) — תמונה עומדת 960×1200, כך שהוא ממלא אותה. opts.width/height מכריעים
  function sizeFor(res, opts) {
    opts = opts || {};
    const h = res.area && !opts.width && !opts.height ? halfM(corridorBB(res.area, 2)) : null, tall = !!h && h[1] > 1.25 * h[0];
    return { W: opts.width || (tall ? 960 : 1280), H: opts.height || (tall ? 1200 : 960) };
  }
  // התאמת תיבה [minLat,minLon,maxLat,maxLon] למלבן ההתאמה: הזום הגדול ביותר (19..3) שבו התיבה, כולל שוליים, נכנסת; המרכז — מרכז התיבה, בפיקסל (ox,oy) שהוא מרכז המלבן
  function fitView(bb, W, H) {
    const cLat = (bb[0] + bb[2]) / 2, cLon = (bb[1] + bb[3]) / 2, ox = (FIT.l + W - FIT.r) / 2, oy = (FIT.t + H - FIT.b) / 2, aw = W - FIT.l - FIT.r, ah = H - FIT.t - FIT.b;
    for (let z = 19; z >= 3; z--) {
      const c = worldPx(cLat, cLon, z); let hx = 0, hy = 0;
      [[bb[0], bb[1]], [bb[0], bb[3]], [bb[2], bb[1]], [bb[2], bb[3]]].forEach(q => { const w = worldPx(q[0], q[1], z); hx = Math.max(hx, Math.abs(w[0] - c[0])); hy = Math.max(hy, Math.abs(w[1] - c[1])); });
      if (2 * hx * FIT.pad <= aw && 2 * hy * FIT.pad <= ah) return { z, cLat, cLon, ox, oy };
    }
    return { z: 3, cLat, cLon, ox, oy };
  }
  // נתיב — detail: טבעת ה-2W · overview: טבעת ה-2W ועוד כל אזור ופריט שבטופס (res.zones, res.nearScan.items: הנקודה הקרובה לציר, ll) · region: חצי-רוחב 5 ק״מ לפחות, או פי 1.5 מחצי-הרוחב של הטבעת (לכל ציר), ממורכז על תיבת הנקודות
  function routeView(res, W, H, mode) {
    const a = res.area, d = corridorBB(a, 2);
    let bb = d;
    if (mode === "region") {
      const rb = a.bbox, h = halfM(d), P = new C.Proj((rb[0] + rb[2]) / 2, (rb[1] + rb[3]) / 2), lo = P.ll(-Math.max(5000, 1.5 * h[0]), -Math.max(5000, 1.5 * h[1])), hi = P.ll(Math.max(5000, 1.5 * h[0]), Math.max(5000, 1.5 * h[1]));
      bb = [lo[0], lo[1], hi[0], hi[1]];
    } else if (mode !== "detail") {
      const pts = [[d[0], d[1]], [d[2], d[3]]];
      [...res.zones.inside, ...res.zones.near].forEach(z => { if (z.ll) pts.push(z.ll); });
      res.nearScan.items.forEach(it => { if (it.ll) pts.push(it.ll); });
      bb = bboxOf(pts);
    }
    const h = halfM(bb), v = fitView(bb, W, H);
    v.E = Math.max(h[0], h[1]); v.bb = bb;
    return v;
  }
  // הטלת תצוגה לפיקסלים: X(lat,lon) -> [x,y] בקנבס, ו-pxPerM בקו הרוחב של מרכז התצוגה
  function viewProj(V) {
    const c = worldPx(V.cLat, V.cLon, V.z);
    return { X: (lat, lon) => { const w = worldPx(lat, lon, V.z); return [V.ox + (w[0] - c[0]), V.oy + (w[1] - c[1])]; }, pxPerM: 1 / mpp(V.cLat, V.z) };
  }
  // הנקודה על ציר הנתיב הקרובה ל-ll (קצה קו המרחק מאזור איסור אל הציר)
  function axisNearest(res, ll) {
    const P = res.P && res.P.route ? res.P : C.projFor(res.inp), xy = P.xy(ll[0], ll[1]), r = C.routeNearest(P.route, xy[0], xy[1]);
    return P.ll(r.x, r.y);
  }
  // תגיות הנקודות P1..PN: P1 ו-PN קודם, ואז האמצעיות לפי הסדר; תגית שחופפת לתגית שכבר הונחה (או כל אמצעית במפת אזור) הופכת לנקודה קטנה. מחזיר לפי אינדקס {i,x,y,label,kind:"badge"|"dot",rect}
  function placeBadges(axis, region) {
    const n = axis.length, out = [], placed = [], order = n > 1 ? [0, n - 1] : [0];
    for (let i = 1; i < n - 1; i++) order.push(i);
    order.forEach(i => {
      const x = axis[i][0], y = axis[i][1], label = "P" + (i + 1), w = 12 + 8 * label.length, rect = [x - w / 2, y - 11, x + w / 2, y + 11];
      const badge = !(region && i > 0 && i < n - 1) && !placed.some(p => rect[0] < p[2] + 2 && rect[2] > p[0] - 2 && rect[1] < p[3] + 2 && rect[3] > p[1] - 2);
      if (badge) placed.push(rect);
      out[i] = { i, x, y, label, kind: badge ? "badge" : "dot", rect: badge ? rect : [x - 6, y - 6, x + 6, y + 6] };
    });
    return out;
  }
  // נקודות לאורך קו שבור בפיקסלים, כל step פיקסלים לכל היותר (לבדיקת חפיפה של מקרא עם הנתיב)
  function sampleLine(poly, step) {
    const out = [poly[0]];
    for (let i = 1; i < poly.length; i++) {
      const a = poly[i - 1], b = poly[i], k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
      for (let j = 1; j <= k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
    }
    return out;
  }
  // המלבן הראשון (לפי סדר העדיפויות) שלא מכסה אף דגימה של הנתיב (בשוליים margin); אם כולם מכסים — זה שמכסה הכי פחות. מחזיר אינדקס
  function pickRect(rects, samples, margin) {
    let best = 0, bestN = Infinity;
    rects.forEach((r, i) => {
      const n = samples.filter(q => q[0] >= r[0] - margin && q[0] <= r[2] + margin && q[1] >= r[1] - margin && q[1] <= r[3] + margin).length;
      if (n < bestN) { bestN = n; best = i; }
    });
    return best;
  }
  // מפת אזור של נתיב — מיקום תיבת הכיתוב (רוחב מלא bw, או צר יותר לצד נתיב שעובר באמצע התמונה): מבין פינות שמאל (תחתונה, עליונה, בגובה הסמן pc) וימין, זו שלא חופפת לאלמנטים הקבועים (avoid),
  // לא מכסה את הנתיב, והחץ ממנה אל הסמן חוצה את הנתיב הכי מעט. samples = דגימות הציר בפיקסלים. מחזיר {bx, by, bw, ax, ay}: פינת התיבה, רוחבה ונקודת היציאה של החץ (הנקודה בשפת התיבה הקרובה לסמן)
  function captionSpot(pc, samples, bw, bh, W, H, avoid) {
    const hit = (r, o) => r[0] < o[2] && r[2] > o[0] && r[1] < o[3] && r[3] > o[1], clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v)), yb = H - bh - 70, ym = clamp(Math.round(pc[1] - bh / 2), 84, yb), nw = Math.min(bw, 360);
    const cands = [[16, yb, bw], [16, 84, bw], [16, ym, bw], [16, ym, nw], [W - 16 - bw, yb, bw], [W - 16 - nw, ym, nw], [W - 16 - bw, 84, bw]];
    let best = null;
    cands.forEach(([bx, by, w]) => {
      if (avoid.some(o => hit([bx, by, bx + w, by + bh], o))) return;
      const ax = clamp(pc[0], bx, bx + w), ay = clamp(pc[1], by, by + bh), dx = pc[0] - ax, dy = pc[1] - ay, len = Math.hypot(dx, dy);
      let score = 0;
      samples.forEach(q => {
        if (q[0] >= bx - 8 && q[0] <= bx + w + 8 && q[1] >= by - 8 && q[1] <= by + bh + 8) { score += 50; return; }   // התיבה מכסה את הנתיב
        if (!len) return;
        const t = clamp(((q[0] - ax) * dx + (q[1] - ay) * dy) / (len * len), 0, 1);
        if ((1 - t) * len > 70 && Math.hypot(q[0] - ax - t * dx, q[1] - ay - t * dy) < 10) score++;   // החץ חוצה את הנתיב (למעט הקצה שליד הסמן)
      });
      if (!best || score < best.score) best = { bx, by, bw: w, ax, ay, score };
    });
    return best || { bx: 16, by: yb, bw, ax: clamp(pc[0], 16, 16 + bw), ay: clamp(pc[1], yb, yb + bh), score: Infinity };
  }
  // פריסת הנתיב בפיקסלים: הציר, טבעות ה-W וה-2W (פוליגון הטופס, לפי C.corridorRing), חצי-רוחב הציור של כל פס (מוגדל לקריאות כשהאמיתי צר מדי — enlarged, ואז הפס נצבע כפס עבה סביב הציר: bands),
  // תגיות הנקודות, נקודת העוגן (סמן מפת האזור) ודגימות לבחירת מקום למקרא. V: התצוגה (viewFor), mode: detail|overview|region
  function routeLayout(res, V, mode) {
    const a = res.area, vp = viewProj(V), X = vp.X, px = rg => rg.map(q => X(q[0], q[1]));
    const axis = a.pts.map(q => X(q[0], q[1])), wG0 = a.halfWidth * vp.pxPerM, wO0 = 2 * wG0, wG = Math.max(wG0, MIN_G), wO = Math.max(wO0, MIN_O);
    const g1 = C.corridorRing(a, 1).ring, c2 = C.corridorRing(a, 2), g2 = c2.ring, enlarged = wG > wG0 + 0.5 || wO > wO0 + 0.5, bands = enlarged || !g1.length || !g2.length;
    // טבעת ה-2W אינה תמיד תקינה (פינה פנימית חולפת על פני קטע קצר, או חיתוך עצמי) גם כשטבעת ה-W תקינה: אז הכתום הוא הקפסולה המדויקת (קו עבה ברוחב 2×2W בפיקסלים, קצוות ופינות מעוגלים) ולא הפוליגון
    const capsule2 = !bands && !c2.simple;
    const ring1 = bands ? [] : px(g1), ring2 = bands || capsule2 ? [] : px(g2), badges = placeBadges(axis, mode === "region");
    return { axis, ring1, ring2, bands, capsule2, enlarged, wG, wO, badges, anchor: X(a.lat, a.lon), pxPerM: vp.pxPerM, samples: sampleLine(axis, 8).concat(ring1) };
  }

  // כותרת הקנבס לפי (תצוגה, ספק) — הקידומת היא שם האתר
  function titleFor(site, view, pid) {
    const tail = view === "region" ? "מפת אזור (מרוחק)" : view === "overview" ? (pid === "osm" ? "הדמיה וסימונים על מפת רחובות (מבט כללי)" : "הדמיה וסימונים (מבט כללי)") : pid === "osm" ? "מפת רחובות תקריב" : "תצ״א תקריב";
    return site + " — " + tail;
  }

  // res: תוצאת ReqCore.analyze (נתיב — res.area). opts: {provider: esri|osm, view: detail|overview|region, labels (region בלבד), width, height, tileTimeoutMs, tileUrl, labelTileUrl}
  async function render(res, opts) {
    opts = opts || {};
    const { W, H } = sizeFor(res, opts), pid = opts.provider === "osm" ? "osm" : "esri", prov = PROVIDERS[pid];
    const view = opts.view === "detail" || opts.view === "region" ? opts.view : "overview", region = view === "region", route = !!res.area;
    const V = viewFor(res, W, H, view), { z, ox, oy } = V, inp = res.inp, P = res.P;
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    const [cx, cy] = worldPx(V.cLat, V.cLon, z);
    const X = (lat, lon) => { const w = worldPx(lat, lon, z); return [ox + (w[0] - cx), oy + (w[1] - cy)]; };
    const pxPerM = 1 / mpp(V.cLat, z), zones = [...res.zones.inside, ...res.zones.near], items = res.nearScan.items;
    const RL = route ? routeLayout(res, V, view) : null;   // נתיב: פריסת הציר, הטבעות והתגיות בפיקסלים

    // ---- רקע: אריחים (ובמפת אזור גם שכבת שמות, במקביל ובלי להשפיע על תוצאת הרקע) ----
    g.fillStyle = "#cfd5dc"; g.fillRect(0, 0, W, H);
    const x0 = Math.floor((cx - ox) / 256), x1 = Math.floor((cx + (W - ox)) / 256), y0 = Math.floor((cy - oy) / 256), y1 = Math.floor((cy + (H - oy)) / 256), nT = Math.pow(2, z);
    const tileJobs = (tpl, timeoutMs) => {
      const jobs = [];
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
        if (ty < 0 || ty >= nT) continue;
        const wx = ((tx % nT) + nT) % nT, url = tpl.replace("{z}", z).replace("{x}", wx).replace("{y}", ty);
        jobs.push(loadImage(url, timeoutMs).then(img => ({ img, px: ox + (tx * 256 - cx), py: oy + (ty * 256 - cy) })));
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
    const enlarged = !route && region && (rG > rG0 + 0.5 || rO > rO0 + 0.5);
    const axisPath = c => { c.beginPath(); RL.axis.forEach((q, i) => i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])); };
    const ringSub = rg => { rg.forEach((q, i) => i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); g.closePath(); };
    // פס עבה סביב הציר (קצוות ופינות מעוגלים) על קנבס עזר ואז לקנבס הראשי בשקיפות — כך אין כהות כפולה בחפיפות. half = חצי-רוחב בפיקסלים; hole = חצי-רוחב החור (הירוק מתחת לכתום), edge = קו המסגרת
    const band = (half, hole, fill, alpha, edge, edgeW, holeRing) => {
      const lc = document.createElement("canvas"); lc.width = W; lc.height = H; const lg = lc.getContext("2d"); lg.lineJoin = "round"; lg.lineCap = "round";
      const line = w => { axisPath(lg); lg.lineWidth = w; lg.stroke(); };
      lg.strokeStyle = fill; line(2 * half);
      if (hole) { lg.globalCompositeOperation = "destination-out"; line(2 * hole); lg.globalCompositeOperation = "source-over"; }
      if (holeRing && holeRing.length) {   // חור בצורת פוליגון (הפוליגון הירוק של הטופס) במקום קפסולה
        lg.globalCompositeOperation = "destination-out"; lg.beginPath(); holeRing.forEach((q, i) => i ? lg.lineTo(q[0], q[1]) : lg.moveTo(q[0], q[1])); lg.closePath(); lg.fillStyle = "#000"; lg.fill(); lg.globalCompositeOperation = "source-over";
      }
      g.globalAlpha = alpha; g.drawImage(lc, 0, 0); g.globalAlpha = 1;
      lg.clearRect(0, 0, W, H); lg.strokeStyle = edge; line(2 * half + edgeW); lg.globalCompositeOperation = "destination-out"; line(2 * half - edgeW); g.drawImage(lc, 0, 0);
    };
    if (route) {
      // נתיב: כתום = טבעת ה-2W פחות טבעת ה-W (evenodd), ירוק = טבעת ה-W (הפוליגון שבטופס); כשהרוחב האמיתי צר מדי לציור — פס עבה סביב הציר ברוחב מינימלי גלוי
      if (RL.bands) { band(RL.wO, RL.wG, "#ff9500", 0.28, "#ff9500", 3); band(RL.wG, 0, "#34a853", 0.30, "#22c55e", 3.5); }
      else {
        if (RL.capsule2) band(RL.wO, 0, "#ff9500", 0.28, "#ff9500", 3, RL.ring1);   // טבעת ה-2W לא תקינה: קפסולה מדויקת (קו עבה בעל קצוות ופינות מעוגלים) פחות הפוליגון הירוק
        else {
          g.beginPath(); ringSub(RL.ring2); ringSub(RL.ring1); g.fillStyle = "rgba(255,149,0,0.28)"; g.fill("evenodd");
          g.lineWidth = 3; g.strokeStyle = "#ff9500"; g.beginPath(); ringSub(RL.ring2); g.stroke();
        }
        g.beginPath(); ringSub(RL.ring1); g.fillStyle = "rgba(52,168,83,0.30)"; g.fill();
        g.lineWidth = 3.5; g.strokeStyle = "#22c55e"; g.stroke();
      }
      // ציר הנתיב: קו לבן עם מסגרת כהה (מעל האזורים, מתחת למכשולים); תגיות הנקודות מצוירות בסוף
      const ka = region ? 0.8 : 1;
      g.lineCap = "round"; g.lineJoin = "round"; axisPath(g); g.lineWidth = 7 * ka; g.strokeStyle = DARK; g.stroke(); g.lineWidth = 3 * ka; g.strokeStyle = "#fff"; g.stroke(); g.lineCap = "butt";
    } else {
    g.beginPath(); g.arc(W / 2, H / 2, rO, 0, 2 * Math.PI); g.arc(W / 2, H / 2, rG, 0, 2 * Math.PI, true);
    g.fillStyle = "rgba(255,149,0,0.28)"; g.fill("evenodd");
    g.lineWidth = 3; g.strokeStyle = "#ff9500"; g.beginPath(); g.arc(W / 2, H / 2, rO, 0, 2 * Math.PI); g.stroke();
    g.beginPath(); g.arc(W / 2, H / 2, rG, 0, 2 * Math.PI); g.fillStyle = "rgba(52,168,83,0.30)"; g.fill();
    g.lineWidth = 3.5; g.strokeStyle = "#22c55e"; g.stroke();
    }

    // ---- מקרא, סרגל וחץ צפון: נקבעים מראש כדי שתוויות המספרים והאזורים לא יוסתרו מתחתם ----
    const rows = [["#22c55e", "ירוק: אזור הסגירה (0–" + res.R + " מ׳)"], ["#ff9500", "כתום: עד " + 2 * res.R + " מ׳"], ["#ff3b30", "אדום: אזור אסור/מוגבל (פמ״ת א-17)"], ...(zones.some(z => z.src === "b09") ? [["#3b82f6", "כחול: אזור טיסה לכטב״ם (פמ״ת ב-09)"]] : []), ["#ffd400", region ? "צהוב: מכשול" : "צהוב: מכשול (מספר = ברשימה בטופס)"], ["#22d3ee", "תכלת: אתר/תשתית קרקעית (אצטדיון, כביש, מסילה...)"], ["#e040fb", "סגול: תשתית/מכשול אווירי (שדה, מנחת, בלון)"], ["#a3e635", "ירוק בהיר: אתר המונים / תשתית נוספת"]];
    if (enlarged) rows.push([null, "הטבעת מוגדלת לקריאות; הרדיוס האמיתי " + res.R + " מ׳"]);
    if (route) {   // נתיב: רוחב מכל צד של הציר במקום רדיוס, ושורה לציר ולנקודותיו
      rows[0] = ["#22c55e", "ירוק: אזור הסגירה (" + res.R + " מ׳ מכל צד של הציר)"]; rows[1] = ["#ff9500", "כתום: עד " + 2 * res.R + " מ׳ מציר הנתיב"];
      rows.splice(2, 0, ["#ffffff", "לבן: ציר הנתיב ונקודותיו P1–P" + res.area.pts.length + " (לפי הסדר)"]);
      if (RL.enlarged) rows.push([null, "הנתיב מוגדל לקריאות; הרוחב האמיתי " + res.R + " מ׳ מכל צד"]);
    }
    let lx0 = W - 20 - 420, ly0 = H - 20 - rows.length * 26 - 12;
    let sm = NICE[0];
    NICE.forEach(n => { if (n * pxPerM <= 200) sm = n; });
    const sx = 24, sy = H - 28, sl = sm * pxPerM;
    let legendRect = [lx0 - 12, ly0 - 8, lx0 + 420, H - 4];
    if (route) {   // נתיב ארוך עלול לעבור מתחת למקרא: הפינה הראשונה (ברירת מחדל — למטה מימין, כמו במעגל) שאינה מכסה את הנתיב; במפת אזור אין פינה שמאלית תחתונה (תיבת הכיתוב)
      const lh = rows.length * 26 + 20, cand = [[W - 452, H - 8 - lh], [8, 78], [W - 502, 78], ...(region ? [] : [[8, H - 62 - lh]])], c = cand[pickRect(cand.map(q => [q[0], q[1], q[0] + 432, q[1] + lh]), RL.samples, 10)];
      lx0 = c[0] + 12; ly0 = c[1] + 8; legendRect = [c[0], c[1], c[0] + 432, c[1] + lh];
    }
    const blocked = [legendRect, [sx - 10, sy - 28, sx + sl + 80, sy + 16], [W - 62, 76, W - 18, 140], ...(route ? RL.badges.map(b => b.rect) : [[W / 2 - 18, H / 2 - 18, W / 2 + 18, H / 2 + 18]])];   // מקרא · סרגל · צפון · צלב המרכז (בנתיב: תגיות הנקודות)
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
    if (route) {   // נתיב: כמה אזורים לאורך הקו — מזיזים כיתוב (אנכית עד ±3 שורות, ואם צריך גם הצידה) כך שלא יחפוף לתגית, למקרא או לכיתוב אחר; אם אין מקום פנוי — המיקום עם הכי פחות חפיפות
      const taken = blocked.slice(), hit = (r, o) => r[0] < o[2] && r[2] > o[0] && r[1] < o[3] && r[3] > o[1];
      zlabels.forEach(l => {
        const w = l.rect[2] - l.rect[0], sh = Math.round(w / 2 + 30), cands = [];
        [0, -sh, sh].forEach(dx => [0, 26, -26, 52, -52, 78, -78].forEach(dy => cands.push([dx, dy])));
        let best = null;
        for (const [dx, dy] of cands) {
          const y = Math.min(Math.max(l.y + dy, region ? 100 : 120), H - 40), rect = [l.rect[0] + dx, y - 12, l.rect[2] + dx, y + 12];
          if (rect[0] < 4 || rect[2] > W - 4) continue;
          const n = taken.filter(o => hit(rect, o)).length;
          if (!best || n < best.n) best = { n, dx, y, rect };
          if (!n) break;
        }
        if (best) { l.x += best.dx; l.y = best.y; l.rect = best.rect; }
        taken.push(l.rect);
      });
    }

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
      const zn = l.zn, a = route ? X(...axisNearest(res, zn.ll)) : [W / 2, H / 2], b = l.b;
      if (zn.d >= 1) {
        const zc = zn.src === "b09" ? "#3b82f6" : "#ff3b30";
        g.setLineDash([8, 6]); g.lineWidth = 2.5; g.strokeStyle = zc; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); g.setLineDash([]);
        g.beginPath(); g.arc(b[0], b[1], 5, 0, 2 * Math.PI); g.fillStyle = zc; g.fill();
      }
      text(l.s, l.x, l.y, { align: l.align, color: zn.src === "b09" ? "#cfe0ff" : "#ffd1cc", ltr: true });
    });

    // ---- נתיב: תגיות הנקודות P1..PN (מעל הכול חוץ מסמן מפת האזור): נקודה קטנה היכן שאין מקום לתגית, ותגית לבנה עם מסגרת כהה (שונה מבועות המספרים השחורות של הפריטים) ----
    const drawBadges = () => {
      RL.badges.forEach(b => { if (b.kind === "dot") { g.beginPath(); g.arc(b.x, b.y, 5, 0, 2 * Math.PI); g.fillStyle = "#fff"; g.fill(); g.lineWidth = 2; g.strokeStyle = "#111"; g.stroke(); } });
      RL.badges.forEach(b => {
        if (b.kind !== "badge") return;
        const r = b.rect, rd = 6;
        g.beginPath(); g.moveTo(r[0] + rd, r[1]); g.arcTo(r[2], r[1], r[2], r[3], rd); g.arcTo(r[2], r[3], r[0], r[3], rd); g.arcTo(r[0], r[3], r[0], r[1], rd); g.arcTo(r[0], r[1], r[2], r[1], rd); g.closePath();
        g.fillStyle = "#fff"; g.fill(); g.lineWidth = 2.5; g.strokeStyle = "#111"; g.stroke();
        g.fillStyle = "#111"; g.font = "bold 13px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.direction = "ltr"; g.fillText(b.label, b.x, b.y + 1);
      });
    };
    if (route && !region) drawBadges();
    // ---- מרכז: צלב (תקריב/הדמיה) או סמן טיפה אדום שקצהו על המרכז + חץ לכיתוב (מפת אזור). נתיב: הסמן באמצע אורך הנתיב, ותיבת הכיתוב בפינה שבה החץ לא חוצה את הנתיב (captionSpot) ----
    if (region) {
      const ncap = items.length, site = (inp.siteName || "").trim() || "בקשת סגירה אווירית", pc = route ? RL.anchor : [W / 2, H / 2];
      const bh = 104, cs = route ? captionSpot(pc, RL.samples, Math.min(450, W - 40), bh, W, H, [legendRect, blocked[1], blocked[2], ...zlabels.map(l => l.rect)]) : null, bw = route ? cs.bw : Math.min(450, W - 40);
      const bx = route ? cs.bx : Math.max(16, W / 2 - 120 - bw), by = route ? cs.by : Math.min(H / 2 + 80, H - bh - 70);
      // חץ מתיבת הכיתוב אל הטבעת (נעצר מחוץ לטבעת הכתומה כדי לא להסתיר את המיקום)
      const ax = route ? cs.ax : bx + bw, ay = route ? cs.ay : by, dist = Math.hypot(pc[0] - ax, pc[1] - ay), ux = (pc[0] - ax) / dist, uy = (pc[1] - ay) / dist, stop = (route ? RL.wO : rO) + 14;
      const ex = pc[0] - ux * stop, ey = pc[1] - uy * stop;
      if (!route || dist > stop + 24) {   // נתיב: כשהסמן קרוב לתיבה אין מקום לחץ
      g.lineCap = "round"; g.strokeStyle = DARK; g.lineWidth = 7; g.beginPath(); g.moveTo(ax, ay); g.lineTo(ex, ey); g.stroke();
      g.strokeStyle = "#fff"; g.lineWidth = 3; g.beginPath(); g.moveTo(ax, ay); g.lineTo(ex, ey); g.stroke(); g.lineCap = "butt";
      const hx = ex + ux * 2, hy = ey + uy * 2, nx = -uy, ny = ux;   // ראש החץ: קצהו ב-(hx,hy)
      g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx - ux * 18 + nx * 9, hy - uy * 18 + ny * 9); g.lineTo(hx - ux * 18 - nx * 9, hy - uy * 18 - ny * 9); g.closePath();
      g.fillStyle = "#fff"; g.fill(); g.lineWidth = 2; g.strokeStyle = DARK; g.stroke();
      }
      if (route) drawBadges();
      // סמן הטיפה: הקצה התחתון בדיוק על המרכז
      const pinPath = () => { g.beginPath(); g.moveTo(pc[0], pc[1]); g.bezierCurveTo(pc[0] - 5, pc[1] - 12, pc[0] - 13, pc[1] - 21, pc[0] - 13, pc[1] - 31); g.arc(pc[0], pc[1] - 31, 13, Math.PI, 2 * Math.PI); g.bezierCurveTo(pc[0] + 13, pc[1] - 21, pc[0] + 5, pc[1] - 12, pc[0], pc[1]); g.closePath(); };
      pinPath(); g.lineWidth = 6; g.strokeStyle = DARK; g.stroke();
      pinPath(); g.fillStyle = "#e11d48"; g.fill(); g.lineWidth = 2.5; g.strokeStyle = "#fff"; g.stroke();
      g.beginPath(); g.arc(pc[0], pc[1] - 31, 5, 0, 2 * Math.PI); g.fillStyle = "#fff"; g.fill();
      // תיבת הכיתוב: שם האתר, נ״צ, ומספר המכשולים/תשתיות במיקום
      g.fillStyle = "rgba(11,18,32,0.92)"; g.fillRect(bx, by, bw, bh); g.lineWidth = 2; g.strokeStyle = "#e11d48"; g.strokeRect(bx, by, bw, bh);
      const cap = ncap === 0 ? "במיקום: לא נמצאו מכשולים/תשתיות — ראו התמונות המקרבות" : ncap === 1 ? "במיקום: מכשול/תשתית אחד — ראו התמונות המקרבות" : "במיקום: " + ncap + " מכשולים/תשתיות — ראו התמונות המקרבות";
      text(site, bx + bw - 14, by + 25, { align: "right", size: 19, max: bw - 28, halo: NOHALO });
      if (route) text("נתיב " + res.area.pts.length + " נקודות   ·   " + C.fmtDist(res.area.lengthM) + "   ·   " + res.R + " מ׳ מכל צד", bx + bw - 14, by + 54, { align: "right", size: 15, bold: false, color: "#cfe3ff", max: bw - 28, halo: NOHALO });
      else text(C.dmsLat(inp.lat) + "   " + C.dmsLon(inp.lon), bx + bw - 14, by + 54, { align: "right", ltr: true, size: 15, bold: false, color: "#cfe3ff", max: bw - 28, halo: NOHALO });
      text(cap, bx + bw - 14, by + 82, { align: "right", size: 15, bold: false, color: "#ffe9a8", max: bw - 28, halo: NOHALO });
    } else if (!route) {
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
    if (route) {   // נתיב: אורך ורוחב במקום רדיוס; בפינה — הנקודה הראשונה בלבד (כל הנקודות בטופס)
      const p1 = res.area.pts[0];
      text("נתיב " + res.area.pts.length + " נקודות   ·   " + C.fmtDist(res.area.lengthM) + "   ·   " + res.R + " מ׳ מכל צד   ·   גובה " + C.trimNum(inp.heightM, 2) + " מ׳ (" + res.ft.toFixed(1) + " רגל) מעפ״ש (AGL)", W - 20, 50, { align: "right", size: 15, bold: false, color: "#cfe3ff", halo: NOHALO, max: Math.round(W * 0.6) });
      text("P1 " + C.dmsLat(p1[0]) + "   " + C.dmsLon(p1[1]), 20, 50, { align: "left", ltr: true, size: 15, bold: false, color: "#cfe3ff", halo: NOHALO, max: Math.round(W * 0.33) });
    } else {
    text("רדיוס " + res.R + " מ׳   ·   גובה " + C.trimNum(inp.heightM, 2) + " מ׳ (" + res.ft.toFixed(1) + " רגל) מעפ״ש (AGL)", W - 20, 50, { align: "right", size: 15, bold: false, color: "#cfe3ff", halo: NOHALO });
    text(C.dmsLat(inp.lat) + "   " + C.dmsLon(inp.lon), 20, 50, { align: "left", ltr: true, size: 15, bold: false, color: "#cfe3ff", halo: NOHALO });
    }
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
    return { canvas: cv, view, dataUrl, jpegUrl, background: background && !tainted, tiles: tiles.length, failedTiles: failed, labelTiles, tainted, zoom: z, provider: pid, area: route ? "route" : "circle" };
  }

  root.ReqMap = { render, PROVIDERS, worldPx, mpp, viewFor, sizeFor, viewProj, routeLayout, axisNearest, placeBadges, pickRect, sampleLine, captionSpot };
})(typeof self !== "undefined" ? self : this);
