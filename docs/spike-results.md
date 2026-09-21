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

## Phase 5a — renderer recording, measured against ffmpeg 8.1.1

- **concat demuxer trailing file:** repeating the last file (the documented trick to make the final
  `duration` count) adds a copy of the previous duration on ffmpeg 8 — 2.5 s became 4.03 s; omitting
  the repeat ignores the last duration (1.47 s). Fix: keep the repeat and hard-trim with
  `-t <timeline seconds>` → exactly 2.500 s. `encodeFramesToMp4` always does this.
- **GIF frame rate is centisecond-quantized:** delays are whole 1/100 s, so 15 fps is written as
  6–7 cs and probes as 16.7 fps. Exact GIF rates are 10, 12.5, 20, 25, 50. Docs GIF stays at 15 (fine
  visually); tests accept 14–17.
- **Live results** (Runner workflow, bounded to run→results): Demo Video → 1920×1080 H.264, 30/1 CFR,
  1.7 s, 73 KB, no audio, dark theme, mid-run frames show the spinner and "Cancel Execution"; Docs GIF →
  recorded at 1600×1000 and downscaled to 1000×626, 15 fps, 26 frames, 1.74 s, 138 KB. Whole pipeline
  ~4.6 s wall clock including launch.
- **Design correction:** the first GIF attempt resized Bruno's *window* to 1000×625. PRD §54 means
  "1000 px wide output, height from the capture aspect" — the engine now records at 1600×1000 (or the
  overrides) and downscales; `capture.outputWidth` carries the GIF width in the manifest.

## Phase 5 — synthetic cursor (measured)

- Implemented as an in-page overlay (`packages/automation/src/cursor/`): fixed `div`, `pointer-events:none`,
  SVG arrow with the hotspot at its tip, installed via `addInitScript` (survives the theme reload) plus
  `evaluate` for the live document. Motion is a requestAnimationFrame ease-in-out in the page while the
  real mouse follows with a stepped `mouse.move`, so hover states match the drawn pointer.
- Because it lives in the renderer it appears identically in screenshots, screencast frames and the
  live preview with no compositing; the macOS pointer is never in frame (App Content Only).
- Demo Video run: 1920×1080, 63 frames, 2.1 s; the arrow is visible and moving between the 0.00 s and
  0.12 s frames of the recording (montage in the scratch home). Move duration 200–350 ms by distance
  (`moveDurationMs`), 120 ms press pulse on click in `smooth` mode; `visible` jumps; `hidden` injects nothing.

## Phase 5b — ScreenCaptureKit helper (built; permission pending)

- `native/macos-capture-helper/Sources/main.swift` builds with `swiftc` + CommandLineTools into
  `build/Bruno Capture Helper.app` (bundle id `com.usebruno.capture.helper`, `LSUIElement`, ad-hoc
  signed with the hardened-runtime flag by default; `--sign "<identity>"` or `BRU_CAPTURE_SIGN_IDENTITY`
  for a Developer ID). `pnpm helper:build -- --install` copies it to
  `~/Library/Application Support/Bruno Capture/bin/`.
- Line-delimited JSON protocol: `preflight` (never prompts), `request` (shows the macOS prompt),
  `windows [--bundle id] [--pid n] [--onscreen]`, `still --window <CGWindowID> --out f.png`
  (`SCScreenshotManager`, cursor hidden, shadow ignored, retina-scaled), `record --window id --out f.mov
  [--fps n]` (`SCStream` → `AVAssetWriter` H.264 `.mov`; emits `started`/`progress`; `stop` on stdin or
  SIGINT/SIGTERM finishes the file and prints frames/duration). SCK errors -3801/-3802 map to
  `permission_denied` with a remediation hint.
- Node side: `CaptureHelper` (`packages/automation/src/native/helper.ts`) with `locate()` over
  `BRU_CAPTURE_HELPER`, the app-support install and the repo build; `NativeRecordingController` in core;
  engine picks native for `full-window` video/GIF and transcodes the `.mov` through `transcodeToMp4`;
  `CaptureController` uses `still` for Full App Window screenshots with `screencapture -l` as fallback;
  System Status and `bru-capture doctor` now report **action-required** (denied) vs **unavailable**
  (helper missing) from a real preflight.
- **Not yet verified live:** `windows`, `still`, `record` all need Screen Recording granted. The
  grant attaches to the *responsible process* (the terminal/app that spawns node → the helper), so it
  must be approved once per host app; `bru-capture helper request` shows the prompt.

## Phase 5b — native paths verified live (after the Screen Recording grant)

