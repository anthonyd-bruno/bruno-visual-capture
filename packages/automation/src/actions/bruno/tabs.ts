import { z } from 'zod';
import { ActionError, defineAction, expectVisible, type ActionContext } from '../types.js';

type Pane = 'request-pane' | 'response-pane';

/** Bruno's pane tabs carry derived ids `responsive-tab-<name>` (measured S8); hidden measurement clones do not. */
const paneTab = (pane: Pane, tab: string) => `[data-testid="${pane}"] [data-testid="responsive-tab-${tab}"]`;
const paneName = (pane: Pane) => (pane === 'request-pane' ? 'request' : 'response');

/**
 * Select a pane tab. Tabs that do not fit the pane width collapse into a "…" menu
 * (`menu-dropdown` → `menu-dropdown-<tab>`, measured S12 at 1600 px with a request that has scripts,
 * assertions and vars: Docs / File / Settings / History were hidden), so a missing tab is looked up there
 * before we give up. Picking it from the menu makes the tab visible and active.
 */
export async function selectPaneTab(actionId: string, ctx: ActionContext, pane: Pane, tab: string): Promise<void> {
  const sel = paneTab(pane, tab);
  const loc = ctx.page.locator(sel).filter({ visible: true }).first();
  const hint = pane === 'response-pane' ? 'Send a request first — response tabs appear once a response exists.' : 'Open a request first.';
  const visible = await loc.waitFor({ state: 'visible', timeout: Math.min(ctx.timeoutMs, 2500) }).then(() => true, () => false);
  if (visible) {
    if (await loc.evaluate((el) => el.classList.contains('active')).catch(() => false)) { ctx.log(`${paneName(pane)} tab ${tab} already active`); return; }
    await ctx.cursor.click(loc);
  } else {
    const more = ctx.page.locator(`[data-testid="${pane}"] [data-testid="menu-dropdown"]`).filter({ visible: true }).first();
    if (!(await more.isVisible().catch(() => false))) await expectVisible(actionId, `The "${tab}" tab`, loc, ctx.timeoutMs, hint);
    await ctx.cursor.click(more);
    const item = ctx.page.locator(`[data-testid="menu-dropdown-${tab}"]`).filter({ visible: true }).first();
    await expectVisible(actionId, `The "${tab}" tab (looked for it in the pane's overflow menu too)`, item, ctx.timeoutMs, hint);
    await ctx.cursor.click(item);
  }
  try {
    await ctx.page.waitForFunction((s) => document.querySelector(s)?.classList.contains('active') ?? false, sel, { timeout: ctx.timeoutMs });
  } catch (e) {
    throw new ActionError(actionId, `The "${tab}" tab did not become active`, undefined, e);
  }
  ctx.log(`${paneName(pane)} tab ${tab}`);
}

export const requestSelectTab = defineAction({
  id: 'request.selectTab',
  description: 'Select a tab in the request editor (params, body, headers, auth, vars, script, assert, tests, docs, settings). Tabs hidden in the pane\'s overflow menu are found there.',
  retryable: true, rung: 2,
  params: z.object({ tab: z.enum(['params', 'body', 'headers', 'auth', 'vars', 'script', 'assert', 'tests', 'docs', 'file', 'settings', 'history']) }),
  execute: (ctx, p) => selectPaneTab('request.selectTab', ctx, 'request-pane', p.tab),
});

export const responseSelectTab = defineAction({
  id: 'response.selectTab',
  description: 'Select a tab in the response pane (response, headers, timeline, tests).',
  retryable: true, rung: 2,
  params: z.object({ tab: z.enum(['response', 'headers', 'timeline', 'tests']) }),
  execute: (ctx, p) => selectPaneTab('response.selectTab', ctx, 'response-pane', p.tab),
});

export const timelineOpen = defineAction({
  id: 'timeline.open',
  description: 'Open the Timeline tab of the response pane and wait for its entries.',
  retryable: true, rung: 2,
  params: z.object({}),
  async execute(ctx) {
    await selectPaneTab('timeline.open', ctx, 'response-pane', 'timeline');
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
