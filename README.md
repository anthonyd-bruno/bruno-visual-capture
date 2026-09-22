# Bruno Capture

Local visual-automation app that produces documentation screenshots (and, later, MP4/GIF) of the
Bruno desktop app from deterministic YAML workflows. See
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the build plan and status, and
[docs/spike-results.md](docs/spike-results.md) for what was measured against Bruno 4.1.0.

## Requirements

- macOS, Bruno installed in `/Applications` (or choose a path in Settings)
- Node ≥ 22 with `corepack enable pnpm`
- FFmpeg for video/GIF output (`brew install ffmpeg`) — screenshots work without it but needed for gifs and recordings

## Run it

```bash
pnpm install
pnpm --filter @bruno-capture/web build      # one-time: build the UI the backend serves
node packages/cli/bin/bru-capture.mjs        # starts the backend on a free port and opens the UI
```

Other commands:

```bash
node packages/cli/bin/bru-capture.mjs doctor
node packages/cli/bin/bru-capture.mjs workflows list
node packages/cli/bin/bru-capture.mjs workflows validate
node packages/cli/bin/bru-capture.mjs run runner-collection-run --output screenshots --preset docs-screenshot
node packages/cli/bin/bru-capture.mjs run request-auth-bearer --output gif --play   # opens the GIF when done
```

### Playing a GIF or video

A finished video/GIF run shows the recording first on its run page, in a player: MP4s use the browser's own
controls (the backend serves byte ranges, so seeking works and Safari plays them); GIFs get play/pause, restart,
frame stepping, a scrubber and a speed control (decoded in the browser with WebCodecs; Firefox falls back to the
looping image plus Restart). The Library has a **▶ Play** button on every video/GIF run that opens the run and
starts playback. **Open File** hands the file to QuickTime/Preview. From the CLI, `--play` on `run`, `compose --run`
and `refine --run` opens the recording in the default player as soon as the run finishes (screenshot runs open the
run folder).

## Any prompt → a workflow (Phase 9)

The Capture page (and `bru-capture compose "<prompt>"`) sends the request to the configured AI provider together
with the **composition vocabulary**: the registered semantic actions (with their parameter schemas), semantic
states and regions, the bundled fixtures (collections, requests, environments), the registered workflows, and the
`data-testid` values of the detected Bruno build. The planner answers with either

- **reuse** — a registered workflow that already does what was asked (plus parameter values), or
- **compose** — a brand-new step list over a bundled fixture, an *inline collection* it describes (written as
  Bruno YAML at run time), or an empty workspace.

Composed plans are validated locally (catalog ids, real action parameter schemas, the workflow schema, preset ×
output) before anything can run. **Generate** saves the plan as a `generated` workflow under
`~/Library/Application Support/Bruno Capture/workflows/generated/` (a normal YAML file: listed, watched,
editable, regenerate-able, deletable) and runs it. While it runs, a failed step is **self-healed**: the live UI is
observed (visible elements with their test ids, roles and text — never pixels or source) and the model returns
replacement steps, bounded by *Settings › AI › Max repairs*. Successful heals are written back into the generated
workflow so the next run needs no repair. Settings › AI has switches for composition and self-healing.

A repair that happens **while a video or GIF is recording** would leave the failure and the fix in the footage, so that
take is discarded: the healed step list is re-run from the start in a fresh Bruno session (a *retake*, at most two per
run) and only the clean take is encoded. The run page announces the retake, the manifest records it under `healing.retakes`,
and *Settings › AI › Re-record from the start after a repair during recording* turns it off.

```bash
node packages/cli/bin/bru-capture.mjs compose "Show how to add a custom header to a request and send it" --output screenshots --run
```

### Adjusting a capture without replanning

Every finished run has an **Adjust this capture** box. Say what should change — "don't obscure the token
entered", "dark theme", "make it a GIF", "pause longer before the response screenshot" — and only that
changes: the model returns the same steps with the edit applied, you see the step diff and any output-setting
changes, and **Apply & Regenerate** saves the new version (in place for generated workflows, as a derived
generated workflow for built-ins) and runs it. The run records the feedback history and the run it was
refined from. The same box sits on a composed plan before it is generated.