- `preflight` → granted; `windows --onscreen` enumerated 15 windows with app/bundle/frame metadata.
- Full App Window **screenshots** through `still`: retina window → 3200×2000 PNG, downscaled to the
  preset's CSS size (1600×1000) because presets are CSS px (`scale: 'css'`).
- Full App Window **video** through `record`: 67 frames / 2.3 s `.mov` at 3840×2160 → `transcodeToMp4`
  → 1920×1080, 30/1 CFR H.264, 68 frames, 100 KB. The frame shows Bruno's window alone — no other
  desktop content (§49) — with the synthetic cursor in frame. Whole run 7.4 s including launch.
- TCC attribution confirmed as predicted in S4: the grant attached to the host app that spawned node,
  not to the helper bundle. Ad-hoc signing means a changed helper binary needs re-approval.

## Phase 6 — AI planning (built; live call pending a key)

- Structured output uses each SDK's Zod helper (`@anthropic-ai/sdk/helpers/zod` `zodOutputFormat`,
  `openai/helpers/zod` `zodTextFormat`); both are built on `zod/v4`, so the shared schemas feed them
  directly. The AI-facing plan is flat with every field required (`parameters` as `{name,value}[]`)
  because strict JSON schema rejects records/defaults; it is mapped to `CapturePlan` after validation.
- Anthropic: `messages.parse` with `output_config: { format, effort: 'low' }`, `max_tokens: 4096`;
  `parsed_output` first, text fallback second; `stop_reason === 'refusal'` surfaces as a provider error.
  OpenAI: `responses.create` with `text.format`, `output_text` validated locally (robust across SDK versions).
- Keychain: `security -i` reads `add-generic-password -U … -w '<key>'` from stdin so the key never
  appears in `ps`; `find-generic-password -w` reads it back; env vars override.
- Verified locally: 13 planner/validator contract tests; server routes degrade to manual suggestions
  with no provider configured (`/api/plan` → `ok:false`, `provider_not_configured`, suggestions), and
  the UI shows the remediation + "Likely workflows". A real provider round-trip needs an API key
  (Settings › AI or `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`).

## Phase 7 — Library & regeneration (measured)

- `engine.regenerate(runId, 'exact')` parses the run's `workflow.yaml` snapshot into a synthetic
  registry entry and reuses the normal pipeline with the saved parameters and capture config; the new
  run's snapshot is identical to the source's (verified byte-for-byte) and `regenerateOf` is recorded.
  `'latest'` runs `assessRegenerateLatest` (unit-tested) and returns `{kind:'review'}` with a prefill
  instead of running when the definition drifted.
- ZIPs are streamed with `yazl` (screenshots deflated, media stored) and always include `manifest.json`;
  selections are validated against the manifest's artifact paths. Reveal/Open use `/usr/bin/open`
  with paths confined to the run directory.

## Phase 8 — workflow coverage (measured)

| Workflow | Feature | Captures | Screenshots | Video / GIF |
|---|---|---|---|---|
| `runner-collection-run` | runner | collection-ready, runner-open, runner-complete | 4.4 s | MP4 1.6–2.3 s, GIF ✓ |
| `request-send-response` | request-execution | request-selected, request-configured, response-displayed | 3.9 s | GIF 1.1 s ✓ |
| `environment-switch` | environments | environment-selector, environment-selected, environment-variables | 4.3 s | GIF 2.0 s ✓ |
| `timeline-request` | timeline | timeline-open, timeline-entry-detail | 4.2 s | (video-capable) |
| `openapi-sync` | openapi-sync | openapi-connect, openapi-imported, openapi-changes-detected, openapi-synced | 6.4 s | MP4 7.3 s / 627 frames ✓ |

= 5 feature areas, 15 screenshot states, 5 screenshot workflows, video/GIF verified on 4 (§90 asks 3+3+3).

- Fixtures without an `environment` parameter left `{{baseUrl}}` unresolved (request.send timed out
  with Bruno showing an error). The engine now pre-selects a collection's **only** environment via the
  ui-state seed; `request.send` failures quote what the response pane shows.
- New actions: `request.selectTab`, `response.selectTab`, `timeline.open`, `timeline.expandFirst`,
  `environment.openSelector`, `modal.close`, `fixture.copyFile` (workspace-confined), `openapi.open`,
  `openapi.connectFile`, `openapi.checkForUpdates`, `openapi.reviewAndSync`; new states
  `timeline.open`, `environment.selectorOpen`, `openapi.{connectVisible,connected,updatesPending,synced}`.
- Selector debt: zero `selectorAction` steps across all built-ins; the OpenAPI actions are the only
  rung-3 (role/name) locators.

