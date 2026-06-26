const crypto = require("node:crypto");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  EmbedBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder
} = require("discord.js");
const { cleanText, isDiscordId } = require("../utils/validation");

function parseColor(value, fallback = 0x5865f2) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number.parseInt(String(value || "").replace("#", ""), 16);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buttonStyle(style) {
  const map = {
    primary: ButtonStyle.Primary,
    secondary: ButtonStyle.Secondary,
    success: ButtonStyle.Success,
    danger: ButtonStyle.Danger,
    link: ButtonStyle.Link
  };
  return map[String(style || "secondary").toLowerCase()] || ButtonStyle.Secondary;
}

function buildEmbedFromJson(data) {
  const embed = new EmbedBuilder();
  if (data.title) embed.setTitle(cleanText(data.title, 256));
  if (data.url) embed.setURL(String(data.url).slice(0, 512));
  if (data.description) embed.setDescription(cleanText(data.description, 4096));
  if (data.color != null) embed.setColor(parseColor(data.color));
  if (data.timestamp) embed.setTimestamp(data.timestamp === true ? new Date() : new Date(data.timestamp));
  if (data.footer?.text) embed.setFooter({ text: cleanText(data.footer.text, 2048), iconURL: data.footer.iconUrl || undefined });
  if (data.author?.name) embed.setAuthor({ name: cleanText(data.author.name, 256), iconURL: data.author.iconUrl || undefined, url: data.author.url || undefined });
  if (data.thumbnail?.url) embed.setThumbnail(String(data.thumbnail.url).slice(0, 512));
  if (data.image?.url) embed.setImage(String(data.image.url).slice(0, 512));
  if (Array.isArray(data.fields)) {
    embed.addFields(
      data.fields.slice(0, 25).map((field) => ({
        name: cleanText(field.name || "Field", 256),
        value: cleanText(field.value || "—", 1024),
        inline: Boolean(field.inline)
      }))
    );
  }
  return embed;
}

function buildClassicComponents(rows = []) {
  return rows.slice(0, 5).map((row) => {
    const actionRow = new ActionRowBuilder();
    const rowType = row.type || (row.options ? "select" : "buttons");

    if (rowType === "select") {
      const select = new StringSelectMenuBuilder()
        .setCustomId(cleanText(row.customId || "ph:sel:" + crypto.randomUUID().slice(0, 8), 100))
        .setPlaceholder(cleanText(row.placeholder || "Select an option…", 150));
      const options = (row.options || []).slice(0, 25);
      if (!options.length) options.push({ label: "Option 1", value: "opt1" });
      select.addOptions(
        options.map((opt) => ({
          label: cleanText(opt.label || "Option", 100),
          value: cleanText(opt.value || opt.label || "value", 100),
          description: opt.description ? cleanText(opt.description, 100) : undefined,
          emoji: opt.emoji || undefined
        }))
      );
      if (row.minValues != null) select.setMinValues(Math.max(0, Math.min(25, Number(row.minValues) || 0)));
      if (row.maxValues != null) select.setMaxValues(Math.max(1, Math.min(25, Number(row.maxValues) || 1)));
      actionRow.addComponents(select);
      return actionRow;
    }

    for (const btn of (row.buttons || []).slice(0, 5)) {
      const button = new ButtonBuilder().setLabel(cleanText(btn.label || "Button", 80)).setStyle(buttonStyle(btn.style));
      if (btn.style === "link" || btn.url) {
        button.setURL(String(btn.url || btn.link || "https://discord.com").slice(0, 512)).setStyle(ButtonStyle.Link);
      } else {
        button.setCustomId(cleanText(btn.customId || "ph:btn:" + crypto.randomUUID().slice(0, 8), 100));
      }
      if (btn.emoji) button.setEmoji(btn.emoji);
      if (btn.disabled) button.setDisabled(true);
      actionRow.addComponents(button);
    }
    return actionRow;
  });
}

function buildV2Container(body) {
  const container = new ContainerBuilder();
  if (body.accentColor != null) container.setAccentColor(parseColor(body.accentColor));

  for (const block of body.blocks || []) {
    if (block.type === "text") {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(cleanText(block.content || "", 4000)));
      continue;
    }
    if (block.type === "separator") {
      const sep = new SeparatorBuilder().setDivider(block.divider !== false);
      const spacing = String(block.spacing || "small").toLowerCase();
      sep.setSpacing(spacing === "large" ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small);
      container.addSeparatorComponents(sep);
      continue;
    }
    if (block.type === "buttons") {
      const row = new ActionRowBuilder();
      for (const btn of (block.buttons || []).slice(0, 5)) {
        const button = new ButtonBuilder().setLabel(cleanText(btn.label || "Button", 80)).setStyle(buttonStyle(btn.style));
        if (btn.style === "link" || btn.url) {
          button.setURL(String(btn.url || "https://discord.com").slice(0, 512)).setStyle(ButtonStyle.Link);
        } else {
          button.setCustomId(cleanText(btn.customId || "ph:v2:" + crypto.randomUUID().slice(0, 8), 100));
        }
        if (btn.emoji) button.setEmoji(btn.emoji);
        if (btn.disabled) button.setDisabled(true);
        row.addComponents(button);
      }
      if (row.components.length) container.addActionRowComponents(row);
      continue;
    }
    if (block.type === "media") {
      const urls = (block.urls || []).filter(Boolean).slice(0, 10);
      if (urls.length) {
        const gallery = new MediaGalleryBuilder();
        for (const url of urls) gallery.addItems(new MediaGalleryItemBuilder().setURL(String(url).slice(0, 512)));
        container.addMediaGalleryComponents(gallery);
      }
    }
  }

  return container;
}

function buildMessagePayload(body) {
  const messageType = String(body.messageType || "embed").toLowerCase();

  if (messageType === "v2") {
    const container = buildV2Container(body);
    return {
      flags: MessageFlags.IsComponentsV2,
      components: [container],
      allowedMentions: { parse: [] }
    };
  }

  const payload = { allowedMentions: { parse: [] } };
  if (body.content) payload.content = cleanText(body.content, 2000);

  if (Array.isArray(body.embeds) && body.embeds.length) {
    payload.embeds = body.embeds.slice(0, 10).map(buildEmbedFromJson);
  } else if (body.embed) {
    payload.embeds = [buildEmbedFromJson(body.embed)];
  }

  if (Array.isArray(body.components) && body.components.length) {
    payload.components = buildClassicComponents(body.components);
  } else if (Array.isArray(body.componentRows) && body.componentRows.length) {
    payload.components = buildClassicComponents(body.componentRows);
  } else if (Array.isArray(body.buttonRows) && body.buttonRows.length) {
    payload.components = buildClassicComponents(body.buttonRows.map((r) => ({ type: "buttons", ...r })));
  }

  return payload;
}

async function sendGuildMessage(guild, body) {
  const channelId = body.channelId;
  if (!isDiscordId(channelId)) throw new Error("Valid channelId is required.");
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) throw new Error("Target channel must be a text channel.");

  const payload = buildMessagePayload(body);
  if (!payload.content && !payload.embeds?.length && !payload.components?.length) {
    throw new Error("Message must include content, embeds, or components.");
  }

  const message = await channel.send(payload);
  return { messageId: message.id, channelId: channel.id, url: message.url };
}

module.exports = { buildMessagePayload, sendGuildMessage, parseColor };
