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
```

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

Built-in workflows (`workflows/`, 19 across 14 feature areas — every one produces screenshots, all but
`timeline-request` and `collection-settings-tour` also MP4/GIF):

| Feature | Workflows |
|---|---|
| runner, request-execution, environments, timeline, openapi-sync | `runner-collection-run`, `request-send-response`, `environment-switch`, `timeline-request`, `openapi-sync` |
| authoring | `request-create` (New Request dialog → send), `request-headers-and-params`, `request-organize` (folder + clone) |
| auth | `request-auth-bearer`, `request-auth-basic`, `request-auth-apikey` (httpbin echoes the auth), `collection-auth-inherit` (collection-level token, saved, inherited) |
| testing, scripting, variables | `request-tests-and-assertions` (Assert + Tests tabs → results), `request-scripts` (pre/post-response), `request-variables` (env + collection + request vars) |
| collection-settings, code-generation, response, appearance | `collection-settings-tour`, `request-generate-code` (Shell/Python/…), `response-inspect` (body + headers), `theme-switch` |

Fixtures live under `fixtures/<feature>/<name>` (README + `collection/`); requests may ship `runtime:` vars, scripts,
tests and assertions in Bruno 4.1's own YAML (see `docs/bruno-automation-surface.md`, Phase 11).
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
