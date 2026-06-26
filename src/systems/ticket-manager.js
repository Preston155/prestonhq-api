const fs = require("node:fs/promises");
const path = require("node:path");
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder
} = require("discord.js");
const { readJson, writeJson } = require("../utils/jsonStore");

const CONFIG = {
  STAFF_ROLE_ID: process.env.STAFF_ROLE_ID || process.env.ORDER_STAFF_ROLE_ID || "",
  ORDER_CATEGORY_ID: process.env.ORDER_CATEGORY_ID || "",
  ORDER_LOG_CHANNEL_ID: process.env.ORDER_LOG_CHANNEL_ID || process.env.TICKET_LOG_CHANNEL_ID || "",
  TRANSCRIPT_LOG_CHANNEL_ID: process.env.TRANSCRIPT_LOG_CHANNEL_ID || process.env.ORDER_TRANSCRIPT_LOG_CHANNEL_ID || "",
  REVIEW_LOG_CHANNEL_ID: process.env.REVIEW_LOG_CHANNEL_ID || "1511559487087968382"
};

const STORE_PATH = path.join(__dirname, "..", "data", "tickets.json");
const PANEL_IMAGE_PATH = path.join(__dirname, "..", "assets", "panel-art.png");
const PANEL_IMAGE_NAME = "panel-art.png";
const TRANSCRIPT_DIR = path.join(__dirname, "..", "data", "transcripts");
const TRANSCRIPT_PUBLIC_BASE_URL = process.env.TRANSCRIPT_PUBLIC_BASE_URL || process.env.PUBLIC_TRANSCRIPT_BASE_URL || "https://prestonhq.com/transcripts";

const SERVICES = {
  "discord-design": { label: "Discord Server Design", emoji: "🎨", description: "Server layout, channels, roles, permissions, and polish." },
  "discord-bot": { label: "Discord Bot", emoji: "🤖", description: "Custom commands, automations, dashboards, and systems." },
  website: { label: "Website", emoji: "🌐", description: "Landing pages, dashboards, portals, and web apps." },
  erlc: { label: "ERLC / Roblox Server Setup", emoji: "🚓", description: "Roleplay server setup, channels, staffing, and ERLC systems." },
  custom: { label: "Custom Service / Other", emoji: "🧾", description: "Anything custom that does not fit the other categories." }
};

const STATUS_META = {
  Open: { emoji: "🟢", tone: 0x2dd4bf },
  Pending: { emoji: "📌", tone: 0xfacc15 },
  Paid: { emoji: "💳", tone: 0x60a5fa },
  "In Progress": { emoji: "📦", tone: 0xa78bfa },
  Completed: { emoji: "✅", tone: 0x22c55e },
  Closed: { emoji: "🔒", tone: 0x64748b }
};

function nowIso() {
  return new Date().toISOString();
}

function shortId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
}

function cleanChannelName(username) {
  const base = String(username || "user").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return "order-" + (base || "user").slice(0, 65);
}

function ticketChannelName(ticket, fallbackUsername) {
  const base = cleanChannelName(ticket?.username || fallbackUsername || "user");
  if (ticket?.status === "Closed") return "🔴・" + base;
  if (ticket?.status === "Paid") return "🔵・" + base;
  if (ticket?.status === "Completed") return "✅・" + base;
  if (ticket?.claimedBy) return "🟢・" + base;
  return "🟡・" + base;
}

async function syncTicketChannelName(guild, ticket) {
  const channel = await guild.channels.fetch(ticket.channelId).catch(() => null);
  if (!channel || !channel.manageable) return;
  const nextName = ticketChannelName(ticket);
  if (channel.name !== nextName) {
    await channel.setName(nextName, "Order ticket status indicator update").catch(() => null);
  }
}

async function readStore() {
  const store = await readJson(STORE_PATH, { tickets: {} });
  if (!store || typeof store !== "object") return { tickets: {} };
  if (!store.tickets || typeof store.tickets !== "object") store.tickets = {};
  return store;
}

async function writeStore(store) {
  await writeJson(STORE_PATH, store);
}

async function listTickets() {
  const store = await readStore();
  return Object.values(store.tickets);
}

