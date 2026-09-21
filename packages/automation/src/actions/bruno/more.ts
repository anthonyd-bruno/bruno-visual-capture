import path from 'node:path';
import { z } from 'zod';
import { ActionError, defineAction, expectVisible, firstLine, type ActionContext } from '../types.js';
import { SIDEBAR_ITEM, SIDEBAR_ROW } from './collection.js';
import { requestMenuItem, typeCodeMirror } from './authoring.js';
import { environmentOpenEditor } from './environment.js';

/**
 * Phase 12 actions, measured S13a/S13c on Bruno 4.1.0:
 * - Rename dialog: one plain input (prefilled), `rename-item-button`. Delete dialog: `delete-collection-item-modal`,
 *   `delete-collection-item-modal-submit-btn`.
 * - Create Response Example: `create-example-name-input`, `create-example-description-input`, `modal-submit-btn` → an
 *   example editor tab (`response-example-name-input`, `response-status-input`, `response-example-save-btn`); the request
 *   row gains a `request-item-chevron` and `sidebar-response-example-item` children; YAML gets `examples: [{name, …}]`.
 * - Environment editor: a "Create environment" button (title only) opens an inline input (placeholder "Environment
 *   name..."), Enter creates the file, toasts "Environment created!" **and makes it the active environment**; variable
 *   rows are `env-var-row-<name>` with `env-var-name-input` + CodeMirror value/description cells; `save-env`.
 * - Import: `collections-header-add-menu-import` → `import-collection-modal` (tabs `file-tab` / `url-tab`, a hidden
 *   `input[type=file]`) → `import-collection-location-modal` (Name, Location prefilled with the default collection
 *   location, `grouping-dropdown`, `import-collection-location-modal-submit-btn`) → "Collection imported successfully".
 * - Global search: status-bar button "Global Search" → `global-search-input`, "<n> results found". Sidebar filter:
 *   button "Search requests" → `sidebar-search-input`.
 * - Folder run: item menu `run` → "Collection Runner" dialog (`runner-iterations-input`, buttons Run / Recursive Run).
 * - Preferences: status-bar button "Open Preferences" opens a "Preferences" tab with sections General, Themes, Display,
 *   Proxy, Client Certificates, License, Features, Secrets Manager, Git Providers, Keybindings, AI, Cache, Support, Beta, About.
 */

const modalWith = (ctx: ActionContext, testId: string) => ctx.page.locator('[class*="modal"]').filter({ has: ctx.page.locator(`[data-testid="${testId}"]`) }).first();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * Sidebar rows read "GET Get user" (folders/examples have no method) and may carry trailing badges, so anchor on an
 * optional method prefix and forbid a word character right after the name: "Get user" must not match "Get user posts".
 */
const exactItem = (ctx: ActionContext, name: string) => ctx.page.locator(SIDEBAR_ITEM, { hasText: new RegExp(`^\\s*(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)?\\s*${escapeRe(name)}(?![A-Za-z0-9])`) });

export const requestRename = defineAction({
  id: 'request.rename',
  description: 'Rename a request or folder from its sidebar "…" menu (Rename dialog → new name → Rename). Waits for the new name in the sidebar.',
  retryable: false, rung: 1,
  params: z.object({ name: z.string().min(1).describe('current name as shown in the sidebar'), newName: z.string().min(1) }),
  async execute(ctx, p) {
    await requestMenuItem.execute(ctx, { name: p.name, item: 'rename' });
    const modal = modalWith(ctx, 'rename-item-button');
    const input = modal.locator('input').first();
    await expectVisible('request.rename', 'The Rename dialog', input, ctx.timeoutMs);
    await ctx.cursor.click(input);
    await input.fill('');
    await input.pressSequentially(p.newName, { delay: 14 });
    await ctx.cursor.click(modal.locator('[data-testid="rename-item-button"]'));
    try { await exactItem(ctx, p.newName).first().waitFor({ state: 'visible', timeout: ctx.timeoutMs }); }
    catch (e) { throw new ActionError('request.rename', `"${p.newName}" did not appear in the sidebar`, 'Names must be unique within the same folder.', e); }
    ctx.log(`"${p.name}" renamed to "${p.newName}"`);
  },
});

