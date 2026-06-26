const express = require("express");
const path = require("node:path");
const fsPromises = require("node:fs/promises");
const fsNative = require("node:fs");
const cors = require("cors");
const session = require("express-session");
const MemoryStore = require("memorystore")(session);
const crypto = require("node:crypto");
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

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function ok(res, data, status = 200) {
  return res.status(status).json({ ok: true, data });
}

function fail(res, status, message) {
  return res.status(status).json({ ok: false, error: message });
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
  for (const raw of [frontendOrigin, publicApiBaseUrl, "https://api.prestonhq.com", "http://localhost:3001"]) {
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
  app.get(["/dashboard", "/dashboard/"], (_req, res) => {
    res.sendFile(dashboardIndex);
  });
  app.use(express.static(httpdocsRoot, { index: "index.html", redirect: false }));
}

function createApiServer({ client, port = 3001, frontendOrigin = "https://api.prestonhq.com", publicApiBaseUrl = "https://api.prestonhq.com", sessionSecret, dashboardPassword, cookieDomain, cookieSameSite = "lax", isProduction = false, serveDashboard = true }) {
  if (!sessionSecret) throw new Error("Missing SESSION_SECRET.");
  const app = express();
  const allowedOrigins = resolveAllowedOrigins(frontendOrigin, publicApiBaseUrl);
  const httpdocsRoot = path.join(__dirname, "..", "..", "httpdocs");
  const requireGuildAdmin = createRequireGuildAdmin(client, sessionSecret);
  const authRouter = createAuthRouter({ cookieDomain, cookieSameSite, isProduction, sessionSecret, dashboardPassword });
  const debugRouter = createDebugRouter({ sessionSecret, dashboardPassword });
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
  app.post("/api/auth/login", asyncRoute((req, res) => authRouter.login(req, res)));
  app.get("/api/auth/me", authRouter.getAuthMe);
  app.post("/api/auth/logout", authRouter.logout);
  app.post("/api/debug/client", asyncRoute((req, res) => debugRouter.clientLog(req, res)));
  app.get("/api/debug/logs", debugRouter.getLogs);

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
