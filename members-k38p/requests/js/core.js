/* ליבת החישוב של "בקשת סגירה אווירית" — גיאומטריה, סריקת סביבה, אזורי א-17, שקיעה, נוטמים.
   קוד נקי (בלי DOM): רץ בדפדפן וגם ב-Node, כדי שאפשר לבדוק אותו מול נתונים אמיתיים. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ReqCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const M2FT = 3.28084, NM = 1852;
  const HEB_DAY = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"]; // לפי getUTCDay()
  const TZ = "Asia/Jerusalem";

  /* ================= גיאומטריה ================= */
  // היטל מקומי (מטרים) סביב נקודה: אורך מעלה לפי WGS84 בקו הרוחב של הנקודה
  function Proj(lat, lon) {
    const p = (lat * Math.PI) / 180;
    this.lat = lat; this.lon = lon;
    this.ky = 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p) - 0.0023 * Math.cos(6 * p);
    this.kx = 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p);
  }
  Proj.prototype.xy = function (la, lo) { return [(lo - this.lon) * this.kx, (la - this.lat) * this.ky]; };
  Proj.prototype.ll = function (x, y) { return [this.lat + y / this.ky, this.lon + x / this.kx]; };
  // מרחק נקודה (x,y) מציר האזור: במעגל — מהמרכז (הראשית); בנתיב (P.route = הקו השבור במטרים, ראו projFor) — מהקו השבור
  Proj.prototype.dPt = function (x, y) { return this.route ? routeNearest(this.route, x, y).d : Math.hypot(x, y); };

  function segNearest(ax, ay, bx, by) { // הנקודה הקרובה לראשית על הקטע
    const dx = bx - ax, dy = by - ay;
    if (dx === 0 && dy === 0) return [ax, ay];
    const t = Math.max(0, Math.min(1, (-ax * dx - ay * dy) / (dx * dx + dy * dy)));
    return [ax + t * dx, ay + t * dy];
  }
  function pointInRing(pts) { // הראשית בתוך הטבעת
    let c = false;
    for (let i = 0, n = pts.length; i < n; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n];
      if ((y1 > 0) !== (y2 > 0) && 0 < ((x2 - x1) * (0 - y1)) / (y2 - y1) + x1) c = !c;
    }
    return c;
  }
  // קו שבור: מרחק + הנקודה הקרובה. סגור=true מוסיף בדיקת "בתוך"
  function polyNearest(pts, closed, route) {
    if (route) return polyNearestRoute(pts, closed, route);   // נתיב: מרחק מהקו השבור (ראו polyNearestRoute); בלי route — מרחק מהראשית (מעגל), בדיוק כמו קודם
    // closed=true: הטבעת נסגרת אוטומטית (אם הנקודה האחרונה אינה הראשונה) — אחרת הקטע האחרון נעדר, והנקודה בתוך הצורה נחשבת "מחוץ" לה
    if (closed && pts.length >= 3 && (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1])) pts = pts.concat([pts[0]]);
    if (pts.length === 1) return { d: Math.hypot(pts[0][0], pts[0][1]), p: pts[0], inside: false };
    let best = { d: Infinity, p: pts[0] };
    for (let i = 0; i < pts.length - 1; i++) {
      const q = segNearest(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]), d = Math.hypot(q[0], q[1]);
      if (d < best.d) best = { d, p: q };
    }
    const isClosed = closed && pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
    const inside = isClosed && pointInRing(pts);
    return inside ? { d: 0, p: [0, 0], inside: true } : { d: best.d, p: best.p, inside: false };
  }
  /* ----- נתיב: מרחקים מקו שבור (כל החישובים במטרים, בהיטל המקומי P) ----- */
  function ptSeg(px, py, ax, ay, bx, by) { // הנקודה הקרובה ל-(px,py) על הקטע AB
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2));
    const x = ax + t * dx, y = ay + t * dy;
    return { d: Math.hypot(px - x, py - y), x, y, t };
  }
  function routeNearest(route, px, py) { // הנקודה הקרובה על הקו השבור: {d, x, y, i (הקטע)}
    let best = { d: Infinity, x: route[0][0], y: route[0][1], i: 0 };
    for (let i = 0; i < route.length - 1; i++) {
      const r = ptSeg(px, py, route[i][0], route[i][1], route[i + 1][0], route[i + 1][1]);
      if (r.d < best.d) best = { d: r.d, x: r.x, y: r.y, i };
    }
    if (route.length === 1) best = { d: Math.hypot(px - route[0][0], py - route[0][1]), x: route[0][0], y: route[0][1], i: 0 };
    return best;
  }
  function segCross(ax, ay, bx, by, cx, cy, dx, dy) { // נקודת חיתוך של שני קטעים, או null
    const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy, den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-12) return null;
    const t = ((cx - ax) * sy - (cy - ay) * sx) / den, u = ((cx - ax) * ry - (cy - ay) * rx) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [ax + t * rx, ay + t * ry] : null;
  }
  function segSegDist(ax, ay, bx, by, cx, cy, dx, dy) { // המרחק בין שני קטעים והנקודה הקרובה על הראשון (AB)
    const x = segCross(ax, ay, bx, by, cx, cy, dx, dy);
    if (x) return { d: 0, p: x };
    const cands = [{ r: ptSeg(ax, ay, cx, cy, dx, dy), p: [ax, ay] }, { r: ptSeg(bx, by, cx, cy, dx, dy), p: [bx, by] }, { r: ptSeg(cx, cy, ax, ay, bx, by), p: null }, { r: ptSeg(dx, dy, ax, ay, bx, by), p: null }];
    let best = null;
    cands.forEach(c => { if (!best || c.r.d < best.r.d) best = c; });
    return { d: best.r.d, p: best.p || [best.r.x, best.r.y] };
  }
  function pointInRingXY(px, py, pts) { // (px,py) בתוך הטבעת
    let c = false;
    for (let i = 0, n = pts.length; i < n; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n];
      if ((y1 > py) !== (y2 > py) && px < ((x2 - x1) * (py - y1)) / (y2 - y1) + x1) c = !c;
    }
    return c;
  }
  // כמו polyNearest, אבל המרחק הוא מהנתיב (הקו השבור route) ולא מהראשית: הקטע הקרוב ביותר בין הצורה לנתיב, וטבעת שמכילה את הנתיב (או חוצה אותו) — מרחק 0
  function polyNearestRoute(pts, closed, route) {
    if (closed && pts.length >= 3 && (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1])) pts = pts.concat([pts[0]]);
    if (pts.length === 1) { const r = routeNearest(route, pts[0][0], pts[0][1]); return { d: r.d, p: pts[0], inside: false }; }
    const rb = [];
    for (let j = 0; j < route.length - 1; j++) rb.push([Math.min(route[j][0], route[j + 1][0]), Math.min(route[j][1], route[j + 1][1]), Math.max(route[j][0], route[j + 1][0]), Math.max(route[j][1], route[j + 1][1])]);
    let best = { d: Infinity, p: pts[0] };
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i][0], ay = pts[i][1], bx = pts[i + 1][0], by = pts[i + 1][1];
      const gx0 = Math.min(ax, bx), gy0 = Math.min(ay, by), gx1 = Math.max(ax, bx), gy1 = Math.max(ay, by);
      for (let j = 0; j < route.length - 1; j++) {
        const q = rb[j], m = best.d;
        if (gx0 - q[2] > m || q[0] - gx1 > m || gy0 - q[3] > m || q[1] - gy1 > m) continue;
        const r = segSegDist(ax, ay, bx, by, route[j][0], route[j][1], route[j + 1][0], route[j + 1][1]);
        if (r.d < best.d) best = { d: r.d, p: r.p };
      }
    }
    const isClosed = closed && pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
    if (isClosed) {
      if (best.d === 0) return { d: 0, p: best.p, inside: true };
      const v = route.find(r => pointInRingXY(r[0], r[1], pts));   // הנתיב כולו בתוך הטבעת
      if (v) return { d: 0, p: [v[0], v[1]], inside: true };
    }
    return { d: best.d, p: best.p, inside: false };
  }
  function circlePoints(P, r, n) { // מעגל סביב מרכז ההיטל, כרשימת [lat,lon]
    n = n || 72; const out = [];
    for (let i = 0; i <= n; i++) {
      const a = (2 * Math.PI * i) / n;
      out.push(P.ll(r * Math.sin(a), r * Math.cos(a)));
    }
    out[out.length - 1] = out[0].slice();
    return out;
  }

  /* ================= אזור הפעילות: מעגל (ברירת מחדל) או נתיב =================
     מעגל: inp.lat / inp.lon / inp.radius (בלי inp.area). נתיב: inp.area = {kind:"route", pts:[[lat,lon],...2..20], halfWidth} — קו שבור שמסומן במפה לאורך הכביש, ו-halfWidth = המרחק מהקו לכל צד.
     בנתיב inp.lat/inp.lon הם נקודת עוגן על הקו (אמצע האורך): לשעות זריחה ושקיעה ולהצעת שם המקום — ו-inp.radius אינו קיים. כל החישובים שמוגדרים "מרחק מהמרכז פחות R" הופכים ל"מרחק מהקו פחות halfWidth"
     (res.R = halfWidth, והמרחק d של כל פריט הוא מציר הנתיב): כך כל מה שבנוי על d ו-R (אזורי איסור, נוטמים, מכשולים, הטבעת עד פי 2) ממשיך לעבוד בלי שינוי. אזור הסגירה לניתוח הוא "קפסולה": כל נקודה במרחק עד halfWidth מהקו. */
  const isRoute = inp => !!(inp && inp.area && inp.area.kind === "route");
  const routeLim = cfg => { const d = (cfg && cfg.defaults) || {}; return { maxPts: d.route_max_points || 20, minW: d.route_min_half_width_m || 10, maxW: d.route_max_half_width_m || 1000, maxLen: d.route_max_length_m || 25000 }; };
  function segLenM(a, b) { // אורך קטע במטרים, בהיטל מקומי סביב אמצעו (שגיאה זניחה גם בקטעים ארוכים)
    const P = new Proj((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), u = P.xy(a[0], a[1]), v = P.xy(b[0], b[1]);
    return Math.hypot(v[0] - u[0], v[1] - u[1]);
  }
  // אורך, תיבה ונקודת עוגן (אמצע האורך, 6 ספרות) של קו שבור pts = [[lat,lon],...]
  function routeInfo(pts) {
    const segs = []; let L = 0, mnLa = Infinity, mnLo = Infinity, mxLa = -Infinity, mxLo = -Infinity;
    pts.forEach((q, i) => {
      mnLa = Math.min(mnLa, q[0]); mxLa = Math.max(mxLa, q[0]); mnLo = Math.min(mnLo, q[1]); mxLo = Math.max(mxLo, q[1]);
      if (i) { const l = segLenM(pts[i - 1], q); segs.push(l); L += l; }
    });
    let anchor = pts[0].slice(), acc = 0;
    for (let i = 0; i < segs.length; i++) {
      if (acc + segs[i] >= L / 2) { const t = segs[i] ? (L / 2 - acc) / segs[i] : 0; anchor = [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]; break; }
      acc += segs[i];
    }
    return { lengthM: L, segs, bbox: [mnLa, mnLo, mxLa, mxLo], anchor: [Math.round(anchor[0] * 1e6) / 1e6, Math.round(anchor[1] * 1e6) / 1e6] };
  }
  // ההיטל לניתוח: מעגל — סביב המרכז (כמו תמיד); נתיב — סביב מרכז התיבה של הנתיב, כשהקו השבור נושא את ההיטל (P.route, במטרים) וכל מרחק נמדד ממנו (ראו Proj.dPt)
  function projFor(inp) {
    if (!isRoute(inp)) return new Proj(inp.lat, inp.lon);
    const pts = inp.area.pts, bb = routeInfo(pts).bbox, P = new Proj((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2);
    P.route = pts.map(q => P.xy(q[0], q[1]));
    return P;
  }
  const areaWidth = inp => (isRoute(inp) ? inp.area.halfWidth : inp.radius);   // R של מעגל / halfWidth של נתיב
  // נקודות הנתיב כפי שמוקלדות: עיגול ל-6 ספרות (כ-0.1 מ׳), כך שהשוואות ושמירה יציבות
  const roundPts = pts => (pts || []).map(q => [Math.round(q[0] * 1e6) / 1e6, Math.round(q[1] * 1e6) / 1e6]);
  // טבעת האזור הסביב לנתיב ברוחב mult×halfWidth מכל צד, כרשימת [lat,lon] סגורה: היסט מקביל לשני צדי הקו, פינות חדות במיטר (clip ב-2×W) וקצוות מרובעים (הקו מורחב ב-W בכל קצה) —
  // כך הטבעת תמיד מכילה את הקפסולה (כל הנקודות במרחק עד W מהקו). simple=false (טבעת לא תקינה) כשהטבעת חותכת את עצמה, או כשפינה פנימית חולפת על פני קטע קצר מדי ביחס לרוחב ואז הפוליגון חותך את האזור (פנייה חדה או קטעים קצרים) — אז אין ערובה שהטבעת מכילה את הקפסולה
  function corridorRing(area, mult) {
    const W = area.halfWidth * (mult || 1), P = projFor({ area }), r0 = P.route;
    const r = [r0[0]];
    for (let i = 1; i < r0.length; i++) if (Math.hypot(r0[i][0] - r[r.length - 1][0], r0[i][1] - r[r.length - 1][1]) >= 0.5) r.push(r0[i]);
    if (r.length < 2) return { ring: [], simple: false };
    const n = r.length, u = [], nl = [], Ls = [];
    for (let i = 0; i < n - 1; i++) { const dx = r[i + 1][0] - r[i][0], dy = r[i + 1][1] - r[i][1], L = Math.hypot(dx, dy); Ls.push(L); u.push([dx / L, dy / L]); nl.push([-dy / L, dx / L]); }
    let monotone = true;   // כל קטע של קו ההיסט נע קדימה לאורך הקטע (המקום שבו מתחיל <= המקום שבו נגמר): אחרת פינה פנימית "חולפת" על פני הקטע הקצר והפוליגון חותך את האזור (ראו הערה למעלה)
    const side = sg => {
      const out = [[r[0][0] + sg * W * nl[0][0] - W * u[0][0], r[0][1] + sg * W * nl[0][1] - W * u[0][1]]];
      const ps = new Array(n - 1).fill(0), pe = new Array(n - 1).fill(0);   // מיקום (מ׳ לאורך הקטע, מתחילתו) של תחילת קו ההיסט וסופו
      ps[0] = -W; pe[n - 2] = Ls[n - 2] + W;
      for (let i = 1; i < n - 1; i++) {
        const a = u[i - 1], b = u[i], na = [sg * nl[i - 1][0], sg * nl[i - 1][1]], nb = [sg * nl[i][0], sg * nl[i][1]], pp = r[i];
        const den = 1 + na[0] * nb[0] + na[1] * nb[1], cross = a[0] * b[1] - a[1] * b[0], outer = sg * cross < 0;
        if (den < 1e-6) { monotone = false; out.push([pp[0] + W * na[0], pp[1] + W * na[1]], [pp[0] + W * nb[0], pp[1] + W * nb[1]]); continue; }   // היפוך כיוון: קפיצה (נדחה באימות)
        const mx = (na[0] + nb[0]) / den, my = (na[1] + nb[1]) / den;
        if (!outer || Math.hypot(mx, my) <= 2) { out.push([pp[0] + W * mx, pp[1] + W * my]); pe[i - 1] = Ls[i - 1] + W * (mx * a[0] + my * a[1]); ps[i] = W * (mx * b[0] + my * b[1]); continue; }
        // צד חיצוני בפנייה חדה: חותכים את קצה הפינה במרחק 2×W מהקודקוד, לאורך הציר החוצה (שתי נקודות על שני הישרים)
        const bl = Math.hypot(na[0] + nb[0], na[1] + nb[1]), bx = (na[0] + nb[0]) / bl, by = (na[1] + nb[1]) / bl, D = 2 * W;
        const oa = [pp[0] + W * na[0], pp[1] + W * na[1]], ob = [pp[0] + W * nb[0], pp[1] + W * nb[1]];
        const sa = (D - ((oa[0] - pp[0]) * bx + (oa[1] - pp[1]) * by)) / (a[0] * bx + a[1] * by), sb = (D - ((ob[0] - pp[0]) * bx + (ob[1] - pp[1]) * by)) / (-b[0] * bx - b[1] * by);
        out.push([oa[0] + sa * a[0], oa[1] + sa * a[1]], [ob[0] - sb * b[0], ob[1] - sb * b[1]]);
        pe[i - 1] = Ls[i - 1] + sa; ps[i] = -sb;
      }
      out.push([r[n - 1][0] + sg * W * nl[n - 2][0] + W * u[n - 2][0], r[n - 1][1] + sg * W * nl[n - 2][1] + W * u[n - 2][1]]);
      for (let k = 0; k < n - 1; k++) if (ps[k] > pe[k] + 1e-6) monotone = false;
      return out;
    };
    const xy = side(1).concat(side(-1).reverse());
    return { ring: xy.map(q => P.ll(q[0], q[1])).concat([P.ll(xy[0][0], xy[0][1])]), simple: monotone && ringSimple(xy) };
  }
  function ringSimple(xy) { // אף שני קטעים לא-סמוכים בטבעת אינם נחתכים
    const n = xy.length, o = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    for (let i = 0; i < n; i++) {
      const a = xy[i], b = xy[(i + 1) % n];
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const c = xy[j], d = xy[(j + 1) % n], o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
        if (((o1 > 1e-6 && o2 < -1e-6) || (o1 < -1e-6 && o2 > 1e-6)) && ((o3 > 1e-6 && o4 < -1e-6) || (o3 < -1e-6 && o4 > 1e-6))) return false;
      }
    }
    return true;
  }
  // פנייה של כמעט 180° (מעל 170°) בין שני קטעים עוקבים: הנתיב חוזר על עצמו והטבעת שסביבו חופפת את עצמה
  function routeReverses(pts) {
    const P = new Proj(pts[0][0], pts[0][1]), xy = pts.map(q => P.xy(q[0], q[1]));
    for (let i = 1; i < xy.length - 1; i++) {
      const ax = xy[i][0] - xy[i - 1][0], ay = xy[i][1] - xy[i - 1][1], bx = xy[i + 1][0] - xy[i][0], by = xy[i + 1][1] - xy[i][1], la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      if (la > 0 && lb > 0 && (ax * bx + ay * by) / (la * lb) < -0.9848) return true;
    }
    return false;
  }
  // אימות נתיב: 2..maxPts נקודות בתחום ישראל, בלי נקודות עוקבות קרובות מדי, אורך עד maxLen, רוחב בטווח, והטבעת פשוטה. מחזיר [{field, msg}] (field: route / halfWidth)
  function validateRoute(inp, cfg) {
    const a = inp.area, lim = routeLim(cfg), errs = [], pts = Array.isArray(a.pts) ? a.pts : [];
    const push = (k, m) => errs.push({ field: k, msg: m });
    if (pts.length < 2) push("route", "נתיב דורש לפחות שתי נקודות — לחצו על המפה לאורך הכביש");
    else if (pts.length > lim.maxPts) push("route", "נתיב: עד " + lim.maxPts + " נקודות");
    else if (pts.some(q => !Array.isArray(q) || !isFinite(q[0]) || !isFinite(q[1]))) push("route", "נקודה בנתיב אינה תקינה");
    else if (pts.some(q => !(q[0] >= 29 && q[0] <= 34 && q[1] >= 34 && q[1] <= 36.5))) push("route", "נקודה בנתיב מחוץ לתחום ישראל והסביבה");
    else {
      const info = routeInfo(pts);
      if (info.segs.some(l => l < 1)) push("route", "שתי נקודות עוקבות בנתיב זהות או קרובות מדי (פחות ממטר) — יש למחוק אחת מהן");
      else if (routeReverses(pts)) push("route", "הנתיב חוזר על עצמו בפנייה של כמעט 180° — יש לפצל לשני נתיבים או להחליק את הפנייה");
      else if (info.lengthM > lim.maxLen) push("route", "אורך הנתיב " + fmtInt(Math.round(info.lengthM)) + " מ׳ — מעל המותר (עד " + fmtInt(lim.maxLen) + " מ׳)");
    }
    if (!(a.halfWidth >= lim.minW && a.halfWidth <= lim.maxW)) push("halfWidth", "מרחק מהקו לכל צד בין " + lim.minW + " ל-" + fmtInt(lim.maxW) + " מטר");
    else if (!errs.length && !corridorRing(a, 1).simple) push("route", "הנתיב חד או צפוף מדי ביחס לרוחב שנבחר (האזור סביבו נחתך בעצמו) — הגדילו את המרחק בין הנקודות, החליקו פניות חדות או הקטינו את המרחק מהקו");
    return errs;
  }
  // רשימת נקודות מטקסט (שורה לכל נקודה, או מופרדות בנקודה-פסיק): {pts, bad:[מספרי שורה (מ-1) שלא פוענחו]}
  function parseCoordList(text) {
    const pts = [], bad = [];
    String(text == null ? "" : text).split(/[\n;]/).map(x => x.trim()).forEach((ln, i) => { if (!ln) return; const c = parseCoordInput(ln); if (c) pts.push([c.lat, c.lon]); else bad.push(i + 1); });
    return { pts: roundPts(pts), bad };
  }

  /* ================= המרות ותצוגה ================= */
  function dms(v, pos, neg) {
    const h = v >= 0 ? pos : neg; v = Math.abs(v);
    let d = Math.floor(v), m = Math.floor((v - d) * 60), s = Math.round(((v - d) * 60 - m) * 60 * 100) / 100;
    if (s >= 60) { s = 0; m += 1; } if (m >= 60) { m = 0; d += 1; }
    return d + "°" + String(m).padStart(2, "0") + "'" + s.toFixed(2).padStart(5, "0") + '"' + h;
  }
  const dmsLat = v => dms(v, "N", "S"), dmsLon = v => dms(v, "E", "W");
  const fmtInt = n => Number(n).toLocaleString("en-US");
  function fmtDist(d) { return d < 1000 ? Math.round(d) + " מ׳" : (d / 1000).toFixed(1) + " ק״מ"; }
  function trimNum(n, dec) { return Number(n.toFixed(dec)).toString(); }
  const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  // ניקוי תווים שאסורים ב-XML 1.0 (תווי בקרה פרט לטאב/LF/CR, חצאי סרוגייט, U+FFFE ו-U+FFFF), אחרת הקובץ פגום ו-Word/Google Earth מסרבים לפתוח אותו.
  // נפרד מ-esc, שמשותפת גם ל-HTML ולכן אינה משנה תווים. משמש את ה-KML (ב-docx.js יש עותק, כי הוא אינו תלוי ב-core.js)
  const xmlClean = s => {
    let o = "";
    for (const ch of String(s == null ? "" : s)) {
      const c = ch.codePointAt(0);
      if (c === 9 || c === 10 || c === 13 || (c >= 0x20 && c <= 0xd7ff) || (c >= 0xe000 && c <= 0xfffd) || c >= 0x10000) o += ch;
    }
    return o;
  };

  function altText(v, unit) { // כמו pmt-layer.js
    if (v === "UNL") return "ללא הגבלה";
    if (v === "GND" || v === "SFC") return "קרקע (GND)";
    if (v === "MSL/GND") return "קרקע/פני הים";
    if (v === "MSL") return "פני הים";
    if (/^\(-\)/.test(v)) return v.replace("(-)", "מינוס ") + " רגל";
    return (/^\d+$/.test(v) ? fmtInt(v) : v) + " רגל" + (unit ? " " + unit : " מעל פני הים");
  }
  function altRange(z) { // "מהקרקע (GND) ועד 1,000 רגל מעל פני הקרקע"
    const lo = z.min === "GND" || z.min === "SFC" ? "מהקרקע (GND)" : z.min === "MSL" ? "מפני הים" : z.min === "MSL/GND" ? "מהקרקע/פני הים" : "מ־" + altText(z.min);
    return lo + " ועד " + altText(z.max, z.maxunit === "AGL" ? "מעל פני הקרקע" : "");
  }
  const ZONE_KIND = {
    LLP: "אזור אסור לטיסה (LLP)", LLR: "אזור מוגבל לטיסה (LLR)", LLD: "אזור מסוכן לטיסה (LLD)",
    LLU: "אזור אסור לטיסת כטב״ם וטיסן (LLU)", OBS: "בלון מעוגן (OBS)",
    B09: "אזור טיסה לכטב״ם (פרק ב-09)", B09B: "אזור טיסה לכטב״ם — בראשית (פרק ב-09)"
  };

  /* ================= שאילתות OpenStreetMap (משותפות לאפליקציה ולבדיקות) ================= */
  function buildQueries(lat, lon, R, cfg, area) {
    const th = (cfg && cfg.thresholds) || {};
    // מכשולים (מגדלים, חשמל, מבנים גבוהים): עד פי 2 מהרדיוס; אתרים ותשתיות קרקעיות/אוויריות: עד km מקצה הסגירה
    const siteM = th.site_near_m || 1000;
    const A = Math.ceil(2 * R + 150), B = Math.ceil(R + siteM + 50), nearR = Math.max(A, B);
    // נתיב (area = {kind:"route", pts}): Overpass מקבל ב-around גם רשימת נקודות (קו שבור) — "עד R מהקו"; lat/lon הם נקודת העוגן (למקום ולשם האתר)
    const route = !!(area && area.kind === "route"), rbb = route ? routeInfo(area.pts).bbox : null;
    const c = lat + "," + lon, pl = route ? area.pts.map(q => q[0].toFixed(6) + "," + q[1].toFixed(6)).join(",") : c;
    const a = "(around:" + A + "," + pl + ")", b = "(around:" + B + "," + pl + ")";
    const near =
      "[out:json][timeout:120];(" +
      "nwr" + a + '[man_made~"^(tower|mast|chimney|crane|water_tower|silo|storage_tank|flare|lighthouse|communications_tower|antenna|windmill)$"];' +
      "nwr" + a + '[power~"^(line|tower|substation|plant|generator)$"];' +
      "nwr" + a + "[aerialway];" +
      "nwr" + a + '[building][height~"^([2-9][0-9]|[1-9][0-9][0-9]+)"];' +
      "nwr" + a + '[building]["building:levels"~"^([6-9]|[1-9][0-9]+)$"];' +
      "nwr" + b + "[aeroway];" +
      "nwr" + b + "[emergency=helipad];" +
      "nwr" + b + "[military];" +
      "nwr" + b + "[landuse=military];" +
      "nwr" + b + '[highway~"^(motorway|trunk)$"];' +
      "nwr" + b + '[railway~"^(rail|light_rail|subway)$"];' +
      "nwr" + b + '[amenity~"^(hospital|prison|police)$"];' +
      "nwr" + b + "[leisure=stadium];" +
      "nwr" + b + "[attraction=balloon_ride];" +
      "nwr" + b + '[man_made~"^(tethered_balloon|balloon)$"];' +
      "nwr" + b + '[tourism=attraction][name~"בלון|balloon",i];' +
      "nwr" + b + "[sport=shooting];" +
      "nwr" + b + "[leisure=shooting_ground];" +
      // מצאי רחב: אתרי המונים, תשתיות ותעשייה, כבישים ראשיים, קווי חשמל משניים, תחנות — כדי לא לפספס
      "nwr" + b + '[tourism~"^(attraction|theme_park|zoo|aquarium)$"];' +
      "nwr" + b + '[attraction~"^(amusement_ride|water_slide|roller_coaster|big_wheel|drop_tower|carousel|bungee_jumping|zip_line)$"];' +
      "nwr" + b + '[amenity~"^(theatre|events_venue|conference_centre|exhibition_centre|fire_station)$"];' +
      "nwr" + b + '[leisure~"^(water_park|golf_course|racetrack|marina)$"];' +
      "nwr" + b + '[landuse~"^(industrial|quarry|landfill|port)$"];' +
      "nwr" + b + '[man_made~"^(bridge|pier|works|wastewater_plant|water_works|gasometer|cooling_tower|telescope|radar|observatory|petroleum_well|dam|breakwater)$"];' +
      "nwr" + b + "[waterway=dam];" +
      "nwr" + b + '[power=minor_line];' +
      "nwr" + b + "[highway=primary];" +
      "nwr" + b + '[railway~"^(station|halt)$"];' +
      ");out geom tags;";
    const farR = th.airfield_scan_m || 15000, placeR = th.place_scan_m || 3000;
    const box = km => { const dLa = km / 111000, dLo = km / (111000 * Math.cos((lat * Math.PI) / 180)); return (route ? [rbb[0] - dLa, rbb[1] - dLo, rbb[2] + dLa, rbb[3] + dLo] : [lat - dLa, lon - dLo, lat + dLa, lon + dLo]).map(v => v.toFixed(5)).join(","); };
    // תיבה במקום around: מהיר בהרבה בשרתים העמוסים; המרחק המדויק מחושב בדפדפן
    const far =
      "[out:json][timeout:90];" +
      'nwr[aeroway~"^(aerodrome|heliport|helipad)$"](' + box(farR) + ");out center tags;" +
      "is_in(" + c + ");out tags;" +
      "node[place](" + box(placeR) + ");out body;";
    const bR = Math.max(th.border_scan_m || 7000, R + 7000), pR = Math.ceil(2 * R + (th.near_zone_m || 1000));
    const dLat = bR / 111000, dLon = bR / (111000 * Math.cos((lat * Math.PI) / 180));
    const bbox = (route ? [rbb[0] - dLat, rbb[1] - dLon, rbb[2] + dLat, rbb[3] + dLon] : [lat - dLat, lon - dLon, lat + dLat, lon + dLon]).map(v => v.toFixed(5)).join(",");
    const ext =
      "[out:json][timeout:90];(" +
      "nwr(around:" + pR + "," + pl + ")[leisure=nature_reserve];" +
      "nwr(around:" + pR + "," + pl + ")[boundary=national_park];" +
      "nwr(around:" + pR + "," + pl + ")[boundary=protected_area];" +
      ");out center tags;" +
      "rel(around:" + bR + "," + pl + ')["boundary"="administrative"]["admin_level"="2"]["ISO3166-1"~"^(IL|EG|SY|LB)$"]->.cr;' +
      "way(r.cr)(around:" + bR + "," + pl + ")->.bw;" +
      ".bw out geom(" + bbox + ") tags;" +
      ".cr out body;";
    return { near, far, ext, nearR };
  }

  const MIRRORS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.openstreetmap.fr/api/interpreter", "https://lz4.overpass-api.de/api/interpreter", "https://z.overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
  // שולח את השאילתה לשרת הראשון, ואם לא ענה תוך staggerMs (או נכשל) מוסיף עוד שרת במקביל; התשובה התקינה הראשונה מנצחת.
  // fetchFn: fetch או מימוש תואם. מחזיר {data, mirror}; זורק שגיאה אם כל השרתים נכשלו בכל הסבבים.
  async function overpass(query, opts) {
    opts = opts || {};
    const f = opts.fetch || fetch, mirrors = opts.mirrors || MIRRORS, rounds = opts.rounds || 2;
    const stagger = opts.staggerMs == null ? 8000 : opts.staggerMs, timeoutMs = opts.timeoutMs || 95000;
    const wait = opts.wait || (ms => new Promise(r => setTimeout(r, ms)));
    const log = opts.log || (() => {});
    let lastErr = "";
    for (let round = 0; round < rounds; round++) {
      const ctls = [];
      const one = async (m) => {
        const ctl = typeof AbortController !== "undefined" ? new AbortController() : null; if (ctl) ctls.push(ctl);
        const tm = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
        try {
          const r = await f(m, { method: "POST", body: "data=" + encodeURIComponent(query), headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: ctl ? ctl.signal : undefined });
          if (!r.ok) throw new Error("HTTP " + r.status);
          const d = await r.json();
          if (!d || !Array.isArray(d.elements)) throw new Error("תשובה בלי elements");
          if (d.remark && /error|timed out|out of memory/i.test(d.remark)) throw new Error("Overpass: " + d.remark);
          const ts = d.osm3s && d.osm3s.timestamp_osm_base; // שרת מראה שהנתונים בו ישנים — לא משתמשים בו
          if (opts.maxAgeH && ts && Date.now() - Date.parse(ts) > opts.maxAgeH * 3600000) throw new Error("נתוני OSM בשרת ישנים (" + ts + ")");
          return { data: d, mirror: m };
        } catch (e) {
          lastErr = m + ": " + (e && e.message ? e.message : e); log("נכשל — " + lastErr);
          throw e;
        } finally { if (tm) clearTimeout(tm); }
      };
      const winner = await new Promise(resolve => {
        let pending = 0, started = 0, done = false;
        const startNext = () => {
          if (done || started >= mirrors.length) return;
          const m = mirrors[started++]; pending++;
          one(m).then(v => { if (!done) { done = true; resolve(v); } }, () => { pending--; if (!done) { if (started < mirrors.length) startNext(); else if (pending === 0) { done = true; resolve(null); } } });
          if (started < mirrors.length) setTimeout(() => { if (!done) startNext(); }, stagger);
        };
        startNext();
      });
      ctls.forEach(c => { try { c.abort(); } catch (e) { /* כבר הסתיים */ } });
      if (winner) return winner;
      await wait(4000 * (round + 1));
    }
    throw new Error("כל שרתי Overpass נכשלו. אחרון: " + lastErr);
  }

  /* ================= ניתוח אלמנטים של OSM ================= */
  function elemGeoms(e) { // רשימת {pts:[[lat,lon]...], closed} או {pt:[lat,lon]}
    const out = [];
    // out geom(bbox) מחזיר null לצמתים שמחוץ לתיבה — מפצלים לרצפים רציפים כדי לא ליצור קטעים מדומים
    const addLine = g => {
      let run = [];
      const flush = () => { if (run.length) { out.push({ pts: run, closed: false }); run = []; } };
      if (g.some(p => !p)) { g.forEach(p => { if (p) run.push([p.lat, p.lon]); else flush(); }); flush(); return; }
      const pts = g.map(p => [p.lat, p.lon]);
      out.push({ pts, closed: pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1] });
    };
    if (e.type === "node") { if (e.lat != null) out.push({ pt: [e.lat, e.lon] }); }
    else if (e.type === "way" && e.geometry) addLine(e.geometry);
    else if (e.type === "relation") {
      (e.members || []).forEach(m => {
        if (m.geometry) addLine(m.geometry);
        else if (m.lat != null) out.push({ pt: [m.lat, m.lon] });
      });
    }
    if (!out.length && e.center) out.push({ pt: [e.center.lat, e.center.lon] });
    return out;
  }
  function geomDist(P, g) {
    if (g.pt) { const xy = P.xy(g.pt[0], g.pt[1]); return { d: P.dPt(xy[0], xy[1]), p: xy, inside: false }; }
    return polyNearest(g.pts.map(p => P.xy(p[0], p[1])), g.closed, P.route);
  }
  function elemDist(P, e) { // מחזיר {d, p:[x,y]} או null
    let best = null;
    elemGeoms(e).forEach(g => { const r = geomDist(P, g); if (!best || r.d < best.d) best = r; });
    return best;
  }

  function nameOf(t) { return t["name:he"] || t.name || t["name:en"] || ""; }
  const isBalloon = t => t.attraction === "balloon_ride" || /^(tethered_balloon|balloon)$/.test(t.man_made || "") || (t.tourism === "attraction" && /בלון|balloon/i.test((t.name || "") + " " + (t["name:en"] || "")));
  const OBST_MM = /^(tower|mast|chimney|crane|water_tower|silo|storage_tank|flare|lighthouse|communications_tower|antenna|windmill)$/;
  const OBST_PW = /^(line|tower|substation|plant|generator)$/;
  const tallBuilding = t => { const h = parseFloat(t.height), lv = parseInt(t["building:levels"], 10); return (isFinite(h) && h >= 20) || (isFinite(lv) && lv >= 6); };
  // קטגוריה: obst = מכשול (עד 2R) · air/ground = אוויר/קרקע (עד R+km) · census = מצאי רחב (בתוך/טבעת — בטופס; רחוק יותר — בדף הבדיקות)
  function classify(t) {
    if (t["icd:manual"]) return "obst";
    if (isBalloon(t)) return "air";
    if (t.aeroway || t.emergency === "helipad") return "air";
    if (t.sport === "shooting" || t.leisure === "shooting_ground") return "ground";
    if (OBST_MM.test(t.man_made || "") || OBST_PW.test(t.power || "") || "aerialway" in t) return "obst";
    if (t.building) return tallBuilding(t) ? "obst" : "census";
    if (/^(motorway|trunk)$/.test(t.highway || "") || /^(rail|light_rail|subway)$/.test(t.railway || "")) return "ground";
    if (/^(hospital|prison|police)$/.test(t.amenity || "") || t.leisure === "stadium" || t.military || t.landuse === "military") return "ground";
    return "census";
  }
  // קבוצת כיסוי (לדוח "מצאי מלא")
  function groupOf(t) {
    if (t["icd:manual"]) return "הוזן ידנית";
    if (isBalloon(t) || t.aeroway || t.emergency === "helipad") return "שדות תעופה, מנחתים ובלונים";
    if (OBST_MM.test(t.man_made || "")) return "מגדלים, תרנים, ארובות ועגורנים";
    if (t.power) return "קווי חשמל ותחנות";
    if ("aerialway" in t) return "רכבלים";
    if (t.building && tallBuilding(t)) return "מבנים גבוהים";
    if (t.sport === "shooting" || t.leisure === "stadium" || t.leisure === "shooting_ground" || t.tourism || t.attraction || /^(theatre|events_venue|conference_centre|exhibition_centre)$/.test(t.amenity || "") || /^(water_park|golf_course|racetrack|marina)$/.test(t.leisure || "")) return "אצטדיונים, מטווחים ואתרי המונים";
    if (t.military || t.landuse === "military") return "אזורים צבאיים";
    if (t.highway || t.railway) return "כבישים ומסילות";
    if (/^(hospital|prison|police|fire_station)$/.test(t.amenity || "")) return "מוסדות (בתי חולים, סוהר, משטרה, כיבוי)";
    return "תעשייה ותשתיות";
  }
  const COVERAGE_GROUPS = ["מגדלים, תרנים, ארובות ועגורנים", "קווי חשמל ותחנות", "מבנים גבוהים", "רכבלים", "שדות תעופה, מנחתים ובלונים", "אצטדיונים, מטווחים ואתרי המונים", "אזורים צבאיים", "כבישים ומסילות", "מוסדות (בתי חולים, סוהר, משטרה, כיבוי)", "תעשייה ותשתיות", "הוזן ידנית"];
  const ATTR_HE = { amusement_ride: "מתקן שעשועים", water_slide: "מגלשת מים", roller_coaster: "רכבת הרים", big_wheel: "גלגל ענק", drop_tower: "מגדל נפילה", carousel: "קרוסלה", bungee_jumping: "באנג׳י", zip_line: "קו אוויר (זיפליין)" };
  function heLabel(t) {
    if (isBalloon(t)) return "בלון (אטרקציית בלון / בלון מעוגן)";
    if (t["icd:manual"]) return "מכשול/תשתית (הוזן ידנית)";
    if (t.sport === "shooting" || t.leisure === "shooting_ground") return "מטווח ירי";
    const mm = t.man_made, pw = t.power;
    if (pw === "line") { const v = parseInt(String(t.voltage || "").split(";")[0], 10); return v ? "קו מתח " + (v >= 100000 ? "עליון " : v >= 33000 ? "גבוה " : "") + Math.round(v / 1000) + " ק״ו" : "קו חשמל"; }
    if (pw === "minor_line") return "קו חשמל (מתח נמוך/בינוני)";
    if (pw === "tower") return "עמוד חשמל" + (t.ref ? " " + t.ref : "");
    if (pw === "substation") return "תחנת משנה";
    if (pw === "plant" || pw === "generator") return "תחנת כוח";
    if (mm === "tower") return { communication: "מגדל תקשורת", observation: "מגדל תצפית" }[t["tower:type"]] || "מגדל";
    if (mm === "mast" || mm === "communications_tower" || mm === "antenna") return "תורן";
    if (mm) return { storage_tank: "מיכל אחסון", chimney: "ארובה", crane: "עגורן", water_tower: "מגדל מים", silo: "ממגורה", flare: "לפיד", lighthouse: "מגדלור", windmill: "טורבינת רוח", bridge: "גשר", pier: "מזח", works: "מפעל", wastewater_plant: "מתקן טיהור שפכים", water_works: "מתקן מים", gasometer: "גזומטר", cooling_tower: "מגדל קירור", telescope: "טלסקופ", radar: "מכ״ם", observatory: "מצפה", petroleum_well: "באר נפט", dam: "סכר", breakwater: "שובר גלים", pumping_station: "תחנת שאיבה" }[mm] || "מבנה (" + mm + ")";
    if ("aerialway" in t) return "רכבל";
    if (t.aeroway === "helipad" || t.emergency === "helipad") return "מנחת מסוקים";
    if (t.aeroway === "aerodrome") return "שדה תעופה";
    if (t.aeroway === "heliport") return "מנחת מסוקים";
    if (t.aeroway) return "תשתית שדה תעופה";
    if (t.military || t.landuse === "military") return "אזור צבאי";
    if (t.highway === "motorway" || t.highway === "trunk") return "כביש מהיר/ראשי";
    if (t.railway) return "מסילת ברזל";
    if (t.amenity === "hospital") return "בית חולים";
    if (t.amenity === "prison") return "בית סוהר";
    if (t.amenity === "police") return "משטרה";
    if (t.leisure === "stadium") return "אצטדיון";
    if (t.attraction && ATTR_HE[t.attraction]) return ATTR_HE[t.attraction];
    if (t.tourism === "theme_park") return "פארק שעשועים";
    if (t.tourism === "zoo") return "גן חיות";
    if (t.tourism === "aquarium") return "אקווריום";
    if (t.tourism === "attraction") return "אטרקציה";
    if (t.amenity === "theatre") return "תיאטרון/אמפיתיאטרון";
    if (t.amenity === "events_venue") return "אולם אירועים";
    if (t.amenity === "conference_centre" || t.amenity === "exhibition_centre") return "מרכז כנסים/תערוכות";
    if (t.amenity === "fire_station") return "תחנת כיבוי";
    if (t.leisure === "water_park") return "פארק מים";
    if (t.leisure === "golf_course") return "מגרש גולף";
    if (t.leisure === "racetrack") return "מסלול מרוצים";
    if (t.leisure === "marina") return "מרינה";
    if (t.landuse === "industrial") return "אזור תעשייה";
    if (t.landuse === "quarry") return "מחצבה";
    if (t.landuse === "landfill") return "אתר פסולת";
    if (t.landuse === "port") return "נמל";
    if (t.waterway === "dam") return "סכר";
    if (t.highway === "primary") return "כביש ראשי";
    if (t.railway === "station" || t.railway === "halt") return "תחנת רכבת";
    if (t.building) {
      const h = parseFloat(t.height);
      return "מבנה גבוה" + (isFinite(h) ? " (" + trimNum(h, 0) + " מ׳)" : t["building:levels"] ? " (" + t["building:levels"] + " קומות)" : "");
    }
    return "אחר";
  }
  function groupKey(e, t, label, cat) {
    // קטעים של אותו קו/כביש/מסילה מאוחדים לפריט אחד; מצאי רחב: לפי סוג ושם; כל השאר — פריט לכל אלמנט
    if (t.power === "line" || t.power === "minor_line" || t.railway || t.highway) return label + "|" + (t.ref || t.name || t["name:he"] || t.operator || "");
    if (cat === "census") return label + "|" + (t.name || t["name:he"] || "");
    return e.type + "/" + e.id;
  }

  // near: תשובת Overpass של שאילתת הקרוב (+ פריטים שהוזנו ידנית). מכשולים עד 2R; אתרים ותשתיות עד R+site_near_m.
  // פריטי מצאי רחב ("census") בתוך האזור/הטבעת נכנסים לטופס; רחוקים יותר — רק לדף הבדיקות ("censusOnly").
  function analyzeNear(P, R, near, th) {
    const siteM = (th && th.site_near_m) || 1000;
    const groups = new Map();
    (near.elements || []).forEach(e => {
      const r = elemDist(P, e); if (!r) return;
      const t = e.tags || {}, cat = classify(t);
      if (!t["icd:manual"] && r.d > (cat === "obst" ? 2 * R : R + siteM)) return;
      const label = heLabel(t), key = groupKey(e, t, label, cat);
      let g = groups.get(key);
      if (!g) { g = { key, label, name: nameOf(t), cat, grp: groupOf(t), d: r.d, p: r.p, tags: t, ids: [], geoms: [] }; groups.set(key, g); }
      if (r.d < g.d) { g.d = r.d; g.p = r.p; }
      g.ids.push(e.type + "/" + e.id);
      elemGeoms(e).forEach(gm => g.geoms.push(gm));
    });
    const all = [...groups.values()].sort((a, b) => a.d - b.d);
    all.forEach(it => {
      it.zone = it.d <= R ? "in" : it.d <= 2 * R ? "ring" : "near";
      it.count = it.ids.length;
      it.manual = !!it.tags["icd:manual"];
      it.title = it.label + (it.name && it.label.indexOf(it.name) < 0 ? " ״" + it.name + "״" : "") + (it.cat === "census" && it.count > 1 ? " (×" + it.count + ", הקרוב)" : "");
      const ht = parseFloat(it.tags.height);
      if (isFinite(ht) && it.label.indexOf("מ׳") < 0) it.height = ht;
      it.ll = P.ll(it.p[0], it.p[1]);
    });
    const items = all.filter(i => i.cat !== "census" || i.zone !== "near");
    items.forEach((it, i) => { it.n = i + 1; });
    return { items, all, inside: items.filter(i => i.zone === "in"), ring: items.filter(i => i.zone === "ring"), near: items.filter(i => i.zone === "near"), censusOnly: all.filter(i => i.cat === "census" && i.zone === "near") };
  }
  // פריט שהוזן ידנית -> אלמנט OSM סינתטי
  function manualElements(list) {
    return (list || []).filter(m => isFinite(m.lat) && isFinite(m.lon) && (m.name || "").trim()).map((m, i) => ({ type: "node", id: -(i + 1), lat: m.lat, lon: m.lon, tags: Object.assign({ "icd:manual": "yes", name: m.name.trim() }, isFinite(m.heightM) && m.heightM > 0 ? { height: String(m.heightM) } : {}) }));
  }

  /* ================= אזורי א-17 ורט״ג ================= */
  function zoneDistance(P, z) {
    let best = null;
    if (z.rings && z.rings.length) {
      z.rings.forEach(rg => {
        const r = polyNearest(rg.map(p => P.xy(p[0], p[1])), true, P.route);
        if (!best || r.d < best.d) best = r;
      });
    }
    if (z.c && z.r && P.route) {   // נתיב: מרחק מרכז העיגול מהקו השבור פחות רדיוס העיגול; הנקודה הקרובה — על שפת העיגול, בכיוון הציר
      const c = P.xy(z.c[0], z.c[1]), q = routeNearest(P.route, c[0], c[1]), dc = q.d, d = Math.max(0, dc - z.r);
      const p = d > 0 ? [c[0] + ((q.x - c[0]) * z.r) / dc, c[1] + ((q.y - c[1]) * z.r) / dc] : [q.x, q.y];
      if (!best || d < best.d) best = { d, p, inside: d === 0 };
    } else if (z.c && z.r) {
      const c = P.xy(z.c[0], z.c[1]), dc = Math.hypot(c[0], c[1]), d = Math.max(0, dc - z.r);
      const p = dc ? [(c[0] * d) / dc, (c[1] * d) / dc] : [0, 0];
      if (!best || d < best.d) best = { d, p, inside: d === 0 };
    }
    return best;
  }
  // מחזיר {inside:[...], near:[...]} — לפי קצה הסגירה המבוקשת (R) ועוד near_zone_m
  // approxM: שוליים נוספים לאזורים שנשרטטו בקירוב (approx) — הגבול שלהם אינו הרשמי, ולכן מתייחסים אליהם בזהירות גם כשהם מעט רחוקים יותר
  function analyzeZones(P, R, data, nearM, topFt, approxM) {
    const out = { inside: [], near: [], excluded: [] };
    const push = (z, src, kindLabel, altTxt) => {
      const r = zoneDistance(P, z); if (!r) return;
      // אזור ב-09 שגובהו המזערי (מעפ"י) גבוה מהסגירה בלי תלות בגובה הקרקע בישראל — אין חפיפה אנכית (אותו כלל כמו בנוטמים)
      const reach = R + nearM + (z.approx ? approxM || 0 : 0);
      if (src === "b09" && topFt != null && z.minFt >= topFt + TERRAIN_MAX_FT && r.d <= reach) { out.excluded.push({ id: z.id, minFt: z.minFt, d: r.d }); return; }
      if (r.d > reach) return;
      const rec = { id: z.id, name: z.name, cat: z.cat || src, src, kind: kindLabel, d: r.d, edge: Math.max(0, r.d - R), p: r.p, ll: P.ll(r.p[0], r.p[1]), alt: altTxt, note: z.note || "", approx: !!z.approx, pmt: z.pmt || "", pmtRef: z.pmtRef || "", coord: z.coord || "", needGroundFt: (src === "b09" && z.minFt > 0 && topFt != null) ? Math.max(0, Math.round(z.minFt - topFt)) : 0, label: (z.cat === "B09" || z.cat === "B09B") ? z.id : (z.name ? z.id + " ״" + z.name + "״" : z.id), z };   // אזור בלי שם (LLR107/120/601) — בלי גרשיים ריקות; אותו כלל ב-maplayers.js
      (r.d <= R ? out.inside : out.near).push(rec);
    };
    (data.zones || []).forEach(z => {
      const b09 = z.cat === "B09" || z.cat === "B09B";   // אזורי טיסה לכטב״ם מפרק ב-09 — אינם איסור, ומוצגים בנפרד מא-17
      push(z, b09 ? "b09" : "a17", b09 ? ZONE_KIND[z.cat].replace("(פרק ב-09)", "(פרק ב-09, " + (z.appendix || "") + ")").replace(", )", ")") : (ZONE_KIND[z.cat] || z.cat), z.alt || (z.min != null ? altRange(z) : ""));
    });
    ((data.inpa && data.inpa.sites) || []).forEach(s =>
      push({ id: s.id, name: s.name, cat: s.kind === "P" ? "NP" : "NR", rings: s.rings, note: s.note, max: s.max }, "inpa", s.kind === "P" ? "גן לאומי (רט״ג)" : "שמורת טבע (רט״ג)",
        "סגור להטסה מהקרקע ועד " + fmtInt(s.max) + " רגל מעפ״ש"));
    out.inside.sort((a, b) => a.d - b.d); out.near.sort((a, b) => a.d - b.d);
    return out;
  }

  /* ================= מנחתים חקלאיים ושדות תעופה ================= */
  function analyzeAgri(P, airstrips) {
    return (airstrips || []).map(a => ({ name: a.name, d: P.dPt(...P.xy(a.lat, a.lon)), ops: a.ops, arp: a.arp }))
      .sort((a, b) => a.d - b.d);
  }
  function analyzeAirfields(P, far, scanM) {
    const out = [];
    (far.elements || []).forEach(e => {
      const t = e.tags || {};
      if (!t.aeroway || !/^(aerodrome|heliport|helipad)$/.test(t.aeroway)) return;
      const r = elemDist(P, e); if (!r || r.d > scanM) return;
      out.push({ d: r.d, type: t.aeroway, name: nameOf(t) || t.icao || "", icao: t.icao || "", inactive: !!(t.disused || t.abandoned), id: e.type + "/" + e.id });
    });
    return out.sort((a, b) => a.d - b.d);
  }

  /* ================= שם המקום (ישוב / אתר) ================= */
  function suggestSiteName(far, reverse) {
    const areas = (far.elements || []).filter(e => e.type === "area" && e.tags);
    const AT = e => e.tags;
    const spot = areas.find(e => AT(e).name && (AT(e).leisure && /^(park|nature_reserve|garden|stadium|sports_centre|golf_course)$/.test(AT(e).leisure)))
      || areas.find(e => AT(e).name && AT(e).natural && /^(beach|wood)$/.test(AT(e).natural));
    let city = null, lv = 0;
    areas.forEach(e => {
      const t = AT(e), l = parseInt(t.admin_level, 10);
      if (t.boundary === "administrative" && t.name && l >= 6 && l <= 8 && l > lv) { city = t["name:he"] || t.name; lv = l; }
    });
    const parts = [];
    if (spot) parts.push(AT(spot)["name:he"] || AT(spot).name);
    if (city) parts.push(city);
    if (!parts.length && reverse && reverse.address) {
      const a = reverse.address;
      [a.neighbourhood || a.suburb, a.city || a.town || a.village || a.municipality || a.hamlet].forEach(x => { if (x && parts.indexOf(x) < 0) parts.push(x); });
    }
    if (!parts.length) {
      const pl = (far.elements || []).filter(e => e.type === "node" && e.tags && e.tags.place && e.lat != null);
      if (pl.length) parts.push(nameOf(pl[0].tags));
    }
    return parts.join(", ");
  }
  function nearestPlaces(P, far, n) {
    return (far.elements || []).filter(e => e.type === "node" && e.tags && e.tags.place && e.lat != null)
      .map(e => ({ d: P.dPt(...P.xy(e.lat, e.lon)), place: e.tags.place, name: nameOf(e.tags) }))
      .sort((a, b) => a.d - b.d).slice(0, n || 5);
  }

  /* ================= גבולות מדינה ================= */
  // ext: תשובת Overpass עם יחסי המדינות (IL/EG/SY/LB, כולל רשימת חברים) והקטעים הקרובים של הגבולות (עם גיאומטריה).
  // גבול ישראל–X = קטע ששייך ליחס של X וגם ליחס של ישראל (או ששמו מכיל Israel/ישראל כשאין שיוך ליחס).
  const NAME_ISO = [[/Lebanon|לבנון|لبنان/i, "LB"], [/Syria|סוריה|سوريا/i, "SY"], [/Egypt|מצרים|مصر/i, "EG"]];
  function analyzeBorders(P, ext, cfg, R) {
    const els = ext.elements || [], wayCountry = new Map();
    els.filter(e => e.type === "relation" && e.tags && (e.tags["ISO3166-1"] || e.tags["ISO3166-1:alpha2"])).forEach(r => {
      const iso = r.tags["ISO3166-1"] || r.tags["ISO3166-1:alpha2"];
      (r.members || []).forEach(m => { if (m.type === "way") { const s = wayCountry.get(m.ref) || new Set(); s.add(iso); wayCountry.set(m.ref, s); } });
    });
    const byIso = {};
    els.filter(e => e.type === "way" && e.geometry && !(e.tags && e.tags.maritime === "yes")).forEach(w => {
      const t = w.tags || {}, nm = (t["name:en"] || "") + " " + (t.name || "");
      const set = new Set(wayCountry.get(w.id) || []);
      NAME_ISO.forEach(([rx, iso]) => { if (!set.size && rx.test(nm)) set.add(iso); });
      const israel = set.has("IL") || /Israel|ישראל/.test(nm);
      if (!israel) return;
      const d = elemDist(P, w); if (!d) return;
      set.forEach(iso => { const rule = cfg.borders && cfg.borders[iso]; if (rule && (!byIso[iso] || d.d < byIso[iso].d)) byIso[iso] = { iso, name: rule.name, km: rule.km, d: d.d }; });
    });
    const list = Object.values(byIso).sort((a, b) => a.d - b.d);
    // בתוך רצועת האיסור: קצה הסגירה המבוקשת (R) חודר לרצועה של km ק״מ מהגבול
    list.forEach(b => { b.violates = b.d - R < b.km * 1000; });
    return list;
  }

  /* ================= שקיעה / יום ולילה ================= */
  function sunTimes(y, m, d, lat, lon, zenith) { // NOAA; מחזיר {rise, set} כ-Date (UTC)
    const jd = Date.UTC(y, m - 1, d) / 86400000 + 2440587.5 + 0.5, T = (jd - 2451545.0) / 36525.0, r = Math.PI / 180, deg = 180 / Math.PI;
    const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
    const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    const C = Math.sin(r * M) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * r * M) * (0.019993 - 0.000101 * T) + Math.sin(3 * r * M) * 0.000289;
    const tl = L0 + C, om = 125.04 - 1934.136 * T, lam = tl - 0.00569 - 0.00478 * Math.sin(r * om);
    const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60, eps = eps0 + 0.00256 * Math.cos(r * om);
    const dec = Math.asin(Math.sin(r * eps) * Math.sin(r * lam)), yy = Math.tan(r * eps / 2) ** 2;
    const eot = 4 * deg * (yy * Math.sin(2 * r * L0) - 2 * e * Math.sin(r * M) + 4 * e * yy * Math.sin(r * M) * Math.cos(2 * r * L0) - 0.5 * yy * yy * Math.sin(4 * r * L0) - 1.25 * e * e * Math.sin(2 * r * M));
    const ha = deg * Math.acos(Math.cos(r * zenith) / (Math.cos(r * lat) * Math.cos(dec)) - Math.tan(r * lat) * Math.tan(dec));
    const noon = 720 - 4 * lon - eot, base = Date.UTC(y, m - 1, d);
    return { rise: new Date(base + (noon - 4 * ha) * 60000), set: new Date(base + (noon + 4 * ha) * 60000) };
  }
  let tzFmt = null;   // מפיק אחד לשימוש חוזר: בנייה של Intl.DateTimeFormat בכל קריאה היא החלק היקר ב-localToUtc (ועוד פעמים רבות בטבלת יום/לילה)
  const tzParts = (ms) => {
    const f = tzFmt || (tzFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    const o = {}; f.formatToParts(new Date(ms)).forEach(p => { o[p.type] = p.value; });
    return o;
  };
  function localToUtc(y, m, d, hh, mm) { // שעה מקומית ישראל -> Date (UTC)
    const guess = Date.UTC(y, m - 1, d, hh, mm);
    for (let k = 0; k < 2; k++) {
      const o = tzParts(guess), asUtc = Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour, +o.minute, +o.second);
      const off = asUtc - Math.floor(guess / 1000) * 1000;
      const t = guess - off;
      const o2 = tzParts(t);
      if (+o2.hour === hh && +o2.minute === mm && +o2.day === d) return new Date(t);
    }
    const o = tzParts(guess), asUtc = Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour, +o.minute, +o.second);
    return new Date(guess - (asUtc - guess));
  }
  function ilToday(now) { const o = tzParts(now.getTime()); return o.year + "-" + o.month + "-" + o.day; }
  const hhmm = ms => { const o = tzParts(ms); return o.hour + ":" + o.minute; };
  function parseDate(s) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; }
  function parseTime(s) { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ""); return m ? { h: +m[1], mi: +m[2] } : null; }
  function dayName(dt) { return HEB_DAY[new Date(Date.UTC(dt.y, dt.m - 1, dt.d)).getUTCDay()]; }
  const ddmmyyyy = dt => String(dt.d).padStart(2, "0") + "." + String(dt.m).padStart(2, "0") + "." + dt.y;

  // מחזיר שורות: לכל תאריך — חלון, שקיעה, דקות יום, דקות לילה
  function dayNightTable(lat, lon, from, to, tFrom, tTo) {
    const rows = [], a = parseDate(from), b = parseDate(to), t0 = parseTime(tFrom), t1 = parseTime(tTo);
    if (!a || !b || !t0 || !t1) return rows;
    let cur = Date.UTC(a.y, a.m - 1, a.d); const end = Date.UTC(b.y, b.m - 1, b.d);
    for (let guard = 0; cur <= end && guard < 400; guard++, cur += 86400000) {
      const c = new Date(cur), dt = { y: c.getUTCFullYear(), m: c.getUTCMonth() + 1, d: c.getUTCDate() };
      const s = localToUtc(dt.y, dt.m, dt.d, t0.h, t0.mi);
      let e = localToUtc(dt.y, dt.m, dt.d, t1.h, t1.mi);
      if (e <= s) e = new Date(localToUtc(dt.y, dt.m, dt.d + 1, t1.h, t1.mi)); // חלון שחוצה חצות
      const sun = sunTimes(dt.y, dt.m, dt.d, lat, lon, 90.833);
      const ov = (x0, x1, y0, y1) => Math.max(0, Math.min(x1, y1) - Math.max(x0, y0));
      const total = (e - s) / 60000, day = ov(+s, +e, +sun.rise, +sun.set) / 60000;
      rows.push({ date: dt, dayName: dayName(dt), start: hhmm(+s), end: hhmm(+e), sunrise: hhmm(+sun.rise), sunset: hhmm(+sun.set), dayMin: Math.round(day), nightMin: Math.round(total - day), startUtc: s, endUtc: e });
    }
    return rows;
  }
  const fmtHM = m => Math.floor(m / 60) + ":" + String(m % 60).padStart(2, "0");

  // ימי עבודה (א׳–ה׳, בלי חגים) בין תאריך ההגשה לתאריך הפעילות, לא כולל שניהם
  function workingDaysBefore(todayYmd, startYmd) {
    const a = parseDate(todayYmd), b = parseDate(startYmd); if (!a || !b) return null;
    let n = 0, t = Date.UTC(a.y, a.m - 1, a.d) + 86400000; const end = Date.UTC(b.y, b.m - 1, b.d);
    for (; t < end; t += 86400000) { const wd = new Date(t).getUTCDay(); if (wd >= 0 && wd <= 4) n++; }
    return n;
  }

  /* ================= נוטמים ================= */
  const dmsNum = (d, m, s) => +d + +m / 60 + +s / 3600;
  function notamCoords(text) {
    const out = []; let re = /(\d{2})(\d{2})(\d{2}(?:\.\d+)?)N\s?0?(\d{2})(\d{2})(\d{2}(?:\.\d+)?)E/g, m;
    while ((m = re.exec(text)) !== null) out.push({ lat: dmsNum(m[1], m[2], m[3]), lon: dmsNum(m[4], m[5], m[6]), idx: m.index });
    return out;
  }
  function notamRadiusM(text) {
    const m = /([\d.]+)\s*(NM|KM|M)\s+RADIUS/i.exec(text); if (!m) return null;
    const v = parseFloat(m[1]), u = m[2].toUpperCase();
    return u === "NM" ? v * NM : u === "KM" ? v * 1000 : v;
  }
  function notamWindow(raw) {
    const b = /B\)\s*(\d{10})/.exec(raw), c = /C\)\s*(\d{10}|PERM)/.exec(raw); if (!b || !c) return null;
    const t = s => Date.UTC(2000 + +s.slice(0, 2), +s.slice(2, 4) - 1, +s.slice(4, 6), +s.slice(6, 8), +s.slice(8, 10));
    return { from: t(b[1]), to: c[1] === "PERM" ? Infinity : t(c[1]) };
  }
  // גיאומטריה של נוטם -> {kind:"circle", c:[lat,lon], r} | {kind:"polygon", pts} | null
  function notamGeometry(raw) {
    const text = raw.toUpperCase();
    const eM = /E\)\s*([\s\S]*?)(?=\n[FG]\)|$)/.exec(text), eText = eM ? eM[1] : text;
    const coords = notamCoords(eText), rad = notamRadiusM(eText);
    const centered = /CENT(?:E?)RED\s+ON/.test(eText);
    if (rad && coords.length >= 1 && (centered || coords.length < 3)) {
      let c = coords[0]; const ci = eText.search(/CENT(?:E?)RED\s+ON/);
      if (ci >= 0) { let bd = 1e9; coords.forEach(k => { if (k.idx > ci && k.idx - ci < bd) { bd = k.idx - ci; c = k; } }); }
      return { kind: "circle", c: [c.lat, c.lon], r: rad, src: "E" };
    }
    if (coords.length >= 3) return { kind: "polygon", pts: coords.map(k => [k.lat, k.lon]), src: "E" };
    const q = /Q\)[^\n]*?(\d{2})(\d{2})([NS])(\d{3})(\d{2})([EW])(\d{3})/.exec(text);
    if (q) return { kind: "circle", c: [(+q[1] + +q[2] / 60) * (q[3] === "S" ? -1 : 1), (+q[4] + +q[5] / 60) * (q[6] === "W" ? -1 : 1)], r: +q[7] * NM, src: "Q" };
    return null;
  }
  function notamQ(raw) {
    const m = /Q\)\s*[A-Z]{4}\/(Q[A-Z]{4})\/[^/]*\/[^/]*\/[^/]*\/(\d{3})\/(\d{3})\//.exec(raw);
    return m ? { code: m[1], lowerFt: +m[2] * 100, upperFt: +m[3] * 100 } : null;
  }
  const TERRAIN_MAX_FT = 9500; // הנקודה הגבוהה בישראל (החרמון) כ-9,230 רגל
  // סוג נוטם: סגירת מרחב אוויר (QR* הגבלות/אזורים, QW* אזהרות ופעילויות, QA* עם CLSD/PROHIBITED...) לעומת תדרים, GNSS, נתיבים, רשימות ועוד
  function notamKind(raw) {
    const up = raw.toUpperCase(), q = notamQ(raw), code = q ? q.code : "";
    const eM = /E\)\s*([\s\S]*?)(?=\n[FG]\)|$)/.exec(up), e = eM ? eM[1] : up;
    if (/NOTAMC\b/.test(up)) return "cancel";
    if (code === "QKKKK") return "checklist";
    if (/^QC/.test(code)) return "comms";
    if (/^QG/.test(code)) return "gnss";
    if (/\bRTE\b|\bAWY\b|\bROUTE\b/.test(e)) return "route";
    if (/^QOB/.test(code)) return "obstacle";
    if (/^QR/.test(code) || /^QW/.test(code)) return "closure";
    if (/^QA/.test(code) && /CLSD|PROHIBITED|RESTRICTED|DANGER/.test(e)) return "closure";
    return "other";
  }
  // סגירות אוויריות בתוקף בחלון הפעילות, במרחק עד nearM מקצה הסגירה המבוקשת (R). topFt = הגובה המבוקש ברגל.
  // לא נכללים ונספרים: תדרים, GNSS, נתיבים, רשימות, ביטולים, נוטמים אחרים, סגירות רחוקות, וסגירות שגבולן התחתון גבוה מהגובה המבוקש.
  function analyzeNotams(P, R, notams, winFromMs, winToMs, topFt, nearM, obstNearM) {
    nearM = nearM || 10000; obstNearM = obstNearM || 1000;
    const hits = [], obstacles = [], skipped = [], excluded = []; let valid = 0;
    (notams || []).forEach(n => {
      const raw = n.raw || "", w = notamWindow(raw);
      if (!w) { skipped.push(n.id); return; }
      if (!(w.from <= winToMs && w.to >= winFromMs)) return;
      valid++;
      const kind = notamKind(raw);
      if (kind !== "closure" && kind !== "obstacle") { excluded.push({ id: n.id, reason: kind }); return; }
      const q = notamQ(raw), g = notamGeometry(raw), lim = kind === "closure" ? nearM : obstNearM;
      let dc = null, edge = 0;
      if (g) {
        if (g.kind === "circle") { const c = P.xy(g.c[0], g.c[1]); dc = Math.max(0, P.dPt(c[0], c[1]) - g.r); }
        else dc = polyNearest(g.pts.map(p => P.xy(p[0], p[1])), true, P.route).d;
        edge = Math.max(0, dc - R);
        if (edge > lim) { excluded.push({ id: n.id, reason: "far" }); return; }
      }
      if (q && topFt != null && q.lowerFt >= topFt + TERRAIN_MAX_FT) { excluded.push({ id: n.id, reason: "above", lowerFt: q.lowerFt }); return; }
      const rec = { id: n.id, kind, heb: n.heb, name: n.name, raw, window: w, geometry: g, d: dc, edge, inside: g ? dc <= R : false, q, relation: g ? (dc <= R ? "overlap" : "near") : "no-geometry" };
      (kind === "closure" ? hits : obstacles).push(rec);
    });
    const srt = (a, b) => (a.d == null ? -1 : a.d) - (b.d == null ? -1 : b.d);
    hits.sort(srt); obstacles.sort(srt);
    return { hits, obstacles, skipped, excluded, valid, total: (notams || []).length };
  }

  /* ================= קלט נקודה ================= */
  // מקבל "32.099128, 34.816617" / "32.099128 34.816617" / DMS בפורמט 32°05'56.86"N 34°48'59.82"E / קישור Google Maps (@lat,lon)
  function parseCoordInput(str) {
    if (!str) return null;
    str = String(str).trim();
    const at = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(str);
    if (at) return fix(+at[1], +at[2]);
    const dm = [...str.matchAll(/(\d{1,3})\s*[°\s]\s*(\d{1,2})\s*['′\s]\s*(\d{1,2}(?:\.\d+)?)\s*["″]?\s*([NSEW])/gi)];
    if (dm.length >= 2) {
      const v = m => (+m[1] + +m[2] / 60 + +m[3] / 3600) * (/[SW]/i.test(m[4]) ? -1 : 1);
      const a = dm[0], b = dm[1];
      return /[NS]/i.test(a[4]) ? fix(v(a), v(b)) : fix(v(b), v(a));
    }
    const m = /(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)/.exec(str);
    return m ? fix(+m[1], +m[2]) : null;
    function fix(la, lo) { // סדר הפוך (אורך, רוחב) — תיקון בישראל
      if (la >= 34 && la <= 36.5 && lo >= 29 && lo <= 33.5) { const t = la; la = lo; lo = t; }
      return isFinite(la) && isFinite(lo) ? { lat: la, lon: lo } : null;
    }
  }

  /* ================= אימות קלט ================= */
  const PURPOSE_MAX = 80;   // תקרת אורך מהות הפעילות, בתווים (נקודות קוד — אמוג׳י אחד הוא תו אחד). אותו ערך ב-ui.js; שדה ההוספה מוגבל ל-4×PURPOSE_MAX (ui.js/index.html) כדי שהדבקה ארוכה תגיע לבדיקה ותידחה בהודעה ולא תיחתך בשקט
  const purposeLen = p => [...String(p == null ? "" : p).trim()].length;
  // תו שאסור במהות: בקרה (C0, DEL, C1), מפרידי שורה/פסקה U+2028/2029, חצי סרוגייט בודד ו-U+FFFE/FFFF. אלה אסורים ב-XML (Word), וחצי סרוגייט בודד גם גורם ל-encodeURIComponent של המייל לזרוק.
  // לולאה על נקודות קוד (ולא regex עם escape של יוניקוד); זוג סרוגייט תקין (אמוג'י) מגיע כתו אחד ועובר
  function purposeHasBadChar(p) {
    for (const ch of p) { const c = ch.codePointAt(0); if (c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029 || (c >= 0xd800 && c <= 0xdfff) || c === 0xfffe || c === 0xffff) return true; }
    return false;
  }
  // יש בטקסט לפחות תו גלוי אחד? תווים בלתי נראים — רווחים, בקרה/עיצוב/מפרידים (Cc, Cf, Z: RLM, ZWSP, LRM, WJ, SHY…) ועוד כמה שאינם באף אחת מהקטגוריות האלה: מילוי הנגול (U+115F, U+1160, U+3164, U+FFA0),
  // בריילי ריק (U+2800), CGJ (U+034F), נקודות חיבור חמריות (U+17B4/5), מפרידי מונגולית (U+180B–180F), בוררי וריאציה (U+FE00–FE0F, U+E0100–E01EF). מהות שכולה כאלה נראית ריקה בטופס, ב-Word ובמייל. השוואה מספרית — בלי רצפי escape של יוניקוד
  const INVIS_CAT = /[\p{Cc}\p{Cf}\p{Z}]/u;
  function purposeHasVisible(p) {
    for (const ch of String(p == null ? "" : p)) {
      if (INVIS_CAT.test(ch) || /\s/.test(ch)) continue;
      const c = ch.codePointAt(0);
      if (c === 0x115f || c === 0x1160 || c === 0x3164 || c === 0xffa0 || c === 0x2800 || c === 0x34f || c === 0x17b4 || c === 0x17b5 || (c >= 0x180b && c <= 0x180f) || (c >= 0xfe00 && c <= 0xfe0f) || (c >= 0xe0100 && c <= 0xe01ef)) continue;
      return true;
    }
    return false;
  }
  // מחזיר "" כשהמהות חוקית, אחרת הודעת השגיאה בעברית. הבדיקה על הערך כפי שהוא (לא אחרי ניקוי): מה שנכנס לטופס הוא מה שנבדק
  function purposeProblem(p) {
    if (typeof p !== "string" || !p.trim() || !purposeHasVisible(p)) return "יש לבחור מהות פעילות";   // גם מהות שכולה תווים בלתי נראים
    if (purposeLen(p) > PURPOSE_MAX) return "מהות הפעילות: עד " + PURPOSE_MAX + " תווים";
    if (purposeHasBadChar(p)) return "מהות הפעילות מכילה תווים לא תקינים (למשל תווי בקרה)";
    return "";
  }
  // פרטי המבקש בנספח ג׳: שם הגורם המבקש (שדה 2) חובה ונקבע על ידי המבקש עצמו — אין עוד ברירת מחדל של הארגון; אות קריאה (שדה 13) ומס׳ רישום כלי הטיס (שדה 14) אופציונליים (ריק => "לא רלוונטי" בפלט).
  // אותם כללי תווים כמו במהות (purposeHasBadChar): הערכים נכנסים לטופס, ל-Word (XML), ל-KML ולמייל. הבדיקה על הערך כפי שהוא, והאורך אחרי trim
  const ORG_MAX = 80, ID_MAX = 40;
  // ערך שכולו תווים בלתי נראים (RLM, ZWSP, U+3164 וכו') עובר trim() אך נראה ריק בטופס, ב-Word ובמייל — לכן שם הגורם והשם נדחים (כמו מהות הפעילות, purposeHasVisible), ואות קריאה/רישום נדחים אלא אם ריקים לגמרי (או רווחים בלבד: "לא רלוונטי")
  function requesterOrgProblem(v) {
    if (typeof v !== "string" || !v.trim()) return "יש להזין את שם הגורם המבקש";
    if (v.trim().length > ORG_MAX) return "שם הגורם המבקש: עד " + ORG_MAX + " תווים";
    if (purposeHasBadChar(v)) return "שם הגורם המבקש מכיל תווים לא תקינים (למשל תווי בקרה)";
    if (!purposeHasVisible(v)) return "יש להזין את שם הגורם המבקש";   // רק תווים בלתי נראים
    return "";
  }
  function optionalIdProblem(v, label) {
    if (v == null || v === "") return "";
    if (typeof v !== "string") return label + " אינו תקין";
    if (!v.trim()) return "";   // רווחים בלבד = ריק (הפלט כותב "לא רלוונטי")
    if (v.trim().length > ID_MAX) return label + ": עד " + ID_MAX + " תווים";
    if (purposeHasBadChar(v)) return label + " מכיל תווים לא תקינים (למשל תווי בקרה)";
    if (!purposeHasVisible(v)) return label + " אינו מכיל תו גלוי — יש להקליד ערך או להשאיר את השדה ריק";
    return "";
  }
  function validateInput(inp, cfg) {
    const errs = [], push = (k, m) => errs.push({ field: k, msg: m });
    const lim = cfg.defaults;
    if (isRoute(inp)) validateRoute(inp, cfg).forEach(e => errs.push(e));   // נתיב: נקודות, אורך ורוחב במקום נקודת מרכז ורדיוס
    else {
      if (!isFinite(inp.lat) || !isFinite(inp.lon)) push("coord", "יש להזין נקודת מרכז (או ללחוץ על המפה)");
      else if (!(inp.lat >= 29 && inp.lat <= 34 && inp.lon >= 34 && inp.lon <= 36.5)) push("coord", "הנקודה מחוץ לתחום ישראל והסביבה");
      if (!(inp.radius >= lim.min_radius_m && inp.radius <= lim.max_radius_m)) push("radius", "רדיוס בין " + lim.min_radius_m + " ל-" + fmtInt(lim.max_radius_m) + " מטר");
    }
    if (!(inp.heightM > 0 && inp.heightM <= 20000)) push("height", "יש להזין גובה במטרים");
    const a = parseDate(inp.dateFrom), b = parseDate(inp.dateTo);
    if (!a) push("dateFrom", "תאריך התחלה חסר");
    if (!b) push("dateTo", "תאריך סיום חסר");
    if (a && b && Date.UTC(b.y, b.m - 1, b.d) < Date.UTC(a.y, a.m - 1, a.d)) push("dateTo", "תאריך הסיום קודם להתחלה");
    if (a && b && (Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000 > 60) push("dateTo", "טווח מעל 60 ימים");
    if (!parseTime(inp.timeFrom)) push("timeFrom", "שעת התחלה חסרה");
    if (!parseTime(inp.timeTo)) push("timeTo", "שעת סיום חסרה");
    // מהות הפעילות: טקסט חופשי — המשתמש יכול להוסיף מהויות משלו (ui.js, נשמרות בדפדפן), ולכן אין עוד דרישה שתהיה ברשימת config.json (השרת אינו בודק מהות).
    // חוקית = מחרוזת לא ריקה אחרי trim, עד PURPOSE_MAX תווים, בלי תווי בקרה (הם נכנסים לשדה 4 בטופס, למייל ול-Word); ערך שאינו מחרוזת נדחה
    const pu = purposeProblem(inp.purpose);
    if (pu) push("purpose", pu);
    if (!inp.aircraft || !inp.aircraft.length) push("aircraft", "יש לבחור כלי טיס");
    if (!(inp.siteName || "").trim()) push("siteName", "חסר שם ישוב/אתר");
    if (!(inp.requesterName || "").trim() || !purposeHasVisible(inp.requesterName) || !/\d{7,}/.test((inp.requesterPhone || "").replace(/\D/g, ""))) push("requester", "חסרים שם וטלפון של המבקש");   // שם שכולו תווים בלתי נראים נחשב חסר
    { const p = requesterOrgProblem(inp.requesterOrg); if (p) push("requesterOrg", p); }
    { const p = optionalIdProblem(inp.callsign, "אות הקריאה"); if (p) push("callsign", p); }
    { const p = optionalIdProblem(inp.registration, "מס׳ הרישום של כלי הטיס"); if (p) push("registration", p); }
    // נספח ג׳ שדה 12: "2 אנשי קשר + טלפונים" — רשימת {name, phone}; נדרשים לפחות שני שמות ולפחות טלפון תקין אחד, וטלפון שהוזן חייב להיות תקין. טלפון חסר לאיש קשר מסוים הוא אזהרה בלבד (ראו ui.js)
    const contacts = Array.isArray(inp.contacts) ? inp.contacts : [], named = contacts.filter(c => (c.name || "").trim());
    if (named.length < 2) push("contacts", "יש להזין שני אנשי קשר בשטח (שם וטלפון לכל אחד)");
    else if (contacts.some(c => !(c.name || "").trim() && (c.phone || "").trim())) push("contacts", "יש טלפון בלי שם — יש להוסיף שם או למחוק את השורה");
    else if (named.some(c => (c.phone || "").trim() && !validPhone(c.phone))) push("contacts", "מספר טלפון של איש קשר אינו תקין");
    else if (!named.some(c => validPhone(c.phone))) push("contacts", "חסר טלפון של אנשי הקשר בשטח");
    if (contacts.length > MAX_PEOPLE || named.some(c => c.name.trim().length > 60)) push("contacts", "עד " + MAX_PEOPLE + " אנשי קשר, ושם עד 60 תווים");
    // משתתפים נוספים בטיסה: אופציונלי. שורה שמולאה חלקית נדחית (שם פרטי, שם משפחה וטלפון תקין), שורה ריקה מתעלמים ממנה
    const parts = Array.isArray(inp.participants) ? inp.participants : [];
    if (parts.length > MAX_PEOPLE) push("participants", "עד " + MAX_PEOPLE + " משתתפים");
    else {
      const bad = parts.map(p => ({ f: (p.first || "").trim(), l: (p.last || "").trim(), ph: (p.phone || "").trim() })).find(p => (p.f || p.l || p.ph) && (!p.f || !p.l || !validPhone(p.ph) || p.f.length > 40 || p.l.length > 40));
      // בלי מספר שורה: הממשק מסנן שורות ריקות לפני האימות, ולכן האינדקס כאן אינו מיקום השורה על המסך; הסימון האדום בממשק מראה איזו שורה
      if (bad) push("participants", "יש משתתף עם פרטים חלקיים: יש להשלים שם פרטי, שם משפחה וטלפון תקין — או למחוק את השורה");
    }
    if (String(inp.knownObstacles || "").length > 1000) push("knownObstacles", "מכשולים שידועים למבקש: עד 1,000 תווים");
    // יותר מ-KO_MAX פריטים נדחה (שגיאה חוסמת), כדי שלא ייחתך בשקט פריט שלא הוצלב מול הסריקה
    else if (knownSegments(inp.knownObstacles).length > KO_MAX) push("knownObstacles", "מכשולים שידועים למבקש: עד " + KO_MAX + " פריטים (מופרדים בפסיק או בשורה חדשה)");
    if (String(inp.visitNotes || "").length > 3000) push("visitNotes", "הערות המבקש: עד 3,000 תווים");
    if (inp.visitDate && !parseDate(inp.visitDate)) push("visitNotes", "תאריך הסיור באתר אינו חוקי");
    return errs;
  }

  const MAX_PEOPLE = 20;
  const validPhone = p => /\d{7,}/.test(String(p || "").replace(/\D/g, ""));
  // רשימה שהוזנה בשדה טקסט: מופרדת בפסיק, נקודה-פסיק, קו נטוי או שורה חדשה
  const splitList = t => String(t || "").split(/[;,\n\/|]+/).map(x => x.trim()).filter(Boolean);

  /* ================= מכשולים שידועים למבקש: הצלבה מול הסריקה =================
     הטקסט חופשי ואין בו מיקום, ולכן ההשוואה היא לפי מילים בשם הפריט בלבד ("התאמה אפשרית"). פריט שלא נמצא — המבקש אחראי להוסיפו ידנית (סעיף "סקירה אנושית"). */
  const KO_MAX = 20;   // תקרת פריטים בשדה "מכשולים שידועים למבקש" — יותר מזה נדחה באימות (ולא נחתך בשקט)
  // אותיות סופיות מנורמלות (ך ם ן ף ץ -> כ מ נ פ צ) בשני צדי ההשוואה, כדי ש"עגורנים" ו"עגורן" יגיעו לאותו שורש
  const koFin = s => s.replace(/ך/g, "כ").replace(/ם/g, "מ").replace(/ן/g, "נ").replace(/ף/g, "פ").replace(/ץ/g, "צ");
  const KO_STOP = new Set(["של", "על", "עם", "ליד", "מול", "בצד", "צד", "בקרבת", "קרוב", "קרובה", "מעל", "באזור", "אזור", "בתוך", "את", "או", "אל", "מן", "בין", "גם", "יש", "הוא", "היא", "זה", "זו", "לא", "כל", "עוד", "כי", "אם", "אשר", "כמו", "עד", "שם", "פה", "שלי", "בערך", "כ"].map(koFin));
  const koTokens = s => koFin(String(s || "").toLowerCase()).split(/[^א-תa-z0-9]+/).filter(t => t.length >= 2 && !/^\d+$/.test(t) && !KO_STOP.has(t));
  // נרדפים ברמת מילה בודדת (בצורה מנורמלת, ראו koFin). בכוונה בלי ביטויים כמו "מגדל תקשורת" — אחרת "אנטנה" תתאים גם לכל "מגדל מים"/"מגדל תצפית"
  const KO_SYN = [["אנטנה", "תורנ", "תרנ"], ["עגורנ", "מנופ"], ["ארובה", "ארובת"]];
  // צורות של מילה: היא עצמה, בלי אות יחס, בלי סיומת ריבוי (ים -> שורש; ות -> שורש ושורש+ה) וכל הנרדפים שלה.
  // מילה שהיא (או שהיא בלי אות היחס) מילת קישור נפסלת כולה — "הקרוב" -> "קרוב" — ולכן מוחזר [] (ראו koWords)
  function koForms(t) {
    const base = t.length >= 4 && /^[והבכלמש]/.test(t) ? [t, t.slice(1)] : [t];
    if (base.some(f => KO_STOP.has(f))) return [];
    const out = new Set(base);
    base.forEach(f => { if (f.length >= 5 && /(ימ|ות)$/.test(f)) { const stem = f.slice(0, -2); out.add(stem); if (f.endsWith("ות")) out.add(stem + "ה"); } });
    KO_SYN.forEach(g => { if (g.some(w => out.has(w))) g.forEach(w => out.add(w)); });
    return [...out];
  }
  const koWords = s => koTokens(s).map(koForms).filter(fs => fs.length);
  // טקסט הפריט להשוואה: רק label ו-name. ה-title מעוטר ב-"(×N, הקרוב)" לפריטי מצאי מקובצים והקישוט אינו חלק משם הפריט
  const koItemText = it => [it.label, it.name].filter(Boolean).join(" ") || String(it.title || "").replace(/\s*\(×\d+[^)]*\)/g, "");
  const knownSegments = text => String(text || "").split(/[;\n,،]+/).map(x => x.trim()).filter(Boolean);
  // מחזיר לכל פריט שהוזן: {text, found:[פריטי הטופס שהמילים שלהם מתאימות], census:[פריטי מצאי רחב בקרבה שאינם בטופס], none}
  function matchKnownObstacles(text, nearScan) {
    const prep = it => { const forms = new Set(); koWords(koItemText(it)).forEach(fs => fs.forEach(f => forms.add(f))); return { it, forms }; };
    const items = ((nearScan && nearScan.items) || []).map(prep), census = ((nearScan && nearScan.censusOnly) || []).map(prep);
    return knownSegments(text).slice(0, KO_MAX).map(seg => {   // ה-slice הגנתי בלבד: validateInput כבר דוחה יותר מ-KO_MAX פריטים
      const toks = koWords(seg);
      const rank = pool => pool.map(p => ({ it: p.it, score: toks.filter(fs => fs.some(f => p.forms.has(f))).length })).filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.it.d - b.it.d).map(x => x.it);
      const found = rank(items), cen = rank(census);
      return { text: seg, found, census: cen, none: !found.length && !cen.length };
    });
  }

  /* ================= הרכבת התוצאה המלאה ================= */
  // inp: קלט המשתמש. data: {zones, inpa, agri, notams, notamFetchedIso, near, far, ext, reverse}. now: Date
  function analyze(inp, data, cfg, now) {
    const route = isRoute(inp), P = projFor(inp), R = areaWidth(inp), th = cfg.thresholds;
    const A = route ? routeInfo(inp.area.pts) : null, aLat = route ? A.anchor[0] : inp.lat, aLon = route ? A.anchor[1] : inp.lon;   // נתיב: הנקודה לשעות הזריחה (עוגן על הקו)
    const res = { P, R, inp };
    if (route) res.area = { kind: "route", pts: inp.area.pts, halfWidth: R, lat: aLat, lon: aLon, lengthM: A.lengthM, bbox: A.bbox };
    res.nearScan = analyzeNear(P, R, { elements: ((data.near && data.near.elements) || []).concat(manualElements(inp.manualItems)) }, th);
    res.zones = analyzeZones(P, R, { zones: data.zones && data.zones.zones, inpa: data.inpa }, th.near_zone_m, inp.heightM * M2FT, th.approx_margin_m);
    // הערת השוליים ¹ של נספח ב׳-1 (גובה מרבי; הפרדת 1,500/1,000 רגל מכלי טיס מאויש) — מצוטטת במלואה בכל פלט שמציג אזור כזה
    { const fn = data.zones && data.zones.general && data.zones.general.B09 && data.zones.general.B09.footnote;
      res.b09Footnote = fn && [...res.zones.inside, ...res.zones.near].some(z => z.src === "b09" && /¹/.test((z.alt || "") + (z.pmt || ""))) ? fn : null; }
    res.agri = analyzeAgri(P, data.agri && data.agri.airstrips);
    res.airfields = analyzeAirfields(P, data.far, th.airfield_scan_m);
    res.places = nearestPlaces(P, data.far, 5);
    res.siteSuggestion = suggestSiteName(data.far, data.reverse);
    res.borders = analyzeBorders(P, data.ext, cfg, R);
    res.borderScanM = Math.max(th.border_scan_m || 7000, R + 7000);
    const prot = ((data.ext && data.ext.elements) || []).filter(e => e.tags && (e.tags.leisure === "nature_reserve" || e.tags.boundary === "national_park" || e.tags.boundary === "protected_area"))
      .map(e => { const r = elemDist(P, e); return r ? { name: nameOf(e.tags), d: r.d, id: e.type + "/" + e.id } : null; }).filter(Boolean);
    res.osmProtected = prot.sort((a, b) => a.d - b.d);
    res.sun = dayNightTable(aLat, aLon, inp.dateFrom, inp.dateTo, inp.timeFrom, inp.timeTo);
    res.ft = inp.heightM * M2FT;
    if (res.sun.length) {
      res.notams = analyzeNotams(P, R, data.notams, +res.sun[0].startUtc, +res.sun[res.sun.length - 1].endUtc, res.ft, th.notam_near_m, th.site_near_m);
    } else res.notams = { hits: [], obstacles: [], skipped: [], excluded: [] };
    const nf = data.notamFetchedIso ? Date.parse(data.notamFetchedIso) : NaN;
    res.notamAgeH = isFinite(nf) ? (now.getTime() - nf) / 3600000 : null;
    res.todayYmd = ilToday(now);
    res.workingDays = workingDaysBefore(res.todayYmd, inp.dateFrom);
    return res;
  }

  /* ================= שער "מוכן לשליחה": כל בדיקה חייבת לרוץ ולהצליח ================= */
  // statuses: {key:{ok:boolean,msg}} מילוי ע"י הממשק; כאן רק הרשימה ההכרחית והחישוב
  const REQUIRED_CHECKS = [
    ["input", "קלט תקין"],
    ["a17", "אזורי פמ״ת א-17, פרק ב-09 וגנים/שמורות רט״ג"],
    ["sync", "סנכרון עם מפת החברים (אין עדכון שלא נקלט)"],
    ["agri", "מנחתים חקלאיים"],
    ["notam", "נוטמים בתוקף"],
    ["osm_near", "מכשולים ותשתיות בסביבה (OpenStreetMap)"],
    ["osm_far", "שדות תעופה, מנחתים וישובים (OpenStreetMap)"],
    ["osm_ext", "גבולות מדינה ושטחי טבע (OpenStreetMap)"],
    ["map", "תמונת מפה ותצ״א עם רקע"],
    ["review", "הצהרה ואישור המבקש"],
    ["selftest", "בדיקה עצמית של החישובים"]
  ];
  function gate(statuses) {
    const failing = REQUIRED_CHECKS.filter(([k]) => !(statuses[k] && statuses[k].ok));
    return { ready: failing.length === 0, failing: failing.map(([k, l]) => ({ key: k, label: l, msg: (statuses[k] && statuses[k].msg) || "לא הושלם" })) };
  }

  /* ================= מפתחות אחסון מקומי לפי משתמש =================
     כל נתון בדפדפן ששייך למשתמש (פרטי המבקש, כלי טיס ומהויות נוספים) נשמר תחת <מפתח בסיס>:<גיבוב של שם המשתמש>, כך שמשתמש אחר באותו דפדפן לא רואה ולא יורש אותו, ושם המשתמש עצמו לא נכתב בשם המפתח.
     הגיבוב סינכרוני בכוונה (SHA-256 בקוד, לא crypto.subtle): האחרון אסינכרוני, ואינו קיים בהקשר לא מאובטח (http) — ושמירה/טעינה בזמן הקלדה והתחברות חייבות להיות סינכרוניות וללא מצב כשל.
     16 תווי hex (64 ביט) מתוך 256: התנגשות בין משתמשים אפשרית רק בתיאוריה (≈10^-16 למאה משתמשים). זה בידוד בין חשבונות, לא הצפנה — מי שניגש לדפדפן רואה את הנתונים. */
  const SHA_K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  function sha256Hex(msg) {
    const bytes = new TextEncoder().encode(String(msg == null ? "" : msg)), n = bytes.length, total = ((n + 9 + 63) >> 6) << 6, buf = new Uint8Array(total);
    buf.set(bytes); buf[n] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 8, Math.floor(n / 0x20000000)); dv.setUint32(total - 4, (n << 3) >>> 0);
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]), w = new Uint32Array(64), rr = (x, k) => (x >>> k) | (x << (32 - k));
    for (let o = 0; o < total; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) { const a = w[i - 15], b = w[i - 2]; w[i] = w[i - 16] + (rr(a, 7) ^ rr(a, 18) ^ (a >>> 3)) + w[i - 7] + (rr(b, 17) ^ rr(b, 19) ^ (b >>> 10)); }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & f) ^ (~e & g)) + SHA_K[i] + w[i]) >>> 0, t2 = ((rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      [a, b, c, d, e, f, g, h].forEach((x, i) => { H[i] += x; });
    }
    return [...H].map(x => x.toString(16).padStart(8, "0")).join("");
  }
  const userHash = name => (name == null || name === "") ? "" : sha256Hex("icd-req-user:" + String(name)).slice(0, 16);
  // "" כשאין משתמש — הקורא חייב לא לקרוא ולא לכתוב (אין מפתח "בלי בעלים")
  const userKey = (base, name) => { const h = userHash(name); return h ? base + ":" + h : ""; };

  return {
    M2FT, NM, HEB_DAY, ZONE_KIND, REQUIRED_CHECKS, MIRRORS,
    sha256Hex, userHash, userKey,
    Proj, polyNearest, circlePoints, isRoute, routeInfo, projFor, areaWidth, roundPts, corridorRing, validateRoute, parseCoordList, routeLim, segSegDist, routeNearest, dms, dmsLat, dmsLon, fmtInt, fmtDist, trimNum, esc, xmlClean, altText, fmtHM,
    altRange, notamQ, manualElements, groupOf, COVERAGE_GROUPS, buildQueries, overpass, elemGeoms, elemDist, heLabel, classify, analyzeNear, analyzeZones, analyzeAgri, analyzeAirfields,
    suggestSiteName, nearestPlaces, analyzeBorders, sunTimes, localToUtc, dayNightTable, workingDaysBefore, dayName, ddmmyyyy, parseDate, parseTime, hhmm,
    ilToday, splitList, validPhone, matchKnownObstacles, knownSegments, KO_MAX, MAX_PEOPLE, ORG_MAX, ID_MAX, parseCoordInput, notamKind, notamGeometry, notamWindow, analyzeNotams, validateInput, analyze, gate, purposeHasVisible, purposeLen, PURPOSE_MAX
  };
});