```bash
node packages/cli/bin/bru-capture.mjs refine run_XXXXXXXXXXXXXXXXXXXXXXXXXX "don't obscure the token entered" --run
```

Built-in workflows (`workflows/`, 30 across 17 feature areas — every one produces screenshots, most also MP4/GIF):

| Feature | Workflows |
|---|---|
| runner | `runner-collection-run`, `runner-folder-run` (one folder, optionally recursive) |
| request-execution, timeline, response | `request-send-response`, `timeline-request`, `response-inspect` (body + headers), `response-example-create` (save a response as a named example) |
| authoring | `collection-create-first-request` (empty workspace → collection → request → send), `request-create`, `request-headers-and-params`, `request-body-modes` (JSON / XML / form / multipart / text), `request-organize` (folder + clone), `request-rename-and-delete` |
| auth | `request-auth-bearer`, `request-auth-basic`, `request-auth-apikey` (httpbin echoes the auth), `collection-auth-inherit` (collection-level token, saved, inherited) |
| environments | `environment-switch`, `environment-create` (new environment + variable + save + send) |
| testing, scripting, variables | `request-tests-and-assertions`, `request-scripts`, `request-variables` |
| collection-settings | `collection-settings-tour`, `folder-settings` |
| import, openapi-sync | `collection-import-openapi` (empty workspace → import a spec), `openapi-sync` |
| documentation, code-generation, navigation, appearance | `request-docs`, `request-generate-code`, `find-requests` (Global Search + sidebar filter), `theme-switch`, `preferences-tour` |

Fixtures live under `fixtures/<feature>/<name>` (README + `collection/`); requests may ship `runtime:` vars, scripts,
tests and assertions in Bruno 4.1's own YAML (see `docs/bruno-automation-surface.md`, Phases 11–12).

## Creating your own workflows

A workflow is one YAML file: metadata, optional parameters and fixture, and a list of steps that Bruno Capture
executes against a fresh Bruno session. Anything under `workflows/` ships as a built-in; your own files live
wherever you like (see *Where to put it*). The fastest way to start is to copy the closest built-in.

### Anatomy

```yaml
version: 1
id: request-auth-bearer                 # slug, unique across all sources
name: Add a Bearer Token                # what the UI and the planner show
description: Switches the Auth tab to Bearer Token, enters the token, sends the request.
feature: auth                           # groups workflows on the Workflows page (any slug)
tags: [auth, bearer, token]
supportedOutputs: [screenshots, video, gif]   # which outputs this workflow can produce
parameters:                             # optional; users/AI fill these in, steps read them as {{name}}
  token: { type: string, label: Bearer token, default: demo-bearer-token-123 }
  revealSecret: { type: boolean, label: Show the token, default: true }
fixture:                                # optional; the collection Bruno starts with (see Fixtures)
  source: bundled
  path: auth/httpbin
defaults:
  preset: docs-gif                      # docs-screenshot | docs-wide | demo-video | docs-gif (theme, size, cursor, fps)
steps:
  - action: workspace.open              # always first: asserts the seeded workspace is up
  - action: collection.open
    params: { name: Auth Demo }         # the fixture collection's name
  - action: request.open
    params: { name: Bearer auth }
  - startRecording: {}                  # video/GIF span (omit for screenshot-only workflows)
  - action: request.setAuth
    params: { mode: bearer, token: "{{token}}", reveal: "{{revealSecret}}" }
    label: Choose Bearer Token and enter the token      # shown in the run log and the step list
  - pause: 600                          # ms; let the UI settle before a still
  - capture: { id: auth-bearer-configured, name: Bearer token configured }   # one PNG per capture
  - action: request.send
  - waitFor: { state: response.received, timeoutMs: 30000 }                 # semantic state, not a sleep
  - pause: 700
  - capture: { id: auth-bearer-response, name: Response confirming the token }
  - stopRecording: {}
```

