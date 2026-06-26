const fs = require("node:fs");
const path = require("node:path");

const LOG_DIR = path.join(__dirname, "..", "data", "logs");
const API_LOG = path.join(LOG_DIR, "dashboard-api.log");
const CLIENT_LOG = path.join(LOG_DIR, "dashboard-client.log");
const MAX_LOG_BYTES = 1024 * 1024 * 2;

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function trimLog(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    if (fs.statSync(filePath).size <= MAX_LOG_BYTES) return;
    const lines = fs.readFileSync(filePath, "utf8").split("\n");
    fs.writeFileSync(filePath, lines.slice(-500).join("\n"));
  } catch {
    /* ignore trim errors */
  }
}

function writeLog(filePath, level, source, message, meta) {
  ensureLogDir();
  trimLog(filePath);
  const line =
    JSON.stringify({
      ts: new Date().toISOString(),
      level,
      source,
      message,
      meta: meta || null
    }) + "\n";
  fs.appendFileSync(filePath, line);
  const prefix = "[" + source + "] " + message;
  if (level === "error") console.error(prefix, meta || "");
  else if (level === "warn") console.warn(prefix, meta || "");
  else console.log(prefix, meta || "");
}

function logApi(level, message, meta) {
  writeLog(API_LOG, level, "dashboard-api", message, meta);
}

function logClient(level, message, meta) {
  writeLog(CLIENT_LOG, level, "dashboard-client", message, meta);
}

function readLogTail(filePath, limit = 80) {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, "utf8").trim().split("\n").filter(Boolean);
  return lines.slice(-limit).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { ts: null, level: "info", source: "raw", message: line };
    }
  });
}

module.exports = { logApi, logClient, readLogTail, API_LOG, CLIENT_LOG, LOG_DIR };
