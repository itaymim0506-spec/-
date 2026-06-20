require("dotenv").config();

const { REST, Routes } = require("discord.js");
const { buildSlashCommands } = require("./slash-commands");

const DISCORD_TOKEN = String(process.env.DISCORD_TOKEN || "")
  .trim()
  .replace(/^Bot\s+/i, "");
const { CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error("Missing DISCORD_TOKEN or CLIENT_ID in .env");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

(async () => {
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: buildSlashCommands() });

    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: [] });
    }

    console.log("Global slash commands deployed.");
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
