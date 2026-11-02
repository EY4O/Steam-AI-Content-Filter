# Development

The repository root is the Millennium plugin; `millennium.toml` tells the compiler where each part lives.

```
backend/         Lua backend: settings, allowlist, RPC functions (age-gated fetch)
frontend/        Settings panel shown in Steam's main UI (React/TSX)
webview/         Store-page script: detection, checks and cache, list scanner, UI
resources/       Static assets (icon)
docs/            this file, README images and the demo video
millennium.toml  Plugin manifest and compiler settings
```

| File | Role |
|---|---|
| `webview/detect.ts` | Disclosure headings in 30 languages; reads the Content Descriptors box. |
| `webview/checker.ts` | Batched store-API lookups, store-page fallback queue, rate-limit pause, verdict cache. |
| `webview/scanner.ts` | Finds game entries in store lists and marks them (hide, blur, badge). |
| `webview/ui.ts` | Styles, block screen, banners, counter chip. |
| `webview/preload.ts` | Entry point: loads settings, runs the game page and the scanner, polls for changes. |
| `backend/settings.lua` | Defaults and the allowlist, stored in Millennium's config. |
| `backend/rpc_functions.lua` | Functions the store page and settings panel call through `backend.*`. |

## Run it locally

Requirements: Node.js 18+, Steam with [Millennium](https://steambrew.app) installed.

```bash
npm install
npx starlight lsp
```

`lsp` generates the type definitions for the editor. To build:

```bash
npx starlight pack
```

With `output_path = "dist"` the packed plugin is written to `dist` in the project folder. Set `output_path = "auto"` in `millennium.toml` to install the build straight into `Steam\millennium\plugins\ai-content-filter.star`; the compiler then asks Millennium to reload the plugin, which also reloads Steam's UI.

Logs are under **Steam → Millennium → Logs → AI Content Filter**. The store-page script logs with the prefix `[AI Content Filter]`.

## Tests

There is no automated test suite yet. Before a release, check by hand in the Steam client:

| Area | Check |
|---|---|
| Search list | AI games are hidden, blurred or badged per the selected mode; the counter matches. DevTools shows `GetItems` requests and no `/app/` fetches. |
| API fallback | With `api.steampowered.com` blocked, games are still checked through their store pages. |
| Mode switch | Changing the mode in settings updates an open store page within a few seconds. |
| Game page | The block screen appears; **Esc** goes back; **Show page this time** leaves a banner. |
| Allowlist | **Always allow this game** persists after a restart; **Remove from allowlist** brings the block screen back. |
| Wishlist | With **Show games on my wishlist** off, AI games' rows are hidden; with it on, they get the AI badge. |
| Owned games | Owned AI games get the AI badge in lists and a banner (no block screen) on their page; the counter doesn't count them. |
| Tooltips | Hovering a badge or a blurred game shows the developer's disclosure text; it also shows on keyboard focus. |
| Counter switch | With **Show the AI games counter** off, the bottom-right counter never appears; turning it on shows it within a few seconds. |
| Clean games | A game with only a mature content notice is not flagged. |

## Releasing

1. Bump `version` in `millennium.toml` and add a line to the README changelog.
2. Commit and push to `main`.
3. Build with `npx starlight pack --release` and attach the packed file, renamed to `ai-content-filter.star`, to a GitHub release.
