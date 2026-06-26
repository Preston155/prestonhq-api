const BLOCKED_NAMES = new Set(["eval", "token", "shutdown", "restart", "login", "client", "process", "env"]);
const COMMAND_NAME_REGEX = /^[a-z0-9_-]{1,32}$/i;
const DISCORD_ID_REGEX = /^\d{16,20}$/;

function isValidCommandName(name) {
  if (typeof name !== "string") return false;
  if (!COMMAND_NAME_REGEX.test(name)) return false;
  return !BLOCKED_NAMES.has(name.toLowerCase());
}

function cleanText(value, max = 1800) {
  return String(value || "")
    .replace(/@everyone/gi, "@ everyone")
    .replace(/@here/gi, "@ here")
    .slice(0, max);
}

function isDiscordId(value) {
  return typeof value === "string" && DISCORD_ID_REGEX.test(value);
}

function safeRegex(pattern) {
  try {
    return new RegExp(String(pattern || ""), "i");
  } catch {
    return null;
  }
}

module.exports = { isValidCommandName, cleanText, isDiscordId, safeRegex };
