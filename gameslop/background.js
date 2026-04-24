const api = (typeof browser !== 'undefined') ? browser : chrome;

const SIG_SECRET = "mFqz71Pw_xE2s_vkR9a_TnA";
const WH_KEY = "gs_v1_proto_key_7b3a";
const SALT_TAG = "Mk9qR2x7NbPz3eVtY4uA8sD1fG";
const VER_BLOB = "x94Hq_v1.1.0_Jk8NmLpRvXyZ";

const _K = { SIG_SECRET, WH_KEY, SALT_TAG, VER_BLOB };

const _W = [{"b":"BjZ1DRsFGVtlFnRWJTsqAggmJwAmNlxCAFtBCzcJKBs=","r":["WH_KEY","SALT_TAG","SIG_SECRET"],"t":"ca40b4","i":4},{"b":"LCFDQHQpESA2CB4LETgPGwwwJg==","r":["VER_BLOB","SALT_TAG"],"t":"22e894","i":3},{"b":"PRsVcjhdcS9yGkUmKAsADxFPGC9nWTomNkkyAg==","r":["WH_KEY","SALT_TAG","SIG_SECRET"],"t":"78e1f2","i":-1},{"b":"AUtbWV0lNEdwQUdmRUNNWU5rRAMFXFpfaH90Xhsg","r":["WH_KEY","VER_BLOB"],"t":"6d707d","i":1},{"b":"ECINU1cTJSYFQAsrFkUANQ==","r":["SALT_TAG","SIG_SECRET"],"t":"c63522","i":2},{"b":"PgYDI2YZYDUSC3cmIzIaFFRBD0ILI0pfbGBZKw4qPWUwJAQgQzsfXHQBFy8ZeTt+RQ==","r":["WH_KEY","SALT_TAG","SIG_SECRET"],"t":"03cc6c","i":-1},{"b":"AXMIFEoQIHsxIE4tN34GTS8/KBgfTDw1Fw==","r":["VER_BLOB","SALT_TAG"],"t":"cf4457","i":-1},{"b":"EhtNQUFwbkQ7GQA8DgscQRk3GxhQHwJE","r":["SIG_SECRET","WH_KEY"],"t":"02baab","i":0}];

const _MS = "z9Kq";

function _crc24(s) {
  let crc = 0xb704ce;
  const poly = 0x864cfb;
  const enc = new TextEncoder().encode(s);
  for (let j = 0; j < enc.length; j++) {
    crc ^= (enc[j] << 16);
    for (let k = 0; k < 8; k++) {
      crc <<= 1;
      if (crc & 0x1000000) crc ^= poly;
    }
  }
  return (crc & 0xffffff).toString(16).padStart(6, "0");
}

function _pk(n, recipe) {
  const order = recipe.concat(Object.keys(_K));
  let out = "";
  while (out.length < n) {
    for (let i = 0; i < order.length && out.length < n; i++) {
      const s = _K[order[i]];
      const step = ((out.length * 7 + 3) % s.length);
      out += s[step];
    }
  }
  return out;
}

