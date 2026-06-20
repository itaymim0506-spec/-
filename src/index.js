require("dotenv").config();

const fs = require("fs");
const path = require("path");

const {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  VoiceConnectionStatus,
} = require("@discordjs/voice");
const play = require("play-dl");

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
} = require("discord.js");

const DISCORD_TOKEN = String(process.env.DISCORD_TOKEN || "")
  .trim()
  .replace(/^Bot\s+/i, "");
const { CLIENT_ID } = process.env;

const { getGuildConfig, setGuildConfig } = require("./config-store");
const { getActiveGiveaways, getGiveaway, setGiveaway, updateGiveaway } = require("./giveaway-store");
const { isPremiumGuild, readPremiumGuildIds } = require("./premium-store");
const { buildSlashCommands } = require("./slash-commands");
const APP_VERSION = "private-chat-premium-v2";

if (!DISCORD_TOKEN) {
  console.error("Missing DISCORD_TOKEN in .env");
}

process.on("unhandledRejection", (error) => {
  console.error("Unhandled rejection:", error);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});

const VERIFY_BUTTON_ID = "verify_member";
const HELP_CLAIM_BUTTON_ID = "claim_help";
const TICKET_SELECT_MENU_ID = "select_ticket_type";
const TICKET_CLAIM_BUTTON_ID = "claim_ticket";
const TICKET_CLOSE_BUTTON_ID = "close_ticket";
const TICKET_PANEL_IMAGE_PATH = path.join(
  process.env.USERPROFILE || "C:\\Users\\איתי",
  "Downloads",
  "ChatGPT Image May 13, 2026, 08_57_08 PM.png",
);
const TICKET_PANEL_IMAGE_NAME = "tickets-banner.png";
const EDIT_BATTLE_PANEL_CHANNEL_ID = "1504184944283488328";
const EDIT_BATTLE_JOIN_BUTTON_ID = "join_edit_battle";
const RANDOM_PRIVATE_CHAT_BUTTON_ID = "random_private_chat";
const PRIVATE_CHAT_INVITATIONS_BUTTON_ID = "private_chat_invitations";
const PRIVATE_CHAT_ACCEPT_PREFIX = "private_chat_accept:";
const PRIVATE_CHAT_DECLINE_PREFIX = "private_chat_decline:";
const PRIVATE_CHAT_USER_SELECT_ID = "private_chat_user_select";
const GIVEAWAY_JOIN_PREFIX = "giveaway_join_";
const EDIT_BATTLE_IMAGE_PATH = path.join(
  process.env.USERPROFILE || "C:\\Users\\איתי",
  "Downloads",
  "ChatGPT Image May 13, 2026, 09_18_40 PM.png",
);
const EDIT_BATTLE_IMAGE_NAME = "edit-battle.png";
const VERIFY_IMAGE_URL = "https://cdn.discordapp.com/attachments/1484641087355359344/1501598281829060689/2f1a380c-89e9-46a0-9bd8-2657e4e631a3.png?ex=69fca7e0&is=69fb5660&hm=35ebdc5326ea02c23655ea26ae2819dc5c20aaea1dda0cdf704b96e140bc3e7e&";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.on(Events.Error, (error) => {
  console.error("Discord client error:", error);
});

const privateChatInvites = new Map();
const randomPrivateChatQueues = new Map();
const finishVotesByChannel = new Map();
const closingChannels = new Set();
const spamBuckets = new Map();
const musicQueues = new Map();
const FREE_TICKET_TYPE_LIMIT = 3;
const FREE_BLOCKED_WORD_LIMIT = 15;

