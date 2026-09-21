import type { Locator } from 'playwright';
import { z } from 'zod';
import { ActionError, defineAction, expectVisible, type ActionContext } from '../types.js';
import { collectionRow, SIDEBAR_ITEM } from './collection.js';
import { selectPaneTab } from './tabs.js';

/**
 * Phase 9 authoring actions, measured S10 on Bruno 4.1.0: the New Request modal
 * (`request-name`, `method-selector` → `method-selector-<verb>`, `new-request-url` CodeMirror,
 * `create-new-request-button`), the editor URL bar (`request-url` CodeMirror), body mode
 * (`request-body-mode-selector` → `request-body-mode-label-<mode>`, `request-body-editor`), auth
 * (`auth-mode-selector` → `auth-mode-dropdown-<mode>`, CodeMirror fields in label order), key/value
 * tables (`request-headers-table` / `query-params-table`, cells `column-name` / `column-value`, typing
 * in the trailing empty row appends a row), ⌘S save, `new-folder-input`, and derived menu ids.
 */

/** The outermost modal element that contains the marker (`.first()`: inner `*-modal-footer` wrappers also match `[class*="modal"]`). */
const modalWith = (ctx: ActionContext, testId: string) => ctx.page.locator('[class*="modal"]').filter({ has: ctx.page.locator(`[data-testid="${testId}"]`) }).first();

async function openCollectionMenu(ctx: ActionContext, actionId: string, collection?: string): Promise<void> {
  const row = collectionRow(ctx, collection);
  await expectVisible(actionId, collection ? `Collection "${collection}"` : 'A collection row', row, ctx.timeoutMs, 'Seed a fixture collection or create one first.');
  await ctx.cursor.hover(row);
  const actions = row.locator('[data-testid="collection-actions"]').first().or(ctx.page.locator('[data-testid="collection-actions"]').first());
  await expectVisible(actionId, 'The collection actions button', actions, ctx.timeoutMs);
  await ctx.cursor.click(actions);
  await expectVisible(actionId, 'The collection menu', ctx.page.locator('[data-testid="collection-actions-dropdown"]'), ctx.timeoutMs);
}

