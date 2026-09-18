import type { Locator, Page } from 'playwright';
import { z } from 'zod';
import { ActionError, defineAction, type ActionContext } from '../types.js';

/**
 * Phase 9 generic UI primitives — the D11 ladder as data. A target names ONE element by the most
 * stable handle available: `testId` (rung 1) › `role`+`name` / `text` / `label` / `placeholder`
 * (rung 3) › `css` (rung 6, counted as selector debt). `within` scopes the search to a container
 * test id; `index` picks among several visible matches. Hidden matches (Bruno keeps measurement
 * clones of tabs in the DOM) are always filtered out.
 */
export const UiTargetSchema = z.object({
  testId: z.string().min(1).optional().describe('data-testid of the element (preferred)'),
  role: z.string().min(1).optional().describe('ARIA role such as button, tab, menuitem, textbox; combine with name'),
  name: z.string().min(1).optional().describe('accessible name (aria-label, title or visible text) — substring, case-insensitive'),
  text: z.string().min(1).optional().describe('visible text the element contains (substring, case-insensitive) — for buttons/rows/menu items, not for inputs'),
  label: z.string().min(1).optional().describe('form control by its <label> text'),
  placeholder: z.string().min(1).optional().describe('input by placeholder text'),
  css: z.string().min(1).optional().describe('raw CSS selector — last resort, counted as debt'),
  within: z.string().min(1).optional().describe('data-testid of a container to search inside'),
  index: z.number().int().nonnegative().default(0).describe('which visible match to use when several match (0 = first)'),
});
export type UiTarget = z.infer<typeof UiTargetSchema>;

const HANDLE_KEYS = ['testId', 'role', 'text', 'label', 'placeholder', 'css'] as const;

export function describeTarget(t: UiTarget): string {
  const parts: string[] = [];
  if (t.testId) parts.push(`testId=${t.testId}`);
  if (t.role) parts.push(`role=${t.role}${t.name ? ` name~"${t.name}"` : ''}`);
  if (!t.role && t.name) parts.push(`name~"${t.name}"`);
  if (t.text) parts.push(`text~"${t.text}"`);
  if (t.label) parts.push(`label~"${t.label}"`);
  if (t.placeholder) parts.push(`placeholder~"${t.placeholder}"`);
  if (t.css) parts.push(`css=${t.css}`);
  if (t.within) parts.push(`within ${t.within}`);
  if (t.index) parts.push(`#${t.index}`);
  return parts.join(' ') || '(no handle)';
}

