# Bruno Automation Surface — findings (measured 2026-09-18)

Everything here was measured against the Bruno build installed on this machine. Re-run the
commands after any Bruno upgrade; this file is the input to the semantic-action registry.

## Environment measured

| Thing | Value |
|---|---|
| Bruno | 4.1.0, `/Applications/Bruno.app`, bundle id `com.usebruno.app` |
| Electron runtime | Chromium 138.0.7204.251 (Electron ~37) |
| Code signing | Developer ID (Team `W7LPPWA48L`), hardened runtime (`flags=0x10000`) |
| Entitlements | `cs.allow-jit`, `cs.allow-unsigned-executable-memory` only — no `get-task-allow`, no `disable-library-validation`, no `allow-dyld-environment-variables` |
| macOS | 26.6.2 |
| Node | v24.18.1 |
| pnpm | **missing** — `corepack enable pnpm` |
| FFmpeg | 8.1.1 (system, on PATH) |
| Swift | 6.4, but `xcode-select -p` = CommandLineTools (no full Xcode) |

Reproduce:

```bash
codesign -dv --verbose=2 /Applications/Bruno.app
codesign -d --entitlements :- /Applications/Bruno.app
grep -a -o '"data-testid":"[a-zA-Z0-9_-]*"' /Applications/Bruno.app/Contents/Resources/app.asar \
  | sed 's/"data-testid":"//; s/"$//' | sort -u
```

## Test id inventory

499 distinct static `data-testid` values ship in 4.1.0. Full list: `bruno-testids-4.1.0.txt`.

Two **derived** patterns also exist in the dropdown component, so menu items are addressable
without inventing selectors (verify the exact casing live before relying on it):

- `${dropdownTestId}-${String(item.id).toLowerCase()}`
- `${dropdownTestId}-label-${label.toLowerCase().replace(/ /g,'-')}`

### Coverage per PRD §89 feature area

| Feature | Usable ids | Gap |
|---|---|---|
| **Runner** | `runner`, `runner-run-button`, `runner-run-again-button`, `runner-cancel-button`, `runner-config-panel`, `runner-config-counter`, `runner-config-reset`, `runner-select-all`, `runner-request-item`, `runner-result-item`, `runner-iterations-input`, `runner-iteration-status`, `runner-iteration-status-label`, `runner-delay-input` | No id on the control that *opens* the Runner — go through `collection-actions` / `collection-item-menu` + a derived item id |
| **Request execution** | `sidebar-collection-row`, `sidebar-collection-item-row`, `request-tab`, `request-pane`, `request-url`, `url-input`, `url-bar-container`, `method-selector`, `request-body-editor`, `body-type-select`, `save-request-button`, `response-pane`, `response-status-code`, `response-body-toggle`, `response-preview-container`, `test-result-item` | **No HTTP send-button id** (only `grpc-send-request-button`, `ws-connect-button`). Use the keyboard shortcut (plan D10) |
| **Environments** | `environment-selector-trigger`, `env-list-item`, `env-no-environment-item`, `configure-env`, `env-row`, `env-var-name-input`, `env-search-input`, `env-selected-count`, `env-tab-count`, `save-env`, `presets-default-environment` | Complete enough for MVP |
| **Timeline** | `timeline-container`, `timeline-filter-bar`, `timeline-entry`, `timeline-item`, `timeline-item-header`, `timeline-status`, `timeline-url`, `timeline-detail`, `timeline-chip-count`, `timeline-source-file`, `timeline-source-link` | No id on the control that *opens* the timeline; likely reachable via `view-mode-*` / response-pane tabs — needs live inspection |
| **OpenAPI Sync** | `onboarding-import-openapi`, `api-specs-header-add-menu`, `mock-server-source-spec`, `mock-server-spec-select`, `mock-response-sync-spec-btn`, `mock-response-sync-examples-btn`, `mock-response-generate-from-spec-btn`, `info-version-row`, `info-version-value`, `change-version-*` | **Thinnest coverage of the three headline workflows.** The "spec changed → sync available → synced" surface is not clearly addressable. Treat as the highest-risk workflow. Resolve via the plan's D11 ladder: produce the changed-spec *state* by rewriting the fixture file, drive the remaining clicks with existing ids or role/name locators; confirm in S5 |
| **Mock server** (§46 dependency) | ~45 ids incl. `mock-servers-create-btn`, `mock-server-start-btn`, `mock-server-stop-btn`, `mock-server-status-dot`, `mock-server-status-text`, `mock-server-port-input`, `mock-server-copy-url`, `mock-server-tab-{routes,responses,log}`, `mock-server-stats` | Excellent — prefer Bruno's mock server over any external API in fixtures |
| **App shell** | `sidebar`, `toggle-sidebar-button`, `workspace-menu`, `workspace-switcher-name`, `workspace-actions-trigger`, `collections`, `collections-header-add-menu`, `settings-tab-bar`, `quick-actions-modal`, `global-search-input`, `modal-close-button`, `simple-modal-overlay`, `toggle-devtools-button` | No theme control id — see below |

