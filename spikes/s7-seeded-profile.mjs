// Seeded capture profile: fixture collection pre-registered, then drive Runner via the measured ids.
import { register } from 'tsx/esm/api'; register();
const { launchBruno, setContentSize, seedCaptureProfile } = await import('../packages/automation/src/index.ts');
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const scratch = process.env.SCRATCH;
const profile = path.join(scratch, 'capture-profile-2'); fs.rmSync(profile, { recursive: true, force: true });
const ws = path.join(scratch, 'run-workspace'); fs.rmSync(ws, { recursive: true, force: true });
fs.cpSync('fixtures/runner/basic-workspace', ws, { recursive: true });
const collectionPath = path.join(ws, 'collection');
const docsBefore = new Set(fs.existsSync(path.join(os.homedir(), 'Documents/bruno')) ? fs.readdirSync(path.join(os.homedir(), 'Documents/bruno')) : []);
await seedCaptureProfile({ dir: profile, collections: [{ name: "Bruno Capture Demo", path: collectionPath }], sidebarWidth: 220, selectedEnvironment: "Demo", brunoVersion: "4.1.0" });
const t0 = Date.now();
const s = await launchBruno({ executablePath: '/Applications/Bruno.app/Contents/MacOS/Bruno', profileMode: 'capture', captureProfileDir: profile, log: (m) => console.log('  [launcher]', m) });
console.log(`launched ${Date.now() - t0} ms; userData isolated:`, s.userDataPath === profile);
await setContentSize(s, { width: 1600, height: 1000, x: 40, y: 60 });
const page = s.page;
await page.waitForTimeout(1500);
const shell = await page.evaluate(() => ({ onboarding: !!document.querySelector('[data-testid="onboarding-create-collection"]'), rows: [...document.querySelectorAll('[data-testid="sidebar-collection-row"]')].map(e => e.innerText.trim().slice(0, 40)), workspace: document.querySelector('[data-testid="workspace-switcher-name"]')?.textContent?.trim() }));
console.log('shell after seed:', JSON.stringify(shell));
await page.screenshot({ path: 'spikes/out/s7-seeded.png' });
const docsAfter = new Set(fs.existsSync(path.join(os.homedir(), 'Documents/bruno')) ? fs.readdirSync(path.join(os.homedir(), 'Documents/bruno')) : []);
console.log('new entries in ~/Documents/bruno:', [...docsAfter].filter(x => !docsBefore.has(x)));

// collection.open → runner.open → runner.runCollection → runner.complete
const row = page.locator('[data-testid="sidebar-collection-row"]', { hasText: 'Bruno Capture Demo' }).first();
await row.click(); await page.waitForTimeout(800);
console.log('items after open:', await page.locator('[data-testid="sidebar-collection-item-row"]').count(), '| collection-header visible:', await page.locator('[data-testid="collection-header"]').isVisible().catch(() => false));
await row.hover();
await page.locator('[data-testid="collection-actions"]').first().click();
await page.locator('[data-testid="collection-actions-run"]').click();
const t1 = Date.now();
await page.locator('[data-testid="runner-run-button"]').waitFor({ timeout: 15000 });
console.log(`runner.open postcondition (runner-run-button) in ${Date.now() - t1} ms`);
console.log('runner panel ids:', JSON.stringify(await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-testid^="runner"]')].map(e => e.getAttribute('data-testid')))])));
await page.screenshot({ path: 'spikes/out/s7-runner-open.png' });
// environment selector
console.log('env trigger text:', (await page.locator('[data-testid="environment-selector-trigger"]').innerText().catch(() => 'n/a')).trim());
const runBtn = page.locator('[data-testid="runner-run-button"]');
console.log('run button enabled before select-all:', await runBtn.isEnabled(), '| counter:', (await page.locator('[data-testid="runner-config-counter"]').innerText().catch(() => 'n/a')).trim());
if (!(await runBtn.isEnabled())) { await page.locator('[data-testid="runner-select-all"]').click(); await page.waitForTimeout(300); console.log('  clicked select-all'); } else console.log('  requests already selected; not touching select-all');
console.log('after select-all: enabled', await runBtn.isEnabled(), '| counter:', (await page.locator('[data-testid="runner-config-counter"]').innerText().catch(() => 'n/a')).trim(), '| request items:', await page.locator('[data-testid="runner-request-item"]').count());
await runBtn.click();
const t2 = Date.now();
await page.locator('[data-testid="runner-cancel-button"]').waitFor({ timeout: 5000 }).then(() => console.log('  running state (cancel button) visible')).catch(() => console.log('  cancel button never seen (fast run)'));
await page.locator('[data-testid="runner-run-again-button"]').waitFor({ timeout: 60000 });
console.log(`runner.complete (run-again visible) in ${Date.now() - t2} ms; results:`, await page.locator('[data-testid="runner-result-item"]').count(), 'status:', (await page.locator('[data-testid="runner-iteration-status"]').innerText().catch(() => 'n/a')).replace(/\s+/g, ' ').slice(0, 120));
await page.screenshot({ path: 'spikes/out/s7-runner-complete.png' });
await s.close();
console.log('done; user Bruno running?', (await import('node:child_process')).execSync('pgrep -fl "MacOS/Bruno$" || echo none').toString().trim());
