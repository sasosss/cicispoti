(function () {
  const ext = (typeof browser !== 'undefined') ? browser : chrome;

  const STATUS_LABEL = {
    none: "Not Flagged",
    queued: "Pending",
    flagged: "Flagged",
    mixed: "Mixed",
    confirmed: "Confirmed AI",
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
    tab: "overview",
    creatorsTab: "owners",
    gamesFilter: "all",
    gamesSearch: ""
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function fmtNum(n) {
    n = Number(n) || 0;
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
  }

  function fmtDate(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    return d.toLocaleDateString() + " " + d.toLocaleTimeString().slice(0, 5);
  }

  function badgeClass(status) {
    return "b-" + (status || "clean");
  }

  function computeGameStats(games) {
    const c = { queued: 0, flagged: 0, mixed: 0, confirmed: 0, banned: 0, none: 0 };
    for (const g of Object.values(games || {})) {
      const s = g.status || "none";
      c[s] = (c[s] || 0) + 1;
    }
    return c;
  }

  $$(".nav-btn").forEach((b) => {
    b.addEventListener("click", () => {
      state.tab = b.dataset.tab;
      $$(".nav-btn").forEach((x) => x.classList.toggle("active", x === b));
      $$(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + state.tab));
    });
  });

  $$(".mini-tab").forEach((b) => {
    b.addEventListener("click", () => {
      state.creatorsTab = b.dataset.mini;
      $$(".mini-tab").forEach((x) => x.classList.toggle("active", x === b));
      $("#owners-list").style.display = state.creatorsTab === "owners" ? "" : "none";
      $("#groups-list").style.display = state.creatorsTab === "groups" ? "" : "none";
    });
  });

  function renderOverview() {
    const d = state.data || {};
    const c = computeGameStats(d.games || {});
    const flagged = c.flagged + c.queued + c.mixed + c.confirmed + c.banned;
    const confirmed = c.confirmed;
    const banned = c.banned;
    const queued = c.queued + c.mixed + c.flagged;

    $("#ov-flagged").textContent = fmtNum(flagged);
    $("#ov-confirmed").textContent = fmtNum(confirmed);
    $("#ov-queued").textContent = fmtNum(queued);
    $("#ov-banned").textContent = fmtNum(banned);

    $("#ov-rsent").textContent = fmtNum(d.reportsSent || 0);
    $("#ov-racc").textContent = fmtNum(d.reportsAccepted || 0);
    $("#ov-rrej").textContent = fmtNum(d.reportsRejected || 0);
    $("#ov-votes").textContent = fmtNum(d.totalVotes || 0);

    $("#ov-owners").textContent = fmtNum(Object.keys(d.owners || {}).length);
    $("#ov-groups").textContent = fmtNum(Object.keys(d.groups || {}).length);

    const ls = $("#ov-lastsync");
    if (ls) ls.textContent = d.lastSyncAt ? fmtDate(d.lastSyncAt) : "—";

    $("#nb-games").textContent = fmtNum(Object.keys(d.games || {}).length);
    $("#nb-creators").textContent = fmtNum(
      Object.keys(d.owners || {}).length + Object.keys(d.groups || {}).length
    );

    $("#toggle-enabled").checked = d.enabled !== false;
  }

  function buildRow(item, kind) {
    const row = document.createElement("div");
    row.className = "row-item";
    const initials = (item.name || "?").trim().charAt(0).toUpperCase() || "?";
    const thumbHtml = item.thumb
      ? `<img src="${escapeHtml(item.thumb)}" alt="">`
      : `<span>${escapeHtml(initials)}</span>`;
    const status = item.status || "none";
    const openUrl = kind === "owner"
      ? (item.url || "https://www.roblox.com/users/" + item.id + "/profile")
      : kind === "group"
        ? (item.url || "https://www.roblox.com/communities/" + item.id)
        : "https://www.roblox.com/games/" + item.id;

    const actions = kind === "game"
      ? `<button data-act="open" data-id="${escapeHtml(item.id)}" data-kind="${kind}" type="button">Open</button>
         <button data-act="toggle" data-id="${escapeHtml(item.id)}" type="button">${item.unlocked ? "Re-lock" : "Unlock"}</button>
         <button data-act="remove" class="danger" data-id="${escapeHtml(item.id)}" type="button">✕</button>`
      : `<button data-act="open" data-id="${escapeHtml(item.id)}" data-kind="${kind}" type="button">Open</button>
         <button data-act="remove-creator" class="danger" data-id="${escapeHtml(item.id)}" data-kind="${kind}" type="button">✕</button>`;

    row.innerHTML = `
      <div class="row-thumb">${thumbHtml}</div>
      <div class="row-info">
        <div class="row-name" title="${escapeHtml(item.name || "")}">${escapeHtml(item.name || "(unknown)")}</div>
        <div class="row-meta">ID ${escapeHtml(item.id)}${kind === "game" ? " · " + escapeHtml(item.source || "manual") : ""}${item.unlocked ? " · unlocked" : ""}</div>
        <div class="row-badge ${badgeClass(status)}">
          <span class="dot"></span>${escapeHtml(STATUS_LABEL[status] || status)}
        </div>
      </div>
      <div class="row-actions">${actions}</div>
    `;
    row.dataset.openUrl = openUrl;
    return row;
  }

  function renderGames() {
    const list = $("#games-list");
    const d = state.data || {};
    const games = d.games || {};
    const q = state.gamesSearch.toLowerCase();
    const f = state.gamesFilter;
    const arr = Object.values(games).filter((g) => {
      if (f !== "all" && g.status !== f) return false;
      if (q && !(g.name || "").toLowerCase().includes(q) && !g.id.includes(q)) return false;
      return true;
    }).sort((a, b) => (b.lastReportedAt || b.addedAt || 0) - (a.lastReportedAt || a.addedAt || 0));

    if (arr.length === 0) {
      list.innerHTML = `<div class="empty">No games</div>`;
      return;
    }
    list.innerHTML = "";
    for (const g of arr) list.appendChild(buildRow(g, "game"));
  }

  function renderCreators() {
    const d = state.data || {};
    const owners = Object.values(d.owners || {}).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    const groups = Object.values(d.groups || {}).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));

    const oList = $("#owners-list");
    if (owners.length === 0) oList.innerHTML = `<div class="empty">No owners flagged</div>`;
    else {
      oList.innerHTML = "";
      for (const o of owners) oList.appendChild(buildRow(o, "owner"));
    }
    const gList = $("#groups-list");
    if (groups.length === 0) gList.innerHTML = `<div class="empty">No groups flagged</div>`;
    else {
      gList.innerHTML = "";
      for (const g of groups) gList.appendChild(buildRow(g, "group"));
    }
  }

  $("#games-filter").addEventListener("change", (e) => {
    state.gamesFilter = e.target.value;
    renderGames();
  });
  $("#games-search").addEventListener("input", (e) => {
    state.gamesSearch = e.target.value || "";
    renderGames();
  });

  document.body.addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    const id = b.dataset.id;
    const kind = b.dataset.kind || "game";

    if (act === "open") {
      const row = b.closest(".row-item");
      const url = row ? row.dataset.openUrl : null;
      if (url) try { ext.tabs.create({ url }); } catch (err) {}
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
    } else if (act === "remove-creator") {
      await send({ action: "removeCreator", id, kind });
      loadAll();
    }
  });

  $("#toggle-enabled").addEventListener("change", async () => {
    await send({ action: "toggleEnabled" });
    loadAll();
  });

  $("#refresh-stats").addEventListener("click", () => loadAll());

  $("#save-sync").addEventListener("click", async () => {
    const v = ($("#sync-url").value || "").trim();
    if (v && !/^https?:\/\//i.test(v)) {
      $("#sync-status").textContent = "Invalid URL";
      return;
    }
    await send({ action: "setRemoteSync", url: v });
    $("#sync-status").textContent = v ? "Saved and syncing" : "Sync disabled";
    setTimeout(loadAll, 600);
  });
  $("#force-sync").addEventListener("click", async () => {
    $("#sync-status").textContent = "Syncing...";
    const r = await send({ action: "forceSync" });
    $("#sync-status").textContent = r && r.lastSyncAt ? "Sync complete" : "Sync failed or not configured";
    loadAll();
  });
  $("#clear-data").addEventListener("click", async () => {
    await send({ action: "clearData" });
    loadAll();
  });

  async function loadAll() {
    const s = await send({ action: "getState" });
    state.data = s || {};
    if (s && s.remoteSyncUrl) $("#sync-url").value = s.remoteSyncUrl;
    renderOverview();
    renderGames();
    renderCreators();
  }

  try {
    ext.storage.onChanged && ext.storage.onChanged.addListener((ch, area) => {
      if (area === "local") loadAll();
    });
  } catch (e) { }

  loadAll();
})();
