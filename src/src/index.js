require("dotenv").config();

const fs = require("fs");
const path = require("path");

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
} = require("discord.js");

const DISCORD_TOKEN = String(process.env.DISCORD_TOKEN || "")
  .trim()
  .replace(/^Bot\s+/i, "");
const { CLIENT_ID } = process.env;

const { getGuildConfig, setGuildConfig } = require("./config-store");
const { buildSlashCommands } = require("./slash-commands");

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
const REPORT_TICKET_OPEN_BUTTON_ID = "open_player_report_ticket";
const TECH_TICKET_OPEN_BUTTON_ID = "open_technical_help_ticket";
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
const EDIT_BATTLE_IMAGE_PATH = path.join(
  process.env.USERPROFILE || "C:\\Users\\איתי",
  "Downloads",
  "ChatGPT Image May 13, 2026, 09_18_40 PM.png",
);
const EDIT_BATTLE_IMAGE_NAME = "edit-battle.png";
const VERIFY_IMAGE_URL = "https://cdn.discordapp.com/attachments/1484641087355359344/1501598281829060689/2f1a380c-89e9-46a0-9bd8-2657e4e631a3.png?ex=69fca7e0&is=69fb5660&hm=35ebdc5326ea02c23655ea26ae2819dc5c20aaea1dda0cdf704b96e140bc3e7e&";

const TICKET_TYPES = {
  report: {
    buttonId: REPORT_TICKET_OPEN_BUTTON_ID,
    buttonLabel: "טיקט לדיווח על שחקן",
    channelPrefix: "report",
    embedTitle: "טיקט לדיווח על שחקן",
    panelDescription: "דיווח על שחקן שעבר על החוקים.",
    intro: "תכתוב כאן את הדיווח שלך. צוות יענה לך בהקדם.",
  },
  tech: {
    buttonId: TECH_TICKET_OPEN_BUTTON_ID,
    buttonLabel: "עזרה טכנית",
    channelPrefix: "tech",
    embedTitle: "טיקט עזרה טכנית",
    panelDescription: "בעיה טכנית, באג, או עזרה בהתחברות.",
    intro: "תכתוב כאן מה הבעיה הטכנית שלך. צוות יענה לך בהקדם.",
  },
};

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

const editBattleQueue = [];
const finishVotesByChannel = new Map();
const closingChannels = new Set();

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
  const { features } = getGuildConfig(guildId);
  return features?.[featureName] !== false;
}

function isTicketTypeEnabled(features, ticketType) {
  if (ticketType === TICKET_TYPES.report) return features.reportTickets !== false;
  if (ticketType === TICKET_TYPES.tech) return features.techTickets !== false;
  return true;
}

function getValidCategoryId(guild, categoryId) {
  const category = categoryId ? guild.channels.cache.get(categoryId) : null;
  return category?.type === ChannelType.GuildCategory ? category.id : null;
}

