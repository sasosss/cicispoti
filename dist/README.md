# GameSlop — Releasable builds

This folder contains packaged builds of the extension, ready for temporary install.

## Files

- `gameslop-1.1.0.zip` — packed extension (Chrome / Edge / Brave)
- `gameslop-1.1.0.xpi` — same package renamed for Firefox temporary install

Both archives contain the exact same files — only the extension differs, so your browser recognizes the expected format.

## Install (Chrome / Edge / Brave)

### Option A — Unpacked (recommended for development)
1. Unzip `gameslop-1.1.0.zip` somewhere.
2. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
3. Toggle **Developer mode** (top right).
4. Click **Load unpacked** and select the unzipped `gameslop-1.1.0/` folder.

### Option B — Drag & drop the zip
1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Drag `gameslop-1.1.0.zip` onto the page.

> Chrome will show a warning that the extension is not from the Chrome Web Store — that's expected for unpacked / local installs.

## Install (Firefox, temporary)

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Select `gameslop-1.1.0.xpi`

> Temporary add-ons remain installed **until the next Firefox restart**, so you can reload and iterate easily.

## First-time setup

After installing, open the extension popup → **Settings** tab → paste your Discord webhook URL (or any HTTPS endpoint that accepts POST JSON) → **Save**.
Reports from users will be sent there for admin review.

## Rebuild

```bash
./scripts/build.sh
```

Requires `web-ext` (`npm i -g web-ext`) for a fully AMO-compatible archive. Falls back to plain `zip` if `web-ext` is not installed.

## Verify

```bash
cd gameslop && web-ext lint
```

Last validation: **0 errors**, 7 warnings (all `UNSAFE_VAR_ASSIGNMENT` on sanitized `innerHTML` template literals).
