const api = (typeof browser !== 'undefined') ? browser : chrome;

const WH_PARTS = [
  "NRsaBDVNSRlTRBBEEQlRBE4WCgVKQQRLFgVHHkcURhxLRkAfEVxCSEsWH01BABlAQg==",
  "FAsUG05FTRgHGlZGHBMCCwg=",
  "Tg=="
];
const WH_KEY = "gs_v1_proto_key_7b3a";

const SIG_SECRET = "mFqz71Pw_xE2s_vkR9a_TnA";

const STATE = {
  lastSyncAt: 0,
  reportHistory: [],
  dedupe: new Map()
};

const DEFAULTS = {
  enabled: true,
  blocklist: {},
  userSalt: null,
  reportsSent: 0,
  lastSeenVersion: "1.0.0",
  remoteSyncUrl: ""
};

function xorDecode(b64, key) {
  try {
    const raw = atob(b64);
    let out = "";
    for (let i = 0; i < raw.length; i++) {
      out += String.fromCharCode(raw.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return out;
  } catch (e) {
    return "";
  }
}

function getWebhookFromParts() {
  let s = "";
  for (const p of WH_PARTS) s += xorDecode(p, WH_KEY);
  if (!/^https?:\/\//.test(s)) return "";
  return s;
}

async function getWebhookUrl() {
  const { webhookBlob, userSalt } = await getStorage(["webhookBlob", "userSalt"]);
  if (webhookBlob && userSalt) {
    const dec = xorDecode(webhookBlob, userSalt + WH_KEY);
    if (/^https?:\/\//.test(dec)) return dec;
  }
  return getWebhookFromParts();
}

function xorEncode(text, key) {
  let raw = "";
  for (let i = 0; i < text.length; i++) {
    raw += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  try { return btoa(raw); } catch (e) { return ""; }
}

async function setWebhookUrl(url) {
  if (!url) {
    await setStorage({ webhookBlob: "" });
    return { ok: true, cleared: true };
  }
  if (!/^https?:\/\//i.test(url)) return { ok: false, reason: "invalid_url" };
  const { userSalt } = await getStorage(["userSalt"]);
  if (!userSalt) return { ok: false, reason: "no_salt" };
  const blob = xorEncode(url, userSalt + WH_KEY);
  await setStorage({ webhookBlob: blob });
  return { ok: true };
}

async function sha256Hex(text) {
  const buf = new TextEncoder().encode(text);
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hmacLike(payload) {
  return (await sha256Hex(SIG_SECRET + "|" + payload + "|" + SIG_SECRET)).slice(0, 24);
}

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

async function ensureDefaults() {
  const cur = await getStorage(Object.keys(DEFAULTS));
  const patch = {};
  for (const k of Object.keys(DEFAULTS)) {
    if (cur[k] === undefined || cur[k] === null) patch[k] = DEFAULTS[k];
  }
  if (!cur.userSalt) {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    patch.userSalt = [...arr].map(b => b.toString(16).padStart(2, "0")).join("");
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

async function postReport(report) {
  const url = await getWebhookUrl();
  if (!url) return { ok: false, reason: "no_webhook" };

  const { userSalt, reportsSent } = await getStorage(["userSalt", "reportsSent"]);
  const userHash = (await sha256Hex((userSalt || "x") + "::" + (report.reporter || "anon"))).slice(0, 16);

  const body = {
    type: "ai_game_report",
    game_id: String(report.gameId || ""),
    game_name: String(report.gameName || "").slice(0, 140),
    game_url: String(report.gameUrl || "").slice(0, 500),
    reason: String(report.reason || "").slice(0, 280),
    reporter_hash: userHash,
    ext_version: "1.0.0",
    ts: Date.now()
  };

  const payloadStr = JSON.stringify(body);
  body.sig = await hmacLike(payloadStr);

  const discordLike = {
    username: "GameSlop",
    embeds: [{
      title: "Nuova segnalazione AI",
      description: "Gioco: **" + body.game_name + "**\nID: `" + body.game_id + "`\nURL: " + body.game_url + "\nMotivo: " + (body.reason || "(nessuno)"),
      color: 15548997,
      fields: [
        { name: "Reporter", value: "`" + body.reporter_hash + "`", inline: true },
        { name: "Sig", value: "`" + body.sig + "`", inline: true },
        { name: "Versione", value: body.ext_version, inline: true }
      ],
      timestamp: new Date(body.ts).toISOString()
    }],
    gs_payload: body
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GS-Sig": body.sig
      },
      body: JSON.stringify(discordLike),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      mode: "cors"
    });
    if (!res.ok && res.status !== 204) {
      return { ok: false, reason: "http_" + res.status };
    }
    await setStorage({ reportsSent: (reportsSent || 0) + 1 });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "network" };
  }
}

async function handleReport(msg) {
  if (!msg || !msg.gameId) return { ok: false, reason: "bad_input" };
  if (!rateLimitOk()) return { ok: false, reason: "rate_limit" };
  if (!dedupeCheck(msg.gameId)) return { ok: false, reason: "duplicate" };
  STATE.reportHistory.push(Date.now());

  const r = await postReport(msg);
  return r;
}

async function handleGetBlocklist() {
  const { blocklist, enabled } = await getStorage(["blocklist", "enabled"]);
  return { enabled: enabled !== false, blocklist: blocklist || {} };
}

async function handleSetBlocked(gameId, info) {
  if (!gameId) return { ok: false };
  const { blocklist } = await getStorage(["blocklist"]);
  const bl = blocklist || {};
  bl[String(gameId)] = {
    name: info && info.name ? String(info.name).slice(0, 140) : "",
    addedAt: Date.now(),
    source: info && info.source ? info.source : "manual",
    unlocked: false
  };
  await setStorage({ blocklist: bl });
  return { ok: true };
}

async function handleUnlock(gameId, permanent) {
  const { blocklist } = await getStorage(["blocklist"]);
  const bl = blocklist || {};
  if (!bl[String(gameId)]) return { ok: true };
  if (permanent) {
    delete bl[String(gameId)];
  } else {
    bl[String(gameId)].unlocked = true;
    bl[String(gameId)].unlockedAt = Date.now();
  }
  await setStorage({ blocklist: bl });
  return { ok: true };
}

async function syncRemote() {
  const { remoteSyncUrl } = await getStorage(["remoteSyncUrl"]);
  if (!remoteSyncUrl) return;
  try {
    const r = await fetch(remoteSyncUrl, { credentials: "omit", referrerPolicy: "no-referrer" });
    if (!r.ok) return;
    const data = await r.json();
    if (data && Array.isArray(data.games)) {
      const { blocklist } = await getStorage(["blocklist"]);
      const bl = blocklist || {};
      let added = 0;
      for (const g of data.games) {
        const id = String(g.id || g.gameId || "");
        if (!id) continue;
        if (!bl[id]) {
          bl[id] = {
            name: String(g.name || "").slice(0, 140),
            addedAt: Date.now(),
            source: "remote",
            unlocked: false
          };
          added++;
        }
      }
      if (added > 0) await setStorage({ blocklist: bl });
      STATE.lastSyncAt = Date.now();
    }
  } catch (e) { }
}

api.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
  try {
    api.alarms.create("gs_sync", { periodInMinutes: 60 });
  } catch (e) { }
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

      if (msg.action === "report") {
        const r = await handleReport(msg);
        return sendResponse(r);
      }
      if (msg.action === "getState") {
        const s = await handleGetBlocklist();
        const { reportsSent } = await getStorage(["reportsSent"]);
        return sendResponse({ ...s, reportsSent: reportsSent || 0 });
      }
      if (msg.action === "setBlocked") {
        const r = await handleSetBlocked(msg.gameId, msg.info || {});
        return sendResponse(r);
      }
      if (msg.action === "unlock") {
        const r = await handleUnlock(msg.gameId, !!msg.permanent);
        return sendResponse(r);
      }
      if (msg.action === "toggleEnabled") {
        const { enabled } = await getStorage(["enabled"]);
        const next = !(enabled !== false);
        await setStorage({ enabled: next });
        return sendResponse({ ok: true, enabled: next });
      }
      if (msg.action === "setWebhook") {
        const r = await setWebhookUrl(String(msg.url || ""));
        return sendResponse(r);
      }
      if (msg.action === "hasWebhook") {
        const u = await getWebhookUrl();
        return sendResponse({ ok: true, hasWebhook: !!u });
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
      sendResponse({ ok: false, reason: "unknown_action" });
    } catch (e) {
      sendResponse({ ok: false, reason: "exception" });
    }
  })();
  return true;
});

ensureDefaults();
