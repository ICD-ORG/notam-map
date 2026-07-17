# -*- coding: utf-8 -*-
"""
updater.py — תוכנית ב': מחולל notam-data.json מאתר רש"ת
הארגון הישראלי לרחפנים · icd.org.il

שימוש: python updater.py
פלט:  notam-data.json (להעלאה לאתר לצד notam-map.html)
תזמון אוטומטי: Windows Task Scheduler / cron, פעם ביום.
"""
import re, json, time, urllib.request, urllib.parse, datetime, html as H

LIST_URL = 'https://brin.iaa.gov.il/aeroinfo/AeroInfo.aspx?msgType=Notam'
HDRS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Referer': LIST_URL}

PHRASES = [
 ('UAS/UAV ACT WILL TAKE PLACE AT','פעילות כטב"מ/רחפנים תתקיים ב'),
 ('UAS ACT WILL TAKE PLACE AT','פעילות כטב"מ תתקיים ב'),
 ('UAS ACT WILL TAKE PLACE WI AIRSTRIP','פעילות כטב"מ תתקיים בתוך המנחת'),
 ('AN AREA BTN THE FLW PSNS','אזור בין נקודות הציון הבאות'),
 ('AN AREA BTN THE FLW PSN','אזור בין נקודות הציון הבאות'),
 ('AN AREA BTN FLW PSN','אזור בין נקודות הציון הבאות'),
 ('CLSD BTN FLW PSN','סגור בין נקודות הציון הבאות'),
 ('BTN FLW PSN','בין נקודות הציון הבאות'),
 ('RADIUS CENTERED ON PSN','רדיוס שמרכזו בנ.צ.'),
 ('CENTERED ON PSN','שמרכזו בנ.צ.'),
 ('AN AREA AT','אזור ב'),('AN AREA WI','אזור בתוך'),('AN AREA FM','אזור מ'),
 ('CLSD TO ALL FLT INCLUDING AGRICULTURE FLT','סגור לכל הטיסות כולל טיסות ריסוס חקלאיות'),
 ('CLSD TO ALL FLT INCLUDING','סגור לכל הטיסות כולל'),
 ('CLSD TO ALL FLT','סגור לכל הטיסות'),
 ('TO ALL FLT','לכל הטיסות'),
 ('CLSD FM GND UP TO','סגור מהקרקע ועד'),
 ('FM GND UP TO','מהקרקע ועד'),('FM GND UP','מהקרקע ועד'),
 ('OPS WILL BE COORD AND APPROVED BY ATC','הפעילות תתואם ותאושר ע"י בקרת התעופה'),
 ('OPS OF AGRICULTURE FLT AVBL WITH 15MIN PPR FM ATC','טיסות ריסוס יתאפשרו באישור מוקדם של 15 דק\' מהבקרה'),
 ('OPS OF AGRICULTURE FLT WITH 15MIN PPR FM ATC','טיסות ריסוס באישור מוקדם של 15 דק\' מהבקרה'),
 ('OPS OF AGRICULTURE FLT','טיסות ריסוס חקלאיות'),
 ('AGRICULTURE FLT','טיסות ריסוס חקלאיות'),
 ('OPS AVBL WITH PPR FM ATC ONLY','הפעלה באישור מוקדם מהבקרה בלבד'),
 ('BY PPR FM ATC','באישור מוקדם מבקרת התעופה'),
 ('PPR FM ATC','אישור מוקדם מבקרת התעופה'),
 ('XNG CLOSURE BY PPR FM FLW','חציית הסגירה באישור מוקדם מהגורמים הבאים'),
 ('CTN ADZ','מומלצת זהירות'),
 ('FT AMSL','רגל מעל פני הים'),('FT AGL','רגל מעל הקרקע'),('M AGL','מטר מעל הקרקע'),
 ('NM RADIUS','מייל ימי רדיוס'),('KM RADIUS','ק"מ רדיוס'),('M RADIUS','מטר רדיוס'),
 ('ULTRALIGHT BUBBLE','בועת זעירים'),('MODEL ACFT','טיסנים'),('TRG AREA','אזור אימונים'),
 ('DOM FLT','טיסות פנים-ארציות'),('MIL FLT','טיסות צבאיות'),
 ('PROHIBITED','אסור'),('EXC','למעט'),('INCLUDING','כולל'),
 ('FLW PSN','נקודות הציון הבאות'),('PSN','נ.צ.'),('CLSD','סגור'),('BTN','בין'),
 ('OPS OF','הפעלת'),('HEL','מסוקים'),('FLT','טיסות'),('UP TO','עד'),
 (' AT ',' ב-'),(' WI ',' בתוך '),(' FM ',' מ-'),
]

def http_get(url):
    req = urllib.request.Request(url, headers=HDRS)
    return urllib.request.urlopen(req, timeout=90).read().decode('utf-8', 'ignore')

def collect_fields(page):
    fields = {}
    for m in re.finditer(r'<input[^>]*name="([^"]+)"[^>]*>', page):
        tag, name = m.group(0), m.group(1)
        vm = re.search(r'value="([^"]*)"', tag)
        tp = re.search(r'type="([^"]*)"', tag); t = tp.group(1) if tp else 'text'
        if t in ('checkbox', 'radio'):
            if 'checked' in tag: fields[name] = vm.group(1) if vm else 'on'
        elif t not in ('submit', 'button'):
            fields[name] = vm.group(1) if vm else ''
    return fields

