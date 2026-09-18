// S10b: body tab control, create-collection modal, folder modal, basic/apikey auth YAML.
import { register } from 'tsx/esm/api'; register();
import fs from 'node:fs'; import path from 'node:path';
const { launchBruno, setContentSize, seedCaptureProfile, createDefaultActionRegistry, CursorController } = await import('../packages/automation/src/index.ts');
const scratch = process.env.SCRATCH;
const profile = path.join(scratch, 's10b-profile'); fs.rmSync(profile, { recursive: true, force: true });
const ws = path.join(scratch, 's10b-ws'); fs.rmSync(ws, { recursive: true, force: true }); fs.cpSync('fixtures/request-execution/jsonplaceholder', ws, { recursive: true });
const colDir = path.join(ws, 'collection');
await seedCaptureProfile({ dir: profile, collections: [{ name: 'JSONPlaceholder', path: colDir }], sidebarWidth: 220, selectedEnvironment: 'Demo', brunoVersion: '4.1.0' });
const s = await launchBruno({ executablePath: '/Applications/Bruno.app/Contents/MacOS/Bruno', profileMode: 'capture', captureProfileDir: profile });
await setContentSize(s, { width: 1600, height: 1000, x: 40, y: 60 });
const page = s.page; const J = (o, n = 2000) => JSON.stringify(o).slice(0, n);
const dump = (sel, max = 40) => page.evaluate(([sel, max]) => [...document.querySelectorAll(sel)].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).slice(0, max).map(e => ({ tag: e.tagName.toLowerCase(), testid: e.getAttribute('data-testid'), role: e.getAttribute('role'), aria: e.getAttribute('aria-label'), ph: e.getAttribute('placeholder'), type: e.getAttribute('type'), cls: (e.className || '').toString().slice(0, 40), text: (e.innerText || e.value || '').trim().replace(/\s+/g, ' ').slice(0, 40) })), [sel, max]);
const stage = async (name, fn) => { try { await fn(); } catch (e) { console.log(`!! ${name} failed: ${String(e.message).split('\n')[0]}`); await page.screenshot({ path: `spikes/out/s10b-fail-${name}.png` }).catch(() => {}); await page.keyboard.press('Escape').catch(() => {}); } };
const actions = createDefaultActionRegistry();
const ctx = { session: s, page, log: () => {}, parameters: {}, timeoutMs: 15000, cursor: new CursorController(page, 'hidden') };
await actions.get('collection.open').execute(ctx, { name: 'JSONPlaceholder' });
await actions.get('request.open').execute(ctx, { name: 'Get user' });