function isStaff(member) {
  const { staffRoleIds } = getGuildConfig(member.guild.id);
  return member.permissions?.has(PermissionFlagsBits.ManageGuild)
    || staffRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

function canOpenTicket(member) {
  const { ticketOpenRoleId } = getGuildConfig(member.guild.id);
  if (!ticketOpenRoleId) return true;
  return member.roles.cache.has(ticketOpenRoleId);
}

function isFeatureEnabled(guildId, featureName) {
  if (!isPremiumGuild(guildId) && ["editBattles", "giveaways"].includes(featureName)) return false;
  const { features } = getGuildConfig(guildId);
  return features?.[featureName] !== false;
}

function normalizeModerationText(value) {
  return String(value || "").toLowerCase();
}

function getBlockedWord(content, blockedWords) {
  const normalizedContent = normalizeModerationText(content);
  return (blockedWords || []).slice(0, 15).find((word) => word && normalizedContent.includes(normalizeModerationText(word)));
}

async function sendModerationLog(guild, config, text) {
  if (!config.moderationLogChannelId) return;
  const channel = await guild.channels.fetch(config.moderationLogChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  await channel.send(text).catch(console.error);
}

async function handleModeration(message) {
  if (!message.guild || message.author.bot || !message.member) return false;
  const config = getGuildConfig(message.guild.id);
  if (!config.features?.moderation) return false;
  if (isStaff(message.member)) return false;

  const blockedWords = isPremiumGuild(message.guild.id)
    ? config.blockedWords
    : (config.blockedWords || []).slice(0, FREE_BLOCKED_WORD_LIMIT);
  const blockedWord = getBlockedWord(message.content, blockedWords);
  if (blockedWord) {
    await message.delete().catch(console.error);
    await message.channel.send(`${message.author}, ${config.blockedWordsMessage || "The message was deleted because it contains a blocked word."}`)
      .then((warning) => setTimeout(() => warning.delete().catch(() => {}), 5000))
      .catch(console.error);
    await sendModerationLog(message.guild, config, `נמחקה הודעה עם מילה אסורה מאת ${message.author} בחדר ${message.channel}. מילה: \`${blockedWord}\``);
    return true;
  }

  const now = Date.now();
  const windowMs = Math.max(2, Number(config.antiSpamWindowSeconds || 6)) * 1000;
  const maxMessages = Math.max(2, Number(config.antiSpamMaxMessages || 5));
  const bucketKey = `${message.guild.id}:${message.channel.id}:${message.author.id}`;
  const recentMessages = (spamBuckets.get(bucketKey) || []).filter((timestamp) => now - timestamp <= windowMs);
  recentMessages.push(now);
  spamBuckets.set(bucketKey, recentMessages);

  if (recentMessages.length > maxMessages) {
    await message.delete().catch(console.error);
    await message.channel.send(`${message.author}, ${config.antiSpamMessage || "Please do not spam."}`)
      .then((warning) => setTimeout(() => warning.delete().catch(() => {}), 5000))
      .catch(console.error);
    await sendModerationLog(message.guild, config, `נמחקה הודעת ספאם מאת ${message.author} בחדר ${message.channel}. ${recentMessages.length} הודעות בתוך ${Math.round(windowMs / 1000)} שניות.`);
    return true;
  }

  return false;
}

function getValidCategoryId(guild, categoryId) {
  const category = categoryId ? guild.channels.cache.get(categoryId) : null;
  return category?.type === ChannelType.GuildCategory ? category.id : null;
}

function getValidRoleIds(guild, roleIds) {
  return roleIds.filter((roleId) => guild.roles.cache.has(roleId));
}

async function botCanManageChannels(guild) {
  const botMember = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  return botMember?.permissions.has(PermissionFlagsBits.ManageChannels) ?? false;
}

async function getOrCreateTicketCategory(guild, configuredCategoryId) {
  const validCategoryId = getValidCategoryId(guild, configuredCategoryId);
  if (validCategoryId) return validCategoryId;

  const existingCategory = guild.channels.cache.find((channel) => (
    channel.type === ChannelType.GuildCategory && channel.name.toLowerCase() === "tickets"
  ));
  if (existingCategory) {
    setGuildConfig(guild.id, { ticketCategoryId: existingCategory.id });
    return existingCategory.id;
  }

  const category = await guild.channels.create({
    name: "Tickets",
    type: ChannelType.GuildCategory,
  });

  setGuildConfig(guild.id, { ticketCategoryId: category.id });
  return category.id;
}

async function createTicketChannel(guild, options) {
  try {
    return await guild.channels.create(options);
  } catch (error) {
    console.error("Ticket channel create with category failed:", error);

    if (!options.parent) throw error;

    return guild.channels.create({
      ...options,
      parent: null,
    });
  }
}

function getTicketOwnerId(channel) {
  return channel.topic?.match(/^ticket:[a-z0-9-]+:(\d+)/)?.[1]
    ?? channel.topic?.match(/^player-report-ticket:(\d+)/)?.[1]
    ?? null;
}

function getTicketClaimedUserId(channel) {
  return channel.topic?.match(/^ticket:[a-z0-9-]+:\d+(?::number:\d+)?:claimed:(\d+)/)?.[1] ?? null;
}

function getEditBattleUserIds(channel) {
  const match = channel.topic?.match(/^(?:edit-battle|private-chat):(\d+):(\d+)/);
  return match ? [match[1], match[2]] : [];
}

function getFinishRequiredUserIds(channel) {
  const editBattleUserIds = getEditBattleUserIds(channel);
  if (editBattleUserIds.length === 2) return editBattleUserIds;

  const ticketOwnerId = getTicketOwnerId(channel);
  const ticketClaimedUserId = getTicketClaimedUserId(channel);
  if (ticketOwnerId && ticketClaimedUserId) return [ticketOwnerId, ticketClaimedUserId];

  return [];
}

function hasEveryoneFinished(channel) {
  const requiredUserIds = getFinishRequiredUserIds(channel);
  const finishVotes = finishVotesByChannel.get(channel.id);
  return requiredUserIds.length === 2 && requiredUserIds.every((userId) => finishVotes?.has(userId));
}

async function fetchAllMessages(channel) {
  const messages = [];
  let before;

  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch?.size) break;
    messages.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }

  return messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

function messageToTranscriptLine(message) {
  const time = new Date(message.createdTimestamp).toISOString();
  const author = `${message.author?.tag || message.author?.username || "Unknown"} (${message.author?.id || "unknown"})`;
  const content = message.content || "";
  const attachments = [...message.attachments.values()].map((attachment) => attachment.url);
  const embeds = message.embeds?.length ? [`[${message.embeds.length} embed(s)]`] : [];
  const extras = [...attachments, ...embeds].join(" ");
  return `[${time}] ${author}: ${content}${extras ? ` ${extras}` : ""}`;
}

async function sendTicketTranscript(channel, closedByLabel = "Unknown") {
  if (!isPremiumGuild(channel.guild.id)) return;
  const ticketOwnerId = getTicketOwnerId(channel);
  if (!ticketOwnerId) return;

  const { ticketTranscriptChannelId } = getGuildConfig(channel.guild.id);
  if (!ticketTranscriptChannelId) return;

  const transcriptChannel = await channel.guild.channels.fetch(ticketTranscriptChannelId).catch(() => null);
  if (!transcriptChannel?.isTextBased()) return;

  const messages = await fetchAllMessages(channel);
  const transcript = [
    `Transcript for #${channel.name}`,
    `Guild: ${channel.guild.name} (${channel.guild.id})`,
    `Channel: ${channel.name} (${channel.id})`,
    `Ticket owner: ${ticketOwnerId}`,
    `Closed by: ${closedByLabel}`,
    `Created at: ${channel.createdAt?.toISOString() || "unknown"}`,
    `Closed at: ${new Date().toISOString()}`,
    "",
    ...messages.map(messageToTranscriptLine),
    "",
  ].join("\n");

  const buffer = Buffer.from(transcript, "utf8");
  const safeName = channel.name.replace(/[^a-z0-9-]/gi, "-").slice(0, 60) || "ticket";

  await transcriptChannel.send({
    content: `Transcript לטיקט ${channel.name} | נפתח על ידי <@${ticketOwnerId}> | נסגר על ידי ${closedByLabel}`,
    files: [{ attachment: buffer, name: `${safeName}-transcript.txt` }],
  }).catch(console.error);
}

async function scheduleChannelClose(channel, reason) {
  if (closingChannels.has(channel.id)) return;
  closingChannels.add(channel.id);

  const isTicketChannel = Boolean(getTicketOwnerId(channel));
  if (isTicketChannel) {
    await sendTicketTranscript(channel, "סגירה אוטומטית").catch(console.error);
  }
  await channel.send(reason).catch(console.error);
  setTimeout(() => {
    finishVotesByChannel.delete(channel.id);
    closingChannels.delete(channel.id);
    channel.delete("Both users finished").catch(console.error);
  }, 5000);
}

function slug(value, fallback = "ticket") {
  const cleaned = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return cleaned || fallback;
}

function getTicketTypes(guildId) {
  const config = getGuildConfig(guildId);
  const ticketTypes = Array.isArray(config.ticketTypes) && config.ticketTypes.length
    ? config.ticketTypes
    : [{
      id: "general",
      buttonLabel: config.ticketButtonLabel || "פתח טיקט",
      channelPrefix: config.ticketChannelPrefix || "ticket",
      embedTitle: config.ticketEmbedTitle || "New ticket",
      intro: config.ticketIntro || "Write what you need help with. Staff will respond as soon as possible.",
    }];

  const visibleTicketTypes = isPremiumGuild(guildId)
    ? ticketTypes
    : ticketTypes.slice(0, FREE_TICKET_TYPE_LIMIT);

  return visibleTicketTypes
    .map((ticketType, index) => {
      const id = slug(ticketType.id || ticketType.buttonLabel || `ticket-${index + 1}`, `ticket-${index + 1}`);
      return {
        id,
        buttonId: `open_ticket_${id}`,
        buttonLabel: ticketType.buttonLabel || `טיקט ${index + 1}`,
        channelPrefix: slug(ticketType.channelPrefix || ticketType.buttonLabel || id, "ticket"),
        embedTitle: ticketType.embedTitle || ticketType.buttonLabel || "New ticket",
        intro: ticketType.intro || "Write what you need help with. Staff will respond as soon as possible.",
        buttonStyle: ticketType.buttonStyle || "primary",
      };
    });
}

function getTicketTypeByButton(buttonId, guildId) {
  return getTicketTypes(guildId).find((ticketType) => ticketType.buttonId === buttonId);
}

function getTicketTypeById(ticketId, guildId) {
  return getTicketTypes(guildId).find((ticketType) => ticketType.id === ticketId);
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

function buildTicketChannelName(config, ticketType, user, ticketNumber) {
  if (config.ticketNameMode === "user") return `ticket-${slug(user.username || user.id, user.id)}`;
  if (config.ticketNameMode === "reason") return `ticket-${slug(ticketType.buttonLabel || ticketType.channelPrefix, ticketType.channelPrefix)}`;
  return `ticket-${String(ticketNumber).padStart(4, "0")}`;
}

function parseColor(value, fallback = 0x2ecc71) {
  const hex = String(value || "").trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return Number.parseInt(hex, 16);
  return fallback;
}

function formatTemplate(template, member) {
  return String(template || "")
    .replaceAll("{user}", `${member}`)
    .replaceAll("{username}", member.user.username)
    .replaceAll("{server}", member.guild.name);
}

function formatTimestamp(ms) {
  return `<t:${Math.floor(ms / 1000)}:R>`;
}

function pickWinners(participants, winnerCount) {
  const pool = [...new Set(participants)];
  const winners = [];
  while (pool.length && winners.length < winnerCount) {
    const index = Math.floor(Math.random() * pool.length);
    winners.push(pool.splice(index, 1)[0]);
  }
  return winners;
}

function buildGiveawayMessage(giveaway) {
  const ended = Boolean(giveaway.ended);
  const winnersText = giveaway.winnerIds?.length
    ? giveaway.winnerIds.map((userId) => `<@${userId}>`).join(", ")
    : "עדיין אין";

  const embed = new EmbedBuilder()
    .setColor(ended ? 0x2ecc71 : 0xf1c40f)
    .setTitle(`🎉 ${giveaway.prize}`)
    .setDescription(giveaway.description || "Click the button to join the giveaway.")
    .addFields(
      { name: "זוכים", value: String(giveaway.winnerCount || 1), inline: true },
      { name: "משתתפים", value: String(giveaway.participants?.length || 0), inline: true },
      { name: ended ? "זוכים שנבחרו" : "נגמר", value: ended ? winnersText : formatTimestamp(giveaway.endAt), inline: false },
    )
    .setTimestamp();

  if (giveaway.imageUrl) embed.setImage(giveaway.imageUrl);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${GIVEAWAY_JOIN_PREFIX}${giveaway.id}`)
      .setLabel(ended ? "ההגרלה נגמרה" : "השתתף בהגרלה")
      .setStyle(ended ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(ended),
  );

  return { embeds: [embed], components: [row] };
}

async function finishGiveaway(giveaway) {
  if (!giveaway || giveaway.ended) return;

  const guild = client.guilds.cache.get(giveaway.guildId);
  const channel = guild ? await guild.channels.fetch(giveaway.channelId).catch(() => null) : null;
  if (!channel?.isTextBased()) return;

  const winners = pickWinners(giveaway.participants || [], Number(giveaway.winnerCount || 1));
  const endedGiveaway = {
    ...giveaway,
    ended: true,
    winnerIds: winners,
    endedAt: Date.now(),
  };
  setGiveaway(giveaway.id, endedGiveaway);

  const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
  if (message) {
    await message.edit(buildGiveawayMessage(endedGiveaway)).catch(console.error);
  }

  if (winners.length) {
    await channel.send(`🎉 ההגרלה על **${giveaway.prize}** נגמרה! הזוכים: ${winners.map((userId) => `<@${userId}>`).join(", ")}`).catch(console.error);
  } else {
    await channel.send(`ההגרלה על **${giveaway.prize}** נגמרה, אבל לא היו משתתפים.`).catch(console.error);
  }
}

async function checkGiveaways() {
  const now = Date.now();
  const dueGiveaways = getActiveGiveaways().filter((giveaway) => Number(giveaway.endAt) <= now);
  for (const giveaway of dueGiveaways) {
    await finishGiveaway(giveaway).catch(console.error);
  }
}

function getMusicQueue(guildId) {
  let queue = musicQueues.get(guildId);
  if (!queue) {
    const player = createAudioPlayer();
    queue = {
      connection: null,
      current: null,
      player,
      songs: [],
      textChannel: null,
    };
    musicQueues.set(guildId, queue);

    player.on(AudioPlayerStatus.Idle, () => {
      queue.current = null;
      playNextSong(guildId).catch(console.error);
    });

    player.on("error", (error) => {
      console.error("Music player error:", error);
      queue.textChannel?.send("הייתה שגיאה בניגון השיר, מדלג לשיר הבא.").catch(console.error);
      queue.current = null;
      playNextSong(guildId).catch(console.error);
    });
  }
  return queue;
}

async function resolveSong(url, requestedBy) {
  const validation = await play.validate(url).catch(() => false);
  if (!validation) {
    return null;
  }

  if (validation === "yt_video") {
    const info = await play.video_info(url);
    return {
      requestedBy,
      title: info.video_details.title || url,
      url: info.video_details.url || url,
    };
  }

  return {
    requestedBy,
    title: url,
    url,
  };
}

async function playNextSong(guildId) {
  const queue = getMusicQueue(guildId);
  const nextSong = queue.songs.shift();
  if (!nextSong) return;

  queue.current = nextSong;
  const stream = await play.stream(nextSong.url);
  const resource = createAudioResource(stream.stream, { inputType: stream.type });
  queue.player.play(resource);
  queue.connection?.subscribe(queue.player);

  await queue.textChannel?.send(`מנגן עכשיו: **${nextSong.title}**`).catch(console.error);
}

async function ensureMusicConnection(interaction, queue) {
  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    await interaction.editReply("אתה צריך להיות בחדר קול כדי להשתמש במוזיקה.");
    return null;
  }

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: interaction.guild.id,
    adapterCreator: interaction.guild.voiceAdapterCreator,
    selfDeaf: true,
  });

  queue.connection = connection;
  queue.textChannel = interaction.channel;
  connection.subscribe(queue.player);

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5000),
      ]);
    } catch {
      connection.destroy();
      musicQueues.delete(interaction.guild.id);
    }
  });

  return connection;
}

async function handleMusicCommand(interaction) {
  if (!isFeatureEnabled(interaction.guild.id, "music")) {
    await interaction.reply({ content: "מערכת המוזיקה כבויה בשרת הזה.", flags: 64 });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  const queue = getMusicQueue(interaction.guild.id);

  if (subcommand === "play") {
    await interaction.deferReply();
    const url = interaction.options.getString("url", true);
    const connection = await ensureMusicConnection(interaction, queue);
    if (!connection) return;

    const song = await resolveSong(url, interaction.user.id).catch((error) => {
      console.error(error);
      return null;
    });

    if (!song) {
      await interaction.editReply("לא הצלחתי לקרוא את הקישור הזה.");
      return;
    }

    queue.songs.push(song);
    if (!queue.current && queue.player.state.status !== AudioPlayerStatus.Playing) {
      await playNextSong(interaction.guild.id);
      await interaction.editReply(`התחלתי לנגן: **${song.title}**`);
    } else {
      await interaction.editReply(`הוספתי לתור: **${song.title}**`);
    }
    return;
  }

  if (subcommand === "queue") {
    const current = queue.current ? `עכשיו: **${queue.current.title}**` : "לא מתנגן כלום כרגע.";
    const songs = queue.songs.slice(0, 10).map((song, index) => `${index + 1}. ${song.title}`).join("\n") || "התור ריק.";
    await interaction.reply({ content: `${current}\n\n${songs}`, flags: 64 });
    return;
  }

  if (subcommand === "skip") {
    if (!queue.current) {
      await interaction.reply({ content: "אין שיר לדלג עליו.", flags: 64 });
      return;
    }

    queue.player.stop(true);
    await interaction.reply("דילגתי לשיר הבא.");
    return;
  }

  if (subcommand === "stop") {
    queue.songs = [];
    queue.current = null;
    queue.player.stop(true);
    await interaction.reply("עצרתי את המוזיקה וניקיתי את התור.");
    return;
  }

  if (subcommand === "leave") {
    queue.songs = [];
    queue.current = null;
    queue.player.stop(true);
    const connection = queue.connection || getVoiceConnection(interaction.guild.id);
    connection?.destroy();
    musicQueues.delete(interaction.guild.id);
    await interaction.reply("יצאתי מחדר הקול.");
  }
}

function buildHelpRequest(member, textChannel, voiceChannel) {
  const embed = new EmbedBuilder()
    .setColor(0xf17100)
    .setTitle("צריך עזרה")
    .setDescription(`${member} צריך עזרה בשיחה ${voiceChannel}.`)
    .addFields(
      { name: "סטטוס", value: "ממתין לצוות" },
      { name: "שיחת קול", value: `${voiceChannel}` },
      { name: "חדר בקשה", value: `${textChannel}` },
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(HELP_CLAIM_BUTTON_ID)
      .setLabel("לקחת טיפול")
      .setStyle(ButtonStyle.Primary),
  );

  return { embeds: [embed], components: [row] };
}

function buildTicketPanelMessages(guildId) {
  const config = getGuildConfig(guildId);
  const ticketTypes = getTicketTypes(guildId);
  const chunks = [];
  for (let index = 0; index < ticketTypes.length; index += 25) {
    chunks.push(ticketTypes.slice(index, index + 25));
  }

  return chunks.map((chunk, chunkIndex) => {
    const embed = new EmbedBuilder()
      .setColor(0x8b2cff)
      .setTitle(chunks.length > 1 ? `${config.ticketPanelTitle || "פתיחת טיקטים"} ${chunkIndex + 1}` : (config.ticketPanelTitle || "פתיחת טיקטים"))
      .setDescription(config.ticketPanelDescription || "Click the button to open a ticket for the staff.");

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

function buildTicketPanel(guildId) {
  return buildTicketPanelMessages(guildId)[0];
}

function buildVerifyPanel(guildId) {
  const config = getGuildConfig(guildId);
  const components = [
    { type: 10, content: config.verifyText || "Click the button to get verified" },
  ];

  if (config.verifyImageUrl || VERIFY_IMAGE_URL) {
    components.push({ type: 12, items: [{ media: { url: config.verifyImageUrl || VERIFY_IMAGE_URL } }] });
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

function buildTicketActionRow({ claimedBy } = {}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(TICKET_CLAIM_BUTTON_ID)
      .setLabel(claimedBy ? `נלקח על ידי ${claimedBy}` : "לקחת טיקט")
      .setStyle(claimedBy ? ButtonStyle.Success : ButtonStyle.Primary)
      .setDisabled(Boolean(claimedBy)),
    new ButtonBuilder()
      .setCustomId(TICKET_CLOSE_BUTTON_ID)
      .setLabel("סגור טיקט")
      .setStyle(ButtonStyle.Secondary),
  );
}

function buildEditBattlePanel(guildId) {
  const config = getGuildConfig(guildId);
  const embed = new EmbedBuilder()
    .setColor(parseColor(config.privateChatPanelColor, 0x8b2cff))
    .setTitle(String(config.privateChatPanelTitle || "Private Chat").slice(0, 256))
    .setDescription(String(config.privateChatPanelDescription || "Click the button, choose the person you want to invite, and ask them to invite you back. A private room opens only when both users invite each other.").slice(0, 4096));

  const files = [];
  if (/^https?:\/\//i.test(config.privateChatPanelImageUrl || "")) {
    embed.setImage(config.privateChatPanelImageUrl);
  } else if (fs.existsSync(EDIT_BATTLE_IMAGE_PATH)) {
    embed.setImage(`attachment://${EDIT_BATTLE_IMAGE_NAME}`);
    files.push({ attachment: EDIT_BATTLE_IMAGE_PATH, name: EDIT_BATTLE_IMAGE_NAME });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(EDIT_BATTLE_JOIN_BUTTON_ID)
      .setLabel(String(config.privateChatButtonLabel || "Start Private Chat").slice(0, 80))
      .setStyle(getTicketButtonStyle(config.privateChatButtonStyle)),
    new ButtonBuilder()
      .setCustomId(RANDOM_PRIVATE_CHAT_BUTTON_ID)
      .setLabel(String(config.privateChatRandomButtonLabel || "Random Private Chat").slice(0, 80))
      .setStyle(getTicketButtonStyle(config.privateChatRandomButtonStyle)),
    new ButtonBuilder()
      .setCustomId(PRIVATE_CHAT_INVITATIONS_BUTTON_ID)
      .setLabel(String(config.privateChatInvitationsButtonLabel || "My Invitations").slice(0, 80))
      .setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row], files };
}

