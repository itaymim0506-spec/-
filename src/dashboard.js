require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  StringSelectMenuBuilder,
} = require("discord.js");
const { DEFAULT_CONFIG, getGuildConfig, setGuildConfig } = require("./config-store");
const { getGiveaway, readGiveaways, setGiveaway } = require("./giveaway-store");

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
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(DATA_DIR, "uploads");
const VERIFY_BUTTON_ID = "verify_member";
const TICKET_SELECT_MENU_ID = "select_ticket_type";
const GIVEAWAY_JOIN_PREFIX = "giveaway_join_";
const EDIT_BATTLE_JOIN_BUTTON_ID = "join_edit_battle";
const TICKET_PANEL_IMAGE_PATH = path.join(
  process.env.USERPROFILE || "C:\\Users\\איתי",
  "Downloads",
  "ChatGPT Image May 13, 2026, 08_57_08 PM.png",
);
const TICKET_PANEL_IMAGE_NAME = "tickets-banner.png";
const EDIT_BATTLE_IMAGE_PATH = path.join(
  process.env.USERPROFILE || "C:\\Users\\איתי",
  "Downloads",
  "ChatGPT Image May 13, 2026, 09_18_40 PM.png",
);
const EDIT_BATTLE_IMAGE_NAME = "edit-battle.png";

const app = express();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const extension = path.extname(file.originalname || "").toLowerCase() || ".png";
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${extension}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    cb(null, file.mimetype?.startsWith("image/"));
  },
  limits: { fileSize: 8 * 1024 * 1024 },
});

const imageUpload = upload.fields([
  { name: "ticketPanelImageFile", maxCount: 1 },
  { name: "verifyImageFile", maxCount: 1 },
  { name: "welcomeImageFile", maxCount: 1 },
  { name: "giveawayImageFile", maxCount: 1 },
]);

app.use(express.urlencoded({ extended: true }));
app.use("/assets", express.static("public"));
app.use("/uploads", express.static(UPLOAD_DIR));

function parseIds(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  return String(value || "")
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined) return [];
  return [value];
}

function slugForConfig(value, fallback = "ticket") {
  const cleaned = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return cleaned || fallback;
}

function parseColor(value, fallback = 0x2ecc71) {
  const hex = String(value || "").trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return Number.parseInt(hex, 16);
  return fallback;
}

function getTicketTypes(config) {
  const ticketTypes = Array.isArray(config.ticketTypes) && config.ticketTypes.length
    ? config.ticketTypes
    : DEFAULT_CONFIG.ticketTypes;

  return ticketTypes.map((ticketType, index) => {
    const id = slugForConfig(ticketType.id || ticketType.buttonLabel || `ticket-${index + 1}`, `ticket-${index + 1}`);
    return {
      id,
      buttonId: `open_ticket_${id}`,
      buttonLabel: ticketType.buttonLabel || `טיקט ${index + 1}`,
      channelPrefix: slugForConfig(ticketType.channelPrefix || ticketType.buttonLabel || id, "ticket"),
      buttonStyle: ticketType.buttonStyle || "primary",
    };
  });
}

function getTicketButtonStyle(styleName) {
  const styles = {
    primary: ButtonStyle.Primary,
    secondary: ButtonStyle.Secondary,
    success: ButtonStyle.Success,
    danger: ButtonStyle.Danger,
  };
  return styles[styleName] || ButtonStyle.Primary;
}

function formatPreviewTemplate(template, guild) {
  return String(template || "")
    .replaceAll("{user}", "@משתמש")
    .replaceAll("{username}", "משתמש")
    .replaceAll("{server}", guild.name);
}

function buildTicketPanelMessages(guildId) {
  const config = getGuildConfig(guildId);
  const ticketTypes = getTicketTypes(config);
  const chunks = [];
  for (let index = 0; index < ticketTypes.length; index += 25) {
    chunks.push(ticketTypes.slice(index, index + 25));
  }

  return chunks.map((chunk, chunkIndex) => {
    const embed = new EmbedBuilder()
      .setColor(0x8b2cff)
      .setTitle(chunks.length > 1 ? `${config.ticketPanelTitle || "פתיחת טיקטים"} ${chunkIndex + 1}` : (config.ticketPanelTitle || "פתיחת טיקטים"))
      .setDescription(config.ticketPanelDescription || "לחצו על הכפתור כדי לפתוח טיקט לצוות.");

    const files = [];
    if (config.ticketPanelImageUrl) {
      embed.setImage(config.ticketPanelImageUrl);
    } else if (fs.existsSync(TICKET_PANEL_IMAGE_PATH)) {
      embed.setImage(`attachment://${TICKET_PANEL_IMAGE_NAME}`);
      files.push({ attachment: TICKET_PANEL_IMAGE_PATH, name: TICKET_PANEL_IMAGE_NAME });
    }

    const rows = [];
    if (config.ticketPanelDisplayMode === "select") {
      rows.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(TICKET_SELECT_MENU_ID)
          .setPlaceholder("בחרו נושא לטיקט")
          .addOptions(chunk.map((ticketType) => ({
            label: ticketType.buttonLabel.slice(0, 100),
            value: ticketType.id,
          }))),
      ));
    } else {
      for (let index = 0; index < chunk.length; index += 5) {
        rows.push(new ActionRowBuilder().addComponents(
          chunk.slice(index, index + 5).map((ticketType) => new ButtonBuilder()
            .setCustomId(ticketType.buttonId)
            .setLabel(ticketType.buttonLabel)
            .setStyle(getTicketButtonStyle(ticketType.buttonStyle))),
        ));
      }
    }

    return { embeds: [embed], components: rows, files };
  });
}

function buildVerifyPanel(guildId) {
  const config = getGuildConfig(guildId);
  const components = [
    { type: 10, content: config.verifyText || "כדי להיות מאומתים לחצו על הכפתור" },
  ];

  if (config.verifyImageUrl) {
    components.push({ type: 12, items: [{ media: { url: config.verifyImageUrl } }] });
  }

  components.push({
    type: 1,
    components: [
      {
        type: 2,
        custom_id: VERIFY_BUTTON_ID,
        label: config.verifyButtonLabel || "Verify",
        style: 3,
      },
    ],
  });

  return {
    flags: 32768,
    components: [
      {
        type: 17,
        components,
        accent_color: parseColor(config.verifyAccentColor, 0xf17100),
      },
    ],
  };
}

function buildWelcomeMessage(guild) {
  const config = getGuildConfig(guild.id);
  const embed = new EmbedBuilder()
    .setColor(parseColor(config.welcomeColor))
    .setTitle(config.welcomeTitle || "Welcome!")
    .setDescription(formatPreviewTemplate(config.welcomeMessage || "Hey {user}, welcome to **{server}**.", guild))
    .setTimestamp();

  if (client.user) {
    embed.setThumbnail(client.user.displayAvatarURL({ size: 128 }));
  }

  if (config.welcomeImageUrl) {
    embed.setImage(config.welcomeImageUrl);
  }

  return { embeds: [embed] };
}

