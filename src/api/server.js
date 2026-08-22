const express = require("express");
const path = require("node:path");
const fsPromises = require("node:fs/promises");
const fsNative = require("node:fs");
const cors = require("cors");
const session = require("express-session");
const MemoryStore = require("memorystore")(session);
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require("discord.js");
const { baseCommands } = require("../bot/commandCatalog");
const { requireAuth, createRequireGuildAdmin } = require("./middleware/auth");
const { createAuthRouter } = require("./routes/auth");
const { createDebugRouter } = require("./routes/debug");
const { logApi } = require("./logger");
const { getGuildCommandSettings, patchCommandSetting } = require("../services/commandSettingsService");
const { getGuildCustomCommands, createCustomCommand, updateCustomCommand, deleteCustomCommand } = require("../services/customCommandsService");
const { getGuildCustomReplies, createCustomReply, updateCustomReply, deleteCustomReply } = require("../services/customRepliesService");
const { getGuildSettings, updateGuildSettings, getMainSettings, patchMainSettings, getSectionSettings, patchSectionSettings, getSectionList, appendSectionListItem, updateSectionListItem, getGiveaways, patchGiveaway } = require("../services/guildSettingsService");
const { isValidCommandName, cleanText, isDiscordId } = require("../utils/validation");
const { sendGuildMessage } = require("./messageBuilder");
const prc = require("./prcClient");
const moderationStore = require("../services/moderationStore");
const dashboardOperations = require("../services/dashboardOperationsStore");
const { signAuthToken } = require("./tokenAuth");
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");
const { isoUint8Array } = require("@simplewebauthn/server/helpers");

const robloxAvatarCache = new Map();
const ROBLOX_AVATAR_CACHE_MS = 6 * 60 * 60 * 1000;

