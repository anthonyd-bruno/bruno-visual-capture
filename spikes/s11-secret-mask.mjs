// S11: how does Bruno mask auth secrets, and what un-masks them? (bearer token field)
import { register } from 'tsx/esm/api'; register();
import fs from 'node:fs'; import path from 'node:path';
const { launchBruno, setContentSize, seedCaptureProfile, createDefaultActionRegistry, CursorController } = await import('../packages/automation/src/index.ts');
const scratch = process.env.SCRATCH;
const profile = path.join(scratch, 's11-profile'); fs.rmSync(profile, { recursive: true, force: true });
const ws = path.join(scratch, 's11-ws'); fs.rmSync(ws, { recursive: true, force: true }); fs.cpSync('fixtures/request-execution/jsonplaceholder', ws, { recursive: true });
await seedCaptureProfile({ dir: profile, collections: [{ name: 'JSONPlaceholder', path: path.join(ws, 'collection') }], sidebarWidth: 220, selectedEnvironment: 'Demo', brunoVersion: '4.1.0' });
const s = await launchBruno({ executablePath: '/Applications/Bruno.app/Contents/MacOS/Bruno', profileMode: 'capture', captureProfileDir: profile });
await setContentSize(s, { width: 1600, height: 1000, x: 40, y: 60 });
const page = s.page; const J = (o, n = 1500) => JSON.stringify(o).slice(0, n);
const dump = (sel, max = 30) => page.evaluate(([sel, max]) => [...document.querySelectorAll(sel)].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).slice(0, max).map(e => ({ tag: e.tagName.toLowerCase(), testid: e.getAttribute('data-testid'), role: e.getAttribute('role'), aria: e.getAttribute('aria-label'), title: e.getAttribute('title'), cls: (e.className || '').toString().slice(0, 50), text: (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40) })), [sel, max]);
const actions = createDefaultActionRegistry();
const ctx = { session: s, page, log: () => {}, parameters: {}, timeoutMs: 15000, cursor: new CursorController(page, 'hidden') };
await actions.get('collection.open').execute(ctx, { name: 'JSONPlaceholder' });
await actions.get('request.open').execute(ctx, { name: 'Get user' });
await actions.get('request.setAuth').execute(ctx, { mode: 'bearer', token: 'eyJhbGciOiJIUzI1NiJ9.demo-token' });
await page.waitForTimeout(400);
const tokenCM = page.locator('[data-testid="request-pane"] .CodeMirror').first();
console.log('1. token editor text:', J(await tokenCM.innerText()), '| class:', J(await tokenCM.evaluate(e => e.className)));
console.log('2. controls near the field:', J(await dump('[data-testid="request-pane"] [data-testid*="secret"], [data-testid="request-pane"] [data-testid*="reveal"], [data-testid="request-pane"] button, [data-testid="request-pane"] svg[class*="eye"], [data-testid="request-pane"] [class*="eye"], [data-testid="request-pane"] [class*="mask"], [data-testid="request-pane"] [class*="secret"]', 20)));
console.log('3. masked chars in DOM?', J(await page.evaluate(() => { const cm = document.querySelector('[data-testid="request-pane"] .CodeMirror'); return { text: cm?.innerText.slice(0, 60), hasMaskClass: !!cm?.querMaskProbe, cmClasses: [...(cm?.classList || [])], lineHtml: cm?.querySelector('.CodeMirror-line')?.innerHTML.slice(0, 300) }; })));
await page.screenshot({ path: 'spikes/out/s11-masked.png' });
const toggle = page.locator('[data-testid="secret-reveal-toggle"]').first();
console.log('4. secret-reveal-toggle count:', await toggle.count(), J(await toggle.evaluate(e => ({ tag: e.tagName, cls: e.className, title: e.title, aria: e.getAttribute('aria-label') })).catch(() => 'n/a')));
if (await toggle.count()) { await toggle.click(); await page.waitForTimeout(300); console.log('5. after toggle: text:', J(await tokenCM.innerText()), 'line html:', J(await page.evaluate(() => document.querySelector('[data-testid="request-pane"] .CodeMirror .CodeMirror-line')?.innerHTML.slice(0, 200)))); await page.screenshot({ path: 'spikes/out/s11-revealed.png' }); }
// basic auth password field?
await actions.get('request.setAuth').execute(ctx, { mode: 'basic', username: 'alice', password: 's3cret' });
await page.waitForTimeout(300);
console.log('6. basic fields text:', J(await page.locator('[data-testid="request-pane"] .CodeMirror').evaluateAll(list => list.map(e => e.innerText.replace(/​/g, '').trim()))), '| toggles:', await page.locator('[data-testid="secret-reveal-toggle"]').count());
await s.close();