async function getTicket(channelId) {
  const store = await readStore();
  return store.tickets[channelId] || null;
}
async function recoverTicketFromChannel(interaction) {
  const channel = interaction.channel;
  if (!interaction.guild || !channel?.isTextBased?.()) return null;

  const normalizedName = String(channel.name || "").toLowerCase();
  const looksLikeTicket = normalizedName.includes("order-") || normalizedName.includes("ticket");
  const hasOrderButton = interaction.isButton?.() && String(interaction.customId || "").startsWith("order:");
  if (!looksLikeTicket && !hasOrderButton) return null;

  const overwrites = [...(channel.permissionOverwrites?.cache?.values?.() || [])];
  const userOverwrite = overwrites.find((overwrite) =>
    overwrite.type === 1 &&
    overwrite.id !== interaction.client.user.id &&
    overwrite.id !== interaction.guild.ownerId
  );
  const userId = userOverwrite?.id || interaction.user.id;

  let panelMessageId = interaction.message?.id || null;
  if (!panelMessageId) {
    const recent = await channel.messages.fetch({ limit: 25 }).catch(() => null);
    const panel = recent?.find((message) =>
      message.author?.id === interaction.client.user.id &&
      message.components?.some((component) => JSON.stringify(component.toJSON ? component.toJSON() : component).includes("order:"))
    );
    panelMessageId = panel?.id || null;
  }

  let service = "custom";
  const topic = String(channel.topic || "");
  for (const [key, value] of Object.entries(SERVICES)) {
    if (topic.toLowerCase().includes(value.label.toLowerCase())) {
      service = key;
      break;
    }
  }

  const status =
    normalizedName.startsWith("🔴") ? "Closed" :
    normalizedName.startsWith("🔵") ? "Paid" :
    normalizedName.includes("completed") ? "Completed" :
    "Open";

  const recovered = await saveTicket({
    guildId: interaction.guild.id,
    channelId: channel.id,
    userId,
    username: interaction.user.tag,
    service,
    status,
    claimedBy: null,
    createdAt: channel.createdAt ? channel.createdAt.toISOString() : nowIso(),
    panelMessageId,
    recoveredAt: nowIso()
  });

  console.log("Recovered order ticket from channel:", channel.id, "user:", userId, "status:", status);
  return recovered;
}


async function saveTicket(ticket) {
  const store = await readStore();
  store.tickets[ticket.channelId] = { ...ticket, updatedAt: nowIso() };
  await writeStore(store);
  return store.tickets[ticket.channelId];
}

async function removeTicket(channelId) {
  const store = await readStore();
  delete store.tickets[channelId];
  await writeStore(store);
}

async function findOpenTicket(guild, userId) {
  const tickets = await listTickets();
  for (const ticket of tickets) {
    if (ticket.guildId !== guild.id || ticket.userId !== userId || ticket.status === "Closed") continue;
    const channel = await guild.channels.fetch(ticket.channelId).catch(() => null);
    if (channel) return ticket;
    await removeTicket(ticket.channelId);
  }
  return null;
}

function isStaff(member) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.Administrator) || member.permissions?.has(PermissionFlagsBits.ManageChannels)) return true;
  return Boolean(CONFIG.STAFF_ROLE_ID && member.roles?.cache?.has(CONFIG.STAFF_ROLE_ID));
}

function serviceText(serviceKey) {
  const service = SERVICES[serviceKey] || SERVICES.custom;
  return service.emoji + " " + service.label;
}

function divider(spacing = SeparatorSpacingSize.Small) {
  return new SeparatorBuilder().setDivider(true).setSpacing(spacing);
}

function buildOrderPanelContainer() {
  const select = new StringSelectMenuBuilder()
    .setCustomId("order:select")
    .setPlaceholder("Choose what you want to order")
    .addOptions(Object.entries(SERVICES).map(([value, service]) => ({
      label: service.label,
      value,
      description: service.description.slice(0, 100),
      emoji: service.emoji
    })));

  const container = new ContainerBuilder()
    .setAccentColor(0xff2fab)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## 🛒 Place an Order\nWelcome to the official ordering system. Select what you want to order below and our team will help you inside a private ticket."
      )
    )
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "**Available Services**\n🎨 Discord Server Design\n🤖 Discord Bot\n🌐 Website\n🚓 ERLC / Roblox Server Setup\n🧾 Custom Service / Other\n\n> Choose a service below. A private order ticket will be created for you and our team will handle the rest."
      )
    );

  if (require("node:fs").existsSync(PANEL_IMAGE_PATH)) {
    container
      .addSeparatorComponents(divider())
      .addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder().setURL("attachment://" + PANEL_IMAGE_NAME)
        )
      );
  }

  return container
    .addSeparatorComponents(divider())
    .addActionRowComponents(new ActionRowBuilder().addComponents(select))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("**Vexel Studios Orders** • Private tickets • Clean support • Fast staff handling")
    );
}

function buildTicketContainer(ticket) {
  const status = STATUS_META[ticket.status] || STATUS_META.Open;
  const claimedBy = ticket.claimedBy ? "<@" + ticket.claimedBy + ">" : "Nobody";
  const createdUnix = Math.floor(new Date(ticket.createdAt).getTime() / 1000);
  return new ContainerBuilder()
    .setAccentColor(status.tone)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## " + status.emoji + " Order Ticket\n" +
        "**Service:** " + serviceText(ticket.service) + "\n" +
        "**Customer:** <@" + ticket.userId + ">\n" +
        "**Status:** " + ticket.status + "\n" +
        "**Claimed by:** " + claimedBy + "\n" +
        "**Created:** <t:" + createdUnix + ":F>"
      )
    )
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "**What we need from you**\n" +
        "1. What you want ordered\n" +
        "2. Budget\n" +
        "3. Deadline\n" +
        "4. Extra details\n" +
        "5. References/images if needed\n\n" +
        "> Staff can claim this ticket, update the status, and close it once the order is complete."
      )
    )
    .addSeparatorComponents(divider())
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("order:claim").setLabel("Claim Ticket").setEmoji("✅").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("order:unclaim").setLabel("Unclaim Ticket").setEmoji("🔓").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("order:status:Pending").setLabel("Pending").setEmoji("📌").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("order:status:Paid").setLabel("Paid").setEmoji("💳").setStyle(ButtonStyle.Primary)
    ))
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("order:status:In Progress").setLabel("In Progress").setEmoji("📦").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("order:status:Completed").setLabel("Completed").setEmoji("✅").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("order:close").setLabel("Close Ticket").setEmoji("🔒").setStyle(ButtonStyle.Danger)
    ));
}

