const { getSectionList } = require("../services/guildSettingsService");
const ticketPanelCommand = require("../commands/ticket-panel");
const { handleTicketInteraction } = require("../events/tickets");

async function handleReactionRole(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith("rr:")) return false;
  const roleId = interaction.customId.split(":")[1];
  const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
  if (!role) {
    await interaction.reply({ content: "That role no longer exists.", flags: 64 });
    return true;
  }

  const member = interaction.member;
  const hasRole = member.roles.cache.has(role.id);
  if (hasRole) {
    await member.roles.remove(role, "Dashboard reaction role toggle").catch(() => null);
    await interaction.reply({ content: "Removed " + role.name + ".", flags: 64 });
  } else {
    await member.roles.add(role, "Dashboard reaction role toggle").catch(() => null);
    await interaction.reply({ content: "Added " + role.name + ".", flags: 64 });
  }
  return true;
}

async function handleTicket(interaction) {
  if (!interaction.isButton() || interaction.customId !== "ticket:open") return false;
  const panels = await getSectionList(interaction.guild.id, "tickets", "panels");
  const panel = panels.find((item) => item.messageId === interaction.message.id) || {};
  await interaction.reply({
    content: "Ticket request received. Staff will review it soon.",
    flags: 64
  });

  const logChannelId = panel.logChannelId || panel.settings?.logChannelId;
  if (logChannelId) {
    const logChannel = await interaction.guild.channels.fetch(logChannelId).catch(() => null);
    if (logChannel?.isTextBased()) {
      await logChannel.send({
        content: "New ticket request from <@" + interaction.user.id + "> in <#" + interaction.channel.id + ">.",
        allowedMentions: { users: [interaction.user.id], roles: [], parse: [] }
      }).catch(() => null);
    }
  }
  return true;
}

async function registerTicketPanelCommand(client) {
  const payload = ticketPanelCommand.data.toJSON();
  const guilds = [...client.guilds.cache.values()];
  if (!guilds.length && client.application) {
    const existing = await client.application.commands.fetch().catch(() => null);
    const current = existing?.find((command) => command.name === payload.name);
    if (current) {
      await client.application.commands.edit(current.id, payload).catch((error) => console.error("ticket panel command update failed:", error.message));
    } else {
      await client.application.commands.create(payload).catch((error) => console.error("ticket panel command create failed:", error.message));
    }
    return;
  }

  for (const guild of guilds) {
    const existing = await guild.commands.fetch().catch(() => null);
    const current = existing?.find((command) => command.name === payload.name);
    if (current) {
      await guild.commands.edit(current.id, payload).catch((error) => console.error("ticket panel guild command update failed:", guild.id, error.message));
    } else {
      await guild.commands.create(payload).catch((error) => console.error("ticket panel guild command create failed:", guild.id, error.message));
    }
  }
}

function registerInteractionHandler(client) {
  if (client.__nexoraInteractionHandlerRegistered) return;
  client.__nexoraInteractionHandlerRegistered = true;

  client.once("clientReady", () => {
    registerTicketPanelCommand(client).then(() => console.log("Registered /order-panel command.")).catch((error) => console.error("ticket panel registration failed:", error.message));
  });

  client.on("interactionCreate", async (interaction) => {
    try {
      if (interaction.isChatInputCommand() && interaction.commandName === "order-panel") {
        await ticketPanelCommand.execute(interaction);
        return;
      }
      if (await handleTicketInteraction(interaction)) return;
      if (await handleReactionRole(interaction)) return;
      if (await handleTicket(interaction)) return;
    } catch (error) {
      console.error("interaction handler error:", error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "That interaction could not be handled.", flags: 64 }).catch(() => null);
      } else if (interaction.deferred && !interaction.replied) {
        await interaction.editReply({ content: "That interaction could not be handled." }).catch(() => null);
      }
    }
  });
}

module.exports = { registerInteractionHandler };