export const requestDelete = defineAction({
  id: 'request.delete',
  description: 'Delete a request or folder from its sidebar "…" menu and confirm the dialog. Waits for it to leave the sidebar.',
  retryable: false, rung: 1,
  params: z.object({ name: z.string().min(1).describe('name as shown in the sidebar') }),
  async execute(ctx, p) {
    await requestMenuItem.execute(ctx, { name: p.name, item: 'delete' });
    const submit = ctx.page.locator('[data-testid="delete-collection-item-modal-submit-btn"]').first();
    await expectVisible('request.delete', 'The Delete confirmation', submit, ctx.timeoutMs);
    await ctx.cursor.click(submit);
    try { await exactItem(ctx, p.name).first().waitFor({ state: 'hidden', timeout: ctx.timeoutMs }); }
    catch (e) { throw new ActionError('request.delete', `"${p.name}" is still in the sidebar`, undefined, e); }
    ctx.log(`"${p.name}" deleted`);
  },
});

export const responseCreateExample = defineAction({
  id: 'response.createExample',
  description: 'Save the current response of a request as a named Response Example (sidebar "…" → Create Example → name → Create → Save) and expand the request so the example shows under it. Send the request first.',
  retryable: false, rung: 1,
  params: z.object({ request: z.string().min(1).describe('request name as shown in the sidebar'), name: z.string().min(1).describe('example name'), description: z.string().optional() }),
  async execute(ctx, p) {
    await requestMenuItem.execute(ctx, { name: p.request, item: 'create-example' });
    const nameInput = ctx.page.locator('[data-testid="create-example-name-input"]').first();
    await expectVisible('response.createExample', 'The Create Response Example dialog', nameInput, ctx.timeoutMs);
    await ctx.cursor.click(nameInput);
    await nameInput.fill('');
    await nameInput.pressSequentially(p.name, { delay: 14 });
    if (p.description) { const d = ctx.page.locator('[data-testid="create-example-description-input"]').first(); await ctx.cursor.click(d); await d.pressSequentially(p.description, { delay: 10 }); }
    await ctx.cursor.click(ctx.page.locator('[data-testid="modal-submit-btn"]').first());
    const save = ctx.page.locator('[data-testid="response-example-save-btn"]').filter({ visible: true }).first();
    await expectVisible('response.createExample', 'The example editor', save, ctx.timeoutMs, 'Send the request first so there is a response to save.');
    await ctx.cursor.click(save);
    const example = ctx.page.locator('[data-testid="sidebar-response-example-item"]', { hasText: p.name }).first();
    if (!(await example.isVisible().catch(() => false))) {
      const chevron = exactItem(ctx, p.request).first().locator('[data-testid="request-item-chevron"]').first();
      if (await chevron.count()) await ctx.cursor.click(chevron);
    }
    await expectVisible('response.createExample', `Example "${p.name}" under the request`, example, ctx.timeoutMs);
    ctx.log(`example "${p.name}" saved for "${p.request}"`);
  },
});

const envEditorOpen = (ctx: ActionContext) => ctx.page.locator('[data-testid="save-env"]').filter({ visible: true }).first().isVisible().catch(() => false);

export const environmentCreate = defineAction({
  id: 'environment.create',
  description: 'Create a new (empty) collection environment from the environment editor. Bruno makes it the active environment; add variables with environment.addVariable and save with environment.save.',
  retryable: false, rung: 3,
  params: z.object({ name: z.string().min(1) }),
  async execute(ctx, p) {
    if (!(await envEditorOpen(ctx))) await environmentOpenEditor.execute(ctx, {});
    const create = ctx.page.getByTitle('Create environment').first();
    await expectVisible('environment.create', 'The "Create environment" button', create, ctx.timeoutMs);
    await ctx.cursor.click(create);
    const input = ctx.page.getByPlaceholder(/environment name/i).first();
    await expectVisible('environment.create', 'The environment name field', input, ctx.timeoutMs);
    await input.pressSequentially(p.name, { delay: 16 });
    await ctx.page.keyboard.press('Enter');
    try { await ctx.page.getByText(/Environment created/i).first().waitFor({ state: 'visible', timeout: ctx.timeoutMs }); }
    catch (e) { throw new ActionError('environment.create', `No "Environment created" confirmation for "${p.name}"`, 'Environment names must be unique.', e); }
    ctx.log(`environment "${p.name}" created (now active)`);
  },
});

export const environmentAddVariable = defineAction({
  id: 'environment.addVariable',
  description: 'Add a variable (name, value) to the environment open in the environment editor. Does not save — follow with environment.save.',
  retryable: false, rung: 1,
  params: z.object({ name: z.string().min(1), value: z.string() }),
  async execute(ctx, p) {
    const nameInput = ctx.page.locator('[data-testid="env-var-name-input"]').filter({ visible: true }).last();
    await expectVisible('environment.addVariable', 'The empty variable row', nameInput, ctx.timeoutMs, 'Open the environment editor first (environment.openEditor or environment.create).');
    await ctx.cursor.click(nameInput);
    await nameInput.pressSequentially(p.name, { delay: 14 });
    const row = ctx.page.locator(`[data-testid="env-var-row-${p.name}"]`).first();
    await expectVisible('environment.addVariable', `The row for "${p.name}"`, row, ctx.timeoutMs);
    await typeCodeMirror(ctx, row, p.value, false);
    ctx.log(`environment variable ${p.name} = ${p.value}`);
  },
});

