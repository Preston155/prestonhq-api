const path = require("node:path");
const crypto = require("node:crypto");
const { readJson, writeJson } = require("../utils/jsonStore");
const { cleanText, isDiscordId } = require("../utils/validation");

const storePath = path.join(__dirname, "..", "data", "customReplies.json");
const MATCH_TYPES = new Set(["exact", "contains", "startsWith", "regex"]);

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

function buildReply(guildId, payload, existing = null) {
  const now = new Date().toISOString();
  const matchType = MATCH_TYPES.has(payload.matchType ?? existing?.matchType) ? payload.matchType ?? existing.matchType : "contains";
  return {
    id: existing?.id ?? crypto.randomUUID(),
    guildId,
    trigger: cleanText(payload.trigger ?? existing?.trigger ?? "", 300),
    matchType,
    responseText: cleanText(payload.responseText ?? existing?.responseText ?? "", 1800),
    embedEnabled: payload.embedEnabled ?? existing?.embedEnabled ?? false,
    embed: payload.embed ?? existing?.embed ?? null,
    allowedChannelIds: Array.isArray(payload.allowedChannelIds ?? existing?.allowedChannelIds) ? (payload.allowedChannelIds ?? existing.allowedChannelIds).filter(isDiscordId) : [],
    ignoredChannelIds: Array.isArray(payload.ignoredChannelIds ?? existing?.ignoredChannelIds) ? (payload.ignoredChannelIds ?? existing.ignoredChannelIds).filter(isDiscordId) : [],
    requiredRoleIds: Array.isArray(payload.requiredRoleIds ?? existing?.requiredRoleIds) ? (payload.requiredRoleIds ?? existing.requiredRoleIds).filter(isDiscordId) : [],
    enabled: payload.enabled ?? existing?.enabled ?? true,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}

async function getGuildCustomReplies(guildId) {
  return (await listAll()).filter((item) => item.guildId === guildId);
}

async function getCustomReplies(guildId) {
  return getGuildCustomReplies(guildId);
}

async function createCustomReply(guildOrId, payload) {
  const guildId = guildIdFrom(guildOrId);
  const all = await listAll();
  const reply = buildReply(guildId, payload);
  all.push(reply);
  await saveAll(all);
  return reply;
}

async function updateCustomReply(guildOrId, replyId, patch) {
  const guildId = guildIdFrom(guildOrId);
  const all = await listAll();
  const index = all.findIndex((item) => item.guildId === guildId && item.id === replyId);
  if (index === -1) return null;
  all[index] = buildReply(guildId, patch, all[index]);
  await saveAll(all);
  return all[index];
}

async function deleteCustomReply(guildId, replyId) {
  const all = await listAll();
  const next = all.filter((item) => !(item.guildId === guildId && item.id === replyId));
  if (next.length === all.length) return false;
  await saveAll(next);
  return true;
}

module.exports = {
  getGuildCustomReplies,
  getCustomReplies,
  createCustomReply,
  updateCustomReply,
  deleteCustomReply
};
