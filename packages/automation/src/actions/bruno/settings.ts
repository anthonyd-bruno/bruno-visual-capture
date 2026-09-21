import { z } from 'zod';
import { ActionError, defineAction, expectVisible, type ActionContext } from '../types.js';
import { collectionOpenSettings, requestMenuItem, typeCodeMirror } from './authoring.js';

/**
 * Phase 11 collection/folder settings actions, measured S12c on Bruno 4.1.0:
 * - Collection Settings → Headers: table `collection-headers` (cells `column-name` / `column-value` / `column-description`,
 *   typing in the trailing empty row appends a row); → Vars: `collection-vars-req`; → Auth: `auth-mode-selector` whose
 *   menu items are `menu-dropdown-<awsv4|basic|wsse|bearer|digest|ntlm|oauth1|oauth2|apikey|akamai-edgegrid|none>` (not the
 *   request editor's `auth-mode-dropdown-*`), fields are unlabelled CodeMirrors with a `secret-reveal-toggle`; → Script:
 *   `tab-trigger-pre-request` / `tab-trigger-post-response` and `collection-<phase>-script-editor`.
 * - ⌘S on a settings tab saves it and toasts "Collection Settings saved successfully".
 * - Folder settings (`collection-item-menu-settings` on a folder row): `folder-settings-tab-<headers|script|test|vars|auth|docs>`.
 * - YAML written to opencollection.yml: `request: { headers: [{name, value}], auth: {type, token}, variables: [{name, value}],
 *   scripts: [{type: before-request|after-response, code}] }`.
 */

const COLLECTION_AUTH_MODES = ['bearer', 'basic', 'apikey', 'none', 'digest', 'oauth2', 'awsv4', 'wsse', 'ntlm', 'oauth1'] as const;
const FOLDER_TABS = ['headers', 'script', 'test', 'vars', 'auth', 'docs'] as const;

const visibleCodeMirrors = (ctx: ActionContext) => ctx.page.locator('.CodeMirror').filter({ visible: true });

async function revealVisibleSecrets(ctx: ActionContext, actionId: string): Promise<void> {
  const masked = () => visibleCodeMirrors(ctx).evaluateAll((els) => els.some((e) => /^\s*\*{3,}/.test((e as HTMLElement).innerText.replace(/​/g, '').trim())));
  if (!(await masked())) { ctx.log('no masked secret on this tab — nothing to reveal'); return; }
  const toggle = ctx.page.locator('[data-testid="secret-reveal-toggle"]').filter({ visible: true }).first();
  await expectVisible(actionId, 'The reveal-secret (eye) button', toggle, ctx.timeoutMs, 'Only masked auth fields (bearer token, basic password) have one.');
  await ctx.cursor.click(toggle);
  try { await ctx.page.waitForFunction(() => ![...document.querySelectorAll('.CodeMirror')].filter((e) => (e as HTMLElement).offsetParent !== null).some((e) => /^\s*\*{3,}/.test((e as HTMLElement).innerText.replace(/​/g, '').trim())), undefined, { timeout: 5000 }); }
  catch (e) { throw new ActionError(actionId, 'The secret stayed masked after clicking the reveal button', undefined, e); }
  ctx.log('secrets revealed');
}

async function appendSettingsRow(ctx: ActionContext, actionId: string, tableId: string, what: string, name: string, value: string): Promise<void> {
  const table = ctx.page.locator(`[data-testid="${tableId}"]`).filter({ visible: true }).first();
  await expectVisible(actionId, `The collection ${what} table`, table, ctx.timeoutMs);
  const rows = table.locator('tbody tr');
  const before = await rows.count();
  await typeCodeMirror(ctx, rows.last().locator('[data-testid="column-name"]'), name, false);
  try { await ctx.page.waitForFunction(([sel, n]) => document.querySelectorAll(`[data-testid="${sel}"] tbody tr`).length > n!, [tableId, before] as const, { timeout: 5000 }); }
  catch (e) { throw new ActionError(actionId, `Typing "${name}" did not add a ${what} row`, undefined, e); }
  const row = rows.nth((await rows.count()) - 2);
  await typeCodeMirror(ctx, row.locator('[data-testid="column-value"]'), value, false);
  ctx.log(`collection ${what}: ${name} = ${value}`);
}

export const collectionAddHeader = defineAction({
  id: 'collection.addHeader',
  description: 'Add a collection-level header (Collection Settings → Headers) that every request in the collection sends. Does not save — follow with collection.saveSettings.',
  retryable: false, rung: 1,
  params: z.object({ collection: z.string().min(1).optional(), name: z.string().min(1), value: z.string() }),
  async execute(ctx, p) {
    await collectionOpenSettings.execute(ctx, { collection: p.collection, tab: 'headers' });
    await appendSettingsRow(ctx, 'collection.addHeader', 'collection-headers', 'headers', p.name, p.value);
  },
});