function _xd(b64, key) {
  const raw = atob(b64);
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    out += String.fromCharCode(raw.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return out;
}

function _rw() {
  const real = [];
  for (const e of _W) {
    const joined = e.r.join("");
    const tagInputReal = e.b + _MS + joined + String(e.i);
    const tagInputDecoy = e.b + _MS + joined + "decoy";
    const gotReal = (parseInt(_crc24(tagInputReal), 16) ^ 0x5A7B91).toString(16).padStart(6, "0");
    const gotDecoy = (parseInt(_crc24(tagInputDecoy), 16) ^ 0x5A7B91).toString(16).padStart(6, "0");
    if (e.i >= 0 && gotReal === e.t) {
      const rawLen = atob(e.b).length;
      const key = _pk(Math.max(rawLen, 16), e.r);
      real[e.i] = _xd(e.b, key);
    } else if (e.i < 0 && gotDecoy === e.t) {
      continue;
    } else {
      return "";
    }
  }
  const s = real.join("");
  if (!/^https:\/\//.test(s)) return "";
  return s;
}

const STATUS = {
  NONE: "none",
  QUEUED: "queued",
  FLAGGED: "flagged",
  MIXED: "mixed",
  CONFIRMED: "confirmed",
  BANNED: "banned"
};

const STATE = {
  lastSyncAt: 0,
  reportHistory: [],
  dedupe: new Map()
};

const DEFAULTS = {
  enabled: true,
  games: {},
  userSalt: null,
  reportsSent: 0,
  reportsAccepted: 0,
  reportsRejected: 0,
  totalVotes: 0,
  lastSeenVersion: "1.1.0",
  remoteSyncUrl: ""
};

function getStorage(keys) {
  return new Promise((resolve) => {
    try {
      const res = api.storage.local.get(keys, (items) => resolve(items || {}));
      if (res && typeof res.then === "function") res.then(resolve).catch(() => resolve({}));
    } catch (e) { resolve({}); }
  });
}

function setStorage(obj) {
  return new Promise((resolve) => {
    try {
      const res = api.storage.local.set(obj, () => resolve());
      if (res && typeof res.then === "function") res.then(() => resolve()).catch(() => resolve());
    } catch (e) { resolve(); }
  });
}

async function sha256Hex(text) {
  const buf = new TextEncoder().encode(text);
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hmacLike(payload) {
  return (await sha256Hex(SIG_SECRET + "|" + payload + "|" + SIG_SECRET)).slice(0, 24);
}

async function ensureDefaults() {
  const cur = await getStorage(Object.keys(DEFAULTS).concat(["blocklist", "webhookBlob"]));
  const patch = {};
  for (const k of Object.keys(DEFAULTS)) {
    if (cur[k] === undefined || cur[k] === null) patch[k] = DEFAULTS[k];
  }
  if (!cur.userSalt) {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    patch.userSalt = [...arr].map(b => b.toString(16).padStart(2, "0")).join("");
  }
  if (cur.blocklist && !cur.games) {
    const migrated = {};
    for (const [id, it] of Object.entries(cur.blocklist)) {
      migrated[id] = {
        id, name: it.name || "",
        status: it.unlocked ? STATUS.MIXED : STATUS.FLAGGED,
        unlocked: !!it.unlocked, source: it.source || "manual",
        addedAt: it.addedAt || Date.now(),
        votesAi: 0, votesClean: 0, thumb: ""
      };
    }
    patch.games = migrated;
  }
  if (cur.webhookBlob !== undefined) {
    try { api.storage.local.remove("webhookBlob"); } catch (e) {}
  }
  if (Object.keys(patch).length) await setStorage(patch);
}

function rateLimitOk() {
  const now = Date.now();
  STATE.reportHistory = STATE.reportHistory.filter(t => now - t < 60 * 1000);
  if (STATE.reportHistory.length >= 5) return false;
  const last = STATE.reportHistory[STATE.reportHistory.length - 1] || 0;
  if (now - last < 3000) return false;
  return true;
}

function dedupeCheck(gameId) {
  const now = Date.now();
  for (const [k, v] of STATE.dedupe) {
    if (now - v > 6 * 60 * 60 * 1000) STATE.dedupe.delete(k);
  }
  if (STATE.dedupe.has(String(gameId))) return false;
  STATE.dedupe.set(String(gameId), now);
  return true;
}

async function upsertGame(id, patch) {
  if (!id) return null;
  id = String(id);
  const { games } = await getStorage(["games"]);
  const g = games || {};
  const prev = g[id] || {
    id, name: "", status: STATUS.NONE, unlocked: false, source: "",
    addedAt: Date.now(), votesAi: 0, votesClean: 0, thumb: ""
  };
  const next = { ...prev, ...patch, id };
  g[id] = next;
  await setStorage({ games: g });
  return next;
}

async function postReport(report) {
  const url = _rw();
  if (!url) return { ok: false, reason: "net" };

  const { userSalt, reportsSent } = await getStorage(["userSalt", "reportsSent"]);
  const userHash = (await sha256Hex((userSalt || "x") + "::" + (report.reporter || "anon"))).slice(0, 16);

  const body = {
    type: "ai_game_report",
    game_id: String(report.gameId || ""),
    game_name: String(report.gameName || "").slice(0, 140),
    game_url: String(report.gameUrl || "").slice(0, 500),
    reason: String(report.reason || "").slice(0, 280),
    reporter_hash: userHash,
    ext_version: "1.1.0",
    ts: Date.now()
  };
  body.sig = await hmacLike(JSON.stringify(body));

  const summary =
    "**Nuova segnalazione AI** — " + body.game_name + "\n" +
    "ID: `" + body.game_id + "` · " + body.game_url + "\n" +
    "Motivo: " + (body.reason || "_(nessuno)_") + "\n" +
    "Reporter: `" + body.reporter_hash + "` · sig `" + body.sig + "` · v" + body.ext_version;

  const pollPayload = {
    username: "GameSlop",
    content: summary,
    poll: {
      question: { text: "Confermare flag AI per \"" + body.game_name.slice(0, 80) + "\"?" },
      answers: [
        { poll_media: { text: "Conferma (flag AI)", emoji: { name: "🚫" } } },
        { poll_media: { text: "Rifiuta (gioco pulito)", emoji: { name: "✅" } } },
        { poll_media: { text: "Ban (più severo)", emoji: { name: "🔨" } } }
      ],
      duration: 24,
      allow_multiselect: false
    },
    gs_payload: body
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pollPayload),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      mode: "cors"
    });
    if (!res.ok && res.status !== 204) {
      return { ok: false, reason: "net" };
    }
    await setStorage({ reportsSent: (reportsSent || 0) + 1 });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "net" };
  }
}

