(() => {
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language || ""];
  const forcedLanguage = new URLSearchParams(location.search).get("lang");
  if (forcedLanguage === "he" || forcedLanguage === "en") {
    localStorage.setItem("lehem_dashboard_language", forcedLanguage);
  }
  const savedLanguage = localStorage.getItem("lehem_dashboard_language");
  const selectedLanguage = forcedLanguage || savedLanguage || "";
  const isHebrew = selectedLanguage
    ? selectedLanguage.toLowerCase().startsWith("he")
    : languages.some((language) => String(language).toLowerCase().startsWith("he"));

  document.documentElement.lang = isHebrew ? "he" : "en";
  document.documentElement.dir = isHebrew ? "rtl" : "ltr";

  if (isHebrew) return;

  const translations = new Map(Object.entries({
    "בוט לחם": "Lehem Bot",
    "דאשבורד ניהול דיסקורד": "Discord management dashboard",
    "החלף חשבון": "Switch account",
    "התנתק": "Log out",
    "כניסה עם Discord": "Login with Discord",
    "הוספת בוט לחם לשרת": "Add Lehem Bot to your server",
    "הדאשבורד הרשמי לניהול הבוט לחם: טיקטים, אימות, הודעות ברוכים הבאים, עזרה וקרבות אדיטים.": "The official dashboard for managing Lehem Bot: tickets, verification, welcome messages, help, and edit battles.",
    "השרתים שלי": "My servers",
    "בחר שרת כדי לערוך את ההגדרות שלו. רק שרתים שבהם יש לך Administrator מופיעים כאן.": "Choose a server to edit its settings. Only servers where you have Administrator permission appear here.",
    "אין שרתים זמינים": "No servers available",
    "אין לך שרתים שבהם יש לך Administrator, או שהבוט עוד לא נמצא בשרת.": "You do not have servers where you have Administrator permission, or the bot is not in the server yet.",
    "פתח הגדרות": "Open settings",
    "חזרה": "Back",
    "נשמר": "Saved",
    "ההגדרות נשמרו.": "Settings saved.",
    "דף בית": "Home",
    "הפעלה / ביטול": "Enable / Disable",
    "טיקטים": "Tickets",
    "אימות": "Verify",
    "ברוכים הבאים": "Welcome",
    "מוזיקה": "Music",
    "אבטחה": "Security",
    "עזרה": "Help",
    "חדר קרב": "Battle Room",
    "שמור הגדרות": "Save settings",
    "ניהול השרת דרך הדאשבורד של לחם. מכאן עוברים למדורים בצד ומגדירים טיקטים, אימות, Welcome ושאר המערכות בלי להתבלבל.": "Manage your server through the Lehem dashboard. Use the side sections to configure tickets, verification, Welcome, and the rest of the systems clearly.",
    "פעיל": "Enabled",
    "כבוי": "Disabled",
    "מערכת טיקטים": "Ticket system",
    "חסימת קללות ואנטי ספאם": "Bad words filter and anti-spam",
    "מערכת מוזיקה": "Music system",
    "ההודעה הראשית": "Main message",
    "כותרת ההודעה": "Message title",
    "טקסט ההודעה": "Message text",
    "תמונה להודעת הטיקטים": "Ticket message image",
    "או העלאת תמונה מהמחשב": "Or upload an image from your computer",
    "איך להציג את נושאי הטיקטים": "How to show ticket topics",
    "כפתורים": "Buttons",
    "רשימה נפתחת": "Dropdown",
    "חדר שבו תופיע הודעת הטיקטים": "Channel for the ticket message",
    "שלח הודעת טיקטים עכשיו": "Send ticket message now",
    "איך לקרוא לחדר שנפתח": "Ticket channel name format",
    "לפי מספר הטיקט": "By ticket number",
    "לפי שם המשתמש": "By username",
    "לפי הנושא שעליו פתחו": "By selected topic",
    "סוגי טיקטים וכפתורים": "Ticket types and buttons",
    "אפשר להוסיף כמה סוגי טיקטים שרוצים. כל שורה כאן הופכת לכפתור בהודעת הטיקטים.": "You can add as many ticket types as you want. Each row becomes a button in the ticket message.",
    "הוסף סוג טיקט": "Add ticket type",
    "סוג טיקט חדש": "New ticket type",
    "שם הכפתור": "Button label",
    "צבע הכפתור": "Button color",
    "כחול": "Blue",
    "אפור": "Gray",
    "ירוק": "Green",
    "אדום": "Red",
    "תחילת שם החדר": "Channel name prefix",
    "כותרת בתוך הטיקט": "Title inside the ticket",
    "הודעה בתוך הטיקט": "Message inside the ticket",
    "מחק סוג טיקט": "Delete ticket type",
    "הרשאות ומיקום": "Permissions and location",
    "קטגוריית טיקטים": "Ticket category",
    "חדר Transcript לטיקטים": "Ticket transcript channel",
    "רול שיכול לפתוח טיקט": "Role that can open tickets",
    "רולים שיכולים לקחת/לסגור טיקט": "Roles that can claim/close tickets",
    "רול Verify": "Verify role",
    "חדר הודעת Verify": "Verify message channel",
    "טקסט הודעת Verify": "Verify message text",
    "צבע ההודעה": "Message color",
    "תמונה בהודעת Verify": "Image in Verify message",
    "שלח הודעת Verify עכשיו": "Send Verify message now",
    "חדר Welcome": "Welcome channel",
    "הודעת Welcome": "Welcome message",
    "אפשר להשתמש ב־{user}, {username}, {server} בתוך ההודעה.": "You can use {user}, {username}, and {server} inside the message.",
    "תמונה בהודעת Welcome": "Image in Welcome message",
    "שלח הודעת Welcome עכשיו": "Send Welcome message now",
    "מערכת העזרה משתמשת ברולי הצוות שהגדרת במדור הטיקטים. מי שיש לו אחד מהרולים האלה יכול לקחת פניות עזרה.": "The help system uses the staff roles configured in the Tickets section. Anyone with one of these roles can claim help requests.",
    "פקודות המוזיקה עובדות בחדר קול. המשתמש צריך להיות בשיחה ואז להשתמש בפקודות האלה בדיסקורד.": "Music commands work in voice channels. The user must be in a voice channel and then use these Discord commands.",
    "ניגון שיר מקישור": "Play a song from a link",
    "הצגת התור": "Show the queue",
    "דילוג לשיר הבא": "Skip to the next song",
    "עצירה וניקוי התור": "Stop and clear the queue",
    "הוצאת הבוט מהשיחה": "Make the bot leave the voice channel",
    "חדר לוגים": "Log channel",
    "חסימת קללות": "Bad words filter",
    "מילים אסורות": "Blocked words",
    "אפשר להגדיר עד 15 מילים אסורות.": "You can configure up to 15 blocked words.",
    "הודעה למשתמש אחרי מחיקה": "Message to the user after deletion",
    "אנטי ספאם": "Anti-spam",
    "כמה הודעות מותר לשלוח": "Allowed message count",
    "בתוך כמה שניות": "Within how many seconds",
    "הודעה למשתמש אחרי ספאם": "Message to the user after spam",
    "חדר ההגרלות": "Giveaway channel",
    "פרס": "Prize",
    "תיאור ההגרלה": "Giveaway description",
    "מספר זוכים": "Winner count",
    "כמה דקות ההגרלה תישאר פתוחה": "How many minutes the giveaway stays open",
    "תמונה להגרלה": "Giveaway image",
    "שלח Giveaway עכשיו": "Send Giveaway now",
    "רירול לזוכה": "Reroll winner",
    "בחר הגרלה שהסתיימה": "Choose an ended giveaway",
    "עשה רירול לזוכה": "Reroll winner",
    "חדר פאנל חדר קרב": "Battle Room panel channel",
    "שלח פאנל חדר קרב עכשיו": "Send Battle Room panel now",
    "לא נשלח": "Not sent",
    "צריך לבחור חדר תקין לפאנל חדר קרב.": "Choose a valid channel for the Battle Room panel.",
    "פאנל חדר קרב נשלח לחדר שבחרת.": "Battle Room panel was sent to the selected channel.",
    "נשלח": "Sent",
  }));

  const placeholders = new Map(Object.entries({
    "פתיחת טיקטים": "Open tickets",
    "כתוב כאן מה המשתמשים צריכים לדעת לפני פתיחת טיקט.": "Write what users should know before opening a ticket.",
    "החדר שבו מריצים /setup-ticket": "The channel where the ticket panel appears",
    "צור אוטומטית / בלי קטגוריה": "Create automatically / no category",
    "לא לשלוח Transcript": "Do not send transcript",
    "כולם יכולים לפתוח": "Everyone can open",
    "לא מוגדר": "Not configured",
    "בחר חדר לשליחה מהאתר": "Choose a channel to send from the website",
    "כדי להיות מאומתים לחצו על הכפתור": "Click the button to get verified",
    "כל מילה בשורה נפרדת": "One word per line",
    "ההודעה נמחקה כי היא כוללת מילה אסורה.": "The message was deleted because it contains a blocked word.",
    "נא לא להספים.": "Please do not spam.",
    "בחר חדר לשליחת הגרלה": "Choose a channel for the giveaway",
    "לחצו על הכפתור כדי להשתתף בהגרלה.": "Click the button to join the giveaway.",
    "אין הגרלות שהסתיימו": "No ended giveaways",
    "החדר שבו מפעילים": "The channel where the panel appears",
  }));

  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const translate = (value) => translations.get(normalize(value)) || placeholders.get(normalize(value)) || value;

  function translateTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || ["SCRIPT", "STYLE", "TEXTAREA", "CODE", "PRE"].includes(parent.tagName)) {
          return NodeFilter.FILTER_REJECT;
        }
        return normalize(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const translated = translate(node.nodeValue);
      if (translated !== node.nodeValue) node.nodeValue = translated;
    });
  }

  function translateAttributes(root) {
    root.querySelectorAll("[placeholder], [alt], [title]").forEach((element) => {
      ["placeholder", "alt", "title"].forEach((attribute) => {
        const value = element.getAttribute(attribute);
        if (!value) return;
        const translated = translate(value);
        if (translated !== value) element.setAttribute(attribute, translated);
      });
    });
  }

  function translatePage() {
    document.body.classList.add("is-english");
    translateTextNodes(document.body);
    translateAttributes(document.body);
  }

  document.addEventListener("DOMContentLoaded", () => {
    translatePage();
    setTimeout(translatePage, 0);
  });
})();
