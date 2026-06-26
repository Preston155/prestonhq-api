const path = require("node:path");
const crypto = require("node:crypto");
const { readJson, writeJson } = require("../utils/jsonStore");
const { isValidCommandName, cleanText, isDiscordId } = require("../utils/validation");

const storePath = path.join(__dirname, "..", "data", "customCommands.json");

async function listAll() {
  const data = await readJson(storePath, []);
  return Array.isArray(data) ? data : [];
}

async function saveAll(data) {
  await writeJson(storePath, data);
}

function guildIdFrom(input) {
  return typeof input === "string" ? input : input?.id;
}

function normalizeResponseType(value) {
  const raw = String(value || "Plain Text").toLowerCase();
  if (raw === "embed") return "Embed";
  if (raw === "dm user") return "DM User";
  if (raw === "add role") return "Add Role";
  if (raw === "remove role") return "Remove Role";
  if (raw === "send to channel") return "Send to Channel";
  return "Plain Text";
}

function buildCommand(guildId, payload, existing = null) {
  const now = new Date().toISOString();
  const name = String(payload.name ?? existing?.name ?? "").trim().toLowerCase();
  const trigger = String(payload.trigger ?? existing?.trigger ?? name).trim();
  if (!isValidCommandName(name || trigger.replace(/^!/, ""))) throw new Error("Invalid or blocked command name.");

  return {
    id: existing?.id ?? crypto.randomUUID(),
    guildId,
    name: name || trigger.replace(/^!/, "").toLowerCase(),
    type: payload.type ?? existing?.type ?? "prefix",
    description: cleanText(payload.description ?? existing?.description ?? "", 200),
    trigger,
    responseType: normalizeResponseType(payload.responseType ?? existing?.responseType),
    responseText: cleanText(payload.responseText ?? existing?.responseText ?? "", 1800),
    embed: payload.embed ?? existing?.embed ?? null,
    permission: payload.permission ?? existing?.permission ?? "EVERYONE",
    roleIds: Array.isArray(payload.roleIds ?? existing?.roleIds) ? (payload.roleIds ?? existing.roleIds).filter(isDiscordId) : [],
    channelId: isDiscordId(payload.channelId ?? existing?.channelId) ? payload.channelId ?? existing.channelId : null,
    cooldown: Math.max(0, Number.isFinite(Number(payload.cooldown)) ? Number(payload.cooldown) : existing?.cooldown ?? 0),
    enabled: payload.enabled ?? existing?.enabled ?? true,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}

async function getGuildCustomCommands(guildId) {
  return (await listAll()).filter((item) => item.guildId === guildId);
}

async function getCustomCommands(guildId) {
  return getGuildCustomCommands(guildId);
}

async function createCustomCommand(guildOrId, payload) {
  const guildId = guildIdFrom(guildOrId);
  const all = await listAll();
  const command = buildCommand(guildId, payload);
  if (all.some((item) => item.guildId === guildId && item.name === command.name)) throw new Error("Custom command already exists.");
  all.push(command);
  await saveAll(all);
  return command;
}

async function updateCustomCommand(guildOrId, commandId, patch) {
  const guildId = guildIdFrom(guildOrId);
  const all = await listAll();
  const index = all.findIndex((item) => item.guildId === guildId && item.id === commandId);
  if (index === -1) return null;
  all[index] = buildCommand(guildId, patch, all[index]);
  await saveAll(all);
  return all[index];
}

async function deleteCustomCommand(guildId, commandId) {
  const all = await listAll();
  const next = all.filter((item) => !(item.guildId === guildId && item.id === commandId));
  if (next.length === all.length) return false;
  await saveAll(next);
  return true;
}

module.exports = {
  getGuildCustomCommands,
  getCustomCommands,
  createCustomCommand,
  updateCustomCommand,
  deleteCustomCommand
};
