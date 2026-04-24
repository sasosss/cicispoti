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
  owners: {},
  groups: {},
  myVotes: {},
  userSalt: null,
  reportsSent: 0,
  reportsAccepted: 0,
  reportsRejected: 0,
  totalVotes: 0,
  lastSeenVersion: "1.2.0",
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

  const targetType = report.targetType || "game";
  const body = {
    type: "ai_" + targetType + "_report",
    target_type: targetType,
    game_id: String(report.gameId || ""),
    game_name: String(report.gameName || "").slice(0, 140),
    game_url: String(report.gameUrl || "").slice(0, 500),
    owner_id: String(report.ownerId || ""),
    owner_name: String(report.ownerName || "").slice(0, 80),
    owner_url: String(report.ownerUrl || "").slice(0, 300),
    group_id: String(report.groupId || ""),
    group_name: String(report.groupName || "").slice(0, 80),
    group_url: String(report.groupUrl || "").slice(0, 300),
    reason: String(report.reason || "").slice(0, 280),
    reporter_hash: userHash,
    ext_version: "1.2.0",
    ts: Date.now()
  };
  body.sig = await hmacLike(JSON.stringify(body));

  const targetLine = targetType === "game"
    ? "Gioco: **" + body.game_name + "** · `" + body.game_id + "`\n" + body.game_url
    : targetType === "owner"
      ? "Owner: **" + body.owner_name + "** · `" + body.owner_id + "`\n" + body.owner_url
      : "Gruppo: **" + body.group_name + "** · `" + body.group_id + "`\n" + body.group_url;

  const header = targetType === "game"
    ? "🚩 **Nuova segnalazione AI (gioco)**"
    : targetType === "owner"
      ? "👤 **Segnalazione creator AI**"
      : "🏷️ **Segnalazione gruppo AI**";

  const questionName = targetType === "game"
    ? body.game_name
    : targetType === "owner"
      ? body.owner_name
      : body.group_name;

  const summary =
    "@everyone\n" +
    header + "\n" +
    targetLine + "\n" +
    "Motivo: " + (body.reason || "_(nessuno)_") + "\n" +
    "Reporter: `" + body.reporter_hash + "` · sig `" + body.sig + "` · v" + body.ext_version;

  const pollPayload = {
    username: "GameSlop",
    content: summary,
    allowed_mentions: { parse: ["everyone"] },
    poll: {
      question: { text: "Confermare flag AI per \"" + String(questionName || "").slice(0, 80) + "\"?" },
      answers: [
        { poll_media: { text: "Conferma (flag AI)", emoji: { name: "🚫" } } },
        { poll_media: { text: "Rifiuta (pulito)", emoji: { name: "✅" } } },
        { poll_media: { text: "Ban (più severo)", emoji: { name: "🔨" } } }
      ],
      duration: 24,
      allow_multiselect: false
    },
    gs_payload: body
  };

  let messageId = "";
  try {
    const res = await fetch(url + "?wait=true", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pollPayload),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      mode: "cors"
    });
    if (!res.ok && res.status !== 204) return { ok: false, reason: "net" };
    try {
      const j = await res.json();
      if (j && j.id) messageId = String(j.id);
    } catch (e) { }
    await setStorage({ reportsSent: (reportsSent || 0) + 1 });
  } catch (e) {
    return { ok: false, reason: "net" };
  }

  try {
    const dbFields = [
      { name: "Type", value: targetType, inline: true },
      { name: "Target ID", value: "`" + (body.game_id || body.owner_id || body.group_id || "-") + "`", inline: true },
      { name: "Reporter", value: "`" + body.reporter_hash + "`", inline: true },
      { name: "Reason", value: (body.reason || "_(nessuno)_").slice(0, 300) },
      { name: "Sig", value: "`" + body.sig + "`", inline: true },
      { name: "Poll msg", value: messageId ? "`" + messageId + "`" : "`-`", inline: true },
      { name: "Version", value: body.ext_version, inline: true }
    ];
    if (body.owner_name) dbFields.push({ name: "Owner", value: body.owner_name + (body.owner_url ? " — " + body.owner_url : ""), inline: false });
    if (body.group_name) dbFields.push({ name: "Group", value: body.group_name + (body.group_url ? " — " + body.group_url : ""), inline: false });

    const dbPayload = {
      username: "GameSlop DB",
      content: "`[DB] " + targetType + " #" + (body.game_id || body.owner_id || body.group_id || "-") + "`",
      allowed_mentions: { parse: [] },
      embeds: [{
        title: "[GameSlop DB] " + (questionName || "").slice(0, 100),
        url: body.game_url || body.owner_url || body.group_url || undefined,
        description: (body.reason || "").slice(0, 280),
        color: targetType === "owner" ? 10181046 : targetType === "group" ? 15844367 : 15548997,
        fields: dbFields,
        timestamp: new Date(body.ts).toISOString(),
        footer: { text: "GameSlop private database" }
      }],
      gs_db_record: body
    };
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dbPayload),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      mode: "cors"
    });
  } catch (e) { }

  return { ok: true, messageId };
}

