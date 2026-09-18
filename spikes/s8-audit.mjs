// Phase 8 audit: Timeline entry point after a response, response-pane tabs, and the OpenAPI sync modal.
import { register } from 'tsx/esm/api'; register();
import fs from 'node:fs'; import path from 'node:path';
const { launchBruno, setContentSize, seedCaptureProfile, createDefaultActionRegistry, CursorController } = await import('../packages/automation/src/index.ts');
const scratch = process.env.SCRATCH;
const profile = path.join(scratch, 'audit-profile'); fs.rmSync(profile, { recursive: true, force: true });
const ws = path.join(scratch, 'audit-ws'); fs.rmSync(ws, { recursive: true, force: true }); fs.cpSync('fixtures/runner/basic-workspace', ws, { recursive: true });
await seedCaptureProfile({ dir: profile, collections: [{ name: 'Bruno Capture Demo', path: path.join(ws, 'collection') }], sidebarWidth: 220, selectedEnvironment: 'Demo', brunoVersion: '4.1.0' });
const s = await launchBruno({ executablePath: '/Applications/Bruno.app/Contents/MacOS/Bruno', profileMode: 'capture', captureProfileDir: profile });
await setContentSize(s, { width: 1600, height: 1000, x: 40, y: 60 });
const page = s.page; const J = (o, n = 1800) => JSON.stringify(o).slice(0, n);
const dump = (sel, max = 40) => page.evaluate(([sel, max]) => [...document.querySelectorAll(sel)].slice(0, max).map(e => ({ tag: e.tagName.toLowerCase(), testid: e.getAttribute('data-testid'), role: e.getAttribute('role'), aria: e.getAttribute('aria-label'), title: e.getAttribute('title'), cls: (e.className || '').toString().slice(0, 40), text: (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 30) })), [sel, max]);
const actions = createDefaultActionRegistry();
const ctx = { session: s, page, log: () => {}, parameters: {}, timeoutMs: 15000, cursor: new CursorController(page, 'hidden') };
await actions.get('collection.open').execute(ctx, { name: 'Bruno Capture Demo' });
await actions.get('request.open').execute(ctx, { name: 'Get user' });
console.log('1. REQUEST PANE tabs:', J(await dump('[data-testid="request-pane"] [role="tab"], [data-testid="request-pane"] [class*="tab"]:not([class*="tabs"])', 20)));
await actions.get('request.send').execute(ctx, {});
await page.waitForTimeout(800);
console.log('2. RESPONSE PANE tabs/controls:', J(await dump('[data-testid="response-pane"] [role="tab"], [data-testid="response-pane"] [class*="tab"]:not([class*="tabs"]), [data-testid="response-pane"] [data-testid]', 40)));
await page.locator('[data-testid="responsive-tab-timeline"]').click(); await page.waitForTimeout(700);
console.log('3. after responsive-tab-timeline: timeline-container visible?', await page.locator('[data-testid="timeline-container"]').isVisible().catch(() => false), '| timeline ids:', J(await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-testid^="timeline"]')].map(e => e.getAttribute('data-testid')))])), '| entries:', await page.locator('[data-testid="timeline-item"], [data-testid="timeline-entry"]').count());
await page.screenshot({ path: 'spikes/out/s8-timeline.png' });
await page.locator('[data-testid="responsive-tab-response"]').click().catch(() => {});
// devtools timeline?
await page.locator('[data-testid="toggle-devtools-button"]').click().catch(() => {}); await page.waitForTimeout(600);
console.log('4. DEVTOOLS tabs:', J(await dump('[class*="devtools"] [role="tab"], [class*="devtools"] button, [data-testid^="devtools"], [class*="DevTools"] button', 30)));
await page.locator('[data-testid="toggle-devtools-button"]').click().catch(() => {}); await page.waitForTimeout(300);
// OpenAPI sync modal
const row = page.locator('[data-testid="sidebar-collection-row"]', { hasText: 'Bruno Capture Demo' }).first();
await row.hover(); await page.locator('[data-testid="collection-actions"]').first().click(); await page.locator('[data-testid="collection-actions-sync-openapi"]').click(); await page.waitForTimeout(800);
console.log('5. OPENAPI SYNC modal ids:', J(await page.evaluate(() => [...new Set([...document.querySelectorAll('[class*="modal"] [data-testid], [role="dialog"] [data-testid]')].map(e => e.getAttribute('data-testid')))])));
console.log('   modal text:', J(await page.evaluate(() => (document.querySelector('[class*="modal"], [role="dialog"]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 600))));
console.log('   modal buttons/inputs:', J(await dump('[class*="modal"] button, [class*="modal"] input, [class*="modal"] select, [role="dialog"] button, [role="dialog"] input', 30)));
await page.screenshot({ path: 'spikes/out/s8-openapi-modal.png' });
await page.keyboard.press('Escape');
// environment selector open state + editor
await page.locator('[data-testid="environment-selector-trigger"]').click(); await page.waitForTimeout(400);
console.log('6. ENV dropdown open ids:', J(await dump('[data-testid^="env-"], [data-testid="configure-env"]', 20)));
await page.locator('[data-testid="configure-env"]').click(); await page.waitForTimeout(700);
console.log('7. ENV editor ids:', J(await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid')).filter(id => /env|modal|save|var/.test(id)))])));
await page.screenshot({ path: 'spikes/out/s8-env-editor.png' });
await s.close();
