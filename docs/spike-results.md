# Phase 0 spike results (measured 2026-09-18)

Scripts live in `spikes/` (`s1-*.mjs` … `s5c-*.mjs`, `s4-sck.swift`); outputs in `spikes/out/` (git-ignored).

**Environment:** Bruno 4.1.0 · Electron 37.6.1 / Chromium 138.0.7204.251 · Playwright 1.63.0 ·
Node 24.18.1 · pnpm 12.4.2 · macOS 26.6.2 · display 3840×2160 @ scale 1 (retina **untested**).

| Spike | Question | Result |
|---|---|---|
| S1 | Can Playwright drive the signed, hardened-runtime `/Applications/Bruno.app`? | **PASS** — 5/5 launches, ~2.4 s each |
| S1d | What happens if Bruno is already running? | Second instance self-quits (single-instance lock); relaunch flow needed |
| S2 | Deterministic geometry | **Window resize is canonical**; device-metrics override does not enlarge the capture surface |
| S3 | Renderer video | `recordVideo` **broken** for the packaged app; CDP `Page.startScreencast` **works** |
| S4 | ScreenCaptureKit helper buildability + permission | Builds with CommandLineTools; Screen Recording not granted yet |
| S5 | Live locator audit | Runner + OpenAPI entry points have derived ids; Send = ⌘↩; theme via renderer localStorage |

## S1 — Playwright Electron launch

- `_electron.launch({ executablePath: '/Applications/Bruno.app/Contents/MacOS/Bruno' })` works. Node
  inspector attaches, `app.evaluate()` has full main-process access: `app.getVersion()` = 4.1.0,
  `BrowserWindow#getBounds/getContentBounds/setContentBounds`, `getMediaSourceId()` = `window:<CGWindowID>:0`.
- Hardened runtime + the two JIT entitlements are **not** an obstacle. `--inspect=0` and
  `--remote-debugging-port=0` are honoured by the packaged binary.
- `ReferenceError: __playwright_run is not defined` in the main-process session is expected for a
  packaged app (Playwright's `loader.js` is only injected via `-r` when launching the npm `electron`
  binary) and harmless.
- The very first attempt failed inside `electron.launch` with "Target page, context or browser has
  been closed"; 5 subsequent launches passed. → wrap launch in **one retry**.
- `chromium.connectOverCDP('http://127.0.0.1:<port>')` against a Bruno started with
  `--remote-debugging-port` also works; `browser.close()` only disconnects (Bruno keeps running);
  `page.viewportSize()` is `null` in that mode.
- 42 `data-testid`s are live at startup (before any collection is opened), including `runner`,
  `sidebar`, `environment-selector-trigger`, `collection-actions`.

## S1d — Bruno already running

- With a user-launched Bruno alive, `electron.launch` fails in ~1 s with the same "closed" error:
  the second instance quits itself. The user's instance is untouched.
- `osascript -e 'tell application "Bruno" to quit'` exits it with code 0 in ~400 ms.
- **Relaunch flow (D1):** detect running Bruno (`pgrep -f 'MacOS/Bruno$'` or `NSRunningApplication`)
  → prompt → graceful quit via AppleScript → wait for exit → launch under Playwright.

## S2 — Geometry

