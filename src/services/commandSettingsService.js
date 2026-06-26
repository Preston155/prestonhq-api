const path = require("node:path");
const { readJson, writeJson } = require("../utils/jsonStore");

const storePath = path.join(__dirname, "..", "data", "commandSettings.json");

async function getGuildCommandSettings(guildId) {
  const all = await readJson(storePath, {});
  return all[guildId] && typeof all[guildId] === "object" ? all[guildId] : {};
}

async function getCommandSettings(guildId) {
  return getGuildCommandSettings(guildId);
}

async function getCommandSetting(guildId, commandName) {
  const settings = await getGuildCommandSettings(guildId);
  return settings[String(commandName || "").toLowerCase()] || null;
}

async function patchCommandSetting(guildId, commandName, patch) {
  return updateCommandSettings(guildId, commandName, patch);
}

async function updateCommandSettings(guildId, commandName, patch) {
  const all = await readJson(storePath, {});
  const key = String(commandName || "").toLowerCase();
  const guildSettings = all[guildId] && typeof all[guildId] === "object" ? all[guildId] : {};
  const existing = guildSettings[key] || {};
  const cooldownValue = Number(patch?.cooldown);

  const updated = {
    enabled: patch?.enabled ?? existing.enabled ?? true,
    permission: patch?.permission ?? existing.permission ?? "EVERYONE",
    cooldown: Number.isFinite(cooldownValue) && cooldownValue >= 0 ? cooldownValue : existing.cooldown ?? 0,
    type: patch?.type ?? existing.type ?? "prefix",
    updatedAt: new Date().toISOString()
  };

  guildSettings[key] = updated;
  all[guildId] = guildSettings;
  await writeJson(storePath, all);
  return updated;
}

async function isCommandEnabled(guildId, commandName) {
  const setting = await getCommandSetting(guildId, commandName);
  return setting?.enabled !== false;
}

module.exports = {
  getGuildCommandSettings,
  getCommandSettings,
  getCommandSetting,
  patchCommandSetting,
  updateCommandSettings,
  isCommandEnabled
};
