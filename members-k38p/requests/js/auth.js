/* התחברות נפרדת לבקשות טיסה: שם משתמש וסיסמה מול שרת Apps Script (apps-script/Code.gs).
   האכיפה בשרת: חסימת משתמש, החלפת סיסמה ופקיעת אסימון נבדקות בכל קריאה, ושמירה לדרייב אפשרית רק עם אסימון תקף.
   מסך הכניסה כאן הוא ממשק בלבד — הוא מסתיר את הטופס, אך את הדף עצמו לא ניתן "לנעול" באתר סטטי. */
(function () {
  "use strict";
  const KEY = "icdReqSession";
  const A = { cfg: null, token: "", user: "", role: "", exp: 0, mode: "login" };
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const ERR = {
    bad_login: "שם משתמש או סיסמה שגויים.", locked: "יותר מדי ניסיונות כושלים — נסו שוב בעוד כרבע שעה.", blocked: "המשתמש חסום מבקשות טיסה. יש לפנות למנהל המערכת.",
    expired: "פג תוקף ההתחברות — יש להתחבר מחדש.", auth: "ההתחברות אינה תקפה — יש להתחבר מחדש.", weak_pass: "הסיסמה קצרה מדי (לפחות 10 תווים).",
    bad_user: "שם משתמש לא תקין (3–40 תווים: אותיות, ספרות, נקודה, מקף).", exists: "המשתמש כבר קיים.", no_user: "המשתמש לא נמצא.", self: "לא ניתן לבצע פעולה זו על המשתמש שלך.",
    forbidden: "הפעולה מותרת למנהל בלבד.", bad_code: "קוד ההקמה שגוי.", no_setup: "המערכת אינה במצב הקמה.", busy: "השרת עסוק, נסו שוב.", bad_folder: "התיקייה בדרייב אינה תקפה.",
    bad_file: "הקובץ גדול מדי או ריק.", bad_name: "שם התיקייה אינו תקין.", server: "שגיאת שרת.", bad_request: "בקשה לא תקינה.", bad_action: "פעולה לא מוכרת."
  };
  const msg = r => (r && (ERR[r.error] || r.message || r.error)) || "שגיאה לא ידועה";

  function save() { try { sessionStorage.setItem(KEY, JSON.stringify({ token: A.token, user: A.user, role: A.role, exp: A.exp })); } catch (e) { /* ignore */ } }
  function clear() { A.token = ""; A.user = ""; A.role = ""; A.exp = 0; try { sessionStorage.removeItem(KEY); } catch (e) { /* ignore */ } }
  function restore() { try { const s = JSON.parse(sessionStorage.getItem(KEY) || "null"); if (s && s.token && s.exp > Date.now()) { A.token = s.token; A.user = s.user; A.role = s.role; A.exp = s.exp; return true; } } catch (e) { /* ignore */ } return false; }

  async function post(body) {
    const r = await fetch(A.cfg.api_url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body), redirect: "follow" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }
  // קריאה מאומתת: אסימון נשלח אוטומטית; אסימון פסול/פג/חסום מחזיר למסך הכניסה
  async function call(action, payload) {
    const res = await post(Object.assign({ action, token: A.token }, payload || {}));
    if (!res.ok && (res.error === "auth" || res.error === "expired" || res.error === "blocked")) { logout(); showCover(msg(res)); }
    return res;
  }
  function logout() { clear(); renderBar(); showCover(); }

  /* ---------- מסך כניסה ---------- */
  function cover() {
    let c = $("authCover");
    if (!c) { c = document.createElement("div"); c.id = "authCover"; c.setAttribute("role", "dialog"); c.dir = "rtl"; document.body.appendChild(c); }
    return c;
  }
  function hideCover() { const c = $("authCover"); if (c) c.remove(); document.body.classList.remove("authLocked"); }
  async function showCover(note) {
    document.body.classList.add("authLocked");
    const c = cover();
    if (!A.cfg || !A.cfg.api_url) {
      c.innerHTML = '<div class="authBox"><h2>בקשות טיסה</h2><p class="err">שרת ההתחברות עדיין לא הוגדר, ולכן אי אפשר להשתמש בדף. יש להשלים את ההתקנה (apps-script/README.md).</p></div>';
      return;
    }
    let boot = false;
    try { const r = await fetch(A.cfg.api_url, { redirect: "follow" }); const j = await r.json(); boot = !!j.needsBootstrap; } catch (e) { note = note || "אין חיבור לשרת ההתחברות. בדקו את האינטרנט ונסו שוב."; }
    c.innerHTML = '<form class="authBox" id="authForm" autocomplete="on"><h2>בקשות טיסה — כניסה</h2>' +
      (boot ? '<p class="small">הקמה ראשונה: הקלידו את קוד ההקמה שהוצג בהרצת <code>initialize()</code> ובחרו שם משתמש וסיסמה למנהל.</p><label class="f"><b>קוד הקמה</b><input id="auCode" type="text" autocomplete="off" dir="ltr"></label>' : '') +
      '<label class="f"><b>שם משתמש</b><input id="auUser" type="text" autocomplete="username" dir="ltr"></label>' +
      '<label class="f"><b>סיסמה' + (boot ? ' (לפחות 10 תווים)' : '') + '</b><input id="auPass" type="password" autocomplete="' + (boot ? "new-password" : "current-password") + '" dir="ltr"></label>' +
      '<div class="err" id="auErr">' + esc(note || "") + '</div><button class="primary" id="auGo" type="submit">' + (boot ? "הקם מנהל והיכנס" : "כניסה") + '</button></form>';
    $("authForm").onsubmit = async ev => {
      ev.preventDefault();
      const btn = $("auGo"); btn.disabled = true; $("auErr").textContent = "";
      try {
        const body = boot ? { action: "bootstrap", code: $("auCode").value.trim(), user: $("auUser").value.trim(), pass: $("auPass").value } : { action: "login", user: $("auUser").value.trim(), pass: $("auPass").value };
        const r = await post(body);
        if (!r.ok) { $("auErr").textContent = msg(r); btn.disabled = false; return; }
        A.token = r.token; A.user = r.user; A.role = r.role; A.exp = r.exp; save();
        hideCover(); renderBar();
        document.dispatchEvent(new CustomEvent("req-auth", { detail: { user: A.user, role: A.role } }));
      } catch (e) { $("auErr").textContent = "אין חיבור לשרת ההתחברות. נסו שוב."; btn.disabled = false; }
    };
    const u = $("auUser"); if (u) u.focus();
  }

  /* ---------- שורת משתמש, החלפת סיסמה וניהול משתמשים ---------- */
  function renderBar() {
    let bar = $("userBar");
    if (!bar) { bar = document.createElement("div"); bar.id = "userBar"; bar.className = "userBar"; const w = document.querySelector("header .wrap"); (w || document.body).appendChild(bar); }
    if (!A.token) { bar.innerHTML = ""; return; }
    bar.innerHTML = '<span>מחובר: <b>' + esc(A.user) + '</b>' + (A.role === "admin" ? " (מנהל)" : "") + '</span> ' +
      '<button type="button" id="ubPass">החלפת סיסמה</button>' + (A.role === "admin" ? ' <button type="button" id="ubAdmin">ניהול משתמשים</button>' : "") + ' <button type="button" id="ubOut">התנתק</button>';
    $("ubPass").onclick = openPassword; $("ubOut").onclick = logout;
    if (A.role === "admin") $("ubAdmin").onclick = openAdmin;
  }
  function modal(html) {
    closeModal();
    const m = document.createElement("div"); m.id = "authModal"; m.className = "authCover2"; m.dir = "rtl";
    m.innerHTML = '<div class="authBox wide">' + html + '<div style="margin-top:12px"><button type="button" id="mdClose">סגור</button></div></div>';
    document.body.appendChild(m); $("mdClose").onclick = closeModal;
    return m;
  }
  function closeModal() { const m = $("authModal"); if (m) m.remove(); }

  function openPassword() {
    modal('<h2>החלפת סיסמה</h2><form id="pwForm"><label class="f"><b>סיסמה נוכחית</b><input id="pwOld" type="password" autocomplete="current-password" dir="ltr"></label>' +
      '<label class="f"><b>סיסמה חדשה (לפחות 10 תווים)</b><input id="pwNew" type="password" autocomplete="new-password" dir="ltr"></label>' +
      '<label class="f"><b>סיסמה חדשה שוב</b><input id="pwNew2" type="password" autocomplete="new-password" dir="ltr"></label>' +
      '<div class="err" id="pwErr"></div><button class="primary" type="submit">החלף</button></form>');
    $("pwForm").onsubmit = async ev => {
      ev.preventDefault(); $("pwErr").textContent = "";
      if ($("pwNew").value !== $("pwNew2").value) { $("pwErr").textContent = "הסיסמאות החדשות אינן זהות."; return; }
      const r = await call("changePassword", { oldPass: $("pwOld").value, newPass: $("pwNew").value });
      if (!r.ok) { $("pwErr").textContent = msg(r); return; }
      A.token = r.token; A.exp = r.exp; save(); closeModal();
      alert("הסיסמה הוחלפה. התחברויות אחרות של המשתמש נותקו.");
    };
  }

  async function openAdmin() {
    const m = modal('<h2>ניהול משתמשים</h2><div id="admBody">טוען…</div>');
    const draw = async () => {
      const r = await call("listUsers");
      const body = $("admBody"); if (!body) return;
      if (!r.ok) { body.innerHTML = '<div class="err">' + esc(msg(r)) + "</div>"; return; }
      const fmt = t => t ? new Date(t).toLocaleString("he-IL") : "—";
      body.innerHTML = '<table class="admTbl"><tr><th>משתמש</th><th>תפקיד</th><th>מצב</th><th>כניסה אחרונה</th><th>פעולות</th></tr>' +
        r.users.map(u => '<tr><td dir="ltr">' + esc(u.user) + '</td><td>' + (u.role === "admin" ? "מנהל" : "משתמש") + '</td><td>' + (u.blocked ? '<b class="err">חסום</b>' : "פעיל") + '</td><td>' + esc(fmt(u.lastLogin)) + '</td><td>' +
          (u.user === A.user ? "—" : '<button type="button" data-blk="' + esc(u.user) + '" data-to="' + (u.blocked ? 0 : 1) + '">' + (u.blocked ? "בטל חסימה" : "חסום") + '</button> <button type="button" data-rst="' + esc(u.user) + '">איפוס סיסמה</button> <button type="button" data-del="' + esc(u.user) + '">מחק</button>') + '</td></tr>').join("") + "</table>" +
        '<h3 style="margin:14px 0 6px">הוספת משתמש</h3><form id="addForm" class="row"><input id="adU" type="text" placeholder="שם משתמש" dir="ltr" autocomplete="off" style="flex:1 1 160px"><input id="adP" type="password" placeholder="סיסמה זמנית (10+ תווים)" dir="ltr" autocomplete="new-password" style="flex:1 1 180px"><label class="small"><input type="checkbox" id="adA"> מנהל</label><button class="primary" type="submit">הוסף</button></form>' +
        '<h3 style="margin:14px 0 6px">איפוס סיסמה</h3><form id="rstForm" class="row"><input id="rsU" type="text" placeholder="שם משתמש" dir="ltr" autocomplete="off" style="flex:1 1 160px"><input id="rsP" type="password" placeholder="סיסמה חדשה (10+ תווים)" dir="ltr" autocomplete="new-password" style="flex:1 1 180px"><button type="submit">אפס</button></form><div class="err" id="admErr"></div>';
      const fail = rr => { $("admErr").textContent = msg(rr); };
      body.querySelectorAll("[data-blk]").forEach(b => b.onclick = async () => { const rr = await call("setBlocked", { target: b.dataset.blk, blocked: b.dataset.to === "1" }); rr.ok ? draw() : fail(rr); });
      body.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => { if (!confirm("למחוק את המשתמש " + b.dataset.del + "?")) return; const rr = await call("deleteUser", { target: b.dataset.del }); rr.ok ? draw() : fail(rr); });
      body.querySelectorAll("[data-rst]").forEach(b => b.onclick = () => { $("rsU").value = b.dataset.rst; $("rsP").focus(); });
      $("addForm").onsubmit = async ev => { ev.preventDefault(); const rr = await call("addUser", { newUser: $("adU").value.trim(), newPass: $("adP").value, role: $("adA").checked ? "admin" : "user" }); rr.ok ? draw() : fail(rr); };
      $("rstForm").onsubmit = async ev => { ev.preventDefault(); const rr = await call("resetPassword", { target: $("rsU").value.trim(), newPass: $("rsP").value }); if (rr.ok) { draw(); } else fail(rr); };
    };
    draw();
    return m;
  }

  /* ---------- ממשק ציבורי ---------- */
  A.init = async function (cfg) {
    A.cfg = cfg || {};
    document.body.classList.add("authLocked");
    if (A.cfg.api_url && restore()) {
      try {
        const r = await post({ action: "me", token: A.token });
        if (r.ok) { A.user = r.user; A.role = r.role; hideCover(); renderBar(); document.dispatchEvent(new CustomEvent("req-auth", { detail: { user: A.user, role: A.role } })); return; }
      } catch (e) { /* אין רשת — מציגים כניסה */ }
      clear();
    }
    renderBar();
    await showCover();
  };
  A.loggedIn = () => !!A.token && A.exp > Date.now();
  A.user_ = () => A.user;
  A.call = call;
  A.msg = msg;
  A.logout = logout;
  A.show = () => showCover();
  window.ReqAuth = A;
})();
