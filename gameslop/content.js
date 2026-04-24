(function () {
  const ext = (typeof browser !== 'undefined') ? browser : chrome;

  const GS = {
    enabled: true,
    blocklist: {},
    processedCards: new WeakSet(),
    lastUrl: location.href,
    pendingToast: null
  };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function sendMsg(payload) {
    return new Promise((resolve) => {
      try {
        const res = ext.runtime.sendMessage(payload, (r) => resolve(r || { ok: false }));
        if (res && typeof res.then === "function") res.then(resolve).catch(() => resolve({ ok: false }));
      } catch (e) { resolve({ ok: false }); }
    });
  }

  async function refreshState() {
    const s = await sendMsg({ action: "getState" });
    if (s && typeof s === "object") {
      GS.enabled = s.enabled !== false;
      GS.blocklist = s.blocklist || {};
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
    const h1 = $("h1.game-name, .game-title h1, h1[class*='game']");
    if (h1 && h1.textContent) return h1.textContent.trim();
    const og = document.querySelector('meta[property="og:title"]');
    if (og) return (og.getAttribute("content") || "").trim();
    return document.title.replace(/ - Roblox.*$/i, "").trim();
  }

  function isBlocked(gameId) {
    if (!gameId) return false;
    const e = GS.blocklist[String(gameId)];
    if (!e) return false;
    if (e.unlocked) return false;
    return true;
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

  function buildReportModal(gameId, gameName) {
    const old = document.getElementById("gs-modal-wrap");
    if (old) old.remove();

    const wrap = document.createElement("div");
    wrap.id = "gs-modal-wrap";
    wrap.innerHTML = `
      <div class="gs-modal-back"></div>
      <div class="gs-modal">
        <div class="gs-modal-head">
          <div class="gs-modal-title">Segnala come generato con AI</div>
          <button class="gs-modal-x" type="button" aria-label="Chiudi">×</button>
        </div>
        <div class="gs-modal-body">
          <div class="gs-row"><span class="gs-k">Gioco:</span> <span class="gs-v" id="gs-m-name"></span></div>
          <div class="gs-row"><span class="gs-k">ID:</span> <span class="gs-v" id="gs-m-id"></span></div>
          <label class="gs-label" for="gs-m-reason">Motivo (opzionale)</label>
          <textarea id="gs-m-reason" maxlength="280" placeholder="Es: thumbnail AI, descrizione generica, asset riciclati..."></textarea>
          <div class="gs-hint">La tua segnalazione viene inviata agli admin. Il gioco verrà bloccato localmente nel tuo browser.</div>
        </div>
        <div class="gs-modal-foot">
          <button class="gs-btn gs-btn-ghost" id="gs-m-cancel" type="button">Annulla</button>
          <button class="gs-btn gs-btn-danger" id="gs-m-send" type="button">Segnala e blocca</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);

    $("#gs-m-name", wrap).textContent = gameName || "(sconosciuto)";
    $("#gs-m-id", wrap).textContent = gameId || "-";

    const close = () => { wrap.remove(); };
    $(".gs-modal-x", wrap).addEventListener("click", close);
    $(".gs-modal-back", wrap).addEventListener("click", close);
    $("#gs-m-cancel", wrap).addEventListener("click", close);

    $("#gs-m-send", wrap).addEventListener("click", async () => {
      const reason = ($("#gs-m-reason", wrap).value || "").trim();
      const sendBtn = $("#gs-m-send", wrap);
      sendBtn.disabled = true;
      sendBtn.textContent = "Invio...";

      const url = location.origin + "/games/" + gameId;
      const r = await sendMsg({
        action: "report",
        gameId: gameId,
        gameName: gameName,
        gameUrl: url,
        reason: reason,
        reporter: (navigator.userAgent || "").slice(0, 40)
      });

      if (r && r.ok) {
        await sendMsg({
          action: "setBlocked",
          gameId: gameId,
          info: { name: gameName, source: "user_report" }
        });
        await refreshState();
        applyBlocksEverywhere();
        toast("Segnalazione inviata. Gioco bloccato.", "ok");
        close();
      } else {
        let why = (r && r.reason) || "errore";
        if (why === "rate_limit") why = "troppe segnalazioni, riprova tra poco";
        else if (why === "duplicate") why = "già segnalato di recente";
        else if (why === "no_webhook") why = "webhook non configurato";
        toast("Impossibile inviare: " + why, "err");
        sendBtn.disabled = false;
        sendBtn.textContent = "Segnala e blocca";
      }
    });
  }

  function createReportButtonForDetails() {
    if (document.getElementById("gs-report-btn")) return;
    const gameId = getCurrentGameId();
    if (!gameId) return;

    let host = $("#game-details-play-button-container") ||
               $(".game-calls-to-action") ||
               $("[class*='PlayButton']") ||
               $(".game-main-content");
    if (!host) return;

    const btn = document.createElement("button");
    btn.id = "gs-report-btn";
    btn.type = "button";
    btn.className = "gs-report-btn";
    btn.textContent = "Segnala come AI";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      buildReportModal(gameId, getCurrentGameName());
    });

    try {
      host.appendChild(btn);
    } catch (e) { }
  }

  function lockPlayButtonIfNeeded() {
    const gameId = getCurrentGameId();
    if (!gameId) return;
    if (!GS.enabled) return;
    const blocked = isBlocked(gameId);

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
          b.textContent = "Bloccato (AI)";
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

    if (blocked && !document.getElementById("gs-block-banner")) {
      const host = $("#game-details-play-button-container") || $(".game-calls-to-action");
      if (host) {
        const banner = document.createElement("div");
        banner.id = "gs-block-banner";
        banner.className = "gs-block-banner";
        banner.innerHTML = `
          <span class="gs-b-text">Questo gioco è stato flaggato come AI da GameSlop.</span>
          <button type="button" class="gs-btn gs-btn-ghost gs-btn-sm" id="gs-temp-unlock">Sblocca temporaneamente</button>
          <button type="button" class="gs-btn gs-btn-ghost gs-btn-sm" id="gs-perm-unlock">Rimuovi dalla lista</button>
        `;
        host.appendChild(banner);
        $("#gs-temp-unlock", banner).addEventListener("click", async () => {
          await sendMsg({ action: "unlock", gameId, permanent: false });
          await refreshState();
          applyBlocksEverywhere();
          toast("Sbloccato per questa sessione", "ok");
        });
        $("#gs-perm-unlock", banner).addEventListener("click", async () => {
          await sendMsg({ action: "unlock", gameId, permanent: true });
          await refreshState();
          applyBlocksEverywhere();
          toast("Rimosso dalla blocklist", "ok");
        });
      }
    } else if (!blocked) {
      const bb = document.getElementById("gs-block-banner");
      if (bb) bb.remove();
    }
  }

  function stopBlockedClick(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    toast("Gioco bloccato da GameSlop", "err");
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
    const gameName = (nameEl && nameEl.textContent ? nameEl.textContent : (a.getAttribute("aria-label") || "")).trim();

    card.dataset.gsGameId = gameId;

    if (getComputedStyle(card).position === "static") {
      card.style.position = "relative";
    }

    if (!card.querySelector(".gs-dots")) {
      const dots = document.createElement("button");
      dots.type = "button";
      dots.className = "gs-dots";
      dots.setAttribute("aria-label", "Opzioni GameSlop");
      dots.textContent = "⋯";
      dots.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openCardMenu(card, gameId, gameName, dots);
      });
      card.appendChild(dots);
    }

    applyBlockOnCard(card, gameId);
  }

  function openCardMenu(card, gameId, gameName, anchorEl) {
    const prev = document.getElementById("gs-card-menu");
    if (prev) prev.remove();

    const blocked = isBlocked(gameId);
    const menu = document.createElement("div");
    menu.id = "gs-card-menu";
    menu.className = "gs-card-menu";
    menu.innerHTML = `
      <div class="gs-menu-title">GameSlop</div>
      ${blocked
        ? `<button type="button" data-act="unlock-temp">Sblocca temporaneamente</button>
           <button type="button" data-act="unlock-perm">Rimuovi dalla lista</button>`
        : `<button type="button" data-act="report">Segnala come AI</button>
           <button type="button" data-act="block">Blocca localmente</button>`}
      <button type="button" data-act="close">Annulla</button>
    `;
    document.body.appendChild(menu);

    const rect = anchorEl.getBoundingClientRect();
    let top = rect.bottom + window.scrollY + 4;
    let left = rect.right + window.scrollX - 200;
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
        buildReportModal(gameId, gameName);
      } else if (act === "block") {
        await sendMsg({ action: "setBlocked", gameId, info: { name: gameName, source: "manual" } });
        await refreshState();
        applyBlocksEverywhere();
        toast("Gioco bloccato localmente", "ok");
      } else if (act === "unlock-temp") {
        await sendMsg({ action: "unlock", gameId, permanent: false });
        await refreshState();
        applyBlocksEverywhere();
        toast("Sbloccato temporaneamente", "ok");
      } else if (act === "unlock-perm") {
        await sendMsg({ action: "unlock", gameId, permanent: true });
        await refreshState();
        applyBlocksEverywhere();
        toast("Rimosso dalla blocklist", "ok");
      }
    });
  }

  function applyBlockOnCard(card, gameId) {
    const blocked = GS.enabled && isBlocked(gameId);
    if (blocked) {
      card.classList.add("gs-card-blocked");
      if (!card.querySelector(".gs-card-overlay")) {
        const ov = document.createElement("div");
        ov.className = "gs-card-overlay";
        ov.innerHTML = `<div class="gs-card-ov-text">Bloccato (AI)</div>`;
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
          a.dataset.gsOrigHref = a.getAttribute("href") || "";
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
          delete a.dataset.gsOrigHref;
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

    if (/^\/games\/(\d+)/.test(location.pathname)) {
      createReportButtonForDetails();
      lockPlayButtonIfNeeded();
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
      const oldBtn = document.getElementById("gs-report-btn");
      if (oldBtn) oldBtn.remove();
      const oldB = document.getElementById("gs-block-banner");
      if (oldB) oldB.remove();
    }
    scheduleScan();
  });

  function startup() {
    try {
      obs.observe(document.documentElement || document.body, { childList: true, subtree: true });
    } catch (e) { }
    refreshState().then(() => {
      scanAndInject();
    });
  }

  try {
    ext.storage.onChanged && ext.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.blocklist || changes.enabled) {
        refreshState().then(applyBlocksEverywhere);
      }
    });
  } catch (e) { }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startup, { once: true });
  } else {
    startup();
  }
})();
