const crypto = require("node:crypto");
const { signAuthToken, attachBearerAuth } = require("../tokenAuth");
const { logApi } = require("../logger");

const DASHBOARD_USER = {
  id: "dashboard-admin",
  username: "Admin",
  globalName: "PrestonHQ Admin",
  avatar: null
};

function verifyPassword(input, expected) {
  if (!expected || input == null) return false;
  const a = Buffer.from(String(input));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function createAuthRouter({ cookieDomain, cookieSameSite = "lax", isProduction = false, sessionSecret, dashboardPassword }) {
  if (!dashboardPassword) throw new Error("Missing DASHBOARD_PASSWORD.");

  function isAuthed(req) {
    attachBearerAuth(req, sessionSecret);
    return Boolean(req.session?.dashboardAuth && req.session?.user?.id);
  }

  return {
    login(req, res) {
      const password = String(req.body?.password || "");
      logApi("info", "Login attempt", {
        ip: req.ip,
        hasPassword: password.length > 0,
        passwordLength: password.length,
        userAgent: req.headers["user-agent"] || null
      });

      if (!verifyPassword(password, dashboardPassword)) {
        logApi("warn", "Login failed: invalid password", { ip: req.ip });
        return res.status(401).json({ ok: false, error: "Invalid password." });
      }

      req.session.user = { ...DASHBOARD_USER };
      req.session.dashboardAuth = true;
      req.session.guilds = [];
      req.session.loginTime = new Date().toISOString();

      const token = signAuthToken(
        {
          user: req.session.user,
          guilds: [],
          loginTime: req.session.loginTime,
          dashboardAuth: true
        },
        sessionSecret
      );

      req.session.save((err) => {
        if (err) {
          logApi("error", "Login session save failed", { error: err.message, ip: req.ip });
          return res.status(500).json({ ok: false, error: "Could not start session." });
        }
        logApi("info", "Login success", { ip: req.ip, userId: req.session.user.id });
        return res.json({
          ok: true,
          data: {
            authenticated: true,
            user: req.session.user,
            token,
            loginTime: req.session.loginTime
          }
        });
      });
    },

    getAuthMe(req, res) {
      const authed = isAuthed(req);
      logApi("info", "Auth check", {
        ip: req.ip,
        authenticated: authed,
        hasBearer: Boolean(req.headers.authorization),
        hasSession: Boolean(req.session?.dashboardAuth)
      });
      if (!authed) {
        return res.json({ ok: true, data: { authenticated: false, user: null, guilds: [], loginTime: null } });
      }
      return res.json({
        ok: true,
        data: {
          authenticated: true,
          user: req.session.user,
          guilds: req.session.guilds || [],
          loginTime: req.session.loginTime || null
        }
      });
    },

    logout(req, res) {
      req.session.destroy(() => {
        res.clearCookie("nexora_sid", { httpOnly: true, secure: isProduction, sameSite: cookieSameSite, domain: cookieDomain || undefined });
        res.json({ ok: true, data: { loggedOut: true } });
      });
    }
  };
}

module.exports = { createAuthRouter };
