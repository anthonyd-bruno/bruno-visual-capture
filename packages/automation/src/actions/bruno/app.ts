import { z } from 'zod';
import { setContentSize, setTheme } from '../../launcher.js';
import { ActionError, defineAction, firstLine } from '../types.js';

export const appSetGeometry = defineAction({
  id: 'app.setGeometry',
  description: 'Resize the Bruno window so the app content area is exactly width × height CSS pixels (S2 rule).',
  retryable: true,
  rung: 5,
  params: z.object({ width: z.number().int().min(320), height: z.number().int().min(200), x: z.number().int().optional(), y: z.number().int().optional() }),
  async execute(ctx, p) {
    try {
      const r = await setContentSize(ctx.session, p);
      ctx.log(`window content ${r.actual.width}×${r.actual.height} @${r.devicePixelRatio}x`);
    } catch (e) {
      throw new ActionError('app.setGeometry', firstLine(e), 'Use a preset that fits this display, or move Bruno to a larger display.', e);
    }
  },
});

export const modalClose = defineAction({
  id: 'modal.close',
  description: 'Close the topmost modal (close button if present, otherwise Escape).',
  retryable: true, rung: 1,
  params: z.object({}),
  async execute(ctx) {
    const close = ctx.page.locator('[data-testid="modal-close-button"]').last();
    if (await close.isVisible().catch(() => false)) await ctx.cursor.click(close); else await ctx.page.keyboard.press('Escape');
    try { await ctx.page.locator('[data-testid="simple-modal-overlay"], [data-testid="modal-close-button"]').first().waitFor({ state: 'hidden', timeout: ctx.timeoutMs }); }
    catch (e) { throw new ActionError('modal.close', 'The modal did not close', undefined, e); }
    ctx.log('modal closed');
  },
});

export const themeSet = defineAction({
  id: 'theme.set',
  description: 'Set Bruno\'s theme via renderer localStorage + reload (D3).',
  retryable: true,
  rung: 5,
  params: z.object({ theme: z.enum(['light', 'dark']) }),
  async execute(ctx, p) {
    try { await setTheme(ctx.session, p.theme, ctx.timeoutMs); }
    catch (e) { throw new ActionError('theme.set', firstLine(e), undefined, e); }
    ctx.log(`theme ${p.theme}`);
  },
});
