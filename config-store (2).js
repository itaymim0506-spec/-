const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const PREMIUM_PATH = path.join(DATA_DIR, "premium-guilds.json");
const GUILD_CONFIG_PATH = path.join(DATA_DIR, "guild-config.json");
const DEFAULT_PREMIUM_GUILD_IDS = ["1505251555689893978"];

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PREMIUM_PATH)) {
    fs.writeFileSync(PREMIUM_PATH, JSON.stringify({ guildIds: [] }, null, 2));
  }
}

function readPremiumGuildIds() {
  ensureStore();
  const data = JSON.parse(fs.readFileSync(PREMIUM_PATH, "utf8"));
  const fileGuildIds = Array.isArray(data.guildIds) ? data.guildIds.map(String) : [];
  const configGuildIds = fs.existsSync(GUILD_CONFIG_PATH)
    ? Object.entries(JSON.parse(fs.readFileSync(GUILD_CONFIG_PATH, "utf8")))
      .filter(([, config]) => config && config.premium === true)
      .map(([guildId]) => guildId)
    : [];
  const envGuildIds = String(process.env.PREMIUM_GUILD_IDS || "")
    .split(/[\s,]+/)
    .map((guildId) => guildId.trim())
    .filter(Boolean);
  return [...new Set([...DEFAULT_PREMIUM_GUILD_IDS, ...fileGuildIds, ...configGuildIds, ...envGuildIds])];
}

function isPremiumGuild(guildId) {
  return readPremiumGuildIds().includes(String(guildId));
}

module.exports = {
  isPremiumGuild,
  readPremiumGuildIds,
};
