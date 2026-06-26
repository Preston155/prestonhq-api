const { PermissionsBitField } = require("discord.js");
const { attachBearerAuth } = require("../tokenAuth");

function error(res, status, message) {
  return res.status(status).json({ ok: false, error: message });
}

function requireAuth(sessionSecret) {
  return function requireAuthMiddleware(req, res, next) {
    attachBearerAuth(req, sessionSecret);
    if (!req.session?.dashboardAuth) return error(res, 401, "Not authenticated");
    return next();
  };
}

function hasGuildAdminPermissions(permissionBitsRaw) {
  const permissionBits = BigInt(permissionBitsRaw || "0");
  const adminFlag = BigInt(PermissionsBitField.Flags.Administrator);
  const manageGuildFlag = BigInt(PermissionsBitField.Flags.ManageGuild);
  return (permissionBits & adminFlag) === adminFlag || (permissionBits & manageGuildFlag) === manageGuildFlag;
}

function createRequireGuildAdmin(client, sessionSecret) {
  return async function requireGuildAdmin(req, res, next) {
    try {
      attachBearerAuth(req, sessionSecret);
      if (!req.session?.dashboardAuth) return error(res, 401, "Not authenticated");
      const { guildId } = req.params;
      if (!guildId || !/^\d{16,20}$/.test(guildId)) return error(res, 400, "Invalid guild ID");

      const guild = await client.guilds.fetch(guildId).catch(() => null);
      if (!guild) return error(res, 404, "Bot is not in this guild");

      await guild.channels.fetch().catch(() => null);
      await guild.roles.fetch().catch(() => null);
      req.guild = guild;
      return next();
    } catch {
      return error(res, 500, "Failed to validate guild access");
    }
  };
}

module.exports = { requireAuth, createRequireGuildAdmin, hasGuildAdminPermissions };