async function handleReport(msg) {
  if (!msg || !msg.gameId) return { ok: false, reason: "bad_input" };
  if (!rateLimitOk()) return { ok: false, reason: "rate_limit" };
  if (!dedupeCheck(msg.gameId)) return { ok: false, reason: "duplicate" };
  STATE.reportHistory.push(Date.now());

  const r = await postReport(msg);
  if (r.ok) {
    await upsertGame(msg.gameId, {
      name: msg.gameName || "",
      status: STATUS.QUEUED,
      source: "user_report",
      thumb: msg.thumb || "",
      unlocked: false,
      lastReportedAt: Date.now()
    });
    const { totalVotes } = await getStorage(["totalVotes"]);
    await setStorage({ totalVotes: (totalVotes || 0) + 1 });
  }
  return r;
}

async function handleVote(gameId, vote, info) {
  if (!gameId) return { ok: false };
  const cur = await getStorage(["games", "totalVotes"]);
  const g = cur.games || {};
  const prev = g[String(gameId)] || {
    id: String(gameId), name: (info && info.name) || "",
    status: STATUS.NONE, unlocked: false, source: "vote",
    addedAt: Date.now(), votesAi: 0, votesClean: 0,
    thumb: (info && info.thumb) || ""
  };
  if (vote === "ai") prev.votesAi = (prev.votesAi || 0) + 1;
  else if (vote === "clean") prev.votesClean = (prev.votesClean || 0) + 1;
  prev.lastVoteAt = Date.now();

  const ai = prev.votesAi || 0;
  const cl = prev.votesClean || 0;
  if (prev.status === STATUS.NONE || prev.status === STATUS.QUEUED) {
    if (ai >= 1 && cl === 0) prev.status = STATUS.QUEUED;
    if (ai >= 2 && cl === 0) prev.status = STATUS.FLAGGED;
    if (ai >= 1 && cl >= 1) prev.status = STATUS.MIXED;
  }

  g[String(gameId)] = prev;
  await setStorage({
    games: g,
    totalVotes: (cur.totalVotes || 0) + 1
  });
  return { ok: true, game: prev };
}

async function handleSetStatus(gameId, status, info) {
  if (!gameId) return { ok: false };
  const patch = {
    status: status,
    source: (info && info.source) || "manual"
  };
  if (info && info.name) patch.name = info.name;
  if (info && info.thumb) patch.thumb = info.thumb;
  if (status === STATUS.CONFIRMED || status === STATUS.BANNED || status === STATUS.FLAGGED) {
    patch.unlocked = false;
  }
  const g = await upsertGame(gameId, patch);
  return { ok: true, game: g };
}

async function handleUnlock(gameId, permanent) {
  const { games } = await getStorage(["games"]);
  const g = games || {};
  if (!g[String(gameId)]) return { ok: true };
  if (permanent) delete g[String(gameId)];
  else {
    g[String(gameId)].unlocked = true;
    g[String(gameId)].unlockedAt = Date.now();
  }
  await setStorage({ games: g });
  return { ok: true };
}

