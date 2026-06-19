# Discord Verify, Help & Tickets Bot

בוט Discord הכולל:

- אימות משתמשים באמצעות כפתור ותפקיד.
- הודעת ברוכים הבאים.
- בקשת עזרה באמצעות `/help` או `!help` בזמן שיחת קול.
- מערכת טיקטים לדיווח על שחקנים, כולל לקיחה וסגירה בידי הצוות.

## התקנה

1. מתקינים Node.js בגרסה 18 ומעלה.
2. מריצים `npm install`.
3. מעתיקים את `.env.example` לקובץ בשם `.env` וממלאים את הערכים.
4. מריצים `npm run deploy` לרישום פקודות ה־Slash.
5. מריצים `npm start`.
6. בתוך Discord מריצים `/setup-verify` ו־`/setup-ticket` בערוצים המתאימים.

## פריסת פקודות

ברירת המחדל היא פריסה גלובלית, המתאימה לבוט ציבורי. עדכון פקודות גלובליות עשוי לקחת זמן עד שיופיע בכל השרתים.

לבדיקה מיידית בשרת אחד, מגדירים `DEPLOY_SCOPE=guild` וממלאים `GUILD_ID`.

## הרשאות נדרשות

- View Channels
- Send Messages
- Read Message History
- Manage Roles
- Manage Channels

תפקיד הבוט חייב להימצא מעל תפקיד האימות. בנוסף יש להפעיל ב־Discord Developer Portal את **Server Members Intent** ואת **Message Content Intent**.

## אבטחה

אין להעלות או לשלוח את `.env`, משום שהוא מכיל את טוקן הבוט. אם הטוקן נחשף, יש לאפס אותו מיד ב־Discord Developer Portal.
