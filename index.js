require("dotenv").config();

const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

const {
  DISCORD_TOKEN,
  CLIENT_ID,
  GUILD_ID,
  DEPLOY_SCOPE = "global",
} = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error("Missing DISCORD_TOKEN or CLIENT_ID in .env");
  process.exit(1);
}

if (DEPLOY_SCOPE === "guild" && !GUILD_ID) {
  console.error("GUILD_ID is required when DEPLOY_SCOPE=guild");
  process.exit(1);
}

if (!["global", "guild"].includes(DEPLOY_SCOPE)) {
  console.error("DEPLOY_SCOPE must be either global or guild");
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName("setup-verify")
    .setDescription("Post the verification button in this channel.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Ask staff for help in your current voice channel."),
  new SlashCommandBuilder()
    .setName("setup-ticket")
    .setDescription("Post the player report ticket button.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
].map((command) => command.toJSON());

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

(async () => {
  try {
    const route = DEPLOY_SCOPE === "guild"
      ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
      : Routes.applicationCommands(CLIENT_ID);

    await rest.put(route, { body: commands });
    console.log(`Slash commands deployed ${DEPLOY_SCOPE === "guild" ? "to the test server" : "globally"}.`);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