async function handleGetState() {
  const cur = await getStorage([
    "enabled", "games", "reportsSent", "reportsAccepted",
    "reportsRejected", "totalVotes", "remoteSyncUrl"
  ]);
  return {
    enabled: cur.enabled !== false,
    games: cur.games || {},
    reportsSent: cur.reportsSent || 0,
    reportsAccepted: cur.reportsAccepted || 0,
    reportsRejected: cur.reportsRejected || 0,
    totalVotes: cur.totalVotes || 0,
    remoteSyncUrl: cur.remoteSyncUrl || "",
    lastSyncAt: STATE.lastSyncAt
  };
}

async function syncRemote() {
  const { remoteSyncUrl } = await getStorage(["remoteSyncUrl"]);
  if (!remoteSyncUrl) return;
  try {
    const r = await fetch(remoteSyncUrl, { credentials: "omit", referrerPolicy: "no-referrer" });
    if (!r.ok) return;
    const data = await r.json();
    if (data && Array.isArray(data.games)) {
      const { games } = await getStorage(["games"]);
      const g = games || {};
      let accepted = 0;
      let rejected = 0;
      for (const it of data.games) {
        const id = String(it.id || it.gameId || "");
        if (!id) continue;
        const prevStatus = g[id] && g[id].status;
        const status = (it.status || STATUS.CONFIRMED).toLowerCase();
        const wasQueued = prevStatus === STATUS.QUEUED || prevStatus === STATUS.FLAGGED;
        g[id] = {
          id,
          name: String(it.name || (g[id] && g[id].name) || "").slice(0, 140),
          status: Object.values(STATUS).includes(status) ? status : STATUS.CONFIRMED,
          unlocked: g[id] ? !!g[id].unlocked : false,
          source: "remote",
          addedAt: (g[id] && g[id].addedAt) || Date.now(),
          votesAi: (g[id] && g[id].votesAi) || 0,
          votesClean: (g[id] && g[id].votesClean) || 0,
          thumb: (it.thumb || (g[id] && g[id].thumb) || "")
        };
        if (wasQueued && (status === STATUS.CONFIRMED || status === STATUS.BANNED)) accepted++;
        if (wasQueued && status === "clean") rejected++;
      }
      const cur = await getStorage(["reportsAccepted", "reportsRejected"]);
      await setStorage({
        games: g,
        reportsAccepted: (cur.reportsAccepted || 0) + accepted,
        reportsRejected: (cur.reportsRejected || 0) + rejected
      });
      STATE.lastSyncAt = Date.now();
    }
  } catch (e) { }
}

async function handleClearData() {
  await setStorage({
    games: {},
    reportsSent: 0,
    reportsAccepted: 0,
    reportsRejected: 0,
    totalVotes: 0
  });
  return { ok: true };
}

api.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
  try { api.alarms.create("gs_sync", { periodInMinutes: 60 }); } catch (e) { }
});

api.runtime.onStartup && api.runtime.onStartup.addListener(async () => {
  await ensureDefaults();
});

if (api.alarms && api.alarms.onAlarm) {
  api.alarms.onAlarm.addListener((alarm) => {
    if (alarm && alarm.name === "gs_sync") syncRemote();
  });
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (!msg || !msg.action) return sendResponse({ ok: false, reason: "bad_msg" });

      if (msg.action === "getState") return sendResponse(await handleGetState());
      if (msg.action === "report") return sendResponse(await handleReport(msg));
      if (msg.action === "vote") return sendResponse(await handleVote(msg.gameId, msg.vote, msg.info));
      if (msg.action === "setStatus") return sendResponse(await handleSetStatus(msg.gameId, msg.status, msg.info));
      if (msg.action === "unlock") return sendResponse(await handleUnlock(msg.gameId, !!msg.permanent));
      if (msg.action === "toggleEnabled") {
        const { enabled } = await getStorage(["enabled"]);
        const next = !(enabled !== false);
        await setStorage({ enabled: next });
        return sendResponse({ ok: true, enabled: next });
      }
      if (msg.action === "setRemoteSync") {
        await setStorage({ remoteSyncUrl: String(msg.url || "") });
        syncRemote();
        return sendResponse({ ok: true });
      }
      if (msg.action === "forceSync") {
        await syncRemote();
        return sendResponse({ ok: true, lastSyncAt: STATE.lastSyncAt });
      }
      if (msg.action === "clearData") return sendResponse(await handleClearData());

      sendResponse({ ok: false, reason: "unknown_action" });
    } catch (e) {
      sendResponse({ ok: false, reason: "exception" });
    }
  })();
  return true;
});

ensureDefaults();
