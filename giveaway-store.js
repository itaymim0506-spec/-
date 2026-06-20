const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const CONFIG_PATH = path.join(DATA_DIR, "guild-config.json");
const DEFAULT_VERIFIED_ROLE_BY_GUILD = {
  "1505251555689893978": "1506008339429986324",
};
const FEATURE_OVERRIDES_BY_GUILD = {
  "1505251555689893978": {
    editBattles: true,
    giveaways: true,
  },
};

const DEFAULT_CONFIG = {
  features: {
    verify: true,
    welcome: true,
    help: true,
    tickets: true,
    editBattles: true,
    giveaways: true,
    moderation: true,
    music: true,
  },
  ticketCategoryId: "1498364707747401941",
  ticketOpenRoleId: "1498364648226033664",
  ticketPanelTitle: "Open tickets",
  ticketPanelDescription: "Click the button to open a ticket for the staff.",
  ticketPanelImageUrl: "",
  ticketPanelDisplayMode: "buttons",
  ticketNameMode: "number",
  ticketCounter: 0,
  ticketTranscriptChannelId: "",
  ticketTypes: [
    {
      id: "general",
      buttonLabel: "Open ticket",
      channelPrefix: "ticket",
      embedTitle: "New ticket",
      intro: "Write what you need help with. Staff will respond as soon as possible.",
      buttonStyle: "primary",
    },
  ],
  staffRoleIds: [
    "1498364664902451220",
    "1498364671386718340",
    "1498364679049707773",
    "1498364680949989416",
    "1498364682392834118",
    "1498364683395272878",
    "1498364685819576441",
    "1498364686758842388",
    "1498364687723790376",
    "1498364688520450049",
  ],
  verifiedRoleId: process.env.VERIFIED_ROLE_ID || "1498364648226033664",
  verifyPanelChannelId: "",
  verifyText: "Click the button to get verified",
  verifyButtonLabel: "Verify",
  verifyAccentColor: "#f17100",
  verifyImageUrl: "",
  welcomeChannelId: process.env.WELCOME_CHANNEL_ID || "1498364701078327389",
  welcomeTitle: "Welcome!",
  welcomeMessage: "Hey {user}, welcome to **{server}**.",
  welcomeColor: "#2ecc71",
  welcomeImageUrl: "",
  ticketPanelChannelId: "",
  editBattlePanelChannelId: "1504184944283488328",
  giveawayChannelId: "",
  giveawayPrize: "New prize",
  giveawayDescription: "Click the button to join the giveaway.",
  giveawayWinnerCount: 1,
  giveawayDurationMinutes: 60,
  giveawayImageUrl: "",
  moderationLogChannelId: "",
  blockedWords: [],
  blockedWordsMessage: "The message was deleted because it contains a blocked word.",
  antiSpamMaxMessages: 5,
  antiSpamWindowSeconds: 6,
  antiSpamMessage: "Please do not spam.",
};

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_PATH)) fs.writeFileSync(CONFIG_PATH, JSON.stringify({}, null, 2));
}

function readAllConfigs() {
  ensureStore();
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function writeAllConfigs(configs) {
  ensureStore();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(configs, null, 2));
}

function getGuildConfig(guildId) {
  const configs = readAllConfigs();
  const savedConfig = configs[guildId] || {};
  const ticketTypes = Array.isArray(savedConfig.ticketTypes) && savedConfig.ticketTypes.length
    ? savedConfig.ticketTypes
    : DEFAULT_CONFIG.ticketTypes;
  const config = {
    ...DEFAULT_CONFIG,
    ...savedConfig,
    features: {
      ...DEFAULT_CONFIG.features,
      ...(savedConfig.features || {}),
      ...(FEATURE_OVERRIDES_BY_GUILD[guildId] || {}),
    },
    ticketTypes,
  };
  if (!config.verifiedRoleId && DEFAULT_VERIFIED_ROLE_BY_GUILD[guildId]) {
    config.verifiedRoleId = DEFAULT_VERIFIED_ROLE_BY_GUILD[guildId];
  }
  return config;
}

function setGuildConfig(guildId, updates) {
  const configs = readAllConfigs();
  configs[guildId] = {
    ...getGuildConfig(guildId),
    ...updates,
  };
  writeAllConfigs(configs);
  return configs[guildId];
}

module.exports = {
  DEFAULT_CONFIG,
  getGuildConfig,
  readAllConfigs,
  setGuildConfig,
};

