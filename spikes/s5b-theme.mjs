// S5b — how do we set Bruno's theme deterministically? preferences.json themeMode vs renderer localStorage bruno.theme.
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
const exe = '/Applications/Bruno.app/Contents/MacOS/Bruno';
const prefsPath = `${process.env.HOME}/Library/Application Support/bruno/preferences.json`;
const orig = fs.readFileSync(prefsPath, 'utf8'); const prefs = JSON.parse(orig);
console.log('original: themeMode =', prefs.themeMode, '| themeBg =', prefs.themeBg);
const state = (win) => win.evaluate(() => ({ htmlClass: document.documentElement.className, ls: localStorage.getItem('bruno.theme') }));
const launch = async () => { const app = await electron.launch({ executablePath: exe, timeout: 45_000 }); const win = await app.firstWindow({ timeout: 45_000 }); await win.locator('[data-testid="sidebar"]').waitFor({ timeout: 20_000 }); await win.waitForTimeout(600); return { app, win }; };
let origLs = null;
try {
  fs.writeFileSync(prefsPath, JSON.stringify({ ...prefs, themeMode: 'dark' }, null, '\t'));
  let { app, win } = await launch();
  const a = await state(win); origLs = a.ls;
  console.log('A. seeded preferences.json themeMode=dark → launch →', JSON.stringify(a));
  await win.evaluate(() => localStorage.setItem('bruno.theme', JSON.stringify('light')));
  await win.reload(); await win.locator('[data-testid="sidebar"]').waitFor({ timeout: 20_000 }); await win.waitForTimeout(600);
  console.log('B. localStorage bruno.theme="light" + reload →', JSON.stringify(await state(win)), '| prefs on disk themeMode:', JSON.parse(fs.readFileSync(prefsPath, 'utf8')).themeMode);
  await app.close();
  fs.writeFileSync(prefsPath, JSON.stringify({ ...prefs, themeMode: 'dark' }, null, '\t'));
  ({ app, win } = await launch());
  console.log('C. relaunch with prefs=dark, localStorage=light →', JSON.stringify(await state(win)));
  await win.evaluate((v) => { if (v === null) localStorage.removeItem('bruno.theme'); else localStorage.setItem('bruno.theme', v); }, origLs);
  await win.reload(); await win.locator('[data-testid="sidebar"]').waitFor({ timeout: 20_000 }); await win.waitForTimeout(400);
  console.log('D. localStorage restored to', origLs, '→', JSON.stringify(await state(win)));
  await app.close();
} catch (e) { console.log('S5b FAIL:', String(e.message).split('\n')[0]); }
finally {
  fs.writeFileSync(prefsPath, orig);
  console.log('restored preferences.json → themeMode =', JSON.parse(fs.readFileSync(prefsPath, 'utf8')).themeMode);
}
