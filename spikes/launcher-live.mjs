// Live check of packages/automation launcher in capture-profile mode (D4) + geometry + theme.
import { register } from 'tsx/esm/api';
register();
const { launchBruno, setContentSize, setTheme, readTheme } = await import('../packages/automation/src/index.ts');
import fs from 'node:fs';
import path from 'node:path';
const profile = process.env.PROFILE_DIR;
fs.rmSync(profile, { recursive: true, force: true });
const t0 = Date.now();
const s = await launchBruno({ executablePath: '/Applications/Bruno.app/Contents/MacOS/Bruno', profileMode: 'capture', captureProfileDir: profile, log: (m) => console.log('  [launcher]', m) });
console.log(`launched in ${Date.now() - t0} ms: v${s.version} electron ${s.electronVersion} pid ${s.pid} windowId ${s.windowId} userData=${s.userDataPath}`);
console.log('fresh-profile shell:', await s.page.evaluate(() => ({
  sidebar: !!document.querySelector('[data-testid="sidebar"]'), onboarding: !!document.querySelector('[data-testid="onboarding-create-collection"]'),
  workspaceName: document.querySelector('[data-testid="workspace-switcher-name"]')?.textContent?.trim(), collections: document.querySelectorAll('[data-testid="sidebar-collection-row"]').length })));
await s.page.screenshot({ path: 'spikes/out/launcher-fresh-profile.png' });
const g = await setContentSize(s, { width: 1600, height: 1000, x: 40, y: 60 });
console.log('geometry:', JSON.stringify(g));
const t1 = Date.now(); await setTheme(s, 'dark'); console.log(`theme→dark in ${Date.now() - t1} ms:`, JSON.stringify(await readTheme(s.page)));
await setTheme(s, 'light'); console.log('theme→light:', JSON.stringify(await readTheme(s.page)));
await s.page.screenshot({ path: 'spikes/out/launcher-1600x1000-light.png' });
console.log('profile dir contents:', fs.readdirSync(profile).filter(f => !f.startsWith('.')).join(', '));
const snap = path.join(profile, 'ui-state-snapshot.json');
if (fs.existsSync(snap)) console.log('fresh ui-state-snapshot.json:', fs.readFileSync(snap, 'utf8').slice(0, 900));
const prefs = path.join(profile, 'preferences.json');
if (fs.existsSync(prefs)) console.log('fresh preferences.json keys:', Object.keys(JSON.parse(fs.readFileSync(prefs, 'utf8'))).join(', '));
for (const d of fs.readdirSync(profile)) { const p = path.join(profile, d); if (fs.statSync(p).isDirectory() && /workspace/i.test(d)) console.log(`workspace dir ${d}:`, fs.readdirSync(p).join(', '), fs.existsSync(path.join(p, 'workspace.yml')) ? '\n' + fs.readFileSync(path.join(p, 'workspace.yml'), 'utf8').slice(0, 600) : ''); }
await s.close();
console.log('closed; user profile untouched check — user Bruno running?', (await import('node:child_process')).execSync('pgrep -fl "MacOS/Bruno$" || echo none').toString().trim());
