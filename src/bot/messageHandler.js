const { EmbedBuilder } = require("discord.js");
const { getCommandSetting } = require("../services/commandSettingsService");
const { getGuildCustomCommands } = require("../services/customCommandsService");
const { getGuildCustomReplies } = require("../services/customRepliesService");
const { getMainSettings } = require("../services/guildSettingsService");
const { cleanText, safeRegex } = require("../utils/validation");

const cooldowns = new Map();

function cooldownKey(guildId, userId, type, id) {
  return guildId + ":" + userId + ":" + type + ":" + id;
}

function isCoolingDown(guildId, userId, type, id, seconds) {
  if (!seconds) return false;
  const key = cooldownKey(guildId, userId, type, id);
  const expires = cooldowns.get(key) || 0;
  if (Date.now() < expires) return true;
  cooldowns.set(key, Date.now() + seconds * 1000);
  return false;
}

function hasRequiredRoles(member, roleIds = []) {
  if (!roleIds.length) return true;
  return roleIds.some((id) => member.roles.cache.has(id));
}

function channelAllowed(message, item) {
  if (Array.isArray(item.ignoredChannelIds) && item.ignoredChannelIds.includes(message.channel.id)) return false;
  if (Array.isArray(item.allowedChannelIds) && item.allowedChannelIds.length && !item.allowedChannelIds.includes(message.channel.id)) return false;
  return true;
}

function matchesReply(content, reply) {
  const messageText = String(content || "");
  const trigger = String(reply.trigger || "");
  if (!trigger) return false;
  if (reply.matchType === "exact") return messageText.toLowerCase() === trigger.toLowerCase();
  if (reply.matchType === "startsWith") return messageText.toLowerCase().startsWith(trigger.toLowerCase());
  if (reply.matchType === "regex") {
    const regex = safeRegex(trigger);
    return regex ? regex.test(messageText) : false;
  }
  return messageText.toLowerCase().includes(trigger.toLowerCase());
}

function buildEmbed(data) {
  const embed = new EmbedBuilder();
  if (data?.title) embed.setTitle(cleanText(data.title, 256));
  if (data?.description) embed.setDescription(cleanText(data.description, 4000));
  if (data?.color) embed.setColor(data.color);
  if (Array.isArray(data?.fields)) embed.addFields(data.fields.slice(0, 10));
  if (data?.footer) embed.setFooter({ text: cleanText(data.footer, 200) });
  return embed;
}

async function runBuiltinPing(message, dashboardSettings) {
  const prefix = typeof dashboardSettings.prefix === "string" ? dashboardSettings.prefix : "!";
  if (!message.content.startsWith(prefix)) return false;
  const [name] = message.content.slice(prefix.length).trim().split(/\s+/);
  if (!name || name.toLowerCase() !== "ping") return false;
  const setting = await getCommandSetting(message.guild.id, "ping");
  if (setting?.enabled === false) return true;
  if (isCoolingDown(message.guild.id, message.author.id, "builtin", "ping", setting?.cooldown || 0)) return true;

  await message.reply({ content: "Pong!", allowedMentions: { parse: [], repliedUser: false } });
  return true;
}

async function runCustomCommand(message, dashboardSettings) {
  if (dashboardSettings?.features?.customCommandsEnabled === false) return false;
  const customCommands = await getGuildCustomCommands(message.guild.id);
  const content = message.content.trim();
  const lower = content.toLowerCase();
  const match = customCommands.find((command) => command.enabled !== false && String(command.trigger || "").trim().toLowerCase() === lower);
  if (!match) return false;
  if (!hasRequiredRoles(message.member, match.roleIds)) return true;
  if (match.channelId && match.channelId !== message.channel.id) return true;
  if (isCoolingDown(message.guild.id, message.author.id, "custom-command", match.id, match.cooldown || 0)) return true;

  if (match.responseType === "Embed" && match.embed) {
    await message.channel.send({ content: cleanText(match.responseText || "", 1800) || undefined, embeds: [buildEmbed(match.embed)], allowedMentions: { parse: [] } });
    return true;
  }

  if (match.responseType === "DM User") {
    await message.author.send({ content: cleanText(match.responseText || "No response configured.", 1800), allowedMentions: { parse: [] } }).catch(() => null);
    return true;
  }

  if (match.responseType === "Send to Channel" && match.channelId) {
    const channel = await message.guild.channels.fetch(match.channelId).catch(() => null);
    if (channel?.isTextBased()) await channel.send({ content: cleanText(match.responseText || "", 1800), allowedMentions: { parse: [] } });
    return true;
  }

  await message.channel.send({ content: cleanText(match.responseText || "No response configured.", 1800), allowedMentions: { parse: [] } });
  return true;
}

async function runCustomReply(message, dashboardSettings) {
  if (dashboardSettings?.features?.customRepliesEnabled === false) return false;
  const customReplies = await getGuildCustomReplies(message.guild.id);
  const match = customReplies.find((reply) => reply.enabled !== false && channelAllowed(message, reply) && hasRequiredRoles(message.member, reply.requiredRoleIds) && matchesReply(message.content, reply));
  if (!match) return false;

  await message.reply({
    content: cleanText(match.responseText || "", 1800) || undefined,
    embeds: match.embedEnabled && match.embed ? [buildEmbed(match.embed)] : undefined,
    allowedMentions: { parse: [], repliedUser: false }
  });
  return true;
}

function registerMessageHandler(client) {
  if (client.__nexoraMessageHandlerRegistered) return;
  client.__nexoraMessageHandlerRegistered = true;
  client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild) return;
    try {
      const dashboardSettings = await getMainSettings(message.guild.id);
      if (await runBuiltinPing(message, dashboardSettings)) return;
      if (await runCustomCommand(message, dashboardSettings)) return;
      await runCustomReply(message, dashboardSettings);
    } catch (error) {
      console.error("message handler error:", error.message);
    }
  });
}

module.exports = { registerMessageHandler };
