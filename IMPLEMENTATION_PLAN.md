# Bruno Capture — Implementation Plan

Derived from `Bruno Capture — MVP Product Requirements Document.md`. The PRD is the requirements
contract; this is the build order, the architecture decisions it leaves open, and the corrections
needed where a PRD assumption does not survive contact with the shipped Bruno app.

Measured facts about this machine and Bruno 4.1.0 live in
[docs/bruno-automation-surface.md](docs/bruno-automation-surface.md); Phase 0 outcomes are in
[docs/spike-results.md](docs/spike-results.md). Paragraphs marked **Result (measured)** below were
updated from those spikes on 2026-09-18 and supersede the surrounding text where they differ.

Rough sizing: **10–14 engineer-weeks** for one engineer to hit PRD §100 acceptance, front-loaded
with a 3–5 day spike phase that can invalidate Phase 5.

---

## 1. Shape of the plan

The PRD's §101 sequence is sound and this plan keeps its spine. Three changes:

1. **A Phase 0 of spikes goes first.** Four load-bearing assumptions (renderer video, Electron
   window geometry, CDP attach, native capture permissions) are unproven and each one can force an
   architecture change. Discovering that in Phase 5 wastes the Phase 3–4 investment.
2. **Screenshots ship before AI.** Already the PRD's intent ("At this point Bruno Capture should
   already produce useful screenshots without AI") — made explicit as a releasable internal
   milestone at the end of Phase 3.
3. **No dependency on changes to Bruno itself.** Three of the five MVP feature areas have gaps in
   Bruno's static test ids. Rather than waiting on upstream PRs, the action registry uses a fixed
   locator ladder (D11) and a live locator audit runs as a Phase 0 spike (S5), so every gap has a
   named resolution before Phase 2 starts.

---

## 2. Phase 0 — spikes (3–5 days, do before anything else)

Each spike is a throwaway script under `spikes/`. Each has a written answer and a fallback.

### S1 — Can Playwright drive the shipped, signed Bruno.app?

```bash
corepack enable pnpm && pnpm init && pnpm add -D playwright
```

```js
const { _electron: electron } = require('playwright');
const app = await electron.launch({ executablePath: '/Applications/Bruno.app/Contents/MacOS/Bruno' });
const win = await app.firstWindow();
console.log(await win.title(), await app.evaluate(({ app }) => app.getVersion()));
```

Bruno is Developer-ID signed with hardened runtime and **no** `get-task-allow` or
`allow-dyld-environment-variables` entitlement. Playwright's Electron launcher relies on the
main-process Node inspector plus `--remote-debugging-port`; the inspector is in-process (no
`task_for_pid`), so it should survive hardened runtime — but this is exactly the kind of thing that
silently fails on a notarized build, so prove it.

- **Pass:** Electron mode is the primary path. `app.evaluate()` gives main-process access, which is
  what makes deterministic window geometry possible.
- **Fail:** fall back to launching Bruno manually with `--remote-debugging-port=9222` and
  `chromium.connectOverCDP()`. That loses main-process access (see D2), and if even that is blocked,
  automation requires a local Bruno dev build and "installed Bruno" support in PRD §21/§100 has to
  be renegotiated.

**Result (measured): PASS.** Electron mode works against the signed app — Node inspector attaches,
`app.evaluate()` has full main-process access, 5/5 launches at ~2.4 s. One first-ever launch failed
inside `electron.launch` ("Target page, context or browser has been closed"); wrap launch in a single
retry. CDP-only attach also works. When Bruno is *already running*, the second instance self-quits
(single-instance lock) and `osascript -e 'tell application "Bruno" to quit'` closes the user's
instance cleanly in ~400 ms — that is the relaunch flow (D1).

### S2 — How do we get exact, deterministic window/viewport geometry? (PRD §56)

Test, in order:

1. Electron mode: `app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentBounds({...}))`
2. CDP mode: `Emulation.setDeviceMetricsOverride` — resizes the *renderer*, not the OS window
3. Screenshot dimensions from each: does a 1600×1000 request produce a 1600×1000 PNG?

**Result (measured):** `setContentBounds(1600×1000)` gives a 1600×1000 renderer and a 1600×1000
PNG. `page.setViewportSize()` also works under Electron 37 / Playwright 1.63. Device-metrics
override does **not** enlarge the capture surface — layout reported 1920×1080 but the screenshot
stayed 1600×1000 (clipped) — so it is not a substitute for resizing. **Rule: every framing resizes
the real window via `setContentBounds`; one mechanism.** Presets larger than the display's work area
get clamped by macOS and must be reported by System Status, not silently accepted. Retina
(`scaleFactor` 2) is untested on this machine; presets are CSS px, use `scale: 'css'`.

### S3 — Renderer video: what actually works?

The PRD (§19, §49) says "Playwright exposes a page screencast API that can save WebM video and/or
emit frames." **There is no public `page.startScreencast()` in Playwright.** The real options:

| Option | Gives | Costs |
|---|---|---|
| `electron.launch({ recordVideo: { dir, size } })` | WebM per page, no extra code | Records the **whole session** — cannot start/stop mid-run; variable frame rate |
| CDP `Page.startScreencast` + frame assembly | True start/stop, exact PTS, frames reusable for live preview | You own frame capture, timing, and FFmpeg concat |

**Result (measured): `recordVideo` is dead for the packaged app** — the first window never becomes
usable and no screencast is ever started. **CDP `Page.startScreencast` works** and is the renderer
recording mechanism: 34 change-driven frames in 5 s (median gap 16 ms during motion, zero frames
while idle), assembled via FFmpeg concat with per-frame durations into a 1600×1000 30 fps H.264 MP4.
Start/stop map 1:1 onto `startRecording`/`stopRecording`, so boundaries are exact with no trimming,
and the same frames feed the live preview. See D9.

### S4 — ScreenCaptureKit helper: build and permission reality

Build a ~100-line Swift binary that lists windows, filters to Bruno's, and records 3 seconds.

