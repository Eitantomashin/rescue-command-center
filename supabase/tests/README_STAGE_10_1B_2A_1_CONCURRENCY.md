# Stage 10.1B.2A.1 — בדיקות תחרות אוטומטיות

ה־runner מחייב container מקומי בשם `supabase_db_Rescue_Command_Center` ומריץ שני תהליכי `psql` נפרדים דרך Docker. לכן הפעולות המתחרות מתקיימות בשתי התחברויות PostgreSQL אמיתיות.

לפני הרצה יש לוודא ידנית שזהו Docker מקומי ומבודד, ושהמיגרציות עד `20261009130000_ad_hoc_team_operational_assignment_engine.sql` כבר הוחלו רק מקומית. אין להריץ מול ענן, Supabase מקושר, staging או production.

```powershell
node supabase/tests/run-stage-10-1b-2a-1-concurrency.cjs --local-docker --disposable-database --confirm-container=supabase_db_Rescue_Command_Center
```

## הגנות בטיחות ובידוד

ה־runner נכשל כברירת מחדל אם חסר אחד משלושת הדגלים, אם `supabase/config.toml` אינו מצהיר על `project_id = "Rescue_Command_Center"`, אם ה־container אינו רץ, אם image ה־PostgreSQL אינו של Supabase, אם לתא אין label של פרויקט Supabase מתאים, או אם החיבור הפנימי אינו כמשתמש `postgres` למסד `postgres`. הדגל `--disposable-database` הוא הצהרה מפורשת שהמסד המקומי כולו ניתן להשלכה לאחר הבדיקה.

ה־fixtures חייבים `COMMIT` כדי ששתי ההתחברויות יראו אותם. כל ה־UUIDים נוצרים מראש ב־Node.js, לפני ה־INSERT הראשון. אין `TRUNCATE`, אין reset ואין מחיקה רחבה מתוך ה־runner.

`event_logs` הם audit בלתי ניתן לשינוי, ו־`event_logs.incident_id` אינו תלוי ב־cascade delete. לכן ה־runner אינו מוחק fixtures כלל: לאחר כל תרחיש הוא מדפיס את תג ה־fixture ומותיר את הרשומות במסד המקומי החד־פעמי. ניקוי תקין הוא השלכת סביבת המסד המקומית כולה לאחר סיום הסוויטה, בתהליך סביבתי מאושר ונפרד מה־runner. כך אין עקיפה של טריגרי audit, של מנגנון purge, או של מחיקה היסטורית.

הכיסוי כולל:

1. הוספת אדם אחר לצוות יעד במקביל להעברת חבר קיים.
2. העברה מול החזרה של מזהה חברות המקור.
3. ארכוב צוות ריק מול הוספה אליו.
4. עדכון נוכחות ישיר מול הוספה.
5. עדכון נוכחות ישיר מול העברה.

`40P01`, `55P03` ו־`57014` נחשבים תמיד כישלון, גם אם הפעולה העסקית לוכדת חריגה ומדפיסה `RESULT`. לכל תרחיש ה־runner ממתין עם `Promise.allSettled` לשתי ה־sessions, בודק את תוצאת שתיהן, ורק אז מאמת מצב סופי ומתחיל cleanup.

## טיפול בכשל והרצה ראשונה מאושרת

אם הריצה נכשלת, אין להריץ אותה שוב אוטומטית. יש לשמור את שורת `Fixture retained` או `FIXTURE MAY BE RETAINED` ואת תג ה־fixture. ניתן לבדוק את הרשומות במסד **המקומי בלבד** בקריאה בלבד, ולאחר מכן להשליך את סביבת המסד המקומית כולה. כשל בבידוד, timeout, deadlock, או process failure הוא כשל של הבדיקה ולא תוצאת עסקית צפויה.

פקודת PowerShell המומלצת להרצה ראשונה, רק לאחר אישור מפורש ועל Docker מקומי ומבודד:

```powershell
node .\supabase\tests\run-stage-10-1b-2a-1-concurrency.cjs --local-docker --disposable-database --confirm-container=supabase_db_Rescue_Command_Center
```
