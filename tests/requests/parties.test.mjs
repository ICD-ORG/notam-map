// בדיקות יחידה למנוע "דיווח לגורמים נוספים" (js/parties.js) — בלי DOM. נתוני אמת קפואים: tests/fixtures/golden-contacts.json (לא zones.json החי) + selftest של חמשת האתרים.
// הרצה: node --test tests/requests/parties.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { contactsOf } from "../../scripts/export-zones.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const P = require(path.join(ROOT, "members-k38p/requests/js/parties.js"));
const C = require(path.join(ROOT, "members-k38p/requests/js/core.js"));
const J = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const G = J("tests/fixtures/golden-contacts.json");
// אזור מהנתונים הקפואים (כרטיס המפה הקפוא דרך המייצא האמיתי) — כך שהבדיקות על שיוך פרטי הקשר אינן תלויות בעדכוני הפמ״ת ב-zones.json החי
const B09REF = { "302": "נספח ב'-1, עמ' 10 בפרק ב-09, עדכון 1/26", "401 א": "נספח ב'-2, עמ' 13 בפרק ב-09, עדכון 1/26" };
const fz = (id, cat, extra) => { const z = Object.assign({ id, cat, pmt: G.pmt[id], pmtRef: "עמ' 1, עדכון 1/26" }, extra || {}); if (G.cards[id]) z.contacts = contactsOf(G.cards[id], id); else if (B09REF[id]) z.contacts = P.quoteEntries(G.pmt[id], { ref: B09REF[id], scope: "zone" }); return z; };
const fzRec = (id, cat, extra) => { const z = fz(id, cat, extra); return zrec({ id, cat, label: id, pmt: z.pmt, pmtRef: z.pmtRef, coord: z.coord || "", src: /^B09/.test(cat) ? "b09" : "a17", z }); };
const cfg = J("members-k38p/requests/config.json"), exp = J("members-k38p/requests/selftest/expected.json");
const zones = J("members-k38p/data/zones.json"), inpa = J("members-k38p/data/inpa-zones.json"), agri = J("members-k38p/data/agri-airstrips.json"), snap = J("members-k38p/requests/selftest/notam-data.snap.json");
const NOW = new Date(exp.now);
const JO = p => { try { return J(p); } catch (e) { return { elements: [] }; } };   // בגולן אין far/reverse שמורים (כמו בבדיקות הליבה)
const fixture = n => ({ near: JO(`members-k38p/requests/selftest/${n}/near.json`), far: JO(`members-k38p/requests/selftest/${n}/far.json`), ext: JO(`members-k38p/requests/selftest/${n}/ext.json`), reverse: JO(`members-k38p/requests/selftest/${n}/reverse.json`) });
const baseInput = Object.assign({}, exp.input, { purpose: cfg.purposes[0], aircraft: [cfg.aircraft[0]], vlos: true, siteName: "בדיקה", requesterName: "בודק", requesterPhone: "050-0000000", requesterOrg: "חברה", contacts: [] });
const SITES = { yarkon: [32.099128, 34.816617, 200], hula: [33.09, 35.6, 300], metula: [33.279, 35.578, 100], nitzana: [30.887, 34.424, 100], golan: [33.1, 35.82, 100] };
const siteData = n => Object.assign({ zones, inpa, agri, notams: snap.notams, notamFetchedIso: snap.fetched_iso }, fixture(n));
const siteRes = (n, data) => { const [lat, lon, radius] = SITES[n]; return C.analyze(Object.assign({}, baseInput, { lat, lon, radius }), data, cfg, NOW); };
const siteRows = n => { const data = siteData(n); return P.build(siteRes(n, data), cfg, data); };
const display = ps => ps.map(p => p.display);
const texts = ps => ps.map(p => p.text);

/* ---------- עזרים לנתונים סינתטיים ---------- */
const zrec = (o) => Object.assign({ id: "LLX1", name: "בדיקה", cat: "LLP", src: "a17", kind: "אזור אסור לטיסה (LLP)", d: 0, edge: 0, pmt: "", pmtRef: "עמ' 1", coord: "", label: "LLX1 ״בדיקה״", z: {} }, o);
const mkRes = o => Object.assign({ R: 100, zones: { inside: [], near: [], excluded: [] }, notams: { hits: [], obstacles: [] }, agri: [], airfields: [], nearScan: { items: [], censusOnly: [] } }, o);
const item = (o) => Object.assign({ key: "node/1", label: "מגדל תקשורת", name: "", cat: "obst", grp: "מגדלים, תרנים, ארובות ועגורנים", d: 150, tags: {}, ids: ["node/1"], count: 1, title: "מגדל תקשורת", zone: "in" }, o);
const notamRec = (id, raw, o) => Object.assign({ id, raw, relation: "near", d: 500, edge: 400, window: {}, geometry: null }, o);
const nraw = (id, e) => id + " NOTAMN\nQ) LLLL/QRDCA/IV/BO/W /000/999/3201N03500E005\nA) LLLL B) 2610190000 C) 2610192359\nE) " + e + "\nF) GND G) 3000FT AMSL)";
const REALNOTAM = id => G.notams.find(n => n.id === id).raw;
const allText = o => JSON.stringify(o);

/* ================= חילוץ: נתוני אמת קפואים ================= */
test("זהות הנתונים הקפואים: 205 אזורים, 116 נוטמים, 15 כרטיסים", () => {
  assert.equal(Object.keys(G.pmt).length, 205); assert.equal(G.notams.length, 116); assert.equal(Object.keys(G.cards).length, 15);
});

test("אזורי הפמ״ת: 48 מופעי טלפון (34 ייחודיים), 7 מופעי דוא״ל (6 ייחודיים), 35 אזורים עם פרט קשר", () => {
  let occ = 0, mails = 0, zc = 0; const nums = new Set(), ms = new Set();
  for (const t of Object.values(G.pmt)) { const s = P.extract(t); occ += s.phones.length; mails += s.emails.length; s.phones.forEach(p => nums.add(p.display)); s.emails.forEach(e => ms.add(e.raw.toLowerCase())); if (s.phones.length || s.emails.length) zc++; }
  assert.deepEqual({ occ, uniq: nums.size, mails, uniqMails: ms.size, zc }, { occ: G.expected.phoneOccurrences, uniq: G.expected.uniquePhones, mails: G.expected.emailOccurrences, uniqMails: G.expected.uniqueEmails, zc: G.expected.zonesWithContact });
});

test("רגרסיה: LLP14 — כל ארבעת הטלפונים בשורות נפרדות (מפריד לעולם לא חוצה שורה ולא בולע את ספרת השורה הבאה)", () => {
  assert.deepEqual(display(P.scanPhones(G.pmt.LLP14)), ["054-3390262", "052-5773105", "052-8686406", "052-3678550"]);
  assert.deepEqual(display(P.scanPhones("1) א: 054-3390262\n2) ב: 052-5773105\n3) ג:052-8686406\n4) ד:052-3678550")), ["054-3390262", "052-5773105", "052-8686406", "052-3678550"]);
  // מספר שמפריד בו שורה חדשה אינו מספר; ספרה בראש השורה הבאה אינה נבלעת
  assert.deepEqual(P.scanPhones("054\n3390262"), []);
  assert.deepEqual(P.scanPhones("054-3390262\n2052-5773105").map(p => p.display), ["054-3390262"], "2052-… צמוד לספרה — לא מספר");
});

test("סיומת מקוצרת (073-3636954/5, 08-9902926/8) נשמרת כלשונה: בלי הרחבה ובלי קישור tel:", () => {
  const p = P.scanPhones(G.pmt["302"])[0];
  assert.equal(p.display, "073-3636954"); assert.equal(p.range, "/5"); assert.equal(p.text, "073-3636954/5"); assert.equal(p.tel, "", "אין tel: לסיומת מקוצרת");
  assert.ok(P.extract(G.pmt["302"]).excerpts[0].includes("073-3636954/5"));
  assert.equal(P.scanPhones("08-9902926/8")[0].range, "/8");
  assert.deepEqual(display(P.scanPhones("073-3636954/5")), ["073-3636954"], "לא נוצר מספר ...955");
  // מספר מלא רגיל — עם tel: בינלאומי
  assert.equal(P.scanPhones("03-5487211")[0].tel, "tel:+97235487211");
  // תאריך אחרי לוכסן אינו סיומת
  assert.equal(P.scanPhones("03-5487211/10/2026")[0].range, "");
  assert.equal(P.scanPhones("03-5487211/2018")[0].range, "");
});

test("גבול תחילת מספר: מספר צמוד לאות לטינית/ספרה/קו תחתון אינו טלפון (מזהי נוטם, חותמות), אבל אחרי אות עברית כן; סיום: לא חלק ממספר ארוך יותר", () => {
  for (const t of ["ID A0501234567", "x03-5487211", "_03-5487211", "12054-1234567", "9990501234567", "054-12345678", "03-54872111"]) assert.deepEqual(P.scanPhones(t), [], t);
  assert.deepEqual(display(P.scanPhones("בטלפון054-1234567")), ["054-1234567"]);
  assert.deepEqual(display(P.scanPhones("(054-1234567)")), ["054-1234567"]); assert.deepEqual(display(P.scanPhones("ב-03-5487211.")), ["03-5487211"]);
});

test("validate: קידומות ישראליות בלבד (קווי 02/03/04/08/09, סלולרי 05X, VoIP 072–079); 01/06/070/071 ומספרים באורך שגוי נדחים", () => {
  assert.deepEqual(P.validate("035487211"), { kind: "landline", national: "35487211" });
  assert.deepEqual(P.validate("0542479323"), { kind: "mobile", national: "542479323" });
  assert.deepEqual(P.validate("0733636954"), { kind: "voip", national: "733636954" });
  assert.deepEqual(P.validate("97235487211"), { kind: "landline", national: "35487211" }); assert.deepEqual(P.validate("0097235487211"), { kind: "landline", national: "35487211" });
  assert.deepEqual(P.validate("972035487211"), { kind: "landline", national: "35487211" }, "+972 (0)3…");
  for (const d of ["015487211", "065487211", "0701234567", "0711234567", "0112345678", "0612345678", "05487211", "03548721", "0354872111", "05424793234", "5487211", "", "abc"]) assert.equal(P.validate(d), null, d);
  assert.equal(P.scanPhones("073-3142501/05 2345678")[0].range, "", "״/05״ אחרי מספר אינו סיומת מקוצרת (נראה כמספר שני)");
});

test("שני מספרים מלאים עם לוכסן הם שני טלפונים (LLU60, LLU61); רשימה ב-LLD42/LLD49", () => {
  assert.deepEqual(display(P.scanPhones(G.pmt.LLU60)), ["073-3142501", "052-9289403"]);
  assert.deepEqual(display(P.scanPhones(G.pmt.LLU61)), ["052-3410054", "02-5917531"]);
  assert.deepEqual(display(P.scanPhones(G.pmt.LLD42)), ["054-7302309", "08-9977741"]);
  assert.deepEqual(display(P.scanPhones(G.pmt.LLD49)), ["050-7058511", "050-5805050"]);
});