export const environmentSave = defineAction({
  id: 'environment.save',
  description: 'Save the environment open in the environment editor (its Save button).',
  retryable: false, rung: 1,
  params: z.object({}),
  async execute(ctx) {
    const save = ctx.page.locator('[data-testid="save-env"]').filter({ visible: true }).first();
    await expectVisible('environment.save', 'The environment Save button', save, ctx.timeoutMs, 'Open the environment editor first.');
    await ctx.cursor.click(save);
    await ctx.page.getByText(/saved/i).first().waitFor({ state: 'visible', timeout: 4000 }).catch(() => undefined);
    ctx.log('environment saved');
  },
});

export const collectionImportFile = defineAction({
  id: 'collection.importFile',
  description: 'Import a collection from a file in the run workspace (Bruno, OpenCollection, Postman, Insomnia, OpenAPI 3 / Swagger 2, WSDL or ZIP) via the sidebar "+" → Import → file → Import. The collection lands in Bruno\'s default collection location.',
  retryable: false, rung: 3,
  params: z.object({
    file: z.string().min(1).refine((s) => !s.split('/').includes('..'), 'no parent segments').describe('path relative to the run workspace, e.g. spec/openapi.yaml'),
    collection: z.string().min(1).optional().describe('name the imported collection will have (OpenAPI: the spec title); waited for in the sidebar'),
  }),
  async execute(ctx, p) {
    if (!ctx.workspacePath) throw new ActionError('collection.importFile', 'This workflow has no fixture workspace to resolve the file path against');
    const file = path.join(ctx.workspacePath, p.file);
    const before = await ctx.page.locator(SIDEBAR_ROW).count();
    const add = ctx.page.locator('[data-testid="collections-header-add-menu"]').first();
    await expectVisible('collection.importFile', 'The collections "+" button', add, ctx.timeoutMs);
    await ctx.cursor.click(add);
    const item = ctx.page.locator('[data-testid="collections-header-add-menu-import"]').first();
    await expectVisible('collection.importFile', 'The Import menu item', item, ctx.timeoutMs);
    await ctx.cursor.click(item);
    const modal = ctx.page.locator('[data-testid="import-collection-modal"]').first();
    await expectVisible('collection.importFile', 'The Import Collection dialog', modal, ctx.timeoutMs);
    try { await modal.locator('input[type="file"]').first().setInputFiles(file); }
    catch (e) { throw new ActionError('collection.importFile', `Could not supply the file: ${firstLine(e)}`, undefined, e); }
    const submit = ctx.page.locator('[data-testid="import-collection-location-modal-submit-btn"]').first();
    await expectVisible('collection.importFile', 'The import location dialog', submit, ctx.timeoutMs, 'Is the file a format Bruno can import?');
    await ctx.page.waitForTimeout(400);
    await ctx.cursor.click(submit);
    try {
      if (p.collection) await ctx.page.locator(SIDEBAR_ROW, { hasText: p.collection }).first().waitFor({ state: 'visible', timeout: ctx.timeoutMs });
      else await ctx.page.waitForFunction(([sel, n]) => document.querySelectorAll(sel!).length > n!, [SIDEBAR_ROW, before] as const, { timeout: ctx.timeoutMs });
    } catch (e) { throw new ActionError('collection.importFile', 'No new collection appeared in the sidebar after Import', undefined, e); }
    ctx.log(`imported ${p.file}${p.collection ? ` as "${p.collection}"` : ''}`);
  },
});

export const searchGlobal = defineAction({
  id: 'search.global',
  description: 'Open Global Search (status bar) and type a query; results list matching collections, requests, folders and docs. Close it with ui.press Escape.',
  retryable: true, rung: 3,
  params: z.object({ query: z.string().min(1) }),
  async execute(ctx, p) {
    const input = ctx.page.locator('[data-testid="global-search-input"]').first();
    if (!(await input.isVisible().catch(() => false))) {
      const btn = ctx.page.getByRole('button', { name: /global search/i }).first();
      await expectVisible('search.global', 'The Global Search button', btn, ctx.timeoutMs);
      await ctx.cursor.click(btn);
    }
    await expectVisible('search.global', 'The global search field', input, ctx.timeoutMs);
    await input.fill('');
    await input.pressSequentially(p.query, { delay: 40 });
    await ctx.page.getByText(/results? found|no results/i).first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined);
    ctx.log(`global search "${p.query}"`);
  },
});