async function handleReport(msg) {
  if (!msg) return { ok: false, reason: "bad_input" };
  const targetType = msg.targetType || "game";
  const targetId = String(msg.gameId || msg.ownerId || msg.groupId || "");
  if (!targetId) return { ok: false, reason: "bad_input" };
  if (!rateLimitOk()) return { ok: false, reason: "rate_limit" };

  if (targetType === "game") {
    const { games } = await getStorage(["games"]);
    const existing = (games || {})[targetId];
    if (existing && existing.pollResolved) {
      return { ok: false, reason: "already_reviewed", status: existing.status };
    }
    if (existing && (existing.status === STATUS.CONFIRMED || existing.status === STATUS.BANNED)) {
      return { ok: false, reason: "already_flagged", status: existing.status };
    }
    if (existing && existing.status === STATUS.QUEUED && existing.pollMessageId) {
      return { ok: false, reason: "already_pending" };
    }
  }

  if (!dedupeCheck(targetType + ":" + targetId)) return { ok: false, reason: "duplicate" };
  STATE.reportHistory.push(Date.now());

  const r = await postReport(msg);
  if (r.ok) {
    if (targetType === "game") {
      await upsertGame(targetId, {
        name: msg.gameName || "",
        status: STATUS.QUEUED,
        source: "user_report",
        thumb: msg.thumb || "",
        unlocked: false,
        lastReportedAt: Date.now(),
        pollMessageId: r.messageId || "",
        pollCheckedAt: 0,
        pollResolved: false,
        ownerId: msg.ownerId || "",
        ownerName: msg.ownerName || "",
        groupId: msg.groupId || "",
        groupName: msg.groupName || ""
      });
    } else {
      const key = targetType + "s";
      const cur = await getStorage([key]);
      const map = cur[key] || {};
      map[targetId] = {
        id: targetId,
        type: targetType,
        name: targetType === "owner" ? (msg.ownerName || "") : (msg.groupName || ""),
        url: targetType === "owner" ? (msg.ownerUrl || "") : (msg.groupUrl || ""),
        status: STATUS.QUEUED,
        pollMessageId: r.messageId || "",
        pollResolved: false,
        pollCheckedAt: 0,
        addedAt: Date.now()
      };
      await setStorage({ [key]: map });
    }
    const { totalVotes } = await getStorage(["totalVotes"]);
    await setStorage({ totalVotes: (totalVotes || 0) + 1 });
    setTimeout(() => { checkPendingPolls().catch(() => {}); }, 2500);
  }
  return r;
}

const POLL_CHECK_COOLDOWN_MS = 5000;
let _pollCheckInFlight = false;

async function checkPendingPolls() {
  if (_pollCheckInFlight) return { ok: true, skipped: true };
  _pollCheckInFlight = true;
  try {
    const url = _rw();
    if (!url) return { ok: false, reason: "net" };
    const cur = await getStorage(["games", "reportsAccepted", "reportsRejected"]);
    const games = cur.games || {};
    const now = Date.now();
    const pending = Object.values(games).filter((g) =>
      g && g.pollMessageId && !g.pollResolved &&
      (g.status === STATUS.QUEUED || g.status === STATUS.FLAGGED || g.status === STATUS.MIXED) &&
      (now - (g.pollCheckedAt || 0) > POLL_CHECK_COOLDOWN_MS)
    );
    if (pending.length === 0) return { ok: true, checked: 0 };

    let accepted = cur.reportsAccepted || 0;
    let rejected = cur.reportsRejected || 0;
    let resolvedCount = 0;

    for (const g of pending) {
      try {
        const r = await fetch(url + "/messages/" + encodeURIComponent(g.pollMessageId), {
          credentials: "omit",
          referrerPolicy: "no-referrer"
        });
        if (!r.ok) {
          games[g.id] = { ...g, pollCheckedAt: now };
          continue;
        }
        const m = await r.json();
        const counts = (m && m.poll && m.poll.results && m.poll.results.answer_counts) || [];
        let confirm = 0, reject = 0, ban = 0;
        for (const c of counts) {
          if (c.id === 1) confirm = c.count | 0;
          else if (c.id === 2) reject = c.count | 0;
          else if (c.id === 3) ban = c.count | 0;
        }
        const total = confirm + reject + ban;
        const isFinal = !!(m.poll && m.poll.results && m.poll.results.is_finalized);

        if (total === 0) {
          games[g.id] = { ...g, pollCheckedAt: now };
          continue;
        }

        let newStatus = g.status;
        if (ban > 0 && ban >= confirm && ban >= reject) newStatus = STATUS.BANNED;
        else if (confirm > reject) newStatus = STATUS.CONFIRMED;
        else if (reject > confirm) newStatus = STATUS.NONE;
        else newStatus = STATUS.MIXED;

        const prevStatus = g.status;
        const resolvedNow = isFinal || total >= 1;

        games[g.id] = {
          ...g,
          status: newStatus,
          pollCheckedAt: now,
          pollResolved: resolvedNow,
          pollResolvedAt: resolvedNow ? now : (g.pollResolvedAt || 0),
          pollCounts: { confirm, reject, ban }
        };

        if (resolvedNow && prevStatus !== newStatus) {
          if (newStatus === STATUS.CONFIRMED || newStatus === STATUS.BANNED) accepted++;
          else if (newStatus === STATUS.NONE) rejected++;
          resolvedCount++;
        }
      } catch (e) {
        games[g.id] = { ...g, pollCheckedAt: now };
      }
    }

    await setStorage({ games, reportsAccepted: accepted, reportsRejected: rejected });
    STATE.lastSyncAt = now;
    return { ok: true, checked: pending.length, resolved: resolvedCount };
  } finally {
    _pollCheckInFlight = false;
  }
}

