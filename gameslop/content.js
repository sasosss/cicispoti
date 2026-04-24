(function () {
  const ext = (typeof browser !== 'undefined') ? browser : chrome;

  const STATUS = {
    NONE: "none",
    QUEUED: "queued",
    FLAGGED: "flagged",
    MIXED: "mixed",
    CONFIRMED: "confirmed",
    BANNED: "banned"
  };

  const STATUS_LABEL = {
    none: "Not Flagged",
    queued: "Under Review",
    flagged: "Flagged (AI)",
    mixed: "Mixed Reports",
    confirmed: "Confirmed AI",
    banned: "Banned"
  };

  const GS = {
    enabled: true,
    games: {},
    myVotes: {},
    processedCards: new WeakSet(),
    lastUrl: location.href,
    lastGameId: null,
    panelPinned: false,
    panelBound: false,
    panelLastSig: "",
    inFlight: new Set()
  };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function sendMsg(payload) {
    return new Promise((resolve) => {
      try {
        const r = ext.runtime.sendMessage(payload, (resp) => resolve(resp || { ok: false }));
        if (r && typeof r.then === "function") r.then(resolve).catch(() => resolve({ ok: false }));
      } catch (e) { resolve({ ok: false }); }
    });
  }

  async function refreshState() {
    const s = await sendMsg({ action: "getState" });
    if (s && typeof s === "object") {
      GS.enabled = s.enabled !== false;
      GS.games = s.games || {};
      GS.myVotes = s.myVotes || {};
    }
  }

  function extractGameIdFromHref(href) {
    if (!href) return null;
    const m = href.match(/\/games\/(\d+)/);
    return m ? m[1] : null;
  }

  function getCurrentGameId() {
    const m = location.pathname.match(/^\/games\/(\d+)/);
    return m ? m[1] : null;
  }

  function getCurrentGameName() {
    const h1 = $("h1.game-name, .game-title h1, h1[class*='game'], h1");
    if (h1 && h1.textContent) return h1.textContent.trim();
    const og = document.querySelector('meta[property="og:title"]');
    if (og) return (og.getAttribute("content") || "").trim();
    return document.title.replace(/ - Roblox.*$/i, "").trim();
  }

  function getCurrentGameThumb() {
    const og = document.querySelector('meta[property="og:image"]');
    if (og) return og.getAttribute("content") || "";
    const img = document.querySelector("#game-details-thumbnail img, .game-thumb img, img[alt*='game' i]");
    if (img) return img.getAttribute("src") || "";
    return "";
  }

  function getGameStatus(gameId) {
    if (!gameId) return STATUS.NONE;
    const g = GS.games[String(gameId)];
    if (!g) return STATUS.NONE;
    return g.status || STATUS.NONE;
  }

  function isBlocked(gameId) {
    const g = GS.games[String(gameId)];
    if (!g) return false;
    if (g.unlocked) return false;
    const s = g.status;
    return s === STATUS.FLAGGED || s === STATUS.CONFIRMED || s === STATUS.BANNED;
  }

  function statusBadgeClass(status) {
    if (status === STATUS.QUEUED) return "badge-queued";
    if (status === STATUS.FLAGGED) return "badge-flagged";
    if (status === STATUS.MIXED) return "badge-mixed";
    if (status === STATUS.CONFIRMED) return "badge-confirmed";
    if (status === STATUS.BANNED) return "badge-banned";
    return "badge-clean";
  }

  function statusDotClass(status) {
    if (status === STATUS.QUEUED) return "dot-queued";
    if (status === STATUS.FLAGGED) return "dot-flagged";
    if (status === STATUS.MIXED) return "dot-mixed";
    if (status === STATUS.CONFIRMED) return "dot-confirmed";
    if (status === STATUS.BANNED) return "dot-banned";
    return "dot-clean";
  }

  function toast(text, kind) {
    try {
      const prev = document.getElementById("gs-toast");
      if (prev) prev.remove();
      const d = document.createElement("div");
      d.id = "gs-toast";
      d.className = "gs-toast " + (kind || "info");
      d.textContent = text;
      document.body.appendChild(d);
      setTimeout(() => { if (d && d.parentNode) d.parentNode.removeChild(d); }, 3500);
    } catch (e) { }
  }

  function openReportModal(gameId, gameName, thumb) {
    const old = document.getElementById("gs-modal-wrap");
    if (old) old.remove();

    const wrap = document.createElement("div");
    wrap.id = "gs-modal-wrap";
    wrap.innerHTML = `
      <div class="gs-modal-back"></div>
      <div class="gs-modal">
        <div class="gs-modal-head">
          <div class="gs-modal-title">Report AI-Generated Game</div>
          <button class="gs-modal-x" type="button" aria-label="Close">×</button>
        </div>
        <div class="gs-modal-body">
          <div class="gs-row"><span class="gs-k">Game:</span> <span class="gs-v" id="gs-m-name"></span></div>
          <div class="gs-row"><span class="gs-k">ID:</span> <span class="gs-v" id="gs-m-id"></span></div>
          <label class="gs-label" for="gs-m-reason">Reason (optional)</label>
          <textarea id="gs-m-reason" maxlength="280" placeholder="e.g. AI thumbnail, generic description, recycled assets..."></textarea>
          <div class="gs-hint">Your report is sent to admin reviewers. The game will also be blocked locally in your browser.</div>
        </div>
        <div class="gs-modal-foot">
          <button class="gs-btn gs-btn-ghost" id="gs-m-cancel" type="button">Cancel</button>
          <button class="gs-btn gs-btn-primary" id="gs-m-send" type="button">Queue for Review</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);

    $("#gs-m-name", wrap).textContent = gameName || "(unknown)";
    $("#gs-m-id", wrap).textContent = gameId || "-";

    const close = () => wrap.remove();
    $(".gs-modal-x", wrap).addEventListener("click", close);
    $(".gs-modal-back", wrap).addEventListener("click", close);
    $("#gs-m-cancel", wrap).addEventListener("click", close);

    $("#gs-m-send", wrap).addEventListener("click", async () => {
      const reason = ($("#gs-m-reason", wrap).value || "").trim();
      const btn = $("#gs-m-send", wrap);
      btn.disabled = true;
      btn.textContent = "Sending...";

      const url = location.origin + "/games/" + gameId;
      const r = await sendMsg({
        action: "report",
        gameId, gameName, gameUrl: url, reason,
        thumb: thumb || "",
        reporter: (navigator.userAgent || "").slice(0, 40)
      });

      if (r && r.ok) {
        await refreshState();
        renderPanelIfOnDetail();
        applyBlocksEverywhere();
        toast("Report sent. Queued for review.", "ok");
        close();
      } else {
        let why = (r && r.reason) || "error";
        if (why === "rate_limit") why = "too many reports, try again soon";
        else if (why === "duplicate") why = "already reported recently";
        else why = "network error";
        toast("Report failed: " + why, "err");
        btn.disabled = false;
        btn.textContent = "Queue for Review";
      }
    });
  }

  function renderPanelIfOnDetail() {
    const gameId = getCurrentGameId();
    if (!gameId) {
      removePanel();
      return;
    }
    buildPanel(gameId);
  }

  function removePanel() {
    const p = document.getElementById("gs-panel");
    if (p) p.remove();
  }

  function ensurePanel() {
    let panel = document.getElementById("gs-panel");
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "gs-panel";
    panel.className = "gs-panel";
    document.body.appendChild(panel);
    return panel;
  }

  function bindPanelOnce(panel) {
    if (GS.panelBound) return;
    GS.panelBound = true;

    panel.addEventListener("click", async (e) => {
      const closeBtn = e.target.closest(".gs-p-close");
      if (closeBtn) {
        panel.classList.add("gs-hidden");
        return;
      }
      const b = e.target.closest("button[data-act]");
      if (!b || b.disabled) return;
      const act = b.dataset.act;
      const gameId = panel.dataset.gameId;
      const gameName = panel.dataset.gameName || "";
      const thumb = panel.dataset.thumb || "";
      if (!gameId) return;

      const flightKey = act + ":" + gameId;
      if (GS.inFlight.has(flightKey)) return;
      GS.inFlight.add(flightKey);
      const allBtns = panel.querySelectorAll("button[data-act]");
      allBtns.forEach((x) => x.disabled = true);

      try {
        if (act === "report") {
          openReportModal(gameId, gameName, thumb);
        } else if (act === "vote-ai" || act === "vote-clean") {
          const vote = act === "vote-ai" ? "ai" : "clean";
          if (GS.myVotes[gameId] === vote) {
            toast("You already voted this", "info");
          } else {
            const r = await sendMsg({ action: "vote", gameId, vote, info: { name: gameName, thumb } });
            if (r && r.ok) {
              await refreshState();
              applyBlocksEverywhere();
              renderPanelIfOnDetail();
              toast(vote === "ai" ? "Marked as AI" : "Vote recorded", "ok");
            } else {
              toast("Vote failed", "err");
            }
          }
        } else if (act === "unlock-temp") {
          await sendMsg({ action: "unlock", gameId, permanent: false });
          await refreshState();
          applyBlocksEverywhere();
          renderPanelIfOnDetail();
          toast("Unlocked for this session", "ok");
        } else if (act === "unlock-perm") {
          await sendMsg({ action: "unlock", gameId, permanent: true });
          await refreshState();
          applyBlocksEverywhere();
          renderPanelIfOnDetail();
          toast("Removed from blocklist", "ok");
        }
      } finally {
        GS.inFlight.delete(flightKey);
        const stillThere = document.getElementById("gs-panel");
        if (stillThere) {
          stillThere.querySelectorAll("button[data-act]").forEach((x) => x.disabled = false);
        }
      }
    });
  }

  function buildPanel(gameId) {
    const gameName = getCurrentGameName();
    const thumb = getCurrentGameThumb();
    const g = GS.games[String(gameId)] || {};
    const status = getGameStatus(gameId);
    const votesAi = g.votesAi || 0;
    const votesClean = g.votesClean || 0;
    const myVote = GS.myVotes[String(gameId)] || "";

    const isAlreadyReported = status !== STATUS.NONE;
    const blocked = GS.enabled && isBlocked(gameId);

    const sig = [gameId, status, blocked ? 1 : 0, votesAi, votesClean, myVote, gameName].join("|");
    if (sig === GS.panelLastSig && document.getElementById("gs-panel")) return;
    GS.panelLastSig = sig;

    const panel = ensurePanel();
    panel.classList.remove("gs-hidden");
    panel.dataset.gameId = gameId;
    panel.dataset.gameName = gameName;
    panel.dataset.thumb = thumb;

    const initials = (gameName || "?").trim().charAt(0).toUpperCase() || "?";
    const thumbHtml = thumb
      ? `<img src="${escapeAttr(thumb)}" alt="">`
      : `<span>${escapeHtml(initials)}</span>`;

    let actionsHtml;
    if (blocked) {
      actionsHtml =
        `<button class="gs-btn gs-btn-ghost" data-act="unlock-temp" type="button">Unlock (session)</button>` +
        `<button class="gs-btn gs-btn-ghost" data-act="unlock-perm" type="button">Remove from list</button>`;
    } else if (isAlreadyReported) {
      const aiPressed = myVote === "ai" ? " gs-pressed" : "";
      const cleanPressed = myVote === "clean" ? " gs-pressed" : "";
      actionsHtml =
        `<button class="gs-btn gs-btn-ghost${cleanPressed}" data-act="vote-clean" type="button">Looks legit</button>` +
        `<button class="gs-btn gs-btn-primary${aiPressed}" data-act="vote-ai" type="button">Mark as AI</button>` +
        `<button class="gs-btn gs-btn-danger" data-act="report" type="button">Report</button>`;
    } else {
      actionsHtml = `<button class="gs-btn gs-btn-primary gs-btn-wide" data-act="report" type="button">Queue for Review</button>`;
    }

    let bodyHtml;
    if (blocked) {
      bodyHtml = `<div class="gs-p-warn">Play is disabled because this game is <b>${escapeHtml(STATUS_LABEL[status])}</b>.</div>`;
    } else if (status === STATUS.NONE) {
      bodyHtml = `<div class="gs-p-text">This game has not been reviewed yet.</div>`;
    } else {
      bodyHtml =
        `<div class="gs-p-text">Community feedback:` +
        ` <span class="gs-v-pill gs-v-ai">${votesAi} AI</span>` +
        ` <span class="gs-v-pill gs-v-clean">${votesClean} clean</span>` +
        (myVote ? ` <span class="gs-v-pill gs-v-mine">your vote: ${escapeHtml(myVote)}</span>` : "") +
        `</div>`;
    }

    panel.innerHTML =
      `<div class="gs-panel-card">` +
        `<div class="gs-panel-head">` +
          `<div class="gs-p-thumb">${thumbHtml}</div>` +
          `<div class="gs-p-titles">` +
            `<div class="gs-p-name" title="${escapeAttr(gameName)}">${escapeHtml(gameName || "(unknown)")}</div>` +
            `<div class="gs-p-id">ID: ${escapeHtml(gameId)}</div>` +
            `<div class="gs-badge ${statusBadgeClass(status)}">` +
              `<span class="gs-dot ${statusDotClass(status)}"></span>` +
              `${escapeHtml(STATUS_LABEL[status] || "Not Flagged")}` +
            `</div>` +
          `</div>` +
          `<button class="gs-p-close" type="button" aria-label="Close">×</button>` +
        `</div>` +
        `<div class="gs-panel-body">${bodyHtml}</div>` +
        `<div class="gs-panel-actions">${actionsHtml}</div>` +
      `</div>`;

    bindPanelOnce(panel);
  }

  function lockPlayButtonIfNeeded() {
    const gameId = getCurrentGameId();
    if (!gameId) return;
    if (!GS.enabled) return;
    const blocked = isBlocked(gameId);
    const status = getGameStatus(gameId);

    const playButtons = [
      ...$$("#game-details-play-button-container button"),
      ...$$("#PlayButton"),
      ...$$("button[data-testid='play-button']"),
      ...$$(".btn-common-play-game-lg"),
      ...$$(".PlayButton button")
    ];

    playButtons.forEach((b) => {
      if (blocked) {
        if (!b.dataset.gsLocked) {
          b.dataset.gsLocked = "1";
          b.dataset.gsOrigDisabled = b.disabled ? "1" : "0";
          b.dataset.gsOrigText = b.textContent || "";
          b.disabled = true;
          b.setAttribute("aria-disabled", "true");
          b.classList.add("gs-locked");
          b.textContent = status === STATUS.BANNED ? "Banned" : "Blocked (AI)";
          b.addEventListener("click", stopBlockedClick, true);
        }
      } else {
        if (b.dataset.gsLocked) {
          b.disabled = b.dataset.gsOrigDisabled === "1";
          b.removeAttribute("aria-disabled");
          b.classList.remove("gs-locked");
          if (b.dataset.gsOrigText) b.textContent = b.dataset.gsOrigText;
          b.removeEventListener("click", stopBlockedClick, true);
          delete b.dataset.gsLocked;
          delete b.dataset.gsOrigDisabled;
          delete b.dataset.gsOrigText;
        }
      }
    });
  }

  function stopBlockedClick(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    toast("Game blocked by GameSlop", "err");
    return false;
  }

  function findCards() {
    const cards = [];
    const tiles = $$(".game-card-container, .game-tile, li[class*='game-card'], div[class*='game-card']");
    for (const el of tiles) cards.push(el);

    const anchors = $$("a[href*='/games/']");
    for (const a of anchors) {
      const gid = extractGameIdFromHref(a.getAttribute("href"));
      if (!gid) continue;
      let card = a.closest(".game-card-container, li[class*='game-card'], div[class*='game-card'], .grid-item-container");
      if (!card) card = a;
      if (!cards.includes(card)) cards.push(card);
    }
    return cards;
  }

  function attachCardMenu(card) {
    if (GS.processedCards.has(card)) return;
    GS.processedCards.add(card);

    const a = card.matches("a") ? card : card.querySelector("a[href*='/games/']");
    if (!a) return;
    const gameId = extractGameIdFromHref(a.getAttribute("href"));
    if (!gameId) return;

    const nameEl = card.querySelector(".game-card-name, .game-card-info-name, [class*='GameName'], span[class*='name']");
    const imgEl = card.querySelector("img");
    const gameName = (nameEl && nameEl.textContent ? nameEl.textContent : (a.getAttribute("aria-label") || "")).trim();
    const thumb = imgEl ? (imgEl.getAttribute("src") || "") : "";

    card.dataset.gsGameId = gameId;
    card.dataset.gsGameName = gameName;
    card.dataset.gsThumb = thumb;

    if (getComputedStyle(card).position === "static") {
      card.style.position = "relative";
    }

    if (!card.querySelector(".gs-dots")) {
      const dots = document.createElement("button");
      dots.type = "button";
      dots.className = "gs-dots";
      dots.setAttribute("aria-label", "GameSlop options");
      dots.textContent = "⋯";
      dots.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openCardMenu(card, gameId, gameName, thumb, dots);
      });
      card.appendChild(dots);
    }

    applyBlockOnCard(card, gameId);
  }

  function openCardMenu(card, gameId, gameName, thumb, anchorEl) {
    const prev = document.getElementById("gs-card-menu");
    if (prev) prev.remove();

    const status = getGameStatus(gameId);
    const blocked = GS.enabled && isBlocked(gameId);
    const menu = document.createElement("div");
    menu.id = "gs-card-menu";
    menu.className = "gs-card-menu";

    const header = `
      <div class="gs-menu-head">
        <div class="gs-menu-name">${escapeHtml(gameName || "(unknown)")}</div>
        <div class="gs-badge ${statusBadgeClass(status)}">
          <span class="gs-dot ${statusDotClass(status)}"></span>
          ${escapeHtml(STATUS_LABEL[status] || "Not Flagged")}
        </div>
      </div>
    `;

    const buttons = blocked
      ? `<button type="button" data-act="unlock-temp">Unlock (session)</button>
         <button type="button" data-act="unlock-perm">Remove from list</button>`
      : (status === STATUS.NONE
          ? `<button type="button" data-act="report">Queue for Review</button>
             <button type="button" data-act="vote-ai">Mark as AI</button>
             <button type="button" data-act="block">Block locally</button>`
          : `<button type="button" data-act="vote-ai">Mark as AI</button>
             <button type="button" data-act="vote-clean">Looks legit</button>
             <button type="button" data-act="report">Report</button>
             <button type="button" data-act="block">Block locally</button>`);

    menu.innerHTML = header + buttons + `<button type="button" data-act="close">Cancel</button>`;
    document.body.appendChild(menu);

    const rect = anchorEl.getBoundingClientRect();
    let top = rect.bottom + window.scrollY + 4;
    let left = rect.right + window.scrollX - 220;
    if (left < 8) left = 8;
    menu.style.top = top + "px";
    menu.style.left = left + "px";

    const onDoc = (ev) => {
      if (!menu.contains(ev.target)) {
        menu.remove();
        document.removeEventListener("mousedown", onDoc, true);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", onDoc, true), 0);

    menu.addEventListener("click", async (e) => {
      const b = e.target.closest("button[data-act]");
      if (!b) return;
      const act = b.dataset.act;
      menu.remove();
      if (act === "close") return;
      if (act === "report") {
        openReportModal(gameId, gameName, thumb);
      } else if (act === "vote-ai" || act === "vote-clean") {
        const vote = act === "vote-ai" ? "ai" : "clean";
        if (GS.myVotes[gameId] === vote) {
          toast("You already voted this", "info");
        } else {
          const r = await sendMsg({ action: "vote", gameId, vote, info: { name: gameName, thumb } });
          if (r && r.ok) {
            await refreshState();
            applyBlocksEverywhere();
            toast(vote === "ai" ? "Marked as AI" : "Vote recorded", "ok");
          } else {
            toast("Vote failed", "err");
          }
        }
      } else if (act === "block") {
        await sendMsg({ action: "setStatus", gameId, status: STATUS.FLAGGED, info: { name: gameName, thumb, source: "manual" } });
        await refreshState();
        applyBlocksEverywhere();
        toast("Game blocked locally", "ok");
      } else if (act === "unlock-temp") {
        await sendMsg({ action: "unlock", gameId, permanent: false });
        await refreshState();
        applyBlocksEverywhere();
        toast("Unlocked for this session", "ok");
      } else if (act === "unlock-perm") {
        await sendMsg({ action: "unlock", gameId, permanent: true });
        await refreshState();
        applyBlocksEverywhere();
        toast("Removed from list", "ok");
      }
    });
  }

  function applyBlockOnCard(card, gameId) {
    const blocked = GS.enabled && isBlocked(gameId);
    const status = getGameStatus(gameId);

    let badge = card.querySelector(".gs-card-badge");
    if (status !== STATUS.NONE) {
      const lbl = STATUS_LABEL[status];
      if (!badge) {
        badge = document.createElement("div");
        badge.className = "gs-card-badge";
        card.appendChild(badge);
      }
      badge.className = "gs-card-badge " + statusBadgeClass(status);
      badge.innerHTML = `<span class="gs-dot ${statusDotClass(status)}"></span>${escapeHtml(lbl)}`;
    } else if (badge) {
      badge.remove();
    }

    if (blocked) {
      card.classList.add("gs-card-blocked");
      if (!card.querySelector(".gs-card-overlay")) {
        const ov = document.createElement("div");
        ov.className = "gs-card-overlay";
        ov.innerHTML = `<div class="gs-card-ov-text">${escapeHtml(STATUS_LABEL[status] || "Blocked")}</div>`;
        ov.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const dots = card.querySelector(".gs-dots");
          if (dots) dots.click();
        });
        card.appendChild(ov);
      }
      const anchors = card.matches("a") ? [card] : $$("a[href*='/games/']", card);
      anchors.forEach((a) => {
        if (!a.dataset.gsBlocked) {
          a.dataset.gsBlocked = "1";
          a.addEventListener("click", stopBlockedClick, true);
        }
      });
    } else {
      card.classList.remove("gs-card-blocked");
      const ov = card.querySelector(".gs-card-overlay");
      if (ov) ov.remove();
      const anchors = card.matches("a") ? [card] : $$("a[href*='/games/']", card);
      anchors.forEach((a) => {
        if (a.dataset.gsBlocked) {
          a.removeEventListener("click", stopBlockedClick, true);
          delete a.dataset.gsBlocked;
        }
      });
    }
  }

  function applyBlocksEverywhere() {
    const cards = findCards();
    for (const c of cards) {
      const gid = c.dataset.gsGameId || extractGameIdFromHref(
        (c.matches("a") ? c : c.querySelector("a[href*='/games/']"))?.getAttribute("href")
      );
      if (gid) applyBlockOnCard(c, gid);
    }
    lockPlayButtonIfNeeded();
  }

  function scanAndInject() {
    if (!document.body) return;

    const gameId = getCurrentGameId();
    if (gameId) {
      if (gameId !== GS.lastGameId) {
        GS.lastGameId = gameId;
        removePanel();
      }
      renderPanelIfOnDetail();
      lockPlayButtonIfNeeded();
    } else {
      GS.lastGameId = null;
      removePanel();
    }

    const cards = findCards();
    for (const c of cards) attachCardMenu(c);
  }

  let scanScheduled = false;
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(() => {
      scanScheduled = false;
      try { scanAndInject(); } catch (e) { }
    }, 200);
  }

  const obs = new MutationObserver(() => {
    if (location.href !== GS.lastUrl) {
      GS.lastUrl = location.href;
      removePanel();
    }
    scheduleScan();
  });

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function startup() {
    try {
      obs.observe(document.documentElement || document.body, { childList: true, subtree: true });
    } catch (e) { }
    refreshState().then(() => scanAndInject());
  }

  let storageDebounce = 0;
  try {
    ext.storage.onChanged && ext.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (!changes.games && !changes.enabled && !changes.myVotes) return;
      clearTimeout(storageDebounce);
      storageDebounce = setTimeout(() => {
        refreshState().then(() => {
          applyBlocksEverywhere();
          renderPanelIfOnDetail();
        });
      }, 120);
    });
  } catch (e) { }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startup, { once: true });
  } else {
    startup();
  }
})();
