(function () {
  const COLOR_SWATCHES = ["#5865f2", "#57f287", "#fee75c", "#eb459e", "#ed4245", "#f47fff", "#ffffff", "#23272a", "#6366f1", "#8b5cf6", "#0ea5e9", "#14b8a6"];
  const VAR_CHIPS = ["{user}", "{server}", "{memberCount}", "{channel}", "{guild}", "{username}"];
  const QUICK_EMOJIS = ["✅", "❌", "⭐", "🎉", "🎫", "🔔", "🚀", "💎", "🔥", "👋", "📢", "🛒", "❤️", "⚡", "🎮"];

  const TEMPLATES = () => PrestonHQ.embedTemplates || {};

  let editorView = "visual";
  let state = { accentColor: "#5865f2", blocks: [] };
  let openSections = { v2blocks: true, persona: false };
  let helpers = null;
  let previewPersona = { name: "Nexora", avatar: "" };
  let history = { stack: [], index: -1, max: 40 };
  let autoSaveTimer = null;
  let previewFullscreen = false;
  let paletteOpen = false;
  let paletteFilter = "";
  let keyboardBound = false;
  let activeTemplateKey = "blank";
  let shellEventsBound = false;

  const PALETTE_CMDS = [
    { id: "send", label: "Send message", hint: "Ctrl+Enter", run: () => sendMessage() },
    { id: "export", label: "Export JSON file", hint: "Export", run: () => $("#eb-export")?.click() },
    { id: "copy", label: "Copy payload to clipboard", hint: "Copy", run: () => $("#eb-copy")?.click() },
    { id: "import", label: "Import JSON", hint: "Import", run: () => $("#eb-import")?.click() },
    { id: "undo", label: "Undo", hint: "Ctrl+Z", run: () => undo() },
    { id: "redo", label: "Redo", hint: "Ctrl+Shift+Z", run: () => redo() },
    { id: "draft", label: "Save draft", hint: "Ctrl+S", run: () => { autoSaveDraft(); helpers?.toast("Draft saved"); } },
    { id: "fullscreen", label: "Toggle preview fullscreen", hint: "Preview", run: () => $("#eb-fullscreen")?.click() },
    { id: "presets", label: "Open preset library", run: () => { $("#eb-presets-drawer")?.classList.add("open"); } },
    { id: "history", label: "Open send history", run: () => { $("#eb-history-drawer")?.classList.add("open"); renderHistoryList(); } },
    { id: "view-json", label: "Open JSON editor", run: () => { editorView = "json"; updateToolbarChrome(); } },
    { id: "view-visual", label: "Open visual editor", run: () => { editorView = "visual"; updateToolbarChrome(); } },
    { id: "accent-color", label: "Random accent color", run: () => { state.accentColor = COLOR_SWATCHES[Math.floor(Math.random() * COLOR_SWATCHES.length)]; recordHistory(); renderEditor(); updatePreview(); } },
    { id: "add-text-block", label: "Add text block", run: () => { state.blocks.push({ type: "text", content: "## Section\nContent" }); recordHistory(); renderEditor(); } },
    { id: "template-announcement", label: "Load template: Announcement", run: () => loadTemplate("announcement") },
    { id: "template-giveaway", label: "Load template: Giveaway", run: () => loadTemplate("giveaway") }
  ];

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return [...(root || document).querySelectorAll(sel)]; }

  function migrateClassicToV2(data) {
    if (data.blocks) return { accentColor: data.accentColor || "#5865f2", blocks: clone(data.blocks) };
    const e = (data.embeds || [])[0] || {};
    const blocks = [];
    if (data.content) blocks.push({ type: "text", content: data.content });
    if (e.title || e.description) {
      let text = (e.title ? "## " + e.title + "\n\n" : "") + (e.description || "");
      (e.fields || []).forEach((f) => { text += "\n\n**" + (f.name || "Field") + "**\n" + (f.value || ""); });
      blocks.push({ type: "text", content: text.trim() || "Migrated message" });
    }
    const rows = data.componentRows || data.buttonRows || [];
    rows.forEach((row) => {
      if (row.buttons?.length) blocks.push({ type: "buttons", buttons: clone(row.buttons) });
    });
    if (!blocks.length) blocks.push({ type: "text", content: "## New message\nComponents V2 layout" });
    return { accentColor: e.color || data.accentColor || "#5865f2", blocks };
  }

  function normalizeState(s) {
    if (!s) return clone(TEMPLATES().blank?.data || { accentColor: "#5865f2", blocks: [] });
    const raw = s.state || s;
    if (raw.blocks) {
      return { accentColor: raw.accentColor || "#5865f2", blocks: clone(raw.blocks) };
    }
    return migrateClassicToV2(raw);
  }

  function loadTemplate(key) {
    if (!key) return;
    const t = TEMPLATES()[key];
    if (!t) return;
    activeTemplateKey = key;
    state = normalizeState(clone(t.data));
    if (key === "blank" && helpers) {
      localStorage.removeItem("ph_embed_draft_" + helpers.guildId());
    }
    recordHistory();
    renderShell();
    helpers?.toast(key === "blank" ? "Canvas cleared" : "Loaded " + t.label);
  }

  function snapshot() { return { state: clone(state), previewPersona: clone(previewPersona) }; }

  function recordHistory() {
    const snap = snapshot();
    if (history.stack[history.index] && JSON.stringify(history.stack[history.index]) === JSON.stringify(snap)) return;
    history.stack = history.stack.slice(0, history.index + 1);
    history.stack.push(snap);
    if (history.stack.length > history.max) history.stack.shift();
    else history.index++;
    history.index = history.stack.length - 1;
    updateHistoryBtns();
  }

  function restoreHistory(idx) {
    const snap = history.stack[idx];
    if (!snap) return;
    state = normalizeState(clone(snap.state));
    previewPersona = snap.previewPersona || previewPersona;
    history.index = idx;
    updateHistoryBtns();
    renderEditor();
    updatePreview();
    updateValidation();
  }

  function undo() { if (history.index > 0) restoreHistory(history.index - 1); }
  function redo() { if (history.index < history.stack.length - 1) restoreHistory(history.index + 1); }

  function updateHistoryBtns() {
    const u = $("#eb-undo"), r = $("#eb-redo");
    if (u) u.disabled = history.index <= 0;
    if (r) r.disabled = history.index >= history.stack.length - 1;
  }

  function escapeHtml(str) {
    return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function parseMarkdown(text) {
    let html = escapeHtml(text || "");
    html = html.replace(/^### (.*)$/gm, "<h4>$1</h4>");
    html = html.replace(/^## (.*)$/gm, "<h3>$1</h3>");
    html = html.replace(/^# (.*)$/gm, "<h2>$1</h2>");
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    html = html.replace(/^- (.*)$/gm, "<li>$1</li>");
    html = html.replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>");
    html = html.replace(/\n/g, "<br>");
    return html;
  }

  function btnClass(style) {
    return ({ primary: "d-btn-primary", secondary: "d-btn-secondary", success: "d-btn-success", danger: "d-btn-danger", link: "d-btn-link" })[style] || "d-btn-secondary";
  }

  function charCount() {
    const text = (state.blocks || []).filter((b) => b.type === "text").map((b) => b.content).join("");
    return { desc: text.length, max: 4000, total: text.length };
  }

  function validate() {
    const issues = [];
    const cc = charCount();
    if (cc.desc > cc.max) issues.push({ level: "error", text: "Text exceeds " + cc.max + " characters" });
    if (!(state.blocks || []).length) issues.push({ level: "warn", text: "Add at least one V2 block" });
    (state.blocks || []).forEach((block, i) => {
      if (block.type === "buttons") {
        (block.buttons || []).forEach((b, j) => {
          if (b.style === "link" && !b.url) issues.push({ level: "warn", text: "Button block " + (i + 1) + " #" + (j + 1) + " missing URL" });
        });
      }
    });
    return issues;
  }

  function updateValidation() {
    const el = $("#eb-validation");
    if (!el) return;
    const issues = validate();
    if (!issues.length) {
      el.innerHTML = '<div class="eb-val eb-val-ok">✓ Ready to send</div>';
      return;
    }
    el.innerHTML = issues.map((i) => '<div class="eb-val eb-val-' + i.level + '">' + escapeHtml(i.text) + "</div>").join("");
  }

  function renderButtonsPreview(buttons) {
    return '<div class="d-action-row">' + (buttons || []).map((b) => '<span class="d-btn ' + btnClass(b.style) + '">' + (b.emoji ? b.emoji + " " : "") + escapeHtml(b.label || "Button") + "</span>").join("") + "</div>";
  }

  function renderPreview() {
    const avatarStyle = previewPersona.avatar ? ' style="background:url(' + escapeHtml(previewPersona.avatar) + ') center/cover"' : "";
    const blocks = (state.blocks || []).map((block) => {
      if (block.type === "text") return '<div class="v2-text">' + parseMarkdown(block.content) + "</div>";
      if (block.type === "separator") return '<div class="v2-separator' + (block.spacing === "large" ? " large" : "") + '"></div>';
      if (block.type === "buttons") return renderButtonsPreview(block.buttons);
      if (block.type === "media") return '<div class="v2-media-grid">' + (block.urls || []).filter(Boolean).map((u) => '<img src="' + escapeHtml(u) + '">').join("") + "</div>";
      return "";
    }).join("");
    const inner = '<div class="d-meta"><strong>' + escapeHtml(previewPersona.name) + '</strong> <span class="d-bot">BOT</span> <span class="d-v2-badge">V2</span></div>' +
      '<div class="v2-card" style="--v2-accent:' + escapeHtml(state.accentColor || "#5865f2") + '">' + (blocks || '<div class="eb-empty-preview">Add blocks →</div>') + "</div>";
    return '<div class="d-message"><div class="d-avatar"' + avatarStyle + "></div><div class=\"d-body\">" + inner + "</div></div>";
  }

  function updatePreview() {
    const el = $("#eb-preview");
    if (!el) return;
    el.innerHTML = renderPreview();
    const cc = charCount();
    const pill = $("#eb-char-pill");
    if (pill) {
      pill.textContent = cc.desc + "/" + cc.max;
      pill.classList.toggle("warn", cc.desc > cc.max * 0.85);
      pill.classList.toggle("over", cc.desc > cc.max);
    }
    const stats = $("#eb-stats");
    if (stats) stats.innerHTML = '<span class="eb-stat">' + (state.blocks || []).length + ' blocks</span><span class="eb-stat">Components V2</span>';
    updateValidation();
  }

  function getPayload() {
    return {
      channelId: $("#eb-channel")?.value,
      messageType: "v2",
      accentColor: state.accentColor,
      blocks: state.blocks
    };
  }

  function applyPayload(data) {
    activeTemplateKey = "";
    if (data.messageType === "v2" || data.blocks) {
      state = normalizeState({ accentColor: data.accentColor || "#5865f2", blocks: data.blocks || [] });
    } else {
      state = migrateClassicToV2(data);
      helpers?.toast("Converted classic layout to V2", "success");
    }
    recordHistory();
  }

  function presetsKey() { return "ph_studio_presets_" + helpers.guildId(); }
  function historyKey() { return "ph_studio_sent_" + helpers.guildId(); }

  function loadPresets() {
    try { return JSON.parse(localStorage.getItem(presetsKey()) || "[]"); } catch { return []; }
  }
  function savePresets(list) { localStorage.setItem(presetsKey(), JSON.stringify(list)); }

  function loadSendHistory() {
    try { return JSON.parse(localStorage.getItem(historyKey()) || "[]"); } catch { return []; }
  }
  function pushSendHistory(payload, result) {
    const list = loadSendHistory();
    list.unshift({ ts: Date.now(), payload, url: result?.url, channelId: payload.channelId });
    localStorage.setItem(historyKey(), JSON.stringify(list.slice(0, 20)));
  }

  function swatchesHtml(current, id) {
    return COLOR_SWATCHES.map((c) => '<button type="button" class="eb-swatch' + (c.toLowerCase() === (current || "").toLowerCase() ? " active" : "") + '" data-swatch="' + id + '" data-color="' + c + '" style="background:' + c + '"></button>').join("");
  }

  function accordion(id, icon, title, sub, body) {
    return '<div class="eb-accordion' + (openSections[id] ? " open" : "") + '" data-acc="' + id + '"><button type="button" class="eb-acc-head" data-toggle-acc="' + id + '">' +
      '<div class="eb-acc-head-left"><div class="eb-acc-icon">' + icon + '</div><div><div class="eb-acc-title">' + title + '</div><div class="eb-acc-sub">' + sub + '</div></div></div><span class="eb-acc-chevron">▾</span></button><div class="eb-acc-body">' + body + "</div></div>";
  }

  function mdBar(targetId) {
    return '<div class="eb-md-bar" data-md-target="' + targetId + '"><button type="button" class="eb-md-btn" data-md="**" title="Bold">B</button><button type="button" class="eb-md-btn" data-md="*" title="Italic"><em>I</em></button><button type="button" class="eb-md-btn" data-md="## " title="Heading">H</button><button type="button" class="eb-md-btn" data-md="- " title="List">•</button><button type="button" class="eb-md-btn" data-md="`" title="Code">`</button></div>';
  }

  function varChips(targetId) {
    return '<div class="eb-vars" data-var-target="' + targetId + '">' + VAR_CHIPS.map((v) => '<button type="button" class="eb-var-chip" data-var="' + v + '">' + v + "</button>").join("") + "</div>";
  }

  function emojiPicker(targetInput) {
    return '<div class="eb-emoji-grid" data-emoji-target="' + targetInput + '">' + QUICK_EMOJIS.map((e) => '<button type="button" class="eb-emoji-btn" data-emoji="' + e + '">' + e + "</button>").join("") + "</div>";
  }

  function renderButtonEditor(b, blockIdx, btnIdx) {
    const attrs = ' data-v2-block="' + blockIdx + '" data-v2-btn="' + btnIdx + '"';
    const styles = ["primary", "secondary", "success", "danger", "link"];
    const pills = styles.map((s) => '<button type="button" class="eb-style-pill' + (b.style === s ? " active" : "") + '" data-style="' + s + '"' + attrs + ">" + s + "</button>").join("");
    const emojiId = "emoji-v2-" + blockIdx + "-" + btnIdx;
    return '<div class="eb-field-card"' + attrs + '><div class="eb-field-card-head"><span class="eb-field-num">Button</span><button type="button" class="eb-icon-btn danger" data-rm-btn="' + blockIdx + ":" + btnIdx + '">×</button></div><div class="eb-style-pills">' + pills + '</div><div class="eb-grid-2"><div class="eb-field"><label class="eb-label">Label</label><input class="eb-input" data-bk="label" value="' + escapeHtml(b.label || "") + '"></div><div class="eb-field"><label class="eb-label">Emoji</label><input class="eb-input" id="' + emojiId + '" data-bk="emoji" value="' + escapeHtml(b.emoji || "") + '"></div></div>' + emojiPicker(emojiId) +
      '<div class="eb-grid-2"><div class="eb-field"><label class="eb-label">URL (link)</label><input class="eb-input" data-bk="url" value="' + escapeHtml(b.url || "") + '"></div><div class="eb-field"><label class="eb-label">Custom ID</label><input class="eb-input" data-bk="customId" value="' + escapeHtml(b.customId || "") + '"></div></div></div>';
  }

  function renderV2Visual() {
    const blocks = (state.blocks || []).map((block, i) => {
      const meta = { text: ["text", "Text", "📝"], separator: ["separator", "Sep", "➖"], buttons: ["buttons", "Buttons", "🔘"], media: ["media", "Media", "🖼"] };
      const t = meta[block.type] || meta.text;
      let body = "";
      if (block.type === "text") body = mdBar("block-text-" + i) + '<textarea class="eb-textarea eb-block-text" id="block-text-' + i + '" rows="5">' + escapeHtml(block.content || "") + "</textarea>" + varChips("block-text-" + i);
      if (block.type === "separator") body = '<select class="eb-input eb-block-spacing" data-block-idx="' + i + '"><option value="small"' + (block.spacing !== "large" ? " selected" : "") + '>Small</option><option value="large"' + (block.spacing === "large" ? " selected" : "") + '>Large</option></select>';
      if (block.type === "buttons") body = (block.buttons || []).map((b, bi) => renderButtonEditor(b, i, bi)).join("") + '<button type="button" class="btn btn-secondary btn-sm" data-add-v2btn="' + i + '">+ Button</button>';
      if (block.type === "media") body = '<textarea class="eb-textarea eb-block-urls" data-block-idx="' + i + '" rows="3" placeholder="Image URLs, one per line">' + escapeHtml((block.urls || []).join("\n")) + "</textarea>";
      return '<div class="eb-v2-block" data-block-idx="' + i + '"><div class="eb-v2-block-head"><div class="eb-v2-type"><span class="eb-v2-type-dot ' + t[0] + '"></span>' + t[2] + " " + t[1] + '</div><div class="eb-field-actions"><button type="button" class="eb-icon-btn" data-dup-block="' + i + '">⧉</button><button type="button" class="eb-icon-btn" data-move-block="' + i + '" data-dir="-1">↑</button><button type="button" class="eb-icon-btn" data-move-block="' + i + '" data-dir="1">↓</button><button type="button" class="eb-icon-btn danger" data-rm-block="' + i + '">×</button></div></div><div class="eb-v2-block-body">' + body + "</div></div>";
    }).join("");

    return accordion("v2blocks", "⚡", "Components V2", "Text · separators · buttons · media",
      '<div class="eb-field"><label class="eb-label">Accent</label><div class="eb-color-row"><input type="color" id="eb-v2-accent" value="' + escapeHtml((state.accentColor || "#5865f2").replace(/^#?/, "#")) + '"><button type="button" class="btn btn-secondary btn-sm" id="eb-random-v2-color">🎲</button><div class="eb-swatches">' + swatchesHtml(state.accentColor, "eb-v2-accent") + "</div></div></div>" +
      '<div class="eb-add-block-grid"><button type="button" class="eb-add-block-btn" data-add-block="text"><span>📝</span>Text</button><button type="button" class="eb-add-block-btn" data-add-block="separator"><span>➖</span>Separator</button><button type="button" class="eb-add-block-btn" data-add-block="buttons"><span>🔘</span>Buttons</button><button type="button" class="eb-add-block-btn" data-add-block="media"><span>🖼</span>Media</button></div><div class="eb-blocks-list">' + blocks + "</div>") +
      accordion("persona", "🤖", "Preview Persona", "Customize preview bot", '<div class="eb-grid-2"><div class="eb-field"><label class="eb-label">Display Name</label><input class="eb-input" id="eb-persona-name" value="' + escapeHtml(previewPersona.name) + '"></div><div class="eb-field"><label class="eb-label">Avatar URL</label><input class="eb-input" id="eb-persona-avatar" value="' + escapeHtml(previewPersona.avatar) + '"></div></div>');
  }

  function renderJsonEditor() {
    return '<textarea class="eb-json-editor" id="eb-json" spellcheck="false">' + escapeHtml(JSON.stringify(getPayload(), null, 2)) + "</textarea>";
  }

  function renderPresetsPanel() {
    const custom = loadPresets();
    const built = Object.entries(TEMPLATES()).map(([k, t]) => '<button type="button" class="eb-preset-card" data-builtin="' + k + '"><span class="eb-preset-icon">' + (t.label.split(" ")[0] || "📄") + '</span><span class="eb-preset-name">' + escapeHtml(t.label.replace(/^[^\s]+\s/, "")) + '</span><span class="eb-preset-tag">Built-in</span></button>').join("");
    const user = custom.map((p, i) => '<button type="button" class="eb-preset-card" data-custom-idx="' + i + '"><span class="eb-preset-icon">💾</span><span class="eb-preset-name">' + escapeHtml(p.name) + '</span><button type="button" class="eb-preset-del" data-del-preset="' + i + '">×</button></button>').join("");
    return '<div class="eb-drawer" id="eb-presets-drawer"><div class="eb-drawer-head"><h4>Template Library</h4><button type="button" class="eb-icon-btn" id="eb-close-presets">×</button></div><div class="eb-preset-grid">' + built + user + '</div><button type="button" class="btn btn-secondary btn-sm btn-full" id="eb-save-preset">💾 Save Current as Preset</button></div>';
  }

  function renderHistoryPanel() {
    const items = loadSendHistory();
    const rows = items.length ? items.map((h, i) => '<button type="button" class="eb-history-item" data-hist="' + i + '"><span class="eb-hist-time">' + new Date(h.ts).toLocaleString() + '</span><span class="eb-hist-meta">' + escapeHtml(h.payload?.messageType || "v2") + " → " + escapeHtml(h.channelId || "?") + '</span></button>').join("") : '<p class="muted">No sends yet this session.</p>';
    return '<div class="eb-drawer" id="eb-history-drawer"><div class="eb-drawer-head"><h4>Send History</h4><button type="button" class="eb-icon-btn" id="eb-close-history">×</button></div>' + rows + "</div>";
  }

  function syncButtonFromEl(el) {
    return {
      label: el.querySelector('[data-bk="label"]')?.value || "Button",
      style: el.querySelector(".eb-style-pill.active")?.dataset.style || "secondary",
      emoji: el.querySelector('[data-bk="emoji"]')?.value || undefined,
      url: el.querySelector('[data-bk="url"]')?.value || "",
      customId: el.querySelector('[data-bk="customId"]')?.value || ""
    };
  }

  function syncFromVisual() {
    previewPersona.name = $("#eb-persona-name")?.value || previewPersona.name;
    previewPersona.avatar = $("#eb-persona-avatar")?.value || "";
    state.accentColor = $("#eb-v2-accent")?.value || "#5865f2";
    state.blocks = $$(".eb-v2-block").map((block) => {
      const idx = block.dataset.blockIdx;
      const dot = block.querySelector(".eb-v2-type-dot");
      if (dot?.classList.contains("separator")) return { type: "separator", spacing: block.querySelector(".eb-block-spacing")?.value || "small" };
      if (dot?.classList.contains("buttons")) return { type: "buttons", buttons: [...block.querySelectorAll(".eb-field-card[data-v2-block]")].map(syncButtonFromEl) };
      if (dot?.classList.contains("media")) return { type: "media", urls: (block.querySelector(".eb-block-urls")?.value || "").split("\n").map((s) => s.trim()).filter(Boolean) };
      return { type: "text", content: $("#block-text-" + idx)?.value || "" };
    });
  }

  function insertAtCursor(el, text) {
    if (!el) return;
    const start = el.selectionStart, end = el.selectionEnd, val = el.value;
    el.value = val.slice(0, start) + text + val.slice(end);
    el.selectionStart = el.selectionEnd = start + text.length;
    el.focus();
  }

  function commitChange(renderFull) {
    syncFromVisual();
    recordHistory();
    if (renderFull) renderEditor();
    else updatePreview();
    autoSaveDraft();
  }

  function releaseControlFocus() {
    const ae = document.activeElement;
    if (ae?.blur && ae.matches?.("input, textarea, select") && ae.closest("#embed-builder-root")) ae.blur();
  }

  function updateToolbarChrome() {
    $$("[data-view]").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === editorView));
    renderEditor();
    updateValidation();
  }

  function autoSaveDraft() {
    localStorage.setItem("ph_embed_draft_" + helpers.guildId(), JSON.stringify(snapshot()));
  }

  function bindEditorEvents() {
    const editor = $("#eb-editor-panel");
    if (!editor || editor.dataset.ebBound === "1") return;
    editor.dataset.ebBound = "1";

    editor.addEventListener("input", () => { syncFromVisual(); updatePreview(); });
    editor.addEventListener("change", () => { syncFromVisual(); updatePreview(); });

    editor.addEventListener("mousedown", (e) => {
      if (e.target.closest("button, .eb-swatch, .eb-md-btn, .eb-var-chip, .eb-emoji-btn, .eb-style-pill, .eb-acc-head, label.eb-toggle")) {
        e.preventDefault();
      }
    });

    editor.addEventListener("click", (e) => {
      const act = (fn, full) => { fn(); commitChange(full !== false); };
      const actLight = (fn) => { fn(); commitChange(false); };

      if (e.target.closest("[data-toggle-acc]")) {
        const id = e.target.closest("[data-toggle-acc]").dataset.toggleAcc;
        openSections[id] = !openSections[id];
        e.target.closest(".eb-accordion").classList.toggle("open");
        releaseControlFocus();
        return;
      }
      if (e.target.closest("[data-swatch]")) {
        const s = e.target.closest("[data-swatch]");
        $("#" + s.dataset.swatch).value = s.dataset.color;
        return actLight(() => {});
      }
      if (e.target.closest(".eb-md-btn")) {
        const ta = $("#" + e.target.closest(".eb-md-bar").dataset.mdTarget);
        insertAtCursor(ta, e.target.closest(".eb-md-btn").dataset.md);
        syncFromVisual();
        recordHistory();
        updatePreview();
        autoSaveDraft();
        return;
      }
      if (e.target.closest(".eb-var-chip")) {
        insertAtCursor($("#" + e.target.closest(".eb-vars").dataset.varTarget), e.target.closest(".eb-var-chip").dataset.var);
        syncFromVisual();
        recordHistory();
        updatePreview();
        autoSaveDraft();
        return;
      }
      if (e.target.closest(".eb-emoji-btn")) {
        const id = e.target.closest(".eb-emoji-grid").dataset.emojiTarget;
        const inp = $("#" + id);
        if (inp) inp.value = e.target.closest(".eb-emoji-btn").dataset.emoji;
        return actLight(() => {});
      }
      if (e.target.closest("#eb-random-v2-color")) return actLight(() => { state.accentColor = COLOR_SWATCHES[Math.floor(Math.random() * COLOR_SWATCHES.length)]; });
      if (e.target.closest("[data-rm-btn]")) return act(() => { const [r, b] = e.target.closest("[data-rm-btn]").dataset.rmBtn.split(":").map(Number); state.blocks[r].buttons.splice(b, 1); });
      if (e.target.closest(".eb-style-pill")) {
        e.target.closest(".eb-style-pills").querySelectorAll(".eb-style-pill").forEach((p) => p.classList.remove("active"));
        e.target.closest(".eb-style-pill").classList.add("active");
        syncFromVisual();
        updatePreview();
        return;
      }
      if (e.target.closest("[data-add-block]")) return act(() => { const t = e.target.closest("[data-add-block]").dataset.addBlock; const m = { text: { type: "text", content: "## Section\nContent" }, separator: { type: "separator", spacing: "small" }, buttons: { type: "buttons", buttons: [{ label: "Go", style: "primary" }] }, media: { type: "media", urls: [] } }; state.blocks.push(m[t]); });
      if (e.target.closest("[data-rm-block]")) return act(() => { state.blocks.splice(Number(e.target.closest("[data-rm-block]").dataset.rmBlock), 1); });
      if (e.target.closest("[data-dup-block]")) return act(() => { const i = Number(e.target.closest("[data-dup-block]").dataset.dupBlock); state.blocks.splice(i + 1, 0, clone(state.blocks[i])); });
      if (e.target.closest("[data-move-block]")) {
        const m = e.target.closest("[data-move-block]");
        return act(() => { const i = Number(m.dataset.moveBlock), d = Number(m.dataset.dir); if (state.blocks[i + d]) { const t = state.blocks[i]; state.blocks[i] = state.blocks[i + d]; state.blocks[i + d] = t; } });
      }
      if (e.target.closest("[data-add-v2btn]")) return act(() => { state.blocks[Number(e.target.closest("[data-add-v2btn]").dataset.addV2btn)].buttons.push({ label: "Btn", style: "secondary" }); });
    });
  }

  function bindShellEvents(root) {
    if (shellEventsBound) return;
    shellEventsBound = true;

    root.addEventListener("change", (e) => {
      if (e.target.id === "eb-template") {
        const key = e.target.value;
        if (key) loadTemplate(key);
        else activeTemplateKey = "";
      }
      if (e.target.id === "eb-channel") {
        const ch = e.target.selectedOptions[0]?.text || "";
        const bar = $(".discord-frame-bar span");
        if (bar) bar.textContent = "# " + ch.replace(/^#?\s*/, "");
      }
    });

    root.addEventListener("input", (e) => {
      if (e.target.id === "eb-palette-input") {
        paletteFilter = e.target.value;
        renderPaletteList();
      }
    });

    root.addEventListener("click", (e) => {
      if (e.target.closest("[data-view]")) {
        const btn = e.target.closest("[data-view]");
        if (editorView === "visual") syncFromVisual();
        else try { applyPayload(JSON.parse($("#eb-json").value)); } catch { helpers.toast("Invalid JSON", "error"); return; }
        editorView = btn.dataset.view;
        updateToolbarChrome();
        return;
      }
      if (e.target.closest("#eb-undo")) return undo();
      if (e.target.closest("#eb-redo")) return redo();
      if (e.target.closest("#eb-import")) {
        const raw = prompt("Paste JSON:");
        if (!raw) return;
        try { applyPayload(JSON.parse(raw)); editorView = "visual"; renderShell(); helpers.toast("Imported"); } catch { helpers.toast("Invalid JSON", "error"); }
        return;
      }
      if (e.target.closest("#eb-export")) {
        syncFromVisual();
        const blob = new Blob([JSON.stringify(getPayload(), null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "message-v2-" + Date.now() + ".json";
        a.click();
        helpers.toast("Exported JSON file");
        return;
      }
      if (e.target.closest("#eb-copy")) {
        syncFromVisual();
        navigator.clipboard.writeText(JSON.stringify(getPayload(), null, 2)).then(() => helpers.toast("Copied")).catch(() => null);
        return;
      }
      if (e.target.closest("#eb-save-draft")) { autoSaveDraft(); helpers.toast("Draft saved"); return; }
      if (e.target.closest("#eb-send")) return sendMessage();
      if (e.target.closest("#eb-open-presets")) { $("#eb-presets-drawer")?.classList.add("open"); return; }
      if (e.target.closest("#eb-close-presets")) { $("#eb-presets-drawer")?.classList.remove("open"); return; }
      if (e.target.closest("#eb-open-history")) { $("#eb-history-drawer")?.classList.add("open"); renderHistoryList(); return; }
      if (e.target.closest("#eb-close-history")) { $("#eb-history-drawer")?.classList.remove("open"); return; }
      if (e.target.closest("#eb-save-preset")) {
        syncFromVisual();
        const name = prompt("Preset name:");
        if (!name) return;
        const list = loadPresets();
        list.push({ name, state: clone(state), created: Date.now() });
        savePresets(list);
        renderShell();
        helpers.toast("Preset saved");
        return;
      }
      if (e.target.closest("#eb-fullscreen")) {
        previewFullscreen = !previewFullscreen;
        $(".eb-panel-preview")?.classList.toggle("eb-fullscreen", previewFullscreen);
        const btn = $("#eb-fullscreen");
        if (btn) btn.textContent = previewFullscreen ? "Exit ⤢" : "Full ⤢";
        return;
      }
      if (e.target.closest("[data-palette-close]") || e.target.closest(".eb-palette-backdrop")) return closePalette();
      if (e.target.closest("[data-builtin]")) {
        loadTemplate(e.target.closest("[data-builtin]").dataset.builtin);
        return;
      }
      if (e.target.closest("[data-custom-idx]") && !e.target.closest(".eb-preset-del")) {
        const p = loadPresets()[Number(e.target.closest("[data-custom-idx]").dataset.customIdx)];
        if (p) { activeTemplateKey = ""; state = normalizeState(clone(p.state)); recordHistory(); renderShell(); helpers.toast("Loaded " + p.name); }
        return;
      }
      if (e.target.closest("[data-del-preset]")) {
        e.stopPropagation();
        const list = loadPresets();
        list.splice(Number(e.target.closest("[data-del-preset]").dataset.delPreset), 1);
        savePresets(list);
        renderShell();
        return;
      }
      if (e.target.closest("[data-hist]")) {
        const histEl = e.target.closest("[data-hist]");
        const idx = Number(histEl?.dataset.hist);
        const h = loadSendHistory()[idx];
        if (h?.payload) { applyPayload(h.payload); editorView = "visual"; renderShell(); helpers.toast("Restored from history"); }
      }
    });
  }

  function renderHistoryList() {
    const drawer = $("#eb-history-drawer");
    if (!drawer) return;
    const items = loadSendHistory();
    drawer.querySelector(".eb-drawer-body")?.remove();
    const body = document.createElement("div");
    body.className = "eb-drawer-body";
    body.innerHTML = items.length ? items.map((h, i) => '<button type="button" class="eb-history-item" data-hist="' + i + '"><span class="eb-hist-time">' + new Date(h.ts).toLocaleString() + '</span><span class="eb-hist-meta">' + escapeHtml(h.payload?.messageType || "v2") + (h.url ? ' · <a href="' + escapeHtml(h.url) + '" target="_blank">open</a>' : "") + "</span></button>").join("") : '<p class="muted" style="padding:12px">No messages sent yet.</p>';
    drawer.appendChild(body);
  }

  async function sendMessage() {
    if (editorView === "visual") syncFromVisual();
    else try { applyPayload(JSON.parse($("#eb-json").value)); } catch { return helpers.toast("Fix JSON first", "error"); }
    const payload = getPayload();
    if (!payload.channelId) return helpers.toast("Select a channel", "error");
    if (validate().some((v) => v.level === "error")) return helpers.toast("Fix errors before sending", "error");
    try {
      const result = await PrestonHQ.api.sendMessage(helpers.guildId(), payload);
      pushSendHistory(payload, result);
      helpers.toast("Sent ✓ · " + (result.url ? "Message live" : "Delivered"));
    } catch (err) { helpers.toast(err.message || "Send failed", "error"); }
  }

  function bindKeyboard() {
    if (keyboardBound) return;
    keyboardBound = true;
    document.addEventListener("keydown", (e) => {
      if (!$("#embed-builder-root")) return;
      if (paletteOpen) {
        if (e.key === "Escape") { e.preventDefault(); closePalette(); return; }
        if (e.key === "Enter" && e.target?.id !== "eb-palette-input") {
          const active = $(".eb-palette-item.active");
          if (active) { e.preventDefault(); runPaletteCommand(active.dataset.paletteId); closePalette(); }
          return;
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          if (document.activeElement?.id === "eb-palette-input") return;
          e.preventDefault();
          movePaletteSelection(e.key === "ArrowDown" ? 1 : -1);
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); openPalette(); return; }
      if (e.ctrlKey && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      if (e.ctrlKey && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
      if (e.ctrlKey && e.key === "s") { e.preventDefault(); autoSaveDraft(); helpers?.toast("Draft saved"); }
      if (e.ctrlKey && e.key === "Enter") { e.preventDefault(); sendMessage(); }
    });
  }

  function openPalette() {
    paletteOpen = true;
    paletteFilter = "";
    const el = $("#eb-palette");
    if (!el) return;
    el.classList.remove("hidden");
    const inp = $("#eb-palette-input");
    if (inp) inp.value = "";
    renderPaletteList();
    inp?.focus();
  }

  function closePalette() {
    paletteOpen = false;
    paletteFilter = "";
    $("#eb-palette")?.classList.add("hidden");
  }

  function filteredPaletteCommands() {
    const q = paletteFilter.trim().toLowerCase();
    if (!q) return PALETTE_CMDS;
    return PALETTE_CMDS.filter((c) => c.label.toLowerCase().includes(q) || c.id.includes(q));
  }

  function renderPaletteList() {
    const list = $("#eb-palette-list");
    if (!list) return;
    const cmds = filteredPaletteCommands();
    list.innerHTML = cmds.length
      ? cmds.map((c, i) => '<button type="button" class="eb-palette-item' + (i === 0 ? " active" : "") + '" data-palette-id="' + escapeHtml(c.id) + '"><span>' + escapeHtml(c.label) + '</span><kbd>' + escapeHtml(c.hint || "") + '</kbd></button>').join("")
      : '<p class="muted" style="padding:16px">No matching commands</p>';
    list.querySelectorAll(".eb-palette-item").forEach((btn) => {
      btn.addEventListener("click", () => { runPaletteCommand(btn.dataset.paletteId); closePalette(); });
    });
  }

  function movePaletteSelection(dir) {
    const nodes = $$(".eb-palette-item", $("#eb-palette-list"));
    if (!nodes.length) return;
    let idx = nodes.findIndex((n) => n.classList.contains("active"));
    if (idx < 0) idx = 0;
    idx = Math.max(0, Math.min(nodes.length - 1, idx + dir));
    nodes.forEach((n, i) => n.classList.toggle("active", i === idx));
  }

  function runPaletteCommand(id) {
    const cmd = PALETTE_CMDS.find((c) => c.id === id);
    if (cmd) cmd.run();
  }

  function renderEditor() {
    const panel = $("#eb-editor-panel");
    if (!panel) return;
    panel.innerHTML = editorView === "json" ? renderJsonEditor() : renderV2Visual();
    bindEditorEvents();
    updatePreview();
    releaseControlFocus();
  }

  function renderShell() {
    const root = $("#embed-builder-root");
    if (!root || !helpers) return;
    const savedChannel = $("#eb-channel")?.value || "";
    const templateOpts =
      '<option value="">Custom</option>' +
      Object.entries(TEMPLATES()).map(([k, t]) => '<option value="' + escapeHtml(k) + '">' + escapeHtml(t.label) + "</option>").join("");
    const ch = $("#eb-channel")?.selectedOptions?.[0]?.text || "general";

    root.innerHTML =
      '<div class="eb-studio eb-legendary">' +
      '<div class="eb-studio-header"><div class="eb-studio-brand"><div class="eb-studio-icon">⚡</div><div><h3>Message Studio</h3><p>Components V2 only · <kbd class="eb-inline-kbd">Ctrl+K</kbd> commands</p></div></div>' +
      '<div class="eb-header-actions">' +
      '<button type="button" class="eb-icon-btn" id="eb-undo" title="Undo (Ctrl+Z)">↩</button><button type="button" class="eb-icon-btn" id="eb-redo" title="Redo">↪</button>' +
      '<button type="button" class="btn btn-secondary btn-sm" id="eb-open-presets">📚 Library</button>' +
      '<button type="button" class="btn btn-secondary btn-sm" id="eb-open-history">🕐 History</button>' +
      '<select class="eb-select-sm" id="eb-template">' + templateOpts + '</select>' +
      '<span class="eb-v2-only-badge">V2</span>' +
      '<button type="button" class="btn btn-secondary btn-sm" id="eb-copy" title="Copy JSON">Copy</button>' +
      '<button type="button" class="btn btn-secondary btn-sm" id="eb-save-draft" title="Save draft (Ctrl+S)">Draft</button>' +
      '<button type="button" class="btn btn-secondary btn-sm" id="eb-import">Import</button><button type="button" class="btn btn-secondary btn-sm" id="eb-export">Export</button>' +
      '<button type="button" class="btn btn-sm" id="eb-send">Send ↗</button></div></div>' +
      '<div class="eb-studio-bar"><div class="eb-channel-wrap"><select id="eb-channel">' + helpers.channelOptions() + '</select></div>' +
      '<div class="eb-bar-meta"><span class="eb-char-pill" id="eb-char-pill">0</span><span id="eb-stats"></span>' +
      '<div class="eb-segment"><button type="button" class="eb-seg-btn' + (editorView === "visual" ? " active" : "") + '" data-view="visual">Visual</button><button type="button" class="eb-seg-btn' + (editorView === "json" ? " active" : "") + '" data-view="json">{ } JSON</button></div></div></div>' +
      '<div id="eb-validation" class="eb-validation-strip"></div>' +
      '<div class="eb-studio-body"><div class="eb-panel-editor"><div id="eb-editor-panel"></div></div>' +
      '<div class="eb-panel-preview"><div class="eb-preview-label"><span>Live Preview</span><div><button type="button" class="btn btn-secondary btn-sm" id="eb-fullscreen">Full ⤢</button> <span class="eb-preview-live">Synced</span></div></div>' +
      '<div class="discord-frame"><div class="discord-frame-bar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18"/></svg><span># ' + escapeHtml(ch.replace(/^#?\s*/, "")) + '</span></div><div class="discord-preview" id="eb-preview"></div></div></div></div>' +
      renderPresetsPanel() + renderHistoryPanel() +
      '<div id="eb-palette" class="eb-palette hidden" role="dialog" aria-label="Command palette"><div class="eb-palette-backdrop" data-palette-close></div>' +
      '<div class="eb-palette-dialog"><div class="eb-palette-search">⚡ <input id="eb-palette-input" type="search" placeholder="Type a command…" autocomplete="off" spellcheck="false" /></div>' +
      '<div id="eb-palette-list" class="eb-palette-list"></div>' +
      '<p class="eb-palette-foot muted">↑↓ navigate · Enter run · Esc close · <kbd>Ctrl</kbd>+<kbd>K</kbd></p></div></div>' +
      "</div>";

    bindShellEvents(root);
    if (savedChannel) $("#eb-channel").value = savedChannel;
    const tpl = $("#eb-template");
    if (tpl) tpl.value = activeTemplateKey || "";
    updateHistoryBtns();
    renderEditor();
  }

  PrestonHQ.embedBuilder = {
    mount(rootEl, h) {
      helpers = h;
      history = { stack: [], index: -1, max: 40 };
      shellEventsBound = false;
      activeTemplateKey = "blank";
      const draft = localStorage.getItem("ph_embed_draft_" + h.guildId());
      if (draft) {
        try {
          const d = JSON.parse(draft);
          state = normalizeState(d.state || d);
          previewPersona = d.previewPersona || { name: "Nexora", avatar: "" };
          activeTemplateKey = "";
        } catch {
          state = normalizeState(clone(TEMPLATES().blank?.data || {}));
          activeTemplateKey = "blank";
        }
      } else {
        state = normalizeState(clone(TEMPLATES().blank?.data || {}));
        activeTemplateKey = "blank";
      }
      editorView = "visual";
      rootEl.innerHTML = '<div id="embed-builder-root"></div>';
      recordHistory();
      renderShell();
      bindKeyboard();
      clearInterval(autoSaveTimer);
      autoSaveTimer = setInterval(autoSaveDraft, 30000);
    },
    unmount() {
      clearInterval(autoSaveTimer);
      keyboardBound = false;
      shellEventsBound = false;
      paletteOpen = false;
      $("#eb-editor-panel")?.removeAttribute("data-eb-bound");
      $("#embed-builder-root")?.remove();
    }
  };
})();
