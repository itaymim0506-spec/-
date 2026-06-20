require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const { ChannelType, Client, GatewayIntentBits } = require("discord.js");
const { DEFAULT_CONFIG, getGuildConfig, setGuildConfig } = require("./config-store");

const PORT = Number(process.env.PORT || process.env.DASHBOARD_PORT || 3000);
const BASE_URL = (process.env.DASHBOARD_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const DISCORD_CLIENT_SECRET = String(process.env.DISCORD_CLIENT_SECRET || process.env.CLIENT_SECRET || "").trim();
const DISCORD_REDIRECT_URI = `${BASE_URL}/auth/discord/callback`;
const DISCORD_TOKEN = String(process.env.DISCORD_TOKEN || "")
  .trim()
  .replace(/^Bot\s+/i, "");
const ADMINISTRATOR_PERMISSION = 8n;
const sessions = new Map();
const oauthStates = new Set();

const app = express();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

app.use(express.urlencoded({ extended: true }));

function parseIds(value) {
  return String(value || "")
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function checkbox(name, label, checked) {
  return `<label class="check"><input type="checkbox" name="${name}" value="1" ${checked ? "checked" : ""}> ${label}</label>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function option(value, label, selected = false) {
  return `<option value="${escapeHtml(value)}" ${selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function select(name, items, selectedValue, emptyLabel = "לא מוגדר") {
  return `<select name="${name}">
    ${option("", emptyLabel, !selectedValue)}
    ${items.map((item) => option(item.id, item.label, item.id === selectedValue)).join("")}
  </select>`;
}

function multiSelect(name, items, selectedValues) {
  const selectedSet = new Set(selectedValues || []);
  return `<select name="${name}" multiple size="${Math.min(Math.max(items.length, 4), 10)}">
    ${items.map((item) => option(item.id, item.label, selectedSet.has(item.id))).join("")}
  </select>
  <p class="muted">אפשר לבחור כמה רולים עם Ctrl במקלדת.</p>`;
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const [name, ...valueParts] = cookie.split("=");
        return [name, decodeURIComponent(valueParts.join("="))];
      }),
  );
}

function setCookie(res, name, value, options = "") {
  res.append("Set-Cookie", `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/${options}`);
}

function clearCookie(res, name) {
  res.append("Set-Cookie", `${name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function getSession(req) {
  const sessionId = parseCookies(req).dashboard_session;
  return sessionId ? sessions.get(sessionId) : null;
}

function hasGuildAdmin(req, guildId) {
  return getSession(req)?.adminGuildIds?.includes(guildId) ?? false;
}

function requireAuth(req, res, next) {
  if (getSession(req)) return next();
  res.redirect("/login");
}

function requireGuildAdmin(req, res, next) {
  if (hasGuildAdmin(req, req.params.guildId)) return next();
  res.status(403).send(layout("No Access", `<div class="card">You need Administrator in this server to control its bot settings. <a href="/">Back</a></div>`));
}

async function discordFetch(path, accessToken) {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Discord API ${path} failed with ${response.status}`);
  }

  return response.json();
}

async function exchangeDiscordCode(code) {
  const response = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.CLIENT_ID,
      client_secret: DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: DISCORD_REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Discord token exchange failed with ${response.status}: ${errorBody}`);
  }

  return response.json();
}

function getAdminGuildIds(discordGuilds) {
  return discordGuilds
    .filter((guild) => (BigInt(guild.permissions || 0) & ADMINISTRATOR_PERMISSION) === ADMINISTRATOR_PERMISSION)
    .map((guild) => guild.id);
}

function getDiscordLoginUrl(state) {
  const authorizeUrl = new URL("https://discord.com/oauth2/authorize");
  authorizeUrl.searchParams.set("client_id", process.env.CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", DISCORD_REDIRECT_URI);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", "identify guilds");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("prompt", "consent");
  return authorizeUrl.toString();
}

function getBotInviteUrl() {
  const inviteUrl = new URL("https://discord.com/oauth2/authorize");
  inviteUrl.searchParams.set("client_id", process.env.CLIENT_ID || "");
  inviteUrl.searchParams.set("permissions", "8");
  inviteUrl.searchParams.set("scope", "bot applications.commands");
  return inviteUrl.toString();
}

function getCategoryOptions(guild) {
  return [...guild.channels.cache.values()]
    .filter((channel) => channel.type === ChannelType.GuildCategory)
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map((channel) => ({ id: channel.id, label: channel.name }));
}

function getTextChannelOptions(guild) {
  return [...guild.channels.cache.values()]
    .filter((channel) => channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map((channel) => ({ id: channel.id, label: `#${channel.name}` }));
}