function buildCloseConfirmContainer(ticket) {
  return new ContainerBuilder()
    .setAccentColor(0xef4444)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      "## 🔒 Close Order Ticket?\nAre you sure you want to close this order ticket for <@" + ticket.userId + ">?\n\nA transcript and close summary will be sent to the configured log channels."
    ))
    .addSeparatorComponents(divider())
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("order:close-confirm").setLabel("Confirm Close").setEmoji("✅").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("order:close-cancel").setLabel("Cancel").setEmoji("❌").setStyle(ButtonStyle.Secondary)
    ));
}

function buildReviewContainer(ticket) {
  const buttons = [1, 2, 3, 4, 5].map((rating) =>
    new ButtonBuilder()
      .setCustomId("order:review:" + rating + ":" + ticket.guildId + ":" + ticket.channelId + ":" + ticket.userId)
      .setLabel(String(rating))
      .setEmoji("⭐")
      .setStyle(rating >= 4 ? ButtonStyle.Success : rating === 3 ? ButtonStyle.Secondary : ButtonStyle.Danger)
  );

  return new ContainerBuilder()
    .setAccentColor(0xffc857)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      "## ⭐ Order Review\nThanks for ordering from **Vexel Studios**. How was your ticket experience?\n\n**Service:** " + serviceText(ticket.service) + "\n**Ticket:** " + ticket.channelId
    ))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent("Pick a rating below. Your review will be sent privately to staff."))
    .addActionRowComponents(new ActionRowBuilder().addComponents(buttons));
}

async function sendReviewRequest(client, ticket) {
  if (!ticket?.userId) return;
  const user = await client.users.fetch(ticket.userId).catch(() => null);
  if (!user) return;
  await user.send(componentPayload(buildReviewContainer(ticket), { allowedUserIds: [] })).catch((error) => {
    console.error("Ticket review DM failed:", error.message);
  });
}

async function logTicketReview(client, review) {
  const channel = await client.channels.fetch(CONFIG.REVIEW_LOG_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) return;
  const stars = "⭐".repeat(review.rating) + "☆".repeat(5 - review.rating);
  const container = new ContainerBuilder()
    .setAccentColor(review.rating >= 4 ? 0x22c55e : review.rating === 3 ? 0xfacc15 : 0xef4444)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      "## ⭐ Ticket Review Received\n" +
      "**Rating:** " + stars + " (" + review.rating + "/5)\n" +
      "**Customer:** <@" + review.userId + ">\n" +
      "**Ticket ID:** " + review.ticketId + "\n" +
      "**Submitted:** <t:" + Math.floor(Date.now() / 1000) + ":F>"
    ))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent("Vexel Studios • Ticket Reviews"));

  await channel.send(componentPayload(container, { allowedUserIds: [] })).catch((error) => {
    console.error("Ticket review log failed:", error.message);
  });
}

async function saveReview(review) {
  const store = await readStore();
  if (!store.reviews || typeof store.reviews !== "object") store.reviews = {};
  const key = review.ticketId + ":" + review.userId;
  if (store.reviews[key]) return { duplicate: true, review: store.reviews[key] };
  store.reviews[key] = { ...review, submittedAt: nowIso() };
  await writeStore(store);
  return { duplicate: false, review: store.reviews[key] };
}

async function handleReviewInteraction(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith("order:review:")) return false;
  const [, , ratingRaw, guildId, ticketId, userId] = interaction.customId.split(":");
  const rating = Number.parseInt(ratingRaw, 10);

  if (interaction.user.id !== userId) {
    await interaction.reply({ content: "Only the ticket customer can submit this review.", flags: 64 });
    return true;
  }

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    await interaction.reply({ content: "That review rating is invalid.", flags: 64 });
    return true;
  }

  await interaction.deferUpdate().catch(() => null);
  const saved = await saveReview({ guildId, ticketId, userId, rating });
  if (!saved.duplicate) {
    await logTicketReview(interaction.client, saved.review);
  }

  const stars = "⭐".repeat(saved.review.rating) + "☆".repeat(5 - saved.review.rating);
  const container = new ContainerBuilder()
    .setAccentColor(0x22c55e)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      "## ✅ Review Submitted\nThanks for the feedback!\n\n**Your Rating:** " + stars + " (" + saved.review.rating + "/5)"
    ));
  await interaction.editReply(componentPayload(container, { allowedUserIds: [] })).catch(() => null);
  return true;
}


function componentPayload(container, extra = {}) {
  const allowedUserIds = [...new Set((extra.allowedUserIds || []).filter(Boolean).map(String))];
  const payload = {
    ...extra,
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    allowedMentions: { users: allowedUserIds, roles: [], parse: [] }
  };
  delete payload.allowedUserIds;
  return payload;
}

