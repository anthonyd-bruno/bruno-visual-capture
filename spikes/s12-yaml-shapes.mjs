// S12: let Bruno 4.1 write the YAML for assertions, tests, scripts, docs and request vars; dump the ids of
// the Assert/Tests/Script/Docs/Vars tabs, the response Tests tab and the Generate Code modal.
import { register } from 'tsx/esm/api'; register();
import fs from 'node:fs'; import path from 'node:path';
const { launchBruno, setContentSize, seedCaptureProfile, createDefaultActionRegistry, CursorController } = await import('../packages/automation/src/index.ts');
const scratch = process.env.SCRATCH;
const profile = path.join(scratch, 's12-profile'); fs.rmSync(profile, { recursive: true, force: true });
const ws = path.join(scratch, 's12-ws'); fs.rmSync(ws, { recursive: true, force: true }); fs.cpSync('fixtures/request-execution/jsonplaceholder', ws, { recursive: true });
const colDir = path.join(ws, 'collection');
await seedCaptureProfile({ dir: profile, collections: [{ name: 'JSONPlaceholder', path: colDir }], sidebarWidth: 220, selectedEnvironment: 'Demo', brunoVersion: '4.1.0' });
const s = await launchBruno({ executablePath: '/Applications/Bruno.app/Contents/MacOS/Bruno', profileMode: 'capture', captureProfileDir: profile });
await setContentSize(s, { width: 1600, height: 1000, x: 40, y: 60 });
const page = s.page; const J = (o, n = 3000) => JSON.stringify(o).slice(0, n);
const dump = (sel, max = 40) => page.evaluate(([sel, max]) => [...document.querySelectorAll(sel)].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).slice(0, max).map(e => ({ tag: e.tagName.toLowerCase(), testid: e.getAttribute('data-testid'), role: e.getAttribute('role'), ph: e.getAttribute('placeholder'), cls: (e.className || '').toString().slice(0, 40), text: (e.innerText || e.value || '').trim().replace(/\s+/g, ' ').slice(0, 50) })), [sel, max]);
const ids = (root) => page.evaluate((root) => [...new Set([...document.querySelectorAll(`${root} [data-testid]`)].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).map(e => e.getAttribute('data-testid')))], root);
const stage = async (name, fn) => { try { await fn(); } catch (e) { console.log(`!! ${name} failed: ${String(e.message).split('\n')[0]}`); await page.screenshot({ path: `spikes/out/s12-fail-${name}.png` }).catch(() => {}); await page.keyboard.press('Escape').catch(() => {}); } };
const actions = createDefaultActionRegistry();
const ctx = { session: s, page, log: (m) => console.log('   ·', m), parameters: {}, timeoutMs: 15000, cursor: new CursorController(page, 'hidden') };
const tab = (t) => actions.get('request.selectTab').execute(ctx, { tab: t });
const typeCM = async (loc, text, replace = true) => { await loc.click(); if (replace) { await page.keyboard.press('Meta+a'); await page.keyboard.press('Backspace'); } await page.keyboard.type(text, { delay: 5 }); };

await actions.get('collection.open').execute(ctx, { name: 'JSONPlaceholder' });
await actions.get('request.open').execute(ctx, { name: 'Get user' });

