# מפת נוט"מ — התקנה אוטומטית מלאה דרך GitHub (חינם)

## מה מקבלים בסוף
- המפה חיה בכתובת קבועה: `https://שם-המשתמש.github.io/notam-map/`
- כל בוקר ב-06:30 GitHub מושך לבד נתונים טריים מרש"ת ומעדכן את המפה
- באתר Wix מטמיעים שורה אחת בלבד (iframe) — בלי להדביק קוד ארוך
- אפס תחזוקה, אפס עלות

## הקבצים בחבילה
| קובץ | תפקיד |
|---|---|
| `index.html` | דף המפה (הפרונטנד) |
| `notam-data.json` | הנתונים — מתעדכן אוטומטית כל יום |
| `updater.py` | המנוע שמושך מרש"ת ומתרגם |
| `.github/workflows/update.yml` | התזמון היומי של GitHub Actions |

---

## התקנה — 6 שלבים (כ-20 דקות, פעם אחת בלבד)

### שלב 1 — חשבון GitHub
נכנסים ל-github.com → **Sign up** → נרשמים עם אימייל של הארגון. (אם כבר יש חשבון — מדלגים.)

### שלב 2 — יצירת מאגר (Repository)
לוחצים על **+** בפינה הימנית העליונה → **New repository**:
- **Repository name**: `notam-map`
- בוחרים **Public** (חובה — כדי ש-GitHub Pages יעבוד בחינם)
- מסמנים ✅ **Add a README file**
- לוחצים **Create repository**

### שלב 3 — העלאת הקבצים
בתוך המאגר: **Add file → Upload files** → גוררים לחלון את **כל** תוכן ה-ZIP:
`index.html` , `notam-data.json` , `updater.py` **וגם את התיקייה** `.github` (גוררים את התיקייה כולה — הדפדפן יודע להעלות תיקיות).
למטה לוחצים **Commit changes**.

> אם התיקייה `.github` לא עולה בגרירה: לוחצים **Add file → Create new file**, בשם הקובץ מקלידים בדיוק `.github/workflows/update.yml` (הלוכסנים יוצרים את התיקיות), מדביקים את תוכן הקובץ, ו-**Commit**.

### שלב 4 — הפעלת האתר (GitHub Pages)
במאגר: **Settings → Pages** (בתפריט הצד):
- תחת **Source** בוחרים: **Deploy from a branch**
- **Branch**: `main` , תיקייה `/ (root)` → **Save**
- אחרי 1–2 דקות תופיע למעלה הכתובת: `https://שם-המשתמש.github.io/notam-map/`
- נכנסים אליה — המפה באוויר! 🎉

### שלב 5 — בדיקת העדכון האוטומטי
במאגר: לשונית **Actions** → אם מופיע כפתור אישור ("I understand… enable them") לוחצים עליו → בצד בוחרים **עדכון נוטמים יומי** → **Run workflow → Run workflow**.
- תוך כדקה תראו ריצה עם ✅ ירוק — סימן שהמשיכה מרש"ת עבדה והנתונים התעדכנו
- אם מופיע ❌ אדום — לוחצים על הריצה ורואים את השגיאה (ראו "פתרון תקלות" למטה)
- מכאן והלאה זה רץ לבד כל בוקר — לא צריך לגעת יותר

### שלב 6 — הטמעה באתר Wix (שורה אחת!)
בעורך Wix: **Add → Embed Code → Embed HTML → Enter Code** ומדביקים רק את זה:

```html
<iframe src="https://שם-המשתמש.github.io/notam-map/"
        style="width:100%;height:100%;border:none" loading="lazy"></iframe>
```

(מחליפים את `שם-המשתמש` בשם האמיתי מהכתובת של שלב 4.)
מותחים את התיבה על כל הדף → **Publish**. מעכשיו האתר תמיד מציג את הגרסה העדכנית — בלי להדביק קוד מחדש לעולם.

---

## פתרון תקלות

**הריצה ב-Actions נכשלת עם שגיאת רשת / "הרשימה לא נטענה"**
כנראה חומת האש של רש"ת חוסמת את שרתי GitHub. פתרון: מריצים את `updater.py` ממחשב רגיל בארץ (פייתון מותקן → `python updater.py`) ומעלים את `notam-data.json` שנוצר למאגר (Upload files → Commit). אפשר לתזמן את זה ב-Windows Task Scheduler — והמפה עדיין מתעדכנת אוטומטית לכל הגולשים.

**המפה עולה אבל בלי מפת לוויין**
זה קורה רק בתצוגות מוטמעות מסוימות; בכתובת GitHub Pages הישירה הלוויין עובד תמיד.

**רוצים לעדכן ידנית עכשיו**
Actions → עדכון נוטמים יומי → Run workflow. תוך דקה הכל טרי.

---

© הארגון הישראלי לרחפנים · icd.org.il · לכל בעיה טכנית: 052-5076677

---

## בקשות טיסה (בקשת סגירה אווירית — נספח ג׳ לפמ״ת א-11)

כפתור **📝 בקשות טיסה** במפת החברים פותח את `members-k38p/requests/` — טופס עם שדות חובה, וממנו המערכת מריצה את כל הבדיקות (א-17, רט״ג, מנחתים חקלאיים, נוטמים, סריקת מכשולים ותשתיות סביב הנקודה) ומפיקה Word, KML, הדמיות ותצ״א. הכניסה לדף בשם משתמש וסיסמה נפרדים (ניהול משתמשים, חסימה והחלפת סיסמה), והשמירה לדרייב אוטומטית — ראו `apps-script/README.md`.

**מקור יחיד לנתונים:**
| נתון | מקור | קובץ |
|---|---|---|
| אזורי א-17 (147 + 16 אזורי LLR בקירוב) | המפה עצמה (`members-k38p/index.html`) | `members-k38p/data/zones.json` — נגזר אוטומטית ב-`scripts/export-zones.mjs` (workflow ‏`zones-export.yml`) |
| שמורות וגנים | `members-k38p/data/inpa-zones.json` | — |
| מנחתים חקלאיים | טבלת הארגון | `members-k38p/data/agri-airstrips.json` |
| כל הנוטמים הפנים-ארציים | `updater.py` ← `notam_all.py` | `notam-all.json` (`notam-data.json` של המפה לא משתנה) |

בדיקות: `node --test tests/zones.test.mjs tests/apps-script.test.mjs tests/requests/core.test.mjs`, `python -m unittest tests/test_notam_all.py`, ובדיקת דפדפן `node tests/requests/e2e.mjs`.