async function createPrivateChatChannel(guild, parentId, firstUserId, secondUserId, { random = false } = {}) {
  const existingChannel = guild.channels.cache.find((channel) => {
    const userIds = getEditBattleUserIds(channel);
    return userIds.length === 2
      && userIds.includes(firstUserId)
      && userIds.includes(secondUserId);
  });
  if (existingChannel) return existingChannel;

  const permissionOverwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: firstUserId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
    {
      id: secondUserId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
    {
      id: client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
  ];

  const privateChannel = await guild.channels.create({
    name: `${random ? "random-chat" : "private-chat"}-${firstUserId.slice(-4)}-${secondUserId.slice(-4)}`,
    type: ChannelType.GuildText,
    parent: parentId || null,
    topic: `private-chat:${firstUserId}:${secondUserId}`,
    permissionOverwrites,
  }).catch((error) => {
    console.error("Could not create random private chat:", error);
    return null;
  });

  if (!privateChannel) return null;

  const embed = new EmbedBuilder()
    .setColor(0x8b2cff)
    .setTitle(random ? "Random Private Chat" : "Private Chat Opened")
    .setDescription(random
      ? `<@${firstUserId}> ו־<@${secondUserId}> הותאמתם באופן אקראי. רק שניכם יכולים לראות ולכתוב בחדר הזה.\n\nכדי לסגור אותו אוטומטית, שניכם צריכים לכתוב \`!סיימתי\`.`
      : `<@${firstUserId}> ו־<@${secondUserId}>, ההזמנה אושרה. רק שניכם יכולים לראות ולכתוב בחדר הזה.\n\nכדי לסגור אותו אוטומטית, שניכם צריכים לכתוב \`!סיימתי\`.`)
    .setTimestamp();

  await privateChannel.send({
    content: `<@${firstUserId}> <@${secondUserId}>`,
    embeds: [embed],
  });

  return privateChannel;
}

async function sendFreshPanels(guild, channel) {
  const { features, editBattlePanelChannelId } = getGuildConfig(guild.id);
  const sentPanels = [];

  if (features.verify) {
    await channel.send(buildVerifyPanel(guild.id));
    sentPanels.push("Verify");
  }

  if (features.tickets) {
    for (const panel of buildTicketPanelMessages(guild.id)) {
      await channel.send(panel);
    }
    sentPanels.push("Tickets");
  }

  if (features.editBattles) {
    const editBattleChannel = await guild.channels.fetch(editBattlePanelChannelId).catch(() => null);
    const targetChannel = editBattleChannel?.isTextBased() ? editBattleChannel : channel;
    await targetChannel.send(buildEditBattlePanel(guild.id));
    sentPanels.push("Private Chat");
  }

  return sentPanels;
}

async function syncSlashCommands() {
  if (!CLIENT_ID || !DISCORD_TOKEN) return;

  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: buildSlashCommands() });
  console.log("Slash commands synced.");
}