export const collectionAddVar = defineAction({
  id: 'collection.addVar',
  description: 'Add a collection-level (pre-request) variable in Collection Settings → Vars, usable as {{name}} in every request. Does not save — follow with collection.saveSettings.',
  retryable: false, rung: 1,
  params: z.object({ collection: z.string().min(1).optional(), name: z.string().min(1), value: z.string() }),
  async execute(ctx, p) {
    await collectionOpenSettings.execute(ctx, { collection: p.collection, tab: 'vars' });
    await appendSettingsRow(ctx, 'collection.addVar', 'collection-vars-req', 'variables', p.name, p.value);
  },
});

export const collectionSetAuth = defineAction({
  id: 'collection.setAuth',
  description: 'Set collection-level auth in Collection Settings → Auth (bearer, basic, apikey, none, …) and fill its fields; requests whose auth is "inherit" use it. Bruno masks the secret; reveal=true shows it. Does not save — follow with collection.saveSettings.',
  retryable: false, rung: 1,
  params: z.object({
    collection: z.string().min(1).optional(),
    mode: z.enum(COLLECTION_AUTH_MODES),
    token: z.string().optional(), username: z.string().optional(), password: z.string().optional(), key: z.string().optional(), value: z.string().optional(),
    reveal: z.boolean().default(false).describe('click the eye button so the secret is readable in the capture'),
  }),
  async execute(ctx, p) {
    await collectionOpenSettings.execute(ctx, { collection: p.collection, tab: 'auth' });
    const sel = ctx.page.locator('[data-testid="auth-mode-selector"]').filter({ visible: true }).first();
    await expectVisible('collection.setAuth', 'The collection auth mode selector', sel, ctx.timeoutMs);
    await ctx.cursor.click(sel);
    const item = ctx.page.locator(`[data-testid="menu-dropdown-${p.mode}"]`).filter({ visible: true }).first();
    await expectVisible('collection.setAuth', `Auth mode "${p.mode}"`, item, ctx.timeoutMs);
    await ctx.cursor.click(item);
    await ctx.page.waitForTimeout(250);
    const fields = visibleCodeMirrors(ctx);
    const fill = async (i: number, v: string | undefined) => { if (v === undefined) return; await typeCodeMirror(ctx, fields.nth(i), v, true); };
    if (p.mode === 'bearer') await fill(0, p.token);
    else if (p.mode === 'basic') { await fill(0, p.username); await fill(1, p.password); }
    else if (p.mode === 'apikey') { await fill(0, p.key); await fill(1, p.value); }
    if (p.reveal && ['bearer', 'basic', 'apikey'].includes(p.mode)) await revealVisibleSecrets(ctx, 'collection.setAuth');
    ctx.log(`collection auth ${p.mode}${p.reveal ? ' (revealed)' : ''}`);
  },
});

export const collectionSaveSettings = defineAction({
  id: 'collection.saveSettings',
  description: 'Save the open Collection Settings (⌘S) so collection-level headers, vars, auth and scripts apply to requests. A "Collection Settings saved successfully" toast shows for ~2 s.',
  retryable: false, rung: 4,
  params: z.object({}),
  async execute(ctx) {
    await expectVisible('collection.saveSettings', 'The collection settings', ctx.page.locator('[data-testid="settings-tab-bar"]').filter({ visible: true }).first(), ctx.timeoutMs, 'Open the collection settings first (collection.openSettings, collection.setAuth, …).');
    await ctx.page.keyboard.press('Meta+s');
    const toast = ctx.page.getByText(/Collection Settings saved/i).first();
    const toasted = await toast.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
    if (!toasted) {
      try { await ctx.page.locator('[data-testid="tab-draft-icon"]').first().waitFor({ state: 'hidden', timeout: ctx.timeoutMs }); }
      catch (e) { throw new ActionError('collection.saveSettings', 'The collection settings still show unsaved changes after ⌘S', undefined, e); }
    }
    ctx.log('collection settings saved');
  },
});

export const folderOpenSettings = defineAction({
  id: 'folder.openSettings',
  description: 'Open a folder\'s settings (sidebar "…" → Settings), optionally a tab: headers, script, test, vars, auth, docs.',
  retryable: true, rung: 1,
  params: z.object({ name: z.string().min(1).describe('folder name as shown in the sidebar'), tab: z.enum(FOLDER_TABS).optional() }),
  async execute(ctx, p) {
    await requestMenuItem.execute(ctx, { name: p.name, item: 'settings' });
    await expectVisible('folder.openSettings', 'The folder settings', ctx.page.locator('[data-testid="folder-settings-tab-headers"]').filter({ visible: true }).first(), ctx.timeoutMs);
    if (p.tab) {
      const t = ctx.page.locator(`[data-testid="folder-settings-tab-${p.tab}"]`).filter({ visible: true }).first();
      await expectVisible('folder.openSettings', `Folder settings tab "${p.tab}"`, t, ctx.timeoutMs);
      await ctx.cursor.click(t);
    }
    ctx.log(`folder "${p.name}" settings${p.tab ? ` → ${p.tab}` : ''}`);
  },
});

export const SETTINGS_ACTIONS = [collectionAddHeader, collectionAddVar, collectionSetAuth, collectionSaveSettings, folderOpenSettings];
