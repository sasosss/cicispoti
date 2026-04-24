(function () {
  const ext = (typeof browser !== 'undefined') ? browser : chrome;

  function send(msg) {
    return new Promise((resolve) => {
      try {
        const r = ext.runtime.sendMessage(msg, (resp) => resolve(resp || {}));
        if (r && typeof r.then === "function") r.then(resolve).catch(() => resolve({}));
      } catch (e) { resolve({}); }
    });
  }

  function storGet(keys) {
    return new Promise((resolve) => {
      try {
        const r = ext.storage.local.get(keys, (items) => resolve(items || {}));
        if (r && typeof r.then === "function") r.then(resolve).catch(() => resolve({}));
      } catch (e) { resolve({}); }
    });
  }

  const el = {
    toggle: document.getElementById("toggle-enabled"),
    sBlocked: document.getElementById("s-blocked"),
    sReports: document.getElementById("s-reports"),
    sUnlocked: document.getElementById("s-unlocked"),
    list: document.getElementById("list"),
    search: document.getElementById("search"),
    syncUrl: document.getElementById("sync-url"),
    saveSync: document.getElementById("save-sync"),
    forceSync: document.getElementById("force-sync"),
    syncStatus: document.getElementById("sync-status"),
    lastSync: document.getElementById("last-sync"),
    whUrl: document.getElementById("wh-url"),
    saveWh: document.getElementById("save-wh"),
    whStatus: document.getElementById("wh-status")
  };

  let currentBl = {};

  function fmtDate(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleDateString() + " " + d.toLocaleTimeString().slice(0, 5);
  }

  function render() {
    const q = (el.search.value || "").toLowerCase().trim();
    const keys = Object.keys(currentBl);

    let blockedCount = 0;
    let unlockedCount = 0;
    for (const k of keys) {
      if (currentBl[k].unlocked) unlockedCount++;
      else blockedCount++;
    }
    el.sBlocked.textContent = blockedCount;
    el.sUnlocked.textContent = unlockedCount;

    const filtered = keys.filter((k) => {
      if (!q) return true;
      const it = currentBl[k];
      return (it.name || "").toLowerCase().includes(q) || k.includes(q);
    }).sort((a, b) => (currentBl[b].addedAt || 0) - (currentBl[a].addedAt || 0));

    if (filtered.length === 0) {
      el.list.innerHTML = `<div class="empty">Nessun gioco bloccato</div>`;
      return;
    }

    el.list.innerHTML = "";
    for (const id of filtered) {
      const it = currentBl[id];
      const row = document.createElement("div");
      row.className = "item";
      row.innerHTML = `
        <div style="flex:1;min-width:0;">
          <div class="nm" title="${escapeHtml(it.name || "(senza nome)")}">
            ${escapeHtml(it.name || "(senza nome)")}
            ${it.unlocked ? `<span class="unl">sbloccato</span>` : ""}
          </div>
          <div class="meta">ID ${escapeHtml(id)} · ${escapeHtml(it.source || "manual")} · ${fmtDate(it.addedAt)}</div>
        </div>
        <button data-act="open" data-id="${escapeHtml(id)}" type="button">Apri</button>
        <button data-act="toggle" data-id="${escapeHtml(id)}" type="button">${it.unlocked ? "Ri-blocca" : "Sblocca"}</button>
        <button data-act="remove" class="rm" data-id="${escapeHtml(id)}" type="button">✕</button>
      `;
      el.list.appendChild(row);
    }
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  async function loadAll() {
    const s = await send({ action: "getState" });
    currentBl = (s && s.blocklist) || {};
    el.toggle.checked = s ? s.enabled !== false : true;
    el.sReports.textContent = (s && s.reportsSent) || 0;
    const { remoteSyncUrl } = await storGet(["remoteSyncUrl"]);
    if (remoteSyncUrl) el.syncUrl.value = remoteSyncUrl;
    const whInfo = await send({ action: "hasWebhook" });
    if (whInfo && whInfo.hasWebhook) {
      el.whUrl.placeholder = "•••••••• (configurato)";
      el.whStatus.textContent = "Webhook configurato";
    } else {
      el.whStatus.textContent = "Nessun webhook custom (uso default)";
    }
    render();
  }

  el.saveWh.addEventListener("click", async () => {
    const v = (el.whUrl.value || "").trim();
    const r = await send({ action: "setWebhook", url: v });
    if (r && r.ok) {
      el.whUrl.value = "";
      el.whStatus.textContent = v ? "Webhook salvato" : "Webhook rimosso";
      loadAll();
    } else {
      el.whStatus.textContent = "Errore: " + ((r && r.reason) || "sconosciuto");
    }
  });

  el.toggle.addEventListener("change", async () => {
    await send({ action: "toggleEnabled" });
    loadAll();
  });

  el.search.addEventListener("input", render);

  el.list.addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const id = b.dataset.id;
    const act = b.dataset.act;
    if (act === "open") {
      try {
        ext.tabs.create({ url: "https://www.roblox.com/games/" + id });
      } catch (err) { }
    } else if (act === "toggle") {
      const it = currentBl[id];
      if (!it) return;
      if (it.unlocked) {
        await send({ action: "setBlocked", gameId: id, info: { name: it.name, source: it.source || "manual" } });
      } else {
        await send({ action: "unlock", gameId: id, permanent: false });
      }
      loadAll();
    } else if (act === "remove") {
      await send({ action: "unlock", gameId: id, permanent: true });
      loadAll();
    }
  });

  el.saveSync.addEventListener("click", async () => {
    const url = (el.syncUrl.value || "").trim();
    if (url && !/^https?:\/\//i.test(url)) {
      el.syncStatus.textContent = "URL non valido";
      return;
    }
    await send({ action: "setRemoteSync", url });
    el.syncStatus.textContent = url ? "Salvato e sincronizzato" : "Sync disattivato";
    setTimeout(loadAll, 600);
  });

  el.forceSync.addEventListener("click", async () => {
    el.syncStatus.textContent = "Sync in corso...";
    const r = await send({ action: "forceSync" });
    if (r && r.lastSyncAt) {
      el.lastSync.textContent = "Ultimo sync: " + fmtDate(r.lastSyncAt);
      el.syncStatus.textContent = "Sync completato";
    } else {
      el.syncStatus.textContent = "Sync fallito o non configurato";
    }
    loadAll();
  });

  try {
    ext.storage.onChanged && ext.storage.onChanged.addListener((ch, area) => {
      if (area === "local" && (ch.blocklist || ch.enabled || ch.reportsSent)) {
        loadAll();
      }
    });
  } catch (e) { }

  loadAll();
})();