**Step types**

| Step | What it does |
|---|---|
| `action` | Runs a registered Bruno action with `params` (below). `label` names it; `continueOnError: true` tolerates failure. |
| `capture` | Saves a PNG. `id` (slug, unique in the workflow) and `name`; optional `region` (e.g. `response.body`, `app.sidebar`) or `framing` to crop. |
| `waitFor` | Blocks until a `state` (e.g. `response.received`, `runner.complete`, `modal.closed`) or a `text` / `visible` condition holds. Prefer this over `pause`. |
| `pause` | Milliseconds to wait (max 60 s). Use ~2400 ms after anything that shows a toast ("Request cloned!", "Environment created!") before a still. |
| `startRecording` / `stopRecording` | Bound the MP4/GIF. Everything between them is recorded; captures outside still produce stills. |
| `selectorAction` | Raw CSS escape hatch (`click` / `fill` / `press` / `hover` / `selectOption`). Counted as selector debt — use `ui.*` actions instead when you can. |

**Actions** are the vocabulary. List them with their parameter schemas via `GET /api/capabilities` (`actions`), or
from the CLI:

```bash
curl -s http://127.0.0.1:4011/api/capabilities -H 'Origin: http://127.0.0.1:4011' | jq '.actions[] | {id, description, params}'
```

Domain actions know Bruno's UI (`request.open`, `request.setAuth`, `request.addHeader`, `collection.setAuth`,
`environment.create`, `runner.runFolder`, `collection.importFile`, `request.generateCode`, …). When none fits, the
`ui.*` primitives target elements by `testId` (preferred), `role` + `name`, `text`, `label`, `placeholder` or, as a last
resort, `css`: `ui.click`, `ui.hover`, `ui.type {…, value}`, `ui.press {key}`, `ui.selectOption`, `ui.waitFor`,
`ui.waitForText`, `ui.scrollIntoView`. The 4.1.0 test-id inventory is in `docs/bruno-testids-4.1.0.txt`; the measured
behaviour of every surface (which fields are CodeMirror editors, what the menus are called, which toasts appear) is in
`docs/bruno-automation-surface.md`.

**Parameters** are declared under `parameters` (`string`, `number`, `boolean`, `select` with `options`, `file`,
`directory`; each with `label`, `default`, `required`) and used as `{{name}}` inside action params. A whole-string
`"{{flag}}"` keeps the parameter's type (so booleans reach boolean action params); embedded `"{{a}}/{{b}}"` is string
interpolation. **Only workflow parameters are templated** — a Bruno environment variable such as `{{baseUrl}}` in an
action param is an error, so type literal URLs in workflows and keep `{{env}}` references inside fixture files.

### Fixtures

Bruno starts with the fixture mounted in a fresh workspace (capture profile mode) or added to yours (user mode).
Three kinds:

