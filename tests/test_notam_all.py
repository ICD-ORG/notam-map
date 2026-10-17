# בדיקות notam_all: כל נוט"ם נרשם או מדווח ככשל; נוט"ם מוכר לא נמשך שוב; התרגום עובר דרך המילון המשותף.
import json, os, sys, tempfile, unittest
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import notam_all

RAW1 = ("C0431/26 NOTAMN\nQ) LLLL/QRDCA/IV/BO /W /000/003/3204N03447E005\nA) LLLL B) 2602111125 C) PERM\n"
        "E) OPS OF UAS/UAV OR MODEL ACFT WI 500M RADIUS CENTERED ON PSN 320418N0344710E\nFM GND UP TO 300FT AMSL PROHIBITED.\nF) GND G) 300FT AMSL")
RAW2 = ("C1111/26 NOTAMN\nQ) LLLL/QRTCA/IV/BO /W /000/050/3200N03450E010\nA) LLLL B) 2610170600 C) 2610171800\n"
        "E) PJE WILL TAKE PLACE WI 5NM RADIUS CENTERED ON PSN 320000N0345000E\nF) GND G) 5000FT AMSL")

class T(unittest.TestCase):
    def test_all_listed_are_collected(self):
        calls = []
        fetch = lambda nid: (calls.append(nid) or {'C0431/26': RAW1, 'C1111/26': RAW2}[nid])
        out, failed = notam_all.collect(['C0431/26', 'C1111/26'], {'C0431/26': 'LLLL'}, fetch, {}, {}, pause=0, sleep=lambda s: None)
        self.assertEqual([n['id'] for n in out], ['C0431/26', 'C1111/26'])
        self.assertEqual(failed, [])
        self.assertEqual(out[0]['loc'], 'LLLL')
        self.assertTrue(all(n['raw'] and n['heb'] for n in out))

    def test_known_ids_are_not_fetched_again(self):
        calls = []
        fetch = lambda nid: (calls.append(nid) or RAW2)
        out, failed = notam_all.collect(['C0431/26', 'C1111/26'], {}, fetch, {'C0431/26': RAW1}, {}, pause=0, sleep=lambda s: None)
        self.assertEqual(calls, ['C1111/26'])
        self.assertEqual(len(out), 2)

    def test_have_raw_from_current_run_is_reused(self):
        calls = []
        out, failed = notam_all.collect(['C0431/26'], {}, lambda n: calls.append(n), {}, {'C0431/26': RAW1}, pause=0, sleep=lambda s: None)
        self.assertEqual(calls, [])
        self.assertEqual(len(out), 1)

    def test_failed_fetch_is_reported_not_skipped_silently(self):
        def fetch(nid):
            if nid == 'C1111/26': raise RuntimeError('boom')
            return RAW1
        out, failed = notam_all.collect(['C0431/26', 'C1111/26', 'C9999/26'], {}, lambda n: fetch(n) if n != 'C9999/26' else None, {}, {}, pause=0, sleep=lambda s: None)
        self.assertEqual([n['id'] for n in out], ['C0431/26'])
        self.assertEqual(failed, ['C1111/26', 'C9999/26'])

    def test_write_and_reload_roundtrip(self):
        out, failed = notam_all.collect(['C0431/26'], {}, lambda n: RAW1, {}, {}, pause=0, sleep=lambda s: None)
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, 'notam-all.json')
            notam_all.write(p, out, failed, 1, '2026-10-17T06:00:00Z', '17/10/2026 06:00 UTC')
            data = json.load(open(p, encoding='utf-8'))
            self.assertEqual((data['listed'], data['count'], data['failed']), (1, 1, []))
            self.assertEqual(notam_all.load_prev_raw(p), {'C0431/26': RAW1})

    def test_translation_uses_shared_dictionary(self):
        out, _ = notam_all.collect(['C0431/26'], {}, lambda n: RAW1, {}, {}, pause=0, sleep=lambda s: None)
        self.assertIn('500', out[0]['heb'])
        self.assertNotIn(' OR ', out[0]['heb'])

if __name__ == '__main__':
    unittest.main()
