const path = require("node:path");
const { readJson, writeJson } = require("../utils/jsonStore");

const storePath = path.join(__dirname, "..", "data", "guildSettings.json");

const DEFAULTS = {
  settings: { prefix: "!", features: { customCommandsEnabled: true, customRepliesEnabled: true } },
  tickets: {
    settings: {
      enabled: false,
      panelChannelId: "",
      categoryId: "",
      supportRoleId: "",
      logChannelId: "",
      transcriptChannelId: "",
      embedTitle: "Need Support?",
      embedDescription: "Click the button below to open a private support ticket.",
      embedColor: "#0B1F4D",
      buttonLabel: "Open Ticket"
    },
    panels: []
  },
  moderation: { settings: { enabled: false, modLogChannelId: "", staffRoleIds: [], muteRoleId: "", dmUsers: true }, cases: [] },
  giveaways: [],
  reactionRoles: { settings: { enabled: true }, panels: [] },
  leveling: { settings: { enabled: true, xpCooldown: 60, minXp: 10, maxXp: 20, levelUpChannelId: "", levelUpMessage: "GG {user}, you reached level {level}!" }, leaderboard: [] },
  welcome: { settings: { enabled: false, channelId: "", mode: "text", message: "Welcome {user} to {server}!", embedTitle: "Welcome!", embedDescription: "Welcome {user} to {server}.", embedColor: "#0B1F4D" } },
  logging: { settings: { modLogChannelId: "", ticketLogChannelId: "", memberLogChannelId: "", messageLogChannelId: "", roleLogChannelId: "", serverLogChannelId: "" } }
};

function mergeDefaults(section, defaults) {
  if (Array.isArray(defaults)) return Array.isArray(section) ? section : [];
  if (!defaults || typeof defaults !== "object") return section ?? defaults;
  const out = { ...defaults, ...(section && typeof section === "object" ? section : {}) };
  for (const [key, value] of Object.entries(defaults)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = mergeDefaults(out[key], value);
    }
  }
  return out;
}

function ensureGuildDataShape(data) {
  return mergeDefaults(data, DEFAULTS);
}

async function readAllGuildSettings() {
  const all = await readJson(storePath, {});
  return all && typeof all === "object" && !Array.isArray(all) ? all : {};
}

async function writeAllGuildSettings(all) {
  await writeJson(storePath, all);
}

async function getGuildSettings(guildId) {
  const all = await readAllGuildSettings();
  return ensureGuildDataShape(all[guildId]);
}

async function getGuildSettingsBundle(guildId) {
  return getGuildSettings(guildId);
}

async function updateGuildSettings(guildId, patch) {
  const all = await readAllGuildSettings();
  const current = ensureGuildDataShape(all[guildId]);
  const next = ensureGuildDataShape({ ...current, ...(patch || {}) });
  all[guildId] = next;
  await writeAllGuildSettings(all);
  return next;
}

async function updateGuildSettingsBundle(guildId, updater) {
  const all = await readAllGuildSettings();
  const current = ensureGuildDataShape(all[guildId]);
  const next = ensureGuildDataShape(updater(current));
  all[guildId] = next;
  await writeAllGuildSettings(all);
  return next;
}

async function getMainSettings(guildId) {
  return (await getGuildSettings(guildId)).settings;
}

async function patchMainSettings(guildId, patch) {
  const bundle = await updateGuildSettingsBundle(guildId, (current) => ({
    ...current,
    settings: { ...current.settings, ...(patch || {}), updatedAt: new Date().toISOString() }
  }));
  return bundle.settings;
}

async function setGuildSetting(guildId, section, value) {
  const bundle = await updateGuildSettingsBundle(guildId, (current) => ({
    ...current,
    [section]: value
  }));
  return bundle[section];
}

async function getSectionSettings(guildId, section) {
  const bundle = await getGuildSettings(guildId);
  return bundle[section]?.settings || {};
}

async function patchSectionSettings(guildId, section, patch) {
  const bundle = await updateGuildSettingsBundle(guildId, (current) => {
    const currentSection = current[section] && typeof current[section] === "object" ? current[section] : {};
    return {
      ...current,
      [section]: {
        ...currentSection,
        settings: { ...(currentSection.settings || {}), ...(patch || {}), updatedAt: new Date().toISOString() }
      }
    };
  });
  return bundle[section].settings || {};
}

async function getSectionList(guildId, section, listKey) {
  const bundle = await getGuildSettings(guildId);
  const list = bundle[section]?.[listKey];
  return Array.isArray(list) ? list : [];
}

async function appendSectionListItem(guildId, section, listKey, item) {
  const bundle = await updateGuildSettingsBundle(guildId, (current) => {
    const sectionData = current[section] && typeof current[section] === "object" ? current[section] : {};
    const list = Array.isArray(sectionData[listKey]) ? sectionData[listKey] : [];
    return { ...current, [section]: { ...sectionData, [listKey]: [...list, item] } };
  });
  return bundle[section][listKey];
}

async function updateSectionListItem(guildId, section, listKey, itemId, patch) {
  const bundle = await updateGuildSettingsBundle(guildId, (current) => {
    const sectionData = current[section] && typeof current[section] === "object" ? current[section] : {};
    const list = Array.isArray(sectionData[listKey]) ? sectionData[listKey] : [];
    return {
      ...current,
      [section]: {
        ...sectionData,
        [listKey]: list.map((item) => String(item.id) === String(itemId) ? { ...item, ...(patch || {}), updatedAt: new Date().toISOString() } : item)
      }
    };
  });
  return (bundle[section][listKey] || []).find((item) => String(item.id) === String(itemId)) || null;
}

async function getGiveaways(guildId) {
  const bundle = await getGuildSettings(guildId);
  return Array.isArray(bundle.giveaways) ? bundle.giveaways : [];
}

async function patchGiveaway(guildId, giveawayId, patch) {
  return updateSectionListItem(guildId, "giveaways", "items", giveawayId, patch);
}

module.exports = {
  getGuildSettings,
  updateGuildSettings,
  setGuildSetting,
  getGuildSettingsBundle,
  getMainSettings,
  patchMainSettings,
  getSectionSettings,
  patchSectionSettings,
  getSectionList,
  appendSectionListItem,
  updateSectionListItem,
  getGiveaways,
  patchGiveaway
};
