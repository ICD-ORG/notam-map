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

  // ממקם מתחת לכפתור (או מעליו כשאין מקום), ממורכז אליו ומוגבל לתוך המסך — גם בטלפון
  function place() {
    if (!owner || !bubble) return;
    const vw = document.documentElement.clientWidth || window.innerWidth, vh = window.innerHeight;
    bubble.style.maxWidth = Math.min(340, vw - 2 * EDGE) + "px";
    bubble.style.left = "0px"; bubble.style.top = "0px";
    const r = owner.getBoundingClientRect(), bw = bubble.offsetWidth, bh = bubble.offsetHeight;
    let left = r.left + r.width / 2 - bw / 2;
    left = Math.max(EDGE, Math.min(left, vw - bw - EDGE));
    let top = r.bottom + GAP;
    if (top + bh > vh - EDGE && r.top - GAP - bh >= EDGE) top = r.top - GAP - bh;   // אין מקום למטה ויש למעלה
    top = Math.max(EDGE, Math.min(top, vh - bh - EDGE));
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
