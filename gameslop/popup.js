(function () {
  const ext = (typeof browser !== 'undefined') ? browser : chrome;

  const STATUS_LABEL = {
    none: "Not Flagged",
    queued: "Queued",
    flagged: "Flagged",
    mixed: "Mixed",
    confirmed: "Confirmed",
    banned: "Banned"
  };

  function send(msg) {
    return new Promise((resolve) => {
      try {
        const r = ext.runtime.sendMessage(msg, (resp) => resolve(resp || {}));
        if (r && typeof r.then === "function") r.then(resolve).catch(() => resolve({}));
      } catch (e) { resolve({}); }
    });
  }

  const state = {
    data: null,
    activeTab: "stats",
    queueFilter: "all"
  };

  const tabs = document.querySelectorAll(".tab");
  const panels = {
    stats: document.getElementById("panel-stats"),
    queue: document.getElementById("panel-queue"),
    settings: document.getElementById("panel-settings")
  };

  tabs.forEach((t) => {
    t.addEventListener("click", () => {
      const name = t.dataset.tab;
      state.activeTab = name;
      tabs.forEach((x) => x.classList.toggle("active", x === t));
      for (const k of Object.keys(panels)) panels[k].classList.toggle("hidden", k !== name);
    });
  });

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function fmtDate(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleDateString() + " " + d.toLocaleTimeString().slice(0, 5);
  }

  function badgeClass(status) {
    if (status === "queued") return "badge-queued";
    if (status === "flagged") return "badge-flagged";
    if (status === "mixed") return "badge-mixed";
    if (status === "confirmed") return "badge-confirmed";
    if (status === "banned") return "badge-banned";
    return "badge-clean";
  }
  function dotClass(status) {
    if (status === "queued") return "dot-queued";
    if (status === "flagged") return "dot-flagged";
    if (status === "mixed") return "dot-mixed";
    if (status === "confirmed") return "dot-confirmed";
    if (status === "banned") return "dot-banned";
    return "dot-clean";
  }

  function computeStats(games) {
    const counts = { queued: 0, flagged: 0, mixed: 0, confirmed: 0, banned: 0, none: 0 };
    for (const g of Object.values(games || {})) {
      const s = g.status || "none";
      counts[s] = (counts[s] || 0) + 1;
    }
    return counts;
  }

  function renderStats() {
    const d = state.data || {};
    const c = computeStats(d.games || {});
    const flagged = c.flagged + c.queued + c.mixed + c.confirmed + c.banned;
    const confirmed = c.confirmed + c.banned;

    document.getElementById("g-flagged").textContent = fmtNum(flagged);
    document.getElementById("g-confirmed").textContent = fmtNum(confirmed);
    document.getElementById("g-mixed").textContent = fmtNum(c.mixed);
    document.getElementById("g-banned").textContent = fmtNum(c.banned);

    document.getElementById("r-sent").textContent = fmtNum(d.reportsSent || 0);
    document.getElementById("r-accepted").textContent = fmtNum(d.reportsAccepted || 0);
    document.getElementById("r-pending").textContent = fmtNum(c.queued);
    document.getElementById("r-rejected").textContent = fmtNum(d.reportsRejected || 0);

    document.getElementById("c-votes").textContent = fmtNum(d.totalVotes || 0);
    document.getElementById("c-queued").textContent = fmtNum(c.queued);

    const ls = document.getElementById("last-sync");
    if (ls) ls.textContent = d.lastSyncAt ? "Last sync: " + fmtDate(d.lastSyncAt) : "";

    document.getElementById("toggle-enabled").checked = d.enabled !== false;
  }

  function fmtNum(n) {
    n = Number(n) || 0;
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
  }

  function renderQueue() {
    const list = document.getElementById("queue-list");
    const d = state.data || {};
    const games = d.games || {};
    const arr = Object.values(games).filter((g) => {
      if (state.queueFilter === "all") return g.status && g.status !== "none";
      return g.status === state.queueFilter;
    }).sort((a, b) => (b.lastReportedAt || b.addedAt || 0) - (a.lastReportedAt || a.addedAt || 0));

    if (arr.length === 0) {
      list.innerHTML = `<div class="empty">No games in this view</div>`;
      return;
    }

    list.innerHTML = "";
    for (const g of arr) {
      const it = document.createElement("div");
      it.className = "q-item";
      const initials = (g.name || "?").trim().charAt(0).toUpperCase() || "?";
      const thumbHtml = g.thumb
        ? `<img src="${escapeHtml(g.thumb)}" alt="">`
        : `<span>${escapeHtml(initials)}</span>`;
      it.innerHTML = `
        <div class="q-thumb">${thumbHtml}</div>
        <div class="q-info">
          <div class="q-name" title="${escapeHtml(g.name || "")}">${escapeHtml(g.name || "(unknown)")}</div>
          <div class="q-meta">ID ${escapeHtml(g.id)} · ${escapeHtml(g.source || "manual")}${g.unlocked ? " · unlocked" : ""}</div>
          <div class="q-badge ${badgeClass(g.status)}">
            <span class="dot ${dotClass(g.status)}"></span>
            ${escapeHtml(STATUS_LABEL[g.status] || "Not Flagged")}
          </div>
        </div>
        <div class="q-actions">
          <button data-act="open" data-id="${escapeHtml(g.id)}" type="button">Open</button>
          <button data-act="toggle" data-id="${escapeHtml(g.id)}" type="button">${g.unlocked ? "Re-lock" : "Unlock"}</button>
          <button data-act="remove" class="danger" data-id="${escapeHtml(g.id)}" type="button">✕</button>
        </div>
      `;
      list.appendChild(it);
    }
  }

  document.getElementById("queue-filter").addEventListener("change", (e) => {
    state.queueFilter = e.target.value;
    renderQueue();
  });

  document.getElementById("queue-list").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const id = b.dataset.id;
    const act = b.dataset.act;
    if (act === "open") {
      try { ext.tabs.create({ url: "https://www.roblox.com/games/" + id }); } catch (err) {}
    } else if (act === "toggle") {
      const g = state.data.games[id];
      if (!g) return;
      if (g.unlocked) {
        await send({ action: "setStatus", gameId: id, status: g.status === "none" ? "flagged" : g.status, info: { name: g.name, thumb: g.thumb } });
      } else {
        await send({ action: "unlock", gameId: id, permanent: false });
      }
      loadAll();
    } else if (act === "remove") {
      await send({ action: "unlock", gameId: id, permanent: true });
      loadAll();
    }
  });

  document.getElementById("toggle-enabled").addEventListener("change", async () => {
    await send({ action: "toggleEnabled" });
    loadAll();
  });

  document.getElementById("refresh-stats").addEventListener("click", () => loadAll());

  document.getElementById("save-wh").addEventListener("click", async () => {
    const v = (document.getElementById("wh-url").value || "").trim();
    const r = await send({ action: "setWebhook", url: v });
    const st = document.getElementById("wh-status");
    if (r && r.ok) {
      document.getElementById("wh-url").value = "";
      st.textContent = v ? "Webhook saved" : "Webhook cleared";
      loadAll();
    } else {
      st.textContent = "Error: " + ((r && r.reason) || "unknown");
    }
  });

  document.getElementById("save-sync").addEventListener("click", async () => {
    const v = (document.getElementById("sync-url").value || "").trim();
    if (v && !/^https?:\/\//i.test(v)) {
      document.getElementById("sync-status").textContent = "Invalid URL";
      return;
    }
    await send({ action: "setRemoteSync", url: v });
    document.getElementById("sync-status").textContent = v ? "Saved and syncing" : "Sync disabled";
    setTimeout(loadAll, 600);
  });

  document.getElementById("force-sync").addEventListener("click", async () => {
    document.getElementById("sync-status").textContent = "Syncing...";
    const r = await send({ action: "forceSync" });
    if (r && r.lastSyncAt) {
      document.getElementById("sync-status").textContent = "Sync complete";
    } else {
      document.getElementById("sync-status").textContent = "Sync failed or not configured";
    }
    loadAll();
  });

  document.getElementById("clear-data").addEventListener("click", async () => {
    await send({ action: "clearData" });
    loadAll();
  });

  async function loadAll() {
    const s = await send({ action: "getState" });
    state.data = s || {};
    if (s && s.remoteSyncUrl) {
      document.getElementById("sync-url").value = s.remoteSyncUrl;
    }
    const whInfo = await send({ action: "hasWebhook" });
    const whSt = document.getElementById("wh-status");
    if (whInfo && whInfo.hasWebhook) {
      document.getElementById("wh-url").placeholder = "•••••••• (configured)";
      whSt.textContent = "Webhook configured";
    } else {
      whSt.textContent = "No custom webhook (using default)";
    }
    renderStats();
    renderQueue();
  }

  try {
    ext.storage.onChanged && ext.storage.onChanged.addListener((ch, area) => {
      if (area === "local") loadAll();
    });
  } catch (e) { }

  loadAll();
})();
