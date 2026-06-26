(function () {
  const { API_BASE } = PrestonHQ.config;

  function token() {
    try {
      return sessionStorage.getItem("ph_token") || "";
    } catch {
      return "";
    }
  }

  function setToken(value) {
    try {
      if (value) sessionStorage.setItem("ph_token", value);
      else sessionStorage.removeItem("ph_token");
    } catch {}
  }

  async function request(path, options = {}) {
    const res = await fetch(API_BASE + path, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(token() ? { Authorization: "Bearer " + token() } : {}),
        ...(options.headers || {})
      },
      ...options
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.ok === false) {
      throw new Error(json.error || "Request failed (" + res.status + ")");
    }
    return json.data !== undefined ? json.data : json;
  }

  PrestonHQ.api = {
    health: () => request("/health"),
    me: () => request("/auth/me"),
    login: async (password) => {
      const data = await request("/auth/login", { method: "POST", body: JSON.stringify({ password }) });
      if (data.token) setToken(data.token);
      return data;
    },
    logout: async () => {
      setToken("");
      await request("/auth/logout", { method: "POST" }).catch(() => {});
    },
    guilds: () => request("/guilds"),
    guild: (id) => request("/guilds/" + id),
    channels: (id) => request("/guilds/" + id + "/channels"),
    roles: (id) => request("/guilds/" + id + "/roles"),
    settings: (id) => request("/guilds/" + id + "/settings"),
    patchSettings: (id, body) => request("/guilds/" + id + "/settings", { method: "PATCH", body: JSON.stringify(body) }),
    sectionSettings: (id, section) => request("/guilds/" + id + "/" + section + "/settings"),
    patchSectionSettings: (id, section, body) =>
      request("/guilds/" + id + "/" + section + "/settings", { method: "PATCH", body: JSON.stringify(body) }),
    commands: (id) => request("/guilds/" + id + "/commands"),
    patchCommand: (id, name, body) =>
      request("/guilds/" + id + "/commands/" + encodeURIComponent(name), { method: "PATCH", body: JSON.stringify(body) }),
    customCommands: (id) => request("/guilds/" + id + "/custom-commands"),
    createCustomCommand: (id, body) =>
      request("/guilds/" + id + "/custom-commands", { method: "POST", body: JSON.stringify(body) }),
    patchCustomCommand: (id, cmdId, body) =>
      request("/guilds/" + id + "/custom-commands/" + cmdId, { method: "PATCH", body: JSON.stringify(body) }),
    deleteCustomCommand: (id, cmdId) => request("/guilds/" + id + "/custom-commands/" + cmdId, { method: "DELETE" }),
    customReplies: (id) => request("/guilds/" + id + "/custom-replies"),
    createCustomReply: (id, body) =>
      request("/guilds/" + id + "/custom-replies", { method: "POST", body: JSON.stringify(body) }),
    deleteCustomReply: (id, replyId) => request("/guilds/" + id + "/custom-replies/" + replyId, { method: "DELETE" }),
    ticketPanels: (id) => request("/guilds/" + id + "/tickets/panels"),
    sendTicketPanel: (id, body) => request("/guilds/" + id + "/tickets/panel", { method: "POST", body: JSON.stringify(body) }),
    reactionRolePanels: (id) => request("/guilds/" + id + "/reaction-roles/panels"),
    sendReactionRolePanel: (id, body) =>
      request("/guilds/" + id + "/reaction-roles/panel", { method: "POST", body: JSON.stringify(body) }),
    welcomeTest: (id) => request("/guilds/" + id + "/welcome/test", { method: "POST", body: "{}" }),
    sendMessage: (id, body) => request("/guilds/" + id + "/messages/send", { method: "POST", body: JSON.stringify(body) })
  };
})();