/** Build the Playwright locator for a target; throws an ActionError when the target names nothing. */
export function resolveUiTarget(page: Page, actionId: string, t: UiTarget): Locator {
  const handles = HANDLE_KEYS.filter((k) => t[k] !== undefined);
  if (handles.length === 0 && !t.name) throw new ActionError(actionId, 'The target needs one of testId, role+name, text, label, placeholder or css');
  const scope: Page | Locator = t.within ? page.getByTestId(t.within) : page;
  let loc: Locator;
  if (t.testId) loc = scope.getByTestId(t.testId);
  else if (t.role) loc = scope.getByRole(t.role as Parameters<Page['getByRole']>[0], t.name ? { name: new RegExp(escapeRe(t.name), 'i') } : {});
  else if (t.label) loc = scope.getByLabel(new RegExp(escapeRe(t.label), 'i'));
  else if (t.placeholder) loc = scope.getByPlaceholder(new RegExp(escapeRe(t.placeholder), 'i'));
  else if (t.text) loc = scope.getByText(new RegExp(escapeRe(t.text), 'i'));
  else if (t.css) loc = scope.locator(t.css);
  else loc = scope.locator(`[aria-label*="${cssEscape(t.name!)}" i], [title*="${cssEscape(t.name!)}" i]`);
  // A `text` handle combined with another handle narrows it (e.g. testId=sidebar-collection-item-row text="Get user").
  if (t.text && !(handles.length === 1 && handles[0] === 'text')) loc = loc.filter({ hasText: new RegExp(escapeRe(t.text), 'i') });
  return loc.filter({ visible: true }).nth(t.index);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cssEscape = (s: string) => s.replace(/["\\]/g, '\\$&');

async function locate(ctx: ActionContext, actionId: string, t: UiTarget, timeoutMs = Math.min(ctx.timeoutMs, 8000)): Promise<Locator> {
  const loc = resolveUiTarget(ctx.page, actionId, t);
  try {
    await loc.waitFor({ state: 'visible', timeout: timeoutMs });
  } catch (e) {
    const n = await resolveUiTarget(ctx.page, actionId, { ...t, index: 0 }).count().catch(() => 0);
    throw ActionError.notFound(actionId, `No visible element matches ${describeTarget(t)}${n && t.index >= n ? ` (only ${n} match${n === 1 ? '' : 'es'}, index ${t.index} asked)` : ''}`,
      'Check the target against what the UI currently shows (self-healing inspects it automatically).', e);
  }
  return loc;
}

/** CodeMirror editors (URL bar, body, header cells, auth fields) ignore `fill`; click then type. */
async function isCodeMirror(loc: Locator): Promise<boolean> {
  return loc.evaluate((el) => Boolean(el.closest('.CodeMirror') || el.querySelector('.CodeMirror'))).catch(() => false);
}
async function typeInto(ctx: ActionContext, loc: Locator, text: string, clear: boolean): Promise<void> {
  const cm = await isCodeMirror(loc);
  const tag = await loc.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
  if (!cm && (tag === 'input' || tag === 'textarea')) {
    await ctx.cursor.click(loc);
    if (clear) await loc.fill('');
    await loc.pressSequentially(text, { delay: 12 });
    return;
  }
  const inner = cm ? loc.locator('.CodeMirror').first().or(loc) : loc;
  await ctx.cursor.click(await inner.count() ? inner : loc);
  if (clear) { await ctx.page.keyboard.press('Meta+a'); await ctx.page.keyboard.press('Backspace'); }
  await ctx.page.keyboard.type(text, { delay: 12 });
}

const target = UiTargetSchema;

export const uiClick = defineAction({
  id: 'ui.click',
  description: 'Click an element (button, tab, menu item, row…). Prefer testId; menu items have ids like collection-actions-run, method-selector-post.',
  retryable: true, rung: 3,
  params: target.extend({ button: z.enum(['left', 'right']).default('left').describe('right = context menu'), double: z.boolean().default(false) }),
  async execute(ctx, p) {
    const loc = await locate(ctx, 'ui.click', p);
    if (p.button === 'right') { await ctx.cursor.hover(loc); await loc.click({ button: 'right' }); }
    else if (p.double) { await ctx.cursor.hover(loc); await loc.dblclick(); }
    else await ctx.cursor.click(loc);
    ctx.log(`clicked ${describeTarget(p)}`);
  },
});

export const uiHover = defineAction({
  id: 'ui.hover',
  description: 'Move the cursor over an element (reveals hover-only controls such as collection-actions).',
  retryable: true, rung: 3,
  params: target,
  async execute(ctx, p) { await ctx.cursor.hover(await locate(ctx, 'ui.hover', p)); ctx.log(`hovered ${describeTarget(p)}`); },
});

export const uiType = defineAction({
  id: 'ui.type',
  description: 'Click a field (target by testId/placeholder/label/css) and type `value` into it. Works for plain inputs AND CodeMirror editors (URL bar, body, header cells, auth fields). clear=true replaces existing content.',
  retryable: false, rung: 3,
  params: target.extend({ value: z.string().describe('the text to type'), clear: z.boolean().default(false), pressEnter: z.boolean().default(false) }),
  async execute(ctx, p) {
    const loc = await locate(ctx, 'ui.type', p);
    await typeInto(ctx, loc, p.value, p.clear);
    if (p.pressEnter) await ctx.page.keyboard.press('Enter');
    ctx.log(`typed ${JSON.stringify(p.value.length > 40 ? p.value.slice(0, 40) + '…' : p.value)} into ${describeTarget(p)}`);
  },
});

export const uiPress = defineAction({
  id: 'ui.press',
  description: 'Press a key or shortcut (Playwright names: Enter, Escape, Tab, Meta+s, Meta+Enter, ArrowDown). Optionally focus a target first.',
  retryable: false, rung: 4,
  params: z.object({ key: z.string().min(1), target: target.optional() }),
  async execute(ctx, p) {
    if (p.target) await ctx.cursor.click(await locate(ctx, 'ui.press', p.target));
    await ctx.page.keyboard.press(p.key);
    ctx.log(`pressed ${p.key}`);
  },
});

export const uiSelectOption = defineAction({
  id: 'ui.selectOption',
  description: 'Choose an option in a native <select> by visible label or value.',
  retryable: true, rung: 3,
  params: target.extend({ option: z.string().min(1) }),
  async execute(ctx, p) {
    const loc = await locate(ctx, 'ui.selectOption', p);
    try { await loc.selectOption({ label: p.option }); } catch { await loc.selectOption(p.option); }
    ctx.log(`selected ${p.option}`);
  },
});

export const uiWaitFor = defineAction({
  id: 'ui.waitFor',
  description: 'Wait until an element is visible (default) or hidden. Use after clicks that open panels/modals before capturing.',
  retryable: false, rung: 3,
  params: target.extend({ state: z.enum(['visible', 'hidden']).default('visible'), timeoutMs: z.number().int().positive().max(120_000).default(15_000) }),
  async execute(ctx, p) {
    const loc = resolveUiTarget(ctx.page, 'ui.waitFor', p);
    try {
      if (p.state === 'visible') await loc.waitFor({ state: 'visible', timeout: p.timeoutMs });
      else await resolveUiTarget(ctx.page, 'ui.waitFor', { ...p, index: 0 }).waitFor({ state: 'hidden', timeout: p.timeoutMs });
    } catch (e) {
      throw new ActionError('ui.waitFor', `${describeTarget(p)} did not become ${p.state} within ${Math.round(p.timeoutMs / 1000)} s`, undefined, e);
    }
    ctx.log(`${describeTarget(p)} ${p.state}`);
  },
});

export const uiWaitForText = defineAction({
  id: 'ui.waitForText',
  description: 'Wait until the page (or a container test id) shows some text. Case-insensitive substring.',
  retryable: false, rung: 3,
  params: z.object({ text: z.string().min(1), within: z.string().min(1).optional(), timeoutMs: z.number().int().positive().max(120_000).default(15_000) }),
  async execute(ctx, p) {
    const scope = p.within ? ctx.page.getByTestId(p.within).first() : ctx.page.locator('body');
    const deadline = Date.now() + p.timeoutMs;
    const want = p.text.toLowerCase();
    let last = '';
    while (Date.now() < deadline) {
      last = (await scope.innerText().catch(() => '')).replace(/\s+/g, ' ');
      if (last.toLowerCase().includes(want)) { ctx.log(`text "${p.text}" visible`); return; }
      await ctx.page.waitForTimeout(150);
    }
    throw new ActionError('ui.waitForText', `Text "${p.text}" did not appear within ${Math.round(p.timeoutMs / 1000)} s${last ? ` — the ${p.within ?? 'page'} shows: "${last.trim().slice(0, 160)}"` : ''}`);
  },
});

export const uiScrollIntoView = defineAction({
  id: 'ui.scrollIntoView',
  description: 'Scroll an element into view (long sidebars, tables).',
  retryable: true, rung: 3,
  params: target,
  async execute(ctx, p) { await (await locate(ctx, 'ui.scrollIntoView', p)).scrollIntoViewIfNeeded(); },
});

export const UI_ACTIONS = [uiClick, uiHover, uiType, uiPress, uiSelectOption, uiWaitFor, uiWaitForText, uiScrollIntoView];