export const searchSidebar = defineAction({
  id: 'search.sidebar',
  description: 'Filter the sidebar (the "Search requests" field) by a query; only matching requests stay visible. An empty query clears it.',
  retryable: true, rung: 3,
  params: z.object({ query: z.string() }),
  async execute(ctx, p) {
    const input = ctx.page.locator('[data-testid="sidebar-search-input"]').first();
    if (!(await input.isVisible().catch(() => false))) {
      const btn = ctx.page.getByRole('button', { name: /search requests/i }).first();
      await expectVisible('search.sidebar', 'The "Search requests" button', btn, ctx.timeoutMs);
      await ctx.cursor.click(btn);
    }
    await expectVisible('search.sidebar', 'The sidebar search field', input, ctx.timeoutMs);
    await input.fill('');
    if (p.query) await input.pressSequentially(p.query, { delay: 40 });
    await ctx.page.waitForTimeout(300);
    ctx.log(`sidebar filter "${p.query}" → ${await ctx.page.locator(SIDEBAR_ITEM).filter({ visible: true }).count()} item(s)`);
  },
});

export const runnerRunFolder = defineAction({
  id: 'runner.runFolder',
  description: 'Run one folder in the Runner (folder "…" → Run → Collection Runner dialog → Run, or Recursive Run to include subfolders). Follow with runner.waitComplete.',
  retryable: false, rung: 3,
  params: z.object({ name: z.string().min(1).describe('folder name as shown in the sidebar'), recursive: z.boolean().default(false) }),
  async execute(ctx, p) {
    await requestMenuItem.execute(ctx, { name: p.name, item: 'run' });
    const modal = modalWith(ctx, 'runner-iterations-input');
    await expectVisible('runner.runFolder', 'The Collection Runner dialog', modal, ctx.timeoutMs);
    const btn = modal.getByRole('button', { name: p.recursive ? 'Recursive Run' : 'Run', exact: true }).first();
    await expectVisible('runner.runFolder', `The "${p.recursive ? 'Recursive Run' : 'Run'}" button`, btn, ctx.timeoutMs);
    await ctx.cursor.click(btn);
    await expectVisible('runner.runFolder', 'The Runner', ctx.page.locator('[data-testid="runner-cancel-button"], [data-testid="runner-run-again-button"]').first(), ctx.timeoutMs);
    ctx.log(`folder "${p.name}" run started${p.recursive ? ' (recursive)' : ''}`);
  },
});

export const PREFERENCE_SECTIONS = ['General', 'Themes', 'Display', 'Proxy', 'Client Certificates', 'License', 'Features', 'Secrets Manager', 'Git Providers', 'Keybindings', 'AI', 'Cache', 'Support', 'Beta', 'About'] as const;

export const appOpenPreferences = defineAction({
  id: 'app.openPreferences',
  description: 'Open Bruno\'s Preferences tab (status-bar gear) and optionally one of its sections: General, Themes, Display, Proxy, Client Certificates, License, Features, Secrets Manager, Git Providers, Keybindings, AI, Cache, Support, Beta, About.',
  retryable: true, rung: 3,
  params: z.object({ section: z.enum(PREFERENCE_SECTIONS).optional() }),
  async execute(ctx, p) {
    const tab = ctx.page.locator('[data-testid="request-tab"]', { hasText: 'Preferences' }).first();
    if (!(await tab.isVisible().catch(() => false))) {
      const btn = ctx.page.getByRole('button', { name: /open preferences/i }).first();
      await expectVisible('app.openPreferences', 'The Preferences button', btn, ctx.timeoutMs);
      await ctx.cursor.click(btn);
      await expectVisible('app.openPreferences', 'The Preferences tab', tab, ctx.timeoutMs);
    } else if (!(await tab.evaluate((el) => el.classList.contains('active')).catch(() => false))) {
      await ctx.cursor.click(tab);
    }
    if (p.section) {
      const item = ctx.page.getByText(p.section, { exact: true }).filter({ visible: true }).first();
      await expectVisible('app.openPreferences', `The "${p.section}" section`, item, ctx.timeoutMs);
      await ctx.cursor.click(item);
      await ctx.page.waitForTimeout(300);
    }
    ctx.log(`preferences${p.section ? ` → ${p.section}` : ''}`);
  },
});

export const MORE_ACTIONS = [requestRename, requestDelete, responseCreateExample, environmentCreate, environmentAddVariable, environmentSave, collectionImportFile, searchGlobal, searchSidebar, runnerRunFolder, appOpenPreferences];