- `swiftc` against the CommandLineTools SDK is enough — no full Xcode needed.
- Screen Recording is a **per-binary** TCC grant. A bare CLI launched by Node launched by a terminal
  gets the prompt attributed to the *responsible process* (the terminal), and an ad-hoc-signed
  binary loses its grant on every rebuild because the grant keys on the code-signing identity.
- **Therefore:** ship the helper as a minimal `.app` bundle with its own bundle id, installed to a
  stable path (`~/Library/Application Support/Bruno Capture/bin/`), signed with Bruno's Developer ID
  for release. Accept re-approval churn in dev, or use a stable self-signed cert.
- Check permission with `CGPreflightScreenCaptureAccess()` before entering a recording section
  (PRD §60 requires failing *before* the workflow records, not producing a black video).

**Result (measured, partial):** builds with `swiftc` + CommandLineTools (61 KB). Preflight reports
Screen Recording *not granted* for this process chain; the enumerating run prompts and is deferred
until the user is at the keyboard. Signing/TCC approach unchanged.

### S5 — Live locator audit of the three gap areas (½ day)

The test-id inventory in `docs/` is a *static* grep of string literals. It misses computed ids,
ARIA roles, labels and visible text — which is most of what Playwright's resilient locators use.
Launch Bruno (via S1), open each gap area, and record for every control the workflows need:

- the HTTP send control, the Runner entry point, the timeline toggle, and the full OpenAPI
  spec-sync surface (import → open spec → detect changed spec → sync → updated state)
- for each: any runtime `data-testid`, `role` + accessible name, visible text, and whether a
  keyboard shortcut or command-palette entry reaches it

Output: a table appended to `docs/bruno-automation-surface.md` assigning each control a rung on
the D11 ladder. Keep the audit as a script so it re-runs on every Bruno bump. **Pass:** every
control has a rung ≤ 4. **Fail** (a control is only reachable by brittle CSS): that action is
written with the CSS locator, a postcondition, and a `debt` tag — it does not block the phase.

**Result (measured): PASS for everything reachable before a request is sent.** Runner entry =
`collection-actions-run`, OpenAPI entry = `collection-actions-sync-openapi` (rung 2, all 18 menu
items have derived ids); Send = ⌘↩, confirmed by Bruno's own placeholder ids (rung 4); theme lives in
renderer `localStorage['bruno.theme']` (see D3). Timeline is only visible after a response exists —
re-audit in Phase 2 with a fixture request. Table in `docs/spike-results.md`.

---

## 3. Decisions the PRD leaves open (or gets wrong)

Numbered so implementation PRs can cite them.