- **bundled** — `fixture: { source: bundled, path: <feature>/<name> }` points at `fixtures/<feature>/<name>/`, which holds
  a `README.md` (first paragraph = the planner's description) and a `collection/` in Bruno 4.1 YAML:
  `opencollection.yml` (`info.name` is what `collection.open` needs), one `<Request>.yml` per request,
  `environments/<Name>.yml`, folders as `<Folder>/folder.yml`. Requests may carry `runtime:` variables, scripts
  (`before-request` / `after-response` / `tests`), `assertions` and a `docs:` block; collections may carry
  `request: {headers, variables, auth, scripts}`. The whole directory is copied into a temp workspace per run, so
  workflows can freely edit, rename, delete and save. A fixture with only a `spec/` folder and no collection starts an
  **empty** workspace (see `import/petstore-spec`). Copy `authoring/blog-api` as a template. A collection with exactly
  one environment gets it pre-selected automatically.
- **parameter** — `fixture: { source: parameter, parameter: collectionDir, copy: true }` lets the user point a
  `directory` parameter at a collection on disk.
- **inline** — `fixture: { source: inline, collection: {…} }` describes the collection in the workflow itself
  (what the AI composer uses); Bruno Capture writes the YAML for you.

Prefer public demo APIs that always answer (`jsonplaceholder.typicode.com`, `httpbin.org` for auth echoes) so `request.send`
steps succeed in CI and on other machines.

### Where to put it

- **Your own directory**: Workflows page → *Sources* → add a folder (or `POST /api/workflows/directories`). Every
  `*.yaml` in it (recursively) is registered and watched; edits reload live and invalid files stay listed with their errors.
- **A single file**: `bru-capture workflow add path/to/workflow.yaml` (kept in place).
- **Let the AI draft it**: type the prompt on the Capture page, review the composed steps, *Save to Workflows* — it lands
  in `~/Library/Application Support/Bruno Capture/workflows/generated/` as a normal YAML you can edit.
- **Ship it as a built-in**: add it under `workflows/<feature>/` (+ its fixture) and run `pnpm test` — the built-ins test
  checks every step's params against the real action schemas, every state/region name, and the fixture's collection name.

### Validate and run

```bash
node packages/cli/bin/bru-capture.mjs workflows validate        # schema + fixture path check for every registered file
node packages/cli/bin/bru-capture.mjs run <id> --output screenshots   # then video / gif; --param name=value overrides defaults
```

Run against a scratch home while iterating so nothing touches your real Bruno:

```bash
BRU_CAPTURE_HOME=/tmp/bru-capture-dev node packages/cli/bin/bru-capture.mjs run my-workflow --output screenshots
```

(with `{"schemaVersion":1,"capture":{"profileMode":"capture"}}` in `/tmp/bru-capture-dev/settings.json`).

### Tips from the built-ins

- **Toasts** fade after ~2 s; a still taken sooner shows them. `pause: 2400` after create/rename/clone/save/import.
- **CodeMirror auto-closes brackets and quotes**, so JSON or JavaScript typed live gains duplicate closers. Put bodies,
  scripts and tests in the fixture; type only flat values (URLs, header values, tokens).
- **Bearer tokens and passwords are masked**; `request.setAuth { reveal: true }` (or `request.revealSecret`) shows them. API-key values are never masked.
- **Tabs overflow** into a "…" menu when the pane is narrow; `request.selectTab` finds them there.
- **Editors that are tabs, not modals**: Collection Settings, the environment editor and Preferences open as tabs. `modal.close`
  will not dismiss them — `request.open` a request to bring its tab forward.
- **Collection settings apply only after saving** (`collection.saveSettings`); creating an environment makes it active.
- **A step that fails** with self-healing on is repaired from a live UI observation and the fix is written back to
  generated workflows — but a built-in should not need it: fix the step, re-run.

Full App Window framing needs the native helper: `pnpm helper:build -- --install`, then
`bru-capture helper request` to grant Screen Recording.

Set `BRU_CAPTURE_HOME` to use a different Application Support directory (defaults to
`~/Library/Application Support/Bruno Capture`). Settings › Bruno › *Profile mode* = `capture` runs
Bruno in an isolated, seeded profile and never touches your own Bruno; `user` (the PRD default) uses
your real profile and adds the fixture collection to your workspace (with a backup).

## Develop

```bash
pnpm typecheck && pnpm test
PORT=4011 pnpm dev                            # backend with the built UI
pnpm --filter @bruno-capture/web dev          # Vite dev server on :5173, proxies /api to :4011
```

Layout: `packages/shared` (Zod schemas), `core` (settings, registry, run engine), `automation`
(Bruno launch, actions), `media` (FFmpeg), `ai` (planners, Phase 6), `cli`; `apps/server`
(Fastify), `apps/web` (React); `workflows/` and `fixtures/` ship the built-ins; `spikes/` holds the
Phase 0 experiments.
