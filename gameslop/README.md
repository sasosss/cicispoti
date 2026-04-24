# GameSlop

Cross-browser extension (Chrome + Firefox, Manifest V3) that flags AI-generated Roblox games and lets users report them to an admin webhook for review.

## Features

- **Floating panel** on every game page (`/games/{id}`) with avatar, name, ID and a colored status badge (`Not Flagged`, `Under Review`, `Flagged`, `Mixed`, `Confirmed AI`, `Banned`). One-click "Queue for Review" or "Looks legit" vote.
- **3-dots menu** on every game card (home, categories, search, profile) to report / vote / block / unlock without leaving the page.
- **Blocked games**: Play button disabled, card overlay with "Confirmed AI" / "Banned" label, anchor click intercepted.
- **Popup with 3 tabs** in the style of a security indicator:
  - **Stats** — Games (Flagged / Confirmed / Mixed / Banned), Reports (Sent / Accepted / Pending / Rejected), Community (Total Votes / Queued Games).
  - **Queue** — filterable list of games per status with open / unlock / remove actions.
  - **Settings** — enable toggle, webhook (password input), remote blocklist sync, clear data.
- **Admin workflow**: reports posted to a Discord-compatible webhook with a structured `gs_payload` and signature. Admin decisions propagate back via the remote blocklist endpoint (`{ games: [{ id, name, status }] }`).
- **Rate limit** (5 reports / minute, 3s min gap) + **dedup** (6h) + **pseudo-HMAC** signature on each report (`X-GS-Sig` header).

## Status model

| Status       | Blocks play | Source                       |
|--------------|-------------|------------------------------|
| `none`       | no          | default                      |
| `queued`     | no          | user report / pending review |
| `flagged`    | **yes**     | 2+ AI votes, no clean        |
| `mixed`      | no          | votes on both sides          |
| `confirmed`  | **yes**     | admin approved               |
| `banned`     | **yes**     | admin banned                 |

## Install

### Chrome / Edge / Brave
1. `chrome://extensions` → enable Developer mode
2. "Load unpacked" → select the `gameslop/` folder

### Firefox
1. `about:debugging#/runtime/this-firefox`
2. "Load Temporary Add-on" → select `gameslop/manifest.json`

## Admin setup

Open the extension popup → **Settings** → paste your Discord webhook (or any HTTPS endpoint that accepts POST JSON) → Save. Optional: paste a remote sync URL returning a JSON of curated confirmed/banned games.

Report payload (`gs_payload` inside the Discord-style body, also in `X-GS-Sig`):
```json
{
  "type": "ai_game_report",
  "game_id": "123",
  "game_name": "...",
  "game_url": "https://www.roblox.com/games/123",
  "reason": "AI thumbnail...",
  "reporter_hash": "abc123...",
  "ext_version": "1.1.0",
  "ts": 1713900000000,
  "sig": "..."
}
```

## Anti-leak notes

- No real webhook hardcoded in the source. The XOR-obfuscated parts decode to random noise (no valid URL).
- Admin-configured webhook is stored in `chrome.storage.local` XOR-encoded with a per-install random 16-byte salt.
- Pseudo-HMAC (SHA-256 with internal secret) on each report so the admin bot can filter random noise if someone scrapes the webhook URL.
- Fetches use `credentials: "omit"` and `referrerPolicy: "no-referrer"` — no Roblox cookies leak to the webhook.
- Minimal permissions (`storage`, `alarms`, host on `*.roblox.com`).
