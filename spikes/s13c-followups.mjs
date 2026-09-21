// S13c: collection menu inventory (mock server?), preferences surface, create-environment flow, example save + sidebar,
// runner result details + folder-run modal, folder-level headers YAML, dev tools panel.
import { register } from 'tsx/esm/api'; register();
import fs from 'node:fs'; import path from 'node:path';
const { launchBruno, setContentSize, seedCaptureProfile, createDefaultActionRegistry, CursorController } = await import('../packages/automation/src/index.ts');
const scratch = process.env.SCRATCH;
const profile = path.join(scratch, 's13c-profile'); fs.rmSync(profile, { recursive: true, force: true });
const ws = path.join(scratch, 's13c-ws'); fs.rmSync(ws, { recursive: true, force: true }); fs.cpSync('fixtures/runner/basic-workspace', ws, { recursive: true });
const colDir = path.join(ws, 'collection');
fs.mkdirSync(path.join(colDir, 'Users')); fs.writeFileSync(path.join(colDir, 'Users', 'folder.yml'), 'info:\n  name: Users\n  type: folder\n  seq: 5\nrequest:\n  auth: inherit\n');
fs.renameSync(path.join(colDir, 'Get user.yml'), path.join(colDir, 'Users', 'Get user.yml'));
await seedCaptureProfile({ dir: profile, collections: [{ name: 'Bruno Capture Demo', path: colDir }], sidebarWidth: 220, selectedEnvironment: 'Demo', brunoVersion: '4.1.0' });
const s = await launchBruno({ executablePath: '/Applications/Bruno.app/Contents/MacOS/Bruno', profileMode: 'capture', captureProfileDir: profile });
await setContentSize(s, { width: 1600, height: 1000, x: 40, y: 60 });
const page = s.page; const J = (o, n = 2000) => JSON.stringify(o).slice(0, n);
const txt = (sel, n = 400) => page.evaluate(([sel, n]) => (document.querySelector(sel)?.innerText || '').replace(/\s+/g, ' ').slice(0, n), [sel, n]);
const dump = (sel, max = 40) => page.evaluate(([sel, max]) => [...document.querySelectorAll(sel)].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).slice(0, max).map(e => ({ tag: e.tagName.toLowerCase(), testid: e.getAttribute('data-testid'), role: e.getAttribute('role'), ph: e.getAttribute('placeholder'), title: e.getAttribute('title') || e.getAttribute('aria-label'), text: (e.innerText || e.value || '').trim().replace(/\s+/g, ' ').slice(0, 40) })), [sel, max]);
const ids = (root = 'body') => page.evaluate((root) => [...new Set([...document.querySelectorAll(`${root} [data-testid]`)].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).map(e => e.getAttribute('data-testid')))], root);
const modalIds = () => page.evaluate(() => [...new Set([...document.querySelectorAll('[class*="modal"] [data-testid], [role="dialog"] [data-testid]')].map(e => e.getAttribute('data-testid')))]);
const modalText = () => page.evaluate(() => (document.querySelector('[class*="modal"]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 500));
const stage = async (name, fn) => { try { await fn(); } catch (e) { console.log(`!! ${name} failed: ${String(e.message).split('\n')[0]}`); await page.screenshot({ path: `spikes/out/s13c-fail-${name}.png` }).catch(() => {}); await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(300); } };
const actions = createDefaultActionRegistry();
const ctx = { session: s, page, log: (m) => console.log('   ·', m), parameters: {}, timeoutMs: 20000, cursor: new CursorController(page, 'hidden') };
const A = (id, p = {}) => actions.get(id).execute(ctx, p);
const baseIds = new Set(await ids());
const newIds = async () => (await ids()).filter(i => !baseIds.has(i));

await A('collection.open', { name: 'Bruno Capture Demo' });
await stage('collection-menu', async () => {
  const row = page.locator('[data-testid="sidebar-collection-row"]').first(); await row.hover(); await page.locator('[data-testid="collection-actions"]').first().click(); await page.waitForTimeout(300);
  console.log('C1 collection menu items:', J(await dump('[data-testid^="collection-actions-"]', 30).then(a => a.map(x => x.testid + ':' + x.text))));
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await page.locator('[data-testid="collections-header-actions-menu"]').first().click(); await page.waitForTimeout(300);
  console.log('C2 collections header actions menu:', J(await dump('[role="menuitem"], [data-testid^="collections-header-actions-menu-"]', 20).then(a => a.map(x => x.testid + ':' + x.text))));
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await page.locator('[data-testid="workspace-menu"]').first().click(); await page.waitForTimeout(300);
  console.log('C3 workspace menu:', J(await dump('[role="menuitem"], [data-testid^="workspace-menu-"]', 20).then(a => a.map(x => x.testid + ':' + x.text))));
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
});
await stage('preferences', async () => {
  await page.getByRole('button', { name: /preferences/i }).first().click(); await page.waitForTimeout(700);
  console.log('P1 new ids:', J(await newIds()), 'tabs:', J(await dump('[role="tab"], [class*="tab"] > div, nav button', 30).then(a => a.filter(x => x.text).map(x => (x.testid || '-') + ':' + x.text))));
  console.log('P2 text:', J(await txt('body', 600)));
  await page.screenshot({ path: 'spikes/out/s13c-preferences.png' });
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
});
await stage('env-create', async () => {
  await A('environment.openEditor'); await page.waitForTimeout(400);
  await page.locator('button[title="Create environment"]').first().click(); await page.waitForTimeout(500);
  console.log('E1 after Create environment — modal ids:', J(await modalIds()), 'text:', J(await modalText()), 'new ids:', J(await newIds()), 'focused input:', J(await dump('input:focus, [class*="modal"] input', 4)));
  await page.screenshot({ path: 'spikes/out/s13c-env-create.png' });
  const inp = page.locator('[class*="modal"] input, input:focus').filter({ visible: true }).first();
  if (await inp.count()) { await inp.fill('Staging'); await page.keyboard.press('Enter'); await page.waitForTimeout(800); }
  console.log('E2 env files:', fs.readdirSync(path.join(colDir, 'environments')), 'env tabs/text:', J(await txt('body', 400)));
  console.log('E3 var inputs:', J(await dump('[data-testid="env-var-name-input"], [data-testid^="test-multiline-editor"], [data-testid="save-env"]', 8)));
  const nameIn = page.locator('[data-testid="env-var-name-input"]').filter({ visible: true }).last();
  if (await nameIn.count()) { await nameIn.click(); await page.keyboard.type('baseUrl', { delay: 8 }); await page.waitForTimeout(300); const valCm = page.locator('[data-testid="env-var-row-baseUrl"] .CodeMirror').first(); await valCm.click(); await page.keyboard.type('https://staging.example.com', { delay: 5 }); await page.locator('[data-testid="save-env"]').first().click(); await page.waitForTimeout(800); }
  console.log('E4 env files after save:', fs.readdirSync(path.join(colDir, 'environments')).map(f => f + ': ' + fs.readFileSync(path.join(colDir, 'environments', f), 'utf8').replace(/\n/g, ' ')));
  await page.screenshot({ path: 'spikes/out/s13c-env-staging.png' });
  await A('modal.close').catch(() => page.keyboard.press('Escape'));
  await page.waitForTimeout(300); console.log('E5 selector text:', J(await txt('[data-testid="environment-selector-trigger"]', 40)));
});
await stage('example-save', async () => {
  await A('request.open', { name: 'Get albums' }); await A('request.send'); await page.waitForTimeout(400);
  await A('request.menuItem', { name: 'Get albums', item: 'create-example' }); await page.waitForTimeout(400);
  await page.locator('[data-testid="create-example-name-input"]').fill('Albums 200'); await page.locator('[data-testid="modal-submit-btn"]').click(); await page.waitForTimeout(800);
  console.log('X1 example editor ids:', J((await ids()).filter(i => /example|status|tab-/.test(i))), 'text:', J(await txt('main', 300)));
  const save = page.locator('[data-testid="response-example-save-btn"]').first(); if (await save.count()) { await save.click(); await page.waitForTimeout(600); }
  console.log('X2 sidebar rows:', J(await dump('[data-testid="sidebar-collection-item-row"], [data-testid="sidebar-response-example-item"], [data-testid="request-item-chevron"]', 12)));
  const chev = page.locator('[data-testid="sidebar-collection-item-row"]', { hasText: 'Get albums' }).locator('[data-testid="request-item-chevron"]').first();
  if (await chev.count()) { await chev.click(); await page.waitForTimeout(400); console.log('X3 after chevron:', J(await dump('[data-testid="sidebar-response-example-item"]', 5))); }
  await page.screenshot({ path: 'spikes/out/s13c-example.png' });
});
await stage('runner-details', async () => {
  await A('runner.open'); await A('runner.runCollection'); await A('runner.waitComplete', { timeoutMs: 60000 }); await page.waitForTimeout(500);
  console.log('R1 result items:', J(await dump('[data-testid="runner-result-item"]', 6)));
  await page.locator('[data-testid="runner-result-item"]').first().click(); await page.waitForTimeout(700);
  console.log('R2 after click — new ids:', J(await newIds()), 'text:', J(await txt('main', 700)));
  await page.screenshot({ path: 'spikes/out/s13c-runner-detail.png' });
});
await stage('folder-run-modal', async () => {
  await A('request.menuItem', { name: 'Users', item: 'run' }); await page.waitForTimeout(600);
  console.log('FR1 modal ids:', J(await modalIds()), 'text:', J(await modalText()), 'buttons:', J(await dump('[class*="modal"] button', 10)));
  await page.screenshot({ path: 'spikes/out/s13c-folder-run.png' });
  const run = page.locator('[class*="modal"] button', { hasText: /run/i }).first(); if (await run.count()) { await run.click(); await page.waitForTimeout(3000); console.log('FR2 after run — text:', J(await txt('main', 400))); }
  await page.keyboard.press('Escape');
});
await stage('folder-headers-yaml', async () => {
  await A('folder.openSettings', { name: 'Users', tab: 'headers' }); await page.waitForTimeout(400);
  const table = page.locator('[data-testid="editable-table"]').filter({ visible: true }).first();
  await table.locator('tbody tr').last().locator('[data-testid="column-name"] .CodeMirror, [data-testid="column-name"] input').first().click(); await page.keyboard.type('X-Folder', { delay: 5 }); await page.waitForTimeout(300);
  const n = await table.locator('tbody tr').count(); const v = table.locator('tbody tr').nth(n - 2).locator('[data-testid="column-value"] .CodeMirror, [data-testid="column-value"] input').first(); await v.click(); await page.keyboard.type('users', { delay: 5 });
  await page.keyboard.press('Meta+s'); await page.waitForTimeout(800);
  console.log('FH1 folder.yml:\n' + fs.readFileSync(path.join(colDir, 'Users', 'folder.yml'), 'utf8'));
});
await stage('devtools', async () => {
  await page.locator('[data-testid="toggle-devtools-button"]').first().click(); await page.waitForTimeout(700);
  console.log('D1 new ids:', J(await newIds()));
  console.log('D2 bottom panel candidates:', J(await page.evaluate(() => [...document.querySelectorAll('div')].filter(e => { const r = e.getBoundingClientRect(); return r.height > 120 && r.height < 600 && r.width > 800 && r.top > 400 && /Console|Network|Logs/.test(e.innerText || ''); }).slice(0, 3).map(e => ({ cls: (e.className || '').toString().slice(0, 60), testid: e.getAttribute('data-testid'), text: e.innerText.replace(/\s+/g, ' ').slice(0, 200) })))));
  await page.screenshot({ path: 'spikes/out/s13c-devtools.png' });
});
await s.close?.().catch(() => {}); await s.app?.close?.().catch(() => {}); process.exit(0);
