// S13b: runner folder run + result details, mock server create/start, import collection modal.
import { register } from 'tsx/esm/api'; register();
import fs from 'node:fs'; import path from 'node:path';
const { launchBruno, setContentSize, seedCaptureProfile, createDefaultActionRegistry, CursorController } = await import('../packages/automation/src/index.ts');
const scratch = process.env.SCRATCH;
const profile = path.join(scratch, 's13b-profile'); fs.rmSync(profile, { recursive: true, force: true });
const ws = path.join(scratch, 's13b-ws'); fs.rmSync(ws, { recursive: true, force: true }); fs.cpSync('fixtures/runner/basic-workspace', ws, { recursive: true });
const colDir = path.join(ws, 'collection');
fs.mkdirSync(path.join(colDir, 'Users')); fs.writeFileSync(path.join(colDir, 'Users', 'folder.yml'), 'info:\n  name: Users\n  type: folder\n  seq: 5\nrequest:\n  auth: inherit\n');
fs.renameSync(path.join(colDir, 'Get user.yml'), path.join(colDir, 'Users', 'Get user.yml'));
fs.renameSync(path.join(colDir, 'Get users.yml'), path.join(colDir, 'Users', 'Get users.yml'));
await seedCaptureProfile({ dir: profile, collections: [{ name: 'Bruno Capture Demo', path: colDir }], sidebarWidth: 220, selectedEnvironment: 'Demo', brunoVersion: '4.1.0' });
const s = await launchBruno({ executablePath: '/Applications/Bruno.app/Contents/MacOS/Bruno', profileMode: 'capture', captureProfileDir: profile });
await setContentSize(s, { width: 1600, height: 1000, x: 40, y: 60 });
const page = s.page; const J = (o, n = 2200) => JSON.stringify(o).slice(0, n);
const txt = (sel, n = 400) => page.evaluate(([sel, n]) => (document.querySelector(sel)?.innerText || '').replace(/\s+/g, ' ').slice(0, n), [sel, n]);
const dump = (sel, max = 40) => page.evaluate(([sel, max]) => [...document.querySelectorAll(sel)].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).slice(0, max).map(e => ({ tag: e.tagName.toLowerCase(), testid: e.getAttribute('data-testid'), role: e.getAttribute('role'), ph: e.getAttribute('placeholder'), title: e.getAttribute('title') || e.getAttribute('aria-label'), text: (e.innerText || e.value || '').trim().replace(/\s+/g, ' ').slice(0, 40) })), [sel, max]);
const ids = (root = 'body') => page.evaluate((root) => [...new Set([...document.querySelectorAll(`${root} [data-testid]`)].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).map(e => e.getAttribute('data-testid')))], root);
const modalIds = () => page.evaluate(() => [...new Set([...document.querySelectorAll('[class*="modal"] [data-testid], [role="dialog"] [data-testid]')].map(e => e.getAttribute('data-testid')))]);
const modalText = () => page.evaluate(() => (document.querySelector('[class*="modal"]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 500));
const stage = async (name, fn) => { try { await fn(); } catch (e) { console.log(`!! ${name} failed: ${String(e.message).split('\n')[0]}`); await page.screenshot({ path: `spikes/out/s13b-fail-${name}.png` }).catch(() => {}); await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(300); } };
const actions = createDefaultActionRegistry();
const ctx = { session: s, page, log: (m) => console.log('   ·', m), parameters: {}, timeoutMs: 20000, cursor: new CursorController(page, 'hidden') };
const A = (id, p = {}) => actions.get(id).execute(ctx, p);

await A('collection.open', { name: 'Bruno Capture Demo' });
await stage('runner-folder', async () => {
  console.log('F0 sidebar rows:', J(await dump('[data-testid="sidebar-collection-item-row"]', 8)));
  await A('request.menuItem', { name: 'Users', item: 'run' }); await page.waitForTimeout(700);
  console.log('F1 runner ids:', J(await ids()), 'text:', J(await txt('[data-testid="runner-config-panel"]', 400)));
  console.log('F2 runner controls:', J(await dump('[data-testid="runner-config-panel"] input, [data-testid="runner-config-panel"] button, [data-testid="runner-config-panel"] select, [data-testid="runner-request-item"]', 20)));
  await page.screenshot({ path: 'spikes/out/s13b-runner-folder.png' });
  await page.locator('[data-testid="runner-run-button"]').first().click(); await page.waitForTimeout(3000);
  console.log('F3 results:', J(await dump('[data-testid="runner-result-item"]', 6)), 'ids:', J((await ids()).filter(i => /runner|result/.test(i))));
  await page.locator('[data-testid="runner-result-item"]').first().click(); await page.waitForTimeout(600);
  console.log('F4 after clicking result — ids:', J((await ids()).filter(i => /runner|result|response|request|tab/.test(i))), 'text:', J(await txt('main', 600)));
  await page.screenshot({ path: 'spikes/out/s13b-runner-result-detail.png' });
});
await stage('mock-server', async () => {
  await A('collection.menuItem', { item: 'create-mock-server' }); await page.waitForTimeout(800);
  console.log('M1 mock ids:', J((await ids()).filter(i => /mock/.test(i))), 'modal ids:', J(await modalIds()), 'modal text:', J(await modalText()));
  console.log('M2 mock text:', J(await txt('main', 600)));
  await page.screenshot({ path: 'spikes/out/s13b-mock-1.png' });
  const create = page.locator('[data-testid="mock-servers-create-btn"], [class*="modal"] button[type="submit"]').filter({ visible: true }).first();
  if (await create.count()) { await create.click(); await page.waitForTimeout(1200); console.log('M3 after create — mock ids:', J((await ids()).filter(i => /mock/.test(i))), 'text:', J(await txt('[data-testid="mock-server-dashboard"]', 600))); }
  await page.screenshot({ path: 'spikes/out/s13b-mock-2.png' });
  const start = page.locator('[data-testid="mock-server-start-btn"], [data-testid="mock-response-start-server-btn"]').filter({ visible: true }).first();
  if (await start.count()) { await start.click(); await page.waitForTimeout(1500); console.log('M4 after start — status:', J(await txt('[data-testid="mock-server-status-text"]', 80)), 'url:', J(await dump('[data-testid="mock-server-copy-url"]', 2)), 'text:', J(await txt('[data-testid="mock-server-dashboard"]', 500)), 'ids:', J((await ids()).filter(i => /mock/.test(i)))); }
  await page.screenshot({ path: 'spikes/out/s13b-mock-3.png' });
  const stop = page.locator('[data-testid="mock-server-stop-btn"]').filter({ visible: true }).first(); if (await stop.count()) { await stop.click(); await page.waitForTimeout(600); }
  console.log('M5 files:', fs.readdirSync(colDir), fs.readdirSync(ws));
});
await stage('import', async () => {
  await page.locator('[data-testid="collections-header-add-menu"]').first().click(); await page.waitForTimeout(300);
  await page.locator('[data-testid="collections-header-add-menu-import"]').first().click(); await page.waitForTimeout(600);
  console.log('I1 import modal ids:', J(await modalIds()), 'text:', J(await modalText()), 'controls:', J(await dump('[class*="modal"] input, [class*="modal"] button, [class*="modal"] select, [class*="modal"] [role="button"]', 20)));
  await page.screenshot({ path: 'spikes/out/s13b-import-1.png' });
  const fileInput = page.locator('[class*="modal"] input[type="file"]').first();
  console.log('I2 file inputs:', await fileInput.count());
  if (await fileInput.count()) {
    await fileInput.setInputFiles(path.resolve('fixtures/openapi-sync/petstore/spec/openapi.yaml')); await page.waitForTimeout(1500);
    console.log('I3 after file — modal ids:', J(await modalIds()), 'text:', J(await modalText()), 'controls:', J(await dump('[class*="modal"] input, [class*="modal"] button, [class*="modal"] select', 20)));
    await page.screenshot({ path: 'spikes/out/s13b-import-2.png' });
    const loc = page.locator('[data-testid="bulk-import-collection-location-input"], [class*="modal"] input[type="text"]').filter({ visible: true }).first();
    if (await loc.count()) console.log('I4 location value:', J(await loc.inputValue().catch(() => '?')));
    const submit = page.locator('[class*="modal"] button', { hasText: /^import$/i }).filter({ visible: true }).first();
    if (await submit.count()) { await submit.click(); await page.waitForTimeout(2500); console.log('I5 after import — sidebar collections:', J(await dump('[data-testid="sidebar-collection-row"]', 5)), 'modal text:', J(await modalText()), 'toast/body:', J((await txt('body', 300)))); }
    await page.screenshot({ path: 'spikes/out/s13b-import-3.png' });
  }
  await page.keyboard.press('Escape');
});
await s.close?.().catch(() => {}); await s.app?.close?.().catch(() => {}); process.exit(0);
