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
  function polyNearest(pts, closed) {
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
  function circlePoints(P, r, n) { // מעגל סביב מרכז ההיטל, כרשימת [lat,lon]
    n = n || 72; const out = [];
    for (let i = 0; i <= n; i++) {
      const a = (2 * Math.PI * i) / n;
      out.push(P.ll(r * Math.sin(a), r * Math.cos(a)));
    }
    out[out.length - 1] = out[0].slice();
    return out;
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
    LLU: "אזור אסור לטיסת כטב״ם וטיסן (LLU)", OBS: "בלון מעוגן (OBS)"
  };

  /* ================= שאילתות OpenStreetMap (משותפות לאפליקציה ולבדיקות) ================= */
  function buildQueries(lat, lon, R, cfg) {
    const th = (cfg && cfg.thresholds) || {};
    // מכשולים (מגדלים, חשמל, מבנים גבוהים): עד פי 2 מהרדיוס; אתרים ותשתיות קרקעיות/אוויריות: עד km מקצה הסגירה
    const siteM = th.site_near_m || 1000;
    const A = Math.ceil(2 * R + 150), B = Math.ceil(R + siteM + 50), nearR = Math.max(A, B);
    const c = lat + "," + lon, a = "(around:" + A + "," + c + ")", b = "(around:" + B + "," + c + ")";
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
    const box = km => { const dLa = km / 111000, dLo = km / (111000 * Math.cos((lat * Math.PI) / 180)); return [lat - dLa, lon - dLo, lat + dLa, lon + dLo].map(v => v.toFixed(5)).join(","); };
    // תיבה במקום around: מהיר בהרבה בשרתים העמוסים; המרחק המדויק מחושב בדפדפן
    const far =
      "[out:json][timeout:90];" +
      'nwr[aeroway~"^(aerodrome|heliport|helipad)$"](' + box(farR) + ");out center tags;" +
      "is_in(" + c + ");out tags;" +
      "node[place](" + box(placeR) + ");out body;";
    const bR = th.border_scan_m || 7000, pR = Math.ceil(2 * R + (th.near_zone_m || 1000));
    const dLat = bR / 111000, dLon = bR / (111000 * Math.cos((lat * Math.PI) / 180));
    const bbox = [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map(v => v.toFixed(5)).join(",");
    const ext =
      "[out:json][timeout:90];(" +
      "nwr(around:" + pR + "," + c + ")[leisure=nature_reserve];" +
      "nwr(around:" + pR + "," + c + ")[boundary=national_park];" +
      "nwr(around:" + pR + "," + c + ")[boundary=protected_area];" +
      ");out center tags;" +
      "rel(around:" + bR + "," + c + ')["boundary"="administrative"]["admin_level"="2"]["ISO3166-1"~"^(IL|EG|SY|LB)$"]->.cr;' +
      "way(r.cr)(around:" + bR + "," + c + ")->.bw;" +
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
    if (g.pt) { const xy = P.xy(g.pt[0], g.pt[1]); return { d: Math.hypot(xy[0], xy[1]), p: xy, inside: false }; }
    return polyNearest(g.pts.map(p => P.xy(p[0], p[1])), g.closed);
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
        const r = polyNearest(rg.map(p => P.xy(p[0], p[1])), true);
        if (!best || r.d < best.d) best = r;
      });
    }
    if (z.c && z.r) {
      const c = P.xy(z.c[0], z.c[1]), dc = Math.hypot(c[0], c[1]), d = Math.max(0, dc - z.r);
      const p = dc ? [(c[0] * d) / dc, (c[1] * d) / dc] : [0, 0];
      if (!best || d < best.d) best = { d, p, inside: d === 0 };
    }
    return best;
  }
  // מחזיר {inside:[...], near:[...]} — לפי קצה הסגירה המבוקשת (R) ועוד near_zone_m
  function analyzeZones(P, R, data, nearM) {
    const out = { inside: [], near: [] };
    const push = (z, src, kindLabel, altTxt) => {
      const r = zoneDistance(P, z); if (!r) return;
      if (r.d > R + nearM) return;
      const rec = { id: z.id, name: z.name, cat: z.cat || src, src, kind: kindLabel, d: r.d, edge: Math.max(0, r.d - R), p: r.p, ll: P.ll(r.p[0], r.p[1]), alt: altTxt, note: z.note || "", approx: !!z.approx, pmt: z.pmt || "", pmtRef: z.pmtRef || "", z };
      (r.d <= R ? out.inside : out.near).push(rec);
    };
    (data.zones || []).forEach(z => push(z, "a17", ZONE_KIND[z.cat] || z.cat, z.alt || altRange(z)));
    ((data.inpa && data.inpa.sites) || []).forEach(s =>
      push({ id: s.id, name: s.name, cat: s.kind === "P" ? "NP" : "NR", rings: s.rings, note: s.note, max: s.max }, "inpa", s.kind === "P" ? "גן לאומי (רט״ג)" : "שמורת טבע (רט״ג)",
        "סגור להטסה מהקרקע ועד " + fmtInt(s.max) + " רגל מעפ״ש"));
    out.inside.sort((a, b) => a.d - b.d); out.near.sort((a, b) => a.d - b.d);
    return out;
  }

  /* ================= מנחתים חקלאיים ושדות תעופה ================= */
  function analyzeAgri(P, airstrips) {
    return (airstrips || []).map(a => ({ name: a.name, d: Math.hypot(...P.xy(a.lat, a.lon)), ops: a.ops, arp: a.arp }))
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
      .map(e => ({ d: Math.hypot(...P.xy(e.lat, e.lon)), place: e.tags.place, name: nameOf(e.tags) }))
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
  const tzParts = (ms) => {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
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
        if (g.kind === "circle") { const c = P.xy(g.c[0], g.c[1]); dc = Math.max(0, Math.hypot(c[0], c[1]) - g.r); }
        else dc = polyNearest(g.pts.map(p => P.xy(p[0], p[1])), true).d;
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
  function validateInput(inp, cfg) {
    const errs = [], push = (k, m) => errs.push({ field: k, msg: m });
    if (!isFinite(inp.lat) || !isFinite(inp.lon)) push("coord", "יש להזין נקודת מרכז (או ללחוץ על המפה)");
    else if (!(inp.lat >= 29 && inp.lat <= 34 && inp.lon >= 34 && inp.lon <= 36.5)) push("coord", "הנקודה מחוץ לתחום ישראל והסביבה");
    const lim = cfg.defaults;
    if (!(inp.radius >= lim.min_radius_m && inp.radius <= lim.max_radius_m)) push("radius", "רדיוס בין " + lim.min_radius_m + " ל-" + fmtInt(lim.max_radius_m) + " מטר");
    if (!(inp.heightM > 0 && inp.heightM <= 20000)) push("height", "יש להזין גובה במטרים");
    const a = parseDate(inp.dateFrom), b = parseDate(inp.dateTo);
    if (!a) push("dateFrom", "תאריך התחלה חסר");
    if (!b) push("dateTo", "תאריך סיום חסר");
    if (a && b && Date.UTC(b.y, b.m - 1, b.d) < Date.UTC(a.y, a.m - 1, a.d)) push("dateTo", "תאריך הסיום קודם להתחלה");
    if (a && b && (Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000 > 60) push("dateTo", "טווח מעל 60 ימים");
    if (!parseTime(inp.timeFrom)) push("timeFrom", "שעת התחלה חסרה");
    if (!parseTime(inp.timeTo)) push("timeTo", "שעת סיום חסרה");
    if (!cfg.purposes.includes(inp.purpose)) push("purpose", "יש לבחור מהות פעילות");
    if (!inp.aircraft || !inp.aircraft.length) push("aircraft", "יש לבחור כלי טיס");
    if (!(inp.siteName || "").trim()) push("siteName", "חסר שם ישוב/אתר");
    if (!(inp.requesterName || "").trim() || !/\d{7,}/.test((inp.requesterPhone || "").replace(/\D/g, ""))) push("requester", "חסרים שם וטלפון של המבקש");
    if (!(inp.contactNames || "").trim() || !/\d{7,}/.test((inp.contactPhone || "").replace(/\D/g, ""))) push("contacts", "חסרים אנשי הקשר בשטח וטלפון");
    return errs;
  }

  /* ================= הרכבת התוצאה המלאה ================= */
  // inp: קלט המשתמש. data: {zones, inpa, agri, notams, notamFetchedIso, near, far, ext, reverse}. now: Date
  function analyze(inp, data, cfg, now) {
    const P = new Proj(inp.lat, inp.lon), R = inp.radius, th = cfg.thresholds;
    const res = { P, R, inp };
    res.nearScan = analyzeNear(P, R, { elements: ((data.near && data.near.elements) || []).concat(manualElements(inp.manualItems)) }, th);
    res.zones = analyzeZones(P, R, { zones: data.zones && data.zones.zones, inpa: data.inpa }, th.near_zone_m);
    res.agri = analyzeAgri(P, data.agri && data.agri.airstrips);
    res.airfields = analyzeAirfields(P, data.far, th.airfield_scan_m);
    res.places = nearestPlaces(P, data.far, 5);
    res.siteSuggestion = suggestSiteName(data.far, data.reverse);
    res.borders = analyzeBorders(P, data.ext, cfg, R);
    const prot = ((data.ext && data.ext.elements) || []).filter(e => e.tags && (e.tags.leisure === "nature_reserve" || e.tags.boundary === "national_park" || e.tags.boundary === "protected_area"))
      .map(e => { const r = elemDist(P, e); return r ? { name: nameOf(e.tags), d: r.d, id: e.type + "/" + e.id } : null; }).filter(Boolean);
    res.osmProtected = prot.sort((a, b) => a.d - b.d);
    res.sun = dayNightTable(inp.lat, inp.lon, inp.dateFrom, inp.dateTo, inp.timeFrom, inp.timeTo);
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
    ["a17", "אזורי פמ״ת א-17 וגנים/שמורות רט״ג"],
    ["agri", "מנחתים חקלאיים"],
    ["notam", "נוטמים בתוקף"],
    ["osm_near", "מכשולים ותשתיות בסביבה (OpenStreetMap)"],
    ["osm_far", "שדות תעופה, מנחתים וישובים (OpenStreetMap)"],
    ["osm_ext", "גבולות מדינה ושטחי טבע (OpenStreetMap)"],
    ["map", "תמונת מפה ותצ״א עם רקע"],
    ["review", "אישור סקירה אנושית של התצ״א והמצאי"],
    ["selftest", "בדיקה עצמית של החישובים"]
  ];
  function gate(statuses) {
    const failing = REQUIRED_CHECKS.filter(([k]) => !(statuses[k] && statuses[k].ok));
    return { ready: failing.length === 0, failing: failing.map(([k, l]) => ({ key: k, label: l, msg: (statuses[k] && statuses[k].msg) || "לא הושלם" })) };
  }

  return {
    M2FT, NM, HEB_DAY, ZONE_KIND, REQUIRED_CHECKS, MIRRORS,
    Proj, polyNearest, circlePoints, dms, dmsLat, dmsLon, fmtInt, fmtDist, trimNum, esc, altText, fmtHM,
    altRange, notamQ, manualElements, groupOf, COVERAGE_GROUPS, buildQueries, overpass, elemGeoms, elemDist, heLabel, classify, analyzeNear, analyzeZones, analyzeAgri, analyzeAirfields,
    suggestSiteName, nearestPlaces, analyzeBorders, sunTimes, localToUtc, dayNightTable, workingDaysBefore, dayName, ddmmyyyy, parseDate, parseTime, hhmm,
    ilToday, parseCoordInput, notamKind, notamGeometry, notamWindow, analyzeNotams, validateInput, analyze, gate
  };
});