function getRoleOptions(guild) {
  return [...guild.roles.cache.values()]
    .filter((role) => role.id !== guild.id && !role.managed)
    .sort((a, b) => b.position - a.position)
    .map((role) => ({ id: role.id, label: role.name }));
}

function layout(title, body) {
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="בוט לחם - דאשבורד לניהול בוט דיסקורד, טיקטים, אימות, הודעות ברוכים הבאים ועזרה לצוות.">
  <meta name="keywords" content="בוט לחם, לחם בוט, discord bot, בוט דיסקורד, טיקטים דיסקורד, dashboard discord">
  <meta property="og:title" content="בוט לחם">
  <meta property="og:description" content="דאשבורד לניהול בוט דיסקורד של לחם.">
  <meta property="og:type" content="website">
  <title>${title} | בוט לחם</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #111318; color: #f4f6fb; }
    header { padding: 18px 24px; background: #181b22; border-bottom: 1px solid #2a2f3a; }
    main { max-width: 980px; margin: 0 auto; padding: 24px; }
    a { color: #a78bfa; text-decoration: none; }
    label { display: block; margin: 16px 0 6px; color: #cbd5e1; }
    input, textarea, select { width: 100%; box-sizing: border-box; padding: 11px; border-radius: 6px; border: 1px solid #374151; background: #0f1117; color: #f4f6fb; }
    input[type="checkbox"] { width: auto; margin-left: 8px; }
    textarea { min-height: 120px; direction: ltr; }
    button, .button { display: inline-block; margin-top: 18px; padding: 11px 16px; border: 0; border-radius: 6px; background: #7c3aed; color: white; cursor: pointer; }
    .card { background: #181b22; border: 1px solid #2a2f3a; border-radius: 8px; padding: 18px; margin-bottom: 18px; }
    .muted { color: #94a3b8; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
    .check { display: flex; align-items: center; margin: 10px 0; color: #f4f6fb; }
  </style>
</head>
<body>
  <header><strong>Discord Bot Dashboard</strong></header>
  <main>${body}</main>
</body>
</html>`;
}

app.get("/login", (req, res, next) => {
  if (req.route.path !== "/login") return next();
  const isDiscordLoginReady = Boolean(process.env.CLIENT_ID && DISCORD_CLIENT_SECRET);
  res.send(layout("Login", `
    <div class="card">
      <h2>Discord Bot Dashboard</h2>
      <p class="muted">Login with Discord. Only users with Administrator in a server can manage that server.</p>
      <a class="button" href="/auth/discord">Login with Discord</a>
      <a class="button" href="/invite">Add bot to server</a>
      ${isDiscordLoginReady ? "" : `
        <p class="muted">Discord login needs one more setup step before it can finish logging in.</p>
        <p>Add <code>DISCORD_CLIENT_SECRET</code> to your <code>.env</code> file.</p>
        <p class="muted">Redirect URL for Discord Developer Portal:</p>
        <pre>${DISCORD_REDIRECT_URI}</pre>
      `}
    </div>
  `));
});

app.get("/auth/discord", (req, res) => {
  if (!process.env.CLIENT_ID) {
    res.redirect("/login");
    return;
  }

  const state = crypto.randomBytes(24).toString("hex");
  oauthStates.add(state);
  setCookie(res, "discord_oauth_state", state, "; Max-Age=600");

  res.redirect(getDiscordLoginUrl(state));
});

app.get("/invite", (req, res) => {
  if (!process.env.CLIENT_ID) {
    res.redirect("/login");
    return;
  }

  res.redirect(getBotInviteUrl());
});

app.get("/auth/discord/callback", async (req, res) => {
  const { code, state } = req.query;
  const savedState = parseCookies(req).discord_oauth_state;

  if (!code || !state || state !== savedState || !oauthStates.has(state)) {
    res.status(400).send(layout("Login failed", `<div class="card">Invalid Discord login state. <a href="/login">Try again</a></div>`));
    return;
  }

  oauthStates.delete(state);
  clearCookie(res, "discord_oauth_state");

  if (!DISCORD_CLIENT_SECRET) {
    res.status(500).send(layout("Login setup needed", `
      <div class="card">
        <h2>Almost done</h2>
        <p>Discord approved the login, but the dashboard still needs <code>DISCORD_CLIENT_SECRET</code> in <code>.env</code> to finish.</p>
        <p class="muted">Redirect URL:</p>
        <pre>${DISCORD_REDIRECT_URI}</pre>
        <a href="/login">Back to login</a>
      </div>
    `));
    return;
  }

  try {
    const token = await exchangeDiscordCode(code);
    const [user, discordGuilds] = await Promise.all([
      discordFetch("/users/@me", token.access_token),
      discordFetch("/users/@me/guilds", token.access_token),
    ]);

    const sessionId = crypto.randomBytes(32).toString("hex");
    sessions.set(sessionId, {
      user,
      adminGuildIds: getAdminGuildIds(discordGuilds),
      createdAt: Date.now(),
    });

    setCookie(res, "dashboard_session", sessionId, "; Max-Age=604800");
    res.redirect("/");
  } catch (error) {
    console.error(error);
    res.status(500).send(layout("Login failed", `
      <div class="card">
        <h2>Discord login failed</h2>
        <p>Check <code>DISCORD_CLIENT_SECRET</code> and the OAuth2 Redirect URL in Discord Developer Portal.</p>
        <p class="muted">Redirect URL must be exactly:</p>
        <pre>${DISCORD_REDIRECT_URI}</pre>
        <a href="/login">Try again</a>
      </div>
    `));
  }
});

app.post("/login", (req, res) => {
  res.redirect("/auth/discord");
});

app.post("/logout", (req, res) => {
  const sessionId = parseCookies(req).dashboard_session;
  if (sessionId) sessions.delete(sessionId);
  clearCookie(res, "dashboard_session");
  res.redirect("/login");
});

app.get("/robots.txt", (req, res) => {
  res.type("text/plain").send([
    "User-agent: *",
    "Allow: /",
    `Sitemap: ${BASE_URL}/sitemap.xml`,
    "",
  ].join("\n"));
});

app.get("/sitemap.xml", (req, res) => {
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${BASE_URL}/login</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`);
});

app.get("/legacy-login-disabled", (req, res) => {
  res.send(layout("Login", `
    <div class="card">
      <h2>כניסה לדאשבורד</h2>
      <form method="post" action="/login">
        <label>סיסמה</label>
        <input type="password" name="password" autofocus>
        <button type="submit">כניסה</button>
      </form>
      <p class="muted">ברירת מחדל: admin. מומלץ להגדיר DASHBOARD_PASSWORD בקובץ .env.</p>
    </div>
  `));
});

app.post("/login", (req, res) => {
  if (req.body.password !== PASSWORD) {
    res.status(401).send(layout("Login failed", `<div class="card">סיסמה לא נכונה. <a href="/login">נסה שוב</a></div>`));
    return;
  }
  res.setHeader("Set-Cookie", `dashboard_auth=${PASSWORD}; HttpOnly; SameSite=Lax; Path=/`);
  res.redirect("/");
});

app.get("/", requireAuth, async (req, res) => {
  const session = getSession(req);
  const guilds = [...client.guilds.cache.values()].filter((guild) => session.adminGuildIds.includes(guild.id));
  res.send(layout("Dashboard", `
    <div class="card">
      <h2>בחר שרת</h2>
      <div class="grid">
        ${guilds.map((guild) => `<a class="card" href="/guild/${guild.id}">${guild.name}<br><span class="muted">${guild.id}</span></a>`).join("") || "<p>הבוט לא נמצא באף שרת.</p>"}
      </div>
    </div>
  `));
});

app.get("/guild/:guildId", requireAuth, requireGuildAdmin, async (req, res) => {
  const { guildId } = req.params;
  const guild = client.guilds.cache.get(guildId);
  const config = getGuildConfig(guildId);
  if (!guild) {
    res.status(404).send(layout("Server not found", `<div class="card">הבוט לא נמצא בשרת הזה. <a href="/">חזרה</a></div>`));
    return;
  }

  await Promise.all([
    guild.channels.fetch().catch(console.error),
    guild.roles.fetch().catch(console.error),
  ]);

  const categoryOptions = getCategoryOptions(guild);
  const textChannelOptions = getTextChannelOptions(guild);
  const roleOptions = getRoleOptions(guild);

  res.send(layout("Guild Settings", `
    <div class="card">
      <a href="/">חזרה</a>
      <h2>${guild?.name || "שרת"} <span class="muted">${guildId}</span></h2>
      <form method="post">
        <h3>הפעלה / ביטול</h3>
        <div class="card">
          ${checkbox("featureVerify", "Verify", config.features.verify)}
          ${checkbox("featureWelcome", "Welcome", config.features.welcome)}
          ${checkbox("featureHelp", "Help / !help", config.features.help)}
          ${checkbox("featureTickets", "מערכת טיקטים", config.features.tickets)}
          ${checkbox("featureReportTickets", "טיקט לדיווח על שחקן", config.features.reportTickets)}
          ${checkbox("featureTechTickets", "עזרה טכנית", config.features.techTickets)}
          ${checkbox("featureEditBattles", "קרב אדיטים", config.features.editBattles)}
        </div>
        <label>קטגוריית טיקטים</label>
        ${select("ticketCategoryId", categoryOptions, config.ticketCategoryId, "צור אוטומטית / בלי קטגוריה")}

        <label>רול שיכול לפתוח טיקט</label>
        ${select("ticketOpenRoleId", roleOptions, config.ticketOpenRoleId, "כולם יכולים לפתוח")}

        <label>רולים שיכולים לקחת/לסגור טיקט</label>
        ${multiSelect("staffRoleIds", roleOptions, config.staffRoleIds || [])}

        <label>רול Verify</label>
        ${select("verifiedRoleId", roleOptions, config.verifiedRoleId, "לא מוגדר")}

        <label>חדר Welcome</label>
        ${select("welcomeChannelId", textChannelOptions, config.welcomeChannelId, "לא מוגדר")}

        <label>חדר פאנל קרב אדיטים</label>
        ${select("editBattlePanelChannelId", textChannelOptions, config.editBattlePanelChannelId, "החדר שבו מפעילים")}

        <button type="submit">שמור הגדרות</button>
      </form>
    </div>
    <div class="card">
      <h3>ברירות מחדל</h3>
      <pre>${JSON.stringify(DEFAULT_CONFIG, null, 2)}</pre>
    </div>
  `));
});

app.post("/guild/:guildId", requireAuth, requireGuildAdmin, (req, res) => {
  setGuildConfig(req.params.guildId, {
    features: {
      verify: Boolean(req.body.featureVerify),
      welcome: Boolean(req.body.featureWelcome),
      help: Boolean(req.body.featureHelp),
      tickets: Boolean(req.body.featureTickets),
      reportTickets: Boolean(req.body.featureReportTickets),
      techTickets: Boolean(req.body.featureTechTickets),
      editBattles: Boolean(req.body.featureEditBattles),
    },
    ticketCategoryId: req.body.ticketCategoryId.trim(),
    ticketOpenRoleId: req.body.ticketOpenRoleId.trim(),
    staffRoleIds: parseIds(req.body.staffRoleIds),
    verifiedRoleId: req.body.verifiedRoleId.trim(),
    welcomeChannelId: req.body.welcomeChannelId.trim(),
    editBattlePanelChannelId: req.body.editBattlePanelChannelId.trim(),
  });
  res.redirect(`/guild/${req.params.guildId}`);
});

app.listen(PORT, () => {
  console.log(`Dashboard running on http://localhost:${PORT}`);
});

if (DISCORD_TOKEN) {
  client.login(DISCORD_TOKEN).catch((error) => {
    console.error("Dashboard Discord client login failed:", error);
  });
} else {
  console.error("Missing DISCORD_TOKEN. Dashboard is running, but Discord server list will be empty.");
}