## Phase 9 — dynamic composition (measured 2026-09-18, Bruno 4.1.0, capture profile, Anthropic claude-opus-5)

| Prompt | Planner decision | Result |
|---|---|---|
| *(scripted provider)* bearer token + deliberately wrong `ui.click testId=send-request-button` | compose, inline fixture, 10 steps | run **completed** after 1 self-heal (`ui.click` → `request.send`), 2 PNGs; generated YAML rewritten with the healed steps |
| Create a GIF showing how to run a collection from the Bruno Runner (PRD §104) | **reuse** `runner-collection-run` → gif / docs-gif, confidence 0.93, ~3 s | — (plan only) |
| Show how to add a bearer token to a request and send it | **reuse** of the generated bearer workflow above, 0.92 | run completed, 2 PNGs, 4.9 s |
| Show how to add a custom X-Trace-Id header to a request, save it and send it | **compose**, bundled `request-execution/jsonplaceholder`, 14 steps (`request.selectTab headers` → `request.addHeader` → `waitFor text` → `request.save` → `request.send`), 2 region captures + 2 app captures; plan call ≈ 25 s | run **completed first time**, 4 PNGs, 4.3 s |
| Create a GIF of creating a new collection named Weather API and adding a GET request called Current weather to it | **compose**, `fixtureKind: none`, 12 steps (`collection.create` → `request.create` …), docs-gif | `collection.create` worked; `request.create` failed on a **modal-scoping bug of ours** (`.last()` picked the modal footer); 3 heals all used `ui.type … text=…` where `text` collided with the target's text filter → run failed after 63 s. Both bugs fixed (`.first()`, `ui.type.value`); see the re-run row below |

| *(re-run of the saved generated workflow above, no new plan call)* `bru-capture run create-a-collection-and-add-a-request-c03fe9 --output gif` | — | run **completed**: `collection.create` 0.3 s, `request.create` 2.4 s, GIF 6.0 s / 441 frames → 1000×626, 3 artifacts, no heal needed |

Heal round-trips cost 4–8 s each (Anthropic, medium effort). Schema note: the first composition schema (8-variant
step union + nested inline collection) was rejected by Anthropic with "The compiled grammar is too large"; the
flat step object + inline-collection-as-JSON shape (3.5 KB JSON schema) compiles. OpenAI (`gpt-6-astra`) could not
be exercised: the stored key is rate-limited/quota-exceeded (`429`).

## Phase 10 — refine from feedback (measured 2026-09-21, Anthropic claude-opus-5)

| Start | Feedback | Result |
|---|---|---|
| bearer-token GIF run (generated workflow, 10 steps) | "don't obscure the token entered" | one-param change `request.setAuth … reveal: true`, confidence 0.95, everything else copied verbatim; generated file updated in place; regenerated GIF (2.9 s, 1000×626) + 2 PNGs showing the plain token. Refine call ≈ 12 s, whole loop 19 s |

## Phase 11 — more built-in workflows (measured 2026-09-21, Bruno 4.1.0, capture profile)

Measurement spikes first (`spikes/s12-yaml-shapes.mjs`, `s12b-collection-yaml.mjs`, `s12c-overflow-collection.mjs`):
Bruno wrote the `runtime:` / collection `request:` YAML shapes itself, and the Assert / Tests / Script / Vars / Docs
tabs, the pane-tab overflow menu, the collection auth menu, the Generate Code and Clone dialogs and the folder
settings tabs were inventoried (see `docs/bruno-automation-surface.md`, Phase 11 audit). Then every new workflow ran
end to end via `bru-capture run <id> --output …` against `BRU_CAPTURE_HOME` = a scratch home:

| Workflow | Feature | Captures | Screenshots run | GIF / MP4 |
|---|---|---|---|---|
| `request-create` | authoring | collection-before, request-created, new-request-response | 8.7 s | — |
| `request-headers-and-params` | authoring | query-param-added, header-added, filtered-response | 5.7 s | — |
| `request-organize` | authoring | folder-created, request-cloned | 10.1 s (2.4 s toast pauses) | — |
| `request-auth-bearer` | auth | auth-bearer-configured, auth-bearer-response | 5.3 s | GIF 6.3 s run, 1000×626 ✓ |
| `request-auth-basic` | auth | auth-basic-configured, auth-basic-response | 5.1 s | — |
| `request-auth-apikey` | auth | auth-apikey-configured, auth-apikey-response | 5.8 s | — |
| `collection-auth-inherit` | auth | collection-auth-configured, request-auth-inherited, inherited-auth-response | 9.6 s | MP4 14.3 s run, 1920×1080 ✓ |
| `request-tests-and-assertions` | testing | assertions-configured, tests-script, test-results | 5.0 s | GIF 5.2 s run ✓ |
| `request-scripts` | scripting | script-pre-request, script-post-response, script-response, script-test-result | 5.7 s | — |
| `request-variables` | variables | url-with-variables, request-variables, header-with-collection-variable, resolved-response | 5.3 s | — |
| `collection-settings-tour` | collection-settings | settings-overview, -headers, -vars, -auth, -script | 5.7 s | — |
| `request-generate-code` | code-generation | generated-code | 4.5 s | — |
| `response-inspect` | response | response-body, response-headers | 4.4 s | — |
| `theme-switch` | appearance | theme-light, theme-dark | 6.8 s | GIF 7.2 s run ✓ |