test("זוגות תווית–מספר: רק הפסקה הכללית של LLU (4/4); כל שאר המשפטים הרב-מספריים — null", () => {
  const g = P.pairs(P.extract(G.generalLLU.text).excerpts[0]);
  assert.deepEqual(g.map(x => x.label + "=" + x.phone.display), ["מטה ארצי=074-7833333", "מחוז צפון=074-7834080", "מחוז מרכז=074-7836000", "מחוז דרום=074-7839000"]);
  for (const id of ["LLD42", "LLD48", "LLD49", "LLP22", "LLU60", "LLU61", "LLU73"]) assert.equal(P.pairs(P.extract(G.pmt[id]).excerpts[0]), null, id);
  assert.equal(P.pairs("אחד 03-5487211"), null, "מקטע יחיד אינו זוג");
  assert.equal(P.pairs("אלף 03-5487211 ; בית 02-5305042 ו-04-6977808"), null, "שני מספרים במקטע אחד — אין זיווג");
  assert.equal(P.pairs("אלף 03-5487211 ; 02-5305042"), null, "מקטע בלי תווית"); assert.equal(P.pairs("אלף1 03-5487211 ; בית 02-5305042"), null, "תווית עם ספרה");
  assert.deepEqual(P.pairs("אלף: 03-5487211 ; בית – 02-5305042").map(x => x.label), ["אלף", "בית"]);
});

test("הפניה בלי מספר (LLD41/44/51/52): אין מספר ואין השלמה; המשפט נשמר כלשונו כ-cue", () => {
  for (const id of G.expected.noContactZones) {
    const s = P.extract(G.pmt[id]); assert.equal(s.phones.length, 0, id); assert.equal(s.emails.length, 0, id);
    assert.equal(P.cueOf(G.pmt[id]), "לתיאום טיסה במרחב זה יש ליצור קשר עם מגדל רמת דוד בטלפון המפורסם בפרק א' 07.");
  }
  assert.equal(P.cueOf("אין כאן הפניה."), "");
});

test("נוטמים (116 קפואים): טלפון אחד בלבד (C1825/26), גם כשסורקים את כל הנוטם כולל שורות Q/B/C — אפס מופעי שווא", () => {
  const hits = G.notams.filter(n => P.extract(n.raw).phones.length);
  assert.deepEqual(hits.map(n => n.id), ["C1825/26"]);
  assert.deepEqual(display(P.extract(hits[0].raw).phones), G.expected.notamPhones["C1825/26"]);
  // למבחן יש שיניים: יש בנוטמים הרבה רצפי ספרות שדומים לטלפון (שורות Q עם 000/999 וקואורדינטות, חותמות B/C של 10 ספרות)
  const lookalike = G.notams.reduce((a, n) => a + (n.raw.match(/\d{9,10}/g) || []).length, 0);
  assert.ok(lookalike >= 100, "רצפי ספרות דמויי-טלפון בנוטמים: " + lookalike);
  assert.deepEqual(G.notams.flatMap(n => P.notamContacts(n.raw).phones.map(p => n.id + ":" + p.display)), ["C1825/26:08-9115730"]);
});

test("מלכודות בנוטם: שורות Q, חותמות זמן, שעות, קואורדינטות, TEL AVIV — אינן טלפון; טלפון אמיתי באותו נוטם נמצא", () => {
  const e = "OPS 0700-1500 DAILY AND 1000-1400, TEL AVIV CTR, FL 000/999 RADIUS 5NM 320122N0345611E, REF 0801234567 AND 2610190000. ENTRY BY PHONE NR 03-5487211.";
  const raw = nraw("A9999/26", e);
  assert.deepEqual(display(P.extract(raw).phones), ["03-5487211"], "גם סריקה של כל הנוטם (Q, B, C, E)");
  const nc = P.notamContacts(raw);
  assert.deepEqual(display(nc.phones), ["03-5487211"]); assert.equal(nc.lines.length, 1); assert.match(nc.lines[0], /^ENTRY BY PHONE NR 03-5487211\.$/);
  // מספר חוקי בלי מילת רמז בשדה E אינו נלקח (נוטם: טלפון רק במשפט עם PHONE/TEL/CTC…)
  assert.deepEqual(P.notamContacts(nraw("A1/26", "FREQ CHANGE. REF 03-5487211 ONLY.")).phones, []);
  // TEL AVIV אינו מילת רמז
  assert.deepEqual(P.notamContacts(nraw("A2/26", "TEL AVIV CTR 03-5487211 NOT AVBL.")).phones, []);
  assert.deepEqual(P.notamContacts(nraw("A3/26", "TEL 03-5487211 FOR INFO.")).phones.map(p => p.display), ["03-5487211"]);
  // שורות Q/B/C מחוץ ל-E אינן נסרקות גם אם הן נראות כמו מספר ישראלי תקין
  assert.deepEqual(P.notamContacts("X NOTAMN\nQ) PHONE 0501234567\nA) LLLL B) 0501234567 C) PHONE 0501234567\nE) OPS CLSD.)").phones, []);
});

test("נוטם: COORD WITH <X> — X כלשונו; PHONE NR UPDATED בלי מספר אינו יוצר גורם", () => {
  assert.equal(P.notamContacts(REALNOTAM("C1828/26")).coordWith, "ATC AND MABBAH");
  assert.equal(P.notamContacts(nraw("A0719/26", "SELF SER REFUEL NOT AVBL.\nCOOR WITH PAZ-AVIATION FOR REFUELING BY VEHICLE ONLY.")).coordWith, "PAZ-AVIATION FOR REFUELING BY VEHICLE ONLY");
  const nc = P.notamContacts(nraw("C2150/26", "TRIGGER NOTAM - AIRAC. COOR VOR PROC EXER, TWR PHONE NR UPDATED, PRKG OF GLD."));
  assert.deepEqual(nc, { phones: [], lines: [], coordWith: "" });
  assert.equal(P.notamE("A NOTAMN\nQ) x\nE) AB\nCD.\nF) GND G) UNL)"), "AB CD.");
  assert.equal(P.notamE("אין שדה E"), "");
});

test("רט״ג: אפס פרטי קשר בכל 544 הרשומות (הנתונים אינם נושאים טלפון/דוא״ל)", () => {
  const all = inpa.sites.concat(inpa.unmapped || []);
  assert.ok(all.length >= 500, "נבדקו " + all.length);
  const s = P.extract(all.map(x => JSON.stringify(x)).join("\n"));
  assert.equal(s.phones.length + s.emails.length, 0);
});

test("פורמטים של OSM: נקודות/מקפים/רווחים/+972/(0)/סלולרי/סוגריים — כולם מנורמלים; ערך לא תקין נשמר גולמי ומסומן", () => {
  const norm = v => P.phonesFromTag(v).map(p => p.display);
  assert.deepEqual(norm("03-642-7080"), ["03-6427080"]);
  assert.deepEqual(norm("+972  03–6422777"), ["03-6422777"], "רווח כפול ומקף ארוך");
  assert.deepEqual(norm("+972-3-6404444"), ["03-6404444"]);
  assert.deepEqual(norm("+972 (0)3 5589722"), ["03-5589722"]);
  assert.deepEqual(norm("052 379 2937"), ["052-3792937"]);
  assert.deepEqual(norm("0542479323"), ["054-2479323"]);
  assert.deepEqual(norm("(03) 5487211"), ["03-5487211"]);
  assert.deepEqual(norm("03-5487211; 054-2479323"), ["03-5487211", "054-2479323"]);
  assert.deepEqual(norm("tel: 03-5487211"), ["03-5487211"], "תווית לפני המספר אינה פוסלת");
  assert.deepEqual(P.phonesFromTag("+44 20 7946 0958, 03-5487211").map(p => p.kind), ["unverified", "landline"], "פסיק מפריד בין ערכים");
  const bad = P.phonesFromTag("+44 20 7946 0958")[0];
  assert.equal(bad.kind, "unverified"); assert.equal(bad.valid, false); assert.equal(bad.tel, "", "לא ישראלי: גולמי, בלי קישור"); assert.equal(bad.display, "+44 20 7946 0958");
  assert.deepEqual(P.phonesFromTag("בלי מספר"), [], "ערך בלי ספרות נפסל");
  assert.deepEqual(P.phonesFromTag("see website 123"), [], "מעט ספרות/טקסט חופשי — נפסל");
  assert.deepEqual(P.phonesFromTag("03-5487211 ext 5 9999"), [{ raw: "03-5487211 ext 5 9999", display: "03-5487211 ext 5 9999", text: "03-5487211 ext 5 9999", kind: "unverified", tel: "", range: "", valid: false }].slice(0, 0), "מספר עם ספרות נוספות סביבו אינו מוצג כמאומת");
});

test("כתובות אתר: http(s) בלבד; javascript/data/mailto/ftp/הרשאות/רווחים/סוגריים/ארוך/localhost נדחים", () => {
  assert.equal(P.cleanUrl("tlv-balloon.co.il"), "http://tlv-balloon.co.il");
  assert.equal(P.cleanUrl("https://www.lunapark.co.il/?categoryId=1&itemId=2"), "https://www.lunapark.co.il/?categoryId=1&itemId=2");
  assert.equal(P.cleanUrl("https://park.co.il/domain/פארק-הצפרות"), "https://park.co.il/domain/פארק-הצפרות");
  for (const u of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "mailto:a@b.co", "ftp://a.b/c", "//x.y/z", "https://a.b/c d", "http://x.co/<script>", 'http://x.co/"onmouseover=1', "http://user:pw@evil.co/", "http://localhost/", "https://" + "a".repeat(130) + ".co.il", "", null, "https://www.icd.org.il/events"]) assert.equal(P.cleanUrl(u), null, String(u));
});

test("דוא״ל: נקודה בסוף נקצצת, אותיות גדולות נשמרות, כפילות; כתובות הארגון נפסלות; נמעני נוטאם ובקשת חריגה מסומנים role", () => {
  const e = P.scanEmails("במייל: itzik.Sardinas@chevron.com, tal.lapidot@chevron.com. ושוב danm@parardive.co.il.");
  assert.deepEqual(e.map(x => x.raw), ["itzik.Sardinas@chevron.com", "tal.lapidot@chevron.com", "danm@parardive.co.il"]);
  assert.deepEqual(P.scanEmails("x office@icd.org.il y info@icd.org.il z a@b.icd.org.il OFFICE@ICD.ORG.IL"), [], "כל הדומיין ותת-דומיינים, בלי תלות באותיות");
  assert.deepEqual(P.scanEmails("notamoffice@iaa.gov.il nofm@iaa.gov.il fpl@iaa.gov.il").map(x => x.role), ["recipient", "recipient", "recipient"]);
  assert.equal(P.scanEmails("caai-charigot@mot.gov.il")[0].role, "exception");
  assert.deepEqual(P.scanEmails("a@b, @x.co, a..b@x.co, x@y.c"), [], "כתובות פגומות נדחות");
  assert.deepEqual(P.scanEmails("...x@y.co").map(x => x.raw), ["x@y.co"], "נקודות מובילות נקצצות");
  assert.deepEqual(P.scanEmails("mail a@b.co- now").map(x => x.raw), ["a@b.co"], "מקף בסוף נקצץ");
});

