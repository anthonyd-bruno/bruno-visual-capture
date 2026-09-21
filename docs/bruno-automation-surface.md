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

## Phase 8 audit (measured 2026-09-18)

- **Pane tabs** carry derived ids `responsive-tab-<name>`: request editor `params, body, headers, auth,
  vars, script, assert, tests, docs, file, settings, history`; response pane `response, headers,
  timeline, tests`. Each tab also has a hidden, id-less measurement clone — filter for visible.
  `responsive-tab-timeline` → `timeline-container`, `timeline-item`, `timeline-entry`,
  `timeline-item-header` (click → `timeline-detail`), `timeline-status`, `timeline-url`, `timeline-badge-main`.
- **Environment editor** (`configure-env`): `save-env`, `save-all-env`, `reset-env`, `env-var-row-<name>`,
  `env-var-name-input`, `responsive-tab-variables`, `env-tab-count`, `env-rename-action`, `env-copy-action`,
  `env-delete-action`, `dotenv-files-section`, `create-dotenv-file`. The environment trigger toggles
  the dropdown, so `environment.select` only clicks it when the list is not already open.
- **OpenAPI Sync** (`collection-actions-sync-openapi` → an "OpenAPI" collection tab, no test ids):
  connect screen "Connect to OpenAPI Spec" with `URL`/`File` buttons, `Select File` (an HTML
  `<input type="file">` → Playwright `filechooser`, no native dialog) and `Connect`. Linked dashboard:
  "Linked Collection", `Check for updates`, `View spec`, `Review and Sync Collection`, tabs
  `responsive-tab-overview` / `-collection-changes` / `-spec-updates`, summary tiles "<n> Total in
  Collection / In Sync with Spec / Changed in Collection / Spec Updates Pending" (count precedes label).
  Review is inline on Spec Updates: `Skip All` / `Accept All`, per-endpoint `Keep Current` / `Update` or
  `Skip` / `Add`, then `Sync Collection` → confirm dialog `Confirm & Sync Collection`. After sync the tab
  reads "No updates from the spec — The spec endpoints have not been updated since the last sync." and
  new requests appear in the sidebar. Free tier shows "1 of 5 syncs used this month" — a fresh capture
  profile per run resets this; `user` profile mode would consume the user's quota.
- `dialog.showOpenDialog` patched from the main process was **not** invoked by any of these flows.

## Phase 9 audit — authoring surfaces (S10, measured 2026-09-18)

Everything the new `request.*` / `folder.create` / `collection.*` actions and the inline-fixture writer rely on.

- **New Request modal** (`collection-actions-new-request`): type radios `http-request` / `graphql-request` /
  `grpc-request` / `ws-request` / `from-curl`, `request-name` (plain input), `method-selector` (button; menu
  `method-selector-dropdown` with items `method-selector-<get|post|put|delete|patch|options|head|trace|connect>`
  and `method-selector-add-custom`), `new-request-url` (a **CodeMirror** container — click + type),
  `create-new-request-button` (submit). Creating writes `<Name>.yml` into the collection immediately.
- **Editor URL bar**: `request-url` is a CodeMirror container (⌘A + type replaces); `url-bar-container` carries
  no other ids. `tab-draft-icon` / `request-tab-draft-icon` mark unsaved changes; ⌘S clears them.
- **Body tab**: `request-body-mode-selector` → `request-body-mode-label-<multipartform|formurlencoded|json|xml|text|sparql|file|none>`;
  editor `request-body-editor` (CodeMirror). `body-type-select` from the static id list is not rendered here.
- **Auth tab**: `auth-mode-selector` (`auth-mode-label`, `inherited-auth-mode`) → `auth-mode-dropdown-<awsv4|basic|bearer|digest|ntlm|oauth1|oauth2|wsse|apikey|akamai-edgegrid|inherit>`;
  fields are unlabelled CodeMirror editors in label order (bearer: Token; basic: Username, Password; apikey: Key, Value + `auth-placement-selector`).
- **Headers / Params**: `request-headers-table` / `query-params-table` → `virtuoso-item-list` rows with cells
  `column-name` / `column-value` / `column-description`, each a CodeMirror; there is no "add" button — typing into
  the trailing empty row's name cell appends a new empty row. `bulk-edit-toggle` switches to text mode.
