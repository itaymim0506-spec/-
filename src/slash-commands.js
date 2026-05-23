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
    new SlashCommandBuilder()
      .setName("music")
      .setDescription("Music player commands.")
      .addSubcommand((subcommand) => subcommand
        .setName("play")
        .setDescription("Play a song from a URL.")
        .addStringOption((option) => option
          .setName("url")
          .setDescription("YouTube or direct audio URL.")
          .setRequired(true)))
      .addSubcommand((subcommand) => subcommand
        .setName("queue")
        .setDescription("Show the music queue."))
      .addSubcommand((subcommand) => subcommand
        .setName("skip")
        .setDescription("Skip the current song."))
      .addSubcommand((subcommand) => subcommand
        .setName("stop")
        .setDescription("Stop the music and clear the queue."))
      .addSubcommand((subcommand) => subcommand
        .setName("leave")
        .setDescription("Disconnect the bot from voice.")),
  ].map((command) => command.toJSON());
}

module.exports = {
  buildSlashCommands,
};
