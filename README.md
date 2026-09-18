# Bruno Capture

Local visual-automation app that produces documentation screenshots (and, later, MP4/GIF) of the
Bruno desktop app from deterministic YAML workflows. See
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the build plan and status, and
[docs/spike-results.md](docs/spike-results.md) for what was measured against Bruno 4.1.0.

## Requirements

- macOS, Bruno installed in `/Applications` (or choose a path in Settings)
- Node ≥ 22 with `corepack enable pnpm`
- FFmpeg for video/GIF output (`brew install ffmpeg`) — screenshots work without it

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

Built-in workflows (`workflows/`): `runner-collection-run`, `request-send-response`, `environment-switch`,
`timeline-request`, `openapi-sync` — each produces screenshots; all but Timeline also produce MP4/GIF.
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
