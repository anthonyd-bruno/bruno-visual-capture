// S10 (Phase 9 measurement): request/collection authoring surfaces + the YAML Bruno writes for them.
import { register } from 'tsx/esm/api'; register();
import fs from 'node:fs'; import path from 'node:path';
const { launchBruno, setContentSize, seedCaptureProfile, createDefaultActionRegistry, CursorController } = await import('../packages/automation/src/index.ts');
const scratch = process.env.SCRATCH;
const profile = path.join(scratch, 's10-profile'); fs.rmSync(profile, { recursive: true, force: true });
const ws = path.join(scratch, 's10-ws'); fs.rmSync(ws, { recursive: true, force: true }); fs.cpSync('fixtures/request-execution/jsonplaceholder', ws, { recursive: true });
const colDir = path.join(ws, 'collection');
await seedCaptureProfile({ dir: profile, collections: [{ name: 'JSONPlaceholder', path: colDir }], sidebarWidth: 220, selectedEnvironment: 'Demo', brunoVersion: '4.1.0' });
const s = await launchBruno({ executablePath: '/Applications/Bruno.app/Contents/MacOS/Bruno', profileMode: 'capture', captureProfileDir: profile });
await setContentSize(s, { width: 1600, height: 1000, x: 40, y: 60 });
const page = s.page; const J = (o, n = 2200) => JSON.stringify(o).slice(0, n);
const dump = (sel, max = 40) => page.evaluate(([sel, max]) => [...document.querySelectorAll(sel)].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).slice(0, max).map(e => ({ tag: e.tagName.toLowerCase(), testid: e.getAttribute('data-testid'), role: e.getAttribute('role'), aria: e.getAttribute('aria-label'), ph: e.getAttribute('placeholder'), type: e.getAttribute('type'), cls: (e.className || '').toString().slice(0, 50), text: (e.innerText || e.value || '').trim().replace(/\s+/g, ' ').slice(0, 40) })), [sel, max]);
const stage = async (name, fn) => { try { await fn(); } catch (e) { console.log(`!! ${name} failed: ${String(e.message).split('\n')[0]}`); await page.screenshot({ path: `spikes/out/s10-fail-${name}.png` }).catch(() => {}); await page.keyboard.press('Escape').catch(() => {}); } };
const actions = createDefaultActionRegistry();
const ctx = { session: s, page, log: () => {}, parameters: {}, timeoutMs: 15000, cursor: new CursorController(page, 'hidden') };
await actions.get('collection.open').execute(ctx, { name: 'JSONPlaceholder' });