async function sendLog(guild, type, ticket, details = "") {
  const channelId = CONFIG.ORDER_LOG_CHANNEL_ID;
  if (!channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const lines = [
    "## " + type,
    "**Ticket:** " + (ticket.channelId ? "<#" + ticket.channelId + ">" : "Unknown"),
    "**Customer:** <@" + ticket.userId + ">",
    "**Service:** " + serviceText(ticket.service),
    "**Status:** " + ticket.status,
    "**Claimed by:** " + (ticket.claimedBy ? "<@" + ticket.claimedBy + ">" : "Nobody")
  ];
  if (details) lines.push("**Details:** " + details);
  const container = new ContainerBuilder()
    .setAccentColor(0x38bdf8)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join("\n")))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent("Vexel Studios • Order Logs"));
  await channel.send(componentPayload(container, { allowedUserIds: [] })).catch(() => null);
}

async function writeTranscriptHtml(ticket, transcript) {
  await fs.mkdir(TRANSCRIPT_DIR, { recursive: true });
  const fileName = transcript.id + ".html";
  await fs.writeFile(path.join(TRANSCRIPT_DIR, fileName), transcript.html, "utf8");
  return TRANSCRIPT_PUBLIC_BASE_URL.replace(/\/$/, "") + "/" + fileName;
}

async function sendTranscriptLog(guild, ticket, transcript) {
  const channelId = CONFIG.TRANSCRIPT_LOG_CHANNEL_ID || CONFIG.ORDER_LOG_CHANNEL_ID;
  if (!channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const url = await writeTranscriptHtml(ticket, transcript);
  const container = new ContainerBuilder()
    .setAccentColor(0x22c55e)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      "## 📄 Transcript Saved\n**Customer:** <@" + ticket.userId + ">\n**Service:** " + serviceText(ticket.service) + "\n**Ticket ID:** " + ticket.channelId + "\n**Messages:** " + transcript.count
    ))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent("Open the Discord-style transcript on PrestonHQ below. Mentions are shown, but logs do not ping users."))
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("Open Transcript").setEmoji("📄").setStyle(ButtonStyle.Link).setURL(url)
    ));
  await channel.send(componentPayload(container, { allowedUserIds: [] })).catch(() => null);
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function mentionName(message, id) {
  const user = message.mentions?.users?.get?.(id);
  const member = message.mentions?.members?.get?.(id);
  return member?.displayName || user?.globalName || user?.username || id;
}

function roleMentionName(message, id) {
  const role = message.mentions?.roles?.get?.(id) || message.guild?.roles?.cache?.get?.(id);
  return role?.name || ('role-' + id);
}

function channelMentionName(message, id) {
  const channel = message.mentions?.channels?.get?.(id) || message.guild?.channels?.cache?.get?.(id);
  return channel?.name || id;
}

