import { _electron as electron } from 'playwright';
import fs from 'node:fs'; import path from 'node:path';
const exe = '/Applications/Bruno.app/Contents/MacOS/Bruno';
const shell = '[data-testid="sidebar"], [data-testid="workspace-menu"], [data-testid="onboarding-create-collection"]';
const dir = process.env.PROFILE_DIR; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });

// A) --user-data-dir on the packaged app
let app = await electron.launch({ executablePath: exe, args: [`--user-data-dir=${dir}`], timeout: 45000 });
let win = await app.firstWindow(); await win.waitForLoadState('domcontentloaded');
await win.locator(shell).first().waitFor({ timeout: 30000 }); await win.waitForTimeout(2500);
const info = await app.evaluate(({ app }) => ({ userData: app.getPath('userData'), sessionData: app.getPath('sessionData') }));
console.log('A. --user-data-dir →', JSON.stringify(info), '| isolated:', info.userData === dir);
console.log('   fresh-profile shell:', JSON.stringify(await win.evaluate(() => ({ sidebar: !!document.querySelector('[data-testid="sidebar"]'), onboarding: !!document.querySelector('[data-testid="onboarding-create-collection"]'), collections: document.querySelectorAll('[data-testid="sidebar-collection-row"]').length, workspace: document.querySelector('[data-testid="workspace-switcher-name"]')?.textContent?.trim(), theme: document.documentElement.className, ls: localStorage.getItem('bruno.theme') }))));
await win.screenshot({ path: 'spikes/out/s6-fresh-profile.png' });
await app.close();
console.log('   profile dir now:', fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => !f.startsWith('.')).join(', ') : '(missing)');
for (const f of ['ui-state-snapshot.json', 'preferences.json']) { const p = path.join(dir, f); if (fs.existsSync(p)) console.log(`   ${f}:`, fs.readFileSync(p, 'utf8').replace(/\s+/g, ' ').slice(0, 700)); }
for (const d of fs.existsSync(dir) ? fs.readdirSync(dir) : []) { const p = path.join(dir, d); if (fs.statSync(p).isDirectory() && /workspace/i.test(d)) { console.log(`   ${d}/:`, fs.readdirSync(p).join(', ')); const wy = path.join(p, 'workspace.yml'); if (fs.existsSync(wy)) console.log('   workspace.yml:', fs.readFileSync(wy, 'utf8').replace(/\s+/g, ' ').slice(0, 400)); } }

// B) restore the user's stored theme to "system" (was changed by the previous launcher test)
app = await electron.launch({ executablePath: exe, timeout: 45000 });
win = await app.firstWindow(); await win.waitForLoadState('domcontentloaded'); await win.locator(shell).first().waitFor({ timeout: 30000 });
console.log('B. user profile before:', await win.evaluate(() => localStorage.getItem('bruno.theme')));
await win.evaluate(() => localStorage.setItem('bruno.theme', JSON.stringify('system')));
await win.reload({ waitUntil: 'domcontentloaded' }); await win.locator(shell).first().waitFor({ timeout: 30000 }); await win.waitForTimeout(500);
console.log('   user profile after:', await win.evaluate(() => ({ ls: localStorage.getItem('bruno.theme'), html: document.documentElement.className })));
await app.close();