await stage('new-request-modal', async () => {
  const row = page.locator('[data-testid="sidebar-collection-row"]', { hasText: 'JSONPlaceholder' }).first();
  await row.hover(); await page.locator('[data-testid="collection-actions"]').first().click();
  console.log('1a. menu items roles:', J(await dump('[data-testid^="collection-actions-"]', 30)));
  await page.locator('[data-testid="collection-actions-new-request"]').click(); await page.waitForTimeout(600);
  console.log('1b. NEW REQUEST modal ids:', J(await page.evaluate(() => [...new Set([...document.querySelectorAll('[class*="modal"] [data-testid], [role="dialog"] [data-testid]')].map(e => e.getAttribute('data-testid')))])));
  console.log('1c. modal controls:', J(await dump('[class*="modal"] input, [class*="modal"] button, [class*="modal"] select, [class*="modal"] [role="button"], [class*="modal"] .CodeMirror, [class*="modal"] [contenteditable]', 40)));
  console.log('1d. modal text:', J(await page.evaluate(() => (document.querySelector('[class*="modal"]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 500))));
  await page.screenshot({ path: 'spikes/out/s10-new-request.png' });
  // fill name
  const nameInput = page.locator('[class*="modal"] input[type="text"], [class*="modal"] input:not([type])').first();
  await nameInput.fill('Spike request');
  // URL field: CodeMirror or input?
  const urlCM = page.locator('[class*="modal"] [data-testid="new-request-url"]').first();
  console.log('1e. new-request-url exists:', await urlCM.count(), 'tag/class:', J(await urlCM.evaluate(e => ({ tag: e.tagName, cls: e.className, cm: !!e.querySelector('.CodeMirror'), input: !!e.querySelector('input') })).catch(() => 'n/a')));
  if (await urlCM.count()) { await urlCM.click(); await page.keyboard.type('{{baseUrl}}/comments/1'); }
  console.log('1f. url after typing:', J(await urlCM.innerText().catch(() => '?')));
  await page.screenshot({ path: 'spikes/out/s10-new-request-filled.png' });
  const create = page.locator('[class*="modal"] button', { hasText: /^Create$/ }).first();
  console.log('1g. create button count:', await create.count(), 'submit buttons:', J(await dump('[class*="modal"] button[type="submit"]', 5)));
  await (await create.count() ? create : page.locator('[class*="modal"] button[type="submit"]').first()).click(); await page.waitForTimeout(1200);
  console.log('1h. after create: request pane visible?', await page.locator('[data-testid="request-pane"]').isVisible(), '| files:', fs.readdirSync(colDir));
});

await stage('request-editor', async () => {
  console.log('2a. URL bar:', J(await dump('[data-testid="url-bar-container"] *[data-testid], [data-testid="url-bar-container"] .CodeMirror, [data-testid="url-bar-container"] button', 20)));
  console.log('2b. method-selector:', J(await dump('[data-testid="method-selector"]', 3)));
  await page.locator('[data-testid="method-selector"]').first().click(); await page.waitForTimeout(300);
  console.log('2c. method options:', J(await dump('[data-testid="method-selector"] ~ * [role="menuitem"], [class*="dropdown"] [role="menuitem"], [class*="dropdown"] div[data-testid], [class*="tippy"] [data-testid], [class*="tippy"] div', 30)));
  await page.screenshot({ path: 'spikes/out/s10-method-dropdown.png' });
  const post = page.locator('[class*="tippy"] div, [class*="dropdown"] div', { hasText: /^POST$/ }).first();
  if (await post.count()) { await post.click(); await page.waitForTimeout(300); }
  console.log('2d. method now:', J(await dump('[data-testid="method-selector"]', 2)));
  // URL typing
  const url = page.locator('[data-testid="request-url"], [data-testid="url-input"]').first();
  console.log('2e. url element:', J(await url.evaluate(e => ({ tag: e.tagName, testid: e.getAttribute('data-testid'), cls: e.className, cm: !!e.closest('.CodeMirror') || !!e.querySelector('.CodeMirror'), text: e.innerText.slice(0, 60) })).catch(() => 'n/a')));
  await url.click(); await page.keyboard.press('Meta+a'); await page.keyboard.type('{{baseUrl}}/posts/1'); await page.waitForTimeout(200);
  console.log('2f. url after type:', J(await url.innerText().catch(() => '?')), '| draft icon?', await page.locator('[data-testid="tab-draft-icon"]').count());
});

await stage('headers', async () => {
  await page.locator('[data-testid="request-pane"] [data-testid="responsive-tab-headers"]').filter({ visible: true }).first().click(); await page.waitForTimeout(400);
  console.log('3a. HEADERS tab controls:', J(await dump('[data-testid="request-pane"] table *, [data-testid="request-pane"] button, [data-testid="request-pane"] [data-testid]:not([data-testid^="responsive-tab"]), [data-testid="request-pane"] .CodeMirror', 40)));
  console.log('3b. headers pane text:', J(await page.evaluate(() => (document.querySelector('[data-testid="request-pane"]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 400))));
  const add = page.locator('[data-testid="request-pane"] button', { hasText: /add header|\+ ?add|add/i }).first();
  console.log('3c. add header button:', await add.count(), J(await add.innerText().catch(() => '')));
  if (await add.count()) { await add.click(); await page.waitForTimeout(300); }
  console.log('3d. after add: inputs/editors:', J(await dump('[data-testid="request-pane"] table input, [data-testid="request-pane"] table .CodeMirror, [data-testid="request-pane"] table [data-testid], [data-testid="request-pane"] table [contenteditable]', 20)));
  await page.screenshot({ path: 'spikes/out/s10-headers.png' });
});

await stage('body', async () => {
  await page.locator('[data-testid="request-pane"] [data-testid="responsive-tab-body"]').filter({ visible: true }).first().click(); await page.waitForTimeout(400);
  console.log('4a. body-type-select:', J(await dump('[data-testid="body-type-select"]', 2)));
  await page.locator('[data-testid="body-type-select"]').first().click(); await page.waitForTimeout(300);
  console.log('4b. body type options:', J(await dump('[class*="tippy"] [data-testid], [class*="tippy"] div, [class*="dropdown"] [data-testid], [class*="dropdown"] div', 40)));
  const json = page.locator('[class*="tippy"] div, [class*="dropdown"] div', { hasText: /^JSON$/ }).first();
  if (await json.count()) { await json.click(); await page.waitForTimeout(300); }
  console.log('4c. body editor:', J(await dump('[data-testid="request-body-editor"], [data-testid="request-pane"] .CodeMirror', 4)));
  const ed = page.locator('[data-testid="request-body-editor"] .CodeMirror, [data-testid="request-body-editor"]').first();
  await ed.click(); await page.keyboard.type('{ "title": "spike" }'); await page.waitForTimeout(200);
  console.log('4d. body text:', J(await ed.innerText().catch(() => '?')));
});

await stage('auth', async () => {
  await page.locator('[data-testid="request-pane"] [data-testid="responsive-tab-auth"]').filter({ visible: true }).first().click(); await page.waitForTimeout(400);
  console.log('5a. AUTH controls:', J(await dump('[data-testid="request-pane"] [data-testid]:not([data-testid^="responsive-tab"]), [data-testid="request-pane"] button, [data-testid="request-pane"] select, [data-testid="request-pane"] .CodeMirror, [data-testid="request-pane"] input', 30)));
  console.log('5b. auth text:', J(await page.evaluate(() => (document.querySelector('[data-testid="request-pane"]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 300))));
  const modeBtn = page.locator('[data-testid="request-pane"] [class*="auth-mode"], [data-testid="request-pane"] [data-testid="inherited-auth-mode"], [data-testid="request-pane"] button', { hasText: /inherit|no auth|bearer/i }).first();
  console.log('5c. auth mode selector:', await modeBtn.count(), J(await modeBtn.innerText().catch(() => '')));
  if (await modeBtn.count()) { await modeBtn.click(); await page.waitForTimeout(300); console.log('5d. auth options:', J(await dump('[class*="tippy"] div, [class*="dropdown"] div, [class*="tippy"] [data-testid]', 30))); }
  const bearer = page.locator('[class*="tippy"] div, [class*="dropdown"] div', { hasText: /^Bearer Token$/ }).first();
  if (await bearer.count()) { await bearer.click(); await page.waitForTimeout(400); }
  console.log('5e. bearer controls:', J(await dump('[data-testid="request-pane"] .CodeMirror, [data-testid="request-pane"] input, [data-testid="request-pane"] label', 10)));
  const tok = page.locator('[data-testid="request-pane"] .CodeMirror').first();
  if (await tok.count()) { await tok.click(); await page.keyboard.type('spike-token'); }
  await page.screenshot({ path: 'spikes/out/s10-auth.png' });
});

await stage('save', async () => {
  console.log('6a. save button:', J(await dump('[data-testid="save-request-button"]', 2)));
  await page.keyboard.press('Meta+s'); await page.waitForTimeout(900);
  const f = path.join(colDir, 'Spike request.yml');
  console.log('6b. saved file exists:', fs.existsSync(f), '| files:', fs.readdirSync(colDir));
  if (fs.existsSync(f)) console.log('6c. YAML:\n' + fs.readFileSync(f, 'utf8'));
});

await stage('sidebar-context-menu', async () => {
  const item = page.locator('[data-testid="sidebar-collection-item-row"]', { hasText: 'Get user' }).first();
  await item.click({ button: 'right' }); await page.waitForTimeout(400);
  console.log('7a. item context menu:', J(await dump('[data-testid^="collection-item-menu"], [role="menuitem"], [class*="tippy"] [data-testid], [class*="dropdown"] [data-testid]', 30)));
  await page.screenshot({ path: 'spikes/out/s10-item-menu.png' });
  await page.keyboard.press('Escape');
  await item.hover(); await page.waitForTimeout(200);
  console.log('7b. hovered item controls:', J(await dump('[data-testid="sidebar-collection-item-row"] [data-testid], [data-testid="sidebar-collection-item-row"] button, [data-testid="sidebar-collection-item-row"] svg[class]', 15)));
});

await stage('create-collection', async () => {
  console.log('8a. collections header:', J(await dump('[data-testid="collections-header-add-menu"], [data-testid="collections-header-actions-menu"], [data-testid="collections"] button', 6)));
  await page.locator('[data-testid="collections-header-add-menu"]').first().click(); await page.waitForTimeout(400);
  console.log('8b. add menu items:', J(await dump('[data-testid^="collections-header-add-menu-"], [class*="tippy"] [data-testid], [class*="dropdown"] div[data-testid], [role="menuitem"]', 20)));
  await page.screenshot({ path: 'spikes/out/s10-add-menu.png' });
  const create = page.locator('[class*="tippy"] div, [class*="dropdown"] div, [role="menuitem"]', { hasText: /^Create Collection$/ }).first();
  console.log('8c. create item count:', await create.count());
  await create.click(); await page.waitForTimeout(600);
  console.log('8d. CREATE COLLECTION modal controls:', J(await dump('[class*="modal"] input, [class*="modal"] button, [class*="modal"] select, [class*="modal"] [data-testid], [class*="modal"] label', 30)));
  console.log('8e. modal text:', J(await page.evaluate(() => (document.querySelector('[class*="modal"]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 500))));
  await page.screenshot({ path: 'spikes/out/s10-create-collection.png' });
  const nameInput = page.locator('[class*="modal"] input[type="text"], [class*="modal"] input:not([type])').first();
  await nameInput.fill('Spike Collection');
  const loc = page.locator('[class*="modal"] input').nth(1);
  console.log('8f. second input value (location?):', J(await loc.inputValue().catch(() => '?')), 'placeholder', J(await loc.getAttribute('placeholder').catch(() => '?')));
  await page.locator('[class*="modal"] button[type="submit"], [class*="modal"] button', { hasText: /^Create$/ }).first().click(); await page.waitForTimeout(1200);
  console.log('8g. after create: rows:', J(await dump('[data-testid="sidebar-collection-row"]', 5)), '| profile collections dir:', fs.readdirSync(path.join(profile, 'collections')).slice(0, 5));
  await page.screenshot({ path: 'spikes/out/s10-after-create-collection.png' });
});

await stage('roles-survey', async () => {
  console.log('9. role/name survey (buttons with aria-label or title):', J(await page.evaluate(() => [...document.querySelectorAll('button[aria-label], button[title], [role="tab"], [role="menuitem"], [role="button"][aria-label]')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0; }).slice(0, 40).map(e => ({ role: e.getAttribute('role') || e.tagName.toLowerCase(), name: e.getAttribute('aria-label') || e.getAttribute('title') || e.innerText.trim().slice(0, 30), testid: e.getAttribute('data-testid') }))), 2500));
});
await s.close();

// Second launch: empty workspace (no collections) — what does the AI have to work with?
await stage('empty-workspace', async () => {
  const p2 = path.join(scratch, 's10-profile-empty'); fs.rmSync(p2, { recursive: true, force: true });
  await seedCaptureProfile({ dir: p2, collections: [], sidebarWidth: 220, brunoVersion: '4.1.0' });
  const s2 = await launchBruno({ executablePath: '/Applications/Bruno.app/Contents/MacOS/Bruno', profileMode: 'capture', captureProfileDir: p2 });
  await setContentSize(s2, { width: 1600, height: 1000, x: 40, y: 60 });
  await s2.page.waitForTimeout(1500);
  console.log('10a. empty workspace ids:', JSON.stringify(await s2.page.evaluate(() => [...new Set([...document.querySelectorAll('[data-testid]')].filter(e => e.getBoundingClientRect().width > 0).map(e => e.getAttribute('data-testid')))])).slice(0, 1500));
  console.log('10b. body text:', JSON.stringify(await s2.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 600))));
  await s2.page.screenshot({ path: 'spikes/out/s10-empty.png' });
  await s2.close();
});
