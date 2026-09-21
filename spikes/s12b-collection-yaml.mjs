// S12b: collection-level settings YAML (headers, vars, auth, docs, pre-request script) as Bruno 4.1 writes it,
// the request Docs editor, and whether file-authored `docs:` / `runtime.variables` render.
import { register } from 'tsx/esm/api'; register();
import fs from 'node:fs'; import path from 'node:path';
const { launchBruno, setContentSize, seedCaptureProfile, createDefaultActionRegistry, CursorController } = await import('../packages/automation/src/index.ts');
const scratch = process.env.SCRATCH;
const profile = path.join(scratch, 's12b-profile'); fs.rmSync(profile, { recursive: true, force: true });
const ws = path.join(scratch, 's12b-ws'); fs.rmSync(ws, { recursive: true, force: true }); fs.cpSync('fixtures/request-execution/jsonplaceholder', ws, { recursive: true });
const colDir = path.join(ws, 'collection');
// Pre-author docs + runtime vars + a before-request script in the file to see if Bruno renders them.
fs.writeFileSync(path.join(colDir, 'Get user.yml'), `info:
  name: Get user
  type: http
  seq: 1
http:
  method: GET
  url: "{{baseUrl}}/users/{{userId}}"
  headers:
    - name: Accept
      value: application/json
  auth: inherit
runtime:
  variables:
    - name: userId
      value: "2"
  scripts:
    - type: before-request
      code: bru.setVar("requestedAt", new Date().toISOString());
    - type: after-response
      code: bru.setVar("userName", res.body.name);
    - type: tests
      code: |-
        test("status is 200", function () {
          expect(res.getStatus()).to.equal(200);
        });
  assertions:
    - expression: res.status
      operator: eq
      value: "200"
    - expression: res.body.id
      operator: eq
      value: "2"
docs: |-
  # Get user

  Returns a single user by **id**.
settings:
  encodeUrl: true
  timeout: 0
  followRedirects: true
  maxRedirects: 5
`);
await seedCaptureProfile({ dir: profile, collections: [{ name: 'JSONPlaceholder', path: colDir }], sidebarWidth: 220, selectedEnvironment: 'Demo', brunoVersion: '4.1.0' });
const s = await launchBruno({ executablePath: '/Applications/Bruno.app/Contents/MacOS/Bruno', profileMode: 'capture', captureProfileDir: profile });
await setContentSize(s, { width: 1600, height: 1000, x: 40, y: 60 });
const page = s.page; const J = (o, n = 2500) => JSON.stringify(o).slice(0, n);
const txt = (sel, n = 400) => page.evaluate(([sel, n]) => (document.querySelector(sel)?.innerText || '').replace(/\s+/g, ' ').slice(0, n), [sel, n]);
const ids = (root) => page.evaluate((root) => [...new Set([...document.querySelectorAll(`${root} [data-testid]`)].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).map(e => e.getAttribute('data-testid')))], root);
const stage = async (name, fn) => { try { await fn(); } catch (e) { console.log(`!! ${name} failed: ${String(e.message).split('\n')[0]}`); await page.screenshot({ path: `spikes/out/s12b-fail-${name}.png` }).catch(() => {}); await page.keyboard.press('Escape').catch(() => {}); } };
const actions = createDefaultActionRegistry();
const ctx = { session: s, page, log: (m) => console.log('   ·', m), parameters: {}, timeoutMs: 15000, cursor: new CursorController(page, 'hidden') };
const tab = (t) => actions.get('request.selectTab').execute(ctx, { tab: t });
const typeCM = async (loc, text) => { await loc.click(); await page.keyboard.type(text, { delay: 5 }); };