/** Type into a CodeMirror editor (Bruno's URL, body, header and auth fields ignore fill()). */
export async function typeCodeMirror(ctx: ActionContext, container: Locator, text: string, replace: boolean): Promise<void> {
  const cm = container.locator('.CodeMirror').first();
  const target = (await cm.count()) ? cm : container;
  await ctx.cursor.click(target);
  if (replace) { await ctx.page.keyboard.press('Meta+a'); await ctx.page.keyboard.press('Backspace'); }
  await ctx.page.keyboard.type(text, { delay: 14 });
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

export const requestCreate = defineAction({
  id: 'request.create',
  description: 'Create a new HTTP request in a collection via the New Request modal (name, optional method and URL) and open it in the editor.',
  retryable: false, rung: 1,
  params: z.object({ name: z.string().min(1), method: z.enum(METHODS).optional(), url: z.string().optional(), collection: z.string().min(1).optional().describe('collection name; defaults to the first collection') }),
  async execute(ctx, p) {
    await openCollectionMenu(ctx, 'request.create', p.collection);
    await ctx.cursor.click(ctx.page.locator('[data-testid="collection-actions-new-request"]'));
    const modal = modalWith(ctx, 'create-new-request-button');
    await expectVisible('request.create', 'The New Request modal', modal.locator('[data-testid="request-name"]'), ctx.timeoutMs);
    const nameInput = modal.locator('[data-testid="request-name"]');
    await ctx.cursor.click(nameInput);
    await nameInput.pressSequentially(p.name, { delay: 14 });
    if (p.method && p.method !== 'GET') {
      await ctx.cursor.click(modal.locator('[data-testid="method-selector"]'));
      const item = ctx.page.locator(`[data-testid="method-selector-${p.method.toLowerCase()}"]`);
      await expectVisible('request.create', `Method "${p.method}"`, item, ctx.timeoutMs);
      await ctx.cursor.click(item);
    }
    if (p.url) await typeCodeMirror(ctx, modal.locator('[data-testid="new-request-url"]'), p.url, false);
    await ctx.cursor.click(modal.locator('[data-testid="create-new-request-button"]'));
    try {
      await modal.waitFor({ state: 'hidden', timeout: ctx.timeoutMs });
      // The new request opens in the editor; its sidebar row may be hidden when the collection is collapsed
      // (e.g. right after collection.create), so the row is confirmation, not a requirement.
      await ctx.page.locator('[data-testid="request-pane"]').waitFor({ state: 'visible', timeout: ctx.timeoutMs });
      await ctx.page.locator(`[data-testid="request-tab"]:has-text("${p.name.replace(/"/g, '\\"')}"), ${SIDEBAR_ITEM}:has-text("${p.name.replace(/"/g, '\\"')}")`).first().waitFor({ state: 'visible', timeout: ctx.timeoutMs });
    } catch (e) {
      const err = (await modal.innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 160);
      throw new ActionError('request.create', `The request "${p.name}" was not created${err ? ` — the modal shows: "${err}"` : ''}`, 'Request names must be unique in the collection and valid as file names.', e);
    }
    ctx.log(`request "${p.name}" created${p.method ? ` (${p.method})` : ''}`);
  },
});

export const requestSetUrl = defineAction({
  id: 'request.setUrl',
  description: 'Replace the URL of the open request by typing into the URL bar (may use {{variables}}). Does not save.',
  retryable: false, rung: 1,
  params: z.object({ url: z.string().min(1) }),
  async execute(ctx, p) {
    const bar = ctx.page.locator('[data-testid="request-url"]').first();
    await expectVisible('request.setUrl', 'The URL bar', bar, ctx.timeoutMs, 'Open a request first (request.open or request.create).');
    await typeCodeMirror(ctx, bar, p.url, true);
    try { await ctx.page.waitForFunction(([sel, url]) => (document.querySelector(sel!)?.textContent ?? '').replace(/​/g, '').includes(url!), ['[data-testid="request-url"]', p.url] as const, { timeout: 5000 }); }
    catch (e) { throw new ActionError('request.setUrl', 'The URL bar did not show the new URL', undefined, e); }
    ctx.log(`url set to ${p.url}`);
  },
});

export const requestSetMethod = defineAction({
  id: 'request.setMethod',
  description: 'Change the HTTP method of the open request via the method dropdown in the URL bar.',
  retryable: true, rung: 1,
  params: z.object({ method: z.enum(METHODS) }),
  async execute(ctx, p) {
    const selector = ctx.page.locator('[data-testid="url-bar-container"] [data-testid="method-selector"], [data-testid="request-pane"] [data-testid="method-selector"]').filter({ visible: true }).first().or(ctx.page.locator('[data-testid="method-selector"]').filter({ visible: true }).first());
    await expectVisible('request.setMethod', 'The method selector', selector, ctx.timeoutMs, 'Open a request first.');
    if ((await selector.innerText()).trim().toUpperCase() === p.method) { ctx.log(`method already ${p.method}`); return; }
    await ctx.cursor.click(selector);
    const item = ctx.page.locator(`[data-testid="method-selector-${p.method.toLowerCase()}"]`);
    await expectVisible('request.setMethod', `Method "${p.method}"`, item, ctx.timeoutMs);
    await ctx.cursor.click(item);
    try { await ctx.page.waitForFunction(([m]) => [...document.querySelectorAll('[data-testid="method-selector"]')].some((e) => (e.textContent ?? '').trim().toUpperCase() === m), [p.method] as const, { timeout: 5000 }); }
    catch (e) { throw new ActionError('request.setMethod', `The method did not change to ${p.method}`, undefined, e); }
    ctx.log(`method ${p.method}`);
  },
});

async function selectRequestTab(ctx: ActionContext, actionId: string, tab: string): Promise<void> {
  await selectPaneTab(actionId, ctx, 'request-pane', tab);
}

export const requestSetBody = defineAction({
  id: 'request.setBody',
  description: 'Set the body mode of the open request (json, xml, text, none, formurlencoded, multipartform) and optionally type content. Does not save.',
  retryable: false, rung: 1,
  params: z.object({ mode: z.enum(['json', 'xml', 'text', 'none', 'formurlencoded', 'multipartform', 'sparql']), content: z.string().optional(), replace: z.boolean().default(true) }),
  async execute(ctx, p) {
    await selectRequestTab(ctx, 'request.setBody', 'body');
    const modeSel = ctx.page.locator('[data-testid="request-body-mode-selector"]').first();
    await expectVisible('request.setBody', 'The body mode selector', modeSel, ctx.timeoutMs);
    await ctx.cursor.click(modeSel);
    const item = ctx.page.locator(`[data-testid="request-body-mode-label-${p.mode}"]`);
    await expectVisible('request.setBody', `Body mode "${p.mode}"`, item, ctx.timeoutMs);
    await ctx.cursor.click(item);
    if (p.content !== undefined && p.mode !== 'none') {
      const editor = ctx.page.locator('[data-testid="request-body-editor"]').first();
      await expectVisible('request.setBody', 'The body editor', editor, ctx.timeoutMs);
      await typeCodeMirror(ctx, editor, p.content, p.replace);
    }
    ctx.log(`body ${p.mode}${p.content !== undefined ? ` (${p.content.length} chars)` : ''}`);
  },
});

/** Bruno masks secret auth fields (bearer token, password, API-key value) as ****; the eye button next to the field shows the plain value (measured S11). */
async function revealSecrets(ctx: ActionContext, actionId: string): Promise<void> {
  const masked = () => ctx.page.locator('[data-testid="request-pane"] .CodeMirror').evaluateAll((els) => els.some((e) => /^\s*\*{3,}/.test((e as HTMLElement).innerText.replace(/\u200b/g, '').trim())));
  // Nothing masked (API-key values are shown in plain text in 4.1.0, measured Phase 11) \u2192 nothing to do.
  if (!(await masked())) { ctx.log('no masked secret on this tab \u2014 nothing to reveal'); return; }
  const toggle = ctx.page.locator('[data-testid="request-pane"] [data-testid="secret-reveal-toggle"]').filter({ visible: true }).first();
  await expectVisible(actionId, 'The reveal-secret (eye) button', toggle, ctx.timeoutMs, 'Only masked auth fields (bearer token, basic password) have one.');
  await ctx.cursor.click(toggle);
  try { await ctx.page.waitForFunction(() => ![...document.querySelectorAll('[data-testid="request-pane"] .CodeMirror')].some((e) => /^\s*\*{3,}/.test((e as HTMLElement).innerText.replace(/\u200b/g, '').trim())), undefined, { timeout: 5000 }); }
  catch (e) { throw new ActionError(actionId, 'The secret stayed masked after clicking the reveal button', undefined, e); }
  ctx.log('secrets revealed');
}

export const requestRevealSecret = defineAction({
  id: 'request.revealSecret',
  description: 'Show the masked auth secret (bearer token, password, API-key value) in plain text by clicking the eye button next to it — for screenshots/GIFs where the value must be readable.',
  retryable: true, rung: 1,
  params: z.object({}),
  execute: (ctx) => revealSecrets(ctx, 'request.revealSecret'),
});

export const requestSetAuth = defineAction({
  id: 'request.setAuth',
  description: 'Set the auth mode of the open request (bearer, basic, apikey, none, inherit) and fill its fields. Bruno masks bearer tokens and passwords as ****; reveal=true shows them in plain text afterwards (API-key values are never masked). Does not save.',
  retryable: false, rung: 1,
  params: z.object({
    mode: z.enum(['bearer', 'basic', 'apikey', 'none', 'inherit', 'digest', 'oauth2', 'awsv4']),
    token: z.string().optional(), username: z.string().optional(), password: z.string().optional(), key: z.string().optional(), value: z.string().optional(),
    reveal: z.boolean().default(false).describe('click the eye button so the secret is readable in the capture'),
  }),
  async execute(ctx, p) {
    await selectRequestTab(ctx, 'request.setAuth', 'auth');
    const sel = ctx.page.locator('[data-testid="auth-mode-selector"]').first();
    await expectVisible('request.setAuth', 'The auth mode selector', sel, ctx.timeoutMs);
    await ctx.cursor.click(sel);
    const item = ctx.page.locator(`[data-testid="auth-mode-dropdown-${p.mode}"]`);
    await expectVisible('request.setAuth', `Auth mode "${p.mode}"`, item, ctx.timeoutMs);
    await ctx.cursor.click(item);
    await ctx.page.waitForTimeout(250);
    const fields = ctx.page.locator('[data-testid="request-pane"] .CodeMirror');
    const fill = async (i: number, v: string | undefined) => { if (v === undefined) return; await typeCodeMirror(ctx, fields.nth(i), v, true); };
    if (p.mode === 'bearer') await fill(0, p.token);
    else if (p.mode === 'basic') { await fill(0, p.username); await fill(1, p.password); }
    else if (p.mode === 'apikey') { await fill(0, p.key); await fill(1, p.value); }
    if (p.reveal && ['bearer', 'basic', 'apikey'].includes(p.mode)) await revealSecrets(ctx, 'request.setAuth');
    ctx.log(`auth ${p.mode}${p.reveal ? ' (revealed)' : ''}`);
  },
});

async function appendKeyValue(ctx: ActionContext, actionId: string, tab: string, tableId: string, name: string, value: string): Promise<void> {
  await selectRequestTab(ctx, actionId, tab);
  const table = ctx.page.locator(`[data-testid="${tableId}"]`).first();
  await expectVisible(actionId, `The ${tab} table`, table, ctx.timeoutMs);
  const rows = table.locator('tbody tr');
  const before = await rows.count();
  await typeCodeMirror(ctx, rows.last().locator('[data-testid="column-name"]'), name, false);
  try { await ctx.page.waitForFunction(([sel, n]) => document.querySelectorAll(`[data-testid="${sel}"] tbody tr`).length > n!, [tableId, before] as const, { timeout: 5000 }); }
  catch (e) { throw new ActionError(actionId, `Typing "${name}" did not add a ${tab} row`, undefined, e); }
  const row = rows.nth((await rows.count()) - 2);
  await typeCodeMirror(ctx, row.locator('[data-testid="column-value"]'), value, false);
  ctx.log(`${tab}: ${name} = ${value}`);
}

export const requestAddHeader = defineAction({
  id: 'request.addHeader',
  description: 'Add a header (name, value) to the open request on the Headers tab. Does not save.',
  retryable: false, rung: 1,
  params: z.object({ name: z.string().min(1), value: z.string() }),
  execute: (ctx, p) => appendKeyValue(ctx, 'request.addHeader', 'headers', 'request-headers-table', p.name, p.value),
});

export const requestAddQueryParam = defineAction({
  id: 'request.addQueryParam',
  description: 'Add a query parameter (name, value) to the open request on the Params tab. Does not save.',
  retryable: false, rung: 1,
  params: z.object({ name: z.string().min(1), value: z.string() }),
  execute: (ctx, p) => appendKeyValue(ctx, 'request.addQueryParam', 'params', 'query-params-table', p.name, p.value),
});

export const requestSave = defineAction({
  id: 'request.save',
  description: 'Save the open request (⌘S) and wait for the draft indicator to clear.',
  retryable: false, rung: 4,
  params: z.object({}),
  async execute(ctx) {
    const pane = ctx.page.locator('[data-testid="request-pane"]');
    await expectVisible('request.save', 'An open request', pane, ctx.timeoutMs, 'Open a request first.');
    await ctx.page.keyboard.press('Meta+s');
    try { await ctx.page.locator('[data-testid="tab-draft-icon"], [data-testid="request-tab-draft-icon"]').first().waitFor({ state: 'hidden', timeout: ctx.timeoutMs }); }
    catch (e) { throw new ActionError('request.save', 'The request still shows unsaved changes after ⌘S', undefined, e); }
    ctx.log('request saved');
  },
});

export const folderCreate = defineAction({
  id: 'folder.create',
  description: 'Create a folder in a collection via the New Folder modal.',
  retryable: false, rung: 1,
  params: z.object({ name: z.string().min(1), collection: z.string().min(1).optional() }),
  async execute(ctx, p) {
    await openCollectionMenu(ctx, 'folder.create', p.collection);
    await ctx.cursor.click(ctx.page.locator('[data-testid="collection-actions-new-folder"]'));
    const modal = modalWith(ctx, 'new-folder-input');
    const input = modal.locator('[data-testid="new-folder-input"]');
    await expectVisible('folder.create', 'The New Folder modal', input, ctx.timeoutMs);
    await ctx.cursor.click(input);
    await input.pressSequentially(p.name, { delay: 14 });
    await ctx.cursor.click(modal.locator('button[type="submit"]'));
    try { await ctx.page.locator(SIDEBAR_ITEM, { hasText: p.name }).first().waitFor({ state: 'visible', timeout: ctx.timeoutMs }); }
    catch (e) { throw new ActionError('folder.create', `Folder "${p.name}" did not appear in the sidebar`, undefined, e); }
    ctx.log(`folder "${p.name}" created`);
  },
});

const COLLECTION_MENU_ITEMS = ['new-request', 'new-folder', 'new-app', 'new-script', 'run', 'clone', 'sync-openapi', 'rename', 'share', 'generate-docs', 'collapse', 'show-in-folder', 'settings', 'terminal', 'create-mock-server', 'move-to-workspace', 'remove'] as const;
export const collectionMenuItem = defineAction({
  id: 'collection.menuItem',
  description: 'Open a collection\'s "…" menu and click one item (new-request, new-folder, run, clone, sync-openapi, rename, share, generate-docs, settings, create-mock-server, …).',
  retryable: false, rung: 1,
  params: z.object({ item: z.enum(COLLECTION_MENU_ITEMS), collection: z.string().min(1).optional() }),
  async execute(ctx, p) {
    await openCollectionMenu(ctx, 'collection.menuItem', p.collection);
    const item = ctx.page.locator(`[data-testid="collection-actions-${p.item}"]`);
    await expectVisible('collection.menuItem', `Menu item "${p.item}"`, item, ctx.timeoutMs);
    await ctx.cursor.click(item);
    ctx.log(`collection menu → ${p.item}`);
  },
});

const ITEM_MENU_ITEMS = ['clone', 'copy', 'rename', 'generate-code', 'create-example', 'show-in-folder', 'info', 'delete', 'new-request', 'new-folder', 'run', 'settings'] as const;
export const requestMenuItem = defineAction({
  id: 'request.menuItem',
  description: 'Open the "…" menu of a request or folder in the sidebar and click one item (clone, copy, rename, generate-code, create-example, info, delete, …).',
  retryable: false, rung: 1,
  params: z.object({ name: z.string().min(1).describe('request or folder name as shown in the sidebar'), item: z.enum(ITEM_MENU_ITEMS) }),
  async execute(ctx, p) {
    const row = ctx.page.locator(SIDEBAR_ITEM, { hasText: p.name }).first();
    await expectVisible('request.menuItem', `"${p.name}" in the sidebar`, row, ctx.timeoutMs, 'Open its collection first.');
    await ctx.cursor.hover(row);
    const menu = row.locator('[data-testid="collection-item-menu"]').first();
    await expectVisible('request.menuItem', 'The item menu button', menu, ctx.timeoutMs);
    await ctx.cursor.click(menu);
    const item = ctx.page.locator(`[data-testid="collection-item-menu-${p.item}"]`);
    await expectVisible('request.menuItem', `Menu item "${p.item}"`, item, ctx.timeoutMs);
    await ctx.cursor.click(item);
    ctx.log(`"${p.name}" menu → ${p.item}`);
  },
});

const SETTINGS_TABS = ['overview', 'headers', 'vars', 'auth', 'script', 'tests', 'presets', 'proxy', 'clientCert', 'externalSecrets', 'protobuf'] as const;
export const collectionOpenSettings = defineAction({
  id: 'collection.openSettings',
  description: 'Open a collection\'s Settings tab (optionally a specific sub-tab: overview, headers, vars, auth, script, tests, presets, proxy, clientCert, externalSecrets).',
  retryable: true, rung: 1,
  params: z.object({ collection: z.string().min(1).optional(), tab: z.enum(SETTINGS_TABS).optional() }),
  async execute(ctx, p) {
    await openCollectionMenu(ctx, 'collection.openSettings', p.collection);
    await ctx.cursor.click(ctx.page.locator('[data-testid="collection-actions-settings"]'));
    await expectVisible('collection.openSettings', 'The collection settings', ctx.page.locator('[data-testid="settings-tab-bar"]'), ctx.timeoutMs);
    if (p.tab) {
      const t = ctx.page.locator(`[data-testid="collection-settings-tab-${p.tab}"]`).filter({ visible: true }).first();
      await expectVisible('collection.openSettings', `Settings tab "${p.tab}"`, t, ctx.timeoutMs);
      await ctx.cursor.click(t);
    }
    ctx.log(`collection settings${p.tab ? ` → ${p.tab}` : ''}`);
  },
});

export const AUTHORING_ACTIONS: Array<ReturnType<typeof defineAction<any>>> = [requestCreate, requestSetUrl, requestSetMethod, requestSetBody, requestSetAuth, requestRevealSecret, requestAddHeader, requestAddQueryParam, requestSave, folderCreate, collectionMenuItem, requestMenuItem, collectionOpenSettings];

/** Measured S10c: 4.1.0 creates collections through an inline sidebar editor (no modal, no native dialog). */
export const collectionCreate = defineAction({
  id: 'collection.create',
  description: 'Create a new, empty collection via the sidebar "+" menu → Create collection → inline name editor → Enter. Lands in Bruno\'s default collection location.',
  retryable: false, rung: 3,
  params: z.object({ name: z.string().min(1) }),
  async execute(ctx, p) {
    const add = ctx.page.locator('[data-testid="collections-header-add-menu"]').first();
    await expectVisible('collection.create', 'The collections "+" button', add, ctx.timeoutMs);
    await ctx.cursor.click(add);
    const create = ctx.page.locator('[data-testid="collections-header-add-menu-create"]');
    await expectVisible('collection.create', 'The "Create collection" menu item', create, ctx.timeoutMs);
    await ctx.cursor.click(create);
    const input = ctx.page.locator('[data-testid="sidebar"] input.inline-collection-input, [data-testid="sidebar"] input').first();
    await expectVisible('collection.create', 'The inline collection name editor', input, ctx.timeoutMs);
    await input.fill('');
    await input.pressSequentially(p.name, { delay: 16 });
    await ctx.page.keyboard.press('Enter');
    try { await ctx.page.locator('[data-testid="sidebar-collection-row"]', { hasText: p.name }).first().waitFor({ state: 'visible', timeout: ctx.timeoutMs }); }
    catch (e) { throw new ActionError('collection.create', `Collection "${p.name}" did not appear in the sidebar`, 'Collection names must be unique and valid as folder names.', e); }
    ctx.log(`collection "${p.name}" created`);
  },
});
AUTHORING_ACTIONS.push(collectionCreate);
