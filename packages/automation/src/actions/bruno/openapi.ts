import path from 'node:path';
import { z } from 'zod';
import { ActionError, defineAction, expectVisible, firstLine } from '../types.js';
import { collectionRow } from './collection.js';

const CONNECT_TEXT = /Connect to OpenAPI Spec/;
const LINKED_TEXT = /Linked Collection/;
const bodyText = (ctx: { page: import('playwright').Page }) => ctx.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));

async function waitForText(ctx: { page: import('playwright').Page; timeoutMs: number }, re: RegExp, actionId: string, what: string, hint?: string): Promise<void> {
  try { await ctx.page.waitForFunction((src) => new RegExp(src).test(document.body.innerText.replace(/\s+/g, ' ')), re.source, { timeout: ctx.timeoutMs }); }
  catch (e) {
    // Quote what the OpenAPI panel actually says so a wording change is diagnosable from the run error alone.
    const shown = (await ctx.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ')).catch(() => '')).replace(/^.*?(Connect to OpenAPI Spec|Linked Collection)/, '$1').slice(0, 220);
    throw new ActionError(actionId, `${what} did not appear within ${Math.round(ctx.timeoutMs / 1000)} s (panel shows: "${shown}")`, hint, e);
  }
}

/** Measured S9: the collection menu item opens an "OpenAPI" tab — "Connect to OpenAPI Spec" (URL/File) or, once linked, the sync dashboard. */
export const openapiOpen = defineAction({
  id: 'openapi.open',
  description: 'Open the collection\'s OpenAPI tab (connect screen or sync dashboard).',
  retryable: true, rung: 2,
  params: z.object({ collection: z.string().min(1).optional() }),
  async execute(ctx, p) {
    const row = collectionRow(ctx, p.collection);
    await expectVisible('openapi.open', 'The collection row', row, ctx.timeoutMs);
    await ctx.cursor.hover(row);
    const actions = row.locator('[data-testid="collection-actions"]').first().or(ctx.page.locator('[data-testid="collection-actions"]').first());
    await expectVisible('openapi.open', 'The collection actions menu button', actions, ctx.timeoutMs);
    await ctx.cursor.click(actions);
    const item = ctx.page.locator('[data-testid="collection-actions-sync-openapi"]');
    await expectVisible('openapi.open', 'The "OpenAPI" menu item', item, ctx.timeoutMs);
    await ctx.cursor.click(item);
    await waitForText(ctx, new RegExp(`${CONNECT_TEXT.source}|${LINKED_TEXT.source}`), 'openapi.open', 'The OpenAPI tab');
    ctx.log('openapi tab open');
  },
});

/** File mode uses an HTML file input → Playwright's file chooser, no native dialog (measured S9b). */
export const openapiConnectFile = defineAction({
  id: 'openapi.connectFile',
  description: 'Connect the collection to a local OpenAPI spec file (path relative to the run workspace).',
  retryable: false, rung: 3,
  params: z.object({ spec: z.string().min(1).refine((s) => !s.split('/').includes('..'), 'no parent segments') }),
  async execute(ctx, p) {
    if (!ctx.workspacePath) throw new ActionError('openapi.connectFile', 'This workflow has no fixture workspace to resolve the spec path against');
    const file = path.join(ctx.workspacePath, p.spec);
    const fileToggle = ctx.page.getByRole('button', { name: 'File', exact: true });
    await expectVisible('openapi.connectFile', 'The File/URL toggle', fileToggle, ctx.timeoutMs, 'Run openapi.open first.');
    await ctx.cursor.click(fileToggle);
    const chooser = ctx.page.waitForEvent('filechooser', { timeout: ctx.timeoutMs });
    await ctx.cursor.click(ctx.page.getByRole('button', { name: 'Select File' }));
    try { await (await chooser).setFiles(file); } catch (e) { throw new ActionError('openapi.connectFile', `Could not supply the spec file: ${firstLine(e)}`, undefined, e); }
    const connect = ctx.page.getByRole('button', { name: 'Connect', exact: true });
    await expectVisible('openapi.connectFile', 'The Connect button', connect, ctx.timeoutMs);
    await ctx.cursor.click(connect);
    await waitForText(ctx, LINKED_TEXT, 'openapi.connectFile', 'The linked-spec dashboard', 'Is the spec valid OpenAPI 3.x YAML/JSON?');
    ctx.log(`connected spec ${p.spec}`);
  },
});

export const openapiCheckForUpdates = defineAction({
  id: 'openapi.checkForUpdates',
  description: 'Click "Check for updates" and wait for pending spec updates to be reported.',
  retryable: true, rung: 3,
  params: z.object({}),
  async execute(ctx) {
    const btn = ctx.page.getByRole('button', { name: 'Check for updates' });
    await expectVisible('openapi.checkForUpdates', 'The "Check for updates" button', btn, ctx.timeoutMs, 'Connect a spec first (openapi.connectFile).');
    await ctx.cursor.click(btn);
    await waitForText(ctx, /[1-9]\d* Spec Updates Pending/, 'openapi.checkForUpdates', 'Pending spec updates', 'Did the spec file actually change?');
    const m = /(\d+) Spec Updates Pending/.exec(await bodyText(ctx));
    ctx.log(`spec updates pending: ${m?.[1] ?? '?'}`);
  },
});

export const openapiReviewAndSync = defineAction({
  id: 'openapi.reviewAndSync',
  description: 'Open "Review and Sync Collection", accept every spec update, and sync the collection.',
  retryable: false, rung: 3,
  params: z.object({ decision: z.enum(['accept-all', 'skip-all']).default('accept-all') }),
  async execute(ctx, p) {
    const review = ctx.page.getByRole('button', { name: /Review and Sync Collection/ });
    await expectVisible('openapi.reviewAndSync', 'The "Review and Sync Collection" button', review, ctx.timeoutMs, 'Connect a spec first.');
    await ctx.cursor.click(review);
    // Measured S9c: the review is an inline "Spec Updates" panel — Skip All / Accept All, per-endpoint
    // Keep Current / Update or Skip / Add, then "Sync Collection". Nothing is applied until decisions are made.
    await waitForText(ctx, /Review Changes/, 'openapi.reviewAndSync', 'The review panel');
    const decide = ctx.page.getByRole('button', { name: p.decision === 'accept-all' ? /^Accept All$/ : /^Skip All$/ });
    await expectVisible('openapi.reviewAndSync', `The "${p.decision === 'accept-all' ? 'Accept All' : 'Skip All'}" button`, decide, ctx.timeoutMs);
    await ctx.cursor.click(decide);
    await ctx.page.waitForTimeout(300);
    const sync = ctx.page.getByRole('button', { name: /^Sync Collection$/ });
    await expectVisible('openapi.reviewAndSync', 'The "Sync Collection" button', sync, ctx.timeoutMs);
    await ctx.cursor.click(sync);
    // A confirmation dialog may follow; confirm it if so.
    const confirm = ctx.page.locator('[class*="modal"], [role="dialog"]').filter({ visible: true }).getByRole('button', { name: /^(sync|confirm|yes|continue)/i }).last();
    await ctx.page.waitForTimeout(500);
    if (await confirm.count()) { ctx.log(`confirming sync with "${(await confirm.innerText()).trim()}"`); await ctx.cursor.click(confirm); }
    // Measured S9c: after a sync the Spec Updates tab reads "No updates from the spec — The spec endpoints
    // have not been updated since the last sync." and the new requests appear in the sidebar.
    await waitForText(ctx, /No updates from the spec|not been updated since the last sync/, 'openapi.reviewAndSync', 'The synced state', 'Sync Collection did not report the spec as up to date.');
    ctx.log('collection synced with spec');
  },
});