await actions.get('collection.open').execute(ctx, { name: 'JSONPlaceholder' });
await actions.get('request.open').execute(ctx, { name: 'Get user' });
await stage('render-check', async () => {
  console.log('P1 URL bar:', J(await txt('[data-testid="request-url"]', 120)));
  await tab('vars'); await page.waitForTimeout(300); console.log('P2 vars text:', J(await txt('[data-testid="request-vars-req"]', 200)));
  await tab('script'); await page.waitForTimeout(300); console.log('P3 script ids:', J(await ids('[data-testid="request-pane"]')));
  await page.locator('[data-testid="tab-trigger-pre-request"]').click(); await page.waitForTimeout(300);
  console.log('P4 pre-request editor ids/text:', J(await ids('[data-testid="request-pane"]')), J(await txt('[data-testid="request-pane"] .CodeMirror', 160)));
  await tab('docs'); await page.waitForTimeout(400); console.log('P5 docs ids:', J(await ids('[data-testid="request-pane"]')), 'docs text:', J(await txt('[data-testid="request-pane"]', 300)));
  await page.screenshot({ path: 'spikes/out/s12b-docs.png' });
  await page.locator('[data-testid="docs-edit-toggle"]').click(); await page.waitForTimeout(400);
  console.log('P6 docs edit mode ids:', J(await ids('[data-testid="request-pane"]')), J(await page.evaluate(() => [...document.querySelectorAll('[data-testid="docs-editor"] *')].slice(0, 6).map(e => e.tagName + '.' + (e.className || '').toString().slice(0, 30)))));
  await page.locator('[data-testid="docs-edit-toggle"]').click(); await page.waitForTimeout(200);
  await actions.get('request.send').execute(ctx, {}); await page.waitForTimeout(600);
  await actions.get('response.selectTab').execute(ctx, { tab: 'tests' }); await page.waitForTimeout(400);
  console.log('P7 tests result text:', J(await txt('[data-testid="response-pane"]', 400)));
  await page.screenshot({ path: 'spikes/out/s12b-tests.png' });
});
await stage('collection-settings-author', async () => {
  await actions.get('collection.openSettings').execute(ctx, { tab: 'headers' }); await page.waitForTimeout(300);
  const table = page.locator('[data-testid="collection-headers"]').first();
  await typeCM(table.locator('tbody tr').last().locator('[data-testid="column-name"] .CodeMirror, [data-testid="column-name"] input').first(), 'X-Client'); await page.waitForTimeout(300);
  const n = await table.locator('tbody tr').count(); await typeCM(table.locator('tbody tr').nth(n - 2).locator('[data-testid="column-value"] .CodeMirror, [data-testid="column-value"] input').first(), 'bruno-docs');
  await actions.get('collection.openSettings').execute(ctx, { tab: 'vars' }); await page.waitForTimeout(300);
  const vt = page.locator('[data-testid="collection-vars-req"]').first();
  await typeCM(vt.locator('tbody tr').last().locator('[data-testid="column-name"] .CodeMirror, [data-testid="column-name"] input').first(), 'apiVersion'); await page.waitForTimeout(300);
  const m = await vt.locator('tbody tr').count(); await typeCM(vt.locator('tbody tr').nth(m - 2).locator('[data-testid="column-value"] .CodeMirror, [data-testid="column-value"] input').first(), 'v1');
  await actions.get('collection.openSettings').execute(ctx, { tab: 'auth' }); await page.waitForTimeout(300);
  await page.locator('[data-testid="auth-mode-selector"]').first().click(); await page.waitForTimeout(200);
  console.log('K1 collection auth modes:', J(await page.evaluate(() => [...document.querySelectorAll('[data-testid^="auth-mode-dropdown-"]')].map(e => e.getAttribute('data-testid')))));
  await page.locator('[data-testid="auth-mode-dropdown-bearer"]').click(); await page.waitForTimeout(300);
  console.log('K2 collection auth ids:', J(await ids('main, [data-testid="settings-tab-bar"] ~ *')));
  const cmCount = await page.locator('.CodeMirror').filter({ visible: true }).count(); console.log('K3 visible CodeMirrors on auth tab:', cmCount);
  await typeCM(page.locator('.CodeMirror').filter({ visible: true }).last(), 'collection-token-abc');
  await actions.get('collection.openSettings').execute(ctx, { tab: 'script' }); await page.waitForTimeout(300);
  await page.locator('[data-testid="tab-trigger-pre-request"]').click(); await page.waitForTimeout(300);
  console.log('K4 collection script ids:', J(await ids('main, [data-testid="settings-tab-bar"] ~ *')));
  await typeCM(page.locator('.CodeMirror').filter({ visible: true }).last(), 'bru.setVar("collectionStartedAt", Date.now());');
  await actions.get('collection.openSettings').execute(ctx, { tab: 'overview' }); await page.waitForTimeout(300);
  console.log('K5 overview text:', J(await txt('main', 400)));
  await page.keyboard.press('Meta+s'); await page.waitForTimeout(1200);
  console.log('Y1 ===== opencollection.yml =====\n' + fs.readFileSync(path.join(colDir, 'opencollection.yml'), 'utf8') + '\n===== end =====');
  console.log('Y2 files:', fs.readdirSync(colDir), fs.existsSync(path.join(colDir, 'collection.yml')) ? '\n' + fs.readFileSync(path.join(colDir, 'collection.yml'), 'utf8') : '');
  await page.screenshot({ path: 'spikes/out/s12b-collection-overview.png' });
});
await stage('folder-settings', async () => {
  await actions.get('folder.create').execute(ctx, { name: 'Users' }); await page.waitForTimeout(500);
  console.log('F1 files:', fs.readdirSync(colDir), fs.existsSync(path.join(colDir, 'Users')) ? fs.readdirSync(path.join(colDir, 'Users')) : '');
  const f = path.join(colDir, 'Users', 'folder.yml'); if (fs.existsSync(f)) console.log('F2 folder.yml:\n' + fs.readFileSync(f, 'utf8'));
});
await s.close?.().catch(() => {}); await s.app?.close?.().catch(() => {}); process.exit(0);