await stage('assert', async () => {
  await tab('assert'); await page.waitForTimeout(400);
  console.log('A1 assert tab ids:', J(await ids('[data-testid="request-pane"]')));
  console.log('A2 assert table rows:', J(await dump('[data-testid="request-pane"] table tbody tr', 6)));
  console.log('A3 assert cells:', J(await dump('[data-testid="request-pane"] table tbody tr:last-child td, [data-testid="request-pane"] table tbody tr:last-child .CodeMirror, [data-testid="request-pane"] table tbody tr:last-child input, [data-testid="request-pane"] table tbody tr:last-child select', 12)));
  const lastRow = page.locator('[data-testid="request-pane"] table tbody tr').last();
  const nameCell = lastRow.locator('[data-testid="column-name"] .CodeMirror, [data-testid="column-name"] input, td:first-child .CodeMirror, td:first-child input').first();
  await typeCM(nameCell, 'res.status', false); await page.waitForTimeout(300);
  console.log('A4 rows after typing name:', await page.locator('[data-testid="request-pane"] table tbody tr').count());
  const row = page.locator('[data-testid="request-pane"] table tbody tr').nth((await page.locator('[data-testid="request-pane"] table tbody tr').count()) - 2);
  console.log('A5 new row cells:', J(await row.evaluate(r => [...r.querySelectorAll('td')].map(td => ({ testid: td.getAttribute('data-testid'), inner: [...td.querySelectorAll('[data-testid], select, input, .CodeMirror')].map(e => e.getAttribute('data-testid') || e.tagName).join('|'), text: td.innerText.trim().slice(0, 30) })))));
  const sel = row.locator('select').first(); if (await sel.count()) await sel.selectOption('eq');
  const valCell = row.locator('[data-testid="column-value"] .CodeMirror, [data-testid="column-value"] input, td:nth-child(3) .CodeMirror, td:nth-child(3) input').first();
  await typeCM(valCell, '200', false);
  await page.screenshot({ path: 'spikes/out/s12-assert.png' });
});
await stage('tests', async () => {
  await tab('tests'); await page.waitForTimeout(400);
  console.log('T1 tests tab ids:', J(await ids('[data-testid="request-pane"]')));
  const ed = page.locator('[data-testid="request-pane"] [data-testid="test-script-editor"] .CodeMirror, [data-testid="request-pane"] .CodeMirror').first();
  await typeCM(ed, 'test("status is 200", function () {\n  expect(res.getStatus()).to.equal(200);\n});\n');
  await page.screenshot({ path: 'spikes/out/s12-tests.png' });
});
await stage('script', async () => {
  await tab('script'); await page.waitForTimeout(400);
  console.log('S1 script tab ids:', J(await ids('[data-testid="request-pane"]')));
  console.log('S2 script sub-tabs:', J(await dump('[data-testid="request-pane"] [role="tab"], [data-testid="request-pane"] [class*="tab"] > div, [data-testid="request-pane"] button', 20)));
  const ed = page.locator('[data-testid="request-pane"] .CodeMirror').filter({ visible: true }).first();
  await typeCM(ed, 'bru.setVar("startedAt", Date.now());\n');
  await page.screenshot({ path: 'spikes/out/s12-script.png' });
});
await stage('vars', async () => {
  await tab('vars'); await page.waitForTimeout(400);
  console.log('V1 vars tab ids:', J(await ids('[data-testid="request-pane"]')));
  console.log('V2 vars tables:', J(await dump('[data-testid="request-pane"] table', 4)));
  const table = page.locator('[data-testid="request-pane"] table').first();
  const last = table.locator('tbody tr').last();
  await typeCM(last.locator('.CodeMirror, input').first(), 'userId', false); await page.waitForTimeout(300);
  const n = await table.locator('tbody tr').count(); const row = table.locator('tbody tr').nth(n - 2);
  await typeCM(row.locator('.CodeMirror, input').nth(1), '1', false);
  await page.screenshot({ path: 'spikes/out/s12-vars.png' });
});
await stage('docs', async () => {
  await tab('docs'); await page.waitForTimeout(400);
  console.log('D1 docs tab ids:', J(await ids('[data-testid="request-pane"]')));
  const toggle = page.locator('[data-testid="docs-edit-toggle"]').first(); if (await toggle.count()) await toggle.click();
  await page.waitForTimeout(300);
  const ed = page.locator('[data-testid="request-pane"] .CodeMirror').filter({ visible: true }).first();
  await typeCM(ed, '# Get user\n\nReturns one user by id.\n');
  await page.screenshot({ path: 'spikes/out/s12-docs.png' });
});
await stage('save', async () => {
  await page.keyboard.press('Meta+s'); await page.waitForTimeout(1200);
  console.log('Y1 files:', fs.readdirSync(colDir));
  console.log('Y2 ===== Get user.yml =====\n' + fs.readFileSync(path.join(colDir, 'Get user.yml'), 'utf8') + '\n===== end =====');
});
await stage('send-tests', async () => {
  await actions.get('request.send').execute(ctx, {}); await page.waitForTimeout(800);
  console.log('R1 response tabs:', J(await dump('[data-testid="response-pane"] [data-testid^="responsive-tab-"]', 10)));
  await actions.get('response.selectTab').execute(ctx, { tab: 'tests' }); await page.waitForTimeout(500);
  console.log('R2 response tests ids:', J(await ids('[data-testid="response-pane"]')));
  console.log('R3 response tests text:', J(await page.evaluate(() => (document.querySelector('[data-testid="response-pane"]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 400))));
  await page.screenshot({ path: 'spikes/out/s12-response-tests.png' });
  await actions.get('response.selectTab').execute(ctx, { tab: 'headers' }); await page.waitForTimeout(400);
  console.log('R4 response headers ids:', J(await ids('[data-testid="response-pane"]')));
});
await stage('generate-code', async () => {
  await actions.get('request.menuItem').execute(ctx, { name: 'Get user', item: 'generate-code' }); await page.waitForTimeout(800);
  console.log('G1 modal ids:', J(await page.evaluate(() => [...new Set([...document.querySelectorAll('[class*="modal"] [data-testid], [role="dialog"] [data-testid]')].map(e => e.getAttribute('data-testid')))])));
  console.log('G2 modal controls:', J(await dump('[class*="modal"] select, [class*="modal"] button, [class*="modal"] [role="button"], [class*="modal"] [role="tab"], [class*="modal"] [data-testid="code-block-lang-selector"] *', 40)));
  console.log('G3 modal text:', J(await page.evaluate(() => (document.querySelector('[class*="modal"]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 500))));
  await page.screenshot({ path: 'spikes/out/s12-generate-code.png' });
  await actions.get('modal.close').execute(ctx, {});
});
await stage('clone', async () => {
  await actions.get('request.menuItem').execute(ctx, { name: 'Get user', item: 'clone' }); await page.waitForTimeout(600);
  console.log('C1 clone modal ids:', J(await page.evaluate(() => [...new Set([...document.querySelectorAll('[class*="modal"] [data-testid], [role="dialog"] [data-testid]')].map(e => e.getAttribute('data-testid')))])));
  console.log('C2 clone modal controls:', J(await dump('[class*="modal"] input, [class*="modal"] button', 10)));
  await actions.get('modal.close').execute(ctx, {});
});
await stage('collection-settings', async () => {
  for (const t of ['overview', 'headers', 'vars', 'auth', 'script', 'tests']) {
    await actions.get('collection.openSettings').execute(ctx, { tab: t }); await page.waitForTimeout(400);
    console.log(`K-${t} ids:`, J(await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-testid="settings-tab-bar"] ~ * [data-testid], main [data-testid]')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).map(e => e.getAttribute('data-testid')))].slice(0, 40)), 1200));
  }
  await page.screenshot({ path: 'spikes/out/s12-collection-settings.png' });
});
await s.close?.().catch(() => {}); await s.app?.close?.().catch(() => {}); process.exit(0);
