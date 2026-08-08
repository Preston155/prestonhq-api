const BASE_URL = String(process.env.PRC_API_BASE_URL || "https://api.erlc.gg/v1").replace(/\/$/, "");

class PrcApiError extends Error {
  constructor(message, status = 502, code = "PRC_ERROR") {
    super(message);
    this.name = "PrcApiError";
    this.statusCode = status;
    this.code = code;
  }
}

function configured() {
  return Boolean(String(process.env.ERLC_API_KEY || process.env.PRC_SERVER_KEY || "").trim());
}

function serverKey() {
  return String(process.env.ERLC_API_KEY || process.env.PRC_SERVER_KEY || "").trim();
}

async function request(pathname, options = {}) {
  if (!configured()) throw new PrcApiError("ER:LC API is not configured on the server.", 503, "NOT_CONFIGURED");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.PRC_TIMEOUT_MS || 10000));
  try {
    const response = await fetch(BASE_URL + pathname, {
      method: options.method || "GET",
      headers: {
        "Server-Key": serverKey(),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text || null; }
    if (!response.ok) {
      const message = payload?.message || payload?.error || (response.status === 429 ? "ER:LC API rate limit reached. Try again shortly." : `ER:LC API request failed (${response.status}).`);
      throw new PrcApiError(String(message), response.status === 401 || response.status === 403 ? 503 : response.status, response.status === 429 ? "RATE_LIMITED" : "UPSTREAM_ERROR");
    }
    return { data: payload, rateLimit: {
      limit: Number(response.headers.get("x-ratelimit-limit") || 0) || null,
      remaining: Number(response.headers.get("x-ratelimit-remaining") || 0),
      reset: response.headers.get("x-ratelimit-reset") || null,
    } };
  } catch (error) {
    if (error?.name === "AbortError") throw new PrcApiError("ER:LC API timed out.", 504, "TIMEOUT");
    if (error instanceof PrcApiError) throw error;
    throw new PrcApiError("Could not reach the ER:LC API.", 502, "OFFLINE");
  } finally {
    clearTimeout(timeout);
  }
}

async function getServer() { return (await request("/server")).data; }
async function getPlayers() { return (await request("/server/players")).data || []; }
async function getQueue() { return (await request("/server/queue")).data || []; }
async function getCommandLogs() { return (await request("/server/commandlogs")).data || []; }
async function getModCalls() { return (await request("/server/modcalls")).data || []; }
async function getBans() { return (await request("/server/bans")).data || {}; }
async function executeCommand(command) {
  const cleaned = String(command || "").trim();
  if (!cleaned.startsWith(":")) throw new PrcApiError("Commands must begin with a colon.", 400, "INVALID_COMMAND");
  if (cleaned.length > 300) throw new PrcApiError("Command is too long.", 400, "INVALID_COMMAND");
  return (await request("/server/command", { method: "POST", body: { command: cleaned } })).data;
}

module.exports = { PrcApiError, configured, getServer, getPlayers, getQueue, getCommandLogs, getModCalls, getBans, executeCommand };
