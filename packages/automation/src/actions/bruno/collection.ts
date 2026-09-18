import { z } from 'zod';
import { ActionError, defineAction, expectVisible } from '../types.js';

export const SIDEBAR_ROW = '[data-testid="sidebar-collection-row"]';
export const SIDEBAR_ITEM = '[data-testid="sidebar-collection-item-row"]';

export const collectionOpen = defineAction({
  id: 'collection.open',
  description: 'Click a collection in the sidebar and wait for its header/items.',
  retryable: true,
  rung: 1,
  params: z.object({ name: z.string().min(1) }),
  async execute(ctx, p) {
    const row = ctx.page.locator(SIDEBAR_ROW, { hasText: p.name }).first();
    await expectVisible('collection.open', `Collection "${p.name}" in the sidebar`, row, ctx.timeoutMs,
      'Check the fixture collection name and that the workspace was seeded with it.');
    await ctx.cursor.click(row);
    const header = ctx.page.locator('[data-testid="collection-header"]').first();
    const items = ctx.page.locator(SIDEBAR_ITEM).first();
    try {
      await Promise.race([header.waitFor({ state: 'visible', timeout: ctx.timeoutMs }), items.waitFor({ state: 'visible', timeout: ctx.timeoutMs })]);
    } catch (e) {
      throw new ActionError('collection.open', `Collection "${p.name}" did not open (no header or items appeared)`, undefined, e);
    }
    ctx.log(`collection "${p.name}" open`);
  },
});

/** Sidebar collection row by name, or the first one — shared by runner.open. */
export function collectionRow(ctx: { page: import('playwright').Page }, name?: string) {
  return name ? ctx.page.locator(SIDEBAR_ROW, { hasText: name }).first() : ctx.page.locator(SIDEBAR_ROW).first();
}
