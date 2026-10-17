# -*- coding: utf-8 -*-
"""notam_all.py — כל הנוט"מים הפנים-ארציים (לא רק כטב"ם) לצורך בדיקות בקשות הטיסה.
הקובץ notam-data.json שמזין את המפה נשאר כמות שהוא; כאן נכתב קובץ נפרד notam-all.json.
נוט"ם שכבר נמשך בעבר לא נמשך שוב (המספר שלו קבוע); רק חדשים נמשכים, ולכן הריצה קלה."""
import json, re, time
import notam_translate as NT

def e_text_of(raw):
    m = re.search(r'E\)\s*([\s\S]*?)(?=\n[FG]\)|$)', raw)
    return m.group(1).strip() if m else raw

def collect(ids, locs, fetch, prev_raw, have_raw, pause=0.6, sleep=time.sleep):
    """ids: כל המספרים ברשימה. fetch(id)->raw|None. prev_raw / have_raw: מילונים id->raw שכבר ידועים.
    מחזיר (notams, failed). נוט"ם שלא נמשך נרשם ב-failed — אין מדלגים בשקט."""
    out, failed = [], []
    for nid in ids:
        raw = have_raw.get(nid) or prev_raw.get(nid)
        if not raw:
            try:
                raw = fetch(nid)
            except Exception:
                raw = None
            if not raw:
                failed.append(nid)
                continue
            sleep(pause)
        et = e_text_of(raw)
        heb = NT.translate(raw, et)
        out.append({'id': nid, 'loc': locs.get(nid, ''), 'name': NT.make_name(raw, et, nid, heb), 'heb': heb, 'raw': raw})
    return out, failed

def load_prev_raw(path):
    try:
        with open(path, encoding='utf-8') as f:
            d = json.load(f)
        return {n['id']: n['raw'] for n in d.get('notams', []) if n.get('id') and n.get('raw')}
    except Exception:
        return {}

def write(path, notams, failed, listed, fetched_iso, fetched_at):
    out = {'fetched_at': fetched_at, 'fetched_iso': fetched_iso, 'listed': listed,
           'count': len(notams), 'failed': failed, 'notams': notams}
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    return out
