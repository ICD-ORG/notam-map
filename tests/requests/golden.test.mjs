/* טביעת אצבע של פלט המעגל (נרשמה לפני הוספת ״נתיב״): ניתוח, טופס, בדיקות, KML, מייל, תמונת מצב ושאילתות — מעגל חייב להישאר זהה בייט-בבייט */
import test from "node:test"; import assert from "node:assert/strict"; import { fileURLToPath } from "node:url";
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto"; import { createRequire } from "node:module";
const require = createRequire(import.meta.url), ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const C = require(path.join(ROOT, "members-k38p/requests/js/core.js")), O = require(path.join(ROOT, "members-k38p/requests/js/output.js")), RC = require(path.join(ROOT, "members-k38p/requests/js/recheck.js"));
const J = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const cfg = J("members-k38p/requests/config.json"), exp = J("members-k38p/requests/selftest/expected.json"), zones = J("members-k38p/data/zones.json"); zones.rules09 = J("members-k38p/data/pmt-b09-rules.json");
const inpa = J("members-k38p/data/inpa-zones.json"), agri = J("members-k38p/data/agri-airstrips.json"), snap = J("members-k38p/requests/selftest/notam-data.snap.json");
const fixture = n => { const o = {}; for (const k of ["near", "far", "ext", "reverse"]) { const p = `members-k38p/requests/selftest/${n}/${k}.json`; if (fs.existsSync(path.join(ROOT, p))) o[k] = J(p); } return o; };
const now = new Date(exp.now), sha = s => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
const base = Object.assign({}, exp.input, { purpose: cfg.purposes[0], aircraft: [cfg.aircraft[0]], vlos: true, siteName: "בדיקה", requesterName: "בודק", requesterPhone: "050-0000000", requesterOrg: "חברת הבדיקה בע״מ", contacts: [{ name: "א", phone: "050-0000001" }, { name: "ב", phone: "050-0000002" }] });
const cases = [["yarkon", {}], ["yarkon", { radius: 1500 }], ["hula", { lat: 33.09, lon: 35.6, radius: 300 }], ["metula", { lat: 33.279, lon: 35.578, radius: 100 }], ["nitzana", { lat: 30.887, lon: 34.424, radius: 100 }]];
const run = () => cases.map(([fx, over]) => {
  const data = Object.assign({ zones, inpa, agri, notams: snap.notams, notamFetchedIso: snap.fetched_iso }, fixture(fx)), res = C.analyze(Object.assign({}, base, over), data, cfg, now);
  const strip = JSON.stringify(res, (k, v) => (k === "P" ? undefined : v));
  return [fx + "/" + (over.radius || 200), { analyze: sha(strip), form: sha(JSON.stringify(O.buildForm(res, cfg))), checks: sha(JSON.stringify(O.buildChecks(res, data, cfg))), kml: sha(O.kml(res, data, cfg)), mail: sha(JSON.stringify(O.mail(res, cfg))), snapshot: sha(JSON.stringify(RC.snapshotOf(res, data, cfg, now))), queries: sha(JSON.stringify(C.buildQueries(res.inp.lat, res.inp.lon, res.R, cfg))) }];
});

const GOLD = {
  "yarkon/200": { analyze: "90dbf41f146d9fc1", form: "ab096b95180bbe67", checks: "a69e6cffd09159ca", kml: "ae8346111ead55d5", mail: "7c4f9ff7ca158346", snapshot: "ab53f64c372bc452", queries: "19302a7778e31df7" },
  "yarkon/1500": { analyze: "2dd6e6c96c9e7b99", form: "cb189f2a3507302f", checks: "b16f08fe78447a35", kml: "c91a3935934bbeb3", mail: "0fbfeb955c227a04", snapshot: "d90ef699213c46d4", queries: "fed095b3ab01bd90" },
  "hula/300": { analyze: "1068189fbf14b9f6", form: "64157dde915805ad", checks: "e2447f173574ec56", kml: "171617ff6e8a7c2b", mail: "8faec575c4998508", snapshot: "a636719daf366d36", queries: "90c9ff03576a51bf" },
  "metula/100": { analyze: "834a3a27bfcdf1a2", form: "0a37e75536a3ee54", checks: "be0e6f8094a9f98c", kml: "1489c775a6ac1f5c", mail: "0d1850c2a21cbd66", snapshot: "4b18f3be7f4f2175", queries: "d7dc9c07379aa1d3" },
  "nitzana/100": { analyze: "c1b28e5dbe49eb5a", form: "9c51614908cf8da5", checks: "4378d348ff4e01f1", kml: "0bf3d0d7db5c427f", mail: "0d1850c2a21cbd66", snapshot: "418d94a3df67e0e7", queries: "347963f8f76c2957" },
};
test("מעגל זהה בייט-בבייט: ניתוח, טופס, בדיקות, KML, מייל, תמונת מצב ושאילתות — חמש נקודות לדוגמה", () => {
  const got = Object.fromEntries(run());
  assert.deepEqual(got, GOLD);
});
