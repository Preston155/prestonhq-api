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
    setTimeout(() => {
      el.classList.add("toast-out");
      el.addEventListener("animationend", () => el.remove(), { once: true });
    }, 2800);
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

  function guildName() {
    return state.guilds.find((g) => g.id === state.guildId)?.name || "Server";
  }

  function channelLabel(id) {
    const ch = (state.channels.text || []).find((c) => c.id === id);
    return ch ? "#" + ch.name : id ? "Channel " + id.slice(-4) : "No channel";
  }

  function roleLabel(id) {
    const role = (state.roles || []).find((r) => r.id === id);
    return role ? role.name : id ? "Role " + id.slice(-4) : "Role";
  }

  function applyPreviewVars(text) {
    const guild = state.guilds.find((g) => g.id === state.guildId);
    return String(text || "")
      .replace(/\{user\}/g, "@User")
      .replace(/\{username\}/g, "User")
      .replace(/\{server\}/g, guild?.name || guildName())
      .replace(/\{guild\}/g, guild?.name || guildName())
      .replace(/\{memberCount\}/g, String(guild?.memberCount || "1,234"))
      .replace(/\{channel\}/g, "#general");
  }

  function formatPreviewText(text) {
    let html = escapeHtml(applyPreviewVars(text));
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\n/g, "<br>");
    return html;
  }

  function discordMessageLink(channelId, messageId) {
    if (!channelId || !messageId || !state.guildId) return "";
    return "https://discord.com/channels/" + state.guildId + "/" + channelId + "/" + messageId;
  }

  function renderDiscordMessagePreview(opts) {
    const color = opts.color || "#5865f2";
    const channelBar =
      '<div class="discord-frame-mini"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18"/></svg>' +
      escapeHtml(channelLabel(opts.channelId)) +
      "</div>";
    let body = "";
    if (opts.mode === "text") {
      if (opts.content) body += '<div class="d-content">' + formatPreviewText(opts.content) + "</div>";
    } else {
      body +=
        '<div class="d-embed" style="--embed-color:' +
        escapeHtml(color) +
        '">' +
        (opts.title ? '<div class="d-embed-title">' + formatPreviewText(opts.title) + "</div>" : "") +
        (opts.description ? '<div class="d-embed-desc">' + formatPreviewText(opts.description) + "</div>" : "") +
        (opts.footer ? '<div class="d-embed-footer">' + escapeHtml(opts.footer) + "</div>" : "") +
        "</div>";
    }
    if (opts.buttons?.length) {
      body +=
        '<div class="d-components"><div class="d-action-row">' +
        opts.buttons
          .map((b) => '<span class="d-btn ' + (b.style || "d-btn-primary") + '">' + (b.emoji ? escapeHtml(b.emoji) + " " : "") + escapeHtml(b.label || "Button") + "</span>")
          .join("") +
        "</div></div>";
    }
    return (
      channelBar +
      '<div class="discord-preview"><div class="d-message"><div class="d-avatar"></div><div class="d-body">' +
      '<div class="d-meta"><strong>Nexora</strong> <span class="d-bot">BOT</span></div>' +
      body +
      "</div></div></div>"
    );
  }

  function renderActivePreviewCard(title, meta, previewHtml) {
    return (
      '<div class="active-preview card">' +
      '<div class="active-preview-head"><div><span class="active-badge">Active</span><h3>' +
      escapeHtml(title) +
      "</h3></div><div class=\"active-preview-meta\">" +
      meta +
      "</div></div>" +
      '<div class="active-preview-body">' +
      previewHtml +
      "</div></div>"
    );
  }

  function setActivePreview(mountId, html) {
    const el = $(mountId);
    if (!el) return;
    if (html) {
      el.innerHTML = html;
      el.classList.remove("hidden");
    } else {
      el.innerHTML = "";
      el.classList.add("hidden");
    }
  }

  function formatPanelDate(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return "";
    }
  }

  function renderTicketPanelPreview(panel) {
    const cfg = panel.settings || panel;
    const link = discordMessageLink(panel.channelId, panel.messageId);
    const meta =
      "<span>" +
      escapeHtml(channelLabel(panel.channelId)) +
      "</span>" +
      (panel.createdAt ? "<span>Sent " + escapeHtml(formatPanelDate(panel.createdAt)) + "</span>" : "") +
      (link ? '<a href="' + escapeHtml(link) + '" target="_blank" rel="noopener">Open in Discord ↗</a>' : "");
    const preview = renderDiscordMessagePreview({
      channelId: panel.channelId,
      title: cfg.embedTitle || "Need Support?",
      description: cfg.embedDescription || "",
      color: cfg.embedColor || "#5865f2",
      footer: guildName() + " • Tickets",
      buttons: [{ label: cfg.buttonLabel || "Open Ticket", style: "d-btn-primary" }]
    });
    return renderActivePreviewCard("Ticket Panel", meta, preview);
  }

  function renderWelcomeActivePreview(settings) {
    const meta =
      "<span>" +
      escapeHtml(channelLabel(settings.channelId)) +
      "</span><span>Mode: " +
      escapeHtml(settings.mode === "embed" ? "Embed" : "Text") +
      "</span>" +
      (settings.enabled ? "<span>Enabled</span>" : "");
    const preview = renderDiscordMessagePreview({
      channelId: settings.channelId,
      mode: settings.mode === "embed" ? "embed" : "text",
      content: settings.message || "",
      title: settings.embedTitle || "Welcome!",
      description: settings.embedDescription || "",
      color: settings.embedColor || "#5865f2"
    });
    return renderActivePreviewCard("Welcome Message", meta, preview);
  }

  function renderReactionRolePanelPreview(panel) {
    const link = discordMessageLink(panel.channelId, panel.messageId);
    const roleSummary = (panel.options || []).map((o) => roleLabel(o.roleId)).join(", ");
    const meta =
      "<span>" +
      escapeHtml(channelLabel(panel.channelId)) +
      "</span>" +
      (roleSummary ? "<span>Roles: " + escapeHtml(roleSummary) + "</span>" : "") +
      (panel.createdAt ? "<span>Sent " + escapeHtml(formatPanelDate(panel.createdAt)) + "</span>" : "") +
      (link ? '<a href="' + escapeHtml(link) + '" target="_blank" rel="noopener">Open in Discord ↗</a>' : "");
    const preview = renderDiscordMessagePreview({
      channelId: panel.channelId,
      title: panel.title || "Reaction Roles",
      description: panel.description || "",
      color: panel.color || "#5865f2",
      footer: guildName() + " • Reaction Roles",
      buttons: (panel.options || []).map((o) => ({ label: o.label || roleLabel(o.roleId), style: "d-btn-secondary", emoji: o.emoji }))
    });
    return renderActivePreviewCard("Reaction Role Panel", meta, preview);
  }

  function initTheme() {
    const saved = localStorage.getItem("ph_theme") || "dark";
    document.documentElement.setAttribute("data-theme", saved);
    $("#theme-toggle")?.addEventListener("click", () => {
      const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("ph_theme", next);
    });
  }

  function showScreen(name) {
    ["loading", "login", "app"].forEach((id) => {
      const el = document.getElementById("screen-" + id);
      if (!el) return;
      const show = id === name;
      el.classList.toggle("hidden", !show);
      el.setAttribute("aria-hidden", show ? "false" : "true");
      if (show && "inert" in el) el.inert = false;
      else if ("inert" in el) el.inert = !show;
      if (show) {
        el.classList.remove("screen-enter");
        void el.offsetWidth;
        el.classList.add("screen-enter");
      }
    });
  }

  function moveNavIndicator() {
    const active = $(".nav-item.active");
    const indicator = $("#nav-indicator");
    const nav = $("#sidebar-nav");
    if (!active || !indicator || !nav) return;
    const navRect = nav.getBoundingClientRect();
    const itemRect = active.getBoundingClientRect();
    indicator.style.opacity = "1";
    indicator.style.transform = "translateY(" + (itemRect.top - navRect.top) + "px)";
    indicator.style.height = itemRect.height + "px";
  }

  function showLoginGate(message) {
    if (message) $("#login-gate-message").textContent = message;
    $("#header-user")?.classList.add("hidden");
    showScreen("login");
  }

  function showApp() {
    showScreen("app");
    requestAnimationFrame(moveNavIndicator);
  }

  function setLoginError(message) {
    const el = $("#login-error");
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("hidden", !message);
  }

  async function handleLogin(e) {
    if (e) e.preventDefault();
    setLoginError("");
    const password = $("#login-password")?.value || "";
    const btn = $("#login-submit");
    if (!password) return setLoginError("Enter your password.");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Logging in…";
    }
    try {
      const data = await PrestonHQ.api.login(password);
      await startDashboard(data);
    } catch (error) {
      setLoginError(error.message || "Invalid password.");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Enter Dashboard";
      }
    }
  }

  let eventsBound = false;
  let embedBuilderMounted = false;

  function bindDashboardEvents() {
    if (eventsBound) return;
    eventsBound = true;
    $("#guild-picker")?.addEventListener("change", async (e) => {
      state.guildId = e.target.value;
      localStorage.setItem("prestonhq_guild", state.guildId);
      embedBuilderMounted = false;
      PrestonHQ.embedBuilder?.unmount?.();
      await loadGuildMeta();
      renderActiveTab();
    });

    $$(".nav-item").forEach((btn) => btn.addEventListener("click", () => setTab(btn.dataset.tab)));

    $("#new-custom-command")?.addEventListener("click", () => showCustomCommandForm(null));
    $("#new-custom-reply")?.addEventListener("click", () => {
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

    window.addEventListener("resize", moveNavIndicator);

    $("#commands-save-all")?.addEventListener("click", () => saveAllCommandChanges());

    $("#logout-btn")?.addEventListener("click", async () => {
      await PrestonHQ.api.logout();
      embedBuilderMounted = false;
      if (window.PrestonHQ?.embedBuilder?.unmount) PrestonHQ.embedBuilder.unmount();
      showLoginGate("Signed out. Enter password to log in again.");
      setLoginError("");
    });
  }

  async function startDashboard(me) {
    try {
      if (me?.user) {
        state.user = me.user;
        $("#header-name").textContent = me.user.globalName || me.user.username;
        $("#header-user").classList.remove("hidden");
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
    moveNavIndicator();
    const panel = $("#tab-" + tab);
    $$(".tab-panel").forEach((p) => {
      if (p !== panel) p.classList.add("hidden");
    });
    panel.classList.remove("hidden", "tab-enter");
    void panel.offsetWidth;
    panel.classList.add("tab-enter");
    renderActiveTab();
  }

  async function renderOverview() {
    const [health, guild] = await Promise.all([
      PrestonHQ.api.health().catch(() => ({})),
      PrestonHQ.api.guild(state.guildId).catch(() => ({}))
    ]);
    $("#overview-stats").innerHTML = [
      stat("Bot Status", health.botReady ? "Online" : "Starting", health.botReady ? "success" : "status", 0),
      stat("Bot User", health.botUser || "—", "bot", 1),
      stat("Guilds", health.guildCount ?? "—", "guilds", 2),
      stat("Members", guild.memberCount ?? "—", "members", 3)
    ].join("");
    $("#overview-guild").innerHTML =
      '<div style="animation: statIn 0.5s var(--ease-out) 0.32s both">' +
      "<h3 style='margin-top:0;font-weight:800;letter-spacing:-0.02em'>" +
      escapeHtml(guild.name || "Server") +
      "</h3><p class='muted'>Guild ID: " +
      escapeHtml(state.guildId) +
      "</p><p class='muted'>Use the sidebar to manage modules for this server.</p></div>";
  }

  const STAT_ICONS = {
    status: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    bot: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/></svg>',
    guilds: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    members: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
  };

  function stat(label, value, tone, index) {
    const icon = STAT_ICONS[tone] || STAT_ICONS.status;
    const delay = (index || 0) * 0.08;
    return (
      '<div class="stat-card" style="animation-delay:' +
      delay +
      's"><div class="stat-icon">' +
      icon +
      '</div><div class="value">' +
      escapeHtml(String(value)) +
      '</div><div class="label">' +
      escapeHtml(label) +
      (tone === "success" ? ' <span class="badge badge-success">OK</span>' : "") +
      "</div></div>"
    );
  }

  let commandsDirty = new Set();

  function dedupeCommands(list) {
    const map = new Map();
    (list || []).forEach((cmd) => {
      const name = String(cmd.name || "").toLowerCase();
      const type = String(cmd.type || "slash").toLowerCase();
      const key = name + ":" + type;
      if (!name || map.has(key)) return;
      map.set(key, cmd);
    });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name) || String(a.type).localeCompare(String(b.type)));
  }

  function markCommandDirty(name) {
    if (!name) return;
    commandsDirty.add(name);
    const row = document.querySelector('[data-cmd-name="' + CSS.escape(name) + '"]');
    if (row) row.dataset.dirty = "true";
  }

  function clearCommandDirty(name) {
    commandsDirty.delete(name);
    const row = document.querySelector('[data-cmd-name="' + CSS.escape(name) + '"]');
    if (row) {
      row.removeAttribute("data-dirty");
      delete row.dataset.dirty;
    }
  }

  async function saveCommandRow(name) {
    const enabledEl = document.querySelector('[data-cmd-enabled="' + CSS.escape(name) + '"]');
    const cooldownEl = document.querySelector('[data-cmd-cooldown="' + CSS.escape(name) + '"]');
    const enabled = enabledEl?.checked ?? true;
    const cooldown = Math.max(0, Number(cooldownEl?.value || 0));
    await PrestonHQ.api.patchCommand(state.guildId, name, { enabled, cooldown });
    clearCommandDirty(name);
  }

  async function saveAllCommandChanges() {
    if (!commandsDirty.size) {
      toast("No unsaved changes", "success");
      return;
    }
    const names = [...commandsDirty];
    for (const name of names) {
      await saveCommandRow(name);
    }
    toast("Saved " + names.length + " command" + (names.length === 1 ? "" : "s"));
    await renderCommands();
  }

  async function renderCommands() {
    const data = await PrestonHQ.api.commands(state.guildId);
    const commands = dedupeCommands(data.commands || []);
    commandsDirty.clear();

    const rows = commands
      .map((cmd) => {
        const name = String(cmd.name || "").toLowerCase();
        const type = String(cmd.type || "slash").toLowerCase();
        const isSlash = type === "slash";
        const trigger = isSlash ? "/" + escapeHtml(name) : "!" + escapeHtml(name);
        const typeClass = isSlash ? "slash" : "prefix";
        return (
          '<tr data-cmd-name="' +
          escapeHtml(name) +
          '"><td><span class="cmd-trigger">' +
          trigger +
          '</span><br><span class="muted">' +
          escapeHtml(cmd.description || "No description") +
          '</span></td><td><span class="cmd-type-pill ' +
          typeClass +
          '">' +
          escapeHtml(type) +
          '</span></td><td><label class="cmd-toggle"><input type="checkbox" data-cmd-enabled="' +
          escapeHtml(name) +
          '" ' +
          (cmd.enabled !== false ? "checked" : "") +
          ' aria-label="Enable ' +
          escapeHtml(name) +
          '"><span class="cmd-toggle-ui"></span></label></td><td><input type="number" min="0" step="1" inputmode="numeric" data-cmd-cooldown="' +
          escapeHtml(name) +
          '" value="' +
          Number(cmd.cooldown || 0) +
          '" aria-label="Cooldown for ' +
          escapeHtml(name) +
          '"></td><td><button class="btn btn-sm btn-secondary" type="button" data-save-cmd="' +
          escapeHtml(name) +
          '">Save</button></td></tr>'
        );
      })
      .join("");

    $("#commands-table").innerHTML = rows || '<tr><td colspan="5" class="muted" style="padding:24px">No commands found for this server.</td></tr>';
    bindCommandsTableEvents();
  }

  function bindCommandsTableEvents() {
    const tbody = $("#commands-table");
    if (!tbody || tbody.dataset.bound === "1") return;
    tbody.dataset.bound = "1";

    tbody.addEventListener("change", (e) => {
      const t = e.target;
      if (t.matches("[data-cmd-enabled]")) markCommandDirty(t.dataset.cmdEnabled);
      if (t.matches("[data-cmd-cooldown]")) markCommandDirty(t.dataset.cmdCooldown);
    });

    tbody.addEventListener("input", (e) => {
      if (e.target.matches("[data-cmd-cooldown]")) markCommandDirty(e.target.dataset.cmdCooldown);
    });

    tbody.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-save-cmd]");
      if (!btn) return;
      const name = btn.dataset.saveCmd;
      if (!name) return;
      btn.disabled = true;
      try {
        await saveCommandRow(name);
        toast("Saved " + name);
      } catch (err) {
        toast(err.message || "Save failed", "error");
      } finally {
        btn.disabled = false;
      }
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
    const [data, panelData] = await Promise.all([
      PrestonHQ.api.sectionSettings(state.guildId, "tickets"),
      PrestonHQ.api.ticketPanels(state.guildId).catch(() => ({ panels: [] }))
    ]);
    const s = data.settings || {};
    const panels = panelData.panels || [];
    if (panels.length) {
      const sorted = [...panels].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      let previewHtml = "";
      if (sorted.length > 1) {
        previewHtml += '<p class="active-preview-note">' + sorted.length + " panels deployed — showing latest.</p>";
      }
      previewHtml += renderTicketPanelPreview(sorted[0]);
      setActivePreview("#tickets-active-preview", previewHtml);
    } else {
      setActivePreview("#tickets-active-preview", "");
    }

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
      await renderTickets();
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
      await renderTickets();
    };
  }

  async function renderWelcome() {
    const data = await PrestonHQ.api.sectionSettings(state.guildId, "welcome");
    const s = data.settings || {};
    if (s.channelId) {
      setActivePreview("#welcome-active-preview", renderWelcomeActivePreview(s));
    } else {
      setActivePreview("#welcome-active-preview", "");
    }

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
        enabled: true,
        channelId: $("#wl-channel").value,
        message: $("#wl-msg").value,
        embedTitle: $("#wl-title").value,
        embedDescription: $("#wl-desc").value,
        mode: $("#wl-mode").value
      });
      toast("Welcome settings saved");
      await renderWelcome();
    };
    $("#welcome-test-btn").onclick = async () => {
      await PrestonHQ.api.welcomeTest(state.guildId, {});
      toast("Welcome test sent");
    };
  }

  async function renderReactionRoles() {
    const panelData = await PrestonHQ.api.reactionRolePanels(state.guildId).catch(() => ({ panels: [] }));
    const panels = panelData.panels || [];
    if (panels.length) {
      const sorted = [...panels].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      let previewHtml = "";
      if (sorted.length > 1) {
        previewHtml += '<p class="active-preview-note">' + sorted.length + " panels deployed — showing latest.</p>";
      }
      previewHtml += renderReactionRolePanelPreview(sorted[0]);
      setActivePreview("#reaction-roles-active-preview", previewHtml);
    } else {
      setActivePreview("#reaction-roles-active-preview", "");
    }

    const latest = panels.length ? [...panels].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] : null;
    const latestOpt = latest?.options?.[0];

    $("#reaction-roles-form").innerHTML =
      field("Panel Title", "rr-title", latest?.title || "Reaction Roles") +
      field("Description", "rr-desc", latest?.description || "Click a button to toggle a role.", true) +
      '<div class="field"><label for="rr-channel">Channel</label><select id="rr-channel">' +
      channelOptions(latest?.channelId) +
      '</select></div><div class="field"><label for="rr-role">Role</label><select id="rr-role">' +
      roleOptions(latestOpt?.roleId) +
      '</select></div><div class="field"><label for="rr-label">Button Label</label><input id="rr-label" value="' +
      escapeHtml(latestOpt?.label || "Get Role") +
      '"></div>' +
      '<button id="rr-send" class="btn" type="button">Send Reaction Role Panel</button>';
    $("#rr-send").onclick = async () => {
      await PrestonHQ.api.sendReactionRolePanel(state.guildId, {
        channelId: $("#rr-channel").value,
        title: $("#rr-title").value,
        description: $("#rr-desc").value,
        options: [{ roleId: $("#rr-role").value, label: $("#rr-label").value }]
      });
      toast("Reaction role panel sent");
      await renderReactionRoles();
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

  async function renderEmbedBuilder() {
    const mount = $("#embed-builder-mount");
    if (!mount || !window.PrestonHQ?.embedBuilder) return;
    if (embedBuilderMounted) return;
    PrestonHQ.embedBuilder.mount(mount, {
      guildId: () => state.guildId,
      channelOptions: (selected) => channelOptions(selected),
      toast
    });
    embedBuilderMounted = true;
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
      if (state.tab === "embed-builder") await renderEmbedBuilder();
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

  async function boot() {
    showScreen("loading");
    initTheme();

    if (!window.PrestonHQ?.api) {
      showLoginGate("Scripts failed to load. Hard refresh (Ctrl+Shift+R).");
      return;
    }

    $("#login-form")?.addEventListener("submit", handleLogin);

    try {
      bindDashboardEvents();
    } catch (error) {
      console.error("bindDashboardEvents:", error);
    }

    try {
      const me = await PrestonHQ.api.me();
      if (me.authenticated) {
        await startDashboard(me);
        return;
      }
    } catch (error) {
      showLoginGate("Enter your dashboard password.");
      setLoginError(error.message || "");
      return;
    }

    showLoginGate("Enter your dashboard password.");
  }

  boot().catch((err) => {
    showLoginGate(err.message || "Failed to start dashboard.");
  });
})();
