(function () {
  window.PrestonHQ = window.PrestonHQ || {};

  const MAX_LINES = 40;

  PrestonHQ.debug = {
    log(step, detail) {
      const ts = new Date().toLocaleTimeString();
      const line = "[" + ts + "] " + step + (detail ? " — " + detail : "");
      console.log("[PrestonHQ]", line);

      const panel = document.getElementById("debug-log");
      if (panel) {
        const row = document.createElement("div");
        row.className = "debug-log-line";
        row.textContent = line;
        panel.appendChild(row);
        while (panel.children.length > MAX_LINES) panel.removeChild(panel.firstChild);
        panel.scrollTop = panel.scrollHeight;
      }

      fetch("/api/debug/client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: step,
          detail: detail || null,
          url: window.location.href,
          step: step,
          level: "info"
        })
      }).catch(function () {});
    },

    error(step, detail) {
      this.log("ERROR: " + step, detail);
      fetch("/api/debug/client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: step,
          detail: detail || null,
          url: window.location.href,
          step: step,
          level: "error"
        })
      }).catch(function () {});
    }
  };

  PrestonHQ.debug.log("Debug logger ready");
})();