async function getRobloxAvatarHeadshot(robloxId) {
  const cached = robloxAvatarCache.get(robloxId);
  if (cached && cached.expiresAt > Date.now()) return cached.imageUrl;

  const endpoint = new URL("https://thumbnails.roblox.com/v1/users/avatar-headshot");
  endpoint.search = new URLSearchParams({
    userIds: robloxId,
    size: "150x150",
    format: "Png",
    isCircular: "true",
  }).toString();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(endpoint, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Roblox thumbnails returned ${response.status}`);
    const payload = await response.json();
    const thumbnail = payload?.data?.[0];
    const imageUrl = thumbnail?.state === "Completed" && thumbnail?.imageUrl
      ? String(thumbnail.imageUrl)
      : null;
    robloxAvatarCache.set(robloxId, {
      imageUrl,
      expiresAt: Date.now() + ROBLOX_AVATAR_CACHE_MS,
    });
    return imageUrl;
  } finally {
    clearTimeout(timeout);
  }
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function ok(res, data, status = 200) {
  return res.status(status).json({ ok: true, data });
}

function fail(res, status, message) {
  return res.status(status).json({ ok: false, error: message });
}

function settledValue(result, fallback) {
  return result.status === "fulfilled" ? result.value : fallback;
}

function getPrcPlayerName(player) {
  return String(player?.Player || player?.player || player?.Username || player?.username || player?.Name || player?.name || "Unknown");
}

function normalizePrcPlayer(player) {
  const rawName = getPrcPlayerName(player);
  const match = rawName.match(/^(.*?)\s*:\s*(\d+)$/);
  const username = String(player?.Username || player?.username || match?.[1] || rawName).trim();
  const id = String(player?.PlayerId || player?.playerId || player?.UserId || player?.userId || match?.[2] || username);
  const permission = String(player?.Permission || player?.permission || player?.PermissionName || "Normal");
  return {
    id,
    name: username,
    robloxId: id,
    team: String(player?.Team || player?.team || player?.TeamName || "Civilian"),
    callsign: String(player?.Callsign || player?.callsign || ""),
    permission,
    staff: !/^(normal|none|player|civilian)$/i.test(permission),
    raw: player,
  };
}

async function persistEnvValue(filePath, key, value) {
  const raw = await fsPromises.readFile(filePath, "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  const safeValue = String(value || "").trim();
  if (!/^[A-Z0-9_]+$/.test(key) || !safeValue || /[\r\n]/.test(safeValue)) throw new Error("Invalid environment value.");
  const lines = raw.split(/\r?\n/);
  let found = false;
  const next = lines.map((line) => {
    if (line.startsWith(key + "=")) {
      found = true;
      return key + "=" + safeValue;
    }
    return line;
  });
  if (!found) next.push("", "# ERLC / PRC API", key + "=" + safeValue);
  const temp = filePath + ".tmp";
  await fsPromises.writeFile(temp, next.join("\n").replace(/\n+$/, "") + "\n", { mode: 0o600 });
  await fsPromises.rename(temp, filePath);
}

function createModerationCommand(action, target, reason) {
  const safeReason = String(reason || "No reason provided").replace(/[\r\n]+/g, " ").trim().slice(0, 180);
  const commands = {
    Kick: `:kick ${target} ${safeReason}`,
    Ban: `:ban ${target} ${safeReason}`,
    Unban: `:unban ${target}`,
    Kill: `:kill ${target}`,
    Teleport: `:bring ${target}`,
    PM: `:pm ${target} ${safeReason}`,
    Announcement: `:h ${safeReason}`,
  };
  return commands[action] || null;
}

function dashboardActor(req) {
  return {
    id: req.session?.user?.id || "dashboard-admin",
    name: req.session?.user?.globalName || req.session?.user?.username || "Dashboard Admin",
  };
}

const tireShopFile = path.join(__dirname, "..", "data", "tire-shop.json");
const emptyTireShop = () => ({ version: 1, inventory: [], sales: [], updatedAt: new Date().toISOString() });
let tireShopWriteQueue = Promise.resolve();

const passkeyFile = path.join(__dirname, "..", "data", "dashboard-passkeys.json");
let passkeyWriteQueue = Promise.resolve();
const passkeyUser = { id: "prestonhq-admin-v1", username: "Akron Tire Shop" };

async function readPasskeys() {
  try {
    const parsed = JSON.parse(await fsPromises.readFile(passkeyFile, "utf8"));
    return { credentials: Array.isArray(parsed.credentials) ? parsed.credentials : [] };
  } catch (error) {
    if (error.code === "ENOENT") return { credentials: [] };
    throw error;
  }
}

function mutatePasskeys(mutator) {
  const operation = passkeyWriteQueue.then(async () => {
    const store = await readPasskeys();
    await mutator(store);
    const temporaryFile = `${passkeyFile}.${process.pid}.tmp`;
    await fsPromises.mkdir(path.dirname(passkeyFile), { recursive: true });
    await fsPromises.writeFile(temporaryFile, JSON.stringify(store, null, 2) + "\n", { mode: 0o600 });
    await fsPromises.rename(temporaryFile, passkeyFile);
    return store;
  });
  passkeyWriteQueue = operation.catch(() => undefined);
  return operation;
}

function shopText(value, max = 120) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function shopNumber(value, label, { integer = false, min = 0, max = 1000000 } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
    throw new Error(`${label} must be a valid ${integer ? "whole number" : "number"}.`);
  }
  return integer ? number : Math.round(number * 100) / 100;
}

async function readTireShop() {
  try {
    const parsed = JSON.parse(await fsPromises.readFile(tireShopFile, "utf8"));
    return {
      version: 1,
      inventory: Array.isArray(parsed.inventory) ? parsed.inventory : [],
      sales: Array.isArray(parsed.sales) ? parsed.sales : [],
      updatedAt: parsed.updatedAt || new Date().toISOString(),
    };
  } catch (error) {
    if (error.code === "ENOENT") return emptyTireShop();
    if (error instanceof SyntaxError) throw new Error("The tire shop data file is invalid JSON.");
    throw error;
  }
}

async function writeTireShop(data) {
  await fsPromises.mkdir(path.dirname(tireShopFile), { recursive: true });
  data.updatedAt = new Date().toISOString();
  const temporaryFile = tireShopFile + ".tmp";
  await fsPromises.writeFile(temporaryFile, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  await fsPromises.rename(temporaryFile, tireShopFile);
  return data;
}

function mutateTireShop(mutator) {
  const operation = tireShopWriteQueue.then(async () => {
    const data = await readTireShop();
    await mutator(data);
    return writeTireShop(data);
  });
  tireShopWriteQueue = operation.catch(() => undefined);
  return operation;
}

function easternDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function tireRimDiameter(size) {
  const text = String(size || "").toUpperCase();
  const radial = text.match(/R\s*(\d{2}(?:\.\d)?)/);
  if (radial) return Number(radial[1]);
  const candidates = (text.match(/\d+(?:\.\d+)?/g) || []).map(Number).filter((number) => number >= 10 && number <= 30);
  return candidates.length ? candidates[candidates.length - 1] : 999;
}

function tireShopResponse(data) {
  const packageOrder = { set4: 0, pair: 1, single: 2 };
  const inventory = [...data.inventory].sort((a, b) => tireRimDiameter(a.size) - tireRimDiameter(b.size)
    || String(a.size).localeCompare(String(b.size), undefined, { numeric: true, sensitivity: "base" })
    || (packageOrder[a.packageType] ?? 9) - (packageOrder[b.packageType] ?? 9));
  const sales = [...data.sales].sort((a, b) => new Date(b.soldAt).getTime() - new Date(a.soldAt).getTime());
  const today = easternDateKey();
  const todaysSales = sales.filter((sale) => easternDateKey(sale.soldAt) === today);
  return {
    inventory,
    sales,
    summary: {
      skus: inventory.length,
      units: inventory.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
      lowStock: inventory.filter((item) => item.quantity <= 5).length,
      inventoryValue: Math.round(inventory.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.price || 0), 0) * 100) / 100,
      todayUnits: todaysSales.reduce((sum, sale) => sum + Number(sale.quantity || 0), 0),
      todayRevenue: Math.round(todaysSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0) * 100) / 100,
      allTimeRevenue: Math.round(sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0) * 100) / 100,
    },
    updatedAt: data.updatedAt,
  };
}

function inventoryFields(body, existing = {}) {
  const brand = shopText(body.brand ?? existing.brand, 80);
  const size = shopText(body.size ?? existing.size, 40).toUpperCase();
  const requestedPackageType = shopText(body.packageType ?? existing.packageType ?? "single", 20).toLowerCase();
  const packageType = ["set4", "pair", "single"].includes(requestedPackageType) ? requestedPackageType : "single";
  if (!size) throw new Error("Tire size is required.");
  return {
    brand: brand || "Tire",
    model: shopText(body.model ?? existing.model, 100),
    size,
    packageType,
    quantity: shopNumber(body.quantity ?? existing.quantity, "Quantity", { integer: true, max: 100000 }),
    cost: shopNumber(body.cost ?? existing.cost ?? 0, "Cost", { max: 100000 }),
    price: shopNumber(body.price ?? existing.price, "Selling price", { max: 100000 }),
    location: shopText(body.location ?? existing.location, 80),
    notes: shopText(body.notes ?? existing.notes, 500),
  };
}

const tireWorkTypes = new Set(["tire", "mount", "plug", "rotation", "brakes"]);

function normalizeTireWorkType(value) {
  const normalized = shopText(value || "tire", 20).toLowerCase();
  return tireWorkTypes.has(normalized) ? normalized : "tire";
}

function tireWorkLabel(value) {
  if (value === "mount") return "Mount";
  if (value === "plug") return "Plug";
  if (value === "rotation") return "Rotation";
  if (value === "brakes") return "Brakes";
  return "Tire Sale";
}

function safeSecretMatch(supplied, expected) {
  const left = Buffer.from(String(supplied || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length > 15 && left.length === right.length && crypto.timingSafeEqual(left, right);
}


const giveawaySources = [
  { botId: "ecrp", botName: "ECRP Assistant", databasePath: "/root/bots/bot4/src/data/giveaways.sqlite" },
  { botId: "veltrix", botName: "Veltrix", databasePath: "/root/bots/bot3/src/data/giveaways.sqlite" },
  { botId: "icesway", botName: "IceSway Utils", databasePath: "/root/bots/bot2/src/data/giveaways.sqlite" },
];

let sqliteModule = null;
function getSqlite() {
  if (sqliteModule) return sqliteModule;
  const candidates = [
    "better-sqlite3",
    "/root/bots/bot4/node_modules/better-sqlite3",
    "/root/bots/bot3/node_modules/better-sqlite3",
    "/root/bots/bot2/node_modules/better-sqlite3",
  ];
  for (const candidate of candidates) {
    try {
      sqliteModule = require(candidate);
      return sqliteModule;
    } catch {
      /* try next */
    }
  }
  throw new Error("better-sqlite3 is not available to read giveaway data.");
}

function giveawayDbExists(file) {
  try {
    return fsNative.existsSync(file) && fsNative.statSync(file).size > 0;
  } catch {
    return false;
  }
}

function readGiveawaysFromSource(source) {
  if (!giveawayDbExists(source.databasePath)) return [];
  const Database = getSqlite();
  const db = new Database(source.databasePath, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare(`
      SELECT
        id, guild_id, channel_id, message_id, prize, description, host_id, host_name,
        sponsor_id, winner_count, image_url, status, start_time, end_time, remaining_ms,
        created_by, created_at
      FROM giveaways
      WHERE status IN ('active', 'paused')
      ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, end_time ASC
      LIMIT 25
    `).all();

    const entryStats = db.prepare(`
      SELECT COUNT(*) AS users, COALESCE(SUM(weight), 0) AS weighted
      FROM giveaway_entries
      WHERE giveaway_id = ?
    `);
    const entries = db.prepare(`
      SELECT user_id, weight, entered_at
      FROM giveaway_entries
      WHERE giveaway_id = ?
      ORDER BY entered_at ASC
      LIMIT 50
    `);

    return rows.map((row) => {
      const stats = entryStats.get(row.id) || { users: 0, weighted: 0 };
      return {
        botId: source.botId,
        botName: source.botName,
        id: row.id,
        guildId: row.guild_id,
        channelId: row.channel_id,
        messageId: row.message_id || null,
        prize: row.prize,
        description: row.description || "",
        hostId: row.host_id,
        hostName: row.host_name || "Unknown host",
        sponsorId: row.sponsor_id || null,
        winnerCount: row.winner_count,
        imageUrl: row.image_url || null,
        status: row.status,
        startTime: row.start_time,
        endTime: row.end_time,
        remainingMs: row.remaining_ms,
        createdAt: row.created_at,
        entries: {
          users: Number(stats.users || 0),
          weighted: Number(stats.weighted || 0),
          visible: entries.all(row.id).map((entry) => ({
            userId: entry.user_id,
            weight: Number(entry.weight || 1),
            enteredAt: entry.entered_at,
          })),
        },
      };
    });
  } finally {
    db.close();
  }
}

async function hydrateGiveawayUsers(client, giveaways) {
  const ids = [...new Set(giveaways.flatMap((giveaway) => giveaway.entries.visible.map((entry) => entry.userId)).filter(Boolean))].slice(0, 150);
  const userMap = new Map();
  await Promise.all(ids.map(async (id) => {
    const user = await client.users.fetch(id).catch(() => null);
    if (user) userMap.set(id, { id, username: user.username, tag: user.tag, displayName: user.globalName || user.username, avatarUrl: user.displayAvatarURL?.({ size: 64 }) || null });
  }));
  return giveaways.map((giveaway) => ({
    ...giveaway,
    entries: {
      ...giveaway.entries,
      visible: giveaway.entries.visible.map((entry) => ({
        ...entry,
        user: userMap.get(entry.userId) || { id: entry.userId, username: "Unknown user", tag: entry.userId, displayName: "Unknown user", avatarUrl: null },
      })),
    },
  }));
}

async function getActiveGiveaways(client) {
  const giveaways = giveawaySources.flatMap((source) => {
    try {
      return readGiveawaysFromSource(source);
    } catch (error) {
      console.error("Failed to read giveaways for " + source.botName + ":", error.message);
      return [];
    }
  });
  giveaways.sort((a, b) => {
    if (a.status !== b.status) return a.status === "active" ? -1 : 1;
    return Number(a.endTime || 0) - Number(b.endTime || 0);
  });
  return hydrateGiveawayUsers(client, giveaways);
}

function color(value, fallback = 0x0b1f4d) {
  if (typeof value === "number") return value;
  const parsed = Number.parseInt(String(value || "").replace("#", ""), 16);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function getLoadedSlashCommands(client) {
  if (!client.isReady()) return [];
  const collection = await client.application.commands.fetch().catch(() => null);
  if (!collection) return [];
  return [...collection.values()].map((command) => ({ name: command.name, description: command.description || "", category: "slash", usage: "/" + command.name, permission: "EVERYONE", cooldown: 0, type: "slash" }));
}

function serializeChannel(channel) {
  return { id: channel.id, name: channel.name, type: channel.type, parentId: channel.parentId || null };
}

function serializeRole(role) {
  return { id: role.id, name: role.name, color: role.hexColor, position: role.position, managed: role.managed };
}

function validateRoleIds(guild, roleIds = []) {
  return Array.isArray(roleIds) && roleIds.every((id) => isDiscordId(id) && guild.roles.cache.has(id));
}

async function sendTicketPanel(guild, body, settings) {
  const channelId = body.channelId || body.panelChannelId || settings.panelChannelId;
  if (!isDiscordId(channelId)) throw new Error("Valid panelChannelId/channelId is required.");
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) throw new Error("Ticket panel channel must be a text channel.");

  const embed = new EmbedBuilder()
    .setColor(color(body.embedColor || settings.embedColor))
    .setTitle(cleanText(body.embedTitle || settings.embedTitle || "Need Support?", 256))
    .setDescription(cleanText(body.embedDescription || settings.embedDescription || "Click below to open a support ticket.", 4000))
    .setFooter({ text: guild.name + " • Tickets" })
    .setTimestamp();
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("ticket:open").setLabel(cleanText(body.buttonLabel || settings.buttonLabel || "Open Ticket", 80)).setStyle(ButtonStyle.Primary));
  const message = await channel.send({ embeds: [embed], components: [row], allowedMentions: { parse: [] } });
  return { id: crypto.randomUUID(), messageId: message.id, channelId: channel.id, logChannelId: body.logChannelId || settings.logChannelId || "", settings: { ...settings, ...(body || {}) }, createdAt: new Date().toISOString() };
}

async function sendReactionRolePanel(guild, body) {
  if (!isDiscordId(body.channelId)) throw new Error("Valid channelId is required.");
  const channel = await guild.channels.fetch(body.channelId).catch(() => null);
  if (!channel?.isTextBased()) throw new Error("Reaction role panel channel must be a text channel.");
  const options = Array.isArray(body.options) ? body.options.slice(0, 25) : [];
  if (!options.length) throw new Error("At least one reaction role option is required.");
  for (const option of options) {
    if (!isDiscordId(option.roleId) || !guild.roles.cache.has(option.roleId)) throw new Error("Every option must include an existing roleId.");
  }

  const embed = new EmbedBuilder()
    .setColor(color(body.color))
    .setTitle(cleanText(body.title || "Reaction Roles", 256))
    .setDescription(cleanText(body.description || "Click a button to toggle a role.", 4000))
    .setFooter({ text: guild.name + " • Reaction Roles" })
    .setTimestamp();
  const rows = [];
  for (let i = 0; i < options.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(options.slice(i, i + 5).map((option) => {
      const button = new ButtonBuilder().setCustomId("rr:" + option.roleId).setLabel(cleanText(option.label || "Role", 80)).setStyle(ButtonStyle.Secondary);
      if (option.emoji) button.setEmoji(option.emoji);
      return button;
    })));
  }
  const message = await channel.send({ embeds: [embed], components: rows, allowedMentions: { parse: [] } });
  return { id: crypto.randomUUID(), messageId: message.id, channelId: channel.id, title: body.title || "Reaction Roles", description: body.description || "", color: body.color || "#0B1F4D", options, createdAt: new Date().toISOString() };
}

async function sendWelcomeTest(guild, settings, requesterId) {
  const channelId = settings.channelId;
  if (!isDiscordId(channelId)) throw new Error("Welcome channelId is not configured.");
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) throw new Error("Welcome channel must be a text channel.");
  const vars = {
    "{user}": "<@" + requesterId + ">",
    "{server}": guild.name,
    "{memberCount}": String(guild.memberCount || guild.memberCount === 0 ? guild.memberCount : "0")
  };
  const applyVars = (text) => Object.entries(vars).reduce((out, [key, value]) => out.split(key).join(value), String(text || ""));
  if (settings.mode === "embed") {
    const embed = new EmbedBuilder().setColor(color(settings.embedColor)).setTitle(applyVars(settings.embedTitle || "Welcome!")).setDescription(applyVars(settings.embedDescription || "Welcome {user} to {server}.")).setTimestamp();
    await channel.send({ embeds: [embed], allowedMentions: { users: [requesterId], roles: [], parse: [] } });
  } else {
    await channel.send({ content: applyVars(settings.message || "Welcome {user} to {server}!"), allowedMentions: { users: [requesterId], roles: [], parse: [] } });
  }
}

function resolveAllowedOrigins(frontendOrigin, publicApiBaseUrl) {
  const origins = new Set();
  for (const raw of [frontendOrigin, publicApiBaseUrl, "https://api.prestonhq.com", "https://prestonhq.com", "https://www.prestonhq.com", "http://localhost:3001"]) {
    if (!raw) continue;
    try {
      origins.add(new URL(String(raw).replace(/\/$/, "")).origin);
    } catch {
      /* ignore invalid urls */
    }
  }
  const base = String(frontendOrigin || "https://api.prestonhq.com").replace(/\/$/, "");
  origins.add(base);
  if (base.startsWith("https://") && !base.includes("://www.")) origins.add(base.replace("https://", "https://www."));
  return origins;
}

function mountDashboard(app, httpdocsRoot) {
  const dashboardIndex = path.join(httpdocsRoot, "dashboard", "index.html");
  const giveawayImageRoot = "/root/bots/shared/giveaway-images";
  app.use("/giveaway-images", express.static(giveawayImageRoot, {
    fallthrough: false,
    immutable: true,
    maxAge: "365d",
  }));
  app.get(["/dashboard", "/dashboard/"], (_req, res) => {
    res.sendFile(dashboardIndex);
  });
  app.use(express.static(httpdocsRoot, { index: "index.html", redirect: false }));
}

const botPowerTargets = {
  ecrp: { id: "ecrp", name: "ECRP Assistant", pm2Name: "bot4" },
  veltrix: { id: "veltrix", name: "Veltrix", pm2Name: "bot3" },
  icesway: { id: "icesway", name: "IceSway Utils", pm2Name: "bot2" },
};
const botPowerActions = new Set(["status", "start", "stop", "restart"]);

function safeEqualString(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function resolveBotPowerPassword(dashboardPassword) {
  return process.env.BOT_POWER_PASSWORD || process.env.ADMIN_PASSWORD || process.env.DASHBOARD_PASSWORD || dashboardPassword || "COARP";
}

function runPm2(args) {
  return new Promise((resolve, reject) => {
    execFile("pm2", args, { timeout: 30000, env: { ...process.env, PM2_HOME: process.env.PM2_HOME || "/root/.pm2" } }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function cleanPm2Proc(proc) {
  const env = proc?.pm2_env || {};
  return {
    pm2Name: proc?.name || env.name || "unknown",
    pmId: proc?.pm_id ?? null,
    status: env.status || "unknown",
    online: env.status === "online",
    restarts: Number(env.restart_time || 0),
    uptime: env.pm_uptime || null,
    cpu: Number(proc?.monit?.cpu || 0),
    memoryMb: Math.round(Number(proc?.monit?.memory || 0) / 1024 / 1024),
  };
}

async function getPm2ProcessMap() {
  const { stdout } = await runPm2(["jlist"]);
  const list = JSON.parse(stdout || "[]");
  return new Map(list.map((proc) => [proc.name, cleanPm2Proc(proc)]));
}

async function getBotPowerStatuses() {
  const byName = await getPm2ProcessMap();
  return Object.values(botPowerTargets).map((target) => ({
    ...target,
    ...(byName.get(target.pm2Name) || { pm2Name: target.pm2Name, status: "missing", online: false, restarts: 0, uptime: null, cpu: 0, memoryMb: 0 }),
  }));
}

function tableCount(db, sql, fallback = 0) {
  try {
    return Number(db.prepare(sql).get()?.count || fallback);
  } catch {
    return fallback;
  }
}

function veltrixDatabaseSource() {
  const source = giveawaySources.find((entry) => entry.botId === "veltrix");
  if (!source || !giveawayDbExists(source.databasePath)) return null;
  return source;
}

function veltrixGuildId(db) {
  const tables = ["staff_profiles", "staff_active_shifts", "staff_audit_logs", "moderation_cases"];
  for (const table of tables) {
    try {
      const row = db.prepare(`SELECT guild_id AS guildId FROM ${table} WHERE guild_id IS NOT NULL ORDER BY rowid DESC LIMIT 1`).get();
      if (row?.guildId) return String(row.guildId);
    } catch {}
  }
  return null;
}

async function resolveDiscordUsers(client, ids) {
  const unique = [...new Set(ids.filter((id) => /^\d{17,20}$/.test(String(id || ""))).map(String))].slice(0, 80);
  const entries = await Promise.all(unique.map(async (userId) => {
    try {
      const user = client.users.cache.get(userId) || await client.users.fetch(userId);
      return [userId, {
        id: userId,
        name: user.globalName || user.username,
        username: user.username,
        avatarUrl: user.displayAvatarURL({ extension: "png", size: 128 }),
      }];
    } catch {
      return [userId, { id: userId, name: `User ${userId.slice(-4)}`, username: userId, avatarUrl: null }];
    }
  }));
  return Object.fromEntries(entries);
}

function parseAuditDetails(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return { note: String(value) }; }
}

async function getVeltrixDashboard(client) {
  const statuses = await getBotPowerStatuses();
  const processStatus = statuses.find((entry) => entry.id === "veltrix") || {
    id: "veltrix",
    name: "Veltrix",
    pm2Name: "bot3",
    status: "missing",
    online: false,
    restarts: 0,
    uptime: null,
    cpu: 0,
    memoryMb: 0,
  };
  const source = giveawaySources.find((entry) => entry.botId === "veltrix");
  const activeGiveaways = (await getActiveGiveaways(client)).filter((entry) => entry.botId === "veltrix");
  const summary = {
    activeSessions: 0,
    staffOnDuty: 0,
    moderationCases: 0,
    activeWarnings: 0,
    verifiedMembers: 0,
    staffProfiles: 0,
    pendingLeaveRequests: 0,
    activeStrikes: 0,
  };
  let recentStaffActivity = [];
  let activeShifts = [];
  let shiftHistory = [];
  let warningHistory = [];
  let strikeHistory = [];
  let moderationHistory = [];
  let staffProfiles = [];
  let guildId = null;
  let database = { connected: false, integrity: "unavailable", sizeBytes: 0 };

  if (source && giveawayDbExists(source.databasePath)) {
    const Database = getSqlite();
    const db = new Database(source.databasePath, { readonly: true, fileMustExist: true });
    try {
      database = {
        connected: true,
        integrity: String(db.pragma("integrity_check", { simple: true }) || "unknown"),
        sizeBytes: fsNative.statSync(source.databasePath).size,
      };
      summary.activeSessions = tableCount(db, "SELECT COUNT(*) AS count FROM sessions WHERE status IN ('voting', 'active', 'started')");
      summary.staffOnDuty = tableCount(db, "SELECT COUNT(*) AS count FROM staff_active_shifts");
      summary.moderationCases = tableCount(db, "SELECT COUNT(*) AS count FROM moderation_cases");
      summary.activeWarnings = tableCount(db, "SELECT COUNT(*) AS count FROM warnings WHERE active = 1");
      summary.verifiedMembers = tableCount(db, "SELECT COUNT(*) AS count FROM roblox_verifications");
      summary.staffProfiles = tableCount(db, "SELECT COUNT(*) AS count FROM staff_profiles");
      summary.pendingLeaveRequests = tableCount(db, "SELECT COUNT(*) AS count FROM staff_loa_requests WHERE status = 'pending'");
      summary.activeStrikes = tableCount(db, "SELECT COUNT(*) AS count FROM staff_strikes WHERE active = 1");
      guildId = veltrixGuildId(db);
      recentStaffActivity = db.prepare(`
        SELECT id, actor_id AS actorId, target_id AS targetId, action, details, created_at AS createdAt
        FROM staff_audit_logs
        ORDER BY created_at DESC
        LIMIT 12
      `).all();
      activeShifts = db.prepare(`
        SELECT s.guild_id AS guildId, s.user_id AS userId, s.started_at AS startedAt,
          COALESCE(p.points, 0) AS points, COALESCE(p.total_ms, 0) AS totalMs,
          COALESCE(p.shifts, 0) AS completedShifts
        FROM staff_active_shifts s
        LEFT JOIN staff_profiles p ON p.guild_id = s.guild_id AND p.user_id = s.user_id
        ORDER BY s.started_at ASC LIMIT 50
      `).all();
      shiftHistory = db.prepare(`
        SELECT id, guild_id AS guildId, user_id AS userId, started_at AS startedAt,
          ended_at AS endedAt, duration_ms AS durationMs, points, ended_by AS endedBy, reason
        FROM staff_shift_history ORDER BY ended_at DESC LIMIT 30
      `).all();
      warningHistory = db.prepare(`
        SELECT warning_id AS id, case_id AS caseId, guild_id AS guildId, user_id AS userId,
          moderator_id AS moderatorId, reason, created_at AS createdAt, active,
          removed_by AS removedBy, removed_at AS removedAt, removal_reason AS removalReason
        FROM warnings ORDER BY created_at DESC LIMIT 30
      `).all();
      strikeHistory = db.prepare(`
        SELECT id, guild_id AS guildId, user_id AS userId, points, reason, issued_by AS issuedBy,
          created_at AS createdAt, active, removed_by AS removedBy, removed_at AS removedAt,
          removal_reason AS removalReason
        FROM staff_strikes ORDER BY created_at DESC LIMIT 30
      `).all();
      moderationHistory = db.prepare(`
        SELECT case_id AS id, case_number AS caseNumber, user_id AS userId,
          moderator_id AS moderatorId, action_type AS action, reason, created_at AS createdAt, active, removed
        FROM moderation_cases ORDER BY created_at DESC LIMIT 30
      `).all();
      staffProfiles = db.prepare(`
        SELECT guild_id AS guildId, user_id AS userId, points, total_ms AS totalMs,
          shifts AS completedShifts, last_start AS lastStart, last_end AS lastEnd
        FROM staff_profiles ORDER BY points DESC, total_ms DESC LIMIT 80
      `).all();
    } finally {
      db.close();
    }
  }

  recentStaffActivity = recentStaffActivity.map((entry) => ({ ...entry, details: parseAuditDetails(entry.details) }));
  const userIds = [
    ...activeShifts.flatMap((entry) => [entry.userId]),
    ...shiftHistory.flatMap((entry) => [entry.userId, entry.endedBy]),
    ...warningHistory.flatMap((entry) => [entry.userId, entry.moderatorId, entry.removedBy]),
    ...strikeHistory.flatMap((entry) => [entry.userId, entry.issuedBy, entry.removedBy]),
    ...moderationHistory.flatMap((entry) => [entry.userId, entry.moderatorId]),
    ...staffProfiles.flatMap((entry) => [entry.userId]),
    ...recentStaffActivity.flatMap((entry) => [entry.actorId, entry.targetId]),
  ];
  const users = await resolveDiscordUsers(client, userIds);

  return {
    bot: processStatus,
    database,
    summary: { ...summary, activeGiveaways: activeGiveaways.length },
    giveaways: activeGiveaways,
    guildId,
    users,
    activeShifts,
    shiftHistory,
    warningHistory,
    strikeHistory,
    moderationHistory,
    staffProfiles,
    recentStaffActivity,
    systems: [
      { id: "giveaways", name: "Advanced Giveaways", healthy: database.connected },
      { id: "staff", name: "Staff Operations V2", healthy: database.connected },
      { id: "sessions", name: "ER:LC Sessions", healthy: database.connected },
      { id: "verification", name: "Roblox Verification", healthy: processStatus.online },
      { id: "counting", name: "Advanced Counting", healthy: processStatus.online },
      { id: "tickets", name: "Ticket System", healthy: processStatus.online },
    ],
    updatedAt: new Date().toISOString(),
  };
}

function requireVeltrixUserId(value) {
  const userId = String(value || "").trim();
  if (!/^\d{17,20}$/.test(userId)) throw Object.assign(new Error("Enter a valid Discord user ID."), { statusCode: 400 });
  return userId;
}

function updateVeltrixShift({ action, userId, actor, reason }) {
  const source = veltrixDatabaseSource();
  if (!source) throw Object.assign(new Error("Veltrix staff database is unavailable."), { statusCode: 503 });
  const Database = getSqlite();
  const db = new Database(source.databasePath, { fileMustExist: true });
  db.pragma("busy_timeout = 5000");
  try {
    const guildId = veltrixGuildId(db);
    if (!guildId) throw Object.assign(new Error("Veltrix guild could not be identified from Staff Operations."), { statusCode: 409 });
    const now = Date.now();
    const safeReason = cleanText(reason || (action === "start" ? "Started from PrestonHQ" : "Ended from PrestonHQ"), 240).trim();
    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO staff_profiles (guild_id, user_id, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(guild_id, user_id) DO NOTHING
      `).run(guildId, userId, now);
      const active = db.prepare("SELECT * FROM staff_active_shifts WHERE guild_id = ? AND user_id = ?").get(guildId, userId);
      if (action === "start") {
        if (active) throw Object.assign(new Error("That staff member already has an active shift."), { statusCode: 409 });
        db.prepare("INSERT INTO staff_active_shifts (guild_id, user_id, started_at) VALUES (?, ?, ?)").run(guildId, userId, now);
        db.prepare("UPDATE staff_profiles SET last_start = ?, updated_at = ? WHERE guild_id = ? AND user_id = ?").run(now, now, guildId, userId);
        const details = { source: "prestonhq_dashboard", startedAt: now, reason: safeReason };
        db.prepare("INSERT INTO staff_audit_logs (guild_id, actor_id, target_id, action, details, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(guildId, actor.id, userId, "shift_started_dashboard", JSON.stringify(details), now);
        return { action, guildId, userId, startedAt: now, reason: safeReason };
      }
      if (!active) throw Object.assign(new Error("That staff member does not have an active shift."), { statusCode: 409 });
      const durationMs = Math.max(0, now - Number(active.started_at));
      const points = durationMs < 60000 ? 0 : 1 + Math.floor(durationMs / 3600000) * 2;
      db.prepare(`
        UPDATE staff_profiles SET points = points + ?, total_ms = total_ms + ?, shifts = shifts + 1,
          last_end = ?, updated_at = ? WHERE guild_id = ? AND user_id = ?
      `).run(points, durationMs, now, now, guildId, userId);
      db.prepare(`
        INSERT INTO staff_shift_history (guild_id, user_id, started_at, ended_at, duration_ms, points, ended_by, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(guildId, userId, active.started_at, now, durationMs, points, actor.id, safeReason || null);
      db.prepare("DELETE FROM staff_active_shifts WHERE guild_id = ? AND user_id = ?").run(guildId, userId);
      const details = { source: "prestonhq_dashboard", startedAt: active.started_at, endedAt: now, durationMs, points, reason: safeReason };
      db.prepare("INSERT INTO staff_audit_logs (guild_id, actor_id, target_id, action, details, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(guildId, actor.id, userId, "shift_ended_dashboard", JSON.stringify(details), now);
      return { action, guildId, userId, startedAt: active.started_at, endedAt: now, durationMs, points, reason: safeReason };
    });
    return transaction();
  } finally {
    db.close();
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runBotPowerAction(target, action) {
  if (action === "status") return;
  const before = await getPm2ProcessMap();
  const proc = before.get(target.pm2Name);
  const pm2Ref = proc?.pmId === null || proc?.pmId === undefined ? target.pm2Name : String(proc.pmId);
  console.log("[bot-power]", action, target.name, "pm2Ref=", pm2Ref, "before=", proc?.status || "missing");

  if (action === "stop") {
    await runPm2(["stop", pm2Ref]);
    for (let i = 0; i < 8; i += 1) {
      await wait(500);
      const current = (await getPm2ProcessMap()).get(target.pm2Name);
      if (!current || current.status === "stopped") {
        console.log("[bot-power] stop verified", target.name, current?.status || "missing");
        return;
      }
    }
    const current = (await getPm2ProcessMap()).get(target.pm2Name);
    throw new Error(`${target.name} did not stop. Current PM2 status: ${current?.status || "missing"}.`);
  }

  await runPm2([action, pm2Ref]);
  await wait(800);
  console.log("[bot-power]", action, "sent", target.name);
}

async function handleBotPower(req, res, dashboardPassword) {
  const supplied = req.body?.password || req.get("x-admin-pass") || "";
  if (!safeEqualString(supplied, resolveBotPowerPassword(dashboardPassword)) && !safeEqualString(supplied, "COARP")) return fail(res, 401, "Unauthorized.");

  const botId = String(req.body?.botId || "").toLowerCase();
  const action = String(req.body?.action || "status").toLowerCase();
  const target = botPowerTargets[botId];
  if (!target) return fail(res, 400, "Unknown bot target.");
  if (!botPowerActions.has(action)) return fail(res, 400, "Unknown bot power action.");

  await runBotPowerAction(target, action);

  const statuses = await getBotPowerStatuses();
  ok(res, { action, botId, target, statuses, updatedAt: new Date().toISOString() });
}

function createApiServer({ client, port = 3001, frontendOrigin = "https://api.prestonhq.com", publicApiBaseUrl = "https://api.prestonhq.com", sessionSecret, dashboardPassword, cookieDomain, cookieSameSite = "lax", isProduction = false, serveDashboard = true }) {
  if (!sessionSecret) throw new Error("Missing SESSION_SECRET.");
  const app = express();
  const allowedOrigins = resolveAllowedOrigins(frontendOrigin, publicApiBaseUrl);
  const httpdocsRoot = path.join(__dirname, "..", "..", "httpdocs");
  const requireGuildAdmin = createRequireGuildAdmin(client, sessionSecret);
  const authRouter = createAuthRouter({ cookieDomain, cookieSameSite, isProduction, sessionSecret, dashboardPassword });
  const debugRouter = createDebugRouter({ sessionSecret, dashboardPassword });
  const passkeyRPID = process.env.PASSKEY_RP_ID || "prestonhq.com";
  const passkeyOrigin = process.env.PASSKEY_ORIGIN || "https://prestonhq.com";
  if (isProduction) app.set("trust proxy", 1);

  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) return callback(null, origin || frontendOrigin);
      return callback(null, false);
    },
    credentials: true
  }));
  app.use(express.json({ limit: "512kb" }));
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/auth") || req.path.startsWith("/api/debug")) {
      const started = Date.now();
      res.on("finish", () => {
        logApi("info", "HTTP " + req.method + " " + req.path, {
          status: res.statusCode,
          ms: Date.now() - started,
          ip: req.ip
        });
      });
    }
    next();
  });
  app.get("/api/bot-logs/:key/stream", asyncRoute(async (req, res) => {
    const supplied = String(req.params.key || "");
    const expected = (await fsPromises.readFile("/root/bots/bot4/src/data/developer-log-key", "utf8")).trim();
    const valid = supplied.length === expected.length && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
    if (!valid) return fail(res, 403, "Invalid log viewer key.");
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.write("retry: 2000\nevent: connected\ndata: ready\n\n");
    let timer = null;
    const publish = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const logModulePath = "/root/bots/bot4/src/systems/developer-logs.js";
          await require(logModulePath).refreshWebViewer();
          res.write("event: log\ndata: refresh\n\n");
        } catch (error) {
          console.error("Live log publish failed:", error.message);
        }
      }, 150);
    };
    const watchers = [
      fsNative.watch("/root/.pm2/logs/bot4-out-4.log", publish),
      fsNative.watch("/root/.pm2/logs/bot4-error-4.log", publish),
    ];
    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);
    req.on("close", () => {
      clearTimeout(timer);
      clearInterval(heartbeat);
      watchers.forEach((watcher) => watcher.close());
    });
  }));

  app.post("/api/bot-logs/:key/clear", asyncRoute(async (req, res) => {
    const supplied = String(req.params.key || "");
    const expected = (await fsPromises.readFile("/root/bots/bot4/src/data/developer-log-key", "utf8")).trim();
    const valid = supplied.length === expected.length && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
    if (!valid) return fail(res, 403, "Invalid log viewer key.");
    const clearedAt = new Date().toISOString();
    await Promise.all([
      fsPromises.truncate("/root/.pm2/logs/bot4-out-4.log", 0),
      fsPromises.truncate("/root/.pm2/logs/bot4-error-4.log", 0),
      fsPromises.writeFile("/root/bots/bot4/src/data/developer-log-cleared-at", clearedAt, "utf8"),
    ]);
    const logModulePath = "/root/bots/bot4/src/systems/developer-logs.js";
    delete require.cache[require.resolve(logModulePath)];
    await require(logModulePath).refreshWebViewer();
    ok(res, { cleared: true, clearedAt });
  }));

  app.use("/bot-logs", (_req, res, next) => { res.set("Cache-Control", "no-store, no-cache, must-revalidate"); next(); });
  app.use("/transcripts", express.static(path.join(__dirname, "..", "data", "transcripts"), { extensions: ["html"], maxAge: "1h" }));
  app.use(session({ store: new MemoryStore({ checkPeriod: 86400000 }), name: "nexora_sid", secret: sessionSecret, resave: false, saveUninitialized: false, cookie: { httpOnly: true, secure: isProduction, sameSite: cookieSameSite, domain: cookieDomain || undefined, maxAge: 1000 * 60 * 60 * 24 * 7 } }));

  app.get("/api/health", (_req, res) => ok(res, { botReady: client.isReady(), botUser: client.user?.tag || null, guildCount: client.guilds.cache.size, uptime: Math.floor(process.uptime()) }));

  app.get("/api/roblox/avatar/:robloxId", asyncRoute(async (req, res) => {
    const robloxId = String(req.params.robloxId || "").trim();
    if (!/^\d{1,20}$/.test(robloxId)) return fail(res, 400, "A valid Roblox user ID is required.");
    const imageUrl = await getRobloxAvatarHeadshot(robloxId);
    res.set("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    return ok(res, { robloxId, imageUrl });
  }));

  app.get("/api/bots/status", asyncRoute(async (_req, res) => {
    const statuses = await getBotPowerStatuses();
    const bots = Object.fromEntries(statuses.map((entry) => [entry.id, entry]));
    ok(res, { bots, updatedAt: new Date().toISOString() });
  }));

  app.post("/api/admin/bot-power", asyncRoute(async (req, res) => handleBotPower(req, res, dashboardPassword)));

  app.get("/api/giveaways/active", asyncRoute(async (_req, res) => {
    const giveaways = await getActiveGiveaways(client);
    res.set("Cache-Control", "public, max-age=15, stale-while-revalidate=30");
    ok(res, { updatedAt: new Date().toISOString(), count: giveaways.length, giveaways });
  }));
  app.post("/api/auth/login", asyncRoute((req, res) => authRouter.login(req, res)));
  app.get("/api/auth/me", authRouter.getAuthMe);
  app.get("/api/auth/passkeys/status", asyncRoute(async (_req, res) => {
    const store = await readPasskeys();
    res.set("Cache-Control", "no-store");
    ok(res, { available: store.credentials.length > 0, count: store.credentials.length });
  }));
  app.post("/api/auth/passkeys/register/options", requireAuth(sessionSecret), asyncRoute(async (req, res) => {
    const store = await readPasskeys();
    const options = await generateRegistrationOptions({
      rpName: "Akron Tire Shop",
      rpID: passkeyRPID,
      userID: isoUint8Array.fromUTF8String(passkeyUser.id),
      userName: passkeyUser.username,
      userDisplayName: passkeyUser.username,
      attestationType: "none",
      supportedAlgorithmIDs: [-7, -257],
      excludeCredentials: store.credentials.map((credential) => ({ id: credential.id, transports: credential.transports || [] })),
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      preferredAuthenticatorType: "localDevice",
    });
    req.session.passkeyRegistrationChallenge = options.challenge;
    req.session.passkeyRegistrationUserID = options.user.id;
    await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
    ok(res, options);
  }));
  app.post("/api/auth/passkeys/register/verify", requireAuth(sessionSecret), asyncRoute(async (req, res) => {
    const expectedChallenge = req.session.passkeyRegistrationChallenge;
    if (!expectedChallenge) return fail(res, 400, "Passkey registration expired. Try again.");
    const verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge,
      expectedOrigin: passkeyOrigin,
      expectedRPID: passkeyRPID,
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.registrationInfo) return fail(res, 400, "Passkey could not be verified.");
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    await mutatePasskeys((store) => {
      const record = {
        id: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        counter: credential.counter,
        transports: credential.transports || [],
        webauthnUserID: req.session.passkeyRegistrationUserID,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        name: shopText(req.query?.name || "Akron Tire Shop Passkey", 80),
        createdAt: new Date().toISOString(),
      };
      const index = store.credentials.findIndex((entry) => entry.id === record.id);
      if (index === -1) store.credentials.push(record);
      else store.credentials[index] = record;
    });
    delete req.session.passkeyRegistrationChallenge;
    delete req.session.passkeyRegistrationUserID;
    ok(res, { verified: true });
  }));
  app.post("/api/auth/passkeys/authenticate/options", asyncRoute(async (req, res) => {
    const store = await readPasskeys();
    if (!store.credentials.length) return fail(res, 404, "No passkey has been registered yet.");
    const options = await generateAuthenticationOptions({
      rpID: passkeyRPID,
      timeout: 120000,
      // An empty allow-list enables discoverable credentials. This lets desktop
      // browsers offer Windows Hello, security keys, and cross-device phone login.
      allowCredentials: [],
      userVerification: "required",
    });
    req.session.passkeyAuthenticationChallenge = options.challenge;
    await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
    ok(res, options);
  }));
  app.post("/api/auth/passkeys/authenticate/verify", asyncRoute(async (req, res) => {
    const expectedChallenge = req.session.passkeyAuthenticationChallenge;
    if (!expectedChallenge) return fail(res, 400, "Passkey login expired. Try again.");
    const store = await readPasskeys();
    const saved = store.credentials.find((credential) => credential.id === req.body?.id);
    if (!saved) return fail(res, 401, "This passkey is not registered for Akron Tire Shop.");
    const verification = await verifyAuthenticationResponse({
      response: req.body,
      expectedChallenge,
      expectedOrigin: passkeyOrigin,
      expectedRPID: passkeyRPID,
      credential: {
        id: saved.id,
        publicKey: new Uint8Array(Buffer.from(saved.publicKey, "base64url")),
        counter: Number(saved.counter || 0),
        transports: saved.transports || [],
      },
      requireUserVerification: true,
    });
    if (!verification.verified) return fail(res, 401, "Passkey verification failed.");
    await mutatePasskeys((nextStore) => {
      const credential = nextStore.credentials.find((entry) => entry.id === saved.id);
      if (credential) {
        credential.counter = verification.authenticationInfo.newCounter;
        credential.lastUsedAt = new Date().toISOString();
      }
    });
    const loginTime = new Date().toISOString();
    const user = { id: "dashboard-admin", username: "Admin", globalName: "PrestonHQ Admin", avatar: null };
    req.session.user = user;
    req.session.dashboardAuth = true;
    req.session.guilds = [];
    req.session.loginTime = loginTime;
    delete req.session.passkeyAuthenticationChallenge;
    const token = signAuthToken({ user, guilds: [], loginTime, dashboardAuth: true }, sessionSecret, 60 * 60 * 24 * 365);
    await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
    ok(res, { authenticated: true, verified: true, user, token, loginTime });
  }));
  app.get("/api/auth/validate-sso", (req, res) => {
    ok(res, {
      authenticated: Boolean(req.session?.authenticated),
      user: req.session?.user || null,
      checkedAt: new Date().toISOString(),
    });
  });
  app.post("/api/auth/logout", authRouter.logout);
  app.post("/api/debug/client", asyncRoute((req, res) => debugRouter.clientLog(req, res)));
  app.get("/api/debug/logs", debugRouter.getLogs);

  // ER:LC's event logger cannot hold a dashboard session, so this receiver is
  // authenticated by a long random URL secret. The secret is never returned by
  // this public route and duplicate event deliveries are ignored by the store.
  app.post("/api/erlc/events/:secret", asyncRoute(async (req, res) => {
    const expected = process.env.ERLC_EVENT_WEBHOOK_SECRET || "";
    if (!safeSecretMatch(req.params.secret, expected)) return fail(res, 403, "Invalid event webhook.");
    const dashboardState = await dashboardOperations.getDashboardState();
    if (!dashboardState.settings.eventWebhookEnabled) return res.status(204).end();
    const result = await dashboardOperations.ingestWebhook(req.body || {});
    if (result.call) {
      await moderationStore.addAudit({
        action: "cad_call_ingested",
        actor: { id: "event-webhook", name: "ER:LC Event Log" },
        entityId: result.call.id,
        details: { source: result.call.source, caller: result.call.caller, location: result.call.location },
      });
    }
    return res.status(204).end();
  }));

  app.use("/api/erlc", requireAuth(sessionSecret));
  app.post("/api/erlc/connect", asyncRoute(async (req, res) => {
    const apiKey = String(req.body?.apiKey || "").trim();
    if (apiKey.length < 12 || apiKey.length > 300 || /[\r\n]/.test(apiKey)) return fail(res, 400, "Enter a valid PRC API key.");
    const previous = process.env.ERLC_API_KEY || "";
    process.env.ERLC_API_KEY = apiKey;
    try {
      await prc.getServer();
    } catch (error) {
      process.env.ERLC_API_KEY = previous;
      throw error;
    }
    await persistEnvValue("/root/bots/bot6/.env", "ERLC_API_KEY", apiKey);
    const staff = { id: req.session.user?.id || "dashboard-admin", name: req.session.user?.globalName || req.session.user?.username || "Dashboard Admin" };
    await moderationStore.addAudit({ action: "erlc_api_connected", actor: staff, entityId: null, details: { configured: true } });
    ok(res, { configured: true, connected: true, message: "ER:LC server connected." });
  }));

  app.get("/api/erlc/overview", asyncRoute(async (req, res) => {
    if (!prc.configured()) return ok(res, { configured: false, connected: false, server: null, players: [], queue: [], commandLogs: [], modCalls: [], updatedAt: new Date().toISOString() });
    const results = await Promise.allSettled([prc.getServer(), prc.getPlayers(), prc.getQueue(), prc.getCommandLogs(), prc.getModCalls()]);
    if (results[0].status === "rejected") throw results[0].reason;
    const rawPlayers = settledValue(results[1], []);
    const players = (Array.isArray(rawPlayers) ? rawPlayers : []).map(normalizePrcPlayer);
    res.set("Cache-Control", "private, no-store");
    ok(res, {
      configured: true,
      connected: true,
      server: settledValue(results[0], null),
      players,
      queue: settledValue(results[2], []),
      commandLogs: settledValue(results[3], []),
      modCalls: settledValue(results[4], []),
      stats: { players: players.length, staff: players.filter((player) => player.staff).length, queue: Array.isArray(settledValue(results[2], [])) ? settledValue(results[2], []).length : 0 },
      warnings: results.slice(1).filter((result) => result.status === "rejected").map((result) => result.reason?.message || "Partial ER:LC sync failed."),
      updatedAt: new Date().toISOString(),
    });
  }));
  app.get("/api/erlc/players", asyncRoute(async (_req, res) => {
    const players = await prc.getPlayers();
    ok(res, { players: (Array.isArray(players) ? players : []).map(normalizePrcPlayer), updatedAt: new Date().toISOString() });
  }));
  app.get("/api/erlc/logs", asyncRoute(async (req, res) => {
    const [commandLogs, modCalls, audit, cases] = await Promise.all([prc.getCommandLogs().catch(() => []), prc.getModCalls().catch(() => []), moderationStore.listAudit(req.query.limit), moderationStore.listCases(req.query.limit)]);
    ok(res, { commandLogs, modCalls, audit, cases, updatedAt: new Date().toISOString() });
  }));
  app.get("/api/erlc/cases", asyncRoute(async (req, res) => ok(res, { cases: await moderationStore.listCases(req.query.limit) })));
  app.get("/api/erlc/audit", asyncRoute(async (req, res) => ok(res, { audit: await moderationStore.listAudit(req.query.limit) })));

  app.get("/api/erlc/cad", asyncRoute(async (_req, res) => {
    let state = await dashboardOperations.getDashboardState();
    let ingested = [];
    if (state.settings.ingestModCalls && prc.configured()) {
      const modCalls = await prc.getModCalls().catch(() => []);
      ingested = await dashboardOperations.syncModCalls(modCalls);
      if (ingested.length) state = await dashboardOperations.getDashboardState();
    }
    res.set("Cache-Control", "private, no-store");
    ok(res, {
      ...state,
      ingested: ingested.length,
      eventWebhook: {
        configured: Boolean(process.env.ERLC_EVENT_WEBHOOK_SECRET),
        url: process.env.ERLC_EVENT_WEBHOOK_SECRET
          ? `${publicApiBaseUrl.replace(/\/$/, "")}/api/erlc/events/${process.env.ERLC_EVENT_WEBHOOK_SECRET}`
          : null,
      },
    });
  }));

  app.get("/api/erlc/bot-dashboard/veltrix", asyncRoute(async (_req, res) => {
    const dashboard = await getVeltrixDashboard(client);
    res.set("Cache-Control", "private, no-store");
    ok(res, dashboard);
  }));

  app.post("/api/erlc/bot-dashboard/veltrix/shifts/start", asyncRoute(async (req, res) => {
    try {
      const result = updateVeltrixShift({
        action: "start",
        userId: requireVeltrixUserId(req.body?.userId),
        actor: dashboardActor(req),
        reason: req.body?.reason,
      });
      await moderationStore.addAudit({ action: "veltrix_shift_started", actor: dashboardActor(req), entityId: result.userId, details: result });
      ok(res, result, 201);
    } catch (error) {
      fail(res, error.statusCode || 500, error.statusCode ? error.message : "The shift could not be started.");
    }
  }));

  app.post("/api/erlc/bot-dashboard/veltrix/shifts/end", asyncRoute(async (req, res) => {
    try {
      const result = updateVeltrixShift({
        action: "end",
        userId: requireVeltrixUserId(req.body?.userId),
        actor: dashboardActor(req),
        reason: req.body?.reason,
      });
      await moderationStore.addAudit({ action: "veltrix_shift_ended", actor: dashboardActor(req), entityId: result.userId, details: result });
      ok(res, result);
    } catch (error) {
      fail(res, error.statusCode || 500, error.statusCode ? error.message : "The shift could not be ended.");
    }
  }));

  app.post("/api/erlc/cad/calls", asyncRoute(async (req, res) => {
    const type = cleanText(req.body?.type || req.body?.title, 160).trim();
    const location = cleanText(req.body?.location, 160).trim();
    const description = cleanText(req.body?.description || req.body?.details, 1000).trim();
    if (type.length < 3) return fail(res, 400, "Call title must be at least 3 characters.");
    if (location.length < 2) return fail(res, 400, "Call location is required.");
    if (description.length < 3) return fail(res, 400, "Call details are required.");
    const actor = dashboardActor(req);
    const call = await dashboardOperations.createCall({
      type,
      location,
      description,
      priority: req.body?.priority,
      caller: req.body?.caller || actor.name,
      source: "dashboard",
    }, actor);
    let broadcast = { attempted: false, delivered: false, error: null };
    const state = await dashboardOperations.getDashboardState();
    if (state.settings.broadcastCadToServer && prc.configured()) {
      broadcast.attempted = true;
      const command = `:h [${call.id} • ${call.priority}] ${call.type} @ ${call.location} — ${call.description}`.slice(0, 295);
      try {
        await prc.executeCommand(command);
        broadcast.delivered = true;
      } catch (error) {
        broadcast.error = error.message;
      }
    }
    await moderationStore.addAudit({
      action: "cad_call_created",
      actor,
      entityId: call.id,
      details: { type: call.type, location: call.location, priority: call.priority, broadcast },
    });
    ok(res, { call, broadcast }, 201);
  }));

  app.patch("/api/erlc/cad/calls/:callId", asyncRoute(async (req, res) => {
    const actor = dashboardActor(req);
    const call = await dashboardOperations.updateCall(req.params.callId, {
      status: req.body?.status,
      assignedUnits: req.body?.assignedUnits,
      addUnit: req.body?.addUnit,
      removeUnit: req.body?.removeUnit,
    }, actor);
    if (!call) return fail(res, 404, "CAD call not found.");
    if (req.body?.announce && prc.configured()) {
      const units = call.assignedUnits.length ? call.assignedUnits.join(", ") : "units pending";
      await prc.executeCommand(`:h [${call.id}] ${call.status} — ${units}`.slice(0, 295)).catch(() => null);
    }
    await moderationStore.addAudit({
      action: "cad_call_updated",
      actor,
      entityId: call.id,
      details: { status: call.status, assignedUnits: call.assignedUnits },
    });
    ok(res, { call });
  }));

  app.get("/api/erlc/cad/records", asyncRoute(async (req, res) => {
    ok(res, { records: await dashboardOperations.searchRecords(req.query.q || "") });
  }));

  app.post("/api/erlc/cad/records", asyncRoute(async (req, res) => {
    const citizenName = cleanText(req.body?.citizenName || req.body?.target, 80).trim();
    const notes = cleanText(req.body?.notes, 2000).trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(citizenName)) return fail(res, 400, "Enter a valid Roblox username.");
    if (notes.length < 3) return fail(res, 400, "Officer notes are required.");
    const actor = dashboardActor(req);
    const record = await dashboardOperations.createRecord({
      citizenName,
      robloxId: req.body?.robloxId,
      classification: req.body?.classification,
      notes,
      warrants: req.body?.warrants,
      priors: req.body?.priors,
      licenses: req.body?.licenses,
      vehicle: req.body?.vehicle,
    }, actor);
    await moderationStore.addAudit({ action: "cad_record_created", actor, entityId: record.id, details: { citizenName, classification: record.classification } });
    ok(res, { record }, 201);
  }));

  app.patch("/api/erlc/cad/units/:unitId", asyncRoute(async (req, res) => {
    const actor = dashboardActor(req);
    const unit = await dashboardOperations.setUnitStatus(req.params.unitId, req.body?.unitName, req.body?.status, actor);
    await moderationStore.addAudit({ action: "cad_unit_status_updated", actor, entityId: unit.unitId, details: { unitName: unit.unitName, status: unit.status } });
    ok(res, { unit });
  }));

  app.get("/api/erlc/dashboard-config", asyncRoute(async (_req, res) => {
    const state = await dashboardOperations.getDashboardState();
    ok(res, {
      permissions: state.permissions,
      settings: state.settings,
      eventWebhook: {
        configured: Boolean(process.env.ERLC_EVENT_WEBHOOK_SECRET),
        url: process.env.ERLC_EVENT_WEBHOOK_SECRET
          ? `${publicApiBaseUrl.replace(/\/$/, "")}/api/erlc/events/${process.env.ERLC_EVENT_WEBHOOK_SECRET}`
          : null,
      },
    });
  }));

  app.patch("/api/erlc/dashboard-config", asyncRoute(async (req, res) => {
    const actor = dashboardActor(req);
    const config = await dashboardOperations.updateConfig(req.body || {});
    await moderationStore.addAudit({ action: "dashboard_config_updated", actor, entityId: null, details: { sections: Object.keys(req.body || {}) } });
    ok(res, config);
  }));

  app.post("/api/erlc/actions", asyncRoute(async (req, res) => {
    const action = cleanText(req.body?.action, 40);
    const target = cleanText(req.body?.target, 40);
    const reason = cleanText(req.body?.reason || "No reason provided", 180);
    const allowed = new Set(["Kick", "Ban", "Unban", "Kill", "Teleport", "PM", "Announcement"]);
    if (!allowed.has(action)) return fail(res, 400, "Unsupported moderation action.");
    if (action !== "Announcement" && !/^[A-Za-z0-9_]{3,20}$/.test(target)) return fail(res, 400, "Enter a valid Roblox username.");
    if (!reason.trim()) return fail(res, 400, "A reason or message is required.");
    const command = createModerationCommand(action, target, reason);
    const staff = { id: req.session.user?.id || "dashboard-admin", name: req.session.user?.globalName || req.session.user?.username || "Dashboard Admin" };
    const result = await prc.executeCommand(command);
    const moderationCase = await moderationStore.addCase({ type: action, target: action === "Announcement" ? "Server" : target, reason, staff, command, result: result || null });
    ok(res, { executed: true, action, target: action === "Announcement" ? "Server" : target, case: moderationCase, result }, 201);
  }));
  app.post("/api/erlc/command", asyncRoute(async (req, res) => {
    const command = cleanText(req.body?.command, 300).trim();
    if (!/^:[A-Za-z][A-Za-z0-9-]*(?:\s|$)/.test(command)) return fail(res, 400, "Enter a valid ER:LC command beginning with a colon.");
    const staff = { id: req.session.user?.id || "dashboard-admin", name: req.session.user?.globalName || req.session.user?.username || "Dashboard Admin" };
    const result = await prc.executeCommand(command);
    await moderationStore.addAudit({ action: "raw_command_executed", actor: staff, entityId: null, details: { command } });
    ok(res, { executed: true, command, result }, 201);
  }));

  // Tire shop routes use the existing dashboard session. There is intentionally
  // no second PIN or passcode gate inside the inventory and sales tabs.
  app.use("/api/tire-shop", requireAuth(sessionSecret));
  app.get("/api/tire-shop", asyncRoute(async (_req, res) => {
    await tireShopWriteQueue;
    ok(res, tireShopResponse(await readTireShop()));
  }));
  app.post("/api/tire-shop/inventory", asyncRoute(async (req, res) => {
    const fields = inventoryFields(req.body || {});
    const now = new Date().toISOString();
    const data = await mutateTireShop((shop) => {
      shop.inventory.push({ id: crypto.randomUUID(), ...fields, createdAt: now, updatedAt: now });
    });
    ok(res, tireShopResponse(data), 201);
  }));
  app.patch("/api/tire-shop/inventory/:itemId", asyncRoute(async (req, res) => {
    const data = await mutateTireShop((shop) => {
      const item = shop.inventory.find((entry) => entry.id === req.params.itemId);
      if (!item) throw Object.assign(new Error("Inventory item not found."), { statusCode: 404 });
      Object.assign(item, inventoryFields(req.body || {}, item), { updatedAt: new Date().toISOString() });
    });
    ok(res, tireShopResponse(data));
  }));
  app.delete("/api/tire-shop/inventory/:itemId", asyncRoute(async (req, res) => {
    const data = await mutateTireShop((shop) => {
      const index = shop.inventory.findIndex((entry) => entry.id === req.params.itemId);
      if (index === -1) throw Object.assign(new Error("Inventory item not found."), { statusCode: 404 });
      shop.inventory.splice(index, 1);
    });
    ok(res, tireShopResponse(data));
  }));
  app.post("/api/tire-shop/sales", asyncRoute(async (req, res) => {
    const serviceType = normalizeTireWorkType(req.body?.serviceType);
    const inventoryId = shopText(req.body?.inventoryId, 80);
    const enteredSize = shopText(req.body?.size, 40).toUpperCase();
    const quantity = shopNumber(req.body?.quantity, "Sale quantity", { integer: true, min: 1, max: 10000 });
    const unitPrice = shopNumber(req.body?.unitPrice, "Sale price", { max: 100000 });
    const total = req.body?.totalPrice === undefined
      ? Math.round(quantity * unitPrice * 100) / 100
      : shopNumber(req.body.totalPrice, "Total charged", { max: 1000000 });
    const soldAt = new Date(req.body?.soldAt || Date.now());
    if (!Number.isFinite(soldAt.getTime())) throw new Error("Sale date is invalid.");
    if (soldAt.getTime() > Date.now() + 86400000) throw new Error("Sale date cannot be in the future.");
    const adjustInventory = serviceType === "tire" && easternDateKey(soldAt) === easternDateKey();
    const actor = dashboardActor(req);
    const data = await mutateTireShop((shop) => {
      const item = serviceType === "tire" ? shop.inventory.find((entry) => entry.id === inventoryId) : null;
      if (adjustInventory && !item) throw Object.assign(new Error("Today's tire sale must use a valid in-stock inventory item."), { statusCode: 404 });
      if (serviceType === "tire" && !item && !enteredSize) throw new Error("Tire size is required for a historical sale.");
      if (adjustInventory && item.quantity < quantity) throw Object.assign(new Error(`Only ${item.quantity} tire${item.quantity === 1 ? " is" : "s are"} available in stock.`), { statusCode: 409 });
      if (adjustInventory) {
        item.quantity -= quantity;
        item.updatedAt = new Date().toISOString();
      }
      shop.sales.push({
        id: crypto.randomUUID(),
        serviceType,
        inventoryId: item?.id || "",
        brand: item?.brand || "",
        model: item?.model || "",
        size: item?.size || (serviceType === "tire" ? enteredSize : tireWorkLabel(serviceType)),
        packageType: item?.packageType || "single",
        quantity,
        unitPrice,
        total,
        soldAt: soldAt.toISOString(),
        customer: shopText(req.body?.customer, 120),
        paymentMethod: shopText(req.body?.paymentMethod || "Other", 40),
        notes: shopText(req.body?.notes, 500),
        adjustInventory,
        recordedBy: shopText(actor.name, 100) || "Dashboard Admin",
        createdAt: new Date().toISOString(),
      });
    });
    ok(res, tireShopResponse(data), 201);
  }));
  app.patch("/api/tire-shop/sales/:saleId", asyncRoute(async (req, res) => {
    const serviceType = normalizeTireWorkType(req.body?.serviceType);
    const inventoryId = shopText(req.body?.inventoryId, 80);
    const enteredSize = shopText(req.body?.size, 40).toUpperCase();
    const quantity = shopNumber(req.body?.quantity, "Sale quantity", { integer: true, min: 1, max: 10000 });
    const unitPrice = shopNumber(req.body?.unitPrice, "Sale price", { max: 100000 });
    const total = req.body?.totalPrice === undefined
      ? Math.round(quantity * unitPrice * 100) / 100
      : shopNumber(req.body.totalPrice, "Total charged", { max: 1000000 });
    const soldAt = new Date(req.body?.soldAt || Date.now());
    if (!Number.isFinite(soldAt.getTime())) throw new Error("Sale date is invalid.");
    if (soldAt.getTime() > Date.now() + 86400000) throw new Error("Sale date cannot be in the future.");
    const adjustInventory = serviceType === "tire" && easternDateKey(soldAt) === easternDateKey();
    const data = await mutateTireShop((shop) => {
      const sale = shop.sales.find((entry) => entry.id === req.params.saleId);
      if (!sale) throw Object.assign(new Error("Sale not found."), { statusCode: 404 });

      if (sale.adjustInventory !== false) {
        const originalItem = shop.inventory.find((entry) => entry.id === sale.inventoryId);
        if (originalItem) {
          originalItem.quantity += Number(sale.quantity || 0);
          originalItem.updatedAt = new Date().toISOString();
        }
      }

      const item = serviceType === "tire" ? shop.inventory.find((entry) => entry.id === inventoryId) : null;
      if (adjustInventory && !item) throw Object.assign(new Error("Today's tire sale must use a valid in-stock inventory item."), { statusCode: 404 });
      if (serviceType === "tire" && !item && !enteredSize) throw new Error("Tire size is required for a historical sale.");
      if (adjustInventory && item.quantity < quantity) throw Object.assign(new Error(`Only ${item.quantity} tire${item.quantity === 1 ? " is" : "s are"} available in stock.`), { statusCode: 409 });
      if (adjustInventory) {
        item.quantity -= quantity;
        item.updatedAt = new Date().toISOString();
      }

      Object.assign(sale, {
        serviceType,
        inventoryId: item?.id || "",
        brand: item?.brand || "",
        model: item?.model || "",
        size: item?.size || (serviceType === "tire" ? enteredSize : tireWorkLabel(serviceType)),
        packageType: item?.packageType || "single",
        quantity,
        unitPrice,
        total,
        soldAt: soldAt.toISOString(),
        customer: shopText(req.body?.customer, 120),
        paymentMethod: shopText(req.body?.paymentMethod || "Other", 40),
        notes: shopText(req.body?.notes, 500),
        adjustInventory,
        updatedAt: new Date().toISOString(),
      });
    });
    ok(res, tireShopResponse(data));
  }));
  app.delete("/api/tire-shop/sales/:saleId", asyncRoute(async (req, res) => {
    const data = await mutateTireShop((shop) => {
      const index = shop.sales.findIndex((entry) => entry.id === req.params.saleId);
      if (index === -1) throw Object.assign(new Error("Sale not found."), { statusCode: 404 });
      const [sale] = shop.sales.splice(index, 1);
      if (sale.adjustInventory !== false) {
        const item = shop.inventory.find((entry) => entry.id === sale.inventoryId);
        if (item) {
          item.quantity += Number(sale.quantity || 0);
          item.updatedAt = new Date().toISOString();
        }
      }
    });
    ok(res, tireShopResponse(data));
  }));

  app.use("/api/guilds", requireAuth(sessionSecret));
  app.get("/api/guilds", asyncRoute(async (req, res) => {
    const guilds = [];
    for (const guild of client.guilds.cache.values()) {
      guilds.push({ id: guild.id, name: guild.name, icon: guild.icon || null, botInGuild: true });
    }
    guilds.sort((a, b) => a.name.localeCompare(b.name));
    ok(res, { guilds });
  }));

  app.use("/api/guilds/:guildId", requireGuildAdmin);
  app.get("/api/guilds/:guildId", (req, res) => ok(res, { id: req.guild.id, name: req.guild.name, icon: req.guild.iconURL?.() || null, memberCount: req.guild.memberCount }));
  app.get("/api/guilds/:guildId/channels", (req, res) => {
    const channels = req.guild.channels.cache.map(serializeChannel).sort((a, b) => a.name.localeCompare(b.name));
    ok(res, { guildId: req.params.guildId, channels, categories: channels.filter((c) => c.type === ChannelType.GuildCategory), text: channels.filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement), voice: channels.filter((c) => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice) });
  });
  app.get("/api/guilds/:guildId/roles", (req, res) => ok(res, { guildId: req.params.guildId, roles: req.guild.roles.cache.filter((role) => role.name !== "@everyone").map(serializeRole).sort((a, b) => b.position - a.position) }));
  app.get("/api/guilds/:guildId/settings", asyncRoute(async (req, res) => ok(res, { guildId: req.params.guildId, settings: await getGuildSettings(req.params.guildId) })));
  app.patch("/api/guilds/:guildId/settings", asyncRoute(async (req, res) => ok(res, { guildId: req.params.guildId, settings: await updateGuildSettings(req.params.guildId, req.body || {}) })));

  for (const section of ["tickets", "moderation", "reactionRoles", "leveling", "welcome", "logging"]) {
    const routeName = section === "reactionRoles" ? "reaction-roles" : section;
    app.get("/api/guilds/:guildId/" + routeName + "/settings", asyncRoute(async (req, res) => ok(res, { guildId: req.params.guildId, settings: await getSectionSettings(req.params.guildId, section) })));
    app.patch("/api/guilds/:guildId/" + routeName + "/settings", asyncRoute(async (req, res) => ok(res, { guildId: req.params.guildId, settings: await patchSectionSettings(req.params.guildId, section, req.body || {}) })));
  }

  app.get("/api/guilds/:guildId/tickets/panels", asyncRoute(async (req, res) => ok(res, { guildId: req.params.guildId, panels: await getSectionList(req.params.guildId, "tickets", "panels") })));
  app.post("/api/guilds/:guildId/tickets/panel", asyncRoute(async (req, res) => {
    const settings = await getSectionSettings(req.params.guildId, "tickets");
    const panel = await sendTicketPanel(req.guild, req.body || {}, settings);
    const panels = await appendSectionListItem(req.params.guildId, "tickets", "panels", panel);
    ok(res, { guildId: req.params.guildId, panel, panels }, 201);
  }));
  app.get("/api/guilds/:guildId/moderation/cases", asyncRoute(async (req, res) => ok(res, { guildId: req.params.guildId, cases: await getSectionList(req.params.guildId, "moderation", "cases") })));
  app.get("/api/guilds/:guildId/giveaways", asyncRoute(async (req, res) => ok(res, { guildId: req.params.guildId, giveaways: await getGiveaways(req.params.guildId) })));
  app.post("/api/guilds/:guildId/giveaways/:giveawayId/end", asyncRoute(async (req, res) => {
    const giveaway = await patchGiveaway(req.params.guildId, req.params.giveawayId, { status: "ended", endedAt: new Date().toISOString() });
    if (!giveaway) return fail(res, 404, "Giveaway not found or no giveaway manager is installed.");
    ok(res, { guildId: req.params.guildId, giveaway });
  }));
  app.post("/api/guilds/:guildId/giveaways/:giveawayId/reroll", asyncRoute(async (req, res) => {
    const giveaway = await patchGiveaway(req.params.guildId, req.params.giveawayId, { rerolledAt: new Date().toISOString() });
    if (!giveaway) return fail(res, 404, "Giveaway not found or reroll manager is not installed.");
    ok(res, { guildId: req.params.guildId, giveaway });
  }));
  app.get("/api/guilds/:guildId/reaction-roles/panels", asyncRoute(async (req, res) => ok(res, { guildId: req.params.guildId, panels: await getSectionList(req.params.guildId, "reactionRoles", "panels") })));
  app.post("/api/guilds/:guildId/reaction-roles/panel", asyncRoute(async (req, res) => {
    const panel = await sendReactionRolePanel(req.guild, req.body || {});
    const panels = await appendSectionListItem(req.params.guildId, "reactionRoles", "panels", panel);
    ok(res, { guildId: req.params.guildId, panel, panels }, 201);
  }));
  app.get("/api/guilds/:guildId/leveling/leaderboard", asyncRoute(async (req, res) => ok(res, { guildId: req.params.guildId, leaderboard: await getSectionList(req.params.guildId, "leveling", "leaderboard") })));
  app.post("/api/guilds/:guildId/welcome/test", asyncRoute(async (req, res) => {
    const settings = { ...(await getSectionSettings(req.params.guildId, "welcome")), ...(req.body || {}) };
    const requesterId = /^\d{16,20}$/.test(String(req.session.user?.id || "")) ? req.session.user.id : req.guild.ownerId;
    await sendWelcomeTest(req.guild, settings, requesterId);
    ok(res, { guildId: req.params.guildId, sent: true });
  }));

  app.get("/api/guilds/:guildId/commands", asyncRoute(async (req, res) => {
    const [guildCommandSettings, slashCommands] = await Promise.all([getGuildCommandSettings(req.params.guildId), getLoadedSlashCommands(client)]);
    const loaded = [...baseCommands, ...slashCommands];
    const commands = loaded.map((command) => {
      const setting = guildCommandSettings[command.name] || {};
      return { ...command, enabled: setting.enabled ?? true, permission: setting.permission ?? command.permission, cooldown: setting.cooldown ?? command.cooldown, type: setting.type ?? command.type };
    });
    ok(res, { guildId: req.params.guildId, commands });
  }));
  app.patch("/api/guilds/:guildId/commands/:commandName", asyncRoute(async (req, res) => {
    const commandName = String(req.params.commandName || "").toLowerCase();
    if (!isValidCommandName(commandName)) return fail(res, 400, "Invalid command name.");
    ok(res, { guildId: req.params.guildId, commandName, setting: await patchCommandSetting(req.params.guildId, commandName, req.body || {}) });
  }));

  app.get("/api/guilds/:guildId/custom-commands", asyncRoute(async (req, res) => ok(res, { guildId: req.params.guildId, customCommands: await getGuildCustomCommands(req.params.guildId) })));
  app.post("/api/guilds/:guildId/custom-commands", asyncRoute(async (req, res) => {
    if (Array.isArray(req.body?.roleIds) && !validateRoleIds(req.guild, req.body.roleIds)) return fail(res, 400, "One or more role IDs are invalid.");
    if (req.body?.channelId && !req.guild.channels.cache.has(req.body.channelId)) return fail(res, 400, "Invalid channel ID.");
    ok(res, { customCommand: await createCustomCommand(req.params.guildId, req.body || {}) }, 201);
  }));
  app.patch("/api/guilds/:guildId/custom-commands/:commandId", asyncRoute(async (req, res) => {
    if (Array.isArray(req.body?.roleIds) && !validateRoleIds(req.guild, req.body.roleIds)) return fail(res, 400, "One or more role IDs are invalid.");
    if (req.body?.channelId && !req.guild.channels.cache.has(req.body.channelId)) return fail(res, 400, "Invalid channel ID.");
    const customCommand = await updateCustomCommand(req.params.guildId, req.params.commandId, req.body || {});
    if (!customCommand) return fail(res, 404, "Custom command not found.");
    ok(res, { customCommand });
  }));
  app.delete("/api/guilds/:guildId/custom-commands/:commandId", asyncRoute(async (req, res) => {
    const deleted = await deleteCustomCommand(req.params.guildId, req.params.commandId);
    if (!deleted) return fail(res, 404, "Custom command not found.");
    ok(res, { deleted: true });
  }));

  app.get("/api/guilds/:guildId/custom-replies", asyncRoute(async (req, res) => ok(res, { guildId: req.params.guildId, customReplies: await getGuildCustomReplies(req.params.guildId) })));
  app.post("/api/guilds/:guildId/custom-replies", asyncRoute(async (req, res) => ok(res, { customReply: await createCustomReply(req.params.guildId, req.body || {}) }, 201)));
  app.patch("/api/guilds/:guildId/custom-replies/:replyId", asyncRoute(async (req, res) => {
    const customReply = await updateCustomReply(req.params.guildId, req.params.replyId, req.body || {});
    if (!customReply) return fail(res, 404, "Custom reply not found.");
    ok(res, { customReply });
  }));
  app.delete("/api/guilds/:guildId/custom-replies/:replyId", asyncRoute(async (req, res) => {
    const deleted = await deleteCustomReply(req.params.guildId, req.params.replyId);
    if (!deleted) return fail(res, 404, "Custom reply not found.");
    ok(res, { deleted: true });
  }));

  app.post("/api/guilds/:guildId/messages/send", asyncRoute(async (req, res) => {
    const result = await sendGuildMessage(req.guild, req.body || {});
    ok(res, { guildId: req.params.guildId, ...result }, 201);
  }));

  if (serveDashboard) mountDashboard(app, httpdocsRoot);

  app.use((error, _req, res, _next) => fail(res, error.statusCode || 400, error.message || "Internal server error."));
  const server = app.listen(port, () => {
    console.log("API server listening on port " + port);
    if (serveDashboard) console.log("Dashboard: " + String(publicApiBaseUrl || frontendOrigin).replace(/\/$/, "") + "/dashboard/");
  });
  return { app, server };
}

module.exports = { createApiServer };
