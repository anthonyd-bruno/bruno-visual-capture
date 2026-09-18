import { register } from 'tsx/esm/api'; register();
import fs from 'node:fs'; import path from 'node:path';
const { launchBruno, setContentSize, seedCaptureProfile } = await import('../packages/automation/src/index.ts');
const scratch = process.env.SCRATCH;
const profile = path.join(scratch, 'oas-profile'); fs.rmSync(profile, { recursive: true, force: true });
const ws = path.join(scratch, 'oas-ws'); fs.rmSync(ws, { recursive: true, force: true }); fs.cpSync('fixtures/openapi-sync/petstore', ws, { recursive: true });
const spec = path.join(ws, 'spec', 'openapi.yaml');
await seedCaptureProfile({ dir: profile, collections: [{ name: 'Pets API', path: path.join(ws, 'collection') }], sidebarWidth: 220, brunoVersion: '4.1.0' });
const s = await launchBruno({ executablePath: '/Applications/Bruno.app/Contents/MacOS/Bruno', profileMode: 'capture', captureProfileDir: profile });
await setContentSize(s, { width: 1600, height: 1000, x: 40, y: 60 });
const page = s.page; const J = (o, n = 1200) => JSON.stringify(o).slice(0, n);
await s.app.evaluate(({ dialog }, { spec }) => {
  globalThis.__bruDialogLog = [];
  dialog.showOpenDialog = async (...a) => { globalThis.__bruDialogLog.push('open'); return { canceled: false, filePaths: [spec] }; };
  dialog.showOpenDialogSync = () => { globalThis.__bruDialogLog.push('openSync'); return [spec]; };
  dialog.showMessageBox = async (...a) => { const o = a.find(x => x && typeof x === 'object' && 'message' in x) || {}; globalThis.__bruDialogLog.push('msg:' + o.message); return { response: 0, checkboxChecked: false }; };
}, { spec });
const row = page.locator('[data-testid="sidebar-collection-row"]', { hasText: 'Pets API' }).first();
await row.click(); await page.waitForTimeout(400); await row.hover();
await page.locator('[data-testid="collection-actions"]').first().click(); await page.locator('[data-testid="collection-actions-sync-openapi"]').click();
await page.getByRole('button', { name: 'Connect' }).waitFor({ timeout: 10000 });
const panelText = () => page.evaluate(() => (document.querySelector('[data-testid="collection-header"]')?.parentElement?.parentElement?.innerText || document.body.innerText).replace(/\s+/g, ' ').slice(0, 700));
console.log('A. connect panel buttons:', J(await page.evaluate(() => [...document.querySelectorAll('button')].map(b => b.innerText.trim()).filter(Boolean).slice(0, 30))));
await page.getByRole('button', { name: 'File', exact: true }).click(); await page.waitForTimeout(300);
console.log('B. after File toggle — inputs/buttons:', J(await page.evaluate(() => [...document.querySelectorAll('input, button')].filter(e => e.closest('[class*="openapi"], [class*="OpenApi"], [class*="OpenAPI"]') || /Connect|Browse|Choose|Select/.test(e.innerText || e.placeholder || '')).map(e => ({ tag: e.tagName, text: (e.innerText || '').trim().slice(0, 30), ph: e.placeholder, type: e.type, testid: e.getAttribute('data-testid') })))));
console.log('   file inputs in DOM:', await page.locator('input[type="file"]').count());
const chooser = page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => undefined);
await page.getByRole('button', { name: 'Select File' }).click();
const fc = await chooser;
console.log('   filechooser event:', fc ? `yes (multiple=${fc.isMultiple()})` : 'NO');
if (fc) await fc.setFiles(spec); else { const inp = page.locator('input[type="file"]').first(); if (await inp.count()) { await inp.setInputFiles(spec); console.log('   set via input[type=file]'); } }
await page.waitForTimeout(500);
console.log('   panel text after file pick:', J((await panelText()).slice(0, 300)));
const connect = page.getByRole('button', { name: 'Connect', exact: true });
console.log('   Connect enabled?', await connect.isEnabled());
await connect.click({ timeout: 5000 }).catch(e => console.log('   connect click:', e.message.split('\n')[0]));
await page.waitForTimeout(3000);
console.log('   dialog log after connect:', J(await s.app.evaluate(() => globalThis.__bruDialogLog)));
console.log('C. panel text after connect:', J(await panelText()));
console.log('   ids now:', J(await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid')))].filter(id => !/^(sidebar|collection-settings|env-|runner|responsive-tab-(params|body|headers|auth|vars|script|assert|tests|docs|file|settings|history|response|timeline)|workspace|toggle|collections|request-tab|tab-draft|more-actions|sandbox|environment-selector|api-specs|collection-actions|collection-item-menu|collection-header|response-layout)/.test(id)))));
console.log('   buttons:', J(await page.evaluate(() => [...document.querySelectorAll('button')].map(b => b.innerText.trim()).filter(t => t && t.length < 40).slice(0, 40))));
await page.screenshot({ path: 'spikes/out/s9b-connected.png' });
console.log('   sidebar items:', await page.locator('[data-testid="sidebar-collection-item-row"]').count(), '| collection files:', fs.readdirSync(path.join(ws, 'collection')).join(', '));
// Modify the spec → "changes detected"?
fs.copyFileSync(path.join(ws, 'spec', 'openapi.v2.yaml'), spec);
await page.waitForTimeout(3000);
console.log('D. panel text after spec change:', J(await panelText()));
console.log('   buttons:', J(await page.evaluate(() => [...document.querySelectorAll('button')].map(b => b.innerText.trim()).filter(t => t && t.length < 40).slice(0, 40))));
await page.screenshot({ path: 'spikes/out/s9b-changed.png' });
await page.getByRole('button', { name: 'Check for updates' }).click(); await page.waitForTimeout(1200);
await page.getByRole('button', { name: /Review and Sync Collection/ }).click(); await page.waitForTimeout(1500);
console.log('F. after Review and Sync click — ids:', J(await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid')))].filter(id => !/^(sidebar|collection-settings|env-|runner|workspace|toggle|collections|request-tab|tab-draft|more-actions|sandbox|environment-selector|api-specs|collection-actions|collection-item-menu|collection-header|response-layout)/.test(id)))));
console.log('   buttons:', J(await page.evaluate(() => [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null).map(b => (b.innerText || b.getAttribute('aria-label') || b.title || '').trim()).filter(t => t && t.length < 40))));
console.log('   dialog/modal count:', await page.locator('[class*="modal"], [role="dialog"]').count(), '| visible:', await page.locator('[class*="modal"], [role="dialog"]').filter({ visible: true }).count());
console.log('   text:', J(await panelText(), 900));
console.log('   checkboxes:', await page.locator('input[type="checkbox"]').count(), 'checked:', await page.locator('input[type="checkbox"]:checked').count());
await page.screenshot({ path: 'spikes/out/s9c-review.png' });
const primary = page.getByRole('button', { name: /^(sync|apply|confirm|update|sync \d+|sync selected|sync collection)/i }).filter({ visible: true }).last();
console.log('   primary candidates:', J(await page.getByRole('button', { name: /sync|apply|confirm|update/i }).filter({ visible: true }).allInnerTexts()));
if (await primary.count()) { console.log('   clicking:', await primary.innerText()); await primary.click(); await page.waitForTimeout(1200);
  const confirm = page.locator('[class*="modal"], [role="dialog"]').filter({ visible: true }).getByRole('button', { name: /confirm|sync/i }).last();
  console.log('   confirm dialog buttons:', J(await page.locator('[class*="modal"], [role="dialog"]').filter({ visible: true }).getByRole('button').allInnerTexts()));
  if (await confirm.count()) { await confirm.click(); }
  for (const wait of [1500, 3000, 5000]) { await page.waitForTimeout(wait); console.log(`   +${wait}ms text:`, J(await panelText(), 900)); }
  console.log('   ids:', J(await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid')))].filter(id => /sync|spec|openapi|toast|notif|success/i.test(id)))));
  console.log('   visible buttons:', J(await page.evaluate(() => [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null).map(b => (b.innerText || '').trim()).filter(t => t && t.length < 40))));
  await page.screenshot({ path: 'spikes/out/s9c-synced.png' }); console.log('G. after confirm — text:', J(await panelText(), 700)); console.log('   dialog log:', J(await s.app.evaluate(() => globalThis.__bruDialogLog))); console.log('   sidebar items:', await page.locator('[data-testid="sidebar-collection-item-row"]').count(), '| collection files:', fs.readdirSync(path.join(ws, 'collection')).join(', ')); await page.screenshot({ path: 'spikes/out/s9c-synced.png' }); }
await s.close();