**D1 — "Reuse the existing Bruno instance" is mostly unreachable.** PRD §22 Case 1 requires the
running Bruno to expose a debugging endpoint. A Bruno launched from the Dock has no
`--remote-debugging-port`, so Case 1 only applies when Bruno Capture launched it earlier in the
session, or the user launched it with the flag themselves. **Decision:** make relaunch-under-control
the normal path, keep Case 1 as an opportunistic optimisation (probe `127.0.0.1:<port>/json/version`
for a port we own), and word the §22 prompt as the expected flow rather than an error.
**Measured (S1d):** launching a second instance while Bruno runs makes the *new* instance quit
(single-instance lock) and Playwright fails within ~1 s; the user's instance survives. Relaunch =
detect (`pgrep -f 'MacOS/Bruno$'`) → prompt → `osascript -e 'tell application "Bruno" to quit'`
(exit 0 in ~400 ms) → wait for exit → launch under Playwright.
**Measured (S6):** the packaged app honours Electron's generic `--user-data-dir=<dir>` switch —
`app.getPath('userData')` moves to that directory and a complete fresh profile is created there
(Bruno's own `ELECTRON_USER_DATA_PATH` is `isDev`-only and does nothing in the installed build).
Electron's single-instance lock is per userData, so in `profileMode: 'capture'` (D4) Bruno Capture
launches its own instance beside the user's with **no relaunch prompt**; the §22 prompt only applies
in `'user'` mode.

**D2 — CDP mode is a degraded mode, and the UI must say so.** With `connectOverCDP` there is no
`ElectronApplication`, so: no `setContentBounds` (→ no Full App Window at exact size), and no
`app.getVersion()` (read `CFBundleShortVersionString` from `Info.plist` instead — which is the more
reliable source anyway and works before launch). Record `bruno.mode` in the manifest and surface
"limited automation" in the run UI.

**D3 — Theme and workspace state are set deterministically, not clicked.** There is no theme test
id. **Measured (S5b/S5c):** `preferences.json`'s `themeMode` is *written* by the renderer, not read
at startup — seeding it does nothing. The source of truth is renderer
`localStorage['bruno.theme']` (JSON string `"system"` | `"light"` | `"dark"`); setting it and calling
`page.reload()` flips `html.class` in ~530 ms, and nothing changes without the reload.
**Decision:** `theme.set` = localStorage write + reload + wait for `[data-testid="sidebar"]`, run
in-session right after connect and before any capture; postcondition
`document.documentElement.className === theme`. **Measured (S7):** workspace seeding works and is done
by the engine *before launch*, not by an action: `default-workspace/workspace.yml` lists the
collection and `ui-state-snapshot.json` carries a `collections[]` entry with `isOpen: true` (that
flag is what mounts it) and `selectedEnvironment`, plus `preferences.onboarding.hasLaunchedBefore`
so first launch creates nothing. `workspace.open` and `environment.select` therefore run as
postcondition checks. Implemented in `packages/automation/src/profile.ts` and `RunEngine.pipeline`.

**D4 — Profile isolation is worth reopening.** PRD §23 defers isolated profiles to post-MVP, but
D3 means every run writes into the user's real Bruno profile — changing their theme, their active
workspace, and their collection list, with no restoration (§24). Electron's `--user-data-dir`
switch gives a clean, seeded, deterministic profile for roughly the cost of one config field.
**Recommendation:** build `profileMode: 'user' | 'capture'` from the start, default to `'user'` per
the PRD, and treat `'capture'` as a flag we can flip once it proves out. If we only ever build
`'user'`, "workflows must explicitly set important visual state" (§23) becomes a permanent tax on
every workflow author. **Resolved:** do that. `profileMode` is a launch-config field from Phase 2;
`'capture'` launches with `--user-data-dir=~/Library/Application Support/Bruno Capture/profile/<id>`
(measured S6; `ELECTRON_USER_DATA_PATH` turned out to be dev-only). The profile is seeded **before
first launch** with `default-workspace/workspace.yml` (`collections: [{name, path}]`) and
`ui-state-snapshot.json` (`activeWorkspacePath`, `workspaces[0].collections`, `extras.sidebar`) — the
same two files `'user'` mode patches (with a backup), so both modes share one seeding code path.
Seeding before first launch also matters because an *empty* fresh profile's onboarding creates a
"Sample API Collection" under `~/Documents/bruno/` on the user's disk (measured).

**D5 — The synthetic cursor is a DOM overlay, not an FFmpeg composite.** Inject a positioned SVG
cursor into Bruno's renderer and animate it with deterministic interpolation, stepping
`page.mouse.move()` along the same path so hover states match what the viewer sees. One
implementation then covers screenshots, renderer video, *and* native window recording, with no
compositing stage and no coordinate translation. The native macOS cursor is simply never in frame,
satisfying §58's "excluded where possible".

**D6 — GIFs should not run at 30 FPS.** §52 normalises video to 30 FPS; §88 already says GIF should
prioritise readability and size. **Decision:** GIF pipeline targets 15 FPS with
`palettegen`/`paletteuse` (`stats_mode=diff`, Bayer dithering), width from the preset, height
derived. Write the effective FPS into the manifest.

**D7 — One Zod schema set, three consumers.** Define workflow, parameter, plan, and manifest schemas
once in `packages/shared`. Derive the AI provider's JSON Schema with `z.toJSONSchema()`, and drive
the parameter form from the same objects. This is what keeps PRD §31's promise ("the same parameter
schema is exposed to the AI planner") true instead of aspirational, and it makes §15's validation
order mostly free.

**D8 — Structured output is a first-class provider feature on both sides.** Anthropic:
`client.messages.parse({ model: 'claude-opus-5', output_config: { format: zodOutputFormat(CapturePlanSchema) } })`
→ read `response.parsed_output`, guard for `null`. OpenAI: the equivalent strict JSON-schema
response format. Neither needs prompt-level JSON coaxing, and assistant prefill is rejected on
current Anthropic models — do not reach for it. §11's "one repair attempt" therefore becomes a rare
path (schema-valid but semantically invalid: unknown workflow id, bad enum), not the normal one.
Default models: `claude-opus-5` for Anthropic; pick the current flagship for OpenAI at build time.

**D9 — Renderer recording is CDP screencast frames, assembled by FFmpeg.** Measured in S3:
`recordVideo` is unusable for the packaged app; `Page.startScreencast` works. The renderer
`RecordingController` opens a CDP session, starts the screencast at `startRecording` (or at
workflow start when no explicit boundary exists), acks every frame, stores each JPEG with its
`metadata.timestamp`, and stops at `stopRecording`. Processing writes a concat list with per-frame
durations (last frame held until the stop timestamp, since idle produces no frames) and encodes
`fps=30` CFR H.264. Boundaries are therefore exact with no trimming, and the frame stream doubles as
the live preview source. The native path starts/stops the SCK stream at the same step boundaries;
both live behind the same `RecordingController` interface.

**D10 — `request.send` uses the keyboard.** No HTTP send-button test id exists. Focus the request
pane and press the send shortcut; assert the postcondition on `response-status-code`. This is the
permanent implementation, not an interim one — a shortcut is more stable than a button that moves.
**Confirmed (S5):** Bruno's empty response pane lists "Send Request — ⌘ + ↩" itself
(`response-placeholder-shortcut-value-sendRequest`).

**D11 — Locator ladder; no upstream Bruno changes.** Every semantic action resolves its targets
with the first rung that works, and the rung is recorded in the action's source so debt is visible:

1. static `data-testid` (the 499 in the inventory)
2. derived dropdown ids (`${menuTestId}-${itemId}`, see the surface doc)
3. Playwright user-facing locators — `getByRole`, `getByLabel`, `getByText`, `getByPlaceholder`
4. keyboard shortcut or command palette (`quick-actions-modal`, `global-search-input`)
5. file seeding (D3) — reach the *state* without touching the control at all
6. CSS/XPath, tagged `debt`, with a postcondition wait and a note of what a rung-1 id would be

Rungs 3–4 are locale- and copy-sensitive. That is acceptable because selectors live *only* in the
registry (§102), every action asserts a postcondition so breakage names itself (§94), and the
macOS CI lane runs the action suite against each Bruno release. PRD §8's "no arbitrary CSS/XPath"
constrains the AI planner, not the registry — the registry is exactly where selectors belong.

Applied to the known gaps (**measured in S5**): HTTP send → rung 4 (D10). Runner entry point →
rung 2, `collection-actions` → `collection-actions-run`. OpenAPI entry → rung 2,
`collection-actions-sync-openapi`; the "changes detected" *state* is produced at rung 5 by rewriting
the spec file in the temp fixture workspace (which the workflow has to do anyway). Timeline toggle →
not visible until a response exists; re-audit in Phase 2 with a fixture request (expect rung 1–3).
Theme → rung 5 via renderer localStorage + reload (D3).

---

## 4. Architecture

### Repo layout

Per PRD §18, with the responsibilities pinned down:

```
bruno-capture/
├── apps/
│   ├── server/          Fastify: HTTP + SSE, route validation, static web build
│   └── web/             React + Vite + TS
├── packages/
│   ├── shared/          Zod schemas + inferred types. Zero runtime deps. D7 lives here
│   ├── core/            settings, workflow registry + watcher, run engine, run store,
│   │                    artifact/manifest writer, system status. No HTTP, no Playwright
│   ├── automation/      Bruno discovery, launch/attach, geometry, semantic action registry,
│   │                    region resolver, capture + recording controllers, cursor overlay
│   ├── media/           FFmpeg adapter (MP4/H.264, GIF, crop/scale/fps), ZIP, probe
│   ├── ai/              provider abstraction, OpenAI, Anthropic, plan validation, Keychain
│   └── cli/             bru-capture — thin wrapper over core, never a second engine (§92)
├── workflows/           built-in YAML
├── fixtures/            runner/ request-execution/ openapi-sync/ environments/ timeline/
├── native/macos-capture-helper/   Swift + SCK, no workflow logic (§61)
├── spikes/              Phase 0 throwaways, kept for reference
└── docs/
```

Dependency rule, enforced by lint: `web → shared`, `server → core|ai|shared`,
`core → automation|media|shared`, `cli → core|ai|shared`. Nothing imports `server`.
`automation` never imports `core` (the run engine calls into automation, not the reverse).

### Run engine

One in-process singleton owning the §65 state machine and the §63 one-run-at-a-time invariant.

```ts
interface RunEngine {
  create(req: CreateRunRequest): Promise<Run>;   // validates, snapshots workflow, claims the slot
  cancel(runId: string, reason: CancelReason): Promise<void>;
  subscribe(runId: string): AsyncIterable<RunEvent>;   // §66 events, replayed from a ring buffer
}
```

Implementation notes that matter:

- **Every phase takes an `AbortSignal`.** Cancellation (§64) is cooperative and must reach
  Playwright calls, the recording controller, spawned FFmpeg, and the native helper. Helper and
  FFmpeg PIDs are tracked in a run-scoped process group so cancel can't orphan them.
- **`workflow.yaml` is snapshotted at `validating`.** A watcher event during a run never touches the
  active snapshot (§29, §97).
- **Event bus is append-only with a replay buffer**, so a browser that connects late or reconnects
  mid-run still renders correct state. SSE alone loses events on reconnect.
- **Terminal state is assigned exactly once** (§65) — a single `finalize()` guarded by a flag, with
  artifact commit and manifest write before the state transition (§45: temp workspace deletion
  happens only *after* the manifest is committed).
- **Preview frames** (§59) are a `setInterval` on `page.screenshot({ type: 'jpeg', quality: 60 })`
  at ~1.5 FPS, written nowhere and pushed as data URLs. Suspend while a screenshot artifact is being
  captured so previews never interleave with real output.

### Semantic actions

```ts
interface CaptureAction<P = unknown> {
  id: string;                          // 'runner.open'
  retryable: boolean;                  // §42 — declared by the action, not the workflow
  needsRelaunch?: boolean;             // D3 — file-seeding actions
  paramsSchema: ZodType<P>;
  execute(ctx: WorkflowContext, params: P): Promise<void>;
}
```

Every action owns its own postcondition wait (§39). The registry is the *only* place selectors
appear — workflows reference actions and named regions, never raw locators, except through the §38
escape hatch (allowlisted operations: `click`, `fill`, `press`, `hover`, `selectOption`; each
occurrence logged as debt and counted in a CI report so the number has to go down).

MVP action set, from the measured surface:

```
app.setGeometry  theme.set*  workspace.open*  sidebar.set*
collection.open  request.open  request.send  request.setUrl
runner.open  runner.runCollection  runner.waitComplete
environment.select  environment.openEditor
timeline.open  timeline.waitActivity
openapi.import  openapi.sync
mockServer.start  mockServer.stop
                                            (* = seeds files, needsRelaunch)
```

### Artifacts & library

Run directory exactly as §67. The library indexes `manifest.json` files at startup into memory
(§98) — no database. Manifests are versioned (`schemaVersion`) from day one so the indexer can skip
or migrate old runs instead of crashing on them. Filenames come from a slug of the capture id plus
the workflow id (§75); collisions get a numeric suffix, never a UUID.

---

## 5. Milestones

Estimates are rough engineer-weeks for one engineer, excluding Phase 0.

### Phase 1 — Core runtime (1.5 w)
pnpm workspace + TS project refs; `shared` schemas; Fastify bound to `127.0.0.1` with origin
allowlist and Zod validation on every route (§20, §85); React shell with the four sections; settings
persistence to `~/Library/Application Support/Bruno Capture/settings.json`; `GET /api/system/status`
with real FFmpeg / artifact-dir / Bruno detection; artifact root creation; `bru-capture` starts the
server, picks a free port, runs checks, opens the browser.

**Exit:** `bru-capture` opens a UI that truthfully reports system status on a machine with nothing
else configured. Missing FFmpeg degrades, never blocks (§62, §95).

### Phase 2 — Bruno automation (2 w) — gated on S1/S2
Bruno discovery (`/Applications`, `~/Applications`, manual override, version from `Info.plist`);
launch under Playwright Electron with `profileMode` (D4); existing-instance probe + relaunch flow (D1); CDP fallback with
degraded-mode reporting (D2); window/viewport geometry (D3/S2); the action registry with ~6 actions
spanning both mechanisms (seeded + clicked); region resolver.

**Exit:** a test can launch Bruno at exactly 1600×1000 in light theme with a fixture collection
loaded, click into the Runner, and read back its open state — with no sleeps.

### Phase 3 — Screenshot vertical slice (2.5 w, incl. 2 days release polish)
Fixture handling (bundled → temp workspace copy, user fixtures in place or copied per §44); YAML
loader + validator; the linear step executor (`action`, `capture`, `waitFor`, `pause`,
`selectorAction`, `continueOnError`); all four screenshot framings (§48); manifest + snapshot
writer; live preview; SSE wiring; the Runner screenshot workflow end to end.

This is a **real internal release to the docs team**, so it carries a bounded 2-day polish budget:
the §94 error UX for the screenshot path, PNG download + Copy, a minimal Library list (newest
first, no filters), and a one-page "install → first screenshot" README. Nothing else from Phases
4–7 is pulled forward.

**Exit (internal release):** Bruno Capture produces useful documentation screenshots with no AI and
no FFmpeg. Everything after this point is additive.

### Phase 4 — Workflow UX (1.5 w)
Workflows screen (cards, detail, validation status, source labels); custom directories; imported
files resolved in place with absolute paths (§28); debounced chokidar watching + manual refresh;
auto-generated parameter forms from the Zod schemas (§31, §32); manual run configuration; per-file
validation errors that never take down the registry (§96).

**Exit:** a workflow authored in an external editor, outside this repo, runs from the UI; breaking
it shows a field-level error and the built-ins keep working.

### Phase 5 — Video & GIF (2.5 w) — gated on S3/S4
`RecordingController` with the two mechanisms behind one interface; recording boundaries (D9);
`packages/media` FFmpeg adapter (MP4/H.264/30fps/silent, GIF per D6, crop/scale/pad); the Swift SCK
helper as a signed `.app` + permission preflight and the §60 remediation UI; region recording with a
crop fixed at segment start (§57); synthetic cursor (D5) in all three modes.

**Exit:** the same workflow yields a 1920×1080 30 FPS silent MP4 and a 1000px GIF, both with a
visible animated cursor; `ffprobe` assertions in CI.

### Phase 6 — AI planning (1.5 w)
Provider abstraction; Keychain storage via the `security` CLI or a native binding, with env-var
override (§12); both providers with native structured output (D8); the §15 validation pipeline;
confidence thresholds (§16); one repair attempt then fallback, with fallback surfaced in the UI and
recorded in the manifest (§11); the capture prompt UX and plan review.

**Exit:** the §104 sentence produces a runnable plan; every provider path is covered by tests using
recorded responses, with zero live API calls in CI (§99).

### Phase 7 — Library & regeneration (1 w)
Library with newest-first + filters; artifact detail; download, copy, on-demand ZIP including
selected-subset (§74); reveal in Finder; delete with confirmation; Regenerate Exact from the
snapshot and Regenerate Latest with the re-validation/review rule (§71).

**Exit:** a run from Phase 3 regenerates both ways after its source workflow has been edited.

### Phase 8 — MVP workflow coverage (2 w)
Author and harden the §90 minimum: 5 feature areas, 15 screenshot states, 3 multi-step screenshot
workflows, 3 video workflows, 3 GIF workflows, with bundled fixtures using Bruno's mock server
rather than live APIs (§46, §91). OpenAPI Sync is the risk here — schedule it first inside the
phase, not last, and start from the S5 table rather than rediscovering the surface.

**Exit:** the full §100 checklist, run on a clean macOS account.

---

### Phase 9 — Dynamic composition (added 2026-09-18, after the MVP)

Anthony's direction after Phase 8: the product must take **any** natural-language prompt and turn it into
app actions, not pick from a fixed set. This supersedes PRD §14's "AI may only choose a registered workflow".
The safety property is kept in a different place: the AI may only *compose from registered vocabulary*
(actions, states, regions, fixtures, measured test ids) and every plan is validated locally before it can run.

- **Vocabulary** — `GET /api/capabilities` now also lists actions (id, description, JSON-schema params, rung),
  states, regions, bundled fixtures (with their requests/environments), and the `data-testid` values scanned
  from the detected Bruno's `app.asar` (fallback: the shipped 4.1.0 list). New measured domain actions
  (S10): `request.create/setUrl/setMethod/setBody/setAuth/addHeader/addQueryParam/save/menuItem`,
  `folder.create`, `collection.create/menuItem/openSettings`; generic `ui.click/hover/type/press/selectOption/
  waitFor/waitForText/scrollIntoView` addressed by testId › role+name/text/label/placeholder › css (debt).
- **Planner** — one structured call: `mode: reuse` (existing §15 validation) or `mode: compose` (flat step list +
  fixture: bundled | inline collection as JSON | none). Anthropic rejected the first schema ("compiled grammar is
  too large"), so the AI-facing shape is one flat step object with nullable fields and the inline collection is a
  JSON string validated against `InlineCollectionSchema`. Validation: catalog ids → action params (real zod
  schemas from the registry, string values coerced by declared type) → `WorkflowDefinitionSchema` → preset/output.
  Same repair/fallback contract as Phase 6.
- **Generated workflows** — composed definitions are saved to `<app support>/workflows/generated/<slug>-<6>.yaml`
  (source kind `generated`, header comment with prompt + provider), registered, watched, editable, deletable,
  and regenerate-able like any file. Inline fixtures are written as Bruno YAML at stage time
  (`writeInlineCollection`, shapes measured in S10).
- **Self-healing** — when a step fails, the executor observes the live UI (`observePage`: visible interactive
  elements with handles, modal state, main text — never pixels or source), asks the model for replacement steps
  (`HealRequest` → validated `Step[]` + `dropFollowing`), splices them into the step queue and continues;
  bounded by `settings.ai.maxHeals`. Heals are recorded (`StepRecord.status: healed`, `inserted`, manifest
  `healing`), the run snapshot is rewritten with the steps that actually ran, and a generated workflow file is
  updated with the healed steps ("learned"). `target_not_found` failures skip the useless retry.
- **Surfaces** — Capture page: composed-plan card (steps, fixture, confidence, YAML editor with server-side
  validation, Generate / Save to Workflows); Run page shows healing in the step list; Workflows page lists and
  deletes generated ones; Settings › AI: compose / self-heal / max repairs. CLI: `bru-capture compose "<prompt>"
  [--output] [--save] [--run]`. API: `POST /api/plan` (kind reuse|compose), `POST /api/workflows/validate`,
  `POST/PUT/DELETE /api/workflows/generated`.
- **Verified live** (Bruno 4.1.0, capture profile, Anthropic claude-opus-5 via the user's Keychain key):
  scripted-provider e2e compose → save → run → heal (wrong test id → `request.send`) → learned write-back;
  real planner calls: "Create a GIF showing how to run a collection from the Bruno Runner" → reuse
  `runner-collection-run`/gif (0.93); "Show how to add a bearer token to a request and send it" → reuse of the
  generated bearer workflow (0.92) and a clean run; plus the two novel-prompt compositions recorded in
  `docs/spike-results.md`. OpenAI could not be exercised (the key is quota-limited).

### Phase 10 — Refine from feedback (added 2026-09-21)

Anthony: "I need a way to adjust the output rather than having to replan the whole capture again", e.g.
"don't obscure the token entered" on the bearer-token GIF.

- **Refine call** — input: the run's exact `workflow.yaml` snapshot (or a registered/unsaved definition),
  its capture settings, the original prompt, earlier adjustments, the run outcome, and the new feedback;
  output: the COMPLETE step list with only the requested change (untouched steps copied verbatim from the
  flat JSON we hand the model) plus nullable output/preset/theme/cursor/width/height and fixture changes.
  Validated with the compose machinery, then diffed against the current steps (LCS over compact lines).
- **Apply** — `generated` workflows are updated in place (provenance note "Refined from run …"); built-in /
  custom / imported ones are never edited: the refinement is saved as a new generated workflow derived from
  them. The new run records `request.feedback[]` (history) and `request.refinedFrom`.
- **Levers the model needs** — measured S11: secrets are masked as `****` with a `secret-reveal-toggle`
  button; `request.setAuth { reveal: true }` / `request.revealSecret` expose it. The UI guide in the prompt
  says so, which is why the token example is a one-parameter change.
- **Surfaces** — Run page "Adjust this capture" (feedback → changes list + step diff → Apply & Regenerate);
  Capture page "Adjust the plan before generating" on the composed card; `bru-capture refine <runId>
  "<feedback>" [--run]`; `POST /api/refine`, `POST /api/refine/apply`.
- Also fixed on the way: a workflow `defaults.preset` that does not support the requested output now falls
  back to the output's default preset instead of silently producing e.g. a 1600×1000 GIF.

## 6. Cross-cutting

**Security (§20).** Bind `127.0.0.1`; reject requests whose `Origin`/`Host` isn't the local UI;
no wildcard CORS. Every path from a request is resolved and checked against an allowlist of roots
(artifact root, configured workflow dirs, imported file paths) before any fs call — reject
symlink escapes after `realpath`, not before. Keys never leave the backend: `GET /api/settings`
returns `{ openai: { keyPresent: true } }`, never the value. Nothing from a workflow is ever passed
to a shell; FFmpeg is invoked with an argv array, never a string.

**Logging (§93).** Per-run NDJSON at `debug/run.log`: state transitions, step index, action id,
timing, retries, waits, recording events, FFmpeg argv + exit code. A single redaction helper wraps
the logger and strips known secret keys; a unit test asserts a planted key never reaches the log.

**Testing (§99).** Unit tests on schemas, parameter resolution, plan validation, provider fallback,
crop math, filename generation, retry classification. A CI test that validates every built-in
workflow. Semantic-action tests as precondition → action → postcondition triples against a real
Bruno on a macOS runner. Media assertions via `ffprobe` (codec, dimensions, fps, no audio stream),
not eyeballing. Recorded provider fixtures for all seven §99 AI cases.

**CI.** Two lanes: a fast lane (lint, typecheck, unit, workflow validation) on every PR, and a
macOS lane (Bruno launch + representative workflows + media probes) on merge and nightly. PRD §4
excludes CI as a *product* feature; this is just our own tests.

---

## 7. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| ~~Playwright can't drive the signed Bruno.app (S1)~~ | — | **Resolved:** works, 5/5; one launch retry covers the observed one-off |
| ~~`recordVideo` unusable under Electron (S3)~~ | — | **Confirmed and absorbed:** CDP screencast is the renderer path (D9) |
| Display smaller than preset (e.g. 1920×1080 on a 13" laptop) | Silent clamping → wrong-size artifacts | System Status checks work area vs preset before `preparing`; fail with a clear message |
| Retina scale factor untested | 2× PNGs where 1× expected | Presets are CSS px; `scale: 'css'`; add a dpr-2 assertion to the macOS CI lane |
| TCC re-prompts on every helper rebuild (S4) | Dev friction, bad first-run UX | Signed `.app` at a stable path; preflight + clear remediation UI |
| OpenAPI Sync not addressable | Loses one of three headline workflows | S5 audit in Phase 0; D11 ladder (state via file seeding, clicks via existing ids or role locators); if S5 still leaves it at rung 6, promote the Environments video workflow to third headline and keep OpenAPI as screenshots-only |
| Bruno UI churn breaks actions | Workflows rot — the exact problem this product exists to solve | Selectors confined to the registry; postcondition-based failures name the action and step (§94); re-run the test-id inventory and the S5 audit script on each Bruno bump; a `debt` count in CI that must not rise |
| Seeding files corrupts a user's Bruno state | Angry first users | Back up the two seeded files into `debug/` before writing; ship D4's capture profile if this bites |
| Recording quality/timing drift | Artifacts look cheap | `ffprobe` assertions in CI; re-encode on trim; GIF at 15 FPS |

---

### Phase 11 — More built-in workflows (added 2026-09-21)

**Goal:** widen the deterministic vocabulary the planner reuses and composes from: 14 new built-in workflows over
9 new feature areas, each backed by a bundled fixture and verified live on Bruno 4.1.0.

- **Measured first (S12 / S12b / S12c):** the `runtime:` YAML Bruno writes for request vars, scripts
  (`before-request` / `after-response` / `tests`) and assertions; collection-level `request:` settings; the Assert /
  Tests / Script / Vars / Docs tab ids; the pane-tab overflow menu (`menu-dropdown-<tab>`); the collection auth menu
  (`menu-dropdown-<mode>`, different from the request editor's); the Generate Code and Clone dialogs; folder
  settings tabs; that API-key values are never masked; that CodeMirror auto-closes brackets (so scripts/bodies belong
  in fixtures, not in typed steps). Recorded in `docs/bruno-automation-surface.md`.
- **Actions:** `request.selectTab` / `response.selectTab` fall back to the overflow menu; new
  `request.selectScriptPhase`, `request.clone`, `request.generateCode`, `collection.addHeader`, `collection.addVar`,
  `collection.setAuth`, `collection.saveSettings`, `folder.openSettings`; states `codegen.open`, `settings.folderOpen`;
  `request.setAuth reveal` / `request.revealSecret` are no-ops when nothing is masked.
- **Fixtures:** `auth/httpbin` (responses prove the auth), `authoring/blog-api`, `testing/jsonplaceholder-tests`,
  `scripting/jsonplaceholder-scripts`, `variables/jsonplaceholder-vars`, `collection-settings/orders-api`. Inline
  collections (Phase 9) gained `variables`, `scripts {beforeRequest, afterResponse, tests}` and `assertions`, written in
  the same `runtime:` shape.
- **Workflows:** authoring `request-create`, `request-headers-and-params`, `request-organize`; auth
  `request-auth-bearer|basic|apikey`, `collection-auth-inherit`; testing `request-tests-and-assertions`; scripting
  `request-scripts`; variables `request-variables`; collection-settings `collection-settings-tour`; code-generation
  `request-generate-code`; response `response-inspect`; appearance `theme-switch`.
- **Guard rails:** `packages/core/test/builtins.test.ts` loads the shipped `workflows/` + `fixtures/`, requires zero
  invalid files, unique ids, and that every action step's params (with parameter defaults templated in) satisfy the
  registered action's schema, every `waitFor.state` / `region` exists, and every `collection.open` names the fixture's
  collection. `inline-fixture.test.ts` pins the `runtime:` YAML shape.
- **Gotcha kept visible:** `{{name}}` in workflow action params is a *parameter* template; environment variables in
  typed URLs would fail the step, so `request-create` types a literal URL.

### Phase 12 — Workflow authoring guide + 11 more built-ins (added 2026-09-21)

**Goal:** cover the remaining everyday Bruno surfaces and document, in the README, how anyone adds a workflow.

- **Measured first (S13a / S13b / S13c):** body-type YAML (`form-urlencoded`, `multipart-form`, xml, text) and tables;
  the environment editor (a tab; "Create environment" inline input that also switches the active environment;
  `env-var-row-<name>`); the Rename / Delete / Create Response Example dialogs and the example editor; the Import flow
  (file input → location dialog → toast); Global Search and the sidebar filter; the folder-run "Collection Runner"
  dialog; Preferences as a tab with named sections; folder `request.headers` YAML; that 4.1.0's collection menu has no
  mock-server item and the runner shows no per-result detail. In `docs/bruno-automation-surface.md`, Phase 12.
- **Actions:** `request.rename`, `request.delete`, `response.createExample`, `environment.create`,
  `environment.addVariable`, `environment.save`, `collection.importFile`, `search.global`, `search.sidebar`,
  `runner.runFolder`, `app.openPreferences`; states `search.globalOpen`, `preferences.open`. `request.create` no longer
  requires the sidebar row (collapsed collections) — the open editor tab is the confirmation.
- **Fixtures:** `authoring/body-modes` (one request per body type), `runner/folder-workspace` (folders with headers),
  `import/petstore-spec` (spec only — the workspace starts empty).
- **Workflows:** authoring `request-body-modes`, `request-rename-and-delete`, `collection-create-first-request` (no
  fixture); response `response-example-create`; environments `environment-create`; import `collection-import-openapi`;
  navigation `find-requests`; runner `runner-folder-run`; collection-settings `folder-settings`; documentation
  `request-docs`; appearance `preferences-tour`.
- **README — "Creating your own workflows":** anatomy with a commented example, the step types, how to list actions
  and their schemas, parameters and the `{{param}}` vs `{{env}}` rule, the three fixture kinds and the Bruno YAML they
  need, where files go (own directory / single file / AI draft / built-in), validate + run against a scratch home, and
  the measured gotchas (toasts, CodeMirror auto-close, masking, tab overflow, tab-not-modal editors, save-to-apply).
- **Suggestions:** `suggestWorkflows` ignores output/filler words (gif, video, create, show, …) and weights id / name /
  feature / tag hits over description hits, so "runner running a collection" still ranks `runner-collection-run` first
  among 30 workflows.

## 7b. Implementation status (2026-09-18)

Built and verified against Bruno 4.1.0 on this machine — see `docs/spike-results.md` for numbers:

- **Phase 12** complete (2026-09-21): 11 more built-in workflows (30 total over 17 feature areas, 74 screenshot
  states) covering body types, rename/delete, response examples, environment creation, import, search, folder runs
  and settings, docs, preferences and the from-empty-workspace onboarding flow; README gained the workflow-authoring
  guide. All 11 ran clean live in the capture profile after four synchronisation fixes surfaced by the first pass.
- **Phase 11** complete (2026-09-21): 14 new built-in workflows over 9 new feature areas (authoring, auth,
  testing, scripting, variables, collection-settings, code-generation, response, appearance) with 6 new bundled
  fixtures — 19 built-ins / 14 feature areas / 47 screenshot states in total; every new workflow ran clean live in the
  capture profile (screenshots 4–10 s, GIF 5–7 s, MP4 14 s). New actions for script phases, cloning, code generation
  and collection/folder settings; pane tabs resolve through the overflow menu; inline collections carry vars,
  scripts, tests and assertions. `builtins.test.ts` validates every shipped step against the real action schemas.
- **Phase 0** complete (S1–S7). **Phase 1** complete: workspace, `shared` schemas (45 unit tests
  across packages), Fastify backend with loopback/Origin guard, settings + workflow-sources stores,
  system status, `bru-capture` / `bru-capture doctor`, React shell (Capture, Run, Workflows, Library,
  Settings) served by the backend.
- **Phase 2** largely complete: discovery, Electron launch with retry, `--user-data-dir` capture
  profile with seeding, geometry, theme, action registry (`app.setGeometry`, `theme.set`,
  `workspace.open`, `collection.open`, `runner.open`, `runner.runCollection`, `runner.waitComplete`,
  `request.open`, `request.send`, `environment.select`, `environment.openEditor`), regions, states.
  Outstanding: user-profile relaunch flow is coded but not live-tested; timeline actions; mock-server actions.
- **Phase 3** vertical slice complete: fixture staging, YAML registry, executor (templating, retry,
  continueOnError, cancellation), all four screenshot framings (Full App Window via macOS
  `screencapture -l <CGWindowID>` until the SCK helper exists), artifacts + manifest + snapshot,
  live preview over SSE, Runner workflow end to end from CLI, HTTP and UI.
- **Phase 4** complete: Workflows screen, import/directories via API + UI, manual Refresh,
  generated parameter forms, debounced filesystem watching (chokidar) that never touches an active run.
- **Phase 5** renderer path complete: `ScreencastRecorder` (CDP) → `RendererRecordingController`
  (whole-workflow or bounded, region/locator crop) → `packages/media` FFmpeg adapter (CFR 30 fps H.264
  MP4, palette GIF at 15 fps, crop/scale/pad, `-t` timeline trim) → engine `processing` state with
  intermediates preserved on failure. Verified live for MP4 and GIF. Synthetic cursor (§58) done as an
  in-page overlay routed through every action click/hover (D5), verified in recorded frames.
  ScreenCaptureKit helper (§49/§61) built, installed, wired and **verified live** after the Screen
  Recording grant: Full App Window screenshots and video of Bruno's window alone, normalised to the
  preset's CSS pixels. **Phase 5 is complete.** Open follow-up: sign the helper with a Developer ID so
  the grant survives rebuilds (ad-hoc today).
- **Phase 6** implemented: `packages/ai` — `AIProvider` abstraction; Anthropic (`messages.parse` +
  `zodOutputFormat`, effort low) and OpenAI (`responses.create` + `zodTextFormat`, validated locally)
  planners over a flat, fully-required AI-facing plan schema mapped to the canonical `CapturePlan`;
  the §15 validation pipeline in order; confidence bands; one repair on the same provider, then
  fallback, never bouncing (§11), with fallback/repair recorded in the attribution; Keychain storage
  through `security -i` (secret never on argv) with env-var override; `/api/plan`,
  `/api/ai/:provider/test`, `PUT`/`DELETE /api/ai/:provider/key`; Capture prompt → plan card with
  Generate / Edit (no second AI call) / Change Workflow and low-confidence suggestions; Settings key
  entry + Test. 13 contract tests on recorded/fake providers (valid, invalid schema, unsupported
  workflow, invalid parameter, malformed, repair, fallback, auth-no-bounce) — no live API calls in CI.
  **Not yet exercised against a live provider** (no API key on this machine).
- **Phase 8** complete: five built-in workflows over five feature areas (Runner, Request Execution,
  Environments, Timeline, OpenAPI Sync) with bundled fixtures, 15 screenshot states, video/GIF
  verified on four of them (see `docs/spike-results.md` for timings). OpenAPI Sync is fully automated
  end to end — connect (file chooser), change detection (spec swap + Check for updates), Accept All →
  Sync Collection → Confirm — with no upstream Bruno changes (D11 rungs 1–3 + 5; zero `selectorAction`
  debt). Outstanding across the MVP: a live AI provider round-trip (needs a key), a live test of the
  user-profile relaunch flow (§22), and the Developer-ID signing of the helper.
- **Phase 7** complete: Library (newest first; feature / workflow / output filters), single downloads,
  Copy, ZIP of all or selected artifacts with the manifest included (§74), Open File and Reveal in
  Finder (§78), delete with confirmation, the §78 detail table, **Regenerate Exact** from the run's
  own `workflow.yaml` snapshot and **Regenerate Latest** with the §71 review rule (removed/retyped/
  invalid parameter, new required parameter, dropped output → Capture form prefilled with the saved
  values and the reasons). Both verified live: exact reproduced the first run byte-for-byte from its
  snapshot; latest completed against the current definition.

- **Phase 10** (refine from feedback) implemented and verified live with the token example — §5 Phase 10,
  `docs/spike-results.md`. 114 unit tests across 19 files.
- **Phase 9** (dynamic composition, post-MVP) implemented and verified live — see §5 Phase 9 for what it
  is and `docs/spike-results.md` for the measured runs. 105 unit tests across 18 files.

**Deviation to note:** in `profileMode: 'user'` the bundled fixture is copied to a stable
`~/Library/Application Support/Bruno Capture/runtime-fixtures/<fixture>` (refreshed each run) rather
than a per-run temp dir, because the user's Bruno keeps that collection mounted after the run (PRD §24)
and a deleted path would leave a dangling entry in their workspace. Capture mode uses per-run temp
workspaces exactly as §45 describes.

## 8. What I'd change about the PRD

1. §19/§49's "Playwright page screencast API" — no such public API; replace with D9/S3.
2. §22 Case 1 — reframe per D1; as written it implies reuse is the common path.
3. §56 — state explicitly that exact geometry for App Content Only comes from renderer metrics while
   Full App Window needs real window bounds (pending S2).
4. §52/§88 — make the GIF frame rate explicit (D6) rather than leaving 30 FPS to be inherited.
5. §23 — reconsider profile isolation now that D3 shows how much state seeding the MVP does.
6. §90's "3 GIF workflows" — GIFs and videos come from the same recordings; count them as 3
   workflows with two outputs each rather than 6 separate authoring jobs.

## 9. Decisions (resolved 2026-09-18)

1. **Profile mode (D4):** build `profileMode: 'user' | 'capture'` in Phase 2, default `'user'`.
2. **No upstream Bruno dependency:** the plan takes no PRs to `usebruno/bruno`. Gaps in Bruno's
   test ids are handled inside the action registry via the D11 ladder, verified live in S5.
3. **End of Phase 3 is a real internal release** to the docs team, with a bounded 2-day polish
   budget (scope in Phase 3). Everything after it is additive.
