import { z } from 'zod';
import { ActionError, defineAction, expectVisible } from '../types.js';

/** Bruno's pane tabs carry derived ids `responsive-tab-<name>` (measured S8); hidden measurement clones do not. */
const paneTab = (pane: 'request-pane' | 'response-pane', tab: string) => `[data-testid="${pane}"] [data-testid="responsive-tab-${tab}"]`;

async function selectTab(actionId: string, ctx: Parameters<Parameters<typeof defineAction>[0]['execute']>[0], pane: 'request-pane' | 'response-pane', tab: string): Promise<void> {
  const loc = ctx.page.locator(paneTab(pane, tab)).filter({ visible: true }).first();
  await expectVisible(actionId, `The "${tab}" tab`, loc, ctx.timeoutMs, pane === 'response-pane' ? 'Send a request first — response tabs appear once a response exists.' : 'Open a request first.');
  await ctx.cursor.click(loc);
  try {
    await ctx.page.waitForFunction((sel) => document.querySelector(sel)?.classList.contains('active') ?? false, paneTab(pane, tab), { timeout: ctx.timeoutMs });
  } catch (e) {
    throw new ActionError(actionId, `The "${tab}" tab did not become active`, undefined, e);
  }
  ctx.log(`${pane === 'request-pane' ? 'request' : 'response'} tab ${tab}`);
}

export const requestSelectTab = defineAction({
  id: 'request.selectTab',
  description: 'Select a tab in the request editor (params, body, headers, auth, vars, script, assert, tests, docs, settings).',
  retryable: true, rung: 2,
  params: z.object({ tab: z.enum(['params', 'body', 'headers', 'auth', 'vars', 'script', 'assert', 'tests', 'docs', 'file', 'settings', 'history']) }),
  execute: (ctx, p) => selectTab('request.selectTab', ctx, 'request-pane', p.tab),
});

export const responseSelectTab = defineAction({
  id: 'response.selectTab',
  description: 'Select a tab in the response pane (response, headers, timeline, tests).',
  retryable: true, rung: 2,
  params: z.object({ tab: z.enum(['response', 'headers', 'timeline', 'tests']) }),
  execute: (ctx, p) => selectTab('response.selectTab', ctx, 'response-pane', p.tab),
});

export const timelineOpen = defineAction({
  id: 'timeline.open',
  description: 'Open the Timeline tab of the response pane and wait for its entries.',
  retryable: true, rung: 2,
  params: z.object({}),
  async execute(ctx) {
    await selectTab('timeline.open', ctx, 'response-pane', 'timeline');
    await expectVisible('timeline.open', 'The timeline', ctx.page.locator('[data-testid="timeline-container"]'), ctx.timeoutMs);
    await expectVisible('timeline.open', 'A timeline entry', ctx.page.locator('[data-testid="timeline-item"], [data-testid="timeline-entry"]').first(), ctx.timeoutMs, 'Send a request first so the timeline has activity.');
    ctx.log(`timeline open with ${await ctx.page.locator('[data-testid="timeline-item"]').count()} item(s)`);
  },
});

export const timelineExpandFirst = defineAction({
  id: 'timeline.expandFirst',
  description: 'Expand the first timeline entry to show request/response details.',
  retryable: true, rung: 1,
  params: z.object({}),
  async execute(ctx) {
    const header = ctx.page.locator('[data-testid="timeline-item-header"]').first();
    await expectVisible('timeline.expandFirst', 'A timeline entry header', header, ctx.timeoutMs, 'Run timeline.open first.');
    await ctx.cursor.click(header);
    await expectVisible('timeline.expandFirst', 'The timeline entry details', ctx.page.locator('[data-testid="timeline-detail"]').first(), ctx.timeoutMs);
  },
});