function resolveDiscordMentions(value, message) {
  let content = escapeHtml(value || "");
  content = content.replace(/&lt;@(\d+)&gt;/g, (_match, id) => '<span class="mention">@' + escapeHtml(mentionName(message, id)) + '</span>');
  content = content.replace(/&lt;@!(\d+)&gt;/g, (_match, id) => '<span class="mention">@' + escapeHtml(mentionName(message, id)) + '</span>');
  content = content.replace(/&lt;#(\d+)&gt;/g, (_match, id) => '<span class="mention">#' + escapeHtml(channelMentionName(message, id)) + '</span>');
  content = content.replace(/&lt;@&(\d+)&gt;/g, (_match, id) => '<span class="mention">@' + escapeHtml(roleMentionName(message, id)) + '</span>');
  return content;
}

function renderMessageContent(message) {
  const content = resolveDiscordMentions(message.content || "", message);
  return content || '<span class="muted">No text content</span>';
}
function renderEmbedMedia(url, alt, className) {
  if (!url) return "";
  return '<a class="' + className + '" href="' + escapeHtml(url) + '" target="_blank" rel="noreferrer"><img src="' + escapeHtml(url) + '" alt="' + escapeHtml(alt || "Embed media") + '"></a>';
}

function renderEmbed(embed, message) {
  const color = typeof embed.color === "number" ? "#" + embed.color.toString(16).padStart(6, "0") : "#5865f2";
  const authorName = embed.author?.name ? '<div class="embed-author">' + (embed.author.iconURL ? '<img src="' + escapeHtml(embed.author.iconURL) + '" alt="">' : '') + '<span>' + escapeHtml(embed.author.name) + '</span></div>' : "";
  const title = embed.title ? '<div class="embed-title">' + (embed.url ? '<a href="' + escapeHtml(embed.url) + '" target="_blank" rel="noreferrer">' + escapeHtml(embed.title) + '</a>' : escapeHtml(embed.title)) + '</div>' : "";
  const description = embed.description ? '<div class="embed-desc">' + resolveDiscordMentions(embed.description, message).replace(/\n/g, "<br>") + '</div>' : "";
  const fields = Array.isArray(embed.fields) && embed.fields.length ? '<div class="embed-fields">' + embed.fields.map((field) => '<div class="embed-field' + (field.inline ? ' inline' : '') + '"><b>' + escapeHtml(field.name) + '</b><span>' + resolveDiscordMentions(field.value, message).replace(/\n/g, "<br>") + '</span></div>').join("") + '</div>' : "";
  const thumbnail = renderEmbedMedia(embed.thumbnail?.url, "Thumbnail", "embed-thumb");
  const image = renderEmbedMedia(embed.image?.url, "Embed image", "embed-image");
  const footerText = [embed.footer?.text, embed.timestamp ? new Date(embed.timestamp).toLocaleString("en-US", { timeZone: "America/New_York" }) : ""].filter(Boolean).join(" • ");
  const footer = footerText ? '<div class="embed-footer">' + (embed.footer?.iconURL ? '<img src="' + escapeHtml(embed.footer.iconURL) + '" alt="">' : '') + '<span>' + escapeHtml(footerText) + '</span></div>' : "";
  return '<div class="embed-full" style="--embed-color:' + color + '"><div class="embed-main">' + authorName + title + description + fields + image + footer + '</div>' + thumbnail + '</div>';
}

function renderEmbeds(message) {
  if (!message.embeds?.length) return "";
  return '<div class="embeds">' + message.embeds.map((embed) => renderEmbed(embed, message)).join("") + '</div>';
}

function renderInlineMarkdown(value, message) {
  let html = resolveDiscordMentions(value || "", message);
  html = html.replace(/^### (.*)$/gm, '<h4>$1</h4>');
  html = html.replace(/^## (.*)$/gm, '<h3>$1</h3>');
  html = html.replace(/^# (.*)$/gm, '<h2>$1</h2>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

function componentLabel(component) {
  return component.label || component.placeholder || component.customId || component.url || component.type || "Component";
}

function componentEmoji(component) {
  if (!component?.emoji) return "";
  if (typeof component.emoji === "string") return component.emoji;
  return component.emoji.name || "";
}

function renderV2Component(component, message) {
  if (!component) return "";
  const raw = component.toJSON ? component.toJSON() : component;
  const type = raw.type;

  if (type === 17 || raw.components?.length) {
    const children = (raw.components || []).map((child) => renderV2Component(child, message)).join("");
    return type === 17 ? '<div class="v2-card">' + children + '</div>' : '<div class="component-row">' + children + '</div>';
  }

  if (type === 10) {
    return '<div class="v2-text">' + renderInlineMarkdown(raw.content || raw.text || "", message) + '</div>';
  }

  if (type === 14) {
    return '<div class="v2-separator"></div>';
  }

  if (type === 12) {
    const items = raw.items || raw.media || [];
    const media = items.map((item) => {
      const url = item?.media?.url || item?.url || item?.source?.url || "";
      if (!url) return "";
      return '<a class="v2-media" href="' + escapeHtml(url) + '" target="_blank" rel="noreferrer"><img src="' + escapeHtml(url) + '" alt="Media"></a>';
    }).join("");
    return media ? '<div class="v2-media-grid">' + media + '</div>' : "";
  }

  if (type === 2) {
    const label = escapeHtml((componentEmoji(raw) ? componentEmoji(raw) + " " : "") + componentLabel(raw));
    return '<span class="component-pill button-pill"><b>' + label + '</b></span>';
  }

  if (type === 3 || type === 5 || type === 6 || type === 7 || type === 8) {
    const options = Array.isArray(raw.options) && raw.options.length ? '<div class="select-options">' + raw.options.map((option) => '<span>' + escapeHtml((option.emoji?.name ? option.emoji.name + " " : "") + option.label) + '</span>').join("") + '</div>' : "";
    return '<div class="select-box"><b>' + escapeHtml(raw.placeholder || 'Select Menu') + '</b>' + options + '</div>';
  }

  const label = escapeHtml((componentEmoji(raw) ? componentEmoji(raw) + " " : "") + componentLabel(raw));
  return '<span class="component-pill"><b>' + label + '</b><small>type ' + escapeHtml(type) + '</small></span>';
}

function renderComponents(message) {
  if (!message.components?.length) return "";
  return '<div class="components-v2">' + message.components.map((component) => renderV2Component(component, message)).join("") + '</div>';
}
function renderStickers(message) {
  if (!message.stickers?.size) return "";
  return '<div class="stickers">' + [...message.stickers.values()].map((sticker) => '<span class="sticker">Sticker: ' + escapeHtml(sticker.name || sticker.id) + '</span>').join("") + '</div>';
}
async function generateTranscript(channel, ticket) {
  const messages = [];
  let before;
  for (let page = 0; page < 10; page++) {
    const fetched = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!fetched?.size) break;
    messages.push(...fetched.values());
    before = fetched.last()?.id;
    if (fetched.size < 100) break;
  }
  messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const closedAt = nowIso();
  const id = shortId(ticket.channelId + "-" + Date.now());
  const rows = messages.map((message) => {
    const author = message.author;
    const displayName = escapeHtml(author?.globalName || author?.username || author?.tag || "Unknown User");
    const tag = escapeHtml(author?.tag || author?.id || "unknown");
    const avatar = author?.displayAvatarURL?.({ extension: "png", size: 64 }) || "";
    const attachments = message.attachments?.size
      ? '<div class="attachments">' + [...message.attachments.values()].map((a) => {
          const isImage = String(a.contentType || "").startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(a.url || "");
          const image = isImage ? '<img src="' + escapeHtml(a.url) + '" alt="' + escapeHtml(a.name || "Attachment") + '">' : "";
          return '<a class="attachment" href="' + escapeHtml(a.url) + '" target="_blank" rel="noreferrer">' + image + '<span>Attachment: ' + escapeHtml(a.name || "Attachment") + '</span></a>';
        }).join("") + '</div>'
      : "";
    const embeds = renderEmbeds(message);
    const components = renderComponents(message);
    const stickers = renderStickers(message);
    return '<article class="msg"><img class="avatar" src="' + escapeHtml(avatar) + '" alt=""><div class="bubble"><div class="meta"><strong>' + displayName + '</strong><span>' + tag + '</span><time>' + message.createdAt.toLocaleString("en-US", { timeZone: "America/New_York" }) + '</time></div><div class="content">' + renderMessageContent(message) + '</div>' + attachments + embeds + components + stickers + '</div></article>';
  }).join("\n");

  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Order Transcript • ' + escapeHtml(channel.name) + '</title><style>' +
    ':root{color-scheme:dark;--bg:#070913;--panel:#111827;--soft:#1f2937;--line:#2b3446;--text:#f8fafc;--muted:#9ca3af;--accent:#38bdf8;--pink:#ff2fab}*{box-sizing:border-box}body{margin:0;font-family:Inter,Segoe UI,system-ui,sans-serif;background:radial-gradient(circle at 15% 0%,rgba(255,47,171,.22),transparent 32%),radial-gradient(circle at 90% 10%,rgba(56,189,248,.18),transparent 34%),var(--bg);color:var(--text)}.wrap{max-width:1040px;margin:0 auto;padding:34px 18px 56px}.hero{border:1px solid rgba(255,255,255,.11);background:rgba(17,24,39,.82);backdrop-filter:blur(18px);border-radius:22px;padding:24px;box-shadow:0 24px 80px rgba(0,0,0,.42)}.eyebrow{color:var(--accent);font-size:12px;text-transform:uppercase;letter-spacing:.22em}.hero h1{margin:8px 0 12px;font-size:clamp(28px,5vw,48px)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin-top:18px}.stat{border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.035);border-radius:14px;padding:12px}.stat b{display:block;color:#fff}.stat span{font-size:13px;color:var(--muted)}.messages{margin-top:20px;border:1px solid rgba(255,255,255,.1);background:rgba(8,12,25,.72);border-radius:22px;padding:10px}.msg{display:flex;gap:12px;padding:14px;border-radius:16px}.msg:hover{background:rgba(255,255,255,.035)}.avatar{width:42px;height:42px;border-radius:50%;background:#263043}.bubble{min-width:0;flex:1}.meta{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;margin-bottom:4px}.meta strong{font-size:15px}.meta span,.meta time{font-size:12px;color:var(--muted)}.content{white-space:pre-wrap;word-break:break-word;color:#e5e7eb;line-height:1.5}.mention{border-radius:5px;background:rgba(88,101,242,.26);color:#c7d2fe;padding:0 4px;font-weight:600}.attachments{display:grid;gap:8px;margin-top:10px}.attachment{display:inline-flex;flex-direction:column;gap:7px;width:fit-content;max-width:min(460px,100%);color:#7dd3fc;text-decoration:none;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.035);border-radius:12px;padding:8px}.attachment img{max-width:100%;max-height:320px;border-radius:8px;object-fit:contain}.embeds{display:grid;gap:10px;margin-top:10px}.embed-full{display:flex;gap:12px;max-width:620px;border-left:4px solid var(--embed-color);background:rgba(17,24,39,.86);border-radius:10px;padding:12px;border-top:1px solid rgba(255,255,255,.08);border-right:1px solid rgba(255,255,255,.08);border-bottom:1px solid rgba(255,255,255,.08)}.embed-main{min-width:0;flex:1}.embed-author,.embed-footer{display:flex;align-items:center;gap:7px;color:#cbd5e1;font-size:12px}.embed-author img,.embed-footer img{width:18px;height:18px;border-radius:50%}.embed-title{font-weight:800;margin-top:5px;color:#fff}.embed-title a{color:#93c5fd;text-decoration:none}.embed-desc{margin-top:6px;color:#e5e7eb;line-height:1.45}.embed-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:10px}.embed-field{display:grid;gap:3px}.embed-field b{font-size:12px;color:#fff}.embed-field span{font-size:13px;color:#d1d5db}.embed-thumb img{width:88px;max-height:88px;border-radius:8px;object-fit:cover}.embed-image{display:block;margin-top:10px}.embed-image img{max-width:100%;max-height:360px;border-radius:8px;object-fit:contain}.embed-footer{margin-top:10px;color:#94a3b8}.components-v2{display:grid;gap:10px;margin-top:10px}.v2-card{border:1px solid rgba(255,255,255,.12);background:rgba(17,24,39,.72);border-radius:14px;padding:12px;display:grid;gap:10px;max-width:680px}.v2-text{color:#e5e7eb;line-height:1.5}.v2-text h2,.v2-text h3,.v2-text h4{margin:0 0 4px;color:#fff}.v2-text blockquote{margin:6px 0;padding:7px 10px;border-left:3px solid #64748b;background:rgba(255,255,255,.04);border-radius:8px}.v2-separator{height:1px;background:rgba(255,255,255,.14);margin:2px 0}.component-row{display:flex;flex-wrap:wrap;gap:7px}.component-pill{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(255,255,255,.12);background:rgba(88,101,242,.16);border-radius:8px;padding:6px 9px}.button-pill{background:rgba(88,101,242,.22)}.component-pill small{color:#94a3b8}.select-box{border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:10px;background:rgba(255,255,255,.04)}.select-options{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.select-options span{background:rgba(88,101,242,.16);border-radius:7px;padding:5px 7px}.v2-media-grid{display:grid;gap:8px}.v2-media img{max-width:100%;max-height:380px;border-radius:10px;object-fit:contain}.stickers{margin-top:8px;color:#fbbf24}.muted{color:var(--muted)}.foot{margin-top:18px;text-align:center;color:var(--muted);font-size:13px}</style></head><body><main class="wrap"><section class="hero"><div class="eyebrow">PrestonHQ Transcript</div><h1>📄 Order Ticket Transcript</h1><p>Discord-style archive for <strong>' + escapeHtml(channel.name) + '</strong>.</p><div class="grid"><div class="stat"><span>Customer</span><b>&lt;@' + escapeHtml(ticket.userId) + '&gt;</b></div><div class="stat"><span>Service</span><b>' + escapeHtml(serviceText(ticket.service)) + '</b></div><div class="stat"><span>Status</span><b>' + escapeHtml(ticket.status) + '</b></div><div class="stat"><span>Messages</span><b>' + messages.length + '</b></div><div class="stat"><span>Created</span><b>' + escapeHtml(new Date(ticket.createdAt).toLocaleString("en-US", { timeZone: "America/New_York" })) + '</b></div><div class="stat"><span>Closed</span><b>' + escapeHtml(new Date(closedAt).toLocaleString("en-US", { timeZone: "America/New_York" })) + '</b></div></div></section><section class="messages">' + (rows || '<p class="muted" style="padding:18px">No messages were found.</p>') + '</section><div class="foot">Vexel Studios • Powered by PrestonHQ</div></main></body></html>';
  return { id, html, count: messages.length };
}

async function editTicketPanel(guild, ticket) {
  const channel = await guild.channels.fetch(ticket.channelId).catch(() => null);
  if (!channel?.isTextBased() || !ticket.panelMessageId) return;
  const message = await channel.messages.fetch(ticket.panelMessageId).catch(() => null);
  if (!message) return;
  await message.edit(componentPayload(buildTicketContainer(ticket), { allowedUserIds: [ticket.userId, ticket.claimedBy].filter(Boolean) })).catch(() => null);
}

async function sendOrderPanel(channel) {
  const files = require("node:fs").existsSync(PANEL_IMAGE_PATH)
    ? [new AttachmentBuilder(PANEL_IMAGE_PATH, { name: PANEL_IMAGE_NAME })]
    : [];
  return channel.send({ ...componentPayload(buildOrderPanelContainer()), files });
}

async function createOrderTicket(interaction, serviceKey) {
  const existing = await findOpenTicket(interaction.guild, interaction.user.id);
  if (existing) {
    await interaction.reply({ content: "You already have an open order ticket: <#" + existing.channelId + ">.", flags: 64 });
    return;
  }

  await interaction.deferReply({ flags: 64 });
  const staffRole = CONFIG.STAFF_ROLE_ID ? await interaction.guild.roles.fetch(CONFIG.STAFF_ROLE_ID).catch(() => null) : null;
  const category = CONFIG.ORDER_CATEGORY_ID ? await interaction.guild.channels.fetch(CONFIG.ORDER_CATEGORY_ID).catch(() => null) : null;
  const permissionOverwrites = [
    { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
    { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] }
  ];
  if (staffRole) {
    permissionOverwrites.push({ id: staffRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] });
  }

  const channel = await interaction.guild.channels.create({
    name: ticketChannelName({ username: interaction.user.username, claimedBy: null, status: "Open" }, interaction.user.username),
    type: ChannelType.GuildText,
    parent: category?.type === ChannelType.GuildCategory ? category.id : undefined,
    topic: "Order ticket for " + interaction.user.tag + " • " + serviceText(serviceKey),
    permissionOverwrites,
    reason: "Order ticket opened by " + interaction.user.tag
  });

  let ticket = {
    guildId: interaction.guild.id,
    channelId: channel.id,
    userId: interaction.user.id,
    username: interaction.user.tag,
    service: serviceKey,
    status: "Open",
    claimedBy: null,
    createdAt: nowIso(),
    panelMessageId: null
  };

  const panelMessage = await channel.send(componentPayload(buildTicketContainer(ticket), { allowedUserIds: [interaction.user.id] }));
  ticket.panelMessageId = panelMessage.id;
  ticket = await saveTicket(ticket);
  await sendLog(interaction.guild, "🛒 Ticket Created", ticket, "Opened from the order panel.");
  await interaction.editReply({ content: "Created your private order ticket: <#" + channel.id + ">." });
}

async function handleTicketInteraction(interaction) {
  if (await handleReviewInteraction(interaction)) return true;
  if (!interaction.guild) return false;

  if (interaction.isStringSelectMenu() && interaction.customId === "order:select") {
    const serviceKey = interaction.values?.[0] || "custom";
    await createOrderTicket(interaction, serviceKey);
    return true;
  }

  if (!interaction.isButton() || !interaction.customId.startsWith("order:")) return false;
  let ticket = await getTicket(interaction.channelId);
  if (!ticket) {
    ticket = await recoverTicketFromChannel(interaction);
  }
  if (!ticket) {
    await interaction.reply({ content: "This order ticket is not registered anymore. I could not recover it from this channel.", flags: 64 });
    return true;
  }

  const action = interaction.customId;
  if (action === "order:close-cancel") {
    await interaction.update(componentPayload(buildTicketContainer(ticket), { allowedUserIds: [ticket.userId, ticket.claimedBy].filter(Boolean) }));
    return true;
  }

  if (action === "order:close-confirm") {
    if (!isStaff(interaction.member) && interaction.user.id !== ticket.userId) {
      await interaction.reply({ content: "Only the customer or staff can close this order ticket.", flags: 64 });
      return true;
    }
    await interaction.update(componentPayload(new ContainerBuilder().setAccentColor(0xef4444).addTextDisplayComponents(new TextDisplayBuilder().setContent("## 🔒 Closing Ticket\nSaving transcript and closing this order ticket in a few seconds."))));
    const channel = interaction.channel;
    let closedTicket = { ...ticket, status: "Closed", closedBy: interaction.user.id, closedAt: nowIso() };

    try {
      const transcript = await generateTranscript(channel, closedTicket);
      closedTicket = await saveTicket(closedTicket);
      await syncTicketChannelName(interaction.guild, closedTicket).catch((error) => console.error("Ticket close name sync failed:", error.message));
      await sendTranscriptLog(interaction.guild, closedTicket, transcript).catch((error) => console.error("Ticket transcript log failed:", error.message));
      await sendLog(interaction.guild, "🔒 Ticket Closed", closedTicket, "Closed by <@" + interaction.user.id + ">.").catch((error) => console.error("Ticket close log failed:", error.message));
      await sendReviewRequest(interaction.client, closedTicket).catch((error) => console.error("Ticket review request failed:", error.message));
    } catch (error) {
      console.error("Ticket close transcript/save failed:", error.message);
      closedTicket = await saveTicket(closedTicket).catch(() => closedTicket);
    } finally {
      await removeTicket(channel.id).catch((error) => console.error("Ticket store cleanup failed:", error.message));
      setTimeout(() => channel.delete("Order ticket closed").catch((error) => console.error("Ticket channel delete failed:", error.message)), 5000);
    }
    return true;
  }

  if (action === "order:close") {
    await interaction.reply(componentPayload(buildCloseConfirmContainer(ticket), { allowedUserIds: [ticket.userId, ticket.claimedBy].filter(Boolean) }));
    return true;
  }

  if (!isStaff(interaction.member)) {
    await interaction.reply({ content: "Only staff can use this order control.", flags: 64 });
    return true;
  }

  if (action === "order:claim") {
    if (ticket.claimedBy && ticket.claimedBy !== interaction.user.id) {
      await interaction.reply({ content: "This ticket is already claimed by <@" + ticket.claimedBy + ">.", flags: 64 });
      return true;
    }
    const next = await saveTicket({ ...ticket, claimedBy: interaction.user.id });
    await syncTicketChannelName(interaction.guild, next);
    await editTicketPanel(interaction.guild, next);
    await sendLog(interaction.guild, "✅ Ticket Claimed", next, "Claimed by <@" + interaction.user.id + ">.");
    await interaction.reply({ content: "✅ <@" + interaction.user.id + "> claimed this order ticket.", allowedMentions: { users: [interaction.user.id], roles: [], parse: [] } });
    return true;
  }

  if (action === "order:unclaim") {
    if (ticket.claimedBy && ticket.claimedBy !== interaction.user.id && !interaction.member.permissions.has(PermissionFlagsBits.Administrator) && !interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      await interaction.reply({ content: "Only the claimer or management can unclaim this ticket.", flags: 64 });
      return true;
    }
    const next = await saveTicket({ ...ticket, claimedBy: null });
    await syncTicketChannelName(interaction.guild, next);
    await editTicketPanel(interaction.guild, next);
    await sendLog(interaction.guild, "🔓 Ticket Unclaimed", next, "Unclaimed by <@" + interaction.user.id + ">.");
    await interaction.reply({ content: "🔓 <@" + interaction.user.id + "> unclaimed this order ticket.", allowedMentions: { users: [interaction.user.id], roles: [], parse: [] } });
    return true;
  }

  if (action.startsWith("order:status:")) {
    const status = action.slice("order:status:".length);
    if (!STATUS_META[status]) {
      await interaction.reply({ content: "Unknown ticket status.", flags: 64 });
      return true;
    }
    const next = await saveTicket({ ...ticket, status });
    await syncTicketChannelName(interaction.guild, next);
    await editTicketPanel(interaction.guild, next);
    await sendLog(interaction.guild, "📌 Status Changed", next, "Updated by <@" + interaction.user.id + ">.");
    await interaction.reply({ content: "📌 <@" + interaction.user.id + "> updated this order to **" + status + "**.", allowedMentions: { users: [interaction.user.id], roles: [], parse: [] } });
    return true;
  }

  return false;
}

module.exports = {
  CONFIG,
  SERVICES,
  buildOrderPanelContainer,
  handleTicketInteraction,
  isStaff,
  sendOrderPanel
};