test("הקטע המצוטט: כלשונו (תת-מחרוזת של המקור), לא חותך באמצע מילה ולא ארוך מ-221 תווים — על כל טקסטי האזורים והכרטיסים הקפואים", () => {
  const squash = s => s.replace(/\s+/g, " ");
  const check = (src, label) => {
    const s = P.extract(src), plain = squash(src);
    s.segments.forEach(seg => {
      const core = seg.text.replace(/^…/, "").replace(/…$/, "");
      assert.ok(plain.includes(squash(core)), label + ": אינו כלשונו: " + seg.text);
      assert.ok(Array.from(seg.text).length <= 221, label + ": ארוך: " + seg.text.length + " " + seg.text);
      const i = plain.indexOf(squash(core));
      if (seg.text.startsWith("…")) assert.ok(i === 0 || plain[i - 1] === " ", label + ": התחיל באמצע מילה: " + seg.text);
      if (seg.text.endsWith("…")) assert.ok(plain[i + squash(core).length] === " ", label + ": הסתיים באמצע מילה: " + seg.text);
      seg.phones.concat(seg.emails).forEach(h => assert.ok(seg.text.includes(h.raw), label + ": פרט קשר נחתך: " + h.raw));
    });
  };
  Object.entries(G.pmt).forEach(([id, t]) => check(t, id));
  check(G.generalLLU.text, "LLU1א");
  assert.ok(P.extract(G.pmt.LLP13).excerpts.every(x => !/^מבצעים/.test(x)), "לא נחתך באמצע המילה ״המבצעים״");
});

test("הקטע המצוטט: יחידה ארוכה מתפצלת לפי פסיק ברמה העליונה; שרשרת בלי פסיקים נחתכת בגבול מילה בלבד עם …", () => {
  const long = "גורם המעוניין להגיש בקשה, מחויב ליצור קשר עם אלפא בטלפון 03-5487211 (אזור צפון), ועם בטא בטלפון 02-5305042 (אזור דרום), ועם גמא בטלפון 08-9902926 (אזור מרכז), ועוד תנאים רבים שאינם קשורים בכלל למספרים.";
  const ex = P.extract(long).excerpts;
  assert.deepEqual(ex, ["מחויב ליצור קשר עם אלפא בטלפון 03-5487211 (אזור צפון)", "ועם בטא בטלפון 02-5305042 (אזור דרום)", "ועם גמא בטלפון 08-9902926 (אזור מרכז)"]);
  // רצף ארוך ללא פסיקים: חיתוך משמאל בגבול מילה
  const words = Array.from({ length: 60 }, (_, i) => "מילה" + i).join(" ");
  const one = P.extract(words + " בטלפון 03-5487211 " + words).excerpts;
  assert.equal(one.length, 1); assert.ok(one[0].startsWith("…") && one[0].endsWith("…") && one[0].includes("03-5487211"));
  assert.ok(Array.from(one[0]).length <= 221);
});

test("חסימות: כתובות/טלפון הארגון, נמעני נוטאם ובקשת חריגה לעולם אינם בפלט — גם כשנזרקים לטקסט אזור מלאכותי", () => {
  const evil = "לתיאום: office@icd.org.il, info@icd.org.il, 052-5076677, +972-52-5076677, notamoffice@iaa.gov.il, nofm@iaa.gov.il, fpl@iaa.gov.il, caai-charigot@mot.gov.il. ומנהל אמיתי 054-2479323 ו-real@firm.co.il.";
  const rec = zrec({ id: "LLX9", label: "LLX9", pmt: evil, z: { contacts: [{ ref: "r", scope: "zone", text: evil, phones: [], emails: [] }] } });
  const rows = P.build(mkRes({ zones: { inside: [rec], near: [], excluded: [] } }), cfg, {});
  const json = allText(rows);
  for (const bad of ["icd.org.il", "ICD.ORG", "5076677", "notamoffice", "nofm@", "fpl@", "caai-charigot"]) assert.ok(!json.includes(bad), bad + " הופיע בפלט");
  assert.deepEqual(texts(rows[0].contacts.phones), ["054-2479323"]); assert.deepEqual(rows[0].contacts.emails, ["real@firm.co.il"]);
  // וגם ברמת extract עצמו
  const ex = P.extract(evil); assert.ok(!allText(ex).includes("5076677")); assert.ok(!allText(ex).includes("icd.org.il"));
  // מההגדרות: נמעני המייל וכתובת התמיכה (ולא רק רשימה סטטית)
  const cfg2 = Object.assign({}, cfg, { mail: { to: ["x-office@corp.example"], fpl: "fpl2@corp.example" }, support_email: "help@corp.example", parties: { block: { emails: ["boss@corp.example"], phones: ["03-1111111"] } } });
  const t2 = "x-office@corp.example fpl2@corp.example help@corp.example boss@corp.example ok@corp.example 03-1111111 03-2222222";
  const r2 = P.build(mkRes({ zones: { inside: [zrec({ pmt: t2, z: { contacts: [{ ref: "r", scope: "zone", text: t2 }] } })], near: [], excluded: [] } }), cfg2, {});
  assert.deepEqual(r2[0].contacts.emails, ["ok@corp.example"]); assert.deepEqual(texts(r2[0].contacts.phones), ["03-2222222"]);
});

/* ================= רשומות ציטוט (מה שהמייצא כותב) ================= */
test("quoteEntries: ציטוט כללי עם משפט שמצביע על האזור עצמו מניב רשומת zone נוספת; בלי zoneId — אין", () => {
  const t = G.cards.LLU21; assert.ok(t.includes("LLU21"));
  const quote = 'גורם המעוניין להגיש בקשה לטיסה בתוך מרחבים אלו מחויב ליצור קשר עם שירות בתי הסוהר (מטה ארצי- 074-7833333 ; מחוז צפון – 074-7834080 ; מחוז מרכז – 074-7836000 ; מחוז דרום – 074-7839000) ולקבל אישור בכתב לגבי ביצוע הפעילות (לאזור LLU21 לטלפון 03-5038875).';
  const withId = P.quoteEntries(quote, { ref: "R", scope: "general", zoneId: "LLU21" });
  assert.deepEqual(withId.map(e => e.scope + ":" + e.phones.join("|")), ["general:074-7833333|074-7834080|074-7836000|074-7839000|03-5038875", "zone:03-5038875"]);
  assert.equal(withId[1].text, "לאזור LLU21 לטלפון 03-5038875");
  assert.deepEqual(P.quoteEntries(quote, { ref: "R", scope: "general", zoneId: "LLU2" }).map(e => e.scope), ["general"], "LLU2 אינו LLU21 (גבול מזהה)");
  assert.deepEqual(P.quoteEntries(quote, { ref: "R", scope: "general" }).map(e => e.scope), ["general"]);
  assert.deepEqual(P.quoteEntries("אין כאן כלום.", { ref: "R", scope: "zone" }), []);
});

test("quoteEntries: כתובת בקשת חריגה בלבד => role:exception; מעורבת עם פרט רגיל => הכתובת מוסרת (נכשל סגור)", () => {
  const only = P.quoteEntries("בקשה תופנה לדוא\"ל: caai-charigot@mot.gov.il.", { ref: "R", scope: "general" });
  assert.equal(only[0].role, "exception"); assert.deepEqual(only[0].emails, ["caai-charigot@mot.gov.il"]);
  const mixed = P.quoteEntries("בטלפון 03-5487211 או בדוא\"ל caai-charigot@mot.gov.il ו-ok@firm.co.il.", { ref: "R", scope: "zone" });
  assert.equal(mixed[0].role, undefined); assert.deepEqual(mixed[0].emails, ["ok@firm.co.il"]); assert.deepEqual(mixed[0].phones, ["03-5487211"]);
  assert.deepEqual(P.quoteEntries("office@icd.org.il", { ref: "R", scope: "zone" }), [], "כתובת הארגון נפסלת לגמרי");
});

/* ================= בנייה ================= */
test("חמשת האתרים: מספר שורות 22/5/6/3/6 (הירקון/החולה/מטולה/ניצנה/גולן), ללא כשל וללא חריגה מהתקרה", () => {
  const got = Object.keys(SITES).map(n => { const data = siteData(n), r = P.buildResult(siteRes(n, data), cfg, data); assert.deepEqual(r.failed, [], n); assert.equal(r.dropped, 0); return r.rows.length; });
  assert.deepEqual(got, [22, 5, 6, 3, 6]);
});

