const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");

function buildSlashCommands() {
  return [
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
    new SlashCommandBuilder()
      .setName("setup-edit-battle")
      .setDescription("Post the battle room button.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  ].map((command) => command.toJSON());
}

module.exports = {
  buildSlashCommands,
};
