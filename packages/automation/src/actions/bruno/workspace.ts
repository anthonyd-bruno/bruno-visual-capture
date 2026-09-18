import { z } from 'zod';
import { defineAction, expectVisible } from '../types.js';

/**
 * The workspace itself is seeded before launch (D3/D4: workspace.yml + ui-state-snapshot.json), so at
 * execution time this only asserts the shell is up and, when asked, that the expected collections
 * are mounted. Kept as an action so workflows read naturally and the postcondition is explicit.
 */
export const workspaceOpen = defineAction({
  id: 'workspace.open',
  description: 'Assert the seeded workspace is loaded (and optionally that named collections are present).',
  retryable: true,
  rung: 5,
  params: z.object({ collections: z.array(z.string().min(1)).optional() }),
  async execute(ctx, p) {
    await expectVisible('workspace.open', 'The Bruno sidebar', ctx.page.locator('[data-testid="sidebar"]'), ctx.timeoutMs);
    for (const name of p.collections ?? []) {
      await expectVisible('workspace.open', `Collection "${name}"`, ctx.page.locator('[data-testid="sidebar-collection-row"]', { hasText: name }).first(), ctx.timeoutMs,
        'The workspace seed did not include this collection, or Bruno failed to mount it.');
    }
    ctx.log('workspace ready');
  },
});