def fetch_detail(fields0, num):
    f = dict(fields0)
    f.update({'hidMsgNum': num, 'hidMode': 'more', 'hidCurOrHist': 'Current',
              'hidTblClientId': '', 'btnMoreInfo': 'btnMoreInfo'})
    body = urllib.parse.urlencode(f).encode()
    req = urllib.request.Request(LIST_URL, data=body,
        headers={**HDRS, 'Content-Type': 'application/x-www-form-urlencoded'})
    out = urllib.request.urlopen(req, timeout=90).read().decode('utf-8', 'ignore')
    m = re.search(r"\(([A-Z]\d{4}/\d{2}\s+NOTAM[NRC][\s\S]*?)'\);", out)
    if not m: return None
    txt = m.group(1)
    txt = txt.replace('</MsgText><MsgText>', '\n')
    txt = re.sub(r'</?Msg(Text)?>', '', txt)
    txt = txt.replace('\\r\\n', '\n').replace('\\n', '\n').replace("\\'", "'")
    txt = re.sub(r'[ \t]+\n', '\n', txt)
    return txt.strip()

def fmt_coord(a, b, c, d, e, f):
    return f"{int(a)}°{int(b):02d}'{round(float(c)):02d}\"N {int(d)}°{int(e):02d}'{round(float(f)):02d}\"E"

def translate(raw, e_text):
    t = ' ' + re.sub(r'\s+', ' ', e_text).strip() + ' '
    t = re.sub(r'(\d{2})(\d{2})(\d{2}(?:\.\d+)?)N\s?0?(\d{2})(\d{2})(\d{2}(?:\.\d+)?)E',
               lambda m: fmt_coord(*m.groups()), t)
    t = re.sub(r'N(\d{2})(\d{2})(\d{2}(?:\.\d+)?)E\s?0?(\d{2})(\d{2})(\d{2}(?:\.\d+)?)',
               lambda m: fmt_coord(*m.groups()), t)
    for en, he in PHRASES: t = t.replace(en, he)
    t = re.sub(r'\s+,', ',', t); t = re.sub(r'\s+\.', '.', t); t = re.sub(r'\)\s*$', '', t).strip()
    b = re.search(r'B\)\s*(\d{10})', raw); c = re.search(r'C\)\s*(\d{10})', raw)
    perm = bool(re.search(r'C\)\s*PERM', raw))
    fmt = lambda s: f"{s[4:6]}/{s[2:4]}/20{s[0:2]} {s[6:8]}:{s[8:10]} UTC"
    if b:
        t += '\nבתוקף: מ-' + fmt(b.group(1)) + (' (קבוע)' if perm else (' עד ' + fmt(c.group(1)) if c else ''))
    d = re.search(r'D\)\s*([^\n]*)', raw)
    if d: t += '\nלו"ז: ' + d.group(1).strip()
    return t

def main():
    print('מושך רשימת נוטמים...')
    page = http_get(LIST_URL)
    if 'NotamID' not in page:
        raise SystemExit('שגיאה: הרשימה לא נטענה (ייתכן שהכתובת חסומה מהרשת הזו)')

    num_map = {}
    for m in re.finditer(r'divMainInfo_(\d+)"[\s\S]{0,2500}?<td class="NotamID">\s*([A-Z]\d{4}/\d{2})', page):
        num_map.setdefault(m.group(2), m.group(1))

    cells = re.findall(r'<td class="(NotamID|Location|MsgText)">\s*([\s\S]*?)\s*</td>', page)
    previews, locs, cur = {}, {}, None
    i = 0
    while i < len(cells):
        typ, val = cells[i]; val = H.unescape(val).strip()
        if typ == 'NotamID' and val:
            cur = val; previews.setdefault(cur, '')
            if i + 1 < len(cells) and cells[i+1][0] == 'Location':
                locs[cur] = cells[i+1][1].strip(); i += 1
        elif typ == 'MsgText' and cur and val and val != '&nbsp;':
            previews[cur] += ' ' + val
        i += 1

    uas = [k for k, v in previews.items() if re.search(r'\bUAS\b|\bUAV\b', v)]
    print(f'סה"כ {len(previews)} נוטמים, מהם {len(uas)} כטב"מ. מושך פרטים מלאים...')

    fields0 = collect_fields(page)
    notams = []
    for k, nid in enumerate(uas, 1):
        num = num_map.get(nid)
        if not num: continue
        try:
            raw = fetch_detail(fields0, num)
            if not raw: print(f'[{k}/{len(uas)}] {nid} — אין פירוט'); continue
            eM = re.search(r'E\)\s*([\s\S]*?)(?=\n[FG]\)|$)', raw)
            e_text = eM.group(1).strip() if eM else raw
            nm = re.search(r'AT\s+([A-Z][A-Z0-9\-/ ]{2,40}?)(?:[,\.\n]|$)', e_text)
            name = nm.group(1).strip() if nm else nid
            notams.append({'id': nid, 'loc': locs.get(nid, ''), 'name': name,
                           'heb': translate(raw, e_text), 'raw': raw})
            print(f'[{k}/{len(uas)}] {nid} — OK')
            time.sleep(1.0)
        except Exception as e:
            print(f'[{k}/{len(uas)}] {nid} — שגיאה: {e}')

    now = datetime.datetime.now(datetime.timezone.utc)
    out = {'fetched_at': now.strftime('%d/%m/%Y %H:%M UTC'),
           'fetched_iso': now.strftime('%Y-%m-%dT%H:%M:%SZ'),
           'count': len(notams), 'notams': notams}
    with open('notam-data.json', 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f'נשמר notam-data.json עם {len(notams)} נוטמים. העלו את הקובץ לאתר.')

if __name__ == '__main__':
    main()