function getValidRoleIds(guild, roleIds) {
  return roleIds.filter((roleId) => guild.roles.cache.has(roleId));
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

function getTicketOwnerId(channel) {
  return channel.topic?.match(/^ticket:[a-z-]+:(\d+)/)?.[1]
    ?? channel.topic?.match(/^player-report-ticket:(\d+)/)?.[1]
    ?? null;
}

function getTicketClaimedUserId(channel) {
  return channel.topic?.match(/^ticket:[a-z-]+:\d+:claimed:(\d+)/)?.[1] ?? null;
}

function getEditBattleUserIds(channel) {
  const match = channel.topic?.match(/^edit-battle:(\d+):(\d+)/);
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

async function scheduleChannelClose(channel, reason) {
  if (closingChannels.has(channel.id)) return;
  closingChannels.add(channel.id);

  await channel.send(reason).catch(console.error);
  setTimeout(() => {
    finishVotesByChannel.delete(channel.id);
    closingChannels.delete(channel.id);
    channel.delete("Both users finished").catch(console.error);
  }, 5000);
}

function getTicketTypeByButton(buttonId) {
  return Object.values(TICKET_TYPES).find((ticketType) => ticketType.buttonId === buttonId);
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

function buildTicketPanel() {
  const embed = new EmbedBuilder()
    .setColor(0x8b2cff)
    .setTitle("פתיחת טיקטים")
    .setDescription("בחר את סוג הטיקט שאתה רוצה לפתוח.")
    .addFields(
      { name: TICKET_TYPES.report.buttonLabel, value: TICKET_TYPES.report.panelDescription },
      { name: TICKET_TYPES.tech.buttonLabel, value: TICKET_TYPES.tech.panelDescription },
    );

  const files = [];
  if (fs.existsSync(TICKET_PANEL_IMAGE_PATH)) {
    embed.setImage(`attachment://${TICKET_PANEL_IMAGE_NAME}`);
    files.push({ attachment: TICKET_PANEL_IMAGE_PATH, name: TICKET_PANEL_IMAGE_NAME });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(TICKET_TYPES.report.buttonId)
      .setLabel(TICKET_TYPES.report.buttonLabel)
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(TICKET_TYPES.tech.buttonId)
      .setLabel(TICKET_TYPES.tech.buttonLabel)
      .setStyle(ButtonStyle.Primary),
  );

  return { embeds: [embed], components: [row], files };
}

function buildVerifyPanel() {
  return {
    flags: 32768,
    components: [
      {
        type: 17,
        components: [
          { type: 10, content: "כדי להיות מאומתים לחצו על הכפתור" },
          { type: 12, items: [{ media: { url: VERIFY_IMAGE_URL } }] },
          {
            type: 1,
            components: [
              {
                type: 2,
                custom_id: VERIFY_BUTTON_ID,
                label: "Verify",
                style: 3,
              },
            ],
          },
        ],
        accent_color: 15823360,
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

function buildEditBattlePanel() {
  const embed = new EmbedBuilder()
    .setColor(0x8b2cff)
    .setTitle("קרב אדיטים")
    .setDescription("לחץ על הכפתור כדי להצטרף לקרב. כשיהיו לפחות שני משתתפים, הבוט ישדך שניים רנדומלית ויפתח להם חדר פרטי.");

  const files = [];
  if (fs.existsSync(EDIT_BATTLE_IMAGE_PATH)) {
    embed.setImage(`attachment://${EDIT_BATTLE_IMAGE_NAME}`);
    files.push({ attachment: EDIT_BATTLE_IMAGE_PATH, name: EDIT_BATTLE_IMAGE_NAME });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(EDIT_BATTLE_JOIN_BUTTON_ID)
      .setLabel("הזמנת קרב אדיטים")
      .setStyle(ButtonStyle.Primary),
  );

  return { embeds: [embed], components: [row], files };
}

async function sendFreshPanels(guild, channel) {
  const { features, editBattlePanelChannelId } = getGuildConfig(guild.id);
  const sentPanels = [];

  if (features.verify) {
    await channel.send(buildVerifyPanel());
    sentPanels.push("Verify");
  }

  if (features.tickets) {
    await channel.send(buildTicketPanel());
    sentPanels.push("Tickets");
  }

  if (features.editBattles) {
    const editBattleChannel = await guild.channels.fetch(editBattlePanelChannelId).catch(() => null);
    const targetChannel = editBattleChannel?.isTextBased() ? editBattleChannel : channel;
    await targetChannel.send(buildEditBattlePanel());
    sentPanels.push("Edit battles");
  }

  return sentPanels;
}

async function syncSlashCommands() {
  if (!CLIENT_ID || !DISCORD_TOKEN) return;

  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: buildSlashCommands() });
  console.log("Slash commands synced.");
}

function pickRandomQueuedUserId() {
  const index = Math.floor(Math.random() * editBattleQueue.length);
  return editBattleQueue.splice(index, 1)[0];
}

function buildTicketTopic(ticketType, userId) {
  return `ticket:${ticketType.channelPrefix}:${userId}`;
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  syncSlashCommands().catch((error) => {
    console.error("Slash command sync failed:", error);
  });
});

client.on(Events.GuildMemberAdd, async (member) => {
  const { features, welcomeChannelId } = getGuildConfig(member.guild.id);
  if (!features.welcome || !welcomeChannelId) return;

  const channel = await member.guild.channels.fetch(welcomeChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("Welcome!")
    .setDescription(`Hey ${member}, welcome to **${member.guild.name}**.`)
    .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(console.error);
});

client.on(Events.MessageCreate, async (message) => {
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

    await interaction.channel.send(buildTicketPanel());
    await interaction.reply({ content: "Ticket panel posted.", flags: 64 });
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

    await interaction.channel.send(buildVerifyPanel());

    await interaction.reply({ content: "Verification panel posted.", flags: 64 });
    return;
  }

  if (interaction.isButton() && interaction.customId === EDIT_BATTLE_JOIN_BUTTON_ID) {
    if (!isFeatureEnabled(interaction.guild.id, "editBattles")) {
      await interaction.reply({ content: "קרב אדיטים כבוי בשרת הזה.", flags: 64 });
      return;
    }

    if (editBattleQueue.includes(interaction.user.id)) {
      await interaction.reply({ content: "אתה כבר בתור לקרב אדיטים.", flags: 64 });
      return;
    }

    editBattleQueue.push(interaction.user.id);

    if (editBattleQueue.length < 2) {
      await interaction.reply({ content: "נכנסת לתור. מחכים לעוד משתתף.", flags: 64 });
      return;
    }

    const firstUserId = pickRandomQueuedUserId();
    const secondUserId = pickRandomQueuedUserId();

    const permissionOverwrites = [
      { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
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

    const battleChannel = await interaction.guild.channels.create({
      name: `edit-battle-${firstUserId.slice(-4)}-${secondUserId.slice(-4)}`,
      type: ChannelType.GuildText,
      parent: interaction.channel.parentId,
      topic: `edit-battle:${firstUserId}:${secondUserId}`,
      permissionOverwrites,
    }).catch(async (error) => {
      console.error(error);
      editBattleQueue.push(firstUserId, secondUserId);
      await interaction.reply({
        content: "לא הצלחתי לפתוח חדר לקרב. תבדוק שיש לי Manage Channels.",
        flags: 64,
      });
      return null;
    });

    if (!battleChannel) return;

    const embed = new EmbedBuilder()
      .setColor(0x8b2cff)
      .setTitle("קרב אדיטים נפתח")
      .setDescription(`<@${firstUserId}> נגד <@${secondUserId}>\nרק שניכם יכולים לראות ולכתוב בחדר הזה.\n\nכדי לסגור את הטיקט אוטומטית, גם אתה וגם איש הצוות שלקח את הטיקט צריכים לכתוב \`!סיימתי\`.`)
      .setTimestamp();

    await battleChannel.send({
      content: `<@${firstUserId}> <@${secondUserId}>`,
      embeds: [embed],
    });

    await interaction.reply({
      content: `נבחר קרב רנדומלי ונפתח חדר: ${battleChannel}`,
      flags: 64,
    });
    return;
  }

  const ticketType = interaction.isButton() ? getTicketTypeByButton(interaction.customId) : null;
  if (ticketType) {
    const { features, ticketCategoryId, staffRoleIds } = getGuildConfig(interaction.guild.id);
    const validStaffRoleIds = getValidRoleIds(interaction.guild, staffRoleIds);

    if (!features.tickets || !isTicketTypeEnabled(features, ticketType)) {
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

    const ticketTopic = buildTicketTopic(ticketType, interaction.user.id);
    const existingTicket = interaction.guild.channels.cache.find((channel) => (
      channel.guild.id === interaction.guild.id && channel.topic === ticketTopic
    ));

    if (existingTicket) {
      await interaction.reply({ content: `כבר יש לך טיקט פתוח: ${existingTicket}`, flags: 64 });
      return;
    }

    await interaction.deferReply({ flags: 64 });

    const parentCategoryId = await getOrCreateTicketCategory(interaction.guild, ticketCategoryId).catch(async (error) => {
      console.error(error);
      await interaction.editReply("לא הצלחתי להכין קטגוריית Tickets. תבדוק שלבוט יש הרשאת Manage Channels בשרת הזה.");
      return null;
    });

    if (!parentCategoryId) return;

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

    const ticketChannel = await interaction.guild.channels.create({
      name: `${ticketType.channelPrefix}-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 90),
      type: ChannelType.GuildText,
      parent: parentCategoryId,
      topic: ticketTopic,
      permissionOverwrites,
    }).catch(async (error) => {
      console.error(error);
      await interaction.editReply("לא הצלחתי לפתוח טיקט. תבדוק שיש לי הרשאת Manage Channels בשרת הזה.");
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
