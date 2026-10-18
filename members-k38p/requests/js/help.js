/* לחצן "!" בעיגול עם הסבר קצר: לחיצה פותחת בועת הסבר צפה אחת (position: fixed) ליד הכפתור; נסגרת בלחיצה נוספת על אותו כפתור, בלחיצה מחוץ לבועה או ב-Escape.
   הטקסט נמצא ב-data-help של הכפתור (escaped) ונכנס לבועה כטקסט בלבד (textContent) — לעולם לא כ-HTML. נטען ראשון, לפני auth.js. */
(function () {
  "use strict";
  const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const GAP = 8, EDGE = 10;   // רווח בין הכפתור לבועה, ושוליים מינימליים מקצה המסך
  let bubble = null, owner = null, wired = false;

  // HTML של הכפתור; text הוא טקסט רגיל (לא HTML). name = שם קצר וסטטי של מה שמוסבר ("הרצת הבדיקות"), לקורא מסך: aria-label="הסבר על: <שם>" (בלי שם — "הסבר")
  function btn(text, name) {
    const label = name ? "הסבר על: " + name : "הסבר";
    return '<button type="button" class="hbtn" aria-label="' + esc(label) + '" aria-expanded="false" data-help="' + esc(text) + '">!</button>';
  }

  function ensureBubble() {
    if (bubble && bubble.isConnected) return bubble;
    bubble = document.createElement("div");
    bubble.id = "hbubble"; bubble.className = "hbubble"; bubble.setAttribute("role", "note"); bubble.dir = "rtl"; bubble.hidden = true;
    document.body.appendChild(bubble);
    return bubble;
  }

  // האזורים הבטוחים (חריץ, שורת סטטוס, פינות מעוגלות, פס הבית) כפי שהם מחושבים עכשיו: --safe-* ב-index.html (env(safe-area-inset-*)). נקראים דרך אלמנט בדיקה שה-padding שלו הוא המשתנים,
  // ולא דרך getPropertyValue על המשתנה (ב-Safari env() בתוך משתנה מותאם אינו תמיד מוחלף במחרוזת px); כל ערך שאינו מספר = 0, כך שדפדפן בלי תמיכה מתנהג כמו קודם
  let probe = null;
  function safeInsets() {
    try {
      if (!probe || !probe.isConnected) {
        probe = document.createElement("div"); probe.setAttribute("aria-hidden", "true");
        probe.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:var(--safe-top,0px) var(--safe-right,0px) var(--safe-bottom,0px) var(--safe-left,0px)";
        document.body.appendChild(probe);
      }
      const cs = getComputedStyle(probe), n = v => (parseFloat(v) > 0 ? parseFloat(v) : 0);
      return { t: n(cs.paddingTop), r: n(cs.paddingRight), b: n(cs.paddingBottom), l: n(cs.paddingLeft) };
    } catch (e) { return { t: 0, r: 0, b: 0, l: 0 }; }
  }

  // ממקם מתחת לכפתור (או מעליו כשאין מקום), ממורכז אליו ומוגבל לתוך האזור הבטוח של המסך — גם בטלפון עם חריץ בלנדסקייפ
  function place() {
    if (!owner || !bubble) return;
    const vw = document.documentElement.clientWidth || window.innerWidth, vh = window.innerHeight, si = safeInsets();
    const minL = EDGE + si.l, maxR = vw - EDGE - si.r, minT = EDGE + si.t, maxB = vh - EDGE - si.b;   // גבולות הבועה בתוך האזור הבטוח
    bubble.style.maxWidth = Math.max(0, Math.min(340, maxR - minL)) + "px";
    bubble.style.left = "0px"; bubble.style.top = "0px";
    const r = owner.getBoundingClientRect(), bw = bubble.offsetWidth, bh = bubble.offsetHeight;
    let left = r.left + r.width / 2 - bw / 2;
    left = Math.max(minL, Math.min(left, maxR - bw));
    let top = r.bottom + GAP;
    if (top + bh > maxB && r.top - GAP - bh >= minT) top = r.top - GAP - bh;   // אין מקום למטה ויש למעלה
    top = Math.max(minT, Math.min(top, maxB - bh));
    bubble.style.left = Math.round(left) + "px"; bubble.style.top = Math.round(top) + "px";
  }

  function close() {
    if (owner) { owner.setAttribute("aria-expanded", "false"); owner.removeAttribute("aria-describedby"); }
    owner = null;
    if (bubble) bubble.hidden = true;
  }

  function open(b) {
    if (owner && owner !== b) close();
    const el = ensureBubble();
    el.textContent = b.getAttribute("data-help") || "";
    el.hidden = false;
    owner = b;
    b.setAttribute("aria-expanded", "true"); b.setAttribute("aria-describedby", "hbubble");
    place();
  }

  // delegation אחד על document: עובד גם לכפתורים שנוצרים אחר כך (שורות, חלונות ניהול)
  function wire() {
    if (wired) return;
    wired = true;
    document.addEventListener("click", ev => {
      const t = ev.target, b = t && t.closest ? t.closest(".hbtn") : null;
      if (b) {
        ev.preventDefault(); ev.stopPropagation();   // לא מפעיל label, summary או טופס שהכפתור יושב בתוכם
        if (owner === b) close(); else open(b);
        return;
      }
      if (owner && !(bubble && bubble.contains(t))) close();
    }, true);
    document.addEventListener("keydown", ev => { if (ev.key === "Escape" && owner) { const o = owner; close(); try { o.focus(); } catch (e) { /* ignore */ } } });
    // גלילה/שינוי גודל: הבועה עוקבת אחרי הכפתור; נסגרת אם הכפתור הוסר מהדף (רענון תוכן החלון), הוסתר, או יצא מהתצוגה בגלילה (אחרת הבועה נשארת תקועה בשולי המסך, בלי קשר ויזואלי לכפתור)
    const follow = () => {
      if (!owner) return;
      if (!owner.isConnected) { close(); return; }
      const r = owner.getBoundingClientRect(), vw = document.documentElement.clientWidth || window.innerWidth, vh = window.innerHeight;
      if ((!r.width && !r.height) || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) close(); else place();
    };
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
  }

  window.ReqHelp = { btn, wire, close, esc };
  wire();
})();
