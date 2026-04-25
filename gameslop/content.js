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
    owners: {},
    groups: {},
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
      GS.owners = s.owners || {};
      GS.groups = s.groups || {};
      GS.myVotes = s.myVotes || {};
    }
  }

  function applyVoteLocally(gameId, vote, info) {
    const id = String(gameId);
    const prevVote = GS.myVotes[id] || "";
    if (prevVote === vote) return false;

    const prev = GS.games[id] || {
      id, name: (info && info.name) || "",
      status: STATUS.NONE, unlocked: false, source: "vote",
      addedAt: Date.now(), votesAi: 0, votesClean: 0,
      thumb: (info && info.thumb) || ""
    };
    const next = { ...prev };
    if (info && info.name && !next.name) next.name = info.name;
    if (info && info.thumb && !next.thumb) next.thumb = info.thumb;

    if (prevVote === "ai") next.votesAi = Math.max(0, (next.votesAi || 0) - 1);
    if (prevVote === "clean") next.votesClean = Math.max(0, (next.votesClean || 0) - 1);
    if (vote === "ai") next.votesAi = (next.votesAi || 0) + 1;
    if (vote === "clean") next.votesClean = (next.votesClean || 0) + 1;
    next.lastVoteAt = Date.now();

    const ai = next.votesAi || 0;
    const cl = next.votesClean || 0;
    if (next.status === STATUS.NONE || next.status === STATUS.QUEUED || next.status === STATUS.MIXED || next.status === STATUS.FLAGGED) {
      if (ai >= 1 && cl === 0) next.status = STATUS.QUEUED;
      if (ai >= 2 && cl === 0) next.status = STATUS.FLAGGED;
      if (ai >= 1 && cl >= 1) next.status = STATUS.MIXED;
      if (ai === 0 && cl >= 1) next.status = STATUS.NONE;
    }

    GS.games[id] = next;
    GS.myVotes[id] = vote;
    return { prev, prevVote };
  }

  function rollbackVote(gameId, snapshot) {
    if (!snapshot) return;
    const id = String(gameId);
    GS.games[id] = snapshot.prev;
    if (snapshot.prevVote) GS.myVotes[id] = snapshot.prevVote;
    else delete GS.myVotes[id];
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

  function getCreatorInfo() {
    const out = { ownerId: "", ownerName: "", ownerUrl: "", groupId: "", groupName: "", groupUrl: "" };
    const creatorAnchor =
      document.querySelector("a[href*='/users/'][class*='creator' i]") ||
      document.querySelector("a[href*='/communities/'][class*='creator' i]") ||
      document.querySelector("a[href*='/groups/'][class*='creator' i]") ||
      document.querySelector("[class*='game-creator'] a[href*='/users/']") ||
      document.querySelector("[class*='game-creator'] a[href*='/communities/']") ||
      document.querySelector("[class*='game-creator'] a[href*='/groups/']") ||
      document.querySelector("[class*='creator-name'] a") ||
      document.querySelector("a.text-name[href*='/users/']") ||
      document.querySelector("a.text-name[href*='/communities/']");

    if (creatorAnchor) {
      const href = creatorAnchor.getAttribute("href") || "";
      const txt = (creatorAnchor.textContent || "").trim();
      const um = href.match(/\/users\/(\d+)/);
      const gm = href.match(/\/(?:groups|communities)\/(\d+)/);
      if (um) {
        out.ownerId = um[1];
        out.ownerName = txt;
        out.ownerUrl = location.origin + "/users/" + um[1] + "/profile";
      } else if (gm) {
        out.groupId = gm[1];
        out.groupName = txt;
        out.groupUrl = location.origin + "/communities/" + gm[1];
      }
    }
    return out;
  }

  function getGameStatus(gameId) {
    if (!gameId) return STATUS.NONE;
    const g = GS.games[String(gameId)];
    if (!g) return STATUS.NONE;
    return g.status || STATUS.NONE;
  }

  function blockedCreatorStatus(row) {
    if (!row || row.unlocked) return null;
    const s = row.status || STATUS.NONE;
    if (s === STATUS.FLAGGED || s === STATUS.CONFIRMED || s === STATUS.BANNED) return s;
    return null;
  }

  function isBlockedByCreatorOnPage() {
    if (!GS.enabled) return false;
    const c = getCreatorInfo();
    const o = c.ownerId && GS.owners[String(c.ownerId)];
    const g = c.groupId && GS.groups[String(c.groupId)];
    if (blockedCreatorStatus(o) || blockedCreatorStatus(g)) return true;
    return false;
  }

  function isGameDirectBlocked(gameId) {
    const g = GS.games[String(gameId)];
    if (!g) return false;
    if (g.unlocked) return false;
    const s = g.status;
    return s === STATUS.FLAGGED || s === STATUS.CONFIRMED || s === STATUS.BANNED;
  }

  function isDetailPagePlayBlocked(gameId) {
    return isGameDirectBlocked(gameId) || isBlockedByCreatorOnPage();
  }

  function effectiveDetailBlockLabel(gameId) {
    if (isGameDirectBlocked(gameId)) {
      return STATUS_LABEL[getGameStatus(gameId)] || "Blocked";
    }
    const c = getCreatorInfo();
    const o = c.ownerId && GS.owners[String(c.ownerId)];
    const g = c.groupId && GS.groups[String(c.groupId)];
    const row = blockedCreatorStatus(o) || blockedCreatorStatus(g) ? (blockedCreatorStatus(o) ? o : g) : null;
    if (row) return STATUS_LABEL[row.status] || "Blocked";
    return "Blocked";
  }

  function detailPlayLockLabel(gameId) {
    if (getGameStatus(gameId) === STATUS.BANNED) return "Banned";
    const c = getCreatorInfo();
    const o = c.ownerId && GS.owners[String(c.ownerId)];
    const g = c.groupId && GS.groups[String(c.groupId)];
    if ((o && o.status === STATUS.BANNED) || (g && g.status === STATUS.BANNED)) return "Banned";
    return "Blocked (AI)";
  }

  function extractOwnerGroupIdsFromCard(card) {
    const scope = card.matches("a") ? card.closest("div") || card.parentElement : card;
    const root = scope || card;
    const ua = root.querySelector("a[href*='/users/']");
    const ga = root.querySelector("a[href*='/groups/'], a[href*='/communities/']");
    let ownerId = "";
    let groupId = "";
    if (ua) {
      const m = (ua.getAttribute("href") || "").match(/\/users\/(\d+)/);
      if (m) ownerId = m[1];
    }
    if (ga) {
      const m = (ga.getAttribute("href") || "").match(/\/(?:groups|communities)\/(\d+)/);
      if (m) groupId = m[1];
    }
    return { ownerId, groupId };
  }

  function isCardBlockedByCreator(card) {
    if (!GS.enabled) return false;
    const { ownerId, groupId } = extractOwnerGroupIdsFromCard(card);
    const o = ownerId && GS.owners[String(ownerId)];
    const g = groupId && GS.groups[String(groupId)];
    return !!(blockedCreatorStatus(o) || blockedCreatorStatus(g));
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

    const g = GS.games[String(gameId)];
    if (g && (g.pollResolved || g.status === STATUS.CONFIRMED || g.status === STATUS.BANNED)) {
      toast("This game was already reviewed — cannot re-report", "err");
      return;
    }
    if (g && g.status === STATUS.QUEUED && g.pollMessageId) {
      toast("This game is already pending admin review", "info");
      return;
    }

    const creator = getCreatorInfo();

    const wrap = document.createElement("div");
    wrap.id = "gs-modal-wrap";
    wrap.innerHTML = `
      <div class="gs-modal-back"></div>
      <div class="gs-modal">
        <div class="gs-modal-head">
          <div class="gs-modal-title">Report AI-generated game</div>
          <button class="gs-modal-x" type="button" aria-label="Close">×</button>
        </div>
        <div class="gs-modal-body">
          <div class="gs-row"><span class="gs-k">Game:</span> <span class="gs-v" id="gs-m-name"></span></div>
          <div class="gs-row"><span class="gs-k">ID:</span> <span class="gs-v" id="gs-m-id"></span></div>

          <label class="gs-label" for="gs-m-reason">Reason (optional)</label>
          <textarea id="gs-m-reason" maxlength="280" placeholder="e.g. AI thumbnail, generic description, recycled assets..."></textarea>
          <div class="gs-hint">Your report is sent to admins for this game only. Owner/group flags are handled by admins separately.</div>
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
      const payload = {
        action: "report",
        gameId, gameName, gameUrl: url,
        ownerId: creator.ownerId, ownerName: creator.ownerName, ownerUrl: creator.ownerUrl,
        groupId: creator.groupId, groupName: creator.groupName, groupUrl: creator.groupUrl,
        reason, thumb: thumb || "",
        reporter: (navigator.userAgent || "").slice(0, 40)
      };
      const r = await sendMsg(payload);

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
        else if (why === "already_reviewed") why = "this target was already reviewed";
        else if (why === "already_flagged") why = "this target is already flagged";
        else if (why === "already_pending") why = "already pending review";
        else why = "network error";
        toast("Report failed: " + why, "err");
        btn.disabled = false;
        btn.textContent = "Queue for Review";
      }
    });
  }

  function openConfirmModal(opts) {
    const old = document.getElementById("gs-modal-wrap");
    if (old) old.remove();

    const wrap = document.createElement("div");
    wrap.id = "gs-modal-wrap";
    wrap.innerHTML = `
      <div class="gs-modal-back"></div>
      <div class="gs-modal gs-modal-confirm">
        <div class="gs-modal-head">
          <div class="gs-modal-title">${escapeHtml(opts.title || "Confirm")}</div>
          <button class="gs-modal-x" type="button" aria-label="Close">×</button>
        </div>
        <div class="gs-modal-body">
          <div class="gs-confirm-body">${escapeHtml(opts.body || "")}</div>
          ${opts.warn ? `<div class="gs-p-warn" style="margin-top:12px;">${escapeHtml(opts.warn)}</div>` : ""}
        </div>
        <div class="gs-modal-foot">
          <button class="gs-btn gs-btn-ghost" id="gs-c-cancel" type="button">Cancel</button>
          <button class="gs-btn ${opts.danger ? "gs-btn-danger-solid" : "gs-btn-primary"}" id="gs-c-ok" type="button">${escapeHtml(opts.okText || "Confirm")}</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    $(".gs-modal-x", wrap).addEventListener("click", close);
    $(".gs-modal-back", wrap).addEventListener("click", close);
    $("#gs-c-cancel", wrap).addEventListener("click", close);
    $("#gs-c-ok", wrap).addEventListener("click", () => {
      close();
      if (typeof opts.onConfirm === "function") opts.onConfirm();
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

      if (act === "vote-ai" || act === "vote-clean") {
        const vote = act === "vote-ai" ? "ai" : "clean";
        if (GS.myVotes[gameId] === vote) {
          toast("You already voted this", "info");
          return;
        }
        GS.inFlight.add(flightKey);
        const snapshot = applyVoteLocally(gameId, vote, { name: gameName, thumb });
        GS.panelLastSig = "";
        renderPanelIfOnDetail();
        applyBlocksEverywhere();
        toast(vote === "ai" ? "Marked as AI" : "Vote recorded", "ok");

        sendMsg({ action: "vote", gameId, vote, info: { name: gameName, thumb } }).then((r) => {
          GS.inFlight.delete(flightKey);
          if (!r || !r.ok) {
            rollbackVote(gameId, snapshot);
            GS.panelLastSig = "";
            renderPanelIfOnDetail();
            applyBlocksEverywhere();
            toast("Vote failed, rolled back", "err");
          }
        });
        return;
      }

      if (act === "report") {
        openReportModal(gameId, gameName, thumb);
        return;
      }

      if (act === "unlock-temp") {
        openConfirmModal({
          title: "Unlock this game?",
          body: "This game is flagged as AI-generated. Are you sure you want to unlock it for this session?",
          warn: "Unlock is temporary and the game will be re-blocked on reload.",
          okText: "Unlock for this session",
          danger: true,
          onConfirm: async () => {
            await sendMsg({ action: "unlock", gameId, permanent: false });
            await refreshState();
            applyBlocksEverywhere();
            renderPanelIfOnDetail();
            toast("Unlocked for this session", "ok");
          }
        });
        return;
      }

      if (act === "unlock-perm") {
        openConfirmModal({
          title: "Remove from GameSlop list?",
          body: "This permanently removes the game from your local blocklist. You will be able to play it again.",
          warn: "If admins flagged this game as AI or banned it, removing it is strongly discouraged.",
          okText: "Remove permanently",
          danger: true,
          onConfirm: async () => {
            await sendMsg({ action: "unlock", gameId, permanent: true });
            await refreshState();
            applyBlocksEverywhere();
            renderPanelIfOnDetail();
            toast("Removed from blocklist", "ok");
          }
        });
        return;
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
    const blocked = GS.enabled && isDetailPagePlayBlocked(gameId);

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
    const reviewed = g && (g.pollResolved || status === STATUS.CONFIRMED || status === STATUS.BANNED);
    if (blocked) {
      actionsHtml =
        `<button class="gs-btn gs-btn-ghost" data-act="unlock-temp" type="button">Unlock (session)</button>` +
        `<button class="gs-btn gs-btn-danger" data-act="unlock-perm" type="button">Remove from list</button>`;
    } else if (reviewed) {
      const aiPressed = myVote === "ai" ? " gs-pressed" : "";
      const cleanPressed = myVote === "clean" ? " gs-pressed" : "";
      actionsHtml =
        `<button class="gs-btn gs-btn-ghost${cleanPressed}" data-act="vote-clean" type="button">Looks legit</button>` +
        `<button class="gs-btn gs-btn-primary${aiPressed}" data-act="vote-ai" type="button">Mark as AI</button>`;
    } else if (isAlreadyReported) {
      const aiPressed = myVote === "ai" ? " gs-pressed" : "";
      const cleanPressed = myVote === "clean" ? " gs-pressed" : "";
      actionsHtml =
        `<button class="gs-btn gs-btn-ghost${cleanPressed}" data-act="vote-clean" type="button">Looks legit</button>` +
        `<button class="gs-btn gs-btn-primary${aiPressed}" data-act="vote-ai" type="button">Mark as AI</button>`;
    } else {
      actionsHtml = `<button class="gs-btn gs-btn-primary gs-btn-wide" data-act="report" type="button">Queue for Review</button>`;
    }

    let bodyHtml;
    if (blocked) {
      bodyHtml = `<div class="gs-p-warn">Play is disabled: <b>${escapeHtml(effectiveDetailBlockLabel(gameId))}</b>.</div>`;
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
    const blocked = isDetailPagePlayBlocked(gameId);

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
          b.textContent = detailPlayLockLabel(gameId);
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
    const blocked = GS.enabled && (isGameDirectBlocked(gameId) || isCardBlockedByCreator(card));
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

    const g = GS.games[String(gameId)];
    const reviewed = g && (g.pollResolved || status === STATUS.CONFIRMED || status === STATUS.BANNED);
    const pending = g && g.status === STATUS.QUEUED && g.pollMessageId && !g.pollResolved;

    const buttons = blocked
      ? `<button type="button" data-act="unlock-temp">Unlock (session)</button>
         <button type="button" data-act="unlock-perm">Remove from list</button>`
      : (reviewed
          ? `<button type="button" data-act="vote-ai">Mark as AI</button>
             <button type="button" data-act="vote-clean">Looks legit</button>
             <button type="button" data-act="block">Block locally</button>`
          : (pending
              ? `<button type="button" data-act="vote-ai">Mark as AI</button>
                 <button type="button" data-act="vote-clean">Looks legit</button>
                 <button type="button" data-act="block">Block locally</button>`
              : (status === STATUS.NONE
                  ? `<button type="button" data-act="report">Queue for Review</button>
                     <button type="button" data-act="block">Block locally</button>`
                  : `<button type="button" data-act="vote-ai">Mark as AI</button>
                     <button type="button" data-act="vote-clean">Looks legit</button>
                     <button type="button" data-act="block">Block locally</button>`)));

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
          const snapshot = applyVoteLocally(gameId, vote, { name: gameName, thumb });
          GS.panelLastSig = "";
          applyBlocksEverywhere();
          renderPanelIfOnDetail();
          toast(vote === "ai" ? "Marked as AI" : "Vote recorded", "ok");
          sendMsg({ action: "vote", gameId, vote, info: { name: gameName, thumb } }).then((r) => {
            if (!r || !r.ok) {
              rollbackVote(gameId, snapshot);
              GS.panelLastSig = "";
              applyBlocksEverywhere();
              renderPanelIfOnDetail();
              toast("Vote failed, rolled back", "err");
            }
          });
        }
      } else if (act === "block") {
        await sendMsg({ action: "setStatus", gameId, status: STATUS.FLAGGED, info: { name: gameName, thumb, source: "manual" } });
        await refreshState();
        applyBlocksEverywhere();
        toast("Game blocked locally", "ok");
      } else if (act === "unlock-temp") {
        openConfirmModal({
          title: "Unlock this game?",
          body: "This game is flagged as AI-generated. Unlock it for this session only?",
          okText: "Unlock",
          danger: true,
          onConfirm: async () => {
            await sendMsg({ action: "unlock", gameId, permanent: false });
            await refreshState();
            applyBlocksEverywhere();
            toast("Unlocked for this session", "ok");
          }
        });
      } else if (act === "unlock-perm") {
        openConfirmModal({
          title: "Remove from list?",
          body: "This permanently removes the game from your local blocklist.",
          warn: "If admins confirmed this as AI, removing it is discouraged.",
          okText: "Remove permanently",
          danger: true,
          onConfirm: async () => {
            await sendMsg({ action: "unlock", gameId, permanent: true });
            await refreshState();
            applyBlocksEverywhere();
            toast("Removed from list", "ok");
          }
        });
      }
    });
  }

  function applyBlockOnCard(card, gameId) {
    const gameBlocked = GS.enabled && isGameDirectBlocked(gameId);
    const creatorBlocked = GS.enabled && isCardBlockedByCreator(card);
    const blocked = gameBlocked || creatorBlocked;
    const status = getGameStatus(gameId);
    const creatorRow = (() => {
      const { ownerId, groupId } = extractOwnerGroupIdsFromCard(card);
      const o = ownerId && GS.owners[String(ownerId)];
      const g = groupId && GS.groups[String(groupId)];
      return blockedCreatorStatus(o) ? o : (blockedCreatorStatus(g) ? g : null);
    })();

    let badge = card.querySelector(".gs-card-badge");
    if (status !== STATUS.NONE || creatorRow) {
      const lbl = status !== STATUS.NONE
        ? STATUS_LABEL[status]
        : (creatorRow ? STATUS_LABEL[creatorRow.status] : "Blocked");
      const badgeStatus = status !== STATUS.NONE ? status : creatorRow.status;
      if (!badge) {
        badge = document.createElement("div");
        badge.className = "gs-card-badge";
        card.appendChild(badge);
      }
      badge.className = "gs-card-badge " + statusBadgeClass(badgeStatus);
      badge.innerHTML = `<span class="gs-dot ${statusDotClass(badgeStatus)}"></span>${escapeHtml(lbl)}`;
    } else if (badge) {
      badge.remove();
    }

    if (blocked) {
      card.classList.add("gs-card-blocked");
      if (!card.querySelector(".gs-card-overlay")) {
        const ov = document.createElement("div");
        ov.className = "gs-card-overlay";
        const ovLbl = gameBlocked
          ? (STATUS_LABEL[status] || "Blocked")
          : (creatorRow ? STATUS_LABEL[creatorRow.status] : "Blocked");
        ov.innerHTML = `<div class="gs-card-ov-text">${escapeHtml(ovLbl)}</div>`;
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
        sendMsg({ action: "checkPolls" });
        schedulePollCheck();
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

  let pollCheckTimer = 0;
  function schedulePollCheck() {
    clearTimeout(pollCheckTimer);
    pollCheckTimer = setTimeout(() => {
      const gameId = getCurrentGameId();
      if (!gameId) return;
      const g = GS.games[String(gameId)];
      const pending = g && g.pollMessageId && !g.pollResolved &&
        (g.status === STATUS.QUEUED || g.status === STATUS.FLAGGED || g.status === STATUS.MIXED);
      const anyPending = pending || Object.values(GS.games || {}).some(
        (x) => x && x.pollMessageId && !x.pollResolved
      );
      if (anyPending) {
        sendMsg({ action: "checkPolls" });
        schedulePollCheck();
      }
    }, 8000);
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      sendMsg({ action: "checkPolls" });
      schedulePollCheck();
    }
  });
  window.addEventListener("focus", () => {
    sendMsg({ action: "checkPolls" });
    schedulePollCheck();
  });

  function startup() {
    try {
      obs.observe(document.documentElement || document.body, { childList: true, subtree: true });
    } catch (e) { }
    refreshState().then(() => {
      scanAndInject();
      const gid = getCurrentGameId();
      if (gid) {
        sendMsg({ action: "checkPolls" });
        schedulePollCheck();
      }
    });
  }

  let storageDebounce = 0;
  try {
    ext.storage.onChanged && ext.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (!changes.games && !changes.owners && !changes.groups && !changes.enabled && !changes.myVotes) return;
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