- **Item menu**: `collection-item-menu` (on hover / right-click of `sidebar-collection-item-row`) →
  `collection-item-menu-<clone|copy|rename|generate-code|create-example|show-in-folder|info|delete>`.
- **New Folder modal**: `new-folder-input` + `button[type=submit]`; folder appears as a `sidebar-collection-item-row`.
- **Collections "+"**: `collections-header-add-menu` → `collections-header-add-menu-<create|open|import>`.
  **Create collection is an inline sidebar editor**, not a modal: `input.inline-collection-input` (no test id,
  preselected "Untitled Collection"), buttons titled "Advanced options" / "Create" / "Cancel"; **Enter creates**
  at `preferences.general.defaultLocation` and registers it in `workspace.yml`; a "Collection created!" toast shows.
- **Collection settings**: `collection-actions-settings` → `settings-tab-bar`,
  `collection-settings-tab-<overview|headers|vars|auth|script|tests|presets|proxy|clientCert|externalSecrets|protobuf>`.
- **Accessible names** worth `ui.click role=button name=…`: Home, Search requests, Add new collection,
  More actions, Add new API Spec, Runner, New Transient Request, Open Preferences, Change Theme, Global Search,
  Open Cookies, Open Dev Tools; pane tabs have `role=tab` with their visible label.
- **Empty workspace** (no collections): only `workspace-menu`, `sidebar`, `collections-header-add-menu`,
  `api-specs-header-add-menu`, `collection-header` (the workspace overview) are present; body text reads
  "No collections found. Create or Open Collection." — the starting state for prompts about the first collection.

### YAML Bruno 4.1.0 writes (drives `writeInlineCollection`)

```yaml
http:
  method: GET
  url: "{{baseUrl}}/users/1"
  headers: [{ name: Accept, value: application/json }, { name: X-Trace, value: abc }]
  body: { type: json, data: '{"title": "spike"}' }
  auth: { type: bearer, token: spike-token }          # or
  auth: { type: basic, username: alice, password: s3cret }
  auth: { type: apikey, key: X-API-Key, value: key-123, placement: header }
  auth: inherit                                        # the inherit case is a bare string
settings: { encodeUrl: true, timeout: 0, followRedirects: true, maxRedirects: 5, forwardAuthorizationHeader: false }
```

### Loader gotcha

`page.evaluate(fn)` under tsx/esbuild injects `__name(...)` helpers into function sources that use inner
named functions; the page has no `__name` → `ReferenceError`. `observePage` therefore ships its script as a
plain string. Keep evaluate callbacks to single expressions or strings.

## S11 — secret masking (measured 2026-09-21)

Bearer tokens, basic-auth passwords and API-key values are rendered as `*` CodeMirror widgets (the
underlying text is intact). One `secret-reveal-toggle` `<button>` per masked field sits next to it and
switches the field to plain text; clicking it again masks it. `request.setAuth { reveal: true }` and
`request.revealSecret` use it — this is what "don't obscure the token" maps to.

## Phase 11 audit — scripts, tests, settings, code generation (S12/S12b/S12c, measured 2026-09-21)

What the fourteen Phase 11 built-in workflows and the new `request.*` / `collection.*` / `folder.*` actions rely on.

- **Assert tab**: `assertions-table` → rows with `column-name` (a plain `<input>`, placeholder "Expr"), `column-operator`
  (`assertion-operator-select`, a native `<select>` of `eq neq gt gte lt lte in notIn contains notContains length matches
  notMatches startsWith endsWith between isEmpty isNotEmpty isNull isUndefined isDefined isTruthy isFalsy isJson isNumber
  isString isBoolean isArray`), `column-value` (CodeMirror), `column-description`. Typing in the trailing row appends a row.
- **Tests tab**: `test-script-editor` (CodeMirror). **Script tab**: sub-tab buttons `tab-trigger-pre-request` /
  `tab-trigger-post-response` (**Post Response is the default**), editors `pre-request-script-editor` /
  `post-response-script-editor`. **Vars tab**: `request-vars-req` / `request-vars-res` tables (+ `-sort-toggle`).
  **Docs tab**: `docs-edit-toggle`, `docs-editor` (file-authored `docs:` renders as Markdown).
- **Tab overflow**: at 1600 × 1000 with the default sidebar a request that has vars/scripts/asserts shows
  `Params Body Headers Auth Vars Script Assert Tests` and folds the rest into `menu-dropdown` →
  `menu-dropdown-<docs|file|settings|history>` (`role=menuitem`). Picking one makes `responsive-tab-<tab>` visible and
  active; `request.selectTab` / `response.selectTab` fall back to this menu.
