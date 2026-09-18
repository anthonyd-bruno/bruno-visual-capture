import { z } from 'zod';
import { ActionError, defineAction, expectVisible } from '../types.js';

const TRIGGER = '[data-testid="environment-selector-trigger"]';

export const environmentSelect = defineAction({
  id: 'environment.select',
  description: 'Choose a collection environment from the environment selector.',
  retryable: true,
  rung: 1,
  params: z.object({ name: z.string().min(1) }),
  async execute(ctx, p) {
    const trigger = ctx.page.locator(TRIGGER).first();
    await expectVisible('environment.select', 'The environment selector', trigger, ctx.timeoutMs, 'Open a collection first.');
    if ((await trigger.innerText()).trim().includes(p.name)) { ctx.log(`environment "${p.name}" already selected`); return; }
    const item = ctx.page.locator('[data-testid="env-list-item"]', { hasText: p.name }).first();
    const listOpen = await ctx.page.locator('[data-testid="env-list-item"], [data-testid="env-no-environment-item"]').first().isVisible().catch(() => false);
    if (!listOpen) await ctx.cursor.click(trigger); // the trigger toggles; clicking it while open would close the list
    await expectVisible('environment.select', `Environment "${p.name}"`, item, ctx.timeoutMs, 'Check the environment name in the fixture\'s environments/ folder.');
    await ctx.cursor.click(item);
    try {
      await ctx.page.waitForFunction(([sel, name]) => (document.querySelector(sel!)?.textContent ?? '').includes(name!), [TRIGGER, p.name] as const, { timeout: ctx.timeoutMs });
    } catch (e) {
      throw new ActionError('environment.select', `Environment selector did not switch to "${p.name}"`, undefined, e);
    }
    ctx.log(`environment "${p.name}" selected`);
  },
});

export const environmentOpenSelector = defineAction({
  id: 'environment.openSelector',
  description: 'Open the environment dropdown (for capturing the selector state).',
  retryable: true, rung: 1,
  params: z.object({}),
  async execute(ctx) {
    const trigger = ctx.page.locator(TRIGGER).first();
    await expectVisible('environment.openSelector', 'The environment selector', trigger, ctx.timeoutMs, 'Open a collection first.');
    await ctx.cursor.click(trigger);
    await expectVisible('environment.openSelector', 'The environment list', ctx.page.locator('[data-testid="env-list-item"], [data-testid="env-no-environment-item"]').first(), ctx.timeoutMs);
    ctx.log('environment selector open');
  },
});

export const environmentOpenEditor = defineAction({
  id: 'environment.openEditor',
  description: 'Open the environment editor (Configure) from the selector.',
  retryable: true,
  rung: 1,
  params: z.object({}),
  async execute(ctx) {
    const trigger = ctx.page.locator(TRIGGER).first();
    await expectVisible('environment.openEditor', 'The environment selector', trigger, ctx.timeoutMs);
    await ctx.cursor.click(trigger);
    const configure = ctx.page.locator('[data-testid="configure-env"]');
    await expectVisible('environment.openEditor', 'The "Configure" button', configure, ctx.timeoutMs);
    await ctx.cursor.click(configure);
    await expectVisible('environment.openEditor', 'The environment editor', ctx.page.locator('[data-testid="save-env"], [data-testid="env-var-name-input"]').first(), ctx.timeoutMs);
    ctx.log('environment editor open');
  },
});