const VOTE_LOCK = new Map();

async function handleVote(gameId, vote, info) {
  if (!gameId) return { ok: false, reason: "bad_input" };
  if (vote !== "ai" && vote !== "clean") return { ok: false, reason: "bad_input" };
  const id = String(gameId);

  if (VOTE_LOCK.get(id)) return { ok: false, reason: "in_flight" };
  VOTE_LOCK.set(id, true);
  try {
    const cur = await getStorage(["games", "myVotes", "totalVotes"]);
    const g = cur.games || {};
    const my = cur.myVotes || {};
    const prevVote = my[id] || "";

    if (prevVote === vote) {
      return { ok: true, dup: true, game: g[id] || null };
    }

    const prev = g[id] || {
      id, name: (info && info.name) || "",
      status: STATUS.NONE, unlocked: false, source: "vote",
      addedAt: Date.now(), votesAi: 0, votesClean: 0,
      thumb: (info && info.thumb) || ""
    };
    if (info && info.name && !prev.name) prev.name = info.name;
    if (info && info.thumb && !prev.thumb) prev.thumb = info.thumb;

    if (prevVote === "ai") prev.votesAi = Math.max(0, (prev.votesAi || 0) - 1);
    if (prevVote === "clean") prev.votesClean = Math.max(0, (prev.votesClean || 0) - 1);
    if (vote === "ai") prev.votesAi = (prev.votesAi || 0) + 1;
    if (vote === "clean") prev.votesClean = (prev.votesClean || 0) + 1;
    prev.lastVoteAt = Date.now();

    const ai = prev.votesAi || 0;
    const cl = prev.votesClean || 0;
    if (prev.status === STATUS.NONE || prev.status === STATUS.QUEUED || prev.status === STATUS.MIXED || prev.status === STATUS.FLAGGED) {
      if (ai >= 1 && cl === 0) prev.status = STATUS.QUEUED;
      if (ai >= 2 && cl === 0) prev.status = STATUS.FLAGGED;
      if (ai >= 1 && cl >= 1) prev.status = STATUS.MIXED;
      if (ai === 0 && cl >= 1) prev.status = STATUS.NONE;
    }

    g[id] = prev;
    my[id] = vote;
    const totalDelta = prevVote ? 0 : 1;

    await setStorage({
      games: g,
      myVotes: my,
      totalVotes: (cur.totalVotes || 0) + totalDelta
    });
    return { ok: true, game: prev };
  } finally {
    VOTE_LOCK.delete(id);
  }
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
    "enabled", "games", "owners", "groups", "myVotes", "reportsSent",
    "reportsAccepted", "reportsRejected", "totalVotes", "remoteSyncUrl"
  ]);
  return {
    enabled: cur.enabled !== false,
    games: cur.games || {},
    owners: cur.owners || {},
    groups: cur.groups || {},
    myVotes: cur.myVotes || {},
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
    owners: {},
    groups: {},
    myVotes: {},
    reportsSent: 0,
    reportsAccepted: 0,
    reportsRejected: 0,
    totalVotes: 0
  });
  return { ok: true };
}

api.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
  try {
    api.alarms.create("gs_sync", { periodInMinutes: 60 });
    api.alarms.create("gs_poll_check", { periodInMinutes: 0.5 });
  } catch (e) { }
});

api.runtime.onStartup && api.runtime.onStartup.addListener(async () => {
  await ensureDefaults();
  try {
    api.alarms.create("gs_poll_check", { periodInMinutes: 0.5 });
  } catch (e) { }
});

if (api.alarms && api.alarms.onAlarm) {
  api.alarms.onAlarm.addListener((alarm) => {
    if (!alarm) return;
    if (alarm.name === "gs_sync") syncRemote();
    if (alarm.name === "gs_poll_check") checkPendingPolls().catch(() => {});
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
      if (msg.action === "checkPolls") {
        const r = await checkPendingPolls();
        return sendResponse(r);
      }
      if (msg.action === "removeCreator") {
        const kind = msg.kind === "group" ? "groups" : "owners";
        const cur = await getStorage([kind]);
        const map = cur[kind] || {};
        if (map[String(msg.id)]) delete map[String(msg.id)];
        await setStorage({ [kind]: map });
        return sendResponse({ ok: true });
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
