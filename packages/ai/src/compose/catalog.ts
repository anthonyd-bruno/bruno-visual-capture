import type { Capabilities, Step, WorkflowSummary } from '@bruno-capture/shared';

/** Measured facts about Bruno 4.1.0 the planner cannot infer from ids alone (docs/bruno-automation-surface.md). */
export const BRUNO_UI_GUIDE = `BRUNO UI GUIDE (measured on Bruno 4.1.0):
- The workspace is seeded before launch: the fixture collection is already mounted in the sidebar; start with workspace.open then collection.open.
- Sidebar rows: collections = testId sidebar-collection-row; requests/folders = sidebar-collection-item-row (text "GET Get user"). Hovering a collection row reveals its "…" button (collection-actions); its menu items are collection-actions-<item>: new-request, new-folder, run, clone, sync-openapi, rename, share, generate-docs, settings, create-mock-server, remove. Use collection.menuItem or the domain action (runner.open, request.create, folder.create, collection.openSettings).
- Request/folder "…" menu: request.menuItem (items clone, copy, rename, generate-code, create-example, info, delete).
- The "+" above the collections list (collections-header-add-menu) opens create / open / import; collection.create handles the inline name editor.
- Request editor tabs (request.selectTab): params, body, headers, auth, vars, script, assert, tests, docs, settings. Response tabs (response.selectTab): response, headers, timeline, tests. Send = request.send (⌘↩; there is no send-button id). The response status appears as response-status-code.
- URL bar, body editor, header/param cells and auth fields are CodeMirror editors: use the domain actions (request.setUrl, request.setBody, request.addHeader, request.setAuth) or ui.type {testId, value}. In ui.* targets, "text" FILTERS by visible text (buttons, rows, menu items) — it is never the text to type; the text to type is "value".
- Bearer tokens and basic-auth passwords are MASKED as **** by default (API-key values are not). To make them readable in a capture use request.setAuth {…, reveal: "true"} or request.revealSecret (clicks the eye button, testId secret-reveal-toggle) after the value is entered; when nothing is masked these are no-ops.
- Method dropdown items: method-selector-<get|post|put|delete|patch>. Body modes: request.setBody mode json|xml|text|none. Auth modes: request.setAuth mode bearer|basic|apikey|none|inherit.
- Environments: the selector button (environment.selector region) toggles a dropdown with env-list-item rows and a "Configure" (configure-env) button; environment.select / environment.openSelector / environment.openEditor cover it. A collection with one environment has it pre-selected automatically.
- Runner: runner.open → runner.runCollection → runner.waitComplete; states runner.open / runner.running / runner.complete.
- Timeline: after a response, timeline.open (response tab) then timeline.expandFirst.
- OpenAPI Sync: openapi.open → openapi.connectFile (file chooser, no native dialog) → fixture.copyFile to change the spec → openapi.checkForUpdates → openapi.reviewAndSync.
- Script tab: Bruno opens the Post Response phase by default — request.selectScriptPhase {phase: pre-request|post-response} switches (also inside Collection Settings → Script). Assert tab rows and the Tests tab come from the fixture (inline "assertions" / "scripts"); after a send, response.selectTab tests shows "Tests (n), Passed/Failed" and "Assertions (n)" results.
- Tabs that do not fit the pane width collapse into a "…" menu; request.selectTab / response.selectTab look there automatically (Docs, File, Settings, History are the first to be hidden).
- Collection Settings: collection.openSettings {tab} shows a tab; collection.addHeader / collection.addVar / collection.setAuth (menu items differ from the request editor's) edit it; collection.saveSettings (⌘S) applies the changes and toasts "Collection Settings saved successfully"; a request whose auth is "inherit" then uses the collection auth. folder.openSettings {name, tab} opens a folder's headers/script/test/vars/auth/docs.
- Cloning: request.clone {name, newName?} (dialog proposes "<name> copy"). Generate Code: request.generateCode {name, language?, library?} opens the dialog (state codegen.open) with the snippet; capture it, then modal.close.
- Typing into a CodeMirror editor with ui.type auto-closes brackets and quotes, so JSON or JavaScript typed live gains duplicate closers — put bodies, scripts and tests in the fixture instead and only type flat values (URLs, header values, tokens).
- Sidebar item edits: request.rename {name, newName}, request.delete {name} (confirms the dialog), response.createExample {request, name} after a send (saves the response as a named example under the request).
- Environments: environment.create {name} (from the editor; Bruno makes the new one active), environment.addVariable {name, value}, environment.save; then environment.select if needed.
- Import: collection.importFile {file (relative to the run workspace), collection (name to wait for)} imports Bruno/OpenCollection/Postman/Insomnia/OpenAPI/Swagger/WSDL/ZIP files; a fixture may ship only a spec/ folder so the workspace starts empty.
- Finding things: search.global {query} (status-bar Global Search, state search.globalOpen; close with ui.press Escape), search.sidebar {query} filters the sidebar. runner.runFolder {name, recursive} runs one folder (then runner.waitComplete). app.openPreferences {section} opens the Preferences tab (General, Themes, Display, Proxy, Keybindings, …; state preferences.open).
- Body types: request.setBody modes json|xml|text|formurlencoded|multipartform; fixtures write them as body.type json|xml|text|form-urlencoded|multipart-form.
- Modals: modal.close closes the topmost one; states modal.open / modal.closed.
- Saving: request.save (⌘S) clears the draft dot. Unsaved edits are fine for screenshots.
- Toasts ("Collection created!", "Environment changed") fade after ~2 s; add pause 2200 before a still if one may be showing.`;

