(function () {
  const state = {
    user: null,
    guilds: [],
    guildId: null,
    channels: { text: [], categories: [] },
    roles: [],
    tab: "overview"
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  function avatarUrl(user) {
    if (!user?.id) return "";
    if (user.avatar) return "https://cdn.discordapp.com/avatars/" + user.id + "/" + user.avatar + ".png?size=64";
    const disc = Number(user.discriminator || 0) % 5;
    return "https://cdn.discordapp.com/embed/avatars/" + disc + ".png";
  }

  function guildIcon(guild) {
    if (!guild?.icon) return "";
    return "https://cdn.discordapp.com/icons/" + guild.id + "/" + guild.icon + ".png?size=64";
  }

  function toast(message, type) {
    const el = document.createElement("div");
    el.className = "toast " + (type || "success");
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  function channelOptions(selected) {
    const opts = (state.channels.text || []).map((c) =>
      '<option value="' + c.id + '"' + (selected === c.id ? " selected" : "") + ">#" + escapeHtml(c.name) + "</option>"
    );
    return '<option value="">Select channel…</option>' + opts.join("");
  }

  function roleOptions(selected) {
    const opts = (state.roles || []).map((r) =>
      '<option value="' + r.id + '"' + (selected === r.id ? " selected" : "") + ">" + escapeHtml(r.name) + "</option>"
    );
    return '<option value="">Select role…</option>' + opts.join("");
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setLoginError(message) {
    const el = $("#login-error");
    if (!el) return;
    if (!message) {
      el.textContent = "";
      el.classList.add("hidden");
      return;
    }
    el.textContent = message;
    el.classList.remove("hidden");
  }

  async function handleLoginSubmit(e) {
    if (e) e.preventDefault();
    setLoginError("");
    const password = $("#login-password")?.value || "";
    const btn = $("#login-submit");
    if (!password) {
      setLoginError("Enter your password.");
      return;
    }
    if (!window.PrestonHQ?.api?.login) {
      setLoginError("Dashboard scripts failed to load. Press Ctrl+Shift+R to refresh.");
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Logging in…";
    }
    try {
      const data = await PrestonHQ.api.login(password);
      await startDashboard(data);
    } catch (error) {
      setLoginError(error.message || "Invalid password.");
      showLoginGate("Login failed. Check your password and try again.");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Enter Dashboard";
      }
    }
  }

  function wireLoginForm() {
    const form = document.getElementById("login-form");
    if (!form || form.dataset.wired === "1") return;
    form.dataset.wired = "1";
    form.addEventListener("submit", handleLoginSubmit);
  }

  function showLoginGate(message) {
    $("#loading").classList.add("hidden");
    $("#app").classList.add("hidden");
    if (message) $("#login-gate-message").textContent = message;
    $("#login-gate").classList.remove("hidden");
  }

  function showApp() {
    $("#loading").classList.add("hidden");
    $("#login-gate").classList.add("hidden");
    $("#app").classList.remove("hidden");
  }

  function bindDashboardEvents() {
    $("#guild-picker").addEventListener("change", async (e) => {
      state.guildId = e.target.value;
      localStorage.setItem("prestonhq_guild", state.guildId);
      await loadGuildMeta();
      renderActiveTab();
    });

    $$(".nav-item").forEach((btn) => btn.addEventListener("click", () => setTab(btn.dataset.tab)));

    $("#new-custom-command").addEventListener("click", () => showCustomCommandForm(null));
    $("#new-custom-reply").addEventListener("click", () => {
      const trigger = prompt("Trigger text:");
      if (!trigger) return;
      const responseText = prompt("Reply text:");
      PrestonHQ.api
        .createCustomReply(state.guildId, { trigger, responseText, matchType: "contains", enabled: true })
        .then(() => {
          toast("Reply created");
          renderCustomReplies();
        });
    });

    $("#logout-btn").addEventListener("click", async () => {
      await PrestonHQ.api.logout();
      window.location.href = "/dashboard/";
    });
  }

  async function startDashboard(me) {
    try {
      if (me?.user) {
        state.user = me.user;
        $("#header-name").textContent = me.user.globalName || me.user.username;
        $("#header-user").classList.remove("hidden");
        $("#header-avatar").style.display = "none";
      }

      await loadGuilds();
      await loadGuildMeta();
      showApp();
      setTab("overview");
    } catch (error) {
      setLoginError(error.message || "Could not load dashboard.");
      showLoginGate("Logged in but dashboard failed to load. Try again.");
      throw error;
    }
  }

  async function loadGuilds() {
    const data = await PrestonHQ.api.guilds();
    state.guilds = data.guilds || [];
    const picker = $("#guild-picker");
    picker.innerHTML = state.guilds
      .map((g) => '<option value="' + g.id + '">' + escapeHtml(g.name) + "</option>")
      .join("");
    if (!state.guilds.length) {
      picker.innerHTML = '<option value="">No manageable servers with bot</option>';
      return;
    }
    const saved = localStorage.getItem("prestonhq_guild");
    state.guildId = state.guilds.find((g) => g.id === saved)?.id || state.guilds[0].id;
    picker.value = state.guildId;
  }

  async function loadGuildMeta() {
    if (!state.guildId) return;
    try {
      const [channels, roles] = await Promise.all([
        PrestonHQ.api.channels(state.guildId),
        PrestonHQ.api.roles(state.guildId)
      ]);
      state.channels = channels;
      state.roles = roles.roles || [];
    } catch (error) {
      toast(error.message || "Could not load channels/roles", "error");
      state.channels = { text: [], categories: [] };
      state.roles = [];
    }
  }

  function setTab(tab) {
    state.tab = tab;
    $$(".nav-item").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tab));
    $$(".tab-panel").forEach((panel) => panel.classList.add("hidden"));
    $("#tab-" + tab).classList.remove("hidden");
    renderActiveTab();
  }

  async function renderOverview() {
    const [health, guild] = await Promise.all([
      PrestonHQ.api.health().catch(() => ({})),
      PrestonHQ.api.guild(state.guildId).catch(() => ({}))
    ]);
    $("#overview-stats").innerHTML = [
      stat("Bot Status", health.botReady ? "Online" : "Starting", health.botReady ? "success" : ""),
      stat("Bot User", health.botUser || "—", ""),
      stat("Guilds", health.guildCount ?? "—", ""),
      stat("Members", guild.memberCount ?? "—", "")
    ].join("");
    $("#overview-guild").innerHTML =
      "<h3 style='margin-top:0'>" +
      escapeHtml(guild.name || "Server") +
      "</h3><p class='muted'>Guild ID: " +
      escapeHtml(state.guildId) +
      "</p><p class='muted'>Use the sidebar to manage modules for this server.</p>";
  }

  function stat(label, value, tone) {
    return (
      '<div class="stat-card"><div class="value">' +
      escapeHtml(String(value)) +
      '</div><div class="label">' +
      escapeHtml(label) +
      (tone ? ' <span class="badge badge-' + tone + '">OK</span>' : "") +
      "</div></div>"
    );
  }

  async function renderCommands() {
    const data = await PrestonHQ.api.commands(state.guildId);
    const rows = (data.commands || [])
      .map((cmd) => {
        return (
          "<tr><td><strong>!" +
          escapeHtml(cmd.name) +
          "</strong><br><span class='muted'>" +
          escapeHtml(cmd.description || "") +
          "</span></td><td>" +
          escapeHtml(cmd.type) +
          '</td><td><input type="checkbox" data-cmd-enabled="' +
          escapeHtml(cmd.name) +
          '" ' +
          (cmd.enabled !== false ? "checked" : "") +
          '></td><td><input type="number" min="0" style="width:80px" data-cmd-cooldown="' +
          escapeHtml(cmd.name) +
          '" value="' +
          (cmd.cooldown || 0) +
          '"></td><td><button class="btn btn-sm btn-secondary" data-save-cmd="' +
          escapeHtml(cmd.name) +
          '" type="button">Save</button></td></tr>"
        );
      })
      .join("");
    $("#commands-table").innerHTML = rows;
    $$("[data-save-cmd]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const name = btn.dataset.saveCmd;
        const enabled = $('[data-cmd-enabled="' + name + '"]').checked;
        const cooldown = Number($('[data-cmd-cooldown="' + name + '"]').value || 0);
        await PrestonHQ.api.patchCommand(state.guildId, name, { enabled, cooldown });
        toast("Saved " + name);
      });
    });
  }

  async function renderCustomCommands() {
    const data = await PrestonHQ.api.customCommands(state.guildId);
    const list = data.customCommands || [];
    $("#custom-commands-list").innerHTML = list.length
      ? list
          .map(
            (c) =>
              '<div class="card" style="margin-bottom:12px"><strong>' +
              escapeHtml(c.trigger || c.name) +
              '</strong> <span class="badge">' +
              escapeHtml(c.responseType || "text") +
              '</span><p class="muted">' +
              escapeHtml(c.responseText || "") +
              '</p><div style="display:flex;gap:8px"><button class="btn btn-sm btn-secondary" data-edit-cc="' +
              c.id +
              '" type="button">Edit</button><button class="btn btn-sm btn-danger" data-del-cc="' +
              c.id +
              '" type="button">Delete</button></div></div>'
          )
          .join("")
      : '<p class="muted">No custom commands yet.</p>';

    $$("[data-del-cc]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await PrestonHQ.api.deleteCustomCommand(state.guildId, btn.dataset.delCc);
        toast("Deleted command");
        renderCustomCommands();
      });
    });
    $$("[data-edit-cc]").forEach((btn) => {
      btn.addEventListener("click", () => showCustomCommandForm(list.find((c) => c.id === btn.dataset.editCc)));
    });
  }

  function showCustomCommandForm(existing) {
    const form = $("#custom-command-form");
    form.classList.remove("hidden");
    form.innerHTML =
      '<h3 style="margin-top:0">' +
      (existing ? "Edit" : "New") +
      ' Custom Command</h3>' +
      field("Trigger", "cc-trigger", existing?.trigger || "!help") +
      field("Response Text", "cc-text", existing?.responseText || "", true) +
      '<div class="field"><label>Response Type</label><select id="cc-type"><option value="text">Text</option><option value="embed">Embed</option></select></div>' +
      '<label><input type="checkbox" id="cc-enabled"' +
      (existing?.enabled !== false ? " checked" : "") +
      "> Enabled</label>" +
      '<div style="margin-top:16px;display:flex;gap:8px"><button id="cc-save" class="btn btn-sm" type="button">Save</button><button id="cc-cancel" class="btn btn-secondary btn-sm" type="button">Cancel</button></div>';

    if (existing?.responseType) $("#cc-type").value = existing.responseType;
    $("#cc-cancel").onclick = () => form.classList.add("hidden");
    $("#cc-save").onclick = async () => {
      const payload = {
        trigger: $("#cc-trigger").value.trim(),
        name: $("#cc-trigger").value.trim().replace(/^!/, ""),
        responseText: $("#cc-text").value,
        responseType: $("#cc-type").value,
        enabled: $("#cc-enabled").checked
      };
      if (existing) await PrestonHQ.api.patchCustomCommand(state.guildId, existing.id, payload);
      else await PrestonHQ.api.createCustomCommand(state.guildId, payload);
      form.classList.add("hidden");
      toast("Custom command saved");
      renderCustomCommands();
    };
  }

  async function renderCustomReplies() {
    const data = await PrestonHQ.api.customReplies(state.guildId);
    const list = data.customReplies || [];
    $("#custom-replies-list").innerHTML = list.length
      ? list
          .map(
            (r) =>
              '<div class="card" style="margin-bottom:12px"><strong>' +
              escapeHtml(r.trigger) +
              '</strong> <span class="badge">' +
              escapeHtml(r.matchType || "contains") +
              '</span><p class="muted">' +
              escapeHtml(r.responseText || "") +
              '</p><button class="btn btn-sm btn-danger" data-del-cr="' +
              r.id +
              '" type="button">Delete</button></div>'
          )
          .join("")
      : '<p class="muted">No custom replies yet.</p>';
    $$("[data-del-cr]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await PrestonHQ.api.deleteCustomReply(state.guildId, btn.dataset.delCr);
        toast("Deleted reply");
        renderCustomReplies();
      });
    });
  }

  function field(label, id, value, textarea) {
    if (textarea) {
      return (
        '<div class="field"><label for="' +
        id +
        '">' +
        label +
        '</label><textarea id="' +
        id +
        '">' +
        escapeHtml(value) +
        "</textarea></div>"
      );
    }
    return (
      '<div class="field"><label for="' +
      id +
      '">' +
      label +
      '</label><input id="' +
      id +
      '" value="' +
      escapeHtml(value) +
      '"></div>'
    );
  }

  async function renderTickets() {
    const data = await PrestonHQ.api.sectionSettings(state.guildId, "tickets");
    const s = data.settings || {};
    $("#tickets-form").innerHTML =
      field("Panel Title", "tk-title", s.embedTitle || "Need Support?") +
      field("Panel Description", "tk-desc", s.embedDescription || "Click below to open a ticket.", true) +
      field("Button Label", "tk-btn", s.buttonLabel || "Open Ticket") +
      '<div class="field"><label for="tk-channel">Panel Channel</label><select id="tk-channel">' +
      channelOptions(s.panelChannelId) +
      '</select></div><div class="field"><label for="tk-log">Log Channel</label><select id="tk-log">' +
      channelOptions(s.logChannelId) +
      '</select></div><button id="tk-save" class="btn" type="button">Save Settings</button> <button id="tk-send" class="btn btn-secondary" type="button">Send Panel</button>';

    $("#tk-save").onclick = async () => {
      await PrestonHQ.api.patchSectionSettings(state.guildId, "tickets", {
        embedTitle: $("#tk-title").value,
        embedDescription: $("#tk-desc").value,
        buttonLabel: $("#tk-btn").value,
        panelChannelId: $("#tk-channel").value,
        logChannelId: $("#tk-log").value
      });
      toast("Ticket settings saved");
    };
    $("#tk-send").onclick = async () => {
      await PrestonHQ.api.sendTicketPanel(state.guildId, {
        channelId: $("#tk-channel").value,
        logChannelId: $("#tk-log").value,
        embedTitle: $("#tk-title").value,
        embedDescription: $("#tk-desc").value,
        buttonLabel: $("#tk-btn").value
      });
      toast("Ticket panel sent");
    };
  }

  async function renderWelcome() {
    const data = await PrestonHQ.api.sectionSettings(state.guildId, "welcome");
    const s = data.settings || {};
    $("#welcome-form").innerHTML =
      '<div class="field"><label for="wl-channel">Welcome Channel</label><select id="wl-channel">' +
      channelOptions(s.channelId) +
      '</select></div>' +
      field("Message", "wl-msg", s.message || "Welcome {user} to {server}!", true) +
      field("Embed Title", "wl-title", s.embedTitle || "Welcome!") +
      field("Embed Description", "wl-desc", s.embedDescription || "Welcome {user} to {server}.", true) +
      '<div class="field"><label for="wl-mode">Mode</label><select id="wl-mode"><option value="text">Text</option><option value="embed">Embed</option></select></div>' +
      '<button id="wl-save" class="btn" type="button">Save Welcome Settings</button>';
    if (s.mode) $("#wl-mode").value = s.mode;
    $("#wl-save").onclick = async () => {
      await PrestonHQ.api.patchSectionSettings(state.guildId, "welcome", {
        channelId: $("#wl-channel").value,
        message: $("#wl-msg").value,
        embedTitle: $("#wl-title").value,
        embedDescription: $("#wl-desc").value,
        mode: $("#wl-mode").value
      });
      toast("Welcome settings saved");
    };
    $("#welcome-test-btn").onclick = async () => {
      await PrestonHQ.api.welcomeTest(state.guildId, {});
      toast("Welcome test sent");
    };
  }

  async function renderReactionRoles() {
    $("#reaction-roles-form").innerHTML =
      field("Panel Title", "rr-title", "Reaction Roles") +
      field("Description", "rr-desc", "Click a button to toggle a role.", true) +
      '<div class="field"><label for="rr-channel">Channel</label><select id="rr-channel">' +
      channelOptions() +
      '</select></div><div class="field"><label for="rr-role">Role</label><select id="rr-role">' +
      roleOptions() +
      '</select></div><div class="field"><label for="rr-label">Button Label</label><input id="rr-label" value="Get Role"></div>' +
      '<button id="rr-send" class="btn" type="button">Send Reaction Role Panel</button>';
    $("#rr-send").onclick = async () => {
      await PrestonHQ.api.sendReactionRolePanel(state.guildId, {
        channelId: $("#rr-channel").value,
        title: $("#rr-title").value,
        description: $("#rr-desc").value,
        options: [{ roleId: $("#rr-role").value, label: $("#rr-label").value }]
      });
      toast("Reaction role panel sent");
    };
  }

  async function renderLogging() {
    const data = await PrestonHQ.api.sectionSettings(state.guildId, "logging");
    const s = data.settings || {};
    $("#logging-form").innerHTML =
      '<div class="field"><label for="lg-mod">Moderation Log Channel</label><select id="lg-mod">' +
      channelOptions(s.modLogChannelId) +
      '</select></div><div class="field"><label for="lg-member">Member Log Channel</label><select id="lg-member">' +
      channelOptions(s.memberLogChannelId) +
      '</select></div><button id="lg-save" class="btn" type="button">Save Logging</button>';
    $("#lg-save").onclick = async () => {
      await PrestonHQ.api.patchSectionSettings(state.guildId, "logging", {
        modLogChannelId: $("#lg-mod").value,
        memberLogChannelId: $("#lg-member").value
      });
      toast("Logging settings saved");
    };
  }

  async function renderSettings() {
    const data = await PrestonHQ.api.settings(state.guildId);
    const s = data.settings || {};
    $("#settings-form").innerHTML =
      field("Command Prefix", "set-prefix", s.prefix || "!") +
      '<label><input type="checkbox" id="set-cc"' +
      (s.features?.customCommandsEnabled !== false ? " checked" : "") +
      "> Custom Commands Enabled</label><br><br>" +
      '<label><input type="checkbox" id="set-cr"' +
      (s.features?.customRepliesEnabled !== false ? " checked" : "") +
      '> Custom Replies Enabled</label><br><br><button id="set-save" class="btn" type="button">Save General Settings</button>';
    $("#set-save").onclick = async () => {
      await PrestonHQ.api.patchSettings(state.guildId, {
        prefix: $("#set-prefix").value,
        features: {
          customCommandsEnabled: $("#set-cc").checked,
          customRepliesEnabled: $("#set-cr").checked
        }
      });
      toast("General settings saved");
    };
  }

  async function renderActiveTab() {
    if (!state.guildId) return;
    try {
      if (state.tab === "overview") await renderOverview();
      if (state.tab === "commands") await renderCommands();
      if (state.tab === "custom-commands") await renderCustomCommands();
      if (state.tab === "custom-replies") await renderCustomReplies();
      if (state.tab === "tickets") await renderTickets();
      if (state.tab === "welcome") await renderWelcome();
      if (state.tab === "reaction-roles") await renderReactionRoles();
      if (state.tab === "logging") await renderLogging();
      if (state.tab === "settings") await renderSettings();
    } catch (err) {
      toast(err.message || "Failed to load tab", "error");
    }
  }

  async function init() {
    if (window.PrestonHQ?.debug) PrestonHQ.debug.log("dashboard.js init start");

    wireLoginForm();

    if (!window.PrestonHQ?.config?.API_BASE || !window.PrestonHQ?.api) {
      setLoginError("Scripts failed to load. Hard refresh: Ctrl+Shift+R");
      showLoginGate("Dashboard scripts failed to load.");
      return;
    }

    try {
      bindDashboardEvents();
    } catch (error) {
      console.error("bindDashboardEvents failed:", error);
    }

    try {
      const me = await PrestonHQ.api.me();
      if (me.authenticated) {
        await startDashboard(me);
        return;
      }
    } catch (error) {
      showLoginGate("Enter your dashboard password.");
      setLoginError(error.message || "Enter your password below.");
      return;
    }

    showLoginGate("Enter your dashboard password.");
  }

  init().catch((err) => {
    $("#loading").classList.add("hidden");
    showLoginGate(err.message || "Failed to load dashboard.");
  });
})();
