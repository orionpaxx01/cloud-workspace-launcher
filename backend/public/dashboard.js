/* Dashboard client for the Cloud Workspace Launcher backend.
 * Talks to the same REST API the extension uses:
 *   GET /workspaces, GET /workspaces/:id, POST /workspaces, DELETE /workspaces/:id
 * No dependencies beyond the browser's fetch.
 */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const statusDot = $("status-dot");
  const statusText = $("status-text");
  const rowsEl = $("rows");
  const searchInput = $("search");
  const refreshBtn = $("refresh");
  const toastEl = $("toast");
  const toastBody = $("toast-body");
  const toastClose = $("toast-close");

  let workspaces = [];

  function setStatus(state, text) {
    statusDot.className = "rounded-circle " + state;
    statusText.textContent = text;
  }

  function toast(message, kind) {
    toastBody.textContent = message;
    toastEl.className =
      "toast align-items-center text-bg-dark border-0 show " + (kind || "");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      toastEl.className = "toast align-items-center text-bg-dark border-0 d-none";
    }, 3500);
  }

  function fmtTime(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "short",
    });
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function api(path, opts) {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.status === 204 ? null : res.json();
  }

  async function load() {
    const q = searchInput.value.trim();
    const url = "/workspaces" + (q ? "?search=" + encodeURIComponent(q) : "");
    const data = await api(url);
    workspaces = data.workspaces || [];
    render();
  }

  function render() {
    if (workspaces.length === 0) {
      rowsEl.innerHTML =
        '<tr><td colspan="6" class="text-secondary text-center py-4">No workspaces yet. The extension will save them here.</td></tr>';
    } else {
      rowsEl.innerHTML = workspaces
        .map((w) => {
          const tabs = Array.isArray(w.snapshot?.tabs) ? w.snapshot.tabs : [];
          const name = escapeHtml(w.name || "(unnamed)");
          const id = escapeHtml(w.id);
          const summary = tabs
            .slice(0, 3)
            .map((t) => escapeHtml(t.title || t.url || ""))
            .join(", ");
          const more = tabs.length > 3 ? ` +${tabs.length - 3} more` : "";
          return `
            <tr>
              <td>
                <div class="fw-semibold text-truncate" title="${name}">${name}</div>
                <div class="text-secondary small text-truncate" title="${summary}">${summary || "no tabs"}${more}</div>
              </td>
              <td><code class="text-truncate">${id}</code></td>
              <td>${tabs.length}</td>
              <td>${fmtTime(w.updatedAt)}</td>
              <td>${fmtTime(w.createdAt)}</td>
              <td>
                <button class="btn btn-sm btn-outline-danger" data-delete="${escapeHtml(w.id)}">Delete</button>
              </td>
            </tr>`;
        })
        .join("");
    }

    // Stats
    $("stat-total").textContent = workspaces.length;
    const totalTabs = workspaces.reduce(
      (n, w) => n + (Array.isArray(w.snapshot?.tabs) ? w.snapshot.tabs.length : 0),
      0
    );
    $("stat-tabs").textContent = totalTabs;
    $("stat-store").textContent = "workspaces.json";
  }

  async function healthCheck() {
    try {
      const res = await fetch("/workspaces");
      if (res.ok) {
        setStatus("status-ok", "online");
        return true;
      }
      setStatus("status-err", `error ${res.status}`);
    } catch (e) {
      setStatus("status-err", "offline");
    }
    return false;
  }

  async function uptime() {
    const started = Date.now();
    try {
      await fetch("/workspaces");
      const ms = Date.now() - started;
      $("stat-uptime").textContent = ms + " ms";
    } catch {
      $("stat-uptime").textContent = "—";
    }
  }

  async function deleteWorkspace(id) {
    const ws = workspaces.find((w) => w.id === id);
    const label = ws?.name || id;
    if (!confirm(`Delete workspace "${label}"? This cannot be undone.`)) return;
    try {
      await api("/workspaces/" + encodeURIComponent(id), { method: "DELETE" });
      toast("Deleted " + label, "text-bg-danger");
      load();
    } catch (e) {
      toast("Delete failed: " + e.message, "text-bg-danger");
    }
  }

  // Wire up events.
  refreshBtn.addEventListener("click", load);
  searchInput.addEventListener("input", load);
  rowsEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-delete]");
    if (btn) deleteWorkspace(btn.dataset.delete);
  });
  toastClose.addEventListener("click", () => {
    toastEl.className = "toast align-items-center text-bg-dark border-0 d-none";
  });

  // Initial load.
  (async function init() {
    setStatus("status-warn", "connecting…");
    try {
      await load();
      await healthCheck();
      await uptime();
      setStatus("status-ok", "online");
    } catch (e) {
      setStatus("status-err", "offline");
      rowsEl.innerHTML =
        '<tr><td colspan="6" class="text-danger text-center py-4">Could not reach the backend: ' +
        escapeHtml(e.message) +
        "</td></tr>";
      toast("Backend unreachable", "text-bg-danger");
    }
    // Periodic refresh + health check.
    setInterval(() => {
      load().then(healthCheck).then(uptime);
    }, 15000);
  })();
})();