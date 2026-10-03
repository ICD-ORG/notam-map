/* שער כניסה לחברי הארגון הישראלי לרחפנים (ICD) — מפת א-17.
   האפליקציה נפתחת רק עם "כרטיס כניסה" שמונפק על ידי עמוד החברים באתר הארגון (Wix) — עבור חבר מחובר בלבד.
   מצבים (CFG.MODE): 'off' = לא עושה כלום | 'soft' = הודעה בלבד, בלי חסימה | 'trial' = 5 כניסות חינם ואז חסימה | 'enforce' = חסימה.
   לבדיקה בלי לשנות את המצב: להוסיף לכתובת ?gatetest=soft | trial | enforce */
(function () {
  var CFG = {
    MODE: 'off',                                                 // off | soft | trial | enforce
    MAX_FREE: 5,                                                 // במצב trial: כמה כניסות חינם (לכל מכשיר) לפני חסימה
    FREE_KEY: 'icdGateFree',
    VERIFY_URL: 'https://www.icd.org.il/_functions/verify',      // נקודת אימות ב-Wix (http-functions.js)
    LOGIN_URL: 'https://www.icd.org.il/notam1',                  // לאן שולחים מי שאין לו כרטיס: כניסה/הרשמה/תשלום
    PARENT_ORIGINS: ['https://www.icd.org.il', 'https://icd.org.il'],
    KEY: 'icdGateTicket',
    WAIT_MS: 7000
  };
  var tm = /[?&]gatetest=(soft|trial|enforce)\b/.exec(location.search);
  var mode = tm ? tm[1] : CFG.MODE;
  if (mode === 'off') return;

  var decided = false, ui = null, freeLeft = null;
  function b64uJson(s) { try { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return JSON.parse(decodeURIComponent(escape(atob(s)))); } catch (e) { return null; } }
  function validLocal(t) { var p = t && t.indexOf('.') > 0 ? b64uJson(t.split('.')[0]) : null; return !!(p && p.exp > Date.now()); }
  function store(t) { try { localStorage.setItem(CFG.KEY, t); } catch (e) {} }
  function load() { try { return localStorage.getItem(CFG.KEY) || ''; } catch (e) { return ''; } }
  /* כניסה חינם נספרת פעם אחת לכל לשונית/סשן; אם האחסון חסום — לא חוסמים (נכשלים פתוח) */
  function freeCount() {
    var n = 0;
    try {
      n = parseInt(localStorage.getItem(CFG.FREE_KEY) || '0', 10) || 0;
      if (!sessionStorage.getItem(CFG.FREE_KEY)) { n++; localStorage.setItem(CFG.FREE_KEY, String(n)); sessionStorage.setItem(CFG.FREE_KEY, '1'); }
    } catch (e) {}
    return n;
  }
  function clear() { try { localStorage.removeItem(CFG.KEY); } catch (e) {} }

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

  function hideUi() { if (ui && ui.parentNode) ui.parentNode.removeChild(ui); ui = null; }
  function showUi() {
    if (ui) return;
    ui = document.createElement('div'); ui.id = 'icdGate'; ui.setAttribute('role', 'dialog'); ui.dir = 'rtl';
    var hard = mode === 'enforce';
    ui.style.cssText = hard
      ? 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483000;background:rgba(8,16,28,.97);color:#e9eff9;display:flex;align-items:center;justify-content:center;padding:20px;font-family:system-ui,Arial,sans-serif;text-align:center'
      : 'position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483000;background:#13223a;color:#e9eff9;border:1px solid #2b4263;border-radius:12px;padding:12px 14px;font:14px/1.5 system-ui,Arial,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.5);display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:center';
    var a = '<a href="' + CFG.LOGIN_URL + '" target="_top" rel="noopener" style="display:inline-block;min-height:44px;line-height:44px;padding:0 18px;border-radius:10px;background:#ffb347;color:#1a1200;font-weight:700;text-decoration:none">כניסה לחברים / הצטרפות</a>';
    ui.innerHTML = hard
      ? '<div style="max-width:420px"><div style="font-size:20px;font-weight:700;margin-bottom:8px">מפת א-17 — לחברי הארגון בלבד</div><div style="margin-bottom:16px;opacity:.9">הגישה למפה פתוחה לחברי הארגון הישראלי לרחפנים. הכניסה דרך אתר הארגון, לאחר הרשמה ותשלום.</div>' + a + '</div>'
      : '<span>' + (freeLeft === null ? 'הגישה למפה תהיה בקרוב לחברי הארגון בלבד — מומלץ להיכנס דרך אתר הארגון.' : 'כניסה חינם למפה — נותרו ' + freeLeft + ' מתוך ' + CFG.MAX_FREE + '. להמשך שימוש: כניסה לחברים או הצטרפות.') + '</span>' + a + '<button type="button" id="icdGateX" style="min-height:44px;min-width:44px;border:0;border-radius:10px;background:transparent;color:#e9eff9;font-size:18px;cursor:pointer" aria-label="סגור">✕</button>';
    (document.body || document.documentElement).appendChild(ui);
    var x = document.getElementById('icdGateX'); if (x) x.onclick = hideUi;
  }

  function grant(t) { decided = true; store(t); hideUi(); }
  function deny() {
    if (decided) return; decided = true; clear();
    if (mode === 'trial') {
      var n = freeCount();
      if (n > CFG.MAX_FREE) mode = 'enforce'; else { freeLeft = CFG.MAX_FREE - n; mode = 'soft'; }
    }
    showUi();
  }

  function awaitFromParent() {
    var inFrame = window.parent && window.parent !== window;
    if (!inFrame) { deny(); return; }
    function onMsg(e) {
      if (CFG.PARENT_ORIGINS.indexOf(e.origin) < 0) return;
      var d = e.data; if (!d || d.type !== 'icd-ticket' || typeof d.ticket !== 'string') return;
      verify(d.ticket).then(function (ok) { if (ok) { grant(d.ticket); window.removeEventListener('message', onMsg); } });
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
    var t = load();
    if (t) verify(t).then(function (ok) { if (ok) { decided = true; } else { clear(); awaitFromParent(); } });
    else awaitFromParent();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
