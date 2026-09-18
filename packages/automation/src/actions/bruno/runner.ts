import { z } from 'zod';
import { waitForState } from '../states.js';
import { ActionError, defineAction, expectVisible } from '../types.js';
import { collectionRow } from './collection.js';

export const runnerOpen = defineAction({
  id: 'runner.open',
  description: 'Open the Runner for a collection via its actions menu (collection-actions → collection-actions-run).',
  retryable: true,
  rung: 2,
  params: z.object({ collection: z.string().min(1).optional() }),
  async execute(ctx, p) {
    const row = collectionRow(ctx, p.collection);
    await expectVisible('runner.open', p.collection ? `Collection "${p.collection}"` : 'A collection row', row, ctx.timeoutMs);
    await row.hover();
    const actions = row.locator('[data-testid="collection-actions"]').first().or(ctx.page.locator('[data-testid="collection-actions"]').first());
    await expectVisible('runner.open', 'The collection actions menu button', actions, ctx.timeoutMs);
    await actions.click();
    const run = ctx.page.locator('[data-testid="collection-actions-run"]');
    await expectVisible('runner.open', 'The "Run" menu item', run, ctx.timeoutMs);
    await run.click();
    await expectVisible('runner.open', 'The Runner', ctx.page.locator('[data-testid="runner-run-button"]'), ctx.timeoutMs);
    ctx.log('runner open');
  },
});

export const runnerRunCollection = defineAction({
  id: 'runner.runCollection',
  description: 'Run the collection in the open Runner; selects all requests first if none are selected.',
  retryable: false, // side-effecting (PRD §42)
  rung: 1,
  params: z.object({}),
  async execute(ctx) {
    const runBtn = ctx.page.locator('[data-testid="runner-run-button"]');
    await expectVisible('runner.runCollection', 'The Runner run button', runBtn, ctx.timeoutMs, 'Run runner.open first.');
    if (!(await runBtn.isEnabled())) {
      // Measured: the button is disabled when nothing is selected and select-all is a toggle,
      // so only touch it in that state.
      await ctx.page.locator('[data-testid="runner-select-all"]').click();
      try { await runBtn.and(ctx.page.locator(':enabled')).waitFor({ timeout: 5000 }); }
      catch (e) { throw new ActionError('runner.runCollection', 'No runnable requests in this collection (run button stayed disabled after select-all)', 'Check that the fixture requests are valid YAML.', e); }
      ctx.log('selected all requests');
    }
    await runBtn.click();
    try {
      await Promise.race([
        ctx.page.locator('[data-testid="runner-cancel-button"]').waitFor({ state: 'visible', timeout: ctx.timeoutMs }),
        ctx.page.locator('[data-testid="runner-run-again-button"]').waitFor({ state: 'visible', timeout: ctx.timeoutMs }),
      ]);
    } catch (e) {
      throw new ActionError('runner.runCollection', 'The Runner did not start (neither running nor finished state appeared)', undefined, e);
    }
    ctx.log('collection run started');
  },
});

export const runnerWaitComplete = defineAction({
  id: 'runner.waitComplete',
  description: 'Wait until the Runner shows "Run Again" (all requests finished).',
  retryable: true,
  rung: 1,
  params: z.object({ timeoutMs: z.number().int().positive().max(600_000).optional() }),
  async execute(ctx, p) {
    await waitForState(ctx.page, 'runner.complete', p.timeoutMs ?? Math.max(ctx.timeoutMs, 60_000));
    ctx.log(`runner complete: ${await ctx.page.locator('[data-testid="runner-result-item"]').count()} results`);
  },
});