function buildGiveawayMessage(giveaway) {
  const ended = Boolean(giveaway.ended);
  const winnersText = giveaway.winnerIds?.length
    ? giveaway.winnerIds.map((userId) => `<@${userId}>`).join(", ")
    : "עדיין אין";

  const embed = new EmbedBuilder()
    .setColor(ended ? 0x2ecc71 : 0xf1c40f)
    .setTitle(`🎉 ${giveaway.prize}`)
    .setDescription(giveaway.description || "לחצו על הכפתור כדי להשתתף בהגרלה.")
    .addFields(
      { name: "זוכים", value: String(giveaway.winnerCount || 1), inline: true },
      { name: "משתתפים", value: String(giveaway.participants?.length || 0), inline: true },
      { name: ended ? "זוכים שנבחרו" : "נגמר", value: ended ? winnersText : `<t:${Math.floor(giveaway.endAt / 1000)}:R>`, inline: false },
    )
    .setTimestamp();

  if (giveaway.imageUrl) embed.setImage(giveaway.imageUrl);

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${GIVEAWAY_JOIN_PREFIX}${giveaway.id}`)
          .setLabel(ended ? "ההגרלה נגמרה" : "השתתף בהגרלה")
          .setStyle(ended ? ButtonStyle.Secondary : ButtonStyle.Success)
          .setDisabled(ended),
      ),
    ],
  };
}

function pickGiveawayWinners(participants, winnerCount, previousWinnerIds = []) {
  const uniqueParticipants = [...new Set(participants || [])];
  const previousWinnerSet = new Set(previousWinnerIds || []);
  let pool = uniqueParticipants.filter((userId) => !previousWinnerSet.has(userId));
  if (pool.length < Number(winnerCount || 1)) pool = uniqueParticipants;

  const winners = [];
  while (pool.length && winners.length < Number(winnerCount || 1)) {
    const index = Math.floor(Math.random() * pool.length);
    winners.push(pool.splice(index, 1)[0]);
  }
  return winners;
}

function buildEditBattlePanel() {
  const embed = new EmbedBuilder()
    .setColor(0x8b2cff)
    .setTitle("חדר קרב")
    .setDescription("לחץ על הכפתור כדי להצטרף לחדר קרב. כשיהיו לפחות שני משתתפים, הבוט ישדך שניים רנדומלית ויפתח להם חדר פרטי.");

  const files = [];
  if (fs.existsSync(EDIT_BATTLE_IMAGE_PATH)) {
    embed.setImage(`attachment://${EDIT_BATTLE_IMAGE_NAME}`);
    files.push({ attachment: EDIT_BATTLE_IMAGE_PATH, name: EDIT_BATTLE_IMAGE_NAME });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(EDIT_BATTLE_JOIN_BUTTON_ID)
      .setLabel("פתיחת חדר קרב")
      .setStyle(ButtonStyle.Primary),
  );

  return { embeds: [embed], components: [row], files };
}

function trimField(value) {
  return String(value || "").trim();
}

function uploadedImageUrl(files, fieldName, fallbackValue) {
  const uploadedFile = files?.[fieldName]?.[0];
  if (!uploadedFile) return trimField(fallbackValue);
  return `${BASE_URL}/uploads/${uploadedFile.filename}`;
}

function buildGuildConfigFromBody(body, files = {}) {
  return {
    features: {
      verify: Boolean(body.featureVerify),
      welcome: Boolean(body.featureWelcome),
      help: Boolean(body.featureHelp),
      tickets: Boolean(body.featureTickets),
      editBattles: Boolean(body.featureEditBattles),
      giveaways: Boolean(body.featureGiveaways),
      moderation: Boolean(body.featureModeration),
      music: Boolean(body.featureMusic),
    },
    ticketCategoryId: trimField(body.ticketCategoryId),
    ticketOpenRoleId: trimField(body.ticketOpenRoleId),
    ticketPanelChannelId: trimField(body.ticketPanelChannelId),
    ticketPanelTitle: trimField(body.ticketPanelTitle),
    ticketPanelDescription: trimField(body.ticketPanelDescription),
    ticketPanelImageUrl: uploadedImageUrl(files, "ticketPanelImageFile", body.ticketPanelImageUrl),
    ticketPanelDisplayMode: ["buttons", "select"].includes(body.ticketPanelDisplayMode)
      ? body.ticketPanelDisplayMode
      : "buttons",
    ticketNameMode: body.ticketNameMode || "number",
    ticketTranscriptChannelId: trimField(body.ticketTranscriptChannelId),
    ticketTypes: parseTicketTypes(body),
    staffRoleIds: parseIds(body.staffRoleIds),
    verifiedRoleId: trimField(body.verifiedRoleId),
    verifyPanelChannelId: trimField(body.verifyPanelChannelId),
    verifyText: trimField(body.verifyText),
    verifyButtonLabel: trimField(body.verifyButtonLabel),
    verifyAccentColor: trimField(body.verifyAccentColor),
    verifyImageUrl: uploadedImageUrl(files, "verifyImageFile", body.verifyImageUrl),
    welcomeChannelId: trimField(body.welcomeChannelId),
    welcomeTitle: trimField(body.welcomeTitle),
    welcomeMessage: trimField(body.welcomeMessage),
    welcomeColor: trimField(body.welcomeColor),
    welcomeImageUrl: uploadedImageUrl(files, "welcomeImageFile", body.welcomeImageUrl),
    editBattlePanelChannelId: trimField(body.editBattlePanelChannelId),
    giveawayChannelId: trimField(body.giveawayChannelId),
    giveawayPrize: trimField(body.giveawayPrize),
    giveawayDescription: trimField(body.giveawayDescription),
    giveawayWinnerCount: Math.max(1, Number(body.giveawayWinnerCount || 1)),
    giveawayDurationMinutes: Math.max(1, Number(body.giveawayDurationMinutes || 60)),
    giveawayImageUrl: uploadedImageUrl(files, "giveawayImageFile", body.giveawayImageUrl),
    moderationLogChannelId: trimField(body.moderationLogChannelId),
    blockedWords: trimField(body.blockedWords).split(/[\n,]+/).map((word) => word.trim()).filter(Boolean).slice(0, 15),
    blockedWordsMessage: trimField(body.blockedWordsMessage),
    antiSpamMaxMessages: Math.max(2, Number(body.antiSpamMaxMessages || 5)),
    antiSpamWindowSeconds: Math.max(2, Number(body.antiSpamWindowSeconds || 6)),
    antiSpamMessage: trimField(body.antiSpamMessage),
  };
}

function parseTicketTypes(body) {
  const ids = asArray(body.ticketTypeId);
  const labels = asArray(body.ticketTypeButtonLabel);
  const prefixes = asArray(body.ticketTypeChannelPrefix);
  const titles = asArray(body.ticketTypeEmbedTitle);
  const intros = asArray(body.ticketTypeIntro);
  const buttonStyles = asArray(body.ticketTypeButtonStyle);

  const ticketTypes = labels.map((label, index) => ({
    id: slugForConfig(ids[index] || label || `ticket-${index + 1}`, `ticket-${index + 1}`),
    buttonLabel: String(label || "").trim(),
    channelPrefix: slugForConfig(prefixes[index] || label || `ticket-${index + 1}`, "ticket"),
    embedTitle: String(titles[index] || label || "טיקט חדש").trim(),
    intro: String(intros[index] || "תכתוב כאן במה אתה צריך עזרה. צוות יענה לך בהקדם.").trim(),
    buttonStyle: ["primary", "secondary", "success", "danger"].includes(buttonStyles[index])
      ? buttonStyles[index]
      : "primary",
  })).filter((ticketType) => ticketType.buttonLabel);

  return ticketTypes.length ? ticketTypes : DEFAULT_CONFIG.ticketTypes;
}

