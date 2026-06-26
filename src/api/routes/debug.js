const { logClient, readLogTail, API_LOG, CLIENT_LOG } = require("../logger");

function createDebugRouter({ sessionSecret, dashboardPassword }) {
  return {
    clientLog(req, res) {
      const body = req.body || {};
      const message = String(body.message || "").slice(0, 500);
      if (!message) return res.status(400).json({ ok: false, error: "Missing message." });
      logClient(body.level || "info", message, {
        url: body.url || null,
        step: body.step || null,
        detail: body.detail || null,
        userAgent: req.headers["user-agent"] || null,
        ip: req.ip || null
      });
      return res.json({ ok: true, data: { logged: true } });
    },

    getLogs(req, res) {
      const key = String(req.query.key || "");
      if (key !== dashboardPassword) {
        return res.status(403).json({ ok: false, error: "Invalid log key." });
      }
      return res.json({
        ok: true,
        data: {
          api: readLogTail(API_LOG, 100),
          client: readLogTail(CLIENT_LOG, 100)
        }
      });
    }
  };
}

module.exports = { createDebugRouter };