= 19 built-in workflows, 14 feature areas, 47 screenshot states. All 14 new ones completed on the first live pass;
httpbin answered the three auth requests with the expected 200s (bearer echo, basic-auth `authenticated: true`,
`/headers` showing `X-Api-Key`).

- One first-pass surprise: `request.setAuth {mode: apikey, reveal: true}` failed because **API-key values are not
  masked** (no eye button). The self-healer (Anthropic) diagnosed it correctly in 5.7 s — "the value is shown in plain
  text, so no eye button exists" — and the run completed; the actions now treat "nothing masked" as a no-op and the
  workflow dropped the parameter.
- Toasts ("Folder created", "Request cloned!", "New request …") were visible in first-pass stills; those workflows
  now pause 2.4 s before capturing.
- The Docs tab is hidden behind the pane's `…` overflow at 1600 px once a request has vars/scripts/asserts;
  `request.selectTab` resolves it through `menu-dropdown-docs` (verified in S12c).
- `theme.set` (localStorage + reload) works mid-recording; the GIF shows light → dark → light.

## Phase 12 — authoring guide + 11 more workflows (measured 2026-09-21, Bruno 4.1.0, capture profile)

Spikes `s13a-surfaces.mjs`, `s13b-runner-mock-import.mjs`, `s13c-followups.mjs` inventoried the remaining surfaces
(see `docs/bruno-automation-surface.md`, Phase 12). Live runs via `bru-capture run <id>` against a scratch home:

| Workflow | Feature | Captures | Screenshots run | GIF / MP4 |
|---|---|---|---|---|
| `request-body-modes` | authoring | body-json, body-xml, body-form-urlencoded, body-multipart, body-json-response | 6.6 s | GIF 6.6 s run ✓ |
| `request-docs` | documentation | docs-rendered, docs-editing | 4.4 s | — |
| `request-rename-and-delete` | authoring | request-renamed, request-deleted | 10.7 s (two 2.4 s toast pauses) | — |
| `response-example-create` | response | response-to-save, response-example-saved | 7.7 s | — |
| `environment-create` | environments | environment-editor, environment-created, environment-variable-added, response-with-new-environment | 11.4 s | MP4 16.8 s run, 1920×1080 ✓ |
| `collection-import-openapi` | import | workspace-empty, collection-imported, imported-collection-open | 6.7 s | GIF 7.2 s run ✓ |
| `find-requests` | navigation | global-search-results, sidebar-filtered | 5.2 s | — |
| `runner-folder-run` | runner | folder-run-results | 4.5 s | — |
| `folder-settings` | collection-settings | folder-headers, folder-auth, folder-vars | 4.5 s | — |
| `preferences-tour` | appearance | preferences-general, -themes, -display, -keybindings | 6.2 s | — |
| `collection-create-first-request` | authoring (no fixture) | workspace-empty, collection-created, first-request, first-response | 11.0 s | — |

= 30 built-in workflows, 17 feature areas, 74 screenshot states.

First pass: 11/11 completed, but four only thanks to the self-healer (each ~5–7 s of Anthropic time), which pointed at
real synchronisation bugs that were then fixed so built-ins never depend on it:

- `request.rename` / `response.createExample` waited for sidebar rows with a `$`-anchored regex that never matched
  Bruno's row text → rows are now matched on an optional method prefix + the name + a non-word boundary.
- `environment-create` used `modal.close` after saving, but the environment editor is a **tab**; the request editor
  never came forward and `request.send` found no open request → the workflow re-opens the request instead.
- `request.create` required the new request's sidebar row, which is hidden while a just-created collection is collapsed
  (`collection-create-first-request` spent 60 s in that wait) → the open editor tab now counts as confirmation.

Second pass: 4/4 clean, 8–11 s each. Import lands the collection in the profile's default location
(`<profile>/collections` in capture mode — in user-profile mode it would be the user's own default location).
