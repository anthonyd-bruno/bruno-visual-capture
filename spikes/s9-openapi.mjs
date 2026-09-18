// What does "Sync OpenAPI" do when the native open-dialog is answered from the main process?
import { register } from 'tsx/esm/api'; register();
import fs from 'node:fs'; import path from 'node:path';
const { launchBruno, setContentSize, seedCaptureProfile } = await import('../packages/automation/src/index.ts');
const scratch = process.env.SCRATCH;
const profile = path.join(scratch, 'oas-profile'); fs.rmSync(profile, { recursive: true, force: true });
const ws = path.join(scratch, 'oas-ws'); fs.rmSync(ws, { recursive: true, force: true }); fs.cpSync('fixtures/runner/basic-workspace', ws, { recursive: true });
const spec = path.resolve('fixtures/openapi-sync/petstore/openapi.yaml');
await seedCaptureProfile({ dir: profile, collections: [{ name: 'Bruno Capture Demo', path: path.join(ws, 'collection') }], sidebarWidth: 220, brunoVersion: '4.1.0' });
const s = await launchBruno({ executablePath: '/Applications/Bruno.app/Contents/MacOS/Bruno', profileMode: 'capture', captureProfileDir: profile });
await setContentSize(s, { width: 1600, height: 1000, x: 40, y: 60 });
const page = s.page; const J = (o, n = 1500) => JSON.stringify(o).slice(0, n);
// Answer every native dialog from the main process: open → our spec, save → a path in the workspace, message boxes → first button.
const calls = await s.app.evaluate(({ dialog }, { spec, ws }) => {
  const log = []; globalThis.__bruDialogLog = log;
  dialog.showOpenDialog = async (...args) => { const opts = args.find(a => a && typeof a === 'object' && !('id' in a)) || {}; log.push({ kind: 'open', title: opts.title, filters: opts.filters, properties: opts.properties }); return { canceled: false, filePaths: [spec] }; };
  dialog.showOpenDialogSync = () => { log.push({ kind: 'openSync' }); return [spec]; };
  dialog.showSaveDialog = async (...args) => { log.push({ kind: 'save' }); return { canceled: false, filePath: ws + '/saved' }; };
  dialog.showMessageBox = async (...args) => { const opts = args.find(a => a && typeof a === 'object' && 'message' in a) || {}; log.push({ kind: 'message', message: opts.message, buttons: opts.buttons }); return { response: 0, checkboxChecked: false }; };
  return 'patched';
}, { spec, ws });
console.log('dialog patch:', calls);
const row = page.locator('[data-testid="sidebar-collection-row"]', { hasText: 'Bruno Capture Demo' }).first();
await row.click(); await page.waitForTimeout(500);
await row.hover(); await page.locator('[data-testid="collection-actions"]').first().click(); await page.locator('[data-testid="collection-actions-sync-openapi"]').click();
await page.waitForTimeout(1500);
console.log('dialog log:', J(await s.app.evaluate(() => globalThis.__bruDialogLog)));
const dumpIds = () => page.evaluate(() => [...new Set([...document.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid')))].filter(id => /openapi|spec|sync|modal|import|diff|change|version|preview|apply|confirm/i.test(id)));
console.log('ids after sync click:', J(await dumpIds()));
console.log('modal text:', J(await page.evaluate(() => [...document.querySelectorAll('[class*="modal"], [role="dialog"]')].map(e => (e.innerText || '').replace(/\s+/g, ' ').slice(0, 400)))));
await page.screenshot({ path: 'spikes/out/s9-after-sync.png' });
console.log('sidebar rows now:', J(await page.locator('[data-testid="sidebar-collection-row"]').allInnerTexts()), '| items:', await page.locator('[data-testid="sidebar-collection-item-row"]').count());
console.log('collection dir now:', fs.readdirSync(path.join(ws, 'collection')));
// Also: API Specs add-menu — what does it offer?
await page.locator('[data-testid="api-specs-header-add-menu"]').click().catch(() => {}); await page.waitForTimeout(500);
console.log('api-specs menu ids:', J(await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-testid^="api-specs"], [role="menuitem"]')].map(e => e.getAttribute('data-testid') + ':' + (e.innerText || '').trim().slice(0, 30)))])));
await page.keyboard.press('Escape');
await page.screenshot({ path: 'spikes/out/s9-api-specs-menu.png' });
await s.close();
