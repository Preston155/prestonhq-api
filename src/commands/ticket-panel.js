const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const { sendOrderPanel, isStaff, CONFIG } = require("../systems/ticket-manager");

const data = new SlashCommandBuilder()
  .setName("order-panel")
  .setDescription("Send the premium Vexel Studios order ticket panel.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

async function execute(interaction) {
  if (!interaction.guild || !interaction.channel?.isTextBased()) {
    await interaction.reply({ content: "Run this inside a server text channel.", flags: 64 });
    return;
  }
  if (!isStaff(interaction.member)) {
    await interaction.reply({ content: "Only staff can send the order panel.", flags: 64 });
    return;
  }
  await sendOrderPanel(interaction.channel);
  const warnings = [];
  if (!CONFIG.STAFF_ROLE_ID) warnings.push("STAFF_ROLE_ID is not configured, so only Manage Channels/Admin users count as staff.");
  if (!CONFIG.ORDER_LOG_CHANNEL_ID) warnings.push("ORDER_LOG_CHANNEL_ID is not configured, so order logs will not send.");
  if (!CONFIG.TRANSCRIPT_LOG_CHANNEL_ID) warnings.push("TRANSCRIPT_LOG_CHANNEL_ID is not configured, so transcripts will use the order log channel if available.");
  await interaction.reply({
    content: "Order panel sent." + (warnings.length ? "\n\n" + warnings.map((w) => "⚠️ " + w).join("\n") : ""),
    flags: 64
  });
}

module.exports = { data, execute };