function buildTicketTopic(ticketType, userId, ticketNumber) {
  return `ticket:${ticketType.channelPrefix}:${userId}:number:${ticketNumber}`;
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag} (${APP_VERSION})`);
  console.log(`Premium guilds: ${readPremiumGuildIds().join(",") || "none"}`);
  syncSlashCommands().catch((error) => {
    console.error("Slash command sync failed:", error);
  });
  checkGiveaways().catch(console.error);
  setInterval(() => {
    checkGiveaways().catch(console.error);
  }, 30000);
});

client.on(Events.GuildMemberAdd, async (member) => {
  const { features, welcomeChannelId, welcomeTitle, welcomeMessage, welcomeColor, welcomeImageUrl } = getGuildConfig(member.guild.id);
  if (!features.welcome || !welcomeChannelId) return;

  const channel = await member.guild.channels.fetch(welcomeChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(parseColor(welcomeColor))
    .setTitle(welcomeTitle || "Welcome!")
    .setDescription(formatTemplate(welcomeMessage || "Hey {user}, welcome to **{server}**.", member))
    .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
    .setTimestamp();

  if (isPremiumGuild(member.guild.id) && welcomeImageUrl) {
    embed.setImage(welcomeImageUrl);
  }

  await channel.send({ embeds: [embed] }).catch(console.error);
});

client.on(Events.MessageCreate, async (message) => {
  if (await handleModeration(message)) return;

  if (!message.author.bot && message.content.trim() === "!סיימתי") {
    const requiredUserIds = getFinishRequiredUserIds(message.channel);
    if (!requiredUserIds.includes(message.author.id)) return;

    const finishVotes = finishVotesByChannel.get(message.channel.id) ?? new Set();
    finishVotes.add(message.author.id);
    finishVotesByChannel.set(message.channel.id, finishVotes);

    if (requiredUserIds.every((userId) => finishVotes.has(userId))) {
      await scheduleChannelClose(message.channel, "שני המשתמשים כתבו `!סיימתי`. החדר ייסגר אוטומטית בעוד 5 שניות.");
    } else {
      await message.reply("סימנתי שסיימת. מחכים למשתמש השני שיכתוב `!סיימתי`.").catch(console.error);
    }
    return;
  }

  if (!message.author.bot && message.content.trim() === "!חדש-כפתורים") {
    if (!message.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
      await message.reply("רק מי שיש לו Manage Server יכול לחדש את הכפתורים.").catch(console.error);
      return;
    }

    await sendFreshPanels(message.guild, message.channel).catch(console.error);

    await message.reply("חידשתי את הכפתורים הפעילים לשרת הזה.").catch(console.error);
    return;
  }

  if (message.author.bot || message.content.toLowerCase() !== "!help") return;
  if (!isFeatureEnabled(message.guild.id, "help")) return;

  const voiceChannel = message.member?.voice?.channel;
  if (!voiceChannel) {
    await message.reply("אתה צריך להיות בשיחה כדי לכתוב `!help`.").catch(console.error);
    return;
  }

  await message.reply(buildHelpRequest(message.member, message.channel, voiceChannel)).catch(console.error);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand() && interaction.commandName === "music") {
    await handleMusicCommand(interaction);
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "help") {
    if (!isFeatureEnabled(interaction.guild.id, "help")) {
      await interaction.reply({ content: "מערכת העזרה כבויה בשרת הזה.", flags: 64 });
      return;
    }

    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) {
      await interaction.reply({
        content: "אתה צריך להיות בשיחה כדי לכתוב `!help`.",
        flags: 64,
      });
      return;
    }

    await interaction.channel.send(buildHelpRequest(interaction.member, interaction.channel, voiceChannel));
    await interaction.reply({ content: "הבקשה נשלחה לצוות.", flags: 64 });
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "setup-ticket") {
    if (!isFeatureEnabled(interaction.guild.id, "tickets")) {
      await interaction.reply({ content: "מערכת הטיקטים כבויה בשרת הזה.", flags: 64 });
      return;
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: "You need Manage Server permission to use this.", flags: 64 });
      return;
    }

    setGuildConfig(interaction.guild.id, { ticketPanelChannelId: interaction.channel.id });

    for (const panel of buildTicketPanelMessages(interaction.guild.id)) {
      await interaction.channel.send(panel);
    }
    await interaction.reply({ content: "Ticket panel posted.", flags: 64 });
    return;
  }

  if (interaction.isChatInputCommand() && ["setup-edit-battle", "setup-private-chat"].includes(interaction.commandName)) {
    if (!isFeatureEnabled(interaction.guild.id, "editBattles")) {
      await interaction.reply({ content: "Private Chat is disabled on this server.", flags: 64 });
      return;
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: "You need Manage Server permission to use this.", flags: 64 });
      return;
    }

    await interaction.channel.send(buildEditBattlePanel(interaction.guild.id));
    await interaction.reply({ content: "Private Chat panel posted.", flags: 64 });
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "setup-verify") {
    if (!isFeatureEnabled(interaction.guild.id, "verify")) {
      await interaction.reply({ content: "מערכת האימות כבויה בשרת הזה.", flags: 64 });
      return;
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: "You need Manage Server permission to use this.", flags: 64 });
      return;
    }

    setGuildConfig(interaction.guild.id, { verifyPanelChannelId: interaction.channel.id });
    await interaction.channel.send(buildVerifyPanel(interaction.guild.id));

    await interaction.reply({ content: "Verification panel posted.", flags: 64 });
    return;
  }

  if (interaction.isButton() && interaction.customId === EDIT_BATTLE_JOIN_BUTTON_ID) {
    if (!isFeatureEnabled(interaction.guild.id, "editBattles")) {
      await interaction.reply({ content: "Private Chat is disabled on this server.", flags: 64 });
      return;
    }

    await interaction.reply({
      content: "Choose the user you want to invite. The private room opens only after they invite you back.",
      components: [
        new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder()
            .setCustomId(PRIVATE_CHAT_USER_SELECT_ID)
            .setPlaceholder("Choose a user")
            .setMinValues(1)
            .setMaxValues(1),
        ),
      ],
      flags: 64,
    });
    return;
  }

  if (interaction.isButton() && interaction.customId === RANDOM_PRIVATE_CHAT_BUTTON_ID) {
    if (!isFeatureEnabled(interaction.guild.id, "editBattles")) {
      await interaction.reply({ content: "Private Chat is disabled on this server.", flags: 64 });
      return;
    }

    const guildId = interaction.guild.id;
    const userId = interaction.user.id;
    const queue = randomPrivateChatQueues.get(guildId) ?? [];
    randomPrivateChatQueues.set(guildId, queue);

    const ownQueueIndex = queue.indexOf(userId);
    if (ownQueueIndex !== -1) {
      queue.splice(ownQueueIndex, 1);
      if (!queue.length) randomPrivateChatQueues.delete(guildId);
      await interaction.reply({ content: "יצאת מההמתנה להתאמה אקראית.", flags: 64 });
      return;
    }

    let matchedUserId = null;
    while (queue.length && !matchedUserId) {
      const candidateId = queue.shift();
      if (candidateId === userId) continue;
      const candidate = await interaction.guild.members.fetch(candidateId).catch(() => null);
      if (candidate && !candidate.user.bot) matchedUserId = candidateId;
    }

    if (!queue.length) randomPrivateChatQueues.delete(guildId);

    if (!matchedUserId) {
      queue.push(userId);
      randomPrivateChatQueues.set(guildId, queue);
      await interaction.reply({
        content: "נכנסת להמתנה. ברגע שמשתמש נוסף ילחץ על הכפתור ייפתח לכם חדר פרטי.",
        flags: 64,
      });
      return;
    }

    await interaction.deferReply({ flags: 64 });
    const privateChannel = await createPrivateChatChannel(
      interaction.guild,
      interaction.channel.parentId,
      matchedUserId,
      userId,
      { random: true },
    );

    if (!privateChannel) {
      queue.unshift(matchedUserId);
      randomPrivateChatQueues.set(guildId, queue);
      await interaction.editReply("לא הצלחתי לפתוח חדר פרטי. צריך לבדוק שלבוט יש הרשאת Manage Channels.");
      return;
    }

    await interaction.editReply(`נמצאה התאמה! החדר הפרטי שלכם: ${privateChannel}`);
    return;
  }

  if (interaction.isButton() && interaction.customId === PRIVATE_CHAT_INVITATIONS_BUTTON_ID) {
    if (!isFeatureEnabled(interaction.guild.id, "editBattles")) {
      await interaction.reply({ content: "Private Chat is disabled on this server.", flags: 64 });
      return;
    }

    const guildInvites = privateChatInvites.get(interaction.guild.id) ?? new Map();
    const invitations = [...guildInvites.entries()]
      .filter(([, targetId]) => targetId === interaction.user.id)
      .slice(0, 5);

    if (!invitations.length) {
      await interaction.reply({ content: "You do not have any pending Private Chat invitations.", flags: 64 });
      return;
    }

    const rows = invitations.map(([inviterId]) => new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PRIVATE_CHAT_ACCEPT_PREFIX}${inviterId}`)
        .setLabel(`Accept ${inviterId.slice(-4)}`)
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${PRIVATE_CHAT_DECLINE_PREFIX}${inviterId}`)
        .setLabel(`Decline ${inviterId.slice(-4)}`)
        .setStyle(ButtonStyle.Danger),
    ));

    const invitationList = invitations
      .map(([inviterId]) => `• <@${inviterId}>`)
      .join("\n");
    await interaction.reply({
      content: `Your pending Private Chat invitations:\n${invitationList}`,
      components: rows,
      flags: 64,
    });
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith(PRIVATE_CHAT_DECLINE_PREFIX)) {
    const inviterId = interaction.customId.slice(PRIVATE_CHAT_DECLINE_PREFIX.length);
    const guildInvites = privateChatInvites.get(interaction.guild.id) ?? new Map();
    if (guildInvites.get(inviterId) !== interaction.user.id) {
      await interaction.reply({ content: "This invitation is no longer available.", flags: 64 });
      return;
    }

    guildInvites.delete(inviterId);
    if (!guildInvites.size) privateChatInvites.delete(interaction.guild.id);
    await interaction.update({
      content: `Invitation from <@${inviterId}> declined.`,
      components: [],
    });
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith(PRIVATE_CHAT_ACCEPT_PREFIX)) {
    const inviterId = interaction.customId.slice(PRIVATE_CHAT_ACCEPT_PREFIX.length);
    const guildInvites = privateChatInvites.get(interaction.guild.id) ?? new Map();
    if (guildInvites.get(inviterId) !== interaction.user.id) {
      await interaction.reply({ content: "This invitation is no longer available.", flags: 64 });
      return;
    }

    const inviter = await interaction.guild.members.fetch(inviterId).catch(() => null);
    if (!inviter || inviter.user.bot) {
      guildInvites.delete(inviterId);
      await interaction.update({ content: "The user who sent this invitation is no longer available.", components: [] });
      return;
    }

    await interaction.deferUpdate();
    const privateChannel = await createPrivateChatChannel(
      interaction.guild,
      interaction.channel.parentId,
      inviterId,
      interaction.user.id,
    );

    if (!privateChannel) {
      await interaction.editReply({
        content: "I could not open the private chat. Check that the bot has Manage Channels permission.",
        components: [],
      });
      return;
    }

    guildInvites.delete(inviterId);
    if (!guildInvites.size) privateChatInvites.delete(interaction.guild.id);
    await interaction.editReply({
      content: `Invitation accepted. Your private chat: ${privateChannel}`,
      components: [],
    });
    return;
  }

  if (interaction.isUserSelectMenu() && interaction.customId === PRIVATE_CHAT_USER_SELECT_ID) {
    if (!isFeatureEnabled(interaction.guild.id, "editBattles")) {
      await interaction.reply({ content: "Private Chat is disabled on this server.", flags: 64 });
      return;
    }

    const inviterId = interaction.user.id;
    const targetId = interaction.values[0];
    if (targetId === inviterId) {
      await interaction.reply({ content: "Choose another user, not yourself.", flags: 64 });
      return;
    }

    const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
    if (!targetMember || targetMember.user.bot) {
      await interaction.reply({ content: "Choose a real server member.", flags: 64 });
      return;
    }

    const guildInvites = privateChatInvites.get(interaction.guild.id) ?? new Map();
    privateChatInvites.set(interaction.guild.id, guildInvites);
    guildInvites.set(inviterId, targetId);

    await interaction.reply({
      content: `Invitation sent to <@${targetId}>. They can open **My Invitations** in the Private Chat panel to accept or decline it.`,
      flags: 64,
    });
    return;

    const embed = new EmbedBuilder()
      .setColor(0x8b2cff)
      .setTitle("Private Chat Opened")
      .setDescription(`<@${inviterId}> and <@${targetId}>\nOnly you two can see and write in this room.\n\nTo close it automatically, both users need to write \`!סיימתי\`.`)
      .setTimestamp();

    await privateChannel.send({
      content: `<@${inviterId}> <@${targetId}>`,
      embeds: [embed],
    });

    await interaction.reply({
      content: `Private chat opened: ${privateChannel}`,
      flags: 64,
    });
    return;
  }

  const ticketType = interaction.isButton()
    ? getTicketTypeByButton(interaction.customId, interaction.guild.id)
    : (interaction.isStringSelectMenu() && interaction.customId === TICKET_SELECT_MENU_ID
      ? getTicketTypeById(interaction.values[0], interaction.guild.id)
      : null);
  if (ticketType) {
    const config = getGuildConfig(interaction.guild.id);
    const { features, ticketCategoryId, staffRoleIds } = config;
    const validStaffRoleIds = getValidRoleIds(interaction.guild, staffRoleIds);

    if (!features.tickets) {
      await interaction.reply({ content: "סוג הטיקט הזה כבוי כרגע.", flags: 64 });
      return;
    }

    if (!canOpenTicket(interaction.member)) {
      await interaction.reply({
        content: "רק מי שיש לו את הרול המתאים יכול לפתוח טיקט.",
        flags: 64,
      });
      return;
    }

    await interaction.deferReply({ flags: 64 });

    if (!await botCanManageChannels(interaction.guild)) {
      await interaction.editReply("אין לי הרשאת Manage Channels בשרת הזה. צריך להזמין אותי עם Administrator או לתת לי Manage Channels.");
      return;
    }

    const parentCategoryId = await getOrCreateTicketCategory(interaction.guild, ticketCategoryId).catch(async (error) => {
      console.error(error);
      await interaction.editReply("לא הצלחתי להכין קטגוריית Tickets. תבדוק שלבוט יש הרשאת Manage Channels בשרת הזה.");
      return null;
    });

    if (!parentCategoryId) return;

    const ticketNumber = Number(config.ticketCounter || 0) + 1;
    setGuildConfig(interaction.guild.id, { ticketCounter: ticketNumber });
    const ticketTopic = buildTicketTopic(ticketType, interaction.user.id, ticketNumber);

    const permissionOverwrites = [
      { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      {
        id: client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      ...validStaffRoleIds.map((roleId) => ({
        id: roleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      })),
    ];

    const ticketChannel = await createTicketChannel(interaction.guild, {
      name: buildTicketChannelName(config, ticketType, interaction.user, ticketNumber).slice(0, 90),
      type: ChannelType.GuildText,
      parent: parentCategoryId,
      topic: ticketTopic,
      permissionOverwrites,
    }).catch(async (error) => {
      console.error(error);
      await interaction.editReply(`לא הצלחתי לפתוח טיקט גם בלי קטגוריה. קוד שגיאה: ${error.code || "unknown"}. תבדוק שיש לי Administrator או Manage Channels בשרת הזה.`);
      return null;
    });

    if (!ticketChannel) return;

    const embed = new EmbedBuilder()
      .setColor(0xf17100)
      .setTitle(ticketType.embedTitle)
      .setDescription(`${interaction.user}, ${ticketType.intro}`)
      .addFields(
        { name: "סטטוס", value: "ממתין לצוות" },
        { name: "נלקח על ידי", value: "אף אחד עדיין" },
      )
      .setTimestamp();

    await ticketChannel.send({
      content: `${interaction.user}`,
      embeds: [embed],
      components: [buildTicketActionRow()],
    });

    await interaction.editReply(`פתחתי לך טיקט: ${ticketChannel}`);
    return;
  }

  if (interaction.isButton() && interaction.customId === TICKET_CLAIM_BUTTON_ID) {
    if (!isStaff(interaction.member)) {
      await interaction.reply({ content: "רק צוות יכול לקחת טיקט.", flags: 64 });
      return;
    }

    const ticketOwnerId = getTicketOwnerId(interaction.channel);
    if (!ticketOwnerId) {
      await interaction.reply({ content: "לא הצלחתי לזהות מי פתח את הטיקט.", flags: 64 });
      return;
    }

    await interaction.deferUpdate();

    try {
      const { staffRoleIds } = getGuildConfig(interaction.guild.id);
      const validStaffRoleIds = getValidRoleIds(interaction.guild, staffRoleIds);
      await Promise.all([
        ...validStaffRoleIds.map((roleId) => interaction.channel.permissionOverwrites.edit(roleId, {
          ViewChannel: false,
        })),
        interaction.channel.permissionOverwrites.edit(ticketOwnerId, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        }),
        interaction.channel.permissionOverwrites.edit(interaction.user.id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        }),
      ]);
      await interaction.channel.setTopic(`${interaction.channel.topic}:claimed:${interaction.user.id}`);
    } catch (error) {
      console.error(error);
      await interaction.followUp({
        content: "לא הצלחתי לשנות הרשאות לטיקט. תבדוק שיש לי Manage Channels.",
        flags: 64,
      });
      return;
    }

    const oldEmbed = interaction.message.embeds[0];
    const embed = EmbedBuilder.from(oldEmbed ?? new EmbedBuilder())
      .setColor(0x2ecc71)
      .setFields(
        { name: "סטטוס", value: "בטיפול" },
        { name: "נלקח על ידי", value: `${interaction.user}` },
      )
      .setTimestamp();

    await interaction.message.edit({
      embeds: [embed],
      components: [buildTicketActionRow({ claimedBy: interaction.user.username })],
    });

    await interaction.channel.send(`הטיקט נלקח על ידי ${interaction.user}. מעכשיו רק ${interaction.user} ו־<@${ticketOwnerId}> יכולים לראות אותו.`);
    return;
  }

  if (interaction.isButton() && interaction.customId === TICKET_CLOSE_BUTTON_ID) {
    const ticketOwnerId = getTicketOwnerId(interaction.channel);
    const canOwnerClose = ticketOwnerId === interaction.user.id && hasEveryoneFinished(interaction.channel);

    if (!isStaff(interaction.member) && !canOwnerClose) {
      await interaction.reply({
        content: "רק צוות יכול לסגור את הטיקט.",
        flags: 64,
      });
      return;
    }

    await interaction.reply("הטיקט ייסגר בעוד 5 שניות.");
    await sendTicketTranscript(interaction.channel, `${interaction.user.tag || interaction.user.username} (${interaction.user.id})`).catch(console.error);
    setTimeout(() => {
      interaction.channel.delete("Ticket closed").catch(console.error);
    }, 5000);
    return;
  }

  if (interaction.isButton() && interaction.customId === HELP_CLAIM_BUTTON_ID) {
    if (!isStaff(interaction.member)) {
      await interaction.reply({ content: "רק צוות עם הרול המתאים יכול לקחת את הפנייה הזאת.", flags: 64 });
      return;
    }

    const oldEmbed = interaction.message.embeds[0];
    const voiceField = oldEmbed?.fields?.find((field) => field.name === "שיחת קול");
    const requestChannelField = oldEmbed?.fields?.find((field) => field.name === "חדר בקשה");

    const embed = EmbedBuilder.from(oldEmbed ?? new EmbedBuilder())
      .setColor(0x2ecc71)
      .setFields(
        { name: "סטטוס", value: `בטיפול של ${interaction.user}` },
        { name: "שיחת קול", value: voiceField?.value ?? "לא ידוע" },
        { name: "חדר בקשה", value: requestChannelField?.value ?? `${interaction.channel}` },
      )
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(HELP_CLAIM_BUTTON_ID)
        .setLabel(`נלקח על ידי ${interaction.user.username}`)
        .setStyle(ButtonStyle.Success)
        .setDisabled(true),
    );

    await interaction.update({ embeds: [embed], components: [row] });
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith(GIVEAWAY_JOIN_PREFIX)) {
    const giveawayId = interaction.customId.slice(GIVEAWAY_JOIN_PREFIX.length);
    const giveaway = getGiveaway(giveawayId);

    if (!giveaway || giveaway.ended) {
      await interaction.reply({ content: "ההגרלה הזאת כבר לא פעילה.", flags: 64 });
      return;
    }

    if (!isFeatureEnabled(interaction.guild.id, "giveaways")) {
      await interaction.reply({ content: "מערכת ההגרלות כבויה בשרת הזה.", flags: 64 });
      return;
    }

    const alreadyJoined = giveaway.participants?.includes(interaction.user.id);
    const updatedGiveaway = updateGiveaway(giveawayId, (current) => ({
      ...current,
      participants: alreadyJoined
        ? current.participants
        : [...(current.participants || []), interaction.user.id],
    }));

    if (!alreadyJoined && updatedGiveaway) {
      await interaction.message.edit(buildGiveawayMessage(updatedGiveaway)).catch(console.error);
    }

    await interaction.reply({
      content: alreadyJoined ? "אתה כבר משתתף בהגרלה הזאת." : "נכנסת להגרלה. בהצלחה!",
      flags: 64,
    });
    return;
  }

  if (!interaction.isButton() || interaction.customId !== VERIFY_BUTTON_ID) return;

  const { features, verifiedRoleId } = getGuildConfig(interaction.guild.id);
  if (!features.verify) {
    await interaction.reply({ content: "מערכת האימות כבויה בשרת הזה.", flags: 64 });
    return;
  }

  if (!verifiedRoleId) {
    await interaction.reply({ content: "Verification role is not configured yet.", flags: 64 });
    return;
  }

  const role = await interaction.guild.roles.fetch(verifiedRoleId).catch(() => null);
  if (!role) {
    await interaction.reply({ content: "I could not find the configured verification role.", flags: 64 });
    return;
  }

  await interaction.member.roles.add(role).catch(async (error) => {
    console.error(error);
    await interaction.reply({
      content: "I could not add the role. Check my role position and permissions.",
      flags: 64,
    });
  });

  if (!interaction.replied) {
    await interaction.reply({ content: "You are verified. Welcome in!", flags: 64 });
  }
});

client.login(DISCORD_TOKEN).catch((error) => {
  console.error("Bot Discord client login failed:", error);
});