await stage('body-tab', async () => {
  await page.locator('[data-testid="request-pane"] [data-testid="responsive-tab-body"]').filter({ visible: true }).first().click(); await page.waitForTimeout(500);
  console.log('1a. BODY tab visible ids:', J(await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-testid="request-pane"] [data-testid]')].filter(e => e.getBoundingClientRect().width > 0).map(e => e.getAttribute('data-testid')))])));
  console.log('1b. body controls:', J(await dump('[data-testid="request-pane"] button, [data-testid="request-pane"] select, [data-testid="request-pane"] [class*="body-mode"], [data-testid="request-pane"] .CodeMirror, [data-testid="request-pane"] [role="button"]', 20)));
  console.log('1c. body text:', J(await page.evaluate(() => (document.querySelector('[data-testid="request-pane"]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 300))));
  const modeBtn = page.locator('[data-testid="request-pane"] [class*="body-mode"] [class*="selector"], [data-testid="request-pane"] [class*="body-mode"]').first();
  console.log('1d. body mode selector:', await modeBtn.count(), J(await modeBtn.evaluate(e => ({ tag: e.tagName, cls: e.className, text: e.innerText.slice(0, 40), testid: e.getAttribute('data-testid') })).catch(() => 'n/a')));
  if (await modeBtn.count()) { await modeBtn.click(); await page.waitForTimeout(300); console.log('1e. body mode options:', J(await dump('[class*="tippy"] [data-testid], [role="menu"] [role="menuitem"], [class*="dropdown"] [role="menuitem"]', 30))); await page.screenshot({ path: 'spikes/out/s10b-body-modes.png' }); }
  const json = page.locator('[role="menuitem"]', { hasText: /^JSON$/ }).first();
  if (await json.count()) { await json.click(); await page.waitForTimeout(400); }
  console.log('1f. after JSON: editor:', J(await dump('[data-testid="request-body-editor"], [data-testid="request-pane"] .CodeMirror', 3)));
  const ed = page.locator('[data-testid="request-body-editor"]').first();
  if (await ed.count()) { await ed.locator('.CodeMirror').first().click(); await page.keyboard.press('Meta+a'); await page.keyboard.type('{"title": "spike"}'); await page.waitForTimeout(200); console.log('1g. body text now:', J(await ed.innerText())); }
});

await stage('basic-auth-save', async () => {
  await page.locator('[data-testid="request-pane"] [data-testid="responsive-tab-auth"]').filter({ visible: true }).first().click(); await page.waitForTimeout(300);
  await page.locator('[data-testid="auth-mode-selector"]').click(); await page.locator('[data-testid="auth-mode-dropdown-basic"]').click(); await page.waitForTimeout(400);
  console.log('2a. basic controls:', J(await dump('[data-testid="request-pane"] label, [data-testid="request-pane"] .CodeMirror, [data-testid="request-pane"] input', 10)));
  const eds = page.locator('[data-testid="request-pane"] .CodeMirror');
  await eds.nth(0).click(); await page.keyboard.type('alice'); await eds.nth(1).click(); await page.keyboard.type('s3cret');
  await page.keyboard.press('Meta+s'); await page.waitForTimeout(800);
  console.log('2b. YAML (basic):\n' + fs.readFileSync(path.join(colDir, 'Get user.yml'), 'utf8'));
  await page.locator('[data-testid="auth-mode-selector"]').click(); await page.locator('[data-testid="auth-mode-dropdown-apikey"]').click(); await page.waitForTimeout(400);
  console.log('2c. apikey controls:', J(await dump('[data-testid="request-pane"] label, [data-testid="request-pane"] .CodeMirror, [data-testid="request-pane"] input, [data-testid="request-pane"] [data-testid^="auth-placement"], [data-testid="request-pane"] [data-testid^="token"]', 14)));
  const eds2 = page.locator('[data-testid="request-pane"] .CodeMirror');
  await eds2.nth(0).click(); await page.keyboard.type('X-API-Key'); await eds2.nth(1).click(); await page.keyboard.type('key-123');
  await page.keyboard.press('Meta+s'); await page.waitForTimeout(800);
  console.log('2d. YAML (apikey):\n' + fs.readFileSync(path.join(colDir, 'Get user.yml'), 'utf8'));
  // headers + body persisted format: set a header on this request too
  await page.locator('[data-testid="request-pane"] [data-testid="responsive-tab-headers"]').filter({ visible: true }).first().click(); await page.waitForTimeout(300);
  const rows = page.locator('[data-testid="request-headers-table"] tbody tr');
  console.log('2e. header rows:', await rows.count());
  const last = rows.last();
  await last.locator('[data-testid="column-name"] .CodeMirror').click(); await page.keyboard.type('X-Trace'); await page.waitForTimeout(200);
  console.log('2f. rows after typing name:', await rows.count());
  await rows.nth(await rows.count() - 2).locator('[data-testid="column-value"] .CodeMirror').click(); await page.keyboard.type('abc'); await page.waitForTimeout(200);
  await page.keyboard.press('Meta+s'); await page.waitForTimeout(800);
  console.log('2g. YAML (headers):\n' + fs.readFileSync(path.join(colDir, 'Get user.yml'), 'utf8').split('\n').slice(0, 30).join('\n'));
  await page.screenshot({ path: 'spikes/out/s10b-headers.png' });
});

await stage('params-tab', async () => {
  await page.locator('[data-testid="request-pane"] [data-testid="responsive-tab-params"]').filter({ visible: true }).first().click(); await page.waitForTimeout(300);
  console.log('3. PARAMS ids:', J(await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-testid="request-pane"] [data-testid]')].filter(e => e.getBoundingClientRect().width > 0).map(e => e.getAttribute('data-testid')))])));
});

await stage('new-folder', async () => {
  const row = page.locator('[data-testid="sidebar-collection-row"]', { hasText: 'JSONPlaceholder' }).first();
  await row.hover(); await page.locator('[data-testid="collection-actions"]').first().click(); await page.locator('[data-testid="collection-actions-new-folder"]').click(); await page.waitForTimeout(500);
  console.log('4a. NEW FOLDER modal controls:', J(await dump('[class*="modal"] input, [class*="modal"] button, [class*="modal"] [data-testid]', 20)));
  await page.locator('[class*="modal"] input').first().fill('Spike folder');
  await page.locator('[class*="modal"] button[type="submit"]').first().click(); await page.waitForTimeout(800);
  console.log('4b. folder created on disk:', fs.readdirSync(colDir), '| sidebar rows with folder:', J(await dump('[data-testid="sidebar-collection-item-row"]', 10)));
});

await stage('create-collection', async () => {
  await page.locator('[data-testid="collections-header-add-menu"]').first().click(); await page.locator('[data-testid="collections-header-add-menu-create"]').click(); await page.waitForTimeout(600);
  console.log('5a. CREATE COLLECTION modal controls:', J(await dump('[class*="modal"] input, [class*="modal"] button, [class*="modal"] select, [class*="modal"] [data-testid], [class*="modal"] label', 30)));
  console.log('5b. modal text:', J(await page.evaluate(() => (document.querySelector('[class*="modal"]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 500))));
  await page.screenshot({ path: 'spikes/out/s10b-create-collection.png' });
  const inputs = page.locator('[class*="modal"] input');
  console.log('5c. inputs:', await inputs.count(), J(await inputs.evaluateAll(list => list.map(e => ({ type: e.type, testid: e.getAttribute('data-testid'), ph: e.placeholder, value: e.value, readonly: e.readOnly, name: e.name })))));
  await inputs.first().fill('Spike Collection');
  await page.waitForTimeout(200);
  console.log('5d. inputs after name:', J(await inputs.evaluateAll(list => list.map(e => ({ testid: e.getAttribute('data-testid'), value: e.value })))));
  await page.locator('[class*="modal"] button[type="submit"], [class*="modal"] button', { hasText: /^Create$/ }).first().click(); await page.waitForTimeout(1500);
  console.log('5e. rows:', J(await dump('[data-testid="sidebar-collection-row"]', 5)), '| profile/collections:', fs.existsSync(path.join(profile, 'collections')) ? fs.readdirSync(path.join(profile, 'collections')) : 'none', '| modal still open?', await page.locator('[class*="modal"]').first().isVisible().catch(() => false));
  console.log('5f. body text:', J(await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 400))));
  await page.screenshot({ path: 'spikes/out/s10b-after-create-collection.png' });
});

await stage('collection-settings', async () => {
  const row = page.locator('[data-testid="sidebar-collection-row"]', { hasText: 'JSONPlaceholder' }).first();
  await row.hover(); await page.locator('[data-testid="collection-actions"]').first().click(); await page.locator('[data-testid="collection-actions-settings"]').click(); await page.waitForTimeout(600);
  console.log('6. SETTINGS tab ids:', J(await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-testid]')].filter(e => e.getBoundingClientRect().width > 0).map(e => e.getAttribute('data-testid')).filter(id => /settings|collection|tab/.test(id)))])));
  await page.screenshot({ path: 'spikes/out/s10b-collection-settings.png' });
});
await s.close();
