import { z } from 'zod';
import { ActionError, defineAction, expectVisible, type ActionContext } from '../types.js';
import { SIDEBAR_ITEM } from './collection.js';
import { requestMenuItem } from './authoring.js';

/**
 * Phase 11 authoring actions, measured S12 on Bruno 4.1.0:
 * - Script tab phases: `tab-trigger-pre-request` / `tab-trigger-post-response` (Post Response is the default),
 *   editors `pre-request-script-editor` / `post-response-script-editor` (collection settings prefix them with `collection-`).
 * - Clone dialog (`collection-item-menu-clone`): one plain input (placeholder "Enter Item name", prefilled "<name> copy"),
 *   `clone-item-button`; the clone appears as a sidebar item row.
 * - Generate Code dialog (`collection-item-menu-generate-code`): `interpolate-vars-toggle`, an id-less native
 *   `<select>` of languages (Shell, C, Clojure, Crystal, C#, Go, HTTP, Java, JavaScript, Kotlin, Node.js, Objective-C,
 *   OCaml, PHP, Powershell, Python, R, Ruby, Rust, Swift) and per-language variant buttons (Shell: curl, httpie, wget).
 */

const modalWith = (ctx: ActionContext, testId: string) => ctx.page.locator('[class*="modal"]').filter({ has: ctx.page.locator(`[data-testid="${testId}"]`) }).first();

export const CODEGEN_LANGUAGES = ['Shell', 'C', 'Clojure', 'Crystal', 'C#', 'Go', 'HTTP', 'Java', 'JavaScript', 'Kotlin', 'Node.js', 'Objective-C', 'OCaml', 'PHP', 'Powershell', 'Python', 'R', 'Ruby', 'Rust', 'Swift'] as const;

export const requestSelectScriptPhase = defineAction({
  id: 'request.selectScriptPhase',
  description: 'Switch the Script editor between its Pre Request and Post Response phases. Works on a request\'s Script tab and on Collection Settings → Script (Bruno opens Post Response by default).',
  retryable: true, rung: 1,
  params: z.object({ phase: z.enum(['pre-request', 'post-response']) }),
  async execute(ctx, p) {
    const trigger = ctx.page.locator(`[data-testid="tab-trigger-${p.phase}"]`).filter({ visible: true }).first();
    await expectVisible('request.selectScriptPhase', `The "${p.phase}" script phase`, trigger, ctx.timeoutMs, 'Open the Script tab first (request.selectTab script, or collection.openSettings with tab script).');
    if (!(await trigger.evaluate((el) => el.classList.contains('active')).catch(() => false))) await ctx.cursor.click(trigger);
    const editor = ctx.page.locator(`[data-testid$="${p.phase}-script-editor"]`).filter({ visible: true }).first();
    await expectVisible('request.selectScriptPhase', `The ${p.phase} script editor`, editor, ctx.timeoutMs);
    ctx.log(`script phase ${p.phase}`);
  },
});

export const requestClone = defineAction({
  id: 'request.clone',
  description: 'Clone a request or folder from its sidebar "…" menu. The Clone dialog proposes "<name> copy"; newName replaces it. Waits for the clone to appear in the sidebar.',
  retryable: false, rung: 1,
  params: z.object({ name: z.string().min(1).describe('request or folder name as shown in the sidebar'), newName: z.string().min(1).optional() }),
  async execute(ctx, p) {
    await requestMenuItem.execute(ctx, { name: p.name, item: 'clone' });
    const modal = modalWith(ctx, 'clone-item-button');
    const input = modal.locator('input').first();
    await expectVisible('request.clone', 'The Clone dialog', input, ctx.timeoutMs);
    const target = p.newName ?? `${p.name} copy`;
    if (p.newName) {
      await ctx.cursor.click(input);
      await input.fill('');
      await input.pressSequentially(p.newName, { delay: 14 });
    }
    await ctx.cursor.click(modal.locator('[data-testid="clone-item-button"]'));
    try { await ctx.page.locator(SIDEBAR_ITEM, { hasText: target }).first().waitFor({ state: 'visible', timeout: ctx.timeoutMs }); }
    catch (e) { throw new ActionError('request.clone', `"${target}" did not appear in the sidebar`, 'Names must be unique within the same folder.', e); }
    ctx.log(`"${p.name}" cloned as "${target}"`);
  },
});

export const requestGenerateCode = defineAction({
  id: 'request.generateCode',
  description: 'Open the Generate Code dialog for a request (sidebar "…" → Generate Code); optionally pick a language (Shell, Python, JavaScript, Node.js, Go, Java, Ruby, PHP, Rust, Swift, …) and a variant button (Shell: curl, httpie, wget). Leaves the dialog open for a capture — close it with modal.close.',
  retryable: false, rung: 3,
  params: z.object({
    name: z.string().min(1).describe('request name as shown in the sidebar'),
    language: z.string().min(1).optional().describe('exact label from the language list, e.g. Shell, Python, Node.js'),
    library: z.string().min(1).optional().describe('variant button label for that language, e.g. curl, httpie, wget'),
  }),
  async execute(ctx, p) {
    await requestMenuItem.execute(ctx, { name: p.name, item: 'generate-code' });
    const modal = modalWith(ctx, 'interpolate-vars-toggle');
    await expectVisible('request.generateCode', 'The Generate Code dialog', modal, ctx.timeoutMs);
    if (p.language) {
      const select = modal.locator('select').first();
      await expectVisible('request.generateCode', 'The language selector', select, ctx.timeoutMs);
      try { await select.selectOption({ label: p.language }); }
      catch (e) { throw new ActionError('request.generateCode', `Language "${p.language}" is not offered`, `Available: ${CODEGEN_LANGUAGES.join(', ')}.`, e); }
      await ctx.page.waitForTimeout(250);
    }
    if (p.library) {
      const btn = modal.getByRole('button', { name: p.library, exact: true }).first();
      await expectVisible('request.generateCode', `The "${p.library}" variant button`, btn, ctx.timeoutMs, 'Variants depend on the language (Shell offers curl, httpie and wget).');
      await ctx.cursor.click(btn);
      await ctx.page.waitForTimeout(250);
    }
    ctx.log(`generate code for "${p.name}"${p.language ? ` · ${p.language}` : ''}${p.library ? ` · ${p.library}` : ''}`);
  },
});

export const AUTHORING_EXTRA_ACTIONS = [requestSelectScriptPhase, requestClone, requestGenerateCode];
