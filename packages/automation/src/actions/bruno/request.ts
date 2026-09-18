import { z } from 'zod';
import { ActionError, defineAction, expectVisible } from '../types.js';
import { SIDEBAR_ITEM } from './collection.js';

export const requestOpen = defineAction({
  id: 'request.open',
  description: 'Open a request from the sidebar by name.',
  retryable: true,
  rung: 1,
  params: z.object({ name: z.string().min(1) }),
  async execute(ctx, p) {
    const item = ctx.page.locator(SIDEBAR_ITEM, { hasText: p.name }).first();
    await expectVisible('request.open', `Request "${p.name}" in the sidebar`, item, ctx.timeoutMs, 'Open its collection first (collection.open).');
    await ctx.cursor.click(item);
    await expectVisible('request.open', 'The request editor', ctx.page.locator('[data-testid="request-pane"]'), ctx.timeoutMs);
    ctx.log(`request "${p.name}" open`);
  },
});

export const requestSend = defineAction({
  id: 'request.send',
  description: 'Send the open request with ⌘↩ (Bruno\'s own shortcut; there is no send-button test id) and wait for a response.',
  retryable: false, // side-effecting (PRD §42)
  rung: 4,
  params: z.object({ timeoutMs: z.number().int().positive().max(300_000).optional() }),
  async execute(ctx, p) {
    const pane = ctx.page.locator('[data-testid="request-pane"]');
    await expectVisible('request.send', 'An open request', pane, ctx.timeoutMs, 'Run request.open first.');
    await ctx.cursor.click(pane, { position: { x: 10, y: 10 } });
    await ctx.page.keyboard.press('Meta+Enter');
    const status = ctx.page.locator('[data-testid="response-status-code"]');
    try {
      await status.waitFor({ state: 'visible', timeout: p.timeoutMs ?? ctx.timeoutMs });
    } catch (e) {
      throw new ActionError('request.send', 'No response arrived after sending the request', 'Check the request URL/environment and network access.', e);
    }
    ctx.log(`response ${(await status.innerText().catch(() => '?')).trim()}`);
  },
});
