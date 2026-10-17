/* התחברות נפרדת לבקשות טיסה: שם משתמש וסיסמה מול שרת Apps Script (apps-script/Code.gs).
   האכיפה בשרת: חסימת משתמש, החלפת סיסמה ופקיעת אסימון נבדקות בכל קריאה, ושמירה לדרייב אפשרית רק עם אסימון תקף.
   מסך הכניסה כאן הוא ממשק בלבד — הוא מסתיר את הטופס, אך את הדף עצמו לא ניתן "לנעול" באתר סטטי. */
(function () {
  "use strict";
  const KEY = "icdReqSession";
  const A = { cfg: null, token: "", user: "", role: "", exp: 0, mode: "login", mailMode: "test", mailTo: [], busy: false, until: null };
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const ERR = {
    bad_login: "שם משתמש או סיסמה שגויים.", locked: "יותר מדי ניסיונות כושלים — נסו שוב בעוד כרבע שעה.", blocked: "המשתמש חסום מבקשות טיסה. יש לפנות למנהל המערכת.",
    expired: "פג תוקף ההתחברות — יש להתחבר מחדש.", auth: "ההתחברות אינה תקפה — יש להתחבר מחדש.", weak_pass: "הסיסמה קצרה מדי (לפחות 10 תווים).",
    bad_user: "שם משתמש לא תקין (3–40 תווים: אותיות, ספרות, נקודה, מקף).", exists: "המשתמש כבר קיים.", no_user: "המשתמש לא נמצא.", self: "לא ניתן לבצע פעולה זו על המשתמש שלך.",
    forbidden: "הפעולה מותרת למנהל בלבד.", bad_code: "הקוד שגוי או שפג תוקפו.", no_setup: "המערכת אינה במצב הקמה.", busy: "השרת עסוק, נסו שוב.", bad_folder: "התיקייה בדרייב אינה תקפה.",
    bad_file: "הקובץ גדול מדי או ריק.", already_sent: "הבקשה כבר נשלחה.", missing_files: "חסר קובץ Word או תמונת מפה/תצ״א בתיקייה — יש לשמור שוב בדרייב.", rate: "יותר מדי שליחות בשעה האחרונה — נסו שוב מאוחר יותר.", bad_mail: "נושא או גוף המייל ריקים.", no_owner: "לא ניתן לזהות את כתובת הבעלים לשליחת בדיקה.", too_big: "הקבצים גדולים מדי לשליחה במייל (מעל 24MB).", sub_expired: "המנוי הסתיים. לחידוש יש לרכוש כרטיס חדש ואז ללחוץ כאן על ״הרשמה / חידוש מנוי״.", bad_email: "כתובת המייל אינה תקינה.", no_ticket: "לא נמצא כרטיס ששולם עבור הכתובת הזו (או שכבר נוצל).", need_credentials: "יש לבחור שם משתמש וסיסמה.",
    ticket_expired: "הכרטיס ישן מדי (מעבר לתקופת המנוי) — יש לרכוש כרטיס חדש.", not_configured: "ההרשמה עדיין לא הופעלה במערכת. יש לפנות למשרד הארגון.", wix_down: "לא ניתן לאמת כרגע את הכרטיס מול האתר — נסו שוב בעוד כמה דקות.", bad_date: "תאריך לא תקין (YYYY-MM-DD).", bad_name: "שם התיקייה אינו תקין.", bad_rid: "מזהה הבקשה אינו תקין — רעננו את הדף.", not_ready: "הבקשה לא נשמרה בשרת כמוכנה לשליחה — יש להשלים את הבדיקות ולשמור שוב בדרייב.", mode_changed: "מצב השליחה בשרת השתנה.", server: "שגיאת שרת.", bad_request: "בקשה לא תקינה.", bad_action: "פעולה לא מוכרת."
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
    if (!res.ok && (res.error === "auth" || res.error === "expired" || res.error === "blocked" || res.error === "sub_expired")) { logout(); showCover(msg(res)); }
    return res;
  }
  function logout() { clear(); closeModal(); renderBar(); showCover(); }

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
      '<div class="err" id="auErr">' + esc(note || "") + '</div><button class="primary" id="auGo" type="submit">' + (boot ? "הקם מנהל והיכנס" : "כניסה") + '</button>' +
      (boot ? "" : '<button type="button" class="linkBtn" id="auReg">מטיס מסחרי? הרשמה / חידוש מנוי</button>') + '</form>';
    if ($("auReg")) $("auReg").onclick = () => showRegister();
    $("authForm").onsubmit = async ev => {
      ev.preventDefault();
      const btn = $("auGo"); btn.disabled = true; $("auErr").textContent = "";
      try {
        const body = boot ? { action: "bootstrap", code: $("auCode").value.trim(), user: $("auUser").value.trim(), pass: $("auPass").value } : { action: "login", user: $("auUser").value.trim(), pass: $("auPass").value };
        const r = await post(body);
        if (!r.ok) { if (r.error === "sub_expired") expiredNote(r); else $("auErr").textContent = msg(r); btn.disabled = false; return; }
        A.token = r.token; A.user = r.user; A.role = r.role; A.exp = r.exp; A.until = r.until || null; A.mailMode = r.mailMode || "test"; A.mailTo = r.mailTo || []; save();
        hideCover(); renderBar();
        document.dispatchEvent(new CustomEvent("req-auth", { detail: { user: A.user, role: A.role } }));
      } catch (e) { $("auErr").textContent = "אין חיבור לשרת ההתחברות. נסו שוב."; btn.disabled = false; }
    };
    const u = $("auUser"); if (u) u.focus();
  }

  const fmtD = t => t ? new Date(t).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" }) : "";
  const renewUrl = () => (A.cfg && A.cfg.renew_url) || "";
  const renewLink = () => renewUrl() ? ' <a href="' + esc(renewUrl()) + '" target="_blank" rel="noopener">לרכישת כרטיס</a>' : "";
  function expiredNote(r) {
    $("auErr").innerHTML = esc("המנוי הסתיים" + (r && r.until ? " ב-" + fmtD(r.until) : "") + ". לחידוש: רוכשים כרטיס חדש, ואז לוחצים על ״הרשמה / חידוש מנוי״ ומקלידים את המייל שבו קנו.") + renewLink();
  }
  /* ---------- הרשמה וחידוש מנוי: רק למי שרכש כרטיס "בקשת אישורי טיסה" ששולם. שלבים: מייל -> קוד למייל -> שם משתמש וסיסמה ---------- */
  function showRegister(email) {
    document.body.classList.add("authLocked");
    const c = cover();
    c.innerHTML = '<form class="authBox" id="regForm" autocomplete="on"><h2>הרשמה / חידוש מנוי</h2>' +
      '<p class="small">לבקשות טיסה נכנסים מטיסים מסחריים (מפעילים אוויריים) שרכשו באתר הארגון את הכרטיס ״בקשת אישורי טיסה״.' + renewLink() + '<br>הקלידו את המייל שבו רכשתם את הכרטיס — נשלח אליו קוד אימות. אחרי האימות בוחרים שם משתמש וסיסמה משלכם.</p>' +
      '<label class="f"><b>מייל הרכישה</b><input id="rgEmail" type="email" autocomplete="email" dir="ltr" value="' + esc(email || "") + '"></label>' +
      '<button type="button" id="rgSend">שלחו לי קוד</button><div class="small" id="rgInfo" role="status"></div>' +
      '<div id="rgStep2" style="display:none"><label class="f"><b>קוד מהמייל (6 ספרות)</b><input id="rgCode" inputmode="numeric" autocomplete="one-time-code" dir="ltr" maxlength="8"></label>' +
      '<label class="f"><b>שם משתמש</b><input id="rgUser" type="text" autocomplete="username" dir="ltr"></label>' +
      '<label class="f"><b>סיסמה (לפחות 10 תווים)</b><input id="rgPass" type="password" autocomplete="new-password" dir="ltr"></label>' +
      '<p class="small">אם כבר נרשמתם בעבר ואתם רק מחדשים מנוי — השאירו שם משתמש וסיסמה ריקים.</p>' +
      '<button class="primary" id="rgGo" type="submit">אישור</button></div>' +
      '<div class="err" id="rgErr"></div><button type="button" class="linkBtn" id="rgBack">חזרה לכניסה</button></form>';
    $("rgBack").onclick = () => showCover();
    $("rgSend").onclick = async () => {
      $("rgErr").textContent = ""; $("rgInfo").textContent = "";
      const btn = $("rgSend"); btn.disabled = true;
      try {
        const r = await post({ action: "regStart", email: $("rgEmail").value.trim() });
        if (!r.ok) { $("rgErr").textContent = msg(r); return; }
        $("rgInfo").textContent = "אם נמצא כרטיס ששולם עבור הכתובת הזו — נשלח אליה קוד (תקף ל-15 דקות). לא הגיע? בדקו בספאם, ושהקלדתם את המייל שבו רכשתם.";
        $("rgStep2").style.display = "block"; $("rgCode").focus();
      } catch (e) { $("rgErr").textContent = "אין חיבור לשרת. נסו שוב."; } finally { btn.disabled = false; }
    };
    $("regForm").onsubmit = async ev => {
      ev.preventDefault(); $("rgErr").textContent = "";
      const btn = $("rgGo"); btn.disabled = true;
      try {
        const r = await post({ action: "regFinish", email: $("rgEmail").value.trim(), code: $("rgCode").value.trim(), user: $("rgUser").value.trim(), pass: $("rgPass").value });
        if (!r.ok) { $("rgErr").textContent = msg(r); return; }
        if (r.renewed) { showCover("המנוי חודש עד " + fmtD(r.until) + ". אפשר להיכנס."); return; }
        A.token = r.token; A.user = r.user; A.role = r.role; A.exp = r.exp; A.until = r.until || null; A.mailMode = r.mailMode || "test"; A.mailTo = r.mailTo || []; save();
        hideCover(); renderBar();
        document.dispatchEvent(new CustomEvent("req-auth", { detail: { user: A.user, role: A.role } }));
      } catch (e) { $("rgErr").textContent = "אין חיבור לשרת. נסו שוב."; } finally { btn.disabled = false; }
    };
    $("rgEmail").focus();
  }

  /* ---------- שורת משתמש, החלפת סיסמה וניהול משתמשים ---------- */
  function renderBar() {
    let bar = $("userBar");
    if (!bar) { bar = document.createElement("div"); bar.id = "userBar"; bar.className = "userBar"; const w = document.querySelector("header .wrap"); (w || document.body).appendChild(bar); }
    if (!A.token) { bar.innerHTML = ""; return; }
    const daysLeft = A.until ? Math.ceil((A.until - Date.now()) / 86400000) : null;
    bar.innerHTML = '<span>מחובר: <b>' + esc(A.user) + '</b>' + (A.role === "admin" ? " (מנהל)" : "") + '</span> ' +
      (A.until ? '<span id="ubSub">מנוי עד ' + esc(fmtD(A.until)) + (daysLeft <= 30 ? ' — <b>מסתיים בעוד ' + daysLeft + ' ימים</b>' + renewLink() : "") + '</span> ' : "") +
      '<button type="button" id="ubPass">החלפת סיסמה</button>' + (A.role === "admin" ? ' <button type="button" id="ubAdmin">ניהול משתמשים</button>' : "") + ' <button type="button" id="ubOut">התנתק</button>';
    $("ubPass").onclick = openPassword; $("ubOut").onclick = logout;
    if (A.role === "admin") $("ubAdmin").onclick = openAdmin;
  }
  function modal(html) {
    if (A.busy) return null;     // באמצע שמירה/שליחה לא מחליפים את החלון הפתוח
    closeModal();
    const m = document.createElement("div"); m.id = "authModal"; m.className = "authCover2"; m.dir = "rtl";
    m.innerHTML = '<div class="authBox wide">' + html + '<div style="margin-top:12px"><button type="button" id="mdClose">סגור</button></div></div>';
    document.body.appendChild(m); $("mdClose").onclick = closeModal;
    return m;
  }
  function closeModal() { const m = $("authModal"); if (m) m.remove(); }

  function openPassword() {
    if (A.busy) return;
    modal('<h2>החלפת סיסמה</h2><form id="pwForm"><label class="f"><b>סיסמה נוכחית</b><input id="pwOld" type="password" autocomplete="current-password" dir="ltr"></label>' +
      '<label class="f"><b>סיסמה חדשה (לפחות 10 תווים)</b><input id="pwNew" type="password" autocomplete="new-password" dir="ltr"></label>' +
      '<label class="f"><b>סיסמה חדשה שוב</b><input id="pwNew2" type="password" autocomplete="new-password" dir="ltr"></label>' +
      '<div class="err" id="pwErr"></div><button class="primary" type="submit">החלף</button></form>');
    $("pwForm").onsubmit = async ev => {
      ev.preventDefault(); $("pwErr").textContent = "";
      if ($("pwNew").value !== $("pwNew2").value) { $("pwErr").textContent = "הסיסמאות החדשות אינן זהות."; return; }
      const r = await call("changePassword", { oldPass: $("pwOld").value, newPass: $("pwNew").value });
      if (!r.ok) { $("pwErr").textContent = msg(r); return; }
      A.token = r.token; A.exp = r.exp; A.mailMode = r.mailMode || A.mailMode; save(); closeModal();
      alert("הסיסמה הוחלפה. התחברויות אחרות של המשתמש נותקו.");
    };
  }

  async function openAdmin() {
    if (A.busy) return null;
    const m = modal('<h2>ניהול משתמשים</h2><div id="admBody">טוען…</div>');
    let filter = "";
    const draw = async () => {
      const [r, rq] = await Promise.all([call("listUsers"), call("listRequests", { user: filter || undefined, limit: 100 })]);
      const body = $("admBody"); if (!body) return;
      if (!r.ok) { body.innerHTML = '<div class="err">' + esc(msg(r)) + "</div>"; return; }
      A.mailMode = r.mailMode || A.mailMode;
      const logWarn = r.logError ? '<div class="err" style="margin:0 0 8px"><b>יומן הבקשות לא נקרא:</b> ' + esc(r.logError) + " — השליחה והשמירה נעצרות עד שיטופל (אפשר עדיין לחסום משתמשים).</div>" : "";
      const fmt = t => t ? new Date(t).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }) : "—";
      const modeLive = A.mailMode === "live";
      body.innerHTML = logWarn +
        '<div class="admMode ' + (modeLive ? "live" : "test") + '"><b>מצב שליחה: ' + (modeLive ? "חי — למשרד נוטאם" : "בדיקה — המייל נשלח רק אליך") + '</b> ' +
        '<button type="button" id="admMode">' + (modeLive ? "העבר למצב בדיקה" : "העבר למצב חי (שליחה אמיתית למשרד נוטאם)") + '</button></div>' +
        '<h3 style="margin:12px 0 6px">משתמשים — מי הגיש בקשות</h3>' +
        '<table class="admTbl"><tr><th>משתמש</th><th>תפקיד</th><th>מצב</th><th>מייל</th><th>תוקף מנוי</th><th>בקשות שנשמרו</th><th>נשלחו למשרד נוטאם</th><th>בקשה אחרונה</th><th>כניסה אחרונה</th><th>פעולות</th></tr>' +
        r.users.map(u => '<tr' + (u.blocked ? ' class="blocked"' : "") + '><td dir="ltr"><a href="#" data-flt="' + esc(u.user) + '">' + esc(u.user) + '</a></td><td>' + (u.role === "admin" ? "מנהל" : "משתמש") + '</td><td>' + (u.blocked ? '<b class="err">חסום מבקשות</b>' + (u.blockedWhy ? ' <span class="small">(' + esc(u.blockedWhy) + ')</span>' : "") : "פעיל") + '</td><td dir="ltr">' + esc(u.email || "—") + '</td><td>' + (u.until ? (u.until < Date.now() ? '<b class="err">' + esc(fmtD(u.until)) + ' (הסתיים)</b>' : esc(fmtD(u.until))) : "ללא הגבלה") + '</td><td>' + u.requests + '</td><td>' + u.sent + '</td><td>' + esc(fmt(u.lastRequest)) + '</td><td>' + esc(fmt(u.lastLogin)) + '</td><td class="acts">' +
          (u.user === A.user ? "—" : '<button type="button" class="' + (u.blocked ? "unblock" : "block") + '" data-blk="' + esc(u.user) + '" data-to="' + (u.blocked ? 0 : 1) + '">' + (u.blocked ? "✔ פתח מחדש את הבקשות" : "🚫 חסום מבקשות") + '</button> <button type="button" data-rst="' + esc(u.user) + '">איפוס סיסמה</button> <button type="button" data-exp="' + esc(u.user) + '">שינוי תוקף</button> <button type="button" data-del="' + esc(u.user) + '">מחק</button>') + '</td></tr>').join("") + "</table>" +
        '<h3 style="margin:14px 0 6px">יומן בקשות' + (filter ? ' של <span dir="ltr">' + esc(filter) + '</span> <a href="#" id="admAll">(הצג את כולם)</a>' : " — כל המשתמשים") + '</h3>' +
        (rq.ok && rq.requests.length ? '<table class="admTbl"><tr><th>נשמרה</th><th>משתמש</th><th>בקשה</th><th>סטטוס</th><th>תיקייה</th></tr>' +
          rq.requests.map(x => '<tr><td>' + esc(fmt(x.saved)) + '</td><td dir="ltr">' + esc(x.user) + (x.lastUser && x.lastUser !== x.user ? " ← " + esc(x.lastUser) : "") + '</td><td>' + esc(x.name) + '</td><td>' +
            (x.sentLive ? "✔ נשלחה למשרד נוטאם" + (x.sentLive > 1 ? " (" + x.sentLive + " פעמים)" : "") + (x.lastSent ? " · " + esc(fmt(x.lastSent.t)) : "") : x.sentTest ? "נשלחה לבדיקה בלבד" : "נשמרה, לא נשלחה") + '</td><td><a href="' + esc(x.url) + '" target="_blank" rel="noopener">פתח</a></td></tr>').join("") + "</table>"
          : '<div class="small">' + (rq.ok ? "אין בקשות ביומן." : esc(msg(rq))) + "</div>") +
        '<h3 style="margin:14px 0 6px">הוספת משתמש</h3><form id="addForm" class="row"><input id="adU" type="text" placeholder="שם משתמש" dir="ltr" autocomplete="off" style="flex:1 1 160px"><input id="adP" type="password" placeholder="סיסמה זמנית (10+ תווים)" dir="ltr" autocomplete="new-password" style="flex:1 1 180px"><label class="small"><input type="checkbox" id="adA"> מנהל</label><button class="primary" type="submit">הוסף</button></form>' +
        '<h3 style="margin:14px 0 6px">איפוס סיסמה</h3><form id="rstForm" class="row"><input id="rsU" type="text" placeholder="שם משתמש" dir="ltr" autocomplete="off" style="flex:1 1 160px"><input id="rsP" type="password" placeholder="סיסמה חדשה (10+ תווים)" dir="ltr" autocomplete="new-password" style="flex:1 1 180px"><button type="submit">אפס</button></form><div class="err" id="admErr"></div>' +
        '<h3 style="margin:14px 0 6px">בדיקת כרטיס באתר (אבחון)</h3><form id="wxForm" class="row"><input id="wxE" type="email" placeholder="מייל הרכישה" dir="ltr" autocomplete="off" style="flex:1 1 220px"><button type="submit">בדוק</button></form><div class="small" id="wxOut"></div>';
      const fail = rr => { $("admErr").textContent = msg(rr); };
      body.querySelectorAll("[data-blk]").forEach(b => b.onclick = async () => { const rr = await call("setBlocked", { target: b.dataset.blk, blocked: b.dataset.to === "1" }); rr.ok ? draw() : fail(rr); });
      body.querySelectorAll("[data-exp]").forEach(b => b.onclick = async () => {
        const v = prompt("תאריך סיום המנוי של " + b.dataset.exp + " (YYYY-MM-DD). ריק = ללא הגבלה:", ""); if (v === null) return;
        const rr = await call("setExpiry", { target: b.dataset.exp, until: v.trim() }); rr.ok ? draw() : fail(rr);
      });
      body.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => { if (!confirm("למחוק את המשתמש " + b.dataset.del + "?")) return; const rr = await call("deleteUser", { target: b.dataset.del }); rr.ok ? draw() : fail(rr); });
      body.querySelectorAll("[data-rst]").forEach(b => b.onclick = () => { $("rsU").value = b.dataset.rst; $("rsP").focus(); });
      body.querySelectorAll("[data-flt]").forEach(b => b.onclick = ev => { ev.preventDefault(); filter = b.dataset.flt; draw(); });
      if ($("admAll")) $("admAll").onclick = ev => { ev.preventDefault(); filter = ""; draw(); };
      $("admMode").onclick = async () => {
        const toLive = !modeLive;
        if (toLive && !confirm("מעכשיו כל בקשה שתישלח תישלח באמת למשרד נוטאם (notamoffice@iaa.gov.il, nofm@iaa.gov.il). להמשיך?")) return;
        const rr = await call("setMailMode", { mode: toLive ? "live" : "test" }); rr.ok ? draw() : fail(rr);
      };
      $("addForm").onsubmit = async ev => { ev.preventDefault(); const rr = await call("addUser", { newUser: $("adU").value.trim(), newPass: $("adP").value, role: $("adA").checked ? "admin" : "user" }); rr.ok ? draw() : fail(rr); };
      $("wxForm").onsubmit = async ev => {
        ev.preventDefault(); $("wxOut").textContent = "בודק…";
        const rr = await call("wixCheck", { email: $("wxE").value.trim() });
        if (!rr.ok) { $("wxOut").textContent = msg(rr); return; }
        $("wxOut").textContent = rr.orders.length ? rr.orders.map(o => "הזמנה " + o.orderNumber + " · " + fmtD(o.created) + " · " + (o.member ? "חבר רשום" : "לא חבר רשום באתר") + " · " + (o.used ? "נוצלה ע״י " + o.by : o.eligible ? "זכאית להרשמה" : "לא זכאית")).join(" | ") + (rr.account ? " · חשבון קיים: " + rr.account : "") : "לא נמצאה הזמנה ששולמה למייל הזה באירוע.";
      };
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
        if (r.ok) { A.user = r.user; A.role = r.role; A.until = r.until || null; A.mailMode = r.mailMode || "test"; A.mailTo = r.mailTo || []; hideCover(); renderBar(); document.dispatchEvent(new CustomEvent("req-auth", { detail: { user: A.user, role: A.role } })); return; }
      } catch (e) { /* אין רשת — מציגים כניסה */ }
      clear();
    }
    renderBar();
    await showCover();
  };
  A.loggedIn = () => !!A.token && A.exp > Date.now();
  A.getMailMode = () => A.mailMode;
  A.getMailTo = () => A.mailTo;
  A.setMailModeValue = m => { A.mailMode = m === "live" ? "live" : "test"; };
  A.setBusy = b => { A.busy = !!b; };
  // מרענן מהשרת את מצב השליחה והנמענים (ואת תקפות ההתחברות); נכשל סגור — בלי תשובה תקינה אין שליחה
  A.refresh = async () => {
    try {
      const r = await call("me");
      if (r.ok) { A.mailMode = r.mailMode === "live" ? "live" : "test"; A.mailTo = r.mailTo || []; A.user = r.user; A.role = r.role; A.until = r.until || null; }
      return r;
    } catch (e) { return { ok: false, error: "network", message: "אין חיבור לשרת" }; }
  };
  A.modal = html => modal(html);
  A.closeModal = closeModal;
  A.user_ = () => A.user;
  A.call = call;
  A.msg = msg;
  A.logout = logout;
  A.show = () => showCover();
  window.ReqAuth = A;
})();
