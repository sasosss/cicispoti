# GameSlop

Cross-browser extension (Chrome + Firefox, Manifest V3) that flags AI-generated Roblox games.

## Features

- **Floating panel** on every game page (`/games/{id}`) with avatar, name, ID and a colored status badge (`Not Flagged`, `Under Review`, `Flagged`, `Mixed`, `Confirmed AI`, `Banned`). One-click "Queue for Review" or "Looks legit" vote.
- **3-dots menu** on every game card (home, categories, search, profile) to report / vote / block / unlock without leaving the page.
- **Blocked games**: Play button disabled, card overlay with "Confirmed AI" / "Banned" label, anchor click intercepted.
- **Popup with 3 tabs**:
  - **Stats** — Games (Flagged / Confirmed / Mixed / Banned), Reports (Sent / Accepted / Pending / Rejected), Community (Total Votes / Queued Games).
  - **Queue** — filterable list of games per status with open / unlock / remove actions.
  - **Settings** — enable toggle, remote blocklist sync, clear data.
- **Rate limit** (5 reports / minute, 3s min gap) + **dedup** (6h) + **pseudo-HMAC** signature on each report.

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

Prebuilt archives live in [`dist/`](../dist) (run `./scripts/build.sh` to regenerate).

### Chrome / Edge / Brave
1. `chrome://extensions` → enable Developer mode
2. Either drag `dist/gameslop-1.2.1.zip` onto the page, or unzip and click "Load unpacked" on the extracted folder.

### Firefox (temporary install)
1. `about:debugging#/runtime/this-firefox`
2. "Load Temporary Add-on…" → select `dist/gameslop-1.2.1.xpi`

Reports are sent automatically on submission. No setup required.

## Admin review flow

When a user reports a game, the extension posts a Discord poll to the configured channel asking admins to vote:
- 🚫 **Confirm flag** → game becomes `confirmed`
- ✅ **Reject** → game treated as `clean`
- 🔨 **Ban** → game becomes `banned`

### Shared database (not just local)

`chrome.storage.local` is **per browser** and is **wiped when the extension is removed**. To keep the same AI-flagged games for **every user** and after **reinstall**, the extension always fetches a public JSON blocklist:

- Default URL: `gameslop/blocklist.json` on the `main` branch of this repo (GitHub raw). Edit that file (or your fork) to publish confirmed games, owners, and groups.
- Shape: `{ "games": [...], "owners": [...], "groups": [...] }` — each item needs at least `id` (or `gameId` / `owner_id` / `group_id`) and optional `name`, `thumb`, `url`, `status` (`confirmed`, `banned`, `none`, etc.).

On install, startup, service worker wake, hourly alarm, and after clearing local data, the extension merges those lists into local storage (custom URL in Settings is **optional** and merged on top when set).

The remote sync URL (Settings tab) still lets you add a **second** admin-curated endpoint; both feeds are merged.