Window content 2056×1291 on launch (restored from the user's last session).

| Mechanism | Renderer `innerWidth×innerHeight` | Screenshot px | Notes |
|---|---|---|---|
| `page.setViewportSize(1600×1000)` | 1600×1000 | — | **Works** under Electron 37 / PW 1.63 (plan assumed it throws) |
| `win.setContentBounds({w:1600,h:1000})` | 1600×1000 | 1600×1000 (`scale: device` and `css` identical at dpr 1) | **Canonical.** Real OS window resize → also correct for Full App Window |
| `Emulation.setDeviceMetricsOverride(1920×1080, dsf 1)` | 1920×1080 | **1600×1000** | Layout grows but the capture surface stays the window size → clipped. Not a substitute for resizing |
| `…setDeviceMetricsOverride(…, dsf 2)` | dpr stayed 1 | 1600×1000 | Override didn't apply; don't rely on it |
| `locator('[data-testid=sidebar]').screenshot()` | — | 220×1230 | Region/locator capture works as expected |

**Rule:** every framing resizes the real window via `setContentBounds` (Electron mode) — one mechanism.
Retina (`scaleFactor` 2) is untested here; expect device-pixel PNGs at 2× and use `scale: 'css'` when
presets mean CSS pixels. macOS clamps windows to the display's work area, so a preset larger than the
screen must be reported by System Status ("display too small for 1920×1080"), not silently clamped.

## S3 — Renderer video

**`recordVideo` (any options):** `firstWindow()` resolves to a page with an empty URL that never
becomes usable (`title()`/`evaluate()` hang, `waitForLoadState` times out), no `Page.startScreencast`
is ever sent, and `video.path()` rejects with "Video recording has not been started". Dead for the
packaged app in PW 1.63.

**CDP `Page.startScreencast` (jpeg q80, 1600×1000, everyNthFrame 1):** works.

- 34 frames in 4.98 s while interacting (mouse move + sidebar toggle ×2); **0 frames during 1.5 s idle**
  — frames are change-driven, so assembly must hold the last frame until the next timestamp.
- Frame gap: min 5 ms, median 16 ms (~60 fps during motion), max 1049 ms (an idle stretch).
- Assembly: frames + `metadata.timestamp` → FFmpeg concat demuxer with per-frame `duration` →
  `-vf fps=30 … libx264 yuv420p` → **1600×1000, 30/1, 96 frames, 3.2 s, 285 KB**.
- `startRecording`/`stopRecording` map directly to `Page.startScreencast`/`stopScreencast`, so
  recording boundaries are exact with no trimming; the same frames can feed the live preview.

## S4 — ScreenCaptureKit helper

- `swiftc -O -swift-version 5 -framework ScreenCaptureKit -framework CoreGraphics` builds a 61 KB
  binary with CommandLineTools only — no Xcode needed.
- `CGPreflightScreenCaptureAccess()` → **not granted** for this process chain. The enumerating run
  (`./out/s4-sck --list`) will trigger the macOS Screen Recording prompt; deferred until the user is
  ready. Signing/TCC plan from the implementation plan is unchanged (stable path, `.app` bundle,
  Developer ID for release).

## S5 — Live locator audit

| Control | Finding | Ladder rung |
|---|---|---|
| Runner entry point | `collection-actions` (visible on row hover) → menu item **`collection-actions-run`** | 2 |
| OpenAPI sync entry | menu item **`collection-actions-sync-openapi`** ("OpenAPI") | 2 |
| Collection menu | all 18 items have derived ids: `collection-actions-{new-request,new-folder,new-app,new-script,run,clone,sync-openapi,rename,share,generate-docs,collapse,show-in-folder,create-mock-server,settings,terminal,move-to-workspace,remove}`; `role="menuitem"` | 2 |
| HTTP Send | no button id/title/aria found; Bruno's own response placeholder lists **⌘ + ↩** for "Send Request" (`response-placeholder-shortcut-value-sendRequest`) | 4 |
| Runner button | `<button data-testid="runner" aria-label="Runner">` | 1 |
| API specs | `<button data-testid="api-specs-header-add-menu" title="Add new API Spec">` | 1 |
| Environments | dropdown: `env-tab-collection`, `env-tab-global`, `env-search-input`, `env-no-environment-item`, `env-list-item` (text = name), `configure-env` | 1 |
| Timeline | no "Timeline" text before a response exists → audit again in Phase 2 with a fixture request sent | tbd |
| Devtools toggle | `toggle-devtools-button` title "Show devtools" | 1 |

**Theme (S5b/S5c):**

- `preferences.json` → `themeMode` is **written by** the renderer, not read at startup (seeding
  `dark` had no effect; it flipped to `light` on disk after the renderer changed). Not a seeding target.
- Source of truth: renderer `localStorage['bruno.theme']` — a JSON-encoded string, observed values
  `"system"`, `"light"`, `"dark"` (plus `bruno.themeVariantLight`/`bruno.themeVariantDark`).
- `localStorage.setItem('bruno.theme', '"dark"')` + `page.reload()` → `html.class === 'dark'`,
  sidebar bg `rgb(26,26,26)`, ~530 ms. Without reload nothing changes.
- **Postcondition** for `theme.set`: `document.documentElement.className` equals the target theme.

## Decisions changed by the spikes

- **D3:** theme is set in-session (localStorage + reload), not by seeding `preferences.json`.
  Workspace/collection seeding via `ui-state-snapshot.json` still to be verified in Phase 2.
- **D9:** renderer recording = CDP screencast frames assembled by FFmpeg; `recordVideo` is dropped.
- **S2 rule:** real window resize for every framing; no device-metrics path.

## Still open

- `ui-state-snapshot.json` as a pre-launch seeding target (verify in Phase 2).
- Retina behaviour (`scaleFactor` 2) for screenshot pixel dimensions.
- Timeline locator (needs a sent request).
- Screen Recording permission run for S4; native recording implementation.

## Bruno main-process facts (from `app.asar` → `src/index.js`, 4.1.0)

- `ELECTRON_USER_DATA_PATH` — if set, Bruno calls `app.setPath('userData', …)` at startup. This is a
  **sanctioned isolated profile**: D4's `profileMode: 'capture'` sets this env var to a seeded directory
  instead of relying on `--user-data-dir`.
- `DISABLE_SINGLE_INSTANCE=true` — skips `app.requestSingleInstanceLock()`. Electron's lock is per
  `userData` anyway, so a capture profile never collides with the user's instance; this flag only
  matters when running two instances on the *same* profile.
- `app.on('window-all-closed', app.quit)` — closing the last window quits (also on macOS).
- Theme: renderer `useLocalStorage('bruno.theme', 'system')` plus `bruno.themeVariantLight/Dark`;
  main mirrors it into `preferences.json` via `store.set('themeMode', …)` — confirming S5b.
- `BRUNO_DEV_PORT` (default 3000) — dev builds load the renderer from a dev server; relevant to
  PRD §21 local-development-build support.

**Consequence for D1/D4:** in `capture` profile mode Bruno Capture launches *its own* Bruno beside a
running user instance with no relaunch prompt at all. The §22 relaunch flow is only needed in `user`
profile mode.

## S6 — Isolated profile for the packaged app (measured)

- `ELECTRON_USER_DATA_PATH` is guarded by `isDev` in `src/index.js` → **no effect** on the installed
  app (the first launcher test silently ran against the user's profile; theme restored afterwards).
- `--user-data-dir=<dir>` **works**: `app.getPath('userData')` and `sessionData` both move to `<dir>`;
  Bruno creates a complete profile there (`preferences.json`, `ui-state-snapshot.json`, `bruno.db`,
  `default-workspace/{collections,environments,workspace.yml}`, Chromium storage).
- Fresh-profile first launch shows the sidebar **and** the onboarding panel, and creates
  `~/Documents/bruno/Sample API Collection - 1` on the user's disk, registered in `workspace.yml`.
  → seed `workspace.yml` with the fixture collection *before* first launch so onboarding has nothing to do.
- `workspace.yml` format: `opencollection: 1.0.0`, `info: {name, type: workspace}`,
  `collections: [{name, path}]`, `specs:`, `docs: ''`.
- `ui-state-snapshot.json` fresh format: `version "0.0.1"`, `activeWorkspacePath`,
  `extras.devTools{open, activeTab, tabs}`, `extras.sidebar{collapsed, width: 250}`,
  `workspaces[]{pathname, environment, lastActiveCollectionPathname, activeWorkspaceTabType, sorting, collections[]}`.

## S7 — Seeded capture profile, end to end (measured)

- `ui-state-snapshot.json` top-level `collections` is an **array** of per-collection UI state:
  `{pathname, workspacePathname, environment{collection,global}, environmentPath, selectedEnvironment, isOpen, isMounted, activeTab{accessor,value}, tabs[]}`.
  **`isOpen: true` is what makes Bruno mount a collection at startup**; seeding `{}` instead of `[]` left
  the sidebar empty. `selectedEnvironment` + `environmentPath` pre-select the environment — so
  `environment.select` is a file write in capture mode and a no-op check at run time.
- `preferences.json` → `preferences.onboarding.hasLaunchedBefore: true` (+ `hasSeenWelcomeModal`,
  `lastSeenVersion`) stops first launch from creating `~/Documents/bruno/Sample API Collection - N`.
  With both seeds in place: fixture collection mounted, onboarding hidden, **nothing written outside the profile**.
- Fixture gotcha: `url: {{baseUrl}}/users` is **invalid YAML** (`{{` opens a flow mapping). Bruno still
  lists the file in the sidebar but the Runner sees "0 of 0 selected". Quote templated URLs.
- Runner: `runner-run-button` is disabled when nothing is selected; `runner-select-all` is a **toggle**
  (clicking it with everything selected deselects). `runner.runCollection` only clicks it when the run
  button is disabled. Run → `runner-cancel-button` visible → `runner-run-again-button` in ~0.8 s for 4 GETs.
- Retina: a run whose window landed on the built-in display produced a **3200×2000** PNG for a
  1600×1000 window (dpr 2) with Playwright's default `scale: 'device'`. Presets are CSS px →
  the capture controller passes `scale` from the preset (`css` by default).
- **End to end through `RunEngine`** (capture profile, `docs-screenshot`): create → seeded profile →
  launch → 11 steps → 2 × 1600×1000 PNG → manifest/snapshot/log, temp workspace removed, Bruno closed,
  user's Bruno untouched: **4.3 s**. Over HTTP (`POST /api/runs` → SSE → download): 4.8 s incl. 3 preview frames.