function checkbox(name, label, checked, value = "1") {
  return `<label class="check"><input type="checkbox" name="${name}" value="${escapeHtml(value)}" ${checked ? "checked" : ""}> ${escapeHtml(label)}</label>`;
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

function textInput(name, value, placeholder = "") {
  return `<input name="${name}" value="${escapeHtml(value || "")}" placeholder="${escapeHtml(placeholder)}">`;
}

function fileInput(name) {
  return `<input type="file" name="${name}" accept="image/*">`;
}

function colorInput(name, value) {
  const color = /^#[0-9a-fA-F]{6}$/.test(String(value || "")) ? value : "#2ecc71";
  return `<input type="color" name="${name}" value="${escapeHtml(color)}" data-welcome-color>`;
}

function textArea(name, value, placeholder = "") {
  return `<textarea name="${name}" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value || "")}</textarea>`;
}

function multiSelect(name, items, selectedValues) {
  const selectedSet = new Set(selectedValues || []);
  return `<div class="choice-list">
    ${items.map((item) => checkbox(name, item.label, selectedSet.has(item.id), item.id)).join("") || "<p class=\"muted\">אין רולים לבחירה.</p>"}
  </div>`;
}

function renderTicketTypeRows(ticketTypes) {
  return (ticketTypes || DEFAULT_CONFIG.ticketTypes).map((ticketType, index) => `
    <div class="ticket-type-row">
      <h4>סוג טיקט ${index + 1}</h4>
      <input type="hidden" name="ticketTypeId" value="${escapeHtml(ticketType.id || `ticket-${index + 1}`)}">
      <label>שם הכפתור</label>
      ${textInput("ticketTypeButtonLabel", ticketType.buttonLabel, "פתח טיקט")}
      <label>צבע הכפתור</label>
      ${select("ticketTypeButtonStyle", [
        { id: "primary", label: "כחול" },
        { id: "secondary", label: "אפור" },
        { id: "success", label: "ירוק" },
        { id: "danger", label: "אדום" },
      ], ticketType.buttonStyle || "primary", "כחול")}
      <label>תחילת שם החדר</label>
      ${textInput("ticketTypeChannelPrefix", ticketType.channelPrefix, "ticket")}
      <label>כותרת בתוך הטיקט</label>
      ${textInput("ticketTypeEmbedTitle", ticketType.embedTitle, "טיקט חדש")}
      <label>הודעה בתוך הטיקט</label>
      ${textArea("ticketTypeIntro", ticketType.intro, "תכתוב כאן מה יופיע למשתמש בתוך הטיקט.")}
      <button type="button" class="button secondary" data-remove-ticket-type>מחק סוג טיקט</button>
    </div>
  `).join("");
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

async function getWritableTextChannel(guild, channelId) {
  if (!channelId) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  return channel?.isTextBased() ? channel : null;
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

function getUserAvatarUrl(user) {
  if (!user) return "https://cdn.discordapp.com/embed/avatars/0.png";
  if (user.avatar) {
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`;
  }
  const discriminator = Number(user.discriminator || 0);
  return `https://cdn.discordapp.com/embed/avatars/${discriminator % 5}.png`;
}

function sendResultPage(title, message, guildId, section) {
  return layout(title, `
    <div class="card">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
      <a class="button" href="/guild/${escapeHtml(guildId)}#${escapeHtml(section)}">חזרה</a>
    </div>
  `);
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

function layout(title, body, session = null) {
  const user = session?.user;
  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Lehem Bot - Discord bot dashboard for tickets, verification, welcome messages, giveaways, moderation, music, and staff tools.">
  <meta name="keywords" content="Lehem Bot, discord bot, discord dashboard, tickets discord, verification discord, moderation bot">
  <meta name="google-site-verification" content="t_E1zoSmpZ9zBm0DRAKltCWtZypOImgrNE-quWhemQA">
  <meta property="og:title" content="Lehem Bot">
  <meta property="og:description" content="Dashboard for managing the Lehem Discord bot.">
  <meta property="og:type" content="website">
  <title>${title} | Lehem Bot</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #111318; color: #f4f6fb; }
    header { padding: 16px 24px; background: #181b22; border-bottom: 1px solid #2a2f3a; }
    .topbar { max-width: 1180px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand-mark { width: 42px; height: 42px; border-radius: 8px; object-fit: cover; border: 1px solid #7c3aed; background: #0f1117; }
    .brand-name { display: block; font-size: 20px; font-weight: 800; color: #fff; }
    .brand-sub { display: block; color: #94a3b8; font-size: 12px; margin-top: 2px; }
    .header-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .header-actions .button { margin-top: 0; }
    .profile-menu { position: relative; }
    .profile-menu summary { list-style: none; display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid #374151; border-radius: 8px; background: #0f1117; cursor: pointer; }
    .profile-menu summary::-webkit-details-marker { display: none; }
    .profile-avatar { width: 30px; height: 30px; border-radius: 50%; background: #181b22; }
    .profile-name { max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .profile-dropdown { position: absolute; top: calc(100% + 8px); left: 0; min-width: 210px; padding: 12px; border: 1px solid #2a2f3a; border-radius: 8px; background: #181b22; box-shadow: 0 18px 45px rgba(0,0,0,.35); z-index: 10; }
    .profile-dropdown form { margin: 0; }
    .profile-dropdown button, .profile-dropdown .button { width: 100%; text-align: center; margin-top: 10px; box-sizing: border-box; }
    .legal-links { max-width: 980px; margin: 0 auto; padding: 0 24px 24px; color: #94a3b8; }
    .legal-links a { margin-left: 14px; }
    main { max-width: 980px; margin: 0 auto; padding: 24px; }
    a { color: #a78bfa; text-decoration: none; }
    label { display: block; margin: 16px 0 6px; color: #cbd5e1; }
    input, textarea, select { width: 100%; box-sizing: border-box; padding: 11px; border-radius: 6px; border: 1px solid #374151; background: #0f1117; color: #f4f6fb; }
    input[type="checkbox"] { width: auto; margin-left: 8px; }
    html[dir="ltr"] input[type="checkbox"] { margin-left: 0; margin-right: 8px; }
    input[type="color"] { height: 48px; padding: 4px; cursor: pointer; }
    textarea { min-height: 120px; direction: ltr; }
    button, .button { display: inline-block; margin-top: 18px; padding: 11px 16px; border: 0; border-radius: 6px; background: #7c3aed; color: white; cursor: pointer; }
    .button.secondary { background: #374151; }
    .card { background: #181b22; border: 1px solid #2a2f3a; border-radius: 8px; padding: 18px; margin-bottom: 18px; }
    .muted { color: #94a3b8; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
    .check { display: flex; align-items: center; margin: 10px 0; color: #f4f6fb; }
    .choice-list { max-height: 260px; overflow: auto; padding: 8px 12px; border: 1px solid #374151; border-radius: 6px; background: #0f1117; }
    .guild-shell { display: grid; grid-template-columns: 230px minmax(0, 1fr); gap: 18px; align-items: start; }
    .side-nav { position: sticky; top: 18px; }
    .side-title { margin: 0 0 12px; color: #f4f6fb; font-size: 18px; }
    .nav-link { display: block; padding: 10px 12px; margin: 6px 0; border-radius: 6px; color: #cbd5e1; background: #111318; border: 1px solid transparent; }
    .nav-link.active { color: #fff; background: #7c3aed; border-color: #9f67ff; }
    .panel-section { display: none; }
    .panel-section.active { display: block; }
    .home-hero { padding: 28px; border-radius: 8px; border: 1px solid #7c3aed; background: linear-gradient(135deg, #181b22 0%, #251a3f 55%, #181b22 100%); }
    .home-title { margin: 0; font-size: 42px; line-height: 1.1; }
    .home-subtitle { max-width: 680px; color: #cbd5e1; font-size: 16px; }
    .login-hero { border-color: #7c3aed; background: linear-gradient(135deg, #181b22 0%, #251a3f 60%, #181b22 100%); }
    .login-title { margin: 0; font-size: 40px; }
    .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-top: 18px; }
    .stat { padding: 14px; background: #111318; border: 1px solid #2a2f3a; border-radius: 8px; }
    .stat strong { display: block; font-size: 20px; margin-bottom: 4px; }
    .save-row { position: sticky; bottom: 0; margin-top: 18px; padding: 12px 0; background: #111318; border-top: 1px solid #2a2f3a; }
    .ticket-type-row { padding: 14px; margin: 12px 0; border: 1px solid #374151; border-radius: 8px; background: #111318; }
    .ticket-type-row h4 { margin: 0 0 10px; }
    .welcome-preview { display: grid; grid-template-columns: 1fr 82px; gap: 14px; align-items: start; margin-top: 16px; padding: 14px; border-radius: 8px; background: #0f1117; border-right: 5px solid #2ecc71; }
    .welcome-preview h3 { margin: 0 0 8px; font-size: 18px; }
    .welcome-preview p { margin: 0; color: #cbd5e1; line-height: 1.5; white-space: pre-wrap; }
    .welcome-avatar { width: 72px; height: 72px; border-radius: 50%; border: 2px solid #374151; background: #181b22; }
    .welcome-preview-image { grid-column: 1 / -1; width: 100%; max-height: 280px; object-fit: cover; border-radius: 8px; border: 1px solid #2a2f3a; display: none; }
    .verify-preview { margin-top: 16px; padding: 14px; border-radius: 8px; background: #0f1117; border-right: 5px solid #f17100; }
    .verify-preview p { margin: 0 0 12px; color: #f4f6fb; line-height: 1.5; white-space: pre-wrap; }
    .verify-preview img { width: 100%; max-height: 280px; object-fit: cover; border-radius: 8px; border: 1px solid #2a2f3a; display: none; margin-bottom: 12px; }
    .verify-preview-button { display: inline-block; padding: 9px 14px; border-radius: 6px; background: #2ecc71; color: #fff; font-weight: 700; }
    html[dir="ltr"] .profile-dropdown { left: auto; right: 0; }
    html[dir="ltr"] .legal-links a { margin-left: 0; margin-right: 14px; }
    @media (max-width: 780px) {
      .guild-shell { grid-template-columns: 1fr; }
      .side-nav { position: static; }
      .home-title { font-size: 32px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="topbar">
      <div class="brand">
        <img class="brand-mark" src="/assets/bot-logo.jpg" alt="בוט לחם">
        <span>
          <span class="brand-name">בוט לחם</span>
          <span class="brand-sub">דאשבורד ניהול דיסקורד</span>
        </span>
      </div>
      <div class="header-actions">
        <a class="button" href="/invite">Add to your server</a>
        ${user ? `
          <details class="profile-menu">
            <summary>
              <img class="profile-avatar" src="${escapeHtml(getUserAvatarUrl(user))}" alt="">
              <span class="profile-name">${escapeHtml(user.global_name || user.username || "Discord user")}</span>
            </summary>
            <div class="profile-dropdown">
              <strong>${escapeHtml(user.global_name || user.username || "Discord user")}</strong>
              <p class="muted">${escapeHtml(user.username || "")}</p>
              <form method="post" action="/switch-account">
                <button type="submit" class="button secondary">החלף חשבון</button>
              </form>
              <form method="post" action="/logout">
                <button type="submit" class="button secondary">התנתק</button>
              </form>
            </div>
          </details>
        ` : ""}
      </div>
    </div>
  </header>
  <main>${body}</main>
  <footer class="legal-links">
    <a href="/terms">Terms of Service</a>
    <a href="/privacy">Privacy Policy</a>
  </footer>
  <script>
    document.addEventListener("DOMContentLoaded", () => {
      const sections = [...document.querySelectorAll(".panel-section")];
      const links = [...document.querySelectorAll(".nav-link")];
      if (!sections.length) return;

      function showSection(id) {
        const targetId = id || "home";
        sections.forEach((section) => section.classList.toggle("active", section.id === targetId));
        links.forEach((link) => link.classList.toggle("active", link.getAttribute("href") === "#" + targetId));
      }

      links.forEach((link) => {
        link.addEventListener("click", () => showSection(link.getAttribute("href").slice(1)));
      });

      const ticketTypes = document.querySelector("[data-ticket-types]");
      const addTicketType = document.querySelector("[data-add-ticket-type]");
      const template = document.querySelector("#ticket-type-template");

      function wireTicketRemovers() {
        document.querySelectorAll("[data-remove-ticket-type]").forEach((button) => {
          button.onclick = () => {
            if (document.querySelectorAll(".ticket-type-row").length > 1) {
              button.closest(".ticket-type-row").remove();
            }
          };
        });
      }

      addTicketType?.addEventListener("click", () => {
        if (!ticketTypes || !template) return;
        ticketTypes.insertAdjacentHTML("beforeend", template.innerHTML);
        wireTicketRemovers();
      });

      const welcomeTitle = document.querySelector("[name='welcomeTitle']");
      const welcomeMessage = document.querySelector("[name='welcomeMessage']");
      const welcomeColor = document.querySelector("[name='welcomeColor']");
      const welcomeImageUrl = document.querySelector("[name='welcomeImageUrl']");
      const welcomePreview = document.querySelector("[data-welcome-preview]");
      const welcomePreviewTitle = document.querySelector("[data-welcome-preview-title]");
      const welcomePreviewMessage = document.querySelector("[data-welcome-preview-message]");
      const welcomePreviewImage = document.querySelector("[data-welcome-preview-image]");
      const verifyText = document.querySelector("[name='verifyText']");
      const verifyButtonLabel = document.querySelector("[name='verifyButtonLabel']");
      const verifyAccentColor = document.querySelector("[name='verifyAccentColor']");
      const verifyImageUrl = document.querySelector("[name='verifyImageUrl']");
      const verifyPreview = document.querySelector("[data-verify-preview]");
      const verifyPreviewText = document.querySelector("[data-verify-preview-text]");
      const verifyPreviewButton = document.querySelector("[data-verify-preview-button]");
      const verifyPreviewImage = document.querySelector("[data-verify-preview-image]");

      function renderWelcomePreview() {
        if (!welcomePreview) return;
        const replacements = {
          "{user}": "@Itay",
          "{username}": "Itay",
          "{server}": "בוט לחם",
        };
        let message = welcomeMessage?.value || "";
        Object.entries(replacements).forEach(([key, value]) => {
          message = message.split(key).join(value);
        });

        welcomePreview.style.borderRightColor = welcomeColor?.value || "#2ecc71";
        welcomePreviewTitle.textContent = welcomeTitle?.value || "Welcome!";
        welcomePreviewMessage.textContent = message || "Hey @Itay, welcome to בוט לחם.";

        if (welcomePreviewImage) {
          const imageUrl = welcomeImageUrl?.value?.trim();
          welcomePreviewImage.style.display = imageUrl ? "block" : "none";
          if (imageUrl) welcomePreviewImage.src = imageUrl;
        }
      }

      [welcomeTitle, welcomeMessage, welcomeColor, welcomeImageUrl].forEach((field) => {
        field?.addEventListener("input", renderWelcomePreview);
      });

      function renderVerifyPreview() {
        if (!verifyPreview) return;
        verifyPreview.style.borderRightColor = verifyAccentColor?.value || "#f17100";
        verifyPreviewText.textContent = verifyText?.value || "כדי להיות מאומתים לחצו על הכפתור";
        verifyPreviewButton.textContent = verifyButtonLabel?.value || "Verify";

        if (verifyPreviewImage) {
          const imageUrl = verifyImageUrl?.value?.trim();
          verifyPreviewImage.style.display = imageUrl ? "block" : "none";
          if (imageUrl) verifyPreviewImage.src = imageUrl;
        }
      }

      [verifyText, verifyButtonLabel, verifyAccentColor, verifyImageUrl].forEach((field) => {
        field?.addEventListener("input", renderVerifyPreview);
      });

      renderWelcomePreview();
      renderVerifyPreview();
      wireTicketRemovers();
      showSection(location.hash ? location.hash.slice(1) : "home");
    });
  </script>
  <script src="/assets/i18n.js"></script>
</body>
</html>`;
}

app.get("/login", (req, res, next) => {
  if (req.route.path !== "/login") return next();
  const isDiscordLoginReady = Boolean(process.env.CLIENT_ID && DISCORD_CLIENT_SECRET);
  res.send(layout("Login", `
    <div class="card login-hero">
      <h1 class="login-title">בוט לחם</h1>
      <p class="home-subtitle">הדאשבורד הרשמי לניהול הבוט לחם: טיקטים, אימות, הודעות ברוכים הבאים, עזרה וקרבות אדיטים.</p>
      <a class="button" href="/auth/discord">כניסה עם Discord</a>
      <a class="button" href="/invite">הוספת בוט לחם לשרת</a>
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

app.get("/terms", (req, res) => {
  res.send(layout("Terms of Service", `
    <div class="card">
      <h1>Terms of Service</h1>
      <p class="muted">Last updated: May 23, 2026</p>
      <p>By inviting or using Lehem Bot, you agree to these terms.</p>
      <h2>Use of the Bot</h2>
      <p>Lehem Bot provides Discord server tools such as tickets, verification, welcome messages, giveaways, moderation, music, and dashboard settings. Server administrators are responsible for how they configure and use the bot in their servers.</p>
      <h2>Permissions</h2>
      <p>The bot may require Discord permissions such as managing roles, channels, messages, and voice connections. Only grant permissions that you are comfortable giving to the bot.</p>
      <h2>Content and Conduct</h2>
      <p>You may not use the bot to harass users, break Discord's Terms of Service, distribute illegal content, or abuse Discord systems. We may disable access for servers that misuse the bot.</p>
      <h2>Availability</h2>
      <p>The bot is provided as-is. We try to keep it online, but we do not guarantee uninterrupted service, error-free operation, or permanent data availability.</p>
      <h2>Premium Features</h2>
      <p>If premium features are offered in the future, the payment terms, feature limits, and refund rules will be shown before purchase.</p>
      <h2>Changes</h2>
      <p>These terms may be updated from time to time. Continued use of the bot after changes means you accept the updated terms.</p>
      <h2>Contact</h2>
      <p>For support or questions, contact the bot owner through the official Discord support server or dashboard contact method when available.</p>
    </div>
  `));
});

app.get("/privacy", (req, res) => {
  res.send(layout("Privacy Policy", `
    <div class="card">
      <h1>Privacy Policy</h1>
      <p class="muted">Last updated: May 23, 2026</p>
      <p>This policy explains what information Lehem Bot stores and uses.</p>
      <h2>Information We Store</h2>
      <p>The bot may store Discord IDs for servers, channels, roles, users, ticket settings, giveaway participants, and dashboard configuration. Ticket transcripts may include message content when transcript logging is enabled by server administrators.</p>
      <h2>How Information Is Used</h2>
      <p>Information is used to provide bot features, save server settings, manage tickets, run giveaways, handle moderation, and show dashboard controls to authorized administrators.</p>
      <h2>Who Can Access Settings</h2>
      <p>The dashboard is limited to users who have Administrator permission in the Discord server. Server administrators control their own server configuration.</p>
      <h2>Data Removal</h2>
      <p>Server administrators can disable features and remove stored configuration where dashboard controls are available. For additional deletion requests, contact the bot owner.</p>
      <h2>Third Parties</h2>
      <p>The bot uses Discord services and may use hosting providers such as Render. Discord login uses OAuth to confirm identity and server administrator access.</p>
      <h2>Contact</h2>
      <p>For privacy questions, contact the bot owner through the official Discord support server or dashboard contact method when available.</p>
    </div>
  `));
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

app.post("/switch-account", (req, res) => {
  const sessionId = parseCookies(req).dashboard_session;
  if (sessionId) sessions.delete(sessionId);
  clearCookie(res, "dashboard_session");
  res.redirect("/auth/discord");
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
      <h1>בוט לחם</h1>
      <p class="muted">בחר את השרת שבו תרצה לנהל את ההגדרות של בוט לחם.</p>
      <div class="grid">
        ${guilds.map((guild) => `<a class="card" href="/guild/${guild.id}">${guild.name}<br><span class="muted">${guild.id}</span></a>`).join("") || "<p>הבוט לא נמצא באף שרת.</p>"}
      </div>
    </div>
  `, session));
});

app.get("/guild/:guildId", requireAuth, requireGuildAdmin, async (req, res) => {
  const { guildId } = req.params;
  const savedMessage = req.query.saved === "1"
    ? `<div class="card"><strong>נשמר.</strong> ההגדרות עודכנו.</div>`
    : "";
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
  const endedGiveaways = Object.values(readGiveaways())
    .filter((giveaway) => giveaway.guildId === guildId && giveaway.ended)
    .sort((a, b) => Number(b.endedAt || b.endAt || 0) - Number(a.endedAt || a.endAt || 0));
  const endedGiveawayOptions = endedGiveaways.map((giveaway) => ({
    id: giveaway.id,
    label: `${giveaway.prize} - ${giveaway.winnerIds?.length ? giveaway.winnerIds.map((userId) => `@${userId}`).join(", ") : "אין זוכים"}`,
  }));

  res.send(layout("Guild Settings", `
    <form method="post" class="guild-shell" enctype="multipart/form-data">
      <aside class="card side-nav">
        <a href="/">חזרה לשרתים</a>
        <h2 class="side-title">${escapeHtml(guild.name)}</h2>
        <p class="muted">${guildId}</p>
        <a class="nav-link active" href="#home">בית</a>
        <a class="nav-link" href="#features">הפעלה / ביטול</a>
        <a class="nav-link" href="#tickets">טיקטים</a>
        <a class="nav-link" href="#verify">אימות</a>
        <a class="nav-link" href="#welcome">ברוכים הבאים</a>
        <a class="nav-link" href="#giveaways">Giveaways</a>
        <a class="nav-link" href="#music">מוזיקה</a>
        <a class="nav-link" href="#moderation">אבטחה</a>
        <a class="nav-link" href="#help">עזרה</a>
        <a class="nav-link" href="#edit-battles">חדר קרב</a>
        <div class="save-row">
          <button type="submit">שמור הגדרות</button>
        </div>
      </aside>

      <section>
        ${savedMessage}
        <div id="home" class="panel-section active">
          <div class="home-hero">
            <h1 class="home-title">בוט לחם</h1>
            <p class="home-subtitle">ניהול השרת דרך הדאשבורד של לחם. מכאן עוברים למדורים בצד ומגדירים טיקטים, אימות, Welcome ושאר המערכות בלי להתבלבל.</p>
            <div class="stat-grid">
              <div class="stat"><strong>${config.features.tickets ? "פעיל" : "כבוי"}</strong><span class="muted">מערכת טיקטים</span></div>
              <div class="stat"><strong>${config.features.verify ? "פעיל" : "כבוי"}</strong><span class="muted">Verify</span></div>
              <div class="stat"><strong>${config.features.welcome ? "פעיל" : "כבוי"}</strong><span class="muted">Welcome</span></div>
              <div class="stat"><strong>${config.features.help ? "פעיל" : "כבוי"}</strong><span class="muted">Help</span></div>
              <div class="stat"><strong>${config.features.giveaways ? "פעיל" : "כבוי"}</strong><span class="muted">Giveaways</span></div>
              <div class="stat"><strong>${config.features.moderation ? "פעיל" : "כבוי"}</strong><span class="muted">אבטחה</span></div>
              <div class="stat"><strong>${config.features.music ? "פעיל" : "כבוי"}</strong><span class="muted">Music</span></div>
            </div>
          </div>
        </div>

        <div id="features" class="panel-section card">
          <h2>הפעלה / ביטול</h2>
          ${checkbox("featureVerify", "Verify", config.features.verify)}
          ${checkbox("featureWelcome", "Welcome", config.features.welcome)}
          ${checkbox("featureHelp", "Help / !help", config.features.help)}
          ${checkbox("featureTickets", "מערכת טיקטים", config.features.tickets)}
          ${checkbox("featureEditBattles", "חדר קרב", config.features.editBattles)}
          ${checkbox("featureGiveaways", "Giveaways", config.features.giveaways)}
          ${checkbox("featureModeration", "חסימת קללות ואנטי ספאם", config.features.moderation)}
          ${checkbox("featureMusic", "מערכת מוזיקה", config.features.music)}
        </div>

        <div id="tickets" class="panel-section card">
          <h2>טיקטים</h2>
          <h3>ההודעה הראשית</h3>
          <label>כותרת ההודעה</label>
          ${textInput("ticketPanelTitle", config.ticketPanelTitle, "פתיחת טיקטים")}
          <label>טקסט ההודעה</label>
          ${textArea("ticketPanelDescription", config.ticketPanelDescription, "כתוב כאן מה המשתמשים צריכים לדעת לפני פתיחת טיקט.")}
          <label>תמונה להודעת הטיקטים</label>
          ${textInput("ticketPanelImageUrl", config.ticketPanelImageUrl, "https://example.com/image.png")}
          <label>או העלאת תמונה מהמחשב</label>
          ${fileInput("ticketPanelImageFile")}
          <label>איך להציג את נושאי הטיקטים</label>
          ${select("ticketPanelDisplayMode", [
            { id: "buttons", label: "כפתורים" },
            { id: "select", label: "רשימה נפתחת" },
          ], config.ticketPanelDisplayMode || "buttons", "כפתורים")}
          <label>חדר שבו תופיע הודעת הטיקטים</label>
          ${select("ticketPanelChannelId", textChannelOptions, config.ticketPanelChannelId, "החדר שבו מריצים /setup-ticket")}
          <button type="submit" class="button secondary" formaction="/guild/${guildId}/send-ticket-panel" formmethod="post">שלח הודעת טיקטים עכשיו</button>
          <label>איך לקרוא לחדר שנפתח</label>
          ${select("ticketNameMode", [
            { id: "number", label: "לפי מספר הטיקט" },
            { id: "user", label: "לפי שם המשתמש" },
            { id: "reason", label: "לפי הנושא שעליו פתחו" },
          ], config.ticketNameMode || "number", "לפי מספר הטיקט")}

          <h3>סוגי טיקטים וכפתורים</h3>
          <p class="muted">אפשר להוסיף כמה סוגי טיקטים שרוצים. כל שורה כאן הופכת לכפתור בהודעת הטיקטים.</p>
          <div data-ticket-types>
            ${renderTicketTypeRows(config.ticketTypes || DEFAULT_CONFIG.ticketTypes)}
          </div>
          <button type="button" class="button secondary" data-add-ticket-type>הוסף סוג טיקט</button>
          <template id="ticket-type-template">
            <div class="ticket-type-row">
              <h4>סוג טיקט חדש</h4>
              <input type="hidden" name="ticketTypeId" value="">
              <label>שם הכפתור</label>
              ${textInput("ticketTypeButtonLabel", "", "פתח טיקט")}
              <label>צבע הכפתור</label>
              ${select("ticketTypeButtonStyle", [
                { id: "primary", label: "כחול" },
                { id: "secondary", label: "אפור" },
                { id: "success", label: "ירוק" },
                { id: "danger", label: "אדום" },
              ], "primary", "כחול")}
              <label>תחילת שם החדר</label>
              ${textInput("ticketTypeChannelPrefix", "", "ticket")}
              <label>כותרת בתוך הטיקט</label>
              ${textInput("ticketTypeEmbedTitle", "", "טיקט חדש")}
              <label>הודעה בתוך הטיקט</label>
              ${textArea("ticketTypeIntro", "", "תכתוב כאן מה יופיע למשתמש בתוך הטיקט.")}
              <button type="button" class="button secondary" data-remove-ticket-type>מחק סוג טיקט</button>
            </div>
          </template>

          <h3>הרשאות ומיקום</h3>
          <label>קטגוריית טיקטים</label>
          ${select("ticketCategoryId", categoryOptions, config.ticketCategoryId, "צור אוטומטית / בלי קטגוריה")}
          <label>חדר Transcript לטיקטים</label>
          ${select("ticketTranscriptChannelId", textChannelOptions, config.ticketTranscriptChannelId, "לא לשלוח Transcript")}
          <label>רול שיכול לפתוח טיקט</label>
          ${select("ticketOpenRoleId", roleOptions, config.ticketOpenRoleId, "כולם יכולים לפתוח")}
          <label>רולים שיכולים לקחת/לסגור טיקט</label>
          ${multiSelect("staffRoleIds", roleOptions, config.staffRoleIds || [])}
        </div>

        <div id="verify" class="panel-section card">
          <h2>אימות</h2>
          <label>רול Verify</label>
          ${select("verifiedRoleId", roleOptions, config.verifiedRoleId, "לא מוגדר")}
          <label>חדר הודעת Verify</label>
          ${select("verifyPanelChannelId", textChannelOptions, config.verifyPanelChannelId, "בחר חדר לשליחה מהאתר")}
          <label>טקסט הודעת Verify</label>
          ${textArea("verifyText", config.verifyText, "כדי להיות מאומתים לחצו על הכפתור")}
          <label>שם הכפתור</label>
          ${textInput("verifyButtonLabel", config.verifyButtonLabel, "Verify")}
          <label>צבע ההודעה</label>
          ${colorInput("verifyAccentColor", config.verifyAccentColor || "#f17100")}
          <label>תמונה בהודעת Verify</label>
          ${textInput("verifyImageUrl", config.verifyImageUrl, "https://example.com/image.png")}
          <label>או העלאת תמונה מהמחשב</label>
          ${fileInput("verifyImageFile")}
          <div class="verify-preview" data-verify-preview>
            <p data-verify-preview-text>${escapeHtml(config.verifyText || "כדי להיות מאומתים לחצו על הכפתור")}</p>
            <img data-verify-preview-image src="${escapeHtml(config.verifyImageUrl || "")}" alt="תמונת Verify">
            <span class="verify-preview-button" data-verify-preview-button>${escapeHtml(config.verifyButtonLabel || "Verify")}</span>
          </div>
          <button type="submit" class="button secondary" formaction="/guild/${guildId}/send-verify-panel" formmethod="post">שלח הודעת Verify עכשיו</button>
        </div>

        <div id="welcome" class="panel-section card">
          <h2>ברוכים הבאים</h2>
          <label>חדר Welcome</label>
          ${select("welcomeChannelId", textChannelOptions, config.welcomeChannelId, "לא מוגדר")}
          <label>כותרת ההודעה</label>
          ${textInput("welcomeTitle", config.welcomeTitle, "Welcome!")}
          <label>הודעת Welcome</label>
          ${textArea("welcomeMessage", config.welcomeMessage, "Hey {user}, welcome to **{server}**.")}
          <p class="muted">אפשר להשתמש ב־{user}, {username}, {server} בתוך ההודעה.</p>
          <label>צבע ההודעה</label>
          ${colorInput("welcomeColor", config.welcomeColor)}
          <label>תמונה בהודעת Welcome</label>
          ${textInput("welcomeImageUrl", config.welcomeImageUrl, "https://example.com/image.png")}
          <label>או העלאת תמונה מהמחשב</label>
          ${fileInput("welcomeImageFile")}
          <div class="welcome-preview" data-welcome-preview>
            <div>
              <h3 data-welcome-preview-title>${escapeHtml(config.welcomeTitle || "Welcome!")}</h3>
              <p data-welcome-preview-message>${escapeHtml(config.welcomeMessage || "Hey {user}, welcome to **{server}**.")}</p>
            </div>
            <img class="welcome-avatar" src="https://cdn.discordapp.com/embed/avatars/0.png" alt="תמונת פרופיל">
            <img class="welcome-preview-image" data-welcome-preview-image src="${escapeHtml(config.welcomeImageUrl || "")}" alt="תמונת Welcome">
          </div>
          <button type="submit" class="button secondary" formaction="/guild/${guildId}/send-welcome-panel" formmethod="post">שלח הודעת Welcome עכשיו</button>
        </div>

        <div id="help" class="panel-section card">
          <h2>עזרה</h2>
          <p class="muted">מערכת העזרה משתמשת ברולי הצוות שהגדרת במדור הטיקטים. מי שיש לו אחד מהרולים האלה יכול לקחת פניות עזרה.</p>
        </div>

        <div id="music" class="panel-section card">
          <h2>מוזיקה</h2>
          <p class="muted">פקודות המוזיקה עובדות בחדר קול. המשתמש צריך להיות בשיחה ואז להשתמש בפקודות האלה בדיסקורד.</p>
          <div class="choice-list">
            <p><code>/music play url</code> - ניגון שיר מקישור</p>
            <p><code>/music queue</code> - הצגת התור</p>
            <p><code>/music skip</code> - דילוג לשיר הבא</p>
            <p><code>/music stop</code> - עצירה וניקוי התור</p>
            <p><code>/music leave</code> - הוצאת הבוט מהשיחה</p>
          </div>
        </div>

        <div id="moderation" class="panel-section card">
          <h2>אבטחה</h2>
          <label>חדר לוגים</label>
          ${select("moderationLogChannelId", textChannelOptions, config.moderationLogChannelId, "לא לשלוח לוגים")}
          <h3>חסימת קללות</h3>
          <label>מילים אסורות</label>
          ${textArea("blockedWords", (config.blockedWords || []).join("\n"), "כל מילה בשורה נפרדת")}
          <p class="muted">אפשר להגדיר עד 15 מילים אסורות.</p>
          <label>הודעה למשתמש אחרי מחיקה</label>
          ${textInput("blockedWordsMessage", config.blockedWordsMessage, "ההודעה נמחקה כי היא כוללת מילה אסורה.")}
          <h3>אנטי ספאם</h3>
          <label>כמה הודעות מותר לשלוח</label>
          ${textInput("antiSpamMaxMessages", config.antiSpamMaxMessages, "5")}
          <label>בתוך כמה שניות</label>
          ${textInput("antiSpamWindowSeconds", config.antiSpamWindowSeconds, "6")}
          <label>הודעה למשתמש אחרי ספאם</label>
          ${textInput("antiSpamMessage", config.antiSpamMessage, "נא לא להספים.")}
        </div>

        <div id="giveaways" class="panel-section card">
          <h2>Giveaways</h2>
          <label>חדר ההגרלות</label>
          ${select("giveawayChannelId", textChannelOptions, config.giveawayChannelId, "בחר חדר לשליחת הגרלה")}
          <label>פרס</label>
          ${textInput("giveawayPrize", config.giveawayPrize, "Nitro / Role / Prize")}
          <label>תיאור ההגרלה</label>
          ${textArea("giveawayDescription", config.giveawayDescription, "לחצו על הכפתור כדי להשתתף בהגרלה.")}
          <label>מספר זוכים</label>
          ${textInput("giveawayWinnerCount", config.giveawayWinnerCount, "1")}
          <label>כמה דקות ההגרלה תישאר פתוחה</label>
          ${textInput("giveawayDurationMinutes", config.giveawayDurationMinutes, "60")}
          <label>תמונה להגרלה</label>
          ${textInput("giveawayImageUrl", config.giveawayImageUrl, "https://example.com/image.png")}
          <label>או העלאת תמונה מהמחשב</label>
          ${fileInput("giveawayImageFile")}
          <button type="submit" class="button secondary" formaction="/guild/${guildId}/send-giveaway" formmethod="post">שלח Giveaway עכשיו</button>

          <h3>רירול לזוכה</h3>
          <label>בחר הגרלה שהסתיימה</label>
          ${select("rerollGiveawayId", endedGiveawayOptions, "", endedGiveawayOptions.length ? "בחר הגרלה" : "אין הגרלות שהסתיימו")}
          <button type="submit" class="button secondary" formaction="/guild/${guildId}/reroll-giveaway" formmethod="post">עשה רירול לזוכה</button>
        </div>

        <div id="edit-battles" class="panel-section card">
          <h2>חדר קרב</h2>
          <label>חדר פאנל חדר קרב</label>
          ${select("editBattlePanelChannelId", textChannelOptions, config.editBattlePanelChannelId, "החדר שבו מפעילים")}
          <button type="submit" class="button secondary" formaction="/guild/${guildId}/send-edit-battle-panel" formmethod="post">שלח פאנל חדר קרב עכשיו</button>
        </div>
      </section>
    </form>
  `, getSession(req)));
});

app.post("/guild/:guildId", requireAuth, requireGuildAdmin, imageUpload, (req, res) => {
  setGuildConfig(req.params.guildId, buildGuildConfigFromBody(req.body, req.files));
  res.redirect(`/guild/${req.params.guildId}?saved=1`);
});

app.post("/guild/:guildId/send-ticket-panel", requireAuth, requireGuildAdmin, imageUpload, async (req, res) => {
  const { guildId } = req.params;
  setGuildConfig(guildId, buildGuildConfigFromBody(req.body, req.files));

  const guild = client.guilds.cache.get(guildId);
  const config = getGuildConfig(guildId);
  const channel = guild ? await getWritableTextChannel(guild, config.ticketPanelChannelId) : null;
  if (!guild || !channel) {
    res.status(400).send(sendResultPage("לא נשלח", "צריך לבחור חדר תקין להודעת הטיקטים.", guildId, "tickets"));
    return;
  }

  for (const panel of buildTicketPanelMessages(guildId)) {
    await channel.send(panel);
  }

  res.send(sendResultPage("נשלח", "הודעת הטיקטים נשלחה לחדר שבחרת.", guildId, "tickets"));
});

app.post("/guild/:guildId/send-verify-panel", requireAuth, requireGuildAdmin, imageUpload, async (req, res) => {
  const { guildId } = req.params;
  setGuildConfig(guildId, buildGuildConfigFromBody(req.body, req.files));

  const guild = client.guilds.cache.get(guildId);
  const config = getGuildConfig(guildId);
  const channel = guild ? await getWritableTextChannel(guild, config.verifyPanelChannelId) : null;
  if (!guild || !channel) {
    res.status(400).send(sendResultPage("לא נשלח", "צריך לבחור חדר תקין להודעת Verify.", guildId, "verify"));
    return;
  }

  await channel.send(buildVerifyPanel(guildId));
  res.send(sendResultPage("נשלח", "הודעת Verify נשלחה לחדר שבחרת.", guildId, "verify"));
});

app.post("/guild/:guildId/send-welcome-panel", requireAuth, requireGuildAdmin, imageUpload, async (req, res) => {
  const { guildId } = req.params;
  setGuildConfig(guildId, buildGuildConfigFromBody(req.body, req.files));

  const guild = client.guilds.cache.get(guildId);
  const config = getGuildConfig(guildId);
  const channel = guild ? await getWritableTextChannel(guild, config.welcomeChannelId) : null;
  if (!guild || !channel) {
    res.status(400).send(sendResultPage("לא נשלח", "צריך לבחור חדר Welcome תקין.", guildId, "welcome"));
    return;
  }

  await channel.send(buildWelcomeMessage(guild));
  res.send(sendResultPage("נשלח", "הודעת Welcome נשלחה לחדר שבחרת.", guildId, "welcome"));
});

app.post("/guild/:guildId/send-edit-battle-panel", requireAuth, requireGuildAdmin, imageUpload, async (req, res) => {
  const { guildId } = req.params;
  setGuildConfig(guildId, buildGuildConfigFromBody(req.body, req.files));

  const guild = client.guilds.cache.get(guildId);
  const config = getGuildConfig(guildId);
  const channel = guild ? await getWritableTextChannel(guild, config.editBattlePanelChannelId) : null;
  if (!guild || !channel) {
    res.status(400).send(sendResultPage("לא נשלח", "צריך לבחור חדר תקין לפאנל חדר קרב.", guildId, "edit-battles"));
    return;
  }

  await channel.send(buildEditBattlePanel());
  res.send(sendResultPage("נשלח", "פאנל חדר קרב נשלח לחדר שבחרת.", guildId, "edit-battles"));
});

app.post("/guild/:guildId/send-giveaway", requireAuth, requireGuildAdmin, imageUpload, async (req, res) => {
  const { guildId } = req.params;
  setGuildConfig(guildId, buildGuildConfigFromBody(req.body, req.files));

  const guild = client.guilds.cache.get(guildId);
  const config = getGuildConfig(guildId);
  const channel = guild ? await getWritableTextChannel(guild, config.giveawayChannelId) : null;
  if (!guild || !channel) {
    res.status(400).send(sendResultPage("לא נשלח", "צריך לבחור חדר תקין להגרלה.", guildId, "giveaways"));
    return;
  }

  const giveawayId = crypto.randomBytes(8).toString("hex");
  const giveaway = {
    id: giveawayId,
    guildId,
    channelId: channel.id,
    messageId: "",
    prize: config.giveawayPrize || "פרס חדש",
    description: config.giveawayDescription || "לחצו על הכפתור כדי להשתתף בהגרלה.",
    winnerCount: Math.max(1, Number(config.giveawayWinnerCount || 1)),
    endAt: Date.now() + Math.max(1, Number(config.giveawayDurationMinutes || 60)) * 60000,
    imageUrl: config.giveawayImageUrl || "",
    participants: [],
    winnerIds: [],
    ended: false,
    createdAt: Date.now(),
  };

  const message = await channel.send(buildGiveawayMessage(giveaway));
  giveaway.messageId = message.id;
  setGiveaway(giveawayId, giveaway);

  res.send(sendResultPage("נשלח", "ה־Giveaway נשלח והבוט יבחר זוכים אוטומטית בזמן שהגדרת.", guildId, "giveaways"));
});

app.post("/guild/:guildId/reroll-giveaway", requireAuth, requireGuildAdmin, imageUpload, async (req, res) => {
  const { guildId } = req.params;
  setGuildConfig(guildId, buildGuildConfigFromBody(req.body, req.files));

  const giveaway = getGiveaway(req.body.rerollGiveawayId);
  if (!giveaway || giveaway.guildId !== guildId || !giveaway.ended) {
    res.status(400).send(sendResultPage("לא בוצע", "צריך לבחור הגרלה שהסתיימה.", guildId, "giveaways"));
    return;
  }

  const newWinners = pickGiveawayWinners(giveaway.participants, Number(giveaway.winnerCount || 1), giveaway.winnerIds);
  if (!newWinners.length) {
    res.status(400).send(sendResultPage("לא בוצע", "אין משתתפים שאפשר לבחור מהם זוכה.", guildId, "giveaways"));
    return;
  }

  const updatedGiveaway = {
    ...giveaway,
    winnerIds: newWinners,
    rerolledAt: Date.now(),
  };
  setGiveaway(giveaway.id, updatedGiveaway);

  const guild = client.guilds.cache.get(guildId);
  const channel = guild ? await getWritableTextChannel(guild, giveaway.channelId) : null;
  if (channel) {
    const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
    if (message) {
      await message.edit(buildGiveawayMessage(updatedGiveaway)).catch(console.error);
    }
    await channel.send(`רירול להגרלה **${giveaway.prize}**! הזוכים החדשים: ${newWinners.map((userId) => `<@${userId}>`).join(", ")}`).catch(console.error);
  }

  res.send(sendResultPage("רירול בוצע", "נבחר זוכה חדש וההודעה עודכנה בדיסקורד.", guildId, "giveaways"));
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
