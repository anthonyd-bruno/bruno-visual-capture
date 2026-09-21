// S13a: body-mode YAML, environment editor (create env + var), rename/delete/create-example dialogs, preferences,
// cookies, global search, sidebar search, dev tools console.
import { register } from 'tsx/esm/api'; register();
import fs from 'node:fs'; import path from 'node:path';
const { launchBruno, setContentSize, seedCaptureProfile, createDefaultActionRegistry, CursorController } = await import('../packages/automation/src/index.ts');
const scratch = process.env.SCRATCH;
const profile = path.join(scratch, 's13a-profile'); fs.rmSync(profile, { recursive: true, force: true });
const ws = path.join(scratch, 's13a-ws'); fs.rmSync(ws, { recursive: true, force: true }); fs.cpSync('fixtures/scripting/jsonplaceholder-scripts', ws, { recursive: true });
const colDir = path.join(ws, 'collection');
await seedCaptureProfile({ dir: profile, collections: [{ name: 'Scripting Demo', path: colDir }], sidebarWidth: 220, selectedEnvironment: 'Demo', brunoVersion: '4.1.0' });
const s = await launchBruno({ executablePath: '/Applications/Bruno.app/Contents/MacOS/Bruno', profileMode: 'capture', captureProfileDir: profile });
await setContentSize(s, { width: 1600, height: 1000, x: 40, y: 60 });
const page = s.page; const J = (o, n = 2200) => JSON.stringify(o).slice(0, n);
const txt = (sel, n = 400) => page.evaluate(([sel, n]) => (document.querySelector(sel)?.innerText || '').replace(/\s+/g, ' ').slice(0, n), [sel, n]);
const dump = (sel, max = 40) => page.evaluate(([sel, max]) => [...document.querySelectorAll(sel)].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).slice(0, max).map(e => ({ tag: e.tagName.toLowerCase(), testid: e.getAttribute('data-testid'), role: e.getAttribute('role'), ph: e.getAttribute('placeholder'), title: e.getAttribute('title') || e.getAttribute('aria-label'), cls: (e.className || '').toString().slice(0, 30), text: (e.innerText || e.value || '').trim().replace(/\s+/g, ' ').slice(0, 40) })), [sel, max]);
const ids = (root = 'body') => page.evaluate((root) => [...new Set([...document.querySelectorAll(`${root} [data-testid]`)].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).map(e => e.getAttribute('data-testid')))], root);
const modalIds = () => page.evaluate(() => [...new Set([...document.querySelectorAll('[class*="modal"] [data-testid], [role="dialog"] [data-testid]')].map(e => e.getAttribute('data-testid')))]);
const modalText = () => page.evaluate(() => (document.querySelector('[class*="modal"]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 500));
const stage = async (name, fn) => { try { await fn(); } catch (e) { console.log(`!! ${name} failed: ${String(e.message).split('\n')[0]}`); await page.screenshot({ path: `spikes/out/s13a-fail-${name}.png` }).catch(() => {}); await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(300); } };
const actions = createDefaultActionRegistry();
const ctx = { session: s, page, log: (m) => console.log('   ·', m), parameters: {}, timeoutMs: 15000, cursor: new CursorController(page, 'hidden') };
const A = (id, p = {}) => actions.get(id).execute(ctx, p);
const typeCM = async (loc, text) => { await loc.click(); await page.keyboard.type(text, { delay: 5 }); };

await A('collection.open', { name: 'Scripting Demo' });
await A('request.open', { name: 'Get user posts' });

await stage('body-modes', async () => {
  await A('request.setBody', { mode: 'formurlencoded' }); await page.waitForTimeout(300);
  console.log('B1 form table ids:', J(await ids('[data-testid="request-pane"]')));
  const table = page.locator('[data-testid="request-pane"] table').first();
  await typeCM(table.locator('tbody tr').last().locator('[data-testid="column-name"] .CodeMirror, [data-testid="column-name"] input').first(), 'title'); await page.waitForTimeout(300);
  const n = await table.locator('tbody tr').count(); await typeCM(table.locator('tbody tr').nth(n - 2).locator('[data-testid="column-value"] .CodeMirror, [data-testid="column-value"] input').first(), 'hello');
  await page.keyboard.press('Meta+s'); await page.waitForTimeout(800);
  console.log('B2 formurlencoded yaml body:\n' + fs.readFileSync(path.join(colDir, 'Get user posts.yml'), 'utf8').split('\n').filter(l => /body|type|data|name|value|title|hello|enabled/.test(l)).join('\n'));
  await A('request.setBody', { mode: 'multipartform' }); await page.waitForTimeout(300);
  console.log('B3 multipart ids:', J(await ids('[data-testid="request-pane"]')));
  const mt = page.locator('[data-testid="request-pane"] table').first();
  await typeCM(mt.locator('tbody tr').last().locator('[data-testid="column-name"] .CodeMirror, [data-testid="column-name"] input').first(), 'file_name'); await page.waitForTimeout(300);
  const m = await mt.locator('tbody tr').count(); await typeCM(mt.locator('tbody tr').nth(m - 2).locator('[data-testid="column-value"] .CodeMirror, [data-testid="column-value"] input').first(), 'report.pdf');
  await page.keyboard.press('Meta+s'); await page.waitForTimeout(800);
  console.log('B4 multipart yaml body:\n' + fs.readFileSync(path.join(colDir, 'Get user posts.yml'), 'utf8').split('\n').filter(l => /body|type|data|name|value|file_name|report|enabled/.test(l)).join('\n'));
  await A('request.setBody', { mode: 'xml', content: '<note><to>Bruno</to></note>' }); await page.keyboard.press('Meta+s'); await page.waitForTimeout(800);
  console.log('B5 xml yaml:\n' + fs.readFileSync(path.join(colDir, 'Get user posts.yml'), 'utf8').split('\n').filter(l => /body|type|data|note|Bruno/.test(l)).join('\n'));
  await A('request.setBody', { mode: 'text', content: 'plain text body' }); await page.keyboard.press('Meta+s'); await page.waitForTimeout(800);
  console.log('B6 text yaml:\n' + fs.readFileSync(path.join(colDir, 'Get user posts.yml'), 'utf8').split('\n').filter(l => /body|type|data|plain/.test(l)).join('\n'));
  console.log('B7 body mode labels:', J(await (async () => { await page.locator('[data-testid="request-body-mode-selector"]').first().click(); await page.waitForTimeout(200); const r = await dump('[data-testid^="request-body-mode-label-"]', 20); await page.keyboard.press('Escape'); return r; })()));
});

await stage('env-editor', async () => {
  await A('environment.openEditor'); await page.waitForTimeout(500);
  console.log('E1 env editor ids:', J(await ids()));
  console.log('E2 env editor buttons:', J(await dump('button, [role="button"]', 40).then(a => a.filter(b => /env|create|add|new|import|clone|save|close/i.test(b.text + b.title + b.testid)))));
  console.log('E3 env editor text:', J(await txt('body', 700)));
  await page.screenshot({ path: 'spikes/out/s13a-env-editor.png' });
  // try to create a new environment
  const createBtn = page.locator('button, [role="button"], div', { hasText: /^(\+ )?Create( Environment)?$|^New Environment$|^\+$/ }).filter({ visible: true }).first();
  console.log('E4 create candidate:', await createBtn.count(), J(await dump('[data-testid*="create"], [data-testid*="add-env"], [data-testid*="new-env"], [title*="Create"], [title*="create"]', 10)));
  if (await createBtn.count()) { await createBtn.click(); await page.waitForTimeout(400); console.log('E5 after create click — modal ids:', J(await modalIds()), 'text:', J(await modalText()), 'inputs:', J(await dump('[class*="modal"] input, input:focus', 5))); }
  await page.screenshot({ path: 'spikes/out/s13a-env-create.png' });
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  // add a variable to the current env
  const nameInput = page.locator('[data-testid="env-var-name-input"]').filter({ visible: true }).last();
  console.log('E6 var name inputs:', await page.locator('[data-testid="env-var-name-input"]').count(), 'rows:', J(await dump('[data-testid="env-row"], [data-testid^="env-var-row"]', 6)));
  if (await nameInput.count()) { await nameInput.click(); await page.keyboard.type('apiToken', { delay: 8 }); await page.waitForTimeout(300); console.log('E7 rows after typing:', J(await dump('[data-testid="env-row"], [data-testid^="env-var-row"]', 6)), 'ids now:', J(await ids())); }
  await page.screenshot({ path: 'spikes/out/s13a-env-var.png' });
  const save = page.locator('[data-testid="save-env"]').first(); if (await save.count()) { await save.click(); await page.waitForTimeout(800); }
  console.log('E8 env files:', fs.readdirSync(path.join(colDir, 'environments')), '\n' + fs.readFileSync(path.join(colDir, 'environments', 'Demo.yml'), 'utf8'));
  await page.keyboard.press('Escape'); await page.waitForTimeout(300); await A('modal.close').catch(() => {});
});

await stage('rename-delete', async () => {
  await A('request.menuItem', { name: 'Get user posts', item: 'rename' }); await page.waitForTimeout(500);
  console.log('R1 rename modal ids:', J(await modalIds()), 'controls:', J(await dump('[class*="modal"] input, [class*="modal"] button', 8)), 'text:', J(await modalText()));
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await A('request.menuItem', { name: 'Get user posts', item: 'delete' }); await page.waitForTimeout(500);
  console.log('R2 delete modal ids:', J(await modalIds()), 'controls:', J(await dump('[class*="modal"] button', 8)), 'text:', J(await modalText()));
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
});

await stage('create-example', async () => {
  await A('request.open', { name: 'Get user' }); await A('request.send'); await page.waitForTimeout(500);
  console.log('X0 response toolbar ids:', J(await ids('[data-testid="response-pane"]')));
  await A('request.menuItem', { name: 'Get user', item: 'create-example' }); await page.waitForTimeout(500);
  console.log('X1 example modal ids:', J(await modalIds()), 'controls:', J(await dump('[class*="modal"] input, [class*="modal"] button, [class*="modal"] select', 12)), 'text:', J(await modalText()));
  const nameIn = page.locator('[data-testid="create-example-name-input"]').first();
  if (await nameIn.count()) { await nameIn.fill('200 OK sample'); const submit = page.locator('[class*="modal"] button[type="submit"], [class*="modal"] button', { hasText: /create|save/i }).first(); await submit.click(); await page.waitForTimeout(800); }
  console.log('X2 sidebar examples:', J(await dump('[data-testid="sidebar-response-example-item"]', 5)), 'ids:', J(await ids()));
  console.log('X3 files:', fs.readdirSync(colDir), fs.readFileSync(path.join(colDir, 'Get user.yml'), 'utf8').split('\n').filter(l => /example|name:|status|200/.test(l)).slice(0, 12).join(' | '));
  await page.screenshot({ path: 'spikes/out/s13a-example.png' });
});

await stage('preferences-cookies', async () => {
  const pref = page.getByRole('button', { name: /preferences/i }).first();
  console.log('P0 pref button count:', await pref.count(), J(await dump('[title*="Preferences"], [aria-label*="Preferences"], [title*="Cookies"], [aria-label*="Cookies"]', 4)));
  await pref.click(); await page.waitForTimeout(600);
  console.log('P1 preferences ids:', J(await modalIds()), 'tabs/text:', J(await modalText()));
  await page.screenshot({ path: 'spikes/out/s13a-preferences.png' });
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  const cookies = page.getByRole('button', { name: /cookies/i }).first(); await cookies.click(); await page.waitForTimeout(500);
  console.log('P2 cookies ids:', J(await modalIds()), 'text:', J(await modalText()));
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
});

await stage('search', async () => {
  const gs = page.getByRole('button', { name: /global search/i }).first(); console.log('S0 global search btn:', await gs.count());
  await gs.click(); await page.waitForTimeout(400);
  console.log('S1 global search ids:', J(await modalIds()), 'body ids w/ search:', J((await ids()).filter(i => /search/.test(i))));
  await page.locator('[data-testid="global-search-input"]').first().fill('user'); await page.waitForTimeout(600);
  console.log('S2 results text:', J(await modalText()));
  await page.screenshot({ path: 'spikes/out/s13a-global-search.png' });
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  const sr = page.getByRole('button', { name: /search requests/i }).first(); console.log('S3 sidebar search btn:', await sr.count());
  await sr.click(); await page.waitForTimeout(300);
  await page.locator('[data-testid="sidebar-search-input"]').first().fill('posts'); await page.waitForTimeout(500);
  console.log('S4 sidebar after filter:', J(await dump('[data-testid="sidebar-collection-item-row"]', 8)));
  await page.screenshot({ path: 'spikes/out/s13a-sidebar-search.png' });
  await page.locator('[data-testid="sidebar-search-input"]').first().fill(''); await page.keyboard.press('Escape');
});

await stage('devtools', async () => {
  await A('request.open', { name: 'Get user' }); await A('request.send'); await page.waitForTimeout(300);
  await page.locator('[data-testid="toggle-devtools-button"]').first().click(); await page.waitForTimeout(600);
  console.log('D1 devtools ids:', J((await ids()).filter(i => /dev|console|log|network|tab/.test(i))));
  console.log('D2 devtools tabs/text:', J(await dump('[data-testid*="devtools"] [role="tab"], [data-testid*="devtools"] button, [class*="devtools"] [role="tab"], [class*="devtools"] button', 20)));
  console.log('D3 devtools text:', J(await page.evaluate(() => { const el = [...document.querySelectorAll('[data-testid*="devtools"], [class*="devtools"], [class*="dev-tools"]')].sort((a, b) => b.innerText.length - a.innerText.length)[0]; return (el?.innerText || '').replace(/\s+/g, ' ').slice(0, 500); })));
  await page.screenshot({ path: 'spikes/out/s13a-devtools.png' });
  await page.locator('[data-testid="toggle-devtools-button"]').first().click();
});
await s.close?.().catch(() => {}); await s.app?.close?.().catch(() => {}); process.exit(0);