test("LLU20/LLU17: אין פרט קשר משלהם — ההנחיה הכללית מוצגת תחת התווית הקבועה, ולעולם לא כ״גורם: שירות בתי הסוהר״", () => {
  const y = siteRows("yarkon").find(r => r.key === "z:LLU20"), n = siteRows("nitzana").find(r => r.key === "z:LLU17");
  for (const r of [y, n]) {
    assert.equal(r.general, true); assert.equal(r.contacts.general.label, P.GENERAL_LLU_LABEL); assert.equal(r.contacts.general.label, "הנחיה כללית של הפמ״ת לכל אזורי LLU (שירות בתי הסוהר)");
    assert.deepEqual(texts(r.contacts.general.phones), ["074-7833333", "074-7834080", "074-7836000", "074-7839000"]);
    assert.deepEqual(r.contacts.general.pairs.map(x => x.label + "=" + x.phone.display), ["מטה ארצי=074-7833333", "מחוז צפון=074-7834080", "מחוז מרכז=074-7836000", "מחוז דרום=074-7839000"]);
    assert.match(r.contacts.general.src, /^פמ״ת א-17, סעיף 1א \(עמ' 5, עדכון 1\/25\)$/);
    assert.deepEqual(r.contacts.phones, [], "הטלפונים הכלליים אינם הטלפונים של הגורם"); assert.equal(r.party, ""); assert.equal(r.contactSrc, "");
    assert.equal(r.hasContact, true); assert.equal(r.status, "unmarked");
  }
  for (const site of Object.keys(SITES)) assert.ok(!allText(siteRows(site)).includes("גורם: שירות בתי הסוהר"), site);
});

test("LLU21: המספר הייעודי 03-5038875 כאזור (ולא נספר בין מספרי שב״ס) ובנוסף ההנחיה הכללית עם ארבעת מספרי שב״ס", () => {
  const [r] = P.build(mkRes({ zones: { inside: [fzRec("LLU21", "LLU")], near: [], excluded: [] } }), cfg, { zones });
  assert.deepEqual(texts(r.contacts.phones), ["03-5038875"]); assert.deepEqual(r.contacts.lines, ["לאזור LLU21 לטלפון 03-5038875"]);
  assert.deepEqual(texts(r.contacts.general.phones), ["074-7833333", "074-7834080", "074-7836000", "074-7839000"], "03-5038875 אינו נספר פעמיים");
  assert.ok(r.contacts.general.pairs && r.contacts.general.pairs.length === 4);
  assert.equal(r.contactSrc, "פמ״ת א-17, סעיף 1א (עמ' 5, עדכון 1/25)");
  // ולהפך: אזור LLU אחר אינו מקבל את המספר של LLU21
  for (const rows of [siteRows("yarkon"), siteRows("nitzana")]) assert.ok(!allText(rows).includes("03-5038875"));
});

test("אזור LLU עם פרט קשר משלו (LLU60): ההנחיה הכללית של שב״ס אינה מוצגת; LLU55 (דוא״ל בלבד) — אותו כלל", () => {
  for (const [id, field] of [["LLU60", "phones"], ["LLU55", "emails"]]) {
    const [r] = P.build(mkRes({ zones: { inside: [fzRec(id, "LLU")], near: [], excluded: [] } }), cfg, { zones });
    assert.ok(r.contacts[field].length > 0, id); assert.equal(r.contacts.general, null, id); assert.equal(r.general, undefined, id);
  }
  const [r60] = P.build(mkRes({ zones: { inside: [fzRec("LLU60", "LLU")], near: [], excluded: [] } }), cfg, { zones });
  assert.deepEqual(texts(r60.contacts.phones), ["073-3142501", "052-9289403"]);
});

test("LLR: אנשי הקשר של סעיף 2 מוצגים כהנחיה של הפמ״ת (לא כגורם האזור), 4 מתא״מים עם סיומות מקוצרות ללא tel:", () => {
  const [r] = P.build(mkRes({ zones: { inside: [fzRec("LLR30", "LLR")], near: [], excluded: [] } }), cfg, { zones });
  const g = r.contacts.general;
  assert.equal(g.label, "הנחיה של הפמ״ת (סעיף 2)"); assert.deepEqual(texts(g.phones), ["08-9902926/8", "02-5305042/1", "073-3483007", "04-6977808"]);
  assert.deepEqual(g.phones.map(p => p.tel), ["", "", "tel:+972733483007", "tel:+97246977808"], "אין tel: לסיומות מקוצרות בלבד");
  assert.deepEqual(g.emails, ["pakmaz64@gmail.com"]); assert.equal(g.pairs, null, "בלי דקדוק חד-משמעי — בלי זיווג"); assert.equal(g.lines.length, 4);
});

test("נוטמים: נוטם עם COORD WITH בשורה משלו, נוטם עם PHONE NR בשורה משלו (עם הטלפון), כל השאר מאוחדים לשורה אחת (עד 8 מזהים ו״ועוד N״)", () => {
  const plain = Array.from({ length: 10 }, (_, i) => notamRec("A" + (100 + i) + "/26", nraw("A" + (100 + i) + "/26", "OPS CLSD."), i === 0 ? { relation: "overlap", d: 0, edge: 0 } : {}));
  const hits = [notamRec("C1825/26", REALNOTAM("C1825/26"), { edge: 0, d: 0, relation: "overlap" }), notamRec("C1828/26", REALNOTAM("C1828/26"), { relation: "overlap", d: 0, edge: 0 })].concat(plain);
  const rows = P.build(mkRes({ notams: { hits, obstacles: [] } }), cfg, {});
  assert.equal(rows.length, 3);
  const [a, b, c] = rows;
  assert.equal(a.key, "n:C1825/26"); assert.deepEqual(texts(a.contacts.phones), ["08-9115730"]); assert.equal(a.contacts.lines.length, 1); assert.match(a.contacts.lines[0], /BY PHONE NR 08-9115730\.$/); assert.equal(a.contactSrc, "נוטם C1825/26"); assert.equal(a.hasContact, true);
  assert.equal(b.key, "n:C1828/26"); assert.equal(b.party, "מוזכר בנוטם: ATC AND MABBAH"); assert.equal(b.hasContact, false); assert.equal(b.status, "nocontact"); assert.deepEqual(b.contacts.phones, []);
  assert.equal(c.key, "g:notams"); assert.equal(c.count, 10); assert.match(c.title, /^נוטמים בקרבה \(10\): A100\/26, A101\/26, A102\/26, A103\/26, A104\/26, A105\/26, A106\/26, A107\/26 ועוד 2$/); assert.equal(c.tag, "חלקם חופפים לסגירה");
  assert.deepEqual(rows.map(r => r.type), ["report", "report", "report"]);
});

test("נוטם מכשול (obstacles) עם COORD WITH נכנס לשורה כמו נוטם סגירה", () => {
  const o = notamRec("A777/26", nraw("A777/26", "CRANE 80M AGL. ALL FLT SHALL COORD WITH TWR."), { relation: "overlap", d: 0, edge: 0 });
  const rows = P.build(mkRes({ notams: { hits: [], obstacles: [o] } }), cfg, {});
  assert.equal(rows.length, 1); assert.equal(rows[0].key, "n:A777/26"); assert.equal(rows[0].party, "מוזכר בנוטם: TWR"); assert.equal(rows[0].tag, "חפיפה לסגירה");
});

test("חולה/מטולה/גולן על נוטמי אמת: שני נוטמי COORD בשורות משלהם ושורה מאוחדת", () => {
  const r = siteRows("hula");
  assert.deepEqual(r.filter(x => x.src === "notam").map(x => x.key), ["n:C1828/26", "n:C1827/26", "g:notams"]);
  assert.equal(r.find(x => x.key === "g:notams").count, 7);
});

test("אתרי המונים מהמצאי הרחב מתאחדים לפי מארח האתר (לונה פארק = שורה אחת), רק כשיש אתר/טלפון", () => {
  const rows = siteRows("yarkon"), luna = rows.filter(r => /לונה פארק/.test(r.title));
  assert.equal(luna.length, 1); assert.equal(luna[0].key, "h:lunapark.co.il"); assert.match(luna[0].title, /\(\+19 פריטים באותו אתר\)$/);
  assert.deepEqual(texts(luna[0].contacts.phones), ["03-6427080"]); assert.deepEqual(luna[0].contacts.urls, ["https://www.lunapark.co.il/"], "כמה כתובות באותו מארח — הקצרה ביותר");
  assert.equal(luna[0].contactSrc, "OpenStreetMap (phone, website) — לא מאומת");
  assert.deepEqual(rows.filter(r => r.src === "osm" && r.hasContact && r.contacts.phones.length).map(r => r.contacts.phones[0].text).sort(), ["03-5589722", "03-6404444", "03-6422777", "03-6427080"]);
});

test("OSM: מבנים גבוהים והוזן-ידנית אינם נכנסים; כבישים/מסילות מאוחדים לפי תווית; חשמל — שורת קווים ועמודים אחת", () => {
  const items = [
    item({ key: "t1", grp: "מבנים גבוהים", label: "מבנה גבוה", title: "מבנה גבוה", ids: ["way/9"] }),
    item({ key: "m1", grp: "הוזן ידנית", label: "מכשול/תשתית (הוזן ידנית)", title: "עגורן", ids: ["node/-1"], tags: { "icd:manual": "yes", phone: "03-5487211" } }),
    item({ key: "r1", grp: "כבישים ומסילות", label: "מסילת ברזל", title: "מסילת ברזל", ids: ["way/1"], count: 3 }),
    item({ key: "r2", grp: "כבישים ומסילות", label: "מסילת ברזל", title: "מסילת ברזל", ids: ["way/2"], count: 5, d: 90 }),
    item({ key: "r3", grp: "כבישים ומסילות", label: "כביש מהיר/ראשי", title: "כביש מהיר/ראשי", ids: ["way/3"] }),
    item({ key: "p1", grp: "קווי חשמל ותחנות", label: "קו מתח עליון 161 ק״ו", title: "קו מתח עליון 161 ק״ו", ids: ["way/4"] }),
    item({ key: "p2", grp: "קווי חשמל ותחנות", label: "עמוד חשמל 12", title: "עמוד חשמל 12", ids: ["node/5"], count: 1 })
  ];
  const rows = P.build(mkRes({ nearScan: { items, censusOnly: [] } }), cfg, {});
  assert.ok(!rows.some(r => /מבנה גבוה|עגורן/.test(r.title)));
  assert.deepEqual(rows.map(r => r.key).sort(), ["g:power-lines", "g:כבישים ומסילות|כביש מהיר/ראשי", "g:כבישים ומסילות|מסילת ברזל"].sort());
  assert.equal(rows.find(r => r.key === "g:כבישים ומסילות|מסילת ברזל").title, "מסילת ברזל (8)"); assert.equal(rows.find(r => r.key === "g:power-lines").title, "קווי חשמל ועמודים (2 פריטים)");
  // מדיניות מהגדרות: קבוצה שהוגדרה skip נעלמת
  const cfg2 = Object.assign({}, cfg, { parties: { groups: { "כבישים ומסילות": { skip: true } } } });
  assert.ok(!P.build(mkRes({ nearScan: { items, censusOnly: [] } }), cfg2, {}).some(r => r.src === "osm" && /מסילת|כביש/.test(r.title)));
});

test("OSM: קבוצה גדולה מהתקרה מתאחדת לפי תווית; קבוצה קטנה — שורה לפריט עם איחוד תגיות חברי הקבוצה (עד 3 טלפונים)", () => {
  const mk = (i, tags) => item({ key: "k" + i, grp: "מוסדות (בתי חולים, סוהר, משטרה, כיבוי)", label: "משטרה", title: "משטרה ״מ" + i + "״", ids: ["node/" + i], tags: tags || {}, d: 100 + i });
  const many = Array.from({ length: 7 }, (_, i) => mk(i));
  assert.deepEqual(P.build(mkRes({ nearScan: { items: many, censusOnly: [] } }), cfg, {}).map(r => r.title), ["משטרה (7)"]);
  assert.equal(P.build(mkRes({ nearScan: { items: many.slice(0, 3), censusOnly: [] } }), cfg, {}).length, 3);
  // קבוצה מאוחדת: טלפונים מתגי חברי הקבוצה שאינם הראשון, מבוססי data.near
  const near = { elements: [1, 2, 3, 4, 5].map(i => ({ type: "node", id: i, tags: { phone: "03-548721" + i, operator: "משטרת ישראל" } })) };
  const rows = P.build(mkRes({ nearScan: { items: [item({ label: "משטרה", grp: "מוסדות (בתי חולים, סוהר, משטרה, כיבוי)", title: "משטרה (×5)", ids: ["node/1", "node/2", "node/3", "node/4", "node/5"], count: 5, tags: {} })], censusOnly: [] } }), cfg, { near });
  assert.deepEqual(texts(rows[0].contacts.phones), ["03-5487211", "03-5487212", "03-5487213"], "עד 3 טלפונים"); assert.equal(rows[0].party, "משטרת ישראל");
});

test("מנחתים חקלאיים: טלפון משרד מבצעים מהטבלה + מקור; מפעיל בלי טלפון — בלי פרט קשר; מעבר ל-agri_near_m לא נכנס", () => {
  const data = { agri };
  const res = mkRes({ R: 100, agri: [{ name: "נען", d: 1200, ops: ["כימניר"] }, { name: "בדיקה", d: 1500, ops: ["אין"] }, { name: "רחוק", d: 9000, ops: ["תלם"] }, { name: "שני", d: 800, ops: ["כימניר", "תלם"] }] });
  const rows = P.build(res, cfg, data);
  assert.deepEqual(rows.map(r => r.key), ["a:נען", "a:בדיקה", "a:שני"]);
  assert.deepEqual(texts(rows[0].contacts.phones), ["09-9520520"]); assert.equal(rows[0].contactSrc, "טבלת המנחתים החקלאיים בפמ״ת"); assert.equal(rows[0].party, "כימניר"); assert.deepEqual(rows[0].contacts.lines, ["כימניר — משרד מבצעים 09-9520520"]);
  assert.equal(rows[1].hasContact, false); assert.equal(rows[1].status, "nocontact");
  assert.deepEqual(texts(rows[2].contacts.phones), ["09-9520520", "08-9924310"]);
  assert.deepEqual(rows.map(r => r.type), ["approval", "approval", "approval"]);
  assert.deepEqual(P.build(res, cfg, {}).map(r => r.hasContact), [false, false, false], "בלי נתוני מנחתים — בלי טלפון, השורות נשארות");
});

test("שדות תעופה ומנחתים בטווח: תגיות מ-data.far; לא נכפלים עם פריט OSM שכבר בטופס; פעיל/לא פעיל", () => {
  const far = { elements: [{ type: "way", id: 7, tags: { aeroway: "aerodrome", name: "מגידו", phone: "+972-4-6540000", website: "magiddo.example.co.il", operator: "רשות שדות התעופה" } }] };
  const af = [{ d: 700, type: "aerodrome", name: "מגידו", icao: "LLMG", inactive: false, id: "way/7" }, { d: 650, type: "heliport", name: "", icao: "", inactive: true, id: "way/8" }, { d: 9000, type: "aerodrome", name: "רחוק", icao: "", inactive: false, id: "way/9" }, { d: 600, type: "aerodrome", name: "בטופס", icao: "", inactive: false, id: "way/10" }];
  const rows = P.build(mkRes({ airfields: af, nearScan: { items: [item({ ids: ["way/10"] })], censusOnly: [] } }), cfg, { far });
  assert.deepEqual(rows.filter(r => r.src === "airfield").map(r => r.key), ["f:way/7", "f:way/8"]);
  const [a, b] = rows.filter(r => r.src === "airfield");
  assert.equal(a.title, "שדה תעופה ״מגידו״ (LLMG)"); assert.deepEqual(texts(a.contacts.phones), ["04-6540000"]); assert.deepEqual(a.contacts.urls, ["http://magiddo.example.co.il"]); assert.equal(a.party, "רשות שדות התעופה"); assert.equal(a.type, "approval");
  assert.match(b.tag, /לא פעיל לפי OSM/); assert.equal(b.hasContact, false);
  // תגיות שהליבה מוסיפה לאובייקט (a.tags) גוברות על חיפוש ב-far
  assert.deepEqual(texts(P.build(mkRes({ airfields: [{ d: 600, type: "aerodrome", name: "x", id: "way/55", tags: { phone: "03-5487211" } }] }), cfg, {})[0].contacts.phones), ["03-5487211"]);
});

test("אזורי רט״ג: הגורם ״רשות הטבע והגנים״ (נגזר מהסוג) וללא פרט קשר; אזור ב-09 בלי טלפון: משפט התיאום (coord) כ-cue", () => {
  const inpaRec = zrec({ id: "NP1", cat: "NP", src: "inpa", kind: "גן לאומי (רט״ג)", label: "NP1 ״גן״", pmt: "", z: { id: "NP1", note: "הערה" } });
  const b09 = zrec({ id: "בראשית 101", cat: "B09", src: "b09", kind: "אזור טיסה לכטב״ם (פרק ב-09, נספח ב'-3)", label: "בראשית 101", pmt: "שם: בראשית 101 · תיאום: פעילות צה״ל", coord: "פעילות צה״ל", z: {} });
  const rows = P.build(mkRes({ zones: { inside: [inpaRec, b09], near: [], excluded: [] } }), cfg, {});
  assert.equal(rows[0].party, "רשות הטבע והגנים"); assert.equal(rows[0].hasContact, false); assert.equal(rows[0].status, "nocontact");
  assert.equal(rows[1].cue, "פעילות צה״ל"); assert.equal(rows[1].hasContact, false);
  // ״הגשת בקשה למשרד נוטאם״ (תיאום כללי ב-09) היא הבקשה עצמה — לא גורם נוסף: בלי cue (אבל השורה נשארת)
  const coord401 = "הגשת בקשה למשרד נוטאם 5 ימי עבודה מראש.";
  const [r401] = P.build(mkRes({ zones: { inside: [fzRec("401 א", "B09", { coord: coord401 })], near: [], excluded: [] } }), cfg, { zones });
  assert.match(G.pmt["401 א"], /משרד נוטאם/); assert.equal(r401.cue, undefined); assert.equal(r401.hasContact, false); assert.equal(r401.status, "nocontact");
  assert.equal(P.build(mkRes({ zones: { inside: [zrec({ id: "LLX5", pmt: "יש לתאם עם משרד נוטאם." })], near: [], excluded: [] } }), cfg, {})[0].cue, undefined);
});

test("ב-09: 302 — הטלפון מהערות האזור כלשונו עם הסיומת המקוצרת, מקור שורת האזור בנספח", () => {
  const [r] = P.build(mkRes({ zones: { inside: [fzRec("302", "B09")], near: [], excluded: [] } }), cfg, { zones });
  assert.deepEqual(texts(r.contacts.phones), ["073-3636954/5"]); assert.equal(r.contacts.phones[0].tel, ""); assert.match(r.contactSrc, /^פמ״ת ב-09, נספח ב'-1, עמ' 10 בפרק ב-09/);
});

test("סוג וסטטוס ברירת מחדל (Q2): חפיפה=אישור מקומי, קרבה=דיווח, נוטם=דיווח, מנחת=אישור, OSM=עדכון; סטטוס אוטומטי לפי קיום פרט קשר", () => {
  const rows = P.build(mkRes({
    zones: { inside: [zrec({ id: "LLX1", pmt: "בטלפון 03-5487211." })], near: [zrec({ id: "LLX2", label: "LLX2", edge: 300 })], excluded: [] },
    notams: { hits: [notamRec("A1/26", nraw("A1/26", "OPS CLSD."))], obstacles: [] }, agri: [{ name: "מ", d: 500, ops: ["כימניר"] }], nearScan: { items: [item()], censusOnly: [] }
  }), cfg, { agri });
  assert.deepEqual(rows.map(r => r.type), ["approval", "report", "report", "approval", "update"]);
  assert.deepEqual(rows.map(r => r.status), ["unmarked", "nocontact", "nocontact", "unmarked", "nocontact"]);
  assert.deepEqual(rows.map(r => r.tag), ["חפיפה לסגירה", "300 מ׳ מקצה הסגירה", "בקרבה", "400 מ׳ מקצה הסגירה", "150 מ׳ מהנקודה"]);
  assert.ok(rows.every(r => r.mark && Object.keys(r.mark).length === 0), "הסטטוס האוטומטי אינו סימון של המטיס");
});

test("נתוני אזורים בלי zone.contacts (מייצא ישן): נסיגה לסריקת pmt, ובאזור LLU בלי טלפון משלו — הפסקה הכללית 1א", () => {
  const lluOld = zrec({ id: "LLU20", cat: "LLU", label: "LLU20", pmt: "LLU20, האזור האסור ״תל אביב״.", pmtRef: "עמ' 6, עדכון 1/25" });
  const own = zrec({ id: "LLD1", cat: "LLD", label: "LLD1", pmt: G.pmt.LLD42, pmtRef: "עמ' 10, עדכון 1/26" });
  const rows = P.build(mkRes({ zones: { inside: [lluOld, own], near: [], excluded: [] } }), cfg, { zones: { general: { LLU: G.generalLLU } } });
  assert.equal(rows[0].contacts.general.label, P.GENERAL_LLU_LABEL); assert.equal(rows[0].contacts.general.phones.length, 4);
  assert.deepEqual(texts(rows[1].contacts.phones), ["054-7302309", "08-9977741"]); assert.equal(rows[1].contacts.general, null);
  const noGen = P.build(mkRes({ zones: { inside: [lluOld], near: [], excluded: [] } }), cfg, {});
  assert.equal(noGen[0].hasContact, false, "בלי הפסקה הכללית בנתונים — אין פרט קשר (לא ממציאים)");
});

test("תקרה: מעל 40 שורות — נושרות קודם שורות OSM בלי פרט קשר מהסוף; dropped נספר; מפתחות ייחודיים", () => {
  const items = Array.from({ length: 50 }, (_, i) => item({ key: "k" + i, label: "אחר" + i, title: "אחר" + i, ids: ["node/" + i], tags: i === 49 ? { phone: "03-5487211" } : {}, d: 100 + i, grp: "תעשייה ותשתיות" }));
  const r = P.buildResult(mkRes({ zones: { inside: [zrec({ id: "LLX1" })], near: [], excluded: [] }, nearScan: { items, censusOnly: [] } }), cfg, {});
  assert.equal(r.rows.length, 40); assert.equal(r.dropped, 11);
  assert.equal(r.rows[0].key, "z:LLX1", "אזור אינו נושר");
  assert.ok(r.rows.some(x => x.key === "o:k49"), "שורה עם פרט קשר נשמרת");
  assert.deepEqual(r.rows.map(x => x.key), ["z:LLX1"].concat(Array.from({ length: 38 }, (_, i) => "o:k" + i), ["o:k49"]), "נושרות השורות האחרונות בלי פרט קשר (k38..k48), לא הראשונות");
  assert.equal(new Set(r.rows.map(x => x.key)).size, 40);
  // כפילות מפתח (שני אזורים עם אותו מזהה) מקבלת סיומת
  const dup = P.build(mkRes({ zones: { inside: [zrec({ id: "LLX1" }), zrec({ id: "LLX1" })], near: [], excluded: [] } }), cfg, {});
  assert.deepEqual(dup.map(x => x.key), ["z:LLX1", "z:LLX1#2"]);
});

test("נכשל סגור: מקור שנכשל לא מפיל את האחרים (failed מציין אותו); res לא תקין זורק", () => {
  const res = mkRes({ zones: { inside: [zrec({ id: "LLX1" })], near: [], excluded: [] } });
  Object.defineProperty(res, "agri", { get() { throw new Error("boom"); } });
  const r = P.buildResult(res, cfg, {});
  assert.deepEqual(r.failed, ["agri"]); assert.deepEqual(r.rows.map(x => x.key), ["z:LLX1"]);
  assert.throws(() => P.build(null, cfg, {}));
  assert.throws(() => P.build({}, cfg, {}));
});

test("כל מחרוזות הפלט הן טקסט רגיל: HTML/XSS בשמות OSM, בנוטם ובאזור נשמר כטקסט (בלי עיוות) ובלי בקרה/כיווניות/שורות חדשות", () => {
  const xss = '<img src=x onerror=alert(1)>';
  const it = item({ label: "אחר", title: xss + "\nשורה‮\u0007", name: xss, ids: ["node/1"], tags: { operator: xss, website: "javascript:alert(1)", phone: "03-5487211", email: "<b>x</b>@a.co" }, grp: "תעשייה ותשתיות" });
  const rows = P.build(mkRes({ nearScan: { items: [it], censusOnly: [] } }), cfg, {});
  const r = rows[0];
  assert.equal(r.title, xss + " שורה"); assert.equal(r.party, xss); assert.deepEqual(r.contacts.urls, []); assert.deepEqual(texts(r.contacts.phones), ["03-5487211"]);
  for (const s of [r.title, r.party, r.tag, r.contactSrc]) assert.ok(!/[\u0000-\u001f\u007f‪-‮]/.test(s));
  assert.ok(!r.contacts.emails.some(e => /[<>]/.test(e)), "דוא״ל עם סוגריים משולשים לא נבלע");
});

test("עשן על כל האזורים החיים: בנייה סביב כל אזור (א-17, ב-09) — בלי כשל, מפתחות ייחודיים, ערכים חוקיים, הלוך-חזור, ובלי מחרוזות אסורות", () => {
  const data = siteData("yarkon"); let checked = 0, withGeneral = 0, withOwn = 0;
  for (const z of zones.zones) {
    const ring = z.rings[0], lat = ring.reduce((a, p) => a + p[0], 0) / ring.length, lon = ring.reduce((a, p) => a + p[1], 0) / ring.length;
    const res = C.analyze(Object.assign({}, baseInput, { lat, lon, radius: 100 }), data, cfg, NOW), r = P.buildResult(res, cfg, data);
    assert.deepEqual(r.failed, [], z.id); assert.ok(r.rows.length <= 40, z.id);
    assert.equal(new Set(r.rows.map(x => x.key)).size, r.rows.length, z.id + " מפתחות");
    for (const x of r.rows) {
      assert.ok(P.TYPES.includes(x.type) && P.STATUSES.includes(x.status), z.id + " " + x.key); assert.equal(typeof x.title, "string"); assert.ok(x.title.length > 0 && !/undefined|\[object/.test(JSON.stringify(x)), z.id + " " + x.key);
      assert.equal(x.hasContact, x.status !== "nocontact"); if (x.contacts.general) withGeneral++; if (x.contacts.phones.length || x.contacts.emails.length) withOwn++;
      for (const ph of x.contacts.phones.concat(x.contacts.general ? x.contacts.general.phones : [])) assert.ok(ph.tel === "" || /^tel:\+?\d+$/.test(ph.tel), z.id + " tel");
    }
    const json = JSON.stringify(r.rows);
    for (const bad of ["icd.org.il", "5076677", "notamoffice", "caai-charigot", "גורם: שירות בתי הסוהר", "מנהל המערכת"]) assert.ok(!json.includes(bad), z.id + ": " + bad);
    assert.deepEqual(P.restore(JSON.parse(JSON.stringify(P.record(r.rows)))), r.rows, z.id + " הלוך-חזור"); checked++;
  }
  assert.equal(checked, zones.zones.length); assert.ok(withGeneral > 40 && withOwn > 10, "הנחיות כלליות: " + withGeneral + ", פרטי קשר עצמיים: " + withOwn);
});

/* ================= עריכה, ידניות, מיזוג ================= */
const base3 = () => P.build(mkRes({ zones: { inside: [zrec({ id: "LLX1", pmt: "בטלפון 03-5487211." }), zrec({ id: "LLX2", label: "LLX2" })], near: [zrec({ id: "LLX3", label: "LLX3", edge: 200 })], excluded: [] } }), cfg, {});

test("setField: סוג/סטטוס/הערה נשמרים כסימון מטיס; ערכים לא תקינים נדחים עם הודעה בעברית וללא שינוי", () => {
  let rows = base3();
  const a = P.setField(rows, "z:LLX1", "status", "needed"); assert.equal(a.error, ""); assert.equal(a.rows[0].status, "needed"); assert.deepEqual(a.rows[0].mark, { status: "needed" }); assert.equal(rows[0].status, "unmarked", "אי-שינוי של הקלט");
  const b = P.setField(a.rows, "z:LLX1", "type", "update"); assert.equal(b.rows[0].type, "update");
  const c = P.setField(b.rows, "z:LLX1", "note", "  בוצעה שיחה  "); assert.equal(c.rows[0].note, "בוצעה שיחה");
  assert.equal(P.setField(rows, "z:LLX1", "status", "bogus").error, "סטטוס לא מוכר"); assert.equal(P.setField(rows, "z:LLX1", "type", "x").error, "סוג לא מוכר");
  assert.equal(P.setField(rows, "z:NOPE", "note", "x").error, "השורה לא נמצאה"); assert.equal(P.setField(rows, "z:LLX1", "title", "x").error, "שדה לא מוכר", "שורה אוטומטית — שם ופרטי קשר אינם ניתנים לעריכה");
  assert.equal(P.setField(rows, "z:LLX1", "note", "א".repeat(301)).error, "ההערה: עד 300 תווים");
  assert.equal(P.setField(rows, "z:LLX1", "note", "א".repeat(301)).rows, rows); assert.equal(P.setField(rows, "z:LLX1", "note", "א".repeat(300)).error, "");
  assert.equal(P.setField(rows, "z:LLX1", "note", "ab\u0007c").error, "ההערה מכילה תווים לא תקינים (למשל תווי בקרה)");
  assert.equal(P.setField(rows, "z:LLX1", "note", "‏​").error, "ההערה אינה מכילה תו גלוי");
  assert.equal(P.setField(rows, "z:LLX1", "note", 5).error, "ההערה אינה תקינה");
  // 300 תווים נמדדים בנקודות קוד (אמוג׳י = תו אחד)
  assert.equal(P.setField(rows, "z:LLX1", "note", "😀".repeat(300)).error, ""); assert.equal(P.setField(rows, "z:LLX1", "note", "😀".repeat(301)).error, "ההערה: עד 300 תווים");
  // הסימון מנקה בחזרה ל-ברירת המחדל כשהערך ריק
  assert.equal(P.setField(c.rows, "z:LLX1", "note", "").rows[0].note, "");
});

test("addManual: שם חובה (גלוי), מגבלות 80/120/300, עד 20 ידניות, מפתחות m:n עולים; HTML נשמר כטקסט; removeManual לא נוגע באוטומטיות", () => {
  let rows = base3(), r;
  assert.equal(P.addManual(rows, { name: "" }).error, "יש להזין שם הגורם"); assert.equal(P.addManual(rows, { name: "‏ ㅤ" }).error, "יש להזין שם הגורם");
  assert.equal(P.addManual(rows, { name: "א".repeat(81) }).error, "שם הגורם: עד 80 תווים"); assert.equal(P.addManual(rows, { name: "x", contact: "1".repeat(121) }).error, "פרטי הקשר: עד 120 תווים");
  assert.equal(P.addManual(rows, { name: "x", note: "n".repeat(301) }).error, "ההערה: עד 300 תווים"); assert.equal(P.addManual(rows, { name: "x", contact: "a\u0007" }).error, "פרטי הקשר מכילים תווים לא תקינים (למשל תווי בקרה)"); assert.equal(P.addManual(rows, { name: "x", contact: "\u200f" }).error, "פרטי הקשר אינם מכילים תו גלוי"); assert.equal(P.addManual(rows, { name: 5 }).error, "שם הגורם אינו תקין"); assert.equal(P.addManual(rows, { name: "a\nb" }).error, "שם הגורם מכיל תווים לא תקינים (למשל תווי בקרה)");
  r = P.addManual(rows, { name: "<b>עיריית טבריה</b>", contact: "<i>03-5487211</i>" }); assert.equal(r.error, ""); assert.equal(r.key, "m:1");
  const m = r.rows.find(x => x.key === "m:1"); assert.equal(m.title, "<b>עיריית טבריה</b>"); assert.equal(m.contact, "<i>03-5487211</i>"); assert.equal(m.manual, true); assert.equal(m.src, "manual");
  assert.deepEqual([m.type, m.status, m.note], ["approval", "unmarked", ""]);
  r = P.addManual(r.rows, { name: "שני", type: "report", status: "needed", note: "הערה" }); assert.equal(r.key, "m:2"); assert.deepEqual([r.rows[r.rows.length - 1].type, r.rows[r.rows.length - 1].status], ["report", "needed"]);
  const trimmed = P.removeManual(r.rows, "m:1"); assert.deepEqual(trimmed.filter(x => x.manual).map(x => x.key), ["m:2"]); assert.equal(trimmed.length, rows.length + 1);
  assert.equal(P.removeManual(r.rows, "z:LLX1").length, r.rows.length, "אוטומטית אינה נמחקת");
  assert.equal(P.addManual(trimmed, { name: "שלישי" }).key, "m:3", "מפתח לא ממוחזר בתוך הרשימה");
  // עריכת שם/פרטי קשר של ידנית; מקסימום 20
  const ed = P.setField(r.rows, "m:2", "name", "חדש"); assert.equal(ed.rows.find(x => x.key === "m:2").title, "חדש"); assert.equal(P.setField(r.rows, "m:2", "name", "").error, "יש להזין שם הגורם");
  let full = base3(); for (let i = 0; i < 20; i++) full = P.addManual(full, { name: "ג" + i }).rows;
  assert.equal(P.addManual(full, { name: "עוד" }).error, "אפשר להוסיף עד 20 גורמים ידנית"); assert.equal(full.filter(x => x.manual).length, 20);
});

test("merge: סימון המטיס נשמר לפי מפתח; מפתח חדש = טרם סומן ו-isNew; בלי isNew בבנייה הראשונה", () => {
  const first = base3();
  assert.ok(P.merge([], first).every(r => !r.isNew && !r.updated && !r.stale), "בנייה ראשונה: אין ״חדש״");
  let rows = P.setField(first, "z:LLX1", "status", "done").rows; rows = P.setField(rows, "z:LLX2", "note", "ממתין").rows; rows = P.setField(rows, "z:LLX3", "type", "approval").rows;
  const fresh = P.build(mkRes({ zones: { inside: [zrec({ id: "LLX1", pmt: "בטלפון 03-5487211." }), zrec({ id: "LLX2", label: "LLX2" }), zrec({ id: "LLX4", label: "LLX4" })], near: [zrec({ id: "LLX3", label: "LLX3", edge: 200 })], excluded: [] } }), cfg, {});
  const m = P.merge(rows, fresh), by = Object.fromEntries(m.map(r => [r.key, r]));
  assert.deepEqual(m.map(r => r.key), ["z:LLX1", "z:LLX2", "z:LLX4", "z:LLX3"]);
  assert.equal(by["z:LLX1"].status, "done"); assert.equal(by["z:LLX2"].note, "ממתין"); assert.equal(by["z:LLX3"].type, "approval");
  assert.equal(by["z:LLX4"].isNew, true); assert.equal(by["z:LLX4"].status, "nocontact"); assert.equal(by["z:LLX1"].isNew, undefined);
  assert.equal(m.filter(r => r.isNew).length, 1);
  // המיזוג נקי: שני מיזוגים רצופים יציבים והדגלים מחושבים מחדש
  const m2 = P.merge(m, fresh); assert.equal(m2.filter(r => r.isNew).length, 0); assert.deepEqual(m2.map(r => [r.key, r.status, r.note]), m.map(r => [r.key, r.status, r.note]));
});

test("merge: שורה שסומנה ״דווח״ או נכתבה בה הערה ונעלמה — נשארת stale (מחוץ לטווח); שורה אחרת נמחקת בשקט; ידניות נשמרות; אחרי חזרה — כבר לא stale", () => {
  let rows = base3(); rows = P.addManual(rows, { name: "ידני", status: "done" }).rows;
  rows = P.setField(rows, "z:LLX1", "status", "done").rows; rows = P.setField(rows, "z:LLX2", "note", "דיברתי").rows; rows = P.setField(rows, "z:LLX3", "status", "needed").rows;
  const fresh = P.build(mkRes({ zones: { inside: [zrec({ id: "LLX9", label: "LLX9" })], near: [], excluded: [] } }), cfg, {});
  const m = P.merge(rows, fresh);
  assert.deepEqual(m.map(r => r.key), ["z:LLX9", "z:LLX1", "z:LLX2", "m:1"], "LLX3 סומן רק ״נדרש״ ונעלם — נמחק");
  assert.deepEqual(m.filter(r => r.stale).map(r => r.key), ["z:LLX1", "z:LLX2"]); assert.equal(m.find(r => r.key === "z:LLX1").status, "done");
  assert.equal(m.find(r => r.key === "m:1").stale, undefined);
  assert.equal(P.summary(m).total, 4);
  // אחרי שהגורם חזר לסריקה: חזרה לשורה רגילה עם הסימון
  const back = P.merge(m, P.build(mkRes({ zones: { inside: [zrec({ id: "LLX1", pmt: "בטלפון 03-5487211." })], near: [], excluded: [] } }), cfg, {}));
  assert.equal(back.find(r => r.key === "z:LLX1").stale, undefined); assert.equal(back.find(r => r.key === "z:LLX1").status, "done");
  assert.equal(back.find(r => r.key === "z:LLX2").stale, true, "עדיין לא בסריקה");
  // תקרת stale
  let many = []; for (let i = 0; i < 30; i++) many.push(Object.assign({}, base3()[0], { key: "z:S" + i, mark: { status: "done" } }));
  assert.equal(P.merge(many, []).filter(r => r.stale).length, 20);
});

test("merge: שינוי בפרטי הקשר של שורה קיימת — הסימון נשמר והשורה מסומנת updated; כשאין שינוי — אין", () => {
  const first = P.setField(base3(), "z:LLX1", "status", "done").rows;
  const same = P.merge(first, base3()); assert.equal(same[0].updated, undefined);
  const changed = P.merge(first, P.build(mkRes({ zones: { inside: [zrec({ id: "LLX1", pmt: "בטלפון 03-5487299." }), zrec({ id: "LLX2", label: "LLX2" })], near: [zrec({ id: "LLX3", label: "LLX3", edge: 200 })], excluded: [] } }), cfg, {}));
  assert.equal(changed[0].updated, true); assert.equal(changed[0].status, "done"); assert.deepEqual(texts(changed[0].contacts.phones), ["03-5487299"]); assert.equal(changed[1].updated, undefined);
});

test("marks() + merge(compact): צורה קומפקטית לדפדפן — רק מה שסומן, מפתחות הסריקה הקודמת, הידניות; שורת done שנעלמה חוזרת כ-stale עם הכותרת", () => {
  let rows = P.addManual(base3(), { name: "ידני", contact: "03-1" }).rows;
  rows = P.setField(rows, "z:LLX1", "status", "done").rows; rows = P.setField(rows, "z:LLX2", "type", "update").rows;
  const mk = P.marks(rows);
  assert.deepEqual(Object.keys(mk.marks), ["z:LLX1", "z:LLX2"]); assert.deepEqual(mk.marks["z:LLX2"], { type: "update" }); assert.equal(mk.marks["z:LLX1"].title, "LLX1 ״בדיקה״ — אזור אסור לטיסה (LLP)");
  assert.deepEqual(mk.keys, ["z:LLX1", "z:LLX2", "z:LLX3"]); assert.equal(mk.manual.length, 1);
  assert.ok(JSON.stringify(mk).length < 1500);
  const fresh = P.build(mkRes({ zones: { inside: [zrec({ id: "LLX2", label: "LLX2" }), zrec({ id: "LLX7", label: "LLX7" })], near: [], excluded: [] } }), cfg, {});
  const m = P.merge(JSON.parse(JSON.stringify(mk)), fresh), by = Object.fromEntries(m.map(r => [r.key, r]));
  assert.equal(by["z:LLX2"].type, "update"); assert.equal(by["z:LLX7"].isNew, true, "מפתחות הסריקה הקודמת ידועים גם מהצורה הקומפקטית");
  assert.equal(by["z:LLX1"].stale, true); assert.equal(by["z:LLX1"].status, "done"); assert.equal(by["m:1"].contact, "03-1"); assert.equal(by["z:LLX3"], undefined);
  assert.deepEqual(P.merge(null, fresh).map(r => r.key), ["z:LLX2", "z:LLX7"]);
  assert.deepEqual(P.merge({ marks: { "__proto__": { status: "done" }, "x": {} }, keys: ["../etc"] }, fresh).map(r => r.key), ["z:LLX2", "z:LLX7"], "מפתחות פגומים נדחים");
});

test("describe: מבנה מוכן להצגה — פרטי הגורם עצמו לפני ההנחיה הכללית; pairs במקום lines; תקרת קטעים (Word: 3) ו״ועוד N״; שורה ללא פרט קשר + cue; ידנית", () => {
  const y = siteRows("yarkon").find(r => r.key === "z:LLU20"), d = P.describe(y);
  assert.equal(d.none, false); assert.equal(d.blocks.length, 1); assert.equal(d.blocks[0].label, P.GENERAL_LLU_LABEL); assert.equal(d.blocks[0].pairs.length, 4); assert.deepEqual(d.blocks[0].lines, []); assert.equal(d.blocks[0].src, "פמ״ת א-17, סעיף 1א (עמ' 5, עדכון 1/25)");
  const [r21] = P.build(mkRes({ zones: { inside: [fzRec("LLU21", "LLU")], near: [], excluded: [] } }), cfg, { zones });
  const d21 = P.describe(r21); assert.deepEqual(d21.blocks.map(b => b.label), ["", P.GENERAL_LLU_LABEL]); assert.deepEqual(texts(d21.blocks[0].phones), ["03-5038875"]); assert.deepEqual(d21.blocks[0].lines, ["לאזור LLU21 לטלפון 03-5038875"]);
  // תקרה: LLR30 — 4 קטעים מצוטטים; max=3 => 3 + ״ועוד 1״
  const [r30] = P.build(mkRes({ zones: { inside: [fzRec("LLR30", "LLR")], near: [], excluded: [] } }), cfg, { zones });
  assert.deepEqual([P.describe(r30).blocks[0].lines.length, P.describe(r30).more], [4, 0]); const d3 = P.describe(r30, { max: 3 }); assert.deepEqual([d3.blocks[0].lines.length, d3.more], [3, 1]);
  assert.deepEqual([P.describe(r30, { max: 1 }).blocks[0].lines.length, P.describe(r30, { max: 1 }).more], [1, 3]);
  // שורה בלי פרט קשר: none + cue
  const [r41] = P.build(mkRes({ zones: { inside: [fzRec("LLD41", "LLD")], near: [], excluded: [] } }), cfg, { zones });
  assert.deepEqual(P.describe(r41), { none: true, cue: "לתיאום טיסה במרחב זה יש ליצור קשר עם מגדל רמת דוד בטלפון המפורסם בפרק א' 07.", blocks: [], more: 0 });
  assert.deepEqual(P.describe(P.build(mkRes({ notams: { hits: [notamRec("A1/26", nraw("A1/26", "OPS CLSD."))], obstacles: [] } }), cfg, {})[0]), { none: true, cue: "", blocks: [], more: 0 });
  // ידנית
  const m = P.addManual([], { name: "עירייה", contact: "03-5487211" }).rows[0]; assert.deepEqual(P.describe(m).blocks.map(b => b.lines), [["03-5487211"]]);
  assert.equal(P.describe(P.addManual([], { name: "עירייה" }).rows[0]).none, true); assert.deepEqual(P.describe(null), { none: true, cue: "", blocks: [], more: 0 });
});

/* ================= סיכום ================= */
test("summary / summaryText / mailLine: כל הצירופים, יחיד/רבים, אפסים מושמטים, סדר קבוע, ריק", () => {
  const S = (o) => Object.assign({ total: 0, done: 0, needed: 0, unmarked: 0, nocontact: 0, notneeded: 0 }, o);
  assert.equal(P.summaryText(S({})), "לא נמצאו גורמים");
  assert.equal(P.summaryText(S({ total: 1, unmarked: 1 })), "גורם אחד — 1 טרם סומן");
  assert.equal(P.summaryText(S({ total: 1, done: 1 })), "גורם אחד — 1 דווח/התקבל אישור");
  assert.equal(P.summaryText(S({ total: 6, done: 2, needed: 3, notneeded: 1 })), "6 גורמים — 2 דווחו/התקבל אישור · 3 נדרש · 1 אין צורך");
  assert.equal(P.summaryText(S({ total: 9, done: 1, needed: 1, unmarked: 3, nocontact: 2, notneeded: 2 })), "9 גורמים — 1 דווח/התקבל אישור · 1 נדרש · 3 טרם סומנו · 2 לא נמצא איש קשר · 2 אין צורך");
  assert.equal(P.mailLine(S({ total: 6, done: 2, needed: 3, notneeded: 1 })), "דיווח לגורמים נוספים: 6 גורמים — 2 דווחו/התקבל אישור");
  assert.equal(P.mailLine(S({ total: 6, needed: 3 })), "דיווח לגורמים נוספים: 6 גורמים", "M=0 — בלי החלק השני; אין פירוט ״נדרש״ למשרד");
  assert.equal(P.mailLine(S({ total: 1, done: 1 })), "דיווח לגורמים נוספים: גורם אחד — 1 דווח/התקבל אישור");
  assert.equal(P.mailLine(S({})), "דיווח לגורמים נוספים: לא נמצאו גורמים"); assert.equal(P.mailLine(null), "דיווח לגורמים נוספים: לא נמצאו גורמים");
  let rows = base3(); rows = P.setField(rows, "z:LLX1", "status", "done").rows; rows = P.setField(rows, "z:LLX2", "status", "notneeded").rows;
  assert.deepEqual(P.summary(rows), { total: 3, done: 1, needed: 0, unmarked: 0, nocontact: 1, notneeded: 1 });
  assert.deepEqual(P.summary([]), { total: 0, done: 0, needed: 0, unmarked: 0, nocontact: 0, notneeded: 0 }); assert.equal(P.summary(null).total, 0);
});

/* ================= שמירה ושחזור ================= */
test("record/restore: הלוך-חזור זהה לכל חמשת האתרים (כולל ידניות וסימונים), JSON עד 24KB, builtAt רק עם now", () => {
  for (const n of Object.keys(SITES)) {
    let rows = siteRows(n); rows = P.setField(rows, rows[0].key, "status", "needed").rows; rows = P.setField(rows, rows[rows.length - 1].key, "note", "הערה בדיקה").rows;
    rows = P.addManual(rows, { name: "עיריית בדיקה", contact: "03-5487211", type: "report", status: "done", note: "נא" }).rows;
    const rec = P.record(rows, { now: NOW }), json = JSON.stringify(rec);
    assert.ok(json.length <= 24 * 1024, n + " " + json.length);
    assert.equal(rec.v, 1); assert.equal(rec.builtAt, NOW.toISOString()); assert.deepEqual(rec.summary, P.summary(rows)); assert.equal(rec.manual.length, 1); assert.equal(rec.rows.length, rows.length - 1);
    assert.deepEqual(P.restore(JSON.parse(json)), rows, n);
  }
  assert.equal(P.record([], {}).builtAt, ""); assert.equal(P.record(null).rows.length, 0);
});

test("restore: JSON פגום/עוין לא זורק ולא מכניס כלום — מפתחות, כתובות, טלפונים, מחרוזות, מערכים ענקיים, סוגים שגויים", () => {
  const hostile = {
    v: 1, rows: [
      { key: "__proto__", title: "x" }, { key: "z:ok", title: '<img src=x onerror=alert(1)>', tag: "‮\u0007t", party: 5, dtype: "weird", src: "hax",
        contacts: { phones: [{ raw: "javascript:alert(1)", display: "tel:evil", kind: "landline", tel: "javascript:alert(1)" }, { raw: "03-5487211", display: "03-5487211", tel: "tel:+1999" }, { raw: "+44 20 7946 0958", kind: "unverified" }, "str", null, 5],
          emails: ["office@icd.org.il", "a@b.co", "<x>@y.co", 5], urls: ["javascript:alert(1)", "https://ok.co.il/x", "http://u:p@evil.co"], lines: ["<b>x</b>", 5, "א".repeat(500)], pairs: [{ label: "a", phone: { raw: "03-5487211" } }, { label: "b", phone: { raw: "zzz" } }],
          general: { label: "<b>", src: "s", phones: [{ raw: "074-7833333" }], emails: [], lines: [], pairs: "x" } },
        mark: { type: "approval", status: "done", note: "n".repeat(500) }, stale: true, count: 1e9 },
      { key: "z:" + "k".repeat(300), title: "ארוך" }, { key: "q:no", title: "" }, null, 5, "s"
    ],
    manual: [{ key: "m:1", title: "ידני", contact: "c", type: "update", status: "needed", note: "n" }, { key: "m:x", title: "bad" }, { key: "m:2", title: "‏" }, { key: "z:1", title: "not manual" }, null]
  };
  const rows = P.restore(hostile), by = Object.fromEntries(rows.map(r => [r.key, r]));
  assert.deepEqual(rows.map(r => r.key), ["z:ok", "m:1"]);
  const r = by["z:ok"];
  assert.equal(r.title, '<img src=x onerror=alert(1)>', "נשמר כטקסט רגיל — ההצגה תעבור esc"); assert.equal(r.party, ""); assert.equal(r.src, "zone"); assert.equal(r.dtype, "report");
  assert.deepEqual(r.contacts.phones.map(p => p.text + "|" + p.tel + "|" + p.kind), ["03-5487211|tel:+97235487211|landline", "+44 20 7946 0958||unverified"], "tel נגזר מחדש, לא נקרא מהקובץ; הלא-תקין לא נכנס");
  assert.deepEqual(r.contacts.emails, ["a@b.co"]); assert.deepEqual(r.contacts.urls, ["https://ok.co.il/x"]); assert.equal(r.contacts.lines.length, 2); assert.ok(Array.from(r.contacts.lines[1]).length <= 221);
  assert.equal(r.contacts.pairs, null); assert.equal(r.mark.note.length <= 300, true); assert.equal(r.stale, true); assert.ok(r.count <= 99999);
  assert.deepEqual(texts(r.contacts.general.phones), ["074-7833333"]); assert.equal(r.contacts.general.pairs, null);
  for (const bad of [null, undefined, 5, "x", [], {}, { rows: "x" }, { rows: [], manual: 5 }]) assert.deepEqual(P.restore(bad), []);
  assert.equal(P.restore({ manual: Array.from({ length: 30 }, (_, i) => ({ key: "m:" + (i + 1), title: "ג" + i })) }).length, 20, "תקרת ידניות");
  assert.equal(P.restore({ rows: Array.from({ length: 500 }, (_, i) => ({ key: "z:" + i, title: "t" + i })) }).length, 60, "תקרה על מערך ענק");
  // restore מסנן גם לפי ההגדרות (נמעני מייל)
  const rec = { rows: [{ key: "z:a", title: "t", contacts: { emails: ["x-office@corp.example", "ok@corp.example"] } }] };
  assert.deepEqual(P.restore(rec, Object.assign({}, cfg, { mail: { to: ["x-office@corp.example"] } }))[0].contacts.emails, ["ok@corp.example"]);
});

/* ================= עזרים ================= */
test("fingerprint / enabled: מפתח זהות לבקשה; מתג features.parties — חסר = פעיל, false = כבוי", () => {
  assert.equal(P.fingerprint({ lat: 32.099128, lon: 34.816617, dateFrom: "2026-10-20", dateTo: "2026-10-23", radius: 5 }), "32.099128,34.816617,2026-10-20,2026-10-23");
  assert.equal(P.fingerprint({ lat: "32.1", lon: "x", dateFrom: "d" }), "32.100000,,d,"); assert.equal(P.fingerprint(null), ",,,");
  assert.equal(P.enabled(undefined), true); assert.equal(P.enabled({}), true); assert.equal(P.enabled({ features: {} }), true); assert.equal(P.enabled({ features: { myreq: true } }), true);
  assert.equal(P.enabled({ features: { parties: true } }), true); assert.equal(P.enabled({ features: { parties: false } }), false);
});

test("localAuthority: הרשות המקומית לפי OSM (רמה 6–8 הגבוהה ביותר) עם אתר/טלפון רק אם יש בתגיות", () => {
  const far = { elements: [
    { type: "area", tags: { boundary: "administrative", admin_level: "6", name: "מחוז" } },
    { type: "area", tags: { boundary: "administrative", admin_level: "8", name: "Tel Aviv", "name:he": "תל אביב-יפו", website: "https://www.tel-aviv.gov.il/", phone: "*3333" } },
    { type: "area", tags: { boundary: "administrative", admin_level: "4", name: "מדינה" } }, { type: "node", tags: { place: "city", name: "x" } }] };
  const la = P.localAuthority(far); assert.equal(la.name, "תל אביב-יפו"); assert.deepEqual(la.urls, ["https://www.tel-aviv.gov.il/"]); assert.deepEqual(la.phones, [], "*3333 אינו מספר ישראלי תקין ואינו נראה כמספר — נפסל");
  assert.equal(P.localAuthority({ elements: [] }), null); assert.equal(P.localAuthority(null), null);
  assert.ok(P.SUGGESTIONS.includes("רשות מקומית") && P.SUGGESTIONS.length === 8);
});

test("נוסח: תוויות עברית קבועות; אין כתובת הארגון, ״מנהל המערכת״ או ״גורם: שירות בתי הסוהר״ באף תווית/קבוע", () => {
  const T = P.TEXT, consts = JSON.stringify([P.TYPE_LABEL, P.STATUS_LABEL, P.STATUS_ICON, P.GENERAL_LLU_LABEL, P.SUGGESTIONS, T.title, T.intro, T.paperNote, T.footer("18.10.2026 21:00"), T.footer(""), T.empty, T.noContact, T.srcPrefix, T.unverified, T.outOfRange, T.updated, T.failed, T.more(3), T.dropped(1), T.dropped(4), T.newFound(1), T.newFound(3)]);
  assert.equal(T.title, "דיווח לגורמים נוספים"); assert.match(T.footer("18.10.2026 21:00"), /מצב נכון ל-18\.10\.2026 21:00\.$/); assert.ok(!/מצב נכון/.test(T.footer("")));
  assert.equal(T.newFound(1), "נוסף גורם אחד חדש מאז הבדיקה הקודמת"); assert.equal(T.newFound(3), "נוספו 3 גורמים חדשים מאז הבדיקה הקודמת"); assert.equal(T.more(3), "ועוד 3"); assert.equal(T.dropped(4), "4 גורמים נוספים לא הוצגו");
  assert.match(T.intro, /אינה מונעת שליחה/, "הרשימה אינה חוסמת שליחה"); assert.ok(!/משרד נוטאם|office@|info@/.test(consts), "בנוסח חדש — בלי שם המשרד/כתובות");
  assert.deepEqual(P.TYPE_LABEL, { approval: "אישור מקומי", report: "דיווח", update: "עדכון" });
  assert.deepEqual(P.STATUS_LABEL, { needed: "נדרש", done: "דווח / התקבל אישור", nocontact: "לא נמצא איש קשר", notneeded: "אין צורך", unmarked: "טרם סומן" });
  assert.deepEqual(P.STATUS_ICON, { needed: "!", done: "✓", nocontact: "—", notneeded: "○", unmarked: "·" });
  for (const bad of ["icd.org.il", "מנהל המערכת", "גורם: שירות בתי הסוהר"]) assert.ok(!consts.includes(bad), bad);
  for (const n of Object.keys(SITES)) for (const bad of ["icd.org.il", "מנהל המערכת", "5076677"]) assert.ok(!allText(P.record(siteRows(n))).includes(bad), n + " " + bad);
  assert.deepEqual(P.TYPES, ["approval", "report", "update"]); assert.deepEqual(P.STATUSES, ["needed", "done", "nocontact", "notneeded", "unmarked"]);
});

test("המודול טהור: אין גישה ל-DOM/רשת/אחסון/שעון — נטען ב-Node ללא window, ובתוצאה אותם נתונים בכל קריאה (דטרמיניסטי)", () => {
  const src = fs.readFileSync(path.join(ROOT, "members-k38p/requests/js/parties.js"), "utf8");
  assert.ok(!/\b(document|window|localStorage|sessionStorage|fetch|XMLHttpRequest|Date\.now|new Date\(\)|Math\.random|innerHTML)\b/.test(src.replace(/\/\*[\s\S]*?\*\//, "")), "אין תלות סביבתית בקוד (מחוץ להערות)");
  assert.deepEqual(siteRows("yarkon"), siteRows("yarkon"));
  assert.equal(typeof globalThis.window, "undefined");
});
