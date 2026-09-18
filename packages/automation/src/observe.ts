import type { Page } from 'playwright';
import type { PageObservation } from '@bruno-capture/shared';
export type { PageObservation, ObservedElement } from '@bruno-capture/shared';
export { formatObservation } from '@bruno-capture/shared';

const INTERACTIVE = 'button, a[href], input, select, textarea, [role], [data-testid], [contenteditable="true"], .CodeMirror, [tabindex]:not([tabindex="-1"])';

/**
 * Phase 9: what the self-healer is shown about the live UI — visible interactive elements with their
 * handles (test id, role, accessible name, text), whether a modal is open, and the main text. The
 * script is a plain string so no loader transform (tsx/esbuild `__name` helpers) can leak into the page.
 */
export async function observePage(page: Page, opts: { maxElements?: number } = {}): Promise<PageObservation> {
  const max = opts.maxElements ?? 220;
  const script = `(function () {
    var sel = ${JSON.stringify(INTERACTIVE)}, max = ${Number(max)};
    var out = [], truncated = false;
    function vis(el) {
      var r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
      var cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    }
    function clean(s) { return (s || '').replace(/\\u200b/g, '').replace(/\\s+/g, ' ').trim(); }
    var all = document.querySelectorAll(sel);
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (!vis(el)) continue;
      var testId = el.getAttribute('data-testid') || undefined;
      var role = el.getAttribute('role') || undefined;
      var tag = el.tagName.toLowerCase();
      var isEditor = el.classList.contains('CodeMirror') || el.getAttribute('contenteditable') === 'true';
      if (!testId && !role && ['button', 'a', 'input', 'select', 'textarea'].indexOf(tag) < 0 && !isEditor) continue;
      var name = clean(el.getAttribute('aria-label') || el.getAttribute('title') || '') || undefined;
      var text = clean(el.innerText || el.value || '').slice(0, 60) || undefined;
      var placeholder = clean(el.getAttribute('placeholder')) || undefined;
      var disabled = el.disabled || el.getAttribute('aria-disabled') === 'true' || undefined;
      var selected = el.classList.contains('active') || el.getAttribute('aria-selected') === 'true' || el.classList.contains('dropdown-item-active') || undefined;
      out.push({ tag: tag, testId: testId, role: role, name: name, text: isEditor ? undefined : text, placeholder: placeholder, disabled: disabled, selected: selected, editor: isEditor || undefined });
      if (out.length >= max) { truncated = true; break; }
    }
    var modal = document.querySelector('[data-testid="simple-modal-overlay"], .bruno-modal, [role="dialog"]');
    var modalOpen = !!(modal && vis(modal));
    var main = document.querySelector('[data-testid="request-pane"], [data-testid="runner"], main, #root') || document.body;
    return { elements: out, truncated: truncated, modalOpen: modalOpen, text: clean(main.innerText).slice(0, 800) };
  })()`;
  const raw = (await page.evaluate(script)) as Omit<PageObservation, 'at'>;
  return { at: new Date().toISOString(), ...raw };
}