const compactValue = (v: unknown): string => typeof v === 'string' ? (/[:{}\[\],#&*!|>'"%@`\n]/.test(v) || v === '' ? JSON.stringify(v) : v) : JSON.stringify(v);

/** One step per line, YAML-ish, so examples stay cheap. */
export function compactStep(s: Step | Record<string, unknown>): string {
  const step = s as Record<string, unknown>;
  if ('action' in step) {
    const params = (step['params'] ?? {}) as Record<string, unknown>;
    const p = Object.entries(params).map(([k, v]) => `${k}: ${compactValue(v)}`).join(', ');
    return `- action ${String(step['action'])}${p ? ` {${p}}` : ''}`;
  }
  if ('capture' in step) { const c = step['capture'] as Record<string, unknown>; return `- capture ${String(c['id'])}${c['name'] ? ` (${String(c['name'])})` : ''}${c['region'] ? ` region=${String(c['region'])}` : ''}${c['framing'] ? ` framing=${String(c['framing'])}` : ''}`; }
  if ('waitFor' in step) { const w = step['waitFor'] as Record<string, unknown>; if (w['state']) return `- waitFor state=${String(w['state'])}`; if (w['text']) { const t = w['text'] as Record<string, unknown>; return `- waitFor text ${compactValue(t['contains'] ?? t['equals'])} in ${String(t['region'] ?? t['locator'])}`; } for (const k of ['visible', 'hidden', 'attached', 'detached']) if (w[k]) { const t = w[k] as Record<string, unknown>; return `- waitFor ${k} ${String(t['region'] ?? t['locator'])}`; } return '- waitFor'; }
  if ('pause' in step) return `- pause ${String(step['pause'])}`;
  if ('startRecording' in step) return '- startRecording';
  if ('stopRecording' in step) return '- stopRecording';
  if ('selectorAction' in step) { const a = step['selectorAction'] as Record<string, unknown>; return `- selectorAction ${String(a['operation'])} ${String(a['locator'])}`; }
  return `- ${JSON.stringify(step)}`;
}

function describeWorkflow(w: WorkflowSummary): string[] {
  const lines = [`- id: ${w.id}  name: ${w.name}  feature: ${w.feature}  outputs: ${w.supportedOutputs.join(', ')}`];
  if (w.description) lines.push(`  description: ${w.description}`);
  const fx = w.fixture as { source?: string; path?: string; collection?: { name?: string } } | undefined;
  if (fx) lines.push(`  fixture: ${fx.source}${fx.path ? ` ${fx.path}` : ''}${fx.collection?.name ? ` (${fx.collection.name})` : ''}`);
  const params = Object.entries(w.parameters);
  if (params.length) lines.push(`  parameters: ${params.map(([k, p]) => `${k} (${p.type}${p.type === 'select' ? `: ${p.options.join('|')}` : ''}${'default' in p && p.default !== undefined ? `, default ${JSON.stringify(p.default)}` : ''})`).join('; ')}`);
  if (w.steps?.length) { lines.push('  steps:'); for (const s of w.steps) lines.push('  ' + compactStep(s as Record<string, unknown>)); }
  return lines;
}

const compactSchema = (schema: Record<string, unknown>): string => {
  const props = (schema['properties'] ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set((schema['required'] as string[] | undefined) ?? []);
  const parts = Object.entries(props).map(([k, p]) => {
    let type = typeof p['type'] === 'string' ? (p['type'] as string) : Array.isArray(p['type']) ? (p['type'] as string[]).join('|') : p['enum'] ? 'enum' : p['anyOf'] ? 'any' : 'object';
    if (p['enum']) type = (p['enum'] as unknown[]).map(String).join('|');
    if (type === 'object' && p['properties']) type = `{${Object.keys(p['properties'] as object).join(', ')}}`;
    const def = p['default'] !== undefined ? `=${JSON.stringify(p['default'])}` : '';
    return `${k}${required.has(k) ? '' : '?'}: ${type}${def}${p['description'] ? ` — ${String(p['description'])}` : ''}`;
  });
  return parts.length ? parts.join('; ') : 'none';
};

/** The whole composition vocabulary (PRD §13 spirit: ids, purposes, schemas; never selectors or source). */
export function describeComposeCatalog(c: Capabilities): string {
  const out: string[] = [];
  out.push('ACTIONS (steps of kind "action"; params must match the schema — required unless marked ?):');
  for (const a of c.actions) out.push(`- ${a.id}: ${a.description}\n    params: ${compactSchema(a.params)}`);
  out.push('');
  out.push('STATES (for waitForState):');
  for (const s of c.states) out.push(`- ${s.id}: ${s.description}`);
  out.push('');
  out.push('REGIONS (for capture framing "region", waitForRegion, waitForText):');
  for (const r of c.regions) out.push(`- ${r.id}: ${r.description}`);
  out.push('');
  out.push('FIXTURES (bundled collections you may pick with fixtureKind bundled):');
  for (const f of c.fixtures) {
    out.push(`- path: ${f.path}${f.description ? ` — ${f.description}` : ''}`);
    if (f.collection) {
      out.push(`  collection "${f.collection.name}": ${f.collection.requests.map((r) => `${r.method} ${r.name} (${r.url})`).join('; ') || 'no requests'}`);
      if (f.collection.environments.length) out.push(`  environments: ${f.collection.environments.map((e) => `${e.name} [${e.variables.join(', ')}]`).join('; ')}`);
    }
    if (f.files.length) out.push(`  files: ${f.files.join(', ')}`);
  }
  out.push('');
  out.push('REGISTERED WORKFLOWS (reuse one with mode "reuse" when it already does what is asked; otherwise use their step lists as examples of good structure):');
  for (const w of c.workflows.filter((x) => x.valid)) out.push(...describeWorkflow(w));
  out.push('');
  out.push('PRESETS (choose one whose outputs include your output):');
  for (const p of c.presets) out.push(`- ${p.id}  outputs: ${p.outputs.join(', ')}  ${p.width}${p.height ? `×${p.height}` : ' px wide'}  theme ${p.theme}  cursor ${p.cursor}  framing ${p.framing} — ${p.description}`);
  out.push('');
  out.push(`OUTPUT TYPES: screenshots (stills from capture steps), video (MP4 of the run), gif. "screenshot" is only for reusing a kind: capture workflow.`);
  if (c.testIds.length) {
    out.push('');
    out.push(`DATA-TESTIDS in this Bruno build (${c.testIds.length}; for ui.* targets when no domain action fits; menu items also exist as <menu>-<item> derived ids):`);
    out.push(c.testIds.join(' '));
  }
  return out.join('\n');
}