- **Response Tests tab**: `test-result-item`, `test-result-icon-pass` / `-fail`; heading text
  "Tests (n), Passed: x, Failed: y" then "Assertions (n), Passed: x, Failed: y" and per-row `res.status: eq 200`.
  A syntax error in the tests script shows a `script-error-card` (`script-error-message`, `script-error-stack-toggle`).
- **CodeMirror auto-closes brackets and quotes**: typing `{` or `(` inserts the closer, so JavaScript/JSON typed live gains
  duplicate closers (the S12 typed test ended with an extra `})` and failed with "expecting catch or finally"). Bodies,
  scripts and tests belong in the fixture files; live typing is for flat values.
- **Generate Code dialog** (`collection-item-menu-generate-code`): `modal-close-button`, `interpolate-vars-toggle`, an
  id-less native `<select>` (`.native-select`) of languages `Shell C Clojure Crystal C# Go HTTP Java JavaScript Kotlin
  Node.js Objective-C OCaml PHP Powershell Python R Ruby Rust Swift`, per-language variant buttons (`.lib-btn`, Shell:
  curl / httpie / wget) and a copy button. `request.generateCode` selects by option label and clicks variants by
  accessible name.
- **Clone dialog** (`collection-item-menu-clone`): one plain input (placeholder "Enter Item name", prefilled "<name> copy"),
  buttons Options / Cancel / `clone-item-button`; a "Request cloned!" toast follows (~2 s).
- **Collection Settings**: Overview has `docs-edit-toggle`, `info-version-row/-value/-change`; Headers → `collection-headers`
  table (`column-name` / `column-value` / `column-description`); Vars → `collection-vars-req`; Auth → `auth-mode-selector`
  whose menu is `menu-dropdown-dropdown` with items **`menu-dropdown-<awsv4|basic|wsse|bearer|digest|ntlm|oauth1|oauth2|
  apikey|akamai-edgegrid|none>`** (not the request editor's `auth-mode-dropdown-*`), unlabelled CodeMirror fields and a
  `secret-reveal-toggle`, plus a Save button; Script → the same `tab-trigger-*` buttons with
  `collection-pre-request-script-editor` / `collection-post-response-script-editor`. ⌘S on a settings tab saves and
  toasts "Collection Settings saved successfully". Unsaved settings do **not** apply to sends — `collection.saveSettings`
  first (the collection-auth-inherit workflow depends on it).
- **Folder settings** (`collection-item-menu-settings` on a folder row): `folder-settings-tab-<headers|script|test|vars|auth|docs>`
  (note `test`, singular), `editable-table`, `bulk-edit-toggle`; `folder.yml` is `info: {name, type: folder, seq}` +
  `request: {auth: inherit}`.
- **API-key values are not masked** (no eye button) — only bearer tokens and basic passwords are; `request.setAuth reveal`
  and `request.revealSecret` are no-ops when nothing on the tab is masked.

### YAML Bruno 4.1.0 writes for request runtime and collection settings (drives the fixtures and `writeInlineCollection`)

```yaml
# <Request>.yml
runtime:
  variables:
    - name: userId
      value: "2"
  scripts:
    - type: before-request        # Script → Pre Request
      code: bru.setVar("requestedAt", new Date().toISOString());
    - type: after-response        # Script → Post Response
      code: bru.setVar("userName", res.body.name);
    - type: tests                 # Tests tab
      code: |-
        test("status is 200", function () { expect(res.getStatus()).to.equal(200); });
  assertions:
    - expression: res.status
      operator: eq
      value: "200"
docs: |-                          # Docs tab (top level, Markdown)
  # Get user

# opencollection.yml
request:
  headers: [{ name: X-Client, value: bruno-docs }]
  auth: { type: bearer, token: collection-token-abc }
  variables: [{ name: apiVersion, value: v1 }]
  scripts: [{ type: before-request, code: 'bru.setVar("collectionStartedAt", Date.now());' }]
```

`{{env}}` references inside **fixture files** are Bruno interpolation; inside **workflow action params** `{{name}}` is a
Bruno Capture *parameter* template and an unknown name fails the step — so typed URLs in workflows are literal.
