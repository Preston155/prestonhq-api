const crypto = require("node:crypto");

function signAuthToken({ user, guilds, loginTime, dashboardAuth }, secret, ttlSec = 60 * 60 * 24 * 7) {
  const header = { alg: "HS256", typ: "JWT" };
  const payload = { user, guilds, loginTime, dashboardAuth: dashboardAuth === true, exp: Math.floor(Date.now() / 1000) + ttlSec };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(encodedHeader + "." + encodedPayload).digest("base64url");
  return encodedHeader + "." + encodedPayload + "." + signature;
}

function verifyAuthToken(token, secret) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, signature] = parts;
  const expected = crypto.createHmac("sha256", secret).update(encodedHeader + "." + encodedPayload).digest("base64url");
  if (signature !== expected) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload?.user?.id || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
  return header.slice(7).trim() || null;
}

function attachBearerAuth(req, secret) {
  if (req.session?.dashboardAuth && req.session?.user?.id) return true;
  const token = getBearerToken(req);
  if (!token) return false;
  const payload = verifyAuthToken(token, secret);
  if (!payload) return false;
  req.session.user = payload.user;
  req.session.guilds = payload.guilds || [];
  req.session.loginTime = payload.loginTime || null;
  req.session.dashboardAuth = payload.dashboardAuth === true;
  return req.session.dashboardAuth === true;
}

module.exports = { signAuthToken, verifyAuthToken, getBearerToken, attachBearerAuth };