### Named semantic regions (PRD §47) → first-cut resolution

```
runner.panel          [data-testid="runner-config-panel"] (fall back to [data-testid="runner"])
response.body         [data-testid="response-pane"]
request.editor        [data-testid="request-pane"]
timeline.panel        [data-testid="timeline-container"]
environment.selector  [data-testid="environment-selector-trigger"]
sidebar               [data-testid="sidebar"]
mock.dashboard        [data-testid="mock-server-dashboard"]
```

## Deterministic state without clicking: seedable files

Bruno keeps launch-time state in `~/Library/Application Support/bruno/`. Writing some of these
**before** launch is more deterministic than driving the UI. **Theme is the exception** — see the
measured correction below: it lives in renderer `localStorage`, not in `preferences.json`.

`preferences.json` — `themeMode` / `themeBg` are siblings of `preferences`, not inside it, and
they are **outputs**: the renderer writes them after a theme change; seeding them before launch does
nothing (measured, S5b). Do not use them as a seeding target.

**Theme (measured S5b/S5c):** renderer `localStorage['bruno.theme']` holds a JSON-encoded string
(`"system"` | `"light"` | `"dark"`). `localStorage.setItem('bruno.theme', '"dark"')` followed by a
`page.reload()` flips `html.class` to `dark` in ~530 ms; without the reload nothing changes. This is
how `theme.set` works — in-session, after connect, before the first capture.

`ui-state-snapshot.json` — top-level keys `version`, `activeWorkspacePath`, `extras`, `workspaces`,
`collections`. Useful fields:

- `activeWorkspacePath` — points at `.../bruno/default-workspace`
- `workspaces[].collections[]`, `workspaces[].lastActiveCollectionPathname`, `workspaces[].environment`
- `extras.sidebar.{collapsed,width}` (observed `false` / `220`)
- `extras.devTools.{open,activeTab}`

So `workspace.open`, `sidebar` geometry, and "which collection is loaded" can all be seeded rather
than automated. Fixture collections get registered by writing their path into the active workspace.

Other files present (do not touch): `secrets.json`, `external-secrets.json`, `oauth2.json`,
`ai-keys.json`, `license.json`, `global-environments.json`, `collection-security.json`.

**Consequence:** seeding these mutates the user's real Bruno profile, which PRD §23/§24 accepts.
See the profile-isolation decision in `../IMPLEMENTATION_PLAN.md` §3.

## Live audit (S5, measured)

Derived dropdown ids confirmed: `collection-actions` (appears on collection-row hover) opens a menu whose
items are `collection-actions-<id>` with `role="menuitem"`: `new-request`, `new-folder`, `new-app`,
`new-script`, **`run`**, `clone`, **`sync-openapi`**, `rename`, `share`, `generate-docs`, `collapse`,
`show-in-folder`, `create-mock-server`, `settings`, `terminal`, `move-to-workspace`, `remove`.

Other measured facts: `[data-testid="runner"]` is a `<button aria-label="Runner">`;
`api-specs-header-add-menu` is a `<button title="Add new API Spec">`; the environment dropdown exposes
`env-tab-collection`, `env-tab-global`, `env-search-input`, `env-no-environment-item`, `env-list-item`
(text = environment name), `configure-env`; the empty response pane shows Bruno's own shortcut table
(`response-placeholder-shortcut-value-sendRequest` = "⌘ + ↩"), which confirms **⌘↩ = Send**.

Full details: `spike-results.md`.

## Main-process environment switches (measured in `src/index.js`)

| Env var | Effect | Use |
|---|---|---|
| `ELECTRON_USER_DATA_PATH` | `app.setPath('userData', value)` — **only when `isDev`**; no effect in the installed app | Dev builds only |
| `--user-data-dir=<dir>` (argv) | Electron moves `userData`/`sessionData` to `<dir>`; fresh profile created there (measured S6) | **Isolated capture profile (plan D4)** |
| `DISABLE_SINGLE_INSTANCE=true` | skips `requestSingleInstanceLock()` | Only needed for two instances on one profile |
| `BRUNO_DEV_PORT` | renderer dev-server port (default 3000) | Dev-build launches (PRD §21) |
