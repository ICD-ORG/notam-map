/* שער כניסה לחברי הארגון הישראלי לרחפנים (ICD) — מפת א-17.
   האפליקציה נפתחת רק עם "כרטיס כניסה" שמונפק באתר הארגון (Wix) לחבר מחובר ששילם.
   מי שנכנס בקישור ישיר בלי כרטיס מועבר אוטומטית לאתר הארגון (notam1?go=app): חבר ששילם חוזר למפה עם כרטיס,
   מי שלא שילם מועבר שם לדף ההצטרפות והתשלום. אין כניסות חינם ואין הודעות נוספות.
   מצבים (CFG.MODE): 'off' = לא עושה כלום | 'enforce' = השער פעיל. אין עקיפה דרך הכתובת. */
(function () {
  var CFG = {
    MODE: 'enforce',                                               // off | enforce
    VERIFY_URL: 'https://www.icd.org.il/_functions/verify',      // נקודת אימות ב-Wix (http-functions.js)
    LOGIN_URL: 'https://www.icd.org.il/notam1?go=app',           // עמוד באתר שמזהה חבר ששילם ומחזיר לכאן עם כרטיס
    PARENT_ORIGINS: ['https://www.icd.org.il', 'https://icd.org.il'],
    KEY: 'icdGateTicket',
    TRY_KEY: 'icdGateGo',                                        // מונע לולאת הפניות: ניסיון הפניה אחד לדקותיים
    TRY_MS: 120000,
    OLD_KEYS: ['icdGateFree'],                                   // שארית מהגרסה הקודמת (כניסות חינם)
    WAIT_MS: 7000
  };
  var mode = CFG.MODE;
  try {
    for (var i = 0; i < CFG.OLD_KEYS.length; i++) localStorage.removeItem(CFG.OLD_KEYS[i]);
    sessionStorage.removeItem('icdGateTest');                    // שארית מגרסת בדיקה; אין דרך לעקוף את השער מהכתובת
  } catch (e) {}
  if (mode !== 'enforce') return;

  var decided = false, ui = null;
  function b64uJson(s) { try { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return JSON.parse(decodeURIComponent(escape(atob(s)))); } catch (e) { return null; } }
  function validLocal(t) { var p = t && t.indexOf('.') > 0 ? b64uJson(t.split('.')[0]) : null; return !!(p && p.exp > Date.now()); }
  function store(t) { try { localStorage.setItem(CFG.KEY, t); } catch (e) {} }
  function load() { try { return localStorage.getItem(CFG.KEY) || ''; } catch (e) { return ''; } }
  function clear() { try { localStorage.removeItem(CFG.KEY); } catch (e) {} }
  function canRedirect() { try { return Date.now() - (parseInt(sessionStorage.getItem(CFG.TRY_KEY) || '0', 10) || 0) > CFG.TRY_MS; } catch (e) { return true; } }
  function markTried() { try { sessionStorage.setItem(CFG.TRY_KEY, String(Date.now())); } catch (e) {} }
  function unmarkTried() { try { sessionStorage.removeItem(CFG.TRY_KEY); } catch (e) {} }

  /* אימות מול Wix; אם אין רשת/CORS — סומכים על תוקף הכרטיס עצמו (כדי לא לנעול חברים בזמן תקלה) */
  function verify(t) {
    if (!validLocal(t)) return Promise.resolve(false);
    return new Promise(function (resolve) {
      var done = false, c = window.AbortController ? new AbortController() : null;
      var to = setTimeout(function () { if (!done) { done = true; if (c) c.abort(); resolve(true); } }, 6000);
      fetch(CFG.VERIFY_URL + '?ticket=' + encodeURIComponent(t), c ? { signal: c.signal } : {})
        .then(function (r) { return r.json(); })
        .then(function (j) { if (!done) { done = true; clearTimeout(to); resolve(!!(j && j.ok)); } })
        .catch(function () { if (!done) { done = true; clearTimeout(to); resolve(true); } });
    });
  }

  /* מסך מלא שמכסה את המפה עד שההרשאה נבדקה (בדיקה / מעבר לאתר / חסימה) */
  function cover(html) {
    if (!ui) {
      ui = document.createElement('div'); ui.id = 'icdGate'; ui.setAttribute('role', 'dialog'); ui.dir = 'rtl';
      ui.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483000;background:rgba(8,16,28,.97);color:#e9eff9;display:flex;align-items:center;justify-content:center;padding:20px;font-family:system-ui,Arial,sans-serif;text-align:center';
      (document.body || document.documentElement).appendChild(ui);
    }
    ui.innerHTML = '<div style="max-width:420px">' + html + '</div>';
  }
  function hideUi() { if (ui && ui.parentNode) ui.parentNode.removeChild(ui); ui = null; }
  function blockedScreen() {
    cover('<div style="font-size:22px;font-weight:700;margin-bottom:10px;line-height:1.4">ברוכים הבאים למפת נוט"מ ולפמ"ת מתורגמים לעברית</div>' +
      '<div style="font-size:16px;margin-bottom:14px;opacity:.9;line-height:1.5">של הארגון הישראלי לרחפנים לרב להב<br>בית הספר הארצי לרחפנים</div>' +
      '<div style="margin-bottom:18px;opacity:.9;line-height:1.5">הכניסה דרך אתר הארגון (ICD), לאחר הרשמה ותשלום של 25 שקלים לשנה</div>' +
      '<a href="' + CFG.LOGIN_URL + '" target="_top" rel="noopener" style="display:inline-block;min-height:44px;line-height:44px;padding:0 18px;border-radius:10px;background:#ffb347;color:#1a1200;font-weight:700;text-decoration:none">כניסה לחברים / הצטרפות</a>');
  }

  function grant(t) { decided = true; store(t); unmarkTried(); hideUi(); }
  /* אין כרטיס תקף: בקישור ישיר — הפניה אוטומטית לאתר (פעם אחת); בתוך עמוד באתר או אחרי ניסיון שכבר נעשה — מסך חסימה */
  function deny(noRedirect) {
    if (decided) return; decided = true; clear();
    var inTop = !(window.parent && window.parent !== window);
    if (inTop && !noRedirect && canRedirect()) {
      markTried();
      cover('<div style="font-size:18px;font-weight:700">מעביר לאתר הארגון לזיהוי…</div>');
      location.replace(CFG.LOGIN_URL);
      return;
    }
    blockedScreen();
  }

  function awaitFromParent() {
    var inFrame = window.parent && window.parent !== window;
    if (!inFrame) { deny(); return; }
    function onMsg(e) {
      if (CFG.PARENT_ORIGINS.indexOf(e.origin) < 0) return;
      var d = e.data; if (!d || d.type !== 'icd-ticket' || typeof d.ticket !== 'string') return;
      verify(d.ticket).then(function (ok) { if (ok && !decided) { grant(d.ticket); window.removeEventListener('message', onMsg); } });
    }
    window.addEventListener('message', onMsg);
    var n = 0, iv = setInterval(function () {
      if (decided) { clearInterval(iv); return; }
      try { window.parent.postMessage({ type: 'icd-need-ticket' }, '*'); } catch (e) {}
      if (++n * 1000 >= CFG.WAIT_MS) { clearInterval(iv); if (!decided) deny(); }
    }, 1000);
    try { window.parent.postMessage({ type: 'icd-need-ticket' }, '*'); } catch (e) {}
  }

  function start() {
    cover('<div style="font-size:18px;font-weight:700">בודק הרשאת כניסה…</div>');
    /* כרטיס בכתובת (#t=...) — מגיע מאתר הארגון אחרי זיהוי: נשמר ומוסר מהכתובת */
    var hm = /[#&]t=([^&]+)/.exec(location.hash);
    if (hm) {
      var ht = ''; try { ht = decodeURIComponent(hm[1]); } catch (e) {}
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
      if (ht) { verify(ht).then(function (ok) { if (ok) grant(ht); else deny(true); }); return; }
    }
    startNormal();
  }
  function startNormal() {
    var t = load();
    if (t) verify(t).then(function (ok) { if (ok) grant(t); else { clear(); awaitFromParent(); } });
    else awaitFromParent();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
